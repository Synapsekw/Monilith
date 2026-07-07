-- Clean up the Vault secret whenever a user_ai_credentials row is deleted — via
-- ai_credential_clear/_set OR the auth.users on-delete cascade. A before-delete
-- trigger makes cascade deletion (account removal) clean up Vault too, closing
-- the one path that previously orphaned encrypted key material.

create or replace function public.ai_credential_delete_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;

create trigger user_ai_credentials_delete_vault_secret
  before delete on public.user_ai_credentials
  for each row execute function public.ai_credential_delete_vault_secret();

-- With the trigger owning secret cleanup, set/clear no longer need to delete
-- vault secrets explicitly — a plain row delete fires the trigger.
create or replace function public.ai_credential_set(
  p_user uuid, p_provider text, p_secret text, p_hint text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
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

create or replace function public.ai_credential_clear(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from public.user_ai_credentials where user_id = p_user;
end;
$$;
