# Phase 2c — Column Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add column add / rename / delete / resize to the board Table view — closing the boards-core gap where the column set is fixed at the `create_board` seed.

**Architecture:** Four Server Actions (`createColumn` / `renameColumn` / `deleteColumn` / `resizeColumn`) mirror the existing `upsertCell` idiom (server-derives `org_id`, RLS is the guard). Optimistic board-cache mutators + a new `columns` Realtime subscription keep peers in sync (no RSC refetch — gotcha-09). The `BoardTable` header gains a per-column menu, a `+` kind picker, and a drag-to-resize handle; column width persists to a new `columns.width` column (server-shared) and the CSS grid template moves from uniform `1fr` tracks to per-column fixed px.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions) · Supabase (Postgres + RLS + Realtime) · TanStack Query v5 · Zod v4 · Vitest + Playwright · Tailwind v4 + shadcn (`pulse-ui`).

---

## File Structure

| File                                                   | Create/Modify   | Responsibility                                                                                |
| ------------------------------------------------------ | --------------- | --------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260617120000_columns_width.sql` | Create          | `alter table columns add column width` (+ check)                                              |
| `src/types/database.types.ts`                          | Modify          | Regenerated types (incl. `columns.width`)                                                     |
| `src/lib/validations/boards.ts`                        | Modify          | Add `columnKindSchema` (z.enum over the 6 kinds)                                              |
| `src/lib/validations/board-actions.ts`                 | Modify          | Add `createColumnSchema` / `renameColumnSchema` / `deleteColumnSchema` / `resizeColumnSchema` |
| `src/lib/boards/column-defaults.ts`                    | Create          | Pure `defaultColumn(kind, name?)` → `{ name, settings }` (seeded Status/Dropdown options)     |
| `src/lib/boards/column-defaults.test.ts`               | Create          | Unit tests for defaults                                                                       |
| `src/lib/boards/actions.ts`                            | Modify          | Add the 4 column Server Actions                                                               |
| `src/lib/boards/column-actions.test.ts`                | Create          | Unit tests for the 4 actions                                                                  |
| `src/lib/boards/cache.ts`                              | Modify          | Add `insertColumn` / `replaceColumn` / `removeColumn` mutators                                |
| `src/lib/boards/cache.test.ts`                         | Modify          | Tests for the 3 mutators                                                                      |
| `src/lib/boards/use-board-mutations.ts`                | Modify          | Add `addColumn` / `renameColumn` / `deleteColumn` / `resizeColumn` hooks                      |
| `src/lib/boards/use-board-realtime.ts`                 | Modify          | Subscribe to `columns` + `onColumn` reconciler                                                |
| `src/components/ui/alert-dialog.tsx`                   | Create (shadcn) | Delete-confirm primitive                                                                      |
| `src/components/boards/ColumnHeader.tsx`               | Create          | Header cell: name + ⋯ menu (rename/delete) + resize handle                                    |
| `src/components/boards/AddColumnMenu.tsx`              | Create          | `+` button → 6-kind picker dropdown                                                           |
| `src/components/boards/BoardTable.tsx`                 | Modify          | Per-column grid template + `liveWidths` + wire the header components                          |
| `src/components/boards/ColumnHeader.test.tsx`          | Create          | Component tests (rename/delete/resize)                                                        |
| `src/lib/boards/columns.rls.integration.test.ts`       | Create          | Two-user RLS: member CRUD ok, cross-org denied                                                |
| `e2e/board-columns.spec.ts`                            | Create          | add → rename → resize (persist) → delete                                                      |

---

## Task 1 — Migration: `columns.width`

**Files:** Create `supabase/migrations/20260617120000_columns_width.sql`

- [ ] Create the migration with exactly:

```sql
-- Phase 2c (Column management): per-column width for the resizable Table view.
-- NULL renders at the default value-column width (180px). Shared across users
-- (server-side); synced via the existing columns Realtime publication.
alter table public.columns
  add column width integer
  check (width is null or (width between 80 and 1200));
```

- [ ] Apply: run `supabase db push --linked`; confirm applied, no error. (Cloud apply must be authorized for the session — if not, STOP and ask.)
- [ ] Run advisors: `supabase db lint --linked --level warning`; confirm no NEW findings for `columns` (a pre-existing unrelated `delete_board_view` finding may appear — ignore it).
- [ ] Commit: `git add supabase/migrations/20260617120000_columns_width.sql && git commit -m "feat(db): add columns.width for resizable columns"`

---

## Task 2 — Regenerate types

**Files:** Modify `src/types/database.types.ts`

- [ ] Regenerate: run `pnpm db:types` (script: `supabase gen types typescript --linked --schema public | prettier --parser typescript > src/types/database.types.ts`). If it fails with an IPv6 timeout, retry up to twice.
- [ ] Verify width is present: `grep -n "width" src/types/database.types.ts` shows it in the `columns` Row/Insert/Update.
- [ ] Typecheck: `pnpm typecheck` (expected: clean).
- [ ] Commit: `git add src/types/database.types.ts && git commit -m "chore(db): regenerate types for columns.width"`

---

## Task 3 — Zod schemas + column-kind enum

**Files:** Modify `src/lib/validations/boards.ts`, `src/lib/validations/board-actions.ts`

- [ ] In `src/lib/validations/boards.ts`, add a `columnKindSchema` (after the `ColumnKind` type). The 6 enum values are `text`, `status`, `people`, `date`, `numbers`, `dropdown`:

```ts
export const columnKindSchema = z.enum([
  "text",
  "status",
  "people",
  "date",
  "numbers",
  "dropdown",
]);
```

(`z` is already imported in this file.)

- [ ] In `src/lib/validations/board-actions.ts`, append the column-action schemas (reuse the existing `uuid` + `name` locals; import `columnKindSchema`):

```ts
import { columnKindSchema } from "@/lib/validations/boards";

export const createColumnSchema = z.object({
  boardId: uuid,
  kind: columnKindSchema,
  name: name.optional(),
});
export const renameColumnSchema = z.object({ columnId: uuid, name });
export const deleteColumnSchema = z.object({ columnId: uuid });
export const resizeColumnSchema = z.object({
  columnId: uuid,
  width: z.number().int().min(80).max(1200),
});
```

- [ ] Typecheck: `pnpm typecheck` (expected: clean — self-contained).
- [ ] Commit: `git add src/lib/validations/boards.ts src/lib/validations/board-actions.ts && git commit -m "feat(boards): zod schemas for column actions"`

---

## Task 4 — Pure `defaultColumn` helper (test first)

**Files:** Create `src/lib/boards/column-defaults.ts`, `src/lib/boards/column-defaults.test.ts`

- [ ] Write the failing test `src/lib/boards/column-defaults.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { defaultColumn } from "@/lib/boards/column-defaults";

describe("defaultColumn", () => {
  it("uses the per-kind default name when none is given", () => {
    expect(defaultColumn("text").name).toBe("Text");
    expect(defaultColumn("status").name).toBe("Status");
    expect(defaultColumn("people").name).toBe("People");
    expect(defaultColumn("date").name).toBe("Date");
    expect(defaultColumn("numbers").name).toBe("Numbers");
    expect(defaultColumn("dropdown").name).toBe("Dropdown");
  });
  it("trims and prefers an explicit name", () => {
    expect(defaultColumn("text", "  Notes ").name).toBe("Notes");
  });
  it("seeds Status with the three standard options (with ids)", () => {
    const s = defaultColumn("status").settings as {
      options: { id: string; label: string; color: string }[];
    };
    expect(s.options.map((o) => o.label)).toEqual([
      "Working on it",
      "Stuck",
      "Done",
    ]);
    expect(s.options.every((o) => o.id.length > 0)).toBe(true);
  });
  it("seeds Dropdown with a small usable option set", () => {
    const s = defaultColumn("dropdown").settings as { options: unknown[] };
    expect(s.options.length).toBeGreaterThanOrEqual(2);
  });
  it("gives plain kinds an empty settings object", () => {
    expect(defaultColumn("text").settings).toEqual({});
    expect(defaultColumn("date").settings).toEqual({});
    expect(defaultColumn("numbers").settings).toEqual({});
    expect(defaultColumn("people").settings).toEqual({});
  });
});
```

- [ ] Run it, confirm FAIL (module not found): `pnpm test src/lib/boards/column-defaults.test.ts`.
- [ ] Create `src/lib/boards/column-defaults.ts`:

```ts
import type { ColumnKind } from "@/lib/validations/boards";

const DEFAULT_NAME: Record<ColumnKind, string> = {
  text: "Text",
  status: "Status",
  people: "People",
  date: "Date",
  numbers: "Numbers",
  dropdown: "Dropdown",
};

function opt(label: string, color: string) {
  return { id: crypto.randomUUID(), label, color };
}

/**
 * Default name + settings for a freshly added column. Status/Dropdown are
 * seeded with usable options (the create_board Status palette) so the column
 * works immediately before the options editor ships. Pure.
 */
export function defaultColumn(
  kind: ColumnKind,
  name?: string,
): { name: string; settings: Record<string, unknown> } {
  const resolved = name?.trim() ? name.trim() : DEFAULT_NAME[kind];
  let settings: Record<string, unknown> = {};
  if (kind === "status") {
    settings = {
      options: [
        opt("Working on it", "#fdab3d"),
        opt("Stuck", "#e2445c"),
        opt("Done", "#00c875"),
      ],
    };
  } else if (kind === "dropdown") {
    settings = {
      options: [opt("Option 1", "#579bfc"), opt("Option 2", "#a25ddc")],
    };
  }
  return { name: resolved, settings };
}
```

- [ ] Run it, confirm PASS: `pnpm test src/lib/boards/column-defaults.test.ts`.
- [ ] Commit: `git add src/lib/boards/column-defaults.ts src/lib/boards/column-defaults.test.ts && git commit -m "feat(boards): pure defaultColumn (name + seeded settings)"`

---

## Task 5 — Server Actions (test first)

**Files:** Modify `src/lib/boards/actions.ts`; Create `src/lib/boards/column-actions.test.ts`

- [ ] Write the failing test `src/lib/boards/column-actions.test.ts` (mocks the server Supabase client, mirroring the existing `actions.test.ts` style):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createColumn,
  renameColumn,
  deleteColumn,
  resizeColumn,
} from "@/lib/boards/actions";

const BOARD = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const COL = "33333333-3333-4333-8333-333333333333";

beforeEach(() => from.mockReset());

describe("createColumn", () => {
  it("derives org from the board, appends after the last position, seeds defaults", async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: COL }, error: null }),
      }),
    });
    from.mockImplementation((t: string) => {
      if (t === "boards")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { org_id: ORG }, error: null }),
            }),
          }),
        };
      if (t === "columns")
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: { position: 2 },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          insert,
        };
      return {};
    });

    const res = await createColumn({ boardId: BOARD, kind: "status" });
    expect(res).toEqual({ ok: true, data: { columnId: COL } });
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      org_id: ORG,
      board_id: BOARD,
      kind: "status",
      name: "Status",
    });
    expect(row.position).toBeGreaterThan(2); // appended after the last
    expect((row.settings as { options: unknown[] }).options).toHaveLength(3);
  });

  it("rejects an invalid kind before any db call", async () => {
    const res = await createColumn({
      boardId: BOARD,
      kind: "bogus" as never,
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("renameColumn / resizeColumn / deleteColumn", () => {
  function columnBoardLookup() {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { board_id: BOARD }, error: null }),
        }),
      }),
    };
  }

  it("renameColumn updates the name", async () => {
    const update = vi
      .fn()
      .mockReturnValue({ eq: async () => ({ error: null }) });
    from.mockImplementation((t: string) =>
      t === "columns" ? { ...columnBoardLookup(), update } : {},
    );
    const res = await renameColumn({ columnId: COL, name: "Priority" });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ name: "Priority" });
  });

  it("resizeColumn updates the width", async () => {
    const update = vi
      .fn()
      .mockReturnValue({ eq: async () => ({ error: null }) });
    from.mockImplementation((t: string) =>
      t === "columns" ? { ...columnBoardLookup(), update } : {},
    );
    const res = await resizeColumn({ columnId: COL, width: 320 });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ width: 320 });
  });

  it("resizeColumn rejects out-of-range widths", async () => {
    const res = await resizeColumn({ columnId: COL, width: 5000 });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("deleteColumn deletes the row", async () => {
    const del = vi.fn().mockReturnValue({ eq: async () => ({ error: null }) });
    from.mockImplementation((t: string) =>
      t === "columns" ? { ...columnBoardLookup(), delete: del } : {},
    );
    const res = await deleteColumn({ columnId: COL });
    expect(res.ok).toBe(true);
    expect(del).toHaveBeenCalled();
  });
});
```

- [ ] Run it, confirm FAIL (the 4 actions don't exist): `pnpm test src/lib/boards/column-actions.test.ts`.
- [ ] In `src/lib/boards/actions.ts`, add imports near the existing validation imports:

```ts
import {
  createColumnSchema,
  renameColumnSchema,
  deleteColumnSchema,
  resizeColumnSchema,
} from "@/lib/validations/board-actions";
import type { ColumnKind } from "@/lib/validations/boards";
import { defaultColumn } from "@/lib/boards/column-defaults";
```

- [ ] Append the four actions to `src/lib/boards/actions.ts` (mirrors `createGroup` for position/org derivation and `upsertCell` for the `ActionResult`/`fail`/`revalidatePath` idiom; `midpoint` is already imported):

```ts
export async function createColumn(input: {
  boardId: string;
  kind: ColumnKind;
  name?: string;
}): Promise<ActionResult<{ columnId: string }>> {
  const parsed = createColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", parsed.data.boardId)
    .maybeSingle();
  if (boardErr || !board) return fail("Board not found.");

  const { data: last } = await supabase
    .from("columns")
    .select("position")
    .eq("board_id", parsed.data.boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { name, settings } = defaultColumn(parsed.data.kind, parsed.data.name);

  const { data, error } = await supabase
    .from("columns")
    .insert({
      org_id: board.org_id,
      board_id: parsed.data.boardId,
      kind: parsed.data.kind,
      name,
      settings: settings as Tables<"columns">["settings"],
      position: midpoint(last?.position ?? null, null),
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not create column.");

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, data: { columnId: data.id } };
}

async function columnBoardId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  columnId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("columns")
    .select("board_id")
    .eq("id", columnId)
    .maybeSingle();
  return data?.board_id ?? null;
}

export async function renameColumn(input: {
  columnId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const boardId = await columnBoardId(supabase, parsed.data.columnId);
  if (!boardId) return fail("Column not found.");
  const { error } = await supabase
    .from("columns")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.columnId);
  if (error) return fail(error.message);
  revalidatePath(`/boards/${boardId}`);
  return { ok: true, data: undefined };
}

export async function resizeColumn(input: {
  columnId: string;
  width: number;
}): Promise<ActionResult> {
  const parsed = resizeColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const boardId = await columnBoardId(supabase, parsed.data.columnId);
  if (!boardId) return fail("Column not found.");
  const { error } = await supabase
    .from("columns")
    .update({ width: parsed.data.width })
    .eq("id", parsed.data.columnId);
  if (error) return fail(error.message);
  revalidatePath(`/boards/${boardId}`);
  return { ok: true, data: undefined };
}

export async function deleteColumn(input: {
  columnId: string;
}): Promise<ActionResult> {
  const parsed = deleteColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const boardId = await columnBoardId(supabase, parsed.data.columnId);
  if (!boardId) return fail("Column not found.");
  // cell_values cascade via the column_id FK (on delete cascade).
  const { error } = await supabase
    .from("columns")
    .delete()
    .eq("id", parsed.data.columnId);
  if (error) return fail(error.message);
  revalidatePath(`/boards/${boardId}`);
  return { ok: true, data: undefined };
}
```

- [ ] Run it, confirm PASS: `pnpm test src/lib/boards/column-actions.test.ts`; also re-run the existing `pnpm test src/lib/boards/actions.test.ts` (no regression).
- [ ] Commit: `git add src/lib/boards/actions.ts src/lib/boards/column-actions.test.ts && git commit -m "feat(boards): column server actions (create/rename/delete/resize)"`

---

## Task 6 — Cache mutators (test first)

**Files:** Modify `src/lib/boards/cache.ts`, `src/lib/boards/cache.test.ts`

- [ ] Add to `src/lib/boards/cache.test.ts` (use the file's existing cache-builder helper if present; otherwise build a minimal `BoardCache`). Test:

```ts
import { describe, it, expect } from "vitest";
import {
  insertColumn,
  replaceColumn,
  removeColumn,
  type BoardCache,
  type CacheColumn,
} from "@/lib/boards/cache";

function col(
  id: string,
  position: number,
  over: Partial<CacheColumn> = {},
): CacheColumn {
  return {
    id,
    org_id: "o",
    board_id: "b",
    kind: "text",
    name: id,
    settings: {},
    position,
    width: null,
    created_at: "2026-06-17T00:00:00Z",
    updated_at: "2026-06-17T00:00:00Z",
    ...over,
  } as CacheColumn;
}
function cache(columns: CacheColumn[]): BoardCache {
  return {
    board: { id: "b", org_id: "o" } as BoardCache["board"],
    groups: [],
    columns,
    items: [],
    cellValues: [
      { item_id: "i", column_id: "a" } as BoardCache["cellValues"][number],
    ],
    dependencies: [],
  };
}

describe("column cache mutators", () => {
  it("insertColumn appends + keeps position order + de-dupes by id", () => {
    let c = insertColumn(cache([col("a", 0)]), col("b", 1));
    expect(c.columns.map((x) => x.id)).toEqual(["a", "b"]);
    c = insertColumn(c, col("z", -1));
    expect(c.columns.map((x) => x.id)).toEqual(["z", "a", "b"]); // re-sorted
    c = insertColumn(c, col("a", 0));
    expect(c.columns).toHaveLength(3); // de-dupe
  });
  it("replaceColumn swaps by id (covers rename + width) and re-sorts", () => {
    const c = replaceColumn(
      cache([col("a", 0)]),
      col("a", 0, { name: "Renamed", width: 300 }),
    );
    expect(c.columns[0].name).toBe("Renamed");
    expect(c.columns[0].width).toBe(300);
  });
  it("removeColumn drops the column AND its cell values", () => {
    const c = removeColumn(cache([col("a", 0)]), "a");
    expect(c.columns).toHaveLength(0);
    expect(c.cellValues).toHaveLength(0); // 'a' cell removed
  });
});
```

- [ ] Run it, confirm FAIL: `pnpm test src/lib/boards/cache.test.ts`.
- [ ] Add the mutators to `src/lib/boards/cache.ts` (mirror `upsertCellValue`/`removeCellValue`; sort by `position`):

```ts
function byPosition(a: CacheColumn, b: CacheColumn) {
  return a.position - b.position;
}

/** Insert a column, keeping position order. No-op if the id already exists. */
export function insertColumn(cache: BoardCache, col: CacheColumn): BoardCache {
  if (cache.columns.some((c) => c.id === col.id)) return cache;
  return { ...cache, columns: [...cache.columns, col].sort(byPosition) };
}

/** Replace a column by id (rename/width/settings), keeping position order. */
export function replaceColumn(cache: BoardCache, col: CacheColumn): BoardCache {
  return {
    ...cache,
    columns: cache.columns
      .map((c) => (c.id === col.id ? col : c))
      .sort(byPosition),
  };
}

/** Remove a column and its cell values (mirrors the DB cascade). Immutable. */
export function removeColumn(cache: BoardCache, columnId: string): BoardCache {
  return {
    ...cache,
    columns: cache.columns.filter((c) => c.id !== columnId),
    cellValues: cache.cellValues.filter((c) => c.column_id !== columnId),
  };
}
```

- [ ] Run it, confirm PASS: `pnpm test src/lib/boards/cache.test.ts`.
- [ ] Commit: `git add src/lib/boards/cache.ts src/lib/boards/cache.test.ts && git commit -m "feat(boards): column cache mutators (insert/replace/remove)"`

---

## Task 7 — Mutation hooks + Realtime

**Files:** Modify `src/lib/boards/use-board-mutations.ts`, `src/lib/boards/use-board-realtime.ts`

These are `"use client"` hooks; they're covered by the component + e2e tests. Verify with `pnpm typecheck && pnpm lint`.

- [ ] In `src/lib/boards/use-board-mutations.ts`, extend the cache + actions imports:

```ts
import {
  createColumn,
  deleteColumn,
  renameColumn,
  resizeColumn,
} from "@/lib/boards/actions";
import {
  removeColumn,
  replaceColumn,
  type CacheColumn,
} from "@/lib/boards/cache";
import type { ColumnKind } from "@/lib/validations/boards";
```

- [ ] Inside `useBoardMutations(boardId)`, after `setCellMutation` (it already has `qc` + `key = boardKey(boardId)` in scope), add the four column mutations. Add is server-authoritative (inserts the returned row on success — Realtime echo is de-duped by id); rename/resize/delete are optimistic:

```ts
const addColumnMutation = useMutation<
  { columnId: string },
  Error,
  { kind: ColumnKind },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await createColumn({ boardId, kind: vars.kind });
    if (!res.ok) throw new Error(res.error);
    return res.data;
  },
  onSettled: () => {
    // The new column arrives via the columns Realtime subscription.
  },
});

function optimisticColumn(
  columnId: string,
  change: Partial<CacheColumn>,
): { previous?: BoardCache } {
  const previous = qc.getQueryData<BoardCache>(key);
  if (previous) {
    const current = previous.columns.find((c) => c.id === columnId);
    if (current)
      qc.setQueryData<BoardCache>(
        key,
        replaceColumn(previous, { ...current, ...change }),
      );
  }
  return { previous };
}

const renameColumnMutation = useMutation<
  unknown,
  Error,
  { columnId: string; name: string },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await renameColumn(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    return optimisticColumn(vars.columnId, { name: vars.name });
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});

const resizeColumnMutation = useMutation<
  unknown,
  Error,
  { columnId: string; width: number },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await resizeColumn(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    return optimisticColumn(vars.columnId, { width: vars.width });
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});

const deleteColumnMutation = useMutation<
  unknown,
  Error,
  { columnId: string },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await deleteColumn(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<BoardCache>(key);
    if (previous)
      qc.setQueryData<BoardCache>(key, removeColumn(previous, vars.columnId));
    return { previous };
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});
```

> Note: `Ctx` is the existing context type (`{ previous?: BoardCache }`) already declared in this file for the cell mutation. If it's not exported/shared, reuse the same inline shape. (Add is server-authoritative — the new column arrives via the columns Realtime subscription — so no `insertColumn` import is needed here; `insertColumn` is used only in the realtime file below.)

- [ ] Add the new mutations to the hook's returned object (match the existing return style), exposing callable wrappers:

```ts
return {
  // ...existing returns...
  addColumn: (kind: ColumnKind) => addColumnMutation.mutate({ kind }),
  renameColumn: (columnId: string, name: string) =>
    renameColumnMutation.mutate({ columnId, name }),
  resizeColumn: (columnId: string, width: number) =>
    resizeColumnMutation.mutate({ columnId, width }),
  deleteColumn: (columnId: string) => deleteColumnMutation.mutate({ columnId }),
};
```

- [ ] In `src/lib/boards/use-board-realtime.ts`, extend the cache import with the column mutators and `CacheColumn`:

```ts
import {
  addDependency,
  insertColumn,
  insertItem,
  removeCellValue,
  removeColumn,
  removeDependency,
  replaceColumn,
  replaceItem,
  upsertCellValue,
  type BoardCache,
  type CacheCellValue,
  type CacheColumn,
  type CacheDependency,
  type CacheItem,
} from "@/lib/boards/cache";
```

- [ ] Inside the `useEffect`, after `onDependency`, add the `onColumn` handler:

```ts
function onColumn(p: RealtimePostgresChangesPayload<CacheColumn>) {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheColumn>;
    if (oldRow.id) patch((prev) => removeColumn(prev, oldRow.id!));
    return;
  }
  const row = p.new as CacheColumn;
  patch((prev) =>
    prev.columns.some((c) => c.id === row.id)
      ? replaceColumn(prev, row)
      : insertColumn(prev, row),
  );
}
```

- [ ] Add the 4th subscription to the channel chain (after the `item_dependencies` `.on(...)`, before `.subscribe()`):

```ts
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "columns", filter },
        onColumn,
      )
```

- [ ] Verify: `pnpm typecheck && pnpm lint` (expected: PASS, 0 errors) and `pnpm test src/lib/boards/` (no regression).
- [ ] Commit: `git add src/lib/boards/use-board-mutations.ts src/lib/boards/use-board-realtime.ts && git commit -m "feat(boards): column mutation hooks + columns realtime"`

---

## Task 8 — UI: header menu, add-column picker, resize

**Files:** Create `src/components/ui/alert-dialog.tsx` (shadcn), `src/components/boards/ColumnHeader.tsx`, `src/components/boards/AddColumnMenu.tsx`; Modify `src/components/boards/BoardTable.tsx`; Create `src/components/boards/ColumnHeader.test.tsx`

> **UI sub-skills required first:** load `pulse-ui` (monochrome chrome + tokens) and `frontend-design`. Use existing `ui/dropdown-menu`, `ui/input`, `lucide-react`. There is no toast lib — surface action errors are rare here; rely on optimistic rollback. Build green-by-construction, then the component test.

- [ ] Add the missing shadcn primitive: run `yes '' | pnpm dlx shadcn@latest add alert-dialog -y` and confirm `src/components/ui/alert-dialog.tsx` now exists. Commit it separately: `git add src/components/ui/alert-dialog.tsx && git commit -m "chore(ui): add shadcn alert-dialog"`.

- [ ] Create `src/components/boards/AddColumnMenu.tsx`:

```tsx
"use client";

import {
  Plus,
  Type,
  CircleDot,
  Users,
  Calendar,
  Hash,
  Tags,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ColumnKind } from "@/lib/validations/boards";

const KINDS: { kind: ColumnKind; label: string; Icon: typeof Type }[] = [
  { kind: "text", label: "Text", Icon: Type },
  { kind: "status", label: "Status", Icon: CircleDot },
  { kind: "people", label: "People", Icon: Users },
  { kind: "date", label: "Date", Icon: Calendar },
  { kind: "numbers", label: "Numbers", Icon: Hash },
  { kind: "dropdown", label: "Dropdown", Icon: Tags },
];

export function AddColumnMenu({
  onAdd,
}: {
  onAdd: (kind: ColumnKind) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Add column"
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-full w-11 shrink-0 items-center justify-center border-l"
        >
          <Plus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {KINDS.map(({ kind, label, Icon }) => (
          <DropdownMenuItem key={kind} onSelect={() => onAdd(kind)}>
            <Icon className="size-4" /> {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] Create `src/components/boards/ColumnHeader.tsx` (name + ⋯ menu [Rename inline / Delete confirm] + a right-edge resize handle that reports drag deltas):

```tsx
"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Input } from "@/components/ui/input";
import type { CacheColumn } from "@/lib/boards/cache";

const MIN = 80;
const MAX = 1200;

export function ColumnHeader({
  column,
  width,
  onRename,
  onDelete,
  onResize,
  onResizeEnd,
}: {
  column: CacheColumn;
  width: number;
  onRename: (name: string) => void;
  onDelete: () => void;
  onResize: (width: number) => void; // live, each drag move (updates liveWidths)
  onResizeEnd: (width: number) => void; // on release (persists via resizeColumn)
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(column.name);

  function commitRename() {
    const v = draft.trim();
    if (v && v !== column.name) onRename(v);
    setEditing(false);
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = width;
    const move = (ev: PointerEvent) => {
      last = Math.min(MAX, Math.max(MIN, startW + (ev.clientX - startX)));
      onResize(last); // live
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onResizeEnd(last); // persist the final width
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="group/col relative flex items-center gap-1 border-l px-3 py-1.5">
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-6 px-1 text-xs"
          aria-label="Column name"
        />
      ) : (
        <>
          <span className="truncate">{column.name}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`${column.name} column menu`}
                className="text-muted-foreground hover:text-foreground ml-auto opacity-0 transition-opacity group-hover/col:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setDraft(column.name);
                  setEditing(true);
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => setConfirming(true)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* Resize handle on the right edge. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${column.name}`}
        onPointerDown={onPointerDown}
        className="hover:bg-primary/40 absolute top-0 right-0 h-full w-1 cursor-col-resize"
      />

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{column.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the column and all of its data on this
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
    </div>
  );
}
```

- [ ] Modify `src/components/boards/BoardTable.tsx`:
  - Replace the `gridTemplate(columnCount)` helper with a per-column-width version:

```ts
const NAME_COL_WIDTH = 280;
const VALUE_COL_WIDTH = 180;
const ADD_COL_WIDTH = 44;

/** CSS grid template: pinned Name + one fixed px track per column + the add-column slot. */
function gridTemplate(
  columns: { id: string; width: number | null }[],
  liveWidths: Record<string, number>,
): string {
  const tracks = columns
    .map((c) => `${liveWidths[c.id] ?? c.width ?? VALUE_COL_WIDTH}px`)
    .join(" ");
  return `${NAME_COL_WIDTH}px ${tracks} ${ADD_COL_WIDTH}px`;
}
```

- In the `BoardTable` component body, add `liveWidths` state and compute `template` from the real columns (replace the existing `gridTemplate(...)` call):

```ts
const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
const template = useMemo(
  () => gridTemplate(columns, liveWidths),
  [columns, liveWidths],
);
const mutations = useBoardMutations(payload.board.id);
```

(`useBoardMutations` may already be obtained in this component — if so, reuse it; otherwise add it. `columns` is `payload.columns`.)

- Replace the **header row** (the `{/* Column header row */}` block) so value-column headers render `ColumnHeader`, plus a trailing `AddColumnMenu`. The body rows are unchanged — they already consume `template`, which now has the extra trailing `ADD_COL_WIDTH` track, so add a matching empty trailing cell to each body row (see next bullet):

```tsx
{
  /* Column header row */
}
<div
  className="bg-surface-muted text-muted-foreground sticky top-0 z-20 grid border-b text-xs font-medium"
  style={{ gridTemplateColumns: template }}
>
  <div className="bg-surface-muted sticky left-0 z-10 truncate px-4 py-1.5">
    Name
  </div>
  {columns.map((col) => (
    <ColumnHeader
      key={col.id}
      column={col}
      width={liveWidths[col.id] ?? col.width ?? VALUE_COL_WIDTH}
      onRename={(name) => mutations.renameColumn(col.id, name)}
      onDelete={() => mutations.deleteColumn(col.id)}
      onResize={(w) => setLiveWidths((m) => ({ ...m, [col.id]: w }))}
      onResizeEnd={(w) => mutations.resizeColumn(col.id, w)}
    />
  ))}
  <AddColumnMenu onAdd={(kind) => mutations.addColumn(kind)} />
</div>;
```

> Resize flow: `onResize` updates `liveWidths` on every drag move (smooth, 0 round-trips); `onResizeEnd` fires once on pointer-up and calls `mutations.resizeColumn`, whose optimistic mutation writes the new `width` into the board cache so it survives a `liveWidths` reset and echoes to peers via Realtime.

- The body row (in `GroupSection`, the `virtualRows.map` `<div className="... grid ...">`) currently renders `<NameCell/>` + `columns.map(<EditableCell/>)`. Append one trailing empty cell so the grid's `ADD_COL_WIDTH` track is filled and stays aligned:

```tsx
                      <NameCell item={item} controls={controls} />
                      {columns.map((col) => (
                        <EditableCell
                          key={col.id}
                          item={item}
                          column={col}
                          value={cellMap.get(cellKey(item.id, col.id)) ?? null}
                          controls={controls}
                        />
                      ))}
                      <div aria-hidden /> {/* add-column track spacer */}
```

(The group band header and `AddItemRow` are not grids over `template`, so they need no change.)

- [ ] Create `src/components/boards/ColumnHeader.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColumnHeader } from "@/components/boards/ColumnHeader";
import type { CacheColumn } from "@/lib/boards/cache";

function col(over: Partial<CacheColumn> = {}): CacheColumn {
  return {
    id: "c1",
    org_id: "o",
    board_id: "b",
    kind: "text",
    name: "Notes",
    settings: {},
    position: 0,
    width: null,
    created_at: "2026-06-17T00:00:00Z",
    updated_at: "2026-06-17T00:00:00Z",
    ...over,
  } as CacheColumn;
}

describe("ColumnHeader", () => {
  it("renames via the menu → inline input → Enter", () => {
    const onRename = vi.fn();
    render(
      <ColumnHeader
        column={col()}
        width={180}
        onRename={onRename}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByLabelText("Column name");
    fireEvent.change(input, { target: { value: "Priority" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Priority");
  });

  it("confirms before delete", () => {
    const onDelete = vi.fn();
    render(
      <ColumnHeader
        column={col()}
        width={180}
        onRename={vi.fn()}
        onDelete={onDelete}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).not.toHaveBeenCalled(); // dialog open, not yet confirmed
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalled();
  });
});
```

- [ ] Run the component test: `pnpm test src/components/boards/ColumnHeader.test.tsx` (expected: PASS; the Radix jsdom shims in `vitest.setup.ts` cover the menu/dialog).
- [ ] Verify the whole view compiles + lints: `pnpm typecheck && pnpm lint && pnpm build`.
- [ ] Commit: `git add src/components/boards/ && git commit -m "feat(boards): column header menu, add-column picker, resize"`

---

## Task 9 — RLS integration + e2e

**Files:** Create `src/lib/boards/columns.rls.integration.test.ts`, `e2e/board-columns.spec.ts`

- [ ] Create `src/lib/boards/columns.rls.integration.test.ts` (two-user harness — copy the provisioning + skip-guard from `src/lib/boards/boards.rls.integration.test.ts`; provision `userA` with an org/board and `userB` in a separate org):

```ts
// Provisioning (admin + two users + per-user anon clients) follows
// boards.rls.integration.test.ts verbatim; the assertions specific to columns:

it("a member can create, rename, resize, then delete a column", async () => {
  const { data: created, error } = await userA.anon
    .from("columns")
    .insert({
      org_id: userA.orgId,
      board_id: userA.boardId,
      kind: "text",
      name: "Notes",
      settings: {},
      position: 99,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  const id = (created as { id: string }).id;

  expect(
    (await userA.anon.from("columns").update({ name: "Renamed" }).eq("id", id))
      .error,
  ).toBeNull();
  expect(
    (await userA.anon.from("columns").update({ width: 300 }).eq("id", id))
      .error,
  ).toBeNull();
  expect(
    (await userA.anon.from("columns").delete().eq("id", id)).error,
  ).toBeNull();
});

it("a different org cannot create or read another org's column", async () => {
  // userB inserts into userA's board/org → RLS with_check denies.
  const { error: insErr } = await userB.anon.from("columns").insert({
    org_id: userA.orgId,
    board_id: userA.boardId,
    kind: "text",
    name: "Evil",
    settings: {},
    position: 1,
  });
  expect(insErr).not.toBeNull();

  // And cannot see userA's seeded columns.
  const { data } = await userB.anon
    .from("columns")
    .select("id")
    .eq("board_id", userA.boardId);
  expect(data ?? []).toHaveLength(0);
});
```

- [ ] Run it: `pnpm test src/lib/boards/columns.rls.integration.test.ts` (PASS if `.env.local` has the service role; otherwise SKIPPED).
- [ ] Create `e2e/board-columns.spec.ts` (copy the login→onboard→create-board flow from `e2e/item-panel.spec.ts`; then):

```ts
// ...after a board is open (Group 1 visible)...
test.setTimeout(120_000);

// Add a Text column.
await page.getByRole("button", { name: "Add column" }).click();
await page.getByRole("menuitem", { name: "Text" }).click();
await expect(page.getByText("Text")).toBeVisible({ timeout: 15_000 });

// Rename it.
await page.getByText("Text").hover();
await page.getByRole("button", { name: "Text column menu" }).click();
await page.getByRole("menuitem", { name: "Rename" }).click();
const input = page.getByLabel("Column name");
await input.fill("Notes");
await input.press("Enter");
await expect(page.getByText("Notes")).toBeVisible();

// Delete it (confirm).
await page.getByText("Notes").hover();
await page.getByRole("button", { name: "Notes column menu" }).click();
await page.getByRole("menuitem", { name: "Delete" }).click();
await page.getByRole("button", { name: "Delete" }).click();
await expect(page.getByText("Notes")).toHaveCount(0, { timeout: 15_000 });
```

- [ ] Commit: `git add src/lib/boards/columns.rls.integration.test.ts e2e/board-columns.spec.ts && git commit -m "test(boards): column RLS integration + e2e"`

---

## Task 10 — Final gate + wrapup

**Files:** none (verification)

- [ ] Full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (all PASS; integration suites skip cleanly without secrets).
- [ ] Advisors: `supabase db lint --linked --level warning` — no new `columns` findings.
- [ ] If secrets present, run the e2e once: `pnpm e2e e2e/board-columns.spec.ts`.
- [ ] `/wrapup` → session note in `vault/sessions/` + bump the north-star (Phase 2c → Done).
- [ ] Commit any vault changes; push `develop` (coordinate if a parallel session shares the checkout).

---

## Appendix — invariant checklist

- [ ] Server Actions for every mutation; Zod at each boundary; RLS is the security guard (columns policies already exist).
- [ ] Schema change is one versioned migration; types regenerated + committed.
- [ ] gotcha-09: add/rename/delete/resize = optimistic cache + Realtime, no RSC refetch; resize = 0 round-trips during drag, 1 on release.
- [ ] `pulse-ui`: monochrome chrome, `text-destructive` only for delete, icon controls have `aria-label`, AA focus rings.
