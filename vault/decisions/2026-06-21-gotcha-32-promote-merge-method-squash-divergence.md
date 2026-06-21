---
type: decision
date: 2026-06-21
status: accepted
tags: [decision, gotcha, promotion, git, ci]
related:
  [
    "[[2026-06-21-1653-6g-workspaces-and-prod-promotion]]",
    "[[2026-06-21-1416-promote-command-build]]",
    "[[2026-06-21-promote-command-design]]",
  ]
---

# gotcha-32: `/promote` assumes merge commits, but the repo allows only squash — squash re-diverges develop/main

## Context

The first real `develop → main` promotion (PR #21) hit two compounding traps:

1. **Squash-merge divergence.** Prior promotions (#16/#18/#19) were **squash** merges. A squash
   collapses develop's real commits into one commit on `main` that does not exist in develop's
   history, so git cannot see that `main`'s content is already contained in `develop`. The next
   `develop → main` PR then does a 3-way merge from a stale base and flags every file that moved on
   develop as "changed in both" → `CONFLICTING`, even though `main ⊆ develop`.

2. **`/promote` used `gh pr merge --merge`**, but this repo has `allow_merge_commit: false`
   (only squash + rebase). So the merge was rejected outright (`GraphQL: Merge commits are not
allowed`), and the fallback was `--squash` — which re-creates trap #1 for next time.

A third, related snag: the promotion PR's `commitlint (PR)` job lints `base..head` = the **entire**
develop history, surfacing old non-conventional commit messages that were already linted on their
way into develop. (Required check is only `verify`, so it didn't block — but it read as red.)

## Decision / workaround used this time

- **Healed the divergence** by back-merging `origin/main` into `develop` with `-X ours` (resolve all
  conflicts to develop, the superset), verifying `git diff <develop-tip> HEAD` was **empty** (tree
  byte-identical — nothing lost), then pushing develop. That made PR #21 mergeable.
- **Merged with `--squash`** (the only allowed lossless method here besides rebase).
- **Fixed the commitlint noise** in `ci.yml`: the `commitlint (PR)` job now also requires
  `github.base_ref != 'main'`, so it **skips on promotion PRs** (history is already linted on the
  way into develop) while still running for `task/* → develop` PRs.

## Consequence / what to fix in `/promote`

Squash promotion means **every future promotion re-diverges and will need the same back-merge heal**.
Pick one durable fix and bake it into the `/promote` command + spec:

- **(a)** Switch the command to `--squash` **and auto-heal after**: immediately back-merge the new
  `main` into `develop` (`-X ours`, assert empty tree-diff) so ancestry is restored each time; **or**
- **(b)** Enable `allow_merge_commit` on the repo and keep `--merge` (real merge commit → no
  divergence, ancestry always intact). Cleanest, but changes repo settings.

Until then: a promotion is **back-merge-heal → squash-merge → (with (a)) back-merge-heal again**.
The `commitlint`-skip-on-`base_ref==main` rule is already shipped and is independent of the above.
