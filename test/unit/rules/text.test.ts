import { describe, expect, it } from 'vitest';
import { excerptAround, findFirstPhrase, normalizePhrase, normalizeText } from '../../../src/rules/text.js';

const phrases = (...list: string[]) => list.map((phrase) => normalizePhrase(phrase, 'en'));

describe('normalizeText', () => {
  it('lower-cases, strips accents and collapses whitespace', () => {
    expect(normalizeText('  Généré   PAR\n\tIA ').text).toBe('genere par ia');
  });

  it('treats hyphens and underscores as spaces and curly apostrophes as straight', () => {
    expect(normalizeText('AI-generated_image').text).toBe('ai generated image');
    expect(normalizeText('dall’e').text).toBe("dall'e");
  });

  it('removes zero-width characters and expands compatibility forms', () => {
    expect(normalizeText('A​I ﬁne').text).toBe('ai fine');
  });

  it('keeps a map back to the original offsets', () => {
    const n = normalizeText('  É  x');
    expect(n.text).toBe('e x');
    expect(n.map).toEqual([2, 3, 5]);
  });

  it('caps very long input', () => {
    expect(normalizeText('a'.repeat(100_000)).text.length).toBeLessThanOrEqual(20_000);
  });
});

describe('findFirstPhrase', () => {
  it('matches whole words only', () => {
    const list = phrases('ai assistant');
    expect(findFirstPhrase(normalizeText('Our AI assistant helps'), list)).not.toBeNull();
    expect(findFirstPhrase(normalizeText('Our AI assistants help'), list)).toBeNull();
    expect(findFirstPhrase(normalizeText('MAI assistant'), list)).toBeNull();
  });

  it('does not match a phrase inside another word', () => {
    const list = phrases('chatbot');
    expect(findFirstPhrase(normalizeText('robotics and abbot'), list)).toBeNull();
    expect(findFirstPhrase(normalizeText('chatbotics'), list)).toBeNull();
    expect(findFirstPhrase(normalizeText('Chatbot.'), list)).not.toBeNull();
  });

  it('finds a later whole-word occurrence after a partial one', () => {
    const match = findFirstPhrase(normalizeText('chatbotics then chatbot'), phrases('chatbot'));
    expect(match?.start).toBe(16);
  });

  it('prefers the earliest match, then the longest', () => {
    const match = findFirstPhrase(normalizeText('virtual assistant bot'), phrases('virtual', 'virtual assistant'));
    expect(match?.phrase.phrase).toBe('virtual assistant');
  });

  it('is accent- and case-insensitive on both sides', () => {
    expect(findFirstPhrase(normalizeText('ESTAS HABLANDO CON UNA IA'), phrases('estás hablando con una ia'))).not.toBeNull();
  });

  it('returns null for empty haystacks', () => {
    expect(findFirstPhrase(normalizeText(''), phrases('chatbot'))).toBeNull();
  });
});

describe('excerptAround', () => {
  it('returns the original text around the match with ellipses', () => {
    const original = `${'x'.repeat(100)} You are chatting with an AI ${'y'.repeat(100)}`;
    const n = normalizeText(original);
    const match = findFirstPhrase(n, phrases('chatting with an ai'));
    expect(match).not.toBeNull();
    const excerpt = excerptAround(n, match!, 10);
    expect(excerpt.startsWith('...')).toBe(true);
    expect(excerpt.endsWith('...')).toBe(true);
    expect(excerpt).toContain('chatting with an AI');
  });
});
