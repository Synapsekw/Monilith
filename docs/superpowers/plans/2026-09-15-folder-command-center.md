# Folder Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every folder becomes a shared workspace project with an auto-built command center at `/folders/[folderId]` (Overview · Stages · Boards · People), `/dashboards` becomes the folder gallery, and existing widget dashboards fold into their folder's Overview.

**Architecture:** Shared `folders` / `folder_boards` tables replace the private per-user sidebar folders (copied forward once, then dropped). Five `security definer` RPCs (`folder_rollup`, `folder_burn`, `folder_attention`, `folder_workload`, `folder_gallery`) read only indexed columns through one internal per-item flag function that reuses `_board_health_flags`, and gate every board on `can_read_board`. The page is one RSC render (three RPCs in `Promise.all`) feeding a client `CommandCenter` whose tab / stage / board state lives in `useSearchParams` + `history.replaceState` — 0 refetch on any in-page interaction. Charts are pure components; recharts stays out of the first-paint chunk exactly like `LazyChartWidget`.

**Tech Stack:** Next.js 16 App Router (RSC, Server Actions, `use cache` + `cacheTag`), TypeScript strict, Zod 4, Supabase (Postgres + RLS, `supabase-dev` MCP for migrations), Vitest + React Testing Library (jsdom), TanStack Query 5, recharts 3, Tailwind v4 + shadcn, Monolith Keystone (`pulse-ui`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-15-folder-command-center-design.md`. Every ruling there applies; this plan adds no product requirement.
- **TypeScript strict, no `any`.** Zod at every boundary (Server Action input, `searchParams`, RPC rows before they reach a component).
- **Server Components by default; Server Actions for all mutations.** Next.js 16 APIs were confirmed against `node_modules/next/dist/docs/01-app/03-api-reference/` (`page.md` — `searchParams` is a Promise; `01-directives/use-cache.md` — no `cookies()`/`headers()`/`searchParams` inside a cached scope, pass identity in as arguments; `04-functions/cacheTag.md`, `updateTag.md` — Server Actions only; `04-functions/redirect.md` — 307 in a Server Component).
- **RLS is the security boundary:** default-deny, org-scoped, no cross-tenant access. `SUPABASE_SERVICE_ROLE_KEY` never reaches the browser. Every `security definer` RPC guards on `auth.uid()` (`is_org_member` + `can_read_board`) and is therefore called on the **request's RLS client, never the service client** — the service client has no session, so `auth.uid()` is null and the guard raises `42501` unconditionally (`src/lib/dashboards/queries-cached.ts:35-55`, `widget-slot-core.ts:28-52`).
- **Every new SQL function:** `revoke execute on function … from public, anon; grant execute on function … to authenticated;` for public RPCs; internal helpers additionally revoke from `authenticated` (pattern: `supabase/migrations/20260703120000_health_summary.sql:90-91`, `20260704110000_dashboard_rpc_board_read_guards.sql`).
- **Migrations are minted only with `scripts/new-migration.sh <slug>`** (never hand-stamp a version), applied to DEV via the `supabase-dev` MCP `apply_migration` with the **same version + name** as the committed file, then verified with `pnpm db:ledger-check`. **DEV holds real, live, user-facing data** — no destructive experiments; verify SQL in a `begin; … rollback;` transaction via `supabase-dev` `execute_sql` first.
- **In a task worktree `pnpm db:types` fails** (`LegacyProjectNotLinkedError`). Regenerate with the `supabase-dev` MCP `generate_typescript_types`, write the result to `src/types/database.types.ts`, run `pnpm prettier --write src/types/database.types.ts`, commit it in the same change. Never hand-edit that file.
- **Never filter or classify rows in the app after a SQL `LIMIT`** — filter in the query (`.is("archived_at", null)`, `.is("folder_id", null)`, `where` clauses in RPCs).
- **Reuse canonical modules:** `ActionResult` / `fail` from `src/lib/actions/result.ts`; `typedRpc` from `src/lib/supabase/typed-rpc.ts`; cache tags from `src/lib/cache/tags.ts`; `Kicker`, `MetaChip`, `StatusPill`/`STATUS_BG`/`StatusColor`, `ColorChip`, `EmptyState`, `Skeleton`, `PageHeader` from `src/components/ui/*`. Grep before writing any helper.
- **UI:** load `pulse-ui` and `example-skills:frontend-design` before any component. No raw Tailwind colours (`bg-zinc-*`, `text-red-500`): semantic tokens only; `rounded-lg` for cards, `rounded-sm` for chips; hairlines brighten (`hover:border-border-hover`), never thicken; status colour only via `StatusPill` / `STATUS_BG`; lucide icons `size-4`.
- **Copy:** the product is **Monolith**; AI surfaces are labelled **"Intelligence"**; the word "Pulse" never appears in UI copy.
- **Performance budget (working agreement #5):** in-page tab / stage / board / sort / chart-mode changes are client state mirrored with `window.history.replaceState` — never `<Link>`, `router.push`, or `router.refresh` (gotcha-09, precedent `src/components/portfolios/PortfolioGrid.tsx:37-58`, `src/components/boards/BoardViews.tsx:170-186`). Hot-path reads are bounded and indexed.
- **Tests are mandatory:** every task ships tests that are written and executed. `*.integration.test.ts` / `*.rls.integration.test.ts` suites gate on `integrationTargetReady()` and skip unless `.env.test` marks a safe target (`src/test/integration-env.ts`); unit tests run in `pnpm test`.
- **Gates before any merge:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Commit identity:** `Danijel Jovanovic <info@synapse-solutions.ai>` (pinned by `start-task.sh`). Conventional-commit subject, lowercase, under 100 chars. **Stage explicitly by path** — never `git add -A` / `git add .` / `git commit -a`.
- **Implementers never run `scripts/finish-task.sh`, never merge, never push.** The orchestrator rebases, merges batches serially (shared `database.types.ts`), and finishes.

## Ambiguities resolved in this plan (state them back to the owner)

1. **"Workspace members" predicate:** there is no `workspace_members` table or `is_workspace_member()` function in `supabase/migrations/` — workspaces are org-scoped and every workspace/board policy uses `is_org_member(org_id)` / `auth_user_orgs()` (`20260614174043_init_auth_tenancy.sql:246-261`, `20260702120000_perf_set_based_rls_and_indexes.sql:211-214`). Folder writes therefore require `is_org_member(org_id)` plus the workspace belonging to that org; `folder_boards` writes additionally require the board to be in the folder's workspace and `can_read_board(board_id)` (helper `folder_accepts_board`).
2. **"Completed" date for the burn chart:** no column records when a status became done. `_board_health_flags` derives done-ness from the status cell at read time. The plan uses **`cell_values.updated_at` of the item's first-status-column cell** as the completion date for done items (`_folder_item_flags.done_on`), and says so in the migration comment. `item_activities` could refine this later.
3. **Copy-forward timing:** the spec says "copied forward once, then dropped in the same migration". Dropping `board_folders` at the Unit-1 merge would break `typecheck` for the still-present private-folder code. So Unit 1 creates the shared tables; **Unit 4's migration does the copy-forward, the dashboards backfill and the drop in one migration**, in the same task that deletes the private-folder code. Copy-forward still runs exactly once.
4. **One folder name per workspace:** a unique index `folders (workspace_id, lower(trim(name)))` makes the copy-forward idempotent (`on conflict do nothing`) and the gallery stable. `createFolder` maps `23505` to "A folder with that name already exists in this workspace."
5. **Dashboards have no `position` column** (`src/types/database.types.ts:1608-1617`) — the "Your widgets" strip orders folded-in dashboards by `created_at`.
6. **"Click opens the item panel":** the `ItemPanel` needs the full board payload (`src/components/boards/BoardViews.tsx:175-186` opens it from `?item=`). Attention / Unassigned rows link to `/boards/[boardId]?item=[itemId]` — a real navigation to different server data, which opens the panel there.
7. **Board health pill rule:** the digest has counts, not a pill. `boardHealth()` in `src/lib/folders/rollup.ts` defines it over `_board_health_flags`-derived counts (off_track when overdue ≥ 1 and (overdue+blocked)/total ≥ 0.2; at_risk when overdue ≥ 1 or blocked ≥ 1 or incomplete/total ≥ 0.5; else on_track) and renders with `StatusPill` on the portfolio colours (`src/components/portfolios/HealthPill.tsx`).
8. **People tab badge:** the overloaded count is derived from `folder_workload`, which is fetched on first open of the tab (spec §6). The badge shows the red count once that query has resolved; before that the tab reads "People".
9. **Folder reorder action:** the spec lists it under `src/lib/folders/*` but no v1 surface reorders folders (the sidebar orders by `position, name` today). Not built; `position` is assigned append-only by `createFolder`.
10. **Ask folder scope:** the smallest change consistent with the existing board scope (`ai_conversations.board_id` → `composeBoardScope`) is a nullable `ai_conversations.folder_id` column plus `composeFolderScope`. `/ask?folder=<id>` seeds a new thread with it.
11. **Boards-tab owners column:** dropped in v1 (owner decision 2026-09-15). The rollup carries no per-board owner set; per-person numbers live on the People tab only.
12. **Migration test on DEV:** no `pg` dependency exists; the ledger check shells out to `psql` with `DEV_SUPABASE_DB_URL` (`scripts/check-migration-ledger.mjs:236-272`). The copy-forward test does the same inside `begin; … rollback;` and skips unless `PULSE_TEST_DB=1` and `DEV_SUPABASE_DB_URL` are set.

## File Structure

| File                                                                                                                 | Responsibility                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/<v>_shared_folders.sql` (Task 1)                                                                | `folders`, `folder_boards`, RLS, `folder_accepts_board`, `dashboards.folder_id`, `ai_conversations.folder_id`       |
| `supabase/migrations/<v>_folder_rollup_rpcs.sql` (Task 2)                                                            | `_parse_iso_date`, `_assert_folder_member`, `_folder_item_flags`, `folder_rollup`, `folder_attention`               |
| `supabase/migrations/<v>_folder_burn_workload_gallery.sql` (Task 3)                                                  | `folder_burn`, `folder_workload`, `folder_gallery`                                                                  |
| `supabase/migrations/<v>_private_folders_copy_forward.sql` (Task 11)                                                 | copy-forward, dashboards backfill, drop private tables                                                              |
| `src/types/database.types.ts` (regenerated in Tasks 1, 2, 3, 11)                                                     | generated Supabase types                                                                                            |
| `src/lib/folders/types.ts` (Task 4)                                                                                  | app-side row and payload shapes — the contract every other task imports                                             |
| `src/lib/folders/stages.ts`, `rollup.ts`, `fixture.ts` (Task 4)                                                      | pure derivations + a typed fixture payload                                                                          |
| `src/lib/validations/folders.ts` (Task 5)                                                                            | Zod schemas for folder actions and `searchParams`                                                                   |
| `src/lib/folders/resolve.ts` (Task 5)                                                                                | typed RPC resolvers (RLS client) → app rows                                                                         |
| `src/lib/folders/queries.ts`, `queries-cached.ts` (Task 5)                                                           | folder head + boards, latest briefs, cached nav list                                                                |
| `src/lib/folders/actions.ts` (Task 5)                                                                                | `createFolder`, `renameFolder`, `deleteFolder`, `moveBoardToFolder`, `attachDashboardToFolder`, `getFolderWorkload` |
| `src/lib/folders/group.ts` (Task 11, moved from `src/lib/boards/folders/group.ts`)                                   | sidebar fold over shared folders                                                                                    |
| `src/components/folders/charts/{KpiCard,StackedStatusBar,StageMatrix}.tsx` (Task 6)                                  | pure presentational                                                                                                 |
| `src/components/folders/charts/{BurnChart,BurnChartInner,WorkloadBars}.tsx` (Task 7)                                 | burn chart (recharts, lazy) + workload bars                                                                         |
| `src/components/folders/command-center-state.ts` (Task 8)                                                            | tab / stage / board URL state hook                                                                                  |
| `src/components/folders/CommandCenter.tsx`, `TabStrip.tsx`, `FilterBar.tsx`, `tabs/Overview.tsx` (Task 8)            | shell + Overview                                                                                                    |
| `src/components/folders/tabs/{Stages,Boards,People}.tsx` (Task 9)                                                    | tab bodies                                                                                                          |
| `src/app/(app)/folders/[folderId]/{page,loading,not-found}.tsx` (Task 10)                                            | RSC route                                                                                                           |
| `src/components/folders/FolderGallery.tsx`, `UnfiledDashboards.tsx` (Task 12)                                        | `/dashboards` gallery                                                                                               |
| `src/components/dashboards/NewDashboardDialog.tsx` (Task 11)                                                         | extracted from `DashboardsNav`                                                                                      |
| `src/components/folders/YourWidgets.tsx`, `src/lib/dashboards/board-options.ts` (Task 13)                            | fold-in strip + shared `BoardOption` builder                                                                        |
| `src/components/folders/HeaderActions.tsx`, `src/app/globals.css` (Task 14)                                          | Share / Export PDF / Ask, print rules                                                                               |
| `src/lib/ai/ask/persona.ts`, `conversation-actions.ts`, `src/app/ask/page.tsx`, `src/app/api/ask/route.ts` (Task 15) | folder scope                                                                                                        |

---

### Task 1: Shared `folders` + `folder_boards` schema, RLS, `dashboards.folder_id`, `ai_conversations.folder_id`

**Files:**

- Create: `supabase/migrations/<version>_shared_folders.sql` (version minted by `scripts/new-migration.sh shared_folders`)
- Regenerate: `src/types/database.types.ts`
- Test: `src/lib/folders/folders.rls.integration.test.ts`

**Interfaces:**

- Consumes: `public.is_org_member(uuid)`, `public.auth_user_orgs()`, `public.can_read_board(uuid)` (`20260621000000_board_access_require_membership_and_returning.sql:50-64`), `public.set_updated_at()`.
- Produces: tables `public.folders`, `public.folder_boards`; function `public.folder_accepts_board(p_folder_id uuid, p_board_id uuid) returns boolean`; columns `public.dashboards.folder_id uuid null`, `public.ai_conversations.folder_id uuid null`; generated types `Tables<"folders">`, `Tables<"folder_boards">`.

- [ ] **Step 1: Mint the migration**

Run: `scripts/new-migration.sh shared_folders`
Expected: prints `supabase/migrations/<UTC-stamp>_shared_folders.sql` and the apply/types steps. Note the stamp; it is the version you pass to the MCP.

- [ ] **Step 2: Write the migration**

Replace the file body (keep the two header comment lines the script wrote) with:

```sql
-- What this migration does:
--   Shared workspace folders (spec §3.1): every folder is a project that a
--   command center attaches to. Replaces the private per-user board_folders
--   layer, which is copied forward and dropped in a LATER migration
--   (<version>_private_folders_copy_forward.sql) so the private-folder code
--   keeps type-checking until the sidebar switches over.
--
--   "Workspace member" == org member: workspaces carry no membership table of
--   their own (20260614174043_init_auth_tenancy.sql:246-261), so writes gate on
--   is_org_member(org_id) and the workspace belonging to that org.

create table public.folders (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 60),
  position     integer not null default 0,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index folders_workspace_position_idx on public.folders (workspace_id, position);
create index folders_org_id_idx on public.folders (org_id);
create index folders_created_by_idx on public.folders (created_by);
-- One folder per name per workspace. Makes the copy-forward idempotent and the
-- gallery stable; createFolder maps 23505 to a friendly message.
create unique index folders_workspace_name_key
  on public.folders (workspace_id, lower(trim(name)));

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

create table public.folder_boards (
  folder_id  uuid not null references public.folders(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (board_id)                 -- a board sits in at most one folder
);

create index folder_boards_folder_position_idx on public.folder_boards (folder_id, position);

-- May this caller put this board in this folder? Org member of the folder's org,
-- the board lives in the folder's workspace (no cross-workspace folders, spec
-- §11), and the caller can read the board (no existence oracle, same reasoning
-- as 20260826102555_sidebar_board_folders.sql:68-70).
create or replace function public.folder_accepts_board(p_folder_id uuid, p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.folders f
    join public.boards b on b.id = p_board_id
    where f.id = p_folder_id
      and public.is_org_member(f.org_id)
      and b.workspace_id = f.workspace_id
      and public.can_read_board(b.id)
  );
$$;

revoke execute on function public.folder_accepts_board(uuid, uuid) from public, anon;
grant execute on function public.folder_accepts_board(uuid, uuid) to authenticated;

alter table public.folders       enable row level security;
alter table public.folder_boards enable row level security;

-- folders: org-visible; org members write; the workspace must be the org's.
create policy "folders: read if member" on public.folders
  for select to authenticated
  using (org_id in (select public.auth_user_orgs()));

create policy "folders: insert if member" on public.folders
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.workspaces w
      where w.id = folders.workspace_id and w.org_id = folders.org_id
    )
  );

create policy "folders: update if member" on public.folders
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id)
    and exists (
      select 1 from public.workspaces w
      where w.id = folders.workspace_id and w.org_id = folders.org_id
    )
  );

create policy "folders: delete if member" on public.folders
  for delete to authenticated
  using (public.is_org_member(org_id));

-- folder_boards: visible with the folder; writes go through folder_accepts_board.
create policy "folder_boards: read if member" on public.folder_boards
  for select to authenticated
  using (exists (
    select 1 from public.folders f
    where f.id = folder_boards.folder_id
      and f.org_id in (select public.auth_user_orgs())
  ));

create policy "folder_boards: insert if member" on public.folder_boards
  for insert to authenticated
  with check (public.folder_accepts_board(folder_id, board_id));

create policy "folder_boards: update if member" on public.folder_boards
  for update to authenticated
  using (exists (
    select 1 from public.folders f
    where f.id = folder_boards.folder_id and public.is_org_member(f.org_id)
  ))
  with check (public.folder_accepts_board(folder_id, board_id));

create policy "folder_boards: delete if member" on public.folder_boards
  for delete to authenticated
  using (exists (
    select 1 from public.folders f
    where f.id = folder_boards.folder_id and public.is_org_member(f.org_id)
  ));

grant select, insert, update, delete on public.folders, public.folder_boards to authenticated;

-- Dashboards fold into a folder (spec §3.3). Backfilled by the copy-forward migration.
alter table public.dashboards
  add column folder_id uuid references public.folders(id) on delete set null;
create index dashboards_folder_idx on public.dashboards (folder_id);

-- Ask can be scoped to a folder (spec §5.1), mirroring ai_conversations.board_id.
alter table public.ai_conversations
  add column folder_id uuid references public.folders(id) on delete set null;
create index ai_conversations_folder_idx on public.ai_conversations (folder_id);
```

- [ ] **Step 3: Dry-run on DEV in a rolled-back transaction**

Via the `supabase-dev` MCP `execute_sql`, run the whole file wrapped in `begin;` … `rollback;`.
Expected: no error. (Do NOT leave it applied this way — `apply_migration` in Step 5 is what records the ledger row.)

- [ ] **Step 4: Write the failing RLS integration test**

Create `src/lib/folders/folders.rls.integration.test.ts` (mirrors `src/lib/boards/folders/board-folders.rls.integration.test.ts`):

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

describe.skipIf(!integrationTargetReady())("RLS: shared folders", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  // A: own org, two workspaces, a board in each. B: a separate org.
  let aAnon: SupabaseClient<Database>;
  let bAnon: SupabaseClient<Database>;
  let aUserId: string;
  let aOrgId: string;
  let aWs1: string;
  let aWs2: string;
  let aBoardWs1: string;
  let aBoardWs2: string;
  let aFolderId: string;
  let bUserId: string;
  let bOrgId: string;
  let bWs: string;
  let bBoardId: string;

  async function provisionUser(label: string) {
    const email = `sf-${label}-${randomUUID()}@example.com`;
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
    const { data: org, error: orgErr } = await anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: `sf-${label}-${randomUUID().slice(0, 8)}`,
    });
    expect(orgErr, `create_organization(${label})`).toBeNull();
    return { id, anon, orgId: (org as { id: string }).id };
  }

  async function provisionWorkspace(
    anon: SupabaseClient<Database>,
    orgId: string,
    userId: string,
    label: string,
  ) {
    const { data: ws, error } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `WS ${label}`, created_by: userId })
      .select("id")
      .single();
    expect(error, `workspace(${label})`).toBeNull();
    return (ws as { id: string }).id;
  }

  async function provisionBoard(
    anon: SupabaseClient<Database>,
    workspaceId: string,
    label: string,
  ) {
    const { data: board, error } = await anon.rpc("create_board", {
      p_workspace_id: workspaceId,
      p_name: `Board ${label}`,
    });
    expect(error, `create_board(${label})`).toBeNull();
    return (board as { id: string }).id;
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const a = await provisionUser("a");
    aAnon = a.anon;
    aUserId = a.id;
    aOrgId = a.orgId;
    aWs1 = await provisionWorkspace(aAnon, aOrgId, aUserId, "A1");
    aWs2 = await provisionWorkspace(aAnon, aOrgId, aUserId, "A2");
    aBoardWs1 = await provisionBoard(aAnon, aWs1, "A1");
    aBoardWs2 = await provisionBoard(aAnon, aWs2, "A2");

    const b = await provisionUser("b");
    bAnon = b.anon;
    bUserId = b.id;
    bOrgId = b.orgId;
    bWs = await provisionWorkspace(bAnon, bOrgId, bUserId, "B");
    bBoardId = await provisionBoard(bAnon, bWs, "B");
  }, 120_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("lets an org member create a folder in their own workspace", async () => {
    const { data, error } = await aAnon
      .from("folders")
      .insert({
        org_id: aOrgId,
        workspace_id: aWs1,
        name: "Q4 Launch",
        created_by: aUserId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    aFolderId = (data as { id: string }).id;
  });

  it("rejects a folder whose workspace belongs to another org", async () => {
    const { error } = await bAnon.from("folders").insert({
      org_id: bOrgId,
      workspace_id: aWs1, // A's workspace
      name: "Sneaky",
      created_by: bUserId,
    });
    expect(error?.code).toBe("42501");
  });

  it("rejects a second folder with the same name in the same workspace", async () => {
    const { error } = await aAnon.from("folders").insert({
      org_id: aOrgId,
      workspace_id: aWs1,
      name: "  q4 launch ",
      created_by: aUserId,
    });
    expect(error?.code).toBe("23505");
  });

  it("hides another org's folders", async () => {
    const { data } = await bAnon
      .from("folders")
      .select("id")
      .eq("id", aFolderId);
    expect(data ?? []).toHaveLength(0);
  });

  it("lets a member file a readable board from the folder's workspace", async () => {
    const { error } = await aAnon
      .from("folder_boards")
      .insert({ folder_id: aFolderId, board_id: aBoardWs1 });
    expect(error).toBeNull();
  });

  it("rejects filing a board from a different workspace", async () => {
    const { error } = await aAnon
      .from("folder_boards")
      .insert({ folder_id: aFolderId, board_id: aBoardWs2 });
    expect(error?.code).toBe("42501");
  });

  it("rejects filing a board the caller cannot read", async () => {
    const { error } = await aAnon
      .from("folder_boards")
      .insert({ folder_id: aFolderId, board_id: bBoardId });
    expect(error?.code).toBe("42501");
  });

  it("rejects a non-member writing into the folder", async () => {
    const { error } = await bAnon
      .from("folder_boards")
      .insert({ folder_id: aFolderId, board_id: bBoardId });
    expect(error?.code).toBe("42501");
  });

  it("enforces one folder per board via the primary key", async () => {
    const { data: second } = await aAnon
      .from("folders")
      .insert({
        org_id: aOrgId,
        workspace_id: aWs1,
        name: "Second",
        created_by: aUserId,
      })
      .select("id")
      .single();
    const { error } = await aAnon.from("folder_boards").insert({
      folder_id: (second as { id: string }).id,
      board_id: aBoardWs1,
    });
    expect(error?.code).toBe("23505");
  });

  it("cascades: deleting the folder removes placements and nulls dashboards.folder_id", async () => {
    const { data: dash } = await aAnon.rpc("create_dashboard", {
      p_workspace_id: aWs1,
      p_name: "D",
    });
    const dashId = (dash as { id: string }).id;
    const { error: attachErr } = await aAnon
      .from("dashboards")
      .update({ folder_id: aFolderId })
      .eq("id", dashId);
    expect(attachErr).toBeNull();

    await aAnon.from("folders").delete().eq("id", aFolderId);

    const { data: placements } = await admin
      .from("folder_boards")
      .select("board_id")
      .eq("folder_id", aFolderId);
    expect(placements ?? []).toHaveLength(0);
    const { data: d } = await admin
      .from("dashboards")
      .select("folder_id")
      .eq("id", dashId)
      .single();
    expect(d?.folder_id).toBeNull();
    const { data: boards } = await admin
      .from("boards")
      .select("id")
      .eq("id", aBoardWs1);
    expect(boards ?? []).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails (types missing)**

Run: `pnpm typecheck`
Expected: errors in `src/lib/folders/folders.rls.integration.test.ts` — `"folders"` is not a valid table name (types not regenerated yet).

- [ ] **Step 6: Apply the migration to DEV and regenerate types**

1. `supabase-dev` MCP `apply_migration` with `name` = the exact file basename without `.sql` (e.g. `20260916091500_shared_folders`) and `query` = the file contents.
2. `supabase-dev` MCP `generate_typescript_types` → write output to `src/types/database.types.ts`.
3. Run: `pnpm prettier --write src/types/database.types.ts`
4. Run: `pnpm db:ledger-check`
   Expected: `ledger ok` (no drift both ways).

- [ ] **Step 7: Run typecheck and the integration test**

Run: `pnpm typecheck`
Expected: clean.
Run: `pnpm vitest run --project integration src/lib/folders/folders.rls.integration.test.ts`
Expected: with no `.env.test` — `skipped` (1 suite). With a marked test target — 10 passed.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/<version>_shared_folders.sql src/types/database.types.ts src/lib/folders/folders.rls.integration.test.ts
git commit -m "feat(db): shared workspace folders, folder_boards, dashboards.folder_id"
```

---

### Task 2: `folder_rollup` + `folder_attention` RPCs (with the internal per-item flag function)

**Files:**

- Create: `supabase/migrations/<version>_folder_rollup_rpcs.sql` (minted by `scripts/new-migration.sh folder_rollup_rpcs`)
- Regenerate: `src/types/database.types.ts`
- Test: `src/lib/folders/folder-rollup.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 tables; `public._board_health_flags(uuid)` — latest body in `20260727094245_digest_period_scoped_and_blocked_runs.sql:51-138` returns `(item_id, item_name, item_created_at, is_done, is_overdue, is_incomplete, overdue_since text)`; it does NOT exclude archived items, so this task joins `items.archived_at is null` itself.
- Produces:
  - `public._parse_iso_date(text) returns date` (internal)
  - `public._assert_folder_member(p_folder_id uuid) returns void` (internal; raises `P0002` / `42501`)
  - `public._folder_item_flags(p_folder_id uuid)` (internal) — one row per live top-level item across the folder's readable boards
  - `public.folder_rollup(p_folder_id uuid)` — one row per (board, group), boards with no group yield a row with null group columns
  - `public.folder_attention(p_folder_id uuid, p_limit int default 20)` — severity/age ordered, `LIMIT` inside SQL

- [ ] **Step 1: Mint the migration**

Run: `scripts/new-migration.sh folder_rollup_rpcs`

- [ ] **Step 2: Write the migration**

```sql
-- What this migration does:
--   Command-center read RPCs, part 1 (spec §6). One internal per-item flag
--   function feeds every public RPC so the done/overdue/blocked/stale/
--   unassigned rules live in exactly one place and reuse _board_health_flags
--   for done/overdue/incomplete (the digest's rule).
--
--   done_on: the schema has no "status became done" timestamp, so the
--   completion date is cell_values.updated_at of the item's first-status-column
--   cell (the write that set it). item_activities could refine this later.
--
--   Access paths: folder_boards PK/folder index, boards PK, columns_board_id_idx,
--   items_board_id_idx (+ the archived_at partial index), cell_values PK
--   (item_id, column_id), groups PK. Bound: boards × items in the folder.

-- ── ISO date that never raises on a malformed cell value ────────────────────
create or replace function public._parse_iso_date(p text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return left(p, 10)::date;
exception when others then
  return null;
end; $$;

revoke execute on function public._parse_iso_date(text) from public, anon, authenticated;

-- ── Guard shared by the public folder RPCs ──────────────────────────────────
create or replace function public._assert_folder_member(p_folder_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.folders where id = p_folder_id;
  if v_org is null then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
end; $$;

revoke execute on function public._assert_folder_member(uuid) from public, anon, authenticated;

-- ── Per-item flags across the folder's READABLE boards ──────────────────────
-- Boards the caller cannot read (can_read_board false) are excluded, not
-- raised: a private board in a shared folder simply does not count.
create or replace function public._folder_item_flags(p_folder_id uuid)
returns table (
  board_id uuid,
  board_name text,
  board_position integer,
  group_id uuid,
  group_name text,
  group_color text,
  group_position double precision,
  item_id uuid,
  item_name text,
  is_done boolean,
  is_overdue boolean,
  is_incomplete boolean,
  is_blocked boolean,
  has_status boolean,
  has_people_col boolean,
  has_owner boolean,
  due_on date,
  done_on date,
  overdue_since date,
  last_touched timestamptz,
  owner_ids text[]
)
language sql stable security definer set search_path = '' as $$
  with fb as (
    select b.id, b.name, fbd.position
    from public.folder_boards fbd
    join public.boards b on b.id = fbd.board_id and b.archived_at is null
    where fbd.folder_id = p_folder_id
      and public.can_read_board(b.id)
  ),
  cols as (
    select
      fb.id as board_id,
      (select c.id from public.columns c
        where c.board_id = fb.id and c.kind = 'status'
        order by c.position asc limit 1) as status_col,
      (select c.settings from public.columns c
        where c.board_id = fb.id and c.kind = 'status'
        order by c.position asc limit 1) as status_settings,
      (select c.id from public.columns c
        where c.board_id = fb.id and c.kind = 'people'
        order by c.position asc limit 1) as people_col,
      (select c.id from public.columns c
        where c.board_id = fb.id and c.kind = 'date'
        order by c.position asc limit 1) as date_col
    from fb
  )
  select
    fb.id,
    fb.name,
    fb.position,
    g.id,
    g.name,
    g.color,
    g.position,
    i.id,
    i.name,
    f.is_done,
    f.is_overdue,
    f.is_incomplete,
    (not f.is_done and exists (
      select 1
      from public.cell_values cv,
           jsonb_array_elements(coalesce(cols.status_settings -> 'options', '[]'::jsonb)) opt
      where cv.item_id = i.id
        and cv.column_id = cols.status_col
        and opt ->> 'id' = cv.value ->> 'optionId'
        and opt ->> 'label' ~* '(blocked|stuck)'
    )) as is_blocked,
    exists (
      select 1
      from public.cell_values cv,
           jsonb_array_elements(coalesce(cols.status_settings -> 'options', '[]'::jsonb)) opt
      where cv.item_id = i.id
        and cv.column_id = cols.status_col
        and opt ->> 'id' = cv.value ->> 'optionId'
    ) as has_status,
    (cols.people_col is not null) as has_people_col,
    exists (
      select 1 from public.cell_values cv
      where cv.item_id = i.id and cv.column_id = cols.people_col
        and jsonb_array_length(coalesce(cv.value -> 'userIds', '[]'::jsonb)) > 0
    ) as has_owner,
    (select public._parse_iso_date(coalesce(cv.value ->> 'end', cv.value ->> 'date'))
       from public.cell_values cv
      where cv.item_id = i.id and cv.column_id = cols.date_col) as due_on,
    case when f.is_done then
      (select cv.updated_at::date from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.status_col)
    end as done_on,
    public._parse_iso_date(f.overdue_since) as overdue_since,
    greatest(
      i.updated_at,
      coalesce((select max(cv.updated_at) from public.cell_values cv where cv.item_id = i.id), i.updated_at)
    ) as last_touched,
    coalesce(
      (select array(select jsonb_array_elements_text(coalesce(cv.value -> 'userIds', '[]'::jsonb)))
         from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.people_col),
      '{}'::text[]
    ) as owner_ids
  from fb
  join cols on cols.board_id = fb.id
  cross join lateral public._board_health_flags(fb.id) f
  join public.items i on i.id = f.item_id and i.archived_at is null
  join public.groups g on g.id = i.group_id and g.archived_at is null
$$;

revoke execute on function public._folder_item_flags(uuid) from public, anon, authenticated;

-- ── folder_rollup: one row per (board, group) ───────────────────────────────
-- A board with zero groups still yields one row (null group columns) so the
-- Boards tab can list every board; a group with zero items yields a row of
-- zeros so it still forms a stage (spec §3.4).
create or replace function public.folder_rollup(p_folder_id uuid)
returns table (
  board_id uuid,
  board_name text,
  board_position integer,
  group_id uuid,
  group_name text,
  group_color text,
  group_position double precision,
  total integer,
  done integer,
  in_progress integer,
  overdue integer,
  not_started integer,
  blocked integer,
  stale integer,
  unassigned integer,
  incomplete integer,
  planned_by_today integer,
  due_this_week integer,
  due_this_week_not_started integer,
  oldest_overdue date,
  min_due date,
  max_due date
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  with fb as (
    select b.id, b.name, fbd.position
    from public.folder_boards fbd
    join public.boards b on b.id = fbd.board_id and b.archived_at is null
    where fbd.folder_id = p_folder_id
      and public.can_read_board(b.id)
  ),
  flags as (
    select * from public._folder_item_flags(p_folder_id)
  )
  select
    fb.id,
    fb.name,
    fb.position,
    g.id,
    g.name,
    g.color,
    g.position,
    count(f.item_id)::int,
    count(f.item_id) filter (where f.is_done)::int,
    count(f.item_id) filter (where not f.is_done and not f.is_overdue and f.has_status)::int,
    count(f.item_id) filter (where f.is_overdue)::int,
    count(f.item_id) filter (where not f.is_done and not f.is_overdue and not f.has_status)::int,
    count(f.item_id) filter (where f.is_blocked)::int,
    count(f.item_id) filter (where not f.is_done and f.last_touched < now() - interval '14 days')::int,
    count(f.item_id) filter (where not f.is_done and f.has_people_col and not f.has_owner)::int,
    count(f.item_id) filter (where f.is_incomplete)::int,
    count(f.item_id) filter (where f.due_on <= current_date)::int,
    count(f.item_id) filter (where not f.is_done
      and f.due_on >= date_trunc('week', current_date)::date
      and f.due_on <  (date_trunc('week', current_date) + interval '7 days')::date)::int,
    count(f.item_id) filter (where not f.is_done and not f.has_status
      and f.due_on >= date_trunc('week', current_date)::date
      and f.due_on <  (date_trunc('week', current_date) + interval '7 days')::date)::int,
    min(f.overdue_since) filter (where f.is_overdue),
    min(f.due_on),
    max(f.due_on)
  from fb
  left join public.groups g on g.board_id = fb.id and g.archived_at is null
  left join flags f on f.group_id = g.id
  group by fb.id, fb.name, fb.position, g.id, g.name, g.color, g.position
  order by fb.position asc, g.position asc nulls last;
end; $$;

revoke execute on function public.folder_rollup(uuid) from public, anon;
grant execute on function public.folder_rollup(uuid) to authenticated;

-- ── folder_attention: top-N open items by severity, then age ────────────────
-- reason precedence: overdue (4) > blocked (3) > unassigned (2) > stale (1).
-- age_days: days overdue for overdue rows, days since last touch otherwise.
create or replace function public.folder_attention(p_folder_id uuid, p_limit integer default 20)
returns table (
  item_id uuid,
  item_name text,
  board_id uuid,
  board_name text,
  group_id uuid,
  group_name text,
  reason text,
  age_days integer,
  severity integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  with flags as (
    select * from public._folder_item_flags(p_folder_id)
  ),
  reasons as (
    select
      f.item_id,
      f.item_name,
      f.board_id,
      f.board_name,
      f.group_id,
      f.group_name,
      case
        when f.is_overdue then 'overdue'
        when f.is_blocked then 'blocked'
        when f.has_people_col and not f.has_owner then 'unassigned'
        else 'stale'
      end as reason,
      case
        when f.is_overdue then 4
        when f.is_blocked then 3
        when f.has_people_col and not f.has_owner then 2
        else 1
      end as severity,
      case
        when f.is_overdue and f.overdue_since is not null then (current_date - f.overdue_since)
        else greatest(0, floor(extract(epoch from (now() - f.last_touched)) / 86400))::int
      end as age_days
    from flags f
    where not f.is_done
      and (
        f.is_overdue
        or f.is_blocked
        or (f.has_people_col and not f.has_owner)
        or f.last_touched < now() - interval '14 days'
      )
  )
  select r.item_id, r.item_name, r.board_id, r.board_name, r.group_id, r.group_name,
         r.reason, r.age_days, r.severity
  from reasons r
  order by r.severity desc, r.age_days desc, r.item_name asc
  limit v_limit;
end; $$;

revoke execute on function public.folder_attention(uuid, integer) from public, anon;
grant execute on function public.folder_attention(uuid, integer) to authenticated;
```

- [ ] **Step 3: Dry-run on DEV in a rolled-back transaction**

Via `supabase-dev` `execute_sql`: `begin;` + file + `select * from public.folder_rollup('00000000-0000-0000-0000-000000000000');` + `rollback;`.
Expected: the function definitions succeed; the select raises `folder not found` (P0002) — that proves the guard runs. (The whole block rolls back.)

- [ ] **Step 4: Write the failing integration test**

Create `src/lib/folders/folder-rollup.integration.test.ts`:

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

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
}

describe.skipIf(!integrationTargetReady())(
  "folder_rollup + folder_attention",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let member: SupabaseClient<Database>;
    let outsider: SupabaseClient<Database>;
    let memberId: string;
    let orgId: string;
    let wsId: string;
    let folderId: string;
    let emptyFolderId: string;
    let boardId: string;
    let groupId: string;
    let statusColId: string;
    let peopleColId: string;
    let dateColId: string;
    let doneOptId: string;
    let stuckOptId: string;
    let workingOptId: string;

    async function provision(label: string) {
      const email = `fr-${label}-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      expect(error, `createUser(${label})`).toBeNull();
      createdUserIds.push(created.user!.id);
      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });
      return { anon, userId: created.user!.id };
    }

    async function seedItem(opts: {
      name: string;
      parentId?: string;
      statusOptionId?: string;
      ownerIds?: string[];
      date?: string;
    }): Promise<string> {
      const { data: item, error } = await member
        .from("items")
        .insert({
          board_id: boardId,
          org_id: orgId,
          group_id: groupId,
          name: opts.name,
          ...(opts.parentId ? { parent_id: opts.parentId } : {}),
        })
        .select("id")
        .single();
      expect(error, `seedItem(${opts.name})`).toBeNull();
      const itemId = (item as { id: string }).id;
      const cells: { column_id: string; value: Record<string, unknown> }[] = [];
      if (opts.statusOptionId)
        cells.push({
          column_id: statusColId,
          value: { optionId: opts.statusOptionId },
        });
      if (opts.ownerIds)
        cells.push({
          column_id: peopleColId,
          value: { userIds: opts.ownerIds },
        });
      if (opts.date)
        cells.push({ column_id: dateColId, value: { date: opts.date } });
      for (const c of cells) {
        const { error: cellErr } = await member.from("cell_values").insert({
          item_id: itemId,
          column_id: c.column_id,
          board_id: boardId,
          org_id: orgId,
          value: c.value,
        });
        expect(cellErr, `cell(${opts.name})`).toBeNull();
      }
      return itemId;
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const m = await provision("member");
      member = m.anon;
      memberId = m.userId;
      const o = await provision("outsider");
      outsider = o.anon;

      const { data: org } = await member.rpc("create_organization", {
        p_name: "Rollup Org",
        p_slug: `fr-${randomUUID().slice(0, 8)}`,
      });
      orgId = (org as { id: string }).id;
      const { data: ws } = await member
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: memberId })
        .select("id")
        .single();
      wsId = (ws as { id: string }).id;

      const { data: board } = await member.rpc("create_board", {
        p_workspace_id: wsId,
        p_name: "Plan",
      });
      boardId = (board as { id: string }).id;
      const { data: g } = await member
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      groupId = (g as { id: string }).id;
      const { data: cols } = await member
        .from("columns")
        .select("id, kind, settings")
        .eq("board_id", boardId);
      const statusCol = cols!.find((c) => c.kind === "status")!;
      statusColId = statusCol.id;
      peopleColId = cols!.find((c) => c.kind === "people")!.id;
      dateColId = cols!.find((c) => c.kind === "date")!.id;
      const options = (
        statusCol.settings as { options: { id: string; label: string }[] }
      ).options;
      doneOptId = options.find((x) => x.label === "Done")!.id;
      stuckOptId = options.find((x) => x.label === "Stuck")!.id;
      workingOptId = options.find((x) => x.label === "Working on it")!.id;

      const { data: folder } = await member
        .from("folders")
        .insert({
          org_id: orgId,
          workspace_id: wsId,
          name: "Launch",
          created_by: memberId,
        })
        .select("id")
        .single();
      folderId = (folder as { id: string }).id;
      const { data: empty } = await member
        .from("folders")
        .insert({
          org_id: orgId,
          workspace_id: wsId,
          name: "Empty",
          created_by: memberId,
        })
        .select("id")
        .single();
      emptyFolderId = (empty as { id: string }).id;
      const { error: fbErr } = await member
        .from("folder_boards")
        .insert({ folder_id: folderId, board_id: boardId });
      expect(fbErr).toBeNull();

      // done (past due, suppressed), overdue (working, yesterday), blocked
      // (stuck, owner), fresh (no status, tomorrow, owner), no-owner (nothing),
      // plus a subitem that must be excluded everywhere.
      await seedItem({
        name: "i-done",
        statusOptionId: doneOptId,
        ownerIds: [memberId],
        date: isoDaysFromNow(-1),
      });
      await seedItem({
        name: "i-overdue",
        statusOptionId: workingOptId,
        ownerIds: [memberId],
        date: isoDaysFromNow(-3),
      });
      await seedItem({
        name: "i-stuck",
        statusOptionId: stuckOptId,
        ownerIds: [memberId],
      });
      await seedItem({
        name: "i-fresh",
        ownerIds: [memberId],
        date: isoDaysFromNow(1),
      });
      const noOwner = await seedItem({ name: "i-no-owner" });
      await seedItem({ name: "i-sub", parentId: noOwner });
    }, 120_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("rolls up one row per (board, group) whose buckets sum to the top-level item count", async () => {
      const { data, error } = await member.rpc("folder_rollup", {
        p_folder_id: folderId,
      });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const r = data![0];
      expect(r.board_id).toBe(boardId);
      expect(r.group_id).toBe(groupId);
      expect(r.total).toBe(5);
      expect(r.done + r.in_progress + r.overdue + r.not_started).toBe(r.total);
      expect(r).toMatchObject({
        done: 1,
        overdue: 1,
        in_progress: 1, // i-stuck: has a status, not overdue
        not_started: 2, // i-fresh, i-no-owner
        blocked: 1,
        unassigned: 1,
        planned_by_today: 2, // i-done + i-overdue due in the past
      });
      expect(r.oldest_overdue).toBe(isoDaysFromNow(-3));
    });

    it("orders attention by severity then age and applies the limit in SQL", async () => {
      const { data, error } = await member.rpc("folder_attention", {
        p_folder_id: folderId,
        p_limit: 2,
      });
      expect(error).toBeNull();
      expect(data).toHaveLength(2);
      expect(data![0]).toMatchObject({
        item_name: "i-overdue",
        reason: "overdue",
        severity: 4,
        age_days: 3,
      });
      expect(data![1]).toMatchObject({
        item_name: "i-stuck",
        reason: "blocked",
        severity: 3,
      });
    });

    it("returns the unassigned item when the limit allows", async () => {
      const { data } = await member.rpc("folder_attention", {
        p_folder_id: folderId,
        p_limit: 20,
      });
      expect(data!.map((r) => r.reason)).toEqual([
        "overdue",
        "blocked",
        "unassigned",
      ]);
    });

    it("returns empty sets, not errors, for a folder with no boards", async () => {
      const rollup = await member.rpc("folder_rollup", {
        p_folder_id: emptyFolderId,
      });
      expect(rollup.error).toBeNull();
      expect(rollup.data).toEqual([]);
      const attention = await member.rpc("folder_attention", {
        p_folder_id: emptyFolderId,
        p_limit: 20,
      });
      expect(attention.error).toBeNull();
      expect(attention.data).toEqual([]);
    });

    it("rejects a non-member and an unknown folder", async () => {
      const { error } = await outsider.rpc("folder_rollup", {
        p_folder_id: folderId,
      });
      expect(error?.code).toBe("42501");
      const missing = await member.rpc("folder_rollup", {
        p_folder_id: "00000000-0000-0000-0000-000000000000",
      });
      expect(missing.error).not.toBeNull();
    });

    it("keeps the internal helpers unreachable", async () => {
      const { error } = await member.rpc(
        "_folder_item_flags" as never,
        { p_folder_id: folderId } as never,
      );
      expect(error).not.toBeNull();
    });
  },
);
```

- [ ] **Step 5: Verify it fails to typecheck (RPC names unknown)**

Run: `pnpm typecheck`
Expected: `"folder_rollup"` is not assignable to the RPC name union.

- [ ] **Step 6: Apply to DEV, regenerate types, ledger-check**

1. `supabase-dev` `apply_migration` with the exact file basename as `name`.
2. `supabase-dev` `generate_typescript_types` → `src/types/database.types.ts`; `pnpm prettier --write src/types/database.types.ts`.
3. Run: `pnpm db:ledger-check` → Expected: `ledger ok`.

- [ ] **Step 7: Run typecheck + the suite**

Run: `pnpm typecheck` → Expected: clean.
Run: `pnpm vitest run --project integration src/lib/folders/folder-rollup.integration.test.ts` → Expected: skipped without `.env.test`; 6 passed with a marked target.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/<version>_folder_rollup_rpcs.sql src/types/database.types.ts src/lib/folders/folder-rollup.integration.test.ts
git commit -m "feat(db): folder_rollup and folder_attention rpcs over per-item folder flags"
```

---

### Task 3: `folder_burn`, `folder_workload`, `folder_gallery` RPCs

**Files:**

- Create: `supabase/migrations/<version>_folder_burn_workload_gallery.sql` (minted by `scripts/new-migration.sh folder_burn_workload_gallery`)
- Regenerate: `src/types/database.types.ts`
- Test: `src/lib/folders/folder-burn.integration.test.ts`

**Interfaces:**

- Consumes: `public._folder_item_flags(uuid)`, `public._assert_folder_member(uuid)` (Task 2).
- Produces:
  - `public.folder_burn(p_folder_id uuid)` → `(stage_key text, week_start date, planned int, completed int)` — contiguous ISO weeks per stage, span clamped to 104 weeks
  - `public.folder_workload(p_folder_id uuid)` → `(user_id text /* null = unassigned */, board_id uuid, board_name text, stage_key text, stage_name text, open_items int, overdue_items int)`
  - `public.folder_gallery(p_workspace_id uuid)` → `(folder_id uuid, folder_name text, folder_position int, board_count int, item_count int, done_count int, overdue_count int, attention_count int)`

- [ ] **Step 1: Mint the migration**

Run: `scripts/new-migration.sh folder_burn_workload_gallery`

- [ ] **Step 2: Write the migration**

```sql
-- What this migration does:
--   Command-center read RPCs, part 2 (spec §6): planned-vs-completed burn
--   buckets per stage and ISO week, per-person workload, and the /dashboards
--   gallery counts. All three read public._folder_item_flags.
--
--   Burn buckets are CONTIGUOUS weeks (generate_series over the folder's own
--   span), so the client never has to fill gaps. The span is clamped to the
--   most recent 104 weeks; events before the clamp fold into the first bucket
--   so cumulative totals stay exact.

-- ── folder_burn ─────────────────────────────────────────────────────────────
create or replace function public.folder_burn(p_folder_id uuid)
returns table (
  stage_key text,
  week_start date,
  planned integer,
  completed integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  with flags as (
    select * from public._folder_item_flags(p_folder_id)
  ),
  ev as (
    select lower(trim(f.group_name)) as sk,
           date_trunc('week', f.due_on)::date as wk,
           1 as planned, 0 as completed
    from flags f
    where f.due_on is not null
    union all
    select lower(trim(f.group_name)),
           date_trunc('week', f.done_on)::date,
           0, 1
    from flags f
    where f.is_done and f.done_on is not null
  ),
  span as (
    select greatest(min(e.wk), (max(e.wk) - interval '103 weeks')::date) as lo,
           max(e.wk) as hi
    from ev e
  ),
  clamped as (
    select e.sk, greatest(e.wk, s.lo) as wk, e.planned, e.completed
    from ev e cross join span s
  ),
  stages as (
    select distinct c.sk from clamped c
  ),
  weeks as (
    select generate_series(s.lo, s.hi, interval '1 week')::date as wk
    from span s
    where s.lo is not null
  )
  select st.sk,
         w.wk,
         coalesce(sum(c.planned), 0)::int,
         coalesce(sum(c.completed), 0)::int
  from stages st
  cross join weeks w
  left join clamped c on c.sk = st.sk and c.wk = w.wk
  group by st.sk, w.wk
  order by st.sk asc, w.wk asc;
end; $$;

revoke execute on function public.folder_burn(uuid) from public, anon;
grant execute on function public.folder_burn(uuid) to authenticated;

-- ── folder_workload: open items per person × board × stage ──────────────────
-- An item with N owners counts once per owner (the same "workload" semantic as
-- dashboard_series' people dimension); an item with no owner lands on the
-- null user row, which the People tab renders as "Unassigned".
create or replace function public.folder_workload(p_folder_id uuid)
returns table (
  user_id text,
  board_id uuid,
  board_name text,
  stage_key text,
  stage_name text,
  open_items integer,
  overdue_items integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  with flags as (
    select * from public._folder_item_flags(p_folder_id)
  )
  select u.uid,
         f.board_id,
         f.board_name,
         lower(trim(f.group_name)),
         min(f.group_name),
         count(*)::int,
         count(*) filter (where f.is_overdue)::int
  from flags f
  cross join lateral unnest(
    case when cardinality(f.owner_ids) = 0 then array[null::text] else f.owner_ids end
  ) as u(uid)
  where not f.is_done
  group by u.uid, f.board_id, f.board_name, lower(trim(f.group_name))
  order by u.uid asc nulls last, f.board_name asc;
end; $$;

revoke execute on function public.folder_workload(uuid) from public, anon;
grant execute on function public.folder_workload(uuid) to authenticated;

-- ── folder_gallery: per-folder counts for one workspace ─────────────────────
create or replace function public.folder_gallery(p_workspace_id uuid)
returns table (
  folder_id uuid,
  folder_name text,
  folder_position integer,
  board_count integer,
  item_count integer,
  done_count integer,
  overdue_count integer,
  attention_count integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.workspaces where id = p_workspace_id;
  if v_org is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  return query
  select fo.id,
         fo.name,
         fo.position,
         (select count(*)::int
            from public.folder_boards fbd
            join public.boards b on b.id = fbd.board_id and b.archived_at is null
           where fbd.folder_id = fo.id and public.can_read_board(b.id)),
         count(f.item_id)::int,
         count(f.item_id) filter (where f.is_done)::int,
         count(f.item_id) filter (where f.is_overdue)::int,
         count(f.item_id) filter (where not f.is_done and (
           f.is_overdue
           or f.is_blocked
           or (f.has_people_col and not f.has_owner)
           or f.last_touched < now() - interval '14 days'
         ))::int
  from public.folders fo
  left join lateral public._folder_item_flags(fo.id) f on true
  where fo.workspace_id = p_workspace_id
  group by fo.id, fo.name, fo.position
  order by fo.position asc, fo.name asc;
end; $$;

revoke execute on function public.folder_gallery(uuid) from public, anon;
grant execute on function public.folder_gallery(uuid) to authenticated;
```

- [ ] **Step 3: Dry-run on DEV in a rolled-back transaction**

Via `supabase-dev` `execute_sql`: `begin;` + file + `rollback;` → Expected: no error.

- [ ] **Step 4: Write the failing integration test**

Create `src/lib/folders/folder-burn.integration.test.ts`. Provisioning (admin client, `provision`, `seedItem`, org, workspace, board, folder, columns, option ids) is **identical to Task 2's test** — copy those helpers verbatim into this file with the email prefix `fb-`; the seeded items differ:

```ts
// Two due dates three weeks apart (planned in two different ISO weeks),
// one done item (its status cell was written "now", so completed lands in
// the current week), one open item with two owners, one with none.
await seedItem({
  name: "p-early",
  ownerIds: [memberId],
  date: isoDaysFromNow(-21),
});
await seedItem({
  name: "p-late",
  ownerIds: [memberId],
  date: isoDaysFromNow(7),
});
await seedItem({
  name: "c-done",
  statusOptionId: doneOptId,
  ownerIds: [memberId],
  date: isoDaysFromNow(-1),
});
await seedItem({ name: "two-owners", ownerIds: [memberId, outsiderId] });
await seedItem({ name: "nobody" });
```

(`outsiderId` is the outsider's user id; it is only used as a second owner value.) Tests:

```ts
it("returns contiguous ISO weeks per stage spanning the folder's due/done dates", async () => {
  const { data, error } = await member.rpc("folder_burn", {
    p_folder_id: folderId,
  });
  expect(error).toBeNull();
  const rows = data!;
  expect(rows.length).toBeGreaterThan(0);
  const stageKeys = new Set(rows.map((r) => r.stage_key));
  expect(stageKeys).toEqual(new Set(["group 1"])); // lower(trim("Group 1"))
  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1].week_start).getTime();
    const cur = new Date(rows[i].week_start).getTime();
    expect(cur - prev).toBe(7 * 864e5); // contiguous weeks, one stage
  }
  for (const r of rows) {
    expect(new Date(r.week_start).getUTCDay()).toBe(1); // Monday
  }
  expect(rows.reduce((s, r) => s + r.planned, 0)).toBe(3); // three due dates
  expect(rows.reduce((s, r) => s + r.completed, 0)).toBe(1);
});

it("counts open items once per owner and puts ownerless items on the null row", async () => {
  const { data, error } = await member.rpc("folder_workload", {
    p_folder_id: folderId,
  });
  expect(error).toBeNull();
  const byUser = new Map<string | null, number>();
  for (const r of data!)
    byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + r.open_items);
  expect(byUser.get(memberId)).toBe(3); // p-early, p-late, two-owners (c-done excluded)
  expect(byUser.get(outsiderId)).toBe(1);
  expect(byUser.get(null)).toBe(1); // nobody
  expect(data!.every((r) => r.stage_key === "group 1")).toBe(true);
});

it("returns per-folder gallery counts for the workspace", async () => {
  const { data, error } = await member.rpc("folder_gallery", {
    p_workspace_id: wsId,
  });
  expect(error).toBeNull();
  const row = data!.find((r) => r.folder_id === folderId)!;
  expect(row).toMatchObject({
    board_count: 1,
    item_count: 5,
    done_count: 1,
    overdue_count: 1,
  });
  expect(row.attention_count).toBe(2); // p-early (overdue) + nobody (unassigned)
  const empty = data!.find((r) => r.folder_id === emptyFolderId)!;
  expect(empty).toMatchObject({
    board_count: 0,
    item_count: 0,
    attention_count: 0,
  });
});

it("returns empty sets for a folder with no boards", async () => {
  const burn = await member.rpc("folder_burn", { p_folder_id: emptyFolderId });
  expect(burn.error).toBeNull();
  expect(burn.data).toEqual([]);
  const wl = await member.rpc("folder_workload", {
    p_folder_id: emptyFolderId,
  });
  expect(wl.error).toBeNull();
  expect(wl.data).toEqual([]);
});

it("rejects a non-member on all three", async () => {
  expect(
    (await outsider.rpc("folder_burn", { p_folder_id: folderId })).error?.code,
  ).toBe("42501");
  expect(
    (await outsider.rpc("folder_workload", { p_folder_id: folderId })).error
      ?.code,
  ).toBe("42501");
  expect(
    (await outsider.rpc("folder_gallery", { p_workspace_id: wsId })).error
      ?.code,
  ).toBe("42501");
});
```

- [ ] **Step 5: Verify it fails to typecheck**

Run: `pnpm typecheck` → Expected: `"folder_burn"` not assignable to the RPC name union.

- [ ] **Step 6: Apply to DEV, regenerate types, ledger-check**

`supabase-dev` `apply_migration` (exact basename) → `generate_typescript_types` → `pnpm prettier --write src/types/database.types.ts` → `pnpm db:ledger-check` → Expected: `ledger ok`.

- [ ] **Step 7: Run typecheck + the suite**

Run: `pnpm typecheck` → clean. Run: `pnpm vitest run --project integration src/lib/folders/folder-burn.integration.test.ts` → skipped without `.env.test`; 5 passed with a marked target.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/<version>_folder_burn_workload_gallery.sql src/types/database.types.ts src/lib/folders/folder-burn.integration.test.ts
git commit -m "feat(db): folder_burn, folder_workload and folder_gallery rpcs"
```

---

### Task 4: `src/lib/folders` types, stage normalisation, rollup derivations, fixture (pure)

**Files:**

- Create: `src/lib/folders/types.ts`
- Create: `src/lib/folders/stages.ts`
- Create: `src/lib/folders/rollup.ts`
- Create: `src/lib/folders/fixture.ts`
- Test: `src/lib/folders/stages.test.ts`, `src/lib/folders/rollup.test.ts`

**Interfaces:**

- Consumes: nothing (pure; no DB, no React). Can start before Task 1 merges.
- Produces (every later task imports these names exactly):

```ts
// src/lib/folders/types.ts
export type FolderSummary = {
  id: string;
  name: string;
  workspaceId: string;
  orgId: string;
  position: number;
};
export type FolderBoardRef = { id: string; name: string; position: number };
export type FolderPlacement = {
  boardId: string;
  folderId: string;
  position: number;
};
export type FolderNavData = {
  folders: FolderSummary[];
  placements: FolderPlacement[];
};
export type RollupRow = {
  boardId;
  boardName;
  boardPosition;
  groupId: string | null;
  groupName: string | null;
  groupColor: string | null;
  groupPosition: number | null;
  total;
  done;
  inProgress;
  overdue;
  notStarted;
  blocked;
  stale;
  unassigned;
  incomplete;
  plannedByToday;
  dueThisWeek;
  dueThisWeekNotStarted: number;
  oldestOverdue: string | null;
  minDue: string | null;
  maxDue: string | null;
};
export type BurnRow = {
  stageKey: string;
  weekStart: string;
  planned: number;
  completed: number;
};
export type AttentionReason = "overdue" | "blocked" | "unassigned" | "stale";
export type AttentionRow = {
  itemId;
  itemName;
  boardId;
  boardName: string;
  groupId: string | null;
  groupName: string | null;
  reason: AttentionReason;
  ageDays: number;
  severity: number;
};
export type WorkloadRow = {
  userId: string | null;
  boardId;
  boardName;
  stageKey;
  stageName: string;
  open: number;
  overdue: number;
};
export type GalleryRow = {
  folderId;
  name: string;
  position;
  boards;
  items;
  done;
  overdue;
  attention: number;
};
export type IntelligenceBrief = {
  boardId: string;
  boardName: string;
  brief: string;
  generatedAt: string;
};
export type FolderMember = {
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
};
export type FolderPayload = {
  folder: FolderSummary;
  boards: FolderBoardRef[];
  rollup: RollupRow[] | null;
  burn: BurnRow[] | null;
  attention: AttentionRow[] | null;
  briefs: IntelligenceBrief[];
  members: FolderMember[];
  generatedAt: string;
  todayISO: string;
};
// stages.ts
export const ALL_ITEMS_KEY = "__all__";
export type StageState = "complete" | "in_flight" | "upcoming";
export type StageSummary = {
  key;
  name;
  color: string;
  position: number;
  boardIds: string[];
  onlyOnBoard: string | null;
  total;
  done;
  inProgress;
  overdue;
  notStarted;
  blocked;
  stale;
  unassigned: number;
  minDue: string | null;
  maxDue: string | null;
  state: StageState;
};
export function stageKey(name: string): string;
export function buildStages(
  rows: RollupRow[],
  todayISO: string,
): StageSummary[];
// rollup.ts
export type Kpis = {
  total;
  done: number;
  donePct: number | null;
  plannedByToday: number;
  gap: number | null;
  overdue: number;
  oldestOverdueDays: number | null;
  dueThisWeek;
  dueThisWeekNotStarted;
  blocked;
  stale: number;
};
export type BoardHealth = "on_track" | "at_risk" | "off_track";
export type BoardSummary = {
  id;
  name: string;
  health: BoardHealth;
  total;
  done;
  inProgress;
  overdue;
  notStarted;
  stale: number;
  donePct: number | null;
  nextMilestone: string | null;
};
export type MatrixBand = "green" | "blue" | "yellow" | "gray";
export type BurnPoint = {
  weekStart: string;
  planned;
  completed;
  plannedCum;
  completedCum: number;
  isPast: boolean;
};
export type Milestone = {
  stageKey;
  name: string;
  endDate: string;
  openBefore: number;
};
export function filterRows(
  rows: RollupRow[],
  f: { stageKey: string | null; boardId: string | null },
): RollupRow[];
export function computeKpis(rows: RollupRow[], todayISO: string): Kpis;
export function boardHealth(
  b: Pick<BoardSummary, "total" | "overdue"> & {
    blocked: number;
    incomplete: number;
  },
): BoardHealth;
export function boardSummaries(
  rows: RollupRow[],
  boards: FolderBoardRef[],
  stages: StageSummary[],
): BoardSummary[];
export function stageMatrix(
  rows: RollupRow[],
): Map<string /* boardId */, Map<string /* stageKey */, number | null>>;
export function band(pct: number): MatrixBand;
export function nextMilestones(
  stages: StageSummary[],
  todayISO: string,
  n?: number,
): Milestone[];
export function carryOver(rows: RollupRow[], stages: StageSummary[]): number;
export function burnSeries(
  rows: BurnRow[],
  stageKey: string | null,
  todayISO: string,
): BurnPoint[];
export function onlyOnOneBoard(
  rows: RollupRow[],
  stages: StageSummary[],
): { groupId: string; groupName: string; boardId: string; boardName: string }[];
export function daysBetween(fromISO: string, toISO: string): number;
// fixture.ts
export const FIXTURE_TODAY = "2026-09-15";
export function folderFixture(): FolderPayload; // 3 boards × 3 stages, one only-on-one-board group, burn over 6 weeks, 4 attention rows, 1 brief
```

- [ ] **Step 1: Write the failing stage tests**

`src/lib/folders/stages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALL_ITEMS_KEY, buildStages, stageKey } from "./stages";
import type { RollupRow } from "./types";

const row = (
  o: Partial<RollupRow> & { boardId: string; groupName: string | null },
): RollupRow => ({
  boardName: o.boardId,
  boardPosition: 0,
  groupId: o.groupName ? `${o.boardId}:${o.groupName}` : null,
  groupColor: "#0073ea",
  groupPosition: 0,
  total: 0,
  done: 0,
  inProgress: 0,
  overdue: 0,
  notStarted: 0,
  blocked: 0,
  stale: 0,
  unassigned: 0,
  incomplete: 0,
  plannedByToday: 0,
  dueThisWeek: 0,
  dueThisWeekNotStarted: 0,
  oldestOverdue: null,
  minDue: null,
  maxDue: null,
  ...o,
});

describe("stageKey", () => {
  it("trims and lower-cases", () => {
    expect(stageKey("  Wave 2 ")).toBe("wave 2");
  });
});

describe("buildStages", () => {
  it("merges same-named groups across boards, first-seen casing and colour, ordered by min position", () => {
    const stages = buildStages(
      [
        row({
          boardId: "b1",
          boardPosition: 0,
          groupName: "Build",
          groupPosition: 2,
          groupColor: "#111111",
          total: 2,
          done: 1,
          inProgress: 1,
        }),
        row({
          boardId: "b2",
          boardPosition: 1,
          groupName: "build",
          groupPosition: 0,
          groupColor: "#222222",
          total: 3,
          done: 3,
        }),
        row({
          boardId: "b1",
          boardPosition: 0,
          groupName: "Discovery",
          groupPosition: 1,
          total: 1,
          done: 1,
        }),
      ],
      "2026-09-15",
    );
    expect(stages.map((s) => s.key)).toEqual(["build", "discovery"]);
    expect(stages[0]).toMatchObject({
      name: "Build",
      color: "#111111",
      total: 5,
      done: 4,
      boardIds: ["b1", "b2"],
      onlyOnBoard: null,
    });
    expect(stages[1]).toMatchObject({
      name: "Discovery",
      onlyOnBoard: "b1",
      total: 1,
      done: 1,
      state: "complete",
    });
  });

  it("derives state: complete / in_flight / upcoming", () => {
    const stages = buildStages(
      [
        row({
          boardId: "b1",
          groupName: "A",
          groupPosition: 0,
          total: 2,
          done: 2,
        }),
        row({
          boardId: "b1",
          groupName: "B",
          groupPosition: 1,
          total: 2,
          inProgress: 1,
          notStarted: 1,
        }),
        row({
          boardId: "b1",
          groupName: "C",
          groupPosition: 2,
          total: 2,
          notStarted: 2,
          minDue: "2026-09-01",
          maxDue: "2026-09-30",
        }),
        row({
          boardId: "b1",
          groupName: "D",
          groupPosition: 3,
          total: 2,
          notStarted: 2,
          minDue: "2026-10-01",
          maxDue: "2026-10-30",
        }),
        row({ boardId: "b1", groupName: "E", groupPosition: 4, total: 0 }),
      ],
      "2026-09-15",
    );
    expect(stages.map((s) => s.state)).toEqual([
      "complete",
      "in_flight",
      "in_flight",
      "upcoming",
      "upcoming",
    ]);
  });

  it("synthesises one 'All items' stage when no board has groups", () => {
    const stages = buildStages(
      [
        row({
          boardId: "b1",
          groupName: null,
          total: 4,
          done: 1,
          notStarted: 3,
        }),
      ],
      "2026-09-15",
    );
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({
      key: ALL_ITEMS_KEY,
      name: "All items",
      total: 4,
    });
  });

  it("ignores null-group rows when real groups exist", () => {
    const stages = buildStages(
      [
        row({ boardId: "b1", groupName: "A", total: 1 }),
        row({ boardId: "b2", groupName: null, total: 0 }),
      ],
      "2026-09-15",
    );
    expect(stages.map((s) => s.key)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/folders/stages.test.ts`
Expected: FAIL — cannot resolve `./stages`.

- [ ] **Step 3: Write `types.ts` and `stages.ts`**

`src/lib/folders/types.ts` — the shapes listed under Interfaces, spelled out in full (every field typed `string` / `number` / `string | null` exactly as shown; no shorthand).

`src/lib/folders/stages.ts`:

```ts
import type { RollupRow } from "./types";

/** The synthetic stage used when no board in the folder has a group (spec §8). */
export const ALL_ITEMS_KEY = "__all__";

export type StageState = "complete" | "in_flight" | "upcoming";

export type StageSummary = {
  key: string;
  name: string;
  color: string;
  position: number;
  boardIds: string[];
  /** Set when exactly one board carries this stage ("Only on <board>"). */
  onlyOnBoard: string | null;
  total: number;
  done: number;
  inProgress: number;
  overdue: number;
  notStarted: number;
  blocked: number;
  stale: number;
  unassigned: number;
  minDue: string | null;
  maxDue: string | null;
  state: StageState;
};

/** Spec §3.4: a stage is a distinct trim(lower(group name)) across the folder. */
export function stageKey(name: string): string {
  return name.trim().toLowerCase();
}

function minISO(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}
function maxISO(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

function stateOf(s: Omit<StageSummary, "state">, todayISO: string): StageState {
  if (s.total > 0 && s.done === s.total) return "complete";
  if (s.inProgress > 0 || s.overdue > 0) return "in_flight";
  if (
    s.minDue !== null &&
    s.maxDue !== null &&
    s.minDue <= todayISO &&
    todayISO <= s.maxDue
  )
    return "in_flight";
  return "upcoming";
}

/**
 * Fold rollup rows into stages. Name/colour are first-seen (lowest board
 * position, then group position); order is the minimum group position across
 * boards. Rows with no group (a board without groups) only matter when NO row
 * has a group — then they form the single "All items" stage.
 */
export function buildStages(
  rows: RollupRow[],
  todayISO: string,
): StageSummary[] {
  const grouped = rows.filter(
    (r) => r.groupId !== null && r.groupName !== null,
  );
  const source = grouped.length > 0 ? grouped : rows;
  const acc = new Map<
    string,
    Omit<StageSummary, "state"> & { seenAt: [number, number] }
  >();

  const sorted = [...source].sort(
    (a, b) =>
      a.boardPosition - b.boardPosition ||
      (a.groupPosition ?? 0) - (b.groupPosition ?? 0),
  );
  for (const r of sorted) {
    const key =
      grouped.length > 0 ? stageKey(r.groupName as string) : ALL_ITEMS_KEY;
    const name =
      grouped.length > 0 ? (r.groupName as string).trim() : "All items";
    const position = r.groupPosition ?? 0;
    const cur = acc.get(key);
    if (!cur) {
      acc.set(key, {
        key,
        name,
        color: r.groupColor ?? "#0073ea",
        position,
        boardIds: [r.boardId],
        onlyOnBoard: r.boardId,
        total: r.total,
        done: r.done,
        inProgress: r.inProgress,
        overdue: r.overdue,
        notStarted: r.notStarted,
        blocked: r.blocked,
        stale: r.stale,
        unassigned: r.unassigned,
        minDue: r.minDue,
        maxDue: r.maxDue,
        seenAt: [r.boardPosition, position],
      });
      continue;
    }
    if (!cur.boardIds.includes(r.boardId)) cur.boardIds.push(r.boardId);
    cur.onlyOnBoard = cur.boardIds.length === 1 ? cur.boardIds[0] : null;
    cur.position = Math.min(cur.position, position);
    cur.total += r.total;
    cur.done += r.done;
    cur.inProgress += r.inProgress;
    cur.overdue += r.overdue;
    cur.notStarted += r.notStarted;
    cur.blocked += r.blocked;
    cur.stale += r.stale;
    cur.unassigned += r.unassigned;
    cur.minDue = minISO(cur.minDue, r.minDue);
    cur.maxDue = maxISO(cur.maxDue, r.maxDue);
  }

  return [...acc.values()]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map(({ seenAt: _seen, ...s }) => ({ ...s, state: stateOf(s, todayISO) }));
}
```

- [ ] **Step 4: Run stage tests**

Run: `pnpm vitest run src/lib/folders/stages.test.ts` → Expected: 5 passed.

- [ ] **Step 5: Write the failing rollup tests**

`src/lib/folders/rollup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildStages } from "./stages";
import {
  band,
  boardHealth,
  boardSummaries,
  burnSeries,
  carryOver,
  computeKpis,
  daysBetween,
  filterRows,
  nextMilestones,
  onlyOnOneBoard,
  stageMatrix,
} from "./rollup";
import { FIXTURE_TODAY, folderFixture } from "./fixture";
import type { BurnRow } from "./types";

const fx = folderFixture();
const rows = fx.rollup!;
const stages = buildStages(rows, FIXTURE_TODAY);

describe("computeKpis", () => {
  it("sums buckets and derives percent, gap and oldest overdue age", () => {
    const k = computeKpis(rows, FIXTURE_TODAY);
    expect(k.total).toBe(rows.reduce((s, r) => s + r.total, 0));
    expect(k.done).toBe(rows.reduce((s, r) => s + r.done, 0));
    expect(k.donePct).toBe(Math.round((k.done / k.total) * 100));
    expect(k.gap).toBe(k.done - k.plannedByToday);
    expect(k.oldestOverdueDays).toBe(daysBetween("2026-09-01", FIXTURE_TODAY)); // fixture's oldest
  });

  it("reports null percent/gap with no items or no due dates", () => {
    expect(computeKpis([], FIXTURE_TODAY)).toMatchObject({
      donePct: null,
      gap: null,
      oldestOverdueDays: null,
    });
    const noDates = rows.map((r) => ({
      ...r,
      minDue: null,
      maxDue: null,
      plannedByToday: 0,
      oldestOverdue: null,
    }));
    expect(computeKpis(noDates, FIXTURE_TODAY).gap).toBeNull();
  });

  it("gap sign: negative when behind plan, positive when ahead", () => {
    const behind = [{ ...rows[0], done: 1, plannedByToday: 4 }];
    const ahead = [{ ...rows[0], done: 4, plannedByToday: 1 }];
    expect(computeKpis(behind, FIXTURE_TODAY).gap).toBe(-3);
    expect(computeKpis(ahead, FIXTURE_TODAY).gap).toBe(3);
  });
});

describe("filterRows", () => {
  it("filters by stage key and board id", () => {
    const only = filterRows(rows, { stageKey: "build", boardId: "b1" });
    expect(
      only.every(
        (r) => r.boardId === "b1" && r.groupName?.toLowerCase() === "build",
      ),
    ).toBe(true);
    expect(filterRows(rows, { stageKey: null, boardId: null })).toEqual(rows);
  });
});

describe("boardHealth", () => {
  it("applies the thresholds", () => {
    expect(
      boardHealth({ total: 10, overdue: 0, blocked: 0, incomplete: 0 }),
    ).toBe("on_track");
    expect(
      boardHealth({ total: 10, overdue: 1, blocked: 0, incomplete: 0 }),
    ).toBe("at_risk");
    expect(
      boardHealth({ total: 10, overdue: 0, blocked: 0, incomplete: 6 }),
    ).toBe("at_risk");
    expect(
      boardHealth({ total: 10, overdue: 2, blocked: 1, incomplete: 0 }),
    ).toBe("off_track");
    expect(
      boardHealth({ total: 0, overdue: 0, blocked: 0, incomplete: 0 }),
    ).toBe("on_track");
  });
});

describe("boardSummaries + stageMatrix + band", () => {
  it("lists every board even with zero rollup rows", () => {
    const s = boardSummaries(
      rows,
      [...fx.boards, { id: "ghost", name: "Ghost", position: 9 }],
      stages,
    );
    expect(s.map((b) => b.id)).toContain("ghost");
    expect(s.find((b) => b.id === "ghost")).toMatchObject({
      total: 0,
      donePct: null,
      health: "on_track",
    });
  });

  it("matrix cells are percent done or null when the board lacks the stage", () => {
    const m = stageMatrix(rows);
    expect(m.get("b1")?.get("build")).toBe(50);
    expect(m.get("b3")?.get("qa")).toBeNull();
  });

  it("bands: >=90 green, >=50 blue, >=25 yellow, else gray", () => {
    expect(band(90)).toBe("green");
    expect(band(50)).toBe("blue");
    expect(band(25)).toBe("yellow");
    expect(band(24)).toBe("gray");
  });
});

describe("milestones + carry-over + only-on-one-board", () => {
  it("returns the next three stage end dates with open items before each", () => {
    const ms = nextMilestones(stages, FIXTURE_TODAY, 3);
    expect(ms.length).toBeLessThanOrEqual(3);
    expect(ms.every((m) => m.endDate >= FIXTURE_TODAY)).toBe(true);
    expect(ms.map((m) => m.endDate)).toEqual(
      [...ms.map((m) => m.endDate)].sort(),
    );
  });

  it("counts open items in stages that are complete elsewhere", () => {
    // fixture: "qa" is complete on b1 (2/2) but b2 still has 1 open in qa
    expect(carryOver(rows, stages)).toBe(1);
  });

  it("lists groups no other board shares", () => {
    expect(onlyOnOneBoard(rows, stages)).toEqual([
      {
        groupId: "b3:launch",
        groupName: "Launch",
        boardId: "b3",
        boardName: "Website",
      },
    ]);
  });
});

describe("burnSeries", () => {
  const burn: BurnRow[] = [
    { stageKey: "build", weekStart: "2026-08-31", planned: 2, completed: 1 },
    { stageKey: "build", weekStart: "2026-09-07", planned: 1, completed: 0 },
    { stageKey: "build", weekStart: "2026-09-14", planned: 0, completed: 2 },
    { stageKey: "qa", weekStart: "2026-08-31", planned: 0, completed: 0 },
    { stageKey: "qa", weekStart: "2026-09-07", planned: 3, completed: 1 },
    { stageKey: "qa", weekStart: "2026-09-14", planned: 0, completed: 0 },
  ];
  it("sums stages per week when no stage is selected and accumulates", () => {
    const pts = burnSeries(burn, null, FIXTURE_TODAY);
    expect(pts.map((p) => p.weekStart)).toEqual([
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
    ]);
    expect(pts.map((p) => p.planned)).toEqual([2, 4, 0]);
    expect(pts.map((p) => p.plannedCum)).toEqual([2, 6, 6]);
    expect(pts.map((p) => p.completedCum)).toEqual([1, 2, 4]);
    expect(pts.map((p) => p.isPast)).toEqual([true, true, true]); // week of today counts as past
  });
  it("scopes to one stage", () => {
    expect(burnSeries(burn, "qa", FIXTURE_TODAY).map((p) => p.planned)).toEqual(
      [0, 3, 0],
    );
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm vitest run src/lib/folders/rollup.test.ts` → Expected: FAIL — cannot resolve `./rollup` / `./fixture`.

- [ ] **Step 7: Write `rollup.ts`**

```ts
import type { StageSummary } from "./stages";
import { ALL_ITEMS_KEY, stageKey } from "./stages";
import type { BurnRow, FolderBoardRef, RollupRow } from "./types";

export type Kpis = {
  total: number;
  done: number;
  donePct: number | null;
  plannedByToday: number;
  gap: number | null;
  overdue: number;
  oldestOverdueDays: number | null;
  dueThisWeek: number;
  dueThisWeekNotStarted: number;
  blocked: number;
  stale: number;
};
export type BoardHealth = "on_track" | "at_risk" | "off_track";
export type BoardSummary = {
  id: string;
  name: string;
  health: BoardHealth;
  total: number;
  done: number;
  inProgress: number;
  overdue: number;
  notStarted: number;
  stale: number;
  donePct: number | null;
  nextMilestone: string | null;
};
export type MatrixBand = "green" | "blue" | "yellow" | "gray";
export type BurnPoint = {
  weekStart: string;
  planned: number;
  completed: number;
  plannedCum: number;
  completedCum: number;
  isPast: boolean;
};
export type Milestone = {
  stageKey: string;
  name: string;
  endDate: string;
  openBefore: number;
};

/** Whole days from `fromISO` to `toISO` (both `YYYY-MM-DD`); negative when reversed. */
export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 864e5);
}

function rowStageKey(r: RollupRow): string {
  return r.groupName === null ? ALL_ITEMS_KEY : stageKey(r.groupName);
}

export function filterRows(
  rows: RollupRow[],
  f: { stageKey: string | null; boardId: string | null },
): RollupRow[] {
  return rows.filter(
    (r) =>
      (f.boardId === null || r.boardId === f.boardId) &&
      (f.stageKey === null || rowStageKey(r) === f.stageKey),
  );
}

export function computeKpis(rows: RollupRow[], todayISO: string): Kpis {
  let total = 0,
    done = 0,
    plannedByToday = 0,
    overdue = 0,
    dueThisWeek = 0;
  let dueThisWeekNotStarted = 0,
    blocked = 0,
    stale = 0;
  let oldest: string | null = null;
  let anyDue = false;
  for (const r of rows) {
    total += r.total;
    done += r.done;
    plannedByToday += r.plannedByToday;
    overdue += r.overdue;
    dueThisWeek += r.dueThisWeek;
    dueThisWeekNotStarted += r.dueThisWeekNotStarted;
    blocked += r.blocked;
    stale += r.stale;
    if (r.minDue !== null || r.maxDue !== null) anyDue = true;
    if (
      r.oldestOverdue !== null &&
      (oldest === null || r.oldestOverdue < oldest)
    )
      oldest = r.oldestOverdue;
  }
  return {
    total,
    done,
    donePct: total > 0 ? Math.round((done / total) * 100) : null,
    plannedByToday,
    gap: anyDue ? done - plannedByToday : null,
    overdue,
    oldestOverdueDays: oldest === null ? null : daysBetween(oldest, todayISO),
    dueThisWeek,
    dueThisWeekNotStarted,
    blocked,
    stale,
  };
}

/** Resolved ambiguity #7: the health pill rule over the digest's counts. */
export function boardHealth(b: {
  total: number;
  overdue: number;
  blocked: number;
  incomplete: number;
}): BoardHealth {
  if (b.total === 0) return "on_track";
  if (b.overdue >= 1 && (b.overdue + b.blocked) / b.total >= 0.2)
    return "off_track";
  if (b.overdue >= 1 || b.blocked >= 1 || b.incomplete / b.total >= 0.5)
    return "at_risk";
  return "on_track";
}

export function boardSummaries(
  rows: RollupRow[],
  boards: FolderBoardRef[],
  stages: StageSummary[],
): BoardSummary[] {
  const byBoard = new Map<string, RollupRow[]>();
  for (const r of rows)
    byBoard.set(r.boardId, [...(byBoard.get(r.boardId) ?? []), r]);
  return [...boards]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((b) => {
      const rs = byBoard.get(b.id) ?? [];
      const sum = (
        k: keyof Pick<
          RollupRow,
          | "total"
          | "done"
          | "inProgress"
          | "overdue"
          | "notStarted"
          | "stale"
          | "blocked"
          | "incomplete"
        >,
      ) => rs.reduce((s, r) => s + r[k], 0);
      const total = sum("total");
      const keys = new Set(rs.map(rowStageKey));
      const next =
        stages
          .filter(
            (s) =>
              keys.has(s.key) && s.maxDue !== null && s.state !== "complete",
          )
          .map((s) => s.maxDue as string)
          .sort()[0] ?? null;
      return {
        id: b.id,
        name: b.name,
        health: boardHealth({
          total,
          overdue: sum("overdue"),
          blocked: sum("blocked"),
          incomplete: sum("incomplete"),
        }),
        total,
        done: sum("done"),
        inProgress: sum("inProgress"),
        overdue: sum("overdue"),
        notStarted: sum("notStarted"),
        stale: sum("stale"),
        donePct: total > 0 ? Math.round((sum("done") / total) * 100) : null,
        nextMilestone: next,
      };
    });
}

/** boardId → stageKey → percent done (null: the board has no such group). */
export function stageMatrix(
  rows: RollupRow[],
): Map<string, Map<string, number | null>> {
  const m = new Map<string, Map<string, number | null>>();
  const keys = new Set(rows.filter((r) => r.groupId !== null).map(rowStageKey));
  for (const r of rows) {
    if (!m.has(r.boardId))
      m.set(r.boardId, new Map([...keys].map((k) => [k, null])));
    if (r.groupId === null) continue;
    const cell = m.get(r.boardId) as Map<string, number | null>;
    const prev = cell.get(rowStageKey(r));
    const pct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
    cell.set(
      rowStageKey(r),
      prev === null || prev === undefined ? pct : Math.round((prev + pct) / 2),
    );
  }
  return m;
}

export function band(pct: number): MatrixBand {
  if (pct >= 90) return "green";
  if (pct >= 50) return "blue";
  if (pct >= 25) return "yellow";
  return "gray";
}

/** Next `n` stage end dates (latest due inside the stage) on/after today, with the open count before each. */
export function nextMilestones(
  stages: StageSummary[],
  todayISO: string,
  n = 3,
): Milestone[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const out: Milestone[] = [];
  const upcoming = ordered
    .filter((s) => s.maxDue !== null && s.maxDue >= todayISO)
    .sort((a, b) => (a.maxDue as string).localeCompare(b.maxDue as string));
  for (const s of upcoming.slice(0, n)) {
    const idx = ordered.findIndex((x) => x.key === s.key);
    const openBefore = ordered
      .slice(0, idx + 1)
      .reduce((acc, x) => acc + (x.total - x.done), 0);
    out.push({
      stageKey: s.key,
      name: s.name,
      endDate: s.maxDue as string,
      openBefore,
    });
  }
  return out;
}

/** Open items in a stage that is COMPLETE on at least one other board (spec §5.3.4). */
export function carryOver(rows: RollupRow[], stages: StageSummary[]): number {
  const byStage = new Map<string, RollupRow[]>();
  for (const r of rows) {
    if (r.groupId === null) continue;
    byStage.set(rowStageKey(r), [...(byStage.get(rowStageKey(r)) ?? []), r]);
  }
  let n = 0;
  for (const s of stages) {
    const rs = byStage.get(s.key) ?? [];
    const completeSomewhere = rs.some((r) => r.total > 0 && r.done === r.total);
    if (!completeSomewhere) continue;
    for (const r of rs)
      if (r.total > 0 && r.done < r.total) n += r.total - r.done;
  }
  return n;
}

export function onlyOnOneBoard(
  rows: RollupRow[],
  stages: StageSummary[],
): {
  groupId: string;
  groupName: string;
  boardId: string;
  boardName: string;
}[] {
  const single = new Set(
    stages
      .filter((s) => s.onlyOnBoard !== null && s.key !== ALL_ITEMS_KEY)
      .map((s) => s.key),
  );
  return rows
    .filter(
      (r) =>
        r.groupId !== null &&
        r.groupName !== null &&
        single.has(rowStageKey(r)),
    )
    .map((r) => ({
      groupId: r.groupId as string,
      groupName: (r.groupName as string).trim(),
      boardId: r.boardId,
      boardName: r.boardName,
    }));
}

/** Weekly + cumulative series for one stage (or all stages summed). Rows are already contiguous per stage (folder_burn). */
export function burnSeries(
  rows: BurnRow[],
  stage: string | null,
  todayISO: string,
): BurnPoint[] {
  const weeks = new Map<string, { planned: number; completed: number }>();
  for (const r of rows) {
    if (stage !== null && r.stageKey !== stage) continue;
    const w = weeks.get(r.weekStart) ?? { planned: 0, completed: 0 };
    w.planned += r.planned;
    w.completed += r.completed;
    weeks.set(r.weekStart, w);
  }
  const thisWeek =
    [...weeks.keys()]
      .filter((w) => w <= todayISO)
      .sort()
      .at(-1) ?? null;
  let pc = 0,
    cc = 0;
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, w]) => {
      pc += w.planned;
      cc += w.completed;
      return {
        weekStart,
        planned: w.planned,
        completed: w.completed,
        plannedCum: pc,
        completedCum: cc,
        isPast: thisWeek !== null && weekStart <= thisWeek,
      };
    });
}
```

- [ ] **Step 8: Write `fixture.ts`**

```ts
import type { FolderPayload, RollupRow } from "./types";

export const FIXTURE_TODAY = "2026-09-15";

const base = (
  o: Partial<RollupRow> &
    Pick<
      RollupRow,
      | "boardId"
      | "boardName"
      | "boardPosition"
      | "groupId"
      | "groupName"
      | "groupPosition"
    >,
): RollupRow => ({
  groupColor: "#0073ea",
  total: 0,
  done: 0,
  inProgress: 0,
  overdue: 0,
  notStarted: 0,
  blocked: 0,
  stale: 0,
  unassigned: 0,
  incomplete: 0,
  plannedByToday: 0,
  dueThisWeek: 0,
  dueThisWeekNotStarted: 0,
  oldestOverdue: null,
  minDue: null,
  maxDue: null,
  ...o,
});

/** 3 boards × stages Discovery / Build / QA (+ "Launch" only on Website). */
export function folderFixture(): FolderPayload {
  const rollup: RollupRow[] = [
    base({
      boardId: "b1",
      boardName: "Backend",
      boardPosition: 0,
      groupId: "b1:discovery",
      groupName: "Discovery",
      groupPosition: 0,
      total: 4,
      done: 4,
      plannedByToday: 4,
      minDue: "2026-08-03",
      maxDue: "2026-08-21",
    }),
    base({
      boardId: "b1",
      boardName: "Backend",
      boardPosition: 0,
      groupId: "b1:build",
      groupName: "Build",
      groupPosition: 1,
      total: 6,
      done: 3,
      inProgress: 2,
      overdue: 1,
      blocked: 1,
      plannedByToday: 4,
      dueThisWeek: 2,
      dueThisWeekNotStarted: 1,
      oldestOverdue: "2026-09-01",
      minDue: "2026-08-24",
      maxDue: "2026-09-25",
    }),
    base({
      boardId: "b1",
      boardName: "Backend",
      boardPosition: 0,
      groupId: "b1:qa",
      groupName: "QA",
      groupPosition: 2,
      total: 2,
      done: 2,
      plannedByToday: 2,
      minDue: "2026-09-01",
      maxDue: "2026-09-10",
    }),
    base({
      boardId: "b2",
      boardName: "Mobile",
      boardPosition: 1,
      groupId: "b2:discovery",
      groupName: "discovery",
      groupPosition: 0,
      total: 3,
      done: 3,
      plannedByToday: 3,
      minDue: "2026-08-03",
      maxDue: "2026-08-14",
    }),
    base({
      boardId: "b2",
      boardName: "Mobile",
      boardPosition: 1,
      groupId: "b2:build",
      groupName: "Build",
      groupPosition: 1,
      total: 5,
      done: 1,
      inProgress: 2,
      notStarted: 2,
      stale: 1,
      unassigned: 1,
      incomplete: 2,
      plannedByToday: 2,
      dueThisWeek: 1,
      minDue: "2026-09-07",
      maxDue: "2026-10-02",
    }),
    base({
      boardId: "b2",
      boardName: "Mobile",
      boardPosition: 1,
      groupId: "b2:qa",
      groupName: "QA",
      groupPosition: 2,
      total: 1,
      notStarted: 1,
      minDue: "2026-10-05",
      maxDue: "2026-10-09",
    }),
    base({
      boardId: "b3",
      boardName: "Website",
      boardPosition: 2,
      groupId: "b3:build",
      groupName: "Build",
      groupPosition: 0,
      total: 3,
      done: 0,
      notStarted: 3,
      unassigned: 2,
      incomplete: 3,
      minDue: "2026-10-12",
      maxDue: "2026-10-30",
    }),
    base({
      boardId: "b3",
      boardName: "Website",
      boardPosition: 2,
      groupId: "b3:launch",
      groupName: "Launch",
      groupPosition: 1,
      total: 2,
      notStarted: 2,
      minDue: "2026-11-02",
      maxDue: "2026-11-06",
    }),
  ];
  return {
    folder: {
      id: "f1",
      name: "Q4 Launch",
      workspaceId: "w1",
      orgId: "o1",
      position: 0,
    },
    boards: [
      { id: "b1", name: "Backend", position: 0 },
      { id: "b2", name: "Mobile", position: 1 },
      { id: "b3", name: "Website", position: 2 },
    ],
    rollup,
    burn: [
      { stageKey: "build", weekStart: "2026-08-24", planned: 2, completed: 1 },
      { stageKey: "build", weekStart: "2026-08-31", planned: 3, completed: 1 },
      { stageKey: "build", weekStart: "2026-09-07", planned: 2, completed: 1 },
      { stageKey: "build", weekStart: "2026-09-14", planned: 3, completed: 1 },
      { stageKey: "build", weekStart: "2026-09-21", planned: 2, completed: 0 },
      { stageKey: "build", weekStart: "2026-09-28", planned: 2, completed: 0 },
      { stageKey: "qa", weekStart: "2026-08-24", planned: 0, completed: 0 },
      { stageKey: "qa", weekStart: "2026-08-31", planned: 1, completed: 1 },
      { stageKey: "qa", weekStart: "2026-09-07", planned: 1, completed: 1 },
      { stageKey: "qa", weekStart: "2026-09-14", planned: 0, completed: 0 },
      { stageKey: "qa", weekStart: "2026-09-21", planned: 0, completed: 0 },
      { stageKey: "qa", weekStart: "2026-09-28", planned: 0, completed: 0 },
    ],
    attention: [
      {
        itemId: "i1",
        itemName: "Auth refactor",
        boardId: "b1",
        boardName: "Backend",
        groupId: "b1:build",
        groupName: "Build",
        reason: "overdue",
        ageDays: 14,
        severity: 4,
      },
      {
        itemId: "i2",
        itemName: "Push notifications",
        boardId: "b1",
        boardName: "Backend",
        groupId: "b1:build",
        groupName: "Build",
        reason: "blocked",
        ageDays: 3,
        severity: 3,
      },
      {
        itemId: "i3",
        itemName: "Onboarding flow",
        boardId: "b2",
        boardName: "Mobile",
        groupId: "b2:build",
        groupName: "Build",
        reason: "unassigned",
        ageDays: 6,
        severity: 2,
      },
      {
        itemId: "i4",
        itemName: "Crash reporting",
        boardId: "b2",
        boardName: "Mobile",
        groupId: "b2:build",
        groupName: "Build",
        reason: "stale",
        ageDays: 21,
        severity: 1,
      },
    ],
    briefs: [
      {
        boardId: "b1",
        boardName: "Backend",
        brief: "Build is on pace; one auth item slipped two weeks.",
        generatedAt: "2026-09-15T08:00:00.000Z",
      },
    ],
    members: [
      { userId: "u1", fullName: "Ada Lovelace", avatarUrl: null },
      { userId: "u2", fullName: "Grace Hopper", avatarUrl: null },
    ],
    generatedAt: "2026-09-15T09:00:00.000Z",
    todayISO: FIXTURE_TODAY,
  };
}
```

- [ ] **Step 9: Run both suites**

Run: `pnpm vitest run src/lib/folders/` → Expected: `stages.test.ts` 5 passed, `rollup.test.ts` 13 passed.

- [ ] **Step 10: Commit**

```bash
git add src/lib/folders/types.ts src/lib/folders/stages.ts src/lib/folders/rollup.ts src/lib/folders/fixture.ts src/lib/folders/stages.test.ts src/lib/folders/rollup.test.ts
git commit -m "feat(folders): payload types, stage normalisation and rollup derivations"
```

---

### Task 5: `src/lib/folders` Zod, typed RPC resolvers, queries, cached nav read, Server Actions

**Files:**

- Create: `src/lib/validations/folders.ts`
- Create: `src/lib/folders/resolve.ts`
- Create: `src/lib/folders/queries.ts`
- Create: `src/lib/folders/queries-cached.ts`
- Create: `src/lib/folders/actions.ts`
- Modify: `src/lib/cache/tags.ts` (add `foldersTag`)
- Test: `src/lib/folders/resolve.test.ts`, `src/lib/folders/actions.test.ts`, `src/lib/folders/queries-cached.test.ts`

**Interfaces:**

- Consumes: Task 1–3 generated types (`Database["public"]["Functions"]["folder_rollup" | "folder_burn" | "folder_attention" | "folder_workload" | "folder_gallery"]`, `Tables<"folders">`), Task 4 types, `typedRpc` (`src/lib/supabase/typed-rpc.ts:33-39`), `ActionResult`/`fail`, `createClient` (`src/lib/supabase/server.ts`), `createServiceClient` (`src/lib/supabase/service.ts`), `getUser` (`src/lib/auth/session.ts:45`), `resolveActiveOrg` (`src/lib/org/active.ts:33`), `rowToRun` (`src/lib/ai/board-intelligence/runs.ts:26`).
- Produces:

```ts
// src/lib/cache/tags.ts
export const foldersTag = (orgId: string) => `folders:org:${orgId}`;
// src/lib/validations/folders.ts
export const folderIdSchema: z.ZodString; /* uuid */
export const createFolderSchema: z.ZodObject<{ workspaceId; name }>;
export const renameFolderSchema: z.ZodObject<{ folderId; name }>;
export const deleteFolderSchema: z.ZodObject<{ folderId }>;
export const moveBoardToFolderSchema: z.ZodObject<{
  boardId;
  folderId: nullable;
}>;
export const attachDashboardSchema: z.ZodObject<{
  dashboardId;
  folderId: nullable;
}>;
export const commandTabSchema = z.enum([
  "overview",
  "stages",
  "boards",
  "people",
]);
// src/lib/folders/resolve.ts   (all take the request's RLS client)
export type Resolved<T> =
  { ok: true; rows: T[] } | { ok: false; error: string };
export function resolveFolderRollup(
  supabase: SupabaseClient<Database>,
  folderId: string,
): Promise<Resolved<RollupRow>>;
export function resolveFolderBurn(
  supabase,
  folderId,
): Promise<Resolved<BurnRow>>;
export function resolveFolderAttention(
  supabase,
  folderId,
  limit?: number,
): Promise<Resolved<AttentionRow>>;
export function resolveFolderWorkload(
  supabase,
  folderId,
): Promise<Resolved<WorkloadRow>>;
export function resolveFolderGallery(
  supabase,
  workspaceId,
): Promise<Resolved<GalleryRow>>;
// src/lib/folders/queries.ts
export type FolderHead = { folder: FolderSummary; boards: FolderBoardRef[] };
export function getFolderHead(supabase, folderId): Promise<FolderHead | null>; // null = absent / RLS-hidden
export function listLatestBriefs(
  supabase,
  boards: FolderBoardRef[],
  userId: string,
): Promise<IntelligenceBrief[]>;
export function listFolderDashboards(
  supabase,
  folderId,
): Promise<
  { dashboard: Tables<"dashboards">; widgets: Tables<"dashboard_widgets">[] }[]
>;
export function listUnfiledDashboards(
  supabase,
  workspaceId,
): Promise<{ id: string; name: string }[]>;
// src/lib/folders/queries-cached.ts
export function listFoldersCached(
  orgId: string,
  workspaceId: string,
): Promise<FolderNavData | null>;
// src/lib/folders/actions.ts  ("use server")
export function createFolder(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult<FolderSummary>>;
export function renameFolder(input: {
  folderId: string;
  name: string;
}): Promise<ActionResult>;
export function deleteFolder(input: {
  folderId: string;
}): Promise<ActionResult>;
export function moveBoardToFolder(input: {
  boardId: string;
  folderId: string | null;
}): Promise<ActionResult>;
export function attachDashboardToFolder(input: {
  dashboardId: string;
  folderId: string | null;
}): Promise<ActionResult>;
export function getFolderWorkload(input: {
  folderId: string;
}): Promise<ActionResult<WorkloadRow[]>>;
export const FOLDER_GONE_ERROR = "That folder no longer exists."; // exported from types.ts, not actions.ts ("use server" modules export only async functions)
```

- [ ] **Step 1: Add the cache tag and the Zod module**

`src/lib/cache/tags.ts` — add after `boardFoldersTag`:

```ts
export const foldersTag = (orgId: string) => `folders:org:${orgId}`;
```

`src/lib/validations/folders.ts`:

```ts
import { z } from "zod";

// 60 chars matches the DB CHECK on folders.name — keep the two in step.
const name = z.string().trim().min(1).max(60);
const uuid = z.string().uuid();

export const folderIdSchema = uuid;
export const createFolderSchema = z.object({ workspaceId: uuid, name });
export const renameFolderSchema = z.object({ folderId: uuid, name });
export const deleteFolderSchema = z.object({ folderId: uuid });
export const moveBoardToFolderSchema = z.object({
  boardId: uuid,
  folderId: uuid.nullable(),
});
export const attachDashboardSchema = z.object({
  dashboardId: uuid,
  folderId: uuid.nullable(),
});
export const commandTabSchema = z.enum([
  "overview",
  "stages",
  "boards",
  "people",
]);
```

Also add to `src/lib/folders/types.ts`: `export const FOLDER_GONE_ERROR = "That folder no longer exists.";`

- [ ] **Step 2: Write the failing resolver test**

`src/lib/folders/resolve.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { resolveFolderAttention, resolveFolderRollup } from "./resolve";

function clientWith(rpc: (fn: string, args: unknown) => unknown) {
  return { rpc: vi.fn(rpc) } as unknown as SupabaseClient<Database>;
}

describe("resolveFolderRollup", () => {
  it("calls folder_rollup and camel-cases the row", async () => {
    const client = clientWith(async () => ({
      data: [
        {
          board_id: "b1",
          board_name: "Backend",
          board_position: 0,
          group_id: "g1",
          group_name: "Build",
          group_color: "#111",
          group_position: 1,
          total: 6,
          done: 3,
          in_progress: 2,
          overdue: 1,
          not_started: 0,
          blocked: 1,
          stale: 0,
          unassigned: 0,
          incomplete: 1,
          planned_by_today: 4,
          due_this_week: 2,
          due_this_week_not_started: 1,
          oldest_overdue: "2026-09-01",
          min_due: "2026-08-24",
          max_due: "2026-09-25",
        },
      ],
      error: null,
    }));
    const res = await resolveFolderRollup(client, "f1");
    expect(client.rpc).toHaveBeenCalledWith("folder_rollup", {
      p_folder_id: "f1",
    });
    expect(res).toEqual({
      ok: true,
      rows: [
        {
          boardId: "b1",
          boardName: "Backend",
          boardPosition: 0,
          groupId: "g1",
          groupName: "Build",
          groupColor: "#111",
          groupPosition: 1,
          total: 6,
          done: 3,
          inProgress: 2,
          overdue: 1,
          notStarted: 0,
          blocked: 1,
          stale: 0,
          unassigned: 0,
          incomplete: 1,
          plannedByToday: 4,
          dueThisWeek: 2,
          dueThisWeekNotStarted: 1,
          oldestOverdue: "2026-09-01",
          minDue: "2026-08-24",
          maxDue: "2026-09-25",
        },
      ],
    });
  });

  it("surfaces the RPC error message", async () => {
    const client = clientWith(async () => ({
      data: null,
      error: { message: "not authorized" },
    }));
    expect(await resolveFolderRollup(client, "f1")).toEqual({
      ok: false,
      error: "not authorized",
    });
  });
});

describe("resolveFolderAttention", () => {
  it("passes the limit and narrows the reason", async () => {
    const client = clientWith(async () => ({
      data: [
        {
          item_id: "i",
          item_name: "x",
          board_id: "b",
          board_name: "B",
          group_id: null,
          group_name: null,
          reason: "overdue",
          age_days: 3,
          severity: 4,
        },
      ],
      error: null,
    }));
    const res = await resolveFolderAttention(client, "f1", 5);
    expect(client.rpc).toHaveBeenCalledWith("folder_attention", {
      p_folder_id: "f1",
      p_limit: 5,
    });
    expect(res.ok && res.rows[0].reason).toBe("overdue");
  });

  it("drops a row whose reason is not one of the four", async () => {
    const client = clientWith(async () => ({
      data: [
        {
          item_id: "i",
          item_name: "x",
          board_id: "b",
          board_name: "B",
          group_id: null,
          group_name: null,
          reason: "weird",
          age_days: 3,
          severity: 4,
        },
      ],
      error: null,
    }));
    const res = await resolveFolderAttention(client, "f1");
    expect(res).toEqual({ ok: true, rows: [] });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run src/lib/folders/resolve.test.ts` → Expected: FAIL — cannot resolve `./resolve`.

- [ ] **Step 4: Write `resolve.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import type { Database } from "@/types/database.types";
import type {
  AttentionReason,
  AttentionRow,
  BurnRow,
  GalleryRow,
  RollupRow,
  WorkloadRow,
} from "./types";

type DB = SupabaseClient<Database>;
export type Resolved<T> =
  { ok: true; rows: T[] } | { ok: false; error: string };

const REASONS: readonly AttentionReason[] = [
  "overdue",
  "blocked",
  "unassigned",
  "stale",
];
function isReason(v: string): v is AttentionReason {
  return (REASONS as readonly string[]).includes(v);
}

/**
 * Every RPC here is security definer and gates on auth.uid() (is_org_member +
 * can_read_board), so `supabase` MUST be the request's RLS client — never the
 * service client (see src/lib/dashboards/queries-cached.ts:35-55).
 */
export async function resolveFolderRollup(
  supabase: DB,
  folderId: string,
): Promise<Resolved<RollupRow>> {
  const { data, error } = await typedRpc(supabase, "folder_rollup", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      boardId: r.board_id,
      boardName: r.board_name,
      boardPosition: r.board_position,
      groupId: r.group_id,
      groupName: r.group_name,
      groupColor: r.group_color,
      groupPosition: r.group_position,
      total: r.total,
      done: r.done,
      inProgress: r.in_progress,
      overdue: r.overdue,
      notStarted: r.not_started,
      blocked: r.blocked,
      stale: r.stale,
      unassigned: r.unassigned,
      incomplete: r.incomplete,
      plannedByToday: r.planned_by_today,
      dueThisWeek: r.due_this_week,
      dueThisWeekNotStarted: r.due_this_week_not_started,
      oldestOverdue: r.oldest_overdue,
      minDue: r.min_due,
      maxDue: r.max_due,
    })),
  };
}

export async function resolveFolderBurn(
  supabase: DB,
  folderId: string,
): Promise<Resolved<BurnRow>> {
  const { data, error } = await typedRpc(supabase, "folder_burn", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      stageKey: r.stage_key,
      weekStart: r.week_start,
      planned: r.planned,
      completed: r.completed,
    })),
  };
}

export async function resolveFolderAttention(
  supabase: DB,
  folderId: string,
  limit = 20,
): Promise<Resolved<AttentionRow>> {
  const { data, error } = await typedRpc(supabase, "folder_attention", {
    p_folder_id: folderId,
    p_limit: limit,
  });
  if (error) return { ok: false, error: error.message };
  const rows: AttentionRow[] = [];
  for (const r of data ?? []) {
    if (!isReason(r.reason)) continue;
    rows.push({
      itemId: r.item_id,
      itemName: r.item_name,
      boardId: r.board_id,
      boardName: r.board_name,
      groupId: r.group_id,
      groupName: r.group_name,
      reason: r.reason,
      ageDays: r.age_days,
      severity: r.severity,
    });
  }
  return { ok: true, rows };
}

export async function resolveFolderWorkload(
  supabase: DB,
  folderId: string,
): Promise<Resolved<WorkloadRow>> {
  const { data, error } = await typedRpc(supabase, "folder_workload", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      userId: r.user_id,
      boardId: r.board_id,
      boardName: r.board_name,
      stageKey: r.stage_key,
      stageName: r.stage_name,
      open: r.open_items,
      overdue: r.overdue_items,
    })),
  };
}

export async function resolveFolderGallery(
  supabase: DB,
  workspaceId: string,
): Promise<Resolved<GalleryRow>> {
  const { data, error } = await typedRpc(supabase, "folder_gallery", {
    p_workspace_id: workspaceId,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      folderId: r.folder_id,
      name: r.folder_name,
      position: r.folder_position,
      boards: r.board_count,
      items: r.item_count,
      done: r.done_count,
      overdue: r.overdue_count,
      attention: r.attention_count,
    })),
  };
}
```

- [ ] **Step 5: Run the resolver tests**

Run: `pnpm vitest run src/lib/folders/resolve.test.ts` → Expected: 4 passed.

- [ ] **Step 6: Write `queries.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToRun } from "@/lib/ai/board-intelligence/runs";
import type { Database, Tables } from "@/types/database.types";
import type { FolderBoardRef, FolderSummary, IntelligenceBrief } from "./types";

type DB = SupabaseClient<Database>;
export type FolderHead = { folder: FolderSummary; boards: FolderBoardRef[] };

/** Spec §6 bound: ≤ 100 boards per folder. */
const FOLDER_BOARDS_LIMIT = 100;
/** Folded-in dashboards rendered on the Overview strip. */
const FOLDER_DASHBOARDS_LIMIT = 10;
/** Latest-run reads: runs are per (board, user); this bounds the dedupe scan. */
const BRIEF_RUNS_LIMIT = 200;

/** Folder + its live boards. Two reads in one Promise.all; null when RLS hides the folder. */
export async function getFolderHead(
  supabase: DB,
  folderId: string,
): Promise<FolderHead | null> {
  const [folderRes, boardsRes] = await Promise.all([
    supabase
      .from("folders")
      .select("id, name, workspace_id, org_id, position")
      .eq("id", folderId)
      .maybeSingle(),
    supabase
      .from("folder_boards")
      .select("position, boards!inner(id, name, archived_at)")
      .eq("folder_id", folderId)
      .is("boards.archived_at", null)
      .order("position", { ascending: true })
      .limit(FOLDER_BOARDS_LIMIT),
  ]);
  if (folderRes.error)
    throw new Error(`Failed to load folder: ${folderRes.error.message}`);
  if (!folderRes.data) return null;
  if (boardsRes.error)
    throw new Error(`Failed to load folder boards: ${boardsRes.error.message}`);
  const f = folderRes.data;
  return {
    folder: {
      id: f.id,
      name: f.name,
      workspaceId: f.workspace_id,
      orgId: f.org_id,
      position: f.position,
    },
    boards: (boardsRes.data ?? []).map((row) => ({
      id: row.boards.id,
      name: row.boards.name,
      position: row.position,
    })),
  };
}

/** The latest Board Intelligence brief per board for THIS user (runs are own-rows-only by RLS). */
export async function listLatestBriefs(
  supabase: DB,
  boards: FolderBoardRef[],
  userId: string,
): Promise<IntelligenceBrief[]> {
  if (boards.length === 0) return [];
  const { data, error } = await supabase
    .from("board_intelligence_runs")
    .select("*")
    .in(
      "board_id",
      boards.map((b) => b.id),
    )
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(BRIEF_RUNS_LIMIT);
  if (error || !data) return [];
  const nameOf = new Map(boards.map((b) => [b.id, b.name]));
  const seen = new Set<string>();
  const out: IntelligenceBrief[] = [];
  for (const row of data) {
    if (seen.has(row.board_id)) continue;
    const run = rowToRun(row);
    if (!run) continue;
    seen.add(row.board_id);
    out.push({
      boardId: row.board_id,
      boardName: nameOf.get(row.board_id) ?? "",
      brief: run.payload.brief,
      generatedAt: run.generatedAt,
    });
  }
  return out.sort((a, b) => a.boardName.localeCompare(b.boardName));
}

/** Folded-in dashboards with their widget rows, oldest first (resolved ambiguity #5). */
export async function listFolderDashboards(
  supabase: DB,
  folderId: string,
): Promise<
  { dashboard: Tables<"dashboards">; widgets: Tables<"dashboard_widgets">[] }[]
> {
  const { data, error } = await supabase
    .from("dashboards")
    .select("*, dashboard_widgets(*)")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: true })
    .limit(FOLDER_DASHBOARDS_LIMIT);
  if (error)
    throw new Error(`Failed to load folder dashboards: ${error.message}`);
  return (data ?? []).map(({ dashboard_widgets, ...dashboard }) => ({
    dashboard,
    widgets: [...dashboard_widgets].sort((a, b) => a.position - b.position),
  }));
}

/** Dashboards in the workspace with no folder — the "Unfiled" gallery section and the attach picker. */
export async function listUnfiledDashboards(
  supabase: DB,
  workspaceId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("dashboards")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("folder_id", null)
    .order("name", { ascending: true })
    .limit(100);
  if (error)
    throw new Error(`Failed to load unfiled dashboards: ${error.message}`);
  return data ?? [];
}
```

- [ ] **Step 7: Write the failing cached-read test and `queries-cached.ts`**

`src/lib/folders/queries-cached.test.ts` (same fake-client shape as `src/lib/boards/folders/queries-cached.test.ts:57-81`):

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));
import { createServiceClient } from "@/lib/supabase/service";
import { listFoldersCached } from "./queries-cached";

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

describe("listFoldersCached", () => {
  it("filters by org AND workspace (tenant boundary on the service client) and maps rows", async () => {
    const { client, calls } = makeClient({
      folders: {
        rows: [
          {
            id: "f1",
            name: "Q4",
            workspace_id: "w1",
            org_id: "o1",
            position: 0,
          },
        ],
      },
      folder_boards: {
        rows: [
          {
            board_id: "b1",
            folder_id: "f1",
            position: 0,
            folders: { workspace_id: "w1" },
          },
        ],
      },
    });
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );
    const result = await listFoldersCached("o1", "w1");
    expect(result).toEqual({
      folders: [
        { id: "f1", name: "Q4", workspaceId: "w1", orgId: "o1", position: 0 },
      ],
      placements: [{ boardId: "b1", folderId: "f1", position: 0 }],
    });
    expect(calls).toContainEqual(["folders", "eq:org_id", "o1"]);
    expect(calls).toContainEqual(["folders", "eq:workspace_id", "w1"]);
    expect(calls).toContainEqual([
      "folder_boards",
      "eq:folders.workspace_id",
      "w1",
    ]);
  });

  it("reports a read error as null, not an empty list", async () => {
    const { client } = makeClient({
      folders: { rows: null, error: { message: "boom" } },
      folder_boards: { rows: [] },
    });
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );
    await expect(listFoldersCached("o1", "w1")).resolves.toBeNull();
  });
});
```

`src/lib/folders/queries-cached.ts`:

```ts
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { foldersTag } from "@/lib/cache/tags";
import type { FolderNavData } from "./types";

const FOLDERS_LIMIT = 200;
const PLACEMENTS_LIMIT = 2000;

/**
 * Cached folders + placements for one workspace. `orgId`/`workspaceId` are read
 * OUTSIDE this scope (the shell loader) and passed in — they are the cache key
 * and, on the service client, the tenant boundary. `null` = the read failed
 * (callers must not confuse that with "no folders").
 */
export async function listFoldersCached(
  orgId: string,
  workspaceId: string,
): Promise<FolderNavData | null> {
  "use cache";
  cacheLife("nav");
  cacheTag(foldersTag(orgId));

  const supabase = createServiceClient();
  const [foldersRes, placementsRes] = await Promise.all([
    supabase
      .from("folders")
      .select("id, name, workspace_id, org_id, position")
      .eq("org_id", orgId)
      .eq("workspace_id", workspaceId)
      .limit(FOLDERS_LIMIT)
      .order("position", { ascending: true }),
    supabase
      .from("folder_boards")
      .select("board_id, folder_id, position, folders!inner(workspace_id)")
      .eq("folders.workspace_id", workspaceId)
      .limit(PLACEMENTS_LIMIT)
      .order("position", { ascending: true }),
  ]);
  if (foldersRes.error || placementsRes.error) return null;
  return {
    folders: (foldersRes.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      workspaceId: f.workspace_id,
      orgId: f.org_id,
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

Run: `pnpm vitest run src/lib/folders/queries-cached.test.ts` → Expected: 2 passed.

- [ ] **Step 8: Write the failing actions test**

`src/lib/folders/actions.test.ts` — reuse the chainable stub from `src/lib/boards/folders/actions.test.ts:109-224` verbatim (the `state` / `calls` / `vi.mock("@/lib/supabase/server")` block), with two additions to the stub: `qb.rpc` is not needed here, but `qb.maybeSingle` must also return `{ data: state.affectedRows > 0 ? { id: "matched-row", workspace_id: "w1" } : null, error: state.insertError }`, and `qb.single` returns `{ data: { id: "f-new", name: "Acme", position: 0, workspace_id: "w1", org_id: "org-1" }, error: state.insertError }`. Add these mocks:

```ts
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: vi.fn(async () => ({
    id: "org-1",
    name: "Org",
    timezone: "UTC",
  })),
}));
vi.mock("./resolve", () => ({
  resolveFolderWorkload: vi.fn(async () => ({ ok: true, rows: [] })),
}));
import {
  attachDashboardToFolder,
  createFolder,
  deleteFolder,
  getFolderWorkload,
  moveBoardToFolder,
  renameFolder,
} from "./actions";
```

and these cases (plus the rename/delete/unfile cases copied from the private-folder suite with the tag renamed to `"folders:org:org-1"`):

```ts
it("creates a folder in the workspace with the trimmed name and invalidates folders:org", async () => {
  const res = await createFolder({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    name: "  Acme  ",
  });
  expect(res.ok).toBe(true);
  expect(calls.inserts[0]).toMatchObject({
    name: "Acme",
    workspace_id: "11111111-1111-4111-8111-111111111111",
    org_id: "org-1",
    created_by: "user-1",
  });
  expect(updateTag).toHaveBeenCalledWith("folders:org:org-1");
});

it("maps a duplicate-name insert (23505) to a friendly message", async () => {
  state.insertError = { code: "23505", message: "duplicate key" };
  const res = await createFolder({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    name: "Acme",
  });
  expect(res).toEqual({
    ok: false,
    error: "A folder with that name already exists in this workspace.",
  });
});

it("files a board with an upsert on board_id", async () => {
  const res = await moveBoardToFolder({ boardId: BOARD, folderId: FOLDER });
  expect(res.ok).toBe(true);
  expect(calls.upserts[0]?.payload).toMatchObject({
    board_id: BOARD,
    folder_id: FOLDER,
  });
  expect(calls.upserts[0]?.options).toMatchObject({ onConflict: "board_id" });
});

it("attaches a dashboard only inside the folder's workspace and detaches with null", async () => {
  const res = await attachDashboardToFolder({
    dashboardId: BOARD,
    folderId: FOLDER,
  });
  expect(res.ok).toBe(true);
  expect(calls.updates[0]).toMatchObject({
    payload: { folder_id: FOLDER },
    eq: [
      ["id", BOARD],
      ["workspace_id", "w1"],
    ],
  });
  expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-1");
  const off = await attachDashboardToFolder({
    dashboardId: BOARD,
    folderId: null,
  });
  expect(off.ok).toBe(true);
  expect(calls.updates[1]).toMatchObject({
    payload: { folder_id: null },
    eq: [["id", BOARD]],
  });
});

it("getFolderWorkload validates the id and returns rows", async () => {
  expect((await getFolderWorkload({ folderId: "nope" })).ok).toBe(false);
  expect(await getFolderWorkload({ folderId: FOLDER })).toEqual({
    ok: true,
    data: [],
  });
});
```

- [ ] **Step 9: Run to verify it fails**

Run: `pnpm vitest run src/lib/folders/actions.test.ts` → Expected: FAIL — cannot resolve `./actions`.

- [ ] **Step 10: Write `actions.ts`**

```ts
"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { dashboardsTag, foldersTag } from "@/lib/cache/tags";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  attachDashboardSchema,
  createFolderSchema,
  deleteFolderSchema,
  folderIdSchema,
  moveBoardToFolderSchema,
  renameFolderSchema,
} from "@/lib/validations/folders";
import { resolveFolderWorkload } from "./resolve";
import {
  FOLDER_GONE_ERROR,
  type FolderSummary,
  type WorkloadRow,
} from "./types";

const DUPLICATE_NAME =
  "A folder with that name already exists in this workspace.";

/**
 * Shared folders are org-visible and workspace-scoped, so every action runs on
 * the request's RLS client and invalidates ONLY foldersTag(orgId) — no board
 * row changes, so boardsTag / sharedBoardsTag stay warm.
 */
export async function createFolder(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult<FolderSummary>> {
  const parsed = createFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const user = await getUser();
  if (!user) return fail("You must be signed in.");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("folders")
    .select("position")
    .eq("workspace_id", parsed.data.workspaceId)
    .order("position", { ascending: false })
    .limit(1);
  const position = (last?.[0]?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("folders")
    .insert({
      org_id: org.id,
      workspace_id: parsed.data.workspaceId,
      name: parsed.data.name,
      position,
      created_by: user.id,
    })
    .select("id, name, position, workspace_id, org_id")
    .single();
  if (error?.code === "23505") return fail(DUPLICATE_NAME);
  if (error || !data) return fail(error?.message ?? "Couldn't create folder.");

  updateTag(foldersTag(org.id));
  return {
    ok: true,
    data: {
      id: data.id,
      name: data.name,
      workspaceId: data.workspace_id,
      orgId: data.org_id,
      position: data.position,
    },
  };
}

export async function renameFolder(input: {
  folderId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("folders")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.folderId)
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return fail(DUPLICATE_NAME);
  if (error) return fail(error.message);
  if (!data) return fail(FOLDER_GONE_ERROR);
  updateTag(foldersTag(org.id));
  return { ok: true, data: undefined };
}

/** Deleting a folder cascades its placements and nulls dashboards.folder_id; boards are untouched. */
export async function deleteFolder(input: {
  folderId: string;
}): Promise<ActionResult> {
  const parsed = deleteFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("folders")
    .delete()
    .eq("id", parsed.data.folderId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail(FOLDER_GONE_ERROR);
  updateTag(foldersTag(org.id));
  updateTag(dashboardsTag(org.id));
  return { ok: true, data: undefined };
}

/** File a board (upsert on the board_id PK — "one folder per board" is the key) or unfile with null. */
export async function moveBoardToFolder(input: {
  boardId: string;
  folderId: string | null;
}): Promise<ActionResult> {
  const parsed = moveBoardToFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  const supabase = await createClient();
  if (parsed.data.folderId === null) {
    // Unfiling a board with no placement is a legitimate no-op (double click, stale menu).
    const { error } = await supabase
      .from("folder_boards")
      .delete()
      .eq("board_id", parsed.data.boardId);
    if (error) return fail(error.message);
  } else {
    const { data: last } = await supabase
      .from("folder_boards")
      .select("position")
      .eq("folder_id", parsed.data.folderId)
      .order("position", { ascending: false })
      .limit(1);
    const position = (last?.[0]?.position ?? -1) + 1;
    const { error } = await supabase.from("folder_boards").upsert(
      {
        board_id: parsed.data.boardId,
        folder_id: parsed.data.folderId,
        position,
      },
      { onConflict: "board_id" },
    );
    // A board outside the folder's workspace, or one you cannot read, is refused by RLS (folder_accepts_board).
    if (error) return fail(error.message);
  }
  updateTag(foldersTag(org.id));
  return { ok: true, data: undefined };
}

/** Attach a dashboard to a folder in the SAME workspace, or detach with null (spec §3.3). */
export async function attachDashboardToFolder(input: {
  dashboardId: string;
  folderId: string | null;
}): Promise<ActionResult> {
  const parsed = attachDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  const supabase = await createClient();

  if (parsed.data.folderId === null) {
    const { data, error } = await supabase
      .from("dashboards")
      .update({ folder_id: null })
      .eq("id", parsed.data.dashboardId)
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("That dashboard no longer exists.");
  } else {
    const { data: folder, error: folderErr } = await supabase
      .from("folders")
      .select("workspace_id")
      .eq("id", parsed.data.folderId)
      .maybeSingle();
    if (folderErr) return fail(folderErr.message);
    if (!folder) return fail(FOLDER_GONE_ERROR);
    const { data, error } = await supabase
      .from("dashboards")
      .update({ folder_id: parsed.data.folderId })
      .eq("id", parsed.data.dashboardId)
      .eq("workspace_id", folder.workspace_id)
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("That dashboard is not in this folder's workspace.");
  }
  updateTag(dashboardsTag(org.id));
  updateTag(foldersTag(org.id));
  return { ok: true, data: undefined };
}

/** People tab data — fetched once on first open into TanStack Query (spec §6). */
export async function getFolderWorkload(input: {
  folderId: string;
}): Promise<ActionResult<WorkloadRow[]>> {
  const parsed = folderIdSchema.safeParse(input.folderId);
  if (!parsed.success) return fail("Invalid folder.");
  const supabase = await createClient();
  const res = await resolveFolderWorkload(supabase, parsed.data);
  if (!res.ok) return fail(res.error);
  return { ok: true, data: res.rows };
}
```

- [ ] **Step 11: Run all lib tests + typecheck**

Run: `pnpm vitest run src/lib/folders/ && pnpm typecheck` → Expected: all folder suites pass; typecheck clean. Also run `pnpm vitest run src/test/use-server-exports.test.ts` → passes (only async functions exported from `actions.ts`).

- [ ] **Step 12: Commit**

```bash
git add src/lib/cache/tags.ts src/lib/validations/folders.ts src/lib/folders/resolve.ts src/lib/folders/queries.ts src/lib/folders/queries-cached.ts src/lib/folders/actions.ts src/lib/folders/types.ts src/lib/folders/resolve.test.ts src/lib/folders/actions.test.ts src/lib/folders/queries-cached.test.ts
git commit -m "feat(folders): typed rpc resolvers, folder queries and server actions"
```

---

### Task 6: `KpiCard`, `StackedStatusBar`, `StageMatrix` (pure, no recharts)

**Files:**

- Create: `src/components/folders/charts/KpiCard.tsx`
- Create: `src/components/folders/charts/StackedStatusBar.tsx`
- Create: `src/components/folders/charts/StageMatrix.tsx`
- Test: `src/components/folders/charts/KpiCard.test.tsx`, `StackedStatusBar.test.tsx`, `StageMatrix.test.tsx`

**Interfaces:**

- Consumes: `Kicker` (`src/components/ui/kicker.tsx`), `StatusPill`, `STATUS_BG`, `StatusColor` (`src/components/ui/status-pill.tsx:20-52`), `MatrixBand` (Task 4 `rollup.ts`), `cn`. Load `pulse-ui` + `frontend-design` first.
- Produces:

```tsx
export function KpiCard(props: {
  label: string;
  value: string;
  badge?: { text: string; color: StatusColor };
  subFact?: string;
  progress?: number | null /* 0..100 */;
  barColor?: StatusColor;
  className?: string;
}): JSX.Element;
export type StatusMix = {
  done: number;
  inProgress: number;
  overdue: number;
  notStarted: number;
};
export function StackedStatusBar(props: {
  mix: StatusMix;
  label?: string;
  showCount?: boolean;
  className?: string;
}): JSX.Element;
export function StageMatrix(props: {
  boards: { id: string; name: string }[];
  stages: { key: string; name: string }[];
  cells: Map<string, Map<string, number | null>>;
  onSelectStage?: (key: string) => void;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

`KpiCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiCard } from "./KpiCard";

describe("KpiCard", () => {
  it("renders label, value, badge, sub-fact and a bar scaled to progress", () => {
    render(
      <KpiCard
        label="Complete"
        value="62%"
        badge={{ text: "31 done", color: "green" }}
        subFact="38 planned by today"
        progress={62}
        barColor="green"
      />,
    );
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("31 done")).toBeInTheDocument();
    expect(screen.getByText("38 planned by today")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "62");
    expect(bar.firstElementChild).toHaveStyle({ width: "62%" });
  });

  it("renders an em dash and no bar when progress is null", () => {
    render(<KpiCard label="Gap to plan" value="—" progress={null} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
```

`StackedStatusBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StackedStatusBar } from "./StackedStatusBar";

describe("StackedStatusBar", () => {
  it("sizes four segments by share and exposes an accessible summary", () => {
    render(
      <StackedStatusBar
        mix={{ done: 2, inProgress: 1, overdue: 1, notStarted: 0 }}
        label="Backend"
        showCount
      />,
    );
    const seg = screen.getAllByTestId("status-segment");
    expect(seg).toHaveLength(4);
    expect(seg[0]).toHaveStyle({ width: "50%" });
    expect(seg[3]).toHaveStyle({ width: "0%" });
    expect(
      screen.getByLabelText(
        "Backend: 2 done, 1 in progress, 1 overdue, 0 not started",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("renders an empty track for zero items", () => {
    render(
      <StackedStatusBar
        mix={{ done: 0, inProgress: 0, overdue: 0, notStarted: 0 }}
      />,
    );
    expect(
      screen
        .getAllByTestId("status-segment")
        .every((s) => s.style.width === "0%"),
    ).toBe(true);
  });
});
```

`StageMatrix.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StageMatrix } from "./StageMatrix";

describe("StageMatrix", () => {
  const cells = new Map([
    [
      "b1",
      new Map<string, number | null>([
        ["build", 95],
        ["qa", null],
      ]),
    ],
    [
      "b2",
      new Map<string, number | null>([
        ["build", 40],
        ["qa", 10],
      ]),
    ],
  ]);
  it("renders a % badge per (board, stage) coloured by band and an em dash for missing", () => {
    render(
      <StageMatrix
        boards={[
          { id: "b1", name: "Backend" },
          { id: "b2", name: "Mobile" },
        ]}
        stages={[
          { key: "build", name: "Build" },
          { key: "qa", name: "QA" },
        ]}
        cells={cells}
      />,
    );
    expect(screen.getByText("95%")).toHaveAttribute("data-band", "green");
    expect(screen.getByText("40%")).toHaveAttribute("data-band", "yellow");
    expect(screen.getByText("10%")).toHaveAttribute("data-band", "gray");
    expect(screen.getByText("—")).toBeInTheDocument();
  });
  it("clicking a stage header selects it", () => {
    const onSelect = vi.fn();
    render(
      <StageMatrix
        boards={[]}
        stages={[{ key: "build", name: "Build" }]}
        cells={new Map()}
        onSelectStage={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(onSelect).toHaveBeenCalledWith("build");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/folders/charts/` → Expected: 3 files FAIL (module not found).

- [ ] **Step 3: Implement the three components**

`KpiCard.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import {
  STATUS_BG,
  StatusPill,
  type StatusColor,
} from "@/components/ui/status-pill";

/** One dense KPI card (spec §5.2.1): value, badge, one sub-fact, thin bar. Colour only on badge + bar. */
export function KpiCard({
  label,
  value,
  badge,
  subFact,
  progress = null,
  barColor = "blue",
  className,
}: {
  label: string;
  value: string;
  badge?: { text: string; color: StatusColor };
  subFact?: string;
  progress?: number | null;
  barColor?: StatusColor;
  className?: string;
}) {
  const pct = progress === null ? null : Math.max(0, Math.min(100, progress));
  return (
    <div
      className={cn(
        "bg-surface hover:border-border-hover flex flex-col gap-2 rounded-lg border p-4",
        className,
      )}
    >
      <Kicker>{label}</Kicker>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-heading text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {badge ? (
          <StatusPill color={badge.color} variant="soft">
            {badge.text}
          </StatusPill>
        ) : null}
      </div>
      {subFact ? (
        <p className="text-muted-foreground text-xs">{subFact}</p>
      ) : null}
      {pct === null ? null : (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={label}
          className="bg-surface-muted h-1 w-full overflow-hidden rounded-sm"
        >
          <div
            className={cn("h-full rounded-sm", STATUS_BG[barColor])}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
```

`StackedStatusBar.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { STATUS_BG } from "@/components/ui/status-pill";

export type StatusMix = {
  done: number;
  inProgress: number;
  overdue: number;
  notStarted: number;
};

const SEGMENTS: { key: keyof StatusMix; label: string; bg: string }[] = [
  { key: "done", label: "done", bg: STATUS_BG.green },
  { key: "inProgress", label: "in progress", bg: STATUS_BG.blue },
  { key: "overdue", label: "overdue", bg: STATUS_BG.red },
  { key: "notStarted", label: "not started", bg: STATUS_BG.gray },
];

/** done / in progress / overdue / not started as one 6px track (spec §5.2.3). */
export function StackedStatusBar({
  mix,
  label,
  showCount = false,
  className,
}: {
  mix: StatusMix;
  label?: string;
  showCount?: boolean;
  className?: string;
}) {
  const total = mix.done + mix.inProgress + mix.overdue + mix.notStarted;
  const summary = `${label ? `${label}: ` : ""}${mix.done} done, ${mix.inProgress} in progress, ${mix.overdue} overdue, ${mix.notStarted} not started`;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="img"
        aria-label={summary}
        className="bg-surface-muted flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-sm"
      >
        {SEGMENTS.map((s) => (
          <div
            key={s.key}
            data-testid="status-segment"
            className={cn("h-full", s.bg)}
            style={{
              width: total === 0 ? "0%" : `${(mix[s.key] / total) * 100}%`,
            }}
          />
        ))}
      </div>
      {showCount ? (
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {total}
        </span>
      ) : null}
    </div>
  );
}
```

`StageMatrix.tsx`:

```tsx
import { band } from "@/lib/folders/rollup";
import { StatusPill, type StatusColor } from "@/components/ui/status-pill";

const BAND_COLOR: Record<ReturnType<typeof band>, StatusColor> = {
  green: "green",
  blue: "blue",
  yellow: "yellow",
  gray: "gray",
};

/** % done per (board, stage) as soft badges (spec §5.3.3). Wide → scrolls in its own container. */
export function StageMatrix({
  boards,
  stages,
  cells,
  onSelectStage,
}: {
  boards: { id: string; name: string }[];
  stages: { key: string; name: string }[];
  cells: Map<string, Map<string, number | null>>;
  onSelectStage?: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="text-muted-foreground py-2 pr-3 text-left font-medium">
              Board
            </th>
            {stages.map((s) => (
              <th key={s.key} className="py-2 pr-3 text-left">
                {onSelectStage ? (
                  <button
                    type="button"
                    onClick={() => onSelectStage(s.key)}
                    className="focus-visible:ring-ring hover:text-foreground text-muted-foreground rounded-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {s.name}
                  </button>
                ) : (
                  <span className="text-muted-foreground font-medium">
                    {s.name}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {boards.map((b) => (
            <tr key={b.id} className="border-b last:border-b-0">
              <td className="py-2 pr-3 font-medium">{b.name}</td>
              {stages.map((s) => {
                const v = cells.get(b.id)?.get(s.key) ?? null;
                return (
                  <td key={s.key} className="py-2 pr-3">
                    {v === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <StatusPill
                        color={BAND_COLOR[band(v)]}
                        variant="soft"
                        data-band={band(v)}
                      >
                        {v}%
                      </StatusPill>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

(`StatusPill` spreads its remaining native span props — `src/components/ui/status-pill.tsx:114-135` — so `data-band` lands on the pill.)

- [ ] **Step 4: Run tests + lint**

Run: `pnpm vitest run src/components/folders/charts/ && pnpm lint` → Expected: 6 passed; lint clean (no raw colours — `scripts/check-hover-tokens.mjs` runs in lint).

- [ ] **Step 5: Commit**

```bash
git add src/components/folders/charts/KpiCard.tsx src/components/folders/charts/StackedStatusBar.tsx src/components/folders/charts/StageMatrix.tsx src/components/folders/charts/KpiCard.test.tsx src/components/folders/charts/StackedStatusBar.test.tsx src/components/folders/charts/StageMatrix.test.tsx
git commit -m "feat(folders): kpi card, stacked status bar and stage matrix primitives"
```

---

### Task 7: `BurnChart` (recharts, lazy) + `WorkloadBars` + first-paint bundle guard

**Files:**

- Create: `src/components/folders/charts/BurnChartInner.tsx` (recharts)
- Create: `src/components/folders/charts/BurnChart.tsx` (dynamic wrapper, mirrors `src/components/dashboards/widgets/LazyChartWidget.tsx`)
- Create: `src/components/folders/charts/WorkloadBars.tsx`
- Test: `src/components/folders/charts/BurnChartInner.test.tsx`, `WorkloadBars.test.tsx`, `src/components/folders/no-recharts-in-first-paint.test.ts`

**Interfaces:**

- Consumes: `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartConfig` (`src/components/ui/chart.tsx`), `BurnPoint` (Task 4), `Avatar`/`AvatarImage`/`AvatarFallback`, `STATUS_BG`, `reachable` (`src/test/static-imports.ts:43`).
- Produces:

```tsx
export type BurnMode = "cumulative" | "weekly";
export function BurnChartInner(props: {
  points: BurnPoint[];
  mode: BurnMode;
  className?: string;
}): JSX.Element;
export const BurnChart: ComponentType<{
  points: BurnPoint[];
  mode: BurnMode;
  className?: string;
}>; // dynamic(ssr:false)
export type WorkloadPerson = {
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  open: number;
  overdue: number;
};
export const OVERLOAD_THRESHOLD = 15;
export function WorkloadBars(props: {
  people: WorkloadPerson[];
  threshold?: number;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

`BurnChartInner.test.tsx` (recharts renders `<svg>` in jsdom given an explicit size, as `src/components/ui/chart.test.tsx` does):

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BurnChartInner } from "./BurnChartInner";
import type { BurnPoint } from "@/lib/folders/rollup";

const points: BurnPoint[] = [
  {
    weekStart: "2026-09-07",
    planned: 2,
    completed: 1,
    plannedCum: 2,
    completedCum: 1,
    isPast: true,
  },
  {
    weekStart: "2026-09-14",
    planned: 3,
    completed: 1,
    plannedCum: 5,
    completedCum: 2,
    isPast: true,
  },
  {
    weekStart: "2026-09-21",
    planned: 1,
    completed: 0,
    plannedCum: 6,
    completedCum: 2,
    isPast: false,
  },
];

describe("BurnChartInner", () => {
  it("renders planned (dashed), completed (area) and a Today reference line in cumulative mode", () => {
    const { container } = render(
      <BurnChartInner points={points} mode="cumulative" />,
    );
    expect(container.querySelector("[data-slot='chart']")).not.toBeNull();
    expect(container.querySelector(".recharts-reference-line")).not.toBeNull();
    expect(container.querySelector(".recharts-area")).not.toBeNull();
    expect(container.querySelector(".recharts-line")).not.toBeNull();
  });
  it("switches to bars in weekly mode", () => {
    const { container } = render(
      <BurnChartInner points={points} mode="weekly" />,
    );
    expect(container.querySelector(".recharts-bar")).not.toBeNull();
    expect(container.querySelector(".recharts-area")).toBeNull();
  });
});
```

`WorkloadBars.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkloadBars } from "./WorkloadBars";

describe("WorkloadBars", () => {
  it("scales bars to the max, flags people over the threshold in red and shows late counts", () => {
    render(
      <WorkloadBars
        people={[
          { userId: "u1", name: "Ada", avatarUrl: null, open: 20, overdue: 3 },
          {
            userId: "u2",
            name: "Grace",
            avatarUrl: null,
            open: 10,
            overdue: 0,
          },
        ]}
      />,
    );
    const bars = screen.getAllByTestId("workload-bar");
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "50%" });
    expect(bars[0]).toHaveAttribute("data-overloaded", "true");
    expect(bars[1]).toHaveAttribute("data-overloaded", "false");
    expect(screen.getByText("3 late")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });
  it("renders the empty state without people", () => {
    render(<WorkloadBars people={[]} />);
    expect(
      screen.getByText("No open items are assigned in this stage."),
    ).toBeInTheDocument();
  });
});
```

`src/components/folders/no-recharts-in-first-paint.test.ts` (mirror of `src/components/dashboards/no-recharts-in-first-paint.test.ts`):

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reachable } from "@/test/static-imports";

const SRC = join(process.cwd(), "src");
const ENTRY = join(SRC, "components/folders/CommandCenter.tsx");
const INNER = join(SRC, "components/folders/charts/BurnChartInner.tsx");

describe("command center first-paint bundle boundary", () => {
  const { files, bare } = reachable(ENTRY);
  it("does not statically reach BurnChartInner from CommandCenter", () => {
    expect(files.has(INNER)).toBe(false);
  });
  it("does not statically reach recharts from CommandCenter", () => {
    expect(bare.has("recharts")).toBe(false);
  });
});
```

(This third test goes red until Task 8 creates `CommandCenter.tsx`; commit it here and note it in the handoff — it is the guard Task 8 must keep green.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/folders/` → Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`BurnChartInner.tsx`:

```tsx
"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { BurnPoint } from "@/lib/folders/rollup";
import { cn } from "@/lib/utils";

export type BurnMode = "cumulative" | "weekly";

const CONFIG = {
  planned: { label: "Planned", color: "var(--muted-foreground)" },
  completed: { label: "Completed", color: "var(--primary)" },
  gap: { label: "Behind plan", color: "var(--status-red)" },
} satisfies ChartConfig;

function weekLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Planned vs completed (spec §5.2.2). Cumulative: dashed planned line, accent
 * completed area, red wedge for plannedCum − completedCum on past weeks, and a
 * dashed red "Today" marker on the last past week. Weekly: paired bars.
 * Pure — the parent owns the mode toggle (client state, 0 round-trips).
 */
export function BurnChartInner({
  points,
  mode,
  className,
}: {
  points: BurnPoint[];
  mode: BurnMode;
  className?: string;
}) {
  const todayWeek = [...points].reverse().find((p) => p.isPast)?.weekStart;
  const data = points.map((p) => ({
    week: p.weekStart,
    planned: mode === "cumulative" ? p.plannedCum : p.planned,
    completed: mode === "cumulative" ? p.completedCum : p.completed,
    gap:
      mode === "cumulative" && p.isPast
        ? Math.max(0, p.plannedCum - p.completedCum)
        : 0,
    gapBase: mode === "cumulative" && p.isPast ? p.completedCum : 0,
  }));
  return (
    <ChartContainer
      config={CONFIG}
      className={cn("h-64 w-full", className)}
      initialDimension={{ width: 640, height: 256 }}
    >
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="week"
          tickFormatter={weekLabel}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          width={28}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent labelFormatter={(v) => weekLabel(String(v))} />
          }
        />
        {mode === "cumulative" ? (
          <>
            <Area
              type="monotone"
              dataKey="gapBase"
              stackId="gap"
              stroke="none"
              fill="transparent"
              isAnimationActive={false}
              legendType="none"
              tooltipType="none"
            />
            <Area
              type="monotone"
              dataKey="gap"
              stackId="gap"
              stroke="none"
              fill="var(--color-gap)"
              fillOpacity={0.25}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="completed"
              stroke="var(--color-completed)"
              fill="var(--color-completed)"
              fillOpacity={0.15}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="planned"
              stroke="var(--color-planned)"
              strokeDasharray="4 4"
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </>
        ) : (
          <>
            <Bar
              dataKey="planned"
              fill="var(--color-planned)"
              radius={2}
              isAnimationActive={false}
            />
            <Bar
              dataKey="completed"
              fill="var(--color-completed)"
              radius={2}
              isAnimationActive={false}
            />
          </>
        )}
        {todayWeek ? (
          <ReferenceLine
            x={todayWeek}
            stroke="var(--status-red)"
            strokeDasharray="4 4"
            label={{
              value: "Today",
              position: "top",
              fill: "var(--status-red)",
              fontSize: 10,
            }}
          />
        ) : null}
      </ComposedChart>
    </ChartContainer>
  );
}
```

`BurnChart.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";

// The single deferred entry to the recharts-backed burn chart. Importing THIS
// module is recharts-free (the reference lives inside dynamic(() => import())),
// so CommandCenter never pulls recharts into first paint — same pattern as
// src/components/dashboards/widgets/LazyChartWidget.tsx. ssr:false is fine:
// the chart measures its container; the Overview prints whatever is mounted.
export const BurnChart = dynamic(
  () =>
    import("@/components/folders/charts/BurnChartInner").then(
      (m) => m.BurnChartInner,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted/40 h-64 w-full animate-pulse rounded-md" />
    ),
  },
);
```

`WorkloadBars.tsx`:

```tsx
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { STATUS_BG } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

export type WorkloadPerson = {
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  open: number;
  overdue: number;
};
/** Spec §5.5.1: constant in v1, configurable later. */
export const OVERLOAD_THRESHOLD = 15;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function WorkloadBars({
  people,
  threshold = OVERLOAD_THRESHOLD,
}: {
  people: WorkloadPerson[];
  threshold?: number;
}) {
  if (people.length === 0)
    return (
      <EmptyState variant="inline">
        No open items are assigned in this stage.
      </EmptyState>
    );
  const max = Math.max(threshold, ...people.map((p) => p.open));
  return (
    <ul className="flex flex-col gap-2">
      {people.map((p) => {
        const overloaded = p.open > threshold;
        return (
          <li
            key={p.userId ?? "__unassigned"}
            className="flex items-center gap-3 text-xs"
          >
            <Avatar className="size-6">
              {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-2xs">
                {initials(p.name)}
              </AvatarFallback>
            </Avatar>
            <span className="w-32 truncate font-medium">{p.name}</span>
            <div className="bg-surface-muted relative h-2 min-w-0 flex-1 overflow-hidden rounded-sm">
              <div
                data-testid="workload-bar"
                data-overloaded={overloaded ? "true" : "false"}
                className={cn(
                  "h-full rounded-sm",
                  overloaded ? STATUS_BG.red : STATUS_BG.blue,
                )}
                style={{ width: `${(p.open / max) * 100}%` }}
              />
              <div
                aria-hidden
                className="bg-border-bright absolute inset-y-0 w-px"
                style={{ left: `${(threshold / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right font-mono tabular-nums">
              {p.open}
            </span>
            {p.overdue > 0 ? (
              <span className="text-status-red text-2xs font-mono">
                {p.overdue} late
              </span>
            ) : (
              <span className="w-10" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

(`text-status-red` is a real utility: `--color-status-red` is declared in the Tailwind theme block of `src/app/globals.css:66-73`.)

- [ ] **Step 4: Run tests + lint**

Run: `pnpm vitest run src/components/folders/charts/ && pnpm lint` → Expected: chart tests 4 passed; the bundle-boundary file fails only on `ENTRY` not existing (expected until Task 8); lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/folders/charts/BurnChartInner.tsx src/components/folders/charts/BurnChart.tsx src/components/folders/charts/WorkloadBars.tsx src/components/folders/charts/BurnChartInner.test.tsx src/components/folders/charts/WorkloadBars.test.tsx src/components/folders/no-recharts-in-first-paint.test.ts
git commit -m "feat(folders): lazy burn chart, workload bars and first-paint bundle guard"
```

---

### Task 8: `CommandCenter` shell — URL state hook, tab strip, filter bar, Overview tab

**Files:**

- Create: `src/components/folders/command-center-state.ts`
- Create: `src/components/folders/TabStrip.tsx`
- Create: `src/components/folders/FilterBar.tsx`
- Create: `src/components/folders/CommandCenter.tsx`
- Create: `src/components/folders/tabs/Overview.tsx`
- Test: `src/components/folders/command-center-state.test.tsx`, `src/components/folders/CommandCenter.test.tsx`, `src/components/folders/tabs/Overview.test.tsx`

**Interfaces:**

- Consumes: Task 4 (`FolderPayload`, `buildStages`, `computeKpis`, `filterRows`, `boardSummaries`, `nextMilestones`, `burnSeries`, `daysBetween`, `folderFixture`), Task 6/7 charts, `commandTabSchema` (Task 5), `Kicker`, `MetaChip`, `StatusPill`, `EmptyState`, `Button`, `DropdownMenu*`, `useSearchParams` (`next/navigation`).
- Produces:

```tsx
// command-center-state.ts
export type CommandTab = "overview" | "stages" | "boards" | "people";
export function parseTab(v: string | null): CommandTab; // default "overview"
export function useCommandCenterState(): {
  tab: CommandTab;
  stage: string | null;
  board: string | null;
  setTab(t: CommandTab): void;
  setStage(k: string | null): void;
  setBoard(id: string | null): void;
};
// TabStrip.tsx
export function TabStrip(props: {
  tab: CommandTab;
  counts: {
    stages: number;
    boards: number;
    people: number | null;
    overloaded: number;
  };
  disabled?: boolean;
  onChange(t: CommandTab): void;
}): JSX.Element;
// FilterBar.tsx
export function FilterBar(props: {
  stages: StageSummary[];
  boards: FolderBoardRef[];
  stage: string | null;
  board: string | null;
  itemCount: number;
  onStage(k: string | null): void;
  onBoard(id: string | null): void;
}): JSX.Element;
// CommandCenter.tsx  ("use client")
export type CommandCenterProps = {
  payload: FolderPayload;
  widgets?: ReactNode;
  headerActions?: ReactNode;
};
export function CommandCenter(props: CommandCenterProps): JSX.Element;
// tabs/Overview.tsx
export function OverviewTab(props: {
  payload: FolderPayload;
  rows: RollupRow[];
  stages: StageSummary[];
  stage: string | null;
  widgets?: ReactNode;
  onRetry(): void;
}): JSX.Element;
```

Task 9 adds `StagesTab`, `BoardsTab`, `PeopleTab` and wires them into the `switch` in `CommandCenter` (the switch's `stages` / `boards` / `people` arms render `<EmptyState variant="inline">Coming in this build.</EmptyState>` until Task 9 replaces them — that is the ONE placeholder this plan allows, because Task 9 is its owner and lands in the same wave).

- [ ] **Step 1: Write the failing state-hook test**

`command-center-state.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const params = { current: new URLSearchParams("tab=stages&stage=build") };
vi.mock("next/navigation", () => ({ useSearchParams: () => params.current }));

import { parseTab, useCommandCenterState } from "./command-center-state";

describe("parseTab", () => {
  it("accepts the four tabs and defaults to overview", () => {
    expect(parseTab("people")).toBe("people");
    expect(parseTab("nope")).toBe("overview");
    expect(parseTab(null)).toBe("overview");
  });
});

describe("useCommandCenterState", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/folders/f1?tab=stages&stage=build");
    params.current = new URLSearchParams("tab=stages&stage=build");
  });

  it("reads tab / stage / board from the URL", () => {
    const { result } = renderHook(() => useCommandCenterState());
    expect(result.current.tab).toBe("stages");
    expect(result.current.stage).toBe("build");
    expect(result.current.board).toBeNull();
  });

  it("writes with history.replaceState and never navigates", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useCommandCenterState());
    act(() => result.current.setStage("qa"));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(String(replace.mock.calls[0][2])).toContain("stage=qa");
    act(() => result.current.setStage(null));
    expect(String(replace.mock.calls[1][2])).not.toContain("stage=");
    act(() => result.current.setTab("overview"));
    expect(String(replace.mock.calls[2][2])).not.toContain("tab="); // default tab is omitted
    expect(push).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/folders/command-center-state.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Write `command-center-state.ts`**

```ts
"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { commandTabSchema } from "@/lib/validations/folders";

export type CommandTab = "overview" | "stages" | "boards" | "people";

export function parseTab(v: string | null): CommandTab {
  const parsed = commandTabSchema.safeParse(v);
  return parsed.success ? parsed.data : "overview";
}

/**
 * Tab / stage / board are CLIENT state mirrored into the URL with the History
 * API — Next.js syncs replaceState into useSearchParams() with no RSC re-run
 * (gotcha-09; precedent src/components/portfolios/PortfolioGrid.tsx:37-58).
 * Never <Link>/router.push here: that would re-run every query on the page.
 */
function write(mutate: (url: URL) => void) {
  const url = new URL(window.location.href);
  mutate(url);
  window.history.replaceState({}, "", url);
}

export function useCommandCenterState() {
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const stage = params.get("stage");
  const board = params.get("board");

  const setTab = useCallback((t: CommandTab) => {
    write((url) => {
      if (t === "overview") url.searchParams.delete("tab");
      else url.searchParams.set("tab", t);
    });
  }, []);
  const setStage = useCallback((k: string | null) => {
    write((url) => {
      if (k === null) url.searchParams.delete("stage");
      else url.searchParams.set("stage", k);
    });
  }, []);
  const setBoard = useCallback((id: string | null) => {
    write((url) => {
      if (id === null) url.searchParams.delete("board");
      else url.searchParams.set("board", id);
    });
  }, []);

  return {
    tab,
    stage: stage === "" ? null : stage,
    board: board === "" ? null : board,
    setTab,
    setStage,
    setBoard,
  };
}
```

- [ ] **Step 4: Run the hook test**

Run: `pnpm vitest run src/components/folders/command-center-state.test.tsx` → Expected: 3 passed.

- [ ] **Step 5: Write the failing CommandCenter + Overview tests**

`CommandCenter.test.tsx` — the 0-refetch guard (spec §10 "tab switch and stage switch trigger zero Server Action calls"):

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { folderFixture } from "@/lib/folders/fixture";

const params = { current: new URLSearchParams("") };
const routerPush = vi.fn();
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params.current,
  useRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
    replace: vi.fn(),
  }),
}));
vi.mock("@/lib/folders/actions", () => ({
  getFolderWorkload: vi.fn(async () => ({ ok: true, data: [] })),
}));
// The lazy burn chart never resolves in jsdom; the shell must not depend on it.
vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: () => <div data-testid="burn-chart" />,
}));

import { getFolderWorkload } from "@/lib/folders/actions";
import { CommandCenter } from "./CommandCenter";

describe("CommandCenter", () => {
  beforeEach(() => {
    params.current = new URLSearchParams("");
    window.history.replaceState({}, "", "/folders/f1");
    vi.mocked(getFolderWorkload).mockClear();
    routerPush.mockClear();
    routerRefresh.mockClear();
  });

  it("renders the header, snapshot chip, tab strip and filter bar from the payload", () => {
    render(<CommandCenter payload={folderFixture()} />);
    expect(
      screen.getByRole("heading", { name: "Q4 Launch" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Snapshot/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Stages 4/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Boards 3/ })).toBeInTheDocument();
    expect(screen.getByText("26 items · 3 boards")).toBeInTheDocument();
  });

  it("switching tab and stage costs zero server calls and only touches history.replaceState", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    render(<CommandCenter payload={folderFixture()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Stages/ }));
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    fireEvent.click(screen.getByRole("tab", { name: /Boards/ }));
    expect(replace).toHaveBeenCalledTimes(3);
    expect(getFolderWorkload).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("filtering to one stage recomputes the KPI values from the payload", () => {
    params.current = new URLSearchParams("stage=qa");
    render(<CommandCenter payload={folderFixture()} />);
    // QA: 2 done of 3 total across b1/b2 → 67%
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("3 items · 3 boards · QA")).toBeInTheDocument();
  });

  it("disables the tabs and shows the add-boards empty state for a folder with no boards", () => {
    const empty = {
      ...folderFixture(),
      boards: [],
      rollup: [],
      burn: [],
      attention: [],
    };
    render(<CommandCenter payload={empty} />);
    expect(screen.getByText("Add boards to this folder")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Stages/ })).toBeDisabled();
  });

  it("renders the widgets slot under #widgets", () => {
    render(
      <CommandCenter payload={folderFixture()} widgets={<div>WIDGETS</div>} />,
    );
    expect(document.getElementById("widgets")).toHaveTextContent("WIDGETS");
  });
});
```

`tabs/Overview.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildStages } from "@/lib/folders/stages";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";

vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: (p: { mode: string }) => (
    <div data-testid="burn-chart" data-mode={p.mode} />
  ),
}));
import { OverviewTab } from "./Overview";

function renderOverview(patch: Partial<ReturnType<typeof folderFixture>> = {}) {
  const payload = { ...folderFixture(), ...patch };
  const rows = payload.rollup ?? [];
  const stages = buildStages(rows, FIXTURE_TODAY);
  const onRetry = vi.fn();
  render(
    <OverviewTab
      payload={payload}
      rows={rows}
      stages={stages}
      stage={null}
      onRetry={onRetry}
    />,
  );
  return { onRetry };
}

describe("OverviewTab", () => {
  it("renders the six KPI cards", () => {
    renderOverview();
    for (const label of [
      "Complete",
      "Gap to plan",
      "Overdue",
      "Due this week",
      "Blocked",
      "Stale",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("toggles the burn chart between cumulative and weekly with no server call", () => {
    renderOverview();
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-mode",
      "cumulative",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-mode",
      "weekly",
    );
  });

  it("lists attention rows linking to the board with ?item=", () => {
    renderOverview();
    const link = screen.getByRole("link", { name: /Auth refactor/ });
    expect(link).toHaveAttribute("href", "/boards/b1?item=i1");
    expect(screen.getByText("overdue · 14d")).toBeInTheDocument();
  });

  it("shows Intelligence briefs only when there is at least one run", () => {
    renderOverview();
    expect(screen.getByText("Intelligence")).toBeInTheDocument();
    expect(screen.getByText(/one auth item slipped/)).toBeInTheDocument();
  });

  it("hides the Intelligence panel when no board has a run", () => {
    renderOverview({ briefs: [] });
    expect(screen.queryByText("Intelligence")).toBeNull();
  });

  it("replaces the burn chart when there are no due dates and shows an em dash for gap", () => {
    const rows = folderFixture().rollup!.map((r) => ({
      ...r,
      minDue: null,
      maxDue: null,
      plannedByToday: 0,
      oldestOverdue: null,
    }));
    renderOverview({ rollup: rows, burn: [] });
    expect(
      screen.getByText("Add due dates to see planned vs completed"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("burn-chart")).toBeNull();
  });

  it("shows an inline retry for a failed panel and keeps the rest", () => {
    const { onRetry } = renderOverview({ attention: null });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("renders the next three milestones", () => {
    renderOverview();
    expect(screen.getByText("Next milestones")).toBeInTheDocument();
    expect(screen.getAllByTestId("milestone").length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm vitest run src/components/folders/CommandCenter.test.tsx src/components/folders/tabs/Overview.test.tsx` → FAIL (modules not found).

- [ ] **Step 7: Write `TabStrip.tsx` and `FilterBar.tsx`**

`TabStrip.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { CommandTab } from "./command-center-state";

const TABS: { id: CommandTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "stages", label: "Stages" },
  { id: "boards", label: "Boards" },
  { id: "people", label: "People" },
];

/** Tabs under the folder header (spec §5.1). Roving tablist; counts are mono; overloaded count is red. */
export function TabStrip({
  tab,
  counts,
  disabled = false,
  onChange,
}: {
  tab: CommandTab;
  counts: {
    stages: number;
    boards: number;
    people: number | null;
    overloaded: number;
  };
  disabled?: boolean;
  onChange: (t: CommandTab) => void;
}) {
  const countFor = (id: CommandTab): { n: number | null; red: boolean } => {
    if (id === "stages") return { n: counts.stages, red: false };
    if (id === "boards") return { n: counts.boards, red: false };
    if (id === "people")
      return {
        n: counts.overloaded > 0 ? counts.overloaded : counts.people,
        red: counts.overloaded > 0,
      };
    return { n: null, red: false };
  };
  return (
    <div
      role="tablist"
      aria-label="Command center sections"
      data-print-hide
      className="flex gap-1 border-b"
    >
      {TABS.map((t) => {
        const c = countFor(t.id);
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled && t.id !== "overview"}
            onClick={() => onChange(t.id)}
            className={cn(
              "focus-visible:ring-ring -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.label}
            {c.n !== null ? (
              <span
                className={cn(
                  "font-mono text-xs tabular-nums",
                  c.red ? "text-status-red" : "text-muted-foreground",
                )}
              >
                {c.n}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
```

`FilterBar.tsx`:

```tsx
"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StageSummary } from "@/lib/folders/stages";
import type { FolderBoardRef } from "@/lib/folders/types";
import { cn } from "@/lib/utils";

/** Stage segmented control + board dropdown + mono hint (spec §5.1). Hidden stage control when ≤ 1 stage (spec §8). */
export function FilterBar({
  stages,
  boards,
  stage,
  board,
  itemCount,
  onStage,
  onBoard,
}: {
  stages: StageSummary[];
  boards: FolderBoardRef[];
  stage: string | null;
  board: string | null;
  itemCount: number;
  onStage: (k: string | null) => void;
  onBoard: (id: string | null) => void;
}) {
  const stageName = stages.find((s) => s.key === stage)?.name;
  const boardName = boards.find((b) => b.id === board)?.name ?? "All boards";
  const hint = [
    `${itemCount} items`,
    `${board ? 1 : boards.length} boards`,
    stageName,
  ]
    .filter(Boolean)
    .join(" · ");
  const chip = (active: boolean) =>
    cn(
      "focus-visible:ring-ring flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
      active
        ? "border-border-bright bg-surface-muted text-foreground"
        : "hover:border-border-hover text-muted-foreground",
    );
  return (
    <div data-print-hide className="flex flex-wrap items-center gap-2 py-3">
      {stages.length > 1 ? (
        <div role="group" aria-label="Stage" className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onStage(null)}
            className={chip(stage === null)}
            aria-pressed={stage === null}
          >
            All
          </button>
          {stages.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onStage(s.key)}
              className={chip(stage === s.key)}
              aria-pressed={stage === s.key}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
          >
            {boardName}
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={() => onBoard(null)}>
            All boards
          </DropdownMenuItem>
          {boards.map((b) => (
            <DropdownMenuItem key={b.id} onSelect={() => onBoard(b.id)}>
              {b.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-muted-foreground ml-auto font-mono text-xs">
        {hint}
      </span>
    </div>
  );
}
```

- [ ] **Step 8: Write `tabs/Overview.tsx`**

```tsx
"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Kicker } from "@/components/ui/kicker";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, type StatusColor } from "@/components/ui/status-pill";
import { KpiCard } from "@/components/folders/charts/KpiCard";
import { StackedStatusBar } from "@/components/folders/charts/StackedStatusBar";
import { BurnChart } from "@/components/folders/charts/BurnChart";
import type { BurnMode } from "@/components/folders/charts/BurnChartInner";
import {
  boardSummaries,
  burnSeries,
  computeKpis,
  nextMilestones,
} from "@/lib/folders/rollup";
import type { StageSummary } from "@/lib/folders/stages";
import type {
  AttentionReason,
  FolderPayload,
  RollupRow,
} from "@/lib/folders/types";
import { cn } from "@/lib/utils";

const REASON_COLOR: Record<AttentionReason, StatusColor> = {
  overdue: "red",
  blocked: "red",
  unassigned: "yellow",
  stale: "gray",
};

function Panel({
  kicker,
  title,
  children,
  className,
  id,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "bg-surface flex flex-col gap-3 rounded-lg border p-4",
        className,
      )}
    >
      <div>
        <Kicker>{kicker}</Kicker>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState variant="inline" className="flex flex-col items-center gap-2">
      This panel couldn&apos;t load.
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </EmptyState>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function OverviewTab({
  payload,
  rows,
  stages,
  stage,
  widgets,
  onRetry,
}: {
  payload: FolderPayload;
  rows: RollupRow[];
  stages: StageSummary[];
  stage: string | null;
  widgets?: ReactNode;
  onRetry: () => void;
}) {
  const [mode, setMode] = useState<BurnMode>("cumulative");
  const k = computeKpis(rows, payload.todayISO);
  const boards = boardSummaries(rows, payload.boards, stages);
  const burn =
    payload.burn === null
      ? null
      : burnSeries(payload.burn, stage, payload.todayISO);
  const anyDue = rows.some((r) => r.minDue !== null || r.maxDue !== null);
  const attention =
    payload.attention === null
      ? null
      : payload.attention.filter(
          (a) =>
            stage === null ||
            (a.groupName !== null &&
              a.groupName.trim().toLowerCase() === stage),
        );
  const milestones = nextMilestones(
    stages.filter((s) => stage === null || s.key === stage),
    payload.todayISO,
    3,
  );

  return (
    <div className="flex flex-col gap-4" data-print-root>
      {payload.rollup === null ? (
        <Failed onRetry={onRetry} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            label="Complete"
            value={k.donePct === null ? "—" : `${k.donePct}%`}
            badge={{ text: `${k.done} done`, color: "green" }}
            subFact={`${k.plannedByToday} planned by today`}
            progress={k.donePct}
            barColor="green"
          />
          <KpiCard
            label="Gap to plan"
            value={k.gap === null ? "—" : `${k.gap > 0 ? "+" : ""}${k.gap}`}
            badge={
              k.gap === null
                ? undefined
                : {
                    text: k.gap < 0 ? "behind" : "ahead",
                    color: k.gap < 0 ? "red" : "green",
                  }
            }
            subFact="done − planned"
            progress={
              k.gap === null || k.total === 0
                ? null
                : Math.min(100, (Math.abs(k.gap) / k.total) * 100)
            }
            barColor={k.gap !== null && k.gap < 0 ? "red" : "green"}
          />
          <KpiCard
            label="Overdue"
            value={String(k.overdue)}
            badge={
              k.oldestOverdueDays === null
                ? undefined
                : { text: `oldest ${k.oldestOverdueDays}d`, color: "red" }
            }
            subFact="open items past due"
            progress={k.total === 0 ? null : (k.overdue / k.total) * 100}
            barColor="red"
          />
          <KpiCard
            label="Due this week"
            value={String(k.dueThisWeek)}
            subFact={`${k.dueThisWeekNotStarted} not yet started`}
            progress={
              k.dueThisWeek === 0
                ? null
                : ((k.dueThisWeek - k.dueThisWeekNotStarted) / k.dueThisWeek) *
                  100
            }
            barColor="blue"
          />
          <KpiCard
            label="Blocked"
            value={String(k.blocked)}
            subFact="status blocked or stuck"
            progress={k.total === 0 ? null : (k.blocked / k.total) * 100}
            barColor="red"
          />
          <KpiCard
            label="Stale"
            value={String(k.stale)}
            subFact="untouched > 14 days"
            progress={k.total === 0 ? null : (k.stale / k.total) * 100}
            barColor="yellow"
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          kicker="02"
          title="Planned vs completed"
          className="lg:col-span-2"
        >
          <div
            role="radiogroup"
            aria-label="Chart mode"
            data-print-hide
            className="flex gap-1 self-end"
          >
            {(["cumulative", "weekly"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-sm border px-2 py-0.5 text-xs",
                  mode === m
                    ? "border-border-bright text-foreground"
                    : "text-muted-foreground hover:border-border-hover",
                )}
              >
                {m === "cumulative" ? "Cumulative" : "Weekly"}
              </button>
            ))}
          </div>
          {burn === null ? (
            <Failed onRetry={onRetry} />
          ) : !anyDue || burn.length === 0 ? (
            <EmptyState variant="inline">
              Add due dates to see planned vs completed
            </EmptyState>
          ) : (
            <BurnChart points={burn} mode={mode} />
          )}
        </Panel>

        <Panel kicker="03" title="Status by board">
          {payload.rollup === null ? (
            <Failed onRetry={onRetry} />
          ) : (
            boards.map((b) => (
              <div key={b.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <Link
                    href={`/boards/${b.id}`}
                    className="hover:text-foreground text-muted-foreground font-medium"
                  >
                    {b.name}
                  </Link>
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {b.total}
                  </span>
                </div>
                <StackedStatusBar
                  mix={{
                    done: b.done,
                    inProgress: b.inProgress,
                    overdue: b.overdue,
                    notStarted: b.notStarted,
                  }}
                  label={b.name}
                />
              </div>
            ))
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel kicker="04" title="Needs attention" className="lg:col-span-2">
          {attention === null ? (
            <Failed onRetry={onRetry} />
          ) : attention.length === 0 ? (
            <EmptyState variant="inline">Nothing needs attention.</EmptyState>
          ) : (
            <ul className="divide-y">
              {attention.map((a) => (
                <li
                  key={a.itemId}
                  className="flex items-center gap-3 py-2 text-xs"
                >
                  <StatusPill
                    color={REASON_COLOR[a.reason]}
                    variant="soft"
                    className="w-24 justify-center"
                  >
                    {a.reason}
                  </StatusPill>
                  <Link
                    href={`/boards/${a.boardId}?item=${a.itemId}`}
                    className="hover:text-foreground min-w-0 flex-1 truncate font-medium"
                  >
                    {a.itemName}
                  </Link>
                  <span className="text-muted-foreground truncate">
                    {a.boardName}
                    {a.groupName ? ` · ${a.groupName.trim()}` : ""}
                  </span>
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {a.reason} · {a.ageDays}d
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          {payload.briefs.length > 0 ? (
            <Panel kicker="05" title="Intelligence">
              <ul className="flex flex-col gap-3">
                {payload.briefs.map((b) => (
                  <li key={b.boardId} className="text-xs">
                    <p className="font-medium">{b.boardName}</p>
                    <p className="text-muted-foreground">{b.brief}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          <Panel kicker="06" title="Next milestones">
            {milestones.length === 0 ? (
              <EmptyState variant="inline">
                No upcoming stage end dates.
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {milestones.map((m) => (
                  <li
                    key={m.stageKey}
                    data-testid="milestone"
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground font-mono">
                      {fmtDate(m.endDate)} · {m.openBefore} open
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {widgets ? (
        <div id="widgets" className="scroll-mt-20">
          {widgets}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 9: Write `CommandCenter.tsx`**

```tsx
"use client";

import { useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { MetaChip } from "@/components/ui/meta-chip";
import { PageHeader } from "@/components/ui/page-header";
import { buildStages } from "@/lib/folders/stages";
import { filterRows } from "@/lib/folders/rollup";
import type { FolderPayload } from "@/lib/folders/types";
import { useCommandCenterState } from "./command-center-state";
import { TabStrip } from "./TabStrip";
import { FilterBar } from "./FilterBar";
import { OverviewTab } from "./tabs/Overview";

export type CommandCenterProps = {
  payload: FolderPayload;
  widgets?: ReactNode;
  headerActions?: ReactNode;
};

/**
 * The folder command center (spec §5). Everything below the header derives
 * from `payload` in client state; tab/stage/board live in the URL via
 * history.replaceState (0 server round-trips per interaction, gotcha-09).
 * `onRetry` is the one legitimate server call: a failed RPC panel re-runs the
 * page's RSC render, which is DIFFERENT data being requested, not a refetch
 * of state the client already has.
 */
export function CommandCenter({
  payload,
  widgets,
  headerActions,
}: CommandCenterProps) {
  const router = useRouter();
  const { tab, stage, board, setTab, setStage, setBoard } =
    useCommandCenterState();
  const rollup = useMemo(() => payload.rollup ?? [], [payload.rollup]);
  const stages = useMemo(
    () => buildStages(rollup, payload.todayISO),
    [rollup, payload.todayISO],
  );
  const rows = useMemo(
    () => filterRows(rollup, { stageKey: stage, boardId: board }),
    [rollup, stage, board],
  );
  const itemCount = rows.reduce((s, r) => s + r.total, 0);
  const empty = payload.boards.length === 0;
  const generated = new Date(payload.generatedAt);

  return (
    <div className="flex flex-col gap-2 p-4 md:p-6">
      <PageHeader
        kicker="Command center"
        title={payload.folder.name}
        description={
          <MetaChip label="Snapshot">
            {Number.isNaN(generated.getTime())
              ? payload.generatedAt
              : generated.toLocaleString()}{" "}
            · live
          </MetaChip>
        }
        actions={headerActions}
      />
      <TabStrip
        tab={tab}
        counts={{
          stages: stages.length,
          boards: payload.boards.length,
          people: null,
          overloaded: 0,
        }}
        disabled={empty}
        onChange={setTab}
      />
      {empty ? (
        <EmptyState className="mt-4">
          <span className="block">Add boards to this folder</span>
          <span className="text-xs">
            Use a board&apos;s ⋯ menu → Move to folder.
          </span>
        </EmptyState>
      ) : (
        <>
          <FilterBar
            stages={stages}
            boards={payload.boards}
            stage={stage}
            board={board}
            itemCount={itemCount}
            onStage={setStage}
            onBoard={setBoard}
          />
          {tab === "overview" ? (
            <OverviewTab
              payload={payload}
              rows={rows}
              stages={buildStages(rows, payload.todayISO)}
              stage={stage}
              widgets={widgets}
              onRetry={() => router.refresh()}
            />
          ) : (
            <EmptyState variant="inline">Coming in this build.</EmptyState>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Run all folder component tests + the bundle guard + lint**

Run: `pnpm vitest run src/components/folders/ && pnpm lint && pnpm typecheck`
Expected: `command-center-state` 3, `CommandCenter` 5, `Overview` 8, charts 10, `no-recharts-in-first-paint` 2 — all passed; lint + typecheck clean.

- [ ] **Step 11: Commit**

```bash
git add src/components/folders/command-center-state.ts src/components/folders/TabStrip.tsx src/components/folders/FilterBar.tsx src/components/folders/CommandCenter.tsx src/components/folders/tabs/Overview.tsx src/components/folders/command-center-state.test.tsx src/components/folders/CommandCenter.test.tsx src/components/folders/tabs/Overview.test.tsx
git commit -m "feat(folders): command center shell with url state, tab strip and overview"
```

---

### Task 9: Stages, Boards and People tabs

**Files:**

- Create: `src/components/folders/tabs/Stages.tsx`
- Create: `src/components/folders/tabs/Boards.tsx`
- Create: `src/components/folders/tabs/People.tsx`
- Modify: `src/components/folders/CommandCenter.tsx` (the tab switch + People count)
- Test: `src/components/folders/tabs/Stages.test.tsx`, `Boards.test.tsx`, `People.test.tsx`

**Interfaces:**

- Consumes: Task 4/5/6/7/8 exports; `renameGroup({ groupId, name }): Promise<ActionResult>` (`src/lib/boards/actions/group.ts:37`); `getFolderWorkload` (Task 5); `useQuery` (`@tanstack/react-query`, provider already mounted in `src/components/providers.tsx`); `HealthPill` colours via `StatusPill`.
- Produces:

```tsx
export function StagesTab(props: {
  rows: RollupRow[];
  allRows: RollupRow[];
  stages: StageSummary[];
  stage: string | null;
  burn: BurnRow[] | null;
  boards: FolderBoardRef[];
  todayISO: string;
  onSelectStage(k: string | null): void;
  onRetry(): void;
}): JSX.Element;
export type BoardSort = "health" | "owner" | "name";
export function BoardsTab(props: {
  rows: RollupRow[];
  boards: FolderBoardRef[];
  stages: StageSummary[];
}): JSX.Element;
export function PeopleTab(props: {
  folderId: string;
  stage: string | null;
  members: FolderMember[];
  onWorkload(rows: WorkloadRow[]): void;
}): JSX.Element;
export function peopleFromWorkload(
  rows: WorkloadRow[],
  stage: string | null,
  members: FolderMember[],
): WorkloadPerson[]; // exported from People.tsx for the badge
```

- [ ] **Step 1: Write the failing tests**

`Stages.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildStages } from "@/lib/folders/stages";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";
vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: () => <div data-testid="burn-chart" />,
}));
import { StagesTab } from "./Stages";

describe("StagesTab", () => {
  const fx = folderFixture();
  const stages = buildStages(fx.rollup!, FIXTURE_TODAY);
  it("renders a card per stage with a state kicker and 'Only on' for single-board stages", () => {
    render(
      <StagesTab
        rows={fx.rollup!}
        allRows={fx.rollup!}
        stages={stages}
        stage={null}
        burn={fx.burn}
        boards={fx.boards}
        todayISO={FIXTURE_TODAY}
        onSelectStage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("stage-card")).toHaveLength(4);
    expect(screen.getByText("COMPLETE")).toBeInTheDocument();
    expect(screen.getAllByText("IN FLIGHT").length).toBeGreaterThan(0);
    expect(screen.getByText("Only on Website")).toBeInTheDocument();
  });
  it("clicking a card selects the stage; the matrix and carry-over render", () => {
    const onSelect = vi.fn();
    render(
      <StagesTab
        rows={fx.rollup!}
        allRows={fx.rollup!}
        stages={stages}
        stage={null}
        burn={fx.burn}
        boards={fx.boards}
        todayISO={FIXTURE_TODAY}
        onSelectStage={onSelect}
        onRetry={vi.fn()}
      />,
    );
    // Stage order is min group position then name: Build (b3 has it at 0) sorts first.
    fireEvent.click(screen.getAllByTestId("stage-card")[0]);
    expect(onSelect).toHaveBeenCalledWith("build");
    expect(screen.getByText(/1 open item/)).toBeInTheDocument(); // carry-over
    expect(screen.getByText("Stage × board")).toBeInTheDocument();
  });
});
```

`Boards.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildStages } from "@/lib/folders/stages";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";

vi.mock("@/lib/boards/actions/group", () => ({
  renameGroup: vi.fn(async () => ({ ok: true, data: undefined })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
import { renameGroup } from "@/lib/boards/actions/group";
import { BoardsTab } from "./Boards";

describe("BoardsTab", () => {
  const fx = folderFixture();
  const stages = buildStages(fx.rollup!, FIXTURE_TODAY);
  it("lists every board with a health pill and sorts client-side", () => {
    render(<BoardsTab rows={fx.rollup!} boards={fx.boards} stages={stages} />);
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3
    fireEvent.click(screen.getByRole("button", { name: "Sort by health" }));
    const names = screen.getAllByTestId("board-name").map((n) => n.textContent);
    expect(names[0]).toBe("Backend"); // at_risk (overdue) sorts before Mobile (on_track); ties A–Z
  });
  it("offers to merge a single-board stage into an existing stage via renameGroup", async () => {
    render(<BoardsTab rows={fx.rollup!} boards={fx.boards} stages={stages} />);
    expect(screen.getByText("Stages on only one board")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Merge Launch into a stage" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "QA" }));
    expect(renameGroup).toHaveBeenCalledWith({
      groupId: "b3:launch",
      name: "QA",
    });
  });
});
```

`People.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { WorkloadRow } from "@/lib/folders/types";

const rows: WorkloadRow[] = [
  {
    userId: "u1",
    boardId: "b1",
    boardName: "Backend",
    stageKey: "build",
    stageName: "Build",
    open: 16,
    overdue: 2,
  },
  {
    userId: "u1",
    boardId: "b2",
    boardName: "Mobile",
    stageKey: "qa",
    stageName: "QA",
    open: 1,
    overdue: 0,
  },
  {
    userId: "u2",
    boardId: "b1",
    boardName: "Backend",
    stageKey: "build",
    stageName: "Build",
    open: 3,
    overdue: 0,
  },
  {
    userId: null,
    boardId: "b2",
    boardName: "Mobile",
    stageKey: "build",
    stageName: "Build",
    open: 2,
    overdue: 1,
  },
];
vi.mock("@/lib/folders/actions", () => ({
  getFolderWorkload: vi.fn(async () => ({ ok: true, data: rows })),
}));
import { getFolderWorkload } from "@/lib/folders/actions";
import { PeopleTab, peopleFromWorkload } from "./People";

const members = [
  { userId: "u1", fullName: "Ada Lovelace", avatarUrl: null },
  { userId: "u2", fullName: "Grace Hopper", avatarUrl: null },
];

describe("peopleFromWorkload", () => {
  it("sums per person for the selected stage and excludes the null row", () => {
    const all = peopleFromWorkload(rows, null, members);
    expect(all.map((p) => [p.name, p.open])).toEqual([
      ["Ada Lovelace", 17],
      ["Grace Hopper", 3],
    ]);
    expect(peopleFromWorkload(rows, "qa", members).map((p) => p.open)).toEqual([
      1,
    ]);
  });
});

describe("PeopleTab", () => {
  it("fetches workload once, renders bars, who-owns-what and unassigned", async () => {
    const qc = new QueryClient();
    const onWorkload = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <PeopleTab
          folderId="f1"
          stage={null}
          members={members}
          onWorkload={onWorkload}
        />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument(),
    );
    expect(screen.getByText("Who owns what")).toBeInTheDocument();
    expect(screen.getByText("Backend, Mobile")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Unassigned · 2 open/ }),
    ).toHaveAttribute("href", "/boards/b2");
    expect(onWorkload).toHaveBeenCalledWith(rows);
    rerender(
      <QueryClientProvider client={qc}>
        <PeopleTab
          folderId="f1"
          stage="qa"
          members={members}
          onWorkload={onWorkload}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByText("Grace Hopper")).toBeNull());
    expect(getFolderWorkload).toHaveBeenCalledTimes(1); // stage switch = 0 new calls
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/folders/tabs/` → FAIL for the three new files.

- [ ] **Step 3: Write `tabs/Stages.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Kicker } from "@/components/ui/kicker";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { StackedStatusBar } from "@/components/folders/charts/StackedStatusBar";
import { StageMatrix } from "@/components/folders/charts/StageMatrix";
import { BurnChart } from "@/components/folders/charts/BurnChart";
import type { BurnMode } from "@/components/folders/charts/BurnChartInner";
import { burnSeries, carryOver, stageMatrix } from "@/lib/folders/rollup";
import type { StageState, StageSummary } from "@/lib/folders/stages";
import type { BurnRow, FolderBoardRef, RollupRow } from "@/lib/folders/types";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<StageState, string> = {
  complete: "COMPLETE",
  in_flight: "IN FLIGHT",
  upcoming: "UPCOMING",
};

function fmt(iso: string | null): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function StagesTab({
  rows,
  allRows,
  stages,
  stage,
  burn,
  boards,
  todayISO,
  onSelectStage,
  onRetry,
}: {
  rows: RollupRow[];
  /** Unfiltered rows — the matrix and carry-over always show the whole folder. */
  allRows: RollupRow[];
  stages: StageSummary[];
  stage: string | null;
  burn: BurnRow[] | null;
  boards: FolderBoardRef[];
  todayISO: string;
  onSelectStage: (k: string | null) => void;
  onRetry: () => void;
}) {
  const [mode, setMode] = useState<BurnMode>("cumulative");
  const points = burn === null ? null : burnSeries(burn, stage, todayISO);
  const matrix = stageMatrix(allRows);
  const carried = carryOver(allRows, stages);
  const nameOf = new Map(boards.map((b) => [b.id, b.name]));
  void rows;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stages.map((s) => {
          const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
          return (
            <button
              key={s.key}
              type="button"
              data-testid="stage-card"
              aria-pressed={stage === s.key}
              onClick={() => onSelectStage(stage === s.key ? null : s.key)}
              className={cn(
                "bg-surface hover:border-border-hover card-lift flex flex-col gap-2 rounded-lg border p-4 text-left",
                stage === s.key && "border-border-bright",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.name}
                </span>
                <Kicker>{STATE_LABEL[s.state]}</Kicker>
              </div>
              <p className="text-muted-foreground font-mono text-xs">
                {fmt(s.minDue)} → {fmt(s.maxDue)} · {s.total} items · {pct}%
              </p>
              <StackedStatusBar
                mix={{
                  done: s.done,
                  inProgress: s.inProgress,
                  overdue: s.overdue,
                  notStarted: s.notStarted,
                }}
                label={s.name}
              />
              <p className="text-muted-foreground text-xs">
                {s.inProgress} in progress · {s.overdue} overdue ·{" "}
                {s.notStarted} not started
              </p>
              {s.onlyOnBoard ? (
                <p className="text-muted-foreground text-xs">
                  Only on {nameOf.get(s.onlyOnBoard) ?? s.onlyOnBoard}
                </p>
              ) : null}
            </button>
          );
        })}
      </div>

      <section className="bg-surface flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <Kicker>02</Kicker>
            <h2 className="text-sm font-semibold">Burn by stage</h2>
          </div>
          <div role="radiogroup" aria-label="Chart mode" className="flex gap-1">
            {(["cumulative", "weekly"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-sm border px-2 py-0.5 text-xs",
                  mode === m
                    ? "border-border-bright text-foreground"
                    : "text-muted-foreground hover:border-border-hover",
                )}
              >
                {m === "cumulative" ? "Cumulative" : "Weekly"}
              </button>
            ))}
          </div>
        </div>
        {points === null ? (
          <EmptyState
            variant="inline"
            className="flex flex-col items-center gap-2"
          >
            This panel couldn&apos;t load.
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </EmptyState>
        ) : points.length === 0 ? (
          <EmptyState variant="inline">
            Add due dates to see planned vs completed
          </EmptyState>
        ) : (
          <BurnChart points={points} mode={mode} />
        )}
      </section>

      <section className="bg-surface flex flex-col gap-3 rounded-lg border p-4">
        <div>
          <Kicker>03</Kicker>
          <h2 className="text-sm font-semibold">Stage × board</h2>
        </div>
        <StageMatrix
          boards={boards}
          stages={stages.map((s) => ({ key: s.key, name: s.name }))}
          cells={matrix}
          onSelectStage={onSelectStage}
        />
      </section>

      <p className="text-muted-foreground text-xs">
        <span className="font-medium">Carry-over:</span> {carried} open{" "}
        {carried === 1 ? "item" : "items"} in stages that are complete on
        another board.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Write `tabs/Boards.tsx`**

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { renameGroup } from "@/lib/boards/actions/group";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { StatusPill, type StatusPillColor } from "@/components/ui/status-pill";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StackedStatusBar } from "@/components/folders/charts/StackedStatusBar";
import {
  boardSummaries,
  onlyOnOneBoard,
  type BoardHealth,
} from "@/lib/folders/rollup";
import type { StageSummary } from "@/lib/folders/stages";
import type { FolderBoardRef, RollupRow } from "@/lib/folders/types";

export type BoardSort = "health" | "owner" | "name";
const HEALTH: Record<
  BoardHealth,
  { label: string; color: StatusPillColor; rank: number }
> = {
  off_track: { label: "Off track", color: "red", rank: 0 },
  at_risk: { label: "At risk", color: "yellow", rank: 1 },
  on_track: { label: "On track", color: "green", rank: 2 },
};

/**
 * Sorting is client state — 0 round-trips.
 */
export function BoardsTab({
  rows,
  boards,
  stages,
}: {
  rows: RollupRow[];
  boards: FolderBoardRef[];
  stages: StageSummary[];
}) {
  const router = useRouter();
  const [sort, setSort] = useState<BoardSort>("name");
  const [, startTransition] = useTransition();
  const summaries = useMemo(
    () => boardSummaries(rows, boards, stages),
    [rows, boards, stages],
  );
  const sorted = useMemo(() => {
    const s = [...summaries];
    if (sort === "health")
      s.sort(
        (a, b) =>
          HEALTH[a.health].rank - HEALTH[b.health].rank ||
          a.name.localeCompare(b.name),
      );
    else if (sort === "owner")
      s.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    else s.sort((a, b) => a.name.localeCompare(b.name));
    return s;
  }, [summaries, sort]);
  const singles = onlyOnOneBoard(rows, stages);
  const mergeTargets = stages.filter((s) => s.onlyOnBoard === null);

  function merge(groupId: string, targetName: string) {
    startTransition(async () => {
      const res = await renameGroup({ groupId, name: targetName });
      if (!res.ok) {
        showMutationError("Couldn't merge the stage.", new Error(res.error));
        return;
      }
      router.refresh(); // server data changed — a real refetch is correct here
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2" data-print-hide>
        <Kicker>Sort</Kicker>
        {(["health", "owner", "name"] as const).map((k) => (
          <Button
            key={k}
            type="button"
            size="sm"
            variant={sort === k ? "default" : "outline"}
            aria-label={`Sort by ${k}`}
            onClick={() => setSort(k)}
          >
            {k === "health" ? "Health" : k === "owner" ? "Size" : "A–Z"}
          </Button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Board</th>
              <th className="px-3 py-2 font-medium">Health</th>
              <th className="px-3 py-2 font-medium">Status mix</th>
              <th className="px-3 py-2 text-right font-medium">Items</th>
              <th className="px-3 py-2 text-right font-medium">Done</th>
              <th className="px-3 py-2 text-right font-medium">Overdue</th>
              <th className="px-3 py-2 text-right font-medium">Stale</th>
              <th className="px-3 py-2 font-medium">Next milestone</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => (
              <tr
                key={b.id}
                className="hover:bg-state-hover border-b last:border-b-0"
              >
                <td className="px-3 py-2 font-medium">
                  <Link data-testid="board-name" href={`/boards/${b.id}`}>
                    {b.name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <StatusPill color={HEALTH[b.health].color} variant="soft">
                    {HEALTH[b.health].label}
                  </StatusPill>
                </td>
                <td className="w-48 px-3 py-2">
                  <StackedStatusBar
                    mix={{
                      done: b.done,
                      inProgress: b.inProgress,
                      overdue: b.overdue,
                      notStarted: b.notStarted,
                    }}
                    label={b.name}
                  />
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {b.total}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {b.donePct === null ? "—" : `${b.donePct}%`}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {b.overdue}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {b.stale}
                </td>
                <td className="text-muted-foreground px-3 py-2 font-mono">
                  {b.nextMilestone ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {singles.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div>
            <Kicker>02</Kicker>
            <h2 className="text-sm font-semibold">Stages on only one board</h2>
          </div>
          <ul className="flex flex-col gap-1">
            {singles.map((g) => (
              <li
                key={g.groupId}
                className="flex items-center justify-between text-xs"
              >
                <span>
                  <span className="font-medium">{g.groupName}</span>{" "}
                  <span className="text-muted-foreground">· {g.boardName}</span>
                </span>
                {mergeTargets.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Merge ${g.groupName} into a stage`}
                      >
                        Merge into stage…
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {mergeTargets.map((t) => (
                        <DropdownMenuItem
                          key={t.key}
                          onSelect={() => merge(g.groupId, t.name)}
                        >
                          {t.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Write `tabs/People.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getFolderWorkload } from "@/lib/folders/actions";
import { Kicker } from "@/components/ui/kicker";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OVERLOAD_THRESHOLD,
  WorkloadBars,
  type WorkloadPerson,
} from "@/components/folders/charts/WorkloadBars";
import type { FolderMember, WorkloadRow } from "@/lib/folders/types";

export const workloadKey = (folderId: string) =>
  ["folder-workload", folderId] as const;

/** Per-person totals for the selected stage; the null (unassigned) row is excluded. */
export function peopleFromWorkload(
  rows: WorkloadRow[],
  stage: string | null,
  members: FolderMember[],
): WorkloadPerson[] {
  const byId = new Map(members.map((m) => [m.userId, m]));
  const acc = new Map<string, WorkloadPerson>();
  for (const r of rows) {
    if (r.userId === null) continue;
    if (stage !== null && r.stageKey !== stage) continue;
    const m = byId.get(r.userId);
    const cur = acc.get(r.userId) ?? {
      userId: r.userId,
      name: m?.fullName ?? "Unknown member",
      avatarUrl: m?.avatarUrl ?? null,
      open: 0,
      overdue: 0,
    };
    cur.open += r.open;
    cur.overdue += r.overdue;
    acc.set(r.userId, cur);
  }
  return [...acc.values()].sort(
    (a, b) => b.open - a.open || a.name.localeCompare(b.name),
  );
}

/**
 * Spec §6: folder_workload is fetched ONCE on first open (Server Action →
 * TanStack Query, staleTime 60 s); stage switches re-derive from the cache.
 */
export function PeopleTab({
  folderId,
  stage,
  members,
  onWorkload,
}: {
  folderId: string;
  stage: string | null;
  members: FolderMember[];
  onWorkload: (rows: WorkloadRow[]) => void;
}) {
  const q = useQuery({
    queryKey: workloadKey(folderId),
    queryFn: async () => {
      const res = await getFolderWorkload({ folderId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60_000,
  });
  useEffect(() => {
    if (q.data) onWorkload(q.data);
  }, [q.data, onWorkload]);

  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.isError)
    return (
      <EmptyState variant="inline">
        Couldn&apos;t load workload. {q.error.message}
      </EmptyState>
    );

  const rows = q.data;
  const people = peopleFromWorkload(rows, stage, members);
  const byId = new Map(members.map((m) => [m.userId, m]));
  const owns = new Map<
    string,
    { boards: Set<string>; open: number; overdue: number }
  >();
  for (const r of rows) {
    if (r.userId === null) continue;
    const cur = owns.get(r.userId) ?? {
      boards: new Set<string>(),
      open: 0,
      overdue: 0,
    };
    cur.boards.add(r.boardName);
    cur.open += r.open;
    cur.overdue += r.overdue;
    owns.set(r.userId, cur);
  }
  const unassigned = rows.filter(
    (r) => r.userId === null && (stage === null || r.stageKey === stage),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="bg-surface flex flex-col gap-3 rounded-lg border p-4 lg:col-span-2">
        <div>
          <Kicker>01</Kicker>
          <h2 className="text-sm font-semibold">Workload</h2>
          <p className="text-muted-foreground text-xs">
            Open items per person · red above {OVERLOAD_THRESHOLD}
          </p>
        </div>
        <WorkloadBars people={people} />
      </section>
      <section className="bg-surface flex flex-col gap-3 rounded-lg border p-4">
        <div>
          <Kicker>02</Kicker>
          <h2 className="text-sm font-semibold">Who owns what</h2>
        </div>
        {owns.size === 0 ? (
          <EmptyState variant="inline">No owners yet.</EmptyState>
        ) : (
          <ul className="divide-y text-xs">
            {[...owns.entries()].map(([userId, o]) => (
              <li
                key={userId}
                className="flex items-center justify-between py-2"
              >
                <span className="font-medium">
                  {byId.get(userId)?.fullName ?? "Unknown member"}
                </span>
                <span className="text-muted-foreground">
                  {[...o.boards].sort().join(", ")}
                </span>
                <span className="font-mono tabular-nums">
                  {o.open} open · {o.overdue} overdue
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="bg-surface flex flex-col gap-3 rounded-lg border p-4">
        <div>
          <Kicker>03</Kicker>
          <h2 className="text-sm font-semibold">Unassigned</h2>
        </div>
        {unassigned.length === 0 ? (
          <EmptyState variant="inline">
            Every open item has an owner.
          </EmptyState>
        ) : (
          <ul className="divide-y text-xs">
            {unassigned.map((r) => (
              <li key={`${r.boardId}:${r.stageKey}`} className="py-2">
                <Link
                  href={`/boards/${r.boardId}`}
                  className="hover:text-foreground font-medium"
                >
                  Unassigned · {r.open} open · {r.boardName} · {r.stageName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Wire the tabs into `CommandCenter.tsx`**

Replace the `EmptyState variant="inline">Coming in this build.` arm with a real switch, and hold the workload rows for the People badge:

```tsx
// imports to add
import { useCallback, useState } from "react";
import { StagesTab } from "./tabs/Stages";
import { BoardsTab } from "./tabs/Boards";
import { PeopleTab, peopleFromWorkload } from "./tabs/People";
import { OVERLOAD_THRESHOLD } from "@/components/folders/charts/WorkloadBars";
import type { WorkloadRow } from "@/lib/folders/types";

// inside the component, before the return
const [workload, setWorkload] = useState<WorkloadRow[] | null>(null);
const onWorkload = useCallback((rows: WorkloadRow[]) => setWorkload(rows), []);
const people =
  workload === null
    ? null
    : peopleFromWorkload(workload, stage, payload.members);
const counts = {
  stages: stages.length,
  boards: payload.boards.length,
  people: people === null ? null : people.length,
  overloaded:
    people === null
      ? 0
      : people.filter((p) => p.open > OVERLOAD_THRESHOLD).length,
};

// TabStrip: counts={counts}

// the tab body
{
  tab === "overview" ? (
    <OverviewTab
      payload={payload}
      rows={rows}
      stages={buildStages(rows, payload.todayISO)}
      stage={stage}
      widgets={widgets}
      onRetry={() => router.refresh()}
    />
  ) : tab === "stages" ? (
    <StagesTab
      rows={rows}
      allRows={rollup}
      stages={stages}
      stage={stage}
      burn={payload.burn}
      boards={payload.boards}
      todayISO={payload.todayISO}
      onSelectStage={setStage}
      onRetry={() => router.refresh()}
    />
  ) : tab === "boards" ? (
    <BoardsTab
      rows={rows}
      boards={
        board ? payload.boards.filter((b) => b.id === board) : payload.boards
      }
      stages={stages}
    />
  ) : (
    <PeopleTab
      folderId={payload.folder.id}
      stage={stage}
      members={payload.members}
      onWorkload={onWorkload}
    />
  );
}
```

Wrap the `CommandCenter` tests' render in a `QueryClientProvider` (add `import { QueryClient, QueryClientProvider } from "@tanstack/react-query"` and a `wrap()` helper) — the People tab mounts `useQuery`.

- [ ] **Step 7: Run everything for the folder components**

Run: `pnpm vitest run src/components/folders/ && pnpm lint && pnpm typecheck` → Expected: all green, including `no-recharts-in-first-paint` (Stages/Overview import only the lazy `BurnChart` and the type-only `BurnChartInner` import, which `static-imports.ts` treats as an edge only if it is a value import — use `import type`).

- [ ] **Step 8: Commit**

```bash
git add src/components/folders/tabs/Stages.tsx src/components/folders/tabs/Boards.tsx src/components/folders/tabs/People.tsx src/components/folders/CommandCenter.tsx src/components/folders/tabs/Stages.test.tsx src/components/folders/tabs/Boards.test.tsx src/components/folders/tabs/People.test.tsx src/components/folders/CommandCenter.test.tsx
git commit -m "feat(folders): stages, boards and people tabs on the command center"
```

---

### Task 10: `/folders/[folderId]` route — RSC page, loading, not-found

**Files:**

- Create: `src/app/(app)/folders/[folderId]/page.tsx`
- Create: `src/app/(app)/folders/[folderId]/loading.tsx`
- Create: `src/app/(app)/folders/[folderId]/not-found.tsx`
- Create: `src/lib/folders/payload.ts`
- Test: `src/lib/folders/payload.test.ts`, `src/app/(app)/folders/[folderId]/loading.test.tsx`

**Interfaces:**

- Consumes: `getFolderHead`, `listLatestBriefs` (Task 5 queries), `resolveFolderRollup` / `resolveFolderBurn` / `resolveFolderAttention` (Task 5), `listOrgMembersCached(orgId)` (`src/lib/org/queries-cached.ts:30`, returns `OrgMember[]` from `src/lib/boards/queries.ts:434`), `requireUser` (`src/lib/auth/session.ts:86`), `createClient`, `localTodayISO` (`src/lib/boards/overdue.ts:13`), `CommandCenter` (Task 8), `NotFoundFallback` (`src/components/shell/not-found-fallback.tsx:5`), `Skeleton`.
- Produces:

```ts
// src/lib/folders/payload.ts
export function buildFolderPayload(
  supabase: SupabaseClient<Database>,
  folderId: string,
  userId: string,
): Promise<FolderPayload | null>;
```

- [ ] **Step 1: Write the failing payload test**

`src/lib/folders/payload.test.ts` — proves the first-paint budget: the three RPCs run in one `Promise.all` with the head reads, briefs run second, and a failed RPC becomes `null`, not a throw:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("./queries", () => ({
  getFolderHead: vi.fn(async () => ({
    folder: {
      id: "f1",
      name: "Q4",
      workspaceId: "w1",
      orgId: "o1",
      position: 0,
    },
    boards: [{ id: "b1", name: "Backend", position: 0 }],
  })),
  listLatestBriefs: vi.fn(async () => [
    {
      boardId: "b1",
      boardName: "Backend",
      brief: "ok",
      generatedAt: "2026-09-15T00:00:00.000Z",
    },
  ]),
}));
const order: string[] = [];
vi.mock("./resolve", () => ({
  resolveFolderRollup: vi.fn(async () => {
    order.push("rollup");
    return { ok: true, rows: [] };
  }),
  resolveFolderBurn: vi.fn(async () => {
    order.push("burn");
    return { ok: false, error: "boom" };
  }),
  resolveFolderAttention: vi.fn(async () => {
    order.push("attention");
    return { ok: true, rows: [] };
  }),
}));
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: vi.fn(async () => [
    { userId: "u1", fullName: "Ada", email: null, avatarUrl: null },
  ]),
}));

import { getFolderHead, listLatestBriefs } from "./queries";
import { resolveFolderAttention } from "./resolve";
import { buildFolderPayload } from "./payload";

const supabase = {} as SupabaseClient<Database>;

describe("buildFolderPayload", () => {
  it("runs head + three RPCs concurrently, then briefs; a failed RPC is null, not a throw", async () => {
    const p = await buildFolderPayload(supabase, "f1", "u1");
    expect(p).not.toBeNull();
    expect(p!.rollup).toEqual([]);
    expect(p!.burn).toBeNull();
    expect(p!.attention).toEqual([]);
    expect(p!.briefs).toHaveLength(1);
    expect(p!.members).toEqual([
      { userId: "u1", fullName: "Ada", avatarUrl: null },
    ]);
    expect(resolveFolderAttention).toHaveBeenCalledWith(supabase, "f1", 20);
    expect(listLatestBriefs).toHaveBeenCalledWith(
      supabase,
      [{ id: "b1", name: "Backend", position: 0 }],
      "u1",
    );
    expect(p!.todayISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(p!.generatedAt).getTime()).not.toBeNaN();
  });

  it("returns null when the folder is hidden or absent", async () => {
    vi.mocked(getFolderHead).mockResolvedValueOnce(null);
    expect(await buildFolderPayload(supabase, "f1", "u1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/folders/payload.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write `payload.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { localTodayISO } from "@/lib/boards/overdue";
import type { Database } from "@/types/database.types";
import { getFolderHead, listLatestBriefs } from "./queries";
import {
  resolveFolderAttention,
  resolveFolderBurn,
  resolveFolderRollup,
} from "./resolve";
import type { FolderPayload } from "./types";

export const ATTENTION_LIMIT = 20;

/**
 * First paint (spec §6): head reads + folder_rollup + folder_burn +
 * folder_attention in ONE Promise.all on the request's RLS client (the RPCs
 * gate on auth.uid()), then the briefs read (needs the board ids). Members
 * come from the shell-warm `use cache` read. An RPC failure degrades that
 * panel to `null` (inline retry, spec §8) instead of failing the page.
 */
export async function buildFolderPayload(
  supabase: SupabaseClient<Database>,
  folderId: string,
  userId: string,
): Promise<FolderPayload | null> {
  const [head, rollup, burn, attention] = await Promise.all([
    getFolderHead(supabase, folderId),
    resolveFolderRollup(supabase, folderId),
    resolveFolderBurn(supabase, folderId),
    resolveFolderAttention(supabase, folderId, ATTENTION_LIMIT),
  ]);
  if (!head) return null;
  const [briefs, members] = await Promise.all([
    listLatestBriefs(supabase, head.boards, userId),
    listOrgMembersCached(head.folder.orgId),
  ]);
  return {
    folder: head.folder,
    boards: head.boards,
    rollup: rollup.ok ? rollup.rows : null,
    burn: burn.ok ? burn.rows : null,
    attention: attention.ok ? attention.rows : null,
    briefs,
    members: members.map((m) => ({
      userId: m.userId,
      fullName: m.fullName,
      avatarUrl: m.avatarUrl,
    })),
    generatedAt: new Date().toISOString(),
    todayISO: localTodayISO(),
  };
}
```

- [ ] **Step 4: Run the payload test**

Run: `pnpm vitest run src/lib/folders/payload.test.ts` → Expected: 2 passed.

- [ ] **Step 5: Write the route files**

`src/app/(app)/folders/[folderId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { CommandCenter } from "@/components/folders/CommandCenter";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buildFolderPayload } from "@/lib/folders/payload";
import { folderIdSchema } from "@/lib/validations/folders";

/**
 * The folder command center (spec §4). One RSC render; every in-page
 * interaction is client state + history.replaceState (working agreement #5).
 * `searchParams` is deliberately NOT awaited here: tab/stage/board are read on
 * the client from useSearchParams(), so a bare link and a deep link render the
 * same server payload.
 */
export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  if (!folderIdSchema.safeParse(folderId).success) notFound();
  const user = await requireUser();
  const supabase = await createClient();
  const payload = await buildFolderPayload(supabase, folderId, user.id);
  if (!payload) notFound();
  return <CommandCenter payload={payload} />;
}
```

`loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

/** Route skeleton (gotcha-48: loading.tsx is the instant-nav mechanism). Mirrors header + tabs + six KPI cards. */
export default function FolderLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading command center"
      className="flex flex-col gap-3 p-4 md:p-6"
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-9 w-full" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
```

`not-found.tsx`:

```tsx
import { NotFoundFallback } from "@/components/shell/not-found-fallback";

export default function FolderNotFound() {
  return (
    <NotFoundFallback
      title="Folder not found"
      description="This folder may have been deleted, or you may not have access to it."
      backHref="/dashboards"
      backLabel="All folders"
    />
  );
}
```

`loading.test.tsx` (mirror of `src/app/(app)/dashboards/loading.test.tsx`):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FolderLoading from "./loading";

describe("FolderLoading", () => {
  it("renders an accessible busy region with six KPI placeholders", () => {
    render(<FolderLoading />);
    expect(
      screen.getByRole("status", { name: "Loading command center" }),
    ).toHaveAttribute("aria-busy", "true");
  });
});
```

- [ ] **Step 6: Run gates for the route**

Run: `pnpm vitest run src/app/\(app\)/folders src/lib/folders/payload.test.ts && pnpm typecheck && pnpm lint && pnpm build`
Expected: tests pass; build succeeds and `.next/server/app/folders/[folderId].html` is non-empty (static shell intact — the page awaits nothing above a Suspense boundary that the `(app)` layout does not already own).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/folders/[folderId]/page.tsx" "src/app/(app)/folders/[folderId]/loading.tsx" "src/app/(app)/folders/[folderId]/not-found.tsx" "src/app/(app)/folders/[folderId]/loading.test.tsx" src/lib/folders/payload.ts src/lib/folders/payload.test.ts
git commit -m "feat(folders): /folders/[folderId] command center route with first-paint payload"
```

---

### Task 11: Copy private folders forward, backfill dashboards, drop the private tables; shared-folder sidebar; remove `DashboardsNav`

**Files:**

- Create: `supabase/migrations/<version>_private_folders_copy_forward.sql` (minted by `scripts/new-migration.sh private_folders_copy_forward`)
- Create: `scripts/sql/verify-folder-copy-forward.sql`
- Create: `src/lib/folders/copy-forward.integration.test.ts`
- Move: `src/lib/boards/folders/group.ts` → `src/lib/folders/group.ts`; `group.test.ts` alongside
- Delete: `src/lib/boards/folders/{actions.ts,actions.test.ts,queries-cached.ts,queries-cached.test.ts,types.ts,migration-indexes.test.ts,board-folders.rls.integration.test.ts}`, `src/lib/validations/board-folders.ts`, `src/components/dashboards/DashboardsNav.tsx`, `src/components/dashboards/DashboardsNav.test.tsx`
- Create: `src/components/dashboards/NewDashboardDialog.tsx`
- Modify: `src/lib/cache/tags.ts` (remove `boardFoldersTag`), `src/components/shell/sidebar-nav-data.tsx`, `sidebar-nav.tsx`, `sidebar-nav-skeleton.tsx` (comment), `src/components/boards/{BoardsNav,BoardsNavSortable,BoardFolderRow,BoardFolderMenu,NewFolderDialog,MoveToFolderMenu,PlainBoardRow,SharedBoardRow,SharedBoardsSection,BoardItemMenu,SharedBoardMenu}.tsx`, `src/components/shell/sidebar-nav-data.test.tsx`, `src/components/boards/BoardsNav.test.tsx`, `src/components/boards/BoardFolderMenu.test.tsx`, `src/components/boards/NewFolderDialog.test.tsx`, `src/components/boards/cells/editors/LongTextEditor.test.tsx:11` (comment only)
- Regenerate: `src/types/database.types.ts`

**Interfaces:**

- Consumes: Task 1 tables, Task 5 (`listFoldersCached`, `createFolder`, `renameFolder`, `deleteFolder`, `moveBoardToFolder`, `FolderSummary`, `FolderPlacement`, `FOLDER_GONE_ERROR`), `createDashboard` (`src/lib/dashboards/actions.ts:60`), `AiDashboardWizard` (`src/components/dashboards/ai/AiDashboardWizard.tsx:41`), `useUIStore.newDashboardOpen` (`src/stores/ui.ts:15-16`).
- Produces:
  - `src/lib/folders/group.ts`: `groupBoardsByFolder({ folders: FolderSummary[]; placements: FolderPlacement[]; boards; sharedBoards }): GroupedNav` — **empty folders are now kept** (a folder is a project; it links to its command center)
  - `src/components/dashboards/NewDashboardDialog.tsx`: `NewDashboardDialog({ workspaceId, folderId?, open, onOpenChange }: { workspaceId: string; folderId?: string; open: boolean; onOpenChange(o: boolean): void })` — creates, optionally attaches, then `router.push('/dashboards/<id>')`
  - `SidebarNav` props lose `dashboards`; `folders?: FolderSummary[]`, `placements?: FolderPlacement[]`
  - `NewFolderDialog({ workspaceId }: { workspaceId?: string })`
  - `BoardFolderRow`'s name is a `<Link href={`/folders/${folder.id}`}>`; the chevron alone toggles

- [ ] **Step 1: Mint the migration and write it**

Run: `scripts/new-migration.sh private_folders_copy_forward`, then:

```sql
-- What this migration does (spec §3.2, §3.3):
--   1. Copy every private (per-user) sidebar folder forward into ONE shared
--      folder per (workspace, trim(lower(name))). Workspace comes from the
--      boards inside the private folder; a private folder whose boards span
--      workspaces is split per workspace. A private folder with no visible
--      boards has no workspace and is not copied.
--   2. Place each board in the shared folder whose name held it most often
--      across users; ties break by the earliest private folder created_at.
--   3. Backfill dashboards.folder_id where every sourced widget's board sits
--      in one folder of the dashboard's workspace.
--   4. Drop the private tables (policies and indexes go with them).
--   Accepted trap (spec §3.2): a folder one user made for themselves becomes
--   visible to the whole workspace.
--   The statements between the copy-forward markers are what
--   scripts/sql/verify-folder-copy-forward.sql replays inside a rolled-back
--   transaction — keep the markers.

-- copy-forward:begin
with p as (
  select bfb.board_id,
         bfb.folder_id,
         bfb.position,
         bf.name,
         bf.user_id,
         bf.created_at as folder_created,
         b.workspace_id,
         b.org_id
  from public.board_folder_boards bfb
  join public.board_folders bf on bf.id = bfb.folder_id
  join public.boards b on b.id = bfb.board_id and b.archived_at is null
),
k as (
  select p.org_id,
         p.workspace_id,
         lower(trim(p.name)) as key,
         min(p.folder_created) as first_created,
         (array_agg(trim(p.name) order by p.folder_created asc, p.folder_id asc))[1] as display_name,
         (array_agg(p.user_id   order by p.folder_created asc, p.folder_id asc))[1] as first_user
  from p
  group by p.org_id, p.workspace_id, lower(trim(p.name))
)
insert into public.folders (org_id, workspace_id, name, position, created_by, created_at)
select k.org_id,
       k.workspace_id,
       k.display_name,
       (row_number() over (partition by k.workspace_id order by k.first_created asc, k.display_name asc) - 1)::int,
       k.first_user,
       k.first_created
from k
on conflict (workspace_id, lower(trim(name))) do nothing;

with p as (
  select bfb.board_id,
         bfb.position,
         bf.name,
         bf.created_at as folder_created,
         b.workspace_id
  from public.board_folder_boards bfb
  join public.board_folders bf on bf.id = bfb.folder_id
  join public.boards b on b.id = bfb.board_id and b.archived_at is null
),
v as (
  select p.board_id,
         p.workspace_id,
         lower(trim(p.name)) as key,
         count(*) as votes,
         min(p.folder_created) as first_created,
         min(p.position) as position
  from p
  group by p.board_id, p.workspace_id, lower(trim(p.name))
),
w as (
  select distinct on (v.board_id) v.board_id, v.workspace_id, v.key, v.position
  from v
  order by v.board_id, v.votes desc, v.first_created asc
)
insert into public.folder_boards (folder_id, board_id, position)
select fo.id, w.board_id, w.position
from w
join public.folders fo
  on fo.workspace_id = w.workspace_id
 and lower(trim(fo.name)) = w.key
on conflict (board_id) do nothing;

update public.dashboards d
set folder_id = x.folder_id
from (
  select dw.dashboard_id, min(fb.folder_id) as folder_id
  from public.dashboard_widgets dw
  join public.folder_boards fb on fb.board_id = dw.source_board_id
  group by dw.dashboard_id
  having count(distinct fb.folder_id) = 1
     and count(*) = (
       select count(*) from public.dashboard_widgets dw2
       where dw2.dashboard_id = dw.dashboard_id and dw2.source_board_id is not null
     )
) x
where d.id = x.dashboard_id
  and d.folder_id is null
  and exists (
    select 1 from public.folders fo
    where fo.id = x.folder_id and fo.workspace_id = d.workspace_id
  );
-- copy-forward:end

drop table public.board_folder_boards;
drop table public.board_folders;
```

- [ ] **Step 2: Write the verification script and its test harness**

`scripts/sql/verify-folder-copy-forward.sql` — a self-contained transaction that recreates the private tables if the drop already ran, seeds a fixture (two users sharing a folder name; one board filed by two users under different names; a dashboard sourced from one folder), replays the marker block, asserts, and rolls back. `\set ON_ERROR_STOP on` is passed by the harness:

```sql
begin;

-- The private tables may already be gone (this script must pass before AND
-- after the migration). Recreate the columns the copy-forward reads.
create table if not exists public.board_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.board_folder_boards (
  user_id uuid not null,
  board_id uuid not null,
  folder_id uuid not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, board_id)
);

-- Fixture identities (rolled back with everything else).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cf-a@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cf-b@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, created_by) values ('b0000000-0000-4000-8000-000000000001', 'CF Org', 'cf-org-verify', 'a0000000-0000-4000-8000-000000000001');
insert into public.workspaces (id, org_id, name, created_by) values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'CF WS', 'a0000000-0000-4000-8000-000000000001');
insert into public.boards (id, org_id, workspace_id, name, created_by) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Board 1', 'a0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Board 2', 'a0000000-0000-4000-8000-000000000001');

-- User A: "Client Work" holds Board 1 + Board 2. User B: " client work " holds
-- Board 1; B also has "Archive" holding Board 2 (created later than A's).
insert into public.board_folders (id, user_id, name, created_at) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Client Work',   '2026-01-01'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', ' client work ', '2026-02-01'),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'Archive',       '2026-03-01');
insert into public.board_folder_boards (user_id, board_id, folder_id, position) values
  ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 0),
  ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 1),
  ('a0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 0),
  ('a0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003', 0);

-- A dashboard whose only sourced widget reads Board 1 → lands in "Client Work".
insert into public.dashboards (id, org_id, workspace_id, name, created_by) values
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'D1', 'a0000000-0000-4000-8000-000000000001');
insert into public.dashboard_widgets (dashboard_id, org_id, kind, source_board_id) values
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'number', 'd0000000-0000-4000-8000-000000000001');

-- :copy_forward is substituted by the harness with the marker block.
:copy_forward

do $$
declare
  n_folders int;
  v_name text;
  v_b1 uuid;
  v_b2 uuid;
  v_dash uuid;
begin
  select count(*), min(name) into n_folders, v_name
  from public.folders where workspace_id = 'c0000000-0000-4000-8000-000000000001' and lower(trim(name)) = 'client work';
  if n_folders <> 1 then raise exception 'expected ONE shared "client work" folder, got %', n_folders; end if;
  if v_name <> 'Client Work' then raise exception 'expected first-seen casing "Client Work", got %', v_name; end if;

  select fb.folder_id into v_b1 from public.folder_boards fb where fb.board_id = 'd0000000-0000-4000-8000-000000000001';
  select fb.folder_id into v_b2 from public.folder_boards fb where fb.board_id = 'd0000000-0000-4000-8000-000000000002';
  if v_b1 is null or v_b1 <> (select id from public.folders where workspace_id = 'c0000000-0000-4000-8000-000000000001' and lower(trim(name)) = 'client work') then
    raise exception 'Board 1 should land in Client Work (2 votes)';
  end if;
  -- Board 2: Client Work (A, created 2026-01) vs Archive (B, 2026-03) — one vote each → earliest wins.
  if v_b2 <> v_b1 then raise exception 'Board 2 tie should break to the earliest folder (Client Work)'; end if;

  select folder_id into v_dash from public.dashboards where id = 'f0000000-0000-4000-8000-000000000001';
  if v_dash is distinct from v_b1 then raise exception 'dashboard D1 should be backfilled into Client Work'; end if;
  raise notice 'copy-forward verification passed';
end $$;

rollback;
```

`src/lib/folders/copy-forward.integration.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "dotenv";
import { describe, expect, it } from "vitest";

config({ path: ".env.local", override: true });
const DSN = process.env.DEV_SUPABASE_DB_URL;

/**
 * Resolved ambiguity #11: replays the migration's copy-forward block against a
 * fixture inside `begin; … rollback;` on DEV through psql (the same transport
 * scripts/check-migration-ledger.mjs uses). Opt-in: PULSE_TEST_DB=1 and
 * DEV_SUPABASE_DB_URL must both be set. Nothing is committed.
 */
describe.skipIf(process.env.PULSE_TEST_DB !== "1" || !DSN)(
  "private → shared folder copy-forward",
  () => {
    it("dedupes by (workspace, trim(lower(name))), votes boards, breaks ties by created_at, backfills dashboards", () => {
      const migDir = join(process.cwd(), "supabase/migrations");
      const file = readdirSync(migDir).find((f) =>
        f.endsWith("_private_folders_copy_forward.sql"),
      );
      expect(file).toBeDefined();
      const sql = readFileSync(join(migDir, file as string), "utf8");
      const block = sql
        .split("-- copy-forward:begin")[1]
        ?.split("-- copy-forward:end")[0];
      expect(block).toBeTruthy();
      const script = readFileSync(
        join(process.cwd(), "scripts/sql/verify-folder-copy-forward.sql"),
        "utf8",
      ).replace(":copy_forward", block as string);
      const tmp = mkdtempSync(join(tmpdir(), "cf-"));
      const path = join(tmp, "verify.sql");
      writeFileSync(path, script);
      const out = execFileSync(
        "psql",
        [DSN as string, "-v", "ON_ERROR_STOP=1", "-f", path],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(out).toContain("copy-forward verification passed");
    });
  },
);
```

Run (opt-in): `PULSE_TEST_DB=1 pnpm vitest run --project integration src/lib/folders/copy-forward.integration.test.ts`
Expected: 1 passed, **before** applying the migration. (Run it again after Step 3 — it must still pass thanks to the `create table if not exists` shims.)

- [ ] **Step 3: Apply to DEV, regenerate types, ledger-check**

`supabase-dev` `apply_migration` (exact basename) → `generate_typescript_types` → `pnpm prettier --write src/types/database.types.ts` → `pnpm db:ledger-check` → `ledger ok`. Then re-run the Step 2 test (still passes).

- [ ] **Step 4: Move the fold and switch it to shared folders (keep empty folders)**

`git mv src/lib/boards/folders/group.ts src/lib/folders/group.ts && git mv src/lib/boards/folders/group.test.ts src/lib/folders/group.test.ts`. In `group.ts` change the imports to `import type { FolderPlacement, FolderSummary } from "./types";`, the prop types to `folders: FolderSummary[]; placements: FolderPlacement[]`, `GroupedNav.folders` to `Array<{ folder: FolderSummary; boards: NavBoard[] }>`, and **remove** the `.filter((f) => (buckets.get(f.id)?.length ?? 0) > 0)` line (rule 1 in its docblock flips: a shared folder is a project and renders even when empty, linking to its command center). In `group.test.ts` change the "hides a folder whose boards are all invisible" case to expect the folder to render with `boards: []`, and add `workspaceId: "w1", orgId: "o1"` to every folder literal.

- [ ] **Step 5: Delete the private-folder code and re-point every call site**

Delete the files listed under **Files → Delete**, remove `boardFoldersTag` from `src/lib/cache/tags.ts`. Then, per file:

- `src/components/shell/sidebar-nav-data.tsx`: replace `listBoardFoldersCached(userId)` with `listFoldersCached(orgId, activeWorkspaceId)` (import from `@/lib/folders/queries-cached`), drop `listDashboardsCached` from the `Promise.all` and the `dashboards` key from the returned object. Update `sidebar-nav-data.test.tsx`: mock `@/lib/folders/queries-cached` → `listFoldersCached` returning `{ folders: [{ id: "f1", name: "Client work", workspaceId: "w1", orgId: "o1", position: 0 }], placements: [...] }`, assert `expect(listFoldersCached).toHaveBeenCalledWith("o1", "w1")`; the "omits the folder props when the read fails" and "leaves persisted collapse keys intact" cases stay as they are.
- `src/components/shell/sidebar-nav.tsx`: remove the `DashboardsNav` import, the `dashboards` prop, and both `{dashboardsNav}` renders (and the `<RailDivider />` before it in the collapsed branch); type `folders?: FolderSummary[]; placements?: FolderPlacement[]` from `@/lib/folders/types`.
- `src/components/shell/sidebar-nav-skeleton.tsx:5`: comment → "Rows match BoardsNav heights".
- `src/components/boards/BoardsNav.tsx`: imports → `@/lib/folders/types`, `@/lib/folders/group`; `NO_FOLDERS: FolderSummary[]`; pass `workspaceId={activeWorkspaceId}` to `<NewFolderDialog />`.
- `src/components/boards/BoardsNavSortable.tsx`: imports → `@/lib/folders/types`, `@/lib/folders/actions` (`moveBoardToFolder` keeps its name and shape).
- `src/components/boards/{PlainBoardRow,SharedBoardRow,SharedBoardsSection,BoardItemMenu,SharedBoardMenu,MoveToFolderMenu}.tsx`: `BoardFolder` → `FolderSummary` from `@/lib/folders/types`; `moveBoardToFolder` from `@/lib/folders/actions`.
- `src/components/boards/BoardFolderMenu.tsx`: `renameFolder`/`deleteFolder` from `@/lib/folders/actions`; `FOLDER_GONE_ERROR` from `@/lib/folders/types`. Update `BoardFolderMenu.test.tsx` mocks accordingly.
- `src/components/boards/NewFolderDialog.tsx`: accept `{ workspaceId }: { workspaceId?: string }`, call `createFolder({ workspaceId, name: trimmed })` (disable the trigger when `!workspaceId`), toast copy → `Folder “${trimmed}” created` / "Open it from the sidebar to build its command center." Update `NewFolderDialog.test.tsx` to pass `workspaceId="w1"` and assert the action was called with it.
- `src/components/boards/BoardFolderRow.tsx`: the name becomes `<Link href={`/folders/${folder.id}`} className="min-w-0 flex-1 truncate">{folder.name}</Link>` **outside** the disclosure button; the button keeps only the chevron and gets `aria-label={`Toggle ${folder.name}`}`. Update the `BoardsNav.test.tsx` folder describe: the name is now a link with `href="/folders/f1"`; the collapse test clicks `getByRole("button", { name: "Toggle Acme Rebrand" })`; add a case "renders an empty folder as a link to its command center".
- `src/components/boards/cells/editors/LongTextEditor.test.tsx:11`: comment now says "as BoardsNav.test.tsx does".

- [ ] **Step 6: Extract `NewDashboardDialog` and remove `DashboardsNav`**

Create `src/components/dashboards/NewDashboardDialog.tsx` from the `<Dialog>` block of the deleted `DashboardsNav.tsx` (name input, `FieldStatus`, `useRestoreFocusAfterPending`, `createDashboard`), with props `{ workspaceId: string; folderId?: string; open: boolean; onOpenChange: (o: boolean) => void }`. In `submit()`, after `createDashboard` succeeds: `if (folderId) await attachDashboardToFolder({ dashboardId: res.data.dashboard.id, folderId });` then `onOpenChange(false); router.push(`/dashboards/${res.data.dashboard.id}`); router.refresh();`. Write `NewDashboardDialog.test.tsx` (port the two create cases from the deleted `DashboardsNav.test.tsx`; add "attaches to the folder when folderId is given" asserting `attachDashboardToFolder` was called).

- [ ] **Step 7: Gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → all green. `src/components/command-palette.test.tsx` still passes untouched (the palette keeps its `dashboards` prop until Task 12).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/<version>_private_folders_copy_forward.sql scripts/sql/verify-folder-copy-forward.sql src/lib/folders/copy-forward.integration.test.ts src/types/database.types.ts src/lib/folders/group.ts src/lib/folders/group.test.ts src/lib/cache/tags.ts src/components/shell/sidebar-nav-data.tsx src/components/shell/sidebar-nav-data.test.tsx src/components/shell/sidebar-nav.tsx src/components/shell/sidebar-nav-skeleton.tsx src/components/boards/BoardsNav.tsx src/components/boards/BoardsNav.test.tsx src/components/boards/BoardsNavSortable.tsx src/components/boards/BoardFolderRow.tsx src/components/boards/BoardFolderMenu.tsx src/components/boards/BoardFolderMenu.test.tsx src/components/boards/NewFolderDialog.tsx src/components/boards/NewFolderDialog.test.tsx src/components/boards/MoveToFolderMenu.tsx src/components/boards/PlainBoardRow.tsx src/components/boards/SharedBoardRow.tsx src/components/boards/SharedBoardsSection.tsx src/components/boards/BoardItemMenu.tsx src/components/boards/SharedBoardMenu.tsx src/components/boards/cells/editors/LongTextEditor.test.tsx src/components/dashboards/NewDashboardDialog.tsx src/components/dashboards/NewDashboardDialog.test.tsx
git rm -q src/lib/boards/folders/actions.ts src/lib/boards/folders/actions.test.ts src/lib/boards/folders/queries-cached.ts src/lib/boards/folders/queries-cached.test.ts src/lib/boards/folders/types.ts src/lib/boards/folders/migration-indexes.test.ts src/lib/boards/folders/board-folders.rls.integration.test.ts src/lib/validations/board-folders.ts src/components/dashboards/DashboardsNav.tsx src/components/dashboards/DashboardsNav.test.tsx
git commit -m "feat(folders): copy private folders forward, drop them, shared-folder sidebar"
```

---

### Task 12: `/dashboards` folder gallery, `/dashboards/[id]` redirect, ⌘K folder entries

**Files:**

- Modify: `src/app/(app)/dashboards/page.tsx` (whole file)
- Modify: `src/app/(app)/dashboards/[dashboardId]/page.tsx:20-22` (redirect after `getDashboardPayload`)
- Modify: `src/app/(app)/dashboards/loading.tsx` (gallery skeleton)
- Create: `src/components/folders/FolderGallery.tsx`, `src/components/folders/UnfiledDashboards.tsx`
- Modify: `src/components/shell/command-palette-data.tsx`, `src/components/command-palette.tsx:45-57,200-245`, `src/components/command-palette.test.tsx`
- Create: `src/lib/folders/redirect.ts`
- Test: `src/components/folders/FolderGallery.test.tsx`, `src/components/folders/UnfiledDashboards.test.tsx`, `src/lib/folders/redirect.test.ts`

**Interfaces:**

- Consumes: `resolveFolderGallery`, `listUnfiledDashboards`, `attachDashboardToFolder` (Task 5), `listFoldersCached` (Task 5), `NewDashboardDialog` (Task 11), `getActiveOrgId` (`src/lib/org/active.ts:40`), `listWorkspacesCached` (`src/lib/workspaces/queries-cached.ts`), `getActiveWorkspaceId` (`src/lib/workspaces/active.ts:14`), `redirect` (`next/navigation`, 307 in a Server Component per `redirect.md`), `useUIStore.newDashboardOpen`.
- Produces:

```tsx
export function FolderGallery(props: {
  rows: GalleryRow[];
  workspaceId: string;
}): JSX.Element; // server-renderable, links to /folders/[id]
export function UnfiledDashboards(props: {
  dashboards: { id: string; name: string }[];
  folders: { id: string; name: string }[];
  workspaceId: string;
}): JSX.Element; // client: attach picker + New dashboard dialog host
export function dashboardRedirectTarget(
  dashboard: { folder_id: string | null },
  folderExists: boolean,
): string | null; // pure helper in src/lib/folders/redirect.ts
// CommandPalette props: `dashboards` replaced by `folders: { id: string; name: string }[]`
```

- [ ] **Step 1: Write the failing tests**

`src/lib/folders/redirect.test.ts` (create alongside `src/lib/folders/redirect.ts`):

```ts
import { describe, expect, it } from "vitest";
import { dashboardRedirectTarget } from "./redirect";

describe("dashboardRedirectTarget", () => {
  it("sends a folded-in dashboard to its folder's Overview widgets anchor", () => {
    expect(dashboardRedirectTarget({ folder_id: "f1" }, true)).toBe(
      "/folders/f1?tab=overview#widgets",
    );
  });
  it("stays on the legacy canvas when unfiled or when the folder is gone/hidden", () => {
    expect(dashboardRedirectTarget({ folder_id: null }, false)).toBeNull();
    expect(dashboardRedirectTarget({ folder_id: "f1" }, false)).toBeNull();
  });
});
```

`FolderGallery.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FolderGallery } from "./FolderGallery";

describe("FolderGallery", () => {
  it("renders one card per folder with counts and a link to the command center", () => {
    render(
      <FolderGallery
        workspaceId="w1"
        rows={[
          {
            folderId: "f1",
            name: "Q4 Launch",
            position: 0,
            boards: 3,
            items: 26,
            done: 13,
            overdue: 1,
            attention: 4,
          },
          {
            folderId: "f2",
            name: "Empty",
            position: 1,
            boards: 0,
            items: 0,
            done: 0,
            overdue: 0,
            attention: 0,
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /Q4 Launch/ })).toHaveAttribute(
      "href",
      "/folders/f1",
    );
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("1 overdue")).toBeInTheDocument();
    expect(screen.getByText("4 need attention")).toBeInTheDocument();
    expect(screen.getByText("No boards yet")).toBeInTheDocument();
  });
  it("shows the empty state when the workspace has no folders", () => {
    render(<FolderGallery workspaceId="w1" rows={[]} />);
    expect(screen.getByText(/No folders yet/)).toBeInTheDocument();
  });
});
```

`UnfiledDashboards.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/folders/actions", () => ({
  attachDashboardToFolder: vi.fn(async () => ({ ok: true, data: undefined })),
}));
vi.mock("@/components/dashboards/NewDashboardDialog", () => ({
  NewDashboardDialog: () => <div data-testid="new-dashboard-dialog" />,
}));
import { attachDashboardToFolder } from "@/lib/folders/actions";
import { UnfiledDashboards } from "./UnfiledDashboards";

describe("UnfiledDashboards", () => {
  it("lists unfiled dashboards with an attach picker", async () => {
    render(
      <UnfiledDashboards
        workspaceId="w1"
        dashboards={[{ id: "d1", name: "Team overview" }]}
        folders={[{ id: "f1", name: "Q4 Launch" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "Team overview" })).toHaveAttribute(
      "href",
      "/dashboards/d1",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Attach Team overview to a folder" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Q4 Launch" }));
    expect(attachDashboardToFolder).toHaveBeenCalledWith({
      dashboardId: "d1",
      folderId: "f1",
    });
  });
  it("hosts the New dashboard dialog", () => {
    render(<UnfiledDashboards workspaceId="w1" dashboards={[]} folders={[]} />);
    expect(screen.getByTestId("new-dashboard-dialog")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/lib/folders/redirect.test.ts src/components/folders/FolderGallery.test.tsx src/components/folders/UnfiledDashboards.test.tsx` → FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/lib/folders/redirect.ts`:

```ts
/** Spec §4: a dashboard with a live folder redirects into that folder's Overview; otherwise the legacy canvas renders. */
export function dashboardRedirectTarget(
  dashboard: { folder_id: string | null },
  folderExists: boolean,
): string | null {
  if (!dashboard.folder_id || !folderExists) return null;
  return `/folders/${dashboard.folder_id}?tab=overview#widgets`;
}
```

`src/components/folders/FolderGallery.tsx`:

```tsx
import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Kicker } from "@/components/ui/kicker";
import { StatusPill } from "@/components/ui/status-pill";
import { STATUS_BG } from "@/components/ui/status-pill";
import type { GalleryRow } from "@/lib/folders/types";

/** One card per folder in the active workspace (spec §4 /dashboards). Server-renderable. */
export function FolderGallery({
  rows,
}: {
  rows: GalleryRow[];
  workspaceId: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        No folders yet. Create one from the Boards section of the sidebar, then
        move boards into it.
      </EmptyState>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => {
        const pct = r.items > 0 ? Math.round((r.done / r.items) * 100) : null;
        return (
          <Link
            key={r.folderId}
            href={`/folders/${r.folderId}`}
            className="bg-surface hover:border-border-hover card-lift flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex items-center gap-2">
              <FolderKanban className="text-muted-foreground size-4" />
              <span className="truncate text-sm font-semibold">{r.name}</span>
            </div>
            {r.boards === 0 ? (
              <p className="text-muted-foreground text-xs">No boards yet</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="font-heading text-2xl font-semibold tabular-nums">
                    {pct === null ? "—" : `${pct}%`}
                  </span>
                  <Kicker>
                    {r.boards} {r.boards === 1 ? "board" : "boards"} · {r.items}{" "}
                    items
                  </Kicker>
                </div>
                <div className="bg-surface-muted h-1 w-full overflow-hidden rounded-sm">
                  <div
                    className={STATUS_BG.green}
                    style={{ width: `${pct ?? 0}%`, height: "100%" }}
                  />
                </div>
                <div className="flex gap-2">
                  {r.overdue > 0 ? (
                    <StatusPill color="red" variant="soft">
                      {r.overdue} overdue
                    </StatusPill>
                  ) : null}
                  {r.attention > 0 ? (
                    <StatusPill color="yellow" variant="soft">
                      {r.attention} need attention
                    </StatusPill>
                  ) : null}
                </div>
              </>
            )}
          </Link>
        );
      })}
    </div>
  );
}
```

`src/components/folders/UnfiledDashboards.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderInput, Plus } from "lucide-react";
import { attachDashboardToFolder } from "@/lib/folders/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NewDashboardDialog } from "@/components/dashboards/NewDashboardDialog";
import { useUIStore } from "@/stores/ui";

/** "Unfiled dashboards" section with the attach picker; also hosts the New dashboard dialog the ⌘K command opens. */
export function UnfiledDashboards({
  dashboards,
  folders,
  workspaceId,
}: {
  dashboards: { id: string; name: string }[];
  folders: { id: string; name: string }[];
  workspaceId: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const storeOpen = useUIStore((s) => s.newDashboardOpen);
  const setStoreOpen = useUIStore((s) => s.setNewDashboardOpen);
  const [localOpen, setLocalOpen] = useState(false);
  const open = storeOpen || localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    if (!next) setStoreOpen(false);
  };

  function attach(dashboardId: string, folderId: string) {
    startTransition(async () => {
      const res = await attachDashboardToFolder({ dashboardId, folderId });
      if (!res.ok) {
        showMutationError(
          "Couldn't attach the dashboard.",
          new Error(res.error),
        );
        return;
      }
      router.refresh(); // server data changed
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <Kicker>02</Kicker>
          <h2 className="text-sm font-semibold">Unfiled dashboards</h2>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-4" /> New dashboard
        </Button>
      </div>
      {dashboards.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Every dashboard belongs to a folder.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {dashboards.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between px-3 py-2 text-sm"
            >
              <Link href={`/dashboards/${d.id}`} className="font-medium">
                {d.name}
              </Link>
              {folders.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Attach ${d.name} to a folder`}
                    >
                      <FolderInput className="size-4" /> Attach
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {folders.map((f) => (
                      <DropdownMenuItem
                        key={f.id}
                        onSelect={() => attach(d.id, f.id)}
                      >
                        {f.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <NewDashboardDialog
        workspaceId={workspaceId}
        open={open}
        onOpenChange={setOpen}
      />
    </section>
  );
}
```

`src/app/(app)/dashboards/page.tsx` (replace the whole file):

```tsx
import { PageHeader } from "@/components/ui/page-header";
import { FolderGallery } from "@/components/folders/FolderGallery";
import { UnfiledDashboards } from "@/components/folders/UnfiledDashboards";
import { requireUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import { createClient } from "@/lib/supabase/server";
import { resolveFolderGallery } from "@/lib/folders/resolve";
import { listUnfiledDashboards } from "@/lib/folders/queries";
import { listFoldersCached } from "@/lib/folders/queries-cached";
import { EmptyState } from "@/components/ui/empty-state";

/** The folder gallery (spec §4): one folder_gallery RPC + one bounded unfiled read + the warm cached folder list. */
export default async function DashboardsIndex() {
  await requireUser();
  const orgId = await getActiveOrgId();
  const workspaceId = await getActiveWorkspaceId(
    await listWorkspacesCached(orgId),
  );
  if (!workspaceId)
    return (
      <EmptyState className="m-6">
        Create a workspace to see folders.
      </EmptyState>
    );
  const supabase = await createClient();
  const [gallery, unfiled, nav] = await Promise.all([
    resolveFolderGallery(supabase, workspaceId),
    listUnfiledDashboards(supabase, workspaceId),
    listFoldersCached(orgId, workspaceId),
  ]);
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        kicker="Workspace"
        title="Folders"
        description="Every folder is a project with its own command center."
      />
      {gallery.ok ? (
        <FolderGallery rows={gallery.rows} workspaceId={workspaceId} />
      ) : (
        <EmptyState>Couldn&apos;t load folders. {gallery.error}</EmptyState>
      )}
      <UnfiledDashboards
        workspaceId={workspaceId}
        dashboards={unfiled}
        folders={(nav?.folders ?? []).map((f) => ({ id: f.id, name: f.name }))}
      />
    </div>
  );
}
```

`src/app/(app)/dashboards/loading.tsx`: replace `<DashboardCanvasSkeleton />` with a 6-card grid of `Skeleton className="h-32 w-full"` under a `role="status" aria-label="Loading folders"` region; update `loading.test.tsx` to look for that label.

`src/app/(app)/dashboards/[dashboardId]/page.tsx` — insert after `if (!payload) notFound();`:

```tsx
// Spec §4: a folded-in dashboard lives on its folder's Overview. The folder
// FK is `on delete set null`, so folder_id being set almost always means the
// folder exists — the read still guards RLS-hidden folders (spec §8).
if (payload.dashboard.folder_id) {
  const supabaseForFolder = await createClient();
  const { data: folder } = await supabaseForFolder
    .from("folders")
    .select("id")
    .eq("id", payload.dashboard.folder_id)
    .maybeSingle();
  const target = dashboardRedirectTarget(payload.dashboard, folder !== null);
  if (target) redirect(target);
}
```

(import `redirect` from `next/navigation` and `dashboardRedirectTarget` from `@/lib/folders/redirect`; reuse the `supabase` client the page already creates below by hoisting `const supabase = await createClient();` above this block instead of creating a second one.)

⌘K: in `command-palette-data.tsx` replace `listDashboardsCached(orgId)` with `listFoldersCached(orgId, await getActiveWorkspaceId(workspaces))` (compute `workspaces` first) and pass `folders={(nav?.folders ?? []).map((f) => ({ id: f.id, name: f.name }))}`. In `command-palette.tsx`: prop `dashboards` → `folders`; the group renders `<CommandItem onSelect={() => run(() => router.push(`/folders/${f.id}`))}><FolderKanban className="size-4" /> {f.name} — command center</CommandItem>`; the "Dashboards" nav item stays (`/dashboards`, label "Folders"); "New dashboard" → `run(() => { router.push("/dashboards"); setNewDashboardOpen(true); })`. Update `command-palette.test.tsx:51-107`: `folders = [{ id: "f1", name: "Q4 Launch" }]`, "renders a navigation item per board and per folder", and the New-dashboard case also asserts `push` was called with `/dashboards`.

- [ ] **Step 4: Gates**

Run: `pnpm vitest run src/lib/folders src/components/folders src/components/command-palette.test.tsx src/app && pnpm typecheck && pnpm lint && pnpm build` → all green.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/dashboards/page.tsx" "src/app/(app)/dashboards/loading.tsx" "src/app/(app)/dashboards/loading.test.tsx" "src/app/(app)/dashboards/[dashboardId]/page.tsx" src/lib/folders/redirect.ts src/lib/folders/redirect.test.ts src/components/folders/FolderGallery.tsx src/components/folders/FolderGallery.test.tsx src/components/folders/UnfiledDashboards.tsx src/components/folders/UnfiledDashboards.test.tsx src/components/shell/command-palette-data.tsx src/components/command-palette.tsx src/components/command-palette.test.tsx
git commit -m "feat(folders): folder gallery at /dashboards, dashboard redirect and command palette entries"
```

---

### Task 13: "Your widgets" strip — folded-in dashboards on the Overview, Add widget / Generate with AI / attach

**Files:**

- Create: `src/components/folders/YourWidgets.tsx`
- Create: `src/lib/dashboards/board-options.ts` (extracted from `src/app/(app)/dashboards/[dashboardId]/page.tsx:26-70`)
- Modify: `src/app/(app)/dashboards/[dashboardId]/page.tsx` (use `buildBoardOptions`)
- Modify: `src/app/(app)/folders/[folderId]/page.tsx` (load dashboards + board options, pass `widgets`)
- Modify: `src/lib/ai/actions.ts:160-162` (`createDashboardFromProposalSchema` gains `folderId`), `src/lib/ai/actions.ts:179-260` (`createDashboardFromProposal` sets `folder_id` after creating), `src/lib/ai/actions.test.ts:331` (new case), `src/components/dashboards/ai/AiDashboardWizard.tsx:41-49` (optional `folderId` prop)
- Test: `src/lib/dashboards/board-options.test.ts`, `src/components/folders/YourWidgets.test.tsx`

**Interfaces:**

- Consumes: `DashboardCanvasLazy` (`src/components/dashboards/DashboardCanvasLazy.tsx`, props `{ initialData: DashboardCache; boards: BoardOption[] }`), `listFolderDashboards`, `listUnfiledDashboards`, `attachDashboardToFolder` (Task 5), `NewDashboardDialog` (Task 11), `AiDashboardWizard`, `BoardOption` (`src/components/dashboards/WidgetConfigForm`).
- Produces:

```ts
export function buildBoardOptions(
  boardRows: { id: string; name: string }[],
  allCols: {
    id: string;
    name: string;
    kind: string;
    settings: unknown;
    board_id: string;
  }[],
): BoardOption[];
export function YourWidgets(props: {
  folderId: string;
  workspaceId: string;
  dashboards: {
    dashboard: Tables<"dashboards">;
    widgets: Tables<"dashboard_widgets">[];
  }[];
  boards: BoardOption[];
  unfiled: { id: string; name: string }[];
}): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

`board-options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildBoardOptions } from "./board-options";

describe("buildBoardOptions", () => {
  it("groups columns per board by kind and keeps boards with no columns", () => {
    const opts = buildBoardOptions(
      [
        { id: "b1", name: "A" },
        { id: "b2", name: "B" },
      ],
      [
        {
          id: "c1",
          name: "Status",
          kind: "status",
          settings: { options: [{ id: "o1", label: "Done", color: "#0f0" }] },
          board_id: "b1",
        },
        {
          id: "c2",
          name: "Amount",
          kind: "numbers",
          settings: {},
          board_id: "b1",
        },
      ],
    );
    expect(opts).toHaveLength(2);
    expect(opts[0].statusColumns).toEqual([{ id: "c1", name: "Status" }]);
    expect(opts[0].numbersColumns).toEqual([{ id: "c2", name: "Amount" }]);
    expect(opts[0].allColumns[0].options).toEqual([
      { id: "o1", label: "Done", color: "#0f0" },
    ]);
    expect(opts[1].allColumns).toEqual([]);
  });
});
```

`YourWidgets.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/components/dashboards/DashboardCanvasLazy", () => ({
  DashboardCanvasLazy: (p: {
    initialData: { dashboard: { name: string } };
  }) => <div data-testid="canvas">{p.initialData.dashboard.name}</div>,
}));
vi.mock("@/components/dashboards/NewDashboardDialog", () => ({
  NewDashboardDialog: (p: { open: boolean; folderId?: string }) =>
    p.open ? <div data-testid="new-dialog">{p.folderId}</div> : null,
}));
vi.mock("@/components/dashboards/ai/AiDashboardWizard", () => ({
  AiDashboardWizard: (p: { open: boolean; folderId?: string }) =>
    p.open ? <div data-testid="ai-wizard">{p.folderId}</div> : null,
}));
vi.mock("@/lib/folders/actions", () => ({
  attachDashboardToFolder: vi.fn(async () => ({ ok: true, data: undefined })),
}));
import { attachDashboardToFolder } from "@/lib/folders/actions";
import { YourWidgets } from "./YourWidgets";

const dash = (id: string, name: string) => ({
  dashboard: {
    id,
    name,
    org_id: "o1",
    workspace_id: "w1",
    created_by: "u1",
    created_at: "",
    updated_at: "",
    folder_id: "f1",
  },
  widgets: [],
});

describe("YourWidgets", () => {
  it("renders one canvas section per folded-in dashboard, in the given order", () => {
    render(
      <YourWidgets
        folderId="f1"
        workspaceId="w1"
        dashboards={[dash("d1", "Ops"), dash("d2", "Sales")]}
        boards={[]}
        unfiled={[]}
      />,
    );
    expect(screen.getAllByTestId("canvas").map((c) => c.textContent)).toEqual([
      "Ops",
      "Sales",
    ]);
  });
  it("opens New dashboard and Generate with AI seeded with the folder id", () => {
    render(
      <YourWidgets
        folderId="f1"
        workspaceId="w1"
        dashboards={[]}
        boards={[]}
        unfiled={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));
    expect(screen.getByTestId("new-dialog")).toHaveTextContent("f1");
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
    expect(screen.getByTestId("ai-wizard")).toHaveTextContent("f1");
  });
  it("attaches an existing unfiled dashboard", async () => {
    render(
      <YourWidgets
        folderId="f1"
        workspaceId="w1"
        dashboards={[]}
        boards={[]}
        unfiled={[{ id: "d9", name: "Old" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Attach existing" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Old" }));
    expect(attachDashboardToFolder).toHaveBeenCalledWith({
      dashboardId: "d9",
      folderId: "f1",
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/lib/dashboards/board-options.test.ts src/components/folders/YourWidgets.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`src/lib/dashboards/board-options.ts` — move the `boards: BoardOption[] = (boardRows ?? []).map(...)` block from the dashboard page verbatim into:

```ts
import type { BoardOption } from "@/components/dashboards/WidgetConfigForm";
import { optionSchema } from "@/lib/validations/boards";

type ColRow = {
  id: string;
  name: string;
  kind: string;
  settings: unknown;
  board_id: string;
};

/** Source-board options for the Add-widget dialog (shared by the dashboard page and the folder strip). */
export function buildBoardOptions(
  boardRows: { id: string; name: string }[],
  allCols: ColRow[],
): BoardOption[] {
  return boardRows.map((b) => {
    const cols = allCols.filter((c) => c.board_id === b.id);
    const pick = (kind: string) =>
      cols
        .filter((c) => c.kind === kind)
        .map((c) => ({ id: c.id, name: c.name }));
    return {
      id: b.id,
      name: b.name,
      numbersColumns: pick("numbers"),
      statusColumns: pick("status"),
      dateColumns: pick("date"),
      peopleColumns: pick("people"),
      dropdownColumns: pick("dropdown"),
      percentColumns: pick("percent"),
      allColumns: cols.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        options:
          optionSchema
            .array()
            .safeParse((c.settings as { options?: unknown })?.options ?? [])
            .data ?? [],
      })),
    };
  });
}
```

(`BoardOption.allColumns[].kind` is `string` — `src/components/dashboards/WidgetConfigForm.tsx:24-29` — so no cast is needed.) Replace the inline block in `[dashboardId]/page.tsx` with `const boards = buildBoardOptions(boardRows ?? [], allCols ?? []);`.

`src/components/folders/YourWidgets.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { FolderInput, Plus, Sparkles } from "lucide-react";
import { DashboardCanvasLazy } from "@/components/dashboards/DashboardCanvasLazy";
import { NewDashboardDialog } from "@/components/dashboards/NewDashboardDialog";
import type { BoardOption } from "@/components/dashboards/WidgetConfigForm";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { attachDashboardToFolder } from "@/lib/folders/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import type { Tables } from "@/types/database.types";

const AiDashboardWizard = dynamic(
  () =>
    import("@/components/dashboards/ai/AiDashboardWizard").then(
      (m) => m.AiDashboardWizard,
    ),
  { ssr: false },
);

/**
 * Spec §5.2.7: the folder's folded-in dashboards, one canvas section each,
 * rendered through the existing DashboardCanvasLazy (same edit mode, config
 * sheet and batched getWidgetsData). Below the fold; the widget DATA loads
 * lazily exactly as it does on /dashboards/[id].
 */
export function YourWidgets({
  folderId,
  workspaceId,
  dashboards,
  boards,
  unfiled,
}: {
  folderId: string;
  workspaceId: string;
  dashboards: {
    dashboard: Tables<"dashboards">;
    widgets: Tables<"dashboard_widgets">[];
  }[];
  boards: BoardOption[];
  unfiled: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  function attach(dashboardId: string) {
    startTransition(async () => {
      const res = await attachDashboardToFolder({ dashboardId, folderId });
      if (!res.ok) {
        showMutationError(
          "Couldn't attach the dashboard.",
          new Error(res.error),
        );
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between" data-print-hide>
        <div>
          <Kicker>07</Kicker>
          <h2 className="text-sm font-semibold">Your widgets</h2>
        </div>
        <div className="flex gap-2">
          {unfiled.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="ghost">
                  <FolderInput className="size-4" /> Attach existing
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {unfiled.map((d) => (
                  <DropdownMenuItem key={d.id} onSelect={() => attach(d.id)}>
                    {d.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAiOpen(true)}
          >
            <Sparkles className="size-4" /> Generate with AI
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="size-4" /> New dashboard
          </Button>
        </div>
      </div>
      {dashboards.length === 0 ? (
        <EmptyState>
          No widgets yet. Add a dashboard to this folder, or generate one from a
          board.
        </EmptyState>
      ) : (
        dashboards.map(({ dashboard, widgets }) => (
          <div key={dashboard.id} className="rounded-lg border p-2">
            <DashboardCanvasLazy
              initialData={{ dashboard, widgets }}
              boards={boards}
            />
          </div>
        ))
      )}
      <NewDashboardDialog
        workspaceId={workspaceId}
        folderId={folderId}
        open={newOpen}
        onOpenChange={setNewOpen}
      />
      {aiOpen ? (
        <AiDashboardWizard
          workspaceId={workspaceId}
          folderId={folderId}
          open={aiOpen}
          onOpenChange={setAiOpen}
        />
      ) : null}
    </section>
  );
}
```

(`DashboardCache.widgets` is `CacheWidget[]` = `Tables<"dashboard_widgets">[]` — `src/lib/dashboards/cache.ts:4-11` — so `{ dashboard, widgets }` is assignable as-is.)

AI wizard: add `folderId?: string` to `AiDashboardWizard`'s props (`AiDashboardWizard.tsx:41-49`) and forward it in its `createDashboardFromProposal({ workspaceId, proposal, folderId })` call. In `src/lib/ai/actions.ts`:

```ts
// actions.ts:160 — the schema
const createDashboardFromProposalSchema = z.object({
  workspaceId: z.string().uuid(),
  folderId: z.string().uuid().optional(),
  proposal: z.object({/* unchanged */}),
});
// actions.ts:179 — the input type gains `folderId?: string`; destructure it with workspaceId/proposal.
// actions.ts — right after `const dashboardId = dashboard.id;`
if (folderId) {
  const { error: folderErr } = await supabase
    .from("dashboards")
    .update({ folder_id: folderId })
    .eq("id", dashboardId)
    .eq("workspace_id", workspaceId);
  if (folderErr) return fail(folderErr.message);
}
```

Add to `src/lib/ai/actions.test.ts` (inside the `describe("createDashboardFromProposal")` at line 331, using that suite's existing fake client) a case "sets folder_id on the new dashboard when folderId is given" that asserts an `update` with `{ folder_id: "<uuid>" }` filtered by `id` and `workspace_id` was issued, and one that asserts no update is issued without `folderId`.

`src/app/(app)/folders/[folderId]/page.tsx` — extend the page:

```tsx
const [dashboards, unfiled, { data: boardRows }, { data: allCols }] =
  await Promise.all([
    listFolderDashboards(supabase, folderId),
    listUnfiledDashboards(supabase, payload.folder.workspaceId),
    supabase
      .from("boards")
      .select("id, name")
      .eq("workspace_id", payload.folder.workspaceId)
      .is("archived_at", null)
      .order("position", { ascending: true }),
    supabase
      .from("columns")
      .select("id, name, kind, settings, board_id, boards!inner(workspace_id)")
      .eq("boards.workspace_id", payload.folder.workspaceId)
      .order("position", { ascending: true }),
  ]);
const boardOptions = buildBoardOptions(boardRows ?? [], allCols ?? []);
return (
  <CommandCenter
    payload={payload}
    widgets={
      <YourWidgets
        folderId={folderId}
        workspaceId={payload.folder.workspaceId}
        dashboards={dashboards}
        boards={boardOptions}
        unfiled={unfiled}
      />
    }
  />
);
```

(These four reads are the same ones `/dashboards/[id]` already does for the Add-widget dialog; they run after the payload wave and are bounded by workspace.)

- [ ] **Step 4: Gates**

Run: `pnpm vitest run src/lib/dashboards src/components/folders src/lib/ai/actions.test.ts && pnpm typecheck && pnpm lint && pnpm build` → all green; `no-recharts-in-first-paint` still green (the strip reaches only `DashboardCanvasLazy`, a `dynamic()` boundary).

- [ ] **Step 5: Commit**

```bash
git add src/components/folders/YourWidgets.tsx src/components/folders/YourWidgets.test.tsx src/lib/dashboards/board-options.ts src/lib/dashboards/board-options.test.ts "src/app/(app)/dashboards/[dashboardId]/page.tsx" "src/app/(app)/folders/[folderId]/page.tsx" src/lib/ai/actions.ts src/lib/ai/actions.test.ts src/components/dashboards/ai/AiDashboardWizard.tsx
git commit -m "feat(folders): your widgets strip folds dashboards into the overview"
```

---

### Task 14: Header extras — Share link, Export PDF (print stylesheet), Ask about this folder button

**Files:**

- Create: `src/components/folders/HeaderActions.tsx`
- Modify: `src/app/globals.css` (append an `@media print` block)
- Modify: `src/components/folders/CommandCenter.tsx` (Export PDF is Overview-only → `HeaderActions` needs the current tab; render it inside `CommandCenter` from the `tab` state rather than as an opaque `headerActions` node)
- Test: `src/components/folders/HeaderActions.test.tsx`, `src/app/print-styles.test.ts`

**Interfaces:**

- Consumes: `Button`, `toast` (`sonner`, as `src/lib/ui/mutation-toast.ts:1`), `useCommandCenterState` (Task 8), lucide `Link2`, `Printer`, `Sparkles`.
- Produces: `HeaderActions({ folderId, tab }: { folderId: string; tab: CommandTab }): JSX.Element` — Share copies `window.location.href`; Export PDF calls `window.print()` and is disabled off the Overview; Ask links to `/ask?folder=<id>`.
- `CommandCenterProps.headerActions` is dropped (Task 8 declared it optional; nothing else passes it) — `CommandCenter` renders `<HeaderActions folderId={payload.folder.id} tab={tab} />` itself.

- [ ] **Step 1: Write the failing tests**

`HeaderActions.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const toast = vi.fn();
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toast(...a) }));
import { HeaderActions } from "./HeaderActions";

describe("HeaderActions", () => {
  beforeEach(() => {
    toast.mockClear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
    window.print = vi.fn();
  });

  it("Share copies the current URL and toasts", async () => {
    render(<HeaderActions folderId="f1" tab="overview" />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      window.location.href,
    );
    expect(toast).toHaveBeenCalledWith("Link copied");
  });

  it("Export PDF prints on the Overview and is disabled elsewhere", () => {
    const { rerender } = render(<HeaderActions folderId="f1" tab="overview" />);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(window.print).toHaveBeenCalledTimes(1);
    rerender(<HeaderActions folderId="f1" tab="people" />);
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
  });

  it("Ask about this folder links to /ask?folder=", () => {
    render(<HeaderActions folderId="f1" tab="overview" />);
    expect(
      screen.getByRole("link", { name: "Ask about this folder" }),
    ).toHaveAttribute("href", "/ask?folder=f1");
  });
});
```

`src/app/print-styles.test.ts` (string test over the stylesheet, the way `globals.contrast.test.ts` reads it):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const print = css.split("@media print")[1] ?? "";

describe("print stylesheet (folder Overview export)", () => {
  it("exists and isolates the print root", () => {
    expect(print).toContain("[data-print-root]");
    expect(print).toMatch(/\[data-print-hide\][^}]*display:\s*none/);
  });
  it("hides the app chrome and keeps charts visible", () => {
    expect(print).toMatch(/aside|nav/);
    expect(print).toMatch(
      /\.recharts-surface[^}]*visibility:\s*visible|\[data-print-root\]\s*\*[^}]*visibility:\s*visible/,
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/folders/HeaderActions.test.tsx src/app/print-styles.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`HeaderActions.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Link2, Printer, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CommandTab } from "./command-center-state";

/** Spec §5.1 header extras. Export prints the Overview only; RLS gates the shared link. */
export function HeaderActions({
  folderId,
  tab,
}: {
  folderId: string;
  tab: CommandTab;
}) {
  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Link copied");
    } catch {
      toast("Couldn't copy the link");
    }
  }
  return (
    <div className="flex items-center gap-2" data-print-hide>
      <Button type="button" variant="outline" size="sm" onClick={share}>
        <Link2 className="size-4" /> Share
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={tab !== "overview"}
        onClick={() => window.print()}
        title={tab === "overview" ? undefined : "Switch to Overview to export"}
      >
        <Printer className="size-4" /> Export PDF
      </Button>
      <Button asChild size="sm">
        <Link href={`/ask?folder=${folderId}`}>
          <Sparkles className="size-4" /> Ask about this folder
        </Link>
      </Button>
    </div>
  );
}
```

`globals.css` — append:

```css
/* Folder command center → Export PDF (spec §5.1). Only the Overview's
   [data-print-root] region prints: chrome, tabs, filters and buttons carry
   [data-print-hide]; the charts are inline SVG (recharts) and print as-is. */
@media print {
  aside,
  nav,
  header,
  [data-print-hide] {
    display: none !important;
  }
  body * {
    visibility: hidden;
  }
  [data-print-root],
  [data-print-root] * {
    visibility: visible;
  }
  [data-print-root] {
    position: absolute;
    inset: 0;
    padding: 12mm;
    background: #fff;
    color: #000;
  }
  [data-print-root] .recharts-surface {
    visibility: visible;
  }
  [data-print-root] a {
    text-decoration: none;
    color: inherit;
  }
}
```

`CommandCenter.tsx`: replace the `headerActions` prop with `<HeaderActions folderId={payload.folder.id} tab={tab} />` passed as `PageHeader`'s `actions`; delete `headerActions` from `CommandCenterProps`.

- [ ] **Step 4: Gates + a real print check**

Run: `pnpm vitest run src/components/folders src/app/print-styles.test.ts && pnpm typecheck && pnpm lint` → green. Then `pnpm dev`, open a folder, press Export PDF, and confirm in the print preview that only the Overview panels (KPIs, chart, status bars, attention, milestones) appear, with the chart drawn.

- [ ] **Step 5: Commit**

```bash
git add src/components/folders/HeaderActions.tsx src/components/folders/HeaderActions.test.tsx src/components/folders/CommandCenter.tsx src/app/globals.css src/app/print-styles.test.ts
git commit -m "feat(folders): share link, export pdf print styles and ask entry on the header"
```

---

### Task 15: Ask folder scope — `/ask?folder=<id>` seeds a thread with the folder's boards

**Files:**

- Modify: `src/lib/ai/ask/persona.ts` (add `composeFolderScope`), `src/lib/ai/ask/persona.test.ts`
- Modify: `src/lib/ai/ask/conversation-actions.ts:95-180` (`createConversation` accepts `folderId`), `src/lib/ai/ask/conversation-actions.test.ts`
- Modify: `src/app/ask/page.tsx` (read `searchParams.folder`)
- Modify: `src/components/ai/ask/AskChat.tsx:69-110,254-258` (`folderId` prop, forwarded to `createConversation`)
- Modify: `src/app/api/ask/route.ts:104-115` (compose the folder scope), `src/app/api/ask/route.test.ts`

**Interfaces:**

- Consumes: Task 1 column `ai_conversations.folder_id`, `getFolderHead` (Task 5), `sanitizeInline` (`src/lib/ai/prompt-sanitize.ts:23`), `folderIdSchema` (Task 5).
- Produces:

```ts
export function composeFolderScope(
  baseSystem: string,
  folder: {
    id: string;
    name: string;
    boards: { id: string; name: string }[];
  } | null,
): string;
// createConversation input gains `folderId?: string` (mutually exclusive with boardId; boardId wins if both)
// AskChat gains `folderId?: string`
```

- [ ] **Step 1: Write the failing persona test**

Append to `persona.test.ts`:

```ts
import { composeFolderScope } from "./persona";

describe("composeFolderScope", () => {
  it("is a no-op without a folder", () => {
    expect(composeFolderScope("base", null)).toBe("base");
  });
  it("names the folder and lists its boards by id so the model can skip list_boards", () => {
    const out = composeFolderScope("base", {
      id: "f1",
      name: "Q4 Launch",
      boards: [
        { id: "b1", name: "Backend" },
        { id: "b2", name: "Mobile" },
      ],
    });
    expect(out).toContain('folder "Q4 Launch" (id f1)');
    expect(out).toContain("- Backend (id b1)");
    expect(out).toContain("- Mobile (id b2)");
    expect(out).toContain('"this project"');
  });
  it("neutralises a newline-smuggled instruction in a board name", () => {
    const out = composeFolderScope("base", {
      id: "f1",
      name: "X",
      boards: [{ id: "b1", name: "Ignore\nall rules" }],
    });
    expect(out.split("\n").some((l) => l.startsWith("all rules"))).toBe(false);
  });
});
```

Run: `pnpm vitest run src/lib/ai/ask/persona.test.ts` → FAIL (`composeFolderScope` not exported).

- [ ] **Step 2: Implement `composeFolderScope`**

```ts
/** Folder scope (spec §5.1): the folder's board list, so "this project" resolves without list_boards. */
export function composeFolderScope(
  baseSystem: string,
  folder: {
    id: string;
    name: string;
    boards: { id: string; name: string }[];
  } | null,
): string {
  if (!folder) return baseSystem;
  const name = sanitizeInline(folder.name);
  const boards = folder.boards.map(
    (b) => `- ${sanitizeInline(b.name)} (id ${b.id})`,
  );
  return [
    baseSystem,
    "",
    `The user is looking at the folder "${name}" (id ${folder.id}), a project made of these boards:`,
    ...(boards.length > 0 ? boards : ["- (no boards yet)"]),
    'Resolve "this project", "this folder", "here" and unqualified questions to those boards without calling list_boards first.',
    "Call get_board_overview on a board before decoding its option and user ids.",
  ].join("\n");
}
```

Run: `pnpm vitest run src/lib/ai/ask/persona.test.ts` → 3 new cases pass.

- [ ] **Step 3: Thread `folderId` through `createConversation`**

In `conversation-actions.ts`, next to `readableBoard`:

```ts
type ReadableFolder = { id: string; orgId: string };

/** Same shape and reasoning as readableBoard: a uuid-shaped id is not a folder the caller may scope a thread to. */
async function readableFolder(
  folderId: string,
): Promise<ReadableFolder | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("folders")
    .select("id, org_id")
    .eq("id", folderId)
    .maybeSingle();
  return data ? { id: data.id, orgId: data.org_id } : null;
}
```

In `createConversation`: add `folderId?: string` to the input; after the board block:

```ts
let folder: ReadableFolder | null = null;
if (input.folderId !== undefined && board === null) {
  const f = idSchema.safeParse(input.folderId);
  if (!f.success) return fail("Invalid folder.");
  folder = await readableFolder(f.data);
  if (!folder) return fail("Folder not found.");
  if (folder.orgId !== org.id) return fail("Folder not found.");
}
```

and add `folder_id: folder?.id ?? null` to the `ai_conversations` insert. Add to `conversation-actions.test.ts` (using that file's existing client stub and `resolveActiveOrg` mock): "stores folder_id for a readable folder in the active org", "rejects a folder from another org", "boardId wins when both are given". Also add `folder_id` to the `.select("summary, summarized_upto, board_id, agent_id, user_id")` in `route.ts:104` → `"summary, summarized_upto, board_id, folder_id, agent_id, user_id"`.

- [ ] **Step 4: Compose the scope in the route**

`route.ts`, after the `if (conv.data.board_id) {…}` block:

```ts
if (!conv.data.board_id && conv.data.folder_id) {
  // RLS-scoped read: a folder the caller can no longer see degrades to plain Ask.
  const head = await getFolderHead(supabase, conv.data.folder_id);
  system = composeFolderScope(
    system,
    head
      ? {
          id: head.folder.id,
          name: head.folder.name,
          boards: head.boards.map((b) => ({ id: b.id, name: b.name })),
        }
      : null,
  );
}
```

Add a `route.test.ts` case mirroring the existing board-scope case: a conversation row with `folder_id` set makes the system prompt passed to `askPulseStream` contain `folder "` and the board list.

- [ ] **Step 5: `/ask?folder=` and `AskChat`**

`src/app/ask/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth/session";
import { listOwnerAgentTargets } from "@/lib/ai/ask/owner-agents";
import { createClient } from "@/lib/supabase/server";
import { getFolderHead } from "@/lib/folders/queries";
import { folderIdSchema } from "@/lib/validations/folders";
import { AskChat } from "@/components/ai/ask/AskChat";

export default async function NewAskPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string | string[] }>;
}) {
  const user = await requireUser();
  const raw = (await searchParams).folder;
  const parsed = folderIdSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  const [agents, head] = await Promise.all([
    listOwnerAgentTargets(user.id),
    parsed.success
      ? createClient().then((s) => getFolderHead(s, parsed.data))
      : Promise.resolve(null),
  ]);
  return (
    <AskChat
      conversationId={null}
      initialMessages={[]}
      agents={agents}
      folderId={head?.folder.id}
      title={head ? `Ask about ${head.folder.name}` : "New chat"}
    />
  );
}
```

(Keep the existing docblock; add one sentence: "`?folder=<id>` scopes the first message to that folder's boards — the folder head is one indexed read, RLS-filtered, and a hidden folder falls back to a plain chat.")

`AskChat.tsx`: add `folderId?: string` to the props (docblock: "Folder this thread belongs to. Set by the command center's Ask button; absent otherwise."), and in the `createConversation` call: `...(boardId ? { boardId } : folderId ? { folderId } : {})`.

- [ ] **Step 6: Gates**

Run: `pnpm vitest run src/lib/ai/ask src/app/api/ask src/app/ask src/components/ai/ask && pnpm typecheck && pnpm lint && pnpm build` → green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/ask/persona.ts src/lib/ai/ask/persona.test.ts src/lib/ai/ask/conversation-actions.ts src/lib/ai/ask/conversation-actions.test.ts src/app/ask/page.tsx src/components/ai/ask/AskChat.tsx src/app/api/ask/route.ts src/app/api/ask/route.test.ts
git commit -m "feat(ask): folder scope via /ask?folder= and ai_conversations.folder_id"
```

---

## Execution DAG

Dependency edges, read off the `Interfaces` blocks:

- Task 1 → Tasks 2, 3 (tables the RPCs read), Task 5 (generated types), Task 11 (copy-forward target), Task 15 (`ai_conversations.folder_id`)
- Task 2 → Task 3 (`_folder_item_flags`, `_assert_folder_member`), Task 5
- Task 3 → Task 5
- Task 4 → Tasks 5, 6, 7, 8, 9, 10 (`types.ts`, `stages.ts`, `rollup.ts`, fixture)
- Task 5 → Tasks 9 (`getFolderWorkload`), 10, 11, 12, 13, 15
- Tasks 6, 7 → Task 8 (charts used by Overview); Task 7 → Task 9
- Task 8 → Tasks 9, 10, 14
- Task 9 → Task 10
- Task 10 → Task 13 (page edit)
- Task 11 → Tasks 12, 13 (`NewDashboardDialog`, sidebar without `DashboardsNav`)
- Task 12 ↔ Task 13 touch different files; both depend on 11

Waves (one worktree per task, cut from the shared `task/<name>` branch; **the orchestrator merges each wave serially — Tasks 1, 2, 3, 11 regenerate `src/types/database.types.ts` and must never race**):

| Wave | Tasks                      | Notes                                                                                                                               |
| ---- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **1**, **4**, **6**, **7** | 4/6/7 are pure and touch no shared file. Task 1 is the only migration in the wave.                                                  |
| 2    | **2**                      | Migration + types; lands alone.                                                                                                     |
| 3    | **3**                      | Migration + types; lands alone (its test copies Task 2's helpers, so 2 must be merged first).                                       |
| 4    | **5**, **8**               | 5 needs all three migrations' types; 8 needs 4/6/7 only — they run concurrently.                                                    |
| 5    | **9**, **14**              | 9 needs 5 + 8; 14 needs 8 only. Both edit `CommandCenter.tsx` — 14 edits the header line, 9 the tab switch; rebase order 9 then 14. |
| 6    | **10**, **11**, **15**     | 10 needs 5 + 8 + 9; 11 needs 1 + 5 (migration + types — lands alone within the wave, merged first); 15 needs 1 + 5.                 |
| 7    | **12**, **13**             | Both need 11; 13 also needs 10. Disjoint files.                                                                                     |

Critical path: 1 → 2 → 3 → 5 → 9 → 10 → 13 (seven steps; the three serial migrations are the wall-clock floor). Unit 3 (Tasks 6, 7) and Unit 2's pure half (Task 4) start at t=0 alongside Task 1, exactly as spec §9 asks.

Implementers gate (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`) and commit by path; they never run `finish-task.sh`, merge or push. A whole-branch review runs before the merge to `develop` (cross-task defects survive per-task reviews on every feature of this size).

## Performance & data-fetching budget (working agreement #5, spec §6)

**First paint of `/folders/[id]`** — one RSC render (Task 10 `buildFolderPayload`, Task 13 page):

| Wave                 | Call                                                                     | Client                          | Bound / index                                                                                          |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A (concurrent)       | `folders` head + `folder_boards!inner(boards)`                           | RLS                             | PK; `folder_boards_folder_position_idx`, ≤ 100 boards                                                  |
| A                    | `folder_rollup(folder_id)`                                               | RLS (RPC gates on `auth.uid()`) | boards × groups; `items_board_id_idx`, `groups_board_id_idx`, `cell_values` PK                         |
| A                    | `folder_burn(folder_id)`                                                 | RLS                             | stages × ≤ 104 weeks                                                                                   |
| A                    | `folder_attention(folder_id, 20)`                                        | RLS                             | `LIMIT 20` inside SQL                                                                                  |
| B (after A)          | `board_intelligence_runs` latest per board                               | RLS                             | ≤ 25 indexed LIMIT-1 reads, one per board (`BRIEF_BOARDS_LIMIT`), `board_intelligence_runs_lookup_idx` |
| B                    | `listOrgMembersCached(orgId)`                                            | service, `use cache`            | warm from the shell                                                                                    |
| C (Task 13, after A) | `dashboards(*, dashboard_widgets(*))` where `folder_id`                  | RLS                             | `dashboards_folder_idx`, `LIMIT 10`                                                                    |
| C                    | unfiled dashboards; workspace boards + columns for the Add-widget dialog | RLS                             | same reads `/dashboards/[id]` already does                                                             |

Widget DATA for the strip loads lazily below the fold through the existing batched `getWidgetsData` (unchanged).

**Interactions with 0 new round-trips** — enforced by `src/components/folders/CommandCenter.test.tsx` ("switching tab and stage costs zero server calls and only touches history.replaceState": spies on `getFolderWorkload`, `router.push`, `router.refresh`) and `command-center-state.test.tsx` (`pushState` never called): tab switch between Overview/Stages/Boards, stage chips, board dropdown, chart cumulative/weekly, Boards-tab sort, stage card select, matrix header select.

**People tab:** `folder_workload` once on first open via `getFolderWorkload` → TanStack Query `staleTime: 60_000` (`People.test.tsx` asserts one call across a stage switch).

**Legitimate server round-trips** (they change or newly request server data): inline Retry (`router.refresh()`), merge-into-stage (`renameGroup` + refresh), attach dashboard, create dashboard, folder CRUD, opening an item (`/boards/[id]?item=` is a different page).

**Gallery `/dashboards`:** `folder_gallery(workspace_id)` + one bounded unfiled read + the cached folder list.

**Caching:** folder nav list is `"use cache"` + `cacheTag(foldersTag(orgId))` on the service client (Task 5), invalidated by every folder action; rollup/burn/attention/workload/gallery are per-request on the RLS client because the RPCs gate on `auth.uid()` (`src/lib/dashboards/queries-cached.ts:35-55`).

**Bundle:** `src/components/folders/no-recharts-in-first-paint.test.ts` keeps recharts and `BurnChartInner` out of everything statically reachable from `CommandCenter.tsx`.

## How to test this (manual, on the DEV deployment or `pnpm dev` against DEV)

Setup: pull `develop`, `pnpm install`, `pnpm dev`, sign in to an org whose active workspace has at least two boards with a Status column (default options Working on it / Stuck / Done), a Date column and an Owner column, and a few items with due dates.

1. **Sidebar** → Boards section → click the **+ folder** icon → name it "Q4 Launch" → the folder row appears (empty folders now show) and its name is a link.
2. On a board row's **⋯ → Move to folder → Q4 Launch**; repeat for a second board. Both nest under the folder. Try filing a board from another workspace via a stale menu: the toast says it was refused.
3. Click the folder name → `/folders/<id>` opens: header with the folder name and a `SNAPSHOT <time> · live` chip; tabs Overview · Stages n · Boards n · People; filter bar with stage chips (if your boards' groups share names, they merge into one chip) and a mono hint like `26 items · 2 boards`.
4. **Overview**: six KPI cards (Complete %, Gap to plan with behind/ahead, Overdue with oldest age, Due this week, Blocked = items whose status is Stuck, Stale); Planned vs completed chart with a dashed planned line, filled completed area, a red Today marker and a red wedge where planned exceeds completed; toggle Cumulative/Weekly — the URL and page do not reload; Status by board bars; Needs attention list; Intelligence panel only if you have run "Catch me up" on one of the boards; Next milestones.
5. Click a stage chip → every number recalculates instantly; the URL gains `?stage=<name>` with no page reload (watch the Network tab: no `/folders` request). Reload the page — the same stage is selected.
6. **Stages tab**: one card per stage with COMPLETE / IN FLIGHT / UPCOMING; clicking a card selects that stage; the Stage × board matrix shows % badges (green ≥ 90, blue ≥ 50, yellow ≥ 25, gray) and "—" where a board lacks the group; the carry-over line reads "N open items in stages that are complete on another board".
7. **Boards tab**: table with a health pill per board; Sort by Health / Size / A–Z re-orders without a reload; row name links to the board. If one board has a group no other board shares, it is listed under "Stages on only one board" with **Merge into stage…** — pick a stage: the group is renamed on that board (check the board) and the stage chips merge.
8. **People tab**: first open shows a skeleton then Workload bars (red above 15 open items, "n late"), Who owns what, Unassigned; switching stage chips filters the bars without another request (Network tab: one `getFolderWorkload` action total).
9. Click an item in Needs attention → the board opens with that item's panel already open (`?item=`).
10. **Share** → toast "Link copied"; paste it in a new tab — same folder, same tab/stage. **Export PDF** (Overview only; disabled on other tabs) → the print preview shows only the Overview panels, chart included. **Ask about this folder** → `/ask?folder=<id>` opens titled "Ask about Q4 Launch"; ask "what is late in this project?" — the answer names your boards without listing all boards first.
11. `/dashboards` → the folder gallery: one card per folder (done %, overdue, attention counts; "No boards yet" for empty ones) and an **Unfiled dashboards** section. Any dashboard you had that only sourced boards now in Q4 Launch is already attached (backfill) and absent from Unfiled. Attach an unfiled dashboard to Q4 Launch via **Attach** → it disappears from Unfiled.
12. Open `/dashboards/<that dashboard id>` directly → you are redirected (307) to `/folders/<id>?tab=overview#widgets` and land on the **Your widgets** strip; Edit / Add widget / the config sheet work as before. **New dashboard** here creates one already attached to the folder; **Generate with AI** creates one attached to the folder.
13. ⌘K → type the folder name → "Q4 Launch — command center" navigates to it; "New dashboard" goes to `/dashboards` and opens the dialog.
14. Folder **⋯ → Rename / Delete** in the sidebar: rename updates the header on the next load; delete removes the folder, boards reappear unfiled, the folder's dashboards move to Unfiled (nothing is destroyed).
15. Regression check: your old private folders are present as shared folders (same names, first-seen casing), visible to every workspace member — the accepted trap from spec §3.2.
