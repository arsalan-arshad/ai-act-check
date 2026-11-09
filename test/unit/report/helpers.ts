import { buildReport } from '../../../src/report/index.js';
import type { CrawlResult, Finding, PageSnapshot, Report, RuleMeta } from '../../../src/types.js';

export const NOW = '2026-01-02T03:04:05.000Z';

export function makePage(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: 'http://127.0.0.1:9/',
    finalUrl: 'http://127.0.0.1:9/',
    status: 200,
    fetchedAt: NOW,
    title: 'Home',
    lang: 'en',
    html: '<html></html>',
    text: 'hello',
    scripts: [],
    iframes: [],
    links: [],
    images: [],
    domCandidates: [],
    headers: {},
    screenshot: 'screenshots/page-1.png',
    loadErrors: [],
    ...overrides,
  };
}

export function makeCrawl(overrides: Partial<CrawlResult> = {}): CrawlResult {
  return {
    startUrl: 'http://127.0.0.1:9/',
    pages: [makePage()],
    skipped: [{ url: 'http://127.0.0.1:9/private', reason: 'robots_disallow' }],
    robots: { url: 'http://127.0.0.1:9/robots.txt', fetched: true, status: 200, crawlDelaySeconds: null },
    startBlocked: null,
    userAgent: 'ai-act-check/0.1.0 (open-source technical scanner; not legal advice)',
    startedAt: NOW,
    finishedAt: NOW,
    ...overrides,
  };
}

export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'CHAT-01',
    title: 'Chat widget detected',
    outcome: 'found',
    evidence: [{ url: 'http://127.0.0.1:9/', kind: 'script', value: 'http://127.0.0.1:9/widget.js', capturedAt: NOW }],
    needsHumanJudgement: false,
    summary: 'Chat widget detected: ExampleChat.',
    pagesEvaluated: ['http://127.0.0.1:9/'],
    ...overrides,
  };
}

/** One finding of each outcome, across five rule ids in catalog order. */
export function makeFindings(): Finding[] {
  return [
    makeFinding(),
    makeFinding({
      ruleId: 'CHAT-02',
      title: 'AI disclosure text near a chat widget',
      outcome: 'not_found',
      evidence: [],
      needsHumanJudgement: true,
      summary: 'A chat widget UI text was inspected and no disclosure phrase matched.',
    }),
    makeFinding({
      ruleId: 'MEDIA-01',
      title: 'AI-generation metadata on images',
      outcome: 'cannot_tell',
      evidence: [],
      summary: 'No image could be read.',
      reason: 'no_images_readable',
    }),
    makeFinding({
      ruleId: 'MEDIA-02',
      title: 'Visible AI label near flagged images',
      outcome: 'cannot_tell',
      evidence: [],
      summary: 'Nothing to check: no flagged images.',
      reason: 'no_flagged_images',
    }),
    makeFinding({
      ruleId: 'PAGE-01',
      title: 'AI use / transparency page link',
      outcome: 'not_found',
      evidence: [],
      needsHumanJudgement: true,
      summary: 'No such link on the crawled pages.',
    }),
  ];
}

export const CATALOG: RuleMeta[] = makeFindings().map((f) => ({
  ruleId: f.ruleId,
  title: f.title,
  description: `Looks for ${f.ruleId}.`,
  limitations: 'Outside-in only.',
  legalNote: 'Possibly related to Art. 50 AI Act; unverified. Not legal advice.',
}));

export function makeReport(findings: Finding[] = makeFindings(), crawl: CrawlResult = makeCrawl()): Report {
  return buildReport(crawl, findings, { rulesVersion: '0.1.0', ruleCatalog: CATALOG, pagesRequested: 10, generatedAt: NOW });
}
