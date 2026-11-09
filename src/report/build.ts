import type { CrawlResult, ExplanationBlock, Finding, Report, RuleMeta } from '../types.js';
import { getVersion } from '../util/version.js';
import { DISCLAIMER, buildLimitations } from './disclaimer.js';

export interface ReportMeta {
  rulesVersion: string;
  ruleCatalog: RuleMeta[];
  pagesRequested: number;
  /** ISO timestamp; defaults to now. */
  generatedAt?: string;
  explanation?: ExplanationBlock;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function buildReport(crawl: CrawlResult, findings: Finding[], meta: ReportMeta): Report {
  const summary = { found: 0, not_found: 0, cannot_tell: 0 };
  for (const finding of findings) summary[finding.outcome] += 1;
  return {
    schemaVersion: 1,
    tool: { name: 'ai-act-check', version: getVersion() },
    rulesVersion: meta.rulesVersion,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    target: { startUrl: crawl.startUrl, host: hostOf(crawl.startUrl) },
    scope: {
      userAgent: crawl.userAgent,
      pagesRequested: meta.pagesRequested,
      pagesChecked: crawl.pages.map((p) => ({
        url: p.url,
        finalUrl: p.finalUrl,
        status: p.status,
        screenshot: p.screenshot,
        fetchedAt: p.fetchedAt,
      })),
      skipped: crawl.skipped,
      robots: crawl.robots,
      startBlocked: crawl.startBlocked,
    },
    summary,
    findings,
    ruleCatalog: meta.ruleCatalog,
    ...(meta.explanation ? { explanation: meta.explanation } : {}),
    disclaimer: DISCLAIMER,
    limitations: buildLimitations(meta.pagesRequested),
  };
}
