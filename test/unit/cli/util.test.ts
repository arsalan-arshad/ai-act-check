import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../../src/util/escape.js';
import { deepFreeze } from '../../../src/util/freeze.js';
import { redactSecrets } from '../../../src/util/redact.js';
import { defaultUserAgent, getVersion } from '../../../src/util/version.js';

describe('version', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(getVersion()).toBe(pkg.version);
  });

  it('builds the documented honest User-Agent', () => {
    expect(defaultUserAgent()).toBe(`ai-act-check/${getVersion()} (open-source technical scanner; not legal advice)`);
  });
});

describe('escapeHtml', () => {
  it('escapes the five dangerous characters, ampersand first', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&amp;</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;amp;&lt;/a&gt;');
  });

  it('leaves safe text alone', () => {
    expect(escapeHtml('plain text 123 äöü')).toBe('plain text 123 äöü');
  });
});

describe('deepFreeze', () => {
  it('freezes nested objects and arrays so mutation throws', () => {
    const value = deepFreeze({ a: [{ b: 1 }], c: { d: 'x' } });
    expect(() => {
      value.a[0]!.b = 2;
    }).toThrow(TypeError);
    expect(() => {
      value.a.push({ b: 3 });
    }).toThrow(TypeError);
    expect(Object.isFrozen(value.c)).toBe(true);
  });

  it('handles primitives and shared references', () => {
    expect(deepFreeze(5)).toBe(5);
    const shared = { x: 1 };
    expect(Object.isFrozen(deepFreeze({ p: shared, q: shared }).p)).toBe(true);
  });
});

describe('redactSecrets', () => {
  it('replaces every occurrence of the key', () => {
    expect(redactSecrets('a SECRET-KEY-123 b SECRET-KEY-123', { LLM_API_KEY: 'SECRET-KEY-123' })).toBe('a [redacted] b [redacted]');
  });

  it('does nothing without a key, and ignores keys too short to be safe to replace', () => {
    expect(redactSecrets('hello', {})).toBe('hello');
    expect(redactSecrets('hello e', { LLM_API_KEY: 'e' })).toBe('hello e');
  });
});
