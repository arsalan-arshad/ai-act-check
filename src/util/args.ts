import { parseArgs } from 'node:util';

export class UsageError extends Error {}

export interface CliOptions {
  pages: number;
  out: string | null;
  json: boolean;
  explain: boolean;
  delayMs: number | null;
  timeoutMs: number | null;
  settleMs: number | null;
  allowPrivate: boolean;
  html: boolean;
}

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'scan'; url: string; options: CliOptions };

export const DEFAULT_PAGES = 10;
export const BOUNDS = {
  pages: { min: 1, max: 25 },
  'delay-ms': { min: 0, max: 60_000 },
  'timeout-ms': { min: 1_000, max: 120_000 },
  'settle-ms': { min: 0, max: 30_000 },
} as const;

function parseBoundedInt(name: keyof typeof BOUNDS, raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const { min, max } = BOUNDS[name];
  if (!/^\d{1,9}$/.test(raw)) throw new UsageError(`--${name} must be a whole number between ${min} and ${max}`);
  const n = Number(raw);
  if (n < min || n > max) throw new UsageError(`--${name} must be between ${min} and ${max}`);
  return n;
}

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        pages: { type: 'string' },
        out: { type: 'string' },
        json: { type: 'boolean' },
        explain: { type: 'boolean' },
        'delay-ms': { type: 'string' },
        'timeout-ms': { type: 'string' },
        'settle-ms': { type: 'string' },
        'allow-private': { type: 'boolean' },
        'no-html': { type: 'boolean' },
        version: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : 'invalid arguments');
  }
  const { values, positionals } = parsed;
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };
  if (positionals.length === 0) throw new UsageError('missing <url> argument');
  if (positionals.length > 1) throw new UsageError('expected exactly one <url> argument');
  const out = values.out;
  if (out !== undefined && out.trim() === '') throw new UsageError('--out must not be empty');
  return {
    kind: 'scan',
    url: positionals[0] as string,
    options: {
      pages: parseBoundedInt('pages', values.pages) ?? DEFAULT_PAGES,
      out: out ?? null,
      json: values.json === true,
      explain: values.explain === true,
      delayMs: parseBoundedInt('delay-ms', values['delay-ms']),
      timeoutMs: parseBoundedInt('timeout-ms', values['timeout-ms']),
      settleMs: parseBoundedInt('settle-ms', values['settle-ms']),
      allowPrivate: values['allow-private'] === true,
      html: values['no-html'] !== true,
    },
  };
}

/** `./ai-act-check-report-<host>-<yyyymmddThhmmss>` with the host reduced to filename-safe characters. */
export function defaultOutDir(host: string, now: Date): string {
  const safeHost = host.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'site';
  const stamp = now.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '');
  return `./ai-act-check-report-${safeHost}-${stamp}`;
}
