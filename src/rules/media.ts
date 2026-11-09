// MEDIA-01 (AI-generation metadata on images) and MEDIA-02 (visible AI label near flagged images).

import type { Finding, ImageInfo, ImageMarkers, PageSnapshot } from '../types.js';
import { AI_LABEL_PHRASES } from './data.js';
import { ruleTitle } from './catalog.js';
import { makeFinding, plural, type DraftEvidence } from './evidence.js';
import { clip, excerptAround, findFirstPhrase, normalizeText } from './text.js';

const EVIDENCE_VALUE_MAX = 300;

// Terms from the IPTC DigitalSourceType vocabulary that denote AI generation or synthesis.
const AI_SOURCE_TERMS = new Set(['trainedalgorithmicmedia', 'compositewithtrainedalgorithmicmedia', 'algorithmicmedia', 'compositesynthetic']);

export interface ImageOccurrence {
  page: PageSnapshot;
  image: ImageInfo;
  markers: ImageMarkers;
}

export interface ImageAnalysis {
  /** Distinct readable images (by src). */
  readable: number;
  /** Every page/image occurrence that carries AI-generation metadata. */
  flagged: ImageOccurrence[];
}

function sourceTerm(value: string | null): string | null {
  if (value === null) return null;
  const term = value.trim().split(/[/#:]/u).pop();
  return term ? term.toLowerCase() : null;
}

function aiSourceTerm(markers: ImageMarkers): string | null {
  const term = sourceTerm(markers.iptcDigitalSourceType);
  return term !== null && AI_SOURCE_TERMS.has(term) ? markers.iptcDigitalSourceType : null;
}

function isFlagged(markers: ImageMarkers): boolean {
  return markers.c2pa || aiSourceTerm(markers) !== null || markers.aiToolHints.length > 0;
}

export function analyseImages(pages: readonly PageSnapshot[]): ImageAnalysis {
  const readable = new Set<string>();
  const flagged: ImageOccurrence[] = [];
  for (const page of pages) {
    for (const image of page.images) {
      const markers = image.markers;
      if (image.fetchStatus !== 'ok' || markers === null) continue;
      readable.add(image.src);
      if (isFlagged(markers)) flagged.push({ page, image, markers });
    }
  }
  return { readable: readable.size, flagged };
}

function describeMarkers(markers: ImageMarkers): string {
  const fields: string[] = [];
  if (markers.c2pa) fields.push('c2pa=content-credentials manifest present');
  const term = aiSourceTerm(markers);
  if (term !== null) fields.push(`iptcDigitalSourceType=${term}`);
  if (markers.aiToolHints.length > 0) fields.push(`aiToolHints=${markers.aiToolHints.join(', ')}`);
  if (markers.exifSoftware) fields.push(`exifSoftware=${markers.exifSoftware}`);
  return fields.join('; ');
}

export function media01(pages: readonly PageSnapshot[], analysis: ImageAnalysis): Finding {
  const base = { ruleId: 'MEDIA-01', title: ruleTitle('MEDIA-01'), pages };
  if (analysis.flagged.length > 0) {
    const distinct = new Set(analysis.flagged.map((occurrence) => occurrence.image.src)).size;
    return makeFinding({
      ...base,
      outcome: 'found',
      needsHumanJudgement: true,
      summary: `AI-related image metadata (content-credentials manifest present, IPTC digital source type, or AI-tool name) found in ${plural(distinct, 'image')}; a manifest shows that provenance data exists, not that the image is AI-generated.`,
      drafts: analysis.flagged.map(({ page, image, markers }): DraftEvidence => ({
        page,
        kind: 'metadata',
        value: clip(`${image.src} | ${describeMarkers(markers)}`, EVIDENCE_VALUE_MAX),
      })),
    });
  }
  if (analysis.readable > 0) {
    return makeFinding({
      ...base,
      outcome: 'not_found',
      needsHumanJudgement: false,
      summary: `${plural(analysis.readable, 'image')} could be read and none carried AI-generation metadata; absence of metadata does not show that an image is human-made.`,
      coverage: (page) => `Checked ${page.finalUrl}: ${plural(page.images.filter((img) => img.fetchStatus === 'ok' && img.markers !== null).length, 'image')} read for metadata, none with AI-generation markers`,
    });
  }
  return makeFinding({
    ...base,
    outcome: 'cannot_tell',
    reason: 'no_images_readable',
    needsHumanJudgement: false,
    summary: 'No image on the checked pages could be read for metadata (none present, or fetching was skipped or failed), so this could not be determined. This is not a pass.',
  });
}

interface LabelledImage {
  occurrence: ImageOccurrence;
  /** Description of the label wording found. */
  label: string;
}

function findLabel({ image }: ImageOccurrence): string | null {
  for (const [source, text] of [['alt text', image.alt], ['nearby text', image.nearbyText]] as const) {
    const haystack = normalizeText(text);
    const match = findFirstPhrase(haystack, AI_LABEL_PHRASES);
    if (match) return `${source} "${excerptAround(haystack, match)}" matches label wording "${match.phrase.phrase}" (${match.phrase.lang})`;
  }
  return null;
}

function labelDraft({ occurrence, label }: LabelledImage): DraftEvidence {
  return { page: occurrence.page, kind: 'text', value: clip(`${occurrence.image.src} | ${label}`, EVIDENCE_VALUE_MAX) };
}

export function media02(pages: readonly PageSnapshot[], analysis: ImageAnalysis): Finding {
  const base = { ruleId: 'MEDIA-02', title: ruleTitle('MEDIA-02') };
  if (analysis.flagged.length === 0) {
    return makeFinding({
      ...base,
      pages,
      outcome: 'cannot_tell',
      reason: 'no_flagged_images',
      needsHumanJudgement: false,
      summary: 'Nothing to check: no image with AI-generation metadata was found.',
    });
  }
  const seen = new Set<string>();
  const missing: ImageOccurrence[] = [];
  const labelled: LabelledImage[] = [];
  for (const occurrence of analysis.flagged) {
    const key = `${occurrence.page.url}\u0000${occurrence.image.src}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = findLabel(occurrence);
    if (label === null) missing.push(occurrence);
    else labelled.push({ occurrence, label });
  }
  const total = missing.length + labelled.length;
  const flaggedPages = pages.filter((page) => analysis.flagged.some((flagged) => flagged.page === page));
  if (missing.length === 0) {
    return makeFinding({
      ...base,
      pages: flaggedPages,
      outcome: 'found',
      needsHumanJudgement: true,
      summary: `${total === 1 ? 'The flagged image has' : `All ${total} flagged images have`} AI-label wording in the alt text or nearby text; whether the wording is adequate or clear is not judged.`,
      drafts: labelled.map(labelDraft),
    });
  }
  const mixed = labelled.length > 0 ? ` (${labelled.length} other${labelled.length === 1 ? '' : 's'} ${labelled.length === 1 ? 'has' : 'have'} such wording)` : '';
  return makeFinding({
    ...base,
    pages: flaggedPages,
    outcome: 'not_found',
    needsHumanJudgement: true,
    summary: `${missing.length} of ${plural(total, 'flagged image')} ${missing.length === 1 ? 'has' : 'have'} no AI-label wording in the alt text or nearby text${mixed}; a label drawn into the image or placed elsewhere on the page would not be seen.`,
    drafts: [
      ...missing.map((occurrence): DraftEvidence => ({
        page: occurrence.page,
        kind: 'element',
        value: clip(`${occurrence.image.src} | no AI-label wording in alt text ("${clip(occurrence.image.alt, 80)}") or nearby text`, EVIDENCE_VALUE_MAX),
      })),
      ...labelled.map(labelDraft),
    ],
  });
}
