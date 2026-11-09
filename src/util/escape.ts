const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for safe use in HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ENTITIES[ch] ?? ch);
}
