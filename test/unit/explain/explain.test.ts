import { afterEach, describe, expect, it } from 'vitest';
import { explainFindings, parseModelItems, reduceFindings, templateExplanation } from '../../../src/explain/index.js';
import { deepFreeze } from '../../../src/util/freeze.js';
import { makeFindings } from '../report/helpers.js';
import { anthropicReply, itemsJson, json, openaiReply, startMockLlm } from './mock-llm.js';
import type { Handler, MockLlm } from './mock-llm.js';

const KEY = 'sk-test-SENTINEL-0123456789abcdef';
let mock: MockLlm | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function serve(handler: Handler): Promise<NodeJS.ProcessEnv> {
  mock = await startMockLlm(handler);
  return { LLM_PROVIDER: 'anthropic', LLM_API_KEY: KEY, LLM_BASE_URL: mock.baseUrl };
}

const findings = makeFindings();
const goodItems = () => [
  { ruleId: 'CHAT-01', text: 'The scan found a chat widget on the pages it read.' },
  { ruleId: 'CHAT-02', text: 'No disclosure wording was found in the widget text the scan could read.' },
  { ruleId: 'MEDIA-01', text: 'The scan could not determine this because no image could be read.' },
  { ruleId: 'MEDIA-02', text: 'The scan could not determine this: there were no flagged images to check.' },
  { ruleId: 'PAGE-01', text: 'No link to an AI policy page was found on the pages checked.' },
];

describe('explainFindings: success', () => {
  it('uses the Anthropic Messages API and returns the model text in finding order', async () => {
    const env = await serve((_req, res) => json(res, 200, anthropicReply(itemsJson([...goodItems()].reverse()))));
    const block = await explainFindings(findings, { env: { ...env, LLM_MODEL: 'test-model' } });
    expect(block.guardRejected).toBeUndefined();
    expect(block.source).toBe('anthropic');
    expect(block.model).toBe('test-model');
    expect(block.items.map((i) => i.ruleId)).toEqual(findings.map((f) => f.ruleId));
    expect(block.items[0]?.text).toBe(goodItems()[0]?.text);

    const req = mock!.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/v1/messages');
    expect(req.headers['x-api-key']).toBe(KEY);
    expect(req.headers['anthropic-version']).toBeTruthy();
  });

  it('uses the OpenAI Chat Completions API', async () => {
    const env = await serve((_req, res) => json(res, 200, openaiReply(itemsJson(goodItems()))));
    const block = await explainFindings(findings, { env: { ...env, LLM_PROVIDER: 'OpenAI', LLM_BASE_URL: `${mock!.baseUrl}/` } });
    expect(block.source).toBe('openai');
    expect(block.guardRejected).toBeUndefined();
    const req = mock!.requests[0]!;
    expect(req.url).toBe('/v1/chat/completions');
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const env = await serve((_req, res) => json(res, 200, anthropicReply('```json\n' + itemsJson(goodItems()) + '\n```')));
    expect((await explainFindings(findings, { env })).source).toBe('anthropic');
  });

  it('sends only the reduced findings: no evidence, no URLs, no page text', async () => {
    const env = await serve((_req, res) => json(res, 200, anthropicReply(itemsJson(goodItems()))));
    await explainFindings(findings, { env });
    const body = JSON.parse(mock!.requests[0]!.body) as { messages: { content: string }[] };
    const sent = JSON.parse(body.messages[0]!.content) as Record<string, unknown>[];
    expect(sent).toEqual(JSON.parse(JSON.stringify(reduceFindings(findings))));
    for (const item of sent) {
      expect(Object.keys(item).sort()).toEqual(
        ['needsHumanJudgement', 'outcome', 'ruleId', 'summary', 'title', ...('reason' in item ? ['reason'] : [])].sort(),
      );
    }
    expect(mock!.requests[0]!.body).not.toContain('widget.js');
    expect(mock!.requests[0]!.body).not.toContain('127.0.0.1:9');
  });
});

describe('explainFindings: fallback to the template', () => {
  const template = templateExplanation(findings);

  async function expectFallback(handler: Handler, reason: RegExp, timeoutMs?: number) {
    const env = await serve(handler);
    const block = await explainFindings(findings, { env, ...(timeoutMs ? { timeoutMs } : {}) });
    expect(block.source).toBe('template');
    expect(block.items).toEqual(template);
    expect(block.guardRejected).toMatch(reason);
    expect(block.model).toBeUndefined();
    expect(JSON.stringify(block)).not.toContain(KEY);
    return block;
  }

  it('on HTTP 500 (without echoing the body)', async () => {
    const block = await expectFallback((_req, res) => json(res, 500, { error: `boom ${KEY}` }), /^http_500$/);
    expect(JSON.stringify(block)).not.toContain('boom');
  });

  it('on HTTP 401', async () => {
    await expectFallback((_req, res) => json(res, 401, { error: 'no' }), /^http_401$/);
  });

  it('on a timeout', async () => {
    await expectFallback(() => undefined, /^timeout$/, 150);
  });

  it('on a redirect (the key is never forwarded)', async () => {
    await expectFallback((_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/' });
      res.end();
    }, /^network_error$/);
  });

  it('on non-JSON model output', async () => {
    await expectFallback((_req, res) => json(res, 200, anthropicReply('Sure! Here is my explanation.')), /^invalid_json$/);
  });

  it('on a non-JSON HTTP body', async () => {
    await expectFallback((_req, res) => res.end('<html>nope</html>'), /^bad_response_shape$/);
  });

  it('on an unexpected response shape', async () => {
    await expectFallback((_req, res) => json(res, 200, { choices: [] }), /^bad_response_shape$/);
  });

  it('when items is missing or malformed', async () => {
    await expectFallback((_req, res) => json(res, 200, anthropicReply('{"results":[]}')), /^bad_shape$/);
    await expectFallback((_req, res) => json(res, 200, anthropicReply('{"items":[{"ruleId":1,"text":"x"}]}')), /^bad_shape$/);
  });

  it('when the model is unreachable', async () => {
    const closed = await startMockLlm(() => undefined);
    const baseUrl = closed.baseUrl;
    await closed.close();
    const block = await explainFindings(findings, { env: { LLM_PROVIDER: 'anthropic', LLM_API_KEY: KEY, LLM_BASE_URL: baseUrl } });
    expect(block.guardRejected).toBe('network_error');
  });

  it.each([
    ['missing rule', (): unknown[] => goodItems().slice(1), /^guard:missing_rule_id:CHAT-01$/],
    ['extra rule', (): unknown[] => [...goodItems(), { ruleId: 'EVIL-99', text: 'The scan found it.' }], /^guard:unknown_rule_id$/],
    ['duplicate rule', (): unknown[] => [...goodItems(), goodItems()[0]], /^guard:duplicate_rule_id:CHAT-01$/],
    ['banned phrase', (): unknown[] => goodItems().map((i, n) => (n === 0 ? { ...i, text: 'The site is compliant and a widget was found.' } : i)), /^guard:banned_phrase:CHAT-01$/],
    [
      'cannot_tell described as fine',
      (): unknown[] => goodItems().map((i) => (i.ruleId === 'MEDIA-01' ? { ...i, text: 'The scan could not determine this, but that is fine.' } : i)),
      /^guard:cannot_tell_pass_wording:MEDIA-01$/,
    ],
    [
      'cannot_tell without uncertainty',
      (): unknown[] => goodItems().map((i) => (i.ruleId === 'MEDIA-02' ? { ...i, text: 'Images were not flagged.' } : i)),
      /^guard:cannot_tell_missing_uncertainty:MEDIA-02$/,
    ],
    [
      'contradiction (found said not found)',
      (): unknown[] => goodItems().map((i) => (i.ruleId === 'CHAT-01' ? { ...i, text: 'No widget was found.' } : i)),
      /^guard:contradicts_outcome:CHAT-01$/,
    ],
    [
      'contradiction (not_found said found)',
      (): unknown[] => goodItems().map((i) => (i.ruleId === 'PAGE-01' ? { ...i, text: 'A policy link was found.' } : i)),
      /^guard:contradicts_outcome:PAGE-01$/,
    ],
    [
      'over-long text',
      (): unknown[] => goodItems().map((i, n) => (n === 0 ? { ...i, text: `The scan found a widget. ${'x'.repeat(700)}` } : i)),
      /^guard:text_too_long:CHAT-01$/,
    ],
  ])('on a hostile model output: %s', async (_name, items, reason) => {
    await expectFallback((_req, res) => json(res, 200, anthropicReply(JSON.stringify({ items: items() }))), reason);
  });

  it('when the model echoes the API key in its text', async () => {
    const block = await expectFallback((req, res) => {
      const echoed = goodItems().map((i, n) => (n === 0 ? { ...i, text: `The scan found a widget. ${String(req.headers['x-api-key'])}` } : i));
      json(res, 200, anthropicReply(JSON.stringify({ items: echoed })));
    }, /^guard:secret_echo$/);
    expect(JSON.stringify(block)).not.toContain(KEY);
  });
});

describe('explainFindings: configuration', () => {
  it.each([
    ['no provider', { LLM_API_KEY: KEY }],
    ['unknown provider', { LLM_PROVIDER: 'other', LLM_API_KEY: KEY }],
    ['no key', { LLM_PROVIDER: 'anthropic' }],
    ['blank key', { LLM_PROVIDER: 'anthropic', LLM_API_KEY: '   ' }],
  ])('falls back with llm_not_configured: %s', async (_name, env) => {
    const block = await explainFindings(findings, { env });
    expect(block.source).toBe('template');
    expect(block.guardRejected).toBe('llm_not_configured');
    expect(block.items).toEqual(templateExplanation(findings));
  });

  it.each(['not a url', 'ftp://example.invalid'])('rejects the base URL %s without any request', async (LLM_BASE_URL) => {
    const block = await explainFindings(findings, { env: { LLM_PROVIDER: 'anthropic', LLM_API_KEY: KEY, LLM_BASE_URL } });
    expect(block.guardRejected).toBe('invalid_base_url');
    expect(JSON.stringify(block)).not.toContain(KEY);
  });

  it('reads process.env by default', async () => {
    const saved = { ...process.env };
    try {
      delete process.env.LLM_PROVIDER;
      delete process.env.LLM_API_KEY;
      expect((await explainFindings(findings)).guardRejected).toBe('llm_not_configured');
    } finally {
      process.env = saved;
    }
  });
});

describe('explainFindings never alters findings', () => {
  it('leaves frozen findings untouched on success and on failure', async () => {
    const snapshot = JSON.stringify(findings);
    const frozen = deepFreeze(structuredClone(findings));
    const ok = await serve((_req, res) => json(res, 200, anthropicReply(itemsJson(goodItems()))));
    await explainFindings(frozen, { env: ok });
    await mock!.close();
    const bad = await serve((_req, res) => json(res, 200, anthropicReply('{"items":[]}')));
    await explainFindings(frozen, { env: bad });
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(JSON.stringify(findings)).toBe(snapshot);
  });

  it('cannot add, remove or change outcomes through the explanation', async () => {
    const before = structuredClone(findings);
    const env = await serve((_req, res) =>
      json(res, 200, anthropicReply(JSON.stringify({ items: goodItems(), findings: [], outcome: 'found', summary: 'pwned' }))),
    );
    const block = await explainFindings(findings, { env });
    expect(findings).toEqual(before);
    expect(Object.keys(block).sort()).toEqual(['items', 'model', 'source']);
    expect(block.items.every((i) => Object.keys(i).sort().join() === 'ruleId,text')).toBe(true);
  });
});

describe('parseModelItems', () => {
  it('drops extra keys on items and parses plain JSON', () => {
    expect(parseModelItems('{"items":[{"ruleId":"A","text":"t","outcome":"found"}]}')).toEqual([{ ruleId: 'A', text: 't' }]);
  });
});
