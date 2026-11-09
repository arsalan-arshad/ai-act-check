import type { RobotsInfo } from '../types.js';
import { readLimited, safeFetch } from './net.js';

export const PRODUCT_TOKEN = 'ai-act-check';
const MAX_ROBOTS_BYTES = 512 * 1024;

export interface RobotsRules {
  /** `pathWithQuery` is pathname + search of the URL being tested. */
  isAllowed(pathWithQuery: string): boolean;
  /** Crawl-delay in seconds of the group that applies to us, if any. */
  crawlDelaySeconds: number | null;
}

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay: number | null;
}

export const ALLOW_ALL: RobotsRules = { isAllowed: () => true, crawlDelaySeconds: null };
export const DISALLOW_ALL: RobotsRules = { isAllowed: () => false, crawlDelaySeconds: null };

function compilePattern(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/**
 * Minimal robots.txt parser (RFC 9309 semantics): groups by User-agent, our product token wins over `*`,
 * longest matching pattern wins, Allow wins ties, `*` and trailing `$` wildcards, Crawl-delay.
 */
export function parseRobots(text: string, productToken: string = PRODUCT_TOKEN): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let collectingAgents = false;

  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }
    collectingAgents = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      if (value === '') continue; // an empty Disallow means "allow everything", an empty Allow changes nothing
      current.rules.push({ allow: field === 'allow', pattern: value, regex: compilePattern(value) });
    } else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay ??= seconds;
    }
  }

  const token = productToken.toLowerCase();
  const named = groups.filter((g) => g.agents.includes(token));
  const applicable = named.length > 0 ? named : groups.filter((g) => g.agents.includes('*'));
  const rules = applicable.flatMap((g) => g.rules);
  const crawlDelaySeconds = applicable.find((g) => g.crawlDelay !== null)?.crawlDelay ?? null;

  return {
    crawlDelaySeconds,
    isAllowed(pathWithQuery: string): boolean {
      if (pathWithQuery === '/robots.txt') return true;
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!rule.regex.test(pathWithQuery)) continue;
        if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

export interface RobotsLoad {
  rules: RobotsRules;
  info: RobotsInfo;
}

/**
 * Fetches and parses `<origin>/robots.txt`. 404/410 and other plain 4xx mean "no restrictions".
 * 401/403, 5xx, redirect loops, timeouts and network errors are treated conservatively as
 * "disallow everything for this run" (`info.fetched` is false), because the site's wishes are unknown.
 */
export async function loadRobots(origin: string, timeoutMs: number, allowPrivate: boolean, userAgent: string): Promise<RobotsLoad> {
  const url = `${origin}/robots.txt`;
  const result = await safeFetch(url, { headers: { 'user-agent': userAgent, accept: 'text/plain,*/*;q=0.5' }, timeoutMs, allowPrivate });
  if (!result.ok) {
    return { rules: DISALLOW_ALL, info: { url, fetched: false, status: null, crawlDelaySeconds: null } };
  }
  const { status } = result.response;
  if (status >= 200 && status < 300) {
    const body = new TextDecoder('utf-8').decode(await readLimited(result.response, MAX_ROBOTS_BYTES));
    const rules = parseRobots(body);
    return { rules, info: { url, fetched: true, status, crawlDelaySeconds: rules.crawlDelaySeconds } };
  }
  await result.response.body?.cancel().catch(() => undefined);
  if (status === 401 || status === 403 || status >= 500) {
    return { rules: DISALLOW_ALL, info: { url, fetched: false, status, crawlDelaySeconds: null } };
  }
  return { rules: ALLOW_ALL, info: { url, fetched: false, status, crawlDelaySeconds: null } };
}
