import { chromium, type Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { crawl } from '../../../src/crawler/index.js';
import { cleanupTempDirs, fastCrawl, pathsRequested, tempDir } from './helpers.js';
import { html, startServer, type TestServer } from './server.js';

const launched: Browser[] = [];
const original = chromium.launch.bind(chromium);

function trackBrowsers(): MockInstance<typeof chromium.launch> {
  launched.length = 0;
  return vi.spyOn(chromium, 'launch').mockImplementation(async (options) => {
    const browser = await original(options);
    launched.push(browser);
    return browser;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanupTempDirs();
});

describe('crawl: URL validation and private-address refusal', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({ '/': html('<p>should not be reached</p>') });
  });
  afterAll(async () => {
    await server.close();
  });

  it.each(['ftp://example.test/', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url', '', 'data:text/html,<p>x</p>', '//example.test/'])(
    'rejects %j as invalid_url without launching a browser',
    async (input) => {
      const spy = trackBrowsers();
      const { result } = await fastCrawl(input);
      expect(result.startBlocked).toBe('invalid_url');
      expect(result.pages).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toMatchObject({ reason: 'invalid_url' });
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['127.0.0.1', (s: TestServer) => `${s.origin}/`],
    ['localhost', (s: TestServer) => `http://localhost:${s.port}/`],
    ['IPv6 loopback', () => 'http://[::1]:9/'],
    ['cloud metadata address', () => 'http://169.254.169.254/latest/meta-data/'],
    ['10.0.0.0/8', () => 'http://10.1.2.3/'],
    ['172.16.0.0/12', () => 'http://172.20.0.1/'],
    ['192.168.0.0/16', () => 'http://192.168.1.1/'],
    ['0.0.0.0', () => 'http://0.0.0.0/'],
    ['IPv6 unique-local', () => 'http://[fd00::1]/'],
    ['IPv6 link-local', () => 'http://[fe80::1]/'],
    ['IPv4-mapped loopback', () => 'http://[::ffff:127.0.0.1]/'],
  ])('refuses %s by default without sending any request', async (_label, makeUrl) => {
    const spy = trackBrowsers();
    const before = server.requests.length;
    const { result } = await fastCrawl(makeUrl(server), { allowPrivate: false });
    expect(result.startBlocked).toBe('private_address');
    expect(result.pages).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: 'private_address' });
    expect(server.requests.length).toBe(before);
    expect(spy).not.toHaveBeenCalled();
  });

  it('allows the same target with allowPrivate', async () => {
    const { result } = await fastCrawl(`${server.origin}/`, { maxPages: 1 });
    expect(result.startBlocked).toBeNull();
    expect(result.pages).toHaveLength(1);
  });

  it('refuses unresolvable hosts as load_failed', async () => {
    const { result } = await fastCrawl('http://does-not-exist.invalid/', { allowPrivate: false });
    expect(result.startBlocked).toBe('load_failed');
    expect(result.skipped[0]).toMatchObject({ reason: 'load_failed' });
  });
});

describe('crawl: robots.txt gate for the start URL', () => {
  const servers: TestServer[] = [];
  const make = async (routes: Parameters<typeof startServer>[0]): Promise<TestServer> => {
    const s = await startServer(routes);
    servers.push(s);
    return s;
  };
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  it('loads no pages when the start URL is disallowed', async () => {
    const spy = trackBrowsers();
    const s = await make({
      '/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /\n' },
      '/': html('<p>never</p>'),
    });
    const { result } = await fastCrawl(`${s.origin}/`);
    expect(result.startBlocked).toBe('robots_disallow');
    expect(result.pages).toEqual([]);
    expect(result.skipped).toEqual([{ url: `${s.origin}/`, reason: 'robots_disallow', detail: 'disallowed by robots.txt' }]);
    expect(result.robots).toMatchObject({ fetched: true, status: 200 });
    expect(pathsRequested(s.requests)).toEqual(['/robots.txt']);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is blocked only for the start path when robots disallows just that', async () => {
    const s = await make({
      '/robots.txt': { status: 200, body: 'User-agent: ai-act-check\nDisallow: /start\n' },
      '/start': html('<p>never</p>'),
    });
    const { result } = await fastCrawl(`${s.origin}/start`);
    expect(result.startBlocked).toBe('robots_disallow');
    expect(pathsRequested(s.requests)).toEqual(['/robots.txt']);
  });

  it.each([500, 503, 401, 403])('treats robots.txt HTTP %i conservatively as disallow-all for this run', async (status) => {
    const s = await make({ '/robots.txt': { status, body: 'oops' }, '/': html('<p>never</p>') });
    const { result } = await fastCrawl(`${s.origin}/`);
    expect(result.startBlocked).toBe('robots_disallow');
    expect(result.pages).toEqual([]);
    expect(result.robots).toEqual({ url: `${s.origin}/robots.txt`, fetched: false, status, crawlDelaySeconds: null });
    expect(result.skipped[0]?.detail).toMatch(/could not be fetched/);
    expect(pathsRequested(s.requests)).toEqual(['/robots.txt']);
  });

  it.each([404, 410])('treats robots.txt HTTP %i as no restrictions', async (status) => {
    const s = await make({ '/robots.txt': { status, body: 'gone' }, '/': html('<p>fine</p>') });
    const { result } = await fastCrawl(`${s.origin}/`, { maxPages: 1 });
    expect(result.startBlocked).toBeNull();
    expect(result.pages).toHaveLength(1);
    expect(result.robots).toMatchObject({ fetched: false, status });
  });

  it('treats an unreachable robots.txt (connection refused) as disallow-all', async () => {
    const s = await startServer({});
    const origin = s.origin;
    await s.close();
    const { result } = await fastCrawl(`${origin}/`, { timeoutMs: 2000 });
    expect(result.startBlocked).toBe('robots_disallow');
    expect(result.robots).toMatchObject({ fetched: false, status: null });
  });
});

describe('crawl: start page failures', () => {
  const servers: TestServer[] = [];
  const make = async (routes: Parameters<typeof startServer>[0]): Promise<TestServer> => {
    const s = await startServer(routes);
    servers.push(s);
    return s;
  };
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  it('reports a 404 start page as load_failed and closes the browser', async () => {
    trackBrowsers();
    const s = await make({});
    const { result } = await fastCrawl(`${s.origin}/missing`);
    expect(result.startBlocked).toBe('load_failed');
    expect(result.pages).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: 'load_failed', detail: 'HTTP 404' });
    expect(launched).toHaveLength(1);
    expect(launched[0]?.isConnected()).toBe(false);
  });

  it('reports a non-HTML start page', async () => {
    const s = await make({ '/': { status: 200, headers: { 'content-type': 'application/json' }, body: '{}' } });
    const { result } = await fastCrawl(`${s.origin}/`);
    expect(result.startBlocked).toBe('load_failed');
    expect(result.skipped[0]).toMatchObject({ reason: 'non_html', detail: 'application/json' });
  });

  it('gives up on a start page that never answers, within the timeout', async () => {
    const s = await make({ '/': { hang: true } });
    const started = Date.now();
    const { result } = await fastCrawl(`${s.origin}/`, { timeoutMs: 800 });
    expect(result.startBlocked).toBe('load_failed');
    expect(result.pages).toEqual([]);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('gives up on endless redirects', async () => {
    const s = await make({ '/': { status: 302, headers: { location: '/' } } });
    const { result } = await fastCrawl(`${s.origin}/`);
    expect(result.startBlocked).toBe('load_failed');
    expect(result.skipped[0]).toMatchObject({ reason: 'load_failed', detail: 'too many redirects' });
  });

  it('does not follow a start-page redirect to another site', async () => {
    const elsewhere = await make({ '/target': html('<p>elsewhere</p>') });
    const s = await make({ '/': { status: 302, headers: { location: `http://localhost:${elsewhere.port}/target` } } });
    const { result } = await fastCrawl(`${s.origin}/`);
    expect(result.startBlocked).toBe('load_failed');
    expect(result.pages).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: 'off_site' });
    expect(elsewhere.requests).toHaveLength(0);
  });

  it('does not follow a start-page redirect into a path robots.txt disallows', async () => {
    const s = await make({
      '/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private\n' },
      '/': { status: 301, headers: { location: '/private/home' } },
      '/private/home': html('<p>never</p>'),
    });
    const { result } = await fastCrawl(`${s.origin}/`);
    expect(result.startBlocked).toBe('robots_disallow');
    expect(pathsRequested(s.requests)).not.toContain('/private/home');
  });

  it('follows a start-page redirect within the site and reports both URLs', async () => {
    const s = await make({ '/': { status: 302, headers: { location: '/home' } }, '/home': html('<p>home</p>', { title: 'Home' }) });
    const { result } = await fastCrawl(`${s.origin}/`, { maxPages: 1 });
    expect(result.startBlocked).toBeNull();
    expect(result.pages[0]).toMatchObject({ url: `${s.origin}/`, finalUrl: `${s.origin}/home`, status: 200, title: 'Home' });
  });

  it('still returns the pages it could load when a later page fails', async () => {
    const s = await make({
      '/': html('<a href="/ok">ok</a><a href="/hang">hang</a>'),
      '/ok': html('<p>ok</p>'),
      '/hang': { hang: true },
    });
    const { result } = await fastCrawl(`${s.origin}/`, { timeoutMs: 800 });
    expect(result.startBlocked).toBeNull();
    expect(result.pages.map((p) => new URL(p.url).pathname).sort()).toEqual(['/', '/ok']);
    expect(result.skipped.find((x) => x.url.endsWith('/hang'))).toMatchObject({ reason: 'load_failed' });
  });
});

describe('crawl: options, identity and lifecycle', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({ '/': html('<p>hello</p>') });
  });
  afterAll(async () => {
    await server.close();
  });

  it('uses a custom User-Agent when given', async () => {
    const { result } = await fastCrawl(`${server.origin}/`, { maxPages: 1, userAgent: 'custom-agent/9.9' });
    expect(result.userAgent).toBe('custom-agent/9.9');
    const request = server.requests.filter((r) => r.url === '/').at(-1);
    expect(request?.headers['user-agent']).toBe('custom-agent/9.9');
    const robots = server.requests.filter((r) => r.url === '/robots.txt').at(-1);
    expect(robots?.headers['user-agent']).toBe('custom-agent/9.9');
  });

  it('creates the screenshots directory under outDir even for nested outDir paths', async () => {
    const base = await tempDir();
    const outDir = `${base}/nested/report`;
    const { result } = await fastCrawl(`${server.origin}/`, { maxPages: 1, outDir });
    expect(result.pages[0]?.screenshot).toBe('screenshots/page-1.png');
  });

  it('closes the browser after a normal crawl', async () => {
    trackBrowsers();
    await fastCrawl(`${server.origin}/`, { maxPages: 1 });
    expect(launched).toHaveLength(1);
    expect(launched[0]?.isConnected()).toBe(false);
  });

  it('throws a helpful error when Chromium cannot be started', async () => {
    vi.spyOn(chromium, 'launch').mockRejectedValue(new Error('Executable does not exist'));
    await expect(fastCrawl(`${server.origin}/`, { maxPages: 1 })).rejects.toThrow(/npx playwright install chromium/);
  });

  it('throws a TypeError when outDir is missing (programmer error)', async () => {
    await expect(crawl(`${server.origin}/`, {} as never)).rejects.toThrow(TypeError);
    await expect(crawl(`${server.origin}/`, { outDir: '' })).rejects.toThrow(TypeError);
  });

  it('always reports ISO timestamps and the originally requested start URL', async () => {
    const { result } = await fastCrawl(`${server.origin}/#fragment`, { maxPages: 1 });
    expect(result.startUrl).toBe(`${server.origin}/#fragment`);
    expect(new Date(result.startedAt).toISOString()).toBe(result.startedAt);
    expect(new Date(result.finishedAt).toISOString()).toBe(result.finishedAt);
  });
});
