# MCP Tool Layer Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution context:** the worktree already exists — `.claude/worktrees/mcp-tools-dedupe` on branch `task/mcp-tools-dedupe`, cut from `develop`. Work there (`EnterWorktree({ path: ".claude/worktrees/mcp-tools-dedupe" })` before dispatching subagents). Do **not** build on `develop`.
>
> **Spec:** `docs/superpowers/specs/2026-07-25-mcp-tools-dedupe-design.md` — read §4 (findings NOT to fix) and §7 (why the existing tests are an inadequate net) before Task 1.

**Goal:** Collapse the MCP tool layer's three verbatim duplications — `type GetClient` (6 copies), `writeCellValue` (2 byte-identical copies), and the `fieldInput` Zod schema (2 copies) — into one `src/lib/mcp/tools/shared.ts`, behind a characterization-test net that proves zero behavior change.

**Architecture:** One new module, `src/lib/mcp/tools/shared.ts`, exporting `GetClient`, `fieldInput`, `FieldInput`, and `writeCellValue`. The four read-only tools import `GetClient` **type-only** (so no runtime dependency edge is added); `create-item.ts` and `update-item.ts` import all four. `writeCellValue`'s body moves byte-identically — it is a literal cut-and-paste, which is what makes "no behavior change" provable rather than hoped-for. `register.ts` and `context.ts` are untouched. The canonical `upsertCell` in `src/lib/boards/actions/cell.ts` is deliberately **not** reused: it is a cookie-bound `"use server"` action (`createClient()` reads `next/headers` cookies) and an MCP request carries only a bearer token — see spec §3.

**Tech Stack:** TypeScript strict, Zod 4.4.3, Vitest 4 (`unit` project), `@modelcontextprotocol/sdk`, Supabase JS.

---

## Global Constraints

- **This is a pure refactor. Zero behavior change.** Every error string, every `isError` value, every upserted row field, and every query count stays identical. If a characterization test needs editing to go green after the extraction, **stop and report** — that is a behavior change, not a test problem.
- **Do NOT fix spec findings F1–F4.** In particular **F1** (MCP `people` cell writes never fan out `assigned` notifications, unlike `upsertCell`) is a real user-visible bug and belongs in its own `fix(mcp):` task. Adding the fan-out here would make the "no behavior change" claim false. Document it in `shared.ts`'s doc comment; do not implement it.
- **Test-file diffs are additive only.** Never edit or delete an existing `it(...)` block in `create-item.test.ts` / `update-item.test.ts`. Add new ones alongside. This keeps every diff mechanically reviewable.
- **`getClient()` must stay one call per tool invocation.** Each call charges the MCP rate limit (`src/lib/mcp/context.ts:39`) and rotates the bridge secret (`context.ts:50–51`). Never move it inside `writeCellValue` or into the field loop. Task 2/3 pin this with an assertion.
- **The field loop stays sequential** (`for … await`). `Promise.all` would change `fieldErrors` ordering — a behavior change (finding F4).
- TypeScript strict, no `any`. `src/types/database.types.ts` is generated — never hand-edited. No migrations in this task.
- Commit subjects: lowercase after `type(scope):` — commitlint rejects sentence-case (verified repo gotcha).
- Stage explicitly by path (`git add <paths>`). Never `git add -A` / `git add .` / `git commit -a`.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must all pass before `scripts/finish-task.sh`.

## Baseline (measured, 2026-07-25)

```
npx vitest run --project unit src/lib/mcp/
→ Test Files 13 passed (13)   Tests 28 passed (28)   1.71s
```

The six `src/lib/mcp/tools/*.test.ts` files hold **9** of those 28 tests. Expected total after this plan: **48** (28 baseline + 20 new).

---

## File Structure

| File                                                        | Responsibility                                                                                                                                                                                                                | Task |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `src/test/mcp-fake-client.ts` (**new**)                     | Test-support: chainable fake of the small Supabase surface the MCP handlers touch, plus a call log. Sits in `src/test/` beside `integration-auth.ts` / `integration-env.ts`, outside vitest's `src/**/*.{test,spec}.ts` glob. | 1    |
| `src/lib/mcp/tools/create-item.test.ts`                     | Characterization of `createItemHandler` (guards, row shape, `isError` aggregation, RPC failure). Keeps its `vi.mock` of `cellValueSchema`.                                                                                    | 2    |
| `src/lib/mcp/tools/update-item.test.ts`                     | Same for `updateItemHandler`, plus the rename-failure and no-op paths.                                                                                                                                                        | 3    |
| `src/lib/mcp/tools/cell-value-validation.test.ts` (**new**) | The one suite with **no** `vi.mock` — exercises the real `cellValueSchema(kind)`. Closes the biggest coverage hole (spec §7.1).                                                                                               | 4    |
| `src/lib/mcp/tools/shared.ts` (**new**)                     | The single home for `GetClient`, `fieldInput`, `FieldInput`, `writeCellValue`. Placed in `tools/`, not `mcp/`, because only tool modules consume it and `context.ts` must not depend on the tools it serves.                  | 5    |
| `src/lib/mcp/tools/list-boards.ts`                          | `GetClient` import swap only.                                                                                                                                                                                                 | 6    |
| `src/lib/mcp/tools/get-board.ts`                            | `GetClient` import swap only.                                                                                                                                                                                                 | 6    |
| `src/lib/mcp/tools/get-item.ts`                             | `GetClient` import swap only.                                                                                                                                                                                                 | 6    |
| `src/lib/mcp/tools/search-items.ts`                         | `GetClient` import swap only.                                                                                                                                                                                                 | 6    |
| `src/lib/mcp/tools/create-item.ts`                          | Delete local `GetClient` + `fieldInput` + `writeCellValue`; import from `./shared`.                                                                                                                                           | 7    |
| `src/lib/mcp/tools/update-item.ts`                          | Same.                                                                                                                                                                                                                         | 7    |
| `src/lib/mcp/tools/register.ts`                             | **Unchanged.**                                                                                                                                                                                                                | —    |
| `src/lib/mcp/context.ts`                                    | **Unchanged.**                                                                                                                                                                                                                | —    |

---

## Execution DAG

```
Batch A (nothing depends on yet):
  Task 1  — src/test/mcp-fake-client.ts (test-support builder)

Batch B (parallel — T2/T3/T4 need Task 1; T5 is purely additive and needs nothing):
  Task 2  — create-item characterization tests            [needs 1]
  Task 3  — update-item characterization tests            [needs 1]
  Task 4  — real-cellValueSchema characterization tests   [needs 1]
  Task 5  — create src/lib/mcp/tools/shared.ts            [needs nothing]

Batch C (parallel — disjoint file sets; both need the net from 2,3,4 and the module from 5):
  Task 6  — rewire the 4 read-only tools to shared GetClient   [needs 2,3,4,5]
  Task 7  — rewire create-item + update-item to ./shared       [needs 2,3,4,5]

Batch D:
  Task 8  — verification sweep + four gates + finish-task      [needs 6,7]
```

**Dependency graph:** T2→{1}, T3→{1}, T4→{1}, T5→{}, T6→{2,3,4,5}, T7→{2,3,4,5}, T8→{6,7}.

**Critical path:** Task 1 → Task 2 → Task 7 → Task 8 (4 deep). That is the wall-clock floor.

**Why Task 5 may run in Batch B despite the "net first" rule:** creating `shared.ts` is purely additive — nothing imports it yet, so it cannot change behavior. The rule that matters is _no **rewiring** before the net_, which is why T6/T7 (not T5) depend on T2/T3/T4.

**Why T6 and T7 are genuinely parallel:** disjoint file sets (`{list-boards, get-board, get-item, search-items}` vs `{create-item, update-item}`) and no shared symbols beyond read-only imports from `shared.ts`.

**Recommended execution, honestly:** this is a ~250-LOC change. If you are already in `subagent-driven-development`, dispatch Batch B as a genuine 4-way parallel wave (four disjoint files) — that is the only batch where parallelism pays. Batch C's two tasks are ~15 lines each; running them sequentially in one agent costs less than the dispatch overhead. Do **not** create nested worktrees for these batches: all tasks write to disjoint paths within the existing `mcp-tools-dedupe` worktree.

---

### Task 1: Test-support fake Supabase client

**Files:**

- Create: `src/test/mcp-fake-client.ts`

**Interfaces:**

- Produces: `makeFakeClient(spec?: FakeClientSpec): { getClient, calls }`, and the types `FakeClientSpec`, `FakeCalls`, `FakeResult<T>`, `ColumnRow`, `ItemRow`, `CreatedItem`, `Queued<T>`. Consumed by Tasks 2, 3, 4.
- Consumes: nothing.

**Why this exists:** Tasks 2–4 add 20 tests that all need the same chainable stub. The current tests hand-roll it per test (`create-item.test.ts:14–38`, `update-item.test.ts:14–41`, `:53–71`). Hand-copying a stub 20 times inside a _deduplication_ task would be self-defeating. It also confines the `as never` cast to one place instead of eight.

- [ ] **Step 1: Create the file**

Create `src/test/mcp-fake-client.ts` with exactly this content:

```ts
/**
 * Test-support fake for the MCP tool handlers' Supabase surface.
 *
 * The handlers in `src/lib/mcp/tools/` touch only four call shapes:
 *   - `.rpc(fn, args)`                                            (create_item)
 *   - `.from(t).select(…).eq(…).maybeSingle()`                    (column + item reads)
 *   - `.from("items").update(…).eq(…).select(…).maybeSingle()`    (rename)
 *   - `.from("cell_values").upsert(row, options)`                 (cell write)
 *
 * A structural fake of just those is safe and keeps the `as never` cast in one
 * place. Lives in `src/test/` beside `integration-auth.ts` / `integration-env.ts`
 * — outside vitest's `src/**` + `*.{test,spec}.{ts,tsx}` include glob, so it is
 * never collected as a suite.
 */

export type FakeError = { message: string } | null;
export type FakeResult<T> = { data: T; error: FakeError };

export type ColumnRow = {
  org_id: string;
  board_id: string;
  kind: string;
} | null;
export type ItemRow = { board_id: string } | null;
export type CreatedItem = {
  id: string;
  name: string;
  group_id: string;
} | null;

/** A single response, or a queue consumed in call order (the last entry repeats). */
export type Queued<T> = T | T[];

export type FakeClientSpec = {
  /** `supabase.rpc("create_item", …)` result. */
  rpc?: FakeResult<CreatedItem>;
  /** The `columns` read inside writeCellValue, per field. */
  column?: Queued<FakeResult<ColumnRow>>;
  /** The `items` read inside writeCellValue, per field. */
  item?: Queued<FakeResult<ItemRow>>;
  /** The `items` UPDATE (rename) in updateItemHandler. */
  rename?: FakeResult<ItemRow>;
  /** The `cell_values` upsert, per field. */
  upsert?: Queued<{ error: FakeError }>;
};

export type FakeCalls = {
  /** Every cell_values upsert, in order, with its options argument. */
  upserts: { row: unknown; options: unknown }[];
  /** Every rpc() call, in order. */
  rpc: { fn: string; args: unknown }[];
  /** How many times the handler resolved the request client. Must be 1. */
  getClient: number;
};

const OK_COLUMN: FakeResult<ColumnRow> = {
  data: { org_id: "o1", board_id: "b1", kind: "text" },
  error: null,
};
const OK_ITEM: FakeResult<ItemRow> = { data: { board_id: "b1" }, error: null };
const OK_RPC: FakeResult<CreatedItem> = {
  data: { id: "i1", name: "New task", group_id: "g1" },
  error: null,
};

function dequeue<T>(queued: Queued<T> | undefined, fallback: T, n: number): T {
  if (queued === undefined) return fallback;
  if (!Array.isArray(queued)) return queued;
  return queued[Math.min(n, queued.length - 1)] ?? fallback;
}

export function makeFakeClient(spec: FakeClientSpec = {}): {
  getClient: () => Promise<never>;
  calls: FakeCalls;
} {
  const calls: FakeCalls = { upserts: [], rpc: [], getClient: 0 };
  let columnReads = 0;
  let itemReads = 0;
  let upsertWrites = 0;

  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.rpc.push({ fn, args });
      return Promise.resolve(spec.rpc ?? OK_RPC);
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            table === "columns"
              ? Promise.resolve(dequeue(spec.column, OK_COLUMN, columnReads++))
              : Promise.resolve(dequeue(spec.item, OK_ITEM, itemReads++)),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: () => Promise.resolve(spec.rename ?? OK_ITEM),
          }),
        }),
      }),
      upsert: (row: unknown, options: unknown) => {
        calls.upserts.push({ row, options });
        return Promise.resolve(
          dequeue(spec.upsert, { error: null }, upsertWrites++),
        );
      },
    }),
  };

  return {
    getClient: () => {
      calls.getClient += 1;
      // `never` is assignable to SupabaseClient<Database>, which is what lets a
      // structural fake satisfy the handlers' `GetClient` signature.
      return Promise.resolve(client as never);
    },
    calls,
  };
}
```

- [ ] **Step 2: Verify it typechecks and is not collected as a suite**

Run: `pnpm typecheck`
Expected: exits 0, no output about `mcp-fake-client.ts`.

Run: `npx vitest run --project unit src/test/mcp-fake-client.ts`
Expected: `No test files found` — vitest exits non-zero, and that IS the confirmation (it is support code, not a suite), not a failure.

- [ ] **Step 3: Commit**

```bash
git add src/test/mcp-fake-client.ts
git commit -m "test(mcp): add fake supabase client builder for tool handler tests"
```

---

### Task 2: Characterize `createItemHandler`

**Files:**

- Modify: `src/lib/mcp/tools/create-item.test.ts` (append only — do **not** touch the existing `it` block at lines 12–47)

**Interfaces:**

- Consumes: `makeFakeClient` (Task 1); the exported `createItemHandler` (unchanged).
- Produces: the safety net Tasks 6/7 depend on.

**Note on scope of this file:** `create-item.test.ts:3–7` mocks `@/lib/validations/boards` so `cellValueSchema` always succeeds. That mock is file-scoped and hoisted; leave it. This task therefore covers the four guards, the row shape, the `isError` aggregation, and the RPC-failure path — **not** validation. Validation is Task 4's separate, unmocked file.

- [ ] **Step 1: Add the import**

In `src/lib/mcp/tools/create-item.test.ts`, change line 9 from:

```ts
import { createItemHandler } from "./create-item";
```

to:

```ts
import { makeFakeClient } from "@/test/mcp-fake-client";
import { createItemHandler } from "./create-item";
```

(The `vi.mock` block above it must stay first — `vi.mock` is hoisted, but keeping source order intact avoids confusion.)

- [ ] **Step 2: Append the eight characterization tests**

Insert these inside the existing `describe("createItemHandler", …)` block, after the current test:

```ts
it("writes the cell row with org_id/board_id derived from the column, on the (item_id, column_id) conflict target", async () => {
  const { getClient, calls } = makeFakeClient({
    rpc: {
      data: { id: "i1", name: "New task", group_id: "g1" },
      error: null,
    },
    column: {
      data: { org_id: "o1", board_id: "b1", kind: "text" },
      error: null,
    },
    item: { data: { board_id: "b1" }, error: null },
  });
  const result = await createItemHandler(getClient, {
    groupId: "g1",
    name: "New task",
    fields: [{ columnId: "c1", value: { text: "hello" } }],
  });
  // org_id/board_id MUST come from the column (the RLS-relevant derivation),
  // item_id from the RPC-created item — never from caller input.
  expect(calls.upserts).toHaveLength(1);
  expect(calls.upserts[0]?.row).toEqual({
    org_id: "o1",
    board_id: "b1",
    item_id: "i1",
    column_id: "c1",
    value: { text: "hello" },
  });
  expect(calls.upserts[0]?.options).toEqual({
    onConflict: "item_id,column_id",
  });
  expect(result.isError).toBeUndefined();
});

it("resolves the request client exactly once, even across multiple field writes", async () => {
  // Each getClient() charges the MCP rate limit and rotates the bridge secret
  // (src/lib/mcp/context.ts:39,50-51) — it must never move into the field loop.
  const { getClient, calls } = makeFakeClient();
  await createItemHandler(getClient, {
    groupId: "g1",
    name: "New task",
    fields: [
      { columnId: "c1", value: { text: "a" } },
      { columnId: "c2", value: { text: "b" } },
    ],
  });
  expect(calls.getClient).toBe(1);
  expect(calls.upserts).toHaveLength(2);
});

it("returns isError with the RPC message when create_item fails, writing no fields", async () => {
  const { getClient, calls } = makeFakeClient({
    rpc: { data: null, error: { message: "group not found" } },
  });
  const result = await createItemHandler(getClient, {
    groupId: "g1",
    name: "New task",
    fields: [{ columnId: "c1", value: { text: "a" } }],
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toBe("group not found");
  expect(calls.upserts).toHaveLength(0);
});

it("reports a missing column without writing, prefixed with the column id", async () => {
  const { getClient, calls } = makeFakeClient({
    column: { data: null, error: null },
  });
  const result = await createItemHandler(getClient, {
    groupId: "g1",
    name: "New task",
    fields: [{ columnId: "c1", value: { text: "a" } }],
  });
  expect(calls.upserts).toHaveLength(0);
  const parsed = JSON.parse(result.content[0]?.text as string);
  expect(parsed.fieldErrors).toEqual(["c1: Column c1 not found."]);
  expect(result.isError).toBe(true);
});

it("reports a missing item without writing", async () => {
  const { getClient, calls } = makeFakeClient({
    item: { data: null, error: null },
  });
  const result = await createItemHandler(getClient, {
    groupId: "g1",
    name: "New task",
    fields: [{ columnId: "c1", value: { text: "a" } }],
  });
  expect(calls.upserts).toHaveLength(0);
  const parsed = JSON.parse(result.content[0]?.text as string);
  expect(parsed.fieldErrors).toEqual(["c1: Item not found."]);
  expect(result.isError).toBe(true);
});

it("propagates an upsert error into fieldErrors", async () => {
  const { getClient } = makeFakeClient({
    upsert: { error: { message: "duplicate key value" } },
  });
  const result = await createItemHandler(getClient, {
    groupId: "g1",
    name: "New task",
    fields: [{ columnId: "c1", value: { text: "a" } }],
  });
  const parsed = JSON.parse(result.content[0]?.text as string);
  expect(parsed.fieldErrors).toEqual(["c1: duplicate key value"]);
  expect(result.isError).toBe(true);
});

it("leaves isError unset when only SOME field writes fail", async () => {
  const { getClient, calls } = makeFakeClient({
    // Second field's item read reports a different board -> cross-board guard.
    item: [
      { data: { board_id: "b1" }, error: null },
      { data: { board_id: "b2" }, error: null },
    ],
  });
  const result = await createItemHandler(getClient, {
    groupId: "g1",
    name: "New task",
    fields: [
      { columnId: "c1", value: { text: "a" } },
      { columnId: "c2", value: { text: "b" } },
    ],
  });
  expect(calls.upserts).toHaveLength(1);
  const parsed = JSON.parse(result.content[0]?.text as string);
  expect(parsed.fieldErrors).toEqual([
    "c2: Item and column belong to different boards.",
  ]);
  expect(result.isError).toBeUndefined();
});

it("sets isError when EVERY field write fails", async () => {
  const { getClient, calls } = makeFakeClient({
    item: { data: { board_id: "b2" }, error: null },
  });
  const result = await createItemHandler(getClient, {
    groupId: "g1",
    name: "New task",
    fields: [
      { columnId: "c1", value: { text: "a" } },
      { columnId: "c2", value: { text: "b" } },
    ],
  });
  expect(calls.upserts).toHaveLength(0);
  const parsed = JSON.parse(result.content[0]?.text as string);
  expect(parsed.fieldErrors).toHaveLength(2);
  expect(result.isError).toBe(true);
});
```

- [ ] **Step 3: Run them — they must PASS against unmodified source**

Run: `npx vitest run --project unit src/lib/mcp/tools/create-item.test.ts`
Expected: `Tests 9 passed (9)` (1 pre-existing + 8 new). These are _characterization_ tests: passing immediately is correct — their job is to pin current behavior, not to drive new code.

- [ ] **Step 4: Prove the row-shape test is load-bearing**

A characterization test that cannot fail is worse than none. Temporarily break the behavior it pins:

In `src/lib/mcp/tools/create-item.ts` line 47, change `org_id: column.org_id,` to `org_id: item.board_id,`.

Run: `npx vitest run --project unit src/lib/mcp/tools/create-item.test.ts`
Expected: **FAIL** — 1 failed, on "writes the cell row with org_id/board_id derived from the column…", showing `org_id: "b1"` received vs `"o1"` expected.

Then revert:

```bash
git checkout -- src/lib/mcp/tools/create-item.ts
```

Run: `npx vitest run --project unit src/lib/mcp/tools/create-item.test.ts`
Expected: `Tests 9 passed (9)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools/create-item.test.ts
git commit -m "test(mcp): characterize create_item field writes and isError aggregation"
```

---

### Task 3: Characterize `updateItemHandler`

**Files:**

- Modify: `src/lib/mcp/tools/update-item.test.ts` (append only — do **not** touch the existing `it` blocks at lines 12–49 and 51–81)

**Interfaces:**

- Consumes: `makeFakeClient` (Task 1); the exported `updateItemHandler` (unchanged).
- Produces: the safety net Tasks 6/7 depend on.

**Note:** like `create-item.test.ts`, this file's `vi.mock` at lines 3–7 neutralizes `cellValueSchema`. Leave it. Validation lives in Task 4.

- [ ] **Step 1: Add the import**

In `src/lib/mcp/tools/update-item.test.ts`, change line 9 from:

```ts
import { updateItemHandler } from "./update-item";
```

to:

```ts
import { makeFakeClient } from "@/test/mcp-fake-client";
import { updateItemHandler } from "./update-item";
```

- [ ] **Step 2: Append the nine characterization tests**

Insert inside the existing `describe("updateItemHandler", …)` block, after the current two tests:

```ts
it("writes the cell row with org_id/board_id from the column and item_id from the input", async () => {
  const { getClient, calls } = makeFakeClient({
    column: {
      data: { org_id: "o1", board_id: "b1", kind: "text" },
      error: null,
    },
    item: { data: { board_id: "b1" }, error: null },
  });
  const result = await updateItemHandler(getClient, {
    itemId: "i9",
    fields: [{ columnId: "c1", value: { text: "hello" } }],
  });
  expect(calls.upserts).toHaveLength(1);
  expect(calls.upserts[0]?.row).toEqual({
    org_id: "o1",
    board_id: "b1",
    item_id: "i9",
    column_id: "c1",
    value: { text: "hello" },
  });
  expect(calls.upserts[0]?.options).toEqual({
    onConflict: "item_id,column_id",
  });
  expect(result.isError).toBeUndefined();
});

it("resolves the request client exactly once, even across multiple field writes", async () => {
  // Each getClient() charges the MCP rate limit and rotates the bridge secret
  // (src/lib/mcp/context.ts:39,50-51) — it must never move into the field loop.
  const { getClient, calls } = makeFakeClient();
  await updateItemHandler(getClient, {
    itemId: "i1",
    name: "Renamed",
    fields: [
      { columnId: "c1", value: { text: "a" } },
      { columnId: "c2", value: { text: "b" } },
    ],
  });
  expect(calls.getClient).toBe(1);
  expect(calls.upserts).toHaveLength(2);
});

it("returns isError and writes no fields when the rename fails", async () => {
  const { getClient, calls } = makeFakeClient({
    rename: { data: null, error: { message: "row not found" } },
  });
  const result = await updateItemHandler(getClient, {
    itemId: "i1",
    name: "Renamed",
    fields: [{ columnId: "c1", value: { text: "a" } }],
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toBe("row not found");
  expect(calls.upserts).toHaveLength(0);
});

it("returns isError with a generic message when the rename returns no row", async () => {
  const { getClient } = makeFakeClient({
    rename: { data: null, error: null },
  });
  const result = await updateItemHandler(getClient, {
    itemId: "i1",
    name: "Renamed",
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toBe("Item not found.");
});

it("reports a missing column without writing, prefixed with the column id", async () => {
  const { getClient, calls } = makeFakeClient({
    column: { data: null, error: null },
  });
  const result = await updateItemHandler(getClient, {
    itemId: "i1",
    fields: [{ columnId: "c1", value: { text: "a" } }],
  });
  expect(calls.upserts).toHaveLength(0);
  const parsed = JSON.parse(result.content[0]?.text as string);
  expect(parsed.fieldErrors).toEqual(["c1: Column c1 not found."]);
  expect(result.isError).toBe(true);
});

it("reports a missing item without writing", async () => {
  const { getClient, calls } = makeFakeClient({
    item: { data: null, error: null },
  });
  const result = await updateItemHandler(getClient, {
    itemId: "i1",
    fields: [{ columnId: "c1", value: { text: "a" } }],
  });
  expect(calls.upserts).toHaveLength(0);
  const parsed = JSON.parse(result.content[0]?.text as string);
  expect(parsed.fieldErrors).toEqual(["c1: Item not found."]);
  expect(result.isError).toBe(true);
});

it("propagates an upsert error into fieldErrors", async () => {
  const { getClient } = makeFakeClient({
    upsert: { error: { message: "value too long" } },
  });
  const result = await updateItemHandler(getClient, {
    itemId: "i1",
    fields: [{ columnId: "c1", value: { text: "a" } }],
  });
  const parsed = JSON.parse(result.content[0]?.text as string);
  expect(parsed.fieldErrors).toEqual(["c1: value too long"]);
  expect(result.isError).toBe(true);
});

it("leaves isError unset when only SOME field writes fail", async () => {
  const { getClient, calls } = makeFakeClient({
    item: [
      { data: { board_id: "b1" }, error: null },
      { data: { board_id: "b2" }, error: null },
    ],
  });
  const result = await updateItemHandler(getClient, {
    itemId: "i1",
    fields: [
      { columnId: "c1", value: { text: "a" } },
      { columnId: "c2", value: { text: "b" } },
    ],
  });
  expect(calls.upserts).toHaveLength(1);
  const parsed = JSON.parse(result.content[0]?.text as string);
  expect(parsed.fieldErrors).toEqual([
    "c2: Item and column belong to different boards.",
  ]);
  expect(result.isError).toBeUndefined();
});

it("reports success for a no-op update (documented current behavior — spec finding F2)", async () => {
  // With neither `name` nor `fields`, the handler never verifies the item
  // exists and reports success. Pinned deliberately so the behavior is
  // intentional, not accidental. Do NOT "fix" this here — see spec §4 F2.
  const { getClient, calls } = makeFakeClient();
  const result = await updateItemHandler(getClient, {
    itemId: "does-not-exist",
  });
  expect(result.isError).toBeUndefined();
  expect(calls.upserts).toHaveLength(0);
  const parsed = JSON.parse(result.content[0]?.text as string);
  expect(parsed).toEqual({ itemId: "does-not-exist", fieldErrors: [] });
});
```

- [ ] **Step 3: Run them — they must PASS against unmodified source**

Run: `npx vitest run --project unit src/lib/mcp/tools/update-item.test.ts`
Expected: `Tests 11 passed (11)` (2 pre-existing + 9 new).

- [ ] **Step 4: Prove the row-shape test is load-bearing**

In `src/lib/mcp/tools/update-item.ts` line 53, change `{ onConflict: "item_id,column_id" },` to `{ onConflict: "item_id" },`.

Run: `npx vitest run --project unit src/lib/mcp/tools/update-item.test.ts`
Expected: **FAIL** on "writes the cell row with org_id/board_id from the column and item_id from the input".

Then revert:

```bash
git checkout -- src/lib/mcp/tools/update-item.ts
```

Run: `npx vitest run --project unit src/lib/mcp/tools/update-item.test.ts`
Expected: `Tests 11 passed (11)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools/update-item.test.ts
git commit -m "test(mcp): characterize update_item rename, field writes and no-op path"
```

---

### Task 4: Characterize the real `cellValueSchema` guard

**Files:**

- Create: `src/lib/mcp/tools/cell-value-validation.test.ts`

**Interfaces:**

- Consumes: `makeFakeClient` (Task 1); `createItemHandler`, `updateItemHandler` (unchanged).
- Produces: the only coverage of the per-kind validation guard.

**Why a separate file:** `vi.mock` is file-scoped and hoisted. Both existing suites mock `@/lib/validations/boards` so `cellValueSchema` always succeeds — so the guard that is the _whole point_ of `writeCellValue` is currently never exercised (spec §7.1). The only way to test the real schema without editing those files is a new suite with no mock.

- [ ] **Step 1: Create the file**

Create `src/lib/mcp/tools/cell-value-validation.test.ts` with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import { makeFakeClient } from "@/test/mcp-fake-client";
import { createItemHandler } from "./create-item";
import { updateItemHandler } from "./update-item";

/**
 * This file deliberately does NOT `vi.mock("@/lib/validations/boards")`.
 *
 * The sibling `create-item.test.ts` / `update-item.test.ts` suites do, which
 * stubs `cellValueSchema` into an always-succeed passthrough and leaves the
 * per-kind validation guard — the whole point of `writeCellValue` — untested.
 * These tests exercise the REAL `cellValueSchema(column.kind)`.
 */
describe("MCP field writes run the real cellValueSchema", () => {
  it("writes the PARSED value, dropping keys the column kind does not define", async () => {
    // textValueSchema is z.object({ text: z.string() }); zod strips unknown
    // keys, so `bogus` must not reach the database. This simultaneously proves
    // the real schema ran AND that valueParsed.data (not field.value) is written.
    const { getClient, calls } = makeFakeClient({
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "text" },
        error: null,
      },
    });
    const result = await createItemHandler(getClient, {
      groupId: "g1",
      name: "New task",
      fields: [{ columnId: "c1", value: { text: "hello", bogus: "dropped" } }],
    });
    expect(result.isError).toBeUndefined();
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0]?.row).toEqual({
      org_id: "o1",
      board_id: "b1",
      item_id: "i1",
      column_id: "c1",
      value: { text: "hello" },
    });
  });

  it("rejects a value that does not match the column kind, surfacing zod's message", async () => {
    const { getClient, calls } = makeFakeClient({
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "numbers" },
        error: null,
      },
    });
    const result = await updateItemHandler(getClient, {
      itemId: "i1",
      fields: [{ columnId: "c1", value: { n: "not a number" } }],
    });
    expect(calls.upserts).toHaveLength(0);
    const parsed = JSON.parse(result.content[0]?.text as string);
    // Verified against the pinned zod 4.4.3. If a zod upgrade changes this
    // string, the text an MCP agent sees changed too — that IS the signal.
    expect(parsed.fieldErrors).toEqual([
      "c1: Invalid input: expected number, received string",
    ]);
    expect(result.isError).toBe(true);
  });

  it("accepts a valid value for a non-text column kind", async () => {
    const { getClient, calls } = makeFakeClient({
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "checkbox" },
        error: null,
      },
    });
    const result = await updateItemHandler(getClient, {
      itemId: "i1",
      fields: [{ columnId: "c1", value: { checked: true } }],
    });
    expect(result.isError).toBeUndefined();
    expect(calls.upserts[0]?.row).toMatchObject({ value: { checked: true } });
  });
});
```

- [ ] **Step 2: Run — must PASS against unmodified source**

Run: `npx vitest run --project unit src/lib/mcp/tools/cell-value-validation.test.ts`
Expected: `Tests 3 passed (3)`.

- [ ] **Step 3: Prove the strip test is load-bearing**

In `src/lib/mcp/tools/create-item.ts` line 51, change `value: valueParsed.data as Json,` to `value: field.value as Json,`.

Run: `npx vitest run --project unit src/lib/mcp/tools/cell-value-validation.test.ts`
Expected: **FAIL** on "writes the PARSED value…" — received `value: { text: "hello", bogus: "dropped" }`.

Then revert:

```bash
git checkout -- src/lib/mcp/tools/create-item.ts
```

Run: `npx vitest run --project unit src/lib/mcp/tools/cell-value-validation.test.ts`
Expected: `Tests 3 passed (3)`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mcp/tools/cell-value-validation.test.ts
git commit -m "test(mcp): cover the real cellValueSchema guard in field writes"
```

---

### Task 5: Create `src/lib/mcp/tools/shared.ts`

**Files:**

- Create: `src/lib/mcp/tools/shared.ts`

**Interfaces:**

- Consumes: `zod`, `@supabase/supabase-js` (types), `@/types/database.types` (types), `@/lib/validations/boards` (`cellValueSchema`).
- Produces: `type GetClient`, `const fieldInput`, `type FieldInput`, `async function writeCellValue`. Consumed by Task 6 (`GetClient` only) and Task 7 (all four).

**Provenance:** `writeCellValue`'s body is a **byte-identical** copy of `create-item.ts:20–56` and `update-item.ts:20–56` (verified by diff — the only hunk is a trailing blank line outside the function). Copy it, do not retype it. Every error string must survive character-identical: they are the text an MCP agent reads out of `fieldErrors`.

**Type-safety note (verified):** `z.infer<typeof fieldInput>` under the pinned zod 4.4.3 is bidirectionally assignable with the hand-written `{ columnId: string; value: Record<string, unknown> }` that both handlers currently use inline, so swapping to `FieldInput` in Task 7 is type-neutral.

- [ ] **Step 1: Create the file**

Create `src/lib/mcp/tools/shared.ts` with exactly this content:

```ts
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";
import { cellValueSchema } from "@/lib/validations/boards";

/**
 * Resolves the per-request, RLS-respecting Supabase client for the authenticated
 * MCP connection. Produced once per tool call in `register.ts`, which closes over
 * `getRequestClient` (`src/lib/mcp/context.ts`).
 *
 * Call it exactly ONCE per handler invocation: each call charges the MCP rate
 * limit and rotates the OAuth bridge secret (`context.ts:39,50-51`). Never call
 * it inside a per-field loop.
 */
export type GetClient = () => Promise<SupabaseClient<Database>>;

/** One field write in `create_item` / `update_item`: a column id plus its raw value. */
export const fieldInput = z.object({
  columnId: z.string().uuid(),
  value: z.record(z.string(), z.unknown()),
});

export type FieldInput = z.infer<typeof fieldInput>;

/**
 * Writes one cell value, mirroring the guard logic in
 * `src/lib/boards/actions/cell.ts`'s `upsertCell`. Returns `null` on success, or
 * a human-readable message the caller surfaces to the agent in `fieldErrors`.
 *
 * Deliberately NOT `upsertCell` itself: that is a cookie-bound `"use server"`
 * action (it calls `createClient()`, which reads `next/headers` cookies), and an
 * MCP request carries only an OAuth bearer token resolved to a bridged client.
 * Calling it here would silently build an unauthenticated client and fail under
 * RLS. See `docs/superpowers/plans/2026-07-24-mcp-server.md` Global Constraints.
 *
 * KNOWN GAP (do not fix here): unlike `upsertCell`, this does not fan out
 * `assigned` notifications when writing a `people` column, so assigning someone
 * via MCP never notifies them. Tracked as finding F1 in
 * `docs/superpowers/specs/2026-07-25-mcp-tools-dedupe-design.md`; the fix is to
 * hoist a client-injected core out of `upsertCell` so both callers share it.
 */
export async function writeCellValue(
  supabase: SupabaseClient<Database>,
  itemId: string,
  field: FieldInput,
): Promise<string | null> {
  const { data: column, error: colErr } = await supabase
    .from("columns")
    .select("org_id, board_id, kind")
    .eq("id", field.columnId)
    .maybeSingle();
  if (colErr || !column) return `Column ${field.columnId} not found.`;

  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("board_id")
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr || !item) return "Item not found.";
  if (item.board_id !== column.board_id)
    return "Item and column belong to different boards.";

  const valueParsed = cellValueSchema(column.kind).safeParse(field.value);
  if (!valueParsed.success)
    return valueParsed.error.issues[0]?.message ?? "Invalid value.";

  const { error } = await supabase.from("cell_values").upsert(
    {
      org_id: column.org_id,
      board_id: column.board_id,
      item_id: itemId,
      column_id: field.columnId,
      value: valueParsed.data as Json,
    },
    { onConflict: "item_id,column_id" },
  );
  return error?.message ?? null;
}
```

- [ ] **Step 2: Verify the body is byte-identical to both originals**

Run:

```bash
diff <(sed -n '/^export async function writeCellValue($/,/^}$/p' src/lib/mcp/tools/shared.ts | sed '1,5d') \
     <(sed -n '/^async function writeCellValue($/,/^}$/p' src/lib/mcp/tools/create-item.ts | sed '1,5d')
```

Expected: **no output** — identical from the first statement to the closing brace. The 5 skipped lines are the signature block, which legitimately differs (`export` prefix, and `field: FieldInput` vs the inline `field: { columnId: string; value: Record<string, unknown> }`).

If it differs, you retyped instead of copying — fix it to match `create-item.ts:25–56` exactly.

- [ ] **Step 3: Verify it typechecks and lints in isolation**

Run: `pnpm typecheck`
Expected: exits 0.

Run: `pnpm lint`
Expected: exits 0. (Nothing imports `shared.ts` yet — that is fine, exported symbols are not flagged as unused.)

Run: `npx vitest run --project unit src/lib/mcp/`
Expected: all green, with the **same** test count you had before this task — nothing imports the new module yet, so behavior cannot have changed. (That count is 28 if this task ran in parallel with Tasks 2–4 before they landed, 48 once all three have.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/mcp/tools/shared.ts
git commit -m "refactor(mcp): add shared tools module for GetClient and writeCellValue"
```

---

### Task 6: Rewire the four read-only tools to the shared `GetClient`

**Files:**

- Modify: `src/lib/mcp/tools/list-boards.ts:1-5`
- Modify: `src/lib/mcp/tools/get-board.ts:1-6`
- Modify: `src/lib/mcp/tools/get-item.ts:1-6`
- Modify: `src/lib/mcp/tools/search-items.ts:1-6`

**Interfaces:**

- Consumes: `type GetClient` from `./shared` (Task 5).
- Produces: nothing new. `listBoardsHandler`, `getBoardHandler`, `getItemHandler`, `searchItemsHandler` and their four `register*Tool` functions keep their exact exported signatures, so `register.ts` and all existing tests compile untouched.

**Critical:** use `import type { GetClient }`, never a value import. `shared.ts` has runtime imports (`zod`, `cellValueSchema`); a type-only import is fully erased at compile time, so these four read-only modules gain **zero** runtime dependency edge. A value import would pull the validation layer into every read tool's module graph for no reason.

- [ ] **Step 1: Rewrite the import block in `list-boards.ts`**

Replace lines 1–5 of `src/lib/mcp/tools/list-boards.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type GetClient = () => Promise<SupabaseClient<Database>>;
```

with:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "./shared";
```

- [ ] **Step 2: Rewrite the import block in `get-board.ts`**

Replace lines 1–6 of `src/lib/mcp/tools/get-board.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type GetClient = () => Promise<SupabaseClient<Database>>;
```

with:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "./shared";
```

- [ ] **Step 3: Rewrite the import block in `get-item.ts`**

Replace lines 1–6 of `src/lib/mcp/tools/get-item.ts` — the block is character-identical to `get-board.ts`'s — with:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "./shared";
```

- [ ] **Step 4: Rewrite the import block in `search-items.ts`**

Replace lines 1–6 of `src/lib/mcp/tools/search-items.ts` — again character-identical — with:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient } from "./shared";
```

- [ ] **Step 5: Verify no local `GetClient` survives in these four files**

Run:

```bash
grep -n "type GetClient" src/lib/mcp/tools/list-boards.ts src/lib/mcp/tools/get-board.ts src/lib/mcp/tools/get-item.ts src/lib/mcp/tools/search-items.ts
```

Expected: only the four `import type { GetClient } from "./shared";` lines — no `type GetClient = …` declarations.

- [ ] **Step 6: Run the gates for this slice**

Run: `pnpm typecheck`
Expected: exits 0. (This is also the check that no now-unused `SupabaseClient` / `Database` import was left behind — `pnpm lint` reports those.)

Run: `pnpm lint`
Expected: exits 0, no `@typescript-eslint/no-unused-vars` reports.

Run: `npx vitest run --project unit src/lib/mcp/`
Expected: `Tests 48 passed (48)` — every test unmodified.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/tools/list-boards.ts src/lib/mcp/tools/get-board.ts src/lib/mcp/tools/get-item.ts src/lib/mcp/tools/search-items.ts
git commit -m "refactor(mcp): import shared GetClient type in read-only tools"
```

---

### Task 7: Rewire `create-item.ts` and `update-item.ts` to `./shared`

**Files:**

- Modify: `src/lib/mcp/tools/create-item.ts:1-63`
- Modify: `src/lib/mcp/tools/update-item.ts:1-63`

**Interfaces:**

- Consumes: `GetClient`, `fieldInput`, `FieldInput`, `writeCellValue` from `./shared` (Task 5).
- Produces: nothing new. `createItemHandler`, `updateItemHandler`, `registerCreateItemTool`, `registerUpdateItemTool` keep their exact exported signatures.

**What is deleted:** in each file — the local `type GetClient`, the local `const fieldInput`, the local `async function writeCellValue` (and its doc comment in `create-item.ts`), and the now-unused `SupabaseClient` / `Database` / `Json` / `cellValueSchema` imports. **What is NOT touched:** both handler bodies, both `register*Tool` functions, both `*Input` schema objects (beyond referencing the shared `fieldInput`), and the sequential `for … await` field loop.

- [ ] **Step 1: Replace lines 1–17 of `create-item.ts`**

Replace:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";
import { cellValueSchema } from "@/lib/validations/boards";

type GetClient = () => Promise<SupabaseClient<Database>>;

const fieldInput = z.object({
  columnId: z.string().uuid(),
  value: z.record(z.string(), z.unknown()),
});
const createItemInput = {
  groupId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  fields: z.array(fieldInput).max(50).optional(),
};
```

with:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fieldInput,
  writeCellValue,
  type FieldInput,
  type GetClient,
} from "./shared";

const createItemInput = {
  groupId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  fields: z.array(fieldInput).max(50).optional(),
};
```

- [ ] **Step 2: Delete the local `writeCellValue` from `create-item.ts`**

Delete the doc comment at line 19 and the whole `async function writeCellValue(…) { … }` block (originally lines 20–56), leaving one blank line between `createItemInput` and `export async function createItemHandler`.

- [ ] **Step 3: Use `FieldInput` in `createItemHandler`'s signature**

Replace:

```ts
export async function createItemHandler(
  getClient: GetClient,
  input: {
    groupId: string;
    name: string;
    fields?: { columnId: string; value: Record<string, unknown> }[];
  },
) {
```

with:

```ts
export async function createItemHandler(
  getClient: GetClient,
  input: {
    groupId: string;
    name: string;
    fields?: FieldInput[];
  },
) {
```

Everything below this — the RPC call, the `for` loop, the `fieldErrors` aggregation, the return value, and `registerCreateItemTool` — is unchanged.

- [ ] **Step 4: Replace lines 1–18 of `update-item.ts`**

Replace:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { cellValueSchema } from "@/lib/validations/boards";
import type { Json } from "@/types/database.types";

type GetClient = () => Promise<SupabaseClient<Database>>;

const fieldInput = z.object({
  columnId: z.string().uuid(),
  value: z.record(z.string(), z.unknown()),
});
const updateItemInput = {
  itemId: z.string().uuid(),
  name: z.string().trim().min(1).max(255).optional(),
  fields: z.array(fieldInput).max(50).optional(),
};
```

with:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fieldInput,
  writeCellValue,
  type FieldInput,
  type GetClient,
} from "./shared";

const updateItemInput = {
  itemId: z.string().uuid(),
  name: z.string().trim().min(1).max(255).optional(),
  fields: z.array(fieldInput).max(50).optional(),
};
```

- [ ] **Step 5: Delete the local `writeCellValue` from `update-item.ts`**

Delete the whole `async function writeCellValue(…) { … }` block (originally lines 20–56), leaving one blank line between `updateItemInput` and `export async function updateItemHandler`.

- [ ] **Step 6: Use `FieldInput` in `updateItemHandler`'s signature**

Replace:

```ts
export async function updateItemHandler(
  getClient: GetClient,
  input: {
    itemId: string;
    name?: string;
    fields?: { columnId: string; value: Record<string, unknown> }[];
  },
) {
```

with:

```ts
export async function updateItemHandler(
  getClient: GetClient,
  input: {
    itemId: string;
    name?: string;
    fields?: FieldInput[];
  },
) {
```

Everything below — the rename block, the `for` loop, the return value, and `registerUpdateItemTool` — is unchanged.

- [ ] **Step 7: Run the characterization net — it must pass UNMODIFIED**

Run: `npx vitest run --project unit src/lib/mcp/`
Expected: `Tests 48 passed (48)`.

**If any test fails, do not edit the test.** A failure here means the extraction changed behavior. Diff your edit against the original body, fix the source, and re-run. If a test genuinely encodes something the shared helper cannot preserve, **stop and report** — that is a scope escalation, not a test fix.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/tools/create-item.ts src/lib/mcp/tools/update-item.ts
git commit -m "refactor(mcp): use shared writeCellValue and fieldInput in item tools"
```

---

### Task 8: Verification sweep, four gates, finish

**Files:** none modified (verification only).

**Interfaces:**

- Consumes: everything from Tasks 1–7.
- Produces: a merged `develop` and a deleted `task/mcp-tools-dedupe` branch.

- [ ] **Step 1: Prove the duplication is gone**

All five greps below exclude test files (which legitimately mention these symbols in mocks and comments). Run each and check the expected count exactly.

```bash
grep -rn "type GetClient" src/
```

Expected: exactly **1** line — `src/lib/mcp/tools/shared.ts:…:export type GetClient = () => Promise<SupabaseClient<Database>>;`. (This pattern does not match the `import type { GetClient }` form, so no filtering is needed.)

```bash
grep -rn "writeCellValue" src/lib/mcp/ | grep -v "\.test\.ts"
```

Expected: exactly **5** lines —

1. `shared.ts` — `export async function writeCellValue(`
2. `create-item.ts` — `  writeCellValue,` (inside the `from "./shared"` import block)
3. `create-item.ts` — `const err = await writeCellValue(supabase, item.id, field);`
4. `update-item.ts` — `  writeCellValue,`
5. `update-item.ts` — `const err = await writeCellValue(supabase, input.itemId, field);`

There must be **no second `async function writeCellValue`**.

```bash
grep -rn 'from("cell_values")' src/lib/mcp/
```

Expected: exactly **2** lines — the `.upsert` in `shared.ts` and the `.select` in `get-item.ts` (a read, correctly left alone).

```bash
grep -rn "cellValueSchema" src/lib/mcp/ | grep -v "\.test\.ts"
```

Expected: exactly **2** lines, both in `shared.ts` — the import and the call.

```bash
grep -rn "z.record(z.string(), z.unknown())" src/lib/mcp/
```

Expected: exactly **1** line, in `shared.ts`.

- [ ] **Step 2: Prove the perf invariant held**

Run:

```bash
grep -rn "await getClient()" src/lib/mcp/tools/
```

Expected: exactly **6** lines — one `const supabase = await getClient();` per handler (`list-boards`, `get-board`, `get-item`, `search-items`, `create-item`, `update-item`) — and **none** in `shared.ts` or inside any `for` loop.

- [ ] **Step 3: Confirm the net was never edited**

Run:

```bash
git diff --numstat "$(git merge-base HEAD develop)" -- \
  src/lib/mcp/tools/create-item.test.ts src/lib/mcp/tools/update-item.test.ts
```

Expected: two lines whose **second column (deletions) is `0`** — e.g. `196 0 src/lib/mcp/tools/create-item.test.ts`. The one permitted exception is the single-line import edit from Task 2 Step 1 / Task 3 Step 1, which shows as `1` deletion; anything more means an existing `it(...)` block was modified. Investigate before proceeding.

- [ ] **Step 4: Run all four gates**

Run: `pnpm typecheck`
Expected: exits 0.

Run: `pnpm lint`
Expected: exits 0.

Run: `pnpm test`
Expected: all unit tests pass; the `src/lib/mcp/` slice contributes 48. The integration project skips cleanly without `.env.test` (`[global-teardown] target is not a marked test DB … skipping purge`) — that is expected, not a failure.

Run: `pnpm build`
Expected: exits 0.

- [ ] **Step 5: Confirm the findings were recorded, not fixed**

Run:

```bash
grep -rn 'kind: "assigned"' src/lib/mcp/
grep -rn 'from("notifications")' src/lib/mcp/
```

Expected: **no output from either** — the F1 notification fan-out must exist only as a note in `shared.ts`'s doc comment, never as code. If a fan-out was added, that is out of scope: revert it and file it as a separate task.

- [ ] **Step 6: File the F1 follow-up**

F1 (MCP `people` writes never notify the assignee) is a real user-visible bug found while reading. It is **not** fixed here. Before closing, record it so it is not lost: add it to `vault/00-north-star.md`'s next-up list during `/wrapup`, and note in the session note that the fix is spec §5 Option B (hoist a client-injected `upsertCellCore` out of `upsertCell` so `upsertCell` and the MCP tools share one implementation, closing the gap by construction). It is ADR-worthy: _app-layer side effects inside Server Actions are invisible to non-cookie callers (MCP, jobs, webhooks) — put them in the DB or in a client-injected core._

- [ ] **Step 7: Finish the task**

Run from inside the worktree: `scripts/finish-task.sh`
Expected: rebases `task/mcp-tools-dedupe` onto latest `develop`, re-runs all four gates against the merged state, merges into `develop`, pushes, removes the worktree and branch.

- [ ] **Step 8: Report closure**

**How to test:** _No user-facing behavior to test — pure internal refactor, verified by the test suite (`src/lib/mcp/tools/_.test.ts`, expanded from 9 to 29 tests in this task).\*

Optional smoke, only if a Claude Desktop MCP connection to DEV already exists: (1) "create an item called _Refactor smoke_ in group X with status Working on it" → the item appears with its status cell set; (2) "rename it to _Refactor smoke 2_ and set its due date" → both land. Regressions to watch for: the field-write error text an agent sees, cells landing with a wrong `org_id`, and the `isError` flag flipping (which changes whether Claude treats a partial write as a failure and retries).

Then run `/wrapup` to log the session note and bump the north-star.

---

## Appendix: what this plan deliberately does NOT do

Per spec §4 and §9 — record, do not fix:

| Finding | Summary                                                                                                            | Disposition                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **F1**  | MCP `people` cell writes never fan out `assigned` notifications (canonical `upsertCell` does). Real, user-visible. | Separate `fix(mcp):` task via spec §5 Option B. ADR-worthy. Documented in `shared.ts`. |
| **F2**  | `update_item` with neither `name` nor `fields` reports success without verifying the item exists.                  | Pinned by a Task 3 characterization test. Behavior unchanged.                          |
| **F3**  | The MCP result envelope is hand-shaped 14× across the six tool files.                                              | Fold into the next task that adds or changes an MCP tool.                              |
| **F4**  | Field writes are 3N sequential round-trips (up to 150 with the 50-field cap).                                      | Left as-is — parallelizing changes `fieldErrors` ordering. Now a one-place fix.        |

Also out of scope: any edit to `src/lib/boards/`, the `upsertCellCore` hoist, `register.ts` / `context.ts` structure, new or changed MCP tools, and anything OAuth.
