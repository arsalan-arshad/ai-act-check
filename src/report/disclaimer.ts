/** Fixed disclaimer shown at the top and bottom of every report. Do not generate or paraphrase it at runtime. */
export const DISCLAIMER =
  'This report is the output of an automated technical check of public web pages. It is not legal advice, ' +
  'not a certification, and not a compliance assessment or audit opinion. Its findings are best-practice ' +
  'indicators that may relate to transparency topics in the EU AI Act (Regulation (EU) 2024/1689, in ' +
  'particular Article 50); they are not conclusions about any legal duty, and this tool does not decide ' +
  'who bears a given duty. "Cannot tell" means the scan could not determine the answer; it must not be ' +
  'read as a pass. Only the public pages listed under "Pages checked" were examined, as they appeared at ' +
  'the time shown. Details of the regulation, its dates and any amendments have not been verified by this ' +
  'tool: verify them with qualified legal counsel and the official sources (the Official Journal text and ' +
  "the European Commission's AI Act Service Desk).";

/** Fixed list of what an outside-in scan cannot see. Only the page limit varies. */
export function buildLimitations(maxPages: number): string[] {
  return [
    'Only public pages that load without a login were examined, as rendered by a headless browser at the time of the scan.',
    `At most ${maxPages} pages were visited: the start page plus linked pages on the same site. Other pages were not checked.`,
    'Chat widgets that load late, sit in a closed shadow DOM, or only load after cookie consent may be missed.',
    'Text that a chat window shows only after it is opened is not inspected.',
    'The absence of AI-related image metadata proves nothing: most images carry none, and metadata is often stripped.',
    'A chat widget may be staffed by people. Detecting a widget does not show that it is AI-driven.',
    'The scan does not judge whether any wording, label or placement is adequate, timely or clear.',
    'The list of known chat vendors is best-effort and incomplete.',
    'The scan does not determine which party (for example provider or deployer) bears any duty.',
  ];
}
