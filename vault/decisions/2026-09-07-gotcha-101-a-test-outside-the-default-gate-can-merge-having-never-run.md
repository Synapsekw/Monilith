---
type: adr
date: 2026-09-07
status: accepted
tags: [decision, gotcha, testing, process, agents]
related:
  - "[[2026-09-07-0931-spec3-orchestration-eleven-task-build]]"
  - "[[2026-07-27-decision-31-tier2-permanent-tenant-fixtures]]"
---

# Gotcha 101 — a test outside the default gate can merge having never run

## What happened

Spec 3's Task 5 wrote `src/lib/agents/agent_run_claim.rls.integration.test.ts`, ran all four gates
green, and merged into `develop`. Its own report said the file was "written but unverified against a
live database" — accurately, and it merged anyway.

`pnpm test` **excludes the integration project**; it is opt-in. So the four-gate ritual that the
working agreement treats as proof said nothing at all about that file. The first time it ever
executed was two merges later, in a *sibling* task's `finish-task.sh` gate — which failed, blocking
an unrelated branch (Task 9) on a defect that belonged to code already on `develop`.

The defect itself is worth keeping: **the cap and the cooldown read different clocks.** The daily cap
counts `fire_date`, a logical day the fixture chooses; the mention cooldown counts `created_at >
now() - interval '5 minutes'`, the row's real arrival time, left at the column default. The test's
`beforeAll` seeded a row with a past `fire_date` and a comment asserting that kept it out of both
limits. It only kept it out of one — so the run seeded two seconds earlier armed the cooldown that
the test's own "first" claim then tripped over.

`retry: 1` hid the shape. Vitest re-runs a failed test **without** re-running `beforeAll`, so the
retry replayed against state the first attempt had written. The failure looked like flakiness and
was deterministic.

## Decision

**A gate that does not execute a test is not evidence about that test.** Concretely:

- When a task adds or touches a live-DB test, it MUST run `pnpm test:integration` and report the
  result. "The four gates pass" is not a claim about integration coverage, and an agent saying
  "written but unverified" is a **blocker**, not a footnote.
- A stateful, ordered suite sets `retry: 0` at the `describe` level
  (`describe(name, { retry: 0 }, fn)`) — the project-wide `retry: 1` is wrong for any suite whose
  `beforeAll` state its own attempts mutate.
- Prove isolation by running a live-DB suite **three times consecutively**. A suite with state
  leakage passes once; a single green run proves nothing.

## Consequences

- The first diagnosis was wrong and cost a round trip: cross-run leakage from live DEV was assumed,
  and disproved by measurement (zero leftover probe rows; every agent id a fresh `randomUUID()`).
  The cause was entirely in-run. **Check what the fixture itself arms before blaming the database.**
- Backdating `created_at` in the seed helper is the fix that makes the fixture mean what its comments
  already claimed: everything it seeds is *pre-existing history*, and only a just-arrived mention
  should arm a rate limit.
- This is the sibling of [[2026-09-04-gotcha-98-a-disabled-guard-outlives-the-session-that-disabled-it]]:
  there, a guard was dismounted by a session that never reached the gate; here, a test was authored by
  a session whose gate could not see it. Both are the same failure — **the ritual ran, and proved
  something other than what was assumed.**
