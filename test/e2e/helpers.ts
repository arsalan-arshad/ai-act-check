// Shared helpers for the e2e suite: drive the CLI (in-process via main(argv, io), or as the
// built binary), run scans against fixture servers into temp dirs, and normalise reports.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Finding, Report } from '../../src/types.js';
import { validateReport } from './schema.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIST_CLI = path.join(ROOT, 'dist', 'cli.js');
export const HAS_DIST = fs.existsSync(DIST_CLI);

/** Flags every e2e scan passes: fixtures live on 127.0.0.1, so no politeness delay is needed. */
export const BASE_ARGS = ['--allow-private', '--delay-ms', '0', '--settle-ms', '300', '--timeout-ms', '10000'];

export const SENTINEL_KEY = 'sk-test-SENTINEL-9f8e7d6c5b4a3210';

const ENV_KEYS = ['LLM_API_KEY', 'LLM_PROVIDER', 'LLM_BASE_URL', 'LLM_MODEL', 'DEBUG'];

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CliOptions {
  env?: Record<string, string | undefined>;
  mode?: 'inproc' | 'bin';
  cwd?: string;
  timeoutMs?: number;
}

const tmpDirs: string[] = [];
export function makeTmp(prefix = 'aac-e2e-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
export function cleanupTmp(): void {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

type MainFn = (argv: string[], io?: unknown) => number | void | Promise<number | void>;

async function runInProc(args: string[], opts: CliOptions): Promise<CliResult> {
  const mod = (await import('../../src/cli.js')) as { main?: MainFn };
  if (typeof mod.main !== 'function') throw new Error('src/cli.ts does not export main(argv, io)');

  const ioOut: string[] = [];
  const ioErr: string[] = [];
  const globalOut: string[] = [];
  const globalErr: string[] = [];
  const mk = (sink: string[]) => ({
    write: (chunk: unknown): boolean => {
      sink.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
      return true;
    },
  });
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of ENV_KEYS) delete env[k];
  Object.assign(env, opts.env ?? {});
  // Offer several plausible io shapes; capture globals as well so either style is observed.
  const io = {
    stdout: mk(ioOut),
    stderr: mk(ioErr),
    out: (s: string) => ioOut.push(s + '\n'),
    err: (s: string) => ioErr.push(s + '\n'),
    env,
  };

  const savedEnv = { ...process.env };
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  const push = (sink: string[]) => (...a: unknown[]) => {
    sink.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
  };
  (process.stdout as { write: unknown }).write = (c: unknown): boolean => mk(globalOut).write(c);
  (process.stderr as { write: unknown }).write = (c: unknown): boolean => mk(globalErr).write(c);
  console.log = push(globalOut);
  console.error = push(globalErr);
  console.warn = push(globalErr);
  const origCwd = process.cwd();
  try {
    if (opts.cwd) process.chdir(opts.cwd);
    process.exitCode = undefined;
    const ret = await mod.main(args, io);
    const code = typeof ret === 'number' ? ret : (process.exitCode as number | undefined) ?? 0;
    process.exitCode = undefined;
    return {
      code,
      stdout: ioOut.length ? ioOut.join('') : globalOut.join(''),
      stderr: ioErr.length ? ioErr.join('') : globalErr.join(''),
    };
  } finally {
    process.chdir(origCwd);
    (process.stdout as { write: unknown }).write = origOut;
    (process.stderr as { write: unknown }).write = origErr;
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  }
}

function runBin(args: string[], opts: CliOptions): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of ENV_KEYS) delete env[k];
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    const child = spawn(process.execPath, [DIST_CLI, ...args], { env, cwd: opts.cwd ?? ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI binary timed out after ${opts.timeoutMs ?? 120000}ms: ${args.join(' ')}`));
    }, opts.timeoutMs ?? 120000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function runCli(args: string[], opts: CliOptions = {}): Promise<CliResult> {
  return opts.mode === 'bin' ? runBin(args, opts) : runInProc(args, opts);
}

export interface ScanRun extends CliResult {
  outDir: string;
  args: string[];
  report: Report | null;
  html: string | null;
  durationMs: number;
}

/** Run the CLI against `url` into a fresh temp out dir. `extra` flags come after BASE_ARGS. */
export async function scanUrl(url: string, extra: string[] = [], opts: CliOptions & { base?: string[] } = {}): Promise<ScanRun> {
  const outDir = path.join(makeTmp(), 'out');
  const args = [url, ...(opts.base ?? BASE_ARGS), '--out', outDir, ...extra];
  const t0 = Date.now();
  const res = await runCli(args, opts);
  const durationMs = Date.now() - t0;
  const read = (f: string): string | null => {
    try {
      return fs.readFileSync(path.join(outDir, f), 'utf8');
    } catch {
      return null;
    }
  };
  const json = read('report.json');
  let report: Report | null = null;
  if (json) {
    try {
      report = JSON.parse(json) as Report;
    } catch {
      report = null;
    }
  }
  return { ...res, outDir, args, report, html: read('report.html'), durationMs };
}

export function finding(run: ScanRun, ruleId: string): Finding {
  if (!run.report) throw new Error(`no report.json written (exit ${run.code}); stderr: ${run.stderr.slice(0, 500)}`);
  const f = run.report.findings.find((x) => x.ruleId === ruleId);
  if (!f) throw new Error(`finding ${ruleId} missing`);
  return f;
}

export function outcomes(run: ScanRun): Record<string, string> {
  if (!run.report) throw new Error(`no report.json written (exit ${run.code}); stderr: ${run.stderr.slice(0, 500)}`);
  return Object.fromEntries(run.report.findings.map((f) => [f.ruleId, f.outcome]));
}

export function assertValidReport(run: ScanRun): void {
  if (!run.report) throw new Error(`no report.json written (exit ${run.code}); stderr: ${run.stderr.slice(0, 500)}`);
  const errs = validateReport(run.report);
  if (errs.length) throw new Error('report.json violates the Report shape:\n - ' + errs.join('\n - '));
}

/** Replace volatile values (timestamps, ports) so two runs can be compared. */
export function normalize<T>(value: T): unknown {
  const VOLATILE = new Set(['capturedAt', 'fetchedAt', 'generatedAt', 'startedAt', 'finishedAt']);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, VOLATILE.has(k) ? 'TS' : walk(x)]));
    }
    return v;
  };
  return JSON.parse(JSON.stringify(walk(value)).replace(/(127\.0\.0\.1|localhost):\d+/g, '$1:PORT'));
}

export function normalizedFindings(run: ScanRun): string {
  if (!run.report) throw new Error('no report');
  return JSON.stringify(normalize(run.report.findings));
}

/** All text files under dir, as [relativePath, content] pairs. */
export function readAllText(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (!/\.(png|jpe?g|gif|webp)$/i.test(e.name)) out.push([path.relative(dir, p), fs.readFileSync(p, 'utf8')]);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Remove the negated forms ("not a pass", "(not a pass)", "not be read as a pass") so remaining pass-words can be flagged. */
export function withoutNegatedPass(text: string): string {
  return text.replace(/\(?\bnot (be read |to be read )?(as )?a pass\b\)?/gi, '');
}
