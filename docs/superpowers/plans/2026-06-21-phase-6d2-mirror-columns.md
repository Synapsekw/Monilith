# Phase 6d-2 — Mirror Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `mirror` column kind that displays a field value from the linked items on a target board, surfaced through an existing 6d-1 `relation` column, with 0 extra first-paint round-trips and strict cross-board RLS.

**Architecture:** Pure derivation — no new table, no new RPC. A `mirror` enum value plus `columns.settings = { source_relation_column_id, target_column_id }`. The board payload hydrates the readable target `cell_values` (+ target column metadata) for this board's linked items; the cell derives its value(s) client-side and delegates rendering to the target kind's existing `CellRenderer`. Cross-board safety reuses 6d-1's RLS-scoped read boundary (unreadable target board → empty value, exactly as 6d-1 nulls linked-item names). Read-only: special-cased in `BoardTable` `EditableCell` like `relation`/`files`, never reaching `CellEditor`; no Server Action on the mirror cell.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript strict, Supabase (Postgres + RLS), Zod, Vitest, Playwright, Tailwind v4 + shadcn.

**Spec:** `docs/superpowers/specs/2026-06-21-phase-6d2-mirror-columns-design.md`
**Predecessor (read first):** `docs/superpowers/specs/2026-06-21-phase-6d1-relations-design.md`

**Worktree:** All work happens in `/Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/mirror-columns-6d2` on branch `task/mirror-columns-6d2`. Commit identity is pinned to `Danijel Jovanovic <info@synapse-solutions.ai>` (do not override). Stage by explicit path; never `git add -A`.

**Gate caveat (from project memory):** inside a worktree the CLI bins may not be on PATH and `next build` can't run there; `*.integration.test.ts` SILENTLY SKIP without `.env.local`. Symlink `.env.local` from the main checkout for the RLS suite, export the main `node_modules/.bin`, and run `pnpm build` in the main checkout for a compile-graph-clean check before the final merge.

---

## File Structure

**New files:**

- `supabase/migrations/<ts>_mirror_enum.sql` — the `mirror` enum value (own migration, like `20260621060000_relation_enum.sql`).
- `src/lib/boards/mirror.ts` — `MirrorValue` type, `mirrorValuesForCell` derivation, `mirrorRollup` helper (pure).
- `src/components/boards/cells/MirrorCell.tsx` — read-only presentational cell delegating to `CellRenderer`.
- `src/components/boards/MirrorColumnConfig.tsx` — add-column dual-select config.
- `src/lib/boards/mirror.test.ts` — unit tests for the derivation.
- `src/components/boards/cells/MirrorCell.test.tsx` — unit tests for the cell.
- `src/components/boards/MirrorColumnConfig.test.tsx` — unit tests for config.
- `src/lib/boards/mirror-columns.rls.integration.test.ts` — cross-board RLS proof obligations.
- `e2e/mirror-columns.spec.ts` — Playwright flow.

**Modified files:**

- `src/types/database.types.ts` — regenerated (enum gains `mirror`). Never hand-edit.
- `src/lib/validations/boards.ts` — `columnKindSchema`, `columnSettingsSchema`, `cellValueSchema`, `mirrorSettingsSchema`, `mirrorValueSchema`.
- `src/lib/boards/column-kinds.ts` — `COLUMN_KIND_META.mirror`, `COLUMN_KIND_ORDER`.
- `src/lib/boards/rollup.ts` — `case "mirror"` → `{ kind: "blank" }`.
- `src/lib/boards/column-defaults.ts` — `mirror` arm (whatever the exhaustive switch requires).
- `src/lib/boards/queries.ts` — `BoardPayload` += `mirrorTargetCells`/`mirrorTargetColumns`; hydration in `getBoardPayload`; new `listMirrorableColumns`.
- `src/lib/boards/cache.ts` — `BoardCache` += the two arrays.
- `src/components/boards/BoardTable.tsx` — `EditableCell` `mirror` special-case; add-column "Mirror" branch; parent-rollup `mirror` arm; pass mirror slices into the cache.
- `src/components/boards/cells/editors/index.tsx` — `mirror` → `null`.

---

## Execution DAG (AGENTS.md #6)

**Dependency edges (Consumes / Produces):**

| Task                                                    | Consumes                                                                   | Produces                                                                                                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 — enum + types + validation + registry + switch arms | —                                                                          | `mirror` enum, regenerated types, `columnKindSchema`/`mirrorSettingsSchema`/`mirrorValueSchema`, `COLUMN_KIND_META`/`ORDER`, `rollupCell`/`column-defaults` arms |
| T2 — payload + cache + derivation + query               | T1 (types)                                                                 | `BoardPayload`/`BoardCache` mirror slices, `mirrorValuesForCell`, `MirrorValue`, `listMirrorableColumns`                                                         |
| T3 — `MirrorCell`                                       | T1 (kind), T2 (`MirrorValue` type)                                         | `MirrorCell` component                                                                                                                                           |
| T4 — `MirrorColumnConfig`                               | T1 (kind), T2 (`listMirrorableColumns`)                                    | `MirrorColumnConfig` component                                                                                                                                   |
| T5 — `BoardTable` wiring                                | T2 (cache slices + accessor), T3 (`MirrorCell`), T4 (`MirrorColumnConfig`) | read-only cell routing, add-column branch, parent rollup                                                                                                         |
| T6 — RLS integration tests                              | T1, T2 (read path)                                                         | cross-board RLS proof                                                                                                                                            |
| T7 — e2e + full gate                                    | T1–T6                                                                      | Playwright + green gate                                                                                                                                          |

**Parallel batches (waves):**

- **Batch A:** `T1` (root; alone — every other task needs the enum/types).
- **Batch B:** `T2` (alone; gates the UI and tests).
- **Batch C (parallel, 3 agents):** `T3`, `T4`, `T6` — mutually independent once T1+T2 land. Dispatch with `superpowers:dispatching-parallel-agents`; each in its own scratch (they touch disjoint files: T3→`cells/MirrorCell.tsx`, T4→`MirrorColumnConfig.tsx`, T6→`*.rls.integration.test.ts`).
- **Batch D:** `T5` (joins T2+T3+T4; touches `BoardTable.tsx` — single writer).
- **Batch E:** `T7` (final join; e2e + gate).

**Critical path (wall-clock floor):** T1 → T2 → (T3|T4) → T5 → T7. T6 runs alongside C/D and merges before E.

---

## Task 1: Enum, types, validation, registry, and exhaustive-switch arms

**Files:**

- Create: `supabase/migrations/<ts>_mirror_enum.sql`
- Modify: `src/types/database.types.ts` (regenerated)
- Modify: `src/lib/validations/boards.ts`
- Modify: `src/lib/boards/column-kinds.ts`
- Modify: `src/lib/boards/rollup.ts`
- Modify: `src/lib/boards/column-defaults.ts`
- Test: `src/lib/validations/boards` covered via existing tests + new assertions; `src/lib/boards/column-kinds.test.ts` (parity)

- [ ] **Step 1: Grep every `ColumnKind` exhaustive switch so none is missed**

Run:

```bash
cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/mirror-columns-6d2
grep -rln 'ColumnKind\|case "relation"\|kind === "relation"' src/ | grep -v '\.test\.'
```

Expected sites to touch: `src/lib/validations/boards.ts`, `src/lib/boards/column-kinds.ts`, `src/lib/boards/rollup.ts`, `src/lib/boards/column-defaults.ts`, `src/components/boards/BoardTable.tsx` (BoardTable handled in T5). Note any others the grep surfaces.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/<ts>_mirror_enum.sql` (use a timestamp later than `20260621130000`, e.g. `20260621140000_mirror_enum.sql`):

```sql
-- Phase 6d-2: mirror column kind. Enum value added in its own migration so it
-- is committed before any migration/code references it (alter type … add value
-- cannot be used in the same transaction that uses the new value). Mirrors 6d-1's
-- 20260621060000_relation_enum.sql. Mirror columns store no rows of their own —
-- they derive from relation_links + the target board's cell_values.
alter type public.column_kind add value if not exists 'mirror';
```

- [ ] **Step 3: Apply migration + regenerate types**

Apply via the Supabase MCP `apply_migration` (name `mirror_enum`, the SQL above), then regenerate:

```bash
pnpm db:types   # or the Supabase MCP generate_typescript_types tool
```

Expected: `src/types/database.types.ts` `column_kind` enum now includes `"mirror"`.

- [ ] **Step 4: Write failing validation assertions**

Add to `src/lib/validations/boards.test.ts` (create if absent; follow existing validation test style):

```ts
import { describe, expect, it } from "vitest";
import {
  columnKindSchema,
  columnSettingsSchema,
  cellValueSchema,
} from "@/lib/validations/boards";

describe("mirror column validation", () => {
  it("accepts mirror as a column kind", () => {
    expect(columnKindSchema.safeParse("mirror").success).toBe(true);
  });
  it("validates mirror settings", () => {
    const ok = columnSettingsSchema("mirror").safeParse({
      source_relation_column_id: "11111111-1111-1111-1111-111111111111",
      target_column_id: "22222222-2222-2222-2222-222222222222",
    });
    expect(ok.success).toBe(true);
    const bad = columnSettingsSchema("mirror").safeParse({
      source_relation_column_id: "not-a-uuid",
    });
    expect(bad.success).toBe(false);
  });
  it("mirror cell value is empty-strict (no cell_values row)", () => {
    expect(cellValueSchema("mirror").safeParse({}).success).toBe(true);
    expect(cellValueSchema("mirror").safeParse({ x: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 5: Run — expect FAIL (type error / missing case)**

Run: `pnpm vitest run src/lib/validations/boards.test.ts`
Expected: FAIL — `columnKindSchema` rejects `"mirror"`, switches non-exhaustive.

- [ ] **Step 6: Implement validation**

In `src/lib/validations/boards.ts`:

- Add `"mirror"` to the `columnKindSchema` `z.enum([...])` array.
- Add the settings schema:

```ts
// Mirror column displays a value from the linked items on a relation's target
// board. It references a local relation column + a target column on that board.
export const mirrorSettingsSchema = z.object({
  source_relation_column_id: z.string().uuid(),
  target_column_id: z.string().uuid(),
});
```

- Add `case "mirror": return mirrorSettingsSchema;` to `columnSettingsSchema`.
- Add the value schema + case:

```ts
// Mirror cells store no cell_values row (content derives from relation_links +
// the target board's cell_values); empty-strict, never written by upsertCell.
export const mirrorValueSchema = z.object({}).strict();
```

and `case "mirror": return mirrorValueSchema;` to `cellValueSchema`.

- [ ] **Step 7: Implement registry**

In `src/lib/boards/column-kinds.ts`: import an icon (e.g. `FoldHorizontal` from `lucide-react`), add
`mirror: { label: "Mirror", Icon: FoldHorizontal, hasOptions: false },` to `COLUMN_KIND_META`, and
append `"mirror"` to `COLUMN_KIND_ORDER`.

- [ ] **Step 8: Implement rollup + column-defaults arms**

In `src/lib/boards/rollup.ts`, add `case "mirror":` to the blank-returning group (alongside `relation`):

```ts
    case "files":
    case "time_tracking":
    case "relation":
    case "mirror":
      return { kind: "blank" };
```

In `src/lib/boards/column-defaults.ts`, add the `mirror` arm the exhaustive switch requires (match the
`relation` arm — mirror has no default cell value).

- [ ] **Step 9: Run validation + parity tests — expect PASS**

Run:

```bash
pnpm vitest run src/lib/validations/boards.test.ts src/lib/boards/column-kinds.test.ts src/lib/boards/rollup.test.ts src/lib/boards/column-defaults.test.ts
```

Expected: PASS (META↔ORDER parity green; all switches exhaustive).

- [ ] **Step 10: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — every `ColumnKind` switch now has a `mirror` arm. If it fails, the error names the missing switch site; add the arm and re-run.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/<ts>_mirror_enum.sql src/types/database.types.ts \
  src/lib/validations/boards.ts src/lib/validations/boards.test.ts \
  src/lib/boards/column-kinds.ts src/lib/boards/rollup.ts src/lib/boards/column-defaults.ts
git commit -m "feat(boards): add mirror column kind enum, validation, and registry (6d-2)"
```

---

## Task 2: Payload hydration, cache slices, derivation, and `listMirrorableColumns`

**Files:**

- Create: `src/lib/boards/mirror.ts`
- Create: `src/lib/boards/mirror.test.ts`
- Modify: `src/lib/boards/queries.ts`
- Modify: `src/lib/boards/cache.ts`

- [ ] **Step 1: Write the failing derivation test**

Create `src/lib/boards/mirror.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mirrorValuesForCell } from "@/lib/boards/mirror";
import type { BoardCache } from "@/lib/boards/cache";

function baseCache(over: Partial<BoardCache>): BoardCache {
  return {
    board: {} as BoardCache["board"],
    groups: [],
    columns: [],
    items: [],
    cellValues: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
    ...over,
  };
}

const mirrorCol = {
  id: "mir",
  kind: "mirror",
  settings: { source_relation_column_id: "rel", target_column_id: "tcol" },
} as unknown as BoardCache["columns"][number];

it("derives one value per linked item, in link position order", () => {
  const cache = baseCache({
    relationLinks: [
      {
        id: "l2",
        itemId: "i1",
        columnId: "rel",
        linkedItemId: "b2",
        linkedItemName: "B2",
        position: 1,
      },
      {
        id: "l1",
        itemId: "i1",
        columnId: "rel",
        linkedItemId: "b1",
        linkedItemName: "B1",
        position: 0,
      },
    ],
    mirrorTargetCells: [
      { item_id: "b1", column_id: "tcol", value: { text: "alpha" } } as never,
      { item_id: "b2", column_id: "tcol", value: { text: "beta" } } as never,
    ],
  });
  const vals = mirrorValuesForCell(cache, "i1", mirrorCol);
  expect(vals.map((v) => v.linkedItemId)).toEqual(["b1", "b2"]); // position order
  expect(vals.map((v) => v.value)).toEqual([
    { text: "alpha" },
    { text: "beta" },
  ]);
});

it("yields an absent value when the target cell is unreadable/missing", () => {
  const cache = baseCache({
    relationLinks: [
      {
        id: "l1",
        itemId: "i1",
        columnId: "rel",
        linkedItemId: "b1",
        linkedItemName: null,
        position: 0,
      },
    ],
    mirrorTargetCells: [], // RLS filtered out the target cell
  });
  const vals = mirrorValuesForCell(cache, "i1", mirrorCol);
  expect(vals).toEqual([{ linkedItemId: "b1", value: null }]);
});

it("returns empty when the mirror config points at a missing relation column", () => {
  const cache = baseCache({ relationLinks: [] });
  const broken = {
    ...mirrorCol,
    settings: { source_relation_column_id: "gone", target_column_id: "tcol" },
  } as typeof mirrorCol;
  expect(mirrorValuesForCell(cache, "i1", broken)).toEqual([]);
});
```

- [ ] **Step 2: Run — expect FAIL (module + cache fields missing)**

Run: `pnpm vitest run src/lib/boards/mirror.test.ts`
Expected: FAIL — `@/lib/boards/mirror` not found; `BoardCache` lacks `mirrorTargetCells`/`mirrorTargetColumns`.

- [ ] **Step 3: Extend `BoardCache`**

In `src/lib/boards/cache.ts`, add to the `BoardCache` type:

```ts
  mirrorTargetCells: CacheCellValue[];      // (linked item, target column) values the caller can read
  mirrorTargetColumns: Pick<CacheColumn, "id" | "kind" | "settings">[]; // referenced target columns
```

(Place after `relationLinks`. These are read-only at runtime — no mutator helpers; they refresh via `revalidatePath` re-hydration.)

- [ ] **Step 4: Implement `src/lib/boards/mirror.ts`**

```ts
import type {
  BoardCache,
  CacheColumn,
  CacheCellValue,
} from "@/lib/boards/cache";

export type MirrorValue = {
  linkedItemId: string;
  /** null when the target cell is unreadable (RLS) or unset. */
  value: CacheCellValue["value"] | null;
};

type MirrorSettings = {
  source_relation_column_id?: string;
  target_column_id?: string;
};

/**
 * Derive the mirrored values for one mirror cell: the value of the configured
 * target column on each item linked through the configured source relation
 * column, in link position order. A linked item whose target cell the caller
 * cannot read (RLS) contributes a null value (rendered empty), exactly as 6d-1
 * nulls an unreadable linked-item name. Pure — reads only from the cache.
 */
export function mirrorValuesForCell(
  cache: BoardCache,
  itemId: string,
  mirrorColumn: Pick<CacheColumn, "settings">,
): MirrorValue[] {
  const s = (mirrorColumn.settings ?? {}) as MirrorSettings;
  if (!s.source_relation_column_id || !s.target_column_id) return [];

  const links = cache.relationLinks
    .filter(
      (l) => l.itemId === itemId && l.columnId === s.source_relation_column_id,
    )
    .sort((a, b) => a.position - b.position);

  return links.map((l) => {
    const cell = cache.mirrorTargetCells.find(
      (c) => c.item_id === l.linkedItemId && c.column_id === s.target_column_id,
    );
    return { linkedItemId: l.linkedItemId, value: cell?.value ?? null };
  });
}

/** The referenced target column's render metadata (kind + settings), or null. */
export function mirrorTargetColumnFor(
  cache: BoardCache,
  mirrorColumn: Pick<CacheColumn, "settings">,
): Pick<CacheColumn, "id" | "kind" | "settings"> | null {
  const s = (mirrorColumn.settings ?? {}) as MirrorSettings;
  if (!s.target_column_id) return null;
  return (
    cache.mirrorTargetColumns.find((c) => c.id === s.target_column_id) ?? null
  );
}

/** Collapsed-parent rollup: blank in v1 (no aggregate), like relation. */
export function mirrorRollup(): "" {
  return "";
}
```

- [ ] **Step 5: Run derivation test — expect PASS**

Run: `pnpm vitest run src/lib/boards/mirror.test.ts`
Expected: PASS.

- [ ] **Step 6: Extend `BoardPayload` + hydrate in `getBoardPayload`**

In `src/lib/boards/queries.ts`:

- Add to `BoardPayload`:

```ts
  mirrorTargetCells: CellValue[];
  mirrorTargetColumns: Pick<Column, "id" | "kind" | "settings">[];
```

- After the existing relation-name resolution block (which already produced `relationLinks`), add the mirror-source hydration. Place it after the `Promise.all` so it can read `columnsRes.data` and `rawLinks`:

```ts
// --- Mirror columns: derive the readable target cells + target column meta ---
// Each mirror column references a local relation column + a target column on
// that relation's target board. We fetch the target cells for THIS board's
// linked items, RLS-scoped → an unreadable target board yields no rows (mirror
// renders empty), exactly like the linked-name filter above. 0 extra user
// round-trips (part of this one server payload fetch).
const cols = columnsRes.data ?? [];
const mirrorCols = cols.filter((c) => c.kind === "mirror");
let mirrorTargetCells: CellValue[] = [];
let mirrorTargetColumns: Pick<Column, "id" | "kind" | "settings">[] = [];
if (mirrorCols.length > 0) {
  const targetColumnIds = [
    ...new Set(
      mirrorCols
        .map(
          (c) =>
            (c.settings as { target_column_id?: string })?.target_column_id,
        )
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const sourceRelIds = new Set(
    mirrorCols
      .map(
        (c) =>
          (c.settings as { source_relation_column_id?: string })
            ?.source_relation_column_id,
      )
      .filter((x): x is string => Boolean(x)),
  );
  // Linked items reachable through the referenced source relation columns.
  const linkedItemIds = [
    ...new Set(
      rawLinks
        .filter((l) => sourceRelIds.has(l.column_id))
        .map((l) => l.linked_item_id),
    ),
  ];
  if (targetColumnIds.length > 0 && linkedItemIds.length > 0) {
    const [cellsRes2, colsRes2] = await Promise.all([
      // Bounded over the (item_id, column_id) PK index; RLS-filtered.
      supabase
        .from("cell_values")
        .select("*")
        .in("item_id", linkedItemIds)
        .in("column_id", targetColumnIds)
        .limit(4000),
      // Target column render metadata (kind + settings, e.g. status options).
      supabase
        .from("columns")
        .select("id, kind, settings")
        .in("id", targetColumnIds),
    ]);
    mirrorTargetCells = cellsRes2.data ?? [];
    mirrorTargetColumns = colsRes2.data ?? [];
  }
}
```

- Add both to the returned object.

- [ ] **Step 7: Add `listMirrorableColumns`**

In `src/lib/boards/queries.ts` (or `src/lib/boards/relation-candidates.ts` — keep next to `listRelationCandidates` for cohesion; pick one and reference it consistently in T4). Add:

```ts
/** Mirrorable (scalar, cell_values-backed) columns on a target board, for the
 *  mirror config's target-column picker. RLS-scoped. Excludes derived kinds. */
export async function listMirrorableColumns(
  targetBoardId: string,
): Promise<{ id: string; name: string; kind: string }[]> {
  const supabase = await createClient();
  const NON_MIRRORABLE = ["files", "time_tracking", "relation", "mirror"];
  const { data } = await supabase
    .from("columns")
    .select("id, name, kind")
    .eq("board_id", targetBoardId)
    .order("position", { ascending: true });
  return (data ?? []).filter((c) => !NON_MIRRORABLE.includes(c.kind));
}
```

- [ ] **Step 8: Typecheck + run the board-cache/query test suites**

Run:

```bash
pnpm typecheck
pnpm vitest run src/lib/boards/cache.test.ts src/lib/boards/mirror.test.ts
```

Expected: PASS. (Any consumer that constructs a `BoardCache`/`BoardPayload` literal must now include the two new arrays — fix those construction sites; the typecheck error names them. The board page that maps `BoardPayload`→`BoardCache` must copy the two fields through.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/boards/mirror.ts src/lib/boards/mirror.test.ts \
  src/lib/boards/queries.ts src/lib/boards/cache.ts
git commit -m "feat(boards): hydrate mirror target cells + derive mirror values (6d-2)"
```

---

## Task 3: `MirrorCell` (read-only, delegates to `CellRenderer`)

**Files:**

- Create: `src/components/boards/cells/MirrorCell.tsx`
- Create: `src/components/boards/cells/MirrorCell.test.tsx`
- Modify: `src/components/boards/cells/editors/index.tsx` (`mirror` → `null`)

> **UI gate:** before building this component, load the `pulse-ui` and `frontend-design` skills (AGENTS.md #3). Match `RelationCell`'s monochrome chip/overflow styling.

- [ ] **Step 1: Write the failing render test**

Create `src/components/boards/cells/MirrorCell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MirrorCell } from "@/components/boards/cells/MirrorCell";

describe("MirrorCell", () => {
  it("renders each mirrored value via the target kind's renderer", () => {
    render(
      <MirrorCell
        values={[
          { linkedItemId: "b1", value: { text: "alpha" } },
          { linkedItemId: "b2", value: { text: "beta" } },
        ]}
        targetKind="text"
        targetSettings={{}}
      />,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("renders a status pill using the TARGET column's options", () => {
    render(
      <MirrorCell
        values={[{ linkedItemId: "b1", value: { optionId: "o1" } }]}
        targetKind="status"
        targetSettings={{
          options: [{ id: "o1", label: "Done", color: "#22c55e" }],
        }}
      />,
    );
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("omits absent (RLS-filtered) values and shows blank when all absent", () => {
    const { container } = render(
      <MirrorCell
        values={[{ linkedItemId: "b1", value: null }]}
        targetKind="text"
        targetSettings={{}}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("caps display with +K more", () => {
    render(
      <MirrorCell
        maxItems={1}
        values={[
          { linkedItemId: "b1", value: { text: "alpha" } },
          { linkedItemId: "b2", value: { text: "beta" } },
        ]}
        targetKind="text"
        targetSettings={{}}
      />,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText(/\+1 more/)).toBeInTheDocument();
  });

  it("shows a muted dash for a non-renderable target kind", () => {
    render(
      <MirrorCell
        values={[{ linkedItemId: "b1", value: {} }]}
        targetKind="files"
        targetSettings={{}}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL (component missing)**

Run: `pnpm vitest run src/components/boards/cells/MirrorCell.test.tsx`
Expected: FAIL — `MirrorCell` not found.

- [ ] **Step 3: Implement `MirrorCell`**

```tsx
import { CellRenderer } from "@/components/boards/cells";
import type { MirrorValue } from "@/lib/boards/mirror";
import type { ColumnKind, ColumnOption } from "@/lib/validations/boards";

type Settings = Record<string, unknown> & { options?: ColumnOption[] };

// Kinds that CellRenderer does NOT render (special-cased / derived). A mirror of
// one of these is defensively shown as "—" (the config picker already excludes them).
const NON_RENDERABLE: ReadonlySet<string> = new Set([
  "files",
  "time_tracking",
  "relation",
  "mirror",
]);

export type MirrorCellProps = {
  values: MirrorValue[];
  targetKind: ColumnKind;
  targetSettings: Settings;
  maxItems?: number;
};

/** Read-only cell that displays the mirrored value(s) from the linked items,
 *  delegating to the target field kind's renderer. No editor, no picker. */
export function MirrorCell({
  values,
  targetKind,
  targetSettings,
  maxItems = 2,
}: MirrorCellProps) {
  if (NON_RENDERABLE.has(targetKind)) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  const present = values.filter((v) => v.value != null);
  if (present.length === 0) return <span className="text-sm" />;
  const visible = present.slice(0, maxItems);
  const overflow = present.length - visible.length;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {visible.map((v) => (
        <span key={v.linkedItemId} className="min-w-0 truncate">
          <CellRenderer
            kind={targetKind}
            value={v.value}
            settings={targetSettings}
          />
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-muted-foreground shrink-0 text-xs">
          +{overflow} more
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Wire the editor index to null**

In `src/components/boards/cells/editors/index.tsx`, add `case "mirror": return null;` alongside the
`files`/`relation` null cases (mirror is never inline-edited).

- [ ] **Step 5: Run — expect PASS + typecheck**

Run:

```bash
pnpm vitest run src/components/boards/cells/MirrorCell.test.tsx
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/cells/MirrorCell.tsx \
  src/components/boards/cells/MirrorCell.test.tsx \
  src/components/boards/cells/editors/index.tsx
git commit -m "feat(boards): read-only MirrorCell delegating to target renderer (6d-2)"
```

---

## Task 4: `MirrorColumnConfig` (add-column dual-select)

**Files:**

- Create: `src/components/boards/MirrorColumnConfig.tsx`
- Create: `src/components/boards/MirrorColumnConfig.test.tsx`

> **UI gate:** load `pulse-ui` + `frontend-design` first. Match `RelationColumnConfig`'s dialog styling.

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/MirrorColumnConfig.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MirrorColumnConfig } from "@/components/boards/MirrorColumnConfig";

const relCols = [{ id: "rel1", name: "Projects", target_board_id: "boardB" }];

it("shows an empty state when the board has no relation column", () => {
  render(
    <MirrorColumnConfig
      relationColumns={[]}
      loadTargetColumns={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText(/Add a Relation column first/i)).toBeInTheDocument();
});

it("disables confirm until both selects are set, then emits settings", async () => {
  const loadTargetColumns = vi
    .fn()
    .mockResolvedValue([{ id: "tcol", name: "Status", kind: "status" }]);
  const onConfirm = vi.fn();
  render(
    <MirrorColumnConfig
      relationColumns={relCols}
      loadTargetColumns={loadTargetColumns}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  // pick the source relation → triggers loadTargetColumns(boardB)
  fireEvent.change(screen.getByLabelText(/source relation/i), {
    target: { value: "rel1" },
  });
  await waitFor(() => expect(loadTargetColumns).toHaveBeenCalledWith("boardB"));
  // pick the target column
  await waitFor(() => screen.getByRole("option", { name: "Status" }));
  fireEvent.change(screen.getByLabelText(/column to mirror/i), {
    target: { value: "tcol" },
  });
  fireEvent.click(screen.getByRole("button", { name: /add column/i }));
  expect(onConfirm).toHaveBeenCalledWith({
    source_relation_column_id: "rel1",
    target_column_id: "tcol",
  });
});
```

- [ ] **Step 2: Run — expect FAIL (component missing)**

Run: `pnpm vitest run src/components/boards/MirrorColumnConfig.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `MirrorColumnConfig`**

```tsx
"use client";

import { useState } from "react";

export type MirrorRelationOption = {
  id: string;
  name: string;
  target_board_id: string;
};
export type MirrorTargetColumn = { id: string; name: string; kind: string };
export type MirrorColumnSettings = {
  source_relation_column_id: string;
  target_column_id: string;
};

export function MirrorColumnConfig({
  relationColumns,
  loadTargetColumns,
  onConfirm,
  onCancel,
}: {
  relationColumns: MirrorRelationOption[];
  loadTargetColumns: (targetBoardId: string) => Promise<MirrorTargetColumn[]>;
  onConfirm: (settings: MirrorColumnSettings) => void;
  onCancel: () => void;
}) {
  const [relId, setRelId] = useState("");
  const [targetCols, setTargetCols] = useState<MirrorTargetColumn[]>([]);
  const [targetColId, setTargetColId] = useState("");

  if (relationColumns.length === 0) {
    return (
      <div className="space-y-4 p-1">
        <p className="text-muted-foreground text-sm">
          Add a Relation column first — a Mirror column reflects a value from a
          board you’ve connected.
        </p>
        <div className="flex justify-end">
          <button type="button" onClick={onCancel} className="text-sm">
            Close
          </button>
        </div>
      </div>
    );
  }

  async function pickRelation(id: string) {
    setRelId(id);
    setTargetColId("");
    setTargetCols([]);
    const rel = relationColumns.find((r) => r.id === id);
    if (rel) setTargetCols(await loadTargetColumns(rel.target_board_id));
  }

  return (
    <div className="space-y-4 p-1">
      <label className="block space-y-1 text-sm">
        <span>Source relation</span>
        <select
          aria-label="Source relation column"
          value={relId}
          onChange={(e) => void pickRelation(e.target.value)}
          className="w-full rounded-md border px-2 py-1.5 text-sm"
        >
          <option value="">Select a relation…</option>
          {relationColumns.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1 text-sm">
        <span>Column to mirror</span>
        <select
          aria-label="Column to mirror"
          value={targetColId}
          disabled={!relId}
          onChange={(e) => setTargetColId(e.target.value)}
          className="w-full rounded-md border px-2 py-1.5 text-sm disabled:opacity-50"
        >
          <option value="">Select a column…</option>
          {targetCols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-sm">
          Cancel
        </button>
        <button
          type="button"
          disabled={!relId || !targetColId}
          onClick={() =>
            onConfirm({
              source_relation_column_id: relId,
              target_column_id: targetColId,
            })
          }
          className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Add column
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS + typecheck**

Run:

```bash
pnpm vitest run src/components/boards/MirrorColumnConfig.test.tsx
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/MirrorColumnConfig.tsx src/components/boards/MirrorColumnConfig.test.tsx
git commit -m "feat(boards): MirrorColumnConfig dual-select add-column dialog (6d-2)"
```

---

## Task 5: `BoardTable` wiring (read-only cell, add-column branch, parent rollup)

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`

> Single writer of `BoardTable.tsx` — do not run in parallel with another task that touches it. Load `pulse-ui` first.

- [ ] **Step 1: Route `mirror` to `MirrorCell` in `EditableCell` (read-only special-case)**

In `EditableCell`, add a branch **before** the generic `isEditing` path, alongside the existing
`relation` branch (study how `relation` reads `relationLinksForCell(controls.cache, …)` and renders in
a `border-l` container). Use the derivation helpers:

```tsx
if (column.kind === "mirror") {
  const values = mirrorValuesForCell(controls.cache, item.id, column);
  const target = mirrorTargetColumnFor(controls.cache, column);
  return (
    <div className="flex h-full items-center border-l px-3">
      {target ? (
        <MirrorCell
          values={values}
          targetKind={target.kind as ColumnKind}
          targetSettings={(target.settings ?? {}) as Record<string, unknown>}
        />
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      )}
    </div>
  );
}
```

Add imports: `MirrorCell`, `mirrorValuesForCell`, `mirrorTargetColumnFor`, and `ColumnKind` if not present.

- [ ] **Step 2: Add the collapsed-parent rollup arm for `mirror`**

Find the parent-rollup block that special-cases `relation` (renders `relationRollup(childLinks)`) and
add a sibling `mirror` arm that renders blank (v1 — no aggregate):

```tsx
if (col.kind === "mirror") {
  return (
    <div
      key={col.id}
      className="flex h-full items-center truncate border-l px-3"
    />
  );
}
```

- [ ] **Step 3: Wire the "Mirror" add-column branch**

Find where selecting "Relation" in `AddColumnMenu` opens the `RelationColumnConfig` modal (loads
target boards, then shows the dialog). Add a parallel "Mirror" branch:

- On selecting "Mirror", open the `MirrorColumnConfig` dialog.
- Pass `relationColumns` = this board's `relation` columns mapped to `{ id, name, target_board_id }`
  (from `board.columns` in memory — `settings.target_board_id`). No fetch.
- Pass `loadTargetColumns={(boardId) => listMirrorableColumns(boardId)}`.
- `onConfirm={(settings) => createColumn({ kind: "mirror", settings, ... })}` — reuse the existing
  add-column server action the relation branch calls, passing `kind: "mirror"` and the mirror settings.

- [ ] **Step 4: Ensure the board page maps the two mirror slices into the cache**

Find where `BoardPayload` is converted to `BoardCache` (the board page / provider). Copy
`mirrorTargetCells` and `mirrorTargetColumns` through. (Typecheck from T2 already forces this; verify
it is the board page and not a stub.)

- [ ] **Step 5: Typecheck + run board component tests**

Run:

```bash
pnpm typecheck
pnpm vitest run src/components/boards
```

Expected: PASS.

- [ ] **Step 6: Manual smoke (dev server in the main checkout if the worktree can't build)**

Start the app, add a relation column on a board, link an item, add a mirror column pointing at that
relation + a target column, and confirm the mirrored value renders read-only (no edit cursor/popover).

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/BoardTable.tsx
git commit -m "feat(boards): wire mirror column into BoardTable (read-only cell + config) (6d-2)"
```

---

## Task 6: Cross-board RLS integration tests

**Files:**

- Create: `src/lib/boards/mirror-columns.rls.integration.test.ts`

> Runs only with `.env.local` present (symlink from the main checkout) — it SILENTLY SKIPS otherwise. This is the spec's security proof obligation; it MUST be written and MUST pass against the live DB before merge. Independent of the UI tasks — can run in parallel with T3/T4/T5.

- [ ] **Step 1: Write the suite (extends the 6d-1 harness)**

Create `src/lib/boards/mirror-columns.rls.integration.test.ts`. Reuse the exact harness shape from
`src/lib/boards/relation-links.rls.integration.test.ts` (admin/service-role + per-user anon clients;
`makeUser`/`makeBoard`/`makeItem` helpers; owner with board A owning + board B target; outsider = org
member, viewer of A, NOT a member of B). Then:

- On board B, create a **status** (or text) source column `T` and set a value on `(b1, T)`.
- On board A, create a **relation** column `R` → board B, and a **mirror** column
  `M` with `settings = { source_relation_column_id: R, target_column_id: T }`.
- Link `itemA → [b1]` via `set_relation_links`.

Assertions (the four proof obligations):

```ts
it("owner (can read B) reads the mirrored source cell", async () => {
  const { data } = await owner
    .from("cell_values")
    .select("item_id, column_id, value")
    .eq("item_id", b1)
    .eq("column_id", T);
  expect(data).toHaveLength(1); // owner sees the target value
});

it("outsider (viewer of A, non-member of B) cannot read the mirrored source cell", async () => {
  // This is the mirror analogue of 6d-1's "viewer of A can't see the linked NAME".
  const { data, error } = await outsider
    .from("cell_values")
    .select("item_id, column_id, value")
    .eq("item_id", b1)
    .eq("column_id", T);
  expect(error).toBeNull();
  expect(data).toHaveLength(0); // RLS filters board B's cell → mirror renders empty
});

it("outsider still sees the relation link row (board A readable) but no mirrored value", async () => {
  const { data } = await outsider
    .from("relation_links")
    .select("id, linked_item_id")
    .eq("item_id", itemA)
    .eq("column_id", R);
  expect(data).toHaveLength(1); // link visible; the mirror value (above) is not
});

it("deleting the target column makes the mirror source unresolvable without error", async () => {
  await owner.from("columns").delete().eq("id", T);
  const { data, error } = await owner
    .from("cell_values")
    .select("value")
    .eq("item_id", b1)
    .eq("column_id", T);
  expect(error).toBeNull();
  expect(data).toHaveLength(0); // cascade removed the cell; mirror renders empty
});
```

(Capture `T`, `R`, `M`, `b1`, `itemA` in `beforeAll`, mirroring the 6d-1 file.)

- [ ] **Step 2: Run against the live DB**

Run (with `.env.local` linked and the bins on PATH):

```bash
pnpm vitest run src/lib/boards/mirror-columns.rls.integration.test.ts
```

Expected: PASS (4 assertions). If the suite reports 0 tests, `.env.local` is missing — fix the symlink (it must not be reported as "passing" while skipped).

- [ ] **Step 3: Commit**

```bash
git add src/lib/boards/mirror-columns.rls.integration.test.ts
git commit -m "test(boards): cross-board RLS proof for mirror columns (6d-2)"
```

---

## Task 7: e2e + full gate + closure

**Files:**

- Create: `e2e/mirror-columns.spec.ts`

- [ ] **Step 1: Write the Playwright flow**

Create `e2e/mirror-columns.spec.ts` following an existing `e2e/*.spec.ts` (auth/setup helpers, board
creation). Flow: sign in → create board A + board B (with a text/status column + an item with a value
on B) → on A add a relation column → link B's item → add a mirror column pointing at the relation +
B's column → assert the mirrored value text/pill is visible in the mirror cell, and that clicking it
does **not** open an editor (read-only).

- [ ] **Step 2: Run e2e**

Run: `pnpm e2e e2e/mirror-columns.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full gate (build in the main checkout per the worktree caveat)**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test
# build in the MAIN checkout for a compile-graph-clean diff (next build can't run in the worktree):
( cd /Users/danijeljovanovic/Dev/Monolith && pnpm build )
```

Expected: all green.

- [ ] **Step 4: Commit + finish**

```bash
git add e2e/mirror-columns.spec.ts
git commit -m "test(boards): e2e flow for mirror columns (6d-2)"
```

Then close the task per the working agreement: run `scripts/finish-task.sh` from inside the worktree
(merges `task/mirror-columns-6d2` → `develop`, pushes, removes the worktree + branch). If the worktree
gates fail spuriously (binaries/Turbopack/integration-skip caveat), run the gates manually as above,
then merge by hand. Do **not** report complete while the branch is still open.

- [ ] **Step 5: Hand the user a "How to test this" walkthrough**

Numbered manual-test guide (pull `develop`): (1) open a board; (2) add a **Relation** column → pick a
target board; (3) link an item from that board into a cell; (4) add a **Mirror** column → pick the
relation as source + a column on the target board to mirror; (5) confirm the mirrored value appears in
the mirror cell and is read-only (no edit popover); (6) edit the linked item's source value on the
target board, reload board A, confirm the mirror reflects the new value. Put this in the closing
message **and** the `/wrapup` session note.

---

## Self-Review

**Spec coverage:**

- Read-only `mirror` kind in Add-column menu → T1 (registry) + T5 (add-column branch) ✓
- Config `{ source_relation_column_id, target_column_id }` → T1 (schema) + T4 (UI) ✓
- Delegate to target `CellRenderer` → T3 ✓
- Multi-value list + "+K more" → T3 ✓
- Cross-board RLS (viewer of A, non-member of B → empty) → T6 (proof) + T2 (RLS-scoped read) ✓
- 0 first-paint round-trips / bounded indexed read → T2 (payload `IN (…)` over `(item_id, column_id)`, `.limit`) ✓
- Cascade-invalidation via existing `revalidatePath` on relation edits → covered in T2 commentary + spec; no new code, asserted by manual step in T7(5) ✓
- No new table/RPC → T1 (enum-only migration) ✓
- Exhaustive-switch arms (rollup, defaults, validation) → T1 ✓
- Editors index null → T3 ✓
- Unit + RLS integration + e2e tests → T1–T4 (unit), T6 (RLS), T7 (e2e) ✓

**Placeholder scan:** No TBD/TODO; every code step shows code; every run step shows the command + expected result. ✓

**Type consistency:** `MirrorValue { linkedItemId; value }`, `mirrorValuesForCell`, `mirrorTargetColumnFor`, `MirrorColumnSettings { source_relation_column_id; target_column_id }`, `listMirrorableColumns`, `BoardCache.mirrorTargetCells`/`mirrorTargetColumns` are used identically across T2/T3/T4/T5. ✓

**Open design questions (Q1–Q5 in the spec)** are not blockers for this plan's scope (list-display, scalar-only, multi-link, accepted staleness) but should be confirmed by the user before/at build start; if the user changes Q1 (aggregation) or Q2 (derived-kind mirroring), T3/T4 grow.
