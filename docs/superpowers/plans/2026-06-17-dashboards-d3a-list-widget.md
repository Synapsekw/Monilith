# Dashboards D3a — List Widget (rows + columns) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the **List** widget — a bounded list of a source board's items (latest N) showing the item name plus a few chosen columns, with Status rendered as a colored pill. No filtering yet (D3b adds the multi-condition filter).

**Architecture:** A new bounded Server Action `getWidgetRows` reads the widget's config (`columnIds`, `limit`), fetches the most recent `limit` items from `source_board_id` (indexed `board_id`, `LIMIT`), their `cell_values` for the chosen columns, and the column defs (kind + options). A pure `formatCell` helper turns each jsonb cell value into a display `{text, color?}` by kind. The `ListWidget` renders a compact table; the add-widget dialog gains a List option (pick columns + limit). **No DB/RPC change** — all reads are RLS-scoped plain selects.

**Tech Stack:** Next.js 16, React 19, Supabase (RLS-scoped selects), TanStack Query, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-17-dashboards-cross-board-design.md` (§3.2 list config, §5 D3). **Scope (2026-06-17):** D3 is split — **D3a = list + columns, NO filter** (this plan); **D3b = multi-condition filter** (next plan). Rows display item name + chosen columns; ordered latest-first.

---

## File structure

**Create:**

- `src/lib/dashboards/list-rows.ts` — pure `formatCell()` + `CellDisplay`/`DisplayColumn` types.
- `src/lib/dashboards/list-rows.test.ts` — unit tests.
- `src/lib/dashboards/use-widget-rows.ts` — TanStack hook calling `getWidgetRows`.
- `src/components/dashboards/widgets/ListWidget.tsx` — the list/table body.

**Modify:**

- `src/lib/validations/dashboards.ts` — add `listConfigSchema`; route `list` in `configSchemaForKind`.
- `src/lib/dashboards/actions.ts` — add `getWidgetRows` Server Action.
- `src/components/dashboards/DashboardWidget.tsx` — dispatch `list` case.
- `src/components/dashboards/AddWidgetDialog.tsx` — List option + column multi-select + limit; `BoardOption` gains `allColumns`.
- `src/app/dashboards/[dashboardId]/page.tsx` — load all columns per board (derive numbers/status/all from one query).
- `e2e/dashboards.spec.ts` — add a List-widget flow.

---

## Task 1: List config schema

**Files:**

- Modify: `src/lib/validations/dashboards.ts`
- Test: `src/lib/validations/dashboards.test.ts` (extend)

- [ ] **Step 1: Write the failing test (append)**

Add to `src/lib/validations/dashboards.test.ts`:

```ts
import { listConfigSchema } from "./dashboards";

describe("listConfigSchema", () => {
  const col = "11111111-1111-4111-8111-111111111111";
  it("defaults limit to 25 and accepts an empty column list", () => {
    const r = listConfigSchema.safeParse({ columnIds: [] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(25);
  });
  it("accepts columnIds + a bounded limit", () => {
    expect(
      listConfigSchema.safeParse({ columnIds: [col], limit: 50 }).success,
    ).toBe(true);
  });
  it("rejects a limit over 100 or under 1", () => {
    expect(
      listConfigSchema.safeParse({ columnIds: [], limit: 0 }).success,
    ).toBe(false);
    expect(
      listConfigSchema.safeParse({ columnIds: [], limit: 200 }).success,
    ).toBe(false);
  });
  it("rejects more than 8 columns", () => {
    expect(
      listConfigSchema.safeParse({ columnIds: Array(9).fill(col) }).success,
    ).toBe(false);
  });
});

describe("configSchemaForKind (list)", () => {
  it("routes list to listConfigSchema", () => {
    expect(
      configSchemaForKind("list").safeParse({ columnIds: [] }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/validations/dashboards.test.ts`
Expected: FAIL — `listConfigSchema` not exported; `list` still hits the permissive default.

- [ ] **Step 3: Implement**

In `src/lib/validations/dashboards.ts`, add after `batteryConfigSchema`/`BatteryConfig`:

```ts
export const listConfigSchema = z.object({
  columnIds: z.array(uuid).max(8).default([]),
  limit: z.number().int().min(1).max(100).default(25),
});
export type ListConfig = z.infer<typeof listConfigSchema>;
```

Route `list` in `configSchemaForKind`:

```ts
    case "battery":
      return batteryConfigSchema;
    case "list":
      return listConfigSchema;
    default:
      return configObject;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/validations/dashboards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/dashboards.ts src/lib/validations/dashboards.test.ts
git commit -m "feat(dashboards): list widget config schema (D3a)"
```

---

## Task 2: `formatCell` pure helper

**Files:**

- Create: `src/lib/dashboards/list-rows.ts`
- Test: `src/lib/dashboards/list-rows.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/dashboards/list-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatCell, type DisplayColumn } from "./list-rows";

const status: DisplayColumn = {
  id: "c1",
  name: "Status",
  kind: "status",
  options: [{ id: "o1", label: "Done", color: "#00c875" }],
};
const text: DisplayColumn = {
  id: "c2",
  name: "Note",
  kind: "text",
  options: [],
};
const num: DisplayColumn = {
  id: "c3",
  name: "Pts",
  kind: "numbers",
  options: [],
};
const people: DisplayColumn = {
  id: "c4",
  name: "Who",
  kind: "people",
  options: [],
};

describe("formatCell", () => {
  it("status → label + color", () => {
    expect(formatCell(status, { optionId: "o1" })).toEqual({
      text: "Done",
      color: "#00c875",
    });
  });
  it("status with unknown/empty → dash, no color", () => {
    expect(formatCell(status, { optionId: null })).toEqual({ text: "—" });
    expect(formatCell(status, null)).toEqual({ text: "—" });
  });
  it("text → its string", () => {
    expect(formatCell(text, { text: "hi" })).toEqual({ text: "hi" });
    expect(formatCell(text, {})).toEqual({ text: "—" });
  });
  it("numbers → stringified n", () => {
    expect(formatCell(num, { n: 5 })).toEqual({ text: "5" });
  });
  it("people → assignee count", () => {
    expect(formatCell(people, { userIds: ["a", "b"] })).toEqual({ text: "2" });
    expect(formatCell(people, { userIds: [] })).toEqual({ text: "—" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/dashboards/list-rows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/dashboards/list-rows.ts`:

```ts
import type { ColumnOption } from "@/lib/dashboards/widget-data";

/** A displayed column in a List widget: id/name/kind + (for status/dropdown) options. */
export type DisplayColumn = {
  id: string;
  name: string;
  kind: string;
  options: ColumnOption[];
};

/** A rendered cell: text plus an optional pill color (status). */
export type CellDisplay = { text: string; color?: string };

const EMPTY: CellDisplay = { text: "—" };

/** Turn a jsonb cell value into a display by column kind. Missing/empty → "—". */
export function formatCell(column: DisplayColumn, value: unknown): CellDisplay {
  const v = (value ?? {}) as Record<string, unknown>;
  switch (column.kind) {
    case "text":
      return typeof v.text === "string" && v.text ? { text: v.text } : EMPTY;
    case "numbers":
      return typeof v.n === "number" ? { text: String(v.n) } : EMPTY;
    case "date":
      return typeof v.date === "string" && v.date ? { text: v.date } : EMPTY;
    case "status": {
      const opt = column.options.find((o) => o.id === v.optionId);
      return opt ? { text: opt.label, color: opt.color } : EMPTY;
    }
    case "dropdown": {
      const ids = Array.isArray(v.optionIds) ? (v.optionIds as string[]) : [];
      const labels = ids
        .map((id) => column.options.find((o) => o.id === id)?.label)
        .filter((l): l is string => Boolean(l));
      return labels.length ? { text: labels.join(", ") } : EMPTY;
    }
    case "people": {
      const ids = Array.isArray(v.userIds) ? (v.userIds as string[]) : [];
      return ids.length ? { text: String(ids.length) } : EMPTY;
    }
    default:
      return EMPTY;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/dashboards/list-rows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/list-rows.ts src/lib/dashboards/list-rows.test.ts
git commit -m "feat(dashboards): formatCell helper for list rows (D3a)"
```

---

## Task 3: `getWidgetRows` Server Action + hook

**Files:**

- Modify: `src/lib/dashboards/actions.ts`
- Create: `src/lib/dashboards/use-widget-rows.ts`

- [ ] **Step 1: Add `getWidgetRows` to `actions.ts`**

Reuse the existing `getWidgetDataSchema` (`{ widgetId }`) and the `optionSchema` import added in D2. Add this Server Action (append after `getWidgetData`):

```ts
import type { DisplayColumn } from "@/lib/dashboards/list-rows";

/**
 * Bounded row fetch for a List widget: the most recent `limit` items of the
 * source board + their cell values for the chosen columns. RLS-scoped plain
 * selects (board_id indexed; LIMIT bounds the read). No grouping.
 */
export async function getWidgetRows(input: { widgetId: string }): Promise<
  ActionResult<{
    columns: DisplayColumn[];
    rows: { itemId: string; name: string; cells: Record<string, unknown> }[];
  }>
> {
  const parsed = getWidgetDataSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: widget } = await supabase
    .from("dashboard_widgets")
    .select("config, source_board_id")
    .eq("id", parsed.data.widgetId)
    .maybeSingle();
  if (!widget) return fail("Widget not found.");
  if (!widget.source_board_id)
    return { ok: true, data: { columns: [], rows: [] } };

  const config = (widget.config ?? {}) as {
    columnIds?: string[];
    limit?: number;
  };
  const columnIds = Array.isArray(config.columnIds) ? config.columnIds : [];
  const limit = Math.min(Math.max(config.limit ?? 25, 1), 100);

  const { data: items } = await supabase
    .from("items")
    .select("id, name")
    .eq("board_id", widget.source_board_id)
    .order("created_at", { ascending: false })
    .limit(limit);
  const itemIds = (items ?? []).map((i) => i.id);

  let columns: DisplayColumn[] = [];
  const cellMap = new Map<string, unknown>(); // `${itemId}:${columnId}` → value
  if (columnIds.length > 0) {
    const { data: cols } = await supabase
      .from("columns")
      .select("id, name, kind, settings")
      .in("id", columnIds);
    columns = (cols ?? [])
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        options:
          optionSchema
            .array()
            .safeParse((c.settings as { options?: unknown }).options ?? [])
            .data ?? [],
      }))
      // preserve the config's column order
      .sort((a, b) => columnIds.indexOf(a.id) - columnIds.indexOf(b.id));

    if (itemIds.length > 0) {
      const { data: cells } = await supabase
        .from("cell_values")
        .select("item_id, column_id, value")
        .eq("board_id", widget.source_board_id)
        .in("item_id", itemIds)
        .in("column_id", columnIds);
      for (const cell of cells ?? [])
        cellMap.set(`${cell.item_id}:${cell.column_id}`, cell.value);
    }
  }

  const rows = (items ?? []).map((it) => ({
    itemId: it.id,
    name: it.name,
    cells: Object.fromEntries(
      columnIds.map((cid) => [cid, cellMap.get(`${it.id}:${cid}`) ?? null]),
    ),
  }));

  return { ok: true, data: { columns, rows } };
}
```

- [ ] **Step 2: Create the hook `use-widget-rows.ts`**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetRows } from "@/lib/dashboards/actions";
import { configHash } from "@/lib/dashboards/widget-data";
import type { DisplayColumn } from "@/lib/dashboards/list-rows";

export type WidgetRows = {
  columns: DisplayColumn[];
  rows: { itemId: string; name: string; cells: Record<string, unknown> }[];
};

/** Fetch a List widget's bounded rows. Keyed by widget id + config hash. */
export function useWidgetRows(
  widgetId: string,
  config: Record<string, unknown>,
) {
  return useQuery({
    queryKey: ["dashboard-widget-rows", widgetId, configHash(config)],
    queryFn: async (): Promise<WidgetRows> => {
      const res = await getWidgetRows({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/dashboards/actions.ts src/lib/dashboards/use-widget-rows.ts
git commit -m "feat(dashboards): getWidgetRows bounded row fetch + hook (D3a)"
```

---

## Task 4: `ListWidget` body + dispatch

**Files:**

- Create: `src/components/dashboards/widgets/ListWidget.tsx`
- Modify: `src/components/dashboards/DashboardWidget.tsx`

**MANDATORY:** invoke `pulse-ui` + `frontend-design` before writing the component. Status pills use the option's own color (data color). Chrome/empty/loading use semantic tokens.

- [ ] **Step 1: Create `ListWidget.tsx`**

```tsx
"use client";

import { useWidgetRows } from "@/lib/dashboards/use-widget-rows";
import { formatCell } from "@/lib/dashboards/list-rows";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function ListWidget({ widget }: { widget: CacheWidget }) {
  const { data, isLoading, isError } = useWidgetRows(
    widget.id,
    widget.config as Record<string, unknown>,
  );

  if (!widget.source_board_id)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Pick a source board
      </div>
    );
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data)
    return <div className="text-destructive text-sm">Failed to load</div>;
  if (data.rows.length === 0)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No items
      </div>
    );

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground bg-card sticky top-0 text-left text-xs">
          <tr>
            <th className="px-2 py-1 font-medium">Item</th>
            {data.columns.map((c) => (
              <th key={c.id} className="px-2 py-1 font-medium">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.itemId} className="border-t">
              <td className="truncate px-2 py-1">{row.name}</td>
              {data.columns.map((c) => {
                const cell = formatCell(c, row.cells[c.id]);
                return (
                  <td key={c.id} className="px-2 py-1">
                    {cell.color ? (
                      <span
                        className="inline-block rounded px-1.5 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: cell.color }}
                      >
                        {cell.text}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{cell.text}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Dispatch `list` in `DashboardWidget.tsx`**

Add the import:

```tsx
import { ListWidget } from "@/components/dashboards/widgets/ListWidget";
```

Add a `list` branch in the body dispatch (after the `battery` branch, before the fallback):

```tsx
        ) : widget.kind === "battery" ? (
          <BatteryWidget widget={widget} />
        ) : widget.kind === "list" ? (
          <ListWidget widget={widget} />
        ) : (
          <div className="text-muted-foreground text-sm">
            {widget.kind} widget — coming soon
          </div>
        )}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboards/widgets/ListWidget.tsx src/components/dashboards/DashboardWidget.tsx
git commit -m "feat(dashboards): list widget body + dispatch (D3a)"
```

---

## Task 5: Add-widget dialog List option + all-columns loader

**Files:**

- Modify: `src/components/dashboards/AddWidgetDialog.tsx`
- Modify: `src/app/dashboards/[dashboardId]/page.tsx`

**MANDATORY:** invoke `pulse-ui` + `frontend-design`.

- [ ] **Step 1: Load all columns per board in the page**

In `src/app/dashboards/[dashboardId]/page.tsx`, replace the two separate `numbers`/`status` column queries with a single all-columns query, and derive the three lists. Replace the `numberCols`/`statusCols` queries + the `boards` map with:

```tsx
const { data: allCols } = await supabase
  .from("columns")
  .select("id, name, kind, board_id")
  .in("board_id", boardIds)
  .order("position", { ascending: true });

const boards: BoardOption[] = (boardRows ?? []).map((b) => {
  const cols = (allCols ?? []).filter((c) => c.board_id === b.id);
  return {
    id: b.id,
    name: b.name,
    numbersColumns: cols
      .filter((c) => c.kind === "numbers")
      .map((c) => ({ id: c.id, name: c.name })),
    statusColumns: cols
      .filter((c) => c.kind === "status")
      .map((c) => ({ id: c.id, name: c.name })),
    allColumns: cols.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
  };
});
```

- [ ] **Step 2: Extend `AddWidgetDialog.tsx`**

Add `allColumns` to `BoardOption`, add `"list"` to the `Kind` union and the type `<select>`, and render List config (a column multi-select + a limit input). Make these edits:

(a) `BoardOption` type:

```tsx
export type BoardOption = {
  id: string;
  name: string;
  numbersColumns: { id: string; name: string }[];
  statusColumns: { id: string; name: string }[];
  allColumns: { id: string; name: string; kind: string }[];
};
```

(b) `Kind`:

```tsx
type Kind = "number" | "chart" | "battery" | "list";
```

(c) New state (with the other `useState`s):

```tsx
const [columnIds, setColumnIds] = useState<string[]>([]);
const [limit, setLimit] = useState(25);
```

(d) Reset them in `reset()`:

```tsx
function reset() {
  setTitle("");
  setAgg("count");
  setValueColumnId("");
  setGroupColumnId("");
  setChartStyle("bar");
  setColumnIds([]);
  setLimit(25);
  setKind("number");
}
```

(e) Reset `columnIds` on board change too (add to the board `<select>` onChange, alongside the existing resets):

```tsx
setGroupColumnId("");
setValueColumnId("");
setColumnIds([]);
```

(f) In `submit()`, handle the `list` kind before the existing chart/battery branch:

```tsx
let config: Record<string, unknown>;
if (kind === "number") {
  if (agg !== "count" && !valueColumnId)
    return setError("Pick a numbers column for sum/average.");
  config = agg === "count" ? { agg } : { agg, valueColumnId };
} else if (kind === "list") {
  config = { columnIds, limit };
} else {
  if (!groupColumnId) return setError("Pick a status column to group by.");
  config = kind === "chart" ? { groupColumnId, chartStyle } : { groupColumnId };
}
```

(g) Add `<option value="list">List</option>` to the widget-type `<select>`, and render the List config block (place it as a sibling of the number/grouping blocks — e.g. after the number block, gated on `kind === "list"`):

```tsx
{
  kind === "list" ? (
    <>
      <fieldset className="text-sm">
        <legend className="mb-1">Columns to show</legend>
        <div className="flex flex-col gap-1 rounded-md border p-2">
          {(board?.allColumns ?? []).length === 0 ? (
            <span className="text-muted-foreground text-xs">
              This board has no columns.
            </span>
          ) : (
            board?.allColumns.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={columnIds.includes(c.id)}
                  onChange={(e) =>
                    setColumnIds((prev) =>
                      e.target.checked
                        ? [...prev, c.id]
                        : prev.filter((id) => id !== c.id),
                    )
                  }
                />
                {c.name}
              </label>
            ))
          )}
        </div>
      </fieldset>
      <label className="text-sm">
        Max rows
        <Input
          type="number"
          min={1}
          max={100}
          className="mt-1"
          value={limit}
          onChange={(e) =>
            setLimit(Math.min(Math.max(Number(e.target.value) || 1, 1), 100))
          }
        />
      </label>
    </>
  ) : null;
}
```

> Note: the number block and grouping block are currently rendered with `kind === "number" ? (...) : (...)`. Restructure that conditional so `number`, `list`, and chart/battery are three explicit branches (e.g. `kind === "number" ? <numberBlock> : kind === "list" ? <listBlock> : <groupBlock>`), keeping each block intact. Confirm against the implemented file while editing.

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS (the `BoardOption.allColumns` addition flows through `DashboardCanvas` + the page).

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboards/AddWidgetDialog.tsx "src/app/dashboards/[dashboardId]/page.tsx"
git commit -m "feat(dashboards): add-widget dialog supports list (columns + limit) (D3a)"
```

---

## Task 6: e2e — add a List widget

**Files:**

- Modify: `e2e/dashboards.spec.ts`

- [ ] **Step 1: Add a List-widget test**

Append a test that reuses the existing fixtures (the seeded board has a Status column + at least one item). It creates a dashboard, enters Edit, adds a **List** widget with the Status column checked, and asserts the item row + its rendered cell appear. Because the list renders an HTML `<table>`, assert on a table cell:

```ts
test("add a List widget shows item rows with the chosen column", async ({
  page,
}) => {
  // reuse the same sign-in + board-with-item setup as the other tests
  // ...
  await page.goto("/dashboards");
  await page.getByRole("button", { name: /new dashboard/i }).click();
  await page.getByLabel(/name/i).fill("List Dash");
  await page.getByRole("button", { name: /create/i }).click();
  await expect(page).toHaveURL(/\/dashboards\/[0-9a-f-]+/);

  await page.getByRole("button", { name: /^edit$/i }).click();
  await page.getByRole("button", { name: /add widget/i }).click();

  // Widget type → List
  await page
    .locator("label", { hasText: "Widget type" })
    .locator("select")
    .selectOption("list");
  // check the first column to show (the seeded Status column)
  await page.getByRole("checkbox").first().check();
  await page
    .getByRole("button", { name: /add widget/i })
    .last()
    .click();

  // the list renders a table header + at least one row
  await expect(page.locator("table thead").getByText("Item")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator("table tbody tr").first()).toBeVisible();
});
```

> Note: confirm selectors against the implemented dialog (the "Widget type" select is the first select; the column checkboxes are the `Columns to show` fieldset). The binding intent: a List widget renders a table of item rows with the chosen column.

- [ ] **Step 2: Run e2e**

Run: `pnpm e2e e2e/dashboards.spec.ts`
Expected: PASS (all existing tests + the new List test).

- [ ] **Step 3: Commit**

```bash
git add e2e/dashboards.spec.ts
git commit -m "test(dashboards): e2e add list widget with a column (D3a)"
```

---

## Task 7: Full gate + final review + push

- [ ] **Step 1: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS (unit + live integration green; build clean).

- [ ] **Step 2: Final code review**

Use `superpowers:requesting-code-review` on the D3a diff. Priorities: `getWidgetRows` reads are RLS-scoped (items/cell_values/columns all org-gated; the widget's `source_board_id` is the only board touched) and **bounded** (LIMIT items; cells/columns `.in(...)` the chosen ids — no unbounded scan); `formatCell` correctness across kinds; the add-widget dialog resets list state on board/kind change; no `any`/`@ts-ignore`; the 0-refetch-on-drag budget still holds (list rows keyed by `["dashboard-widget-rows", id, configHash]`, untouched by layout). Address findings.

- [ ] **Step 3: Push**

```bash
git push origin develop
```

---

## Notes for the implementer

- **No DB/RPC change** in D3a. If you reach for a migration, stop — the row fetch is plain RLS-scoped selects.
- **Bounded + indexed (rule 5):** items use `LIMIT` over indexed `board_id`; cells/columns use `.in(...)` over the chosen ids. Never select all cells of a board.
- **0-refetch budget:** list rows are keyed `["dashboard-widget-rows", id, configHash(config)]`; layout drags only touch `["dashboard", id]`. Unchanged.
- **People rendering** shows assignee count in D3a (no name/avatar resolution) — keep it that way; richer People display is out of scope.
- **Status colors are data colors** (option hex), as in D2 — not a palette violation. Chrome/empty/loading use semantic tokens.
- **Deferred to D3b:** the multi-condition AND/OR filter (server-side EAV translation + filter-builder UI). D3a ships latest-N, unfiltered.

```

```
