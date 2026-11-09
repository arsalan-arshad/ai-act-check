// Shared text helpers for the rules: accent-, case- and punctuation-insensitive phrase matching.
// Phrase matching uses indexOf plus explicit boundary checks (no dynamically built regexes), so
// it is linear in the input size and cannot backtrack catastrophically.

/** Inputs longer than this are cut before normalising; widget and link texts are far shorter. */
const MAX_NORMALISED_INPUT = 20_000;

const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE = /\s/u;
const FORMAT_CHARS = /\p{Cf}/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;
// Hyphens, dashes and underscores act as spaces so "AI-generated" equals "AI generated".
const SEPARATORS = new Set(['-', '‐', '‑', '‒', '–', '—', '_']);
const APOSTROPHES = new Set(['’', '‘', 'ʼ', '`', '´']);

export interface NormalizedText {
  readonly original: string;
  /** Lower-cased, accent-stripped, whitespace-collapsed text. */
  readonly text: string;
  /** map[i] is the index in `original` of the character that produced text[i]. */
  readonly map: readonly number[];
}

export interface NormalizedPhrase {
  /** The phrase as written in the data file. */
  readonly phrase: string;
  /** The phrase after normalisation. */
  readonly text: string;
  readonly lang: string;
}

export interface PhraseMatch {
  readonly phrase: NormalizedPhrase;
  /** Offsets into NormalizedText.text. */
  readonly start: number;
  readonly end: number;
}

function foldChar(ch: string): string {
  if (WHITESPACE.test(ch) || SEPARATORS.has(ch)) return ' ';
  if (FORMAT_CHARS.test(ch)) return '';
  if (APOSTROPHES.has(ch)) return "'";
  return ch
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '');
}

export function normalizeText(input: string): NormalizedText {
  const original = input.length > MAX_NORMALISED_INPUT ? input.slice(0, MAX_NORMALISED_INPUT) : input;
  let text = '';
  const map: number[] = [];
  let lastWasSpace = true; // drops leading whitespace
  let index = 0;
  for (const ch of original) {
    const start = index;
    index += ch.length;
    for (const folded of foldChar(ch)) {
      if (folded === ' ') {
        if (lastWasSpace) continue;
        lastWasSpace = true;
      } else {
        lastWasSpace = false;
      }
      text += folded;
      for (let unit = 0; unit < folded.length; unit++) map.push(start);
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { original, text, map };
}

export function normalizePhrase(phrase: string, lang: string): NormalizedPhrase {
  return { phrase, text: normalizeText(phrase).text, lang };
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * Earliest whole-word match of any phrase; on equal start the longest phrase wins.
 * A match must not be preceded or followed by a letter or digit.
 */
export function findFirstPhrase(haystack: NormalizedText, phrases: readonly NormalizedPhrase[]): PhraseMatch | null {
  const { text } = haystack;
  let best: PhraseMatch | null = null;
  for (const phrase of phrases) {
    if (phrase.text.length === 0) continue;
    let from = 0;
    for (;;) {
      const start = text.indexOf(phrase.text, from);
      if (start === -1) break;
      const end = start + phrase.text.length;
      if (!isWordChar(text[start - 1]) && !isWordChar(text[end])) {
        if (best === null || start < best.start || (start === best.start && end > best.end)) {
          best = { phrase, start, end };
        }
        break;
      }
      from = start + 1;
    }
  }
  return best;
}

/** A short single-line excerpt of the original text around a match. */
export function excerptAround(haystack: NormalizedText, match: PhraseMatch, context = 40): string {
  const first = haystack.map[match.start] ?? 0;
  const lastIndex = haystack.map[match.end - 1] ?? first;
  const from = Math.max(0, first - context);
  const to = Math.min(haystack.original.length, lastIndex + 1 + context);
  const snippet = haystack.original.slice(from, to).replace(/\s+/gu, ' ').trim();
  return `${from > 0 ? '...' : ''}${snippet}${to < haystack.original.length ? '...' : ''}`;
}

export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
