---
type: adr
status: accepted
date: 2026-07-31
tags: [project/monolith, adr, gotcha, security, server-actions, dead-code]
related:
  - "[[2026-07-31-1708-quality-sweep-crlf-dead-code]]"
---

# Gotcha 66 — An uncalled `"use server"` export is still a live POST endpoint

## Context

An orphaned-code sweep found five server actions with **zero call sites anywhere in the repo**:

| Module                        | Dead exports                                                    |
| ----------------------------- | --------------------------------------------------------------- |
| `src/lib/portfolios/actions.ts` | `renamePortfolio`, `deletePortfolio`, `updatePortfolioMapping` |
| `src/lib/goals/actions.ts`      | `reorderGoal`                                                  |
| `src/lib/ai/ask/actions.ts`     | `askPulse`                                                     |

All were built to their Phase 7a/7b/E1 plans; the UI that would have called them was never wired up.
`deletePortfolio` in particular is an unguarded `.delete().eq("id", …)` relying entirely on RLS.

## Decision

Treat a dead export from a `"use server"` module as a **security finding**, not as tidiness. Delete
it — and the validation schemas left with no consumer — rather than leaving it "in case we wire the
UI up later". Git history is the archive.

## Rationale

Next.js compiles every export of a `"use server"` module into a callable endpoint with a **stable
action ID**, reachable by anyone who can POST to the app. "Nothing calls it" is a statement about
*our* client, not about *reachable surface*. So an uncalled action is strictly worse than ordinary
dead code:

- it is reachable by an attacker but exercised by no user, so a regression in it is invisible;
- it drifts out of sync with the guards its live siblings gain;
- it is the least-reviewed code in the module, because reviewers follow call sites.

The detection trap worth remembering: **their tests kept them looking alive.** `askPulse` and
`askPulseLoop` had 328 lines of passing tests between them, which is exactly why nobody noticed that
`POST /api/ask` had superseded both. A file-level "is it imported?" scan reports "imported" — by its
own test. The signal is *imported by something that is not its own test*.

## Consequences

- Positive: ~620 lines removed, five endpoints closed, four orphaned Zod schemas dropped.
- Negative: re-wiring any of these features means restoring from git rather than uncommenting.
- Follow-up: worth a periodic sweep — grep each `"use server"` export for a non-test importer.

## Related

- `[[2026-07-31-1708-quality-sweep-crlf-dead-code]]`
- AGENTS.md § "Server Actions for all mutations" — the corollary is that an action with no mutation
  to serve should not exist.
