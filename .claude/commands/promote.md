# /promote — promote-and-watch `develop → main`

Ship work that is **already integrated on `develop`** to production: validate the delta, open the
`develop → main` promotion PR, **stop for explicit confirmation**, then merge and watch GitHub
Actions CI + the Vercel production deploy — ending in a formatted, bulleted report, and offering to chain `/sync-prod` on a confirmed successful deploy.

This is the **promote** counterpart to `finish-task.sh` (which merges `task/* → develop`). It does
**not** merge task branches and does **not** build features. Merging to `main` is the **only** thing
that deploys production on Vercel, so the merge is gated behind an explicit confirmation.

**Promotion is all-or-nothing — the entire `develop` branch as one bundle.** Pulse develops many
features on `develop` and ships them together, never cherry-picked. This command promotes the
**complete** unpromoted delta (whole branch → whole branch via one PR — see `PROMO_BASE` in step 3
for how that delta is computed, which is deliberately _not_ `origin/main..origin/develop`); it never
selects a subset of commits or features. If you do not want some work in production yet, it must not
be merged into `develop` in the first place — there is no "promote only these features" mode.

Design spec: `docs/superpowers/specs/2026-06-21-promote-command-design.md`.

## Arguments

- `--dry-run` (in `$ARGUMENTS`): run steps 1–4 **read-only** and stop **before opening the PR** —
  print the composed PR title/body instead. Never mutates `main`. Safe to run anytime.

## Precondition — run from the main checkout on `develop`

Run from the **main checkout** (`/Users/danijeljovanovic/Dev/Monolith`, parked on `develop`). If
invoked from inside a `task/*` worktree, **surface that and stop** — do not promote from an ambiguous
state.

A **dirty working tree is NOT a stop** — promotion ships only what is on `origin/develop` (committed
**and pushed**), so uncommitted local edits never reach `main`. Report dirty paths as a note, and
ignore `.obsidian/*` entirely (perpetual editor-config noise). The check that genuinely matters is
**un-pushed local `develop` commits** (step 1) — those won't be promoted, so that is the hard stop.

Repo slug is **`Synapsekw/Monilith`** (that spelling is the real remote). `gh` is authed as
`Synapsekw`.

## Steps to follow

Create a TodoWrite item per step and work them in order. **Stop conditions are hard** — on any stop,
emit the report in its `⛔ Stopped` form (see Report) with the relevant link and **no false success
claim**. All CI/deploy watches are **bounded** — on timeout, report "still running after N min, here
is the link" rather than blocking.

**How to watch CI (all waits in steps 2, 4, 7):** launch exactly **one**
`scripts/watch-ci.sh …` per wait, as a **single background Bash task**, and act on its exit code:
`0` → green, proceed · `1` → failed, it prints which run/check — investigate/stop · `2` → timed
out, report "still running after N min" + the link · `3` → usage/prereq error, read its guidance.
**Never** spawn a second watcher for the same target, never use `gh run watch` /
`gh pr checks --watch` (unbounded), never `timeout(1)` (absent on macOS), and never improvise
`until`/`grep` polling loops — the script is the only watch mechanism.

### 1. Preflight (read-only)

- Verify `gh auth status` succeeds and the network is reachable. If not → **stop** ("`gh`
  unauthenticated / offline").
- `git fetch origin develop main`.
- **Migration ledger drift (hard stop).** Run `pnpm db:ledger-check` (DEV). Promotion ships **code**,
  but PROD's schema comes only from **committed files** — so code that depends on DDL applied to DEV
  and never committed works in dev and breaks in production (gotcha-57). Exit `2` (drift) or `1`
  (duplicate/malformed filename) → **stop**, naming the versions; the fix is to backfill the file at
  the ledger's version, not to promote. Exit `3` (could not check) → **note it in the report and
  continue** — `/promote` runs from the main checkout where `.env.prod.local` is present, so a `3`
  here means a genuinely unreachable DB, and blocking a code promotion on it is disproportionate.
- Compute `PROMO_BASE` (see step 3 for the derivation and why it is not `origin/main`), then the
  delta: `git log --oneline "$PROMO_BASE"..origin/develop`. **Empty → friendly stop** ("`main` is
  already up to date with `develop` — nothing to promote.").

  Do **not** test emptiness with `origin/main..origin/develop`. After a heal, `develop`'s tip is the
  heal commit, so that range is non-empty **even when nothing new exists** — the friendly stop would
  never fire and every no-op invocation would open a PR with a body describing months of shipped
  history.

- Collect **branch-hygiene notes** (reported, never auto-fixed): stale local `task/*` branches
  (`git branch --list 'task/*'`) and a dirty working tree (`git status --porcelain`, **excluding
  `.obsidian/*`**) — both are notes, **not** stops.
- **Hard stop:** if local `develop` is ahead of `origin/develop`
  (`git log --oneline origin/develop..develop` is non-empty), **stop** and tell the user to push or
  run `finish-task.sh` first — promotion ships only what is on the remote.

### 2. Validate `develop` is green

- Resolve the SHA: `git rev-parse origin/develop`.
- Find its CI run:
  `gh run list --branch develop --workflow ci.yml -L 1 --json databaseId,status,conclusion,headSha,url`.
  Confirm `headSha` matches the develop SHA (if no run exists for it yet, wait briefly, then re-list).
- If `status` ≠ `completed` → run `scripts/watch-ci.sh branch develop` as one background task and
  wait on its exit code (per the watch policy above).
- `conclusion` ≠ `success` (or watch exit `1`) → **stop** with the run `url`. Never promote an
  un-green `develop`.

### 3. Commit quality — "properly described"

- **First compute `PROMO_BASE` — do NOT lint from `origin/main`.**

  ```bash
  PROMO_BASE=$(git log --first-parent --format='%H %s' origin/develop \
    | grep -m1 'heal squash divergence' | cut -d' ' -f1)
  PROMO_BASE=${PROMO_BASE:-$(git rev-parse origin/main)}   # fallback: never healed yet
  ```

  **Why this is not `origin/main`.** Step 6 squash-merges and step 6b heals with `-s ours`. That
  combination leaves every _pre-squash_ commit permanently unreachable from `main` — the squash
  replaced them with one new commit, and `-s ours` records the ancestry without importing them. So
  `origin/main..origin/develop` never shrinks after a promotion; it **accumulates forever**. On the
  2026-08-07 promotion it was **2448 commits** covering months of already-shipped history, against a
  real delta of 35. Linting that range re-judges commits production has been running since long
  before the current commitlint config existed, so it fails on history nobody can now fix — which is
  what has blocked promotions before. The last heal commit is the true "everything before this is in
  production" watermark.

  Caveat worth knowing: a commit that lands on `develop` after the PR merges but before the heal
  falls just outside this window. That is a narrow race and it under-reports rather than blocking;
  the PR's own `commitlint` job is the backstop.

- Run `pnpm exec commitlint --from "$PROMO_BASE" --to origin/develop --verbose`. (Merge commits are
  ignored by config, so `finish-task.sh` merge commits in the range are fine.) Any failure → **list
  the offending commit(s) + the rule each broke and stop** — the PR's `commitlint` job would fail
  anyway, so catch it here.
- **Use `PROMO_BASE` for the delta everywhere else too** — the commit count and the PR body come from
  `$PROMO_BASE..origin/develop`, not `origin/main..origin/develop`, for the same reason. Report the
  raw `origin/main..origin/develop` count only if you explain it, never as "what is shipping".
- **Compose the promotion PR text** from the delta's Conventional-Commit subjects:
  - **Title:** `Promote develop → main: <themes>` — a short, comma-joined summary of the dominant
    features/areas (mirror the `#17/#18/#19` style).
  - **Body:** group the delta by type (`feat`, `fix`, `perf`, `refactor`, `docs`, …) under short
    headers, one readable bullet per change (paraphrase subjects into plain English; do not just dump
    raw `type(scope): …` lines). End with the commit count.

**If `--dry-run`:** print the composed title + body and the delta, note the branch-hygiene findings,
and **stop here** ("dry run — no PR opened, `main` untouched").

### 4. Open the promotion PR (autonomous — reversible)

- Reuse an existing open PR if present:
  `gh pr list --base main --head develop --state open --json number,url`. Otherwise
  `gh pr create --base main --head develop --title "<composed>" --body "<composed>"`.
- Watch its checks: run `scripts/watch-ci.sh pr <number>` as one background task (covers `verify`,
  `commitlint`, `changelog`). Exit `1` (it prints the failing check) → **stop** with the PR `url`
  and the failing check.
- Also confirm the PR is mergeable (`gh pr view <number> --json mergeable,mergeStateStatus`). Not
  mergeable (conflict / behind) → **stop** with the link.
- **Re-read the head before the gate — `develop` moves.** Other sessions merge while CI runs, and the
  PR silently tracks the branch: whatever `develop` points at when you merge is what ships, not what
  you composed the body from. Re-run `git fetch origin develop` and compare
  `gh pr view <n> --json headRefOid` to the SHA you described. If it moved, **recompose the body and
  `gh pr edit <n> --body-file …` before presenting the gate**, so the summary the user approves is the
  set of changes that actually deploys. On 2026-08-07 this drifted from 27 commits to 35 — an entire
  MCP feature shipped un-described, and a `cancelled` CI run (GitHub's concurrency group killing the
  superseded run) was the only hint. A `cancelled` conclusion means "a newer commit arrived", not
  "CI failed": re-fetch and watch the new run rather than stopping.

### 5. GATE — confirm the merge

Present a compact summary: the delta (count + grouped bullets), green evidence (develop CI, PR
checks), and the PR link. Then ask for **explicit confirmation** via `AskUserQuestion`:

> "Merge develop → main now? This merges to `main` and **deploys production via Vercel**."

Options: **Merge & deploy** / **Cancel (leave PR open)**. Only an explicit "merge" proceeds; anything
else stops cleanly (the PR stays open for later) and the report notes it as `⛔ Stopped: cancelled at
gate`.

### 6. Merge (the irreversible step)

- `gh pr merge <number> --squash`. **This repo disallows merge commits** (`allow_merge_commit:
false` — squash/rebase only), so `--merge` is rejected outright; squash is the only PR-merge mode.
  Do **not** delete `develop` (`--delete-branch` must not be passed — `develop` is long-lived).
- Capture the new `main` HEAD: `git fetch origin main && git rev-parse origin/main`.

### 6b. Heal the squash divergence (required — keeps the NEXT promotion clean)

A squash collapses `develop`'s delta into **one new commit on `main` that is not in `develop`'s
history**, so git can no longer see that `main ⊆ develop`. Left unhealed, the next `develop → main`
PR 3-way-merges from a stale base and flags every moved file as a conflict → `CONFLICTING` (this is
gotcha-32; it bit PR #21/#22). Heal it immediately by back-merging `main` into `develop` with the
**`ours` strategy** — records `origin/main` as an ancestor of `develop` **without changing
`develop`'s tree at all**:

```bash
git fetch origin main develop
# on the main checkout, parked on develop:
git merge -s ours origin/main -m "Merge origin/main into develop: heal squash divergence (gotcha-32)"
git push origin develop
```

`-s ours` (merge **strategy** ours, not `-X ours`) guarantees the resulting tree is byte-identical
to `develop`'s tip — the commit exists only to make `origin/main` an ancestor. **The message MUST
start with `Merge `** — commitlint's `defaultIgnores` skips merge commits, so any other prefix is
rejected by the husky `commit-msg` hook (a `Back-merge …` subject fails). After this,
`origin/main..origin/develop` is clean again and the next promotion PR is mergeable. (If a future
promotion ever still shows `CONFLICTING`, this heal was skipped — re-run it.)

> **Pre-merge heal caveat:** if the _previous_ promotion was a squash that was never healed,
> `develop`/`main` are **already** diverged and the PR opened in step 4 will show `CONFLICTING`
> before you can merge. Run this same `-s ours` back-merge **then** (before step 6), push, let the
> PR re-check, and it becomes mergeable. From then on, doing 6b every time prevents recurrence.

### 7. Watch production

- **GitHub Actions on `main`:** run `scripts/watch-ci.sh branch main` as one background task — it
  finds the newest run for the branch itself (with a grace period if the run hasn't been created
  yet) and follows it to completion. Record pass/fail + the `url` it prints.
- **Vercel production deploy:** the deploy reports as a _commit status_, not an Actions run, so
  `watch-ci.sh` doesn't cover it. Poll it as **one** bounded background Bash task (a plain
  `while … sleep 15 …` loop capped at ~10 min — no `timeout(1)`, and never a second poller for the
  same SHA):

  ```bash
  gh api repos/Synapsekw/Monilith/commits/<sha>/status \
    --jq '.statuses[] | select(.context=="Vercel") | {state, target_url}'
  ```

  Loop until `state` is `success` or `failure` (or timeout). Record `state` + `target_url` (the
  inspect link). `failure` → report it honestly; do not claim a successful deploy.

### 8. Report

Emit the formatted report (below) summarising what shipped, every check, the deploy, and any
branch-hygiene notes.

### 9. Offer data sync

_Fires **only** when the promotion fully succeeded: `main` merged, main CI green, and Vercel
production deploy confirmed (`state == success`). Skip this step entirely if the promotion stopped
at any point or the Vercel deploy was not confirmed._

Ask via `AskUserQuestion`:

> "Production code is live. Sync dev data → prod now? (runs `/sync-prod`)"

Options: **Run `/sync-prod`** / **Not now**. On accept, invoke the `/sync-prod` flow. On decline,
finish normally.

## Report format

Success:

```
## 🚀 Promotion report — develop → main
**Result:** ✅ Shipped to production

### What shipped (N commits)
- feat — <plain-English change>
- fix — <plain-English change>
- …

### Checks
- ✅ develop CI (verify) — passed
- ✅ Promotion PR #<n> — verify · commitlint · changelog green
- ✅ main CI (verify) — passed

### Production deploy (Vercel)
- ✅ Live — <prod-url>   ·   Inspect: <target_url>

### Notes
- 🧹 Stale branch `task/<old>` — consider deleting (this command does not delete it)
```

Stop (any hard stop above):

```
## 🚀 Promotion report — develop → main
**Result:** ⛔ Stopped: <one-line reason>

<the one piece of evidence/link the user needs to act>
- e.g. failing run url, offending commits, conflict notice, or "dry run — nothing changed"
```

## Discipline

- **Read-only until step 4; no merge until step 5 confirms.** Steps 1–3 mutate nothing. Step 4 only
  opens/reuses a PR (reversible). The `main` merge happens **only** after the explicit gate.
- **Stage/commit nothing — except the step-6b heal.** This command operates via `gh`/`git` on
  branches and the PR; it stages no files and creates no source commits. The **one** exception is the
  post-merge back-merge in step 6b (`merge -s ours origin/main` + push), which records a no-op heal
  commit on `develop` — that is intentional and required, not a content change.
- **Honest reporting.** Never report success while a check or deploy is red or still running past the
  timeout. Surface the link and the real state.
- **Bounded waits, one watcher per target.** Every watch/poll has a ceiling; on timeout, hand back
  the link instead of hanging. CI waits go through `scripts/watch-ci.sh` (exit `2` = timed out) —
  one background task per wait, never a duplicate watcher.
- **Report, don't clean.** Stale `task/*` branches and other hygiene findings are noted, never
  auto-deleted (that is the user's call / `finish-task.sh`'s job).
- **`/promote` never writes prod data; it only offers to chain `/sync-prod` after a confirmed
  successful deploy.**

## Edge cases

- **Nothing to promote** (`main == develop`) — friendly stop at step 1.
- **`develop` ahead locally** (unpushed commits) — stop; tell the user to push / `finish-task.sh`
  first.
- **PR already open** — reuse it (don't open a duplicate).
- **Offline / `gh` down** — stop early at step 1 with a clear message.
- **CI still pending after the bounded wait** — report "still running after N min — <url>", do not
  merge / do not claim done.
- **Invoked from a worktree** — surface it and stop (precondition).
- **Dirty working tree** — report as a note (ignoring `.obsidian/*`), never a stop; it does not
  affect what gets promoted.
