// Mock LLM provider for explain tests. Speaks Anthropic Messages and OpenAI Chat Completions
// shapes (decided by URL suffix) so it works whichever base-URL convention the client uses.
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export const RULE_IDS = ['CHAT-01', 'CHAT-02', 'MEDIA-01', 'MEDIA-02', 'PAGE-01'];
export const RESPONSE_SECRET = 'RESPONSE-BODY-SECRET-7731';

/** Neutral text that is acceptable for every outcome under the guard rules. */
export const SAFE_TEXT = 'Cannot be settled by this scan alone. A person should review the evidence listed for this rule.';

export type MockMode =
  | 'good'
  | 'compliant'
  | 'flip'
  | 'extra-id'
  | 'missing-id'
  | 'duplicate-id'
  | 'too-long'
  | 'cannot-tell-pass'
  | 'banned-penalty'
  | 'bad-json'
  | 'http-500';

export interface MockRequest {
  path: string;
  headers: http.IncomingHttpHeaders;
  bodyText: string;
}

export interface MockLlm {
  baseUrl: string;
  requests: MockRequest[];
  setMode(m: MockMode): void;
  close(): Promise<void>;
}

/** Best-effort extraction of the {ruleId, outcome} pairs the client sent to the model. */
export function extractSentFindings(bodyText: string): Array<{ ruleId: string; outcome: string }> {
  const texts: string[] = [bodyText];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  try {
    walk(JSON.parse(bodyText));
  } catch {
    /* raw text only */
  }
  const re = /"ruleId"\s*:\s*"([A-Z]+-\d+)"[^{}]*?"outcome"\s*:\s*"(found|not_found|cannot_tell)"/g;
  for (const t of texts) {
    const out: Array<{ ruleId: string; outcome: string }> = [];
    for (const m of t.matchAll(re)) out.push({ ruleId: m[1] as string, outcome: m[2] as string });
    if (out.length >= 3) return out;
  }
  return [];
}

function itemsFor(mode: MockMode, sent: Array<{ ruleId: string; outcome: string }>): Array<Record<string, unknown>> {
  const known = sent.length > 0 ? sent : RULE_IDS.map((ruleId) => ({ ruleId, outcome: 'found' }));
  const items = known.map(({ ruleId, outcome }) => {
    let text = SAFE_TEXT;
    if (mode === 'compliant') text = 'This website is fully compliant with the AI Act and has no issues.';
    if (mode === 'banned-penalty') text = 'Cannot be settled here; the operator risks a fine of up to a large amount and penalties.';
    if (mode === 'too-long') text = SAFE_TEXT.repeat(8);
    if (mode === 'flip') {
      if (outcome === 'found') text = 'Nothing was found for this rule: no widget was detected.';
      else if (outcome === 'not_found') text = 'The element was found and detected on the page.';
      else text = 'Good news: this is fine and OK, no issue.';
    }
    if (mode === 'cannot-tell-pass' && outcome === 'cannot_tell') text = 'This is OK and no issue, the site is safe here.';
    return { ruleId, text };
  });
  if (mode === 'extra-id') items.push({ ruleId: 'ZZZ-99', text: SAFE_TEXT });
  if (mode === 'missing-id') items.pop();
  if (mode === 'duplicate-id' && items[0]) items.push({ ...items[0] });
  return items;
}

export async function startMockLlm(initial: MockMode = 'good'): Promise<MockLlm> {
  let mode: MockMode = initial;
  const requests: MockRequest[] = [];
  const sockets = new Set<Socket>();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const urlPath = (req.url ?? '').split('?')[0] ?? '';
      requests.push({ path: urlPath, headers: req.headers, bodyText });
      if (mode === 'http-500') {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: { message: `upstream failure ${RESPONSE_SECRET}` } }));
        return;
      }
      const content =
        mode === 'bad-json'
          ? `Sure! Here is my analysis: everything looks great. ${RESPONSE_SECRET}`
          : JSON.stringify({ items: itemsFor(mode, extractSentFindings(bodyText)) });
      res.setHeader('content-type', 'application/json');
      if (urlPath.endsWith('/messages')) {
        res.end(
          JSON.stringify({
            id: 'msg_mock',
            type: 'message',
            role: 'assistant',
            model: 'mock-model',
            content: [{ type: 'text', text: content }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        );
      } else if (urlPath.endsWith('/chat/completions')) {
        res.end(
          JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            model: 'mock-model',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'unknown mock path' }));
      }
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    setMode: (m) => {
      mode = m;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
