---
type: session
date: 2026-11-14-1124
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-15-1915-folder-command-center]]"
---

# Cross-board dependencies and the folder Timeline

## What changed

- Studied the Etisalat Drones & Robotics tracker (2,127 activities, 1,360 dependencies, 81 across workstreams) and chose to build only generic capability: links between boards and a folder-wide Gantt. Spec `docs/superpowers/specs/2026-11-13-cross-board-dependencies-folder-timeline-design.md`, plan `docs/superpowers/plans/2026-11-13-cross-board-dependencies-folder-timeline.md`.
- Migration `20261113190536_cross_board_dependencies` (live on DEV, ledger 191/191): `item_dependencies.predecessor_board_id`, a trigger that derives both board columns and `org_id` from the real items, RLS that requires both boards readable, create/delete rules for either end, `folder_timeline` (5,000-item cap) and `board_dependency_context` RPCs.
- Frontend: `GanttCanvas` extracted from `GanttBoard`; a folder **Timeline** tab (lazy, in the project preset, plus an "Add Timeline tab" button); stubs on the board Gantt for links to other boards; a "Waiting on / Blocking" section in the item panel with org-wide search, late markers and plain-language errors.
- Fixed a pre-existing bug: dependency arrows on the board Gantt never drew (an always-true guard).
- Merged as `ad6b0177` (7 tasks subagent-driven, 3 parallel batches, every task reviewed, whole-branch review plus a fix wave, live Chrome run on a throwaway folder that was then deleted; boards are in Trash). Gates: 10,601 tests, build green.
- Announced on `/updates` for 2026-11-14 (see the changelog commit).

## Why

Programmes are split into one board per workstream inside a folder, and work on one board waits on another. Monolith only allowed same-board links and only had per-board Gantts, so a programme could not be seen or scheduled as a whole. The Etisalat import is deliberately deferred until this capability exists.

## How to test (for the user)

1. Pull `develop` and run it locally (or wait for promotion). Use a folder with at least two boards whose items have dates.
2. Open the folder: a **Timeline** tab sits after Stages. On an older folder with a customised layout, use Customize, then **Add Timeline tab**.
3. The Timeline shows each board as a band, then groups, then items. Fold a board with its chevron; switch Week/Month/Quarter. None of this should reload anything.
4. Open an item on board A (click its bar). In the item panel's Fields tab, under **Links / Dependencies**, click **Add dependency**, keep **Waiting on**, type an item name from board B and pick it. It appears at once with its board name and end date.
5. If board B's item ends after board A's item starts, the entry shows **Late**; the folder Timeline shows a red arrow and a "1 late link" badge.
6. Drag the board B bar earlier on the folder Timeline. The arrow turns grey and the badge disappears; the new date is saved on board B.
7. On board A's own Timeline view, the item shows a "↤ <name>" stub; clicking it opens the item on board B, whose panel lists the link under **Blocking**.
8. Remove the link with the ✕ in the panel. It disappears at once.
9. Try **Blocking** search on a board you can only view: those results are greyed out as "View only".

## Open threads

- New links from *other* people still arrive only on reload: `item_dependencies` is not in the `supabase_realtime` publication (owner-approved migration needed; already listed in perf batch 3).
- Board bands show no done/total (the RPC carries no status); a cross-board link cannot be removed from the board Gantt (use the panel or folder Timeline). Both recorded as plan deviations.
- Deferred minors: direct INSERT on `item_dependencies` skips the RPC's cycle check (revoke it in the next migration); folder Timeline cache is not refreshed by edits elsewhere for up to 60 s; no year zoom on the folder Timeline; the first Blocking search makes one extra edit-check call (a batched RPC needs a migration).
- The Etisalat plan import (synthesise start dates; activities mostly have only a target date).

## Next session entry point

Promote `develop` when ready (this feature rides with the items already awaiting promotion), then decide whether to add `item_dependencies` to the realtime publication and revoke direct INSERT in one small migration.
