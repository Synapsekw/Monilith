---
type: session
date: 2026-09-15-1026
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-15-gotcha-107-partition-after-paginate-hides-the-people-it-protects]]"
  - "[[2026-08-10-1659-test-account-purge-and-e2e-guard]]"
  - "[[2026-08-10-gotcha-88-a-leak-whose-collector-is-forbidden-from-where-it-leaks]]"
---

# /admin/users shows people first again

## What changed

- Owner report: the platform admin console listed only system and test accounts. Root cause was
  not a query error. `/admin/users` paged every account newest-first, 25 at a time, and split
  people from fixtures only after the page was cut. 37 `@example.com` accounts seeded by ad-hoc
  browser-verification scripts on 2026-09-12 (`qgi-verify`, `name-col-rule`, `blocker3-verify`,
  `qgi-color`) were the 37 newest rows, so page 0 held zero people. See
  [[2026-09-15-gotcha-107-partition-after-paginate-hides-the-people-it-protects]].
- Purged the 36 disposable fixtures and their 36 one-member orgs from DEV (the live database),
  after proving no real member sat in any of them and no fixture sat in a real org. The 37th,
  `useragents-comember-*`, lives in the persistent `Tier-2 Fixture Alpha` org and stays. DEV now
  holds 21 users: 16 people, 5 system/test.
- Migration `20260915053143_platform_search_users_email_patterns`: `platform_search_users` gains
  `p_exclude_email_patterns` / `p_only_email_patterns` (ILIKE lists) applied before LIMIT/OFFSET,
  revoked from `public, anon`. Applied to DEV via MCP (gotcha-55 fired again, relabelled), ledger
  164/164. Not on PROD.
- `searchUsers(q, limit, offset, kind)` with `kind` in `all | people | system`; the page paginates
  people alone and lists system/test accounts as one bounded (50) collapsed section on page 0.
  Patterns single-sourced in `NON_CUSTOMER_EMAIL_PATTERNS`; `partitionByAccountKind` removed.
- Tests: pattern/classifier lock-step, `searchUsers` argument contract, page routing of the two
  queries. The anon-reachability conformance suite caught the missing revoke on the first run.
- Merged to `develop` as `521dc170` via `finish-task.sh`; worktree and branch removed. `/updates`:
  nothing announced, the admin console is not a customer surface. The 2026-08-27 agent-memory and
  create_pdf feature commits also carry no entry; that belongs to the session that shipped them.

## Why

The platform admin could not find real customers in the one place built to list them. The app-side
split was presentation-only by design, but pagination had made it a filter with the wrong order of
operations; moving the classification under LIMIT is the only shape that survives the next fixture
burst.

## How to test (for the user)

The purge already took effect on the live deployment, so people are visible today. The code fix
lands on the next `develop → main` promotion. To verify the fix itself:

1. Run `pnpm dev` from a checkout of `develop` (or wait for the promotion) and sign in as
   `info@synapse-solutions.ai`.
2. Open `/admin/users`. Expected: the top table lists the 16 real people with their organisations;
   below it a collapsed "System & test accounts · 5" section.
3. Expand the section. Expected: `pulse-autopilot@pulse.internal`, the three `pulse-tier2-fixture-*`
   accounts and `useragents-comember-*`, each with working row actions.
4. Search `example.com`. Expected: no "No users match" message; the people table is absent and the
   collapsed section holds the four `@example.com` rows.
5. Search `synapse`. Expected: exactly one row in the people table, no collapsed section.
6. Regression check: seed 30 `@example.com` users (any E2E run) and reload page 0. Expected: the
   people table is unchanged; the collapsed count grows.

## Open threads

- Promote `develop → main` to ship the migration-backed fix; the DEV RPC signature already changed,
  and the deployed code calls it with three args, which Postgres resolves via defaults, so
  production is not broken in the interim.
- The fixtures came from Playwright scripts kept in `node_modules/.cache` (gitignored). Any future
  browser-verification script must delete the users and orgs it creates, or use `PULSE_TEST_DB`.
- gotcha-55 (MCP `apply_migration` stamping its own version) fired for the sixth time.

## Next session entry point

Promote to `main`, confirm `/admin/users` on `www.monolith.works` shows people first, then return
to the ranked "Next" list in the north-star (the `requestShapeFor` model-bucket fix leads).
