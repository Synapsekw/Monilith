# Group Management Implementation Plan (reorder · color · delete)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag-to-reorder board groups, change a group's color from a fixed palette, and delete a group (with confirmation, cascading its items).

**Architecture:** Mirror existing board patterns end to end — optimistic React-Query mutations + rollback (like `renameGroup`/`deleteColumn`), the `ColumnHeader` DropdownMenu + AlertDialog for the per-group menu/confirm, and the Kanban dnd-kit setup (via `@dnd-kit/sortable`) for drag. Group cache helpers become position-sorted (mirroring columns) so reorder is reflected for the actor and realtime peers.

**Tech Stack:** Next.js 16 (Server Actions), Supabase, TanStack Query, `@dnd-kit/{core,sortable,modifiers,utilities}` (already installed), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-19-group-management-design.md`

---

## File Structure

| File                                          | Change | Responsibility                                                                               |
| --------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `src/lib/boards/cache.ts`                     | Modify | Position-sort `insertGroup`/`replaceGroup`; add `removeGroup` (cascade items + cells)        |
| `src/lib/boards/cache.test.ts`                | Modify | Update `insertGroup` tests for position order; add `replaceGroup` sort + `removeGroup` tests |
| `src/lib/boards/use-board-realtime.ts`        | Modify | Route group INSERT echo through `insertGroup` (sorted)                                       |
| `src/lib/validations/board-actions.ts`        | Modify | `deleteGroupSchema`, `reorderGroupSchema`, `updateGroupColorSchema`                          |
| `src/lib/validations/board-actions.test.ts`   | Modify | Tests for the three new schemas                                                              |
| `src/lib/boards/actions.ts`                   | Modify | `reorderGroup`, `updateGroupColor`, `deleteGroup` Server Actions                             |
| `src/lib/boards/group-colors.ts`              | Create | `GROUP_COLORS` canonical swatch list                                                         |
| `src/lib/boards/group-reorder.ts`             | Create | Pure `reorderPosition` helper (drop → new float position)                                    |
| `src/lib/boards/group-reorder.test.ts`        | Create | Unit tests for `reorderPosition`                                                             |
| `src/lib/boards/use-board-mutations.ts`       | Modify | `reorderGroup`/`setGroupColor`/`deleteGroup` optimistic mutations                            |
| `src/lib/boards/use-board-mutations.test.tsx` | Modify | Optimistic + rollback tests for the three mutations                                          |
| `src/components/boards/BoardTable.tsx`        | Modify | `GroupMenu` (rename/color/delete) + drag handle + `DndContext`/`SortableContext` wiring      |
| `src/components/boards/BoardTable.test.tsx`   | Modify | Menu opens; swatch → `updateGroupColor`; Delete → confirm → `deleteGroup`                    |

---

## Task 1: Position-sorted group cache helpers + `removeGroup`

**Files:**

- Modify: `src/lib/boards/cache.ts` (`replaceGroup` ~line 69, `insertGroup` ~line 90)
- Test: `src/lib/boards/cache.test.ts`

- [ ] **Step 1: Update/extend the failing tests**

In `src/lib/boards/cache.test.ts`, add `removeGroup` to the import from `./cache`. Then **replace** the existing `describe("insertGroup", ...)` block (added by the add-group feature) with the block below, and add the two following `describe` blocks:

```ts
describe("insertGroup", () => {
  function withGroup(): BoardCache {
    return {
      ...baseCache(),
      groups: [
        {
          id: "g1",
          board_id: "b1",
          name: "Group 1",
          color: "#0073ea",
          position: 0,
        } as never,
      ],
    };
  }

  it("inserts in position order, not insertion order", () => {
    const next = insertGroup(withGroup(), {
      id: "g0",
      board_id: "b1",
      name: "Group 0",
      color: "#0073ea",
      position: -1,
    } as never);
    expect(next.groups.map((g) => g.id)).toEqual(["g0", "g1"]);
  });

  it("appends when its position is greatest", () => {
    const next = insertGroup(withGroup(), {
      id: "g2",
      board_id: "b1",
      name: "Group 2",
      color: "#0073ea",
      position: 1,
    } as never);
    expect(next.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("is idempotent — does not duplicate an existing group id", () => {
    const next = insertGroup(withGroup(), {
      id: "g1",
      board_id: "b1",
      name: "Group 1",
      color: "#0073ea",
      position: 0,
    } as never);
    expect(next.groups).toHaveLength(1);
  });

  it("does not mutate the input cache (immutable)", () => {
    const input = withGroup();
    insertGroup(input, {
      id: "g2",
      board_id: "b1",
      name: "Group 2",
      color: "#0073ea",
      position: 1,
    } as never);
    expect(input.groups).toHaveLength(1);
  });
});

describe("replaceGroup position sort", () => {
  function twoGroups(): BoardCache {
    return {
      ...baseCache(),
      groups: [
        {
          id: "g1",
          board_id: "b1",
          name: "G1",
          color: "#0073ea",
          position: 0,
        } as never,
        {
          id: "g2",
          board_id: "b1",
          name: "G2",
          color: "#0073ea",
          position: 1,
        } as never,
      ],
    };
  }

  it("re-sorts by position after a replace (covers reorder)", () => {
    const next = replaceGroup(twoGroups(), {
      id: "g1",
      board_id: "b1",
      name: "G1",
      color: "#0073ea",
      position: 2,
    } as never);
    expect(next.groups.map((g) => g.id)).toEqual(["g2", "g1"]);
  });
});

describe("removeGroup", () => {
  function cache(): BoardCache {
    return {
      board: { id: "b1", org_id: "o1", name: "B" } as never,
      groups: [
        {
          id: "g1",
          board_id: "b1",
          name: "G1",
          color: "#0073ea",
          position: 0,
        } as never,
        {
          id: "g2",
          board_id: "b1",
          name: "G2",
          color: "#0073ea",
          position: 1,
        } as never,
      ],
      columns: [],
      items: [
        { id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never,
        { id: "i2", board_id: "b1", group_id: "g2", name: "Two" } as never,
      ],
      cellValues: [
        {
          item_id: "i1",
          column_id: "c1",
          org_id: "o1",
          board_id: "b1",
          value: { text: "x" },
        } as never,
        {
          item_id: "i2",
          column_id: "c1",
          org_id: "o1",
          board_id: "b1",
          value: { text: "y" },
        } as never,
      ],
      dependencies: [],
    };
  }

  it("removes the group, its items, and those items' cell values", () => {
    const next = removeGroup(cache(), "g1");
    expect(next.groups.map((g) => g.id)).toEqual(["g2"]);
    expect(next.items.map((i) => i.id)).toEqual(["i2"]);
    expect(next.cellValues.map((c) => c.item_id)).toEqual(["i2"]);
  });

  it("does not mutate the input cache (immutable)", () => {
    const input = cache();
    removeGroup(input, "g1");
    expect(input.groups).toHaveLength(2);
    expect(input.items).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/lib/boards/cache.test.ts`
Expected: FAIL — `removeGroup` is not exported; `insertGroup`/`replaceGroup` don't sort yet (the position-order + reorder assertions fail).

- [ ] **Step 3: Implement the sort + `removeGroup`**

In `src/lib/boards/cache.ts`:

(a) Add a group comparator directly **above** `replaceGroup` (~line 67):

```ts
function byGroupPosition(a: CacheGroup, b: CacheGroup) {
  return a.position - b.position;
}
```

(b) Replace `replaceGroup` (~lines 68-74) with:

```ts
/** Replace a group by id (rename/recolor/reorder), keeping position order. Immutable. */
export function replaceGroup(cache: BoardCache, group: CacheGroup): BoardCache {
  return {
    ...cache,
    groups: cache.groups
      .map((g) => (g.id === group.id ? group : g))
      .sort(byGroupPosition),
  };
}
```

(c) Replace `insertGroup` (~lines 90-94) with:

```ts
/** Insert a group, keeping position order. No-op if the id already exists. Immutable. */
export function insertGroup(cache: BoardCache, group: CacheGroup): BoardCache {
  if (cache.groups.some((g) => g.id === group.id)) return cache;
  return { ...cache, groups: [...cache.groups, group].sort(byGroupPosition) };
}
```

(d) Add `removeGroup` directly **below** `insertGroup`:

```ts
/** Remove a group and its items + their cell values (mirrors the DB cascade). Immutable. */
export function removeGroup(cache: BoardCache, groupId: string): BoardCache {
  const itemIds = new Set(
    cache.items.filter((i) => i.group_id === groupId).map((i) => i.id),
  );
  return {
    ...cache,
    groups: cache.groups.filter((g) => g.id !== groupId),
    items: cache.items.filter((i) => i.group_id !== groupId),
    cellValues: cache.cellValues.filter((c) => !itemIds.has(c.item_id)),
  };
}
```

(`CacheGroup` is already exported at the top of the file. `.sort()` is applied to freshly-spread/mapped arrays, so the input cache is never mutated.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- src/lib/boards/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/cache.ts src/lib/boards/cache.test.ts
git commit -m "feat(boards): position-sort group cache helpers + removeGroup cascade"
```

---

## Task 2: Route realtime group INSERT through `insertGroup`

**Files:**

- Modify: `src/lib/boards/use-board-realtime.ts` (`onGroup`, ~lines 112-127, and the cache import)

This makes realtime group inserts position-sorted and idempotent, consistent with the `onColumn` handler (which already uses `insertColumn`). No new test — verified by typecheck + mirrors the existing column handler exactly.

- [ ] **Step 1: Add `insertGroup` to the cache import**

In `src/lib/boards/use-board-realtime.ts`, add `insertGroup` to the existing `from "@/lib/boards/cache"` import block (it already imports `replaceGroup`).

- [ ] **Step 2: Use `insertGroup` in the INSERT branch**

Replace the non-DELETE tail of `onGroup` (the `patch((prev) => prev.groups.some(...) ? replaceGroup(...) : { ...prev, groups: [...prev.groups, row] })` block) with:

```ts
const row = p.new as CacheGroup;
patch((prev) =>
  prev.groups.some((g) => g.id === row.id)
    ? replaceGroup(prev, row)
    : insertGroup(prev, row),
);
```

- [ ] **Step 3: Verify types compile + existing tests still green**

Run: `pnpm typecheck && pnpm test -- src/lib/boards/cache.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/use-board-realtime.ts
git commit -m "feat(boards): realtime group insert uses sorted insertGroup"
```

---

## Task 3: Validation schemas + Server Actions

**Files:**

- Modify: `src/lib/validations/board-actions.ts`
- Test: `src/lib/validations/board-actions.test.ts`
- Modify: `src/lib/boards/actions.ts`

- [ ] **Step 1: Write the failing schema tests**

In `src/lib/validations/board-actions.test.ts`, add the three new schemas to the import from the validations module, then append:

```ts
describe("group management schemas", () => {
  const groupId = "11111111-1111-4111-8111-111111111111";

  it("deleteGroup requires a uuid groupId", () => {
    expect(deleteGroupSchema.safeParse({ groupId }).success).toBe(true);
    expect(deleteGroupSchema.safeParse({}).success).toBe(false);
  });

  it("reorderGroup requires a numeric position", () => {
    expect(
      reorderGroupSchema.safeParse({ groupId, position: 1.5 }).success,
    ).toBe(true);
    expect(
      reorderGroupSchema.safeParse({ groupId, position: "x" }).success,
    ).toBe(false);
  });

  it("updateGroupColor requires a 6-digit hex color", () => {
    expect(
      updateGroupColorSchema.safeParse({ groupId, color: "#00c875" }).success,
    ).toBe(true);
    expect(
      updateGroupColorSchema.safeParse({ groupId, color: "red" }).success,
    ).toBe(false);
    expect(
      updateGroupColorSchema.safeParse({ groupId, color: "#fff" }).success,
    ).toBe(false);
  });
});
```

If the test file has no top-level `describe`/imports for these, also add `import { describe, it, expect } from "vitest";` only if not already present (it is — this file already tests schemas).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/validations/board-actions.test.ts`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Add the schemas**

In `src/lib/validations/board-actions.ts`, after `renameGroupSchema` (~line 18), add:

```ts
export const deleteGroupSchema = z.object({ groupId: uuid });
export const reorderGroupSchema = z.object({
  groupId: uuid,
  position: z.number(),
});
export const updateGroupColorSchema = z.object({
  groupId: uuid,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color"),
});
```

- [ ] **Step 4: Run to verify schema tests pass**

Run: `pnpm test -- src/lib/validations/board-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Server Actions**

In `src/lib/boards/actions.ts`:

(a) Add the three schemas to the existing `from "@/lib/validations/board-actions"` import block:

```ts
  deleteGroupSchema,
  reorderGroupSchema,
  updateGroupColorSchema,
```

(b) Add the three actions directly **after** the existing `createGroup` function (they mirror `renameGroup`):

```ts
export async function reorderGroup(input: {
  groupId: string;
  position: number;
}): Promise<ActionResult> {
  const parsed = reorderGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.groupId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

export async function updateGroupColor(input: {
  groupId: string;
  color: string;
}): Promise<ActionResult> {
  const parsed = updateGroupColorSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .update({ color: parsed.data.color })
    .eq("id", parsed.data.groupId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

export async function deleteGroup(input: {
  groupId: string;
}): Promise<ActionResult> {
  const parsed = deleteGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  // items cascade via the group_id FK (on delete cascade).
  const { data, error } = await supabase
    .from("groups")
    .delete()
    .eq("id", parsed.data.groupId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Group not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}
```

- [ ] **Step 6: Verify types compile**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validations/board-actions.ts src/lib/validations/board-actions.test.ts src/lib/boards/actions.ts
git commit -m "feat(boards): reorderGroup/updateGroupColor/deleteGroup actions + schemas"
```

---

## Task 4: `GROUP_COLORS` palette + pure `reorderPosition` helper

**Files:**

- Create: `src/lib/boards/group-colors.ts`
- Create: `src/lib/boards/group-reorder.ts`
- Test: `src/lib/boards/group-reorder.test.ts`

- [ ] **Step 1: Write the failing reorder tests**

Create `src/lib/boards/group-reorder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reorderPosition } from "./group-reorder";

const groups = [
  { id: "a", position: 0 },
  { id: "b", position: 1 },
  { id: "c", position: 2 },
  { id: "d", position: 3 },
];

describe("reorderPosition", () => {
  it("returns null for a no-op (same id)", () => {
    expect(reorderPosition(groups, "b", "b")).toBeNull();
  });

  it("returns null when an id is not present", () => {
    expect(reorderPosition(groups, "x", "a")).toBeNull();
  });

  it("moves down: a dropped over c lands between c and d", () => {
    expect(reorderPosition(groups, "a", "c")).toBe(2.5);
  });

  it("moves up: d dropped over b lands between a and b", () => {
    expect(reorderPosition(groups, "d", "b")).toBe(0.5);
  });

  it("moves to top: d dropped over a lands below the current top", () => {
    expect(reorderPosition(groups, "d", "a")).toBe(-1);
  });

  it("moves to bottom: a dropped over d lands above the current bottom", () => {
    expect(reorderPosition(groups, "a", "d")).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/boards/group-reorder.test.ts`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/boards/group-reorder.ts`:

```ts
/**
 * Given the current position-ordered groups and a drag (activeId dropped over
 * overId), return the new float `position` for the active group — or null for a
 * no-op. Boundary drops use ±1 (not midpoint's halving) so a drop above a group
 * sitting at position 0 still sorts strictly before it.
 */
export function reorderPosition(
  groups: { id: string; position: number }[],
  activeId: string,
  overId: string,
): number | null {
  if (activeId === overId) return null;
  const from = groups.findIndex((g) => g.id === activeId);
  const to = groups.findIndex((g) => g.id === overId);
  if (from === -1 || to === -1) return null;

  // `to` indexes the original (position-ordered) array; `without` excludes the
  // active group, so `to` is also the slot the active group should occupy —
  // correct whether moving up or down.
  const without = groups.filter((g) => g.id !== activeId);
  const before = without[to - 1]?.position ?? null;
  const after = without[to]?.position ?? null;

  if (before === null && after === null) return 0;
  if (before === null) return after! - 1; // dropped at the top
  if (after === null) return before + 1; // dropped at the bottom
  return (before + after) / 2; // inserted between two groups
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/lib/boards/group-reorder.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 5: Create the color palette**

Create `src/lib/boards/group-colors.ts`:

```ts
/**
 * Canonical group color swatches: the default board blue + the 11 brand colors
 * shared with Status/Dropdown options. Used by the group color picker.
 */
export const GROUP_COLORS = [
  "#0073ea", // default board blue
  "#00c875",
  "#fdab3d",
  "#e2445c",
  "#c4c4c4",
  "#808080",
  "#6366f1",
  "#8b5cf6",
  "#38bdf8",
  "#ec4899",
  "#14b8a6",
  "#f97316",
] as const;
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/group-reorder.ts src/lib/boards/group-reorder.test.ts src/lib/boards/group-colors.ts
git commit -m "feat(boards): GROUP_COLORS palette + pure reorderPosition helper"
```

---

## Task 5: Optimistic group mutations (reorder / color / delete)

**Files:**

- Modify: `src/lib/boards/use-board-mutations.ts`
- Test: `src/lib/boards/use-board-mutations.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/lib/boards/use-board-mutations.test.tsx`:

(a) Extend the existing `@/lib/boards/actions` mock to add the three actions, and declare their spies:

```ts
const reorderGroup = vi.fn();
const updateGroupColor = vi.fn();
const deleteGroup = vi.fn();
```

and inside the `vi.mock("@/lib/boards/actions", () => ({ ... }))` factory add:

```ts
  reorderGroup: (...a: unknown[]) => reorderGroup(...a),
  updateGroupColor: (...a: unknown[]) => updateGroupColor(...a),
  deleteGroup: (...a: unknown[]) => deleteGroup(...a),
```

(b) Append this block (a local helper that seeds a cache with two groups + one item, then the three describes):

```ts
function seedGroups(qc: QueryClient): void {
  qc.setQueryData(boardKey("b1"), {
    board: { id: "b1", org_id: "o1", name: "B" },
    groups: [
      { id: "g1", board_id: "b1", name: "G1", color: "#0073ea", position: 0 },
      { id: "g2", board_id: "b1", name: "G2", color: "#0073ea", position: 1 },
    ],
    columns: [],
    items: [{ id: "i1", board_id: "b1", group_id: "g1", name: "One" }],
    cellValues: [],
    dependencies: [],
  } as never);
}

describe("useBoardMutations.reorderGroup", () => {
  beforeEach(() => reorderGroup.mockReset());

  it("optimistically moves the group and re-sorts", async () => {
    const qc = new QueryClient();
    seedGroups(qc);
    reorderGroup.mockResolvedValue({ ok: true, data: undefined });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.reorderGroup("g1", 2);
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.groups.map((g) => g.id)).toEqual(["g2", "g1"]);
    expect(reorderGroup).toHaveBeenCalledWith({ groupId: "g1", position: 2 });
  });

  it("rolls back when the action fails", async () => {
    const qc = new QueryClient();
    seedGroups(qc);
    reorderGroup.mockResolvedValue({ ok: false, error: "boom" });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.reorderGroup("g1", 2);
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    });
  });
});

describe("useBoardMutations.setGroupColor", () => {
  beforeEach(() => updateGroupColor.mockReset());

  it("optimistically updates the color", async () => {
    const qc = new QueryClient();
    seedGroups(qc);
    updateGroupColor.mockResolvedValue({ ok: true, data: undefined });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.setGroupColor("g1", "#00c875");
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.groups.find((g) => g.id === "g1")!.color).toBe("#00c875");
    expect(updateGroupColor).toHaveBeenCalledWith({
      groupId: "g1",
      color: "#00c875",
    });
  });
});

describe("useBoardMutations.deleteGroup", () => {
  beforeEach(() => deleteGroup.mockReset());

  it("optimistically removes the group and its items", async () => {
    const qc = new QueryClient();
    seedGroups(qc);
    deleteGroup.mockResolvedValue({ ok: true, data: undefined });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.deleteGroup("g1");
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.groups.map((g) => g.id)).toEqual(["g2"]);
    expect(cache.items).toHaveLength(0);
    expect(deleteGroup).toHaveBeenCalledWith({ groupId: "g1" });
  });

  it("rolls back when the action fails", async () => {
    const qc = new QueryClient();
    seedGroups(qc);
    deleteGroup.mockResolvedValue({ ok: false, error: "boom" });
    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.deleteGroup("g1");
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
      expect(cache.items).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/boards/use-board-mutations.test.tsx`
Expected: FAIL — `reorderGroup`/`setGroupColor`/`deleteGroup` are not functions on the hook.

- [ ] **Step 3: Implement the mutations**

In `src/lib/boards/use-board-mutations.ts`:

(a) Add the three actions to the `from "@/lib/boards/actions"` import block:

```ts
  deleteGroup,
  reorderGroup,
  updateGroupColor,
```

(b) Add `removeGroup` to the `from "@/lib/boards/cache"` import block (alongside `replaceGroup`, which is already imported).

(c) Add the three mutations inside `useBoardMutations`, directly **after** `renameGroupMutation`:

```ts
const reorderGroupMutation = useMutation<
  unknown,
  Error,
  { groupId: string; position: number },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await reorderGroup(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<BoardCache>(key);
    if (previous) {
      const existing = previous.groups.find((g) => g.id === vars.groupId);
      if (existing) {
        qc.setQueryData<BoardCache>(
          key,
          replaceGroup(previous, { ...existing, position: vars.position }),
        );
      }
    }
    return { previous };
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});

const setGroupColorMutation = useMutation<
  unknown,
  Error,
  { groupId: string; color: string },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await updateGroupColor(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<BoardCache>(key);
    if (previous) {
      const existing = previous.groups.find((g) => g.id === vars.groupId);
      if (existing) {
        qc.setQueryData<BoardCache>(
          key,
          replaceGroup(previous, { ...existing, color: vars.color }),
        );
      }
    }
    return { previous };
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});

const deleteGroupMutation = useMutation<
  unknown,
  Error,
  { groupId: string },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await deleteGroup(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<BoardCache>(key);
    if (previous)
      qc.setQueryData<BoardCache>(key, removeGroup(previous, vars.groupId));
    return { previous };
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});
```

(d) Expose them in the returned object (after the `renameGroup` entry):

```ts
    reorderGroup: (groupId: string, position: number) =>
      reorderGroupMutation.mutate({ groupId, position }),
    setGroupColor: (groupId: string, color: string) =>
      setGroupColorMutation.mutate({ groupId, color }),
    deleteGroup: (groupId: string) => deleteGroupMutation.mutate({ groupId }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/lib/boards/use-board-mutations.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/use-board-mutations.ts src/lib/boards/use-board-mutations.test.tsx
git commit -m "feat(boards): optimistic reorderGroup/setGroupColor/deleteGroup mutations"
```

---

## Task 6: Group header menu — rename / color / delete

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`
- Test: `src/components/boards/BoardTable.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

In `src/components/boards/BoardTable.test.tsx`:

(a) Extend the `@/lib/boards/actions` mock to add `updateGroupColor` and `deleteGroup` spies (the file already mocks `createGroup`):

```ts
const updateGroupColor = vi.fn();
const deleteGroup = vi.fn();
```

and in the `vi.mock("@/lib/boards/actions", ...)` factory add:

```ts
  updateGroupColor: (...a: unknown[]) => updateGroupColor(...a),
  deleteGroup: (...a: unknown[]) => deleteGroup(...a),
```

(b) Reset them in `beforeEach`:

```ts
updateGroupColor.mockReset();
deleteGroup.mockReset();
```

(c) Append a new describe (uses `fireEvent`, already imported, matching `ColumnHeader.test.tsx`'s Radix-menu approach):

```ts
describe("BoardTable group menu", () => {
  it("sets a group color from the palette", async () => {
    updateGroupColor.mockResolvedValue({ ok: true, data: undefined });
    renderBoard();

    fireEvent.click(screen.getByLabelText("Group 1 group menu"));
    fireEvent.click(screen.getByLabelText("Set color #00c875"));

    await waitFor(() =>
      expect(updateGroupColor).toHaveBeenCalledWith({
        groupId: "g1",
        color: "#00c875",
      }),
    );
  });

  it("deletes a group after confirmation", async () => {
    deleteGroup.mockResolvedValue({ ok: true, data: undefined });
    renderBoard();

    fireEvent.click(screen.getByLabelText("Group 1 group menu"));
    fireEvent.click(screen.getByText("Delete"));
    expect(deleteGroup).not.toHaveBeenCalled(); // dialog open, not confirmed

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(deleteGroup).toHaveBeenCalledWith({ groupId: "g1" }),
    );
  });
});
```

(Confirm the `payloadFixture` group is `{ id: "g1", name: "Group 1", color: "#0073ea", position: 0, board_id: "b1", org_id: "o1" }` — it is, from the add-group test. If `position` is missing, add it.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/components/boards/BoardTable.test.tsx`
Expected: FAIL — no "Group 1 group menu" button.

- [ ] **Step 3: Add imports to `BoardTable.tsx`**

At the top of `src/components/boards/BoardTable.tsx`:

(a) Add `MoreHorizontal` to the existing `lucide-react` import:

```ts
import {
  ChevronDown,
  ChevronRight,
  Maximize2,
  MoreHorizontal,
  Plus,
} from "lucide-react";
```

(b) Add these imports near the other component imports:

```ts
import { cn } from "@/lib/utils";
import { GROUP_COLORS } from "@/lib/boards/group-colors";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
```

- [ ] **Step 4: Add the `GroupMenu` component**

In `src/components/boards/BoardTable.tsx`, add this component directly **above** `function GroupSection`:

```tsx
function GroupMenu({
  group,
  onRename,
  onSetColor,
  onDelete,
}: {
  group: Group;
  onRename: () => void;
  onSetColor: (color: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${group.name} group menu`}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ml-auto grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/grouphdr:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5">
            <p className="text-muted-foreground mb-1.5 text-xs">Color</p>
            <div className="grid grid-cols-6 gap-1.5">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Set color ${c}`}
                  onClick={() => {
                    onSetColor(c);
                    setOpen(false);
                  }}
                  style={{ backgroundColor: c }}
                  className={cn(
                    "focus-visible:ring-ring size-5 rounded-full focus-visible:ring-2 focus-visible:outline-none",
                    group.color.toLowerCase() === c.toLowerCase() &&
                      "ring-foreground ring-offset-background ring-2 ring-offset-1",
                  )}
                />
              ))}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => setConfirming(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{group.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the group and all of its items on this
              board. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 5: Wire the menu into `GroupSection`**

(a) Add `onSetColor` + `onDelete` to `GroupSection`'s props (both the destructure and the type literal):

```tsx
  onRenameSettled,
  onSetColor,
  onDelete,
}: {
  ...
  autoFocusRename: boolean;
  onRenameSettled: () => void;
  onSetColor: (color: string) => void;
  onDelete: () => void;
}) {
```

(b) Add the `group/grouphdr` group-scope to the header `<div>` (so the menu reveals on hover) — change its className from:

```tsx
className =
  "bg-surface hover:bg-accent sticky left-0 flex w-full items-center gap-2 border-b px-3 py-1.5 text-sm font-semibold transition-colors";
```

to (add `group/grouphdr` at the front):

```tsx
className =
  "group/grouphdr bg-surface hover:bg-accent sticky left-0 flex w-full items-center gap-2 border-b px-3 py-1.5 text-sm font-semibold transition-colors";
```

(c) Replace the trailing item-count span (the `<span className="text-muted-foreground text-xs font-normal">{items.length}</span>`) with the count **plus** the menu:

```tsx
        <span className="text-muted-foreground text-xs font-normal">
          {items.length}
        </span>
        <GroupMenu
          group={group}
          onRename={openRename}
          onSetColor={onSetColor}
          onDelete={onDelete}
        />
```

- [ ] **Step 6: Pass the handlers from `BoardTable`**

(a) Add `setGroupColor` and `deleteGroup` to the mutations destructure in `BoardTable` (the `const { setCell, ..., addGroup } = mutations;` block):

```tsx
    renameGroup,
    addGroup,
    setGroupColor,
    deleteGroup,
  } = mutations;
```

(b) In the `groups.map(...)` render, pass the two new props to `<GroupSection>`:

```tsx
                autoFocusRename={group.id === renameGroupId}
                onRenameSettled={() => setRenameGroupId(null)}
                onSetColor={(color) => setGroupColor(group.id, color)}
                onDelete={() => deleteGroup(group.id)}
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm test -- src/components/boards/BoardTable.test.tsx`
Expected: PASS (color + delete tests, plus the existing add-group test).

- [ ] **Step 8: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "feat(boards): per-group menu — rename, color palette, delete with confirm"
```

---

## Task 7: Drag-to-reorder groups

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`
- Test: `src/components/boards/BoardTable.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/components/boards/BoardTable.test.tsx`, append:

```ts
describe("BoardTable group drag handle", () => {
  it("renders a reorder handle for each group", () => {
    renderBoard();
    expect(
      screen.getByRole("button", { name: "Reorder Group 1" }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/components/boards/BoardTable.test.tsx`
Expected: FAIL — no "Reorder Group 1" button.

- [ ] **Step 3: Add dnd imports + reorder helper import**

At the top of `src/components/boards/BoardTable.tsx`, add `GripVertical` to the `lucide-react` import and add:

```ts
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { reorderPosition } from "@/lib/boards/group-reorder";
```

The `lucide-react` line becomes:

```ts
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Maximize2,
  MoreHorizontal,
  Plus,
} from "lucide-react";
```

- [ ] **Step 4: Wire `DndContext`/`SortableContext` in `BoardTable`**

(a) Add `reorderGroup` to the mutations destructure (alongside `setGroupColor`/`deleteGroup`):

```tsx
    setGroupColor,
    deleteGroup,
    reorderGroup,
  } = mutations;
```

(b) Inside `BoardTable`, before the `return`, add the sensors + drop handler:

```tsx
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
);

function handleGroupDragEnd(e: DragEndEvent) {
  const { active, over } = e;
  if (!over) return;
  const position = reorderPosition(
    groups.map((g) => ({ id: g.id, position: g.position })),
    String(active.id),
    String(over.id),
  );
  if (position !== null) reorderGroup(String(active.id), position);
}
```

(c) Wrap the `groups.map(...)` branch (the `else` of the empty-state ternary) in `DndContext` + `SortableContext`:

```tsx
{
  groups.length === 0 ? (
    <p className="text-muted-foreground px-4 py-6 text-sm">
      This board has no groups yet.
    </p>
  ) : (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleGroupDragEnd}
    >
      <SortableContext
        items={groups.map((g) => g.id)}
        strategy={verticalListSortingStrategy}
      >
        {groups.map((group) => (
          <GroupSection
            key={group.id}
            group={group}
            items={itemsByGroup.get(group.id) ?? []}
            columns={columns}
            cellMap={cellMap}
            template={template}
            controls={controls}
            onRenameGroup={(name) => renameGroup(group.id, name)}
            nameWidth={nameWidth}
            autoFocusRename={group.id === renameGroupId}
            onRenameSettled={() => setRenameGroupId(null)}
            onSetColor={(color) => setGroupColor(group.id, color)}
            onDelete={() => deleteGroup(group.id)}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
```

- [ ] **Step 5: Make `GroupSection` sortable + add the drag handle**

In `GroupSection`:

(a) At the top of the body (after the existing `useState`/`useRef` hooks, before `virtualizer`), add:

```tsx
const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
  useSortable({ id: group.id });
```

(b) Change the root `<section>` to receive the sortable ref/transform:

```tsx
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 opacity-70")}
    >
```

(c) Add the drag handle as the **first** child of the header `<div>`, directly before the collapse `<button>`:

```tsx
<button
  type="button"
  aria-label={`Reorder ${group.name}`}
  {...attributes}
  {...listeners}
  className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md opacity-0 transition-opacity group-hover/grouphdr:opacity-100 active:cursor-grabbing"
>
  <GripVertical className="size-4" />
</button>
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test -- src/components/boards/BoardTable.test.tsx`
Expected: PASS (handle rendered; color/delete/add-group tests still green).

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "feat(boards): drag-to-reorder groups via dnd-kit sortable"
```

---

## Task 8: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four PASS. Fix inline and re-run if any fail.

- [ ] **Step 2: Manual smoke (dev server)**

Run `pnpm dev`, open a board with 2-3 groups, and confirm:

1. Hovering a group header reveals a `⠿` drag handle (left) and a `⋯` menu (right).
2. Dragging by the handle reorders groups; the order persists after reload.
3. `⋯` → Color → clicking a swatch recolors the header rail + dot immediately.
4. `⋯` → Delete → confirm removes the group and its items; deleting the last group shows the "no groups yet" empty state + Add group.
5. `⋯` → Rename opens the inline name editor.

- [ ] **Step 3: Commit any fixes** (skip if the gate was clean)

```bash
git add -A
git commit -m "chore(boards): verification fixes for group management"
```

---

## Self-Review Notes

- **Spec coverage:** cache sort + `removeGroup` (Task 1), realtime insert (Task 2), schemas + 3 actions (Task 3), `GROUP_COLORS` + `reorderPosition` (Task 4), 3 optimistic mutations (Task 5), header menu with color/delete/rename (Task 6), drag-to-reorder (Task 7), data-fetching budget honored throughout (optimistic patches, 0 RSC nav), gate + smoke (Task 8). All spec sections mapped.
- **Type consistency:** action names `reorderGroup`/`updateGroupColor`/`deleteGroup` are consistent across schema (Task 3), action (Task 3), mutation import + `mutationFn` (Task 5). Hook methods `reorderGroup(groupId, position)` / `setGroupColor(groupId, color)` / `deleteGroup(groupId)` are consumed exactly that way in `BoardTable` (Tasks 6-7). `reorderPosition(groups, activeId, overId)` signature consistent between Task 4 (def) and Task 7 (call). `GroupSection` gains `onSetColor`/`onDelete` (Task 6) used in the `groups.map` (Tasks 6 and rewritten in 7). `removeGroup`/`insertGroup`/`replaceGroup` signatures consistent between Task 1 and Task 5.
- **Spec refinement:** `reorderPosition` uses ±1 at the boundaries instead of the spec's `midpoint()` so a drop above a position-0 group sorts strictly before it (the spec's helper has been updated to match).
- **Out of scope (YAGNI):** bulk ops, item-between-group drag, custom hex.

```

```
