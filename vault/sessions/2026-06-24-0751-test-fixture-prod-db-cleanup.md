---
type: session
date: 2026-06-24-0751
branch: develop
trigger: wrapup
status: complete
tags: [session, ops, gotcha]
related:
  - "[[2026-06-23-gotcha-43-shared-db-integration-test-flake]]"
---

# Test fixtures polluting prod DB — cleanup + root cause

## What changed

- No source files modified. This was a DB-ops + diagnosis session against the remote Supabase project.
- Identified "random" orgs/users in the live app as **integration-test fixtures** (`*@example.com` users; orgs `Org a`/`Org b`, slugs `rls-*`, `eng5b1-*`, `goal-*`, etc.).
- Root cause: Vitest loads `.env.local`, which points at the **remote/production** Supabase (`hjqcahbbbdaknbbnfnvl.supabase.co`) — no `.env.test`, no local DB in the `test` script. Tests write fixtures straight to prod.
- Cleaned up safely: deleted leftover `Eng5b1` test orgs + their users (a crashed test had leaked them before teardown). All org FKs are `ON DELETE CASCADE`, so removing an org wiped its child rows. Verified `shared_orgs_with_real_member = 0` before every delete.
- Confirmed final state: 9 real orgs / 9 real users, **0** test fixtures. Real tenants intact: Synapse Solutions, E&, e& Autonomous Mobility, Etisalat, Accenture.

## Why

Test fixtures were appearing in the live app because the suite isn't isolated from production. Most fixtures self-tear-down, but a test that throws before teardown leaks stragglers into real tenant data — confusing and risky. Cleaned the leak and pinned the root cause for a durable fix.

## How to test (for the user)

No user-facing behavior to test — DB cleanup verified by direct queries (0 `@example.com` users, 0 test-only orgs, 9 real orgs/users remaining).

## Open threads

- **Tests still write to production.** Until fixed, any test that throws pre-teardown will leak new `@example.com` rows. Safe re-cleanup: delete `@example.com` users + test-only orgs after confirming `shared_orgs_with_real_member = 0`.
- **Durable fix (not started):** point Vitest at a dedicated isolated test database (a separate test-only Supabase project) via `.env.test` so fixtures can never reach prod.

## Next session entry point

Set up a dedicated isolated test database + `.env.test` so the integration suite targets a test-only project instead of the remote prod project — see "Open threads" for the bleed details.
