// Contract principle 3 / orchestrator ruling: every found AND not_found finding carries >= 1 evidence item.
import { afterAll, describe, expect, it } from 'vitest';
import { startFixtureServer } from '../fixtures/server.js';
import { cleanupTmp, scanUrl } from './helpers.js';

afterAll(cleanupTmp);

describe('evidence on not_found findings', () => {
  for (const site of ['no-chat', 'chat-no-disclosure', 'media-clean']) {
    it(`${site}: every not_found finding has evidence (url, kind, value, capturedAt)`, async () => {
      const s = await startFixtureServer(site);
      try {
        const run = await scanUrl(s.url('/'));
        expect(run.code, run.stderr).toBe(0);
        const nf = run.report!.findings.filter((f) => f.outcome === 'not_found');
        expect(nf.length, 'fixture must exercise at least one not_found').toBeGreaterThan(0);
        for (const f of nf) {
          expect(f.evidence.length, `${f.ruleId} (not_found) must carry evidence`).toBeGreaterThan(0);
          for (const e of f.evidence) {
            expect(e.url).toMatch(/^https?:\/\//);
            expect(e.value.length).toBeGreaterThan(0);
            expect(Date.parse(e.capturedAt)).not.toBeNaN();
          }
        }
      } finally {
        await s.close();
      }
    });
  }
});
