# Import Wizard — Structure Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated "Structure" step to the file-import wizard where the user assigns each row an item/subitem type and a group (with bulk actions), widen the modal, and pin the primary action button — in both new-board and existing-board import modes.

**Architecture:** The wizard becomes four steps (Upload → Map columns → Structure → Confirm). Per-row structure (group + item/subitem) is held as pure client state in `import-wizard-state.ts`, sent to the `commitImport` server action as explicit `groups` + `structure` arrays, and turned into the create/append RPC payloads by a shared `resolveStructuredRows` helper that replaces the old `↳`-marker `splitRows2` derivation. New-board commit reuses the already-multi-group `create_board_from_template` RPC; existing-board commit needs a rewritten `import_rows_into_board` RPC (a migration the user applies by hand).

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript strict, Zod 4, Supabase Postgres RPC (plpgsql, SECURITY DEFINER), Vitest, Tailwind v4 + shadcn primitives.

## Global Constraints

- **Server Components by default; Server Actions for all mutations.** Confirm any Next.js API against `node_modules/next/dist/docs/`.
- **Validate at boundaries with Zod. TypeScript strict; avoid `any`** (justify when unavoidable).
- **RLS is the security boundary.** The `import_rows_into_board` RPC is `SECURITY DEFINER set search_path = ''` — every table reference stays schema-qualified (`public.…`), and the function enforces `auth.uid()`, `is_org_member`, and `can_edit_board` itself.
- **Schema changes are versioned migrations** in `supabase/migrations/`. The agent CANNOT apply migrations (classifier blocks `db push`/DDL) — the **user applies the SQL manually**, then the agent runs `pnpm db:types` and commits regenerated `src/types/database.types.ts` in the same PR. Never hand-edit `database.types.ts`.
- **In-page wizard interactions are client state only — zero new server round-trips.** Only `previewImport` (upload) and `commitImport` (import) hit the server.
- **Commit identity** is `Danijel Jovanovic <info@synapse-solutions.ai>` (pinned by `start-task.sh` in the worktree). Commit subjects are lowercase after `type(scope):`; every commit has a descriptive body + a `Co-Authored-By:` trailer. Stage explicitly by path (never `git add -A`).
- **Gates (a task's deliverable is not done until these pass):** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Individual test steps below use `pnpm vitest run <file>`.
- **Caps (`src/lib/boards/spreadsheet/types.ts`):** `MAX_ROWS = 2000`, `MAX_COLS = 40`, `MAX_BYTES = 5MiB`, `PREVIEW_GRID_ROWS = 200`.

---

## Worktree setup (do this first)

This plan touches product source across many files plus a migration; it must build in an isolated worktree, not the main `develop` checkout.

- [ ] From the main checkout run: `scripts/start-task.sh import-structure-step`
- [ ] `EnterWorktree({ path: ".claude/worktrees/import-structure-step" })` so the session + subagents operate on the `task/import-structure-step` branch with relative paths.

---

## File structure

| File                                                             | Responsibility                                                                                              | Task |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---- |
| `src/lib/boards/spreadsheet/types.ts`                            | Add wire types `ImportGroup`, `RowStructureEntry`; keep `ColumnRole` (mark `"group"` legacy)                | 1    |
| `src/lib/boards/spreadsheet/build-import-payload.ts`             | Add `resolveStructuredRows` (shared) + `buildImportPayloadV3` (new-board)                                   | 1, 3 |
| `src/lib/boards/spreadsheet/build-append-payload.ts`             | Rewrite `buildAppendPayload` to multi-group                                                                 | 4    |
| `src/components/boards/import/import-wizard-state.ts`            | `GroupSpec`/`RowStructure` on `SheetState`, seeding, group + bulk helpers, orphan detection, commit shaping | 2    |
| `src/lib/validations/board-spreadsheet.ts`                       | `commitImportSchema` gains `groups`/`structure`; drop `"group"`-role rules                                  | 5    |
| `supabase/migrations/20260705120000_import_rows_multi_group.sql` | Rewrite `import_rows_into_board` for multiple groups                                                        | 6    |
| `src/types/database.types.ts`                                    | Regenerated after the migration is applied                                                                  | 6    |
| `src/lib/boards/spreadsheet-actions.ts`                          | `commitImport` reads `groups`/`structure`, calls new builders; structure validation                         | 7    |
| `src/components/boards/import/ImportWizard.tsx`                  | 4 steps, pinned footer, wider modal, commit wiring                                                          | 8, 9 |
| `src/components/boards/import/MapStep.tsx`                       | Drop its own nav buttons                                                                                    | 8    |
| `src/components/boards/import/ConfirmStep.tsx`                   | Drop its own nav buttons + `ExistingGroupFields`                                                            | 8, 9 |
| `src/components/boards/import/MappingGrid.tsx`                   | Remove the "Use as group" role option                                                                       | 9    |
| `src/components/boards/import/StructureStep.tsx`                 | **New** — the Structure step UI                                                                             | 9    |
| `src/lib/boards/import-rows-into-board.integration.test.ts`      | Extend for multi-group append                                                                               | 10   |

## Execution DAG

- **Batch 1:** Task 1 (shared types + `resolveStructuredRows`).
- **Batch 2 (parallel, after Task 1):** Task 2 (client state), Task 3 (new-board builder), Task 4 (append builder), Task 5 (Zod), Task 6 (migration SQL file), Task 8 (footer + sizing, UI-only). Task 8 depends on nothing in Task 1 and may also start immediately.
- **Batch 3:** Task 7 (server-action wiring — needs 3, 4, 5). **Manual gate:** user applies the Task 6 migration, agent regenerates types.
- **Batch 4:** Task 9 (StructureStep + wizard wiring — needs 2, 7, 8), Task 10 (integration test — needs applied migration + 7).
- **Critical path:** Task 1 → Task 4 → Task 7 → Task 9.

Batch-2 tasks that mutate different files run as parallel subagents. Task 3 and Task 4 both edit `build-*-payload.ts` (different files) — safe. Task 1 and Task 3 both edit `build-import-payload.ts`; Task 3 depends on Task 1, so they are sequential, not parallel.

---

## Task 1: Shared wire types + `resolveStructuredRows`

Pure, server-safe logic shared by both payload builders. Replaces the marker-based `splitRows2` with explicit per-row structure.

**Files:**

- Modify: `src/lib/boards/spreadsheet/types.ts` (append after line 88)
- Modify: `src/lib/boards/spreadsheet/build-import-payload.ts`
- Test: `src/lib/boards/spreadsheet/resolve-structured-rows.test.ts` (new)

**Interfaces:**

- Produces:
  - `type ImportGroup = { key: string; name: string; existingGroupId: string | null }`
  - `type RowStructureEntry = { gridIndex: number; groupKey: string; type: "item" | "subitem" }`
  - `resolveStructuredRows(table: ParsedTable, nameIndex: number, groups: ImportGroup[], structure: RowStructureEntry[]): ResolvedStructure`
  - `type ResolvedStructure = { groups: ImportGroup[]; items: ResolvedItem[]; subitems: ResolvedSubitem[] }`
  - `type ResolvedItem = { groupKey: string; name: string; row: string[]; position: number }`
  - `type ResolvedSubitem = { parentIndex: number; groupKey: string; name: string; row: string[]; position: number }` (`parentIndex` indexes into `items`)

**Behavior (spec: "subitem attaches to the nearest item above it in the same group"; empty groups dropped):**

- Build a `Map<number, RowStructureEntry>` keyed by `gridIndex`.
- Walk `table.rows` in source order (`r`, `gridIndex = table.rowIndices[r]`). Fall back to `{ groupKey: groups[0].key, type: "item" }` when a row has no entry.
- `name = (row[nameIndex] ?? "").trim()` — **no marker stripping** (grouping is explicit now).
- `item` → push `{ groupKey, name, row, position: items.length }`; record `lastItemIndexByGroup[groupKey] = items.length - 1`.
- `subitem` with a recorded parent in the same group → push `{ parentIndex, groupKey, name, row, position: subitems.length }`.
- `subitem` with **no** parent in its group (orphan) → defensively promote to an item (the client blocks this case; the server validates it separately in Task 7 for a friendly error). Never throw here.
- Result `groups` = the input groups that ended up with ≥1 item, in input order (drop empties).

- [ ] **Step 1: Append wire types to `types.ts`**

Append after line 88 (end of file):

```ts
/** A target group for a structured import: either a brand-new group
 * (`existingGroupId: null`) or an existing board group being reused
 * (`existingGroupId` set). `key` is a stable client id echoed back in the
 * commit payload so `structure` rows can reference it. */
export type ImportGroup = {
  key: string;
  name: string;
  existingGroupId: string | null;
};

/** Per-row structure assignment, keyed by the ORIGINAL grid row index (the
 * same index space `excludedRows` uses), so the client and the re-parsing
 * server resolve identical rows. */
export type RowStructureEntry = {
  gridIndex: number;
  groupKey: string;
  type: "item" | "subitem";
};
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/boards/spreadsheet/resolve-structured-rows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveStructuredRows } from "./build-import-payload";
import type { ParsedTable, ImportGroup, RowStructureEntry } from "./types";

const table = (rows: string[][], indices: number[]): ParsedTable => ({
  header: ["Name"],
  rows,
  rowIndices: indices,
});

const G: ImportGroup[] = [
  { key: "g1", name: "Group 1", existingGroupId: null },
  { key: "g2", name: "Group 2", existingGroupId: "board-grp-2" },
];

describe("resolveStructuredRows", () => {
  it("splits items/subitems and attaches subitems to the nearest item above in the same group", () => {
    const t = table([["A"], ["B"], ["C"], ["D"]], [1, 2, 3, 4]);
    const structure: RowStructureEntry[] = [
      { gridIndex: 1, groupKey: "g1", type: "item" },
      { gridIndex: 2, groupKey: "g1", type: "subitem" },
      { gridIndex: 3, groupKey: "g2", type: "item" },
      { gridIndex: 4, groupKey: "g2", type: "subitem" },
    ];
    const res = resolveStructuredRows(t, 0, G, structure);

    expect(res.items.map((i) => i.name)).toEqual(["A", "C"]);
    expect(res.subitems).toHaveLength(2);
    expect(res.subitems[0]).toMatchObject({
      parentIndex: 0,
      name: "B",
      groupKey: "g1",
    });
    expect(res.subitems[1]).toMatchObject({
      parentIndex: 1,
      name: "D",
      groupKey: "g2",
    });
    expect(res.groups.map((g) => g.key)).toEqual(["g1", "g2"]);
  });

  it("drops groups that end up with no items", () => {
    const t = table([["A"]], [1]);
    const structure: RowStructureEntry[] = [
      { gridIndex: 1, groupKey: "g1", type: "item" },
    ];
    const res = resolveStructuredRows(t, 0, G, structure);
    expect(res.groups.map((g) => g.key)).toEqual(["g1"]);
  });

  it("promotes an orphan subitem (no item above it in its group) to an item", () => {
    const t = table([["A"], ["B"]], [1, 2]);
    const structure: RowStructureEntry[] = [
      { gridIndex: 1, groupKey: "g1", type: "item" },
      { gridIndex: 2, groupKey: "g2", type: "subitem" }, // no item in g2
    ];
    const res = resolveStructuredRows(t, 0, G, structure);
    expect(res.items.map((i) => i.name)).toEqual(["A", "B"]);
    expect(res.subitems).toHaveLength(0);
  });

  it("falls back to the first group + item for rows with no structure entry", () => {
    const t = table([["A"]], [1]);
    const res = resolveStructuredRows(t, 0, G, []);
    expect(res.items).toEqual([
      { groupKey: "g1", name: "A", row: ["A"], position: 0 },
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/boards/spreadsheet/resolve-structured-rows.test.ts`
Expected: FAIL — `resolveStructuredRows` is not exported.

- [ ] **Step 4: Implement `resolveStructuredRows`**

In `src/lib/boards/spreadsheet/build-import-payload.ts`, add the import and the function (place `resolveStructuredRows` above `buildImportPayloadV2`). Add to the top `import { … } from "./types"` block: `ImportGroup`, `RowStructureEntry`.

```ts
export type ResolvedItem = {
  groupKey: string;
  name: string;
  row: string[];
  position: number;
};

export type ResolvedSubitem = {
  parentIndex: number; // index into ResolvedStructure.items
  groupKey: string;
  name: string;
  row: string[];
  position: number;
};

export type ResolvedStructure = {
  groups: ImportGroup[];
  items: ResolvedItem[];
  subitems: ResolvedSubitem[];
};

/**
 * Resolve explicit per-row structure into items + subitems. Replaces the
 * marker-driven `splitRows2`: item/subitem type and group come from
 * `structure` (keyed by original grid index), not from a `↳` name prefix or a
 * group column. A subitem attaches to the nearest preceding item in the SAME
 * group; an orphan subitem (none exists) is promoted to an item — the client
 * blocks that case, and Task 7's action validates it for a friendly error, so
 * this stays total (never throws). Empty groups are dropped.
 */
export function resolveStructuredRows(
  table: ParsedTable,
  nameIndex: number,
  groups: ImportGroup[],
  structure: RowStructureEntry[],
): ResolvedStructure {
  const byGrid = new Map(structure.map((s) => [s.gridIndex, s]));
  const fallbackKey = groups[0]?.key ?? "";

  const items: ResolvedItem[] = [];
  const subitems: ResolvedSubitem[] = [];
  const lastItemIndexByGroup = new Map<string, number>();

  table.rows.forEach((row, r) => {
    const gridIndex = table.rowIndices[r];
    const entry = byGrid.get(gridIndex);
    const groupKey = entry?.groupKey ?? fallbackKey;
    const type = entry?.type ?? "item";
    const name = (row[nameIndex] ?? "").trim();

    const parentIndex = lastItemIndexByGroup.get(groupKey);
    if (type === "subitem" && parentIndex !== undefined) {
      subitems.push({
        parentIndex,
        groupKey,
        name,
        row,
        position: subitems.length,
      });
      return;
    }
    lastItemIndexByGroup.set(groupKey, items.length);
    items.push({ groupKey, name, row, position: items.length });
  });

  const usedKeys = new Set(items.map((i) => i.groupKey));
  return {
    groups: groups.filter((g) => usedKeys.has(g.key)),
    items,
    subitems,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/boards/spreadsheet/resolve-structured-rows.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/spreadsheet/types.ts src/lib/boards/spreadsheet/build-import-payload.ts src/lib/boards/spreadsheet/resolve-structured-rows.test.ts
git commit -m "feat(import): add ImportGroup/RowStructureEntry wire types and resolveStructuredRows"
```

---

## Task 2: Client state — structure model, seeding, group + bulk helpers

Pure client-state layer (no React) that the Structure step consumes. Extends `SheetState`, seeds a flat start, and shapes the commit payload.

**Files:**

- Modify: `src/components/boards/import/import-wizard-state.ts`
- Test: `src/components/boards/import/import-wizard-state.structure.test.ts` (new)

**Interfaces:**

- Consumes (Task 1): `ImportGroup`, `RowStructureEntry` from `@/lib/boards/spreadsheet/types`.
- Produces:
  - `SheetState` gains `groups: ImportGroup[]` and `structure: Record<number, { groupKey: string; type: "item" | "subitem" }>`.
  - `seedStructure(state: SheetState, table: ParsedTable, mode: "new" | "existing", existingGroups: { id: string; name: string }[]): SheetState`
  - `addGroup(state: SheetState): SheetState`
  - `renameGroup(state: SheetState, key: string, name: string): SheetState`
  - `bulkSetType(state: SheetState, gridIndices: number[], type: "item" | "subitem"): SheetState`
  - `bulkSetGroup(state: SheetState, gridIndices: number[], groupKey: string): SheetState`
  - `orphanGridIndices(table: ParsedTable, state: SheetState): number[]`
  - `buildCommitGroups(state: SheetState): ImportGroup[]`
  - `buildCommitStructure(table: ParsedTable, state: SheetState): RowStructureEntry[]`

Note: `deriveSheetState`/`deriveSheetStateSafe` must initialize the new fields to `groups: []`, `structure: {}` so existing callers keep compiling; `seedStructure` fills them once the wizard reaches the Structure step. `buildCommitStructure` emits one entry per non-excluded grid row (defaulting to the first group + item).

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/import/import-wizard-state.structure.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  seedStructure,
  addGroup,
  bulkSetType,
  bulkSetGroup,
  orphanGridIndices,
  buildCommitGroups,
  buildCommitStructure,
  deriveSheetState,
} from "./import-wizard-state";
import type { ParsedTable } from "@/lib/boards/spreadsheet/types";

// grid: header row 0, then 3 data rows
const grid = [["Name"], ["Alpha"], ["Beta"], ["Gamma"]];
const table: ParsedTable = {
  header: ["Name"],
  rows: [["Alpha"], ["Beta"], ["Gamma"]],
  rowIndices: [1, 2, 3],
};

function seededNew() {
  const base = deriveSheetState(grid, 0);
  return seedStructure(base, table, "new", []);
}

describe("import structure state", () => {
  it("seeds a flat start: one default group, all rows items", () => {
    const s = seededNew();
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].name).toBe("Imported");
    expect(s.groups[0].existingGroupId).toBeNull();
    const key = s.groups[0].key;
    for (const gi of [1, 2, 3]) {
      expect(s.structure[gi]).toEqual({ groupKey: key, type: "item" });
    }
  });

  it("existing mode seeds the board's first group as the default", () => {
    const base = deriveSheetState(grid, 0, []);
    const s = seedStructure(base, table, "existing", [
      { id: "grp-a", name: "Backlog" },
    ]);
    expect(s.groups[0]).toMatchObject({
      name: "Backlog",
      existingGroupId: "grp-a",
    });
  });

  it("addGroup appends a new editable group", () => {
    const s = addGroup(seededNew());
    expect(s.groups).toHaveLength(2);
    expect(s.groups[1].name).toBe("Group 2");
    expect(s.groups[1].existingGroupId).toBeNull();
  });

  it("bulkSetType and bulkSetGroup mutate the selected rows only", () => {
    let s = addGroup(seededNew());
    const g2 = s.groups[1].key;
    s = bulkSetGroup(s, [3], g2);
    s = bulkSetType(s, [2], "subitem");
    expect(s.structure[3].groupKey).toBe(g2);
    expect(s.structure[2].type).toBe("subitem");
    expect(s.structure[1].type).toBe("item");
  });

  it("orphanGridIndices flags a subitem with no item above it in its group", () => {
    let s = seededNew();
    // make row 1 (first row) a subitem => orphan in its group
    s = bulkSetType(s, [1], "subitem");
    expect(orphanGridIndices(table, s)).toEqual([1]);
  });

  it("buildCommitGroups drops groups with no items; buildCommitStructure emits one entry per row", () => {
    let s = addGroup(seededNew()); // Group 2 has no rows
    expect(buildCommitGroups(s).map((g) => g.name)).toEqual(["Imported"]);
    expect(buildCommitStructure(table, s)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/boards/import/import-wizard-state.structure.test.ts`
Expected: FAIL — helpers not exported / `SheetState` lacks fields.

- [ ] **Step 3: Implement the state changes**

In `src/components/boards/import/import-wizard-state.ts`:

1. Extend the imports from `./types` to include `ImportGroup`, `RowStructureEntry`.
2. Change the `SheetState` type:

```ts
export type SheetState = {
  headerRow: number | null;
  excluded: number[];
  columns: ColumnState[];
  /** Target groups for the Structure step (ordered). Empty until seeded. */
  groups: ImportGroup[];
  /** Per-row structure keyed by grid row index. Empty until seeded. */
  structure: Record<number, { groupKey: string; type: "item" | "subitem" }>;
};
```

3. In `deriveSheetState`, change the two `return` sites (the sentinel in `deriveSheetStateSafe` and the main return) to include the new fields:

- Main return (line ~121): `return { headerRow, excluded: [], columns, groups: [], structure: {} };`
- Empty sentinel in `deriveSheetStateSafe` (line ~141): `return { headerRow: null, excluded: [], columns: [], groups: [], structure: {} };`

4. Add a small id helper and the new functions (append to the file). Use `crypto.randomUUID()` for group keys (available in the browser + Node ≥ 19):

```ts
export function seedStructure(
  state: SheetState,
  table: ParsedTable,
  mode: "new" | "existing",
  existingGroups: { id: string; name: string }[],
): SheetState {
  // Idempotent: don't reseed if the user already organized this sheet.
  if (state.groups.length > 0) return state;

  const first: ImportGroup =
    mode === "existing" && existingGroups[0]
      ? {
          key: crypto.randomUUID(),
          name: existingGroups[0].name,
          existingGroupId: existingGroups[0].id,
        }
      : { key: crypto.randomUUID(), name: "Imported", existingGroupId: null };

  const structure: SheetState["structure"] = {};
  for (const gridIndex of table.rowIndices) {
    if (state.excluded.includes(gridIndex)) continue;
    structure[gridIndex] = { groupKey: first.key, type: "item" };
  }

  return { ...state, groups: [first], structure };
}

export function addGroup(state: SheetState): SheetState {
  const next: ImportGroup = {
    key: crypto.randomUUID(),
    name: `Group ${state.groups.length + 1}`,
    existingGroupId: null,
  };
  return { ...state, groups: [...state.groups, next] };
}

export function renameGroup(
  state: SheetState,
  key: string,
  name: string,
): SheetState {
  return {
    ...state,
    groups: state.groups.map((g) => (g.key === key ? { ...g, name } : g)),
  };
}

/** Reference an existing board group in the group list, adding it if absent.
 * Returns the (possibly new) group's key so a caller can immediately assign
 * rows to it. */
export function useExistingGroup(
  state: SheetState,
  existing: { id: string; name: string },
): { state: SheetState; key: string } {
  const found = state.groups.find((g) => g.existingGroupId === existing.id);
  if (found) return { state, key: found.key };
  const g: ImportGroup = {
    key: crypto.randomUUID(),
    name: existing.name,
    existingGroupId: existing.id,
  };
  return { state: { ...state, groups: [...state.groups, g] }, key: g.key };
}

function patchRows(
  state: SheetState,
  gridIndices: number[],
  patch: Partial<{ groupKey: string; type: "item" | "subitem" }>,
): SheetState {
  const structure = { ...state.structure };
  const fallbackKey = state.groups[0]?.key ?? "";
  for (const gi of gridIndices) {
    const cur = structure[gi] ?? { groupKey: fallbackKey, type: "item" };
    structure[gi] = { ...cur, ...patch };
  }
  return { ...state, structure };
}

export function bulkSetType(
  state: SheetState,
  gridIndices: number[],
  type: "item" | "subitem",
): SheetState {
  return patchRows(state, gridIndices, { type });
}

export function bulkSetGroup(
  state: SheetState,
  gridIndices: number[],
  groupKey: string,
): SheetState {
  return patchRows(state, gridIndices, { groupKey });
}

/** Grid indices of subitem rows that have no item above them in their group
 * (source order) — these block the Structure step. */
export function orphanGridIndices(
  table: ParsedTable,
  state: SheetState,
): number[] {
  const fallbackKey = state.groups[0]?.key ?? "";
  const seenItemInGroup = new Set<string>();
  const orphans: number[] = [];
  for (const gridIndex of table.rowIndices) {
    if (state.excluded.includes(gridIndex)) continue;
    const s = state.structure[gridIndex] ?? {
      groupKey: fallbackKey,
      type: "item" as const,
    };
    if (s.type === "subitem") {
      if (!seenItemInGroup.has(s.groupKey)) orphans.push(gridIndex);
    } else {
      seenItemInGroup.add(s.groupKey);
    }
  }
  return orphans;
}

/** Groups that actually hold ≥1 row, in list order — the commit's `groups`. */
export function buildCommitGroups(state: SheetState): ImportGroup[] {
  const usedKeys = new Set(
    Object.values(state.structure).map((s) => s.groupKey),
  );
  return state.groups.filter((g) => usedKeys.has(g.key));
}

/** One structure entry per non-excluded grid row (defaults applied). */
export function buildCommitStructure(
  table: ParsedTable,
  state: SheetState,
): RowStructureEntry[] {
  const fallbackKey = state.groups[0]?.key ?? "";
  const out: RowStructureEntry[] = [];
  for (const gridIndex of table.rowIndices) {
    if (state.excluded.includes(gridIndex)) continue;
    const s = state.structure[gridIndex] ?? {
      groupKey: fallbackKey,
      type: "item" as const,
    };
    out.push({ gridIndex, groupKey: s.groupKey, type: s.type });
  }
  return out;
}
```

Also update `summarize` (lines 209-241) to count from explicit structure instead of `splitRows2`, so the Confirm step shows correct counts:

```ts
export function summarize(
  table: ParsedTable,
  state: SheetState,
): {
  items: number;
  subitems: number;
  groups: number;
  columns: number;
  invalid: number;
} {
  const orphans = new Set(orphanGridIndices(table, state));
  let items = 0;
  let subitems = 0;
  for (const gridIndex of table.rowIndices) {
    if (state.excluded.includes(gridIndex)) continue;
    const s = state.structure[gridIndex];
    if (s?.type === "subitem" && !orphans.has(gridIndex)) subitems += 1;
    else items += 1;
  }

  const dataColumns = state.columns.filter(
    (c) => c.include && c.role === "data" && c.target !== "skip",
  );
  const invalid = invalidCellMap(table, state.columns);
  const invalidCount = [...invalid.values()].reduce(
    (sum, o) => sum + o.length,
    0,
  );

  return {
    items,
    subitems,
    columns: dataColumns.length,
    groups: buildCommitGroups(state).length,
    invalid: invalidCount,
  };
}
```

(`summarize`'s return type gains `groups`; update the `ConfirmStep` summary line in Task 9. The old `splitRows2` import in this file is now unused — remove it from the imports.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/boards/import/import-wizard-state.structure.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck the touched module's consumers**

Run: `pnpm vitest run src/components/boards/import` — the existing wizard-state tests still pass with the new `SheetState` fields defaulted.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/import/import-wizard-state.ts src/components/boards/import/import-wizard-state.structure.test.ts
git commit -m "feat(import): model per-row structure state, seeding, and bulk helpers"
```

---

## Task 3: New-board payload builder (`buildImportPayloadV3`)

**Files:**

- Modify: `src/lib/boards/spreadsheet/build-import-payload.ts`
- Test: `src/lib/boards/spreadsheet/build-import-payload-v3.test.ts` (new)

**Interfaces:**

- Consumes (Task 1): `resolveStructuredRows`, `ResolvedStructure`, `ImportGroup`, `RowStructureEntry`.
- Produces: `buildImportPayloadV3(table: ParsedTable, specs: ColumnSpec[], groups: ImportGroup[], structure: RowStructureEntry[]): ImportPayload` — same `ImportPayload` shape (`templatePayload` + `subitems`) `insertNewBoard` already consumes; feeds the multi-group `create_board_from_template`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/spreadsheet/build-import-payload-v3.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildImportPayloadV3 } from "./build-import-payload";
import type {
  ParsedTable,
  ColumnSpec,
  ImportGroup,
  RowStructureEntry,
} from "./types";

const table: ParsedTable = {
  header: ["Name", "Notes"],
  rows: [
    ["Alpha", "a"],
    ["Beta", "b"],
    ["Gamma", "c"],
  ],
  rowIndices: [1, 2, 3],
};
const specs: ColumnSpec[] = [
  { sourceIndex: 0, name: "Name", kind: "text", options: [], role: "name" },
  { sourceIndex: 1, name: "Notes", kind: "text", options: [], role: "data" },
];
const groups: ImportGroup[] = [
  { key: "g1", name: "Group 1", existingGroupId: null },
  { key: "g2", name: "Group 2", existingGroupId: null },
];
const structure: RowStructureEntry[] = [
  { gridIndex: 1, groupKey: "g1", type: "item" },
  { gridIndex: 2, groupKey: "g1", type: "subitem" },
  { gridIndex: 3, groupKey: "g2", type: "item" },
];

describe("buildImportPayloadV3", () => {
  it("builds multiple groups, items placed in their group, subitem parented", () => {
    const p = buildImportPayloadV3(table, specs, groups, structure);
    expect(p.templatePayload.groups.map((g) => g.name)).toEqual([
      "Group 1",
      "Group 2",
    ]);
    // items: Alpha (g1), Gamma (g2)
    expect(p.templatePayload.items.map((i) => i.name)).toEqual([
      "Alpha",
      "Gamma",
    ]);
    const g1Id = p.templatePayload.groups[0].id;
    const g2Id = p.templatePayload.groups[1].id;
    expect(p.templatePayload.items[0].groupId).toBe(g1Id);
    expect(p.templatePayload.items[1].groupId).toBe(g2Id);
    // subitem Beta -> parent Alpha, in g1
    expect(p.subitems).toHaveLength(1);
    expect(p.subitems[0]).toMatchObject({
      name: "Beta",
      groupId: g1Id,
      parentId: p.templatePayload.items[0].id,
    });
  });

  it("only builds data columns, skipping 'skip' targets", () => {
    const p = buildImportPayloadV3(table, specs, groups, structure);
    expect(p.templatePayload.columns.map((c) => c.name)).toEqual(["Notes"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/boards/spreadsheet/build-import-payload-v3.test.ts`
Expected: FAIL — `buildImportPayloadV3` not exported.

- [ ] **Step 3: Implement `buildImportPayloadV3`**

Append to `build-import-payload.ts` (after `buildImportPayloadV2`). It mirrors V2 but sources groups/items/subitems from `resolveStructuredRows`:

```ts
export function buildImportPayloadV3(
  table: ParsedTable,
  specs: ColumnSpec[],
  groups: ImportGroup[],
  structure: RowStructureEntry[],
): ImportPayload {
  const nameSpec = specs.find((s) => s.role === "name");
  if (!nameSpec) throw new Error("no name column");
  const dataSpecs = specs.filter(
    (s) => s.role === "data" && s.target !== "skip",
  );

  const resolved = resolveStructuredRows(
    table,
    nameSpec.sourceIndex,
    groups,
    structure,
  );

  // New board => every group is freshly minted.
  const groupIdByKey = new Map(
    resolved.groups.map((g) => [g.key, crypto.randomUUID()] as const),
  );
  const columnIds = dataSpecs.map(() => crypto.randomUUID());
  const itemIds = resolved.items.map(() => crypto.randomUUID());

  const buildCells = (row: string[]) => {
    const cells: { columnId: string; value: Json }[] = [];
    dataSpecs.forEach((spec, i) => {
      const value = textToCell(
        spec.kind,
        row[spec.sourceIndex] ?? "",
        spec.options,
      );
      if (value !== null) cells.push({ columnId: columnIds[i], value });
    });
    return cells;
  };

  return {
    templatePayload: {
      groups: resolved.groups.map((g, i) => ({
        id: groupIdByKey.get(g.key)!,
        name: g.name,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
        position: i,
      })),
      columns: dataSpecs.map((spec, i) => ({
        id: columnIds[i],
        kind: spec.kind,
        name: spec.name,
        settings:
          spec.options.length > 0
            ? ({ options: spec.options } as Json)
            : ({} as Json),
        position: i,
      })),
      items: resolved.items.map((item, i) => ({
        id: itemIds[i],
        groupId: groupIdByKey.get(item.groupKey)!,
        name: item.name,
        position: i,
        cells: buildCells(item.row),
      })),
    },
    subitems: resolved.subitems.map((sub, i) => ({
      id: crypto.randomUUID(),
      parentId: itemIds[sub.parentIndex],
      groupId: groupIdByKey.get(sub.groupKey)!,
      name: sub.name,
      position: i,
      cells: buildCells(sub.row),
    })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/boards/spreadsheet/build-import-payload-v3.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/spreadsheet/build-import-payload.ts src/lib/boards/spreadsheet/build-import-payload-v3.test.ts
git commit -m "feat(import): build new-board payload from explicit multi-group structure"
```

---

## Task 4: Existing-board payload builder — multi-group `buildAppendPayload`

Rewrite `buildAppendPayload` to emit a `groups` array (mixed existing + new) and per-item/subitem `groupId`. This is the payload the rewritten RPC (Task 6) consumes.

**Files:**

- Modify: `src/lib/boards/spreadsheet/build-append-payload.ts`
- Test: `src/lib/boards/spreadsheet/build-append-payload.test.ts` (new or extend if present)

**Interfaces:**

- Consumes (Task 1): `resolveStructuredRows`, `ImportGroup`, `RowStructureEntry`.
- Produces: new `AppendPayload` shape and
  `buildAppendPayload(table, specs, boardColumns, groups, structure): AppendPayload`.

New `AppendPayload`:

```ts
export type AppendPayload = {
  groups: {
    id: string; // existing group's id, OR a freshly-minted uuid
    existingGroupId: string | null; // null => create; set => reuse (== id)
    name: string;
    color: string;
    position: number;
  }[];
  newColumns: {
    id: string;
    kind: ImportableKind;
    name: string;
    settings: Json;
    position: number;
  }[];
  optionAdditions: { columnId: string; options: SynthOption[] }[];
  items: {
    id: string;
    groupId: string;
    name: string;
    position: number;
    cells: { columnId: string; value: Json }[];
  }[];
  subitems: {
    id: string;
    parentId: string;
    groupId: string;
    name: string;
    position: number;
    cells: { columnId: string; value: Json }[];
  }[];
};
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/spreadsheet/build-append-payload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAppendPayload } from "./build-append-payload";
import type {
  ParsedTable,
  ColumnSpec,
  ImportGroup,
  RowStructureEntry,
} from "./types";
import type { BoardColumnRef } from "./match-columns";

const table: ParsedTable = {
  header: ["Name", "Notes"],
  rows: [
    ["Alpha", "a"],
    ["Beta", "b"],
    ["Gamma", "c"],
  ],
  rowIndices: [1, 2, 3],
};
const specs: ColumnSpec[] = [
  { sourceIndex: 0, name: "Name", kind: "text", options: [], role: "name" },
  {
    sourceIndex: 1,
    name: "Notes",
    kind: "text",
    options: [],
    role: "data",
    target: "create",
  },
];
const boardColumns: BoardColumnRef[] = [];
const groups: ImportGroup[] = [
  { key: "g1", name: "Backlog", existingGroupId: "board-grp-a" }, // existing
  { key: "g2", name: "New Wave", existingGroupId: null }, // new
];
const structure: RowStructureEntry[] = [
  { gridIndex: 1, groupKey: "g1", type: "item" },
  { gridIndex: 2, groupKey: "g1", type: "subitem" },
  { gridIndex: 3, groupKey: "g2", type: "item" },
];

describe("buildAppendPayload (multi-group)", () => {
  it("emits existing + new groups and places items/subitems by groupId", () => {
    const p = buildAppendPayload(table, specs, boardColumns, groups, structure);

    const existing = p.groups.find((g) => g.existingGroupId === "board-grp-a")!;
    const created = p.groups.find((g) => g.existingGroupId === null)!;
    expect(existing.id).toBe("board-grp-a"); // reuse: id == existing group id
    expect(created.id).not.toBe("board-grp-a");

    expect(p.items.map((i) => i.name)).toEqual(["Alpha", "Gamma"]);
    expect(p.items[0].groupId).toBe("board-grp-a");
    expect(p.items[1].groupId).toBe(created.id);

    expect(p.subitems).toHaveLength(1);
    expect(p.subitems[0]).toMatchObject({
      name: "Beta",
      groupId: "board-grp-a",
      parentId: p.items[0].id,
    });

    expect(p.newColumns.map((c) => c.name)).toEqual(["Notes"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/boards/spreadsheet/build-append-payload.test.ts`
Expected: FAIL — signature mismatch (old `buildAppendPayload` takes a single `group`).

- [ ] **Step 3: Rewrite `buildAppendPayload`**

Replace the file's `AppendPayload` type and `buildAppendPayload` with the multi-group version. Keep the existing column-resolution loop (targets, kind compat, option additions) verbatim — only the group/item/subitem construction changes. Replace the top-of-function `splitRows2` call and the group/items/subitems tail:

```ts
import { resolveStructuredRows } from "./build-import-payload";
import type { ImportGroup, RowStructureEntry } from "./types";
// (drop the `splitRows2` import — no longer used here)

export function buildAppendPayload(
  table: ParsedTable,
  specs: ColumnSpec[],
  boardColumns: BoardColumnRef[],
  groups: ImportGroup[],
  structure: RowStructureEntry[],
): AppendPayload {
  const nameSpec = specs.find((s) => s.role === "name");
  if (!nameSpec) throw new Error("no name column");

  const dataSpecs = specs.filter(
    (s) => s.role === "data" && s.target !== "skip",
  );

  const resolved = resolveStructuredRows(
    table,
    nameSpec.sourceIndex,
    groups,
    structure,
  );

  // Existing group => reuse its id; new group => mint one. Items reference
  // groupId == this id in both cases (the RPC creates new ones, validates
  // reused ones).
  const groupIdByKey = new Map(
    resolved.groups.map(
      (g) => [g.key, g.existingGroupId ?? crypto.randomUUID()] as const,
    ),
  );

  const boardColumnsById = new Map(boardColumns.map((c) => [c.id, c]));

  type Resolved = {
    columnId: string;
    kind: ImportableKind;
    options: SynthOption[];
    sourceIndex: number;
  };
  const newColumns: AppendPayload["newColumns"] = [];
  const optionAdditions: AppendPayload["optionAdditions"] = [];
  const resolvedCols: Resolved[] = [];

  let newColumnPosition = 0;
  for (const spec of dataSpecs) {
    const target = spec.target;
    if (target === undefined || target === "create") {
      const id = crypto.randomUUID();
      newColumns.push({
        id,
        kind: spec.kind,
        name: spec.name,
        settings: (spec.options.length > 0
          ? { options: spec.options }
          : {}) as Json,
        position: newColumnPosition++,
      });
      resolvedCols.push({
        columnId: id,
        kind: spec.kind,
        options: spec.options,
        sourceIndex: spec.sourceIndex,
      });
      continue;
    }
    if (target === "skip") continue;
    const boardColumn = boardColumnsById.get(target.columnId);
    if (!boardColumn) throw new Error("unknown target column");
    if (!isImportableKind(boardColumn.kind))
      throw new Error("incompatible column kind");
    const targetKind = boardColumn.kind;

    let mergedOptions = boardColumn.options;
    if (targetKind === "status" || targetKind === "dropdown") {
      const rawValues = [
        ...resolved.items.map((it) => it.row[spec.sourceIndex] ?? ""),
        ...resolved.subitems.map((s) => s.row[spec.sourceIndex] ?? ""),
      ];
      const missingLabels = missingOptionLabels(
        rawValues,
        targetKind,
        boardColumn,
      );
      if (missingLabels.length > 0) {
        const minted: SynthOption[] = [];
        for (const label of missingLabels) {
          const usedColors = [
            ...boardColumn.options.map((o) => o.color),
            ...minted.map((o) => o.color),
          ];
          minted.push({
            id: crypto.randomUUID(),
            label,
            color: nextOptionColor(usedColors),
          });
        }
        optionAdditions.push({ columnId: boardColumn.id, options: minted });
        mergedOptions = [...boardColumn.options, ...minted];
      }
    }
    resolvedCols.push({
      columnId: boardColumn.id,
      kind: targetKind,
      options: mergedOptions,
      sourceIndex: spec.sourceIndex,
    });
  }

  const buildCells = (row: string[]) => {
    const cells: { columnId: string; value: Json }[] = [];
    for (const r of resolvedCols) {
      const value = textToCell(r.kind, row[r.sourceIndex] ?? "", r.options);
      if (value !== null) cells.push({ columnId: r.columnId, value });
    }
    return cells;
  };

  const itemIds = resolved.items.map(() => crypto.randomUUID());

  return {
    groups: resolved.groups.map((g, i) => ({
      id: groupIdByKey.get(g.key)!,
      existingGroupId: g.existingGroupId,
      name: g.name,
      color: GROUP_COLORS[i % GROUP_COLORS.length],
      position: i,
    })),
    newColumns,
    optionAdditions,
    items: resolved.items.map((item, i) => ({
      id: itemIds[i],
      groupId: groupIdByKey.get(item.groupKey)!,
      name: item.name,
      position: i,
      cells: buildCells(item.row),
    })),
    subitems: resolved.subitems.map((sub, i) => ({
      id: crypto.randomUUID(),
      parentId: itemIds[sub.parentIndex],
      groupId: groupIdByKey.get(sub.groupKey)!,
      name: sub.name,
      position: i,
      cells: buildCells(sub.row),
    })),
  };
}
```

Change the `GROUP_COLORS` usage: the top of the file already imports `GROUP_COLORS`. Index colors only for **new** groups if you prefer, but `i % GROUP_COLORS.length` is fine — existing groups ignore the `color` field in the RPC.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/boards/spreadsheet/build-append-payload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/spreadsheet/build-append-payload.ts src/lib/boards/spreadsheet/build-append-payload.test.ts
git commit -m "feat(import): rewrite append payload for multiple target groups"
```

---

## Task 5: Zod — `commitImportSchema` gains `groups`/`structure`

**Files:**

- Modify: `src/lib/validations/board-spreadsheet.ts`
- Test: `src/lib/validations/board-spreadsheet.test.ts` (new or extend)

**Interfaces:**

- Consumes: nothing new (Zod is self-contained).
- Produces: `commitImportSchema` accepting `groups: ImportGroup[]` and `structure: RowStructureEntry[]`; `CommitImportInput` type updated. The `"group"` column-role rules are removed (grouping is no longer column-driven); `columnRole` keeps `"group"` as an accepted-but-unused literal so old data doesn't hard-fail parsing, but a `superRefine` rejects any `role === "group"` column with a clear message.

- [ ] **Step 1: Write the failing test**

Create `src/lib/validations/board-spreadsheet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { commitImportSchema } from "./board-spreadsheet";

const base = {
  fileBase64: "eA==",
  fileName: "x.csv",
  sheetName: "Sheet1",
  headerRow: 0,
  excludedRows: [] as number[],
  columns: [
    { sourceIndex: 0, name: "Name", kind: "text", options: [], role: "name" },
  ],
  groups: [{ key: "g1", name: "Imported", existingGroupId: null }],
  structure: [{ gridIndex: 1, groupKey: "g1", type: "item" }],
  destination: {
    type: "new",
    workspaceId: "11111111-1111-1111-1111-111111111111",
    boardName: "B",
  },
};

describe("commitImportSchema", () => {
  it("accepts a valid new-board structured payload", () => {
    expect(commitImportSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a structure row whose groupKey isn't in groups", () => {
    const bad = {
      ...base,
      structure: [{ gridIndex: 1, groupKey: "nope", type: "item" }],
    };
    expect(commitImportSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a 'group' role column", () => {
    const bad = {
      ...base,
      columns: [
        ...base.columns,
        {
          sourceIndex: 1,
          name: "Phase",
          kind: "text",
          options: [],
          role: "group",
        },
      ],
    };
    expect(commitImportSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/validations/board-spreadsheet.test.ts`
Expected: FAIL — schema has no `groups`/`structure`.

- [ ] **Step 3: Update the schema**

In `board-spreadsheet.ts`:

1. Add group/structure schemas before `commitImportSchema`:

```ts
const importGroup = z.object({
  key: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  existingGroupId: uuid.nullable(),
});

const rowStructureEntry = z.object({
  gridIndex: z.number().int().min(0),
  groupKey: z.string().min(1),
  type: z.enum(["item", "subitem"]),
});
```

2. Add the two fields to the `commitImportSchema` object body (alongside `columns`):

```ts
    groups: z.array(importGroup).min(1),
    structure: z.array(rowStructureEntry),
```

3. In the `superRefine`, **replace** the two `role === "group"` blocks (the existing-board rejection and the `groupCount > 1` check) with a single rule that rejects any `"group"` column in either mode, and add a groups/structure cross-check:

```ts
// Grouping is set in the Structure step, never via a column role.
if (data.columns.some((c) => c.role === "group")) {
  ctx.addIssue({
    code: "custom",
    message:
      'Column role "group" is no longer supported; assign groups in the Structure step.',
    path: ["columns"],
  });
}

// Every structure row must reference a declared group key.
const groupKeys = new Set(data.groups.map((g) => g.key));
if (data.structure.some((s) => !groupKeys.has(s.groupKey))) {
  ctx.addIssue({
    code: "custom",
    message: "Every structured row must reference a declared group.",
    path: ["structure"],
  });
}
```

(Keep the existing `nameCount !== 1`, the existing-board `missingTarget` check, and the distinct-`sourceIndex` check unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/validations/board-spreadsheet.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/board-spreadsheet.ts src/lib/validations/board-spreadsheet.test.ts
git commit -m "feat(import): validate groups and per-row structure in commit schema"
```

---

## Task 6: Migration — multi-group `import_rows_into_board`

**Files:**

- Create: `supabase/migrations/20260705120000_import_rows_multi_group.sql`
- Modify (regenerated, not hand-edited): `src/types/database.types.ts`

**Interfaces:**

- Consumes: the Task 4 `AppendPayload` shape (`groups[]`, per-item `groupId`, per-subitem `groupId`).
- Produces: `import_rows_into_board(uuid, jsonb)` — same signature, new payload contract.

The new payload contract:

```
{
  "groups": [{"id","existingGroupId"|null,"name","color","position"}],
  "newColumns": [...],           -- unchanged
  "optionAdditions": [...],      -- unchanged
  "items": [{"id","groupId","name","position","cells":[...]}],
  "subitems": [{"id","parentId","groupId","name","position","cells":[...]}]
}
```

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260705120000_import_rows_multi_group.sql`. Read the current definition in `20260703110000_import_rows_into_board.sql` first — this `create or replace` keeps every membership/edit guard and the subitem-parent + cell-column guards, and only swaps single-group resolution for a `groups[]` loop and per-item `groupId`:

```sql
-- import_rows_into_board (multi-group): the Import Wizard's Structure step lets
-- a user distribute imported rows across MULTIPLE groups (a mix of existing
-- board groups and freshly-created ones). This replaces the single-group
-- resolution of 20260703110000: the payload now carries a `groups` array and
-- each item/subitem carries its own `groupId`. New groups (existingGroupId
-- null) are created appended after the board's existing groups; referenced
-- existing groups are validated to belong to the board. All other behavior
-- (membership/edit guards, append positions, subitem-parent + cell-column
-- confinement) is preserved.
--
-- Payload shape:
-- {
--   "groups": [{"id","existingGroupId"|null,"name","color","position"}],
--   "newColumns": [{"id","kind","name","settings","position"}],
--   "optionAdditions": [{"columnId","options":[{"id","label","color"}]}],
--   "items": [{"id","groupId","name","position","cells":[{"columnId","value"}]}],
--   "subitems": [{"id","parentId","groupId","name","position","cells":[...]}]
-- }
create or replace function public.import_rows_into_board(
  p_board_id uuid,
  p_payload  jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_max_group_pos double precision;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not public.can_edit_board(p_board_id) then
    raise exception 'not authorized to edit this board' using errcode = '42501';
  end if;

  -- Validate reused existing groups belong to this board.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'groups', '[]'::jsonb)) as g
    where (g->>'existingGroupId') is not null
      and not exists (
        select 1 from public.groups
        where id = (g->>'existingGroupId')::uuid and board_id = p_board_id
      )
  ) then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  -- Every item/subitem groupId must be one of the payload's group ids.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i
    where (i->>'groupId') not in (
      select g->>'id' from jsonb_array_elements(coalesce(p_payload->'groups','[]'::jsonb)) as g
    )
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s
    where (s->>'groupId') not in (
      select g->>'id' from jsonb_array_elements(coalesce(p_payload->'groups','[]'::jsonb)) as g
    )
  ) then
    raise exception 'row group not in payload' using errcode = '22023';
  end if;

  -- Subitem parents must be items minted in this same payload.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s
    where s->>'parentId' not in (
      select i->>'id' from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i
    )
  ) then
    raise exception 'subitem parent not in payload' using errcode = '22023';
  end if;

  -- 1. Create new groups (existingGroupId null), appended after the board's
  --    current max group position, preserving payload order.
  select coalesce(max(position), -1) into v_max_group_pos
  from public.groups where board_id = p_board_id;

  insert into public.groups (id, org_id, board_id, name, color, position)
  select
    (g->>'id')::uuid,
    v_org_id, p_board_id,
    g->>'name',
    coalesce(g->>'color', '#0073ea'),
    v_max_group_pos + row_number() over (order by (g->>'position')::double precision)
  from jsonb_array_elements(coalesce(p_payload->'groups', '[]'::jsonb)) as g
  where (g->>'existingGroupId') is null;

  -- 2. New columns (unchanged from the single-group version).
  insert into public.columns (id, org_id, board_id, kind, name, settings, position)
  select
    (c->>'id')::uuid,
    v_org_id, p_board_id,
    (c->>'kind')::public.column_kind,
    c->>'name',
    coalesce(c->'settings', '{}'::jsonb),
    (select coalesce(max(position), 0) from public.columns where board_id = p_board_id)
      + row_number() over (order by (c->>'position')::double precision)
  from jsonb_array_elements(coalesce(p_payload->'newColumns', '[]'::jsonb)) as c;

  -- 3. Option additions (unchanged).
  update public.columns col
  set settings = jsonb_set(
    col.settings, '{options}',
    coalesce(col.settings->'options', '[]'::jsonb) || coalesce(oa->'options', '[]'::jsonb)
  )
  from jsonb_array_elements(coalesce(p_payload->'optionAdditions', '[]'::jsonb)) as oa
  where col.id = (oa->>'columnId')::uuid and col.board_id = p_board_id;

  -- 4. Items into their OWN group, appended after that group's existing
  --    top-level items, offset by the payload position.
  insert into public.items (id, org_id, board_id, group_id, name, position)
  select
    (i->>'id')::uuid,
    v_org_id, p_board_id, (i->>'groupId')::uuid,
    i->>'name',
    (select coalesce(max(position) + 1, 0) from public.items
       where group_id = (i->>'groupId')::uuid and parent_id is null)
      + (i->>'position')::double precision
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i;

  -- 5. Subitems, parented to their payload parentId, in their own group.
  insert into public.items (id, org_id, board_id, group_id, parent_id, name, position)
  select
    (s->>'id')::uuid,
    v_org_id, p_board_id, (s->>'groupId')::uuid,
    (s->>'parentId')::uuid,
    s->>'name',
    (select coalesce(max(position) + 1, 0) from public.items
       where parent_id = (s->>'parentId')::uuid)
      + (s->>'position')::double precision
  from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s;

  -- Every cell must reference a column of THIS board (unchanged).
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i
    cross join lateral jsonb_array_elements(coalesce(i->'cells', '[]'::jsonb)) as cell
    where not exists (
      select 1 from public.columns c
      where c.id = (cell->>'columnId')::uuid and c.board_id = p_board_id
    )
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s
    cross join lateral jsonb_array_elements(coalesce(s->'cells', '[]'::jsonb)) as cell
    where not exists (
      select 1 from public.columns c
      where c.id = (cell->>'columnId')::uuid and c.board_id = p_board_id
    )
  ) then
    raise exception 'cell column not on board' using errcode = '22023';
  end if;

  -- 6. Cell values for every item + subitem (unchanged).
  insert into public.cell_values (org_id, board_id, item_id, column_id, value)
  select v_org_id, p_board_id, (i->>'id')::uuid, (cell->>'columnId')::uuid, cell->'value'
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i
  cross join lateral jsonb_array_elements(coalesce(i->'cells', '[]'::jsonb)) as cell
  union all
  select v_org_id, p_board_id, (s->>'id')::uuid, (cell->>'columnId')::uuid, cell->'value'
  from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s
  cross join lateral jsonb_array_elements(coalesce(s->'cells', '[]'::jsonb)) as cell;
end; $$;

-- Preserve the definer-execution hygiene from 20260704114000: authenticated
-- may execute; anon/public may not.
revoke execute on function public.import_rows_into_board(uuid, jsonb) from public, anon;
grant execute on function public.import_rows_into_board(uuid, jsonb) to authenticated;
```

- [ ] **Step 2: Commit the migration file** (before applying — so it's versioned)

```bash
git add supabase/migrations/20260705120000_import_rows_multi_group.sql
git commit -m "feat(import): migration to append imported rows into multiple groups"
```

- [ ] **Step 3: MANUAL GATE — user applies the migration**

The agent cannot run `db push`/DDL (classifier blocks it — see `migration-apply-blocked-by-classifier`). Ask the user to apply `20260705120000_import_rows_multi_group.sql` against the **dev** project (label `hjqca…` per `supabase-env-labels-inverted` — dev holds the data, despite `.mcp.json` labels reading backwards). Confirm it applied cleanly before proceeding.

- [ ] **Step 4: Regenerate types**

Run: `pnpm db:types`
Then verify only expected drift:

Run: `git diff --stat src/types/database.types.ts`
(The RPC arg/return types for `import_rows_into_board` are unchanged — signature is identical — so this diff may be empty; that's fine.)

- [ ] **Step 5: Commit regenerated types (if changed)**

```bash
git add src/types/database.types.ts
git commit -m "chore(import): regenerate types after multi-group import RPC"
```

---

## Task 7: Server action — wire `commitImport` to structure

**Files:**

- Modify: `src/lib/boards/spreadsheet-actions.ts`
- Test: `src/lib/boards/spreadsheet-actions.structure.test.ts` (new — unit-level, covering the structure validation helper)

**Interfaces:**

- Consumes: `buildImportPayloadV3` (Task 3), the multi-group `buildAppendPayload` (Task 4), `commitImportSchema` (Task 5).
- Produces: `commitImport` accepts `groups`/`structure`; both destination arms use the structured builders.

- [ ] **Step 1: Write the failing test (structure validation helper)**

Create `src/lib/boards/spreadsheet-actions.structure.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findStructureValidationError } from "./spreadsheet-actions";
import type {
  ParsedTable,
  ImportGroup,
  RowStructureEntry,
} from "./spreadsheet/types";

const table: ParsedTable = {
  header: ["Name"],
  rows: [["A"], ["B"]],
  rowIndices: [1, 2],
};
const groups: ImportGroup[] = [
  { key: "g1", name: "G1", existingGroupId: null },
];

describe("findStructureValidationError", () => {
  it("returns null when every subitem has a parent above it", () => {
    const structure: RowStructureEntry[] = [
      { gridIndex: 1, groupKey: "g1", type: "item" },
      { gridIndex: 2, groupKey: "g1", type: "subitem" },
    ];
    expect(findStructureValidationError(table, groups, structure)).toBeNull();
  });

  it("returns a row-numbered error for an orphan subitem", () => {
    const structure: RowStructureEntry[] = [
      { gridIndex: 1, groupKey: "g1", type: "subitem" }, // orphan
      { gridIndex: 2, groupKey: "g1", type: "item" },
    ];
    const err = findStructureValidationError(table, groups, structure);
    expect(err).toMatch(/row 2/); // gridIndex 1 -> 1-based row 2
    expect(err).toMatch(/subitem/i);
  });
});
```

(Note: `gridIndex` is 0-based over the raw grid; the 1-based label is `gridIndex + 1`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/boards/spreadsheet-actions.structure.test.ts`
Expected: FAIL — `findStructureValidationError` not exported.

- [ ] **Step 3: Implement the action changes**

In `spreadsheet-actions.ts`:

1. Update imports: add `buildImportPayloadV3` (from `build-import-payload`), and `ImportGroup`, `RowStructureEntry` (from `./spreadsheet/types`).

2. Add the validation helper (near `findNameValidationError`):

```ts
/**
 * Orphan-subitem guard mirroring the client's `orphanGridIndices`: a subitem
 * with no item above it in the same group has no parent to attach to. The
 * client blocks this, but validate server-side too so a stale/forged payload
 * gets a friendly, row-numbered error instead of a promoted-silently import.
 */
export function findStructureValidationError(
  table: ParsedTable,
  groups: ImportGroup[],
  structure: RowStructureEntry[],
): string | null {
  const byGrid = new Map(structure.map((s) => [s.gridIndex, s]));
  const fallbackKey = groups[0]?.key ?? "";
  const seenItemInGroup = new Set<string>();
  const orphanRows: number[] = [];

  for (const gridIndex of table.rowIndices) {
    const entry = byGrid.get(gridIndex) ?? {
      groupKey: fallbackKey,
      type: "item" as const,
    };
    if (entry.type === "subitem") {
      if (!seenItemInGroup.has(entry.groupKey)) orphanRows.push(gridIndex + 1);
    } else {
      seenItemInGroup.add(entry.groupKey);
    }
  }

  if (orphanRows.length === 0) return null;
  const shown = orphanRows.slice(0, 5).map((n) => `row ${n}`);
  const extra = orphanRows.length - shown.length;
  const list =
    extra > 0 ? `${shown.join(", ")}, +${extra} more` : shown.join(", ");
  return `${orphanRows.length} subitem row(s) have no item above them in their group (${list}). Make them items or move them under an item.`;
}
```

3. Change `appendToExistingBoard`'s signature to take `groups`/`structure` instead of `group`, and pass them to `buildAppendPayload`:

```ts
async function appendToExistingBoard(
  supabase: SupabaseServerClient,
  boardId: string,
  table: ParsedTable,
  specs: ColumnSpec[],
  groups: ImportGroup[],
  structure: RowStructureEntry[],
): Promise<{ ok: true; boardId: string } | { ok: false; error: string }> {
  // …unchanged column fetch + kind-compat checks…
  let payload;
  try {
    payload = buildAppendPayload(table, specs, boardColumns, groups, structure);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  const { error: rpcError } = await supabase.rpc("import_rows_into_board", {
    p_board_id: boardId,
    p_payload: payload as unknown as Json,
  });
  if (rpcError) return { ok: false, error: rpcError.message };
  return { ok: true, boardId };
}
```

4. Update the `commitImport` signature and body:

```ts
export async function commitImport(input: {
  fileBase64: string;
  fileName: string;
  sheetName: string;
  headerRow: number | null;
  excludedRows: number[];
  columns: ColumnSpec[];
  groups: ImportGroup[];
  structure: RowStructureEntry[];
  destination: ImportDestination;
}): Promise<ActionResult<{ boardId: string }>> {
  // …unchanged: schema parse, guardFile, parse, selectRows, caps, sourceIndex bound, name validation…

  const structureError = findStructureValidationError(
    table,
    parsed.data.groups,
    parsed.data.structure,
  );
  if (structureError) return fail(structureError);

  const supabase = await createClient();

  if (parsed.data.destination.type === "existing") {
    const result = await appendToExistingBoard(
      supabase,
      parsed.data.destination.boardId,
      table,
      parsed.data.columns,
      parsed.data.groups,
      parsed.data.structure,
    );
    if (!result.ok) return fail(result.error);
    revalidatePath(`/boards/${result.boardId}`);
    return { ok: true, data: { boardId: result.boardId } };
  }

  const payload = buildImportPayloadV3(
    table,
    parsed.data.columns,
    parsed.data.groups,
    parsed.data.structure,
  );
  const result = await insertNewBoard(
    supabase,
    parsed.data.destination.workspaceId,
    parsed.data.destination.boardName,
    payload,
  );
  if (!result.ok) return fail(result.error);
  revalidatePath("/", "layout");
  return { ok: true, data: { boardId: result.boardId } };
}
```

5. Update `findNameValidationError` to NOT strip the subtask marker (names import verbatim now): replace the `name` derivation (lines ~111-114) with `const name = (row[nameSpec.sourceIndex] ?? "").trim();` and drop the now-unused `SUBTASK_MARKER` import if nothing else references it. The `ImportDestination` `existing` arm still carries `group` in `types.ts` — remove that field (Task 9 stops sending it); update `types.ts` `ImportDestination.existing` to drop `group` and the Zod `importDestination` existing arm to drop `group`.

Wait — the Zod `importDestination` existing arm currently requires `group`. Remove it there too (Task 5 covered adding groups/structure; fold this `destination.group` removal into Task 5's edit if executing them together, otherwise do it here). After removal, `ImportDestination` existing = `{ type: "existing"; boardId: string }`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/boards/spreadsheet-actions.structure.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (Errors here will point at `ImportWizard.tsx` still calling the old `commitImport`/`buildImportPayloadV2` shape — those are fixed in Task 9. If executing strictly task-by-task, expect ImportWizard typecheck errors until Task 9; run `pnpm typecheck` green only after Task 9.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/spreadsheet-actions.ts src/lib/boards/spreadsheet/types.ts src/lib/validations/board-spreadsheet.ts src/lib/boards/spreadsheet-actions.structure.test.ts
git commit -m "feat(import): commit action consumes explicit groups and structure"
```

---

## Task 8: Pinned footer + wider modal (UI-only, no Structure step yet)

Refactor the wizard chrome so the primary action is always visible and the modal is larger. Keep three steps for now; Task 9 inserts the Structure step. **Load the `pulse-ui` and `frontend-design` skills before editing UI.**

**Files:**

- Modify: `src/components/boards/import/ImportWizard.tsx`
- Modify: `src/components/boards/import/MapStep.tsx` (remove its nav row)
- Modify: `src/components/boards/import/ConfirmStep.tsx` (remove its nav row)

**Interfaces:**

- Produces: `ImportWizard` renders a single pinned footer (`WizardFooter`) driven by `step`; step components no longer render Back/Next/Confirm.

- [ ] **Step 1: Widen + restructure `DialogContent`**

In `ImportWizard.tsx`, change line 261:

```tsx
<DialogContent className="flex h-[90vh] w-[95vw] flex-col gap-0 p-0 sm:max-w-[1400px]">
```

Wrap the header, a scrollable body, and a pinned footer. Replace the `<DialogHeader>…</DialogHeader>` + `<div className="flex-1 overflow-y-auto">…</div>` region so the structure is:

```tsx
<DialogHeader className="shrink-0 border-b px-6 py-4">
  <DialogTitle>Import from file</DialogTitle>
  <StepIndicator step={step} />
</DialogHeader>

<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
  {/* step 1 / 2 / 3 content — unchanged except steps no longer render nav */}
</div>

<WizardFooter
  step={step}
  busy={busy || isPending}
  nextDisabled={!hasNameColumn || activeSheetEmpty || overRowCap}
  confirmDisabled={
    isPending ||
    (destination.type === "new" && boardName.trim() === "")
  }
  onBack={() => setStep((s) => (s === 1 ? s : ((s - 1) as 1 | 2 | 3)))}
  onNext={handleNext}
  onConfirm={handleConfirm}
/>
```

- [ ] **Step 2: Add the `WizardFooter` component**

In `ImportWizard.tsx` (above `ImportWizard`):

```tsx
function WizardFooter({
  step,
  busy,
  nextDisabled,
  confirmDisabled,
  onBack,
  onNext,
  onConfirm,
}: {
  step: 1 | 2 | 3;
  busy: boolean;
  nextDisabled: boolean;
  confirmDisabled: boolean;
  onBack: () => void;
  onNext: () => void;
  onConfirm: () => void;
}) {
  if (step === 1) return null; // upload auto-advances; no footer nav
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t px-6 py-4">
      <Button type="button" variant="outline" onClick={onBack}>
        Back
      </Button>
      {step === 3 ? (
        <Button type="button" disabled={confirmDisabled} onClick={onConfirm}>
          {busy ? "Importing…" : "Import"}
        </Button>
      ) : (
        <Button type="button" disabled={nextDisabled} onClick={onNext}>
          Next
        </Button>
      )}
    </div>
  );
}
```

Add `import { Button } from "@/components/ui/button";` if not present.

- [ ] **Step 3: Remove the nav rows from the step components**

- In `MapStep.tsx`: delete the trailing `<div className="flex justify-between pt-2">…Back…Next…</div>` (lines 165-172) and the now-unused `onBack`/`onNext`/`nextDisabled` props from its signature. Keep the `rowCapWarning` and missing-name alert rendering.
- In `ConfirmStep.tsx`: delete the trailing nav `<div className="flex items-center justify-between gap-2 pt-2">…</div>` (lines 256-263) and remove `onBack`/`onConfirm`/`pending` from the render-side nav (the `pending`/`onConfirm` now live in the footer). Keep `error` rendering. Update `ConfirmStepProps` to drop `onBack`/`onConfirm` (keep `pending` only if still used for a body affordance; otherwise drop).

Update `ImportWizard.tsx`'s `<MapStep …>` and `<ConfirmStep …>` call sites to stop passing the removed props.

- [ ] **Step 4: Manual verification (visual)**

Run the app and open the import wizard (see the How-to-test section). Confirm the modal is visibly wider/taller and the Back/Next(/Import) bar stays fixed at the bottom while the grid scrolls.

Run: `pnpm build` (catches the Next.js 16 cacheComponents/Suspense traps).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/import/ImportWizard.tsx src/components/boards/import/MapStep.tsx src/components/boards/import/ConfirmStep.tsx
git commit -m "feat(import): widen the wizard modal and pin the primary action footer"
```

---

## Task 9: Structure step + full wizard wiring

Insert the Structure step as step 3 of 4, wire per-row state, remove the retired "group" column role and the Confirm group picker, and send `groups`/`structure` to `commitImport`. **Load `pulse-ui` + `frontend-design` first.**

**Files:**

- Create: `src/components/boards/import/StructureStep.tsx`
- Modify: `src/components/boards/import/ImportWizard.tsx`
- Modify: `src/components/boards/import/MappingGrid.tsx` (remove "Use as group")
- Modify: `src/components/boards/import/ConfirmStep.tsx` (remove `ExistingGroupFields`)
- Test: `src/components/boards/import/StructureStep.test.tsx` (new — Vitest + @testing-library/react, matching existing component tests in this folder)

**Interfaces:**

- Consumes: Task 2 state helpers (`seedStructure`, `addGroup`, `renameGroup`, `useExistingGroup`, `bulkSetType`, `bulkSetGroup`, `orphanGridIndices`, `buildCommitGroups`, `buildCommitStructure`), Task 7 `commitImport` shape.
- Produces: a `StructureStep` component; a 4-step wizard.

- [ ] **Step 1: Write the failing component test**

Create `src/components/boards/import/StructureStep.test.tsx` (follow the render/query patterns already used by other tests in this folder — check an existing `*.test.tsx` there for the exact `render` import and setup):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StructureStep } from "./StructureStep";
import { deriveSheetState, seedStructure } from "./import-wizard-state";
import type { ParsedTable } from "@/lib/boards/spreadsheet/types";

const grid = [["Name"], ["Alpha"], ["Beta"]];
const table: ParsedTable = {
  header: ["Name"],
  rows: [["Alpha"], ["Beta"]],
  rowIndices: [1, 2],
};

function setup() {
  const seeded = seedStructure(deriveSheetState(grid, 0), table, "new", []);
  return seeded;
}

describe("StructureStep", () => {
  it("renders one row per included row with a Type and Group control", () => {
    const state = setup();
    render(
      <StructureStep
        table={table}
        state={state}
        mode="new"
        existingGroups={[]}
        onStateChange={() => {}}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/type for/i)).toHaveLength(2);
  });

  it("adding a group makes it selectable", () => {
    const state = setup();
    let next = state;
    render(
      <StructureStep
        table={table}
        state={state}
        mode="new"
        existingGroups={[]}
        onStateChange={(s) => (next = s)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add group/i }));
    expect(next.groups).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/boards/import/StructureStep.test.tsx`
Expected: FAIL — `StructureStep` does not exist.

- [ ] **Step 3: Implement `StructureStep.tsx`**

Create the component. It's a controlled component (`state` + `onStateChange`) that renders the row table and a group/bulk toolbar. Selection is local component state.

```tsx
"use client";

import { useMemo, useState } from "react";
import type { ParsedTable } from "@/lib/boards/spreadsheet/types";
import {
  addGroup,
  renameGroup,
  useExistingGroup,
  bulkSetType,
  bulkSetGroup,
  orphanGridIndices,
  type SheetState,
} from "./import-wizard-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const NEW_GROUP_VALUE = "__new__";

export function StructureStep({
  table,
  state,
  mode,
  existingGroups,
  onStateChange,
}: {
  table: ParsedTable;
  state: SheetState;
  mode: "new" | "existing";
  /** Board groups available to target in existing-board mode. */
  existingGroups: { id: string; name: string }[];
  onStateChange: (next: SheetState) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const nameCol = state.columns.find((c) => c.role === "name");
  const nameIndex = nameCol?.sourceIndex ?? 0;
  const fallbackKey = state.groups[0]?.key ?? "";

  const orphans = useMemo(
    () => new Set(orphanGridIndices(table, state)),
    [table, state],
  );

  const rows = table.rows
    .map((row, r) => ({ row, gridIndex: table.rowIndices[r] }))
    .filter(({ gridIndex }) => !state.excluded.includes(gridIndex));

  function toggleSelect(gridIndex: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gridIndex)) next.delete(gridIndex);
      else next.add(gridIndex);
      return next;
    });
  }

  function setRowType(gridIndex: number, type: "item" | "subitem") {
    onStateChange(bulkSetType(state, [gridIndex], type));
  }

  function setRowGroup(gridIndex: number, value: string) {
    if (value === NEW_GROUP_VALUE) {
      const withGroup = addGroup(state);
      const key = withGroup.groups[withGroup.groups.length - 1].key;
      onStateChange(bulkSetGroup(withGroup, [gridIndex], key));
      return;
    }
    // value is a group key OR an existing-board group id (prefixed "ex:")
    if (value.startsWith("ex:")) {
      const ex = existingGroups.find((g) => g.id === value.slice(3));
      if (!ex) return;
      const { state: s2, key } = useExistingGroup(state, ex);
      onStateChange(bulkSetGroup(s2, [gridIndex], key));
      return;
    }
    onStateChange(bulkSetGroup(state, [gridIndex], value));
  }

  const selectedList = [...selected];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onStateChange(addGroup(state))}
        >
          + Add group
        </Button>
        {selectedList.length > 0 ? (
          <>
            <span className="text-muted-foreground text-xs">
              Selected {selectedList.length}:
            </span>
            <select
              aria-label="Bulk set type"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                onStateChange(
                  bulkSetType(
                    state,
                    selectedList,
                    e.target.value as "item" | "subitem",
                  ),
                );
                e.target.value = "";
              }}
              className="h-7 rounded-md border bg-transparent px-1.5 text-xs"
            >
              <option value="">Set type…</option>
              <option value="item">Item</option>
              <option value="subitem">Subitem</option>
            </select>
            <select
              aria-label="Bulk move to group"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                onStateChange(
                  bulkSetGroup(state, selectedList, e.target.value),
                );
                e.target.value = "";
              }}
              className="h-7 rounded-md border bg-transparent px-1.5 text-xs"
            >
              <option value="">Move to group…</option>
              {state.groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      {/* Editable group names */}
      <div className="flex flex-wrap gap-2">
        {state.groups.map((g) => (
          <Input
            key={g.key}
            aria-label={`Group name ${g.name}`}
            value={g.name}
            disabled={g.existingGroupId !== null}
            onChange={(e) =>
              onStateChange(renameGroup(state, g.key, e.target.value))
            }
            className="h-7 w-40 text-xs"
          />
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-muted border-b">
              <th className="w-8 px-2 py-2" aria-hidden />
              <th className="px-2 py-2 text-left font-medium">Type</th>
              <th className="px-2 py-2 text-left font-medium">Group</th>
              <th className="px-2 py-2 text-left font-medium">Name</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, gridIndex }) => {
              const s = state.structure[gridIndex] ?? {
                groupKey: fallbackKey,
                type: "item" as const,
              };
              const isOrphan = orphans.has(gridIndex);
              return (
                <tr key={gridIndex} className="border-b last:border-0">
                  <td className="px-2 py-1.5 align-top">
                    <input
                      type="checkbox"
                      aria-label={`Select row ${gridIndex + 1}`}
                      checked={selected.has(gridIndex)}
                      onChange={() => toggleSelect(gridIndex)}
                      className="accent-primary size-3.5"
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <select
                      aria-label={`Type for row ${gridIndex + 1}`}
                      value={s.type}
                      onChange={(e) =>
                        setRowType(
                          gridIndex,
                          e.target.value as "item" | "subitem",
                        )
                      }
                      className={cn(
                        "h-7 rounded-md border bg-transparent px-1.5 text-xs",
                        isOrphan && "border-destructive text-destructive",
                      )}
                    >
                      <option value="item">Item</option>
                      <option value="subitem">Subitem</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <select
                      aria-label={`Group for row ${gridIndex + 1}`}
                      value={s.groupKey}
                      onChange={(e) => setRowGroup(gridIndex, e.target.value)}
                      className="h-7 rounded-md border bg-transparent px-1.5 text-xs"
                    >
                      {state.groups.map((g) => (
                        <option key={g.key} value={g.key}>
                          {g.name}
                        </option>
                      ))}
                      {mode === "existing"
                        ? existingGroups
                            .filter(
                              (ex) =>
                                !state.groups.some(
                                  (g) => g.existingGroupId === ex.id,
                                ),
                            )
                            .map((ex) => (
                              <option key={ex.id} value={`ex:${ex.id}`}>
                                {ex.name} (board)
                              </option>
                            ))
                        : null}
                      <option value={NEW_GROUP_VALUE}>New group…</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <span className={cn(s.type === "subitem" && "pl-4")}>
                      {s.type === "subitem" ? "↳ " : ""}
                      {row[nameIndex]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {orphans.size > 0 ? (
        <p role="alert" className="text-destructive text-xs">
          {orphans.size} subitem row(s) have no item above them in their group.
          Make them items or move them under an item to continue.
        </p>
      ) : null}
    </div>
  );
}
```

Note: `useExistingGroup` is a plain helper, not a React hook — despite the `use` prefix, it takes `state` and returns `{ state, key }`. If ESLint's react-hooks rule flags the call, rename the helper to `referenceExistingGroup` in Task 2 and here. (Prefer renaming to avoid the lint friction — decide at implementation time and keep both files consistent.)

- [ ] **Step 4: Wire the Structure step into `ImportWizard.tsx`**

- Change `step` state type to `1 | 2 | 3 | 4` and `STEPS` to four entries: Upload / Select & map / Structure / Confirm. Update `StepIndicator`'s prop type accordingly.
- Seed structure when entering step 3. In `handleNext` (currently step 2 → 3), instead go step 2 → 3 after seeding:

```tsx
function handleNext() {
  if (!hasNameColumn || activeSheetEmpty || overRowCap) return;
  if (!table) return;
  const existingGroups =
    destination.type === "existing" ? destination.groups : [];
  setSheetStates((prev) => ({
    ...prev,
    [activeSheet]: seedStructure(
      prev[activeSheet],
      table,
      destination.type,
      existingGroups,
    ),
  }));
  setStep(3);
}
```

- Add a step-3 render block (Structure) and move Confirm to step 4:

```tsx
{
  step === 3 && preview && activeState && table ? (
    <StructureStep
      table={table}
      state={activeState}
      mode={destination.type}
      existingGroups={destination.type === "existing" ? destination.groups : []}
      onStateChange={(next) =>
        setSheetStates((prev) => ({ ...prev, [activeSheet]: next }))
      }
    />
  ) : null;
}

{
  step === 4 && preview && activeSheetPreview && activeState && table ? (
    <ConfirmStep /* …no group picker; new-board name only… */ />
  ) : null;
}
```

- Compute a step-3 gate for the footer: `const structureBlocked = table ? orphanGridIndices(table, activeState).length > 0 : false;`. Extend `WizardFooter` to a `1 | 2 | 3 | 4` step and disable Next on step 3 when `structureBlocked`; Import lives on step 4.
- Update `handleConfirm` to send the new payload fields and drop `destination.group`:

```tsx
const res = await commitImport({
  fileBase64,
  fileName,
  sheetName: preview.sheets[activeSheet].name,
  headerRow: activeState.headerRow,
  excludedRows: activeState.excluded,
  columns: buildCommitColumns(activeState),
  groups: buildCommitGroups(activeState),
  structure: buildCommitStructure(table!, activeState),
  destination:
    destination.type === "new"
      ? { type: "new", workspaceId: destination.workspaceId, boardName }
      : { type: "existing", boardId: destination.boardId },
});
```

- Remove the now-unused `groupChoice`/`defaultGroupChoice`/`GroupChoice` state and imports. Import `seedStructure`, `orphanGridIndices`, `buildCommitGroups`, `buildCommitStructure`, `StructureStep`.

- [ ] **Step 5: Remove the retired affordances**

- `MappingGrid.tsx`: delete the "Use as group" `<DropdownMenuItem>` (lines 279-285, the `mode === "existing" ? null : (<DropdownMenuItem …>Use as group…)` block) entirely — grouping is no longer a column role in any mode. The dropdown keeps only "Use as item name" and "Regular column".
- `ConfirmStep.tsx`: delete `ExistingGroupFields` and the `NEW_GROUP_VALUE` const; change the `destination` prop's existing arm to `{ type: "existing" }` (no group props); render only the board-name field (new mode) and summary. Update the summary line to include groups: `{summary.items} items · {summary.subitems} subtasks · {summary.groups} groups · {summary.columns} columns · {summary.invalid} invalid cells → empty`.

- [ ] **Step 6: Run the component test + full gates**

Run: `pnpm vitest run src/components/boards/import/StructureStep.test.tsx`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. (If cold `pnpm typecheck` complains about `cacheLife`/`.next/types`, run `pnpm build` first — see `finish-task-typecheck-before-build-cachelife`.)

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/import/StructureStep.tsx src/components/boards/import/StructureStep.test.tsx src/components/boards/import/ImportWizard.tsx src/components/boards/import/MappingGrid.tsx src/components/boards/import/ConfirmStep.tsx
git commit -m "feat(import): add the Structure step for per-row item/subitem and grouping"
```

---

## Task 10: Integration test — existing-board multi-group append

Requires the Task 6 migration applied to the dev project.

**Files:**

- Modify: `src/lib/boards/import-rows-into-board.integration.test.ts`

**Interfaces:**

- Consumes: the applied `import_rows_into_board` RPC + the multi-group `buildAppendPayload`.

- [ ] **Step 1: Read the existing integration test** to match its provisioning/setup helpers (org + board creation, the `signInWithRetry` pattern — see `integration-test-provisioning-flake`). It runs in the serial integration project.

- [ ] **Step 2: Add a multi-group append case**

Add a test that: creates a board with ≥1 existing group; builds an `AppendPayload` (via `buildAppendPayload`) distributing rows across the existing group + one new group, with a subitem; calls the RPC; then asserts the DB has the rows in the right groups with correct parentage. Model the assertions on the existing single-group case. Example skeleton (adapt to the file's real helpers):

```ts
it("appends imported rows across an existing group and a new group", async () => {
  const { boardId, groupId } = await createBoardWithGroup(/* … */);
  const table = {
    header: ["Name"],
    rows: [["A"], ["B"], ["C"]],
    rowIndices: [1, 2, 3],
  };
  const specs = [
    {
      sourceIndex: 0,
      name: "Name",
      kind: "text",
      options: [],
      role: "name" as const,
    },
  ];
  const groups = [
    { key: "gEx", name: "Existing", existingGroupId: groupId },
    { key: "gNew", name: "Fresh", existingGroupId: null },
  ];
  const structure = [
    { gridIndex: 1, groupKey: "gEx", type: "item" as const },
    { gridIndex: 2, groupKey: "gEx", type: "subitem" as const },
    { gridIndex: 3, groupKey: "gNew", type: "item" as const },
  ];
  const payload = buildAppendPayload(table, specs, [], groups, structure);

  const { error } = await supabase.rpc("import_rows_into_board", {
    p_board_id: boardId,
    p_payload: payload as unknown as Json,
  });
  expect(error).toBeNull();

  // A + subitem B in the existing group; C in a newly-created "Fresh" group.
  const { data: freshGroup } = await supabase
    .from("groups")
    .select("id")
    .eq("board_id", boardId)
    .eq("name", "Fresh")
    .single();
  expect(freshGroup).toBeTruthy();

  const { data: items } = await supabase
    .from("items")
    .select("name, group_id, parent_id")
    .eq("board_id", boardId);
  const a = items!.find((i) => i.name === "A")!;
  const b = items!.find((i) => i.name === "B")!;
  const c = items!.find((i) => i.name === "C")!;
  expect(a.group_id).toBe(groupId);
  expect(b.parent_id).toBe(a.id ?? a["id"]); // adapt to selected columns
  expect(c.group_id).toBe(freshGroup!.id);
});
```

- [ ] **Step 3: Run the integration test**

Run: `pnpm vitest run src/lib/boards/import-rows-into-board.integration.test.ts`
Expected: PASS (may be serial/slow; a GoTrue rate-limit flake is retried per the existing harness).

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/import-rows-into-board.integration.test.ts
git commit -m "test(import): cover multi-group existing-board append end to end"
```

---

## Finish

- [ ] Run the full gates once more from the worktree: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] Run `scripts/finish-task.sh` from inside the worktree (rebases onto `develop`, gates, merges, pushes, cleans up). If it fails on a stale worktree dep, `pnpm install` and re-run (see `finish-task-build-fails-worktree-stale-deps`).
- [ ] Provide the user a numbered "How to test this" walkthrough (below) and include it in the `/wrapup` note.

### How to test this (for the closing message)

1. Pull `develop` and start the app; open a board you can edit → **Import** (or create a new board → Import).
2. Upload a `.csv`/`.xlsx`. Note the modal is now larger and the **Next/Import** button stays pinned at the bottom as you scroll.
3. Step 2 (Map): map columns as before, mark the name column. Click **Next**.
4. Step 3 (Structure): all rows start as **Items** in one group. Click **+ Add group**, rename it, then move some rows into it (per-row Group dropdown or select several rows → **Move to group**). Set a row's type to **Subitem** — it indents under the item above it. Make a subitem with no item above it in its group and confirm **Next** is blocked with the orphan message; fix it.
5. (Existing board) Confirm the per-row Group dropdown lists the board's real groups plus **New group…**.
6. Step 4 (Confirm): check the summary counts (items / subitems / groups) and click **Import**.
7. Verify on the board: rows landed in the groups you chose, subitems nested under the right parents, and (existing board) both the reused and newly-created groups are present.

## Self-review notes

- **Spec coverage:** #1 sizing → Task 8. #2 pinned footer → Task 8. #3 per-row item/subitem + groups → Tasks 1,2,3,4,9. Both modes → Tasks 3 (new) + 4/6/10 (existing). Migration user-applied → Task 6 gate. Zod → Task 5. Confirm-step simplification → Task 9. Testing budget → Tasks 1-5,9,10.
- **Type consistency:** `ImportGroup`/`RowStructureEntry` defined in Task 1, consumed unchanged in 2-7,9. `resolveStructuredRows` signature is stable across Tasks 3 and 4. `AppendPayload` new shape (Task 4) matches the RPC contract (Task 6). `commitImport` fields (Task 7) match what `ImportWizard` sends (Task 9) and the Zod schema (Task 5).
- **Known cross-task typecheck ordering:** `commitImport`'s new signature (Task 7) breaks `ImportWizard`'s call site until Task 9; run full `pnpm typecheck` green only after Task 9. Task 5 and Task 7 both touch the `importDestination` existing arm (`group` removal) — apply once, in whichever runs first.
