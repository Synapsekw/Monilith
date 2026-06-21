#!/usr/bin/env bash
#
# finish-task.sh
#
# Completes the current task worktree. Run it from INSIDE a `task/<name>`
# worktree (the folder start-task.sh created). It:
#   1. verifies the worktree is committed and clean
#   2. runs typecheck / lint / test / build
#   3. merges task/<name> directly into develop and pushes
#   4. removes the worktree and deletes the branch
#
# A task is not "done" until this completes successfully.

set -euo pipefail

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
case "$BRANCH" in
  task/*) : ;;
  *)
    echo "error: not on a task/* branch (on '$BRANCH')." >&2
    echo "       run this from inside the worktree start-task.sh created." >&2
    exit 1
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "error: you have uncommitted changes — commit them before finishing." >&2
  git status --short >&2
  exit 1
fi

WT="$(git rev-parse --show-toplevel)"
MAIN="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"

echo "→ running checks (typecheck / lint / test / build)…"
pnpm typecheck
pnpm lint
pnpm test
pnpm build

echo "→ merging $BRANCH into develop…"
git -C "$MAIN" checkout develop
git -C "$MAIN" pull --ff-only origin develop
git -C "$MAIN" merge --no-ff "$BRANCH" -m "Merge $BRANCH into develop"
git -C "$MAIN" push origin develop

echo "→ cleaning up worktree + branch…"
git -C "$MAIN" worktree remove "$WT"
git -C "$MAIN" branch -d "$BRANCH"

echo ""
echo "✓ done: $BRANCH merged into develop, pushed, worktree removed, branch deleted."
echo "  your shell is in a folder that no longer exists — cd \"$MAIN\""
echo ""
echo "  NEXT (closure): give the user a numbered 'How to test this' walkthrough"
echo "  — in your closing message AND the /wrapup session note. If nothing is"
echo "  user-facing, say so in one line. (AGENTS.md working agreement #1.)"
