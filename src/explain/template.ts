import type { ExplanationItem, Finding } from '../types.js';

/**
 * Deterministic plain-language text. It is also the fallback whenever a model is not configured,
 * fails, or is rejected by the guard, so it must itself satisfy the guard's wording rules.
 */
export function templateExplanation(findings: readonly Finding[]): ExplanationItem[] {
  return findings.map((f) => {
    const parts = [f.summary.trim()];
    if (f.outcome === 'found') {
      parts.push('A fixed rule matched on the pages checked. This is evidence for a person to review, not a conclusion.');
    } else if (f.outcome === 'not_found') {
      parts.push('No match was found on the pages the scan could read. That does not show that nothing exists elsewhere.');
    } else {
      parts.push('The scan could not determine this result. That is not a pass, so it needs a manual check.');
      if (f.reason !== undefined) parts.push(`Reason code: ${f.reason}.`);
    }
    if (f.needsHumanJudgement) parts.push('A person must judge whether the wording or placement is adequate; the scan cannot.');
    return { ruleId: f.ruleId, text: parts.join(' ') };
  });
}
