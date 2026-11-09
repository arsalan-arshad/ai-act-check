import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CrawlResult } from '../../../src/types.js';
import { cleanupTempDirs, fastCrawl, pathsRequested } from './helpers.js';
import { html, startServer, type TestServer } from './server.js';

const urls = (result: CrawlResult): string[] => result.pages.map((p) => new URL(p.url).pathname);
const skippedBy = (result: CrawlResult, reason: string): string[] =>
  result.skipped.filter((s) => s.reason === reason).map((s) => new URL(s.url).pathname);

describe('crawl: link discovery, robots and skipping', () => {
  let site: TestServer;
  let other: TestServer;
  let result: CrawlResult;

  beforeAll(async () => {
    other = await startServer({ '/': html('<p>Other site</p>') });
    site = await startServer({
      '/robots.txt': {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: 'User-agent: *\nDisallow: /everything\n\nUser-agent: ai-act-check\nDisallow: /private\nDisallow: /*.secret$\nAllow: /private/open\n',
      },
      '/': (_req, origin) =>
        html(`
          <a href="/about#team">About</a>
          <a href="/about">About again</a>
          <a href="/privacy">Privacy</a>
          <a href="/contact">Contact</a>
          <a href="/deep/a/b/c/d">Deep</a>
          <a href="/private/page">Private</a>
          <a href="/private/open">Private but allowed</a>
          <a href="/files/report.secret">Secret file</a>
          <a href="/everything">Everything (only the wildcard group disallows)</a>
          <a href="/doc.pdf">PDF</a>
          <a href="/photo.jpg">JPG</a>
          <a href="mailto:a@example.test">mail</a>
          <a href="tel:+123">tel</a>
          <a href="${other.origin}/">Other site by IP:port</a>
          <a href="${origin.replace('127.0.0.1', 'localhost')}/">Same server, different host name</a>
          <a href="/api/data">API json</a>
          <a href="/download">Download</a>
          <a href="/missing">Missing</a>
          <a href="/broken">Server error</a>
          <a href="/redirect-me">Redirect</a>
          <a href="/go-private">Redirects into a disallowed path</a>
          <a href="/alert-page">Alert page</a>
        `),
      '/about': html('<p>About page</p><a href="/about/team">Team</a>', { title: 'About' }),
      '/privacy': html('<p>Privacy page</p>', { title: 'Privacy' }),
      '/contact': html('<p>Contact page</p>', { title: 'Contact' }),
      '/deep/a/b/c/d': html('<p>Deep page</p>'),
      '/about/team': html('<p>Team page</p>'),
      '/private/page': html('<p>must never be requested</p>'),
      '/private/open': html('<p>Allowed by longest match</p>'),
      '/private/secret-target': html('<p>must never be requested</p>'),
      '/files/report.secret': html('<p>must never be requested</p>'),
      '/everything': html('<p>Allowed for us: the ai-act-check group wins over *</p>'),
      '/api/data': { status: 200, headers: { 'content-type': 'application/json' }, body: '{"a":1}' },
      '/download': { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename=a.pdf' }, body: '%PDF-1.4' },
      '/broken': { status: 500, headers: { 'content-type': 'text/html' }, body: '<p>boom</p>' },
      '/redirect-me': { status: 302, headers: { location: '/about-redirected' } },
      '/about-redirected': html('<p>Redirect target</p>', { title: 'Redirected' }),
      '/go-private': { status: 302, headers: { location: '/private/secret-target' } },
      '/alert-page': html('<p>Alert page</p><script>alert("x")</script>'),
    });
    ({ result } = await fastCrawl(`${site.origin}/`, { maxPages: 25 }));
  });
  afterAll(async () => {
    await Promise.all([site.close(), other.close()]);
    await cleanupTempDirs();
  });

  it('crawls same-site HTML pages starting with the start page', () => {
    expect(result.startBlocked).toBeNull();
    expect(urls(result)[0]).toBe('/');
    expect(urls(result)).toEqual(expect.arrayContaining(['/about', '/privacy', '/contact', '/deep/a/b/c/d', '/about/team', '/alert-page', '/everything', '/private/open']));
  });

  it('loads each page once even when linked with a fragment or several times', () => {
    const aboutLoads = site.requests.filter((r) => r.url === '/about');
    expect(aboutLoads).toHaveLength(1);
    expect(new Set(urls(result)).size).toBe(result.pages.length);
  });

  it('uses the product-token group of robots.txt over the wildcard group', () => {
    expect(urls(result)).toContain('/everything');
  });

  it('honours Disallow, wildcard-anchored patterns and Allow precedence, recording robots_disallow', () => {
    expect(skippedBy(result, 'robots_disallow').sort()).toEqual(['/files/report.secret', '/go-private', '/private/page']);
    const requested = pathsRequested(site.requests);
    expect(requested).not.toContain('/private/page');
    expect(requested).not.toContain('/files/report.secret');
    expect(requested).not.toContain('/private/secret-target');
    expect(urls(result)).toContain('/private/open');
  });

  it('vets every redirect hop against robots.txt before requesting it', () => {
    const skip = result.skipped.find((s) => new URL(s.url).pathname === '/go-private');
    expect(skip).toMatchObject({ reason: 'robots_disallow' });
    expect(skip?.detail).toContain('redirect target');
    expect(site.requests.map((r) => r.url)).toContain('/go-private');
    expect(site.requests.map((r) => r.url)).not.toContain('/private/secret-target');
  });

  it('follows ordinary redirects and records both the requested and the final URL', () => {
    const page = result.pages.find((p) => new URL(p.url).pathname === '/redirect-me');
    expect(page).toBeDefined();
    expect(new URL(page?.finalUrl ?? '').pathname).toBe('/about-redirected');
    expect(page?.title).toBe('Redirected');
  });

  it('never fetches off-site links, non-HTML file links or mailto/tel links', () => {
    const requested = pathsRequested(site.requests);
    expect(requested).not.toContain('/doc.pdf');
    expect(requested).not.toContain('/photo.jpg');
    expect(other.requests.filter((r) => r.url === '/')).toHaveLength(0);
    expect(site.requests.some((r) => r.headers.host?.startsWith('localhost'))).toBe(false);
  });

  it('skips main documents that are not HTML (json, downloads)', () => {
    expect(skippedBy(result, 'non_html').sort()).toEqual(['/api/data', '/download']);
    expect(result.skipped.find((s) => s.url.endsWith('/api/data'))?.detail).toBe('application/json');
  });

  it('records failed page loads with the HTTP status', () => {
    expect(result.skipped.find((s) => s.url.endsWith('/missing'))).toMatchObject({ reason: 'load_failed', detail: 'HTTP 404' });
    expect(result.skipped.find((s) => s.url.endsWith('/broken'))).toMatchObject({ reason: 'load_failed', detail: 'HTTP 500' });
  });

  it('gives each loaded page its own sequentially numbered screenshot', () => {
    expect(result.pages.map((p) => p.screenshot)).toEqual(result.pages.map((_, i) => `screenshots/page-${i + 1}.png`));
  });

  it('reports the robots.txt that applied', () => {
    expect(result.robots).toEqual({ url: `${site.origin}/robots.txt`, fetched: true, status: 200, crawlDelaySeconds: null });
  });

  it('fetches robots.txt before any page', () => {
    expect(site.requests[0]?.url).toBe('/robots.txt');
  });
});

describe('crawl: maxPages, ordering and politeness', () => {
  let server: TestServer;
  beforeAll(async () => {
    const chain = Array.from({ length: 40 }, (_, i) => `<a href="/p/${i + 1}">page ${i + 1}</a>`).join('');
    server = await startServer({
      '/': html(`${chain}<a href="/a/b/c/d/e">deep</a><a href="/privacy">Privacy policy</a><a href="/contact">Contact</a><a href="/about">About</a>`),
      '/privacy': html('<p>privacy</p>'),
      '/contact': html('<p>contact</p>'),
      '/about': html('<p>about</p>'),
      ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`/p/${i + 1}`, html(`<p>page ${i + 1}</p>`)])),
      '/a/b/c/d/e': html('<p>deep</p>'),
    });
  });
  afterAll(async () => {
    await server.close();
    await cleanupTempDirs();
  });

  it('stops at maxPages and records the rest as max_pages', async () => {
    const { result } = await fastCrawl(`${server.origin}/`, { maxPages: 3 });
    expect(result.pages).toHaveLength(3);
    expect(skippedBy(result, 'max_pages').length).toBeGreaterThan(10);
    expect(pathsRequested(server.requests).filter((p) => p !== '/robots.txt' && p !== '/favicon.ico')).toHaveLength(3);
  });

  it('prefers shallow pages and pages that look like privacy/about/contact over arbitrary ones', async () => {
    const { result } = await fastCrawl(`${server.origin}/`, { maxPages: 4 });
    expect(urls(result)[0]).toBe('/');
    expect(urls(result).slice(1).sort()).toEqual(['/about', '/contact', '/privacy']);
  });

  it('enforces the hard cap of 25 pages even when more are requested', async () => {
    const { result } = await fastCrawl(`${server.origin}/`, { maxPages: 500, settleMs: 0 });
    expect(result.pages).toHaveLength(25);
  }, 120_000);

  it('clamps maxPages below 1 to the start page', async () => {
    const { result } = await fastCrawl(`${server.origin}/`, { maxPages: 0 });
    expect(result.pages).toHaveLength(1);
  });

  it('waits at least delayMs between page loads', async () => {
    const before = server.requests.length;
    await fastCrawl(`${server.origin}/`, { maxPages: 3, delayMs: 400 });
    const navigations = server.requests.slice(before).filter((r) => r.headers.accept?.includes('text/html'));
    expect(navigations).toHaveLength(3);
    for (let i = 1; i < navigations.length; i++) {
      expect(navigations[i]!.at - navigations[i - 1]!.at).toBeGreaterThanOrEqual(390);
    }
  });
});

describe('crawl: robots Crawl-delay', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({
      '/robots.txt': { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nCrawl-delay: 1\n' },
      '/': html('<a href="/two">two</a>'),
      '/two': html('<p>two</p>'),
    });
  });
  afterAll(async () => {
    await server.close();
    await cleanupTempDirs();
  });

  it('raises the delay between pages to the Crawl-delay and reports it', async () => {
    const { result } = await fastCrawl(`${server.origin}/`, { maxPages: 2, delayMs: 0 });
    expect(result.pages).toHaveLength(2);
    expect(result.robots.crawlDelaySeconds).toBe(1);
    const navigations = server.requests.filter((r) => r.headers.accept?.includes('text/html'));
    expect(navigations[1]!.at - navigations[0]!.at).toBeGreaterThanOrEqual(990);
  });
});
