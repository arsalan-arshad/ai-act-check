import type { Evidence, ExplanationBlock, Finding, Report, RuleMeta, SkippedUrl } from '../types.js';

// Key order is fixed here, not inherited from whatever produced the objects, so the same
// report always serializes to the same bytes. undefined values are dropped by JSON.stringify.

const evidence = (e: Evidence): Evidence => ({ url: e.url, kind: e.kind, value: e.value, capturedAt: e.capturedAt });

const finding = (f: Finding): Finding => ({
  ruleId: f.ruleId,
  title: f.title,
  outcome: f.outcome,
  evidence: f.evidence.map(evidence),
  needsHumanJudgement: f.needsHumanJudgement,
  summary: f.summary,
  reason: f.reason,
  pagesEvaluated: [...f.pagesEvaluated],
});

const skipped = (s: SkippedUrl): SkippedUrl => ({ url: s.url, reason: s.reason, detail: s.detail });

const ruleMeta = (r: RuleMeta): RuleMeta => ({
  ruleId: r.ruleId,
  title: r.title,
  description: r.description,
  limitations: r.limitations,
  legalNote: r.legalNote,
});

const explanation = (x: ExplanationBlock): ExplanationBlock => ({
  source: x.source,
  model: x.model,
  items: x.items.map((i) => ({ ruleId: i.ruleId, text: i.text })),
  guardRejected: x.guardRejected,
});

function orderReport(r: Report): Report {
  return {
    schemaVersion: r.schemaVersion,
    tool: { name: r.tool.name, version: r.tool.version },
    rulesVersion: r.rulesVersion,
    generatedAt: r.generatedAt,
    target: { startUrl: r.target.startUrl, host: r.target.host },
    scope: {
      userAgent: r.scope.userAgent,
      pagesRequested: r.scope.pagesRequested,
      pagesChecked: r.scope.pagesChecked.map((p) => ({
        url: p.url,
        finalUrl: p.finalUrl,
        status: p.status,
        screenshot: p.screenshot,
        fetchedAt: p.fetchedAt,
      })),
      skipped: r.scope.skipped.map(skipped),
      robots: {
        url: r.scope.robots.url,
        fetched: r.scope.robots.fetched,
        status: r.scope.robots.status,
        crawlDelaySeconds: r.scope.robots.crawlDelaySeconds,
      },
      startBlocked: r.scope.startBlocked,
    },
    summary: { found: r.summary.found, not_found: r.summary.not_found, cannot_tell: r.summary.cannot_tell },
    findings: r.findings.map(finding),
    ruleCatalog: r.ruleCatalog.map(ruleMeta),
    explanation: r.explanation ? explanation(r.explanation) : undefined,
    disclaimer: r.disclaimer,
    limitations: [...r.limitations],
  };
}

/** Pretty-printed (2 spaces) JSON with a stable key order and a trailing newline. */
export function renderJson(report: Report): string {
  return `${JSON.stringify(orderReport(report), null, 2)}\n`;
}
