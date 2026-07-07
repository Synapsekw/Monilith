# Similarity-ranked ⌘K command-palette search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ⌘K item search's plain ILIKE-contains query with a typo-tolerant,
relevance-ranked trigram RPC — no UI change, reusing the existing `items_name_trgm_idx` GIN index.

**Architecture:** A new `SECURITY INVOKER` SQL RPC `public.search_items(p_query, p_limit)` does a
hybrid, index-assisted read — `ILIKE '%…%'` OR the pg_trgm word-similarity operator `%>`, ranked
exact-contains → `word_similarity` → recency → id, capped at 25. `src/lib/search/item-search.ts`
swaps its query-builder chain for one `rpc()` call, preserving its `searchItems(query) =>
ItemSearchResult[]` contract so `command-palette.tsx` is untouched. RLS (`SECURITY INVOKER`) keeps
results org-scoped.

**Tech Stack:** Next.js 16 (App Router, `"use server"` Server Function), Supabase Postgres +
pg_trgm, Zod (boundary validation), Vitest (unit `.test.ts` mocking Supabase + `.integration.test.ts`
against live cloud DB).

**Spec:** `docs/superpowers/specs/2026-07-06-kbar-similarity-search-design.md`

---

## Interfaces overview (dependency edge list)

| Task                                   | Consumes                                                              | Produces                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** Migration + types + advisors     | existing `items`, `boards`, `items_name_trgm_idx`, pg_trgm            | `public.search_items(p_query text, p_limit int)` RPC; regenerated `src/types/database.types.ts` with `Functions.search_items`; advisor + EXPLAIN evidence |
| **1** Lib swap + unit test             | `search_items` type (Task 0); `ItemSearchResult`; existing Zod schema | rewritten `src/lib/search/item-search.ts` (rpc-backed, same signature); rewritten `src/lib/search/item-search.test.ts`                                    |
| **2** Ranking-quality integration test | live `search_items` RPC (Task 0 applied); integration harness         | `src/lib/search/item-search.rls.integration.test.ts`                                                                                                      |
| **3** Full verification gate           | Tasks 1 + 2 merged into the branch                                    | green `typecheck/lint/test/build` + captured EXPLAIN evidence; confirmation of no UI change                                                               |

---

## Task 0: Migration — the ranked RPC (USER-applied gate)

> **This task has a mandatory human step in the middle.** The agent CANNOT push migrations to the
> cloud. The agent writes the SQL and stops; the USER runs `supabase db push`; the agent then
> regenerates types and runs advisors. No downstream task may start until `search_items` exists in
> `src/types/database.types.ts`.

**Files:**

- Create: `supabase/migrations/20260706120000_search_items_ranked_rpc.sql`
- Modify (regenerated, do not hand-edit): `src/types/database.types.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260706120000_search_items_ranked_rpc.sql`:

```sql
-- Similarity-ranked global item search for the ⌘K command palette.
--
-- WHAT THIS DOES
--   Adds public.search_items(p_query, p_limit): a hybrid, index-assisted item
--   search that (a) still returns every exact-substring match the previous ILIKE
--   did, and (b) adds pg_trgm word-similarity for typo tolerance, ranked
--   exact-contains -> word_similarity -> recency -> id. Reuses the existing
--   items_name_trgm_idx GIN index (verified: both branches Bitmap-Index-Scan it).
--
-- SECURITY: SECURITY INVOKER (the default, stated explicitly) so the read runs
--   under the CALLER's RLS -- items/boards SELECT policies scope results to boards
--   the caller can read. The function adds no privilege. Contrast the SECURITY
--   DEFINER RLS helpers (readable_board_ids()) which bypass RLS to EVALUATE it; a
--   function that RETURNS rows must not.
--
-- search_path='' pins every object to public.*/extensions.* (pg_trgm lives in
--   extensions). Function-local SET lowers the word-similarity cutoff to 0.3 so
--   real typos pass (measured: word_similarity('desing','Design spec') = 0.571,
--   under the 0.6 default) while unrelated text stays 0.0.
--
-- MUST BE APPLIED MANUALLY by the maintainer via `supabase db push` (this repo
--   does not auto-apply migrations to the cloud). After applying: regenerate
--   src/types/database.types.ts (pnpm db:types) and run the advisors.

-- Immutable helper: escape LIKE metacharacters so a query of "50%" or "a_b" is
-- matched literally by the ILIKE branch. Same logic as the lib's old
-- escapeLikePattern (escape backslash first, then % and _).
create or replace function public.escape_like(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_');
$$;

create or replace function public.search_items(
  p_query text,
  p_limit int default 25
)
returns table (id uuid, name text, board_id uuid, board_name text, rank real)
language sql
security invoker
stable
set search_path = ''
set pg_trgm.word_similarity_threshold = '0.3'
as $$
  select
    i.id,
    i.name,
    i.board_id,
    b.name as board_name,
    extensions.word_similarity(p_query, i.name) as rank
  from public.items i
  join public.boards b on b.id = i.board_id
  where i.name operator(extensions.%>) p_query
     or i.name ilike '%' || public.escape_like(p_query) || '%'
  order by
    (i.name ilike '%' || public.escape_like(p_query) || '%') desc,
    extensions.word_similarity(p_query, i.name) desc,
    i.updated_at desc,
    i.id
  limit least(greatest(coalesce(p_limit, 25), 1), 50);
$$;

-- Match the locked-down grant posture of the other authenticated-callable
-- functions (no PUBLIC, no anon).
revoke execute on function public.escape_like(text) from public;
grant execute on function public.escape_like(text) to authenticated, service_role;
revoke execute on function public.search_items(text, int) from public;
grant execute on function public.search_items(text, int) to authenticated, service_role;
```

- [ ] **Step 2: Verify the SQL parses + the index is used, before handing off (read-only, no push)**

Using the dev DB (MCP `execute_sql` or `psql`), confirm the function creates cleanly in a
transaction you roll back, and re-confirm index capability (dev corpus is tiny, so force it):

Run (rolled back — this is a check, not the apply):

```sql
begin;
-- paste the CREATE FUNCTION statements above --
set enable_seqscan = off;
explain (costs off)
select id, name, board_id,
       word_similarity('desing', name) as rank
from public.items
where name operator(extensions.%>) 'desing'
   or name ilike '%desing%'
order by (name ilike '%desing%') desc, word_similarity('desing', name) desc, updated_at desc
limit 25;
rollback;
```

Expected: plan shows `BitmapOr` of two `Bitmap Index Scan on items_name_trgm_idx` (Index Conds
`name %> …` and `name ~~* '%…%'`) under a `Bitmap Heap Scan`, then `Sort` → `Limit`. Also confirm
the function header's `set pg_trgm.word_similarity_threshold = '0.3'` is accepted (no error on
`create function`). If the function-local SET is rejected, apply the fallback from the spec §8
(add `and word_similarity(p_query, i.name) >= 0.3` is NOT needed — instead keep `%>` and re-filter;
re-run this check) before handing off.

- [ ] **Step 3: STOP — hand the migration to the USER to apply**

Tell the user, verbatim intent: _"Migration `20260706120000_search_items_ranked_rpc.sql` is written.
Please apply it: `supabase db push` (or your normal apply path). Tell me when it's applied and I'll
regenerate types + run advisors."_ Do not proceed until confirmed.

- [ ] **Step 4: Regenerate types (after user confirms apply)**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` now contains a `search_items` entry under
`Database["public"]["Functions"]` with `Args: { p_query: string; p_limit?: number }` and a
`Returns` row type including `id/name/board_id/board_name/rank`. Confirm the diff touches only that
file.

- [ ] **Step 5: Run Supabase advisors (security + performance)**

Run the Supabase advisors against the project. Expected: **no new** warnings introduced by
`search_items` / `escape_like` — specifically no "function search_path mutable" (we pin
`search_path = ''`) and no `SECURITY DEFINER` view/function warning (the function is INVOKER).
Record the result in the commit message / session note.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260706120000_search_items_ranked_rpc.sql src/types/database.types.ts
git commit -m "feat(search): add SECURITY INVOKER search_items ranked RPC + regen types"
```

---

## Task 1: Lib swap to the RPC + rewritten unit test

**Depends on:** Task 0 (needs the generated `search_items` type for a typed `rpc()` call).

**Files:**

- Modify: `src/lib/search/item-search.ts`
- Test: `src/lib/search/item-search.test.ts` (rewrite)

- [ ] **Step 1: Rewrite the failing unit test**

Replace the whole body of `src/lib/search/item-search.test.ts` (the old mock targeted
`.from().ilike().order().limit()`; the new one mocks `rpc`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// Captures the rpc call so we can assert the fn name + args without a live DB.
const captured: {
  rpcName?: string;
  rpcArgs?: Record<string, unknown>;
  rpcCalls: number;
} = { rpcCalls: 0 };
let rows: unknown[] = [];
let rpcError: { message: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      captured.rpcCalls += 1;
      captured.rpcName = name;
      captured.rpcArgs = args;
      return Promise.resolve({ data: rows, error: rpcError });
    },
  }),
}));

import { searchItems } from "./item-search";

beforeEach(() => {
  captured.rpcName = undefined;
  captured.rpcArgs = undefined;
  captured.rpcCalls = 0;
  rpcError = null;
  rows = [
    {
      id: "i1",
      name: "Design spec",
      board_id: "b1",
      board_name: "Roadmap",
      rank: 0.8,
    },
  ];
});

describe("searchItems", () => {
  it("returns [] and never calls rpc for a query shorter than 2 chars", async () => {
    expect(await searchItems("a")).toEqual([]);
    expect(captured.rpcCalls).toBe(0);
  });

  it("returns [] and never calls rpc for a whitespace-only query", async () => {
    expect(await searchItems("   ")).toEqual([]);
    expect(captured.rpcCalls).toBe(0);
  });

  it("returns [] and never calls rpc for an over-long query", async () => {
    expect(await searchItems("x".repeat(101))).toEqual([]);
    expect(captured.rpcCalls).toBe(0);
  });

  it("calls search_items with the trimmed query and a 25 cap", async () => {
    await searchItems("  design  ");
    expect(captured.rpcName).toBe("search_items");
    expect(captured.rpcArgs).toEqual({ p_query: "design", p_limit: 25 });
  });

  it("maps rows to ItemSearchResult and drops rank", async () => {
    expect(await searchItems("design")).toEqual([
      { id: "i1", name: "Design spec", boardId: "b1", boardName: "Roadmap" },
    ]);
  });

  it("returns [] on an rpc error rather than throwing", async () => {
    rpcError = { message: "boom" };
    expect(await searchItems("design")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- src/lib/search/item-search.test.ts`
Expected: FAIL — the current lib calls `.from(...)`, so `rpc` is never invoked (`rpcName`
undefined) and/or the `board_name` mapping mismatches.

- [ ] **Step 3: Rewrite the lib to call the RPC**

Replace the whole body of `src/lib/search/item-search.ts`:

```ts
"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const LIMIT = 25;

/** A single global-search hit: an item plus the board it lives on. */
export type ItemSearchResult = {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
};

const searchItemsInputSchema = z.object({
  // Trimmed at the boundary; min 2 keeps the trigram index effective and stops
  // 1-char queries fanning out. Max 100 caps a pathological input.
  query: z.string().trim().min(2).max(100),
});

/**
 * Global item search for the command palette. Delegates ranking to the
 * `search_items` RPC: a hybrid, index-assisted read (ILIKE-contains OR pg_trgm
 * word-similarity) ordered exact-contains -> similarity -> recency, backed by
 * the `items_name_trgm_idx` GIN index. The RPC is SECURITY INVOKER, so RLS
 * scopes results to items on boards the caller can read (org-scoped, no service
 * role). Bounded to {@link LIMIT} rows. Returns [] for a query that fails
 * validation or on any RPC error, so callers never see a throw.
 */
export async function searchItems(query: string): Promise<ItemSearchResult[]> {
  const parsed = searchItemsInputSchema.safeParse({ query });
  if (!parsed.success) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_items", {
    p_query: parsed.data.query,
    p_limit: LIMIT,
  });
  if (error) return [];

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    boardId: row.board_id,
    boardName: row.board_name,
  }));
}
```

Note: `escapeLikePattern` is intentionally deleted — escaping now lives in the SQL `escape_like`
helper.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- src/lib/search/item-search.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck this slice**

Run: `pnpm typecheck`
Expected: PASS. If `row` is typed `never`/`any`, Task 0's type regen did not land — stop and fix
Task 0, do not add `any`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/search/item-search.ts src/lib/search/item-search.test.ts
git commit -m "feat(search): back searchItems with the ranked search_items RPC"
```

---

## Task 2: Ranking-quality integration test (live DB)

**Depends on:** Task 0 (the RPC must exist in the live cloud project). **Parallel with Task 1**
(different file, no shared state).

**Files:**

- Create: `src/lib/search/item-search.rls.integration.test.ts`

> Follow the existing integration pattern (`src/lib/goals/goals.rls.integration.test.ts`):
> `loadIntegrationEnv()`, `describe.skipIf(!integrationTargetReady())`, `signInWithRetry`,
> service-role client for setup, `@example.com` users so `global-teardown` purges them, and an
> `afterAll` that deletes the seeded org. Runs in the `integration` project (serial).

- [ ] **Step 1: Write the integration test**

Create `src/lib/search/item-search.rls.integration.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "Test-Password-123!";

type SearchRow =
  Database["public"]["Functions"]["search_items"]["Returns"][number];

describe.skipIf(!integrationTargetReady())(
  "search_items RPC: ranking + RLS",
  () => {
    const tag = randomUUID().slice(0, 8); // unique-per-run marker in item names
    let admin: SupabaseClient<Database>; // service role, RLS-bypassing, for setup
    let userA: SupabaseClient<Database>; // org-A member, calls the RPC under RLS
    let userB: SupabaseClient<Database>; // org-B member, must NOT see org-A items
    let boardA = "";

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      // --- provision two isolated orgs, each with a member + a board ---
      // (Use the repo's create_organization RPC exactly as the goals suite does;
      //  create an @example.com auth user per org via admin.auth.admin.createUser,
      //  sign in with signInWithRetry to get an anon-key client bound to that user,
      //  then create_organization + a workspace + a board. Capture boardA.)
      // userA / userB / boardA assigned here.

      // --- seed items on board A with names whose ranking we can predict ---
      // Names embed `tag` so they are unique to this run and cleaned up:
      //   1. `Design spec ${tag}`      -> exact substring of "design"
      //   2. `Redesigned flow ${tag}`  -> fuzzy-only for "design" (no standalone word)
      //   3. `Design brief ${tag}`     -> exact substring, older updated_at
      //   4-30. `Design note N ${tag}` -> to overflow the 25 cap
      await admin.from("items").insert([
        /* rows with board_id = boardA, group_id, position */
      ]);
    });

    afterAll(async () => {
      // Delete seeded items + both test orgs; @example.com users are purged by
      // src/test/global-teardown.ts.
      await admin.from("items").delete().ilike("name", `%${tag}%`);
      // delete the two orgs created above (cascades boards/items)
    });

    it("ranks an exact substring match above a fuzzy-only match", async () => {
      const { data, error } = await userA.rpc("search_items", {
        p_query: "design",
        p_limit: 25,
      });
      expect(error).toBeNull();
      const names = (data as SearchRow[]).map((r) => r.name);
      const exact = names.indexOf(`Design spec ${tag}`);
      const fuzzy = names.indexOf(`Redesigned flow ${tag}`);
      expect(exact).toBeGreaterThanOrEqual(0);
      expect(fuzzy).toBeGreaterThanOrEqual(0);
      expect(exact).toBeLessThan(fuzzy); // exact-contains ranks first
    });

    it("tolerates a typo (desing -> Design)", async () => {
      const { data, error } = await userA.rpc("search_items", {
        p_query: "desing",
        p_limit: 25,
      });
      expect(error).toBeNull();
      const names = (data as SearchRow[]).map((r) => r.name);
      expect(names).toContain(`Design spec ${tag}`);
    });

    it("uses recency only as a tie-break between equal-strength matches", async () => {
      // `Design spec` and `Design brief` are both exact-contains for "design";
      // whichever was updated more recently comes first.
      const { data } = await userA.rpc("search_items", {
        p_query: "design",
        p_limit: 25,
      });
      const names = (data as SearchRow[]).map((r) => r.name);
      // seed step sets `Design spec` updated_at newer than `Design brief`
      expect(names.indexOf(`Design spec ${tag}`)).toBeLessThan(
        names.indexOf(`Design brief ${tag}`),
      );
    });

    it("bounds the result set to the requested cap", async () => {
      const { data } = await userA.rpc("search_items", {
        p_query: "design",
        p_limit: 25,
      });
      expect((data as SearchRow[]).length).toBe(25);
    });

    it("scopes results by RLS: org B sees none of org A's items", async () => {
      const { data, error } = await userB.rpc("search_items", {
        p_query: "design",
        p_limit: 25,
      });
      expect(error).toBeNull();
      const leaked = (data as SearchRow[]).filter((r) => r.name.includes(tag));
      expect(leaked).toEqual([]); // SECURITY INVOKER + RLS -> no cross-tenant leak
    });
  },
);
```

> Fill the `beforeAll` provisioning + `insert` rows concretely by mirroring
> `src/lib/goals/goals.rls.integration.test.ts` (org/user/workspace/board creation) and the `items`
> insert shape used by the boards suites (`board_id`, `group_id`, `position`, `name`). Set
> `Design spec`'s `updated_at` newer than `Design brief`'s so the recency tie-break is
> deterministic.

- [ ] **Step 2: Run the integration test**

Run: `pnpm test -- --project integration src/lib/search/item-search.rls.integration.test.ts`
Expected: PASS (5 tests). If it skips, `integrationTargetReady()` is false — ensure `.env.local`
is symlinked (it is, in-worktree) and the target is reachable.

- [ ] **Step 3: Commit**

```bash
git add src/lib/search/item-search.rls.integration.test.ts
git commit -m "test(search): ranking-quality + RLS integration test for search_items"
```

---

## Task 3: Full verification gate + no-UI-change confirmation

**Depends on:** Tasks 1 and 2 (on the branch).

**Files:** none (verification only).

- [ ] **Step 1: Confirm the consumers are untouched**

Run: `git diff --name-only develop...HEAD`
Expected set (exactly): the migration, `src/types/database.types.ts`, `src/lib/search/item-search.ts`,
`src/lib/search/item-search.test.ts`, `src/lib/search/item-search.rls.integration.test.ts`, and this
plan/spec. **`src/components/command-palette.tsx` and `src/components/shell/command-palette-data.tsx`
MUST NOT appear** — the lib contract is preserved, so there is no UI change.

- [ ] **Step 2: Run all four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. (`pnpm test` runs both projects; the integration suite hits the live DB serially.)

- [ ] **Step 3: Capture the EXPLAIN evidence**

Re-run the `EXPLAIN (costs off)` from Task 0 Step 2 against the applied RPC and paste the plan into
the session note as the "index confirmed usable" evidence.

- [ ] **Step 4: No separate commit** — verification produces no code. Proceed to `finish-task.sh`.

---

## Execution DAG

**Dependency graph**

- Task 0 — no deps (root; contains the USER-applied migration gate).
- Task 1 — depends on Task 0 (typed `search_items` in `database.types.ts`).
- Task 2 — depends on Task 0 (live RPC must exist).
- Task 3 — depends on Tasks 1 **and** 2.

```
        ┌────────────────────────────┐
        │ Task 0  migration + types  │  (USER applies mid-task)
        └───────────┬────────────────┘
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   ┌────────────┐      ┌──────────────────────┐
   │ Task 1 lib │      │ Task 2 ranking/RLS   │
   │  + unit    │      │  integration test    │
   └─────┬──────┘      └───────────┬──────────┘
         └──────────┬──────────────┘
                    ▼
          ┌───────────────────┐
          │ Task 3 gate       │
          └───────────────────┘
```

**Parallel batches**

- **Batch 1:** Task 0 (alone — hard gate; blocks on the user applying the migration).
- **Batch 2:** Task 1 ∥ Task 2 (independent files, no shared state → dispatch concurrently with
  `superpowers:dispatching-parallel-agents` or parallel subagents).
- **Batch 3:** Task 3 (join point).

**Critical path:** Task 0 → (Task 1 _or_ Task 2, whichever is longer — Task 2, the live integration
test, is the heavier) → Task 3. The wall-clock floor is Task 0's user-apply latency plus one
build-task plus the final gate; Batch 2's second task is free (runs alongside).

---

## Performance & data-fetching budget

(Full rationale + the live `EXPLAIN` proof are in the spec §5. Restated here as the build contract.)

- **⌘K first paint:** 0 new server round-trips for search. Palette nav data already streams behind
  its own `<Suspense>`; search fires only on input. **Unchanged.**
- **Per keystroke-batch:** exactly **1** bounded RPC round-trip, gated by `MIN_QUERY = 2` and a
  200 ms debounce in `command-palette.tsx`, with stale-response dropping via `requestId`. ≤ 25 rows.
- **Not a view toggle:** search is a genuine server read over data not present on the client, so a
  round-trip is correct (rule #5(b)). It is a `"use server"` Server Function called from a client
  component — **not** an RSC `<Link>`/`router` navigation — so it does not re-run the page.
- **Bounded + indexed:** `limit least(greatest(p_limit,1),50)`; both `WHERE` branches use
  `items_name_trgm_idx` (`BitmapOr` of two `Bitmap Index Scan`s — confirmed on the live dev DB).
  Ranking `Sort` runs only over the index-filtered candidate set. No unbounded `select *`.
- **Verification obligation:** Task 0 Step 2 and Task 3 Step 3 re-run `EXPLAIN` (with
  `enable_seqscan = off` in the tiny dev corpus) to prove the index is used before/after apply.

---

## Self-review

- **Spec coverage:** typo tolerance → Task 0 RPC + Task 2 typo test; relevance ranking → RPC order
  clause + Task 2 ordering tests; no-regression (exact-contains superset) → ILIKE branch + Task 2
  exact-first test; bounded/indexed → RPC `limit` + EXPLAIN checks (Task 0/3) + budget section; RLS
  scoping → `SECURITY INVOKER` + Task 2 cross-tenant test; no UI change → Task 3 Step 1; empty/short
  query → unchanged Zod boundary (Task 1 tests). All spec §2 goals mapped.
- **Placeholder scan:** the integration test's `beforeAll` provisioning + `insert` rows are
  described as "mirror the goals suite" rather than fully spelled out — this is deliberate (the org/
  user/board provisioning is 40+ lines of established, copy-from-neighbour boilerplate that the
  goals suite already encodes); the _assertions_ (the actual feature verification) are complete and
  concrete. No other placeholders.
- **Type consistency:** `search_items` args `{ p_query, p_limit }` and the returned row fields
  (`id/name/board_id/board_name/rank`) are identical across the migration (Task 0), the lib
  mapping (Task 1), and the integration test's `SearchRow` type (Task 2). `ItemSearchResult`
  (`id/name/boardId/boardName`) is unchanged from today.
