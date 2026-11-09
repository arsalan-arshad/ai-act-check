import { describe, expect, it } from 'vitest';
import { canonicalize, hasNonHtmlExtension, isSameSite, priorityScore } from '../../../src/crawler/links.js';

const url = (s: string): URL => new URL(s);

describe('canonicalize', () => {
  it('strips fragments and resolves relative links', () => {
    expect(canonicalize('/about#team', 'https://example.test/x/y')?.toString()).toBe('https://example.test/about');
    expect(canonicalize('page?x=1#top', 'https://example.test/dir/')?.toString()).toBe('https://example.test/dir/page?x=1');
  });

  it('rejects non-web schemes and garbage', () => {
    for (const href of ['mailto:a@b.test', 'tel:+123', 'javascript:void(0)', 'ftp://example.test/x', 'data:text/html,hi', 'http://']) {
      expect(canonicalize(href, 'https://example.test/')).toBeNull();
    }
  });
});

describe('isSameSite', () => {
  it('treats www and apex as the same site, in either direction and across schemes', () => {
    expect(isSameSite(url('https://www.example.test/a'), url('https://example.test/'))).toBe(true);
    expect(isSameSite(url('https://example.test/a'), url('https://www.example.test/'))).toBe(true);
    expect(isSameSite(url('http://example.test/a'), url('https://example.test/'))).toBe(true);
  });

  it('is case-insensitive on the host', () => {
    expect(isSameSite(url('https://EXAMPLE.test/'), url('https://example.test/'))).toBe(true);
  });

  it('rejects other hosts, subdomains and other ports', () => {
    expect(isSameSite(url('https://other.test/'), url('https://example.test/'))).toBe(false);
    expect(isSameSite(url('https://blog.example.test/'), url('https://example.test/'))).toBe(false);
    expect(isSameSite(url('https://example.test.evil.test/'), url('https://example.test/'))).toBe(false);
    expect(isSameSite(url('http://127.0.0.1:3000/'), url('http://127.0.0.1:3001/'))).toBe(false);
  });
});

describe('hasNonHtmlExtension', () => {
  it('flags documents, images, archives and assets', () => {
    for (const path of ['/a.pdf', '/b.JPG', '/c.zip', '/d.png', '/e.mp4', '/f.css', '/g/h.js', '/i.docx']) {
      expect(hasNonHtmlExtension(url(`https://example.test${path}`))).toBe(true);
    }
  });

  it('keeps html-like and extensionless paths', () => {
    for (const path of ['/', '/about', '/about/', '/page.html', '/page.php', '/v1.2/docs', '/.well-known']) {
      expect(hasNonHtmlExtension(url(`https://example.test${path}`))).toBe(false);
    }
  });
});

describe('priorityScore', () => {
  it('prefers shorter paths', () => {
    expect(priorityScore(url('https://example.test/a'), '')).toBeLessThan(priorityScore(url('https://example.test/a/b/c'), ''));
  });

  it('prefers links whose path or text suggests AI, privacy, about, contact, help, legal', () => {
    const plain = priorityScore(url('https://example.test/products'), 'Products');
    for (const [path, text] of [
      ['/privacy', ''],
      ['/about-us', ''],
      ['/ai-policy', ''],
      ['/products', 'Contact us'],
      ['/products', 'AI transparency'],
      ['/products', 'Hilfe & Support'],
      ['/products', 'Impressum'],
      ['/x', 'Terms of service'],
    ] as const) {
      expect(priorityScore(url(`https://example.test${path}`), text)).toBeLessThan(
        path === '/x' ? priorityScore(url('https://example.test/x'), 'Shop') : plain,
      );
    }
  });

  it('does not treat words that merely contain a keyword as keyword hits', () => {
    expect(priorityScore(url('https://example.test/mail'), 'Daily mail')).toBe(priorityScore(url('https://example.test/shop'), 'Shop'));
  });

  it('penalises query strings slightly', () => {
    expect(priorityScore(url('https://example.test/a?x=1'), '')).toBeGreaterThan(priorityScore(url('https://example.test/a'), ''));
  });
});
