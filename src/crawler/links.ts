const NON_HTML_EXTENSIONS = new Set([
  'pdf', 'zip', 'gz', 'tgz', 'rar', '7z', 'tar', 'exe', 'dmg', 'msi', 'apk',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff',
  'mp3', 'mp4', 'webm', 'mov', 'avi', 'wav', 'ogg',
  'css', 'js', 'mjs', 'json', 'xml', 'rss', 'atom', 'txt', 'csv',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'woff', 'woff2', 'ttf', 'otf',
]);

const KEYWORD_PATH = /(^|[/_.-])(ai|ki|artificial|privacy|datenschutz|about|contact|help|support|chat|legal|terms|imprint|impressum|transparency|policy|policies|faq|assistant|bot)([/_.-]|$)/i;
const KEYWORD_TEXT = /\b(ai|ki|artificial|intelligen\w*|privacy|datenschutz|about|contact|help|support|chat|legal|terms|imprint|impressum|transparency|policy|assistant|bot)\b/i;

/** Absolute http(s) URL without fragment, or null when `href` is not a crawlable web URL. */
export function canonicalize(href: string, base?: string): URL | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  return url;
}

function hostKey(url: URL): string {
  return url.host.toLowerCase().replace(/^www\./, '');
}

/** Same host (and port), treating `www.` as equivalent. Scheme differences (http/https) are ignored. */
export function isSameSite(url: URL, start: URL): boolean {
  return hostKey(url) === hostKey(start);
}

export function hasNonHtmlExtension(url: URL): boolean {
  const last = url.pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 && NON_HTML_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
}

/** Lower is crawled earlier: shallow paths first, pages that look like AI/privacy/about/contact/help/legal pages before others. */
export function priorityScore(url: URL, text: string): number {
  const depth = url.pathname.split('/').filter(Boolean).length;
  let score = depth * 10 + (url.search ? 5 : 0);
  if (KEYWORD_PATH.test(url.pathname) || KEYWORD_TEXT.test(text)) score -= 25;
  return score;
}
