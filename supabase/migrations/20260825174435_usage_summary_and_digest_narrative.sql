-- F17: bounded monthly usage rollup + cached digest narrative.
alter table public.digest_runs add column if not exists narrative text;

-- 6-month rollup over ai_usage_org_created_idx (org_id, created_at), bounded
-- by the caller's [from, to) window. Service-role only, mirroring
-- ai_credits_used_this_month's grants.
create or replace function public.ai_usage_summary(
  p_org uuid, p_from timestamptz, p_to timestamptz
) returns table (month timestamptz, credits numeric, cost_usd numeric, calls integer)
language sql security definer set search_path = public as $$
  select date_trunc('month', created_at) as month,
         coalesce(sum(credits), 0) as credits,
         coalesce(sum(cost_usd), 0) as cost_usd,
         count(*)::integer as calls
  from public.ai_usage
  where org_id = p_org and created_at >= p_from and created_at < p_to
  group by 1 order by 1;
$$;

-- This-month per-feature breakdown, same index, bounded to the current month.
create or replace function public.ai_usage_by_feature_this_month(p_org uuid)
returns table (feature text, credits numeric, calls integer)
language sql security definer set search_path = public as $$
  select feature, coalesce(sum(credits), 0) as credits, count(*)::integer as calls
  from public.ai_usage
  where org_id = p_org and created_at >= date_trunc('month', now())
  group by feature order by 2 desc;
$$;

revoke all on function public.ai_usage_summary(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.ai_usage_by_feature_this_month(uuid) from public, anon, authenticated;
grant execute on function public.ai_usage_summary(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.ai_usage_by_feature_this_month(uuid) to service_role;
