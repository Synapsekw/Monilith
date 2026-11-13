---
type: session
date: 2026-11-13-2120
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[00-north-star]]"
  - "[[2026-11-13-1702-collapsed-rail-cleanup]]"
---

# Edge-nub panel toggles and Leave board

## What changed

- **Edge nubs** (`a634d20e`, merge `ebf6f0de`): the chevrons that fold the sidebar and the agent dock became always-visible pills on the card seam carrying a new `PanelGlyph` (`src/components/shell/panel-glyph.tsx`). `SEAM_CAP` in `card-seam.tsx` owns the pill; hover/focus brighten it via `group-hover/hit:` utilities because `.seam-cap` lives in `@layer base`. Chosen from a six-option prototype artifact (option 05).
- **Leave board** (`ca9d5527`, merge `158939a6`): `leaveBoardCore` + `leaveBoard` action; `SharedBoardMenu` gained a destructive item with an AlertDialog, and redirects to `/boards` when leaving the open board. The owner is refused ("delete it instead").
- **Migration** `20261113150835_board_members_member_leaves.sql`: a DELETE policy letting a member remove only their own `board_members` row. Applied to DEV; ledger relabelled from the MCP's stamp; verified in a rolled-back transaction (other member 0 rows, own 1 row, board intact).
- Corrected an earlier wrong claim in-session: shared members never had Delete in their menu, only Move to folder.
- Owner browser check via the Chrome extension: both nubs fold/unfold, Leave board menu + dialog + Cancel all work. Owner then tested everything themselves.
- Announced both on `/updates` (`de8bf633` + regenerate `b05c31fa`). Folded three empty Stop-hook drafts (`_draft-2026-11-13-1302/1503/1703`).

## Why

The hover-only chevrons were hard to find, and members of a shared board had no way to drop it: only the owner could delete, which removes it for everyone.

## How to test (for the user)

1. Run `pnpm dev` on `develop`. The sidebar and dock edges each show a small pill; hover brightens it, clicking folds/unfolds the panel.
2. As user A share a board with user B. As B, open the board's ⋯ menu under **Shared with me**: Move to folder and Leave board, no Delete.
3. Leave board, then Cancel: nothing changes. Confirm instead: toast "You left …", the board leaves the sidebar, and you land on `/boards` if it was open.
4. As A, the board is intact and B is gone from members; re-sharing brings it back for B.

## Open threads

- Needs the next `develop → main` promotion PR to reach www.monolith.works.
- The "actually leave" path and the owner-side view were checked by the owner, not by the agent.

## Next session entry point

Run `/promote` to ship the edge nubs and Leave board along with whatever else is on `develop`.
