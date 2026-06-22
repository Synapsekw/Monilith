---
type: session
date: 2026-06-22-1255
branch: develop
trigger: wrapup
status: complete
tags: [session, worktrees, tooling, finish-task, rebase]
related:
  [
    "[[2026-06-21-gotcha-31-worktree-needs-real-install]]",
    "[[2026-06-22-1241-worktree-install-gate-fix]]",
  ]
---

# Self-integrating finish-task.sh — auto-rebase onto develop, then re-gate

## What changed

- `scripts/finish-task.sh`: reordered to **integrate before gating** — fetch + rebase
  `task/<name>` onto the latest `develop`, run `typecheck/lint/test/build` against the **merged**
  state, then `merge --no-ff` + push (one retry if origin moved). Replaced `pull --ff-only` with
  `pull --rebase` + `rebase.autoStash` (covers the dirty `.obsidian/*` tree). Real rebase conflict →
  `rebase --abort` + non-zero exit with recovery instructions; worktree left clean.
- `AGENTS.md`: working-agreement #1 now states `finish-task.sh` auto-integrates; agents don't
  hand-rebase.
- Spec `docs/superpowers/specs/2026-06-22-self-integrating-finish-task-design.md`.
- Marked the gotcha-31 "bonus trap" (finish-task vs a diverged main checkout) **resolved**.
- Commit `4c847de` (pushed; `develop == origin/develop`).

## Why

While a session works in its worktree, `develop` moves (other sessions merge — one literally did
mid-session; the main checkout also gains doc/vault commits). The old script gated the task tip in
isolation (so the merged result could go red) and `pull --ff-only` aborted on a diverged main
checkout, forcing agents to notice and hand-rebase. Now one command does the right thing.

## How to test (for the user)

No user-facing behavior to test — internal dev tooling. Verified via `/tmp` git fixtures with a local
bare origin + stubbed `pnpm`: develop-advanced (clean rebase+merge+push), diverged-local-develop
(`pull --rebase` replays the local commit), and rebase-conflict (aborts cleanly, worktree untouched,
non-zero exit). Real-world: the next `finish-task.sh` run will fetch + rebase + re-gate automatically.

## Open threads

- Conflict recovery is still manual by design (script aborts and instructs); fine for now.
- `pnpm install` in a fresh worktree emits an `esbuild`/`approve-builds` notice — cosmetic
  (carried over from the start-task fix earlier today).

## Next session entry point

Worktree tooling (start + finish) is now robust end-to-end. Resume product work — e.g. Phase 7c
Workload/capacity (unspec'd), the next Asana-polish slice.
