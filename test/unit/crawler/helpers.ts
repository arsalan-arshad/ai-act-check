import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crawl } from '../../../src/crawler/index.js';
import type { CrawlOptions, CrawlResult } from '../../../src/types.js';

const dirs: string[] = [];

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ai-act-check-test-'));
  dirs.push(dir);
  return dir;
}

export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

/** crawl() with test-friendly defaults: private targets allowed, no politeness delay, short settle. */
export async function fastCrawl(url: string, extra: Partial<CrawlOptions> = {}): Promise<{ result: CrawlResult; outDir: string }> {
  const outDir = extra.outDir ?? (await tempDir());
  const result = await crawl(url, { delayMs: 0, settleMs: 100, timeoutMs: 15000, allowPrivate: true, ...extra, outDir });
  return { result, outDir };
}

export function pathsRequested(requests: { url: string }[]): string[] {
  return requests.map((r) => r.url.split('?')[0] ?? r.url);
}
