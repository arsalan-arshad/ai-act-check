import { describe, expect, it } from 'vitest';
import { parseRobots } from '../../../src/crawler/index.js';

describe('parseRobots', () => {
  it('allows everything for an empty file or an empty Disallow', () => {
    expect(parseRobots('').isAllowed('/anything')).toBe(true);
    expect(parseRobots('User-agent: *\nDisallow:').isAllowed('/anything')).toBe(true);
  });

  it('blocks a path prefix for the wildcard group', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private');
    expect(rules.isAllowed('/private')).toBe(false);
    expect(rules.isAllowed('/private/page')).toBe(false);
    expect(rules.isAllowed('/privateer')).toBe(false);
    expect(rules.isAllowed('/public')).toBe(true);
  });

  it('blocks the whole site with Disallow: /', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /');
    expect(rules.isAllowed('/')).toBe(false);
    expect(rules.isAllowed('/a/b?c=d')).toBe(false);
  });

  it('always allows /robots.txt itself', () => {
    expect(parseRobots('User-agent: *\nDisallow: /').isAllowed('/robots.txt')).toBe(true);
  });

  it('uses longest-match precedence between Allow and Disallow', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /docs\nAllow: /docs/public');
    expect(rules.isAllowed('/docs/secret')).toBe(false);
    expect(rules.isAllowed('/docs/public/page')).toBe(true);
    expect(rules.isAllowed('/docs')).toBe(false);
  });

  it('lets a longer Disallow beat a shorter Allow', () => {
    const rules = parseRobots('User-agent: *\nAllow: /a\nDisallow: /a/b');
    expect(rules.isAllowed('/a/x')).toBe(true);
    expect(rules.isAllowed('/a/b/c')).toBe(false);
  });

  it('lets Allow win when pattern lengths are equal', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /page\nAllow: /page');
    expect(rules.isAllowed('/page')).toBe(true);
  });

  it('supports * wildcards', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /*/private\nDisallow: /search*q=');
    expect(rules.isAllowed('/en/private')).toBe(false);
    expect(rules.isAllowed('/en/public')).toBe(true);
    expect(rules.isAllowed('/search?x=1&q=2')).toBe(false);
    expect(rules.isAllowed('/search?x=1')).toBe(true);
  });

  it('supports the $ end anchor', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /exact$');
    expect(rules.isAllowed('/files/a.pdf')).toBe(false);
    expect(rules.isAllowed('/files/a.pdf?download=1')).toBe(true);
    expect(rules.isAllowed('/exact')).toBe(false);
    expect(rules.isAllowed('/exact/more')).toBe(true);
  });

  it('treats regex metacharacters in patterns literally', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /a.b(c)+');
    expect(rules.isAllowed('/a.b(c)+')).toBe(false);
    expect(rules.isAllowed('/aXb(c)+')).toBe(true);
  });

  it('prefers a group naming our product token over the wildcard group', () => {
    const text = 'User-agent: *\nDisallow: /\n\nUser-agent: ai-act-check\nDisallow: /secret';
    const rules = parseRobots(text);
    expect(rules.isAllowed('/open')).toBe(true);
    expect(rules.isAllowed('/secret')).toBe(false);
  });

  it('matches the product token case-insensitively and shares one group across several User-agent lines', () => {
    const text = 'User-agent: Googlebot\nUser-agent: AI-ACT-CHECK\nDisallow: /shared';
    expect(parseRobots(text).isAllowed('/shared')).toBe(false);
    expect(parseRobots(text).isAllowed('/other')).toBe(true);
  });

  it('ignores groups for other agents', () => {
    const rules = parseRobots('User-agent: Googlebot\nDisallow: /');
    expect(rules.isAllowed('/')).toBe(true);
  });

  it('does not treat a longer agent name as ours', () => {
    expect(parseRobots('User-agent: ai-act-check-pro\nDisallow: /').isAllowed('/')).toBe(true);
  });

  it('reads Crawl-delay from the applicable group only', () => {
    const text = 'User-agent: *\nCrawl-delay: 3\n\nUser-agent: ai-act-check\nCrawl-delay: 7\n\nUser-agent: other\nCrawl-delay: 99';
    expect(parseRobots(text).crawlDelaySeconds).toBe(7);
    expect(parseRobots('User-agent: *\nCrawl-delay: 2.5').crawlDelaySeconds).toBe(2.5);
    expect(parseRobots('User-agent: other\nCrawl-delay: 5').crawlDelaySeconds).toBeNull();
  });

  it('ignores invalid Crawl-delay values', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: soon').crawlDelaySeconds).toBeNull();
    expect(parseRobots('User-agent: *\nCrawl-delay: -4').crawlDelaySeconds).toBeNull();
  });

  it('handles comments, BOM, CRLF, odd casing and spacing', () => {
    const text = '﻿# a comment\r\nUSER-AGENT:   *   # everyone\r\n  disallow :  /x # trailing\r\nSitemap: https://example.test/sitemap.xml\r\n';
    const rules = parseRobots(text);
    expect(rules.isAllowed('/x/y')).toBe(false);
    expect(rules.isAllowed('/y')).toBe(true);
  });

  it('ignores rules that appear before any User-agent line and unknown fields', () => {
    const rules = parseRobots('Disallow: /\nHost: example.test\nUser-agent: *\nDisallow: /b');
    expect(rules.isAllowed('/a')).toBe(true);
    expect(rules.isAllowed('/b')).toBe(false);
  });

  it('merges several groups that name the same agent', () => {
    const text = 'User-agent: ai-act-check\nDisallow: /one\n\nUser-agent: ai-act-check\nDisallow: /two';
    const rules = parseRobots(text);
    expect(rules.isAllowed('/one')).toBe(false);
    expect(rules.isAllowed('/two')).toBe(false);
  });

  it('matches against path plus query', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /p?id=');
    expect(rules.isAllowed('/p?id=3')).toBe(false);
    expect(rules.isAllowed('/p')).toBe(true);
  });
});
