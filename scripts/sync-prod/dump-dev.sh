#!/usr/bin/env bash
# Data-only dump of DEV for /sync-prod: the public schema + the 5 auth user tables that
# restore-prod.sh truncates and loads. Storage is intentionally EXCLUDED — sync-storage.ts owns
# buckets/objects/blobs via the Storage API (and storage internals like storage.migrations are
# owned by supabase_storage_admin, so they can't be truncated/loaded by the postgres role anyway).
#
# Uses pg_dump directly: the supabase CLI's `db dump` needs extra local tooling that is not assumed
# present. If pg_dump is not on PATH, set PG_BIN in .env.prod.local to your PostgreSQL bin dir.
#
# Output: scripts/sync-prod/.dumps/dev-data-<timestamp>.sql  (path printed on stdout)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
set -a; . "$ROOT/.env.local"; [ -f "$ROOT/.env.prod.local" ] && . "$ROOT/.env.prod.local"; set +a
: "${DEV_SUPABASE_DB_URL:?set DEV_SUPABASE_DB_URL in .env.local or .env.prod.local}"
[ -n "${PG_BIN:-}" ] && PATH="$PG_BIN:$PATH"
command -v pg_dump >/dev/null || { echo "pg_dump not found — add the PostgreSQL bin to PATH or set PG_BIN in .env.prod.local" >&2; exit 1; }
OUT_DIR="$ROOT/scripts/sync-prod/.dumps"; mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/dev-data-$TS.sql"
# Select every table with -t patterns. IMPORTANT: do NOT mix --schema with --table here — when
# any -t is present pg_dump ignores -n and dumps ONLY the -t tables, which silently drops all of
# public. So public is selected via its own -t pattern, alongside the 5 auth tables (kept in
# lockstep with restore-prod.sh's truncate list).
pg_dump "$DEV_SUPABASE_DB_URL" --data-only --no-owner --no-privileges \
  --table='public.*' \
  --table=auth.users --table=auth.identities --table=auth.mfa_factors \
  --table=auth.mfa_amr_claims --table=auth.sessions \
  -f "$OUT"
echo "$OUT"
