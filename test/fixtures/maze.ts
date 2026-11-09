import { type HandlerMap, html, page } from './server.js';

/** A link maze of `total` pages: / links to p1..p5 and every pN links forward and back, so a crawler can always find more pages. */
export function mazeHandlers(total = 30): HandlerMap {
  const handlers: HandlerMap = {};
  const links = (n: number): string => {
    const out = new Set<number>();
    for (const d of [1, 2, 3]) if (n + d <= total) out.add(n + d);
    if (n > 1) out.add(n - 1);
    return [...out].map((m) => `<a href="/p${m}.html">Page ${m}</a>`).join(' ');
  };
  handlers['/'] = html(
    page('Maze home', `<h1>Maze</h1>${[1, 2, 3, 4, 5].map((m) => `<a href="/p${m}.html">Page ${m}</a>`).join(' ')}`),
  );
  for (let n = 1; n <= total; n++) {
    handlers[`/p${n}.html`] = html(page(`Maze ${n}`, `<h1>Maze page ${n}</h1><p>Plain content ${n}.</p>${links(n)}`));
  }
  return handlers;
}
