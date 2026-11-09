// Local fixture HTTP server for e2e tests. Binds 127.0.0.1 on a random port, serves static
// fixture sites, supports scripted responses (redirects, delays, hangs, custom headers) and
// logs every request so tests can assert robots compliance, rate limiting and User-Agent.
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SITES_DIR = path.join(HERE, 'sites');
export const SHARED_DIR = path.join(HERE, 'shared');

export interface RequestLogEntry {
  method: string;
  /** Path including query string, exactly as requested. */
  path: string;
  userAgent: string;
  /** Monotonic milliseconds (high resolution) for interval assertions. */
  t: number;
  at: string;
  range: string | null;
  cookie: string | null;
  /** Sec-Fetch-Dest header ('document' for page navigations by Chromium). */
  fetchDest: string | null;
  accept: string | null;
}

export interface ScriptedResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Wait this long before answering. */
  delayMs?: number;
  /** Never answer (until the server closes). */
  hang?: boolean;
}

export type Handler = (req: http.IncomingMessage, res: http.ServerResponse, entry: RequestLogEntry) => void | Promise<void>;
export type HandlerMap = Record<string, Handler | ScriptedResponse>;

export interface FixtureServerOptions {
  /** Exact-path overrides applied before static files. */
  handlers?: HandlerMap;
  /** Template variables replaced as {{NAME}} in text files. {{ORIGIN}} is always available. */
  vars?: Record<string, string>;
  /** Extra response headers per exact path, or '*' for every response. */
  headers?: Record<string, Record<string, string>>;
}

export interface FixtureServer {
  origin: string;
  port: number;
  url(p?: string): string;
  log: RequestLogEntry[];
  /** Requests excluding robots.txt, favicon and sub-resources: only page navigations. */
  documentRequests(): RequestLogEntry[];
  hits(pathPrefix: string): RequestLogEntry[];
  clearLog(): void;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.ico': 'image/x-icon',
};
const TEXTUAL = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.txt', '.xml', '.svg']);

export function resolveSiteDir(siteDirOrName: string): string {
  return path.isAbsolute(siteDirOrName) ? siteDirOrName : path.join(SITES_DIR, siteDirOrName);
}

function render(content: Buffer, ext: string, vars: Record<string, string>): Buffer {
  if (!TEXTUAL.has(ext)) return content;
  let text = content.toString('utf8');
  for (const [k, v] of Object.entries(vars)) text = text.split(`{{${k}}}`).join(v);
  return Buffer.from(text, 'utf8');
}

function safeJoin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const full = path.normalize(path.join(root, decoded));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function findFile(root: string, urlPath: string): string | null {
  const full = safeJoin(root, urlPath);
  if (!full) return null;
  const candidates = [full, full + '.html', path.join(full, 'index.html')];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Start a fixture server.
 * @param source a site name under test/fixtures/sites, an absolute directory, or a handler map
 *               (then every request not matched by the map is a 404).
 */
export async function startFixtureServer(
  source: string | HandlerMap,
  options: FixtureServerOptions = {},
): Promise<FixtureServer> {
  const siteRoot = typeof source === 'string' ? resolveSiteDir(source) : null;
  if (siteRoot && !fs.existsSync(siteRoot)) throw new Error(`fixture site not found: ${siteRoot}`);
  const handlers: HandlerMap = { ...(typeof source === 'string' ? {} : source), ...(options.handlers ?? {}) };
  const log: RequestLogEntry[] = [];
  const sockets = new Set<Socket>();
  const hanging = new Set<http.ServerResponse>();
  const vars: Record<string, string> = { ...(options.vars ?? {}) };

  const server = http.createServer(async (req, res) => {
    const rawPath = req.url ?? '/';
    const entry: RequestLogEntry = {
      method: req.method ?? 'GET',
      path: rawPath,
      userAgent: String(req.headers['user-agent'] ?? ''),
      t: Number(process.hrtime.bigint() / 1000n) / 1000,
      at: new Date().toISOString(),
      range: typeof req.headers.range === 'string' ? req.headers.range : null,
      cookie: typeof req.headers.cookie === 'string' ? req.headers.cookie : null,
      fetchDest: typeof req.headers['sec-fetch-dest'] === 'string' ? req.headers['sec-fetch-dest'] : null,
      accept: typeof req.headers.accept === 'string' ? req.headers.accept : null,
    };
    log.push(entry);

    const pathname = rawPath.split('?')[0] ?? '/';
    const extra = { ...(options.headers?.['*'] ?? {}), ...(options.headers?.[pathname] ?? {}) };
    const setHeaders = (h: Record<string, string>): void => {
      for (const [k, v] of Object.entries({ ...h, ...extra })) res.setHeader(k, v);
    };

    try {
      const scripted = handlers[pathname] ?? handlers[rawPath];
      if (scripted) {
        if (typeof scripted === 'function') {
          await scripted(req, res, entry);
          return;
        }
        if (scripted.hang) {
          hanging.add(res);
          return;
        }
        if (scripted.delayMs) await new Promise((r) => setTimeout(r, scripted.delayMs));
        const body = scripted.body ?? '';
        const buf = typeof body === 'string' ? Buffer.from(render(Buffer.from(body), '.html', vars)) : body;
        setHeaders({ 'content-type': 'text/html; charset=utf-8', ...(scripted.headers ?? {}) });
        res.statusCode = scripted.status ?? 200;
        res.setHeader('content-length', buf.length);
        res.end(req.method === 'HEAD' ? undefined : buf);
        return;
      }

      let file: string | null = null;
      if (pathname.startsWith('/_shared/')) {
        file = findFile(SHARED_DIR, pathname.slice('/_shared'.length));
      } else if (siteRoot) {
        file = findFile(siteRoot, pathname);
      }
      if (!file) {
        setHeaders({ 'content-type': 'text/html; charset=utf-8' });
        res.statusCode = 404;
        res.end('<!doctype html><title>404</title><p>Not found</p>');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      let content = render(fs.readFileSync(file), ext, { ORIGIN: origin(), ...vars });
      setHeaders({ 'content-type': MIME[ext] ?? 'application/octet-stream', 'accept-ranges': 'bytes' });
      const range = /^bytes=(\d+)-(\d*)$/.exec(typeof req.headers.range === 'string' ? req.headers.range : '');
      if (range && !TEXTUAL.has(ext)) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), content.length - 1) : content.length - 1;
        if (start >= content.length) {
          res.statusCode = 416;
          res.setHeader('content-range', `bytes */${content.length}`);
          res.end();
          return;
        }
        const total = content.length;
        content = content.subarray(start, end + 1);
        res.statusCode = 206;
        res.setHeader('content-range', `bytes ${start}-${end}/${total}`);
      } else {
        res.statusCode = 200;
      }
      res.setHeader('content-length', content.length);
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (err) {
      res.statusCode = 500;
      res.end(`fixture server error: ${(err as Error).message}`);
    }
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const origin = (): string => `http://127.0.0.1:${port}`;

  return {
    origin: origin(),
    port,
    url: (p = '/') => origin() + (p.startsWith('/') ? p : '/' + p),
    log,
    documentRequests: () =>
      log.filter((e) => {
        if (e.method !== 'GET' && e.method !== 'HEAD') return false;
        if (e.fetchDest) return e.fetchDest === 'document';
        return /text\/html/.test(e.accept ?? '') && !/robots\.txt|favicon/.test(e.path);
      }),
    hits: (prefix) => log.filter((e) => e.path.startsWith(prefix)),
    clearLog: () => {
      log.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const r of hanging) r.destroy();
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// Small response builders for handler maps
// ---------------------------------------------------------------------------

export function html(body: string, init: Omit<ScriptedResponse, 'body'> = {}): ScriptedResponse {
  return { ...init, body };
}

export function redirect(location: string, status = 302): ScriptedResponse {
  return { status, headers: { location }, body: '' };
}

export function hang(): ScriptedResponse {
  return { hang: true };
}

export function page(title: string, body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
}
