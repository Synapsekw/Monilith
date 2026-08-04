#!/usr/bin/env bash
#
# sweep-orphaned-vitest.sh [worktree-root]
#
# Kills vitest processes belonging to ONE worktree that outlived the run that
# started them. finish-task.sh could exit 0 while `pnpm test`'s workers were
# still alive and still pointed at the LIVE dev project — a silent, invisible
# writer against real user data long after the task reported success.
#
# Scoping: measured on macOS / pnpm 10 / vitest 4, the runner AND every worker
# carry the worktree's absolute node_modules path in their argv, e.g.
#   node /…/.claude/worktrees/<name>/node_modules/.bin/../vitest/vitest.mjs run
#   node --require /…/.claude/worktrees/<name>/node_modules/.pnpm/vitest@4.1.8/…
# so matching on "<worktree>/node_modules" + "vitest" hits exactly the processes
# this worktree started — never a sibling worktree's concurrent run, never the
# main checkout's. That precision is the whole reason this is safe to automate.
#
# Always exits 0: it is a cleanup, not a gate.

set -uo pipefail

WT="${1:-$(git rev-parse --show-toplevel)}"

# pgrep -f matches against the full argv. Escape the regex metacharacters that
# can appear in a path so the pattern stays anchored to this worktree.
ESCAPED="$(printf '%s' "$WT/node_modules" | sed 's/[][\.*^$+?(){}|\/]/\\&/g')"

find_orphans() {
  # Exclude our own pid and pgrep's, which would otherwise match via argv.
  pgrep -f "${ESCAPED}.*vitest" 2>/dev/null | grep -v "^$$\$" || true
}

PIDS="$(find_orphans)"
[ -z "$PIDS" ] && exit 0

echo "!! orphaned vitest process(es) survived the run — killing: $(echo "$PIDS" | tr '\n' ' ')"
echo "   they were still pointed at the live dev project."

echo "$PIDS" | xargs kill 2>/dev/null || true
sleep 1

REMAINING="$(find_orphans)"
if [ -n "$REMAINING" ]; then
  echo "   still alive after SIGTERM — SIGKILL: $(echo "$REMAINING" | tr '\n' ' ')"
  echo "$REMAINING" | xargs kill -9 2>/dev/null || true
fi

exit 0
