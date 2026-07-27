# MCP `assigned` Notification Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution context:** the worktree already exists — `.claude/worktrees/mcp-assign-notify` on branch `task/mcp-assign-notify`, cut from `develop`. Work there (`EnterWorktree({ path: ".claude/worktrees/mcp-assign-notify" })` before dispatching subagents). Do **not** build on `develop`.
>
> **Spec:** `docs/superpowers/specs/2026-07-26-mcp-assigned-notification-design.md`. Read §3 (the two resolved risks), §5 (design), §6 (why `clearCell` stays silent) and §7 (perf budget) before Task 1. Background ADR: `vault/decisions/2026-07-25-gotcha-60-server-action-side-effects-invisible-to-mcp.md`.

**Goal:** Assigning a person to an item via MCP (`create_item` / `update_item`) sends the same `kind: "assigned"` notification the Monolith UI sends — by making both callers share one implementation instead of two.

**Architecture:** Hoist `upsertCellCore(supabase, input, actorId)` into a new non-`"use server"` module `src/lib/boards/actions/cell-core.ts`. `upsertCell` becomes a thin cookie-client wrapper (Zod parse → `createClient()` → actor from `@/lib/auth/session`), and the MCP `writeCellValue` becomes a thin adapter passing the bridged client plus the MCP user id. The core performs **no** auth lookup — `actorId` is always injected, which is what makes it identical under a cookie session and an OAuth bearer session.

**Tech Stack:** TypeScript strict, Next.js 16 Server Actions, Supabase JS 2.108.1 (RLS via `authenticated` role), Zod 4, Vitest 4 (`unit` + `integration` projects).

---

## Global Constraints

- **This IS a behavior change, deliberately: MCP people-cell writes now insert `notifications` rows.** Everything else must stay identical — same error strings (with the one documented exception below), same `isError` values, same upserted row fields, same query counts.
- **The one intentional string change:** `writeCellValue`'s `` `Column ${field.columnId} not found.` `` becomes the core's `"Column not found."`. Both handlers already prefix `` `${field.columnId}: ` ``, so the agent still sees `c1: Column not found.`. Exactly two existing assertions change (Task 6). Any _other_ test that needs editing to go green means you changed behavior — **stop and report**.
- **`src/lib/boards/actions/cell-core.ts` must NOT contain the `"use server"` directive.** A `"use server"` module may only export async functions with serializable arguments; a `SupabaseClient` parameter is neither, and `pnpm build` will reject it. Do not add the core to the `src/lib/boards/actions.ts` barrel either.
- **The core must never call `supabase.auth.*`.** That is the regression this task exists to prevent (spec §3.1). Task 2 pins it with a test.
- **`getClient()` stays exactly one call per MCP tool invocation** — each call charges the MCP rate limit and rotates the bridge secret (`src/lib/mcp/context.ts:39,50-51`). Never move it into `writeCellValue` or a field loop. The existing `calls.getClient` assertions must stay green.
- **No migration.** RLS already permits the insert as the MCP user (spec §3.2, verified against DEV). If you find yourself writing SQL, stop — the premise is wrong and it needs re-scoping.
- **Do not do the sibling audit** of other Server Actions with cookie-invisible side effects (`collaboration/actions.ts`, `feedback/actions.ts`, `org/admin-actions.ts`, `platform/actions.ts`, `account/actions.ts`). Separate task. Do not touch those files.
- TypeScript strict, no `any`. `ActionResult` / `fail` come from `src/lib/actions/result.ts` — never re-declared.
- Commit subjects: lowercase after `type(scope):` — commitlint rejects sentence-case.
- Stage explicitly by path (`git add <paths>`). Never `git add -A` / `git add .` / `git commit -a`.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must all pass before `scripts/finish-task.sh`.

## Baseline (measure before starting)

```bash
npx vitest run --project unit src/lib/mcp/ src/lib/boards/actions.test.ts
```

Record the file/test counts in Task 8's verification note. Every one of these tests must still pass at the end, with only the two string assertions from Task 6 edited.

---

## File Structure

| File                                                                                              | Responsibility                                                                                                                                | Task |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `src/test/mcp-fake-client.ts`                                                                     | Test support. Gains a `cell_values` prior-read response, a `notifications` insert capture, and a repeatable `.eq()` chain.                    | 1    |
| `src/lib/boards/actions/cell-core.ts` (**new**)                                                   | The single implementation of "write one cell": guards, kind validation, upsert, `assigned` fan-out. Client- and actor-injected. No directive. | 2    |
| `src/lib/boards/actions/cell-core.test.ts` (**new**)                                              | Unit proof of the core: fan-out matrix, no-auth-access pin, query counts, guard messages.                                                     | 2    |
| `src/lib/mcp/context.ts`                                                                          | Adds `mcpActorId(auth)` — the typed read of `AuthInfo.extra.userId`.                                                                          | 3    |
| `src/lib/mcp/context.test.ts`                                                                     | Adds two `mcpActorId` cases.                                                                                                                  | 3    |
| `src/lib/mcp/tools/mcp-bridged-notify.rls.integration.test.ts` (**new**)                          | End-to-end proof that a bearer-shaped client can insert an `assigned` row. Skips without `.env.test`.                                         | 4    |
| `src/lib/boards/actions/cell.ts`                                                                  | `upsertCell` reduced to a wrapper. `clearCell` untouched.                                                                                     | 5    |
| `src/lib/boards/actions.test.ts`                                                                  | Fan-out block re-pointed at the session-helper actor; new `clearCell` silence test.                                                           | 5    |
| `src/lib/mcp/tools/shared.ts`                                                                     | `writeCellValue` becomes a 4-line adapter over the core; `KNOWN GAP` comment deleted.                                                         | 6    |
| `src/lib/mcp/tools/create-item.ts` / `update-item.ts`                                             | Handlers take a trailing required `actorId: string` and thread it through.                                                                    | 6    |
| `src/lib/mcp/tools/register.ts`                                                                   | Resolves `actorId` once and passes it to the two write tools.                                                                                 | 6    |
| `src/lib/mcp/tools/create-item.test.ts` / `update-item.test.ts` / `cell-value-validation.test.ts` | Call-site updates (Task 6), then new people fan-out tests (Task 7).                                                                           | 6, 7 |

---

## Execution DAG

```
Batch A (no unmet dependencies — 4-way parallel):
  Task 1 — extend src/test/mcp-fake-client.ts
  Task 2 — src/lib/boards/actions/cell-core.ts + its tests   ← critical path starts
  Task 3 — mcpActorId helper in src/lib/mcp/context.ts
  Task 4 — bridged-client RLS integration test

Batch B (parallel — disjoint file sets: boards/ vs mcp/):
  Task 5 — rewire upsertCell to the core          [needs 2]
  Task 6 — rewire the MCP write path to the core  [needs 2, 3]

Batch C:
  Task 7 — MCP people fan-out unit tests          [needs 1, 6]

Batch D:
  Task 8 — verification sweep, four gates, finish-task  [needs 4, 5, 6, 7]
```

**Dependency graph:** T1→{}, T2→{}, T3→{}, T4→{}, T5→{2}, T6→{2,3}, T7→{1,6}, T8→{4,5,6,7}.

**Parallel batches:** A = {1,2,3,4}; B = {5,6}; C = {7}; D = {8}.

**Critical path:** Task 2 → Task 6 → Task 7 → Task 8 (4 deep). That is the wall-clock floor; Tasks 1/3/4 are free riders on Batch A.

**Honest execution advice:** this is ~250 LOC. Batch A is a genuine 4-way wave (four disjoint files, no shared symbols) and is worth dispatching in parallel. Batch B's two tasks touch disjoint trees and can run in parallel, but they are ~40 lines each — running them back-to-back in one agent costs less than dispatch overhead. All tasks write inside the existing `mcp-assign-notify` worktree; do **not** create nested worktrees.

---

### Task 1: Extend the MCP fake Supabase client

**Files:**

- Modify: `src/test/mcp-fake-client.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `FakeClientSpec.priorCell`, `FakeClientSpec.notify`, `FakeCalls.notifications`, and a repeatable `.eq()` chain. Consumed by Task 7.

**Why:** after Task 6 the MCP write path calls the core, which issues a two-`.eq()` `cell_values` read and a `notifications` insert on people columns. The current fake supports neither (`select().eq().maybeSingle()` only, no `insert`), so Task 7's tests cannot be written without this.

- [ ] **Step 1: Add the new spec/calls types**

In `src/test/mcp-fake-client.ts`, after the `CreatedItem` type, add:

```ts
export type CellValueRow = { value: unknown } | null;
```

Add these two fields to `FakeClientSpec` (keep the existing ones):

```ts
  /** The `cell_values` prior-assignee read the core issues for `people` columns. */
  priorCell?: Queued<FakeResult<CellValueRow>>;
  /** The `notifications` insert result. */
  notify?: { error: FakeError };
```

Add this field to `FakeCalls`:

```ts
  /** Every notifications insert, in order — the array of rows passed to `.insert()`. */
  notifications: unknown[];
```

- [ ] **Step 2: Add the default and make the read chain table-aware**

Add next to `OK_ITEM`:

```ts
const EMPTY_CELL: FakeResult<CellValueRow> = { data: null, error: null };
```

Initialise the new call log and counter inside `makeFakeClient`:

```ts
const calls: FakeCalls = {
  upserts: [],
  rpc: [],
  getClient: 0,
  notifications: [],
};
let columnReads = 0;
let itemReads = 0;
let upsertWrites = 0;
let priorReads = 0;
```

Replace the `select:` property of the object returned by `from(table)` with a chain whose `.eq()` is repeatable (the core calls `.eq().eq().maybeSingle()` on `cell_values`, `.eq().maybeSingle()` elsewhere):

```ts
      select: () => {
        const read = () =>
          table === "columns"
            ? Promise.resolve(dequeue(spec.column, OK_COLUMN, columnReads++))
            : table === "cell_values"
              ? Promise.resolve(dequeue(spec.priorCell, EMPTY_CELL, priorReads++))
              : Promise.resolve(dequeue(spec.item, OK_ITEM, itemReads++));
        type Chain = {
          eq: () => Chain;
          maybeSingle: () => Promise<
            FakeResult<ColumnRow | ItemRow | CellValueRow>
          >;
        };
        const chain: Chain = { eq: () => chain, maybeSingle: () => read() };
        return chain;
      },
```

- [ ] **Step 3: Add the `insert` capture**

Add to the same object literal, after `upsert`:

```ts
      insert: (rows: unknown) => {
        calls.notifications.push(rows);
        return Promise.resolve(spec.notify ?? { error: null });
      },
```

- [ ] **Step 4: Verify nothing regressed**

Run: `npx vitest run --project unit src/lib/mcp/`
Expected: PASS, same test count as the baseline (the fake is additive; no existing test uses `priorCell`/`notify` yet).

- [ ] **Step 5: Commit**

```bash
git add src/test/mcp-fake-client.ts
git commit -m "test(mcp): teach the fake client cell_values reads and notification inserts"
```

---

### Task 2: The client-injected core

**Files:**

- Create: `src/lib/boards/actions/cell-core.ts`
- Create: `src/lib/boards/actions/cell-core.test.ts`

**Interfaces:**

- Consumes: `cellValueSchema` (`@/lib/validations/boards`), `ActionResult` / `fail` (`@/lib/actions/result`), `Database` / `Json` (`@/types/database.types`).
- Produces: `upsertCellCore(supabase, input, actorId)` and the type `UpsertCellCoreInput`. Consumed by Tasks 5 and 6.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/boards/actions/cell-core.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { upsertCellCore } from "./cell-core";

const ITEM = "11111111-1111-4111-8111-111111111111";
const COL = "22222222-2222-4222-8222-222222222222";
const ACTOR = "99999999-9999-4999-8999-999999999999";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Ctx = {
  client: unknown;
  upsert: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  authTouched: () => boolean;
};

/** A minimal chainable Supabase stub with an auth tripwire (spec §3.1). */
function makeClient(opts: {
  kind: string;
  prior?: { userIds: string[] } | null;
  notifyError?: { message: string } | null;
  itemBoardId?: string;
  columnMissing?: boolean;
}): Ctx {
  let touchedAuth = false;
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const notify = vi.fn().mockResolvedValue({ error: opts.notifyError ?? null });
  const read = (table: string) =>
    table === "columns"
      ? {
          data: opts.columnMissing
            ? null
            : { org_id: "org", board_id: "board", kind: opts.kind },
          error: null,
        }
      : table === "items"
        ? {
            data: { board_id: opts.itemBoardId ?? "board" },
            error: null,
          }
        : { data: opts.prior ? { value: opts.prior } : null, error: null };
  const client = {
    from: (table: string) => {
      type Chain = { eq: () => Chain; maybeSingle: () => Promise<unknown> };
      const chain: Chain = {
        eq: () => chain,
        maybeSingle: async () => read(table),
      };
      return { select: () => chain, upsert, insert: notify };
    },
    get auth() {
      touchedAuth = true;
      return { getUser: async () => ({ data: { user: null } }) };
    },
  };
  return { client, upsert, notify, authTouched: () => touchedAuth };
}

const call = (ctx: Ctx, value: unknown, actorId: string | null = ACTOR) =>
  upsertCellCore(
    ctx.client as never,
    { itemId: ITEM, columnId: COL, value },
    actorId,
  );

beforeEach(() => vi.restoreAllMocks());

describe("upsertCellCore", () => {
  it("notifies only newly-added members, excluding the actor", async () => {
    const ctx = makeClient({ kind: "people", prior: { userIds: [A] } });
    const res = await call(ctx, { userIds: [A, B, ACTOR] });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(ctx.upsert).toHaveBeenCalledTimes(1);
    expect(ctx.notify).toHaveBeenCalledTimes(1);
    expect(ctx.notify).toHaveBeenCalledWith([
      {
        org_id: "org",
        recipient_id: B,
        actor_id: ACTOR,
        kind: "assigned",
        board_id: "board",
        item_id: ITEM,
      },
    ]);
  });

  it("does not notify when no member was added", async () => {
    const ctx = makeClient({ kind: "people", prior: { userIds: [A] } });
    const res = await call(ctx, { userIds: [A] });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it("never reads ambient auth, and skips the fan-out for a non-people column", async () => {
    const ctx = makeClient({ kind: "text" });
    const res = await call(ctx, { text: "hi" });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(ctx.notify).not.toHaveBeenCalled();
    expect(ctx.authTouched()).toBe(false);
  });

  it("skips the insert and logs when there is no actor", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeClient({ kind: "people" });
    const res = await call(ctx, { userIds: [A] }, null);

    expect(res).toEqual({ ok: true, data: undefined });
    expect(ctx.notify).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(
      "[notifications] assigned fan-out failed",
      expect.objectContaining({ recipients: 1, error: "no actor" }),
    );
  });

  it("returns ok but logs when the notification insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeClient({
      kind: "people",
      notifyError: { message: "insert denied" },
    });
    const res = await call(ctx, { userIds: [A] });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(spy).toHaveBeenCalledWith(
      "[notifications] assigned fan-out failed",
      expect.objectContaining({
        itemId: ITEM,
        recipients: 1,
        error: "insert denied",
      }),
    );
  });

  it("guards: missing column, cross-board item, invalid value", async () => {
    const missing = makeClient({ kind: "text", columnMissing: true });
    expect(await call(missing, { text: "x" })).toEqual({
      ok: false,
      error: "Column not found.",
    });

    const crossBoard = makeClient({ kind: "text", itemBoardId: "other" });
    expect(await call(crossBoard, { text: "x" })).toEqual({
      ok: false,
      error: "Item and column belong to different boards.",
    });
    expect(crossBoard.upsert).not.toHaveBeenCalled();

    const badValue = makeClient({ kind: "people" });
    const res = await call(badValue, { userIds: "not-an-array" });
    expect(res.ok).toBe(false);
    expect(badValue.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project unit src/lib/boards/actions/cell-core.test.ts`
Expected: FAIL — cannot resolve `./cell-core`.

- [ ] **Step 3: Write the core**

Create `src/lib/boards/actions/cell-core.ts` with exactly this content:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cellValueSchema } from "@/lib/validations/boards";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { Database, Json } from "@/types/database.types";

/** What a cell write needs, already parsed by the caller's own Zod boundary. */
export type UpsertCellCoreInput = {
  itemId: string;
  columnId: string;
  value: unknown;
};

/**
 * The single implementation of "write one cell value" for the whole app:
 * derives org_id/board_id from the parent column, guards item/column board
 * integrity, validates the value against the column kind, upserts, and — for a
 * `people` column — fans out `kind: "assigned"` notifications to the
 * newly-added members.
 *
 * Both the Supabase client AND the actor are injected, which is the entire
 * point: a cookie-bound Server Action and a bearer-token MCP request produce
 * different clients and resolve their user differently, but must produce
 * identical side effects. This function therefore NEVER calls `supabase.auth.*`
 * — see `vault/decisions/2026-07-25-gotcha-60-server-action-side-effects-invisible-to-mcp.md`
 * and spec §3.1 (`docs/superpowers/specs/2026-07-26-mcp-assigned-notification-design.md`).
 *
 * Callers: `upsertCell` (`./cell.ts`, cookie client) and `writeCellValue`
 * (`src/lib/mcp/tools/shared.ts`, bridged OAuth client).
 */
export async function upsertCellCore(
  supabase: SupabaseClient<Database>,
  input: UpsertCellCoreInput,
  actorId: string | null,
): Promise<ActionResult> {
  // Derive org_id/board_id + kind from the parent column (RLS-scoped read).
  const { data: column, error: colErr } = await supabase
    .from("columns")
    .select("org_id, board_id, kind")
    .eq("id", input.columnId)
    .maybeSingle();
  if (colErr || !column) return fail("Column not found.");

  // Within-org integrity guard: item must belong to the same board as the column.
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("board_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (itemErr || !item) return fail("Item not found.");
  if (item.board_id !== column.board_id)
    return fail("Item and column belong to different boards.");

  // Validate the value against the column kind's shape.
  const valueParsed = cellValueSchema(column.kind).safeParse(input.value);
  if (!valueParsed.success)
    return fail(valueParsed.error.issues[0]?.message ?? "Invalid value");

  // For People cells, read the prior assignees so we can fan out 'assigned'
  // notifications to only the newly-added members after the write.
  let priorPeople: string[] = [];
  if (column.kind === "people") {
    const { data: prior } = await supabase
      .from("cell_values")
      .select("value")
      .eq("item_id", input.itemId)
      .eq("column_id", input.columnId)
      .maybeSingle();
    priorPeople =
      (prior?.value as { userIds?: string[] } | null)?.userIds ?? [];
  }

  const { error } = await supabase.from("cell_values").upsert(
    {
      org_id: column.org_id,
      board_id: column.board_id,
      item_id: input.itemId,
      column_id: input.columnId,
      value: valueParsed.data as Json,
    },
    { onConflict: "item_id,column_id" },
  );
  if (error) return fail(error.message);

  if (column.kind === "people") {
    const next = (valueParsed.data as { userIds?: string[] }).userIds ?? [];
    const added = next.filter(
      (id) => !priorPeople.includes(id) && id !== actorId,
    );
    if (added.length > 0) {
      // Best-effort fan-out: the cell write already succeeded, so never fail the
      // caller — but never drop the failure silently either (spec F3 / decision D4).
      let notifError: string | undefined;
      if (!actorId) {
        // A null actor cannot satisfy the `actor_id = auth.uid()` insert policy,
        // so log it instead of paying a round-trip to be told so.
        notifError = "no actor";
      } else {
        const { error: notifErr } = await supabase.from("notifications").insert(
          added.map((rid) => ({
            org_id: column.org_id,
            recipient_id: rid,
            actor_id: actorId,
            kind: "assigned" as const,
            board_id: column.board_id,
            item_id: input.itemId,
          })),
        );
        notifError = notifErr?.message;
      }
      if (notifError)
        console.error("[notifications] assigned fan-out failed", {
          itemId: input.itemId,
          recipients: added.length,
          error: notifError,
        });
    }
  }
  return { ok: true, data: undefined };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/lib/boards/actions/cell-core.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/actions/cell-core.ts src/lib/boards/actions/cell-core.test.ts
git commit -m "feat(boards): add client-injected upsertCellCore with actor-injected assigned fan-out"
```

---

### Task 3: `mcpActorId` helper

**Files:**

- Modify: `src/lib/mcp/context.ts`
- Modify: `src/lib/mcp/context.test.ts`

**Interfaces:**

- Consumes: `AuthInfo` (already imported in `context.ts`).
- Produces: `mcpActorId(auth: AuthInfo): string`. Consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/mcp/context.test.ts` (keep the existing imports; add `mcpActorId` to the import from `./context`):

```ts
describe("mcpActorId", () => {
  it("returns the user id resolveMcpAuth stamped on the auth context", () => {
    expect(
      mcpActorId({
        token: "t",
        clientId: "c",
        scopes: [],
        extra: { userId: "user-1" },
      } as never),
    ).toBe("user-1");
  });

  it("throws on a malformed auth context", () => {
    expect(() =>
      mcpActorId({ token: "t", clientId: "c", scopes: [] } as never),
    ).toThrow("Malformed auth context.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/lib/mcp/context.test.ts`
Expected: FAIL — `mcpActorId` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/mcp/context.ts`, directly after `resolveMcpAuth`:

```ts
/**
 * The authenticated MCP user's id — the `actor_id` for any side effect a tool
 * performs on their behalf (e.g. the `assigned` notification fan-out in
 * `upsertCellCore`). `resolveMcpAuth` always stamps it, so absence is a
 * programming error, not a runtime condition: throw, exactly as
 * `getRequestClient` does for its sibling `extra` fields.
 *
 * It must match the subject of the bridged access token, otherwise the
 * `notifications` insert policy (`actor_id = auth.uid()`) rejects the row —
 * a fail-closed outcome, never a cross-tenant write.
 */
export function mcpActorId(auth: AuthInfo): string {
  const userId = auth.extra?.userId;
  if (typeof userId !== "string" || !userId)
    throw new Error("Malformed auth context.");
  return userId;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/lib/mcp/context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/context.ts src/lib/mcp/context.test.ts
git commit -m "feat(mcp): expose mcpActorId for tool side effects"
```

---

### Task 4: Bridged-client RLS integration proof

**Files:**

- Create: `src/lib/mcp/tools/mcp-bridged-notify.rls.integration.test.ts`

**Interfaces:**

- Consumes: `integrationTargetReady` / `loadIntegrationEnv` (`@/test/integration-env`), `signInWithRetry` (`@/test/integration-auth`).
- Produces: nothing consumed by other tasks — it is the evidence for spec §3.2.

**Why:** every other test in this plan mocks Supabase. This is the only one that proves the actual claim — that a client shaped exactly like `clientFromAccessToken` (anon key + `Authorization: Bearer <access token>`, no stored session) satisfies the `notifications` insert policy. It runs only against a provisioned test project (`.env.test`); it **skips** in the normal `pnpm test` gate, which is why it cannot replace Tasks 2 and 7.

- [ ] **Step 1: Write the test**

Create `src/lib/mcp/tools/mcp-bridged-notify.rls.integration.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

// Proves spec §3.2: the MCP bridged client — anon key + a bearer access token,
// no stored session (`src/lib/mcp/oauth/session-bridge.ts:99`) — can insert the
// `assigned` notification that `upsertCellCore` fans out. Same role, same
// policy as the cookie client; no migration needed.
describe.skipIf(!integrationTargetReady())(
  "RLS: assigned fan-out via a bridged (bearer) client",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    async function makeUser(): Promise<{
      id: string;
      anon: SupabaseClient<Database>;
    }> {
      const email = `mcp-notify-${randomUUID()}@example.com`;
      const { data: created } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      const id = created.user!.id;
      createdUserIds.push(id);
      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });
      return { id, anon };
    }

    let actor: { id: string; anon: SupabaseClient<Database> };
    let recipient: { id: string; anon: SupabaseClient<Database> };
    let outsider: { id: string; anon: SupabaseClient<Database> };
    let bridged: SupabaseClient<Database>;
    let orgId: string;
    let boardId: string;
    let itemId: string;

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      actor = await makeUser();
      recipient = await makeUser();
      outsider = await makeUser();

      const { data: org } = await actor.anon.rpc("create_organization", {
        p_name: "MCP Notify Org",
        p_slug: `mcp-notify-${randomUUID().slice(0, 8)}`,
      });
      orgId = (org as { id: string }).id;
      await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: recipient.id, role: "member" });

      const { data: ws } = await actor.anon
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: actor.id })
        .select("id")
        .single();
      const { data: board } = await actor.anon.rpc("create_board", {
        p_workspace_id: (ws as { id: string }).id,
        p_name: "Board",
      });
      boardId = (board as { id: string }).id;
      const { data: group } = await actor.anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .limit(1)
        .single();
      const { data: item } = await actor.anon.rpc("create_item", {
        p_group_id: (group as { id: string }).id,
        p_name: "Item",
      });
      itemId = (item as { id: string }).id;

      // The shape getBridgedClient() hands every MCP tool call.
      const { data: session } = await actor.anon.auth.getSession();
      bridged = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${session.session!.access_token}`,
          },
        },
      });
    });

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    });

    it("inserts an assigned notification for a co-member and the recipient sees it", async () => {
      const { error } = await bridged.from("notifications").insert({
        org_id: orgId,
        recipient_id: recipient.id,
        actor_id: actor.id,
        kind: "assigned",
        board_id: boardId,
        item_id: itemId,
      });
      expect(error).toBeNull();

      const { data: seen } = await recipient.anon
        .from("notifications")
        .select("id, kind")
        .eq("item_id", itemId);
      expect(seen ?? []).toHaveLength(1);
      expect(seen![0].kind).toBe("assigned");
    });

    it("rejects the whole batch when one recipient is not an org member", async () => {
      const { error } = await bridged.from("notifications").insert([
        {
          org_id: orgId,
          recipient_id: recipient.id,
          actor_id: actor.id,
          kind: "assigned" as const,
          board_id: boardId,
          item_id: itemId,
        },
        {
          org_id: orgId,
          recipient_id: outsider.id, // not a member → is_member_of() fails
          actor_id: actor.id,
          kind: "assigned" as const,
          board_id: boardId,
          item_id: itemId,
        },
      ]);
      expect(error).not.toBeNull();
    });
  },
);
```

- [ ] **Step 2: Run it**

Run: `npx vitest run --project integration src/lib/mcp/tools/mcp-bridged-notify.rls.integration.test.ts`
Expected without `.env.test`: **skipped** (0 tests run, file reported as skipped) — this is the normal, correct outcome. With a provisioned test project: 2 passed. Record which you observed in the Task 8 note; do not point it at DEV or PROD.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mcp/tools/mcp-bridged-notify.rls.integration.test.ts
git commit -m "test(mcp): prove a bridged bearer client may insert assigned notifications"
```

---

### Task 5: Reduce `upsertCell` to a wrapper

**Files:**

- Modify: `src/lib/boards/actions/cell.ts:1-108`
- Modify: `src/lib/boards/actions.test.ts:34-182`

**Interfaces:**

- Consumes: `upsertCellCore` (Task 2), `getUser` (`@/lib/auth/session`).
- Produces: nothing new — `upsertCell`'s exported signature is unchanged, so `bulk-actions.ts`, `time-actions.ts`, `ai/write/execute.ts` and `ItemAssistPanel.tsx` are untouched.

- [ ] **Step 1: Update the existing fan-out tests to the new actor source**

In `src/lib/boards/actions.test.ts`, the actor now comes from the already-mocked `@/lib/auth/session` (`sessionGetUser`) instead of `supabase.auth.getUser`. Add one line at the top of **each** of the two `it` bodies inside `describe("upsertCell people-cell assignment fan-out")`:

```ts
sessionGetUser.mockResolvedValue({ id: USER });
```

Change nothing else in that block — the assertions (including `actor_id: USER` and the
`"[notifications] assigned fan-out failed"` log shape) must still pass unmodified.

- [ ] **Step 2: Add the `clearCell` silence test (spec §6)**

Append this `it` inside the same `describe` block:

```ts
it("clearCell on a people column never notifies (removal is not an 'assigned' event)", async () => {
  const notifInsert = vi.fn().mockResolvedValue({ error: null });
  const del = vi.fn().mockResolvedValue({ error: null });
  from.mockImplementation((table: string) => {
    if (table === "columns")
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { board_id: "board" },
              error: null,
            }),
          }),
        }),
      } as never;
    if (table === "cell_values")
      return {
        delete: () => ({ eq: () => ({ eq: del }) }),
      } as never;
    if (table === "notifications") return { insert: notifInsert } as never;
    return {} as never;
  });

  const res = await clearCell({ itemId: ITEM, columnId: COL });

  expect(res).toEqual({ ok: true, data: undefined });
  expect(del).toHaveBeenCalledTimes(1);
  expect(notifInsert).not.toHaveBeenCalled();
});
```

Add `clearCell` to the existing `import { upsertCell } from "@/lib/boards/actions";` line.

- [ ] **Step 3: Run — expect the two edited tests to still pass and the new one to pass**

Run: `npx vitest run --project unit src/lib/boards/actions.test.ts`
Expected: FAIL on the two fan-out tests only (`actor_id` is now `undefined`/`owner-1` because `upsertCell` still reads `supabase.auth.getUser`) — that failure is the signal to do Step 4. The `clearCell` test should already pass.

- [ ] **Step 4: Rewrite `upsertCell`**

In `src/lib/boards/actions/cell.ts`, replace the whole `upsertCell` function (lines 12–108, doc comment included) with:

```ts
/**
 * Upsert a single cell value (Server Action). A thin cookie-client wrapper: it
 * owns the untrusted-input Zod boundary and resolves the actor, then delegates
 * every rule — guards, kind validation, the `people` assignment fan-out — to
 * `upsertCellCore`, which the MCP tool layer calls with its own bearer client.
 * Keeping the logic in the core is what stops the two paths from diverging
 * (gotcha-60).
 *
 * The actor comes from `@/lib/auth/session`'s `getUser()` (local JWKS verify,
 * React-cached) rather than `supabase.auth.getUser()` (a GoTrue round-trip) —
 * so a bulk people-assign over N items now costs one local verify, not N calls.
 */
export async function upsertCell(input: {
  itemId: string;
  columnId: string;
  value: unknown;
}): Promise<ActionResult> {
  const parsed = upsertCellSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const user = await getUser();
  return upsertCellCore(supabase, parsed.data, user?.id ?? null);
}
```

Update the imports at the top of the file: add

```ts
import { getUser } from "@/lib/auth/session";
import { upsertCellCore } from "./cell-core";
```

and delete the now-unused `cellValueSchema` and `Json` imports (`clearCell` uses neither). Leave
`clearCell` exactly as it is.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project unit src/lib/boards/actions.test.ts src/lib/boards/bulk-actions.test.ts src/lib/ai/write/execute.test.ts`
Expected: PASS, all files. (The latter two mock `upsertCell` wholesale and must be untouched.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/actions/cell.ts src/lib/boards/actions.test.ts
git commit -m "refactor(boards): reduce upsertCell to a cookie-client wrapper over upsertCellCore"
```

---

### Task 6: Point the MCP write path at the core

**Files:**

- Modify: `src/lib/mcp/tools/shared.ts:25-78`
- Modify: `src/lib/mcp/tools/create-item.ts`
- Modify: `src/lib/mcp/tools/update-item.ts`
- Modify: `src/lib/mcp/tools/register.ts`
- Modify: `src/lib/mcp/tools/create-item.test.ts`, `update-item.test.ts`, `cell-value-validation.test.ts` (call sites + 2 string assertions)

**Interfaces:**

- Consumes: `upsertCellCore` (Task 2), `mcpActorId` (Task 3).
- Produces: `writeCellValue(supabase, itemId, field, actorId)`, `createItemHandler(getClient, input, actorId)`, `updateItemHandler(getClient, input, actorId)`. Consumed by Task 7.

- [ ] **Step 1: Rewrite `writeCellValue`**

In `src/lib/mcp/tools/shared.ts`, replace the doc comment and body of `writeCellValue` (lines 25–78) with:

```ts
/**
 * Writes one cell value on behalf of the authenticated MCP user. Returns `null`
 * on success, or a human-readable message the caller surfaces to the agent in
 * `fieldErrors`.
 *
 * Delegates to `upsertCellCore` — the same function the `upsertCell` Server
 * Action calls — so the `people` assignment fan-out happens on this path by
 * construction. (Before 2026-07-26 this re-implemented the guards and silently
 * dropped the fan-out: gotcha-60.) `upsertCell` itself still cannot be called
 * here: it is a `"use server"` action bound to `next/headers` cookies, and an
 * MCP request carries only an OAuth bearer token resolved to a bridged client.
 *
 * `actorId` is injected rather than read from `supabase.auth`: it is already
 * known (`mcpActorId(auth)`), and an auth lookup on a bridged client would cost
 * a GoTrue round-trip per write while depending on supabase-js's
 * custom-Authorization-header internals. See spec §3.1
 * (`docs/superpowers/specs/2026-07-26-mcp-assigned-notification-design.md`).
 */
export async function writeCellValue(
  supabase: SupabaseClient<Database>,
  itemId: string,
  field: FieldInput,
  actorId: string,
): Promise<string | null> {
  const res = await upsertCellCore(
    supabase,
    { itemId, columnId: field.columnId, value: field.value },
    actorId,
  );
  return res.ok ? null : res.error;
}
```

Update the imports: add `import { upsertCellCore } from "@/lib/boards/actions/cell-core";`, and
delete the now-unused `cellValueSchema` and `Json` imports. Keep `z`, `SupabaseClient`, `Database`.

- [ ] **Step 2: Thread `actorId` through the two write tools**

In `src/lib/mcp/tools/create-item.ts`: add a third parameter to the handler and pass it down.

```ts
export async function createItemHandler(
  getClient: GetClient,
  input: {
    groupId: string;
    name: string;
    fields?: FieldInput[];
  },
  actorId: string,
) {
```

and the loop body becomes:

```ts
const err = await writeCellValue(supabase, item.id, field, actorId);
```

and the registration:

```ts
export function registerCreateItemTool(
  server: McpServer,
  getClient: GetClient,
  actorId: string,
): void {
  server.registerTool(
    "create_item",
    {
      title: "Create item",
      description:
        "Create a new item in a group, optionally setting initial field values.",
      inputSchema: createItemInput,
    },
    async (input) => createItemHandler(getClient, input, actorId),
  );
}
```

Apply the identical three edits to `src/lib/mcp/tools/update-item.ts` (`updateItemHandler`, the
`writeCellValue(supabase, input.itemId, field, actorId)` call, and `registerUpdateItemTool`).

- [ ] **Step 3: Resolve the actor once per request**

In `src/lib/mcp/tools/register.ts`:

```ts
import { getRequestClient, mcpActorId } from "@/lib/mcp/context";
```

```ts
export function registerTools(server: McpServer, auth: AuthInfo): void {
  const getClient = () => getRequestClient(auth);
  const actorId = mcpActorId(auth);
  registerListBoardsTool(server, getClient);
  registerGetBoardTool(server, getClient);
  registerSearchItemsTool(server, getClient);
  registerGetItemTool(server, getClient);
  registerCreateItemTool(server, getClient, actorId);
  registerUpdateItemTool(server, getClient, actorId);
}
```

- [ ] **Step 4: Update the existing MCP test call sites**

In `src/lib/mcp/tools/create-item.test.ts`, `update-item.test.ts` and
`cell-value-validation.test.ts`, add a shared constant near the top of each file:

```ts
const ACTOR = "99999999-9999-4999-8999-999999999999";
```

and append `, ACTOR` to **every** `createItemHandler(...)` / `updateItemHandler(...)` call.
Then make the two documented string edits (the only assertion changes allowed in this task):

- `create-item.test.ts`: `expect(parsed.fieldErrors).toEqual(["c1: Column c1 not found."])` →
  `expect(parsed.fieldErrors).toEqual(["c1: Column not found."])`
- `update-item.test.ts`: the same one-line change.

- [ ] **Step 5: Run the MCP suites**

Run: `npx vitest run --project unit src/lib/mcp/`
Expected: PASS, the same test count as the baseline. If any assertion other than those two needed
editing, revert and report — that is an unintended behavior change.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/tools/shared.ts src/lib/mcp/tools/create-item.ts src/lib/mcp/tools/update-item.ts src/lib/mcp/tools/register.ts src/lib/mcp/tools/create-item.test.ts src/lib/mcp/tools/update-item.test.ts src/lib/mcp/tools/cell-value-validation.test.ts
git commit -m "fix(mcp): send assigned notifications when a tool writes a people cell"
```

---

### Task 7: MCP fan-out unit tests

**Files:**

- Modify: `src/lib/mcp/tools/update-item.test.ts`
- Modify: `src/lib/mcp/tools/create-item.test.ts`

**Interfaces:**

- Consumes: `makeFakeClient` with `priorCell` / `notify` / `calls.notifications` (Task 1), the
  `actorId` parameter (Task 6).
- Produces: the regression net for the fix itself.

**Note:** both suites `vi.mock("@/lib/validations/boards")` so `cellValueSchema` is a pass-through.
That mock intercepts the module for the core too (Vitest mocks by module path, not importer), so
`{ userIds: [...] }` reaches the core unvalidated — which is what these tests want.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/mcp/tools/update-item.test.ts` (inside the existing top-level `describe`):

```ts
it("fans out an assigned notification for a newly-added person", async () => {
  const { getClient, calls } = makeFakeClient({
    column: {
      data: { org_id: "o1", board_id: "b1", kind: "people" },
      error: null,
    },
    priorCell: { data: { value: { userIds: ["u-old"] } }, error: null },
  });
  await updateItemHandler(
    getClient,
    {
      itemId: "i1",
      fields: [{ columnId: "c1", value: { userIds: ["u-old", "u-new"] } }],
    },
    ACTOR,
  );

  expect(calls.getClient).toBe(1);
  expect(calls.notifications).toEqual([
    [
      {
        org_id: "o1",
        recipient_id: "u-new",
        actor_id: ACTOR,
        kind: "assigned",
        board_id: "b1",
        item_id: "i1",
      },
    ],
  ]);
});

it("does not notify the actor for assigning themselves", async () => {
  const { getClient, calls } = makeFakeClient({
    column: {
      data: { org_id: "o1", board_id: "b1", kind: "people" },
      error: null,
    },
  });
  await updateItemHandler(
    getClient,
    { itemId: "i1", fields: [{ columnId: "c1", value: { userIds: [ACTOR] } }] },
    ACTOR,
  );

  expect(calls.notifications).toEqual([]);
});

it("writes a non-people cell without touching notifications", async () => {
  const { getClient, calls } = makeFakeClient();
  await updateItemHandler(
    getClient,
    { itemId: "i1", fields: [{ columnId: "c1", value: { text: "hi" } }] },
    ACTOR,
  );

  expect(calls.upserts).toHaveLength(1);
  expect(calls.notifications).toEqual([]);
});

it("still reports success when the notification insert is rejected", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const { getClient } = makeFakeClient({
    column: {
      data: { org_id: "o1", board_id: "b1", kind: "people" },
      error: null,
    },
    notify: { error: { message: "new row violates row-level security" } },
  });
  const result = await updateItemHandler(
    getClient,
    {
      itemId: "i1",
      fields: [{ columnId: "c1", value: { userIds: ["u-new"] } }],
    },
    ACTOR,
  );

  const parsed = JSON.parse(result.content[0]?.text as string);
  expect(parsed.fieldErrors).toEqual([]);
  expect(spy).toHaveBeenCalledWith(
    "[notifications] assigned fan-out failed",
    expect.objectContaining({ recipients: 1 }),
  );
  spy.mockRestore();
});
```

Append to `src/lib/mcp/tools/create-item.test.ts`:

```ts
it("fans out an assigned notification for an initial people field", async () => {
  const { getClient, calls } = makeFakeClient({
    column: {
      data: { org_id: "o1", board_id: "b1", kind: "people" },
      error: null,
    },
  });
  await createItemHandler(
    getClient,
    {
      groupId: "g1",
      name: "New task",
      fields: [{ columnId: "c1", value: { userIds: ["u-new"] } }],
    },
    ACTOR,
  );

  expect(calls.getClient).toBe(1);
  expect(calls.notifications).toEqual([
    [
      {
        org_id: "o1",
        recipient_id: "u-new",
        actor_id: ACTOR,
        kind: "assigned",
        board_id: "b1",
        item_id: "i1",
      },
    ],
  ]);
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run --project unit src/lib/mcp/tools/`
Expected: PASS (Task 6 already shipped the implementation; these tests exist to pin it). If the
first test fails with an empty `calls.notifications`, the wiring in Task 6 is wrong — fix the
implementation, not the test.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mcp/tools/create-item.test.ts src/lib/mcp/tools/update-item.test.ts
git commit -m "test(mcp): pin the assigned fan-out on create_item and update_item"
```

---

### Task 8: Verification sweep and close out

**Files:** none modified (unless a gate fails).

**Interfaces:** Consumes Tasks 4, 5, 6, 7.

- [ ] **Step 1: Confirm the invariants by grep, not by memory**

```bash
grep -n "use server" src/lib/boards/actions/cell-core.ts   # expect: no match
grep -rn "auth\." src/lib/boards/actions/cell-core.ts      # expect: no match (no supabase.auth.*)
grep -rn "KNOWN GAP" src/lib/mcp/                          # expect: no match
grep -rn "cell-core" src/lib/boards/actions.ts             # expect: no match (not in the barrel)
grep -rn "notifications" src/lib/mcp/tools/shared.ts       # expect: no match (fan-out lives in the core)
```

- [ ] **Step 2: Run the four gates in order**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four pass. `pnpm build` is the real check that `cell-core.ts` is not treated as a
Server Action module. Do not proceed on a warning you have not read.

- [ ] **Step 3: Confirm the untouched surfaces**

```bash
git diff --name-only develop...HEAD
```

Expected exactly the 15 source/test files in the File Structure table, plus the two committed
planning docs (`docs/superpowers/specs/2026-07-26-mcp-assigned-notification-design.md`,
`docs/superpowers/plans/2026-07-26-mcp-assigned-notification.md`). If `src/lib/collaboration/actions.ts`,
`src/lib/feedback/actions.ts`, `src/lib/org/admin-actions.ts`, `src/lib/platform/actions.ts`,
`src/lib/account/actions.ts`, any `supabase/migrations/*`, or `src/types/database.types.ts` appears,
the scope boundary was crossed — revert those paths.

- [ ] **Step 4: Finish the task**

```bash
scripts/finish-task.sh
```

- [ ] **Step 5: Hand the user a "How to test this" walkthrough**

This change **is** user-observable, so a walkthrough is required both in the closing message and in
the `/wrapup` session note. Use this:

1. Pull `develop` and restart the app (`pnpm dev`); make sure your Claude Desktop MCP connection to
   Monolith is authorized as **you**.
2. In Monolith, open any board that has a **People** column and note an item plus a teammate in the
   same org who is _not_ you.
3. In Claude Desktop, ask: "In Monolith, assign <teammate> to the item '<item name>'." (This calls
   `update_item` with a people field.)
4. In Monolith, confirm the People cell now shows that teammate — as before.
5. **The fix:** have the teammate open Monolith (or sign in as them) and check the notification bell —
   there should be a new "assigned you" notification pointing at that item. Before this change there
   was none.
6. Negative check: ask Claude to assign **yourself** to another item — no notification should
   appear for you (you never notify yourself).
7. Preference check: with the teammate's account, disable the in-app `assigned` notification in
   settings, repeat step 3 on a different item, and confirm **no** notification arrives (the DB
   gate applies to the MCP path too).

---

## Self-Review

**Spec coverage:** §3.1 explicit-actor decision → Tasks 2 (core signature + no-auth test), 3, 5, 6.
§3.2 RLS → Task 4 (evidence) + Task 7's rejected-insert test. §5.1 core module → Task 2. §5.2
wrapper → Task 5. §5.3 MCP rewire incl. the string change → Task 6. §6 `clearCell` stays silent →
Task 5 Step 2. §7 perf budget → asserted by the query-count/`calls.getClient` assertions in Tasks 2
and 7, and by the `auth`-tripwire test. §8 test list → Tasks 2, 5, 6, 7, 4. §2 non-goals → Global
Constraints + Task 8 Step 3.

**Naming consistency:** `upsertCellCore(supabase, input, actorId)` and `UpsertCellCoreInput`
(Task 2) are used verbatim in Tasks 5 and 6. `mcpActorId` (Task 3) is used verbatim in Task 6.
`priorCell` / `notify` / `calls.notifications` (Task 1) are used verbatim in Task 7.
`writeCellValue(supabase, itemId, field, actorId)` (Task 6) matches both call sites.
