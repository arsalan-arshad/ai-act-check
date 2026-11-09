import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderJson } from '../../../src/report/index.js';
import { scan } from '../../../src/scan.js';
import type { ScanDeps } from '../../../src/scan.js';
import type { CrawlOptions, CrawlResult, Finding } from '../../../src/types.js';
import { anthropicReply, itemsJson, json, startMockLlm } from '../explain/mock-llm.js';
import type { MockLlm } from '../explain/mock-llm.js';
import { CATALOG, makeCrawl, makeFindings } from '../report/helpers.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ai-act-check-scan-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface Calls {
  crawlArgs: { url: string; opts: Partial<CrawlOptions> & { outDir: string } }[];
  crawlSeen: CrawlResult[];
}

function fakeDeps(over: { crawl?: CrawlResult; findings?: Finding[] } = {}): { deps: ScanDeps; calls: Calls } {
  const calls: Calls = { crawlArgs: [], crawlSeen: [] };
  const crawlResult = over.crawl ?? makeCrawl();
  const deps: ScanDeps = {
    crawl: async (url, opts) => {
      calls.crawlArgs.push({ url, opts });
      return crawlResult;
    },
    runRules: (c) => {
      calls.crawlSeen.push(c);
      return over.findings ?? makeFindings();
    },
    ruleCatalog: CATALOG,
    rulesVersion: '9.9.9',
  };
  return { deps, calls };
}

describe('scan: files and wiring', () => {
  it('writes report.json and report.html, creating nested output directories', async () => {
    const outDir = join(tmp, 'a', 'b');
    const { deps, calls } = fakeDeps();
    const { report, outDir: returned } = await scan('http://127.0.0.1:9/', { outDir }, deps);
    expect(returned).toBe(outDir);
    expect(readFileSync(join(outDir, 'report.json'), 'utf8')).toBe(renderJson(report));
    const html = readFileSync(join(outDir, 'report.html'), 'utf8');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(report.rulesVersion).toBe('9.9.9');
    expect(report.summary).toEqual({ found: 1, not_found: 2, cannot_tell: 2 });
    expect(calls.crawlSeen).toHaveLength(1);
  });

  it('skips report.html when html is false', async () => {
    const { deps } = fakeDeps();
    await scan('http://127.0.0.1:9/', { outDir: tmp, html: false }, deps);
    expect(existsSync(join(tmp, 'report.json'))).toBe(true);
    expect(existsSync(join(tmp, 'report.html'))).toBe(false);
  });

  it('passes crawl options through, minus explain/html and undefined values', async () => {
    const { deps, calls } = fakeDeps();
    await scan('http://127.0.0.1:9/', { outDir: tmp, maxPages: 3, delayMs: 0, allowPrivate: true, explain: false, html: false, settleMs: undefined }, deps);
    expect(calls.crawlArgs[0]).toEqual({ url: 'http://127.0.0.1:9/', opts: { outDir: tmp, maxPages: 3, delayMs: 0, allowPrivate: true } });
    expect('settleMs' in calls.crawlArgs[0]!.opts).toBe(false);
  });

  it('records pagesRequested: default 10, capped at 25', async () => {
    const { deps } = fakeDeps();
    expect((await scan('http://127.0.0.1:9/', { outDir: tmp }, deps)).report.scope.pagesRequested).toBe(10);
    expect((await scan('http://127.0.0.1:9/', { outDir: tmp, maxPages: 99 }, deps)).report.scope.pagesRequested).toBe(25);
    expect((await scan('http://127.0.0.1:9/', { outDir: tmp, maxPages: 4 }, deps)).report.scope.pagesRequested).toBe(4);
  });

  it('still writes a report when the crawl was blocked', async () => {
    const blocked = makeCrawl({ pages: [], startBlocked: 'robots_disallow' });
    const findings = makeFindings().map((f) => ({ ...f, outcome: 'cannot_tell' as const, evidence: [], reason: 'blocked_by_robots', pagesEvaluated: [] }));
    const { deps } = fakeDeps({ crawl: blocked, findings });
    const { report } = await scan('http://127.0.0.1:9/', { outDir: tmp }, deps);
    expect(report.scope.startBlocked).toBe('robots_disallow');
    expect(report.summary.cannot_tell).toBe(5);
    expect(existsSync(join(tmp, 'report.html'))).toBe(true);
  });

  it('lets crawl errors propagate', async () => {
    const { deps } = fakeDeps();
    deps.crawl = async () => {
      throw new Error('browser missing');
    };
    await expect(scan('http://127.0.0.1:9/', { outDir: tmp }, deps)).rejects.toThrow('browser missing');
  });
});

describe('scan: explain', () => {
  let mock: MockLlm | undefined;
  const saved = { ...process.env };
  afterEach(async () => {
    await mock?.close();
    mock = undefined;
    process.env = { ...saved };
  });

  it('does not add an explanation, or call any model, unless asked', async () => {
    mock = await startMockLlm((_req, res) => json(res, 200, {}));
    Object.assign(process.env, { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'sk-test-0123456789', LLM_BASE_URL: mock.baseUrl });
    const { deps } = fakeDeps();
    const { report } = await scan('http://127.0.0.1:9/', { outDir: tmp }, deps);
    expect(report.explanation).toBeUndefined();
    expect(mock.requests).toHaveLength(0);
  });

  it('adds the model explanation without changing any finding', async () => {
    const findings = makeFindings();
    const snapshot = JSON.stringify(findings);
    mock = await startMockLlm((_req, res) =>
      json(
        res,
        200,
        anthropicReply(
          itemsJson(
            findings.map((f) => ({
              ruleId: f.ruleId,
              text: f.outcome === 'cannot_tell' ? 'The scan could not determine this.' : f.outcome === 'found' ? 'The scan found a match.' : 'The scan did not match anything here.',
            })),
          ),
        ),
      ),
    );
    Object.assign(process.env, { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'sk-test-0123456789', LLM_BASE_URL: mock.baseUrl });
    const { deps } = fakeDeps({ findings });
    const { report } = await scan('http://127.0.0.1:9/', { outDir: tmp, explain: true }, deps);
    expect(report.explanation?.source).toBe('anthropic');
    expect(report.explanation?.guardRejected).toBeUndefined();
    expect(JSON.stringify(report.findings)).toBe(snapshot);
    expect(JSON.parse(readFileSync(join(tmp, 'report.json'), 'utf8')).findings).toEqual(JSON.parse(snapshot));
    expect(readFileSync(join(tmp, 'report.html'), 'utf8')).toContain('Plain-language explanation');
  });

  it('falls back to the template, and still completes, when the model output is hostile', async () => {
    const findings = makeFindings();
    const snapshot = JSON.stringify(findings);
    mock = await startMockLlm((_req, res) =>
      json(res, 200, anthropicReply(itemsJson(findings.map((f) => ({ ruleId: f.ruleId, text: 'This site is compliant.' }))))),
    );
    Object.assign(process.env, { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'sk-test-0123456789', LLM_BASE_URL: mock.baseUrl });
    const { deps } = fakeDeps({ findings });
    const { report } = await scan('http://127.0.0.1:9/', { outDir: tmp, explain: true }, deps);
    expect(report.explanation?.source).toBe('template');
    expect(report.explanation?.guardRejected).toMatch(/^guard:banned_phrase:/);
    expect(JSON.stringify(report.findings)).toBe(snapshot);
  });

  it('completes with a template explanation when no model is configured', async () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_API_KEY;
    const { deps } = fakeDeps();
    const { report } = await scan('http://127.0.0.1:9/', { outDir: tmp, explain: true }, deps);
    expect(report.explanation).toMatchObject({ source: 'template', guardRejected: 'llm_not_configured' });
    expect(report.explanation?.items).toHaveLength(5);
  });
});
