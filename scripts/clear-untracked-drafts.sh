#!/usr/bin/env bash
#
# clear-untracked-drafts.sh [worktree-root]
#
# Removes the stop-hook's generated session drafts (vault/sessions/_draft-*.md)
# so they never block finish-task.sh's clean-tree check.
#
# Only UNTRACKED drafts. finish-task.sh used to do this with a naked
#   rm -f "$WT"/vault/sessions/_draft-*.md
# which also deleted a *committed* draft — dirtying the tree and failing the very
# clean-tree check it runs immediately after, for every session in the repo until
# someone noticed (one such draft was committed in 023b4676). A tracked draft is
# real content someone chose to keep; only an untracked one is generated noise.
#
# Extracted from finish-task.sh so it can be tested behaviourally
# (scripts/clear-untracked-drafts.test.mjs) rather than by grepping the script.

set -euo pipefail

WT="${1:-$(git rev-parse --show-toplevel)}"

# -z/read -d '' so a path with spaces or a newline can't split into two names.
# `--others --exclude-standard` is exactly "untracked and not ignored".
while IFS= read -r -d '' draft; do
  rm -f "$WT/$draft"
done < <(
  git -C "$WT" ls-files --others --exclude-standard -z \
    -- 'vault/sessions/_draft-*.md'
)
