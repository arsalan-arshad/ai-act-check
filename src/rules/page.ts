// PAGE-01: a link that points to an AI-use / AI-transparency page.

import type { Finding, PageSnapshot } from '../types.js';
import { PAGE_PHRASES } from './data.js';
import { ruleTitle } from './catalog.js';
import { makeFinding, plural, type DraftEvidence } from './evidence.js';
import { clip, excerptAround, findFirstPhrase, normalizeText } from './text.js';

const EVIDENCE_VALUE_MAX = 300;

function hrefWords(href: string): string {
  try {
    const url = new URL(href);
    return decodeURIComponent(`${url.pathname} ${url.search}`).replace(/[/.+=&?]/gu, ' ');
  } catch {
    return '';
  }
}

export function page01(pages: readonly PageSnapshot[]): Finding {
  const base = { ruleId: 'PAGE-01', title: ruleTitle('PAGE-01'), pages };
  const seen = new Set<string>();
  const drafts: DraftEvidence[] = [];
  for (const page of pages) {
    for (const link of page.links) {
      const key = `${link.href}\u0000${link.text}`;
      if (seen.has(key)) continue;
      const textHaystack = normalizeText(link.text);
      const textMatch = findFirstPhrase(textHaystack, PAGE_PHRASES);
      const urlHaystack = normalizeText(hrefWords(link.href));
      const urlMatch = textMatch ? null : findFirstPhrase(urlHaystack, PAGE_PHRASES);
      const match = textMatch ?? urlMatch;
      if (match === null) continue;
      seen.add(key);
      const via = textMatch ? `link text "${excerptAround(textHaystack, textMatch)}"` : `link address (${clip(urlHaystack.text, 80)})`;
      drafts.push({
        page,
        kind: 'link',
        value: clip(`${link.href} | ${via} matches "${match.phrase.phrase}" (${match.phrase.lang})`, EVIDENCE_VALUE_MAX),
      });
    }
  }
  if (drafts.length > 0) {
    return makeFinding({
      ...base,
      outcome: 'found',
      needsHumanJudgement: true,
      summary: `${plural(drafts.length, 'link')} whose text or address mentions AI policy or AI use wording found; only the presence of a link is reported, not what the target page says.`,
      drafts,
    });
  }
  return makeFinding({
    ...base,
    outcome: 'not_found',
    needsHumanJudgement: true,
    summary: `No link to an AI-use or AI-transparency page found on the ${plural(pages.length, 'page')} checked; pages that were not crawled were not checked.`,
    coverage: (page) => `Checked ${page.finalUrl}: ${plural(page.links.length, 'link')} compared with ${PAGE_PHRASES.length} AI-use phrases (8 languages), none matched`,
  });
}
