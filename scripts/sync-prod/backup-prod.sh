#!/usr/bin/env bash
# Safety snapshot of PROD's current data BEFORE any destructive restore. Same scope as the dev dump
# (public + the 5 auth user tables, data-only) so it can be loaded back via restore-prod.sh if a
# sync goes wrong. Uses pg_dump directly (no Docker). Set PG_BIN in .env.prod.local if pg_dump is
# not on PATH.
# Output: scripts/sync-prod/.dumps/prod-backup-<timestamp>.sql  (path printed on stdout)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
set -a; . "$ROOT/.env.local"; [ -f "$ROOT/.env.prod.local" ] && . "$ROOT/.env.prod.local"; set +a
: "${PROD_SUPABASE_DB_URL:?set PROD_SUPABASE_DB_URL in .env.prod.local}"
[ -n "${PG_BIN:-}" ] && PATH="$PG_BIN:$PATH"
command -v pg_dump >/dev/null || { echo "pg_dump not found — add the PostgreSQL bin to PATH or set PG_BIN in .env.prod.local" >&2; exit 1; }
OUT_DIR="$ROOT/scripts/sync-prod/.dumps"; mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/prod-backup-$TS.sql"
pg_dump "$PROD_SUPABASE_DB_URL" --data-only --no-owner --no-privileges \
  --table='public.*' \
  --table=auth.users --table=auth.identities --table=auth.mfa_factors \
  --table=auth.mfa_amr_claims --table=auth.sessions \
  -f "$OUT"
echo "Prod backup written: $OUT"
