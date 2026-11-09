import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../../../src/cli.js';
import type { CliDeps, CliIo } from '../../../src/cli.js';
import { renderJson } from '../../../src/report/index.js';
import { scan } from '../../../src/scan.js';
import type { ScanRunOptions } from '../../../src/scan.js';
import type { Report } from '../../../src/types.js';
import { defaultUserAgent, getVersion } from '../../../src/util/version.js';
import { anthropicReply, json, startMockLlm } from '../explain/mock-llm.js';
import type { MockLlm } from '../explain/mock-llm.js';
import { CATALOG, makeCrawl, makeFinding, makeFindings, makeReport } from '../report/helpers.js';

const SENTINEL = 'sk-SENTINEL-do-not-leak-0123456789';
const URL_ARG = 'http://127.0.0.1:8080/';

function capture(): { io: CliIo; stdout: () => string; stderr: () => string } {
  let out = '';
  let err = '';
  return {
    io: { stdout: { write: (c) => (out += c) }, stderr: { write: (c) => (err += c) } },
    stdout: () => out,
    stderr: () => err,
  };
}

function fakeScan(report: Report): { deps: CliDeps; calls: { url: string; opts: ScanRunOptions }[] } {
  const calls: { url: string; opts: ScanRunOptions }[] = [];
  return {
    calls,
    deps: {
      scan: async (url, opts) => {
        calls.push({ url, opts });
        return { report, outDir: opts.outDir };
      },
    },
  };
}

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('main: informational commands and usage errors', () => {
  it('prints help to stdout and exits 0', async () => {
    const c = capture();
    expect(await main(['--help'], c.io)).toBe(0);
    expect(c.stdout()).toContain('ai-act-check <url> [options]');
    expect(c.stdout()).toContain('Exit codes');
    expect(c.stdout()).toMatch(/not legal advice/i);
    expect(c.stderr()).toBe('');
  });

  it('prints the version and exits 0', async () => {
    const c = capture();
    expect(await main(['--version'], c.io)).toBe(0);
    expect(c.stdout()).toBe(`${getVersion()}\n`);
  });

  it.each([[[]], [['--pages', '0', URL_ARG]], [[URL_ARG, '--bogus']], [[URL_ARG, 'http://127.0.0.1:2/']], [[URL_ARG, '--pages', 'x']]])(
    'exits 2 on usage error %j, with nothing on stdout and no scan',
    async (argv) => {
      const c = capture();
      const { deps, calls } = fakeScan(makeReport());
      expect(await main(argv, c.io, deps)).toBe(2);
      expect(c.stdout()).toBe('');
      expect(c.stderr()).toContain('ai-act-check:');
      expect(c.stderr()).toContain('--help');
      expect(calls).toHaveLength(0);
    },
  );
});

describe('main: refused targets (exit 3)', () => {
  it.each([['not a url'], ['example.com'], ['ftp://example.com/'], ['file:///etc/passwd'], ['javascript:alert(1)'], ['http://user:pw@example.com/']])(
    'refuses %j before scanning',
    async (target) => {
      const c = capture();
      const { deps, calls } = fakeScan(makeReport());
      expect(await main([target], c.io, deps)).toBe(3);
      expect(c.stderr()).toContain('refused');
      expect(c.stdout()).toBe('');
      expect(calls).toHaveLength(0);
    },
  );

  it.each([
    ['robots_disallow', /robots\.txt/],
    ['private_address', /private or local address/],
    ['invalid_url', /not a valid/],
    ['load_failed', /failed to load/],
  ] as const)('exits 3 when the crawl reports startBlocked=%s', async (startBlocked, message) => {
    const c = capture();
    const report = makeReport(makeFindings(), makeCrawl({ pages: [], startBlocked }));
    expect(await main([URL_ARG], c.io, fakeScan(report).deps)).toBe(3);
    expect(c.stderr()).toMatch(message);
    expect(c.stdout()).toContain('CANNOT TELL'); // the report is still shown
  });

  it('exits 3 when no page could be loaded even without a startBlocked reason', async () => {
    const c = capture();
    const report = makeReport(makeFindings(), makeCrawl({ pages: [] }));
    expect(await main([URL_ARG], c.io, fakeScan(report).deps)).toBe(3);
    expect(c.stderr()).toContain('no pages could be loaded');
  });
});

describe('main: successful scans', () => {
  it('prints the human summary with outcome words and report paths', async () => {
    const c = capture();
    const { deps } = fakeScan(makeReport());
    expect(await main([URL_ARG, '--out', '/tmp/x'], c.io, deps)).toBe(0);
    const out = c.stdout();
    expect(out).toMatch(/^ai-act-check .*Not legal advice, not a certification or compliance assessment/m);
    expect(out).toMatch(/CHAT-01\s+FOUND\s+Chat widget detected/);
    expect(out).toMatch(/CHAT-02\s+NOT FOUND\s/);
    expect(out).toMatch(/MEDIA-01\s+CANNOT TELL \(not a pass\)\s/);
    expect(out).toContain('1 found, 2 not found, 2 cannot tell.');
    expect(out).toContain('Report (JSON): /tmp/x/report.json');
    expect(out).toContain('Report (HTML): /tmp/x/report.html');
    expect(out).not.toMatch(/compliant|violat|illegal/i);
  });

  it('prints the User-Agent and a reminder on stderr first', async () => {
    const c = capture();
    await main([URL_ARG], c.io, fakeScan(makeReport()).deps);
    const first = c.stderr().split('\n')[0]!;
    expect(first).toContain(defaultUserAgent());
    expect(first).toContain('allowed to scan');
  });

  it('notes --allow-private on stderr only', async () => {
    const c = capture();
    await main([URL_ARG, '--allow-private'], c.io, fakeScan(makeReport()).deps);
    expect(c.stderr()).toContain('--allow-private is on');
    expect(c.stdout()).not.toContain('--allow-private is on');
    const without = capture();
    await main([URL_ARG], without.io, fakeScan(makeReport()).deps);
    expect(without.stderr()).not.toContain('--allow-private');
  });

  it('maps flags to scan options and omits unset ones', async () => {
    const { deps, calls } = fakeScan(makeReport());
    await main([URL_ARG, '--pages', '4', '--out', 'o', '--explain', '--delay-ms', '5', '--no-html', '--allow-private'], capture().io, deps);
    expect(calls[0]).toEqual({
      url: URL_ARG,
      opts: { outDir: 'o', maxPages: 4, userAgent: defaultUserAgent(), allowPrivate: true, explain: true, html: false, delayMs: 5 },
    });
    expect('timeoutMs' in calls[0]!.opts).toBe(false);
    expect('settleMs' in calls[0]!.opts).toBe(false);
  });

  it('defaults the output directory to ./ai-act-check-report-<host>-<timestamp>', async () => {
    const { deps, calls } = fakeScan(makeReport());
    await main([URL_ARG], capture().io, deps);
    expect(calls[0]!.opts.outDir).toMatch(/^\.\/ai-act-check-report-127\.0\.0\.1-8080-\d{8}T\d{6}$/);
  });

  it('does not mention the HTML report with --no-html', async () => {
    const c = capture();
    await main([URL_ARG, '--no-html'], c.io, fakeScan(makeReport()).deps);
    expect(c.stdout()).toContain('Report (JSON)');
    expect(c.stdout()).not.toContain('Report (HTML)');
  });

  it('shows the explanation, and tells stderr when the template was used instead of a model', async () => {
    const c = capture();
    const report = makeReport();
    report.explanation = { source: 'template', items: [{ ruleId: 'CHAT-01', text: 'Explained.' }], guardRejected: 'llm_not_configured' };
    expect(await main([URL_ARG, '--explain'], c.io, fakeScan(report).deps)).toBe(0);
    expect(c.stdout()).toContain('Explanation (source: template):');
    expect(c.stdout()).toContain('CHAT-01: Explained.');
    expect(c.stderr()).toContain('llm_not_configured');
  });
});

describe('main: --json', () => {
  it('prints pure, parseable JSON on stdout and every notice on stderr', async () => {
    const c = capture();
    const report = makeReport();
    expect(await main([URL_ARG, '--json', '--allow-private', '--out', '/tmp/y'], c.io, fakeScan(report).deps)).toBe(0);
    expect(c.stdout()).toBe(renderJson(report));
    expect(JSON.parse(c.stdout())).toEqual(JSON.parse(JSON.stringify(report)));
    expect(c.stderr()).toContain('User-Agent');
    expect(c.stderr()).toContain('Report (JSON): /tmp/y/report.json');
  });

  it('keeps stdout pure JSON when the scan is blocked (exit 3)', async () => {
    const c = capture();
    const report = makeReport(makeFindings(), makeCrawl({ pages: [], startBlocked: 'robots_disallow' }));
    expect(await main([URL_ARG, '--json'], c.io, fakeScan(report).deps)).toBe(3);
    expect(() => JSON.parse(c.stdout())).not.toThrow();
    expect(c.stderr()).toContain('scan blocked');
  });
});

describe('main: internal errors (exit 1)', () => {
  const failing: CliDeps = {
    scan: async () => {
      throw new Error('browser exploded');
    },
  };

  it('prints a one-line error without a stack trace', async () => {
    const c = capture();
    expect(await main([URL_ARG], c.io, failing)).toBe(1);
    expect(c.stderr()).toContain('internal error: browser exploded');
    expect(c.stderr()).not.toMatch(/\n\s+at /);
    expect(c.stdout()).toBe('');
  });

  it('prints the stack only with DEBUG=1', async () => {
    process.env.DEBUG = '1';
    const c = capture();
    expect(await main([URL_ARG], c.io, failing)).toBe(1);
    expect(c.stderr()).toMatch(/\n\s+at /);
  });

  it('handles non-Error throws', async () => {
    const c = capture();
    const deps: CliDeps = { scan: () => Promise.reject('plain string') };
    expect(await main([URL_ARG], c.io, deps)).toBe(1);
    expect(c.stderr()).toContain('unknown error');
  });
});

describe('the LLM API key never leaves the process', () => {
  let tmp: string;
  let mock: MockLlm | undefined;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ai-act-check-key-'));
  });
  afterEach(async () => {
    await mock?.close();
    mock = undefined;
    rmSync(tmp, { recursive: true, force: true });
  });

  function allOutputs(c: ReturnType<typeof capture>): string {
    const files = readdirSync(tmp, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(json|html)$/.test(f));
    return [c.stdout(), c.stderr(), ...files.map((f) => readFileSync(join(tmp, f), 'utf8'))].join('\n----\n');
  }

  async function realScan(argv: string[], modelBehaviour: 'echo' | 'fail' | 'good'): Promise<{ code: number; c: ReturnType<typeof capture>; files: string[] }> {
    mock = await startMockLlm((req, res) => {
      if (modelBehaviour === 'fail') return json(res, 500, { error: `bad key ${SENTINEL}`, echoed: req.headers['x-api-key'] });
      const findings = makeFindings();
      const items = findings.map((f) => ({
        ruleId: f.ruleId,
        text: f.outcome === 'cannot_tell' ? 'The scan could not determine this.' : f.outcome === 'found' ? 'The scan found a match.' : 'The scan did not match anything here.',
      }));
      if (modelBehaviour === 'echo') items[0]!.text += ` ${String(req.headers['x-api-key'])}`;
      return json(res, 200, anthropicReply(JSON.stringify({ items })));
    });
    Object.assign(process.env, { LLM_PROVIDER: 'anthropic', LLM_API_KEY: SENTINEL, LLM_BASE_URL: mock.baseUrl });
    const c = capture();
    const deps: CliDeps = {
      scan: (url, opts) => scan(url, opts, { crawl: async () => makeCrawl(), runRules: () => makeFindings(), ruleCatalog: CATALOG, rulesVersion: '0.1.0' }),
    };
    const code = await main(argv, c.io, deps);
    return { code, c, files: readdirSync(tmp) };
  }

  it.each(['good', 'echo', 'fail'] as const)('does not appear in stdout, stderr, report.json or report.html (model: %s)', async (behaviour) => {
    const { code, c, files } = await realScan([URL_ARG, '--explain', '--out', tmp], behaviour);
    expect(code).toBe(0);
    expect(files.sort()).toEqual(['report.html', 'report.json']);
    expect(allOutputs(c)).not.toContain(SENTINEL);
    expect(mock!.requests[0]!.headers['x-api-key']).toBe(SENTINEL); // it really was used
  });

  it('does not appear with --json either', async () => {
    const { c } = await realScan([URL_ARG, '--explain', '--json', '--out', tmp], 'echo');
    expect(JSON.parse(c.stdout())).toBeTruthy();
    expect(allOutputs(c)).not.toContain(SENTINEL);
  });

  it('is redacted from error messages that happen to contain it', async () => {
    process.env.LLM_API_KEY = SENTINEL;
    const c = capture();
    const deps: CliDeps = { scan: () => Promise.reject(new Error(`request failed with key ${SENTINEL}`)) };
    expect(await main([URL_ARG], c.io, deps)).toBe(1);
    expect(c.stderr()).not.toContain(SENTINEL);
    expect(c.stderr()).toContain('[redacted]');
  });

  it('is not in the help text or when explain is requested without any config', async () => {
    process.env.LLM_API_KEY = SENTINEL;
    const help = capture();
    await main(['--help'], help.io);
    expect(help.stdout()).not.toContain(SENTINEL);
    const report = makeReport([makeFinding()]);
    report.explanation = { source: 'template', items: [], guardRejected: 'llm_not_configured' };
    const c = capture();
    await main([URL_ARG, '--explain'], c.io, fakeScan(report).deps);
    expect(c.stdout() + c.stderr()).not.toContain(SENTINEL);
  });
});
