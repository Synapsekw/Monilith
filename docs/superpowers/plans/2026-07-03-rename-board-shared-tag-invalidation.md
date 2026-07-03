# Rename-Board Shared-Boards Cache Invalidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a board owner renames a board, invalidate the cached shared-boards list of every user the board is shared with, so recipients see the new name immediately instead of waiting out the cache TTL.

**Architecture:** `renameBoard` in `src/lib/boards/actions.ts` currently only busts the owner's own `boards:user:<owner>` tag (via `invalidateMyBoards()`) plus a `revalidatePath` for the board page. Recipients read the board name from `listSharedBoardsCached(userId)`, which is tagged `shared-boards:user:<userId>` (`sharedBoardsTag`). The fix: after the successful `boards` UPDATE, read the board's grantees from `board_members` (the RLS-scoped, cookie-bound client — the owner can already read those rows via `can_read_board`), and call `updateTag(sharedBoardsTag(user_id))` once per grantee. This mirrors the existing single-grantee pattern in `sharing-actions.ts` (`shareBoard`/`unshareBoard`) and `org/admin-actions.ts` (`removeMember` etc.), extended to fan out over _all_ current grantees.

**Tech Stack:** Next.js 16 App Router (Server Actions), Supabase (`@supabase/ssr` RLS-bound client), Next.js `updateTag`/`revalidatePath` cache API, Vitest.

## Global Constraints

- **Server Actions for mutations; RLS is the security boundary.** The grantee read uses the cookie-bound `createClient()` (RLS-enforced), NOT the service client — no cross-tenant leak, no service-role key on this path. Verbatim: `RLS is the security boundary — default-deny, org-scoped, no cross-tenant access.`
- **Cache-tag API is Next.js 16.** In a Server Action, immediate read-your-own-writes invalidation is `updateTag(tag)` (confirmed against `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/updateTag.md`). Do NOT switch to `revalidateTag` — its single-arg form is deprecated and its `"max"` form is stale-while-revalidate, not immediate. `updateTag` is already imported in `actions.ts`.
- **Cache tag strings come only from `src/lib/cache/tags.ts`.** Use the `sharedBoardsTag(userId)` builder — never inline the literal string in source. (`shared-boards:user:<userId>`.)
- **The grantee table is `board_members`** (columns include `board_id`, `user_id`; PK `(board_id, user_id)`), defined in `supabase/migrations/20260620100000_board_level_sharing.sql`. There is no separate `board_shares` table — "shared with" recipients ARE `board_members` rows. No schema change and no migration are required for this fix.
- **TypeScript strict; no `any`.** The grantee rows are typed from the generated Supabase types via the `from("board_members").select("user_id")` call — no casts needed.
- **Gates that must pass before done:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## File Structure

- **Modify:** `src/lib/boards/actions.ts`
  - Add `sharedBoardsTag` to the existing `@/lib/cache/tags` import (line ~6, currently imports only `boardsTag`).
  - Extend `renameBoard` (lines ~113–133) with the grantee fan-out after `invalidateMyBoards()` and before `revalidatePath`.
  - `invalidateMyBoards()` helper (lines ~61–64) is unchanged — the owner's own tag is still busted through it.
- **Modify (tests):** `src/lib/boards/actions.test.ts`
  - Add one new test asserting the recipient fan-out in the existing `describe("board mutation invalidation (boards tag)")` block (ends line ~593).
  - Update the existing `it("renameBoard updates the owner's boards tag")` test (lines ~541–551) so its `from` mock also answers `board_members` — otherwise the new source code's `from("board_members").select(...)` call hits the mock's `{}` fallback and throws.

This is a single, self-contained behavior change in one action plus its unit tests. No new files, no schema/type changes.

---

## Task 1: renameBoard fans out shared-boards invalidation to every grantee

**Files:**

- Modify: `src/lib/boards/actions.ts:6` (import), `src/lib/boards/actions.ts:113-133` (`renameBoard`)
- Test: `src/lib/boards/actions.test.ts` (new test in the `board mutation invalidation` describe; plus a fix to the existing `renameBoard updates the owner's boards tag` test)

**Interfaces:**

- Consumes:
  - `sharedBoardsTag(userId: string): string` from `@/lib/cache/tags` — returns `shared-boards:user:<userId>`.
  - `boardsTag(userId: string): string` from `@/lib/cache/tags` (already used via `invalidateMyBoards`).
  - `updateTag(tag: string): void` and `revalidatePath(path: string): void` from `next/cache` (both already imported).
  - `createClient()` from `@/lib/supabase/server` (already imported) — the RLS-bound client.
- Produces: no new exported symbol. `renameBoard(input: { boardId: string; name: string }): Promise<ActionResult>` keeps its exact signature and return shape (`{ ok: true, data: undefined }` on success). Only its cache-invalidation side effects grow.

- [ ] **Step 1: Write the failing test**

Add this test at the end of the existing `describe("board mutation invalidation (boards tag)", ...)` block in `src/lib/boards/actions.test.ts` (immediately after the `createBoardFromTemplate updates the owner's boards tag` test, before the block's closing `});`). It reuses the file's existing `A`, `B`, `BOARD` constants and the module-level `from`/`updateTag` mocks:

```ts
it("renameBoard invalidates every recipient's shared-boards tag", async () => {
  from.mockImplementation((t: string) => {
    if (t === "boards")
      return {
        update: () => ({ eq: async () => ({ error: null }) }),
      } as never;
    if (t === "board_members")
      return {
        select: () => ({
          eq: async () => ({
            data: [{ user_id: A }, { user_id: B }],
            error: null,
          }),
        }),
      } as never;
    return {} as never;
  });

  const res = await renameBoard({ boardId: BOARD, name: "New" });

  expect(res.ok).toBe(true);
  // Owner's own list is still invalidated (via invalidateMyBoards).
  expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
  // Each grantee's shared-boards list is invalidated so the rename shows up
  // for them immediately instead of after the nav TTL.
  expect(updateTag).toHaveBeenCalledWith(`shared-boards:user:${A}`);
  expect(updateTag).toHaveBeenCalledWith(`shared-boards:user:${B}`);
});
```

- [ ] **Step 2: Run the new test and the existing rename test to verify the new one fails**

Run: `pnpm vitest run src/lib/boards/actions.test.ts -t "renameBoard"`
Expected: The new `invalidates every recipient's shared-boards tag` FAILS — `updateTag` was never called with `shared-boards:user:...` (current source only busts the owner's `boards:` tag). The pre-existing `renameBoard updates the owner's boards tag` still PASSES at this point (source hasn't changed yet).

- [ ] **Step 3: Add `sharedBoardsTag` to the tags import in the source**

In `src/lib/boards/actions.ts`, change the cache-tags import (currently line ~6):

```ts
import { boardsTag } from "@/lib/cache/tags";
```

to:

```ts
import { boardsTag, sharedBoardsTag } from "@/lib/cache/tags";
```

- [ ] **Step 4: Add the grantee fan-out to `renameBoard`**

In `src/lib/boards/actions.ts`, replace the body of `renameBoard` (lines ~113–133) with:

```ts
export async function renameBoard(input: {
  boardId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("boards")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);

  await invalidateMyBoards();

  // Recipients read this board's name from their cached shared-boards list
  // (`shared-boards:user:<id>`, served by listSharedBoardsCached). A rename must
  // drop THEIR entry too, or they keep the stale name until the nav TTL expires.
  // Fan out over every board_members grantee — this read is RLS-scoped to the
  // board the owner can already read, and returns non-owner members.
  const { data: members } = await supabase
    .from("board_members")
    .select("user_id")
    .eq("board_id", parsed.data.boardId);
  for (const m of members ?? []) updateTag(sharedBoardsTag(m.user_id));

  // The board name also shows on the board page's own (uncached) header; the
  // sidebar list is served from the `boards:user:<me>` cache invalidateMyBoards expired.
  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, data: undefined };
}
```

- [ ] **Step 5: Fix the pre-existing `renameBoard updates the owner's boards tag` test**

The new source now calls `from("board_members")`, so that test's mock — which only answers `"boards"` and returns `{}` for everything else — would make `.select("user_id")` throw. Update its `from` mock (lines ~541–551) to also answer `board_members` with an empty grantee list:

```ts
it("renameBoard updates the owner's boards tag", async () => {
  from.mockImplementation((t: string) => {
    if (t === "boards")
      return {
        update: () => ({ eq: async () => ({ error: null }) }),
      } as never;
    if (t === "board_members")
      return {
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      } as never;
    return {} as never;
  });
  const res = await renameBoard({ boardId: BOARD, name: "New" });
  expect(res.ok).toBe(true);
  expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
});
```

- [ ] **Step 6: Run the rename tests to verify they all pass**

Run: `pnpm vitest run src/lib/boards/actions.test.ts -t "renameBoard"`
Expected: both `renameBoard updates the owner's boards tag` and `renameBoard invalidates every recipient's shared-boards tag` PASS.

- [ ] **Step 7: Run the full board-actions test file to confirm no regressions**

Run: `pnpm vitest run src/lib/boards/actions.test.ts`
Expected: all tests in the file PASS (the other suites — `upsertCell`, `deleteItem`, `deleteBoard`, `reorderBoard`, etc. — are unaffected because they never call `from("board_members")`).

- [ ] **Step 8: Run the full gate suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four PASS. (Note per repo memory: a cold `pnpm typecheck` can transiently fail on `cacheLife("nav")` types until `pnpm build` has generated `.next/types`; if so, run `pnpm build` first, then re-run `pnpm typecheck`.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/boards/actions.ts src/lib/boards/actions.test.ts
git commit -m "fix(boards): invalidate recipients' shared-boards cache on rename

renameBoard only busted the owner's boards:user tag, so users a board was
shared with kept seeing the stale name in their shared-boards list until the
nav TTL expired. Fan out updateTag(sharedBoardsTag(uid)) over every
board_members grantee (RLS-scoped read via the cookie-bound client)."
```

---

## Execution DAG

**This plan is a single self-contained task — the DAG is one node.**

- **Dependency graph:** Task 1 depends on nothing.
- **Parallel batches:** Batch 1 = { Task 1 }. There is no second batch and nothing to parallelize.
- **Critical path:** Task 1 (the whole plan). Wall-clock floor = the time to do Task 1.

There are no independent units to schedule concurrently: the source edit, its new test, and the fix to the neighboring existing test all touch the same two files (`actions.ts`, `actions.test.ts`) and share the same behavior, so they must land together as one reviewable, independently-testable change. No worktree fan-out or `dispatching-parallel-agents` is warranted.

## Performance & Data-Fetching Budget

Not a UI/multi-view feature — no tabs, filters, or client view toggles are added, so the gotcha-09 first-paint-vs-interaction budget does not apply. The one new server-side read (`board_members` grantees for the renamed board) runs only inside the rename Server Action (an explicit mutation, not a hot-path list render), is bounded by that single board's membership, and filters on the indexed `board_members.board_id` / PK `(board_id, user_id)` (`board_members_user_id_idx` also exists) — no unbounded `select *` on a growing table.

## How To Test (manual acceptance, after merge)

1. As user **A** (org owner), create a board and rename it to "Alpha".
2. Share that board with user **B** (Board sharing UI → add B as editor/viewer).
3. In a separate session as **B**, open `/boards` — confirm "Alpha" appears under the shared-with-me / shared-boards list.
4. Back as **A**, rename the board to "Alpha v2".
5. As **B**, reload `/boards` (or navigate to it). **Expected:** the shared-boards list shows "Alpha v2" immediately — not the stale "Alpha". Before this fix, B kept seeing "Alpha" until the nav cache expired.
