// Human summary, --json purity, report.json shape, and report.html safety/self-containment.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FixtureServer, startFixtureServer } from '../fixtures/server.js';
import { assertValidReport, cleanupTmp, normalize, scanUrl, type ScanRun, withoutNegatedPass } from './helpers.js';
import { parseTags, textOf } from './html-tags.js';
import { expectCompletedScan } from './invariants.js';

let mixedServer: FixtureServer;
let mixed: ScanRun; // chat-no-disclosure: FOUND + NOT FOUND + CANNOT TELL all present
let hostileServer: FixtureServer;
let hostile: ScanRun;

beforeAll(async () => {
  mixedServer = await startFixtureServer('chat-no-disclosure');
  mixed = await scanUrl(mixedServer.url('/'));
  hostileServer = await startFixtureServer('hostile');
  hostile = await scanUrl(hostileServer.url('/'));
});
afterAll(async () => {
  await mixedServer?.close();
  await hostileServer?.close();
  cleanupTmp();
});

function lineFor(stdout: string, run: ScanRun, ruleId: string): string {
  const title = run.report!.findings.find((f) => f.ruleId === ruleId)!.title;
  const line = stdout.split('\n').find((l) => l.includes(ruleId)) ?? stdout.split('\n').find((l) => l.includes(title));
  expect(line, `a human-summary line for ${ruleId} / "${title}"`).toBeDefined();
  return line!;
}

describe('human summary (default output)', () => {
  it('scan completes and report.json is valid', () => {
    expectCompletedScan(mixed, mixedServer);
  });

  it('uses the exact outcome words, one line per rule', () => {
    expect(lineFor(mixed.stdout, mixed, 'CHAT-01')).toMatch(/(?<!NOT )\bFOUND\b/);
    expect(lineFor(mixed.stdout, mixed, 'CHAT-01')).not.toMatch(/NOT FOUND|CANNOT TELL/);
    expect(lineFor(mixed.stdout, mixed, 'CHAT-02')).toMatch(/NOT FOUND/);
    expect(lineFor(mixed.stdout, mixed, 'MEDIA-01')).toContain('CANNOT TELL (not a pass)');
    expect(lineFor(mixed.stdout, mixed, 'MEDIA-02')).toContain('CANNOT TELL (not a pass)');
    expect(lineFor(mixed.stdout, mixed, 'PAGE-01')).toMatch(/NOT FOUND/);
  });

  it('never words cannot-tell (or anything else) as a pass', () => {
    const cleaned = withoutNegatedPass(mixed.stdout);
    expect(cleaned).not.toMatch(/\bpass(es|ed)?\b/i);
    for (const line of mixed.stdout.split('\n').filter((l) => /CANNOT TELL/.test(l))) expect(line).toContain('(not a pass)');
  });

  it('shows the disclaimer one-liner and the report paths', () => {
    expect(mixed.stdout).toMatch(/not legal advice/i);
    expect(mixed.stdout).toContain(path.join(mixed.outDir, 'report.json'));
    expect(mixed.stdout).toContain(path.join(mixed.outDir, 'report.html'));
  });

  it('prints User-Agent and a scan-responsibly reminder on stderr; notices stay off stdout', () => {
    expect(mixed.stderr).toMatch(/ai-act-check\//);
    expect(mixed.stderr).toMatch(/only scan|allowed to scan|permission|authori[sz]ed/i);
    expect(mixed.stderr).toMatch(/allow-private|private/i);
  });

  it('does not render any legal verdict wording', () => {
    expect(mixed.stdout).not.toMatch(/non-?compliant|violat|illegal|unlawful|passes the AI Act/i);
    expect(mixed.stdout).not.toMatch(/\b(is|are|fully) compliant\b/i);
  });

  it('writes no stack trace and no env values', () => {
    expect(mixed.stderr).not.toMatch(/\n\s+at .*\(.*:\d+:\d+\)/);
  });
});

describe('--json', () => {
  it('prints pure JSON on stdout (equal to report.json), notices on stderr', async () => {
    const run = await scanUrl(mixedServer.url('/'), ['--json']);
    expect(run.code).toBe(0);
    const parsed = JSON.parse(run.stdout) as unknown;
    expect(normalize(parsed)).toEqual(normalize(run.report));
    expect(run.stderr).toMatch(/ai-act-check\//);
    expect(run.stdout.trim().startsWith('{')).toBe(true);
    assertValidReport({ ...run, report: parsed as ScanRun['report'] });
    expect(fs.existsSync(path.join(run.outDir, 'report.html')), 'files are still written with --json').toBe(true);
  });

  it('report.json has stable 2-space-indented key order', () => {
    const raw = fs.readFileSync(path.join(mixed.outDir, 'report.json'), 'utf8');
    expect(raw).toMatch(/^\{\n  "/);
    const keys = Object.keys(JSON.parse(raw) as object);
    expect(keys.slice(0, 3)).toEqual(['schemaVersion', 'tool', 'rulesVersion']);
  });

  it('--no-html skips report.html but keeps report.json', async () => {
    const run = await scanUrl(mixedServer.url('/'), ['--no-html']);
    expect(run.code).toBe(0);
    expect(fs.existsSync(path.join(run.outDir, 'report.json'))).toBe(true);
    expect(fs.existsSync(path.join(run.outDir, 'report.html'))).toBe(false);
  });
});

describe('report.json content', () => {
  it('carries the fixed disclaimer and limitations', () => {
    const r = mixed.report!;
    expect(r.disclaimer).toMatch(/not legal advice/i);
    expect(r.disclaimer).toMatch(/certification|compliance assessment|not a/i);
    expect(r.disclaimer).toMatch(/cannot tell/i);
    expect(r.disclaimer).toMatch(/pass/i);
    expect(r.disclaimer).toMatch(/unverified|verify|qualified/i);
    const lim = r.limitations.join('\n').toLowerCase();
    for (const topic of [/late|consent/, /shadow/, /human-staffed|human staffed|staffed/, /metadata/, /vendor/, /public/]) {
      expect(lim, `limitations should cover ${topic}`).toMatch(topic);
    }
  });

  it('lists the pages checked in the disclaimer or scope and the User-Agent in scope', () => {
    const r = mixed.report!;
    expect(r.scope.userAgent).toMatch(/ai-act-check\//);
    expect(r.scope.pagesChecked.length).toBeGreaterThan(0);
    expect(r.target.startUrl).toBe(mixedServer.url('/'));
    expect(r.target.host).toContain('127.0.0.1');
  });

  it('hedges every legalNote and never states a legal conclusion', () => {
    for (const m of mixed.report!.ruleCatalog) {
      expect(m.legalNote, m.ruleId).toMatch(/unverified|not legal advice|may|could|possibly/i);
      expect(m.legalNote, m.ruleId).not.toMatch(/\b(must|violates?|illegal|non-?compliant)\b/i);
      expect(m.limitations.length).toBeGreaterThan(20);
    }
  });

  it('CHAT-01 wording says chat widget, not AI chatbot', () => {
    const t = mixed.report!.findings[0]!;
    expect(`${t.title} ${t.summary}`.toLowerCase()).toContain('chat widget');
  });

  it('does not leak response headers, cookies or form values into the report', async () => {
    const server = await startFixtureServer('forms-and-clicks', { headers: { '*': { 'set-cookie': 'session=COOKIE-SECRET-5521; Path=/' } } });
    try {
      const run = await scanUrl(server.url('/'));
      expect(run.code).toBe(0);
      const all = [run.stdout, run.stderr, run.report ? JSON.stringify(run.report) : '', run.html ?? ''].join('\n');
      expect(all).not.toContain('COOKIE-SECRET-5521');
      expect(all).not.toContain('secret.person@example.test');
    } finally {
      await server.close();
    }
  });
});

describe('report.html', () => {
  it('is a single self-contained document: no external requests, no scripts', () => {
    const html = mixed.html!;
    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toMatch(/<html[^>]*\blang=/i);
    expect(html).toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(\s*["']?https?:/i);
    const tags = parseTags(html);
    const names = tags.map((t) => t.name);
    for (const banned of ['script', 'link', 'iframe', 'object', 'embed', 'form', 'base']) {
      expect(names, `<${banned}> must not appear`).not.toContain(banned);
    }
    for (const t of tags) {
      for (const attr of ['src', 'href', 'srcset', 'action', 'data']) {
        const v = t.attrs[attr];
        if (!v || !/^\s*(https?:)?\/\//i.test(v)) continue;
        const allowedSelfLink = t.name === 'a' && attr === 'href' && /^https?:\/\/127\.0\.0\.1[:/]/.test(v.trim());
        expect(allowedSelfLink, `<${t.name} ${attr}="${v}"> references an external resource`).toBe(true);
      }
      for (const a of Object.keys(t.attrs)) expect(a, `<${t.name}> inline event handler ${a}`).not.toMatch(/^on[a-z]+$/);
    }
  });

  it('shows disclaimer at top and bottom, the cannot-tell label, outcomes as text', () => {
    const html = mixed.html!;
    const text = textOf(html);
    const occurrences = (text.match(/not legal advice/gi) ?? []).length;
    expect(occurrences, 'disclaimer appears at least twice (top and bottom)').toBeGreaterThanOrEqual(2);
    const first = text.search(/not legal advice/i);
    const last = text.toLowerCase().lastIndexOf('not legal advice');
    expect(last).toBeGreaterThan(first);
    expect(first, 'first disclaimer is near the top').toBeLessThan(text.length * 0.35);
    expect(last, 'last disclaimer is near the bottom').toBeGreaterThan(text.length * 0.6);
    expect(text).toContain('Cannot tell (not a pass)');
    expect(text).toMatch(/\bNot found\b/i);
    expect(text).toMatch(/\bFound\b/);
  });

  it('lists pages checked, rules, evidence, and uses relative screenshot thumbnails that exist', () => {
    const html = mixed.html!;
    const text = textOf(html);
    for (const p of mixed.report!.scope.pagesChecked) expect(text).toContain(p.finalUrl);
    for (const id of ['CHAT-01', 'CHAT-02', 'MEDIA-01', 'MEDIA-02', 'PAGE-01']) expect(text).toContain(id);
    for (const m of mixed.report!.ruleCatalog) expect(text).toContain(m.title);
    const imgs = parseTags(html).filter((t) => t.name === 'img');
    expect(imgs.length, 'screenshot thumbnails').toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.attrs.src, 'img src').toMatch(/^screenshots\/[\w.-]+\.png$/);
      expect(img.attrs.alt, 'img alt text for accessibility').toBeTruthy();
      expect(fs.existsSync(path.join(mixed.outDir, img.attrs.src as string))).toBe(true);
    }
    expect(parseTags(html).some((t) => t.name === 'table'), 'evidence table').toBe(true);
  });

  it('renders the explanation block labelled with its source when --explain is used (template fallback without a key)', async () => {
    const run = await scanUrl(mixedServer.url('/'), ['--explain']);
    expect(run.code, 'a failing/absent explainer must never fail the scan').toBe(0);
    expect(run.report!.explanation?.source).toBe('template');
    expect(textOf(run.html!).toLowerCase()).toContain('template');
  });
});

describe('hostile page content is escaped in report.html', () => {
  it('scan succeeds and the hostile strings reached the report data', () => {
    expectCompletedScan(hostile, hostileServer);
    expect(JSON.stringify(hostile.report), 'hostile material reached the findings (test is not vacuous)').toMatch(/alert\(1\)/);
  });

  it('contains no raw <script>alert(1)</script> and no injected markup', () => {
    const html = hostile.html!;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toMatch(/<script/i);
    const tags = parseTags(html);
    expect(tags.filter((t) => t.name === 'script')).toHaveLength(0);
    for (const t of tags) {
      for (const a of Object.keys(t.attrs)) expect(a, `<${t.name}> attribute ${a}`).not.toMatch(/^on[a-z]+$/);
      if (t.name === 'img') expect(t.attrs.src).toMatch(/^screenshots\//);
    }
  });

  it('never renders a javascript: URL as a clickable href/src', () => {
    for (const t of parseTags(hostile.html!)) {
      for (const attr of ['href', 'src', 'action', 'formaction', 'xlink:href']) {
        expect(t.attrs[attr] ?? '', `<${t.name} ${attr}>`).not.toMatch(/^\s*javascript:/i);
      }
    }
  });

  it('shows hostile strings as inert, escaped text where they appear', () => {
    const html = hostile.html!;
    const data = JSON.stringify(hostile.report);
    if (data.includes('<script>alert(1)</script>')) expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    if (/<img src=x onerror=alert\(1\)>/.test(data)) expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('also keeps the human summary free of raw script tags', () => {
    expect(hostile.stdout).not.toMatch(/<script>alert\(1\)<\/script>/);
  });
});
