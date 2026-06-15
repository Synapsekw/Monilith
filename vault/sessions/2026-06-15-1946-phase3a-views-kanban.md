---
type: session
date: 2026-06-15-1946
branch: feat/phase-3a-views-kanban
trigger: wrapup
status: complete
tags: [session, phase-3]
related:
  [
    "[[2026-06-15-1259-phase2b-boards-interactive]]",
    "[[2026-06-15-gotcha-06-commitlint-subject-case]]",
    "[[2026-06-15-gotcha-07-shared-worktree-subagents]]",
  ]
---

# Phase 3a — View infrastructure + Kanban (PR #15 open)

## What changed

- **Brainstormed → spec → plan → built Phase 3a** subagent-driven (10 tasks + 2 review fixes,
  each spec/quality-checked). Spec `…specs/2026-06-15-phase-3a-views-kanban-design.md`, plan
  `…plans/2026-06-15-phase-3a-views-kanban.md`. **PR #15** open against `main` (16 commits).
- **`board_views`** table + org-scoped RLS + `create_board_view` / `delete_board_view` RPCs;
  `create_board` seeds a default Table view, existing boards backfilled. Two migrations applied
  (`…155909_board_views`, `…163816_delete_board_view_rpc`); types regenerated.
- **View switcher** (`ViewSwitcher` + shared `BoardHeader`) with `?view=<id>` routing (Table
  fallback via `resolveSelectedView`); add/rename/delete. Last-view delete blocked transactionally
  (`FOR UPDATE`) so a board can't reach zero views.
- **Kanban** (`KanbanBoard` + pure `buildKanbanColumns`/`onCardDropped`): group by a Status column,
  "No status" bucket, dnd-kit drag-to-restatus through the existing `setCell` mutation, per-column
  "+ Add" that sets the column's status, grouping-column picker persisting `config.group_column_id`.
- Gate green: typecheck, lint (0 errors), **155** vitest tests, build, Kanban e2e.

## Why

Phase 3 (Views) makes a board more than a table — the switcher + saved-view infrastructure is the
foundation every later view (Calendar, Timeline/Gantt in 3b) reuses. Kanban is the first payoff and
proves the multi-view model on top of 2b's cache/realtime layer.

## Open threads

- **PR #15 pending** CI + review/merge. Branched off `main` before `fix/status-cell-popover` merged,
  so the working tree still carries that PR's uncommitted popover files (left untouched); rebase
  onto updated `main` after the popover PR lands.
- Deferred (tracked in PR): `to authenticated` + explicit grants on `board_views` policies for
  convention parity (works via Supabase defaults); a real pointer-drag integration test; keyboard-drag
  a11y on Kanban cards (Table is the accessible fallback).
- **3b**: Calendar + Timeline/Gantt + item dependencies.

## Next session entry point

Merge PR #15 (rebase if popover PR landed first), then start **Phase 3b** — Calendar + Timeline/Gantt
with dependencies — reusing the `board_views` switcher + the board cache/realtime layer.
