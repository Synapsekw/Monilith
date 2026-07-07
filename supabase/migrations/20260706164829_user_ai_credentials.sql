-- Per-user BYO AI provider key metadata.
-- The raw key lives ONLY in Supabase Vault; this table holds the vault secret id
-- plus a masked hint. All writes/decrypt go through the SECURITY DEFINER functions
-- below (service-role only). The authenticated role may only SELECT its own row.

create table public.user_ai_credentials (
  user_id    uuid not null references auth.users (id) on delete cascade,
  provider   text not null check (provider in ('anthropic', 'openai', 'google')),
  secret_id  uuid not null,
  key_hint   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.user_ai_credentials enable row level security;

-- Read-only self access so the settings page can show provider + hint.
create policy "user_ai_credentials_select_own"
  on public.user_ai_credentials
  for select
  using (user_id = auth.uid());
-- No insert/update/delete policies: direct writes are default-denied.

-- Store a key: clear any existing credential for the user (one active provider),
-- create a Vault secret, and record its id + hint.
create or replace function public.ai_credential_set(
  p_user uuid, p_provider text, p_secret text, p_hint text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_old record;
  v_secret_id uuid;
begin
  for v_old in
    select secret_id from public.user_ai_credentials where user_id = p_user
  loop
    delete from vault.secrets where id = v_old.secret_id;
  end loop;
  delete from public.user_ai_credentials where user_id = p_user;

  v_secret_id := vault.create_secret(
    p_secret,
    'ai_key:' || p_user::text || ':' || p_provider,
    'BYO AI provider key'
  );

  insert into public.user_ai_credentials (user_id, provider, secret_id, key_hint)
  values (p_user, p_provider, v_secret_id, p_hint);
end;
$$;

-- Remove a user's key (Vault secret + row).
create or replace function public.ai_credential_clear(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_old record;
begin
  for v_old in
    select secret_id from public.user_ai_credentials where user_id = p_user
  loop
    delete from vault.secrets where id = v_old.secret_id;
  end loop;
  delete from public.user_ai_credentials where user_id = p_user;
end;
$$;

-- Decrypt a user's key. The ONLY decrypt path; service-role only.
create or replace function public.ai_credential_get(p_user uuid)
returns table (provider text, secret text)
language sql
security definer
set search_path = public, vault
as $$
  select c.provider, s.decrypted_secret
  from public.user_ai_credentials c
  join vault.decrypted_secrets s on s.id = c.secret_id
  where c.user_id = p_user;
$$;

revoke all on function public.ai_credential_set(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.ai_credential_clear(uuid) from public, anon, authenticated;
revoke all on function public.ai_credential_get(uuid) from public, anon, authenticated;
grant execute on function public.ai_credential_set(uuid, text, text, text) to service_role;
grant execute on function public.ai_credential_clear(uuid) to service_role;
grant execute on function public.ai_credential_get(uuid) to service_role;
