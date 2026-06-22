---
type: spec
date: 2026-06-22
status: approved
tags: [spec, worktrees, tooling, finish-task, rebase]
related:
  [
    "[[2026-06-21-gotcha-31-worktree-needs-real-install]]",
    "[[2026-06-22-1241-worktree-install-gate-fix]]",
  ]
---

# Self-integrating `finish-task.sh` — auto-rebase onto latest `develop`, then re-gate

## Problem

While a building session works in its own worktree on `task/<name>`, `develop` keeps moving
(other sessions merge; the main checkout itself gains direct doc/vault commits). The current
`scripts/finish-task.sh` does not account for this:

1. **Gates run before integration.** It runs `typecheck/lint/test/build` against the task branch's
   _own_ tip, then merges. If another session's just-landed code breaks the integrated state, the
   gates never saw it — develop goes red after the merge.
2. **`pull --ff-only origin develop` is brittle.** The moment the main checkout's local `develop` has
   diverged from origin (unpushed local commits _and_ origin advanced), `--ff-only` aborts and the
   finish fails. This is the gotcha-31 "bonus trap".
3. **Agents hand-reason about rebasing.** Today an agent manually notices "develop moved, I need to
   rebase" and does it by hand — error-prone and inconsistent (the symptom that motivated this).

## Goal

`finish-task.sh` integrates the latest `develop` itself, re-gates against the integrated state, then
merges — so an agent runs one command and never reasons about rebasing. Stop only on a real conflict.

## Design

New step order (was: preflight → gate → merge → cleanup):

### 1. Preflight (unchanged)

On a `task/*` branch; worktree tree clean (commit first otherwise).

### 2. Refresh the integration target (in the MAIN checkout)

```bash
git -C "$MAIN" fetch origin develop
git -C "$MAIN" checkout develop
git -C "$MAIN" -c rebase.autoStash=true pull --rebase origin develop
```

- `pull --rebase` collapses all three cases into one command: local **behind** → fast-forward;
  local **ahead** (legit unpushed vault/doc commits) → no-op; local **diverged** → replays the local
  unpushed commits on top of `origin/develop`.
- `-c rebase.autoStash=true` protects the persistently-dirty `.obsidian/*` files in the main checkout
  (a plain rebase refuses on an unstaged tree); the stash is restored automatically afterward.
- If this `pull --rebase` itself hits a conflict (diverged local develop with real overlap), abort
  and stop with a message — that is a pre-existing main-checkout problem the user must resolve.

### 3. Rebase the task branch onto the fresh `develop` (in the worktree)

```bash
git rebase develop
```

- No-op when `develop` didn't move.
- **Conflict → `git rebase --abort`, then exit non-zero** with a clear message naming the conflicted
  files and the manual recovery (`git rebase develop`, resolve, re-run `finish-task.sh`). Never leave
  a half-rebased worktree.

### 4. Gates — against the integrated state

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Unchanged commands, but now they run _after_ integration, so they catch breakage introduced by other
sessions' merged code before it reaches `develop`.

### 5. Merge + push, with one retry

```bash
git -C "$MAIN" merge --no-ff "$BRANCH" -m "Merge $BRANCH into develop"
git -C "$MAIN" push origin develop
```

The task branch is already rebased onto `develop`, so `--no-ff` is conflict-free and keeps the
merge-commit convention. If `push` is rejected because origin advanced again in the gap, run
`git -C "$MAIN" -c rebase.autoStash=true pull --rebase origin develop` and push once more; if it
still fails, stop and report.

### 6. Cleanup (unchanged)

`git worktree remove "$WT"` + `git branch -d "$BRANCH"`, then the closing "How to test" reminder.

## Decisions

- **Rebase (not merge) to pull `develop` into the task branch** — short-lived task branches, linear
  history, no merge-bubble noise on every finish.
- **Abort-and-stop on conflict** rather than dropping into an interactive rebase mid-script — the
  worktree is left clean and the agent/user resolves deliberately.
- **`pull --rebase` (not `--ff-only`)** as the develop-refresh primitive, fixing the gotcha-31 bonus
  trap; `autoStash` covers the dirty `.obsidian/*` tree.

## Out of scope

- Teaching `finish-task.sh` to detect _another session's_ in-flight unpushed work and refuse — the
  one-retry push handles the race; cross-session coordination stays the human's call.
- A separate `sync-task.sh` — integration is folded into `finish-task.sh`, one command.

## Testing

Shell tooling, so verification is by exercised scenarios rather than a unit suite:

1. **develop unchanged** — finish runs end-to-end, task rebase is a no-op (the common case).
2. **develop advanced (no overlap)** — create a commit on develop touching a different file, finish a
   task; confirm the task auto-rebases, gates run, merge + push succeed.
3. **diverged local develop** — leave an unpushed local develop commit + simulate an origin commit;
   confirm `pull --rebase` replays cleanly and finish completes.
4. **rebase conflict** — overlap the task and a develop commit on the same lines; confirm the script
   aborts the rebase, leaves the worktree clean, and exits non-zero with recovery instructions.

Scenarios 1–2 are exercised live on a throwaway task; 3–4 are validated with a scripted local
fixture (temp commits, reset afterward) so we don't pollute real `develop`.
