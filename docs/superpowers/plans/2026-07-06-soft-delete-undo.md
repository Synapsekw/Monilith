# Soft-delete / Undo (`archived_at`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-deletes of boards, groups, and items with a reversible archive (`archived_at`), an immediate Undo toast, and a Trash surface with explicit permanent-purge — with zero archived-row leakage into any read, count, or aggregate.

**Architecture:** Additive nullable `archived_at`/`archived_by` columns + partial indexes. Deletes become archive-updates (cascade via `SECURITY INVOKER` RPCs for groups/items; O(1) for boards). Archived rows are filtered at the **application + aggregation-RPC layer** (RLS untouched, so restore/Trash can still read them). Realtime folds archive-UPDATEs as removals. Purge (manual, from Trash) reuses today's hard-delete bodies + Storage cleanup.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase Postgres + RLS, TanStack Query board cache, Supabase Realtime, sonner toasts, Zod, Vitest.

**Design spec:** `docs/superpowers/specs/2026-07-06-soft-delete-undo-design.md`

---

## File structure (what each unit owns)

| File                                                                                        | Responsibility                                                                                     | Task |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---- |
| `supabase/migrations/2026070613xxxx_soft_delete_archived_at.sql`                            | DDL, partial indexes, cascade archive/restore RPCs, archived-filter patches to 10 aggregation RPCs | 0    |
| `src/types/database.types.ts`                                                               | Regenerated types (adds `archived_at`/`archived_by`)                                               | 0    |
| `src/lib/validations/board-actions.ts`                                                      | Zod schemas for archive/restore/purge (+ bulk)                                                     | 1    |
| `src/lib/boards/actions.ts`                                                                 | `archiveBoard/Group/Item`, `restoreBoard/Group/Item`, `purgeBoard/Group/Item`                      | 1    |
| `src/lib/boards/bulk-actions.ts`                                                            | `bulkArchiveItems`, `bulkRestoreItems`, `bulkPurgeItems`                                           | 1    |
| `src/lib/boards/trash-queries.ts` (new)                                                     | Bounded reads of archived rows (per-board + workspace)                                             | 1    |
| ~14 reader files (§Task 2 list)                                                             | Add `archived_at is null` filter                                                                   | 2    |
| `src/lib/boards/realtime-buffer.ts`, `src/lib/boards/cache.ts`                              | Fold archive⇒remove, unarchive⇒insert                                                              | 3    |
| `src/lib/ui/mutation-toast.ts`                                                              | `showUndoToast(message, onUndo)`                                                                   | 4    |
| `src/lib/boards/use-board-mutations.ts`, `use-bulk-mutations.ts`                            | archive/restore mutations + undo wiring                                                            | 4    |
| `BoardItemMenu.tsx`, `BoardTable.tsx`, `BoardBulkBar.tsx`                                   | archive copy + fire undo toast                                                                     | 5    |
| `src/components/boards/trash/*` (new), board page wiring                                    | Per-board Trash dialog                                                                             | 6    |
| `/boards` page archived-boards section + `sidebar-nav-data.tsx`, `command-palette-data.tsx` | Workspace Trash + hide archived boards                                                             | 7    |
| `*.integration.test.ts` (new)                                                               | No-archived-leakage + lifecycle integration sweep                                                  | 8    |

---

## Task 0 — Migration, types, advisors (GATE — user-applied)

> **The agent cannot push migrations.** Author the SQL, then STOP and hand the file
> to the user to apply. After the user confirms it is applied, regenerate types and
> run advisors. All later tasks depend on this.

**Files:**

- Create: `supabase/migrations/2026070613xxxx_soft_delete_archived_at.sql`
- Modify (regenerated): `src/types/database.types.ts`

**Reference before writing:** `supabase/migrations/20260615061747_boards_core.sql`
(table + RLS + `create_item` shape), `supabase/migrations/20260702120000_perf_set_based_rls_and_indexes.sql`
(index style, `readable_board_ids()`), `supabase/migrations/20260704110000_dashboard_rpc_board_read_guards.sql`
(the aggregation RPC bodies to patch), `supabase/migrations/20260703120000_health_summary.sql`.

- [ ] **Step 1: Write the DDL — columns + partial indexes**

```sql
-- Soft-delete: archive instead of destroy for boards / groups / items.
-- archived_at null = live; non-null = archived. Filtered at the APP + RPC layer,
-- NOT in RLS (restore/Trash must still read archived rows). See spec §2.3.
alter table public.boards add column archived_at timestamptz,
  add column archived_by uuid references auth.users (id);
alter table public.groups add column archived_at timestamptz,
  add column archived_by uuid references auth.users (id);
alter table public.items  add column archived_at timestamptz,
  add column archived_by uuid references auth.users (id);

-- Hot "live rows" reads stay index-served (replaces the all-rows hot-path index).
create index if not exists items_board_position_live_idx
  on public.items (board_id, position) where archived_at is null;
create index if not exists groups_board_live_idx
  on public.groups (board_id) where archived_at is null;
create index if not exists boards_created_by_live_idx
  on public.boards (created_by) where archived_at is null;

-- Cold Trash reads.
create index if not exists items_board_archived_idx
  on public.items (board_id) where archived_at is not null;
create index if not exists groups_board_archived_idx
  on public.groups (board_id) where archived_at is not null;
```

- [ ] **Step 2: Write the cascade archive/restore RPCs (SECURITY INVOKER — respect RLS)**

```sql
-- Archive an item + its live subitems with one shared timestamp; returns count.
create or replace function public.archive_item(p_item_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_ts timestamptz := now(); v_uid uuid := (select auth.uid()); v_n int;
begin
  update public.items set archived_at = v_ts, archived_by = v_uid
   where (id = p_item_id or parent_id = p_item_id) and archived_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

-- Restore an item: clear only the set archived in the SAME batch (matching ts).
create or replace function public.restore_item(p_item_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_ts timestamptz; v_n int;
begin
  select archived_at into v_ts from public.items where id = p_item_id;
  if v_ts is null then return 0; end if;
  update public.items set archived_at = null, archived_by = null
   where (id = p_item_id or parent_id = p_item_id) and archived_at = v_ts;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

-- Archive a group + its live items (+ their subitems) with one shared timestamp.
create or replace function public.archive_group(p_group_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_ts timestamptz := now(); v_uid uuid := (select auth.uid()); v_n int;
begin
  update public.groups set archived_at = v_ts, archived_by = v_uid
   where id = p_group_id and archived_at is null;
  update public.items set archived_at = v_ts, archived_by = v_uid
   where group_id = p_group_id and archived_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

create or replace function public.restore_group(p_group_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_ts timestamptz; v_n int;
begin
  select archived_at into v_ts from public.groups where id = p_group_id;
  if v_ts is null then return 0; end if;
  update public.groups set archived_at = null, archived_by = null where id = p_group_id;
  update public.items set archived_at = null, archived_by = null
   where group_id = p_group_id and archived_at = v_ts;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

revoke execute on function public.archive_item(uuid), public.restore_item(uuid),
  public.archive_group(uuid), public.restore_group(uuid) from public;
grant execute on function public.archive_item(uuid), public.restore_item(uuid),
  public.archive_group(uuid), public.restore_group(uuid) to authenticated;
```

- [ ] **Step 3: Patch the 10 aggregation RPCs to exclude archived items**

For each function below, re-`create or replace` it with the current body plus a
`and i.archived_at is null` (or `<alias>.archived_at is null`) predicate on every
`public.items` scan. Copy each body verbatim from its latest migration and add the
predicate — do not otherwise change behavior.

- `dashboard_aggregate`, `dashboard_list_rows`, `dashboard_series`,
  `dashboard_completion`, `dashboard_health_summary` — from
  `20260704110000_dashboard_rpc_board_read_guards.sql`.
- `_board_health_flags`, `_board_health_counts` — from `20260703120000_health_summary.sql`.
- `portfolio_rollup` — `20260621071929_portfolios.sql`.
- `workload_rollup` — `20260622160000_workload.sql`; `workload_actuals_rollup` — `20260622170000_workload_actuals.sql`.
- `goals_rollup` — `20260621160000_goals.sql`.
- `create_item` — `20260615061747_boards_core.sql`: its `max(position)` seed read
  must add `and archived_at is null` so a new item's position ignores archived rows.

```sql
-- Example shape (dashboard_aggregate): add the predicate to the items scan.
--   from public.items i
--   where i.board_id = p_board_id
--     and i.parent_id is null
--     and i.archived_at is null        -- << added
```

- [ ] **Step 4: STOP — hand the migration to the user to apply**

Print: "Migration `2026070613xxxx_soft_delete_archived_at.sql` is written. Please
apply it (supabase db push / your apply flow) and confirm — I cannot push migrations."
Do not proceed until the user confirms.

- [ ] **Step 5: Regenerate types + run advisors (after user confirms applied)**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` now has `archived_at: string | null` and
`archived_by: string | null` on `boards`, `groups`, `items` Row/Insert/Update; new
RPCs typed in `Functions`.
Then run Supabase advisors (security + performance); expected: no new warnings.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/2026070613xxxx_soft_delete_archived_at.sql src/types/database.types.ts
git commit -m "feat(db): add archived_at soft-delete columns, cascade RPCs, aggregation filters"
```

**Interfaces:**

- Consumes: nothing (root).
- Produces: `boards/groups/items.archived_at`, `.archived_by`; partial indexes;
  RPCs `archive_item`, `restore_item`, `archive_group`, `restore_group`; archived-safe
  aggregation RPCs; regenerated `database.types.ts` (adds the fields to `Tables<...>`).

---

## Task 1 — Server mutations: archive / restore / purge (+ bulk + Zod + Trash reads)

**Files:**

- Modify: `src/lib/validations/board-actions.ts`
- Modify: `src/lib/boards/actions.ts:186-219` (deleteBoard), `:358-376` (deleteGroup), `:471-501` (deleteItem)
- Modify: `src/lib/boards/bulk-actions.ts:53-66`
- Create: `src/lib/boards/trash-queries.ts`
- Test: `src/lib/boards/actions.test.ts`, `src/lib/boards/bulk-actions.test.ts`

- [ ] **Step 1: Add Zod schemas**

In `board-actions.ts`, alongside `deleteBoardSchema` etc:

```ts
export const archiveBoardSchema = z.object({ boardId: uuid });
export const restoreBoardSchema = z.object({ boardId: uuid });
export const purgeBoardSchema = z.object({ boardId: uuid });
export const archiveGroupSchema = z.object({ groupId: uuid });
export const restoreGroupSchema = z.object({ groupId: uuid });
export const purgeGroupSchema = z.object({ groupId: uuid });
export const archiveItemSchema = z.object({ itemId: uuid });
export const restoreItemSchema = z.object({ itemId: uuid });
export const purgeItemSchema = z.object({ itemId: uuid });
export const bulkArchiveItemsSchema = z.object({ itemIds: bulkItemIds });
export const bulkRestoreItemsSchema = z.object({ itemIds: bulkItemIds });
export const bulkPurgeItemsSchema = z.object({ itemIds: bulkItemIds });
```

- [ ] **Step 2: Write failing tests for archive/restore/purge (mocked Supabase)**

Extend `actions.test.ts` (follow its existing mock setup — `createClient` returning
`{ from, auth, rpc }`, `getBoardAccess` mock defaulting `"owner"`):

```ts
it("archiveItem calls archive_item RPC, never .delete()", async () => {
  rpc.mockResolvedValue({ data: 1, error: null });
  const res = await archiveItem({ itemId: ITEM });
  expect(res.ok).toBe(true);
  expect(rpc).toHaveBeenCalledWith("archive_item", { p_item_id: ITEM });
  expect(del).not.toHaveBeenCalled();
});

it("purgeBoard hard-deletes and frees storage, owner-only", async () => {
  getBoardAccess.mockResolvedValue("editor");
  const res = await purgeBoard({ boardId: BOARD });
  expect(res.ok).toBe(false); // non-owner blocked
});
```

Run: `pnpm vitest run src/lib/boards/actions.test.ts`
Expected: FAIL (functions not defined).

- [ ] **Step 3: Implement archive/restore in `actions.ts`**

Replace the hard-delete bodies. `archiveItem`/`archiveGroup` call the RPCs;
`archiveBoard` is an O(1) update; restores mirror them.

```ts
export async function archiveItem(input: {
  itemId: string;
}): Promise<ActionResult> {
  const parsed = archiveItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_item", {
    p_item_id: parsed.data.itemId,
  });
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}
export async function restoreItem(input: {
  itemId: string;
}): Promise<ActionResult> {
  const parsed = restoreItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_item", {
    p_item_id: parsed.data.itemId,
  });
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}
// archiveGroup/restoreGroup: same shape, rpc "archive_group"/"restore_group", p_group_id.

export async function archiveBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = archiveBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const access = await getBoardAccess(parsed.data.boardId);
  if (access !== "owner")
    return fail("Only the board owner can delete this board.");
  const supabase = await createClient();
  const user = await getUser();
  const { error } = await supabase
    .from("boards")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: user?.id ?? null,
    })
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);
  await invalidateMyBoards();
  return { ok: true, data: undefined };
}
// restoreBoard: same guard, update archived_at:null, archived_by:null, invalidateMyBoards().
```

- [ ] **Step 4: Implement purge (the OLD delete bodies + storage cleanup)**

`purgeItem`/`purgeGroup`/`purgeBoard` are the current `deleteItem`/`deleteGroup`/
`deleteBoard` bodies (hard `.delete()` + `removeAttachmentObjects`), with an added
guard that the row is already archived. `purgeGroup` must also gather + free
attachment objects for its items before the cascade (mirror `deleteBoard`'s
attachment query on `board_id`, narrowed to the group's item ids).

```ts
export async function purgeItem(input: {
  itemId: string;
}): Promise<ActionResult> {
  const parsed = purgeItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  // Must be archived first (Trash-only). Gather storage paths (item + subitems),
  // hard-delete (FK cascade), then free objects — exactly today's deleteItem body.
  const { data: subitems } = await supabase
    .from("items")
    .select("id")
    .eq("parent_id", parsed.data.itemId);
  const itemIds = [parsed.data.itemId, ...(subitems ?? []).map((s) => s.id)];
  const { data: attachments } = await supabase
    .from("attachments")
    .select("storage_path")
    .in("item_id", itemIds);
  const { data, error } = await supabase
    .from("items")
    .delete()
    .eq("id", parsed.data.itemId)
    .not("archived_at", "is", null)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Item not found or not archived.");
  await removeAttachmentObjects((attachments ?? []).map((a) => a.storage_path));
  return { ok: true, data: undefined };
}
// purgeBoard: today's deleteBoard body + `.not("archived_at","is",null)` guard.
```

- [ ] **Step 5: Update `bulk-actions.ts`**

Replace `bulkDeleteItems` with `bulkArchiveItems` (reuse `archiveItem` per id via
`runBulk`), add `bulkRestoreItems` (reuse `restoreItem`) and `bulkPurgeItems`
(reuse `purgeItem`). Remove the `archived_at`-can't-apply comment at `:53-55`.

- [ ] **Step 6: Create `trash-queries.ts` (bounded archived reads)**

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

/** Archived groups + items for a board (per-board Trash). Bounded + indexed. */
export async function getBoardTrash(boardId: string): Promise<{
  groups: Tables<"groups">[];
  items: Tables<"items">[];
}> {
  const supabase = await createClient();
  const [g, i] = await Promise.all([
    supabase
      .from("groups")
      .select("*")
      .eq("board_id", boardId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(200),
    supabase
      .from("items")
      .select("*")
      .eq("board_id", boardId)
      .is("parent_id", null)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(200),
  ]);
  if (g.error) throw new Error(g.error.message);
  if (i.error) throw new Error(i.error.message);
  return { groups: g.data ?? [], items: i.data ?? [] };
}

/** Archived boards the current user owns (workspace Trash). */
export async function getArchivedBoards(): Promise<
  Pick<Tables<"boards">, "id" | "name" | "workspace_id" | "archived_at">[]
> {
  /* created_by = me, archived_at not null, limit 200 */
}
```

- [ ] **Step 7: Run tests, then commit**

Run: `pnpm vitest run src/lib/boards/actions.test.ts src/lib/boards/bulk-actions.test.ts`
Expected: PASS.

```bash
git add src/lib/validations/board-actions.ts src/lib/boards/actions.ts src/lib/boards/bulk-actions.ts src/lib/boards/trash-queries.ts src/lib/boards/actions.test.ts src/lib/boards/bulk-actions.test.ts
git commit -m "feat(boards): archive/restore/purge server actions replace hard delete"
```

**Interfaces:**

- Consumes (Task 0): RPCs `archive_item`/`restore_item`/`archive_group`/`restore_group`; `archived_at`/`archived_by` types.
- Produces: `archiveBoard/Group/Item`, `restoreBoard/Group/Item`, `purgeBoard/Group/Item`, `bulkArchiveItems/bulkRestoreItems/bulkPurgeItems`, `getBoardTrash`, `getArchivedBoards`; the Zod schemas.

---

## Task 2 — Read-path archived filters (no leakage)

**Files (each gains `.is("archived_at", null)` on its items/groups/boards reads):**

- `src/lib/boards/queries.ts` — `getBoardPayload` items `:182-187`, groups `:169-173`,
  relation-name items `:262-265`; `listMyBoards` `:54-58`; `listSharedBoards` `boards!inner` (filter in JS or `.is` on the embed).
- `src/lib/boards/queries-cached.ts` — `listMyBoardsCached` `:22-27`, `listSharedBoardsCached` `:51-55`.
- `src/lib/my-work/queries.ts` — items `:98-102`, boards `:103`.
- `src/lib/time/queries.ts` — items `:81-84`, `searchAllocatableItems` `:114-119`.
- `src/lib/search/item-search.ts` — `:47-52`.
- `src/lib/boards/relation-candidates.ts` — `listRelationCandidates` `:50-55`, `listRelationTargetBoards` `:68-71`.
- `src/app/(app)/dashboards/[dashboardId]/page.tsx` — board picker `:31-40`.
- `src/lib/dashboards/widget-resolve.ts` / `queries-cached.ts` — the `groups` reads
  in completion resolvers (`.is("archived_at", null)`); item counting is already
  handled by the patched RPCs (Task 0).
- `src/lib/ai/board-snapshot.ts` — no read, but ensure callers pass a filtered items array.

- [ ] **Step 1: Write a failing integration test asserting no archived leakage**

Create `src/lib/boards/archived-reads.integration.test.ts` (follow existing
`*.integration.test.ts` real-DB pattern): seed a board with 1 live + 1 archived item;
assert `getBoardPayload(board).items` contains only the live id.

Run: `pnpm vitest run src/lib/boards/archived-reads.integration.test.ts`
Expected: FAIL (archived item present).

- [ ] **Step 2: Add the filter to each read above**

Example (`getBoardPayload` items read):

```ts
supabase.from("items").select("*").eq("board_id", boardId)
  .is("archived_at", null)                      // << added
  .order("position", { ascending: true }).limit(5000),
```

Apply the analogous `.is("archived_at", null)` to every read in the file list.

- [ ] **Step 3: Run the leakage test + full suite; commit**

Run: `pnpm vitest run src/lib/boards/archived-reads.integration.test.ts` → PASS.
Run: `pnpm typecheck`.

```bash
git add src/lib/boards/queries.ts src/lib/boards/queries-cached.ts src/lib/my-work/queries.ts src/lib/time/queries.ts src/lib/search/item-search.ts src/lib/boards/relation-candidates.ts "src/app/(app)/dashboards/[dashboardId]/page.tsx" src/lib/dashboards/widget-resolve.ts src/lib/dashboards/queries-cached.ts src/lib/boards/archived-reads.integration.test.ts
git commit -m "feat(boards): filter archived rows from all list/aggregate reads"
```

**Interfaces:**

- Consumes (Task 0): `archived_at` column + partial indexes + patched aggregation RPCs.
- Produces: archived-free reads across board payload, lists, dashboards, my-work, search, relations, time.

---

## Task 3 — Realtime + cache: fold archive as removal

**Files:**

- Modify: `src/lib/boards/realtime-buffer.ts:89-101` (`applyItem`), `:128-140` (`applyGroup`)
- Test: `src/lib/boards/realtime-buffer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it("folds an item UPDATE with archived_at set as a removal", () => {
  const prev = cacheWith({ items: [{ id: "i1", archived_at: null /*…*/ }] });
  const { next } = foldBoardEvents(prev, [
    {
      table: "items",
      payload: {
        eventType: "UPDATE",
        new: { id: "i1", archived_at: "2026-07-06T00:00:00Z" /*…*/ },
      },
    } as BoardRealtimeEvent,
  ]);
  expect(next.items.find((i) => i.id === "i1")).toBeUndefined();
});
it("folds an unarchive UPDATE (archived_at null) as an insert", () => {
  /* item reappears */
});
```

Run: `pnpm vitest run src/lib/boards/realtime-buffer.test.ts` → FAIL.

- [ ] **Step 2: Update `applyItem` / `applyGroup`**

```ts
function applyItem(
  prev: BoardCache,
  p: RealtimePostgresChangesPayload<CacheItem>,
): BoardCache {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheItem>;
    return { ...prev, items: prev.items.filter((i) => i.id !== oldRow.id) };
  }
  const row = p.new as CacheItem;
  if (row.archived_at != null) return removeItem(prev, row.id); // archive ⇒ remove (+cascade)
  return prev.items.some((i) => i.id === row.id)
    ? replaceItem(prev, row)
    : insertItem(prev, row);
}
// applyGroup: mirror — archived_at != null ⇒ removeGroup(prev, row.id).
```

(Import `removeItem`, `removeGroup` from `@/lib/boards/cache`.)

- [ ] **Step 3: Run tests + commit**

Run: `pnpm vitest run src/lib/boards/realtime-buffer.test.ts` → PASS.

```bash
git add src/lib/boards/realtime-buffer.ts src/lib/boards/realtime-buffer.test.ts
git commit -m "feat(boards): realtime folds archive UPDATE as removal, unarchive as insert"
```

**Interfaces:**

- Consumes (Task 0): `archived_at` on `CacheItem`/`CacheGroup` (via regenerated types).
- Produces: realtime-correct archive/undo across peers (archived rows leave every open board).

---

## Task 4 — Optimistic mutations + Undo toast

**Files:**

- Modify: `src/lib/ui/mutation-toast.ts`
- Modify: `src/lib/boards/use-board-mutations.ts` (delete mutations `:629-653`, `:797-821`; API `:1269`, `:1281`)
- Modify: `src/lib/boards/use-bulk-mutations.ts` (`deleteMutation` `:54-80`)
- Test: `src/lib/boards/use-board-mutations.test.tsx`

- [ ] **Step 1: Add `showUndoToast`**

```ts
import { toast } from "sonner";
/** Success toast with an Undo action for a reversible destructive op (archive). */
export function showUndoToast(message: string, onUndo: () => void): void {
  toast(message, {
    action: { label: "Undo", onClick: onUndo },
    duration: 8000,
  });
}
```

- [ ] **Step 2: Write failing hook test (extend the existing `vi.mock("sonner")`)**

Mock `toast` to capture the base call; assert archiving an item removes it
optimistically AND fires a toast whose `action.onClick` calls `restoreItem`.

```ts
it("archiveItem removes optimistically and offers Undo that restores", async () => {
  const { result } = renderHook(() => useBoardMutations(BOARD), { wrapper });
  act(() => result.current.archiveItem("i1"));
  await waitFor(() =>
    expect(archiveItemAction).toHaveBeenCalledWith({ itemId: "i1" }),
  );
  expect(capturedToast.action.label).toBe("Undo");
  act(() => capturedToast.action.onClick());
  await waitFor(() =>
    expect(restoreItemAction).toHaveBeenCalledWith({ itemId: "i1" }),
  );
});
```

Run: `pnpm vitest run src/lib/boards/use-board-mutations.test.tsx` → FAIL.

- [ ] **Step 3: Rename delete mutations to archive; wire undo**

Replace `deleteItemMutation`/`deleteGroupMutation` server calls with `archiveItem`/
`archiveGroup`. Keep the optimistic `removeItem`/`removeGroup` + `resyncOnError`. On
success, fire `showUndoToast`:

```ts
const archiveItemMutation = useMutation<
  unknown,
  Error,
  { itemId: string },
  Ctx
>({
  mutationFn: async (v) => {
    const r = await archiveItem(v);
    if (!r.ok) throw new Error(r.error);
    return r;
  },
  onMutate: async (v) => {
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<BoardCache>(key);
    if (prev) qc.setQueryData(key, removeItem(prev, v.itemId));
    return {};
  },
  onError: (err) => {
    resyncOnError();
    showMutationError("Couldn't delete the item — it was restored.", err);
  },
  onSuccess: (_d, v) =>
    showUndoToast("Item moved to Trash", () => restoreItemMutation.mutate(v)),
});
// restoreItemMutation: calls restoreItem; onSuccess resyncOnError() (rehydrate the restored subtree).
// Mirror for group. Expose archiveItem/archiveGroup/restoreItem/restoreGroup in the returned API,
// keeping deleteItem/deleteGroup names as aliases to archive* so callers need no rename (or rename callers in Task 5).
```

- [ ] **Step 4: Update `use-bulk-mutations.ts`**

`deleteMutation` → `archiveMutation` calling `bulkArchiveItems`; keep optimistic
`removeItem` reduce; on success fire one `showUndoToast("N items moved to Trash",
() => bulkRestore(ids))`.

- [ ] **Step 5: Run tests + commit**

Run: `pnpm vitest run src/lib/boards/use-board-mutations.test.tsx` → PASS.

```bash
git add src/lib/ui/mutation-toast.ts src/lib/boards/use-board-mutations.ts src/lib/boards/use-bulk-mutations.ts src/lib/boards/use-board-mutations.test.tsx
git commit -m "feat(boards): optimistic archive + Undo toast, restore wiring"
```

**Interfaces:**

- Consumes (Task 1): `archiveItem/Group`, `restoreItem/Group`, `bulkArchiveItems/bulkRestoreItems`. (Task 3): archive-fold behavior for peer consistency.
- Produces: `showUndoToast`; `archiveItem/archiveGroup/restoreItem/restoreGroup` on the mutations hook; bulk archive+undo.

---

## Task 5 — Delete-surface UI copy + undo wiring

**Files:**

- Modify: `src/components/boards/BoardItemMenu.tsx:7,87-99,177-203` (board delete → archive)
- Modify: `src/components/boards/BoardTable.tsx:872,1167-1197` (GroupMenu), `:2022,2191,1227-1254` (RowMenu)
- Modify: `src/components/boards/BoardBulkBar.tsx:186-224`
- Test: `BoardItemMenu.test.tsx`, `BoardTable*.test.tsx`, `BoardBulkBar.test.tsx`

- [ ] **Step 1: Update failing component tests**

Assert the confirm copy no longer says "permanently … cannot be undone" and that
confirming calls the archive path (and, for board, that an undo toast is offered).

- [ ] **Step 2: Update copy + handlers**

- `BoardItemMenu`: import `archiveBoard`/`restoreBoard`; `doDelete` calls `archiveBoard`;
  after success show `showUndoToast("Board moved to Trash", () => restoreBoard(...))`;
  AlertDialog copy → "Move this board to Trash? You can restore it from Trash." Keep
  the `router.push("/boards")` navigation.
- `BoardTable` GroupMenu/RowMenu: already call `deleteGroup`/`deleteItem` from the
  hook — repoint to `archiveGroup`/`archiveItem` (the hook fires the undo toast in
  Task 4). Update dialog copy to "Move to Trash". Leaf-item quick-delete stays (it
  now archives + toasts).
- `BoardBulkBar`: `bulk.bulkDelete` → `bulk.bulkArchive`; copy "Move {n} items to Trash".

- [ ] **Step 3: Run component tests + commit**

```bash
git add src/components/boards/BoardItemMenu.tsx src/components/boards/BoardTable.tsx src/components/boards/BoardBulkBar.tsx src/components/boards/BoardItemMenu.test.tsx src/components/boards/BoardBulkBar.test.tsx
git commit -m "feat(boards): delete menus archive + offer Undo instead of hard delete"
```

> **UI work:** load `pulse-ui` + `frontend-design` skills before styling any new
> control (working-agreement #3).

**Interfaces:**

- Consumes (Task 4): hook `archiveItem/archiveGroup`, `showUndoToast`, `archiveBoard/restoreBoard`, bulk archive.
- Produces: every delete affordance now archives with an Undo.

---

## Task 6 — Per-board Trash surface

**Files:**

- Create: `src/components/boards/trash/BoardTrashDialog.tsx`
- Modify: board header/menu to add a "Trash" entry that opens the dialog; board page passes `boardId`.
- Test: `src/components/boards/trash/BoardTrashDialog.test.tsx`

- [ ] **Step 1: Write failing component test**

Render the dialog with a mocked `getBoardTrash` result (1 archived group + 1 item);
assert both render; clicking Restore calls `restoreGroup`/`restoreItem`; clicking
Delete-permanently (with confirm) calls `purgeGroup`/`purgeItem`.

- [ ] **Step 2: Build the dialog**

A shadcn `Dialog` opened on demand (no RSC nav — off the board hot path). On open,
call `getBoardTrash(boardId)` (Server Action or route handler) into local state.
Rows: name + "archived {relative time} by {archived_by}"; actions Restore /
Delete-permanently (AlertDialog confirm) + an "Empty trash" purging all listed. On
restore/purge, optimistically drop the row from the dialog list; restore also
resyncs the board cache so the row reappears live.

- [ ] **Step 3: Run tests + commit**

```bash
git add src/components/boards/trash/BoardTrashDialog.tsx src/components/boards/trash/BoardTrashDialog.test.tsx src/components/boards/BoardTable.tsx
git commit -m "feat(boards): per-board Trash dialog (restore / permanently delete)"
```

**Interfaces:**

- Consumes (Task 1): `getBoardTrash`, `restoreGroup/restoreItem`, `purgeGroup/purgeItem`. (Task 2): board payload excludes restored-then-archived rows correctly.
- Produces: `BoardTrashDialog`.

---

## Task 7 — Workspace Trash (archived boards) + sidebar/palette hiding

**Files:**

- Modify: `src/app/(app)/boards/page.tsx` (add an "Archived boards" section using `getArchivedBoards`)
- Modify: `src/components/shell/sidebar-nav-data.tsx`, `src/components/shell/command-palette-data.tsx`, `src/app/home/page.tsx` (consume the already-filtered `listMyBoards`/`listSharedBoards` — verify no separate unfiltered read remains)
- Test: `src/app/(app)/boards/*.test.tsx` (or a query test for `getArchivedBoards`)

- [ ] **Step 1: Write failing test**

Assert `getArchivedBoards` returns only the current user's archived boards; assert
the sidebar/palette data excludes archived boards (they come via the Task 2 filters —
this test guards against a regressing direct read).

- [ ] **Step 2: Implement**

Add an "Archived boards" collapsible section on `/boards` listing `getArchivedBoards`
results with Restore (`restoreBoard`) / Delete-permanently (`purgeBoard`, owner-only,
AlertDialog confirm). Confirm sidebar/palette/home read only the filtered lists.

- [ ] **Step 3: Run tests + commit**

```bash
git add "src/app/(app)/boards/page.tsx" src/components/shell/sidebar-nav-data.tsx src/components/shell/command-palette-data.tsx src/app/home/page.tsx
git commit -m "feat(boards): archived-boards Trash section; hide archived from nav/palette"
```

**Interfaces:**

- Consumes (Task 1): `getArchivedBoards`, `restoreBoard`, `purgeBoard`. (Task 2): filtered board lists.
- Produces: workspace-level board Trash; archived boards absent from all nav.

---

## Task 8 — Integration & regression sweep + manual-test guide

**Files:**

- Create: `src/lib/boards/soft-delete-lifecycle.integration.test.ts`
- Create/extend: dashboard/health/rollup count tests asserting archived exclusion.

- [ ] **Step 1: Lifecycle integration test (real DB, RLS)**

Seed board→group→items(+subitems)+cells+attachment rows. Assert: archive item →
hidden from `getBoardPayload`, present in `getBoardTrash`; restore → reappears with
subitems; archive group → items hidden, restore → matching-batch items return but a
separately-archived item stays archived; archive board → absent from `listMyBoards`,
present in `getArchivedBoards`; purge item → gone + `removeAttachmentObjects` called;
cross-tenant user never sees another org's archived rows.

- [ ] **Step 2: No-archived-leakage aggregate test**

Seed 3 live + 2 archived items across statuses; assert `dashboard_aggregate`,
`dashboard_completion`, `_board_health_counts`, `workload_rollup`, `goals_rollup`,
`portfolio_rollup` all count only the 3 live items.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → all green.

- [ ] **Step 4: Commit + write the "How to test this" walkthrough**

```bash
git add src/lib/boards/soft-delete-lifecycle.integration.test.ts
git commit -m "test(boards): soft-delete lifecycle + no-archived-leakage integration sweep"
```

Manual-test guide (also into the `/wrapup` note):

1. Open a board → delete an item via the row ⋯ menu → it vanishes and a toast
   "Item moved to Trash — Undo" appears; click **Undo** → it returns.
2. Delete a group → same toast; let it expire → open the board **Trash** → the group
   - its items are listed → **Restore** → they return on the board.
3. In Trash → **Delete permanently** an item → confirm → it's gone and does not
   return after a refresh; its attachments are freed.
4. Delete a board from its ⋯ menu → it leaves the sidebar and ⌘K → open **Archived
   boards** on `/boards` → **Restore** → it returns to the sidebar.
5. Open a dashboard with count/health widgets → archive some items → the widget
   counts drop; restore → they come back. (Confirm no archived item is ever counted.)
6. Two browsers on the same board → archive in one → the row disappears in the other
   (realtime) → Undo in the first → it reappears in both.

**Interfaces:**

- Consumes: Tasks 1, 2, 3, 5, 6, 7.
- Produces: verified no-leakage + lifecycle guarantees; user acceptance guide.

---

## Execution DAG

**Dependency graph:**

- Task 0 → (root; everything depends on it)
- Task 1 depends on 0
- Task 2 depends on 0
- Task 3 depends on 0
- Task 4 depends on 1, 3
- Task 5 depends on 4
- Task 6 depends on 1, 2
- Task 7 depends on 1, 2
- Task 8 depends on 1, 2, 3, 5, 6, 7

**Parallel batches (waves of concurrent agents):**

- **Batch 0:** Task 0 (solo; user-applied migration gate — nothing else can start).
- **Batch A:** Task 1, Task 2, Task 3 (disjoint files: server mutations / read filters / realtime — run concurrently).
- **Batch B:** Task 4 (needs 1+3), Task 6 (needs 1+2), Task 7 (needs 1+2) — run concurrently.
- **Batch C:** Task 5 (needs 4).
- **Batch D:** Task 8 (integration; needs all).

Dispatch each batch with `superpowers:dispatching-parallel-agents`; tasks that
touch overlapping files (none within a batch here — verified disjoint) would need
isolated worktrees, but Batches A/B are file-disjoint by construction.

**Critical path (wall-clock floor):** `0 → 1 → 4 → 5 → 8` (5 nodes). Read filters
(2), realtime (3), and both Trash surfaces (6, 7) are all off the critical path and
finish alongside it.

---

## Performance & data-fetching budget

(Working-agreement #5.)

- **First paint (board):** items + groups reads add `.is('archived_at', null)`,
  served by the new `*_live_idx` partial indexes → **0 extra round-trips**, no added
  latency. Items read stays bounded (`limit 5000`).
- **Archive / restore / undo interactions:** they **change server data** → Server
  Action (+ RPC) with **optimistic cache patch + realtime fold**; **0 refetch on the
  happy path** (identical cost profile to today's delete). Undo = one restore Server
  Action; a large-group restore may do a single targeted `invalidateQueries` (rare).
- **Trash:** off the board hot path — a **dialog** (no `<Link>`/router nav), one
  bounded read (`archived_at is not null`, `limit 200`) over the Trash partial index.
  First paint pays nothing for Trash.
- **Aggregation RPCs:** same plans + one `archived_at is null` predicate served by
  the partial index — no new round-trips, no N+1.
- **No unbounded reads introduced.**

---

## Self-review notes

- **Spec coverage:** archive lifecycle (Tasks 0,1), undo toast (4,5), Trash + purge
  (1,6,7), no-leakage across TS + RPC reads (2,8), realtime (3), storage cleanup on
  purge only (1). Non-goal auto-retention cron explicitly omitted.
- **Type consistency:** `archived_at`/`archived_by` used uniformly; RPC names
  (`archive_item`/`restore_item`/`archive_group`/`restore_group`) and action names
  (`archive*`/`restore*`/`purge*`) consistent across tasks.
- **Migration gate:** Task 0 stops for user apply; type regen + advisors follow.
- **TDD:** every task writes a failing test first, then implements.
  </content>
