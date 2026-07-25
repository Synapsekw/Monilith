#!/usr/bin/env bash
#
# reconcile-migration-version.sh <applied-version> <file-version-or-filename>
#
# Encodes the gotcha-55 ledger repair: when a migration was applied to DEV via
# the MCP `apply_migration` (which stamps its own now()-based version) but was
# committed to `supabase/migrations/` under a different version, the two
# ledgers disagree on a version string for the SAME DDL and `/sync-prod`'s
# parity gate hard-stops on a phantom divergence.
#
# The committed FILE is the source of truth — the fix is to relabel the DEV
# ledger row to the file's version (metadata-only UPDATE; no schema change).
# This script does NOT touch the database: it validates the two versions
# against `supabase/migrations/` and PRINTS the exact SQL to run via the
# supabase-dev MCP `execute_sql`, including the identity check the ADR
# requires BEFORE relabelling and a verification query for after.
#
# Scope: this repairs a version LABEL drift (gotcha-55) — the file exists, the
# ledger row exists, they disagree. It is NOT the tool for a ledger row with no
# file at all (gotcha-57): use scripts/check-migration-ledger.mjs, which detects
# that case and prints the DDL to backfill.
#
# Usage:
#   scripts/reconcile-migration-version.sh 20260709174837 20260709090000
#   scripts/reconcile-migration-version.sh 20260709174837 20260709090000_write_confinement_cross_org_guards.sql

set -euo pipefail

APPLIED="${1:-}"
FILEARG="${2:-}"
if [ -z "$APPLIED" ] || [ -z "$FILEARG" ]; then
  echo "usage: scripts/reconcile-migration-version.sh <applied-wrong-version> <committed-file-version-or-filename>" >&2
  exit 1
fi

WT="$(git rev-parse --show-toplevel)"
MIG_DIR="$WT/supabase/migrations"

# Printed by every "there is no committed file for that version" exit: those are
# gotcha-57, not gotcha-55, and this script is the wrong tool for them.
gotcha_57_routing() {
  echo "" >&2
  echo "       If the ledger has a version with NO committed file AT ALL, that is gotcha-57," >&2
  echo "       not gotcha-55 — there is no label to reconcile, the DDL is simply missing from" >&2
  echo "       git. This script cannot help. Instead:" >&2
  echo "         1. node scripts/check-migration-ledger.mjs --env dev --show-ddl" >&2
  echo "         2. write supabase/migrations/<ledger-version>_<slug>.sql with those statements" >&2
  echo "            — backfill AT THE LEDGER'S VERSION; do NOT mint a new stamp." >&2
  echo "         3. pnpm db:ledger-check   # expect ✓ in sync" >&2
}

if ! printf '%s' "$APPLIED" | grep -Eq '^[0-9]{14}$'; then
  echo "error: <applied-version> must be a 14-digit version (YYYYMMDDHHMMSS). got: '$APPLIED'" >&2
  exit 1
fi

# Resolve the second arg to exactly one committed migration file.
FILEBASE="$(basename "$FILEARG")"
if printf '%s' "$FILEBASE" | grep -Eq '^[0-9]{14}$'; then
  MATCHES="$(ls "$MIG_DIR" | grep "^${FILEBASE}_" || true)"
  if [ -z "$MATCHES" ]; then
    echo "error: no file in supabase/migrations/ has version prefix $FILEBASE." >&2
    gotcha_57_routing
    exit 1
  fi
  if [ "$(printf '%s\n' "$MATCHES" | wc -l | tr -d ' ')" != "1" ]; then
    echo "error: version prefix $FILEBASE matches multiple files (fix that first — see scripts/new-migration.sh):" >&2
    printf '%s\n' "$MATCHES" | sed 's/^/         /' >&2
    exit 1
  fi
  FILEBASE="$MATCHES"
fi
if [ ! -f "$MIG_DIR/$FILEBASE" ]; then
  echo "error: supabase/migrations/$FILEBASE does not exist — the committed file is the source of truth." >&2
  gotcha_57_routing
  exit 1
fi
if ! printf '%s' "$FILEBASE" | grep -Eq '^[0-9]{14}_[a-z0-9_-]+\.sql$'; then
  echo "error: '$FILEBASE' is not a <14-digit-version>_<slug>.sql migration filename." >&2
  exit 1
fi

FILE_VERSION="$(printf '%s' "$FILEBASE" | cut -c1-14)"
NAME="$(printf '%s' "$FILEBASE" | cut -c16- | sed 's/\.sql$//')"

if [ "$APPLIED" = "$FILE_VERSION" ]; then
  echo "error: applied version and file version are both $APPLIED — nothing to reconcile." >&2
  exit 1
fi
# The applied (wrong) version must be an orphan: if a committed file carries it,
# relabelling would orphan THAT file's ledger row instead.
APPLIED_FILE="$(ls "$MIG_DIR" | grep "^${APPLIED}_" || true)"
if [ -n "$APPLIED_FILE" ]; then
  echo "error: $APPLIED belongs to a committed file ($APPLIED_FILE) — refusing to relabel it away." >&2
  exit 1
fi

cat <<EOF
Ledger repair for: supabase/migrations/$FILEBASE
  DEV ledger row:  version $APPLIED  →  $FILE_VERSION  (name: $NAME)

Run each step on DEV via the supabase-dev MCP execute_sql. This is
metadata-only — it edits supabase_migrations.schema_migrations, no schema
objects (gotcha-55).

-- STEP 1 — verify identity BEFORE relabelling. Compare name + the actual
-- statements against the committed file (NOT a hash — Supabase strips comments
-- and re-normalizes whitespace, so hashes won't match even for identical DDL).
-- If the DDL does not match the file, STOP: this is not a version-only drift.
SELECT version, name, array_to_string(statements, E'\n') AS ddl
FROM supabase_migrations.schema_migrations
WHERE version = '$APPLIED';

-- STEP 2 — relabel the DEV ledger row to the committed file's version.
UPDATE supabase_migrations.schema_migrations
SET version = '$FILE_VERSION'
WHERE version = '$APPLIED' AND name = '$NAME';
-- (if STEP 1 showed the row under a different name — MCP applies record the
--  name passed to apply_migration — adjust the WHERE's name to that value.)

-- STEP 3 — verify: expect EXACTLY ONE row, version $FILE_VERSION.
-- Two rows means a row for the file version already existed — investigate
-- before proceeding (do not re-run STEP 2).
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version IN ('$APPLIED', '$FILE_VERSION');
EOF
