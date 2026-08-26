# Sidebar Board Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user group boards — both their own and boards shared with them — into private, per-user folders in the sidebar's Boards section.

**Architecture:** Two new user-scoped tables (`board_folders`, `board_folder_boards`) hold folders and placements; the placement is keyed `(user_id, board_id)` so filing a board shared with you never touches the owner's sidebar, and so a board can be in at most one folder. One extra cached read joins the existing `Promise.all` in the sidebar's data loader; a pure `groupBoardsByFolder` function folds folders + placements + the two existing board lists into the rendered tree. Mutations are Server Actions that invalidate a single new cache tag.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions, `use cache` / `cacheLife` / `cacheTag` / `updateTag`), Supabase Postgres + RLS, TypeScript strict, Zod 4, Zustand (`useUIStore`), Tailwind v4 + shadcn primitives, `@dnd-kit` (Task 7 only), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-26-sidebar-board-folders-design.md`

## Global Constraints

- **UI label is "Folders", never "Projects" or "Groups."** Menu copy is "Move to folder…", "New folder…", "Remove from folder". ("Projects" collides with the existing Portfolios feature; "group" already means a row-group inside a board.)
- **Folders are private to the user.** No org visibility, no sharing of folders, no `workspace_id` column. Ever, in this plan.
- **A board is in at most one folder**, enforced by `primary key (user_id, board_id)` — never by application code.
- **A folder with no currently-visible boards is hidden**, not rendered empty.
- **Server Actions return `ActionResult` / `fail` imported from `src/lib/actions/result.ts`.** Never re-declare the shape locally.
- **Cache tags come from `src/lib/cache/tags.ts`.** Never inline a tag string literal.
- **Cached reads use `createServiceClient` with an explicit `user_id = userId` filter** — the service client bypasses RLS, so that filter _is_ the tenant boundary. Server Actions use the request-scoped `createClient` from `@/lib/supabase/server` and let RLS do the scoping.
- **Migrations are minted only via `scripts/new-migration.sh <slug>`** — never hand-stamp a version. Apply to DEV via the `supabase-dev` MCP using the **same version + name** as the committed file, then verify with `pnpm db:ledger-check`.
- **Regenerate types via the `supabase-dev` MCP `generate_typescript_types`**, not `pnpm db:types` (which throws `LegacyProjectNotLinkedError` inside a worktree). Run prettier over the result and commit it in the same PR.
- **The production deployment runs the DEV database.** DEV holds real, live, user-facing data. No destructive experiments; verify live-DB behaviour inside a rolled-back transaction.
- **The collapsed icon rail does not change.** Folders are an expanded-sidebar affordance only.
- **UI work requires the `pulse-ui` and `frontend-design` skills loaded before writing markup** (working agreement #3). Reuse existing token classes (`bg-state-hover`, `bg-primary/80`, `text-muted-foreground`); introduce no new colour.
- **Commit identity is pinned** to `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage explicitly by path — never `git add -A`.
- **Gates before finishing:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## File Structure

**Created**

| File                                                           | Responsibility                                                                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/<stamp>_sidebar_board_folders.sql`        | Both tables, indexes, `updated_at` trigger, RLS policies.                                                                                            |
| `src/lib/boards/folders/types.ts`                              | Pure shared types (`BoardFolder`, `BoardFolderPlacement`, `BoardFolderData`). No I/O. Created in Task 1 so Tasks 2–4 can run in parallel against it. |
| `src/lib/boards/folders/queries.ts`                            | Uncached, RLS-client read (used by the integration test / any future non-nav caller).                                                                |
| `src/lib/boards/folders/queries-cached.ts`                     | `listBoardFoldersCached(userId)` — `use cache`, service client, explicit user filter.                                                                |
| `src/lib/boards/folders/group.ts`                              | `groupBoardsByFolder` — the pure fold. Where "hide empty folders" lives.                                                                             |
| `src/lib/boards/folders/actions.ts`                            | `createFolder` / `renameFolder` / `deleteFolder` / `moveBoardToFolder`.                                                                              |
| `src/lib/validations/board-folders.ts`                         | Zod schemas for the four actions.                                                                                                                    |
| `src/components/boards/BoardFolderRow.tsx`                     | One collapsible folder row + its children.                                                                                                           |
| `src/components/boards/BoardFolderMenu.tsx`                    | The folder's `⋯` menu (Rename, Delete) + its dialogs.                                                                                                |
| `src/components/boards/NewFolderDialog.tsx`                    | "New folder" trigger + dialog, sits in the Boards section header.                                                                                    |
| `src/components/boards/SharedBoardRow.tsx`                     | The shared-board row, extracted from `BoardsNav` so it can render both inside a folder and under "Shared with me".                                   |
| `src/components/boards/MoveToFolderMenu.tsx`                   | The "Move to folder ▸" submenu items, shared by the owned-board and shared-board menus (Task 6).                                                     |
| `src/components/boards/SharedBoardMenu.tsx`                    | `⋯` menu for a shared board — move entries only (Task 6).                                                                                            |
| `src/lib/boards/folders/board-folders.rls.integration.test.ts` | RLS policy proof; skips without `PULSE_TEST_DB`.                                                                                                     |

**Modified**

| File                                          | Change                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/cache/tags.ts`                       | Add `boardFoldersTag`. **Task 2 owns this file** — no other parallel task edits it.                                          |
| `src/components/shell/sidebar-nav-data.tsx`   | Add `listBoardFoldersCached(userId)` to the existing `Promise.all`; pass `folders` + `placements` through.                   |
| `src/components/shell/sidebar-nav.tsx`        | Accept and forward the two new props to `BoardsNav`. (`MobileNav` derives its props from `SidebarNav`, so it needs no edit.) |
| `src/components/boards/BoardsNav.tsx`         | Render folders → unfiled owned → "Shared with me"; export `PlainBoardRow`; use the extracted `SharedBoardRow`.               |
| `src/components/boards/BoardItemMenu.tsx`     | Add the "Move to folder ▸" submenu (Task 6).                                                                                 |
| `src/components/boards/BoardsNavSortable.tsx` | Folder rows become drop targets; shared rows become draggable (Task 7).                                                      |

## Execution DAG

```
Task 1 (schema + shared types)
   ├─► Task 2 (tags + queries)  ─┐
   ├─► Task 3 (group fold)       ├─► Task 5 (sidebar UI) ─► Task 6 (move menus) ─► Task 7 (drag)
   └─► Task 4 (actions)         ─┘
```

- **Batch 1:** Task 1 alone.
- **Batch 2:** Tasks 2, 3, 4 **concurrently** — three agents, disjoint files. Dispatch with `superpowers:dispatching-parallel-agents`. (This differs from the spec's DAG, which had Task 4 consuming Task 2: the shared types moved into Task 1 and Task 4 only _imports_ `boardFoldersTag`, so it no longer edits `tags.ts`. Task 2 still owns that file exclusively.)
- **Batch 3:** Task 5.
- **Batch 4:** Task 6, then Task 7.

**Critical path:** 1 → 2 → 5 → 6 → 7. Tasks 6 and 7 are sequential because both mutate the same nav components.

**Worktree:** one worktree for the whole feature — `scripts/start-task.sh sidebar-board-folders`, then `EnterWorktree({ path: ".claude/worktrees/sidebar-board-folders" })`. Batch 2's parallel agents run _inside_ it. Separate worktrees per task would only manufacture rebase conflicts on `BoardsNav.tsx`.

---

### Task 1: Schema, RLS, and shared types

**Files:**

- Create: `supabase/migrations/<stamp>_sidebar_board_folders.sql` (stamp minted by the script)
- Create: `src/lib/boards/folders/types.ts`
- Create: `src/lib/boards/folders/board-folders.rls.integration.test.ts`
- Modify: `src/types/database.types.ts` (regenerated, never hand-edited)

**Interfaces:**

- Consumes: `public.can_read_board(uuid)` — the existing SECURITY DEFINER visibility helper from `20260620100000_board_level_sharing.sql`, redefined in `20260621000000_board_access_require_membership_and_returning.sql` to also require active org membership. **Use it. Do not re-inline an `exists` over `boards`/`board_members`.** Also `public.set_updated_at()`, the trigger function every table in `20260615061747_boards_core.sql` uses.
- Produces: tables `public.board_folders` / `public.board_folder_boards`; types `BoardFolder`, `BoardFolderPlacement`, `BoardFolderData`.

- [ ] **Step 1: Mint the migration file**

```bash
scripts/new-migration.sh sidebar_board_folders
```

Note the generated path — it contains the version stamp you must reuse when applying to DEV.

- [ ] **Step 2: Write the migration SQL**

Paste into the generated file:

```sql
-- Sidebar board folders: a private, per-user grouping layer over the Boards nav.
--
-- Placement is keyed (user_id, board_id), NOT boards.folder_id, because a board
-- shared with me is owned by someone else — a column on `boards` would move it in
-- the OWNER's sidebar too. That primary key is also what enforces "a board is in
-- at most one folder" structurally, so no application code has to.
--
-- Folders are deliberately user-global (no workspace_id): a single folder must be
-- able to hold a board shared with me (not workspace-filtered) alongside my own
-- (which are). A folder with nothing visible is hidden in the UI, not stored
-- differently.

create table public.board_folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 60),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index board_folders_user_position_idx
  on public.board_folders (user_id, position);

create trigger board_folders_set_updated_at
  before update on public.board_folders
  for each row execute function public.set_updated_at();

create table public.board_folder_boards (
  user_id    uuid not null references auth.users(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  folder_id  uuid not null references public.board_folders(id) on delete cascade,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, board_id)
);

-- Covers the hot read (my placements, grouped by folder) and doubles as the FK
-- covering index the Supabase advisor asks for.
create index board_folder_boards_folder_position_idx
  on public.board_folder_boards (folder_id, position);

alter table public.board_folders       enable row level security;
alter table public.board_folder_boards enable row level security;

-- board_folders: yours or it does not exist.
create policy "board_folders: read own" on public.board_folders
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "board_folders: insert own" on public.board_folders
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "board_folders: update own" on public.board_folders
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "board_folders: delete own" on public.board_folders
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- board_folder_boards: same identity gate, plus you may only file a board you can
-- actually read. Without the can_read_board() check a user could file a board id
-- they cannot see — invisible on read, but an unnecessary existence oracle.
create policy "board_folder_boards: read own" on public.board_folder_boards
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "board_folder_boards: insert own" on public.board_folder_boards
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_read_board(board_id)
  );
create policy "board_folder_boards: update own" on public.board_folder_boards
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.can_read_board(board_id)
  );
create policy "board_folder_boards: delete own" on public.board_folder_boards
  for delete to authenticated
  using (user_id = (select auth.uid()));
```

Note on revoked shares: nothing cascades when a `board_members` grant is removed (the board still exists), so the placement row survives. That is intended — the read path only renders placements whose board is visible, so a stale placement is invisible, and restoring the share puts the board back in its old folder. No cleanup job.

- [ ] **Step 3: Apply to DEV via the `supabase-dev` MCP**

Call `mcp__supabase-dev__apply_migration` with `name` set to the **exact same version + name** as the committed filename (e.g. `20260826HHMMSS_sidebar_board_folders`) and `query` set to the SQL above. A mismatched label is the drift `scripts/reconcile-migration-version.sh` exists to repair — avoid needing it.

- [ ] **Step 4: Verify the ledger matches the repo**

Run: `pnpm db:ledger-check`
Expected: no diff in either direction. `finish-task.sh` blocks on a ledger row with no committed file (gotcha-57).

- [ ] **Step 5: Probe the RLS policies on DEV inside a rolled-back transaction**

Call `mcp__supabase-dev__execute_sql`. DEV holds live user data — the `rollback` is mandatory, not decoration.

```sql
begin;
-- Insert a folder for a fabricated uid and confirm the identity gate rejects a
-- read as a different uid. set_config with is_local=true is scoped to this txn.
select set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
set local role authenticated;
insert into public.board_folders (user_id, name) values ('00000000-0000-0000-0000-000000000001', 'probe');
select count(*) as should_be_1 from public.board_folders where name = 'probe';
select set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000002','role','authenticated')::text, true);
select count(*) as should_be_0 from public.board_folders where name = 'probe';
rollback;
```

Expected: `should_be_1` = 1, `should_be_0` = 0. If the second count is non-zero the select policy is wrong — stop and fix before continuing.

- [ ] **Step 6: Regenerate database types**

Call `mcp__supabase-dev__generate_typescript_types`, write the result to `src/types/database.types.ts`, then:

Run: `pnpm exec prettier --write src/types/database.types.ts`
Expected: file formatted; `board_folders` and `board_folder_boards` now appear in the `Tables` block.

- [ ] **Step 7: Write the shared types**

Create `src/lib/boards/folders/types.ts`:

```ts
/**
 * Shared shapes for the sidebar's private board-folder layer. Pure types, no I/O
 * — reads (`queries-cached.ts`), the fold (`group.ts`) and the actions all import
 * from here, which is what lets those three be built in parallel.
 */

/** A folder as rendered in the nav. Private to one user; never org-visible. */
export type BoardFolder = {
  id: string;
  name: string;
  position: number;
};

/** One board's placement in one folder, for one user. */
export type BoardFolderPlacement = {
  boardId: string;
  folderId: string;
  position: number;
};

/** Everything the nav needs about folders, in one read. */
export type BoardFolderData = {
  folders: BoardFolder[];
  placements: BoardFolderPlacement[];
};
```

- [ ] **Step 8: Write the RLS integration test**

Create `src/lib/boards/folders/board-folders.rls.integration.test.ts`. It follows `src/lib/portfolios/portfolios.rls.integration.test.ts` — read that file first for the exact `loadIntegrationEnv` / `signInWithRetry` / admin-client setup and copy its `beforeAll`/`afterAll` user-and-org seeding verbatim, adapting the seeded rows. The three assertions that matter:

```ts
it("hides one user's folders from another user", async () => {
  const { data } = await bAnon
    .from("board_folders")
    .select("id")
    .eq("id", aFolderId);
  expect(data ?? []).toHaveLength(0);
});

it("rejects filing a board the user cannot read", async () => {
  // bBoardId belongs to user B's org; user A is neither creator nor board member.
  const { error } = await aAnon.from("board_folder_boards").insert({
    user_id: aUserId,
    board_id: bBoardId,
    folder_id: aFolderId,
  });
  expect(error).not.toBeNull();
  expect(error?.code).toBe("42501"); // RLS violation
});

it("leaves boards intact when their folder is deleted", async () => {
  await aAnon.from("board_folders").delete().eq("id", aFolderId);
  const { data } = await admin.from("boards").select("id").eq("id", aBoardId);
  expect(data ?? []).toHaveLength(1);
});
```

- [ ] **Step 9: Run the test file**

Run: `pnpm test src/lib/boards/folders/board-folders.rls.integration.test.ts`
Expected: **skipped** (`describe.skipIf(!integrationTargetReady())`) unless `PULSE_TEST_DB` is set. A skip here is a pass — the suite must not touch a live database on an ordinary run. If you have `PULSE_TEST_DB` pointed at DEV, run it once and confirm all three pass, then unset it.

- [ ] **Step 10: Typecheck**

Run: `pnpm typecheck`
Expected: clean. (Nothing imports the new types yet; this is checking the regenerated `database.types.ts`.)

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations src/types/database.types.ts src/lib/boards/folders/types.ts src/lib/boards/folders/board-folders.rls.integration.test.ts
git commit -m "feat(db): board_folders + board_folder_boards with per-user RLS"
```

---

### Task 2: Cache tag and reads

**Files:**

- Modify: `src/lib/cache/tags.ts`
- Create: `src/lib/boards/folders/queries.ts`
- Create: `src/lib/boards/folders/queries-cached.ts`
- Test: `src/lib/boards/folders/queries-cached.test.ts`

**Interfaces:**

- Consumes: `BoardFolder`, `BoardFolderPlacement`, `BoardFolderData` from `@/lib/boards/folders/types` (Task 1).
- Produces:
  - `boardFoldersTag(userId: string): string` from `@/lib/cache/tags`
  - `listBoardFoldersCached(userId: string): Promise<BoardFolderData>` from `@/lib/boards/folders/queries-cached`
  - `listBoardFolders(): Promise<BoardFolderData>` from `@/lib/boards/folders/queries`

**This task exclusively owns `src/lib/cache/tags.ts`.** Task 4 imports `boardFoldersTag` but must not edit that file.

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/folders/queries-cached.test.ts`. Model the chainable stub on `src/lib/boards/queries-cached.test.ts` (read it first).

```ts
import { describe, expect, it, vi } from "vitest";

// `cacheTag`/`cacheLife` throw outside a compiled `use cache` scope (the Next
// transform that no-ops them is not applied under Vitest), so stub next/cache.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

function makeClient(
  tables: Record<string, { rows: unknown[] | null; error?: unknown }>,
) {
  const calls: Array<[string, string, unknown]> = [];
  return {
    calls,
    client: {
      from: (table: string) => {
        const qb: Record<string, unknown> = {};
        qb.select = () => qb;
        qb.eq = (col: string, val: unknown) => {
          calls.push([table, "eq:" + col, val]);
          return qb;
        };
        qb.limit = () => qb;
        qb.order = () =>
          Promise.resolve({
            data: tables[table]?.rows ?? [],
            error: tables[table]?.error ?? null,
          });
        return qb;
      },
    },
  };
}

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));
import { createServiceClient } from "@/lib/supabase/service";
import { listBoardFoldersCached } from "./queries-cached";

describe("listBoardFoldersCached", () => {
  it("filters both reads by the passed userId (tenant boundary) and maps rows", async () => {
    const { client, calls } = makeClient({
      board_folders: { rows: [{ id: "f1", name: "Acme", position: 2 }] },
      board_folder_boards: {
        rows: [{ board_id: "b1", folder_id: "f1", position: 0 }],
      },
    });
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await listBoardFoldersCached("user-1");

    expect(result.folders).toEqual([{ id: "f1", name: "Acme", position: 2 }]);
    expect(result.placements).toEqual([
      { boardId: "b1", folderId: "f1", position: 0 },
    ]);
    // The service client bypasses RLS: these filters ARE the tenant boundary.
    expect(calls).toContainEqual(["board_folders", "eq:user_id", "user-1"]);
    expect(calls).toContainEqual([
      "board_folder_boards",
      "eq:user_id",
      "user-1",
    ]);
  });

  it("degrades to empty lists on a read error rather than blanking the shell", async () => {
    const { client } = makeClient({
      board_folders: { rows: null, error: { message: "boom" } },
      board_folder_boards: { rows: [] },
    });
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    await expect(listBoardFoldersCached("user-1")).resolves.toEqual({
      folders: [],
      placements: [],
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test src/lib/boards/folders/queries-cached.test.ts`
Expected: FAIL — `Failed to resolve import "./queries-cached"`.

- [ ] **Step 3: Add the cache tag**

In `src/lib/cache/tags.ts`, directly under `sharedBoardsTag`:

```ts
export const boardFoldersTag = (userId: string) =>
  `board-folders:user:${userId}`;
```

- [ ] **Step 4: Write the cached read**

Create `src/lib/boards/folders/queries-cached.ts`:

```ts
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { boardFoldersTag } from "@/lib/cache/tags";
import type { BoardFolderData } from "@/lib/boards/folders/types";

// Defensive caps on a hot path that runs on ~every authenticated nav. Per-user
// folder and placement counts are naturally small; these bound a pathological
// account, matching MY_BOARDS_LIMIT in ../queries.ts.
const FOLDERS_LIMIT = 200;
const PLACEMENTS_LIMIT = 2000;

/**
 * Cached folders + placements for one user. `userId` is read OUTSIDE this scope
 * (in the shell server component) and passed in, so it is part of the cache key
 * and the cacheTag. Uses the cookie-free service client with an EXPLICIT
 * `user_id = userId` filter — that filter is the tenant boundary, because the
 * service client bypasses RLS.
 *
 * Returns empty lists on error: the sidebar degrades to today's flat board list
 * rather than blanking the shell. The uncached sibling throws instead.
 */
export async function listBoardFoldersCached(
  userId: string,
): Promise<BoardFolderData> {
  "use cache";
  cacheLife("nav");
  cacheTag(boardFoldersTag(userId));

  const supabase = createServiceClient();
  const [foldersRes, placementsRes] = await Promise.all([
    supabase
      .from("board_folders")
      .select("id, name, position")
      .eq("user_id", userId)
      .limit(FOLDERS_LIMIT)
      .order("position", { ascending: true }),
    supabase
      .from("board_folder_boards")
      .select("board_id, folder_id, position")
      .eq("user_id", userId)
      .limit(PLACEMENTS_LIMIT)
      .order("position", { ascending: true }),
  ]);

  if (foldersRes.error || placementsRes.error) {
    return { folders: [], placements: [] };
  }

  return {
    folders: (foldersRes.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      position: f.position,
    })),
    placements: (placementsRes.data ?? []).map((p) => ({
      boardId: p.board_id,
      folderId: p.folder_id,
      position: p.position,
    })),
  };
}
```

- [ ] **Step 5: Write the uncached sibling**

Create `src/lib/boards/folders/queries.ts`:

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import type { BoardFolderData } from "@/lib/boards/folders/types";

/**
 * Uncached folders + placements for the signed-in user, through the RLS client.
 * Mirrors `listMyBoards` vs `listMyBoardsCached`: this one throws, because a DB
 * failure is not "no folders". The nav uses the cached variant; this exists for
 * callers that need live data and for exercising the real policies.
 */
export async function listBoardFolders(): Promise<BoardFolderData> {
  const user = await getUser();
  if (!user) return { folders: [], placements: [] };

  const supabase = await createClient();
  const [foldersRes, placementsRes] = await Promise.all([
    supabase
      .from("board_folders")
      .select("id, name, position")
      .order("position", { ascending: true }),
    supabase
      .from("board_folder_boards")
      .select("board_id, folder_id, position")
      .order("position", { ascending: true }),
  ]);

  if (foldersRes.error)
    throw new Error(`Failed to load folders: ${foldersRes.error.message}`);
  if (placementsRes.error)
    throw new Error(
      `Failed to load folder placements: ${placementsRes.error.message}`,
    );

  return {
    folders: (foldersRes.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      position: f.position,
    })),
    placements: (placementsRes.data ?? []).map((p) => ({
      boardId: p.board_id,
      folderId: p.folder_id,
      position: p.position,
    })),
  };
}
```

RLS already scopes both reads to `auth.uid()`, so no `user_id` filter is needed here — that is the difference between the two clients, and the reason the cached one must filter explicitly.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/lib/boards/folders/queries-cached.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck
git add src/lib/cache/tags.ts src/lib/boards/folders/queries.ts src/lib/boards/folders/queries-cached.ts src/lib/boards/folders/queries-cached.test.ts
git commit -m "feat(boards): cached per-user board-folder reads + boardFoldersTag"
```

---

### Task 3: The grouping fold

**Files:**

- Create: `src/lib/boards/folders/group.ts`
- Test: `src/lib/boards/folders/group.test.ts`

**Interfaces:**

- Consumes: `BoardFolder`, `BoardFolderPlacement` from `@/lib/boards/folders/types` (Task 1); `BoardListEntry`, `SharedBoardEntry` from `@/lib/boards/queries` (existing — read that file for the exact fields: `BoardListEntry` is `{ id, name, workspace_id, position, shared_out }`, `SharedBoardEntry` is `{ id, name, position, owner_name, access_level }`).
- Produces: `groupBoardsByFolder(input): GroupedNav`, and the types `NavBoard` and `GroupedNav`.

This task is pure functions only — no React, no I/O, no imports from `queries-cached.ts` or `actions.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/folders/group.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
import { groupBoardsByFolder } from "./group";

const owned = (id: string, name = id): BoardListEntry => ({
  id,
  name,
  workspace_id: "w1",
  position: 0,
  shared_out: false,
});

const shared = (id: string, name = id): SharedBoardEntry => ({
  id,
  name,
  position: 0,
  owner_name: "Ada",
  access_level: "editor",
});

describe("groupBoardsByFolder", () => {
  it("puts an owned board and a shared board in the same folder", () => {
    const result = groupBoardsByFolder({
      folders: [{ id: "f1", name: "Acme", position: 0 }],
      placements: [
        { boardId: "b1", folderId: "f1", position: 0 },
        { boardId: "s1", folderId: "f1", position: 1 },
      ],
      boards: [owned("b1")],
      sharedBoards: [shared("s1")],
    });

    expect(result.folders).toHaveLength(1);
    expect(result.folders[0].folder.name).toBe("Acme");
    expect(result.folders[0].boards.map((b) => b.board.id)).toEqual([
      "b1",
      "s1",
    ]);
    expect(result.folders[0].boards.map((b) => b.kind)).toEqual([
      "owned",
      "shared",
    ]);
    expect(result.unfiledOwned).toEqual([]);
    expect(result.unfiledShared).toEqual([]);
  });

  it("hides a folder whose boards are all invisible in this context", () => {
    // b-other lives in another workspace, so it is absent from `boards`.
    const result = groupBoardsByFolder({
      folders: [{ id: "f1", name: "Elsewhere", position: 0 }],
      placements: [{ boardId: "b-other", folderId: "f1", position: 0 }],
      boards: [owned("b1")],
      sharedBoards: [],
    });

    expect(result.folders).toEqual([]);
    expect(result.unfiledOwned.map((b) => b.id)).toEqual(["b1"]);
  });

  it("leaves unplaced boards unfiled, split by ownership", () => {
    const result = groupBoardsByFolder({
      folders: [{ id: "f1", name: "Acme", position: 0 }],
      placements: [{ boardId: "b1", folderId: "f1", position: 0 }],
      boards: [owned("b1"), owned("b2")],
      sharedBoards: [shared("s1")],
    });

    expect(result.folders[0].boards.map((b) => b.board.id)).toEqual(["b1"]);
    expect(result.unfiledOwned.map((b) => b.id)).toEqual(["b2"]);
    expect(result.unfiledShared.map((b) => b.id)).toEqual(["s1"]);
  });

  it("ignores a placement pointing at a folder that no longer exists", () => {
    const result = groupBoardsByFolder({
      folders: [],
      placements: [{ boardId: "b1", folderId: "ghost", position: 0 }],
      boards: [owned("b1")],
      sharedBoards: [],
    });

    expect(result.folders).toEqual([]);
    expect(result.unfiledOwned.map((b) => b.id)).toEqual(["b1"]);
  });

  it("orders folders by position then name, and boards by placement position", () => {
    const result = groupBoardsByFolder({
      folders: [
        { id: "f2", name: "Beta", position: 1 },
        { id: "f1", name: "Alpha", position: 1 },
        { id: "f0", name: "Zulu", position: 0 },
      ],
      placements: [
        { boardId: "b1", folderId: "f0", position: 5 },
        { boardId: "b2", folderId: "f0", position: 1 },
        { boardId: "b3", folderId: "f1", position: 0 },
        { boardId: "b4", folderId: "f2", position: 0 },
      ],
      boards: [owned("b1"), owned("b2"), owned("b3"), owned("b4")],
      sharedBoards: [],
    });

    expect(result.folders.map((f) => f.folder.id)).toEqual(["f0", "f1", "f2"]);
    expect(result.folders[0].boards.map((b) => b.board.id)).toEqual([
      "b2",
      "b1",
    ]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test src/lib/boards/folders/group.test.ts`
Expected: FAIL — `Failed to resolve import "./group"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/boards/folders/group.ts`:

```ts
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
import type { BoardFolder, BoardFolderPlacement } from "./types";

/**
 * A board in the nav tree, tagged with which list it came from. Kept as a
 * discriminated union rather than a merged shape so each row renderer keeps its
 * own affordances: an owned board shows the "shared out" marker and the full
 * board menu; a shared board shows the viewer eye and "Shared by X".
 */
export type NavBoard =
  | { kind: "owned"; board: BoardListEntry }
  | { kind: "shared"; board: SharedBoardEntry };

export type GroupedNav = {
  /** Only folders with at least one currently-visible board. */
  folders: Array<{ folder: BoardFolder; boards: NavBoard[] }>;
  unfiledOwned: BoardListEntry[];
  unfiledShared: SharedBoardEntry[];
};

/**
 * Folds folders + placements + the two board lists into the sidebar tree.
 *
 * Two rules live here and nowhere else:
 *   1. A folder with no visible board is DROPPED, not rendered empty. Folders
 *      are user-global while owned boards are workspace-filtered, so a folder
 *      whose boards all live in another workspace must simply not appear.
 *   2. A placement is only honoured if BOTH its board and its folder are
 *      present — a stale placement (revoked share, deleted folder) is inert.
 */
export function groupBoardsByFolder({
  folders,
  placements,
  boards,
  sharedBoards,
}: {
  folders: BoardFolder[];
  placements: BoardFolderPlacement[];
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
}): GroupedNav {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const placementByBoard = new Map(
    placements
      .filter((p) => folderById.has(p.folderId))
      .map((p) => [p.boardId, p]),
  );

  const buckets = new Map<string, Array<{ position: number; nav: NavBoard }>>();
  const unfiledOwned: BoardListEntry[] = [];
  const unfiledShared: SharedBoardEntry[] = [];

  const place = (nav: NavBoard, onUnfiled: () => void) => {
    const placement = placementByBoard.get(nav.board.id);
    if (!placement) {
      onUnfiled();
      return;
    }
    const bucket = buckets.get(placement.folderId) ?? [];
    bucket.push({ position: placement.position, nav });
    buckets.set(placement.folderId, bucket);
  };

  for (const board of boards) {
    place({ kind: "owned", board }, () => unfiledOwned.push(board));
  }
  for (const board of sharedBoards) {
    place({ kind: "shared", board }, () => unfiledShared.push(board));
  }

  const ordered = [...folders].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );

  return {
    folders: ordered
      .filter((f) => (buckets.get(f.id)?.length ?? 0) > 0)
      .map((folder) => ({
        folder,
        boards: (buckets.get(folder.id) ?? [])
          .sort(
            (a, b) =>
              a.position - b.position ||
              a.nav.board.name.localeCompare(b.nav.board.name),
          )
          .map((entry) => entry.nav),
      })),
    unfiledOwned,
    unfiledShared,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/boards/folders/group.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add src/lib/boards/folders/group.ts src/lib/boards/folders/group.test.ts
git commit -m "feat(boards): groupBoardsByFolder fold for the sidebar tree"
```

---

### Task 4: Server Actions

**Files:**

- Create: `src/lib/validations/board-folders.ts`
- Create: `src/lib/boards/folders/actions.ts`
- Test: `src/lib/boards/folders/actions.test.ts`

**Interfaces:**

- Consumes: `BoardFolder` from `@/lib/boards/folders/types` (Task 1); `boardFoldersTag` from `@/lib/cache/tags` (Task 2 adds it — **import it, do not edit `tags.ts`**); `ActionResult` / `fail` from `@/lib/actions/result`.
- Produces:
  - `createFolder(input: { name: string }): Promise<ActionResult<BoardFolder>>`
  - `renameFolder(input: { folderId: string; name: string }): Promise<ActionResult>`
  - `deleteFolder(input: { folderId: string }): Promise<ActionResult>`
  - `moveBoardToFolder(input: { boardId: string; folderId: string | null }): Promise<ActionResult>`

> **Parallel-batch note:** Task 2 may not have landed `boardFoldersTag` when you start. If `pnpm typecheck` fails on that import alone, that is expected mid-batch — finish your files and re-run typecheck after Task 2 merges. Do not add the tag yourself; a duplicate export is a merge conflict.

- [ ] **Step 1: Write the validation schemas**

Create `src/lib/validations/board-folders.ts`, matching the house style in `src/lib/validations/workspace-actions.ts`:

```ts
import { z } from "zod";

// 60 chars matches the DB CHECK on board_folders.name — keep the two in step.
const name = z.string().trim().min(1).max(60);
const uuid = z.string().uuid();

export const createFolderSchema = z.object({ name });
export const renameFolderSchema = z.object({ folderId: uuid, name });
export const deleteFolderSchema = z.object({ folderId: uuid });
export const moveBoardToFolderSchema = z.object({
  boardId: uuid,
  folderId: uuid.nullable(),
});
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/boards/folders/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
vi.mock("@/lib/auth/session", () => ({
  getUser: vi.fn(async () => ({ id: "user-1" })),
}));

// Minimal chainable stub: every terminal awaits to { data, error }.
const state: {
  insertError: unknown;
  upsertPayload: unknown;
  maxPosition: number | null;
} = { insertError: null, upsertPayload: null, maxPosition: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const qb: Record<string, unknown> = {};
      qb.select = () => qb;
      qb.eq = () => qb;
      qb.order = () => qb;
      qb.limit = () =>
        Promise.resolve({
          data:
            state.maxPosition === null ? [] : [{ position: state.maxPosition }],
          error: null,
        });
      qb.single = () =>
        Promise.resolve({
          data: { id: "f-new", name: "Acme", position: 0 },
          error: state.insertError,
        });
      qb.insert = () => qb;
      qb.update = () => Promise.resolve({ error: state.insertError });
      qb.delete = () => qb;
      qb.upsert = (payload: unknown) => {
        state.upsertPayload = payload;
        return Promise.resolve({ error: state.insertError });
      };
      return qb;
    },
  })),
}));

import { createFolder, moveBoardToFolder, renameFolder } from "./actions";

const BOARD = "11111111-1111-4111-8111-111111111111";
const FOLDER = "22222222-2222-4222-8222-222222222222";

describe("board folder actions", () => {
  beforeEach(() => {
    updateTag.mockClear();
    state.insertError = null;
    state.upsertPayload = null;
    state.maxPosition = null;
  });

  it("rejects an empty folder name before touching the database", async () => {
    const res = await createFolder({ name: "   " });
    expect(res.ok).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("rejects a name over 60 characters", async () => {
    const res = await renameFolder({ folderId: FOLDER, name: "x".repeat(61) });
    expect(res.ok).toBe(false);
  });

  it("invalidates only the board-folders tag on success", async () => {
    const res = await createFolder({ name: "Acme" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(updateTag).toHaveBeenCalledWith("board-folders:user:user-1");
  });

  it("unfiles a board when folderId is null", async () => {
    const res = await moveBoardToFolder({ boardId: BOARD, folderId: null });
    expect(res.ok).toBe(true);
    // A null target deletes the placement rather than upserting one.
    expect(state.upsertPayload).toBeNull();
    expect(updateTag).toHaveBeenCalledWith("board-folders:user:user-1");
  });

  it("upserts on the (user_id, board_id) key when filing a board", async () => {
    const res = await moveBoardToFolder({ boardId: BOARD, folderId: FOLDER });
    expect(res.ok).toBe(true);
    expect(state.upsertPayload).toMatchObject({
      user_id: "user-1",
      board_id: BOARD,
      folder_id: FOLDER,
    });
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm test src/lib/boards/folders/actions.test.ts`
Expected: FAIL — `Failed to resolve import "./actions"`.

- [ ] **Step 4: Write the actions**

Create `src/lib/boards/folders/actions.ts`:

```ts
"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { boardFoldersTag } from "@/lib/cache/tags";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { BoardFolder } from "@/lib/boards/folders/types";
import {
  createFolderSchema,
  deleteFolderSchema,
  moveBoardToFolderSchema,
  renameFolderSchema,
} from "@/lib/validations/board-folders";

/**
 * Folders are private to one user, so every action here is scoped by RLS on
 * `user_id = auth.uid()` — that is why these use the request-scoped client, not
 * the service client. Each ends by invalidating ONLY `boardFoldersTag`: no board
 * row changed, so `boardsTag` / `sharedBoardsTag` stay warm.
 */

export async function createFolder(input: {
  name: string;
}): Promise<ActionResult<BoardFolder>> {
  const parsed = createFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const user = await getUser();
  if (!user) return fail("You must be signed in.");

  const supabase = await createClient();

  // Append: one bounded, indexed read of the current highest position.
  const { data: last } = await supabase
    .from("board_folders")
    .select("position")
    .order("position", { ascending: false })
    .limit(1);
  const position = (last?.[0]?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("board_folders")
    .insert({ user_id: user.id, name: parsed.data.name, position })
    .select("id, name, position")
    .single();
  if (error || !data) return fail(error?.message ?? "Couldn't create folder.");

  updateTag(boardFoldersTag(user.id));
  return {
    ok: true,
    data: { id: data.id, name: data.name, position: data.position },
  };
}

export async function renameFolder(input: {
  folderId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const user = await getUser();
  if (!user) return fail("You must be signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("board_folders")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.folderId);
  if (error) return fail(error.message);

  updateTag(boardFoldersTag(user.id));
  return { ok: true, data: undefined };
}

/**
 * Deleting a folder deletes its placements (FK cascade) and nothing else — the
 * boards themselves are untouched and reappear as unfiled. That is why there is
 * no "this cannot be undone" ceremony: nothing destructive happens to a board.
 */
export async function deleteFolder(input: {
  folderId: string;
}): Promise<ActionResult> {
  const parsed = deleteFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const user = await getUser();
  if (!user) return fail("You must be signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("board_folders")
    .delete()
    .eq("id", parsed.data.folderId);
  if (error) return fail(error.message);

  updateTag(boardFoldersTag(user.id));
  return { ok: true, data: undefined };
}

/**
 * File a board into a folder, or unfile it with `folderId: null`. The upsert is
 * on the (user_id, board_id) primary key, so moving between folders is one
 * statement with no read-modify-write race — and the key itself is what makes
 * "at most one folder" impossible to violate.
 */
export async function moveBoardToFolder(input: {
  boardId: string;
  folderId: string | null;
}): Promise<ActionResult> {
  const parsed = moveBoardToFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const user = await getUser();
  if (!user) return fail("You must be signed in.");

  const supabase = await createClient();

  if (parsed.data.folderId === null) {
    const { error } = await supabase
      .from("board_folder_boards")
      .delete()
      .eq("board_id", parsed.data.boardId);
    if (error) return fail(error.message);
  } else {
    const { data: last } = await supabase
      .from("board_folder_boards")
      .select("position")
      .eq("folder_id", parsed.data.folderId)
      .order("position", { ascending: false })
      .limit(1);
    const position = (last?.[0]?.position ?? -1) + 1;

    const { error } = await supabase.from("board_folder_boards").upsert(
      {
        user_id: user.id,
        board_id: parsed.data.boardId,
        folder_id: parsed.data.folderId,
        position,
      },
      { onConflict: "user_id,board_id" },
    );
    // A board you cannot read is rejected by the RLS WITH CHECK, not by code.
    if (error) return fail(error.message);
  }

  updateTag(boardFoldersTag(user.id));
  return { ok: true, data: undefined };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/lib/boards/folders/actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add src/lib/validations/board-folders.ts src/lib/boards/folders/actions.ts src/lib/boards/folders/actions.test.ts
git commit -m "feat(boards): create/rename/delete folder + move board to folder actions"
```

---

### Task 5: Sidebar UI

**Files:**

- Create: `src/components/boards/BoardFolderRow.tsx`
- Create: `src/components/boards/BoardFolderMenu.tsx`
- Create: `src/components/boards/NewFolderDialog.tsx`
- Create: `src/components/boards/SharedBoardRow.tsx`
- Modify: `src/components/boards/BoardsNav.tsx`
- Modify: `src/components/shell/sidebar-nav.tsx:131-144, 204-207`
- Modify: `src/components/shell/sidebar-nav-data.tsx:27-41`
- Test: `src/components/boards/BoardsNav.test.tsx` (extend)

**Interfaces:**

- Consumes: `listBoardFoldersCached` (Task 2), `groupBoardsByFolder` / `NavBoard` (Task 3), `createFolder` / `renameFolder` / `deleteFolder` (Task 4), `BoardFolder` / `BoardFolderPlacement` (Task 1).
- Produces: `BoardsNav` accepting `folders: BoardFolder[]` and `placements: BoardFolderPlacement[]`; exported `PlainBoardRow`; `SharedBoardRow`.

**Before writing any markup, load the `pulse-ui` and `frontend-design` skills.** Reuse the existing hover/active classes; add no new colour.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/boards/BoardsNav.test.tsx` (the file's existing mocks for `next/navigation`, `use-coarse-pointer` and `@/lib/dnd/sensors` already cover these):

```ts
const ownedBoard = {
  id: "b1",
  name: "Website revamp",
  workspace_id: "w1",
  position: 0,
  shared_out: false,
};
const sharedBoard = {
  id: "s1",
  name: "Design tasks",
  position: 0,
  owner_name: "Ada",
  access_level: "editor" as const,
};

it("renders a folder containing both an owned and a shared board", () => {
  render(
    <TooltipProvider>
      <BoardsNav
        boards={[ownedBoard]}
        sharedBoards={[sharedBoard]}
        folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
        placements={[
          { boardId: "b1", folderId: "f1", position: 0 },
          { boardId: "s1", folderId: "f1", position: 1 },
        ]}
      />
    </TooltipProvider>,
  );

  expect(screen.getByText("Acme Rebrand")).toBeInTheDocument();
  expect(screen.getByText("Website revamp")).toBeInTheDocument();
  expect(screen.getByText("Design tasks")).toBeInTheDocument();
  // Every shared board is filed, so the section heading is gone.
  expect(screen.queryByText("Shared with me")).not.toBeInTheDocument();
});

it("hides a folder whose boards are not visible in this workspace", () => {
  render(
    <TooltipProvider>
      <BoardsNav
        boards={[ownedBoard]}
        sharedBoards={[]}
        folders={[{ id: "f1", name: "Elsewhere", position: 0 }]}
        placements={[{ boardId: "b-other", folderId: "f1", position: 0 }]}
      />
    </TooltipProvider>,
  );

  expect(screen.queryByText("Elsewhere")).not.toBeInTheDocument();
  expect(screen.getByText("Website revamp")).toBeInTheDocument();
});

it("keeps 'Shared with me' for shared boards that are not filed", () => {
  render(
    <TooltipProvider>
      <BoardsNav
        boards={[]}
        sharedBoards={[sharedBoard]}
        folders={[]}
        placements={[]}
      />
    </TooltipProvider>,
  );

  expect(screen.getByText("Shared with me")).toBeInTheDocument();
  expect(screen.getByText("Design tasks")).toBeInTheDocument();
});

it("collapses a folder without a server round-trip", () => {
  render(
    <TooltipProvider>
      <BoardsNav
        boards={[ownedBoard]}
        sharedBoards={[]}
        folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
        placements={[{ boardId: "b1", folderId: "f1", position: 0 }]}
      />
    </TooltipProvider>,
  );

  const toggle = screen.getByRole("button", { name: /Collapse Acme Rebrand/i });
  fireEvent.click(toggle);
  expect(
    screen.getByRole("button", { name: /Expand Acme Rebrand/i }),
  ).toBeInTheDocument();
});

it("leaves the collapsed rail flat — no folder chrome", () => {
  render(
    <TooltipProvider>
      <BoardsNav
        boards={[ownedBoard]}
        sharedBoards={[]}
        folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
        placements={[{ boardId: "b1", folderId: "f1", position: 0 }]}
        collapsed
      />
    </TooltipProvider>,
  );

  expect(screen.queryByText("Acme Rebrand")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Website revamp" }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm test src/components/boards/BoardsNav.test.tsx`
Expected: FAIL — the existing tests pass; the five new ones fail on the unknown `folders` / `placements` props (TS error under Vitest, or "Unable to find an element with the text: Acme Rebrand").

- [ ] **Step 3: Extract the shared-board row**

Create `src/components/boards/SharedBoardRow.tsx` by moving the `<Link>` block currently inlined at `BoardsNav.tsx:207-244` — unchanged markup, so the existing tests keep passing:

```tsx
"use client";

import Link from "next/link";
import { Eye, Users2 } from "lucide-react";
import type { SharedBoardEntry } from "@/lib/boards/queries";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A board someone else shared with me. Extracted from `BoardsNav` so the same
 * row renders in two places: inside a folder, and under "Shared with me".
 * Folder membership must never hide WHOSE board it is, so the viewer-eye and
 * the "Shared by" tooltip travel with the row.
 */
export function SharedBoardRow({
  board,
  isActive,
}: {
  board: SharedBoardEntry;
  isActive: boolean;
}) {
  return (
    <Link
      href={`/boards/${board.id}`}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group/row flex items-center gap-1 rounded-md px-3 py-1 text-xs transition-colors",
        isActive
          ? "bg-primary/80 text-foreground"
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{board.name}</span>
      {board.access_level === "viewer" ? (
        <Eye
          aria-label="View only"
          className="text-muted-foreground size-3 shrink-0"
        />
      ) : null}
      {board.owner_name ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex shrink-0 items-center">
              <Users2
                aria-label={`Shared by ${board.owner_name}`}
                className="text-muted-foreground size-3.5"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">
            Shared by {board.owner_name}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </Link>
  );
}
```

- [ ] **Step 4: Write the folder menu**

Create `src/components/boards/BoardFolderMenu.tsx`. It mirrors `BoardItemMenu`'s structure (dropdown + rename `Dialog` + delete `AlertDialog`); read that file first and follow its `useTransition` / inline-error pattern:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { deleteFolder, renameFolder } from "@/lib/boards/folders/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export function BoardFolderMenu({
  folder,
}: {
  folder: { id: string; name: string };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(folder.name);
  const [error, setError] = useState<string | null>(null);

  function submitRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === folder.name) {
      setRenameOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await renameFolder({ folderId: folder.id, name: trimmed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRenameOpen(false);
      router.refresh();
    });
  }

  function doDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteFolder({ folderId: folder.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Folder actions for ${folder.name}`}
            className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-hover/folder:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onSelect={() => {
              setName(folder.name);
              setError(null);
              setRenameOpen(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              setError(null);
              setDeleteOpen(true);
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
            <DialogDescription>Give this folder a new name.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`rename-folder-${folder.id}`}>Folder name</Label>
              <Input
                id={`rename-folder-${folder.id}`}
                aria-label="Folder name"
                autoFocus
                value={name}
                disabled={isPending}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={isPending || !name.trim()}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete the folder &ldquo;{folder.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The boards inside it aren&rsquo;t deleted — they move back to your
              main list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                doDelete();
              }}
              disabled={isPending}
            >
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 5: Write the folder row**

Create `src/components/boards/BoardFolderRow.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { BoardFolderMenu } from "@/components/boards/BoardFolderMenu";

/**
 * One collapsible folder in the Boards nav. Open/closed state reuses
 * `useUIStore.collapsedSections` (the same persisted map `NavSection` uses),
 * keyed `folder:<id>` — so toggling a folder is 0 server round-trips and
 * survives a reload. Default open (absent key).
 */
export function BoardFolderRow({
  folder,
  count,
  children,
}: {
  folder: { id: string; name: string };
  count: number;
  children: ReactNode;
}) {
  const collapsedSections = useUIStore((s) => s.collapsedSections);
  const toggleSection = useUIStore((s) => s.toggleSection);
  const key = `folder:${folder.id}`;
  const open = !collapsedSections[key];
  const bodyId = `board-folder-${folder.id}`;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="group/folder text-muted-foreground hover:bg-state-hover hover:text-foreground flex items-center rounded-md pr-1 transition-colors">
        <button
          type="button"
          onClick={() => toggleSection(key)}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`}
          className="flex size-6 shrink-0 items-center justify-center rounded"
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        {open ? (
          <FolderOpen className="mr-1.5 size-3.5 shrink-0" aria-hidden />
        ) : (
          <Folder className="mr-1.5 size-3.5 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => toggleSection(key)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="min-w-0 flex-1 truncate py-1 pr-1 text-left text-xs"
        >
          {folder.name}
        </button>
        <span className="text-3xs text-muted-foreground mr-0.5 shrink-0 tabular-nums">
          {count}
        </span>
        <BoardFolderMenu folder={folder} />
      </div>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-0.5 pl-3">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write the new-folder dialog**

Create `src/components/boards/NewFolderDialog.tsx`. Read `src/components/boards/NewBoardDialog.tsx` first and match its trigger button styling:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";

import { createFolder } from "@/lib/boards/folders/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** "New folder" — creates a private folder in the signed-in user's Boards nav. */
export function NewFolderDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await createFolder({ name: trimmed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="New folder"
          className="text-muted-foreground hover:text-foreground"
        >
          <FolderPlus className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            Folders are private to you. Drop in your own boards and ones shared
            with you.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-folder-name">Folder name</Label>
            <Input
              id="new-folder-name"
              aria-label="Folder name"
              autoFocus
              value={name}
              disabled={isPending}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Creating…" : "Create folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Rewire `BoardsNav`**

In `src/components/boards/BoardsNav.tsx`:

1. Add imports:

```tsx
import type {
  BoardFolder,
  BoardFolderPlacement,
} from "@/lib/boards/folders/types";
import { groupBoardsByFolder } from "@/lib/boards/folders/group";
import { BoardFolderRow } from "@/components/boards/BoardFolderRow";
import { NewFolderDialog } from "@/components/boards/NewFolderDialog";
import { SharedBoardRow } from "@/components/boards/SharedBoardRow";
```

2. Export `PlainBoardRow` (change `function PlainBoardRow` to `export function PlainBoardRow`) — Task 7 needs it too.

3. Extend the props:

```tsx
export function BoardsNav({
  boards,
  sharedBoards,
  folders = [],
  placements = [],
  activeWorkspaceId,
  collapsed = false,
}: {
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
  folders?: BoardFolder[];
  placements?: BoardFolderPlacement[];
  activeWorkspaceId?: string;
  collapsed?: boolean;
}) {
```

Defaulting both to `[]` keeps every existing call site and test valid.

4. Inside the component, above the `return`:

```tsx
const grouped = groupBoardsByFolder({
  folders,
  placements,
  boards,
  sharedBoards,
});
```

5. **Leave the entire `collapsed ? (...)` branch untouched** — it still maps over the flat `boards` and `sharedBoards` props. The rail is deliberately folder-blind.

6. Replace the expanded `<NavSection>` body. The `action` prop becomes two buttons; the body renders folders, then unfiled owned, then unfiled shared:

```tsx
<NavSection
  storageKey="boards"
  title="Boards"
  icon={FolderKanban}
  action={
    <>
      <NewFolderDialog />
      <NewBoardDialog workspaceId={activeWorkspaceId} />
    </>
  }
>
  {grouped.folders.map(({ folder, boards: folderBoards }) => (
    <BoardFolderRow key={folder.id} folder={folder} count={folderBoards.length}>
      {folderBoards.map((entry) =>
        entry.kind === "owned" ? (
          <PlainBoardRow
            key={entry.board.id}
            board={entry.board}
            isActive={entry.board.id === activeBoardId}
          />
        ) : (
          <SharedBoardRow
            key={entry.board.id}
            board={entry.board}
            isActive={entry.board.id === activeBoardId}
          />
        ),
      )}
    </BoardFolderRow>
  ))}

  {grouped.unfiledOwned.length === 0 && grouped.folders.length === 0 ? (
    <p className="text-muted-foreground px-3 py-1 text-xs">No boards yet</p>
  ) : dndReady ? (
    <BoardsNavSortable
      boards={grouped.unfiledOwned}
      activeBoardId={activeBoardId}
    />
  ) : (
    <div
      data-testid="boards-nav-owned"
      onPointerEnter={() => setDndReady(true)}
      onFocus={() => setDndReady(true)}
    >
      {grouped.unfiledOwned.map((b) => (
        <PlainBoardRow key={b.id} board={b} isActive={b.id === activeBoardId} />
      ))}
    </div>
  )}

  {grouped.unfiledShared.length > 0 ? (
    <>
      <p className="text-muted-foreground px-3 pt-3 text-xs font-medium">
        Shared with me
      </p>
      {grouped.unfiledShared.map((b) => (
        <SharedBoardRow
          key={b.id}
          board={b}
          isActive={b.id === activeBoardId}
        />
      ))}
    </>
  ) : null}
</NavSection>
```

Note the "No boards yet" condition now also checks `grouped.folders.length` — otherwise a user whose only boards are all filed would see "No boards yet" printed under their populated folders.

- [ ] **Step 8: Thread the props through the shell**

In `src/components/shell/sidebar-nav.tsx`, add to the imports:

```tsx
import type {
  BoardFolder,
  BoardFolderPlacement,
} from "@/lib/boards/folders/types";
```

add to the props type and destructuring (alongside `boards` / `sharedBoards`):

```tsx
  folders: BoardFolder[];
  placements: BoardFolderPlacement[];
```

and pass them at the `<BoardsNav>` call site:

```tsx
      <BoardsNav
        boards={boards}
        sharedBoards={sharedBoards}
        folders={folders}
        placements={placements}
```

`MobileNav` types its props as `Omit<ComponentProps<typeof SidebarNav>, "forceExpanded">`, so it picks this up with no edit.

- [ ] **Step 9: Add the read to the nav data loader**

In `src/components/shell/sidebar-nav-data.tsx`, import the read:

```tsx
import { listBoardFoldersCached } from "@/lib/boards/folders/queries-cached";
```

extend the **existing** `Promise.all` (do not add a new sequential await — that would be a waterfall):

```tsx
const [boards, sharedBoards, dashboards, folderData] = await Promise.all([
  listMyBoardsCached(userId, activeWorkspaceId),
  listSharedBoardsCached(userId),
  listDashboardsCached(orgId, activeWorkspaceId),
  listBoardFoldersCached(userId),
]);
```

and add to the returned object:

```tsx
    folders: folderData.folders,
    placements: folderData.placements,
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `pnpm test src/components/boards/BoardsNav.test.tsx`
Expected: PASS — all pre-existing tests plus the five new ones.

- [ ] **Step 11: Run the full gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four green. If `pnpm build` reports a stale `.next/types` error, `rm -rf .next/types` and retry.

- [ ] **Step 12: Commit**

```bash
git add src/components/boards/BoardFolderRow.tsx src/components/boards/BoardFolderMenu.tsx src/components/boards/NewFolderDialog.tsx src/components/boards/SharedBoardRow.tsx src/components/boards/BoardsNav.tsx src/components/boards/BoardsNav.test.tsx src/components/shell/sidebar-nav.tsx src/components/shell/sidebar-nav-data.tsx
git commit -m "feat(sidebar): render private board folders in the Boards nav"
```

---

### Task 6: "Move to folder" menus

**Files:**

- Create: `src/components/boards/MoveToFolderMenu.tsx`
- Create: `src/components/boards/SharedBoardMenu.tsx`
- Modify: `src/components/boards/BoardItemMenu.tsx`
- Modify: `src/components/boards/SharedBoardRow.tsx`
- Modify: `src/components/boards/BoardsNav.tsx`, `src/components/boards/BoardsNavSortable.tsx` (pass the new props down)
- Test: `src/components/boards/BoardsNav.test.tsx` (extend)

**Interfaces:**

- Consumes: `moveBoardToFolder` (Task 4), `createFolder` (Task 4), `BoardFolder` (Task 1), `PlainBoardRow` / `SharedBoardRow` (Task 5).
- Produces: `MoveToFolderMenu` — the submenu block reused by both menus.

This is the accessible path and ships as a complete feature on its own. Every entry is reachable by keyboard.

- [ ] **Step 1: Write the failing test**

Append to `src/components/boards/BoardsNav.test.tsx`:

```ts
it("offers a 'Move to folder' entry on an owned board row", async () => {
  render(
    <TooltipProvider>
      <BoardsNav
        boards={[ownedBoard]}
        sharedBoards={[]}
        folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
        placements={[]}
      />
    </TooltipProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Board actions" }));
  expect(await screen.findByText("Move to folder")).toBeInTheDocument();
});

it("offers a 'Move to folder' entry on a shared board row", async () => {
  render(
    <TooltipProvider>
      <BoardsNav
        boards={[]}
        sharedBoards={[sharedBoard]}
        folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
        placements={[]}
      />
    </TooltipProvider>,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Board actions for Design tasks" }),
  );
  expect(await screen.findByText("Move to folder")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm test src/components/boards/BoardsNav.test.tsx`
Expected: FAIL — "Unable to find an element with the text: Move to folder".

- [ ] **Step 3: Write the shared submenu**

Create `src/components/boards/MoveToFolderMenu.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderInput } from "lucide-react";

import { moveBoardToFolder } from "@/lib/boards/folders/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import type { BoardFolder } from "@/lib/boards/folders/types";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The "Move to folder ▸" submenu, shared by the owned-board and shared-board
 * row menus. This is the keyboard path for filing a board — drag is an
 * enhancement on top, never the only way in.
 */
export function MoveToFolderMenu({
  boardId,
  folders,
  currentFolderId,
}: {
  boardId: string;
  folders: BoardFolder[];
  currentFolderId: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function move(folderId: string | null) {
    startTransition(async () => {
      const res = await moveBoardToFolder({ boardId, folderId });
      if (!res.ok) {
        // The dropdown has already closed, so there is no inline surface left.
        showMutationError("Couldn't move the board.", new Error(res.error));
        return;
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInput className="size-4" />
        Move to folder
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-44">
        {folders.length === 0 ? (
          <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
        ) : (
          folders.map((f) => (
            <DropdownMenuItem
              key={f.id}
              disabled={f.id === currentFolderId}
              onSelect={() => move(f.id)}
            >
              {f.name}
            </DropdownMenuItem>
          ))
        )}
        {currentFolderId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => move(null)}>
              Remove from folder
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
```

- [ ] **Step 4: Add the submenu to the owned-board menu**

In `src/components/boards/BoardItemMenu.tsx`:

1. Import `MoveToFolderMenu` and `type BoardFolder`.
2. Extend the props:

```tsx
export function BoardItemMenu({
  board,
  isActive,
  folders = [],
  currentFolderId = null,
}: {
  board: { id: string; name: string };
  isActive: boolean;
  folders?: BoardFolder[];
  currentFolderId?: string | null;
}) {
```

3. Insert into `<DropdownMenuContent>`, after the `Duplicate` item and before the existing `<DropdownMenuSeparator />`:

```tsx
          <DropdownMenuSeparator />
          <MoveToFolderMenu
            boardId={board.id}
            folders={folders}
            currentFolderId={currentFolderId}
          />
```

- [ ] **Step 5: Write the shared-board menu**

Create `src/components/boards/SharedBoardMenu.tsx`. A shared board is not yours: move entries only — no rename, duplicate, or delete.

```tsx
"use client";

import { MoreHorizontal } from "lucide-react";

import type { BoardFolder } from "@/lib/boards/folders/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoveToFolderMenu } from "@/components/boards/MoveToFolderMenu";

export function SharedBoardMenu({
  board,
  folders,
  currentFolderId,
}: {
  board: { id: string; name: string };
  folders: BoardFolder[];
  currentFolderId: string | null;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Board actions for ${board.name}`}
          className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <MoveToFolderMenu
          boardId={board.id}
          folders={folders}
          currentFolderId={currentFolderId}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 6: Host the menu on the shared row**

`SharedBoardRow` currently renders a bare `<Link>`. A dropdown trigger cannot live inside an anchor — restructure it the way `PlainBoardRow` already does: a wrapping `<div class="group/row flex …">` carrying the hover/active classes, with the `<Link>` as the truncating flex child and the menu as a sibling.

```tsx
export function SharedBoardRow({
  board,
  isActive,
  folders = [],
  currentFolderId = null,
}: {
  board: SharedBoardEntry;
  isActive: boolean;
  folders?: BoardFolder[];
  currentFolderId?: string | null;
}) {
  return (
    <div
      className={cn(
        "group/row flex items-center gap-1 rounded-md pr-1 pl-3 transition-colors",
        isActive
          ? "bg-primary/80 text-foreground"
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      <Link
        href={`/boards/${board.id}`}
        aria-current={isActive ? "page" : undefined}
        className="min-w-0 flex-1 truncate py-1 text-xs"
      >
        {board.name}
      </Link>
      {/* viewer-eye and Shared-by tooltip unchanged from Task 5 */}
      <SharedBoardMenu
        board={{ id: board.id, name: board.name }}
        folders={folders}
        currentFolderId={currentFolderId}
      />
    </div>
  );
}
```

- [ ] **Step 7: Pass folders down from `BoardsNav`**

`BoardsNav` already has `folders` and computes `grouped`. Pass `folders` plus the row's own `currentFolderId` to every row:

- Inside a folder: `currentFolderId={folder.id}`.
- Unfiled rows: `currentFolderId={null}`.
- `BoardsNavSortable` needs `folders` added to its props and forwarded to the `BoardItemMenu` inside `SortableBoardRow` (with `currentFolderId={null}` — only unfiled boards reach the sortable list).
- `PlainBoardRow` needs `folders` and `currentFolderId` props forwarded to its `BoardItemMenu`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm test src/components/boards/BoardsNav.test.tsx`
Expected: PASS, including the two new tests.

- [ ] **Step 9: Run the full gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add src/components/boards/MoveToFolderMenu.tsx src/components/boards/SharedBoardMenu.tsx src/components/boards/BoardItemMenu.tsx src/components/boards/SharedBoardRow.tsx src/components/boards/BoardsNav.tsx src/components/boards/BoardsNavSortable.tsx src/components/boards/BoardsNav.test.tsx
git commit -m "feat(sidebar): move a board into a folder from its row menu"
```

**This is the point at which the feature is shippable.** If Task 7 runs long, stop here, merge, and take drag as a follow-up.

---

### Task 7: Drag a board onto a folder

**Files:**

- Modify: `src/components/boards/BoardsNavSortable.tsx`
- Modify: `src/components/boards/BoardFolderRow.tsx`
- Modify: `src/components/boards/BoardsNav.tsx`
- Test: `src/components/boards/BoardsNav.test.tsx` (extend)

**Interfaces:**

- Consumes: everything from Tasks 5 and 6.
- Produces: no new exported API — folder rows become `@dnd-kit` drop targets.

Read `BoardsNavSortable.tsx` end to end first. Three existing constraints must survive:

1. **The `@dnd-kit` stack stays out of the shell bundle** — it is a `next/dynamic({ ssr: false })` chunk mounted on first pointer/focus. Do not import `@dnd-kit` into `BoardsNav.tsx` or `BoardFolderRow.tsx` at module scope.
2. **Reorder is deliberately not revalidated** (gotcha-44 — revalidating reloads the whole sidebar); the optimistic order is authoritative. A _move between folders_, by contrast, **does** change what the server renders, so it goes through `moveBoardToFolder` + `router.refresh()`.
3. **`useTouchAwareSensors`** provides the 6px mouse activation distance and 200ms touch long-press. Keep using it — a quick swipe must still scroll the list.

The structural change: the `DndContext` must wrap **both** the folder rows and the unfiled list, so it moves up from `BoardsNavSortable` into a new client wrapper that `BoardsNav` mounts lazily in place of today's `BoardsNavSortable`. Keep `SortableContext` (vertical reorder) scoped to the unfiled list only; folder rows are `useDroppable` targets, not sortable items.

- [ ] **Step 1: Write the failing test**

Append to `src/components/boards/BoardsNav.test.tsx`:

```ts
it("marks folder rows as drop targets once the drag layer mounts", async () => {
  render(
    <TooltipProvider>
      <BoardsNav
        boards={[ownedBoard]}
        sharedBoards={[]}
        folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
        placements={[]}
      />
    </TooltipProvider>,
  );

  // The lazy dnd layer mounts on first pointer interaction over the list.
  fireEvent.pointerEnter(screen.getByTestId("boards-nav-owned"));

  const target = await screen.findByTestId("folder-drop-f1");
  expect(target).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test src/components/boards/BoardsNav.test.tsx`
Expected: FAIL — "Unable to find an element by: [data-testid="folder-drop-f1"]".

- [ ] **Step 3: Make the folder row droppable**

Add optional drop-target props to `BoardFolderRow` so the component itself stays free of `@dnd-kit` imports (the hook is called by the lazy wrapper and its result passed in):

```tsx
export function BoardFolderRow({
  folder,
  count,
  dropRef,
  isOver = false,
  children,
}: {
  folder: { id: string; name: string };
  count: number;
  dropRef?: (node: HTMLElement | null) => void;
  isOver?: boolean;
  children: ReactNode;
}) {
```

Attach to the header row and reflect the hover state with an existing token:

```tsx
      <div
        ref={dropRef}
        data-testid={dropRef ? `folder-drop-${folder.id}` : undefined}
        className={cn(
          "group/folder text-muted-foreground hover:bg-state-hover hover:text-foreground flex items-center rounded-md pr-1 transition-colors",
          isOver && "bg-state-hover ring-primary/60 text-foreground ring-1",
        )}
      >
```

Auto-expand on hover-over: when `isOver` is true and the folder is collapsed, call `toggleSection(key)` from a `useEffect` guarded on `isOver && !open`, so dropping into a closed folder shows where the board landed.

- [ ] **Step 4: Lift the `DndContext`**

In `BoardsNavSortable.tsx`, change the exported component to accept the folder tree and render it:

```tsx
export function BoardsNavSortable({
  boards,
  folders,
  folderChildren,
  activeBoardId,
}: {
  boards: BoardListEntry[];
  folders: BoardFolder[];
  folderChildren: (folderId: string) => ReactNode;
  activeBoardId?: string;
}) {
```

Wrap folder rows + the `SortableContext` in one `DndContext`. **Drop `restrictToVerticalAxis`** — with folder targets in play a drag is no longer purely vertical; if reorder feels loose without it, re-add it only around the `SortableContext` items.

In `handleDragEnd`, branch on the drop target's id:

```tsx
function handleDragEnd(e: DragEndEvent) {
  const { active, over } = e;
  if (!over || active.id === over.id) return;

  // Dropped on a folder header → file the board. This DOES change server data,
  // so unlike reorder (gotcha-44) it revalidates.
  const folderTarget = String(over.id).startsWith("folder:")
    ? String(over.id).slice("folder:".length)
    : null;
  if (folderTarget) {
    void moveBoardToFolder({
      boardId: String(active.id),
      folderId: folderTarget,
    }).then((res) => {
      if (!res.ok) {
        toast.error("Couldn't move the board.", { description: res.error });
        return;
      }
      router.refresh();
    });
    return;
  }

  // …existing reorder path, unchanged…
}
```

Register each folder header with `useDroppable({ id: \`folder:${folder.id}\` })`inside a small local component, and pass its`setNodeRef`/`isOver`into`BoardFolderRow`as`dropRef`/`isOver`.

- [ ] **Step 5: Make the drag layer own the folder tree in `BoardsNav`**

`BoardsNav` renders folder rows plainly before `dndReady`, and hands them to the lazy wrapper after. Pass `folderChildren` as a callback that returns the same row elements Task 5 renders, so the markup is defined once.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test src/components/boards/BoardsNav.test.tsx`
Expected: PASS, including the new drop-target test.

- [ ] **Step 7: Verify by hand in the running app**

```bash
pnpm dev
```

Open the app, drag an unfiled board onto a folder header, confirm it lands inside and survives a reload. Then drag a _shared_ board (from "Shared with me") onto a folder and confirm the same. Confirm reorder within the unfiled list still works and still does not reload the sidebar.

- [ ] **Step 8: Run the full gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add src/components/boards/BoardsNavSortable.tsx src/components/boards/BoardFolderRow.tsx src/components/boards/BoardsNav.tsx src/components/boards/BoardsNav.test.tsx
git commit -m "feat(sidebar): drag a board onto a folder to file it"
```

---

## Closing the task

- [ ] **Run `scripts/finish-task.sh` from inside the worktree.** It rebases onto the latest `develop`, runs all four gates against the merged state, merges, pushes, then removes the worktree and deletes the branch. A `task/*` branch left open means the task is **not** finished.

- [ ] **Hand the user a "How to test this" walkthrough** — numbered, concrete, with the expected result at each step. Draft:

  1. Pull `develop` and reload the app (the deployment runs the DEV database, so your real boards are there).
  2. In the sidebar's **Boards** section, click the **new-folder icon** in the section header. Name it `Acme Rebrand` and create it. → An empty folder does not appear yet (folders only render once they hold a visible board) — this is expected.
  3. Hover one of your own boards, open its `⋯` menu → **Move to folder** → `Acme Rebrand`. → The board disappears from the flat list and reappears nested under a folder row showing a count of 1.
  4. Hover a board under **Shared with me**, open its new `⋯` menu → **Move to folder** → `Acme Rebrand`. → It nests under the same folder, still showing the "Shared by …" icon; if it was your only shared board, the "Shared with me" heading disappears.
  5. Click the folder's chevron. → It collapses instantly with no page flicker or reload. Reload the page → it is still collapsed.
  6. Drag an unfiled board onto the folder header. → The header highlights, the folder expands, and the board lands inside.
  7. Open the folder's `⋯` menu → **Rename**, then **Delete**. → After deleting, the boards inside reappear in your main list, unharmed.
  8. Switch workspaces (workspace picker at the top). → A folder holding only boards from the other workspace vanishes rather than showing empty; a folder holding a shared board still shows it.
  9. Sign in as a different user. → None of your folders appear in their sidebar.

- [ ] **Run `/wrapup`** to log a session note in `vault/sessions/` and bump `vault/00-north-star.md`, including the "How to test" section above.

## Self-Review

**Spec coverage:** §1 Schema → Task 1. §2 RLS → Task 1 (steps 2, 5, 8). §3 Reads → Task 2. §4 Perf budget → Task 2 (limits, tag), Task 5 step 9 (parallel `Promise.all`), Task 5 step 5 (`useUIStore`, no round-trip), Task 4 (single-tag invalidation). §5 Pure fold → Task 3. §6 UI → Task 5. §7 Two increments → Tasks 6 and 7. §8 Actions → Task 4. Error handling → Task 2 (empty-on-error vs throw), Task 4 (`fail`), Task 6 (`showMutationError`). Testing → every task. Out-of-scope items appear in no task.

**Deviation from the spec's DAG, deliberate:** `types.ts` moved from Task 2 into Task 1 so Tasks 2, 3 and 4 are fully disjoint and can run as one parallel batch. Task 2 retains sole ownership of `src/lib/cache/tags.ts`.

**Named but unwritten (verify before use):** `public.can_read_board(uuid)` and `public.set_updated_at()` already exist in `supabase/migrations/` — confirmed present, not invented. `useUIStore.collapsedSections` / `toggleSection`, `showMutationError`, `showUndoToast`, `useTouchAwareSensors`, `reorderPosition`, and the `DropdownMenuSub*` primitives all exist today.

**Type consistency:** `BoardFolder` = `{ id, name, position }` everywhere. `BoardFolderPlacement` uses camelCase `boardId` / `folderId` in TS and snake_case in SQL, mapped once in `queries-cached.ts` and `queries.ts`. `moveBoardToFolder` takes `folderId: string | null` in every call site. `NavBoard` is `{ kind, board }` in both `group.ts` and `BoardsNav.tsx`.
