---
type: adr
date: 2026-06-16
status: accepted
tags: [decision, gotcha, workflow]
related: ["[[2026-06-15-gotcha-07-shared-worktree-subagents]]"]
---

# Gotcha 10 — when committing subagent-built features, stage NEW files too (not just modified)

## Context

During the Timeline build (subagent-driven), one implementer created the pure module
`src/lib/boards/gantt.ts` (+ test); a later implementer created `GanttBoard.tsx` which imports it.
When the controller committed the Timeline feature, it staged files **by explicit path** (per
gotcha-07's anti-clobber rule) — but the path list was built from the _modified_ files in mind and
omitted the brand-**new untracked** `gantt.ts`/`gantt.test.ts`. The commit + push therefore landed a
`GanttBoard.tsx` that imports a module **not in the repo**. Local `typecheck`/`build` passed (the
files exist in the working tree), so the breakage was invisible locally — only CI on `develop` (a
fresh clone) would have failed.

## Decision

When committing work that subagents produced, **run `git status --porcelain` and stage the `??`
(untracked) files too**, not just the `M` ones. Explicit-path staging (gotcha-07) is still correct in
a shared checkout — but the path list must be derived from _both_ modified and untracked entries.
A quick guard before pushing a feature: `git status --porcelain` should show **no untracked source
files** that the committed code imports.

## Consequences

- Subagent reports list "files created" — cross-check that list against what you actually `git add`.
- Local green is necessary but not sufficient; an untracked-but-imported file passes locally and
  fails CI. Treat "does the committed tree compile" as distinct from "does my working tree compile."
- Fixed here by `a74b71a` (committed `gantt.ts` + test and re-pushed).
