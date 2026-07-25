-- 20260725102934_account_deletion_fks.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Makes deleting an `auth.users` row possible at all. Before this migration,
--   26 of the 40 `public` FKs to `auth.users` were `ON DELETE NO ACTION`, and
--   `organizations.created_by` (NOT NULL, not deferrable) blocked EVERY delete
--   unconditionally — so neither the admin "Delete permanently" button nor any
--   self-serve path could ever work. Verified empirically on DEV in a rolled-back
--   transaction; see docs/superpowers/specs/2026-07-25-delete-account-design.md §1.
--
--   The fix is a per-column hybrid, assigned by what the column MEANS rather
--   than by its nullability (spec §3):
--     • 13 ownership-bearing columns  → reassigned by an RPC, and deliberately
--                                       kept NOT NULL / NO ACTION (§3.2).
--     • 1  personal record            → `cascade` (time_entries).
--     • 12 attributive columns        → `set null` (2 of them newly nullable).
--   `set null` on the 13 ownership columns is DISQUALIFIED: `boards.created_by`
--   IS the ownership record (there is no owner grant row), and it gates
--   `readable_board_ids()` / `can_edit_board()`, which in turn gate items,
--   groups, item_activities, time_entries and automations. On DEV, 12 of 15
--   boards have no `board_members` row for their own creator, so nulling
--   `created_by` would make those boards and everything on them permanently
--   unreadable by anybody. Reassigning to the platform bot has the same effect
--   for the same reason (the bot has zero org memberships), so ownership must
--   move to a real, active, org-member human.

-- ── Part A — the 10 already-nullable attributive columns ─────────────────────
-- Only the FK action is wrong. These are nullable today, so
-- `src/types/database.types.ts` does not change for any of them.

alter table public.admin_audit_log
  drop constraint admin_audit_log_target_user_id_fkey,
  add  constraint admin_audit_log_target_user_id_fkey
       foreign key (target_user_id) references auth.users (id) on delete set null;

alter table public.automations
  drop constraint automations_created_by_fkey,
  add  constraint automations_created_by_fkey
       foreign key (created_by) references auth.users (id) on delete set null;

alter table public.board_agents
  drop constraint board_agents_created_by_fkey,
  add  constraint board_agents_created_by_fkey
       foreign key (created_by) references auth.users (id) on delete set null;

alter table public.boards
  drop constraint boards_archived_by_fkey,
  add  constraint boards_archived_by_fkey
       foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.feedback
  drop constraint feedback_responded_by_fkey,
  add  constraint feedback_responded_by_fkey
       foreign key (responded_by) references auth.users (id) on delete set null;

alter table public.groups
  drop constraint groups_archived_by_fkey,
  add  constraint groups_archived_by_fkey
       foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.item_activities
  drop constraint item_activities_actor_id_fkey,
  add  constraint item_activities_actor_id_fkey
       foreign key (actor_id) references auth.users (id) on delete set null;

alter table public.items
  drop constraint items_archived_by_fkey,
  add  constraint items_archived_by_fkey
       foreign key (archived_by) references auth.users (id) on delete set null;

alter table public.notifications
  drop constraint notifications_actor_id_fkey,
  add  constraint notifications_actor_id_fkey
       foreign key (actor_id) references auth.users (id) on delete set null;

alter table public.org_members
  drop constraint org_members_deactivated_by_fkey,
  add  constraint org_members_deactivated_by_fkey
       foreign key (deactivated_by) references auth.users (id) on delete set null;

-- ── Part B — two columns become nullable, because neither may be reassigned ───
--   admin_audit_log.actor_id : reassigning would attribute one admin's action to
--                              another. Audit integrity forbids it.
--   feedback.submitted_by    : personal input to Pulse, erasable. `feedback_select`
--                              already falls back to is_platform_admin(), so the
--                              platform still reads the row.

alter table public.admin_audit_log alter column actor_id drop not null;
alter table public.admin_audit_log
  drop constraint admin_audit_log_actor_id_fkey,
  add  constraint admin_audit_log_actor_id_fkey
       foreign key (actor_id) references auth.users (id) on delete set null;

alter table public.feedback alter column submitted_by drop not null;
alter table public.feedback
  drop constraint feedback_submitted_by_fkey,
  add  constraint feedback_submitted_by_fkey
       foreign key (submitted_by) references auth.users (id) on delete set null;

-- ── Part C — time_entries: cascade ───────────────────────────────────────────
-- `user_id` here is a fact about the PERSON, not authorship: reassigning it would
-- falsify who did the work. Its two siblings `time_allocations.user_id` and
-- `member_capacity.user_id` are already `cascade`, so this is consistency, not a
-- new rule (spec §3, decision D3).

alter table public.time_entries
  drop constraint time_entries_user_id_fkey,
  add  constraint time_entries_user_id_fkey
       foreign key (user_id) references auth.users (id) on delete cascade;

-- ── Part D — the 9 reassignment/set-null target columns with no leading index ─
-- Measured on DEV: without these, user_delete_reassign_authorship() sequential-
-- scans public.items TWICE per deletion, and that is the fastest-growing table.
-- Deletion is rare and has no hot path, but it must not be O(table).

create index if not exists items_created_by_idx           on public.items (created_by);
create index if not exists items_archived_by_idx          on public.items (archived_by);
create index if not exists groups_archived_by_idx         on public.groups (archived_by);
create index if not exists boards_archived_by_idx         on public.boards (archived_by);
create index if not exists goals_created_by_idx           on public.goals (created_by);
create index if not exists goals_owner_id_idx             on public.goals (owner_id);
create index if not exists member_capacity_created_by_idx on public.member_capacity (created_by);
create index if not exists feedback_responded_by_idx      on public.feedback (responded_by);
create index if not exists board_agents_created_by_idx    on public.board_agents (created_by);

-- ── Part E — widen the sole-owner guard so a user may check THEMSELVES ───────
-- One definition of "sole owner", shared by the admin path (platformDeleteUser)
-- and the new self-serve path. AGENTS.md: reuse the canonical module, don't clone
-- it. The only change is the authorization line.

create or replace function public.platform_user_sole_owned_orgs(p_user_id uuid)
returns table (org_id uuid, org_name text)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  -- Widened from `is_platform_admin()` only: a user may ask this about themselves.
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
      and (
        select count(*)
        from public.org_members m2
        where m2.org_id = m.org_id
          and m2.role = 'owner'
          and m2.deactivated_at is null
      ) = 1;
end;
$$;

revoke all on function public.platform_user_sole_owned_orgs(uuid) from public, anon;
grant execute on function public.platform_user_sole_owned_orgs(uuid) to authenticated, service_role;

-- ── Part F — target resolver ─────────────────────────────────────────────────
-- The oldest surviving ACTIVE owner of the org, never the leaver. Internal
-- (`_`-prefixed), so it stays revoked from `authenticated` per the definer
-- execution lockdown convention.

create or replace function public._reassign_authorship_target(p_org_id uuid, p_leaving uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_target uuid;
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
    -- Belt-and-braces behind the sole-owner guard: the RPC can never
    -- half-reassign, because the whole transaction aborts here.
    raise exception 'no surviving active owner for org %', p_org_id;
  end if;

  return v_target;
end;
$$;

revoke all on function public._reassign_authorship_target(uuid, uuid) from public, anon, authenticated;
grant execute on function public._reassign_authorship_target(uuid, uuid) to service_role;

-- ── Part G — the single seam where authorship moves ──────────────────────────
-- Every statement is driven by the ROW's own org_id (not by org_members), so
-- rows left behind by an already-removed membership are still covered.
--
-- The 13 columns updated here stay NOT NULL / NO ACTION on purpose (spec §3.2):
-- if a future migration adds an authorship column and nobody updates this
-- function, deletion fails LOUDLY on a named constraint instead of silently
-- orphaning org data. `account_deletion_blocking_fks()` turns that into an
-- automated schema-driven test rather than a hope.

create or replace function public.user_delete_reassign_authorship(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_counts  jsonb := '{}'::jsonb;
  v_targets jsonb := '{}'::jsonb;
  v_bot     uuid;
  v_n       integer;
  r         record;
begin
  if not (public.is_platform_admin() or p_user_id = (select auth.uid())) then
    raise exception 'not authorized';
  end if;

  update public.organizations o
     set created_by = public._reassign_authorship_target(o.id, p_user_id)
   where o.created_by = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('organizations', v_n);

  update public.workspaces t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('workspaces', v_n);

  update public.boards t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('boards', v_n);

  update public.items t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('items', v_n);

  update public.goals t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('goals_created_by', v_n);

  update public.goals t
     set owner_id = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.owner_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('goals_owner_id', v_n);

  update public.portfolios t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('portfolios', v_n);

  update public.dashboards t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('dashboards', v_n);

  update public.board_members t
     set granted_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.granted_by = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('board_members', v_n);

  update public.org_invitations t
     set invited_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.invited_by = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('org_invitations', v_n);

  update public.member_capacity t
     set created_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.created_by = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('member_capacity', v_n);

  update public.attachments t
     set uploaded_by = public._reassign_authorship_target(t.org_id, p_user_id)
   where t.uploaded_by = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('attachments', v_n);

  -- Decision D2: the words a person wrote are inherited by the platform BOT, not
  -- by a surviving owner. Rationale: it is the truthful attribution ("no longer
  -- attributable to a person"), and it grants nobody edit authority over another
  -- person's words. It is safe here — and ONLY here — precisely because
  -- `item_updates` is gated by `author_id = auth.uid() OR can_edit_board(board_id)`,
  -- so board editors keep full control regardless. Unlike `boards.created_by`,
  -- this column is not visibility-load-bearing, which is why the same bot that is
  -- disqualified for ownership columns (zero org memberships → invisible boards)
  -- is the right principal here.
  v_bot := public.platform_agent_user_id();
  if v_bot is null then
    raise exception 'platform agent principal is missing — cannot reattribute item_updates';
  end if;

  update public.item_updates t
     set author_id = v_bot
   where t.author_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('item_updates', v_n);

  -- Per-org receiving owner, for the audit metadata and the D4 notification.
  for r in select distinct m.org_id from public.org_members m where m.user_id = p_user_id loop
    v_targets := v_targets || jsonb_build_object(
      r.org_id::text, public._reassign_authorship_target(r.org_id, p_user_id)::text);
  end loop;

  return jsonb_build_object('counts', v_counts, 'targets', v_targets);
end;
$$;

revoke all on function public.user_delete_reassign_authorship(uuid) from public, anon;
grant execute on function public.user_delete_reassign_authorship(uuid) to authenticated, service_role;

-- ── Part H — notification kind for decision D4 ───────────────────────────────
-- Inheriting ownership of someone else's boards should surface, not sit in an
-- audit view nobody opens. The row is system-authored (`actor_id` is null, which
-- is legal), so it reuses the existing bell UI with no new table.
-- `add value` is safe in this transaction because nothing here USES the new value.
alter type public.notification_kind add value if not exists 'account_deleted';
