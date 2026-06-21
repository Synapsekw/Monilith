#!/usr/bin/env bash
#
# start-task.sh <name>
#
# Begins a building session in its own isolated git worktree so parallel
# sessions never stomp each other's files. Creates branch `task/<name>` off the
# latest origin/develop in a sibling folder `../Monolith-<name>`, and pins the
# commit identity Vercel expects.
#
# Finish the session with scripts/finish-task.sh (merges into develop + cleans up).

set -euo pipefail

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "usage: scripts/start-task.sh <name>   (kebab-case, e.g. dark-reskin)" >&2
  exit 1
fi
if ! printf '%s' "$NAME" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
  echo "error: <name> must be kebab-case (a-z, 0-9, -). got: '$NAME'" >&2
  exit 1
fi

# Resolve the main checkout (the dir whose .git is the common git dir).
MAIN="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"
BRANCH="task/$NAME"
WT="$MAIN/../Monolith-$NAME"

if git -C "$MAIN" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "error: branch $BRANCH already exists — pick another name or finish the existing task." >&2
  exit 1
fi
if [ -e "$WT" ]; then
  echo "error: folder $WT already exists." >&2
  exit 1
fi

echo "→ fetching latest develop…"
git -C "$MAIN" fetch origin develop

echo "→ creating worktree $WT on $BRANCH…"
git -C "$MAIN" worktree add -b "$BRANCH" "$WT" origin/develop

# Pin the commit identity Vercel deploys from (verified on the Synapsekw account).
git -C "$WT" config user.name  "Danijel Jovanovic"
git -C "$WT" config user.email "info@synapse-solutions.ai"

WT_ABS="$(cd "$WT" && pwd)"
echo ""
echo "✓ ready. branch $BRANCH in $WT_ABS"
echo "  identity: $(git -C "$WT_ABS" config user.name) <$(git -C "$WT_ABS" config user.email)>"
echo ""
echo "  next:  cd \"$WT_ABS\""
echo "  done:  scripts/finish-task.sh   (run from inside the worktree)"
