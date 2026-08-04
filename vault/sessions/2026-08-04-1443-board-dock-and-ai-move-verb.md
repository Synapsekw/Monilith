---
type: session
date: 2026-08-04-1443
branch: develop
trigger: wrapup
status: complete
tags: [session, ai, agents, boards, subagent-driven]
related:
  [
    "[[2026-08-04-gotcha-73-a-tool-description-is-untested-surface-and-can-ship-a-dead-verb]]",
    "[[2026-08-04-gotcha-74-a-mitigation-that-never-executes-is-not-a-mitigation]]",
    "[[2026-08-04-decision-33-a-board-dock-reverses-ask-as-a-standalone-surface]]",
    "[[2026-08-01-2021-personal-agents-phase1]]",
    "[[00-north-star]]",
  ]
---

# The board agent dock, and an AI verb that could not be called

## What changed

- **Personal Agents Phase 2 shipped — the board thread dock** (spec + plan + 7 tasks, merged
  `f454e20d`, 42 files / ~5,000 lines). A collapsible, resizable right dock hosting agent
  conversations: private by default, shareable to the board, with the agent roster as personas and
  scheduled briefings landing as repliable threads. `ai_conversations` gains `board_id`, `agent_id`,
  `run_id`, `visibility` and **two additive SELECT-only policies**. Zero requests until opened.
- **`propose_move_item` shipped** (plan + 3 tasks + a fix wave, merged `2b186ce4`). The AI can now
  move an item between groups on a board — a gap found by using the dock the hour it landed.
  Delegates to the already-shipped `moveItem`, so cross-board refusal, subitem refusal and
  append-to-end came for free.
- **A cross-tenant hole was caught by the whole-branch review, not by six scoped ones.**
  `createConversation` resolved `agentId` through RLS under the comment _"never accept an agent id
  on trust"_ — and twelve lines below accepted `boardId` on trust. Any authenticated user knowing a
  board's uuid could plant attacker-authored content into another tenant's dock, unattributed. The
  RLS suite proved exhaustively who may **read** `board_id`; nobody asked who may **write** it.
- **`board_id` was `on delete cascade`, and `purgeBoard` is an owner-only hard delete** — so one
  user could permanently destroy another member's *private* threads. Now `on delete set null`,
  which also fails closed (a nulled `board_id` drops out of the shared-read policy).
- **A board viewer was told "Done" for a move RLS silently blocked** — `moveItem`'s UPDATE matched
  zero rows and returned no error. `renameItem` already guarded this; `moveItem` never did, because
  drag-and-drop hides itself from viewers. The AI path was the first caller with no client-side
  gate. Fixed for drag-and-drop and bulk-move too.
- Two ADRs written ([[2026-08-04-gotcha-73-a-tool-description-is-untested-surface-and-can-ship-a-dead-verb]],
  [[2026-08-04-gotcha-74-a-mitigation-that-never-executes-is-not-a-mitigation]]), plus
  [[2026-08-04-decision-33-a-board-dock-reverses-ask-as-a-standalone-surface]].

## Why

The dock closes the half of Personal Agents that Phase 1 left as an email: the roster existed but
the `instructions` field shaped nothing you could see. The move verb exists because the dock was
used immediately and hit a wall — the assistant had create-item, create-group and set-fields, but
no way to move one, and suggested recreating the item, which would have dropped its updates, files
and activity.

## How to test (for the user)

Pull `develop`.

1. Open any board. **The dock is collapsed** — the board should render exactly as before.
2. Open it. The board *narrows* rather than being covered; the page must not scroll sideways.
3. Send a message with the switcher on **Ask**. It streams; switching board views still works
   without a reload.
4. Switch to one of your agents (Settings → Agents) and ask something — the reply is attributed to
   that agent.
5. Say **"move &lt;item&gt; to &lt;other group&gt;"**. Expect a confirm card reading
   `Move "&lt;item&gt;" from &lt;group&gt; to &lt;other group&gt;`. Nothing moves yet.
6. Approve, then **reload the board** — the item is at the bottom of the target group, with its
   updates, files and activity intact.
7. Share a thread to the board. As another board member: readable, not postable. As a non-member:
   invisible. Your `/ask` history is unchanged.
8. Collapse, reload — stays collapsed. Open, reload — reopens **and loads its threads**.
9. At phone width, open the dock: it fills the screen as a sheet and closes cleanly.
10. Drag the dock's left edge: the board narrows, the page doesn't scroll sideways, the width
    survives a reload.

Steps 9–10 are the ones to not skip — the dock changed the board page's root layout from a fragment
to a nested flex row, and nothing here was verified in a browser.

## Open threads

- **An approved AI write is invisible until you reload.** Systemic across all four verbs: no action
  in `src/lib/boards/actions/item.ts` calls `revalidatePath`, and the dock deliberately suppresses
  `router.refresh()` so a turn doesn't re-run the board's queries. Needs its own decision — patch
  the board store on approve, or accept the reload.
- **`semantic_search_items` is the sole source of item ids** for the AI write path, entitlement-gated
  and returning `[]` on error. Single point of failure for `move_item` **and** the long-shipped
  `set_item_fields`. Adding ids to `query_items` would close it.
- **Revocation is unproven** — no available tier can reach it (needs a `DELETE` a permanent fixture
  must not suffer). Judged acceptable: it is `can_read_board()` returning false, already proven
  twice by the off-limits-board cases.
- `resolveCreateItem`'s "That group isn't on this board." has the same archived-group inaccuracy
  fixed for move.
- A multi-org user can dock a thread stamped `org_id = A` onto a board in org B. Not a tenant
  escape; org attribution can drift. A CHECK coupling `board_id → org_id` would close it.
- `gotcha-55` (MCP `apply_migration` stamping its own version) fired on **4 of 4** migrations this
  session. It is routine now, not a surprise — budget the `reconcile-migration-version.sh` step.

## Next session entry point

**Promote.** `develop` is ahead of `main` by E6 billing batch 1, the Keystone wash, the dock and the
move verb — run `/promote`. After that, the highest-value follow-up is making an approved write
visible without a reload, since it undercuts every write verb the assistant has.
