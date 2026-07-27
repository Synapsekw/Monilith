---
type: adr
status: accepted
date: 2026-07-27
tags: [project/monolith, adr, decision, testing, security, rls, tenancy]
related:
  - "[[2026-07-27-decision-30-conformance-probes-third-test-tier]]"
  - "[[2026-07-02-decision-25-no-isolated-test-db-integration-opt-in]]"
  - "[[2026-07-25-gotcha-59-definer-acl-default-privileges-not-load-bearing]]"
---

# Decision 31 — Tier 2: permanent tenant fixtures gate the authenticated half of the boundary

## Context

[[2026-07-27-decision-30-conformance-probes-third-test-tier]] closed the `anon` half of the
security boundary and named what it left open, verbatim: _"The `authenticated` half is still
ungated. Cross-tenant isolation between logged-in users … needs a real session. The planned answer
is Tier 2 … Not built."_

Meanwhile all 70 `*.integration.test.ts` suites reported "skipped" on every `pnpm test` run —
`integrationTargetReady()` wants a privileged key **and** a non-DEV/PROD project, and decision-25
ruled we will not provision one. Among the never-executed casualties were the two Ask Monolith Phase 2
RLS assertions (proposal/outcome traces in `ai_messages.tool_trace`), which shipped in July 2026 and
had **never once run**.

## Decision

Add a fourth vitest project, **`fixtures`** (`src/**/*.fixtures.test.ts`, `pnpm test:fixtures`),
asserting cross-tenant isolation between two **permanent** seeded tenants on DEV.

The unlock is the same one decision-30 found, applied one level up: **the deny-list exists to
protect against the destructive teardown, not against reading.** Seed the tenants ONCE and never
mutate them, and isolation becomes a read-only assertion — no provisioning, no privileged key, no
purge, no sacrificial project.

- **Permanent corpus**: two users, two orgs sharing nothing, plus workspaces, boards, groups and
  Ask Monolith threads (one carrying a Phase-2 `proposedActions` trace). Deterministic UUIDs, seeded by
  `20260727094033_seed_tier2_tenant_fixtures.sql`.
- **PROD-safe by construction**: the migration never creates an auth user. Every insert hangs off
  `select id from auth.users where lower(email) = …`, the `20260619210000_seed_platform_admin_info`
  pattern, so it is a clean no-op wherever the two accounts are absent. The accounts themselves come
  from `supabase/fixtures/tier2-fixture-users.dev-only.sql`, deliberately **outside** `migrations/`
  so `supabase db push` and `/sync-prod` can never carry it. Production must never grow a pair of
  known-password accounts.
- **DEV only, no override**: `allowsTier2Fixtures()` is the deliberate **inverse** of the Tier-1
  deny-list. DEV is denied to the destructive purge and is the only target Tier 2 may aim at.
- **Non-privileged**: only the publishable anon key and two fixture passwords. A unit test fails if
  the suite or its helper names a privileged key, the GoTrue admin API, or `.env.test`.

**Part two of the same decision: `integration` leaves the default run.** `pnpm test` is now
`unit + conformance + fixtures`; the Tier-1 suites move to `pnpm test:integration`. They are **not**
deleted and their wiring is untouched — this amends decision-25's "they skip, that is expected" by
making the skip explicit instead of a wall of green-looking noise on every run.

Three things shaped the implementation and must not be undone:

1. **The `@example.com` purge would have eaten the fixtures.** `global-teardown.ts` deletes
   `@example.com` users older than 30 minutes and cascade-deletes their orgs. Permanent fixtures on
   that domain would vanish half an hour after seeding — and the suite would then pass **vacuously**
   rather than fail. `selectPurgeableUserIds` now exempts them by exact address
   (`isPermanentFixtureEmail`). This was the single highest-risk detail in the build.
2. **The anti-vacuity block is load-bearing.** "Returned no rows" is only evidence if the rows exist
   and the owner CAN see them, so the suite asserts the corpus from each tenant's own side first.
   Same failure mode decision-30's ">50% must be a hard 42501" guard defends against.
3. **`auth.users` token columns must be `''`, never NULL.** Inserting a fixture user without
   `confirmation_token` / `recovery_token` / `email_change_token_new` / `email_change` makes GoTrue
   fail every sign-in with the opaque `Database error querying schema` — which reads as a broken
   project, not a broken row. Cost ~15 minutes to diagnose; the fixture SQL now sets all four and
   carries a repair `update`.

**The gate was proven to bite**, three ways, not merely observed green:

| Break applied to DEV                            | Result                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `ai_messages` select policy `using (true)`      | "hides a proposal trace from a non-owner" FAILED — B saw 2 of A's turns |
| `organizations` select policy `using (true)`    | org isolation + anti-vacuity FAILED — a tenant saw all 22 DEV orgs      |
| `ai_messages` insert policy `with check (true)` | write-refusal FAILED **and** the integrity guard caught the pollution   |

Each policy was dropped afterwards, the stray rows deleted, and the suite verified back to 19/19.

## Consequences

- The authenticated half of the boundary now has a standing gate that costs nothing and needs no
  infrastructure. The two Ask Monolith Phase 2 RLS assertions execute on every `pnpm test`.
- **`pnpm test` no longer advertises coverage that does not exist.** 70 skipped suites left the
  default run; nothing was deleted.
- **The corpus is hand-listed, unlike Tier 3's.** Conformance derives its probe set from the
  migrations and the generated types, so a new table is covered automatically. Tier 2 covers the
  eight tables named in its migration; a new org-scoped table is **not** covered until someone adds
  it. A unit test pins the SQL and the TypeScript identities together so they cannot drift, but
  nothing forces breadth. Extending it is cheap — add rows to the seed and a row to the case table.
- **Three assertions are write attempts.** They are refused today, and each is followed by an
  integrity re-read. If the boundary ever breaks, the fixture gets polluted and needs the repair in
  `CONTRIBUTING.md` — that is the correct trade for actually testing the write path.
- **DEV now hosts two accounts whose password is in the repo.** They hold no elevated role and RLS
  confines them to their own fixture org; the DEV anon key needed to use them is not committed.
- **Tier 1 is now genuinely dormant.** If a future change makes a dedicated test project cheap, the
  path back is `.env.test` + `pnpm test:integration` — unchanged.
