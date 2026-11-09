import { afterEach, describe, expect, it, vi } from 'vitest';

// Redirect hops must be re-validated. Real public hosts are never contacted: DNS and fetch are both stubbed.
vi.mock('node:dns/promises', () => {
  const table: Record<string, string[]> = {
    'public.test': ['93.184.216.34'],
    'also-public.test': ['93.184.216.35'],
    'rebind.test': ['10.0.0.5'],
    'mixed.test': ['93.184.216.36', '192.168.1.10'],
    'v6-local.test': ['fd00::1'],
  };
  return {
    lookup: vi.fn(async (host: string) => {
      const addresses = table[host];
      if (!addresses) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
      return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    }),
  };
});

const { safeFetch, checkHost } = await import('../../../src/crawler/net.js');

function stubFetch(responses: Record<string, Response>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string) => {
    const response = responses[url];
    if (!response) throw new Error(`unexpected fetch ${url}`);
    return response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const redirect = (to: string): Response => new Response(null, { status: 302, headers: { location: to } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkHost with stubbed DNS', () => {
  it('accepts public names and rejects names resolving to private ranges', async () => {
    expect(await checkHost('public.test', false)).toBeNull();
    expect(await checkHost('rebind.test', false)).toBe('private_address');
    expect(await checkHost('v6-local.test', false)).toBe('private_address');
  });

  it('rejects a name if any of its addresses is private', async () => {
    expect(await checkHost('mixed.test', false)).toBe('private_address');
    expect(await checkHost('mixed.test', true)).toBeNull();
  });
});

describe('safeFetch redirect validation', () => {
  it('follows a redirect between public hosts', async () => {
    const fetch = stubFetch({
      'http://public.test/a': redirect('http://also-public.test/b'),
      'http://also-public.test/b': new Response('done', { status: 200 }),
    });
    const result = await safeFetch('http://public.test/a', { timeoutMs: 1000, allowPrivate: false });
    expect(result.ok && result.finalUrl).toBe('http://also-public.test/b');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a loopback literal', 'http://127.0.0.1/secret'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['a name that resolves to a private address', 'http://rebind.test/x'],
    ['an IPv6 loopback', 'http://[::1]/x'],
  ])('refuses a redirect to %s', async (_label, target) => {
    const fetch = stubFetch({ 'http://public.test/a': redirect(target) });
    const result = await safeFetch('http://public.test/a', { timeoutMs: 1000, allowPrivate: false });
    expect(result).toEqual({ ok: false, error: 'private_address' });
    expect(fetch).toHaveBeenCalledTimes(1); // the private hop was never requested
  });

  it('refuses a private start host without any request', async () => {
    const fetch = stubFetch({});
    expect(await safeFetch('http://rebind.test/', { timeoutMs: 1000, allowPrivate: false })).toEqual({ ok: false, error: 'private_address' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows the same redirect with allowPrivate', async () => {
    stubFetch({
      'http://public.test/a': redirect('http://rebind.test/x'),
      'http://rebind.test/x': new Response('ok', { status: 200 }),
    });
    const result = await safeFetch('http://public.test/a', { timeoutMs: 1000, allowPrivate: true });
    expect(result.ok).toBe(true);
  });

  it('reports unresolvable hosts', async () => {
    stubFetch({});
    expect(await safeFetch('http://nowhere.test/', { timeoutMs: 1000, allowPrivate: false })).toEqual({ ok: false, error: 'dns_failed' });
  });
});
