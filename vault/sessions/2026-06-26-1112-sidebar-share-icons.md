---
type: session
date: 2026-06-26-1112
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Sidebar share icons: right-align + de-clutter "Shared with me"

## What changed

- `src/components/boards/BoardsNav.tsx`: owned shared-out boards now render the `Users2`
  marker outside the name `<Link>` in a right-aligned slot, so the icons form one vertical
  column under the **+** instead of floating after each name.
- Same file: "Shared with me" rows collapsed from two lines to one — dropped the
  `· from {owner}` text line, added a `Users2` icon with a hover `Tooltip` + aria-label
  "Shared by {owner}".
- `src/components/boards/BoardsNav.test.tsx`: added assertions (icon is a sibling of the name
  link, owner exposed via tooltip/label not a text line) + wrapped expanded shared-board
  renders in `TooltipProvider`.
- Spec: `docs/superpowers/specs/2026-06-26-sidebar-share-icons-design.md`.
- Merged `task/sidebar-share-icons` → `develop` (`274cdf2`), pushed. Gates green
  (typecheck/lint/test 1736/build).

## Why

The sidebar share affordances read as cluttered: owned-board icons landed at different
horizontal positions per row, and recipients saw a redundant "from {owner}" subtitle. A
right-aligned icon column + a hover tooltip is denser and quieter (pulse-ui restraint).

## How to test (for the user)

1. Pull `develop` (or restart the dev server to drop a stale build).
2. Open any page with the boards sidebar. Share at least one owned board (board → Share).
3. In **Boards**, confirm the shared people-icon sits flush right, in a vertical column under
   the **+** — same spot on every shared row regardless of name length; non-shared rows leave
   it empty.
4. Hover a shared row: the "⋯" menu appears just outside the icon, no overlap.
5. As an account a board was shared with, check **Shared with me**: one line per board (no
   "from {owner}" subtitle); hover the people-icon → tooltip "Shared by {owner}". View-only
   boards still show the eye icon.

## Open threads

- `/promote` not yet run — `develop` carries this plus the prior unpromoted bundle (item
  creation tracking, 9.5a, spreadsheet import/export, flake fix). Clear to promote.
- Migration ledger drift still owed (see [[2026-06-26-1044-item-creation-metadata]]).
- `.mcp.json` working-tree edit left untouched (unrelated, known env-labels file).

## Next session entry point

Run `/promote` to ship the unpromoted `develop` bundle to production, then continue Phase 9
(9.3b aggregation caching / 9.6 Web-Vitals gate).
