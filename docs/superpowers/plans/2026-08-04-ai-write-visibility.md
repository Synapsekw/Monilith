# AI Write Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an approved AI write appear on the board immediately, with zero new server round-trips and zero re-runs of the board page's queries.

**Architecture:** The single seam all four write verbs already pass through — `executeAction` in `src/lib/ai/write/execute.ts` — starts returning a typed `BoardEffect` alongside its existing `ExecutionResult`: the authoritative rows the write just produced. Both approve surfaces (`applyAskProposal` for the dock and `/ask`, `executeActions` for ⌘K) carry those effects back on the response the client was already awaiting, and one client hook folds them into the existing `["board", boardId]` React Query cache using the id-idempotent mutators drag-and-drop already uses. Nothing calls `revalidatePath`, `router.refresh`, or `invalidateQueries`.

**Tech Stack:** TypeScript (strict), Next.js 16 App Router, Server Actions, Supabase (PostgREST + Realtime), TanStack Query v5, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-04-ai-write-visibility-design.md`

## Global Constraints

- **Never add `revalidatePath` to a within-board mutation.** The standing rule is documented at `src/lib/boards/actions/group.ts:19-29`: the mounted board never refetches the RSC, so it costs 9 queries / ~25k rows and changes nothing on screen.
- **Never add `router.refresh()` to the dock or the approve path.** That is `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`; `BoardDock`'s header comment names it explicitly.
- **`ExecutionResult` must not grow.** It is persisted into `ai_messages.tool_trace` jsonb and read back forever; rows in it would bloat every thread and replay stale data when an old thread reopens. Effects travel beside it, never inside it.
- **`ActionResult` / `fail` come from `src/lib/actions/result.ts`** — never re-declared (AGENTS.md invariant).
- **No non-async exports from a `"use server"` module.** They pass typecheck, lint and test and fail only `pnpm build`. `BoardEffect` lives in a plain module both sides import.
- **Do not edit `src/lib/ai/ask/tools.ts`** — the concurrent `task/ai-item-ids` branch owns it. This plan has no dependency on it.
- **Server Components by default; Server Actions for mutations.** Next.js 16 — confirm APIs against `node_modules/next/dist/docs/`.
- Commit subjects lowercase after `type(scope):`, descriptive body, `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` trailer, staged explicitly by path (never `git add -A`).
- Gates before merge: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Every task must leave the tree green.

---

## File Structure

**Created:**

| File                                     | Responsibility                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ai/write/effects.ts`            | The `BoardEffect` discriminated union. Plain module (no `"use server"`, no `server-only`) so both server and client import it. Types only — no runtime logic. |
| `src/lib/boards/ai-effects.ts`           | `applyBoardEffect(cache, effect)` — the pure fold from an effect onto a `BoardCache`, composed from existing `cache.ts` mutators. No React, no query client.  |
| `src/lib/boards/ai-effects.test.ts`      | Exhaustive unit tests for the fold, including idempotency.                                                                                                    |
| `src/lib/boards/use-ai-effects.ts`       | `useApplyBoardEffects()` — the one hook both approve surfaces call.                                                                                           |
| `src/lib/boards/use-ai-effects.test.tsx` | Hook tests: patches the right board, no-ops with no cache.                                                                                                    |
| `e2e/ai-write-visibility.spec.ts`        | The only layer that can prove the board updates without a reload.                                                                                             |

**Modified:**

| File                                        | Change                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/lib/boards/actions/item.ts`            | `moveItem` returns the moved row + its subitem ids (`.select("*")` instead of `.select("id")`).         |
| `src/lib/boards/actions/cell-core.ts`       | `upsertCellCore` returns the written `cell_values` row (`.select("*").single()` on the upsert).         |
| `src/lib/boards/actions/cell.ts`            | `upsertCell`'s return type widens to match the core.                                                    |
| `src/lib/ai/write/execute.ts`               | `executeAction` returns `{ result, effect }`; `applyFields` returns written cells alongside its errors. |
| `src/lib/ai/write/actions.ts`               | `executeActions` returns `effects` beside `results`.                                                    |
| `src/lib/ai/ask/proposal-actions.ts`        | `ProposalOutcome` gains a transient `effects` field (never written to `tool_trace`).                    |
| `src/components/ai/ask/AskChat.tsx`         | `resolve()` applies the returned effects.                                                               |
| `src/components/ai/actions/QuickAction.tsx` | `approve()` applies the returned effects.                                                               |

**Test files gaining cases:** `src/lib/ai/write/execute.test.ts`, `src/lib/boards/actions/cell-core.test.ts`, `src/lib/boards/actions.test.ts`, `src/components/ai/ask/AskChat.test.tsx`, `src/components/ai/actions/QuickAction.test.tsx`.

**No migration. No RLS change. No new dependency.**

---

## Execution DAG (working agreement #6)

**Dependency graph:**

| Task                                | Depends on | Why                                                          |
| ----------------------------------- | ---------- | ------------------------------------------------------------ |
| 1. Effect type + pure fold          | —          | Root. Defines `BoardEffect`, which everything else consumes. |
| 2. `moveItem` returns its row       | —          | Touches only `src/lib/boards/actions/item.ts`.               |
| 3. `upsertCell` returns its row     | —          | Touches only `src/lib/boards/actions/cell*.ts`.              |
| 4. `executeAction` produces effects | 1, 2, 3    | Needs the type and both row-returning actions.               |
| 5. Client hook                      | 1          | Needs the type and the fold; nothing server-side.            |
| 6. Server-action plumbing           | 4          | Threads the effect out of both approve actions.              |
| 7. Client wiring at both surfaces   | 5, 6       | Needs the hook and the effects on the wire.                  |
| 8. e2e proof + Realtime diagnostic  | 7          | Needs the whole path live.                                   |

**Parallel batches:**

- **Batch A (3 concurrent agents): Tasks 1, 2, 3.** File sets are disjoint (`src/lib/ai/write/` + `src/lib/boards/ai-effects*` vs. `actions/item.ts` vs. `actions/cell*.ts`), so these can run in one worktree without clobbering. Task 1 is the long pole of this batch.
- **Batch B (2 concurrent agents): Tasks 4, 5.** Task 4 needs all of Batch A; Task 5 needs only Task 1. Disjoint files.
- **Batch C: Task 6.**
- **Batch D: Task 7.**
- **Batch E: Task 8.**

**Critical path:** 1 → 4 → 6 → 7 → 8 — five sequential task-lengths. That is the real wall-clock floor; Tasks 2, 3 and 5 are free rides inside batches A and B.

---

## Task 1: The effect type and the pure fold

**Files:**

- Create: `src/lib/ai/write/effects.ts`
- Create: `src/lib/boards/ai-effects.ts`
- Test: `src/lib/boards/ai-effects.test.ts`

**Interfaces:**

- Consumes: `BoardCache`, `insertItem`, `replaceItem`, `moveItemToGroup`, `insertGroup`, `upsertCellValue` from `@/lib/boards/cache`; `Tables` from `@/types/database.types`.
- Produces:
  - `type BoardEffect` (exported from `@/lib/ai/write/effects`) — a discriminated union on `kind` with members `"item_created" | "item_moved" | "item_fields_set" | "group_created"`, every member carrying `boardId: string`.
  - `function applyBoardEffect(cache: BoardCache, effect: BoardEffect): BoardCache` (exported from `@/lib/boards/ai-effects`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/ai-effects.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyBoardEffect } from "./ai-effects";
import type { BoardCache } from "./cache";

function baseCache(): BoardCache {
  return {
    board: { id: "b1", org_id: "o1", name: "B" } as BoardCache["board"],
    groups: [
      { id: "g1", board_id: "b1", name: "Backlog", position: 1 } as never,
    ],
    columns: [],
    items: [
      {
        id: "i1",
        board_id: "b1",
        group_id: "g1",
        parent_id: null,
        name: "One",
        position: 1,
      } as never,
    ],
    cellValues: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  };
}

const newItem = {
  id: "i9",
  board_id: "b1",
  group_id: "g1",
  parent_id: null,
  name: "Ship v2",
  position: 2,
} as never;

const newCell = {
  item_id: "i9",
  column_id: "c-due",
  org_id: "o1",
  board_id: "b1",
  value: { date: "2026-08-10" },
} as never;

describe("applyBoardEffect", () => {
  it("item_created inserts the item and its cells", () => {
    const next = applyBoardEffect(baseCache(), {
      kind: "item_created",
      boardId: "b1",
      item: newItem,
      cells: [newCell],
    });
    expect(next.items.map((i) => i.id)).toEqual(["i1", "i9"]);
    expect(next.cellValues).toHaveLength(1);
    expect(next.cellValues[0]?.column_id).toBe("c-due");
  });

  it("item_created is idempotent — applying twice does not duplicate", () => {
    const effect = {
      kind: "item_created",
      boardId: "b1",
      item: newItem,
      cells: [newCell],
    } as const;
    const once = applyBoardEffect(baseCache(), effect);
    const twice = applyBoardEffect(once, effect);
    expect(twice.items.filter((i) => i.id === "i9")).toHaveLength(1);
    expect(twice.cellValues).toHaveLength(1);
  });

  it("item_moved reassigns group and position, and drags subitems along", () => {
    const cache = baseCache();
    cache.groups.push({
      id: "g2",
      board_id: "b1",
      name: "Doing",
      position: 2,
    } as never);
    cache.items.push({
      id: "s1",
      board_id: "b1",
      group_id: "g1",
      parent_id: "i1",
      name: "Sub",
      position: 1,
    } as never);

    const next = applyBoardEffect(cache, {
      kind: "item_moved",
      boardId: "b1",
      item: { ...cache.items[0]!, group_id: "g2", position: 7 },
      subitemIds: ["s1"],
    });

    expect(next.items.find((i) => i.id === "i1")?.group_id).toBe("g2");
    expect(next.items.find((i) => i.id === "i1")?.position).toBe(7);
    expect(next.items.find((i) => i.id === "s1")?.group_id).toBe("g2");
  });

  it("item_fields_set upserts cells, replacing an existing value", () => {
    const cache = baseCache();
    cache.cellValues.push({
      item_id: "i1",
      column_id: "c-due",
      org_id: "o1",
      board_id: "b1",
      value: { date: "2026-01-01" },
    } as never);

    const next = applyBoardEffect(cache, {
      kind: "item_fields_set",
      boardId: "b1",
      cells: [
        {
          item_id: "i1",
          column_id: "c-due",
          org_id: "o1",
          board_id: "b1",
          value: { date: "2026-12-31" },
        } as never,
      ],
    });

    expect(next.cellValues).toHaveLength(1);
    expect(next.cellValues[0]?.value).toEqual({ date: "2026-12-31" });
  });

  it("group_created inserts the group, idempotently", () => {
    const effect = {
      kind: "group_created",
      boardId: "b1",
      group: { id: "g2", board_id: "b1", name: "Doing", position: 2 } as never,
    } as const;
    const once = applyBoardEffect(baseCache(), effect);
    const twice = applyBoardEffect(once, effect);
    expect(twice.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("returns the same cache reference when nothing applies", () => {
    const cache = baseCache();
    const next = applyBoardEffect(cache, {
      kind: "item_fields_set",
      boardId: "b1",
      cells: [],
    });
    expect(next).toBe(cache);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/boards/ai-effects.test.ts`
Expected: FAIL — `Failed to resolve import "./ai-effects"`.

- [ ] **Step 3: Create the effect type**

Create `src/lib/ai/write/effects.ts`:

```ts
import type { Tables } from "@/types/database.types";

/**
 * What an approved AI write DID, as authoritative rows the server just produced.
 *
 * Deliberately NOT part of `ExecutionResult`: that shape is persisted into
 * `ai_messages.tool_trace` jsonb and read back forever, so rows inside it would
 * bloat every thread and replay STALE data into the board cache whenever an old
 * thread is reopened. An effect is transient — it lives only for the duration of
 * the approve response, so the acting client can render its own change without a
 * refetch (gotcha-13: the echo reconciles PEERS, it is never the actor's source
 * of truth).
 *
 * A plain module on purpose: `execute.ts` is `server-only` and both approve
 * actions are `"use server"`, where a non-async export fails only `pnpm build`.
 * Both sides import from here.
 */
export type BoardEffect =
  | {
      kind: "item_created";
      boardId: string;
      item: Tables<"items">;
      /** Cells written by the action's `fields`, if any. */
      cells: Tables<"cell_values">[];
    }
  | {
      kind: "item_moved";
      boardId: string;
      item: Tables<"items">;
      /** Subitems whose denormalized group_id moved with the parent. */
      subitemIds: string[];
    }
  | {
      kind: "item_fields_set";
      boardId: string;
      cells: Tables<"cell_values">[];
    }
  | {
      kind: "group_created";
      boardId: string;
      group: Tables<"groups">;
    };
```

- [ ] **Step 4: Write the pure fold**

Create `src/lib/boards/ai-effects.ts`:

```ts
import {
  insertGroup,
  insertItem,
  replaceItem,
  upsertCellValue,
  type BoardCache,
} from "@/lib/boards/cache";
import type { BoardEffect } from "@/lib/ai/write/effects";

/**
 * Fold one approved AI write onto the board cache.
 *
 * Pure — no React, no query client — so it is exhaustively unit-testable, the
 * same shape as `foldBoardEvents` in realtime-buffer.ts. Every mutator it uses
 * is already id-idempotent, which is what lets a later Realtime echo of the SAME
 * write land harmlessly on top.
 *
 * Note it does NOT reuse `moveItemToGroup`: that helper GUESSES a position
 * (`maxPos + 1`) because drag-and-drop patches before the server answers. Here
 * the server has already answered, so the authoritative row is written directly.
 */
export function applyBoardEffect(
  cache: BoardCache,
  effect: BoardEffect,
): BoardCache {
  switch (effect.kind) {
    case "item_created": {
      let next = insertItem(cache, effect.item);
      for (const cell of effect.cells) next = upsertCellValue(next, cell);
      return next;
    }
    case "item_moved": {
      const subitems = new Set(effect.subitemIds);
      return {
        ...cache,
        items: cache.items.map((i) => {
          if (i.id === effect.item.id) return effect.item;
          if (subitems.has(i.id))
            return { ...i, group_id: effect.item.group_id };
          return i;
        }),
      };
    }
    case "item_fields_set": {
      let next = cache;
      for (const cell of effect.cells) next = upsertCellValue(next, cell);
      return next;
    }
    case "group_created":
      return insertGroup(cache, effect.group);
  }
}
```

Note: `replaceItem` is imported for the exhaustiveness of the module's intent but the `item_moved` branch maps directly so subitems and the parent are updated in ONE pass. If ESLint flags the unused import, drop `replaceItem` from the import list.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/boards/ai-effects.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Run the gates**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/write/effects.ts src/lib/boards/ai-effects.ts src/lib/boards/ai-effects.test.ts
git commit -m "feat(ai): add board effects and the pure fold onto the board cache

An approved AI write currently tells the client nothing it can render, so the
board is stale until a reload. Introduce BoardEffect — the authoritative rows a
write produced — and a pure, id-idempotent fold onto the existing board cache.

Kept out of ExecutionResult on purpose: that shape is persisted into
ai_messages.tool_trace, where rows would bloat every thread and replay stale
data when an old thread is reopened.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `moveItem` returns the row it moved

**Files:**

- Modify: `src/lib/boards/actions/item.ts:253-318` (`moveItem`)
- Test: `src/lib/boards/actions.test.ts`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: `moveItem(input): Promise<ActionResult<{ item: Tables<"items">; subitemIds: string[] }>>` — was `Promise<ActionResult>`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/boards/actions.test.ts`, inside the existing `moveItem` describe block (match the file's existing Supabase mocking style — read the neighbouring tests before writing):

```ts
it("returns the moved row and the ids of the subitems dragged along", async () => {
  const res = await moveItem({ itemId: "i1", groupId: "g2" });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.data.item.id).toBe("i1");
  expect(res.data.item.group_id).toBe("g2");
  expect(res.data.subitemIds).toEqual(["s1"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/boards/actions.test.ts -t "subitems dragged along"`
Expected: FAIL — `Property 'item' does not exist on type 'void'` at typecheck, or `res.data` undefined at runtime.

- [ ] **Step 3: Widen the update to return the row**

In `src/lib/boards/actions/item.ts`, change the move UPDATE from `.select("id")` to `.select("*")` and capture the subitem update's returned ids:

```ts
const { data: moved, error } = await supabase
  .from("items")
  .update({ group_id: parsed.data.groupId, position })
  .eq("id", parsed.data.itemId)
  .select("*")
  .maybeSingle();
if (error) return fail(error.message);
// A viewer can READ the board (both guards above pass) but not write it: the
// UPDATE then matches zero rows and returns null data with NO error. Read the
// row back so that silent no-op can't be reported as a successful move —
// same treatment renameItem gives its own RLS-hidden case.
if (!moved) return fail("You don't have permission to move this item.");

// Keep subitems co-located with their parent (their denormalized group_id
// must match). RLS-scoped; best-effort — the parent already moved. The
// returned ids let the caller patch a mounted board without a refetch; a
// failure here costs the caller nothing beyond a stale subitem row.
const { data: movedSubitems } = await supabase
  .from("items")
  .update({ group_id: parsed.data.groupId })
  .eq("parent_id", parsed.data.itemId)
  .select("id");

return {
  ok: true,
  data: {
    item: moved,
    subitemIds: (movedSubitems ?? []).map((s) => s.id),
  },
};
```

Update the signature:

```ts
export async function moveItem(input: {
  itemId: string;
  groupId: string;
  position?: number;
}): Promise<ActionResult<{ item: Tables<"items">; subitemIds: string[] }>> {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project unit src/lib/boards/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify no caller broke**

Run: `pnpm typecheck`
Expected: clean. `moveItem`'s existing callers — `moveItemToGroupMutation` (`src/lib/boards/mutations/items.ts:158-180`), the bulk "Move to group" wrapper in `src/lib/boards/bulk-actions.ts`, and `executeAction` — all read only `.ok` / `.error`, so widening the success payload is backward-compatible. If any caller destructures `data`, fix it in place; do **not** change drag-and-drop's optimistic behaviour here (that is explicitly out of scope in the spec).

- [ ] **Step 6: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/actions/item.ts src/lib/boards/actions.test.ts
git commit -m "feat(boards): return the moved row and subitem ids from moveItem

The caller needs the authoritative post-move row to patch a mounted board
without a refetch. PostgREST returns it in the same request, so this costs no
extra round-trip, and widening the success payload leaves every existing caller
untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `upsertCell` returns the cell it wrote

**Files:**

- Modify: `src/lib/boards/actions/cell-core.ts:73-119` (`upsertCellCore`)
- Modify: `src/lib/boards/actions/cell.ts:24-36` (`upsertCell`)
- Test: `src/lib/boards/actions/cell-core.test.ts`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces:
  - `upsertCellCore(supabase, input, actorId): Promise<ActionResult<{ cell: Tables<"cell_values"> }>>`
  - `upsertCell(input): Promise<ActionResult<{ cell: Tables<"cell_values"> }>>`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/boards/actions/cell-core.test.ts` (match the file's existing Supabase client stubbing):

```ts
it("returns the written cell row", async () => {
  const res = await upsertCellCore(
    stubClient,
    { itemId: "i1", columnId: "c1", value: { date: "2026-08-10" } },
    "u1",
  );
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.data.cell.item_id).toBe("i1");
  expect(res.data.cell.column_id).toBe("c1");
  expect(res.data.cell.value).toEqual({ date: "2026-08-10" });
});
```

The existing stub must be extended so the `cell_values` upsert chain resolves `.select("*").single()` with a row. Read the file's current stub shape first and extend it in the same style.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/boards/actions/cell-core.test.ts -t "written cell row"`
Expected: FAIL — `res.data` is `undefined`.

- [ ] **Step 3: Return the row from the upsert**

In `src/lib/boards/actions/cell-core.ts`, change the upsert to select the row back, and return it at the end:

```ts
const { data: cell, error } = await supabase
  .from("cell_values")
  .upsert(
    {
      org_id: column.org_id,
      board_id: column.board_id,
      item_id: input.itemId,
      column_id: input.columnId,
      value: valueParsed.data as Json,
    },
    { onConflict: "item_id,column_id" },
  )
  // Returned in the SAME request — no extra round-trip. The caller needs the
  // authoritative row to patch a mounted board without a refetch.
  .select("*")
  .single();
if (error || !cell) return fail(error?.message ?? "Could not write the cell.");
```

…and change the final `return { ok: true, data: undefined };` to:

```ts
return { ok: true, data: { cell } };
```

Update the signature to `Promise<ActionResult<{ cell: Tables<"cell_values"> }>>` and add `Tables` to the `@/types/database.types` import.

- [ ] **Step 4: Widen the Server Action wrapper**

In `src/lib/boards/actions/cell.ts`, change `upsertCell`'s return type to `Promise<ActionResult<{ cell: Tables<"cell_values"> }>>`. The body already `return`s the core's result verbatim, so no other change is needed. Add the `Tables` type import.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/boards/actions/cell-core.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify the MCP caller still compiles**

Run: `pnpm typecheck`
Expected: clean. `writeCellValue` (`src/lib/mcp/tools/shared.ts:54-66`) reads only `res.ok` / `res.error`, so the widened payload does not reach it. Do not change it.

- [ ] **Step 7: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/boards/actions/cell-core.ts src/lib/boards/actions/cell.ts src/lib/boards/actions/cell-core.test.ts
git commit -m "feat(boards): return the written row from upsertCell

Brings upsertCell into line with createItem/addSubitem/createColumn, which
already return their row so a caller can patch the client cache idempotently
instead of refetching (gotcha-13). PostgREST returns it in the same request.

The MCP path shares upsertCellCore and reads only ok/error, so the widened
success payload does not reach it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `executeAction` produces the effect

**Files:**

- Modify: `src/lib/ai/write/execute.ts`
- Modify: `src/lib/ai/write/actions.ts:143` (call site only — discard the effect for now)
- Modify: `src/lib/ai/ask/proposal-actions.ts:151` (call site only — discard the effect for now)
- Test: `src/lib/ai/write/execute.test.ts`

**Interfaces:**

- Consumes: `BoardEffect` from `@/lib/ai/write/effects` (Task 1); `moveItem` returning `{ item, subitemIds }` (Task 2); `upsertCell` returning `{ cell }` (Task 3).
- Produces: `executeAction(action: ValidatedAction): Promise<{ result: ExecutionResult; effect: BoardEffect | null }>` — previously `Promise<ExecutionResult>`.

- [ ] **Step 1: Write the failing test**

The existing tests in `src/lib/ai/write/execute.test.ts` assert the old shape (e.g. `expect(res).toEqual({ ok: true, itemId: "i9" })`). Update the hoisted mocks so the mocked actions return rows, then update every existing assertion to read `res.result`, and add one effect assertion per verb:

```ts
const { createItem, createGroup, upsertCell, moveItem } = vi.hoisted(() => ({
  createItem: vi.fn(async () => ({
    ok: true,
    data: { item: { id: "i9", board_id: "b1", group_id: "g1" } },
  })),
  createGroup: vi.fn(async () => ({
    ok: true,
    data: { group: { id: "g9", board_id: "b1" } },
  })),
  upsertCell: vi.fn(async () => ({
    ok: true,
    data: { cell: { item_id: "i9", column_id: "c-due", value: {} } },
  })),
  moveItem: vi.fn(async () => ({
    ok: true,
    data: {
      item: { id: "i1", board_id: "b1", group_id: "g2", position: 7 },
      subitemIds: ["s1"],
    },
  })),
}));
```

```ts
it("move_item reports the moved row and its subitems as an effect", async () => {
  const res = await executeAction({
    kind: "move_item",
    boardId: "b1",
    itemId: "i1",
    groupId: "g2",
    summary: "s",
    warnings: [],
  });
  expect(res.result).toEqual({ ok: true });
  expect(res.effect).toEqual({
    kind: "item_moved",
    boardId: "b1",
    item: { id: "i1", board_id: "b1", group_id: "g2", position: 7 },
    subitemIds: ["s1"],
  });
});

it("create_item reports the created row and the cells its fields wrote", async () => {
  const res = await executeAction({
    kind: "create_item",
    boardId: "b1",
    groupId: "g1",
    name: "Ship v2",
    fields: { dueDate: "2026-07-17" },
    summary: "s",
    warnings: [],
  });
  expect(res.result).toEqual({ ok: true, itemId: "i9" });
  expect(res.effect?.kind).toBe("item_created");
  if (res.effect?.kind !== "item_created") return;
  expect(res.effect.item.id).toBe("i9");
  expect(res.effect.cells).toHaveLength(1);
});

it("create_group reports the created group as an effect", async () => {
  const res = await executeAction({
    kind: "create_group",
    boardId: "b1",
    name: "Doing",
    summary: "s",
    warnings: [],
  });
  expect(res.result).toEqual({ ok: true });
  expect(res.effect).toEqual({
    kind: "group_created",
    boardId: "b1",
    group: { id: "g9", board_id: "b1" },
  });
});

it("carries no effect when the underlying action fails", async () => {
  moveItem.mockResolvedValueOnce({ ok: false, error: "nope" } as never);
  const res = await executeAction({
    kind: "move_item",
    boardId: "b1",
    itemId: "i1",
    groupId: "g2",
    summary: "s",
    warnings: [],
  });
  expect(res.result).toEqual({ ok: false, error: "nope" });
  expect(res.effect).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit src/lib/ai/write/execute.test.ts`
Expected: FAIL — `res.result` is `undefined`, `res.effect` is `undefined`.

- [ ] **Step 3: Make `applyFields` return the cells it wrote**

In `src/lib/ai/write/execute.ts`, change `applyFields` to return both errors and cells:

```ts
async function applyFields(
  boardId: string,
  itemId: string,
  fields: ProposedFields | undefined,
): Promise<{ errors: string[]; cells: Tables<"cell_values">[] }> {
  if (!fields) return { errors: [], cells: [] };
  const payload = await getBoardPayload(boardId);
  if (!payload) return { errors: ["Board not found."], cells: [] };
  const { dateColumnId, statusColumnId, peopleColumnId } =
    pickFieldColumns(payload);
  const errors: string[] = [];
  const cells: Tables<"cell_values">[] = [];
  const write = async (
    columnId: string | null,
    value: unknown,
    label: string,
  ): Promise<void> => {
    if (!columnId) {
      errors.push(`No ${label} column on this board.`);
      return;
    }
    const r = await upsertCell({ itemId, columnId, value });
    if (!r.ok) errors.push(`${label}: ${r.error}`);
    else cells.push(r.data.cell);
  };
  // …the three `if (fields.…)` blocks are unchanged…
  return { errors, cells };
}
```

Add `import type { Tables } from "@/types/database.types";` at the top.

- [ ] **Step 4: Rewrite `executeAction` to return both**

```ts
/**
 * Map a re-validated action to the canonical typed Server Actions. RLS is the
 * guard at every write. A field write that fails does NOT roll back a created
 * item — per-field errors are surfaced so the UI can show exactly what landed.
 *
 * Returns the persisted `result` AND a transient `effect`: the authoritative
 * rows this write produced, so the acting client can render its own change with
 * no refetch. The effect is deliberately NOT folded into ExecutionResult, which
 * is persisted into ai_messages.tool_trace and read back forever.
 *
 * The `never` check at the bottom is what makes this shared: a fifth verb cannot
 * compile without deciding what the board should show.
 */
export async function executeAction(
  action: ValidatedAction,
): Promise<{ result: ExecutionResult; effect: BoardEffect | null }> {
  if (action.kind === "create_group") {
    const r = await createGroup({ boardId: action.boardId, name: action.name });
    return r.ok
      ? {
          result: { ok: true },
          effect: {
            kind: "group_created",
            boardId: action.boardId,
            group: r.data.group,
          },
        }
      : { result: { ok: false, error: r.error }, effect: null };
  }
  if (action.kind === "create_item") {
    const created = await createItem({
      groupId: action.groupId,
      name: action.name,
    });
    if (!created.ok)
      return { result: { ok: false, error: created.error }, effect: null };
    const itemId = created.data.item.id;
    const { errors, cells } = await applyFields(
      action.boardId,
      itemId,
      action.fields,
    );
    // The item exists either way, so the board must show it even when a field
    // write failed — the effect rides along with the error, not instead of it.
    const effect: BoardEffect = {
      kind: "item_created",
      boardId: action.boardId,
      item: created.data.item,
      cells,
    };
    return errors.length
      ? { result: { ok: false, error: errors.join("; ") }, effect }
      : { result: { ok: true, itemId }, effect };
  }
  if (action.kind === "move_item") {
    // moveItem owns the guards that matter after confirmation: it refuses
    // subitems, refuses a group on another board, and appends to the end of
    // the target group. Omitting `position` is what selects that append —
    // there is no drag-drop cursor here to honour.
    const r = await moveItem({
      itemId: action.itemId,
      groupId: action.groupId,
    });
    // No `itemId` on success: the UI reads that as "a row was CREATED — open it
    // from the board", which is wrong for a move. Nothing consumes a move's id.
    return r.ok
      ? {
          result: { ok: true },
          effect: {
            kind: "item_moved",
            boardId: action.boardId,
            item: r.data.item,
            subitemIds: r.data.subitemIds,
          },
        }
      : { result: { ok: false, error: r.error }, effect: null };
  }
  if (action.kind === "set_item_fields") {
    const { errors, cells } = await applyFields(
      action.boardId,
      action.itemId,
      action.fields,
    );
    const effect: BoardEffect | null = cells.length
      ? { kind: "item_fields_set", boardId: action.boardId, cells }
      : null;
    return errors.length
      ? { result: { ok: false, error: errors.join("; ") }, effect }
      : { result: { ok: true, itemId: action.itemId }, effect };
  }
  // Every verb is handled above. A fifth one fails to COMPILE here rather than
  // silently falling into another verb's branch — which is now also what forces
  // a new verb to decide how the board should render it.
  const _exhaustive: never = action;
  return _exhaustive;
}
```

Add `import type { BoardEffect } from "./effects";`.

- [ ] **Step 5: Keep both call sites compiling (effect discarded for now)**

In `src/lib/ai/write/actions.ts`, line 143:

```ts
for (const action of parsed.data)
  results.push((await executeAction(action)).result);
```

In `src/lib/ai/ask/proposal-actions.ts`, line 150-151:

```ts
for (const action of loaded.actions)
  results.push((await executeAction(action)).result);
```

Behaviour is unchanged; Task 6 threads the effect out.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/ai/write/execute.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/write/execute.ts src/lib/ai/write/execute.test.ts src/lib/ai/write/actions.ts src/lib/ai/ask/proposal-actions.ts
git commit -m "feat(ai): return a board effect from the shared execute seam

executeAction is the one function all four write verbs pass through, so hanging
the effect off its return type puts the existing never-exhaustiveness check
behind visibility too: a fifth verb cannot compile without deciding what the
board should show. A per-verb fix is how the next verb ships broken.

Both call sites discard the effect for now; the next change threads it out.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: The client hook

**Files:**

- Create: `src/lib/boards/use-ai-effects.ts`
- Test: `src/lib/boards/use-ai-effects.test.tsx`

**Interfaces:**

- Consumes: `applyBoardEffect` from `@/lib/boards/ai-effects` and `BoardEffect` from `@/lib/ai/write/effects` (Task 1); `boardKey` / `patchBoardCache` from `@/lib/boards/use-board-cache`.
- Produces: `useApplyBoardEffects(): (effects: readonly BoardEffect[]) => void`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/use-ai-effects.test.tsx` (mirror the provider-wrapper style in `src/lib/boards/use-board-mutations.test.tsx`):

```tsx
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useApplyBoardEffects } from "./use-ai-effects";
import { boardKey } from "./use-board-cache";
import type { BoardCache } from "./cache";

function seededClient(): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData<BoardCache>(boardKey("b1"), {
    board: { id: "b1", org_id: "o1", name: "B" } as BoardCache["board"],
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
  });
  return qc;
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const created = {
  kind: "item_created",
  boardId: "b1",
  item: { id: "i9", board_id: "b1", group_id: "g1", parent_id: null } as never,
  cells: [],
} as const;

describe("useApplyBoardEffects", () => {
  it("patches the board cache for the effect's board", () => {
    const qc = seededClient();
    const { result } = renderHook(() => useApplyBoardEffects(), {
      wrapper: wrapper(qc),
    });
    act(() => result.current([created]));
    expect(
      qc.getQueryData<BoardCache>(boardKey("b1"))?.items.map((i) => i.id),
    ).toEqual(["i9"]);
  });

  it("no-ops when the effect targets a board with no mounted cache", () => {
    const qc = seededClient();
    const { result } = renderHook(() => useApplyBoardEffects(), {
      wrapper: wrapper(qc),
    });
    act(() => result.current([{ ...created, boardId: "b-other" }]));
    expect(qc.getQueryData<BoardCache>(boardKey("b-other"))).toBeUndefined();
    expect(qc.getQueryData<BoardCache>(boardKey("b1"))?.items).toHaveLength(0);
  });

  it("applies several effects in order", () => {
    const qc = seededClient();
    const { result } = renderHook(() => useApplyBoardEffects(), {
      wrapper: wrapper(qc),
    });
    act(() =>
      result.current([
        created,
        {
          kind: "group_created",
          boardId: "b1",
          group: { id: "g2", board_id: "b1", position: 1 } as never,
        },
      ]),
    );
    const cache = qc.getQueryData<BoardCache>(boardKey("b1"));
    expect(cache?.items).toHaveLength(1);
    expect(cache?.groups).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/boards/use-ai-effects.test.tsx`
Expected: FAIL — `Failed to resolve import "./use-ai-effects"`.

- [ ] **Step 3: Write the hook**

Create `src/lib/boards/use-ai-effects.ts`:

```ts
"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { patchBoardCache } from "@/lib/boards/use-board-cache";
import { applyBoardEffect } from "@/lib/boards/ai-effects";
import type { BoardEffect } from "@/lib/ai/write/effects";

/**
 * Render an approved AI write on a mounted board — with NO server round-trip.
 *
 * The one hook both approve surfaces call. It works everywhere because
 * `patchBoardCache` is already written as `prev ? patch(prev) : prev`: when the
 * effect names a board with no mounted cache — /ask as a full page, or a write
 * to a board the user isn't looking at — the call is a silent no-op. That is
 * what removes any need to prop-drill "is a board on screen" or to branch per
 * surface.
 *
 * Deliberately not a navigation and not an invalidation: `router.refresh` would
 * re-run every query in the board page (gotcha-09), and revalidatePath would
 * invalidate a payload the mounted client discards (see the rule at
 * src/lib/boards/actions/group.ts).
 */
export function useApplyBoardEffects(): (
  effects: readonly BoardEffect[],
) => void {
  const qc = useQueryClient();
  return useCallback(
    (effects: readonly BoardEffect[]) => {
      for (const effect of effects) {
        patchBoardCache(qc, effect.boardId, (prev) =>
          applyBoardEffect(prev, effect),
        );
      }
    },
    [qc],
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/boards/use-ai-effects.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/use-ai-effects.ts src/lib/boards/use-ai-effects.test.tsx
git commit -m "feat(boards): add the hook that renders an AI write on a mounted board

One hook serves every approve surface because patchBoardCache already no-ops
when no cache exists for the board — so /ask as a full page, and a write to a
board the user isn't viewing, need no branching at the call site.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Thread the effects out of both approve actions

**Files:**

- Modify: `src/lib/ai/ask/proposal-actions.ts` (`ProposalOutcome`, `applyAskProposal`, `insertOutcome`)
- Modify: `src/lib/ai/write/actions.ts` (`executeActions`)
- Test: `src/lib/ai/ask/proposal-actions.test.ts` (create if absent), `src/lib/ai/write/actions.test.ts`

**Interfaces:**

- Consumes: `executeAction(action): Promise<{ result, effect }>` (Task 4); `BoardEffect` (Task 1).
- Produces:
  - `ProposalOutcome = { messageId: string; content: string; trace: AskToolTrace; effects: BoardEffect[] }`
  - `executeActions(input): Promise<ActionResult<{ results: ExecutionResult[]; effects: BoardEffect[] }>>`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/ai/write/actions.test.ts`:

```ts
it("returns the board effects alongside the persisted results", async () => {
  const res = await executeActions({
    actions: [
      {
        kind: "create_group",
        boardId: "b1",
        name: "Doing",
        summary: "s",
        warnings: [],
      },
    ],
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.data.results).toEqual([{ ok: true }]);
  expect(res.data.effects).toHaveLength(1);
  expect(res.data.effects[0]?.kind).toBe("group_created");
});
```

And in `src/lib/ai/ask/proposal-actions.test.ts` (create the file following the mocking style of `src/lib/ai/write/actions.test.ts` if it does not yet exist):

```ts
it("hands the effects back on the outcome without persisting them", async () => {
  const res = await applyAskProposal({
    conversationId: "11111111-1111-1111-1111-111111111111",
    messageId: "22222222-2222-2222-2222-222222222222",
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.data.effects).toHaveLength(1);
  // The persisted trace carries results ONLY — never rows.
  expect(res.data.trace).not.toHaveProperty("effects");
  expect(JSON.stringify(res.data.trace)).not.toContain("item_moved");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit src/lib/ai/write/actions.test.ts src/lib/ai/ask/proposal-actions.test.ts`
Expected: FAIL — `res.data.effects` is `undefined`.

- [ ] **Step 3: Widen `executeActions`**

In `src/lib/ai/write/actions.ts`:

```ts
export async function executeActions(input: {
  actions: unknown[];
}): Promise<
  ActionResult<{ results: ExecutionResult[]; effects: BoardEffect[] }>
> {
```

and the loop:

```ts
const results: ExecutionResult[] = [];
const effects: BoardEffect[] = [];
for (const action of parsed.data) {
  const { result, effect } = await executeAction(action);
  results.push(result);
  if (effect) effects.push(effect);
}
return { ok: true, data: { results, effects } };
```

Add `import type { BoardEffect } from "./effects";`. Note this is a `"use server"` module, so import the **type** only — do not re-export anything non-async from here.

- [ ] **Step 4: Widen `applyAskProposal`**

In `src/lib/ai/ask/proposal-actions.ts`, extend the outcome type:

```ts
/** The appended outcome turn, handed straight back so the client can push it
 *  into the transcript without a refetch (0 RSC navigations). `effects` is
 *  TRANSIENT — it is deliberately absent from `trace`, which is persisted into
 *  ai_messages.tool_trace and read back on every thread open. Rows in there
 *  would bloat the thread and replay STALE state onto the board later. */
export type ProposalOutcome = {
  messageId: string;
  content: string;
  trace: AskToolTrace;
  effects: BoardEffect[];
};
```

Change `insertOutcome` to take and pass through the effects:

```ts
async function insertOutcome(
  supabase: SupabaseClient,
  conversationId: string,
  content: string,
  trace: AskToolTrace,
  effects: BoardEffect[],
): Promise<ActionResult<ProposalOutcome>> {
  const ins = await supabase
    .from("ai_messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
      // The generated column type is the opaque `Json`; the shape is guaranteed
      // by askToolTraceSchema, so this cast is a serialization detail, not a
      // loosening of types. `effects` is NOT part of it, by design.
      tool_trace: trace as unknown as Json,
    })
    .select("id")
    .single();
  if (ins.error || !ins.data) return fail("Couldn't record the result.");
  return {
    ok: true,
    data: { messageId: ins.data.id, content, trace, effects },
  };
}
```

And the loop in `applyAskProposal`:

```ts
const results: ExecutionResult[] = [];
const effects: BoardEffect[] = [];
for (const action of loaded.actions) {
  const { result, effect } = await executeAction(action);
  results.push(result);
  if (effect) effects.push(effect);
}

return await insertOutcome(
  supabase,
  conversationId,
  outcomeContent(loaded.actions, results),
  { resolvesProposal: messageId, outcome: "applied", results },
  effects,
);
```

`cancelAskProposal`'s call becomes `insertOutcome(..., { resolvesProposal: messageId, outcome: "cancelled" }, [])` — a cancel changes nothing, so it carries no effects.

Add `import type { BoardEffect } from "@/lib/ai/write/effects";`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/ai/write/actions.test.ts src/lib/ai/ask/proposal-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: clean. **Run `pnpm build` here specifically** — this task edits two `"use server"` modules, and a non-async export from one fails only at build.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/write/actions.ts src/lib/ai/ask/proposal-actions.ts src/lib/ai/write/actions.test.ts src/lib/ai/ask/proposal-actions.test.ts
git commit -m "feat(ai): carry board effects back on the approve response

Both approve surfaces now return the rows the write produced, riding on the
response the client was already awaiting — zero new round-trips. The effects
stay out of tool_trace: that column is read back on every thread open, so rows
in it would bloat threads and replay stale state onto the board.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire both approve surfaces

**Files:**

- Modify: `src/components/ai/ask/AskChat.tsx` (`resolve`)
- Modify: `src/components/ai/actions/QuickAction.tsx` (`approve`)
- Test: `src/components/ai/ask/AskChat.test.tsx`, `src/components/ai/actions/QuickAction.test.tsx`

**Interfaces:**

- Consumes: `useApplyBoardEffects()` (Task 5); `ProposalOutcome.effects` and `executeActions`'s `data.effects` (Task 6).
- Produces: no new exports — this is the last mile.

- [ ] **Step 1: Write the failing tests**

In `src/components/ai/ask/AskChat.test.tsx`, add a test asserting the hook is invoked with the server's effects. Mock the hook module so the assertion does not need a seeded board cache:

```tsx
const applyEffects = vi.hoisted(() => vi.fn());
vi.mock("@/lib/boards/use-ai-effects", () => ({
  useApplyBoardEffects: () => applyEffects,
}));
```

```tsx
it("applies the returned board effects when a proposal is approved", async () => {
  // applyAskProposal is already mocked in this file — extend its resolved value
  // with an `effects` array, then approve.
  render(<AskChat {...props} />);
  await userEvent.click(screen.getByRole("button", { name: /approve/i }));
  await waitFor(() =>
    expect(applyEffects).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "item_moved", boardId: "b1" }),
    ]),
  );
});

it("applies nothing when a proposal is cancelled", async () => {
  render(<AskChat {...props} />);
  await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
  await waitFor(() => expect(applyEffects).toHaveBeenCalledWith([]));
});
```

Add the equivalent to `src/components/ai/actions/QuickAction.test.tsx`, extending the existing `executeActions` mock's resolved value with `effects` and asserting `applyEffects` is called with it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit src/components/ai/ask/AskChat.test.tsx src/components/ai/actions/QuickAction.test.tsx`
Expected: FAIL — `applyEffects` never called.

- [ ] **Step 3: Wire `AskChat`**

In `src/components/ai/ask/AskChat.tsx`, add the import and the hook call in the component body:

```tsx
import { useApplyBoardEffects } from "@/lib/boards/use-ai-effects";
```

```tsx
// Renders an approved write on a mounted board with no round-trip. A no-op
// on /ask (no board cache) and for a board the user isn't viewing, so it
// needs no guard here.
const applyBoardEffects = useApplyBoardEffects();
```

and one line inside `resolve`'s success branch, before the transcript append:

```tsx
      setBusyId(null);
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
      applyBoardEffects(res.data.effects);
      setMessages((m) => [
```

- [ ] **Step 4: Wire `QuickAction`**

In `src/components/ai/actions/QuickAction.tsx`, add the same import and hook call, then one line inside `approve`'s success path — placed **after** the per-result failure check so a partial failure still renders whatever landed:

```tsx
const failed = res.data.results.find((r) => !r.ok);
applyBoardEffects(res.data.effects);
if (failed && !failed.ok) {
  setState("error");
  setNote(failed.error);
  return;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/components/ai/ask/AskChat.test.tsx src/components/ai/actions/QuickAction.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify no navigation was introduced**

Run: `grep -n "router.refresh\|revalidatePath\|invalidateQueries" src/components/ai/ask/AskChat.tsx src/components/ai/actions/QuickAction.tsx src/lib/boards/use-ai-effects.ts`
Expected: the only hit is the **pre-existing** `router.refresh()` in `AskChat`'s `done` handler (which refreshes the `/ask` rail titles when there is no `onTurnComplete` — the dock always supplies one, so it never fires there). No new hit on the approve path.

- [ ] **Step 7: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/ai/ask/AskChat.tsx src/components/ai/actions/QuickAction.tsx src/components/ai/ask/AskChat.test.tsx src/components/ai/actions/QuickAction.test.tsx
git commit -m "feat(ai): render an approved write on the board without a reload

Both approve surfaces now fold the server's effects into the board cache. A
create_item whose field write failed still shows the row — the effect rides
along with the error rather than instead of it.

Closes the open thread from the board-dock session: an approved AI write is no
longer invisible until reload.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Prove it end-to-end, and file the Realtime diagnostic

**Files:**

- Create: `e2e/ai-write-visibility.spec.ts`
- Create: `vault/decisions/2026-08-04-gotcha-XX-<slug>.md` **only if** the diagnostic finds something

**Interfaces:**

- Consumes: the whole wired path (Task 7).
- Produces: nothing other code imports.

**Why this task exists:** gotcha-13's closing consequence is explicit — "`pnpm e2e` is the gate that catches Realtime-render gaps; unit/typecheck/lint/build cannot." Every unit test above mocks the boundary that actually failed. This is the only layer that runs a real Supabase Realtime channel and a real board.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/ai-write-visibility.spec.ts`, following the setup/auth helpers used by `e2e/ask.spec.ts` and `e2e/boards.spec.ts` (read both first — do not invent a fixture):

```ts
import { test, expect } from "@playwright/test";

test.describe("AI write visibility", () => {
  test("an approved move appears on the board with no reload", async ({
    page,
  }) => {
    // …sign in and open a board with two groups, per e2e/boards.spec.ts…
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByRole("row", { name: /Alpha/ })).toBeVisible();

    await page.getByRole("button", { name: "Open agent dock" }).click();
    await page.getByRole("textbox").fill('move "Alpha" to Doing');
    await page.keyboard.press("Enter");

    const card = page.getByRole("group", { name: "Proposed action" });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByRole("button", { name: "Approve" }).click();

    // The assertion that matters: NO page.reload() anywhere above this line.
    await expect(
      page.getByTestId(`group-${doingGroupId}`).getByText("Alpha"),
    ).toBeVisible();
  });
});
```

If the board table exposes no stable per-group test id, add one in this task rather than asserting on DOM position.

- [ ] **Step 2: Run the spec**

Run: `pnpm e2e e2e/ai-write-visibility.spec.ts`
Expected: PASS. If the AI turn is too non-deterministic to drive reliably, drive `executeActions` directly from the page context instead of through the model — the thing under test is the render path, not the model's phrasing.

- [ ] **Step 3: Run the Realtime diagnostic**

With the board open in one tab, approve a move and watch the console for the `board:<id>` channel's `items` event. Record the answer in the commit body:

- **Echo arrives:** the fix is now belt-and-braces (patch renders it; echo de-dupes, since `insertItem`/`insertGroup` are id-idempotent and `applyItem` replaces by id). Nothing further to do.
- **Echo does not arrive:** write an ADR in `vault/decisions/` naming the root cause. It is a separate task — this plan's fix does not depend on it.

- [ ] **Step 4: Run the full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add e2e/ai-write-visibility.spec.ts
git commit -m "test(e2e): prove an approved AI write renders without a reload

Unit tests mock the exact boundary that failed here, so e2e is the only gate
that can observe this (gotcha-13). Asserts the moved row appears in the target
group with no page.reload() anywhere in the test.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Performance & data-fetching budget (working agreement #5)

Restated here so it is checkable at review time, not only at spec time.

| Question                                             | Answer                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **First paint**                                      | Unchanged. Board RSC issues its existing reads; `BoardCache` seeded via `initialData`; the dock still renders collapsed with **zero** requests.                                                                                                                                                                                                    |
| **On approve**                                       | **Zero new server round-trips.** The effect rides back on the `applyAskProposal` / `executeActions` response the client already awaited.                                                                                                                                                                                                           |
| **Rendering the change**                             | One `setQueryData` on `["board", boardId]` → one client re-render of the subscribed views.                                                                                                                                                                                                                                                         |
| **Does the interaction change server data?**         | **Yes** → Server Action + targeted revalidation. On this surface "targeted revalidation" means a **client-cache patch**, not `revalidatePath` — the board's server payload is not what the mounted client reads (`group.ts:19-29`).                                                                                                                |
| **Does an approve re-run the board page's queries?** | **No**, by construction: no `router.refresh`, no `revalidatePath`, no `invalidateQueries`. Task 7 Step 6 is the grep that enforces it.                                                                                                                                                                                                             |
| **Bounded hot-path reads**                           | No new query. The widened `.select("*")` calls return **at most one row per write**, in a request already being made, over primary-key lookups. `moveItem`'s subitem ids come from an update it already performs. Both approve entry points are capped at **≤10 actions**, so the effects array is bounded at ≤10 and cannot grow with board size. |

---

## Self-review notes

- **Spec coverage:** shared-vs-per-verb → Task 4 (the `never` check). Mechanism choice → Tasks 1, 5, 7. Rows to patch with → Tasks 2, 3. Both approve surfaces → Tasks 6, 7. WA#5 → the budget table above and Task 7 Step 6. WA#6 → the Execution DAG. Realtime question → Task 8 Step 3. Escape hatch (Option C) → documented in the spec; no task, by design.
- **Type consistency:** `BoardEffect` members are `item_created` / `item_moved` / `item_fields_set` / `group_created` in Tasks 1, 4, 5, 6, 7. `executeAction` returns `{ result, effect }` in Tasks 4 and 6. `moveItem` returns `{ item, subitemIds }` in Tasks 2 and 4. `upsertCell` returns `{ cell }` in Tasks 3 and 4. `useApplyBoardEffects` takes `readonly BoardEffect[]` in Tasks 5 and 7.
- **Not covered on purpose:** correcting drag-and-drop's guessed optimistic position now that `moveItem` returns the real one, and the Realtime root cause. Both are named as out of scope in the spec.
