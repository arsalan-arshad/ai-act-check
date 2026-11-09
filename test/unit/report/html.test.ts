import { describe, expect, it } from 'vitest';
import { DISCLAIMER, renderHtml } from '../../../src/report/index.js';
import { escapeHtml } from '../../../src/util/escape.js';
import { makeCrawl, makeFinding, makeFindings, makeReport, makePage } from './helpers.js';

const XSS = '<script>alert(1)</script>';

function hostileReport() {
  const finding = makeFinding({
    ruleId: `CHAT-01"><img src=x onerror=alert(1)>`,
    title: `${XSS} "title" 'q'`,
    summary: `${XSS} & <b>bold</b>`,
    reason: `<i>reason</i>`,
    evidence: [
      { url: 'javascript:alert(1)', kind: 'link', value: 'javascript:alert(2)', capturedAt: 'x"onmouseover="alert(3)' },
      { url: 'http://127.0.0.1:9/"><script>alert(4)</script>', kind: 'text', value: `${XSS}'"`, capturedAt: '2026-01-02T03:04:05.000Z' },
      { url: 'http://127.0.0.1:9/', kind: 'screenshot', value: 'javascript:alert(5)', capturedAt: '2026-01-02T03:04:05.000Z' },
      { url: 'http://127.0.0.1:9/', kind: 'screenshot', value: '../../etc/passwd', capturedAt: '2026-01-02T03:04:05.000Z' },
      { url: 'http://127.0.0.1:9/', kind: 'screenshot', value: 'screenshots/page-1.png', capturedAt: '2026-01-02T03:04:05.000Z' },
    ],
    pagesEvaluated: ['javascript:alert(6)'],
  });
  const crawl = makeCrawl({
    startUrl: 'javascript:alert(7)',
    startBlocked: null,
    pages: [makePage({ url: `http://x/${XSS}`, finalUrl: 'data:text/html,<script>alert(8)</script>', screenshot: 'javascript:alert(9)' })],
    skipped: [{ url: XSS, reason: 'load_failed', detail: `"><svg onload=alert(10)>` }],
    userAgent: `UA ${XSS}`,
  });
  const report = makeReport([finding], crawl);
  report.explanation = { source: 'template', items: [{ ruleId: 'CHAT-01', text: XSS }], guardRejected: XSS };
  report.ruleCatalog = [{ ruleId: XSS, title: XSS, description: XSS, limitations: XSS, legalNote: XSS }];
  return report;
}

describe('renderHtml escaping', () => {
  const html = renderHtml(hostileReport());

  it('never emits a raw script tag or event-handler attribute from data', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<svg onload');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).not.toContain('<i>reason</i>');
    expect(html).not.toMatch(/<[^>]*\son(?:error|mouseover|load)=/i);
  });

  it('renders hostile text as escaped text', () => {
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;title&quot;');
    expect(html).toContain('&#39;q&#39;');
  });

  it('never turns javascript:/data: URLs into href or src values', () => {
    expect(html).not.toMatch(/(?:href|src)="(?:javascript|data):/i);
    expect(html).not.toMatch(/(?:href|src)='(?:javascript|data):/i);
  });

  it('only links screenshots with plain relative paths', () => {
    expect(html).toContain('<img class="shot" src="screenshots/page-1.png"');
    expect(html).not.toContain('src="../../etc/passwd"');
    expect(html).not.toContain('src="javascript:');
  });

  it('contains only the markup the template creates (no injected extra tags)', () => {
    const tags = new Set([...html.matchAll(/<\/?([a-z][a-z0-9]*)/gi)].map((m) => m[1]!.toLowerCase()));
    expect([...tags].sort()).toEqual(
      ['a', 'article', 'aside', 'body', 'br', 'caption', 'code', 'dd', 'div', 'dl', 'dt', 'footer', 'h1', 'h2', 'h3', 'head', 'header', 'html', 'img', 'li', 'main', 'meta', 'ol', 'p', 'section', 'span', 'strong', 'style', 'table', 'tbody', 'td', 'th', 'thead', 'time', 'title', 'tr', 'ul'].sort(),
    );
  });
});

describe('renderHtml structure', () => {
  const report = makeReport(makeFindings());
  const html = renderHtml(report);

  it('is a self-contained HTML5 document with no external requests or scripts', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('name="viewport"');
    expect(html).not.toMatch(/<script|<link|<iframe|@import|url\(/i);
    expect(html).not.toMatch(/(?:src|href)="https?:\/\/(?!127\.0\.0\.1)/);
  });

  it('puts the disclaimer at the top (before main) and at the bottom (after main)', () => {
    const escaped = escapeHtml(DISCLAIMER);
    const first = html.indexOf(escaped);
    const last = html.lastIndexOf(escaped);
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(html.indexOf('<main>'));
    expect(last).toBeGreaterThan(html.indexOf('</main>'));
    expect(html.split(escaped)).toHaveLength(3);
  });

  it('labels outcomes with text, and cannot tell as not a pass', () => {
    expect(html).toContain('<span class="badge found">Found</span>');
    expect(html).toContain('<span class="badge not_found">Not found</span>');
    expect(html).toContain('<span class="badge cannot_tell">Cannot tell (not a pass)</span>');
    expect(html).toContain('<strong>2</strong> cannot tell (not a pass)');
  });

  it('renders an evidence table, thumbnails and the pages-checked list', () => {
    expect(html).toContain('<caption>Evidence for CHAT-01 (1 item)</caption>');
    expect(html).toContain('<th scope="col">Kind</th>');
    expect(html).toContain('<h2 id="pages">Pages checked</h2>');
    expect(html).toContain('<img class="shot" src="screenshots/page-1.png" alt="Screenshot of http://127.0.0.1:9/"');
    expect(html).toContain('No evidence items were recorded for this finding.');
  });

  it('shows human-judgement notes, reason codes, limitations and the rule catalog', () => {
    expect(html).toContain('Needs human judgement');
    expect(html).toContain('<code>no_images_readable</code>');
    expect(html).toContain('What this scan cannot see');
    expect(html).toContain('<h2 id="catalog">Rule catalog</h2>');
    expect(html).toContain('Legal note (unverified, not legal advice)');
  });

  it('omits the explanation section without an explanation and labels its source with one', () => {
    expect(html).not.toContain('Plain-language explanation');
    const withExplanation = renderHtml({
      ...report,
      explanation: { source: 'openai', model: 'gpt-x', items: [{ ruleId: 'CHAT-01', text: 'Some text.' }] },
    });
    expect(withExplanation).toContain('Source: model provider openai, model gpt-x.');
    expect(withExplanation).toContain('cannot add, remove or change any of them');
    const fallback = renderHtml({
      ...report,
      explanation: { source: 'template', items: [], guardRejected: 'guard:banned_phrase:CHAT-01' },
    });
    expect(fallback).toContain('deterministic template (no model used)');
    expect(fallback).toContain('guard:banned_phrase:CHAT-01');
  });

  it('notes a blocked start and an empty page list', () => {
    const blocked = renderHtml(makeReport([makeFinding({ outcome: 'cannot_tell', reason: 'blocked_by_robots' })], makeCrawl({ pages: [], startBlocked: 'robots_disallow' })));
    expect(blocked).toContain('No pages were loaded.');
    expect(blocked).toContain('<code>robots_disallow</code>');
  });

  it('caps the skipped list', () => {
    const skipped = Array.from({ length: 60 }, (_, i) => ({ url: `http://127.0.0.1:9/p${i}`, reason: 'duplicate' as const }));
    const capped = renderHtml(makeReport(makeFindings(), makeCrawl({ skipped })));
    expect(capped).toContain('URLs not visited (60)');
    expect(capped).toContain('10 more not shown');
    expect(capped).not.toContain('/p59');
  });
});
