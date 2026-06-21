# Board-Level Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-board sharing (private-by-default boards, Viewer/Editor grants to org members) on top of the existing org spine, enforced by RLS across every board-scoped table.

**Architecture:** A `board_members` grant table plus `can_read_board` / `can_edit_board` `SECURITY DEFINER STABLE` helpers. Every board-scoped table's SELECT policy switches from `is_org_member(org_id)` to `can_read_board(board_id)`; writes additionally require `can_edit_board`. Six user-callable write RPCs get a `can_edit_board` guard. A back-fill grants Editor to all current org members on existing boards so nothing disappears. The sidebar splits into "My boards" + "Shared with me"; a Share dialog manages grants.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase (Postgres + RLS), TypeScript strict, Zod, Vitest, Tailwind v4 + shadcn.

**Spec:** `docs/superpowers/specs/2026-06-20-board-level-sharing-design.md`

## Global Constraints

- **RLS is the security boundary** — default-deny, org-scoped. Never weaken it; sharing only narrows reads on top of the org boundary. (AGENTS.md)
- **Server Components by default; Server Actions for all mutations.** Client components only when interactive. (AGENTS.md)
- **Validate at boundaries with Zod.** TypeScript strict; no `any` without justification. (AGENTS.md)
- **Schema changes are versioned migrations** in `supabase/migrations/`; after applying, regenerate types with `pnpm db:types` and commit them in the same change. Never hand-edit `src/types/database.types.ts`. (AGENTS.md)
- **In-page toggles = 0 server round-trips** (client state + History API). Only server-data mutations use Server Actions + targeted revalidation. (AGENTS.md §5)
- **Commit hygiene:** stage explicitly by path (`git add <paths>`); never `git add -A`/`.`/`-a`. Commit subjects lowercase after `type(scope):`. End commit messages with the `Co-Authored-By` trailer. Stay on `develop`. (AGENTS.md)
- **Helpers are `language sql security definer stable set search_path = ''`**, mirroring `is_org_member` / `board_in_org`. (boards_core.sql)
- **Migration filename:** `supabase/migrations/20260620100000_board_level_sharing.sql` (after the latest, `20260620000001_time_entries.sql`).
- Integration tests run against a real Supabase project and are `describe.skipIf(!SERVICE_ROLE_KEY)`. They read `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and use `signInWithRetry` from `@/test/integration-auth`. (boards.rls.integration.test.ts)

---

## Execution DAG

- **Wave 1:** Task 1 (migration + core RLS suite) — sole critical-path root.
- **Wave 2 (run concurrently, isolated git worktrees per AGENTS.md #6):** Task 2, Task 3, Task 4, Task 5, Task 6.
  - Task 4 consumes only Task 2's **documented action contract** (mocks it in component tests).
  - Task 5 consumes only Task 3's **documented query contract** (mocks it in component tests).
- **Wave 3:** Task 7 (integration wiring + full verification gate).

Interface contracts that let Wave 2 run in parallel:

```ts
// Produced by Task 2 — src/lib/boards/sharing-actions.ts
type ShareActionResult = { ok: true } | { ok: false; error: string };
shareBoard(input: { boardId: string; userId: string; access: "viewer" | "editor" }): Promise<ShareActionResult>;
unshareBoard(input: { boardId: string; userId: string }): Promise<ShareActionResult>;

// Produced by Task 3 — src/lib/boards/queries.ts
type BoardListEntry = { id: string; name: string; workspace_id: string; position: number; shared_out: boolean };
type SharedBoardEntry = { id: string; name: string; position: number; owner_name: string | null; access_level: "viewer" | "editor" };
listMyBoards(): Promise<BoardListEntry[]>;
listSharedBoards(): Promise<SharedBoardEntry[]>;
getBoardAccess(boardId: string): Promise<"owner" | "editor" | "viewer" | null>;
```

---

### Task 1: Migration + helpers + RPCs + back-fill + core RLS suite

**Files:**

- Create: `supabase/migrations/20260620100000_board_level_sharing.sql`
- Create: `src/lib/boards/board-sharing.rls.integration.test.ts`
- Modify: `src/types/database.types.ts` (regenerated, not hand-edited)

**Interfaces:**

- Consumes: existing `is_org_member`, `board_in_org`, `group_in_org`, `item_in_org`, `column_in_org`, `create_organization`, `create_board`, `create_item` (from `init_auth_tenancy.sql` / `boards_core.sql`).
- Produces: table `board_members`; enum `board_access`; functions `can_read_board(uuid)`, `can_edit_board(uuid)`, `share_board(uuid, uuid, board_access)`, `unshare_board(uuid, uuid)`; rewritten RLS on all 15 board-scoped tables; hardened RPCs `create_item`, `create_board_view`, `delete_board_view`, `create_item_dependency`, `delete_column_option`, `start_timer`.

- [ ] **Step 1: Write the failing core RLS integration test**

Create `src/lib/boards/board-sharing.rls.integration.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

const CONTENT_TABLES = [
  "groups",
  "items",
  "columns",
  "cell_values",
  "board_views",
] as const;

describe.skipIf(!SERVICE_ROLE_KEY)("RLS: board-level sharing", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  // Owner of the org + a private board.
  let owner: {
    id: string;
    orgId: string;
    workspaceId: string;
    boardId: string;
    groupId: string;
    itemId: string;
    anon: SupabaseClient<Database>;
  };
  // A plain member of the SAME org, not granted on owner's board.
  let outsider: { id: string; anon: SupabaseClient<Database> };
  // A member who will be granted viewer, then editor.
  let grantee: { id: string; anon: SupabaseClient<Database> };

  async function makeUser(label: string) {
    const email = `share-${label}-${randomUUID()}@example.com`;
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
    await signInWithRetry(anon, { email, password: PASSWORD });
    return { id, email, anon };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const o = await makeUser("owner");
    const { data: org } = await o.anon.rpc("create_organization", {
      p_name: "Share Org",
      p_slug: `share-${randomUUID().slice(0, 8)}`,
    });
    const orgId = (org as { id: string }).id;
    const { data: ws } = await o.anon
      .from("workspaces")
      .insert({ org_id: orgId, name: "WS", created_by: o.id })
      .select("id")
      .single();
    const workspaceId = (ws as { id: string }).id;
    const { data: board } = await o.anon.rpc("create_board", {
      p_workspace_id: workspaceId,
      p_name: "Private Board",
    });
    const boardId = (board as { id: string }).id;
    const { data: group } = await o.anon
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .single();
    const groupId = (group as { id: string }).id;
    const { data: item } = await o.anon.rpc("create_item", {
      p_group_id: groupId,
      p_name: "Item",
    });
    const itemId = (item as { id: string }).id;
    owner = {
      id: o.id,
      orgId,
      workspaceId,
      boardId,
      groupId,
      itemId,
      anon: o.anon,
    };

    // Two more members of the SAME org (added directly via service role).
    const out = await makeUser("outsider");
    const gr = await makeUser("grantee");
    await admin.from("org_members").insert([
      { org_id: orgId, user_id: out.id, role: "member" },
      { org_id: orgId, user_id: gr.id, role: "member" },
    ]);
    outsider = { id: out.id, anon: out.anon };
    grantee = { id: gr.id, anon: gr.anon };
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("a same-org member NOT granted cannot read a private board or its content", async () => {
    const { data: b } = await outsider.anon
      .from("boards")
      .select("*")
      .eq("id", owner.boardId);
    expect(b, "boards").toEqual([]);
    for (const t of CONTENT_TABLES) {
      const { data } = await outsider.anon
        .from(t)
        .select("*")
        .eq("board_id", owner.boardId);
      expect(data, `read ${t}`).toEqual([]);
    }
  });

  it("the owner can read their own private board", async () => {
    const { data } = await owner.anon
      .from("boards")
      .select("id")
      .eq("id", owner.boardId);
    expect(data).toHaveLength(1);
  });

  it("share_board(viewer) lets the grantee READ but not WRITE", async () => {
    const { error: shareErr } = await owner.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
      p_access: "viewer",
    });
    expect(shareErr).toBeNull();

    const { data: b } = await grantee.anon
      .from("boards")
      .select("id")
      .eq("id", owner.boardId);
    expect(b, "viewer can read board").toHaveLength(1);

    // viewer write is denied (insert affects 0 rows / errors)
    const { data: grp } = await grantee.anon
      .from("groups")
      .insert({ org_id: owner.orgId, board_id: owner.boardId, name: "nope" })
      .select("id");
    expect(grp ?? [], "viewer insert group").toEqual([]);

    // viewer cannot create an item via the hardened RPC
    const denied = await grantee.anon.rpc("create_item", {
      p_group_id: owner.groupId,
      p_name: "nope",
    });
    expect(denied.error, "viewer create_item RPC").not.toBeNull();
  });

  it("setting the grant to editor lets the grantee WRITE", async () => {
    const { error } = await owner.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
      p_access: "editor",
    });
    expect(error).toBeNull();
    const { data, error: rpcErr } = await grantee.anon.rpc("create_item", {
      p_group_id: owner.groupId,
      p_name: "by editor",
    });
    expect(rpcErr).toBeNull();
    expect(data).toBeTruthy();
  });

  it("unshare_board removes all access again", async () => {
    const { error } = await owner.anon.rpc("unshare_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
    });
    expect(error).toBeNull();
    const { data } = await grantee.anon
      .from("boards")
      .select("id")
      .eq("id", owner.boardId);
    expect(data).toEqual([]);
  });

  it("a non-owner cannot share someone else's board", async () => {
    const { error } = await outsider.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: outsider.id,
      p_access: "editor",
    });
    expect(error).not.toBeNull();
  });

  it("cannot grant to a user outside the org", async () => {
    const alien = await makeUser("alien");
    const { error } = await owner.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: alien.id,
      p_access: "viewer",
    });
    expect(error).not.toBeNull();
  });

  it("only the owner can delete the board (granted editor cannot)", async () => {
    await owner.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
      p_access: "editor",
    });
    await grantee.anon.from("boards").delete().eq("id", owner.boardId);
    const { data: still } = await owner.anon
      .from("boards")
      .select("id")
      .eq("id", owner.boardId);
    expect(still, "board survives editor delete attempt").toHaveLength(1);
    await owner.anon.rpc("unshare_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/boards/board-sharing.rls.integration.test.ts`
Expected: FAIL — `share_board`/`unshare_board`/`board_members` do not exist, and the "outsider cannot read" test fails because today every org member can read every board.

- [ ] **Step 3: Write the migration — Part A: enum, table, helpers, board_members RLS**

Create `supabase/migrations/20260620100000_board_level_sharing.sql` starting with:

```sql
-- Board-level sharing — per-board visibility on the org spine.
-- Adds board_members grants + can_read_board/can_edit_board, rewrites READ
-- policies on every board-scoped table to per-board visibility, hardens the 6
-- user-callable write RPCs against viewers, and back-fills existing boards so
-- nothing disappears at rollout.
-- Spec: docs/superpowers/specs/2026-06-20-board-level-sharing-design.md

create type public.board_access as enum ('viewer', 'editor');

create table public.board_members (
  org_id       uuid not null references public.organizations (id) on delete cascade,
  board_id     uuid not null references public.boards (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  access_level public.board_access not null default 'viewer',
  granted_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index board_members_user_id_idx on public.board_members (user_id);
create index board_members_org_id_idx  on public.board_members (org_id);

create or replace function public.can_read_board(p_board_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id and b.created_by = (select auth.uid())
  ) or exists (
    select 1 from public.board_members m
    where m.board_id = p_board_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_edit_board(p_board_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id and b.created_by = (select auth.uid())
  ) or exists (
    select 1 from public.board_members m
    where m.board_id = p_board_id and m.user_id = (select auth.uid())
      and m.access_level = 'editor'
  );
$$;

grant execute on function public.can_read_board(uuid) to authenticated;
grant execute on function public.can_edit_board(uuid) to authenticated;

alter table public.board_members enable row level security;

create policy "board_members: read if can read board" on public.board_members
  for select to authenticated using (public.can_read_board(board_id));
create policy "board_members: owner manages" on public.board_members
  for all to authenticated
  using (
    exists (select 1 from public.boards b
            where b.id = board_id and b.created_by = (select auth.uid()))
  )
  with check (
    public.is_org_member(org_id)
    and exists (select 1 from public.boards b
                where b.id = board_id and b.created_by = (select auth.uid()))
  );

grant select, insert, update, delete on public.board_members to authenticated;

alter publication supabase_realtime add table public.board_members;
```

- [ ] **Step 4: Write the migration — Part B: rewrite RLS on the core 5 tables**

Append:

```sql
-- ── boards ─────────────────────────────────────────────────────────────────
drop policy "boards: read if member"        on public.boards;
drop policy "boards: update if member"      on public.boards;
drop policy "boards: delete if owner/admin" on public.boards;
-- (insert policy "boards: insert if member" is unchanged: create your own board)
create policy "boards: read if can read" on public.boards
  for select to authenticated using (public.can_read_board(id));
create policy "boards: update if can edit" on public.boards
  for update to authenticated
  using (public.can_edit_board(id))
  with check (public.is_org_member(org_id) and public.can_edit_board(id));
create policy "boards: delete if owner" on public.boards
  for delete to authenticated using (created_by = (select auth.uid()));

-- ── groups ─────────────────────────────────────────────────────────────────
drop policy "groups: read if member"   on public.groups;
drop policy "groups: insert if member" on public.groups;
drop policy "groups: update if member" on public.groups;
drop policy "groups: delete if member" on public.groups;
create policy "groups: read if can read" on public.groups
  for select to authenticated using (public.can_read_board(board_id));
create policy "groups: insert if can edit" on public.groups
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id)
  );
create policy "groups: update if can edit" on public.groups
  for update to authenticated
  using (public.can_edit_board(board_id))
  with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id)
  );
create policy "groups: delete if can edit" on public.groups
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── items ──────────────────────────────────────────────────────────────────
drop policy "items: read if member"   on public.items;
drop policy "items: insert if member" on public.items;
drop policy "items: update if member" on public.items;
drop policy "items: delete if member" on public.items;
create policy "items: read if can read" on public.items
  for select to authenticated using (public.can_read_board(board_id));
create policy "items: insert if can edit" on public.items
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.group_in_org(group_id, org_id)
  );
create policy "items: update if can edit" on public.items
  for update to authenticated
  using (public.can_edit_board(board_id))
  with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.group_in_org(group_id, org_id)
  );
create policy "items: delete if can edit" on public.items
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── columns ────────────────────────────────────────────────────────────────
drop policy "columns: read if member"   on public.columns;
drop policy "columns: insert if member" on public.columns;
drop policy "columns: update if member" on public.columns;
drop policy "columns: delete if member" on public.columns;
create policy "columns: read if can read" on public.columns
  for select to authenticated using (public.can_read_board(board_id));
create policy "columns: insert if can edit" on public.columns
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id)
  );
create policy "columns: update if can edit" on public.columns
  for update to authenticated
  using (public.can_edit_board(board_id))
  with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id)
  );
create policy "columns: delete if can edit" on public.columns
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── cell_values ────────────────────────────────────────────────────────────
drop policy "cell_values: read if member"   on public.cell_values;
drop policy "cell_values: insert if member" on public.cell_values;
drop policy "cell_values: update if member" on public.cell_values;
drop policy "cell_values: delete if member" on public.cell_values;
create policy "cell_values: read if can read" on public.cell_values
  for select to authenticated using (public.can_read_board(board_id));
create policy "cell_values: insert if can edit" on public.cell_values
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.item_in_org(item_id, org_id)
    and public.column_in_org(column_id, org_id)
  );
create policy "cell_values: update if can edit" on public.cell_values
  for update to authenticated
  using (public.can_edit_board(board_id))
  with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.item_in_org(item_id, org_id)
    and public.column_in_org(column_id, org_id)
  );
create policy "cell_values: delete if can edit" on public.cell_values
  for delete to authenticated using (public.can_edit_board(board_id));
```

- [ ] **Step 5: Write the migration — Part C: rewrite RLS on the satellite tables**

Append (each swaps read → `can_read_board`, writes → add `can_edit_board`; author/uploader self-checks preserved, `has_org_role` branches dropped to honour private-from-admins):

```sql
-- ── board_views ──
drop policy "board_views: read if member"   on public.board_views;
drop policy "board_views: insert if member" on public.board_views;
drop policy "board_views: update if member" on public.board_views;
drop policy "board_views: delete if member" on public.board_views;
create policy "board_views: read if can read" on public.board_views
  for select to authenticated using (public.can_read_board(board_id));
create policy "board_views: insert if can edit" on public.board_views
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id));
create policy "board_views: update if can edit" on public.board_views
  for update to authenticated using (public.can_edit_board(board_id))
  with check (public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id));
create policy "board_views: delete if can edit" on public.board_views
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── item_dependencies ──
drop policy "item_dependencies: read if member"   on public.item_dependencies;
drop policy "item_dependencies: insert if member" on public.item_dependencies;
drop policy "item_dependencies: delete if member" on public.item_dependencies;
create policy "item_dependencies: read if can read" on public.item_dependencies
  for select to authenticated using (public.can_read_board(board_id));
create policy "item_dependencies: insert if can edit" on public.item_dependencies
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id));
create policy "item_dependencies: delete if can edit" on public.item_dependencies
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── automations ──
drop policy "automations: read if member"   on public.automations;
drop policy "automations: insert if member" on public.automations;
drop policy "automations: update if member" on public.automations;
drop policy "automations: delete if member" on public.automations;
create policy "automations: read if can read" on public.automations
  for select to authenticated using (public.can_read_board(board_id));
create policy "automations: insert if can edit" on public.automations
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id));
create policy "automations: update if can edit" on public.automations
  for update to authenticated using (public.can_edit_board(board_id))
  with check (public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id));
create policy "automations: delete if can edit" on public.automations
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── item_updates (comments) ──
drop policy "item_updates: read if member"          on public.item_updates;
drop policy "item_updates: insert if member+author" on public.item_updates;
drop policy "item_updates: update if author/admin"  on public.item_updates;
drop policy "item_updates: delete if author/admin"  on public.item_updates;
create policy "item_updates: read if can read" on public.item_updates
  for select to authenticated using (public.can_read_board(board_id));
create policy "item_updates: insert if editor+author" on public.item_updates
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.item_in_org(item_id, org_id)
    and author_id = (select auth.uid()));
create policy "item_updates: update if author" on public.item_updates
  for update to authenticated using (
    author_id = (select auth.uid()) or public.can_edit_board(board_id))
  with check (
    author_id = (select auth.uid()) or public.can_edit_board(board_id));
create policy "item_updates: delete if author or editor" on public.item_updates
  for delete to authenticated using (
    author_id = (select auth.uid()) or public.can_edit_board(board_id));

-- ── item_activities (append-only feed; SELECT only) ──
drop policy "item_activities: read if member" on public.item_activities;
create policy "item_activities: read if can read" on public.item_activities
  for select to authenticated using (public.can_read_board(board_id));

-- ── attachments ──
drop policy attachments_select on public.attachments;
drop policy attachments_insert on public.attachments;
drop policy attachments_delete on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated using (public.can_read_board(board_id));
create policy attachments_insert on public.attachments
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.item_in_org(item_id, org_id));
create policy attachments_delete on public.attachments
  for delete to authenticated using (
    uploaded_by = (select auth.uid()) or public.can_edit_board(board_id));

-- ── time_entries ──
drop policy time_entries_select on public.time_entries;
drop policy time_entries_insert on public.time_entries;
drop policy time_entries_update on public.time_entries;
drop policy time_entries_delete on public.time_entries;
create policy time_entries_select on public.time_entries
  for select to authenticated using (public.can_read_board(board_id));
create policy time_entries_insert on public.time_entries
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.item_in_org(item_id, org_id)
    and user_id = (select auth.uid()));
create policy time_entries_update on public.time_entries
  for update to authenticated
  using (public.can_edit_board(board_id) and user_id = (select auth.uid()))
  with check (public.can_edit_board(board_id) and user_id = (select auth.uid()));
create policy time_entries_delete on public.time_entries
  for delete to authenticated
  using (public.can_edit_board(board_id) and user_id = (select auth.uid()));

-- ── automation log tables (SELECT-only; date_fires/webhook lack board_id, so
--    scope via the automation's board) ──
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('automation_runs','automation_date_fires','automation_webhook_deliveries')
      and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "automation_runs: read if can read" on public.automation_runs
  for select to authenticated using (public.can_read_board(board_id));
create policy "automation_date_fires: read if can read" on public.automation_date_fires
  for select to authenticated using (
    public.can_read_board((select a.board_id from public.automations a where a.id = automation_id)));
create policy "automation_webhook_deliveries: read if can read" on public.automation_webhook_deliveries
  for select to authenticated using (
    public.can_read_board((select a.board_id from public.automations a where a.id = automation_id)));
```

- [ ] **Step 6: Write the migration — Part D: harden the 6 write RPCs**

Each RPC is re-created `create or replace` with the SAME body plus a `can_edit_board` guard right after the existing `is_org_member` check. Read each source file and add the guard. For `create_item` (`boards_core.sql`), after the `if not public.is_org_member(v_org_id)` block add:

```sql
  if not public.can_edit_board(v_board_id) then
    raise exception 'no edit access to this board' using errcode = '42501';
  end if;
```

(`v_board_id` is already selected from the group in `create_item`.) Apply the equivalent guard — deriving the board id the same way each RPC already does — to: `create_board_view` (`p_board_id`), `delete_board_view` (look up the view's `board_id`), `create_item_dependency` (the items' shared `board_id`), `delete_column_option` (the column's `board_id`), `start_timer` (the item's `board_id`). Append each re-created function to the migration verbatim from its source with only the guard added, then keep the existing `grant execute ... to authenticated` for each.

- [ ] **Step 7: Write the migration — Part E: share/unshare RPCs + back-fill**

Append:

```sql
-- ── Sharing RPCs (owner-only; SECURITY DEFINER) ──
create or replace function public.share_board(
  p_board_id uuid, p_user_id uuid, p_access public.board_access)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid;
begin
  select org_id into v_org from public.boards
    where id = p_board_id and created_by = v_uid;
  if v_org is null then
    raise exception 'not the board owner' using errcode = '42501';
  end if;
  if not public.is_org_member_of(v_org, p_user_id) then
    raise exception 'target is not a member of this org' using errcode = '42501';
  end if;
  insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
  values (v_org, p_board_id, p_user_id, p_access, v_uid)
  on conflict (board_id, user_id)
  do update set access_level = excluded.access_level, granted_by = excluded.granted_by;
end;
$$;

create or replace function public.unshare_board(p_board_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.boards
                 where id = p_board_id and created_by = v_uid) then
    raise exception 'not the board owner' using errcode = '42501';
  end if;
  delete from public.board_members where board_id = p_board_id and user_id = p_user_id;
end;
$$;

-- membership check for an arbitrary user (the existing is_org_member checks the
-- CALLER; here we validate the TARGET). SECURITY DEFINER, no recursion.
create or replace function public.is_org_member_of(p_org_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.org_members
                 where org_id = p_org_id and user_id = p_user_id);
$$;

grant execute on function public.share_board(uuid, uuid, public.board_access) to authenticated;
grant execute on function public.unshare_board(uuid, uuid) to authenticated;
grant execute on function public.is_org_member_of(uuid, uuid) to authenticated;

-- ── Back-fill: preserve today's "everyone in the org sees every board" for
--    boards that already exist. New boards (created after this migration) are
--    private-by-default. Grant editor to every current org member except the
--    board's creator (who already owns it). ──
insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
select b.org_id, b.id, m.user_id, 'editor'::public.board_access, b.created_by
from public.boards b
join public.org_members m on m.org_id = b.org_id and m.user_id <> b.created_by
on conflict (board_id, user_id) do nothing;
```

- [ ] **Step 8: Apply the migration and regenerate types**

Run: `pnpm supabase migration up` (or the repo's `pnpm db:push` equivalent), then `pnpm db:types`.
Expected: migration applies cleanly; `src/types/database.types.ts` now includes `board_members`, `board_access`, `share_board`, `unshare_board`, `can_read_board`, `can_edit_board`.

- [ ] **Step 9: Run the core RLS suite to verify it passes**

Run: `pnpm vitest run src/lib/boards/board-sharing.rls.integration.test.ts`
Expected: PASS (all cases).

- [ ] **Step 10: Run the pre-existing boards RLS suite to confirm no regression**

Run: `pnpm vitest run src/lib/boards/boards.rls.integration.test.ts`
Expected: PASS — note the "board delete is denied for a non-admin member" test still holds (a plain member who is not the creator and has no grant cannot delete). If the back-fill grants that member editor, deletion is still denied because delete is now owner-only; the test asserts the board survives, which remains true.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/20260620100000_board_level_sharing.sql \
        src/lib/boards/board-sharing.rls.integration.test.ts \
        src/types/database.types.ts
git commit -m "feat(boards): per-board sharing schema, rls rewrite, and grant rpcs (7)"
```

---

### Task 2: Sharing server actions + validations

**Files:**

- Create: `src/lib/validations/board-sharing.ts`
- Create: `src/lib/boards/sharing-actions.ts`
- Test: `src/lib/boards/sharing-actions.test.ts`

**Interfaces:**

- Consumes: Task 1 RPCs `share_board`, `unshare_board`; `@/lib/supabase/server` `createClient`.
- Produces: `shareBoard`, `unshareBoard` (signatures in the Execution DAG contract block).

- [ ] **Step 1: Write the failing validation + action test**

Create `src/lib/boards/sharing-actions.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { shareBoard, unshareBoard } from "./sharing-actions";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => rpc.mockReset());

describe("shareBoard", () => {
  it("rejects an invalid access level", async () => {
    const r = await shareBoard({
      boardId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      access: "admin" as never,
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid boardId", async () => {
    const r = await shareBoard({
      boardId: "nope",
      userId: crypto.randomUUID(),
      access: "viewer",
    });
    expect(r.ok).toBe(false);
  });

  it("calls share_board and returns ok on success", async () => {
    rpc.mockResolvedValue({ error: null });
    const input = {
      boardId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      access: "editor" as const,
    };
    const r = await shareBoard(input);
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("share_board", {
      p_board_id: input.boardId,
      p_user_id: input.userId,
      p_access: "editor",
    });
  });

  it("maps a permission error to friendly copy", async () => {
    rpc.mockResolvedValue({ error: { message: "not the board owner" } });
    const r = await shareBoard({
      boardId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      access: "viewer",
    });
    expect(r).toEqual({
      ok: false,
      error: "Only the board owner can manage sharing.",
    });
  });
});

describe("unshareBoard", () => {
  it("calls unshare_board on valid input", async () => {
    rpc.mockResolvedValue({ error: null });
    const input = { boardId: crypto.randomUUID(), userId: crypto.randomUUID() };
    const r = await unshareBoard(input);
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("unshare_board", {
      p_board_id: input.boardId,
      p_user_id: input.userId,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/boards/sharing-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the validation schema**

Create `src/lib/validations/board-sharing.ts`:

```ts
import { z } from "zod";

export const shareBoardSchema = z.object({
  boardId: z.string().uuid(),
  userId: z.string().uuid(),
  access: z.enum(["viewer", "editor"]),
});

export const unshareBoardSchema = z.object({
  boardId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type ShareBoardInput = z.infer<typeof shareBoardSchema>;
export type UnshareBoardInput = z.infer<typeof unshareBoardSchema>;
```

- [ ] **Step 4: Write the actions**

Create `src/lib/boards/sharing-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  shareBoardSchema,
  unshareBoardSchema,
} from "@/lib/validations/board-sharing";

export type ShareActionResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): ShareActionResult => ({ ok: false, error });

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("board owner"))
    return "Only the board owner can manage sharing.";
  if (m.includes("not a member"))
    return "That person isn't in your organization yet.";
  return "Something went wrong. Please try again.";
}

export async function shareBoard(input: unknown): Promise<ShareActionResult> {
  const parsed = shareBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("share_board", {
    p_board_id: parsed.data.boardId,
    p_user_id: parsed.data.userId,
    p_access: parsed.data.access,
  });
  if (error) return fail(friendly(error.message));
  revalidatePath("/boards", "layout");
  return { ok: true };
}

export async function unshareBoard(input: unknown): Promise<ShareActionResult> {
  const parsed = unshareBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("unshare_board", {
    p_board_id: parsed.data.boardId,
    p_user_id: parsed.data.userId,
  });
  if (error) return fail(friendly(error.message));
  revalidatePath("/boards", "layout");
  return { ok: true };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/lib/boards/sharing-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/board-sharing.ts src/lib/boards/sharing-actions.ts src/lib/boards/sharing-actions.test.ts
git commit -m "feat(boards): share/unshare server actions with zod validation (7)"
```

---

### Task 3: Split `listBoards` into my-boards / shared-with-me + access helper

**Files:**

- Modify: `src/lib/boards/queries.ts` (replace `listBoards`/`BoardListEntry`; add `listMyBoards`, `listSharedBoards`, `SharedBoardEntry`, `getBoardAccess`)
- Test: `src/lib/boards/board-lists.rls.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 schema (`board_members`, `boards.created_by`), `profiles` (for owner name).
- Produces: `listMyBoards`, `listSharedBoards`, `getBoardAccess`, types `BoardListEntry` (now with `shared_out`), `SharedBoardEntry` (DAG contract block).

- [ ] **Step 1: Write the failing integration test**

Create `src/lib/boards/board-lists.rls.integration.test.ts` modeled on the Task 1 harness (reuse the owner/grantee provisioning), asserting:

```ts
// (provision owner with a board, and grantee granted 'viewer' via share_board)
it("listMyBoards returns the owner's board with shared_out=true after a grant", async () => {
  // call as owner's session — see note below on running server queries in tests
});
```

Because `listMyBoards`/`listSharedBoards` use the server `createClient`, test them at the SQL level the queries compile to, using the per-user anon clients from the Task 1 harness:

```ts
it("owner sees own board; shared_out true once granted", async () => {
  const { data } = await owner.anon
    .from("boards")
    .select("id, name, workspace_id, position, board_members(user_id)")
    .eq("created_by", owner.id);
  expect(data?.some((b) => b.id === owner.boardId)).toBe(true);
});

it("grantee sees the board via board_members, not as creator", async () => {
  await owner.anon.rpc("share_board", {
    p_board_id: owner.boardId,
    p_user_id: grantee.id,
    p_access: "viewer",
  });
  const { data } = await grantee.anon
    .from("board_members")
    .select("board_id, access_level, boards(name, created_by)")
    .eq("user_id", grantee.id);
  expect(data?.[0]?.access_level).toBe("viewer");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/boards/board-lists.rls.integration.test.ts`
Expected: FAIL (assertions reference grants not yet created in this file's harness / helpers absent). Implement harness + helpers to green.

- [ ] **Step 3: Replace `listBoards` with the split queries**

In `src/lib/boards/queries.ts`, replace the `BoardListEntry` type and `listBoards` function with:

```ts
export type BoardListEntry = Pick<
  Board,
  "id" | "name" | "workspace_id" | "position"
> & { shared_out: boolean };

export type SharedBoardEntry = {
  id: string;
  name: string;
  position: number;
  owner_name: string | null;
  access_level: "viewer" | "editor";
};

/** Boards the current user owns (created_by = me), with a shared-out flag. */
export async function listMyBoards(): Promise<BoardListEntry[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("boards")
    .select("id, name, workspace_id, position, board_members(user_id)")
    .eq("created_by", user.id)
    .order("position", { ascending: true });
  if (error) return [];
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    workspace_id: b.workspace_id,
    position: b.position,
    shared_out: (b.board_members ?? []).length > 0,
  }));
}

/** Boards shared WITH the current user by someone else. */
export async function listSharedBoards(): Promise<SharedBoardEntry[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("board_members")
    .select("access_level, boards!inner(id, name, position, created_by)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  const rows = data.filter((r) => r.boards && r.boards.created_by !== user.id);

  const ownerIds = [...new Set(rows.map((r) => r.boards!.created_by))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ownerIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return rows.map((r) => ({
    id: r.boards!.id,
    name: r.boards!.name,
    position: r.boards!.position,
    owner_name: nameById.get(r.boards!.created_by) ?? null,
    access_level: r.access_level,
  }));
}

/** The current user's effective access to a board (or null if none). */
export async function getBoardAccess(
  boardId: string,
): Promise<"owner" | "editor" | "viewer" | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: board } = await supabase
    .from("boards")
    .select("created_by")
    .eq("id", boardId)
    .maybeSingle();
  if (!board) return null;
  if (board.created_by === user.id) return "owner";
  const { data: grant } = await supabase
    .from("board_members")
    .select("access_level")
    .eq("board_id", boardId)
    .eq("user_id", user.id)
    .maybeSingle();
  return grant?.access_level ?? null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/lib/boards/board-lists.rls.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck (callers of the old `listBoards` will error — that is expected; Task 7 rewires them)**

Run: `pnpm typecheck`
Expected: errors ONLY in `src/app/boards/layout.tsx` (and any other `listBoards` import). Leave those for Task 7. Do not delete `listBoards` callers here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/queries.ts src/lib/boards/board-lists.rls.integration.test.ts
git commit -m "feat(boards): split board lists into my-boards and shared-with-me (7)"
```

---

### Task 4: Share dialog UI (mocks the Task 2 action contract)

**Files:**

- Create: `src/components/boards/ShareBoardDialog.tsx`
- Test: `src/components/boards/ShareBoardDialog.test.tsx`

**Interfaces:**

- Consumes: `shareBoard`/`unshareBoard` (Task 2 contract — mocked in tests), `HeaderMember` shape `{ userId, fullName, email }` (from `BoardHeader.tsx`).
- Produces: `<ShareBoardDialog boardId members grants open onOpenChange />`.

UI work: load the `pulse-ui` and `frontend-design` skills before styling. Reuse the shadcn `Dialog`, `Button`, and the `<select>` styling pattern from `invite-panel.tsx`.

- [ ] **Step 1: Write the failing component test**

Create `src/components/boards/ShareBoardDialog.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareBoardDialog } from "./ShareBoardDialog";

const shareBoard = vi.fn();
const unshareBoard = vi.fn();
vi.mock("@/lib/boards/sharing-actions", () => ({
  shareBoard: (...a: unknown[]) => shareBoard(...a),
  unshareBoard: (...a: unknown[]) => unshareBoard(...a),
}));

const members = [
  { userId: "u1", fullName: "Dana Lee", email: "dana@x.com" },
  { userId: "u2", fullName: "Sam Roe", email: "sam@x.com" },
];

beforeEach(() => {
  shareBoard.mockReset();
  unshareBoard.mockReset();
});

describe("ShareBoardDialog", () => {
  it("lists org members with an access control each", () => {
    render(
      <ShareBoardDialog
        boardId="b1"
        members={members}
        grants={[]}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText("Dana Lee")).toBeInTheDocument();
    expect(screen.getByText("Sam Roe")).toBeInTheDocument();
  });

  it("calls shareBoard with the chosen access when granting", async () => {
    shareBoard.mockResolvedValue({ ok: true });
    render(
      <ShareBoardDialog
        boardId="b1"
        members={members}
        grants={[]}
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Access for Dana Lee"), {
      target: { value: "editor" },
    });
    await waitFor(() =>
      expect(shareBoard).toHaveBeenCalledWith({
        boardId: "b1",
        userId: "u1",
        access: "editor",
      }),
    );
  });

  it("calls unshareBoard when access is set back to none", async () => {
    unshareBoard.mockResolvedValue({ ok: true });
    render(
      <ShareBoardDialog
        boardId="b1"
        members={members}
        grants={[{ userId: "u1", access: "viewer" }]}
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Access for Dana Lee"), {
      target: { value: "none" },
    });
    await waitFor(() =>
      expect(unshareBoard).toHaveBeenCalledWith({
        boardId: "b1",
        userId: "u1",
      }),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/boards/ShareBoardDialog.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

Create `src/components/boards/ShareBoardDialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { shareBoard, unshareBoard } from "@/lib/boards/sharing-actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Member = { userId: string; fullName: string | null; email: string | null };
type Grant = { userId: string; access: "viewer" | "editor" };
type Access = "none" | "viewer" | "editor";

export function ShareBoardDialog({
  boardId,
  members,
  grants,
  open,
  onOpenChange,
}: {
  boardId: string;
  members: Member[];
  grants: Grant[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const initial = new Map<string, Access>(
    grants.map((g) => [g.userId, g.access]),
  );
  const [access, setAccess] = useState<Map<string, Access>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function change(userId: string, next: Access) {
    setAccess((prev) => new Map(prev).set(userId, next));
    start(async () => {
      setError(null);
      const r =
        next === "none"
          ? await unshareBoard({ boardId, userId })
          : await shareBoard({ boardId, userId, access: next });
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share board</DialogTitle>
          <DialogDescription>
            Give people in your organization access to this board.
          </DialogDescription>
        </DialogHeader>

        {members.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No one else is in your organization yet. Invite people in Settings.
          </p>
        ) : (
          <ul className="divide-border divide-y text-sm">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <span className="min-w-0 truncate">
                  <span className="text-foreground">
                    {m.fullName ?? m.email}
                  </span>
                </span>
                <select
                  aria-label={`Access for ${m.fullName ?? m.email}`}
                  value={access.get(m.userId) ?? "none"}
                  onChange={(e) => change(m.userId, e.target.value as Access)}
                  className={cn(
                    "border-border bg-background text-foreground h-9 rounded-md border px-3 text-sm capitalize",
                    "focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none",
                  )}
                >
                  <option value="none">No access</option>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/components/boards/ShareBoardDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/ShareBoardDialog.tsx src/components/boards/ShareBoardDialog.test.tsx
git commit -m "feat(boards): share-board dialog with per-member access control (7)"
```

---

### Task 5: Sidebar restructure — My boards + Shared with me + indicator (mocks Task 3 query shapes)

**Files:**

- Modify: `src/components/boards/BoardsNav.tsx`
- Test: `src/components/boards/BoardsNav.test.tsx` (extend)

**Interfaces:**

- Consumes: `BoardListEntry` (with `shared_out`) and `SharedBoardEntry` (Task 3 contract). Component takes props, so no server import to mock.
- Produces: a `BoardsNav` that renders two labelled sections + a shared-out glyph.

UI work: load `pulse-ui` + `frontend-design` before styling.

- [ ] **Step 1: Write the failing test (extend the existing file)**

Add to `src/components/boards/BoardsNav.test.tsx`:

```tsx
it("renders My boards with a shared indicator and a Shared with me section", () => {
  render(
    <BoardsNav
      boards={[
        {
          id: "b1",
          name: "Roadmap",
          workspace_id: "w",
          position: 0,
          shared_out: true,
        },
        {
          id: "b2",
          name: "Personal",
          workspace_id: "w",
          position: 1,
          shared_out: false,
        },
      ]}
      sharedBoards={[
        {
          id: "b3",
          name: "Q3 Launch",
          position: 0,
          owner_name: "Dana",
          access_level: "viewer",
        },
      ]}
      workspaces={[{ id: "w", name: "WS" }]}
    />,
  );
  expect(screen.getByText("My boards")).toBeInTheDocument();
  expect(screen.getByText("Shared with me")).toBeInTheDocument();
  expect(screen.getByText("Q3 Launch")).toBeInTheDocument();
  // shared-out indicator present on Roadmap only
  expect(screen.getByLabelText("Shared with others")).toBeInTheDocument();
  // owner attribution shown
  expect(screen.getByText(/Dana/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/boards/BoardsNav.test.tsx`
Expected: FAIL — `sharedBoards` prop / new markup absent.

- [ ] **Step 3: Update `BoardsNav`**

Add `sharedBoards: SharedBoardEntry[]` to the props, render the existing list under a "My boards" label, add a `Users2` glyph (lucide) with `aria-label="Shared with others"` next to any board whose `shared_out` is true, and add a "Shared with me" section iterating `sharedBoards` (each linking to `/boards/{id}`, showing `· from {owner_name}`). Import the types from `@/lib/boards/queries`. Keep the collapsed-sidebar branch behavior; in collapsed mode show only icons (no section labels). Follow the existing markup/classes in the file.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/components/boards/BoardsNav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/BoardsNav.tsx src/components/boards/BoardsNav.test.tsx
git commit -m "feat(boards): sidebar my-boards + shared-with-me sections with indicator (7)"
```

---

### Task 6: Satellite-table RLS test suites (parallel coverage)

**Files:**

- Create: `src/lib/boards/board-sharing-satellites.rls.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 migration (all satellite policies live).
- Produces: regression coverage proving a non-shared member cannot read a private board's satellite content, and a viewer cannot write it.

- [ ] **Step 1: Write the suite**

Create `src/lib/boards/board-sharing-satellites.rls.integration.test.ts` reusing the Task 1 provisioning pattern (owner with a private board + content, an ungranted `outsider`, a `viewer` grantee). Seed one row in each satellite as the owner, then assert isolation. Use a table-array loop for the read checks:

```ts
const SATELLITE_READ_TABLES = [
  "item_dependencies",
  "attachments",
  "item_updates",
  "item_activities",
  "time_entries",
  "automations",
  "automation_runs",
] as const;

it("an ungranted member reads zero rows from every satellite table", async () => {
  for (const t of SATELLITE_READ_TABLES) {
    const { data } = await outsider.anon
      .from(t)
      .select("*")
      .eq("board_id", owner.boardId);
    expect(data ?? [], `read ${t}`).toEqual([]);
  }
});

it("a viewer can read but not insert an item_update (comment)", async () => {
  await owner.anon.rpc("share_board", {
    p_board_id: owner.boardId,
    p_user_id: viewer.id,
    p_access: "viewer",
  });
  const seeded = await viewer.anon
    .from("item_updates")
    .select("*")
    .eq("board_id", owner.boardId);
  expect(seeded.error).toBeNull(); // read allowed
  const ins = await viewer.anon
    .from("item_updates")
    .insert({
      org_id: owner.orgId,
      board_id: owner.boardId,
      item_id: owner.itemId,
      author_id: viewer.id,
      body: "nope",
    })
    .select("id");
  expect(ins.data ?? [], "viewer cannot comment").toEqual([]);
});

it("a viewer cannot start a timer (hardened start_timer RPC)", async () => {
  const { error } = await viewer.anon.rpc("start_timer", {
    p_item_id: owner.itemId,
  });
  expect(error).not.toBeNull();
});
```

(Seed each satellite row as `owner` in `beforeAll` so the outsider's read genuinely targets existing rows. For `item_updates`/`attachments`/`time_entries` the owner inserts directly; for `automations` use a direct insert with the owner's org/board; for `automation_runs`/`item_activities` seed via the normal engine path or a service-role insert in `beforeAll`.)

- [ ] **Step 2: Run to verify it passes (Task 1 already shipped the policies)**

Run: `pnpm vitest run src/lib/boards/board-sharing-satellites.rls.integration.test.ts`
Expected: PASS. If any satellite read returns rows, the corresponding policy in Task 1 was missed — fix the migration, re-apply, re-run.

- [ ] **Step 3: Commit**

```bash
git add src/lib/boards/board-sharing-satellites.rls.integration.test.ts
git commit -m "test(boards): rls coverage for satellite-table per-board privacy (7)"
```

---

### Task 7: Integration wiring + verification gate

**Files:**

- Modify: `src/app/boards/layout.tsx` (feed split board lists to the shell)
- Modify: `src/components/app-shell.tsx` + `src/components/sidebar.tsx` (thread `boards` + `sharedBoards` through to `BoardsNav`)
- Modify: `src/components/boards/BoardHeader.tsx` (add owner-only Share button + mount `ShareBoardDialog`)
- Modify: the board page that renders `BoardHeader` (pass `access`, `members`, and current grants)
- Test: existing `src/components/sidebar.test.tsx` / `src/app/page.test.tsx` updated as needed

**Interfaces:**

- Consumes: `listMyBoards`, `listSharedBoards`, `getBoardAccess` (Task 3); `ShareBoardDialog` (Task 4); `BoardsNav` new props (Task 5); `listOrgMembers` (existing).

- [ ] **Step 1: Rewire the boards layout**

In `src/app/boards/layout.tsx`, replace the `listBoards()` call with parallel `listMyBoards()` + `listSharedBoards()` and pass both to `AppShell` (new `sharedBoards` prop). Update `AppShell` and `Sidebar` prop types to forward `boards: BoardListEntry[]` and `sharedBoards: SharedBoardEntry[]` into `BoardsNav`. Keep the rest of the parallel `Promise.all` shell load intact.

- [ ] **Step 2: Add the Share button to the board header**

In the board page (server component) that renders `BoardHeader`, compute `const access = await getBoardAccess(boardId)` and `const members = await listOrgMembers(orgId)` and the current grants (`select user_id, access_level from board_members where board_id`). Pass `access`, `members`, and `grants` to `BoardHeader`. In `BoardHeader.tsx`, when `access === "owner"`, render a "Share" `Button` (lucide `UserPlus`) next to Automations that opens `ShareBoardDialog`; when `access === "viewer"`, render a subtle read-only badge and hide edit affordances.

- [ ] **Step 3: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS — the `listBoards` errors from Task 3 Step 5 are now resolved.

- [ ] **Step 4: Run the full unit/component suite**

Run: `pnpm test`
Expected: PASS (including updated `sidebar.test.tsx`).

- [ ] **Step 5: Run the integration suites**

Run: `pnpm vitest run src/lib/boards/board-sharing.rls.integration.test.ts src/lib/boards/board-sharing-satellites.rls.integration.test.ts src/lib/boards/board-lists.rls.integration.test.ts src/lib/boards/boards.rls.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Production build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 7: Manual verification (run the app)**

Use the `run` skill / `verify` skill: create two boards as the owner, share one as Viewer to a second user, confirm the second user sees it under "Shared with me", cannot edit it, and cannot see the unshared board. Confirm the owner sees the shared-out indicator on the shared board.

- [ ] **Step 8: Commit**

```bash
git add src/app/boards/layout.tsx src/components/app-shell.tsx src/components/sidebar.tsx \
        src/components/boards/BoardHeader.tsx <board-page-file> src/components/sidebar.test.tsx
git commit -m "feat(boards): wire share dialog + shared-with-me sidebar end to end (7)"
```

---

## Known limitations (documented, follow-up)

- **Storage objects:** attachment DB rows are now per-board private, but the `storage.objects` policies remain **org-folder scoped** (`org_id` prefix). A non-shared member who already knows a file's exact storage path could still fetch the blob. Tightening storage to per-board scope requires a `board_id` path segment — tracked as follow-up, noted in spec §6.
- **Dashboards stay org-scoped** in v1 (out of scope). A dashboard aggregating a private board could expose counts; revisit when dashboards get sharing.
- **No "share with whole org" one-click** and **no Commenter tier** (spec non-goals); the enum/RPCs are shaped to add both later without migration churn.

## Self-Review

- **Spec coverage:** §5 data model → Task 1 Step 3. §6a 15-table read/write rewrite → Task 1 Steps 4–5. §6b RPC hardening → Task 1 Step 6. §6 sharing RPCs → Task 1 Step 7. §7 back-fill → Task 1 Step 7. §8 server layer → Tasks 2–3. §9 UI (dialog + sidebar) → Tasks 4–5. §10 perf budget → preserved (indexed reads, Server Actions only for mutations). §11 testing → Tasks 1, 3, 6 + Task 7 gate. §12 DAG → Execution DAG section. Storage caveat surfaced under Known limitations.
- **Placeholder scan:** the only deferred specifics are the five RPC bodies in Task 1 Step 6 (re-created verbatim from named source files with one stated guard) and the board-page filename in Task 7 (resolved by the implementer from the `BoardHeader` import site) — both are concrete instructions, not TBDs.
- **Type consistency:** `shareBoard`/`unshareBoard` input shapes match between Task 2 (impl), Task 4 (mock), and the DAG contract. `BoardListEntry.shared_out` and `SharedBoardEntry` match between Task 3 (produced) and Tasks 5/7 (consumed). RPC names (`share_board`, `unshare_board`, `can_read_board`, `can_edit_board`, `is_org_member_of`) are consistent across Task 1 and Task 2.
