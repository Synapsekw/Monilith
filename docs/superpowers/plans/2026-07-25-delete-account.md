# Delete Account Implementation Plan

> **STATUS: BUILT (2026-07-25).** This plan is kept as the execution record. Four things below
> are **stale** — the spec (`docs/superpowers/specs/2026-07-25-delete-account-design.md`) and the
> committed migrations are authoritative:
>
> 1. **All four decision points were resolved by the owner**, not left on their defaults:
>    D1 retain (purge = follow-up, not built) · **D2 → the platform BOT**, not the org owner ·
>    D3 cascade · **D4 → notify** the receiving owner.
> 2. **A third migration was required.** Two `BEFORE UPDATE` freeze triggers
>    (`items_protect_creation_metadata`, `item_updates_protect_attribution`) silently revert
>    attribution, making Task 1's reassignment a **no-op** for `items.created_by` and
>    `item_updates.author_id`. `20260725103609_account_deletion_reattribution_triggers` opens one
>    narrowly-guarded branch in each. See spec §3.3.
> 3. **`actor_kind = 'user'` is invalid** — a CHECK constraint permits only `'org'` and
>    `'platform'`, so Task 4's audit insert as written would have failed on every deletion.
> 4. **Task 2 Step 5's `feedback/actions.ts` edit was wrong**: that block is
>    `adminUpdateFeedback`'s notify path, not an ownership check. Returning `fail()` there would
>    have broken the platform admin's ability to respond to feedback at all. Built as a null
>    guard around the notification instead.
>
> Task 9 Step 4 (`finish-task.sh`) was deliberately **not** run — the main thread serializes merges.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user permanently delete their own Monolith account from Settings → Security → Danger zone, transferring authorship of org work product to a surviving org owner instead of orphaning it.

**Architecture:** One migration fixes the 26 `ON DELETE NO ACTION` foreign keys to `auth.users` using a per-column hybrid — reassign the 13 ownership-bearing columns via a new `SECURITY DEFINER` RPC, cascade `time_entries`, and `SET NULL` the 12 attributive ones. A new server action `deleteOwnAccount` reuses the widened `platform_user_sole_owned_orgs` guard and `svc.auth.admin.deleteUser`, then tears down the session. The UI is one new `SettingRow` in the existing Danger zone. Because the ownership columns stay `NOT NULL`, the TypeScript blast radius is 2 files instead of ~18, and no RLS policy or `SECURITY DEFINER` function changes.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase Postgres + RLS, Zod, Vitest, shadcn/ui + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-25-delete-account-design.md`

---

## Read First

- `docs/superpowers/specs/2026-07-25-delete-account-design.md` — §2.1 and §2.2 explain why `SET NULL` and bot-reassignment are both wrong. Do not "simplify" the hybrid back to `SET NULL`; it causes org-wide data loss.
- `AGENTS.md` working agreements #4 (tests), #5 (perf budget), #6 (DAG).
- `vault/decisions/2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file.md` and
  `vault/decisions/2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file.md` — the migration ledger rules. Every migration in this plan is minted by `scripts/new-migration.sh` and applied via the `supabase-dev` MCP with the **same version + name**.
- In a worktree `pnpm db:types` throws `LegacyProjectNotLinkedError`. Regenerate types with the `supabase-dev` MCP `generate_typescript_types` tool, then `pnpm prettier --write src/types/database.types.ts`.

## Decision Points (defaults are already encoded below)

The spec §9 escalates four judgment calls to the owner. This plan implements the **defaults** so it is buildable without waiting. If the owner answers differently, these are the single points of change:

- **D1** `admin_audit_log.target_email` retained (Task 1 changes nothing; a purge job is a follow-up).
- **D2** `item_updates.author_id` reassigned to the **org owner** (Task 1, one `update` statement). If the owner picks the bot, swap that one statement for `set author_id = public.platform_agent_user_id()`.
- **D3** `time_entries.user_id` → `cascade` (Task 1).
- **D4** no notification to the receiving owner (Task 4 writes the audit rows only).

## File Structure

| File                                                                       | Responsibility                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/<stamp>_account_deletion_fks.sql` **(create)**        | The whole schema change: 12 FKs → `set null` (2 with a `drop not null`), 1 → `cascade`, 9 missing indexes, `user_delete_reassign_authorship()` + `_reassign_authorship_target()`, widened `platform_user_sole_owned_orgs()` gate. |
| `src/types/database.types.ts` **(regenerate)**                             | Generated types. Only `admin_audit_log.actor_id` and `feedback.submitted_by` widen to `string \| null`.                                                                                                                           |
| `src/lib/platform/queries.ts` **(modify)**                                 | `PlatformAuditRow.actor_id` widened.                                                                                                                                                                                              |
| `src/lib/feedback/actions.ts` **(modify)**                                 | Null guard before the `notifications` insert.                                                                                                                                                                                     |
| `src/lib/validations/account.ts` **(create)**                              | `deleteAccountSchema` — the Zod boundary.                                                                                                                                                                                         |
| `src/lib/account/actions.ts` **(create)**                                  | `deleteOwnAccount` server action: guard → reassign → audit → delete → sign out → redirect.                                                                                                                                        |
| `src/components/settings/delete-account.tsx` **(create)**                  | Client component: type-to-confirm dialog.                                                                                                                                                                                         |
| `src/app/(app)/settings/security/page.tsx` **(modify)**                    | Mounts the new `SettingRow`.                                                                                                                                                                                                      |
| `src/lib/account/account-deletion-schema.integration.test.ts` **(create)** | Schema-conformance tripwire: every `NOT NULL`/`NO ACTION` FK to `auth.users` is covered by the RPC.                                                                                                                               |
| `src/lib/account/delete-account.integration.test.ts` **(create)**          | Happy path, `readable_board_ids` regression guard, sole-owner refusal, cross-tenant isolation, RPC gate.                                                                                                                          |
| `src/lib/account/actions.test.ts` **(create)**                             | Unit: Zod + server-side email mismatch.                                                                                                                                                                                           |
| `src/components/settings/delete-account.test.tsx` **(create)**             | Unit: confirm gating, in-place error, dialog stays open.                                                                                                                                                                          |
| `src/lib/platform/platform-delete-user.integration.test.ts` **(create)**   | Regression test for the latent `platformDeleteUser` bug (spec §1 corollary).                                                                                                                                                      |

---

## Task 1: Migration — FK actions, nullability, indexes, reassignment RPC

**Files:**

- Create: `supabase/migrations/<stamp>_account_deletion_fks.sql` (stamp minted by the script — never hand-written)

- [ ] **Step 1: Mint the migration file**

```bash
cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/delete-account
scripts/new-migration.sh account_deletion_fks
```

Expected: prints the created path `supabase/migrations/20260725XXXXXX_account_deletion_fks.sql`. Note that exact `<stamp>_account_deletion_fks` string — you need it verbatim as the `name` in Step 3.

- [ ] **Step 2: Write the DDL**

Replace the generated header's `TODO` line and append the body. Full file content below the header comment:

```sql
-- Part A — the 10 already-nullable attributive columns: fix only the FK action.
-- Nullable already, so `src/types/database.types.ts` does not change for these.
alter table public.admin_audit_log
  drop constraint admin_audit_log_target_user_id_fkey,
  add  constraint admin_audit_log_target_user_id_fkey
       foreign key (target_user_id) references auth.users(id) on delete set null;

alter table public.automations
  drop constraint automations_created_by_fkey,
  add  constraint automations_created_by_fkey
       foreign key (created_by) references auth.users(id) on delete set null;

alter table public.board_agents
  drop constraint board_agents_created_by_fkey,
  add  constraint board_agents_created_by_fkey
       foreign key (created_by) references auth.users(id) on delete set null;

alter table public.boards
  drop constraint boards_archived_by_fkey,
  add  constraint boards_archived_by_fkey
       foreign key (archived_by) references auth.users(id) on delete set null;

alter table public.feedback
  drop constraint feedback_responded_by_fkey,
  add  constraint feedback_responded_by_fkey
       foreign key (responded_by) references auth.users(id) on delete set null;

alter table public.groups
  drop constraint groups_archived_by_fkey,
  add  constraint groups_archived_by_fkey
       foreign key (archived_by) references auth.users(id) on delete set null;

alter table public.item_activities
  drop constraint item_activities_actor_id_fkey,
  add  constraint item_activities_actor_id_fkey
       foreign key (actor_id) references auth.users(id) on delete set null;

alter table public.items
  drop constraint items_archived_by_fkey,
  add  constraint items_archived_by_fkey
       foreign key (archived_by) references auth.users(id) on delete set null;

alter table public.notifications
  drop constraint notifications_actor_id_fkey,
  add  constraint notifications_actor_id_fkey
       foreign key (actor_id) references auth.users(id) on delete set null;

alter table public.org_members
  drop constraint org_members_deactivated_by_fkey,
  add  constraint org_members_deactivated_by_fkey
       foreign key (deactivated_by) references auth.users(id) on delete set null;

-- Part B — two columns become nullable, because neither may be reassigned:
--   admin_audit_log.actor_id : reassigning would attribute one admin's action to another.
--   feedback.submitted_by    : personal input to Pulse; erasable. feedback_select already
--                              falls back to is_platform_admin(), so platform still reads it.
alter table public.admin_audit_log alter column actor_id drop not null;
alter table public.admin_audit_log
  drop constraint admin_audit_log_actor_id_fkey,
  add  constraint admin_audit_log_actor_id_fkey
       foreign key (actor_id) references auth.users(id) on delete set null;

alter table public.feedback alter column submitted_by drop not null;
alter table public.feedback
  drop constraint feedback_submitted_by_fkey,
  add  constraint feedback_submitted_by_fkey
       foreign key (submitted_by) references auth.users(id) on delete set null;

-- Part C — time_entries.user_id is a fact about the person, not authorship. Reassigning
-- would falsify who did the work. Its siblings time_allocations.user_id and
-- member_capacity.user_id are already `cascade`; this is consistency, not a new rule.
alter table public.time_entries
  drop constraint time_entries_user_id_fkey,
  add  constraint time_entries_user_id_fkey
       foreign key (user_id) references auth.users(id) on delete cascade;

-- Part D — the 9 reassignment/set-null target columns with no leading index today.
-- Without these, user_delete_reassign_authorship sequential-scans public.items twice.
create index if not exists items_created_by_idx        on public.items (created_by);
create index if not exists items_archived_by_idx       on public.items (archived_by);
create index if not exists groups_archived_by_idx      on public.groups (archived_by);
create index if not exists boards_archived_by_idx      on public.boards (archived_by);
create index if not exists goals_created_by_idx        on public.goals (created_by);
create index if not exists goals_owner_id_idx          on public.goals (owner_id);
create index if not exists member_capacity_created_by_idx on public.member_capacity (created_by);
create index if not exists feedback_responded_by_idx   on public.feedback (responded_by);
create index if not exists board_agents_created_by_idx on public.board_agents (created_by);

-- Part E — widen the sole-owner guard so a user may check *themselves*. One definition of
-- "sole owner", shared by the admin path and the self-serve path (AGENTS.md: reuse, don't clone).
create or replace function public.platform_user_sole_owned_orgs(p_user_id uuid)
returns table(org_id uuid, org_name text)
language plpgsql security definer set search_path to ''
as $$
begin
  if not (public.is_platform_admin() or p_user_id = (select auth.uid())) then
    raise exception 'not authorized';
  end if;
  return query
    select o.id, o.name
    from public.org_members m
    join public.organizations o on o.id = m.org_id
    where m.user_id = p_user_id
      and m.role = 'owner'
      and m.deactivated_at is null
      and (select count(*) from public.org_members m2
           where m2.org_id = m.org_id
             and m2.role = 'owner'
             and m2.deactivated_at is null) = 1;
end;
$$;
revoke all on function public.platform_user_sole_owned_orgs(uuid) from public, anon;
grant execute on function public.platform_user_sole_owned_orgs(uuid) to authenticated, service_role;

-- Part F — target resolver. Oldest surviving active owner of the org, never the leaver.
create or replace function public._reassign_authorship_target(p_org_id uuid, p_leaving uuid)
returns uuid
language plpgsql stable security definer set search_path to ''
as $$
declare v_target uuid;
begin
  select m.user_id into v_target
  from public.org_members m
  where m.org_id = p_org_id
    and m.role = 'owner'
    and m.deactivated_at is null
    and m.user_id <> p_leaving
  order by m.created_at asc
  limit 1;
  if v_target is null then
    raise exception 'no surviving active owner for org %', p_org_id;
  end if;
  return v_target;
end;
$$;
revoke all on function public._reassign_authorship_target(uuid, uuid) from public, anon, authenticated;

-- Part G — the single seam where authorship moves. Every statement is driven by the ROW's
-- own org_id (not by org_members), so rows left behind by an already-removed membership are
-- still covered. The 13 columns updated here stay NOT NULL / NO ACTION on purpose: if a
-- future migration adds an authorship column and nobody updates this function, the delete
-- fails loudly on a named constraint instead of silently orphaning data.
create or replace function public.user_delete_reassign_authorship(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_targets jsonb := '{}'::jsonb;
  v_n integer;
  r record;
begin
  if not (public.is_platform_admin() or p_user_id = (select auth.uid())) then
    raise exception 'not authorized';
  end if;

  update public.organizations o
     set created_by = public._reassign_authorship_target(o.id, p_user_id)
   where o.created_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('organizations', v_n);

  update public.workspaces t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('workspaces', v_n);

  update public.boards t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('boards', v_n);

  update public.items t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('items', v_n);

  update public.goals t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('goals_created_by', v_n);

  update public.goals t
     set owner_id = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.owner_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('goals_owner_id', v_n);

  update public.portfolios t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('portfolios', v_n);

  update public.dashboards t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('dashboards', v_n);

  update public.board_members t
     set granted_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.granted_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('board_members', v_n);

  update public.org_invitations t
     set invited_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.invited_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('org_invitations', v_n);

  update public.member_capacity t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('member_capacity', v_n);

  update public.attachments t
     set uploaded_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.uploaded_by = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('attachments', v_n);

  -- D2 default: authorship of updates moves to the org owner. To switch to the bot
  -- principal instead, replace the SET clause with
  --   set author_id = public.platform_agent_user_id()
  update public.item_updates t
     set author_id = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.author_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('item_updates', v_n);

  for r in select distinct m.org_id from public.org_members m where m.user_id = p_user_id loop
    v_targets := v_targets || jsonb_build_object(
      r.org_id::text, public._reassign_authorship_target(r.org_id, p_user_id)::text);
  end loop;

  return jsonb_build_object('counts', v_counts, 'targets', v_targets);
end;
$$;
revoke all on function public.user_delete_reassign_authorship(uuid) from public, anon;
grant execute on function public.user_delete_reassign_authorship(uuid) to authenticated, service_role;
```

- [ ] **Step 3: Apply to DEV via the MCP with the same version + name**

Call `mcp__supabase-dev__apply_migration` with `name` set to the **exact** `<stamp>_account_deletion_fks` from Step 1 (gotcha-55: a mismatched name drifts the ledger) and `query` set to the file's SQL.

- [ ] **Step 4: Verify the ledger and the applied state**

Run `mcp__supabase-dev__list_migrations` and confirm the top row's version matches the filename. Then `mcp__supabase-dev__execute_sql`:

```sql
select count(*) as remaining_no_action
from pg_constraint c
join pg_class src on src.oid = c.conrelid
join pg_namespace sn on sn.oid = src.relnamespace
join pg_class tgt on tgt.oid = c.confrelid
join pg_namespace tn on tn.oid = tgt.relnamespace
where c.contype = 'f' and tn.nspname = 'auth' and tgt.relname = 'users'
  and sn.nspname = 'public' and c.confdeltype = 'a';
```

Expected: `remaining_no_action` = **13** (the reassign columns, `NO ACTION` on purpose — spec §3.2). Before this migration it was 26. If the ledger version drifted from the filename, run `scripts/reconcile-migration-version.sh <ledger-version> <file-version>`.

- [ ] **Step 5: Prove deletion now works end-to-end, in a rolled-back transaction**

`mcp__supabase-dev__execute_sql`:

```sql
do $$
declare v_id uuid := gen_random_uuid(); v_owner uuid; v_org uuid; v_msg text; v_con text;
begin
  select m.user_id, m.org_id into v_owner, v_org
  from public.org_members m
  where m.role = 'owner' and m.deactivated_at is null limit 1;

  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at,
    updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token,
    recovery_token, email_change_token_new, email_change, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    'probe-'||v_id||'@example.com', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false,
    '', '', '', '', false, false);
  insert into public.org_members (org_id, user_id, role) values (v_org, v_id, 'member');
  insert into public.admin_audit_log (org_id, actor_id, actor_kind, action, target_user_id,
    target_email, metadata)
  values (null, v_id, 'user', 'probe.delete', v_id, 'probe@example.com', '{}'::jsonb);

  perform public.user_delete_reassign_authorship(v_id);
  delete from auth.users where id = v_id;
  raise exception 'PROBE: DELETE SUCCEEDED (expected) — rolling back';
exception
  when foreign_key_violation then
    get stacked diagnostics v_msg = message_text, v_con = constraint_name;
    raise exception 'PROBE FAILED: still blocked by [%] :: %', v_con, v_msg;
end $$;
```

Expected: the error message is exactly `PROBE: DELETE SUCCEEDED (expected) — rolling back`. Anything mentioning `PROBE FAILED` means a constraint is still blocking — read the named constraint and add the missing column to Part G. The `raise` rolls the whole block back either way, so DEV is unchanged.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<stamp>_account_deletion_fks.sql
git commit -m "feat(db): make account deletion possible via authorship reassignment"
```

---

## Task 2: Regenerate types and fix the two consumers

**Files:**

- Modify: `src/types/database.types.ts` (regenerate — never hand-edit)
- Modify: `src/lib/platform/queries.ts:105`
- Modify: `src/lib/feedback/actions.ts:111-136`

- [ ] **Step 1: Regenerate the types**

Call `mcp__supabase-dev__generate_typescript_types` and write the result to `src/types/database.types.ts`, then:

```bash
pnpm prettier --write src/types/database.types.ts
```

(`pnpm db:types` throws `LegacyProjectNotLinkedError` inside a worktree — use the MCP.)

- [ ] **Step 2: Confirm the diff is exactly two columns**

```bash
git diff --stat src/types/database.types.ts
git diff src/types/database.types.ts | grep -E '^[+-].*(actor_id|submitted_by)'
```

Expected: `admin_audit_log.actor_id` and `feedback.submitted_by` change from `string` to `string | null` (in `Row`, and to optional/nullable in `Insert`/`Update`). If any _other_ column changed nullability, stop — the migration did more than intended.

- [ ] **Step 3: Run typecheck to see the failures**

```bash
pnpm typecheck
```

Expected: FAIL in `src/lib/platform/queries.ts` (`actor_id: string` no longer assignable) and `src/lib/feedback/actions.ts` (`recipient_id` receives `string | null`).

- [ ] **Step 4: Widen `PlatformAuditRow`**

In `src/lib/platform/queries.ts`, inside `export type PlatformAuditRow` (~line 105):

```ts
actor_id: string | null;
```

- [ ] **Step 5: Guard the feedback notification**

In `src/lib/feedback/actions.ts`, the block that reads `row.submitted_by` (~lines 111-136) currently compares it and then uses it as `recipient_id`. Replace the ownership check and the insert with:

```ts
// submitted_by is nullable since account deletion nulls it (spec §3). A feedback row
// whose submitter is gone has no owner to notify and nobody to authorise.
if (row.submitted_by === null || row.submitted_by !== user.id) {
  return fail("Not authorized.");
}
const recipientId = row.submitted_by;
```

and use `recipient_id: recipientId` in the `notifications` insert.

- [ ] **Step 6: Verify the gates pass**

```bash
pnpm typecheck && pnpm lint
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/database.types.ts src/lib/platform/queries.ts src/lib/feedback/actions.ts
git commit -m "chore(types): regenerate for nullable actor_id/submitted_by"
```

---

## Task 3: Schema-conformance tripwire test

Guards spec §3.2: every `NOT NULL` + `NO ACTION` FK to `auth.users` must be handled by `user_delete_reassign_authorship`. A future authorship column fails this test instead of breaking deletion in production.

**Files:**

- Create: `src/lib/account/account-deletion-schema.integration.test.ts`

PostgREST cannot select from `pg_constraint`, so the catalog has to come through a small read-only definer function. That function is a prerequisite of the test, so it is built first.

- [ ] **Step 1: Mint and write the introspection migration**

```bash
scripts/new-migration.sh account_deletion_blocking_fks_view
```

DDL:

```sql
-- A read-only introspection helper so the test suite can assert the FK catalog.
create or replace function public.account_deletion_blocking_fks()
returns table(qualified_column text)
language sql stable security definer set search_path to ''
as $$
  select src.relname || '.' || a.attname
  from pg_constraint c
  join pg_class src on src.oid = c.conrelid
  join pg_namespace sn on sn.oid = src.relnamespace
  join pg_class tgt on tgt.oid = c.confrelid
  join pg_namespace tn on tn.oid = tgt.relnamespace
  join unnest(c.conkey) k(attnum) on true
  join pg_attribute a on a.attrelid = src.oid and a.attnum = k.attnum
  where c.contype = 'f' and tn.nspname = 'auth' and tgt.relname = 'users'
    and sn.nspname = 'public' and c.confdeltype = 'a' and a.attnotnull
  order by 1;
$$;
revoke all on function public.account_deletion_blocking_fks() from public, anon;
grant execute on function public.account_deletion_blocking_fks() to authenticated, service_role;
```

- [ ] **Step 2: Apply it and regenerate types**

Call `mcp__supabase-dev__apply_migration` with `name` = the exact `<stamp>_account_deletion_blocking_fks_view` from Step 1, then `mcp__supabase-dev__generate_typescript_types` into `src/types/database.types.ts` and `pnpm prettier --write src/types/database.types.ts`. The new function must appear under `Database["public"]["Functions"]["account_deletion_blocking_fks"]`.

- [ ] **Step 3: Write the failing test**

`src/lib/account/account-deletion-schema.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";

loadIntegrationEnv();

/**
 * The 13 columns that stay NOT NULL + NO ACTION are a deliberate tripwire (spec §3.2):
 * deletion only succeeds if user_delete_reassign_authorship() has emptied every one first.
 * If someone adds an authorship column and forgets the RPC, this test fails loudly instead
 * of account deletion silently breaking in production. When this list legitimately changes,
 * add the column to the RPC *and* to this list — in that order.
 */
const EXPECTED_REASSIGNED = [
  "attachments.uploaded_by",
  "board_members.granted_by",
  "boards.created_by",
  "dashboards.created_by",
  "goals.created_by",
  "goals.owner_id",
  "item_updates.author_id",
  "items.created_by",
  "member_capacity.created_by",
  "org_invitations.invited_by",
  "organizations.created_by",
  "portfolios.created_by",
  "workspaces.created_by",
].sort();

describe.skipIf(!integrationTargetReady())(
  "account deletion schema conformance",
  () => {
    const svc = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    it("every NOT NULL / NO ACTION FK to auth.users is one the reassignment RPC handles", async () => {
      const { data, error } = await svc.rpc("account_deletion_blocking_fks");
      expect(error).toBeNull();
      const actual = (data ?? []).map((r) => r.qualified_column).sort();
      expect(actual).toEqual(EXPECTED_REASSIGNED);
    });
  },
);
```

- [ ] **Step 4: Run it**

```bash
pnpm vitest run src/lib/account/account-deletion-schema.integration.test.ts
```

Expected on a target with Task 1 applied: PASS, 1 test. If it prints `skipped`, `.env.test` is missing — set it up per `CONTRIBUTING.md` → "Running integration tests"; a skip is **not** a pass. If it FAILS listing 26 columns, Task 1's migration has not reached that project yet.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<stamp>_account_deletion_blocking_fks_view.sql \
        src/types/database.types.ts \
        src/lib/account/account-deletion-schema.integration.test.ts
git commit -m "test(db): tripwire asserting every blocking FK is reassigned"
```

---

## Task 4: `deleteOwnAccount` server action

**Files:**

- Create: `src/lib/validations/account.ts`
- Create: `src/lib/account/actions.ts`
- Create: `src/lib/account/actions.test.ts`

**Interfaces — Consumes:** `user_delete_reassign_authorship(p_user_id uuid) → jsonb` and the widened `platform_user_sole_owned_orgs(p_user_id uuid)` (Task 1); `ActionResult`/`fail` from `src/lib/actions/result.ts`; `createClient` from `src/lib/supabase/server`; `createServiceClient` from `src/lib/supabase/service`.
**Produces:** `deleteOwnAccount(input: unknown): Promise<ActionResult>` — the exact signature Task 5 codes against.

- [ ] **Step 1: Write the Zod schema**

`src/lib/validations/account.ts`:

```ts
import { z } from "zod";

/** The typed confirmation is re-verified server-side against the session's own email. */
export const deleteAccountSchema = z.object({
  confirmEmail: z.string().email("Enter your email address to confirm."),
});
```

- [ ] **Step 2: Write the failing unit test**

`src/lib/account/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const rpc = vi.fn();
const deleteUser = vi.fn();
const signOut = vi.fn();
const redirectMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser, signOut }, rpc }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc,
    from: () => ({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    storage: {
      from: () => ({
        list: vi.fn().mockResolvedValue({ data: [] }),
        remove: vi.fn(),
      }),
    },
    auth: { admin: { deleteUser } },
  }),
}));

const { deleteOwnAccount } = await import("./actions");

describe("deleteOwnAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "me@example.com" } },
    });
    rpc.mockResolvedValue({ data: [], error: null });
    deleteUser.mockResolvedValue({ error: null });
  });

  it("rejects a malformed payload", async () => {
    const res = await deleteOwnAccount({ confirmEmail: "not-an-email" });
    expect(res).toEqual({
      ok: false,
      error: "Enter your email address to confirm.",
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("refuses a mismatched email even when the client says it matches", async () => {
    const res = await deleteOwnAccount({
      confirmEmail: "someone.else@example.com",
    });
    expect(res).toEqual({ ok: false, error: "That's not your email address." });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("matches the email case-insensitively and ignores surrounding space", async () => {
    await deleteOwnAccount({ confirmEmail: "  ME@Example.com  " });
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });

  it("refuses and does not delete when the user solely owns an org", async () => {
    rpc.mockImplementation((name: string) =>
      name === "platform_user_sole_owned_orgs"
        ? Promise.resolve({
            data: [{ org_id: "o1", org_name: "Acme" }],
            error: null,
          })
        : Promise.resolve({ data: {}, error: null }),
    );
    const res = await deleteOwnAccount({ confirmEmail: "me@example.com" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("Acme");
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("does not delete the auth user when reassignment fails", async () => {
    rpc.mockImplementation((name: string) =>
      name === "user_delete_reassign_authorship"
        ? Promise.resolve({
            data: null,
            error: { message: "no surviving active owner" },
          })
        : Promise.resolve({ data: [], error: null }),
    );
    const res = await deleteOwnAccount({ confirmEmail: "me@example.com" });
    expect(res.ok).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it and see it fail**

```bash
pnpm vitest run src/lib/account/actions.test.ts
```

Expected: FAIL — `Cannot find module './actions'`.

- [ ] **Step 4: Write the action**

`src/lib/account/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteAccountSchema } from "@/lib/validations/account";
import { fail, type ActionResult } from "@/lib/actions/result";

/**
 * Self-serve hard delete. Mirrors platformDeleteUser (src/lib/platform/actions.ts:213) —
 * same sole-owner guard, same audit-before-delete — with three differences that only apply
 * to deleting yourself: the confirmation is your own email (re-verified here, never trusted
 * from the client), authorship is reassigned to a surviving org owner before the delete, and
 * the session is torn down afterwards.
 *
 * Ordering is load-bearing: reassignment must precede the delete because the 13
 * ownership-bearing FKs are still NOT NULL / NO ACTION on purpose (spec §3.2), and signOut
 * must follow it because the delete needs an authenticated context.
 */
export async function deleteOwnAccount(input: unknown): Promise<ActionResult> {
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const typed = parsed.data.confirmEmail.trim().toLowerCase();
  if (!user.email || typed !== user.email.toLowerCase())
    return fail("That's not your email address.");

  const { data: soleOrgs, error: checkErr } = await supabase.rpc(
    "platform_user_sole_owned_orgs",
    { p_user_id: user.id },
  );
  if (checkErr) return fail("Could not verify org ownership.");
  if (soleOrgs && soleOrgs.length > 0) {
    const names = soleOrgs.map((o) => o.org_name).join(", ");
    return fail(
      `You're the only owner of ${names}. Make someone else an owner in Settings → Members first, or delete the organization.`,
    );
  }

  const svc = createServiceClient();

  const { data: summary, error: reassignErr } = await svc.rpc(
    "user_delete_reassign_authorship",
    { p_user_id: user.id },
  );
  if (reassignErr)
    return fail("Could not transfer your work to another owner.");

  // Audit BEFORE the delete so the rows survive; actor_id/target_user_id become null via
  // the new SET NULL FKs, target_email is what remains (spec §7, decision D1).
  const targets =
    (summary as { targets?: Record<string, string> } | null)?.targets ?? {};
  const auditRows = [
    {
      org_id: null as string | null,
      actor_id: user.id,
      actor_kind: "user",
      action: "account.self_deleted",
      target_user_id: user.id,
      target_email: user.email,
      metadata: (summary ?? {}) as Record<string, unknown>,
    },
    ...Object.keys(targets).map((orgId) => ({
      org_id: orgId as string | null,
      actor_id: user.id,
      actor_kind: "user",
      action: "account.self_deleted",
      target_user_id: user.id,
      target_email: user.email,
      metadata: (summary ?? {}) as Record<string, unknown>,
    })),
  ];
  await svc.from("admin_audit_log").insert(auditRows);

  // The avatar file has no FK to auth.users, so nothing else removes it (spec §7).
  // Best-effort: a storage failure must not abort the deletion.
  try {
    const { data: files } = await svc.storage.from("avatars").list(user.id);
    if (files?.length)
      await svc.storage
        .from("avatars")
        .remove(files.map((f) => `${user.id}/${f.name}`));
  } catch {
    // ignore — the account still gets deleted
  }

  const { error: delErr } = await svc.auth.admin.deleteUser(user.id);
  if (delErr) return fail("Could not delete your account.");

  // Access tokens are stateless JWTs, so deleting the row only revokes refresh tokens.
  // signOut is what clears the cookies; GoTrue may 401 for a now-nonexistent user.
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore — the cookie is worthless now; requireUser() will bounce to /login
  }

  redirect("/login?deleted=1");
}
```

- [ ] **Step 5: Run the tests and see them pass**

```bash
pnpm vitest run src/lib/account/actions.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/account.ts src/lib/account/actions.ts src/lib/account/actions.test.ts
git commit -m "feat(account): add deleteOwnAccount server action"
```

---

## Task 5: `DeleteAccount` client component

Can be built **in parallel with Task 4** — it codes against the declared signature `deleteOwnAccount(input: unknown): Promise<ActionResult>` only.

**Files:**

- Create: `src/components/settings/delete-account.tsx`
- Create: `src/components/settings/delete-account.test.tsx`

**Interfaces — Consumes:** `deleteOwnAccount` (Task 4). **Produces:** `<DeleteAccount email={string} />`.

- [ ] **Step 1: Write the failing test**

`src/components/settings/delete-account.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const deleteOwnAccount = vi.fn();
vi.mock("@/lib/account/actions", () => ({
  deleteOwnAccount: (...a: unknown[]) => deleteOwnAccount(...a),
}));

import { DeleteAccount } from "./delete-account";

describe("DeleteAccount", () => {
  beforeEach(() => vi.clearAllMocks());

  async function open() {
    const user = userEvent.setup();
    render(<DeleteAccount email="me@example.com" />);
    await user.click(screen.getByRole("button", { name: /delete account/i }));
    return user;
  }

  it("keeps the confirm button disabled until the email matches", async () => {
    const user = await open();
    const confirm = screen.getByRole("button", { name: /delete permanently/i });
    expect(confirm).toBeDisabled();
    const input = screen.getByLabelText(/type your email address to confirm/i);
    await user.type(input, "me@exampl");
    expect(confirm).toBeDisabled();
    await user.type(input, "e.com");
    expect(confirm).toBeEnabled();
  });

  it("matches case-insensitively and trims", async () => {
    const user = await open();
    await user.type(
      screen.getByLabelText(/type your email address to confirm/i),
      "  ME@Example.com  ",
    );
    expect(
      screen.getByRole("button", { name: /delete permanently/i }),
    ).toBeEnabled();
  });

  it("shows the server's refusal in place and keeps the dialog open", async () => {
    deleteOwnAccount.mockResolvedValue({
      ok: false,
      error: "You're the only owner of Acme.",
    });
    const user = await open();
    await user.type(
      screen.getByLabelText(/type your email address to confirm/i),
      "me@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: /delete permanently/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("only owner of Acme"),
    );
    expect(
      screen.getByLabelText(/type your email address to confirm/i),
    ).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
pnpm vitest run src/components/settings/delete-account.test.tsx
```

Expected: FAIL — `Cannot find module './delete-account'`.

- [ ] **Step 3: Write the component**

`src/components/settings/delete-account.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { deleteOwnAccount } from "@/lib/account/actions";
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

/**
 * Deleting your account is irreversible and takes your colleagues' view of your work with
 * it, so it sits behind a type-your-email confirm — the same pattern as the platform admin
 * delete (src/components/admin/user-row-actions.tsx). The server re-verifies the email; this
 * gate is only there to stop an accidental click.
 *
 * Failures render in place rather than as a toast: the sole-owner refusal is a paragraph the
 * user has to read and act on.
 */
export function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const matches = confirm.trim().toLowerCase() === email.toLowerCase();

  function submit() {
    setError(null);
    start(async () => {
      // On success the action redirects, so control never returns here.
      const res = await deleteOwnAccount({ confirmEmail: confirm.trim() });
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive border-destructive/40 hover:bg-destructive/10"
        onClick={() => {
          setConfirm("");
          setError(null);
          setOpen(true);
        }}
      >
        Delete account
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently erases your profile, email, avatar, notifications
              and tracked time. Boards, items, files and updates you created
              stay with your organization and are transferred to an owner. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={email}
              aria-label="Type your email address to confirm deletion"
              autoComplete="off"
              disabled={pending}
            />
            {error ? (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={submit}
              disabled={pending || !matches}
            >
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: Run the tests and see them pass**

```bash
pnpm vitest run src/components/settings/delete-account.test.tsx
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/delete-account.tsx src/components/settings/delete-account.test.tsx
git commit -m "feat(settings): add delete-account confirm dialog"
```

---

## Task 6: Wire the row into Settings → Security

**Files:**

- Modify: `src/app/(app)/settings/security/page.tsx:45-55`

**Interfaces — Consumes:** `<DeleteAccount email={string} />` (Task 5).

- [ ] **Step 1: Add the import**

After the existing `DangerZone` import (line 8):

```tsx
import { DeleteAccount } from "@/components/settings/delete-account";
```

- [ ] **Step 2: Add the second `SettingRow`**

Inside the existing `<SettingsSection title="Danger zone" …>`, immediately after the closing `</SettingRow>` of "Leave organization" (line 54):

```tsx
<SettingRow
  label="Delete account"
  description="Permanently delete your Pulse account and personal data. Boards, items and updates you created stay with your organization."
>
  <DeleteAccount email={user.email ?? ""} />
</SettingRow>
```

- [ ] **Step 3: Verify the gates**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run src/components/settings
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/settings/security/page.tsx"
git commit -m "feat(settings): surface delete account in the danger zone"
```

---

## Task 7: Integration suite

**Files:**

- Create: `src/lib/account/delete-account.integration.test.ts`

**Interfaces — Consumes:** the migration (Task 1) and `deleteOwnAccount` (Task 4). Copy the factory shape from `src/lib/org/admin.rls.integration.test.ts:50,76` — there is no shared factory in this repo, each suite defines its own.

- [ ] **Step 1: Write the failing tests**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { signInWithRetry } from "@/test/integration-auth";

loadIntegrationEnv();

const PW = "Test-Password-123!";
type TestUser = { id: string; email: string; anon: SupabaseClient<Database> };

describe.skipIf(!integrationTargetReady())(
  "self-serve account deletion",
  () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const admin = createClient<Database>(
      url,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
      },
    );
    const created: string[] = [];

    async function createUser(label: string): Promise<TestUser> {
      const email = `del-${label}-${randomUUID()}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PW,
        email_confirm: true,
      });
      if (error || !data.user) throw error ?? new Error("no user");
      created.push(data.user.id);
      const anon = createClient<Database>(url, anonKey, {
        auth: { persistSession: false },
      });
      await signInWithRetry(anon, email, PW);
      return { id: data.user.id, email, anon };
    }

    /** Owner creates the org; `member` joins it. Returns ids for assertions. */
    async function provisionOrg(owner: TestUser, label: string) {
      const { data: orgId, error } = await owner.anon.rpc(
        "create_organization",
        {
          p_name: `Del ${label}`,
          p_slug: `del-${label}-${randomUUID().slice(0, 8)}`,
        },
      );
      if (error) throw error;
      const { data: ws } = await owner.anon
        .from("workspaces")
        .insert({ org_id: orgId!, name: "WS", created_by: owner.id })
        .select("id")
        .single();
      return { orgId: orgId!, workspaceId: ws!.id };
    }

    let owner: TestUser;
    let leaver: TestUser;
    let orgId: string;
    let boardId: string;
    let itemId: string;

    beforeAll(async () => {
      owner = await createUser("owner");
      leaver = await createUser("leaver");
      const org = await provisionOrg(owner, "main");
      orgId = org.orgId;
      await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: leaver.id, role: "member" });

      // The leaver creates a board and an item, and is deliberately NOT added to
      // board_members — that is the 12-of-15 shape on DEV that makes SET NULL catastrophic.
      const { data: b, error: bErr } = await leaver.anon
        .from("boards")
        .insert({
          org_id: orgId,
          workspace_id: org.workspaceId,
          name: "Leaver board",
          created_by: leaver.id,
        })
        .select("id")
        .single();
      if (bErr) throw bErr;
      boardId = b!.id;
      const { data: g } = await leaver.anon
        .from("groups")
        .insert({ org_id: orgId, board_id: boardId, name: "G", position: 1 })
        .select("id")
        .single();
      const { data: i } = await leaver.anon
        .from("items")
        .insert({
          org_id: orgId,
          board_id: boardId,
          group_id: g!.id,
          name: "Item",
          created_by: leaver.id,
        })
        .select("id")
        .single();
      itemId = i!.id;
    });

    afterAll(async () => {
      for (const id of created)
        await admin.auth.admin.deleteUser(id).catch(() => {});
    });

    it("reassigns authorship to the surviving owner and deletes the auth user", async () => {
      const { error } = await admin.rpc("user_delete_reassign_authorship", {
        p_user_id: leaver.id,
      });
      expect(error).toBeNull();
      const { error: delErr } = await admin.auth.admin.deleteUser(leaver.id);
      expect(delErr).toBeNull();

      const { data: board } = await admin
        .from("boards")
        .select("created_by")
        .eq("id", boardId)
        .single();
      expect(board!.created_by).toBe(owner.id);
      const { data: item } = await admin
        .from("items")
        .select("created_by")
        .eq("id", itemId)
        .single();
      expect(item!.created_by).toBe(owner.id);
    });

    it("REGRESSION (spec §2.1): the reassigned board is still readable by the owner who has no board_members row", async () => {
      const { data: members } = await admin
        .from("board_members")
        .select("user_id")
        .eq("board_id", boardId)
        .eq("user_id", owner.id);
      expect(members ?? []).toHaveLength(0); // the whole point: no grant row

      const { data: readable, error } =
        await owner.anon.rpc("readable_board_ids");
      expect(error).toBeNull();
      expect(readable).toContain(boardId);

      const { data: items } = await owner.anon
        .from("items")
        .select("id")
        .eq("board_id", boardId);
      expect((items ?? []).map((r) => r.id)).toContain(itemId);
    });

    it("refuses a sole owner and mutates nothing", async () => {
      const solo = await createUser("solo");
      const org = await provisionOrg(solo, "solo");
      const { data: sole } = await solo.anon.rpc(
        "platform_user_sole_owned_orgs",
        {
          p_user_id: solo.id,
        },
      );
      expect((sole ?? []).map((o) => o.org_id)).toContain(org.orgId);

      const { error } = await admin.auth.admin.deleteUser(solo.id);
      expect(error).not.toBeNull(); // organizations_created_by_fkey still blocks
      const { data: still } = await admin.auth.admin.getUserById(solo.id);
      expect(still.user?.id).toBe(solo.id);
    });

    it("cannot be called for another user by a non-admin", async () => {
      const other = await createUser("other");
      const { error } = await other.anon.rpc(
        "user_delete_reassign_authorship",
        {
          p_user_id: owner.id,
        },
      );
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not authorized/i);
    });

    it("does not touch another org's rows", async () => {
      const outsider = await createUser("outsider");
      const otherOrg = await provisionOrg(outsider, "other");
      const { data: before } = await admin
        .from("organizations")
        .select("created_by")
        .eq("id", otherOrg.orgId)
        .single();

      const victim = await createUser("victim");
      await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: victim.id, role: "member" });
      await admin.rpc("user_delete_reassign_authorship", {
        p_user_id: victim.id,
      });

      const { data: after } = await admin
        .from("organizations")
        .select("created_by")
        .eq("id", otherOrg.orgId)
        .single();
      expect(after!.created_by).toBe(before!.created_by);
      expect(after!.created_by).toBe(outsider.id);
    });
  },
);
```

- [ ] **Step 2: Run and see it fail (or set up `.env.test` first)**

```bash
pnpm vitest run src/lib/account/delete-account.integration.test.ts
```

If it prints `skipped`, `.env.test` is missing — follow `CONTRIBUTING.md` → "Running integration tests (`.env.test`)". A skip is **not** a pass; working agreement #4 requires these to run.

Expected on a configured target: FAIL until Task 1's migration is applied to the test project (`supabase link --project-ref <test-ref> && supabase db push`, then relink to DEV).

- [ ] **Step 3: Make them pass**

Apply the migrations to the test project, re-run, and fix any real failure. The likely one is a missing `groups.position`/column default — read the error and adjust the fixture inserts, not the assertions.

```bash
pnpm vitest run src/lib/account/delete-account.integration.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/account/delete-account.integration.test.ts
git commit -m "test(account): integration coverage for self-serve deletion"
```

---

## Task 8: `platformDeleteUser` regression test

Guards the spec §1 corollary. Fully parallel to Tasks 4-7 — depends only on Task 1.

**Files:**

- Create: `src/lib/platform/platform-delete-user.integration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";

loadIntegrationEnv();

/**
 * platformDeleteUser wrote an admin_audit_log row with target_user_id = <victim> and then
 * called deleteUser. That FK was NO ACTION, so the action's own audit write blocked its own
 * delete — the admin "Delete permanently" button never worked. This asserts the fix.
 */
describe.skipIf(!integrationTargetReady())(
  "platform hard-delete after FK fix",
  () => {
    const admin = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const created: string[] = [];
    afterAll(async () => {
      for (const id of created)
        await admin.auth.admin.deleteUser(id).catch(() => {});
    });

    it("an audit row naming the user no longer blocks their deletion", async () => {
      const email = `plat-del-${randomUUID()}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      if (error || !data.user) throw error ?? new Error("no user");
      const id = data.user.id;
      created.push(id);

      const { error: auditErr } = await admin.from("admin_audit_log").insert({
        org_id: null,
        actor_id: id,
        actor_kind: "platform",
        action: "platform.user_deleted",
        target_user_id: id,
        target_email: email,
        metadata: {},
      });
      expect(auditErr).toBeNull();

      const { error: delErr } = await admin.auth.admin.deleteUser(id);
      expect(delErr).toBeNull();

      // The audit row survives with both pointers nulled and the email retained (spec §7 / D1).
      const { data: rows } = await admin
        .from("admin_audit_log")
        .select("actor_id, target_user_id, target_email")
        .eq("target_email", email);
      expect(rows).toHaveLength(1);
      expect(rows![0].actor_id).toBeNull();
      expect(rows![0].target_user_id).toBeNull();
      expect(rows![0].target_email).toBe(email);
    });
  },
);
```

- [ ] **Step 2: Run and see it fail against the pre-migration schema**

```bash
pnpm vitest run src/lib/platform/platform-delete-user.integration.test.ts
```

Expected before the migration reaches the test project: FAIL on `expect(delErr).toBeNull()`.

- [ ] **Step 3: Apply the migration to the test project and re-run**

```bash
pnpm vitest run src/lib/platform/platform-delete-user.integration.test.ts
```

Expected: PASS, 1 test.

- [ ] **Step 4: Commit**

```bash
git add src/lib/platform/platform-delete-user.integration.test.ts
git commit -m "test(platform): regression for the audit-row FK blocking hard delete"
```

---

## Task 9: Full gates, ledger hygiene, and finish

**Files:** none created — verification only.

- [ ] **Step 1: Ledger ↔ files check (gotcha-57, both directions)**

Call `mcp__supabase-dev__list_migrations` and compare against `ls supabase/migrations/`. Every DEV version must have a committed file and vice versa. A DEV-only version is drift, not a pending push — back-fill the file **at the DEV version**, do not mint a new stamp.

- [ ] **Step 2: Run all four gates**

```bash
cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/delete-account
rm -rf .next/types
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four PASS. (`rm -rf .next/types` first — the `cacheLife` typecheck-before-build trap.)

- [ ] **Step 3: Confirm the schema end state one last time**

`mcp__supabase-dev__execute_sql`:

```sql
select case c.confdeltype when 'a' then 'no action' when 'c' then 'cascade'
       when 'n' then 'set null' end as on_delete, count(*)
from pg_constraint c
join pg_class src on src.oid = c.conrelid
join pg_namespace sn on sn.oid = src.relnamespace
join pg_class tgt on tgt.oid = c.confrelid
join pg_namespace tn on tn.oid = tgt.relnamespace
where c.contype = 'f' and tn.nspname = 'auth' and tgt.relname = 'users' and sn.nspname = 'public'
group by 1 order by 1;
```

Expected: `cascade` 13, `no action` 13, `set null` 14. (Was: `cascade` 12, `no action` 26, `set null` 2.)

- [ ] **Step 4: Finish the task**

```bash
scripts/finish-task.sh
```

It rebases onto `develop`, re-runs the gates against the merged state, merges, pushes, and removes the worktree + branch.

- [ ] **Step 5: Hand the user the manual test walkthrough**

Paste §"How to test" (below) into the closing message and into the `/wrapup` session note.

---

## Execution DAG (working agreement #6)

**Dependency graph** (from the `Consumes`/`Produces` blocks):

```
T1 (migration) ──┬──> T2 (types + 2 consumers)
                 ├──> T3 (schema tripwire)
                 ├──> T4 (server action) ──┬──> T7 (integration suite)
                 └──> T8 (platform regression)
T5 (UI component, contract-only) ─────────────> T6 (settings wiring)
T2,T3,T4,T5,T6,T7,T8 ─────────────────────────> T9 (gates + finish)
```

**Parallel batches:**

| Batch | Tasks                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | T1                     | Serial root. Nothing else can start — every other task reads the new schema or the RPC signature.                                                                                                                                                                                                                                                                                                                  |
| **2** | **T2, T3, T4, T5, T8** | Five concurrent agents. T5 is in this batch because it consumes only the _declared_ signature of `deleteOwnAccount` (Task 4 "Produces"), not its implementation — contract-first. T2 and T3 both regenerate `src/types/database.types.ts`: **T3 owns that file** (it adds a migration, so it regenerates last); T2 must land first, or run T2 and T3 in separate worktrees and let T3's regeneration win on merge. |
| **3** | **T6, T7**             | T6 needs T5's component; T7 needs T4's action. Independent of each other.                                                                                                                                                                                                                                                                                                                                          |
| **4** | T9                     | Serial. Gates + ledger check + finish, run once.                                                                                                                                                                                                                                                                                                                                                                   |

**Critical path** (longest dependency chain = the wall-clock floor):

```
T1 → T4 → T7 → T9     (4 tasks)
```

Tied with `T1 → T5 → T6 → T9`, also 4. So the floor is **4 sequential tasks** even though there are 9 — batch 2 collapses five tasks into one wave. The migration (T1) is the only true bottleneck; everything downstream fans out.

**Worktree note:** T2 and T3 are the one file-collision risk in batch 2 (`src/types/database.types.ts`). Either sequence them inside a single agent, or give them isolated worktrees per `superpowers:using-git-worktrees` and merge T2 before T3.

---

## Performance & data-fetching budget (working agreement #5)

**(a) First paint vs. interaction.** No new first-paint cost: the new `SettingRow` renders `user.email`, already loaded by `requireUser()` at `src/app/(app)/settings/security/page.tsx:14`. Opening the dialog, typing, and enabling the button are **0 server round-trips** — local `useState` in a leaf client component. No `<Link>`, no `router.push`, no `searchParams` write, so no RSC re-run (gotcha-09).

**(b) Does the interaction change server data?** Only on submit: one Server Action, then a `redirect`. `revalidatePath` is deliberately omitted — the session ends, so there is nothing left to revalidate.

**(c) Bounded reads over indexed columns.** The sole-owner RPC is two bounded lookups on `org_members(org_id, user_id)`. The reassignment RPC issues 13 `UPDATE`s, each keyed on an FK column — and Task 1 Part D adds the **9 missing indexes** (notably `items_created_by_idx` and `items_archived_by_idx` on the 402-row-and-growing `items` table) so none of them sequential-scans. Deletion is a rare single-transaction operation with no hot path, but it must not be `O(table)` on the org's largest table.

---

## How to test (manual walkthrough for the user)

Setup: `git checkout develop && git pull && pnpm install && pnpm dev`. This runs against **DEV**.

1. **Create a throwaway account.** Sign up at `http://localhost:3000/signup` with a fresh address (e.g. `test-delete@example.com`) and complete onboarding so an organization is created. Note the org name.
2. **Try to delete while you are the only owner.** Go to `http://localhost:3000/settings/security`. Under **Danger zone** you now see two rows: "Leave organization" and **"Delete account"**. Click **Delete account**, type the account's email into the box, click **Delete permanently**.
   **Expected:** the dialog stays open and shows, in red beneath the input: _"You're the only owner of \<Org\>. Make someone else an owner in Settings → Members first, or delete the organization."_ You are still signed in. Nothing was deleted.
3. **Give the org a second owner.** Sign in as your normal account in another browser profile, or invite your normal address from the throwaway account (`/settings/members` → Invite), accept the invite, then set that member's role to **Owner**.
4. **Create some content as the throwaway user.** Back as the throwaway account, create a board, add a group and two items, and post an update on one item. This is the content whose authorship gets transferred.
5. **Delete the account.** `/settings/security` → **Delete account** → type the email → **Delete permanently**.
   **Expected:** you are signed out and land on `/login?deleted=1`. Try to sign in with that email and password — **expected:** it fails; the account no longer exists.
6. **Check what the organization sees.** Sign in as the surviving owner and open the board the deleted user created.
   **Expected:** the board is **still there and still opens**; the group and both items are intact; the item update is intact. In the board's share/settings menu you are now the **owner** and can archive, share and delete it. The deleted user's name no longer appears anywhere as a person — attributions show **your** name (or "Someone" for older file/update rows).
7. **Confirm the trash and nav paths.** Archive that board, open `/boards` → Trash.
   **Expected:** the board is listed and restorable. (This is the path that `SET NULL` would have broken — an ownerless board disappears from both the nav and Trash.)
8. **Check the audit trail.** As the surviving owner, open the org audit view.
   **Expected:** an `account.self_deleted` entry with the deleted user's email and a metadata blob of per-table transfer counts. The actor and target user columns are empty by design — the person is erased, the fact is not.
9. **Confirm the admin path works too** (the latent bug this fixes). As a platform admin, go to `/admin/users`, find any throwaway `@example.com` user, and use **Delete permanently** (type their email to confirm).
   **Expected:** it succeeds. Before this change it always failed with _"Could not delete the user."_
