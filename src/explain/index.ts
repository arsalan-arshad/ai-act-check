import type { ExplanationBlock, ExplanationItem, Finding } from '../types.js';
import { guardExplanation } from './guard.js';
import { ExplainError, REQUEST_TIMEOUT_MS, callProvider, readConfig } from './provider.js';
import type { ReducedFinding } from './provider.js';
import { templateExplanation } from './template.js';

export { guardExplanation } from './guard.js';
export type { GuardResult } from './guard.js';
export { templateExplanation } from './template.js';

export interface ExplainOptions {
  /** Defaults to process.env. Read: LLM_PROVIDER, LLM_API_KEY, LLM_MODEL, LLM_BASE_URL. */
  env?: NodeJS.ProcessEnv;
  /** Request timeout in ms. Default 30000. */
  timeoutMs?: number;
}

/** The only data a model ever sees: no page text and no evidence. */
export function reduceFindings(findings: readonly Finding[]): ReducedFinding[] {
  return findings.map((f) => ({
    ruleId: f.ruleId,
    title: f.title,
    outcome: f.outcome,
    summary: f.summary,
    reason: f.reason,
    needsHumanJudgement: f.needsHumanJudgement,
  }));
}

/** Parses `{"items":[{"ruleId","text"}]}`, tolerating a Markdown code fence around it. */
export function parseModelItems(raw: string): ExplanationItem[] {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced?.[1] ?? trimmed);
  } catch {
    throw new ExplainError('invalid_json');
  }
  const items = typeof parsed === 'object' && parsed !== null ? (parsed as { items?: unknown }).items : undefined;
  if (!Array.isArray(items)) throw new ExplainError('bad_shape');
  return items.map((item: unknown) => {
    const ruleId = typeof item === 'object' && item !== null ? (item as { ruleId?: unknown }).ruleId : undefined;
    const text = typeof item === 'object' && item !== null ? (item as { text?: unknown }).text : undefined;
    if (typeof ruleId !== 'string' || typeof text !== 'string') throw new ExplainError('bad_shape');
    return { ruleId, text };
  });
}

/**
 * Optional BYOK plain-language explanation. Never throws and never touches `findings`: on any
 * problem (no key, HTTP error, timeout, bad JSON, guard rejection) it returns the deterministic
 * template with `guardRejected` set to a short fixed reason code.
 */
export async function explainFindings(findings: readonly Finding[], opts: ExplainOptions = {}): Promise<ExplanationBlock> {
  const env = opts.env ?? process.env;
  const fallback = (reason: string): ExplanationBlock => ({
    source: 'template',
    items: templateExplanation(findings),
    guardRejected: reason,
  });
  try {
    const config = readConfig(env);
    const raw = await callProvider(config, reduceFindings(findings), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const items = parseModelItems(raw);
    if (JSON.stringify(items).includes(config.apiKey)) return fallback('guard:secret_echo');
    const verdict = guardExplanation(findings, items);
    if (!verdict.ok) return fallback(`guard:${verdict.reason}`);
    const text = new Map(items.map((i) => [i.ruleId, i.text.trim()]));
    return {
      source: config.provider,
      model: config.model,
      items: findings.map((f) => ({ ruleId: f.ruleId, text: text.get(f.ruleId) ?? '' })),
    };
  } catch (err) {
    return fallback(err instanceof ExplainError ? err.code : 'unexpected_error');
  }
}
