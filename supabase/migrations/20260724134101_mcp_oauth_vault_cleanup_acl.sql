-- Lock down the oauth_tokens_vault_cleanup() trigger function's ACL.
--
-- 20260724133321_mcp_oauth.sql revokes + re-grants the two Vault-touching
-- bridge helpers (oauth_bridge_rotate_secret / oauth_bridge_get_secret) but
-- left the third SECURITY DEFINER function it creates —
-- oauth_tokens_vault_cleanup(), the oauth_tokens before-delete trigger — on
-- Postgres's default `execute to public`. A definer function that deletes from
-- vault.secrets must not be directly callable by anon/authenticated, so it gets
-- the same treatment as its siblings (the definer-execution lockdown hygiene
-- established in 20260704114000_definer_execution_lockdown_hygiene.sql).
--
-- Trigger execution is unaffected: Postgres invokes trigger functions without
-- an EXECUTE privilege check on the calling role.

revoke all on function public.oauth_tokens_vault_cleanup() from public, anon, authenticated;
grant execute on function public.oauth_tokens_vault_cleanup() to service_role;
