# Per-group column headers (Monday-style) — design

**Date:** 2026-06-22
**Status:** Approved
**Branch:** `task/group-column-headers`

## Problem

When a user adds a new group to a board, the new group appears to have **no columns**.
Reported as "the columns from the first group don't propagate to new groups." The symptom
**only** shows on boards created **from scratch** ("Blank board"), not from a populated template.

## Root cause (verified)

Columns are **board-scoped**, not group-scoped (`public.columns.board_id`; there is no
`group_id`). Both creation paths seed columns:

- The "from scratch" UI (`NewBoardDialog`) actually runs the **Blank board template** through
  `create_board_from_template`, which inserts the 3 default columns (Status / Owner / Date).
- Real templates (Sales CRM, etc.) do the same **and ship items in every group**.

So nothing is missing in the data — confirmed against the live board "e& Tasks" (3 columns, 3
groups). The bug is purely in the **table-view render layer** (`src/components/boards/BoardTable.tsx`):

- The column header row is rendered **once, globally**, at the top of the table
  (`BoardTable.tsx:576–618`).
- Each `GroupSection` renders only a group-name band + item rows, and renders cells **only when the
  group has items** (`items.length > 0`, `BoardTable.tsx:1200`). Cells are the only thing that
  visually expresses the columns inside a group.

Therefore an **empty group shows just its name band + an "Add item" row — no visible columns**.
Template boards mask this because every group ships with items; a from-scratch board's initial
"Group 1" and every group added afterward are empty, exposing it.

## Decision

Full **Monday-style** layout (user-selected): **remove the single global column header** and give
**every group its own interactive column-header row**. No DB/schema/RPC change — columns are already
board-scoped and shared; this is a render-layer change only. KanbanBoard and other views are
untouched.

## Design

### Structural change (`BoardTable.tsx`)

- **Remove** the global column-header grid row (`BoardTable.tsx:576–618`): the `NameColumnHeader` +
  `columns.map(ColumnHeader)` + `AddColumnMenu` block. `BoardHeader` (board name / view switcher)
  stays.
- Each `GroupSection` gains a **`GroupHeaderRow`** as its top row — a CSS grid using the shared
  `template` (`gridTemplate(columns, liveWidths, nameWidth)` = `[frozen Name][per-column tracks][+ slot]`),
  structurally mirroring `SummaryFooter` (`BoardTable.tsx:280–339`):
  - **Frozen Name cell** (`sticky left-0`, `NAME_FREEZE_EDGE`, `width: nameWidth`, colored left rail
    from `group.color`): the existing group controls — drag handle, collapse chevron, color dot,
    name / rename, item count, `GroupMenu` — **plus** a name-column resize/auto-fit handle on its
    right edge (preserves today's `NameColumnHeader` behavior).
  - **Per-column cells:** reuse the existing `ColumnHeader` component (rename / resize / delete /
    edit-options), one per column, in every group.
  - **Trailing `+` cell:** the existing `AddColumnMenu` (including the relation/mirror dialog
    branches).
- **Collapse** toggles only the item body + Add-item row. **The header row stays visible when
  collapsed**, so columns and management are always reachable in every group.

### Shared state (stays in `BoardTable`, threaded down)

Column width / name-width / options-popover / relation+mirror dialog state and the column mutations
remain owned by `BoardTable` and are passed to every `GroupSection` via a single bundled
**`ColumnHeaderControls`** object (mirroring the existing `CellControls` pattern), containing:

- `liveWidths`, `setLiveWidths`, `liveNameWidth setters` (live resize state — **shared**)
- `renameColumn`, `deleteColumn`, `resizeColumn`, `resizeNameColumn`
- `onAddColumn(kind)` (the existing relation/mirror-aware add handler)
- `setOptionsFor` (opens the column-options popover, which stays rendered in `BoardTable`)
- `nameWidth`

Because width state is shared, resizing a column from **any** group live-updates the shared
`template`, so all groups + the footer reflow together. Rename / delete / add / options are
board-level mutations that already propagate through the board cache to every group.

### Component boundaries

- `GroupHeaderRow` — pure presentational row: given `group`, `columns`, `template`, group-control
  callbacks, and `ColumnHeaderControls`, renders the frozen group cell + per-column `ColumnHeader`s
  + `AddColumnMenu`. Testable in isolation.
- `GroupSection` — composes `GroupHeaderRow` + (when not collapsed) the virtualized item rows +
  `AddItemRow`.
- `BoardTable` — owns shared state + dialogs + footer; renders `groups.map(GroupSection)`; no longer
  renders a global header.

## Out of scope (unchanged)

- `SummaryFooter` stays a single board-level bottom row (no per-group footers).
- No sticky-on-vertical-scroll group headers.
- No Kanban / other-view changes.
- No DB / schema / RPC / `queries.ts` changes.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint:** unchanged — same `getBoardPayload`; no new queries.
- **Every interaction:** **0 new server round-trips.** Resize / rename / add / edit-options use the
  existing Server Actions + optimistic cache exactly as today; the only change is *where* the header
  renders. Width changes are client state (no RSC re-run).
- More DOM (headers × groups), but groups are not virtualized and are few per board; per-column
  header is a light component. Acceptable.

## Testing (Vitest + RTL, written first — TDD)

1. **Core bug:** a board with an **empty** group renders that group's column-header row showing all
   board columns (Status / Owner / Date).
2. Every group renders its own header row with all columns (N groups → N header rows).
3. The **old single global header is gone** (no header rendered outside a group section).
4. Adding a column from one group's `AddColumnMenu` makes it appear in all groups (cache-level).
5. Resizing a column from one group updates the shared width (template) for all groups.
6. Regression: existing `BoardTable` behaviors still pass (group rename, add item, footer alignment,
   frozen Name column).

## Execution DAG (AGENTS.md #6)

Single cohesive task touching one file (`BoardTable.tsx`) + its test. No independent sub-units to
parallelize; critical path = this one task. Built TDD in one worktree
(`task/group-column-headers`).
