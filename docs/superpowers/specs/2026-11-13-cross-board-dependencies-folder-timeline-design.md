# Cross-board dependencies + folder Timeline — design

Date: 2026-11-13
Status: approved in brainstorming, awaiting written-spec review

## Why

Programmes are split across several boards (one per workstream) inside a folder. Work on one
board routinely waits on work on another — the Etisalat Drones & Robotics plan that prompted this
has 1,360 dependencies, 81 of which cross workstreams. Monolith today only allows dependencies
between items on the same board, and the only Gantt is per board, so a programme cannot be seen or
scheduled as a whole.

This is a general Work OS capability, not an import of one tracker. We are deliberately **not**
rebuilding the tracker's bespoke views (readiness runway, scorecard rules, decision log, template
generators); those are configured with existing Monolith features or deferred.

## Scope

In:

1. Dependencies between items on any two boards in the same organisation.
2. A folder-level **Timeline** tab: one Gantt across every board in the folder, editable like the
   board Gantt.
3. Cross-board links surfaced on the board Gantt (as stubs) and in a new item-panel section
   ("Waiting on / Blocking") where links can be added and removed from any view.

Out (explicitly):

- Dependency types other than finish-to-start (FS).
- Auto-rescheduling successors when a predecessor moves.
- Critical path / projected-finish computation.
- Spreadsheet import of the Etisalat plan (separate follow-up; note that activities with only a
  target date render as milestone diamonds, so the import must synthesise start dates).

Already exists and is reused: milestone rendering (single-date or start = end items draw as a
diamond), cycle-safe `create_item_dependency`, Gantt dependency-violation detection, folder Command
Center configurable tabs and filter bar, `search_items`, row virtualization in `GanttBoard`.

## Approach

Extract the board-agnostic parts of `GanttBoard` (grid, bars, drag/resize, link drawing, arrows,
violation highlighting, virtualization, zoom) into a `GanttCanvas` component that takes rows,
dependencies and callbacks. The board Gantt and the folder Timeline both wrap it.

Rejected: a separate lighter folder Gantt (two implementations drift — touch and inline-edit fixes
would have to be made twice); stacking per-board Gantts in the folder (loads every full board
payload and cannot draw cross-board arrows).

## 1. Data model and security

`item_dependencies`:

- Keep `board_id`, now defined as **the successor's board** (the link's owning board). Existing
  rows already satisfy this because both ends were on the same board.
- Add `predecessor_board_id uuid not null references boards(id) on delete cascade`, backfilled
  from `board_id` for existing rows; index it.
- Both ends must be in the same org (enforced in the RPC).

RLS:

- **Select:** `board_id in readable_board_ids() and predecessor_board_id in readable_board_ids()`.
  A link is visible only when the viewer can read both ends; a link to a board you cannot open is
  not shown at all, so no name, date or existence leaks.
- **Insert:** via the RPC only (security definer); direct inserts keep requiring edit on
  `board_id`.
- **Delete:** `can_edit_board(board_id) or can_edit_board(predecessor_board_id)`.

`create_item_dependency(p_predecessor, p_successor)`:

- Drop the `items must be on the same board` guard.
- Require: authenticated; caller can edit the successor's board and read the predecessor's board;
  both items exist, are not archived, and share an org.
- Keep self-link and cycle guards (cycle detection already walks edges regardless of board).
- Insert with `board_id = successor board`, `predecessor_board_id = predecessor board`.
- After any `create function`, `revoke execute … from public, anon` and grant to `authenticated`.

Migration minted with `scripts/new-migration.sh`, applied to DEV via the `supabase-dev` MCP with
the same version and name, verified with `pnpm db:ledger-check`; types regenerated and committed in
the same change.

## 2. Resolving schedule dates across boards

Each board decides its own start/end date columns: the board's timeline view config
(`date_column_id` / end column), falling back to the existing name-based default picker. Extract
this into one helper, `resolveBoardSchedule(board columns, timeline view config)` in
`src/lib/boards/dates.ts` (or a sibling module), returning the start/end column ids. Every consumer
— board Gantt, folder Timeline, item panel late check — uses it, so "is this link late?" compares
the right dates on both ends.

Late rule (unchanged FS semantics): a link is late when the predecessor's end date is after the
successor's start date. If either end has no dates, the link is shown but not flagged.

## 3. Folder Timeline tab

- New Command Center tab kind `timeline`, available in the folder layout configuration (add,
  rename, reorder, remove) like existing tab kinds. It is included in the default layout preset,
  so new folders and folders still on the default layout get it; folders with a customised layout
  add it themselves from the layout editor.
- Rows: one collapsible band per board, then its groups, then items; sub-items collapsed by
  default. Board bands show name and done/total.
- Draws: bars and milestone diamonds, intra- and cross-board arrows, today line, late links in
  red (existing violation styling).
- Links to items on boards outside the folder render as a stub on the bar ("↤ Waiting on
  '<name>' · <board>"); clicking opens that item.
- Reuses the folder filter bar (person, status) and the existing zoom levels.
- Editing: drag/resize to reschedule (existing cell date mutation on that item's board), draw and
  remove links (dependency actions), click opens the item panel. Permission-aware: bars on boards
  the viewer can only read are not draggable; link drawing requires edit on the successor board.
- Boards with no date columns are listed as a collapsed band with an "No dates on this board"
  note.

## 4. Board Gantt

Cross-board links cannot draw as arrows (the other end is not a row on this board). They render as
a stub on the bar showing the other item's name and board, keep the late warning, and clicking
opens that item. Intra-board behaviour is unchanged.

## 5. Item panel: "Waiting on / Blocking"

A new section in the item panel:

- Two lists: **Waiting on** (predecessors) and **Blocking** (successors). Each entry shows item
  name, board name, end date and a late marker.
- "+ Add" opens a search over the org using `search_items`, restricted to boards the viewer can
  read (predecessor side) / edit (successor side). Selecting creates the link via the dependency
  server action.
- ✕ removes a link (subject to delete permission).
- Works from every view, including table, kanban, calendar and mobile.

## 6. Performance and data-fetching budget

- **First paint of the Timeline tab:** one bounded RPC `folder_timeline(p_folder_id)` returning,
  for readable boards in the folder: items (id, name, board_id, group_id, parent_id, position,
  status label, owner ids), only their date-column cell values, each board's resolved schedule
  inputs (date columns + timeline view config), group metadata, and the dependencies that touch
  those items (including slim stub info for out-of-folder ends the viewer can read). Capped at
  5,000 items with a "showing first N items" notice. All filters on indexed columns
  (`items.board_id`, `cell_values.item_id`, dependency predecessor/successor indexes).
- **Loading:** the tab's data loads when the tab is opened, never as part of the Overview first
  paint.
- **In-tab interactions** (zoom, collapse, filter, scroll): zero server round-trips; tab/zoom state
  via `window.history.replaceState`, never router navigation.
- **Drag / link:** one server action per change, optimistic update, rollback on error, no
  `router.refresh()` of the folder page.
- **Board Gantt and item panel:** the board payload loads dependencies where the board is either
  end (`board_id` or `predecessor_board_id`), plus slim info for foreign ends. Realtime subscribes
  to both filters (two channel filters, since realtime supports a single `eq` per filter).

## 7. Error handling

- Cycle, permission denied, deleted/archived item, cross-org: the RPC raises with a clear message;
  the client rolls back the optimistic change and shows a toast with that message.
- A board removed from the folder or unshared mid-session disappears on the next load of the tab;
  stale links involving it are ignored client-side.
- Over-cap folders show the notice and still render the first N items.

## 8. Testing

- **DB integration (DEV, skipped unless `PULSE_TEST_DB`):** cross-board create succeeds with edit
  on successor + read on predecessor; fails without; cross-org rejected; cycle across boards
  rejected; select hides links when either board is unreadable; delete allowed from either
  editable side; backfill correct for existing rows; conformance suite (EXECUTE revoked from
  public/anon).
- **Unit:** `resolveBoardSchedule`; folder row building (bands, groups, sub-items, cap); late-link
  rule across boards; stub derivation.
- **Component:** `GanttCanvas` in isolation; board Gantt unchanged behaviour after extraction
  (existing tests stay green); folder Timeline tab render, drag, link, permission-disabled drag;
  item panel section add/remove/late marker.
- **Live run:** a Chrome walkthrough on a folder with two boards before merge.

Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## 9. Execution DAG

Units:

- **T1 Migration + RPCs + types** — `predecessor_board_id`, RLS, `create_item_dependency`
  rewrite, `folder_timeline` RPC, regenerated types.
- **T2 Extract `GanttCanvas`** — pure refactor of `GanttBoard`, no behaviour change.
- **T3 `resolveBoardSchedule` helper** — extract and adopt in the board Gantt.
- **T4 Folder Timeline tab** — layout tab kind, data loader, rows, editing.
- **T5 Item panel "Waiting on / Blocking"** section.
- **T6 Board Gantt cross-board stubs + payload/realtime changes.**

Dependencies: T4 ← T1, T2, T3. T5 ← T1, T3. T6 ← T1, T2, T3.

Batches:

- Batch 1 (parallel): T1, T2, T3.
- Batch 2 (parallel): T4, T5, T6.

Critical path: T1 → T4 (migration and RPC, then the folder Timeline tab).

UI work in T4–T6 loads the `pulse-ui` and `frontend-design` skills.
