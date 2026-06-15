-- Phase 1 — Auth & tenancy baseline
-- Multi-tenant core: profiles, organizations, org_members, workspaces.
-- RLS on every table, default deny. Org-scoped policies use SECURITY DEFINER
-- helper functions to read membership WITHOUT triggering RLS recursion.

-- ============================================================================
-- Enums
-- ============================================================================
create type public.org_role as enum ('owner', 'admin', 'member', 'guest');

-- ============================================================================
-- Tables
-- ============================================================================

-- profiles: 1:1 mirror of auth.users for app-visible identity data.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- organizations: tenant root. Every tenant-scoped row hangs off an org.
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- org_members: membership + role. Composite PK (one row per user per org).
create table public.org_members (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.org_role not null default 'member',
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_id_idx on public.org_members (user_id);

-- workspaces: org-scoped container (boards live under workspaces in Phase 2).
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index workspaces_org_id_idx on public.workspaces (org_id);

-- ============================================================================
-- Helper functions (SECURITY DEFINER → bypass RLS, preventing policy recursion)
-- ============================================================================

create or replace function public.auth_user_orgs()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select org_id from public.org_members where user_id = (select auth.uid());
$$;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles public.org_role[])
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id
      and user_id = (select auth.uid())
      and role = any (p_roles)
  );
$$;

create or replace function public.shares_org_with(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.org_members me
    join public.org_members them on me.org_id = them.org_id
    where me.user_id = (select auth.uid()) and them.user_id = p_user
  );
$$;

-- ============================================================================
-- Triggers
-- ============================================================================

-- Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at fresh on row updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RPC: create an organization + owner membership atomically.
-- SECURITY DEFINER avoids the RLS chicken-and-egg (can't insert membership for
-- an org you are not yet a member of).
-- ============================================================================
create or replace function public.create_organization(p_name text, p_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (p_name, p_slug, v_uid)
  returning * into v_org;

  insert into public.org_members (org_id, user_id, role)
  values (v_org.id, v_uid, 'owner');

  return v_org;
end;
$$;

-- ============================================================================
-- Row Level Security — enable + default-deny on every table
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.organizations  enable row level security;
alter table public.org_members    enable row level security;
alter table public.workspaces     enable row level security;

-- profiles ------------------------------------------------------------------
create policy "profiles: read self or co-members"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_org_with(id));

create policy "profiles: update self"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- organizations -------------------------------------------------------------
create policy "organizations: read if member"
  on public.organizations for select to authenticated
  using (public.is_org_member(id));

create policy "organizations: update if owner/admin"
  on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.org_role[]));

create policy "organizations: delete if owner"
  on public.organizations for delete to authenticated
  using (public.has_org_role(id, array['owner']::public.org_role[]));

-- org_members ---------------------------------------------------------------
create policy "org_members: read if member"
  on public.org_members for select to authenticated
  using (public.is_org_member(org_id));

create policy "org_members: insert if owner/admin"
  on public.org_members for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create policy "org_members: update if owner/admin"
  on public.org_members for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create policy "org_members: delete if owner/admin or self"
  on public.org_members for delete to authenticated
  using (
    public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
    or user_id = (select auth.uid())
  );

-- workspaces ----------------------------------------------------------------
create policy "workspaces: read if member"
  on public.workspaces for select to authenticated
  using (public.is_org_member(org_id));

create policy "workspaces: insert if member"
  on public.workspaces for insert to authenticated
  with check (public.is_org_member(org_id) and created_by = (select auth.uid()));

create policy "workspaces: update if member"
  on public.workspaces for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy "workspaces: delete if owner/admin"
  on public.workspaces for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- ============================================================================
-- Grants — RLS is the security boundary; grant DML to authenticated role.
-- ============================================================================
grant select, insert, update, delete
  on public.profiles, public.organizations, public.org_members, public.workspaces
  to authenticated;

grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.auth_user_orgs() to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;
