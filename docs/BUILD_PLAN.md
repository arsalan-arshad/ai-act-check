# Build plan (validation first)

Nothing below starts without the owner's approval.

## Phase 0, days 1-5: confirm and validate (no code)
- C1 primary-source read of Article 50 and the Commission FAQ; write confirmed duties and dates into `docs/RULES.md`.
- C2 competitor scan.
- C4 plan lawyer review of the disclaimer wording before any paid report.

## Phase 1, days 5-14: smallest scanner
- Playwright crawler, CHAT-01/02 and PAGE-01 rules with fixtures, JSON output, CLI.
- Run on ~20 public sites (owner-approved list). Review every finding by hand to measure false positives.

## Phase 2, days 14-30: report and outreach test
- HTML report with evidence and disclaimer; owner reviews wording.
- Send free reports to site owners only after owner approval (one or two a day). Count replies and requests for a paid version.

## Phase 3, only if the gate is met
- Stripe checkout for a fixed-price audit (price band is a guess until tested), web form, MEDIA rules, README and release.

## Gate
First paid report within 30 days of outreach, three within 60 (estimates). Kill: fewer than 3 replies from ~20 free reports and zero paid requests.
