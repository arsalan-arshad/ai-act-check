# E2E bug list (QA)

> **Status: all resolved.** BUG-1 (evidence on not_found) and BUG-2 (self-built widget detection) were fixed in src/rules; the guard/template wording contradiction was fixed in src/explain. Full suite after fixes: 31 files, 798 tests passing. The report below is kept as history.

Run: `npx vitest run test/e2e` (156 tests; 151 pass, 5 fail). `npx tsc -p tsconfig.test.json --noEmit` is clean.
All 5 failures are implementation findings (BUG-1 x3 tests, BUG-2 x2 tests). Test-side issues found along the way were fixed in the tests.

## BUG-1 (major) - `not_found` findings carry no evidence
- Owning module: rules (`src/rules/**`; `pagesEvaluated` is filled, the evidence list is not)
- Failing tests: `evidence.test.ts > evidence on not_found findings > no-chat | chat-no-disclosure | media-clean`
- Contract: DEV_CONTRACT principle 3 ("every finding carries evidence ... screenshot path, ISO timestamp"), RULES "Add the page screenshot as a `screenshot` evidence item", orchestrator ruling 3 (found and not_found need >= 1 evidence item).
- Expected: each `not_found` finding has >= 1 evidence item (at least the screenshot of an evaluated page: url, kind `screenshot`, value `screenshots/page-N.png`, `capturedAt` = page `fetchedAt`).
- Actual: every `not_found` finding has `evidence: []` (CHAT-01, CHAT-02, MEDIA-01, PAGE-01), so "not found" claims cannot be backed by a screenshot or timestamp.
- Repro: serve `test/fixtures/sites/no-chat`, then
  `node dist/cli.js http://127.0.0.1:PORT/ --allow-private --delay-ms 0 --settle-ms 300 --out /tmp/o --json | jq '.findings[]|[.ruleId,.outcome,(.evidence|length),(.pagesEvaluated|length)]'`
  -> CHAT-01 not_found 0 evidence (3 pages evaluated).
- Note: this assertion is deliberately excluded from `invariants.ts` and isolated in `evidence.test.ts` so it does not mask other checks. `found` findings do carry evidence (asserted on every scan).

## BUG-2 (minor, contract ambiguous: "strong chat pattern" is undefined) - visible, chat-named iframe / shadow-DOM widget not counted by CHAT-01
- Owning module: rules (the crawler snapshot is correct: it captured both candidates and the iframe text)
- Failing tests: `matrix.test.ts > ... > chat-in-iframe-weak-name`, `... > chat-shadow-weak-name`
- Contract: DEV-RULES CHAT-01: found = "generic domCandidate/iframe that is visible AND whose id/class/aria matches a strong chat pattern".
- Expected: visible `<iframe id="chat-frame" title="Chat">` whose accessible text says "You are chatting with an AI assistant" (and a visible open-shadow-root `.chat-panel` under `#assistant-host`) -> CHAT-01 found, CHAT-02 found.
- Actual: CHAT-01 `not_found`, CHAT-02 `cannot_tell/no_widget_detected`. The same pages with ids `chat-widget-frame` / `chat-widget-host` pass, so the "strong" test seems to need the literal token `chat-widget` (`chat-launcher` also works).
- Impact: false "not found" for a self-built widget even though its inspectable text literally discloses a chatbot.
- Repro: serve `test/fixtures/sites/chat-in-iframe-weak-name` and scan as above; check `.findings[0].outcome`.
- Please decide: either broaden the strong list (e.g. `chat[-_]?(frame|panel|window|box|bubble|host)`, `assistant`) or document it. `chat-class-comments` (`class="chat"` on a blog comment section) must stay not_found (that fixture passes today).

## Contract ambiguities / observations (no failing test)
- The deterministic template explanation text itself contains "This is not a pass." The guard rule says a cannot_tell text must not contain the word "pass". The template is not run through the guard so nothing fails, but the two rules contradict each other. e2e uses `withoutNegatedPass()` to strip the negated form before flagging pass-words.
- Tiny images (1x1) are `fetchStatus: 'skipped'` by the crawler (apparently a tracking-pixel filter). This is undocumented in DEV_CONTRACT; fixtures now use 64x64 images. Worth a line in the docs/README, since a real AI-marked 1x1 image is unlikely but the behaviour is silent.
- `LLM_BASE_URL`: the mock serves both `/messages` and `/chat/completions` suffixes; the implementation works with it.
