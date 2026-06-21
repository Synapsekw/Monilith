---
type: adr
status: accepted
date: 2026-06-20
tags: [adr, gotcha, rls, security, boards, sharing]
related: []
---

# Gotcha 26 — Per-board privacy means EVERY board-scoped table, not just the core 5

## Context

Board-level sharing (spec `2026-06-20-board-level-sharing-design.md`) makes boards
private-by-default with Viewer/Editor grants. The intuitive change is "rewrite the SELECT
policy on `boards`/`groups`/`items`/`columns`/`cell_values` from `is_org_member(org_id)` to
`can_read_board(board_id)`." The first draft of the spec scoped exactly those 5 tables.

## The trap

A board's content is spread across **~15 tables that each carry `board_id`**, every one
currently gated by `is_org_member(org_id)`:

`boards`, `groups`, `items`, `columns`, `cell_values`, `board_views`, `item_dependencies`,
`item_updates`, `item_activities`, `attachments`, `time_entries`, `automations`,
`automation_date_fires`, `automation_runs`, `automation_webhook_deliveries`.

Because each is queryable **directly by `board_id`**, locking only the core 5 still lets a
non-shared org member read a "private" board's comments, attachments, time entries, activity
feed, and automation history. Partial coverage = a real privacy leak that silently violates
both user intent and the "RLS is the security boundary" invariant.

Second half of the trap: **`SECURITY DEFINER` write RPCs bypass RLS.** A Viewer is still an
`is_org_member`, so RPCs that only check `is_org_member` (`create_item`, `create_board_view`,
`delete_board_view`, `create_item_dependency`, `delete_column_option`, `start_timer`) let a
Viewer write even after the table policies are tightened. The table-level `can_edit_board`
rule never runs for them.

## Decision / rule

For per-board visibility, the unit of work is **the whole board-scoped table set + every
user-callable write RPC**, not the core grid:

1. Rewrite **SELECT → `can_read_board(board_id)`** on all board-scoped tables. Tables without
   a `board_id` column (`automation_date_fires`, `automation_webhook_deliveries`) scope via
   the automation's board: `can_read_board((select board_id from automations where id = automation_id))`.
2. Rewrite **writes → `is_org_member(org_id) AND can_edit_board(board_id)`** (keep existing
   `*_in_org()` parent-consistency + author/uploader self-checks; drop `has_org_role` branches
   so private stays private from admins).
3. Add a **`can_edit_board` guard inside every user-callable write RPC**, after its existing
   `is_org_member` check.
4. **Any NEW board-scoped table or write RPC added later MUST use `can_read_board` /
   `can_edit_board`, never `is_org_member` alone** — otherwise it reopens this leak.

Known residual (documented, follow-up): attachment **storage objects** are still org-folder
scoped (`org_id` path prefix); the DB row is private but the raw blob path isn't per-board.

## Consequences

- Positive: "private" is genuinely private; the helper pair is the single chokepoint for
  board visibility; the rewrite is highly parallelizable (one test suite per table family).
- Negative: a much larger migration than the naive 5-table version; bespoke per-table write
  policies must be reconstructed carefully.
- Open follow-ups: per-board storage-object scoping; dashboards still org-scoped.

## Related

- Spec `docs/superpowers/specs/2026-06-20-board-level-sharing-design.md` §6a/§6b
- Plan `docs/superpowers/plans/2026-06-20-board-level-sharing.md`
- [[2026-06-20-2024-board-sharing-spec-plan]]
