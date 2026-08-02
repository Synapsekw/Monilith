-- 20260801092356_ai_usage_cache_tokens.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds nullable cache_read_tokens/cache_write_tokens to ai_usage and rebuilds
--   record_ai_usage with two defaulted trailing params, so the usage ledger can
--   record Anthropic prompt-cache tokens once caching is enabled.

-- Cache-aware metering. Anthropic reports cache reads/writes as separate token
-- buckets from input_tokens (which is the UNCACHED remainder), so pricing that
-- ignores them under-bills once prompt caching is enabled.
alter table public.ai_usage
  add column if not exists cache_read_tokens integer,
  add column if not exists cache_write_tokens integer;

-- Drop before create: a different argument list would create an OVERLOAD
-- rather than replacing the function, leaving an ambiguous PostgREST RPC.
drop function if exists public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric
);

create function public.record_ai_usage(
  p_org uuid, p_user uuid, p_feature text, p_provider text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_credits numeric,
  p_cache_read_tokens integer default 0, p_cache_write_tokens integer default 0
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage
    (org_id, user_id, feature, provider, model, input_tokens, output_tokens,
     cost_usd, credits, cache_read_tokens, cache_write_tokens)
  values
    (p_org, p_user, p_feature, p_provider, p_model, p_input_tokens, p_output_tokens,
     p_cost_usd, p_credits, coalesce(p_cache_read_tokens, 0), coalesce(p_cache_write_tokens, 0));
$$;

-- Grants do not survive the drop — re-assert them for the NEW signature.
revoke all on function public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric, integer, integer
) from public, anon, authenticated;
grant execute on function public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric, integer, integer
) to service_role;
