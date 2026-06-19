---
type: spec
status: approved
date: 2026-06-19
phase: 6
slice: 6a
tags: [spec, phase/6, boards, subitems]
related:
  - "[[00-north-star]]"
  - "[[2026-06-17-phase-2c-column-management-design]]"
---

# Phase 6 / Slice A — Subitems (single-level, shared columns, Table-nested + rollups)

> Phase 6 ("ClickUp depth") is five independent sub-projects: **A subitems**, B custom
> fields/statuses, C time tracking, D relations + mirror, E docs. Each gets its own spec → plan →
> build. This spec covers **only Slice A — subitems**.

## 1. Goal & scope

Add **subitems** to boards: a top-level item can own a flat list of child items ("subitems"),
shown nested under the parent in the **Table view**, with expand/collapse and a per-parent rollup
summary on the collapsed row.

### Decisions (locked during brainstorming)

| Decision        | Choice                                                  | Rationale                                                                                                                                                             |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nesting depth   | **Single level** (Monday-style)                         | No recursion in render/position/cycle logic; fits the per-group virtualizer cleanly.                                                                                  |
| Subitem columns | **Share the parent board's columns**                    | A subitem _is_ an item; cells reuse `(item_id, column_id)`. No "column scope" concept, no schema beyond `parent_id`.                                                  |
| View scope      | **Table nested; other views unchanged**                 | Kanban/Calendar/Timeline keep loading all items; subitems appear flat as normal cards/events in the parent's group. Zero per-view work.                               |
| Rollups         | **Included**, shown on the **collapsed parent's cells** | At-a-glance insight without expanding; reuses the existing cell grid (no extra row). Tradeoff: the parent's own value is hidden while collapsed (restored on expand). |

### Out of scope (deferred — YAGNI)

- Subitem drag-reorder and moving subitems between parents (item DnD doesn't exist yet either).
- Promote/demote (convert item ↔ subitem).
- A "Subitems" tab in the item detail panel.
- Persisting expand/collapse state across reloads (in-memory per session only).
- Rollup for the `text` kind (renders blank).

## 2. Data model & DB

`items.parent_id` **already exists** (added in `20260615061747_boards_core.sql` with the comment
_"parent_id stays null in Phase 2 (flat); Phase 6 subitems reuse it"_), FK self-ref
`ON DELETE CASCADE`. No new column or table.

A subitem:

- `parent_id` = the parent item's id.
- `org_id`, `board_id`, **`group_id` inherited from the parent** (`items.group_id` is `NOT NULL`;
  inheriting the parent's group keeps subitems coherent in the "flat everywhere else" views).
- `position` orders siblings within a parent (existing `double precision` scheme).

### Migration (one file, e.g. `20260619xxxxxx_subitems.sql`)

1. **Index**: `create index items_parent_id_idx on public.items (parent_id);`
2. **Single-level guard trigger** `tg_items_single_level` — `BEFORE INSERT OR UPDATE ON public.items`,
   `language plpgsql`, `set search_path = ''`. When `NEW.parent_id IS NOT NULL`:
   - reject self-parenting (`NEW.parent_id = NEW.id`);
   - look up the parent row: must exist, `parent.board_id = NEW.board_id`, and
     **`parent.parent_id IS NULL`** (rejects 2-level nesting — the core invariant);
   - reject if `NEW.id` already has children (`exists (select 1 from public.items where parent_id = NEW.id)`)
     — prevents demoting a parent-with-children into a subitem.

   Raises a clear `exception` on violation. This is a defense-in-depth guard; the Server Action also
   sets `group_id`/`board_id`/`parent_id` correctly.

3. **RLS**: unchanged. `items` is already org-scoped; subitems inherit `org_id`. `cell_values`
   policies unchanged.

No table/column/enum change → `pnpm db:types` is a no-op regen (still run + commit per the working
agreement). Run `get_advisors` after applying the migration (trigger function must pin `search_path`).

## 3. Server actions & validation

In `src/lib/boards/actions.ts` (+ Zod schemas in `src/lib/validations/board-actions.ts`):

- **`addSubitem(parentId, name)`** — mirrors `addItem`:
  - resolve the parent row (RLS-scoped) → derive `org_id`, `board_id`, `group_id`;
  - insert `{ org_id, board_id, group_id, parent_id, name, position: <end of siblings> }`;
  - `.select("*")` and return `{ item }` so the client patches the cache (mirrors `addItem`'s
    patch-on-success).
  - Zod: `{ parentId: uuid, name: string (1..255 trimmed) }`.
- **`deleteItem(itemId)`** — **new**; items currently have _no_ delete path. Resolves the item
  (RLS), deletes it; a parent delete cascades its subitems via the FK. Works for both items and
  subitems. Zod: `{ itemId: uuid }`.
- `renameItem`, `setCell`, `clearCellValue` already operate on any item id — subitems need no new
  actions.

The RLS boundary remains the security boundary; actions derive org/board from the resolved
parent/item, never trust client-supplied scope.

## 4. Cache & realtime

`src/lib/boards/cache.ts`:

- **`removeItem(cache, itemId)`** — new pure helper (filter out the item; also drop its cell values
  to keep the cache tidy). Mirrors `removeGroup`'s cascade shape.
- `insertItem` / `replaceItem` already keep the flat `items` array correct for subitems (rendering
  re-buckets by `parent_id`), no change.

`src/lib/boards/use-board-realtime.ts`: **no change** — `onItem` already routes INSERT/UPDATE/DELETE
generically (`insertItem` / `replaceItem` / filter-by-id). FK-cascade deletes of children emit a
DELETE per child, reconciled for free.

`src/lib/boards/use-board-mutations.ts`:

- **`addSubitem`** mutation — mirrors `addItemMutation` (optimistic `insertItem`, patch the returned
  row on success; realtime echo is idempotent). Exposes `addSubitem(parentId, name, { onSuccess(id), onError })`.
- **`deleteItem`** mutation — optimistic `removeItem`, rollback on error.

## 5. Table rendering (`BoardTable.tsx` — the main work)

### Bucketing

- `itemsByGroup` → **top-level only** (`it.parent_id === null`).
- New `childrenByParent: Map<parentId, Item[]>` (position-sorted), built once from `items`.

### Flattened visible rows

`GroupSection` virtualizes a **`VisibleRow[]`** instead of a flat `Item[]`. Pure helper
`flattenVisibleRows(topLevelItems, childrenByParent, expanded)` returns a discriminated union list:

```ts
type VisibleRow =
  | { type: "item"; item: Item; childCount: number } // top-level row
  | { type: "subitem"; item: Item; parentId: string } // indented child row
  | { type: "addSubitem"; parentId: string }; // trailing "+ Add subitem" row
```

For each top-level item: emit its `item` row; if it is in `expanded` **and** has children, emit each
`subitem` row followed by one `addSubitem` row. Virtualizer `count` = `rows.length`; row height stays
`ROW_HEIGHT = 36`. Virtualizer mechanics and the 12-row viewport cap are unchanged (cap now counts
visible rows).

### Expand/collapse state

`expanded: Set<string>` of parent ids — **client-only component state, 0 server round-trips**. Only
top-level items **with ≥1 child** are collapsible. Default state: **collapsed** (chevron right);
creating the first subitem auto-expands the parent.

### Row chrome

- **Parent row** (`type:"item"`) with `childCount > 0`: a chevron toggling `expanded`, plus a `(N)`
  count. With `childCount === 0`: a normal row.
- **Collapsed parent**: cells render **read-only `RollupCell`s** (see §6) instead of the parent's own
  values. **Expanded parent**: cells render the parent's own editable values as today.
- **Subitem row**: Name cell indented (e.g. `pl-10`) with a subtle `└` connector; the subitem's own
  cells are normally editable (same `EditableCell` path).
- **Add subitem affordances**: items with **no** children get a hover "+ subitem" button in the Name
  cell (alongside the existing open-panel `Maximize2`). Parents **with** children get the trailing
  `addSubitem` row. Both call `addSubitem`, auto-expand the parent, and drop into the new subitem's
  rename input (mirrors the add-group / add-item flow).
- **Delete**: a row `⋯` menu on items and subitems → Delete (with an `AlertDialog` confirm for items
  that have children, since the cascade removes subitems). Calls `deleteItem`.

## 6. Rollup computation (`src/lib/boards/rollup.ts` — pure, fully unit-tested)

```ts
rollupCell(kind, childValues, settings) → RollupResult
```

Computed entirely from already-loaded child cell values (no round-trip). Per kind:

- **numbers** → sum.
- **status** → distribution mini-bar (segments per `optionId`, colored from settings; counts hidden
  options too).
- **dropdown** → distribution mini-bar (by `optionIds`, multi-select aware).
- **date** → min–max span ("Jun 3–14").
- **people** → deduped union of assignee ids → avatar stack.
- **text** → blank (deferred).

Rendered by a small read-only `RollupCell` component. Empty children / all-empty values → blank cell.

## 7. Other views — explicitly no change

Kanban/Calendar/Timeline keep loading all items (incl. subitems) and render them flat in the parent's
group context. No filtering, no per-view subitem UX in this slice.

## 8. Performance & data-fetching budget (working-agreement §5)

- **(a) First paint vs interaction:** subitems + their cells already arrive in the single batched
  `getBoardPayload` read — **0 new server round-trips on first paint**. Expand/collapse and rollup
  rendering are **pure client state — 0 round-trips**.
- **(b) Server-data changes:** add subitem / rename / set cell / delete change server data →
  **Server Action + optimistic cache patch + Realtime reconciliation** (not RSC navigation).
- **(c) Bounded over indexed columns:** reads stay board-scoped (bounded per board) and virtualized
  over the flattened visible rows; `items.parent_id` is indexed; cells are read on the
  `(item_id, column_id)` PK.

## 9. Testing

- **Pure unit:** `rollupCell` per kind (sum, distribution, span, people union, text-blank, empty);
  `flattenVisibleRows` (collapsed vs expanded, no-children, add-subitem row placement).
- **DB integration:** single-level trigger rejects 2-level nesting, self-parent, cross-board parent,
  and demoting-a-parent-with-children; cascade delete removes subitems + their cells; RLS still
  org-scoped (no cross-org read of a subitem).
- **Component:** nested render, expand/collapse toggles children, collapsed parent shows rollup,
  add-subitem (hover button + trailing row) auto-expands & renames, delete with confirm.
- **e2e:** create item → add subitem → see nested → set a subitem cell → collapse → see rollup →
  delete subitem.

Gate (per working agreement): `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green;
advisors clean after the migration.

## 10. Risks & notes

- **Shared single checkout** — `BoardTable.tsx`, `cache.ts`, `use-board-mutations.ts`,
  `actions.ts` are hot files other sessions touch. Coordinate / verify own scope before claiming
  green (see [[develop-red-concurrent-work]]).
- **`GroupSection` refactor** (flat `Item[]` → `VisibleRow[]`) is the largest single change; keep the
  flattening pure and tested so the virtualizer change is low-risk.
- **`deleteItem` is a new general capability** (not subitem-specific) — it fills a real gap and is
  surfaced for both items and subitems.
