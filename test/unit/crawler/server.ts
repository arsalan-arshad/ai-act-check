import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Keep the connection open without answering (for timeout tests). */
  hang?: boolean;
}

export type Handler = (req: IncomingMessage, origin: string) => Reply;

export interface TestServer {
  origin: string;
  port: number;
  /** Request log: "METHOD /path" in arrival order, plus headers by index. */
  requests: { method: string; url: string; headers: IncomingMessage['headers']; at: number }[];
  close(): Promise<void>;
}

export function html(body: string, opts: { title?: string; lang?: string | null; headers?: Record<string, string> } = {}): Reply {
  const lang = opts.lang === null ? '' : ` lang="${opts.lang ?? 'en'}"`;
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...opts.headers },
    body: `<!doctype html><html${lang}><head><meta charset="utf-8"><title>${opts.title ?? 'Test page'}</title></head><body>${body}</body></html>`,
  };
}

/** Starts a node:http server on 127.0.0.1 with a random port. `routes` maps "/path" (without query) to a reply or handler. */
export async function startServer(routes: Record<string, Reply | Handler>): Promise<TestServer> {
  const requests: TestServer['requests'] = [];
  const sockets = new Set<import('node:net').Socket>();
  let origin = '';
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, at: Date.now() });
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const route = routes[path];
    const reply: Reply = route === undefined ? { status: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' } : typeof route === 'function' ? route(req, origin) : route;
    if (reply.hang) return;
    res.writeHead(reply.status ?? 200, reply.headers ?? {});
    res.end(reply.body ?? '');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
