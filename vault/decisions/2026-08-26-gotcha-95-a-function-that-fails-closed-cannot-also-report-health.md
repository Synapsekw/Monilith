---
type: adr
date: 2026-08-26
status: accepted
tags: [decision, gotcha, ai, observability]
related: ["[[2026-08-27-0913-carryover-batch-promote-100-sync-prod]]"]
---

# Gotcha 95 — a function that fails closed cannot also report health

## What happened

The brief was small: `verifyAllProviders()` isolates per-provider failures in try/catch and only
console-logs them, so `/settings/ai` cannot show that a provider's probe has been failing for a
week. Add columns, write them from the sweep, render a badge.

Building it exposed a defect that made the whole feature a placebo. `verifyProviderModels()` fails
**closed**: on a 401, a network error, or any non-OK response it returns
`{verified: 0, unverified: 0}` — byte-identical to the return value for a *healthy* provider that
simply had nothing new to verify. Deriving health from those counters would have filed a week of
authentication failures as `last_verify_status = 'ok'`, and rendered a green badge over an outage.

## The general shape

Fail-closed is the right behaviour for a *decision* function — refuse rather than admit an
unverified model id into the pickers. But a fail-closed return value is deliberately
**indistinguishable** between "nothing to do" and "could not do anything". Health reporting needs
exactly the distinction the fail-closed contract erases.

So: **you cannot bolt observability onto a function whose contract is to collapse failure into a
safe default.** The function has to be widened to report *why* it returned what it returned, or the
monitor built on it is decorative.

## What we did

`verifyProviderModels()` now returns `reachable` and `error` alongside the counters, and
`verifyAllProviders()` switches on `reachable` rather than on counts. Three states are recorded —
`ok`, `failed` (unreachable *or* thrown), `skipped` (no borrowable key, where org-BYO-only providers
land, see [[2026-08-26-decision-39-the-catalog-sweep-never-borrows-an-org-byo-key]]). Four columns,
not two: `last_verified_at` (last success) **and** `last_verify_attempt_at` (last run), because
"failing for a week" is a statement about the interval between them, and one timestamp cannot
express it.

## The check that generalises

Before building a status indicator on top of an existing function, ask: **what does this function
return when it fails, and is that value distinguishable from success?** If it isn't, the indicator
is a placebo no matter how carefully the UI is built. This is the same family as
[[2026-08-04-gotcha-75-a-zero-row-repair-reports-success]] — an operation whose failure mode is
silence cannot be monitored from its own return value.
