import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AI_LABEL_PHRASES,
  DISCLOSURE_LANGUAGES,
  DISCLOSURE_PHRASES,
  PAGE_PHRASES,
  VENDORS,
  hasUnsafeRepetition,
  parsePhraseData,
  parseVendorData,
} from '../../../src/rules/data.js';

const rawVendors = JSON.parse(readFileSync(new URL('../../../src/rules/data/vendors.json', import.meta.url), 'utf8')) as {
  _comment: string;
  vendors: Record<string, string[]>[];
};

const validVendor = { id: 'x', name: 'X', scriptPatterns: ['x\\.test'], iframePatterns: [], inlinePatterns: [], domPatterns: [] };

describe('vendor data', () => {
  it('has at least 30 vendors with unique ids and non-empty names', () => {
    expect(VENDORS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(VENDORS.map((v) => v.id)).size).toBe(VENDORS.length);
    for (const vendor of VENDORS) expect(vendor.name.trim()).not.toBe('');
  });

  it('gives every vendor at least one pattern and compiles every regex', () => {
    for (const vendor of VENDORS) {
      const all = [...vendor.scriptPatterns, ...vendor.iframePatterns, ...vendor.inlinePatterns, ...vendor.domPatterns];
      expect(all.length, vendor.id).toBeGreaterThan(0);
      for (const pattern of all) expect(pattern).toBeInstanceOf(RegExp);
    }
  });

  it('contains the vendors named in the contract', () => {
    const names = VENDORS.map((v) => v.name.toLowerCase()).join('|');
    for (const expected of ['intercom', 'drift', 'tidio', 'crisp', 'zendesk', 'hubspot', 'livechat', 'tawk', 'freshchat', 'olark', 'gorgias', 'botpress', 'voiceflow', 'landbot', 'chatbase', 'ada', 'kommunicate', 'smartsupp', 'userlike', 'zoho', 'liveperson', 'salesforce', 'dialogflow', 'watsonx', 'copilot', 'respond.io', 'jivochat', 'chatbot.com', 'botsonic', 'quriobot', 'certainly', 'tars', 'pandorabots', 'sendbird', 'smooch', 'front chat', 'help scout', 'chatwoot', 'rasa']) {
      expect(names, expected).toContain(expected);
    }
  });

  it('declares in _comment that the patterns are best-effort and unverified', () => {
    expect(rawVendors._comment).toMatch(/best-effort/i);
    expect(rawVendors._comment).toMatch(/unverified/i);
  });

  it('keeps every pattern linear-time safe on a hostile 5000 character input', () => {
    const hostile = `${'a'.repeat(2500)}${'-_.'.repeat(800)}!`;
    const started = Date.now();
    for (const vendor of VENDORS) {
      for (const pattern of [...vendor.scriptPatterns, ...vendor.iframePatterns, ...vendor.inlinePatterns, ...vendor.domPatterns]) {
        pattern.test(hostile);
      }
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('rejects invalid regular expressions at load', () => {
    expect(() => parseVendorData({ _comment: 'c', vendors: [{ ...validVendor, scriptPatterns: ['(unclosed'] }] })).toThrow(/invalid regular expression/);
  });

  it('rejects catastrophic-backtracking patterns at load', () => {
    for (const pattern of ['(a+)+$', '(a|ab)*c', '(.*)*x', '(\\w+\\s?)+$', '(a)\\1']) {
      expect(() => parseVendorData({ _comment: 'c', vendors: [{ ...validVendor, scriptPatterns: [pattern] }] }), pattern).toThrow(/backtracking/);
    }
  });

  it('rejects duplicate ids, missing patterns and malformed shapes', () => {
    expect(() => parseVendorData({ _comment: 'c', vendors: [validVendor, validVendor] })).toThrow(/duplicate vendor id/);
    expect(() => parseVendorData({ _comment: 'c', vendors: [{ ...validVendor, scriptPatterns: [] }] })).toThrow(/no patterns/);
    expect(() => parseVendorData({ _comment: 'c', vendors: [{ ...validVendor, scriptPatterns: 'x' }] })).toThrow(/must be an array/);
    expect(() => parseVendorData({ vendors: [] })).toThrow(/expected/);
    expect(() => parseVendorData({ _comment: 'c', vendors: [{ ...validVendor, id: 'Bad Id' }] })).toThrow(/id must match/);
  });
});

describe('hasUnsafeRepetition', () => {
  it('accepts ordinary fingerprints', () => {
    for (const pattern of ['widget\\.intercom\\.io', '^intercom-(?:lightweight-app|container)', 'salesiq\\.zoho\\.[a-z.]+', 'watsonx?Assistant', '^(?:foo)?bar']) {
      expect(hasUnsafeRepetition(pattern), pattern).toBe(false);
    }
  });

  it('rejects over-long patterns', () => {
    expect(hasUnsafeRepetition('a'.repeat(201))).toBe(true);
  });

  it('rejects a repeat nested through a non-repeated group', () => {
    expect(hasUnsafeRepetition('((a+)b)*')).toBe(true);
  });
});

describe('phrase data', () => {
  const sets = { disclosure: DISCLOSURE_PHRASES, aiLabel: AI_LABEL_PHRASES, page: PAGE_PHRASES };

  for (const [name, phrases] of Object.entries(sets)) {
    it(`${name} phrases cover the eight languages`, () => {
      const langs = new Set(phrases.map((p) => p.lang));
      for (const lang of DISCLOSURE_LANGUAGES) expect(langs.has(lang), `${name}:${lang}`).toBe(true);
    });

    it(`${name} phrases are normalised and unique`, () => {
      const texts = phrases.map((p) => p.text);
      expect(new Set(texts).size).toBe(texts.length);
      for (const text of texts) expect(text).toBe(text.toLowerCase());
    });
  }

  it('rejects missing languages, empty phrases and too-short phrases', () => {
    expect(() => parsePhraseData({ _comment: 'c', languages: { en: ['chatbot'] } }, 'x.json', ['en', 'de'])).toThrow(/missing phrases for language de/);
    expect(() => parsePhraseData({ _comment: 'c', languages: { en: [' '] } }, 'x.json', ['en'])).toThrow(/non-empty/);
    expect(() => parsePhraseData({ _comment: 'c', languages: { en: ['ai'] } }, 'x.json', ['en'])).toThrow(/too short/);
    expect(() => parsePhraseData({ languages: {} }, 'x.json', [])).toThrow(/expected/);
  });

  it('drops duplicates that normalise to the same text', () => {
    const parsed = parsePhraseData({ _comment: 'c', languages: { en: ['AI-generated', 'ai generated'] } }, 'x.json', ['en']);
    expect(parsed).toHaveLength(1);
  });
});
