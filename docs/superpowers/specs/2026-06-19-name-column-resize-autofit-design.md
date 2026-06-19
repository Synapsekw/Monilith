# Name column: auto-fit + manual resize — design

**Date:** 2026-06-19
**Status:** Approved (brainstorming)
**Surface:** `src/components/boards/BoardTable.tsx` (board table view)

## Problem

The board table's built-in **Name** column is hardcoded to a fixed width
(`NAME_COL_WIDTH = 280`) and rendered as a plain `<div>`, unlike every other
column (which renders through `ColumnHeader` with a drag handle and persists its
width to `columns.width` via the `resizeColumn` Server Action). Two gaps:

1. It does not scale to fit the item-name text.
2. It cannot be manually resized like the other columns.

## Decisions (locked during brainstorming)

- **Auto-fit default + drag override + double-click-to-refit.** On load the
  column sizes to fit the longest item name (measured across **all** items, not
  just the virtualized/visible rows). Dragging the edge sets a custom width;
  double-clicking the resize handle returns to auto mode.
- **Server-side persistence**, board-level (shared across all board users, like
  the other columns).

## Data model

Migration adds a nullable column to `public.boards`:

```sql
alter table public.boards
  add column name_column_width int
  check (name_column_width between 80 and 1200);
```

Semantics:

- `NULL` → **auto mode** (default): width computed client-side to fit the
  longest name.
- integer → **manual mode**: the fixed width the user dragged to.

Bounds `80..1200` mirror `ColumnHeader`'s `MIN`/`MAX`. After the migration,
regenerate `src/types/database.types.ts` with `pnpm db:types` and commit it in
the same change. `board.name_column_width` then flows through `BoardPayload` /
`BoardCache` automatically because `Board = Tables<"boards">`.

## Server Action

`resizeNameColumn({ boardId, width: number | null })` in
`src/lib/boards/actions.ts`, mirroring `resizeColumn`:

- Zod `resizeNameColumnSchema`: `boardId` uuid, `width` nullable int in
  `80..1200`.
- `supabase.from("boards").update({ name_column_width: width }).eq("id", boardId)`.
- `revalidatePath(\`/boards/${boardId}\`)`.
- RLS is the security boundary (org member); no client trust.

Wired into `src/lib/boards/use-board-mutations.ts` as an optimistic mutation
that patches the cached board via the existing
`replaceBoard(cache, { ...cache.board, name_column_width })` helper, with
rollback on error (same shape as `renameBoardMutation`).

## Auto-fit measurement (client)

Pure, injectable util — `fitNameColumnWidth(names, measureText, opts)` — in a new
`src/lib/boards/name-column-width.ts`:

- Returns `clamp(max(measured name widths, header label width) + padding, floor, MAX)`.
- `padding` = left `px-4` (16) + trailing open-panel button (`size-7` = 28) + gap.
- `floor` ≈ 180; `MAX` = 1200.
- `measureText` is injected so the function is unit-testable in jsdom (where the
  real canvas `measureText` returns 0).

In `BoardTable`, an offscreen canvas measurer at the cell font (Geist, 14px /
`text-sm`, normal weight) feeds the util. Measurement runs over all
`cache.items` names (held in memory — virtualization does not limit this) and is
memoized on the names list. Effective name width:

```
liveNameWidth ?? board.name_column_width ?? autoFitWidth
```

## Component changes (`BoardTable.tsx`)

- `gridTemplate(...)` takes a `nameWidth` param instead of the `NAME_COL_WIDTH`
  constant.
- New `NameColumnHeader` (sticky-left): the "Name" label + a reused resize
  handle. **Drag** updates `liveNameWidth` (live, 0 server round-trips) then
  persists px on release via `resizeNameColumn`. **Double-click the handle**
  persists `null` (back to auto-fit). Double-click lives on the handle, not the
  label, so a stray label double-click won't reset width.
- `AddItemRow`'s hardcoded `width: NAME_COL_WIDTH` (line ~519) uses the effective
  name width.
- `NameCell` keeps `truncate`, so a manually-narrowed column still truncates
  gracefully (auto mode never truncates because it fits the longest name).

## Performance & data-fetching budget (AGENTS.md rule 5)

- **First paint:** existing board read, unchanged and bounded; auto-fit is a pure
  client computation (no new server round-trip).
- **Interaction:** dragging is client state only (`liveNameWidth`) — **0 server
  round-trips** during drag; a **single** Server Action fires on pointer release
  (and on double-click reset). Identical to the existing column-resize path.
- Does the interaction change server data? Yes (the persisted width) → Server
  Action + targeted `revalidatePath`. Hot-path read stays bounded/indexed.

## Testing (TDD, mandatory)

- `fitNameColumnWidth` — pure util: padding, header-vs-name max, floor/clamp,
  empty-names case, via a stub measurer.
- `resizeNameColumn` — updates width, accepts `null`, rejects out-of-range
  (mirrors `column-actions.test.ts`).
- Cache optimistic patch — `replaceBoard` applied with a `name_column_width`
  patch leaves other board fields intact.

## Out of scope

- Per-user (vs board-shared) widths; persisting auto vs manual mode beyond the
  `NULL`/int distinction; resizing in other board views (kanban/timeline).
