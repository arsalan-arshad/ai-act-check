import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Browser, Page, Response } from 'playwright';
import {
  DEFAULT_CRAWL_OPTIONS,
  type CrawlOptions,
  type CrawlResult,
  type LinkInfo,
  type PageSnapshot,
  type RobotsInfo,
  type SkippedUrl,
} from '../types.js';
import { capturePageContent } from './capture.js';
import { inspectImages } from './images.js';
import { canonicalize, hasNonHtmlExtension, isSameSite, priorityScore } from './links.js';
import { checkHost, errorMessage } from './net.js';
import { loadRobots, type RobotsLoad } from './robots.js';

export { isPrivateAddress } from './net.js';
export { parseRobots } from './robots.js';

const HARD_MAX_PAGES = 25;
const MAX_CRAWL_DELAY_MS = 10_000;
const NETWORK_IDLE_MAX_MS = 5000;
const ROBOTS_TIMEOUT_MS = 10_000;
const MAX_LOAD_ERRORS = 10;
const MAX_UNVISITED_RECORDED = 100;
const EXTRA_ATTEMPTS = 10;
const MAX_REDIRECTS = 10;
const VIEWPORT = { width: 1366, height: 900 };

type Refusal = { reason: SkippedUrl['reason']; detail: string };
type PageOutcome = { ok: true; snapshot: PageSnapshot; links: LinkInfo[] } | ({ ok: false } & Refusal);
interface Candidate {
  url: URL;
  score: number;
  order: number;
}

function toolVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function resolveOptions(opts: Partial<CrawlOptions> & { outDir: string }): CrawlOptions {
  const merged: CrawlOptions = { ...DEFAULT_CRAWL_OPTIONS, ...opts };
  merged.maxPages = Math.min(HARD_MAX_PAGES, Math.max(1, Math.floor(merged.maxPages)));
  merged.delayMs = Math.max(0, merged.delayMs);
  merged.maxImagesPerPage = Math.max(0, Math.floor(merged.maxImagesPerPage));
  merged.imageMaxBytes = Math.max(1024, Math.floor(merged.imageMaxBytes));
  return merged;
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.slice(0, 120);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Crawls up to `maxPages` same-site public pages with a headless browser and returns what was rendered.
 * Page-level problems are recorded in the result; only programmer errors and a missing browser throw.
 */
export async function crawl(startUrl: string, opts: Partial<CrawlOptions> & { outDir: string }): Promise<CrawlResult> {
  if (typeof opts?.outDir !== 'string' || opts.outDir === '') throw new TypeError('crawl: opts.outDir is required');
  const o = resolveOptions(opts);
  const userAgent = o.userAgent ?? `ai-act-check/${toolVersion()} (open-source technical scanner; not legal advice)`;
  const startedAt = new Date().toISOString();

  const skipped: SkippedUrl[] = [];
  const pages: PageSnapshot[] = [];
  let robotsInfo: RobotsInfo = { url: '', fetched: false, status: null, crawlDelaySeconds: null };
  let startBlocked: CrawlResult['startBlocked'] = null;
  const result = (): CrawlResult => ({
    startUrl,
    pages,
    skipped,
    robots: robotsInfo,
    startBlocked,
    userAgent,
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  const start = canonicalize(startUrl);
  if (!start) {
    skipped.push({ url: startUrl, reason: 'invalid_url', detail: 'only http and https URLs can be scanned' });
    startBlocked = 'invalid_url';
    return result();
  }
  robotsInfo = { url: `${start.origin}/robots.txt`, fetched: false, status: null, crawlDelaySeconds: null };

  const hostChecks = new Map<string, Promise<string | null>>();
  const hostProblem = (hostname: string): Promise<string | null> => {
    let check = hostChecks.get(hostname);
    if (!check) {
      check = checkHost(hostname, o.allowPrivate);
      hostChecks.set(hostname, check);
    }
    return check;
  };
  const robotsByOrigin = new Map<string, Promise<RobotsLoad>>();
  const robotsFor = (origin: string): Promise<RobotsLoad> => {
    let loaded = robotsByOrigin.get(origin);
    if (!loaded) {
      loaded = loadRobots(origin, ROBOTS_TIMEOUT_MS, o.allowPrivate, userAgent);
      robotsByOrigin.set(origin, loaded);
    }
    return loaded;
  };

  /** Decides whether a URL may be requested at all: scheme, same site, public address, robots.txt. */
  const vet = async (url: URL): Promise<Refusal | null> => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { reason: 'invalid_url', detail: 'only http and https URLs can be scanned' };
    if (!isSameSite(url, start)) return { reason: 'off_site', detail: `${url.host} is not part of the scanned site` };
    const problem = await hostProblem(url.hostname);
    if (problem === 'private_address') return { reason: 'private_address', detail: `${url.hostname} resolves to a private or reserved address` };
    if (problem) return { reason: 'load_failed', detail: `${url.hostname} could not be resolved` };
    const { rules, info } = await robotsFor(url.origin);
    if (!rules.isAllowed(url.pathname + url.search)) {
      return {
        reason: 'robots_disallow',
        detail: info.fetched ? 'disallowed by robots.txt' : 'robots.txt could not be fetched, so this run treats everything as disallowed',
      };
    }
    return null;
  };

  const startRefusal = await vet(start);
  robotsInfo = (await robotsFor(start.origin)).info;
  if (startRefusal) {
    skipped.push({ url: start.toString(), ...startRefusal });
    startBlocked = startRefusal.reason === 'robots_disallow' || startRefusal.reason === 'private_address' ? startRefusal.reason : 'load_failed';
    return result();
  }

  await mkdir(join(o.outDir, 'screenshots'), { recursive: true });
  let browser: Browser;
  try {
    // Main documents are handed to the browser by the route handler below, so Chromium sees no remote address for them and
    // would apply its Local Network Access block to their loopback subresources. That only matters when private targets
    // were explicitly allowed (local fixtures), so the check is relaxed only then.
    browser = await chromium.launch({ headless: true, args: o.allowPrivate ? ['--disable-features=LocalNetworkAccessChecks'] : [] });
  } catch (err) {
    throw new Error(`Could not start Chromium (${errorMessage(err)}). Run "npx playwright install chromium" and retry.`);
  }

  try {
    const context = await browser.newContext({
      userAgent,
      viewport: VIEWPORT,
      acceptDownloads: false,
      serviceWorkers: 'block',
      permissions: [],
    });
    const navigation: { refusal: Refusal | null; redirectTo: string | null } = { refusal: null, redirectTo: null };
    const readNavigation = (): { refusal: Refusal | null; redirectTo: string | null } => ({ ...navigation });
    // Every main-frame navigation is vetted before it is sent. Playwright does not route the hops of a redirect that the
    // browser follows internally, so main-frame requests are fetched here without following redirects: a 3xx answer is
    // aborted and navigate() issues the next hop as a fresh navigation, which is vetted like any other. Subresources are
    // only checked for private addresses so that a public page cannot make the scanner reach into a private network.
    await context.route('**/*', async (route) => {
      const request = route.request();
      let url: URL;
      try {
        url = new URL(request.url());
      } catch {
        return route.abort('blockedbyclient');
      }
      if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
        const refusal = await vet(url);
        if (refusal) {
          navigation.refusal = refusal;
          return route.abort('blockedbyclient');
        }
        try {
          const fetched = await route.fetch({ maxRedirects: 0, timeout: o.timeoutMs });
          const location = fetched.headers()['location'];
          if (fetched.status() >= 300 && fetched.status() < 400 && location) {
            navigation.redirectTo = new URL(location, request.url()).toString();
            return await route.abort('aborted');
          }
          return await route.fulfill({ response: fetched });
        } catch {
          return route.abort('failed').catch(() => undefined);
        }
      }
      if (!o.allowPrivate && (await hostProblem(url.hostname)) === 'private_address') return route.abort('blockedbyclient');
      return route.continue();
    });

    type Navigated = { ok: true; response: Response | null } | ({ ok: false } & Refusal);
    const navigate = async (page: Page, firstUrl: string): Promise<Navigated> => {
      let target = firstUrl;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        navigation.refusal = null;
        navigation.redirectTo = null;
        try {
          return { ok: true, response: await page.goto(target, { waitUntil: 'load', timeout: o.timeoutMs }) };
        } catch (err) {
          const state = readNavigation();
          if (state.refusal) {
            const via = hop > 0 ? `redirect target ${stripQuery(target)}: ` : '';
            return { ok: false, reason: state.refusal.reason, detail: via + state.refusal.detail };
          }
          if (state.redirectTo) {
            target = state.redirectTo;
            continue;
          }
          const message = errorMessage(err);
          if (/download is starting/i.test(message)) return { ok: false, reason: 'non_html', detail: 'the URL is a file download' };
          return { ok: false, reason: 'load_failed', detail: message };
        }
      }
      return { ok: false, reason: 'load_failed', detail: 'too many redirects' };
    };

    const loadPage = async (url: URL): Promise<PageOutcome> => {
      const page = await context.newPage();
      const loadErrors: string[] = [];
      page.on('dialog', (dialog) => void dialog.dismiss().catch(() => undefined));
      page.on('popup', (popup) => void popup.close().catch(() => undefined));
      page.on('requestfailed', (request) => {
        const state = readNavigation();
        if (state.redirectTo || state.refusal) return; // the scanner itself stopped this navigation
        if (loadErrors.length < MAX_LOAD_ERRORS) loadErrors.push(`${request.method()} ${stripQuery(request.url())} failed: ${request.failure()?.errorText ?? 'unknown'}`);
      });
      try {
        const navigated = await navigate(page, url.toString());
        if (!navigated.ok) return navigated;
        const { response } = navigated;
        if (!response) return { ok: false, reason: 'load_failed', detail: 'no response' };
        const headers = response.headers();
        if (response.status() >= 400) return { ok: false, reason: 'load_failed', detail: `HTTP ${response.status()}` };
        const contentType = headers['content-type'];
        if (contentType && !/^(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
          return { ok: false, reason: 'non_html', detail: contentType.split(';')[0] ?? contentType };
        }

        await page.waitForLoadState('networkidle', { timeout: Math.min(o.timeoutMs, NETWORK_IDLE_MAX_MS) }).catch(() => undefined);
        await sleep(o.settleMs);

        const fetchedAt = new Date().toISOString();
        const finalUrl = page.url();
        const content = await capturePageContent(page);
        const screenshot = await takeScreenshot(page, o.outDir, pages.length + 1, loadErrors);
        const images = await inspectImages(content.images, {
          maxImages: o.maxImagesPerPage,
          maxBytes: o.imageMaxBytes,
          allowPrivate: o.allowPrivate,
          userAgent,
          robotsAllows: async (src) => {
            const parsed = canonicalize(src);
            if (!parsed || !isSameSite(parsed, start)) return true;
            return (await robotsFor(parsed.origin)).rules.isAllowed(parsed.pathname + parsed.search);
          },
        });
        const snapshot: PageSnapshot = {
          url: url.toString(),
          finalUrl,
          status: response.status(),
          fetchedAt,
          title: content.title,
          lang: content.lang,
          html: content.html,
          text: content.text,
          scripts: content.scripts,
          iframes: content.iframes,
          links: content.links,
          images,
          domCandidates: content.domCandidates,
          headers,
          screenshot,
          loadErrors,
        };
        return { ok: true, snapshot, links: content.links };
      } catch (err) {
        return { ok: false, reason: 'load_failed', detail: errorMessage(err) };
      } finally {
        await page.close().catch(() => undefined);
      }
    };

    const seen = new Set<string>([start.toString()]);
    const frontier = new Map<string, Candidate>();
    let order = 0;
    const enqueue = (links: LinkInfo[]): void => {
      for (const link of links) {
        const url = canonicalize(link.href);
        if (!url || !isSameSite(url, start) || hasNonHtmlExtension(url)) continue;
        const key = url.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        frontier.set(key, { url, score: priorityScore(url, link.text), order: order++ });
      }
    };
    const takeNext = (): Candidate | null => {
      let best: Candidate | null = null;
      for (const candidate of frontier.values()) {
        if (!best || candidate.score < best.score || (candidate.score === best.score && candidate.order < best.order)) best = candidate;
      }
      if (best) frontier.delete(best.url.toString());
      return best;
    };

    let current: Candidate | null = { url: start, score: 0, order: -1 };
    let attempts = 0;
    let lastFinishedAt = 0;
    while (current && pages.length < o.maxPages && attempts < o.maxPages + EXTRA_ATTEMPTS) {
      const isStart = current.url === start;
      const refusal = await vet(current.url);
      if (refusal) {
        skipped.push({ url: current.url.toString(), ...refusal });
        current = takeNext();
        continue;
      }
      if (attempts > 0) {
        const { rules } = await robotsFor(current.url.origin);
        const delay = Math.max(o.delayMs, Math.min((rules.crawlDelaySeconds ?? 0) * 1000, MAX_CRAWL_DELAY_MS));
        const wait = lastFinishedAt + delay - Date.now();
        if (wait > 0) await sleep(wait);
      }
      attempts++;
      const outcome = await loadPage(current.url);
      lastFinishedAt = Date.now();
      if (outcome.ok) {
        const { snapshot } = outcome;
        pages.push(snapshot);
        const finalUrl = canonicalize(snapshot.finalUrl);
        if (finalUrl) {
          seen.add(finalUrl.toString());
          if (isStart && finalUrl.origin !== start.origin) robotsInfo = (await robotsFor(finalUrl.origin)).info;
        }
        enqueue(outcome.links);
      } else {
        skipped.push({ url: current.url.toString(), reason: outcome.reason, detail: outcome.detail });
        if (isStart) {
          startBlocked = outcome.reason === 'robots_disallow' || outcome.reason === 'private_address' || outcome.reason === 'invalid_url' ? outcome.reason : 'load_failed';
          break;
        }
      }
      current = takeNext();
    }

    for (const candidate of [...(current ? [current] : []), ...frontier.values()].slice(0, MAX_UNVISITED_RECORDED)) {
      if (candidate.url !== start) skipped.push({ url: candidate.url.toString(), reason: 'max_pages' });
    }
    return result();
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function takeScreenshot(page: Page, outDir: string, n: number, loadErrors: string[]): Promise<string | null> {
  const relative = `screenshots/page-${n}.png`;
  try {
    await page.screenshot({ path: join(outDir, relative), type: 'png', fullPage: false, timeout: 10_000 });
    return relative;
  } catch (err) {
    loadErrors.push(`screenshot failed: ${errorMessage(err)}`);
    return null;
  }
}
