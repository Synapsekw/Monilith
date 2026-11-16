-- 20261115173811_oauth_token_idle_expiry_and_bridge_swap.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (MCP OAuth — idle expiry, last-used, safe bridge swap):
--
--   1. oauth_tokens.last_used_at — when the connection last did anything
--      (issued, refreshed, or called a tool; the app writes it at most once per
--      five minutes per token). Shown in Settings → MCP → Connected apps.
--
--   2. oauth_tokens.prev_refresh_expires_at — the expiry that applied to the
--      refresh token remembered in prev_refresh_token_hash, so the 60-second
--      grace path (20261115084107) can refuse a previous token that had itself
--      expired. Null on rows rotated before this migration: those get no grace
--      until their next rotation, which is the fail-closed direction.
--
--   3. oauth_tokens.bridge_healed_at — when the connection last re-minted its
--      Supabase session ("self-heal"). The app claims this column before
--      minting, which caps self-heals at one per token per 60 seconds across
--      every server instance.
--
--   4. Backfill. A refresh token's lifetime moves from 30 to 90 days, sliding
--      from its last use (src/lib/mcp/oauth/token-store.ts). The stored expiry
--      was never enforced before, so existing rows carry "last rotation + 30
--      days". One UPDATE turns that into the new meaning for rows that exist
--      today: last_used_at = the last rotation, expiry = that + 90 days.
--      Without it every connection idle for 31-89 days would be cut the moment
--      the expiry check goes live, which is not the policy.
--
--   5. oauth_bridge_swap_secret — replaces the Vault secret behind a token row
--      as ONE transaction, compare-and-set on the secret the caller read.
--      Before this the app created the new secret, deleted the old one and
--      then updated oauth_tokens in a separate request, so two concurrent tool
--      calls each created a secret, the last UPDATE won, and the other secret
--      (holding a live session) was orphaned in Vault. Returns the new secret
--      id, or NULL when the row is gone, revoked, or no longer points at
--      p_expected_secret_id — in which case nothing is created and the caller
--      re-reads the winner's secret.
--
--   No policy changes: oauth_tokens stays RLS-enabled with zero policies
--   (service_role only), and the function is service_role only.

alter table public.oauth_tokens
  add column last_used_at timestamptz not null default now(),
  add column prev_refresh_expires_at timestamptz,
  add column bridge_healed_at timestamptz;

-- Both SET expressions read the pre-update refresh_token_expires_at.
update public.oauth_tokens
   set last_used_at = greatest(created_at, refresh_token_expires_at - interval '30 days'),
       refresh_token_expires_at = refresh_token_expires_at + interval '60 days';

create or replace function public.oauth_bridge_swap_secret(
  p_token_id uuid,
  p_expected_secret_id uuid,
  p_secret text,
  p_name text
) returns uuid
-- Same search_path as the sibling Vault helpers in 20260724133321_mcp_oauth.sql
-- (vault.create_secret is proven to work under it); every object is qualified.
language plpgsql security definer set search_path = public, vault as $$
declare
  v_current uuid;
  v_new uuid;
begin
  -- The row lock serialises concurrent swaps for one token: the second caller
  -- waits here, then sees the first caller's secret id and returns NULL.
  select t.bridge_secret_id into v_current
    from public.oauth_tokens t
   where t.id = p_token_id and t.revoked_at is null
     for update;
  if not found or v_current is distinct from p_expected_secret_id then
    return null;
  end if;

  v_new := vault.create_secret(p_secret, p_name, 'MCP OAuth bridge refresh token');
  update public.oauth_tokens set bridge_secret_id = v_new where id = p_token_id;
  if p_expected_secret_id is not null then
    delete from vault.secrets where id = p_expected_secret_id;
  end if;
  return v_new;
end;
$$;

revoke all on function public.oauth_bridge_swap_secret(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.oauth_bridge_swap_secret(uuid, uuid, text, text) to service_role;
