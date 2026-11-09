// A few end-to-end checks through the built binary (node dist/cli.js).
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { startFixtureServer } from '../fixtures/server.js';
import { BASE_ARGS, cleanupTmp, DIST_CLI, HAS_DIST, makeTmp, ROOT, runCli } from './helpers.js';
import { validateReport } from './schema.js';

afterAll(cleanupTmp);

if (!HAS_DIST) console.warn('[e2e] dist/cli.js not found: run `npm run build` to enable the built-binary tests (skipped).');

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };

describe.skipIf(!HAS_DIST)('built binary: node dist/cli.js', () => {
  it('has a node shebang and is executable', () => {
    const first = fs.readFileSync(DIST_CLI, 'utf8').split('\n')[0];
    expect(first).toBe('#!/usr/bin/env node');
    expect(fs.statSync(DIST_CLI).mode & 0o111, 'executable bit').not.toBe(0);
  });

  it('--version and --help', async () => {
    const v = await runCli(['--version'], { mode: 'bin' });
    expect(v.code).toBe(0);
    expect(v.stdout).toContain(PKG.version);
    const h = await runCli(['--help'], { mode: 'bin' });
    expect(h.code).toBe(0);
    expect(h.stdout + h.stderr).toContain('--allow-private');
  });

  it('usage error exits 2', async () => {
    const r = await runCli(['http://127.0.0.1:1/', '--pages', '99'], { mode: 'bin' });
    expect(r.code).toBe(2);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  it('private address without --allow-private exits 3 and never contacts the server', async () => {
    const s = await startFixtureServer('no-chat');
    try {
      const r = await runCli([s.url('/'), '--out', path.join(makeTmp(), 'o')], { mode: 'bin' });
      expect(r.code).toBe(3);
      expect(s.log).toHaveLength(0);
    } finally {
      await s.close();
    }
  });

  it('full scan with --json: pure JSON on stdout, notices on stderr, files on disk, valid shape', async () => {
    const s = await startFixtureServer('chat-with-disclosure');
    try {
      const out = path.join(makeTmp(), 'out');
      const r = await runCli([s.url('/'), ...BASE_ARGS, '--out', out, '--json'], { mode: 'bin' });
      expect(r.code, r.stderr).toBe(0);
      const parsed = JSON.parse(r.stdout) as { findings: Array<{ ruleId: string; outcome: string }> };
      expect(validateReport(parsed)).toEqual([]);
      expect(Object.fromEntries(parsed.findings.map((f) => [f.ruleId, f.outcome]))).toMatchObject({ 'CHAT-01': 'found', 'CHAT-02': 'found', 'PAGE-01': 'not_found' });
      expect(r.stderr).toMatch(/ai-act-check\//);
      expect(fs.existsSync(path.join(out, 'report.html'))).toBe(true);
      expect(fs.existsSync(path.join(out, 'screenshots'))).toBe(true);
      expect(s.log[0]?.path).toBe('/robots.txt');
      expect(s.log.every((e) => /ai-act-check/.test(e.userAgent))).toBe(true);
    } finally {
      await s.close();
    }
  });

  it('human output uses the exact outcome words', async () => {
    const s = await startFixtureServer('no-chat');
    try {
      const r = await runCli([s.url('/'), ...BASE_ARGS, '--out', path.join(makeTmp(), 'o')], { mode: 'bin' });
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain('NOT FOUND');
      expect(r.stdout).toContain('CANNOT TELL (not a pass)');
    } finally {
      await s.close();
    }
  });

  it('default --out is ./ai-act-check-report-<host>-<timestamp> under the cwd', async () => {
    const cwd = makeTmp('aac-cwd-');
    const s = await startFixtureServer('no-chat');
    try {
      const r = await runCli([s.url('/'), '--allow-private', '--delay-ms', '0', '--settle-ms', '200'], { mode: 'bin', cwd });
      expect(r.code, r.stderr).toBe(0);
      const dirs = fs.readdirSync(cwd).filter((d) => d.startsWith('ai-act-check-report-'));
      expect(dirs).toHaveLength(1);
      expect(dirs[0]).toMatch(/^ai-act-check-report-127\.0\.0\.1.*\d{8}T\d{6}$/);
      expect(fs.existsSync(path.join(cwd, dirs[0] as string, 'report.json'))).toBe(true);
    } finally {
      await s.close();
    }
  });
});
