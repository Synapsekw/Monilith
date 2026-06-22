#!/usr/bin/env bash
#
# start-task.sh <name>
#
# Begins a building session in its own isolated git worktree so parallel
# sessions never stomp each other's files. Creates branch `task/<name>` off the
# latest origin/develop in a NESTED folder `.claude/worktrees/<name>`, and pins
# the commit identity Vercel expects.
#
# Why nested (not a sibling ../Monolith-<name>): a worktree inside the project is
# inside the subagent sandbox, so subagent-driven development can write into it;
# a sibling cannot. (.claude/worktrees/ is gitignored.)
#
# Node's *import* resolution walks up, so app/test code resolves deps from the
# main checkout's node_modules — but pnpm does NOT add an ancestor
# node_modules/.bin to a script's PATH, so bare `vitest`/`tsc`/`eslint`/`next`
# in package.json scripts hit "command not found". So we run `pnpm install` here
# (≈6s warm, hardlinked into the global store → cheap real disk) to give the
# worktree a real node_modules/.bin, and symlink .env.local so integration tests
# don't silently skip. See the vault gotcha on worktree gates.
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
WT="$MAIN/.claude/worktrees/$NAME"

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

echo "→ creating worktree ${WT} on ${BRANCH}…"
git -C "$MAIN" worktree add -b "$BRANCH" "$WT" origin/develop

# Pin the commit identity Vercel deploys from (verified on the Synapsekw account).
git -C "$WT" config user.name  "Danijel Jovanovic"
git -C "$WT" config user.email "info@synapse-solutions.ai"

# Give the worktree a real node_modules/.bin so `pnpm typecheck/lint/test/build`
# resolve their binaries (pnpm won't reach an ancestor .bin). Warm store → ~6s,
# hardlinked. --prefer-offline avoids needless registry hits.
echo "→ installing dependencies in the worktree (≈6s warm)…"
( cd "$WT" && pnpm install --prefer-offline )

# Link .env.local from the main checkout so *.integration.test.ts run instead of
# silently skipping (they no-op when the env file is absent).
if [ -f "$MAIN/.env.local" ] && [ ! -e "$WT/.env.local" ]; then
  ln -s "$MAIN/.env.local" "$WT/.env.local"
  echo "→ linked .env.local → main checkout"
fi

WT_ABS="$(cd "$WT" && pwd)"
echo ""
echo "✓ ready. branch $BRANCH in $WT_ABS"
echo "  identity: $(git -C "$WT_ABS" config user.name) <$(git -C "$WT_ABS" config user.email)>"
echo ""
echo "  next:  cd \"$WT_ABS\""
echo "  dev:   pnpm dev -p 3001   (deps + .env.local ready in the worktree)"
echo "  agent: EnterWorktree({ path: \".claude/worktrees/$NAME\" }) to re-root + use subagents"
echo "  done:  scripts/finish-task.sh   (run from inside the worktree)"
