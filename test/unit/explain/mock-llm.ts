import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}

export interface MockLlm {
  baseUrl: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export type Handler = (req: RecordedRequest, res: ServerResponse) => void;

/** Local stand-in for an LLM API. Tests never talk to a real provider. */
export async function startMockLlm(handler: Handler): Promise<MockLlm> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const recorded: RecordedRequest = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export const anthropicReply = (text: string): unknown => ({ content: [{ type: 'text', text }] });
export const openaiReply = (text: string): unknown => ({ choices: [{ message: { role: 'assistant', content: text } }] });
export const itemsJson = (items: { ruleId: string; text: string }[]): string => JSON.stringify({ items });
