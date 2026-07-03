# Summary Row (per-group configurable aggregation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-group summary rows in the board Table view, driven by the existing
user-assignable `columns.settings.summary_aggregation`, plus making the collapsed-group strip
honor that choice.

**Architecture:** Extract the existing board-footer row (`SummaryFooter` in `BoardTable.tsx`)
into a reusable `SummaryRow` component with a `board` | `group` variant; render one per
expanded group (only when ≥1 column has an assigned aggregation) and swap it in for the
hardcoded `GroupRollupRow` when a group is collapsed and a summary is assigned. All
computation stays pure client-side over the hydrated board cache; persistence reuses the
existing `updateColumnSettings` Server Action. **Settings-only feature: NO migration, no new
Server Action, no Zod/schema change, no DB work at all.**

**Tech Stack:** Next.js 16 (client component leaf), React, Tailwind v4 semantic tokens,
shadcn `DropdownMenu` (via existing `FooterCell`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-03-summary-row-design.md` (read it first — the gap
analysis explains why the delta is this small).

## Global Constraints

- **No migration.** The only persisted field, `columns.settings.summary_aggregation`
  (jsonb), already exists with Zod schema + Server Action + optimistic path. If you think
  you need DDL, stop — you've misread the design.
- **0 new server round-trips** on first paint and on every in-page interaction except an
  explicit aggregation pick (which is the existing `updateColumnSettings` mutation).
- **Bounded computation:** aggregate only over items already in the board cache; never add a
  fetch.
- **pulse-ui tokens only:** `bg-surface-muted`, `text-muted-foreground`, `border`, etc. —
  no raw Tailwind colors. Reuse `FooterCell`/`FooterValue` untouched.
- **Do not modify:** `src/lib/boards/aggregation.ts`, `src/lib/validations/boards.ts`,
  `src/components/boards/FooterCell.tsx`, any Server Action.
- Commits: lowercase conventional subject after `type(scope):`, descriptive body, trailer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`, stage **by path** only.
- Gates before finishing: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

### Task 1: Extract `SummaryRow` from `SummaryFooter` (pure refactor + variants)

**Files:**

- Create: `src/components/boards/SummaryRow.tsx`
- Create: `src/components/boards/SummaryRow.test.tsx`
- Modify: `src/components/boards/BoardTable.tsx` (delete the private `SummaryFooter`
  component ~lines 316–390 and the `footerColumnMeta`/`footerColumnValues`/
  `mirrorFooterValues`-consuming helpers ~lines 264–314; replace the render call ~lines
  734–746; keep `setColumnSummary` ~lines 553–560 where it is)

**Interfaces:**

- Consumes (all existing):
  - `aggregate`, `allowedAggregations` from `@/lib/boards/aggregation`
  - `FooterCell` from `@/components/boards/FooterCell`
  - `mirrorTargetColumnFor`, `mirrorFooterValues` from `@/lib/boards/mirror`
  - `cellKey`, `timeEntriesForCell` from `@/lib/boards/cache`; `trackedSeconds` from
    `@/lib/boards/time-format`
  - types `Column` from `@/lib/boards/queries`, `BoardCache`, `CacheCellValue` from
    `@/lib/boards/cache`, `AggregationId`, `ColumnKind`, `ColumnOption` from
    `@/lib/validations/boards`
  - `NAME_FREEZE_EDGE` — currently defined in/imported by `BoardTable.tsx`; export it from
    its home module (check where it lives; if it is a local const in `BoardTable.tsx`, move
    it to `SummaryRow.tsx`'s import source or export it from `BoardTable`'s helper module —
    do NOT duplicate the string)
- Produces (Tasks 2 and 3 rely on these exact names):

  ```ts
  // src/components/boards/SummaryRow.tsx
  export function hasAssignedSummary(columns: readonly Column[]): boolean;

  export type SummaryRowProps = {
    variant: "board" | "group";
    /** Frozen Name-track label. Default "Summary". */
    label?: string;
    /** Group color for the 3px inset bar (group variant only). */
    groupColor?: string;
    /** data-testid for the row root. */
    testId: string;
    columns: Column[];
    itemIds: string[];
    cellMap: Map<string, CacheCellValue["value"]>;
    cache: BoardCache;
    template: string;
    nameWidth: number;
    canEdit: boolean;
    nowMs: number;
    onChange: (col: Column, agg: AggregationId | null) => void;
  };
  export function SummaryRow(props: SummaryRowProps): React.JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

`src/components/boards/SummaryRow.test.tsx` — build minimal fixtures by hand (a `BoardCache`
literal with 2 numbers-kind columns, 3 items, cell values), mirroring the fixture style
already used in `src/components/boards/BoardTable.test.tsx` / `FooterCell.test.tsx` (open
them and reuse their cache/cellMap builders if exported; otherwise inline literals).
Convention in the snippets below: `…` in a JSX props position means "the exact same props as
the first test", with only the listed overrides changed — spell them all out in the real file:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SummaryRow, hasAssignedSummary } from "@/components/boards/SummaryRow";

// fixtures: two "numbers" columns; colA has summary_aggregation: "sum", colB none.
// items i1..i3 with colA values 1, 2, 3 (i3 empty) → sum = 3.
// (Assemble columns/cache/cellMap exactly like BoardTable.test.tsx does — same shapes.)

describe("hasAssignedSummary", () => {
  it("is true only when some column carries summary_aggregation", () => {
    expect(hasAssignedSummary([colA, colB])).toBe(true);
    expect(hasAssignedSummary([colB])).toBe(false);
  });
});

describe("SummaryRow", () => {
  it("renders the assigned aggregate over exactly the given itemIds", () => {
    render(<SummaryRow variant="group" testId="group-summary-g1" label="Summary"
      columns={[colA, colB]} itemIds={["i1", "i2"]} cellMap={cellMap} cache={cache}
      template={template} nameWidth={200} canEdit nowMs={0} onChange={vi.fn()} />);
    // group-scoped: only i1 + i2 → 3, not the board-wide total
    expect(screen.getByTestId("group-summary-g1")).toHaveTextContent("Sum");
    expect(screen.getByTestId("group-summary-g1")).toHaveTextContent("3");
  });

  it("group variant paints the group color bar on the frozen name track", () => {
    render(<SummaryRow variant="group" testId="group-summary-g1" groupColor="#f00" … />);
    // name track carries the inset box-shadow like GroupHeaderRow/GroupRollupRow
    const nameTrack = screen.getByText("Summary");
    expect(nameTrack).toHaveStyle({ boxShadow: "inset 3px 0 0 0 #f00" });
  });

  it("editors can pick an aggregation; onChange fires with the column + choice", async () => {
    const onChange = vi.fn();
    render(<SummaryRow … canEdit onChange={onChange} />);
    await userEvent.click(screen.getAllByText("Summary")[1]); // colB's unset affordance
    await userEvent.click(await screen.findByText("Average"));
    expect(onChange).toHaveBeenCalledWith(colB, "avg");
  });

  it("viewers get read-only cells (no dropdown trigger)", () => {
    render(<SummaryRow … canEdit={false} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
```

Also add one currency case: a `currency` column with
`settings: { currency: "AED", summary_aggregation: "sum" }` renders the dirham-formatted
total (assert on the `CurrencyAmount` output text the same way `FooterCell.test.tsx` does).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/boards/SummaryRow.test.tsx`
Expected: FAIL — `Cannot find module '@/components/boards/SummaryRow'`

- [ ] **Step 3: Create `SummaryRow.tsx` by moving code, then add variants**

Move — do not rewrite — from `BoardTable.tsx` into `src/components/boards/SummaryRow.tsx`:
`footerColumnMeta` (lines ~264–292), `footerColumnValues` (~294–314), and the body of
`SummaryFooter` (~316–390). Then adapt:

```tsx
"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { allowedAggregations } from "@/lib/boards/aggregation";
import { FooterCell } from "@/components/boards/FooterCell";
import { mirrorTargetColumnFor, mirrorFooterValues } from "@/lib/boards/mirror";
import { cellKey, timeEntriesForCell } from "@/lib/boards/cache";
import { trackedSeconds } from "@/lib/boards/time-format";
import type { Column } from "@/lib/boards/queries";
import type { BoardCache, CacheCellValue } from "@/lib/boards/cache";
import type {
  AggregationId,
  ColumnKind,
  ColumnOption,
} from "@/lib/validations/boards";

/** True when at least one column has a user-assigned footer aggregation. */
export function hasAssignedSummary(columns: readonly Column[]): boolean {
  return columns.some(
    (c) =>
      (c.settings as { summary_aggregation?: AggregationId } | null)
        ?.summary_aggregation != null,
  );
}

// … footerColumnMeta + footerColumnValues moved here verbatim …

export type SummaryRowProps = {
  /* exactly as in Interfaces above */
};

export function SummaryRow({
  variant,
  label = "Summary",
  groupColor,
  testId,
  columns,
  itemIds,
  cellMap,
  cache,
  template,
  nameWidth,
  canEdit,
  nowMs,
  onChange,
}: SummaryRowProps) {
  // One memo for all per-column inputs so cell edits recompute cheaply.
  const perColumn = useMemo(
    () =>
      columns.map((col) => ({
        col,
        meta: footerColumnMeta(col, cache),
        values: footerColumnValues(col, itemIds, cellMap, cache, nowMs),
        current: (
          col.settings as { summary_aggregation?: AggregationId } | null
        )?.summary_aggregation,
      })),
    [columns, itemIds, cellMap, cache, nowMs],
  );

  return (
    <div
      data-testid={testId}
      className={cn(
        "bg-surface-muted grid border-t",
        variant === "board" && "sticky bottom-0 z-[15]",
        variant === "group" && "border-b",
      )}
      style={{ gridTemplateColumns: template }}
    >
      <div
        className={cn(
          "bg-surface-muted text-muted-foreground sticky left-0 z-10 flex items-center px-4 py-1.5 text-xs font-medium",
          NAME_FREEZE_EDGE,
        )}
        style={{
          width: nameWidth,
          ...(groupColor ? { boxShadow: `inset 3px 0 0 0 ${groupColor}` } : {}),
        }}
      >
        {label}
      </div>
      {perColumn.map(({ col, meta, values, current }) => (
        <div key={col.id} className="flex min-w-0 items-center border-l py-1.5">
          <FooterCell
            aggregateKind={meta.aggregateKind}
            values={values}
            options={meta.options}
            currency={meta.currency}
            dirhamSign={meta.dirhamSign}
            current={current}
            allowed={allowedAggregations(meta.aggregateKind)}
            canEdit={canEdit}
            onChange={(agg) => onChange(col, agg)}
          />
        </div>
      ))}
      {/* fillers: created-by / created-at / add-column tracks */}
      <div aria-hidden />
      <div aria-hidden />
      <div />
    </div>
  );
}
```

`NAME_FREEZE_EDGE`: it is a const in `BoardTable.tsx` today — export it from wherever the
frozen-name tokens live (grep `NAME_FREEZE_EDGE`; if local to `BoardTable.tsx`, export it
there and import in `SummaryRow.tsx`).

- [ ] **Step 4: Rewire `BoardTable.tsx`**

Delete the moved code and render the board footer via the new component (same spot,
~line 734):

```tsx
{
  columns.length > 0 && (
    <SummaryRow
      variant="board"
      testId="board-summary-footer"
      columns={columns}
      itemIds={topLevel.map((it) => it.id)}
      cellMap={cellMap}
      cache={cache}
      template={template}
      nameWidth={nameWidth}
      canEdit={canEdit}
      nowMs={footerNowMs}
      onChange={setColumnSummary}
    />
  );
}
```

Keep `data-testid="board-summary-footer"` identical so existing `BoardTable.test.tsx`
footer tests pass unchanged.

- [ ] **Step 5: Run the new test + existing regressions**

Run: `pnpm vitest run src/components/boards/SummaryRow.test.tsx src/components/boards/BoardTable.test.tsx src/components/boards/FooterCell.test.tsx`
Expected: PASS (board-footer behavior byte-identical; only its implementation moved)

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean (note: cold typecheck may hit the known `cacheLife` false failure — if so,
run `pnpm build` once first)

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/SummaryRow.tsx src/components/boards/SummaryRow.test.tsx src/components/boards/BoardTable.tsx
git commit -m "refactor(boards): extract reusable summaryrow from board footer"
```

(body: explain extraction is behavior-preserving and adds the group variant + trailer.)

---

### Task 2: Per-group summary rows (expanded groups)

**Files:**

- Modify: `src/components/boards/BoardTable.tsx` — `GroupSection` (props ~lines 1397–1441,
  render ~lines 1534–1651) and its call site (~lines 696–721)
- Test: `src/components/boards/BoardTable.test.tsx` (extend)

**Interfaces:**

- Consumes (from Task 1): `SummaryRow`, `hasAssignedSummary`, `SummaryRowProps` from
  `@/components/boards/SummaryRow`.
- Produces: a `summary` prop threaded into `GroupSection`:

  ```ts
  type GroupSummaryControls = {
    canEdit: boolean;
    nowMs: number;
    onChange: (col: Column, agg: AggregationId | null) => void;
  };
  // GroupSection gains: summary: GroupSummaryControls
  ```

  Task 3 reuses this same prop — do not rename it.

- [ ] **Step 1: Write the failing tests** (extend `BoardTable.test.tsx`, reusing its
      existing payload/render helpers)

```tsx
it("shows a summary row per group with group-scoped values once a column has an aggregation", () => {
  // payload: 2 groups; g1 items with numbers 1+2, g2 items with 3+4;
  // numbers column settings: { summary_aggregation: "sum" }
  renderBoardTable(payloadWithSummary);
  expect(screen.getByTestId("group-summary-g1")).toHaveTextContent("3");
  expect(screen.getByTestId("group-summary-g2")).toHaveTextContent("7");
  // board footer still totals everything
  expect(screen.getByTestId("board-summary-footer")).toHaveTextContent("10");
});

it("renders no group summary rows when no column has an aggregation", () => {
  renderBoardTable(payloadWithoutSummary);
  expect(screen.queryByTestId("group-summary-g1")).not.toBeInTheDocument();
  // board footer affordance unchanged
  expect(screen.getByTestId("board-summary-footer")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/boards/BoardTable.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="group-summary-g1"]`

- [ ] **Step 3: Implement**

In `BoardTable` (parent), build the controls once and pass to every `GroupSection`:

```tsx
const groupSummary = {
  canEdit,
  nowMs: footerNowMs,
  onChange: setColumnSummary,
};
// <GroupSection … summary={groupSummary} />
```

In `GroupSection`, add `summary: GroupSummaryControls` to props and render inside the
`!collapsed` branch, after the virtualized row area and **before** `<AddItemRow …>`:

```tsx
{!collapsed && (
  <>
    {items.length > 0 && ( /* existing DndContext row area unchanged */ )}
    {hasAssignedSummary(columns) && (
      <SummaryRow
        variant="group"
        testId={`group-summary-${group.id}`}
        groupColor={group.color}
        columns={columns}
        itemIds={items.map((i) => i.id)}
        cellMap={cellMap}
        cache={controls.cache}
        template={template}
        nameWidth={nameWidth}
        canEdit={summary.canEdit}
        nowMs={summary.nowMs}
        onChange={summary.onChange}
      />
    )}
    <AddItemRow groupId={group.id} controls={controls} nameWidth={nameWidth} />
  </>
)}
```

(`items` here are already the group's top-level items — `itemsByGroup` excludes subitems;
verify `group.color` is the field `GroupRollupRow` uses, line ~1376.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/boards/BoardTable.test.tsx src/components/boards/SummaryRow.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "feat(boards): per-group summary rows from assigned column aggregation"
```

(body: group-scoped subtotals, earn-the-row visibility rule, 0 round-trips + trailer.)

---

### Task 3: Collapsed groups honor the assigned aggregation

**Files:**

- Modify: `src/components/boards/BoardTable.tsx` — the `collapsed` branch of `GroupSection`
  (~lines 1566–1575)
- Test: `src/components/boards/BoardTable.test.tsx` (extend)

**Interfaces:**

- Consumes: `SummaryRow`, `hasAssignedSummary` (Task 1); the `summary` prop on
  `GroupSection` (Task 2).
- Produces: nothing new — behavior only.

- [ ] **Step 1: Write the failing tests**

```tsx
it("collapsed group shows the assigned summary instead of the legacy rollup", async () => {
  renderBoardTable(payloadWithSummary);
  await userEvent.click(collapseToggleFor("g1")); // reuse the file's existing collapse helper/selector
  expect(screen.getByTestId("group-summary-g1")).toHaveTextContent("3");
  expect(screen.queryByText("Average")).not.toBeInTheDocument(); // GroupRollupRow label
});

it("collapsed group without any assigned summary keeps the legacy rollup strip", async () => {
  renderBoardTable(payloadWithoutSummary);
  await userEvent.click(collapseToggleFor("g1"));
  expect(screen.getByText("Average")).toBeInTheDocument();
  expect(screen.queryByTestId("group-summary-g1")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/boards/BoardTable.test.tsx`
Expected: first new test FAILS (legacy "Average" rollup still shown)

- [ ] **Step 3: Implement the conditional**

```tsx
{
  collapsed &&
    items.length > 0 &&
    (hasAssignedSummary(columns) ? (
      <SummaryRow
        variant="group"
        testId={`group-summary-${group.id}`}
        groupColor={group.color}
        columns={columns}
        itemIds={items.map((i) => i.id)}
        cellMap={cellMap}
        cache={controls.cache}
        template={template}
        nameWidth={nameWidth}
        canEdit={summary.canEdit}
        nowMs={summary.nowMs}
        onChange={summary.onChange}
      />
    ) : (
      <GroupRollupRow
        group={group}
        items={items}
        columns={columns}
        cellMap={cellMap}
        cache={controls.cache}
        template={template}
      />
    ));
}
```

`GroupRollupRow` stays untouched (byte-for-byte fallback per spec D5).

- [ ] **Step 4: Run the full board suite**

Run: `pnpm vitest run src/components/boards`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "feat(boards): collapsed groups honor assigned summary aggregation"
```

(body: assigned aggregation replaces hardcoded rollup; legacy strip preserved as fallback +
trailer.)

---

### Task 4: Full gates + finish

**Files:** none new.

**Interfaces:**

- Consumes: everything above merged on `task/summary-row`.
- Produces: the merged feature on `develop`.

- [ ] **Step 1: Run all gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green (known flakes: integration suite auth rate-limit — rerun if hit; cold
`typecheck` `cacheLife` needs a prior `build`).

- [ ] **Step 2: Finish the task**

Run `scripts/finish-task.sh` from inside the worktree (rebases onto latest `develop`,
re-gates, merges, cleans up). If the rebase pulls in a new dependency, `pnpm install` and
re-run.

- [ ] **Step 3: "How to test this" walkthrough** — include in the closing message + wrapup:

1. Pull `develop`, `pnpm dev`, open any board with ≥2 groups in Table view.
2. In the sticky bottom footer, click a numbers/currency column's cell → pick **Sum**.
3. Expected: each group now shows its own summary row at its bottom with the group subtotal
   (currency columns formatted, AED with dirham sign); the bottom footer shows the board
   total.
4. Edit a cell value in one group → that group's subtotal and the board footer update
   instantly (no reload).
5. Collapse a group → the collapsed strip shows your chosen summary (not the old "Average"
   rollup). Clear the aggregation (pick **None**) on every column → group rows disappear;
   collapsed groups fall back to the legacy rollup strip.
6. Open the board as a viewer-role user → values visible, no pickers.

## Execution DAG (working agreement #6)

- **Dependency graph:**
  - Task 1 → Task 2 (needs `SummaryRow`, `hasAssignedSummary`)
  - Task 1 → Task 3 (same imports); Task 3 also reuses Task 2's `summary` prop threading
  - Task 4 depends on Tasks 1–3
- **Parallel batches:**
  - Batch 1: Task 1 (solo — the extraction is the foundation)
  - Batch 2: Task 2, then Task 3. Logically independent consumers of Task 1, **but both
    edit the same `GroupSection` region of `BoardTable.tsx`** — run them sequentially in
    one session/agent rather than parallel worktrees (parallelizing two edits to the same
    ~80-line region buys nothing and guarantees a conflict). Task 3 goes second because it
    reuses Task 2's prop threading.
  - Batch 3: Task 4 (gates + finish).
- **Critical path:** Task 1 → Task 2 → Task 3 → Task 4 (= the whole plan; wall-clock floor
  is the sequential chain — this is a small, single-file-centric feature).

## Migration note

**No migration needed** — settings-only (jsonb `summary_aggregation` already exists,
already validated, already written by the existing `updateColumnSettings` Server Action).
No manual-apply gate applies to this plan.
