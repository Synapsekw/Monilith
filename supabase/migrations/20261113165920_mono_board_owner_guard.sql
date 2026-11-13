-- 20261113165920_mono_board_owner_guard.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Two review fixes for 20261113164732_mono_board_membership.
--
--   1. board_members_guard_mono checked `granted_by = owner` but never the
--      caller. "board_members: owner inserts" lets any board creator insert a
--      grant, so Ben could insert Nova (Ada's Mono) onto his board with
--      granted_by = Ada through PostgREST. Now, when a Mono row is inserted, or
--      an update changes its user_id / board_id / granted_by, a signed-in
--      caller must be the Mono's owner. A null auth.uid() (service role,
--      cron, definer paths with no session) is not checked here. The
--      follow-owner cascade only changes access_level, and the account-deletion
--      re-attribution keeps its earlier early return, so both still pass.
--
--   2. "boards: update if can edit" lets any board editor, a Mono included,
--      rewrite boards.created_by: take over the board, or strip its creator's
--      implicit access while keeping an editor row. created_by is now frozen to
--      privileged callers (postgres / supabase_admin / service_role). Our
--      postgres-owned SECURITY DEFINER functions (user_delete_reassign_authorship)
--      run as postgres and keep working. The trigger function is SECURITY
--      INVOKER on purpose (same pattern as tg_profiles_freeze_agent): as a
--      definer, current_user would always be its owner and every caller would pass.
--      No app code writes boards.created_by after insert.

create or replace function public.tg_board_members_guard_mono()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_org uuid; v_level public.board_access; v_uid uuid := (select auth.uid());
begin
  select m.owner_id, m.org_id into v_owner, v_org from public.monos m where m.user_id = new.user_id;
  if v_owner is null then return new; end if;
  -- Account deletion re-attributes granted_by to a surviving org owner
  -- (user_delete_reassign_authorship); that rewrite must not be refused.
  if tg_op = 'UPDATE' and coalesce(current_setting('pulse.reassigning_authorship', true), '') = 'on' then
    return new;
  end if;
  -- Only the owner may put their Mono on a board (or move/re-attribute its grant).
  if v_uid is not null
     and (tg_op = 'INSERT'
          or new.user_id is distinct from old.user_id
          or new.board_id is distinct from old.board_id
          or new.granted_by is distinct from old.granted_by)
     and v_uid is distinct from v_owner then
    raise exception 'only its owner can add a Mono to a board' using errcode = '42501';
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

create or replace function public.tg_boards_freeze_created_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.created_by is distinct from old.created_by
     and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'a board''s creator cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_boards_freeze_created_by() from public, anon, authenticated;

create trigger boards_freeze_created_by
  before update on public.boards
  for each row execute function public.tg_boards_freeze_created_by();
