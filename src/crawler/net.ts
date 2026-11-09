import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * True for loopback, private, link-local, unique-local, multicast, reserved and cloud-metadata
 * addresses. Anything that is not a literal IP address is treated as private (fail closed).
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const family = isIP(ip);
  if (family === 4) return isPrivateV4(ip.split('.').map(Number));
  if (family === 6) return isPrivateV6(expandV6(ip));
  return true;
}

function isPrivateV4(o: number[]): boolean {
  const [a = 0, b = 0] = o;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Expands an IPv6 literal into eight 16-bit groups. */
function expandV6(ip: string): number[] {
  let text = ip;
  const v4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4Tail?.[1]) {
    const [a = 0, b = 0, c = 0, d = 0] = v4Tail[1].split('.').map(Number);
    text = text.slice(0, -v4Tail[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head = '', tail] = text.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':');
  const fill = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  return [...headGroups, ...Array<string>(Math.max(0, fill)).fill('0'), ...tailGroups].map((g) => parseInt(g, 16));
}

function isPrivateV6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const high = g0 | g1 | g2 | g3 | g4;
  if (high === 0 && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: and ::1
  if (high === 0 && g5 === 0xffff) return isPrivateV4([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]); // ::ffff:a.b.c.d
  return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xff00) === 0xff00;
}

/**
 * Resolves `hostname` and checks every address. Returns null when the host may be contacted,
 * otherwise a short reason. With allowPrivate only resolvability is required.
 */
export async function checkHost(hostname: string, allowPrivate: boolean): Promise<string | null> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(bare)) {
    addresses = [bare];
  } else {
    try {
      addresses = (await lookup(bare, { all: true })).map((r) => r.address);
    } catch {
      return 'dns_failed';
    }
  }
  if (addresses.length === 0) return 'dns_failed';
  if (!allowPrivate && addresses.some(isPrivateAddress)) return 'private_address';
  return null;
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs: number;
  allowPrivate: boolean;
  maxRedirects?: number;
}

export type SafeFetchResult =
  | { ok: true; response: Response; finalUrl: string }
  | { ok: false; error: string };

/**
 * fetch() that follows redirects manually so that every hop is validated (http/https only, public host).
 * Never throws; failures come back as `{ ok: false, error }` with messages free of secrets.
 */
export async function safeFetch(url: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return { ok: false, error: 'invalid_url' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, error: 'invalid_url' };
    const hostProblem = await checkHost(parsed.hostname, opts.allowPrivate);
    if (hostProblem) return { ok: false, error: hostProblem };
    let response: Response;
    try {
      response = await fetch(current, { headers: opts.headers, redirect: 'manual', signal });
    } catch (err) {
      return { ok: false, error: signal.aborted ? 'timeout' : errorMessage(err) };
    }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      try {
        current = new URL(location, current).toString();
      } catch {
        return { ok: false, error: 'invalid_url' };
      }
      continue;
    }
    return { ok: true, response, finalUrl: current };
  }
  return { ok: false, error: 'too_many_redirects' };
}

/** Reads at most `maxBytes` of a response body and cancels the rest of the stream. */
export async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, out.length - offset);
    if (take <= 0) break;
    out.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

export function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n')[0]?.slice(0, 200) ?? 'error';
}
