#!/usr/bin/env bash
# Data-only dump of DEV (public + auth + storage) for /sync-prod.
# Output: scripts/sync-prod/.dumps/dev-data-<timestamp>.sql  (path printed on stdout)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
set -a; . "$ROOT/.env.local"; [ -f "$ROOT/.env.prod.local" ] && . "$ROOT/.env.prod.local"; set +a
: "${DEV_SUPABASE_DB_URL:?set DEV_SUPABASE_DB_URL in .env.local or .env.prod.local}"
OUT_DIR="$ROOT/scripts/sync-prod/.dumps"; mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/dev-data-$TS.sql"
pnpm exec supabase db dump --db-url "$DEV_SUPABASE_DB_URL" --data-only \
  --schema public --schema auth --schema storage -f "$OUT"
echo "$OUT"
