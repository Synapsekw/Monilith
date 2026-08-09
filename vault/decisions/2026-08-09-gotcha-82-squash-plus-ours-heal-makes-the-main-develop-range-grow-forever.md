---
type: adr
date: 2026-08-09
status: accepted
tags: [decision, gotcha, git, tooling, release]
related: ["[[2026-08-09-1702-desktop-drag-fix-and-pr89-promote]]", "[[2026-06-30-gotcha-32-squash-merge-breaks-develop-main-ancestry]]"]
---

# Gotcha 82 — squash + `-s ours` heal makes `origin/main..origin/develop` grow forever

## Context

Every promotion does two things: `gh pr merge --squash` collapses the delta into one new commit on
`main`, then the mandatory gotcha-32 heal back-merges `main` into `develop` with `-s ours` so
ancestry is restored and the next PR is not `CONFLICTING`.

Both steps are correct. Together they have a consequence nobody wrote down: the **original
pre-squash commits are permanently unreachable from `main`**. The squash replaced them with a
different commit, and `-s ours` records the ancestry edge without importing them. So they satisfy
"in `develop`, not in `main`" forever, and `origin/main..origin/develop` never shrinks after a
promotion — it **accumulates every commit ever squashed**.

Measured on 2026-08-07: the range was **2448 commits** against a real unpromoted delta of **35**.
By the end of that promotion it read 2463 against 4.

This is not cosmetic. `/promote` step 3 linted that range, so it re-judged commits production had
been running for months against a commitlint config that postdates them — 7 Phase 6/7-era commits
fail `subject-case` and `type-enum` and always will, because they are immutable history. CI itself
skips the job for `base_ref == main` **by design** (`ci.yml`, commented "already linted
commit-by-commit on the way into develop"), so obeying the step literally blocked promotion forever
on commits CI deliberately never checks. It cost **three** promotions before being fixed.

The same range also silently broke the "nothing to promote" stop: after a heal, `develop`'s tip is
the heal commit, so the range is non-empty **even when nothing new exists** — the friendly stop could
never fire.

## Decision

Any gate, count or changelog spanning "what is unpromoted" derives its base from the **most recent
heal commit**, never from `origin/main`:

```bash
PROMO_BASE=$(git log --first-parent --format='%H %s' origin/develop \
  | grep -m1 'heal squash divergence' | cut -d' ' -f1)
PROMO_BASE=${PROMO_BASE:-$(git rev-parse origin/main)}   # fallback: never healed yet
```

The heal commit is the true "everything before this is in production" watermark. Landed in
`.claude/commands/promote.md` (`f0fb12ff`, `309484ac`) for commitlint, the commit count, the PR body
and the emptiness check.

Known narrow race: a commit landing on `develop` after the PR merges but before the heal falls
outside the window. It under-reports rather than blocking, and the PR's own `commitlint` job is the
backstop.

## Consequences

- `git rev-list --count origin/main..origin/develop` is **not** a measure of unpromoted work in this
  repo, and never will be again. Treat any number derived from it as meaningless without explanation.
- The generalisable rule: **once a branch pair is joined by squash merges, `A..B` stops meaning
  "the difference between A and B"** — it means "commits whose *object identity* is absent from A",
  which after a squash is all of them. Reach for an explicit watermark, not the range.
- `git merge-base --is-ancestor origin/main origin/develop` remains the correct check for whether the
  heal was done. It stays true; only the range is misleading.
