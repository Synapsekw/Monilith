---
type: decision
date: 2026-09-15
status: accepted
tags: [decision, gotcha, admin, pagination]
related:
  - "[[2026-09-15-1026-admin-users-people-first]]"
  - "[[2026-08-10-gotcha-88-a-leak-whose-collector-is-forbidden-from-where-it-leaks]]"
  - "[[2026-08-10-1659-test-account-purge-and-e2e-guard]]"
---

# Gotcha 107 — a partition applied after pagination hides the people it was meant to protect

## Context

`/admin/users` collapses system actors and reserved-domain test accounts into a "System & test
accounts" accordion so the platform admin sees customers first. The classification was written as
presentation-only: fetch 25 users newest-first, then split the page in TypeScript. On 2026-09-12
ad-hoc browser-verification scripts seeded 37 `@example.com` accounts, all newer than every real
signup. Page 0 was 25 fixtures and zero people. The owner reported "I only see system test
accounts". Nothing errored, every unit test passed, and the SQL was correct.

## Decision

Any classification that decides which rows a paginated list shows belongs **under** `LIMIT/OFFSET`,
in the query, not after it in the app. `platform_search_users` now takes optional ILIKE pattern
lists (`p_exclude_email_patterns`, `p_only_email_patterns`) and the page runs two bounded queries:
people, paginated, and system/test accounts as one capped section. The pattern list stays
single-sourced in `NON_CUSTOMER_EMAIL_PATTERNS`, with a test that keeps the TypeScript classifier
and the SQL patterns in lock-step.

## Consequences

- A burst of fixtures can no longer displace people; it only grows the collapsed count.
- "Presentation-only" is not a safe label for anything that runs after a page cut. If the split
  changes what a page contains, it is a filter and the database must apply it first.
- `create function` via MCP `apply_migration` grants EXECUTE to PUBLIC; the anon-reachability
  conformance suite caught the missing `revoke … from public, anon` on the first full test run.
  That suite is doing its job — run `pnpm test` in full, not only the touched files.
- Browser-verification scripts that create users must delete them, or target `PULSE_TEST_DB`.
