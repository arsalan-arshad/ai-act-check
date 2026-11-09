# Spec — EU AI Act Transparency Checker (v0 blueprint)

## Principles
1. Deterministic rules decide; a model never decides pass or fail.
2. Evidence for every finding: URL, matched text or script, screenshot, timestamp.
3. Three outcomes only: found, not found, cannot tell. Never present "cannot tell" as a pass.
4. Technical check, not legal advice; the report says exactly what was and was not checked.
5. Public pages only, polite crawling, no logins.

## Architecture
- `crawler`: Playwright (headless Chromium) loads the start URL and up to N same-site pages (default 10), waits for network idle, records final DOM, scripts, iframes, images, response headers.
- `rules`: pure functions `(PageSnapshot) => Finding[]`, one file per rule family, vendor lists as JSON.
- `report`: JSON first (machine-readable), then HTML/PDF rendering. A plain-language explanation step may use a model (BYOK) but receives only the findings, and the output is checked to contain no rule result that is not in the input.
- `cli`: `ai-act-check <url> [--pages N] [--json] [--explain]`.

## Types (sketch)
```ts
type Outcome = 'found' | 'not_found' | 'cannot_tell';
interface Finding { ruleId: string; outcome: Outcome; evidence: Evidence[]; needsHumanJudgement: boolean; }
interface Evidence { url: string; kind: 'text'|'script'|'metadata'|'screenshot'; value: string; }
```

## Testing
- Fixture pages (static HTML) for each rule: one passing, one failing, one ambiguous.
- Snapshot tests for report JSON.
- A small public fixture set of synthetic sites; no real third-party sites in tests.

## Non-goals (v0)
Authenticated pages, mobile apps, chatbots inside closed systems, legal interpretation, certification.

## Risks
- Legal wording and dates still moving (verify, spike C1).
- Chat widgets render late or inside iframes; detection will miss some (report "cannot tell").
- Scanning sites at scale may annoy owners; throttle and identify the user agent.
