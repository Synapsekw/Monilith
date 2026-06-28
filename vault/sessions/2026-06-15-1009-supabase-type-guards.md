---
type: session
date: 2026-06-15-1009
branch: chore/supabase-type-guards
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-06-15-gotcha-03-gen-types-schema-public-prettier]]"]
---

# Supabase type guards (db:types + no-explicit-any)

## What changed

- New chore branch in an **isolated git worktree** off `main`, deliberately separate from the
  active Phase 2 work (the main tree is on `feat/phase-2a-boards-core` in another window).
- Added `pnpm db:types` — `supabase gen types typescript --linked --schema public | prettier`.
  Proven byte-for-byte identical to the MCP-generated `src/types/database.types.ts`.
- Pinned `@typescript-eslint/no-explicit-any` to error in `eslint.config.mjs` (eslint-config-next
  already sets it — pinned so a future Next major can't silently relax it).
- CONTRIBUTING.md post-migration step now points at `pnpm db:types`.
- Commit `d75140a`; `typecheck` / `lint` / `test` (28 pass) / `build` all green.
- Recorded the gen-types format gotcha as an ADR; deleted the stale `_draft-2026-06-15-0503.md`
  stub (its content was already captured in [[2026-06-15-0742-dev-memory-vault-and-wrapup]]).

## Why

Pre-empt the `any`-creep that follows stale generated Supabase types (flagged from past projects).
The repo has zero `any` today; the lint pin keeps the symptom out and `pnpm db:types` removes the
friction that causes drift. A CI drift check was scoped and rejected: no local DB stack is available,
and Supabase Branching is overkill for a solo developer.

## Open threads

- Chore branch is **committed locally but not pushed / no PR** — awaiting go-ahead.
- Optional future hard guard if drift ever bites: a husky `pre-push` running `pnpm db:types`, or a
  secret-gated `--linked` CI job (correct for a solo dev since the remote never runs ahead of the branch).

## Next session entry point

Push + open the `chore/supabase-type-guards` PR if wanted, then return to Phase 2 boards core on
`feat/phase-2a-boards-core`.
