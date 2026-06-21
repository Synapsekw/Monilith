# /promote — promote-and-watch `develop → main`

Ship work that is **already integrated on `develop`** to production: validate the delta, open the
`develop → main` promotion PR, **stop for explicit confirmation**, then merge and watch GitHub
Actions CI + the Vercel production deploy — ending in a formatted, bulleted report.

This is the **promote** counterpart to `finish-task.sh` (which merges `task/* → develop`). It does
**not** merge task branches and does **not** build features. Merging to `main` is the **only** thing
that deploys production on Vercel, so the merge is gated behind an explicit confirmation.

Design spec: `docs/superpowers/specs/2026-06-21-promote-command-design.md`.

## Arguments

- `--dry-run` (in `$ARGUMENTS`): run steps 1–4 **read-only** and stop **before opening the PR** —
  print the composed PR title/body instead. Never mutates `main`. Safe to run anytime.

## Precondition — run from the main checkout on `develop`

Run from the **main checkout** (`/Users/danijeljovanovic/Dev/Monolith`, parked on `develop`). If
invoked from inside a `task/*` worktree, or on a dirty / un-pushed `develop`, **surface that in the
report and stop** rather than guessing — do not promote from an ambiguous state.

Repo slug is **`Synapsekw/Monilith`** (that spelling is the real remote). `gh` is authed as
`Synapsekw`.

## Steps to follow

Create a TodoWrite item per step and work them in order. **Stop conditions are hard** — on any stop,
emit the report in its `⛔ Stopped` form (see Report) with the relevant link and **no false success
claim**. All CI/deploy watches are **bounded** — on timeout, report "still running after N min, here
is the link" rather than blocking.

### 1. Preflight (read-only)

- Verify `gh auth status` succeeds and the network is reachable. If not → **stop** ("`gh`
  unauthenticated / offline").
- `git fetch origin develop main`.
- Compute the delta: `git log --oneline origin/main..origin/develop`. **Empty → friendly stop**
  ("`main` is already up to date with `develop` — nothing to promote.").
- Collect **branch-hygiene notes** (reported, never auto-fixed): stale local `task/*` branches
  (`git branch --list 'task/*'`) and any local `develop` commits not pushed
  (`git log --oneline origin/develop..develop`). If local `develop` is ahead of `origin/develop`,
  **stop** and tell the user to push or run `finish-task.sh` first — promotion ships only what is on
  the remote.

### 2. Validate `develop` is green

- Resolve the SHA: `git rev-parse origin/develop`.
- Find its CI run:
  `gh run list --branch develop --workflow ci.yml -L 1 --json databaseId,status,conclusion,headSha,url`.
  Confirm `headSha` matches the develop SHA (if no run exists for it yet, wait briefly, then re-list).
- If `status` ≠ `completed` → `gh run watch <databaseId> --exit-status` (bounded).
- `conclusion` ≠ `success` → **stop** with the run `url`. Never promote an un-green `develop`.

### 3. Commit quality — "properly described"

- Run `pnpm exec commitlint --from origin/main --to origin/develop --verbose`. (Merge commits are
  ignored by config, so `finish-task.sh` merge commits in the range are fine.) Any failure → **list
  the offending commit(s) + the rule each broke and stop** — the PR's `commitlint` job would fail
  anyway, so catch it here.
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
- Watch its checks: `gh pr checks <number> --watch` (covers `verify`, `commitlint`, `changelog`).
  Any failure → **stop** with the PR `url` and the failing check.
- Also confirm the PR is mergeable (`gh pr view <number> --json mergeable,mergeStateStatus`). Not
  mergeable (conflict / behind) → **stop** with the link.

### 5. GATE — confirm the merge

Present a compact summary: the delta (count + grouped bullets), green evidence (develop CI, PR
checks), and the PR link. Then ask for **explicit confirmation** via `AskUserQuestion`:

> "Merge develop → main now? This merges to `main` and **deploys production via Vercel**."

Options: **Merge & deploy** / **Cancel (leave PR open)**. Only an explicit "merge" proceeds; anything
else stops cleanly (the PR stays open for later) and the report notes it as `⛔ Stopped: cancelled at
gate`.

### 6. Merge (the irreversible step)

- `gh pr merge <number> --merge` (merge commit, matching `main` history). Do **not** delete
  `develop` (`--delete-branch` must not be passed — `develop` is long-lived).
- Capture the new `main` HEAD: `git fetch origin main && git rev-parse origin/main`.

### 7. Watch production

- **GitHub Actions on `main`:** find the `verify` run for the new SHA
  (`gh run list --branch main --workflow ci.yml -L 1 --json databaseId,status,conclusion,headSha,url`),
  then `gh run watch <databaseId> --exit-status` (bounded). Record pass/fail + `url`.
- **Vercel production deploy:** poll the commit status (~every 15s, bounded ~10 min):

  ```bash
  gh api repos/Synapsekw/Monilith/commits/<sha>/status \
    --jq '.statuses[] | select(.context=="Vercel") | {state, target_url}'
  ```

  Loop until `state` is `success` or `failure` (or timeout). Record `state` + `target_url` (the
  inspect link). `failure` → report it honestly; do not claim a successful deploy.

### 8. Report

Emit the formatted report (below) summarising what shipped, every check, the deploy, and any
branch-hygiene notes.

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
- **Stage/commit nothing.** This command operates via `gh`/`git` on branches and the PR — it does not
  create local commits or stage files.
- **Honest reporting.** Never report success while a check or deploy is red or still running past the
  timeout. Surface the link and the real state.
- **Bounded waits.** Every watch/poll has a ceiling; on timeout, hand back the link instead of
  hanging.
- **Report, don't clean.** Stale `task/*` branches and other hygiene findings are noted, never
  auto-deleted (that is the user's call / `finish-task.sh`'s job).

## Edge cases

- **Nothing to promote** (`main == develop`) — friendly stop at step 1.
- **`develop` ahead locally** (unpushed commits) — stop; tell the user to push / `finish-task.sh`
  first.
- **PR already open** — reuse it (don't open a duplicate).
- **Offline / `gh` down** — stop early at step 1 with a clear message.
- **CI still pending after the bounded wait** — report "still running after N min — <url>", do not
  merge / do not claim done.
- **Invoked from a worktree or dirty `develop`** — surface it and stop (precondition).
