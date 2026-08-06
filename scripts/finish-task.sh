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
#   5. installs in the MAIN checkout if the merge changed dependencies
#   6. removes the worktree and deletes the branch
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

WT="$(git rev-parse --show-toplevel)"
MAIN="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"

# Stop-hook session drafts are generated noise — clear them BEFORE the clean-tree
# check so they never block a finish (they were being rm'd by hand every session).
# UNTRACKED ones only: this used to be a naked `rm -f …/_draft-*.md`, which also
# deleted a *committed* draft and so dirtied the tree, failing the clean-tree
# check immediately below — for every session in the repo (023b4676).
"$WT/scripts/clear-untracked-drafts.sh" "$WT"

if [ -n "$(git status --porcelain)" ]; then
  echo "error: you have uncommitted changes — commit them before finishing." >&2
  git status --short >&2
  exit 1
fi

# gotcha-54: two worktrees running the heavy gates (vitest forks + next build)
# concurrently exhaust the machine → phantom cross-suite failures and 10× runs.
# Serialize the whole rebase→gate→merge pipeline machine-wide with an atomic
# mkdir lock in the shared git dir (bash-3.2/macOS safe — no flock). Holding it
# from before the rebase is what makes serialization *correct*, not just calm:
# each finisher rebases onto — and gates against — the previous finisher's merge.
GATE_LOCK="$(cd "$(git rev-parse --git-common-dir)" && pwd)/finish-task-gate.lock"
GATE_LOCK_HELD=""
# `pnpm test` can leave vitest workers alive after the runner returns — this
# script would then finish with an invisible process still writing against the
# LIVE dev project. Sweep them, scoped to this worktree's node_modules so a
# sibling worktree's concurrent run is never touched.
#
# The trap covers the ABNORMAL exits (gate failure, ^C, rebase conflict). It
# cannot cover the success path: step 5 removes the worktree, taking the sweep
# script with it — so the success path sweeps explicitly, right after the gates
# and while $WT still exists.
SWEEP="$WT/scripts/sweep-orphaned-vitest.sh"
on_exit() {
  [ -n "$GATE_LOCK_HELD" ] && rm -rf "$GATE_LOCK"
  [ -x "$SWEEP" ] && "$SWEEP" "$WT"
  return 0
}
trap on_exit EXIT

echo "→ acquiring machine-wide gate lock (serialized finishes — gotcha-54)…"
WAITED=0
while ! mkdir "$GATE_LOCK" 2>/dev/null; do
  HOLDER="$(cat "$GATE_LOCK/pid" 2>/dev/null || true)"
  # Steal the lock if the recorded holder process is gone (crashed finish).
  if [ -n "$HOLDER" ] && ! kill -0 "$HOLDER" 2>/dev/null; then
    echo "  lock holder (pid $HOLDER) is dead — stealing the stale lock"
    rm -rf "$GATE_LOCK"
    continue
  fi
  if [ "$WAITED" -ge 1800 ]; then
    echo "error: gave up after 30min waiting for the gate lock (held by pid ${HOLDER:-unknown})." >&2
    echo "       if no other finish-task.sh is really running:  rm -rf \"$GATE_LOCK\"  and re-run." >&2
    exit 1
  fi
  if [ $((WAITED % 30)) -eq 0 ]; then
    echo "  another worktree is running its gates (pid ${HOLDER:-unknown}) — waiting… (${WAITED}s)"
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
echo "$$" > "$GATE_LOCK/pid"
GATE_LOCK_HELD=1

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

# gotcha-39: the rebase can bring dependency changes from develop, but a rebase
# never runs pnpm install — refresh node_modules so the gates don't run stale.
echo "→ refreshing dependencies after rebase (pnpm install --prefer-offline)…"
pnpm install --prefer-offline

# Migration hygiene, one check, two gotchas (scripts/check-migration-ledger.mjs):
#   - gotcha-43 (offline): two committed files sharing one version prefix corrupt
#     the ledger. This guard used to be inlined here; it moved into the script so
#     there is one implementation, and it still runs with no network.
#   - gotcha-57 (needs DEV): a ledger row with NO committed file. `db push` reads
#     files, so such a change can never reach PROD — it is lost, and a revoke/grant
#     on a SECURITY DEFINER function can vanish silently. Run AFTER the rebase so
#     already-merged siblings' files are present, and BEFORE the heavy gates so a
#     hit costs ~1.5s instead of a full build.
# Exit codes: 0 ok · 1 local failure · 2 drift · 3 could-not-check · 4 usage.
# 3 must NEVER block: gating a merge on a network call is how a gate wedges every
# future task. It warns loudly and continues.
echo "→ checking migration hygiene (files ↔ DEV ledger)…"
LEDGER_RC=0
node "$WT/scripts/check-migration-ledger.mjs" --env dev || LEDGER_RC=$?
case "$LEDGER_RC" in
  0) : ;;
  3)
    echo "" >&2
    echo "!! WARNING: could not verify the DEV migration ledger (reason above)." >&2
    echo "   Files-vs-ledger drift was NOT checked (gotcha-57). Re-run manually" >&2
    echo "   when you have connectivity:  pnpm db:ledger-check" >&2
    echo "" >&2
    ;;
  *)
    echo "" >&2
    echo "error: migration hygiene check failed (exit $LEDGER_RC) — see above." >&2
    echo "       not merging. fix it, commit, then re-run finish-task.sh." >&2
    echo "       (last resort, audited: PULSE_SKIP_LEDGER_CHECK=1 scripts/finish-task.sh)" >&2
    exit 1
    ;;
esac

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
# cacheLife stale-types trap: typecheck runs before build, so a rebase that
# brings a new cacheLife("X") profile from develop fails typecheck against the
# worktree's stale generated .next/types even though the code is fine. Drop
# only the generated types — keep the rest of .next (build cache).
rm -rf "$WT/.next/types"
echo "→ running checks (typecheck / lint / test / build) against integrated state…"
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# The gates are done with the worktree's node_modules — anything vitest still
# has running here outlived its runner. Sweep before the merge, while $WT (and
# therefore the sweep script) still exists; the EXIT trap only covers the paths
# that never reach this line.
"$SWEEP" "$WT"

# Author-email assertion: Vercel only deploys commits authored as
# info@synapse-solutions.ai (verified on Synapsekw) — any other email makes it
# SILENTLY skip the deploy. Block the merge while it's still cheap to rewrite.
BAD_AUTHORS="$(git log develop..HEAD --format='%h %ae' | grep -v ' info@synapse-solutions\.ai$' || true)"
if [ -n "$BAD_AUTHORS" ]; then
  echo "error: commits in develop..HEAD not authored as info@synapse-solutions.ai:" >&2
  echo "$BAD_AUTHORS" | sed 's/^/         /' >&2
  echo "       fix the identity, rewrite the branch's authors, then re-run finish-task.sh:" >&2
  echo "         git config user.name \"Danijel Jovanovic\"" >&2
  echo "         git config user.email info@synapse-solutions.ai" >&2
  echo "         git rebase develop --exec 'git commit --amend --no-edit --reset-author'" >&2
  exit 1
fi

# 5. Merge + push. The task is already rebased onto develop, so --no-ff is
#    conflict-free and keeps the merge-commit convention. Retry the push once if
#    origin advanced again in the gap.
echo "→ merging $BRANCH into develop…"
DEVELOP_BEFORE_MERGE="$(git -C "$MAIN" rev-parse HEAD)"
git -C "$MAIN" merge --no-ff "$BRANCH" -m "Merge $BRANCH into develop"
if ! git -C "$MAIN" push origin develop; then
  echo "→ push rejected (origin moved) — re-syncing develop and retrying once…"
  git -C "$MAIN" -c rebase.autoStash=true pull --rebase origin develop
  git -C "$MAIN" push origin develop
fi

# 6. Install into the MAIN checkout when this merge changed dependencies.
#
# The gates in step 4 ran inside the WORKTREE, against the worktree's own
# node_modules (start-task.sh installs there). So a task that adds a dependency
# merges perfectly green and then leaves the main checkout — and any dev server
# already running from it — resolving against a node_modules that predates the
# merge. The symptom is a build error that reads like a code bug:
#
#   Module not found: Can't resolve 'idb-keyval'
#
# even though package.json and pnpm-lock.yaml are both correct on develop. That
# is a real trap, hit by task/offline-read-only; the fix is always just an
# install, so do it here instead of leaving it to be rediscovered.
#
# Never fatal: the merge and push have already happened by this point, and
# aborting would strand the worktree and branch. A failure is reported loudly
# with the one command that fixes it.
DEP_CHANGES="$(git -C "$MAIN" diff --name-only "$DEVELOP_BEFORE_MERGE" HEAD -- package.json pnpm-lock.yaml)"
if [ -n "$DEP_CHANGES" ]; then
  echo "→ this merge changed dependencies — installing in $MAIN…"
  if (cd "$MAIN" && pnpm install --frozen-lockfile); then
    DEPS_INSTALLED=1
  else
    DEPS_INSTALLED=0
    echo "  warning: pnpm install failed in $MAIN. The merge itself is fine —" >&2
    echo "           run it yourself before building:" >&2
    echo "             (cd \"$MAIN\" && pnpm install)" >&2
  fi
else
  DEPS_INSTALLED=
fi

echo "→ cleaning up worktree + branch…"
git -C "$MAIN" worktree remove "$WT"
git -C "$MAIN" branch -d "$BRANCH"

echo ""
echo "✓ done: $BRANCH rebased onto develop, gated, merged, pushed, worktree removed, branch deleted."
echo "  your shell is in a folder that no longer exists — cd \"$MAIN\""
if [ "${DEPS_INSTALLED:-}" = "1" ]; then
  echo ""
  echo "  DEPENDENCIES CHANGED and were installed in the main checkout."
  echo "  Any dev server already running from $MAIN is still using the OLD"
  echo "  node_modules — restart it (Ctrl-C, then 'pnpm dev') or it will keep"
  echo "  failing with 'Module not found'."
fi
echo ""
echo "  NEXT (closure): give the user a numbered 'How to test this' walkthrough"
echo "  — in your closing message AND the /wrapup session note. If nothing is"
echo "  user-facing, say so in one line. (AGENTS.md working agreement #1.)"
