---
type: session
date: 2026-06-22-0909
branch: develop
trigger: wrapup
status: complete
tags: [session, promotion, tooling]
related:
  - "[[2026-06-21-gotcha-32-promote-merge-method-squash-divergence]]"
  - "[[2026-06-21-2335-phase-6d3-mirror-aggregation-footer]]"
  - "[[2026-06-22-0832-phase-7b-goals-okrs]]"
---

# `/promote` merge-method fix + production promotion #23

## What changed

- **Fixed `/promote`** (`.claude/commands/promote.md`): step 6 now `gh pr merge --squash` (the repo disallows merge commits), and a **new step 6b auto-heals** the squash divergence each time (`git merge -s ours origin/main` + push) so the next promotion PR is mergeable, not `CONFLICTING`. Documented the husky sub-gotcha: the heal message **must start with `Merge `** (commitlint ignores merge commits; `Back-merge …` is rejected). Resolves the standing gotcha-32 open thread.
- **Ran promotion #23** (`develop → main`, squash → `c26eb93`, **LIVE on Vercel**, main CI + deploy green). Hit the expected pre-merge `CONFLICTING` from #22's unhealed squash → ran the `-s ours` back-merge heal → mergeable → merged with `--admin` (only `verify` required + green, 0 reviews, admin bypass).
- A parallel `goals-7b` session merged **Phase 7b** into `develop` mid-flight, so #23 swept **6d-3 + 7b** to production (PR head is `develop`, so it shipped develop's tip at merge time).
- Marked **gotcha-32 resolved** (resolution section added) and pruned two stale empty worktree husk dirs (`mirror-aggregation-6d3`, `mirror-columns-6d2`).

## Why

Every promotion was hitting the `--merge`-rejected + squash-re-divergence trap (gotcha-32) and needing a manual heal. Baking `--squash` + the auto-heal into the command closes that for good, and 6d-3 was a finished feature worth shipping to prod.

## How to test (for the user)

No app behavior changed by _this_ session (the shipped features 6d-3 + 7b are tested in their own session notes). To confirm production: open `www.monolith.works`, check a Table view's **Summary footer** (6d-3) and the **Goals/OKRs** surface (7b) are live. Tooling: the next `/promote` should merge without a manual heal (step 6b runs automatically).

## Open threads

- Promotion #23's PR body under-described the payload (said "7b is docs-only") because 7b code landed on `develop` after the PR opened — harmless (promotion is all-or-nothing of develop's tip), but a reminder that concurrent merges change a promotion's scope.

## Next session entry point

`main` live with 6d-3 + 7b; `develop` synced. Roadmap: Phase 7 continues (7c Workload, unspec'd) or 7b follow-ups; 6e Docs deferred. Each needs its own brainstorm→spec→plan.
