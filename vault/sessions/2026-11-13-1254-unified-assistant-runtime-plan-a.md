---
type: session
date: 2026-11-13-1254
branch: develop
trigger: wrapup
status: complete
tags: [session, ai, agents, assistant]
related:
  - "[[2026-07-05-decision-26-ai-platform-dual-billing]]"
  - "[[2026-08-04-gotcha-73-a-tool-description-is-untested-surface-and-can-ship-a-dead-verb]]"
---

# Unified assistant runtime, Plan A

## What changed

- Brainstormed a turnaround for the in-app AI after live data showed it was unused: 93 agent runs from one owner, every run failing since September, `get_my_work` the only tool ever called, 0 proposals, 0 memory rows. Spec: `docs/superpowers/specs/2026-11-13-unified-assistant-runtime-design.md`.
- Shipped Plan A to `develop` (`ab70a5b5`, 22 commits, +8,528/−358, no migration): `POST /api/ask` now runs one AI SDK `streamText` loop in `src/lib/assistant/` that offers the whole MCP catalog, runs reads under the user's own client, stages every write, and applies staged writes only through one multi-row confirm card (`applyBatch`). Works with any tool-capable provider; the board dock and `/ask` both use it.
- The board in focus is injected as a bounded snapshot; card rows are described from real board data (`Press kit: set Status to "Working on it"`), never from model prose.
- Tools are pinned to the active organisation. The assistant refuses to create goals and portfolios, and a dashboard that names a workspace, because the underlying database functions ignore the requested organisation.
- Process: 8 task reviews, a whole-branch review (5 Important findings, all fixed), then a live run in the owner's Chrome that found 5 more defects no review had seen (did not know who "me" was; believed applied changes were still pending; generic card rows; stale "changes waiting"; literal Markdown). Fixed and re-tested live.
- Announced on `/updates` as one "improved" entry for 2026-11-13.

## Why

The agents were over-built around permissions (ceilings, grants, a proposal queue) and under-built around context and action, so nothing useful ever ran. The owner chose one assistant that knows what is on screen and acts through a single confirmation, with saved agents to be rebuilt on the same runtime later.

## How to test (for the user)

Setup: pull `develop`, `pnpm dev`, sign in. Uses the DEV database (live data). The board "Assistant test" from the acceptance run still exists; use it or any board you do not mind editing.

1. Open a board, open the dock on the right, chat tab. Type `catch me up`. Expect a summary naming this board's real items with no "which board?" question.
2. Type `assign <an item> to me and set the status of <another item> to Done`. Expect one card, "2 changes waiting", each row naming the item and the value. The reply says the changes are lined up, not done.
3. Open "Details" on a row. Expect the tool name and the exact inputs.
4. Untick one row, click "Apply 1 change". Expect the board to update within a few seconds with no reload, the card to read "Applied.", and a turn beginning "You confirmed these changes."
5. Ask `what did you just change?`. Expect a correct account of the applied change.
6. Type `add these: book venue, send invites (due Friday)`. Apply. Expect two new items, the second dated Friday.
7. Type `archive this board`. Expect a red, unticked row with details open and Apply disabled. Click Dismiss. Expect "Dismissed — nothing was changed." and the board still there.
8. Type `create a goal called Test`. Expect it to decline and point to the Goals page, with no card.
9. Reload the page. Expect resolved cards to stay resolved.

## Open threads

- Before promotion: acceptance checks 6 (non-Anthropic model), 7 (old thread with an unresolved proposal), 9 (step limit) and 8 with a person in two organisations were not run. List: `docs/superpowers/plans/2026-11-13-unified-assistant-follow-ups.md`.
- `create_goal` and `create_portfolio` pick an organisation with `limit 1`; needs a migration, and the Goals and Portfolios pages may be affected for people in more than one organisation.
- Cross-board semantic search from the old chat is gone; owner to decide whether it returns.
- Test board "Assistant test" (`7cfb4b33-…`) is still in the owner's workspace; delete when no longer needed.
- Signup is open with no approval step; the owner wants every new account approved (sub-project 0, not started).
- The one scheduled agent still fails daily with `Invalid Refresh Token`.

## Next session entry point

Start with either sub-project 0 (signup approval, independent and small) or Plan B (dock on every page: item, folder, dashboard and My Work focus). Read the follow-ups file first; it holds the Plan B scope and the hardening list.
