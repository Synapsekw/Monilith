-- Signup approval: every new account waits for a platform admin.
-- Spec: docs/superpowers/specs/2026-11-13-signup-approval-design.md
--
-- Additive for existing accounts: all of them are backfilled as approved.
-- Takes effect on apply for NEW accounts: they start pending, and the trigger
-- on org_members refuses to give a pending account a membership.

-- 1. Where the status lives. Not on profiles: a user may update their own
--    profile row, so a flag there would be self-writable.
create table public.account_approvals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'pending'
    constraint account_approvals_status_check
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null
);

comment on table public.account_approvals is
  'Whether a platform admin has approved an account. Service role and definer functions only; no client role may read or write it.';

-- The admin page lists pending accounts newest first.
create index account_approvals_pending_idx
  on public.account_approvals (created_at desc)
  where status = 'pending';

-- Default deny: RLS on, no policies, no client privileges.
alter table public.account_approvals enable row level security;
revoke all on table public.account_approvals from public, anon, authenticated;
grant all on table public.account_approvals to service_role;

-- 2. Nobody who already has an account is locked out.
insert into public.account_approvals (user_id, status, decided_at)
select u.id, 'approved', now()
from auth.users u
on conflict (user_id) do nothing;

-- 3. Every new account gets a row. `raw_app_meta_data` can only be set through
--    the admin API (a person signing up controls `raw_user_meta_data` only), so
--    `pre_approved` is how fixtures and end-to-end specs start approved.
--    `create or replace` keeps the function's existing ACL.
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

  insert into public.account_approvals (user_id, status, decided_at)
  values (
    new.id,
    case when new.raw_app_meta_data ->> 'pre_approved' = 'true' then 'approved' else 'pending' end,
    case when new.raw_app_meta_data ->> 'pre_approved' = 'true' then now() else null end
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- 4. The database-level rule. Every path that grants access to tenant data
--    creates an org_members row, so one trigger covers provisioning, creating
--    an organization, redeeming and accepting invitations, and any later path.
create function public.enforce_account_approved_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.account_approvals a
    where a.user_id = new.user_id
      and a.status = 'approved'
  ) then
    raise exception 'account_not_approved'
      using errcode = 'P0001',
            hint = 'A platform admin must approve this account before it can join an organization.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_account_approved_membership() from public, anon, authenticated;

create trigger org_members_require_approved_account
  before insert on public.org_members
  for each row execute function public.enforce_account_approved_membership();

-- 5. The admin user search also reports the approval status and can filter on
--    it. The return type changes, so the function is dropped and recreated.
--    The added parameter has a default, so callers that do not pass it keep
--    working.
drop function if exists public.platform_search_users(text, int, int, text[], text[]);

create function public.platform_search_users(
  p_query text default '',
  p_limit int default 25,
  p_offset int default 0,
  p_exclude_email_patterns text[] default null,
  p_only_email_patterns text[] default null,
  p_only_status text default null
)
returns table (
  id uuid,
  email text,
  banned_until timestamptz,
  created_at timestamptz,
  org_names text[],
  approval_status text
)
language sql
security definer
set search_path = ''
as $$
  select
    u.id,
    u.email::text,
    u.banned_until,
    u.created_at,
    coalesce(array_agg(o.name order by o.name) filter (where o.name is not null), '{}'::text[]) as org_names,
    coalesce(a.status, 'pending') as approval_status
  from auth.users u
  left join public.org_members m on m.user_id = u.id
  left join public.organizations o on o.id = m.org_id
  left join public.account_approvals a on a.user_id = u.id
  where public.is_platform_admin()
    and (coalesce(p_query, '') = '' or u.email ilike '%' || p_query || '%')
    and (
      coalesce(cardinality(p_exclude_email_patterns), 0) = 0
      or not exists (
        select 1 from unnest(p_exclude_email_patterns) as x(pat) where u.email::text ilike x.pat
      )
    )
    and (
      coalesce(cardinality(p_only_email_patterns), 0) = 0
      or exists (
        select 1 from unnest(p_only_email_patterns) as x(pat) where u.email::text ilike x.pat
      )
    )
    and (p_only_status is null or coalesce(a.status, 'pending') = p_only_status)
  group by u.id, u.email, u.banned_until, u.created_at, a.status
  order by u.created_at desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

grant execute on function public.platform_search_users(text, int, int, text[], text[], text) to authenticated;
revoke all on function public.platform_search_users(text, int, int, text[], text[], text) from public, anon;
