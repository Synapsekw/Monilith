---
type: spec
status: approved
date: 2026-06-17
phase: 2c
tags: [spec, phase/2, boards, columns]
related:
  - "[[2026-06-15-1053-phase2a-boards-core]]"
  - "[[2026-06-15-1259-phase2b-boards-interactive]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
  - "[[00-north-star]]"
---

# Phase 2c — Column Management (add · rename · delete · resize)

> Completes Boards core. Phase 2 shipped the 6 column **kinds** + inline cell editing over a
> **fixed, auto-seeded** column set (`create_board` seeds Status/Owner/Date) — but there is no way
> to add, rename, delete, or resize columns. This slice adds that, making boards actually
> configurable. Builds directly on the Phase-2 `columns` table, board cache, and Realtime.

## 1. Scope (decided)

**In:**

- **Add** a column — a `+` affordance picks one of the 6 kinds (`text` / `status` / `people` /
  `date` / `numbers` / `dropdown`); the column is appended with a default name + default settings.
- **Rename** a column (header menu → inline edit).
- **Delete** a column (header menu → confirm; cascade removes its cells).
- **Resize** a column — drag handle on the header edge; **server-shared** width persisted to the DB
  and synced to teammates via Realtime.
- Table view only. Optimistic + Realtime, consistent with cells (gotcha-09: no RSC refetch).

**Out (deferred fast-follows, explicit non-goals):**

- Column **reorder** (drag to reposition) — trivial later: `position` is already `float8` (midpoint).
- A full **options editor** for Status/Dropdown (add/rename/recolor/remove options) — v1 seeds
  sensible defaults instead.
- Hide / freeze / per-view column visibility; richer custom **field types** beyond the 6 kinds
  (Phase 6 — ClickUp depth).

## 2. Data model

One migration (`supabase/migrations/<ts>_columns_width.sql`):

```sql
alter table public.columns
  add column width integer
  check (width is null or (width between 80 and 1200));
```

- `null` width → renders at the default value-column width (180px). No backfill needed.
- **No other schema change.** The `columns` table already has member-scoped RLS for
  `select` / `insert` / `update` / `delete` (keyed on `is_org_member(org_id)` +
  `board_in_org(board_id, org_id)`), and `cell_values.column_id` is
  `references public.columns (id) on delete cascade` — deleting a column removes its cells
  automatically. `columns` is already in the `supabase_realtime` publication.
- Regenerate `src/types/database.types.ts`.

## 3. Server layer

### Zod (`src/lib/validations/board-actions.ts`)

```ts
const COLUMN_NAME = z.string().trim().min(1).max(100);
createColumnSchema = {
  boardId: UUID,
  kind: columnKindSchema,
  name: COLUMN_NAME.optional(),
};
renameColumnSchema = { columnId: UUID, name: COLUMN_NAME };
deleteColumnSchema = { columnId: UUID };
resizeColumnSchema = {
  columnId: UUID,
  width: z.number().int().min(80).max(1200),
};
```

(`columnKindSchema` = `z.enum` over the 6 `column_kind` values; reuse/derive from the existing
`ColumnKind` type in `validations/boards.ts`.)

### Server Actions (`src/lib/boards/actions.ts`) — same `ActionResult`/`fail`/`auth.getUser()` idiom as `upsertCell`

- `createColumn({ boardId, kind, name? })` → derive `org_id` from the board (RLS-scoped read);
  compute `position = COALESCE(max(position), -1) + 1` for the board; resolve **default name**
  (`text`→"Text", `status`→"Status", `people`→"People", `date`→"Date", `numbers`→"Numbers",
  `dropdown`→"Dropdown") and **default settings** (see §3.1); insert; return the new column row.
- `renameColumn({ columnId, name })` → update `name` (RLS update policy is the guard).
- `deleteColumn({ columnId })` → delete the row (cells cascade).
- `resizeColumn({ columnId, width })` → update `width`.

All revalidate the same way `upsertCell` does today (match its `revalidatePath` behavior exactly —
board reads are React-Query + Realtime, so the optimistic cache + Realtime carry the UI).

### 3.1 Default settings per kind (so a new column is immediately usable)

- **status** → `{ options: [ {id, label:"Working on it", color:"#fdab3d"}, {id, label:"Stuck",
color:"#e2445c"}, {id, label:"Done", color:"#00c875"} ] }` (mirrors the `create_board` seed;
  option `id`s generated server-side).
- **dropdown** → `{ options: [ {id, label:"Option 1", color:"#579bfc"}, {id, label:"Option 2",
color:"#a25ddc"} ] }` (a minimal usable set; the real options editor is the fast-follow).
- **text / people / date / numbers** → `{}` (validated by `columnSettingsSchema(kind)`).

Settings are validated with the existing `columnSettingsSchema(kind)` before insert.

## 4. Cache, hooks & Realtime

- **Pure cache mutators** in `src/lib/boards/cache.ts` (mirror the cell/item helpers, keep columns
  ordered by `position`): `insertColumn(cache, col)`, `replaceColumn(cache, col)` (covers rename +
  width), `removeColumn(cache, columnId)` (also drops that column's `cellValues`).
- **Optimistic mutation hooks** in `src/lib/boards/use-board-mutations.ts`: `addColumn`,
  `renameColumn`, `deleteColumn`, `resizeColumn` — same optimistic/rollback pattern as the cell
  mutations.
- **Realtime** — extend `src/lib/boards/use-board-realtime.ts` to subscribe to `columns`
  INSERT/UPDATE/DELETE (filtered `board_id=eq.<boardId>`, echo-deduped like `cell_values`) and
  reconcile via the new mutators. This is the one wiring gap: the table is in the publication but
  was never subscribed, so today column changes wouldn't reach peers.

## 5. UI — `BoardTable` header

- **Per-column header menu:** on header hover, a `⋯` button opens a shadcn `DropdownMenu` →
  **Rename** (inline input that commits on Enter/blur) and **Delete** (a `text-destructive` item that
  opens an `AlertDialog`: "Delete column and all its data?"). Reuse existing `ui/dropdown-menu`,
  `ui/alert-dialog` (add via shadcn if absent), `ui/input`.
- **Add column:** a `+` button at the end of the header row opens a `DropdownMenu` of the 6 kinds
  (each with a `lucide-react` icon) → `addColumn`. New column appears at the right via Realtime/optimistic.
- **Resize:** a 4px drag handle on each value-column header's right edge. The grid template moves
  from uniform `repeat(n, minmax(180,1fr))` to **per-column fixed px**:
  `${NAME_COL_WIDTH}px ${columns.map(c => (liveWidths[c.id] ?? c.width ?? VALUE_COL_WIDTH) + "px").join(" ")}`.
  A pointer-drag updates a local `liveWidths` state (smooth, 0 round-trips, clamped 80–1200); on
  `pointerup`, `resizeColumn` persists and Realtime echoes to peers. Fixed-px value columns are the
  standard for resizable tables. **Table view only** — Kanban/Calendar/Gantt are untouched.
- Pulse-UI: monochrome chrome, `ui/*` primitives, icon-only controls get `aria-label`, AA focus
  rings, `text-destructive` for delete (load `pulse-ui` + `frontend-design` at build time).

## 6. Perf & data-fetching budget (gotcha-09 — mandatory)

| Interaction              | Server round-trips       | Notes                                                                 |
| ------------------------ | ------------------------ | --------------------------------------------------------------------- |
| Board first paint        | unchanged                | `width` rides along in the existing `getBoardPayload` columns read.   |
| Add / rename / delete    | **1** Server Action each | Optimistic board cache; peers reconcile via Realtime. No RSC refetch. |
| Resize (drag)            | **0** during drag        | Live `liveWidths` client state; smooth.                               |
| Resize (release)         | **1** Server Action      | Persists `width`; Realtime echoes to peers.                           |
| Live (peers add/resize…) | **0 (push)**             | New `columns` Realtime subscription, `board_id`-filtered, row-level.  |

No interaction issues an RSC navigation; all are server-data mutations via Server Actions.

## 7. Testing

- **Unit:** the 4 zod schemas; cache mutators (`insertColumn` keeps position order, `removeColumn`
  drops the column's cells, `replaceColumn` covers rename+width); the 4 actions (position
  computation, per-kind default name/settings, validation rejects, auth gate).
- **RLS integration** (`columns` CRUD): a member can create/rename/delete/resize a column in their
  org; cross-org create/update/delete is denied (extend the two-user boards harness).
- **Component:** header menu Rename + Delete (confirm), add-column kind picker creates a column,
  resize updates the grid template and calls `resizeColumn` on release.
- **e2e:** add a column (pick a kind) → it appears; rename → header updates; resize → width persists
  across reload; delete → column and its cells are gone.
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; advisors clean.

## 8. Build order (one PR)

1. Migration (`columns.width`) → `pnpm db:types` → advisors.
2. Zod schemas + the 4 Server Actions (tests first).
3. Cache mutators (tests first).
4. Mutation hooks + extend `use-board-realtime` to `columns`.
5. `BoardTable`: header menu (rename/delete) → add-column picker → resize handles + per-column grid template.
6. RLS integration + component + e2e tests → full gate → `/wrapup`.

## 9. Roadmap placement

New **Phase 2c — Column management** under Phase 2 (Boards core): 2a (schema/table/RLS/RPCs +
read-only Table), 2b (interactive cells + optimistic/Realtime), **2c (column add/rename/delete/resize)**.
Richer field _types_ and column settings depth remain **Phase 6 — ClickUp depth**.

## 10. Open questions / future

- Column **reorder** (drag): add a `moveColumn` action computing a midpoint `position` (the data
  model already supports it).
- **Options editor** for Status/Dropdown (the natural next slice after this).
- Per-view column visibility / freeze / hide; default-width-by-kind.
