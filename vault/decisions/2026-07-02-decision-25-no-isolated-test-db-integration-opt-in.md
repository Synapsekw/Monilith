---
type: decision
date: 2026-07-02
status: accepted
tags: [decision, testing, supabase, integration-tests, ci, infra]
related:
  - "[[2026-06-23-gotcha-43-shared-db-integration-test-flake]]"
  - "[[2026-07-02-1356-quality-pass-build-promote-45]]"
---

# decision-25: No isolated test DB — live-DB integration suites stay opt-in

## Context

[[2026-06-23-gotcha-43-shared-db-integration-test-flake]] recorded a standing follow-up:
point the `*.integration.test.ts` suites at a **dedicated/ephemeral Supabase project**
(via `.env.test`) so they run deterministically instead of racing on and polluting the
shared DEV DB. Promotion #43 shipped the wiring for it — the `integration-env` loader,
a `PULSE_TEST_DB=1` positive gate, and a DEV/PROD deny-list — and it was tracked in the
north-star as the "top infra priority." Provisioning the actual test-only project was the
last owed step.

## Decision

**We will not provision a dedicated test-only Supabase project.** `.env.test` isolation
stays an optional, opt-in local capability. It is removed from the roadmap as owed work.

## Why

- **The actual harm is already prevented.** Post-#43, with no marked test DB the
  integration suites **self-skip** (`integrationTargetReady()` false) and the
  global-teardown purge is gated behind `isSafeTestTarget` + `PULSE_TEST_DB` — so a normal
  `pnpm test` writes nothing to DEV and can never push fixtures to PROD via `/sync-prod`.
  DEV/PROD are safe by default without any further work.
- **Merges are already covered by deterministic gates.** Per gotcha-43, correctness is
  gated on typecheck/lint/unit+component/build; the tenant-isolation logic is covered by
  mocked unit tests. The live-DB integration suites are supplementary signal, not the gate.
- **Not worth the standing cost.** A separate Supabase project means another set of
  secrets, provisioning, and schema-sync overhead for marginal added confidence.

## Consequences

- **Integration suites are opt-in.** They run only where a developer sets `.env.test` +
  `PULSE_TEST_DB=1` against a throwaway DB; otherwise they skip — this is expected, not a
  failure. CI `verify` is unit-only, so CI is unaffected.
- **Supersedes** the "dedicated/isolated test DB" follow-up in gotcha-43 and clears it from
  the north-star Owed/Next. Do not re-raise it in `/whats-next`.
- **Reversible.** The wiring stays in the tree, so provisioning later is just creating a
  project and adding `.env.test` — no code change required.

## Amendment (2026-07-27, decision-31)

The ruling above stands — we still will not provision a test-only project, and the suites
still self-skip. What changed is **where they skip**. Reporting 70 "skipped" suites on every
`pnpm test` read as coverage that does not exist, so the `integration` vitest project moved
out of the default run into its own **`pnpm test:integration`** script. Nothing was deleted
and no gate was loosened: the suites, `integration-env.ts`, the `PULSE_TEST_DB` marker and
the deny-list are all untouched, and `.env.test` + `pnpm test:integration` runs them exactly
as before.

The confidence that decision-25 traded away is now being bought back a different way — not
with a project, but by designing the assertions so they need no provisioning at all:
Tier 3 conformance probes (decision-30) for the `anon` boundary and Tier 2 permanent tenant
fixtures (decision-31) for the authenticated one. Both run in the default `pnpm test`.
