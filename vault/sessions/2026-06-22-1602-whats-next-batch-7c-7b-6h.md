---
type: session
date: 2026-06-22-1602
branch: develop
trigger: wrapup
status: complete
tags: [session, phase-7, phase-6, orchestration, parallel-build]
related:
  - "[[2026-06-22-1344-whats-next-triage-drift-heal]]"
  - "[[2026-06-22-gotcha-37-parallel-worktree-integration-tests-flake-on-shared-supabase]]"
  - "[[2026-06-22-gotcha-39-stale-worktree-deps-after-sibling-dependency-add]]"
---

# /whats-next batch: 7c Workload + 7b done-mapping + 6h item-panel presence

## What changed

- Ran a `/whats-next` triage from the main checkout → recommended + dispatched a 3-task parallel
  batch (disjoint footprints), each scope-to-plan then build, all merged to `develop`.
- **7c Workload/capacity** (`d95678d`): new `/workload` grid; migration `20260622160000_workload`
  (`member_capacity` + `org_workload_settings` tables + `workload_rollup` RPC, applied live, types
  regenerated). Per-member load-vs-capacity over a 12-week horizon; sort via History API; v1 ships
  sort-only (workspace/board filter deferred).
- **7b done-mapping UI** (`7a8a9e3`): shared `DoneMappingFields` picker; goal drawer's
  contributing-boards list is now expandable to pick exactly which status options count as "done"
  (was name-guess). UI-only — no schema (data layer already carried `doneOptionIds`).
- **6h item-panel presence** (`42b3647`): "Also viewing" avatar stack in the item-panel header via
  the existing private presence channel; shared `PresenceAvatarStack` primitive. No migration.
- Extended [[2026-06-22-gotcha-37-parallel-worktree-integration-tests-flake-on-shared-supabase]]
  (cross-run teardown-purge mode + hand-merge fallback) and filed
  [[2026-06-22-gotcha-39-stale-worktree-deps-after-sibling-dependency-add]].

## Why

These were the live carryover/roadmap candidates from the prior triage. Building them concurrently
(3 worktrees) exercised the parallel-session workflow at scale and surfaced two real
infra traps that now have ADRs.

## How to test (for the user)

Pull `develop`, run `pnpm install` (new `react-day-picker` dep arrived via a sibling session), then
`pnpm dev`.

1. **7c Workload:** sidebar → **Workload**. Grid of members × 6 weeks with `effort/capacity` cells
   colored by load (+ Unassigned row). Populate by adding a Date column + dating an item this week,
   assigning yourself via a People column, optional time estimate. Click **Sort → Total load** (URL
   `?sort=load`, reorders with no reload). Open the per-row **capacity editor** → set hours/day +
   working days → Save → row recolors. Admins get a **Defaults** dialog. Other org sees nothing.
2. **7b done-mapping:** `/goals` → open/create a goal in **auto-boards** mode, link a board →
   **expand** that board in the drawer → toggle which status options count as "done" → progress
   recomputes off your choice (not name-matching).
3. **6h presence:** two same-board members in two windows → both open the **same** item panel
   (`?item=`) → each header shows "Also viewing" + the _other_ user's avatar (never self); caps at 3
   faces + `+k`; closing clears it; persists across view switches.

## Open threads

- **6h hand-merged** (typecheck/lint/build green, unit 992/992) — full integration gate not re-run
  clean due to the cross-session cloud race (gotcha-37); none of the failing files touch 6h's code.
- **7c follow-ups:** workspace/board filtering (deferred to v2 — needs board/workspace threaded onto
  `MemberRow`); `time_entries` actuals overlay (deferred, v1 buckets estimates).
- **7b follow-up:** none material; single-open accordion + inline-expand (Approach A) shipped.
- Other live sessions in flight: `task/auth-getclaims`, `task/sidebar-item-menu`.

## Next session entry point

`develop == origin/develop` at `42b3647`, clean. Promotion to `main` pending (user will run
`/promote` separately). Roadmap Next after that: **Phase 7c v2 filtering** or **Phase 9 hardening**
(landing-ttfb already merged one slice).
