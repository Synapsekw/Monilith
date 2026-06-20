---
type: session
date: 2026-06-20-1619
branch: develop
trigger: wrapup
status: complete
tags: [session, phase/6, boards, time-tracking, planning]
related:
  - "[[00-north-star]]"
  - "[[2026-06-20-1210-phase6b-custom-fields-statuses]]"
---

# Phase 6c — Time Tracking: spec + implementation plan

## What changed

- Brainstormed **Phase 6c (time tracking)** to a locked design and wrote the spec
  `docs/superpowers/specs/2026-06-20-phase-6c-time-tracking-design.md` (commit `5b28d46`).
- Wrote the 12-task TDD implementation plan
  `docs/superpowers/plans/2026-06-20-phase-6c-time-tracking.md` (commit `47a5a80`), grounded in
  exact in-repo patterns gathered by three parallel Explore agents (attachments RLS, the
  `delete_column_option` SECURITY DEFINER style, `setCell`/`uploadColumnFile` optimistic patterns,
  the Files-cell special-case, and the full exhaustive-`ColumnKind`-switch inventory).
- Pushed `develop` (now `== origin/develop`). No source changes — docs only.

## Key decisions (locked in the spec)

- **Time Tracking column kind** (Monday-style), not a global per-item feature.
- Sessions live in a new **`time_entries`** side table (derived cell content, like 6b's Files
  column); the per-item **estimate** rides in the column's `cell_values` row (`{ estimateSeconds }`).
  Cell shows `tracked / estimate`.
- **One running timer per user** — partial-unique index on `(user_id) WHERE ended_at IS NULL` +
  atomic `start_timer` RPC that stops the prior running entry before inserting the new one.
- Capabilities v1: live start/stop + manual add/edit/delete, flat session list. **Deferred:**
  cross-board timesheet, grouped-by-person breakdown, per-entry notes, editing others' entries,
  live realtime (v1 = optimistic + revalidate).
- Parent rollup of subitem totals via a dedicated `rollupTimeTracking` (tracked time is in
  `time_entries`, so it can't go through the cell-value `rollupCell`).

## Open threads

- **Plan not yet executed.** Execution mode (subagent-driven vs. inline) not chosen.
- **Manual gate:** Tasks 1 & 2 apply two migrations to cloud Supabase (`db push`) — needs explicit
  per-session authorization.
- **Bound risk noted:** board-scoped `time_entries` first-paint query capped at 1000 rows
  (attachments precedent); server-side per-cell aggregate is the documented follow-up.
- Three `_draft-*.md` stubs in `vault/sessions/` belong to parallel sessions (admin/password/6b) —
  left untouched.

## Next session entry point

Execute `docs/superpowers/plans/2026-06-20-phase-6c-time-tracking.md` starting at Task 1 (enum
migration) — pause for migration authorization before `db push`. After 6c: 6d relations + mirror,
then 6e docs.
</content>
