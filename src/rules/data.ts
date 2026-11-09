// Loading and validation of the bundled rule data (src/rules/data/*.json, copied to dist/rules/data).
// Validation runs when this module is first imported, so a broken data file fails loudly in the
// test suite (and on startup) rather than silently during a scan.

import { readFileSync } from 'node:fs';
import { normalizePhrase, type NormalizedPhrase } from './text.js';

const MAX_PATTERN_LENGTH = 200;

export interface VendorEntry {
  readonly id: string;
  readonly name: string;
  readonly scriptPatterns: readonly RegExp[];
  readonly iframePatterns: readonly RegExp[];
  readonly inlinePatterns: readonly RegExp[];
  readonly domPatterns: readonly RegExp[];
}

const PATTERN_FIELDS = ['scriptPatterns', 'iframePatterns', 'inlinePatterns', 'domPatterns'] as const;

export const DISCLOSURE_LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl'] as const;

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(new URL(`./data/${file}`, import.meta.url), 'utf8')) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Conservative guard against catastrophic backtracking: rejects over-long patterns, back-references,
 * and any group that is repeated (+, *, {n,m}) while itself containing a repeat or an alternation.
 */
export function hasUnsafeRepetition(source: string): boolean {
  if (source.length > MAX_PATTERN_LENGTH) return true;
  const groups: { repeats: boolean }[] = [];
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      if (/[1-9k]/.test(source[i + 1] ?? '')) return true;
      i++;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
    } else if (ch === '(') {
      groups.push({ repeats: false });
    } else if (ch === ')') {
      const group = groups.pop();
      const next = source[i + 1];
      const repeated = next === '+' || next === '*' || next === '{';
      if (group?.repeats && repeated) return true;
      const parent = groups[groups.length - 1];
      if (parent && (group?.repeats || repeated)) parent.repeats = true;
    } else if (ch === '+' || ch === '*' || ch === '{' || ch === '|') {
      const current = groups[groups.length - 1];
      if (current) current.repeats = true;
    }
  }
  return false;
}

function compilePattern(source: unknown, where: string): RegExp {
  if (typeof source !== 'string' || source.length === 0) throw new Error(`${where}: pattern must be a non-empty string`);
  if (hasUnsafeRepetition(source)) throw new Error(`${where}: pattern is too long or risks catastrophic backtracking: ${source}`);
  try {
    return new RegExp(source, 'i');
  } catch {
    throw new Error(`${where}: invalid regular expression: ${source}`);
  }
}

export function parseVendorData(raw: unknown, source = 'vendors.json'): VendorEntry[] {
  if (!isRecord(raw) || typeof raw['_comment'] !== 'string' || !Array.isArray(raw['vendors'])) {
    throw new Error(`${source}: expected { _comment: string, vendors: [] }`);
  }
  const ids = new Set<string>();
  return raw['vendors'].map((entry: unknown, position): VendorEntry => {
    const where = `${source}[${position}]`;
    if (!isRecord(entry)) throw new Error(`${where}: vendor must be an object`);
    const { id, name } = entry;
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) throw new Error(`${where}: id must match [a-z0-9-]+`);
    if (typeof name !== 'string' || name.trim() === '') throw new Error(`${where}: name must be a non-empty string`);
    if (ids.has(id)) throw new Error(`${where}: duplicate vendor id ${id}`);
    ids.add(id);
    const compiled: Record<(typeof PATTERN_FIELDS)[number], RegExp[]> = {
      scriptPatterns: [],
      iframePatterns: [],
      inlinePatterns: [],
      domPatterns: [],
    };
    for (const field of PATTERN_FIELDS) {
      const list = entry[field];
      if (!Array.isArray(list)) throw new Error(`${where}.${field}: must be an array`);
      compiled[field] = list.map((pattern: unknown) => compilePattern(pattern, `${where}.${field}`));
    }
    if (PATTERN_FIELDS.every((field) => compiled[field].length === 0)) throw new Error(`${where}: vendor has no patterns`);
    return { id, name, ...compiled };
  });
}

export function parsePhraseData(raw: unknown, source: string, requiredLanguages: readonly string[]): NormalizedPhrase[] {
  if (!isRecord(raw) || typeof raw['_comment'] !== 'string' || !isRecord(raw['languages'])) {
    throw new Error(`${source}: expected { _comment: string, languages: {} }`);
  }
  const languages = raw['languages'];
  for (const lang of requiredLanguages) {
    if (!Array.isArray(languages[lang]) || languages[lang].length === 0) throw new Error(`${source}: missing phrases for language ${lang}`);
  }
  const seen = new Set<string>();
  const phrases: NormalizedPhrase[] = [];
  for (const [lang, list] of Object.entries(languages)) {
    if (!Array.isArray(list)) throw new Error(`${source}.${lang}: must be an array`);
    for (const phrase of list as unknown[]) {
      if (typeof phrase !== 'string' || phrase.trim() === '') throw new Error(`${source}.${lang}: phrases must be non-empty strings`);
      const normalised = normalizePhrase(phrase, lang);
      if (normalised.text.length < 4) throw new Error(`${source}.${lang}: phrase too short to match safely: ${phrase}`);
      if (seen.has(normalised.text)) continue;
      seen.add(normalised.text);
      phrases.push(normalised);
    }
  }
  return phrases;
}

export const VENDORS: readonly VendorEntry[] = parseVendorData(readJson('vendors.json'));
export const DISCLOSURE_PHRASES: readonly NormalizedPhrase[] = parsePhraseData(
  readJson('disclosure-phrases.json'),
  'disclosure-phrases.json',
  DISCLOSURE_LANGUAGES,
);
export const AI_LABEL_PHRASES: readonly NormalizedPhrase[] = parsePhraseData(
  readJson('ai-label-phrases.json'),
  'ai-label-phrases.json',
  DISCLOSURE_LANGUAGES,
);
export const PAGE_PHRASES: readonly NormalizedPhrase[] = parsePhraseData(
  readJson('page-phrases.json'),
  'page-phrases.json',
  DISCLOSURE_LANGUAGES,
);
