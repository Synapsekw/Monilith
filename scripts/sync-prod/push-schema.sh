#!/usr/bin/env bash
# Apply committed migrations to PROD (schema catch-up for /sync-prod step 1).
# Reads PROD_SUPABASE_DB_URL from .env.prod.local; never touches data.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ ! -f .env.prod.local ]]; then
  echo "error: .env.prod.local not found" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.prod.local
set +a

if [[ -z "${PROD_SUPABASE_DB_URL:-}" ]]; then
  echo "error: PROD_SUPABASE_DB_URL not set in .env.prod.local" >&2
  exit 1
fi

exec pnpm supabase db push --db-url "$PROD_SUPABASE_DB_URL"
