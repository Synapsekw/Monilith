---
type: adr
date: 2026-08-11
status: accepted
tags: [decision, gotcha, testing, process]
related: ["[[2026-08-11-1501-provider-model-layer-spec-1]]"]
---

# Gotcha 89 — five tests that could not fail, in one plan

## Context

The provider/model layer shipped **five tests that pass against any implementation**. None was
caught by the suite going red — every one was found by a human-style review reading the test
against its own title. They are worth listing together, because the shapes recur:

1. **The arg-blind query fake** (Task 4a). A fake Supabase client whose `.eq()` / `.neq()` /
   `.lt()` / `.in()` discarded their arguments. Deleting `.eq("provider", provider)` from the
   query under test left all eight tests green. This same class had **already** let a broken
   retirement predicate ship one task earlier — a healthy feed omitting one provider would have
   retired that provider's entire catalog.
2. **The assertion satisfied by the bug** (Task 6). `costToCredits` coverage had been reduced to
   `costToCredits(1) === 100`, which passes for a naive `costUsd * 100` with no rounding at all —
   on a billing function asserted nowhere else.
3. **The scan a comment could satisfy** (Task 8). A source-scanning guard required `/\bmodel\b/`
   anywhere in a callback's text; one call site had the word "model" in a *comment* inside its
   callback, so deleting `model` from its destructure still passed.
4. **The security test asserting on absent input** (Task 9). "Never renders a raw key" asserted
   that rendered output lacked a key string **that was never supplied to the render** — and
   `textContent` excludes input values anyway, so it could not have observed the leak it named.
5. **The arg-blind write on the RLS-bypassing client** (Task 10). `update().eq()` was arg-blind
   where `.eq("org_id", ctx.orgId)` was the **only** tenant boundary, because the write goes
   through the service client. Deleting it would set or clear every org's default model, green.

## Decision

**A hand-rolled Supabase fake must record *and apply* its predicate arguments.** Recording alone
lets a suite assert the call; applying is what makes a missing filter change the rows returned and
the rows mutated, so the test fails on *observed state* rather than on a recorded argument.
`src/test/ai-models-fake-client.ts` is the reference shape.

**Mutation-test the guard, don't assert it.** For any test whose value is "this specific defect
cannot return", apply the mutation, watch it fail, revert — and paste the failure into the report.
Two implementers adopted this unprompted late in the plan; one ran nine mutations and reproduced a
production error verbatim. Every "fix" to the five above was accepted only on that evidence.

## Consequences

- Four of the five were repaired in the final fix wave. **Six further arg-blind fakes remain**
  outside this branch's files (`agentic/actions.test.ts`, `autopilot/route.test.ts`,
  `automation-step/route.test.ts`, `ask/route.test.ts`, `agents/send.test.ts`,
  `column-fill/actions.test.ts`) — two of them on service-client writes whose tenancy is therefore
  unfalsifiable. Scheduled, not done.
- `CONTRIBUTING.md` should carry the recording-fake rule as a standing requirement.

## The generalisable lesson

**A test's title is a claim, and a green test is not evidence the claim is true.** The failure mode
is uniform across all five: the assertion was written against the *shape* of the code rather than
against a behaviour that could differ. The cheap check is to ask, for any test that guards a
specific defect, *"what one-line change should turn this red?"* — and then actually make it.

Five in one plan is a process signal, not five coincidences. Notably, the two most dangerous
(1 and 5) both sat on queries where a dropped predicate crosses a **tenant** boundary or empties a
**catalog** — the blast radius is largest exactly where a fake is most tempting to keep simple.
