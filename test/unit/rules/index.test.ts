import { describe, expect, it } from 'vitest';
import { RULES_VERSION, RULE_CATALOG, runRules } from '../../../src/rules/index.js';
import type { CrawlResult, Finding } from '../../../src/types.js';
import { candidate, image, iframe, link, makeCrawl, makePage, markers, script } from './helpers.js';

const ORDER = ['CHAT-01', 'CHAT-02', 'MEDIA-01', 'MEDIA-02', 'PAGE-01'];
// Contract: findings must never use legal-conclusion wording.
const BANNED = /compliant|violat|illegal|unlawful|passes the|penalt|certified/i;

function richCrawl(): CrawlResult {
  return makeCrawl([
    makePage({
      screenshot: 'screenshots/page-1.png',
      scripts: [script('https://widget.intercom.io/widget/x')],
      domCandidates: [candidate({ id: 'intercom-container', text: 'Chat with our AI assistant' })],
      iframes: [iframe({ src: 'https://bot.landbot.io/x', accessible: true, text: 'You are chatting with a bot' })],
      images: [image({ markers: markers({ c2pa: true, aiToolHints: ['Midjourney'] }), alt: 'AI-generated art' }), image({ src: 'https://example.test/b.jpg', alt: 'Made with AI', markers: markers({ iptcDigitalSourceType: 'trainedAlgorithmicMedia' }) })],
      links: [link('https://example.test/ai-policy', 'AI policy')],
    }),
  ]);
}

function everyFindingText(findings: Finding[]): string[] {
  return [...findings.flatMap((f) => [f.title, f.summary]), ...RULE_CATALOG.flatMap((m) => [m.title, m.description, m.limitations, m.legalNote])];
}

describe('runRules', () => {
  it('exports the version and the catalog in contract order', () => {
    expect(RULES_VERSION).toBe('0.1.0');
    expect(RULE_CATALOG.map((m) => m.ruleId)).toEqual(ORDER);
    for (const meta of RULE_CATALOG) {
      expect(meta.limitations.length).toBeGreaterThan(20);
      expect(meta.description.length).toBeGreaterThan(20);
      expect(meta.legalNote).toMatch(/not legal advice/i);
    }
    expect(RULE_CATALOG.find((m) => m.ruleId === 'CHAT-02')?.legalNote).toMatch(/Art\. 50\(1\)/);
  });

  it('returns exactly one finding per rule in catalog order, with catalog titles', () => {
    for (const crawl of [richCrawl(), makeCrawl([makePage()]), makeCrawl([], { startBlocked: 'robots_disallow' })]) {
      const findings = runRules(crawl);
      expect(findings.map((f) => f.ruleId)).toEqual(ORDER);
      expect(findings.map((f) => f.title)).toEqual(RULE_CATALOG.map((m) => m.title));
    }
  });

  it('produces found for every rule on a rich page', () => {
    const findings = runRules(richCrawl());
    expect(findings.map((f) => f.outcome)).toEqual(['found', 'found', 'found', 'found', 'found']);
    for (const f of findings) {
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(f.evidence.some((e) => e.kind === 'screenshot')).toBe(true);
      expect(f.evidence.length).toBeLessThanOrEqual(20);
      for (const e of f.evidence) expect(e.capturedAt).toBe('2026-01-01T00:00:00.000Z');
    }
  });

  it('gives every found and not_found finding at least one evidence item, with url and timestamp', () => {
    const crawls = [
      richCrawl(),
      makeCrawl([makePage({ screenshot: 'screenshots/page-1.png', scripts: [script('https://widget.intercom.io/w')], domCandidates: [candidate({ id: 'intercom-container', text: 'Hello' })], images: [image({ markers: markers({ c2pa: true }) })] })]),
      makeCrawl([makePage({ screenshot: 'screenshots/page-1.png', images: [image()] })]),
    ];
    for (const crawl of crawls) {
      for (const f of runRules(crawl).filter((x) => x.outcome !== 'cannot_tell')) {
        expect(f.evidence.length, `${f.ruleId} ${f.outcome}`).toBeGreaterThan(0);
        expect(f.evidence.length).toBeLessThanOrEqual(20);
        for (const e of f.evidence) {
          expect(e.url).toMatch(/^https?:\/\//);
          expect(e.value).not.toBe('');
          expect(Date.parse(e.capturedAt)).not.toBeNaN();
        }
      }
    }
  });

  it('is deterministic and does not mutate its input', () => {
    const crawl = richCrawl();
    const before = JSON.stringify(crawl);
    const first = runRules(crawl);
    const second = runRules(crawl);
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(crawl)).toBe(before);
    expect(runRules(structuredClone(crawl))).toEqual(first);
  });

  it('never produces the banned legal-conclusion wording', () => {
    const crawls = [
      richCrawl(),
      makeCrawl([makePage()]),
      makeCrawl([], { startBlocked: 'robots_disallow' }),
      makeCrawl([], { startBlocked: 'private_address' }),
      makeCrawl([]),
      makeCrawl([makePage({ scripts: [script('https://widget.intercom.io/w')], images: [image({ markers: markers({ c2pa: true }) })] })]),
    ];
    for (const crawl of crawls) {
      for (const text of everyFindingText(runRules(crawl))) expect(text).not.toMatch(BANNED);
    }
  });

  it('never words a cannot_tell outcome as a pass', () => {
    const crawls = [
      makeCrawl([makePage({ scripts: [script('https://widget.intercom.io/w')] })]),
      makeCrawl([], { startBlocked: 'robots_disallow' }),
      makeCrawl([]),
    ];
    for (const crawl of crawls) {
      const cannotTell = runRules(crawl).filter((f) => f.outcome === 'cannot_tell');
      expect(cannotTell.length).toBeGreaterThan(0);
      for (const f of cannotTell) {
        expect(f.reason).toBeTruthy();
        expect(f.summary).toMatch(/not a pass|nothing to check/i);
        expect(f.summary).not.toMatch(/\b(passes|passed|ok|fine|good|safe|no issues?)\b/i);
      }
    }
  });

  it('summaries describe a chat widget, never an AI chatbot detection', () => {
    const findings = runRules(richCrawl());
    expect(findings[0]?.summary).toMatch(/chat widget detected/i);
    for (const f of findings) expect(f.summary).not.toMatch(/ai chatbot detected/i);
  });
});

describe('blocked and empty crawls', () => {
  it('robots disallow: every finding is cannot_tell/blocked_by_robots with no evidence', () => {
    const findings = runRules(makeCrawl([], { startBlocked: 'robots_disallow' }));
    for (const f of findings) {
      expect(f).toMatchObject({ outcome: 'cannot_tell', reason: 'blocked_by_robots', evidence: [], pagesEvaluated: [], needsHumanJudgement: false });
      expect(f.summary).toMatch(/robots\.txt/);
      expect(f.summary).toMatch(/not a pass/);
    }
  });

  it('startBlocked wins even if pages were somehow present', () => {
    const findings = runRules(makeCrawl([makePage({ scripts: [script('https://widget.intercom.io/w')] })], { startBlocked: 'robots_disallow' }));
    expect(findings.every((f) => f.outcome === 'cannot_tell' && f.reason === 'blocked_by_robots')).toBe(true);
  });

  it.each(['private_address', 'invalid_url', 'load_failed'] as const)('startBlocked %s: no_pages_loaded', (blocked) => {
    const findings = runRules(makeCrawl([], { startBlocked: blocked }));
    for (const f of findings) {
      expect(f).toMatchObject({ outcome: 'cannot_tell', reason: 'no_pages_loaded', evidence: [], pagesEvaluated: [] });
    }
  });

  it('no pages at all: no_pages_loaded', () => {
    const findings = runRules(makeCrawl([]));
    expect(findings.every((f) => f.outcome === 'cannot_tell' && f.reason === 'no_pages_loaded')).toBe(true);
  });

  it('pages that returned errors or no status are not evaluated', () => {
    const findings = runRules(makeCrawl([makePage({ status: 403 }), makePage({ url: 'https://example.test/b', status: null }), makePage({ url: 'https://example.test/c', status: 503 })]));
    expect(findings.every((f) => f.outcome === 'cannot_tell' && f.reason === 'no_pages_loaded')).toBe(true);
  });

  it('error pages are skipped but good pages are still evaluated', () => {
    const findings = runRules(makeCrawl([makePage({ status: 404, scripts: [script('https://widget.intercom.io/w')] }), makePage({ url: 'https://example.test/b', status: 200 })]));
    expect(findings[0]?.outcome).toBe('not_found');
    expect(findings[0]?.pagesEvaluated).toEqual(['https://example.test/b']);
  });

  it('redirects (3xx final status) are still evaluated', () => {
    const findings = runRules(makeCrawl([makePage({ status: 301 })]));
    expect(findings[0]?.outcome).toBe('not_found');
  });
});
