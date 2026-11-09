#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderJson } from './report/index.js';
import { scan } from './scan.js';
import type { ScanRunOptions } from './scan.js';
import type { Outcome, Report } from './types.js';
import { UsageError, parseCliArgs, defaultOutDir, BOUNDS, DEFAULT_PAGES } from './util/args.js';
import type { CliOptions } from './util/args.js';
import { redactSecrets } from './util/redact.js';
import { defaultUserAgent, getVersion } from './util/version.js';

export interface CliIo {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

export interface CliDeps {
  scan?: (url: string, opts: ScanRunOptions) => Promise<{ report: Report; outDir: string }>;
}

export const EXIT = { ok: 0, internal: 1, usage: 2, refused: 3 } as const;

const OUTCOME_TEXT: Record<Outcome, string> = {
  found: 'FOUND',
  not_found: 'NOT FOUND',
  cannot_tell: 'CANNOT TELL (not a pass)',
};

const ONE_LINE_DISCLAIMER =
  'Technical check of public pages. Not legal advice, not a certification or compliance assessment.';

const HELP = `ai-act-check <url> [options]

Scans public web pages for EU AI Act transparency basics (chat widget disclosure,
AI-generated image metadata). ${ONE_LINE_DISCLAIMER}
Scan only sites you are allowed to scan. robots.txt is always respected.

Options:
  --pages N         Max pages to visit, ${BOUNDS.pages.min}-${BOUNDS.pages.max} (default ${DEFAULT_PAGES})
  --out DIR         Output directory (default ./ai-act-check-report-<host>-<yyyymmddThhmmss>)
  --json            Print the JSON report to stdout (pure JSON; notices go to stderr)
  --explain         Add a plain-language explanation (bring your own key, see below)
  --delay-ms N      Minimum delay between page loads, ${BOUNDS['delay-ms'].min}-${BOUNDS['delay-ms'].max}
  --timeout-ms N    Per-page navigation timeout, ${BOUNDS['timeout-ms'].min}-${BOUNDS['timeout-ms'].max}
  --settle-ms N     Extra wait for late widgets, ${BOUNDS['settle-ms'].min}-${BOUNDS['settle-ms'].max}
  --allow-private   Allow localhost/private-network targets (local testing only)
  --no-html         Do not write report.html
  --version         Print the version
  -h, --help        Show this help

Explain (optional): set LLM_PROVIDER=anthropic|openai and LLM_API_KEY; optional LLM_MODEL
and LLM_BASE_URL. The model sees only rule titles, outcomes and summaries, never page text,
and cannot change a finding. Without a working key a fixed template text is used.

Exit codes: 0 scan completed, 1 internal error, 2 usage error,
            3 scan refused or blocked (robots.txt, private address, invalid URL, start page failed)
`;

const BLOCK_MESSAGES: Record<NonNullable<Report['scope']['startBlocked']>, string> = {
  robots_disallow: 'robots.txt does not allow scanning the start page (or could not be read), so nothing was loaded',
  private_address: 'the target resolves to a private or local address (use --allow-private only for your own test servers)',
  invalid_url: 'the URL is not a valid http(s) URL',
  load_failed: 'the start page failed to load',
};

function summaryText(report: Report, paths: string[]): string {
  const lines = [
    `ai-act-check ${report.tool.version}: ${ONE_LINE_DISCLAIMER}`,
    '',
    `Target: ${report.target.startUrl}`,
    `Pages checked: ${report.scope.pagesChecked.length} (up to ${report.scope.pagesRequested} requested)`,
    '',
  ];
  for (const f of report.findings) {
    lines.push(`  ${f.ruleId.padEnd(9)} ${OUTCOME_TEXT[f.outcome].padEnd(24)} ${f.title}`);
    lines.push(`            ${f.summary}`);
  }
  const s = report.summary;
  lines.push('', `${s.found} found, ${s.not_found} not found, ${s.cannot_tell} cannot tell. "Cannot tell" is not a pass.`);
  if (report.explanation) {
    const x = report.explanation;
    lines.push('', `Explanation (source: ${x.source}${x.model ? `, model ${x.model}` : ''}):`);
    for (const item of x.items) lines.push(`  ${item.ruleId}: ${item.text}`);
  }
  lines.push('', ...paths);
  return `${lines.join('\n')}\n`;
}

/** Returns an exit code instead of calling process.exit so it can be tested. */
export async function main(argv: string[], io?: CliIo, deps: CliDeps = {}): Promise<number> {
  const raw = io ?? { stdout: process.stdout, stderr: process.stderr };
  // Last line of defence: the LLM key never reaches a terminal, whatever produced the text.
  const out = (text: string): unknown => raw.stdout.write(redactSecrets(text, process.env));
  const err = (text: string): unknown => raw.stderr.write(redactSecrets(`${text}\n`, process.env));
  try {
    const args = parseCliArgs(argv);
    if (args.kind === 'help') {
      out(HELP);
      return EXIT.ok;
    }
    if (args.kind === 'version') {
      out(`${getVersion()}\n`);
      return EXIT.ok;
    }
    return await run(args.url, args.options, { out, err }, deps);
  } catch (e) {
    if (e instanceof UsageError) {
      err(`ai-act-check: ${e.message}\nRun "ai-act-check --help" for usage.`);
      return EXIT.usage;
    }
    const message = e instanceof Error ? e.message : 'unknown error';
    err(`ai-act-check: internal error: ${message}`);
    if (process.env.DEBUG === '1' && e instanceof Error && e.stack) err(e.stack);
    return EXIT.internal;
  }
}

function parseTarget(input: string): URL | string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return 'the URL is not valid; include the scheme, for example https://example.com';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'only http and https URLs can be scanned';
  if (url.username !== '' || url.password !== '') return 'URLs with embedded credentials are not accepted';
  return url;
}

async function run(
  input: string,
  options: CliOptions,
  io: { out: (t: string) => unknown; err: (t: string) => unknown },
  deps: CliDeps,
): Promise<number> {
  const target = parseTarget(input);
  if (typeof target === 'string') {
    io.err(`ai-act-check: refused: ${target}`);
    return EXIT.refused;
  }
  const userAgent = defaultUserAgent();
  io.err(`ai-act-check: User-Agent "${userAgent}". Scan only sites you are allowed to scan.`);
  if (options.allowPrivate) io.err('ai-act-check: notice: --allow-private is on; use it only for your own local test servers.');

  const outDir = options.out ?? defaultOutDir(target.host, new Date());
  const scanOpts: ScanRunOptions = {
    outDir,
    maxPages: options.pages,
    userAgent,
    allowPrivate: options.allowPrivate,
    explain: options.explain,
    html: options.html,
    ...(options.delayMs === null ? {} : { delayMs: options.delayMs }),
    ...(options.timeoutMs === null ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.settleMs === null ? {} : { settleMs: options.settleMs }),
  };
  const { report, outDir: writtenTo } = await (deps.scan ?? scan)(target.href, scanOpts);

  const paths = [`Report (JSON): ${join(writtenTo, 'report.json')}`];
  if (options.html) paths.push(`Report (HTML): ${join(writtenTo, 'report.html')}`);
  if (options.json) {
    io.out(renderJson(report));
    for (const p of paths) io.err(p);
  } else {
    io.out(summaryText(report, paths));
  }
  if (report.explanation?.guardRejected !== undefined) {
    io.err(`ai-act-check: notice: explanation uses the fixed template text (reason: ${report.explanation.guardRejected}).`);
  }
  const blocked = report.scope.startBlocked;
  if (blocked !== null) {
    io.err(`ai-act-check: scan blocked: ${BLOCK_MESSAGES[blocked]}.`);
    return EXIT.refused;
  }
  if (report.scope.pagesChecked.length === 0) {
    io.err('ai-act-check: scan blocked: no pages could be loaded.');
    return EXIT.refused;
  }
  return EXIT.ok;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
