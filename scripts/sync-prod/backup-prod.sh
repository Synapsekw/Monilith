#!/usr/bin/env bash
# Safety snapshot of PROD (schema + data) BEFORE any destructive restore.
# Output: scripts/sync-prod/.dumps/prod-backup-<timestamp>.sql  (path printed on stdout)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
set -a; . "$ROOT/.env.local"; [ -f "$ROOT/.env.prod.local" ] && . "$ROOT/.env.prod.local"; set +a
: "${PROD_SUPABASE_DB_URL:?set PROD_SUPABASE_DB_URL in .env.prod.local}"
OUT_DIR="$ROOT/scripts/sync-prod/.dumps"; mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/prod-backup-$TS.sql"
pnpm exec supabase db dump --db-url "$PROD_SUPABASE_DB_URL" \
  --schema public --schema auth --schema storage -f "$OUT"
echo "Prod backup written: $OUT"
