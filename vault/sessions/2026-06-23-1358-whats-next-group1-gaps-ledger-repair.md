---
type: session
date: 2026-06-23-1358
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-23-1016-phase-9-2-streaming-shell-build]]"
  - "[[migration-apply-blocked-by-classifier]]"
---

# /whats-next Group-1 gap-closers + migration-ledger reconciliation

## What changed

- **`/whats-next` triage** (main checkout): reconciled vault vs git, footprinted candidates with 4 parallel Explore agents, built the DAG. Found the Phase-9 critical path is strictly sequential — `9.2 → {9.3 ‖ 9.4} → 9.6` (9.3/9.4 hard-depend on 9.2's layout rewrite) — and **9.2 was already in flight in a parallel session**, so the launchable work was the carryover _off_ that chain.
- Per the user's call ("close the gaps before building new stuff"), dispatched **3 scope-to-plan agents** (one worktree each) → specs written + approved → **3 disjoint builds merged to `develop`**:
  - **Kanban card assignee names** (`6abaf68` → merge `db9bfb2`): thread already-loaded `members` into `KanbanCard`; cards show names not "1 person". 0 round-trips.
  - **Workload analytics v3** (merge `54b5b68`): `/workload` **Variance** metric + per-day actuals drill-down. Pure client-side, no RPC/migration.
  - **Auth hardening** (`b3a56e0` → merge `73578a6`): proxy verifies JWT locally via `getClaims()`, dropping a `/user` round-trip per request; admin re-validation closed as a no-op.
- **Migration-ledger reconciliation** (user-run — agent is classifier-blocked on prod ledger writes): marked 5 live-but-unledgered migrations `applied` (`20260622120000/130000/140000/160000/170000`), reverted 6 throwaway orphans (5×06-22 + `20260623041853`, verified byte-identical to committed `20260622170000_workload_actuals`). `db push --dry-run` → **"Remote database is up to date."**

## Why

The roadmap headline (9.2 streaming shell) was already owned by a parallel session, so the senior-lead move was to clear accumulated carryover/deferred gaps and the days-old migration-ledger drift before opening new fronts — leaving a clean `develop` to promote.

## How to test (for the user)

Pull `develop`, then `pnpm dev`:

1. **Kanban names** — open a board with a Status + People/Owner column and an assigned item → Kanban view → card summary shows assignee names (e.g. "Ada Lovelace, Grace Hopper"), matching the Table view.
2. **Workload variance** — `/workload` → **Show** toggle has a new **Variance** option (signed delta + %; red=over, muted=under, neutral within ±10%). With Actual/Both/Variance active, click a cell with logged hours → per-day drill-down popover. DevTools Network: no reload/new requests on toggle/popover.
3. **Auth** — not user-observable (internal perf). Sanity: sign in, idle past the ~1h token TTL, hit a protected route → stay logged in.

## Open threads

- **Promotion owed** — `develop` is ahead of `main` since #30 (9.2 streaming shell + Workload analytics v3 + kanban names + auth `getClaims`). User to run `/promote` next.
- **Coordination hazard** — the 9.2 session was working in the **main checkout** (left WIP + an uncommitted north-star edit there), not only its worktree. Two sessions sharing one working tree; rein in before the next parallel task.
- **9.3 cache + 9.4 skeletons** now unblocked (9.2's layout rewrite landed).

## Next session entry point

Run `/promote` to ship the `develop` bundle to production; then start the now-unblocked Phase 9.3 (cache sidebar data) / 9.4 (skeletons + `loading.tsx`).
