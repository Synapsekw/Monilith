---
type: adr
date: 2026-08-10
status: accepted
tags: [decision, gotcha, testing, e2e, dev-database, admin]
related:
  [
    "[[2026-08-10-1659-test-account-purge-and-e2e-guard]]",
    "[[2026-08-02-decision-32-production-runs-the-dev-database]]",
  ]
---

# Gotcha 88 — a leak whose collector is forbidden from the place it leaks

## Context

`/admin/users` ("Every user across all organizations") had become unusable: **74 profiles, of
which 14 were real people**. The other 60 were the app's own agent, three permanent test
fixtures, and **56 timestamped E2E throwaways** — `e2e-offline-…`, `diag3-…`, `probe2-…`,
`navmodes-…`, `guard-…`, `settings-shot-…` — each dragging its own single-member org
(`Org-1786003211446-326249`, `Probe Org …`, five separate `Northwind Labs`).

The repo already had a sweeper for exactly this. `src/test/global-teardown.ts` exists to purge
leaked `@example.com` users and cascade away their orgs. It never ran, because it opens with a
hard guard:

```ts
if (!isSafeTestTarget(url)) {
  console.warn("[global-teardown] target is not a marked test DB (PULSE_TEST_DB) — skipping purge to protect DEV/PROD.");
  return;
}
```

That guard is **correct**. The purge is destructive and DEV holds the real, live, user-facing
data (decision-32). Deny-listing DEV is the right call and must not be weakened.

The bug is the asymmetry. Every spec in `e2e/` loads `.env.local` — which points at DEV —
and provisions confirmed users through the service-role admin API, gated on nothing but:

```ts
const hasSecrets = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);
```

So **provisioning was permitted exactly where collection was forbidden**. Each run deposited
another user and org into the live database, and nothing would ever remove them. The pile only
grows, and it grows fastest on the surface where it is most visible.

## Decision

**A guard on the collector implies a guard on the producer.** The refusal belongs on the
provisioning side, and it belongs at a choke point rather than duplicated across 26 spec files:

- `e2e/support/e2e-target.ts` — `checkE2eProvisioningTarget(url, allowDev)`. PROD is refused
  outright with no override. DEV is refused unless `PULSE_E2E_ALLOW_DEV=1`, so polluting the
  live database is a deliberate act rather than the default. An unknown ref (throwaway project,
  localhost) is allowed — that is what E2E is for. An **absent** URL is refused: the suite
  cannot prove where it points, and "unknown" is not a safe default when the failure mode is
  writing to DEV.
- `e2e/support/global-setup.ts` — wired as `globalSetup` in **both** `playwright.config.ts` and
  `playwright.offline.config.ts`. One place, and it covers specs written later, which is the
  half that matters. `offline.spec.ts` runs only from the second config and was the single
  largest producer of leaked accounts, so wiring one config would have left the worst offender
  uncovered.

It deliberately mirrors the deny-list vocabulary of `src/test/integration-env.ts` and reuses
`labelSupabaseTarget` rather than inventing a second scheme.

The 56 leaked accounts were deleted from DEV in one guarded statement (count assertions on both
users and orgs, aborting on any surprise). Pre-flight checks proved isolation: none shared an
org with a real user, owned a board or item in a real org, held a `platform_admins` row, or had
a pending invite into a real org.

## The three accounts that must never be swept

`@example.com` is not sufficient grounds for deletion. Three accounts share that domain and are
load-bearing:

`pulse-tier2-fixture-a/b/c@example.com` are the Tier-2 tenant-isolation fixtures. `pnpm test`
signs in as them to assert what RLS refuses across tenants. Deleting them does not fail the
suite — it **silently empties** it, which is strictly worse. `global-teardown.ts` already
exempts them by exact address for this reason; any new sweep must do the same.

`pulse-autopilot@pulse.internal` is the platform agent actor, seeded by migration
`20260720120517_board_agents.sql` and looked up **by email** by later migrations.

## Consequence — classify by domain, never by id list

`/admin/users` now collapses non-customer accounts behind a `<details>` accordion
(`src/lib/platform/test-accounts.ts`). Classification is by **domain**, not by a hardcoded list
of user ids:

- IANA-reserved `example.com` / `.net` / `.org` (RFC 2606) — un-registerable, so a real signup
  can never produce one.
- the `.internal` suffix — reserved for non-public infrastructure names.

An id list would have been simpler and would rot the moment the next fixture is seeded; the
domain rule holds automatically. Matching is on the true suffix, so `sales@example.com.evil.io`
is correctly treated as a real address. A **missing** address counts as a real user — unknown is
never grounds for hiding a row from an administrator. This is presentation-only: it decides what
the console collapses, never what is authorized or deleted. RLS remains the boundary.

## The generalisable rule

**When you deny-list an environment for a destructive cleanup, ask immediately what is still
allowed to write there.** A one-sided guard does not prevent the mess; it only guarantees nobody
will clean it up. The safety mechanism converts a self-healing leak into a permanent one, and
the warning line it prints on every run — `skipping purge to protect DEV/PROD` — reads as
reassurance while the pile grows behind it.
