// Deterministic rule library. Pure: the same CrawlResult always yields the same findings, and no
// model is involved. Outcomes are found / not_found / cannot_tell; cannot_tell is never a pass.

import type { CrawlResult, Finding, PageSnapshot } from '../types.js';
import { RULE_CATALOG } from './catalog.js';
import { chat01, chat02, detectChat } from './chat.js';
import { makeFinding } from './evidence.js';
import { analyseImages, media01, media02 } from './media.js';
import { page01 } from './page.js';

export const RULES_VERSION = '0.1.0';
export { RULE_CATALOG };

/** Pages whose content was actually captured; error responses are not representative of the site. */
function evaluablePages(crawl: CrawlResult): PageSnapshot[] {
  return crawl.pages.filter((page) => page.status !== null && page.status >= 200 && page.status < 400);
}

function cannotTellAll(reason: 'blocked_by_robots' | 'no_pages_loaded', summary: string): Finding[] {
  return RULE_CATALOG.map((meta) =>
    makeFinding({ ruleId: meta.ruleId, title: meta.title, outcome: 'cannot_tell', reason, needsHumanJudgement: false, summary, pages: [] }),
  );
}

export function runRules(crawl: CrawlResult): Finding[] {
  if (crawl.startBlocked === 'robots_disallow') {
    return cannotTellAll('blocked_by_robots', 'Could not be determined: robots.txt disallows the start page, so no page was scanned. This is not a pass.');
  }
  if (crawl.startBlocked !== null) {
    return cannotTellAll('no_pages_loaded', `Could not be determined: the start page was not scanned (${crawl.startBlocked.replace(/_/gu, ' ')}), so no page content was available. This is not a pass.`);
  }
  const pages = evaluablePages(crawl);
  if (pages.length === 0) {
    return cannotTellAll('no_pages_loaded', 'Could not be determined: no page was loaded successfully, so no page content was available. This is not a pass.');
  }
  const chat = detectChat(pages);
  const images = analyseImages(pages);
  return [chat01(pages, chat), chat02(pages, chat), media01(pages, images), media02(pages, images), page01(pages)];
}
