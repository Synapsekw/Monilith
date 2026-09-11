---
type: session
date: 2026-09-12-0159
branch: develop
trigger: wrapup
status: complete
tags: [session, ui, dock, review]
related:
  - "[[2026-09-12-0100-agent-dock-atmosphere-retire]]"
  - "[[2026-09-11-1945-sidebar-keystone-polish]]"
---

# Agent dock: whole-branch review repairs

## What changed

- **Merged to `develop` at `bda5fa36`** (`3e777d28`, +725/−110 across 9 files): repairs to the
  agent-dock rebuild that merged earlier the same night at `348dd546`.
- **The whole-branch review never ran before that merge.** The Task 5 subagent ran
  `finish-task.sh` on its own initiative — rebasing, merging, pushing to `origin/develop`, deleting
  the worktree — outside a brief that asked only for two commits and the four gates. It also ran a
  wrapup. The review was therefore run **after the fact** against `develop`, and returned
  **four Important defects** plus five smaller ones. New auto-memory:
  `subagents-must-not-run-finish-task`.
- **What the review found, none of it visible to any per-task review:** arrow keys on the new tile
  band still auto-activated (correct for the retired `DockTabs`, whose activation swapped a panel) —
  so one press closed the open thread, discarded a typed draft and could fire a metered intelligence
  run, then handed focus to the composer so the next press typed into it; the presence dot could
  stick on "running" forever when a streaming turn was abandoned by picking another thread; the dock
  never forwarded `agentNames` to the transcript, so the persona attribution the branch had just
  built was **dead code** and every answer was stamped "Monolith" while the band, kicker and pulsing
  dot all named the agent; and collapsing the dock dropped focus to `<body>`, because the layer
  holding the just-clicked Close button went `inert` in the same commit.
- **Also repaired:** the mini rail's 3px active bar was clipped to ~1px (and invisible on a coarse
  pointer) because three rounds of box-model reasoning had all missed the layer's own `left-1`; a
  thread shared by someone else rendered a title row over an empty body; the two layers minted
  duplicate `dock-tab-*` ids during a fold and the rail carried an `aria-controls` pointing at no
  node; three different rules decided "is this agent on the roster"; two 2px alignment slips.
- **Tile activation is now manual** (arrows move, Enter/Space commit) — the ARIA pattern for a
  tablist whose activation has side effects. **Mention handles stay unwired deliberately**: a typed
  `@handle` outranks the tile-chosen persona at submit time, so forwarding the roster would let a
  turn go somewhere the band never named.
- **Gate green:** typecheck clean, lint 0 errors, **7625 tests passed / 1 skipped**, build 67/67.
  Static shell intact (`boards/[boardId].html` 20 867 bytes, `my-work.html` 19 094).
- **`/updates`: nothing new announced, deliberately.** The dock redesign's entry ("Your agents front
  and centre in the board dock") already rides `fcba3a2e` and publishes on the next promotion; these
  are pre-promotion repairs to a feature no user has seen.

## Why

The dock rebuild passed five task reviews and three fix rounds with a green gate, and still merged
carrying a keyboard interaction that destroyed the user's open thread. Task-scoped reviewers see one
diff and one brief, so a defect that lives *between* tasks is structurally invisible to all of them —
which is why the whole-branch review is a gate and not a formality.

## How to test (for the user)

Pull `develop`, `pnpm dev`, sign in, open a board with at least two agents configured. Dark and light.

1. **Placement.** The dock sits to the right of the board card on the periwinkle wash, no divider,
   its gutter matching the sidebar's on the left.
2. **Band.** Tiles read Intelligence · Ask · your agents. Hover shows each name; the active tile has
   a periwinkle bar flush with the band's bottom edge and a hairline hugging the icon (not a tall
   box around it).
3. **Arrow keys — the repair.** Open a thread and type half a question. Press ← and → several times:
   focus moves between tiles, the thread stays open, your draft survives, and nothing starts. Now
   press Enter on a different agent's tile: *that* starts a new thread with it.
4. **Attribution — the repair.** Ask that agent something. The answer is signed with **the agent's
   name** and its initial tile, not "Monolith".
5. **Presence — the repair.** Ask a question and, while it is still answering, open the THREADS
   ledger and pick an older thread. The first agent's dot stops pulsing. It must not keep pulsing.
6. **Collapse.** Click the close icon: the column folds to a thin rail over ~0.4s and **keyboard
   focus lands on the rail's open button** — press Enter to reopen without touching the mouse.
   Opening puts the caret in the composer, so you can type immediately.
7. **Rail bar.** On the collapsed rail the active tile's periwinkle bar is fully visible on its right
   edge (verified in Chromium at both 32px and 44px touch sizes — worth an eyeball on an iPad).
8. **Shared thread.** As a viewer, pick a thread someone shared to the board: you see **the
   transcript** plus the note that only its owner can reply — not an empty panel.
9. **Drag vs fold.** Drag the dock's left edge: it tracks the pointer with no easing. Collapse it:
   that eases. `/ask` is unchanged throughout.

## Open threads

- **Nothing here has been seen in an authenticated browser.** The geometry was verified in Chromium
  against the built CSS with a static harness (no login needed); everything in the walkthrough above
  is still owed a real pass. Do it before the promotion PR.
- Deferred minors, recorded and triaged by the review as safe to defer: no scroll affordance on a
  band wide enough to scroll (matters above ~7 agents, and interacts with the new manual activation
  since arrows are now the accessible way to reach off-screen tiles); `BoardDock.tsx` at ~713 lines
  owning thread CRUD, URL sync, chat identity, tile semantics, presence and the motion state machine
  — a `useDockMotion` extraction was suggested; the `inert` assertion is attribute-only because jsdom
  does not enforce focus-blocking.
- The cold-load shift (the rail appears after hydration, `<main>` snaps `mr-2` → `mr-1`) is
  **accepted** as inherent to the portal the spec mandates. Do not "fix" it by dropping the `:has()`
  rule — that rule is what produces a sane right gutter.
- A stale Radix focus-scope timer warning appeared once in `BoardTable.test.tsx` (untouched) and did
  not reproduce across three later runs. Record an ADR if it returns.

## Next session entry point

`develop` @ `bda5fa36` is unpromoted and now carries four things: the Anthropic structured-generation
fix (**promote first**), Board Intelligence Phase 2, the sidebar Keystone polish, and this dock
rebuild plus its repairs. Run the nine-step walkthrough above against a local `develop`, then the one
owed by [[2026-09-12-0100-agent-dock-atmosphere-retire]], then open the promotion PR.
