-- 20260801094908_personal_agent_vault_cleanup.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Personal Agents · Phase 1 · Task 10, Part 2 —
-- routed defect from the owner-client task review):
--   user_agents.bridge_secret_id (20260801091231_personal_agents.sql) holds a
--   Vault secret id — a GoTrue session for the agent's owner (see
--   owner-client.ts). Deleting a user_agents row did not free that secret,
--   leaking it in Vault forever.
--
--   Fix: a before-delete trigger that removes the Vault secret whenever a
--   user_agents row is deleted, mirroring oauth_tokens' bridge-secret
--   lifecycle exactly (oauth_tokens_vault_cleanup /
--   oauth_tokens_before_delete in 20260724133321_mcp_oauth.sql). `delete
--   from vault.secrets where id = ...` is naturally idempotent — deleting a
--   row that is already gone (rotated away, previously cleaned up, or never
--   set) matches zero rows and does not raise, so an agent whose secret is
--   already missing still deletes cleanly. No explicit existence check or
--   exception handler is needed for that reason.
--
--   Deliberately a separate migration from 20260801094820_personal_agent_sweep.sql
--   (the sweep) and NOT an edit to 20260801091231_personal_agents.sql: the
--   latter is already applied to DEV, so amending it would cause ledger
--   drift. This fix is an independent concern (row lifecycle vs. the sweep
--   schedule) with its own reviewable diff, so it gets its own file rather
--   than being folded into the sweep migration.

create or replace function public.user_agents_vault_cleanup()
returns trigger
language plpgsql security definer set search_path = public, vault as $$
begin
  if old.bridge_secret_id is not null then
    delete from vault.secrets where id = old.bridge_secret_id;
  end if;
  return old;
end;
$$;

create trigger user_agents_before_delete
  before delete on public.user_agents
  for each row execute function public.user_agents_vault_cleanup();

revoke all on function public.user_agents_vault_cleanup() from public, anon, authenticated;
grant execute on function public.user_agents_vault_cleanup() to service_role;
