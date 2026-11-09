export type ProviderId = 'anthropic' | 'openai';

export interface ProviderConfig {
  provider: ProviderId;
  /** Secret. Never log, serialize or include in an error. */
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface ReducedFinding {
  ruleId: string;
  title: string;
  outcome: string;
  summary: string;
  reason?: string;
  needsHumanJudgement: boolean;
}

/** Failure with a short fixed code. Messages never carry response bodies, URLs or credentials. */
export class ExplainError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 200_000;

const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4o-mini',
};
const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
};

const SYSTEM_PROMPT = [
  'You explain the results of an automated website check in plain language for a non-lawyer.',
  'You receive a JSON array of findings produced by fixed rules. The rules decide; you must not add, remove, re-rate or reinterpret any finding.',
  'For each finding write one to three short sentences (at most 400 characters) saying what the outcome means for what the scan could see.',
  'Never say a site is compliant, non-compliant, legal, illegal, safe or passing. Never mention fines, penalties or certification. Never give legal advice.',
  'The outcome "cannot_tell" means the scan could not determine the answer: say so with the words "could not determine", and never imply it is fine or a pass.',
  'Do not contradict the outcome: do not say something was found when the outcome is not_found, or the reverse.',
  'Reply with JSON only, in the form {"items":[{"ruleId":"...","text":"..."}]}, with exactly one item per finding, using the given ruleId values.',
].join(' ');

export function readConfig(env: NodeJS.ProcessEnv): ProviderConfig {
  const provider = env.LLM_PROVIDER?.trim().toLowerCase();
  if (provider !== 'anthropic' && provider !== 'openai') throw new ExplainError('llm_not_configured');
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) throw new ExplainError('llm_not_configured');
  const baseUrl = (env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URLS[provider]).replace(/\/+$/, '');
  let protocol: string;
  try {
    protocol = new URL(baseUrl).protocol;
  } catch {
    throw new ExplainError('invalid_base_url');
  }
  if (protocol !== 'https:' && protocol !== 'http:') throw new ExplainError('invalid_base_url');
  return { provider, apiKey, model: env.LLM_MODEL?.trim() || DEFAULT_MODELS[provider], baseUrl };
}

function request(config: ProviderConfig, findings: ReducedFinding[]): { url: string; headers: Record<string, string>; body: unknown } {
  const user = JSON.stringify(findings);
  if (config.provider === 'anthropic') {
    return {
      url: `${config.baseUrl}/v1/messages`,
      headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      body: { model: config.model, max_tokens: 2000, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: user }] },
    };
  }
  return {
    url: `${config.baseUrl}/v1/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: {
      model: config.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
    },
  };
}

function extractText(provider: ProviderId, payload: unknown): string {
  if (typeof payload === 'object' && payload !== null) {
    if (provider === 'anthropic') {
      const content = (payload as { content?: unknown }).content;
      if (Array.isArray(content)) {
        const first: unknown = content[0];
        const text = typeof first === 'object' && first !== null ? (first as { text?: unknown }).text : undefined;
        if (typeof text === 'string') return text;
      }
    } else {
      const choices = (payload as { choices?: unknown }).choices;
      if (Array.isArray(choices)) {
        const first: unknown = choices[0];
        const message = typeof first === 'object' && first !== null ? (first as { message?: unknown }).message : undefined;
        const content = typeof message === 'object' && message !== null ? (message as { content?: unknown }).content : undefined;
        if (typeof content === 'string') return content;
      }
    }
  }
  throw new ExplainError('bad_response_shape');
}

/** Sends the reduced findings to the configured provider and returns the model's raw text. */
export async function callProvider(config: ProviderConfig, findings: ReducedFinding[], timeoutMs: number): Promise<string> {
  const req = request(config, findings);
  let text: string;
  let status: number;
  try {
    // redirect: 'error' keeps the key from ever being forwarded to another host.
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    throw new ExplainError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error');
  }
  if (status < 200 || status > 299) throw new ExplainError(`http_${status}`);
  if (text.length > MAX_RESPONSE_CHARS) throw new ExplainError('response_too_large');
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ExplainError('bad_response_shape');
  }
  return extractText(config.provider, payload);
}
