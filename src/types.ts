// Shared contracts for ai-act-check. This file is the single source of truth that the
// crawler, rules and report/CLI modules are built against. Do not change a type here
// without the orchestrator's approval; add optional fields only.
//
// Principles (docs/SPEC.md, docs/RULES.md in the project):
//  - Deterministic rules decide. A model may only explain findings, never add/remove/change one.
//  - Three outcomes only: found, not_found, cannot_tell. cannot_tell is never a pass.
//  - Every finding carries evidence. Technical check, not legal advice.

export type Outcome = 'found' | 'not_found' | 'cannot_tell';

export type EvidenceKind = 'text' | 'script' | 'metadata' | 'screenshot' | 'link' | 'element';

export interface Evidence {
  /** Page URL the evidence was taken from. */
  url: string;
  kind: EvidenceKind;
  /** Matched text, script URL, metadata field=value, link href, screenshot file path (relative to report dir), or element description. */
  value: string;
  /** ISO timestamp of when the page was captured. */
  capturedAt: string;
}

export interface Finding {
  ruleId: string;
  title: string;
  outcome: Outcome;
  evidence: Evidence[];
  /** True whenever a human must judge adequacy/meaning (always true for 'found' on CHAT-02, MEDIA-02, PAGE-01). */
  needsHumanJudgement: boolean;
  /** One plain-English sentence produced deterministically by the rule (no model involved). */
  summary: string;
  /** Machine-readable reason code for cannot_tell / not_applicable situations, e.g. 'no_widget_detected', 'widget_ui_not_inspectable', 'no_images_readable', 'blocked_by_robots', 'no_pages_loaded'. */
  reason?: string;
  /** URLs of the pages this finding was evaluated over. */
  pagesEvaluated: string[];
}

export interface RuleMeta {
  ruleId: string;
  title: string;
  /** What the rule looks for, in plain language. */
  description: string;
  /** Honest limits of what an outside-in scan can see for this rule. */
  limitations: string;
  /** Hedged pointer to the possibly related provision. NEVER a legal conclusion. */
  legalNote: string;
}

// ---------------------------------------------------------------------------
// Crawler output
// ---------------------------------------------------------------------------

export interface ScriptInfo {
  /** Absolute script URL, or null for an inline script. */
  src: string | null;
  /** First 1500 chars of an inline script (for vendor snippet detection), else null. */
  inlineSnippet: string | null;
}

export interface IframeInfo {
  src: string;
  title: string | null;
  id: string | null;
  className: string | null;
  visible: boolean;
  /** True if the crawler could read the frame's document. */
  accessible: boolean;
  /** innerText of the frame body (max 4000 chars) when accessible, else null. */
  text: string | null;
}

export interface LinkInfo {
  href: string; // absolute URL
  text: string; // trimmed link text or aria-label, max 200 chars
}

/** An element whose id/class/aria-label/title/attributes look chat/assistant related. Open shadow DOM is traversed. */
export interface DomCandidate {
  tag: string;
  id: string | null;
  className: string | null;
  ariaLabel: string | null;
  title: string | null;
  /** innerText including open shadow roots, max 2000 chars. */
  text: string;
  visible: boolean;
  inShadowRoot: boolean;
  /** Which attribute matched the generic chat-like heuristic. */
  matchedBy: 'id' | 'class' | 'aria' | 'title' | 'attr';
}

export interface ImageMarkers {
  /** A C2PA / JUMBF content-credentials manifest was found in the bytes read. */
  c2pa: boolean;
  /** IPTC DigitalSourceType URI/term found in XMP (e.g. .../trainedAlgorithmicMedia), else null. */
  iptcDigitalSourceType: string | null;
  /** Other textual AI-tool hints found in metadata (e.g. 'Midjourney', 'DALL-E', 'Stable Diffusion', 'Firefly'). */
  aiToolHints: string[];
  /** EXIF Software tag if present. */
  exifSoftware: string | null;
}

export interface ImageInfo {
  src: string; // absolute URL
  alt: string;
  width: number | null;
  height: number | null;
  /** figcaption or parent element text, max 300 chars (for label proximity checks). */
  nearbyText: string;
  fetchStatus: 'ok' | 'skipped' | 'error';
  fetchError?: string;
  contentType?: string | null;
  bytesRead?: number;
  /** null when the bytes were not read or the format has no parser. */
  markers: ImageMarkers | null;
}

export interface PageSnapshot {
  /** URL requested. */
  url: string;
  /** URL after redirects. */
  finalUrl: string;
  /** HTTP status of the main document, null if it failed to load. */
  status: number | null;
  /** ISO timestamp. */
  fetchedAt: string;
  title: string;
  /** <html lang> value or null. */
  lang: string | null;
  /** Final rendered DOM (outerHTML), truncated to 1,000,000 chars. */
  html: string;
  /** document.body.innerText (open shadow roots included), truncated to 200,000 chars. */
  text: string;
  scripts: ScriptInfo[];
  iframes: IframeInfo[];
  links: LinkInfo[];
  images: ImageInfo[];
  domCandidates: DomCandidate[];
  /** Lower-cased response headers of the main document. */
  headers: Record<string, string>;
  /** Screenshot path relative to the report output dir (e.g. 'screenshots/page-1.png'), or null. */
  screenshot: string | null;
  /** Non-fatal problems while capturing this page (timeouts, blocked subresources...). */
  loadErrors: string[];
}

export interface SkippedUrl {
  url: string;
  reason: 'robots_disallow' | 'off_site' | 'max_pages' | 'non_html' | 'load_failed' | 'private_address' | 'invalid_url' | 'duplicate';
  detail?: string;
}

export interface RobotsInfo {
  url: string;
  /** Whether a robots.txt was retrieved (HTTP 200). A missing robots.txt (404) means no restrictions. */
  fetched: boolean;
  status: number | null;
  /** Crawl-delay seconds that applied to us, if any. */
  crawlDelaySeconds: number | null;
}

export interface CrawlOptions {
  /** Max same-site pages including the start page. Default 10, hard cap 25. */
  maxPages: number;
  /** Minimum delay between page loads in ms. Default 1500. robots Crawl-delay raises it (capped at 10000). */
  delayMs: number;
  /** Per-navigation timeout ms. Default 20000. */
  timeoutMs: number;
  /** Extra wait after load/network-idle for late widgets, ms. Default 2000. */
  settleMs: number;
  /** Directory where screenshots/ are written. Required. */
  outDir: string;
  /** Allow localhost/private-network targets (fixtures, local testing). Default false. */
  allowPrivate: boolean;
  /** Max images whose bytes are inspected per page. Default 12. */
  maxImagesPerPage: number;
  /** Max bytes read per image. Default 262144. */
  imageMaxBytes: number;
  /** Override the default User-Agent. */
  userAgent?: string;
}

export const DEFAULT_CRAWL_OPTIONS: Omit<CrawlOptions, 'outDir'> = {
  maxPages: 10,
  delayMs: 1500,
  timeoutMs: 20000,
  settleMs: 2000,
  allowPrivate: false,
  maxImagesPerPage: 12,
  imageMaxBytes: 262144,
};

export interface CrawlResult {
  startUrl: string;
  /** Pages actually loaded, in crawl order. */
  pages: PageSnapshot[];
  skipped: SkippedUrl[];
  robots: RobotsInfo;
  /** True if the start URL itself was disallowed by robots.txt or refused (private address, invalid). Then pages is empty. */
  startBlocked: null | 'robots_disallow' | 'private_address' | 'invalid_url' | 'load_failed';
  userAgent: string;
  startedAt: string;
  finishedAt: string;
}

// ---------------------------------------------------------------------------
// Module interfaces (what each module must export)
// ---------------------------------------------------------------------------

// src/crawler/index.ts
//   export async function crawl(startUrl: string, opts: Partial<CrawlOptions> & { outDir: string }): Promise<CrawlResult>
//
// src/rules/index.ts
//   export const RULES_VERSION: string               // e.g. '0.1.0'
//   export const RULE_CATALOG: RuleMeta[]
//   export function runRules(crawl: CrawlResult): Finding[]   // pure, deterministic, one Finding per rule in RULE_CATALOG order
//
// src/scan.ts
//   export async function scan(url: string, opts: ScanOptions): Promise<{ report: Report; outDir: string }>

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ExplanationItem {
  ruleId: string;
  text: string;
}

export interface ExplanationBlock {
  /** 'template' = deterministic fallback text; otherwise a model provider id. */
  source: 'template' | 'anthropic' | 'openai';
  model?: string;
  items: ExplanationItem[];
  /** Set when the model output was rejected by the guard and the template was used instead. */
  guardRejected?: string;
}

export interface Report {
  schemaVersion: 1;
  tool: { name: 'ai-act-check'; version: string };
  rulesVersion: string;
  generatedAt: string;
  target: { startUrl: string; host: string };
  scope: {
    userAgent: string;
    pagesRequested: number;
    pagesChecked: { url: string; finalUrl: string; status: number | null; screenshot: string | null; fetchedAt: string }[];
    skipped: SkippedUrl[];
    robots: RobotsInfo;
    startBlocked: CrawlResult['startBlocked'];
  };
  summary: { found: number; not_found: number; cannot_tell: number };
  findings: Finding[];
  ruleCatalog: RuleMeta[];
  explanation?: ExplanationBlock;
  /** Fixed legal disclaimer text, always present. */
  disclaimer: string;
  /** Fixed list of what this scan cannot see. Always present. */
  limitations: string[];
}

export interface ScanOptions extends Partial<CrawlOptions> {
  outDir: string;
  /** Run the optional plain-language explanation step (BYOK). Default false. */
  explain?: boolean;
}
