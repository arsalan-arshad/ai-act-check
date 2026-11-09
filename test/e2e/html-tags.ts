// Minimal HTML tag/attribute tokenizer used to prove that hostile strings did not become markup.
export interface Tag {
  name: string;
  attrs: Record<string, string>;
}

const TAG_RE = /<([a-zA-Z][\w-]*)((?:\s+[^\s"'=<>`/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTR_RE = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseTags(html: string): Tag[] {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/gi, '<style></style>');
  const tags: Tag[] = [];
  for (const m of stripped.matchAll(TAG_RE)) {
    const attrs: Record<string, string> = {};
    for (const a of (m[2] ?? '').matchAll(ATTR_RE)) {
      attrs[(a[1] as string).toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    }
    tags.push({ name: (m[1] as string).toLowerCase(), attrs });
  }
  return tags;
}

/** Visible text approximation: drop tags, decode the handful of entities escapers emit. */
export function textOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
