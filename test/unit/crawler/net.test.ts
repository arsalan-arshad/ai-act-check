import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPrivateAddress } from '../../../src/crawler/index.js';
import { checkHost, readLimited, safeFetch } from '../../../src/crawler/net.js';
import { startServer, type TestServer } from './server.js';

describe('isPrivateAddress', () => {
  it.each([
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '127.0.0.1', '127.9.9.9', '169.254.169.254', '169.254.0.1',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255', '100.64.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '[::1]', 'fe80::1%eth0',
    '0:0:0:0:0:0:0:1',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '192.167.1.1', '192.169.0.1', '11.0.0.1',
    '100.63.255.255', '100.128.0.1', '169.253.1.1', '223.255.255.255',
    '2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:8.8.8.8', 'fbff::1', 'fec0::1',
  ])('treats %s as public', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it('fails closed for anything that is not an IP literal', () => {
    for (const value of ['', 'example.com', 'localhost', '999.1.1.1', '1.2.3', 'not-an-ip']) {
      expect(isPrivateAddress(value)).toBe(true);
    }
  });
});

describe('checkHost', () => {
  it('refuses literal private addresses and localhost unless allowPrivate', async () => {
    expect(await checkHost('127.0.0.1', false)).toBe('private_address');
    expect(await checkHost('[::1]', false)).toBe('private_address');
    expect(await checkHost('10.1.2.3', false)).toBe('private_address');
    expect(await checkHost('169.254.169.254', false)).toBe('private_address');
    expect(await checkHost('localhost', false)).toBe('private_address');
  });

  it('allows private addresses with allowPrivate', async () => {
    expect(await checkHost('127.0.0.1', true)).toBeNull();
    expect(await checkHost('localhost', true)).toBeNull();
  });

  it('allows a public literal address', async () => {
    expect(await checkHost('8.8.8.8', false)).toBeNull();
  });

  it('reports names that do not resolve', async () => {
    expect(await checkHost('does-not-exist.invalid', false)).toBe('dns_failed');
  });
});

describe('safeFetch and readLimited', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({
      '/ok': { status: 200, headers: { 'content-type': 'text/plain' }, body: 'hello' },
      '/r1': (_req, origin) => ({ status: 302, headers: { location: `${origin}/r2` } }),
      '/r2': { status: 301, headers: { location: '/ok' } },
      '/loop': (_req, origin) => ({ status: 302, headers: { location: `${origin}/loop` } }),
      '/to-file': { status: 302, headers: { location: 'file:///etc/passwd' } },
      '/to-bad': { status: 302, headers: { location: 'http://' } },
      '/hang': { hang: true },
      '/big': { status: 200, body: new Uint8Array(100_000).fill(65) },
    });
  });
  afterAll(async () => {
    await server.close();
  });

  it('refuses private targets by default without connecting', async () => {
    const result = await safeFetch(`${server.origin}/ok`, { timeoutMs: 2000, allowPrivate: false });
    expect(result).toEqual({ ok: false, error: 'private_address' });
    expect(server.requests).toHaveLength(0);
  });

  it('fetches and follows redirects with allowPrivate', async () => {
    const result = await safeFetch(`${server.origin}/r1`, { timeoutMs: 2000, allowPrivate: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finalUrl).toBe(`${server.origin}/ok`);
    expect(await result.response.text()).toBe('hello');
  });

  it('gives up on redirect loops', async () => {
    const result = await safeFetch(`${server.origin}/loop`, { timeoutMs: 2000, allowPrivate: true, maxRedirects: 3 });
    expect(result).toEqual({ ok: false, error: 'too_many_redirects' });
  });

  it('refuses redirects to other schemes and malformed locations', async () => {
    expect(await safeFetch(`${server.origin}/to-file`, { timeoutMs: 2000, allowPrivate: true })).toEqual({ ok: false, error: 'invalid_url' });
    expect(await safeFetch(`${server.origin}/to-bad`, { timeoutMs: 2000, allowPrivate: true })).toEqual({ ok: false, error: 'invalid_url' });
    expect(await safeFetch('ftp://example.test/x', { timeoutMs: 2000, allowPrivate: true })).toEqual({ ok: false, error: 'invalid_url' });
    expect(await safeFetch('not a url', { timeoutMs: 2000, allowPrivate: true })).toEqual({ ok: false, error: 'invalid_url' });
  });

  it('times out on a server that never answers', async () => {
    const result = await safeFetch(`${server.origin}/hang`, { timeoutMs: 300, allowPrivate: true });
    expect(result).toEqual({ ok: false, error: 'timeout' });
  });

  it('reports connection errors without throwing', async () => {
    const closed = await startServer({});
    const origin = closed.origin;
    await closed.close();
    const result = await safeFetch(`${origin}/x`, { timeoutMs: 2000, allowPrivate: true });
    expect(result.ok).toBe(false);
  });

  it('reads at most the requested number of bytes', async () => {
    const result = await safeFetch(`${server.origin}/big`, { timeoutMs: 2000, allowPrivate: true });
    if (!result.ok) throw new Error('fetch failed');
    const body = await readLimited(result.response, 1000);
    expect(body.length).toBe(1000);
    expect(body[0]).toBe(65);
  });

  it('returns the whole body when it is smaller than the limit', async () => {
    const result = await safeFetch(`${server.origin}/ok`, { timeoutMs: 2000, allowPrivate: true });
    if (!result.ok) throw new Error('fetch failed');
    expect(new TextDecoder().decode(await readLimited(result.response, 1000))).toBe('hello');
  });
});
