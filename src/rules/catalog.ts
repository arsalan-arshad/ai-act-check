import type { RuleMeta } from '../types.js';

// Legal notes are deliberately hedged pointers, never conclusions. The Article 50 reading below
// follows the unofficial text reviewed in docs/C1_FINDINGS.md and has not been checked against the
// Official Journal or the Commission's AI Act Service Desk.
const UNVERIFIED = 'Unverified against the Official Journal. Not legal advice.';

export const RULE_CATALOG: RuleMeta[] = [
  {
    ruleId: 'CHAT-01',
    title: 'Chat widget detected',
    description:
      'Looks for a website chat widget by matching known vendor script, iframe and markup fingerprints, plus visible elements whose id, class or label clearly names a chat widget.',
    limitations:
      'Best-effort vendor list, not verified against live widgets. Late-loading, consent-gated or closed-shadow-DOM widgets can be missed. A chat widget may be staffed by people, so detecting one does not show that an AI system is used.',
    legalNote: `Relates, if at all, to Art. 50(1) AI Act (informing people that they are interacting with an AI system). Per the unofficial text reviewed in docs/C1_FINDINGS.md that provision is addressed to providers of AI systems, so a missing disclosure on a website is not necessarily the site owner's responsibility. ${UNVERIFIED}`,
  },
  {
    ruleId: 'CHAT-02',
    title: 'AI disclosure text near a chat widget',
    description:
      'Searches the visible text, labels and accessible frame text of a detected chat widget for wording that tells visitors they are dealing with an AI assistant or bot (eight languages).',
    limitations:
      'Only text visible without opening or using the chat is inspected; wording shown after the launcher is opened, or inside cross-origin frames, is not seen. The rule cannot judge whether wording is adequate, timely or clear.',
    legalNote: `Relates, if at all, to Art. 50(1) AI Act (chatbot disclosure). Per the unofficial text reviewed in docs/C1_FINDINGS.md that provision is a provider duty; how it applies to a website operator is open. ${UNVERIFIED}`,
  },
  {
    ruleId: 'MEDIA-01',
    title: 'AI-generation metadata on images',
    description:
      'Reads the first bytes of images on the checked pages for content-credentials (C2PA) manifests, IPTC digital-source-type values that denote AI generation, and AI-tool names in metadata.',
    limitations:
      'Only a limited number of images per page are read, and only the leading bytes. Absence of metadata does not show an image is human-made, since metadata is often stripped. A content-credentials manifest shows provenance data exists, not that the image is AI-generated.',
    legalNote: `Relates, if at all, to Art. 50(2) AI Act (machine-readable marking of synthetic output). Per the unofficial text reviewed in docs/C1_FINDINGS.md that provision is a provider duty, not a duty of a site that merely displays images. ${UNVERIFIED}`,
  },
  {
    ruleId: 'MEDIA-02',
    title: 'Visible AI label near flagged images',
    description:
      'For images flagged by MEDIA-01, looks for wording in the alt text or nearby text that labels the image as AI-generated (eight languages).',
    limitations:
      'Only alt text and nearby page text are searched. A label drawn into the image, a watermark or a label elsewhere on the page is not seen. The rule cannot judge whether the wording is adequate.',
    legalNote: `Loosely related to the disclosure of AI-generated or manipulated content in Art. 50 AI Act; which actor is addressed, and any exceptions, are open questions. ${UNVERIFIED}`,
  },
  {
    ruleId: 'PAGE-01',
    title: 'AI use / transparency page link',
    description:
      'Scans link text and link addresses on the checked pages for wording that points to an AI policy, AI transparency or AI-use page (eight languages).',
    limitations:
      'Only links on the crawled pages are checked. A matching link shows that a link exists, not what the target page says; links about AI as a news or product topic can also match.',
    legalNote: `No provision has been identified that requires a dedicated AI-use page; this is a best-practice indicator only. ${UNVERIFIED}`,
  },
];

export function ruleTitle(ruleId: string): string {
  const meta = RULE_CATALOG.find((entry) => entry.ruleId === ruleId);
  if (!meta) throw new Error(`Unknown rule id ${ruleId}`);
  return meta.title;
}
