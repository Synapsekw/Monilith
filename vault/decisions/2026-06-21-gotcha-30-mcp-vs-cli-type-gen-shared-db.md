---
type: decision
date: 2026-06-21
status: accepted
tags: [decision, gotcha, supabase, types, worktrees]
related:
  [
    "[[2026-06-21-1304-phase7a-portfolios]]",
    "[[2026-06-21-gotcha-29-migration-ledger-drift-throwaway-cloud-applies]]",
  ]
---

# gotcha-30: MCP type-gen differs from CLI, and a shared cloud DB cross-contaminates `database.types.ts`

## Context

Building Phase 7a (Portfolios) in a worktree, the Supabase CLI couldn't authenticate (no
`SUPABASE_ACCESS_TOKEN` anywhere), so the migration was applied and types regenerated via the
**Supabase MCP** (`apply_migration` + `generate_typescript_types`). Two distinct problems surfaced.

## The trap

1. **MCP `generate_typescript_types` ≠ CLI `db:types`.** The MCP output had a different _shape_ for
   existing types and introduced ~20 "possibly undefined" errors in untouched `boards` code that
   the committed (CLI-generated) types did not have. Dropping the full MCP output into
   `src/types/database.types.ts` broke `pnpm typecheck` even ignoring the new feature.
2. **A shared cloud DB cross-contaminates a full regen.** The project has one linked cloud DB that
   _all_ parallel worktree sessions apply migrations to. A concurrent session (6d) had already
   applied a `relation` column-kind + `relation_links` table. So a full regen pulled 6d's unmerged
   schema into the portfolios branch, adding `"relation"` to the `column_kind` enum and breaking the
   exhaustive switches/maps in `column-defaults.ts` / `column-kinds.ts` / `rollup.ts` (whose
   `relation` handling lived only on 6d's branch).

## Resolution

- **Don't replace the whole generated file from a shared-DB regen while another session's schema is
  unmerged.** Start from the branch's known-green committed `database.types.ts` and **transplant only
  the new feature's blocks** (its Tables / Functions / Enums — object key order is irrelevant to TS).
  This avoids both the MCP format drift and the cross-session contamination.
- **Prefer the CLI `pnpm db:types` over the MCP** for type generation when the access token is
  available — it is the repo's source-of-truth generator; the MCP is a fallback whose output must be
  transplanted, not pasted wholesale.
- At merge time the contamination resolves naturally: once the other session merges to `develop`,
  its handling code is present, and `git` cleanly auto-merges the two features' non-overlapping
  additions to `database.types.ts` (verified — portfolios + relations merged with no conflict and a
  green typecheck).

## Why it matters

Stale/contaminated generated types are the main source of `any` creep and phantom typecheck breaks.
With parallel worktrees on one shared cloud DB, "regenerate types" is no longer a safe whole-file
operation — scope it to your feature's additions.
