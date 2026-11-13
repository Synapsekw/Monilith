# Personal Monos, Plan 2A: your Mono in the app

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every person can create their own Mono (a real no-login bot user in their org), give it a brain with their own API key, chat with it in a new "My Mono" right-rail tab where it acts under its own identity, and assign or @mention it on boards, while nobody else can direct it.

**Architecture:** Spec `docs/superpowers/specs/2026-11-13-personal-monos-design.md`, unit I (identity), unit O (owner-only direction) and the part of unit R needed for a usable Mono. Identity is a `monos` table plus an `agent` org role, guarded by triggers on `org_members`, `board_members`, `cell_values`, `notifications` and `ai_conversations`. The Mono's chat reuses the unified assistant runtime (`/api/ask`, `runAssistantLoop`, staging, the confirm card and `applyBatch`) with two switches: tools and applied writes run on `getMonoClient(monoId)` (ADR decision-44), and the model runs on the owner's personal key (`runAi({ credential: "personal" })`). Every write still goes through the confirm card because the owner is present.

**Tech Stack:** Next.js 16 App Router (RSC, Server Actions, `"use cache"` + `updateTag`), Supabase (Postgres, RLS, column grants, pg_cron, GoTrue admin API), TypeScript strict, Zod, Zustand, Vitest + Testing Library, Vercel AI SDK, React 19, Canvas 2D (`MonoAvatar`).

## Global Constraints

- Work in a worktree: `scripts/start-task.sh monos-p2a`, then build inside `/Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/monos-p2a`. Implementer subagents **must not** run `scripts/finish-task.sh`, merge, push, `git stash`, or switch branches. The orchestrator commits by path, reviews, and finishes. Parallel implementers each get their own worktree off `task/monos-p2a`; the orchestrator rebases and fast-forwards them one at a time.
- Every Bash call in a worktree starts with `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/monos-p2a &&` (or the implementer's own worktree path). One plain git command per call. Run `pnpm test` in the foreground with a 600000 ms timeout.
- Migrations are minted only with `scripts/new-migration.sh <slug>`, applied to DEV through the `supabase-dev` MCP `apply_migration` with the **same version and name** as the file, then checked with `pnpm db:ledger-check`. DEV serves live users: check every migration in a rolled-back transaction first (the DEV check harness below), never run destructive experiments.
- After a migration, regenerate types with the `supabase-dev` MCP `generate_typescript_types`, write the result to `src/types/database.types.ts`, run `npx prettier --write src/types/database.types.ts` (`pnpm db:types` fails in worktrees). Never hand-edit that file.
- Every new SQL function: `revoke execute on function … from public, anon;` then grant only what it needs. The anon-reachability conformance suite in `pnpm test` probes DEV for this.
- Server Actions return `ActionResult` / `fail` from `src/lib/actions/result.ts`. Validate inputs with Zod at the boundary. `"use server"` files export async functions only. Grep for an existing helper before writing one.
- Commits: conventional commits, lower-case subject, header at most 100 characters, body ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage by explicit path only (never `git add -A`, `.` or `-a`). Run `git status` first.
- Gates for every code task: `pnpm typecheck && pnpm lint && pnpm test`. `pnpm build` runs in Tasks 8, 10 and before finishing.
- UI tasks (4, 8, 10, 11) load the `pulse-ui` skill and the `frontend-design` skill before writing components. Use `Kicker` instead of hand-rolled uppercase tracking, `hover:bg-state-hover` for hover states, token text sizes (no `text-[Npx]`).
- User-facing copy never says "Pulse". The org assistant keeps its configured name. Copy never says "agent dock".
- In-page toggles cost 0 server round-trips; never `router.push`/`<Link>` for a tab switch (gotcha-09).

## Scope: what 2A ships and what it does not

**In 2A:** the `agent` org role and `monos` table (spec §1), brain status `none`/`key` derived from `user_ai_credentials` (spec §2, `connected` stays an unused enum value), owner-only assign and mention (spec §4), the My Mono rail tab with first-open picker, Wake-up card, brain line, mood, board membership and an owner-only chat that acts as the Mono (spec §3 key brain, owner present; §9), Mono identity rendering in People cells, pickers, mentions and update authorship (spec §8 labelling), Settings → My Mono (§9), and dock copy without "agent dock".

**Plan 2B (not here):** `mono_inbox` and every wake-up (assignment, mention, reply, daily cron), `mono_runs`, `/api/ai/mono-job`, the `auto` classification, `mono_approvals`, the approvals list and amber dot, the autonomy conformance test, MCP "Drive my Mono" consent, Mono-bound OAuth tokens, `connected` brain, `get_my_assignments`, `ack_inbox`, behaviour prompts, `boards.assistant_playbook`, "items it is working on", the `needsyou` failure notification, and dropping the old agent tables (unit D). **In 2A a Mono does nothing on its own:** being assigned or @mentioned records the fact (cell value, `body.mentions`) and wakes nothing; it only acts while its owner chats with it, and every write waits for the owner's confirmation.

## Decisions this plan makes (the spec left them open)

| #   | Decision                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The bot auth user is created by a Server Action with the GoTrue admin API (`createUser({ id, email: mono-<id>@monolith.internal, email_confirm: true, app_metadata: { pre_approved: true } })`), then a **service-role-only** definer RPC `create_mono` writes `monos`, `profiles.is_agent` and the `agent` membership. | ADR-44 proved minting only for admin-API users; a SQL-inserted `auth.users` row has no `auth.identities` row for the magic-link path. Granting `create_mono` to service_role only means no client can turn an arbitrary user into a Mono. |
| D2  | Session growth: an hourly pg_cron job `mono-sessions-prune` deletes `auth.sessions` of agent profiles older than 2 hours; deleting a `monos` row also deletes its sessions.                                                                                                                                             | `admin.signOut` needs the old JWT, which a cold-started instance no longer has; a prune catches every leftover. Access tokens are verified by signature, so deleting a 2-hour-old session never breaks a cached (≤55 min) token.          |
| D3  | Cache invalidation: `forgetMonoSession(monoUserId)` in `src/lib/mono/session.ts`; every Mono entry point re-reads the caller-owned `monos` row before `getMonoClient` and calls `forgetMonoSession` when it is gone.                                                                                                    | A removed Mono loses its `org_members` and `board_members` rows in the same transaction, so even a still-valid cached token reads and writes nothing.                                                                                     |
| D4  | Chat threads reuse `ai_conversations` with a new `mono_id` column (owner is `user_id`, `visibility` forced `private`, no board or folder). A Mono can have several threads; the tab opens the latest and offers "New chat".                                                                                             | Reuses `getMessages`, `ai_messages` RLS, compaction, staging and `applyBatch` unchanged. One forever-thread would hit `getMessages`' oldest-first 200-row cap.                                                                            |
| D5  | `monos.brain` is stored and kept in sync by a trigger on `user_ai_credentials` (Anthropic or OpenAI row → `key`, else `none`; `connected` is never touched).                                                                                                                                                            | Pickers and the DB guard need it without reading another user's credentials; spec §1 names the column.                                                                                                                                    |
| D6  | The key brain uses the owner's personal credential regardless of the org's `ai_mode`, except `off`, through a new `runAi` argument `credential: "personal"`, metered as feature `mono_chat` against the owner.                                                                                                          | Spec §2: the key comes from `user_ai_credentials`. An org that turned AI off still gets no AI.                                                                                                                                            |
| D7  | A Mono's board access always equals its owner's (board creator → `editor`). Assigning your own Mono on a board adds it to that board.                                                                                                                                                                                   | "Only to boards the owner can access" and "owner loses access → Mono leaves" are one rule; auto-adding avoids an assignee that cannot see its item.                                                                                       |
| D8  | An asleep Mono (`brain = 'none'`) cannot be assigned: the DB rejects it.                                                                                                                                                                                                                                                | Spec §2 "With neither, it is asleep and cannot be assigned".                                                                                                                                                                              |
| D9  | The bot auth user is never deleted; removing a Mono deletes its `monos` row, memberships and sessions.                                                                                                                                                                                                                  | `item_updates.author_id` references `auth.users` with no cascade, so deleting an author fails, and authored history must keep its name.                                                                                                   |
| D10 | Monos are not people: `listOrgMembersCached`, `listOrgMemberProfiles`, `get_org_members` and the platform member count exclude `role = 'agent'`. Monos travel in a separate cached list (`listOrgMonosCached`) under the same `orgMembersTag`. `profiles.full_name` mirrors the Mono's name.                            | Keeps every existing people surface (workload, goals, members table, MCP tools) human-only with one filter each; name-only surfaces (dashboards) still read the right name.                                                               |
| D11 | Notifications whose recipient is an agent profile are dropped by a `BEFORE INSERT` trigger.                                                                                                                                                                                                                             | Covers every fan-out path (assign, mention, automations) at one boundary; a bot has no inbox and an `.internal` email.                                                                                                                    |
| D12 | Personal Mono code lives in `src/lib/monos/` and `src/components/mono/`.                                                                                                                                                                                                                                                | `src/lib/mono/` already hosts the website widget protocol; only `session.ts` (Plan 1) stays there.                                                                                                                                        |
| D13 | A Mono chat turn has no board focus in 2A (the "no page is in focus" line); the Mono finds boards with its read tools.                                                                                                                                                                                                  | The thread is not board-scoped; adding per-turn focus is a protocol change better done with 2B's item focus.                                                                                                                              |
| D14 | Adding the Mono to a board needs its owner to be able to open the board; a board creator who is not the owner can remove a Mono (existing "owner deletes" policy) but cannot add or re-share one.                                                                                                                       | Board creators keep control of who is on their board without being able to direct someone else's Mono.                                                                                                                                    |

## Verified facts this plan relies on (DEV `hjqca…` and `develop` @ 269463c0, 2026-11-13)

- `public.org_role` = `owner, admin, member, guest`. Adding `agent` needs its own migration: Postgres refuses to use an enum value in the transaction that added it, and `apply_migration` runs a file as one transaction.
- `profiles.is_agent boolean not null default false` exists (added by `20260720120517_board_agents.sql`); only the old Autopilot bot (`00000000-0000-4000-8000-00000000b071`) has it, with no org memberships. That bot was inserted straight into `auth.users`; Monos use the admin API instead (D1).
- `handle_new_user` inserts `profiles` and `account_approvals` (`approved` when `raw_app_meta_data.pre_approved = 'true'`); `org_members_require_approved_account` refuses unapproved members.
- Board access: `can_read_board` / `readable_board_ids` = org member (active) and (`boards.created_by` = me or a `board_members` row). `board_members(org_id, board_id, user_id, access_level board_access{viewer,editor}, granted_by → auth.users, created_at)`, PK `(board_id, user_id)`. Policies: creator inserts/updates/deletes, "member leaves" deletes own row, read if board readable. `share_board`/`unshare_board` are creator-only definers.
- Admin checks everywhere use `has_org_role(…, array['owner','admin'])` or `role === "owner" || role === "admin"` (`lib/org/guard.ts`, `lib/boards/automation-core.ts`, `lib/reports/access.ts`, `settings/members/page.tsx`); `agent` passes none of them. Seats are a stored `org_billing.seats` value, not a member count. The digest already selects `role in (owner, admin, member)`.
- People cells store `{ "userIds": string[] }` in `cell_values.value` (`peopleValueSchema`); every write goes through `upsertCellCore` (`src/lib/boards/actions/cell-core.ts`), which fans out `assigned` notifications via `notifyNewAssignees`.
- `notifications` insert policy requires `actor_id = auth.uid()` and `is_member_of(recipient_id, org_id)`; existing `BEFORE INSERT` trigger `gate_notification_by_pref`.
- `ai_conversations(id, org_id, user_id, workspace_id, title, summary, summarized_upto, created_at, updated_at, board_id, agent_id, run_id, visibility check in (private, board), folder_id)`; policies are owner-scoped plus `select_board_shared`. `ai_messages` policies follow conversation ownership. `getMessages` reads oldest-first with `MESSAGES_LIMIT = 200`.
- `user_ai_credentials(user_id, provider → ai_providers, secret_id, key_hint, …)`, PK `(user_id, provider)`, select-own policy; DEV has 2 rows. All 9 `org_ai_settings` rows are `per_user`; 3 orgs have no row (= `off`).
- `postgres` may delete from `auth.sessions` (refresh tokens cascade by `session_id`). `auth.sessions` has `created_at`.
- `item_updates.author_id → auth.users` has no `on delete` action; `org_members.user_id`, `board_members.user_id`, `profiles.id` cascade on auth user delete.
- `user_delete_reassign_authorship` sets `pulse.reassigning_authorship = 'on'` and rewrites `board_members.granted_by` before account deletion.
- `@supabase/auth-js@2.115.0` `AdminUserAttributes` accepts `id`, `email_confirm`, `app_metadata`, `user_metadata`. `createServiceClient()` exposes `auth.admin` (used in `lib/platform/actions.ts`).
- `src/lib/ai/model-request-shape.test.ts` scans `runAi({ … feature: "literal" … })` call sites and requires each feature in `FEATURE_TIERS` and vice versa; `model-map.test.ts` pins `AI_FEATURES` length at 13.
- `vitest.setup.ts` defines `globalThis.matchMedia`; jsdom returns `null` from `canvas.getContext`. Integration suites (`*.integration.test.ts`) run only under `--project integration` against a non-DEV target, so DB behaviour in this plan is proven with the rolled-back DEV harness below.

## Performance and data-fetching budget

| Moment                                       | Reads / writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Board page first paint                       | The existing speculative roster read becomes `loadBoardRoster`: `listOrgMembersCached` (unchanged, cached), `listOrgMonosCached` (cached under the same `orgMembersTag`, `limit 500`, filter `org_id` on `monos_one_per_owner`), and `get_my_mono` (one point read on the unique `(org_id, owner_id)` index). All three run in parallel inside the existing first wave, so the page gains no new wave. The rail's "on this board" flag reuses the page's existing `board_members` read. No model call. |
| Opening the dock / switching rail tabs       | 0 round-trips. Intelligence, the org assistant and My Mono are client state (`use-dock-state`).                                                                                                                                                                                                                                                                                                                                                                                                        |
| First open of My Mono with an awake Mono     | One Server Action `loadMyMonoThread`: `ai_conversations` latest row by `(mono_id, updated_at desc)` partial index, then `getMessages` (bounded, 200). Kept in a Zustand store per Mono, so coming back to the tab is 0 round-trips.                                                                                                                                                                                                                                                                    |
| Opening an assign picker or @mention list    | 0 round-trips: the viewer's own Mono already rides the member payload with `directable`.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Send a chat message                          | The existing streaming route (`/api/ask`) plus the Mono mint inside the turn (cached per instance ~55 min).                                                                                                                                                                                                                                                                                                                                                                                            |
| Confirm a staged change                      | Existing `applyBatch` Server Action (writes run as the Mono); touched boards refresh through the existing `useResyncBoards`.                                                                                                                                                                                                                                                                                                                                                                           |
| Create Mono                                  | One Server Action, then one `router.refresh()`: this is a server-data change (the org's member payload gains the Mono) and `updateTag(orgMembersTag)` has already invalidated it.                                                                                                                                                                                                                                                                                                                      |
| Rename / recolour / add or remove from board | One Server Action each; the rail and settings update local state; rename/recolour call `updateTag(orgMembersTag(orgId))`.                                                                                                                                                                                                                                                                                                                                                                              |
| Settings → My Mono                           | `get_my_mono` + `board_members` for the Mono (`board_members_user_id_idx`, `limit 100`) + the viewer's profile name.                                                                                                                                                                                                                                                                                                                                                                                   |
| DB triggers on hot paths                     | `cell_values` guard: one PK lookup on `columns`; only People cells read `monos` (PK). `notifications`: one PK lookup on `profiles`. `board_members` / `org_members` triggers touch `monos` by PK or unique index.                                                                                                                                                                                                                                                                                      |

## File structure

| Path                                                                                                                                                                              | Responsibility                                                                                              | Task |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---- |
| `supabase/migrations/<ts>_org_role_agent.sql`                                                                                                                                     | `org_role` gains `agent`                                                                                    | 1    |
| `supabase/migrations/<ts>_personal_monos_identity.sql`                                                                                                                            | `monos`, `org_monos`, brain sync, `create_mono`, `get_my_mono`, `update_my_mono`, org lifecycle, prune cron | 1    |
| `supabase/migrations/<ts>_mono_board_membership.sql`                                                                                                                              | Board membership guard, follow-owner trigger, add/remove RPCs                                               | 2    |
| `supabase/migrations/<ts>_mono_owner_only_assign.sql`                                                                                                                             | People-cell guard, notification drop for agents                                                             | 3    |
| `supabase/migrations/<ts>_mono_threads.sql`                                                                                                                                       | `ai_conversations.mono_id`, guard, index                                                                    | 9    |
| `src/components/mono/MonoAvatar.tsx` (+ test), `mono-palette.ts` (+ test), `mono-renderer.ts`                                                                                     | Hardened avatar, `isMonoColor`, `DEFAULT_MONO_COLOR`, `MONO_MOODS`                                          | 4    |
| `src/lib/monos/labels.ts` (+ test)                                                                                                                                                | `ownerPossessive`, `monoAccessibleLabel`, `brainLine`                                                       | 4    |
| `src/components/mono/MonoChip.tsx` (+ test)                                                                                                                                       | `AgentChip`, `MonoIdentity`                                                                                 | 4    |
| `src/components/mono/MonoNameColorForm.tsx` (+ test)                                                                                                                              | Name + 7 presets + custom colour form                                                                       | 4    |
| `src/lib/ai/gateway.ts` (+ test)                                                                                                                                                  | `credential: "personal"` path                                                                               | 5    |
| `src/lib/monos/types.ts`, `queries.ts`, `queries-cached.ts`, `actions.ts` (+ tests), `src/lib/validations/monos.ts`, `src/lib/mono/session.ts` (+ test)                           | Mono domain: shapes, reads, Server Actions, session forget                                                  | 6    |
| `src/lib/monos/people.ts` (+ test), roster files, `BoardHeader.tsx`, landing copy                                                                                                 | Monos are not people; copy                                                                                  | 7    |
| `src/lib/monos/members.ts` (+ test), `src/lib/monos/board-roster.ts`, board page, cells, editors, mentions, UpdatesTab, BulkBar                                                   | Monos in People cells, pickers, mentions, authorship                                                        | 8    |
| `src/lib/monos/turn.ts` (+ test), `src/lib/monos/thread-actions.ts`, `/api/ask`, `batch-actions.ts`, `conversation-actions.ts`, `conversations.ts`, `AskChat.tsx`, `model-map.ts` | Mono chat backend                                                                                           | 9    |
| `src/stores/board-intelligence.ts`, `src/stores/my-mono.ts`, dock files, `src/components/mono/rail/*`                                                                             | My Mono rail tab                                                                                            | 10   |
| `src/app/(app)/settings/my-mono/page.tsx`, `src/components/mono/MyMonoSettings.tsx`, settings nav                                                                                 | Settings → My Mono                                                                                          | 11   |

## Execution DAG

Edges (from each task's Interfaces):

- Task 1 (identity schema): none.
- Task 4 (avatar hardening, labels, chips, form): none.
- Task 5 (personal credential in the gateway): none.
- Task 2 (board membership schema): Task 1.
- Task 7 (Monos are not people, copy): Task 1 (`org_role` type includes `agent`).
- Task 3 (owner-only assignment schema): Task 2.
- Task 6 (Mono domain module): Tasks 1, 2 (RPC types).
- Task 8 (People cells, pickers, mentions, authorship): Tasks 4, 6, 7.
- Task 9 (Mono chat backend): Tasks 5, 6.
- Task 11 (Settings → My Mono): Tasks 4, 6.
- Task 10 (My Mono rail tab): Tasks 4, 6, 8, 9.
- Task 12 (live run, review, finish): all.

**Parallel batches** (each batch touches disjoint files; at most one task per batch creates a migration or writes `src/types/database.types.ts`):

| Batch | Tasks    | Migration / types owner | Notes                                                                                         |
| ----- | -------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| B1    | 1, 4, 5  | 1                       | 4 and 5 touch no DB.                                                                          |
| B2    | 2, 7     | 2                       | 7 edits roster reads and copy only.                                                           |
| B3    | 3, 6     | 3                       | 3 may leave types unchanged (trigger functions are not RPCs); regenerate anyway.              |
| B4    | 8, 9, 11 | 9                       | 8 owns the board page and People UI; 9 owns `/api/ask`, `AskChat`, threads; 11 owns settings. |
| B5    | 10       | none                    | Also edits the board page's `<BoardDock>` props (after 8).                                    |
| B6    | 12       | none                    | Orchestrator only.                                                                            |

**Critical path:** 1 → 2 → 6 → 8 → 10 → 12 (equal length via 6 → 9 → 10).

---

## DEV check harness (prepend verbatim to every rolled-back check in Tasks 1, 2, 3 and 9)

Run through `supabase-dev` MCP `execute_sql` as one string that starts with `begin;` and ends with the task's final `select …` and `rollback;`. The MCP returns the last result set, so the final `select` reports every check. Results are carried in transaction-local settings (`p2a.*`), which every role may set, so nothing is written to any table that survives. Never `commit`.

```sql
begin;
-- Act as the fixture owner for creation-metadata triggers (still the postgres role).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at, is_sso_user, is_anonymous) values
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-0000000002a1','authenticated','authenticated','p2a-owner@example.com','{"pre_approved":true}','{"full_name":"Ada Owner"}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-0000000002a2','authenticated','authenticated','p2a-mate@example.com','{"pre_approved":true}','{"full_name":"Ben Mate"}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-0000000002a3','authenticated','authenticated','mono-00000000-0000-4000-8000-0000000002a3@monolith.internal','{"pre_approved":true}','{"full_name":"Nova"}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-0000000002a4','authenticated','authenticated','mono-00000000-0000-4000-8000-0000000002a4@monolith.internal','{"pre_approved":true}','{"full_name":"Pip"}',now(),now(),now(),false,false);

insert into public.organizations (id, name, slug, created_by)
values ('00000000-0000-4000-8000-0000000002a0','P2A check','p2a-check-rolled-back','00000000-0000-4000-8000-0000000002a1');
insert into public.org_members (org_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a1','owner'),
  ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a2','member');
insert into public.workspaces (id, org_id, name, created_by)
values ('00000000-0000-4000-8000-0000000002b0','00000000-0000-4000-8000-0000000002a0','WS','00000000-0000-4000-8000-0000000002a1');
-- B1 is Ada's board; B2 is Ben's board, where Ada is an editor.
insert into public.boards (id, org_id, workspace_id, name, created_by) values
  ('00000000-0000-4000-8000-0000000002b1','00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002b0','Ada board','00000000-0000-4000-8000-0000000002a1'),
  ('00000000-0000-4000-8000-0000000002b2','00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002b0','Ben board','00000000-0000-4000-8000-0000000002a2');
insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
values ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002b2','00000000-0000-4000-8000-0000000002a1','editor','00000000-0000-4000-8000-0000000002a2');
insert into public.groups (id, org_id, board_id, name)
values ('00000000-0000-4000-8000-0000000002b3','00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002b2','G');
insert into public.columns (id, org_id, board_id, kind, name)
values ('00000000-0000-4000-8000-0000000002b4','00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002b2','people','Owner');
insert into public.items (id, org_id, board_id, group_id, name) values
  ('00000000-0000-4000-8000-0000000002b5','00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002b2','00000000-0000-4000-8000-0000000002b3','Task one'),
  ('00000000-0000-4000-8000-0000000002b6','00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002b2','00000000-0000-4000-8000-0000000002b3','Task two');
```

Fixture ids: org `…2a0`, Ada (owner) `…2a1`, Ben (teammate) `…2a2`, Nova (Ada's Mono) `…2a3`, Pip (Ben's Mono) `…2a4`, boards `…2b1` (Ada's) and `…2b2` (Ben's), people column `…2b4`, items `…2b5`, `…2b6`. If an existing trigger refuses a harness insert, fix the harness insert (add the column it needs) and note it in the commit body; never weaken a check.

To act as a person inside the transaction:

```sql
select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
set local role authenticated;
-- … statements …
reset role;
```

---

### Task 1: Identity schema (`agent` role, `monos`, lifecycle, session prune)

**Files:**

- Create: `supabase/migrations/<ts>_org_role_agent.sql` (via `scripts/new-migration.sh org_role_agent`)
- Create: `supabase/migrations/<ts>_personal_monos_identity.sql` (via `scripts/new-migration.sh personal_monos_identity`)
- Modify: `src/types/database.types.ts` (regenerated)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - Enum `public.org_role` value `'agent'` (TS: `Database["public"]["Enums"]["org_role"]` includes `"agent"`).
  - Table `public.monos(user_id uuid pk → auth.users cascade, org_id uuid → organizations cascade, owner_id uuid → auth.users cascade, name text 1..40, color text '^#[0-9a-f]{6}$', brain text in ('none','key','connected') default 'none', oauth_client_id uuid → oauth_clients set null, last_seen_at timestamptz, created_at, updated_at)`, unique `monos_one_per_owner (org_id, owner_id)`. `authenticated` may select every column except `brain` and `oauth_client_id`; no insert/update/delete grants.
  - View `public.org_monos(user_id, org_id, owner_id, name, color)` (security invoker).
  - RPC `create_mono(p_org_id uuid, p_owner_id uuid, p_mono_id uuid, p_name text, p_color text) returns uuid` — service_role only; idempotent per `(org_id, owner_id)`, returns the winning Mono id.
  - RPC `get_my_mono(p_org_id uuid) returns table(user_id uuid, org_id uuid, owner_id uuid, name text, color text, brain text, key_provider text, last_seen_at timestamptz, created_at timestamptz)` — authenticated; the caller's own Mono only. `key_provider` is `'anthropic'` when the owner has that key, else `'openai'`, else null.
  - RPC `update_my_mono(p_org_id uuid, p_name text, p_color text) returns void` — authenticated; also sets `profiles.full_name`.
  - `get_org_members` no longer returns `role = 'agent'` rows. `org_invitations.role` can never be `agent`.
  - Triggers: role guard on `org_members`; owner leaving (or a Mono's membership deleted) deletes the `monos` row; deleting a `monos` row deletes its `board_members`, `org_members` and `auth.sessions`; owner deactivation is mirrored to the Mono; brain kept in sync from `user_ai_credentials`.
  - `prune_mono_sessions() returns integer` + cron job `mono-sessions-prune` at `17 * * * *`.

- [ ] **Step 1: Confirm the starting state on DEV (read-only)**

Run through `supabase-dev` MCP `execute_sql`:

```sql
select
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'org_role') as org_roles,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_agent') as has_is_agent,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'monos') as monos_exists,
  (select count(*) from cron.job where jobname = 'mono-sessions-prune') as prune_job,
  (select count(*) from pg_proc where proname = 'set_updated_at') as has_set_updated_at;
```

Expected: `owner,admin,member,guest`, `1`, `0`, `0`, `≥1`.

- [ ] **Step 2: Mint and apply the enum migration**

Run: `scripts/new-migration.sh org_role_agent`. Content:

```sql
-- Personal Monos, Plan 2A / unit I. A Mono is an org member with its own
-- role value, so is_org_member/is_member_of keep working for its reads while
-- every admin path (has_org_role(['owner','admin']) and the app's
-- owner/admin checks) stays closed to it.
--
-- A file of its own: Postgres refuses to USE an enum value in the
-- transaction that added it, and apply_migration runs one file per
-- transaction. Additive and inert until the next migration uses it.
alter type public.org_role add value if not exists 'agent';
```

Apply it with `supabase-dev` MCP `apply_migration` (same version and name). Re-run Step 1's first column. Expected: `owner,admin,member,guest,agent`.

- [ ] **Step 3: Mint the identity migration and write it**

Run: `scripts/new-migration.sh personal_monos_identity`. Content:

```sql
-- Personal Monos, Plan 2A / unit I: one Mono per person per org.
-- Spec: docs/superpowers/specs/2026-11-13-personal-monos-design.md §1, §2.
-- Session mechanism: vault/decisions/2026-11-13-decision-44-mono-identity-session.md.

-- ── 1. monos ────────────────────────────────────────────────────────────────
create table public.monos (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  org_id          uuid not null references public.organizations (id) on delete cascade,
  owner_id        uuid not null references auth.users (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 40),
  color           text not null check (color ~ '^#[0-9a-f]{6}$'),
  brain           text not null default 'none' check (brain in ('none', 'key', 'connected')),
  oauth_client_id uuid references public.oauth_clients (id) on delete set null,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint monos_one_per_owner unique (org_id, owner_id),
  constraint monos_not_its_own_owner check (user_id <> owner_id)
);
create index monos_owner_idx on public.monos (owner_id);
create trigger monos_set_updated_at before update on public.monos
  for each row execute function public.set_updated_at();

-- RLS cannot hide single columns, so the secret-ish columns are simply not
-- granted. Inserts, updates and deletes happen only in definer functions.
alter table public.monos enable row level security;
revoke all on public.monos from anon, authenticated;
grant select (user_id, org_id, owner_id, name, color, last_seen_at, created_at, updated_at)
  on public.monos to authenticated;
create policy "monos: read if org member" on public.monos
  for select to authenticated using (public.is_org_member(org_id));

create view public.org_monos with (security_invoker = true) as
  select user_id, org_id, owner_id, name, color from public.monos;
revoke all on public.org_monos from anon;
grant select on public.org_monos to authenticated;

-- ── 2. brain: derived from the owner's own key ──────────────────────────────
create or replace function public._mono_brain_for(p_owner uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (
    select 1 from public.user_ai_credentials c
     where c.user_id = p_owner and c.provider in ('anthropic', 'openai')
  ) then 'key' else 'none' end;
$$;
revoke execute on function public._mono_brain_for(uuid) from public, anon, authenticated;

create or replace function public.tg_sync_mono_brain()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coalesce(new.user_id, old.user_id);
begin
  -- 'connected' belongs to the MCP consent flow (Plan 2B); a key change never
  -- downgrades it.
  update public.monos m
     set brain = public._mono_brain_for(v_owner)
   where m.owner_id = v_owner
     and m.brain <> 'connected'
     and m.brain is distinct from public._mono_brain_for(v_owner);
  return null;
end $$;
revoke execute on function public.tg_sync_mono_brain() from public, anon, authenticated;
create trigger user_ai_credentials_sync_mono_brain
  after insert or update or delete on public.user_ai_credentials
  for each row execute function public.tg_sync_mono_brain();

-- ── 3. creating a Mono (service role only) ──────────────────────────────────
-- The Server Action creates the bot with the GoTrue admin API first (a
-- magic-link-capable user; ADR decision-44), then calls this. Granting it to
-- service_role only means no client can turn an arbitrary user into a Mono.
create or replace function public.create_mono(
  p_org_id uuid, p_owner_id uuid, p_mono_id uuid, p_name text, p_color text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_existing uuid; v_email text;
begin
  select m.user_id into v_existing from public.monos m
   where m.org_id = p_org_id and m.owner_id = p_owner_id;
  if v_existing is not null then return v_existing; end if;

  if not exists (
    select 1 from public.org_members om
      join public.profiles p on p.id = om.user_id
     where om.org_id = p_org_id and om.user_id = p_owner_id
       and om.deactivated_at is null and om.role <> 'agent' and not p.is_agent
  ) then
    raise exception 'owner is not an active person in this org' using errcode = '42501';
  end if;

  select u.email into v_email from auth.users u where u.id = p_mono_id;
  if v_email is distinct from 'mono-' || p_mono_id::text || '@monolith.internal' then
    raise exception 'not a Mono bot user' using errcode = '42501';
  end if;
  if exists (select 1 from public.org_members om where om.user_id = p_mono_id)
     or exists (select 1 from public.monos m where m.user_id = p_mono_id) then
    raise exception 'that bot user is already in use' using errcode = '42501';
  end if;

  insert into public.monos (user_id, org_id, owner_id, name, color, brain)
  values (p_mono_id, p_org_id, p_owner_id, btrim(p_name), lower(p_color),
          public._mono_brain_for(p_owner_id))
  on conflict (org_id, owner_id) do nothing;
  if not found then
    select m.user_id into v_existing from public.monos m
     where m.org_id = p_org_id and m.owner_id = p_owner_id;
    return v_existing;
  end if;

  update public.profiles set is_agent = true, full_name = btrim(p_name) where id = p_mono_id;
  insert into public.org_members (org_id, user_id, role) values (p_org_id, p_mono_id, 'agent');
  return p_mono_id;
end $$;
revoke execute on function public.create_mono(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_mono(uuid, uuid, uuid, text, text) to service_role;

-- ── 4. the owner's own reads and edits ──────────────────────────────────────
create or replace function public.get_my_mono(p_org_id uuid)
returns table (user_id uuid, org_id uuid, owner_id uuid, name text, color text,
               brain text, key_provider text, last_seen_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.org_id, m.owner_id, m.name, m.color, m.brain,
         (select c.provider from public.user_ai_credentials c
           where c.user_id = m.owner_id and c.provider in ('anthropic', 'openai')
           order by (c.provider = 'anthropic') desc
           limit 1),
         m.last_seen_at, m.created_at
    from public.monos m
   where m.org_id = p_org_id and m.owner_id = (select auth.uid());
$$;
revoke execute on function public.get_my_mono(uuid) from public, anon;
grant execute on function public.get_my_mono(uuid) to authenticated;

create or replace function public.update_my_mono(p_org_id uuid, p_name text, p_color text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mono uuid;
begin
  update public.monos m set name = btrim(p_name), color = lower(p_color)
   where m.org_id = p_org_id and m.owner_id = (select auth.uid())
  returning m.user_id into v_mono;
  if v_mono is null then raise exception 'no Mono in this org' using errcode = 'P0002'; end if;
  -- Name-only surfaces (dashboards, old activity) read profiles.full_name.
  update public.profiles set full_name = btrim(p_name) where id = v_mono;
end $$;
revoke execute on function public.update_my_mono(uuid, text, text) from public, anon;
grant execute on function public.update_my_mono(uuid, text, text) to authenticated;

-- ── 5. a Mono is never a person, and a person never becomes a Mono ──────────
create or replace function public.tg_org_members_guard_agent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role
     and (old.role = 'agent' or new.role = 'agent') then
    raise exception 'a Mono''s role cannot change, and nobody can become one'
      using errcode = '42501';
  end if;
  if new.role = 'agent' then
    if not exists (select 1 from public.monos m
                    where m.user_id = new.user_id and m.org_id = new.org_id) then
      raise exception 'only a Mono can hold the agent role' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.profiles p where p.id = new.user_id and p.is_agent) then
    raise exception 'a bot cannot join an org as a person' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_org_members_guard_agent() from public, anon, authenticated;
create trigger org_members_guard_agent
  before insert or update of role on public.org_members
  for each row execute function public.tg_org_members_guard_agent();

alter table public.org_invitations
  add constraint org_invitations_role_not_agent check (role <> 'agent');

-- ── 6. lifecycle: leaving, deactivation, removal ────────────────────────────
-- The owner leaves (or is removed from) the org, or a Mono's own membership is
-- deleted: the Mono goes.
create or replace function public.tg_org_members_remove_monos()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.monos m
   where m.org_id = old.org_id
     and (m.owner_id = old.user_id or m.user_id = old.user_id);
  return null;
end $$;
revoke execute on function public.tg_org_members_remove_monos() from public, anon, authenticated;
create trigger org_members_remove_monos
  after delete on public.org_members
  for each row execute function public.tg_org_members_remove_monos();

-- A removed Mono loses every membership and every session in the same
-- transaction, so a token cached on a warm instance can read and write
-- nothing. The bot auth user and its profile stay: item_updates.author_id
-- has no cascade, and authored history must keep its name.
create or replace function public.tg_monos_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.board_members bm where bm.user_id = old.user_id;
  delete from public.org_members om where om.org_id = old.org_id and om.user_id = old.user_id;
  delete from auth.sessions s where s.user_id = old.user_id;
  return null;
end $$;
revoke execute on function public.tg_monos_cleanup() from public, anon, authenticated;
create trigger monos_cleanup
  after delete on public.monos
  for each row execute function public.tg_monos_cleanup();

-- Deactivating (or reactivating) the owner does the same to their Mono.
create or replace function public.tg_org_members_mirror_deactivation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'agent' or new.deactivated_at is not distinct from old.deactivated_at then
    return null;
  end if;
  update public.org_members om
     set deactivated_at = new.deactivated_at, deactivated_by = new.deactivated_by
    from public.monos m
   where m.org_id = new.org_id and m.owner_id = new.user_id
     and om.org_id = m.org_id and om.user_id = m.user_id;
  return null;
end $$;
revoke execute on function public.tg_org_members_mirror_deactivation() from public, anon, authenticated;
create trigger org_members_mirror_deactivation
  after update of deactivated_at on public.org_members
  for each row execute function public.tg_org_members_mirror_deactivation();

-- ── 7. the members list shows people only ───────────────────────────────────
create or replace function public.get_org_members(p_org_id uuid, p_limit integer default 50, p_offset integer default 0)
returns table(user_id uuid, email text, full_name text, role public.org_role,
              deactivated_at timestamptz, created_at timestamptz)
language sql security definer set search_path = '' as $$
  select m.user_id, u.email::text, (u.raw_user_meta_data ->> 'full_name'),
         m.role, m.deactivated_at, m.created_at
  from public.org_members m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id
    and m.role <> 'agent'
    and (
      public.has_org_role(p_org_id, array['owner','admin']::public.org_role[])
      or public.is_platform_admin()
    )
  order by m.created_at
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

-- ── 8. session growth (ADR decision-44 consequence) ─────────────────────────
-- Each mint leaves an auth.sessions row. Access tokens are verified by
-- signature and a Mono re-mints within 55 minutes, so a 2-hour-old session is
-- never in use. Bounded per run.
create or replace function public.prune_mono_sessions()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  with doomed as (
    select s.id from auth.sessions s
      join public.profiles p on p.id = s.user_id
     where p.is_agent and s.created_at < now() - interval '2 hours'
     limit 5000
  )
  delete from auth.sessions s using doomed d where s.id = d.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.prune_mono_sessions() from public, anon, authenticated;

select cron.schedule('mono-sessions-prune', '17 * * * *', $$select public.prune_mono_sessions()$$);
```

Before writing `get_org_members`, re-read the live definition (`select pg_get_functiondef('public.get_org_members(uuid,integer,integer)'::regprocedure);`) and confirm the only difference above is `and m.role <> 'agent'`. If the live body differs, keep the live body and add only that line.

- [ ] **Step 4: Check it in a rolled-back transaction on DEV**

One `execute_sql` string: the DEV check harness, then the full migration body from Step 3, then:

```sql
-- as postgres (stands in for the service role)
select public.create_mono('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a1','00000000-0000-4000-8000-0000000002a3','Nova','#7395FF');
select set_config('p2a.mono_role', (select role::text from public.org_members where user_id = '00000000-0000-4000-8000-0000000002a3'), true);
select set_config('p2a.mono_profile', (select is_agent::text || '/' || full_name from public.profiles where id = '00000000-0000-4000-8000-0000000002a3'), true);
select set_config('p2a.colour_lowered', (select color from public.monos where user_id = '00000000-0000-4000-8000-0000000002a3'), true);
select set_config('p2a.idempotent', public.create_mono('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a1','00000000-0000-4000-8000-0000000002a4','Other','#3fe0a5')::text, true);
select set_config('p2a.brain_before', (select brain from public.monos where user_id = '00000000-0000-4000-8000-0000000002a3'), true);
insert into public.user_ai_credentials (user_id, provider, secret_id, key_hint)
values ('00000000-0000-4000-8000-0000000002a1', 'openai', gen_random_uuid(), 'sk-…TEST');
select set_config('p2a.brain_after', (select brain from public.monos where user_id = '00000000-0000-4000-8000-0000000002a3'), true);
select set_config('p2a.members_list', (select count(*)::text from public.get_org_members('00000000-0000-4000-8000-0000000002a0') where user_id = '00000000-0000-4000-8000-0000000002a3'), true);
do $d$ begin
  begin
    update public.org_members set role = 'admin' where user_id = '00000000-0000-4000-8000-0000000002a3';
    perform set_config('p2a.no_promote', 'updated', true);
  exception when others then perform set_config('p2a.no_promote', sqlstate, true); end;
  begin
    update public.org_members set role = 'agent' where user_id = '00000000-0000-4000-8000-0000000002a2';
    perform set_config('p2a.no_become_agent', 'updated', true);
  exception when others then perform set_config('p2a.no_become_agent', sqlstate, true); end;
  begin
    insert into public.org_invitations (org_id, email, role, invited_by)
    values ('00000000-0000-4000-8000-0000000002a0', 'x@example.com', 'agent', '00000000-0000-4000-8000-0000000002a1');
    perform set_config('p2a.no_agent_invite', 'inserted', true);
  exception when others then perform set_config('p2a.no_agent_invite', sqlstate, true); end;
end $d$;

-- as Ben (teammate)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a2","role":"authenticated"}', true);
set local role authenticated;
select set_config('p2a.mate_sees_view', (select count(*)::text from public.org_monos where org_id = '00000000-0000-4000-8000-0000000002a0'), true);
do $d$ begin
  begin
    perform m.brain from public.monos m;
    perform set_config('p2a.mate_brain', 'readable', true);
  exception when others then perform set_config('p2a.mate_brain', sqlstate, true); end;
  begin
    perform public.create_mono('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a2','00000000-0000-4000-8000-0000000002a4','Pip','#3fe0a5');
    perform set_config('p2a.mate_cannot_create', 'called', true);
  exception when others then perform set_config('p2a.mate_cannot_create', sqlstate, true); end;
end $d$;
select set_config('p2a.mate_has_none', (select count(*)::text from public.get_my_mono('00000000-0000-4000-8000-0000000002a0')), true);
reset role;

-- as Ada (owner)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('p2a.owner_rpc', (select brain || '/' || coalesce(key_provider, '-') from public.get_my_mono('00000000-0000-4000-8000-0000000002a0')), true);
select public.update_my_mono('00000000-0000-4000-8000-0000000002a0', 'Nova Two', '#A77BFF');
reset role;
select set_config('p2a.rename_profile', (select full_name from public.profiles where id = '00000000-0000-4000-8000-0000000002a3'), true);

-- lifecycle
update public.org_members set deactivated_at = now()
 where org_id = '00000000-0000-4000-8000-0000000002a0' and user_id = '00000000-0000-4000-8000-0000000002a1';
select set_config('p2a.deactivation_mirrored', (select (deactivated_at is not null)::text from public.org_members where user_id = '00000000-0000-4000-8000-0000000002a3'), true);
delete from public.org_members
 where org_id = '00000000-0000-4000-8000-0000000002a0' and user_id = '00000000-0000-4000-8000-0000000002a1';
select set_config('p2a.owner_leaves', (select count(*)::text from public.monos where user_id = '00000000-0000-4000-8000-0000000002a3') || '/' || (select count(*)::text from public.org_members where user_id = '00000000-0000-4000-8000-0000000002a3'), true);
select set_config('p2a.prune_runs', (public.prune_mono_sessions() >= 0)::text, true);

select k, current_setting('p2a.' || k, true) as got, want,
       current_setting('p2a.' || k, true) = want as pass
  from (values
    ('mono_role','agent'), ('mono_profile','true/Nova'), ('colour_lowered','#7395ff'),
    ('idempotent','00000000-0000-4000-8000-0000000002a3'), ('brain_before','none'), ('brain_after','key'),
    ('members_list','0'), ('no_promote','42501'), ('no_become_agent','42501'), ('no_agent_invite','23514'),
    ('mate_sees_view','1'), ('mate_brain','42501'), ('mate_cannot_create','42501'), ('mate_has_none','0'),
    ('owner_rpc','key/openai'), ('rename_profile','Nova Two'), ('deactivation_mirrored','true'),
    ('owner_leaves','0/0'), ('prune_runs','true')
  ) v(k, want);
rollback;
```

Expected: every row `pass = true`. Fix the migration (not the check) for any `false`, and re-run.

- [ ] **Step 5: Apply, verify, ledger**

Apply with `supabase-dev` MCP `apply_migration` (same version and name). Then run:

```sql
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('monos', 'org_monos')) as objects,
  (select count(*) from cron.job where jobname = 'mono-sessions-prune') as prune_job,
  (select count(*) from public.monos) as monos_rows;
```

Expected: `2`, `1`, `0`. Run: `pnpm db:ledger-check`. Expected: clean.

- [ ] **Step 6: Regenerate types and run the gates**

Regenerate `src/types/database.types.ts` (Global Constraints). Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass (the anon conformance probes include the new functions and refuse them for `anon`).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/*_org_role_agent.sql supabase/migrations/*_personal_monos_identity.sql src/types/database.types.ts
git commit -m "feat(mono): monos table, agent role and mono lifecycle"
```

---

### Task 2: Board membership follows the owner

**Files:**

- Create: `supabase/migrations/<ts>_mono_board_membership.sql` (via `scripts/new-migration.sh mono_board_membership`)
- Modify: `src/types/database.types.ts` (regenerated)

**Interfaces:**

- Consumes: Task 1 (`monos`, `create_mono`).
- Produces:
  - A `board_members` row for a Mono is accepted only when `granted_by` is its owner, the board is in the Mono's org, and the owner can open the board; its `access_level` is forced to the owner's (creator → `editor`).
  - When the owner's own `board_members` row is deleted or its level changes, the Mono's row follows (deleted when the owner no longer has access).
  - RPC `add_my_mono_to_board(p_board_id uuid) returns void` and `remove_my_mono_from_board(p_board_id uuid) returns void` — authenticated.
  - Internal `_owner_board_level(p_board_id uuid, p_owner uuid) returns board_access` (no client grant).

- [ ] **Step 1: Mint the migration and write it**

Run: `scripts/new-migration.sh mono_board_membership`. Content:

```sql
-- Personal Monos, Plan 2A / unit I (board membership). A Mono is on a board
-- only because its owner put it there, only while the owner can open that
-- board, and always at the owner's own access level.

create or replace function public._owner_board_level(p_board_id uuid, p_owner uuid)
returns public.board_access language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.boards b where b.id = p_board_id and b.created_by = p_owner)
      then 'editor'::public.board_access
    else (select bm.access_level from public.board_members bm
           where bm.board_id = p_board_id and bm.user_id = p_owner)
  end;
$$;
revoke execute on function public._owner_board_level(uuid, uuid) from public, anon, authenticated;

create or replace function public.tg_board_members_guard_mono()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_org uuid; v_level public.board_access;
begin
  select m.owner_id, m.org_id into v_owner, v_org from public.monos m where m.user_id = new.user_id;
  if v_owner is null then return new; end if;
  -- Account deletion re-attributes granted_by to a surviving org owner
  -- (user_delete_reassign_authorship); that rewrite must not be refused.
  if tg_op = 'UPDATE' and coalesce(current_setting('pulse.reassigning_authorship', true), '') = 'on' then
    return new;
  end if;
  if new.granted_by is distinct from v_owner then
    raise exception 'only its owner can add a Mono to a board' using errcode = '42501';
  end if;
  if new.org_id is distinct from v_org then
    raise exception 'that board is in another organization' using errcode = '42501';
  end if;
  v_level := public._owner_board_level(new.board_id, v_owner);
  if v_level is null then
    raise exception 'the Mono''s owner cannot open this board' using errcode = '42501';
  end if;
  new.access_level := v_level;
  return new;
end $$;
revoke execute on function public.tg_board_members_guard_mono() from public, anon, authenticated;
create trigger board_members_guard_mono
  before insert or update on public.board_members
  for each row execute function public.tg_board_members_guard_mono();

create or replace function public.tg_board_members_follow_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_board uuid := case when tg_op = 'DELETE' then old.board_id else new.board_id end;
  v_user  uuid := case when tg_op = 'DELETE' then old.user_id  else new.user_id  end;
  v_org   uuid := case when tg_op = 'DELETE' then old.org_id   else new.org_id   end;
  v_mono  uuid;
  v_level public.board_access;
begin
  select m.user_id into v_mono from public.monos m where m.owner_id = v_user and m.org_id = v_org;
  if v_mono is null then return null; end if;
  v_level := public._owner_board_level(v_board, v_user);
  if v_level is null then
    delete from public.board_members bm where bm.board_id = v_board and bm.user_id = v_mono;
  else
    update public.board_members bm set access_level = v_level
     where bm.board_id = v_board and bm.user_id = v_mono and bm.access_level <> v_level;
  end if;
  return null;
end $$;
revoke execute on function public.tg_board_members_follow_owner() from public, anon, authenticated;
create trigger board_members_follow_owner
  after delete or update of access_level on public.board_members
  for each row execute function public.tg_board_members_follow_owner();

create or replace function public.add_my_mono_to_board(p_board_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_mono uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.can_read_board(p_board_id) then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  select b.org_id into v_org from public.boards b where b.id = p_board_id;
  select m.user_id into v_mono from public.monos m where m.org_id = v_org and m.owner_id = v_uid;
  if v_mono is null then raise exception 'no Mono in this org' using errcode = 'P0002'; end if;
  -- access_level is overwritten by board_members_guard_mono.
  insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
  values (v_org, p_board_id, v_mono, 'viewer', v_uid)
  on conflict (board_id, user_id) do nothing;
end $$;
revoke execute on function public.add_my_mono_to_board(uuid) from public, anon;
grant execute on function public.add_my_mono_to_board(uuid) to authenticated;

create or replace function public.remove_my_mono_from_board(p_board_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from public.board_members bm
   using public.monos m, public.boards b
   where b.id = p_board_id and bm.board_id = p_board_id
     and m.owner_id = v_uid and m.org_id = b.org_id and bm.user_id = m.user_id;
end $$;
revoke execute on function public.remove_my_mono_from_board(uuid) from public, anon;
grant execute on function public.remove_my_mono_from_board(uuid) to authenticated;
```

- [ ] **Step 2: Check it in a rolled-back transaction on DEV**

One `execute_sql` string: the DEV check harness, the full Step 1 body, then:

```sql
select public.create_mono('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a1','00000000-0000-4000-8000-0000000002a3','Nova','#7395ff');

-- Ada adds Nova to her own board and to Ben's board.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);
set local role authenticated;
select public.add_my_mono_to_board('00000000-0000-4000-8000-0000000002b1');
select public.add_my_mono_to_board('00000000-0000-4000-8000-0000000002b2');
reset role;
select set_config('p2a.own_board_level', (select access_level::text from public.board_members where board_id = '00000000-0000-4000-8000-0000000002b1' and user_id = '00000000-0000-4000-8000-0000000002a3'), true);

-- Ben (creator of B2) may not re-share or add Nova.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a2","role":"authenticated"}', true);
set local role authenticated;
do $d$ begin
  begin
    perform public.share_board('00000000-0000-4000-8000-0000000002b2', '00000000-0000-4000-8000-0000000002a3', 'editor');
    perform set_config('p2a.creator_cannot_share', 'shared', true);
  exception when others then perform set_config('p2a.creator_cannot_share', sqlstate, true); end;
end $d$;
reset role;

-- Ada drops to viewer on B2: Nova follows.
update public.board_members set access_level = 'viewer'
 where board_id = '00000000-0000-4000-8000-0000000002b2' and user_id = '00000000-0000-4000-8000-0000000002a1';
select set_config('p2a.follows_level', (select access_level::text from public.board_members where board_id = '00000000-0000-4000-8000-0000000002b2' and user_id = '00000000-0000-4000-8000-0000000002a3'), true);

-- Account deletion's re-attribution is not refused.
select set_config('pulse.reassigning_authorship', 'on', true);
update public.board_members set granted_by = '00000000-0000-4000-8000-0000000002a2'
 where board_id = '00000000-0000-4000-8000-0000000002b1' and user_id = '00000000-0000-4000-8000-0000000002a3';
select set_config('pulse.reassigning_authorship', '', true);
update public.board_members set granted_by = '00000000-0000-4000-8000-0000000002a1'
 where board_id = '00000000-0000-4000-8000-0000000002b1' and user_id = '00000000-0000-4000-8000-0000000002a3';
select set_config('p2a.reassign_ok', 'yes', true);

-- Ben unshares Ada from B2: Nova leaves B2, stays on B1.
delete from public.board_members
 where board_id = '00000000-0000-4000-8000-0000000002b2' and user_id = '00000000-0000-4000-8000-0000000002a1';
select set_config('p2a.leaves_with_owner', (select count(*)::text from public.board_members where board_id = '00000000-0000-4000-8000-0000000002b2' and user_id = '00000000-0000-4000-8000-0000000002a3') || '/' || (select count(*)::text from public.board_members where board_id = '00000000-0000-4000-8000-0000000002b1' and user_id = '00000000-0000-4000-8000-0000000002a3'), true);

-- Ada can no longer add Nova to B2.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);
set local role authenticated;
do $d$ begin
  begin
    perform public.add_my_mono_to_board('00000000-0000-4000-8000-0000000002b2');
    perform set_config('p2a.no_add_without_access', 'added', true);
  exception when others then perform set_config('p2a.no_add_without_access', sqlstate, true); end;
end $d$;
-- Nova reads its own board only.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a3","role":"authenticated"}', true);
select set_config('p2a.mono_reads', (select string_agg(name, ',' order by name) from public.boards where org_id = '00000000-0000-4000-8000-0000000002a0'), true);
-- Ada removes Nova from B1.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);
select public.remove_my_mono_from_board('00000000-0000-4000-8000-0000000002b1');
reset role;
select set_config('p2a.removed', (select count(*)::text from public.board_members where user_id = '00000000-0000-4000-8000-0000000002a3'), true);

select k, current_setting('p2a.' || k, true) as got, want,
       current_setting('p2a.' || k, true) = want as pass
  from (values
    ('own_board_level','editor'), ('creator_cannot_share','42501'), ('follows_level','viewer'),
    ('reassign_ok','yes'), ('leaves_with_owner','0/1'), ('no_add_without_access','P0002'),
    ('mono_reads','Ada board'), ('removed','0')
  ) v(k, want);
rollback;
```

Expected: every row `pass = true`. (`no_add_without_access` is `P0002` because `can_read_board` is false for Ada on B2 now.)

- [ ] **Step 3: Apply, ledger, types, gates**

Apply with `apply_migration`. Run: `pnpm db:ledger-check` (clean). Regenerate types. Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_mono_board_membership.sql src/types/database.types.ts
git commit -m "feat(mono): a mono's board access follows its owner"
```

---

### Task 3: Only the owner assigns their Mono; agents get no notifications

**Files:**

- Create: `supabase/migrations/<ts>_mono_owner_only_assign.sql` (via `scripts/new-migration.sh mono_owner_only_assign`)
- Modify: `src/types/database.types.ts` (regenerated; may be unchanged)

**Interfaces:**

- Consumes: Task 2 (`board_members_guard_mono`).
- Produces:
  - A `cell_values` write on a `people` column that **adds** a Mono raises `42501` unless `auth.uid()` is that Mono's owner (so a Mono never adds a Mono, and a service-role write with no user cannot add one), raises `P0001` when the Mono is asleep, and otherwise puts the Mono on the board. Removing a Mono is always allowed.
  - Any `notifications` insert whose recipient is an agent profile is silently dropped.

- [ ] **Step 1: Mint the migration and write it**

Run: `scripts/new-migration.sh mono_owner_only_assign`. Content:

```sql
-- Personal Monos, Plan 2A / unit O. Owner-only assignment, enforced at the
-- one table every People write reaches (upsertCellCore, MCP, automations,
-- imports), not only in pickers or prompts.

create or replace function public.tg_cell_values_guard_mono_assign()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_new text[] := '{}';
  v_old text[] := '{}';
  r record;
begin
  if (select c.kind from public.columns c where c.id = new.column_id)
       is distinct from 'people'::public.column_kind then
    return new;
  end if;
  if jsonb_typeof(new.value -> 'userIds') = 'array' then
    select coalesce(array_agg(x), '{}') into v_new
      from jsonb_array_elements_text(new.value -> 'userIds') as t(x);
  end if;
  if tg_op = 'UPDATE' and jsonb_typeof(old.value -> 'userIds') = 'array' then
    select coalesce(array_agg(x), '{}') into v_old
      from jsonb_array_elements_text(old.value -> 'userIds') as t(x);
  end if;
  for r in
    select m.user_id, m.owner_id, m.brain from public.monos m
     where m.user_id::text = any (v_new) and not (m.user_id::text = any (v_old))
  loop
    if v_uid is null or v_uid <> r.owner_id then
      raise exception 'only its owner can assign a Mono' using errcode = '42501';
    end if;
    if r.brain = 'none' then
      raise exception 'this Mono is asleep. Give it a brain before assigning it'
        using errcode = 'P0001';
    end if;
    -- The owner can edit this board (RLS let the write through), so their Mono
    -- may join it; board_members_guard_mono sets the level.
    insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
    values (new.org_id, new.board_id, r.user_id, 'viewer', r.owner_id)
    on conflict (board_id, user_id) do nothing;
  end loop;
  return new;
end $$;
revoke execute on function public.tg_cell_values_guard_mono_assign() from public, anon, authenticated;
create trigger cell_values_guard_mono_assign
  before insert or update of value on public.cell_values
  for each row execute function public.tg_cell_values_guard_mono_assign();

-- A bot has no inbox and an internal address. Plan 2B's mono_inbox is how a
-- Mono hears about work.
create or replace function public.tg_notifications_skip_agents()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.recipient_id and p.is_agent) then
    return null;
  end if;
  return new;
end $$;
revoke execute on function public.tg_notifications_skip_agents() from public, anon, authenticated;
create trigger notifications_skip_agents
  before insert on public.notifications
  for each row execute function public.tg_notifications_skip_agents();
```

- [ ] **Step 2: Check it in a rolled-back transaction on DEV**

One `execute_sql` string: the DEV check harness, the full Step 1 body, then:

```sql
select public.create_mono('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a1','00000000-0000-4000-8000-0000000002a3','Nova','#7395ff');
select public.create_mono('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a2','00000000-0000-4000-8000-0000000002a4','Pip','#3fe0a5');
insert into public.user_ai_credentials (user_id, provider, secret_id, key_hint)
values ('00000000-0000-4000-8000-0000000002a2', 'anthropic', gen_random_uuid(), 'sk-…TEST');

-- Ada, asleep Nova: refused.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);
set local role authenticated;
do $d$ begin
  begin
    insert into public.cell_values (org_id, board_id, item_id, column_id, value)
    values ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002b2','00000000-0000-4000-8000-0000000002b5','00000000-0000-4000-8000-0000000002b4','{"userIds":["00000000-0000-4000-8000-0000000002a3"]}');
    perform set_config('p2a.asleep', 'assigned', true);
  exception when others then perform set_config('p2a.asleep', sqlstate, true); end;
end $d$;
reset role;
insert into public.user_ai_credentials (user_id, provider, secret_id, key_hint)
values ('00000000-0000-4000-8000-0000000002a1', 'anthropic', gen_random_uuid(), 'sk-…TEST');

-- Ada assigns awake Nova (with herself): allowed, Nova joins B2 as editor.
set local role authenticated;
insert into public.cell_values (org_id, board_id, item_id, column_id, value)
values ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002b2','00000000-0000-4000-8000-0000000002b5','00000000-0000-4000-8000-0000000002b4','{"userIds":["00000000-0000-4000-8000-0000000002a1","00000000-0000-4000-8000-0000000002a3"]}');
reset role;
select set_config('p2a.owner_assigns', (select access_level::text from public.board_members where board_id = '00000000-0000-4000-8000-0000000002b2' and user_id = '00000000-0000-4000-8000-0000000002a3'), true);

-- Ada assigns Ben's Pip: refused.
set local role authenticated;
do $d$ begin
  begin
    insert into public.cell_values (org_id, board_id, item_id, column_id, value)
    values ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002b2','00000000-0000-4000-8000-0000000002b6','00000000-0000-4000-8000-0000000002b4','{"userIds":["00000000-0000-4000-8000-0000000002a4"]}');
    perform set_config('p2a.not_your_mono', 'assigned', true);
  exception when others then perform set_config('p2a.not_your_mono', sqlstate, true); end;
end $d$;
reset role;

-- Ben adds Ada's Nova to item two: refused. Ben removes Nova from item one: allowed.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a2","role":"authenticated"}', true);
set local role authenticated;
do $d$ begin
  begin
    insert into public.cell_values (org_id, board_id, item_id, column_id, value)
    values ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002b2','00000000-0000-4000-8000-0000000002b6','00000000-0000-4000-8000-0000000002b4','{"userIds":["00000000-0000-4000-8000-0000000002a3"]}');
    perform set_config('p2a.mate_assigns', 'assigned', true);
  exception when others then perform set_config('p2a.mate_assigns', sqlstate, true); end;
end $d$;
update public.cell_values set value = '{"userIds":["00000000-0000-4000-8000-0000000002a1"]}'
 where item_id = '00000000-0000-4000-8000-0000000002b5' and column_id = '00000000-0000-4000-8000-0000000002b4';
select set_config('p2a.mate_removes', (select value::text from public.cell_values where item_id = '00000000-0000-4000-8000-0000000002b5' and column_id = '00000000-0000-4000-8000-0000000002b4'), true);
reset role;

-- Nova (an editor on B2 now) cannot add a Mono, including Pip.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a3","role":"authenticated"}', true);
set local role authenticated;
do $d$ begin
  begin
    update public.cell_values set value = '{"userIds":["00000000-0000-4000-8000-0000000002a1","00000000-0000-4000-8000-0000000002a4"]}'
     where item_id = '00000000-0000-4000-8000-0000000002b5' and column_id = '00000000-0000-4000-8000-0000000002b4';
    perform set_config('p2a.mono_assigns_mono', 'assigned', true);
  exception when others then perform set_config('p2a.mono_assigns_mono', sqlstate, true); end;
end $d$;
reset role;

-- A notification to Nova is dropped; one to Ben lands.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);
set local role authenticated;
insert into public.notifications (org_id, recipient_id, actor_id, kind, board_id, item_id) values
  ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a3','00000000-0000-4000-8000-0000000002a1','assigned','00000000-0000-4000-8000-0000000002b2','00000000-0000-4000-8000-0000000002b5'),
  ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a2','00000000-0000-4000-8000-0000000002a1','assigned','00000000-0000-4000-8000-0000000002b2','00000000-0000-4000-8000-0000000002b5');
reset role;
select set_config('p2a.notifications', (select count(*) filter (where recipient_id = '00000000-0000-4000-8000-0000000002a3')::text || '/' || count(*) filter (where recipient_id = '00000000-0000-4000-8000-0000000002a2')::text from public.notifications where org_id = '00000000-0000-4000-8000-0000000002a0'), true);

select k, current_setting('p2a.' || k, true) as got, want,
       current_setting('p2a.' || k, true) = want as pass
  from (values
    ('asleep','P0001'), ('owner_assigns','editor'), ('not_your_mono','42501'),
    ('mate_assigns','42501'), ('mate_removes','{"userIds": ["00000000-0000-4000-8000-0000000002a1"]}'),
    ('mono_assigns_mono','42501'), ('notifications','0/1')
  ) v(k, want);
rollback;
```

Expected: every row `pass = true`.

- [ ] **Step 3: Apply, ledger, types, gates**

Apply with `apply_migration`. Run: `pnpm db:ledger-check` (clean). Regenerate types (expected unchanged). Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_mono_owner_only_assign.sql src/types/database.types.ts
git commit -m "feat(mono): only the owner can assign their mono"
```

(Omit `src/types/database.types.ts` if `git status` shows it unchanged.)

---

### Task 4: MonoAvatar hardening, labels, identity chips, name and colour form

Load the `pulse-ui` and `frontend-design` skills first.

**Files:**

- Modify: `src/components/mono/mono-palette.ts`, `src/components/mono/mono-palette.test.ts`, `src/components/mono/mono-renderer.ts` (add `MONO_MOODS`), `src/components/mono/MonoAvatar.tsx`, `src/components/mono/MonoAvatar.test.tsx`
- Create: `src/lib/monos/labels.ts`, `src/lib/monos/labels.test.ts`, `src/components/mono/MonoChip.tsx`, `src/components/mono/MonoChip.test.tsx`, `src/components/mono/MonoNameColorForm.tsx`, `src/components/mono/MonoNameColorForm.test.tsx`

**Interfaces:**

- Consumes: Plan 1's `monoPalette`, `MONO_PRESET_COLORS`, `drawMono`, `MonoMood`, `MonoAvatar`.
- Produces:
  - `mono-palette.ts`: `export const DEFAULT_MONO_COLOR = "#7395ff"`, `export function isMonoColor(hex: string): boolean`.
  - `mono-renderer.ts`: `export const MONO_MOODS: readonly MonoMood[]` (all 7).
  - `MonoAvatar` never throws: invalid `color` falls back to `DEFAULT_MONO_COLOR`; works without `window.matchMedia` and without `IntersectionObserver`.
  - `src/lib/monos/labels.ts` (client-safe): `ownerPossessive(ownerName: string | null): string`, `monoAccessibleLabel(name: string, ownerName: string | null): string`, `brainLine(brain: "none" | "key" | "connected", keyProvider: string | null): string`.
  - `MonoChip.tsx`: `AgentChip({ className? })`, `MonoIdentity({ name, color, ownerName, size?, showOwner?, className? })`.
  - `MonoNameColorForm({ initialName?, initialColor?, submitLabel, onSubmit: (v: { name: string; color: string }) => Promise<string | null> })` — `onSubmit` resolves to an error message or null.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/mono/mono-palette.test.ts`:

```ts
import { DEFAULT_MONO_COLOR, isMonoColor } from "./mono-palette";

describe("isMonoColor", () => {
  it("accepts #rrggbb in either case and nothing else", () => {
    expect(isMonoColor("#7395ff")).toBe(true);
    expect(isMonoColor("#A77BFF")).toBe(true);
    expect(isMonoColor("blue")).toBe(false);
    expect(isMonoColor("#abc")).toBe(false);
    expect(isMonoColor(DEFAULT_MONO_COLOR)).toBe(true);
  });
});
```

Replace `src/components/mono/MonoAvatar.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonoAvatar } from "./MonoAvatar";
import { monoPalette } from "./mono-palette";
import { MONO_MOODS, drawMono } from "./mono-renderer";

/** A 2D context that accepts every call and property the renderer uses. */
function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const props: Record<string | symbol, unknown> = {};
  return new Proxy(props, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (..._args: unknown[]) =>
        typeof prop === "string" && prop.startsWith("create")
          ? gradient
          : undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MonoAvatar", () => {
  it("is an accessible image carrying its mood", () => {
    render(
      <MonoAvatar
        color="#7395ff"
        mood="thinking"
        size={32}
        label="Nova, Danijel's Mono"
      />,
    );
    const img = screen.getByRole("img", { name: "Nova, Danijel's Mono" });
    expect(img.dataset.mood).toBe("thinking");
    expect(img.style.width).toBe("32px");
  });

  it("defaults to idle and survives a missing canvas context (jsdom)", () => {
    render(<MonoAvatar color="#3fe0a5" size={24} label="Pip" />);
    expect(screen.getByRole("img", { name: "Pip" }).dataset.mood).toBe("idle");
  });

  it("falls back to the default colour instead of throwing on a bad one", () => {
    expect(() =>
      render(<MonoAvatar color="not-a-colour" size={24} label="Odd" />),
    ).not.toThrow();
    expect(screen.getByRole("img", { name: "Odd" })).toBeInTheDocument();
  });

  it("draws and animates without matchMedia or IntersectionObserver", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      fakeContext() as never,
    );
    vi.stubGlobal("matchMedia", undefined);
    vi.stubGlobal("IntersectionObserver", undefined);
    const { unmount } = render(
      <MonoAvatar color="#ff8a4c" mood="hello" size={64} label="Ember" />,
    );
    expect(screen.getByRole("img", { name: "Ember" })).toBeInTheDocument();
    unmount();
  });
});

describe("drawMono", () => {
  it("draws every mood at several moments without throwing", () => {
    const palette = monoPalette("#a77bff");
    expect(MONO_MOODS).toHaveLength(7);
    for (const mood of MONO_MOODS)
      for (const t of [0, 1.3, 3.1])
        for (const blink of [0, 0.08])
          expect(() =>
            drawMono(fakeContext(), 96, 102, mood, t, blink, palette),
          ).not.toThrow();
  });
});
```

`src/lib/monos/labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { brainLine, monoAccessibleLabel, ownerPossessive } from "./labels";

describe("mono labels", () => {
  it("names the owner by first name", () => {
    expect(ownerPossessive("Danijel Jovanovic")).toBe("Danijel's Mono");
    expect(ownerPossessive("  ")).toBe("A teammate's Mono");
    expect(ownerPossessive(null)).toBe("A teammate's Mono");
  });

  it("builds the accessible label", () => {
    expect(monoAccessibleLabel("Nova", "Mira Kovač")).toBe("Nova, Mira's Mono");
  });

  it("says the brain in plain words", () => {
    expect(brainLine("none", null)).toBe("Asleep");
    expect(brainLine("key", "anthropic")).toBe(
      "Runs on your Anthropic key. Chat with it here.",
    );
    expect(brainLine("key", "openai")).toBe(
      "Runs on your OpenAI key. Chat with it here.",
    );
    expect(brainLine("connected", null)).toBe(
      "Connected to your Claude or ChatGPT subscription",
    );
  });
});
```

`src/components/mono/MonoChip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentChip, MonoIdentity } from "./MonoChip";

describe("MonoIdentity", () => {
  it("shows the avatar, name, Agent chip and owner", () => {
    render(<MonoIdentity name="Nova" color="#7395ff" ownerName="Danijel J" />);
    expect(
      screen.getByRole("img", { name: "Nova, Danijel's Mono" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Nova")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Danijel's Mono")).toBeInTheDocument();
  });

  it("can hide the owner line", () => {
    render(
      <MonoIdentity
        name="Nova"
        color="#7395ff"
        ownerName="Danijel"
        showOwner={false}
      />,
    );
    expect(screen.queryByText("Danijel's Mono")).toBeNull();
  });

  it("renders the bare chip", () => {
    render(<AgentChip />);
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });
});
```

`src/components/mono/MonoNameColorForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MonoNameColorForm } from "./MonoNameColorForm";

describe("MonoNameColorForm", () => {
  it("offers seven presets and submits the trimmed name and chosen colour", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => null);
    render(
      <MonoNameColorForm submitLabel="Create my Mono" onSubmit={onSubmit} />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    await user.type(screen.getByLabelText("Name"), "  Nova ");
    await user.click(screen.getByRole("radio", { name: "Mint" }));
    await user.click(screen.getByRole("button", { name: "Create my Mono" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Nova", color: "#3fe0a5" });
  });

  it("keeps submit disabled without a name", () => {
    render(
      <MonoNameColorForm submitLabel="Create my Mono" onSubmit={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Create my Mono" }),
    ).toBeDisabled();
  });

  it("shows the error the submit returns", async () => {
    const user = userEvent.setup();
    render(
      <MonoNameColorForm
        initialName="Nova"
        submitLabel="Save"
        onSubmit={async () => "That did not work."}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That did not work.",
    );
  });
});
```

Run: `pnpm vitest run src/components/mono src/lib/monos/labels.test.ts`. Expected: FAIL (missing exports and modules; the bad-colour and no-IntersectionObserver tests throw).

- [ ] **Step 2: Palette and renderer exports**

In `src/components/mono/mono-palette.ts` add (keep `HEX` and `monoPalette` as they are):

```ts
export const DEFAULT_MONO_COLOR = "#7395ff";

/** True for `#rrggbb` (either case): the only colour shape a Mono stores. */
export function isMonoColor(hex: string): boolean {
  return HEX.test(hex);
}
```

In `src/components/mono/mono-renderer.ts`, after the `MonoMood` type:

```ts
export const MONO_MOODS: readonly MonoMood[] = [
  "idle",
  "hello",
  "listening",
  "thinking",
  "needsyou",
  "done",
  "dozing",
];
```

- [ ] **Step 3: Harden `MonoAvatar`**

In `src/components/mono/MonoAvatar.tsx`:

1. Import `DEFAULT_MONO_COLOR, isMonoColor` from `./mono-palette`.
2. Replace the palette line with:

```tsx
// An invalid colour must never take a page down: render the default Mono.
const palette = useMemo(
  () => monoPalette(isMonoColor(color) ? color : DEFAULT_MONO_COLOR),
  [color],
);
```

3. Replace the `reduced` read with:

```tsx
const reduced =
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
```

4. Replace the observer block with:

```tsx
// Without IntersectionObserver (old WebViews, tests) the avatar simply
// counts as visible.
const io =
  typeof IntersectionObserver === "function"
    ? new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
      })
    : null;
io?.observe(canvas);
```

and in the cleanup use `io?.disconnect();`.

- [ ] **Step 4: Labels**

`src/lib/monos/labels.ts`:

```ts
/** Client-safe wording for Monos. One place, so every surface says the same. */

export function ownerPossessive(ownerName: string | null): string {
  const first = ownerName?.trim().split(/\s+/)[0];
  return first ? `${first}'s Mono` : "A teammate's Mono";
}

export function monoAccessibleLabel(
  name: string,
  ownerName: string | null,
): string {
  return `${name}, ${ownerPossessive(ownerName)}`;
}

/** The brain status line (spec §9). 2A's key brain works only while its
 *  owner chats with it, so the copy promises nothing unattended. */
export function brainLine(
  brain: "none" | "key" | "connected",
  keyProvider: string | null,
): string {
  if (brain === "key")
    return `Runs on your ${keyProvider === "openai" ? "OpenAI" : "Anthropic"} key. Chat with it here.`;
  if (brain === "connected")
    return "Connected to your Claude or ChatGPT subscription";
  return "Asleep";
}
```

- [ ] **Step 5: Chips**

`src/components/mono/MonoChip.tsx`:

```tsx
import { Kicker } from "@/components/ui/kicker";
import { cn } from "@/lib/utils";
import { monoAccessibleLabel, ownerPossessive } from "@/lib/monos/labels";
import { MonoAvatar } from "./MonoAvatar";
import { DEFAULT_MONO_COLOR, isMonoColor } from "./mono-palette";

/** The "Agent" marker every Mono carries (spec §8). */
export function AgentChip({ className }: { className?: string }) {
  return (
    <Kicker
      size="xs"
      className={cn("border-border shrink-0 rounded border px-1", className)}
    >
      Agent
    </Kicker>
  );
}

/**
 * A Mono wherever it is named: face, name tinted by its colour (mixed toward
 * the foreground so pale colours stay readable in light mode), the Agent chip
 * and whose Mono it is.
 */
export function MonoIdentity({
  name,
  color,
  ownerName,
  size = 20,
  showOwner = true,
  className,
}: {
  name: string;
  color: string;
  ownerName: string | null;
  size?: number;
  showOwner?: boolean;
  className?: string;
}) {
  const safe = isMonoColor(color) ? color : DEFAULT_MONO_COLOR;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <MonoAvatar
        color={safe}
        size={size}
        label={monoAccessibleLabel(name, ownerName)}
      />
      <span
        className="truncate font-semibold"
        style={{ color: `color-mix(in oklab, ${safe} 65%, var(--foreground))` }}
      >
        {name}
      </span>
      <AgentChip />
      {showOwner ? (
        <span className="text-muted-foreground truncate text-xs">
          {ownerPossessive(ownerName)}
        </span>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 6: Name and colour form**

`src/components/mono/MonoNameColorForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MonoAvatar } from "./MonoAvatar";
import {
  DEFAULT_MONO_COLOR,
  MONO_PRESET_COLORS,
  isMonoColor,
} from "./mono-palette";

export type MonoNameColor = { name: string; color: string };

/** The first-open picker (rail) and the rename/recolour form (settings). */
export function MonoNameColorForm({
  initialName = "",
  initialColor = DEFAULT_MONO_COLOR,
  submitLabel,
  onSubmit,
}: {
  initialName?: string;
  initialColor?: string;
  submitLabel: string;
  /** Resolves to an error message, or null on success. */
  onSubmit: (value: MonoNameColor) => Promise<string | null>;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(
    isMonoColor(initialColor) ? initialColor.toLowerCase() : DEFAULT_MONO_COLOR,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const trimmed = name.trim();
  const valid =
    trimmed.length >= 1 && trimmed.length <= 40 && isMonoColor(color);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        startTransition(async () => {
          setError(await onSubmit({ name: trimmed, color }));
        });
      }}
    >
      <div className="flex justify-center">
        <MonoAvatar
          color={color}
          mood="hello"
          size={88}
          label={trimmed ? `${trimmed}, your Mono` : "Your Mono"}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mono-name">Name</Label>
        <Input
          id="mono-name"
          value={name}
          maxLength={40}
          autoComplete="off"
          placeholder="Nova"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Colour</legend>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Colour" className="flex gap-2">
            {MONO_PRESET_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={color === c.hex}
                aria-label={c.name}
                onClick={() => setColor(c.hex)}
                className={cn(
                  "focus-visible:ring-ring size-7 rounded-full border-2 transition-transform focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11",
                  color === c.hex
                    ? "border-foreground scale-110"
                    : "border-transparent",
                )}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <input
              type="color"
              aria-label="Custom colour"
              value={color}
              onChange={(e) => setColor(e.target.value.toLowerCase())}
              className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0"
            />
            Custom
          </label>
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={!valid || pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 7: Verify**

Run: `pnpm vitest run src/components/mono src/lib/monos/labels.test.ts`. Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/mono/mono-palette.ts src/components/mono/mono-palette.test.ts src/components/mono/mono-renderer.ts src/components/mono/MonoAvatar.tsx src/components/mono/MonoAvatar.test.tsx src/components/mono/MonoChip.tsx src/components/mono/MonoChip.test.tsx src/components/mono/MonoNameColorForm.tsx src/components/mono/MonoNameColorForm.test.tsx src/lib/monos/labels.ts src/lib/monos/labels.test.ts
git commit -m "feat(mono): harden avatar and add mono identity chip and picker"
```

---

### Task 5: A personal-credential path through the AI gateway

**Files:**

- Modify: `src/lib/ai/gateway.ts` (`resolveAiAdapter`, `runAi` args), `src/lib/ai/gateway.test.ts`

**Interfaces:**

- Consumes: nothing new (`resolveUserAdapterById`, `asTrustedUserId` from `src/lib/ai/credentials.ts`).
- Produces:
  - `resolveAiAdapter(orgId: string, userId: string, provider?: string, opts?: { personal?: boolean }): Promise<ResolvedAi>`. With `personal: true` it resolves `userId`'s own key for `provider ?? "anthropic"` whatever the org's mode, except `off` (throws `AiDisabledError`); returned `mode` is `"per_user"`.
  - `runAi` args gain `credential?: "org" | "personal"` (default `"org"`), forwarded as `{ personal: credential === "personal" }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ai/gateway.test.ts` (inside the file, after the "4-mode matrix" describe; it reuses `settingsRow`, `userKeys`, `ORG_ID`, `USER_ID` and the mocks at the top of the file):

```ts
describe("resolveAiAdapter — personal credential (a Mono's key brain)", () => {
  it("uses the person's own key even when the org is managed", async () => {
    settingsRow("managed");
    userKeys({ anthropic: "sk-mine" });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const r = await resolveAiAdapter(ORG_ID, USER_ID, "anthropic", {
      personal: true,
    });
    expect(r).toMatchObject({
      mode: "per_user",
      provider: "anthropic",
      apiKey: "sk-mine",
    });
    expect(resolveUserAdapterById).toHaveBeenCalledWith(USER_ID, "anthropic");
  });

  it("still refuses when the org turned AI off", async () => {
    settingsRow("off");
    userKeys({ anthropic: "sk-mine" });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(
      resolveAiAdapter(ORG_ID, USER_ID, "anthropic", { personal: true }),
    ).rejects.toMatchObject({ name: "AiDisabledError" });
    expect(resolveUserAdapterById).not.toHaveBeenCalled();
  });

  it("reports a missing personal key as the person's own configuration gap", async () => {
    settingsRow("org_byo", { byo_provider: "anthropic" });
    userKeys({});
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(
      resolveAiAdapter(ORG_ID, USER_ID, "openai", { personal: true }),
    ).rejects.toMatchObject({ name: "PersonalAiKeyMissingError" });
  });
});
```

Run: `pnpm vitest run src/lib/ai/gateway.test.ts`. Expected: FAIL (the managed case returns the platform key or throws `AiNotConfiguredError`).

- [ ] **Step 2: Implement**

In `src/lib/ai/gateway.ts`, change the `resolveAiAdapter` signature and add the branch right after `defaultModelIdFor` is declared, before `switch (settings.mode)`:

```ts
export async function resolveAiAdapter(
  orgId: string,
  userId: string,
  provider?: string,
  opts: { personal?: boolean } = {},
): Promise<ResolvedAi> {
  const svc = createServiceClient();
  const settings = await readOrgAiSettings(svc, orgId);
  const defaultModelIdFor = (resolvedProvider: string) =>
    settings.defaultProvider === resolvedProvider
      ? settings.defaultModelId
      : null;

  // A Mono's key brain (Personal Monos spec §2): the OWNER's own credential,
  // whatever the org's mode, because the person chose to power their Mono
  // themselves. An org that turned AI off still gets none. TRUST: same as the
  // per_user branch below; callers pass the session user's own id.
  if (opts.personal) {
    if (settings.mode === "off") throw new AiDisabledError();
    const wanted = provider ?? "anthropic";
    const { adapter, apiKey, baseUrl } = await resolveUserAdapterById(
      asTrustedUserId(userId),
      wanted,
    );
    return {
      adapter,
      apiKey,
      baseUrl,
      mode: "per_user",
      provider: wanted,
      orgDefaultModelId: defaultModelIdFor(wanted),
    };
  }

  switch (settings.mode) {
```

(The rest of the function is unchanged.) In `runAi`'s `args` type add, after `provider?: string;`:

```ts
    /**
     * Whose key pays. `"org"` (default) follows the org's ai_mode. `"personal"`
     * always spends `userId`'s own stored key for `provider` (a Mono's key
     * brain); `userId` must be the session user's own id.
     */
    credential?: "org" | "personal";
```

and change the resolve call to:

```ts
const resolved = await resolveAiAdapter(
  args.orgId,
  args.userId,
  args.provider,
  { personal: args.credential === "personal" },
);
```

- [ ] **Step 3: Verify**

Run: `pnpm vitest run src/lib/ai/gateway.test.ts`. Expected: PASS. Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/gateway.ts src/lib/ai/gateway.test.ts
git commit -m "feat(ai): let a call spend the caller's own key whatever the org mode"
```

---

### Task 6: The Mono domain module (types, reads, actions, session forget)

**Files:**

- Create: `src/lib/monos/types.ts`, `src/lib/monos/queries.ts`, `src/lib/monos/queries.test.ts`, `src/lib/monos/queries-cached.ts`, `src/lib/monos/actions.ts`, `src/lib/monos/actions.test.ts`, `src/lib/validations/monos.ts`
- Modify: `src/lib/mono/session.ts`, `src/lib/mono/session.test.ts`

**Interfaces:**

- Consumes: Task 1 RPCs (`create_mono`, `get_my_mono`, `update_my_mono`), Task 2 RPCs (`add_my_mono_to_board`, `remove_my_mono_from_board`), `orgMembersTag` (`src/lib/cache/tags.ts`).
- Produces:
  - `src/lib/monos/types.ts` (client-safe):
    ```ts
    export type MonoBrain = "none" | "key" | "connected";
    export type MonoKeyProvider = "anthropic" | "openai";
    export type MyMono = {
      userId: string;
      orgId: string;
      ownerId: string;
      name: string;
      color: string;
      brain: MonoBrain;
      keyProvider: MonoKeyProvider | null;
      lastSeenAt: string | null;
      createdAt: string;
    };
    export type OrgMono = {
      userId: string;
      ownerId: string;
      name: string;
      color: string;
    };
    export type MonoMemberMeta = {
      color: string;
      ownerId: string;
      ownerName: string | null;
      directable: boolean;
    };
    export type MonoBoard = {
      boardId: string;
      name: string;
      accessLevel: "viewer" | "editor";
    };
    export function monoEmail(monoUserId: string): string; // "mono-<id>@monolith.internal"
    export function toBrain(value: string): MonoBrain;
    ```
  - `src/lib/monos/queries.ts` (server-only): `getMyMono(supabase: SupabaseClient<Database>, orgId: string): Promise<MyMono | null>`, `listMonoBoards(supabase: SupabaseClient<Database>, monoUserId: string): Promise<MonoBoard[]>`, `MONO_BOARDS_LIMIT = 100`.
  - `src/lib/monos/queries-cached.ts` (server-only): `listOrgMonosCached(orgId: string): Promise<OrgMono[]>`, `ORG_MONOS_LIMIT = 500`, cached `"nav"` with tag `orgMembersTag(orgId)`.
  - `src/lib/validations/monos.ts`: `monoInputSchema` (`{ name: trimmed 1..40, color: #rrggbb lower-cased }`), `boardIdInputSchema` (`{ boardId: uuid }`).
  - `src/lib/monos/actions.ts` (`"use server"`): `createMyMono(input: { name: string; color: string }): Promise<ActionResult<MyMono>>`, `updateMyMono(input: { name: string; color: string }): Promise<ActionResult<MyMono>>`, `addMyMonoToBoard(input: { boardId: string }): Promise<ActionResult>`, `removeMyMonoFromBoard(input: { boardId: string }): Promise<ActionResult>`.
  - `src/lib/mono/session.ts`: `export function forgetMonoSession(monoUserId: string): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/mono/session.test.ts` (inside the existing `describe("getMonoClient")`; also add `forgetMonoSession` to the import from `./session`):

```ts
it("forgets a Mono so the next call mints again", async () => {
  mint.mockResolvedValue(session("t", 3600));
  await getMonoClient("mono-1");
  forgetMonoSession("mono-1");
  await getMonoClient("mono-1");
  expect(mint).toHaveBeenCalledTimes(2);
});
```

`src/lib/monos/queries.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getMyMono, listMonoBoards, MONO_BOARDS_LIMIT } from "./queries";

describe("getMyMono", () => {
  it("maps the RPC row and narrows brain", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          user_id: "m1",
          org_id: "o1",
          owner_id: "u1",
          name: "Nova",
          color: "#7395ff",
          brain: "key",
          key_provider: "openai",
          last_seen_at: null,
          created_at: "2026-11-13T00:00:00Z",
        },
      ],
      error: null,
    }));
    const mono = await getMyMono({ rpc } as never, "o1");
    expect(rpc).toHaveBeenCalledWith("get_my_mono", { p_org_id: "o1" });
    expect(mono).toEqual({
      userId: "m1",
      orgId: "o1",
      ownerId: "u1",
      name: "Nova",
      color: "#7395ff",
      brain: "key",
      keyProvider: "openai",
      lastSeenAt: null,
      createdAt: "2026-11-13T00:00:00Z",
    });
  });

  it("returns null when the caller has no Mono", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    expect(await getMyMono({ rpc } as never, "o1")).toBeNull();
  });
});

describe("listMonoBoards", () => {
  it("is a bounded read of the Mono's own board rows", async () => {
    const limit = vi.fn(async () => ({
      data: [
        { board_id: "b1", access_level: "editor", boards: { name: "Launch" } },
        { board_id: "b2", access_level: "viewer", boards: null },
      ],
      error: null,
    }));
    const eq = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const boards = await listMonoBoards({ from } as never, "m1");
    expect(from).toHaveBeenCalledWith("board_members");
    expect(eq).toHaveBeenCalledWith("user_id", "m1");
    expect(limit).toHaveBeenCalledWith(MONO_BOARDS_LIMIT);
    expect(boards).toEqual([
      { boardId: "b1", name: "Launch", accessLevel: "editor" },
      { boardId: "b2", name: "Untitled board", accessLevel: "viewer" },
    ]);
  });
});
```

`src/lib/monos/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const BOARD = "33333333-3333-4333-8333-333333333333";
const OTHER_MONO = "44444444-4444-4444-8444-444444444444";

const createUser = vi.fn();
const deleteUser = vi.fn();
const svcRpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: { admin: { createUser, deleteUser } },
    rpc: svcRpc,
  }),
}));
const userRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: userRpc }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: OWNER }),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => ({ id: ORG, name: "Acme", timezone: null }),
}));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
const getMyMono = vi.fn();
vi.mock("./queries", () => ({
  getMyMono: (...a: unknown[]) => getMyMono(...a),
}));

import {
  addMyMonoToBoard,
  createMyMono,
  removeMyMonoFromBoard,
  updateMyMono,
} from "./actions";

const mono = (userId: string) => ({
  userId,
  orgId: ORG,
  ownerId: OWNER,
  name: "Nova",
  color: "#7395ff",
  brain: "none" as const,
  keyProvider: null,
  lastSeenAt: null,
  createdAt: "t",
});

beforeEach(() => {
  vi.clearAllMocks();
  createUser.mockResolvedValue({ data: { user: {} }, error: null });
  deleteUser.mockResolvedValue({ data: {}, error: null });
  userRpc.mockResolvedValue({ data: null, error: null });
});

describe("createMyMono", () => {
  it("rejects bad input before touching anything", async () => {
    const res = await createMyMono({ name: " ", color: "blue" });
    expect(res.ok).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("returns the existing Mono without creating a bot", async () => {
    getMyMono.mockResolvedValueOnce(mono("m-existing"));
    const res = await createMyMono({ name: "Nova", color: "#7395FF" });
    expect(res).toEqual({ ok: true, data: mono("m-existing") });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("creates a confirmed, pre-approved bot, then the Mono, then refreshes the roster", async () => {
    getMyMono.mockResolvedValueOnce(null);
    svcRpc.mockImplementation(
      async (_fn: string, args: { p_mono_id: string }) => ({
        data: args.p_mono_id,
        error: null,
      }),
    );
    getMyMono.mockImplementationOnce(async () =>
      mono(svcRpc.mock.calls[0]![1].p_mono_id),
    );
    const res = await createMyMono({ name: " Nova ", color: "#7395FF" });

    const attrs = createUser.mock.calls[0]![0] as {
      id: string;
      email: string;
      email_confirm: boolean;
      app_metadata: Record<string, unknown>;
    };
    expect(attrs.email).toBe(`mono-${attrs.id}@monolith.internal`);
    expect(attrs.email_confirm).toBe(true);
    expect(attrs.app_metadata).toMatchObject({ pre_approved: true });
    expect(svcRpc).toHaveBeenCalledWith("create_mono", {
      p_org_id: ORG,
      p_owner_id: OWNER,
      p_mono_id: attrs.id,
      p_name: "Nova",
      p_color: "#7395ff",
    });
    expect(updateTag).toHaveBeenCalledWith(`org-members:org:${ORG}`);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it("deletes its unused bot when another tab won the race", async () => {
    getMyMono.mockResolvedValueOnce(null);
    svcRpc.mockResolvedValue({ data: OTHER_MONO, error: null });
    getMyMono.mockResolvedValueOnce(mono(OTHER_MONO));
    const res = await createMyMono({ name: "Nova", color: "#7395ff" });
    const createdId = (createUser.mock.calls[0]![0] as { id: string }).id;
    expect(deleteUser).toHaveBeenCalledWith(createdId);
    expect(res).toEqual({ ok: true, data: mono(OTHER_MONO) });
  });

  it("deletes its bot and fails when the RPC refuses", async () => {
    getMyMono.mockResolvedValueOnce(null);
    svcRpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    const res = await createMyMono({ name: "Nova", color: "#7395ff" });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
  });
});

describe("updateMyMono", () => {
  it("renames through the owner-scoped RPC and refreshes the roster", async () => {
    getMyMono.mockResolvedValueOnce(mono("m1"));
    const res = await updateMyMono({ name: "Nova Two", color: "#A77BFF" });
    expect(userRpc).toHaveBeenCalledWith("update_my_mono", {
      p_org_id: ORG,
      p_name: "Nova Two",
      p_color: "#a77bff",
    });
    expect(updateTag).toHaveBeenCalledWith(`org-members:org:${ORG}`);
    expect(res.ok).toBe(true);
  });
});

describe("board membership", () => {
  it("adds and removes through the owner-scoped RPCs", async () => {
    expect(await addMyMonoToBoard({ boardId: BOARD })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(userRpc).toHaveBeenCalledWith("add_my_mono_to_board", {
      p_board_id: BOARD,
    });
    await removeMyMonoFromBoard({ boardId: BOARD });
    expect(userRpc).toHaveBeenCalledWith("remove_my_mono_from_board", {
      p_board_id: BOARD,
    });
  });

  it("says why an add was refused", async () => {
    userRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "42501",
        message: "the Mono's owner cannot open this board",
      },
    });
    const res = await addMyMonoToBoard({ boardId: BOARD });
    expect(res).toEqual({
      ok: false,
      error: "You can only add your Mono to boards you can open.",
    });
  });
});
```

Run: `pnpm vitest run src/lib/monos src/lib/mono/session.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 2: Types and validation**

`src/lib/monos/types.ts`:

```ts
/** Client-safe shapes for personal Monos (no server-only imports). */

export type MonoBrain = "none" | "key" | "connected";
export type MonoKeyProvider = "anthropic" | "openai";

/** The caller's own Mono, brain included (owner-only read). */
export type MyMono = {
  userId: string;
  orgId: string;
  ownerId: string;
  name: string;
  color: string;
  brain: MonoBrain;
  keyProvider: MonoKeyProvider | null;
  lastSeenAt: string | null;
  createdAt: string;
};

/** Any Mono in the org, as every member may see it (no brain). */
export type OrgMono = {
  userId: string;
  ownerId: string;
  name: string;
  color: string;
};

/** What a member row carries when it is a Mono (cells, pickers, authorship). */
export type MonoMemberMeta = {
  color: string;
  ownerId: string;
  ownerName: string | null;
  /** The viewer's own awake Mono: the only Mono they may assign or mention. */
  directable: boolean;
};

export type MonoBoard = {
  boardId: string;
  name: string;
  accessLevel: "viewer" | "editor";
};

/** The internal address the magic-link mint needs (ADR decision-44). */
export function monoEmail(monoUserId: string): string {
  return `mono-${monoUserId}@monolith.internal`;
}

export function toBrain(value: string): MonoBrain {
  return value === "key" || value === "connected" ? value : "none";
}
```

`src/lib/validations/monos.ts`:

```ts
import * as z from "zod";

export const monoInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give your Mono a name.")
    .max(40, "Keep the name under 40 characters."),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour.")
    .transform((c) => c.toLowerCase()),
});
export type MonoInput = z.infer<typeof monoInputSchema>;

export const boardIdInputSchema = z.object({ boardId: z.string().uuid() });
```

- [ ] **Step 3: Reads**

`src/lib/monos/queries.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { toBrain, type MonoBoard, type MyMono } from "./types";

type Client = SupabaseClient<Database>;

/** The caller's own Mono in `orgId`, or null. One point read on
 *  `monos_one_per_owner (org_id, owner_id)` through the owner-only RPC (the
 *  only path that returns `brain`). */
export async function getMyMono(
  supabase: Client,
  orgId: string,
): Promise<MyMono | null> {
  const { data, error } = await supabase.rpc("get_my_mono", {
    p_org_id: orgId,
  });
  if (error) throw new Error(`getMyMono: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    orgId: row.org_id,
    ownerId: row.owner_id,
    name: row.name,
    color: row.color,
    brain: toBrain(row.brain),
    keyProvider:
      row.key_provider === "anthropic" || row.key_provider === "openai"
        ? row.key_provider
        : null,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

export const MONO_BOARDS_LIMIT = 100;

/** Boards the Mono is on. RLS-scoped through the owner's client: a Mono is
 *  only ever on boards its owner can open. `board_members_user_id_idx`. */
export async function listMonoBoards(
  supabase: Client,
  monoUserId: string,
): Promise<MonoBoard[]> {
  const { data, error } = await supabase
    .from("board_members")
    .select("board_id, access_level, boards(name)")
    .eq("user_id", monoUserId)
    .limit(MONO_BOARDS_LIMIT);
  if (error) throw new Error(`listMonoBoards: ${error.message}`);
  return (data ?? []).map((r) => ({
    boardId: r.board_id,
    name: r.boards?.name ?? "Untitled board",
    accessLevel: r.access_level,
  }));
}
```

`src/lib/monos/queries-cached.ts`:

```ts
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { orgMembersTag } from "@/lib/cache/tags";
import type { OrgMono } from "./types";

/** Hot-path cap, same as ORG_MEMBERS_LIMIT. Index: monos_one_per_owner. */
export const ORG_MONOS_LIMIT = 500;

/**
 * Every Mono in the org (name, colour, owner; never brain). Cached under the
 * SAME tag as the member roster, so every roster invalidation (member removed,
 * deactivated, Mono created or renamed) refreshes both. CALLER CONTRACT as
 * `listOrgMembersCached`: pass an org the caller may read; the explicit
 * `org_id` filter is the tenant boundary (service client).
 */
export async function listOrgMonosCached(orgId: string): Promise<OrgMono[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(orgMembersTag(orgId));

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("monos")
    .select("user_id, owner_id, name, color")
    .eq("org_id", orgId)
    .limit(ORG_MONOS_LIMIT);
  if (error || !data) return [];
  return data.map((m) => ({
    userId: m.user_id,
    ownerId: m.owner_id,
    name: m.name,
    color: m.color,
  }));
}
```

- [ ] **Step 4: Server Actions**

`src/lib/monos/actions.ts`:

```ts
"use server";

import { randomUUID } from "node:crypto";
import { updateTag } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { orgMembersTag } from "@/lib/cache/tags";
import { fail, type ActionResult } from "@/lib/actions/result";
import { boardIdInputSchema, monoInputSchema } from "@/lib/validations/monos";
import { getMyMono } from "./queries";
import { monoEmail, type MyMono } from "./types";

const CREATE_FAILED = "Couldn't create your Mono. Please try again.";

/**
 * Create the caller's Mono in the active org, idempotently.
 *
 * Order matters (Plan 2A decision D1): the bot is created with the GoTrue
 * admin API first (confirmed, pre-approved, internal email), then the
 * service-role-only `create_mono` RPC adds the Mono row, flags the profile and
 * adds the `agent` membership. The owner id is the SESSION user's, never
 * input. A bot left unused (a lost race, a refused RPC) is deleted.
 * `requireUser()` stays outside the try: its redirect is a thrown sentinel.
 */
export async function createMyMono(input: {
  name: string;
  color: string;
}): Promise<ActionResult<MyMono>> {
  const parsed = monoInputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid Mono.");
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");

  try {
    const supabase = await createClient();
    const existing = await getMyMono(supabase, org.id);
    if (existing) return { ok: true, data: existing };

    const svc = createServiceClient();
    const monoId = randomUUID();
    const { error: createErr } = await svc.auth.admin.createUser({
      id: monoId,
      email: monoEmail(monoId),
      email_confirm: true,
      app_metadata: { pre_approved: true, mono: true },
      user_metadata: { full_name: parsed.data.name },
    });
    if (createErr) {
      console.error("[mono] bot user create failed", createErr.message);
      return fail(CREATE_FAILED);
    }

    const { data: winner, error: rpcErr } = await svc.rpc("create_mono", {
      p_org_id: org.id,
      p_owner_id: user.id,
      p_mono_id: monoId,
      p_name: parsed.data.name,
      p_color: parsed.data.color,
    });
    if (rpcErr || winner !== monoId) {
      await svc.auth.admin.deleteUser(monoId);
      if (rpcErr) {
        console.error("[mono] create_mono refused", rpcErr.message);
        return fail(CREATE_FAILED);
      }
    }

    updateTag(orgMembersTag(org.id));
    const mono = await getMyMono(supabase, org.id);
    return mono ? { ok: true, data: mono } : fail(CREATE_FAILED);
  } catch (e) {
    console.error("[mono] createMyMono failed", e);
    return fail(CREATE_FAILED);
  }
}

/** Rename and recolour the caller's Mono (owner-scoped RPC). */
export async function updateMyMono(input: {
  name: string;
  color: string;
}): Promise<ActionResult<MyMono>> {
  const parsed = monoInputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid Mono.");
  await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_my_mono", {
      p_org_id: org.id,
      p_name: parsed.data.name,
      p_color: parsed.data.color,
    });
    if (error) return fail("Couldn't save your Mono.");
    updateTag(orgMembersTag(org.id));
    const mono = await getMyMono(supabase, org.id);
    return mono ? { ok: true, data: mono } : fail("Couldn't save your Mono.");
  } catch (e) {
    console.error("[mono] updateMyMono failed", e);
    return fail("Couldn't save your Mono.");
  }
}

function boardRefusal(code: string | undefined): string {
  return code === "42501"
    ? "You can only add your Mono to boards you can open."
    : code === "P0002"
      ? "That board or your Mono could not be found."
      : "Couldn't change your Mono's boards. Please try again.";
}

/** Put the caller's Mono on a board the caller can open (owner's level). */
export async function addMyMonoToBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = boardIdInputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid board.");
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_my_mono_to_board", {
    p_board_id: parsed.data.boardId,
  });
  if (error) return fail(boardRefusal(error.code));
  return { ok: true, data: undefined };
}

/** Take the caller's Mono off a board. */
export async function removeMyMonoFromBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = boardIdInputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid board.");
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_my_mono_from_board", {
    p_board_id: parsed.data.boardId,
  });
  if (error) return fail(boardRefusal(error.code));
  return { ok: true, data: undefined };
}
```

If `svc.rpc("create_mono", …)` does not typecheck through the service client's generated types, call it through `typedRpc(svc, "create_mono", { … })` from `src/lib/supabase/typed-rpc.ts` and update the test's `svcRpc` expectation accordingly (it receives the same two arguments).

- [ ] **Step 5: Session forget**

In `src/lib/mono/session.ts`, after `getMonoClient`:

```ts
/**
 * Drop a Mono's cached token, for a Mono that was removed or no longer
 * belongs to the caller. A stale token is already powerless (removal deletes
 * the Mono's memberships in the same transaction), so this only stops a warm
 * instance from holding on to it.
 */
export function forgetMonoSession(monoUserId: string): void {
  cache.delete(monoUserId);
  inflight.delete(monoUserId);
}
```

- [ ] **Step 6: Verify**

Run: `pnpm vitest run src/lib/monos src/lib/mono/session.test.ts`. Expected: PASS. Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/monos/types.ts src/lib/monos/queries.ts src/lib/monos/queries.test.ts src/lib/monos/queries-cached.ts src/lib/monos/actions.ts src/lib/monos/actions.test.ts src/lib/validations/monos.ts src/lib/mono/session.ts src/lib/mono/session.test.ts
git commit -m "feat(mono): mono domain module with create, rename and board actions"
```

---

### Task 7: Monos are not people (rosters, share and automation pickers) and dock copy

**Files:**

- Create: `src/lib/monos/people.ts`, `src/lib/monos/people.test.ts`
- Modify: `src/lib/org/queries-cached.ts` (+ `queries-cached.test.ts`), `src/lib/mcp/org-scope.ts` (and the client doubles of `src/lib/mcp/tools/{get-portfolio,get-workload,list-goals,get-goal}.test.ts` if they lack `neq`), `src/lib/platform/queries.ts`, `src/components/boards/BoardHeader.tsx`, `src/components/landing/editorial-landing.tsx` (+ test), `src/components/landing/product-gallery.tsx`, `src/components/landing/assembly-landing.tsx`, `src/components/app-shell.tsx` (comment), `src/app/globals.motion.test.ts` (describe title)

**Interfaces:**

- Consumes: Task 1 (`org_role` includes `"agent"` in the generated types).
- Produces:
  - `peopleOnly<T extends { mono?: unknown }>(members: readonly T[]): T[]` in `src/lib/monos/people.ts`.
  - `listOrgMembersCached`, `listOrgMemberProfiles` and the platform org `member_count` never include `role = 'agent'`.
  - `ShareBoardDialog` and `AutomationsDialog` receive people only.
  - No user-facing "agent dock" string in `src/components` or `src/app` (the generated changelog keeps its historical wording).

- [ ] **Step 1: Write the failing tests**

`src/lib/monos/people.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { peopleOnly } from "./people";

describe("peopleOnly", () => {
  it("drops Mono rows and keeps people in order", () => {
    const rows = [
      { userId: "u1" },
      { userId: "m1", mono: { color: "#7395ff" } },
      { userId: "u2", mono: undefined },
    ];
    expect(peopleOnly(rows).map((r) => r.userId)).toEqual(["u1", "u2"]);
  });
});
```

In `src/lib/org/queries-cached.test.ts`, replace the chain doubles at the top with:

```ts
const memberLimit = vi.fn();
const memberNeq = vi.fn(() => ({ limit: memberLimit }));
const memberEq = vi.fn(() => ({ neq: memberNeq }));
const memberSelect = vi.fn(() => ({ eq: memberEq }));
```

add `memberNeq.mockClear();` to `beforeEach`, and add:

```ts
it("lists people only: a Mono (role agent) is never a member row", async () => {
  memberLimit.mockResolvedValue({ data: [], error: null });
  await listOrgMembersCached("org-A");
  expect(memberNeq).toHaveBeenCalledWith("role", "agent");
});
```

In `src/components/landing/editorial-landing.test.tsx` change the tab query to `{ name: /assistant panel/i }`.

Run: `pnpm vitest run src/lib/monos/people.test.ts src/lib/org/queries-cached.test.ts src/components/landing/editorial-landing.test.tsx`. Expected: FAIL.

- [ ] **Step 2: Implement the filters**

`src/lib/monos/people.ts`:

```ts
/** People-only view of a roster that may carry Monos (`mono` set). Share
 *  dialogs, automation targets and anything that means "a person" use this. */
export function peopleOnly<T extends { mono?: unknown }>(
  members: readonly T[],
): T[] {
  return members.filter((m) => !m.mono);
}
```

`src/lib/org/queries-cached.ts`: in `listOrgMembersCached`, change the member read to

```ts
const { data: members, error: membersErr } = await supabase
  .from("org_members")
  .select("user_id")
  .eq("org_id", orgId)
  // A Mono is an org member with role `agent`, never a person in a roster.
  .neq("role", "agent")
  .limit(ORG_MEMBERS_LIMIT);
```

`src/lib/mcp/org-scope.ts`: in `listOrgMemberProfiles`, add `.neq("role", "agent")` after `.is("deactivated_at", null)`. If any of `get-portfolio.test.ts`, `get-workload.test.ts`, `list-goals.test.ts`, `get-goal.test.ts` now fails because its client double has no `neq`, add `neq: () => <the same object .is returns>` to that double (one line each), and nothing else.

`src/lib/platform/queries.ts`: on both queries that select `org_members(count)`, add `.neq("org_members.role", "agent")` right after the `.select(…)` call, so the platform admin's member count counts people.

`src/components/boards/BoardHeader.tsx`: import `peopleOnly` from `@/lib/monos/people` and pass `members={peopleOnly(members)}` to `<AutomationsDialog>` (around line 344) and `<ShareBoardDialog>` (around line 369). Leave line 276 unchanged.

- [ ] **Step 3: Copy**

| File                                               | Old                                                                                               | New                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/components/landing/editorial-landing.tsx:404` | `alt="Monolith agent dock beside a board, with workspace questions and a prompt field"`           | `alt="Monolith assistant panel beside a board, with workspace questions and a prompt field"`           |
| `src/components/landing/editorial-landing.tsx:413` | `The agent dock sits beside the board.`                                                           | `The assistant panel sits beside the board.`                                                           |
| `src/components/landing/product-gallery.tsx:40`    | `tab: "Agent dock",`                                                                              | `tab: "Assistant panel",`                                                                              |
| `src/components/landing/product-gallery.tsx:43`    | `"Open the agent dock without leaving your board. Ask questions with your workspace as context."` | `"Open the assistant panel without leaving your board. Ask questions with your workspace as context."` |
| `src/components/landing/assembly-landing.tsx:240`  | `alt="Monolith agent dock alongside the board"`                                                   | `alt="Monolith assistant panel alongside the board"`                                                   |
| `src/components/app-shell.tsx:72` (comment)        | `The board page's agent dock portals`                                                             | `The board page's dock portals`                                                                        |
| `src/app/globals.motion.test.ts:12`                | `describe("presence pulse (agent dock)", () => {`                                                 | `describe("presence pulse (board dock)", () => {`                                                      |

Leave the `id: "agent-dock"` key, asset file names and `src/lib/changelog/generated.ts` unchanged (internal ids and historical release notes).

- [ ] **Step 4: Verify**

Run: `grep -rni "agent dock" src --include=*.ts --include=*.tsx | grep -v "src/lib/changelog/generated.ts"`. Expected: no output.

Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass.

- [ ] **Step 5: Commit**

Stage the files listed under **Files** that `git status` shows as changed, then:

```bash
git commit -m "fix(mono): keep monos out of people rosters and retire agent dock copy"
```

---

### Task 8: Monos in People cells, pickers, mentions and authorship

Load the `pulse-ui` and `frontend-design` skills first.

**Files:**

- Create: `src/lib/monos/members.ts`, `src/lib/monos/members.test.ts`, `src/lib/monos/board-roster.ts`, `src/lib/monos/board-roster.test.ts`
- Modify: `src/app/(app)/boards/[boardId]/page.tsx`, `src/components/boards/BoardViews.tsx` (`panelMembers`), `src/components/boards/cells/editors/types.ts`, `src/components/boards/cells/member-avatar.tsx`, `src/components/boards/cells/index.tsx` (`PeopleCell`), `src/components/boards/cells/editors/PeopleEditor.tsx` (+ test), `src/components/boards/BoardBulkBar.tsx` (`PeopleAssignList`), `src/components/boards/item-panel/ItemPanel.tsx` (members type), `src/components/boards/item-panel/UpdatesTab.tsx` (+ test), `src/components/boards/item-panel/MentionTextarea.tsx` (+ test), `src/lib/collaboration/mentions.ts` (+ test), `src/lib/validations/collaboration-actions.ts`, `src/lib/collaboration/actions.ts` (+ test)

**Interfaces:**

- Consumes: Task 4 (`MonoAvatar`, `AgentChip`, `MonoIdentity`, `monoAccessibleLabel`), Task 6 (`MyMono`, `OrgMono`, `MonoMemberMeta`, `getMyMono`, `listOrgMonosCached`), Task 7 (`peopleOnly`, people-only `listOrgMembersCached`).
- Produces:
  - `src/lib/monos/members.ts` (client-safe): `type PersonRow = { userId: string; fullName: string | null; email: string | null; avatarUrl: string | null }`, `type RosterMember = PersonRow & { mono?: MonoMemberMeta }`, `withMonoMembers(people: readonly PersonRow[], monos: readonly OrgMono[], myMono: MyMono | null): RosterMember[]`, `assignableMembers<T extends { mono?: MonoMemberMeta }>(members: readonly T[]): T[]`.
  - `src/lib/monos/board-roster.ts` (server-only): `type BoardRoster = { orgId: string; members: OrgMember[]; monos: OrgMono[]; myMono: MyMono | null }`, `loadBoardRoster(supabase: SupabaseClient<Database>, orgId: string): Promise<BoardRoster>`.
  - `EditorMember` gains `mono?: MonoMemberMeta`; `MemberAvatar` gains `mono?: MonoMemberMeta`.
  - `MentionTarget = UserMentionTarget | MonoMentionTarget` where `MonoMentionTarget = { kind: "mono"; userId: string; name: string; ownerName: string | null; color: string }`; `mentionTargetSchema` accepts `{ kind: "mono", userId }`; `keepOwnMonoMentions(mentions: MentionTargetInput[], ownMonoIds: readonly string[]): MentionTargetInput[]` in `src/lib/collaboration/mentions.ts`.
  - The board page computes `roster` (with `myMono`) and filters Mono rows out of `grants`; Task 10 reads `roster.myMono` and `grantRows` there.

- [ ] **Step 1: Write the failing tests**

`src/lib/monos/members.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assignableMembers, withMonoMembers } from "./members";
import type { MyMono, OrgMono } from "./types";

const people = [
  { userId: "u1", fullName: "Ada Owner", email: "a@x.io", avatarUrl: null },
  { userId: "u2", fullName: "Ben Mate", email: "b@x.io", avatarUrl: null },
];
const monos: OrgMono[] = [
  { userId: "m1", ownerId: "u1", name: "Nova", color: "#7395ff" },
  { userId: "m2", ownerId: "u2", name: "Pip", color: "#3fe0a5" },
];
const mine = (brain: MyMono["brain"]): MyMono => ({
  userId: "m1",
  orgId: "o1",
  ownerId: "u1",
  name: "Nova",
  color: "#7395ff",
  brain,
  keyProvider: brain === "key" ? "anthropic" : null,
  lastSeenAt: null,
  createdAt: "t",
});

describe("withMonoMembers", () => {
  it("appends Monos after the people, named and owned", () => {
    const rows = withMonoMembers(people, monos, mine("key"));
    expect(rows.map((r) => r.userId)).toEqual(["u1", "u2", "m1", "m2"]);
    expect(rows[2]).toEqual({
      userId: "m1",
      fullName: "Nova",
      email: null,
      avatarUrl: null,
      mono: {
        color: "#7395ff",
        ownerId: "u1",
        ownerName: "Ada Owner",
        directable: true,
      },
    });
    expect(rows[3]!.mono!.directable).toBe(false);
  });

  it("makes no Mono directable when the viewer's own Mono is asleep", () => {
    const rows = withMonoMembers(people, monos, mine("none"));
    expect(rows.filter((r) => r.mono?.directable)).toEqual([]);
  });
});

describe("assignableMembers", () => {
  it("keeps people and the viewer's own awake Mono only", () => {
    const rows = withMonoMembers(people, monos, mine("key"));
    expect(assignableMembers(rows).map((r) => r.userId)).toEqual([
      "u1",
      "u2",
      "m1",
    ]);
  });
});
```

`src/lib/monos/board-roster.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const listOrgMembersCached = vi.fn(async () => [
  { userId: "u1", fullName: "Ada", email: null, avatarUrl: null },
]);
const listOrgMonosCached = vi.fn(async () => [
  { userId: "m1", ownerId: "u1", name: "Nova", color: "#7395ff" },
]);
const getMyMono = vi.fn();
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: (id: string) => listOrgMembersCached(id),
}));
vi.mock("./queries-cached", () => ({
  listOrgMonosCached: (id: string) => listOrgMonosCached(id),
}));
vi.mock("./queries", () => ({
  getMyMono: (...a: unknown[]) => getMyMono(...a),
}));

import { loadBoardRoster } from "./board-roster";

describe("loadBoardRoster", () => {
  it("reads people, Monos and the viewer's own Mono for one org", async () => {
    getMyMono.mockResolvedValueOnce(null);
    const roster = await loadBoardRoster({} as never, "o1");
    expect(listOrgMembersCached).toHaveBeenCalledWith("o1");
    expect(listOrgMonosCached).toHaveBeenCalledWith("o1");
    expect(roster.orgId).toBe("o1");
    expect(roster.monos).toHaveLength(1);
    expect(roster.myMono).toBeNull();
  });

  it("never fails the page when the viewer's Mono read fails", async () => {
    getMyMono.mockRejectedValueOnce(new Error("rpc down"));
    const roster = await loadBoardRoster({} as never, "o1");
    expect(roster.myMono).toBeNull();
  });
});
```

Append to `src/lib/collaboration/mentions.test.ts`:

```ts
import { keepOwnMonoMentions } from "./mentions";

it("labels a Mono mention with the Mono's name", () => {
  expect(
    mentionLabel({
      kind: "mono",
      userId: "m1",
      name: "Nova",
      ownerName: "Ada",
      color: "#7395ff",
    }),
  ).toBe("@Nova");
});

it("keeps only Mono mentions of the author's own Mono", () => {
  expect(
    keepOwnMonoMentions(
      [
        { kind: "user", userId: "u2" },
        { kind: "mono", userId: "m1" },
        { kind: "mono", userId: "m2" },
      ],
      ["m1"],
    ),
  ).toEqual([
    { kind: "user", userId: "u2" },
    { kind: "mono", userId: "m1" },
  ]);
});
```

Append to `src/lib/collaboration/actions.test.ts` inside `describe("addUpdate")` (it uses the file's `from` mock and constants `ITEM`, `UPD`, `USER`):

```ts
it("drops a mention of someone else's Mono and notifies no Mono", async () => {
  const MONO_MINE = "33333333-3333-4333-8333-333333333333";
  const MONO_THEIRS = "44444444-4444-4444-8444-444444444444";
  const updInsert = vi.fn().mockReturnValue({
    select: () => ({
      single: async () => ({ data: { id: UPD }, error: null }),
    }),
  });
  const notifInsert = vi.fn(async () => ({ error: null }));
  from.mockImplementation((table: string) => {
    if (table === "items")
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { org_id: "org", board_id: "board" },
              error: null,
            }),
          }),
        }),
      } as never;
    if (table === "monos")
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: [{ user_id: MONO_MINE }], error: null }),
          }),
        }),
      } as never;
    if (table === "item_updates") return { insert: updInsert } as never;
    if (table === "notifications") return { insert: notifInsert } as never;
    return {} as never;
  });
  await addUpdate({
    itemId: ITEM,
    text: "@Nova @Pip",
    mentions: [
      { kind: "mono", userId: MONO_MINE },
      { kind: "mono", userId: MONO_THEIRS },
    ],
  });
  expect(updInsert).toHaveBeenCalledWith(
    expect.objectContaining({
      body: {
        text: "@Nova @Pip",
        mentions: [{ kind: "mono", userId: MONO_MINE }],
      },
    }),
  );
  expect(notifInsert).not.toHaveBeenCalled();
});
```

In `src/components/boards/cells/editors/PeopleEditor.test.tsx` (create it if absent) add:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PeopleEditor } from "./PeopleEditor";

const members = [
  { userId: "u1", fullName: "Ada Owner", email: null, avatarUrl: null },
  {
    userId: "m1",
    fullName: "Nova",
    email: null,
    avatarUrl: null,
    mono: {
      color: "#7395ff",
      ownerId: "u1",
      ownerName: "Ada Owner",
      directable: true,
    },
  },
  {
    userId: "m2",
    fullName: "Pip",
    email: null,
    avatarUrl: null,
    mono: {
      color: "#3fe0a5",
      ownerId: "u2",
      ownerName: "Ben Mate",
      directable: false,
    },
  },
];

describe("PeopleEditor with Monos", () => {
  it("offers the viewer's own Mono and never someone else's", () => {
    render(
      <PeopleEditor
        value={null}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        members={members}
      />,
    );
    expect(screen.getByRole("option", { name: /Nova/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Pip/ })).toBeNull();
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("still shows another person's Mono when it is already assigned", () => {
    render(
      <PeopleEditor
        value={{ userIds: ["m2"] }}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        members={members}
      />,
    );
    expect(
      screen.getByRole("option", { name: "Unassign Pip" }),
    ).toBeInTheDocument();
  });
});
```

In `src/components/boards/item-panel/UpdatesTab.test.tsx` add a test that renders `UpdatesTab` (same wrapper the file already uses, `TimeZoneProvider`) with `members` containing a Mono row `{ userId: "m1", fullName: "Nova", mono: { color: "#7395ff", ownerId: "u1", ownerName: "Ada Owner", directable: true } }` and a cache whose single update has `author_id: "m1"`, then asserts:

```tsx
expect(screen.getByText("Agent")).toBeInTheDocument();
expect(screen.getByText("Ada's Mono")).toBeInTheDocument();
expect(
  screen.getByRole("img", { name: "Nova, Ada's Mono" }),
).toBeInTheDocument();
```

Build the update row by copying the shape the file's existing cache fixture uses and changing only `author_id`.

Run: `pnpm vitest run src/lib/monos src/lib/collaboration src/components/boards/cells src/components/boards/item-panel`. Expected: FAIL.

- [ ] **Step 2: Roster helpers**

`src/lib/monos/members.ts`:

```ts
import type { MonoMemberMeta, MyMono, OrgMono } from "./types";

export type PersonRow = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};
export type RosterMember = PersonRow & { mono?: MonoMemberMeta };

/**
 * The board's member payload with the org's Monos appended, so People cells,
 * pickers and update authors resolve a Mono id with no extra read. Only the
 * viewer's own awake Mono is `directable` (Personal Monos spec §4).
 */
export function withMonoMembers(
  people: readonly PersonRow[],
  monos: readonly OrgMono[],
  myMono: MyMono | null,
): RosterMember[] {
  const nameOf = new Map(people.map((p) => [p.userId, p.fullName]));
  return [
    ...people,
    ...monos.map((m) => ({
      userId: m.userId,
      fullName: m.name,
      email: null,
      avatarUrl: null,
      mono: {
        color: m.color,
        ownerId: m.ownerId,
        ownerName: nameOf.get(m.ownerId) ?? null,
        directable:
          myMono !== null &&
          myMono.userId === m.userId &&
          myMono.brain !== "none",
      },
    })),
  ];
}

/** Who a picker may ADD: people, plus the viewer's own awake Mono. */
export function assignableMembers<T extends { mono?: MonoMemberMeta }>(
  members: readonly T[],
): T[] {
  return members.filter((m) => !m.mono || m.mono.directable);
}
```

`src/lib/monos/board-roster.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { OrgMember } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { listOrgMonosCached } from "./queries-cached";
import { getMyMono } from "./queries";
import type { MyMono, OrgMono } from "./types";

export type BoardRoster = {
  orgId: string;
  members: OrgMember[];
  monos: OrgMono[];
  myMono: MyMono | null;
};

/** People (cached), Monos (cached, same tag) and the viewer's own Mono (one
 *  point read), in parallel. A failed Mono read costs the viewer their own
 *  Mono on this page, never the page. */
export async function loadBoardRoster(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<BoardRoster> {
  const [members, monos, myMono] = await Promise.all([
    listOrgMembersCached(orgId),
    listOrgMonosCached(orgId),
    getMyMono(supabase, orgId).catch(() => null),
  ]);
  return { orgId, members, monos, myMono };
}
```

- [ ] **Step 3: Board page wiring**

In `src/app/(app)/boards/[boardId]/page.tsx`:

1. Imports: remove `listOrgMembersCached`; add `import { loadBoardRoster } from "@/lib/monos/board-roster";` and `import { withMonoMembers } from "@/lib/monos/members";`.
2. In the `Promise.all`, rename the last destructured name `activeOrgMembers` to `activeRoster` and replace its promise with:

```ts
    resolveActiveOrg()
      .then((org) => (org ? loadBoardRoster(supabase, org.id) : null))
      .catch(() => null),
```

3. Replace the `const members = …` block and the `grants` mapping with:

```ts
const roster =
  activeRoster?.orgId === payload.board.org_id
    ? activeRoster
    : await loadBoardRoster(supabase, payload.board.org_id);
const members = roster.members;
// People plus the org's Monos, so cells, pickers and authors resolve a Mono
// id from the payload already in hand.
const boardMembers = withMonoMembers(members, roster.monos, roster.myMono);
const monoIds = new Set(roster.monos.map((m) => m.userId));

// A Mono's board row is its owner's business (Plan 2A D14): the share
// dialog lists people.
const grants = (grantRows ?? [])
  .filter((g) => !monoIds.has(g.user_id))
  .map((g) => ({ userId: g.user_id, access: g.access_level }));
```

4. Pass `members={boardMembers}` to `<BoardViews>`. Keep `ruleMeta.memberIds: members.map((m) => m.userId)` (people only).

- [ ] **Step 4: Types, avatar, cell, editor, bulk bar**

`src/components/boards/cells/editors/types.ts`: add `import type { MonoMemberMeta } from "@/lib/monos/types";` and the field `mono?: MonoMemberMeta;` to `EditorMember` with the comment `/** Set when this row is a Mono (Personal Monos). */`.

`src/components/boards/cells/member-avatar.tsx`: add imports `import { MonoAvatar } from "@/components/mono/MonoAvatar";`, `import { monoAccessibleLabel } from "@/lib/monos/labels";`, `import type { MonoMemberMeta } from "@/lib/monos/types";`, add the optional prop `mono?: MonoMemberMeta` and, as the first statement of `MemberAvatar`:

```tsx
// A Mono keeps its pebble body everywhere; people keep round avatars.
if (mono)
  return (
    <MonoAvatar
      color={mono.color}
      size={AVATAR_PX}
      label={monoAccessibleLabel(name, mono.ownerName)}
      className={cn("shrink-0", className)}
    />
  );
```

`src/components/boards/cells/index.tsx` (`PeopleCell`): add `mono: member?.mono` to each mapped assignee; pass `mono={only.mono}` / `mono={a.mono}` to every `MemberAvatar`; in the single-assignee branch render `{only.mono ? <AgentChip /> : null}` after the name span and set `title={only.mono ? monoAccessibleLabel(only.label, only.mono.ownerName) : undefined}` on the outer span. Import `AgentChip` from `@/components/mono/MonoChip` and `monoAccessibleLabel` from `@/lib/monos/labels`.

`src/components/boards/cells/editors/PeopleEditor.tsx`: import `assignableMembers` from `@/lib/monos/members` and `AgentChip` from `@/components/mono/MonoChip`; change `unassigned` to

```ts
// Adding is owner-only for Monos: the list offers people and the viewer's
// own awake Mono. Already-assigned Monos stay removable (assigned strip).
const unassigned = assignableMembers(members).filter(
  (m) => !selected.includes(m.userId),
);
```

pass `mono={m.mono}` to both `MemberAvatar`s, and render `{m.mono ? <AgentChip /> : null}` after each name span.

`src/components/boards/BoardBulkBar.tsx` (`PeopleAssignList`): map over `assignableMembers(members)` instead of `members`, pass `mono={m.mono}` to `MemberAvatar`.

`src/components/boards/BoardViews.tsx` (`panelMembers`): add `mono: m.mono,` to the projected object.

`src/components/boards/item-panel/ItemPanel.tsx`: widen the members prop type to `readonly (Member & { avatarUrl?: string | null; mono?: MonoMemberMeta })[]` (import the type from `@/lib/monos/types`).

- [ ] **Step 5: Mentions (client, schema, server)**

`src/lib/collaboration/mentions.ts`: replace the type block and `mentionLabel` with:

```ts
/** A person, or the author's own Mono (Personal Monos spec §4). */
export type UserMentionTarget = {
  kind: "user";
  userId: string;
  fullName: string | null;
};
export type MonoMentionTarget = {
  kind: "mono";
  userId: string;
  name: string;
  ownerName: string | null;
  color: string;
};
export type MentionTarget = UserMentionTarget | MonoMentionTarget;

/** The text a mention writes into the body, including the leading `@`. */
export function mentionLabel(target: MentionTarget): string {
  return target.kind === "mono"
    ? `@${target.name}`
    : `@${target.fullName ?? "Someone"}`;
}

/**
 * Only the author's own Mono may be mentioned (spec §4). The picker already
 * offers no other; this is the server's copy of the rule. In Plan 2A a kept
 * Mono mention wakes nothing: it is stored in `body.mentions` for Plan 2B's
 * inbox trigger, which re-checks ownership.
 */
export function keepOwnMonoMentions<
  M extends { kind: "user" | "mono"; userId: string },
>(mentions: readonly M[], ownMonoIds: readonly string[]): M[] {
  return mentions.filter(
    (m) => m.kind !== "mono" || ownMonoIds.includes(m.userId),
  );
}
```

`src/lib/validations/collaboration-actions.ts`: extend the union:

```ts
export const mentionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string().uuid() }),
  z.object({ kind: z.literal("mono"), userId: z.string().uuid() }),
]);
```

and update the header comment's last sentence to "A mention is a person or the author's own Mono."

`src/lib/collaboration/actions.ts` (`addUpdate`): import `keepOwnMonoMentions` from `@/lib/collaboration/mentions`; after the item read and before the insert:

```ts
// Owner-only Mono mentions. Read only when the update names a Mono.
let mentions = parsed.data.mentions;
if (mentions.some((m) => m.kind === "mono")) {
  const { data: own } = await supabase
    .from("monos")
    .select("user_id")
    .eq("owner_id", user.id)
    .eq("org_id", item.org_id);
  mentions = keepOwnMonoMentions(
    mentions,
    (own ?? []).map((r) => r.user_id),
  );
}
```

then use `mentions` (not `parsed.data.mentions`) in the inserted `body` and in the recipients computation (which still keeps `kind === "user"` only).

`src/components/boards/item-panel/MentionTextarea.tsx`: `targetId` returns `{ kind: target.kind, userId: target.userId }`; `targetKey` returns `` `${target.kind}:${target.userId}` ``; in the suggestion button render

```tsx
{
  t.kind === "mono" ? (
    <MonoIdentity
      name={t.name}
      color={t.color}
      ownerName={t.ownerName}
      size={18}
      showOwner={false}
    />
  ) : (
    <span className="truncate">{mentionLabel(t)}</span>
  );
}
```

(import `MonoIdentity` from `@/components/mono/MonoChip`).

`src/components/boards/item-panel/UpdatesTab.tsx`: widen `members` to `readonly (Member & { mono?: MonoMemberMeta })[]`; build targets as

```ts
const targets = useMemo<MentionTarget[]>(
  () =>
    members.flatMap((m): MentionTarget[] =>
      m.mono
        ? m.mono.directable
          ? [
              {
                kind: "mono",
                userId: m.userId,
                name: m.fullName ?? "Mono",
                ownerName: m.mono.ownerName,
                color: m.mono.color,
              },
            ]
          : []
        : [{ kind: "user", userId: m.userId, fullName: m.fullName }],
    ),
  [members],
);
```

make `resolve` match on both `kind` and `userId`; and render the author as

```tsx
{
  (() => {
    const author = members.find((m) => m.userId === u.author_id);
    if (!bot && author?.mono)
      return (
        <MonoIdentity
          name={author.fullName ?? "Mono"}
          color={author.mono.color}
          ownerName={author.mono.ownerName}
          size={18}
        />
      );
    return (
      <span className="text-foreground font-extrabold">
        {bot?.name ?? author?.fullName ?? "Someone"}
      </span>
    );
  })();
}
```

keeping the existing `bot && <Kicker>Agent</Kicker>` chip for legacy marker rows.

- [ ] **Step 6: Verify**

Run: `pnpm vitest run src/lib/monos src/lib/collaboration src/components/boards`. Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected: pass.

- [ ] **Step 7: Commit**

Stage every path under **Files** that `git status` lists, then:

```bash
git commit -m "feat(mono): monos in people cells, pickers, mentions and update authors"
```

---

### Task 9: Mono chat backend (threads, `/api/ask`, confirm card)

**Files:**

- Create: `supabase/migrations/<ts>_mono_threads.sql` (via `scripts/new-migration.sh mono_threads`), `src/lib/monos/turn.ts`, `src/lib/monos/turn.test.ts`, `src/lib/monos/thread-actions.ts`
- Modify: `src/types/database.types.ts` (regenerated), `src/app/api/ask/route.ts` (+ `route.test.ts`), `src/lib/assistant/batch-actions.ts` (+ test), `src/lib/ai/ask/conversation-actions.ts`, `src/lib/ai/ask/conversations.ts` (`listChats`), `src/components/ai/ask/AskChat.tsx`, `src/lib/ai/model-map.ts` (+ `model-map.test.ts`)

**Interfaces:**

- Consumes: Task 5 (`runAi({ credential: "personal" })`), Task 6 (`getMyMono`, `MyMono`, `forgetMonoSession`), Plan 1 `getMonoClient`.
- Produces:
  - Column `ai_conversations.mono_id uuid → monos(user_id) on delete cascade`; a row with `mono_id` must be private, boardless, folderless, run-less, and owned by that Mono's owner in that Mono's org (trigger, `42501`). Index `ai_conversations_mono_updated_idx (mono_id, updated_at desc) where mono_id is not null`.
  - `src/lib/monos/turn.ts` (server-only): `loadOwnedMono(supabase, ownerId: string, orgId: string, monoId: string): Promise<MyMono | null>`, `resolveMonoTurn(supabase, ownerId: string, orgId: string, monoId: string): Promise<{ ok: true; turn: MonoTurn } | { ok: false; status: 403 | 409; error: string }>` with `type MonoTurn = { mono: MyMono; provider: "anthropic" | "openai" }`, `monoSystemLines(mono: Pick<MyMono, "name" | "userId">, ownerName: string | null): string`.
  - `src/lib/monos/thread-actions.ts` (`"use server"`): `loadMyMonoThread(): Promise<ActionResult<{ conversationId: string | null; messages: ThreadMessage[] }>>`.
  - `createConversation({ firstMessage, monoId? })` starts a Mono thread; `listChats` excludes Mono threads.
  - `AskChat` props: `monoId?: string`, `onTurnStart?: () => void`, `onMessagesChange?: (messages: UIMessage[]) => void`.
  - `/api/ask` on a Mono thread: tools and staged-write descriptions run on `getMonoClient(mono.userId)` with `actorId = mono.userId`; model on the owner's key (`feature: "mono_chat"`); 403/409 before the stream when the Mono is not the caller's or is asleep.
  - `applyBatch` on a Mono thread applies each row under `getMonoClient` with `actorId = mono.userId`.
  - `FEATURE_TIERS.mono_chat = "standard"`.

- [ ] **Step 1: Mint and write the migration**

Run: `scripts/new-migration.sh mono_threads`. Content:

```sql
-- Personal Monos, Plan 2A / unit R (chat). A Mono's chat threads are ordinary
-- ai_conversations rows owned by the Mono's owner, so ai_messages RLS,
-- compaction, staging and applyBatch work unchanged.
alter table public.ai_conversations
  add column mono_id uuid references public.monos (user_id) on delete cascade;
alter table public.ai_conversations
  add constraint ai_conversations_mono_private check (
    mono_id is null
    or (visibility = 'private' and board_id is null and folder_id is null and run_id is null)
  );
create index ai_conversations_mono_updated_idx
  on public.ai_conversations (mono_id, updated_at desc) where mono_id is not null;

-- Only a Mono's owner may hold a thread with it (spec §4 "Chat").
create or replace function public.tg_ai_conversations_guard_mono()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.mono_id is null then return new; end if;
  if not exists (
    select 1 from public.monos m
     where m.user_id = new.mono_id and m.owner_id = new.user_id and m.org_id = new.org_id
  ) then
    raise exception 'only its owner can talk to a Mono' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_ai_conversations_guard_mono() from public, anon, authenticated;
create trigger ai_conversations_guard_mono
  before insert or update of mono_id, user_id, org_id on public.ai_conversations
  for each row execute function public.tg_ai_conversations_guard_mono();
```

- [ ] **Step 2: Check it in a rolled-back transaction on DEV**

One `execute_sql` string: the DEV check harness, the Step 1 body, then:

```sql
select public.create_mono('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a1','00000000-0000-4000-8000-0000000002a3','Nova','#7395ff');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a1","role":"authenticated"}', true);
set local role authenticated;
insert into public.ai_conversations (org_id, user_id, title, mono_id)
values ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a1','New chat','00000000-0000-4000-8000-0000000002a3');
select set_config('p2a.owner_thread', (select count(*)::text from public.ai_conversations where mono_id = '00000000-0000-4000-8000-0000000002a3'), true);
do $d$ begin
  begin
    insert into public.ai_conversations (org_id, user_id, title, mono_id, visibility, board_id)
    values ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a1','x','00000000-0000-4000-8000-0000000002a3','board','00000000-0000-4000-8000-0000000002b1');
    perform set_config('p2a.not_shareable', 'inserted', true);
  exception when others then perform set_config('p2a.not_shareable', sqlstate, true); end;
end $d$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000002a2","role":"authenticated"}', true);
set local role authenticated;
do $d$ begin
  begin
    insert into public.ai_conversations (org_id, user_id, title, mono_id)
    values ('00000000-0000-4000-8000-0000000002a0','00000000-0000-4000-8000-0000000002a2','x','00000000-0000-4000-8000-0000000002a3');
    perform set_config('p2a.mate_cannot_chat', 'inserted', true);
  exception when others then perform set_config('p2a.mate_cannot_chat', sqlstate, true); end;
end $d$;
select set_config('p2a.mate_cannot_read', (select count(*)::text from public.ai_conversations where mono_id = '00000000-0000-4000-8000-0000000002a3'), true);
reset role;

select k, current_setting('p2a.' || k, true) as got, want,
       current_setting('p2a.' || k, true) = want as pass
  from (values
    ('owner_thread','1'), ('not_shareable','23514'), ('mate_cannot_chat','42501'), ('mate_cannot_read','0')
  ) v(k, want);
rollback;
```

Expected: every row `pass = true`.

- [ ] **Step 3: Apply, ledger, types**

Apply with `apply_migration`. Run: `pnpm db:ledger-check` (clean). Regenerate types.

- [ ] **Step 4: Write the failing tests**

`src/lib/monos/turn.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMyMono = vi.fn();
vi.mock("./queries", () => ({
  getMyMono: (...a: unknown[]) => getMyMono(...a),
}));
const forgetMonoSession = vi.fn();
vi.mock("@/lib/mono/session", () => ({
  forgetMonoSession: (id: string) => forgetMonoSession(id),
}));

import { monoSystemLines, resolveMonoTurn } from "./turn";

const mono = (over: object = {}) => ({
  userId: "m1",
  orgId: "o1",
  ownerId: "u1",
  name: "Nova",
  color: "#7395ff",
  brain: "key",
  keyProvider: "anthropic",
  lastSeenAt: null,
  createdAt: "t",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("resolveMonoTurn", () => {
  it("returns the owner's awake Mono and its key provider", async () => {
    getMyMono.mockResolvedValue(mono());
    expect(await resolveMonoTurn({} as never, "u1", "o1", "m1")).toEqual({
      ok: true,
      turn: { mono: mono(), provider: "anthropic" },
    });
  });

  it("refuses a Mono that is not the caller's, and forgets its token", async () => {
    getMyMono.mockResolvedValue(mono({ userId: "m-other" }));
    expect(await resolveMonoTurn({} as never, "u1", "o1", "m1")).toEqual({
      ok: false,
      status: 403,
      error: "Not your Mono.",
    });
    expect(forgetMonoSession).toHaveBeenCalledWith("m1");
  });

  it("refuses an asleep Mono with a way to wake it", async () => {
    getMyMono.mockResolvedValue(mono({ brain: "none", keyProvider: null }));
    const r = await resolveMonoTurn({} as never, "u1", "o1", "m1");
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toContain("Settings → AI");
  });
});

describe("monoSystemLines", () => {
  it("names the Mono, its owner and its own identity", () => {
    const text = monoSystemLines({ name: "Nova", userId: "m1" }, "Ada");
    expect(text).toContain('"Nova"');
    expect(text).toContain("user id m1");
    expect(text).toContain('"Ada"');
    expect(text).toContain("waits for");
  });
});
```

In `src/app/api/ask/route.test.ts`:

1. Next to the other hoisted mocks, add:

```ts
const { resolveMonoTurn, getMonoClient } = vi.hoisted(() => ({
  resolveMonoTurn: vi.fn(),
  getMonoClient: vi.fn(async () => ({ mono: "client" })),
}));
vi.mock("@/lib/monos/turn", () => ({
  resolveMonoTurn,
  monoSystemLines: () => "MONO LINES",
}));
vi.mock("@/lib/mono/session", () => ({ getMonoClient }));
```

2. Add `mono_id: string | null;` to `ConversationRow` and `mono_id: null,` to `defaultConversationRow()`.
3. Add at the end of the file:

```ts
describe("POST /api/ask · a Mono thread", () => {
  it("acts as the Mono, on the owner's own key, metered as mono_chat", async () => {
    mockConversationRow({ mono_id: "m1" });
    resolveMonoTurn.mockResolvedValue({
      ok: true,
      turn: { mono: { userId: "m1", name: "Nova" }, provider: "openai" },
    });
    await (await POST(makeReq())).text();

    expect(resolveMonoTurn).toHaveBeenCalledWith(
      theClient.current,
      USER_ID,
      "org1",
      "m1",
    );
    expect(getMonoClient).toHaveBeenCalledWith("m1");
    const built = buildAssistantTools.mock.calls[0]![0];
    expect(built.ctx.actorId).toBe("m1");
    expect(await built.ctx.getClient()).toEqual({ mono: "client" });
    expect(built.client).toEqual({ mono: "client" });
    expect(vi.mocked(runAi).mock.calls[0]![0]).toMatchObject({
      orgId: "org1",
      userId: USER_ID,
      feature: "mono_chat",
      credential: "personal",
      provider: "openai",
    });
    expect(runAssistantLoop.mock.calls[0]![0].system).toContain("MONO LINES");
  });

  it("refuses before streaming when the Mono cannot answer", async () => {
    mockConversationRow({ mono_id: "m1" });
    resolveMonoTurn.mockResolvedValue({
      ok: false,
      status: 409,
      error: "Your Mono is asleep.",
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(409);
    expect(runAi).not.toHaveBeenCalled();
  });

  it("never resolves a Mono for an ordinary thread", async () => {
    await (await POST(makeReq())).text();
    expect(resolveMonoTurn).not.toHaveBeenCalled();
    expect(getMonoClient).not.toHaveBeenCalled();
    expect(vi.mocked(runAi).mock.calls[0]![0]).toMatchObject({
      feature: "ask_pulse",
    });
    expect(vi.mocked(runAi).mock.calls[0]![0]).not.toHaveProperty("credential");
  });
});
```

In `src/lib/assistant/batch-actions.test.ts`:

1. Add `monoId: null as string | null,` to `state`, `state.monoId = null;` to `beforeEach`, and return `mono_id: state.monoId` alongside `user_id`/`org_id` in the `ai_conversations` fake.
2. Add mocks before the import of `./batch-actions`:

```ts
const loadOwnedMono = vi.fn();
const monoClient = { from: () => ({}) };
const getMonoClient = vi.fn(async () => monoClient);
vi.mock("@/lib/monos/turn", () => ({
  loadOwnedMono: (...a: unknown[]) => loadOwnedMono(...a),
}));
vi.mock("@/lib/mono/session", () => ({
  getMonoClient: (id: string) => getMonoClient(id),
}));
```

3. Add:

```ts
describe("applyBatch on a Mono thread", () => {
  it("applies every row as the Mono", async () => {
    state.monoId = "m-1";
    loadOwnedMono.mockResolvedValue({ userId: "m-1" });
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a"],
    });
    expect(res.ok).toBe(true);
    expect(loadOwnedMono).toHaveBeenCalledWith(supabase, "u-1", "o-1", "m-1");
    expect(getMonoClient).toHaveBeenCalledWith("m-1");
    const ctx = invoke.mock.calls[0]![0] as {
      actorId: string;
      getClient: () => Promise<unknown>;
    };
    expect(ctx.actorId).toBe("m-1");
    expect(await ctx.getClient()).toBe(monoClient);
  });

  it("refuses when the Mono is no longer the caller's", async () => {
    state.monoId = "m-1";
    loadOwnedMono.mockResolvedValue(null);
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a"],
    });
    expect(res).toEqual({ ok: false, error: "Conversation not found." });
    expect(invoke).not.toHaveBeenCalled();
  });
});
```

In `src/lib/ai/model-map.test.ts` change `toHaveLength(13)` to `toHaveLength(14)` and add `"mono_chat"` to the standard-tier list in "routes tool-use and generation features to the standard tier".

Run: `pnpm vitest run src/lib/monos/turn.test.ts src/app/api/ask/route.test.ts src/lib/assistant/batch-actions.test.ts src/lib/ai/model-map.test.ts`. Expected: FAIL.

- [ ] **Step 5: `turn.ts` and the thread loader**

`src/lib/monos/turn.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { forgetMonoSession } from "@/lib/mono/session";
import { getMyMono } from "./queries";
import type { MonoKeyProvider, MyMono } from "./types";

type Client = SupabaseClient<Database>;

export type MonoTurn = { mono: MyMono; provider: MonoKeyProvider };

/** The caller's own Mono when it is `monoId`, else null (and its cached token
 *  is dropped: Plan 2A D3). */
export async function loadOwnedMono(
  supabase: Client,
  ownerId: string,
  orgId: string,
  monoId: string,
): Promise<MyMono | null> {
  const mono = await getMyMono(supabase, orgId);
  if (!mono || mono.userId !== monoId || mono.ownerId !== ownerId) {
    forgetMonoSession(monoId);
    return null;
  }
  return mono;
}

export const MONO_ASLEEP_ERROR =
  "Your Mono is asleep. Add an Anthropic or OpenAI key in Settings → AI to wake it.";

/** Cheap checks before a Mono turn streams. Minting the Mono's session
 *  happens later, inside the turn, after the opening status (gotcha-62). */
export async function resolveMonoTurn(
  supabase: Client,
  ownerId: string,
  orgId: string,
  monoId: string,
): Promise<
  { ok: true; turn: MonoTurn } | { ok: false; status: 403 | 409; error: string }
> {
  const mono = await loadOwnedMono(supabase, ownerId, orgId, monoId);
  if (!mono) return { ok: false, status: 403, error: "Not your Mono." };
  if (mono.brain === "none" || !mono.keyProvider)
    return { ok: false, status: 409, error: MONO_ASLEEP_ERROR };
  return { ok: true, turn: { mono, provider: mono.keyProvider } };
}

/** Appended to the system prompt on a Mono turn. Names are JSON-quoted. */
export function monoSystemLines(
  mono: Pick<MyMono, "name" | "userId">,
  ownerName: string | null,
): string {
  const owner = ownerName ? JSON.stringify(ownerName) : "your owner";
  return [
    `You are ${JSON.stringify(mono.name)}, the personal agent (a "Mono") of ${owner}.`,
    `You act in Monolith as your own user (user id ${mono.userId}): you can see only boards you have been added to, and anything you change is recorded as done by you.`,
    `Only ${owner} talks to you here. Every change you line up waits for ${owner} to confirm it.`,
    `You never assign or @mention another Mono.`,
  ].join("\n");
}
```

`src/lib/monos/thread-actions.ts`:

```ts
"use server";

import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import {
  getMessages,
  toThreadMessages,
  type ThreadMessage,
} from "@/lib/ai/ask/conversations";
import { fail, type ActionResult } from "@/lib/actions/result";
import { getMyMono } from "./queries";

/**
 * The My Mono tab's one read, on its first open: the latest thread with the
 * caller's Mono (`ai_conversations_mono_updated_idx`) and its turns (bounded
 * by getMessages). Never on first paint.
 */
export async function loadMyMonoThread(): Promise<
  ActionResult<{ conversationId: string | null; messages: ThreadMessage[] }>
> {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  try {
    const supabase = await createClient();
    const mono = await getMyMono(supabase, org.id);
    if (!mono)
      return { ok: true, data: { conversationId: null, messages: [] } };
    const { data, error } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("user_id", user.id)
      .eq("mono_id", mono.userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return fail("Couldn't load your chat.");
    if (!data)
      return { ok: true, data: { conversationId: null, messages: [] } };
    return {
      ok: true,
      data: {
        conversationId: data.id,
        messages: toThreadMessages(await getMessages(data.id)),
      },
    };
  } catch {
    return fail("Couldn't load your chat.");
  }
}
```

- [ ] **Step 6: `/api/ask`**

In `src/app/api/ask/route.ts`:

1. Imports: `import { getMonoClient } from "@/lib/mono/session";`, `import { monoSystemLines, resolveMonoTurn, type MonoTurn } from "@/lib/monos/turn";`, `import type { ResolvedAiCall } from "@/lib/ai/gateway";` (keep the `runAi` import).
2. Select `mono_id` too: `.select("summary, summarized_upto, board_id, folder_id, user_id, mono_id")`.
3. Right after the "Not your conversation." owner gate:

```ts
// A Mono thread (Personal Monos 2A): the caller must own the Mono and it
// must be awake. Checked before the stream opens so a refusal is a status.
let monoTurn: MonoTurn | null = null;
if (conv.data.mono_id) {
  const r = await resolveMonoTurn(supabase, user.id, org.id, conv.data.mono_id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  monoTurn = r.turn;
}
```

4. Inside the turn, right after `let system = composeFolderScope(…);`:

```ts
if (monoTurn)
  system = `${system}\n\n${monoSystemLines(monoTurn.mono, promptSafeName(me?.fullName))}`;
// A Mono's reads and staged writes are judged by RLS as the Mono itself
// (ADR decision-44). Minted here, after the opening status.
const actingClient = monoTurn
  ? await getMonoClient(monoTurn.mono.userId)
  : supabase;
const actorId = monoTurn ? monoTurn.mono.userId : user.id;
```

5. Move the callback currently passed inline to `runAi(…, async ({ adapter, apiKey, baseUrl, model }, reportUsage) => { … })` into a named constant declared just before the call, with no change to its body except the tool builder:

```ts
const turnBody = async (
  { adapter, apiKey, baseUrl, model }: ResolvedAiCall,
  reportUsage: (usage: AiUsageTokens) => void,
) => {
  /* …the existing body, unchanged, except: */
  const tools = buildAssistantTools({
    ctx: { getClient: async () => actingClient, actorId },
    client: actingClient,
    orgId: org.id,
    stage: (call) => {
      if (staged.length >= MAX_STAGED_CALLS) return false;
      staged.push(call);
      return true;
    },
    describe: describeCtx
      ? (tool, input) => describeCall(tool, input, describeCtx)
      : undefined,
  });
  /* … */
};
```

and replace the call with two literal call sites (the model-map scanner reads `feature: "…"` literals inside `runAi({ … })`):

```ts
const result = monoTurn
  ? await runAi(
      {
        orgId: org.id,
        userId: user.id,
        feature: "mono_chat",
        credential: "personal",
        provider: monoTurn.provider,
      },
      turnBody,
    )
  : await runAi(
      { orgId: org.id, userId: user.id, feature: "ask_pulse" },
      turnBody,
    );
```

Keep the existing SECURITY comment above the tool builder, extended with: "On a Mono thread the client is the Mono's own session; never a service-role client." The summary update, the assistant `ai_messages` insert and the title update keep using `supabase` (the owner's client: the owner owns the thread).

- [ ] **Step 7: `applyBatch` on a Mono thread**

In `src/lib/assistant/batch-actions.ts`:

1. Imports: `import type { SupabaseClient } from "@supabase/supabase-js";`, `import type { Database } from "@/types/database.types";` (the file already imports `Json` from it; merge), `import { getMonoClient } from "@/lib/mono/session";`, `import { loadOwnedMono } from "@/lib/monos/turn";`.
2. `Loaded` becomes `{ ok: true; calls: StagedCall[]; monoId: string | null } | { ok: false; error: string }`; `loadBatch` selects `"user_id, org_id, mono_id"` and returns `monoId: conv.data.mono_id ?? null`.
3. `runCall`'s first parameter type becomes `SupabaseClient<Database>`.
4. In `applyBatch`, after `if (!loaded.ok) return fail(loaded.error);`:

```ts
// A Mono thread applies as the Mono, so RLS judges its own board
// memberships and the rows show the Mono as their author. The outcome
// turn is still written by the owner, who owns the thread.
let actingClient: SupabaseClient<Database> = supabase;
let actorId = user.id;
if (loaded.monoId) {
  const mono = await loadOwnedMono(supabase, user.id, org.id, loaded.monoId);
  if (!mono) return fail("Conversation not found.");
  actingClient = await getMonoClient(mono.userId);
  actorId = mono.userId;
}
```

and call `runCall(actingClient, actorId, org.id, call)`. `dismissBatch` is unchanged.

- [ ] **Step 8: Starting a Mono thread; keeping Mono threads out of `/ask`**

`src/lib/ai/ask/conversation-actions.ts` (`createConversation`):

1. Add `monoId?: string;` to the input type, and `import { getMyMono } from "@/lib/monos/queries";`.
2. After `const org = await resolveActiveOrg(); if (!org) return fail("No organization.");` add:

```ts
// A Mono thread (Personal Monos 2A): the caller's own Mono in this org, and
// never also a board or folder thread.
let monoId: string | null = null;
if (input.monoId !== undefined) {
  const m = idSchema.safeParse(input.monoId);
  if (!m.success) return fail("Invalid Mono.");
  const mine = await getMyMono(await createClient(), org.id);
  if (!mine || mine.userId !== m.data) return fail("Mono not found.");
  monoId = mine.userId;
}
```

3. In the insert use `board_id: monoId ? null : (board?.id ?? null)`, `folder_id: monoId ? null : (folder?.id ?? null)`, and add `mono_id: monoId`.
4. Change the final revalidation to `if (!board && !monoId) revalidatePath("/ask");`.

`src/lib/ai/ask/conversations.ts` (`listChats`): add `.is("mono_id", null)` after `.is("run_id", null)`, and add to its doc comment: "Mono threads live in the My Mono tab, not the /ask rail."

`src/components/ai/ask/AskChat.tsx`:

1. Add props with doc comments:

```ts
  /** The caller's own Mono: a first send starts a Mono thread (the board
   *  rail's My Mono tab). Mutually exclusive with boardId/folderId. */
  monoId?: string;
  /** Fired when a turn begins (the Mono's `thinking` mood). */
  onTurnStart?: () => void;
  /** Mirrors the transcript to a parent that outlives this component (the
   *  My Mono tab's store), so remounting it costs no read. */
  onMessagesChange?: (messages: UIMessage[]) => void;
```

2. In `onSubmit`, right after `setTurnBusy(true);`, call `onTurnStart?.();`.
3. The `createConversation` call becomes:

```ts
const res = await createConversation({
  firstMessage: text,
  ...(monoId
    ? { monoId }
    : boardId
      ? { boardId }
      : folderId
        ? { folderId }
        : {}),
});
```

4. After the `useState` for `messages`, add:

```ts
useEffect(() => {
  onMessagesChange?.(messages);
}, [messages, onMessagesChange]);
```

(import `useEffect` if the file does not already).

`src/lib/ai/model-map.ts`: add `mono_chat: "standard",` under "Tool-use loops — quality-sensitive."

- [ ] **Step 9: Verify**

Run: `pnpm vitest run src/lib/monos src/app/api/ask src/lib/assistant src/lib/ai/model-map.test.ts src/lib/ai/model-request-shape.test.ts src/components/ai/ask`. Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/*_mono_threads.sql src/types/database.types.ts src/lib/monos/turn.ts src/lib/monos/turn.test.ts src/lib/monos/thread-actions.ts src/app/api/ask/route.ts src/app/api/ask/route.test.ts src/lib/assistant/batch-actions.ts src/lib/assistant/batch-actions.test.ts src/lib/ai/ask/conversation-actions.ts src/lib/ai/ask/conversations.ts src/components/ai/ask/AskChat.tsx src/lib/ai/model-map.ts src/lib/ai/model-map.test.ts
git commit -m "feat(mono): owner-only mono chat that acts as the mono on the owner's key"
```

---

### Task 10: The My Mono rail tab

Load the `pulse-ui` and `frontend-design` skills first.

**Files:**

- Create: `src/stores/my-mono.ts`, `src/stores/my-mono.test.ts`, `src/components/mono/rail/rail-mood.ts`, `src/components/mono/rail/rail-mood.test.ts`, `src/components/mono/rail/MonoTab.tsx`, `src/components/mono/rail/MonoTab.test.tsx`
- Modify: `src/stores/board-intelligence.ts` (`DockTab`), `src/components/boards/dock/use-dock-state.ts` (+ test), `src/components/boards/dock/DockTiles.tsx` (+ test), `src/components/boards/dock/DockBody.tsx`, `src/components/boards/dock/BoardDock.tsx`, `src/app/(app)/boards/[boardId]/page.tsx` (`<BoardDock>` props only)

**Interfaces:**

- Consumes: Task 4 (`MonoAvatar`, `AgentChip`, `MonoNameColorForm`, `brainLine`, `monoAccessibleLabel`, `DEFAULT_MONO_COLOR`), Task 6 (`MyMono`, `createMyMono`, `addMyMonoToBoard`, `removeMyMonoFromBoard`), Task 8 (page `roster`, `grantRows`), Task 9 (`loadMyMonoThread`, `AskChat` props `monoId`/`onTurnStart`/`onMessagesChange`).
- Produces:
  - `DockTab = "chat" | "intelligence" | "mono"`; `DockTile` gains `{ kind: "mono" }` (third tile, label "My Mono").
  - `BoardDock` new optional props `myMono?: MyMono | null` (default `null`), `monoOnBoard?: boolean` (default `false`), `ownerName?: string | null` (default `null`).
  - `useMyMonoStore` and `monoThreadOf(threads, monoId)` in `src/stores/my-mono.ts`.
  - `railMood({ brain, busy, justCreated }): MonoMood`.
  - `MonoTab({ boardId, initialMono, initialOnBoard, ownerName })`.

- [ ] **Step 1: Write the failing tests**

`src/components/mono/rail/rail-mood.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { railMood } from "./rail-mood";

describe("railMood", () => {
  it("dozes when asleep, thinks while a turn runs, greets when new", () => {
    expect(railMood({ brain: "none", busy: true, justCreated: true })).toBe(
      "dozing",
    );
    expect(railMood({ brain: "key", busy: true, justCreated: true })).toBe(
      "thinking",
    );
    expect(railMood({ brain: "key", busy: false, justCreated: true })).toBe(
      "hello",
    );
    expect(railMood({ brain: "key", busy: false, justCreated: false })).toBe(
      "idle",
    );
  });
});
```

`src/stores/my-mono.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { monoThreadOf, useMyMonoStore } from "./my-mono";

beforeEach(() => useMyMonoStore.setState({ threads: {} }));

describe("my-mono store", () => {
  it("starts idle and keeps a thread per Mono", () => {
    expect(monoThreadOf(useMyMonoStore.getState().threads, "m1").status).toBe(
      "idle",
    );
    useMyMonoStore
      .getState()
      .setThread("m1", { status: "ready", conversationId: "c1" });
    const t = monoThreadOf(useMyMonoStore.getState().threads, "m1");
    expect(t).toMatchObject({ status: "ready", conversationId: "c1" });
  });

  it("new chat clears the thread and bumps the chat key", () => {
    const s = useMyMonoStore.getState();
    s.setThread("m1", { status: "ready", conversationId: "c1" });
    s.newChat("m1");
    expect(monoThreadOf(useMyMonoStore.getState().threads, "m1")).toEqual({
      status: "ready",
      conversationId: null,
      messages: [],
      chatKey: 1,
    });
  });
});
```

In `src/components/boards/dock/DockTiles.test.tsx` add:

```tsx
it("offers a third tile for the viewer's own Mono", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<DockTiles tab="chat" badge={0} onSelect={onSelect} />);
  const tab = screen.getByRole("tab", { name: "My Mono" });
  await user.click(tab);
  expect(onSelect).toHaveBeenCalledWith({ kind: "mono" });
});
```

(import `userEvent` and `vi` if the file does not already.)

In `src/components/boards/dock/use-dock-state.test.ts` add a test that seeds the stored row with `tab: "mono"` the same way the file's existing restore test seeds `"intelligence"`, and asserts the hook returns `tab === "mono"`.

`src/components/mono/rail/MonoTab.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMyMonoStore } from "@/stores/my-mono";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const createMyMono = vi.fn();
const addMyMonoToBoard = vi.fn();
const removeMyMonoFromBoard = vi.fn();
vi.mock("@/lib/monos/actions", () => ({
  createMyMono: (i: unknown) => createMyMono(i),
  addMyMonoToBoard: (i: unknown) => addMyMonoToBoard(i),
  removeMyMonoFromBoard: (i: unknown) => removeMyMonoFromBoard(i),
}));
const loadMyMonoThread = vi.fn();
vi.mock("@/lib/monos/thread-actions", () => ({
  loadMyMonoThread: () => loadMyMonoThread(),
}));
const askChatProps = vi.fn();
vi.mock("@/components/ai/ask/AskChat", () => ({
  AskChat: (p: Record<string, unknown>) => {
    askChatProps(p);
    return <div data-testid="ask-chat" />;
  },
}));

import { MonoTab } from "./MonoTab";

const BOARD = "33333333-3333-4333-8333-333333333333";
const mono = (brain: "none" | "key") => ({
  userId: "m1",
  orgId: "o1",
  ownerId: "u1",
  name: "Nova",
  color: "#7395ff",
  brain,
  keyProvider: brain === "key" ? ("anthropic" as const) : null,
  lastSeenAt: null,
  createdAt: "t",
});

beforeEach(() => {
  vi.clearAllMocks();
  useMyMonoStore.setState({ threads: {} });
  loadMyMonoThread.mockResolvedValue({
    ok: true,
    data: { conversationId: "c1", messages: [] },
  });
});

describe("MonoTab", () => {
  it("first open: name and colour, then creates the Mono", async () => {
    const user = userEvent.setup();
    createMyMono.mockResolvedValue({ ok: true, data: mono("none") });
    render(
      <MonoTab
        boardId={BOARD}
        initialMono={null}
        initialOnBoard={false}
        ownerName="Ada Owner"
      />,
    );
    await user.type(screen.getByLabelText("Name"), "Nova");
    await user.click(screen.getByRole("button", { name: "Create my Mono" }));
    expect(createMyMono).toHaveBeenCalledWith({
      name: "Nova",
      color: "#7395ff",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Asleep")).toBeInTheDocument();
  });

  it("asleep: a Wake up card linking to the API key settings, no chat", () => {
    render(
      <MonoTab
        boardId={BOARD}
        initialMono={mono("none")}
        initialOnBoard={false}
        ownerName="Ada Owner"
      />,
    );
    expect(
      screen.getByRole("link", { name: "Add an API key" }),
    ).toHaveAttribute("href", "/settings/ai");
    expect(screen.queryByTestId("ask-chat")).toBeNull();
    expect(loadMyMonoThread).not.toHaveBeenCalled();
    expect(
      screen.getByText("Only you can chat with, assign or @mention it."),
    ).toBeInTheDocument();
  });

  it("awake: loads its thread once and chats as the Mono", async () => {
    const { unmount } = render(
      <MonoTab
        boardId={BOARD}
        initialMono={mono("key")}
        initialOnBoard
        ownerName="Ada Owner"
      />,
    );
    await screen.findByTestId("ask-chat");
    expect(askChatProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ monoId: "m1", conversationId: "c1" }),
    );
    expect(
      screen.getByText("Runs on your Anthropic key. Chat with it here."),
    ).toBeInTheDocument();
    unmount();
    render(
      <MonoTab
        boardId={BOARD}
        initialMono={mono("key")}
        initialOnBoard
        ownerName="Ada Owner"
      />,
    );
    await screen.findByTestId("ask-chat");
    expect(loadMyMonoThread).toHaveBeenCalledTimes(1);
  });

  it("adds and removes the Mono on this board", async () => {
    const user = userEvent.setup();
    addMyMonoToBoard.mockResolvedValue({ ok: true, data: undefined });
    removeMyMonoFromBoard.mockResolvedValue({ ok: true, data: undefined });
    render(
      <MonoTab
        boardId={BOARD}
        initialMono={mono("key")}
        initialOnBoard={false}
        ownerName="Ada Owner"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add to this board" }));
    await waitFor(() =>
      expect(addMyMonoToBoard).toHaveBeenCalledWith({ boardId: BOARD }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Remove from this board" }),
    );
    expect(removeMyMonoFromBoard).toHaveBeenCalledWith({ boardId: BOARD });
  });
});
```

Run: `pnpm vitest run src/components/mono/rail src/stores/my-mono.test.ts src/components/boards/dock`. Expected: FAIL.

- [ ] **Step 2: Mood, store, tab type**

`src/components/mono/rail/rail-mood.ts`:

```ts
import type { MonoBrain } from "@/lib/monos/types";
import type { MonoMood } from "../mono-renderer";

/** The rail's mood for the owner's Mono in 2A (spec §8 moods as states). */
export function railMood(s: {
  brain: MonoBrain;
  busy: boolean;
  justCreated: boolean;
}): MonoMood {
  if (s.brain === "none") return "dozing";
  if (s.busy) return "thinking";
  if (s.justCreated) return "hello";
  return "idle";
}
```

`src/stores/my-mono.ts`:

```ts
import { create } from "zustand";
import type { UIMessage } from "@/components/ai/ask/MessageList";

/**
 * The My Mono tab's chat, held OUTSIDE the tab: the dock mounts only the open
 * section, so a tab-local state would refetch on every switch back. Client
 * state only, never persisted.
 */
export type MonoThreadState = {
  status: "idle" | "loading" | "ready" | "error";
  conversationId: string | null;
  messages: UIMessage[];
  /** Bumped by "New chat" to remount the chat with no thread. */
  chatKey: number;
};

const EMPTY: MonoThreadState = {
  status: "idle",
  conversationId: null,
  messages: [],
  chatKey: 0,
};

export function monoThreadOf(
  threads: Record<string, MonoThreadState>,
  monoId: string,
): MonoThreadState {
  return threads[monoId] ?? EMPTY;
}

interface MyMonoStoreState {
  threads: Record<string, MonoThreadState>;
  setThread: (monoId: string, patch: Partial<MonoThreadState>) => void;
  newChat: (monoId: string) => void;
}

export const useMyMonoStore = create<MyMonoStoreState>()((set) => ({
  threads: {},
  setThread: (monoId, patch) =>
    set((s) => ({
      threads: {
        ...s.threads,
        [monoId]: { ...monoThreadOf(s.threads, monoId), ...patch },
      },
    })),
  newChat: (monoId) =>
    set((s) => {
      const cur = monoThreadOf(s.threads, monoId);
      return {
        threads: {
          ...s.threads,
          [monoId]: {
            status: "ready",
            conversationId: null,
            messages: [],
            chatKey: cur.chatKey + 1,
          },
        },
      };
    }),
}));
```

`src/stores/board-intelligence.ts`: `export type DockTab = "chat" | "intelligence" | "mono";`.

`src/components/boards/dock/use-dock-state.ts`: the restore line becomes

```ts
      tab:
        parsed.tab === "intelligence" || parsed.tab === "mono"
          ? parsed.tab
          : "chat",
```

- [ ] **Step 3: Tiles**

In `src/components/boards/dock/DockTiles.tsx`:

1. `export type DockTile = { kind: "intelligence" } | { kind: "ask" } | { kind: "mono" };`
2. `const TILES: readonly DockTile[] = [{ kind: "intelligence" }, { kind: "ask" }, { kind: "mono" }];`
3. `dockTileId`: add `case "mono": return \`${prefix}-mono\`;`.
4. `panelIdFor`: return `"dock-panel-mono"` for `mono`.
5. `isActive`: `return tile.kind === "intelligence" ? tab === "intelligence" : tile.kind === "mono" ? tab === "mono" : tab === "chat";`
6. `labelFor`: `if (tile.kind === "mono") return "My Mono";` first.
7. New prop on `DockTilesProps`: `/** The viewer's own Mono, for its tile face. Null before it exists. */ mono?: { color: string; asleep: boolean } | null;` passed to `TileFace`, whose mono branch is:

```tsx
if (tile.kind === "mono") {
  return (
    <span className="bg-chrome-fill flex size-6.5 items-center justify-center rounded-sm border">
      <MonoAvatar
        color={mono?.color ?? DEFAULT_MONO_COLOR}
        mood={!mono || mono.asleep ? "dozing" : "idle"}
        size={18}
        label=""
      />
    </span>
  );
}
```

(`label=""` because the tab button already carries the name; import `MonoAvatar` and `DEFAULT_MONO_COLOR`.) Update the component's doc comment: "The dock's one tab row: Intelligence, Ask and My Mono."

- [ ] **Step 4: The tab**

`src/components/mono/rail/MonoTab.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AskChat } from "@/components/ai/ask/AskChat";
import type { UIMessage } from "@/components/ai/ask/MessageList";
import { MonoAvatar } from "@/components/mono/MonoAvatar";
import { AgentChip } from "@/components/mono/MonoChip";
import { MonoNameColorForm } from "@/components/mono/MonoNameColorForm";
import {
  addMyMonoToBoard,
  createMyMono,
  removeMyMonoFromBoard,
} from "@/lib/monos/actions";
import { loadMyMonoThread } from "@/lib/monos/thread-actions";
import { brainLine, monoAccessibleLabel } from "@/lib/monos/labels";
import type { MyMono } from "@/lib/monos/types";
import { monoThreadOf, useMyMonoStore } from "@/stores/my-mono";
import { railMood } from "./rail-mood";

/**
 * The right rail's My Mono tab (Personal Monos spec §9, Plan 2A).
 *
 * Budget: renders from props (the page's one `get_my_mono` read). The first
 * open of an awake Mono issues ONE Server Action for its latest thread; the
 * thread lives in `useMyMonoStore`, so switching tabs and back is free.
 */
export function MonoTab({
  boardId,
  initialMono,
  initialOnBoard,
  ownerName,
}: {
  boardId: string;
  initialMono: MyMono | null;
  initialOnBoard: boolean;
  ownerName: string | null;
}) {
  const router = useRouter();
  const [created, setCreated] = useState<MyMono | null>(null);
  const mono = created ?? initialMono;
  const [onBoard, setOnBoard] = useState(initialOnBoard);
  const [busy, setBusy] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardPending, startBoard] = useTransition();
  const threads = useMyMonoStore((s) => s.threads);
  const setThread = useMyMonoStore((s) => s.setThread);
  const newChat = useMyMonoStore((s) => s.newChat);
  const thread = mono ? monoThreadOf(threads, mono.userId) : null;
  const awake = mono !== null && mono.brain !== "none";
  const monoId = mono?.userId ?? null;

  const loadThread = useCallback(
    async (id: string) => {
      setThread(id, { status: "loading" });
      try {
        const res = await loadMyMonoThread();
        if (res.ok)
          setThread(id, {
            status: "ready",
            conversationId: res.data.conversationId,
            messages: res.data.messages,
          });
        else setThread(id, { status: "error" });
      } catch {
        setThread(id, { status: "error" });
      }
    },
    [setThread],
  );

  useEffect(() => {
    if (!monoId || !awake || thread?.status !== "idle") return;
    void loadThread(monoId);
  }, [monoId, awake, thread?.status, loadThread]);

  const syncMessages = useCallback(
    (messages: UIMessage[]) => {
      if (monoId) setThread(monoId, { messages });
    },
    [monoId, setThread],
  );

  if (!mono) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 py-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-extrabold">Meet your Mono</h2>
          <p className="text-muted-foreground text-sm">
            Your own agent. Only you can chat with it, assign it or @mention it.
          </p>
        </div>
        <MonoNameColorForm
          submitLabel="Create my Mono"
          onSubmit={async (value) => {
            const res = await createMyMono(value);
            if (!res.ok) return res.error;
            setCreated(res.data);
            // Server data changed: the board's member payload gains the Mono
            // (updateTag already ran). One refresh, not a navigation.
            router.refresh();
            return null;
          }}
        />
      </div>
    );
  }

  const toggleBoard = () =>
    startBoard(async () => {
      setBoardError(null);
      const res = onBoard
        ? await removeMyMonoFromBoard({ boardId })
        : await addMyMonoToBoard({ boardId });
      if (res.ok) setOnBoard(!onBoard);
      else setBoardError(res.error);
    });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-3.5 pt-3 pb-2">
        <MonoAvatar
          color={mono.color}
          mood={railMood({
            brain: mono.brain,
            busy,
            justCreated: created !== null,
          })}
          size={56}
          label={monoAccessibleLabel(mono.name, ownerName)}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <h2
              className="truncate text-sm font-extrabold"
              style={{
                color: `color-mix(in oklab, ${mono.color} 65%, var(--foreground))`,
              }}
            >
              {mono.name}
            </h2>
            <AgentChip />
          </div>
          <p className="text-muted-foreground text-xs">
            {brainLine(mono.brain, mono.keyProvider)}
          </p>
          <p className="text-muted-foreground text-xs">
            Only you can chat with, assign or @mention it.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3.5 pb-2 text-xs">
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          {onBoard ? "On this board" : "Not on this board"}
        </span>
        <Button
          variant="ghost"
          size="xs"
          disabled={boardPending}
          onClick={toggleBoard}
        >
          {onBoard ? "Remove from this board" : "Add to this board"}
        </Button>
      </div>
      {boardError ? (
        <p role="alert" className="text-destructive px-3.5 pb-2 text-xs">
          {boardError}
        </p>
      ) : null}

      {!awake ? (
        <div className="bg-surface mx-3.5 my-2 flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm font-semibold">{mono.name} is asleep</p>
          <p className="text-muted-foreground text-xs">
            Give it a brain to wake it up: add an Anthropic or OpenAI API key.
            It runs on your key, and only while you chat with it.
          </p>
          <Button asChild size="sm" className="self-start">
            <Link href="/settings/ai">Add an API key</Link>
          </Button>
        </div>
      ) : thread?.status === "error" ? (
        <div className="flex items-center gap-2 px-3.5 py-2">
          <p className="text-destructive min-w-0 flex-1 text-xs">
            Couldn&apos;t load your chat.
          </p>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void loadThread(mono.userId)}
          >
            Try again
          </Button>
        </div>
      ) : thread?.status !== "ready" ? (
        <div className="flex flex-col gap-2 px-3.5 py-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex justify-end px-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New chat with your Mono"
              disabled={thread.conversationId === null}
              onClick={() => newChat(mono.userId)}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <AskChat
            key={`${mono.userId}:${thread.chatKey}`}
            conversationId={thread.conversationId}
            initialMessages={thread.messages}
            monoId={mono.userId}
            surface="atmosphere"
            onStarted={(id) => setThread(mono.userId, { conversationId: id })}
            onTurnStart={() => setBusy(true)}
            onTurnComplete={() => setBusy(false)}
            onMessagesChange={syncMessages}
          />
        </div>
      )}
    </div>
  );
}
```

Check against the real components before running: `Button` supports `asChild` and the `xs` / `icon-sm` sizes (both are used in `DockBody.tsx`; confirm `asChild` in `src/components/ui/button.tsx`, and if absent render `<Link className={buttonVariants({ size: "sm" })} …>` using that file's exported variants helper instead). If `react-hooks/set-state-in-effect` flags the load effect, keep the effect and add the same one-line disable comment `BoardDock.tsx` uses for its store-driven effect, with the reason "first-open read; the store, not React state, is updated".

- [ ] **Step 5: Dock wiring**

`src/components/boards/dock/DockBody.tsx`:

1. Props: add `myMono: MyMono | null; monoOnBoard: boolean; ownerName: string | null;` to `DockBodyProps` (import `MyMono` from `@/lib/monos/types`, `MonoTab` from `@/components/mono/rail/MonoTab`).
2. Pass `mono={myMono ? { color: myMono.color, asleep: myMono.brain === "none" } : null}` to its `<DockTiles>`.
3. Render the panels as a three-way switch: keep the existing chat branch for `tab === "chat"`; add before the Intelligence branch:

```tsx
      {tab === "mono" ? (
        <div
          id="dock-panel-mono"
          role="tabpanel"
          aria-labelledby={dockTileId({ kind: "mono" })}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <MonoTab
            boardId={boardId}
            initialMono={myMono}
            initialOnBoard={monoOnBoard}
            ownerName={ownerName}
          />
        </div>
      ) : tab === "chat" ? (
```

and close the ternary so Intelligence renders only when `tab === "intelligence"`.

`src/components/boards/dock/BoardDock.tsx`:

1. Props: `myMono = null`, `monoOnBoard = false`, `ownerName = null` with types `myMono?: MyMono | null; monoOnBoard?: boolean; ownerName?: string | null;` and doc comment "The viewer's own Mono, read once by the page (Plan 2A). Never re-read here."
2. `selectTile` maps `tile.kind === "intelligence" ? "intelligence" : tile.kind === "mono" ? "mono" : "chat"`.
3. Add `myMono, monoOnBoard, ownerName` to the `body` object, and pass `mono={myMono ? { color: myMono.color, asleep: myMono.brain === "none" } : null}` to the mini-rail `<DockTiles>` (around line 729).
4. Update the component's doc comment's first line to "The board's dock: Intelligence, the org assistant's chat, and the viewer's own Mono."

`src/app/(app)/boards/[boardId]/page.tsx`: pass to `<BoardDock>`:

```tsx
        myMono={roster.myMono}
        // Reuses the page's own board_members read: no new query.
        monoOnBoard={
          roster.myMono !== null &&
          (grantRows ?? []).some((g) => g.user_id === roster.myMono!.userId)
        }
        ownerName={members.find((m) => m.userId === user.id)?.fullName ?? null}
```

- [ ] **Step 6: Verify**

Run: `pnpm vitest run src/components/mono src/stores src/components/boards/dock`. Expected: PASS (existing `BoardDock`/`DockBody` tests keep passing through the defaulted props; add `myMono={null} monoOnBoard={false} ownerName={null}` to any `DockBody` test fixture that builds the full props object).

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected: pass.

Look at it: run `pnpm dev` in the worktree, open a board, open the dock, check all three tabs at 1280 px and at 390 px (the Sheet), the first-open form, the Wake-up card, and the chat surface. Revert any `AGENTS.md` change `next dev` made.

- [ ] **Step 7: Commit**

Stage every path under **Files** that `git status` lists, then:

```bash
git commit -m "feat(mono): my mono tab in the board rail"
```

---

### Task 11: Settings → My Mono

Load the `pulse-ui` and `frontend-design` skills first.

**Files:**

- Create: `src/app/(app)/settings/my-mono/page.tsx`, `src/components/mono/MyMonoSettings.tsx`, `src/components/mono/MyMonoSettings.test.tsx`
- Modify: `src/app/(app)/settings/settings-nav-groups.ts`, `src/app/(app)/settings/settings-nav-data.test.tsx`

**Interfaces:**

- Consumes: Task 4 (`MonoAvatar`, `AgentChip`, `MonoNameColorForm`, `brainLine`, `monoAccessibleLabel`), Task 6 (`getMyMono`, `listMonoBoards`, `MonoBoard`, `MyMono`, `createMyMono`, `updateMyMono`, `removeMyMonoFromBoard`).
- Produces: route `/settings/my-mono`; nav entry "My Mono" under Account (after Profile); `MyMonoSettings({ mono, boards, ownerName })`.

- [ ] **Step 1: Write the failing tests**

In `src/app/(app)/settings/settings-nav-data.test.tsx`, inside `describe("settingsNavGroups")`:

```ts
it("offers My Mono to everyone", () => {
  expect(hrefs(false)).toContain("/settings/my-mono");
  expect(hrefs(true)).toContain("/settings/my-mono");
});
```

`src/components/mono/MyMonoSettings.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const createMyMono = vi.fn();
const updateMyMono = vi.fn();
const removeMyMonoFromBoard = vi.fn();
vi.mock("@/lib/monos/actions", () => ({
  createMyMono: (i: unknown) => createMyMono(i),
  updateMyMono: (i: unknown) => updateMyMono(i),
  removeMyMonoFromBoard: (i: unknown) => removeMyMonoFromBoard(i),
}));

import { MyMonoSettings } from "./MyMonoSettings";

const mono = {
  userId: "m1",
  orgId: "o1",
  ownerId: "u1",
  name: "Nova",
  color: "#7395ff",
  brain: "key" as const,
  keyProvider: "openai" as const,
  lastSeenAt: null,
  createdAt: "t",
};
const BOARD = "33333333-3333-4333-8333-333333333333";

beforeEach(() => vi.clearAllMocks());

describe("MyMonoSettings", () => {
  it("offers to create a Mono when there is none", () => {
    render(<MyMonoSettings mono={null} boards={[]} ownerName="Ada" />);
    expect(
      screen.getByRole("button", { name: "Create my Mono" }),
    ).toBeInTheDocument();
  });

  it("renames, says the brain, and lists boards", async () => {
    const user = userEvent.setup();
    updateMyMono.mockResolvedValue({ ok: true, data: mono });
    render(
      <MyMonoSettings
        mono={mono}
        boards={[{ boardId: BOARD, name: "Launch", accessLevel: "editor" }]}
        ownerName="Ada"
      />,
    );
    expect(
      screen.getByText("Runs on your OpenAI key. Chat with it here."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Launch" })).toHaveAttribute(
      "href",
      `/boards/${BOARD}`,
    );
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Nova Two");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateMyMono).toHaveBeenCalledWith({
      name: "Nova Two",
      color: "#7395ff",
    });
  });

  it("removes the Mono from a board without a page refresh", async () => {
    const user = userEvent.setup();
    removeMyMonoFromBoard.mockResolvedValue({ ok: true, data: undefined });
    render(
      <MyMonoSettings
        mono={mono}
        boards={[{ boardId: BOARD, name: "Launch", accessLevel: "editor" }]}
        ownerName="Ada"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Remove Nova from Launch" }),
    );
    expect(removeMyMonoFromBoard).toHaveBeenCalledWith({ boardId: BOARD });
    expect(
      await screen.findByText("Not on any board yet."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm vitest run "src/app/(app)/settings/settings-nav-data.test.tsx" src/components/mono/MyMonoSettings.test.tsx`. Expected: FAIL.

- [ ] **Step 2: Nav entry**

In `src/app/(app)/settings/settings-nav-groups.ts`, Account items become:

```ts
        { href: "/settings/profile", label: "Profile" },
        { href: "/settings/my-mono", label: "My Mono" },
        { href: "/settings/preferences", label: "Preferences" },
        { href: "/settings/notifications", label: "Notifications" },
        { href: "/settings/security", label: "Security" },
```

- [ ] **Step 3: The page and its client part**

`src/app/(app)/settings/my-mono/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { getMyMono, listMonoBoards } from "@/lib/monos/queries";
import { SettingsSection } from "@/components/settings/settings-section";
import { MyMonoSettings } from "@/components/mono/MyMonoSettings";

export const metadata = { title: "My Mono · Settings" };

/** Three bounded reads: the caller's Mono (point read), the boards it is on
 *  (≤100, indexed by user_id), and the caller's name for the owner label. */
export default async function MyMonoSettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");
  const supabase = await createClient();
  const [mono, { data: me }] = await Promise.all([
    getMyMono(supabase, org.id),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const boards = mono ? await listMonoBoards(supabase, mono.userId) : [];

  return (
    <SettingsSection
      title="My Mono"
      description="Your own agent in this organization. Only you can chat with it, assign it or @mention it."
    >
      <MyMonoSettings
        mono={mono}
        boards={boards}
        ownerName={me?.full_name ?? null}
      />
    </SettingsSection>
  );
}
```

`src/components/mono/MyMonoSettings.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MonoAvatar } from "./MonoAvatar";
import { AgentChip } from "./MonoChip";
import { MonoNameColorForm } from "./MonoNameColorForm";
import {
  createMyMono,
  removeMyMonoFromBoard,
  updateMyMono,
} from "@/lib/monos/actions";
import { brainLine, monoAccessibleLabel } from "@/lib/monos/labels";
import type { MonoBoard, MyMono } from "@/lib/monos/types";

export function MyMonoSettings({
  mono,
  boards: initialBoards,
  ownerName,
}: {
  mono: MyMono | null;
  boards: MonoBoard[];
  ownerName: string | null;
}) {
  const router = useRouter();
  const [boards, setBoards] = useState(initialBoards);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!mono) {
    return (
      <div className="max-w-sm py-4">
        <MonoNameColorForm
          submitLabel="Create my Mono"
          onSubmit={async (value) => {
            const res = await createMyMono(value);
            if (!res.ok) return res.error;
            router.refresh();
            return null;
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex items-center gap-3">
        <MonoAvatar
          color={mono.color}
          mood={mono.brain === "none" ? "dozing" : "idle"}
          size={56}
          label={monoAccessibleLabel(mono.name, ownerName)}
        />
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold">{mono.name}</span>
            <AgentChip />
          </div>
          <p className="text-muted-foreground text-sm">
            {brainLine(mono.brain, mono.keyProvider)}
          </p>
          {mono.brain === "none" ? (
            <Link href="/settings/ai" className="text-brand text-sm underline">
              Add an API key to wake it
            </Link>
          ) : null}
        </div>
      </div>

      <div className="max-w-sm">
        <MonoNameColorForm
          initialName={mono.name}
          initialColor={mono.color}
          submitLabel="Save"
          onSubmit={async (value) => {
            const res = await updateMyMono(value);
            if (!res.ok) return res.error;
            router.refresh();
            return null;
          }}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Boards it is on</h3>
        {boards.length === 0 ? (
          <p className="text-muted-foreground text-sm">Not on any board yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {boards.map((b) => (
              <li key={b.boardId} className="flex items-center gap-2 px-3 py-2">
                <Link
                  href={`/boards/${b.boardId}`}
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                >
                  {b.name}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {b.accessLevel === "editor" ? "Can edit" : "Can view"}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={pending}
                  aria-label={`Remove ${mono.name} from ${b.name}`}
                  onClick={() =>
                    startTransition(async () => {
                      setError(null);
                      const res = await removeMyMonoFromBoard({
                        boardId: b.boardId,
                      });
                      if (res.ok)
                        setBoards((prev) =>
                          prev.filter((x) => x.boardId !== b.boardId),
                        );
                      else setError(res.error);
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run "src/app/(app)/settings" src/components/mono`. Expected: PASS. Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/settings/my-mono/page.tsx" "src/app/(app)/settings/settings-nav-groups.ts" "src/app/(app)/settings/settings-nav-data.test.tsx" src/components/mono/MyMonoSettings.tsx src/components/mono/MyMonoSettings.test.tsx
git commit -m "feat(mono): settings page to rename, recolour and manage your mono"
```

---

### Task 12: Live run, whole-branch review, finish (orchestrator)

AI features need a live run before merge. The orchestrator drives the owner's Chrome (claude-in-chrome; if it is down, use a Playwright script inside the worktree's `node_modules/.cache/`). Use two accounts in one DEV org: **A** (the Mono owner) and **B** (a teammate). Use a throwaway board.

- [ ] **Step 1: Whole-branch review** of `task/monos-p2a` against spec units I and O and this plan's scope (superpowers:requesting-code-review on the full diff, not per task). Fix Important findings before the live run.

- [ ] **Step 2: Gates on the merged state:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, and `pnpm db:ledger-check`.

- [ ] **Step 3: Live run** (`pnpm dev` from the worktree; record each result):

1. As A, open the throwaway board, open the dock: three tabs (Intelligence, the org assistant's name, My Mono). Switching tabs makes no network request (DevTools Network).
2. My Mono: the first-open form shows 7 presets and a custom colour. Name it, pick a colour, create. Expect the Mono with the `dozing` face, "Asleep", the Wake-up card, "Only you can chat with, assign or @mention it."
3. In Settings → AI add an Anthropic (or OpenAI) key. Back on the board, My Mono says "Runs on your Anthropic key. Chat with it here."
4. "Add to this board". Then in a People cell, open the picker: A's Mono is listed with the Agent chip; assign it. The cell shows the pebble avatar, name and Agent chip.
5. Chat: "What is on this board?" The answer reads board data (the Mono can see the board). Then "Post an update on <item> saying hello". A confirm card appears; confirm. The item's Updates show the Mono as author (pebble, Agent chip, "A's Mono").
6. In an update, type `@` + the Mono's name: it is suggested; post. No notification row is created for the Mono (DEV `select count(*) from notifications where recipient_id = '<mono id>'` → 0).
7. As B on the same board: the People picker does **not** list A's Mono; the mention list does not suggest it; B's My Mono tab shows B's own first-open form, never A's chat. In B's browser console, `fetch("/api/ask", { method: "POST", body: JSON.stringify({ conversationId: "<A's Mono thread id>" }) })` returns 404 or 403.
8. As B, try to add A's Mono through the MCP or a crafted cell write if convenient; otherwise rely on Task 3's DEV check. Settings → Members (as an admin) does not list any Mono; `/settings/my-mono` renames and lists the board.
9. Remove A's key: the Mono goes back to "Asleep"; sending a chat message is refused with the wake-up message.
10. Clean up: remove the test key, keep or delete the throwaway board. Monos are real rows; leave them (they are inert) or have A leave the org to verify removal.

Fix anything that fails, re-run the gates, then continue.

- [ ] **Step 4: Finish.** `scripts/finish-task.sh` from the worktree (it rebases on `develop`, gates, merges, pushes and removes the worktree). Then write the session note with `/wrapup`.

- [ ] **Step 5: Tell the owner how to test** (on `develop`, DEV data):

1. Open any board, open the right rail, pick **My Mono**, name it and pick a colour.
2. Settings → AI: add your Anthropic or OpenAI key. The rail now says your Mono runs on your key.
3. Click **Add to this board**, then assign your Mono in a People column: it shows its pebble face and an Agent chip.
4. Ask it in the My Mono tab to post an update on an item; confirm the card; the update shows your Mono as its author.
5. Have a teammate open the same board: they cannot see your Mono in their pickers or @mention list, and cannot open your chat.
6. Settings → My Mono: rename it, change its colour, see the boards it is on.

Expected limits in 2A (say so): the Mono does nothing on its own; being assigned or @mentioned does not wake it yet (Plan 2B).

---

## Self-review against the spec

- **§1 Identity:** table, unique, RLS, view, column grants (Task 1); definer creation with `is_agent` and `agent` membership (Tasks 1, 6); board membership by owner only, follows owner access, leaving or account deletion removes it (Tasks 1, 2). Created on first open of My Mono (Task 10), not at signup.
- **§2 Brain:** `none`/`key` derived and synced (Task 1); `connected` reserved; asleep renders `dozing`, cannot be assigned (Tasks 3, 8, 10), Wake-up card (Task 10). Failure notification and `needsyou`: Plan 2B.
- **§3 Acting as the Mono:** key brain via `getMonoClient` for reads, staging and applying (Task 9); authorship is the Mono's (`actorId`, RLS `author_id = auth.uid()`). Connected brain: Plan 2B.
- **§4 Owner-only:** assign trigger and pickers (Tasks 3, 8); mention picker and server filter (Task 8); chat owner-only (Task 9 trigger, existing RLS, route 403); agent-to-agent blocked in the trigger and the prompt (Tasks 3, 9).
- **§8 Look and labelling:** shared renderer hardened (Task 4); Agent chip, "<Owner>'s Mono" and tinted name in cells, pickers, mentions, update authors, rail and settings (Tasks 4, 8, 10, 11); no "Pulse".
- **§9 Right rail and Settings:** three tabs, My Mono tab content for 2A, first-open picker, Settings → My Mono (Tasks 10, 11). Pending approvals, amber dot, items it is working on: Plan 2B.
- **Performance budget:** stated above; first paint adds no new wave; tab switches 0 round-trips.
- **Tests:** identity/RLS, owner-only and agent-to-agent behaviour proven in rolled-back DEV transactions (Tasks 1, 2, 3, 9); renderer smoke across 7 moods (Task 4); unit tests for every module; live run (Task 12).

## Risks and spec tensions found while planning

- **First paint:** the spec says the rail adds "one small read" and other Monos ride the existing member payload. The plan adds one point RPC (`get_my_mono`) and one cached list (`listOrgMonosCached`) inside the existing wave, because the member payload is a cached service-role roster and must stay people-only.
- **Managed / org-BYO orgs** hide the personal key form in Settings → AI, so a Mono there cannot wake in 2A. No such org exists on DEV today (9 `per_user`, 3 `off`).
- **Billing:** personal-key spend is recorded in `ai_usage` against the owner; in a managed org `ai_credits_used_this_month` may count it toward the org's credit ceiling.
- **`getMessages` oldest-first 200 cap** is an existing defect for any long thread; D4 sidesteps it with "New chat", it is not fixed here.
- **A Mono could create a board** through a confirmed `create_board` call; that board's creator would be the Mono, invisible to its owner until shared. Not blocked in 2A; candidate rule for 2B's `auto` classification.
- **Board "shared" indicator** in the sidebar counts any `board_members` row, so a board with only the owner's Mono on it reads as shared.
- **Platform admin user search** (`platform_search_users`) still lists Mono bot users.
- **Automations** cannot target a Mono (the automation member list is people-only); an automation that wrote a Mono into a People cell would fail on the trigger.
