#!/usr/bin/env bash
#
# wrapup-context.sh
#
# One-shot, read-only context dump for /wrapup step 1. Replaces the 3–5 ad-hoc
# Bash calls (date, branch, status, north-star peek, draft check) with a single
# invocation. Prints labeled plain-text sections — no color codes, no mutation.
#
# macOS-safe: bash 3.2, BSD date/ls, no GNU coreutils assumptions.

set -uo pipefail

section() {
  echo ""
  echo "== $1 =="
}

# ---- date/time -------------------------------------------------------------
section "DATE"
echo "local:    $(date '+%Y-%m-%d %H:%M (%A)')"
echo "utc:      $(date -u '+%Y-%m-%d %H:%M')"
echo "note-id:  $(date '+%Y-%m-%d-%H%M')   (session-note filename prefix)"

# ---- location: cwd, repo root, worktree? -----------------------------------
section "LOCATION"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  echo "error: not inside a git repository (cwd: $(pwd))" >&2
  exit 1
fi
GIT_DIR="$(git rev-parse --absolute-git-dir)"
COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null \
              || git rev-parse --git-common-dir)"
echo "cwd:       $(pwd)"
echo "repo root: $ROOT"
if [ "$GIT_DIR" != "$COMMON_DIR" ]; then
  MAIN="$(dirname "$COMMON_DIR")"
  echo "worktree:  YES (linked worktree; main checkout: $MAIN)"
else
  echo "worktree:  no (this is the main checkout)"
fi

# ---- branch + HEAD ---------------------------------------------------------
section "BRANCH"
echo "branch: $(git rev-parse --abbrev-ref HEAD)"
echo "head:   $(git log -1 --format='%h %s')"

# ---- working-tree status ---------------------------------------------------
section "STATUS (git status --short)"
STATUS_ALL="$(git status --short)"
if [ -z "$STATUS_ALL" ]; then
  echo "clean — no uncommitted changes"
else
  STATUS_REAL="$(printf '%s\n' "$STATUS_ALL" | grep -v ' \.obsidian/' || true)"
  STATUS_NOISE="$(printf '%s\n' "$STATUS_ALL" | grep ' \.obsidian/' || true)"
  if [ -n "$STATUS_REAL" ]; then
    echo "changed paths ($(printf '%s\n' "$STATUS_REAL" | grep -c .)):"
    printf '%s\n' "$STATUS_REAL"
  else
    echo "no real changes"
  fi
  if [ -n "$STATUS_NOISE" ]; then
    echo "(.obsidian noise, ignore: $(printf '%s\n' "$STATUS_NOISE" | grep -c .) path(s))"
  fi
fi

# ---- ahead/behind vs origin/develop ----------------------------------------
section "VS origin/develop"
if git rev-parse --verify --quiet origin/develop >/dev/null; then
  COUNTS="$(git rev-list --left-right --count origin/develop...HEAD 2>/dev/null || true)"
  if [ -n "$COUNTS" ]; then
    BEHIND="$(printf '%s' "$COUNTS" | awk '{print $1}')"
    AHEAD="$(printf '%s' "$COUNTS" | awk '{print $2}')"
    echo "ahead $AHEAD, behind $BEHIND (vs local ref origin/develop — no fetch performed)"
  else
    echo "could not compute (unrelated histories?)"
  fi
else
  echo "origin/develop ref not found"
fi

# ---- north-star: current status section (§3) --------------------------------
section "NORTH-STAR §3 ($ROOT/vault/00-north-star.md)"
NS="$ROOT/vault/00-north-star.md"
if [ -f "$NS" ]; then
  # Extract from the "## 3" heading to (not including) the next "## " heading.
  # Matches "## 3. Now", "## 3 Now", etc. — robust to renaming after the number.
  awk '/^## 3[. ]/{flag=1} flag && /^## / && !/^## 3[. ]/{exit} flag{print}' "$NS"
  echo ""
  echo "(frontmatter last-updated: $(awk -F': *' '/^last-updated:/{print $2; exit}' "$NS"))"
else
  echo "not found — cannot show current status"
fi

# ---- session drafts + recent notes ------------------------------------------
section "SESSION DRAFTS (vault/sessions/_draft-*.md)"
DRAFTS="$(find "$ROOT/vault/sessions" -maxdepth 1 -name '_draft-*.md' 2>/dev/null || true)"
if [ -n "$DRAFTS" ]; then
  printf '%s\n' "$DRAFTS"
  echo "→ fold draft content into the new session note, then delete the draft(s)."
else
  echo "none"
fi

section "RECENT SESSION NOTES (3 newest)"
# BSD ls -t: newest first. Exclude drafts.
(cd "$ROOT/vault/sessions" 2>/dev/null && ls -t ./*.md 2>/dev/null \
  | grep -v '^\./_draft-' | head -3 | sed 's|^\./||') \
  || echo "none found"

echo ""
