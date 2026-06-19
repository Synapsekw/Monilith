---
type: session
date: 2026-06-19-2312
branch: develop
trigger: wrapup
status: complete
tags: [session, admin, platform, bug, cleanup]
related:
  - "[[2026-06-19-2231-platform-admin-console-ui]]"
  - "[[2026-06-19-gotcha-23-activity-trigger-blocks-cascade-delete]]"
---

# Admin console — empty-users bug + cloud test-data purge + cascade fix

## What changed

- `89294b6` — **fixed empty Users page + zero Overview stats.** `platform_stats` /
  `platform_search_users` are `auth.uid()`-gated RPCs but `queries.ts` called them via the
  **service-role client** (no session) → gate failed closed → 0 rows. Now called via the
  **authed** client (`createClient`); the internal gate stays as the real boundary.
- **Purged integration-test pollution from the cloud:** 3,402 → **3 users**, 3,377 → **3 orgs**
  (kept info@/misamara@/danijel.uae@). Done as one atomic, FK-ordered tx with the two activity
  triggers temporarily disabled (re-enabled + verified).
- `65fb147` — **root cause:** an AFTER-DELETE `cell_values` trigger (`tg_log_cell_activity`)
  re-inserted into `item_activities` during cascade → **orgs/boards with cell history were
  undeletable** (FK violation), which is why test cleanup never worked. Guarded the DELETE branch
  with `if exists (select 1 from items where id = old.item_id)` (migration `20260619230000`,
  applied to cloud; org-delete now verified clean). Added a vitest **`globalSetup` teardown**
  (`src/test/global-teardown.ts`) that auto-purges `@example.com` data after each run.
- `220793c` — ADR [[2026-06-19-gotcha-23-activity-trigger-blocks-cascade-delete]].
- (Earlier in the block: `50255c6` full-width admin pages + server-rendered Users roster;
  `3a49555` the 2 RPC integration tests.)
- All pushed to `origin/develop` (through `ca090f5`).

## Why

A super-admin couldn't see the user base — a real bug (service-client vs authed-client RPC gate)
— and the console was drowning in ~3,400 fake orgs/users from integration suites that hammer the
live cloud project (no local stack). The cascade-trigger fix removes a latent product bug
(undeletable orgs) and unblocks reliable, automatic test-data cleanup.

## Open threads

- The vitest teardown deletes ALL `@example.com` data on any run with the service key — fine here
  (no real example.com users) but document if that ever changes.
- Larger follow-up: a proper local Supabase for integration tests (the real cure for cloud
  pollution) — deferred; teardown is the mitigation.
- `main` not promoted (still gated on the WebGL-landing cross-browser check).

## Next session entry point

Visually confirm `/admin` as info@ (clean 3-user roster, real stats, full-width), then start
**Phase 6b — custom fields/statuses** (spec + plan already authored).
