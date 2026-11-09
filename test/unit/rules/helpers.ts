import type {
  CrawlResult,
  DomCandidate,
  IframeInfo,
  ImageInfo,
  ImageMarkers,
  LinkInfo,
  PageSnapshot,
  ScriptInfo,
} from '../../../src/types.js';

export const FETCHED_AT = '2026-01-01T00:00:00.000Z';

export function makePage(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  const url = overrides.url ?? 'https://example.test/';
  return {
    url,
    finalUrl: url,
    status: 200,
    fetchedAt: FETCHED_AT,
    title: 'Example',
    lang: 'en',
    html: '<html><body><p>Hello</p></body></html>',
    text: 'Hello',
    scripts: [],
    iframes: [],
    links: [],
    images: [],
    domCandidates: [],
    headers: {},
    screenshot: null,
    loadErrors: [],
    ...overrides,
  };
}

export function makeCrawl(pages: PageSnapshot[], overrides: Partial<CrawlResult> = {}): CrawlResult {
  return {
    startUrl: pages[0]?.url ?? 'https://example.test/',
    pages,
    skipped: [],
    robots: { url: 'https://example.test/robots.txt', fetched: true, status: 200, crawlDelaySeconds: null },
    startBlocked: null,
    userAgent: 'ai-act-check/test',
    startedAt: FETCHED_AT,
    finishedAt: FETCHED_AT,
    ...overrides,
  };
}

export function script(src: string | null, inlineSnippet: string | null = null): ScriptInfo {
  return { src, inlineSnippet };
}

export function iframe(overrides: Partial<IframeInfo> = {}): IframeInfo {
  return { src: 'https://frames.example.test/f', title: null, id: null, className: null, visible: true, accessible: false, text: null, ...overrides };
}

export function candidate(overrides: Partial<DomCandidate> = {}): DomCandidate {
  return {
    tag: 'div',
    id: null,
    className: null,
    ariaLabel: null,
    title: null,
    text: '',
    visible: true,
    inShadowRoot: false,
    matchedBy: 'class',
    ...overrides,
  };
}

export function link(href: string, text = ''): LinkInfo {
  return { href, text };
}

export function markers(overrides: Partial<ImageMarkers> = {}): ImageMarkers {
  return { c2pa: false, iptcDigitalSourceType: null, aiToolHints: [], exifSoftware: null, ...overrides };
}

export function image(overrides: Partial<ImageInfo> = {}): ImageInfo {
  return {
    src: 'https://example.test/img/a.jpg',
    alt: '',
    width: 800,
    height: 600,
    nearbyText: '',
    fetchStatus: 'ok',
    markers: markers(),
    ...overrides,
  };
}
