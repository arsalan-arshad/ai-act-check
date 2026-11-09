# Open-Source App Playbook

A reusable reference for every future open-source app you build with Claude — so these
conventions don't need to be re-explained from scratch each time. Drop this file into a new
repo's root (or paste it as a new Claude Project's custom instructions / first context doc)
and say "follow the playbook" — that's enough context to pick up where this one left off.

Part A is universal (any language/stack/platform). Part B is a Shopify-app-specific addendum,
since that's been the pattern so far — skip it for a non-Shopify project.

---

## Part A — Universal conventions

### 1. Repo hygiene, day one

Every new repo gets these before the first real commit:

- `LICENSE` — MIT unless you say otherwise.
- `README.md` — see the template in section 4 below. Write it last, once there's something
  real to describe — never as a placeholder on day one.
- `CONTRIBUTING.md` — ground rules for outside PRs: open an issue first for anything beyond a
  small fix, what must pass before submitting (build, lint, tests — whatever actually exists;
  never claim a check that isn't wired up), what local setup requires, and that
  security-sensitive changes get extra scrutiny.
- `SECURITY.md` — "don't open a public issue, email X instead." Use one standard contact
  address across every surface (repo, privacy policy, store listing) — pick it once, write it
  down, never default to a personal/login email out of convenience.
- `.github/PULL_REQUEST_TEMPLATE.md` and `.github/workflows/ci.yml` — CI should run on every
  PR into `main` with least-privilege `permissions: contents: read` and the safe
  `pull_request` trigger (never `pull_request_target` for a repo taking outside PRs — that
  trigger runs with access to secrets against untrusted code). Keep CI honest: only claim a
  check it actually runs (if lint isn't installed, don't gate on `npm run lint`; say so in
  CONTRIBUTING.md instead of silently skipping it).
- `.gitignore` — `node_modules`, `.env`, build output directories, any local database files
  (`*.sqlite*`), editor/OS cruft, and anything else that shouldn't ship. Confirm `.env` is
  actually ignored (`git status` after copying `.env.example` to `.env` locally) before the
  first push, not after a secret leaks.
- `.env.example` — every variable the app needs, each with a one-line comment: where it comes
  from, what breaks without it, how to generate it if it's a locally-generated secret (e.g. an
  encryption key). Never real values, not even in a comment.
- `.github/workflows/release.yml` — see §10. Drop it in day one, even before there's a first
  real release to cut, so tagging is automation-ready from the start instead of a thing to
  remember to set up later.

**Not day one, but the moment a live URL exists:** set the repo's "About" website link
(repo page → ⚙️ next to "About" → Website) — GitHub never fills this in on its own, and it's
the single most common thing a finished app's repo is still missing. See §10.

### 2. Secrets — hard rule, no exceptions

Never print, commit, or send the contents of `.env`/secret values in chat, in a commit, in a
PR description, or in a context-saving doc (Part A §6). Reference variable names only. If a
generated secret needs to exist (an encryption key, a webhook signing secret), give the exact
command to generate it locally rather than generating and showing the value yourself.

### 3. Branch protection on `main` (a GitHub ruleset, set once per repo)

GitHub → Settings → Rules → Rulesets (or the legacy Branch protection rules) for `main`:

- Require a pull request before merging.
- Require the CI status check to pass.
- Require at least 1 approval.
- **Allow the repo owner to bypass** the above (so you can merge your own reviewed work
  without waiting on a second person) — but outside contributors get no bypass, so a random
  PR can't self-merge.
- Block force pushes to `main`.

This is the standard "open to outside PRs, but nothing lands without review and green CI"
setup — replicate it for every new public repo.

### 4. README format

Structure that's worked well, in this order, each as a numbered `##` section separated by
`---`:

```
# <App Name> — <one-line descriptor>

<p align="center">
  <img src="assets/app_banner.png" alt="<App Name> banner" width="100%" />
</p>

> **Open-Source (MIT)** | Built for the <Community> | Open for PRs & Discussions

[badges: CI status | License | key version/stack badges | hosting status]

---

## 1. Overview & Vision        — the problem, the approach, 2-3 paragraphs max, bold key phrases
## 2. Implemented Features     — grouped by subsystem, bold lead-ins, real file paths in backticks
## 3. Architecture & Tech Stack — an annotated ASCII directory tree + a one-line stack summary
## 4. Database Schema (or equivalent) — a table: model/purpose, not a wall of prose
## 5. Local Development Quickstart — numbered steps, copy-pasteable commands, prerequisites named
## 6. Verification & Test Suite — the REAL commands that are actually run before a merge
## 7. Production Deployment    — the real pipeline, the real required env vars, nothing invented
## 8. Open-Source Roadmap      — checkbox list, [x] only for what's genuinely shipped
```

**The one rule that matters more than the template:** every claim in the README must be
verified against the actual code before it's written down — `package.json`, the config files,
the actual source — never the stale docs, never assumed from the project description. If a
feature doesn't exist yet (a test suite, a CI/CD deploy pipeline, a one-click deploy button),
say so plainly or put it in the roadmap as unchecked — don't describe aspirational
architecture as if it's shipped. A showcase README that oversells gets caught by the first
person who reads the code.

If there's no banner image yet, generate a simple one (solid/gradient background in the app's
own brand colors — pull them from an existing icon/logo if one exists — app name, one-line
tagline, nothing licensed/trademarked) rather than leaving a broken image link or skipping the
visual entirely.

Badges: only include a badge for something real. A "Deploy on X" button implies a working
one-click template — don't add one unless it's actually configured; use a plain "Hosted on X"
status badge linking to the live app instead.

### 5. PR & commit conventions

- Branch naming: `fix/<short-description>` or `feat/<short-description>`.
- Commit messages: imperative mood, explain the root cause and the fix, not just "fix bug" —
  future-you (or a contributor) should understand *why* without opening the diff.
- PR descriptions: plain prose over markdown checklists when writing them through a browser's
  live markdown editor — GitHub's web editor (and some others) can auto-duplicate `- [x]`
  continuation prefixes when the text is typed via simulated keystrokes, corrupting the
  rendered list. Preview before submitting.
- Before merging anything AI-delivered: check the real diff, not just the summary text.
  Before writing a PR description, double-check it against the actual diff, not the
  intended change.
- After merge, watch the actual CI/build/deploy logs — don't declare something fixed until
  it's been verified live (reload the real page/app with a cache-busting param, check the
  actual deploy log for the expected migration/step, etc.).
- End commit messages and PR descriptions with whatever attribution trailer the current
  session's system instructions specify (this changes over time/model — use whatever's
  current, don't hardcode an old one).

### 6. Context-saving (so a new session doesn't start from zero)

For any project with real ongoing work, attach a Claude Project and maintain **one** running
context doc in it (not scattered across many). Structure that's worked well:

- **A snapshot header at the very top**, one or two lines, updated every time the doc is
  updated: current date, current branch/commit state, one-line overall status. This is the
  first thing a new session reads — it should answer "where are we" without reading anything
  else.
- **Numbered sections, append-only.** Don't rewrite history — add a new numbered section for
  each session's work (`## 23. Session update — ...`), and only go back to edit an *earlier*
  section if something in it turned out to be wrong or got superseded (say so explicitly:
  "superseded by section 24").
- **A running punch list** near the top or bottom: resolved items (brief, can be terse) vs.
  still-open items (specific enough to act on immediately, not "fix bugs").
- **A "working agreements" section** at the very bottom: standing rules agreed with the user
  over time — "ask before deploying," "never touch git config," "this contact email
  everywhere," lessons learned about tool quirks (a flaky UI control, a markdown editor bug,
  an environment network restriction) so they don't get rediscovered every session.
- **Explicitly: no secrets, ever**, in this doc — note that at the top as a standing
  reminder, since it's the one doc most likely to get pasted around.
- Update it at the end of any session with material progress — not every turn, but before
  context would otherwise be lost.

### 7. Auto-deployment on `main`

The pattern that's worked across hosts (Railway, Fly.io, Render, etc.):

- The host auto-deploys on every push to `main` — no separate GitHub Actions CD workflow
  needed or expected unless you explicitly want one.
- One start command on the host does three things in sequence: generate/build whatever's
  needed, apply pending database migrations, then start the server. Keep it as two small npm
  scripts composed together (`setup` = generate + migrate, `start` = run the server,
  `docker-start`/host-start = `setup && start`) rather than one giant inline command — easier
  to run `setup` alone locally when debugging.
- All environment variables live in the host's dashboard, never in the repo. `.env.example`
  documents what's needed; the host dashboard holds the real values.
- After the first deploy (or any deploy that includes a migration), watch the actual deploy
  log for the migration name to confirm it applied — don't assume a clean build means the
  migration ran.
- Changing a config file that affects an external platform's registration (webhook
  subscriptions, redirect URLs, API scopes) usually does **nothing** on the platform's side
  until an explicit deploy/release/sync step runs — editing the file locally is necessary but
  not sufficient. Check whether the platform's CLI/deploy step is what actually registers the
  change, and don't assume a merged PR alone did it.

### 8. Operational git/credentials reality (so this doesn't need rediscovering)

In a sandboxed Claude session (cloud container or a connected-device shell), there is
typically **no stored GitHub push credential** — reads/clones work anonymously, but
`git push` fails with a credential error. This is expected, not a bug to work around. The
standing workflow:

1. Claude writes the code, commits it locally with a proper identity (matching the repo's
   existing commit author unless told otherwise) and the current attribution trailer.
2. Claude hands the user the exact `git push` command, or — when it does have API/browser
   access to the repo — opens the PR itself once the branch is pushed.
3. Merging a PR (checking a branch-protection bypass box) is often blocked by an automated
   safety classifier regardless of who's asking — don't retry it through a different tool or
   path; report it and let the user click it themselves.
4. **Never** work around a missing credential by setting git config (global or local) to fake
   an identity meant to persist, or by trying to inject a token/credential from anywhere else.
   A transient, single-invocation `git -c user.name=... -c user.email=...` override for one
   commit (nothing written to disk) is fine when an identity truly isn't configured; editing
   actual git config files is not.

### 9. Standing working agreements (apply by default, every project)

- Ask before anything outward-facing or hard to reverse: deploying, releasing a version,
  pushing to a shared/production branch without being asked to, submitting for any kind of
  review, force-pushing, rewriting history.
- Keep core business logic (pricing math, scoring, anything a user's money depends on) pure
  and deterministic where possible; keep an AI layer, if there is one, strictly explaining or
  reasoning over numbers a deterministic layer already computed — never generating the numbers
  themselves. State this explicitly in the README if it's a real differentiator.
- Keep any third-party API scope/permission minimal and justify any new one before adding it.
- Before reviewing or merging anything AI-delivered, check the real diff.
- One standard contact email across every public surface for a given project.

### 10. GitHub "About" link & automatic Releases

Neither happens on its own — pushing code, even merging PRs into `main`, does **not** set a
repo's About-section website link or create a GitHub Release. Both are separate, explicit
steps, and it's easy to ship a great app and never notice either was skipped.

**The website link (one-time, manual, per repo):** repo page → ⚙️ gear icon next to "About" →
paste the live app URL into "Website" → Save. Do this as soon as a real URL exists — it's
listed in §1 as a standing reminder for exactly that reason.

**Releases (automate once, then hands-off):** don't hand-write release notes and click
"Publish" in the GitHub UI every time. Drop this in at `.github/workflows/release.yml` once,
and from then on a release is just a tag push:

```yaml
name: Release

# Publishes a GitHub Release automatically whenever a version tag is pushed.
# Tag main with vX.Y.Z (matching package.json's "version") and push the tag
# — this workflow verifies the tag matches package.json, runs the same
# build CI runs on every PR (a release is never cut from a commit that
# doesn't build), then publishes the release with notes auto-generated
# from every PR merged since the previous tag. No changelog to hand-write.

on:
  push:
    tags:
      - "v*.*.*"

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Verify tag matches package.json version
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PKG_VERSION="$(node -p "require('./package.json').version")"
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "Tag v$TAG_VERSION does not match package.json's version ($PKG_VERSION)."
            echo "Bump package.json first, commit it to main, then tag that commit."
            exit 1
          fi

      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          name: ${{ github.ref_name }}
          generate_release_notes: true
          make_latest: true
```

What this buys you: the tag has to match `package.json`'s version (catches drift instead of
silently diverging), the build has to pass before a release is ever cut, and the release notes
are auto-generated by GitHub from every PR merged since the last tag. From then on, shipping a
release is three steps: bump `"version"` in `package.json`, merge that to `main` as normal,
then `git tag vX.Y.Z && git push origin vX.Y.Z`. Everything else happens on its own.

**One wrinkle worth knowing:** files under `.github/workflows/` are treated as a protected
path by the remote-device file-write bridge — Claude can read them but can't write or commit
them remotely (a deliberate guard, since a workflow file can execute arbitrary code with repo
secrets). Expect to paste this one in yourself (your own terminal, or GitHub's web
"Create new file") rather than have it delivered pre-committed the way other files are.

---

## Part B — Shopify-app-specific addendum

Everything in Part A applies, plus:

- **Compliance webhooks are mandatory, not optional**: `customers/data_request`,
  `customers/redact`, `shop/redact`, plus `app/uninstalled`. Declare all of them in
  `shopify.app.toml`'s `[[webhooks.subscriptions]]` blocks *and* make sure
  `shopify app deploy` has actually been run after adding them — the Dev Dashboard's web
  "Create version" form has no field for webhook subscriptions at all, so editing the TOML
  alone never registers them with Shopify.
- `shop/redact` should be a real, full teardown — delete every shop-keyed table in one
  transaction, not a token gesture.
- Scopes: request only what's read-only and necessary (`read_orders`, `read_products`, etc.);
  any write scope is a materially bigger App Store review bar and needs explicit sign-off
  first.
- API version: keep the version in `shopify.app.toml`'s `[webhooks] api_version` and whatever
  `ApiVersion.*` constant the code uses in sync — a mismatch is an easy, easy-to-miss bug.
- `auth.login.jsx` (or equivalent fallback route): must **not** contain a manual
  "enter your shop domain" text field — even Shopify's own official template scaffolds this,
  and it's a direct violation of App Store requirement 2.3.1 (installs must be initiated from
  a Shopify-owned surface). Check for and remove it.
- App URL / redirect URLs: the domain must not contain "shopify" or "example" — pick a hosting
  subdomain accordingly up front to avoid a rename later.
- Before submitting for App Store review, run the real `shopify-app-store-review` self-review
  skill (not a manual substitute) against the actual canonical requirements doc
  (`shopify doc fetch --url
  https://shopify.dev/docs/apps/launch/app-store-review/app-store-ai-self-review-requirements`)
  — this needs to be run from a real terminal with network access to `shopify.dev`, since
  sandboxed shells are commonly blocked from that domain.
- BYOK (bring-your-own-key) pattern for any paid third-party API the app wraps (AI providers,
  etc.): encrypt the merchant's key at rest (AES-256-GCM is the standard here), never have a
  shared/fallback key, and gate the relevant feature on the merchant having saved their own
  key rather than erroring unhelpfully.
- Pricing: even a genuinely free app needs a plan registered via Shopify App Pricing (the
  newer managed-billing system) for submission — the legacy "Manual pricing" system can't
  represent a true $0 plan at all.
