# Subitem-aware summaries + group/master rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board table's column-summary footer aggregate subitem data (not just top-level rows), so a percent column whose values live on subitems shows a real average, and give each group a labeled "Group Summary" row plus one master "Total" footer.

**Architecture:** The pure `aggregate()` math and `footerColumnValues()` already operate over a flat list of item IDs. Add one pure helper `withSubitems(itemIds, childrenByParent)` that expands a top-level ID list to include all descendants, then feed the expanded list into the master footer (whole board) and each group's summary row (that group + its subitems). No change to aggregation math, no schema change, 0 new server round-trips.

**Tech Stack:** TypeScript (strict), React 19 / Next.js 16 RSC, Vitest + Testing Library.

## Global Constraints

- Server Components by default; this is all client-side compute over the already-loaded board cache — **0 new server round-trips** on any interaction.
- TypeScript strict; no `any` (test fixtures may use the existing `as never` cast pattern from `item-tree.test.ts`).
- Commit identity is pinned by `start-task.sh` to `Danijel Jovanovic <info@synapse-solutions.ai>`; do not override.
- Commit subjects lowercase after `type(scope):`; every commit gets a descriptive body + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- Stage explicitly by path (`git add <paths>`), never `git add -A`.
- Gates that must pass at the end: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

### Task 1: `withSubitems` pure helper

**Files:**

- Modify: `src/lib/boards/item-tree.ts` (add export beside `bucketItems`)
- Test: `src/lib/boards/item-tree.test.ts` (add a `describe` block)

**Interfaces:**

- Consumes: `bucketItems`' output type — `childrenByParent: Map<string, CacheItem[]>` (a `ReadonlyMap<string, readonly { id: string }[]>` at the call sites).
- Produces: `withSubitems(itemIds: readonly string[], childrenByParent: ReadonlyMap<string, readonly { id: string }[]>): string[]` — the input IDs plus all descendant IDs, depth-first (each parent immediately followed by its children), each ID at most once, cycle-safe.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/boards/item-tree.test.ts` (the `item()` factory and imports already exist at the top of that file):

```typescript
import { bucketItems, withSubitems } from "./item-tree";

describe("withSubitems", () => {
  it("appends each parent's subitems depth-first, in child order", () => {
    const { childrenByParent } = bucketItems([
      item("a", null, 1),
      item("b", null, 2),
      item("a1", "a", 1),
      item("a2", "a", 2),
    ]);
    expect(withSubitems(["a", "b"], childrenByParent)).toEqual([
      "a",
      "a1",
      "a2",
      "b",
    ]);
  });

  it("returns the ids unchanged when there are no subitems", () => {
    expect(withSubitems(["a", "b"], new Map())).toEqual(["a", "b"]);
  });

  it("emits every id at most once even if a child is also passed in", () => {
    const children = new Map([["a", [{ id: "a1" }]]]);
    expect(withSubitems(["a", "a1"], children)).toEqual(["a", "a1"]);
  });

  it("is cycle-safe against a malformed parent chain", () => {
    // a -> a1 -> a (bad data); must terminate and emit each id once.
    const children = new Map([
      ["a", [{ id: "a1" }]],
      ["a1", [{ id: "a" }]],
    ]);
    expect(withSubitems(["a"], children)).toEqual(["a", "a1"]);
  });

  it("returns an empty array for empty input", () => {
    expect(withSubitems([], new Map())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/lib/boards/item-tree.test.ts`
Expected: FAIL — `withSubitems is not a function` (import error / undefined).

- [ ] **Step 3: Implement `withSubitems`**

Append to `src/lib/boards/item-tree.ts`:

```typescript
/**
 * Expand a list of item ids to include all of their descendants, depth-first
 * (each parent immediately followed by its children, in child order). Each id
 * is emitted at most once, and a malformed `parent_id` cycle can never loop
 * (a `seen` set guards it). Pure — this is the single source of truth for
 * "which rows a column summary counts" (top-level rows + their subitems).
 */
export function withSubitems(
  itemIds: readonly string[],
  childrenByParent: ReadonlyMap<string, readonly { id: string }[]>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    const children = childrenByParent.get(id);
    if (children) for (const c of children) visit(c.id);
  };
  for (const id of itemIds) visit(id);
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- src/lib/boards/item-tree.test.ts`
Expected: PASS (both `bucketItems` and `withSubitems` describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/item-tree.ts src/lib/boards/item-tree.test.ts
git commit -F - <<'EOF'
feat(boards): add withSubitems id-expansion helper

Expand a top-level item-id list to include all descendants, depth-first
and cycle-safe. Single source of truth for which rows a column summary
counts, used next by the master and per-group summary rows.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Feed subitems into the master + group summaries; add labels

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`
  - Master footer render (`SummaryRow variant="board"`, ~`:780`)
  - Group collapsed summary render (`SummaryRow variant="group"`, ~`:1642`)
  - Group expanded summary render (`SummaryRow variant="group"`, ~`:1735`)

**Interfaces:**

- Consumes: `withSubitems` (Task 1). In the main component scope `topLevel` (CacheItem[]) and `childrenByParent` (`Map<string, CacheItem[]>`) are in scope from the `bucketItems` memo (~`:469`). Inside `GroupSection`, `items` (the group's top-level items) and `childrenByParent` are already props (~`:1474`, `:1499`).
- Produces: no new exported symbols; behavior change only. `SummaryRow` already accepts `label?: string` (default `"Summary"`) — this task passes `"Group Summary"` and `"Total"`.

- [ ] **Step 1: Import `withSubitems` in BoardTable**

In `src/components/boards/BoardTable.tsx`, add `withSubitems` to the existing `item-tree` import. Find the line importing `bucketItems`:

```typescript
import { bucketItems } from "@/lib/boards/item-tree";
```

Replace with:

```typescript
import { bucketItems, withSubitems } from "@/lib/boards/item-tree";
```

(If `bucketItems` is imported inline with others from that module, just add `withSubitems` to the same brace list.)

- [ ] **Step 2: Master footer — aggregate the whole board + label "Total"**

Find the master footer render (~`:780`):

```tsx
          {columns.length > 0 && (
            <SummaryRow
              variant="board"
              testId="board-summary-footer"
              columns={columns}
              itemIds={topLevel.map((it) => it.id)}
              cellMap={cellMap}
```

Change `itemIds` and add `label`:

```tsx
          {columns.length > 0 && (
            <SummaryRow
              variant="board"
              testId="board-summary-footer"
              label="Total"
              columns={columns}
              itemIds={withSubitems(
                topLevel.map((it) => it.id),
                childrenByParent,
              )}
              cellMap={cellMap}
```

(Leave the remaining props — `cache`, `template`, `nameWidth`, `canEdit`, `nowMs`, `onChange` — unchanged.)

- [ ] **Step 3: Group collapsed summary — subitems + "Group Summary" label**

Find the collapsed group summary render (~`:1642`, inside the `hasAssignedSummary(columns) ? (...)` branch):

```tsx
          <SummaryRow
            variant="group"
            testId={`group-summary-${group.id}`}
            groupColor={group.color}
            columns={columns}
            itemIds={items.map((i) => i.id)}
            cellMap={cellMap}
```

Change `itemIds` and add `label`:

```tsx
          <SummaryRow
            variant="group"
            testId={`group-summary-${group.id}`}
            label="Group Summary"
            groupColor={group.color}
            columns={columns}
            itemIds={withSubitems(
              items.map((i) => i.id),
              childrenByParent,
            )}
            cellMap={cellMap}
```

- [ ] **Step 4: Group expanded summary — subitems + "Group Summary" label**

Find the expanded group summary render (~`:1735`, inside `{hasAssignedSummary(columns) && (...)}`) — identical prop shape to Step 3. Apply the same two changes:

```tsx
            <SummaryRow
              variant="group"
              testId={`group-summary-${group.id}`}
              label="Group Summary"
              groupColor={group.color}
              columns={columns}
              itemIds={withSubitems(
                items.map((i) => i.id),
                childrenByParent,
              )}
              cellMap={cellMap}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors; `childrenByParent: Map<string, CacheItem[]>` satisfies the helper's `ReadonlyMap<string, readonly { id: string }[]>` parameter).

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/BoardTable.tsx
git commit -F - <<'EOF'
feat(boards): summaries count subitems; label group + master rows

Feed withSubitems-expanded id sets into the master footer (grand total
across all board items, labelled "Total") and each group's summary row
(that group's items + subitems, labelled "Group Summary"). Fixes a
percent column whose data lives on subitems aggregating to nothing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Behavioral tests over subitem data

**Files:**

- Modify: `src/components/boards/SummaryRow.test.tsx` (add cases)

**Interfaces:**

- Consumes: `SummaryRow` (unchanged API), `withSubitems` behavior via the ID list the component receives. Confirm the existing test harness/factory in `SummaryRow.test.tsx` before writing (mirror its `columns`/`cellMap`/`cache` fixture builders — do not invent new ones).

- [ ] **Step 1: Read the existing test to reuse its fixtures**

Run: `sed -n '1,80p' src/components/boards/SummaryRow.test.tsx` (or open it). Identify how it builds `columns`, `cellMap`, `cache`, and renders `SummaryRow`. Reuse those helpers verbatim in the new cases below (adapt names to the file's actual factories).

- [ ] **Step 2: Write the failing test — percent avg over subitem-only data**

Add a case that renders a `SummaryRow` for a `percent` column where the passed `itemIds` are subitem ids and `cellMap` holds their `{ percent }` values, asserting the footer shows the true average (e.g. values `100, 50, 0` → `50%`), not empty. Use the file's existing render helper; the shape below is illustrative — match the real fixtures:

```tsx
it("averages a percent column whose values live on the passed (subitem) rows", () => {
  const col = percentColumn("c1"); // reuse the file's column factory
  const itemIds = ["s1", "s2", "s3"];
  const cellMap = cellMapOf({
    "s1:c1": { percent: 100 },
    "s2:c1": { percent: 50 },
    "s3:c1": { percent: 0 },
  }); // reuse the file's cellMap builder + key format
  renderSummaryRow({
    columns: [col],
    itemIds,
    cellMap,
    current: { c1: "avg" },
  });
  expect(screen.getByText("50%")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify it fails (or passes trivially), then confirm labels**

Run: `pnpm test -- src/components/boards/SummaryRow.test.tsx`
Expected: the percent-avg case PASSES (SummaryRow already aggregates whatever `itemIds` it is given — this test locks the contract that Task 2 relies on). If it fails, the fixture key format or `current`/settings wiring is off — fix the fixture, not the component.

- [ ] **Step 4: Add a label assertion**

Add a case asserting the `label` prop renders (the frozen Name-track cell shows the label text):

```tsx
it("renders the provided summary label", () => {
  renderSummaryRow({
    label: "Group Summary",
    columns: [percentColumn("c1")],
    itemIds: [],
  });
  expect(screen.getByText("Group Summary")).toBeInTheDocument();
});
```

- [ ] **Step 5: Run the full SummaryRow suite**

Run: `pnpm test -- src/components/boards/SummaryRow.test.tsx`
Expected: PASS (new cases + all pre-existing cases).

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/SummaryRow.test.tsx
git commit -F - <<'EOF'
test(boards): summary averages subitem rows; renders label

Lock the contract Task 2 relies on: SummaryRow aggregates whatever id
set it receives (so subitem percent values average correctly) and
renders the group/master label.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Full gate + manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. (Note the known cold-typecheck `cacheLife` quirk resolves after `build` generates `.next/types`; run order above builds last.)

- [ ] **Step 2: Manual smoke (optional, if dev server available)**

Open a board whose percent column is filled on subitems, set the column summary to **Average**, and confirm the master "Total" footer and each "Group Summary" row now show a `%` average. Collapse/expand a group and confirm the group summary stays visible.

- [ ] **Step 3: Finish the task**

Run: `scripts/finish-task.sh` from inside the worktree (rebases onto develop, runs gates against the merged state, merges to develop, cleans up the worktree/branch).

---

## Self-Review

**Spec coverage:**

- Decision 1 (true average of all filled cells) → Task 1 (`withSubitems`) + Task 2 (feed expanded set) + Task 3 Step 2 (assert true average). ✓
- Decision 2 (applies to every aggregation board-wide) → Task 2 feeds the expanded set into every column's `SummaryRow`, which aggregates all kinds uniformly. ✓
- Decision 3 (per-group "Group Summary", always visible, counts subitems) → Task 2 Steps 3–4 (both collapsed + expanded render paths, label, expanded ids). ✓
- Decision 4 (master "Total" grand total across all groups) → Task 2 Step 2 (`withSubitems(topLevel, …)` + `label="Total"`). ✓
- "Every stored cell counted once" → Task 1 `seen` set + Task 3 Step 2 dedupe case. ✓
- Perf budget (0 round-trips) → no new fetches introduced; pure client compute. ✓
- Testing section → Tasks 1, 3, 4. ✓

**Placeholder scan:** Task 3 intentionally defers exact fixture builder names to the real `SummaryRow.test.tsx` (Step 1 reads them first) rather than inventing a divergent harness — the assertions and expected values are concrete. No `TBD`/`TODO`/"add error handling" placeholders elsewhere.

**Type consistency:** `withSubitems(itemIds, childrenByParent)` signature is identical in Task 1 (definition), Task 2 (call sites), and the Interfaces blocks. `label`/`itemIds` prop names match `SummaryRow`'s existing `SummaryRowProps`.
