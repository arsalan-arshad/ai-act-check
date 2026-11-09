import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { explainFindings } from './explain/index.js';
import { templateExplanation } from './explain/template.js';
import { buildReport, renderHtml, renderJson } from './report/index.js';
import { DEFAULT_CRAWL_OPTIONS } from './types.js';
import type { CrawlOptions, CrawlResult, ExplanationBlock, Finding, Report, RuleMeta, ScanOptions } from './types.js';
import { deepFreeze } from './util/freeze.js';

export type CrawlFn = (startUrl: string, opts: Partial<CrawlOptions> & { outDir: string }) => Promise<CrawlResult>;
export type RunRulesFn = (crawl: CrawlResult) => Finding[];

/** Injection points for tests. Anything omitted is loaded lazily from the real modules. */
export interface ScanDeps {
  crawl?: CrawlFn;
  runRules?: RunRulesFn;
  ruleCatalog?: RuleMeta[];
  rulesVersion?: string;
}

export interface ScanRunOptions extends ScanOptions {
  /** Write report.html next to report.json. Default true. */
  html?: boolean;
}

const HARD_PAGE_CAP = 25;

async function resolveDeps(deps: ScanDeps): Promise<Required<ScanDeps>> {
  const crawl = deps.crawl ?? (await import('./crawler/index.js')).crawl;
  if (deps.runRules && deps.ruleCatalog && deps.rulesVersion !== undefined) {
    return { crawl, runRules: deps.runRules, ruleCatalog: deps.ruleCatalog, rulesVersion: deps.rulesVersion };
  }
  const rules = await import('./rules/index.js');
  return {
    crawl,
    runRules: deps.runRules ?? rules.runRules,
    ruleCatalog: deps.ruleCatalog ?? rules.RULE_CATALOG,
    rulesVersion: deps.rulesVersion ?? rules.RULES_VERSION,
  };
}

/** Keys explicitly set to undefined would override the crawler's defaults when spread, so drop them. */
function definedOnly<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

async function explainSafely(findings: Finding[]): Promise<ExplanationBlock> {
  // The explainer gets a frozen copy: it cannot alter the findings the report is built from.
  const readOnly = deepFreeze(structuredClone(findings));
  try {
    return await explainFindings(readOnly);
  } catch {
    return { source: 'template', items: templateExplanation(readOnly), guardRejected: 'unexpected_error' };
  }
}

/** Crawl, run the rules, optionally explain, and write report.json (and report.html) into opts.outDir. */
export async function scan(url: string, opts: ScanRunOptions, deps: ScanDeps = {}): Promise<{ report: Report; outDir: string }> {
  const { explain, html, ...crawlOpts } = definedOnly(opts);
  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });

  const { crawl, runRules, ruleCatalog, rulesVersion } = await resolveDeps(deps);
  const crawlResult = await crawl(url, { ...crawlOpts, outDir });
  const findings = runRules(crawlResult);
  const explanation = explain ? await explainSafely(findings) : undefined;

  const pagesRequested = Math.min(opts.maxPages ?? DEFAULT_CRAWL_OPTIONS.maxPages, HARD_PAGE_CAP);
  const report = buildReport(crawlResult, findings, { rulesVersion, ruleCatalog, pagesRequested, explanation });

  writeFileSync(join(outDir, 'report.json'), renderJson(report));
  if (html !== false) writeFileSync(join(outDir, 'report.html'), renderHtml(report));
  return { report, outDir };
}
