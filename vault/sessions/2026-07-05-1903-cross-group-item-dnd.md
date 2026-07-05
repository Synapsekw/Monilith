---
type: session
date: 2026-07-05-1903
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-05-1227-boards-summary-ui-polish]]"
---

# Cross-group item drag-and-drop (Table view)

## What changed

- Shipped cross-group item DnD to `develop` (merge `e517bcb`, 7 commits `274831a..0727d7b`) via subagent-driven execution in worktree `task/cross-group-dnd`: 5 planned tasks, each task-reviewed, + 2 review fixes.
- Extended the existing `moveItem` action + `moveItemSchema` and the `moveItemToGroup` cache helper with an optional exact `position` (append stays the default); added `crossGroupInsertPosition` (`src/lib/boards/board-dnd.ts`) and a single-item optimistic `moveItemToGroupMutation` with a targeted-inverse rollback (item + subitems).
- Unified `BoardTable.tsx`'s separate group-drag + per-group item-drag contexts into ONE board-level `DndContext`: type-tagged draggables, group-container droppables (incl. empty & collapsed groups → append), custom collision strategy (rows first, container fallback), drag overlay, and `onDragEnd` routing (group→reorderGroup, same-group→reorderItem, cross-group→moveItemToGroup at the drop spot).
- Spec `docs/superpowers/specs/2026-07-05-cross-group-item-dnd-design.md`, plan `docs/superpowers/plans/2026-07-05-cross-group-item-dnd.md`.
- Earlier in the session (already noted in [[2026-07-05-1227-boards-summary-ui-polish]]): add-item row moved above summary, "Board Total" rename, created columns text-only, unified summary font.

## Why

Users could only reorder items within a group; moving an item to another group required the bulk menu. The backend (`moveItem`/`moveItemToGroup`/bulk path) already existed — the gap was purely that each group had an isolated `DndContext`, so a drag could never cross a group boundary. Unifying into one context closes that with 0 new server round-trips.

## How to test (for the user)

1. Pull `develop`, open a board in **Table view** with two+ groups, each holding a few items.
2. Drag an item from group A and drop it **between two specific rows** in group B — it lands exactly there.
3. Collapse group B, drag an item onto its header/strip → expand → item is at the bottom.
4. Create a new **empty** group, drag an item into it → it moves in (review-caught gap, fixed).
5. Within-group reorder and group-header reorder still work; no page reload/flicker on drag.
   - Accepted quirks: dropping on another group's _header_ (not body) or in a _same-group gap_ is a no-op — release on a row.

## Open threads

- Two accepted Minor items need a real-browser confirmation (jsdom can't test collision _selection_ / empty-group droppability): verify steps 2–4 above before promoting `develop → main`.
- Pre-existing `FooterCell` locale date hydration mismatch (`toLocaleDateString(undefined,…)`) still open — not mine, left per user; fix = pin an explicit locale.
- Stale Stop-hook draft `vault/sessions/_draft-2026-07-05-1038.md` left in place (mixed other-session snapshot; its own work is already noted elsewhere) — safe for any session to delete.

## Next session entry point

`develop → main` promotion is pending (multiple features stacked since last promote). Before promoting, do the manual browser pass on cross-group DnD (steps 2–4 above).
