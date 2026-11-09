// CLI exit codes and refusals (contract: 0 ok, 2 usage, 3 refused/blocked/start page failed).
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type FixtureServer, type FixtureServerOptions, hang, startFixtureServer } from '../fixtures/server.js';
import { BASE_ARGS, cleanupTmp, makeTmp, ROOT, runCli, scanUrl, withoutNegatedPass } from './helpers.js';
import { validateReport } from './schema.js';

afterAll(cleanupTmp);

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
const NO_TRACE = /\n\s+at .*\(.*:\d+:\d+\)|\bat Object\.<anonymous>|node:internal/;

async function withServer<T>(site: string, fn: (s: FixtureServer) => Promise<T>, opts: FixtureServerOptions = {}): Promise<T> {
  const s = await startFixtureServer(site, opts);
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

describe('usage errors (exit 2) never touch the network', () => {
  it('no arguments', async () => {
    const r = await runCli([]);
    expect(r.code).toBe(2);
    expect(r.stderr.length).toBeGreaterThan(0);
    expect(r.stderr).not.toMatch(NO_TRACE);
  });

  it('unknown flag', async () => {
    await withServer('no-chat', async (s) => {
      const r = await runCli([s.url('/'), '--definitely-not-a-flag', ...BASE_ARGS]);
      expect(r.code).toBe(2);
      expect(s.log).toHaveLength(0);
    });
  });

  for (const bad of ['0', '26', '-1', 'abc', '1.5', '']) {
    it(`--pages ${JSON.stringify(bad)} is rejected`, async () => {
      await withServer('no-chat', async (s) => {
        const r = await runCli([s.url('/'), ...BASE_ARGS, '--out', path.join(makeTmp(), 'o'), '--pages', bad]);
        expect(r.code, r.stderr).toBe(2);
        expect(r.stderr.length).toBeGreaterThan(0);
        expect(s.log, 'no request may be made on a usage error').toHaveLength(0);
      });
    });
  }

  for (const flag of ['--delay-ms', '--timeout-ms', '--settle-ms']) {
    it(`${flag} abc is rejected`, async () => {
      await withServer('no-chat', async (s) => {
        const r = await runCli([s.url('/'), '--allow-private', flag, 'abc', '--out', path.join(makeTmp(), 'o')]);
        expect(r.code).toBe(2);
        expect(s.log).toHaveLength(0);
      });
    });
  }

  it('--pages without a value', async () => {
    const r = await runCli(['http://127.0.0.1:9/', '--allow-private', '--pages']);
    expect(r.code).toBe(2);
  });
});

describe('--version and --help', () => {
  it('--version prints the package version and exits 0', async () => {
    const r = await runCli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(PKG.version);
  });

  it('--help and -h list the options and exit 0', async () => {
    for (const flag of ['--help', '-h']) {
      const r = await runCli([flag]);
      expect(r.code, flag).toBe(0);
      const out = r.stdout + r.stderr;
      for (const opt of ['--pages', '--out', '--json', '--explain', '--delay-ms', '--timeout-ms', '--settle-ms', '--allow-private', '--no-html', '--version']) {
        expect(out, `${flag} lists ${opt}`).toContain(opt);
      }
      expect(out).toMatch(/not legal advice|technical check/i);
    }
  });

  it('does not offer a way to ignore robots.txt', async () => {
    const r = await runCli(['--help']);
    expect(r.stdout + r.stderr).not.toMatch(/ignore-robots|no-robots|--force|disable robots/i);
  });
});

describe('refusals (exit 3)', () => {
  for (const bad of ['not a url', 'ftp://127.0.0.1/file', 'file:///etc/passwd', 'javascript:alert(1)', 'http://', '//no-scheme.example']) {
    it(`invalid URL ${JSON.stringify(bad)}`, async () => {
      const r = await runCli([bad, ...BASE_ARGS, '--out', path.join(makeTmp(), 'o')]);
      expect(r.code, r.stderr).toBe(3);
      expect(r.stderr.length).toBeGreaterThan(0);
      expect(r.stderr).not.toMatch(NO_TRACE);
    });
  }

  it('private/loopback address without --allow-private is refused before any connection', async () => {
    await withServer('chat-with-disclosure', async (s) => {
      const noPrivate = ['--delay-ms', '0', '--settle-ms', '300', '--timeout-ms', '5000'];
      const targets = [s.url('/'), s.origin.replace('127.0.0.1', 'localhost') + '/', s.origin.replace('127.0.0.1', '0.0.0.0') + '/'];
      for (const t of targets) {
        const r = await runCli([t, ...noPrivate, '--out', path.join(makeTmp(), 'o')]);
        expect(r.code, `${t}: ${r.stderr}`).toBe(3);
        expect(r.stderr).toMatch(/private|loopback|local|refus|allow-private/i);
        expect(r.stderr).not.toMatch(NO_TRACE);
      }
      expect(s.log, 'the server must never be contacted').toHaveLength(0);
    });
  });

  for (const addr of ['http://10.1.2.3/', 'http://192.168.1.1/', 'http://172.16.5.5/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]:8080/', 'http://[fd00::1]/', 'http://[fe80::1]/']) {
    it(`private literal ${addr} is refused fast (no connection attempt)`, async () => {
      const t0 = Date.now();
      const r = await runCli([addr, '--delay-ms', '0', '--settle-ms', '100', '--timeout-ms', '5000', '--out', path.join(makeTmp(), 'o')]);
      expect(r.code, r.stderr).toBe(3);
      expect(Date.now() - t0, 'refusal must not wait on a network timeout').toBeLessThan(4000);
    });
  }

  it('--allow-private prints a notice to stderr and lets the fixture scan proceed', async () => {
    await withServer('no-chat', async (s) => {
      const run = await scanUrl(s.url('/'));
      expect(run.code).toBe(0);
      expect(run.stderr).toMatch(/allow-private|private/i);
    });
  });

  it('robots.txt disallow-all: exit 3, only robots.txt is requested, report says blocked', async () => {
    await withServer('robots-disallow-all', async (s) => {
      const run = await scanUrl(s.url('/'));
      expect(run.code, run.stderr).toBe(3);
      expect(run.stderr).toMatch(/robots/i);
      expect(s.log.map((e) => e.path), 'no page may be loaded').toEqual(['/robots.txt']);
      expect(run.report, 'a blocked scan still writes report.json (Report.scope.startBlocked exists for this)').not.toBeNull();
      expect(validateReport(run.report)).toEqual([]);
      expect(run.report!.scope.startBlocked).toBe('robots_disallow');
      expect(run.report!.scope.pagesChecked).toEqual([]);
      for (const f of run.report!.findings) {
        expect(f.outcome, f.ruleId).toBe('cannot_tell');
        expect(f.reason, f.ruleId).toBe('blocked_by_robots');
        expect(f.evidence, f.ruleId).toEqual([]);
        expect(f.pagesEvaluated, f.ruleId).toEqual([]);
      }
      expect(withoutNegatedPass(run.stdout)).not.toMatch(/\bpass(ed|es)?\b/i);
    });
  });

  it('missing robots.txt (404) means no restrictions', async () => {
    await withServer('no-chat', async (s) => {
      const run = await scanUrl(s.url('/'));
      expect(run.code).toBe(0);
      expect(run.report!.scope.robots.fetched).toBe(false);
      expect(run.report!.scope.robots.status).toBe(404);
      expect(run.report!.scope.startBlocked).toBeNull();
    });
  });

  it('robots.txt returning 500 is treated conservatively as disallow-all', async () => {
    await withServer('no-chat', async (s) => {
      const run = await scanUrl(s.url('/'));
      expect(run.code, run.stderr).toBe(3);
      expect(s.documentRequests(), 'no page loaded when robots.txt is unreliable').toHaveLength(0);
      expect(run.report!.scope.startBlocked).toBe('robots_disallow');
      expect(run.report!.scope.robots.fetched).toBe(false);
      expect(run.report!.scope.robots.status).toBe(500);
      for (const f of run.report!.findings) expect(f.outcome).toBe('cannot_tell');
    }, { handlers: { '/robots.txt': { status: 500, body: 'oops', headers: { 'content-type': 'text/plain' } } } });
  });

  it('start page 404: exit 3, every rule cannot_tell/no_pages_loaded, never a pass', async () => {
    await withServer('no-chat', async (s) => {
      const run = await scanUrl(s.url('/missing-page.html'));
      expect(run.code, run.stderr).toBe(3);
      expect(run.stderr).not.toMatch(NO_TRACE);
      expect(run.report).not.toBeNull();
      expect(run.report!.scope.startBlocked).toBe('load_failed');
      for (const f of run.report!.findings) {
        expect(f.outcome).toBe('cannot_tell');
        expect(f.reason).toBe('no_pages_loaded');
      }
    });
  });

  it('start page that hangs fails by --timeout-ms (exit 3) and the scan does not hang', async () => {
    await withServer('no-chat', async (s) => {
      const t0 = Date.now();
      const run = await scanUrl(s.url('/slow'), ['--timeout-ms', '1500']);
      expect(run.code, run.stderr).toBe(3);
      expect(Date.now() - t0, 'bounded by the timeout').toBeLessThan(30000);
      expect(run.report?.scope.startBlocked).toBe('load_failed');
    }, { handlers: { '/slow': hang() } });
  });

  it('connection refused on the start page: exit 3', async () => {
    const port = await new Promise<number>((resolve) => {
      const srv = net.createServer().listen(0, '127.0.0.1', () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
    });
    const run = await scanUrl(`http://127.0.0.1:${port}/`);
    expect(run.code, run.stderr).toBe(3);
    expect(run.stderr).not.toMatch(NO_TRACE);
  });

  for (const [name, type, body] of [
    ['application/pdf', 'application/pdf', '%PDF-1.4\n%fake\n'],
    ['application/json', 'application/json', '{"hello":"world"}'],
  ] as const) {
    it(`non-HTML start response (${name}) is skipped as non_html; nothing is reported as found or not_found`, async () => {
      await withServer('no-chat', async (s) => {
        const run = await scanUrl(s.url('/doc'));
        expect([0, 3], `exit code ${run.code}: ${run.stderr}`).toContain(run.code);
        expect(run.report).not.toBeNull();
        expect(run.report!.scope.pagesChecked).toEqual([]);
        expect(run.report!.scope.skipped.some((k) => k.reason === 'non_html')).toBe(true);
        for (const f of run.report!.findings) expect(f.outcome, `${f.ruleId} must be cannot_tell when nothing was evaluated`).toBe('cannot_tell');
      }, { handlers: { '/doc': { body, headers: { 'content-type': type } } } });
    });
  }
});
