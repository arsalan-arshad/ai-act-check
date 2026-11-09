import { readFileSync } from 'node:fs';

let cached: string | undefined;

/**
 * Package version, read from package.json at runtime. The relative path is the same from
 * src/util/version.ts (vitest) and dist/util/version.js (built CLI).
 */
export function getVersion(): string {
  if (cached === undefined) {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const version = (parsed as { version?: unknown }).version;
    if (typeof version !== 'string' || version === '') throw new Error('package.json has no version');
    cached = version;
  }
  return cached;
}

/** Honest default User-Agent, identical to the crawler's documented default. */
export function defaultUserAgent(): string {
  return `ai-act-check/${getVersion()} (open-source technical scanner; not legal advice)`;
}
