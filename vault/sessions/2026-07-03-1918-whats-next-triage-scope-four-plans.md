---
type: session
date: 2026-07-03-1918
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-03-1512-mvp-final-batch-b-promote]]"
---

# /whats-next triage → four scoped plans pushed for review

## What changed

- Ran `/whats-next` from the main checkout: read north-star §2/§3 + 8 recent sessions,
  reconciled against git (`develop == origin/develop` at `9d618c3`), dispatched Explore scouts.
  Key finding: **Phase 7 is fully built** (7a/7b/7c/time-allocation all shipped) — nothing left there.
- Dispatched **Batch A** as four scoping worktrees (brainstorm → plan, stop at "awaiting review",
  no builds): `perf-tier3`, `rename-board-shared-tag`, `widget-preview-live`, `pwa-shell`.
- All four plans written **and committed + pushed** on their `task/*` branches (docs-only), so the
  work survives a machine switch. No source built, no merges, no deploys.
- Excluded `importSpreadsheetAsBoard` boardsTag fix from the batch — it **collides** with the live
  `task/import-wizard-v2` worktree (both rewrite `src/lib/boards/spreadsheet-actions.ts`); fold it
  into that branch's Task 6 instead.

## Why

MVP-F is 9/9 in prod and Phase 7 is done, so "what's next" is carryover cleanup + deferred depth,
not a big unfinished feature. Scoping four independent items to reviewed plans (without full-sending
builds) is the senior-lead move: review specs, then greenlight. Pushing the branches lets the user
continue on another computer.

## How to test (for the user)

No user-facing behavior to test — this session only produced written plans (no source changed).
To review on the other machine: `git fetch origin`, then read each plan on its branch, e.g.
`git show task/pwa-shell:docs/superpowers/plans/2026-07-03-pwa-installable-shell.md` (or check out
the branch / re-create the worktree with `scripts/start-task.sh`).

## Open threads

- **Four plans awaiting review** on pushed branches: `task/perf-tier3` (6 items, internal DAG:
  5 parallel + bundle-analyzer after avatars), `task/rename-board-shared-tag` (S, single-node),
  `task/widget-preview-live` (M, single-node), `task/pwa-shell` (S, no service worker needed).
  Greenlight → each becomes a build session; `perf-tier3` itself fans into ~5 sub-worktrees.
- **Standing product call:** Phase 10 vs revive 6e Docs vs **declare v1 feature-complete** (my read:
  v1-complete; #9 Workload-v3 and #10 phone-reflow are the only remaining polish).
- **Blocked-on-user ops (unchanged):** prod Batch B migrations (`…110000/120000/121000`), optional
  email leg (Resend/Vercel env/Vault secrets), migration-ledger repair on both projects.
- Local worktrees for the four task branches remain under `.claude/worktrees/`; the plans are pushed,
  so they can be re-created anywhere via `start-task.sh`. Foreign `task/import-wizard-v2` still live.

## Next session entry point

On the other machine: `git fetch`, review the four pushed plans (cheapest wins first:
`rename-board-shared-tag` then `pwa-shell`), then either greenlight builds as a parallel batch or
make the v1-feature-complete call before scoping more.
