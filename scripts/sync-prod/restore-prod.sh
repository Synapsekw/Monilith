#!/usr/bin/env bash
# Restore a dev data dump into PROD: truncate target tables, load in replica mode,
# all in ONE transaction (rolls back fully on any error). Requires psql on PATH.
# Usage: scripts/sync-prod/restore-prod.sh <path-to-dev-data.sql>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
set -a; . "$ROOT/.env.local"; [ -f "$ROOT/.env.prod.local" ] && . "$ROOT/.env.prod.local"; set +a
: "${PROD_SUPABASE_DB_URL:?set PROD_SUPABASE_DB_URL in .env.prod.local}"
# Refuse to truncate-and-restore onto the dev DB. This is the shell-path counterpart to the
# config loader's "onto itself" guard: this repo has a documented history of inverted env labels
# and last-wins .env duplicate keys silently repointing dev, and a mis-set PROD_SUPABASE_DB_URL
# here would CASCADE-truncate the source-of-truth dev database. DEV_SUPABASE_DB_URL must be set
# (it shares the same env files) and must differ from the prod target.
: "${DEV_SUPABASE_DB_URL:?set DEV_SUPABASE_DB_URL (needed to assert prod != dev before truncating)}"
[ "$PROD_SUPABASE_DB_URL" != "$DEV_SUPABASE_DB_URL" ] || {
  echo "refusing to restore: PROD_SUPABASE_DB_URL equals DEV_SUPABASE_DB_URL — this would truncate the dev source-of-truth DB" >&2
  exit 1
}
DUMP="${1:?usage: restore-prod.sh <dev-data.sql>}"
[ -f "$DUMP" ] || { echo "dump not found: $DUMP" >&2; exit 1; }
[ -n "${PG_BIN:-}" ] && PATH="$PG_BIN:$PATH"
command -v psql >/dev/null || { echo "psql not found — add the PostgreSQL bin to PATH or set PG_BIN in .env.prod.local" >&2; exit 1; }

# Truncate every table in public, plus the auth user tables we load. Storage is intentionally
# EXCLUDED — it is owned end-to-end by sync-storage.ts (buckets + objects + blobs via the Storage
# API). Truncating storage.* here hits supabase_storage_admin-owned tables (e.g. storage.migrations)
# that the connecting postgres role cannot truncate → permission denied → whole restore rolls back.
# The dump (dump-dev.sh) is scoped to the SAME set — public + these exact 5 auth tables — so every
# COPY in the dump has a truncated target. Keep the two lists in lockstep.
TRUNCATE_SQL="$(cat <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('%I.%I', schemaname, tablename) AS t
    FROM pg_tables
    WHERE (schemaname = 'public'
           OR (schemaname='auth' AND tablename IN ('users','identities','mfa_factors','mfa_amr_claims','sessions')))
      AND tablename <> 'schema_migrations'
  LOOP
    EXECUTE 'TRUNCATE TABLE ' || r.t || ' CASCADE';
  END LOOP;
END $$;
SQL
)"

psql "$PROD_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction <<SQL
SET session_replication_role = replica;
$TRUNCATE_SQL
\i $DUMP
SQL
echo "Restore complete from $DUMP"
