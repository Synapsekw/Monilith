-- 20260724133321_mcp_oauth.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (MCP server — OAuth 2.1 authorization server):
--   1. oauth_clients   — dynamically registered MCP client apps.
--   2. oauth_codes     — short-lived PKCE authorization codes.
--   3. oauth_tokens    — issued access/refresh tokens (hashed at rest), each
--      optionally pointing at a Vault secret holding a bridged Supabase
--      refresh token for that user (see oauth_bridge_* functions below).
--   4. oauth_bridge_rotate_secret/get_secret — Vault-touching SECURITY
--      DEFINER helpers, service_role only, mirroring
--      ai_credential_set/get (20260706164829_user_ai_credentials.sql).
--   5. A before-delete trigger on oauth_tokens frees the Vault secret when a
--      token row is deleted/revoked-and-purged.
--   All three tables: RLS enabled, zero policies — service_role only, no
--   anon/authenticated grants (this data is never read/written by a logged
--   in browser session, only by the /api/oauth/* and /api/mcp route
--   handlers running under the service-role client).

create table public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);
alter table public.oauth_clients enable row level security;

create table public.oauth_codes (
  code text primary key,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.oauth_codes enable row level security;
create index oauth_codes_expires_at_idx on public.oauth_codes (expires_at);

create table public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  access_token_hash text not null unique,
  refresh_token_hash text not null unique,
  bridge_secret_id uuid,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.oauth_tokens enable row level security;
create index oauth_tokens_user_id_idx on public.oauth_tokens (user_id) where revoked_at is null;
create index oauth_tokens_access_hash_idx on public.oauth_tokens (access_token_hash) where revoked_at is null;
create index oauth_tokens_refresh_hash_idx on public.oauth_tokens (refresh_token_hash) where revoked_at is null;

create or replace function public.oauth_bridge_rotate_secret(
  p_old_secret_id uuid,
  p_secret text,
  p_name text
) returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare
  v_secret_id uuid;
begin
  if p_old_secret_id is not null then
    delete from vault.secrets where id = p_old_secret_id;
  end if;
  v_secret_id := vault.create_secret(p_secret, p_name, 'MCP OAuth bridge refresh token');
  return v_secret_id;
end;
$$;

create or replace function public.oauth_bridge_get_secret(p_secret_id uuid)
returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_secret_id;
$$;

create or replace function public.oauth_tokens_vault_cleanup()
returns trigger
language plpgsql security definer set search_path = public, vault as $$
begin
  if old.bridge_secret_id is not null then
    delete from vault.secrets where id = old.bridge_secret_id;
  end if;
  return old;
end;
$$;

create trigger oauth_tokens_before_delete
  before delete on public.oauth_tokens
  for each row execute function public.oauth_tokens_vault_cleanup();

revoke all on function public.oauth_bridge_rotate_secret(uuid, text, text) from public, anon, authenticated;
revoke all on function public.oauth_bridge_get_secret(uuid) from public, anon, authenticated;
revoke all on function public.oauth_tokens_vault_cleanup() from public, anon, authenticated;
grant execute on function public.oauth_bridge_rotate_secret(uuid, text, text) to service_role;
grant execute on function public.oauth_bridge_get_secret(uuid) to service_role;
grant execute on function public.oauth_tokens_vault_cleanup() to service_role;
