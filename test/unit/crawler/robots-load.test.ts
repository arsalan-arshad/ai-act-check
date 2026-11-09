import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRobots } from '../../../src/crawler/robots.js';
import { startServer, type TestServer } from './server.js';

const UA = 'ai-act-check/test';

describe('loadRobots', () => {
  let ok: TestServer;
  let status: Record<number, TestServer>;

  beforeAll(async () => {
    ok = await startServer({
      '/robots.txt': {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: 'User-agent: *\nDisallow: /private\nCrawl-delay: 4\n',
      },
    });
    status = {};
    for (const code of [404, 410, 401, 403, 429, 500, 503]) {
      status[code] = await startServer({ '/robots.txt': { status: code, body: 'x' } });
    }
  });
  afterAll(async () => {
    await Promise.all([ok.close(), ...Object.values(status).map((s) => s.close())]);
  });

  it('parses a 200 response and reports crawl-delay', async () => {
    const { rules, info } = await loadRobots(ok.origin, 2000, true, UA);
    expect(info).toEqual({ url: `${ok.origin}/robots.txt`, fetched: true, status: 200, crawlDelaySeconds: 4 });
    expect(rules.isAllowed('/private/x')).toBe(false);
    expect(rules.isAllowed('/public')).toBe(true);
  });

  it('sends the honest User-Agent', async () => {
    expect(ok.requests.at(-1)?.headers['user-agent']).toBe(UA);
  });

  it.each([404, 410, 429])('treats HTTP %i as no restrictions', async (code) => {
    const server = status[code]!;
    const { rules, info } = await loadRobots(server.origin, 2000, true, UA);
    expect(info.fetched).toBe(false);
    expect(info.status).toBe(code);
    expect(rules.isAllowed('/anything')).toBe(true);
  });

  it.each([401, 403, 500, 503])('treats HTTP %i conservatively as disallow-all', async (code) => {
    const server = status[code]!;
    const { rules, info } = await loadRobots(server.origin, 2000, true, UA);
    expect(info).toMatchObject({ fetched: false, status: code });
    expect(rules.isAllowed('/')).toBe(false);
    expect(rules.isAllowed('/anything')).toBe(false);
  });

  it('treats a timeout as disallow-all', async () => {
    const hanging = await startServer({ '/robots.txt': { hang: true } });
    try {
      const { rules, info } = await loadRobots(hanging.origin, 300, true, UA);
      expect(info).toMatchObject({ fetched: false, status: null });
      expect(rules.isAllowed('/')).toBe(false);
    } finally {
      await hanging.close();
    }
  });

  it('treats a connection failure as disallow-all', async () => {
    const closed = await startServer({});
    const origin = closed.origin;
    await closed.close();
    const { rules, info } = await loadRobots(origin, 1000, true, UA);
    expect(info.fetched).toBe(false);
    expect(rules.isAllowed('/')).toBe(false);
  });

  it('refuses private hosts without allowPrivate (no request is made)', async () => {
    const before = ok.requests.length;
    const { rules, info } = await loadRobots(ok.origin, 1000, false, UA);
    expect(info.fetched).toBe(false);
    expect(rules.isAllowed('/')).toBe(false);
    expect(ok.requests.length).toBe(before);
  });

  it('follows a robots.txt redirect', async () => {
    const server = await startServer({
      '/robots.txt': { status: 301, headers: { location: '/real-robots' } },
      '/real-robots': { status: 200, body: 'User-agent: *\nDisallow: /x' },
    });
    try {
      const { rules, info } = await loadRobots(server.origin, 2000, true, UA);
      expect(info.fetched).toBe(true);
      expect(rules.isAllowed('/x')).toBe(false);
    } finally {
      await server.close();
    }
  });
});
