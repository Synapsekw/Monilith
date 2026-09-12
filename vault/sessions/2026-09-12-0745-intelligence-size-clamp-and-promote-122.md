---
type: session
date: 2026-09-12-0745
branch: develop
trigger: wrapup
status: complete
tags: [session, board-intelligence, promote]
related:
  - "[[2026-09-11-2124-board-intelligence-phase2-advise]]"
  - "[[2026-09-12-gotcha-103-a-size-cap-the-generator-was-never-told-is-a-permanent-paid-failure]]"
---

# Catch me up fixed at the root, and Phase 2 promoted to production

## What changed

- Root-caused the "Couldn't read this board" failure without touching a fix first. `ai_usage` held
  two `board_intelligence` rows (14818 in, 6374 and 3878 out) and `board_intelligence_runs` held
  zero, which proved the model call completed and the fault was downstream; the logged `ZodError`
  then named the fields. Every suspect in the handover — hang, retry loop, `NoObjectGeneratedError`,
  wrong provider — was wrong.
- Fixed it at the root (`a4478481`, task worktree, 6 files): size caps in `rawOutputSchema` now
  truncate instead of reject, `min(1)` dropped from `title`/`actions` (validate drops those cards
  with a warning), the stored schemas stay strict, and `systemPrompt()` states every budget. Tests
  cover over-cap output on every field, the untitled-card drop, and that a bad shape still throws.
  ADR: [[2026-09-12-gotcha-103-a-size-cap-the-generator-was-never-told-is-a-permanent-paid-failure]].
- Owner confirmed the feature works; DEV now holds its first `board_intelligence_runs` row
  (claude-sonnet-5, 14818 in / 5284 out, 2 suggestions).
- Promoted `develop → main` as **PR #122**, 44 commits: Board Intelligence Phase 1 + 2, the
  Anthropic `instructions` fix that ended a four-day production outage, the sidebar Keystone polish
  and this fix. Verified live, not assumed: develop CI green, PR checks green, head SHA unchanged at
  merge, main CI green (run 34638123154), Vercel `state=success` on `918c38bb`, and
  `www.monolith.works/updates` serving "AI generation on Anthropic works again" and "Board brief and
  suggestions". Squash divergence healed (`6e47e977`, `-s ours`).
- Measured the latency complaint rather than guessing: the stored payload is ~700 output tokens of
  JSON against ~5300 billed, so roughly 85% is adaptive thinking nobody chose — `generate.ts` passes
  no `thinking`, so `requestShapeFor` hands it the default (adaptive, effort "high"). Not fixed;
  deferred by the owner. A tier change would not help: `pickModel` puts the org default model above
  the tier hint.
- `/updates`: nothing announced. The size-clamp bug only ever existed in the unreleased Phase 2, so
  the brief shipped working; the Anthropic outage already had its entry. The 2026-08-27 coverage gap
  (agent memory / create_pdf) stays deliberately unannounced — memory is inert in every org.
- Deleted the stale `_draft-2026-09-12-0341.md`; its work is already covered by
  [[2026-09-12-0100-agent-dock-atmosphere-retire]] and [[2026-09-12-0159-agent-dock-review-repairs]].

## Why

Phase 2's headline surface failed on the owner's first click and again on the retry, and each
failure billed a full model call with nothing cached — the feature was not merely broken, it was
expensively broken. Promoting afterwards also cleared a four-day production outage of every
Anthropic-routed structured feature.

## How to test (for the user)

Production (`www.monolith.works`), on a board with a Status column, a Date column, a People column
and a few items, at least one overdue:

1. Open the board. The Intelligence row under the header ends with a "Catch me up" pill.
2. Click it. Expect skeletons, then a plain-prose brief under "Last 7 days" and up to five
   suggestion cards. First run takes 1–2 minutes — that is the thinking budget, not a hang.
3. Click "Catch me up" again within 30 minutes without editing anything: the brief returns
   instantly, with no new model call.
4. Edit any cell, click again: a new brief is generated.
5. On a card, click "why?" — a popover lists the items it rests on.
6. Steps 4–12 of [[2026-09-11-2124-board-intelligence-phase2-advise]] (Apply + Undo, Dismiss,
   Show rows, viewer mode, Nudge) remain the owed manual pass; they are now live in production.

## Open threads

- Browser verification of Apply/Undo, Dismiss, Show rows, viewer mode and Nudge — never run, now
  live and unproven.
- Latency: give `board_intelligence` an explicit `thinking` config, following `ask/context.ts` and
  `write/propose.ts`. Measure with `board_intelligence_runs.tokens_out`, not by feel.
- The agent-dock rebuild (`bda5fa36`) is merged to `develop` and unpromoted.
- The OpenAI, openai-compatible and Google adapters still pass the deprecated `system` option, with
  no real-`generateObject` wire test — the same defect class that caused the outage.
- Sibling raw schemas (`reports/ai-draft-schema.ts`, `board-gen-schema.ts`,
  `automation-gen-schema.ts`) unaudited for the same `.max()`-after-payment shape.
- Board Intelligence Phase 3 (Act) and Phase 4 (Ask) are specced, never planned. Phase 3 needs a new
  `assign_person` automation action before reassign cards can offer "Always do this".
- Deferred by review, none blocking: `revertSuggestion` not tied to the applied action's cells;
  "Catch me up" can scroll off a narrow strip; strip meta paints one render late; the full run row
  rides the RSC payload on every board load; no retention on `board_intelligence_runs`; the prompt's
  MEMBERS block is uncapped; undo runs outside `startTransition`.

## Next session entry point

Walk the owed Apply/Undo/Dismiss/Show-rows/viewer/Nudge pass against production, then land the
thinking-budget change, then plan Phase 3 (Act) from spec §5.
