import type { ExplanationItem, Finding } from '../types.js';

export type GuardResult = { ok: true } | { ok: false; reason: string };

export const MAX_TEXT_LENGTH = 600;

const BANNED_PHRASES: RegExp[] = [
  /compliant/i, // also covers non-compliant / noncompliant
  /violat/i,
  /illegal/i,
  /unlawful/i,
  /\bfines? of\b/i,
  /penalt/i,
  /\bpass(?:es|ed)?\b/i,
  /certified/i,
  /safe\s+harbou?r/i,
  /(?<!\bnot\s+)legal advice/i, // only allowed inside "not legal advice"
];

// A cannot_tell text must never sound like reassurance.
const PASS_LIKE = /\b(?:pass(?:es|ed|ing)?|ok|okay|fine|good|safe|compliant|no\s+issues?)\b/i;
const UNCERTAINTY = /\b(?:cannot|could\s+not|unable|unclear|not\s+determine|undetermined)\b/i;

// For cannot_tell only: saying that the result is NOT a pass is the wording we want. Stripped before the pass-like checks.
const NEGATED_PASS = /\bnot\s+a\s+pass\b|\bmust\s+not\s+be\s+read\s+as\s+a\s+pass\b/gi;

const NEGATION = /\b(?:not|no|nothing|none|never|without|neither|nor)\b|n't\b/i;
const FOUND_WORDS = /\b(?:found|detected|identified|located|present)\b/i;
// "not found", "no widget detected", "nothing was found", "never detected"
const NEGATED_FOUND = /\b(?:not|no|nothing|none|never|without)\b[^.!?;]{0,40}\b(?:found|detected|identified|located|present)\b/i;

// Clause-level split, so "No match on page one, but the phrase was found on page two" is not excused by its first clause.
function clauses(text: string): string[] {
  return text.split(/(?<=[.!?;,:])\s+|\s+(?:but|however|although|though|while|yet|whereas)\s+/i).filter((s) => s.trim() !== '');
}

/** Returns a reason code when the text contradicts the deterministic outcome, else null. Conservative: when unsure, reject. */
function contradiction(outcome: Finding['outcome'], text: string): string | null {
  if (outcome === 'found') return NEGATED_FOUND.test(text) ? 'contradicts_outcome' : null;
  if (outcome === 'not_found') {
    const claimsPresence = clauses(text).some((s) => FOUND_WORDS.test(s) && !NEGATION.test(s));
    return claimsPresence ? 'contradicts_outcome' : null;
  }
  return null;
}

/**
 * Checks model-written explanations against the deterministic findings. The model may only
 * describe findings; it must cover exactly the findings given, each once, in cautious wording.
 */
export function guardExplanation(findings: readonly Finding[], items: readonly ExplanationItem[]): GuardResult {
  const byId = new Map(findings.map((f) => [f.ruleId, f]));
  const seen = new Set<string>();
  for (const item of items) {
    if (!byId.has(item.ruleId)) return { ok: false, reason: 'unknown_rule_id' };
    if (seen.has(item.ruleId)) return { ok: false, reason: `duplicate_rule_id:${item.ruleId}` };
    seen.add(item.ruleId);
  }
  for (const f of findings) {
    if (!seen.has(f.ruleId)) return { ok: false, reason: `missing_rule_id:${f.ruleId}` };
  }
  for (const item of items) {
    const finding = byId.get(item.ruleId) as Finding;
    const where = item.ruleId;
    const text = item.text;
    if (text.trim() === '') return { ok: false, reason: `empty_text:${where}` };
    if (text.length > MAX_TEXT_LENGTH) return { ok: false, reason: `text_too_long:${where}` };
    const screened = finding.outcome === 'cannot_tell' ? text.replace(NEGATED_PASS, ' ') : text;
    if (BANNED_PHRASES.some((re) => re.test(screened))) return { ok: false, reason: `banned_phrase:${where}` };
    if (finding.outcome === 'cannot_tell') {
      if (PASS_LIKE.test(screened)) return { ok: false, reason: `cannot_tell_pass_wording:${where}` };
      if (!UNCERTAINTY.test(text)) return { ok: false, reason: `cannot_tell_missing_uncertainty:${where}` };
    }
    const bad = contradiction(finding.outcome, text);
    if (bad !== null) return { ok: false, reason: `${bad}:${where}` };
  }
  return { ok: true };
}
