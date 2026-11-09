# ai-act-check — a technical scanner for AI transparency basics on public websites

> **Open source (MIT).** A technical check of public web pages. **Not legal advice**, not a certification, not a compliance assessment.

---

## 1. Overview and status

`ai-act-check` loads a public website in a headless browser and runs a small set of **deterministic rules** that look for things related to the transparency provisions of the EU AI Act (Article 50): is there a chat widget, is there AI-disclosure wording near it, do images carry AI-generation metadata, is there a visible "AI-generated" label, is there a page about AI use. Every finding is one of **found**, **not found** or **cannot tell**, and carries evidence (URL, matched text or script, screenshot, timestamp).

**"Cannot tell" is not a pass.** It means the scan could not determine the answer from outside. A model may optionally *explain* findings in plain language, but it never adds, removes or changes one.

**Honest status: v0.1, an unvalidated hypothesis.** Read these before relying on it:

- The legal basis is **not verified against the Official Journal**. Per the notes in `docs/C1_FINDINGS.md` (secondary sources plus an unofficial text), the chatbot-disclosure duty (Art. 50(1)) and content-marking duty (Art. 50(2)) fall on *providers*, not automatically on the owner of a site that embeds a widget. A finding here is a **best-practice indicator**, not a statement that anyone breaches a law.
- The category is **already served** by other tools; see `docs/C2_COMPETITORS.md`.
- Detection patterns (46 chat vendors, phrase lists in 8 languages) are best-effort and have **not** been validated against live sites. No accuracy claim is made beyond what the fixture tests show.

## 2. What it checks

| Rule | Looks for | Typical limits |
|---|---|---|
| `CHAT-01` | A chat widget (known vendor scripts/iframes, or a visible chat-like widget) | Finds a *chat widget*, not whether it is AI-driven. Late-loading, consent-gated or closed-shadow-DOM widgets can be missed. |
| `CHAT-02` | AI-disclosure wording inside or at the widget | Wording is matched, never judged for adequacy. A closed launcher usually gives `cannot tell`. |
| `MEDIA-01` | C2PA content credentials, IPTC `DigitalSourceType`, AI-tool hints in image metadata | Absence of metadata proves nothing. Very small images are skipped. |
| `MEDIA-02` | A visible AI label near images flagged by `MEDIA-01` | Needs `MEDIA-01` to find something first. |
| `PAGE-01` | A link to an AI-use or transparency page | Presence only; matches any "artificial intelligence" link. |

Full definitions and limitations are in the `ruleCatalog` of every report and in `src/rules/catalog.ts`.

**Not in scope:** logins, mobile apps, closed chat systems, legal interpretation, certification.

## 3. Scanning behaviour (by design)

- Public pages only. `robots.txt` is always respected (there is no switch to disable it); if it cannot be read reliably the scan stops rather than guesses.
- Rate-limited (default 1.5 s between page loads, raised by `Crawl-delay`), honest `User-Agent` (`ai-act-check/<version> (open-source technical scanner; not legal advice)`), same-site pages only, at most 25 pages.
- Refuses localhost and private-network targets unless `--allow-private` is passed (for testing fixtures).
- Never clicks, never fills forms, keeps no cookies, collects no personal data.
- Scan only sites you are allowed to scan.

## 4. Quickstart

Requires Node 20 or newer.

```bash
npm ci
npx playwright install chromium     # one-time browser download
npm run build

node dist/cli.js <url> [options]    # or, after publishing: npx ai-act-check <url>
```

Options (`node dist/cli.js --help`): `--pages N` (1-25, default 10), `--out DIR`, `--json` (pure JSON on stdout), `--explain`, `--delay-ms`, `--timeout-ms`, `--settle-ms`, `--allow-private`, `--no-html`, `--version`.

Exit codes: `0` scan completed, `1` internal error, `2` usage error, `3` scan refused or blocked (robots.txt, private address, invalid URL, start page failed).

Output directory: `report.json`, `report.html` (single self-contained file) and `screenshots/`.

### Optional plain-language explanation (bring your own key)

```bash
export LLM_PROVIDER=anthropic     # or openai
export LLM_API_KEY=...            # yours; never printed, never written to reports
node dist/cli.js <url> --explain
```

The model sees only rule titles, outcomes and summaries (no page text), must return JSON for exactly the rules it was given, and is rejected by a guard if it contradicts an outcome, calls anything "compliant", or reads "cannot tell" as fine. On any failure a fixed template text is used. See `.env.example`.

## 5. Architecture

```
src/
  types.ts        shared contracts (Finding, PageSnapshot, Report, ...)
  crawler/        Playwright capture, robots.txt parser, link discovery, private-address guard
  metadata/       image marker extraction (C2PA, IPTC/XMP, AI-tool hints), pure bytes -> markers
  rules/          deterministic rules + data/*.json (vendors, phrase lists)
  report/         report builder, JSON and HTML rendering, fixed disclaimer
  explain/        optional BYOK explanation + guard + template fallback
  scan.ts         crawl -> rules -> report
  cli.ts          command-line entry point
test/
  unit/           unit tests per module
  e2e/            end-to-end tests: real CLI against local fixture sites
  fixtures/       synthetic fixture sites and a mock LLM server (no real sites)
docs/             SPEC, RULES, research notes (C1, C2), DEV_CONTRACT
```

Stack: TypeScript (strict), Node. The only runtime dependency is `playwright`.

## 6. Verification

```bash
npm run typecheck
npm run build
npm test            # unit + end-to-end, all against local fixtures
```

Tests never contact real websites or real model APIs. The end-to-end suite starts local fixture servers and drives the real CLI. There is no linter yet.

## 7. Roadmap

- [x] Deterministic rule library with fixtures, JSON and HTML reports, CLI
- [x] robots.txt, rate limiting, private-address refusal
- [x] Optional BYOK explanation with guard
- [ ] Verify Article 50 duties and dates against the Official Journal and the Commission's AI Act Service Desk
- [ ] Validate detection on a reviewed sample of real sites (owner-approved list; false-positive review by hand)
- [ ] Lawyer review of the report wording before any paid report
- [ ] Web form and paid fixed-price report (only if the validation gate is met)
- [ ] Publish to npm and tag a release (not done; needs owner approval)

## 8. Contributing, security, license

See `CONTRIBUTING.md` and `SECURITY.md`. Contact: arsalanarshad.dev@gmail.com. MIT licensed (`LICENSE`).
