# Board Table Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI tasks (1, 2, 3, 5, 6) must load the project `pulse-ui` skill and the `frontend-design` skill before touching markup.

**Goal:** Make the board Table view readable and dense: names readable in place (and in full on hover), one sticky column header, slim sticky group rows, 28px rows, columns that fit their content, centered value columns.

**Architecture:** Row height comes from one hook (`useRowHeight`, over the existing `useCoarsePointer`) that both the row markup and the virtualizer read. The per-group column header is replaced by one `BoardColumnHeader` rendered as the first child of the scroller's content; `GroupHeaderRow` becomes a slim sticky divider. Value-column widths resolve as `liveWidths[id] ?? column.width ?? autoFit[id] ?? 180`, where `autoFit` comes from a pure `fitColumnWidth` function fed by an offscreen canvas, exactly like the Name column today. All new server work is one nullable field on an existing action plus one new action; **no migration**.

**Tech Stack:** Next.js 16 App Router (client components only in this plan), React 19, Tailwind v4 (`@theme inline`), TanStack Query + TanStack Virtual, dnd-kit, Zod 4, Supabase (RLS), Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-14-board-table-density-design.md`

**Worktree:** `/Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/board-table-density` (branch `task/board-table-density`). Every path below is relative to it. Every Bash call starts with `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/board-table-density &&`.

## Global Constraints

1. **Implementers never touch git state and never finish the task.** No `git add`, `git commit`, `git stash`, `git checkout`, `git rebase`, `git push`, no `scripts/finish-task.sh`, no `scripts/start-task.sh`. The orchestrator commits by path after reviewing each task, runs the whole-branch review, does the browser verification below, and runs `finish-task.sh`. Every task ends with a **Hand back** step, never a commit step.
2. **Foreground only.** Every command runs in the foreground with `timeout: 600000`. Test commands are `pnpm vitest run --project unit <paths>` (the `unit` project owns every `*.test.ts(x)` in this plan). Never `pnpm test:watch`.
3. **Each task leaves these green on its own:** `pnpm typecheck`, `pnpm lint`, and the test files the task names. The orchestrator runs the full `pnpm test` and `pnpm build` once per batch.
4. **No migration, no database writes.** `columns.width` is already nullable and its CHECK already admits null (see "Checked facts"). Nobody in this plan runs `scripts/new-migration.sh`, the `supabase-dev` MCP, or `pnpm db:types`. `src/types/database.types.ts` is not edited.
5. **Semantic tokens only.** No raw Tailwind colors. Hairlines brighten (`border-border-bright`), never thicken. No new box-shadows, with one named exception: `shadow-panel` on the hover peek (Task 2). No arbitrary pixel text sizes (`text-[13px]` fails `scripts/check-px-text.mjs`, which is part of `pnpm lint`).
6. **Coarse pointers keep 44px targets and today's in-flow layout.** Every control that carries `pointer-coarse:size-11` / `pointer-coarse:opacity-100` today keeps those exact classes. The four "BoardTable touch targets (coarse pointer)" tests in `src/components/boards/BoardTable.test.tsx` pass **unchanged** after every task.
7. **Never pass `text-cell`, `text-item` or `text-group` through `cn()` together with a text-color class.** tailwind-merge 3.6 classifies these custom size tokens as colors and drops one of the two (`src/components/boards/text-size-token-cn-merge.test.ts`). Compose them with a template string outside `cn()`.
8. **Tailwind only emits classes that appear literally in source.** Never build a class name by interpolation. Shared class recipes are exported string literals.
9. **`cells/index.tsx` (`CellRenderer` and friends) is shared with Kanban and Calendar** (`KanbanBoard.tsx:56`, `calendar/CalendarAgenda.tsx:14`). This plan does not edit it. Table-only changes go on the table's cell wrappers.
10. **Reuse canonical modules.** Server actions return `ActionResult` and fail with `fail()` from `src/lib/actions/result.ts`. Coarse-pointer detection is `useCoarsePointer` from `src/lib/hooks/use-coarse-pointer.ts`. Hydration gating is `useHydrated` from `src/lib/hooks/use-hydrated.ts`. Drag-width clamping is `clampDragWidth` from `src/lib/boards/name-column-width.ts`. The "done" rule is `isStatusValueComplete` from `src/lib/boards/overdue.ts`. Grep before writing any helper.
11. **Product name in UI copy is Monolith.** Never "Pulse".
12. **jsdom renders no layout.** Tests in this plan assert behaviour, attributes, class presence and inline styles. They do not assert computed CSS, stacking, scroll sizes or measured widths. Everything geometric is listed under "Browser verification (orchestrator)" and is checked there.
13. Do not edit anything under `e2e/`, `vault/`, `supabase/`, or `.claude/`.

## Checked facts (the spec's "the plan checks" items, answered)

**(a) `columns.width` and null.** `supabase/migrations/20260617120000_columns_width.sql` lines 5–6: `add column width integer check (width is null or (width between 80 and 1200));`. `src/types/database.types.ts` line 1552: `width: number | null` (Insert/Update: `width?: number | null`). Null is allowed. **No migration.** Consequence: the auto-fit floor of 72px is a _rendered_ width only and is never persisted; a persisted width is still 80–1200 (`resizeColumnSchema`, `ColumnHeader`'s `MIN = 80`).

**(b) The board's "done" rule.** `isStatusValueComplete(value, statusColumn)` in `src/lib/boards/overdue.ts` (lines 47–62), applied to the board's first status column from `firstStatusColumn(columns)` (lines 29–38): complete ⇔ the item's option label in that column matches `/done|complete/i`. Board Intelligence's overdue signal calls exactly these two at `src/lib/boards/intelligence/signals.ts` lines 81–83. `BoardTableInner` already resolves the column once (`statusColumn`, line 289) and threads it as `controls.statusColumn`. The group progress meter uses the same pair.

**(c) Sticky z-indexes in the board scroller.**

| Element                                         | File                                                    | Today                    | After this plan                                                                   |
| ----------------------------------------------- | ------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| Frozen Name cell (item, subitem, both branches) | `table/NameCell.tsx:84,134`                             | `z-10`                   | `z-10`; `z-30` while its hover peek is open (row-local)                           |
| Frozen Name cell of rollup row                  | `table/GroupRollupRow.tsx:47`                           | `z-10`                   | `z-10`                                                                            |
| Frozen Name cell of summary rows                | `SummaryRow.tsx:243`                                    | `z-10`                   | `z-10`                                                                            |
| Frozen group/Name cell of the group header      | `table/GroupHeaderRow.tsx:130`                          | `z-10`                   | removed (the group row is no longer a grid)                                       |
| Row hairline `::before`                         | `table/shared.ts:214` (`ROW_HAIRLINE`)                  | `before:z-20`            | `before:z-20`                                                                     |
| Intel rule / intel match `::after`              | `globals.css` (`.intel-rule`, `.intel-match::after`)    | `z-index: 20`            | `20`                                                                              |
| Dragged item / subitem row                      | `ItemRow.tsx:267`, `SortableSubitemRow.tsx:169`         | `relative z-10`          | unchanged                                                                         |
| Dragged group section                           | `table/GroupSection.tsx:248`                            | `relative z-20`          | unchanged                                                                         |
| Presence ring / flash inside a cell             | `presence/PresenceRing.tsx:44`, `FlashHighlight.tsx:32` | `z-10`                   | unchanged                                                                         |
| **Group row (sticky under the header)**         | `table/GroupHeaderRow.tsx`                              | not sticky               | **`sticky top-[30px] z-30`** (`pointer-coarse:top-11`)                            |
| **Board column header (sticky top)**            | `table/BoardColumnHeader.tsx` (new)                     | n/a                      | **`sticky top-0 z-40`**; its frozen "Item" cell is `sticky left-0 z-10` inside it |
| **Board Total (sticky bottom)**                 | `SummaryRow.tsx:230`                                    | `sticky bottom-0 z-[15]` | **`sticky bottom-0 z-[45]`**                                                      |
| Portalled menus, popovers, dialogs              | Radix                                                   | `z-50`                   | `z-50`                                                                            |

Each virtual row wrapper is positioned with a transform (`GroupSection.tsx:350`), so it is its own stacking context and the `z-10`/`z-20`/`z-30` inside a row never escape it. Order, bottom to top: rows → group row 30 → column header 40 → board total 45 → menus 50.

**(d) Things taller than 24px that render inside a 28px row, and what each becomes.**

| Control                             | File:line                          | Today        | Becomes                                      | Task |
| ----------------------------------- | ---------------------------------- | ------------ | -------------------------------------------- | ---- |
| Number / percent editor `Input`     | `cells/editors/index.tsx:111,141`  | `h-8` (32px) | `h-6` (24px), `pointer-coarse:h-8`           | 1    |
| Currency editor wrapper + `Input`   | `cells/editors/index.tsx:166,178`  | `h-8`        | `h-6`, `pointer-coarse:h-8`                  | 1    |
| Checkbox editor wrapper             | `cells/editors/index.tsx:373`      | `h-8`        | `h-6`, `pointer-coarse:h-11`                 | 1    |
| Email / phone editor `Input`        | `cells/editors/index.tsx:514`      | `h-8`        | `h-6`, `pointer-coarse:h-8`                  | 1    |
| Name rename `Input`                 | `table/NameCell.tsx:111`           | `h-7` (28px) | `h-6`, `pointer-coarse:h-8`                  | 2    |
| Open-panel button                   | `table/NameCell.tsx:234`           | `size-7`     | `size-6` (coarse stays `size-11`)            | 2    |
| Add-subitem button                  | `table/ItemRow.tsx:246`            | `size-7`     | `size-6` (coarse stays `size-11`)            | 2    |
| Row menu trigger                    | `table/RowMenu.tsx:45`             | `size-7`     | `size-6` (coarse stays `size-11`)            | 2    |
| Group rename `Input`                | `table/GroupHeaderRow.tsx:182`     | `h-7`        | `h-6`, `pointer-coarse:h-8` (30px group row) | 3    |
| Group drag handle, collapse chevron | `table/GroupHeaderRow.tsx:141,150` | `size-7`     | `size-6` (coarse stays `size-11`)            | 3    |

Already 24px or less, unchanged: `MemberAvatar` (`size-6`, 24px; its stack ring is a box-shadow in the surface color and takes no layout), the "+N" disc (`size-6`), `CreatedByCell` avatar (`size-5`), `ColorChip` / `StatusPill` (20px), `FilesCell` thumbnail button (`h-6`), `RelationCell` chips and add button (`size-5`), `TimeTrackingCell` collapsed trigger (`py-0.5`), rating stars (`size-3.5`), checkbox box (`size-4`), `PercentBar` (`h-1.5`), row select checkbox (`size-6` → `size-5` in Task 2 for the gutter, not for height), row drag handle (`size-6` → `h-6 w-4` in Task 2). The link editor, status / dropdown / people / date / rating / long-text editors are popovers and are not constrained by the row.

Note: the spec says "inline editors that are 28px tall (`h-7`)". The inline cell editors are in fact `h-8` (32px); the two `h-7` inputs are the Name rename and the group rename. All of them go to 24px.

## Spec corrections made by this plan

These are places where the real code forced a different mechanism than the spec describes. Each is implemented as written here.

1. **Type sizes are not changed by editing the two tokens.** `text-cell` is used by `cells/index.tsx`, which Kanban and Calendar also render, and the theme block is `@theme inline`, so the value is baked into the utility. Changing `--text-cell` would shrink Kanban and Calendar text (a spec non-goal). Task 1 changes `--text-item` (only the table uses it) to 13px and adds a table-scoped rule `[data-board-table] .text-cell { font-size: 0.78125rem }`. The scroller gets `data-board-table`.
2. **The group title needs its own size token.** The spec wants 13.5px for group titles and 13px for item names, and both use `text-item` today. Task 3 adds `--text-group: 0.84375rem`.
3. **Centering is applied on the table's cell wrappers, not in `cells/index.tsx`** (shared, see Global Constraint 9). A wrapper gets `justify-center text-center *:justify-center`; `text-align` inherits into the truncating span.
4. **"Coarse rows stay at 44px"** is not today's behaviour: rows are 42px (subitems 38px) for every pointer today. This plan makes coarse rows 44px for both item and subitem rows, which is what the 44px targets need.
5. **`ColumnHeader` persists a width on a plain click today** (`up()` always calls `onResizeEnd(last)`; a test asserts it). With auto-fit that would pin every column the user merely clicks, and a 72px fitted column would fail the 80px validation and toast an error. Task 5 makes a click without a move persist nothing; the existing test is updated.
6. **`liveWidths[id]` is never cleared after a drag today**, so it would mask a later reset. Task 5 clears it on double-click reset and on "Fit all columns".
7. **U5 is split into two tasks** (Task 5 fit UI, Task 6 centering). They are independently acceptable (the spec's open question is about centering only), and together they would touch 14 files.
8. **The dependency graph differs from the spec's.** Task 6 also depends on Task 2, because both edit `ItemRow.tsx` / `SortableSubitemRow.tsx`, and Task 5 must precede Task 6 (three shared files). See the Execution DAG.
9. **`resetColumnWidths` is a board write first.** It updates `boards.name_column_width` with `.select("id").maybeSingle()` and fails closed when no row comes back (a viewer or another tenant under RLS), then clears `columns.width` for that `board_id` (index `columns_board_id_idx`).

---

### Task 1: Dense rows (row-height source, type sizes, cell padding, inline editors)

**Files:**

- Create: `src/components/boards/table/use-row-height.ts`
- Create: `src/components/boards/table/use-row-height.test.ts`
- Modify: `src/components/boards/table/shared.ts` (lines 174–178, 222–223)
- Modify: `src/app/globals.css` (line 90; new block after the Board Intelligence `@layer utilities` block, before the "Folder command center → Export PDF" comment)
- Modify: `src/components/boards/table/BoardTableInner.tsx` (line 811, one attribute)
- Modify: `src/components/boards/table/ItemRow.tsx` (imports 30–36; lines 271–276, 339, 346)
- Modify: `src/components/boards/table/SortableSubitemRow.tsx` (imports 27–33; lines 158–165, 221, 228)
- Modify: `src/components/boards/table/GroupRollupRow.tsx` (lines 12, 36–43)
- Modify: `src/components/boards/table/GroupSection.tsx` (imports 32–38; lines 188–197, 289)
- Modify: `src/components/boards/table/EditableCell.tsx` (lines 101, 121, 140, 205, 221, 275)
- Modify: `src/components/boards/RollupValueCell.tsx` (line 20)
- Modify: `src/components/boards/cells/editors/index.tsx` (lines 111, 141, 166, 178, 373, 514)
- Modify: `src/app/(app)/boards/[boardId]/loading.tsx` (comment, line 10)
- Modify: `src/components/boards/cells/member-avatar.tsx` (comment, line 22)
- Test: `src/components/boards/table/shared.test.ts`, `src/components/boards/BoardTable.test.tsx`, `src/components/boards/cells/editors/editors.test.tsx`

**Interfaces:**

- Consumes: `useCoarsePointer(): boolean` from `@/lib/hooks/use-coarse-pointer`.
- Produces:
  - `ROW_HEIGHT = 28`, `SUBITEM_ROW_HEIGHT = 26`, `COARSE_ROW_HEIGHT = 44`, `NAME_MEASURE_FONT_SIZE = "13px"` from `table/shared.ts`.
  - `useRowHeight(): RowHeights` and `type RowHeights = { item: number; subitem: number }` from `table/use-row-height.ts`. Returns one of two module-level constants, so the identity is stable per pointer type.
  - `data-board-table` on the board scroller (`data-testid="board-scroll"`).
  - CSS: `--text-item` is 13px; `[data-board-table] .text-cell` is 12.5px.
  - Value-cell wrappers pad `px-2` (8px).

**Existing tests this task breaks on purpose** (updated in Step 1): `shared.test.ts` → "uses 42px item rows and 38px subitem rows", "measures the name column with the rendered name font", and the `13.5px` assertion inside "resolves the LIVE --font-inter family". Nothing else: `SubitemThread.test.tsx` compares against the `SUBITEM_ROW_HEIGHT` constant and `loading.test.tsx` does not assert a height.

- [ ] **Step 1: Write the failing tests for the height source and the type sizes**

Create `src/components/boards/table/use-row-height.test.ts`:

```ts
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Same shape as the `searchParamsOverride` mock in BoardTable.test.tsx: the
// factory closes over a mutable flag that is read at call time.
let coarse = false;
vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: () => coarse,
}));

import { COARSE_ROW_HEIGHT, ROW_HEIGHT, SUBITEM_ROW_HEIGHT } from "./shared";
import { useRowHeight } from "./use-row-height";

describe("useRowHeight", () => {
  beforeEach(() => {
    coarse = false;
  });

  it("returns the dense heights on a fine pointer", () => {
    const { result } = renderHook(() => useRowHeight());
    expect(result.current).toEqual({
      item: ROW_HEIGHT,
      subitem: SUBITEM_ROW_HEIGHT,
    });
  });

  it("returns 44px for item and subitem rows on a coarse pointer", () => {
    coarse = true;
    const { result } = renderHook(() => useRowHeight());
    expect(result.current).toEqual({
      item: COARSE_ROW_HEIGHT,
      subitem: COARSE_ROW_HEIGHT,
    });
    expect(COARSE_ROW_HEIGHT).toBe(44);
  });

  it("keeps one object identity per pointer type across renders", () => {
    const { result, rerender } = renderHook(() => useRowHeight());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
```

In `src/components/boards/table/shared.test.ts`, the second import block (currently lines 155–161) becomes:

```ts
import {
  COARSE_ROW_HEIGHT,
  ROW_HEIGHT,
  SUBITEM_ROW_HEIGHT,
  NAME_MEASURE_FONT,
  NAME_MEASURE_FONT_SIZE,
  buildNameMeasureFont,
  ROW_HAIRLINE,
} from "./shared";
```

Replace the first two tests of `describe("Quiet Grid geometry", …)` (currently lines 164–175) with:

```ts
it("uses 28px item rows and 26px subitem rows, 44px on coarse pointers", () => {
  expect(ROW_HEIGHT).toBe(28);
  expect(SUBITEM_ROW_HEIGHT).toBe(26);
  expect(COARSE_ROW_HEIGHT).toBe(44);
});

it("measures the name column with the rendered name font", () => {
  // A drifted measurer silently mis-sizes the frozen column; typecheck and
  // jsdom both stay green, so this string is asserted explicitly.
  expect(NAME_MEASURE_FONT).toContain("13px");
  expect(NAME_MEASURE_FONT).toContain("Inter");
  expect(NAME_MEASURE_FONT).not.toContain("13.5px");
});

it("keeps the measuring size in step with the --text-item token", () => {
  // NameCell renders item names with `text-item`. The token lives in
  // globals.css as rem; the canvas measurer needs px. Read the real token so
  // changing one without the other fails here.
  const css = fs.readFileSync(
    path.join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );
  const token = css.match(/--text-item:\s*([\d.]+)rem/);
  expect(token).not.toBeNull();
  expect(`${Number(token![1]) * 16}px`).toBe(NAME_MEASURE_FONT_SIZE);
});

it("scopes the 12.5px cell size to the board table and leaves the shared token alone", () => {
  // `text-cell` also renders in Kanban cards and the Calendar agenda (via
  // CellRenderer). Only the table goes to 12.5px.
  const css = fs.readFileSync(
    path.join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );
  expect(css).toMatch(/--text-cell:\s*0\.8125rem/);
  const scoped = css.match(
    /\[data-board-table\]\s+\.text-cell\s*\{\s*font-size:\s*([\d.]+)rem/,
  );
  expect(scoped).not.toBeNull();
  expect(Number(scoped![1]) * 16).toBe(12.5);
});
```

In the same file, inside `describe("buildNameMeasureFont", …)`, change `expect(font).toContain("13.5px");` to `expect(font).toContain("13px");`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run --project unit src/components/boards/table/use-row-height.test.ts src/components/boards/table/shared.test.ts`

Expected: FAIL. `use-row-height.test.ts` fails to resolve `./use-row-height`; `shared.test.ts` fails on `expected 42 to be 28`, on `COARSE_ROW_HEIGHT` being undefined, and on the missing `[data-board-table] .text-cell` rule.

- [ ] **Step 3: Implement the height source and the type sizes**

`src/components/boards/table/shared.ts`, replace lines 174–178:

```ts
/**
 * Item-row height on a fine pointer (mouse / trackpad). Dense 28 (was 42).
 * Do not read this in a component: rows and the virtualizer take their height
 * from `useRowHeight()` (./use-row-height), which returns COARSE_ROW_HEIGHT on
 * touch. This constant is the fine-pointer value and the SSR / skeleton value.
 */
export const ROW_HEIGHT = 28;

/** Subitem rows sit one step tighter than their parent. */
export const SUBITEM_ROW_HEIGHT = 26;

/**
 * Row height on a coarse pointer, for item AND subitem rows: the row controls
 * are 44px targets there (`pointer-coarse:size-11`) and cannot fit in less.
 */
export const COARSE_ROW_HEIGHT = 44;
```

Same file, line 223: `export const NAME_MEASURE_FONT_SIZE = "13px";`. The comment above it (lines 216–221) stays as written; it is still true.

Create `src/components/boards/table/use-row-height.ts`:

```ts
"use client";

import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import { COARSE_ROW_HEIGHT, ROW_HEIGHT, SUBITEM_ROW_HEIGHT } from "./shared";

export type RowHeights = { item: number; subitem: number };

const FINE: RowHeights = { item: ROW_HEIGHT, subitem: SUBITEM_ROW_HEIGHT };
const COARSE: RowHeights = {
  item: COARSE_ROW_HEIGHT,
  subitem: COARSE_ROW_HEIGHT,
};

/**
 * The one source of row height for the board table. Row markup sets it as an
 * inline `height`, and the virtualizer's `estimateSize` reads the same value,
 * so the two cannot drift. Fine pointers get the dense 28 / 26; coarse
 * pointers get 44 for both. `useCoarsePointer` reports `false` on the server
 * and during hydration, so the first paint is the dense layout and a touch
 * device re-renders once to 44 (rows are still measured by `measureElement`).
 */
export function useRowHeight(): RowHeights {
  return useCoarsePointer() ? COARSE : FINE;
}
```

`src/app/globals.css`, line 90 becomes:

```css
--text-item: 0.8125rem; /* 13px — board table item names (was 13.5px) */
```

Leave line 89 (`--text-cell: 0.8125rem;`) exactly as it is, but change its comment to `/* 13px — cell text in Kanban + Calendar; the board table scopes it to 12.5px below */`.

Same file: immediately after the closing `}` of the Board Intelligence `@layer utilities { … }` block (the block that ends with `.intel-miss { opacity: 0.35; }`), and before the `/* Folder command center → Export PDF` comment, add:

```css
/* Board table density (2026-11-14). The dense table renders cell text at
   12.5px. `text-cell` cannot simply change: the same class is emitted by the
   shared cell renderers that Kanban cards and the Calendar agenda use, and
   this theme is `@theme inline`, so the value is baked into the utility
   rather than read from a variable. The board scroller carries
   [data-board-table]; inside it, and only there, the cell size steps down.
   Same layer as the utility, higher specificity, so it wins. */
@layer utilities {
  [data-board-table] .text-cell {
    font-size: 0.78125rem; /* 12.5px */
  }
}
```

`src/components/boards/table/BoardTableInner.tsx`, in the scroller's opening tag (currently lines 808–812), add one attribute after `data-scroll-container`:

```tsx
        data-testid="board-scroll"
        data-scroll-container
        data-board-table
        data-scrolledx={scrolledX}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm vitest run --project unit src/components/boards/table/use-row-height.test.ts src/components/boards/table/shared.test.ts`

Expected: PASS (all tests in both files).

- [ ] **Step 5: Write the failing tests for the consumers**

Append to the end of `src/components/boards/BoardTable.test.tsx` (it reuses that file's existing helpers `renderBoard`, `renderTwoItems` and `renderBoardWithColumns`):

```tsx
describe("BoardTable density", () => {
  it("marks the scroller as the dense board table", () => {
    // globals.css scopes the 12.5px cell size to this attribute.
    renderBoard();
    expect(screen.getByTestId("board-scroll")).toHaveAttribute(
      "data-board-table",
    );
  });

  it("renders item rows at 28px on a fine pointer", () => {
    renderTwoItems();
    const row = screen
      .getByRole("button", { name: "Reorder Task One" })
      .closest("[data-intel-rule='cell']") as HTMLElement;
    expect(row.style.height).toBe("28px");
  });

  it("pads value cells to 8px", () => {
    renderBoardWithColumns();
    const cell = screen.getByLabelText("Item 1 Status");
    expect(cell.className).toContain("px-2");
    expect(cell.className).not.toContain("px-4");
  });
});
```

Append to the end of `src/components/boards/cells/editors/editors.test.tsx` (it already imports `NumbersEditor`, `render`, `screen`, `vi`):

```tsx
describe("inline cell editors — dense rows", () => {
  it("NumbersEditor is 24px so it fits a 28px row, and 32px on coarse", () => {
    render(
      <NumbersEditor
        value={{ n: 3 }}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByRole("spinbutton");
    const classes = input.className.split(/\s+/);
    expect(classes).toContain("h-6");
    expect(classes).not.toContain("h-8");
    expect(classes).toContain("pointer-coarse:h-8");
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run: `pnpm vitest run --project unit src/components/boards/BoardTable.test.tsx src/components/boards/cells/editors/editors.test.tsx -t "density|dense rows"`

Expected: FAIL. The row height test fails with `expected '28px'` only if Step 3 is missing; with Step 3 done it already passes, and the two that fail are "pads value cells to 8px" (`px-4` still present) and "NumbersEditor is 24px" (`h-8` still present).

- [ ] **Step 7: Move every consumer onto the hook, the 8px padding and the 24px editors**

`src/components/boards/table/ItemRow.tsx`:

- Import list from `./shared` (lines 30–36): remove `ROW_HEIGHT`. Add `import { useRowHeight } from "./use-row-height";` below it.
- First line of the component body (before `const [rollupNowMs]`, line 146): `const rowHeight = useRowHeight();`
- Line 272: `height: ROW_HEIGHT,` → `height: rowHeight.item,`
- Lines 339 and 346: `className="flex h-full items-center px-4"` → `className="flex h-full min-w-0 items-center px-2"` (both).

`src/components/boards/table/SortableSubitemRow.tsx`:

- Import list from `./shared` (lines 27–33): remove `SUBITEM_ROW_HEIGHT`. Add `import { useRowHeight } from "./use-row-height";`.
- First line of the component body (before `const [todayISO]`, line 103): `const rowHeight = useRowHeight();`
- Line 163: `height: SUBITEM_ROW_HEIGHT,` → `height: rowHeight.subitem,`
- Lines 221 and 228: `className="flex h-full items-center px-4"` → `className="flex h-full min-w-0 items-center px-2"` (both), the same string as in `ItemRow`.

`src/components/boards/table/GroupRollupRow.tsx`:

- Line 12: `import { ROW_HAIRLINE } from "./shared";` and add `import { useRowHeight } from "./use-row-height";`.
- After `const [nowMs] = useState(() => Date.now());` (line 36): `const rowHeight = useRowHeight();`
- Line 43: `style={{ height: rowHeight.item, gridTemplateColumns: template }}`

`src/components/boards/table/GroupSection.tsx`:

- Import list from `./shared` (lines 32–38): remove `ROW_HEIGHT`. Add `import { useRowHeight } from "./use-row-height";`.
- After `const [scrollMargin, setScrollMargin] = useState(0);` (line 118): `const rowHeight = useRowHeight();`
- Lines 188–197 become:

```tsx
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => scrollContainerRef.current,
  scrollMargin,
  // Same source as the rows' own inline height (see ./use-row-height).
  estimateSize: () => rowHeight.item,
  overscan: 6,
  // getBoundingClientRect().height returns 0 in jsdom — fall back to the
  // row height so tests don't collapse all virtual rows to 0px height.
  measureElement: (el) => el.getBoundingClientRect().height || rowHeight.item,
});
```

- Line 289: `style={items.length === 0 ? { minHeight: rowHeight.item } : undefined}`

`src/components/boards/table/EditableCell.tsx`: in the six wrapper class strings at lines 101, 121, 140, 205, 221 and 275, replace `px-4` with `px-2`. Leave line 170 (`px-1`, the relation cell) as it is. Nothing else changes in this file.

`src/components/boards/RollupValueCell.tsx`, line 20: `const CELL_CLASS = "flex h-full items-center truncate px-2";`

`src/components/boards/cells/editors/index.tsx` (these editors are rendered only by `table/EditableCell.tsx`):

- Line 111 (`NumbersEditor`) and line 141 (`PercentEditor`): `className="h-8 tabular-nums"` → `className="h-6 px-1.5 text-xs tabular-nums md:text-xs pointer-coarse:h-8"`
- Line 166 (`CurrencyEditor` wrapper): `className="flex h-8 items-center gap-1.5"` → `className="flex h-6 items-center gap-1.5 pointer-coarse:h-8"`
- Line 178 (`CurrencyEditor` input): same string as lines 111/141.
- Line 373 (`CheckboxEditor` wrapper): `className="flex h-8 items-center px-1"` → `className="flex h-6 items-center px-1 pointer-coarse:h-11"`
- Line 514 (`TextLikeEditor` input, used by email and phone): `className="h-8"` → `className="h-6 px-1.5 text-xs md:text-xs pointer-coarse:h-8"`
- Lines 450 and 458 (`LinkEditor`, inside a popover) stay `h-8`.

`md:text-xs` is deliberate: `Input`'s base class carries `md:text-sm`, which tailwind-merge does not remove for an unprefixed `text-xs`.

`src/app/(app)/boards/[boardId]/loading.tsx`, line 10: replace "dense `ROW_HEIGHT` (36px) rows" with "dense `ROW_HEIGHT` (28px) rows". The file keeps importing the `ROW_HEIGHT` constant: it is a Server Component and the skeleton paints the fine-pointer layout, the same as the server render of the real table.

`src/components/boards/cells/member-avatar.tsx`, line 22: replace the comment with `/** 24px — fits the dense 28px board row with 2px to spare top and bottom. */`

- [ ] **Step 8: Run the touched suites, typecheck and lint**

Run: `pnpm vitest run --project unit src/components/boards/table src/components/boards/BoardTable.test.tsx src/components/boards/cells/editors/editors.test.tsx src/components/boards/RollupValueCell.test.tsx "src/app/(app)/boards/[boardId]/loading.test.tsx"`

Expected: PASS, including the four unchanged "BoardTable touch targets (coarse pointer)" tests and `SubitemThread.test.tsx` → "renders at the subitem height".

Watch one test in particular: "renders windowed rows for every group against the shared scroll container" renders 30 rows per group into a stubbed 600px viewport and expects row 30 to be virtualized out. At 28px the virtualizer mounts rows 1–28 (22 in view + 6 overscan), so it still passes, with two rows to spare. If it fails, do not raise the fixture's row count or lower `overscan` to make it pass: report it.

Run: `pnpm exec prettier --write src/components/boards/table src/components/boards/cells/editors/index.tsx src/components/boards/RollupValueCell.tsx src/app/globals.css && pnpm typecheck && pnpm lint`

Expected: both exit 0 (the `max-lines` warning on `BoardTableInner.tsx` already exists and is a warning).

- [ ] **Step 9: Hand back**

Report to the orchestrator: the files changed, the two test commands with their pass counts, and the typecheck / lint result. Do not stage, commit or stash anything.

---

### Task 2: Name cell (gutter, overlay buttons, hover peek, chrome reserves)

**Files:**

- Modify: `src/components/boards/table/NameCell.tsx` (whole component, lines 1–242)
- Modify: `src/components/boards/table/ItemRow.tsx` (imports; lines 190–258, 278–295)
- Modify: `src/components/boards/table/SortableSubitemRow.tsx` (lines 128–139, 174–190)
- Modify: `src/components/boards/table/RowSelectCheckbox.tsx` (line 32)
- Modify: `src/components/boards/table/RowMenu.tsx` (line 45)
- Modify: `src/lib/boards/name-column-width.ts` (lines 21–53, 88–103)
- Modify: `src/lib/boards/item-tree.ts` (append)
- Create: `src/components/boards/table/ItemRow.gutter.test.tsx`
- Test: `src/components/boards/table/NameCell.test.tsx`, `src/lib/boards/name-column-width.test.ts`, `src/lib/boards/item-tree.test.ts`, `src/components/boards/table/temp-row-readonly.test.tsx` (fixture only)

This task does **not** edit `BoardTableInner.tsx`, `GroupSection.tsx`, `BoardTable.test.tsx` or `globals.css`: Task 3 owns them and runs in the same batch.

**Interfaces:**

- Consumes: `useRowHeight` rows from Task 1 (28px), `useCoarsePointer(): boolean`, `controls.cache.items` (already in `CACHE_SLICES`, so a row re-renders when items change).
- Produces:
  - `boardHasSubitems(items: readonly { parent_id: string | null }[]): boolean` from `@/lib/boards/item-tree` (memoized per array identity).
  - `NameCell` prop `peekDisabled?: boolean`; export `NAME_PEEK_DELAY_MS = 200`; attributes `data-peek="true"` on the cell while the peek is open and `data-testid="name-actions"` on the buttons container; `title` on the name button.
  - `fitNameColumnWidth(items, measure, canEdit)` keeps its exact signature (so `BoardTableInner.tsx` is untouched) and now returns smaller widths. New exported constants: `TOP_LEVEL_CHROME_EDITOR = 53`, `TOP_LEVEL_CHROME_VIEWER = 33`, `SUBITEM_SLOT_CHROME = 48`, `SUBITEM_CHROME = 69`.

**Layout this task builds** (fine pointer, left to right, top-level row): cell `pl-1` (4px, keeps the 2px hover seam and 3px selected bar clear of the handle) · drag handle 16px · select checkbox 20px (editors only) · chevron slot 20px (only when the board has at least one subitem) + "(n)" count on rows that have children · name `pl-1` 4px · text · name `pr-2` 8px. The open-panel, add-subitem and row-menu buttons no longer take width: they sit in an absolutely positioned container at the cell's right edge over a 20px fade to the cell's own background, visible on row hover and on keyboard focus within. Subitem row: cell `pl-1` · drag handle 16px · name `pl-10` (unchanged; the thread line stays at `left-[26px]`).

On a coarse pointer the same container is `static` (in flow), always visible, with the 44px buttons, exactly as today.

**Existing tests this task breaks on purpose** (updated below): every `fitNameColumnWidth` test in `name-column-width.test.ts` (the three chrome numbers change); `temp-row-readonly.test.tsx` renders `ItemRow` with a `cache` that has no `items`, which the new `boardHasSubitems(controls.cache.items)` read needs. `NameCell.test.tsx`'s existing six tests keep passing; the first one's title is corrected. `SubitemThread.test.tsx` passes unchanged (`pl-10`, `left-[26px]`, `text-cell` all stay).

- [ ] **Step 1: Write the failing tests for the pure pieces**

Append to `src/lib/boards/item-tree.test.ts` (uses that file's existing `item(id, parent, position)` helper; add `boardHasSubitems` to its import from `./item-tree`):

```ts
describe("boardHasSubitems", () => {
  it("is false for a board with only top-level items", () => {
    expect(boardHasSubitems([item("a", null, 1), item("b", null, 2)])).toBe(
      false,
    );
  });

  it("is true as soon as one item has a parent", () => {
    expect(boardHasSubitems([item("a", null, 1), item("a1", "a", 1)])).toBe(
      true,
    );
  });

  it("is false for an empty board", () => {
    expect(boardHasSubitems([])).toBe(false);
  });

  it("answers per array, so a new items array is re-read", () => {
    const before = [item("a", null, 1)];
    expect(boardHasSubitems(before)).toBe(false);
    const after = [...before, item("a1", "a", 1)];
    expect(boardHasSubitems(after)).toBe(true);
    expect(boardHasSubitems(before)).toBe(false);
  });
});
```

In `src/lib/boards/name-column-width.test.ts`, replace everything from the `// The real, measured chrome reserves…` comment (line 13) through the end of `describe("fitNameColumnWidth", …)` (line 98) with the block below, and extend the import at the top with `SUBITEM_CHROME`, `SUBITEM_SLOT_CHROME`, `TOP_LEVEL_CHROME_EDITOR`, `TOP_LEVEL_CHROME_VIEWER`. Leave `describe("clampDragWidth", …)` untouched.

```ts
describe("name-cell chrome reserves", () => {
  it("are the dense gutter sums, with no hover buttons in them", () => {
    // cell pl-1 (4) + drag handle w-4 (16) + checkbox size-5 (20)
    // + name pl-1 + pr-2 (12) + NAME_FREEZE_RULE border (1)
    expect(TOP_LEVEL_CHROME_EDITOR).toBe(53);
    // same, without the checkbox
    expect(TOP_LEVEL_CHROME_VIEWER).toBe(33);
    // chevron size-5 (20) + "(n)" label: ml-1 (4) + up to "(99)" (24)
    expect(SUBITEM_SLOT_CHROME).toBe(48);
    // cell pl-1 (4) + drag handle (16) + name pl-10 (40) + pr-2 (8) + border (1)
    expect(SUBITEM_CHROME).toBe(69);
  });
});

describe("fitNameColumnWidth", () => {
  it("clamps a short subitem name to the floor", () => {
    // "abcdef" → 42px text + 69px subitem chrome = 111 < NAME_COL_MIN (180)
    expect(
      fitNameColumnWidth([{ name: "abcdef", indented: true }], measure, true),
    ).toBe(NAME_COL_MIN);
  });

  it("clamps a tiny top-level name to the floor now that the hover buttons are not reserved", () => {
    // 7 + 53 = 60. Before this change the chrome alone (197) beat the floor.
    expect(fitNameColumnWidth([{ name: "a" }], measure, true)).toBe(
      NAME_COL_MIN,
    );
  });

  it("grows a top-level (editor) name by exactly text width + chrome", () => {
    const long = "x".repeat(60); // 420px text
    expect(fitNameColumnWidth([{ name: long }], measure, true)).toBe(
      420 + TOP_LEVEL_CHROME_EDITOR,
    );
  });

  it("no longer counts the three hover buttons", () => {
    // The old reserve was 197 (it held 92px open for open / add / menu).
    const name = "x".repeat(40); // 280px text
    const width = fitNameColumnWidth([{ name }], measure, true);
    expect(width).toBe(280 + 53);
    expect(width).toBeLessThan(280 + 197 - 92);
  });

  it("reserves less chrome for a viewer (no bulk-select checkbox)", () => {
    const long = "x".repeat(60);
    const editorWidth = fitNameColumnWidth([{ name: long }], measure, true);
    const viewerWidth = fitNameColumnWidth([{ name: long }], measure, false);
    expect(editorWidth - viewerWidth).toBe(20);
    expect(viewerWidth).toBe(420 + TOP_LEVEL_CHROME_VIEWER);
  });

  it("reserves the chevron slot on top-level rows only when the board has a subitem", () => {
    const long = "x".repeat(60); // 420px text
    const without = fitNameColumnWidth([{ name: long }], measure, true);
    const withSub = fitNameColumnWidth(
      [{ name: long }, { name: "s", indented: true }],
      measure,
      true,
    );
    expect(withSub - without).toBe(SUBITEM_SLOT_CHROME);
  });

  it("reserves the indented subitem chrome for a subitem-length name", () => {
    const long = "x".repeat(60); // 420px text
    expect(
      fitNameColumnWidth([{ name: long, indented: true }], measure, true),
    ).toBe(420 + SUBITEM_CHROME);
  });

  it("picks the widest across a mix of top-level and subitem names", () => {
    const items = [
      { name: "x".repeat(50), indented: false }, // 350 + 53 + 48 = 451
      { name: "x".repeat(48), indented: true }, //  336 + 69      = 405
    ];
    expect(fitNameColumnWidth(items, measure, true)).toBe(451);
  });

  it("clamps to the tighter auto-fit ceiling, not the drag-resize max", () => {
    const huge = "x".repeat(1000);
    expect(fitNameColumnWidth([{ name: huge }], measure, true)).toBe(
      NAME_COL_AUTOFIT_MAX,
    );
    expect(NAME_COL_AUTOFIT_MAX).toBeLessThan(NAME_COL_MAX);
  });

  it("falls back to the floor for no items", () => {
    expect(fitNameColumnWidth([], measure, true)).toBe(NAME_COL_MIN);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run --project unit src/lib/boards/item-tree.test.ts src/lib/boards/name-column-width.test.ts`

Expected: FAIL. `boardHasSubitems is not a function`; the chrome constants are `undefined`; `expected 204 to be 180` in the tiny-name test.

- [ ] **Step 3: Implement the pure pieces**

Append to `src/lib/boards/item-tree.ts`:

```ts
const hasSubitemsByItems = new WeakMap<object, boolean>();

/**
 * True when at least one item on the board is a subitem. Rows ask this to
 * decide whether to reserve the expand-chevron slot: on a board with no
 * subitems no row reserves it, so names start further left and still line up
 * with each other.
 *
 * Called from every visible row on every render, so the answer is memoized on
 * the items array's identity (the board cache replaces the array whenever an
 * item is added, removed or re-parented). Pure for a given array.
 */
export function boardHasSubitems(
  items: readonly { parent_id: string | null }[],
): boolean {
  let known = hasSubitemsByItems.get(items);
  if (known === undefined) {
    known = items.some((it) => it.parent_id != null);
    hasSubitemsByItems.set(items, known);
  }
  return known;
}
```

`src/lib/boards/name-column-width.ts`: replace lines 21–53 (the three chrome constants and their comments) with:

```ts
/**
 * Reserved chrome around the name text in a TOP-LEVEL row, for an editor, on a
 * fine pointer. The sum of, left to right: the cell's `pl-1` (4) + drag handle
 * `w-4` (16) + bulk-select checkbox `size-5` (20) + the name's own `pl-1` +
 * `pr-2` (4 + 8) + the permanent 1px `NAME_FREEZE_RULE` border. Total 53.
 *
 * The open-panel, add-subitem and row-menu buttons are NOT in this sum. They
 * are an overlay on the cell's right edge (see NameCell) and take no width, so
 * an auto-fitted column is as wide as its longest name needs and no wider.
 *
 * These are sums of the class widths, not a browser measurement. The
 * orchestrator confirms them against the built CSS before merge (plan:
 * "Browser verification"); if a class in NameCell / ItemRow changes, change
 * the matching number here.
 */
export const TOP_LEVEL_CHROME_EDITOR = 53;

/** Same row, for a viewer: no bulk-select checkbox (53 − 20). */
export const TOP_LEVEL_CHROME_VIEWER = 33;

/**
 * Extra reserve on top-level rows when the board has at least one subitem: the
 * chevron slot `size-5` (20) every row then carries, plus the "(n)" child
 * count a parent row shows beside it (`ml-1` 4 + up to "(99)" at 12px ≈ 24).
 * Reserved on every top-level row of such a board — a superset, like the
 * add-subitem reserve this replaces — because the fit list does not say which
 * rows are parents.
 */
export const SUBITEM_SLOT_CHROME = 48;

/**
 * Reserved chrome around the name text in a SUBITEM row: the cell's `pl-1`
 * (4) + drag handle (16) + the name's `pl-10` indent (40) + `pr-2` (8) + the
 * 1px `NAME_FREEZE_RULE` border. Total 69. The thread line is absolutely
 * positioned and takes no width.
 */
export const SUBITEM_CHROME = 69;
```

Same file, replace the body of `fitNameColumnWidth` (lines 93–102) with:

```ts
const hasSubitems = items.some((it) => it.indented === true);
const topLevelChrome =
  (canEdit ? TOP_LEVEL_CHROME_EDITOR : TOP_LEVEL_CHROME_VIEWER) +
  (hasSubitems ? SUBITEM_SLOT_CHROME : 0);
let widest = 0;
for (const { name, indented } of items) {
  const chrome = indented ? SUBITEM_CHROME : topLevelChrome;
  const w = Math.ceil(measure(name)) + chrome;
  if (w > widest) widest = w;
}
return Math.min(NAME_COL_AUTOFIT_MAX, Math.max(NAME_COL_MIN, widest));
```

Update the function's doc comment (lines 78–87): the last sentence about `canEdit` stays; add "A subitem anywhere in `items` adds the chevron-slot reserve to every top-level row (see `SUBITEM_SLOT_CHROME`)."

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm vitest run --project unit src/lib/boards/item-tree.test.ts src/lib/boards/name-column-width.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing component tests**

In `src/components/boards/table/NameCell.test.tsx`:

Replace the import lines 1–3 with:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

let coarse = false;
vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: () => coarse,
}));

import {
  NAME_PEEK_DELAY_MS,
  NameCell,
} from "@/components/boards/table/NameCell";
```

Rename the first test from `"renders the name at the 13.5px table scale"` to `"renders the name at the item-name table scale"` (its assertion is unchanged).

Append to the file:

```tsx
/** jsdom lays nothing out, so truncation is simulated on the text node. */
function setTruncated(el: HTMLElement, truncated: boolean) {
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    value: truncated ? 500 : 100,
  });
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    value: 100,
  });
}

describe("NameCell — hover buttons overlay", () => {
  beforeEach(() => {
    coarse = false;
  });

  it("takes the buttons out of the layout flow on fine pointers and keeps them in flow on coarse", () => {
    render(<NameCell item={item} controls={controls} />);
    const actions = screen.getByTestId("name-actions");
    const classes = actions.className.split(/\s+/);
    expect(classes).toContain("absolute");
    expect(classes).toContain("pointer-coarse:static");
    expect(classes).toContain("pointer-coarse:opacity-100");
    expect(actions).toContainElement(
      screen.getByRole("button", { name: `Open ${item.name}` }),
    );
  });

  it("puts the trailing row controls in the same overlay", () => {
    render(
      <NameCell
        item={item}
        controls={controls}
        trailing={<button type="button">Row menu</button>}
      />,
    );
    expect(screen.getByTestId("name-actions")).toContainElement(
      screen.getByRole("button", { name: "Row menu" }),
    );
  });

  it("reveals the overlay on row hover and on keyboard focus within", () => {
    render(<NameCell item={item} controls={controls} />);
    const classes = screen.getByTestId("name-actions").className.split(/\s+/);
    expect(classes).toContain("group-hover/name:opacity-100");
    expect(classes).toContain("focus-within:opacity-100");
  });

  it("carries the full name as the name button's title", () => {
    render(<NameCell item={item} controls={controls} />);
    expect(screen.getByLabelText(`${item.name} name`)).toHaveAttribute(
      "title",
      item.name,
    );
  });
});

describe("NameCell — hover peek", () => {
  beforeEach(() => {
    coarse = false;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("unrolls a truncated name after the pointer rests on the row for 200ms", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);

    fireEvent.mouseEnter(cell);
    expect(cell).not.toHaveAttribute("data-peek");
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS - 1);
    });
    expect(cell).not.toHaveAttribute("data-peek");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(cell).toHaveAttribute("data-peek", "true");

    fireEvent.mouseLeave(cell);
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("puts the buttons back in flow at the end of the unrolled name", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);
    fireEvent.mouseEnter(cell);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS);
    });
    const classes = screen.getByTestId("name-actions").className.split(/\s+/);
    expect(classes).toContain("static");
    expect(classes).not.toContain("absolute");
  });

  it("does not peek a name that fits", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), false);
    fireEvent.mouseEnter(cell);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS * 2);
    });
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("cancels a pending peek when the pointer leaves before 200ms", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);
    fireEvent.mouseEnter(cell);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.mouseLeave(cell);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS);
    });
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("does not peek on a coarse pointer", () => {
    coarse = true;
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);
    fireEvent.mouseEnter(cell);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS);
    });
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("does not peek while the row is being dragged", () => {
    const { container } = render(
      <NameCell item={item} controls={controls} peekDisabled />,
    );
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);
    fireEvent.mouseEnter(cell);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS);
    });
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("peeks at once on keyboard focus of a truncated name, and closes on blur", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    setTruncated(screen.getByText(item.name), true);
    const nameButton = screen.getByLabelText(`${item.name} name`);
    fireEvent.focus(nameButton);
    expect(cell).toHaveAttribute("data-peek", "true");
    fireEvent.blur(nameButton);
    expect(cell).not.toHaveAttribute("data-peek");
  });

  it("is not there while the name is being edited", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    setTruncated(screen.getByText(item.name), true);
    fireEvent.mouseEnter(container.firstElementChild as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(NAME_PEEK_DELAY_MS);
    });
    fireEvent.click(screen.getByLabelText(`${item.name} name`));
    const editing = container.firstElementChild as HTMLElement;
    expect(editing.querySelector("input")).toBeInTheDocument();
    expect(editing).not.toHaveAttribute("data-peek");
  });
});
```

Create `src/components/boards/table/ItemRow.gutter.test.tsx` (same direct-render harness as `temp-row-readonly.test.tsx`: `ItemRow` with a hand-built `CellControls`, no providers):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Item } from "@/lib/boards/queries";
import { ItemRow } from "./ItemRow";
import type { CellControls } from "./shared";

const EPIC_ID = "22222222-2222-4222-8222-222222222222";
const CHILD_ID = "33333333-3333-4333-8333-333333333333";

function item(id: string, parentId: string | null, name: string): Item {
  return {
    id,
    org_id: "o1",
    board_id: "b1",
    group_id: "g1",
    parent_id: parentId,
    name,
    position: 1,
    created_by: "",
    created_at: "2026-09-09T00:00:00Z",
    updated_at: "2026-09-09T00:00:00Z",
    archived_at: null,
    archived_by: null,
  };
}

function renderRow(boardItems: Item[], selectable = true) {
  const controls = {
    setEditing: vi.fn(),
    setCell: vi.fn(),
    clearCellValue: vi.fn(),
    members: [],
    renameItemInCache: vi.fn(),
    addSubitem: vi.fn(),
    deleteItem: vi.fn(),
    dependentsByItem: new Map<string, number>(),
    statusColumn: null,
    cache: {
      items: boardItems,
      cellValues: [],
      attachments: [],
      timeEntries: [],
    },
  } as unknown as CellControls;
  return render(
    <ItemRow
      item={boardItems[0]}
      columns={[]}
      cellMap={new Map()}
      template="1fr 1fr"
      controls={controls}
      selectable={selectable}
      subitems={[]}
      childCount={0}
      isExpanded={false}
      onToggleExpand={vi.fn()}
      autoFocusRename={false}
      onRenameSettled={vi.fn()}
    />,
  );
}

describe("ItemRow gutter", () => {
  it("reserves no chevron slot when no item on the board has subitems", () => {
    const { container } = renderRow([item(EPIC_ID, null, "Epic")]);
    expect(container.querySelector("[data-chevron-slot]")).toBeNull();
  });

  it("reserves the slot on a childless row once the board has a subitem", () => {
    const { container } = renderRow([
      item(EPIC_ID, null, "Epic"),
      item(CHILD_ID, "44444444-4444-4444-8444-444444444444", "Child"),
    ]);
    expect(container.querySelector("[data-chevron-slot]")).not.toBeNull();
  });

  it("orders the gutter drag handle, then checkbox", () => {
    renderRow([item(EPIC_ID, null, "Epic")]);
    const handle = screen.getByRole("button", { name: "Reorder Epic" });
    const checkbox = screen.getByRole("checkbox", { name: "Select Epic" });
    expect(
      handle.compareDocumentPosition(checkbox) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses the 16px handle and 20px checkbox slots, keeping the 44px coarse targets", () => {
    renderRow([item(EPIC_ID, null, "Epic")]);
    const handle = screen.getByRole("button", { name: "Reorder Epic" });
    const handleClasses = handle.className.split(/\s+/);
    expect(handleClasses).toContain("w-4");
    expect(handleClasses).toContain("pointer-coarse:size-11");
    const label = screen
      .getByRole("checkbox", { name: "Select Epic" })
      .closest("label") as HTMLElement;
    const labelClasses = label.className.split(/\s+/);
    expect(labelClasses).toContain("size-5");
    expect(labelClasses).toContain("pointer-coarse:size-11");
  });

  it("omits the checkbox for viewers", () => {
    renderRow([item(EPIC_ID, null, "Epic")], false);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
```

In `src/components/boards/table/temp-row-readonly.test.tsx`, line 151, the fixture gains the slice the row now reads:

```tsx
    cache: { items: [], cellValues: [], attachments: [], timeEntries: [] },
```

- [ ] **Step 6: Run them and watch them fail**

Run: `pnpm vitest run --project unit src/components/boards/table/NameCell.test.tsx src/components/boards/table/ItemRow.gutter.test.tsx`

Expected: FAIL. `NAME_PEEK_DELAY_MS` is undefined, `name-actions` is not found, the name button has no `title`, the handle has `size-6` not `w-4`, the checkbox comes before the handle.

- [ ] **Step 7: Rebuild `NameCell`**

`src/components/boards/table/NameCell.tsx`. Keep `openItemPanel` (lines 16–26) as is. Replace the imports (lines 3–14) with:

```tsx
import { memo, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { Maximize2 } from "lucide-react";
import type { Item } from "@/lib/boards/queries";
import {
  NAME_FREEZE_EDGE,
  NAME_FREEZE_RULE,
  NAME_FREEZE_SHADOW,
} from "@/components/boards/SummaryRow";
import { Input } from "@/components/ui/input";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import { cn } from "@/lib/utils";
import { isOptimisticId } from "@/lib/boards/optimistic-id";
import type { CellControls } from "./shared";
```

Replace the component (lines 28–242) with the code below. Where it says `SEAM_CLASSES`, that is the existing long `after:` class string at line 161, moved verbatim into a module constant together with its explanatory comment (lines 135–160); do not retype or shorten either.

```tsx
/** How long the pointer rests on a row before a truncated name unrolls. */
export const NAME_PEEK_DELAY_MS = 200;

// (the existing comment block from lines 135–160 goes here, unchanged)
const SEAM_CLASSES =
  "after:bg-primary after:ease-keystone after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-[2px] after:origin-center after:scale-y-0 after:transition-transform after:duration-[var(--duration-standard)] after:content-[''] hover:after:scale-y-100";

/**
 * The built-in primary "Name" cell.
 *
 * Fine pointers: the leading gutter (drag handle, checkbox, chevron slot) is
 * followed by the name, which takes all the remaining width. The open-panel
 * button and the `trailing` controls are an overlay on the right edge and take
 * no width. When the name is still truncated, resting on the row unrolls the
 * cell to its full one-line width over the neighbouring cells (the "peek").
 *
 * Coarse pointers: no overlay and no peek. The same container is in flow and
 * always visible, with 44px controls.
 */
export const NameCell = memo(function NameCell({
  item,
  controls,
  leading,
  trailing,
  indented = false,
  selected = false,
  autoFocusRename = false,
  onRenameSettled,
  intelMatch,
  peekDisabled = false,
}: {
  item: Item;
  controls: CellControls;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  indented?: boolean;
  /** Row is bulk-selected — frozen cell carries the periwinkle wash + accent bar. */
  selected?: boolean;
  autoFocusRename?: boolean;
  onRenameSettled?: () => void;
  /** Board Intelligence: true = active chip's rule paints inside this frozen column. */
  intelMatch?: boolean | null;
  /** The row is being dragged: never unroll the name. */
  peekDisabled?: boolean;
}) {
  const [editing, setEditing] = useState(autoFocusRename);
  const [name, setName] = useState(item.name);
  const [isPending, startTransition] = useTransition();
  // Temp-row rule (see @/lib/boards/optimistic-id): while the row's id is
  // client-minted, a rename would PATCH an id the server doesn't have and
  // `?item=<id>` would resolve to nothing — so neither affordance arms until
  // the server row replaces it (one round-trip). Dimmed to say so.
  const pending = isOptimisticId(item.id);
  const coarse = useCoarsePointer();
  const textRef = useRef<HTMLSpanElement>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // null = closed. Open = capped to the scroller's visible width, read once
  // when it opens (the cell is `sticky left-0`, so its left edge is the
  // scroller's left edge).
  const [peek, setPeek] = useState<{ cap: number | undefined } | null>(null);
  const peeking = peek !== null && !coarse && !peekDisabled;

  // No unmount cleanup for the timer on purpose: if a virtualized row unmounts
  // inside the 200ms, the callback finds no text node and sets state on an
  // unmounted component, which React ignores.
  function cancelPeek() {
    if (peekTimer.current) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    setPeek(null);
  }

  function isTruncated(): boolean {
    const el = textRef.current;
    return el !== null && el.scrollWidth > el.clientWidth;
  }

  function openPeek() {
    const scroller = textRef.current?.closest<HTMLElement>(
      "[data-scroll-container]",
    );
    setPeek({ cap: scroller ? scroller.clientWidth : undefined });
  }

  function armPeek() {
    if (coarse || peekDisabled || !isTruncated()) return;
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => {
      peekTimer.current = null;
      openPeek();
    }, NAME_PEEK_DELAY_MS);
  }

  function open() {
    if (pending) return;
    cancelPeek();
    setName(item.name);
    setEditing(true);
  }

  function commit() {
    const trimmed = name.trim();
    setEditing(false);
    onRenameSettled?.();
    if (!trimmed || trimmed === item.name) return;
    startTransition(async () => {
      controls.renameItemInCache({ itemId: item.id, name: trimmed });
    });
  }

  if (editing) {
    return (
      <div
        className={cn(
          "sticky left-0 z-10 flex items-center pr-2 pl-1",
          indented ? "bg-surface-sunken" : "bg-surface",
          NAME_FREEZE_EDGE,
          NAME_FREEZE_RULE,
        )}
      >
        {intelMatch === true && (
          <span aria-hidden data-testid="intel-rule" className="intel-rule" />
        )}
        {leading}
        <Input
          autoFocus
          value={name}
          disabled={isPending}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              onRenameSettled?.();
            }
          }}
          aria-label={`Rename ${item.name}`}
          className="h-6 px-1.5 pointer-coarse:h-8"
        />
      </div>
    );
  }

  return (
    <div
      data-peek={peeking ? "true" : undefined}
      onMouseEnter={armPeek}
      onMouseLeave={cancelPeek}
      // The frozen Name column is `sticky left-0`, so the other columns scroll
      // UNDERNEATH it — its background MUST be opaque. The background is one
      // custom property, `--name-bg`, so the buttons overlay can fade to
      // exactly the colour this cell is painted in (resting, hovered, sunken
      // or selected). Selected is an opaque composite, never a translucent
      // `bg-primary/[0.08]`, for the same reason as before.
      style={
        {
          ...(selected
            ? {
                "--name-bg": `color-mix(in srgb, var(--primary) 8%, var(--${
                  indented ? "surface-sunken" : "surface"
                }))`,
              }
            : null),
          // The peek: let the cell grow past its grid track, to the width of
          // its content on one line, capped to the visible scroller.
          ...(peeking
            ? { width: "max-content", minWidth: "100%", maxWidth: peek?.cap }
            : null),
        } as CSSProperties
      }
      className={cn(
        "group/name ease-keystone relative sticky left-0 z-10 flex h-full items-center bg-[var(--name-bg)] pl-1 transition-colors pointer-coarse:pr-2",
        SEAM_CLASSES,
        // Selected: opaque periwinkle wash (via --name-bg, above) + a 3px
        // accent bar (::before, inset 6px), pointer-events-none.
        selected
          ? cn(
              "before:bg-primary before:pointer-events-none before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded",
              "after:hidden",
              // The intel rule owns x=0 while a chip is active; the periwinkle
              // wash still says "selected" on its own.
              intelMatch === true && "before:hidden",
            )
          : indented
            ? "[--name-bg:var(--color-surface-sunken)] hover:[--name-bg:var(--color-surface)]"
            : "[--name-bg:var(--color-surface)] hover:[--name-bg:var(--color-surface-muted)]",
        // Bare marker class asserted by BoardTable.test.tsx; the shadow itself
        // is the real <span> below (this wrapper's ::after is the hover seam).
        "name-freeze-edge",
        NAME_FREEZE_RULE,
        // Peek: above the row hairline (z-20) and any presence ring (z-10) of
        // the neighbouring cells, inside this row's own stacking context. The
        // hairline brightens; `shadow-panel` is the one sanctioned shadow.
        // Listed AFTER NAME_FREEZE_RULE so `border-border-bright` wins.
        peeking && "border-border-bright shadow-panel z-30",
      )}
    >
      <span aria-hidden className={NAME_FREEZE_SHADOW} />
      {intelMatch === true && (
        <span aria-hidden data-testid="intel-rule" className="intel-rule" />
      )}
      {leading}
      <div
        role="button"
        // Temp-row rule: `open()` is a no-op while pending, so keeping this in
        // the tab order would be a dead stop announcing itself as a button.
        tabIndex={pending ? -1 : 0}
        aria-label={`${item.name} name`}
        title={item.name}
        onClick={open}
        onFocus={() => {
          if (!coarse && !peekDisabled && isTruncated()) openPeek();
        }}
        onBlur={cancelPeek}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        aria-disabled={pending || undefined}
        className={cn(
          "focus-visible:ring-ring flex h-full min-w-0 flex-1 items-center focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
          // Subitem names sit at the cell scale; item names one step up.
          indented
            ? "text-cell font-normal"
            : "text-item font-medium tracking-[-0.011em]",
          pending ? "cursor-default opacity-60" : "cursor-pointer",
          indented ? "pr-2 pl-10" : "pr-2 pl-1",
        )}
      >
        {/* The text is its own truncating box: `text-overflow` does not draw
            an ellipsis for text placed directly in a flex container. This is
            also the node the peek measures. */}
        <span ref={textRef} className="min-w-0 truncate">
          {item.name}
        </span>
      </div>
      <div
        data-testid="name-actions"
        className={cn(
          "flex shrink-0 items-center pr-1 pointer-coarse:static pointer-coarse:bg-none pointer-coarse:pr-0 pointer-coarse:pl-0 pointer-coarse:opacity-100",
          peeking
            ? "static opacity-100"
            : "absolute inset-y-0 right-0 bg-[linear-gradient(to_right,transparent,var(--name-bg)_1.25rem)] pl-6 opacity-0 transition-opacity group-hover/name:opacity-100 focus-within:opacity-100",
        )}
      >
        {!pending && (
          <button
            type="button"
            aria-label={`Open ${item.name}`}
            onClick={() => openItemPanel(item.id)}
            className="hover:bg-state-hover text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-6 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 group-data-[peek=true]/name:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11 pointer-coarse:opacity-100"
          >
            <Maximize2 className="size-3.5" />
          </button>
        )}
        {trailing}
      </div>
    </div>
  );
});
```

- [ ] **Step 8: Rebuild the gutter in the two row components**

`src/components/boards/table/ItemRow.tsx`:

Add `import { boardHasSubitems } from "@/lib/boards/item-tree";` to the imports.

Replace the `dragHandle`, `chevron` and `trailing` blocks (currently lines 190–258) with:

```tsx
// No row reserves the chevron slot on a board without subitems, so names
// start further left and still line up with each other.
const reserveChevron = boardHasSubitems(controls.cache.items);

const dragHandle = (
  <button
    type="button"
    disabled={pending}
    aria-label={`Reorder ${item.name}`}
    {...attributes}
    {...listeners}
    className="text-muted-foreground hover:text-foreground grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center rounded opacity-0 transition-opacity group-hover/name:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-100"
  >
    <GripVertical className="size-3.5" />
  </button>
);

const chevron =
  childCount > 0 ? (
    <>
      <button
        type="button"
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.name}`}
        aria-expanded={isExpanded}
        onClick={() => onToggleExpand(item.id)}
        className="text-muted-foreground hover:text-foreground grid size-5 shrink-0 place-items-center rounded"
      >
        {isExpanded ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
      </button>
      <span className="text-muted-foreground ml-1 text-xs">({childCount})</span>
    </>
  ) : reserveChevron ? (
    // Spacer: keeps this childless row's name aligned with the parents'.
    <span
      data-chevron-slot=""
      className="inline-block size-5 shrink-0"
      aria-hidden
    />
  ) : null;

const trailing = (
  <>
    {childCount === 0 && (
      <button
        type="button"
        aria-label={`Add subitem to ${item.name}`}
        onClick={() => {
          // Expand FIRST, not in `onSuccess`: the optimistic temp subitem
          // lands at `onMutate`, so `childCount` flips 0→1 immediately. A
          // parent still collapsed at that moment swaps its own cells for
          // RollupValueCells over a value-less temp row — its values visibly
          // blank out and come back one round-trip later.
          if (!isExpanded) onToggleExpand(item.id);
          controls.addSubitem(item.id, "New subitem", {
            // Enter rename mode on the real row once the server answers.
            onSuccess: (id) => onSubitemAdded?.(id),
          });
        }}
        className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 group-data-[peek=true]/name:opacity-100 focus-visible:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
      >
        <Plus className="size-3.5" />
      </button>
    )}
    <RowMenu
      label={item.name}
      hasChildren={childCount > 0}
      disabled={pending}
      onDelete={() => controls.deleteItem(item.id)}
    />
  </>
);
```

Replace the `<NameCell …/>` element (currently lines 278–295) with (handle first, then checkbox, then chevron; `peekDisabled` added):

```tsx
<NameCell
  item={item}
  controls={controls}
  selected={selected}
  intelMatch={intelMatch}
  peekDisabled={isDragging}
  leading={
    <>
      {dragHandle}
      {selectable && <RowSelectCheckbox itemId={item.id} name={item.name} />}
      {chevron}
    </>
  }
  trailing={trailing}
  autoFocusRename={autoFocusRename}
  onRenameSettled={onRenameSettled}
/>
```

`src/components/boards/table/SortableSubitemRow.tsx`: in the `dragHandle` button (line 136) replace `size-6` with `h-6 w-4` (the rest of the class string, including `pointer-coarse:size-11 pointer-coarse:opacity-100`, is unchanged). On the `<NameCell …>` element (lines 174–190) add the prop `peekDisabled={isDragging}`.

`src/components/boards/table/RowSelectCheckbox.tsx`, line 32: `"grid size-6 shrink-0 …"` → `"grid size-5 shrink-0 cursor-pointer place-items-center rounded transition-opacity pointer-coarse:size-11 pointer-coarse:opacity-100"`.

`src/components/boards/table/RowMenu.tsx`, line 45, the trigger's class becomes:

```tsx
className =
  "text-muted-foreground hover:text-foreground grid size-6 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 group-data-[peek=true]/name:opacity-100 focus-visible:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100";
```

- [ ] **Step 9: Run the touched suites, typecheck and lint**

Run: `pnpm vitest run --project unit src/components/boards/table src/components/boards/BoardTable.test.tsx src/lib/boards/name-column-width.test.ts src/lib/boards/item-tree.test.ts`

Expected: PASS. In particular, unchanged and green: the four "BoardTable touch targets (coarse pointer)" tests, "BoardTable add-subitem hover button" (3 tests), "renders the (N) child-count badge next to the chevron", "keeps every frozen name cell opaque when a row is selected", `SubitemThread.test.tsx` (4 tests), `temp-row-readonly.test.tsx`.

Run: `pnpm exec prettier --write src/components/boards/table src/lib/boards/name-column-width.ts src/lib/boards/item-tree.ts && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 10: Hand back**

Report the files changed, the test command with its pass count, and the typecheck / lint result. State explicitly that the peek's geometry (it overflows the neighbouring cells, is capped at the scroller, and the overlay fade matches the row background in resting, hover, selected and subitem rows) is **not** covered by these tests and is on the orchestrator's browser list. Do not stage, commit or stash anything.

---

### Task 3: One board column header, slim sticky group rows

**Files:**

- Create: `src/components/boards/table/BoardColumnHeader.tsx`
- Create: `src/lib/boards/group-progress.ts`
- Create: `src/lib/boards/group-progress.test.ts`
- Modify: `src/components/boards/table/GroupHeaderRow.tsx` (whole file, lines 1–272)
- Modify: `src/components/boards/table/GroupSection.tsx` (props 58–114; lines 221–226, 250–277)
- Modify: `src/components/boards/table/BoardTableInner.tsx` (imports 81–91; after line 163; comments 434, 467–471; lines 821–822, 850–880)
- Modify: `src/components/boards/ColumnHeader.tsx` (line 118)
- Modify: `src/components/boards/table/CreatedHeaderCell.tsx` (line 15)
- Modify: `src/components/boards/SummaryRow.tsx` (line 230)
- Modify: `src/app/globals.css` (one token after line 90)
- Test: `src/components/boards/BoardTable.test.tsx`, `src/components/boards/ColumnHeader.test.tsx`, `src/components/boards/SummaryRow.test.tsx`, `src/components/boards/text-size-token-cn-merge.test.ts`

This task does **not** edit `NameCell.tsx`, `ItemRow.tsx`, `SortableSubitemRow.tsx`, `RowMenu.tsx`, `RowSelectCheckbox.tsx`, `name-column-width.ts` or `item-tree.ts`: Task 2 owns them and runs in the same batch.

**Interfaces:**

- Consumes: `ColumnHeaderControls`, `gridTemplate` output (`template`), `controls.statusColumn` (already built in `BoardTableInner`), `isStatusValueComplete` from `@/lib/boards/overdue`, `NameResizeHandle`, `SortableColumnHeader`, `CreatedHeaderCell`, `AddColumnMenu`, `NAME_FREEZE_EDGE`, `NAME_FREEZE_RULE`.
- Produces:
  - `BoardColumnHeader({ columns: Column[]; template: string; col: ColumnHeaderControls })`, memoized, root `data-testid="board-column-header"`, `DndContext id="board-columns"`.
  - `GroupHeaderRow` props: `group`, `selectAll`, `collapsed`, `onToggleCollapse`, `renaming`, `name`, `onNameChange`, `onCommitRename`, `onCancelRename`, `onOpenRename`, `itemCount`, `progress: GroupProgress | null`, `dragAttributes`, `dragListeners`, `onSetColor`, `onDelete`. Removed: `groupIndex`, `columns`, `template`, `col`. Root `data-testid="group-header-<groupId>"`.
  - `GroupSection` no longer takes `col`.
  - `groupProgress(itemIds: readonly string[], statusColumn: Pick<CacheColumn, "id" | "settings"> | null, cellMap: ReadonlyMap<string, CacheCellValue["value"]>): GroupProgress | null` and `type GroupProgress = { done: number; total: number; percent: number }` from `@/lib/boards/group-progress`.
  - CSS custom property `--board-viewport-w` (px) on the board scroller; theme token `--text-group` (13.5px) → utility `text-group`.
  - `ColumnHeader` root is `h-full … px-2` (no vertical padding of its own).
  - z-indexes exactly as in "Checked facts (c)".

**Existing tests this task breaks on purpose** (all in `BoardTable.test.tsx` unless noted; replacements are written out in Step 3):

| Test                                                                                             | Why it breaks                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `describe("BoardTable per-group column headers")`, all 5 tests                                   | assert 2 of each header / handle / Add-column        |
| "renders a reorder grip per data column in every group header"                                   | asserts 2 grips per column                           |
| "derives the column reorder handle's aria-describedby from the group id, not the global counter" | id was `group-columns-g1`                            |
| `text-size-token-cn-merge.test.ts` → "GroupHeaderRow frozen Name cell: …"                        | reproduces a class composition that no longer exists |
| `ColumnHeader.test.tsx` → "paints no vertical rule and pads to 16px"                             | header pads 8px now                                  |

Tests that keep passing unchanged and must be re-run: "BoardTable group menu" (2), "BoardTable group drag handle", "BoardTable add group", "BoardTable saved arrangement" (3), "BoardTable touch targets (coarse pointer)" (4), "BoardTable frozen Name column" (7; one title is corrected), "disables Move left on the first data column…", `GroupSelectAll.temp-row.test.tsx`, `BoardTable.created-columns.test.tsx`, `BoardTable.render-count.test.tsx`, `BoardTable.cross-group-dnd.test.tsx`.

- [ ] **Step 1: Write the failing test for the progress rule**

Create `src/lib/boards/group-progress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cellKey, type CacheCellValue } from "@/lib/boards/cache";
import { groupProgress } from "./group-progress";

const statusColumn = {
  id: "c_status",
  settings: {
    options: [
      { id: "o_done", label: "Done", color: "#00c875" },
      { id: "o_complete", label: "Completed", color: "#00c875" },
      { id: "o_wip", label: "Working on it", color: "#fdab3d" },
    ],
  },
};

function cells(
  entries: [itemId: string, optionId: string][],
): Map<string, CacheCellValue["value"]> {
  return new Map(
    entries.map(([itemId, optionId]) => [
      cellKey(itemId, "c_status"),
      { optionId } as CacheCellValue["value"],
    ]),
  );
}

describe("groupProgress", () => {
  it("counts items whose status is done by the board's done rule", () => {
    const map = cells([
      ["i1", "o_done"],
      ["i2", "o_wip"],
      ["i3", "o_complete"],
    ]);
    expect(groupProgress(["i1", "i2", "i3", "i4"], statusColumn, map)).toEqual({
      done: 2,
      total: 4,
      percent: 50,
    });
  });

  it("rounds the percentage", () => {
    const map = cells([["i1", "o_done"]]);
    expect(groupProgress(["i1", "i2", "i3"], statusColumn, map)?.percent).toBe(
      33,
    );
  });

  it("is 0% when nothing is done", () => {
    expect(groupProgress(["i1"], statusColumn, new Map())).toEqual({
      done: 0,
      total: 1,
      percent: 0,
    });
  });

  it("is null without a status column (no meter)", () => {
    expect(groupProgress(["i1"], null, new Map())).toBeNull();
  });

  it("is null for an empty group (no meter)", () => {
    expect(groupProgress([], statusColumn, new Map())).toBeNull();
  });

  it("ignores cells of items outside the group", () => {
    const map = cells([
      ["i1", "o_wip"],
      ["other", "o_done"],
    ]);
    expect(groupProgress(["i1"], statusColumn, map)?.done).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, implement, watch it pass**

Run: `pnpm vitest run --project unit src/lib/boards/group-progress.test.ts`
Expected: FAIL, cannot resolve `./group-progress`.

Create `src/lib/boards/group-progress.ts`:

```ts
import {
  cellKey,
  type CacheCellValue,
  type CacheColumn,
} from "@/lib/boards/cache";
import { isStatusValueComplete } from "@/lib/boards/overdue";

export type GroupProgress = { done: number; total: number; percent: number };

/**
 * How much of a group is done, for the group row's progress meter.
 *
 * "Done" is NOT a second rule: it is `isStatusValueComplete` over the board's
 * FIRST status column — the same pair Board Intelligence's overdue signal and
 * the date cells' overdue tint use (@/lib/boards/overdue). Pass the column the
 * table already resolved once (`controls.statusColumn`).
 *
 * `null` means "show no meter": the board has no status column, or the group
 * has no rows to measure. Pure; reads only the cells of the ids it is given.
 */
export function groupProgress(
  itemIds: readonly string[],
  statusColumn: Pick<CacheColumn, "id" | "settings"> | null,
  cellMap: ReadonlyMap<string, CacheCellValue["value"]>,
): GroupProgress | null {
  if (!statusColumn || itemIds.length === 0) return null;
  let done = 0;
  for (const id of itemIds) {
    const value = cellMap.get(cellKey(id, statusColumn.id)) ?? null;
    if (isStatusValueComplete(value, statusColumn)) done++;
  }
  return {
    done,
    total: itemIds.length,
    percent: Math.round((done / itemIds.length) * 100),
  };
}
```

Run: `pnpm vitest run --project unit src/lib/boards/group-progress.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 3: Rewrite the table tests for one header and the slim group row**

In `src/components/boards/BoardTable.test.tsx`:

Add `within` to the `@testing-library/react` import (lines 11–17).

In `describe("BoardTable frozen Name column")`, rename the test at line 1443 to `"gives every frozen Name-column element the permanent right-edge hairline (BoardColumnHeader + item NameCells)"`. Its body is unchanged.

Replace the comment block at lines 1512–1516 ("Per-group column headers (Monday-style) …") with:

```tsx
// ── One board column header ─────────────────────────────────────────────────
// Columns are board-scoped. The header is rendered ONCE, as the first child of
// the scroller's content, so it is there for an empty group, a collapsed group
// and a board with no groups at all. Fixture: 3 board columns, two groups, and
// the SECOND group is EMPTY (no items).
```

Replace `describe("BoardTable per-group column headers", …)` (lines 1568–1606) and `describe("BoardTable column reorder", …)` (lines 1608–1631) with:

```tsx
describe("BoardTable single column header", () => {
  it("renders each column header exactly once for a board with several groups", () => {
    renderBoardWithColumns();
    expect(screen.getAllByText("Status")).toHaveLength(1);
    expect(screen.getAllByText("Owner")).toHaveLength(1);
    expect(screen.getAllByText("Due Date")).toHaveLength(1);
  });

  it("is the first child of the scroller's content and sticks to the top", () => {
    renderBoardWithColumns();
    const header = screen.getByTestId("board-column-header");
    const content = screen.getByTestId("board-scroll").firstElementChild;
    expect(content?.firstElementChild).toBe(header);
    const classes = header.className.split(/\s+/);
    expect(classes).toContain("sticky");
    expect(classes).toContain("top-0");
    expect(classes).toContain("z-40");
  });

  it("still shows the board's columns above an empty group", () => {
    renderBoardWithColumns();
    expect(screen.getByTestId("group-header-g2")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("board-column-header")).getByText("Owner"),
    ).toBeInTheDocument();
  });

  it("shows the columns on a board that has no groups yet", () => {
    const base = payloadWithColumns() as unknown as Record<string, unknown>;
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardTable
          payload={{ ...base, groups: [], items: [] } as never}
          selectedViewId="v1"
        />
      </QueryClientProvider>,
    );
    expect(
      within(screen.getByTestId("board-column-header")).getByText("Status"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This board has no groups yet."),
    ).toBeInTheDocument();
  });

  it("renders one Add-column control, one Name resize handle and one resize handle per column", () => {
    renderBoardWithColumns();
    expect(screen.getAllByRole("button", { name: /add column/i })).toHaveLength(
      1,
    );
    expect(
      screen.getAllByRole("separator", { name: /^Resize Name column/i }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("separator", { name: "Resize Status" }),
    ).toHaveLength(1);
  });

  it("keeps the column header when a group is collapsed", () => {
    renderBoardWithColumns();
    fireEvent.click(screen.getByRole("button", { name: /Collapse Group 2/i }));
    expect(screen.getAllByText("Status")).toHaveLength(1);
  });

  it("marks the header's Item cell as the freeze edge", () => {
    renderBoardWithColumns();
    const itemCell = screen.getByTestId("board-column-header")
      .firstElementChild as HTMLElement;
    expect(itemCell.className).toContain("name-freeze-edge");
    for (const cls of NAME_FREEZE_RULE.split(" ")) {
      expect(itemCell.className).toContain(cls);
    }
    expect(within(itemCell).getByText("Item")).toBeInTheDocument();
  });
});

function progressPayload() {
  const base = payloadWithColumns() as unknown as {
    columns: { id: string; settings: unknown }[];
  };
  const mkItem = (id: string, name: string, position: number) => ({
    id,
    board_id: "b1",
    org_id: "o1",
    group_id: "g1",
    name,
    position,
    parent_id: null,
  });
  return {
    ...base,
    columns: base.columns.map((c) =>
      c.id === "c_status"
        ? {
            ...c,
            settings: {
              options: [
                { id: "o_done", label: "Done", color: "#00c875" },
                { id: "o_wip", label: "Working on it", color: "#fdab3d" },
              ],
            },
          }
        : c,
    ),
    items: [mkItem("i1", "Item 1", 0), mkItem("i2", "Item 2", 1)],
    cellValues: [
      { item_id: "i1", column_id: "c_status", value: { optionId: "o_done" } },
      { item_id: "i2", column_id: "c_status", value: { optionId: "o_wip" } },
    ],
  } as never;
}

describe("BoardTable group row", () => {
  it("shows the title as the user typed it, with no index number", () => {
    renderBoardWithColumns();
    const title = within(screen.getByTestId("group-header-g1")).getByRole(
      "button",
      { name: "Group 1" },
    );
    expect(title.textContent).toBe("Group 1");
  });

  it("sticks under the column header", () => {
    renderBoardWithColumns();
    const classes = screen
      .getByTestId("group-header-g1")
      .className.split(/\s+/);
    expect(classes).toContain("sticky");
    expect(classes).toContain("top-[30px]");
    expect(classes).toContain("z-30");
  });

  it("holds its content in a block pinned to the visible width of the scroller", () => {
    renderBoardWithColumns();
    const inner = screen.getByTestId("group-header-g1")
      .firstElementChild as HTMLElement;
    const classes = inner.className.split(/\s+/);
    expect(classes).toContain("sticky");
    expect(classes).toContain("left-0");
    expect(classes).toContain("w-[var(--board-viewport-w,100%)]");
  });

  it("publishes the scroller's visible width for that block", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 900;
      },
    });
    try {
      renderBoard();
      expect(
        screen
          .getByTestId("board-scroll")
          .style.getPropertyValue("--board-viewport-w"),
      ).toBe("900px");
    } finally {
      // jsdom defines clientWidth on Element.prototype; drop the override.
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)
        .clientWidth;
    }
  });

  it("shows the item count", () => {
    renderBoardWithColumns();
    expect(
      within(screen.getByTestId("group-header-g1")).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("group-header-g2")).getByText("0"),
    ).toBeInTheDocument();
  });

  it("shows a progress meter from the board's done rule", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardTable payload={progressPayload()} selectedViewId="v1" />
      </QueryClientProvider>,
    );
    const g1 = within(screen.getByTestId("group-header-g1"));
    expect(g1.getByText("50% done")).toBeInTheDocument();
    expect(g1.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    // An empty group has nothing to measure.
    expect(
      within(screen.getByTestId("group-header-g2")).queryByRole("progressbar"),
    ).toBeNull();
  });

  it("shows no progress meter on a board without a status column", () => {
    renderTwoItems();
    expect(
      within(screen.getByTestId("group-header-g1")).queryByRole("progressbar"),
    ).toBeNull();
  });
});

describe("BoardTable column reorder", () => {
  it("renders one reorder grip per data column, in the single header", () => {
    renderBoardWithColumns();
    // Name/Created cells get no grip.
    expect(
      screen.getAllByRole("button", { name: "Reorder Status column" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Reorder Owner column" }),
    ).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Reorder Name/ })).toBeNull();
  });

  it("disables Move left on the first data column and Move right on the last", () => {
    renderBoardWithColumns();
    fireEvent.click(screen.getByLabelText("Status column menu"));
    expect(
      screen.getByText("Move left").closest("[role=menuitem]"),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Move right").closest("[role=menuitem]"),
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});
```

In `describe("BoardTable deterministic dnd ids")` rename the test to `"gives the column reorder handle a fixed aria-describedby, not one from the global counter"` and change its last line to:

```tsx
expect(handle.getAttribute("aria-describedby")).toBe("board-columns");
```

`src/components/boards/text-size-token-cn-merge.test.ts`: replace the second test (lines 36–44) with the composition the new group title uses, and drop the now-unused `NAME_FREEZE_EDGE` import at line 3:

```ts
it("GroupHeaderRow title: text-group size token + text-foreground color both present", () => {
  const className = `text-group ${cn(
    "text-foreground focus-visible:ring-ring min-w-0 truncate rounded-sm text-left font-semibold focus-visible:ring-2 focus-visible:outline-none",
  )}`;

  expect(className.split(/\s+/)).toContain("text-group");
  expect(className.split(/\s+/)).toContain("text-foreground");
});
```

`src/components/boards/ColumnHeader.test.tsx`: replace the test "paints no vertical rule and pads to 16px" (lines 276–291) with:

```tsx
it("paints no vertical rule, pads to 8px and fills the header row's height", () => {
  const { container } = render(
    <ColumnHeader
      column={col()}
      width={200}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onResize={vi.fn()}
      onResizeEnd={vi.fn()}
    />,
  );
  const header = container.firstElementChild as HTMLElement;
  const classes = header.className.split(/\s+/);
  expect(header.className).not.toMatch(/\bborder-l\b/);
  expect(classes).toContain("px-2");
  expect(classes).toContain("h-full");
  expect(classes).not.toContain("pt-3.5");
});
```

`src/components/boards/SummaryRow.test.tsx`: in "board variant is sticky at the bottom and skips the color dot" add, after `expect(row.className).toContain("sticky");`:

```tsx
// Above the sticky group row (z-30) and column header (z-40).
expect(row.className.split(/\s+/)).toContain("z-[45]");
```

- [ ] **Step 4: Run them and watch them fail**

Run: `pnpm vitest run --project unit src/components/boards/BoardTable.test.tsx src/components/boards/ColumnHeader.test.tsx src/components/boards/SummaryRow.test.tsx -t "single column header|group row|column reorder|deterministic dnd|pads to 8px|sticky at the bottom"`

Expected: FAIL. `getAllByText("Status")` finds 2, `board-column-header` and `group-header-g1` are not found, `aria-describedby` is `group-columns-g1`, `px-2` and `z-[45]` are missing.

- [ ] **Step 5: Create `BoardColumnHeader`**

Create `src/components/boards/table/BoardColumnHeader.tsx`. The reorder logic is moved from `GroupHeaderRow.tsx` lines 85–106 and the header cells from lines 214–225 and 232–269, unchanged apart from the `DndContext` id.

```tsx
"use client";

import { memo } from "react";
import { Clock, User } from "lucide-react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { reorderPosition } from "@/lib/boards/group-reorder";
import type { Column } from "@/lib/boards/queries";
import {
  NAME_FREEZE_EDGE,
  NAME_FREEZE_RULE,
} from "@/components/boards/SummaryRow";
import { Kicker } from "@/components/ui/kicker";
import { AddColumnMenu } from "@/components/boards/AddColumnMenu";
import { cn } from "@/lib/utils";
import { CreatedHeaderCell } from "./CreatedHeaderCell";
import { NameResizeHandle } from "./NameResizeHandle";
import { SortableColumnHeader } from "./SortableColumnHeader";
import type { ColumnHeaderControls } from "./shared";

/**
 * The board's ONE column header: a grid on the shared column `template`,
 * rendered as the first child of the scroller's content and `sticky top-0`, so
 * the labels stay in view however far a group is scrolled.
 *
 * It owns everything column-related — the frozen "Item" cell with the
 * Name-column resize handle, one sortable {@link ColumnHeader} per board
 * column, the two Created headers and the Add-column menu. It belongs to the
 * board, not to a group, so a new, empty or collapsed group still sits under
 * the board's columns (the reason every group used to render its own header).
 *
 * 30px tall (44px on coarse pointers, where its controls are 44px targets).
 * Stacking: `z-40`, above the sticky group rows (`z-30`) and every row; below
 * the Board Total (`z-[45]`) and portalled menus (`z-50`). It needs its own
 * bottom rule: content scrolls underneath it, so there is no "next row's top
 * hairline" to rely on as there is for in-flow rows.
 *
 * Memoized: a cell edit re-renders BoardTableInner, but `columns`, `template`
 * and the `col` bundle only change on a real column change or a resize.
 */
export const BoardColumnHeader = memo(function BoardColumnHeader({
  columns,
  template,
  col,
}: {
  columns: Column[];
  template: string;
  col: ColumnHeaderControls;
}) {
  const columnSensors = useTouchAwareSensors();

  function columnMovePosition(index: number, dir: -1 | 1): number | null {
    const over = columns[index + dir];
    if (!over) return null;
    return reorderPosition(
      columns.map((c) => ({ id: c.id, position: c.position })),
      columns[index].id,
      over.id,
    );
  }

  function handleColumnDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const position = reorderPosition(
      columns.map((c) => ({ id: c.id, position: c.position })),
      String(active.id),
      String(over.id),
    );
    if (position !== null) col.reorderColumn(String(active.id), position);
  }

  return (
    <div
      data-testid="board-column-header"
      className="bg-surface text-muted-foreground border-border sticky top-0 z-40 grid h-[30px] border-b text-xs font-medium pointer-coarse:h-11"
      style={{ gridTemplateColumns: template }}
    >
      {/* Frozen "Item" cell — label + Name-column resize handle. `sticky` is
          a positioned box, so it anchors the handle and the freeze-edge
          shadow without also needing `relative` (the two conflict in cn()). */}
      <div
        className={cn(
          "bg-surface sticky left-0 z-10 flex items-center pr-2 pl-4",
          NAME_FREEZE_EDGE,
          NAME_FREEZE_RULE,
        )}
      >
        <Kicker size="xs" className="truncate">
          Item
        </Kicker>
        <NameResizeHandle
          width={col.nameWidth}
          onResize={(w) => col.setLiveNameWidth(w)}
          onResizeEnd={(w) => {
            col.setLiveNameWidth(null);
            col.resizeNameColumn(w);
          }}
          onAutoFit={() => {
            col.setLiveNameWidth(null);
            col.resizeNameColumn(null);
          }}
        />
      </div>

      {/* DndContext/SortableContext render no DOM, so headers stay direct grid
          children. The frozen Item cell before this block and the Created/Add
          cells after it sit OUTSIDE the sortable set — that is what makes the
          Name column immovable by construction. The id is fixed (one header
          per board) so aria-describedby is stable across SSR and hydration. */}
      <DndContext
        id="board-columns"
        sensors={columnSensors}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleColumnDragEnd}
      >
        <SortableContext
          items={columns.map((c) => c.id)}
          strategy={horizontalListSortingStrategy}
        >
          {columns.map((c, i) => (
            <SortableColumnHeader
              key={c.id}
              column={c}
              col={col}
              onMoveLeft={
                i > 0
                  ? () => {
                      const p = columnMovePosition(i, -1);
                      if (p !== null) col.reorderColumn(c.id, p);
                    }
                  : null
              }
              onMoveRight={
                i < columns.length - 1
                  ? () => {
                      const p = columnMovePosition(i, 1);
                      if (p !== null) col.reorderColumn(c.id, p);
                    }
                  : null
              }
            />
          ))}
        </SortableContext>
      </DndContext>
      <CreatedHeaderCell icon={User} label="Created by" />
      <CreatedHeaderCell icon={Clock} label="Created at" />
      <AddColumnMenu onAdd={col.onAddColumn} />
    </div>
  );
});
```

- [ ] **Step 6: Make `GroupHeaderRow` a slim sticky divider**

`src/app/globals.css`: after line 90 (`--text-item: …`) add:

```css
--text-group: 0.84375rem; /* 13.5px — board table group titles */
```

Replace the whole of `src/components/boards/table/GroupHeaderRow.tsx` with:

```tsx
"use client";

import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { useSortable } from "@dnd-kit/sortable";
import type { Group } from "@/lib/boards/queries";
import type { GroupProgress } from "@/lib/boards/group-progress";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { GroupMenu } from "./GroupMenu";

/**
 * A group's row: a 30px divider that spans the table (44px on coarse
 * pointers). It is NOT a grid on the column template any more — the board's
 * columns live in the single {@link BoardColumnHeader}.
 *
 * Sticky twice:
 *  - the row is `sticky top-[30px]` (the column header's height) inside its
 *    own <section>, so the current group's title stays pinned under the
 *    column header while its rows scroll, and the next group pushes it out;
 *  - its content sits in an inner block that is `sticky left-0` and exactly as
 *    wide as the VISIBLE scroller (`--board-viewport-w`, published by
 *    BoardTableInner), so the title, count, meter and menu stay in view
 *    during horizontal scroll.
 *
 * Stacking: `z-30` — above every row, the frozen Name cells (z-10) and the row
 * hairlines (z-20); below the column header (z-40).
 *
 * The title is the group's name as the user typed it, in Inter at the
 * `text-group` size. No mono kicker, no index number, same tone for every
 * group.
 */
export function GroupHeaderRow({
  group,
  selectAll,
  collapsed,
  onToggleCollapse,
  renaming,
  name,
  onNameChange,
  onCommitRename,
  onCancelRename,
  onOpenRename,
  itemCount,
  progress,
  dragAttributes,
  dragListeners,
  onSetColor,
  onDelete,
}: {
  group: Group;
  /** Group "select all visible" checkbox, or null for viewers/empty groups. */
  selectAll: React.ReactNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  renaming: boolean;
  name: string;
  onNameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onOpenRename: () => void;
  itemCount: number;
  /** Done-rule progress over the group's visible rows; null = no meter. */
  progress: GroupProgress | null;
  dragAttributes: ReturnType<typeof useSortable>["attributes"];
  dragListeners: ReturnType<typeof useSortable>["listeners"];
  onSetColor: (color: string) => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-testid={`group-header-${group.id}`}
      className="group/grouphdr bg-surface sticky top-[30px] z-30 flex h-[30px] w-full items-center pointer-coarse:top-11 pointer-coarse:h-11"
    >
      <div className="sticky left-0 flex h-full w-[var(--board-viewport-w,100%)] min-w-0 items-center gap-1.5 px-2">
        {selectAll}
        <button
          type="button"
          aria-label={`Reorder ${group.name}`}
          {...dragAttributes}
          {...dragListeners}
          className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded-md opacity-0 transition-opacity group-hover/grouphdr:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-100"
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-6 shrink-0 place-items-center rounded-md focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11"
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>
        {/* Group colour, right next to the name it labels. */}
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
        />
        {renaming ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelRename();
              }
            }}
            aria-label={`Rename ${group.name}`}
            className="h-6 max-w-xs px-1.5 pointer-coarse:h-8"
          />
        ) : (
          <button
            type="button"
            onClick={onOpenRename}
            aria-label={group.name}
            // `text-group` stays OUT of cn(): tailwind-merge 3.6 treats custom
            // `--text-*` size tokens as text COLORS and would drop
            // `text-foreground` (see text-size-token-cn-merge.test.ts).
            className={`text-group ${cn(
              "text-foreground focus-visible:ring-ring min-w-0 truncate rounded-sm text-left font-semibold focus-visible:ring-2 focus-visible:outline-none",
            )}`}
          >
            {group.name}
          </button>
        )}
        <span className="bg-surface-muted text-muted-foreground text-2xs shrink-0 rounded-sm px-1.5 py-px tabular-nums">
          {itemCount}
        </span>
        {progress ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${group.name}: ${progress.done} of ${progress.total} done`}
              className="bg-foreground/[0.07] relative h-1 w-16 overflow-hidden rounded-full"
            >
              {/* Progress fill: one of the four sanctioned uses of the brand
                  gradient (pulse-ui → "Second accent and the brand gradient"). */}
              <span
                className="bg-brand-gradient absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${progress.percent}%` }}
              />
            </span>
            <span className="text-muted-foreground text-2xs tabular-nums">
              {progress.percent}% done
            </span>
          </span>
        ) : null}
        <GroupMenu
          group={group}
          onRename={onOpenRename}
          onSetColor={onSetColor}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
```

(`GroupMenu`'s trigger already carries `ml-auto`, which pushes it to the right edge of the inner block; `GroupMenu.tsx` is not edited.)

- [ ] **Step 7: Wire `GroupSection`, `BoardTableInner`, `ColumnHeader`, `CreatedHeaderCell`, `SummaryRow`**

`src/components/boards/table/GroupSection.tsx`:

- Remove `col,` from the destructured props (line 65) and `col: ColumnHeaderControls;` from the props type (line 95). Remove `type ColumnHeaderControls,` from the `./shared` import (line 35).
- Add `import { groupProgress } from "@/lib/boards/group-progress";`.
- After the `summaryItemIds` memo (line 226) add:

```tsx
// Done-rule progress over this group's visible top-level rows, for the group
// row's meter. `controls.statusColumn` is the board's first status column,
// resolved once in BoardTableInner. This component already re-renders on
// every `cellMap` change (it is a prop), so the memo adds no renders.
const progress = useMemo(
  () => groupProgress(itemIds, controls.statusColumn, cellMap),
  [itemIds, controls.statusColumn, cellMap],
);
```

- Replace the `<GroupHeaderRow … />` element (lines 250–277) with:

```tsx
<GroupHeaderRow
  group={group}
  selectAll={
    selectable && selectableIds.length > 0 ? (
      <GroupSelectAllCheckbox visibleIds={selectableIds} />
    ) : null
  }
  collapsed={collapsed}
  onToggleCollapse={() => groupControls.toggleCollapsed(group.id)}
  renaming={renaming}
  name={name}
  onNameChange={setName}
  onCommitRename={commitRename}
  onCancelRename={() => {
    setRenaming(false);
    groupControls.onRenameSettled();
  }}
  onOpenRename={openRename}
  itemCount={items.length}
  progress={progress}
  dragAttributes={attributes}
  dragListeners={listeners}
  onSetColor={(color) => groupControls.setColor(group.id, color)}
  onDelete={() => groupControls.remove(group.id)}
/>
```

`groupIndex` stays a prop of `GroupSection` (the scroll-margin effect depends on it) and its doc comment (line 84) becomes `/** Zero-based position among visible groups — a group reorder re-measures the row area. */`. The comment at lines 279–286 says the droppable "sits BELOW the header"; that is still true.

`src/components/boards/table/BoardTableInner.tsx`:

- Add `import { BoardColumnHeader } from "./BoardColumnHeader";` next to the other `./` imports (lines 81–83).
- After `const [scrolledX, setScrolledX] = useState(false);` (line 163) add:

```tsx
// The slim group rows pin their content to the VISIBLE width of the scroller
// (not the full table width), so a group's title stays in view during
// horizontal scroll. Published as a CSS variable with a direct style write —
// no React state, so resizing the window re-renders nothing.
useEffect(() => {
  const scroller = scrollContainerRef.current;
  if (!scroller) return;
  const publish = () =>
    scroller.style.setProperty(
      "--board-viewport-w",
      `${scroller.clientWidth}px`,
    );
  publish();
  const ro = new ResizeObserver(publish);
  ro.observe(scroller);
  return () => ro.disconnect();
}, []);
```

- Line 434: "500 13.5px Inter" → "500 13px Inter". Lines 467–471: replace "keeps the server's grid template on the group headers" with "keeps the server's grid template on the column header" and "shifting every header off its column" stays.
- Lines 821–822, the content wrapper gains the header as its first child:

```tsx
        <div ref={contentRef} className="min-w-fit">
          <BoardColumnHeader
            columns={columns}
            template={template}
            col={columnControls}
          />
          {groups.length === 0 ? (
```

- In the `<GroupSection … />` element (lines 851–879) delete the line `col={columnControls}`.
- The comment at lines 541–545 ("shared by every group's header row") becomes "used by the board's single column header".

`src/components/boards/ColumnHeader.tsx`, line 118: `"group/col relative flex items-center gap-1 px-4 pt-3.5 pb-2.5",` → `"group/col relative flex h-full min-w-0 items-center gap-1 px-2",`

`src/components/boards/table/CreatedHeaderCell.tsx`, line 15: `className="text-kicker flex items-center gap-1.5 px-4"` → `className="text-kicker flex h-full min-w-0 items-center gap-1.5 px-2"`

`src/components/boards/SummaryRow.tsx`, line 230: `"sticky bottom-0 z-[15] min-h-[38px]",` → `"sticky bottom-0 z-[45] min-h-[38px]",` and add above it: `// z-[45]: above the sticky group rows (z-30) and the column header (z-40), below portalled menus (z-50).`

- [ ] **Step 8: Run the touched suites, typecheck and lint**

Run: `pnpm vitest run --project unit src/components/boards/BoardTable.test.tsx src/components/boards/BoardTable.created-columns.test.tsx src/components/boards/BoardTable.render-count.test.tsx src/components/boards/BoardTable.cross-group-dnd.test.tsx src/components/boards/BoardTable.intel.test.tsx src/components/boards/BoardTable.overdue.test.tsx src/components/boards/BoardTable.priority.test.tsx src/components/boards/BoardTable.dependents-map.test.tsx src/components/boards/table src/components/boards/ColumnHeader.test.tsx src/components/boards/SummaryRow.test.tsx src/components/boards/text-size-token-cn-merge.test.ts src/lib/boards/group-progress.test.ts`

Expected: PASS, every file.

Run: `pnpm exec prettier --write src/components/boards/table src/components/boards/ColumnHeader.tsx src/components/boards/SummaryRow.tsx src/lib/boards/group-progress.ts src/app/globals.css && pnpm typecheck && pnpm lint`

Expected: both exit 0. If typecheck reports an unused `Kicker` import anywhere, it is in a file this task replaced wholesale; the replacement above imports only what it uses.

- [ ] **Step 9: Hand back**

Report the files changed, the test command with its pass count, and the typecheck / lint result. State explicitly that the sticky behaviour and stacking (header over group row over rows, group row pushed out by the next group, title pinned during horizontal scroll, board total over everything) are **not** covered by these tests and are on the orchestrator's browser list. Do not stage, commit or stash anything.

---

### Task 4: Column fit, logic (pure fit function, `resizeColumn(null)`, `resetColumnWidths`)

**Files:**

- Create: `src/lib/boards/fit-column-width.ts`
- Create: `src/lib/boards/fit-column-width.test.ts`
- Modify: `src/lib/validations/board-actions.ts` (lines 104–107; one new schema after line 117)
- Modify: `src/lib/boards/core/column.ts` (line 129, the input type only)
- Modify: `src/lib/boards/actions/column.ts` (imports 4–13; lines 82–90; one new action after line 124)
- Modify: `src/lib/boards/cache.ts` (one new function after `replaceColumn`, line 254)
- Modify: `src/lib/boards/mutations/columns.ts` (imports 4–12; lines 163–185; return 242–250)
- Modify: `src/lib/boards/use-board-mutations.ts` (lines 50–58, 187–188)
- Test: `src/lib/validations/board-actions.test.ts`, `src/lib/boards/actions/column.test.ts`, `src/lib/boards/cache.test.ts`, `src/lib/boards/use-board-mutations.test.tsx`

This task touches nothing under `src/components/` and not `table/shared.ts` (Task 1 edits it in the same batch). `ColumnHeaderControls.resizeColumn` stays `(id, w: number) => void` until Task 5; a function that accepts `number | null` is assignable to it, so typecheck stays green.

**No migration.** See "Checked facts (a)". Do not run `scripts/new-migration.sh`, any Supabase MCP tool, or `pnpm db:types`.

**Interfaces:**

- Consumes: `stripMarkdown` (`@/lib/boards/markdown`), `formatCurrency`, `currencyOf` (`@/lib/boards/currency`), `ActionResult` / `fail` (`@/lib/actions/result`), `createClient` (`@/lib/supabase/server`), `BoardMutationCtx` (`./mutations/shared`).
- Produces, from `@/lib/boards/fit-column-width`:
  - `COLUMN_FIT_MIN = 72`, `COLUMN_FIT_MAX = 360`, `COLUMN_FIT_DEFAULT = 180`
  - `type FitFont = "cell" | "chip" | "mono" | "header"`
  - `type FitMeasure = (text: string, font: FitFont) => number`
  - `type FitColumn = { id: string; kind: string; name: string; settings: unknown; width: number | null }`
  - `type FitMember = { userId: string; fullName: string | null; email: string | null; mono?: unknown }`
  - `fitColumnWidth(column: Pick<FitColumn, "kind" | "name" | "settings">, values: readonly unknown[], measure: FitMeasure, members?: readonly FitMember[]): number`
  - `fitBoardColumns(columns: readonly FitColumn[], cellValues: readonly { column_id: string; value: unknown }[], measure: FitMeasure, members?: readonly FitMember[]): Record<string, number>` (only columns whose `width` is null get an entry)
- Produces, server and client data layer:
  - `resizeColumnSchema.width`: `number (int, 80–1200) | null`; `resetColumnWidthsSchema = z.object({ boardId: uuid })`
  - `resizeColumn(input: { columnId: string; width: number | null }): Promise<ActionResult>`
  - `resetColumnWidths(input: { boardId: string }): Promise<ActionResult>`
  - `resizeColumnCore(supabase, input: { columnId: string; width: number | null })`
  - `clearColumnWidths(cache: BoardCache): BoardCache` from `@/lib/boards/cache`
  - `useBoardMutations(...).resizeColumn: (columnId: string, width: number | null) => void`
  - `useBoardMutations(...).resetColumnWidths: () => void`

**Widths `fitColumnWidth` returns.** Every result is `round(clamp(max(content, headerFloor), 72, 360))`.

| Kind                                                    | Content width                                                                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`, `link`, `email`, `phone`                        | widest value at the cell font + 16 (cell padding 8 + 8). Text is `stripMarkdown`-ed; a link uses its label, else its URL                                    |
| `numbers`                                               | widest `toFixed(precision)` + unit, cell font, + 16                                                                                                         |
| `currency`                                              | widest `formatCurrency(amount, currencyOf(settings))`, cell font, + 16                                                                                      |
| `status`                                                | widest label **in use** at the chip font + 20 (chip `px-2.5`) + 16                                                                                          |
| `dropdown`                                              | widest row: Σ(label + 20) + 4 per gap, + 16                                                                                                                 |
| `people`                                                | one assignee: 24 (avatar) + 6 + name (+ 44 for a Mono's Agent chip); several: 24 + 16 per extra avatar up to 4 discs; no member directory: "N people"; + 16 |
| `date`                                                  | 116 fixed ("NOV 14, 2026" in the 11px tracked mono kicker ≈ 95 + 16, with slack)                                                                            |
| `checkbox`                                              | 72 fixed                                                                                                                                                    |
| `rating`                                                | 96 fixed (5 stars 14px + gaps + 16)                                                                                                                         |
| `percent`                                               | 120 fixed (bar + "100%" + 16)                                                                                                                               |
| `priority`                                              | 108 fixed (the "Critical" pill with its auto icon + 16); not in the spec's table, it is a fixed-vocabulary pill                                             |
| `files`, `relation`, `mirror`, `time_tracking`, unknown | 180, not measured                                                                                                                                           |

`headerFloor = measure(NAME.toUpperCase(), "header") + name.length × 1.2 + 48`: the label is a 10px mono kicker with `0.12em` tracking, and 48 is 24px on each side for the pinned grip and menu button (Task 6 lays the header out to match). Two cost guards: identical strings in a column are measured once, and a string longer than 120 characters returns the 360 cap without being measured.

- [ ] **Step 1: Write the failing tests for the fit function**

Create `src/lib/boards/fit-column-width.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { formatCurrency } from "@/lib/boards/currency";
import {
  COLUMN_FIT_DEFAULT,
  COLUMN_FIT_MAX,
  COLUMN_FIT_MIN,
  fitBoardColumns,
  fitColumnWidth,
  type FitMeasure,
} from "./fit-column-width";

// Stub measurer (jsdom's canvas measures nothing): 6px per character for the
// header kicker, 7px for every other font.
const measure: FitMeasure = (text, font) =>
  text.length * (font === "header" ? 6 : 7);

/** headerFloor for a label: 6px/char + 1.2px tracking/char + 48 chrome. */
const floor = (name: string) => name.length * 6 + name.length * 1.2 + 48;

const col = (kind: string, name = "Notes", settings: unknown = {}) => ({
  kind,
  name,
  settings,
});

describe("fitColumnWidth — measured text kinds", () => {
  it("text: widest value at the cell font plus the cell padding", () => {
    const values = [{ text: "short" }, { text: "hello world" }];
    // 11 chars × 7 = 77, + 16 = 93 (beats the 84 header floor for "Notes")
    expect(fitColumnWidth(col("text"), values, measure)).toBe(93);
  });

  it("text: measures the Markdown-stripped text the cell shows", () => {
    const values = [{ text: `**${"x".repeat(20)}**` }];
    expect(fitColumnWidth(col("text"), values, measure)).toBe(20 * 7 + 16);
  });

  it("link: measures the label, falling back to the URL", () => {
    const labelled = [
      { url: "https://example.com/a/very/long/path", text: "Docs" },
    ];
    // 4 × 7 + 16 = 44, under the floor for "Link" (4×6 + 4.8 + 48 = 76.8 → 77)
    expect(fitColumnWidth(col("link", "Link"), labelled, measure)).toBe(77);
    const bare = [{ url: "https://example.com/abc" }]; // 23 chars
    expect(fitColumnWidth(col("link", "Link"), bare, measure)).toBe(
      23 * 7 + 16,
    );
  });

  it("email and phone: widest value", () => {
    expect(
      fitColumnWidth(
        col("email", "E"),
        [{ email: "ada@example.com" }],
        measure,
      ),
    ).toBe(15 * 7 + 16);
    expect(
      fitColumnWidth(
        col("phone", "P"),
        [{ phone: "+971 50 123 4567" }],
        measure,
      ),
    ).toBe(16 * 7 + 16);
  });

  it("numbers: widest formatted value, with precision and unit", () => {
    const column = col("numbers", "Qty", { precision: 2, unit: "kg" });
    // "1234.50 kg" = 10 chars × 7 + 16 = 86
    expect(fitColumnWidth(column, [{ n: 1234.5 }, { n: 2 }], measure)).toBe(86);
  });

  it("currency: widest formatted amount in the column's currency", () => {
    const column = col("currency", "Cost", { currency: "USD" });
    const widest = formatCurrency(1234567.5, "USD");
    expect(
      fitColumnWidth(column, [{ amount: 12 }, { amount: 1234567.5 }], measure),
    ).toBe(widest.length * 7 + 16);
  });
});

describe("fitColumnWidth — option kinds", () => {
  const settings = {
    options: [
      { id: "a", label: "Done", color: "#00c875" },
      { id: "b", label: "Working on it", color: "#fdab3d" },
      { id: "c", label: "An unused and very long option label", color: "#ccc" },
    ],
  };

  it("status: widest label that is IN USE, plus chip and cell padding", () => {
    const values = [{ optionId: "a" }, { optionId: "b" }];
    // "Working on it" 13 × 7 = 91, + 20 chip + 16 cell = 127
    expect(
      fitColumnWidth(col("status", "Status", settings), values, measure),
    ).toBe(127);
  });

  it("status: an unused long option does not widen the column", () => {
    const values = [{ optionId: "a" }];
    // "Done" 28 + 20 + 16 = 64, under the floor for "Status" (91.2 → 91)
    expect(
      fitColumnWidth(col("status", "Status", settings), values, measure),
    ).toBe(91);
  });

  it("dropdown: the widest row of chips, with the gaps between them", () => {
    const values = [{ optionIds: ["a"] }, { optionIds: ["a", "b"] }];
    // (28 + 20) + (91 + 20) + 4 gap = 163, + 16 = 179
    expect(
      fitColumnWidth(col("dropdown", "Tags", settings), values, measure),
    ).toBe(179);
  });

  it("ignores option ids that no longer exist", () => {
    const values = [{ optionId: "gone" }, { optionIds: ["gone", "a"] }];
    expect(
      fitColumnWidth(col("dropdown", "T", settings), values, measure),
    ).toBe(Math.max(COLUMN_FIT_MIN, 28 + 20 + 16));
  });
});

describe("fitColumnWidth — people", () => {
  const members = [
    { userId: "u1", fullName: "Ada Lovelace", email: null },
    { userId: "u2", fullName: null, email: "grace@example.com" },
    {
      userId: "m1",
      fullName: "Scout",
      email: null,
      mono: { color: "#8ea2eb" },
    },
  ];

  it("one assignee: avatar plus the name", () => {
    // 24 + 6 + 12 × 7 = 114, + 16 = 130
    expect(
      fitColumnWidth(
        col("people", "Owner"),
        [{ userIds: ["u1"] }],
        measure,
        members,
      ),
    ).toBe(130);
  });

  it("falls back to the email when there is no full name", () => {
    // 24 + 6 + 17 × 7 = 149, + 16 = 165
    expect(
      fitColumnWidth(
        col("people", "Owner"),
        [{ userIds: ["u2"] }],
        measure,
        members,
      ),
    ).toBe(165);
  });

  it("reserves the Agent chip for a Mono", () => {
    // 24 + 6 + 5 × 7 + 44 = 109, + 16 = 125
    expect(
      fitColumnWidth(
        col("people", "Owner"),
        [{ userIds: ["m1"] }],
        measure,
        members,
      ),
    ).toBe(125);
  });

  it("several assignees: a stack capped at four discs", () => {
    const five = [{ userIds: ["u1", "u2", "m1", "x", "y"] }];
    // 24 + 3 × 16 = 72, + 16 = 88 (beats the 84 header floor for "Owner")
    expect(fitColumnWidth(col("people", "Owner"), five, measure, members)).toBe(
      88,
    );
  });

  it("without a member directory, measures the count label", () => {
    // "2 people" = 8 × 7 = 56, + 16 = 72; floor for "Owner" = 30 + 6 + 48 = 84
    expect(
      fitColumnWidth(
        col("people", "Owner"),
        [{ userIds: ["u1", "u2"] }],
        measure,
      ),
    ).toBe(84);
  });
});

describe("fitColumnWidth — fixed and unmeasured kinds", () => {
  it("date, rating and percent are fixed per type, whatever the values", () => {
    expect(
      fitColumnWidth(col("date", "Due"), [{ date: "2026-11-14" }], measure),
    ).toBe(116);
    expect(fitColumnWidth(col("date", "Due"), [], measure)).toBe(116);
    expect(fitColumnWidth(col("rating", "R"), [{ rating: 5 }], measure)).toBe(
      96,
    );
    expect(
      fitColumnWidth(col("percent", "P"), [{ percent: 50 }], measure),
    ).toBe(120);
    expect(fitColumnWidth(col("priority", "P"), [], measure)).toBe(108);
  });

  it("checkbox is the minimum unless its header label needs more", () => {
    expect(fitColumnWidth(col("checkbox", "OK"), [], measure)).toBe(
      COLUMN_FIT_MIN,
    );
    // "Done?" → 30 + 6 + 48 = 84
    expect(fitColumnWidth(col("checkbox", "Done?"), [], measure)).toBe(84);
  });

  it("files, relation, mirror and time tracking stay at 180 and are not measured", () => {
    const spy = vi.fn(measure);
    for (const kind of ["files", "relation", "mirror", "time_tracking"]) {
      expect(fitColumnWidth(col(kind, "X"), [{ anything: 1 }], spy)).toBe(
        COLUMN_FIT_DEFAULT,
      );
    }
    // Only the header label is ever measured for these.
    expect(spy.mock.calls.every(([, font]) => font === "header")).toBe(true);
  });

  it("an unknown kind falls back to 180", () => {
    expect(fitColumnWidth(col("hologram", "X"), [], measure)).toBe(
      COLUMN_FIT_DEFAULT,
    );
  });
});

describe("fitColumnWidth — header floor, clamps, cost guards", () => {
  it("is never narrower than the header label and its menu button", () => {
    const name = "A very long column header"; // 25 chars
    expect(fitColumnWidth(col("text", name), [{ text: "x" }], measure)).toBe(
      Math.round(floor(name)), // 150 + 30 + 48 = 228
    );
  });

  it("measures the header label uppercased, as the kicker renders it", () => {
    const spy = vi.fn(measure);
    fitColumnWidth(col("text", "Notes"), [], spy);
    expect(spy).toHaveBeenCalledWith("NOTES", "header");
  });

  it("clamps an empty, short-labelled column to the 72px minimum", () => {
    // "P0" → 12 + 2.4 + 48 = 62.4
    expect(fitColumnWidth(col("text", "P0"), [], measure)).toBe(COLUMN_FIT_MIN);
  });

  it("clamps a wide column to 360", () => {
    expect(
      fitColumnWidth(col("text"), [{ text: "x".repeat(100) }], measure),
    ).toBe(COLUMN_FIT_MAX);
  });

  it("does not measure a string longer than 120 characters: it is the cap", () => {
    const long = "x".repeat(121);
    const spy = vi.fn(measure);
    expect(fitColumnWidth(col("text"), [{ text: long }], spy)).toBe(
      COLUMN_FIT_MAX,
    );
    expect(spy).not.toHaveBeenCalledWith(long, "cell");
  });

  it("measures identical values once", () => {
    const spy = vi.fn(measure);
    fitColumnWidth(
      col("text"),
      [{ text: "same" }, { text: "same" }, { text: "same" }],
      spy,
    );
    expect(spy.mock.calls.filter(([, font]) => font === "cell")).toHaveLength(
      1,
    );
  });

  it("ignores null and malformed cell values", () => {
    const values = [null, undefined, 7, "x", {}, { text: 42 }, { text: "ok" }];
    // "ok" 14 + 16 = 30 → header floor for "Notes" = 84
    expect(fitColumnWidth(col("text"), values, measure)).toBe(84);
  });

  it("returns an integer", () => {
    const w = fitColumnWidth(col("text", "Abc"), [], measure);
    expect(Number.isInteger(w)).toBe(true);
  });
});

describe("fitBoardColumns", () => {
  const columns = [
    { id: "c1", kind: "text", name: "Notes", settings: {}, width: null },
    { id: "c2", kind: "text", name: "Saved", settings: {}, width: 240 },
    { id: "c3", kind: "date", name: "Due", settings: {}, width: null },
  ];
  const cellValues = [
    { column_id: "c1", value: { text: "hello world" } },
    { column_id: "c2", value: { text: "x".repeat(80) } },
    { column_id: "c1", value: { text: "hi" } },
  ];

  it("fits every column without a saved width, and only those", () => {
    expect(fitBoardColumns(columns, cellValues, measure)).toEqual({
      c1: 93,
      c3: 116,
    });
  });

  it("never measures the values of a column that has a saved width", () => {
    const spy = vi.fn(measure);
    fitBoardColumns(columns, cellValues, spy);
    expect(spy).not.toHaveBeenCalledWith("x".repeat(80), "cell");
  });

  it("returns an empty map when every column has a saved width", () => {
    expect(fitBoardColumns([columns[1]], cellValues, measure)).toEqual({});
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run --project unit src/lib/boards/fit-column-width.test.ts`

Expected: FAIL, cannot resolve `./fit-column-width`.

- [ ] **Step 3: Implement the fit function**

Create `src/lib/boards/fit-column-width.ts`:

```ts
import { currencyOf, formatCurrency } from "@/lib/boards/currency";
import { stripMarkdown } from "@/lib/boards/markdown";

/**
 * Auto-fit for value columns: a column the user has never resized is as wide
 * as its content needs. The Name column has worked this way since
 * `fitNameColumnWidth` (./name-column-width); this is the same idea for every
 * other column.
 *
 * These bounds are for RENDERING an auto-fitted column. They are never
 * persisted: a saved `columns.width` is still 80–1200 (DB check constraint +
 * `resizeColumnSchema`), and null means "auto-fit".
 */
export const COLUMN_FIT_MIN = 72;
export const COLUMN_FIT_MAX = 360;
/** Width of a column whose content is not measured (and the pre-hydration width). */
export const COLUMN_FIT_DEFAULT = 180;

/**
 * Which rendered font a string is measured in. The caller owns the canvas and
 * the real font strings (see table/use-column-auto-fit); this module stays
 * DOM-free so it is unit-testable (jsdom's `measureText` returns 0).
 *  - cell:   value text (`text-cell`, 12.5px Inter 400 in the table)
 *  - chip:   status / dropdown pill label (`text-xs` Inter 500)
 *  - mono:   reserved for mono metadata text
 *  - header: the column label (10px mono kicker, uppercase)
 */
export type FitFont = "cell" | "chip" | "mono" | "header";
export type FitMeasure = (text: string, font: FitFont) => number;

export type FitColumn = {
  id: string;
  kind: string;
  name: string;
  settings: unknown;
  width: number | null;
};

export type FitMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
  /** Set when the member is a Mono: its name is followed by an Agent chip. */
  mono?: unknown;
};

// Geometry, mirrored from the markup. If a class changes there, change the
// matching number here (the plan's browser verification checks the result).
/** A value cell's horizontal padding: `px-2` on both sides. */
const CELL_PAD = 16;
/** ColorChip / StatusPill horizontal padding: `px-2.5` on both sides. */
const CHIP_PAD = 20;
/** DropdownCell `gap-1`. */
const CHIP_GAP = 4;
/** MemberAvatar `size-6`, and the `gap-1.5` before the name. */
const AVATAR = 24;
const AVATAR_GAP = 6;
/** Stacked avatars overlap by `-ml-2`: each extra disc adds 24 − 8. */
const AVATAR_STACK_STEP = 16;
/** PeopleCell shows at most four discs (three avatars + "+N"). */
const MAX_STACKED_AVATARS = 4;
/** The "Agent" chip after a Mono's name, with its gap. */
const AGENT_CHIP = 44;
/**
 * Room around a centered header label: 24px on each side for the pinned
 * reorder grip (left) and menu button (right) — see ColumnHeader.
 */
const HEADER_CHROME = 48;
/** The kicker's `tracking-[0.12em]` at 10px, per character. */
const HEADER_TRACKING = 1.2;
/** Longer than this cannot fit in COLUMN_FIT_MAX at any font here: skip measuring. */
const LONG_TEXT_CHARS = 120;

const FIXED_WIDTH = new Map<string, number>([
  ["date", 116],
  ["checkbox", COLUMN_FIT_MIN],
  ["rating", 96],
  ["percent", 120],
  ["priority", 108],
]);
const TEXTUAL = new Set([
  "text",
  "link",
  "email",
  "phone",
  "numbers",
  "currency",
]);
const UNMEASURED = new Set(["files", "relation", "mirror", "time_tracking"]);

const NO_MEMBERS: readonly FitMember[] = [];
const NO_VALUES: readonly unknown[] = [];

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj | null {
  return typeof value === "object" && value !== null ? (value as Obj) : null;
}

/** The single line of text a textual cell shows for a value, or null. */
function textOf(kind: string, value: Obj, settings: Obj): string | null {
  switch (kind) {
    case "text":
      if (typeof value.text !== "string") return null;
      // Far past the cap either way: don't pay for the Markdown strip.
      return value.text.length > LONG_TEXT_CHARS * 2
        ? value.text
        : stripMarkdown(value.text);
    case "link": {
      const label =
        typeof value.text === "string" && value.text ? value.text : value.url;
      return typeof label === "string" ? label : null;
    }
    case "email":
      return typeof value.email === "string" ? value.email : null;
    case "phone":
      return typeof value.phone === "string" ? value.phone : null;
    case "numbers": {
      if (typeof value.n !== "number") return null;
      const n =
        typeof settings.precision === "number"
          ? value.n.toFixed(settings.precision)
          : String(value.n);
      return typeof settings.unit === "string" && settings.unit
        ? `${n} ${settings.unit}`
        : n;
    }
    case "currency":
      return typeof value.amount === "number"
        ? formatCurrency(value.amount, currencyOf(settings))
        : null;
    default:
      return null;
  }
}

function fitTextual(
  kind: string,
  values: readonly unknown[],
  settings: Obj,
  measure: FitMeasure,
): number {
  const seen = new Set<string>();
  let widest = 0;
  for (const raw of values) {
    const value = asObj(raw);
    if (!value) continue;
    const text = textOf(kind, value, settings);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    if (text.length > LONG_TEXT_CHARS) return COLUMN_FIT_MAX;
    const w = measure(text, "cell");
    if (w > widest) widest = w;
    if (widest >= COLUMN_FIT_MAX) return COLUMN_FIT_MAX;
  }
  return widest + CELL_PAD;
}

function fitOptions(
  kind: string,
  values: readonly unknown[],
  settings: Obj,
  measure: FitMeasure,
): number {
  const labelById = new Map<string, string>();
  if (Array.isArray(settings.options)) {
    for (const raw of settings.options) {
      const option = asObj(raw);
      if (
        option &&
        typeof option.id === "string" &&
        typeof option.label === "string"
      ) {
        labelById.set(option.id, option.label);
      }
    }
  }
  // Chip widths, measured lazily: only labels that are in use are measured.
  const chipById = new Map<string, number>();
  const chip = (id: string): number => {
    let w = chipById.get(id);
    if (w === undefined) {
      const label = labelById.get(id);
      w = label === undefined ? 0 : measure(label, "chip") + CHIP_PAD;
      chipById.set(id, w);
    }
    return w;
  };

  let widest = 0;
  for (const raw of values) {
    const value = asObj(raw);
    if (!value) continue;
    let row = 0;
    if (kind === "status") {
      if (typeof value.optionId === "string") row = chip(value.optionId);
    } else if (Array.isArray(value.optionIds)) {
      let shown = 0;
      for (const id of value.optionIds) {
        if (typeof id !== "string") continue;
        const w = chip(id);
        if (w === 0) continue;
        row += w;
        shown++;
      }
      if (shown > 1) row += CHIP_GAP * (shown - 1);
    }
    if (row > widest) widest = row;
  }
  return widest + CELL_PAD;
}

function fitPeople(
  values: readonly unknown[],
  measure: FitMeasure,
  members: readonly FitMember[],
): number {
  const byId = new Map(members.map((m) => [m.userId, m]));
  let widest = 0;
  for (const raw of values) {
    const value = asObj(raw);
    const ids =
      value && Array.isArray(value.userIds)
        ? value.userIds.filter((id): id is string => typeof id === "string")
        : [];
    if (ids.length === 0) continue;
    let row: number;
    if (members.length === 0) {
      // PeopleCell's fallback when it cannot resolve ids to names.
      row = measure(
        `${ids.length} ${ids.length === 1 ? "person" : "people"}`,
        "cell",
      );
    } else if (ids.length === 1) {
      const member = byId.get(ids[0]);
      const label = member?.fullName || member?.email || "Unknown";
      row =
        AVATAR +
        AVATAR_GAP +
        measure(label, "cell") +
        (member?.mono ? AGENT_CHIP : 0);
    } else {
      row =
        AVATAR +
        (Math.min(ids.length, MAX_STACKED_AVATARS) - 1) * AVATAR_STACK_STEP;
    }
    if (row > widest) widest = row;
  }
  return widest + CELL_PAD;
}

/**
 * The width one column needs: its content (by kind — see the table in the
 * plan / spec), never narrower than its own header label, clamped to
 * [COLUMN_FIT_MIN, COLUMN_FIT_MAX] and rounded to an integer.
 *
 * `values` are the column's raw cell values (any order; null / malformed
 * entries are skipped). `members` resolves People ids to names.
 */
export function fitColumnWidth(
  column: Pick<FitColumn, "kind" | "name" | "settings">,
  values: readonly unknown[],
  measure: FitMeasure,
  members: readonly FitMember[] = NO_MEMBERS,
): number {
  const header =
    measure(column.name.toUpperCase(), "header") +
    column.name.length * HEADER_TRACKING +
    HEADER_CHROME;
  const settings = asObj(column.settings) ?? {};
  const fixed = FIXED_WIDTH.get(column.kind);

  let content: number;
  if (fixed !== undefined) content = fixed;
  else if (UNMEASURED.has(column.kind)) content = COLUMN_FIT_DEFAULT;
  else if (column.kind === "status" || column.kind === "dropdown")
    content = fitOptions(column.kind, values, settings, measure);
  else if (column.kind === "people")
    content = fitPeople(values, measure, members);
  else if (TEXTUAL.has(column.kind))
    content = fitTextual(column.kind, values, settings, measure);
  else content = COLUMN_FIT_DEFAULT;

  return Math.round(
    Math.min(COLUMN_FIT_MAX, Math.max(COLUMN_FIT_MIN, content, header)),
  );
}

/**
 * Fit every column that has no saved width. Returns `{ [columnId]: width }`
 * with entries ONLY for those columns; a column with a saved width is neither
 * measured nor listed. One pass over `cellValues` to bucket them by column.
 */
export function fitBoardColumns(
  columns: readonly FitColumn[],
  cellValues: readonly { column_id: string; value: unknown }[],
  measure: FitMeasure,
  members: readonly FitMember[] = NO_MEMBERS,
): Record<string, number> {
  const unsaved = columns.filter((c) => c.width == null);
  if (unsaved.length === 0) return {};
  const wanted = new Set(unsaved.map((c) => c.id));
  const byColumn = new Map<string, unknown[]>();
  for (const cell of cellValues) {
    if (!wanted.has(cell.column_id)) continue;
    const list = byColumn.get(cell.column_id);
    if (list) list.push(cell.value);
    else byColumn.set(cell.column_id, [cell.value]);
  }
  const out: Record<string, number> = {};
  for (const column of unsaved) {
    out[column.id] = fitColumnWidth(
      column,
      byColumn.get(column.id) ?? NO_VALUES,
      measure,
      members,
    );
  }
  return out;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm vitest run --project unit src/lib/boards/fit-column-width.test.ts`

Expected: PASS (all six describes).

- [ ] **Step 5: Write the failing tests for the server and cache layer**

`src/lib/validations/board-actions.test.ts`: add `resizeColumnSchema` and `resetColumnWidthsSchema` to the import from `./board-actions`, and add inside `describe("board action schemas", …)`:

```ts
it("resizeColumn accepts an in-range width and null (back to auto-fit)", () => {
  expect(
    resizeColumnSchema.safeParse({ columnId: uuid, width: 300 }).success,
  ).toBe(true);
  expect(
    resizeColumnSchema.safeParse({ columnId: uuid, width: null }).success,
  ).toBe(true);
});

it("resizeColumn still rejects out-of-range, fractional and missing widths", () => {
  expect(
    resizeColumnSchema.safeParse({ columnId: uuid, width: 72 }).success,
  ).toBe(false);
  expect(
    resizeColumnSchema.safeParse({ columnId: uuid, width: 5000 }).success,
  ).toBe(false);
  expect(
    resizeColumnSchema.safeParse({ columnId: uuid, width: 120.5 }).success,
  ).toBe(false);
  expect(resizeColumnSchema.safeParse({ columnId: uuid }).success).toBe(false);
});

it("resetColumnWidths requires a board uuid", () => {
  expect(resetColumnWidthsSchema.safeParse({ boardId: uuid }).success).toBe(
    true,
  );
  expect(resetColumnWidthsSchema.safeParse({ boardId: "nope" }).success).toBe(
    false,
  );
});
```

`src/lib/boards/actions/column.test.ts`: add `resetColumnWidths` to the import from `./column`. Inside `describe("resizeColumn", …)` add:

```ts
it("clears the saved width with null (back to auto-fit)", async () => {
  const onUpdate = vi.fn();
  let call = 0;
  from.mockImplementation(() =>
    ++call === 1 ? boardIdLookup(BOARD_ID) : updateTable({ onUpdate }),
  );
  const res = await resizeColumn({ columnId: COLUMN_ID, width: null });
  expect(res).toEqual({ ok: true, data: undefined });
  expect(onUpdate).toHaveBeenCalledWith({ width: null });
});
```

and append a new describe at the end of the file:

```ts
describe("resetColumnWidths", () => {
  type Seen = { patch?: unknown; eq?: unknown[] };

  /** boards: `.update(patch).eq("id", …).select("id").maybeSingle()` */
  function boardsTable(
    result: { data: unknown; error: unknown },
    seen: Seen = {},
  ) {
    return {
      update: (patch: unknown) => {
        seen.patch = patch;
        return {
          eq: (...args: unknown[]) => {
            seen.eq = args;
            return {
              select: () => ({
                maybeSingle: vi.fn().mockResolvedValue(result),
              }),
            };
          },
        };
      },
    };
  }

  /** columns: `.update(patch).eq("board_id", …)` */
  function columnsTable(result: { error: unknown }, seen: Seen = {}) {
    return {
      update: (patch: unknown) => {
        seen.patch = patch;
        return {
          eq: async (...args: unknown[]) => {
            seen.eq = args;
            return result;
          },
        };
      },
    };
  }

  function route(tables: Record<string, unknown>) {
    from.mockImplementation((name: string) => tables[name]);
  }

  it("rejects an invalid board id before touching the database", async () => {
    const res = await resetColumnWidths({ boardId: "nope" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("clears the Name width and every column width, scoped to the board", async () => {
    const board: Seen = {};
    const columns: Seen = {};
    route({
      boards: boardsTable({ data: { id: BOARD_ID }, error: null }, board),
      columns: columnsTable({ error: null }, columns),
    });
    const res = await resetColumnWidths({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(board.patch).toEqual({ name_column_width: null });
    expect(board.eq).toEqual(["id", BOARD_ID]);
    expect(columns.patch).toEqual({ width: null });
    expect(columns.eq).toEqual(["board_id", BOARD_ID]);
  });

  it("fails closed, and leaves the columns alone, when the board write matched no row (a viewer, or another tenant, under RLS)", async () => {
    const columns: Seen = {};
    route({
      boards: boardsTable({ data: null, error: null }),
      columns: columnsTable({ error: null }, columns),
    });
    const res = await resetColumnWidths({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: false, error: "Board not found." });
    expect(from).not.toHaveBeenCalledWith("columns");
    expect(columns.patch).toBeUndefined();
  });

  it("propagates a board update error", async () => {
    route({
      boards: boardsTable({ data: null, error: { message: "rls" } }),
      columns: columnsTable({ error: null }),
    });
    const res = await resetColumnWidths({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: false, error: "rls" });
  });

  it("propagates a columns update error", async () => {
    route({
      boards: boardsTable({ data: { id: BOARD_ID }, error: null }),
      columns: columnsTable({ error: { message: "boom" } }),
    });
    const res = await resetColumnWidths({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});
```

`src/lib/boards/cache.test.ts`: add `clearColumnWidths` to the import from `./cache`, and add inside `describe("column cache mutators", …)` (it uses that file's existing `col(id, position, over)` and `cache(columns)` helpers):

```ts
it("clearColumnWidths nulls every saved width and the Name width", () => {
  const untouched = col("b", 1);
  const start: BoardCache = {
    ...cache([col("a", 0, { width: 300 }), untouched]),
    board: {
      id: "b",
      org_id: "o",
      name_column_width: 420,
    } as BoardCache["board"],
  };
  const next = clearColumnWidths(start);
  expect(next.columns.map((c) => c.width)).toEqual([null, null]);
  expect(next.board.name_column_width).toBeNull();
  // A column that was already auto keeps its identity (no needless churn).
  expect(next.columns[1]).toBe(untouched);
  // Immutable.
  expect(start.columns[0].width).toBe(300);
  expect(start.board.name_column_width).toBe(420);
});
```

`src/lib/boards/use-board-mutations.test.tsx`: next to the other action mocks (line 16) add

```ts
const resizeColumn = vi.fn();
const resetColumnWidths = vi.fn();
```

and inside the `vi.mock("@/lib/boards/actions", …)` factory (lines 23–41) add

```ts
  resizeColumn: (...a: unknown[]) => resizeColumn(...a),
  resetColumnWidths: (...a: unknown[]) => resetColumnWidths(...a),
```

Then append, after `describe("useBoardMutations.reorderColumn", …)` (it reuses that file's `seedColumns`, `wrapper` and `boardKey`):

```tsx
/** seedColumns, then give c1 a saved width and the board a saved Name width. */
function seedSavedWidths(qc: QueryClient): void {
  seedColumns(qc);
  const key = boardKey("b1");
  const cache = qc.getQueryData<BoardCache>(key)!;
  qc.setQueryData<BoardCache>(key, {
    ...cache,
    board: { ...cache.board, name_column_width: 420 },
    columns: cache.columns.map((c) =>
      c.id === "c1" ? { ...c, width: 300 } : c,
    ),
  });
}

describe("useBoardMutations.resizeColumn(null)", () => {
  beforeEach(() => resizeColumn.mockReset());

  it("optimistically clears one column's saved width and sends null", async () => {
    const qc = new QueryClient();
    seedSavedWidths(qc);
    resizeColumn.mockResolvedValue({ ok: true, data: undefined });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.resizeColumn("c1", null);
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.columns.find((c) => c.id === "c1")!.width).toBeNull();
    await waitFor(() =>
      expect(resizeColumn).toHaveBeenCalledWith({
        columnId: "c1",
        width: null,
      }),
    );
  });
});

describe("useBoardMutations.resetColumnWidths", () => {
  beforeEach(() => resetColumnWidths.mockReset());

  it("optimistically clears every saved width and the Name width, in one action", async () => {
    const qc = new QueryClient();
    seedSavedWidths(qc);
    resetColumnWidths.mockResolvedValue({ ok: true, data: undefined });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.resetColumnWidths();
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.columns.map((c) => c.width)).toEqual([null, null]);
    expect(cache.board.name_column_width).toBeNull();
    await waitFor(() =>
      expect(resetColumnWidths).toHaveBeenCalledWith({ boardId: "b1" }),
    );
    expect(resetColumnWidths).toHaveBeenCalledTimes(1);
  });

  it("puts the widths back when the action fails", async () => {
    const qc = new QueryClient();
    seedSavedWidths(qc);
    resetColumnWidths.mockResolvedValue({ ok: false, error: "nope" });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.resetColumnWidths();
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.columns.find((c) => c.id === "c1")!.width).toBe(300);
      expect(cache.board.name_column_width).toBe(420);
    });
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run: `pnpm vitest run --project unit src/lib/validations/board-actions.test.ts src/lib/boards/actions/column.test.ts src/lib/boards/cache.test.ts src/lib/boards/use-board-mutations.test.tsx`

Expected: FAIL. `resetColumnWidthsSchema`, `resetColumnWidths` and `clearColumnWidths` are not exported; `resizeColumnSchema` rejects `width: null`; `result.current.resetColumnWidths is not a function`.

- [ ] **Step 7: Implement the server and cache layer**

`src/lib/validations/board-actions.ts`, replace lines 104–107 and add the new schema after `resizeNameColumnSchema` (line 117):

```ts
// NULL = no saved width: the client auto-fits the column to its content (see
// @/lib/boards/fit-column-width). An integer is a user-dragged width. Bounds
// mirror the DB check constraint (`width is null or width between 80 and 1200`).
export const resizeColumnSchema = z.object({
  columnId: uuid,
  width: z.number().int().min(80).max(1200).nullable(),
});
```

```ts
// "Fit all columns": clears every saved column width and the saved Name width.
export const resetColumnWidthsSchema = z.object({ boardId: uuid });
```

`src/lib/boards/core/column.ts`, line 129: `input: { columnId: string; width: number },` → `input: { columnId: string; width: number | null },`. The body is unchanged (`update({ width: input.width })` already accepts null: `columns.Update.width` is `number | null`). `src/lib/mcp/tools/manage-column.ts` calls this with a number and needs no change.

`src/lib/boards/actions/column.ts`:

- Add `resetColumnWidthsSchema,` to the import from `@/lib/validations/board-actions` (lines 4–13).
- Lines 82–85: the `resizeColumn` input type becomes `{ columnId: string; width: number | null }`, and above it add the doc comment `/** Persist a dragged column width, or clear it with \`width: null\` so the client auto-fits the column again. */`.
- After `resizeNameColumn` (line 124) add:

```ts
/**
 * "Fit all columns": clear every saved column width on a board AND the saved
 * Name width, so the whole table returns to auto-fit. One action, two
 * RLS-scoped writes, no revalidation (the caller patches its cache
 * optimistically, like `resizeNameColumn`).
 *
 * The board write goes first and reads its row back. Under RLS an update the
 * caller may not make (a viewer, or a board in another org) matches no row and
 * returns no data rather than an error, so `data === null` is the fail-closed
 * signal — the same shape as `reorderColumnCore`. Only then are the board's
 * columns cleared (`columns_board_id_idx`).
 *
 * Writes to `boards` as well as `columns`, and has no MCP tool action — so it
 * lives here beside `resizeNameColumn`, not in the core.
 */
export async function resetColumnWidths(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = resetColumnWidthsSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data: board, error: boardError } = await supabase
    .from("boards")
    .update({ name_column_width: null })
    .eq("id", parsed.data.boardId)
    .select("id")
    .maybeSingle();
  if (boardError) return fail(boardError.message);
  if (!board) return fail("Board not found.");
  const { error } = await supabase
    .from("columns")
    .update({ width: null })
    .eq("board_id", parsed.data.boardId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}
```

`src/lib/boards/cache.ts`, after `replaceColumn` (line 254):

```ts
/**
 * Clear every saved column width and the saved Name width ("Fit all columns").
 * Immutable; a column already at null keeps its identity.
 */
export function clearColumnWidths(cache: BoardCache): BoardCache {
  return {
    ...cache,
    board: { ...cache.board, name_column_width: null },
    columns: cache.columns.map((c) =>
      c.width === null ? c : { ...c, width: null },
    ),
  };
}
```

`src/lib/boards/mutations/columns.ts`:

- Add `resetColumnWidths,` to the import from `@/lib/boards/actions` and `clearColumnWidths,` to the import from `@/lib/boards/cache`.
- In `resizeColumnMutation` (line 166) the vars type becomes `{ columnId: string; width: number | null },`.
- After `resizeColumnMutation` add:

```ts
const resetColumnWidthsMutation = useMutation<unknown, Error, void, Ctx>({
  mutationFn: async () => {
    assertOnline();
    const res = await resetColumnWidths({ boardId });
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  // Targeted rollback, like every other mutation here: put back exactly the
  // widths this cleared, over the CURRENT cache, so a peer's edit to
  // anything else that landed meanwhile survives.
  onMutate: async () => {
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<BoardCache>(key);
    if (!previous) return {};
    const priorNameWidth = previous.board.name_column_width;
    const priorWidths = new Map(previous.columns.map((c) => [c.id, c.width]));
    qc.setQueryData<BoardCache>(key, clearColumnWidths(previous));
    return {
      rollback: (c) => ({
        ...c,
        board: { ...c.board, name_column_width: priorNameWidth },
        columns: c.columns.map((col) => {
          const prior = priorWidths.get(col.id);
          return prior === undefined || prior === col.width
            ? col
            : { ...col, width: prior };
        }),
      }),
    };
  },
  onError: (err, _v, ctx) => {
    rollback(ctx);
    showMutationError(
      "Couldn't fit the columns — your change was undone.",
      err,
    );
  },
});
```

- Add `resetColumnWidthsMutation,` to the returned object (lines 242–250).

`src/lib/boards/use-board-mutations.ts`:

- Add `resetColumnWidthsMutation,` to the destructure from `useColumnMutations(ctx)` (lines 50–58).
- Lines 187–188 become:

```ts
    resizeColumn: (columnId: string, width: number | null) =>
      resizeColumnMutation.mutate({ columnId, width }),
    resetColumnWidths: () => resetColumnWidthsMutation.mutate(),
```

- [ ] **Step 8: Run the touched suites, typecheck and lint**

Run: `pnpm vitest run --project unit src/lib/boards/fit-column-width.test.ts src/lib/validations/board-actions.test.ts src/lib/boards/actions/column.test.ts src/lib/boards/column-actions.test.ts src/lib/boards/core/column.test.ts src/lib/boards/cache.test.ts src/lib/boards/use-board-mutations.test.tsx src/test/use-server-exports.test.ts`

Expected: PASS, every file. (`use-server-exports.test.ts` guards that `actions/column.ts`, a `"use server"` module, still exports only async functions.)

Run: `pnpm exec prettier --write src/lib/boards src/lib/validations/board-actions.ts src/lib/validations/board-actions.test.ts && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 9: Hand back**

Report the files changed, the test command with its pass count, and the typecheck / lint result. State that no migration was created and no database was touched. Do not stage, commit or stash anything.

---

### Task 5: Column fit, UI (auto-fit fallback, double-click reset, "Fit all columns")

**Files:**

- Create: `src/components/boards/table/use-column-auto-fit.ts`
- Create: `src/components/boards/table/use-column-auto-fit.test.tsx`
- Modify: `src/components/boards/table/shared.ts` (lines 253–269, 308–322)
- Modify: `src/components/boards/table/SortableColumnHeader.tsx` (lines 7, 34, 38)
- Modify: `src/components/boards/ColumnHeader.tsx` (props 52–75; `onPointerDown` 89–112; resize handle 222–228)
- Modify: `src/components/boards/table/BoardTableInner.tsx` (imports; lines 498–501, 546–576, 775–787)
- Modify: `src/components/boards/BoardHeader.tsx` (imports 6–14; props 111–140; menu 322–341)
- Test: `src/components/boards/table/shared.test.ts`, `src/components/boards/ColumnHeader.test.tsx`, `src/components/boards/BoardHeader.test.tsx`, `src/components/boards/BoardTable.test.tsx`

**Interfaces:**

- Consumes: `fitBoardColumns`, `COLUMN_FIT_DEFAULT`, `FitColumn`, `FitFont`, `FitMeasure`, `FitMember` (Task 4); `useBoardMutations().resizeColumn(id, number | null)` and `.resetColumnWidths()` (Task 4); `useHydrated` (already used at `BoardTableInner.tsx:472`); `BoardColumnHeader` → `SortableColumnHeader` → `ColumnHeader` (Task 3); the 12.5px table cell size (Task 1).
- Produces:
  - `resolveColumnWidth(column: { id: string; width: number | null }, liveWidths: Record<string, number>, autoFitWidths?: Record<string, number>): number` from `table/shared.ts`.
  - `gridTemplate(columns, liveWidths, nameWidth, autoFitWidths?: Record<string, number>): string` (fourth parameter is new and optional).
  - `ColumnHeaderControls.autoFitWidths: Record<string, number>`; `ColumnHeaderControls.resizeColumn: (id: string, w: number | null) => void`.
  - `useColumnAutoFit(args: { columns: readonly FitColumn[]; cellValues: readonly { column_id: string; value: unknown }[]; itemCount: number; members: readonly FitMember[]; enabled: boolean }): Record<string, number>`, plus `buildFitFonts(fontInterVar: string, fontMonoVar: string): Record<FitFont, string>` and `FIT_FONT_SIZES`, from `table/use-column-auto-fit.ts`.
  - `ColumnHeader` prop `onAutoFit?: () => void`. A press on the resize handle without a move no longer calls `onResizeEnd`.
  - `BoardHeader` prop `onFitAllColumns?: () => void`; menu item "Fit all columns".
  - Created-by / Created-at tracks are 160px / 176px.

**Existing test this task breaks on purpose:** `ColumnHeader.test.tsx` → "a click on the handle without a move sends no live update" asserts `onResizeEnd` was called with 180. A click is no longer a resize (see "Spec corrections" 5). Updated in Step 1.

- [ ] **Step 1: Write the failing tests**

`src/components/boards/table/shared.test.ts`: add `gridTemplate` and `resolveColumnWidth` to the first import from `./shared` (lines 9–13 region), and append:

```ts
describe("column widths: live → saved → auto-fit → 180", () => {
  const column = (id: string, width: number | null) => ({ id, width });

  it("prefers the live drag width, then the saved width, then the fitted width", () => {
    expect(resolveColumnWidth(column("a", 240), { a: 310 }, { a: 96 })).toBe(
      310,
    );
    expect(resolveColumnWidth(column("a", 240), {}, { a: 96 })).toBe(240);
    expect(resolveColumnWidth(column("a", null), {}, { a: 96 })).toBe(96);
  });

  it("falls back to 180 before hydration, when nothing has been fitted", () => {
    expect(resolveColumnWidth(column("a", null), {}, {})).toBe(180);
    expect(resolveColumnWidth(column("a", null), {})).toBe(180);
  });

  it("builds the grid template from the same resolution", () => {
    const columns = [column("a", null), column("b", 240), column("c", null)];
    expect(gridTemplate(columns, { c: 200 }, 320, { a: 96, c: 120 })).toBe(
      "320px 96px 240px 200px 160px 176px 44px",
    );
  });

  it("keeps every unsaved column at 180 when no fitted widths are passed", () => {
    expect(gridTemplate([column("a", null)], {}, 320)).toBe(
      "320px 180px 160px 176px 44px",
    );
  });
});
```

Create `src/components/boards/table/use-column-auto-fit.test.tsx`:

```tsx
import fs from "node:fs";
import path from "node:path";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIT_FONT_SIZES,
  buildFitFonts,
  useColumnAutoFit,
} from "./use-column-auto-fit";

// jsdom has no canvas: give the hook a context that measures 7px per character
// in every font.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const columns = [
  { id: "c1", kind: "text", name: "Notes", settings: {}, width: null },
  { id: "c2", kind: "text", name: "Saved", settings: {}, width: 240 },
];
const cell = (text: string) => ({ column_id: "c1", value: { text } });

type Props = Parameters<typeof useColumnAutoFit>[0];
const base: Props = {
  columns,
  cellValues: [cell("hello world")],
  itemCount: 1,
  members: [],
  enabled: true,
};

describe("useColumnAutoFit", () => {
  it("returns nothing before hydration", () => {
    const { result } = renderHook(() =>
      useColumnAutoFit({ ...base, enabled: false }),
    );
    expect(result.current).toEqual({});
  });

  it("fits the columns that have no saved width", () => {
    const { result } = renderHook(() => useColumnAutoFit(base));
    // "hello world" 77 + 16 = 93 (header floor for "Notes" here is 35 + 6 + 48 = 89)
    expect(result.current).toEqual({ c1: 93 });
  });

  it("does not refit when only a cell value changes", () => {
    const { result, rerender } = renderHook((p: Props) => useColumnAutoFit(p), {
      initialProps: base,
    });
    const first = result.current;
    rerender({ ...base, cellValues: [cell("x".repeat(30))] });
    expect(result.current).toBe(first);
    expect(result.current.c1).toBe(93);
  });

  it("refits when the number of items changes", () => {
    const { result, rerender } = renderHook((p: Props) => useColumnAutoFit(p), {
      initialProps: base,
    });
    rerender({
      ...base,
      cellValues: [cell("hello world"), cell("x".repeat(30))],
      itemCount: 2,
    });
    expect(result.current.c1).toBe(30 * 7 + 16);
  });

  it("refits when the set of columns changes", () => {
    const { result, rerender } = renderHook((p: Props) => useColumnAutoFit(p), {
      initialProps: base,
    });
    rerender({
      ...base,
      columns: [...columns, { ...columns[0], id: "c3", name: "Extra" }],
    });
    expect(Object.keys(result.current).sort()).toEqual(["c1", "c3"]);
  });
});

describe("fit fonts", () => {
  it("measure at the sizes the table renders", () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const px = (re: RegExp) => `${Number(css.match(re)![1]) * 16}px`;
    expect(FIT_FONT_SIZES.cell).toBe(
      px(/\[data-board-table\]\s+\.text-cell\s*\{\s*font-size:\s*([\d.]+)rem/),
    );
    expect(FIT_FONT_SIZES.mono).toBe(px(/--text-2xs:\s*([\d.]+)rem/));
    expect(FIT_FONT_SIZES.header).toBe(px(/--text-3xs:\s*([\d.]+)rem/));
    expect(FIT_FONT_SIZES.chip).toBe("12px"); // Tailwind's text-xs
  });

  it("use the live next/font families, not bare literals", () => {
    const fonts = buildFitFonts("'__Inter_abc'", "'__JetBrains_def'");
    expect(fonts.cell).toBe(
      "400 12.5px '__Inter_abc', ui-sans-serif, system-ui, sans-serif",
    );
    expect(fonts.chip).toContain("500 12px '__Inter_abc'");
    expect(fonts.header).toContain("500 10px '__JetBrains_def'");
    expect(fonts.mono).toContain("500 11px '__JetBrains_def'");
  });

  it("fall back to the literal families when the variables are empty (jsdom)", () => {
    const fonts = buildFitFonts("", "  ");
    expect(fonts.cell).toContain("Inter,");
    expect(fonts.header).toContain("JetBrains Mono");
  });
});
```

`src/components/boards/ColumnHeader.test.tsx`: replace the last test of `describe("ColumnHeader — resize is frame-throttled")` ("a click on the handle without a move sends no live update") with:

```tsx
it("a press on the handle without a move is not a resize: nothing live, nothing persisted", () => {
  const { onResize, onResizeEnd, handle } = setup();
  fireEvent.pointerDown(handle, { clientX: 100 });
  release();
  act(() => void vi.advanceTimersToNextFrame());
  expect(onResize).not.toHaveBeenCalled();
  expect(onResizeEnd).not.toHaveBeenCalled();
});
```

and append to the file:

```tsx
describe("ColumnHeader — double-click to fit", () => {
  it("asks to clear the saved width, and the two presses of the double-click persist nothing", () => {
    const onAutoFit = vi.fn();
    const onResizeEnd = vi.fn();
    render(
      <ColumnHeader
        column={col({ width: 300 })}
        width={300}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={onResizeEnd}
        onAutoFit={onAutoFit}
      />,
    );
    const handle = screen.getByRole("separator", { name: "Resize Notes" });
    // A real double-click is two press/release pairs, then `dblclick`.
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(handle, { clientX: 100 });
      act(() => {
        window.dispatchEvent(new MouseEvent("pointerup"));
      });
    }
    fireEvent.doubleClick(handle);
    expect(onAutoFit).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).not.toHaveBeenCalled();
  });
});
```

`src/components/boards/BoardHeader.test.tsx`: append (it reuses that file's `renderHeader`, `views` and `userEvent`):

```tsx
describe("BoardHeader — Fit all columns", () => {
  it("offers it to editors when the Table view provides the handler, and calls it once", async () => {
    const onFit = vi.fn();
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="editor"
        onFitAllColumns={onFit}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "More board actions" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Fit all columns" }),
    );
    expect(onFit).toHaveBeenCalledTimes(1);
  });

  it("is absent in views that pass no handler (Kanban, Calendar, Gantt)", async () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="editor"
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "More board actions" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Automations" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Fit all columns" }),
    ).not.toBeInTheDocument();
  });

  it("is hidden from viewers even if a handler is passed", async () => {
    renderHeader(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
        access="viewer"
        onFitAllColumns={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "More board actions" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Automations" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Fit all columns" }),
    ).not.toBeInTheDocument();
  });
});
```

`src/components/boards/BoardTable.test.tsx`:

- Next to the other action mocks (after `const updateColumnSettings = vi.fn();`, line 62) add `const resizeColumn = vi.fn();` and `const resetColumnWidths = vi.fn();`, and inside the `vi.mock("@/lib/boards/actions", …)` factory add:

```tsx
  resizeColumn: (...a: unknown[]) => resizeColumn(...a),
  resetColumnWidths: (...a: unknown[]) => resetColumnWidths(...a),
```

- In the top-level `beforeEach` (lines 165–175) add `resizeColumn.mockReset();` and `resetColumnWidths.mockReset();`.
- Replace the `./BoardHeader` stub (lines 96–98) with one that exposes the new handler:

```tsx
vi.mock("./BoardHeader", () => ({
  BoardHeader: ({ onFitAllColumns }: { onFitAllColumns?: () => void }) => (
    <div data-testid="board-header">
      {onFitAllColumns ? (
        <button
          type="button"
          data-testid="board-header-fit"
          onClick={onFitAllColumns}
        >
          Fit all columns
        </button>
      ) : null}
    </div>
  ),
}));
```

- Append:

```tsx
describe("BoardTable column fit", () => {
  it("double-clicking a column's resize handle clears its saved width", async () => {
    resizeColumn.mockResolvedValue({ ok: true, data: undefined });
    renderBoardWithColumns();
    fireEvent.doubleClick(
      screen.getByRole("separator", { name: "Resize Status" }),
    );
    await waitFor(() =>
      expect(resizeColumn).toHaveBeenCalledWith({
        columnId: "c_status",
        width: null,
      }),
    );
  });

  it("Fit all columns clears the board's widths through one action", async () => {
    resetColumnWidths.mockResolvedValue({ ok: true, data: undefined });
    renderBoardWithColumns();
    fireEvent.click(screen.getByTestId("board-header-fit"));
    await waitFor(() =>
      expect(resetColumnWidths).toHaveBeenCalledWith({ boardId: "b1" }),
    );
    expect(resetColumnWidths).toHaveBeenCalledTimes(1);
    expect(resizeColumn).not.toHaveBeenCalled();
  });

  it("does not hand viewers the Fit all columns handler", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardTable
          payload={payloadWithColumns()}
          selectedViewId="v1"
          access="viewer"
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("board-header-fit")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run --project unit src/components/boards/table/shared.test.ts src/components/boards/table/use-column-auto-fit.test.tsx src/components/boards/ColumnHeader.test.tsx src/components/boards/BoardHeader.test.tsx src/components/boards/BoardTable.test.tsx -t "column widths|useColumnAutoFit|fit fonts|not a resize|double-click to fit|Fit all columns|column fit"`

Expected: FAIL. `resolveColumnWidth` is not exported, `./use-column-auto-fit` does not resolve, `onResizeEnd` is called on a plain press, `onAutoFit` is never called, there is no "Fit all columns" menu item and no `board-header-fit` button.

- [ ] **Step 3: Implement the width resolution in `shared.ts`**

`src/components/boards/table/shared.ts`. Add to the imports at the top:

```ts
import { COLUMN_FIT_DEFAULT } from "@/lib/boards/fit-column-width";
```

Replace lines 253–269 (`VALUE_COL_WIDTH` through `gridTemplate`) with:

```ts
/** Width of a value column that has neither a saved nor a fitted width yet. */
export const VALUE_COL_WIDTH = COLUMN_FIT_DEFAULT;
const ADD_COL_WIDTH = 44;

// The two virtual creation-metadata columns are fixed: an avatar plus a
// truncating name, and "Nov 14, 2026, 10:32 AM" in the 12px mono face.
const CREATED_BY_WIDTH = 160;
const CREATED_AT_WIDTH = 176;

const NO_AUTO_FIT: Record<string, number> = {};

/**
 * The width a value column renders at, in priority order:
 *   1. the live width of a drag in progress,
 *   2. the width the user saved by dragging (`columns.width`),
 *   3. the auto-fitted width (no saved width = fit the content, exactly like
 *      the Name column — see table/use-column-auto-fit),
 *   4. 180, before hydration, when nothing has been measured yet.
 * The header and every row must resolve through this one function.
 */
export function resolveColumnWidth(
  column: { id: string; width: number | null },
  liveWidths: Record<string, number>,
  autoFitWidths: Record<string, number> = NO_AUTO_FIT,
): number {
  return (
    liveWidths[column.id] ??
    column.width ??
    autoFitWidths[column.id] ??
    VALUE_COL_WIDTH
  );
}

/** CSS grid template: pinned Name + one fixed px track per column + the add-column slot. */
export function gridTemplate(
  columns: { id: string; width: number | null }[],
  liveWidths: Record<string, number>,
  nameWidth: number,
  autoFitWidths: Record<string, number> = NO_AUTO_FIT,
): string {
  const tracks = columns
    .map((c) => `${resolveColumnWidth(c, liveWidths, autoFitWidths)}px`)
    .join(" ");
  return `${nameWidth}px ${tracks} ${CREATED_BY_WIDTH}px ${CREATED_AT_WIDTH}px ${ADD_COL_WIDTH}px`;
}
```

In `ColumnHeaderControls` (lines 308–322): add `autoFitWidths: Record<string, number>;` after `liveWidths`, and change `resizeColumn: (id: string, w: number) => void;` to:

```ts
  /** `null` clears the saved width: the column goes back to auto-fit. */
  resizeColumn: (id: string, w: number | null) => void;
```

- [ ] **Step 4: Create the auto-fit hook**

Create `src/components/boards/table/use-column-auto-fit.ts`:

```ts
"use client";

import { useMemo } from "react";
import {
  fitBoardColumns,
  type FitColumn,
  type FitFont,
  type FitMeasure,
  type FitMember,
} from "@/lib/boards/fit-column-width";

const NO_WIDTHS: Record<string, number> = {};
const SANS_FALLBACK = "ui-sans-serif, system-ui, sans-serif";
const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * The px size each measured font renders at in the table. A canvas needs px;
 * the CSS is rem. use-column-auto-fit.test.tsx reads globals.css and fails if
 * these drift from it.
 *  - cell:   `[data-board-table] .text-cell` (12.5px)
 *  - chip:   `text-xs`, the ColorChip / StatusPill label
 *  - mono:   `--text-2xs`
 *  - header: `--text-3xs`, the column label kicker
 */
export const FIT_FONT_SIZES: Record<FitFont, string> = {
  cell: "12.5px",
  chip: "12px",
  mono: "11px",
  header: "10px",
};

const FIT_FONT_WEIGHTS: Record<FitFont, string> = {
  cell: "400",
  chip: "500",
  mono: "500",
  header: "500",
};

/**
 * Canvas font strings from the LIVE `--font-inter` / `--font-jetbrains-mono`
 * values. next/font self-hosts both faces under generated family names, so
 * the bare literals never resolve in the browser (same reason as
 * `buildNameMeasureFont` in ./shared). DOM-free, so it is unit-testable; the
 * literals are only the jsdom / pre-font fallback.
 */
export function buildFitFonts(
  fontInterVar: string,
  fontMonoVar: string,
): Record<FitFont, string> {
  const sans = `${fontInterVar.trim() || "Inter"}, ${SANS_FALLBACK}`;
  const mono = `${fontMonoVar.trim() || '"JetBrains Mono"'}, ${MONO_FALLBACK}`;
  const font = (key: FitFont, family: string) =>
    `${FIT_FONT_WEIGHTS[key]} ${FIT_FONT_SIZES[key]} ${family}`;
  return {
    cell: font("cell", sans),
    chip: font("chip", sans),
    mono: font("mono", mono),
    header: font("header", mono),
  };
}

/** One offscreen canvas; `ctx.font` is only reassigned when the font changes. */
function createCanvasMeasure(): FitMeasure {
  const ctx =
    typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;
  if (!ctx) return () => 0;
  const root = getComputedStyle(document.documentElement);
  const fonts = buildFitFonts(
    root.getPropertyValue("--font-inter"),
    root.getPropertyValue("--font-jetbrains-mono"),
  );
  let current: FitFont | null = null;
  return (text, font) => {
    if (current !== font) {
      ctx.font = fonts[font];
      current = font;
    }
    return ctx.measureText(text).width;
  };
}

/**
 * Fitted widths for the value columns that have no saved width:
 * `{ [columnId]: px }`. Pure measurement over the board cache — no server
 * round-trip.
 *
 * WHEN it runs: after hydration (`enabled`), and again when the set of columns
 * changes or the number of items changes. NOT on a cell edit: a column must
 * never change width while someone is typing in it. That is why `cellValues`
 * is read but is not a dependency — the values are picked up at the next
 * column / item-count change.
 */
export function useColumnAutoFit({
  columns,
  cellValues,
  itemCount,
  members,
  enabled,
}: {
  columns: readonly FitColumn[];
  cellValues: readonly { column_id: string; value: unknown }[];
  /** Total items on the board; a change (add / remove) triggers a refit. */
  itemCount: number;
  members: readonly FitMember[];
  /** `useHydrated()`: the server has no canvas, and a width computed
   *  differently on the server would stick on the header after hydration. */
  enabled: boolean;
}): Record<string, number> {
  const measure = useMemo(() => createCanvasMeasure(), []);
  return useMemo(() => {
    if (!enabled) return NO_WIDTHS;
    return fitBoardColumns(columns, cellValues, measure, members);
    // `cellValues` deliberately omitted and `itemCount` deliberately present:
    // see the "WHEN it runs" note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, columns, itemCount, members, measure]);
}
```

- [ ] **Step 5: Wire the fitted widths, the double-click reset and "Fit all columns"**

`src/components/boards/ColumnHeader.tsx`:

- Add `onAutoFit,` to the destructured props (after `onSmartFill,`, line 61) and `onAutoFit?: () => void; // double-click the resize handle: clear the saved width` to the props type (after line 72).
- Replace the `up` handler inside `onPointerDown` (lines 100–108) with:

```ts
const up = () => {
  window.removeEventListener("pointermove", move);
  window.removeEventListener("pointerup", up);
  // The last move may still be waiting on its frame: drop it.
  cancelThrottledResize();
  // A press without a move is not a resize. Persisting here would pin an
  // auto-fitted column at whatever width it happened to have (and an
  // auto-fit width under 80px would be rejected by the server), and each
  // press of a double-click would save a width just before the
  // double-click clears it.
  if (!moved) return;
  onResize(last); // apply the final width synchronously
  onResizeEnd(last); // persist it
};
```

- On the resize handle `<div role="separator" …>` (lines 222–228) add two attributes after `onPointerDown={onPointerDown}`:

```tsx
onDoubleClick = { onAutoFit };
title = "Drag to resize. Double-click to fit the content.";
```

`src/components/boards/table/SortableColumnHeader.tsx`:

- Line 7: `import { resolveColumnWidth, type ColumnHeaderControls } from "./shared";`
- Line 34: `width={resolveColumnWidth(column, col.liveWidths, col.autoFitWidths)}`
- After `onResizeEnd={…}` (line 38) add:

```tsx
      onAutoFit={() => {
        // Drop the live width too. It is set during a drag and never cleared
        // afterwards, so it would keep masking the (now null) saved width.
        col.setLiveWidths((m) => {
          if (!(column.id in m)) return m;
          const next = { ...m };
          delete next[column.id];
          return next;
        });
        col.resizeColumn(column.id, null);
      }}
```

`src/components/boards/table/BoardTableInner.tsx`:

- Add `import { useColumnAutoFit } from "./use-column-auto-fit";`.
- Replace the `template` memo (lines 498–501; keep the TODO comment above it) with:

```tsx
// Value columns with no saved width fit their content, like the Name column
// above. Empty until hydration, so the server and the first client render
// agree on 180px tracks.
const autoFitWidths = useColumnAutoFit({
  columns,
  cellValues,
  itemCount: items.length,
  members,
  enabled: hydrated,
});

const template = useMemo(
  () => gridTemplate(columns, liveWidths, nameWidth, autoFitWidths),
  [columns, liveWidths, nameWidth, autoFitWidths],
);
```

- In the `columnControls` memo (lines 546–576): add `autoFitWidths,` after `liveWidths,` in the object, and add `autoFitWidths` to the dependency array (`[nameWidth, liveWidths, autoFitWidths, m]`).
- After the `columnControls` memo add:

```tsx
// "Fit all columns" (board ⋯ menu): one Server Action clears every saved
// column width and the saved Name width; the live drag widths are dropped
// here so nothing masks the result. No revalidation, no refetch — the
// mutation patches the cache optimistically.
const fitAllColumns = useCallback(() => {
  setLiveWidths({});
  setLiveNameWidth(null);
  m.resetColumnWidths();
}, [m]);
```

- On `<BoardHeader … />` (lines 775–787) add the prop `onFitAllColumns={canEdit ? fitAllColumns : undefined}`.

`src/components/boards/BoardHeader.tsx`:

- Add `MoveHorizontal,` to the `lucide-react` import (lines 6–14).
- Add `onFitAllColumns,` to the destructured props and, to the props type:

```tsx
  /** Table view only: clear every saved column width (and the Name width) so
   *  all columns fit their content. Absent in the other views. */
  onFitAllColumns?: () => void;
```

- In the menu, directly after the Import item's closing `) : null}` (line 332) add:

```tsx
{
  !isViewer && onFitAllColumns ? (
    <DropdownMenuItem onSelect={() => onFitAllColumns()}>
      <MoveHorizontal className="size-3.5" /> Fit all columns
    </DropdownMenuItem>
  ) : null;
}
```

- [ ] **Step 6: Run the touched suites, typecheck and lint**

Run: `pnpm vitest run --project unit src/components/boards/table src/components/boards/ColumnHeader.test.tsx src/components/boards/BoardHeader.test.tsx src/components/boards/BoardTable.test.tsx src/components/boards/BoardTable.render-count.test.tsx src/components/boards/BoardTable.created-columns.test.tsx src/components/boards/SummaryRow.test.tsx`

Expected: PASS, every file.

Run: `pnpm exec prettier --write src/components/boards/table src/components/boards/ColumnHeader.tsx src/components/boards/BoardHeader.tsx && pnpm typecheck && pnpm lint`

Expected: both exit 0. The one `eslint-disable-next-line react-hooks/exhaustive-deps` in `use-column-auto-fit.ts` is intended and commented.

- [ ] **Step 7: Hand back**

Report the files changed, the test command with its pass count, and the typecheck / lint result. State explicitly that the fitted widths themselves (jsdom's canvas measures nothing) and the cost of fitting on a large board are on the orchestrator's browser list. Do not stage, commit or stash anything.

---

### Task 6: Centered value columns

**Files:**

- Modify: `src/components/boards/table/shared.ts` (one exported constant, after `ROW_HAIRLINE`)
- Modify: `src/components/boards/table/EditableCell.tsx` (import 35; the seven wrapper class strings at lines 101, 121, 140, 170, 205, 221, 275)
- Modify: `src/components/boards/RollupValueCell.tsx` (line 20)
- Modify: `src/components/boards/table/ItemRow.tsx` (the two Created cells)
- Modify: `src/components/boards/table/SortableSubitemRow.tsx` (the two Created cells)
- Modify: `src/components/boards/table/CreatedHeaderCell.tsx` (line 15)
- Modify: `src/components/boards/ColumnHeader.tsx` (root class line 118; grip 144; label 150; menu trigger 158)
- Modify: `src/components/boards/FooterCell.tsx` (lines 210, 215)
- Modify: `src/components/boards/SummaryRow.tsx` (line 265)
- Modify: `src/components/boards/cells/editors/index.tsx` (the four inline `Input` class strings changed in Task 1)
- Test: `src/components/boards/BoardTable.test.tsx`, `src/components/boards/ColumnHeader.test.tsx`, `src/components/boards/FooterCell.test.tsx`, `src/components/boards/SummaryRow.test.tsx`, `src/components/boards/RollupValueCell.test.tsx`, `src/components/boards/cells/editors/editors.test.tsx`

`src/components/boards/cells/index.tsx` is **not** edited (Global Constraint 9).

**Interfaces:**

- Consumes: `px-2` value-cell wrappers (Task 1), `ColumnHeader` root `h-full … px-2` (Task 3), `HEADER_CHROME = 48` in `fit-column-width.ts` (Task 4: 24px reserved on each side of a header label).
- Produces: `CELL_CENTER = "justify-center text-center *:justify-center"` from `table/shared.ts`. Every value-cell wrapper, roll-up cell, Created cell, summary cell and column header centers its content; the Name column does not.

**How the one recipe centers every renderer** (all verified in a browser, see the list at the end):

- `justify-center` centers the wrapper's single flex child (pill, avatar stack, date, number, checkbox, stars, link).
- `text-center` is inherited by the truncating text span, so short text is centered; text that overflows still fills the cell and ends in an ellipsis.
- `*:justify-center` centers the content of children that are themselves full-width flex boxes (`PercentBar`'s `flex w-full`, a wrapped `DropdownCell`).

On coarse pointers the column header keeps today's in-flow layout: grip, label, menu left to right.

**Existing test this task breaks on purpose:** `ColumnHeader.test.tsx` → "paints no vertical rule, pads to 8px and fills the header row's height" (the root pads 24px now, to hold the pinned grip and menu). Updated in Step 1.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/boards/BoardTable.test.tsx`:

```tsx
describe("BoardTable centered value columns", () => {
  it("centers a value cell", () => {
    renderBoardWithColumns();
    const classes = screen
      .getByLabelText("Item 1 Status")
      .className.split(/\s+/);
    expect(classes).toContain("justify-center");
    expect(classes).toContain("text-center");
    expect(classes).toContain("*:justify-center");
  });

  it("centers the Created cells", () => {
    renderBoardWithColumns();
    // The fixture item has no creator, so Created by reads "Unknown".
    const createdBy = screen.getByText("Unknown").parentElement as HTMLElement;
    expect(createdBy.className.split(/\s+/)).toContain("justify-center");
  });

  it("leaves the Name column left-aligned", () => {
    renderBoardWithColumns();
    const classes = screen.getByLabelText("Item 1 name").className.split(/\s+/);
    expect(classes).not.toContain("justify-center");
    expect(classes).not.toContain("text-center");
  });

  it("centers the Created headers", () => {
    renderBoardWithColumns();
    const header = screen.getByText("Created by").parentElement as HTMLElement;
    expect(header.className.split(/\s+/)).toContain("justify-center");
  });
});
```

`src/components/boards/ColumnHeader.test.tsx`: replace "paints no vertical rule, pads to 8px and fills the header row's height" with the first test below, and add the second to the same `describe("ColumnHeader — Quiet Grid")` (it uses that file's existing `reorder()` helper):

```tsx
it("paints no vertical rule and reserves 24px each side for the pinned grip and menu", () => {
  const { container } = render(
    <ColumnHeader
      column={col()}
      width={200}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onResize={vi.fn()}
      onResizeEnd={vi.fn()}
    />,
  );
  const header = container.firstElementChild as HTMLElement;
  const classes = header.className.split(/\s+/);
  expect(header.className).not.toMatch(/\bborder-l\b/);
  expect(classes).toContain("px-6");
  expect(classes).toContain("justify-center");
  expect(classes).toContain("h-full");
  // Coarse pointers keep the in-flow, left-to-right layout.
  expect(classes).toContain("pointer-coarse:justify-start");
  expect(classes).toContain("pointer-coarse:px-2");
});

it("centers the label on the column: the grip and the menu are taken out of the flow", () => {
  render(
    <ColumnHeader
      column={col({ name: "Budget" })}
      width={200}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onResize={vi.fn()}
      onResizeEnd={vi.fn()}
      reorder={reorder()}
    />,
  );
  const label = screen.getByText("Budget").className.split(/\s+/);
  expect(label).toContain("text-center");
  expect(label).toContain("truncate");

  const menu = screen
    .getByLabelText("Budget column menu")
    .className.split(/\s+/);
  expect(menu).toContain("absolute");
  expect(menu).toContain("right-1");
  expect(menu).toContain("pointer-coarse:static");
  expect(menu).toContain("pointer-coarse:size-11");
  expect(menu).toContain("pointer-coarse:opacity-100");

  const grip = screen
    .getByRole("button", { name: "Reorder Budget column" })
    .className.split(/\s+/);
  expect(grip).toContain("absolute");
  expect(grip).toContain("left-0.5");
  expect(grip).toContain("pointer-coarse:static");
  expect(grip).toContain("pointer-coarse:size-11");
});
```

`src/components/boards/FooterCell.test.tsx`: append inside `describe("FooterCell", …)` (the describe that owns `numberValues`):

```tsx
it("centers its content under the column, for editors and viewers", () => {
  const { rerender } = render(
    <FooterCell
      aggregateKind="numbers"
      values={numberValues}
      current="sum"
      allowed={allowedAggregations("numbers")}
      canEdit
      onChange={() => {}}
    />,
  );
  const trigger = screen.getByRole("button").className.split(/\s+/);
  expect(trigger).toContain("justify-center");
  expect(trigger).toContain("w-full");
  expect(trigger).toContain("px-2");
  expect(trigger).not.toContain("justify-between");
  expect(trigger).not.toContain("text-left");

  rerender(
    <FooterCell
      aggregateKind="numbers"
      values={numberValues}
      current="sum"
      allowed={allowedAggregations("numbers")}
      canEdit={false}
      onChange={() => {}}
    />,
  );
  const readOnly = (
    screen.getByText("30").closest("span.px-2") as HTMLElement
  ).className.split(/\s+/);
  expect(readOnly).toContain("justify-center");
});
```

`src/components/boards/SummaryRow.test.tsx`: append inside the main `describe` that holds "renders the assigned aggregate over exactly the given itemIds":

```tsx
it("centers each column's summary cell under its column", () => {
  render(<SummaryRow {...baseProps()} />);
  const row = screen.getByTestId("group-summary-g1");
  // children: [name track, colA cell, colB cell, filler, filler, add-col]
  const colACell = row.children[1] as HTMLElement;
  expect(colACell.className.split(/\s+/)).toContain("justify-center");
  // The frozen label track is not a value column.
  expect((row.children[0] as HTMLElement).className.split(/\s+/)).not.toContain(
    "justify-center",
  );
});
```

`src/components/boards/RollupValueCell.test.tsx`: append inside `describe("RollupValueCell", …)`:

```tsx
it("centers the roll-up under its column", () => {
  const { container } = render(
    <RollupValueCell
      col={percentCol()}
      items={twoItems()}
      cellMap={new Map()}
      cache={{} as BoardCache}
      nowMs={0}
    />,
  );
  const classes = (container.firstElementChild as HTMLElement).className.split(
    /\s+/,
  );
  expect(classes).toContain("justify-center");
  expect(classes).toContain("text-center");
  expect(classes).toContain("px-2");
});
```

`src/components/boards/cells/editors/editors.test.tsx`: in the test added by Task 1 ("NumbersEditor is 24px so it fits a 28px row, and 32px on coarse"), add one line after the last assertion:

```tsx
// Centered, so the number does not jump sideways when the cell opens.
expect(classes).toContain("text-center");
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run --project unit src/components/boards/BoardTable.test.tsx src/components/boards/ColumnHeader.test.tsx src/components/boards/FooterCell.test.tsx src/components/boards/SummaryRow.test.tsx src/components/boards/RollupValueCell.test.tsx src/components/boards/cells/editors/editors.test.tsx -t "centered value columns|pinned grip and menu|centers the label|centers its content|centers each column|centers the roll-up|NumbersEditor is 24px"`

Expected: FAIL on every one: `justify-center` / `text-center` / `px-6` / `absolute` are not on those elements yet. ("leaves the Name column left-aligned" passes already; it is the guard.)

- [ ] **Step 3: Add the shared recipe**

`src/components/boards/table/shared.ts`, directly after `ROW_HAIRLINE`:

```ts
/**
 * Horizontal centering for a VALUE cell's wrapper (never the Name cell).
 * Append it to the wrapper's own class string.
 *  - `justify-center` centers the wrapper's flex child (pill, avatars, date…).
 *  - `text-center` is inherited by a truncating text span: short text is
 *    centered, overflowing text still fills the cell and ends in an ellipsis.
 *  - `*:justify-center` centers the content of a child that is itself a
 *    full-width flex box (PercentBar's `flex w-full`, a wrapped DropdownCell).
 *
 * It lives on the table's wrappers, NOT in cells/index.tsx: those renderers
 * are shared with Kanban cards and the Calendar agenda, which stay as they
 * are. A literal, never assembled at runtime — Tailwind only emits classes it
 * can read in source.
 */
export const CELL_CENTER = "justify-center text-center *:justify-center";
```

- [ ] **Step 4: Center the cells, headers, footers and inline editors**

`src/components/boards/table/EditableCell.tsx`: change the import at line 35 to `import { CELL_CENTER, type CellControls } from "./shared";`, then:

| Line | Wrapper                | New `className`                                                                         |
| ---- | ---------------------- | --------------------------------------------------------------------------------------- |
| 101  | optimistic (read-only) | ``className={`flex h-full items-center truncate px-2 opacity-50 ${CELL_CENTER}`}``      |
| 121  | files                  | ``className={`flex h-full items-center px-2 ${CELL_CENTER}`}``                          |
| 140  | time tracking          | ``className={`flex h-full items-center px-2 ${CELL_CENTER}`}``                          |
| 170  | relation               | ``className={`flex h-full items-center px-1 ${CELL_CENTER}`}``                          |
| 205  | mirror                 | ``className={`flex h-full items-center px-2 ${CELL_CENTER}`}``                          |
| 221  | editing                | ``className={`relative flex items-center px-2 ${CELL_CENTER}`}``                        |
| 275  | resting                | the existing string with `px-2`, as a template literal, ending in `` ${CELL_CENTER}` `` |

Line 275 in full:

```tsx
      className={`focus-visible:ring-ring hover:after:border-border-bright hover:after:bg-state-hover relative flex h-full cursor-pointer items-center truncate px-2 transition-colors after:pointer-events-none after:absolute after:inset-1 after:rounded-md after:border after:border-transparent after:transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset ${CELL_CENTER}`}
```

`src/components/boards/RollupValueCell.tsx`: add `import { CELL_CENTER } from "@/components/boards/table/shared";` and change line 20 to:

```ts
const CELL_CLASS = `flex h-full items-center truncate px-2 ${CELL_CENTER}`;
```

`src/components/boards/table/ItemRow.tsx` and `src/components/boards/table/SortableSubitemRow.tsx`: add `CELL_CENTER,` to each file's import from `./shared`, and change both Created cells in each file from `className="flex h-full min-w-0 items-center px-2"` to:

```tsx
            <div className={`flex h-full min-w-0 items-center px-2 ${CELL_CENTER}`}>
```

`src/components/boards/table/CreatedHeaderCell.tsx`, line 15: `className="text-kicker flex h-full min-w-0 items-center justify-center gap-1.5 px-2"`

`src/components/boards/ColumnHeader.tsx`:

- Root (line 118): `"group/col relative flex h-full min-w-0 items-center justify-center px-6 pointer-coarse:justify-start pointer-coarse:gap-1 pointer-coarse:px-2",`
- Grip button class (line 144):

```tsx
className =
  "text-muted-foreground hover:text-foreground absolute top-1/2 left-0.5 grid h-6 w-4 -translate-y-1/2 cursor-grab touch-none place-items-center rounded opacity-0 transition-opacity group-hover/col:opacity-100 active:cursor-grabbing pointer-coarse:static pointer-coarse:size-11 pointer-coarse:translate-y-0 pointer-coarse:opacity-100";
```

- Label `Kicker` class (line 150): `className="min-w-0 truncate text-center opacity-[0.74] transition-opacity group-hover/col:opacity-100"`
- Menu trigger class (line 158):

```tsx
className =
  "text-muted-foreground hover:text-foreground absolute top-1/2 right-1 grid -translate-y-1/2 place-items-center opacity-0 transition-opacity group-hover/col:opacity-100 pointer-coarse:static pointer-coarse:ml-auto pointer-coarse:size-11 pointer-coarse:translate-y-0 pointer-coarse:opacity-100";
```

The 24px of `px-6` on each side is what `HEADER_CHROME = 48` in `src/lib/boards/fit-column-width.ts` reserves: 4px inset + 16px control + 4px gap. The resize handle (`absolute right-0 w-1`) sits outside the menu button (`right-1`), so they do not overlap. Add that sentence as a comment above the root's class.

`src/components/boards/FooterCell.tsx`:

- Line 210 (read-only): `return <span className="flex w-full min-w-0 items-center justify-center px-2">{body}</span>;`
- Line 215 (trigger): `<DropdownMenuTrigger className="hover:bg-state-hover/60 flex w-full min-w-0 items-center justify-center gap-1 px-2 text-center transition-colors focus-visible:outline-none">`

`src/components/boards/SummaryRow.tsx`, line 265: `<div key={col.id} className="flex min-w-0 items-center justify-center py-1.5">`

`src/components/boards/cells/editors/index.tsx`: add `text-center` to the four inline input class strings from Task 1, so they read:

- `NumbersEditor`, `PercentEditor`, `CurrencyEditor` input: `className="h-6 px-1.5 text-center text-xs tabular-nums md:text-xs pointer-coarse:h-8"`
- `TextLikeEditor` input: `className="h-6 px-1.5 text-center text-xs md:text-xs pointer-coarse:h-8"`

- [ ] **Step 5: Run the touched suites, typecheck and lint**

Run: `pnpm vitest run --project unit src/components/boards/BoardTable.test.tsx src/components/boards/BoardTable.created-columns.test.tsx src/components/boards/BoardTable.render-count.test.tsx src/components/boards/table src/components/boards/ColumnHeader.test.tsx src/components/boards/FooterCell.test.tsx src/components/boards/SummaryRow.test.tsx src/components/boards/RollupValueCell.test.tsx src/components/boards/RollupCell.test.tsx src/components/boards/cells src/components/boards/KanbanBoard.test.tsx src/components/boards/CalendarBoard.test.tsx`

Expected: PASS, every file. Kanban and Calendar are in the run on purpose: they must be untouched.

Run: `pnpm exec prettier --write src/components/boards && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 6: Hand back**

Report the files changed, the test command with its pass count, and the typecheck / lint result. State explicitly that whether each cell type _looks_ centered is on the orchestrator's browser list, and repeat the spec's open question for the owner: long free-text columns are centered too. Do not stage, commit or stash anything.

---

## Execution DAG

Derived from the files each task writes. No file is written by two tasks of the same batch.

**Files written, per task**

| File                                                                                                                                                                                     | T1  | T2  | T3  | T4  | T5  | T6  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-: | :-: | :-: | :-: | :-: | :-: |
| `table/shared.ts` (+ `shared.test.ts`)                                                                                                                                                   |  ●  |     |     |     |  ●  |  ●  |
| `table/use-row-height.ts` (+ test)                                                                                                                                                       |  ●  |     |     |     |     |     |
| `app/globals.css`                                                                                                                                                                        |  ●  |     |  ●  |     |     |     |
| `table/BoardTableInner.tsx`                                                                                                                                                              |  ●  |     |  ●  |     |  ●  |     |
| `table/ItemRow.tsx`, `table/SortableSubitemRow.tsx`                                                                                                                                      |  ●  |  ●  |     |     |     |  ●  |
| `table/GroupRollupRow.tsx`, `loading.tsx`, `cells/member-avatar.tsx`                                                                                                                     |  ●  |     |     |     |     |     |
| `table/GroupSection.tsx`                                                                                                                                                                 |  ●  |     |  ●  |     |     |     |
| `table/EditableCell.tsx`, `RollupValueCell.tsx`, `cells/editors/index.tsx` (+ tests)                                                                                                     |  ●  |     |     |     |     |  ●  |
| `table/NameCell.tsx` (+ test), `RowSelectCheckbox.tsx`, `RowMenu.tsx`, `ItemRow.gutter.test.tsx`, `temp-row-readonly.test.tsx`                                                           |     |  ●  |     |     |     |     |
| `lib/boards/name-column-width.ts`, `lib/boards/item-tree.ts` (+ tests)                                                                                                                   |     |  ●  |     |     |     |     |
| `table/BoardColumnHeader.tsx`, `table/GroupHeaderRow.tsx`, `lib/boards/group-progress.ts` (+ test), `text-size-token-cn-merge.test.ts`                                                   |     |     |  ●  |     |     |     |
| `ColumnHeader.tsx` (+ test)                                                                                                                                                              |     |     |  ●  |     |  ●  |  ●  |
| `table/CreatedHeaderCell.tsx`                                                                                                                                                            |     |     |  ●  |     |     |  ●  |
| `SummaryRow.tsx` (+ test)                                                                                                                                                                |     |     |  ●  |     |     |  ●  |
| `BoardTable.test.tsx`                                                                                                                                                                    |  ●  |     |  ●  |     |  ●  |  ●  |
| `lib/boards/fit-column-width.ts` (+ test), `validations/board-actions.ts`, `core/column.ts`, `actions/column.ts`, `cache.ts`, `mutations/columns.ts`, `use-board-mutations.ts` (+ tests) |     |     |     |  ●  |     |     |
| `table/use-column-auto-fit.ts` (+ test), `table/SortableColumnHeader.tsx`, `BoardHeader.tsx` (+ test)                                                                                    |     |     |     |     |  ●  |     |
| `FooterCell.tsx` (+ test)                                                                                                                                                                |     |     |     |     |     |  ●  |

**Dependency graph**

- Task 1 depends on nothing.
- Task 4 depends on nothing.
- Task 2 depends on Task 1 (edits `ItemRow.tsx` / `SortableSubitemRow.tsx` after Task 1; builds the gutter for the 28px row).
- Task 3 depends on Task 1 (edits `BoardTableInner.tsx`, `GroupSection.tsx`, `globals.css`, `BoardTable.test.tsx` after Task 1).
- Task 5 depends on Task 3 (`BoardColumnHeader` / `ColumnHeader` / `BoardTableInner.tsx`), Task 4 (`fitBoardColumns`, `resizeColumn(null)`, `resetColumnWidths`) and Task 1 (`shared.ts`, the 12.5px cell size it measures at).
- Task 6 depends on Task 5 (`shared.ts`, `ColumnHeader.tsx`, `BoardTable.test.tsx`), Task 2 (`ItemRow.tsx`, `SortableSubitemRow.tsx`), Task 3 (`CreatedHeaderCell.tsx`, `SummaryRow.tsx`) and Task 1 (`EditableCell.tsx`, the editors).

```
T1 ──┬──▶ T2 ───────────────┐
     └──▶ T3 ──┐            ├──▶ T6
T4 ────────────┴──▶ T5 ─────┘
```

**Parallel batches** (dispatch each batch's tasks in ONE message with `superpowers:dispatching-parallel-agents`; each parallel task in its own worktree cut from `task/board-table-density`, per `superpowers:using-git-worktrees`; the orchestrator reviews, rebases and fast-forwards them into the task branch one at a time before starting the next batch)

| Batch | Tasks                  | Why they can share a batch                                                                                                                                                                                                                                 |
| ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Task 1**, **Task 4** | No file in common: Task 4 is entirely under `src/lib/`, Task 1 touches no file there                                                                                                                                                                       |
| 2     | **Task 2**, **Task 3** | No file in common (see the table). Task 2 deliberately keeps `fitNameColumnWidth`'s signature and reads `controls.cache.items` so it never needs `BoardTableInner.tsx` or `GroupSection.tsx`; it adds its tests in new files, not in `BoardTable.test.tsx` |
| 3     | **Task 5**             | Alone: shares `ColumnHeader.tsx`, `shared.ts`, `BoardTable.test.tsx` with Task 6                                                                                                                                                                           |
| 4     | **Task 6**             | Alone                                                                                                                                                                                                                                                      |

After each batch the orchestrator runs `pnpm typecheck && pnpm lint && pnpm test && pnpm build` on the merged task branch, then commits by path.

**Critical path:** Task 1 → Task 3 → Task 5 → Task 6 (four waves; this is the wall-clock floor). Task 4 and Task 2 are off the critical path.

The spec's "Independent units" graph had five units and three waves. Two things changed it: U5 is split into Tasks 5 and 6 (they share three files, so they cannot be parallel), and both edit `ItemRow.tsx` / `SortableSubitemRow.tsx` or sit downstream of a task that does, which adds the Task 2 → Task 6 edge.

## Performance & data-fetching budget

- **(a) First paint vs. interaction.** First paint adds no query: the board payload already in the TanStack cache is the only input. Fitting runs once after hydration over that cache. Interactions with **0 server round-trips**: hover peek, the buttons overlay, collapse / expand, scrolling under the sticky header and group rows, live column drag, the group progress meter (derived per group from `cellMap`).
- **(b) Interactions that change server data.** Three writes, each one Server Action with an optimistic cache patch and a targeted rollback, **no `revalidatePath` / `revalidateTag`, no refetch, no navigation**: a column drag release (`resizeColumn`, unchanged), a double-click on a resize handle (`resizeColumn` with `width: null`), "Fit all columns" (`resetColumnWidths`, one action for the Name width and every column). Nothing here uses `<Link>` or `router`.
- **(c) Bounded, indexed reads.** No new read. The two writes of `resetColumnWidths` are a primary-key update on `boards` and an update on `columns` filtered by `board_id` (`columns_board_id_idx`, `supabase/migrations/20260615061747_boards_core.sql:79`). No unbounded `select *`.
- **Cost of fitting.** One `measureText` per _distinct_ string per unsaved, measured column; strings over 120 characters are not measured; columns with a saved width, and files / relation / mirror / time-tracking columns, are skipped entirely. One pass over `cellValues` buckets them by column. It runs on hydration and when `columns` or the item count changes, never on a cell edit (so realtime cell traffic and typing cost nothing). A column rename, resize or reorder replaces the `columns` slice and does trigger a refit; that is one refit per user action.
- **Measured budget, checked by the orchestrator on the largest DAAS board before merge:** in Chrome DevTools → Performance, record a board load and find `fitBoardColumns` in the flame chart. Budget: **≤ 50 ms** on the owner's machine. Under budget: ship as written. Over budget: do not merge Task 5 as written; replace the body of `useColumnAutoFit` with the idle version below (same signature, same return type) and make the three synchronous hook tests `await waitFor(...)`:

```ts
export function useColumnAutoFit({
  columns,
  cellValues,
  itemCount,
  members,
  enabled,
}: {
  columns: readonly FitColumn[];
  cellValues: readonly { column_id: string; value: unknown }[];
  itemCount: number;
  members: readonly FitMember[];
  enabled: boolean;
}): Record<string, number> {
  const measure = useMemo(() => createCanvasMeasure(), []);
  const [widths, setWidths] = useState<Record<string, number>>(NO_WIDTHS);
  const latestCells = useRef(cellValues);
  useEffect(() => {
    latestCells.current = cellValues;
  });
  useEffect(() => {
    if (!enabled) return;
    const run = () =>
      setWidths(
        fitBoardColumns(columns, latestCells.current, measure, members),
      );
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(run, 0);
    return () => window.clearTimeout(id);
  }, [enabled, columns, itemCount, members, measure]);
  return widths;
}
```

- **Rendering.** Fewer DOM nodes than today: one column header instead of one per group (on the 22-column DAAS board, 22 header cells, 22 dropdown triggers and one `DndContext` fewer per group). `BoardColumnHeader` is memoized, so a cell edit does not re-render it. `GroupSection` loses the `col` prop, so a live column drag re-renders the header and the rows (through `template`) but no longer hands every group a new bundle. Each visible row adds one `useSyncExternalStore` subscription (`useRowHeight`) and one `WeakMap` lookup (`boardHasSubitems`).
- **Known cost left as is:** `template` is still an inline style on every row, so a live column drag re-renders every visible row (the existing `TODO(perf-follow-up)` at `BoardTableInner.tsx:487`). Not in scope.

## Browser verification (orchestrator, before merge)

jsdom cannot show any of this. Run the built app (`pnpm build && pnpm start`, or `next dev`; if `next dev` rewrites `AGENTS.md`, revert that before committing) against the DEV data, in Chromium, in **dark and light**, on a board with ≥ 2 groups, ≥ 40 items in one group, subitems, and every column type. Then repeat the marked items with DevTools device emulation set to an iPad with touch (so `(pointer: coarse)` matches).

1. **Row height.** Item rows measure 28px, subitem rows 26px (`getBoundingClientRect().height`). About 28 rows fit on an 879px board viewport. Coarse: both 44px.
2. **Every cell type fits 28px** without clipping or growing the row: status and dropdown pills, a single assignee, a 4+ avatar stack, date, overdue date, number, currency, checkbox, rating, percent bar, link, email, phone, files (thumbnail and file-type chip), relation chips, mirror, time tracking, priority, Created by, Created at. Open each inline editor (number, percent, currency, checkbox, email, phone): 24px, inside the row.
3. **Type sizes.** Item name computes to 13px, a table cell's text to 12.5px, a group title to 13.5px. A Kanban card field and a Calendar agenda field still compute to 13px.
4. **Name cell chrome.** For an editor on a board without subitems, `cell width − text box width` is 53px; with subitems on the board it is 53 + 20 on a childless row. For a viewer, 33. For a subitem row, 69. If any differs, fix the constant in `name-column-width.ts` to the measured value.
5. **Overlay.** Hover a row: the three buttons appear at the right edge over a fade that matches the row's background in each of: resting hover, selected, subitem (sunken), and an intel-matched row. Tab to the name, then to each button: each is visible when focused. Coarse: the buttons are in flow, always visible, 44px; no fade.
6. **Hover peek.** A truncated name unrolls after ~200ms on one line, over the neighbouring cells, above the row hairline, with `shadow-panel` and a brightened right hairline, buttons at its end. It does not appear for a name that fits, while renaming, or while dragging the row. A name longer than the scroller is capped at the scroller's visible width and ends in an ellipsis. Clicking a button inside the peek works (open panel, add subitem, menu). It never overflows downward into the next row. Coarse: never appears.
7. **Sticky stacking, vertical scroll.** The column header stays at the top. The current group's row stays pinned directly under it and is pushed out by the next group's row. Rows, frozen Name cells and row hairlines pass under both. The Board Total stays at the bottom, above everything except menus. Open a column menu, a group menu, a row menu, a status editor and the long-text editor near the top and the bottom: each paints above all sticky elements.
8. **Sticky stacking, horizontal scroll.** The header's "Item" cell stays frozen with the freeze-edge shadow. The group title, count, meter and menu stay in view (the inner block is exactly the scroller's visible width; resize the window and re-check). No gap opens between the group row's background and the right edge.
9. **Group row.** Title as typed, 30px tall, count chip, meter with "N% done" only when the board has a status column and the group has rows; the meter agrees with a hand count of items whose first-status label matches done/complete. Rename, colour, delete, reorder (drag) and collapse still work. Coarse: 44px, handle and menu always visible.
10. **Drag and drop.** Reorder an item within a group, across groups, into an empty group, onto a collapsed group; reorder a group; reorder a column from the single header; reorder subitems. The dragged row or group is not hidden behind the sticky header in a way that makes the drop target unreadable.
11. **Column fit.** On first load after hydration, columns without a saved width are as wide as their content: a "P0" / "MVP" column is narrow, a date column ≈ 116px, a long-text column is capped at 360px, and no header label is cut off. Columns with a saved width keep it. Typing in a cell does not change any column width. Double-click a resize handle: that column refits. Drag a fitted column: it starts from its fitted width and persists (≥ 80px). "Fit all columns" in the board ⋯ menu refits everything, including the Name column, with one request in the Network panel and no page reload. A viewer does not see the item. Then check the 50 ms budget above.
12. **Created columns.** Created by (160px) and Created at (176px) show their content without overlap in the owner's locale.
13. **Centering.** Every value column's cells, header label, roll-up cell and summary cell are centered on the column; the header label is centered on the column, not on the space left of the menu button; hovering a header shows the grip at the left edge and the menu at the right edge without moving the label. The Name column is left-aligned. Entering edit mode on a number does not move the text sideways. Coarse: the header is grip, label, menu from the left.
14. **Loading skeleton and print.** The board skeleton's rows are 28px and do not jump when the table swaps in. `Cmd+P` on a board still prints as it did (this plan adds no print rule; the board is not a `[data-print-root]` surface).
15. **Hydration.** No hydration warning in the console on a board with no saved widths, on desktop and with touch emulation.

After promotion, repeat 1, 6, 7, 8 and 11 on the live DAAS "Programme Governance & PMO" board.

## How to test (for the owner, after merge to `develop`)

1. Pull `develop`, run the app, open a board with several groups in the Table view.
2. Scroll down inside a long group. Expected: the column labels stay at the top and the group's title stays under them.
3. Scroll right. Expected: the Name column and the group title stay in view.
4. Rest the pointer on a row whose name is cut off. Expected: after a moment the full name unrolls over the cells to its right, with the open / add / menu buttons at its end.
5. Look at a narrow column such as a priority or a date. Expected: it is only as wide as its content, and its values are centered.
6. Drag a column wider, then double-click its right edge. Expected: it snaps back to fit its content.
7. Open the board's ⋯ menu and choose "Fit all columns". Expected: every column, including Name, refits; nothing reloads.
8. Open the same board on an iPad. Expected: rows are 44px, every control is a 44px target and always visible, no hover peek.

## Self-review notes

- **Spec coverage.** §1 Name cell → Task 2. §2 header and group row → Task 3. §3 dense rows → Task 1 (the two `h-7` inputs it names are in Tasks 2 and 3, which own those files). §4 column fit → Tasks 4 and 5. §5 centering → Task 6. "Print styles and the loading skeleton are checked" → Task 1 (skeleton comment; it reads `ROW_HEIGHT`) and browser item 14. Performance budget → the section above. Testing list → each task's tests plus the browser list.
- **Not done here, on purpose:** `GroupRollupRow`'s and `SummaryRow`'s Name-track label keeps `px-4` (it is a label in the Name column, not a value cell). `AddItemRow` / `AddSubitemRow` keep their ~30px height (they are input rows, not item rows; the spec does not list them). `ROW_HAIRLINE`'s 16px inset is unchanged. The per-user density setting, column hiding and any Kanban / Calendar / item-panel change are spec non-goals.
- **Stale docs outside this plan's reach:** `.claude/skills/pulse-ui/SKILL.md` still says board rows are 36px (`ROW_HEIGHT = 36` in `BoardTable.tsx`). The orchestrator updates it in the wrap-up commit.
- **e2e:** `e2e/board-columns.spec.ts`, `custom-fields.spec.ts`, `subitems.spec.ts`, `mirror-columns.spec.ts`, `time-tracking.spec.ts` and `automations-date.spec.ts` select `getByRole("button", { name: "Add column" })` and `"<Name> column menu"`. With one header these are now unique on any board, so the specs get stricter, not broken. They are not part of the four gates.
