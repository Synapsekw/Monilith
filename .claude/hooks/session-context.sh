#!/usr/bin/env bash
#
# SessionStart hook: compact repo/vault context dump to stdout (Claude Code
# injects SessionStart stdout as session context). Replaces the ~5 ad-hoc
# Bash calls + north-star read every session burned on boot orientation.
#
# Constraints (deliberate):
#   - bash 3.2 / macOS safe: no associative arrays, no mapfile, no ${var,,}.
#   - NO network — never `git fetch`; ahead/behind is vs the LOCAL
#     origin/develop ref, which may be stale. That's fine for orientation.
#   - ALWAYS exit 0 (a failing SessionStart hook would degrade every session);
#     print whatever is available and keep going.
#   - Target <1s: local git plumbing + one awk over the north-star only.

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$ROOT" 2>/dev/null || true

echo "=== Pulse session context (auto-injected at SessionStart) ==="

if git rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  head_line=$(git log -1 --format='%h %s' 2>/dev/null || echo "(no commits)")
  echo "Branch: $branch @ $head_line"

  # Real uncommitted changes: exclude .obsidian/* noise (workspace churn).
  # Porcelain path starts at column 4; renames show "old -> new" but the
  # old path is what col 4 holds, good enough for a count.
  dirty=$(git status --porcelain 2>/dev/null \
    | awk 'substr($0,4) !~ /^"?\.obsidian\//' | grep -c . || true)

  if git rev-parse --verify -q origin/develop >/dev/null 2>&1; then
    counts=$(git rev-list --left-right --count origin/develop...HEAD 2>/dev/null || echo "? ?")
    behind=$(echo "$counts" | awk '{print $1}')
    ahead=$(echo "$counts" | awk '{print $2}')
    echo "Uncommitted: $dirty file(s) (excl. .obsidian) · vs local origin/develop: ahead $ahead, behind $behind (no fetch — may be stale)"
  else
    echo "Uncommitted: $dirty file(s) (excl. .obsidian) · origin/develop ref not found"
  fi

  echo "Worktrees:"
  git worktree list 2>/dev/null | sed 's/^/  /' || echo "  (unavailable)"
else
  echo "Not inside a git repository ($ROOT)."
fi

NS="vault/00-north-star.md"
if [ -f "$NS" ]; then
  echo "North-star §3 (Now):"
  # Bullet lines only, between the "## 3" heading and the first "### "
  # subheading — skips the dataview blocks further down the section.
  awk '/^## 3/{f=1; next} f && /^### /{exit} f && /^- /{print}' "$NS"
else
  echo "North-star not found ($NS)."
fi

echo "Full context: scripts/wrapup-context.sh · full north-star: vault/00-north-star.md"

exit 0
