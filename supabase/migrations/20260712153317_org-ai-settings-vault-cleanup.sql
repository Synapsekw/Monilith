-- 20260712153317_org-ai-settings-vault-cleanup.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Clean up the org BYO Vault secret whenever an org_ai_settings row is deleted
--   — via org_ai_secret_clear OR the organizations on-delete cascade. A
--   before-delete trigger makes cascade deletion (org removal) clean up Vault
--   too, closing the path that previously orphaned the org's encrypted BYO key
--   material. Mirrors the shipped per-user precedent
--   (20260706165521_user_ai_credentials_vault_cleanup).

create or replace function public.org_ai_settings_delete_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if old.byo_secret_id is not null then
    delete from vault.secrets where id = old.byo_secret_id;
  end if;
  return old;
end;
$$;

create trigger org_ai_settings_delete_vault_secret
  before delete on public.org_ai_settings
  for each row execute function public.org_ai_settings_delete_vault_secret();
