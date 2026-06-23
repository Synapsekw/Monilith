---
type: adr
date: 2026-06-23
status: accepted
tags: [decision, gotcha, supabase, db-types, worktrees]
related:
  - "[[2026-06-23-1943-feedback-bugs-feature-requests]]"
  - "[[2026-06-22-gotcha-37-parallel-worktree-integration-tests-flake-on-shared-supabase]]"
---

# Gotcha 41: `pnpm db:types --linked` contaminates your worktree when the shared remote DB is ahead of your `develop` snapshot

## Context

`db:types` regenerates `src/types/database.types.ts` from the **live linked Supabase project** (`--linked`).
But every worktree shares **one** cloud project, and that project's schema is whatever the **union of all
in-flight sessions** has applied — it is routinely **ahead** of any single worktree's frozen `develop`
snapshot.

During the feedback build, a `db:types` regen pulled in a `column_kind` value (`percent`) that another
session had applied to the remote but **not yet merged to `develop`**. The regen's types now required
`percent`, but this worktree's code (`column-defaults.ts`, `column-kinds.ts`) had no handling for it →
**48 typecheck errors in files the feature never touched**. Worse, it's a silent footgun: the regen
"succeeds," and the contamination only surfaces as unrelated typecheck failures.

This is the type-generation cousin of [[2026-06-22-gotcha-37-parallel-worktree-integration-tests-flake-on-shared-supabase]]
(shared-cloud contention) — same root cause (one remote, many sessions), different blast radius.

## Decision

When you add a migration in a worktree and need types, **do not blindly `db:types --linked`**. Either:

1. **Graft by hand** — apply your migration to the remote, then add **only your additions** to the
   committed `database.types.ts` (your table's Row/Insert/Update/Relationships, any new columns on
   touched tables, new enum values). Keeps the worktree internally consistent (code + types) with
   `develop`, not with other sessions' unmerged work. This is what shipped feedback.
2. **Or rebase onto the work first** — if the drift you're seeing has actually merged to `develop`,
   `git fetch origin develop` + rebase, which brings the handling code, then a full regen is clean.

Tell-tale that you're contaminated, not broken: a regen produces typecheck errors **only in files you
never edited** (e.g. `Property 'X' is missing in column-defaults`). That's someone else's unmerged
schema, not your bug — graft, don't adopt.

## Consequences

- Hand-grafted `database.types.ts` will show a routine reconcile diff the next time a clean
  `db:types` runs on `develop` after the other work merges. Acceptable and expected; note it in the
  session's Open threads.
- The "never hand-edit generated types" rule (AGENTS.md) has a justified exception: when `--linked`
  is contaminated by another session's unmerged migration. Grafting the minimal additions is more
  correct than adopting a regen that doesn't match your code.
