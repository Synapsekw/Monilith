---
type: session
date: 2026-06-21-1414
branch: develop
trigger: wrapup
status: complete
tags: [session, security, performance, supabase, hardening]
related: []
---

# Supabase advisor cleanup — SECURITY DEFINER lockdown + FK/policy perf

## What changed

- **Pass 1 — FK indexes** (`b7a62d8`): migration `20260621120000` added covering btree indexes for 31 unindexed FKs + documented the intentional `platform_admins` RLS-no-policy lockdown (read only via `is_platform_admin()`/`platform_stats()`).
- **Pass 2 — SECURITY DEFINER lockdown** (`e065dae`): migration `20260621130000` — revoked `EXECUTE` from `anon` (PUBLIC + explicit) on all public functions, and from `authenticated` on trigger + internal `_`-prefixed functions; finished the 4 FK indexes pass 1 missed (FK was a non-leading column of a composite index); split the `FOR ALL` write policies on `board_members` + `relation_links` into INSERT/UPDATE/DELETE so SELECT has one permissive policy. New guard test `function-execute-grants.integration.test.ts`.
- **Auth config:** enabled `password_hibp_enabled` (leaked-password protection) via the Management API.
- **Result: security advisor 127 → 51** (anon definer 62→0, authenticated definer 63→49, leaked-password + both perf items cleared). `unindexed_foreign_keys` 4→0, `multiple_permissive_policies` 2→0.
- Both passes built in worktrees, full gate green (incl. **980 live RLS integration tests, 0 skipped**), merged via the standard flow.

## Why

The Supabase MCP here lacks `get_advisors`, so my first hand-reproduced scan wrongly reported "security clean" — the real report (pulled via Management API + a PAT in `.env.local`) showed 127 warnings, 125 of them our own `SECURITY DEFINER` functions being REST-callable by `anon`/`authenticated`, bypassing RLS. This is Phase 9 hardening ("advisors clean") pulled forward during a dev pause.

## How to test (for the user)

1. Pull `develop`: `git -C /Users/danijeljovanovic/Dev/Monolith pull`.
2. App still works for logged-in users — create/edit a board + items, share a board, add a relation link, start a timer; behavior unchanged (the live RLS suite confirms this).
3. Supabase dashboard → **Advisors → Security**: total ~51, the `anon` SECURITY DEFINER category gone, leaked-password no longer flagged. **Performance**: `unindexed_foreign_keys` and `multiple_permissive_policies` both empty.
4. Try setting a password to a known-pwned one (e.g. `password123`) at signup/reset — now rejected.

## Open threads

- **49 `authenticated_security_definer_function_executable` remain** (by design — RLS helpers + user RPCs). Driving to ~0 needs the **private-schema refactor** (move helpers out of the API schema, rewrite every policy) — deferred, biggest item.
- **Regression risk:** new functions re-acquire PUBLIC/anon EXECUTE. Optional `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM PUBLIC` would prevent it (but forces explicit grants in future migrations). Not added — needs buy-in.
- `pg_net` in public (1 WARN) left per decision; `platform_admins` INFO documented.
- `SUPABASE_ACCESS_TOKEN` now in gitignored `.env.local` (lets future sessions pull advisors) — revoke if unwanted.
- Worktree gotcha logged to auto-memory: `*.integration.test.ts` silently skip without `.env.local` (symlink it from main) — my pass-1 "798 passed" had the integration suite skipped.

## Next session entry point

Resume Phase 6 (6d-2 mirror columns) — or, to keep hardening, take the deferred **private-schema refactor** to clear the remaining 49 definer warnings (spec it first; it touches every RLS policy).
