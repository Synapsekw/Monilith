---
type: adr
date: 2026-08-11
status: accepted
tags: [decision, gotcha, testing, vitest]
related: ["[[2026-08-11-1501-provider-model-layer-spec-1]]"]
---

# Gotcha 90 — vitest reports a handled rejection as an unhandled error

## Context

`AgentRunHistory` needed a test for a real defect: when its `useQuery` fn **throws**, the component
must render the error branch, not "No runs yet." Writing it looked trivial — make the mocked server
action reject, assert the alert renders.

The test failed with a bare `Error: …` even though the component handled the rejection correctly and
the assertion it was supposed to make would have passed.

Cause: **vitest v4 tracks a spy's settled results.** A rejected promise returned by a `vi.fn()` is
surfaced as an unhandled error against the test, independently of whether the caller handled it.

Two details make it expensive to diagnose:

- **It only reproduces when a `beforeEach` is present.** Without one the same test passes, so the
  minimal repro someone reaches for first does not show the bug.
- **An explicit `.catch()` on the returned promise does not help.** The tracking is on the spy's
  own settled result, not on the promise chain the test builds.

## Decision

**Reject at the mocked module boundary, not from the spy.** Have the module mock throw (guarded by
a `throwWith` variable reset in `beforeEach`) rather than returning a rejecting `vi.fn()`.

What this gives up is the ability to assert the spy's call arguments in that one test. That is
acceptable, and arguably better: the property under test is *"a rejecting query lands on the error
branch, not the empty state"*, which holds regardless of where the rejection originates — and a
throwing module boundary is a **more faithful** model of a dropped Server Action than a spy that
resolves to a rejected promise.

## Consequences

- Comment the reason at the declaration; without it the indirection reads as an accident and the
  next person will "simplify" it back into the failing shape.
- Reset the throw flag in `beforeEach` so it cannot leak across tests.
- This will recur anywhere a test needs a mocked async boundary to fail. It is not specific to
  React Query.

## The generalisable lesson

**When a test fails with an error the code under test demonstrably handled, suspect the harness
before the code.** The signal here was the shape of the failure — a bare `Error` with no assertion
message — plus the fact that it appeared and disappeared with an unrelated `beforeEach`. A test
harness is infrastructure, and infrastructure can manufacture the symptom it is meant to observe
(cf. [[2026-08-06-gotcha-79-a-test-probe-can-manufacture-the-bug-it-is-hunting]]).
