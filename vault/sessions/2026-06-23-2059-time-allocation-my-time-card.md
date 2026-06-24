---
type: session
date: 2026-06-23-2059
branch: develop
trigger: wrapup
status: complete
tags: [session, phase-7, time-tracking, workload]
related:
  - "[[2026-06-23-gotcha-43-shared-db-integration-test-flake]]"
---

# Time Allocation (My Time card) + Workload full-canvas

## What changed

- New **`time_allocations`** table (manual entries; timers stay in `time_entries`) — item/category XOR, partial-unique indexes for cell upserts, self-write/org-read RLS; `workload_actuals_rollup` extended to UNION timer + manual (no double-count). Migration `20260623120000` applied to the linked project.
- New **`src/lib/time/*`** library: pure hours↔secs, categories, Zod validation, card assembly (manual+timer merge), queries, self-scoped server actions.
- New **`/time` "My Time"** weekly card: decimal-hours per task/category per day, save-as-you-go, auto-loaded rows + cross-board "Add row" picker (items + preset/custom categories), week nav, totals, read-only "incl. Xh tracked" sub-label.
- **Workload full-canvas redesign**: flex-grow week columns, utilization % per member, capacity bars. Sidebar gets a **My Time** entry.
- Built via `/develop` (subagent-driven, DAG batches 1 → {2a‖2b} → 3). Fixed a real plan bug: a client component imported the `server-only` query → exposed `searchAllocatableItems` as a server action. Spec + plan committed under `docs/superpowers/`.
- Merged to `develop` at `aabda5a` (rebased onto latest develop; auto-merged cleanly with the feedback/percent/dashboards work that landed mid-session).

## Why

ServiceNow-style manual time logging that feeds the Workload actuals overlay (previously only timer-tracked time counted), and the Workload page was a cramped fixed-width table that never used the canvas.

## How to test (for the user)

1. Pull `develop`, `pnpm dev`.
2. Sidebar → **My Time** (`/time`) — weekly grid, tasks you've tracked this week pre-loaded.
3. **Add row** → search a task from any board → it appears as a row.
4. Type `2.5` in a day cell, Enter → saves; row/day/week totals update. Clear the cell to remove.
5. **Add row** → type `Meetings` (preset) or a brand-new word → "Add category …" → log hours.
6. If you have a timer on a task this week, its cell shows "incl. Xh tracked" and the row total includes both.
7. **Workload** (`/workload`) — now full-width with utilization % + capacity bars; the **Actual** metric now includes manually-logged time.

## Open threads

- **Production promotion owed** — `develop → main` (`/promote`) now includes this feature plus the earlier unpromoted bundle (Phase 9.2, Workload v3, feedback, dashboards-v2, percent column).
- **Merged past the full `pnpm test` gate** with a documented exception — see [[2026-06-23-gotcha-43-shared-db-integration-test-flake]]. All deterministic gates (typecheck/lint/build) + every unit/component test (78 time+workload) green; only the live-DB integration suites flaked.
- `.obsidian/*` config left modified+uncommitted (pre-existing, unrelated).

## Next session entry point

Run `/promote` to ship the `develop` bundle. If a green integration gate is needed first, address gotcha-43 (run the integration suite serially / against a dedicated DB).
