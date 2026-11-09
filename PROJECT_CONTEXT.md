# PROJECT_CONTEXT — EU AI Act Transparency Checker

Snapshot: 2026-11-06 · Status: **v0.1 CLI built and tested locally on synthetic fixtures; still an unvalidated hypothesis (C2 recommends park/drop as a product)** · Owner: Arsalan Arshad · License: MIT

> **UPDATE 2026-10-19 (spike C1 done): read `docs/C1_FINDINGS.md` first.** The AI Omnibus was reported as adopted and published (not provisional), and Article 50(1) chatbot disclosure and 50(2) marking fall on **providers**, not automatically on small site owners, which weakens the pitch below. The "Research basis" and "Honest read" sections are partly superseded.

## One-line pitch
An open-source scanner that checks a public website for the AI transparency basics small businesses may need under the EU AI Act (chatbot disclosure, AI-generated content marking), plus a paid, fixed-price audit report. Technical check only, never legal advice.

## Why this exists (decision of 2026-10-19)
Owner's goal: **income within 90 days**, **mostly global** market, **zero audience**, standalone product. The niche-scan (`claude/NICHE_AI_STARTUP_SCAN.md` in the Lab project) found no proven gap; this is hypothesis #1 of two the owner chose to pursue (the other is `04-freight-exceptions`). Its attraction: the scan result is the outreach ("your chatbot has no AI disclosure"), so no audience is needed, and it needs no integrations or customer logins.

## Research basis (honest)
- Single secondary source (Lobster Pack blog, 2026-05-07, "EU AI Act omnibus delay"): a provisional political agreement delayed Annex III high-risk rules to 2 Dec 2027 and Annex I to 2 Aug 2028, but Article 50 transparency duties stayed in force from **2 Aug 2026**, with a grace period to **2 Dec 2026** for Article 50(2) content marking on systems already on the market. Described as **not yet final law** at that date.
- **Everything about the law is unverified against primary sources.** Spike C1 must confirm it from the official text and the Commission's AI Act Service Desk before any public claim.
- Competitors: not checked. Spike C2.
- Willingness to pay: unknown. Spike C3.

## Honest read
- Pros: no audience needed; deterministic core fits the owner's pattern; open source and cheap; global; fast to a first test (about 20 free scans).
- Cons: legal-adjacent liability if a finding is wrong; rules still moving; the buyers who care may go to law firms or big compliance vendors; "scanner finds nothing wrong" gives no reason to pay; a scanner can only see public pages, not what the business's systems actually do.
- Kill signal: after ~20 free reports sent, fewer than 3 replies and zero paid requests.

## Gate (estimates, not facts)
First paid report within 30 days of starting outreach; 3 within 60 days. Otherwise stop and go back to the services studio.

## Decisions
- D1: TypeScript on Node; Playwright to render pages; deterministic rule library; AI only explains findings (never decides pass/fail).
- D2: Every report states it is a technical check, not legal advice, lists exactly which pages and rules were checked, and shows evidence (screenshot and matched text).
- D3: CLI first (`npx`), web form and paid report second. Stripe only after the free scan has pulled real interest.
- D4: Public pages only; respect robots.txt; rate-limit; no logins, no scraping of personal data.
- D5: MIT. BYOK for the optional AI explanation step.

## Open questions
- Q1: Which Article 50 duties actually apply to small businesses, and which can a scanner check from the outside? (Spike C1)
- Q2: Who already sells this? (Spike C2)
- Q3: Who is the first user: an EU SME owner, a web agency auditing client sites, or a compliance freelancer? (Spike C3)
- Q4: Does the owner want liability insurance or a lawyer review of the report wording before charging?

## Spikes (do before building)
- C1 Read the primary text (Regulation (EU) 2024/1689, Article 50) and the Commission's FAQ; list each duty and whether it is externally checkable. Record dates with sources.
- C2 Landscape: search for existing AI Act website scanners/checkers and compliance tools; note price and what they check.
- C3 Build the checklist by hand, run it on ~20 public sites, send free reports only after owner approval, count replies.
- C4 Report wording review: have a qualified person (lawyer) review the disclaimer before any paid report.

## Punch list
Done: spikes C1 and C2; v0.1 scanner (CLI, rules, JSON and HTML report, optional BYOK explain) built and tested on fixtures.
Open (all need owner approval, none started):
1. Decide: continue, narrow to an agency/provider angle, or park (C1 and C2 both weaken the standalone product case).
2. Verify Article 50 text and dates against the Official Journal and the Commission's AI Act Service Desk.
3. Spike C4: lawyer review of the report disclaimer wording before any paid report.
4. Spike C3: owner-approved list of ~20 real sites, scan them, hand-review every finding for false positives, then (only with approval) send 1-2 free reports a day.
5. Create the GitHub repo, first commit and push (git repo exists locally, no commits yet); decide on npm publish.

## Progress log
(append numbered sections here after material progress)

### 1. Spike C1 result (2026-10-19)
Done from secondary sources plus an unofficial copy of Article 50 (official EUR-Lex text could not be fully read by the tools). Omnibus reported as adopted; Art. 50 applies from 2 Aug 2026; chatbot disclosure (50(1)) and marking (50(2)) are provider duties; deployer duties (50(3), 50(4)) are mostly not externally checkable. Verdict: idea weaker than first recommended; test a provider/agency angle or a best-practice audit framing, or drop. Full detail in `docs/C1_FINDINGS.md`. Still to do: verify against the Official Journal, C2 competitors, C4 lawyer view.

### 2. Spike C2 result (2026-10-19)
Competitors exist and are close to our design: DisclosureProof (scanner with C2PA/IPTC checks, versioned rule pack, three-outcome results, white-label agency tier; free to $200/month, $79 evidence pack), Article 50 Ready (EUR 29 one-time), the free AI Act Checker, WordPress plugins. With C1 (chatbot disclosure and marking are provider duties), recommend parking or dropping 03 as a product. Detail in `docs/C2_COMPETITORS.md`.

### 3. v0.1 scanner built (2026-11-06)
Built to `docs/SPEC.md` by a multi-agent run: orchestrator fixed the interface contract (`src/types.ts`, `docs/DEV_CONTRACT.md`), then three developer agents (crawler+metadata, rules, report+explain+CLI) worked in parallel on disjoint files, and a separate QA agent wrote about 50 synthetic fixture sites and end-to-end tests from the contract only. QA found 2 real bugs (not_found findings had no evidence; self-built chat widgets with non-vendor ids were missed) plus a guard/template wording contradiction; all fixed and re-verified.
- What exists: Playwright crawler (robots.txt always honoured, rate limit, private-address refusal, same-site only, no clicks/forms/cookies), rules CHAT-01, CHAT-02, MEDIA-01, MEDIA-02, PAGE-01 (46 vendor patterns, phrase lists in 8 languages, all best-effort and unvalidated), JSON + self-contained HTML report with fixed disclaimer, optional BYOK explanation with a guard and template fallback, CLI `ai-act-check <url>`.
- Tests: 798 passing (642 unit, 156 end-to-end against local fixtures and a mock LLM; no real sites, no real APIs) in the cloud workspace with Chromium; the 434 browser-free unit tests also pass on the owner's Mac toolchain after a clean `npm ci` and build. Runtime dependency: `playwright` only; `npm audit --omit=dev` found 0 vulnerabilities; dev-only audit warnings exist (vitest/esbuild), not addressed.
- Not done / not claimed: no real site has been scanned; no accuracy claim; no repo push, no npm publish, nothing sent to anyone. Legal basis still unverified against the Official Journal. Chromium cannot be downloaded in the Claude desktop sandbox, so browser tests run in the cloud workspace; on the Mac run `npx playwright install chromium`.
- Known limits: late-loading, consent-gated and closed-shadow-DOM widgets are missed; chat UI text visible only after opening is not inspected; absence of image metadata proves nothing; tiny (tracking-pixel) images are skipped; third-party image hosts are not checked against their own robots.txt; DNS rebinding is not fully closed.
- Honest read unchanged: DisclosureProof and others already sell near-identical scanners (`docs/C2_COMPETITORS.md`), and chatbot disclosure/marking are provider duties (`docs/C1_FINDINGS.md`). The build makes the C3 test cheap to run; it does not change the market evidence.
- Environment note: a `dist/` folder created in the Mac folder by the desktop sandbox has a 0-byte `dist/rules/data/vendors.json` and a stray `dist/rules/data/x.tmp`; run `rm -rf dist && npm run build` on the Mac. `.transfer/` holds the transfer tarball and can be deleted.
