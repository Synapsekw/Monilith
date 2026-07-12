#!/usr/bin/env bash
#
# new-migration.sh <slug>
#
# Mints `supabase/migrations/<UTC-stamp>_<slug>.sql` with a REAL
# `date -u +%Y%m%d%H%M%S` version. Hand-invented stamps have shipped invalid
# hours (24/25), parallel branches have minted the same version (gotcha-43),
# and MCP `apply_migration` has stamped its own version so the remote ledger
# drifted from the committed filename (gotcha-55). This script makes the
# version trustworthy, checks for collisions across ALL worktrees before
# creating the file, and prints the apply/types steps so filename ==
# ledger-version stays true.
#
# Usage: scripts/new-migration.sh add_widgets_table

set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "usage: scripts/new-migration.sh <slug>   (lowercase, e.g. add_widgets_table)" >&2
  exit 1
fi
if ! printf '%s' "$SLUG" | grep -Eq '^[a-z0-9][a-z0-9_-]*$'; then
  echo "error: <slug> must be lowercase letters, digits, underscores or dashes. got: '$SLUG'" >&2
  exit 1
fi

WT="$(git rev-parse --show-toplevel)"
MIG_DIR="$WT/supabase/migrations"
if [ ! -d "$MIG_DIR" ]; then
  echo "error: $MIG_DIR not found — run this from inside the repo." >&2
  exit 1
fi

# Real UTC stamp — never hand-invent a version (that's how hour-24/25 stamps shipped).
VERSION="$(date -u +%Y%m%d%H%M%S)"
FILE="$MIG_DIR/${VERSION}_${SLUG}.sql"
REL="supabase/migrations/${VERSION}_${SLUG}.sql"

# Collision check (a): duplicate version prefix in THIS checkout.
CLASH="$(ls "$MIG_DIR" | grep "^${VERSION}_" || true)"
if [ -n "$CLASH" ]; then
  echo "error: version $VERSION is already taken in this checkout:" >&2
  echo "$CLASH" | sed 's/^/         /' >&2
  echo "       wait a second and re-run." >&2
  exit 1
fi

# Collision check (b): scan the OTHER worktrees' migration dirs. A sibling
# branch carrying an unmerged migration is exactly how gotcha-43's same-version
# collision (and its forced merge ordering) happens — warn loudly up front.
WARNED=0
WORKTREES="$(git worktree list --porcelain | sed -n 's/^worktree //p')"
while IFS= read -r OTHER; do
  [ -n "$OTHER" ] || continue
  [ "$OTHER" = "$WT" ] && continue
  [ -d "$OTHER/supabase/migrations" ] || continue

  SAME_SECOND="$(ls "$OTHER/supabase/migrations" | grep "^${VERSION}_" || true)"
  if [ -n "$SAME_SECOND" ]; then
    echo "" >&2
    echo "!! WARNING: worktree $OTHER already has a migration with THIS EXACT version ($VERSION):" >&2
    echo "$SAME_SECOND" | sed 's/^/     /' >&2
    echo "   two files sharing one version corrupt the supabase ledger (gotcha-43). Aborting." >&2
    exit 1
  fi

  UNMERGED=""
  for F in $(ls "$OTHER/supabase/migrations"); do
    [ -e "$MIG_DIR/$F" ] || UNMERGED="$UNMERGED $F"
  done
  if [ -n "$UNMERGED" ]; then
    WARNED=1
    echo "" >&2
    echo "!! WARNING: worktree $OTHER carries UNMERGED migration(s) not in this checkout:" >&2
    for F in $UNMERGED; do echo "     $F" >&2; done
    echo "   (gotcha-43: parallel branches with migrations force a merge order — coordinate" >&2
    echo "    who lands first, and let the LAST DB-bearing branch re-run pnpm db:types.)" >&2
  fi
done <<EOF
$WORKTREES
EOF
[ "$WARNED" -eq 1 ] && echo "" >&2

cat > "$FILE" <<EOF
-- ${VERSION}_${SLUG}.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   TODO: describe the change.

EOF

echo "✓ created $REL"
echo ""
echo "  next:"
echo "  1. write the DDL in that file"
echo "  2. apply to DEV via the supabase-dev MCP apply_migration with the SAME"
echo "     version+name — name: \"${VERSION}_${SLUG}\" — so the remote ledger row"
echo "     matches this filename (gotcha-55). Then verify:"
echo "       select version, name from supabase_migrations.schema_migrations"
echo "       order by version desc limit 3;"
echo "     if the ledger stamped a different version, repair it with:"
echo "       scripts/reconcile-migration-version.sh <ledger-version> ${VERSION}"
echo "  3. pnpm db:types   # regenerate src/types/database.types.ts"
echo "  4. commit the migration AND the regenerated types in the same PR"
