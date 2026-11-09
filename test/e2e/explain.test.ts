// BYOK explanation step: guard against hostile model output, secrets hygiene, findings immutability,
// and the prompt-injection guard. A local mock LLM server stands in for the provider.
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MockLlm, type MockMode, extractSentFindings, RESPONSE_SECRET, RULE_IDS, SAFE_TEXT, startMockLlm } from '../fixtures/llm-mock.js';
import { type FixtureServer, startFixtureServer } from '../fixtures/server.js';
import { cleanupTmp, normalizedFindings, readAllText, scanUrl, SENTINEL_KEY, type ScanRun, withoutNegatedPass } from './helpers.js';
import { expectCompletedScan } from './invariants.js';

let site: FixtureServer;
let mock: MockLlm;
let baseline: ScanRun;

const env = (provider: 'anthropic' | 'openai', extra: Record<string, string | undefined> = {}) => ({
  LLM_PROVIDER: provider,
  LLM_API_KEY: SENTINEL_KEY,
  LLM_BASE_URL: mock.baseUrl,
  ...extra,
});

function allOutput(run: ScanRun): string {
  return [run.stdout, run.stderr, ...readAllText(run.outDir).map(([, c]) => c)].join('\n=====\n');
}

function expectNoSecrets(run: ScanRun): void {
  const out = allOutput(run);
  expect(out, 'API key must never appear in stdout/stderr/report files').not.toContain(SENTINEL_KEY);
  expect(out, 'partial key must not appear either').not.toContain(SENTINEL_KEY.slice(8));
  expect(out, 'provider response bodies must not be echoed').not.toContain(RESPONSE_SECRET);
}

beforeAll(async () => {
  site = await startFixtureServer('chat-no-disclosure');
  mock = await startMockLlm();
  baseline = await scanUrl(site.url('/'));
});
afterAll(async () => {
  await site?.close();
  await mock?.close();
  cleanupTmp();
});

describe('baseline sanity', () => {
  it('no-explain run has no explanation block and never calls a model', () => {
    expectCompletedScan(baseline, site);
    expect(baseline.report!.explanation).toBeUndefined();
    expect(mock.requests).toHaveLength(0);
  });
});

describe('a well-behaved model', () => {
  for (const provider of ['anthropic', 'openai'] as const) {
    it(`${provider}: explanation accepted, findings untouched, key sent only as a credential header`, async () => {
      mock.setMode('good');
      const before = mock.requests.length;
      const run = await scanUrl(site.url('/'), ['--explain'], { env: env(provider, { LLM_MODEL: 'test-model-x' }) });
      expectCompletedScan(run, site);
      expect(mock.requests.length, 'exactly one provider call').toBe(before + 1);
      const req = mock.requests[before]!;
      if (provider === 'anthropic') expect(req.headers['x-api-key']).toBe(SENTINEL_KEY);
      else expect(req.headers.authorization).toBe(`Bearer ${SENTINEL_KEY}`);
      expect(req.bodyText, 'LLM_MODEL is honoured').toContain('test-model-x');
      expect(req.bodyText, 'the key is never in the request body').not.toContain(SENTINEL_KEY);

      const ex = run.report!.explanation!;
      expect(ex.source).toBe(provider);
      expect(ex.guardRejected).toBeUndefined();
      expect(ex.items.map((i) => i.ruleId)).toEqual(expect.arrayContaining(RULE_IDS));
      expect(ex.items).toHaveLength(RULE_IDS.length);
      for (const i of ex.items) expect(i.text).toBe(SAFE_TEXT);
      expect(normalizedFindings(run), 'findings byte-identical to the no-explain run').toBe(normalizedFindings(baseline));
      expect(run.html!.toLowerCase(), 'HTML labels the explanation source').toContain(provider);
      expectNoSecrets(run);
    });
  }

  it('the model receives only reduced findings: no page text, evidence, URLs, timestamps or screenshots', async () => {
    const cd = await startFixtureServer('chat-with-disclosure');
    try {
      mock.setMode('good');
      const before = mock.requests.length;
      const run = await scanUrl(cd.url('/'), ['--explain'], { env: env('anthropic') });
      expect(run.code, run.stderr).toBe(0);
      const body = mock.requests[before]!.bodyText;
      const sent = extractSentFindings(body);
      expect(sent.map((s) => s.ruleId), 'client sends findings as JSON objects with ruleId and outcome').toEqual(RULE_IDS);
      for (const leak of ['You are chatting with an AI assistant', '127.0.0.1', 'capturedAt', 'screenshots/', 'pagesEvaluated', 'chat-widget', 'Replies may be inaccurate']) {
        expect(body, `request body leaks ${leak}`).not.toContain(leak);
      }
    } finally {
      await cd.close();
    }
  });

  it('--json still prints pure JSON that includes the explanation block', async () => {
    mock.setMode('good');
    const run = await scanUrl(site.url('/'), ['--explain', '--json'], { env: env('anthropic') });
    expect(run.code).toBe(0);
    const parsed = JSON.parse(run.stdout) as { explanation?: { source: string } };
    expect(parsed.explanation?.source).toBe('anthropic');
    expectNoSecrets(run);
  });
});

describe('hostile or broken model output is rejected; the deterministic template is used', () => {
  const MODES: MockMode[] = ['compliant', 'flip', 'extra-id', 'missing-id', 'duplicate-id', 'too-long', 'cannot-tell-pass', 'banned-penalty', 'bad-json', 'http-500'];
  for (const mode of MODES) {
    it(`${mode}`, async () => {
      mock.setMode(mode);
      const before = mock.requests.length;
      const run = await scanUrl(site.url('/'), ['--explain'], { env: env('anthropic') });
      expect(run.code, `scan must not fail because the explainer misbehaved: ${run.stderr}`).toBe(0);
      expect(mock.requests.length, 'the model was actually consulted').toBeGreaterThan(before);
      const ex = run.report!.explanation!;
      expect(ex, 'explanation block present').toBeDefined();
      expect(ex.source, 'fallback to the template').toBe('template');
      expect(ex.guardRejected, 'rejection reason recorded').toBeTruthy();
      expect(ex.items.map((i) => i.ruleId).sort()).toEqual([...RULE_IDS].sort());
      for (const i of ex.items) {
        expect(i.text.length).toBeGreaterThan(0);
        expect(i.text.length).toBeLessThanOrEqual(600);
        expect(i.text).not.toMatch(/compliant|violat|illegal|unlawful|penalt|fine of|certified|safe harbou?r/i);
        expect(i.text).not.toBe(SAFE_TEXT);
      }
      const cannot = run.report!.findings.filter((f) => f.outcome === 'cannot_tell').map((f) => f.ruleId);
      for (const id of cannot) {
        const t = ex.items.find((i) => i.ruleId === id)!.text;
        expect(t, `template text for cannot_tell ${id}`).toMatch(/cannot|could not|unable|unclear|not determine|undetermined/i);
        expect(withoutNegatedPass(t), `template text for cannot_tell ${id} must not read as a pass`).not.toMatch(/\b(pass|passes|passed|ok|fine|good|safe|no issue)\b/i);
      }
      expect(normalizedFindings(run), 'findings byte-identical to the no-explain run').toBe(normalizedFindings(baseline));
      expect(run.report!.summary).toEqual(baseline.report!.summary);
      expect(run.html!).not.toMatch(/fully compliant|has no issues/i);
      expectNoSecrets(run);
    });
  }

  it('openai provider path rejects hostile output the same way', async () => {
    mock.setMode('compliant');
    const run = await scanUrl(site.url('/'), ['--explain'], { env: env('openai') });
    expect(run.code).toBe(0);
    expect(run.report!.explanation!.source).toBe('template');
    expect(run.report!.explanation!.guardRejected).toBeTruthy();
    expect(normalizedFindings(run)).toBe(normalizedFindings(baseline));
    expectNoSecrets(run);
  });
});

describe('explainer failures never fail the scan or leak the key', () => {
  it('missing LLM_API_KEY: template fallback, no provider call', async () => {
    mock.setMode('good');
    const before = mock.requests.length;
    const run = await scanUrl(site.url('/'), ['--explain'], { env: { LLM_PROVIDER: 'anthropic', LLM_BASE_URL: mock.baseUrl } });
    expect(run.code, run.stderr).toBe(0);
    expect(mock.requests.length).toBe(before);
    expect(run.report!.explanation!.source).toBe('template');
    expect(run.report!.explanation!.guardRejected).toBeTruthy();
    expect(normalizedFindings(run)).toBe(normalizedFindings(baseline));
  });

  for (const provider of [undefined, 'not-a-provider']) {
    it(`LLM_PROVIDER=${String(provider)}: template fallback`, async () => {
      mock.setMode('good');
      const before = mock.requests.length;
      const run = await scanUrl(site.url('/'), ['--explain'], { env: { LLM_PROVIDER: provider, LLM_API_KEY: SENTINEL_KEY, LLM_BASE_URL: mock.baseUrl } });
      expect(run.code, run.stderr).toBe(0);
      expect(mock.requests.length, 'no call to an unknown provider').toBe(before);
      expect(run.report!.explanation!.source).toBe('template');
      expectNoSecrets(run);
    });
  }

  it('provider unreachable (connection refused): template fallback, no key in output', async () => {
    const port = await new Promise<number>((resolve) => {
      const srv = net.createServer().listen(0, '127.0.0.1', () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
    });
    const run = await scanUrl(site.url('/'), ['--explain'], { env: env('anthropic', { LLM_BASE_URL: `http://127.0.0.1:${port}` }) });
    expect(run.code, run.stderr).toBe(0);
    expect(run.report!.explanation!.source).toBe('template');
    expect(run.report!.explanation!.guardRejected).toBeTruthy();
    expect(normalizedFindings(run)).toBe(normalizedFindings(baseline));
    expectNoSecrets(run);
  });

  it('DEBUG=1 never prints the key, even on provider errors', async () => {
    mock.setMode('http-500');
    const run = await scanUrl(site.url('/'), ['--explain'], { env: env('anthropic', { DEBUG: '1' }) });
    expect(run.code).toBe(0);
    expectNoSecrets(run);
  });

  it('without --explain the key is ignored: no provider call, no explanation block', async () => {
    mock.setMode('good');
    const before = mock.requests.length;
    const run = await scanUrl(site.url('/'), [], { env: env('anthropic') });
    expect(run.code).toBe(0);
    expect(mock.requests.length).toBe(before);
    expect(run.report!.explanation).toBeUndefined();
    expectNoSecrets(run);
  });

  it('an unrelated env secret is never printed on an error path', async () => {
    const run = await scanUrl('not a url', [], { env: { SOME_OTHER_SECRET: 'env-secret-value-4242', LLM_API_KEY: SENTINEL_KEY } });
    expect(run.code).toBe(3);
    expect(run.stdout + run.stderr).not.toContain('env-secret-value-4242');
    expect(run.stdout + run.stderr).not.toContain(SENTINEL_KEY);
  });
});

describe('prompt injection in page content', () => {
  let inj: FixtureServer;
  let clean: FixtureServer;
  beforeAll(async () => {
    inj = await startFixtureServer('injection');
    clean = await startFixtureServer('injection-clean');
  });
  afterAll(async () => {
    await inj?.close();
    await clean?.close();
  });

  it('deterministic findings are identical to the equivalent clean page', async () => {
    const a = await scanUrl(inj.url('/'));
    const b = await scanUrl(clean.url('/'));
    expectCompletedScan(a, inj);
    expectCompletedScan(b, clean);
    expect(normalizedFindings(a)).toBe(normalizedFindings(b));
    expect(a.report!.summary).toEqual(b.report!.summary);
    expect(a.report!.findings[0]!.outcome).toBe('found');
    expect(a.report!.findings[1]!.outcome).toBe('not_found');
    for (const out of [a.stdout, JSON.stringify(a.report), a.html!]) expect(out).not.toMatch(/fully compliant/i);
  });

  it('with a model that obeys the injection: guard holds, template used, findings untouched, text never sent to the model', async () => {
    mock.setMode('compliant');
    const before = mock.requests.length;
    const base = await scanUrl(inj.url('/'));
    const run = await scanUrl(inj.url('/'), ['--explain'], { env: env('anthropic') });
    expect(run.code, run.stderr).toBe(0);
    expect(run.report!.explanation!.source).toBe('template');
    expect(run.report!.explanation!.guardRejected).toBeTruthy();
    expect(normalizedFindings(run)).toBe(normalizedFindings(base));
    for (const r of mock.requests.slice(before)) expect(r.bodyText).not.toMatch(/IGNORE PREVIOUS INSTRUCTIONS/i);
    for (const out of [run.stdout, JSON.stringify(run.report), run.html!]) expect(out).not.toMatch(/fully compliant|is compliant/i);
    expectNoSecrets(run);
  });

  it('with a well-behaved model the injected page still yields the same findings and explanation as the clean twin', async () => {
    mock.setMode('good');
    const a = await scanUrl(inj.url('/'), ['--explain'], { env: env('anthropic') });
    const b = await scanUrl(clean.url('/'), ['--explain'], { env: env('anthropic') });
    expect(normalizedFindings(a)).toBe(normalizedFindings(b));
    expect(JSON.stringify(a.report!.explanation)).toBe(JSON.stringify(b.report!.explanation));
  });
});
