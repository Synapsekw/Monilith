# Board View Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user's own arrangement of a board — collapsed groups, expanded sub-items, active view tab, filter and sort — persists across reloads, tabs and devices, per user and per board.

**Architecture:** One row per `(user_id, board_id)` in a new `board_view_prefs` table holding a strict-Zod-validated `jsonb` blob. The board RSC reads it as a fourth query in its existing `Promise.all` and seeds the first render, so nothing flashes. A React context provider inside `BoardViews` owns the live state and persists the whole blob through a debounced, non-revalidating Server Action, so every in-page interaction stays at 0 server reads.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), Supabase Postgres with RLS, Zod 4, TanStack Query board cache, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-09-board-view-prefs-design.md`

## Global Constraints

- Server Components by default; client components only where interactive. All mutations go through Server Actions.
- Server Actions return `ActionResult` and use `fail` from `src/lib/actions/result.ts`. Never re-declare that shape locally.
- Typed RPC calls go through `typedRpc` in `src/lib/supabase/typed-rpc.ts`. Never call `supabase.rpc` directly.
- Schema changes are versioned migrations minted **only** by `scripts/new-migration.sh <slug>`. Never hand-write a version stamp. Apply to DEV via the `supabase-dev` MCP using the **same version and name** as the committed file, then verify with `pnpm db:ledger-check`.
- In a worktree `pnpm db:types` fails. Regenerate types with the `supabase-dev` MCP `generate_typescript_types` tool and run prettier over the result.
- RLS is the security boundary: default-deny, org-scoped, no cross-tenant access.
- TypeScript strict. No `any`.
- The persistence Server Action **must not** call `revalidatePath` or `revalidateTag`.
- View switching and filtering keep using the History API (`pushState` / `replaceState`), never `<Link>` or `router.push`.
- Caps, used verbatim in code: `MAX_PREF_IDS = 500`, `MAX_FILTER_QUERY_CHARS = 2000`, debounce `SAVE_DEBOUNCE_MS = 800`.
- Commit identity is pinned to `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage explicitly by path; never `git add -A`.
- All four gates must pass before the task is done: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## File Structure

| File                                                | Responsibility                                                        | Task |
| --------------------------------------------------- | --------------------------------------------------------------------- | ---- |
| `supabase/migrations/<minted>_board_view_prefs.sql` | Table, RLS policies, `save_board_view_prefs` RPC                      | 1    |
| `src/types/database.types.ts`                       | Regenerated Supabase types (never hand-edited)                        | 1    |
| `src/lib/validations/view-prefs.ts`                 | Zod schema, caps, `parseBoardViewPrefs`                               | 2    |
| `src/lib/validations/view-prefs.test.ts`            | Schema unit tests                                                     | 2    |
| `src/lib/boards/view-prefs.ts`                      | Server-side read `getBoardViewPrefs`                                  | 2    |
| `src/lib/boards/view-prefs-actions.ts`              | `"use server"` — `saveBoardViewPrefs`                                 | 2    |
| `src/lib/boards/view-prefs-context.tsx`             | Client provider + `useBoardViewPrefs` hook, debounced writer, pruning | 3    |
| `src/lib/boards/view-prefs-context.test.tsx`        | Provider unit tests                                                   | 3    |
| `src/app/(app)/boards/[boardId]/page.tsx`           | Reads prefs, seeds view resolution, passes state down                 | 4    |
| `src/components/boards/BoardViews.tsx`              | Mounts the provider, persists the active view                         | 4    |
| `src/components/boards/table/BoardTableInner.tsx`   | Owns the lifted `collapsedGroups` set                                 | 5    |
| `src/components/boards/table/GroupSection.tsx`      | Takes `collapsed` / `onToggleCollapse` as props                       | 5    |
| `src/components/boards/GanttBoard.tsx`              | Shares the provider's expanded set                                    | 5    |
| `src/lib/boards/use-board-filter-sort.ts`           | Seeds from the saved filter query, persists changes                   | 6    |
| `src/lib/boards/use-board-filter-sort.test.ts`      | Seeding tests                                                         | 6    |
| `src/lib/boards/view-prefs.rls.integration.test.ts` | Cross-user RLS isolation                                              | 7    |

## Execution DAG

**Dependency graph**

- Task 1 (migration + types) — no dependencies
- Task 2 (schema, read, action) — depends on Task 1
- Task 3 (provider) — depends on Task 2
- Task 4 (page + BoardViews wiring) — depends on Task 3
- Task 5 (collapse/expansion lift) — depends on Task 4
- Task 6 (filter seeding) — depends on Task 4
- Task 7 (RLS integration test) — depends on Task 1

**Parallel batches**

| Batch | Tasks | Note                                          |
| ----- | ----- | --------------------------------------------- |
| A     | 1     | Everything blocks on the table existing       |
| B     | 2, 7  | Both need only the migration; disjoint files  |
| C     | 3     | Single unit                                   |
| D     | 4     | Mounts the provider; must land before 5 and 6 |
| E     | 5, 6  | Disjoint files, no shared state               |

**Critical path:** 1 → 2 → 3 → 4 → 5. Five tasks; that is the wall-clock floor.

All tasks share one worktree and one branch, so batched tasks must still be committed one at a time to avoid git index races.

---

### Task 1: Migration, RLS and the save RPC

**Files:**

- Create: `supabase/migrations/<minted>_board_view_prefs.sql`
- Modify: `src/types/database.types.ts` (regenerated, never hand-edited)

**Interfaces:**

- Consumes: nothing.
- Produces: table `public.board_view_prefs (user_id uuid, board_id uuid, org_id uuid, state jsonb, updated_at timestamptz)` with primary key `(user_id, board_id)`; RPC `public.save_board_view_prefs(p_board_id uuid, p_state jsonb) returns void`. Generated types expose `Database["public"]["Tables"]["board_view_prefs"]` and `Database["public"]["Functions"]["save_board_view_prefs"]`.

- [ ] **Step 1: Mint the migration file**

```bash
scripts/new-migration.sh board_view_prefs
```

Note the exact filename it prints. Do not invent or edit the version stamp.

- [ ] **Step 2: Write the migration body**

Write this into the minted file, below the header comment the script generates.

```sql
-- Per-user, per-board view arrangement: which groups are collapsed, which
-- sub-item rows are expanded, the last active view, and the last filter/sort.
--
-- One row per (user, board). The primary key is the only index the feature
-- needs: every read is a point lookup on it and every write is an upsert on it.
--
-- `state` is a jsonb blob whose shape is owned by app code (Zod, see
-- src/lib/validations/view-prefs.ts) so adding a remembered field needs no
-- migration. The DB only bounds the row's existence and its tenancy.
--
-- org_id is denormalised from the board so the write policy can assert org
-- membership without a join, and so the row dies with the org.
create table public.board_view_prefs (
  user_id    uuid not null references auth.users (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  org_id     uuid not null references public.organizations (id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, board_id)
);

comment on table public.board_view_prefs is
  'Per-user, per-board view arrangement (collapsed groups, expanded rows, active view, filter). Never shared between users.';

alter table public.board_view_prefs enable row level security;

-- Default-deny. Every policy is scoped to the caller's own row; there is no
-- policy under which one user can see or write another user's arrangement.
-- Writes additionally require live org membership.
create policy "board_view_prefs: select own"
  on public.board_view_prefs for select
  using (user_id = (select auth.uid()));

create policy "board_view_prefs: insert own"
  on public.board_view_prefs for insert
  with check (user_id = (select auth.uid()) and public.is_org_member(org_id));

create policy "board_view_prefs: update own"
  on public.board_view_prefs for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_org_member(org_id));

create policy "board_view_prefs: delete own"
  on public.board_view_prefs for delete
  using (user_id = (select auth.uid()));

-- Upsert helper. Resolves org_id from the board in SQL so the write costs one
-- round trip instead of a read-then-write. SECURITY INVOKER (the default) is
-- load-bearing: the board lookup runs under the caller's RLS, so a user who
-- cannot see the board cannot create a prefs row for it.
create or replace function public.save_board_view_prefs(
  p_board_id uuid,
  p_state jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  select b.org_id into v_org_id from public.boards b where b.id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found';
  end if;

  insert into public.board_view_prefs (user_id, board_id, org_id, state, updated_at)
  values ((select auth.uid()), p_board_id, v_org_id, p_state, now())
  on conflict (user_id, board_id) do update
    set state = excluded.state,
        updated_at = now();
end;
$$;

comment on function public.save_board_view_prefs (uuid, jsonb) is
  'Upsert the calling user''s view arrangement for a board. Security invoker: the board lookup is RLS-filtered.';
```

- [ ] **Step 3: Apply it to DEV**

Use the `supabase-dev` MCP `apply_migration` tool with the **same version and name** as the committed filename, and the exact SQL above. Do not use the dashboard.

- [ ] **Step 4: Verify the ledger matches**

Run: `pnpm db:ledger-check`
Expected: clean — no ledger row without a committed file, no committed file without a ledger row. If a version label drifted, repair with `scripts/reconcile-migration-version.sh`.

- [ ] **Step 5: Regenerate types**

Use the `supabase-dev` MCP `generate_typescript_types` tool, write the result to `src/types/database.types.ts`, then run:

```bash
pnpm prettier --write src/types/database.types.ts
```

- [ ] **Step 6: Verify the new types exist**

Run: `grep -n "board_view_prefs\|save_board_view_prefs" src/types/database.types.ts`
Expected: matches under both `Tables` and `Functions`.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations src/types/database.types.ts
git commit -m "feat(db): board_view_prefs table, RLS and save RPC"
```

---

### Task 2: Validation schema, read query and Server Action

**Files:**

- Create: `src/lib/validations/view-prefs.ts`
- Create: `src/lib/validations/view-prefs.test.ts`
- Create: `src/lib/boards/view-prefs.ts`
- Create: `src/lib/boards/view-prefs-actions.ts`
- Test: `src/lib/validations/view-prefs.test.ts`

**Interfaces:**

- Consumes: `board_view_prefs` and `save_board_view_prefs` from Task 1; `ActionResult` / `fail` from `src/lib/actions/result.ts`; `typedRpc` from `src/lib/supabase/typed-rpc.ts`.
- Produces:
  - `MAX_PREF_IDS: 500`, `MAX_FILTER_QUERY_CHARS: 2000`
  - `boardViewPrefsStateSchema` (strict Zod object)
  - `type BoardViewPrefsState = { viewId?: string | null; collapsedGroupIds?: string[]; expandedItemIds?: string[]; filterQuery?: string }`
  - `type ResolvedBoardViewPrefs = { viewId: string | null; collapsedGroupIds: string[]; expandedItemIds: string[]; filterQuery: string }`
  - `EMPTY_BOARD_VIEW_PREFS: ResolvedBoardViewPrefs`
  - `parseBoardViewPrefs(raw: unknown): ResolvedBoardViewPrefs`
  - `getBoardViewPrefs(supabase: SupabaseClient<Database>, boardId: string, userId: string): Promise<ResolvedBoardViewPrefs>`
  - `saveBoardViewPrefs(input: { boardId: string; state: BoardViewPrefsState }): Promise<ActionResult>`

- [ ] **Step 1: Write the failing schema test**

Create `src/lib/validations/view-prefs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EMPTY_BOARD_VIEW_PREFS,
  MAX_FILTER_QUERY_CHARS,
  MAX_PREF_IDS,
  boardViewPrefsStateSchema,
  parseBoardViewPrefs,
} from "./view-prefs";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("boardViewPrefsStateSchema", () => {
  it("accepts a full, well-formed state", () => {
    const parsed = boardViewPrefsStateSchema.safeParse({
      viewId: UUID_A,
      collapsedGroupIds: [UUID_B],
      expandedItemIds: [],
      filterQuery: "q=hello&sort=name:asc",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown key rather than stripping it", () => {
    const parsed = boardViewPrefsStateSchema.safeParse({ nope: 1 });
    expect(parsed.success).toBe(false);
  });

  it("rejects an id list over the cap", () => {
    const tooMany = Array.from({ length: MAX_PREF_IDS + 1 }, () => UUID_A);
    const parsed = boardViewPrefsStateSchema.safeParse({
      collapsedGroupIds: tooMany,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a filter query over the character cap", () => {
    const parsed = boardViewPrefsStateSchema.safeParse({
      filterQuery: "x".repeat(MAX_FILTER_QUERY_CHARS + 1),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    const parsed = boardViewPrefsStateSchema.safeParse({
      collapsedGroupIds: ["not-a-uuid"],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("parseBoardViewPrefs", () => {
  it("fills every field from a partial state", () => {
    expect(parseBoardViewPrefs({ collapsedGroupIds: [UUID_A] })).toEqual({
      viewId: null,
      collapsedGroupIds: [UUID_A],
      expandedItemIds: [],
      filterQuery: "",
    });
  });

  it("falls back to defaults for malformed stored state", () => {
    expect(parseBoardViewPrefs({ viewId: 42 })).toEqual(EMPTY_BOARD_VIEW_PREFS);
    expect(parseBoardViewPrefs(null)).toEqual(EMPTY_BOARD_VIEW_PREFS);
    expect(parseBoardViewPrefs("garbage")).toEqual(EMPTY_BOARD_VIEW_PREFS);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/validations/view-prefs.test.ts`
Expected: FAIL — cannot resolve `./view-prefs`.

- [ ] **Step 3: Write the schema module**

Create `src/lib/validations/view-prefs.ts`:

```ts
import { z } from "zod";

/**
 * Per-user, per-board view arrangement.
 *
 * The DB stores this as an opaque `jsonb` blob, so this schema is the only
 * definition of its shape. It is applied at BOTH boundaries: before a write,
 * and again on read — a row written by an older client version must not be
 * trusted to match the current shape.
 */

/** Cap on each remembered id list, so a long-lived row cannot grow unbounded. */
export const MAX_PREF_IDS = 500;
/** Cap on the serialized filter query string. */
export const MAX_FILTER_QUERY_CHARS = 2000;

const uuid = z.string().uuid();
const idList = z.array(uuid).max(MAX_PREF_IDS);

/**
 * `.strict()` so an unrecognised key is rejected rather than silently stored —
 * a typo in a future field would otherwise persist forever as dead weight.
 */
export const boardViewPrefsStateSchema = z
  .object({
    /** Last active board view. */
    viewId: uuid.nullable().optional(),
    /** Groups the user has collapsed in the table view. */
    collapsedGroupIds: idList.optional(),
    /** Items whose sub-item rows the user has expanded. */
    expandedItemIds: idList.optional(),
    /**
     * The serialized URL query string for the filter params (q / people /
     * status / filter / sort). Stored as the URL form, not a parsed object, so
     * `serializeBoardFilter` / `parseBoardFilter` stay the only encoder and the
     * persisted form cannot drift from the URL form.
     */
    filterQuery: z.string().max(MAX_FILTER_QUERY_CHARS).optional(),
  })
  .strict();

export type BoardViewPrefsState = z.infer<typeof boardViewPrefsStateSchema>;

/** The same state with every field present — what the app actually renders from. */
export type ResolvedBoardViewPrefs = {
  viewId: string | null;
  collapsedGroupIds: string[];
  expandedItemIds: string[];
  filterQuery: string;
};

export const EMPTY_BOARD_VIEW_PREFS: ResolvedBoardViewPrefs = {
  viewId: null,
  collapsedGroupIds: [],
  expandedItemIds: [],
  filterQuery: "",
};

/**
 * Parse stored state, failing open. A malformed or unrecognised blob renders
 * the board with today's defaults rather than erroring — remembering an
 * arrangement is a convenience, never a precondition for showing the board.
 */
export function parseBoardViewPrefs(raw: unknown): ResolvedBoardViewPrefs {
  const parsed = boardViewPrefsStateSchema.safeParse(raw);
  if (!parsed.success) return EMPTY_BOARD_VIEW_PREFS;
  return {
    viewId: parsed.data.viewId ?? null,
    collapsedGroupIds: parsed.data.collapsedGroupIds ?? [],
    expandedItemIds: parsed.data.expandedItemIds ?? [],
    filterQuery: parsed.data.filterQuery ?? "",
  };
}

/** Server Action input boundary. */
export const saveBoardViewPrefsSchema = z
  .object({
    boardId: uuid,
    state: boardViewPrefsStateSchema,
  })
  .strict();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/validations/view-prefs.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the server-side read**

Create `src/lib/boards/view-prefs.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  EMPTY_BOARD_VIEW_PREFS,
  parseBoardViewPrefs,
  type ResolvedBoardViewPrefs,
} from "@/lib/validations/view-prefs";

/**
 * Read the caller's saved arrangement for one board.
 *
 * A point lookup on the (user_id, board_id) primary key — bounded by
 * construction, so it is safe on the board page's hot path. RLS already scopes
 * the row to the caller; the explicit user_id filter makes the index use
 * obvious and keeps the query honest if the policy ever changes.
 *
 * Never throws: a missing row, an RLS denial or a malformed blob all resolve to
 * the empty arrangement, because failing to remember a collapsed group must not
 * be able to break the board.
 */
export async function getBoardViewPrefs(
  supabase: SupabaseClient<Database>,
  boardId: string,
  userId: string,
): Promise<ResolvedBoardViewPrefs> {
  const { data, error } = await supabase
    .from("board_view_prefs")
    .select("state")
    .eq("user_id", userId)
    .eq("board_id", boardId)
    .maybeSingle();

  if (error || !data) return EMPTY_BOARD_VIEW_PREFS;
  return parseBoardViewPrefs(data.state);
}
```

- [ ] **Step 6: Write the Server Action**

Create `src/lib/boards/view-prefs-actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  saveBoardViewPrefsSchema,
  type BoardViewPrefsState,
} from "@/lib/validations/view-prefs";

/**
 * Persist the caller's view arrangement for one board.
 *
 * Deliberately does NOT revalidate. This is per-user chrome that no other
 * client's query renders, so a `revalidatePath` here would re-run every board
 * query on the page to change nothing on screen — the exact regression in
 * vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md.
 *
 * The whole blob is written every time (the caller debounces and coalesces), so
 * there is no read-modify-write race between two tabs: last writer wins, which
 * is the right semantics for a personal layout preference.
 */
export async function saveBoardViewPrefs(input: {
  boardId: string;
  state: BoardViewPrefsState;
}): Promise<ActionResult> {
  const parsed = saveBoardViewPrefsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  }

  const supabase = await createClient();
  const { error } = await typedRpc(supabase, "save_board_view_prefs", {
    p_board_id: parsed.data.boardId,
    p_state: parsed.data.state,
  });
  if (error) return fail(error.message);

  return { ok: true, data: undefined };
}
```

- [ ] **Step 7: Verify the gates**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run src/lib/validations/view-prefs.test.ts`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validations/view-prefs.ts src/lib/validations/view-prefs.test.ts src/lib/boards/view-prefs.ts src/lib/boards/view-prefs-actions.ts
git commit -m "feat(boards): view-prefs schema, read query and save action"
```

---

### Task 3: The client provider

**Files:**

- Create: `src/lib/boards/view-prefs-context.tsx`
- Test: `src/lib/boards/view-prefs-context.test.tsx`

**Interfaces:**

- Consumes: `saveBoardViewPrefs` from Task 2; `ResolvedBoardViewPrefs`, `MAX_PREF_IDS` from `src/lib/validations/view-prefs.ts`.
- Produces:
  - `<BoardViewPrefsProvider boardId={string} initial={ResolvedBoardViewPrefs}>`
  - `useBoardViewPrefs(): BoardViewPrefsApi` where

    ```ts
    type BoardViewPrefsApi = {
      collapsedGroups: Set<string>;
      expandedItems: Set<string>;
      initialFilterQuery: string;
      toggleGroupCollapsed: (groupId: string) => void;
      toggleItemExpanded: (itemId: string) => void;
      setActiveViewId: (viewId: string) => void;
      setFilterQuery: (query: string) => void;
      pruneTo: (live: { groupIds: string[]; itemIds: string[] }) => void;
    };
    ```

  - `SAVE_DEBOUNCE_MS = 800`

- [ ] **Step 1: Write the failing provider test**

Create `src/lib/boards/view-prefs-context.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BoardViewPrefsProvider,
  useBoardViewPrefs,
} from "./view-prefs-context";
import { EMPTY_BOARD_VIEW_PREFS } from "@/lib/validations/view-prefs";

const save = vi.fn(async () => ({ ok: true as const, data: undefined }));
vi.mock("./view-prefs-actions", () => ({
  saveBoardViewPrefs: (...args: unknown[]) => save(...(args as [])),
}));

const BOARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP_A = "11111111-1111-4111-8111-111111111111";
const GROUP_B = "22222222-2222-4222-8222-222222222222";
const ITEM_A = "33333333-3333-4333-8333-333333333333";

function wrapper(initial = EMPTY_BOARD_VIEW_PREFS) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <BoardViewPrefsProvider boardId={BOARD} initial={initial}>
        {children}
      </BoardViewPrefsProvider>
    );
  };
}

describe("BoardViewPrefsProvider", () => {
  beforeEach(() => {
    save.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("seeds its sets from the initial state", () => {
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper({
        ...EMPTY_BOARD_VIEW_PREFS,
        collapsedGroupIds: [GROUP_A],
        filterQuery: "q=hi",
      }),
    });
    expect(result.current.collapsedGroups.has(GROUP_A)).toBe(true);
    expect(result.current.initialFilterQuery).toBe("q=hi");
  });

  it("toggles a group and persists once after the debounce", () => {
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper(),
    });

    act(() => {
      result.current.toggleGroupCollapsed(GROUP_A);
      result.current.toggleGroupCollapsed(GROUP_B);
    });
    expect(result.current.collapsedGroups.has(GROUP_A)).toBe(true);
    expect(save).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      boardId: BOARD,
      state: {
        viewId: null,
        collapsedGroupIds: [GROUP_A, GROUP_B],
        expandedItemIds: [],
        filterQuery: "",
      },
    });
  });

  it("toggling a group twice returns it to expanded", () => {
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper(),
    });
    act(() => {
      result.current.toggleGroupCollapsed(GROUP_A);
    });
    act(() => {
      result.current.toggleGroupCollapsed(GROUP_A);
    });
    expect(result.current.collapsedGroups.has(GROUP_A)).toBe(false);
  });

  it("prunes ids that no longer exist on the board", () => {
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper({
        ...EMPTY_BOARD_VIEW_PREFS,
        collapsedGroupIds: [GROUP_A, GROUP_B],
        expandedItemIds: [ITEM_A],
      }),
    });

    act(() => {
      result.current.pruneTo({ groupIds: [GROUP_A], itemIds: [] });
    });
    expect(result.current.collapsedGroups.has(GROUP_B)).toBe(false);
    expect(result.current.collapsedGroups.has(GROUP_A)).toBe(true);
    expect(result.current.expandedItems.size).toBe(0);
  });

  it("does not persist when pruning changes nothing", () => {
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper({
        ...EMPTY_BOARD_VIEW_PREFS,
        collapsedGroupIds: [GROUP_A],
      }),
    });
    act(() => {
      result.current.pruneTo({ groupIds: [GROUP_A], itemIds: [] });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("a failed save never throws", async () => {
    save.mockResolvedValueOnce({ ok: false, error: "nope" } as never);
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper(),
    });
    act(() => {
      result.current.toggleGroupCollapsed(GROUP_A);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.collapsedGroups.has(GROUP_A)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/boards/view-prefs-context.test.tsx`
Expected: FAIL — cannot resolve `./view-prefs-context`.

- [ ] **Step 3: Write the provider**

Create `src/lib/boards/view-prefs-context.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { saveBoardViewPrefs } from "./view-prefs-actions";
import {
  MAX_PREF_IDS,
  type BoardViewPrefsState,
  type ResolvedBoardViewPrefs,
} from "@/lib/validations/view-prefs";

/**
 * Live owner of the user's board arrangement.
 *
 * Every toggle updates local state immediately — the UI never waits on the
 * network — and schedules one debounced write of the WHOLE blob. Coalescing to
 * a single upsert is what keeps a burst of collapses (or a drag through several
 * groups) at one round trip instead of one per click, and it means an in-page
 * interaction still costs 0 server READS (AGENTS.md working agreement #5).
 */

/** Debounce before a change is persisted. Bursts inside this window coalesce. */
export const SAVE_DEBOUNCE_MS = 800;

export type BoardViewPrefsApi = {
  collapsedGroups: Set<string>;
  expandedItems: Set<string>;
  /**
   * The saved filter query as it was at first paint. Deliberately NOT live:
   * the URL is authoritative once the session starts writing it, so consumers
   * use this only to seed.
   */
  initialFilterQuery: string;
  toggleGroupCollapsed: (groupId: string) => void;
  toggleItemExpanded: (itemId: string) => void;
  setActiveViewId: (viewId: string) => void;
  setFilterQuery: (query: string) => void;
  /** Drop remembered ids for groups/items that no longer exist on the board. */
  pruneTo: (live: { groupIds: string[]; itemIds: string[] }) => void;
};

const noop = () => {};

/**
 * Inert default so a view rendered outside the provider (tests, Storybook-style
 * harnesses) degrades to today's behaviour instead of throwing. Remembering an
 * arrangement is a convenience; its absence must never break a board.
 */
const INERT: BoardViewPrefsApi = {
  collapsedGroups: new Set(),
  expandedItems: new Set(),
  initialFilterQuery: "",
  toggleGroupCollapsed: noop,
  toggleItemExpanded: noop,
  setActiveViewId: noop,
  setFilterQuery: noop,
  pruneTo: noop,
};

const BoardViewPrefsContext = createContext<BoardViewPrefsApi>(INERT);

export function useBoardViewPrefs(): BoardViewPrefsApi {
  return useContext(BoardViewPrefsContext);
}

function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function BoardViewPrefsProvider({
  boardId,
  initial,
  children,
}: {
  boardId: string;
  initial: ResolvedBoardViewPrefs;
  children: React.ReactNode;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(initial.collapsedGroupIds),
  );
  const [expandedItems, setExpandedItems] = useState<Set<string>>(
    () => new Set(initial.expandedItemIds),
  );

  // The view id and filter query are write-only from this provider's point of
  // view: the URL renders them, so holding them in state would just be a second
  // source of truth. Refs keep them out of the render path entirely.
  const viewIdRef = useRef<string | null>(initial.viewId);
  const filterQueryRef = useRef<string>(initial.filterQuery);

  // Latest sets for the debounced writer, so the timer never closes over stale
  // state and never has to be re-created on every toggle.
  const collapsedRef = useRef(collapsedGroups);
  const expandedRef = useRef(expandedItems);
  useEffect(() => {
    collapsedRef.current = collapsedGroups;
  }, [collapsedGroups]);
  useEffect(() => {
    expandedRef.current = expandedItems;
  }, [expandedItems]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const state: BoardViewPrefsState = {
        viewId: viewIdRef.current,
        // Capped here as well as in the schema: the cap is a bound on what we
        // are willing to remember, so the write must not fail validation just
        // because a very large board got fully collapsed.
        collapsedGroupIds: [...collapsedRef.current].slice(0, MAX_PREF_IDS),
        expandedItemIds: [...expandedRef.current].slice(0, MAX_PREF_IDS),
        filterQuery: filterQueryRef.current,
      };
      // Fire and forget. A failed persist is dropped, never surfaced and never
      // allowed to roll back local state — failing to remember a collapsed
      // group is not worth interrupting the user for.
      void saveBoardViewPrefs({ boardId, state }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }, [boardId]);

  const toggleGroupCollapsed = useCallback(
    (groupId: string) => {
      setCollapsedGroups((prev) => toggleIn(prev, groupId));
      schedule();
    },
    [schedule],
  );

  const toggleItemExpanded = useCallback(
    (itemId: string) => {
      setExpandedItems((prev) => toggleIn(prev, itemId));
      schedule();
    },
    [schedule],
  );

  const setActiveViewId = useCallback(
    (viewId: string) => {
      if (viewIdRef.current === viewId) return;
      viewIdRef.current = viewId;
      schedule();
    },
    [schedule],
  );

  const setFilterQuery = useCallback(
    (query: string) => {
      if (filterQueryRef.current === query) return;
      filterQueryRef.current = query;
      schedule();
    },
    [schedule],
  );

  const pruneTo = useCallback(
    (live: { groupIds: string[]; itemIds: string[] }) => {
      const liveGroups = new Set(live.groupIds);
      const liveItems = new Set(live.itemIds);
      let changed = false;

      setCollapsedGroups((prev) => {
        const next = new Set([...prev].filter((id) => liveGroups.has(id)));
        if (next.size === prev.size) return prev;
        changed = true;
        return next;
      });
      setExpandedItems((prev) => {
        const next = new Set([...prev].filter((id) => liveItems.has(id)));
        if (next.size === prev.size) return prev;
        changed = true;
        return next;
      });

      // Only write when something actually fell out, so the common case (every
      // remembered id still exists) costs nothing.
      if (changed) schedule();
    },
    [schedule],
  );

  const value = useMemo<BoardViewPrefsApi>(
    () => ({
      collapsedGroups,
      expandedItems,
      initialFilterQuery: initial.filterQuery,
      toggleGroupCollapsed,
      toggleItemExpanded,
      setActiveViewId,
      setFilterQuery,
      pruneTo,
    }),
    [
      collapsedGroups,
      expandedItems,
      initial.filterQuery,
      toggleGroupCollapsed,
      toggleItemExpanded,
      setActiveViewId,
      setFilterQuery,
      pruneTo,
    ],
  );

  return (
    <BoardViewPrefsContext.Provider value={value}>
      {children}
    </BoardViewPrefsContext.Provider>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/boards/view-prefs-context.test.tsx`
Expected: PASS, 6 tests.

If the "does not persist when pruning changes nothing" test fails because `changed` is read before the state updaters run, note that React calls the updater synchronously inside `setState` during an `act()` block, so the flag is set in time. If it proves flaky, compute the pruned sets from `collapsedRef.current` / `expandedRef.current` first, decide `changed` from those, then set state — do not add a `setTimeout`.

- [ ] **Step 5: Verify the gates**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/view-prefs-context.tsx src/lib/boards/view-prefs-context.test.tsx
git commit -m "feat(boards): view-prefs provider with debounced persistence"
```

---

### Task 4: Wire the page and BoardViews

**Files:**

- Modify: `src/app/(app)/boards/[boardId]/page.tsx`
- Modify: `src/components/boards/BoardViews.tsx`

**Interfaces:**

- Consumes: `getBoardViewPrefs` (Task 2), `BoardViewPrefsProvider` + `useBoardViewPrefs` (Task 3), existing `resolveSelectedView` from `src/lib/boards/views.ts`.
- Produces: `BoardViews` gains a required prop `viewPrefs: ResolvedBoardViewPrefs`. Every child view renders inside `BoardViewPrefsProvider`.

- [ ] **Step 1: Read the prefs in the board page**

In `src/app/(app)/boards/[boardId]/page.tsx`, add the import:

```ts
import { getBoardViewPrefs } from "@/lib/boards/view-prefs";
```

Add the read as a fourth entry in the existing `Promise.all` (currently `[payload, { data: grantRows }, { data: agentRows }]`):

```ts
const [payload, { data: grantRows }, { data: agentRows }, viewPrefs] =
  await Promise.all([
    getBoardPayload(boardId),
    supabase
      .from("board_members")
      .select("user_id, access_level")
      .eq("board_id", boardId),
    // Owner-scoped by RLS and capped by max_agents_per_user (default 3) —
    // this is a roster of names for the dock's switcher, NOT thread data.
    // Threads stay unfetched until the dock is opened.
    supabase
      .from("user_agents")
      .select("id, name")
      .eq("owner_id", user.id)
      .order("name"),
    // The caller's saved arrangement for this board. A point read on the
    // (user_id, board_id) primary key, issued in parallel with work that is
    // already slower, so it costs no measurable added latency. Resolving it
    // server-side is what lets collapsed groups arrive already collapsed —
    // no expand-then-collapse flash.
    getBoardViewPrefs(supabase, boardId, user.id),
  ]);
```

- [ ] **Step 2: Seed the view from the saved arrangement**

Replace the view resolution (currently `const selected = resolveSelectedView(payload.views, sp.view);`) with:

```ts
const sp = await searchParams;
// The URL always wins: a link carrying ?view= opens that view, exactly as it
// does today. The saved view only fills the gap when the URL is silent, so
// persistence is invisible to anyone arriving by link.
const selected = resolveSelectedView(
  payload.views,
  sp.view ?? viewPrefs.viewId ?? undefined,
);
```

`resolveSelectedView` already falls back to the first table view when the requested id no longer exists, so a deleted saved view needs no extra handling.

- [ ] **Step 3: Pass the prefs to BoardViews**

Add the prop to the existing `<BoardViews …>` element:

```tsx
<BoardViews
  payload={payload}
  members={members}
  initialViewId={selectedViewId}
  currentUserId={user.id}
  access={access ?? "viewer"}
  grants={grants}
  viewPrefs={viewPrefs}
/>
```

- [ ] **Step 4: Accept and mount the provider in BoardViews**

In `src/components/boards/BoardViews.tsx`, add the imports:

```ts
import { BoardViewPrefsProvider } from "@/lib/boards/view-prefs-context";
import type { ResolvedBoardViewPrefs } from "@/lib/validations/view-prefs";
```

Add `viewPrefs: ResolvedBoardViewPrefs` to the component's props (both the destructured parameter list and its type annotation).

Wrap the returned tree. The provider goes OUTSIDE `BoardPresenceProvider` so every view and the item panel can read it:

```tsx
return (
  <BoardViewPrefsProvider boardId={payload.board.id} initial={viewPrefs}>
    <BoardPresenceProvider value={presenceValue}>
      {/* …existing children unchanged… */}
    </BoardPresenceProvider>
  </BoardViewPrefsProvider>
);
```

- [ ] **Step 5: Persist the active view**

`BoardViews` already computes `activeViewId`. Persisting there rather than in `ViewSwitcher` catches every path that can change the view, including the initial resolution.

Add a small child component at the bottom of the file, so the effect can call the hook without the provider having to be mounted above `BoardViews` itself:

```tsx
/**
 * Records the active view whenever it changes. A separate component because it
 * must sit INSIDE BoardViewPrefsProvider, which BoardViews itself renders.
 * Renders nothing; `setActiveViewId` is a no-op when the value is unchanged, so
 * the initial mount does not cause a write.
 */
function ActiveViewRecorder({ viewId }: { viewId: string }) {
  const { setActiveViewId } = useBoardViewPrefs();
  useEffect(() => {
    if (viewId) setActiveViewId(viewId);
  }, [viewId, setActiveViewId]);
  return null;
}
```

Import `useBoardViewPrefs` alongside `BoardViewPrefsProvider`, and render `<ActiveViewRecorder viewId={activeViewId} />` as the first child inside the provider.

- [ ] **Step 6: Fix every other caller of BoardViews**

Run: `grep -rn "<BoardViews" src`
Any other call site (tests, offline shells) must pass `viewPrefs`. Use `EMPTY_BOARD_VIEW_PREFS` from `@/lib/validations/view-prefs` where there is no real saved state.

- [ ] **Step 7: Verify the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/(app)/boards/[boardId]/page.tsx src/components/boards/BoardViews.tsx
git commit -m "feat(boards): read view prefs server-side and seed the active view"
```

---

### Task 5: Lift group collapse and share row expansion

**Files:**

- Modify: `src/components/boards/table/GroupSection.tsx:88` and its `GroupHeaderRow` call site (lines 195-196)
- Modify: `src/components/boards/table/BoardTableInner.tsx:134` (the `expanded` state) and the `<GroupSection …>` call site (lines ~688-712)
- Modify: `src/components/boards/GanttBoard.tsx:262-270`

**Interfaces:**

- Consumes: `useBoardViewPrefs` from Task 3, mounted by Task 4.
- Produces: `GroupSection` gains required props `collapsed: boolean` and `onToggleCollapse: () => void`, and no longer owns collapse state.

- [ ] **Step 1: Write the failing test**

Add to `src/components/boards/BoardTable.test.tsx`, reusing the `payloadFixture()` helper that file already defines (its single group has id `g1`, name `Group 1`). Add these imports at the top of the file:

```ts
import { BoardViewPrefsProvider } from "@/lib/boards/view-prefs-context";
import { EMPTY_BOARD_VIEW_PREFS } from "@/lib/validations/view-prefs";
```

The provider persists through a real Server Action, which cannot run in jsdom, so mock it alongside the file's existing mocks:

```ts
vi.mock("@/lib/boards/view-prefs-actions", () => ({
  saveBoardViewPrefs: vi.fn(async () => ({ ok: true, data: undefined })),
}));
```

Then add the suite:

```tsx
describe("BoardTable saved arrangement", () => {
  function renderWithPrefs(collapsedGroupIds: string[]) {
    const qc = new QueryClient();
    return render(
      <QueryClientProvider client={qc}>
        <BoardViewPrefsProvider
          boardId="b1"
          initial={{ ...EMPTY_BOARD_VIEW_PREFS, collapsedGroupIds }}
        >
          <BoardTable payload={payloadFixture()} selectedViewId="v1" />
        </BoardViewPrefsProvider>
      </QueryClientProvider>,
    );
  }

  // The chevron's aria-label flips with the state: "Expand <group>" while
  // collapsed, "Collapse <group>" while expanded (see GroupHeaderRow).
  it("renders a group collapsed when the saved arrangement says so", () => {
    renderWithPrefs(["g1"]);
    expect(screen.getByLabelText("Expand Group 1")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("renders the group expanded when nothing is saved", () => {
    renderWithPrefs([]);
    expect(screen.getByLabelText("Collapse Group 1")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("toggles a saved-collapsed group back open on click", async () => {
    const user = userEvent.setup();
    renderWithPrefs(["g1"]);
    await user.click(screen.getByLabelText("Expand Group 1"));
    expect(screen.getByLabelText("Collapse Group 1")).toBeInTheDocument();
  });
});
```

Use whichever `screen` / `userEvent` imports the file already has rather than adding duplicates.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/boards/BoardTable.test.tsx`
Expected: FAIL — the group renders expanded regardless of the provider.

- [ ] **Step 3: Make GroupSection take collapse as props**

In `src/components/boards/table/GroupSection.tsx`, delete line 88:

```ts
const [collapsed, setCollapsed] = useState(false);
```

Add to the destructured props and to the props type:

```ts
  collapsed,
  onToggleCollapse,
```

```ts
  /** Owned by BoardTableInner so the whole set is addressable and persistable. */
  collapsed: boolean;
  onToggleCollapse: () => void;
```

Change the `GroupHeaderRow` call site (lines 195-196) from the inline setter to the prop:

```tsx
collapsed = { collapsed };
onToggleCollapse = { onToggleCollapse };
```

Everything else in the file that reads `collapsed` (lines 226, 261) keeps working unchanged.

- [ ] **Step 4: Own the set in BoardTableInner**

In `src/components/boards/table/BoardTableInner.tsx`, add the import:

```ts
import { useBoardViewPrefs } from "@/lib/boards/view-prefs-context";
```

Replace the local expansion state at line 134:

```ts
const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
```

with the shared, persisted state:

```ts
// Collapse + expansion are per-user, per-board arrangement, owned by the
// view-prefs provider so they survive a reload and follow the user across
// devices. Toggles are local-first; the provider debounces the write.
const {
  collapsedGroups,
  expandedItems: expanded,
  toggleGroupCollapsed,
  toggleItemExpanded,
  pruneTo,
} = useBoardViewPrefs();
```

Replace the `toggleExpand` callback (lines 195-207) with:

```ts
const toggleExpand = toggleItemExpanded;
```

- [ ] **Step 5: Prune remembered ids against the live board**

Still in `BoardTableInner.tsx`, add after the cache destructuring (`const { board, groups, columns, items, cellValues } = cache;`):

```ts
// Groups and items get deleted while their ids sit in a saved arrangement.
// Intersect against what the board actually holds, so a dead id has no effect
// and falls out of the stored row the first time the user opens the board.
const groupIdsKey = groups.map((g) => g.id).join(",");
const itemIdsKey = items.map((i) => i.id).join(",");
useEffect(() => {
  pruneTo({
    groupIds: groupIdsKey ? groupIdsKey.split(",") : [],
    itemIds: itemIdsKey ? itemIdsKey.split(",") : [],
  });
  // Keyed on the joined id strings so this runs when the board's membership
  // changes, not on every re-render that rebuilds the arrays.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [groupIdsKey, itemIdsKey]);
```

Add `useEffect` to the React import if it is not already there (it is, at line 5).

- [ ] **Step 6: Pass collapse down at the GroupSection call site**

In the `<GroupSection …>` element (around line 688), add two props next to the existing `expanded` / `onToggleExpand` pair:

```tsx
                    collapsed={collapsedGroups.has(group.id)}
                    onToggleCollapse={() => toggleGroupCollapsed(group.id)}
```

- [ ] **Step 7: Share the expansion set in Gantt**

In `src/components/boards/GanttBoard.tsx`, add the import:

```ts
import { useBoardViewPrefs } from "@/lib/boards/view-prefs-context";
```

Replace lines 261-270 (the local `expanded` state and its `toggleExpand`) with:

```ts
// Shared with the table view through the view-prefs provider: expanding a row
// here and switching to Table shows it expanded there too, and both survive a
// reload. (This replaces the local, deliberately-unpersisted copy.)
const { expandedItems: expanded, toggleItemExpanded: toggleExpand } =
  useBoardViewPrefs();
```

Delete the now-unused `useState` / `useCallback` imports only if nothing else in the file uses them — check first.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run src/components/boards/BoardTable.test.tsx`
Expected: PASS.

- [ ] **Step 9: Verify the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/boards/table/GroupSection.tsx src/components/boards/table/BoardTableInner.tsx src/components/boards/GanttBoard.tsx src/components/boards/BoardTable.test.tsx
git commit -m "feat(boards): persist group collapse and row expansion per user"
```

---

### Task 6: Seed and persist the filter

**Files:**

- Modify: `src/lib/boards/use-board-filter-sort.ts`
- Rename: `src/lib/boards/use-board-filter-sort.test.ts` → `.test.tsx` (the new wrapper is JSX)
- Test: `src/lib/boards/use-board-filter-sort.test.tsx`

**Interfaces:**

- Consumes: `useBoardViewPrefs` from Task 3 (`initialFilterQuery`, `setFilterQuery`), and the existing `parseBoardFilter` / `serializeBoardFilter` / `FILTER_PARAM_KEYS` from `src/lib/boards/board-filter.ts`.
- Produces: no signature change. `useBoardFilterSort()` returns the same object; it merely starts from the saved filter when the URL carries none.

- [ ] **Step 1: Rename the test file**

The new wrapper is a JSX component, so the file must be `.tsx`:

```bash
git mv src/lib/boards/use-board-filter-sort.test.ts src/lib/boards/use-board-filter-sort.test.tsx
```

- [ ] **Step 2: Write the failing tests**

Add to `src/lib/boards/use-board-filter-sort.test.tsx`. It needs the provider and the empty-prefs constant:

```ts
import { BoardViewPrefsProvider } from "@/lib/boards/view-prefs-context";
import { EMPTY_BOARD_VIEW_PREFS } from "@/lib/validations/view-prefs";

vi.mock("@/lib/boards/view-prefs-actions", () => ({
  saveBoardViewPrefs: vi.fn(async () => ({ ok: true, data: undefined })),
}));
```

The existing file mocks `next/navigation` with an empty `URLSearchParams`; add a second describe block that also wraps the hook in the prefs provider:

```tsx
describe("useBoardFilterSort saved-filter seeding", () => {
  const BOARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function wrapWithPrefs(filterQuery: string) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <BoardViewPrefsProvider
          boardId={BOARD}
          initial={{ ...EMPTY_BOARD_VIEW_PREFS, filterQuery }}
        >
          {children}
        </BoardViewPrefsProvider>
      );
    };
  }

  beforeEach(() => {
    window.history.replaceState(null, "", "/boards/x");
  });

  it("seeds state from the saved filter when the URL carries none", () => {
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: wrapWithPrefs("q=hello"),
    });
    expect(result.current.state.q).toBe("hello");
    expect(result.current.isActive).toBe(true);
  });

  it("writes the saved filter into the URL on mount", () => {
    renderHook(() => useBoardFilterSort(), {
      wrapper: wrapWithPrefs("q=hello"),
    });
    expect(window.location.search).toContain("q=hello");
  });

  it("does not resurrect the saved filter after clearAll", () => {
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: wrapWithPrefs("q=hello"),
    });
    act(() => {
      result.current.clearAll();
    });
    expect(result.current.state.q).toBe("");
  });

  it("leaves the URL filter alone when one is present", () => {
    // The mocked useSearchParams returns the URL's params for this case.
    window.history.replaceState(null, "", "/boards/x?q=fromurl");
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: wrapWithPrefs("q=saved"),
    });
    expect(result.current.state.q).not.toBe("saved");
  });
});
```

The existing mock returns a fixed empty `URLSearchParams`. Change it to read from `window.location` so both the old and the new tests stay honest:

```ts
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
```

Verify the existing debounce tests in the file still pass with that change; they set `window.location` to `/` in `beforeEach`, so they will.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run src/lib/boards/use-board-filter-sort.test.tsx`
Expected: FAIL — the saved filter is ignored.

- [ ] **Step 4: Implement seeding**

In `src/lib/boards/use-board-filter-sort.ts`, add the import:

```ts
import { useBoardViewPrefs } from "@/lib/boards/view-prefs-context";
```

Inside the hook, above the existing `raw` computation:

```ts
const { initialFilterQuery, setFilterQuery } = useBoardViewPrefs();

// True once this session has written the filter URL even once. Load-bearing:
// clearing a filter empties the URL, which looks identical to a fresh visit,
// so a naive "empty URL means use the saved filter" rule would resurrect the
// filter the user just cleared. After the first write the URL is
// authoritative and an empty URL means an empty filter.
const hasWritten = useRef(false);
const urlHasFilter = FILTER_PARAM_KEYS.some((k) => searchParams.get(k));
const useSaved =
  !hasWritten.current && !urlHasFilter && initialFilterQuery !== "";
```

Change the `state` memo to fall back to the saved query:

```ts
const state = useMemo<BoardFilterState>(
  () =>
    useSaved
      ? parseBoardFilter(new URLSearchParams(initialFilterQuery))
      : parseBoardFilter(searchParams),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [raw, useSaved, initialFilterQuery],
);
```

Mark the ref and persist inside `write`:

```ts
const write = useCallback(
  (next: BoardFilterState, opts?: { replace?: boolean }) => {
    hasWritten.current = true;
    const url = new URL(window.location.href);
    const updates = serializeBoardFilter(next);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    if (opts?.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);

    // Remember the filter for the next visit. Only the filter params are
    // stored — never `view` or `item`, which are navigation, not arrangement.
    const keep = new URLSearchParams();
    for (const key of FILTER_PARAM_KEYS) {
      const value = url.searchParams.get(key);
      if (value) keep.set(key, value);
    }
    setFilterQuery(keep.toString());
  },
  [setFilterQuery],
);
```

Add a mount effect that writes the seeded filter into the URL, so the address bar matches what is rendered and a copied link carries the filter:

```ts
// Reflect the seeded filter into the URL once, with replaceState so it does
// not add a back-stack entry. Runs only when the saved filter is what seeded
// this render.
const seeded = useRef(false);
useEffect(() => {
  if (seeded.current || !useSaved) return;
  seeded.current = true;
  const url = new URL(window.location.href);
  for (const [key, value] of new URLSearchParams(initialFilterQuery)) {
    url.searchParams.set(key, value);
  }
  window.history.replaceState(null, "", url);
}, [useSaved, initialFilterQuery]);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/boards/use-board-filter-sort.test.tsx`
Expected: PASS, including the pre-existing debounce tests.

- [ ] **Step 6: Verify the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/use-board-filter-sort.ts src/lib/boards/use-board-filter-sort.test.tsx
git commit -m "feat(boards): remember the last filter and sort per user"
```

---

### Task 7: RLS isolation test

**Files:**

- Create: `src/lib/boards/view-prefs.rls.integration.test.ts`

**Interfaces:**

- Consumes: the table and RPC from Task 1; the existing helpers `integrationTargetReady`, `loadIntegrationEnv` from `@/test/integration-env` and `signInWithRetry` from `@/test/integration-auth`.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the test**

Model it on `src/lib/boards/board-lists.rls.integration.test.ts` — read that file first and copy its user/org/board fixture setup verbatim rather than inventing a new one. The suite must be guarded with `describe.skipIf(!integrationTargetReady())` so it skips unless `PULSE_TEST_DB` is set.

Assertions to pin:

```ts
it("stores and reads back the owner's own arrangement", async () => {
  const { error } = await owner.anon.rpc("save_board_view_prefs", {
    p_board_id: owner.boardId,
    p_state: { collapsedGroupIds: [owner.groupId] },
  });
  expect(error).toBeNull();

  const { data } = await owner.anon
    .from("board_view_prefs")
    .select("state")
    .eq("board_id", owner.boardId)
    .maybeSingle();
  expect(data?.state).toEqual({ collapsedGroupIds: [owner.groupId] });
});

it("a second user cannot read the first user's arrangement", async () => {
  const { data } = await other.anon
    .from("board_view_prefs")
    .select("state")
    .eq("board_id", owner.boardId);
  expect(data).toEqual([]);
});

it("a second user cannot overwrite the first user's row", async () => {
  // The RPC always writes auth.uid()'s own row, so this creates a SEPARATE row
  // rather than clobbering. Assert the owner's row is untouched.
  await other.anon.rpc("save_board_view_prefs", {
    p_board_id: owner.boardId,
    p_state: { collapsedGroupIds: [] },
  });
  const { data } = await owner.anon
    .from("board_view_prefs")
    .select("state")
    .eq("board_id", owner.boardId)
    .maybeSingle();
  expect(data?.state).toEqual({ collapsedGroupIds: [owner.groupId] });
});

it("a non-member cannot create a row for a board they cannot see", async () => {
  const { error } = await outsider.anon.rpc("save_board_view_prefs", {
    p_board_id: owner.boardId,
    p_state: {},
  });
  expect(error).not.toBeNull();
});
```

`other` is a second member of the same org; `outsider` is a user in a different org. Create both with the same `makeUser` helper the reference file uses.

- [ ] **Step 2: Run it**

Run: `PULSE_TEST_DB=1 pnpm vitest run src/lib/boards/view-prefs.rls.integration.test.ts`
Expected: PASS, 4 tests.

Then confirm it skips without the flag:

Run: `pnpm vitest run src/lib/boards/view-prefs.rls.integration.test.ts`
Expected: skipped.

- [ ] **Step 3: Commit**

```bash
git add src/lib/boards/view-prefs.rls.integration.test.ts
git commit -m "test(boards): RLS isolation for board_view_prefs"
```

---

## Closing the task

- [ ] Run all four gates from inside the worktree: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- [ ] Run `scripts/finish-task.sh` from inside the worktree. It rebases onto the latest `develop`, re-runs the gates against the merged state, merges, pushes and removes the worktree and branch.
- [ ] Hand the user a numbered "How to test this" walkthrough covering: collapse a group and reload; expand sub-items and reload; switch to Timeline and revisit the board with no query string; apply a filter, reload, then clear it and reload again; open the board in a second browser signed in as another user and confirm their arrangement is unaffected.
