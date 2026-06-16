# Board View Performance Amplifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the residual board-view slowness left after the client-side view-switch fix (commit `609227e`) — wasted re-derivation, realtime resubscribe on switch, unbounded Kanban DOM, and an unindexed `cell_values` scan.

**Architecture:** Four independent, additive improvements over the existing board view stack: (1) a shared, memoized cell-lookup map removes per-card linear scans and stabilizes derivations; (2) the realtime subscription is hoisted to the stable `BoardViews` parent so it survives view switches; (3) Kanban card lists are virtualized like the table already is; (4) a `cell_values(board_id)` index + bounded read removes the hot-path scan. Behavior is unchanged throughout — these are non-functional improvements guarded by the existing test suite plus new unit tests on the extracted pure helpers.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19 (React Compiler NOT enabled — manual memoization required), `@tanstack/react-virtual@3.14.2`, `@tanstack/react-query`, Supabase (Postgres + RLS), Vitest.

**Context this plan builds on:** `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`. The dominant cost (full RSC refetch per switch) is already fixed; this plan handles the documented "deferred amplifiers."

**Locating code:** The board view files were recently restyled, so line numbers drift. Each task quotes the exact code to find — search for the quoted snippet rather than trusting line numbers.

---

## ⚠️ Status & Preconditions (re-baselined 2026-06-16, develop @ `d427af8`)

This plan was written, then a **concurrent Phase 3b session** landed Calendar + Timeline/Gantt + item-dependencies on `develop` while it was paused. Re-baselined facts:

- **Task 1 is DONE and committed** (`fc2e4cd`: `cellKey`/`buildCellMap` in `src/lib/boards/cache.ts`). Skip it; later tasks consume those helpers.
- **There are now FOUR view components**, not two: `BoardTable.tsx`, `KanbanBoard.tsx`, `CalendarBoard.tsx`, `GanttBoard.tsx`. **All four call `useBoardCache(...)` and `useBoardRealtime(payload.board.id)` individually.** This expands Task 4 (realtime hoist) to all four — and raises its value (4 kinds → more cross-kind switches re-subscribing).
- **`use-board-realtime.ts` changed** (+18 lines for the new tables/deps). Re-read it before Task 4 — the hoist approach (call once in `BoardViews`, remove from children) still holds, but confirm the current signature/behavior.
- **`BoardViews.tsx` now branches table/kanban/calendar (+gantt/timeline)** via `if (selected?.kind === ...)`. Task 4 adds the hooks once at the top of this component, before the branching.
- `BoardTable.tsx` (+14) and `KanbanBoard.tsx` (+4) were lightly touched by 3b. **Re-confirm every find/replace snippet in Tasks 2, 3, 5 against the current file before editing** — locate by quoted code, not line number.
- `CalendarBoard.tsx` (526 lines) and `GanttBoard.tsx` (776 lines) are large new client components with their own likely per-render derivations — see new **Task 7** (assess at resume).

**DO NOT EXECUTE until the Phase 3b session is committed and `develop` is quiet.** Executing against a fast-moving working tree risks clobbering their uncommitted work. At resume: pull latest, re-read the files named above, reconcile snippets, then proceed Task 2 → 7.

---

## File Structure

| File                                      | Responsibility                      | Change                                                                                   |
| ----------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/lib/boards/cache.ts`                 | Cache types + pure cache transforms | ✅ **DONE** (`fc2e4cd`) — `cellKey` + `buildCellMap` helpers                             |
| `src/lib/boards/cache.test.ts`            | Unit tests for cache helpers        | ✅ **DONE** (`fc2e4cd`)                                                                  |
| `src/components/boards/BoardTable.tsx`    | Table view                          | **Modify** — use helper; memoize derivations; drop own realtime call                     |
| `src/components/boards/KanbanBoard.tsx`   | Kanban view                         | **Modify** — use helper; memoize derivations; virtualize columns; drop own realtime call |
| `src/components/boards/CalendarBoard.tsx` | Calendar view (Phase 3b)            | **Modify** — drop own realtime call (Task 4); memoize derivations (Task 7)               |
| `src/components/boards/GanttBoard.tsx`    | Timeline/Gantt view (Phase 3b)      | **Modify** — drop own realtime call (Task 4); memoize derivations (Task 7)               |
| `src/components/boards/BoardViews.tsx`    | Client view router                  | **Modify** — own the realtime subscription (and cache hydration) for all views           |
| `supabase/migrations/<new>.sql`           | DB schema                           | **Create** — `cell_values(board_id)` index                                               |
| `src/types/database.types.ts`             | Generated types                     | **Regenerate** after migration                                                           |

---

## Task 1: Shared cell-lookup helper (pure, tested) — ✅ DONE (`fc2e4cd`)

> Completed and committed before the Phase 3b re-baseline. Helpers `cellKey`/`buildCellMap` live in `src/lib/boards/cache.ts` with tests in `cache.test.ts`. Steps retained below for reference; do not re-run.

Removes the per-card linear `cellValues.find(...)` in Kanban and DRYs the `${item}:${col}` key shared with the table.

**Files:**

- Modify: `src/lib/boards/cache.ts`
- Test: `src/lib/boards/cache.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/boards/cache.test.ts` (match the existing import style in that file):

```typescript
import { cellKey, buildCellMap } from "@/lib/boards/cache";

describe("buildCellMap", () => {
  const cells = [
    { item_id: "i1", column_id: "c1", value: { optionId: "o1" } },
    { item_id: "i1", column_id: "c2", value: 5 },
    { item_id: "i2", column_id: "c1", value: null },
  ] as never[];

  it("keys values by item:column for O(1) lookup", () => {
    const map = buildCellMap(cells);
    expect(map.get(cellKey("i1", "c2"))).toBe(5);
    expect(map.get(cellKey("i1", "c1"))).toEqual({ optionId: "o1" });
    expect(map.get(cellKey("i2", "c9"))).toBeUndefined();
  });

  it("uses a colon-delimited key", () => {
    expect(cellKey("i1", "c2")).toBe("i1:c2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/boards/cache.test.ts`
Expected: FAIL — `cellKey`/`buildCellMap` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/boards/cache.ts` (alongside the existing `CacheCellValue` type and transforms). Use the file's existing `CacheCellValue`/`Json` types:

```typescript
/** Stable lookup key for a cell value (item + column). */
export function cellKey(itemId: string, columnId: string): string {
  return `${itemId}:${columnId}`;
}

/** Build an O(1) `${item_id}:${column_id}` → value map from cell values. */
export function buildCellMap(
  cellValues: readonly CacheCellValue[],
): Map<string, CacheCellValue["value"]> {
  const map = new Map<string, CacheCellValue["value"]>();
  for (const c of cellValues) map.set(cellKey(c.item_id, c.column_id), c.value);
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/boards/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/cache.ts src/lib/boards/cache.test.ts
git commit -m "feat(boards): add shared cellKey/buildCellMap cache helpers"
```

---

## Task 2: Memoize BoardTable derivations + use the helper

`cellMap`, `itemsByGroup`, and `tableColumns` rebuild every render. Wrap them in `useMemo` and source `cellMap` from the helper. (React Compiler is off, so this is real work; `useReactTable` also makes the compiler bail even when enabled.)

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`

- [ ] **Step 1: Add imports**

Ensure `useMemo` is imported from React and the helper is imported. Find the React import line (currently `import { useRef, useState, useTransition } from "react";`) and add `useMemo`. Add near the other `@/lib/boards/*` imports:

```typescript
import { buildCellMap, cellKey } from "@/lib/boards/cache";
```

- [ ] **Step 2: Replace the inline `cellMap`**

Find:

```typescript
// Cell lookup keyed by `${item_id}:${column_id}` → raw JSON value.
const cellMap = new Map<string, Json>(
  cellValues.map((c) => [`${c.item_id}:${c.column_id}`, c.value]),
);
```

Replace with:

```typescript
// Cell lookup keyed by `${item_id}:${column_id}` → raw JSON value.
const cellMap = useMemo(() => buildCellMap(cellValues), [cellValues]);
```

- [ ] **Step 3: Memoize `itemsByGroup`**

Find the block that builds `itemsByGroup` (starts `const itemsByGroup = new Map<string, Item[]>();` and the two `for` loops). Wrap it:

```typescript
// Items grouped by group_id, kept in position order (query already sorts).
const itemsByGroup = useMemo(() => {
  const byGroup = new Map<string, Item[]>();
  for (const g of groups) byGroup.set(g.id, []);
  for (const it of items) {
    const bucket = byGroup.get(it.group_id);
    if (bucket) bucket.push(it);
    else byGroup.set(it.group_id, [it]);
  }
  return byGroup;
}, [groups, items]);
```

- [ ] **Step 4: Memoize `tableColumns`**

Find:

```typescript
const tableColumns: ColumnDef<Item>[] = columns.map((col) => ({
  id: col.id,
  header: col.name,
  accessorFn: (row) => cellMap.get(`${row.id}:${col.id}`) ?? null,
}));
```

Replace with (also switches the key to `cellKey` for consistency):

```typescript
const tableColumns = useMemo<ColumnDef<Item>[]>(
  () =>
    columns.map((col) => ({
      id: col.id,
      header: col.name,
      accessorFn: (row) => cellMap.get(cellKey(row.id, col.id)) ?? null,
    })),
  [columns, cellMap],
);
```

- [ ] **Step 5: Replace any remaining inline key building**

Find the virtualized-row render that does `value={cellMap.get(`${item.id}:${col.id}`) ?? null}` (inside `GroupSection`). Replace the template string with `cellKey(item.id, col.id)`:

```typescript
            value={cellMap.get(cellKey(item.id, col.id)) ?? null}
```

(If `GroupSection` is a separate component that receives `cellMap` as a prop, import `cellKey` there too — it's already imported at file scope.)

- [ ] **Step 6: Run the table's tests + typecheck**

Run: `pnpm vitest run src/components/boards && pnpm typecheck`
Expected: PASS — behavior unchanged, no type errors. (The existing board tests are the regression guard; `Json` may now be unused — remove the import if lint flags it.)

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/BoardTable.tsx
git commit -m "perf(boards): memoize BoardTable derivations via shared cell map"
```

---

## Task 3: Memoize KanbanBoard derivations + kill per-card scan

`kanbanColumns` and `summaryColumns` rebuild every render, and each `KanbanCard` does `cellValues.find(...)` per summary column — O(items × summaryCols × cellValues). Build one memoized `cellMap` and thread it to cards.

**Files:**

- Modify: `src/components/boards/KanbanBoard.tsx`

- [ ] **Step 1: Add imports**

Add `useMemo` to the React import. Add:

```typescript
import { buildCellMap, cellKey } from "@/lib/boards/cache";
```

- [ ] **Step 2: Memoize `kanbanColumns`, `summaryColumns`, and add `cellMap`**

Find:

```typescript
const kanbanColumns = buildKanbanColumns(cache, groupColumn);
```

Replace with:

```typescript
const kanbanColumns = useMemo(
  () => buildKanbanColumns(cache, groupColumn),
  [cache, groupColumn],
);
```

Find:

```typescript
const summaryColumns = cache.columns.filter(
  (c) => c.kind === "people" || c.kind === "date",
);
```

Replace with:

```typescript
const summaryColumns = useMemo(
  () => cache.columns.filter((c) => c.kind === "people" || c.kind === "date"),
  [cache.columns],
);

// O(1) cell lookup for card summaries (replaces per-card cellValues.find).
const cellMap = useMemo(
  () => buildCellMap(cache.cellValues),
  [cache.cellValues],
);
```

> Note: `buildKanbanColumns` itself is already efficient (builds its own status map once) — do not change `src/lib/boards/kanban.ts`.

- [ ] **Step 3: Thread `cellMap` down to the cards**

`KanbanColumnView` is rendered with `cellValues={cache.cellValues}`. Add `cellMap={cellMap}` to that JSX, add `cellMap: Map<string, ...>` to `KanbanColumnView`'s props, and pass it through to `KanbanCard`. The card's value type is `CacheCellValue["value"]` — import `CacheCellValue` if not already imported (it is imported at file scope per the current code). Use this prop type on both components:

```typescript
cellMap: Map<string, CacheCellValue["value"]>;
```

- [ ] **Step 4: Replace the per-card linear search**

In `KanbanCard`, find:

```typescript
const cell = cellValues.find(
  (c) => c.item_id === item.id && c.column_id === col.id,
);
```

Replace with:

```typescript
const cell = cellMap.get(cellKey(item.id, col.id)) ?? null;
```

Then update the line that reads `cell.value` (or similar) — the value is now `cell` directly (the map stores values, not rows). Adjust the `CellRenderer` call accordingly: where it previously passed `cell?.value`, pass `cell`. If `cellValues` becomes unused in `KanbanCard`/`KanbanColumnView`, remove that prop.

- [ ] **Step 5: Run Kanban tests + typecheck**

Run: `pnpm vitest run src/components/boards/KanbanBoard.test.tsx && pnpm typecheck`
Expected: PASS. If `KanbanBoard.test.tsx` asserts a card's summary value, it still passes because the resolved value is identical — only the lookup path changed.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/KanbanBoard.tsx
git commit -m "perf(boards): memoize Kanban derivations, O(1) card summary lookup"
```

---

## Task 4: Hoist realtime (and cache hydration) to BoardViews

**Re-baselined:** there are now FOUR view components — `BoardTable`, `KanbanBoard`, `CalendarBoard`, `GanttBoard` — and **each calls `useBoardRealtime(payload.board.id)` and `const { data: cache } = useBoardCache(...)`**. On any cross-kind switch the active view unmounts, tearing down and re-subscribing the Realtime channel (`board:<id>`, now also carrying an `item_dependencies` handler). `BoardViews` is the stable parent that does NOT remount on switch — own the subscription there once so it persists across all four kinds.

The hook signature is unchanged (`useBoardRealtime(boardId)`), so this is a pure hoist.

**Files:**

- Modify: `src/components/boards/BoardViews.tsx`
- Modify: `src/components/boards/KanbanBoard.tsx`
- Modify: `src/components/boards/BoardTable.tsx`
- Modify: `src/components/boards/CalendarBoard.tsx`
- Modify: `src/components/boards/GanttBoard.tsx`

- [ ] **Step 1: Subscribe realtime + hydrate cache in BoardViews**

In `src/components/boards/BoardViews.tsx`, add imports and call both hooks once at the top of the component body (before the `searchParams` line). Cache hydration is idempotent (same query key) but doing it here guarantees the cache exists before any child reads it:

```typescript
import type { BoardCache } from "@/lib/boards/cache";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardRealtime } from "@/lib/boards/use-board-realtime";
```

Inside the component body, first lines:

```typescript
useBoardCache(payload.board.id, payload as unknown as BoardCache);
useBoardRealtime(payload.board.id);
```

- [ ] **Step 2: Remove the realtime call from ALL FOUR child views**

In `KanbanBoard.tsx`, `BoardTable.tsx`, `CalendarBoard.tsx`, and `GanttBoard.tsx`, delete the line:

```typescript
useBoardRealtime(payload.board.id);
```

and remove the now-unused `useBoardRealtime` import from each. **Keep** the `useBoardCache(...)` call in each child — it is the read path (`const { data: cache } = useBoardCache(...)`) and is cheap (same query key, no refetch).

Each view's test file (`KanbanBoard.test.tsx`, `CalendarBoard.test.tsx`, `GanttBoard.test.tsx`) currently does `vi.mock(".../use-board-realtime", () => ({ useBoardRealtime: vi.fn() }))`. Leaving that mock in place after removing the call is harmless (an unused mock). Only touch a test if lint/TS flags the mock as unused; otherwise leave tests alone.

- [ ] **Step 3: Verify the channel is owned once**

Run: `pnpm vitest run src/components/boards && pnpm typecheck && pnpm lint`
Expected: PASS. Manual check (documented, not automated — jsdom can't observe Supabase channels): in the browser, switch between all view kinds repeatedly and confirm in the Network/WS panel that the `board:<id>` channel opens once and is not torn down per switch.

- [ ] **Step 4: Commit**

```bash
git add src/components/boards/BoardViews.tsx src/components/boards/KanbanBoard.tsx src/components/boards/BoardTable.tsx src/components/boards/CalendarBoard.tsx src/components/boards/GanttBoard.tsx
git commit -m "perf(boards): own realtime channel in BoardViews so switches don't resubscribe"
```

---

## Task 5: Virtualize Kanban card lists

Kanban renders every card in every column (the table already virtualizes). Virtualize each column's vertical card list with `@tanstack/react-virtual`, mirroring the table's `GroupSection` pattern.

**Files:**

- Modify: `src/components/boards/KanbanBoard.tsx`

- [ ] **Step 1: Add imports + constants**

```typescript
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
```

Add a card-height constant near the top of the file:

```typescript
const CARD_HEIGHT = 96; // px — matches the card's fixed min-height; tune to design
```

- [ ] **Step 2: Virtualize inside `KanbanColumnView`**

`KanbanColumnView` renders `column.cards.map(...)`. Replace the direct map with a virtualized scroll container, mirroring `BoardTable`'s `GroupSection`. Inside `KanbanColumnView`:

```typescript
const scrollRef = useRef<HTMLDivElement>(null);
const virtualizer = useVirtualizer({
  count: column.cards.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => CARD_HEIGHT,
  overscan: 8,
});
const virtualCards = virtualizer.getVirtualItems();
```

Render:

```typescript
  <div ref={scrollRef} className="flex-1 overflow-y-auto">
    <div
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualCards.map((vc) => {
        const item = column.cards[vc.index];
        return (
          <div
            key={item.id}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vc.start}px)`,
            }}
          >
            <KanbanCard
              item={item}
              fromColId={column.id}
              summaryColumns={summaryColumns}
              cellMap={cellMap}
            />
          </div>
        );
      })}
    </div>
  </div>
```

Keep the existing column header and quick-add button outside the scroll container. Preserve the existing dnd-kit `useDroppable` wiring on the column — the droppable ref stays on the column wrapper, not the inner scroll div.

> **dnd-kit interaction note:** dragging a card that is virtualized-out of view is a known edge case. For this pass, `overscan: 8` keeps a buffer; if drag-from-collapsed-scroll proves janky in manual testing, raise overscan or defer virtualization to columns above a threshold (`column.cards.length > 50`). Document whichever you choose in a code comment.

- [ ] **Step 3: Run Kanban tests + typecheck + lint**

Run: `pnpm vitest run src/components/boards/KanbanBoard.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS. If `KanbanBoard.test.tsx` queries cards by text and jsdom reports 0 height (so the virtualizer renders nothing), set the test container height or assert against `virtualizer`-independent structure; adjust the test rather than the component, and note it.

- [ ] **Step 4: Manual verification**

Run the app, open a Kanban view with a column of 100+ cards, confirm smooth scroll and that drag-to-another-column still sets status. Document the result.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/KanbanBoard.tsx
git commit -m "perf(boards): virtualize Kanban card lists"
```

---

## Task 6: Index `cell_values(board_id)` + bounded read

The whole board's `cell_values` is fetched filtered by `board_id`, but only `org_id` and `column_id` are indexed. Add a `board_id` index. (Bounded/paginated reads are a larger change tracked separately; this task adds the index, which is the cheap high-value half.)

**Files:**

- Create: `supabase/migrations/<timestamp>_cell_values_board_id_idx.sql`
- Regenerate: `src/types/database.types.ts`

- [ ] **Step 1: Create the migration**

Generate a correctly-timestamped file (do NOT hand-pick the timestamp):

```bash
supabase migration new cell_values_board_id_idx
```

Put this in the new file:

```sql
-- cell_values is read in bulk filtered by board_id (getBoardPayload), but only
-- org_id and column_id were indexed. Add the board_id index for the hot path.
create index if not exists cell_values_board_id_idx
  on public.cell_values (board_id);
```

- [ ] **Step 2: Apply locally and verify the plan uses the index**

Run: `supabase db reset` (or `supabase migration up`)
Then verify with `supabase db` SQL (or the SQL editor):

```sql
explain analyze
select * from public.cell_values where board_id = '00000000-0000-0000-0000-000000000000';
```

Expected: the plan shows `Index Scan using cell_values_board_id_idx` (not `Seq Scan`). Note: on an empty table Postgres may still pick a seq scan — confirm against a board with data, or accept the index exists via `\d cell_values`.

- [ ] **Step 3: Regenerate types (no schema-shape change expected, but keep the workflow honest)**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` unchanged or trivially reordered (an index doesn't alter the row type). If it changes, commit it — stale types are the documented `any`-creep source (AGENTS.md).

- [ ] **Step 4: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ src/types/database.types.ts
git commit -m "perf(db): add cell_values(board_id) index for board reads"
```

---

## Task 7: Memoize CalendarBoard + GanttBoard derivations (assess at execution)

Phase 3b added `CalendarBoard.tsx` (~526 lines) and `GanttBoard.tsx` (~776 lines) — large client components that read the board cache and almost certainly compute per-render derivations (date bucketing, dependency edges, lane layout). Since React Compiler is off, these have the same un-memoized-derivation risk this plan addresses for Table/Kanban.

**This task is exploratory:** before writing code, read both files and identify expensive derivations recomputed every render (grouping/mapping/sorting/edge-building over `items`/`cellValues`/dependencies, or per-row/per-cell linear scans). For each one found:

- [ ] **Step 1:** List the concrete derivations (file:line + what it computes) and whether each is already `useMemo`'d. If everything is already memoized, report that and **skip the rest of this task** — do not add no-op memos.
- [ ] **Step 2:** For each genuinely expensive, unmemoized derivation, wrap it in `useMemo` with correct deps, and replace any per-item `cellValues.find(...)` with the shared `buildCellMap`/`cellKey` helpers (Task 1) — mirroring Tasks 2 and 3.
- [ ] **Step 3:** Run `pnpm vitest run src/components/boards && pnpm typecheck && pnpm lint`. Expected: PASS (behavior unchanged — the new view tests are the regression guard).
- [ ] **Step 4:** Commit: `git commit -m "perf(boards): memoize Calendar/Gantt derivations"` (only if changes were made).

> Scope guard: do NOT refactor Calendar/Gantt structure or behavior — memoization and shared-helper reuse only. If a derivation needs structural change to memoize safely, report it as a concern instead of forcing it.

---

## Final Verification

- [ ] **Run the full gate** (the project's definition of "done" per AGENTS.md):

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: typecheck clean, lint 0 errors, all Vitest green, build succeeds.

- [ ] **Manual smoke** (documented): switch Table↔Kanban several times — instant, no network refetch (already true after `609227e`), realtime channel not re-opened (Task 4), large Kanban columns scroll smoothly (Task 5).

- [ ] **Wrap up:** run `/wrapup` to log a session note and bump the north-star.

---

## Notes / Out of Scope

- **Bounded/paginated `cell_values` + items reads** for very large boards (windowed server fetch) is deliberately NOT in this plan — it's a larger design change (cursor/range over the EAV table, partial-cache hydration) and should get its own spec if board sizes warrant it. Task 6 adds only the index.
- **Keeping both views mounted** (display-toggle instead of conditional render) to avoid cross-kind remount entirely was considered and rejected: it doubles mounted DOM/hook cost for a rare action. Task 4 (hoisting realtime) captures the main benefit — the expensive subscription survives the switch — without that cost.
