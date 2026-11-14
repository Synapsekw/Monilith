-- 20261113164732_mono_board_membership.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   A Mono's board access follows its owner: a board_members row for a Mono
--   is accepted only when its owner granted it, on a board in the Mono's org
--   that the owner can open, at the owner's own access level. The Mono's row
--   follows the owner's row (level change / removal). Adds the owner-facing
--   RPCs add_my_mono_to_board / remove_my_mono_from_board.

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
