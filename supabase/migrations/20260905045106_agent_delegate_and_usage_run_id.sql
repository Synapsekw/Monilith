-- 20260905045106_agent_delegate_and_usage_run_id.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Spec 3 · Task 1 · migration 2 of 4):
--   1) 'agent.delegate' joins the closed capability vocabulary — both the
--      per-agent CHECK on user_agents.capabilities and the admin clamp
--      org_ai_settings.agent_capability_ceiling (CHECK + column DEFAULT).
--   2) ai_usage.run_id — the correlation column Spec 3 §5 exists for. Without
--      it every personal-agent call in an org collapses into one
--      `personal_agent_run` bucket and a DELEGATED child's spend cannot be
--      attributed to the child at all.
--   3) org_ai_settings.assistant_name — the per-org display name of the
--      platform bot (Task 9 renders it; the column ships here with the rest of
--      the schema so exactly one migration touches org_ai_settings).
--   4) record_ai_usage gains `p_run_id`. It is DROPPED and RECREATED (a `sql`
--      function cannot gain a parameter through `create or replace`), so its
--      grants are re-asserted below against the NEW 12-argument signature.
--
-- THIS MIGRATION MUST APPLY BEFORE 20260905045108_agent_handles_and_builtin,
-- whose built-in-agent seed inserts capabilities = '{agent.delegate}'. Applied
-- the other way round, user_agents_capabilities_known rejects every seed row.
-- The version stamps encode that order; do not reorder them.
--
-- DDL ONLY. NOT ONE ROW OF USER DATA IS READ OR WRITTEN BY THIS MIGRATION.
--
-- ===========================================================================
-- THE CEILING BACKFILL IS DELIBERATELY ABSENT — owner ruling, 2026-09-04.
-- ===========================================================================
-- The spec's open question 2 asked whether to add 'agent.delegate' to every
-- EXISTING org_ai_settings row's ceiling. The owner ruled no, exactly as for
-- 'memory.write' in Spec 2c (20260827095748_agent_memory.sql): the DEV database
-- holds real, live, user-facing data (decision-32), and a data-modifying
-- statement against it is production surgery that is reviewed and run on its
-- own, never as a side effect of shipping a feature branch.
--
-- The exact statement, recorded here so it is reviewable in the diff and
-- runnable verbatim later. IT HAS NOT BEEN EXECUTED:
--
--     update public.org_ai_settings
--        set agent_capability_ceiling = agent_capability_ceiling || 'agent.delegate'
--      where not ('agent.delegate' = any (agent_capability_ceiling));
--
-- WHAT THAT MEANS FOR THIS SHIP: every org that already has an
-- `org_ai_settings` row carries the literal five-element array, so the ceiling
-- check refuses 'agent.delegate' before the grant check even runs and records
-- NO proposal — the owner sees nothing at all. Delegation therefore ships
-- INSTALLABLE BUT INERT for existing orgs: the column, the RPC, the tool and
-- the built-in agent are all live and tested, and AN ADMIN MUST OPEN THE ORG
-- CEILING (tick the capability on the org AI settings page, which writes the
-- same array — or run the `update` above) before any delegation happens.
--
-- The `alter column … set default` below IS included, and it RE-STATES the
-- five-capability vocabulary WITHOUT 'agent.delegate'. That is the same ruling
-- one step further: the DEFAULT decides what a brand-new org gets, and handing
-- delegation to every future org automatically is the same silent grant the
-- backfill was refused for. `agent.delegate` joins the CHECK (so an admin CAN
-- tick it) and nothing else.
--
-- It must also not disagree with `DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling`
-- (src/lib/ai/org-settings.ts), which is the effective ceiling for an org with
-- NO settings row at all. Task 2 states that constant as a LITERAL five-item
-- list for exactly this reason rather than `[...AGENT_CAPABILITIES]`, which
-- gains 'agent.delegate'. The two sides are now the same five strings; changing
-- one without the other silently widens or narrows the admin gate.
--
-- (The plan's literal DDL for this default listed only the FOUR pre-Spec-2c
-- capabilities. That is a transcription slip: applying it verbatim would strip
-- 'memory.write' from the default and silently regress every org created after
-- this migration. 20260827095748:255-258 set 'memory.write' deliberately and
-- src/lib/ai/org-settings.test.ts asserts it.)

-- ---------------------------------------------------------------------------
-- 1) The capability vocabulary
-- ---------------------------------------------------------------------------
alter table public.user_agents
  drop constraint if exists user_agents_capabilities_known;
alter table public.user_agents
  add constraint user_agents_capabilities_known
  check (capabilities <@ array['board.write','files.write','automation.create',
                              'time.log','memory.write','agent.delegate']::text[]);

alter table public.org_ai_settings
  drop constraint if exists org_ai_settings_ceiling_known;
alter table public.org_ai_settings
  add constraint org_ai_settings_ceiling_known
  check (agent_capability_ceiling <@ array['board.write','files.write',
                                          'automation.create','time.log',
                                          'memory.write','agent.delegate']::text[]);

-- New rows only, and deliberately WITHOUT 'agent.delegate' — see the header.
-- Byte-for-byte the same five strings as DEFAULT_ORG_AI_SETTINGS in
-- src/lib/ai/org-settings.ts.
alter table public.org_ai_settings
  alter column agent_capability_ceiling set default
    array['board.write','files.write','automation.create','time.log',
          'memory.write']::text[];

-- ---------------------------------------------------------------------------
-- 2) ai_usage.run_id — metering correlation
-- ---------------------------------------------------------------------------
alter table public.ai_usage add column if not exists run_id uuid;

-- Partial: only agent calls carry a run id, and they are a small minority of
-- the ledger. The read this serves is "the spend of this run and its children",
-- which is bounded by the fan-out cap.
create index if not exists ai_usage_run_idx on public.ai_usage (run_id) where run_id is not null;

comment on column public.ai_usage.run_id is
  'Correlation id for a user_agent_runs row. Deliberately NOT a foreign key: '
  'the ledger is money and must never fail to write because a run row was '
  'cascaded away.';

-- ---------------------------------------------------------------------------
-- 3) org_ai_settings.assistant_name — the per-org platform-bot name
-- ---------------------------------------------------------------------------
-- org_ai_settings carries TABLE-level insert/update grants (not column-scoped),
-- so a new column needs no re-grant here; writes are still gated by RLS, which
-- has no authenticated write policy at all — only the definer settings RPC.
alter table public.org_ai_settings
  add column if not exists assistant_name text not null default 'Monolith Autopilot'
    check (length(trim(assistant_name)) between 1 and 40);

comment on column public.org_ai_settings.assistant_name is
  'What this org calls the built-in platform assistant. Display only — it never '
  'addresses anything, so it is NOT constrained to the @handle grammar.';

-- ---------------------------------------------------------------------------
-- 4) record_ai_usage(..., p_run_id)
-- ---------------------------------------------------------------------------
-- A `language sql` function cannot gain a parameter through `create or replace`
-- (that is a different function signature), so this is a real drop-and-recreate.
drop function if exists public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric, integer, integer);

create function public.record_ai_usage(
  p_org uuid, p_user uuid, p_feature text, p_provider text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_credits numeric,
  p_cache_read_tokens integer default 0, p_cache_write_tokens integer default 0,
  p_run_id uuid default null
) returns void language sql security definer set search_path = public as $$
  insert into public.ai_usage
    (org_id, user_id, feature, provider, model, input_tokens, output_tokens,
     cost_usd, credits, cache_read_tokens, cache_write_tokens, run_id)
  values
    (p_org, p_user, p_feature, p_provider, p_model, p_input_tokens, p_output_tokens,
     p_cost_usd, p_credits, coalesce(p_cache_read_tokens, 0),
     coalesce(p_cache_write_tokens, 0), p_run_id);
$$;

-- GLOBAL CONSTRAINT: grants do NOT survive the drop, and a freshly created
-- function is EXECUTE-to-PUBLIC by default. Restate both, against the new
-- 12-argument signature. NOTHING in typecheck/lint/test/build catches a miss
-- here — every metered call simply fails at runtime with a permission error,
-- and runAi swallows ledger-write failures by design.
revoke all on function public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric,
  integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric,
  integer, integer, uuid) to service_role;
