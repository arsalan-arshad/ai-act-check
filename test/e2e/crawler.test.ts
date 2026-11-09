// Crawl behaviour observed from the outside: what the fixture server saw, and what the report says.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeImageFixtures } from '../fixtures/images.js';
import { mazeHandlers } from '../fixtures/maze.js';
import { type FixtureServer, type FixtureServerOptions, hang, html, page, redirect, startFixtureServer } from '../fixtures/server.js';
import { cleanupTmp, normalize, scanUrl } from './helpers.js';
import { expectCompletedScan } from './invariants.js';

beforeAll(() => writeImageFixtures());
afterAll(cleanupTmp);

async function withServer<T>(source: Parameters<typeof startFixtureServer>[0], fn: (s: FixtureServer) => Promise<T>, opts: FixtureServerOptions = {}): Promise<T> {
  const s = await startFixtureServer(source, opts);
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

describe('robots.txt', () => {
  it('requests /robots.txt first and never touches a disallowed path', async () => {
    await withServer('robots-private', async (s) => {
      const run = await scanUrl(s.url('/'));
      expectCompletedScan(run, s);
      const paths = s.log.map((e) => e.path);
      expect(paths[0]).toBe('/robots.txt');
      expect(paths.filter((p) => p.startsWith('/private/')), 'disallowed paths must not be requested').toEqual([]);
      expect(paths).toContain('/public.html');
      const urls = run.report!.scope.pagesChecked.map((p) => p.finalUrl);
      expect(urls.some((u) => u.includes('/private/'))).toBe(false);
      expect(run.report!.scope.skipped.some((k) => k.reason === 'robots_disallow' && k.url.includes('/private/')), 'disallowed links are recorded as skipped').toBe(true);
      expect(run.report!.scope.robots.fetched).toBe(true);
      expect(run.report!.scope.robots.status).toBe(200);
    });
  });

  it('group for our product token (ai-act-check) wins over *: allowed when ai-act-check is allowed', async () => {
    await withServer('robots-ua-allow', async (s) => {
      const run = await scanUrl(s.url('/'));
      expect(run.code, run.stderr).toBe(0);
      expect(run.report!.scope.pagesChecked).toHaveLength(1);
    });
  });

  it('group for our product token wins over *: blocked when ai-act-check is disallowed', async () => {
    await withServer('robots-ua-block', async (s) => {
      const run = await scanUrl(s.url('/'));
      expect(run.code).toBe(3);
      expect(s.documentRequests()).toHaveLength(0);
      expect(run.report?.scope.startBlocked).toBe('robots_disallow');
    });
  });

  it('Crawl-delay: 1 spaces page loads at least ~1s apart even with --delay-ms 0', async () => {
    await withServer('robots-crawl-delay', async (s) => {
      const run = await scanUrl(s.url('/'), ['--delay-ms', '0']);
      expectCompletedScan(run, s);
      expect(run.report!.scope.robots.crawlDelaySeconds).toBe(1);
      const docs = s.documentRequests().map((e) => e.t);
      expect(docs.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < docs.length; i++) {
        expect((docs[i] as number) - (docs[i - 1] as number), `gap before page load #${i + 1}`).toBeGreaterThanOrEqual(900);
      }
    });
  });

  it('--delay-ms is honoured as a minimum gap between page loads', async () => {
    await withServer('no-chat', async (s) => {
      const run = await scanUrl(s.url('/'), ['--delay-ms', '500']);
      expectCompletedScan(run, s);
      const docs = s.documentRequests().map((e) => e.t);
      expect(docs.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < docs.length; i++) {
        expect((docs[i] as number) - (docs[i - 1] as number), `gap before page load #${i + 1}`).toBeGreaterThanOrEqual(450);
      }
    });
  });
});

describe('identity', () => {
  it('every request (pages, sub-resources, robots, images) carries the honest User-Agent', async () => {
    await withServer('media-c2pa-labelled-caption', async (s) => {
      const run = await scanUrl(s.url('/'));
      expectCompletedScan(run, s);
      const ua = run.report!.scope.userAgent;
      expect(ua).toMatch(/^ai-act-check\/\d+\.\d+\.\d+ \(.*\)/);
      for (const e of s.log) expect(e.userAgent, e.path).toBe(ua);
      expect(run.stderr).toContain(ua);
    });
  });

  it('inspects image bytes with a Range request (never the whole file by design)', async () => {
    await withServer('media-c2pa-labelled-caption', async (s) => {
      const run = await scanUrl(s.url('/'));
      expect(run.code).toBe(0);
      const imgHits = s.log.filter((e) => e.path === '/img/c2pa.png');
      expect(imgHits.length).toBeGreaterThan(0);
      expect(imgHits.some((e) => e.range !== null && /^bytes=0-\d+$/.test(e.range)), 'a Range: bytes=0-N request for the image').toBe(true);
    });
  });
});

describe('page budget (--pages / maxPages)', () => {
  for (const n of [1, 3, 5]) {
    it(`--pages ${n} loads exactly ${n} pages of a 30-page maze`, async () => {
      await withServer(mazeHandlers(30), async (s) => {
        const run = await scanUrl(s.url('/'), ['--pages', String(n)]);
        expectCompletedScan(run, s);
        expect(run.report!.scope.pagesRequested).toBe(n);
        expect(run.report!.scope.pagesChecked).toHaveLength(n);
        expect(s.documentRequests(), 'no page may be fetched beyond the budget').toHaveLength(n);
      });
    });
  }

  it('default budget is 10 pages', async () => {
    await withServer(mazeHandlers(30), async (s) => {
      const run = await scanUrl(s.url('/'));
      expectCompletedScan(run, s);
      expect(run.report!.scope.pagesRequested).toBe(10);
      expect(run.report!.scope.pagesChecked).toHaveLength(10);
      expect(s.documentRequests()).toHaveLength(10);
    });
  }, 120000);

  it('--pages 25 (the hard cap) loads at most 25 pages', async () => {
    await withServer(mazeHandlers(30), async (s) => {
      const run = await scanUrl(s.url('/'), ['--pages', '25', '--settle-ms', '100']);
      expectCompletedScan(run, s);
      expect(run.report!.scope.pagesChecked).toHaveLength(25);
      expect(s.documentRequests().length).toBeLessThanOrEqual(25);
    });
  }, 180000);

  it('a site smaller than the budget stops early without errors', async () => {
    await withServer('no-chat', async (s) => {
      const run = await scanUrl(s.url('/'), ['--pages', '20']);
      expectCompletedScan(run, s);
      expect(run.report!.scope.pagesChecked.length).toBe(3);
    });
  });

  it('never loads the same page twice (fragments and duplicates are collapsed)', async () => {
    const dupes = {
      '/': html(page('Dup', '<a href="/a.html#x">a1</a> <a href="/a.html#y">a2</a> <a href="/a.html">a3</a> <a href="/">self</a>')),
      '/a.html': html(page('A', '<a href="/">home</a>')),
    };
    await withServer(dupes, async (s) => {
      const run = await scanUrl(s.url('/'));
      expectCompletedScan(run, s);
      expect(s.documentRequests().map((e) => e.path).sort()).toEqual(['/', '/a.html']);
    });
  });
});

describe('same-site filter and redirects', () => {
  it('does not follow off-site links, and does not follow a redirect to another host', async () => {
    const other = await startFixtureServer('offsite-target');
    try {
      await withServer('offsite-links', async (s) => {
        const run = await scanUrl(s.url('/'));
        expectCompletedScan(run, s);
        expect(other.log, 'the other host must never be contacted').toHaveLength(0);
        for (const p of run.report!.scope.pagesChecked) {
          expect(p.finalUrl.startsWith(s.origin), `${p.finalUrl} must stay on the scanned site`).toBe(true);
        }
      }, {
        vars: { OFFSITE_ORIGIN: other.origin.replace('127.0.0.1', 'localhost') },
        handlers: { '/go-out': redirect(`${other.origin.replace('127.0.0.1', 'localhost')}/landing.html`) },
      });
    } finally {
      await other.close();
    }
  });

  it('follows a same-site redirect and reports the final URL', async () => {
    await withServer('offsite-links', async (s) => {
      const run = await scanUrl(s.url('/'));
      expectCompletedScan(run, s);
      const hit = run.report!.scope.pagesChecked.find((p) => p.finalUrl.endsWith('/new.html'));
      expect(hit, 'the /old -> /new.html redirect target was checked').toBeDefined();
      expect(hit!.url).toMatch(/\/old$|\/new\.html$/);
    }, { vars: { OFFSITE_ORIGIN: 'http://localhost:9' }, handlers: { '/old': redirect('/new.html', 301), '/go-out': { status: 404, body: 'x' } } });
  });

  it('a start URL that redirects to another host is not followed there', async () => {
    const other = await startFixtureServer('offsite-target');
    try {
      await withServer('no-chat', async (s) => {
        const run = await scanUrl(s.url('/start'));
        expect([0, 3], `exit ${run.code}: ${run.stderr}`).toContain(run.code);
        expect(other.log, 'the other host must never be contacted').toHaveLength(0);
        expect(run.report?.scope.pagesChecked.some((p) => p.finalUrl.includes('/landing.html')) ?? false).toBe(false);
      }, { handlers: { '/start': redirect(`${other.origin.replace('127.0.0.1', 'localhost')}/landing.html`) } });
    } finally {
      await other.close();
    }
  });
});

describe('passive behaviour: no clicks, no form submits, no downloads', () => {
  it('never submits forms, clicks buttons, or requests download links', async () => {
    await withServer('forms-and-clicks', async (s) => {
      const run = await scanUrl(s.url('/'));
      expectCompletedScan(run, s);
      const paths = s.log.map((e) => e.path);
      expect(paths.filter((p) => p.startsWith('/submit')), 'form must not be submitted').toEqual([]);
      expect(paths.filter((p) => p.startsWith('/clicked')), 'button must not be clicked').toEqual([]);
      expect(paths.filter((p) => p.startsWith('/files/')), 'pdf/zip links must not be fetched').toEqual([]);
      expect(s.log.filter((e) => e.method !== 'GET' && e.method !== 'HEAD'), 'only read-only requests').toEqual([]);
    });
  });

  it('skips non-HTML pages found via links without fetching obvious binaries, records non_html', async () => {
    const handlers = {
      '/': html(page('Home', '<a href="/data">data</a> <a href="/about.html">about</a> <a href="/x.pdf">pdf</a>')),
      '/about.html': html(page('About', '<p>about</p>')),
      '/data': { body: '{"a":1}', headers: { 'content-type': 'application/json' } },
      '/x.pdf': { body: '%PDF-1.4', headers: { 'content-type': 'application/pdf' } },
    };
    await withServer(handlers, async (s) => {
      const run = await scanUrl(s.url('/'));
      expectCompletedScan(run, s);
      expect(run.report!.scope.pagesChecked.map((p) => p.finalUrl).sort()).toEqual([s.url('/'), s.url('/about.html')].sort());
      expect(run.report!.scope.skipped.some((k) => k.reason === 'non_html' && k.url.endsWith('/data'))).toBe(true);
      expect(s.log.map((e) => e.path)).not.toContain('/x.pdf');
    });
  });

  it('survives a hanging sub-page: records load_failed and keeps going', async () => {
    const handlers = {
      '/': html(page('Home', '<a href="/hang">hang</a> <a href="/about.html">about</a>')),
      '/about.html': html(page('About', '<p>about</p>')),
      '/hang': hang(),
    };
    await withServer(handlers, async (s) => {
      const t0 = Date.now();
      const run = await scanUrl(s.url('/'), ['--timeout-ms', '1500']);
      expectCompletedScan(run, s);
      expect(Date.now() - t0).toBeLessThan(45000);
      expect(run.report!.scope.pagesChecked.map((p) => p.finalUrl)).toContain(s.url('/about.html'));
      expect(run.report!.scope.pagesChecked.some((p) => p.finalUrl.endsWith('/hang'))).toBe(false);
      expect(run.report!.scope.skipped.some((k) => k.reason === 'load_failed' && k.url.endsWith('/hang'))).toBe(true);
    });
  });
});

describe('determinism and speed', () => {
  it('two scans of the same fixture produce identical findings (timestamps and ports stripped)', async () => {
    const a = await startFixtureServer('chat-no-disclosure');
    const b = await startFixtureServer('chat-no-disclosure');
    try {
      const r1 = await scanUrl(a.url('/'));
      const r2 = await scanUrl(a.url('/'));
      const r3 = await scanUrl(b.url('/'));
      for (const r of [r1, r2, r3]) expect(r.code, r.stderr).toBe(0);
      const pick = (r: typeof r1) => JSON.stringify(normalize({ findings: r.report!.findings, summary: r.report!.summary, pages: r.report!.scope.pagesChecked.map((p) => [p.url, p.finalUrl, p.status, p.screenshot]), skipped: r.report!.scope.skipped, catalog: r.report!.ruleCatalog }));
      expect(pick(r2)).toBe(pick(r1));
      expect(pick(r3)).toBe(pick(r1));
      expect(JSON.stringify(normalize(r2.report!.findings))).toBe(JSON.stringify(normalize(r1.report!.findings)));
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('scanning a 3-page fixture with default timing finishes within 60s', async () => {
    await withServer('no-chat', async (s) => {
      const run = await scanUrl(s.url('/'), [], { base: ['--allow-private'] });
      expectCompletedScan(run, s);
      expect(run.report!.scope.pagesChecked).toHaveLength(3);
      expect(run.durationMs, `took ${run.durationMs}ms`).toBeLessThan(60000);
    });
  }, 90000);
});
