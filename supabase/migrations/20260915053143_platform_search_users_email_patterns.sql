-- platform_search_users: filter by address family BEFORE pagination.
--
-- /admin/users paginated every account newest-first and only then split the
-- page into "people" vs "system & test accounts" in the app. A burst of seeded
-- browser-verification fixtures (37 `@example.com` rows on 2026-09-12) filled
-- page 0 completely, so the platform admin saw zero real users. The app must
-- be able to page through people alone, and list the non-customer accounts as
-- a separate bounded set — so the classification moves into the RPC as
-- optional ILIKE pattern lists. The patterns themselves stay single-sourced in
-- `src/lib/platform/test-accounts.ts` (NON_CUSTOMER_EMAIL_PATTERNS).
--
--   p_exclude_email_patterns  drop rows whose email matches ANY pattern
--   p_only_email_patterns     keep only rows whose email matches ANY pattern
--   null / empty              no filter (previous behaviour)
--
-- A NULL email never matches a pattern, so it is kept by "exclude" and dropped
-- by "only": an unknown address is treated as a person, never hidden.

drop function if exists public.platform_search_users(text, int, int);

create function public.platform_search_users(
  p_query text default '',
  p_limit int default 25,
  p_offset int default 0,
  p_exclude_email_patterns text[] default null,
  p_only_email_patterns text[] default null
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
    and (
      coalesce(cardinality(p_exclude_email_patterns), 0) = 0
      or not exists (
        select 1 from unnest(p_exclude_email_patterns) as x(pat)
        where u.email::text ilike x.pat
      )
    )
    and (
      coalesce(cardinality(p_only_email_patterns), 0) = 0
      or exists (
        select 1 from unnest(p_only_email_patterns) as x(pat)
        where u.email::text ilike x.pat
      )
    )
  group by u.id, u.email, u.banned_until, u.created_at
  order by u.created_at desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

grant execute on function
  public.platform_search_users(text, int, int, text[], text[])
  to authenticated;

-- `create function` grants EXECUTE to PUBLIC by default; the anon-reachability
-- conformance suite requires every public function to be unreachable by anon.
revoke all on function
  public.platform_search_users(text, int, int, text[], text[])
  from public, anon;
