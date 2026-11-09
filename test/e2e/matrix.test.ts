// Per-fixture expected outcomes for every rule, driven through main(argv, io).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeImageFixtures } from '../fixtures/images.js';
import { type FixtureServer, startFixtureServer } from '../fixtures/server.js';
import { VENDOR_FIXTURES, vendorPage } from '../fixtures/vendors.js';
import { cleanupTmp, finding, scanUrl, withoutNegatedPass } from './helpers.js';
import { expectCompletedScan } from './invariants.js';

type O = 'found' | 'not_found' | 'cannot_tell';
interface Case {
  site: string;
  expect: Partial<Record<string, O>>;
  reasons?: Partial<Record<string, string>>;
  extra?: string[];
  other?: string;
  evidence?: Array<{ rule: string; kind: string; value: RegExp }>;
}

const NO_MEDIA = { 'MEDIA-01': 'cannot_tell', 'MEDIA-02': 'cannot_tell' } as const;
const NO_MEDIA_REASONS = { 'MEDIA-01': 'no_images_readable', 'MEDIA-02': 'no_flagged_images' };

const CASES: Case[] = [
  { site: 'chat-with-disclosure', expect: { 'CHAT-01': 'found', 'CHAT-02': 'found', ...NO_MEDIA, 'PAGE-01': 'not_found' }, reasons: NO_MEDIA_REASONS, evidence: [{ rule: 'CHAT-02', kind: 'text', value: /chatting with an AI/i }] },
  { site: 'chat-no-disclosure', expect: { 'CHAT-01': 'found', 'CHAT-02': 'not_found', ...NO_MEDIA, 'PAGE-01': 'not_found' }, reasons: NO_MEDIA_REASONS },
  { site: 'no-chat', expect: { 'CHAT-01': 'not_found', 'CHAT-02': 'cannot_tell', ...NO_MEDIA, 'PAGE-01': 'not_found' }, reasons: { 'CHAT-02': 'no_widget_detected', ...NO_MEDIA_REASONS } },
  { site: 'chat-in-iframe', expect: { 'CHAT-01': 'found', 'CHAT-02': 'found' } },
  { site: 'chat-in-cross-origin-iframe', other: 'iframe-host', expect: { 'CHAT-01': 'found', 'CHAT-02': 'found' } },
  { site: 'chat-late', extra: ['--settle-ms', '3000'], expect: { 'CHAT-01': 'found', 'CHAT-02': 'found' } },
  { site: 'chat-in-iframe-weak-name', expect: { 'CHAT-01': 'found', 'CHAT-02': 'found' } },
  { site: 'chat-shadow-weak-name', expect: { 'CHAT-01': 'found', 'CHAT-02': 'found' } },
  { site: 'chat-shadow-open', expect: { 'CHAT-01': 'found', 'CHAT-02': 'found' } },
  { site: 'chat-closed-launcher', expect: { 'CHAT-01': 'found', 'CHAT-02': 'cannot_tell' }, reasons: { 'CHAT-02': 'widget_ui_not_inspectable' } },
  { site: 'chat-de', expect: { 'CHAT-01': 'found', 'CHAT-02': 'found' } },
  { site: 'chat-fr', expect: { 'CHAT-01': 'found', 'CHAT-02': 'found' } },
  { site: 'chat-es', expect: { 'CHAT-01': 'found', 'CHAT-02': 'found' } },
  { site: 'chat-it', expect: { 'CHAT-01': 'found', 'CHAT-02': 'found' } },
  { site: 'chat-class-comments', expect: { 'CHAT-01': 'not_found', 'CHAT-02': 'cannot_tell' }, reasons: { 'CHAT-02': 'no_widget_detected' } },
  { site: 'chatbot-word', expect: { 'CHAT-01': 'not_found', 'CHAT-02': 'cannot_tell' }, reasons: { 'CHAT-02': 'no_widget_detected' } },
  { site: 'chatbot-word-with-widget', expect: { 'CHAT-01': 'found', 'CHAT-02': 'not_found' } },
  { site: 'forms-and-clicks', expect: { 'CHAT-01': 'found' } },
  { site: 'ai-page-link', expect: { 'CHAT-01': 'not_found', 'PAGE-01': 'found' }, evidence: [{ rule: 'PAGE-01', kind: 'link', value: /ai-transparency/i }] },
  { site: 'ki-page-link', expect: { 'CHAT-01': 'not_found', 'PAGE-01': 'found' }, evidence: [{ rule: 'PAGE-01', kind: 'link', value: /ki\.html|K.nstliche Intelligenz/i }] },
  { site: 'media-c2pa-labelled-caption', expect: { 'MEDIA-01': 'found', 'MEDIA-02': 'found' }, evidence: [{ rule: 'MEDIA-01', kind: 'metadata', value: /c2pa/i }] },
  { site: 'media-c2pa-unlabelled', expect: { 'MEDIA-01': 'found', 'MEDIA-02': 'not_found' }, evidence: [{ rule: 'MEDIA-01', kind: 'metadata', value: /c2pa/i }] },
  { site: 'media-c2pa-jpeg-labelled-alt', expect: { 'MEDIA-01': 'found', 'MEDIA-02': 'found' }, evidence: [{ rule: 'MEDIA-01', kind: 'metadata', value: /c2pa/i }] },
  { site: 'media-iptc-labelled-alt', expect: { 'MEDIA-01': 'found', 'MEDIA-02': 'found' }, evidence: [{ rule: 'MEDIA-01', kind: 'metadata', value: /trainedAlgorithmicMedia/i }] },
  { site: 'media-iptc-unlabelled-jpeg', expect: { 'MEDIA-01': 'found', 'MEDIA-02': 'not_found' }, evidence: [{ rule: 'MEDIA-01', kind: 'metadata', value: /trainedAlgorithmicMedia/i }] },
  { site: 'media-tool-hint', expect: { 'MEDIA-01': 'found', 'MEDIA-02': 'not_found' }, evidence: [{ rule: 'MEDIA-01', kind: 'metadata', value: /midjourney/i }] },
  { site: 'media-clean', expect: { 'MEDIA-01': 'not_found', 'MEDIA-02': 'cannot_tell' }, reasons: { 'MEDIA-02': 'no_flagged_images' } },
  { site: 'media-mixed', expect: { 'MEDIA-01': 'found', 'MEDIA-02': 'not_found' } },
  { site: 'media-none', expect: { 'MEDIA-01': 'cannot_tell', 'MEDIA-02': 'cannot_tell' }, reasons: NO_MEDIA_REASONS },
  { site: 'media-unreadable', expect: { 'MEDIA-01': 'cannot_tell', 'MEDIA-02': 'cannot_tell' }, reasons: NO_MEDIA_REASONS },
];

beforeAll(() => writeImageFixtures());
afterAll(cleanupTmp);

describe('rule outcomes per fixture site', () => {
  for (const c of CASES) {
    it(`${c.site}: ${Object.entries(c.expect).map(([r, o]) => `${r}=${o}`).join(' ')}`, async () => {
      let other: FixtureServer | undefined;
      let server: FixtureServer | undefined;
      try {
        if (c.other) other = await startFixtureServer(c.other);
        server = await startFixtureServer(c.site, { vars: other ? { OTHER_ORIGIN: other.origin } : {} });
        const run = await scanUrl(server.url('/'), c.extra ?? []);
        expectCompletedScan(run, server);
        for (const [rule, outcome] of Object.entries(c.expect)) {
          expect(finding(run, rule).outcome, `${c.site} ${rule}`).toBe(outcome);
        }
        for (const [rule, reason] of Object.entries(c.reasons ?? {})) {
          expect(finding(run, rule).reason, `${c.site} ${rule} reason`).toBe(reason);
        }
        for (const ev of c.evidence ?? []) {
          const hit = finding(run, ev.rule).evidence.find((e) => e.kind === ev.kind && ev.value.test(e.value));
          expect(hit, `${c.site} ${ev.rule} evidence ${ev.kind} ~ ${ev.value}`).toBeDefined();
        }
        // A rule that cannot tell must never be presented as a pass in the report either.
        for (const f of run.report!.findings.filter((x) => x.outcome === 'cannot_tell')) {
          expect(withoutNegatedPass(f.summary)).not.toMatch(/\b(pass|passed|passes|ok|fine)\b/i);
        }
      } finally {
        await server?.close();
        await other?.close();
      }
    });
  }
});

describe('vendor widgets detected from the script tag alone (offline)', () => {
  for (const v of VENDOR_FIXTURES) {
    it(`${v.name}: CHAT-01 found via script, CHAT-02 cannot tell`, async () => {
      const server = await startFixtureServer({ '/': { body: vendorPage(v.src) } });
      try {
        const run = await scanUrl(server.url('/'));
        expectCompletedScan(run, server);
        const c1 = finding(run, 'CHAT-01');
        expect(c1.outcome).toBe('found');
        expect(c1.evidence.some((e) => e.kind === 'script' && e.value.toLowerCase().includes(v.evidenceHint)), 'script evidence names the vendor URL').toBe(true);
        expect(c1.summary.toLowerCase()).toContain('chat widget');
        expect(c1.summary.toLowerCase(), 'must not claim an AI chatbot was detected').not.toMatch(/ai chatbot detected/);
        const c2 = finding(run, 'CHAT-02');
        expect(c2.outcome, 'widget UI is not inspectable offline').toBe('cannot_tell');
        expect(c2.reason).toBe('widget_ui_not_inspectable');
      } finally {
        await server.close();
      }
    });
  }
});
