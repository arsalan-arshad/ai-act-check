// Contract invariants that must hold for EVERY completed scan, whatever the fixture.
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import type { FixtureServer } from '../fixtures/server.js';
import { assertValidReport, type ScanRun } from './helpers.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const VERDICT_WORDS = /compliant|non-?compliant|violat|illegal|unlawful|passes the ai act|certified/i;

export function expectCompletedScan(run: ScanRun, server?: FixtureServer): void {
  expect(run.code, `exit code (stderr: ${run.stderr.slice(0, 400)})`).toBe(0);
  assertValidReport(run);
  const report = run.report!;
  const pageUrls = new Set(report.scope.pagesChecked.flatMap((p) => [p.url, p.finalUrl]));

  for (const f of report.findings) {
    // not_found evidence is asserted separately (evidence.test.ts) so that one gap does not mask every other check.
    if (f.outcome === 'found') expect(f.evidence.length, `${f.ruleId} (found) must carry evidence`).toBeGreaterThan(0);
    if (f.outcome !== 'cannot_tell') expect(f.pagesEvaluated.length, `${f.ruleId} pagesEvaluated`).toBeGreaterThan(0);
    for (const e of f.evidence) {
      expect(pageUrls.has(e.url), `${f.ruleId} evidence url ${e.url} must be a checked page`).toBe(true);
      if (e.kind === 'screenshot') {
        expect(fs.existsSync(path.join(run.outDir, e.value)), `${f.ruleId} screenshot evidence ${e.value} exists`).toBe(true);
      }
    }
    for (const u of f.pagesEvaluated) expect(pageUrls.has(u), `${f.ruleId} pagesEvaluated ${u} must be a checked page`).toBe(true);
    expect(`${f.title} ${f.summary}`, `${f.ruleId} wording must not carry a legal verdict`).not.toMatch(VERDICT_WORDS);
    // Rules that always need a person to judge the result (types.ts + contract).
    if (f.outcome === 'found' && ['CHAT-02', 'MEDIA-01', 'MEDIA-02', 'PAGE-01'].includes(f.ruleId)) {
      expect(f.needsHumanJudgement, `${f.ruleId} found => needsHumanJudgement`).toBe(true);
    }
    if (f.ruleId === 'CHAT-02' && f.outcome === 'not_found') expect(f.needsHumanJudgement).toBe(true);
  }

  for (const p of report.scope.pagesChecked) {
    expect(p.screenshot, `screenshot path for ${p.url}`).toBeTruthy();
    const file = path.join(run.outDir, p.screenshot!);
    expect(fs.existsSync(file), `screenshot file ${p.screenshot} exists`).toBe(true);
    const bytes = fs.readFileSync(file);
    expect(bytes.subarray(0, 4).equals(PNG_MAGIC), `${p.screenshot} is a PNG`).toBe(true);
    expect(bytes.length).toBeGreaterThan(500);
  }
  expect(run.html, 'report.html written').not.toBeNull();

  if (server) {
    expect(server.log.length).toBeGreaterThan(0);
    expect(server.log[0]?.path, 'robots.txt must be the first request').toBe('/robots.txt');
    for (const e of server.log) expect(e.userAgent, `UA on ${e.path}`).toMatch(/ai-act-check/);
  }
}
