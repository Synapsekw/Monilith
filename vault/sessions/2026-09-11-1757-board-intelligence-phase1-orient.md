---
type: session
date: 2026-09-11-1757
branch: develop
trigger: wrapup
status: complete
tags: [session, board-intelligence]
related:
  - "[[2026-09-11-1157-editorial-landing-port]]"
---

# Board Intelligence — brainstorm, spec, and Phase 1 (Orient) merged

## What changed

- Brainstormed "board intelligence" with the owner using live mockups (visual companion, built on the real board anatomy after the first pass used invented rows). Locked: an always-on **strip** on its own row under the header plus a **dock tab** for depth; the label is **Intelligence** (the owner rejected "Pulse" — the product is Monolith); five deterministic strip signals; per-user on-demand brief; one-click Apply with Undo; "Always do this" becomes a board automation; inline ephemeral Q&A.
- Spec `docs/superpowers/specs/2026-09-11-board-intelligence-design.md` (`7aab5a4d`) and the Phase 1 plan `docs/superpowers/plans/2026-09-11-board-intelligence-phase-1-orient.md` (`ab073555`), 8 tasks with an execution DAG.
- Phase 1 built subagent-driven in `task/board-intelligence-orient` and merged to `develop` at `db10664c` (18 commits): `src/lib/boards/intelligence/` (signals engine, provider, `board_visits` read/action/hook), `intel=<kind>[:<subject>]` in the board filter state, narrowing in Table/Kanban/Calendar/Gantt, row highlight/dim CSS in `@layer utilities`, `IntelligenceStrip` mounted in `BoardHeader`, migration `20260911113714_board_visits` (applied to DEV, ledger 162/162 after the usual version reconcile).
- Per-task reviews caught: dangling dependency ids in the blocked chain; the table narrowing a top-level-only list so a matching sub-item deleted its parent; the row rule declared in `@layer base` losing to `shadow-card`; sub-item rows with no treatment; drag elevation lost on matching rows. The whole-branch review caught what none of those could: the inset row rule painted under the opaque frozen name column in Table and Timeline (now a `::after` pseudo-element above `z-10`), an `?intel=`-only URL wiping the saved filter on the next write, a double `buildLastActivity` pass per cell edit, and the render-count suite running provider-less.
- `/updates` announced: "Board intelligence strip" (trailer on `31787bc7`, regenerated in the same task).
- Memory: `no-pulse-naming-in-ui` saved.

## Why

Boards had no layer that says what needs attention; the dock chat exists but only answers when asked. Phase 1 gives every board a quiet, deterministic first-paint read of overdue, blocked, overloaded, stalled and changed-since work, computed client-side from the payload already in memory, so the LLM phases that follow have counts they cannot invent.

## How to test (for the user)

Setup: pull `develop` (`db10664c`), run `pnpm dev`, open any board with a Status column and a Date column. Do this first: the final reviewer's Critical finding was paint order, which no test can see, so eyeball step 3 in Table and Timeline before anything else.

1. Open the board in the table view. Under the header (title, view tabs, search) you should see a row that starts with the mono kicker **Intelligence** and a small dot. If nothing needs attention it reads "All on track · nothing overdue · last change …". No "Catch me up" button and no "updated Xm ago" yet (Phase 2).
2. Set an item's date to yesterday with a non-done status. The strip shows a chip "1 overdue" with a red dot. Set a second item to a status named "Stuck" and add a dependency from it to another item: a "1 blocked chain" chip appears.
3. Click "1 overdue". The chip takes the accent outline, the URL gains `?intel=overdue` with no page reload, the overdue row shows a 2px red rule at its left edge (visible over the frozen name column), and every other row dims. Scroll horizontally: the rule stays at the row's left edge. Click the chip again or "✕ clear": everything returns to normal and `intel` leaves the URL.
4. Make only a sub-item overdue and click the chip: the parent row stays visible with the sub-item reachable under it.
5. Switch to Kanban, Calendar and Timeline with the chip active: each view narrows to the same items; kanban cards and timeline rows carry the rule, calendar bars and agenda rows too.
6. Assign one member to at least twice as many open items as everyone else: "overloaded · <first name>" appears with a yellow dot; click it to see only their rows.
7. Leave a group untouched for over five days (or wait): "stalled groups" appears; clicking it keeps that group expanded.
8. Open the board, leave (switch tab or navigate away), edit an item from another browser or later, come back: "N changed since <weekday>" appears with a periwinkle dot and filters to what changed. First-ever visit shows no such chip.
9. Save a board filter (e.g. search "urgent"), then open the board via a link carrying only `?intel=overdue`: both the saved filter and the chip apply; clearing the chip does not erase the saved filter.
10. Open the board as a viewer: the strip and chips render and filter, nothing else changes.
11. Check `/updates` on the deployed site after promotion: "Board intelligence strip" is listed under 2026-09-11.

## Open threads

- Owed: the browser visual pass above. The session could not authenticate a browser (Chrome extension disconnected, e2e provisioning refuses DEV).
- Parked cosmetic residuals for a Phase 2 polish pass: the `::after` rule ignores `border-radius` on kanban cards (square ends protrude); a selected and matching table row overlaps the 3px selection marker by 2px; the rule is anchored to the row edge, so it scrolls with content while the name column stays frozen; the `globals.css` block header still says "inset"; `pointer-events: none` is not locked by the CSS test; `BoardTableInner.tsx` at 803 lines trips the 800-line warn.
- Deferred minors in the plan ledger (all "ship as is" per the final review): `board_visits` delete policy omits `can_read_board` (own-row only, no cross-tenant surface); stalled groups cannot be collapsed while their chip is active (spec-mandated); the strip's `role="group"` has no roving tabindex; the frozen per-mount clock; the visit stamp on hard unload is best-effort (no `keepalive`).
- Phases 2–4 (Advise: run + cache + dock tab + Apply/Undo; Act: `assign_person` automation + "Always do this"; Ask: inline Q&A) are specced, not planned.
- Not promoted: `develop` is ahead of `main` by this merge.

## Next session entry point

Run the walkthrough above against a local `develop` (or promote and run it against production), then `writing-plans` for Phase 2 (Advise) from spec §2.2, §4, §7, §8 — it is the critical path (run action → dock tab body → Apply/Undo). Add the cosmetic residuals to that plan.
