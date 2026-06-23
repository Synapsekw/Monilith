---
type: adr
date: 2026-06-23
status: accepted
tags: [decision, gotcha, testing, supabase, integration-tests, ci]
related:
  - "[[2026-06-23-2059-time-allocation-my-time-card]]"
---

# Gotcha 43: the live-DB integration suite is nondeterministically flaky under `pnpm test`

## Context

`pnpm test` (`vitest run`) executes ~33 `*.integration.test.ts` files that hit the **one shared
Supabase project** — in parallel, by default. Each self-seeds via `admin.auth.admin.createUser`

- org/board fixtures and tears down by purging test users (a global-teardown purges by pattern,
  e.g. "purged 28 test users / 28 candidate org-owners").

During the time-allocation build, the gate would not go green. Across **7 runs** of identical,
already-committed code the failing set was a **rotating subset** of the integration suites
(automations/collaboration/platform → boards/subitems/org → run-history/presence/time-entries →
webhook/attachments/notifications …), counts swinging 6–15. Failures were always at **setup**
(`23503` FK-violation, `P0002` no_data_found) or RLS assertions — **never** a unit/component test.
Removing parallelism (`--no-file-parallelism`) reduced but did not eliminate it (still ~6, still a
different set). A killed parallel session mid-teardown made it worse by leaving orphaned rows.

## Decision / what to do

Treat live-DB integration failures as **environmental until proven otherwise**, and verify a change
against the **deterministic** gates: `typecheck`, `lint`, `build`, and the unit/component suites
(including the feature's own tests). A failing set that **reshuffles run-to-run while deterministic
tests stay green** is contention/pollution, not a regression.

To get a trustworthy integration signal (and an eventually-green gate):

- Run the integration suite **serially** and ideally **single-threaded** against the shared DB, or
  point it at a **dedicated/ephemeral** Supabase project so runs don't race on shared rows.
- Never run two `pnpm test` invocations against the shared DB at once (the global-teardown purge
  races; it deletes other runs' just-created users mid-test).
- If a session is killed, expect orphaned test data; the suite may stay dirty until cleaned.

## Consequence

A purely-additive feature can be merged past the red `pnpm test` gate **with a documented
exception** when (a) all deterministic gates are green, (b) the failure set is rotating integration
suites unrelated to the change, and (c) the change never appears in any failure. This is what
happened for [[2026-06-23-2059-time-allocation-my-time-card]] (merged at `aabda5a`).

**Follow-up worth doing:** make the integration suite deterministic (serial + isolated DB) so
`finish-task.sh`'s gate is reliable instead of routinely red.
