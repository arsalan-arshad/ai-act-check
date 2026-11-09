// CHAT-01 (chat widget detected) and CHAT-02 (AI-disclosure wording near the widget).

import type { DomCandidate, Finding, IframeInfo, PageSnapshot } from '../types.js';
import { DISCLOSURE_PHRASES, VENDORS, type VendorEntry } from './data.js';
import { ruleTitle } from './catalog.js';
import { makeFinding, plural, type DraftEvidence } from './evidence.js';
import { clip, excerptAround, findFirstPhrase, normalizePhrase, normalizeText } from './text.js';

/** Inputs to vendor regexes are cut to this length so a hostile page cannot make matching slow. */
const MAX_MATCH_INPUT = 2048;
const MAX_MARKUP_TOKENS = 5000;
const MAX_TOKEN_LENGTH = 200;
const EVIDENCE_VALUE_MAX = 300;

// Generic ("strong") chat heuristics, used when no known vendor matches. Matching is on lower-cased
// id / class / title values split into segments at hyphens, underscores and spaces. A bare "chat"
// class on an ordinary element is deliberately NOT enough (blog comment sections use it); it only
// counts inside a visible iframe or a visible open-shadow-DOM element, where it names a widget.
//
//  1. COMPOUND_TOKEN: a visible element whose id/class holds a chat word (chat, assistant) adjacent to a
//     widget-part word (widget, bubble, launcher, window, panel, frame, button, bot, messenger) in
//     either order, e.g. chat-widget, chat-panel, chatbot, assistant-widget; or a fixed phrase such as
//     live-chat, web-chat, virtual-assistant, ai-assistant, support-widget.
//  2. SHADOW_TOKEN: a visible element inside an open shadow root whose id/class holds a chat token.
//  3. IFRAME_TOKEN: a visible iframe whose id/class/title holds a chat token.
// A chat token is one of: chat, chatbot, assistant, messenger, livechat, helpdesk-widget (whole segments).
const COMPOUND_TOKEN =
  /(?:^|[-_])(?:(?:chat|assistant)[-_]?(?:widget|bubble|launcher|window|panel|frame|button|bot|messenger)|(?:widget|bubble|launcher|window|panel|frame|button|bot|messenger)[-_]?(?:chat|assistant)|live[-_]?chat|web[-_]?chat|virtual[-_]?assistant|ai[-_]?assistant|support[-_]?widget)(?:$|[-_])/;
const CHAT_TOKEN = /(?:^|[-_])(?:chat|chatbot|assistant|messenger|livechat|helpdesk[-_]widget)(?:$|[-_])/;

const STRONG_LABEL_PHRASES = [
  'chat widget',
  'chatbot',
  'chat bot',
  'live chat',
  'open chat',
  'chat with us',
  'chat with our',
  'virtual assistant',
  'ai assistant',
].map((phrase) => normalizePhrase(phrase, 'en'));

const ATTRIBUTE_VALUE = /(?<=[\s"'])(?:id|class)\s*=\s*(?:"([^"]{0,512})"|'([^']{0,512})')/gi;
const CUSTOM_ELEMENT = /<([a-z][a-z0-9]*-[a-z0-9-]*)/gi;

export interface PageChat {
  page: PageSnapshot;
  /** Names of detected vendors, in vendor-list order. */
  vendors: string[];
  /** Number of visible elements/frames that matched only the generic strong pattern. */
  genericCount: number;
  drafts: DraftEvidence[];
  /** Elements and frames whose text may be the widget's own UI. */
  widgetCandidates: DomCandidate[];
  widgetIframes: IframeInfo[];
}

function firstMatch(patterns: readonly RegExp[], value: string): RegExpExecArray | null {
  const input = value.length > MAX_MATCH_INPUT ? value.slice(0, MAX_MATCH_INPUT) : value;
  for (const pattern of patterns) {
    const match = pattern.exec(input);
    if (match) return match;
  }
  return null;
}

function markupTokens(page: PageSnapshot): string[] {
  const tokens = new Set<string>();
  const add = (token: string): void => {
    const trimmed = token.trim().slice(0, MAX_TOKEN_LENGTH);
    if (trimmed !== '' && tokens.size < MAX_MARKUP_TOKENS) tokens.add(trimmed);
  };
  for (const match of page.html.matchAll(ATTRIBUTE_VALUE)) {
    for (const token of (match[1] ?? match[2] ?? '').split(/\s+/u)) add(token);
  }
  for (const match of page.html.matchAll(CUSTOM_ELEMENT)) add(match[1] ?? '');
  return [...tokens];
}

function candidateTokens(candidate: DomCandidate): string[] {
  const tokens: string[] = [];
  if (candidate.id) tokens.push(candidate.id);
  if (candidate.className) tokens.push(...candidate.className.split(/\s+/u).filter((token) => token !== ''));
  if (candidate.tag.includes('-')) tokens.push(candidate.tag.toLowerCase());
  return tokens;
}

export function describeCandidate(candidate: DomCandidate): string {
  const attrs = [
    candidate.id ? ` id="${candidate.id}"` : '',
    candidate.className ? ` class="${candidate.className}"` : '',
    candidate.ariaLabel ? ` aria-label="${candidate.ariaLabel}"` : '',
  ].join('');
  return clip(`<${candidate.tag.toLowerCase()}${attrs}>${candidate.inShadowRoot ? ' in shadow DOM' : ''}`, EVIDENCE_VALUE_MAX);
}

function labelIsStrong(label: string | null): boolean {
  return label !== null && findFirstPhrase(normalizeText(label), STRONG_LABEL_PHRASES) !== null;
}

function lowerToken(value: string): string {
  return value.slice(0, MAX_TOKEN_LENGTH).toLowerCase();
}

/** Which generic heuristic a visible element matches, as a short description, or null. */
function candidateHeuristic(candidate: DomCandidate): string | null {
  const tokens = candidateTokens(candidate).map(lowerToken);
  const compound = tokens.find((token) => COMPOUND_TOKEN.test(token));
  if (compound) return `chat-widget compound token "${compound}" in id/class`;
  const chat = candidate.inShadowRoot ? tokens.find((token) => CHAT_TOKEN.test(token)) : undefined;
  if (chat) return `chat token "${chat}" in id/class of a visible shadow-DOM element`;
  if (labelIsStrong(candidate.ariaLabel)) return `chat-widget aria-label "${clip(candidate.ariaLabel ?? '', 60)}"`;
  return null;
}

function iframeHeuristic(frame: IframeInfo): string | null {
  const values: [string, string][] = [
    ['id', frame.id ?? ''],
    ...(frame.className ?? '').split(/\s+/u).map((token): [string, string] => ['class', token]),
    ['title', (frame.title ?? '').trim().replace(/\s+/gu, '-')],
  ];
  for (const [attribute, value] of values) {
    const token = lowerToken(value);
    if (token !== '' && (CHAT_TOKEN.test(token) || COMPOUND_TOKEN.test(token))) return `chat token in ${attribute} "${clip(value, 60)}" of a visible iframe`;
  }
  return null;
}

function matchVendor(vendor: VendorEntry, page: PageSnapshot, tokens: readonly string[], widget: PageChat): void {
  const push = (kind: DraftEvidence['kind'], value: string): void => {
    widget.drafts.push({ page, kind, value: clip(`${vendor.name}: ${value}`, EVIDENCE_VALUE_MAX) });
    if (!widget.vendors.includes(vendor.name)) widget.vendors.push(vendor.name);
  };

  const script = page.scripts.find((s) => s.src !== null && firstMatch(vendor.scriptPatterns, s.src) !== null);
  if (script?.src) push('script', `script src ${script.src}`);

  for (const s of page.scripts) {
    if (s.inlineSnippet === null) continue;
    const match = firstMatch(vendor.inlinePatterns, s.inlineSnippet);
    if (match) {
      push('script', `inline script contains "${clip(match[0], 80)}"`);
      break;
    }
  }

  for (const frame of page.iframes) {
    if (firstMatch(vendor.iframePatterns, frame.src) === null) continue;
    push('element', `iframe src ${frame.src}`);
    if (!widget.widgetIframes.includes(frame)) widget.widgetIframes.push(frame);
  }

  const matchedCandidates = page.domCandidates.filter((candidate) =>
    candidateTokens(candidate).some((token) => firstMatch(vendor.domPatterns, token) !== null),
  );
  for (const candidate of matchedCandidates) {
    if (!widget.widgetCandidates.includes(candidate)) widget.widgetCandidates.push(candidate);
  }
  const markupHit = tokens.find((token) => firstMatch(vendor.domPatterns, token) !== null);
  const domValue = matchedCandidates[0] ? describeCandidate(matchedCandidates[0]) : markupHit ? `element id/class "${markupHit}" in page markup` : null;
  if (domValue !== null) push('element', domValue);
}

function detectOnPage(page: PageSnapshot): PageChat {
  const widget: PageChat = { page, vendors: [], genericCount: 0, drafts: [], widgetCandidates: [], widgetIframes: [] };
  const tokens = markupTokens(page);
  for (const vendor of VENDORS) matchVendor(vendor, page, tokens, widget);

  for (const candidate of page.domCandidates) {
    if (widget.widgetCandidates.includes(candidate) || !candidate.visible) continue;
    const heuristic = candidateHeuristic(candidate);
    if (heuristic === null) continue;
    widget.widgetCandidates.push(candidate);
    widget.genericCount++;
    widget.drafts.push({ page, kind: 'element', value: clip(`generic chat-like element, no known vendor (heuristic: ${heuristic}): ${describeCandidate(candidate)}`, EVIDENCE_VALUE_MAX) });
  }
  for (const frame of page.iframes) {
    if (widget.widgetIframes.includes(frame) || !frame.visible) continue;
    const heuristic = iframeHeuristic(frame);
    if (heuristic === null) continue;
    widget.widgetIframes.push(frame);
    widget.genericCount++;
    widget.drafts.push({ page, kind: 'element', value: clip(`generic chat-like iframe, no known vendor (heuristic: ${heuristic}): src ${frame.src}`, EVIDENCE_VALUE_MAX) });
  }
  // Keep original document order so output does not depend on which pattern matched first.
  widget.widgetCandidates.sort((a, b) => page.domCandidates.indexOf(a) - page.domCandidates.indexOf(b));
  widget.widgetIframes.sort((a, b) => page.iframes.indexOf(a) - page.iframes.indexOf(b));
  return widget;
}

export function detectChat(pages: readonly PageSnapshot[]): PageChat[] {
  return pages.map(detectOnPage);
}

function hasWidget(entry: PageChat): boolean {
  return entry.drafts.length > 0;
}

export function chat01(pages: readonly PageSnapshot[], detections: readonly PageChat[]): Finding {
  const base = { ruleId: 'CHAT-01', title: ruleTitle('CHAT-01'), pages };
  const withWidget = detections.filter(hasWidget);
  if (withWidget.length === 0) {
    return makeFinding({
      ...base,
      outcome: 'not_found',
      needsHumanJudgement: false,
      summary: `No known chat widget detected in the rendered pages (${plural(pages.length, 'page')} checked); late-loading, consent-gated or closed-shadow-DOM widgets would not be seen.`,
      coverage: (page) => `Checked ${page.finalUrl}: no known chat widget matched (${VENDORS.length} vendor fingerprints, generic heuristics)`,
    });
  }
  const vendors = [...new Set(withWidget.flatMap((entry) => entry.vendors))];
  const generic = withWidget.reduce((sum, entry) => sum + entry.genericCount, 0);
  const named = [...vendors, ...(generic > 0 ? ['unidentified chat-like element'] : [])].join(', ');
  return makeFinding({
    ...base,
    outcome: 'found',
    needsHumanJudgement: true,
    summary: `Chat widget detected (${named}) on ${withWidget.length} of ${plural(pages.length, 'page')} checked; a chat widget may be staffed by people, so this does not show that automated or AI-generated replies are used.`,
    drafts: withWidget.flatMap((entry) => entry.drafts),
  });
}

function widgetTexts(entry: PageChat): { text: string; location: string }[] {
  const sources: { text: string; location: string }[] = [];
  for (const candidate of entry.widgetCandidates) {
    const where = describeCandidate(candidate);
    sources.push({ text: candidate.text, location: `text of chat widget element ${where}` });
    if (candidate.ariaLabel) sources.push({ text: candidate.ariaLabel, location: `aria-label of chat widget element ${where}` });
    if (candidate.title) sources.push({ text: candidate.title, location: `title of chat widget element ${where}` });
  }
  for (const frame of entry.widgetIframes) {
    const where = clip(frame.src, 120);
    if (frame.accessible && frame.text) sources.push({ text: frame.text, location: `text of chat widget iframe ${where}` });
    if (frame.title) sources.push({ text: frame.title, location: `title of chat widget iframe ${where}` });
  }
  return sources;
}

function hasInspectableText(entry: PageChat): boolean {
  return (
    entry.widgetCandidates.some((candidate) => candidate.text.trim() !== '') ||
    entry.widgetIframes.some((frame) => frame.accessible && (frame.text ?? '').trim() !== '')
  );
}

export function chat02(pages: readonly PageSnapshot[], detections: readonly PageChat[]): Finding {
  const base = { ruleId: 'CHAT-02', title: ruleTitle('CHAT-02') };
  const withWidget = detections.filter(hasWidget);
  if (withWidget.length === 0) {
    return makeFinding({
      ...base,
      pages,
      outcome: 'cannot_tell',
      reason: 'no_widget_detected',
      needsHumanJudgement: false,
      summary: 'Nothing to check: no chat widget was detected.',
    });
  }
  const widgetPages = withWidget.map((entry) => entry.page);
  const drafts: DraftEvidence[] = [];
  for (const entry of withWidget) {
    for (const source of widgetTexts(entry)) {
      const haystack = normalizeText(source.text);
      const match = findFirstPhrase(haystack, DISCLOSURE_PHRASES);
      if (match) {
        drafts.push({
          page: entry.page,
          kind: 'text',
          value: clip(`"${excerptAround(haystack, match)}" matches wording "${match.phrase.phrase}" (${match.phrase.lang}) in ${source.location}`, EVIDENCE_VALUE_MAX),
        });
      }
    }
  }
  if (drafts.length > 0) {
    return makeFinding({
      ...base,
      pages: widgetPages,
      outcome: 'found',
      needsHumanJudgement: true,
      summary: `Wording that mentions an AI assistant or bot was found in or near the detected chat widget (${plural(drafts.length, 'match', 'matches')}); whether it is adequate, timely or clear is not judged.`,
      drafts,
    });
  }
  if (withWidget.some(hasInspectableText)) {
    return makeFinding({
      ...base,
      pages: widgetPages,
      outcome: 'not_found',
      needsHumanJudgement: true,
      summary:
        'No AI-assistant or bot wording matched in the inspectable text of the detected chat widget; the chat interface may show such wording only after it is opened, so a manual check is needed.',
      coverage: (page) => `Checked ${page.finalUrl}: no AI-assistant or bot wording matched in the inspectable widget text (${DISCLOSURE_PHRASES.length} phrases, 8 languages)`,
    });
  }
  return makeFinding({
    ...base,
    pages: widgetPages,
    outcome: 'cannot_tell',
    reason: 'widget_ui_not_inspectable',
    needsHumanJudgement: true,
    summary:
      'A chat widget was detected but its interface text could not be inspected (cross-origin frame, closed launcher or empty text), so disclosure wording could not be checked. This is not a pass.',
  });
}
