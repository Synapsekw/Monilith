# Folder Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inviting a person to a folder (an org member, or anyone by email) gives them viewer or editor access to every board in that folder, including boards added later; an outside invitee joins as a guest and sees only their folders.

**Architecture:** One `folder_members` row is the grant. The four SQL access helpers (`can_read_board`, `can_edit_board`, `readable_board_ids`, `is_board_member`) keep their names and gain a folder path, so the 68 policies and 27 functions that call them inherit it without edits. Email invites ride the existing `org_invitations` + `redeem_invitations` flow with role `guest`. The TypeScript copies of the access rule read the caller's folder level through one new RPC.

**Tech Stack:** Next.js 16 App Router, Server Actions, Supabase Postgres (RLS, `security definer` SQL), Zod, Vitest, shadcn/ui, Tailwind v4.

Spec: `docs/superpowers/specs/2026-11-14-folder-invites-design.md`

## Global Constraints

- The live deployment (`www.monolith.works`) runs the **DEV** database `hjqcahbbbdaknbbnfnvl`. A migration applied to DEV is live for real users at once. No destructive experiments.
- Migrations are minted only with `scripts/new-migration.sh <slug>`. Never hand-write a version stamp.
- A migration is applied to DEV through the `supabase-dev` MCP `apply_migration` with the **same version and name** as the committed file, then verified with `pnpm db:ledger-check`. **Only the orchestrator applies** (Task 3). Implementers never call `apply_migration` and never run DDL through `execute_sql`.
- In a worktree `pnpm db:types` fails. Regenerate types with the `supabase-dev` MCP `generate_typescript_types`, write the result to `src/types/database.types.ts`, then `pnpm prettier --write src/types/database.types.ts`. Never hand-edit that file.
- Every new SQL function: `revoke execute ... from public, anon`. Functions whose name starts with `_`, and trigger functions, are also revoked from `authenticated`.
- Server Actions return `ActionResult` / `fail` imported from `src/lib/actions/result.ts`. RPC calls go through `typedRpc` from `src/lib/supabase/typed-rpc.ts`. Never redeclare either.
- A `"use server"` file exports only async functions. Types and constants live in a sibling file.
- UI tasks (Task 4 dialog part, Task 7) load the `pulse-ui` and `frontend-design` skills before writing any component. Semantic tokens only, no raw Tailwind colours, no box shadows.
- The product is called Monolith. The word "Pulse" never appears in user-facing copy.
- Commit subjects are lower-case, conventional-commit form, header under 100 characters. Stage by path only (`git add <paths>`); never `git add -A`, `git add .` or `git commit -a`.
- Implementers never run `scripts/finish-task.sh`, never merge, never push.
- Run tests in the foreground with a 600000 ms timeout. Never background `pnpm test`.
- Do not edit `src/components/folders/tabs/Timeline*.tsx`, `src/lib/folders/timeline.ts`, `src/components/boards/gantt/*`, `src/components/folders/FilterBar.tsx`. They belong to `task/timeline-readability`.
- Error copy, verbatim: "Only the folder's creator or an admin can invite people", "That person already has access", "Enter a valid email address".

## Deviations from spec

Each of these is a place where the spec, read against the code, was wrong, incomplete or needed a different mechanism. The plan implements the closest correct thing.

1. **`_folder_board_level` takes two arguments, `(p_board_id, p_user_id)`.** The spec gave it one. `_owner_board_level(p_board_id, p_owner)` (`supabase/migrations/20261113164732_mono_board_membership.sql:17`) resolves a level for an explicit owner, not for `auth.uid()`, so the folder lookup needs the user as a parameter.
2. **The "moving a board exposes it" rule is a trigger on `folder_boards`, not a change to `folder_accepts_board`.** `moveBoardToFolder` upserts on the `board_id` primary key (`src/lib/folders/actions.ts:159-166`), so a move between folders is an `UPDATE`, and a reorder inside a folder is also an `UPDATE`. A policy cannot tell them apart; a trigger comparing `old.folder_id` with `new.folder_id` can. The trigger also covers **taking a board out** of a folder that has members (which removes access for everyone), which the spec did not mention.
3. **Deleting a folder that has members is limited to the folder's creator and org owners and admins.** Today any org member can delete any folder (`folders: delete if member`). The spec restricted only guests. Deleting a shared folder removes access for all its members, so it follows the same rule as managing them.
4. **Redemption runs in three places, not one.** Besides `redeem_invitations()`, an existing account accepts an org invitation in-app through `accept_invitation(p_invite_id)` and can refuse through `decline_invitation(p_invite_id)` (live definitions read from DEV on 2026-11-14). All three now handle folder invitations.
5. **The member directory stays readable by guests.** `org_members: read if member` and `profiles: read self or co-members` are not confined. Board people cells, assignee pickers, authors and mentions resolve names from the org roster (`src/lib/monos/board-roster.ts:20-26`, `src/lib/folders/payload.ts:53`). Confining them breaks name rendering on the boards a guest was given. A guest can therefore see the names and roles of the org's members. `workspaces`, `organizations` and `monos` reads are also left as they are; the shell needs the first two.
6. **Guest confinement of the other org-wide surfaces is a second migration (Task 2)**, and it blocks guests from creating boards, workspaces, dashboards, goals, portfolios and reports with a `before insert` trigger rather than by rewriting `create_board`, `create_board_from_template`, `create_dashboard` and `duplicate_dashboard`.
7. **Guests do not get the Goals, Portfolios, Reports and Workload links** (Task 7 Step 7). The spec did not ask for it; the pages are empty for a guest after Task 2, and the role is already in the sidebar loader after Task 5, so the links are removed at no extra query.
8. **Sequencing:** the spec said the dialog (U5) could start alongside the RPCs (U2). Here it starts after the Server Actions (Task 6) and the sidebar loader change (Task 5), because it imports the first and its nav step edits the file the second owns.
9. **The board share dialog loads its "through folder" rows when it opens**, through a Server Action, instead of receiving them from the board page. Share grants reach that dialog through five components and seven `<BoardHeader>` call sites (`BoardViews.tsx:252-279` and the four view components); a second prop threaded the same way would also add a read to every board's first paint for a dialog only owners open (`BoardHeader.tsx:370`).
10. **Two more org-wide folder leaks are closed that the spec did not list.** The `folder_gallery` RPC is `security definer` and returned every folder in the workspace to any org member (`20260915112812_folder_burn_workload_gallery.sql`; live body read from DEV). And `listFoldersCached` (service client) has two more callers besides the sidebar: the command palette (`src/components/shell/command-palette-data.tsx:22`) and the folder gallery page (`src/app/(app)/dashboards/page.tsx:31`). Task 1 fixes the RPC; Task 5 Step 6b fixes the callers.
11. **One pre-existing service-client hole is closed on the way.** `previewAiStep` ("Test this step") reads a board's newest item with the service client and checks only the active org (`src/lib/ai/agentic/actions.ts:59-72`). Any org member could read it for a board they cannot open; with guests in the org that matters more. Task 4 Step 12 adds the caller's own access check.

## Facts verified on 2026-11-14

- **Guests today:** 3 `org_members` rows have role `guest`, in 3 different orgs, all active. Those 3 orgs hold 0 folders, 0 boards, 0 goals, 0 portfolios, 0 dashboards and 0 reports. The guest rules in Tasks 1 and 2 remove nothing any current guest can see.
- **Mono bot grants are copied rows.** A bot holds its own `board_members` row, written by `add_my_mono_to_board`, forced to its owner's level by `board_members_guard_mono` and kept in step by `board_members_follow_owner`. Both call `_owner_board_level`. There is 1 Mono and 0 bot `board_members` rows on DEV. Task 1 teaches `_owner_board_level` the folder path and adds triggers on `folder_members` and `folder_boards` so a bot's row follows its owner's folder access.
- **`inviteUserByEmail` and a second invite:** for an address that already has an auth account the call returns "already registered" and sends nothing (`src/lib/org/admin-actions.ts:140-153` swallows exactly that error). A second folder invite to a still-pending address therefore sends no second email. `inviteToFolder` returns `emailSent` so the dialog can say which happened.
- **Role changes the matrix makes are allowed.** `tg_org_members_guard_agent` (live body read from DEV) refuses only a change to or from `agent`, and a person row for a profile flagged `is_agent`. The matrix moves a plain `member` to `guest` and back, which it permits.
- **Rollups, search and Ask are already gated by board access** (Task 2 Steps 5 and 6 give the file:line evidence). The one exception, `previewAiStep`, is fixed in Task 4 Step 12.
- **Integration suites never run against DEV.** They need a dedicated test project and a `.env.test` with `PULSE_TEST_DB=1`; that project gets migrations by `supabase db push`, by hand (`CONTRIBUTING.md:289-312`). There is no `.env.test` on this machine, so Task 8's suite is written and skips.
- `folder_rollup` takes exactly `(p_folder_id uuid)`; `create_board` takes `(p_workspace_id uuid, p_name text)` (live `pg_proc`).
- `_assert_folder_member` is called by exactly `folder_attention`, `folder_burn`, `folder_rollup`, `folder_timeline`, `folder_workload`.
- `org_invitations` has the partial unique index `org_invitations_pending_uq (org_id, lower(email)) where status = 'pending'`; `invited_by` is `not null`.

## Guest-reachable surfaces

| Surface                                                                                                | Gate today                                    | Disposition                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Folders, folder layouts                                                                                | org membership                                | Task 1                                                                                                                    |
| Folder RPCs (`folder_rollup`, `folder_burn`, `folder_attention`, `folder_workload`, `folder_timeline`) | `_assert_folder_member` = org membership      | Task 1                                                                                                                    |
| Sidebar folder list                                                                                    | service client, org-wide                      | Task 5                                                                                                                    |
| Goals, goal links                                                                                      | `org_id in auth_user_orgs()`                  | Task 2                                                                                                                    |
| Portfolios, portfolio boards                                                                           | `org_id in auth_user_orgs()`                  | Task 2                                                                                                                    |
| Dashboards, dashboard widgets                                                                          | `org_id in auth_user_orgs()`                  | Task 2 (guest reads only dashboards attached to their folders)                                                            |
| Reports                                                                                                | `is_org_member(org_id)`                       | Task 2                                                                                                                    |
| Workload (`member_capacity`, `org_workload_settings`, `time_allocations`)                              | `org_id in auth_user_orgs()`                  | Task 2 (a guest still reads their own `time_allocations`)                                                                 |
| Creating boards, workspaces, dashboards, goals, portfolios, reports                                    | org membership                                | Task 2 (insert trigger)                                                                                                   |
| `goals_rollup`, `portfolio_rollup`, `workload_rollup`                                                  | definer, each filters on `can_read_board`     | Already gated by board access, verified at `20260707140000_soft_delete_archived_at.sql:632`, `:507`, `:573`               |
| Folder gallery RPC (`folder_gallery`)                                                                  | definer, org membership                       | Task 1 (adds `can_see_folder`)                                                                                            |
| Folder names in the command palette and on the gallery page                                            | `listFoldersCached`, service client           | Task 5 Step 6b                                                                                                            |
| Search (`search_items`, `match_items`)                                                                 | `SECURITY INVOKER` on the caller's RLS client | Already gated by board access, verified at `src/lib/search/item-search.ts:36-37`, `src/lib/ai/embeddings/search.ts:89-90` |
| Ask (`/api/ask`) and the MCP tool catalog                                                              | caller's RLS client (or the Mono's own)       | Already gated by board access, verified at `src/app/api/ask/route.ts:131`, `:278-280`, `src/lib/mcp/context.ts:50-70`     |
| "Test this step" automation preview                                                                    | service client, active org only               | Task 4 Step 12                                                                                                            |
| Planning nav links (Goals, Portfolios, Reports, Workload)                                              | shown to everyone                             | Task 7 Step 7                                                                                                             |
| Notifications                                                                                          | `recipient_id = auth.uid()`                   | Already confined to the recipient, verified in live `pg_policies`                                                         |
| Board data (items, cells, updates, files, activity, automations)                                       | `can_read_board` family                       | Already gated by board access; Task 1 extends the helpers                                                                 |
| Member directory, profiles, workspaces, organizations, Monos list                                      | org membership                                | Not confined, see Deviation 5                                                                                             |

## Performance and data-fetching budget

- **First paint:** the folder page adds one read of `folder_members` for the avatar stack (indexed on `folder_id`, capped at 50 rows, with a count) and one `can_manage_folder` call, both in the existing wave A. The dialog's full list and pending invitations load when the dialog opens. The board page adds one `my_folder_board_levels` call to its existing parallel wave; the board share dialog's "through folder" rows load when that dialog opens. The sidebar adds one cached read (`getFolderAccessForUserCached`) to its existing parallel wave.
- **Interactions:** opening the dialog and searching members make no navigation. Invite, level change and remove are Server Actions with targeted tag invalidation; no `router.push`.
- **Hot path:** `can_read_board` gains one primary-key read on `folder_boards` and one on `folder_members (folder_id, user_id)`. `readable_board_ids` gains one index scan on `folder_members (user_id, folder_id)` joined to `folder_boards`.
- **Stop condition:** Task 3 captures `explain analyze` execution time for the board item read and for `folder_rollup` on the largest folder, before and after, on DEV. If either is more than 10% slower after, stop and do not apply.

## File Structure

| File                                                                                                                         | Responsibility                                                       | Task |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---- |
| `supabase/migrations/<stamp>_folder_invites.sql`                                                                             | tables, access rule, folder visibility, RPCs, redemption, bot follow | 1    |
| `supabase/migrations/<stamp>_guest_confinement.sql`                                                                          | guest read and create rules on org-wide surfaces                     | 2    |
| `docs/superpowers/plans/folder-invites-access-matrix.sql`                                                                    | rolled-back verification script                                      | 1    |
| `src/types/database.types.ts`                                                                                                | regenerated                                                          | 3    |
| `src/lib/cache/tags.ts`                                                                                                      | `folderMembersTag`                                                   | 3    |
| `src/lib/boards/folder-levels.ts`                                                                                            | caller's folder level per board                                      | 4    |
| `src/lib/boards/queries.ts`                                                                                                  | `higherAccess`, `deriveBoardAccess`, `getBoardAccessCore`            | 4    |
| `src/app/(app)/boards/[boardId]/page.tsx`, `src/lib/reports/core.ts`, `src/lib/reports/access.ts`                            | pass the folder level                                                | 4    |
| `src/lib/boards/sharing-actions.ts`, `src/components/boards/ShareBoardDialog.tsx`                                            | read-only "through folder" rows, loaded on open                      | 4    |
| `src/lib/ai/agentic/actions.ts`                                                                                              | caller's access check on "Test this step"                            | 4    |
| `src/lib/boards/shared-merge.ts`                                                                                             | merge direct and folder-derived shared boards                        | 5    |
| `src/lib/boards/queries-cached.ts`, `src/lib/boards/queries.ts` (`listSharedBoards`), `src/lib/portfolios/queries-cached.ts` | folder path in the service-client copies                             | 5    |
| `src/lib/folders/access-cached.ts`, `src/lib/folders/nav-filter.ts`, `src/components/shell/sidebar-nav-data.tsx`             | guest folder filter and placement leak fix                           | 5    |
| `src/components/shell/command-palette-data.tsx`, `src/app/(app)/dashboards/page.tsx`                                         | guest folder filter on the other two `listFoldersCached` callers     | 5    |
| `src/lib/validations/folder-sharing.ts`, `src/lib/folders/sharing-types.ts`, `sharing-queries.ts`, `sharing-actions.ts`      | Server Actions and their data                                        | 6    |
| `src/lib/folders/actions.ts`, `payload.ts`, `types.ts`, `fixture.ts`                                                         | move/delete invalidation, confirm, access head                       | 6    |
| `src/components/folders/ShareFolderDialog.tsx`, `HeaderActions.tsx`, `CommandCenter.tsx`                                     | dialog and header entry                                              | 7    |
| `src/components/boards/BoardFolderMenu.tsx`                                                                                  | sidebar "Share folder…" entry                                        | 7    |
| `src/components/boards/move-to-folder.tsx`, `MoveToFolderMenu.tsx`, `BoardsNavSortable.tsx`, `BoardsNav.tsx`                 | one confirm host for menu and drag moves                             | 7    |
| `src/components/shell/sidebar-nav.tsx`                                                                                       | planning links hidden for guests                                     | 7    |
| `src/lib/folders/folder-members.rls.integration.test.ts`                                                                     | RLS integration suite                                                | 8    |

## Execution DAG

**Dependency graph**

- Task 1 (U1 + U2, SQL) depends on nothing.
- Task 2 (guest confinement SQL) depends on Task 1 (uses `is_org_guest`, `is_folder_member`).
- Task 3 (dry run, apply, types; orchestrator) depends on Tasks 1 and 2.
- Task 4 (U3 board access copies + U6) depends on Task 3.
- Task 6 (U4 Server Actions) depends on Task 3.
- Task 8 (RLS integration suite) depends on Task 3.
- Task 5 (U3 sidebar and caches) depends on Task 4 (both edit `src/lib/boards/queries.ts`).
- Task 7 (U5 dialog and entry points) depends on Task 6 (imports its actions) and Task 5 (its nav step edits `sidebar-nav-data.tsx`, which Task 5 changes).
- Task 9 (gates and whole-branch review) depends on Tasks 4 to 8.
- Task 10 (live run) depends on Task 9. Task 11 (finish) depends on Task 10.

**Parallel batches**

| Batch | Tasks                                   | Worktrees                                                                                                                                        |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Task 1                                  | `task/folder-invites` itself                                                                                                                     |
| 2     | Task 2                                  | `task/folder-invites` itself                                                                                                                     |
| 3     | Task 3 (orchestrator, no subagent)      | `task/folder-invites` itself                                                                                                                     |
| 4     | Tasks 4, 6, 8 in parallel               | one worktree each, cut from `task/folder-invites` after Task 3 is committed; the orchestrator rebases and fast-forward merges them one at a time |
| 5     | Task 5                                  | `task/folder-invites` itself, after batch 4 is merged                                                                                            |
| 6     | Task 7                                  | `task/folder-invites` itself                                                                                                                     |
| 7     | Tasks 9, 10, 11 in order (orchestrator) | `task/folder-invites` itself                                                                                                                     |

Dispatch each parallel batch in a single message. Every dispatch states: foreground only, timeout 600000, `cd` to the absolute worktree path in each Bash call, no commit by the implementer in a shared folder, no finish, no merge, no push.

**Critical path:** 1 → 2 → 3 → 4 → 5 → 7 → 9 → 10 → 11. Tasks 6 and 8 run beside Task 4 and are off it.

---

### Task 1: Migration A — folder grants, access rule, RPCs, redemption

**Files:**

- Create: `supabase/migrations/<stamp>_folder_invites.sql` (minted by the script)
- Create: `docs/superpowers/plans/folder-invites-access-matrix.sql`

**Interfaces:**

- Consumes: nothing.
- Produces (SQL, all in `public`):
  - tables `folder_members(folder_id, org_id, user_id, access_level board_access, granted_by, created_at)`, `folder_invitations(id, folder_id, org_id, email, access_level, invited_by, status, created_at)`
  - `is_org_guest(p_org_id uuid) returns boolean`
  - `is_folder_member(p_folder_id uuid) returns boolean`
  - `can_see_folder(p_folder_id uuid) returns boolean`
  - `can_manage_folder(p_folder_id uuid) returns boolean`
  - `folder_has_members(p_folder_id uuid) returns boolean`
  - `my_folder_board_levels(p_board_ids uuid[]) returns table(board_id uuid, access_level board_access)`
  - `board_folder_grants(p_board_id uuid) returns table(user_id uuid, access_level board_access, folder_name text)`
  - `folder_invitation_states(p_folder_id uuid) returns table(id uuid, email text, access_level board_access, state text)` where `state` is `'invited'` or `'awaiting_approval'`
  - `share_folder(p_folder_id uuid, p_user_id uuid, p_level board_access) returns void`
  - `unshare_folder(p_folder_id uuid, p_user_id uuid) returns void`
  - `invite_to_folder(p_folder_id uuid, p_email text, p_level board_access) returns uuid` (the member's user id when the email already belongs to an active org member and was shared directly; `null` when an invitation was recorded)
  - `revoke_folder_invitation(p_id uuid) returns void`

- [ ] **Step 1: Mint the migration**

Run: `scripts/new-migration.sh folder_invites`
Expected: prints `supabase/migrations/<stamp>_folder_invites.sql` and creates the file. Do not rename it.

- [ ] **Step 2: Write the migration**

Replace the minted file's body with exactly this (keep the header comment lines the script wrote above it):

```sql
-- Folder invites: one folder_members row grants viewer/editor on every board
-- in the folder, resolved at read time through folder_boards (PK board_id).
-- The four board access helpers keep their signatures and gain a folder path.

-- ───────────────────────────────────────────────────────────── 1. tables
create table public.folder_members (
  folder_id    uuid not null,
  org_id       uuid not null references public.organizations (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  access_level public.board_access not null,
  granted_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (folder_id, user_id),
  foreign key (folder_id, org_id) references public.folders (id, org_id) on delete cascade
);
create index folder_members_user_idx on public.folder_members (user_id, folder_id);
create index folder_members_org_id_idx on public.folder_members (org_id);
create index folder_members_granted_by_idx on public.folder_members (granted_by);

create table public.folder_invitations (
  id           uuid primary key default gen_random_uuid(),
  folder_id    uuid not null,
  org_id       uuid not null references public.organizations (id) on delete cascade,
  email        text not null,
  access_level public.board_access not null,
  invited_by   uuid references auth.users (id) on delete set null,
  status       text not null default 'pending'
               constraint folder_invitations_status_check
               check (status in ('pending', 'accepted', 'revoked')),
  created_at   timestamptz not null default now(),
  foreign key (folder_id, org_id) references public.folders (id, org_id) on delete cascade
);
create unique index folder_invitations_pending_uq
  on public.folder_invitations (folder_id, lower(email)) where status = 'pending';
create index folder_invitations_email_idx on public.folder_invitations (lower(email));
create index folder_invitations_org_id_idx on public.folder_invitations (org_id);
create index folder_invitations_invited_by_idx on public.folder_invitations (invited_by);

alter table public.folder_members enable row level security;
alter table public.folder_invitations enable row level security;

-- ──────────────────────────────────────────────── 2. small boolean helpers
create function public.is_org_guest(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = (select auth.uid())
      and role = 'guest' and deactivated_at is null
  );
$$;

create function public.is_folder_member(p_folder_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.folder_members fm
    where fm.folder_id = p_folder_id and fm.user_id = (select auth.uid())
  );
$$;

create function public.folder_has_members(p_folder_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.folder_members fm where fm.folder_id = p_folder_id);
$$;

-- A guest sees a folder only as a member of it; everyone else in the org sees it.
create function public.can_see_folder(p_folder_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.folders f
    where f.id = p_folder_id
      and public.is_org_member(f.org_id)
      and (not public.is_org_guest(f.org_id) or public.is_folder_member(f.id))
  );
$$;

-- Invite, change a level, remove: the folder's creator, org owners and admins.
create function public.can_manage_folder(p_folder_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.folders f
    where f.id = p_folder_id
      and public.is_org_member(f.org_id)
      and not public.is_org_guest(f.org_id)
      and (
        f.created_by = (select auth.uid())
        or public.has_org_role(f.org_id, array['owner', 'admin']::public.org_role[])
      )
  );
$$;

revoke execute on function public.is_org_guest(uuid) from public, anon;
revoke execute on function public.is_folder_member(uuid) from public, anon;
revoke execute on function public.folder_has_members(uuid) from public, anon;
revoke execute on function public.can_see_folder(uuid) from public, anon;
revoke execute on function public.can_manage_folder(uuid) from public, anon;
grant execute on function public.is_org_guest(uuid) to authenticated;
grant execute on function public.is_folder_member(uuid) to authenticated;
grant execute on function public.folder_has_members(uuid) to authenticated;
grant execute on function public.can_see_folder(uuid) to authenticated;
grant execute on function public.can_manage_folder(uuid) to authenticated;

-- ───────────────────────────────────────────────────── 3. the access rule
create function public._folder_board_level(p_board_id uuid, p_user_id uuid)
returns public.board_access language sql stable security definer set search_path = '' as $$
  select fm.access_level
  from public.folder_boards fb
  join public.folder_members fm on fm.folder_id = fb.folder_id
  where fb.board_id = p_board_id and fm.user_id = p_user_id;
$$;
revoke execute on function public._folder_board_level(uuid, uuid) from public, anon, authenticated;

create or replace function public.can_read_board(p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id
      and public.is_org_member(b.org_id)
      and (
        b.created_by = (select auth.uid())
        or exists (
          select 1 from public.board_members m
          where m.board_id = b.id and m.user_id = (select auth.uid())
        )
        or exists (
          select 1 from public.folder_boards fb
          join public.folder_members fm on fm.folder_id = fb.folder_id
          where fb.board_id = b.id and fm.user_id = (select auth.uid())
        )
      )
  );
$$;

create or replace function public.can_edit_board(p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id
      and public.is_org_member(b.org_id)
      and (
        b.created_by = (select auth.uid())
        or exists (
          select 1 from public.board_members m
          where m.board_id = b.id and m.user_id = (select auth.uid())
            and m.access_level = 'editor'
        )
        or exists (
          select 1 from public.folder_boards fb
          join public.folder_members fm on fm.folder_id = fb.folder_id
          where fb.board_id = b.id and fm.user_id = (select auth.uid())
            and fm.access_level = 'editor'
        )
      )
  );
$$;

create or replace function public.readable_board_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select b.id
  from public.boards b
  where public.is_org_member(b.org_id)
    and (
      b.created_by = (select auth.uid())
      or exists (
        select 1 from public.board_members m
        where m.board_id = b.id and m.user_id = (select auth.uid())
      )
    )
  union
  select b.id
  from public.folder_members fm
  join public.folder_boards fb on fb.folder_id = fm.folder_id
  join public.boards b on b.id = fb.board_id
  where fm.user_id = (select auth.uid())
    and public.is_org_member(b.org_id);
$$;

create or replace function public.is_board_member(p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.board_members m
    where m.board_id = p_board_id and m.user_id = (select auth.uid())
  ) or exists (
    select 1 from public.folder_boards fb
    join public.folder_members fm on fm.folder_id = fb.folder_id
    where fb.board_id = p_board_id and fm.user_id = (select auth.uid())
  );
$$;

-- The caller's folder-derived level on a set of boards (TypeScript access copies).
create function public.my_folder_board_levels(p_board_ids uuid[])
returns table (board_id uuid, access_level public.board_access)
language sql stable security definer set search_path = '' as $$
  select fb.board_id, fm.access_level
  from public.folder_boards fb
  join public.folder_members fm on fm.folder_id = fb.folder_id
  join public.boards b on b.id = fb.board_id
  where fb.board_id = any (p_board_ids)
    and fm.user_id = (select auth.uid())
    and public.is_org_member(b.org_id);
$$;
revoke execute on function public.my_folder_board_levels(uuid[]) from public, anon;
grant execute on function public.my_folder_board_levels(uuid[]) to authenticated;

-- Everyone who reaches a board through its folder (share dialog, read-only rows).
create function public.board_folder_grants(p_board_id uuid)
returns table (user_id uuid, access_level public.board_access, folder_name text)
language sql stable security definer set search_path = '' as $$
  select fm.user_id, fm.access_level, f.name
  from public.folder_boards fb
  join public.folders f on f.id = fb.folder_id
  join public.folder_members fm on fm.folder_id = fb.folder_id
  where fb.board_id = p_board_id
    and public.can_read_board(p_board_id);
$$;
revoke execute on function public.board_folder_grants(uuid) from public, anon;
grant execute on function public.board_folder_grants(uuid) to authenticated;

-- ─────────────────────────────────────────────────────── 4. Mono bots
-- A bot's board_members row follows its owner. The owner's level is now the
-- higher of the direct grant and the folder grant.
create or replace function public._owner_board_level(p_board_id uuid, p_owner uuid)
returns public.board_access language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.boards b where b.id = p_board_id and b.created_by = p_owner)
      then 'editor'::public.board_access
    else greatest(
      (select bm.access_level from public.board_members bm
        where bm.board_id = p_board_id and bm.user_id = p_owner),
      public._folder_board_level(p_board_id, p_owner)
    )
  end;
$$;

create function public._sync_mono_board_row(p_board_id uuid, p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_mono uuid; v_level public.board_access;
begin
  select b.org_id into v_org from public.boards b where b.id = p_board_id;
  if v_org is null then return; end if;
  select m.user_id into v_mono from public.monos m
   where m.owner_id = p_owner and m.org_id = v_org;
  if v_mono is null then return; end if;
  v_level := public._owner_board_level(p_board_id, p_owner);
  if v_level is null then
    delete from public.board_members bm where bm.board_id = p_board_id and bm.user_id = v_mono;
  else
    update public.board_members bm set access_level = v_level
     where bm.board_id = p_board_id and bm.user_id = v_mono and bm.access_level <> v_level;
  end if;
end $$;
revoke execute on function public._sync_mono_board_row(uuid, uuid) from public, anon, authenticated;

create function public.tg_folder_members_sync_monos()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_folder uuid := case when tg_op = 'DELETE' then old.folder_id else new.folder_id end;
  v_user   uuid := case when tg_op = 'DELETE' then old.user_id   else new.user_id   end;
  r record;
begin
  for r in select fb.board_id from public.folder_boards fb where fb.folder_id = v_folder loop
    perform public._sync_mono_board_row(r.board_id, v_user);
  end loop;
  return null;
end $$;
revoke execute on function public.tg_folder_members_sync_monos() from public, anon, authenticated;
create trigger folder_members_sync_monos
  after insert or update of access_level or delete on public.folder_members
  for each row execute function public.tg_folder_members_sync_monos();

create function public.tg_folder_boards_sync_monos()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_board uuid := case when tg_op = 'DELETE' then old.board_id else new.board_id end;
  r record;
begin
  for r in
    select distinct fm.user_id from public.folder_members fm
    where fm.folder_id in (
      case when tg_op in ('UPDATE', 'DELETE') then old.folder_id end,
      case when tg_op in ('UPDATE', 'INSERT') then new.folder_id end
    )
  loop
    perform public._sync_mono_board_row(v_board, r.user_id);
  end loop;
  return null;
end $$;
revoke execute on function public.tg_folder_boards_sync_monos() from public, anon, authenticated;
create trigger folder_boards_sync_monos
  after insert or update of folder_id or delete on public.folder_boards
  for each row execute function public.tg_folder_boards_sync_monos();

-- ───────────────────────── 5. moving a board into or out of a shared folder
-- Entering a folder that has members exposes the board to them; leaving one
-- removes their access. Only the board's creator or an org owner/admin may do
-- either. A reorder (same folder_id) and a cascade (folder or board deleted,
-- trigger depth > 1) are not moves.
create function public.tg_folder_boards_guard_shared()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_board uuid := case when tg_op = 'DELETE' then old.board_id else new.board_id end;
  v_org uuid; v_creator uuid; v_shared boolean;
begin
  if v_uid is null or pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.folder_id = old.folder_id then
    return new;
  end if;
  select exists (
    select 1 from public.folder_members fm
    where fm.folder_id in (
      case when tg_op in ('UPDATE', 'DELETE') then old.folder_id end,
      case when tg_op in ('UPDATE', 'INSERT') then new.folder_id end
    )
  ) into v_shared;
  if not v_shared then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select b.org_id, b.created_by into v_org, v_creator from public.boards b where b.id = v_board;
  if v_creator is distinct from v_uid
     and not public.has_org_role(v_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'only the board owner or an admin can move a board into or out of a shared folder'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.tg_folder_boards_guard_shared() from public, anon, authenticated;
create trigger folder_boards_guard_shared
  before insert or update or delete on public.folder_boards
  for each row execute function public.tg_folder_boards_guard_shared();

create or replace function public.folder_accepts_board(p_folder_id uuid, p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.folders f
    join public.boards b on b.id = p_board_id
    where f.id = p_folder_id
      and public.is_org_member(f.org_id)
      and not public.is_org_guest(f.org_id)
      and b.workspace_id = f.workspace_id
      and public.can_read_board(b.id)
  );
$$;

-- ───────────────────────────────────────── 6. folder visibility and writes
alter policy "folders: read if member" on public.folders
  using (
    org_id in (select public.auth_user_orgs())
    and (not public.is_org_guest(org_id) or public.is_folder_member(id))
  );

alter policy "folders: insert if member" on public.folders
  with check (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.workspaces w
      where w.id = folders.workspace_id and w.org_id = folders.org_id
    )
  );

alter policy "folders: update if member" on public.folders
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and exists (
      select 1 from public.workspaces w
      where w.id = folders.workspace_id and w.org_id = folders.org_id
    )
  );

alter policy "folders: delete if member" on public.folders
  using (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and (not public.folder_has_members(id) or public.can_manage_folder(id))
  );

alter policy "folder_layouts: read if member" on public.folder_layouts
  using (public.can_see_folder(folder_id));

alter policy "folder_layouts: insert if member" on public.folder_layouts
  with check (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_layouts.folder_id and f.org_id = folder_layouts.org_id
    )
  );

alter policy "folder_layouts: update if member" on public.folder_layouts
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_layouts.folder_id and f.org_id = folder_layouts.org_id
    )
  );

alter policy "folder_layouts: delete if member" on public.folder_layouts
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id));

alter policy "folder_boards: update if member" on public.folder_boards
  using (
    exists (
      select 1 from public.folders f
      where f.id = folder_boards.folder_id
        and public.is_org_member(f.org_id)
        and not public.is_org_guest(f.org_id)
    )
    and public.can_read_board(board_id)
  )
  with check (public.folder_accepts_board(folder_id, board_id));

alter policy "folder_boards: delete if member" on public.folder_boards
  using (
    exists (
      select 1 from public.folders f
      where f.id = folder_boards.folder_id
        and public.is_org_member(f.org_id)
        and not public.is_org_guest(f.org_id)
    )
    and public.can_read_board(board_id)
  );

-- The folder gallery listed every folder in the workspace to any org member.
-- Body unchanged from 20260915112812 except the one can_see_folder predicate.
create or replace function public.folder_gallery(p_workspace_id uuid)
returns table (
  folder_id uuid, folder_name text, folder_position integer, board_count integer,
  item_count integer, done_count integer, overdue_count integer, attention_count integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.workspaces where id = p_workspace_id;
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  return query
  select fo.id,
         fo.name,
         fo.position,
         (select count(*)::int from public._folder_readable_boards(fo.id)),
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
    and public.can_see_folder(fo.id)
  group by fo.id, fo.name, fo.position
  order by fo.position asc, fo.name asc;
end; $$;

create or replace function public._assert_folder_member(p_folder_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_see_folder(p_folder_id) then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;
end; $$;

-- ───────────────────────────────── 7. RLS on the two new tables (default deny)
create policy "folder_members: read if can see folder" on public.folder_members
  for select to authenticated using (public.can_see_folder(folder_id));
create policy "folder_members: member leaves" on public.folder_members
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "folder_invitations: read if can manage" on public.folder_invitations
  for select to authenticated using (public.can_manage_folder(folder_id));

revoke all on table public.folder_members from anon;
revoke all on table public.folder_invitations from anon;
revoke insert, update, truncate, references, trigger on table public.folder_members from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.folder_invitations from authenticated;

-- ───────────────────────────────────────────────────── 8. management RPCs
create function public.share_folder(p_folder_id uuid, p_user_id uuid, p_level public.board_access)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_role public.org_role;
begin
  if not public.can_manage_folder(p_folder_id) then
    raise exception 'not allowed to manage this folder' using errcode = '42501';
  end if;
  select org_id into v_org from public.folders where id = p_folder_id;
  select role into v_role from public.org_members
   where org_id = v_org and user_id = p_user_id and deactivated_at is null;
  if v_role is null then
    raise exception 'target is not a member of this org' using errcode = '42501';
  end if;
  if v_role = 'agent' then
    raise exception 'a Mono follows its owner' using errcode = '42501';
  end if;
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (p_folder_id, v_org, p_user_id, p_level, v_uid)
  on conflict (folder_id, user_id)
  do update set access_level = excluded.access_level, granted_by = excluded.granted_by;
end $$;

create function public.unshare_folder(p_folder_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_folder(p_folder_id) then
    raise exception 'not allowed to manage this folder' using errcode = '42501';
  end if;
  delete from public.folder_members where folder_id = p_folder_id and user_id = p_user_id;
end $$;

-- Returns the member's id when the email already belongs to an active org
-- member (shared directly), null when an invitation was recorded.
create function public.invite_to_folder(p_folder_id uuid, p_email text, p_level public.board_access)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_email text := lower(trim(p_email));
  v_user uuid;
begin
  if not public.can_manage_folder(p_folder_id) then
    raise exception 'not allowed to manage this folder' using errcode = '42501';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  select org_id into v_org from public.folders where id = p_folder_id;

  select u.id into v_user
    from auth.users u
    join public.org_members om
      on om.user_id = u.id and om.org_id = v_org and om.deactivated_at is null
   where lower(u.email::text) = v_email
   limit 1;
  if v_user is not null then
    perform public.share_folder(p_folder_id, v_user, p_level);
    return v_user;
  end if;

  insert into public.folder_invitations (folder_id, org_id, email, access_level, invited_by)
  values (p_folder_id, v_org, v_email, p_level, v_uid)
  on conflict (folder_id, lower(email)) where status = 'pending'
  do update set access_level = excluded.access_level, invited_by = excluded.invited_by;

  insert into public.org_invitations (org_id, email, role, invited_by)
  values (v_org, v_email, 'guest'::public.org_role, v_uid)
  on conflict (org_id, lower(email)) where status = 'pending' do nothing;

  return null;
end $$;

create function public.revoke_folder_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_folder uuid; v_org uuid; v_email text;
begin
  select folder_id, org_id, lower(email) into v_folder, v_org, v_email
    from public.folder_invitations where id = p_id and status = 'pending';
  if v_folder is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_folder(v_folder) then
    raise exception 'not allowed to manage this folder' using errcode = '42501';
  end if;
  update public.folder_invitations set status = 'revoked' where id = p_id;
  -- A guest org invitation that existed only to carry folder invites goes too.
  update public.org_invitations oi
     set status = 'revoked'
   where oi.org_id = v_org and lower(oi.email) = v_email
     and oi.status = 'pending' and oi.role = 'guest'
     and not exists (
       select 1 from public.folder_invitations fi
       where fi.org_id = v_org and lower(fi.email) = v_email and fi.status = 'pending'
     );
end $$;

create function public.folder_invitation_states(p_folder_id uuid)
returns table (id uuid, email text, access_level public.board_access, state text)
language sql stable security definer set search_path = '' as $$
  select fi.id, fi.email, fi.access_level,
         case when exists (
                select 1 from auth.users u
                join public.account_approvals a on a.user_id = u.id
                where lower(u.email::text) = lower(fi.email) and a.status = 'pending'
              ) then 'awaiting_approval' else 'invited' end
  from public.folder_invitations fi
  where fi.folder_id = p_folder_id
    and fi.status = 'pending'
    and public.can_manage_folder(p_folder_id)
  order by fi.created_at;
$$;

revoke execute on function public.share_folder(uuid, uuid, public.board_access) from public, anon;
revoke execute on function public.unshare_folder(uuid, uuid) from public, anon;
revoke execute on function public.invite_to_folder(uuid, text, public.board_access) from public, anon;
revoke execute on function public.revoke_folder_invitation(uuid) from public, anon;
revoke execute on function public.folder_invitation_states(uuid) from public, anon;
grant execute on function public.share_folder(uuid, uuid, public.board_access) to authenticated;
grant execute on function public.unshare_folder(uuid, uuid) to authenticated;
grant execute on function public.invite_to_folder(uuid, text, public.board_access) to authenticated;
grant execute on function public.revoke_folder_invitation(uuid) to authenticated;
grant execute on function public.folder_invitation_states(uuid) to authenticated;

-- ───────────────────────────────────────────────────────── 9. redemption
-- Turns pending folder invitations into folder_members rows, but only for orgs
-- the user has actually joined (the org invitation was accepted and the
-- account_not_approved trigger on org_members let the row in).
create function public._redeem_folder_invitations(p_uid uuid, p_email text, p_org_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  with taken as (
    update public.folder_invitations fi
       set status = 'accepted'
     where fi.status = 'pending'
       and lower(fi.email) = lower(p_email)
       and (p_org_id is null or fi.org_id = p_org_id)
       and exists (
         select 1 from public.org_members om
         where om.org_id = fi.org_id and om.user_id = p_uid and om.deactivated_at is null
       )
    returning fi.folder_id, fi.org_id, fi.access_level, fi.invited_by
  )
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  select t.folder_id, t.org_id, p_uid, t.access_level, t.invited_by from taken t
  on conflict (folder_id, user_id)
  do update set access_level = greatest(public.folder_members.access_level, excluded.access_level);
end $$;
revoke execute on function public._redeem_folder_invitations(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.redeem_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text; v_count int := 0;
  v_home_org uuid;
begin
  if v_uid is null then return 0; end if;
  select email::text into v_email from auth.users where id = v_uid;
  if v_email is null then return 0; end if;

  -- The redeemer's owned org is stable across this call (redemption only adds
  -- member/guest rows, never owner rows). Brand-new invite-only users own none
  -- yet at redeem time, so reciprocity correctly no-ops for them.
  select org_id into v_home_org
    from public.org_members
   where user_id = v_uid and role = 'owner'
   limit 1;

  with redeemed as (
    update public.org_invitations
       set status = 'accepted', accepted_at = now()
     where status = 'pending' and lower(email) = lower(v_email)
     returning org_id, role, invited_by
  ), inserted as (
    insert into public.org_members (org_id, user_id, role)
    select org_id, v_uid, role from redeemed
    on conflict (org_id, user_id) do nothing
    returning 1
  ), reciprocal as (
    -- Data-modifying CTE runs to completion even though the final SELECT does
    -- not reference it. distinct dedupes repeat inviters within one batch.
    insert into public.org_members (org_id, user_id, role)
    select distinct v_home_org, r.invited_by, 'guest'::public.org_role
      from redeemed r
     where v_home_org is not null
       and r.invited_by is not null
       and r.invited_by <> v_uid
    on conflict (org_id, user_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  perform public._redeem_folder_invitations(v_uid, v_email, null);
  return v_count;
end; $$;

create or replace function public.accept_invitation(p_invite_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org_id uuid;
  v_role public.org_role;
  v_invited_by uuid;
  v_home_org uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select lower(u.email::text) into v_email from auth.users u where u.id = v_uid;

  update public.org_invitations
     set status = 'accepted', accepted_at = now()
   where id = p_invite_id
     and status = 'pending'
     and lower(email) = v_email
   returning org_id, role, invited_by into v_org_id, v_role, v_invited_by;

  if v_org_id is null then
    raise exception 'invitation not found';
  end if;

  insert into public.org_members (org_id, user_id, role)
  values (v_org_id, v_uid, v_role)
  on conflict (org_id, user_id) do nothing;

  -- Reciprocal: inviter → invitee's owned org (0 or 1) as guest.
  select org_id into v_home_org
    from public.org_members
   where user_id = v_uid and role = 'owner'
   limit 1;

  if v_home_org is not null
     and v_invited_by is not null
     and v_invited_by <> v_uid then
    insert into public.org_members (org_id, user_id, role)
    values (v_home_org, v_invited_by, 'guest'::public.org_role)
    on conflict (org_id, user_id) do nothing;  -- never demote an existing role
  end if;

  perform public._redeem_folder_invitations(v_uid, v_email, v_org_id);
  return v_org_id;
end; $$;

create or replace function public.decline_invitation(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select lower(u.email::text) into v_email from auth.users u where u.id = v_uid;

  update public.org_invitations
     set status = 'declined'
   where id = p_invite_id
     and status = 'pending'
     and lower(email) = v_email
   returning org_id into v_org_id;
  if v_org_id is null then
    raise exception 'invitation not found';
  end if;

  -- Declining the org invitation declines the folder invites that came with it.
  update public.folder_invitations
     set status = 'revoked'
   where org_id = v_org_id and lower(email) = v_email and status = 'pending';
end; $$;
```

- [ ] **Step 3: Write the access matrix script**

Create `docs/superpowers/plans/folder-invites-access-matrix.sql` with exactly this. It is appended after the migration SQL in one `execute_sql` call by the orchestrator in Task 3. It always ends by raising an exception, which rolls back everything in that call, including the migration. It prints only check names and booleans, never ids, names or emails.

```sql
-- Folder invites access matrix. Run AFTER the migration SQL in the same
-- execute_sql call. Ends with RAISE EXCEPTION on purpose: the whole call,
-- migration included, rolls back. Output: 'ACCESS_MATRIX {json}'.
do $matrix$
declare
  v_org uuid; v_owner uuid; v_other uuid; v_board uuid; v_ws uuid;
  v_folder uuid; v_tmp_folder uuid; v_tmp_board uuid;
  r jsonb := '{}'::jsonb;
  v_bool boolean; v_raised boolean; v_n int; v_m int;
  v_plan json; v_ms numeric; v_best numeric; i int;
begin
  -- A board B created by U, and another active plain member V of the same org.
  select b.org_id, b.created_by, om.user_id, b.id, b.workspace_id
    into v_org, v_owner, v_other, v_board, v_ws
  from public.boards b
  join public.org_members oc
    on oc.org_id = b.org_id and oc.user_id = b.created_by and oc.deactivated_at is null
  join public.org_members om
    on om.org_id = b.org_id and om.user_id <> b.created_by
   and om.deactivated_at is null and om.role = 'member'
  where b.archived_at is null
  order by (select count(*) from public.items it where it.board_id = b.id) desc
  limit 1;
  if v_board is null then
    raise exception 'ACCESS_MATRIX {"fixture":"NO_FIXTURE"}';
  end if;

  -- V starts with no access: drop any direct grant, take the board out of any
  -- folder, then file it in a fresh folder created by U. (All rolled back.)
  perform set_config('request.jwt.claims', '', true);
  delete from public.board_members where board_id = v_board and user_id = v_other;
  delete from public.folder_boards where board_id = v_board;
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'matrix-' || gen_random_uuid()::text, v_owner)
  returning id into v_folder;
  insert into public.folder_boards (folder_id, board_id, position) values (v_folder, v_board, 0);

  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);

  r := r || jsonb_build_object('01_no_access_before', not public.can_read_board(v_board));

  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (v_folder, v_org, v_other, 'viewer', v_owner);
  r := r || jsonb_build_object(
    '02_viewer_can_read', public.can_read_board(v_board),
    '03_viewer_cannot_edit', not public.can_edit_board(v_board),
    '04_in_readable_ids', exists (select 1 from public.readable_board_ids() x where x = v_board),
    '05_is_board_member', public.is_board_member(v_board),
    '06_level_rpc_viewer', (select access_level = 'viewer'
                              from public.my_folder_board_levels(array[v_board]))
  );

  -- RLS path, as the authenticated role: V reads the board's items.
  select count(*) into v_m from public.items where board_id = v_board;
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.items where board_id = v_board;
  perform set_config('role', 'none', true);
  r := r || jsonb_build_object('07_rls_items_visible', v_n = v_m);

  update public.folder_members set access_level = 'editor'
   where folder_id = v_folder and user_id = v_other;
  r := r || jsonb_build_object('08_editor_can_edit', public.can_edit_board(v_board));

  -- V is not the folder's creator and not an admin: cannot manage.
  v_raised := false;
  begin
    perform public.share_folder(v_folder, v_owner, 'viewer');
  exception when insufficient_privilege then v_raised := true;
  end;
  r := r || jsonb_build_object(
    '09_non_manager_cannot_share', v_raised,
    '10_non_manager_flag', not public.can_manage_folder(v_folder)
  );

  -- V is not the board's creator: cannot take it out of a shared folder.
  v_raised := false;
  begin
    delete from public.folder_boards where board_id = v_board;
  exception when insufficient_privilege then v_raised := true;
  end;
  r := r || jsonb_build_object('11_non_owner_cannot_unfile_shared', v_raised);

  -- A reorder inside the folder is not a move.
  v_raised := false;
  begin
    update public.folder_boards set position = 5 where board_id = v_board;
  exception when insufficient_privilege then v_raised := true;
  end;
  r := r || jsonb_build_object('12_reorder_allowed', not v_raised);

  -- Deactivated org member with the folder row still present: no access.
  perform set_config('request.jwt.claims', '', true);
  update public.org_members set deactivated_at = now()
   where org_id = v_org and user_id = v_other;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  r := r || jsonb_build_object('13_deactivated_loses_access', not public.can_read_board(v_board));
  perform set_config('request.jwt.claims', '', true);
  update public.org_members set deactivated_at = null
   where org_id = v_org and user_id = v_other;

  -- Guest: sees the folder only as a member of it.
  update public.org_members set role = 'guest' where org_id = v_org and user_id = v_other;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  r := r || jsonb_build_object('14_guest_member_sees_folder', public.can_see_folder(v_folder));
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.folders where org_id = v_org;
  perform set_config('role', 'none', true);
  select count(*) into v_m from public.folder_members fm
   where fm.user_id = v_other and fm.org_id = v_org;
  r := r || jsonb_build_object('15_guest_rls_only_their_folders', v_n = v_m);
  -- The gallery RPC is security definer, so it needs its own check.
  select count(*) into v_n from public.folder_gallery(v_ws);
  r := r || jsonb_build_object('25_guest_gallery_only_their_folders', v_n = 1);

  v_raised := false;
  begin
    perform count(*) from public.folder_rollup(v_folder);
  exception when others then v_raised := true;
  end;
  r := r || jsonb_build_object('16_guest_member_can_rollup', not v_raised);

  -- Removed from the folder: nothing left.
  perform set_config('request.jwt.claims', '', true);
  delete from public.folder_members where folder_id = v_folder and user_id = v_other;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  v_raised := false;
  begin
    perform count(*) from public.folder_rollup(v_folder);
  exception when others then v_raised := true;
  end;
  r := r || jsonb_build_object(
    '17_removed_loses_access', not public.can_read_board(v_board),
    '18_guest_non_member_cannot_see', not public.can_see_folder(v_folder),
    '19_guest_non_member_rollup_refused', v_raised
  );
  perform set_config('request.jwt.claims', '', true);
  update public.org_members set role = 'member' where org_id = v_org and user_id = v_other;

  -- Pending invitation grants nothing; the creator can invite; revoke clears both rows.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  r := r || jsonb_build_object(
    '20_creator_can_manage', public.can_manage_folder(v_folder),
    '21_invite_unknown_email_returns_null',
      public.invite_to_folder(v_folder, 'matrix-' || gen_random_uuid()::text || '@example.com', 'viewer') is null
  );
  select count(*) into v_n from public.folder_invitations where folder_id = v_folder and status = 'pending';
  select count(*) into v_m from public.folder_members where folder_id = v_folder;
  r := r || jsonb_build_object('22_pending_invite_grants_nothing', v_n = 1 and v_m = 0);
  perform public.revoke_folder_invitation(
    (select id from public.folder_invitations where folder_id = v_folder and status = 'pending'));
  select count(*) into v_n from public.org_invitations oi
   where oi.org_id = v_org and oi.status = 'pending' and oi.email like 'matrix-%@example.com';
  r := r || jsonb_build_object('23_revoke_clears_guest_org_invite', v_n = 0);

  -- Cascade: the creator deletes a shared folder holding a board that is not
  -- theirs. The move guard must not fire on the cascade (pg_trigger_depth > 1).
  perform set_config('request.jwt.claims', '', true);
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'matrix-' || gen_random_uuid()::text, v_other)
  returning id into v_tmp_folder;
  delete from public.folder_boards where board_id = v_board;
  insert into public.folder_boards (folder_id, board_id, position) values (v_tmp_folder, v_board, 0);
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (v_tmp_folder, v_org, v_owner, 'viewer', v_other);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  v_raised := false;
  begin
    delete from public.folders where id = v_tmp_folder;
  exception when others then v_raised := true;
  end;
  r := r || jsonb_build_object('24_shared_folder_delete_cascades', not v_raised);

  -- Timings for the stop condition (best of 3, milliseconds).
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform set_config('role', 'authenticated', true);
  v_best := null;
  for i in 1..3 loop
    execute format('explain (analyze, format json) select count(*) from public.items where board_id = %L', v_board) into v_plan;
    v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
    if v_best is null or v_ms < v_best then v_best := v_ms; end if;
  end loop;
  r := r || jsonb_build_object('t_items_ms', v_best);
  perform set_config('role', 'none', true);

  select fb.folder_id into v_tmp_folder
    from public.folder_boards fb group by fb.folder_id order by count(*) desc limit 1;
  select b.created_by into v_owner
    from public.folder_boards fb join public.boards b on b.id = fb.board_id
   where fb.folder_id = v_tmp_folder limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_best := null;
  for i in 1..3 loop
    execute format('explain (analyze, format json) select count(*) from public.folder_rollup(%L)', v_tmp_folder) into v_plan;
    v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
    if v_best is null or v_ms < v_best then v_best := v_ms; end if;
  end loop;
  r := r || jsonb_build_object('t_folder_rollup_ms', v_best);

  raise exception 'ACCESS_MATRIX %', r::text;
end
$matrix$;
```

- [ ] **Step 4: Run the default test suite**

Run: `pnpm test` (foreground, timeout 600000)
Expected: PASS. The conformance project scans migrations for functions left executable by `public`/`anon`; a failure names the function. Fix by adding the missing `revoke` line and re-run.

- [ ] **Step 5: Hand back to the orchestrator for commit**

Report the migration filename and both new paths. The orchestrator commits:

```bash
git add supabase/migrations/*_folder_invites.sql docs/superpowers/plans/folder-invites-access-matrix.sql
git commit -m "feat(folders): add folder grants, access rule and invite rpcs"
```

---

### Task 2: Migration B — guest confinement on org-wide surfaces

**Files:**

- Create: `supabase/migrations/<stamp>_guest_confinement.sql` (minted by the script)

**Interfaces:**

- Consumes: `is_org_guest(uuid)`, `is_folder_member(uuid)` from Task 1.
- Produces: `auth_user_full_orgs() returns setof uuid`, `tg_block_guest_insert()`. No TypeScript consumer.

- [ ] **Step 1: Mint the migration**

Run: `scripts/new-migration.sh guest_confinement`
Expected: a file whose stamp is later than the Task 1 file. If the stamps are equal, wait a second and re-run.

- [ ] **Step 2: Write the migration**

```sql
-- Guests see what they were given. Org-wide surfaces that were gated only by
-- org membership are now for non-guest members. Board data is untouched: it is
-- gated by the can_read_board family.

create function public.auth_user_full_orgs()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.org_members
  where user_id = (select auth.uid()) and deactivated_at is null and role <> 'guest';
$$;
revoke execute on function public.auth_user_full_orgs() from public, anon;
grant execute on function public.auth_user_full_orgs() to authenticated;

-- ── reads
alter policy "goals: read if member" on public.goals
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "goal_links: read if member" on public.goal_links
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "portfolios: read if member" on public.portfolios
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "portfolio_boards: read if member" on public.portfolio_boards
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "member_capacity: read if member" on public.member_capacity
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "org_workload_settings: read if member" on public.org_workload_settings
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "time_allocations: read if member" on public.time_allocations
  using (
    org_id in (select public.auth_user_full_orgs())
    or (user_id = (select auth.uid()) and org_id in (select public.auth_user_orgs()))
  );
alter policy reports_select_member on public.reports
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id));

-- A guest reads only the dashboards attached to a folder they are a member of.
alter policy "dashboards: read if member" on public.dashboards
  using (
    org_id in (select public.auth_user_orgs())
    and (
      not public.is_org_guest(org_id)
      or (folder_id is not null and public.is_folder_member(folder_id))
    )
  );
alter policy "dashboard_widgets: read if member" on public.dashboard_widgets
  using (
    org_id in (select public.auth_user_orgs())
    and (
      not public.is_org_guest(org_id)
      or exists (
        select 1 from public.dashboards d
        where d.id = dashboard_widgets.dashboard_id
          and d.folder_id is not null
          and public.is_folder_member(d.folder_id)
      )
    )
  );

-- ── writes on dashboards, widgets and reports
alter policy "dashboards: insert if member" on public.dashboards
  with check (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy "dashboards: update if member" on public.dashboards
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy "dashboards: delete if member" on public.dashboards
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy "dashboard_widgets: insert if member" on public.dashboard_widgets
  with check (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy "dashboard_widgets: update if member" on public.dashboard_widgets
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy "dashboard_widgets: delete if member" on public.dashboard_widgets
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy reports_delete_member on public.reports
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy reports_update_member on public.reports
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and (board_id is null or public.board_in_org(board_id, org_id))
    and (portfolio_id is null or public.portfolio_in_org(portfolio_id, org_id))
  );

-- ── a guest creates nothing at org level. One trigger instead of rewriting
-- create_board, create_board_from_template, create_dashboard, duplicate_dashboard.
create function public.tg_block_guest_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and public.is_org_guest(new.org_id) then
    raise exception 'guests cannot create this here' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_block_guest_insert() from public, anon, authenticated;

create trigger boards_block_guest_insert before insert on public.boards
  for each row execute function public.tg_block_guest_insert();
create trigger workspaces_block_guest_insert before insert on public.workspaces
  for each row execute function public.tg_block_guest_insert();
create trigger dashboards_block_guest_insert before insert on public.dashboards
  for each row execute function public.tg_block_guest_insert();
create trigger goals_block_guest_insert before insert on public.goals
  for each row execute function public.tg_block_guest_insert();
create trigger portfolios_block_guest_insert before insert on public.portfolios
  for each row execute function public.tg_block_guest_insert();
create trigger reports_block_guest_insert before insert on public.reports
  for each row execute function public.tg_block_guest_insert();
```

- [ ] **Step 3: Confirm the policy names still match live**

Every `alter policy` above names a policy as it existed on DEV on 2026-11-14. With the `supabase-dev` MCP `execute_sql` (read-only), run:

```sql
select tablename, policyname from pg_policies
where schemaname = 'public'
  and tablename in ('goals','goal_links','portfolios','portfolio_boards','member_capacity',
                    'org_workload_settings','time_allocations','reports','dashboards','dashboard_widgets')
order by 1, 2;
```

Expected: every policy named in Step 2 appears. If one is missing or renamed, stop and report it; do not guess a name.

- [ ] **Step 4: Run the default test suite**

Run: `pnpm test` (foreground, timeout 600000)
Expected: PASS.

- [ ] **Step 5: Rollup functions — no change needed (verified)**

`goals_rollup`, `portfolio_rollup` and `workload_rollup` already return rows only for boards the caller can read. Latest definitions are in `supabase/migrations/20260707140000_soft_delete_archived_at.sql`, and the live bodies in `pg_proc` on DEV matched them on 2026-11-14:

- `goals_rollup()` — `:621`; the row source filters on `public.can_read_board(gl.board_id)` at `:632`. It returns `goal_id`, `board_id` and two counts, no names.
- `portfolio_rollup(p_portfolio_id, p_today)` — `:477`; filters on `public.can_read_board(pb.board_id)` at `:507`. Board names come back only for readable boards.
- `workload_rollup(p_from, p_to)` — `:553`; filters on `public.can_read_board(c.board_id)` at `:573`.

A guest therefore gets rollup rows only for boards in their folders, which they can already open. Nothing to write. `get_org_members` is left as is (Deviation 5).

- [ ] **Step 6: Search and Ask — no change needed (verified)**

Every search and Ask read runs on a client that RLS judges as the caller. Nothing to write in this task; the one service-client path that returns board data is fixed in Task 4 Step 12.

| Path                                         | Client                                                                      | Evidence                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Command palette and dependency picker search | cookie RLS client, `search_items` is `SECURITY INVOKER`                     | `src/lib/search/item-search.ts:36-37`; `pg_proc.prosecdef = false` on DEV   |
| Semantic search ("find similar", Ask tool)   | cookie RLS client, `match_items` is `SECURITY INVOKER`                      | `src/lib/ai/embeddings/search.ts:89-90`; `pg_proc.prosecdef = false` on DEV |
| `/api/ask`                                   | cookie RLS client; a Mono turn uses a client signed in as the Mono          | `src/app/api/ask/route.ts:131`, `:278-280`                                  |
| MCP tool catalog (incl. `search_items` tool) | bridged per-connection RLS client, "never the service-role client"          | `src/lib/mcp/context.ts:50-70`; `src/lib/mcp/tools/search-items.ts:26-34`   |
| Embedding index writes                       | service client, but HMAC-verified server-to-server route, not user-callable | `src/app/api/ai/embed/route.ts:32`, `:70-73`                                |
| AI automation step at fire time              | service client, HMAC-verified `pg_net` callback                             | `src/app/api/ai/automation-step/route.ts:58-72`                             |
| "Test this step" preview                     | **service client, gated only by active org**                                | `src/lib/ai/agentic/actions.ts:59-72` — fixed in Task 4 Step 12             |

A Mono's client is judged as the Mono, whose board rows follow its owner's level; Task 1 section 4 extends that to folder access.

- [ ] **Step 7: Hand back to the orchestrator for commit**

```bash
git add supabase/migrations/*_guest_confinement.sql
git commit -m "feat(org): confine guests to the folders they were given"
```

---

### Task 3: Dry run, apply to DEV, regenerate types (ORCHESTRATOR ONLY)

No subagent performs this task. It touches the database that serves live users.

**Files:**

- Modify: `src/types/database.types.ts` (regenerated)
- Modify: `src/lib/cache/tags.ts`

**Interfaces:**

- Consumes: both migration files and `docs/superpowers/plans/folder-invites-access-matrix.sql`.
- Produces: generated types for every Task 1 object; `folderMembersTag(userId: string): string`.

- [ ] **Step 1: Baseline timings**

With `supabase-dev` `execute_sql`, run this once. It changes nothing and reports through the raised message.

```sql
do $baseline$
declare
  v_board uuid; v_owner uuid; v_folder uuid;
  v_plan json; v_ms numeric; v_best numeric; i int; r jsonb := '{}'::jsonb;
begin
  select b.id, b.created_by into v_board, v_owner
  from public.boards b
  join public.org_members oc
    on oc.org_id = b.org_id and oc.user_id = b.created_by and oc.deactivated_at is null
  join public.org_members om
    on om.org_id = b.org_id and om.user_id <> b.created_by
   and om.deactivated_at is null and om.role = 'member'
  where b.archived_at is null
  order by (select count(*) from public.items it where it.board_id = b.id) desc
  limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform set_config('role', 'authenticated', true);
  v_best := null;
  for i in 1..3 loop
    execute format('explain (analyze, format json) select count(*) from public.items where board_id = %L', v_board) into v_plan;
    v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
    if v_best is null or v_ms < v_best then v_best := v_ms; end if;
  end loop;
  r := r || jsonb_build_object('t_items_ms', v_best);
  perform set_config('role', 'none', true);

  select fb.folder_id into v_folder
    from public.folder_boards fb group by fb.folder_id order by count(*) desc limit 1;
  select b.created_by into v_owner
    from public.folder_boards fb join public.boards b on b.id = fb.board_id
   where fb.folder_id = v_folder limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_best := null;
  for i in 1..3 loop
    execute format('explain (analyze, format json) select count(*) from public.folder_rollup(%L)', v_folder) into v_plan;
    v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
    if v_best is null or v_ms < v_best then v_best := v_ms; end if;
  end loop;
  r := r || jsonb_build_object('t_folder_rollup_ms', v_best);
  raise exception 'BASELINE %', r::text;
end
$baseline$;
```

Expected: an error whose message is `BASELINE {"t_items_ms": N, "t_folder_rollup_ms": M}`. Record both numbers. Run it twice more and keep the lowest of each.

- [ ] **Step 2: Dry run inside one rolled-back call**

Build one SQL string: the full text of the Task 1 migration, then the full text of the Task 2 migration, then the full text of `folder-invites-access-matrix.sql`. Send it as a single `execute_sql` call.

Expected: an error whose message starts `ACCESS_MATRIX {`. Because the call ends in an exception, nothing persists. Confirm with a second, separate call:

```sql
select to_regclass('public.folder_members') is null as rolled_back;
```

Expected: `rolled_back = true`.

- [ ] **Step 3: Read the matrix**

Every key `01_` to `25_` must be `true`. `"fixture":"NO_FIXTURE"` means DEV has no org with a board and a second plain member; stop and tell the owner.

An error whose message does **not** start with `ACCESS_MATRIX` means the migration or the script itself failed part-way (for example a policy renamed since 2026-11-14, so an `alter policy` names something that no longer exists). Nothing persisted. Read the message, fix the cause, and re-run Step 2. Never work around it by applying the migration first.

Any `false` is a stop. Fix the migration (through the implementer who wrote it), re-run Step 2. In particular `24_shared_folder_delete_cascades = false` means the cascade assumption behind `pg_trigger_depth() > 1` in `tg_folder_boards_guard_shared` does not hold on this Postgres version and the guard needs a different cascade test.

- [ ] **Step 4: Stop condition on timing**

Compare `t_items_ms` and `t_folder_rollup_ms` from the matrix with the baseline. Both scripts pick the same board and folder by the same query and measure as the board's creator through RLS, so the two pairs are like for like.

If either "after" value is more than 10% above its baseline **and** more than 1 ms above it in absolute terms, **stop**. Do not apply. Report both pairs of numbers to the owner.

- [ ] **Step 5: Apply to DEV (live)**

State to the owner in one line what is about to be applied and that it is live on apply. Then, for each migration file in version order, call `supabase-dev` `apply_migration` with `name` = the slug exactly as in the filename (`folder_invites`, then `guest_confinement`) and `query` = the file's full text.

Then run: `pnpm db:ledger-check`
Expected: no diff either way. If the ledger stamped its own version, run `scripts/reconcile-migration-version.sh` as that script's usage describes, then re-run the check.

- [ ] **Step 6: Post-apply sanity (read-only)**

```sql
select
  (select count(*) from public.folder_members) as folder_members_rows,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'folder_members') as fm_policies,
  has_function_privilege('anon', 'public.share_folder(uuid, uuid, public.board_access)', 'execute') as anon_can_share,
  has_function_privilege('authenticated', 'public._folder_board_level(uuid, uuid)', 'execute') as authed_can_internal;
```

Expected: `0`, `2`, `false`, `false`.

- [ ] **Step 7: Regenerate types**

Call `supabase-dev` `generate_typescript_types`, write the returned text over `src/types/database.types.ts`, then:

Run: `pnpm prettier --write src/types/database.types.ts`
Run: `grep -c "folder_members\|my_folder_board_levels\|invite_to_folder" src/types/database.types.ts`
Expected: a count of 3 or more.

- [ ] **Step 8: Add the cache tag**

In `src/lib/cache/tags.ts`, directly under the `foldersTag` line, add:

```ts
/** Which folders a user is a member of, and their role in the org. */
export const folderMembersTag = (userId: string) =>
  `folder-members:user:${userId}`;
```

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add src/types/database.types.ts src/lib/cache/tags.ts
git commit -m "chore(types): regenerate for folder invites and add folder members tag"
```

---

### Task 4: Board access copies and the board share dialog's folder rows

**Files:**

- Create: `src/lib/boards/folder-levels.ts`
- Create: `src/lib/boards/folder-levels.test.ts`
- Modify: `src/lib/boards/queries.ts:153-197`
- Modify: `src/lib/boards/queries.test.ts` (inside `describe("deriveBoardAccess"`, `:109`)
- Modify: `src/app/(app)/boards/[boardId]/page.tsx:34-117`
- Modify: `src/lib/reports/core.ts:76-111`
- Modify: `src/lib/reports/access.ts:169-199`
- Modify: `src/lib/validations/board-sharing.ts`
- Modify: `src/lib/boards/sharing-actions.ts`, `src/lib/boards/sharing-actions.test.ts`
- Modify: `src/components/boards/ShareBoardDialog.tsx`, `src/components/boards/ShareBoardDialog.test.tsx`
- Modify: `src/lib/ai/agentic/actions.ts:59-65`, `src/lib/ai/agentic/actions.test.ts`

`BoardHeader.tsx` is **not** edited. The share grants reach the dialog through five components and seven `<BoardHeader>` call sites (`page.tsx:136` → `BoardViews.tsx:252-279` → `BoardTableInner.tsx:784`, `KanbanBoard.tsx:259,322`, `CalendarBoard.tsx:191,312`, `GanttBoard.tsx:362,490` → `BoardHeader.tsx:374`). Threading a second prop the same way would touch all of them, and it would put a read on every board's first paint for a dialog only owners open (`BoardHeader.tsx:370`). The dialog loads its folder rows itself when it opens.

**Interfaces:**

- Consumes: RPCs `my_folder_board_levels`, `board_folder_grants`; `typedRpc`.
- Produces:
  - `type FolderLevel = "editor" | "viewer"`
  - `type FolderGrant = { userId: string; access: FolderLevel; folderName: string }`
  - `listMyFolderBoardLevels(supabase: SupabaseClient<Database>, boardIds: string[]): Promise<Map<string, FolderLevel>>`
  - `higherAccess(direct: FolderLevel | null, folder: FolderLevel | null): FolderLevel | null`
  - `deriveBoardAccess(board, grants, userId, folderLevel?: FolderLevel | null)` (fourth argument optional, default `null`)
  - `loadBoardFolderGrants(input: unknown): Promise<ActionResult<FolderGrant[]>>` in `src/lib/boards/sharing-actions.ts`

- [ ] **Step 1: Write the failing tests for the pure rule**

Create `src/lib/boards/folder-levels.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { higherAccess, listMyFolderBoardLevels } from "./folder-levels";

describe("higherAccess", () => {
  it("returns null when there is neither a direct nor a folder grant", () => {
    expect(higherAccess(null, null)).toBeNull();
  });
  it("returns the only grant present", () => {
    expect(higherAccess("viewer", null)).toBe("viewer");
    expect(higherAccess(null, "editor")).toBe("editor");
  });
  it("returns editor when either side is editor", () => {
    expect(higherAccess("viewer", "editor")).toBe("editor");
    expect(higherAccess("editor", "viewer")).toBe("editor");
  });
});

describe("listMyFolderBoardLevels", () => {
  it("does not call the database for an empty id list", async () => {
    const rpc = vi.fn();
    const levels = await listMyFolderBoardLevels({ rpc } as never, []);
    expect(levels.size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps rows by board id", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ board_id: "b1", access_level: "editor" }],
      error: null,
    }));
    const levels = await listMyFolderBoardLevels({ rpc } as never, [
      "b1",
      "b2",
    ]);
    expect(rpc).toHaveBeenCalledWith("my_folder_board_levels", {
      p_board_ids: ["b1", "b2"],
    });
    expect(levels.get("b1")).toBe("editor");
    expect(levels.has("b2")).toBe(false);
  });
  it("fails closed to no folder access when the read errors or throws", async () => {
    const erroring = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "x" } })),
    };
    expect(
      (await listMyFolderBoardLevels(erroring as never, ["b1"])).size,
    ).toBe(0);
    const throwing = {} as never; // a test double with no rpc at all
    expect((await listMyFolderBoardLevels(throwing, ["b1"])).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/boards/folder-levels.test.ts`
Expected: FAIL, cannot resolve `./folder-levels`.

- [ ] **Step 3: Implement `folder-levels.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { typedRpc } from "@/lib/supabase/typed-rpc";

export type FolderLevel = "editor" | "viewer";

/** One person's access to a board through the board's folder. */
export type FolderGrant = {
  userId: string;
  access: FolderLevel;
  folderName: string;
};

/** The higher of a direct board grant and a folder grant. Editor beats viewer. */
export function higherAccess(
  direct: FolderLevel | null,
  folder: FolderLevel | null,
): FolderLevel | null {
  if (direct === "editor" || folder === "editor") return "editor";
  return direct ?? folder ?? null;
}

/**
 * The CALLER's folder-derived level on each of these boards, for boards that
 * sit in a folder the caller is a member of. The RPC resolves the caller from
 * `auth.uid()`, so the client must be the caller's own (cookie or bridged MCP)
 * client, never the service client.
 *
 * Fails closed: an error, or a test double without `rpc`, yields no folder
 * access rather than an exception on a page that would otherwise render.
 */
export async function listMyFolderBoardLevels(
  supabase: SupabaseClient<Database>,
  boardIds: string[],
): Promise<Map<string, FolderLevel>> {
  const levels = new Map<string, FolderLevel>();
  if (boardIds.length === 0) return levels;
  try {
    const { data, error } = await typedRpc(supabase, "my_folder_board_levels", {
      p_board_ids: boardIds,
    });
    if (error || !data) return levels;
    for (const row of data) levels.set(row.board_id, row.access_level);
  } catch {
    return levels;
  }
  return levels;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/lib/boards/folder-levels.test.ts`
Expected: PASS.

- [ ] **Step 5: Add failing cases for `deriveBoardAccess`**

In `src/lib/boards/queries.test.ts`, inside `describe("deriveBoardAccess", () => {` (`:109`), after its last existing `it`, add:

```ts
it("gives a folder member with no direct grant their folder level", () => {
  expect(deriveBoardAccess({ created_by: "owner" }, [], "u1", "viewer")).toBe(
    "viewer",
  );
});
it("takes the higher of a direct grant and a folder grant", () => {
  const direct = [{ userId: "u1", access: "viewer" as const }];
  expect(
    deriveBoardAccess({ created_by: "owner" }, direct, "u1", "editor"),
  ).toBe("editor");
});
it("still reports the creator as owner whatever the folder level", () => {
  expect(deriveBoardAccess({ created_by: "u1" }, [], "u1", "viewer")).toBe(
    "owner",
  );
});
it("is unchanged when no folder level is passed", () => {
  expect(deriveBoardAccess({ created_by: "owner" }, [], "u1")).toBeNull();
});
```

Run: `pnpm vitest run src/lib/boards/queries.test.ts`
Expected: the first two new tests FAIL (a fourth argument is ignored today).

- [ ] **Step 6: Change `queries.ts`**

Add to the imports at the top of `src/lib/boards/queries.ts`:

```ts
import {
  higherAccess,
  listMyFolderBoardLevels,
  type FolderLevel,
} from "@/lib/boards/folder-levels";
```

In `getBoardAccessCore` (`:153`), replace everything from the line `if (board.created_by === userId) return "owner";` to the function's closing brace with:

```ts
  if (board.created_by === userId) return "owner";
  const [{ data: grant }, folderLevels] = await Promise.all([
    supabase
      .from("board_members")
      .select("access_level")
      .eq("board_id", boardId)
      .eq("user_id", userId)
      .maybeSingle(),
    // Resolved from auth.uid() by the RPC: `supabase` is the caller's own
    // client on both the cookie path and the bridged MCP path.
    listMyFolderBoardLevels(supabase, [boardId]),
  ]);
  return higherAccess(
    grant?.access_level ?? null,
    folderLevels.get(boardId) ?? null,
  );
}
```

Replace `deriveBoardAccess` (`:189-196`) with:

```ts
export function deriveBoardAccess(
  board: Pick<Board, "created_by">,
  grants: { userId: string; access: "editor" | "viewer" }[],
  userId: string,
  folderLevel: FolderLevel | null = null,
): "owner" | "editor" | "viewer" | null {
  if (board.created_by === userId) return "owner";
  return higherAccess(
    grants.find((g) => g.userId === userId)?.access ?? null,
    folderLevel,
  );
}
```

and append to its doc comment: "The optional `folderLevel` is the caller's level through the board's folder (`listMyFolderBoardLevels`); the result is the higher of the two."

Run: `pnpm vitest run src/lib/boards/queries.test.ts`
Expected: PASS, including the existing "getBoardAccess ... resolves owner" test. That file's client double (`:25-50`) has no `rpc`, which `listMyFolderBoardLevels` treats as no folder access, so the double needs no change.

- [ ] **Step 7: Board page**

In `src/app/(app)/boards/[boardId]/page.tsx`:

Add the import:

```ts
import { listMyFolderBoardLevels } from "@/lib/boards/folder-levels";
```

In the destructuring of the `Promise.all` (`:34-41`), add `folderLevels,` as the last element after `activeRoster,`. In the array, after the `resolveActiveOrg()...catch(() => null),` entry (`:74-76`), add:

```ts
    // The caller's level through the board's folder. One more read in the
    // wave that already exists; primary-key lookups on folder_boards and
    // folder_members.
    listMyFolderBoardLevels(supabase, [boardId]),
```

Replace `const access = deriveBoardAccess(payload.board, grants, user.id);` (`:117`) with:

```ts
const access = deriveBoardAccess(
  payload.board,
  grants,
  user.id,
  folderLevels.get(boardId) ?? null,
);
```

Nothing else on the page changes. `<BoardViews ... grants={grants} />` stays as it is.

- [ ] **Step 8: Reports**

In `src/lib/reports/core.ts` add `import { listMyFolderBoardLevels } from "@/lib/boards/folder-levels";`. In `canEditAllBoards`, replace the `Promise.all` (`:83-90`) with:

```ts
const [boardsRes, grantsRes, folderLevels] = await Promise.all([
  supabase.from("boards").select("id, created_by, org_id").in("id", ids),
  supabase
    .from("board_members")
    .select("board_id, user_id, access_level")
    .in("board_id", ids)
    .eq("user_id", userId),
  listMyFolderBoardLevels(supabase, ids),
]);
```

and the `return canEditReports(...)` inside `ids.every` (`:108-110`) with:

```ts
return canEditReports(
  deriveBoardAccess(
    board,
    grantsByBoard.get(id) ?? [],
    userId,
    folderLevels.get(id) ?? null,
  ),
);
```

In `src/lib/reports/access.ts` add the same import. In `resolveReportAccessCore`, replace the inner `Promise.all` (`:169-176`) with:

```ts
const [boardsRes, grantsRes, folderLevels] = await Promise.all([
  supabase.from("boards").select("id, created_by").in("id", boardIds),
  supabase
    .from("board_members")
    .select("board_id, user_id, access_level")
    .in("board_id", boardIds)
    .eq("user_id", user.id),
  listMyFolderBoardLevels(supabase, boardIds),
]);
```

and the derivation (`:195-197`) with:

```ts
        board
          ? deriveBoardAccess(
              board,
              grantsByBoard.get(id) ?? [],
              user.id,
              folderLevels.get(id) ?? null,
            )
          : null,
```

Run: `pnpm vitest run src/lib/reports`
Expected: PASS. Doubles without `rpc` fail closed, so existing report tests need no change.

- [ ] **Step 9: `loadBoardFolderGrants` — failing test, then the action**

In `src/lib/validations/board-sharing.ts`, after `unshareBoardSchema`, add:

```ts
export const boardFolderGrantsSchema = z.object({
  boardId: z.string().uuid(),
});
```

In `src/lib/boards/sharing-actions.test.ts`, change the import on line 2 to:

```ts
import {
  loadBoardFolderGrants,
  shareBoard,
  unshareBoard,
} from "./sharing-actions";
```

and append at the end of the file:

```ts
describe("loadBoardFolderGrants", () => {
  it("rejects a malformed board id without calling the database", async () => {
    const r = await loadBoardFolderGrants({ boardId: "nope" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the rpc rows to folder grants", async () => {
    rpc.mockResolvedValue({
      data: [{ user_id: "u2", access_level: "editor", folder_name: "DAAS" }],
      error: null,
    });
    const boardId = crypto.randomUUID();
    const r = await loadBoardFolderGrants({ boardId });
    expect(rpc).toHaveBeenCalledWith("board_folder_grants", {
      p_board_id: boardId,
    });
    expect(r).toEqual({
      ok: true,
      data: [{ userId: "u2", access: "editor", folderName: "DAAS" }],
    });
  });

  it("does not pass a database message through", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "relation x" } });
    const r = await loadBoardFolderGrants({ boardId: crypto.randomUUID() });
    expect(r).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
  });
});
```

Run: `pnpm vitest run src/lib/boards/sharing-actions.test.ts`
Expected: FAIL, `loadBoardFolderGrants` is not exported.

In `src/lib/boards/sharing-actions.ts`, change the validation import to:

```ts
import {
  boardFolderGrantsSchema,
  shareBoardSchema,
  unshareBoardSchema,
} from "@/lib/validations/board-sharing";
```

add:

```ts
import { typedRpc } from "@/lib/supabase/typed-rpc";
import type { FolderGrant } from "@/lib/boards/folder-levels";
```

and append:

```ts
/**
 * Everyone who reaches this board through its folder. Loaded by the share
 * dialog when it opens, so the board page's first paint pays nothing for it.
 * The RPC returns rows only to a caller who can read the board.
 */
export async function loadBoardFolderGrants(
  input: unknown,
): Promise<ActionResult<FolderGrant[]>> {
  const parsed = boardFolderGrantsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");
  const supabase = await createClient();
  const { data, error } = await typedRpc(supabase, "board_folder_grants", {
    p_board_id: parsed.data.boardId,
  });
  if (error) return fail("Something went wrong. Please try again.");
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      userId: r.user_id,
      access: r.access_level,
      folderName: r.folder_name,
    })),
  };
}
```

Run: `pnpm vitest run src/lib/boards/sharing-actions.test.ts src/test/use-server-exports.test.ts`
Expected: PASS.

- [ ] **Step 10: Failing test for the dialog's folder rows**

Load the `pulse-ui` and `frontend-design` skills now. In `src/components/boards/ShareBoardDialog.test.tsx`:

Replace the mock block (`:5-10`) with:

```tsx
const shareBoard = vi.fn();
const unshareBoard = vi.fn();
const loadBoardFolderGrants = vi.fn();
vi.mock("@/lib/boards/sharing-actions", () => ({
  shareBoard: (...a: unknown[]) => shareBoard(...a),
  unshareBoard: (...a: unknown[]) => unshareBoard(...a),
  loadBoardFolderGrants: (...a: unknown[]) => loadBoardFolderGrants(...a),
}));
```

Replace the `beforeEach` with:

```tsx
beforeEach(() => {
  shareBoard.mockReset();
  unshareBoard.mockReset();
  loadBoardFolderGrants.mockReset();
  // The dialog reads folder grants on open; default to "none" so every
  // existing test sees the dialog exactly as before.
  loadBoardFolderGrants.mockResolvedValue({ ok: true, data: [] });
});
```

Append inside `describe("ShareBoardDialog", () => {`:

```tsx
it("shows who reaches the board through its folder, read-only", async () => {
  loadBoardFolderGrants.mockResolvedValue({
    ok: true,
    data: [{ userId: "u2", access: "editor", folderName: "DAAS" }],
  });
  render(
    <ShareBoardDialog
      boardId="b1"
      members={members}
      grants={[]}
      open
      onOpenChange={() => {}}
    />,
  );
  expect(
    await screen.findByText("Through folder DAAS · Editor"),
  ).toBeInTheDocument();
  expect(loadBoardFolderGrants).toHaveBeenCalledWith({ boardId: "b1" });
  // The direct-grant control for that person is still there, still "No access".
  expect(screen.getByLabelText("Access for Sam Roe")).toHaveValue("none");
});

it("counts a folder-only person as someone the board is shared with", async () => {
  loadBoardFolderGrants.mockResolvedValue({
    ok: true,
    data: [{ userId: "u2", access: "viewer", folderName: "DAAS" }],
  });
  render(
    <ShareBoardDialog
      boardId="b1"
      members={members}
      grants={[]}
      open
      onOpenChange={() => {}}
    />,
  );
  expect(await screen.findByText("Shared with 1 person.")).toBeInTheDocument();
});

it("does not load folder grants while closed", () => {
  render(
    <ShareBoardDialog
      boardId="b1"
      members={members}
      grants={[]}
      open={false}
      onOpenChange={() => {}}
    />,
  );
  expect(loadBoardFolderGrants).not.toHaveBeenCalled();
});
```

Run: `pnpm vitest run src/components/boards/ShareBoardDialog.test.tsx`
Expected: the three new tests FAIL.

- [ ] **Step 11: Implement the folder rows**

In `src/components/boards/ShareBoardDialog.tsx`:

Change the first two imports to:

```tsx
import { useEffect, useState, useTransition } from "react";
import { ChevronDown, UsersRound } from "lucide-react";
import {
  loadBoardFolderGrants,
  shareBoard,
  unshareBoard,
} from "@/lib/boards/sharing-actions";
import type { FolderGrant } from "@/lib/boards/folder-levels";
```

Inside the component, directly after `const status = useFieldStatus(error);`, add:

```tsx
// People who reach this board through its folder. Read when the dialog
// opens (owners only ever open it), never on the board's first paint. A
// failed read leaves the list empty; the direct grants above still work.
const [folderGrants, setFolderGrants] = useState<FolderGrant[]>([]);
useEffect(() => {
  if (!open) return;
  let live = true;
  void loadBoardFolderGrants({ boardId }).then((r) => {
    if (live && r.ok) setFolderGrants(r.data);
  });
  return () => {
    live = false;
  };
}, [open, boardId]);
const viaFolder = new Map(folderGrants.map((g) => [g.userId, g]));
```

Replace the `sharedCount` computation with:

```tsx
const sharedCount = members.reduce(
  (n, m) =>
    n +
    ((access.get(m.userId) ?? "none") !== "none" || viaFolder.has(m.userId)
      ? 1
      : 0),
  0,
);
```

Inside the member row, directly after the `{secondary && ( ... )}` block and still inside `<span className="min-w-0 flex-1">`, add:

```tsx
{
  viaFolder.has(m.userId) && (
    <span className="text-muted-foreground block truncate text-xs">
      Through folder {viaFolder.get(m.userId)!.folderName} ·{" "}
      {viaFolder.get(m.userId)!.access === "editor" ? "Editor" : "Viewer"}
    </span>
  );
}
```

Run: `pnpm vitest run src/components/boards/ShareBoardDialog.test.tsx`
Expected: PASS, all tests.

- [ ] **Step 12: Close the "Test this step" service-client read**

`previewAiStep` (`src/lib/ai/agentic/actions.ts:42`) reads the board and its newest item with the service client and checks only that the board is in the caller's active org (`:59-65`). Any org member, a guest included, could read the newest item's name and the board's context on a board they cannot open. Add the caller's own access check.

In `src/lib/ai/agentic/actions.test.ts`, next to the other `vi.mock` calls (after the `./context` mock, `:58-61`), add:

```ts
// The caller's own access to the board (the service client bypasses RLS).
const getBoardAccess = vi.fn();
vi.mock("@/lib/boards/queries", () => ({
  getBoardAccess: (...args: unknown[]) => getBoardAccess(...args),
}));
```

In the file's `beforeEach` (`:108`), after `buildJobContext.mockReset();`, add:

```ts
getBoardAccess.mockReset();
getBoardAccess.mockResolvedValue("owner");
```

Append a new `describe` at the end of the file:

```ts
describe("previewAiStep — the caller must be able to edit the board", () => {
  it("refuses someone with no access to the board, before any item or model work", async () => {
    getBoardAccess.mockResolvedValue(null);
    const r = await previewAiStep(validInput());
    expect(r).toEqual({ ok: false, error: "Board not found." });
    expect(buildJobContext).not.toHaveBeenCalled();
    expect(decideAction).not.toHaveBeenCalled();
  });

  it("refuses a viewer", async () => {
    getBoardAccess.mockResolvedValue("viewer");
    const r = await previewAiStep(validInput());
    expect(r).toEqual({ ok: false, error: "Board not found." });
    expect(decideAction).not.toHaveBeenCalled();
  });

  it("lets an editor through", async () => {
    getBoardAccess.mockResolvedValue("editor");
    const r = await previewAiStep(validInput());
    expect(r.ok).toBe(true);
    expect(getBoardAccess).toHaveBeenCalledWith(BOARD_ID);
  });
});
```

`previewAiStep` is already imported by that file's existing tests; if it is imported lower in the file than the new mock, leave the import where it is (`vi.mock` is hoisted).

Run: `pnpm vitest run src/lib/ai/agentic/actions.test.ts`
Expected: the first two new tests FAIL.

In `src/lib/ai/agentic/actions.ts` add the import:

```ts
import { getBoardAccess } from "@/lib/boards/queries";
```

and directly after the line `if (!board || board.org_id !== org.id) return fail("Board not found.");` add:

```ts
// The service client bypasses RLS, so the caller's own access is checked
// explicitly: this preview reads the board's newest item and its context.
// Same answer as a board that does not exist, so it confirms nothing.
const access = await getBoardAccess(boardId);
if (access !== "owner" && access !== "editor") return fail("Board not found.");
```

Run: `pnpm vitest run src/lib/ai/agentic/actions.test.ts`
Expected: PASS, all tests.

- [ ] **Step 13: Run the affected tests and typecheck**

Run: `pnpm vitest run src/components/boards src/lib/boards src/lib/reports src/lib/ai/agentic`
Run: `pnpm typecheck`
Expected: PASS for both.

- [ ] **Step 14: Report for commit**

```bash
git add src/lib/boards/folder-levels.ts src/lib/boards/folder-levels.test.ts src/lib/boards/queries.ts \
  src/lib/boards/queries.test.ts "src/app/(app)/boards/[boardId]/page.tsx" src/lib/reports/core.ts \
  src/lib/reports/access.ts src/lib/validations/board-sharing.ts src/lib/boards/sharing-actions.ts \
  src/lib/boards/sharing-actions.test.ts src/components/boards/ShareBoardDialog.tsx \
  src/components/boards/ShareBoardDialog.test.tsx src/lib/ai/agentic/actions.ts \
  src/lib/ai/agentic/actions.test.ts
git commit -m "feat(boards): resolve board access through folder membership"
```

---

### Task 5: Sidebar and cached copies of the access rule

**Files:**

- Create: `src/lib/boards/shared-merge.ts`, `src/lib/boards/shared-merge.test.ts`
- Create: `src/lib/folders/nav-filter.ts`, `src/lib/folders/nav-filter.test.ts`
- Create: `src/lib/folders/access-cached.ts`
- Modify: `src/lib/boards/queries-cached.ts:43-76`
- Modify: `src/lib/boards/queries.ts` (`listSharedBoards`, starts at `:109`)
- Modify: `src/lib/portfolios/queries-cached.ts:24-64`
- Modify: `src/components/shell/sidebar-nav-data.tsx`
- Modify: `src/components/shell/sidebar-nav-data.test.tsx` (add one mock)
- Modify: `src/lib/boards/queries-cached.test.ts` (new `describe`)
- Modify: `src/components/shell/command-palette-data.tsx:16-30`, `src/components/shell/command-palette-data.test.tsx` (add one mock)
- Modify: `src/app/(app)/dashboards/page.tsx:15-31`, `:44-48`

**Interfaces:**

- Consumes: `folderMembersTag` (Task 3), `orgAdminTag`, `sharedBoardsTag`, `SharedBoardEntry`, `FolderNavData`.
- Produces:
  - `mergeSharedBoards(direct: SharedBoardEntry[], viaFolder: SharedBoardEntry[]): SharedBoardEntry[]`
  - `visibleFolders<T extends { id: string }>(folders: T[], opts: { isGuest: boolean; memberFolderIds: ReadonlySet<string> }): T[]`
  - `filterFolderNav(data: FolderNavData, opts: { isGuest: boolean; memberFolderIds: ReadonlySet<string>; readableBoardIds: ReadonlySet<string> }): FolderNavData`
  - `getFolderAccessForUserCached(userId: string, orgId: string): Promise<{ isGuest: boolean; folderIds: string[] }>`

- [ ] **Step 1: Failing tests for the two pure functions**

`src/lib/boards/shared-merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeSharedBoards } from "./shared-merge";

const entry = (id: string, level: "viewer" | "editor", position = 0) => ({
  id,
  name: `Board ${id}`,
  position,
  owner_name: "Owner",
  access_level: level,
});

describe("mergeSharedBoards", () => {
  it("keeps direct grants and adds boards reached only through a folder", () => {
    const out = mergeSharedBoards(
      [entry("a", "viewer")],
      [entry("b", "editor")],
    );
    expect(out.map((b) => b.id)).toEqual(["a", "b"]);
  });
  it("lists a board once, at the higher level", () => {
    const out = mergeSharedBoards(
      [entry("a", "viewer")],
      [entry("a", "editor")],
    );
    expect(out).toHaveLength(1);
    expect(out[0].access_level).toBe("editor");
  });
  it("does not lower a direct editor grant to a folder viewer grant", () => {
    const out = mergeSharedBoards(
      [entry("a", "editor")],
      [entry("a", "viewer")],
    );
    expect(out[0].access_level).toBe("editor");
  });
});
```

`src/lib/folders/nav-filter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterFolderNav, visibleFolders } from "./nav-filter";

const data = {
  folders: [
    { id: "f1", name: "DAAS", workspaceId: "w", orgId: "o", position: 0 },
    { id: "f2", name: "CRM", workspaceId: "w", orgId: "o", position: 1 },
  ],
  placements: [
    { boardId: "b1", folderId: "f1", position: 0 },
    { boardId: "b2", folderId: "f1", position: 1 },
    { boardId: "b3", folderId: "f2", position: 0 },
  ],
};

describe("filterFolderNav", () => {
  it("shows a regular member every folder but only placements of boards they can read", () => {
    const out = filterFolderNav(data, {
      isGuest: false,
      memberFolderIds: new Set(),
      readableBoardIds: new Set(["b1"]),
    });
    expect(out.folders.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(out.placements.map((p) => p.boardId)).toEqual(["b1"]);
  });
  it("shows a guest only the folders they are a member of", () => {
    const out = filterFolderNav(data, {
      isGuest: true,
      memberFolderIds: new Set(["f1"]),
      readableBoardIds: new Set(["b1", "b2", "b3"]),
    });
    expect(out.folders.map((f) => f.id)).toEqual(["f1"]);
    expect(out.placements.map((p) => p.boardId)).toEqual(["b1", "b2"]);
  });
  it("gives a guest with no folders nothing", () => {
    const out = filterFolderNav(data, {
      isGuest: true,
      memberFolderIds: new Set(),
      readableBoardIds: new Set(),
    });
    expect(out).toEqual({ folders: [], placements: [] });
  });
});

describe("visibleFolders", () => {
  const names = [
    { id: "f1", name: "DAAS" },
    { id: "f2", name: "CRM" },
  ];
  it("returns every folder for a regular member", () => {
    expect(
      visibleFolders(names, { isGuest: false, memberFolderIds: new Set() }),
    ).toEqual(names);
  });
  it("returns only a guest's folders", () => {
    expect(
      visibleFolders(names, {
        isGuest: true,
        memberFolderIds: new Set(["f2"]),
      }),
    ).toEqual([{ id: "f2", name: "CRM" }]);
  });
});
```

Run: `pnpm vitest run src/lib/boards/shared-merge.test.ts src/lib/folders/nav-filter.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 2: Implement the two pure functions**

`src/lib/boards/shared-merge.ts`:

```ts
import type { SharedBoardEntry } from "@/lib/boards/queries";

/**
 * One "Shared with me" list out of boards granted directly and boards reached
 * through a folder. A board appears once, at the higher level; direct grants
 * keep their order and folder-only boards follow.
 */
export function mergeSharedBoards(
  direct: SharedBoardEntry[],
  viaFolder: SharedBoardEntry[],
): SharedBoardEntry[] {
  const byId = new Map<string, SharedBoardEntry>();
  for (const b of direct) byId.set(b.id, b);
  for (const b of viaFolder) {
    const existing = byId.get(b.id);
    if (!existing) byId.set(b.id, b);
    else if (existing.access_level === "viewer" && b.access_level === "editor")
      byId.set(b.id, { ...existing, access_level: "editor" });
  }
  return [...byId.values()];
}
```

`src/lib/folders/nav-filter.ts`:

```ts
import type { FolderNavData } from "./types";

/**
 * The folders one user may see out of an org-wide list: all of them for a
 * regular member, only the ones they are a member of for a guest. Every caller
 * of the org-cached `listFoldersCached` passes its result through this (or
 * through `filterFolderNav`, which also narrows placements).
 */
export function visibleFolders<T extends { id: string }>(
  folders: T[],
  opts: { isGuest: boolean; memberFolderIds: ReadonlySet<string> },
): T[] {
  return opts.isGuest
    ? folders.filter((f) => opts.memberFolderIds.has(f.id))
    : folders;
}

/**
 * What one user may see of a workspace's folders. `listFoldersCached` is cached
 * per org on the service client, so it returns every folder and every
 * placement; this narrows it per user:
 *  - a guest sees only folders they are a member of;
 *  - nobody receives the placement of a board they cannot read (those ids used
 *    to reach the page payload).
 */
export function filterFolderNav(
  data: FolderNavData,
  opts: {
    isGuest: boolean;
    memberFolderIds: ReadonlySet<string>;
    readableBoardIds: ReadonlySet<string>;
  },
): FolderNavData {
  const folders = visibleFolders(data.folders, opts);
  const visible = new Set(folders.map((f) => f.id));
  return {
    folders,
    placements: data.placements.filter(
      (p) => visible.has(p.folderId) && opts.readableBoardIds.has(p.boardId),
    ),
  };
}
```

Run the two test files. Expected: PASS.

- [ ] **Step 3: `access-cached.ts`**

```ts
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { folderMembersTag, orgAdminTag } from "@/lib/cache/tags";

const FOLDER_MEMBERSHIPS_LIMIT = 500;

/**
 * Whether `userId` is a guest of `orgId`, and which of that org's folders they
 * are a member of. Service client: the explicit `user_id` + `org_id` filters
 * are the tenant boundary. Fails closed to "guest with no folders".
 *
 * Tags: `folderMembersTag(userId)` (share, unshare, redeem) and
 * `orgAdminTag(userId, orgId)`, which every role change already invalidates.
 */
export async function getFolderAccessForUserCached(
  userId: string,
  orgId: string,
): Promise<{ isGuest: boolean; folderIds: string[] }> {
  "use cache";
  cacheLife("nav");
  cacheTag(folderMembersTag(userId), orgAdminTag(userId, orgId));

  const supabase = createServiceClient();
  const [roleRes, foldersRes] = await Promise.all([
    supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .is("deactivated_at", null)
      .maybeSingle(),
    supabase
      .from("folder_members")
      .select("folder_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .limit(FOLDER_MEMBERSHIPS_LIMIT),
  ]);
  if (roleRes.error || !roleRes.data) return { isGuest: true, folderIds: [] };
  return {
    isGuest: roleRes.data.role === "guest",
    folderIds: (foldersRes.data ?? []).map((r) => r.folder_id),
  };
}
```

- [ ] **Step 4: Sidebar loader**

In `src/components/shell/sidebar-nav-data.tsx` add:

```ts
import { getFolderAccessForUserCached } from "@/lib/folders/access-cached";
import { filterFolderNav } from "@/lib/folders/nav-filter";
```

Change the folders wave and the returned folder fields:

```ts
const [boards, sharedBoards, folderData, folderAccess] = await Promise.all([
  listMyBoardsCached(userId, activeWorkspaceId),
  listSharedBoardsCached(userId),
  listFoldersCached(orgId, activeWorkspaceId),
  getFolderAccessForUserCached(userId, orgId),
]);

// Per-user narrowing of the org-wide cached folder read: a guest gets only
// their folders, and no one gets the placement of a board they cannot read.
const visibleFolders = folderData
  ? filterFolderNav(folderData, {
      isGuest: folderAccess.isGuest,
      memberFolderIds: new Set(folderAccess.folderIds),
      readableBoardIds: new Set([
        ...boards.map((b) => b.id),
        ...sharedBoards.map((b) => b.id),
      ]),
    })
  : null;
```

and replace `folders: folderData?.folders,` / `placements: folderData?.placements,` with `folders: visibleFolders?.folders,` / `placements: visibleFolders?.placements,`. Keep the existing comment about the `NO_FOLDERS` sentinel; it still applies.

In `src/components/shell/sidebar-nav-data.test.tsx`, next to the existing `vi.mock("@/lib/folders/queries-cached", ...)`, add:

```ts
vi.mock("@/lib/folders/access-cached", () => ({
  getFolderAccessForUserCached: vi.fn(async () => ({
    isGuest: false,
    folderIds: [],
  })),
}));
```

Run: `pnpm vitest run src/components/shell/sidebar-nav-data.test.tsx`
Expected: PASS. If a test asserted a placement for a board that is in neither mocked board list, that placement is now correctly dropped: add the board to the mocked `listMyBoardsCached` result rather than loosening the filter.

- [ ] **Step 5: "Shared with me" through a folder (cached, service client)**

There is no existing unit test for `listSharedBoardsCached` (it is only mocked, in `src/components/shell/sidebar-nav-data.test.tsx`). Add one first. In `src/lib/boards/queries-cached.test.ts`, change the import on the line `import { listMyBoardsCached } from "./queries-cached";` to:

```ts
import { listMyBoardsCached, listSharedBoardsCached } from "./queries-cached";
```

and append at the end of the file:

```ts
// Table-aware double for listSharedBoardsCached, which reads five tables.
// Every chain method returns the same thenable, so whichever call ends a chain
// (`.order()`, `.limit()`, `.is()`, `.in()`) resolves to that table's rows.
function makeTableClient(tables: Record<string, unknown[]>) {
  const seen: string[] = [];
  const from = (table: string) => {
    seen.push(table);
    const result = { data: tables[table] ?? [], error: null };
    const qb: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "limit", "order"]) {
      qb[m] = () => qb;
    }
    qb.then = (onFulfilled: (r: typeof result) => unknown) =>
      Promise.resolve(result).then(onFulfilled);
    return qb;
  };
  return { client: { from }, seen };
}

describe("listSharedBoardsCached", () => {
  const folderBoard = {
    folder_id: "f1",
    boards: { id: "b9", name: "Plan", position: 0, created_by: "someone" },
  };

  it("adds a board reached only through a folder, at the folder's level", async () => {
    const { client } = makeTableClient({
      board_members: [],
      org_members: [{ org_id: "o1" }],
      folder_members: [
        { folder_id: "f1", org_id: "o1", access_level: "editor" },
      ],
      folder_boards: [folderBoard],
      profiles: [{ id: "someone", full_name: "Sam Roe" }],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    expect(await listSharedBoardsCached("u1")).toEqual([
      {
        id: "b9",
        name: "Plan",
        position: 0,
        owner_name: "Sam Roe",
        access_level: "editor",
      },
    ]);
  });

  it("ignores a folder membership in an org the user is no longer active in", async () => {
    const { client, seen } = makeTableClient({
      board_members: [],
      org_members: [],
      folder_members: [
        { folder_id: "f1", org_id: "o1", access_level: "editor" },
      ],
      folder_boards: [folderBoard],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    expect(await listSharedBoardsCached("u1")).toEqual([]);
    // With no live folder membership the placements are never read at all.
    expect(seen).not.toContain("folder_boards");
  });

  it("lists a board once, at the higher level, when granted both ways", async () => {
    const { client } = makeTableClient({
      board_members: [
        {
          access_level: "viewer",
          boards: {
            id: "b9",
            name: "Plan",
            position: 0,
            created_by: "someone",
          },
        },
      ],
      org_members: [{ org_id: "o1" }],
      folder_members: [
        { folder_id: "f1", org_id: "o1", access_level: "editor" },
      ],
      folder_boards: [folderBoard],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const out = await listSharedBoardsCached("u1");
    expect(out).toHaveLength(1);
    expect(out[0].access_level).toBe("editor");
  });

  it("leaves out a board the user created, even inside their folder", async () => {
    const { client } = makeTableClient({
      board_members: [],
      org_members: [{ org_id: "o1" }],
      folder_members: [
        { folder_id: "f1", org_id: "o1", access_level: "viewer" },
      ],
      folder_boards: [
        {
          folder_id: "f1",
          boards: { id: "b1", name: "Mine", position: 0, created_by: "u1" },
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    expect(await listSharedBoardsCached("u1")).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/lib/boards/queries-cached.test.ts`
Expected: the first and third new tests FAIL (no folder path yet); the second and fourth pass.

In `src/lib/boards/queries-cached.ts` add `import { mergeSharedBoards } from "@/lib/boards/shared-merge";` and replace the whole body of `listSharedBoardsCached` after the line `const supabase = createServiceClient();` (that is, `:53-76`, through the closing brace) with:

```ts
  const [directRes, orgRes, folderRes] = await Promise.all([
    supabase
      .from("board_members")
      .select("access_level, boards!inner(id, name, position, created_by)")
      .eq("user_id", userId)
      .is("boards.archived_at", null)
      .order("created_at", { ascending: true }),
    // Active memberships only: a folder_members row left behind after someone
    // is removed from the org must grant nothing (the service client bypasses
    // the is_org_member check the SQL helpers make).
    supabase
      .from("org_members")
      .select("org_id")
      .eq("user_id", userId)
      .is("deactivated_at", null),
    supabase
      .from("folder_members")
      .select("folder_id, org_id, access_level")
      .eq("user_id", userId)
      .limit(500),
  ]);
  if (directRes.error || !directRes.data) return [];

  const activeOrgs = new Set((orgRes.data ?? []).map((r) => r.org_id));
  const levelByFolder = new Map(
    (folderRes.data ?? [])
      .filter((r) => activeOrgs.has(r.org_id))
      .map((r) => [r.folder_id, r.access_level] as const),
  );

  let folderRows: {
    folder_id: string;
    boards: { id: string; name: string; position: number; created_by: string };
  }[] = [];
  if (levelByFolder.size > 0) {
    const { data } = await supabase
      .from("folder_boards")
      .select("folder_id, boards!inner(id, name, position, created_by)")
      .in("folder_id", [...levelByFolder.keys()])
      .is("boards.archived_at", null)
      .limit(2000);
    folderRows = (data ?? []).filter((r) => r.boards.created_by !== userId);
  }

  const directRows = directRes.data.filter(
    (r) => r.boards && r.boards.created_by !== userId,
  );

  const ownerIds = [
    ...new Set([
      ...directRows.map((r) => r.boards.created_by),
      ...folderRows.map((r) => r.boards.created_by),
    ]),
  ];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ownerIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return mergeSharedBoards(
    directRows.map((r) => ({
      id: r.boards.id,
      name: r.boards.name,
      position: r.boards.position,
      owner_name: nameById.get(r.boards.created_by) ?? null,
      access_level: r.access_level,
    })),
    folderRows.map((r) => ({
      id: r.boards.id,
      name: r.boards.name,
      position: r.boards.position,
      owner_name: nameById.get(r.boards.created_by) ?? null,
      access_level: levelByFolder.get(r.folder_id)!,
    })),
  );
}
```

Add to the function's doc comment: "Also includes boards reached through a folder the user is a member of, in orgs where their membership is active."

Run: `pnpm vitest run src/lib/boards/queries-cached.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: `listSharedBoards` (RLS client) in `queries.ts`**

This is the uncached twin (`src/lib/boards/queries.ts:109-140`). It runs on the caller's RLS client, so `boards` RLS already enforces active org membership and no `org_members` read is needed. Add `import { mergeSharedBoards } from "@/lib/boards/shared-merge";` and replace the whole function with:

```ts
/**
 * Boards shared WITH the current user by someone else: granted directly, or
 * reached through a folder they are a member of.
 */
export async function listSharedBoards(): Promise<SharedBoardEntry[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_members")
    .select("access_level, boards!inner(id, name, position, created_by)")
    .eq("user_id", user.id)
    .is("boards.archived_at", null)
    .limit(MY_BOARDS_LIMIT)
    .order("created_at", { ascending: true });
  // Same fail-loud policy as listMyBoards: an error is not an empty list.
  if (error) throw new Error(`Failed to load shared boards: ${error.message}`);
  const rows = (data ?? []).filter(
    (r) => r.boards && r.boards.created_by !== user.id,
  );

  // Folder path. A failed read here degrades to "direct grants only" rather
  // than failing a list that is otherwise correct.
  const { data: memberships } = await supabase
    .from("folder_members")
    .select("folder_id, access_level")
    .eq("user_id", user.id)
    .limit(500);
  const levelByFolder = new Map(
    (memberships ?? []).map((r) => [r.folder_id, r.access_level] as const),
  );
  let folderRows: {
    folder_id: string;
    boards: { id: string; name: string; position: number; created_by: string };
  }[] = [];
  if (levelByFolder.size > 0) {
    const { data: placed } = await supabase
      .from("folder_boards")
      .select("folder_id, boards!inner(id, name, position, created_by)")
      .in("folder_id", [...levelByFolder.keys()])
      .is("boards.archived_at", null)
      .limit(MY_BOARDS_LIMIT);
    folderRows = (placed ?? []).filter(
      (r) => r.boards && r.boards.created_by !== user.id,
    );
  }

  const ownerIds = [
    ...new Set([
      ...rows.map((r) => r.boards.created_by),
      ...folderRows.map((r) => r.boards.created_by),
    ]),
  ];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ownerIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return mergeSharedBoards(
    rows.map((r) => ({
      id: r.boards.id,
      name: r.boards.name,
      position: r.boards.position,
      owner_name: nameById.get(r.boards.created_by) ?? null,
      access_level: r.access_level,
    })),
    folderRows.map((r) => ({
      id: r.boards.id,
      name: r.boards.name,
      position: r.boards.position,
      owner_name: nameById.get(r.boards.created_by) ?? null,
      access_level: levelByFolder.get(r.folder_id)!,
    })),
  );
}
```

Run: `pnpm vitest run src/lib/boards/queries.test.ts`
Expected: PASS with no test edits. That file's double (`:25-43`) returns `listState.result` for every table and has `in` and `limit`: the default empty list gives `[]`; the error case still throws on the first read, before the folder path. Its double is not table-aware, so the folder path of this twin is covered by the `mergeSharedBoards` tests (Step 1) and the cached twin's tests (Step 5), which share the same merge.

- [ ] **Step 6b: The other two callers of `listFoldersCached`**

`listFoldersCached` is cached per org on the service client and returns every folder. Besides the sidebar it is read by the command palette and by the folder gallery page, and both hand the names to the browser. Narrow both the same way.

`src/components/shell/command-palette-data.tsx` — add the imports:

```ts
import { getFolderAccessForUserCached } from "@/lib/folders/access-cached";
import { visibleFolders } from "@/lib/folders/nav-filter";
```

replace the `Promise.all` (`:20-23`) with:

```ts
const [boards, nav, folderAccess] = await Promise.all([
  listMyBoardsCached(userId),
  listFoldersCached(orgId, workspaceId),
  getFolderAccessForUserCached(userId, orgId),
]);
```

and the `folders=` prop (`:28`) with:

```tsx
      folders={visibleFolders(nav?.folders ?? [], {
        isGuest: folderAccess.isGuest,
        memberFolderIds: new Set(folderAccess.folderIds),
      }).map((f) => ({ id: f.id, name: f.name }))}
```

In `src/components/shell/command-palette-data.test.tsx`, after the `@/lib/folders/queries-cached` mock (`:26-39`), add:

```ts
vi.mock("@/lib/folders/access-cached", () => ({
  getFolderAccessForUserCached: vi.fn(async () => ({
    isGuest: false,
    folderIds: [],
  })),
}));
```

`src/app/(app)/dashboards/page.tsx` — add the same two imports. Change `await requireUser();` (`:16`) to `const user = await requireUser();`, replace the `Promise.all` (`:28-32`) with:

```ts
const [gallery, unfiled, nav, folderAccess] = await Promise.all([
  resolveFolderGallery(supabase, workspaceId),
  listUnfiledDashboards(supabase, workspaceId),
  listFoldersCached(orgId, workspaceId),
  getFolderAccessForUserCached(user.id, orgId),
]);
```

and the `folders=` prop of `<UnfiledDashboards` (`:47`) with:

```tsx
        folders={visibleFolders(nav?.folders ?? [], {
          isGuest: folderAccess.isGuest,
          memberFolderIds: new Set(folderAccess.folderIds),
        }).map((f) => ({ id: f.id, name: f.name }))}
```

The gallery cards themselves come from the `folder_gallery` RPC, which Task 1 narrows in SQL, and the unfiled list from an RLS read that Task 2 narrows.

`grep -rn "listFoldersCached(" src --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -v "queries-cached.ts"` must list exactly three call sites (`sidebar-nav-data.tsx`, `command-palette-data.tsx`, `dashboards/page.tsx`), each now followed by `visibleFolders` or `filterFolderNav`.

Run: `pnpm vitest run src/components/shell/command-palette-data.test.tsx src/lib/folders/nav-filter.test.ts`
Expected: PASS.

- [ ] **Step 7: Portfolio readable-boards copy**

In `src/lib/portfolios/queries-cached.ts`, extend the header comment's rule to: "readable = ACTIVE org member AND (creator OR board_members grant OR member of the board's folder)". Change the tag line to `cacheTag(boardsTag(userId), sharedBoardsTag(userId));` (unchanged) and the reads to:

```ts
const [own, shared, memberships] = await Promise.all([
  supabase
    .from("boards")
    .select("id, name, workspace_id")
    .eq("created_by", userId)
    .in("org_id", orgIds)
    .limit(READABLE_BOARDS_LIMIT),
  supabase
    .from("board_members")
    .select("boards!inner(id, name, workspace_id, org_id)")
    .eq("user_id", userId)
    .limit(READABLE_BOARDS_LIMIT),
  supabase
    .from("folder_members")
    .select("folder_id")
    .eq("user_id", userId)
    .in("org_id", orgIds)
    .limit(500),
]);

const folderIds = (memberships.data ?? []).map((r) => r.folder_id);
const viaFolder =
  folderIds.length > 0
    ? await supabase
        .from("folder_boards")
        .select("boards!inner(id, name, workspace_id, org_id)")
        .in("folder_id", folderIds)
        .limit(READABLE_BOARDS_LIMIT)
    : { data: [] };
```

and after the existing `for (const r of shared.data ?? [])` loop add:

```ts
for (const r of viaFolder.data ?? []) {
  const b = r.boards;
  if (b && orgIds.includes(b.org_id)) {
    byId.set(b.id, { id: b.id, name: b.name, workspaceId: b.workspace_id });
  }
}
```

Share and unshare of a folder invalidate `sharedBoardsTag(userId)` (Task 6), which this function is already tagged with.

- [ ] **Step 8: Run and report**

Run: `pnpm vitest run src/lib/boards src/lib/folders src/lib/portfolios src/components/shell`
Run: `pnpm typecheck`
Expected: PASS for both.

```bash
git add src/lib/boards/shared-merge.ts src/lib/boards/shared-merge.test.ts src/lib/folders/nav-filter.ts \
  src/lib/folders/nav-filter.test.ts src/lib/folders/access-cached.ts src/lib/boards/queries-cached.ts \
  src/lib/boards/queries.ts src/lib/portfolios/queries-cached.ts \
  src/components/shell/sidebar-nav-data.tsx src/components/shell/sidebar-nav-data.test.tsx \
  src/lib/boards/queries-cached.test.ts src/components/shell/command-palette-data.tsx \
  src/components/shell/command-palette-data.test.tsx "src/app/(app)/dashboards/page.tsx"
git commit -m "feat(shell): show folder-shared boards and confine guests in the sidebar"
```

---

### Task 6: Folder sharing Server Actions

**Files:**

- Create: `src/lib/validations/folder-sharing.ts`
- Create: `src/lib/folders/sharing-types.ts`
- Create: `src/lib/folders/sharing-queries.ts`
- Create: `src/lib/folders/sharing-actions.ts`
- Create: `src/lib/folders/sharing-actions.test.ts`
- Modify: `src/lib/validations/folders.ts` (`moveBoardToFolderSchema`)
- Modify: `src/lib/folders/actions.ts` (`deleteFolder` `:111-132`, `moveBoardToFolder` `:134-172`)
- Modify: `src/lib/folders/actions.test.ts`
- Modify: `src/lib/folders/types.ts` (`FolderPayload`), `src/lib/folders/payload.ts:34-78`, `src/lib/folders/fixture.ts`, `src/lib/folders/payload.test.ts`

**Interfaces:**

- Consumes: RPCs `share_folder`, `unshare_folder`, `invite_to_folder`, `revoke_folder_invitation`, `can_manage_folder`, `folder_invitation_states`; `folderMembersTag`, `sharedBoardsTag`; `listOrgMembersCached`.
- Produces (`sharing-types.ts`):

```ts
export type FolderLevel = "viewer" | "editor";
export type FolderAccessHead = {
  count: number;
  memberIds: string[];
  canManage: boolean;
};
export type FolderAccessEntry = {
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
  level: FolderLevel;
};
export type FolderInvitationEntry = {
  id: string;
  email: string;
  level: FolderLevel;
  state: "invited" | "awaiting_approval";
};
export type FolderCandidate = { userId: string; fullName: string | null };
export type FolderAccessData = {
  canManage: boolean;
  myUserId: string;
  members: FolderAccessEntry[];
  invitations: FolderInvitationEntry[];
  candidates: FolderCandidate[];
};
export type InviteOutcome =
  { kind: "shared" } | { kind: "invited"; emailSent: boolean };
```

- Produces (`sharing-actions.ts`): `loadFolderAccess({folderId})`, `shareFolder({folderId,userId,level})`, `unshareFolder({folderId,userId})`, `inviteToFolder({folderId,email,level}) → ActionResult<InviteOutcome>`, `revokeFolderInvitation({folderId,invitationId})`, `leaveFolder({folderId})`.
- Produces (`actions.ts`): `moveBoardToFolder({boardId, folderId, confirmShared?}) → ActionResult<{ needsConfirm: number } | undefined>`.
- Produces (`FolderPayload`): `access: FolderAccessHead`.

- [ ] **Step 1: Validation schemas**

`src/lib/validations/folder-sharing.ts`:

```ts
import * as z from "zod";

const uuid = z.string().uuid();
const level = z.enum(["viewer", "editor"]);

export const folderAccessSchema = z.object({ folderId: uuid });
export const shareFolderSchema = z.object({
  folderId: uuid,
  userId: uuid,
  level,
});
export const unshareFolderSchema = z.object({ folderId: uuid, userId: uuid });
export const inviteToFolderSchema = z.object({
  folderId: uuid,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: "Enter a valid email address" }),
  level,
});
export const revokeFolderInvitationSchema = z.object({
  folderId: uuid,
  invitationId: uuid,
});
```

In `src/lib/validations/folders.ts` change `moveBoardToFolderSchema` to:

```ts
export const moveBoardToFolderSchema = z.object({
  boardId: uuid,
  folderId: uuid.nullable(),
  // Set by the confirm step when the target folder has members (the move
  // gives those people access to the board).
  confirmShared: z.boolean().optional(),
});
```

- [ ] **Step 2: Types and the first-paint read**

`src/lib/folders/sharing-types.ts`: exactly the type block from **Interfaces** above, plus:

```ts
/** Cap on the avatar stack's first-paint read. */
export const FOLDER_ACCESS_HEAD_LIMIT = 50;
```

`src/lib/folders/sharing-queries.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import {
  FOLDER_ACCESS_HEAD_LIMIT,
  type FolderAccessHead,
} from "./sharing-types";

/**
 * First-paint read for the folder header: how many people the folder is shared
 * with, the first ids for the avatar stack, and whether the caller may manage
 * it. RLS client; a failure degrades to "nobody, cannot manage" rather than
 * failing the page.
 */
export async function getFolderAccessHead(
  supabase: SupabaseClient<Database>,
  folderId: string,
): Promise<FolderAccessHead> {
  const [membersRes, manageRes] = await Promise.all([
    supabase
      .from("folder_members")
      .select("user_id", { count: "exact" })
      .eq("folder_id", folderId)
      .order("created_at", { ascending: true })
      .limit(FOLDER_ACCESS_HEAD_LIMIT),
    typedRpc(supabase, "can_manage_folder", { p_folder_id: folderId }),
  ]);
  const memberIds = (membersRes.data ?? []).map((r) => r.user_id);
  return {
    count: membersRes.count ?? memberIds.length,
    memberIds,
    canManage: manageRes.data === true,
  };
}
```

- [ ] **Step 3: Failing tests for the actions**

`src/lib/folders/sharing-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));

const rpc = vi.fn();
const fromResult: { data: unknown; error: unknown } = {
  data: { id: "f1", org_id: "o1" },
  error: null,
};
const deleteEq = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => fromResult }),
      }),
      delete: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: async (c2: string, v2: unknown) => {
            deleteEq(c1, v1, c2, v2);
            return { error: null };
          },
        }),
      }),
    }),
  })),
}));

const inviteUserByEmail = vi.fn();
const auditInsert = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    auth: { admin: { inviteUserByEmail: (e: string) => inviteUserByEmail(e) } },
    from: () => ({ insert: auditInsert }),
  })),
}));

import {
  inviteToFolder,
  leaveFolder,
  revokeFolderInvitation,
  shareFolder,
  unshareFolder,
} from "./sharing-actions";

const F = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  updateTag.mockReset();
  rpc.mockReset();
  inviteUserByEmail.mockReset();
  auditInsert.mockClear();
  deleteEq.mockReset();
});

describe("shareFolder", () => {
  it("rejects a malformed id without calling the database", async () => {
    const r = await shareFolder({
      folderId: "nope",
      userId: U,
      level: "viewer",
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("calls share_folder and invalidates the grantee's lists", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await shareFolder({ folderId: F, userId: U, level: "editor" });
    expect(r).toEqual({ ok: true, data: undefined });
    expect(rpc).toHaveBeenCalledWith("share_folder", {
      p_folder_id: F,
      p_user_id: U,
      p_level: "editor",
    });
    expect(updateTag).toHaveBeenCalledWith(`shared-boards:user:${U}`);
    expect(updateTag).toHaveBeenCalledWith(`folder-members:user:${U}`);
  });
  it("maps the permission error to the spec's copy and invalidates nothing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "not allowed to manage this folder" },
    });
    const r = await shareFolder({ folderId: F, userId: U, level: "viewer" });
    expect(r).toEqual({
      ok: false,
      error: "Only the folder's creator or an admin can invite people",
    });
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("unshareFolder", () => {
  it("calls unshare_folder and invalidates the removed person's lists", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await unshareFolder({ folderId: F, userId: U });
    expect(rpc).toHaveBeenCalledWith("unshare_folder", {
      p_folder_id: F,
      p_user_id: U,
    });
    expect(updateTag).toHaveBeenCalledWith(`shared-boards:user:${U}`);
  });
});

describe("inviteToFolder", () => {
  it("rejects a bad email with the spec's copy", async () => {
    const r = await inviteToFolder({
      folderId: F,
      email: "nope",
      level: "viewer",
    });
    expect(r).toEqual({ ok: false, error: "Enter a valid email address" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports 'shared' and sends no email when the address is already an org member", async () => {
    rpc.mockResolvedValue({ data: U, error: null });
    const r = await inviteToFolder({
      folderId: F,
      email: "A@x.com",
      level: "viewer",
    });
    expect(rpc).toHaveBeenCalledWith("invite_to_folder", {
      p_folder_id: F,
      p_email: "a@x.com",
      p_level: "viewer",
    });
    expect(r).toEqual({ ok: true, data: { kind: "shared" } });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(updateTag).toHaveBeenCalledWith(`shared-boards:user:${U}`);
  });
  it("sends the invite email for an outside address and reports it sent", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    inviteUserByEmail.mockResolvedValue({ error: null });
    const r = await inviteToFolder({
      folderId: F,
      email: "new@x.com",
      level: "editor",
    });
    expect(inviteUserByEmail).toHaveBeenCalledWith("new@x.com");
    expect(r).toEqual({ ok: true, data: { kind: "invited", emailSent: true } });
    expect(auditInsert).toHaveBeenCalledTimes(1);
  });
  it("reports emailSent false when the address already has an account", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    inviteUserByEmail.mockResolvedValue({
      error: {
        message: "A user with this email address has already been registered",
      },
    });
    const r = await inviteToFolder({
      folderId: F,
      email: "old@x.com",
      level: "viewer",
    });
    expect(r).toEqual({
      ok: true,
      data: { kind: "invited", emailSent: false },
    });
  });
});

describe("revokeFolderInvitation", () => {
  it("calls revoke_folder_invitation", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await revokeFolderInvitation({ folderId: F, invitationId: I });
    expect(rpc).toHaveBeenCalledWith("revoke_folder_invitation", { p_id: I });
    expect(r.ok).toBe(true);
  });
});

describe("leaveFolder", () => {
  it("deletes only the caller's own row and invalidates their lists", async () => {
    const r = await leaveFolder({ folderId: F });
    expect(deleteEq).toHaveBeenCalledWith("folder_id", F, "user_id", "me");
    expect(updateTag).toHaveBeenCalledWith("shared-boards:user:me");
    expect(r.ok).toBe(true);
  });
});
```

Run: `pnpm vitest run src/lib/folders/sharing-actions.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `sharing-actions.ts`**

```ts
"use server";

import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fail, type ActionResult } from "@/lib/actions/result";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { folderMembersTag, sharedBoardsTag } from "@/lib/cache/tags";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import {
  folderAccessSchema,
  inviteToFolderSchema,
  revokeFolderInvitationSchema,
  shareFolderSchema,
  unshareFolderSchema,
} from "@/lib/validations/folder-sharing";
import { FOLDER_GONE_ERROR } from "./types";
import type {
  FolderAccessData,
  FolderInvitationEntry,
  InviteOutcome,
} from "./sharing-types";

const MEMBERS_LIMIT = 200;

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("not allowed to manage"))
    return "Only the folder's creator or an admin can invite people";
  if (m.includes("invalid email")) return "Enter a valid email address";
  if (m.includes("not a member"))
    return "That person isn't in your organization yet.";
  if (m.includes("mono follows"))
    return "A Mono gets access through its owner.";
  if (m.includes("invitation not found"))
    return "That invitation is no longer pending.";
  return "Something went wrong. Please try again.";
}

/**
 * What a folder grant change makes stale for one person: their "Shared with
 * me" list (also the tag of the portfolio readable-boards cache) and their
 * folder-membership cache (sidebar guest filter).
 */
function invalidateFor(userId: string): void {
  updateTag(sharedBoardsTag(userId));
  updateTag(folderMembersTag(userId));
}

/** Everything the share dialog shows. Loaded when the dialog opens, not on first paint. */
export async function loadFolderAccess(
  input: unknown,
): Promise<ActionResult<FolderAccessData>> {
  const parsed = folderAccessSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");
  const { folderId } = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("You must be signed in.");

  const [{ data: folder }, manageRes, membersRes] = await Promise.all([
    supabase
      .from("folders")
      .select("id, org_id")
      .eq("id", folderId)
      .maybeSingle(),
    typedRpc(supabase, "can_manage_folder", { p_folder_id: folderId }),
    supabase
      .from("folder_members")
      .select("user_id, access_level")
      .eq("folder_id", folderId)
      .order("created_at", { ascending: true })
      .limit(MEMBERS_LIMIT),
  ]);
  if (!folder) return fail(FOLDER_GONE_ERROR);
  const canManage = manageRes.data === true;

  const [roster, invitesRes] = await Promise.all([
    listOrgMembersCached(folder.org_id),
    canManage
      ? typedRpc(supabase, "folder_invitation_states", {
          p_folder_id: folderId,
        })
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const byId = new Map(roster.map((m) => [m.userId, m]));
  const memberIds = new Set((membersRes.data ?? []).map((r) => r.user_id));

  return {
    ok: true,
    data: {
      canManage,
      myUserId: user.id,
      members: (membersRes.data ?? []).map((r) => ({
        userId: r.user_id,
        fullName: byId.get(r.user_id)?.fullName ?? null,
        avatarUrl: byId.get(r.user_id)?.avatarUrl ?? null,
        level: r.access_level,
      })),
      invitations: (invitesRes.data ?? []).map((i): FolderInvitationEntry => ({
        id: i.id,
        email: i.email,
        level: i.access_level,
        state:
          i.state === "awaiting_approval" ? "awaiting_approval" : "invited",
      })),
      // People in the org who are not on the folder yet. Only a manager can
      // add anyone, so nobody else receives the list.
      candidates: canManage
        ? roster
            .filter((m) => !memberIds.has(m.userId))
            .map((m) => ({ userId: m.userId, fullName: m.fullName }))
        : [],
    },
  };
}

export async function shareFolder(input: unknown): Promise<ActionResult> {
  const parsed = shareFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await typedRpc(supabase, "share_folder", {
    p_folder_id: parsed.data.folderId,
    p_user_id: parsed.data.userId,
    p_level: parsed.data.level,
  });
  if (error) return fail(friendly(error.message));
  invalidateFor(parsed.data.userId);
  return { ok: true, data: undefined };
}

export async function unshareFolder(input: unknown): Promise<ActionResult> {
  const parsed = unshareFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await typedRpc(supabase, "unshare_folder", {
    p_folder_id: parsed.data.folderId,
    p_user_id: parsed.data.userId,
  });
  if (error) return fail(friendly(error.message));
  invalidateFor(parsed.data.userId);
  return { ok: true, data: undefined };
}

/**
 * Invite by email. An address that already belongs to an active org member is
 * shared directly (`kind: "shared"`). Any other address gets a pending folder
 * invitation plus a guest org invitation, and the standard invite email;
 * `emailSent` is false when the address already has an account (Supabase
 * sends nothing then) or delivery failed. Access starts when the person signs
 * in after a platform admin has approved the account.
 */
export async function inviteToFolder(
  input: unknown,
): Promise<ActionResult<InviteOutcome>> {
  const parsed = inviteToFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { folderId, email, level } = parsed.data;

  const supabase = await createClient();
  const { data: sharedUserId, error } = await typedRpc(
    supabase,
    "invite_to_folder",
    { p_folder_id: folderId, p_email: email, p_level: level },
  );
  if (error) return fail(friendly(error.message));

  if (typeof sharedUserId === "string") {
    invalidateFor(sharedUserId);
    return { ok: true, data: { kind: "shared" } };
  }

  const svc = createServiceClient();
  const { error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email);
  let emailSent = true;
  if (inviteErr) {
    emailSent = false;
    // "Already registered" is expected: they redeem on their next sign-in.
    if (!/already.*regist/i.test(inviteErr.message)) {
      console.error("[inviteToFolder] invite email delivery failed", {
        folderId,
        error: inviteErr.message,
      });
    }
  }

  const [
    { data: folder },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from("folders")
      .select("id, org_id")
      .eq("id", folderId)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  const { error: auditErr } = await svc.from("admin_audit_log").insert({
    org_id: folder?.org_id ?? null,
    actor_id: user?.id ?? null,
    actor_kind: "org",
    action: "folder.invited",
    target_email: email,
    metadata: { folderId, level },
  });
  if (auditErr)
    console.error("[inviteToFolder] audit-log insert failed (compliance)", {
      folderId,
      error: auditErr.message,
    });

  return { ok: true, data: { kind: "invited", emailSent } };
}

export async function revokeFolderInvitation(
  input: unknown,
): Promise<ActionResult> {
  const parsed = revokeFolderInvitationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await typedRpc(supabase, "revoke_folder_invitation", {
    p_id: parsed.data.invitationId,
  });
  if (error) return fail(friendly(error.message));
  return { ok: true, data: undefined };
}

/** A member removes themself (RLS: "folder_members: member leaves"). */
export async function leaveFolder(input: unknown): Promise<ActionResult> {
  const parsed = folderAccessSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("You must be signed in.");
  const { error } = await supabase
    .from("folder_members")
    .delete()
    .eq("folder_id", parsed.data.folderId)
    .eq("user_id", user.id);
  if (error) return fail("Something went wrong. Please try again.");
  invalidateFor(user.id);
  return { ok: true, data: undefined };
}
```

`listOrgMembersCached` returns `{ userId, fullName, email, avatarUrl }` per person and leaves Monos out (`src/lib/org/queries-cached.ts:43`, `:59-66`), so every candidate is a person. It includes deactivated members; `share_folder` refuses those, and the dialog shows the action's error.

The test's `from().select().eq().maybeSingle()` double serves the `folders` read in `inviteToFolder`; `auth.getUser` is on the double too.

Run: `pnpm vitest run src/lib/folders/sharing-actions.test.ts src/test/use-server-exports.test.ts`
Expected: PASS.

- [ ] **Step 5: Failing tests for the move confirm and the invalidation**

`moveBoardToFolder` and `deleteFolder` will make two new reads before they write: `folder_boards` → `.select("folder_id").eq("board_id", …).maybeSingle()` and `folder_members` → `.select("folder_id, user_id").in("folder_id", […]).limit(500)`. The chain stub in `src/lib/folders/actions.test.ts` is not table-aware (`from: () => {`, `:66`) and its `limit` answers every table with position rows (`:91-96`). Make it table-aware with these four exact edits.

1. In the `state` declaration (`:31-39`), add two fields to the type and to the initial value:

```ts
const state: {
  insertError: unknown;
  maxPosition: number | null;
  affectedRows: number;
  currentFolderId: string | null;
  folderMemberRows: { folder_id: string; user_id: string }[];
} = {
  insertError: null,
  maxPosition: null,
  affectedRows: 1,
  currentFolderId: null,
  folderMemberRows: [],
};
```

2. Change `from: () => {` to `from: (table: string) => {`, and make these the first lines of that function body, before `const eqLog: EqCall[] = [];`:

```ts
// The members of the folders a placement change touches. Read before
// the write, so it is its own tiny chain rather than part of `qb`.
if (table === "folder_members") {
  return {
    select: () => ({
      in: () => ({
        limit: async () => ({
          data: state.folderMemberRows,
          error: null,
        }),
      }),
    }),
  };
}
```

3. In `qb.maybeSingle` (`:108-117`), add the board's current placement as the first branch after `logOperation();`:

```ts
qb.maybeSingle = () => {
  logOperation();
  // `folder_boards.select("folder_id").eq("board_id", …)`: where the
  // board is filed today. `mode` is null because it is a plain read.
  if (table === "folder_boards" && mode === null) {
    return Promise.resolve({
      data: state.currentFolderId ? { folder_id: state.currentFolderId } : null,
      error: null,
    });
  }
  return Promise.resolve({
    data:
      state.affectedRows > 0 ? { id: "matched-row", workspace_id: "w1" } : null,
    error: state.insertError,
  });
};
```

4. In **both** `beforeEach` blocks that reset `state` (`:161-165` and `:342-346`), after `state.affectedRows = 1;`, add:

```ts
state.currentFolderId = null;
state.folderMemberRows = [];
```

Run: `pnpm vitest run src/lib/folders/actions.test.ts`
Expected: PASS, unchanged count. The stub edits alone must not change any existing result.

Then add:

```ts
describe("moveBoardToFolder into a shared folder", () => {
  const B = "44444444-4444-4444-8444-444444444444";
  const F2 = "55555555-5555-4555-8555-555555555555";

  it("asks for confirmation instead of moving when the target folder has members", async () => {
    state.folderMemberRows = [
      { folder_id: F2, user_id: "m1" },
      { folder_id: F2, user_id: "m2" },
    ];
    const r = await moveBoardToFolder({ boardId: B, folderId: F2 });
    expect(r).toEqual({ ok: true, data: { needsConfirm: 2 } });
    expect(calls.upserts).toHaveLength(0);
  });

  it("moves once confirmed and invalidates every member's shared list", async () => {
    state.folderMemberRows = [
      { folder_id: F2, user_id: "m1" },
      { folder_id: F2, user_id: "m2" },
    ];
    const r = await moveBoardToFolder({
      boardId: B,
      folderId: F2,
      confirmShared: true,
    });
    expect(r).toEqual({ ok: true, data: undefined });
    expect(calls.upserts).toHaveLength(1);
    expect(updateTag).toHaveBeenCalledWith("shared-boards:user:m1");
    expect(updateTag).toHaveBeenCalledWith("shared-boards:user:m2");
  });

  it("moves straight away when the target folder has no members", async () => {
    const r = await moveBoardToFolder({ boardId: B, folderId: F2 });
    expect(r).toEqual({ ok: true, data: undefined });
    expect(calls.upserts).toHaveLength(1);
  });

  it("invalidates the old folder's members when a board is taken out", async () => {
    state.currentFolderId = F2;
    state.folderMemberRows = [{ folder_id: F2, user_id: "m1" }];
    await moveBoardToFolder({ boardId: B, folderId: null });
    expect(updateTag).toHaveBeenCalledWith("shared-boards:user:m1");
  });
});
```

Run: `pnpm vitest run src/lib/folders/actions.test.ts`
Expected: the four new tests FAIL; every existing test still passes with the extended stub.

- [ ] **Step 6: Implement the move and delete changes**

In `src/lib/folders/actions.ts` add `sharedBoardsTag` to the `@/lib/cache/tags` import, and add this helper below `DUPLICATE_NAME`:

```ts
const SHARED_FOLDER_MOVE =
  "Only the board's owner or an admin can move a board into or out of a shared folder.";

type Db = Awaited<ReturnType<typeof createClient>>;

/** Members of these folders. RLS client: only folders the caller can see answer. */
async function folderMemberRows(
  supabase: Db,
  folderIds: string[],
): Promise<{ folder_id: string; user_id: string }[]> {
  if (folderIds.length === 0) return [];
  const { data } = await supabase
    .from("folder_members")
    .select("folder_id, user_id")
    .in("folder_id", folderIds)
    .limit(500);
  return data ?? [];
}

/** A placement change alters which boards these people can read. */
function invalidateSharedLists(rows: { user_id: string }[]): void {
  for (const id of new Set(rows.map((r) => r.user_id)))
    updateTag(sharedBoardsTag(id));
}
```

Replace `moveBoardToFolder` with:

```ts
/**
 * File a board (upsert on the board_id PK — "one folder per board" is the key)
 * or unfile with null.
 *
 * Filing a board into a folder that has members gives those people access to
 * it, so the first call returns `needsConfirm` (the member count) and changes
 * nothing; the caller confirms and calls again with `confirmShared: true`.
 */
export async function moveBoardToFolder(input: {
  boardId: string;
  folderId: string | null;
  confirmShared?: boolean;
}): Promise<ActionResult<{ needsConfirm: number } | undefined>> {
  const parsed = moveBoardToFolderSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  const supabase = await createClient();
  const { boardId, folderId, confirmShared } = parsed.data;

  const { data: current } = await supabase
    .from("folder_boards")
    .select("folder_id")
    .eq("board_id", boardId)
    .maybeSingle();
  const currentFolderId = current?.folder_id ?? null;
  const affected = [currentFolderId, folderId].filter(
    (v): v is string => typeof v === "string",
  );
  const memberRows = await folderMemberRows(supabase, [...new Set(affected)]);

  if (folderId !== null && folderId !== currentFolderId && !confirmShared) {
    const incoming = memberRows.filter((r) => r.folder_id === folderId).length;
    if (incoming > 0) return { ok: true, data: { needsConfirm: incoming } };
  }

  if (folderId === null) {
    // Unfiling a board with no placement is a legitimate no-op (double click, stale menu).
    const { error } = await supabase
      .from("folder_boards")
      .delete()
      .eq("board_id", boardId);
    if (error)
      return fail(
        error.message.includes("shared folder")
          ? SHARED_FOLDER_MOVE
          : error.message,
      );
  } else {
    const { data: last } = await supabase
      .from("folder_boards")
      .select("position")
      .eq("folder_id", folderId)
      .order("position", { ascending: false })
      .limit(1);
    const position = (last?.[0]?.position ?? -1) + 1;
    const { error } = await supabase
      .from("folder_boards")
      .upsert(
        { board_id: boardId, folder_id: folderId, position },
        { onConflict: "board_id" },
      );
    // A board outside the folder's workspace, or one you cannot read, is refused
    // by RLS (folder_accepts_board); a shared folder is guarded by a trigger.
    if (error)
      return fail(
        error.message.includes("shared folder")
          ? SHARED_FOLDER_MOVE
          : error.message,
      );
  }
  updateTag(foldersTag(org.id));
  invalidateSharedLists(memberRows);
  return { ok: true, data: undefined };
}
```

In `deleteFolder`, between `const supabase = await createClient();` and the delete, add:

```ts
// Read before the delete: the cascade removes the rows that say whose
// "Shared with me" list just changed.
const memberRows = await folderMemberRows(supabase, [parsed.data.folderId]);
```

and after `updateTag(dashboardsTag(org.id));` add `invalidateSharedLists(memberRows);`.

If an existing `deleteFolder` test fails because the stub has no `folder_members` table, the Step 5 stub extension already covers it.

Run: `pnpm vitest run src/lib/folders/actions.test.ts`
Expected: PASS.

- [ ] **Step 7: Access head in the folder payload**

In `src/lib/folders/types.ts` add `import type { FolderAccessHead } from "./sharing-types";` and to `FolderPayload`, after `members: FolderMember[];`:

```ts
/** Who the folder is shared with (avatar stack) and whether the caller may manage it. */
access: FolderAccessHead;
```

In `src/lib/folders/payload.ts` add `import { getFolderAccessHead } from "./sharing-queries";`, extend wave A:

```ts
const [head, layoutRow, rollup, attention, access] = await Promise.all([
  getFolderHead(supabase, folderId),
  getFolderLayoutRow(supabase, folderId),
  resolveFolderRollup(supabase, folderId),
  resolveFolderAttention(supabase, folderId, ATTENTION_LIMIT),
  getFolderAccessHead(supabase, folderId),
]);
```

and add `access,` to the returned object after `members: ...,`.

In `src/lib/folders/fixture.ts`, in `folderFixture()`, directly after the `members: [ ... ],` array (`:240-243`) and before `layout: resolveLayout(null),` (`:244`), add:

```ts
    access: { count: 0, memberIds: [], canManage: true },
```

`folderFixtureWithPreset` (`:252`) spreads `folderFixture()`, so it needs no edit.

In `src/lib/folders/payload.test.ts`, after the `vi.mock("@/lib/org/queries-cached", ...)` block (`:70-75`), add:

```ts
vi.mock("./sharing-queries", () => ({
  getFolderAccessHead: vi.fn(async () => {
    order.push("start:access");
    await tick();
    order.push("end:access");
    return { count: 2, memberIds: ["m1", "m2"], canManage: true };
  }),
}));
```

In the first test ("runs head + three RPCs concurrently, then briefs; ..."), change the wave-A list (`:128`) to include the new read, so the concurrency proof covers it:

```ts
const firstPaintReads = [
  "head",
  "rollup",
  "layout",
  "attention",
  "access",
] as const;
```

and add inside `describe("buildFolderPayload", () => {`, after that first test:

```ts
it("carries the folder's access head from wave A", async () => {
  const p = await buildFolderPayload(supabase, "f1", "u1");
  expect(p!.access).toEqual({
    count: 2,
    memberIds: ["m1", "m2"],
    canManage: true,
  });
});
```

`supabase`, `"f1"` and `"u1"` are the client and ids that file's first test already uses (`:83`, `:98`).

- [ ] **Step 8: Run and report**

Run: `pnpm vitest run src/lib/folders src/components/folders src/test/use-server-exports.test.ts`
Run: `pnpm typecheck`
Expected: PASS for both. `src/components/folders/CommandCenter.test.tsx` builds its payload from `folderFixture()` (`:10`, `:87`, `:101`), so the fixture edit in Step 7 covers it.

```bash
git add src/lib/validations/folder-sharing.ts src/lib/validations/folders.ts src/lib/folders/sharing-types.ts \
  src/lib/folders/sharing-queries.ts src/lib/folders/sharing-actions.ts src/lib/folders/sharing-actions.test.ts \
  src/lib/folders/actions.ts src/lib/folders/actions.test.ts src/lib/folders/types.ts \
  src/lib/folders/payload.ts src/lib/folders/payload.test.ts src/lib/folders/fixture.ts
git commit -m "feat(folders): add folder sharing actions and the move confirm"
```

---

### Task 7: Share-folder dialog and its entry points

Load the `pulse-ui` and `frontend-design` skills before writing any component in this task.

**Files:**

- Create: `src/components/folders/ShareFolderDialog.tsx`
- Create: `src/components/folders/ShareFolderDialog.test.tsx`
- Modify: `src/components/folders/HeaderActions.tsx`, `src/components/folders/HeaderActions.test.tsx`
- Modify: `src/components/folders/CommandCenter.tsx:153-158`
- Modify: `src/components/boards/BoardFolderMenu.tsx`, `src/components/boards/BoardFolderMenu.test.tsx`
- Create: `src/components/boards/move-to-folder.tsx`, `src/components/boards/move-to-folder.test.tsx`
- Modify: `src/components/boards/MoveToFolderMenu.tsx`
- Modify: `src/components/boards/BoardsNavSortable.tsx:30`, `:433-453` (the only other caller of `moveBoardToFolder`)
- Modify: `src/components/boards/BoardsNav.tsx` (mount the confirm host around the expanded `<NavSection>`)
- Modify: `src/components/shell/sidebar-nav.tsx`, `src/components/shell/sidebar-nav.test.tsx`, `src/components/shell/sidebar-nav-data.tsx` (one line)

**Interfaces:**

- Consumes: Task 6 actions and types; `FolderPayload.access` and `FolderPayload.members`; `folderAccess.isGuest` in `getSidebarNavData` (Task 5).
- Produces: `ShareFolderDialog({ folderId, folderName, open, onOpenChange })`; `HeaderActions` props `folderName: string`, `access: FolderAccessHead`, `members: { userId: string; fullName: string | null; avatarUrl: string | null }[]`; `MoveBoardToFolderHost({ children })` and `useMoveBoardToFolder(): (request: { boardId: string; folderId: string | null; folderName?: string; onMoved?: () => void }) => void`; `SidebarNav` prop `isGuest?: boolean`.

- [ ] **Step 1: Failing dialog tests**

`src/components/folders/ShareFolderDialog.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareFolderDialog } from "./ShareFolderDialog";

const toast = vi.fn();
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const loadFolderAccess = vi.fn();
const shareFolder = vi.fn();
const unshareFolder = vi.fn();
const inviteToFolder = vi.fn();
const revokeFolderInvitation = vi.fn();
const leaveFolder = vi.fn();
vi.mock("@/lib/folders/sharing-actions", () => ({
  loadFolderAccess: (...a: unknown[]) => loadFolderAccess(...a),
  shareFolder: (...a: unknown[]) => shareFolder(...a),
  unshareFolder: (...a: unknown[]) => unshareFolder(...a),
  inviteToFolder: (...a: unknown[]) => inviteToFolder(...a),
  revokeFolderInvitation: (...a: unknown[]) => revokeFolderInvitation(...a),
  leaveFolder: (...a: unknown[]) => leaveFolder(...a),
}));

const managerData = {
  canManage: true,
  myUserId: "me",
  members: [
    { userId: "u1", fullName: "Dana Lee", avatarUrl: null, level: "viewer" },
  ],
  invitations: [
    { id: "i1", email: "new@x.com", level: "editor", state: "invited" },
    {
      id: "i2",
      email: "wait@x.com",
      level: "viewer",
      state: "awaiting_approval",
    },
  ],
  candidates: [{ userId: "u2", fullName: "Sam Roe" }],
};

function open() {
  return render(
    <ShareFolderDialog
      folderId="f1"
      folderName="DAAS"
      open
      onOpenChange={() => {}}
    />,
  );
}

beforeEach(() => {
  for (const m of [
    loadFolderAccess,
    shareFolder,
    unshareFolder,
    inviteToFolder,
    revokeFolderInvitation,
    leaveFolder,
  ])
    m.mockReset();
  loadFolderAccess.mockResolvedValue({ ok: true, data: managerData });
});

describe("ShareFolderDialog", () => {
  it("loads the folder's people when it opens and lists them", async () => {
    open();
    expect(await screen.findByText("Dana Lee")).toBeInTheDocument();
    expect(loadFolderAccess).toHaveBeenCalledWith({ folderId: "f1" });
  });

  it("labels the two pending states differently", async () => {
    open();
    expect(await screen.findByText("Invited")).toBeInTheDocument();
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
  });

  it("adds an org member picked from the suggestions", async () => {
    shareFolder.mockResolvedValue({ ok: true, data: undefined });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.change(screen.getByLabelText("Name or email"), {
      target: { value: "sam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Sam Roe" }));
    await waitFor(() =>
      expect(shareFolder).toHaveBeenCalledWith({
        folderId: "f1",
        userId: "u2",
        level: "viewer",
      }),
    );
    await waitFor(() => expect(loadFolderAccess).toHaveBeenCalledTimes(2));
  });

  it("invites an email address at the chosen level", async () => {
    inviteToFolder.mockResolvedValue({
      ok: true,
      data: { kind: "invited", emailSent: true },
    });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.change(screen.getByLabelText("Name or email"), {
      target: { value: "pat@x.com" },
    });
    fireEvent.change(screen.getByLabelText("Access for new people"), {
      target: { value: "editor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() =>
      expect(inviteToFolder).toHaveBeenCalledWith({
        folderId: "f1",
        email: "pat@x.com",
        level: "editor",
      }),
    );
    expect(
      await screen.findByText(
        "Invitation sent. They get access after they sign up and are approved.",
      ),
    ).toBeInTheDocument();
  });

  it("says so when no email went out because the person already has an account", async () => {
    inviteToFolder.mockResolvedValue({
      ok: true,
      data: { kind: "invited", emailSent: false },
    });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.change(screen.getByLabelText("Name or email"), {
      target: { value: "old@x.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(
      await screen.findByText(
        "They already have an account. They will see the invitation next time they sign in.",
      ),
    ).toBeInTheDocument();
  });

  it("changes a member's level and removes a member", async () => {
    shareFolder.mockResolvedValue({ ok: true, data: undefined });
    unshareFolder.mockResolvedValue({ ok: true, data: undefined });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.change(screen.getByLabelText("Access for Dana Lee"), {
      target: { value: "editor" },
    });
    await waitFor(() =>
      expect(shareFolder).toHaveBeenCalledWith({
        folderId: "f1",
        userId: "u1",
        level: "editor",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Dana Lee" }));
    await waitFor(() =>
      expect(unshareFolder).toHaveBeenCalledWith({
        folderId: "f1",
        userId: "u1",
      }),
    );
  });

  it("shows the action's error and keeps the previous level", async () => {
    shareFolder.mockResolvedValue({
      ok: false,
      error: "Only the folder's creator or an admin can invite people",
    });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.change(screen.getByLabelText("Access for Dana Lee"), {
      target: { value: "editor" },
    });
    expect(
      await screen.findByText(
        "Only the folder's creator or an admin can invite people",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Access for Dana Lee")).toHaveValue("viewer");
  });

  it("is read-only for someone who cannot manage, with a way to leave", async () => {
    loadFolderAccess.mockResolvedValue({
      ok: true,
      data: {
        canManage: false,
        myUserId: "u1",
        members: managerData.members,
        invitations: [],
        candidates: [],
      },
    });
    leaveFolder.mockResolvedValue({ ok: true, data: undefined });
    open();
    await screen.findByText("Dana Lee");
    expect(screen.queryByLabelText("Name or email")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Access for Dana Lee"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave folder" }));
    await waitFor(() =>
      expect(leaveFolder).toHaveBeenCalledWith({ folderId: "f1" }),
    );
  });

  it("revokes a pending invitation", async () => {
    revokeFolderInvitation.mockResolvedValue({ ok: true, data: undefined });
    open();
    await screen.findByText("Invited");
    fireEvent.click(
      screen.getByRole("button", { name: "Revoke invitation for new@x.com" }),
    );
    await waitFor(() =>
      expect(revokeFolderInvitation).toHaveBeenCalledWith({
        folderId: "f1",
        invitationId: "i1",
      }),
    );
  });

  it("copies the folder link (the header's old Share behaviour)", async () => {
    toast.mockClear();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
    open();
    await screen.findByText("Dana Lee");
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Link copied"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      window.location.href,
    );
  });
});
```

Run: `pnpm vitest run src/components/folders/ShareFolderDialog.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement the dialog**

`src/components/folders/ShareFolderDialog.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, Link2, X } from "lucide-react";
import { toast } from "sonner";
import {
  inviteToFolder,
  leaveFolder,
  loadFolderAccess,
  revokeFolderInvitation,
  shareFolder,
  unshareFolder,
} from "@/lib/folders/sharing-actions";
import type {
  FolderAccessData,
  FolderLevel,
} from "@/lib/folders/sharing-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_SUGGESTIONS = 6;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

function LevelSelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: FolderLevel;
  onChange: (next: FolderLevel) => void;
  disabled: boolean;
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as FolderLevel)}
        disabled={disabled}
        className={cn(
          "border-border bg-background text-foreground hover:bg-state-hover focus-visible:ring-ring/50 focus-visible:border-ring h-9 w-28 appearance-none rounded-md border pr-8 pl-3 text-sm transition-colors",
          "focus-visible:ring-3 focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <option value="viewer">Viewer</option>
        <option value="editor">Editor</option>
      </select>
      <ChevronDown
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
      />
    </div>
  );
}

/**
 * Who a folder is shared with. Everything here is loaded when the dialog
 * opens and refreshed after each change through Server Actions: no
 * navigation, no router call.
 */
export function ShareFolderDialog({
  folderId,
  folderName,
  open,
  onOpenChange,
}: {
  folderId: string;
  folderName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<FolderAccessData | null>(null);
  const [query, setQuery] = useState("");
  const [newLevel, setNewLevel] = useState<FolderLevel>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function reload() {
    const r = await loadFolderAccess({ folderId });
    if (r.ok) setData(r.data);
    else setError(r.error);
  }

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNotice(null);
    setQuery("");
    start(reload);
    // `reload` closes over folderId only; re-running on `open` is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folderId]);

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    done?: string,
  ) {
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await action();
      if (!r.ok) {
        setError(r.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (done) setNotice(done);
      await reload();
    });
  }

  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  const suggestions =
    data && needle.length > 0
      ? data.candidates
          .filter((c) => (c.fullName ?? "").toLowerCase().includes(needle))
          .slice(0, MAX_SUGGESTIONS)
      : [];

  function inviteEmail() {
    if (!EMAIL.test(trimmed)) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await inviteToFolder({
        folderId,
        email: trimmed,
        level: newLevel,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setQuery("");
      setNotice(
        r.data.kind === "shared"
          ? "Added. They can open every board in this folder now."
          : r.data.emailSent
            ? "Invitation sent. They get access after they sign up and are approved."
            : "They already have an account. They will see the invitation next time they sign in.",
      );
      await reload();
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Link copied");
    } catch {
      toast("Couldn't copy the link");
    }
  }

  const canManage = data?.canManage ?? false;
  const iAmMember = !!data?.members.some((m) => m.userId === data.myUserId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share {folderName}</DialogTitle>
          <DialogDescription>
            People you add can open every board in this folder, including boards
            added later.
          </DialogDescription>
        </DialogHeader>

        {canManage && (
          <div className="flex flex-col gap-2">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                inviteEmail();
              }}
            >
              <Input
                aria-label="Name or email"
                placeholder="Name or email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={pending}
                autoComplete="off"
                className="min-w-0 flex-1"
              />
              <LevelSelect
                label="Access for new people"
                value={newLevel}
                onChange={setNewLevel}
                disabled={pending}
              />
              <Button
                type="submit"
                size="sm"
                disabled={pending || trimmed.length === 0}
              >
                Invite
              </Button>
            </form>
            {suggestions.length > 0 && (
              <ul className="bg-surface-muted/40 divide-border divide-y rounded-lg border">
                {suggestions.map((c) => {
                  const name = c.fullName ?? "Unknown member";
                  return (
                    <li
                      key={c.userId}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                        {name}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Add ${name}`}
                        disabled={pending}
                        onClick={() => {
                          setQuery("");
                          run(() =>
                            shareFolder({
                              folderId,
                              userId: c.userId,
                              level: newLevel,
                            }),
                          );
                        }}
                      >
                        Add
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : notice ? (
          <p role="status" className="text-muted-foreground text-sm">
            {notice}
          </p>
        ) : null}

        {data === null ? (
          <p className="text-muted-foreground text-sm">Loading people…</p>
        ) : data.members.length === 0 && data.invitations.length === 0 ? (
          <p className="text-muted-foreground bg-surface-muted/40 rounded-lg border px-4 py-6 text-center text-sm">
            Nobody has been added to this folder yet. Each board is still shared
            on its own.
          </p>
        ) : (
          <ul className="bg-surface-muted/40 divide-border max-h-[min(50vh,20rem)] divide-y overflow-y-auto rounded-lg border">
            {data.members.map((m) => {
              const name = m.fullName ?? "Unknown member";
              return (
                <li
                  key={m.userId}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <span
                    aria-hidden
                    className="bg-surface text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium"
                  >
                    {initials(name)}
                  </span>
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                    {name}
                  </span>
                  {canManage ? (
                    <>
                      <LevelSelect
                        label={`Access for ${name}`}
                        value={m.level}
                        onChange={(next) =>
                          run(() =>
                            shareFolder({
                              folderId,
                              userId: m.userId,
                              level: next,
                            }),
                          )
                        }
                        disabled={pending}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 pointer-coarse:size-11"
                        aria-label={`Remove ${name}`}
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            unshareFolder({ folderId, userId: m.userId }),
                          )
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {m.level === "editor" ? "Editor" : "Viewer"}
                    </span>
                  )}
                </li>
              );
            })}
            {data.invitations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-sm">
                    {i.email}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {i.state === "awaiting_approval"
                      ? "Waiting for approval"
                      : "Invited"}
                    {" · "}
                    {i.level === "editor" ? "Editor" : "Viewer"}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 pointer-coarse:size-11"
                  aria-label={`Revoke invitation for ${i.email}`}
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      revokeFolderInvitation({ folderId, invitationId: i.id }),
                    )
                  }
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" size="sm" onClick={copyLink}>
            <Link2 className="size-4" /> Copy link
          </Button>
          {!canManage && iAmMember ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await leaveFolder({ folderId });
                  if (!r.ok) setError(r.error);
                  else onOpenChange(false);
                })
              }
            >
              Leave folder
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

The "shows the action's error and keeps the previous level" test passes because the select's value comes from loaded `data`, which only changes on a successful reload. `DialogFooter` is exported from `src/components/ui/dialog.tsx` (`BoardFolderMenu.tsx:20-27` imports it).

Run: `pnpm vitest run src/components/folders/ShareFolderDialog.test.tsx`
Expected: PASS.

- [ ] **Step 3: Header entry — failing test**

The existing "Share copies the current URL and toasts" test covers behaviour that moves into the dialog's "Copy link" (covered by the dialog test in Step 1). Replace the whole of `src/components/folders/HeaderActions.test.tsx` with:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ShareFolderDialog", () => ({
  ShareFolderDialog: ({ open }: { open: boolean }) =>
    open ? <div>share-dialog</div> : null,
}));
import { HeaderActions } from "./HeaderActions";

const base = {
  folderId: "f1",
  folderName: "DAAS",
  access: { count: 0, memberIds: [] as string[], canManage: true },
  members: [] as {
    userId: string;
    fullName: string | null;
    avatarUrl: string | null;
  }[],
};

describe("HeaderActions", () => {
  beforeEach(() => {
    window.print = vi.fn();
  });

  it("opens the share dialog from Invite", async () => {
    render(<HeaderActions {...base} canExport />);
    expect(screen.queryByText("share-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    // The dialog is a dynamic import, so it arrives a tick later.
    expect(await screen.findByText("share-dialog")).toBeInTheDocument();
  });

  it("shows who the folder is shared with and how many more", () => {
    render(
      <HeaderActions
        {...base}
        canExport
        access={{ count: 6, memberIds: ["a", "b", "c", "d"], canManage: false }}
        members={[
          { userId: "a", fullName: "Dana Lee", avatarUrl: null },
          { userId: "b", fullName: "Sam Roe", avatarUrl: null },
        ]}
      />,
    );
    expect(screen.getByLabelText("Shared with 6 people")).toBeInTheDocument();
    expect(screen.getByText("DL")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("shows no stack when the folder is shared with nobody", () => {
    render(<HeaderActions {...base} canExport />);
    expect(screen.queryByLabelText(/Shared with/)).not.toBeInTheDocument();
  });

  it("labels the button People for someone who cannot manage the folder", () => {
    render(
      <HeaderActions
        {...base}
        canExport
        access={{ count: 1, memberIds: ["a"], canManage: false }}
        members={[{ userId: "a", fullName: "Dana Lee", avatarUrl: null }]}
      />,
    );
    expect(screen.getByRole("button", { name: "People" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Invite" }),
    ).not.toBeInTheDocument();
  });

  it("Export PDF prints on a canvas tab and is disabled elsewhere", () => {
    const { rerender } = render(<HeaderActions {...base} canExport />);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(window.print).toHaveBeenCalledTimes(1);
    rerender(<HeaderActions {...base} canExport={false} />);
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
  });

  it("Ask about this folder links to /ask?folder=", () => {
    render(<HeaderActions {...base} canExport />);
    expect(
      screen.getByRole("link", { name: "Ask about this folder" }),
    ).toHaveAttribute("href", "/ask?folder=f1");
  });
});
```

Run: `pnpm vitest run src/components/folders/HeaderActions.test.tsx`
Expected: FAIL (unknown props, no Invite button).

- [ ] **Step 4: Implement the header entry**

Replace `src/components/folders/HeaderActions.tsx` with:

```tsx
"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Printer, Settings2, Sparkles, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FolderAccessHead } from "@/lib/folders/sharing-types";

// Loaded on first open: the dialog and its actions stay out of the folder
// page's first paint.
const ShareFolderDialog = dynamic(
  () => import("./ShareFolderDialog").then((m) => m.ShareFolderDialog),
  { ssr: false },
);

const STACK = 3;

type HeaderMember = {
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** Spec §5.1 header extras. Export prints canvas tabs only. `onCustomize`
 *  enters Customize mode, a client-only draft edit of the layout.
 *  Invite opens the folder's share dialog; the stack beside it shows who the
 *  folder is shared with. */
export function HeaderActions({
  folderId,
  folderName,
  canExport,
  access,
  members,
  editing = false,
  onCustomize,
}: {
  folderId: string;
  folderName: string;
  canExport: boolean;
  access: FolderAccessHead;
  members: HeaderMember[];
  editing?: boolean;
  onCustomize?: () => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const byId = new Map(members.map((m) => [m.userId, m]));
  const shown = access.memberIds.slice(0, STACK);
  const more = access.count - shown.length;

  return (
    <div className="flex items-center gap-2" data-print-hide>
      {access.count > 0 && (
        <div
          className="flex items-center"
          aria-label={`Shared with ${access.count} ${access.count === 1 ? "person" : "people"}`}
        >
          {shown.map((id) => (
            <span
              key={id}
              aria-hidden
              className="bg-surface-muted text-muted-foreground border-content-surface -ml-1.5 flex size-7 items-center justify-center rounded-full border-2 text-[10px] font-medium first:ml-0"
            >
              {initials(byId.get(id)?.fullName ?? "?")}
            </span>
          ))}
          {more > 0 && (
            <span
              aria-hidden
              className="bg-surface-muted text-muted-foreground border-content-surface -ml-1.5 flex size-7 items-center justify-center rounded-full border-2 font-mono text-[10px]"
            >
              +{more}
            </span>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setShareOpen(true)}
      >
        {access.canManage ? (
          <>
            <UserPlus className="size-4" /> Invite
          </>
        ) : (
          <>
            <Users className="size-4" /> People
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canExport}
        onClick={() => window.print()}
        title={canExport ? undefined : "Switch to a canvas tab to export"}
      >
        <Printer className="size-4" /> Export PDF
      </Button>
      <Button asChild size="sm">
        <Link href={`/ask?folder=${folderId}`}>
          <Sparkles className="size-4" /> Ask about this folder
        </Link>
      </Button>
      {!editing && onCustomize ? (
        <Button type="button" variant="outline" size="sm" onClick={onCustomize}>
          <Settings2 className="size-4" /> Customize
        </Button>
      ) : null}
      {shareOpen && (
        <ShareFolderDialog
          folderId={folderId}
          folderName={folderName}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </div>
  );
}
```

`border-content-surface` is a real utility: the theme defines `--color-content-surface` at `src/app/globals.css:53`, which is the surface the folder page sits on, so the 2px ring between overlapping avatars is the card's own colour in every preset and mode. (The board presence stack uses `ring-background` for the same job, `src/components/boards/presence/PresenceAvatarStack.tsx:53`; the folder page is on the content card, hence the content-surface token here.)

In `src/components/folders/CommandCenter.tsx`, replace the `<HeaderActions ... />` element (`:153-158`) with:

```tsx
<HeaderActions
  folderId={payload.folder.id}
  folderName={payload.folder.name}
  canExport={canExport}
  access={payload.access}
  members={payload.members}
  editing={edit}
  onCustomize={() => setEdit(true)}
/>
```

`payload.members` is `FolderMember[]` with `userId`, `fullName`, `avatarUrl` (`src/lib/folders/payload.ts:65-69`), which is the `HeaderMember` shape. `onCustomize` stays exactly as it was: who may customize is decided by RLS on `folder_layouts` (guests cannot).

This is the only edit to `CommandCenter.tsx`. Do not touch its layout, filter bar or tab code. `CommandCenter.test.tsx` builds its payload from `folderFixture()` (`:10`, `:87`), which Task 6 gave an `access` field, so it needs no edit.

Run: `pnpm vitest run src/components/folders`
Expected: PASS.

- [ ] **Step 5: Sidebar folder menu**

`BoardFolderMenu` already opens dialogs from menu items the safe way: `open` state lives in the component, and the `<Dialog>` and `<AlertDialog>` are siblings of `<DropdownMenu>` inside one fragment, so closing the menu cannot unmount them (`src/components/boards/BoardFolderMenu.tsx:46-47`, rename dialog `:126-164`, delete confirm `:166-196`). The share dialog follows that pattern.

In `src/components/boards/BoardFolderMenu.test.tsx`, add below the `@/lib/folders/actions` mock:

```tsx
vi.mock("@/components/folders/ShareFolderDialog", () => ({
  ShareFolderDialog: ({ open }: { open: boolean }) =>
    open ? <div>share-dialog</div> : null,
}));
```

change the helper's parameter type to `entry: "Rename" | "Delete" | "Share folder…"`, and add inside `describe("BoardFolderMenu", () => {`:

```tsx
it("opens the share dialog from the folder menu", async () => {
  openMenuAndSelect("Share folder…");
  expect(await screen.findByText("share-dialog")).toBeInTheDocument();
});
```

Run: `pnpm vitest run src/components/boards/BoardFolderMenu.test.tsx`
Expected: the new test FAILS (no such menu item).

In `src/components/boards/BoardFolderMenu.tsx`:

Add after the existing imports:

```tsx
import dynamic from "next/dynamic";

// Loaded on first open, like the folder header's copy of it.
const ShareFolderDialog = dynamic(
  () =>
    import("@/components/folders/ShareFolderDialog").then(
      (m) => m.ShareFolderDialog,
    ),
  { ssr: false },
);
```

Add `const [shareOpen, setShareOpen] = useState(false);` directly after `const [deleteOpen, setDeleteOpen] = useState(false);` (`:47`).

Change `<DropdownMenuContent align="end" className="w-40">` to `className="w-44"`, and add as its first child, before the `Rename` item:

```tsx
<DropdownMenuItem onSelect={() => setShareOpen(true)}>
  Share folder…
</DropdownMenuItem>
```

Directly before the fragment's closing `</>` (after the delete `</AlertDialog>`, `:196`), add:

```tsx
{
  shareOpen && (
    <ShareFolderDialog
      folderId={folder.id}
      folderName={folder.name}
      open={shareOpen}
      onOpenChange={setShareOpen}
    />
  );
}
```

Run: `pnpm vitest run src/components/boards/BoardFolderMenu.test.tsx`
Expected: PASS.

- [ ] **Step 6: One confirm host for both ways of moving a board**

A board is filed from two places: the "Move to folder" submenu (`MoveToFolderMenu.tsx:35`, rendered inside another menu's content by `BoardItemMenu.tsx:164` and `SharedBoardMenu.tsx:86`) and a drag onto a folder header (`BoardsNavSortable.tsx:439-453`). A dialog rendered by the submenu would unmount when the menu closes, and the whole board list is swapped for the drag-enabled tree on first interaction (`BoardsNav.tsx:96-103`, `:249`), tearing rows down. So the confirm lives in one host mounted in `BoardsNav`, above that swap, the same way `BoardsNav` already keeps `NewBoardDialog` mounted outside its trigger (`BoardsNav.tsx:232-234`). Both callers ask it to move.

Create `src/components/boards/move-to-folder.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const moveBoardToFolder = vi.fn();
vi.mock("@/lib/folders/actions", () => ({
  moveBoardToFolder: (...a: unknown[]) => moveBoardToFolder(...a),
}));
const showMutationError = vi.fn();
vi.mock("@/lib/ui/mutation-toast", () => ({
  showMutationError: (...a: unknown[]) => showMutationError(...a),
}));

import { MoveBoardToFolderHost, useMoveBoardToFolder } from "./move-to-folder";

const onMoved = vi.fn();

function Probe() {
  const move = useMoveBoardToFolder();
  return (
    <button
      type="button"
      onClick={() =>
        move({ boardId: "b1", folderId: "f1", folderName: "DAAS", onMoved })
      }
    >
      go
    </button>
  );
}

beforeEach(() => {
  moveBoardToFolder.mockReset();
  showMutationError.mockReset();
  onMoved.mockReset();
});

describe("MoveBoardToFolderHost", () => {
  it("moves straight away when the folder is not shared", async () => {
    moveBoardToFolder.mockResolvedValue({ ok: true, data: undefined });
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(moveBoardToFolder).toHaveBeenCalledWith({
      boardId: "b1",
      folderId: "f1",
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks before moving into a shared folder, and moves on confirm", async () => {
    moveBoardToFolder
      .mockResolvedValueOnce({ ok: true, data: { needsConfirm: 2 } })
      .mockResolvedValueOnce({ ok: true, data: undefined });
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(
      await screen.findByText(
        "2 people in DAAS will get access to this board.",
      ),
    ).toBeInTheDocument();
    expect(onMoved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move board" }));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(moveBoardToFolder).toHaveBeenLastCalledWith({
      boardId: "b1",
      folderId: "f1",
      confirmShared: true,
    });
  });

  it("does nothing more when the question is cancelled", async () => {
    moveBoardToFolder.mockResolvedValue({
      ok: true,
      data: { needsConfirm: 1 },
    });
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(
      await screen.findByText(
        "1 person in DAAS will get access to this board.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(moveBoardToFolder).toHaveBeenCalledTimes(1);
    expect(onMoved).not.toHaveBeenCalled();
  });

  it("reports a failed move and does not call onMoved", async () => {
    moveBoardToFolder.mockResolvedValue({ ok: false, error: "nope" });
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(showMutationError).toHaveBeenCalledTimes(1));
    expect(showMutationError.mock.calls[0][0]).toBe("Couldn't move the board.");
    expect(onMoved).not.toHaveBeenCalled();
  });

  it("never moves into a shared folder unasked when no host is mounted", async () => {
    moveBoardToFolder.mockResolvedValue({
      ok: true,
      data: { needsConfirm: 3 },
    });
    render(<Probe />);
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(showMutationError).toHaveBeenCalledTimes(1));
    expect(moveBoardToFolder).toHaveBeenCalledTimes(1);
    expect(onMoved).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm vitest run src/components/boards/move-to-folder.test.tsx`
Expected: FAIL, module not found.

Create `src/components/boards/move-to-folder.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { moveBoardToFolder } from "@/lib/folders/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
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

export type MoveBoardRequest = {
  boardId: string;
  /** `null` takes the board out of its folder. */
  folderId: string | null;
  /** Shown in the question when the target folder is shared. */
  folderName?: string;
  /** Runs once the board has actually moved. */
  onMoved?: () => void;
};

type MoveBoard = (request: MoveBoardRequest) => void;

/**
 * One attempt. Resolves to the number of people who would gain access (the
 * server changed nothing and wants a confirmation), or 0 when the move is done
 * or failed and was reported.
 */
async function attemptMove(
  request: MoveBoardRequest,
  confirmShared: boolean,
): Promise<number> {
  const res = await moveBoardToFolder(
    confirmShared
      ? { boardId: request.boardId, folderId: request.folderId, confirmShared }
      : { boardId: request.boardId, folderId: request.folderId },
  );
  if (!res.ok) {
    showMutationError("Couldn't move the board.", new Error(res.error));
    return 0;
  }
  if (res.data?.needsConfirm) return res.data.needsConfirm;
  request.onMoved?.();
  return 0;
}

/**
 * With no host mounted there is nowhere to ask, so a move into a shared
 * folder is refused rather than done unasked.
 */
const MoveBoardContext = createContext<MoveBoard>((request) => {
  void attemptMove(request, false).then((people) => {
    if (people > 0)
      showMutationError(
        "Couldn't move the board.",
        new Error("That folder is shared. Move the board from the sidebar."),
      );
  });
});

/** File a board into a folder (or out of one), asking first when that would
 *  give the folder's people access to it. */
export function useMoveBoardToFolder(): MoveBoard {
  return useContext(MoveBoardContext);
}

/**
 * Owns the "move into a shared folder?" question for everything beneath it.
 * Mounted once in `BoardsNav`, above the board list, so neither a closing
 * dropdown nor the swap to the drag-enabled list can unmount the dialog.
 */
export function MoveBoardToFolderHost({ children }: { children: ReactNode }) {
  const [asking, setAsking] = useState<{
    request: MoveBoardRequest;
    people: number;
  } | null>(null);

  const move = useCallback<MoveBoard>((request) => {
    void attemptMove(request, false).then((people) => {
      if (people > 0) setAsking({ request, people });
    });
  }, []);

  return (
    <MoveBoardContext.Provider value={move}>
      {children}
      <AlertDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move into a shared folder?</AlertDialogTitle>
            <AlertDialogDescription>
              {asking
                ? `${asking.people} ${asking.people === 1 ? "person" : "people"} in ${asking.request.folderName ?? "this folder"} will get access to this board.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (asking) void attemptMove(asking.request, true);
                setAsking(null);
              }}
            >
              Move board
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MoveBoardContext.Provider>
  );
}
```

The first attempt sends exactly `{ boardId, folderId }`, so the seven existing `toHaveBeenCalledWith({ boardId, folderId })` assertions in `src/components/boards/BoardsNav.test.tsx` (`:1030`, `:1059`, `:1108`, `:1357`, `:1687`, `:1880` and the `:1394` call check) keep passing unedited.

Run: `pnpm vitest run src/components/boards/move-to-folder.test.tsx`
Expected: PASS.

Now the three call sites.

**(a) Mount the host.** In `src/components/boards/BoardsNav.tsx` add `import { MoveBoardToFolderHost } from "@/components/boards/move-to-folder";`. In the expanded branch of the `return`, wrap the `<NavSection storageKey="boards" ...>` element: change

```tsx
  ) : (
    <NavSection
      storageKey="boards"
```

to

```tsx
  ) : (
    <MoveBoardToFolderHost>
    <NavSection
      storageKey="boards"
```

and the closing lines of the component (`:302-304`) from

```tsx
    </NavSection>
  );
}
```

to

```tsx
    </NavSection>
    </MoveBoardToFolderHost>
  );
}
```

then run `pnpm prettier --write src/components/boards/BoardsNav.tsx` to re-indent. The collapsed branch renders no board rows and no menus, so it needs no host.

**(b) The submenu.** Replace `src/components/boards/MoveToFolderMenu.tsx` with:

```tsx
"use client";

import { FolderInput } from "lucide-react";

import { useMoveBoardToFolder } from "@/components/boards/move-to-folder";
import type { FolderSummary } from "@/lib/folders/types";
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
 *
 * The move itself, its error toast and the "this folder is shared" question
 * belong to `MoveBoardToFolderHost` in `BoardsNav`: this submenu lives inside
 * another menu's content and is gone the moment an item is picked.
 */
export function MoveToFolderMenu({
  boardId,
  folders,
  currentFolderId,
}: {
  boardId: string;
  folders: FolderSummary[];
  currentFolderId: string | null;
}) {
  const move = useMoveBoardToFolder();

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
              onSelect={() =>
                move({ boardId, folderId: f.id, folderName: f.name })
              }
            >
              <span className="truncate">{f.name}</span>
            </DropdownMenuItem>
          ))
        )}
        {currentFolderId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => move({ boardId, folderId: null })}
            >
              Remove from folder
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
```

**(c) The drag path.** In `src/components/boards/BoardsNavSortable.tsx`:

- Delete the import `import { moveBoardToFolder } from "@/lib/folders/actions";` (`:30`) and add `import { useMoveBoardToFolder } from "@/components/boards/move-to-folder";`. Keep the `showMutationError` import (`:31`) only if `grep -n "showMutationError" src/components/boards/BoardsNavSortable.tsx` still shows another use after this edit (the reorder rollback uses it); otherwise lint will flag it and it is removed.
- Directly above the `fileIntoFolder` doc comment (`:433`), add `const moveBoard = useMoveBoardToFolder();`.
- Replace the body of `fileIntoFolder` (`:439-453`) so the function reads:

```tsx
function fileIntoFolder(boardId: string, folderId: string) {
  moveBoard({
    boardId,
    folderId,
    folderName: folders.find((f) => f.id === folderId)?.name,
    onMoved: () => {
      // The folder may have been collapsed — and hover-expansion is purely
      // visual now, so it will snap shut the instant the pointer leaves,
      // hiding the board the user just filed. `setSection`, never
      // `toggleSection`: an already-open folder must stay open. Client state
      // only, 0 round-trips.
      setSection(`${FOLDER_DROP_PREFIX}${folderId}`, false);
      // No router.refresh(): moveBoardToFolder's updateTag(foldersTag) put
      // the re-rendered sidebar in the action's own response.
    },
  });
}
```

`folders` is already a prop of that component (`:321`, `:325`). There is no optimistic placement on this path today (the row moves when the action's response re-renders the sidebar), so a `needsConfirm` answer leaves nothing to roll back.

`grep -rn "moveBoardToFolder(" src --include="*.tsx" --include="*.ts" | grep -v "\.test\." | grep -v "src/lib/folders/actions.ts"` must now show only `src/components/boards/move-to-folder.tsx`. These two were the only callers on 2026-11-14.

Run: `pnpm vitest run src/components/boards`
Expected: PASS, including `BoardsNav.test.tsx` unedited.

- [ ] **Step 7: Hide Goals, Portfolios, Reports and Workload from a guest**

The role is available where the nav renders without a new query: `getSidebarNavData` already holds `folderAccess.isGuest` after Task 5 (`getFolderAccessForUserCached`, read for the folder filter), and that one loader feeds both the desktop rail and the mobile drawer (`src/components/shell/mobile-nav-data.tsx:11-13`; `MobileNav`'s props are derived from `SidebarNav`'s, `src/components/shell/mobile-nav.tsx:17`). The four links are the `PLANNING` array in `src/components/shell/sidebar-nav.tsx:45-55`. "Folders" stays: the gallery it opens lists only folders the guest can see (Task 1 changes `folder_gallery`).

In `src/components/shell/sidebar-nav.test.tsx`, add inside `describe("SidebarNav", () => {`:

```tsx
it("shows a guest only the Folders link in Planning", () => {
  renderNav(
    <SidebarNav boards={[]} sharedBoards={[]} workspaces={[]} isGuest />,
  );
  expect(screen.getByRole("link", { name: "Folders" })).toBeInTheDocument();
  for (const label of ["Goals", "Portfolios", "Reports", "Workload"]) {
    expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
  }
  // Their own surfaces stay.
  expect(screen.getByRole("link", { name: "My Work" })).toBeInTheDocument();
});

it("shows a regular member every Planning link", () => {
  renderNav(<SidebarNav boards={[]} sharedBoards={[]} workspaces={[]} />);
  for (const label of [
    "Folders",
    "Goals",
    "Portfolios",
    "Reports",
    "Workload",
  ]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  }
});
```

Run: `pnpm vitest run src/components/shell/sidebar-nav.test.tsx`
Expected: the first new test FAILS.

In `src/components/shell/sidebar-nav.tsx`:

- Add `isGuest = false,` to the destructured props after `activeWorkspaceId = "",`, and to the props type after `activeWorkspaceId?: string;`:

```tsx
  /** A guest of the active org sees only what they were given: the org-wide
   *  planning surfaces (goals, portfolios, reports, workload) are empty for
   *  them, so their links are not offered. */
  isGuest?: boolean;
```

- After `const isActive = useActive();` add:

```tsx
const planning = isGuest
  ? PLANNING.filter((item) => item.href === "/dashboards")
  : PLANNING;
```

- Replace both `{PLANNING.map((item) => (` (collapsed rail `:186`, expanded section `:217`) with `{planning.map((item) => (`.

In `src/components/shell/sidebar-nav-data.tsx`, add to the object `getSidebarNavData` returns, after `activeWorkspaceId,`:

```ts
    isGuest: folderAccess.isGuest,
```

`MobileNav` spreads the same data into `SidebarNav`, so the drawer follows with no edit.

Run: `pnpm vitest run src/components/shell`
Expected: PASS.

- [ ] **Step 8: Run and report**

Run: `pnpm vitest run src/components/folders src/components/boards src/components/shell`
Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/components/folders/ShareFolderDialog.tsx src/components/folders/ShareFolderDialog.test.tsx \
  src/components/folders/HeaderActions.tsx src/components/folders/HeaderActions.test.tsx \
  src/components/folders/CommandCenter.tsx src/components/boards/BoardFolderMenu.tsx \
  src/components/boards/BoardFolderMenu.test.tsx src/components/boards/move-to-folder.tsx \
  src/components/boards/move-to-folder.test.tsx src/components/boards/MoveToFolderMenu.tsx \
  src/components/boards/BoardsNavSortable.tsx src/components/boards/BoardsNav.tsx \
  src/components/shell/sidebar-nav.tsx src/components/shell/sidebar-nav.test.tsx \
  src/components/shell/sidebar-nav-data.tsx
git commit -m "feat(folders): add the share folder dialog and its entry points"
```

---

### Task 8: RLS integration suite

**Files:**

- Create: `src/lib/folders/folder-members.rls.integration.test.ts`

**Interfaces:**

- Consumes: regenerated types (Task 3); helpers `integrationTargetReady`, `loadIntegrationEnv` from `@/test/integration-env`, `signInWithRetry` from `@/test/integration-auth` (the same ones `src/lib/folders/folders.rls.integration.test.ts` uses).
- Produces: nothing consumed by other tasks.

The suite is skipped unless a dedicated test project is configured through `.env.test` with `PULSE_TEST_DB=1`. It can never run against DEV or PROD. No test project is configured on this machine; Step 3 states exactly what happens.

- [ ] **Step 1: Write the suite**

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

type Client = SupabaseClient<Database>;

describe.skipIf(!integrationTargetReady())("RLS: folder members", () => {
  let admin: Client;
  const createdUserIds: string[] = [];

  // A owns org A, a workspace, two boards and a folder holding board 1.
  // C is a plain member of org A with no board grant. G is a guest of org A.
  // B owns a separate org.
  let a: { id: string; anon: Client; orgId: string };
  let b: { id: string; anon: Client; orgId: string };
  let c: { id: string; anon: Client };
  let g: { id: string; anon: Client };
  let ws: string;
  let board1: string;
  let board2: string;
  let folderId: string;
  let otherFolderId: string;

  async function newUser(label: string) {
    const email = `fm-${label}-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      app_metadata: { pre_approved: true },
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(error, `createUser(${label})`).toBeNull();
    const id = data.user!.id;
    createdUserIds.push(id);
    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(anon, { email, password: PASSWORD });
    return { id, anon, email };
  }

  async function newOwner(label: string) {
    const u = await newUser(label);
    const { data: org, error } = await u.anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: `fm-${label}-${randomUUID().slice(0, 8)}`,
    });
    expect(error, `create_organization(${label})`).toBeNull();
    return { ...u, orgId: (org as { id: string }).id };
  }

  async function newBoard(anon: Client, workspaceId: string, label: string) {
    const { data, error } = await anon.rpc("create_board", {
      p_workspace_id: workspaceId,
      p_name: `Board ${label}`,
    });
    expect(error, `create_board(${label})`).toBeNull();
    return (data as { id: string }).id;
  }

  async function newFolder(
    anon: Client,
    orgId: string,
    userId: string,
    name: string,
  ) {
    const { data, error } = await anon
      .from("folders")
      .insert({ org_id: orgId, workspace_id: ws, name, created_by: userId })
      .select("id")
      .single();
    expect(error, `folder(${name})`).toBeNull();
    return (data as { id: string }).id;
  }

  async function canRead(anon: Client, boardId: string) {
    const { data } = await anon.from("boards").select("id").eq("id", boardId);
    return (data ?? []).length === 1;
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    a = await newOwner("a");
    b = await newOwner("b");
    c = await newUser("c");
    g = await newUser("g");
    const { error: cErr } = await admin
      .from("org_members")
      .insert({ org_id: a.orgId, user_id: c.id, role: "member" });
    expect(cErr, "org_members(c)").toBeNull();
    const { error: gErr } = await admin
      .from("org_members")
      .insert({ org_id: a.orgId, user_id: g.id, role: "guest" });
    expect(gErr, "org_members(g)").toBeNull();

    const { data: w, error: wErr } = await a.anon
      .from("workspaces")
      .insert({ org_id: a.orgId, name: "WS", created_by: a.id })
      .select("id")
      .single();
    expect(wErr, "workspace").toBeNull();
    ws = (w as { id: string }).id;
    board1 = await newBoard(a.anon, ws, "1");
    board2 = await newBoard(a.anon, ws, "2");
    folderId = await newFolder(a.anon, a.orgId, a.id, "Project");
    otherFolderId = await newFolder(a.anon, a.orgId, a.id, "Other");
    const { error: placeErr } = await a.anon
      .from("folder_boards")
      .insert({ folder_id: folderId, board_id: board1, position: 0 });
    expect(placeErr, "placement").toBeNull();
  }, 180_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("gives a plain member nothing before they are added", async () => {
    expect(await canRead(c.anon, board1)).toBe(false);
  });

  it("lets the folder's creator add a member as viewer; they read but cannot write", async () => {
    const { error } = await a.anon.rpc("share_folder", {
      p_folder_id: folderId,
      p_user_id: c.id,
      p_level: "viewer",
    });
    expect(error).toBeNull();
    expect(await canRead(c.anon, board1)).toBe(true);
    const { data: items, error: itemsErr } = await c.anon
      .from("items")
      .select("id")
      .eq("board_id", board1);
    expect(itemsErr).toBeNull();
    expect(Array.isArray(items)).toBe(true);
    const { data: renamed } = await c.anon
      .from("boards")
      .update({ name: "Hijacked" })
      .eq("id", board1)
      .select("id");
    expect(renamed ?? []).toHaveLength(0);
  });

  it("makes a board added to the folder readable with no further grant", async () => {
    expect(await canRead(c.anon, board2)).toBe(false);
    const { error } = await a.anon
      .from("folder_boards")
      .insert({ folder_id: folderId, board_id: board2, position: 1 });
    expect(error).toBeNull();
    expect(await canRead(c.anon, board2)).toBe(true);
  });

  it("lets an editor write", async () => {
    await a.anon.rpc("share_folder", {
      p_folder_id: folderId,
      p_user_id: c.id,
      p_level: "editor",
    });
    const { data } = await c.anon
      .from("boards")
      .update({ name: "Board 1 edited" })
      .eq("id", board1)
      .select("id");
    expect(data ?? []).toHaveLength(1);
  });

  it("refuses a non-manager who tries to share or to read invitations", async () => {
    const { error } = await c.anon.rpc("share_folder", {
      p_folder_id: folderId,
      p_user_id: g.id,
      p_level: "viewer",
    });
    expect(error?.code).toBe("42501");
    const { data } = await c.anon
      .from("folder_invitations")
      .select("id")
      .eq("folder_id", folderId);
    expect(data ?? []).toHaveLength(0);
  });

  it("refuses a non-owner of the board who tries to take it out of the shared folder", async () => {
    const { error } = await c.anon
      .from("folder_boards")
      .delete()
      .eq("board_id", board2);
    // RLS lets the row through (C can read the board); the trigger refuses.
    expect(error?.code).toBe("42501");
    expect(await canRead(c.anon, board2)).toBe(true);
  });

  it("stops access when the board is moved out by its owner", async () => {
    const { error } = await a.anon
      .from("folder_boards")
      .delete()
      .eq("board_id", board2);
    expect(error).toBeNull();
    expect(await canRead(c.anon, board2)).toBe(false);
  });

  it("gives a user in another org nothing, and they cannot add themselves", async () => {
    expect(await canRead(b.anon, board1)).toBe(false);
    const { error } = await b.anon.rpc("share_folder", {
      p_folder_id: folderId,
      p_user_id: b.id,
      p_level: "editor",
    });
    expect(error?.code).toBe("42501");
    const { error: insErr } = await b.anon.from("folder_members").insert({
      folder_id: folderId,
      org_id: a.orgId,
      user_id: b.id,
      access_level: "editor",
    });
    expect(insErr).not.toBeNull();
  });

  it("shows a guest only the folders they are a member of", async () => {
    const before = await g.anon
      .from("folders")
      .select("id")
      .eq("org_id", a.orgId);
    expect(before.data ?? []).toHaveLength(0);
    const refused = await g.anon.rpc("folder_rollup", {
      p_folder_id: folderId,
    });
    expect(refused.error).not.toBeNull();

    await a.anon.rpc("share_folder", {
      p_folder_id: folderId,
      p_user_id: g.id,
      p_level: "viewer",
    });
    const after = await g.anon
      .from("folders")
      .select("id")
      .eq("org_id", a.orgId);
    expect((after.data ?? []).map((f) => f.id)).toEqual([folderId]);
    expect(await canRead(g.anon, board1)).toBe(true);
    const other = await g.anon.rpc("folder_rollup", {
      p_folder_id: otherFolderId,
    });
    expect(other.error).not.toBeNull();
  });

  it("does not let a guest create a folder or a board", async () => {
    const { error: folderErr } = await g.anon.from("folders").insert({
      org_id: a.orgId,
      workspace_id: ws,
      name: "Guest folder",
      created_by: g.id,
    });
    expect(folderErr?.code).toBe("42501");
    const { error: boardErr } = await g.anon.rpc("create_board", {
      p_workspace_id: ws,
      p_name: "Guest board",
    });
    expect(boardErr).not.toBeNull();
  });

  it("records a pending invitation that grants nothing, visible only to managers", async () => {
    const email = `fm-invitee-${randomUUID()}@example.com`;
    const { data, error } = await a.anon.rpc("invite_to_folder", {
      p_folder_id: folderId,
      p_email: email,
      p_level: "viewer",
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
    const mine = await a.anon
      .from("folder_invitations")
      .select("id, status")
      .eq("folder_id", folderId)
      .eq("email", email);
    expect(mine.data).toHaveLength(1);
    const orgInvite = await admin
      .from("org_invitations")
      .select("role, status")
      .eq("org_id", a.orgId)
      .eq("email", email);
    expect(orgInvite.data).toEqual([{ role: "guest", status: "pending" }]);

    const { error: revokeErr } = await a.anon.rpc("revoke_folder_invitation", {
      p_id: mine.data![0].id,
    });
    expect(revokeErr).toBeNull();
    const after = await admin
      .from("org_invitations")
      .select("status")
      .eq("org_id", a.orgId)
      .eq("email", email);
    expect(after.data).toEqual([{ status: "revoked" }]);
  });

  it("redeems a folder invitation into membership when the invitee signs in", async () => {
    const invitee = await newUser("invitee");
    const { error } = await a.anon.rpc("invite_to_folder", {
      p_folder_id: folderId,
      p_email: invitee.email,
      p_level: "editor",
    });
    expect(error).toBeNull();
    expect(await canRead(invitee.anon, board1)).toBe(false);

    const { error: redeemErr } = await invitee.anon.rpc("redeem_invitations");
    expect(redeemErr).toBeNull();
    expect(await canRead(invitee.anon, board1)).toBe(true);
    const { data: role } = await admin
      .from("org_members")
      .select("role")
      .eq("org_id", a.orgId)
      .eq("user_id", invitee.id);
    expect(role).toEqual([{ role: "guest" }]);
  });

  it("removes access when a member is removed from the folder, and they can leave by themself", async () => {
    const { error } = await a.anon.rpc("unshare_folder", {
      p_folder_id: folderId,
      p_user_id: c.id,
    });
    expect(error).toBeNull();
    expect(await canRead(c.anon, board1)).toBe(false);

    const { error: leaveErr } = await g.anon
      .from("folder_members")
      .delete()
      .eq("folder_id", folderId)
      .eq("user_id", g.id);
    expect(leaveErr).toBeNull();
    expect(await canRead(g.anon, board1)).toBe(false);
  });

  it("grants nothing to a deactivated org member whose folder row is still there", async () => {
    await a.anon.rpc("share_folder", {
      p_folder_id: folderId,
      p_user_id: c.id,
      p_level: "editor",
    });
    expect(await canRead(c.anon, board1)).toBe(true);
    const { error } = await admin
      .from("org_members")
      .update({ deactivated_at: new Date().toISOString() })
      .eq("org_id", a.orgId)
      .eq("user_id", c.id);
    expect(error).toBeNull();
    expect(await canRead(c.anon, board1)).toBe(false);
  });
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. A failure on an RPC name means Task 3's types are missing that function; stop and report.

- [ ] **Step 3: Run it — expected to skip on this machine**

How the suite gets a database (read on 2026-11-14):

- Integration suites run only through `pnpm test:integration` (`package.json:24`, `vitest run --project integration`). `pnpm test`, `scripts/finish-task.sh` and CI never run them (`CONTRIBUTING.md:317-319`; `.github/workflows/ci.yml:20` runs the unit project only).
- They need a gitignored `.env.test` in the repo root pointing at a **dedicated test project**, with `PULSE_TEST_DB=1` (`CONTRIBUTING.md:302-312`). `integrationTargetReady()` refuses DEV and PROD by project ref even if the marker is set (`src/test/integration-env.ts:29-32`, `:83-88`).
- That project gets its schema from the migration files: `supabase link --project-ref <test-ref>`, `supabase db push`, then relink to DEV (`CONTRIBUTING.md:289-299`). Nothing applies migrations to it automatically.
- There is **no `.env.test`** in this worktree or in the main checkout, so no test project is configured here.

Run: `pnpm vitest run --project integration src/lib/folders/folder-members.rls.integration.test.ts` (foreground, timeout 600000)
Expected: the suite is reported **skipped** (`describe.skipIf(!integrationTargetReady())`), exit code 0. Report "written, typechecked, skipped: no test project configured".

Do not create `.env.test`, do not point it at DEV, and do not run `supabase db push` anywhere. If the owner later provisions a test project, the run is:

```bash
supabase link --project-ref <test-project-ref>
supabase db push
supabase link --project-ref hjqcahbbbdaknbbnfnvl
pnpm vitest run --project integration src/lib/folders/folder-members.rls.integration.test.ts
```

Until then, the database evidence for this branch is Task 3's rolled-back access matrix on DEV (25 checks) and Task 10's live run.

- [ ] **Step 4: Report for commit**

```bash
git add src/lib/folders/folder-members.rls.integration.test.ts
git commit -m "test(folders): cover folder member access in the rls integration suite"
```

---

### Task 9: Gates and whole-branch review (ORCHESTRATOR)

- [ ] **Step 1: Four gates on the merged task branch**

Run each in the foreground, timeout 600000:

```bash
rm -rf .next/types
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all four pass. Paste the tail of each into the session before going on.

- [ ] **Step 2: Whole-branch review**

Invoke `superpowers:requesting-code-review` on `git diff develop...HEAD`, giving the reviewer the spec path and this plan path, and asking specifically for cross-task defects:

- a path that reads a board through a folder in SQL but not in a TypeScript copy, or the reverse (compare `can_read_board` with `getBoardAccessCore`, `listSharedBoardsCached`, `listSharedBoards`, `listReadableBoardsCached`);
- any service-client read that now touches `folder_members` without both a `user_id` filter and an active-org check;
- any caller of `moveBoardToFolder` other than `src/components/boards/move-to-folder.tsx`, and any caller of `listFoldersCached` whose result is not passed through `visibleFolders` or `filterFolderNav`;
- any new SQL function without its `revoke`;
- anything in `CommandCenter.tsx` or `FilterBar.tsx` beyond the one `HeaderActions` element.

Fix every Critical and Important finding, re-run the four gates, and commit each fix by path.

---

### Task 10: Live run before merge (ORCHESTRATOR, owner's Chrome)

The migrations are already live on DEV (Task 3). The UI is not: run it from the worktree with `pnpm dev -p 3001` against DEV. `next dev` rewrites `AGENTS.md`; run `git checkout -- AGENTS.md` before any commit.

Use two existing accounts in the same org: the owner's (`A`) and a second plain member (`M`). Use a throwaway folder and board created for this run, not DAAS. Ask the owner before creating the fresh-email invite in step 7, because it creates a real pending account that a platform admin must approve.

- [ ] **Step 1:** As `A`, create folder "Invite test" and a board "Invite test 1" in it. Open the folder. Expected: an "Invite" button in the header, no avatar stack.
- [ ] **Step 2:** Click Invite, type part of `M`'s name, click Add at "Viewer". Expected: `M` appears in the list as Viewer; the header shows one avatar after closing.
- [ ] **Step 3:** As `M` (second browser profile), reload. Expected: "Invite test 1" is listed under "Shared with me" and under the folder; it opens; cells cannot be edited; the header button reads "People" and the dialog is read-only with "Leave folder".
- [ ] **Step 4:** As `A`, create "Invite test 2" outside the folder and move it in with "Move to folder". Expected: a confirm "1 person in Invite test will get access to this board." Confirm. As `M`, reload: board 2 is there with no further action.
- [ ] **Step 5:** As `A`, set `M` to Editor in the dialog. As `M`, reload and edit a cell. Expected: the edit saves.
- [ ] **Step 6:** As `A`, open board 1's Share dialog. Expected: `M`'s row shows "Through folder Invite test · Editor". Then remove `M` from the folder. As `M`, reload: both boards are gone from the sidebar and the board URL returns not found.
- [ ] **Step 7 (after the owner agrees):** As `A`, invite a fresh email address as Viewer. Expected: "Invitation sent. They get access after they sign up and are approved." and an "Invited" row. Follow the email, sign up; expected: the pending-approval page. Reopen the dialog as `A`: the row reads "Waiting for approval". Approve the account in the platform admin page; as the invitee press "Check again": they land in the app as a guest, see only "Invite test" and its boards; the sidebar's Planning section shows only "Folders"; the command palette lists no other folder; opening `/goals` directly shows an empty page.
- [ ] **Step 8:** As `A`, delete the test folder and boards, and revoke or remove the test invitee. Record what was observed at each step in the session.

Any step that does not match is a stop: fix, re-run the gates, repeat the failed step.

---

### Task 11: Finish (ORCHESTRATOR)

- [ ] **Step 1:** Message session `monolith-e0` that `task/folder-invites` is about to merge and that it changes `src/components/folders/HeaderActions.tsx` and one element in `CommandCenter.tsx`.
- [ ] **Step 2:** Run `scripts/finish-task.sh` from inside the worktree. It rebases onto the latest `develop`, runs the four gates on the merged state, merges, pushes, removes the worktree and deletes the branch. If it stops on a rebase conflict, resolve `git rebase develop` and re-run.
- [ ] **Step 3:** Give the owner the "How to test this" walkthrough (Task 10 steps 1 to 6, on `develop`) in the closing message, and run `/wrapup`.

## Self-review

- **Spec coverage.** §1 data model → Task 1 §1, §7. §2 one access rule → Task 1 §3, §4; Task 4; Task 5. §3 guests → Task 1 §6; Task 2; Task 5. §4 server operations → Task 1 §5, §8, §9; Task 6. §5 TypeScript copies and cache invalidation → Tasks 4, 5, 6. §6 UI → Tasks 4 (board dialog rows), 7. Performance budget → Task 3 Steps 1 to 4, Task 6 Step 7. Rollout and safety → Task 3. Testing → Tasks 1 (matrix), 4 to 8, 9, 10. Open points 1 to 3 → "Facts verified". Extra surfaces found while verifying → Deviations 10 and 11.
- **Not covered, by decision:** confining the member directory, workspaces, organizations and the Monos list for guests (Deviation 5).
- **No step is "inspect and decide".** Task 2 Steps 5 and 6 state verified facts with file:line. Every edit to an existing file names its anchor line and gives the code. The two remaining judgment calls are stop conditions for the orchestrator (Task 3 Steps 3 and 4), not implementation choices.
- **Names.** `FolderLevel` is declared in both `src/lib/boards/folder-levels.ts` (as `"editor" | "viewer"`) and `src/lib/folders/sharing-types.ts` (as `"viewer" | "editor"`). They are the same union and neither file imports the other; keep both rather than coupling the boards and folders modules. `FolderGrant` (boards) and `FolderAccessEntry` (folders) are different shapes on purpose.
- **Return shapes used across tasks:** `moveBoardToFolder` → `ActionResult<{ needsConfirm: number } | undefined>` (Tasks 6, 7; the only caller after Task 7 is `move-to-folder.tsx`). `loadBoardFolderGrants` → `ActionResult<FolderGrant[]>` (Task 4). `getFolderAccessForUserCached` → `{ isGuest, folderIds }` (Tasks 5, 7). `inviteToFolder` → `ActionResult<InviteOutcome>` (Tasks 6, 7). `invite_to_folder` → `uuid | null` (Tasks 1, 6, 8). `FolderPayload.access` → `FolderAccessHead` (Tasks 6, 7).
