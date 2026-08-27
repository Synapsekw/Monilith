---
type: adr
date: 2026-08-26
status: accepted
tags: [decision, ai, models]
related: ["[[2026-08-27-0913-carryover-batch-promote-100-sync-prod]]", "[[2026-08-11-1501-provider-model-layer-spec-1]]"]
---

# Decision 40 — pickModel prefers the org default over the feature tier, deliberately

## Context

`pickModel`'s ladder is `pin > org default > feature tier > cheapest active`
(`src/lib/ai/models/resolve.ts`). The 2026-08-11 session recorded a doubt about it — *"the ladder
tries the org default before the per-feature tier; the real answer is probably a capability
constraint rather than a tier"* — and that doubt was carried forward in the vault as an **open
defect** for two weeks. It is not one.

## Decision

The order stands. What was actually wrong is that nothing at the definition site said it was
intentional, and the `tier` seam's JSDoc ("Overrides `tierForFeature`") invited the misreading that
passing `tier` forces a model — it does not; it overrides the feature→tier *map*, and the org
default still outranks it. Both are now documented at the definition, with four new tests pinning
the behaviour.

## Rationale

Three independent lines of evidence, none of which the original doubt had:

1. **The org default is the only spend control an admin has.** `resolveAiAdapter` narrows it hard
   before `pickModel` ever sees it (`defaultModelIdFor`): it is only on the ladder when the org's
   `default_provider` equals the provider actually serving the request. By then it is an
   unambiguous, deliberate, mode-consistent admin choice. A tier-first ladder would silently reverse
   "run this org on Haiku" for 11 of the 13 mapped features, and the admin would find out from the
   invoice.
2. **The UI already promises this order in words.** `OrgAiSettingsForm` passes
   `inheritLabel="No default — each feature picks its own tier"` — the tier is what you get when
   there is *no* default. Flipping it would make the setting mean the opposite of its own copy.
3. **The approved spec specifies it.** `2026-08-10-provider-model-layer-design.md` §3, rung 3:
   *"Nothing pinned → org default, nudged by the feature's tier hint."* The implementation matches
   the design that was signed off.

The claim was tested rather than argued: temporarily flipping the two rungs turns **5 tests red**,
two of which predate this session — including one already named *"honours the org default over the
feature tier"*. The order was tested and named as intentional from day one.

## The deferred alternative

The vault's hint at a **capability constraint** is right about the long-term shape and is a separate,
larger change: features declare requirements (tools, min context, vision, structured output), the
resolver filters to satisfiers, and the org default is preferred *among* satisfiers — which
preserves the spend control rather than overriding it. `ai_models` already carries `supports_tools`,
`context_length` and `max_output_tokens`, but nothing for vision, structured output or reasoning, so
it needs a migration **and** a `feed-parse.ts` change. Not urgent: the one capability that matters
today is tool use, and it is already gated loudly at the right boundary
(`ModelNotToolCapableError` in the run callback, a warning at pick time, "· no tools" in the
picker). Recommended home: Spec 2c. A red capability-blindness test is already written in
`resolve.test.ts` for whoever takes it.

## Lesson

A recorded doubt is not a recorded defect. This one survived two weeks of vault carry and one
triage pass before anyone checked it against the spec, the UI copy and the test suite — all three of
which said it was deliberate. Cf.
[[2026-08-17-2154-stale-handover-triage-and-vault-cleanup]]: treat vault claims as hypotheses.
