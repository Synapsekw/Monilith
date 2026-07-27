---
type: adr
status: accepted
date: 2026-07-27
tags: [project/pulse, adr, decision, testing, security, rls]
related:
  - "[[2026-07-27-0659-batch-a-builds-conformance-probes]]"
  - "[[2026-07-25-gotcha-59-definer-acl-default-privileges-not-load-bearing]]"
---

# Decision 30 — Conformance probes: a third test tier that proves the anon boundary with no infrastructure

## Context

The 69 `*.integration.test.ts` suites — 43 of them RLS — have never run. `integrationTargetReady()`
requires a service-role key **and** a target that is neither DEV nor PROD, so without a dedicated
Supabase project every suite skips. Among the casualties was
`function-execute-grants.integration.test.ts`, the regression test for the incident in
[[2026-07-25-gotcha-59-definer-acl-default-privileges-not-load-bearing]] — 8 `SECURITY DEFINER`
functions callable by `anon` in production, two able to delete from `vault.secrets`.

So a green `pnpm test` was a strong signal about application logic and a **null signal about the
security boundary**. The owner ruled out both a third (paid) Supabase project and any Docker/local
stack, and asked whether the tests could be designed differently instead.

The unlock: **the deny-list exists to protect against the destructive `@example.com` teardown, not
against reading.** Coupling every integration test to that sweeper is what forced a sacrificial
project. Decouple read-only assertions from write-heavy ones and the infrastructure requirement
mostly disappears.

## Decision

Add a third vitest project, **`conformance`** (`src/**/*.conformance.test.ts`, `pnpm test:conformance`),
that answers one question against a **live** project: can `anon` reach anything?

- **Zero writes, zero provisioning, zero teardown.** Every probe is a read expected to be refused or
  empty — which is what makes it safe to aim at DEV _and_ PROD.
- **It holds only the publishable anon key.** It never reads `SUPABASE_SERVICE_ROLE_KEY`, and a unit
  test fails if the module so much as names one. That absence _is_ the safety property.
- **It does not use `integrationTargetReady()`.** `integration-env.ts`, `global-teardown.ts` and
  `project-refs.ts` are untouched; the deny-list stays exactly as strict.
- **Both corpora are derived, never listed:** functions are parsed out of `supabase/migrations/*.sql`,
  tables out of the generated `database.types.ts`. A new function or table is probed automatically.

Two findings shaped the implementation and must not be undone:

1. **Posting an empty body would have made it vacuous.** PostgREST resolves an RPC by the _set of
   keys in the JSON body_, so an empty body returns `PGRST202` whether or not `anon` holds EXECUTE —
   and `PGRST202` counts as denial. ~80% of the corpus would have "passed" without the privilege
   check ever firing. The probe therefore parses **argument names** and posts `null` for each, which
   is what turns 109 of 129 into a hard `42501`. A guard test pins that ratio above 50%.
2. **The gate was proven to bite**, not merely observed green: `grant execute on function
public.escape_like(text) to anon` on DEV made the suite fail with `escape_like(p_text) → 200`;
   the grant was then revoked and the ACL verified back to `{postgres,authenticated,service_role}`.

Result on both projects: **129 function signatures, 53 tables, 0 reachable, 0 readable**, with both
allow-lists empty — which is the correct state, since Pulse has no anonymous surface.

## Consequences

- The `anon` half of the security boundary now has a standing, self-maintaining gate that costs
  nothing and needs no infrastructure. Aim it at prod with `CONFORMANCE_TARGET_URL` +
  `CONFORMANCE_TARGET_ANON_KEY`; it refuses a half-set pair rather than silently probing DEV.
- **The `authenticated` half is still ungated.** Cross-tenant isolation between logged-in users, and
  the old grants test's assertions about internal `_`-prefixed functions, both need a real session.
  The planned answer is Tier 2: two **permanent** fixture users/orgs seeded once in DEV and never
  mutated, turning isolation claims into read-only assertions with no purge. Not built.
- **The table family is weaker than the function family.** Only 13 of 53 gave a hard `42501`; the
  other 40 returned `[]`, which is ambiguous between "RLS denied me" and "the table is empty". It
  leans on the target having real data.
- **Views are not probed.** `Views` is currently `[_ in never]`, but a view created without
  `security_invoker` bypasses the underlying table's RLS — exactly this bug class. Extend when the
  first view lands.
- `pnpm test` now makes ~180 live calls (~7s) and **errors rather than skips** when offline. Chosen
  deliberately: a silently-skipping gate is what created this problem.
- The 69 integration suites still report "skipped" every run, which reads as coverage that does not
  exist. Quarantining or deleting them is the honest follow-up.
