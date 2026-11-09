import { describe, expect, it } from 'vitest';
import { guardExplanation, templateExplanation } from '../../../src/explain/index.js';
import { MAX_TEXT_LENGTH } from '../../../src/explain/guard.js';
import type { ExplanationItem, Finding } from '../../../src/types.js';
import { makeFinding, makeFindings } from '../report/helpers.js';

const found = makeFinding({ ruleId: 'A', outcome: 'found' });
const notFound = makeFinding({ ruleId: 'B', outcome: 'not_found', evidence: [] });
const cannotTell = makeFinding({ ruleId: 'C', outcome: 'cannot_tell', evidence: [], reason: 'no_widget_detected' });
const findings: Finding[] = [found, notFound, cannotTell];

const good = (): ExplanationItem[] => [
  { ruleId: 'A', text: 'The scan found a chat widget on the pages it read.' },
  { ruleId: 'B', text: 'No matching text was found on the pages the scan could read.' },
  { ruleId: 'C', text: 'The scan could not determine this, so it needs a manual check.' },
];

function withText(ruleId: string, text: string): ExplanationItem[] {
  return good().map((i) => (i.ruleId === ruleId ? { ruleId, text } : i));
}

describe('guardExplanation: ids', () => {
  it('accepts exactly one well-formed item per finding, in any order', () => {
    expect(guardExplanation(findings, good())).toEqual({ ok: true });
    expect(guardExplanation(findings, [...good()].reverse())).toEqual({ ok: true });
  });

  it('rejects unknown, missing and duplicate rule ids', () => {
    expect(guardExplanation(findings, [...good(), { ruleId: 'EXTRA', text: 'The scan found something.' }])).toEqual({ ok: false, reason: 'unknown_rule_id' });
    expect(guardExplanation(findings, good().slice(0, 2))).toEqual({ ok: false, reason: 'missing_rule_id:C' });
    expect(guardExplanation(findings, [...good(), good()[0]!])).toEqual({ ok: false, reason: 'duplicate_rule_id:A' });
    expect(guardExplanation(findings, [])).toEqual({ ok: false, reason: 'missing_rule_id:A' });
  });
});

describe('guardExplanation: length', () => {
  it('rejects empty and over-long text, accepts exactly the limit', () => {
    expect(guardExplanation(findings, withText('A', '   '))).toEqual({ ok: false, reason: 'empty_text:A' });
    const prefix = 'The scan found a widget. ';
    expect(guardExplanation(findings, withText('A', prefix + 'x'.repeat(MAX_TEXT_LENGTH - prefix.length))).ok).toBe(true);
    expect(guardExplanation(findings, withText('A', prefix + 'x'.repeat(MAX_TEXT_LENGTH - prefix.length + 1)))).toEqual({ ok: false, reason: 'text_too_long:A' });
  });
});

describe('guardExplanation: banned phrases', () => {
  it.each([
    'The site is compliant with the rules and a widget was found.',
    'This is non-compliant, though a widget was found.',
    'It is noncompliant: a widget was found.',
    'A widget was found, which violates Article 50.',
    'Found a widget; the violation is serious.',
    'Found a widget, which is illegal.',
    'Found a widget, which is unlawful.',
    'Found a widget; a fine of up to 15 million may apply.',
    'Found a widget; penalties may follow.',
    'Found a widget and the site passes.',
    'Found a widget; the check passed.',
    'Found a widget and the site is certified.',
    'Found a widget under a safe harbor.',
    'Found a widget under a safe harbour.',
    'Found a widget. This is legal advice.',
    'Found a widget. We give legal advice here, not just not-legal advice.',
    'FOUND A WIDGET. COMPLIANT.',
  ])('rejects %s', (text) => {
    expect(guardExplanation(findings, withText('A', text))).toEqual({ ok: false, reason: 'banned_phrase:A' });
  });

  it('allows "legal advice" only inside "not legal advice"', () => {
    expect(guardExplanation(findings, withText('A', 'The scan found a widget. This is not legal advice.')).ok).toBe(true);
    expect(guardExplanation(findings, withText('A', 'The scan found a widget. This is NOT   legal advice.')).ok).toBe(true);
  });

  it('applies the banned list to every outcome', () => {
    expect(guardExplanation(findings, withText('B', 'No widget was found and the site is compliant.')).ok).toBe(false);
    expect(guardExplanation(findings, withText('C', 'The scan could not determine this and nothing is illegal.')).ok).toBe(false);
  });
});

describe('guardExplanation: negated pass wording on cannot_tell', () => {
  it.each([
    'The scan could not determine this. This is not a pass.',
    'The scan could not determine this, which is not a pass.',
    'The scan could not determine this and must not be read as a pass.',
    'THE SCAN COULD NOT DETERMINE THIS: NOT A PASS.',
  ])('allows %s', (text) => {
    expect(guardExplanation(findings, withText('C', text)).ok).toBe(true);
  });

  it.each([
    'The scan could not determine this. It is not a pass, but another check passed.',
    'The scan could not determine this. It is not a pass, or maybe a pass.',
    'The scan could not determine this. Not a pass, but fine.',
    'The scan could not determine this. Not a pass; it is ok.',
    'The scan could not determine this. Not a pass, though no issue was seen.',
  ])('still rejects other pass-like words: %s', (text) => {
    expect(guardExplanation(findings, withText('C', text)).ok).toBe(false);
  });

  it('does not extend the allowance to found or not_found texts', () => {
    expect(guardExplanation(findings, withText('A', 'The scan found a widget. This is not a pass.')).ok).toBe(false);
    expect(guardExplanation(findings, withText('B', 'No match was found. This is not a pass.')).ok).toBe(false);
  });
});

describe('guardExplanation: cannot_tell wording', () => {
  it.each([
    'The scan could not determine this, but it is fine.',
    'The scan could not determine this; it looks ok.',
    'The scan could not determine this; okay for now.',
    'The scan could not determine this, which is good news.',
    'The scan could not determine this; it seems safe.',
    'The scan could not determine this; there is no issue.',
    'The scan could not determine this; no issues expected.',
    'The scan could not determine this, so it is a pass.',
    'The scan could not determine this but is passing.',
  ])('rejects pass-like wording: %s', (text) => {
    const result = guardExplanation(findings, withText('C', text));
    expect(result.ok).toBe(false);
  });

  it('requires an uncertainty word', () => {
    expect(guardExplanation(findings, withText('C', 'The widget text was empty.'))).toEqual({ ok: false, reason: 'cannot_tell_missing_uncertainty:C' });
    expect(guardExplanation(findings, withText('C', 'The scan found nothing useful here.'))).toEqual({ ok: false, reason: 'cannot_tell_missing_uncertainty:C' });
  });

  it.each(['The scan cannot tell.', 'The scan was unable to read it.', 'The result is unclear.', 'It did not determine anything.', 'The answer is undetermined.'])(
    'accepts %s',
    (text) => {
      expect(guardExplanation(findings, withText('C', text)).ok).toBe(true);
    },
  );

  it('does not trip on words that merely contain pass-like letters', () => {
    expect(guardExplanation(findings, withText('C', 'The scan cannot tell: the widget was a bookmark, a definition, and a safeguard.')).ok).toBe(true);
  });
});

describe('guardExplanation: contradicting the outcome', () => {
  it.each([
    'No widget was found on the pages.',
    'The widget was not found.',
    'Nothing was detected.',
    'The scan never detected a widget.',
    'A widget was not detected.',
  ])('rejects a "found" text that says %s', (text) => {
    expect(guardExplanation(findings, withText('A', text))).toEqual({ ok: false, reason: 'contradicts_outcome:A' });
  });

  it.each([
    'A chat widget was found.',
    'The widget was detected on the page.',
    'No match on page one, but the phrase was found on page two.',
    'The disclosure is present.',
    'The scan identified a widget.',
  ])('rejects a "not_found" text that says %s', (text) => {
    expect(guardExplanation(findings, withText('B', text))).toEqual({ ok: false, reason: 'contradicts_outcome:B' });
  });

  it.each(['No match was found.', 'The scan did not detect any phrase.', 'Nothing was detected on the pages read.', 'No phrase is present.', 'The scan saw nothing relevant.'])(
    'accepts a "not_found" text that says %s',
    (text) => {
      expect(guardExplanation(findings, withText('B', text)).ok).toBe(true);
    },
  );
});

describe('templateExplanation', () => {
  it('covers each finding once, in order, and satisfies the guard', () => {
    const sample = makeFindings();
    const items = templateExplanation(sample);
    expect(items.map((i) => i.ruleId)).toEqual(sample.map((f) => f.ruleId));
    expect(guardExplanation(sample, items)).toEqual({ ok: true });
  });

  it('passes the guard for every outcome, reason, and judgement-flag combination', () => {
    const combos: Finding[] = [];
    for (const outcome of ['found', 'not_found', 'cannot_tell'] as const) {
      for (const reason of [undefined, 'no_widget_detected', 'widget_ui_not_inspectable', 'no_images_readable', 'no_flagged_images', 'blocked_by_robots', 'no_pages_loaded']) {
        for (const needsHumanJudgement of [true, false]) {
          combos.push(
            makeFinding({
              ruleId: `R${combos.length}`,
              outcome,
              needsHumanJudgement,
              reason,
              evidence: [],
              summary: { found: 'Chat widget detected: ExampleChat.', not_found: 'No known chat widget detected in the rendered pages.', cannot_tell: 'Nothing to check: no chat widget was detected.' }[outcome],
            }),
          );
        }
      }
    }
    expect(combos).toHaveLength(42);
    expect(guardExplanation(combos, templateExplanation(combos))).toEqual({ ok: true });
    const cannotTell = templateExplanation(combos.filter((f) => f.outcome === 'cannot_tell'));
    expect(cannotTell.every((i) => i.text.includes('not a pass'))).toBe(true);
  });

  it('is deterministic and says "could not determine" for cannot_tell', () => {
    const sample = makeFindings();
    expect(templateExplanation(sample)).toEqual(templateExplanation(sample));
    const text = templateExplanation(sample).find((i) => i.ruleId === 'MEDIA-01')!.text;
    expect(text).toContain('could not determine');
    expect(text).toContain('no_images_readable');
  });
});
