---
type: adr
status: accepted
date: 2026-06-20
tags: [adr, gotcha, testing, vitest, supabase, auth, rate-limit]
---

# Gotcha 24 — Concurrent integration suites trip GoTrue's auth rate limit (and mask a real bug)

## Context

Every `*.integration.test.ts` suite provisions throwaway users against the **live cloud** project:
its `provisionUser`/`createUser` helper does `signInWithPassword(...)` then
`create_organization(...)`. Vitest runs test files in parallel by default, so a full `pnpm test`
fires ~40+ sign-ins across 18 suites from one IP in a few seconds.

These suites `describe.skipIf(!SERVICE_ROLE_KEY)`, so they **skip in CI** and only run locally — they
are a local-only gate, and a broken integration test can land on `develop` unnoticed.

## The trap

GoTrue rate-limits the burst → `429 over_request_rate_limit`. It surfaces **two ways**:

- **Loudly** in suites that assert the sign-in error (e.g. `admin.rls`): `expected AuthApiError:
Request rate limit reached to be null`.
- **Silently** in suites that don't check it (most): the client stays unauthenticated, so
  `create_organization` returns `null`, and the next line blows up as
  `TypeError: Cannot read properties of null (reading 'id')` inside `beforeAll`.

Because the failure is timing-dependent, **which** suites go red shifts run to run — it reads like
flakiness, not a fixable cause. Proof it's rate-limiting: each suite passes in isolation; serializing
the files recovered 4 of 5 failures.

Compounding it: the lone deterministic failure (`subitems`) wore the **same** null-`id` NPE, so it
hid behind the rate-limit noise. Its real cause was unrelated — it built its org slug from an
**uppercase** label (`subitems-A-…`), violating the `organizations.slug` CHECK
`~ '^[a-z0-9]+(-[a-z0-9]+)*$'`, so the insert failed and the org came back null. (Other suites
already lowercase the label.)

## The fix / rule

- **`src/test/integration-auth.ts`** exports `signInWithRetry(client, creds)` — retries
  `signInWithPassword` with exponential backoff (1s→16s + jitter) **only** on 429
  `over_request_rate_limit`; other auth errors return immediately. It mirrors
  `signInWithPassword`'s `{ data, error }` shape, so it is a drop-in replacement. All integration
  suites call it instead of raw `signInWithPassword`.
- **`vitest.config.ts`** splits into two projects (both `extends: true`): a parallel **`unit`**
  project (everything except `*.integration.test.ts`) and a serial **`integration`** project
  (`fileParallelism: false`). Serializing keeps the burst rate down; the backoff handles the
  residual. `globalSetup` stays at root so teardown runs once.
- **`subitems.integration.test.ts`** uses `${label.toLowerCase()}` in the slug.

Result: `pnpm test` runs both projects green (819/819, 0 skipped) on `develop`.

**Rules going forward:**

1. Integration suites must sign in via `signInWithRetry`, never raw `signInWithPassword`.
2. Any value fed to `organizations.slug` (or `p_slug`) must match `^[a-z0-9]+(-[a-z0-9]+)*$` —
   lowercase test labels before interpolating.
3. A null from `create_organization` in `beforeAll` is almost always a throttled/failed sign-in or
   an invalid slug — not connectivity. Don't dismiss it as flake; capture the `error`.

Related: Gotcha 23 (cloud test-data leakage + teardown), Gotcha 06 (commitlint subject case).
