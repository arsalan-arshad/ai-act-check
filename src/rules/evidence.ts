// Evidence assembly shared by all rules: de-duplication, the 20-item cap, and the screenshot item.

import type { Evidence, EvidenceKind, Finding, Outcome, PageSnapshot } from '../types.js';

export const EVIDENCE_CAP = 20;

export interface DraftEvidence {
  page: PageSnapshot;
  kind: EvidenceKind;
  value: string;
}

export interface BuiltEvidence {
  evidence: Evidence[];
  /** Number of matches that did not fit under the cap. */
  omitted: number;
}

/**
 * Turns drafts into capped evidence. The page screenshot of the first contributing page that has one
 * is appended as a `screenshot` item and counts toward the cap, so the result never exceeds EVIDENCE_CAP.
 */
export function buildEvidence(drafts: readonly DraftEvidence[]): BuiltEvidence {
  const seen = new Set<string>();
  const unique: DraftEvidence[] = [];
  for (const draft of drafts) {
    const key = `${draft.page.url}\u0000${draft.kind}\u0000${draft.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(draft);
  }
  if (unique.length === 0) return { evidence: [], omitted: 0 };

  const shotPage = unique.find((draft) => draft.page.screenshot !== null)?.page;
  const limit = shotPage ? EVIDENCE_CAP - 1 : EVIDENCE_CAP;
  const evidence: Evidence[] = unique.slice(0, limit).map((draft) => ({
    url: draft.page.url,
    kind: draft.kind,
    value: draft.value,
    capturedAt: draft.page.fetchedAt,
  }));
  if (shotPage?.screenshot) {
    evidence.push({ url: shotPage.url, kind: 'screenshot', value: shotPage.screenshot, capturedAt: shotPage.fetchedAt });
  }
  return { evidence, omitted: Math.max(0, unique.length - limit) };
}

export function capNote(omitted: number): string {
  return omitted > 0 ? ` The evidence list is capped at ${EVIDENCE_CAP} items; ${omitted} more match${omitted === 1 ? '' : 'es'} not listed.` : '';
}

/**
 * Evidence for a not_found finding: for each evaluated page, a text item stating what was checked and,
 * when the page has one, its screenshot. Truncated to EVIDENCE_CAP items in page order.
 */
export function coverageEvidence(pages: readonly PageSnapshot[], describe: (page: PageSnapshot) => string): BuiltEvidence {
  const all: Evidence[] = [];
  for (const page of pages) {
    all.push({ url: page.url, kind: 'text', value: describe(page), capturedAt: page.fetchedAt });
    if (page.screenshot !== null) all.push({ url: page.url, kind: 'screenshot', value: page.screenshot, capturedAt: page.fetchedAt });
  }
  return { evidence: all.slice(0, EVIDENCE_CAP), omitted: Math.max(0, all.length - EVIDENCE_CAP) };
}

export interface FindingInput {
  ruleId: string;
  title: string;
  outcome: Outcome;
  summary: string;
  needsHumanJudgement: boolean;
  pages: readonly PageSnapshot[];
  drafts?: readonly DraftEvidence[];
  /** For not_found findings: states what was checked on each evaluated page, which becomes the evidence. */
  coverage?: (page: PageSnapshot) => string;
  reason?: string;
}

/** Builds a Finding; a cap note is appended to the summary when evidence was truncated. */
export function makeFinding(input: FindingInput): Finding {
  const built = input.coverage ? coverageEvidence(input.pages, input.coverage) : buildEvidence(input.drafts ?? []);
  const coverageCap = input.coverage && built.omitted > 0 ? ` Evidence is listed for the first pages only (cap of ${EVIDENCE_CAP} items).` : '';
  return {
    ruleId: input.ruleId,
    title: input.title,
    outcome: input.outcome,
    evidence: built.evidence,
    needsHumanJudgement: input.needsHumanJudgement,
    summary: input.summary + (input.coverage ? coverageCap : capNote(built.omitted)),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    pagesEvaluated: input.pages.map((page) => page.url),
  };
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
