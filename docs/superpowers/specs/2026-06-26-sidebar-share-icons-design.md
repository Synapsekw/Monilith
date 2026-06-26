# Sidebar share icons: right-align + de-clutter "Shared with me"

**Date:** 2026-06-26
**Scope:** Single-file presentational change to `src/components/boards/BoardsNav.tsx`. No data,
query, or server-action changes. Zero new server round-trips.

## Problem

In the boards side-nav, two share affordances read as cluttered:

1. **Owned boards I've shared out** render a `Users2` icon _inside the name `<Link>`_, so it floats
   immediately after each (variable-length) board name. Across rows the icons land at different
   horizontal positions — there is no clean vertical line.
2. **"Shared with me" boards** render two lines: the board name on top and `· from {owner_name}`
   underneath. The second line is redundant noise in a dense list.

## Goals

- Owned shared-out icons form a single **right-aligned vertical column**, lining up under the **+**
  ("New board") button in the section header.
- "Shared with me" rows collapse to **one line**; "who shared it" moves to a **hover tooltip** on an
  icon instead of a second text line.
- Reuse existing iconography (`Users2`) and the `Tooltip` primitive already imported in this file.

## Design

### 1. Owned boards — `SortableBoardRow` (`BoardsNav.tsx` ~55–94)

Move the `Users2` icon out of the name `<Link>` into its own sibling slot:

- `<Link>` keeps `flex min-w-0 flex-1 items-center` but now holds **only** the truncated name span.
- After the `<Link>`, before `<BoardItemMenu>`, render the `Users2` icon as a `shrink-0` sibling,
  gated on `board.shared_out`. Keep `aria-label="Shared with others"`, `size-3.5`,
  `text-muted-foreground`.
- Because the `⋯` menu button is a fixed-width slot at the row's right edge, the share icon sits
  **just inside it** and aligns vertically across rows. Non-shared rows leave the column empty;
  alignment holds because the menu slot is always present.

### 2. "Shared with me" rows (`BoardsNav.tsx` ~257–284)

Collapse the two-line layout into a single right-aligned row matching the owned-row shape:

- Row container: `flex flex-col` → `flex items-center` (single line), keep existing padding/colors.
- Name in a `min-w-0 flex-1 truncate` span.
- Right-aligned icon group (`shrink-0`, small gap):
  - existing `Eye` icon, only when `b.access_level === "viewer"` (unchanged behavior);
  - new `Users2` icon, only when `b.owner_name` is present, wrapped in
    `Tooltip` / `TooltipTrigger asChild` / `TooltipContent side="right"` with text
    **`Shared by {b.owner_name}`**. The `Users2` carries `aria-label="Shared by {b.owner_name}"`
    so the relationship is available without hover (a11y + testability).
- **Delete** the `· from {owner_name}` second-line span entirely.

The `TooltipTrigger asChild` must wrap a single focusable/hoverable element; wrap the `Users2` in a
`span` trigger so Radix can attach a ref.

## Non-goals

- No change to the **collapsed** sidebar rendering (icon-only rail) — both shared sections already
  render single-letter tiles with tooltips there.
- No change to `BoardItemMenu`, the grip handle, drag/reorder, or any query/type.

## Testing

`BoardsNav` is a client component; add/extend a Vitest + Testing Library test:

1. An owned board with `shared_out: true` renders the "Shared with others" icon as a **sibling of**
   the actions menu (not nested in the name link), and a non-shared board renders no such icon.
2. A "shared with me" row renders on a **single line** with **no `from` text**, and exposes a
   "Shared by {owner}" tooltip trigger / accessible label; the `Eye` icon still appears only for
   `viewer` access.

Then the full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Workflow

Built in worktree `task/sidebar-share-icons`; closed via `scripts/finish-task.sh` (merge to
`develop` + cleanup). `pulse-ui` design skill applied during the build.
