---
type: session
date: 2026-06-29-1744
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-29-1235-touch-batch-2-parallel-ship]]"
  - "[[2026-06-23-gotcha-43-shared-db-integration-test-flake]]"
---

# Promotion #41, prod data sync + fixture purge, Gantt/Calendar touch

## What changed

- **Promoted #41 → production** (`bf01836`): TOUCH Batch 2 first four surfaces + the `finish-task` changelog guard. Main CI green + Vercel prod deploy confirmed; squash divergence healed (`f75fe32`).
- **`finish-task.sh` changelog guard** (`725dfe0`): now runs `pnpm changelog:gen` after rebase and commits any drift before gating — closes the local-gate-vs-CI gap that needed a manual regen (`45a2bbe`). Verified working on the Calendar merge.
- **`/sync-prod`**: dev → prod full replace, parity verified; prod backed up first.
- **Test-fixture purge on BOTH dev + prod**: deleted 199 test orgs (cascade) + 4 `admin_audit_log` rows + 220 `@example.com` users on each, guarded by a 10/10 count check (auto-rollback). Both DBs now identical at 10 orgs / 8 boards / 154 items / 10 users / 9 storage — the 10 real accounts only.
- **Migration ledger reconciled**: repaired `20260625120000` + `20260623000000` (both `--status applied`).
- **TOUCH Batch 2 Gantt + Calendar shipped** (`7aab0c1`, `f5e6423`): last two drag surfaces migrated to `useTouchAwareSensors()` + `pointer-coarse:` 44px targets. Every `TODO(touch-batch-2)` marker now cleared. Batch 2 = 6/8 surfaces.

## Why

Continuation of [[2026-06-29-1235-touch-batch-2-parallel-ship]]: ship the built work to prod, mirror data, and clear the accumulated test-fixture pollution before prod has real users — plus finish the remaining drag surfaces.

## How to test (for the user)

Pull `develop`, on an iPad (or DevTools coarse-pointer):

1. **Gantt/Timeline** — long-press a bar to reschedule (swipe scrolls); drag right edge to resize; Week/Month zoom + row ⋯ menus + pickers all ≥44px.
2. **Calendar** — long-press an event to drag to another day; Prev/Next + Today + Month/Week/Agenda tabs ≥44px.
3. **Desktop** — mouse behavior byte-for-byte unchanged (all `pointer-coarse:`-gated).
4. **Prod data** — production now shows only the 10 real orgs/users (no `@example.com` fixtures).

## Open threads

- **Unpromoted on develop since #41:** Gantt (`7aab0c1`) + Calendar (`f5e6423`) — run `/promote`.
- **TOUCH Batch 2 remaining (2 light surfaces):** ⑥ Dashboard canvas (verify widget handles touch-sized) + ⑧ Command palette/menus (≥44px rows + long-press tooltip fallback).
- **Top infra priority — isolated test DB (`.env.test`):** integration suites re-pollute the remote DEV DB with `@example.com` fixtures every run, so the purge will recur (and re-sync to prod) until tests run against a dedicated test-only project. See [[2026-06-23-gotcha-43-shared-db-integration-test-flake]].

## Next session entry point

Run `/promote` to ship Gantt + Calendar, then either set up the isolated test DB (`.env.test`) to stop fixture re-pollution, or finish TOUCH Batch 2's last 2 light surfaces (Dashboard + Command palette).
