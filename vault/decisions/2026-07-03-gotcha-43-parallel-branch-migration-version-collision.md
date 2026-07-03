---
type: adr
status: accepted
date: 2026-07-03
tags: [adr, gotcha, supabase, worktrees]
related:
  - "[[2026-07-03-1154-mvp-final-features-wave]]"
---

# Gotcha 43 — parallel branches independently mint the same migration version

## Context

In the MVP Final Features wave, two concurrent build agents (currency-column and
phase-completion-dashboard) each created a migration named `20260703090000_*.sql` — same version
string, different files. Duplicate versions corrupt the supabase migration ledger once both land
on `develop` (compounds the known `migration repair` drift, [[supabase-migration-ledger-drift]]).
A second, related trap hit the same wave: regenerating `database.types.ts` against the shared dev
DB pulls in enum values from _sibling unmerged branches_ (gotcha-41), forcing merge ordering —
the dashboard branch could not go green until currency merged.

## Decision

When dispatching a parallel wave where ≥2 branches carry migrations:

1. **Assign each branch a distinct version slot in the dispatch prompt** (e.g. `…0900`, `…0930`,
   `…1000`) instead of letting agents timestamp independently.
2. **Only the branch that owns a schema change regenerates types**; siblings take `develop`'s
   `database.types.ts` wholesale and the _last_ DB-bearing branch to merge commits the union
   (re-run `pnpm db:types` after its migration applies).
3. Expect applied-via-SQL-editor migrations to need `supabase migration repair` at the next
   `db push` / `/sync-prod`.

## Consequences

No same-version files can collide at merge; types contamination becomes a planned merge order
instead of a mid-wave surprise.
