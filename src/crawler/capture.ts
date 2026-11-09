import type { Page } from 'playwright';
import type { DomCandidate, IframeInfo, ImageInfo, LinkInfo, ScriptInfo } from '../types.js';

export const CHAT_HEURISTIC = '(chat|messenger|assistant|chatbot|bot\\b|widget|helpdesk|livechat|copilot|support-?widget)';

const LIMITS = {
  html: 1_000_000,
  text: 200_000,
  inlineScript: 1500,
  linkText: 200,
  candidateText: 2000,
  nearbyText: 300,
  frameText: 4000,
  candidates: 40,
  links: 2000,
  images: 200,
  iframes: 30,
};

const FRAME_READ_TIMEOUT_MS = 3000;

/** What the in-page script returns; iframe text is added afterwards from the Playwright frame tree. */
interface RawCapture {
  html: string;
  text: string;
  title: string;
  lang: string | null;
  scripts: ScriptInfo[];
  iframes: Omit<IframeInfo, 'accessible' | 'text'>[];
  links: LinkInfo[];
  images: ImageInfo[];
  domCandidates: DomCandidate[];
}

export type PageContent = Omit<RawCapture, 'iframes'> & { iframes: IframeInfo[] };

/**
 * Runs inside the page. Must stay self-contained (it is serialised): no imports, no references to
 * module scope. It only reads the DOM; it never clicks, types or submits anything.
 */
function captureInPage(config: { heuristic: string; limits: typeof LIMITS; expandoKey: string }): RawCapture {
  const { limits } = config;
  const heuristic = new RegExp(config.heuristic, 'i');
  const skipTags = new Set(['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT', 'TITLE']);

  const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const attr = (el: Element, name: string): string | null => {
    const v = el.getAttribute(name);
    return v === null || v === '' ? null : v;
  };
  const textOf = (el: Element): string => {
    const html = el as HTMLElement;
    return typeof html.innerText === 'string' ? html.innerText : (el.textContent ?? '');
  };
  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  };

  // Every element in document order, with open shadow roots expanded in place.
  interface Entry { el: Element; inShadow: boolean }
  const entries: Entry[] = [];
  const shadowTexts: string[] = [];
  const walk = (root: Document | ShadowRoot, inShadow: boolean): void => {
    const stack: Element[] = Array.from(root.children).reverse();
    while (stack.length > 0) {
      const el = stack.pop();
      if (!el) break;
      entries.push({ el, inShadow });
      if (el.shadowRoot) {
        for (const child of Array.from(el.shadowRoot.children)) shadowTexts.push(textOf(child));
        walk(el.shadowRoot, true);
      }
      for (const child of Array.from(el.children).reverse()) stack.push(child);
    }
  };
  walk(document, false);

  const deepText = (el: Element): string => {
    const parts = [textOf(el)];
    const hosts = [el, ...Array.from(el.querySelectorAll('*'))].filter((e) => e.shadowRoot);
    for (const host of hosts) {
      for (const child of Array.from(host.shadowRoot?.children ?? [])) parts.push(textOf(child));
    }
    return parts.filter((p) => p.trim() !== '').join('\n');
  };

  // Page text: light DOM innerText plus the text of open shadow roots (innerText does not cross shadow boundaries).
  let text = document.body ? document.body.innerText : '';
  for (const shadowText of shadowTexts) {
    const trimmed = shadowText.trim();
    if (trimmed !== '' && !text.includes(trimmed)) text += `\n${trimmed}`;
  }

  const scripts: ScriptInfo[] = [];
  const links: LinkInfo[] = [];
  const linkSeen = new Set<string>();
  const images: ImageInfo[] = [];
  const imageSeen = new Set<string>();
  const iframes: RawCapture['iframes'] = [];
  const domCandidates: DomCandidate[] = [];
  const candidateSeen = new Set<string>();
  const candidateRoots = new Set<Element>();

  for (const { el, inShadow } of entries) {
    const tag = el.tagName;

    if (tag === 'SCRIPT') {
      const script = el as HTMLScriptElement;
      if (script.src) {
        scripts.push({ src: script.src, inlineSnippet: null });
      } else if (!/json|importmap/i.test(script.type) && (script.textContent ?? '').trim() !== '') {
        scripts.push({ src: null, inlineSnippet: (script.textContent ?? '').trim().slice(0, limits.inlineScript) });
      }
    } else if (tag === 'A' && links.length < limits.links) {
      const href = (el as HTMLAnchorElement).href;
      if (/^https?:/i.test(href)) {
        const label = squash(attr(el, 'aria-label') ?? textOf(el)) || squash(attr(el, 'title'));
        const key = `${href}\u0000${label}`;
        if (!linkSeen.has(key)) {
          linkSeen.add(key);
          links.push({ href, text: label.slice(0, limits.linkText) });
        }
      }
    } else if (tag === 'IMG' && images.length < limits.images) {
      const img = el as HTMLImageElement;
      const src = img.currentSrc || img.src;
      if (/^https?:/i.test(src) && !imageSeen.has(src)) {
        imageSeen.add(src);
        const figure = img.closest('figure');
        const caption = figure?.querySelector('figcaption');
        let holder: Element | null = img.parentElement;
        while (holder && (holder.tagName === 'PICTURE' || holder.tagName === 'A') && holder.parentElement) holder = holder.parentElement;
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        images.push({
          src,
          alt: img.alt,
          width: width > 0 ? width : null,
          height: height > 0 ? height : null,
          nearbyText: squash(caption ? textOf(caption) : holder ? textOf(holder) : '').slice(0, limits.nearbyText),
          fetchStatus: 'skipped',
          markers: null,
        });
      }
    } else if (tag === 'IFRAME' && iframes.length < limits.iframes) {
      const frame = el as HTMLIFrameElement;
      (el as unknown as Record<string, unknown>)[config.expandoKey] = iframes.length;
      iframes.push({
        src: frame.src || frame.getAttribute('src') || '',
        title: attr(el, 'title'),
        id: attr(el, 'id'),
        className: attr(el, 'class'),
        visible: isVisible(el),
      });
    }

    if (skipTags.has(tag) || domCandidates.length >= limits.candidates) continue;
    const id = attr(el, 'id');
    const className = attr(el, 'class');
    const ariaLabel = attr(el, 'aria-label');
    const title = attr(el, 'title');
    let matchedBy: DomCandidate['matchedBy'] | null = null;
    if (id && heuristic.test(id)) matchedBy = 'id';
    else if (className && heuristic.test(className)) matchedBy = 'class';
    else if (ariaLabel && heuristic.test(ariaLabel)) matchedBy = 'aria';
    else if (title && heuristic.test(title)) matchedBy = 'title';
    else {
      for (const a of Array.from(el.attributes)) {
        if (a.name.startsWith('data-') && (heuristic.test(a.name) || heuristic.test(a.value))) {
          matchedBy = 'attr';
          break;
        }
      }
    }
    if (!matchedBy) continue;
    // Descendants of an already recorded candidate add noise unless they carry their own id/aria-label/title match.
    let ancestor: Element | null = el.parentElement;
    let insideCandidate = false;
    while (ancestor) {
      if (candidateRoots.has(ancestor)) {
        insideCandidate = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (insideCandidate && (matchedBy === 'class' || matchedBy === 'attr')) continue;
    const signature = [tag, id, className, ariaLabel, title, inShadow].join('\u0000');
    if (candidateSeen.has(signature)) continue;
    candidateSeen.add(signature);
    candidateRoots.add(el);
    domCandidates.push({
      tag: tag.toLowerCase(),
      id,
      className,
      ariaLabel,
      title,
      text: deepText(el).trim().slice(0, limits.candidateText),
      visible: isVisible(el),
      inShadowRoot: inShadow,
      matchedBy,
    });
  }

  return {
    html: document.documentElement.outerHTML.slice(0, limits.html),
    text: text.slice(0, limits.text),
    title: document.title,
    lang: document.documentElement.getAttribute('lang') || null,
    scripts,
    iframes,
    links,
    images,
    domCandidates,
  };
}

async function readFrameText(frame: ReturnType<Page['frames']>[number]): Promise<string | null> {
  const read = frame.evaluate(() => document.body?.innerText ?? '');
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FRAME_READ_TIMEOUT_MS));
  try {
    const text = await Promise.race([read, timeout]);
    return text === null ? null : text.slice(0, LIMITS.frameText);
  } catch {
    return null;
  }
}

/** Captures the rendered DOM of the current page. Playwright can read frames that are cross-origin for the page. */
export async function capturePageContent(page: Page): Promise<PageContent> {
  const expandoKey = '__aiActCheckFrameIndex';
  const raw = await page.evaluate(captureInPage, { heuristic: CHAT_HEURISTIC, limits: LIMITS, expandoKey });

  const frameTexts = new Map<number, string | null>();
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const handle = await frame.frameElement();
      const index = await handle.evaluate((el, key) => (el as unknown as Record<string, unknown>)[key], expandoKey);
      await handle.dispose();
      if (typeof index === 'number' && !frameTexts.has(index)) frameTexts.set(index, await readFrameText(frame));
    } catch {
      // detached or unreadable frame: leave it inaccessible
    }
  }

  const iframes: IframeInfo[] = raw.iframes.map((frame, index) => {
    const text = frameTexts.get(index) ?? null;
    return { ...frame, accessible: text !== null, text };
  });
  return { ...raw, iframes };
}
