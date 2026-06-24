# Timeline Spans + Colorize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Timeline (Gantt) view draw a span between a chosen **start** and **end** date column, render one-date items as dots and no-date items as Unscheduled, and colorize bars/dots by a chosen status/dropdown column.

**Architecture:** The view's `config` jsonb gains `end_column_id` and `color_column_id` (no DB migration — config is free-form jsonb validated by a Zod schema). A new pure resolver derives each item's span from two columns; a new pure helper resolves a per-item color from a status/dropdown column's option palette. `GanttBoard` wires three pickers, drives the visual from local state (0 server round-trips), and persists picks via the existing `updateBoardView` Server Action without `router.refresh()`.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), React client components, Zustand/React-Query board cache, dnd-kit, Zod, Vitest + Testing Library, Tailwind v4.

## Global Constraints

- **Server Components by default; Server Actions for all mutations.** This view is already a client component; mutations go through `updateBoardView` / `mutations.setCell`.
- **Validate at boundaries with Zod.** Config changes flow through `timelineConfigSchema`. TypeScript strict; no `any` without justification.
- **In-page view changes = 0 new server round-trips.** Changing Start / End / Color-by / Zoom recomputes purely over the already-loaded board cache and updates **local state**; persistence to `config` happens via Server Action with **no `router.refresh()`** (gotcha-09).
- **No DB migration.** `board_views.config` is jsonb; only `timelineConfigSchema` changes.
- **Commit identity:** author every commit as `Danijel Jovanovic <info@synapse-solutions.ai>`. Commit subjects lowercase after `type(scope):`; include a descriptive body and the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Stage explicitly by path — never `git add -A`.
- **Color-eligible columns** are exactly `kind === "status"` and `kind === "dropdown"`.
- **Date cell value shape:** `{ date?: string; end?: string }` (YYYY-MM-DD). Status value: `{ optionId: string | null }`. Dropdown value: `{ optionIds: string[] }`. `ColumnOption = { id: string; label: string; color: string }`, stored at `column.settings.options`.

---

## File Structure

- `src/lib/validations/view-actions.ts` — extend `timelineConfigSchema` (Task 1).
- `src/lib/boards/dates.ts` — new `resolveTimelineSpan` + `defaultTimelineColumns` (Tasks 2, 6). `itemDateRange` stays unchanged (still used by `calendar.ts`).
- `src/lib/boards/timeline-color.ts` — new `colorForItem` helper (Task 5).
- `src/lib/boards/gantt.ts` — `buildGanttRows` consumes the resolver; `onBarMoved` / `onBarResized` write two columns (Tasks 3, 4).
- `src/components/boards/GanttBoard.tsx` — three pickers, colored render, local-state persistence, two-column drag/resize (Task 7).
- Tests: `dates.test.ts`, `timeline-color.test.ts`, `gantt.test.ts`, `view-actions` validation test, `GanttBoard.test.tsx` (each task owns its tests).

## Execution DAG

- **Dependency edges:** Task 3 → Task 2. Task 4 → Task 2. Task 7 → Tasks 1, 3, 4, 5, 6. Task 8 → Task 7.
- **Parallel batches:**
  - **Batch A (no deps):** Task 1, Task 2, Task 5, Task 6 — four independent pure units, dispatch concurrently.
  - **Batch B (after Task 2):** Task 3, Task 4 — concurrent.
  - **Batch C (after 1,3,4,5,6):** Task 7.
  - **Batch D (after 7):** Task 8.
- **Critical path:** Task 2 → Task 3 → Task 7 → Task 8 (4 deep).

All file edits in Batch A/B touch different files (validation, dates, timeline-color, gantt), so no worktree isolation is needed within a batch; Tasks 3 and 4 both touch `gantt.ts` so run them sequentially or have one agent do both if dispatched in the same folder.

---

### Task 1: Extend timeline view config schema

**Files:**

- Modify: `src/lib/validations/view-actions.ts:26-29`
- Test: `src/lib/validations/view-actions.test.ts` (create if absent)

**Interfaces:**

- Consumes: nothing.
- Produces: `timelineConfigSchema` now accepts `end_column_id?: string | null` and `color_column_id?: string | null` (both `uuid().nullable().optional()`), alongside existing `date_column_id` and `zoom`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/validations/view-actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { timelineConfigSchema } from "@/lib/validations/view-actions";

describe("timelineConfigSchema", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  it("accepts end_column_id and color_column_id", () => {
    const parsed = timelineConfigSchema.safeParse({
      date_column_id: uuid,
      end_column_id: uuid,
      color_column_id: uuid,
      zoom: "week",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts null for the new keys", () => {
    const parsed = timelineConfigSchema.safeParse({
      end_column_id: null,
      color_column_id: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-uuid color_column_id", () => {
    const parsed = timelineConfigSchema.safeParse({ color_column_id: "nope" });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/validations/view-actions.test.ts`
Expected: FAIL (`color_column_id` stripped/ignored → the reject test fails, or import shape differs).

- [ ] **Step 3: Extend the schema**

In `src/lib/validations/view-actions.ts`, replace the `timelineConfigSchema` block (lines 25-29):

```ts
// Timeline config: start date column id, optional end date column id,
// optional color-by column id (status/dropdown), and optional zoom level.
export const timelineConfigSchema = z.object({
  date_column_id: z.string().uuid().nullable().optional(),
  end_column_id: z.string().uuid().nullable().optional(),
  color_column_id: z.string().uuid().nullable().optional(),
  zoom: z.enum(["week", "month"]).optional(),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/validations/view-actions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/view-actions.ts src/lib/validations/view-actions.test.ts
git commit -m "feat(boards): add end/color column ids to timeline view config"
```

---

### Task 2: Two-column span resolver

**Files:**

- Modify: `src/lib/boards/dates.ts` (append; leave `itemDateRange` untouched)
- Test: `src/lib/boards/dates.test.ts` (create if absent)

**Interfaces:**

- Consumes: `CacheCellValue` from `@/lib/boards/cache`.
- Produces:

  ```ts
  export type TimelineSpan = {
    start: string;
    end: string;
    isMilestone: boolean;
  };
  export function resolveTimelineSpan(
    itemId: string,
    cellValues: CacheCellValue[],
    startColumnId: string,
    endColumnId: string | null,
  ): TimelineSpan | null;
  ```

  Rules: start = start column cell `.date`; end = end column cell `.date` when `endColumnId` set, else start column cell `.end` (legacy single-column), else start. Neither date → `null`. Exactly one → dot (`isMilestone: true`) at that date. Both, with `end < start` → clamp to dot at start. Both equal → dot. Both, end > start → span.

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/dates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveTimelineSpan } from "@/lib/boards/dates";
import type { CacheCellValue } from "@/lib/boards/cache";

const cells = [
  { item_id: "both", column_id: "start", value: { date: "2026-06-02" } },
  { item_id: "both", column_id: "end", value: { date: "2026-06-05" } },
  { item_id: "startonly", column_id: "start", value: { date: "2026-06-02" } },
  { item_id: "endonly", column_id: "end", value: { date: "2026-06-09" } },
  { item_id: "inverted", column_id: "start", value: { date: "2026-06-10" } },
  { item_id: "inverted", column_id: "end", value: { date: "2026-06-01" } },
  {
    item_id: "legacy",
    column_id: "start",
    value: { date: "2026-06-02", end: "2026-06-04" },
  },
] as unknown as CacheCellValue[];

describe("resolveTimelineSpan", () => {
  it("draws a span when both dates exist", () => {
    expect(resolveTimelineSpan("both", cells, "start", "end")).toEqual({
      start: "2026-06-02",
      end: "2026-06-05",
      isMilestone: false,
    });
  });

  it("draws a dot at the start when only start exists", () => {
    expect(resolveTimelineSpan("startonly", cells, "start", "end")).toEqual({
      start: "2026-06-02",
      end: "2026-06-02",
      isMilestone: true,
    });
  });

  it("draws a dot at the end when only end exists", () => {
    expect(resolveTimelineSpan("endonly", cells, "start", "end")).toEqual({
      start: "2026-06-09",
      end: "2026-06-09",
      isMilestone: true,
    });
  });

  it("returns null when neither date exists", () => {
    expect(resolveTimelineSpan("none", cells, "start", "end")).toBeNull();
  });

  it("clamps an inverted range to a dot at the start", () => {
    expect(resolveTimelineSpan("inverted", cells, "start", "end")).toEqual({
      start: "2026-06-10",
      end: "2026-06-10",
      isMilestone: true,
    });
  });

  it("uses the legacy single-column .end when endColumnId is null", () => {
    expect(resolveTimelineSpan("legacy", cells, "start", null)).toEqual({
      start: "2026-06-02",
      end: "2026-06-04",
      isMilestone: false,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/boards/dates.test.ts`
Expected: FAIL with "resolveTimelineSpan is not a function".

- [ ] **Step 3: Implement the resolver**

Append to `src/lib/boards/dates.ts`:

```ts
export type TimelineSpan = { start: string; end: string; isMilestone: boolean };

/**
 * Resolve an item's timeline span from a start column and an optional end
 * column. When endColumnId is null, falls back to the start column's own
 * `.end` (legacy single-column range). See the timeline-spans design.
 */
export function resolveTimelineSpan(
  itemId: string,
  cellValues: CacheCellValue[],
  startColumnId: string,
  endColumnId: string | null,
): TimelineSpan | null {
  const startCell = cellValues.find(
    (c) => c.item_id === itemId && c.column_id === startColumnId,
  );
  const startVal = startCell?.value as
    | { date?: string; end?: string }
    | undefined;
  const startDate = startVal?.date;

  let endDate: string | undefined;
  if (endColumnId) {
    const endCell = cellValues.find(
      (c) => c.item_id === itemId && c.column_id === endColumnId,
    );
    endDate = (endCell?.value as { date?: string } | undefined)?.date;
  } else {
    endDate = startVal?.end;
  }

  if (!startDate && !endDate) return null;

  // Exactly one date → a milestone dot at that date.
  if (!startDate || !endDate) {
    const d = (startDate ?? endDate) as string;
    return { start: d, end: d, isMilestone: true };
  }

  // Inverted range → clamp to a dot at the start (never a negative-width bar).
  if (endDate < startDate) {
    return { start: startDate, end: startDate, isMilestone: true };
  }

  return { start: startDate, end: endDate, isMilestone: startDate === endDate };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/boards/dates.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/dates.ts src/lib/boards/dates.test.ts
git commit -m "feat(boards): add two-column timeline span resolver"
```

---

### Task 3: buildGanttRows consumes the span resolver

**Files:**

- Modify: `src/lib/boards/gantt.ts:46-81`
- Test: `src/lib/boards/gantt.test.ts` (update existing calls + add cases)

**Interfaces:**

- Consumes: `resolveTimelineSpan` (Task 2).
- Produces: new signature

  ```ts
  buildGanttRows(
    items: { id: string; name: string }[],
    cellValues: CacheCellValue[],
    startColumnId: string,
    endColumnId: string | null,
    rangeStartISO: string,
    dayCount: number,
    zoom: string,
  ): { rows: GanttRow[] }
  ```

  `GanttRow` shape is unchanged. Used by Task 7.

- [ ] **Step 1: Update the failing test**

In `src/lib/boards/gantt.test.ts`, update both `buildGanttRows(...)` calls to pass `null` for the new `endColumnId` arg (after `"d1"`), and add a two-column case. Replace the fixture `cells` and the first `describe` block (lines 14-48) with:

```ts
const cells = [
  {
    item_id: "i1",
    column_id: "d1",
    value: { date: "2026-06-02", end: "2026-06-04" },
  },
  { item_id: "i2", column_id: "d1", value: { date: "2026-06-03" } }, // milestone
  // i3 unscheduled
] as never;

const twoColCells = [
  { item_id: "i1", column_id: "s1", value: { date: "2026-06-02" } },
  { item_id: "i1", column_id: "e1", value: { date: "2026-06-06" } },
] as never;

describe("buildGanttRows", () => {
  const { rows } = buildGanttRows(
    items,
    cells,
    "d1",
    null,
    "2026-06-01",
    30,
    "month",
  );
  it("computes start column + span (1-based day offset)", () => {
    const a = rows.find((r) => r.itemId === "i1")!;
    expect(a).toMatchObject({
      startCol: 1,
      spanCols: 3,
      isMilestone: false,
      scheduled: true,
    });
  });
  it("marks a single-day item as a milestone", () => {
    expect(rows.find((r) => r.itemId === "i2")!.isMilestone).toBe(true);
  });
  it("marks date-less items unscheduled", () => {
    expect(rows.find((r) => r.itemId === "i3")!.scheduled).toBe(false);
  });
  it("builds a span from two separate columns", () => {
    const { rows: r2 } = buildGanttRows(
      items,
      twoColCells,
      "s1",
      "e1",
      "2026-06-01",
      30,
      "month",
    );
    expect(r2.find((r) => r.itemId === "i1")).toMatchObject({
      startCol: 1,
      spanCols: 5,
      isMilestone: false,
      scheduled: true,
    });
  });
});
```

Also update the `detectViolations` test's `buildGanttRows(items, cells, "d1", "2026-06-01", 30, "month")` call (around line 52) to `buildGanttRows(items, cells, "d1", null, "2026-06-01", 30, "month")`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/boards/gantt.test.ts`
Expected: FAIL (arity mismatch / wrong span — `endColumnId` not yet a parameter).

- [ ] **Step 3: Update buildGanttRows**

In `src/lib/boards/gantt.ts`, change the import line 1 and replace the function body (lines 46-81):

```ts
import { itemDateRange, resolveTimelineSpan } from "@/lib/boards/dates";
```

```ts
export function buildGanttRows(
  items: { id: string; name: string }[],
  cellValues: CacheCellValue[],
  startColumnId: string,
  endColumnId: string | null,
  rangeStartISO: string,
  dayCount: number,
  zoom: string,
): { rows: GanttRow[] } {
  void dayCount;
  void zoom;

  const rows: GanttRow[] = items.map((item) => {
    const span = resolveTimelineSpan(
      item.id,
      cellValues,
      startColumnId,
      endColumnId,
    );

    if (!span) {
      return { itemId: item.id, name: item.name, scheduled: false };
    }

    const startCol = diffDaysISO(rangeStartISO, span.start);
    const spanCols = diffDaysISO(span.start, span.end) + 1;

    return {
      itemId: item.id,
      name: item.name,
      scheduled: true,
      startCol,
      spanCols,
      isMilestone: span.isMilestone,
      startISO: span.start,
      endISO: span.end,
    };
  });

  return { rows };
}
```

Note: `itemDateRange` is still imported because `onBarMoved`/`onBarResized` callers in `GanttBoard` use it; leave the import. (`addDaysISO` import unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/boards/gantt.test.ts`
Expected: PASS (all cases incl. the new two-column span).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/gantt.ts src/lib/boards/gantt.test.ts
git commit -m "feat(boards): build gantt rows from start and end columns"
```

---

### Task 4: Two-column drag/resize writes

**Files:**

- Modify: `src/lib/boards/gantt.ts:26-30` (SetCellArg) and `:120-164` (`onBarMoved`, `onBarResized`)
- Test: `src/lib/boards/gantt.test.ts` (extend the existing `onBarMoved`/`onBarResized` tests)

**Interfaces:**

- Consumes: nothing new.
- Produces: new signatures

  ```ts
  onBarMoved(itemId, deltaDays, range, startColumnId, endColumnId: string | null, setCell): void
  onBarResized(itemId, newEndISO, range, startColumnId, endColumnId: string | null, setCell): void
  ```

  When `endColumnId` is set: move writes `{ date }` to both columns; resize writes `{ date }` to the end column only. When `endColumnId` is null (legacy): both keep writing `{ date, end }` to the start column. Used by Task 7.

- [ ] **Step 1: Write the failing test**

Find the existing `onBarMoved` / `onBarResized` describe blocks in `src/lib/boards/gantt.test.ts`. Replace them (or add alongside) with two-column assertions:

```ts
describe("onBarMoved (two columns)", () => {
  it("shifts both the start and end column by the delta", () => {
    const writes: unknown[] = [];
    onBarMoved(
      "i1",
      2,
      { start: "2026-06-02", end: "2026-06-05" },
      "s1",
      "e1",
      (a) => writes.push(a),
    );
    expect(writes).toEqual([
      { itemId: "i1", columnId: "s1", value: { date: "2026-06-04" } },
      { itemId: "i1", columnId: "e1", value: { date: "2026-06-07" } },
    ]);
  });
  it("writes a single-column range when endColumnId is null (legacy)", () => {
    const writes: unknown[] = [];
    onBarMoved(
      "i1",
      1,
      { start: "2026-06-02", end: "2026-06-05" },
      "d1",
      null,
      (a) => writes.push(a),
    );
    expect(writes).toEqual([
      {
        itemId: "i1",
        columnId: "d1",
        value: { date: "2026-06-03", end: "2026-06-06" },
      },
    ]);
  });
});

describe("onBarResized (two columns)", () => {
  it("writes only the end column when endColumnId is set", () => {
    const writes: unknown[] = [];
    onBarResized(
      "i1",
      "2026-06-09",
      { start: "2026-06-02", end: "2026-06-05" },
      "s1",
      "e1",
      (a) => writes.push(a),
    );
    expect(writes).toEqual([
      { itemId: "i1", columnId: "e1", value: { date: "2026-06-09" } },
    ]);
  });
  it("writes a single-column range when endColumnId is null (legacy)", () => {
    const writes: unknown[] = [];
    onBarResized(
      "i1",
      "2026-06-09",
      { start: "2026-06-02", end: "2026-06-05" },
      "d1",
      null,
      (a) => writes.push(a),
    );
    expect(writes).toEqual([
      {
        itemId: "i1",
        columnId: "d1",
        value: { date: "2026-06-02", end: "2026-06-09" },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/boards/gantt.test.ts`
Expected: FAIL (old single-column signatures).

- [ ] **Step 3: Generalize the write helpers**

In `src/lib/boards/gantt.ts`, replace the `SetCellArg` type (lines 26-30):

```ts
export type SetCellArg = {
  itemId: string;
  columnId: string;
  value: { date: string; end?: string };
};
```

Replace `onBarMoved` and `onBarResized` (lines 120-164):

```ts
/**
 * Shift a bar by deltaDays. With a separate end column, writes the new start to
 * the start column and the new end to the end column. In legacy single-column
 * mode (endColumnId null), writes { date, end } to the start column.
 */
export function onBarMoved(
  itemId: string,
  deltaDays: number,
  range: { start: string; end: string },
  startColumnId: string,
  endColumnId: string | null,
  setCell: (arg: SetCellArg) => void,
): void {
  const newStart = addDaysISO(range.start, deltaDays);
  const newEnd = addDaysISO(range.end, deltaDays);
  if (endColumnId) {
    setCell({ itemId, columnId: startColumnId, value: { date: newStart } });
    setCell({ itemId, columnId: endColumnId, value: { date: newEnd } });
  } else {
    setCell({
      itemId,
      columnId: startColumnId,
      value: { date: newStart, end: newEnd },
    });
  }
}

/**
 * Update the end of a bar (right-edge resize). With a separate end column,
 * writes only the end column. In legacy single-column mode, writes
 * { date: range.start, end: newEndISO } to the start column.
 */
export function onBarResized(
  itemId: string,
  newEndISO: string,
  range: { start: string; end: string },
  startColumnId: string,
  endColumnId: string | null,
  setCell: (arg: SetCellArg) => void,
): void {
  if (endColumnId) {
    setCell({ itemId, columnId: endColumnId, value: { date: newEndISO } });
  } else {
    setCell({
      itemId,
      columnId: startColumnId,
      value: { date: range.start, end: newEndISO },
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/boards/gantt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/gantt.ts src/lib/boards/gantt.test.ts
git commit -m "feat(boards): write two date columns on timeline drag and resize"
```

---

### Task 5: Per-item color helper

**Files:**

- Create: `src/lib/boards/timeline-color.ts`
- Test: `src/lib/boards/timeline-color.test.ts`

**Interfaces:**

- Consumes: `CacheCellValue`, `CacheColumn` from `@/lib/boards/cache`.
- Produces:

  ```ts
  export const TIMELINE_NEUTRAL_COLOR = "#c4c7d0";
  export function colorForItem(
    itemId: string,
    colorColumn: CacheColumn | null,
    cellValues: CacheCellValue[],
  ): string | null;
  ```

  `null` when no color column (caller uses the `bg-primary` accent). For a status column reads `{ optionId }`; for dropdown reads first of `{ optionIds }`. Missing/unmatched value → `TIMELINE_NEUTRAL_COLOR`. Used by Task 7.

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/timeline-color.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  colorForItem,
  TIMELINE_NEUTRAL_COLOR,
} from "@/lib/boards/timeline-color";
import type { CacheCellValue, CacheColumn } from "@/lib/boards/cache";

const statusCol = {
  id: "c1",
  kind: "status",
  settings: { options: [{ id: "o1", label: "Done", color: "#00c875" }] },
} as unknown as CacheColumn;

const dropdownCol = {
  id: "c2",
  kind: "dropdown",
  settings: { options: [{ id: "p1", label: "A", color: "#579bfc" }] },
} as unknown as CacheColumn;

const cells = [
  { item_id: "i1", column_id: "c1", value: { optionId: "o1" } },
  { item_id: "i2", column_id: "c1", value: { optionId: null } },
  { item_id: "i3", column_id: "c2", value: { optionIds: ["p1"] } },
] as unknown as CacheCellValue[];

describe("colorForItem", () => {
  it("returns null when no color column is selected", () => {
    expect(colorForItem("i1", null, cells)).toBeNull();
  });
  it("maps a status value to its option color", () => {
    expect(colorForItem("i1", statusCol, cells)).toBe("#00c875");
  });
  it("uses the first dropdown option color", () => {
    expect(colorForItem("i3", dropdownCol, cells)).toBe("#579bfc");
  });
  it("returns neutral when the item has no value in the column", () => {
    expect(colorForItem("i2", statusCol, cells)).toBe(TIMELINE_NEUTRAL_COLOR);
    expect(colorForItem("missing", statusCol, cells)).toBe(
      TIMELINE_NEUTRAL_COLOR,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/boards/timeline-color.test.ts`
Expected: FAIL with "colorForItem is not a function".

- [ ] **Step 3: Implement the helper**

Create `src/lib/boards/timeline-color.ts`:

```ts
import type { CacheCellValue, CacheColumn } from "@/lib/boards/cache";

/** Bar/dot fill for items with no value in the chosen color column. */
export const TIMELINE_NEUTRAL_COLOR = "#c4c7d0";

type OptionSettings = {
  options?: { id: string; label: string; color: string }[];
};

/**
 * Resolve the bar/dot color for one item from a status/dropdown column's
 * option palette. Returns null when no color column is selected (caller falls
 * back to the single accent). Missing or unmatched value → neutral gray.
 */
export function colorForItem(
  itemId: string,
  colorColumn: CacheColumn | null,
  cellValues: CacheCellValue[],
): string | null {
  if (!colorColumn) return null;

  const settings = (colorColumn.settings ?? {}) as OptionSettings;
  const options = settings.options ?? [];

  const cell = cellValues.find(
    (c) => c.item_id === itemId && c.column_id === colorColumn.id,
  );
  const value = cell?.value as
    | { optionId?: string | null; optionIds?: string[] }
    | undefined;

  const optionId =
    colorColumn.kind === "status"
      ? (value?.optionId ?? null)
      : (value?.optionIds?.[0] ?? null);

  if (!optionId) return TIMELINE_NEUTRAL_COLOR;
  return (
    options.find((o) => o.id === optionId)?.color ?? TIMELINE_NEUTRAL_COLOR
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/boards/timeline-color.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/timeline-color.ts src/lib/boards/timeline-color.test.ts
git commit -m "feat(boards): resolve timeline bar color from status or dropdown"
```

---

### Task 6: Smart default column picker

**Files:**

- Modify: `src/lib/boards/dates.ts` (append)
- Test: `src/lib/boards/dates.test.ts` (add a describe block)

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export function defaultTimelineColumns(
    dateColumns: { id: string; name: string }[],
  ): { startColumnId: string | null; endColumnId: string | null };
  ```

  start ← first column whose name matches `/start|begin/i`, else the first date column. end ← first _other_ column matching `/due|end|finish|target/i`, else null. Used by Task 7 for initial picker state only.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/boards/dates.test.ts`:

```ts
import { defaultTimelineColumns } from "@/lib/boards/dates";

describe("defaultTimelineColumns", () => {
  it("matches start and end columns by name", () => {
    const cols = [
      { id: "a", name: "Start Date" },
      { id: "b", name: "Due Date" },
      { id: "c", name: "Other" },
    ];
    expect(defaultTimelineColumns(cols)).toEqual({
      startColumnId: "a",
      endColumnId: "b",
    });
  });
  it("falls back to the first date column for start and null for end", () => {
    const cols = [{ id: "x", name: "When" }];
    expect(defaultTimelineColumns(cols)).toEqual({
      startColumnId: "x",
      endColumnId: null,
    });
  });
  it("never reuses the start column as the end column", () => {
    const cols = [{ id: "a", name: "Start / End" }];
    expect(defaultTimelineColumns(cols)).toEqual({
      startColumnId: "a",
      endColumnId: null,
    });
  });
  it("returns nulls for no date columns", () => {
    expect(defaultTimelineColumns([])).toEqual({
      startColumnId: null,
      endColumnId: null,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/boards/dates.test.ts`
Expected: FAIL with "defaultTimelineColumns is not a function".

- [ ] **Step 3: Implement the heuristic**

Append to `src/lib/boards/dates.ts`:

```ts
/**
 * Pick sensible default start/end columns for a timeline view by column name.
 * Used only to seed the pickers when the view config has no explicit choice;
 * an explicit pick always overrides and is persisted.
 */
export function defaultTimelineColumns(
  dateColumns: { id: string; name: string }[],
): { startColumnId: string | null; endColumnId: string | null } {
  const startRe = /start|begin/i;
  const endRe = /due|end|finish|target/i;

  const start =
    dateColumns.find((c) => startRe.test(c.name)) ?? dateColumns[0] ?? null;
  const end =
    dateColumns.find((c) => endRe.test(c.name) && c.id !== start?.id) ?? null;

  return { startColumnId: start?.id ?? null, endColumnId: end?.id ?? null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/boards/dates.test.ts`
Expected: PASS (all `dates.test.ts` cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/dates.ts src/lib/boards/dates.test.ts
git commit -m "feat(boards): default timeline start/end columns by name"
```

---

### Task 7: Wire pickers, color, and two-column drag into GanttBoard

**Files:**

- Modify: `src/components/boards/GanttBoard.tsx`
- Test: covered by Task 8 (this task ends green on the full suite + a manual smoke).

**Interfaces:**

- Consumes: `resolveTimelineSpan` is used indirectly via `buildGanttRows(startColumnId, endColumnId, …)` (Task 3); `onBarMoved`/`onBarResized` two-column signatures (Task 4); `colorForItem` + `TIMELINE_NEUTRAL_COLOR` (Task 5); `defaultTimelineColumns` (Task 6); `pillTextColor` from `@/lib/boards/contrast`.
- Produces: the finished view. No new exports.

- [ ] **Step 1: Add imports**

In `src/components/boards/GanttBoard.tsx`, extend the existing imports:

```ts
import { resolveDateColumn, itemDateRange } from "@/lib/boards/dates";
import { defaultTimelineColumns } from "@/lib/boards/dates";
import { colorForItem } from "@/lib/boards/timeline-color";
import { pillTextColor } from "@/lib/boards/contrast";
```

(Keep `resolveDateColumn`/`itemDateRange` — still used. You may merge the two `dates` imports into one line.)

- [ ] **Step 2: Read the extended config and seed local state**

Replace the config/zoom/column resolution block (currently lines 162-171) with:

```ts
const selectedView = payload.views.find((v) => v.id === selectedViewId);
const config = (selectedView?.config ?? null) as {
  date_column_id?: string | null;
  end_column_id?: string | null;
  color_column_id?: string | null;
  zoom?: "week" | "month";
} | null;

const dateColumns = cache.columns.filter((c) => c.kind === "date");
const colorColumns = cache.columns.filter(
  (c) => c.kind === "status" || c.kind === "dropdown",
);

// Smart defaults when the view has never set start/end explicitly.
const seeded = defaultTimelineColumns(
  dateColumns.map((c) => ({ id: c.id, name: c.name })),
);

const [zoom, setZoom] = useState<"week" | "month">(config?.zoom ?? "month");
const [startColId, setStartColId] = useState<string | null>(
  config?.date_column_id ?? seeded.startColumnId,
);
const [endColId, setEndColId] = useState<string | null>(
  config?.end_column_id ?? seeded.endColumnId,
);
const [colorColId, setColorColId] = useState<string | null>(
  config?.color_column_id ?? null,
);

const dateColumn =
  dateColumns.find((c) => c.id === startColId) ?? dateColumns[0] ?? null;
const colorColumn = colorColumns.find((c) => c.id === colorColId) ?? null;
```

(Remove the old `const zoom = …`, `const dateColumn = resolveDateColumn(…)`, and `const dateColumns = …` lines this replaces. `resolveDateColumn` may now be unused — drop it from the import if so to keep lint green.)

- [ ] **Step 3: Persist helper (local-first, no refetch)**

Replace `handleZoomChange` and `handleDateColumnChange` (currently lines 315-333) with a single merged-config persister plus thin setters:

```ts
function persistConfig(next: {
  date_column_id?: string | null;
  end_column_id?: string | null;
  color_column_id?: string | null;
  zoom?: "week" | "month";
}) {
  const merged = {
    date_column_id: startColId,
    end_column_id: endColId,
    color_column_id: colorColId,
    zoom,
    ...next,
  };
  // In-page change over already-loaded data: update local state instantly
  // (0 server round-trips) and persist config in the background. No
  // router.refresh() — see gotcha-09.
  startTransition(() => {
    void updateBoardView({ viewId: selectedViewId, config: merged });
  });
}

function handleZoomChange(newZoom: "week" | "month") {
  setZoom(newZoom);
  persistConfig({ zoom: newZoom });
}
function handleStartColumnChange(columnId: string) {
  setStartColId(columnId);
  persistConfig({ date_column_id: columnId });
}
function handleEndColumnChange(columnId: string) {
  const next = columnId === "" ? null : columnId;
  setEndColId(next);
  persistConfig({ end_column_id: next });
}
function handleColorColumnChange(columnId: string) {
  const next = columnId === "" ? null : columnId;
  setColorColId(next);
  persistConfig({ color_column_id: next });
}
```

(`router` may now be unused; remove the `useRouter` import/usage if so. Keep `startTransition`.)

- [ ] **Step 4: Pass endColId into buildGanttRows**

Update the `buildGanttRows` call inside the `ganttResult` memo (currently lines 200-207) to insert `endColId` after `dateColumn.id`, and add `endColId` to the dependency array:

```ts
return buildGanttRows(
  cache.items,
  cache.cellValues,
  dateColumn.id,
  endColId,
  rangeStartISO,
  dayCount,
  zoom,
);
```

```ts
}, [dateColumn, endColId, rangeStartISO, cache.items, cache.cellValues, dayCount, zoom]);
```

- [ ] **Step 5: Compute a color per row**

Where `scheduledRows` is consumed for rendering, compute colors. Add a memo after `scheduledRows` (near line 225):

```ts
const rowColors = useMemo(() => {
  const map = new Map<string, string | null>();
  for (const r of rows) {
    map.set(r.itemId, colorForItem(r.itemId, colorColumn, cache.cellValues));
  }
  return map;
}, [rows, colorColumn, cache.cellValues]);
```

- [ ] **Step 6: Render the three pickers**

In the controls bar, replace the single "Date by" `<label>`/`<select>` group (currently lines 391-413) with Start, End, and Color-by pickers:

```tsx
<div className="ml-auto flex items-center gap-3">
  <label
    htmlFor="gantt-start-column"
    className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium"
  >
    <CalendarDays className="size-3.5" aria-hidden />
    Start
  </label>
  <select
    id="gantt-start-column"
    aria-label="Start date column"
    value={dateColumn?.id ?? ""}
    onChange={(e) => handleStartColumnChange(e.target.value)}
    className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
  >
    {dateColumns.map((c) => (
      <option key={c.id} value={c.id}>
        {c.name}
      </option>
    ))}
  </select>

  <label
    htmlFor="gantt-end-column"
    className="text-muted-foreground text-xs font-medium"
  >
    End
  </label>
  <select
    id="gantt-end-column"
    aria-label="End date column"
    value={endColId ?? ""}
    onChange={(e) => handleEndColumnChange(e.target.value)}
    className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
  >
    <option value="">None</option>
    {dateColumns.map((c) => (
      <option key={c.id} value={c.id}>
        {c.name}
      </option>
    ))}
  </select>

  <label
    htmlFor="gantt-color-column"
    className="text-muted-foreground text-xs font-medium"
  >
    Color by
  </label>
  <select
    id="gantt-color-column"
    aria-label="Color by column"
    value={colorColId ?? ""}
    onChange={(e) => handleColorColumnChange(e.target.value)}
    className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
  >
    <option value="">None</option>
    {colorColumns.map((c) => (
      <option key={c.id} value={c.id}>
        {c.name}
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 7: Thread color + two-column ids into rows and drag**

Update the `<GanttRowItem>` usage (currently lines 458-482): add a `color` prop and pass `endColumnId`. Replace its `dateColumnId={resolvedDateColumn.id}` and the `onBarResized` callback with:

```tsx
<GanttRowItem
  key={row.itemId}
  row={row}
  rowIdx={rowIdx}
  totalW={totalW}
  todayOffset={todayOffset}
  dayCount={dayCount}
  startColumnId={resolvedDateColumn.id}
  endColumnId={endColId}
  color={rowColors.get(row.itemId) ?? null}
  allRows={scheduledRows}
  dependencies={cache.dependencies}
  violations={violations}
  onBarResized={(itemId, newEndISO, range) =>
    onBarResized(
      itemId,
      newEndISO,
      range,
      resolvedDateColumn.id,
      endColId,
      mutations.setCell as Parameters<typeof onBarResized>[5],
    )
  }
  addDependency={mutations.addDependency}
  removeDependency={mutations.removeDependency}
/>
```

Update `handleDragEnd` (currently lines 335-354) so the move write passes both columns:

```ts
onBarMoved(
  data.itemId,
  deltaDays,
  range,
  data.startColumnId,
  data.endColumnId,
  mutations.setCell as Parameters<typeof onBarMoved>[5],
);
```

- [ ] **Step 8: Update BarDragData and GanttRowItem props/render**

Change the `BarDragData` type (currently lines 127-134) to carry both columns:

```ts
type BarDragData = {
  kind: "bar";
  itemId: string;
  startISO: string;
  endISO: string;
  startColumnId: string;
  endColumnId: string | null;
  startDayOffset: number;
};
```

In `GanttRowItem`, update the props type and the `dragData` object: replace `dateColumnId: string` with `startColumnId: string; endColumnId: string | null;`, add `color: string | null;`, and change `onBarResized`'s caller signature note (unchanged shape — still `(itemId, newEndISO, range)`). Build `dragData` with `startColumnId` and `endColumnId` instead of `dateColumnId`.

Apply the color to the bar and the milestone diamond. For the **milestone** block (currently ~743-764), when `color` is set use inline style instead of `bg-primary`:

```tsx
className={cn(
  "absolute rotate-45 cursor-grab rounded-sm",
  color ? "" : "bg-primary",
  isDragging && "opacity-50",
)}
style={{
  left: barLeft + DAY_W / 2 - MILESTONE / 2,
  top: ROW_H / 2 - MILESTONE / 2,
  width: MILESTONE,
  height: MILESTONE,
  ...(color ? { backgroundColor: color } : {}),
  ...barStyle,
}}
```

For the **bar** block (currently ~765-800), set the bar background and label text color:

```tsx
className={cn(
  "absolute flex cursor-grab items-center rounded-md shadow-sm",
  color ? "" : "bg-primary",
  isDragging && "opacity-50",
)}
style={{
  left: barLeft,
  top: ROW_H / 2 - BAR_H / 2,
  width: barWidth,
  height: BAR_H,
  ...(color ? { backgroundColor: color } : {}),
  ...barStyle,
}}
```

And the label `<span>` inside the bar:

```tsx
<span
  className={cn(
    "truncate text-[11px] font-medium",
    color ? "" : "text-primary-foreground",
  )}
  style={color ? { color: pillTextColor(color) } : undefined}
>
  {row.name}
</span>
```

- [ ] **Step 9: Run typecheck, lint, and the existing suite**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run src/components/boards/GanttBoard.test.tsx src/lib/boards/gantt.test.ts`
Expected: typecheck/lint clean; existing GanttBoard tests pass (the fixture's legacy single `{date,end}` column still renders spans because `endColId` seeds to null for a single date column).

- [ ] **Step 10: Commit**

```bash
git add src/components/boards/GanttBoard.tsx
git commit -m "feat(boards): timeline spans from two columns with color-by picker"
```

---

### Task 8: Component tests + full gate

**Files:**

- Modify: `src/components/boards/GanttBoard.test.tsx`

**Interfaces:**

- Consumes: the finished `GanttBoard` (Task 7).
- Produces: regression coverage for span/dot/unscheduled rendering, recolor on Color-by change, and no-refetch on picker change.

- [ ] **Step 1: Add a two-column + color fixture and tests**

In `src/components/boards/GanttBoard.test.tsx`, add a second fixture with separate Start/End date columns and a status column, plus a view whose config selects them. Then add tests. Use the existing render harness (QueryClientProvider + BoardPresenceProvider) already in the file:

```tsx
const START_COL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const END_COL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STATUS_COL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function twoColPayload() {
  return {
    board: { id: "b1", org_id: "o1", name: "My Board" },
    groups: [{ id: "g1", board_id: "b1" }],
    columns: [
      {
        id: START_COL,
        board_id: "b1",
        org_id: "o1",
        kind: "date",
        name: "Start Date",
        position: 0,
        settings: {},
      },
      {
        id: END_COL,
        board_id: "b1",
        org_id: "o1",
        kind: "date",
        name: "Due Date",
        position: 1,
        settings: {},
      },
      {
        id: STATUS_COL,
        board_id: "b1",
        org_id: "o1",
        kind: "status",
        name: "Status",
        position: 2,
        settings: { options: [{ id: "o1", label: "Done", color: "#00c875" }] },
      },
    ],
    items: [
      { id: "i1", name: "Spanned", group_id: "g1", position: 0 },
      { id: "i2", name: "DotOnly", group_id: "g1", position: 1 },
      { id: "i3", name: "Nothing", group_id: "g1", position: 2 },
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: START_COL,
        value: { date: "2026-06-02" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        item_id: "i1",
        column_id: END_COL,
        value: { date: "2026-06-06" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        item_id: "i1",
        column_id: STATUS_COL,
        value: { optionId: "o1" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        item_id: "i2",
        column_id: START_COL,
        value: { date: "2026-06-03" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    views: [
      {
        id: VIEW_ID,
        kind: "timeline",
        name: "Timeline",
        config: {
          date_column_id: START_COL,
          end_column_id: END_COL,
          zoom: "month",
        },
        board_id: "b1",
        org_id: "o1",
        position: 0,
      },
    ],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  };
}
```

Add tests (reuse the file's existing `renderBoard`/provider helper; if the file renders inline, mirror that):

```tsx
describe("GanttBoard — two-column spans + color", () => {
  beforeEach(() => {
    setCell.mockClear();
    refresh.mockClear();
  });

  it("renders a spanned item, a dot, and an unscheduled item", () => {
    renderBoard(twoColPayload());
    expect(screen.getByText("Spanned")).toBeInTheDocument();
    expect(screen.getByText("DotOnly")).toBeInTheDocument();
    // i3 has no dates → Unscheduled section
    expect(screen.getByText(/Unscheduled \(1\)/)).toBeInTheDocument();
  });

  it("colors the spanned bar from its status option", () => {
    renderBoard(twoColPayload());
    const label = screen.getByText("Spanned");
    // bar is the positioned ancestor carrying the inline backgroundColor
    const bar = label.closest("[style*='background']") as HTMLElement;
    expect(bar.style.backgroundColor).toBe("rgb(0, 200, 117)"); // #00c875
  });

  it("does not call router.refresh when changing the Color by picker", () => {
    renderBoard(twoColPayload());
    fireEvent.change(screen.getByLabelText("Color by column"), {
      target: { value: STATUS_COL },
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

Add `fireEvent` to the `@testing-library/react` import. If the file lacks a shared `renderBoard`, define one near the top that wraps `<GanttBoard payload={...} selectedViewId={VIEW_ID} />` in the same providers the existing tests use.

- [ ] **Step 2: Run the new tests to verify they fail (then pass after wiring)**

Run: `pnpm vitest run src/components/boards/GanttBoard.test.tsx`
Expected: PASS once Task 7 is merged (these assert Task 7 behavior). If red, fix the wiring in Task 7, not the test.

- [ ] **Step 3: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/components/boards/GanttBoard.test.tsx
git commit -m "test(boards): cover timeline two-column spans and colorization"
```

---

## Self-Review

**Spec coverage:**

- Span from start+end column → Tasks 2, 3, 7. ✓
- Neither date → Unscheduled; one date → dot → Task 2 (rules) + Task 8 (render assert). ✓
- Explicit picker + smart name default → Tasks 6, 7. ✓
- Colorize by status/dropdown; None = accent; missing = gray → Tasks 5, 7. ✓
- Preserve drag/resize across two columns + legacy single-column → Task 4, 7. ✓
- No DB migration (jsonb config) → Task 1. ✓
- Perf: 0 round-trips, local-state + Server Action without `router.refresh()` → Task 7 Step 3 + Task 8 no-refetch test. ✓
- Testing across dates/gantt/color/component → Tasks 2,3,4,5,6,8. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `resolveTimelineSpan` signature identical in Tasks 2/3. `onBarMoved`/`onBarResized` take `(…, startColumnId, endColumnId, setCell)` in Tasks 4 and 7 (the `Parameters<…>[5]` index matches the 6th arg). `colorForItem(itemId, colorColumn, cellValues)` identical in Tasks 5/7. `defaultTimelineColumns` identical in Tasks 6/7. `BarDragData` carries `startColumnId`/`endColumnId` consumed by `handleDragEnd`. ✓

**Known edge (accepted):** dragging a one-date dot in two-column mode writes the shifted date to _both_ columns (populating the previously-empty end column with the same date → still a dot). Acceptable; noted for reviewers.
