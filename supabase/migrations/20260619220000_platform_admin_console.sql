-- 20260619220000_platform_admin_console.sql
-- Platform admin console reads: aggregate stats + filtered/paginated user search.
-- Both SECURITY DEFINER + search_path='' + fail-closed via is_platform_admin().

create function public.platform_stats()
returns table (orgs bigint, users bigint, admins bigint, events_24h bigint)
language sql security definer set search_path = '' as $$
  select
    (select count(*) from public.organizations),
    (select count(*) from auth.users),
    (select count(*) from public.platform_admins),
    (select count(*) from public.admin_audit_log
      where created_at > now() - interval '24 hours')
  where public.is_platform_admin();
$$;
grant execute on function public.platform_stats() to authenticated;

-- ilike user search with each user's org names; recent-first; empty query = recent.
create function public.platform_search_users(
  p_query text default '', p_limit int default 25, p_offset int default 0
)
returns table (
  id uuid, email text, banned_until timestamptz, created_at timestamptz,
  org_names text[]
)
language sql security definer set search_path = '' as $$
  select u.id, u.email::text, u.banned_until, u.created_at,
    coalesce(
      array_agg(o.name order by o.name) filter (where o.name is not null),
      '{}'::text[]
    ) as org_names
  from auth.users u
  left join public.org_members m on m.user_id = u.id
  left join public.organizations o on o.id = m.org_id
  where public.is_platform_admin()
    and (coalesce(p_query, '') = '' or u.email ilike '%' || p_query || '%')
  group by u.id, u.email, u.banned_until, u.created_at
  order by u.created_at desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;
grant execute on function public.platform_search_users(text, int, int) to authenticated;
