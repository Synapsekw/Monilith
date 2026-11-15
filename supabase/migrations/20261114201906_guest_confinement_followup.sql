-- 20261114201906_guest_confinement_followup.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (follow-up to 20261114135114_guest_confinement):
--   1. workspaces: a guest can no longer update (rename) a workspace. The
--      delete policy is already owner/admin only, so it is left alone.
--   2. report_boards: guests read none and cannot insert, update or delete.
--   3. board_agents / board_agent_runs / board_agent_fires: readable only by
--      someone who can read the agent's board, not by every org member.
--   4. Monos: a guest cannot create one, and a Mono whose owner is a guest is
--      treated as a guest itself (is_org_guest, auth_user_full_orgs), so a
--      bot never sees more than its owner. tg_block_guest_insert calls
--      is_org_guest, so it blocks such a bot without change.
--   5. remove_member also drops the removed person's folder access in that org
--      and revokes their pending folder invitations, so access does not
--      silently return if they rejoin. Deactivation is unchanged.
-- Every policy is altered in place (name and roles kept); every function keeps
-- its live signature, language, volatility, security definer, search_path and
-- grants. No new functions.

-- 1. Workspaces -------------------------------------------------------------
alter policy "workspaces: update if member" on public.workspaces
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (public.is_org_member(org_id) and not public.is_org_guest(org_id));

-- 2. report_boards ----------------------------------------------------------
alter policy report_boards_select_member on public.report_boards
  using (org_id in (select public.auth_user_full_orgs()));

alter policy report_boards_insert_member on public.report_boards
  with check (
    public.is_org_member(org_id)
    and public.report_in_org(report_id, org_id)
    and public.board_in_org(board_id, org_id)
    and not public.is_org_guest(org_id)
  );

alter policy report_boards_update_member on public.report_boards
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (
    public.is_org_member(org_id)
    and public.report_in_org(report_id, org_id)
    and public.board_in_org(board_id, org_id)
    and not public.is_org_guest(org_id)
  );

alter policy report_boards_delete_member on public.report_boards
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id));

-- 3. Board agents: gated on board access ------------------------------------
-- can_read_board already requires active org membership.
alter policy board_agents_select on public.board_agents
  using (public.can_read_board(board_id));

alter policy board_agent_runs_select on public.board_agent_runs
  using (public.can_read_board(board_id));

-- board_agent_fires has no board_id: reach the board through its agent.
alter policy board_agent_fires_select on public.board_agent_fires
  using (exists (
    select 1 from public.board_agents a
     where a.id = board_agent_fires.board_agent_id
       and public.can_read_board(a.board_id)
  ));

-- 4. Monos ------------------------------------------------------------------
-- (b) A Mono ('agent' member) whose owner is a guest in that org is a guest.
-- Reads org_members and monos directly (never calls itself): no recursion.
-- The owner's guest role counts even while deactivated, so a bot cannot
-- outlive its owner's confinement.
create or replace function public.is_org_guest(p_org_id uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = (select auth.uid())
      and role = 'guest' and deactivated_at is null
  ) or exists (
    select 1 from public.org_members am
      join public.monos m on m.user_id = am.user_id and m.org_id = am.org_id
      join public.org_members oo on oo.org_id = m.org_id and oo.user_id = m.owner_id
    where am.org_id = p_org_id and am.user_id = (select auth.uid())
      and am.role = 'agent' and am.deactivated_at is null
      and oo.role = 'guest'
  );
$$;

-- The caller's orgs where they are not a guest — a guest-owned Mono excluded.
create or replace function public.auth_user_full_orgs()
returns setof uuid
language sql
stable security definer
set search_path = ''
as $$
  select om.org_id from public.org_members om
  where om.user_id = (select auth.uid()) and om.deactivated_at is null and om.role <> 'guest'
    and not (om.role = 'agent' and exists (
      select 1 from public.monos m
        join public.org_members oo on oo.org_id = m.org_id and oo.user_id = m.owner_id
      where m.user_id = om.user_id and m.org_id = om.org_id and oo.role = 'guest'
    ));
$$;

-- (a) A guest cannot own a Mono.
create or replace function public.create_mono(p_org_id uuid, p_owner_id uuid, p_mono_id uuid, p_name text, p_color text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare v_existing uuid; v_email text;
begin
  if exists (
    select 1 from public.org_members om
     where om.org_id = p_org_id and om.user_id = p_owner_id and om.role = 'guest'
  ) then
    raise exception 'guests cannot create a Mono' using errcode = '42501';
  end if;

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
  -- GoTrue's admin createUser inserts the auth row before it writes
  -- app_metadata, so handle_new_user never sees pre_approved and files the bot
  -- as pending; org_members_require_approved_account then refuses it. A Mono
  -- is a system identity this service-role-only function has just verified,
  -- so approve its account here, before the membership insert.
  insert into public.account_approvals (user_id, status, decided_at)
  values (p_mono_id, 'approved', now())
  on conflict (user_id) do update
    set status = 'approved', decided_at = coalesce(public.account_approvals.decided_at, now());
  insert into public.org_members (org_id, user_id, role) values (p_org_id, p_mono_id, 'agent');
  return p_mono_id;
end $function$;

-- 5. Removal drops folder access --------------------------------------------
create or replace function public.remove_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role public.org_role;
  v_target_role public.org_role;
  v_target_email text;
  v_owner_count int;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select role into v_actor_role from public.org_members
    where org_id = p_org_id and user_id = v_actor and deactivated_at is null;
  if v_actor_role is null or v_actor_role not in ('owner','admin') then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select role into v_target_role from public.org_members
    where org_id = p_org_id and user_id = p_user_id;
  if v_target_role is null then raise exception 'member not found' using errcode='P0002'; end if;
  if v_actor_role = 'admin' and v_target_role in ('owner','admin') then
    raise exception 'admins cannot remove owners or admins' using errcode='42501';
  end if;
  if v_target_role = 'owner' then
    select count(*) into v_owner_count from public.org_members where org_id = p_org_id and role='owner' and deactivated_at is null;
    if v_owner_count <= 1 then raise exception 'cannot remove the last owner' using errcode='P0001'; end if;
  end if;
  select email::text into v_target_email from auth.users where id = p_user_id;
  -- Folder access ends with the membership, so it cannot return on a rejoin.
  delete from public.folder_members where org_id = p_org_id and user_id = p_user_id;
  if v_target_email is not null then
    update public.folder_invitations set status = 'revoked'
     where org_id = p_org_id and status = 'pending'
       and lower(email) = lower(v_target_email);
  end if;
  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
  perform public._admin_audit(p_org_id, v_actor, 'org', 'member.removed', p_user_id, v_target_email, '{}'::jsonb);
end; $function$;
