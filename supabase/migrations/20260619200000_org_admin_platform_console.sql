-- 20260619200000_org_admin_platform_console.sql
-- Org admin console + platform super-admin. See spec 2026-06-19-org-admin-and-platform-console-design.md.

-- ── New tables ──────────────────────────────────────────────────────────────

-- Cross-tenant superpower. Seeded by this migration (idempotent email lookup).
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Pending/accepted/revoked org invitations.
create table public.org_invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  email       text not null,
  role        public.org_role not null default 'member',
  invited_by  uuid not null references auth.users (id),
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'revoked')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index org_invitations_pending_uq
  on public.org_invitations (org_id, lower(email))
  where status = 'pending';
create index org_invitations_org_id_idx on public.org_invitations (org_id);
create index org_invitations_email_idx  on public.org_invitations (lower(email));

-- Append-only audit of every privileged action. org_id null = platform-level.
create table public.admin_audit_log (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references public.organizations (id) on delete cascade,
  actor_id       uuid not null references auth.users (id),
  actor_kind     text not null check (actor_kind in ('org', 'platform')),
  action         text not null,
  target_user_id uuid references auth.users (id),
  target_email   text,
  metadata       jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index admin_audit_log_org_created_idx
  on public.admin_audit_log (org_id, created_at desc);

-- ── Changed table: deactivation ─────────────────────────────────────────────
alter table public.org_members
  add column deactivated_at  timestamptz,
  add column deactivated_by  uuid references auth.users (id);

-- ── Deactivation-aware membership helpers (blast radius: every org RLS policy) ─
create or replace function public.auth_user_orgs()
returns setof uuid language sql security definer stable set search_path = '' as $$
  select org_id from public.org_members
  where user_id = (select auth.uid()) and deactivated_at is null;
$$;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = (select auth.uid())
      and deactivated_at is null
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles public.org_role[])
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = (select auth.uid())
      and role = any (p_roles) and deactivated_at is null
  );
$$;

-- ── Platform gate ───────────────────────────────────────────────────────────
create function public.is_platform_admin()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins where user_id = (select auth.uid())
  );
$$;
grant execute on function public.is_platform_admin() to authenticated;

-- ── Internal audit writer (called only from definer RPCs) ────────────────────
create function public._admin_audit(
  p_org_id uuid, p_actor uuid, p_actor_kind text, p_action text,
  p_target_user uuid, p_target_email text, p_metadata jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into public.admin_audit_log
    (org_id, actor_id, actor_kind, action, target_user_id, target_email, metadata)
  values (p_org_id, p_actor, p_actor_kind, p_action, p_target_user, p_target_email,
          coalesce(p_metadata, '{}'::jsonb));
$$;

-- ── Members read (joins auth.users; gated to org admins OR platform admin) ────
create function public.get_org_members(p_org_id uuid, p_limit int default 50, p_offset int default 0)
returns table (
  user_id uuid, email text, full_name text, role public.org_role,
  deactivated_at timestamptz, created_at timestamptz
) language sql security definer set search_path = '' as $$
  select m.user_id, u.email::text, (u.raw_user_meta_data ->> 'full_name'),
         m.role, m.deactivated_at, m.created_at
  from public.org_members m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id
    and (
      public.has_org_role(p_org_id, array['owner','admin']::public.org_role[])
      or public.is_platform_admin()
    )
  order by m.created_at
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;
grant execute on function public.get_org_members(uuid, int, int) to authenticated;

-- set_member_role ────────────────────────────────────────────────────────────
create function public.set_member_role(
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
  -- Last-owner protection.
  if v_target_role = 'owner' and p_new_role <> 'owner' then
    select count(*) into v_owner_count from public.org_members where org_id = p_org_id and role='owner';
    if v_owner_count <= 1 then raise exception 'cannot demote the last owner' using errcode='P0001'; end if;
  end if;
  update public.org_members set role = p_new_role where org_id = p_org_id and user_id = p_user_id;
  perform public._admin_audit(p_org_id, v_actor, 'org', 'member.role_changed',
    p_user_id, null, jsonb_build_object('from', v_target_role, 'to', p_new_role));
end; $$;
grant execute on function public.set_member_role(uuid, uuid, public.org_role) to authenticated;

-- remove_member ──────────────────────────────────────────────────────────────
create function public.remove_member(p_org_id uuid, p_user_id uuid)
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
    select count(*) into v_owner_count from public.org_members where org_id = p_org_id and role='owner';
    if v_owner_count <= 1 then raise exception 'cannot remove the last owner' using errcode='P0001'; end if;
  end if;
  select email::text into v_target_email from auth.users where id = p_user_id;
  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
  perform public._admin_audit(p_org_id, v_actor, 'org', 'member.removed', p_user_id, v_target_email, '{}'::jsonb);
end; $$;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- deactivate_member / reactivate_member ──────────────────────────────────────
create function public.deactivate_member(p_org_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role public.org_role; v_target_role public.org_role; v_owner_count int;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select role into v_actor_role from public.org_members
    where org_id = p_org_id and user_id = v_actor and deactivated_at is null;
  if v_actor_role is null or v_actor_role not in ('owner','admin') then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select role into v_target_role from public.org_members where org_id = p_org_id and user_id = p_user_id;
  if v_target_role is null then raise exception 'member not found' using errcode='P0002'; end if;
  if v_actor_role = 'admin' and v_target_role in ('owner','admin') then
    raise exception 'admins cannot deactivate owners or admins' using errcode='42501';
  end if;
  if v_target_role = 'owner' then
    select count(*) into v_owner_count from public.org_members
      where org_id = p_org_id and role='owner' and deactivated_at is null;
    if v_owner_count <= 1 then raise exception 'cannot deactivate the last active owner' using errcode='P0001'; end if;
  end if;
  update public.org_members set deactivated_at = now(), deactivated_by = v_actor
    where org_id = p_org_id and user_id = p_user_id;
  perform public._admin_audit(p_org_id, v_actor, 'org', 'member.deactivated', p_user_id, null, '{}'::jsonb);
end; $$;
grant execute on function public.deactivate_member(uuid, uuid) to authenticated;

create function public.reactivate_member(p_org_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role public.org_role; v_target_role public.org_role;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select role into v_actor_role from public.org_members
    where org_id = p_org_id and user_id = v_actor and deactivated_at is null;
  if v_actor_role is null or v_actor_role not in ('owner','admin') then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select role into v_target_role from public.org_members where org_id = p_org_id and user_id = p_user_id;
  if v_target_role is null then raise exception 'member not found' using errcode='P0002'; end if;
  if v_actor_role = 'admin' and v_target_role in ('owner','admin') then
    raise exception 'admins cannot manage owners or admins' using errcode='42501';
  end if;
  update public.org_members set deactivated_at = null, deactivated_by = null
    where org_id = p_org_id and user_id = p_user_id;
  perform public._admin_audit(p_org_id, v_actor, 'org', 'member.reactivated', p_user_id, null, '{}'::jsonb);
end; $$;
grant execute on function public.reactivate_member(uuid, uuid) to authenticated;

-- platform_set_org_role (assign/revoke any role in any org) ───────────────────
create function public.platform_set_org_role(
  p_org_id uuid, p_user_id uuid, p_role public.org_role
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_target_role public.org_role; v_owner_count int; v_action text;
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select role into v_target_role from public.org_members where org_id = p_org_id and user_id = p_user_id;
  if v_target_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from public.org_members where org_id = p_org_id and role='owner';
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

-- redeem_invitations (called by auth callback before provision) ───────────────
create function public.redeem_invitations()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text; v_count int := 0;
begin
  if v_uid is null then return 0; end if;
  select email::text into v_email from auth.users where id = v_uid;
  if v_email is null then return 0; end if;
  with redeemed as (
    update public.org_invitations
       set status = 'accepted', accepted_at = now()
     where status = 'pending' and lower(email) = lower(v_email)
     returning org_id, role
  ), inserted as (
    insert into public.org_members (org_id, user_id, role)
    select org_id, v_uid, role from redeemed
    on conflict (org_id, user_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end; $$;
grant execute on function public.redeem_invitations() to authenticated;

-- ── RLS for new tables + org_members hardening ───────────────────────────────

-- platform_admins: RLS on, NO policies → default-deny for all clients.
-- Readable only via is_platform_admin() (definer) / service role.
alter table public.platform_admins enable row level security;

-- org_invitations
alter table public.org_invitations enable row level security;
create policy "org_invitations: read by org admins or platform"
  on public.org_invitations for select to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]) or public.is_platform_admin());
create policy "org_invitations: insert by org admins"
  on public.org_invitations for insert to authenticated
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "org_invitations: update by org admins"
  on public.org_invitations for update to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- admin_audit_log: read by org admins (their org) or platform admin (all incl. null org).
-- No insert/update/delete policies → only definer RPCs / service role write (append-only).
alter table public.admin_audit_log enable row level security;
create policy "admin_audit_log: read by org admins or platform"
  on public.admin_audit_log for select to authenticated
  using (
    (org_id is not null and public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
    or public.is_platform_admin()
  );

-- org_members hardening: role/removal changes flow only through the guarded RPCs.
-- VERIFY these names against 20260614174043_init_auth_tenancy.sql before running.
drop policy if exists "org_members: update if owner/admin" on public.org_members;
drop policy if exists "org_members: delete if owner/admin or self" on public.org_members;
create policy "org_members: delete self only"
  on public.org_members for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── Seed the bootstrap platform admin ────────────────────────────────────────
insert into public.platform_admins (user_id)
select id from auth.users where email = 'danijel@synapse-solutions.ai'
on conflict (user_id) do nothing;
