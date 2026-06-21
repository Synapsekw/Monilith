---
type: spec
status: approved
phase: 6d-1
date: 2026-06-21
tags: [spec, phase/6, relations, columns]
related:
  - "[[2026-06-19-phase-6b-custom-fields-statuses-design]]"
  - "[[2026-06-20-phase-6c-time-tracking-design]]"
  - "[[2026-06-20-board-level-sharing-design]]"
---

# Phase 6d-1 — Relations (Connect Boards)

## Summary

A new **`relation`** column kind that links an item to one or more items on a configured target
board (Monday-style "Connect boards"). Each cell shows the linked items as chips; clicking opens a
searchable picker scoped to the target board. This is slice **6d-1**; **mirror columns** (surfacing
a value from the linked items) are slice **6d-2** and are explicitly out of scope here — but the
data model is designed so mirror is a clean read off the same join table.

## Goals

- Add a `relation` column kind selectable from the Add-column menu.
- Per-column config: a single **target board** and an **allow-multiple** toggle.
- Link/unlink items via an in-cell picker; render linked items as chips with a "+N more" overflow.
- Cross-board, sharing-aware: respect board-level privacy on both the owning and target boards.
- 0 server round-trips on board first paint and on in-cell view interactions.

## Non-goals (deferred)

- **Mirror columns** (6d-2) — surfacing a linked item's column value.
- **Multi-target boards** — v1 connects to exactly one target board per column.
- **Two-way / reciprocal links** — no auto-created reverse column on the target board.
- Formula columns; relation-based filtering/sorting in views; relation aggregation in dashboards.

## Decisions (locked in brainstorming)

| Decision         | Choice                                                                     |
| ---------------- | -------------------------------------------------------------------------- |
| Target scope     | Per-column configured **single** target board (`settings.target_board_id`) |
| Cardinality      | Configurable **single or multi** (`settings.allow_multiple`)               |
| Directionality   | **One-directional** (no reciprocal column on the target board)             |
| Storage          | **`relation_links` side table** (not JSON in `cell_values`)                |
| Overflow display | Chips + **"+N more"**, fixed row height (matches People column)            |
| Collapsed rollup | Count of distinct linked items ("3 linked")                                |

## Architecture

### Data model

- **Enum:** add value `relation` to `public.column_kind` (`ALTER TYPE … ADD VALUE`).
- **Column config:** stored in the existing `columns.settings` jsonb:
  `{ "target_board_id": "<uuid>", "allow_multiple": true|false }`.
- **New table `public.relation_links`:**

  ```
  id             uuid pk default gen_random_uuid()
  org_id         uuid not null references organizations(id) on delete cascade
  item_id        uuid not null references items(id)    on delete cascade   -- owning item
  column_id      uuid not null references columns(id)  on delete cascade   -- the relation column
  linked_item_id uuid not null references items(id)    on delete cascade   -- target item
  position       int  not null default 0                                   -- ordering within the cell
  created_at     timestamptz not null default now()
  unique (item_id, column_id, linked_item_id)
  ```

  Indexes: `(item_id, column_id)` for first-paint load, `(column_id)` for column-delete cleanup,
  `(linked_item_id)` to support 6d-2 reverse reads. A self-link (`item_id = linked_item_id`) is
  rejected in the write RPC.

### RLS (the careful part)

A `relation_links` row straddles **two** boards: the owning item's board and the target board.
This is the same trap as board-level sharing satellites ([[2026-06-20-gotcha-26-per-board-privacy-all-board-scoped-tables]]).

- **Read** a link row: requires `can_read_board(board_of(item_id))` — i.e. you can see a board's
  relation cells iff you can read that board.
- **Write** a link row: requires `can_edit_board(board_of(item_id))`.
- **Linked-item name resolution:** the first-paint payload `join`s `relation_links → items` for the
  linked item's `{id, name}`. That join is independently **RLS-filtered by the target board** — a
  user who cannot read the target board sees the link row but the linked-item name resolves to
  nothing, so the chip is omitted. No cross-board leak; no error.
- **Picker:** lists only target-board items where `can_read_board(target_board_id)` holds.

`relation_links` is added to the org-scoped default-deny baseline; policies key off the board
helpers, not raw `org_members`.

### Writes — server action + RPC

Single idempotent replace operation (covers link, unlink, reorder, and single↔multi):

- `setRelationLinks(itemId, columnId, linkedItemIds: string[])` — Zod-validated server action in
  `src/lib/boards/relation-actions.ts`.
- Backed by a `SECURITY DEFINER` RPC `set_relation_links(p_item_id, p_column_id, p_linked_item_ids uuid[])`:
  - assert `can_edit_board(board_of(p_item_id))`;
  - assert the column is `kind = 'relation'` and belongs to that board;
  - assert every `linked_item_id` belongs to `settings.target_board_id` and is not the owning item;
  - if `allow_multiple = false`, reject arrays of length > 1;
  - replace the cell's links transactionally (delete-then-insert with `position` = array index).
- Optimistic cache mutation + `revalidate` on success, following the 6c time-tracking mutation
  pattern (no realtime in v1).

### First paint (0 round-trips)

Board load issues one bounded query for the current board's relation links joined to linked-item
`{id, name}` (RLS-filtered), hydrated into each `RelationCell` exactly like `time_entries`/
`attachments` payloads. No per-cell fetch; no fetch on opening the picker for already-loaded data
(the picker fetches target-board items lazily on first open — a distinct board's data, not the
current page's).

### Components

- `RelationCell` — chips (item name + colored dot + remove ×), "+N more" overflow at fixed height,
  `+` affordance. Registered in `src/components/boards/cells/index.tsx`.
- `RelationCellEditor` / `RelationPicker` — popover with a search box and an RLS-scoped checkbox
  list of target-board items; registered in `src/components/boards/cells/editors/index.tsx`.
- Add-column flow — a target-board `<select>` (boards the user can read) + an allow-multiple toggle.
- Registry wiring: `COLUMN_KIND_META` + `COLUMN_KIND_ORDER` (`src/lib/boards/column-kinds.ts`),
  `columnKindSchema` (`src/lib/validations/boards.ts`).
- Collapsed-parent rollup case: distinct linked-item count ("N linked").

### Deletion semantics

- Deleting a linked (target) item cascades its inbound link rows (`linked_item_id … on delete cascade`).
- Deleting the owning item cascades its outbound links (`item_id … on delete cascade`).
- Deleting the relation column cascades all its links (`column_id … on delete cascade`).

## Performance & data-fetching budget

- **First paint:** +1 bounded query (this board's relation links + linked-item `{id,name}`), indexed
  on `(item_id, column_id)`. No `select *` on a growing table; bounded to the board's items.
- **In-page interactions (view chips, scroll, collapse/expand):** 0 new server round-trips — all
  link data hydrated at first paint; rollup computed client-side.
- **Picker open:** 1 lazy query for target-board items (a different board's data, not re-fetching
  the current page) — acceptable; cached for the popover's lifetime.
- **Mutations (link/unlink/reorder):** 1 Server Action → RPC, optimistic cache update + targeted
  revalidation. These change server data, so they are correctly Server Actions, not client-only.

## Independent units (for the plan's execution DAG)

- **U1 — DB foundation:** enum value + `relation_links` table + RLS + `set_relation_links` RPC +
  regenerated types + RLS integration tests. (Root; everything depends on it.)
- **U2 — registry + validation + config:** `column_kind` registry entries, `columnKindSchema`,
  add-column target-board/allow-multiple config. (Depends on U1's type.)
- **U3 — first-paint payload + hydration:** bounded load query + cell hydration plumbing.
  (Depends on U1.)
- **U4 — server action:** `relation-actions.ts` + optimistic mutation + unit tests. (Depends on U1.)
- **U5 — `RelationCell` + rollup:** presentational cell + collapsed rollup + unit tests.
  (Depends on U3 for the hydrated shape.)
- **U6 — `RelationPicker` + editor wiring:** picker popover + editors switch. (Depends on U2, U4.)
- **U7 — e2e + gate:** Playwright (add column → link → chip renders) + full gate. (Depends on all.)

U2/U3/U4 are mutually independent after U1 (a parallel wave); U5 follows U3; U6 follows U2+U4; U7
is the join. The plan owns the formal DAG.

## Testing

- **RLS integration** (live, CI-skipped suite): owner sees own-board links; a non-member of the
  target board sees the link row but not the linked name (chip omitted); single-vs-multi enforced
  by the RPC; self-link rejected; cascade on item/column delete; `can_edit_board` gates writes.
- **Unit:** `setRelationLinks` validation + optimistic mutation; `RelationCell` chip/overflow
  render; rollup count; registry completeness (`COLUMN_KIND_META` ↔ `ORDER` parity test already
  exists and must stay green).
- **e2e:** one Playwright flow end-to-end.

## Open risks

- **Picker scale** on large target boards — v1 fetches target-board items with search; if a board
  has thousands of items, bound the picker query (search + limit) rather than loading all. Note in
  the plan; not a blocker for typical boards.
- **Cross-board RLS** is the highest-risk surface — the integration test asserting the target-name
  RLS filter is the proof obligation, mirroring how board-sharing proved the storage-RLS fix.
