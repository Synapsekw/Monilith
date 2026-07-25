-- 20260725103609_account_deletion_reattribution_triggers.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Opens ONE narrow, audited hole in the two attribution-freeze triggers so the
--   account-deletion reassignment can actually land. Without this, the previous
--   migration's RPC is a SILENT NO-OP for two of its thirteen columns.
--
--   Discovered empirically, not from the spec: two BEFORE UPDATE triggers exist
--   specifically to make attribution immutable —
--     • public.items_protect_creation_metadata   (20260625120000_item_created_by)
--         new.created_by := old.created_by;
--     • public.item_updates_protect_attribution  (20260704111000_item_updates_freeze_author)
--         new.author_id  := old.author_id;
--   They rewrite the NEW row back to OLD, so `update ... set created_by = <owner>`
--   reports `row_count = 1` while changing nothing. The delete then dies on
--   `items_created_by_fkey` / `item_updates_author_id_fkey`. (That loud failure is
--   the §3.2 tripwire working as designed — it is how this was caught — but the
--   feature still has to work.)
--
--   Those triggers are real security hardening: they stop a board editor
--   re-attributing someone else's comment or item through the raw REST/RLS
--   surface. So they are NOT relaxed. Instead each grows one guarded branch that
--   opens only when THREE things hold at once:
--
--     1. `pulse.reassigning_authorship` is 'on'. This is a transaction-local GUC
--        (`set_config(..., is_local => true)`), set by exactly one function —
--        public.user_delete_reassign_authorship — and cleared before it returns.
--        A client cannot set it: PostgREST can only call functions in the exposed
--        schema, and `set_config` lives in `pg_catalog`, so there is no reachable
--        entrypoint. Being transaction-local, it also cannot leak into a later
--        request on a pooled connection.
--     2. The column is actually changing (otherwise fall through to the freeze).
--     3. The NEW value is a legal reassignment target for THAT row:
--          items        → an active `owner` of the row's own org
--          item_updates → the platform bot principal, and nothing else
--        This is the real protection. Even if condition 1 were somehow forged,
--        the only reachable outcome is the exact transition account deletion
--        performs — never "re-attribute Bob's comment to me".
--
--   Every other frozen column (`items.created_at`, `item_updates.org_id`,
--   `board_id`, `item_id`) stays frozen on the sanctioned path too, so the hole
--   is authorship-only and cannot be used to move a row between boards or orgs.

-- ── items.created_by ─────────────────────────────────────────────────────────
create or replace function public.items_protect_creation_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('pulse.reassigning_authorship', true), '') = 'on'
     and new.created_by is distinct from old.created_by
     and exists (
       select 1
       from public.org_members m
       where m.org_id = old.org_id
         and m.user_id = new.created_by
         and m.role = 'owner'
         and m.deactivated_at is null
     )
  then
    -- Sanctioned reassignment: creator may move to a surviving active owner of
    -- this row's own org. created_at is still frozen.
    new.created_at := old.created_at;
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

revoke execute on function public.items_protect_creation_metadata()
  from public, anon, authenticated;

-- ── item_updates.author_id ───────────────────────────────────────────────────
create or replace function public.item_updates_protect_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('pulse.reassigning_authorship', true), '') = 'on'
     and new.author_id is distinct from old.author_id
     and new.author_id = public.platform_agent_user_id()
  then
    -- Sanctioned reassignment (decision D2): authorship of the words moves to the
    -- platform bot and NOWHERE else. Scoping columns remain frozen, so this can
    -- never be used to move an update to another board, item or org.
    new.org_id   := old.org_id;
    new.board_id := old.board_id;
    new.item_id  := old.item_id;
    return new;
  end if;

  new.author_id := old.author_id;
  new.org_id    := old.org_id;
  new.board_id  := old.board_id;
  new.item_id   := old.item_id;
  return new;
end;
$$;

revoke execute on function public.item_updates_protect_attribution()
  from public, anon, authenticated;

-- ── Don't churn the embedding queue on a pure re-attribution ──────────────────
-- Both enqueue triggers fire on ANY update. Re-attribution changes no embeddable
-- text (`items.name`, `item_updates.body` are untouched), so re-embedding a
-- departing member's entire back-catalogue would burn tokens for an identical
-- vector. Only the reassignment path is skipped; every ordinary update still
-- enqueues, which is what item_embed_queue.rls.integration.test.ts asserts.
create or replace function public.tg_enqueue_item_embed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if coalesce(current_setting('pulse.reassigning_authorship', true), '') = 'on' then
    return null;
  end if;
  insert into public.item_embed_queue (item_id, org_id, board_id)
  values (new.id, new.org_id, new.board_id)
  on conflict (item_id) do nothing;
  return null;
end;
$$;

create or replace function public.tg_enqueue_comment_embed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if coalesce(current_setting('pulse.reassigning_authorship', true), '') = 'on' then
    return null;
  end if;
  insert into public.item_embed_queue (item_id, org_id, board_id)
  values (new.item_id, new.org_id, new.board_id)
  on conflict (item_id) do nothing;
  return null;
end;
$$;

revoke execute on function public.tg_enqueue_item_embed() from public, anon, authenticated;
revoke execute on function public.tg_enqueue_comment_embed() from public, anon, authenticated;

-- ── Set the flag in the one function allowed to ───────────────────────────────
-- Identical to 20260725102934's definition except for the two set_config calls.
-- `is_local => true` scopes the flag to this transaction, so it is impossible for
-- it to outlive the RPC even if the caller's transaction later does other work.
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
  -- Gate: platform admin, or you asking about yourself. NULL-tolerant by design —
  -- `auth.uid()` is NULL for `service_role`/`postgres`, the trusted server-side
  -- principals that already bypass RLS everywhere; `anon` cannot reach this at
  -- all because EXECUTE is revoked from it.
  if not (public.is_platform_admin() or p_user_id = (select auth.uid())) then
    raise exception 'not authorized';
  end if;

  perform set_config('pulse.reassigning_authorship', 'on', true);

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
  -- by a surviving owner. It is the truthful attribution ("no longer attributable
  -- to a person") and it grants nobody edit authority over another person's words.
  -- Safe here — and ONLY here — because `item_updates` is gated by
  -- `author_id = auth.uid() OR can_edit_board(board_id)`, so board editors keep
  -- full control regardless. Unlike `boards.created_by`, this column is not
  -- visibility-load-bearing, which is exactly why the bot (zero org memberships →
  -- would make boards invisible) is disqualified for ownership yet correct here.
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

  perform set_config('pulse.reassigning_authorship', '', true);

  return jsonb_build_object('counts', v_counts, 'targets', v_targets);
end;
$$;

revoke all on function public.user_delete_reassign_authorship(uuid) from public, anon;
grant execute on function public.user_delete_reassign_authorship(uuid) to authenticated, service_role;
