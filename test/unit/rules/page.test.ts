import { describe, expect, it } from 'vitest';
import { runRules } from '../../../src/rules/index.js';
import type { LinkInfo, PageSnapshot } from '../../../src/types.js';
import { link, makeCrawl, makePage } from './helpers.js';

const page01 = (pages: PageSnapshot[]) => runRules(makeCrawl(pages)).find((f) => f.ruleId === 'PAGE-01')!;
const withLinks = (...links: LinkInfo[]) => makePage({ links });

describe('PAGE-01', () => {
  it('found: link text', () => {
    const f = page01([withLinks(link('https://example.test/legal/ai', 'Our AI Policy'))]);
    expect(f.outcome).toBe('found');
    expect(f.needsHumanJudgement).toBe(true);
    expect(f.evidence[0]).toMatchObject({ kind: 'link', url: 'https://example.test/' });
    expect(f.evidence[0]?.value).toContain('https://example.test/legal/ai');
    expect(f.summary).toMatch(/only the presence of a link/);
  });

  it('found: link address only', () => {
    const f = page01([withLinks(link('https://example.test/legal/ai-transparency', 'Read more'))]);
    expect(f.outcome).toBe('found');
    expect(f.evidence[0]?.value).toContain('link address');
  });

  it.each([
    ['KI-Richtlinie'],
    ['Künstliche Intelligenz'],
    ['Intelligence artificielle'],
    ['Inteligencia artificial'],
    ['Intelligenza artificiale'],
    ['Kunstmatige intelligentie'],
    ['Inteligência artificial'],
    ['Sztuczna inteligencja'],
    ['AI Act'],
    ['Responsible AI'],
    ['AI use'],
    ['AI disclosure'],
  ])('found: link text "%s"', (text) => {
    expect(page01([withLinks(link('https://example.test/x', text))]).outcome).toBe('found');
  });

  it('is accent-insensitive', () => {
    expect(page01([withLinks(link('https://example.test/x', 'KUNSTLICHE INTELLIGENZ'))]).outcome).toBe('found');
    expect(page01([withLinks(link('https://example.test/x', 'inteligencia artifícial'))]).outcome).toBe('found');
  });

  it('found: encoded non-ASCII URL path', () => {
    const f = page01([withLinks(link('https://example.test/k%C3%BCnstliche-intelligenz', 'Mehr'))]);
    expect(f.outcome).toBe('found');
  });

  it('not_found: unrelated links, with the crawled-pages limitation stated', () => {
    const f = page01([withLinks(link('https://example.test/privacy', 'Privacy'), link('https://example.test/contact', 'Contact'))]);
    expect(f.outcome).toBe('not_found');
    expect(f.needsHumanJudgement).toBe(true);
    expect(f.summary).toMatch(/not crawled were not checked/);
    expect(f.evidence.map((e) => e.kind)).toEqual(['text']);
    expect(f.evidence[0]?.value).toMatch(/^Checked https:\/\/example\.test\/: 2 links compared with \d+ AI-use phrases/);
    expect(f.evidence[0]?.capturedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('does not match "ai" inside other words or malformed hrefs', () => {
    const f = page01([withLinks(link('https://example.test/maintain', 'Maintain AIR quality'), link('not a url', 'Contact'), link('https://example.test/%E0%A4%A', 'Said use'))]);
    expect(f.outcome).toBe('not_found');
  });

  it('dedupes a link repeated on several pages and searches every page', () => {
    const shared = link('https://example.test/ai-policy', 'AI Policy');
    const f = page01([withLinks(shared), makePage({ url: 'https://example.test/b', links: [shared, link('https://example.test/ai-act', 'AI Act')] })]);
    expect(f.outcome).toBe('found');
    expect(f.evidence).toHaveLength(2);
    expect(f.evidence[1]?.url).toBe('https://example.test/b');
    expect(f.pagesEvaluated).toEqual(['https://example.test/', 'https://example.test/b']);
  });

  it('caps evidence at 20 and notes the cap', () => {
    const links = Array.from({ length: 25 }, (_, i) => link(`https://example.test/ai-policy-${i}`, `AI policy ${i}`));
    const f = page01([makePage({ links, screenshot: 'screenshots/page-1.png' })]);
    expect(f.evidence).toHaveLength(20);
    expect(f.evidence.at(-1)?.kind).toBe('screenshot');
    expect(f.summary).toMatch(/capped at 20 items; 6 more matches/);
  });
});
