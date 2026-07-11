-- Phase 10 E1: org-scoped AI settings, usage ledger, org BYO secret (Vault).
-- Hybrid model (spec 2026-07-11-ai-e1-scope-reconciliation): ai_mode default
-- 'per_user' preserves the shipped per-user BYO behavior; a missing row is
-- treated as per_user by the app. user_ai_credentials is unchanged.

create type public.ai_mode as enum ('off', 'managed', 'org_byo', 'per_user');

create table public.org_ai_settings (
  org_id               uuid primary key references public.organizations (id) on delete cascade,
  ai_mode              public.ai_mode not null default 'per_user',
  tier                 text not null default 'none',
  monthly_credit_limit integer not null default 0,
  byo_provider         text check (byo_provider in ('anthropic', 'openai', 'google')),
  byo_secret_id        uuid,
  byo_key_last4        text,
  updated_at           timestamptz not null default now(),
  updated_by           uuid
);

alter table public.org_ai_settings enable row level security;

-- Members read their org's settings (no secret material here — only the
-- opaque Vault id + last4). Admins write. Default-deny otherwise.
create policy "org_ai_settings_select_member"
  on public.org_ai_settings for select
  using (public.is_org_member(org_id));
create policy "org_ai_settings_insert_admin"
  on public.org_ai_settings for insert
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
create policy "org_ai_settings_update_admin"
  on public.org_ai_settings for update
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create trigger org_ai_settings_set_updated_at
  before update on public.org_ai_settings
  for each row execute function public.set_updated_at();

-- Append-only usage ledger. Admin-readable; no client write path at all —
-- only the record_ai_usage definer (service role) inserts.
create table public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  user_id       uuid,
  feature       text not null,
  provider      text,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd      numeric(10, 6) not null default 0,
  credits       numeric(10, 2) not null default 0,
  created_at    timestamptz not null default now()
);

create index ai_usage_org_created_idx on public.ai_usage (org_id, created_at desc);

alter table public.ai_usage enable row level security;

create policy "ai_usage_select_admin"
  on public.ai_usage for select
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- Org BYO secret: raw key lives ONLY in Supabase Vault. Mirrors the shipped
-- ai_credential_* functions (20260706164829), keyed on org instead of user.
create or replace function public.org_ai_secret_set(
  p_org uuid, p_provider text, p_secret text, p_hint text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_old uuid;
  v_secret_id uuid;
begin
  select byo_secret_id into v_old from public.org_ai_settings where org_id = p_org;
  if v_old is not null then
    delete from vault.secrets where id = v_old;
  end if;

  v_secret_id := vault.create_secret(
    p_secret,
    'org_ai_key:' || p_org::text || ':' || p_provider,
    'Org BYO AI provider key'
  );

  insert into public.org_ai_settings (org_id, byo_provider, byo_secret_id, byo_key_last4)
  values (p_org, p_provider, v_secret_id, p_hint)
  on conflict (org_id) do update
    set byo_provider = excluded.byo_provider,
        byo_secret_id = excluded.byo_secret_id,
        byo_key_last4 = excluded.byo_key_last4;
end;
$$;

create or replace function public.org_ai_secret_get(p_org uuid)
returns table (provider text, secret text)
language sql
security definer
set search_path = public, vault
as $$
  select o.byo_provider, s.decrypted_secret
  from public.org_ai_settings o
  join vault.decrypted_secrets s on s.id = o.byo_secret_id
  where o.org_id = p_org;
$$;

create or replace function public.org_ai_secret_clear(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_old uuid;
begin
  select byo_secret_id into v_old from public.org_ai_settings where org_id = p_org;
  if v_old is not null then
    delete from vault.secrets where id = v_old;
  end if;
  update public.org_ai_settings
    set byo_provider = null, byo_secret_id = null, byo_key_last4 = null,
        ai_mode = case when ai_mode = 'org_byo' then 'per_user'::public.ai_mode else ai_mode end
    where org_id = p_org;
end;
$$;

-- Ledger write: the ONLY insert path into ai_usage; service role only.
create or replace function public.record_ai_usage(
  p_org uuid, p_user uuid, p_feature text, p_provider text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_credits numeric
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage
    (org_id, user_id, feature, provider, model, input_tokens, output_tokens, cost_usd, credits)
  values
    (p_org, p_user, p_feature, p_provider, p_model, p_input_tokens, p_output_tokens, p_cost_usd, p_credits);
$$;

create or replace function public.ai_credits_used_this_month(p_org uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(credits), 0)
  from public.ai_usage
  where org_id = p_org and created_at >= date_trunc('month', now());
$$;

revoke all on function public.org_ai_secret_set(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.org_ai_secret_get(uuid) from public, anon, authenticated;
revoke all on function public.org_ai_secret_clear(uuid) from public, anon, authenticated;
revoke all on function public.record_ai_usage(uuid, uuid, text, text, text, integer, integer, numeric, numeric) from public, anon, authenticated;
revoke all on function public.ai_credits_used_this_month(uuid) from public, anon, authenticated;
grant execute on function public.org_ai_secret_set(uuid, text, text, text) to service_role;
grant execute on function public.org_ai_secret_get(uuid) to service_role;
grant execute on function public.org_ai_secret_clear(uuid) to service_role;
grant execute on function public.record_ai_usage(uuid, uuid, text, text, text, integer, integer, numeric, numeric) to service_role;
grant execute on function public.ai_credits_used_this_month(uuid) to service_role;
