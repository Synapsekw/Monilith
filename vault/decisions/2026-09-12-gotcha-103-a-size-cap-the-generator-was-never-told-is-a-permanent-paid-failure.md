---
type: adr
date: 2026-09-12
status: accepted
tags: [decision, gotcha, ai]
related:
  - "[[2026-09-12-0745-intelligence-size-clamp-and-promote-122]]"
  - "[[2026-09-11-gotcha-99-a-dependency-bump-can-flip-a-default-no-test-exercises]]"
  - "[[2026-09-11-2124-board-intelligence-phase2-advise]]"
---

# Gotcha 103 — a size cap the generator was never told is a permanent paid failure

## Context

"Catch me up" failed for the owner on every attempt: about two minutes of nothing, then "Couldn't
read this board. Please try again." The handover suspected a hang, an SDK retry loop, a
`NoObjectGeneratedError`, or the wrong provider. All four were wrong, and the DB said so before any
code was read: `ai_usage` held **two** `board_intelligence` rows (anthropic / claude-sonnet-5, 14818
in, 6374 and 3878 out) while `board_intelligence_runs` held **zero**. `runAi` only meters what the
inner function returns, so the model call had completed — twice — and the failure was downstream of
it.

The logged cause named the exact fields: `rawOutputSchema.parse` threw `ZodError` with
`too_big` on `brief` (maximum 700) and on `suggestions[0].evidenceItemIds` (maximum 8).

Those caps live only in Zod. `BOARD_INTELLIGENCE_JSON_SCHEMA` — the schema the model actually sees —
deliberately carries no lengths, and `systemPrompt()` said "3 to 5 sentences", "a short title", "a
terse evidence kicker", never a number. So the model was asked for prose and then judged against
limits it had no way to know.

The failure is not merely a rejected run. `validateIntelligenceOutput` throws *after* the metered
call, and a failed run writes no row, so the input hash is unchanged: the next click regenerates
from scratch, pays again, and fails again on the same sentence. It is permanent and it bills every
time. This is the second instance of the same shape in one feature — the pre-merge whole-branch
review caught the first (`computeSignals` emitting more than `payloadSchema.max(10)` signals).

## Decision

**Raw model output is validated for SHAPE, never for SIZE.**

Every length and count cap on a generated field truncates: `brief`, `title`, `evidence`, `body` and
the nudge `message` cut on a word boundary with an ellipsis; `suggestions`, `actions`,
`evidenceItemIds` and action `itemIds` slice to their cap. `min(1)` is dropped from `title` and
`actions` — an untitled or actionless suggestion is dropped in `validate` with a warning, never
thrown. Structural invalidity (a wrong type, an unknown `kind`, a missing key) still throws: that is
a genuine provider failure.

The stored schemas (`actionSchema`, `suggestionSchema`, `payloadSchema`) stay strict. They are fed
only server-built data and remain the safety net that keeps an unreadable payload out of the table.

Where a cap exists, the prompt states the number, so truncation is the rare fallback rather than the
normal path.

## Rationale

A generator is not a caller. A caller that violates a contract has a bug to fix; a model that
writes 740 characters has done nothing wrong if nobody told it 700 was the limit. Enforcing an
untold cap converts a cosmetic overflow into a total, billed loss of work that no retry can clear.

The alternative — keep the strict parse and only fix the prompt — was rejected: the prompt makes
overflow rarer, never impossible, and the failure mode it leaves behind is the worst-case one
(permanent, paid, invisible until someone reads the server log).

Truncating also matches what the code already intended: `validate.ts` was already slicing title,
evidence and body to the same numbers, and `capLabel` exists for exactly this reason. The strict
parse simply ran first.

## Consequences

- Positive: a run can be short-changed but can never fail on size, and can never be paid for twice
  for the same reason. The cache fills, so a retry is free.
- Positive: the same rule is now stated once and testable — over-cap output on every field parses
  and lands inside the caps.
- Negative: a genuinely runaway brief is silently cut rather than surfaced. The warnings array
  records dropped suggestions, but a truncated brief leaves no trace.
- Open follow-up: the sibling raw schemas (`src/lib/reports/ai-draft-schema.ts`,
  `board-gen-schema.ts`, `automation-gen-schema.ts`) have not been audited for the same
  `.max()`-after-payment shape.

## Related

- `src/lib/ai/board-intelligence/schema.ts`, `validate.ts`, `prompt.ts` — the fix (`a4478481`).
- [[2026-09-11-gotcha-99-a-dependency-bump-can-flip-a-default-no-test-exercises]] — the other
  failure in this feature that no test could see.
- Diagnostic order worth keeping: read `ai_usage` before blaming the provider. A row means the call
  completed and the fault is downstream; no row means it never returned.
