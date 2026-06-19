# Phase 6a — Subitems Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-level subitems to boards — nested under their parent in the Table view, with expand/collapse, add/delete/reorder, and a rollup summary on the collapsed parent row.

**Architecture:** A subitem is an ordinary `items` row with `parent_id` set (the column already exists, reserved for this) and `org_id`/`board_id`/`group_id` inherited from the parent. Subitems share the board's columns, so their cells reuse `cell_values (item_id, column_id)` unchanged. The Table view buckets items into top-level + `childrenByParent`, virtualizes **top-level rows with dynamic height measurement**, and renders an expanded parent's subitems as a **normal-flow, dnd-sortable sub-block** (so drag composes cleanly with virtualization). A collapsed parent's cells render a read-only **rollup** computed client-side from already-loaded child cells. Other views are untouched (subitems appear flat). A `BEFORE` trigger enforces the single-level invariant.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), React 19, TypeScript strict, Supabase (Postgres + RLS + Realtime), TanStack Query + `@tanstack/react-virtual`, `@dnd-kit/*`, Zod, Vitest, Playwright.

> **Architecture note vs spec:** The spec §5 sketched a single flattened `VisibleRow[]` virtualization; this plan instead uses the spec's own _recommended_ alternative (§5 "Subitem drag-reorder" + §10): virtualize top-level rows (dynamic height) and render subitems as a non-virtualized sub-block. Consequently we build **`bucketItems`** (top-level + children map) rather than `flattenVisibleRows`. Same observable behavior; clean dnd.

## Global Constraints

- **Branch:** work on `develop` only — never create per-feature branches, never `git checkout`/`stash`-switch in this shared checkout (a concurrent session may be editing `boards/`). See `develop-red-concurrent-work` memory.
- **Next.js 16, not training data** — confirm any framework API against `node_modules/next/dist/docs/` before using it.
- **Server Components by default; Server Actions for all mutations.** Client components only when interactive.
- **Validate at boundaries with Zod.** TS strict; no unjustified `any`.
- **RLS is the security boundary** — default-deny, org-scoped. Server Actions derive `org_id`/`board_id`/`group_id` from the resolved parent/item server-side; never trust client scope. `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- **Schema changes are versioned migrations** in `supabase/migrations/`. After applying: `pnpm db:types` → commit `src/types/database.types.ts` (expect a no-op here — no table/column added — but run it); run advisors.
- **In-page state (expand/collapse) is client state — 0 server round-trips.** Mutations (add/rename/set-cell/delete/reorder) use Server Actions + optimistic cache patch + Realtime; never RSC navigation.
- **Commits:** small, conventional, **lowercase subject** (commitlint rejects sentence/Start-case subjects). End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- **Gate before "done":** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green; advisors clean.
- Cell-value shapes (verbatim): `text {text}`, `status {optionId|null}`, `dropdown {optionIds:[]}`, `people {userIds:[]}`, `date {date, end?}` (ISO `YYYY-MM-DD`), `numbers {n}`. Status/dropdown column `settings.options: {id,label,color}[]`.

---

## File Structure

**Create:**

- `supabase/migrations/20260619140000_subitems.sql` — `items.parent_id` index + single-level guard trigger.
- `src/lib/boards/subitems.integration.test.ts` — DB trigger + cascade + RLS (skipIf no service role).
- `src/lib/boards/item-tree.ts` — pure `bucketItems(items)` → `{ topLevel, childrenByParent }`.
- `src/lib/boards/item-tree.test.ts`
- `src/lib/boards/rollup.ts` — pure `rollupCell(kind, values, options)` → `RollupResult`.
- `src/lib/boards/rollup.test.ts`
- `src/components/boards/RollupCell.tsx` — read-only rollup renderer.
- `src/components/boards/RollupCell.test.tsx`
- `e2e/subitems.spec.ts` — end-to-end.

**Modify:**

- `src/lib/validations/board-actions.ts` — `addSubitemSchema`, `deleteItemSchema`, `reorderItemSchema`.
- `src/lib/validations/board-actions.test.ts` — schema tests (if file exists; else fold into actions test).
- `src/lib/boards/actions.ts` — `addSubitem`, `deleteItem`, `reorderItem`.
- `src/lib/boards/actions.test.ts` — validation-guard tests.
- `src/lib/boards/cache.ts` — `removeItem` helper.
- `src/lib/boards/cache.test.ts` — `removeItem` tests.
- `src/lib/boards/use-board-mutations.ts` — `addSubitem`/`deleteItem`/`reorderItem` mutations + exports.
- `src/components/boards/BoardTable.tsx` — bucketing, dynamic virtualization, nesting render, rollup, dnd.
- `src/components/boards/BoardTable.test.tsx` — nesting/rollup/add/delete/reorder tests.

---

## Execution waves & parallelization

Tasks are **not** a strict linear chain. The dependency graph (← = "depends on"):

```
Wave 1 (independent — 5 agents in parallel):
  Task 1  migration + integration test      (supabase/migrations + new test)
  Task 2  zod schemas                        (board-actions.ts)
  Task 3  removeItem cache helper            (cache.ts)
  Task 4  bucketItems helper                 (item-tree.ts — new)
  Task 5  rollupCell helper                  (rollup.ts — new)

Wave 2 (3 agents in parallel; each waits only on its Wave-1 dep):
  Task 6→7  actions ← Task 2, then mutations ← Task 6 + Task 3   (actions.ts → use-board-mutations.ts)
  Task 8    RollupCell component ← Task 5                          (RollupCell.tsx — new)
  Task 9    BoardTable refactor ← Task 4                           (BoardTable.tsx)

Wave 3:  Task 10  nesting       ← Task 7 + Task 9   (BoardTable.tsx)
Wave 4:  Task 11  rollup cells  ← Task 10 + 5 + 8   (BoardTable.tsx)
Wave 5:  Task 12  reorder       ← Task 10 + Task 7  (BoardTable.tsx)
Wave 6:  Task 13  e2e           ← Task 10 + 11 + 12
Wave 7:  Task 14  gate + docs   ← all
```

**Why the tail is sequential:** Tasks 9–12 all edit `BoardTable.tsx` (one file). They **cannot** be parallelized with each other — concurrent edits to the same file in this shared checkout would clobber. They run back-to-back. Task 6 and Task 7 are different files but tightly coupled (7 imports 6), so a **single agent should do Task 6 then Task 7** in sequence — that keeps Wave 2 a clean 3-way fan-out instead of adding a wave for Task 7.

**Recommended dispatch:**

- **Wave 1:** fan out 5 subagents (Tasks 1–5). Fully independent files.
- **Wave 2:** after Wave 1 lands, fan out 3 subagents — one doing Tasks 6+7, one Task 8, one Task 9.
- **Waves 3–7:** sequential single subagents (Tasks 10 → 11 → 12 → 13 → 14).

So the 14 tasks collapse to **7 waves** (~5× then ~3× parallelism up front).

**Shared-checkout safety (mandatory — see `gotcha-15` + `develop-red-concurrent-work` memory):**

- Parallel agents in the same wave must touch **disjoint files** (the waves above guarantee this) — never two agents in one file.
- Because this is **one checkout / one branch**, concurrent `git commit` (and the `lint-staged` pre-commit stash) will race. Choose one:
  - **(a) Worktree isolation (recommended):** dispatch each parallel agent with its own git worktree (`isolation: "worktree"`), so each has an isolated index; the orchestrator integrates results after the wave. Best when a real concurrent session may also be on `develop`.
  - **(b) Stage-only + serialized commit:** parallel agents write + run their own tests but do **not** commit; the orchestrator commits each task sequentially after the wave completes.
- **Task 1's cloud migration apply is a global side effect** — only that agent applies it, it needs explicit push authorization, and it is the only Wave-1 task that touches `src/types/database.types.ts` (regen), so no types-file race.
- A concurrent session currently has **3 unpushed dashboards commits** on `develop`; verify your own scope (`npx tsc --noEmit` + `npx eslint` on your files) before claiming green, and don't "fix" red files outside this plan's scope.

---

## Task 1: Migration — `parent_id` index + single-level guard trigger

> **Wave 1 · independent** (parallel with Tasks 2–5). Sole owner of the cloud-migration apply + `database.types.ts` regen.

**Files:**

- Create: `supabase/migrations/20260619140000_subitems.sql`
- Create (test): `src/lib/boards/subitems.integration.test.ts`

**Interfaces:**

- Produces: a DB that accepts `items` rows with `parent_id` referencing a top-level item on the same board, and rejects 2-level nesting / self-parent / cross-board parent / demoting-a-parent-with-children. Cascade delete of a parent removes its subitems + their cell values.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260619140000_subitems.sql`:

```sql
-- Phase 6a subitems. `items.parent_id` already exists (boards_core, reserved for
-- this). Add an index for child lookups + the single-level invariant guard.

create index if not exists items_parent_id_idx on public.items (parent_id);

-- Enforce single-level nesting: a subitem's parent must be a top-level item on
-- the same board; an item that already has subitems may not become a subitem.
-- Defense-in-depth — the Server Action also sets these fields correctly.
create or replace function public.tg_items_single_level()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_parent uuid;
  v_parent_board  uuid;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'An item cannot be its own parent';
    end if;

    select i.parent_id, i.board_id
      into v_parent_parent, v_parent_board
      from public.items i
     where i.id = new.parent_id;

    if not found then
      raise exception 'Parent item % not found', new.parent_id;
    end if;
    if v_parent_parent is not null then
      raise exception 'Subitems cannot be nested (single-level only)';
    end if;
    if v_parent_board <> new.board_id then
      raise exception 'Subitem must belong to the same board as its parent';
    end if;
    if exists (select 1 from public.items c where c.parent_id = new.id) then
      raise exception 'An item with subitems cannot become a subitem';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists items_single_level on public.items;
create trigger items_single_level
  before insert or update on public.items
  for each row execute function public.tg_items_single_level();
```

- [ ] **Step 2: Write the failing integration test**

Create `src/lib/boards/subitems.integration.test.ts` (mirrors `columns.rls.integration.test.ts` provisioning):

```ts
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type TestUser = {
  id: string;
  orgId: string;
  boardId: string;
  groupId: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!SERVICE_ROLE_KEY)(
  "subitems: single-level + cascade + RLS",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let userA: TestUser;
    let userB: TestUser;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `subitems-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      expect(error, `createUser(${label})`).toBeNull();
      const id = created.user!.id;
      createdUserIds.push(id);

      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await anon.auth.signInWithPassword({ email, password: PASSWORD });

      const { data: org } = await anon.rpc("create_organization", {
        p_name: `Org ${label}`,
        p_slug: `subitems-${label}-${randomUUID().slice(0, 8)}`,
      });
      const orgId = (org as { id: string }).id;

      const { data: ws } = await anon
        .from("workspaces")
        .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
        .select("id")
        .single();
      const workspaceId = (ws as { id: string }).id;

      const { data: board } = await anon.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: `Board ${label}`,
      });
      const boardId = (board as { id: string }).id;

      const { data: group } = await anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .limit(1)
        .single();
      const groupId = (group as { id: string }).id;

      return { id, orgId, boardId, groupId, anon };
    }

    async function insertItem(
      u: TestUser,
      name: string,
      parentId: string | null,
    ) {
      return u.anon
        .from("items")
        .insert({
          org_id: u.orgId,
          board_id: u.boardId,
          group_id: u.groupId,
          parent_id: parentId,
          name,
          position: 1,
        })
        .select("*")
        .maybeSingle();
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      userA = await provisionUser("A");
      userB = await provisionUser("B");
    });

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    });

    it("accepts a subitem under a top-level parent", async () => {
      const { data: parent } = await insertItem(userA, "Parent", null);
      const { data: sub, error } = await insertItem(userA, "Sub", parent!.id);
      expect(error).toBeNull();
      expect(sub!.parent_id).toBe(parent!.id);
    });

    it("rejects nesting a subitem under a subitem (2 levels)", async () => {
      const { data: parent } = await insertItem(userA, "P2", null);
      const { data: sub } = await insertItem(userA, "S2", parent!.id);
      const { error } = await insertItem(userA, "S2.1", sub!.id);
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/nested/i);
    });

    it("rejects self-parenting", async () => {
      const idA = randomUUID();
      const { error } = await userA.anon
        .from("items")
        .insert({
          id: idA,
          org_id: userA.orgId,
          board_id: userA.boardId,
          group_id: userA.groupId,
          parent_id: idA,
          name: "self",
          position: 1,
        })
        .select("*")
        .maybeSingle();
      expect(error).not.toBeNull();
    });

    it("cascade-deletes subitems and their cell values with the parent", async () => {
      const { data: parent } = await insertItem(userA, "P3", null);
      const { data: sub } = await insertItem(userA, "S3", parent!.id);
      await userA.anon.from("items").delete().eq("id", parent!.id);
      const { data: still } = await userA.anon
        .from("items")
        .select("id")
        .eq("id", sub!.id)
        .maybeSingle();
      expect(still).toBeNull();
    });

    it("does not let another org read a subitem (RLS)", async () => {
      const { data: parent } = await insertItem(userA, "P4", null);
      const { data: sub } = await insertItem(userA, "S4", parent!.id);
      const { data: leaked } = await userB.anon
        .from("items")
        .select("id")
        .eq("id", sub!.id)
        .maybeSingle();
      expect(leaked).toBeNull();
    });
  },
);
```

- [ ] **Step 3: Run the test to verify it fails (trigger not yet applied)**

Run: `pnpm test src/lib/boards/subitems.integration.test.ts`
Expected: the "rejects nesting" / "rejects self-parenting" cases FAIL (no error raised) — because the migration is not yet applied to the cloud DB. (If `SUPABASE_SERVICE_ROLE_KEY` is unset the suite is skipped — note this and apply the migration anyway.)

- [ ] **Step 4: Apply the migration to the cloud DB**

> Requires explicit per-session authorization to push (cloud-native repo, no local stack).

Run: `pnpm supabase db push --linked`
Expected: applies `20260619140000_subitems.sql`. Then regenerate types (no-op expected, still commit if changed):
Run: `pnpm db:types` (filter the stray PostHog `"_tag"` line if it appears, then prettier).

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `pnpm test src/lib/boards/subitems.integration.test.ts`
Expected: PASS (all 5 cases). Then run advisors via the Supabase MCP (`get_advisors`, type `security`) and confirm no new warning for `tg_items_single_level` (it pins `search_path`).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260619140000_subitems.sql src/lib/boards/subitems.integration.test.ts src/types/database.types.ts
git commit -m "feat(boards): subitems single-level guard trigger + parent_id index"
```

---

## Task 2: Zod schemas for subitem actions

> **Wave 1 · independent** (parallel with Tasks 1, 3–5).

**Files:**

- Modify: `src/lib/validations/board-actions.ts`
- Test: `src/lib/validations/board-actions.test.ts` (create if absent)

**Interfaces:**

- Produces: `addSubitemSchema` (`{parentId: uuid, name: string 1..255}`), `deleteItemSchema` (`{itemId: uuid}`), `reorderItemSchema` (`{itemId: uuid, position: number}`).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/validations/board-actions.test.ts` (create the file with this content if it doesn't exist):

```ts
import { describe, expect, it } from "vitest";
import {
  addSubitemSchema,
  deleteItemSchema,
  reorderItemSchema,
} from "./board-actions";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("addSubitemSchema", () => {
  it("accepts a valid parentId + name", () => {
    expect(
      addSubitemSchema.safeParse({ parentId: UUID, name: "Sub" }).success,
    ).toBe(true);
  });
  it("rejects an empty name", () => {
    expect(
      addSubitemSchema.safeParse({ parentId: UUID, name: "  " }).success,
    ).toBe(false);
  });
  it("rejects a non-uuid parentId", () => {
    expect(
      addSubitemSchema.safeParse({ parentId: "x", name: "Sub" }).success,
    ).toBe(false);
  });
});

describe("deleteItemSchema", () => {
  it("accepts a uuid", () => {
    expect(deleteItemSchema.safeParse({ itemId: UUID }).success).toBe(true);
  });
});

describe("reorderItemSchema", () => {
  it("accepts a numeric position", () => {
    expect(
      reorderItemSchema.safeParse({ itemId: UUID, position: 2.5 }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/validations/board-actions.test.ts`
Expected: FAIL — `addSubitemSchema` is not exported.

- [ ] **Step 3: Add the schemas**

In `src/lib/validations/board-actions.ts`, after the existing `createItemSchema`/`renameItemSchema` lines (they already define the `itemName` and `uuid` locals):

```ts
export const addSubitemSchema = z.object({ parentId: uuid, name: itemName });
export const deleteItemSchema = z.object({ itemId: uuid });
export const reorderItemSchema = z.object({
  itemId: uuid,
  position: z.number(),
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/lib/validations/board-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/board-actions.ts src/lib/validations/board-actions.test.ts
git commit -m "feat(boards): zod schemas for addSubitem/deleteItem/reorderItem"
```

---

## Task 3: `removeItem` cache helper

> **Wave 1 · independent** (parallel with Tasks 1–2, 4–5).

**Files:**

- Modify: `src/lib/boards/cache.ts`
- Test: `src/lib/boards/cache.test.ts`

**Interfaces:**

- Consumes: `BoardCache`, `CacheItem` (existing).
- Produces: `removeItem(cache, itemId): BoardCache` — removes the item, any of its subitems (`parent_id === itemId`), and all their cell values. Immutable. Used by `deleteItem` mutation (Task 5).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/boards/cache.test.ts` (import `removeItem` in the existing import block):

```ts
describe("removeItem", () => {
  it("removes the item and its cell values", () => {
    const next = removeItem(baseCache(), "i1");
    expect(next.items.some((i) => i.id === "i1")).toBe(false);
    expect(next.cellValues.some((c) => c.item_id === "i1")).toBe(false);
    expect(next.items.some((i) => i.id === "i2")).toBe(true);
  });

  it("cascades to subitems of the removed parent", () => {
    const cache = baseCache();
    cache.items.push({
      id: "sub1",
      board_id: "b1",
      group_id: "g1",
      parent_id: "i1",
      name: "Sub",
    } as never);
    cache.cellValues.push({
      item_id: "sub1",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text: "x" },
    } as never);
    const next = removeItem(cache, "i1");
    expect(next.items.some((i) => i.id === "sub1")).toBe(false);
    expect(next.cellValues.some((c) => c.item_id === "sub1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/boards/cache.test.ts`
Expected: FAIL — `removeItem` is not exported.

- [ ] **Step 3: Implement `removeItem`**

In `src/lib/boards/cache.ts`, after `removeGroup` (around line 113):

```ts
/** Remove an item, its subitems, and all their cell values (mirrors the DB cascade). Immutable. */
export function removeItem(cache: BoardCache, itemId: string): BoardCache {
  const itemIds = new Set<string>([itemId]);
  for (const i of cache.items) if (i.parent_id === itemId) itemIds.add(i.id);
  return {
    ...cache,
    items: cache.items.filter((i) => !itemIds.has(i.id)),
    cellValues: cache.cellValues.filter((c) => !itemIds.has(c.item_id)),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/lib/boards/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/cache.ts src/lib/boards/cache.test.ts
git commit -m "feat(boards): removeItem cache helper (cascades subitems + cells)"
```

---

## Task 4: `bucketItems` pure helper (top-level + children map)

> **Wave 1 · independent** (parallel with Tasks 1–3, 5).

**Files:**

- Create: `src/lib/boards/item-tree.ts`
- Test: `src/lib/boards/item-tree.test.ts`

**Interfaces:**

- Consumes: `CacheItem` (from `cache.ts`).
- Produces: `bucketItems(items): { topLevel: CacheItem[]; childrenByParent: Map<string, CacheItem[]> }` — `topLevel` = `parent_id == null`, position-sorted; `childrenByParent` keyed by parent id, each list position-sorted. Used by `BoardTable` (Tasks 9–12).

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/item-tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bucketItems } from "./item-tree";
import type { CacheItem } from "./cache";

function item(id: string, parent: string | null, position: number): CacheItem {
  return {
    id,
    parent_id: parent,
    position,
    name: id,
    board_id: "b",
    group_id: "g",
    org_id: "o",
  } as never;
}

describe("bucketItems", () => {
  it("separates top-level from children and sorts each by position", () => {
    const { topLevel, childrenByParent } = bucketItems([
      item("a", null, 2),
      item("b", null, 1),
      item("a2", "a", 2),
      item("a1", "a", 1),
    ]);
    expect(topLevel.map((i) => i.id)).toEqual(["b", "a"]);
    expect(childrenByParent.get("a")!.map((i) => i.id)).toEqual(["a1", "a2"]);
  });

  it("returns an empty children map when there are no subitems", () => {
    const { childrenByParent } = bucketItems([item("a", null, 1)]);
    expect(childrenByParent.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/boards/item-tree.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `bucketItems`**

Create `src/lib/boards/item-tree.ts`:

```ts
import type { CacheItem } from "@/lib/boards/cache";

export type ItemTree = {
  topLevel: CacheItem[];
  childrenByParent: Map<string, CacheItem[]>;
};

/**
 * Split items into top-level (`parent_id == null`) and children grouped by
 * parent id. Each list is sorted by `position` (cache mutations don't preserve
 * order, so we sort here rather than relying on the server query). Pure.
 */
export function bucketItems(items: readonly CacheItem[]): ItemTree {
  const byPos = (a: CacheItem, b: CacheItem) => a.position - b.position;
  const topLevel: CacheItem[] = [];
  const childrenByParent = new Map<string, CacheItem[]>();
  for (const it of items) {
    if (it.parent_id == null) {
      topLevel.push(it);
    } else {
      const arr = childrenByParent.get(it.parent_id);
      if (arr) arr.push(it);
      else childrenByParent.set(it.parent_id, [it]);
    }
  }
  topLevel.sort(byPos);
  for (const arr of childrenByParent.values()) arr.sort(byPos);
  return { topLevel, childrenByParent };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/lib/boards/item-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/item-tree.ts src/lib/boards/item-tree.test.ts
git commit -m "feat(boards): bucketItems helper (top-level + children-by-parent)"
```

---

## Task 5: `rollupCell` pure helper

> **Wave 1 · independent** (parallel with Tasks 1–4).

**Files:**

- Create: `src/lib/boards/rollup.ts`
- Test: `src/lib/boards/rollup.test.ts`

**Interfaces:**

- Consumes: `ColumnKind`, `ColumnOption` (from `@/lib/validations/boards`).
- Produces:
  - `type RollupResult = {kind:"blank"} | {kind:"number"; total:number} | {kind:"distribution"; total:number; segments:{id:string;label:string;color:string;count:number}[]} | {kind:"dateSpan"; start:string; end:string} | {kind:"people"; count:number}`
  - `rollupCell(kind, values, options?): RollupResult` — `values` are raw child cell JSON values (nulls allowed). Used by `RollupCell` (Task 8) + `BoardTable` (Task 11).

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/rollup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rollupCell } from "./rollup";

describe("rollupCell", () => {
  it("returns blank when no values are present", () => {
    expect(rollupCell("numbers", [null, undefined]).kind).toBe("blank");
  });

  it("sums numbers", () => {
    const r = rollupCell("numbers", [{ n: 5 }, { n: 8 }, null]);
    expect(r).toEqual({ kind: "number", total: 13 });
  });

  it("builds a status distribution sorted by count, with option meta", () => {
    const options = [
      { id: "done", label: "Done", color: "#0f0" },
      { id: "wip", label: "WIP", color: "#ff0" },
    ];
    const r = rollupCell(
      "status",
      [
        { optionId: "done" },
        { optionId: "done" },
        { optionId: "wip" },
        { optionId: null },
      ],
      options,
    );
    expect(r.kind).toBe("distribution");
    if (r.kind === "distribution") {
      expect(r.total).toBe(3);
      expect(r.segments[0]).toEqual({
        id: "done",
        label: "Done",
        color: "#0f0",
        count: 2,
      });
    }
  });

  it("counts every dropdown selection", () => {
    const r = rollupCell(
      "dropdown",
      [{ optionIds: ["a", "b"] }, { optionIds: ["a"] }],
      [
        { id: "a", label: "A", color: "#111" },
        { id: "b", label: "B", color: "#222" },
      ],
    );
    expect(r.kind === "distribution" && r.total).toBe(3);
  });

  it("computes a date span across date + end", () => {
    const r = rollupCell("date", [
      { date: "2026-06-05" },
      { date: "2026-06-03", end: "2026-06-14" },
    ]);
    expect(r).toEqual({
      kind: "dateSpan",
      start: "2026-06-03",
      end: "2026-06-14",
    });
  });

  it("dedupes the people union count", () => {
    const r = rollupCell("people", [
      { userIds: ["u1", "u2"] },
      { userIds: ["u2", "u3"] },
    ]);
    expect(r).toEqual({ kind: "people", count: 3 });
  });

  it("is blank for text", () => {
    expect(rollupCell("text", [{ text: "hi" }]).kind).toBe("blank");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/boards/rollup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `rollupCell`**

Create `src/lib/boards/rollup.ts`:

```ts
import type { ColumnKind, ColumnOption } from "@/lib/validations/boards";

export type RollupResult =
  | { kind: "blank" }
  | { kind: "number"; total: number }
  | {
      kind: "distribution";
      total: number;
      segments: { id: string; label: string; color: string; count: number }[];
    }
  | { kind: "dateSpan"; start: string; end: string }
  | { kind: "people"; count: number };

type Options = readonly ColumnOption[] | undefined;

/**
 * Aggregate a parent's subitem cell values for one column into a renderable
 * rollup. `values` are raw JSON cell values across the subitems (nulls allowed
 * for empty cells). Pure — no DOM, no I/O.
 */
export function rollupCell(
  kind: ColumnKind,
  values: readonly unknown[],
  options?: Options,
): RollupResult {
  const present = values.filter((v) => v != null);
  if (present.length === 0) return { kind: "blank" };

  switch (kind) {
    case "numbers": {
      let total = 0;
      let any = false;
      for (const v of present) {
        const n = (v as { n?: unknown }).n;
        if (typeof n === "number" && Number.isFinite(n)) {
          total += n;
          any = true;
        }
      }
      return any ? { kind: "number", total } : { kind: "blank" };
    }
    case "status": {
      const counts = new Map<string, number>();
      for (const v of present) {
        const id = (v as { optionId?: string | null }).optionId;
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return distribution(counts, options);
    }
    case "dropdown": {
      const counts = new Map<string, number>();
      for (const v of present) {
        for (const id of (v as { optionIds?: string[] }).optionIds ?? []) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      return distribution(counts, options);
    }
    case "date": {
      let min: string | null = null;
      let max: string | null = null;
      for (const v of present) {
        const d = (v as { date?: string }).date;
        const e = (v as { end?: string }).end ?? d;
        if (typeof d === "string" && (min === null || d < min)) min = d;
        if (typeof e === "string" && (max === null || e > max)) max = e;
      }
      return min && max
        ? { kind: "dateSpan", start: min, end: max }
        : { kind: "blank" };
    }
    case "people": {
      const ids = new Set<string>();
      for (const v of present) {
        for (const id of (v as { userIds?: string[] }).userIds ?? [])
          ids.add(id);
      }
      return ids.size > 0
        ? { kind: "people", count: ids.size }
        : { kind: "blank" };
    }
    case "text":
      return { kind: "blank" };
  }
}

function distribution(
  counts: Map<string, number>,
  options: Options,
): RollupResult {
  if (counts.size === 0) return { kind: "blank" };
  let total = 0;
  const segments: {
    id: string;
    label: string;
    color: string;
    count: number;
  }[] = [];
  for (const [id, count] of counts) {
    total += count;
    const opt = options?.find((o) => o.id === id);
    segments.push({
      id,
      count,
      label: opt?.label ?? "—",
      color: opt?.color ?? "#9ca3af",
    });
  }
  segments.sort((a, b) => b.count - a.count); // most frequent first
  return { kind: "distribution", total, segments };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/lib/boards/rollup.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/rollup.ts src/lib/boards/rollup.test.ts
git commit -m "feat(boards): rollupCell helper (sum/distribution/span/people)"
```

---

## Task 6: Server actions — `addSubitem`, `deleteItem`, `reorderItem`

> **Wave 2 · depends on Task 2.** Parallel with Tasks 8 + 9. **Same agent should continue straight into Task 7** (different file, but 7 imports 6).

**Files:**

- Modify: `src/lib/boards/actions.ts`
- Test: `src/lib/boards/actions.test.ts`

**Interfaces:**

- Consumes: `addSubitemSchema`, `deleteItemSchema`, `reorderItemSchema` (Task 2); `midpoint` (existing); `ActionResult`/`fail` (existing).
- Produces:
  - `addSubitem({parentId, name}): Promise<ActionResult<{item: Tables<"items">}>>`
  - `deleteItem({itemId}): Promise<ActionResult>`
  - `reorderItem({itemId, position}): Promise<ActionResult>`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/boards/actions.test.ts` (match the existing validation-guard test style — these assert the Zod guard rejects bad input before any DB call):

```ts
import { addSubitem, deleteItem, reorderItem } from "./actions";

describe("addSubitem", () => {
  it("rejects an empty name", async () => {
    const res = await addSubitem({
      parentId: "11111111-1111-1111-1111-111111111111",
      name: " ",
    });
    expect(res.ok).toBe(false);
  });
  it("rejects a non-uuid parentId", async () => {
    const res = await addSubitem({ parentId: "nope", name: "Sub" });
    expect(res.ok).toBe(false);
  });
});

describe("deleteItem", () => {
  it("rejects a non-uuid itemId", async () => {
    const res = await deleteItem({ itemId: "nope" });
    expect(res.ok).toBe(false);
  });
});

describe("reorderItem", () => {
  it("rejects a non-uuid itemId", async () => {
    const res = await reorderItem({ itemId: "nope", position: 1 });
    expect(res.ok).toBe(false);
  });
});
```

> Note: behavioral (DB) coverage for these actions is provided by the Task 1 integration test (insert path) and the Task 13 e2e. These unit tests cover the Zod boundary.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/boards/actions.test.ts`
Expected: FAIL — `addSubitem` not exported.

- [ ] **Step 3: Implement the actions**

In `src/lib/boards/actions.ts`: add the three new schema names to the import from `@/lib/validations/board-actions` (`addSubitemSchema, deleteItemSchema, reorderItemSchema`). Then add, after `renameItem` (around line 297):

```ts
/** Create a subitem under a top-level parent. Derives org/board/group from the
 *  parent (RLS-scoped); the DB trigger enforces the single-level invariant. */
export async function addSubitem(input: {
  parentId: string;
  name: string;
}): Promise<ActionResult<{ item: Tables<"items"> }>> {
  const parsed = addSubitemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  const { data: parent, error: parentErr } = await supabase
    .from("items")
    .select("org_id, board_id, group_id, parent_id")
    .eq("id", parsed.data.parentId)
    .maybeSingle();
  if (parentErr || !parent) return fail("Parent item not found.");
  if (parent.parent_id !== null) return fail("Subitems cannot be nested.");

  const { data: last } = await supabase
    .from("items")
    .select("position")
    .eq("parent_id", parsed.data.parentId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("items")
    .insert({
      org_id: parent.org_id,
      board_id: parent.board_id,
      group_id: parent.group_id,
      parent_id: parsed.data.parentId,
      name: parsed.data.name,
      position: midpoint(last?.position ?? null, null),
    })
    .select("*")
    .single();
  if (error || !data)
    return fail(error?.message ?? "Could not create subitem.");

  revalidatePath(`/boards/${parent.board_id}`);
  return { ok: true, data: { item: data } };
}

/** Delete an item (or subitem). Subitems + cell values cascade via FKs. */
export async function deleteItem(input: {
  itemId: string;
}): Promise<ActionResult> {
  const parsed = deleteItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .delete()
    .eq("id", parsed.data.itemId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Item not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

/** Update an item's position (subitem reorder within a parent). */
export async function reorderItem(input: {
  itemId: string;
  position: number;
}): Promise<ActionResult> {
  const parsed = reorderItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.itemId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Item not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/lib/boards/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/actions.ts src/lib/boards/actions.test.ts
git commit -m "feat(boards): addSubitem/deleteItem/reorderItem server actions"
```

---

## Task 7: Mutations — wire `addSubitem`, `deleteItem`, `reorderItem`

> **Wave 2 (run by the Task 6 agent, immediately after Task 6) · depends on Task 6 + Task 3.** Different file from 8/9, so still parallel with them.

**Files:**

- Modify: `src/lib/boards/use-board-mutations.ts`

**Interfaces:**

- Consumes: `addSubitem`/`deleteItem`/`reorderItem` actions (Task 6); `insertItem`/`removeItem`/`replaceItem` cache helpers (Task 3 + existing).
- Produces (added to the object returned by `useBoardMutations`):
  - `addSubitem(parentId: string, name: string, callbacks?: { onSuccess?: (item: CacheItem) => void; onError?: (err: Error) => void }): void`
  - `deleteItem(itemId: string): void`
  - `reorderItem(itemId: string, position: number): void`

- [ ] **Step 1: Add the action imports**

In the `from "@/lib/boards/actions"` import block, add `addSubitem`, `deleteItem`, `reorderItem`. In the `from "@/lib/boards/cache"` import block, add `removeItem`.

- [ ] **Step 2: Add the mutations**

Inside `useBoardMutations`, after `addItemMutation` (around line 258), add:

```ts
/** Add a subitem. Patch-on-success (mirrors addItem); Realtime echo idempotent. */
const addSubitemMutation = useMutation<
  { item: CacheItem },
  Error,
  { parentId: string; name: string },
  void
>({
  mutationFn: async (vars) => {
    const res = await addSubitem(vars);
    if (!res.ok) throw new Error(res.error);
    return { item: res.data.item as CacheItem };
  },
  onSuccess: ({ item }) => {
    qc.setQueryData<BoardCache>(key, (prev) =>
      prev ? insertItem(prev, item) : prev,
    );
  },
});

/** Delete an item/subitem. Optimistic remove (cascades subitems in cache); rollback on error. */
const deleteItemMutation = useMutation<unknown, Error, { itemId: string }, Ctx>(
  {
    mutationFn: async (vars) => {
      const res = await deleteItem(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous)
        qc.setQueryData<BoardCache>(key, removeItem(previous, vars.itemId));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  },
);

/** Reorder an item (subitem within its parent). Optimistic position patch; rollback on error. */
const reorderItemMutation = useMutation<
  unknown,
  Error,
  { itemId: string; position: number },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await reorderItem(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<BoardCache>(key);
    if (previous) {
      const existing = previous.items.find((i) => i.id === vars.itemId);
      if (existing) {
        qc.setQueryData<BoardCache>(
          key,
          replaceItem(previous, { ...existing, position: vars.position }),
        );
      }
    }
    return { previous };
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});
```

- [ ] **Step 3: Export them from the returned object**

In the `return { ... }` (after the `addItem` entry, around line 510), add:

```ts
    addSubitem: (
      parentId: string,
      name: string,
      callbacks?: {
        onSuccess?: (item: CacheItem) => void;
        onError?: (err: Error) => void;
      },
    ) =>
      addSubitemMutation.mutate(
        { parentId, name },
        {
          onSuccess: (data) => callbacks?.onSuccess?.(data.item),
          onError: (err) => callbacks?.onError?.(err),
        },
      ),
    deleteItem: (itemId: string) => deleteItemMutation.mutate({ itemId }),
    reorderItem: (itemId: string, position: number) =>
      reorderItemMutation.mutate({ itemId, position }),
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS (no test for the hook itself — it's consumed/verified by Tasks 9–12 component tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/use-board-mutations.ts
git commit -m "feat(boards): addSubitem/deleteItem/reorderItem mutations"
```

---

## Task 8: `RollupCell` read-only renderer

> **Wave 2 · depends on Task 5.** Parallel with Tasks 6/7 + 9 (new file, disjoint).

**Files:**

- Create: `src/components/boards/RollupCell.tsx`
- Test: `src/components/boards/RollupCell.test.tsx`

**Interfaces:**

- Consumes: `RollupResult` (Task 5).
- Produces: `<RollupCell result={RollupResult} />` — read-only summary span (blank / `Σ N` / `N people` / date span / distribution bar with `role="img"` + aria-label).

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/RollupCell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RollupCell } from "./RollupCell";

describe("RollupCell", () => {
  it("renders a number sum", () => {
    render(<RollupCell result={{ kind: "number", total: 21 }} />);
    expect(screen.getByText(/Σ\s*21/)).toBeInTheDocument();
  });

  it("renders a people count", () => {
    render(<RollupCell result={{ kind: "people", count: 1 }} />);
    expect(screen.getByText("1 person")).toBeInTheDocument();
  });

  it("renders a distribution bar with an aria summary", () => {
    render(
      <RollupCell
        result={{
          kind: "distribution",
          total: 3,
          segments: [{ id: "d", label: "Done", color: "#0f0", count: 2 }],
        }}
      />,
    );
    expect(screen.getByRole("img", { name: /Done: 2/ })).toBeInTheDocument();
  });

  it("renders nothing meaningful when blank", () => {
    const { container } = render(<RollupCell result={{ kind: "blank" }} />);
    expect(container.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/components/boards/RollupCell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `RollupCell`**

Create `src/components/boards/RollupCell.tsx`:

```tsx
import type { RollupResult } from "@/lib/boards/rollup";

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Read-only rollup summary shown on a collapsed parent's cells. */
export function RollupCell({ result }: { result: RollupResult }) {
  switch (result.kind) {
    case "blank":
      return <span className="text-sm" />;
    case "number":
      return (
        <span className="text-muted-foreground text-sm tabular-nums">
          Σ {result.total}
        </span>
      );
    case "people":
      return (
        <span className="text-muted-foreground text-sm">
          {result.count} {result.count === 1 ? "person" : "people"}
        </span>
      );
    case "dateSpan":
      return (
        <span className="text-muted-foreground text-sm">
          {fmt(result.start)}
          {result.end !== result.start ? ` – ${fmt(result.end)}` : ""}
        </span>
      );
    case "distribution":
      return (
        <span
          role="img"
          aria-label={result.segments
            .map((s) => `${s.label}: ${s.count}`)
            .join(", ")}
          className="flex h-2 w-full max-w-[120px] items-center overflow-hidden rounded-full"
        >
          {result.segments.map((s) => (
            <span
              key={s.id}
              title={`${s.label}: ${s.count}`}
              className="h-full"
              style={{
                width: `${(s.count / result.total) * 100}%`,
                backgroundColor: s.color,
              }}
            />
          ))}
        </span>
      );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/components/boards/RollupCell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/RollupCell.tsx src/components/boards/RollupCell.test.tsx
git commit -m "feat(boards): RollupCell read-only summary renderer"
```

---

## Task 9: BoardTable — bucket items + dynamic-height virtualization (refactor, behavior-preserving)

> **Wave 2 · depends on Task 4.** Parallel with Tasks 6/7 + 8. **First and only Wave-2 task in `BoardTable.tsx`** — it opens the serial BoardTable chain (Tasks 9 → 10 → 11 → 12), so no other agent may touch `BoardTable.tsx` while this runs.

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`
- Test: `src/components/boards/BoardTable.test.tsx`

**Interfaces:**

- Consumes: `bucketItems` (Task 4).
- Produces: `GroupSection` virtualizes the group's **top-level items** with dynamic measurement. With no subitems present, rendering is unchanged. `childrenByParent` is threaded into `GroupSection` (unused until Task 10).

> This is a pure refactor: switch the per-group data from `Item[]` to top-level items, and the virtualizer from fixed-size to measured. Existing BoardTable tests must still pass.

- [ ] **Step 1: Bucket items in `BoardTable`**

In `BoardTable` (around lines 149–161), add the import `import { bucketItems } from "@/lib/boards/item-tree";` and replace the `itemsByGroup` memo with:

```ts
const { topLevel, childrenByParent } = useMemo(
  () => bucketItems(items),
  [items],
);

// Top-level items grouped by group_id, in position order.
const itemsByGroup = useMemo(() => {
  const byGroup = new Map<string, typeof topLevel>();
  for (const g of groups) byGroup.set(g.id, []);
  for (const it of topLevel) {
    const bucket = byGroup.get(it.group_id);
    if (bucket) bucket.push(it);
    else byGroup.set(it.group_id, [it]);
  }
  return byGroup;
}, [groups, topLevel]);
```

- [ ] **Step 2: Pass `childrenByParent` to each `GroupSection`**

In the `groups.map((group) => (<GroupSection ... />))` (around line 278), add the prop:

```tsx
childrenByParent = { childrenByParent };
```

Add it to `GroupSection`'s props type and destructure (it's consumed in Task 10): `childrenByParent: Map<string, Item[]>;`.

- [ ] **Step 3: Switch the virtualizer to dynamic measurement**

In `GroupSection` (around lines 495–504), update the virtualizer + viewport:

```ts
// eslint-disable-next-line react-hooks/incompatible-library
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => ROW_HEIGHT,
  overscan: 6,
  measureElement: (el) => el.getBoundingClientRect().height,
});

const virtualRows = virtualizer.getVirtualItems();
// Cap the scroll viewport; long/expanded groups scroll inside it.
const viewportHeight =
  Math.min(virtualizer.getTotalSize(), 12 * ROW_HEIGHT) || ROW_HEIGHT;
```

(`items` here is already the group's top-level items — `GroupSection`'s existing `items` prop now receives `itemsByGroup.get(group.id)`.)

- [ ] **Step 4: Make each virtual row a measured element**

In the `virtualRows.map((vr) => { ... })` block (around lines 611–636), change the outer row `<div>` to be measured and hold only the parent grid row for now (the inner grid markup stays the same; we just add the ref + `data-index` and stop hard-coding `height`):

```tsx
{
  virtualRows.map((vr) => {
    const item = items[vr.index];
    return (
      <div
        key={item.id}
        data-index={vr.index}
        ref={virtualizer.measureElement}
        className="absolute top-0 left-0 w-full"
        style={{ transform: `translateY(${vr.start}px)` }}
      >
        <div
          className="hover:bg-surface grid w-full border-b transition-colors"
          style={{ height: ROW_HEIGHT, gridTemplateColumns: template }}
        >
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
          <div aria-hidden />
        </div>
      </div>
    );
  });
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test src/components/boards/BoardTable.test.tsx && pnpm typecheck`
Expected: PASS — existing tests still green (no behavior change when there are no subitems).

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "refactor(boards): bucket items + dynamic-height virtualization in table"
```

---

## Task 10: BoardTable — nesting (chevron, subitem sub-block, add-subitem, delete menu)

> **Wave 3 · serial · depends on Task 7 + Task 9.** Edits `BoardTable.tsx` — must run after Task 9 lands; not parallel with 11/12.

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`
- Test: `src/components/boards/BoardTable.test.tsx`

**Interfaces:**

- Consumes: `childrenByParent` (Task 9), `addSubitem`/`deleteItem` mutations (Task 7).
- Produces: parent rows with children show an expand chevron + `(N)` count; expanded parents render an indented subitem sub-block (editable subitem cells) + a trailing "+ Add subitem" row; items without children get a hover "+ subitem" button; every item/subitem has a `⋯` → Delete menu. Expand state is client-only.

- [ ] **Step 1: Add expand state + subitem mutations to controls**

In `BoardTable`: add `const [expanded, setExpanded] = useState<Set<string>>(() => new Set());` and a toggler `const toggleExpand = (id: string) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });`. Add a `renamingItemId` state: `const [renamingItemId, setRenamingItemId] = useState<string | null>(null);`.

Destructure the new mutations: `addSubitem, deleteItem, reorderItem` from `mutations`.

Extend `CellControls` (around line 73) with:

```ts
  addSubitem: (
    parentId: string,
    name: string,
    callbacks?: { onSuccess?: (id: string) => void; onError?: (err: Error) => void },
  ) => void;
  deleteItem: (itemId: string) => void;
```

And set them in the `controls` object (around line 194):

```ts
    addSubitem: (parentId, name, cbs) =>
      addSubitem(parentId, name, {
        onSuccess: (item) => cbs?.onSuccess?.(item.id),
        onError: cbs?.onError,
      }),
    deleteItem,
```

Pass `childrenByParent`, `expanded`, `toggleExpand`, `renamingItemId`, `setRenamingItemId` into each `GroupSection`.

- [ ] **Step 2: Add the row `⋯` menu + a parent NameCell variant**

Add a `RowMenu` component (delete with confirm for parents-with-children):

```tsx
function RowMenu({
  label,
  hasChildren,
  onDelete,
}: {
  label: string;
  hasChildren: boolean;
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
            aria-label={`${label} menu`}
            className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => (hasChildren ? setConfirming(true) : onDelete())}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the item and all of its subitems. This
              can’t be undone.
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

Extend the existing `NameCell` to accept optional `leading?: React.ReactNode` (chevron or indent spacer), `trailing?: React.ReactNode` (add-subitem button + row menu), `indented?: boolean`, and `autoFocusRename?: boolean` / `onRenameSettled?: () => void`. Render `leading` before the name text (with `pl-8` when `indented`), and `trailing` in the hover-action area next to the existing `Maximize2` button. When `autoFocusRename` is true, open the rename input on mount and call `onRenameSettled` after commit/cancel (mirror `GroupSection`'s rename wiring).

- [ ] **Step 3: Render the parent row + subitem sub-block**

Replace the inner grid markup added in Task 9 Step 4 with a call to a new `ItemRow` for the parent, and append the subitem sub-block when expanded. Inside `virtualRows.map`:

```tsx
const item = items[vr.index];
const children = childrenByParent.get(item.id) ?? [];
const isExpanded = expanded.has(item.id);
return (
  <div
    key={item.id}
    data-index={vr.index}
    ref={virtualizer.measureElement}
    className="absolute top-0 left-0 w-full"
    style={{ transform: `translateY(${vr.start}px)` }}
  >
    <ItemRow
      item={item}
      columns={columns}
      cellMap={cellMap}
      template={template}
      controls={controls}
      childCount={children.length}
      isExpanded={isExpanded}
      onToggle={() => onToggleExpand(item.id)}
      autoFocusRename={item.id === renamingItemId}
      onRenameSettled={() => onRenameSettled()}
    />
    {isExpanded && children.length > 0 && (
      <SubitemBlock
        parentId={item.id}
        subitems={children}
        columns={columns}
        cellMap={cellMap}
        template={template}
        controls={controls}
        renamingItemId={renamingItemId}
        onRenameSettled={onRenameSettled}
        onAdded={(id) => {
          setRenamingItemIdRef(id); // see note
        }}
      />
    )}
  </div>
);
```

> Thread `onToggleExpand`, `renamingItemId`, `onRenameSettled`, and a `setRenamingItemId` callback through `GroupSection` props. `ItemRow` renders the grid row (Task 9 markup) but its `NameCell` gets `leading` = a chevron button (when `childCount > 0`, calling `onToggle`; otherwise a spacer) plus a `(N)` count, and `trailing` = an "add subitem" button and `<RowMenu .../>`. **Pin these aria-labels (the tests + e2e depend on them):**
>
> - chevron button: `aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.name}`}` and `aria-expanded={isExpanded}` (use `ChevronRight`/`ChevronDown`, already imported).
> - add-subitem hover button (childless parents): `aria-label={`Add subitem to ${item.name}`}`; on click `controls.addSubitem(item.id, "New subitem", { onSuccess: (id) => { /* expand parent */ onToggle(); setRenamingItemId(id); } })`.
> - row menu trigger: `aria-label={`${item.name} menu`}` (already in `RowMenu`); Delete → `controls.deleteItem(item.id)`.

Define `SubitemBlock` (normal flow, dnd added in Task 12):

```tsx
function SubitemBlock({
  parentId,
  subitems,
  columns,
  cellMap,
  template,
  controls,
  renamingItemId,
  onRenameSettled,
  onAdded,
}: {
  parentId: string;
  subitems: Item[];
  columns: Column[];
  cellMap: Map<string, CacheCellValue["value"]>;
  template: string;
  controls: CellControls;
  renamingItemId: string | null;
  onRenameSettled: () => void;
  onAdded: (id: string) => void;
}) {
  return (
    <div>
      {subitems.map((sub) => (
        <div
          key={sub.id}
          className="hover:bg-surface grid w-full border-b transition-colors"
          style={{ height: ROW_HEIGHT, gridTemplateColumns: template }}
        >
          <NameCell
            item={sub}
            controls={controls}
            indented
            autoFocusRename={sub.id === renamingItemId}
            onRenameSettled={onRenameSettled}
            trailing={
              <RowMenu
                label={sub.name}
                hasChildren={false}
                onDelete={() => controls.deleteItem(sub.id)}
              />
            }
          />
          {columns.map((col) => (
            <EditableCell
              key={col.id}
              item={sub}
              column={col}
              value={cellMap.get(cellKey(sub.id, col.id)) ?? null}
              controls={controls}
            />
          ))}
          <div aria-hidden />
        </div>
      ))}
      <AddSubitemRow
        parentId={parentId}
        controls={controls}
        nameWidth={Number.parseInt(template) || 240}
        onAdded={onAdded}
      />
    </div>
  );
}
```

Define `AddSubitemRow` (mirror `AddItemRow`, but call `controls.addSubitem(parentId, trimmed, { onSuccess })` and indent):

```tsx
function AddSubitemRow({
  parentId,
  controls,
  onAdded,
}: {
  parentId: string;
  controls: CellControls;
  nameWidth: number;
  onAdded: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(() =>
      controls.addSubitem(parentId, trimmed, {
        onSuccess: (id) => {
          setName("");
          onAdded(id);
        },
      }),
    );
  }
  return (
    <div className="bg-surface sticky left-0 flex items-center gap-2 border-b py-1.5 pr-4 pl-12">
      <Plus className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        disabled={isPending}
        placeholder="Add subitem"
        aria-label="Add subitem"
        className="text-foreground placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none disabled:opacity-50"
      />
    </div>
  );
}
```

> The "add subitem" success path should also ensure the parent is expanded. Since the trailing button on a childless parent calls `controls.addSubitem` then expands + sets `renamingItemId`, and `AddSubitemRow` is only shown under an already-expanded parent, both paths converge on `setRenamingItemId(id)`.

- [ ] **Step 4: Write the component tests**

The harness mocks `@/lib/boards/actions` and asserts the action was called (mutations call the real action, which is mocked). **Extend the existing `vi.mock("@/lib/boards/actions", …)` factory** (top of `BoardTable.test.tsx`) to also export the three new actions, declare their `vi.fn()`s alongside the existing ones, and reset them in `beforeEach`:

```tsx
const addSubitem = vi.fn();
const deleteItem = vi.fn();
const reorderItem = vi.fn();
// inside the vi.mock factory object, add:
//   addSubitem: (...a: unknown[]) => addSubitem(...a),
//   deleteItem: (...a: unknown[]) => deleteItem(...a),
//   reorderItem: (...a: unknown[]) => reorderItem(...a),
// and in beforeEach: addSubitem.mockReset(); deleteItem.mockReset(); reorderItem.mockReset();
```

Add a nested-payload factory + tests:

```tsx
function nestedPayload() {
  return {
    board: { id: "b1", org_id: "o1", name: "Board", name_column_width: null },
    groups: [
      {
        id: "g1",
        board_id: "b1",
        org_id: "o1",
        name: "Group 1",
        color: "#0073ea",
        position: 0,
      },
    ],
    columns: [],
    items: [
      {
        id: "p1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Epic",
        position: 0,
      },
      {
        id: "s1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: "p1",
        name: "Design",
        position: 1,
      },
      {
        id: "s2",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: "p1",
        name: "Build",
        position: 2,
      },
    ],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderNested() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={nestedPayload()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

describe("BoardTable subitems", () => {
  it("hides subitems until the parent is expanded", () => {
    renderNested();
    expect(screen.queryByText("Design")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
  });

  it("shows an Add subitem input under an expanded parent", () => {
    renderNested();
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));
    expect(screen.getByLabelText("Add subitem")).toBeInTheDocument();
  });

  it("deletes a subitem from its row menu", async () => {
    deleteItem.mockResolvedValue({ ok: true, data: undefined });
    renderNested();
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));
    fireEvent.click(screen.getByLabelText("Design menu"));
    fireEvent.click(screen.getByText("Delete")); // subitem: no confirm dialog
    await waitFor(() =>
      expect(deleteItem).toHaveBeenCalledWith({ itemId: "s1" }),
    );
  });
});
```

Expected after Task 10 code: PASS.

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `pnpm test src/components/boards/BoardTable.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "feat(boards): nested subitems in table (expand, add, delete)"
```

---

## Task 11: BoardTable — collapsed-parent rollup cells

> **Wave 4 · serial · depends on Task 10 + Task 5 + Task 8.** Edits `BoardTable.tsx`.

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`
- Test: `src/components/boards/BoardTable.test.tsx`

**Interfaces:**

- Consumes: `rollupCell` (Task 5), `RollupCell` (Task 8), `childrenByParent` (Task 9).
- Produces: a parent that **has children and is collapsed** renders read-only `RollupCell`s in its value cells instead of its own editable cells. Expanded (or childless) parents render their own editable cells.

- [ ] **Step 1: Compute + render rollups in `ItemRow`**

In `ItemRow`, when `childCount > 0 && !isExpanded`, render each column's cell as a rollup instead of an `EditableCell`. Add imports `import { rollupCell } from "@/lib/boards/rollup";` and `import { RollupCell } from "@/components/boards/RollupCell";`. `ItemRow` must receive `childrenByParent` (or the parent's `children` array) to gather child values.

For each column, when collapsed-with-children:

```tsx
{
  columns.map((col) => {
    if (childCount > 0 && !isExpanded) {
      const values = children.map(
        (c) => cellMap.get(cellKey(c.id, col.id)) ?? null,
      );
      const settings = (col.settings ?? {}) as Settings;
      const result = rollupCell(col.kind, values, settings.options);
      return (
        <div
          key={col.id}
          className="flex h-full items-center truncate border-l px-3"
        >
          <RollupCell result={result} />
        </div>
      );
    }
    return (
      <EditableCell
        key={col.id}
        item={item}
        column={col}
        value={cellMap.get(cellKey(item.id, col.id)) ?? null}
        controls={controls}
      />
    );
  });
}
```

> Pass the parent's `children` array into `ItemRow` (it's already computed in `virtualRows.map`). `Settings` is the existing local type (`{ options?: ColumnOption[] }`).

- [ ] **Step 2: Write the test**

Add to `src/components/boards/BoardTable.test.tsx` (a payload with a numbers column + per-subitem values; parent starts collapsed):

```tsx
function rollupPayload() {
  return {
    board: { id: "b1", org_id: "o1", name: "Board", name_column_width: null },
    groups: [
      {
        id: "g1",
        board_id: "b1",
        org_id: "o1",
        name: "Group 1",
        color: "#0073ea",
        position: 0,
      },
    ],
    columns: [
      {
        id: "c1",
        board_id: "b1",
        org_id: "o1",
        kind: "numbers",
        name: "Est",
        settings: {},
        position: 0,
        width: null,
      },
    ],
    items: [
      {
        id: "p1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Epic",
        position: 0,
      },
      {
        id: "s1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: "p1",
        name: "Design",
        position: 1,
      },
      {
        id: "s2",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: "p1",
        name: "Build",
        position: 2,
      },
    ],
    cellValues: [
      {
        item_id: "s1",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { n: 5 },
      },
      {
        item_id: "s2",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { n: 8 },
      },
    ],
    dependencies: [],
    views: [],
  } as never;
}

describe("BoardTable rollup", () => {
  it("shows a summed rollup on the collapsed parent and the children on expand", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardTable payload={rollupPayload()} selectedViewId="v1" />
      </QueryClientProvider>,
    );
    // Collapsed by default → parent row shows the rollup (Σ 13), subitems hidden.
    expect(screen.getByText(/Σ\s*13/)).toBeInTheDocument();
    expect(screen.queryByText("Design")).not.toBeInTheDocument();
    // Expand → children visible, rollup gone (parent shows its own cells).
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.queryByText(/Σ\s*13/)).not.toBeInTheDocument();
  });
});
```

Expected after Task 11 code: PASS.

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm test src/components/boards/BoardTable.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "feat(boards): rollup summary on collapsed parent rows"
```

---

## Task 12: BoardTable — subitem drag-reorder (within a parent)

> **Wave 5 · serial · depends on Task 10 + Task 7.** Edits `BoardTable.tsx`.

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`
- Test: `src/components/boards/BoardTable.test.tsx`

**Interfaces:**

- Consumes: `reorderItem` mutation (Task 7), `reorderPosition` (`@/lib/boards/group-reorder`).
- Produces: subitems within an expanded parent are drag-sortable (handle = `GripVertical`); drops onto a different parent / non-subitem are no-ops; the position is computed with `reorderPosition` over the parent's siblings.

> Subitems render in normal flow (Task 10), so dnd-kit composes cleanly with the virtualized parent rows — no transform-vs-absolute conflict. Each `SubitemBlock` gets its own `DndContext` + `SortableContext` over its subitem ids.

- [ ] **Step 1: Wrap `SubitemBlock`'s rows in a sortable context**

In `SubitemBlock`, add a nested `DndContext` (its own sensors + `restrictToVerticalAxis`) and `SortableContext` over `subitems.map((s) => s.id)`, and render each subitem via a new `SortableSubitemRow` that uses `useSortable({ id: sub.id })` with a `GripVertical` handle. Use **`CSS.Translate.toString(transform)`** only (per gotcha-20). On drag end:

```tsx
function handleSubitemDragEnd(e: DragEndEvent) {
  const { active, over } = e;
  if (!over || active.id === over.id) return;
  const position = reorderPosition(
    subitems.map((s) => ({ id: s.id, position: s.position })),
    String(active.id),
    String(over.id),
  );
  if (position !== null) controls.reorderItem(String(active.id), position);
}
```

Add `reorderItem` to `CellControls` and set it in the `controls` object: `reorderItem,`.

`SortableSubitemRow` mirrors the `SubitemBlock` row markup from Task 10, with:

```tsx
const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
  useSortable({ id: sub.id });
// <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}
//   className={cn("grid ...", isDragging && "relative z-10 shadow-lg")}>
//   <NameCell ... leading={<button {...attributes} {...listeners}><GripVertical/></button>} indented ... />
```

(Reuse the existing `sensors`/`PointerSensor` pattern from `BoardTable`; create a local `useSensors` inside `SubitemBlock`.)

- [ ] **Step 2: Write the test**

Add a reorder unit test for the pure position math (the dnd wiring is covered by e2e in Task 13):

```tsx
import { reorderPosition } from "@/lib/boards/group-reorder";
it("computes a subitem reorder position among siblings", () => {
  const siblings = [
    { id: "s1", position: 1 },
    { id: "s2", position: 2 },
    { id: "s3", position: 3 },
  ];
  // drop s3 above s1 → strictly less than 1
  expect(reorderPosition(siblings, "s3", "s1")!).toBeLessThan(1);
});
```

- [ ] **Step 3: Run tests + typecheck + lint**

Run: `pnpm test src/components/boards/BoardTable.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "feat(boards): drag-reorder subitems within a parent"
```

---

## Task 13: End-to-end test

> **Wave 6 · depends on Tasks 10 + 11 + 12** (the full UI).

**Files:**

- Create: `e2e/subitems.spec.ts`

**Interfaces:**

- Consumes: a running app + seeded board (follow the existing e2e auth/seed harness, e.g. `e2e/automations-webhook.spec.ts` for login + board navigation patterns).

- [ ] **Step 1: Write the e2e spec**

Create `e2e/subitems.spec.ts` covering the full flow (adapt selectors/login to the existing e2e helpers):

```ts
import { test, expect } from "@playwright/test";

test("create, nest, edit, reorder, rollup, and delete subitems", async ({
  page,
}) => {
  // 1. Log in + open a board's Table view (reuse existing helper).
  // 2. Create a top-level item "Epic".
  // 3. Hover its name → click "add subitem"; rename the new subitem to "Design".
  // 4. Add a second subitem "Build".
  // 5. Set a Numbers cell on each subitem (e.g. 5 and 8).
  // 6. Drag "Build" above "Design"; assert order changed.
  // 7. Collapse "Epic"; assert the parent row shows the rollup (e.g. "Σ 13").
  // 8. Expand; open "Design" row menu → Delete; assert it's gone.
});
```

Flesh out each step with concrete selectors/assertions matching the app's `aria-label`s introduced in Tasks 10–12 (`"<name> menu"`, `"Add subitem"`, expand/collapse `aria-expanded`).

- [ ] **Step 2: Run the e2e**

Run: `pnpm test:e2e e2e/subitems.spec.ts` (use the project's actual e2e command).
Expected: PASS against the live dev/cloud target.

- [ ] **Step 3: Commit**

```bash
git add e2e/subitems.spec.ts
git commit -m "test(boards): e2e subitems create/nest/reorder/rollup/delete"
```

---

## Task 14: Final verification gate + docs

> **Wave 7 · depends on all.**

**Files:**

- Modify: `vault/00-north-star.md` (Phase 6 status + "Now")
- (Optional) `vault/sessions/…` via `/wrapup`

- [ ] **Step 1: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. Also run the Supabase MCP `get_advisors` (security + performance) and confirm no new warnings.

- [ ] **Step 2: Update the north-star**

Mark Phase 6 as started, record Slice A (subitems) as done with the commit range, update the "Now" section to point at the next slice (B — custom fields/statuses). Bump `last-updated`.

- [ ] **Step 3: Commit**

```bash
git add vault/00-north-star.md
git commit -m "docs(vault): phase 6a subitems shipped; north-star bump"
```

- [ ] **Step 4: Confirm branch state**

Run: `git status -sb && git log --oneline -14`
Expected: clean tree on `develop`; the Task 1–14 commits present. Do not push or promote unless asked.

---

## Self-Review (completed during plan authoring)

**Spec coverage:**

- §1 decisions (single-level, shared columns, Table-nested, rollups) → Tasks 1/6 (single-level + shared cells), 9–11 (table render + rollup).
- §2 data model + migration (index + single-level trigger, RLS unchanged, types no-op) → Task 1.
- §3 actions (`addSubitem`, `deleteItem`, `reorderItem`) → Tasks 2 (schemas) + 6.
- §4 cache (`removeItem`) + realtime (no change) → Task 3 (+ note: realtime untouched).
- §5 rendering (bucketing, virtualization, chevron/indent, add-subitem, delete, rollup-on-collapse) → Tasks 9–11. **Substitution:** `flattenVisibleRows`/`VisibleRow` replaced by `bucketItems` + non-virtualized subitem sub-block (the spec's own recommended approach; documented in the Architecture note).
- §5 subitem drag-reorder → Task 12.
- §6 `rollupCell` per kind → Task 5.
- §7 other views unchanged → no task needed (we only filter top-level in the Table; other views read `payload.items` directly and are not touched).
- §8 performance budget → satisfied: bucketing/expand/rollup are client-only; mutations are Server Actions + optimistic + realtime; reads stay batched + virtualized; `parent_id` indexed (Task 1).
- §9 testing (pure unit, DB integration, component, reorder, e2e) → Tasks 1,4,5,8,10,11,12,13.

**Placeholder scan:** all library/action/migration/helper code and the Task 10–11 component tests are complete and pasted (matched to `BoardTable.test.tsx`'s mock-the-action harness). The Task 13 **e2e** remains a step-by-step scenario rather than pasted code because it depends on the project's e2e login/seed helpers (not inspected here); each step names the concrete aria-labels introduced in Tasks 10–12 so it's unambiguous to implement.

**Type consistency:** `RollupResult`, `rollupCell`, `bucketItems`/`ItemTree`, `removeItem`, the three action signatures, and the three mutation exports are named identically across the tasks that define and consume them.
