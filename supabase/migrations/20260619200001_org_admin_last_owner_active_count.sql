-- 20260619200001_org_admin_last_owner_active_count.sql
-- Fix: last-owner protection must count only ACTIVE owners.
--
-- In 20260619200000, set_member_role / remove_member / platform_set_org_role
-- counted ALL owners (role='owner') for the last-owner guard, including
-- deactivated ones. A deactivated owner has no powers (has_org_role /
-- is_org_member / auth_user_orgs all exclude deactivated_at is not null), so
-- counting them can leave an org with zero usable owners: e.g. 1 active owner A
-- + 1 deactivated owner B (count=2) lets a demote/remove of A pass the guard.
-- These three RPCs now match deactivate_member and count only owners with
-- deactivated_at is null. Bodies are otherwise verbatim from the original.
-- deactivate_member is already correct and is intentionally not touched.

-- set_member_role ────────────────────────────────────────────────────────────
create or replace function public.set_member_role(
  p_org_id uuid, p_user_id uuid, p_new_role public.org_role
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role public.org_role;
  v_target_role public.org_role;
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
  -- Owner-supreme: an admin may not touch an owner/admin or grant owner/admin.
  if v_actor_role = 'admin' and (v_target_role in ('owner','admin') or p_new_role in ('owner','admin')) then
    raise exception 'admins cannot manage owners or admins' using errcode='42501';
  end if;
  -- Last-owner protection (active owners only).
  if v_target_role = 'owner' and p_new_role <> 'owner' then
    select count(*) into v_owner_count from public.org_members where org_id = p_org_id and role='owner' and deactivated_at is null;
    if v_owner_count <= 1 then raise exception 'cannot demote the last owner' using errcode='P0001'; end if;
  end if;
  update public.org_members set role = p_new_role where org_id = p_org_id and user_id = p_user_id;
  perform public._admin_audit(p_org_id, v_actor, 'org', 'member.role_changed',
    p_user_id, null, jsonb_build_object('from', v_target_role, 'to', p_new_role));
end; $$;
grant execute on function public.set_member_role(uuid, uuid, public.org_role) to authenticated;

-- remove_member ──────────────────────────────────────────────────────────────
create or replace function public.remove_member(p_org_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
  perform public._admin_audit(p_org_id, v_actor, 'org', 'member.removed', p_user_id, v_target_email, '{}'::jsonb);
end; $$;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- platform_set_org_role (assign/revoke any role in any org) ───────────────────
create or replace function public.platform_set_org_role(
  p_org_id uuid, p_user_id uuid, p_role public.org_role
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_target_role public.org_role; v_owner_count int; v_action text;
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select role into v_target_role from public.org_members where org_id = p_org_id and user_id = p_user_id;
  if v_target_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from public.org_members where org_id = p_org_id and role='owner' and deactivated_at is null;
    if v_owner_count <= 1 then raise exception 'cannot demote the last owner' using errcode='P0001'; end if;
  end if;
  insert into public.org_members (org_id, user_id, role)
    values (p_org_id, p_user_id, p_role)
    on conflict (org_id, user_id) do update set role = excluded.role;
  v_action := case
    when p_role = 'admin' then 'org_admin.assigned'
    when v_target_role = 'admin' then 'org_admin.revoked'
    else 'member.role_changed' end;
  perform public._admin_audit(p_org_id, v_actor, 'platform', v_action, p_user_id, null,
    jsonb_build_object('from', v_target_role, 'to', p_role));
end; $$;
grant execute on function public.platform_set_org_role(uuid, uuid, public.org_role) to authenticated;
