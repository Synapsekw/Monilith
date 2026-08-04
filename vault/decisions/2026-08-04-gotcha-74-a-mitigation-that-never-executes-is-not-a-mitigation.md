---
type: decision
date: 2026-08-04
tags: [decision, gotcha, testing, rls]
related:
  - "[[2026-08-04-1443-board-dock-and-ai-move-verb]]"
  - "[[2026-07-02-decision-25-no-isolated-test-db-integration-opt-in]]"
---

# Gotcha 74 — a mitigation that never executes is not a mitigation

## What happened

The Personal Agents Phase 2 spec widened RLS on `ai_conversations`, a live table holding private
`/ask` history. It named its own highest-severity risk and named the mitigation:

> Risk: widening `ai_conversations` RLS leaks private `/ask` history — **High**.
> Mitigation: `src/lib/ai/ask/ai-conversations.rls.integration.test.ts` must be extended to prove
> both directions.

That suite has **never executed**. `integrationTargetReady()` deny-lists DEV and PROD because the
Tier-1 teardown is a destructive purge, and [[2026-07-02-decision-25-no-isolated-test-db-integration-opt-in]]
rules out a dedicated test project — so all ~70 Tier-1 suites self-skip, this one included.

The spec cited it as precedent. The precedent was decorative.

Worse, the repo had already hit this exact trap for this exact table. The Tier-2 fixture seed
migration carries the comment:

> "That assertion shipped in July 2026 and had never executed, because its suite is a Tier-1
> integration test that always skipped."

Discoverable at spec time from two files. Nobody looked, because "there is an existing suite for
this" felt like enough.

## The second failure, one layer down

The rewritten Tier-2 suite then passed 21/21 against live DEV — and was **still** blind to the
thing that mattered. The corpus had no row with `board_id IS NOT NULL AND visibility = 'private'`,
so the policy's `visibility = 'board'` conjunct was never exercised: **deleting it from either
policy would have left all 21 tests green**, while leaking every unshared docked thread to every
board member. That row class is precisely what the feature creates by default.

Closed by seeding one discriminator row differing from the passing case in exactly one column, and
verifying by differential evaluation on DEV — shipped predicate `false`, predicate-minus-conjunct
`TRUE`.

## The rule

**Prove the mitigation runs before you rely on it.** Two checks, both cheap:

1. **Does it execute?** A skipped suite reports success. Before citing a test as a control, run it
   and read the count — `7 skipped` is not `7 passed`. If it cannot run in this repo, say so in
   the spec and pick a tier that can.
2. **Does it discriminate?** For a security predicate, name each conjunct and point at the case
   that fails when it is deleted. A corpus that cannot express a conjunct's falsity cannot test it.

For RLS specifically in this repo: **Tier 2 (`*.fixtures.test.ts`) is the tier that actually runs
against DEV**, because it only reads — `allowsTier2Fixtures()` inverts the Tier-1 deny-list. Tier-1
`*.integration.test.ts` is documentation until a test project exists.

## What was kept

The non-executing Tier-1 suite ships alongside, with a header stating plainly that it does not run
today and naming the Tier-2 file that does. It still carries the one property no available tier can
reach — revocation, which needs a `DELETE` a permanent fixture must not suffer. **A skipping suite
presented as a guarantee is what caused this; a skipping suite labelled as documentation is
honest.**

Judged acceptable to ship unproven, for a reason worth recording: revocation is not a distinct code
path. It is `can_read_board()` returning false, which the off-limits-board cases already prove
twice over, and there is no cache or denormalisation between the grant and the policy.
