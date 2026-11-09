# Contributing to ai-act-check

This project is **open source (MIT)**. It is a technical check, **not legal advice**, and rules are best-practice indicators, not legal conclusions.

## Setup
```bash
npm ci
npx playwright install chromium   # one-time browser download for the scanner and the tests
npm run typecheck
npm run build
npm test
```
Requires Node 20 or newer.

## Ground rules
- Open an issue first for anything beyond a small fix; one change per PR; branches `feat/<short>` or `fix/<short>`.
- Every new or changed rule needs fixtures (found, not found, cannot tell) and must record evidence. Deterministic rules decide; a model may only explain findings, never change them.
- `cannot tell` is a valid result and must never be worded or displayed as a pass.
- Tests must not contact real websites or real model APIs; use the local fixture server in `test/fixtures/`.
- Never commit secrets (`.env` is ignored) or real third-party site content.
- Do not add runtime dependencies without discussing it in an issue first; the only one today is `playwright`.
- Only claim checks that are wired up. What CI runs: typecheck, build, tests. There is no linter yet.
- Legal wording and dates: cite the official text (Regulation (EU) 2024/1689) in the issue; blog posts are not sources.
- Security-sensitive changes (crawler scope, robots handling, private-address refusal, report escaping) get extra scrutiny.

## Pointers
- `docs/SPEC.md` and `docs/RULES.md`: principles and rule list. `docs/C1_FINDINGS.md`, `docs/C2_COMPETITORS.md`: research notes.
