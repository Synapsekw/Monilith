-- 20260810173752_ai_provider_registry.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Provider & Model layer · Task 1 · ALL of the plan's
-- schema — this feature mints exactly ONE migration, so every table, column,
-- constraint, grant and function the later tasks need is in this file):
--   1) ai_providers  — the provider registry that replaces the three-member
--      AiProvider TS union and the two hardcoded `check (provider in (...))`
--      constraints. A new provider becomes a ROW, not a code change.
--   2) ai_models     — the model catalog: source of truth for BOTH selection
--      and pricing, so the two cannot drift.
--   3) The two provider check constraints become foreign keys into (1).
--   4) org_ai_settings.default_provider / .default_model_id — the org default.
--   5) user_agents.provider / .model_id — the per-agent pin (null = org default,
--      which is also the backfill value, so existing agents are unaffected).
--   6) user_agent_runs.model_substituted — a real boolean for "this run fell
--      back off a retired pin".
--   7) Per-provider credential functions: ai_credential_set no longer clears the
--      user's other providers, plus ai_credential_delete and two-argument
--      OVERLOADS of ai_credential_get / org_ai_secret_get.
--   8) A daily pg_cron + pg_net catalog refresh, same signed shape as
--      _personal_agent_sweep.
--
-- Everything here is additive and idempotent: DEV holds the live, user-facing
-- data (decision-32), so re-applying this file must be a no-op, never a loss.

-- ---------------------------------------------------------------------------
-- 1. Provider registry.
-- ---------------------------------------------------------------------------
-- Replaces the three-member AiProvider TS union and the two hardcoded
-- `check (provider in (...))` constraints, so a new provider is one row rather
-- than a code change plus a migration.
create table if not exists public.ai_providers (
  id               text primary key,
  label            text not null,
  adapter_kind     text not null
    check (adapter_kind in ('anthropic','openai','google','openai-compatible')),
  -- Only meaningful for openai-compatible; the three native SDKs carry their
  -- own base URL. This single value is the whole difference between talking
  -- to Mistral and talking to Kimi.
  base_url         text,
  key_placeholder  text not null,
  -- POSIX regex for the cheap pre-flight shape check, before the live ping.
  key_format       text not null,
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint ai_providers_base_url_required
    check (adapter_kind <> 'openai-compatible' or base_url is not null)
);

alter table public.ai_providers enable row level security;

-- Public vendor metadata, no tenant data: readable by any signed-in user so the
-- settings and agent-editor pickers can render server-side. No insert/update/
-- delete policies => writes are default-denied and reach the table only through
-- a migration or the service-role refresh path.
drop policy if exists "ai_providers_select_all" on public.ai_providers;
create policy "ai_providers_select_all"
  on public.ai_providers for select to authenticated using (true);

insert into public.ai_providers
  (id, label, adapter_kind, base_url, key_placeholder, key_format)
values
  ('anthropic',  'Anthropic (Claude)', 'anthropic', null,
     'sk-ant-…', '^sk-ant-'),
  ('openai',     'OpenAI',             'openai',    null,
     'sk-…',     '^sk-'),
  ('google',     'Google Gemini',      'google',    null,
     'AIza…',    '^AIza'),
  ('mistral',    'Mistral',            'openai-compatible',
     'https://api.mistral.ai/v1',  '…', '^.{16,}$'),
  ('moonshotai', 'Kimi (Moonshot AI)', 'openai-compatible',
     'https://api.moonshot.ai/v1', 'sk-…', '^sk-')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Model catalog.
-- ---------------------------------------------------------------------------
-- Source of truth for BOTH selection and pricing, which is what stops the two
-- from drifting.
create table if not exists public.ai_models (
  provider                    text not null references public.ai_providers (id),
  model_id                    text not null,
  gateway_id                  text not null,
  label                       text not null,
  context_length              integer,
  max_output_tokens           integer,
  supports_tools              boolean not null default false,
  input_price_per_mtok        numeric,
  output_price_per_mtok       numeric,
  -- Null means "this provider publishes no cache rate". computeCostUsd falls
  -- back to the Anthropic-wide multipliers rather than to zero, so a provider
  -- that returns cache tokens without publishing a cache price is still billed
  -- at today's rates instead of silently free.
  cache_read_price_per_mtok   numeric,
  cache_write_price_per_mtok  numeric,
  tier                        text not null default 'standard'
    check (tier in ('cheap','standard','strong')),
  status                      text not null default 'active'
    check (status in ('active','retired','needs_pricing')),
  last_seen_at                timestamptz not null default now(),
  primary key (provider, model_id)
);

alter table public.ai_models enable row level security;

drop policy if exists "ai_models_select_all" on public.ai_models;
create policy "ai_models_select_all"
  on public.ai_models for select to authenticated using (true);

-- Every read is "active models for provider X" — this is that index prefix.
create index if not exists ai_models_status_provider_idx
  on public.ai_models (status, provider);

-- Seed floor: the models priced in src/lib/ai/pricing.ts today. A refresh that
-- never succeeds still leaves a working picker.
insert into public.ai_models
  (provider, model_id, gateway_id, label, supports_tools,
   input_price_per_mtok, output_price_per_mtok, tier)
values
  ('anthropic','claude-opus-4-8','anthropic/claude-opus-4-8','Claude Opus 4.8',
     true,  5,   25,  'strong'),
  ('anthropic','claude-sonnet-5','anthropic/claude-sonnet-5','Claude Sonnet 5',
     true,  3,   15,  'standard'),
  ('anthropic','claude-haiku-4-5','anthropic/claude-haiku-4-5','Claude Haiku 4.5',
     true,  1,   5,   'cheap'),
  ('openai','gpt-4o','openai/gpt-4o','GPT-4o',
     true,  2.5, 10,  'standard'),
  ('google','gemini-2.0-flash','google/gemini-2.0-flash','Gemini 2.0 Flash',
     true,  0.1, 0.4, 'cheap')
on conflict (provider, model_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The two hardcoded provider check constraints become foreign keys.
-- ---------------------------------------------------------------------------
-- Still constrained, no longer needing a migration per provider. The seeds
-- above run first on purpose: every value already stored in these two columns
-- ('anthropic' | 'openai' | 'google', per the constraints being dropped) is a
-- seeded id, so the FK validates against live DEV data without a rewrite.
alter table public.user_ai_credentials
  drop constraint if exists user_ai_credentials_provider_check;
alter table public.user_ai_credentials
  drop constraint if exists user_ai_credentials_provider_fkey;
alter table public.user_ai_credentials
  add constraint user_ai_credentials_provider_fkey
  foreign key (provider) references public.ai_providers (id);

alter table public.org_ai_settings
  drop constraint if exists org_ai_settings_byo_provider_check;
alter table public.org_ai_settings
  drop constraint if exists org_ai_settings_byo_provider_fkey;
alter table public.org_ai_settings
  add constraint org_ai_settings_byo_provider_fkey
  foreign key (byo_provider) references public.ai_providers (id);

-- ---------------------------------------------------------------------------
-- 4. Org default model.
-- ---------------------------------------------------------------------------
-- Null default_model_id => resolveModel falls back to the cheapest active model
-- of the resolved provider at the feature's tier.
alter table public.org_ai_settings
  add column if not exists default_provider text references public.ai_providers (id),
  add column if not exists default_model_id text;

-- ---------------------------------------------------------------------------
-- 5. Per-agent pin.
-- ---------------------------------------------------------------------------
-- Null on both => "use the org default", which is also the backfill value, so
-- every existing agent is unaffected.
alter table public.user_agents
  add column if not exists provider text references public.ai_providers (id),
  add column if not exists model_id text;

-- 20260802034242 dropped the TABLE-level insert/update grant on user_agents and
-- re-granted it COLUMN BY COLUMN (to keep bridge_secret_id out of the browser's
-- reach). A column-scoped grant does not extend to columns added later, so the
-- two new pins would be silently unwritable by `authenticated` — the exact
-- failure mode that grant style creates. Re-granting here, rather than in a
-- second migration, is why this file carries the whole plan's schema. The lists
-- are the 20260802034242 lists plus `provider, model_id`; id, created_at,
-- org_id and owner_id stay absent from UPDATE (nothing re-parents an agent).
grant insert (org_id, owner_id, name, template_id, instructions,
              board_scope, cadence, run_at_local_hour, enabled,
              provider, model_id)
  on public.user_agents to authenticated;

grant update (name, template_id, instructions, board_scope, cadence,
              run_at_local_hour, enabled, updated_at,
              provider, model_id)
  on public.user_agents to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Did this run fall back off a retired pin?
-- ---------------------------------------------------------------------------
-- A real boolean, not a prefix stuffed into `error`. `error` is what the run
-- history renders as a FAILURE, and `status` is a closed check-constrained set
-- ('ran','skipped','error') precisely so the UI never has to string-match a
-- free-text column to decide how a run ended. An informational "we substituted
-- a model" note carried in `error` would be rendered as a hard failure by every
-- existing reader of that column, so it gets its own column instead.
alter table public.user_agent_runs
  add column if not exists model_substituted boolean not null default false;

-- ---------------------------------------------------------------------------
-- 7. One key PER PROVIDER.
-- ---------------------------------------------------------------------------
-- The (user_id, provider) primary key already modelled this correctly; only the
-- delete-everything loop in 20260706165521 enforced "one active provider".
-- Dropping that loop is the whole change.
create or replace function public.ai_credential_set(
  p_user uuid, p_provider text, p_secret text, p_hint text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_old uuid;
  v_secret_id uuid;
begin
  -- Replace only THIS provider's key; other providers' keys are untouched.
  select secret_id into v_old
    from public.user_ai_credentials
   where user_id = p_user and provider = p_provider;
  if v_old is not null then
    delete from vault.secrets where id = v_old;
    delete from public.user_ai_credentials
     where user_id = p_user and provider = p_provider;
  end if;

  v_secret_id := vault.create_secret(
    p_secret,
    'ai_key:' || p_user::text || ':' || p_provider,
    'BYO AI provider key'
  );

  insert into public.user_ai_credentials (user_id, provider, secret_id, key_hint)
  values (p_user, p_provider, v_secret_id, p_hint);
end;
$$;

create or replace function public.ai_credential_delete(
  p_user uuid, p_provider text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_old uuid;
begin
  select secret_id into v_old
    from public.user_ai_credentials
   where user_id = p_user and provider = p_provider;
  if v_old is not null then
    delete from vault.secrets where id = v_old;
  end if;
  delete from public.user_ai_credentials
   where user_id = p_user and provider = p_provider;
end;
$$;

-- Decrypt ONE provider's key. Added as an OVERLOAD, not a replacement: the
-- existing 1-arg ai_credential_get(uuid) stays until its last caller moves in
-- Task 5. Dropping it here would break credentials.ts the moment types are
-- regenerated, leaving this task unable to pass its own typecheck gate.
--
-- The 1-arg forms are DEAD after Task 8 but are deliberately NOT dropped here:
-- this plan mints exactly one migration, and dropping them needs a second one.
-- Spec 2's migration drops both. Until then they remain service_role-only, so
-- the leftover surface is a dead function no caller reaches, not an exposure.
create or replace function public.ai_credential_get(p_user uuid, p_provider text)
returns table (provider text, secret text)
language sql
security definer
set search_path = public, vault
as $$
  select c.provider, s.decrypted_secret
  from public.user_ai_credentials c
  join vault.decrypted_secrets s on s.id = c.secret_id
  where c.user_id = p_user and c.provider = p_provider;
$$;

-- Org BYO gains the same per-provider argument, also as an overload. The org
-- still stores one key (byo_secret_id); the argument makes the caller state
-- which provider it expects, so a mismatch resolves to no row rather than the
-- wrong adapter.
create or replace function public.org_ai_secret_get(p_org uuid, p_provider text)
returns table (provider text, secret text)
language sql
security definer
set search_path = public, vault
as $$
  select o.byo_provider, s.decrypted_secret
  from public.org_ai_settings o
  join vault.decrypted_secrets s on s.id = o.byo_secret_id
  where o.org_id = p_org and o.byo_provider = p_provider;
$$;

revoke all on function public.ai_credential_set(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.ai_credential_delete(uuid, text)
  from public, anon, authenticated;
revoke all on function public.ai_credential_get(uuid, text)
  from public, anon, authenticated;
revoke all on function public.org_ai_secret_get(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ai_credential_set(uuid, text, text, text)
  to service_role;
grant execute on function public.ai_credential_delete(uuid, text)
  to service_role;
grant execute on function public.ai_credential_get(uuid, text) to service_role;
grant execute on function public.org_ai_secret_get(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Daily catalog refresh.
-- ---------------------------------------------------------------------------
-- Same pg_net + HMAC shape as embed-sweep and personal-agent-sweep: the DB
-- reads the endpoint base URL from Vault `app_url` and the HMAC secret from
-- Vault `ai_pgnet_hmac_secret`, and signs `v_body::text` — the same jsonb
-- serialization pg_net transmits — so the route's verifyBody(rawBody) matches
-- byte-for-byte. cron.schedule upserts by job name => re-runnable.
create or replace function public._ai_models_refresh_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_app_url text;
  v_secret  text;
  v_body    jsonb := jsonb_build_object('mode', 'refresh');
  v_sig     text;
begin
  select decrypted_secret into v_app_url
    from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'ai_pgnet_hmac_secret';
  if v_app_url is null or v_secret is null then
    raise warning 'ai models refresh skipped: app_url or hmac secret missing';
    return;
  end if;

  v_sig := encode(extensions.hmac(v_body::text, v_secret, 'sha256'), 'hex');
  perform net.http_post(
    url := v_app_url || '/api/ai/models/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Pulse-Signature', v_sig),
    body := v_body
  );
end; $$;

revoke execute on function public._ai_models_refresh_tick()
  from public, anon, authenticated;

-- 03:10 UTC daily — off-peak, and clear of the 03:30 automation-runs-prune.
select cron.schedule(
  'ai-models-refresh',
  '10 3 * * *',
  $cron$ select public._ai_models_refresh_tick() $cron$
);
