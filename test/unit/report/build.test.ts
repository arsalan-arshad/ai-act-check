import { describe, expect, it } from 'vitest';
import { DISCLAIMER, buildLimitations, buildReport, renderJson } from '../../../src/report/index.js';
import { getVersion } from '../../../src/util/version.js';
import { CATALOG, NOW, makeCrawl, makeFinding, makeFindings, makeReport } from './helpers.js';

describe('buildReport', () => {
  it('counts outcomes in the summary', () => {
    const report = makeReport();
    expect(report.summary).toEqual({ found: 1, not_found: 2, cannot_tell: 2 });
  });

  it('counts zero for an empty findings list', () => {
    expect(makeReport([]).summary).toEqual({ found: 0, not_found: 0, cannot_tell: 0 });
  });

  it('fills tool, scope and fixed texts', () => {
    const report = makeReport();
    expect(report.schemaVersion).toBe(1);
    expect(report.tool).toEqual({ name: 'ai-act-check', version: getVersion() });
    expect(report.rulesVersion).toBe('0.1.0');
    expect(report.target).toEqual({ startUrl: 'http://127.0.0.1:9/', host: '127.0.0.1:9' });
    expect(report.scope.pagesRequested).toBe(10);
    expect(report.scope.pagesChecked).toEqual([
      { url: 'http://127.0.0.1:9/', finalUrl: 'http://127.0.0.1:9/', status: 200, screenshot: 'screenshots/page-1.png', fetchedAt: NOW },
    ]);
    expect(report.scope.skipped).toHaveLength(1);
    expect(report.scope.startBlocked).toBeNull();
    expect(report.disclaimer).toBe(DISCLAIMER);
    expect(report.limitations).toEqual(buildLimitations(10));
    expect(report.ruleCatalog).toEqual(CATALOG);
    expect(report.explanation).toBeUndefined();
  });

  it('does not keep page text or html in the report', () => {
    const crawl = makeCrawl();
    crawl.pages[0]!.text = 'SECRET-PAGE-TEXT';
    expect(JSON.stringify(buildReport(crawl, makeFindings(), { rulesVersion: '0.1.0', ruleCatalog: CATALOG, pagesRequested: 3 }))).not.toContain(
      'SECRET-PAGE-TEXT',
    );
  });

  it('includes an explanation block only when given', () => {
    const explanation = { source: 'template' as const, items: [{ ruleId: 'CHAT-01', text: 'x' }] };
    const report = buildReport(makeCrawl(), makeFindings(), { rulesVersion: '0.1.0', ruleCatalog: CATALOG, pagesRequested: 10, explanation });
    expect(report.explanation).toEqual(explanation);
  });

  it('falls back to the raw start URL as host when it is not parseable', () => {
    expect(makeReport(makeFindings(), makeCrawl({ startUrl: 'not a url', startBlocked: 'invalid_url', pages: [] })).target.host).toBe('not a url');
  });

  it('mentions the page limit in the limitations and covers the required topics', () => {
    const text = buildLimitations(7).join('\n');
    expect(text).toContain('At most 7 pages');
    for (const topic of [/shadow DOM/i, /after it is opened/i, /absence of AI-related image metadata/i, /staffed by people/i, /adequate/i, /best-effort/i]) {
      expect(text).toMatch(topic);
    }
  });

  it('keeps the disclaimer free of verdict wording and states the required points', () => {
    expect(DISCLAIMER).toMatch(/not legal advice/i);
    expect(DISCLAIMER).toMatch(/not a certification/i);
    expect(DISCLAIMER).toMatch(/best-practice indicators/);
    expect(DISCLAIMER).toMatch(/Cannot tell.*must not be read as a pass/);
    expect(DISCLAIMER).toMatch(/Pages checked/);
    expect(DISCLAIMER).toMatch(/qualified legal counsel/);
    expect(DISCLAIMER).not.toMatch(/compliant|violat|illegal|passes/i);
  });
});

describe('renderJson', () => {
  it('uses a fixed key order regardless of input key order', () => {
    const report = makeReport();
    const shuffled = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(shuffled).reverse());
    const finding = (reversed.findings as Record<string, unknown>[])[0]!;
    (reversed.findings as unknown[])[0] = Object.fromEntries(Object.entries(finding).reverse());
    const a = renderJson(report);
    const b = renderJson(reversed as unknown as typeof report);
    expect(b).toBe(a);
    expect(Object.keys(JSON.parse(a) as object)).toEqual([
      'schemaVersion', 'tool', 'rulesVersion', 'generatedAt', 'target', 'scope', 'summary', 'findings', 'ruleCatalog', 'disclaimer', 'limitations',
    ]);
    const first = (JSON.parse(a) as { findings: Record<string, unknown>[] }).findings[0]!;
    expect(Object.keys(first)).toEqual(['ruleId', 'title', 'outcome', 'evidence', 'needsHumanJudgement', 'summary', 'pagesEvaluated']);
    expect(Object.keys((first.evidence as object[])[0]!)).toEqual(['url', 'kind', 'value', 'capturedAt']);
  });

  it('places reason after summary and the explanation before the disclaimer', () => {
    const report = makeReport();
    report.explanation = { source: 'anthropic', model: 'm', items: [{ ruleId: 'CHAT-01', text: 't' }], guardRejected: 'x' };
    const parsed = JSON.parse(renderJson(report)) as Record<string, unknown>;
    expect(Object.keys(parsed).slice(-3)).toEqual(['explanation', 'disclaimer', 'limitations']);
    expect(Object.keys(parsed.explanation as object)).toEqual(['source', 'model', 'items', 'guardRejected']);
    const cannotTell = (parsed.findings as Record<string, unknown>[])[2]!;
    expect(Object.keys(cannotTell)).toEqual(['ruleId', 'title', 'outcome', 'evidence', 'needsHumanJudgement', 'summary', 'reason', 'pagesEvaluated']);
  });

  it('is 2-space indented, newline-terminated, and round-trips', () => {
    const report = makeReport();
    const json = renderJson(report);
    expect(json.startsWith('{\n  "schemaVersion": 1,')).toBe(true);
    expect(json.endsWith('}\n')).toBe(true);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(report)));
  });

  it('is deterministic', () => {
    expect(renderJson(makeReport())).toBe(renderJson(makeReport()));
  });

  it('omits undefined optional fields instead of writing null', () => {
    const parsed = JSON.parse(renderJson(makeReport([makeFinding()]))) as { findings: object[] };
    expect('reason' in parsed.findings[0]!).toBe(false);
    expect('explanation' in parsed).toBe(false);
  });
});
