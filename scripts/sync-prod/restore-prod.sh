#!/usr/bin/env bash
# Restore a dev data dump into PROD: truncate target tables, load in replica mode,
# all in ONE transaction (rolls back fully on any error). Requires psql on PATH.
# Usage: scripts/sync-prod/restore-prod.sh <path-to-dev-data.sql>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
set -a; . "$ROOT/.env.local"; [ -f "$ROOT/.env.prod.local" ] && . "$ROOT/.env.prod.local"; set +a
: "${PROD_SUPABASE_DB_URL:?set PROD_SUPABASE_DB_URL in .env.prod.local}"
DUMP="${1:?usage: restore-prod.sh <dev-data.sql>}"
[ -f "$DUMP" ] || { echo "dump not found: $DUMP" >&2; exit 1; }
command -v psql >/dev/null || { echo "psql not on PATH — install libpq/postgresql client" >&2; exit 1; }

# Truncate every table in public + storage, plus auth user tables (skip supabase-managed
# bookkeeping like *.schema_migrations). Generated dynamically so it tracks schema growth.
TRUNCATE_SQL="$(cat <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('%I.%I', schemaname, tablename) AS t
    FROM pg_tables
    WHERE (schemaname IN ('public','storage')
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
