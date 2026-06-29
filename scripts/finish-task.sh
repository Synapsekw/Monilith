#!/usr/bin/env bash
#
# finish-task.sh
#
# Completes the current task worktree. Run it from INSIDE a `task/<name>`
# worktree (the folder start-task.sh created). It:
#   1. verifies the worktree is committed and clean
#   2. refreshes develop and rebases task/<name> onto it (auto-integration)
#   3. runs typecheck / lint / test / build AGAINST the integrated state
#   4. merges task/<name> directly into develop and pushes
#   5. removes the worktree and deletes the branch
#
# Why integrate before gating: develop moves while you work (other sessions
# merge; the main checkout itself gains doc/vault commits). Gating the task tip
# in isolation can pass while the *merged* result is red. So we rebase onto the
# latest develop FIRST, then gate, so the checks see exactly what lands. This
# also replaces the brittle `pull --ff-only` (which aborts the moment local
# develop has diverged from origin) with `pull --rebase`.
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

# 1. Refresh the integration target. `pull --rebase` covers every case in one go:
#    local behind → fast-forward · local ahead (unpushed vault/doc commits) → no-op ·
#    local diverged → replays local commits onto origin (the gotcha-31 bonus trap).
#    autoStash protects the persistently-dirty .obsidian/* tree in the main checkout.
echo "→ refreshing develop (fetch + rebase local onto origin)…"
git -C "$MAIN" fetch origin develop
git -C "$MAIN" checkout develop
if ! git -C "$MAIN" -c rebase.autoStash=true pull --rebase origin develop; then
  echo "error: local develop in the main checkout conflicts with origin/develop." >&2
  echo "       resolve it in $MAIN (git status), then re-run finish-task.sh." >&2
  exit 1
fi

# 2. Rebase the task branch onto the fresh develop, IN THE WORKTREE, so any
#    conflicts surface here and the gates below see the integrated state.
echo "→ rebasing $BRANCH onto the latest develop…"
if ! git rebase develop; then
  CONFLICTS="$(git diff --name-only --diff-filter=U | tr '\n' ' ')"
  git rebase --abort
  echo "" >&2
  echo "error: develop moved and auto-rebase hit conflicts: ${CONFLICTS:-<see above>}" >&2
  echo "       the rebase was aborted — your worktree is clean and unchanged." >&2
  echo "       resolve manually:  git rebase develop  (fix conflicts, git rebase --continue)" >&2
  echo "       then re-run finish-task.sh." >&2
  exit 1
fi

# 3. Keep the generated changelog in sync with `Changelog:` commit trailers.
#    CI has a develop-only drift gate (`git diff --exit-code src/lib/changelog/generated.ts`
#    after `pnpm changelog:gen`) that the local gates below do NOT cover — so a commit
#    carrying a `Changelog:` trailer passes here but fails CI (TOUCH Batch 2 hit this:
#    local green, CI red, fixed by a manual regen `45a2bbe`). Regenerate against the
#    integrated history and, if it drifted, commit the regen onto the task branch so it
#    lands in the merge. No-op when no trailer changed the file.
echo "→ syncing generated changelog (pnpm changelog:gen)…"
pnpm changelog:gen
if ! git diff --quiet -- src/lib/changelog/generated.ts; then
  echo "  changelog drifted — committing regenerated generated.ts onto $BRANCH"
  git add src/lib/changelog/generated.ts
  git commit -m "chore(changelog): regenerate generated.ts"
fi

# 4. Gates — now against the integrated (rebased) state.
echo "→ running checks (typecheck / lint / test / build) against integrated state…"
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# 5. Merge + push. The task is already rebased onto develop, so --no-ff is
#    conflict-free and keeps the merge-commit convention. Retry the push once if
#    origin advanced again in the gap.
echo "→ merging $BRANCH into develop…"
git -C "$MAIN" merge --no-ff "$BRANCH" -m "Merge $BRANCH into develop"
if ! git -C "$MAIN" push origin develop; then
  echo "→ push rejected (origin moved) — re-syncing develop and retrying once…"
  git -C "$MAIN" -c rebase.autoStash=true pull --rebase origin develop
  git -C "$MAIN" push origin develop
fi

echo "→ cleaning up worktree + branch…"
git -C "$MAIN" worktree remove "$WT"
git -C "$MAIN" branch -d "$BRANCH"

echo ""
echo "✓ done: $BRANCH rebased onto develop, gated, merged, pushed, worktree removed, branch deleted."
echo "  your shell is in a folder that no longer exists — cd \"$MAIN\""
echo ""
echo "  NEXT (closure): give the user a numbered 'How to test this' walkthrough"
echo "  — in your closing message AND the /wrapup session note. If nothing is"
echo "  user-facing, say so in one line. (AGENTS.md working agreement #1.)"
