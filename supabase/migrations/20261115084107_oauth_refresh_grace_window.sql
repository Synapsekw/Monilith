-- 20261115084107_oauth_refresh_grace_window.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (MCP OAuth — refresh-token grace window):
--   Refresh tokens rotate on every use and only their hashes are stored, so a
--   client whose token RESPONSE was lost in transit was left holding a refresh
--   token that no longer matched anything: the connection was dead until the
--   user removed and re-added the connector by hand.
--
--   oauth_tokens now remembers the hash it rotated away from and when, so
--   rotateTokenPair (src/lib/mcp/oauth/token-store.ts) can honour that one
--   previous token for a short window after the rotation.
--
--   Additive and nullable: existing rows keep working with no grace until
--   their next rotation fills the columns in. No policy changes — the table
--   stays RLS-enabled with zero policies (service_role only).

alter table public.oauth_tokens
  add column prev_refresh_token_hash text,
  add column prev_refresh_rotated_at timestamptz;

create index oauth_tokens_prev_refresh_hash_idx
  on public.oauth_tokens (prev_refresh_token_hash)
  where revoked_at is null and prev_refresh_token_hash is not null;
