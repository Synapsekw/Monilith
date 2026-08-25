-- 20260825173356_drop_unused_ai_credential_overloads_add_price_checks.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   1) Drops the 1-arg `ai_credential_get(uuid)` and `org_ai_secret_get(uuid)`
--      overloads. These were left in place by 20260810173752_ai_provider_registry
--      (see its comment ~line 264-271) as "DEAD after Task 8 but deliberately
--      NOT dropped" — that migration minted the 2-arg per-provider overloads
--      and said a follow-up migration would drop the 1-arg forms once nothing
--      called them. Verified before dropping: `grep -rn` across src/ and
--      supabase/migrations/ shows every app call site
--      (src/lib/ai/credentials.ts, src/lib/ai/gateway.ts, and their tests)
--      already uses the 2-arg (p_user/p_org, p_provider) signature; a live
--      pg_proc/prosrc scan on DEV found no function whose body calls either
--      1-arg form. Both were already service_role-only (grants restricted in
--      20260706164829_user_ai_credentials.sql /
--      20260711163714_ai_platform_foundation.sql), so this is a pure
--      dead-code removal, not a behavior change.
--   2) Adds `CHECK (... >= 0)` constraints on the four ai_models price columns
--      (input_price_per_mtok, output_price_per_mtok, cache_read_price_per_mtok,
--      cache_write_price_per_mtok — confirmed via information_schema.columns
--      on DEV; all nullable numeric, no existing check constraint on them, and
--      no negative rows present today) so a bad catalog refresh or manual edit
--      can't silently store a negative price.

-- ---------------------------------------------------------------------------
-- 1. Drop the dead 1-arg overloads.
-- ---------------------------------------------------------------------------
drop function if exists public.ai_credential_get(uuid);
drop function if exists public.org_ai_secret_get(uuid);

-- ---------------------------------------------------------------------------
-- 2. Non-negative price constraints on ai_models.
-- ---------------------------------------------------------------------------
alter table public.ai_models
  drop constraint if exists ai_models_input_price_per_mtok_check;
alter table public.ai_models
  add constraint ai_models_input_price_per_mtok_check
    check (input_price_per_mtok >= 0);

alter table public.ai_models
  drop constraint if exists ai_models_output_price_per_mtok_check;
alter table public.ai_models
  add constraint ai_models_output_price_per_mtok_check
    check (output_price_per_mtok >= 0);

alter table public.ai_models
  drop constraint if exists ai_models_cache_read_price_per_mtok_check;
alter table public.ai_models
  add constraint ai_models_cache_read_price_per_mtok_check
    check (cache_read_price_per_mtok >= 0);

alter table public.ai_models
  drop constraint if exists ai_models_cache_write_price_per_mtok_check;
alter table public.ai_models
  add constraint ai_models_cache_write_price_per_mtok_check
    check (cache_write_price_per_mtok >= 0);
