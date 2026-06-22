# Sidebar per-item actions menu + typography cleanup — Design

**Date:** 2026-06-22
**Status:** Approved (brainstorming) — ready for plan

## Problem

The left sidebar lists boards and dashboards as plain navigation links. There is
**no way to rename, delete, or duplicate a board from the sidebar** — delete isn't
exposed in the UI at all, and rename lives only inside the board header. Users
need a per-item actions menu (a 3-dots / overflow menu) on each sidebar entry.

Separately, the sidebar's typography is **not uniform**: top-level section headers
("Boards", "Dashboards") render at `text-sm` with an icon — the same size as the
clickable rows beneath them, so they don't read as headers — while other section
labels ("My boards", "Shared with me", "Workspaces") render at `text-xs font-medium`.
There are also no separators between the major blocks, so the sidebar reads as one
undifferentiated column.

## Goals

1. A per-item overflow ("3-dots") menu on each **owned board** and each **dashboard**
   in the expanded sidebar, with **Rename**, **Duplicate**, and **Delete** actions.
2. A consistent sidebar typographic hierarchy and `Separator`s between major blocks.

## Non-goals

- No menu on **"Shared with me"** boards (the user doesn't own them).
- No menu in the **collapsed** sidebar (it shows single-letter initials only).
- Duplicate is **structure-only** — it does NOT copy items or cell values (boards)
  beyond the layout. (Decision below.)
- No reordering / drag-and-drop changes. No changes to the board-page header.

## Decisions (from brainstorming)

| Question                 | Decision                                                        |
| ------------------------ | --------------------------------------------------------------- |
| Menu actions             | Rename, Duplicate, Delete                                       |
| Duplicate scope          | **Structure only** — no items / cell data                       |
| Apply to dashboards too? | **Yes** — boards _and_ dashboards                               |
| Rename UX                | Small **dialog** (not inline edit) — robust in a narrow sidebar |
| Delete confirmation      | `AlertDialog` confirm (destructive)                             |

## Architecture

### A. Backend — new RPCs, server actions, types

A board's "structure" = its **groups, columns, and views** (not items/cells).
A dashboard's "structure" = its **widgets** (config + layout).

**Migrations** (`supabase/migrations/`, one new file):

- `duplicate_board_structure(p_board_id uuid) returns boards`
  - Copies the source board row into the **same org + workspace**, name set to
    `"<name> (copy)"`.
  - Copies all **groups** (preserving `position`, `color`, names), all **columns**
    (preserving `kind`, `name`, `settings`, `width`, `position`), and all **views**.
  - Does **NOT** copy `items` or `cell_values`.
  - Security: default-deny, org-scoped. The caller must have access to the source
    board (same ownership/membership check pattern as existing board RPCs). Match
    the `SECURITY`/search_path conventions of the existing `create_board` /
    `create_board_from_template` RPCs.
- `duplicate_dashboard(p_dashboard_id uuid) returns dashboards`
  - Copies the dashboard row (name → `"<name> (copy)"`) into the same org/workspace.
  - Copies all `dashboard_widgets` rows (`kind`, `config`, layout fields).

**Server actions:**

- `src/lib/boards/actions.ts`
  - `duplicateBoard({ boardId }): ActionResult<{ boardId }>` → calls
    `duplicate_board_structure`, `revalidatePath("/", "layout")`.
  - Reuse existing `renameBoard`, `deleteBoard`.
- `src/lib/dashboards/actions.ts`
  - `deleteDashboard({ dashboardId }): ActionResult` — **new**; deletes the
    dashboard row (widgets cascade), `revalidatePath("/", "layout")`.
  - `duplicateDashboard({ dashboardId }): ActionResult<{ dashboardId }>` → calls
    `duplicate_dashboard`, `revalidatePath("/", "layout")`.
  - Reuse existing `renameDashboard`.

**Validation:** add Zod schemas (`duplicateBoardSchema`, `deleteDashboardSchema`,
`duplicateDashboardSchema`) in the existing validations modules, mirroring
`deleteBoardSchema` / `renameBoardSchema` (uuid fields).

**Types:** regenerate `src/types/database.types.ts` via `pnpm db:types` and commit
in the same change (new RPCs appear in the generated `Functions` map).

### B. UI — overflow menu components

Two new client components, composed from existing primitives
(`ui/dropdown-menu`, `ui/dialog`, `ui/alert-dialog`, `ui/input`, `ui/button`):

- `src/components/boards/BoardItemMenu.tsx`
  - Props: `board: { id: string; name: string }`, `isActive: boolean`.
  - Trigger: a `MoreHorizontal` ghost icon button, `opacity-0
group-hover:opacity-100 focus-visible:opacity-100` (revealed on hover, and on
    keyboard focus for a11y), `aria-label="Board actions"`.
  - `DropdownMenuContent`: **Rename**, **Duplicate**, `DropdownMenuSeparator`,
    **Delete** (`variant="destructive"`).
  - **Rename** opens a controlled `Dialog` with an `Input` seeded from `board.name`;
    submit → `renameBoard({ boardId, name })`.
  - **Delete** opens an `AlertDialog`; confirm → `deleteBoard({ boardId })`. If
    `isActive`, `router.push("/boards")` (or the boards index) after success.
  - **Duplicate** → `duplicateBoard({ boardId })`; on success **stay on the
    current route** and `router.refresh()` so the new "… (copy)" row appears in the
    sidebar (no auto-navigation to the copy).
  - All mutations use `useTransition`; surface `res.error` inline. Follows the
    existing `DashboardsNav` direct-action pattern (NOT the heavy
    `useBoardMutations` React-Query hook — the sidebar isn't the board cache).
- `src/components/dashboards/DashboardItemMenu.tsx`
  - Same shape: Rename (`renameDashboard`), Duplicate (`duplicateDashboard`),
    Delete (`deleteDashboard`). On delete of the active dashboard,
    `router.push("/dashboards")`.

**Integration:**

- `BoardsNav.tsx` — wrap each **owned** board row (`boards.map`, expanded branch
  only) in a `group relative flex items-center` container: the existing `<Link>`
  takes the remaining width (`flex-1 min-w-0`, keep `truncate`), the
  `BoardItemMenu` sits at the right. The active-row background must span the full
  row. The "Shared with me" rows and the collapsed branch are **unchanged**.
- `DashboardsNav.tsx` — same treatment for each dashboard row (expanded branch).

### C. Typography + separators

Establish a **two-level hierarchy** and apply it across `sidebar.tsx`,
`BoardsNav.tsx`, `DashboardsNav.tsx`:

- **Section headers** (Boards, Dashboards, Workspaces) and **sub-labels**
  (My boards, Shared with me): unify on a single muted label token —
  `text-xs font-medium text-muted-foreground` — with normalized icon size
  (`size-4`). Remove the `text-sm` from the Boards/Dashboards headers so they no
  longer match row size.
- **Item rows** (boards, dashboards, Goals/Portfolios/Inbox nav, workspace items):
  consistent `text-sm`.
- Insert `ui/separator` `<Separator />` between the major blocks: Boards ·
  Dashboards · primary nav · Workspaces · Platform (bottom). Subtle vertical
  spacing; in collapsed mode use a short centered divider (or omit if it looks
  cramped — validate visually).
- Exact tokens (tracking, uppercase, opacity) are validated against the
  **`pulse-ui`** skill + `frontend-design` skill at build time — this section is
  intentionally specified at the hierarchy level, not pixel-locked.

## Data-fetching & performance budget (working agreement #5)

- Sidebar board/dashboard lists are already **server-fetched once** in
  `src/app/boards/layout.tsx` and passed as props. This change adds **no new
  reads**.
- Opening the overflow menu, the rename dialog, or the delete confirm is **pure
  client state → 0 server round-trips**.
- Rename/Duplicate/Delete change **server data** → handled by **Server Actions +
  `revalidatePath("/", "layout")`** (targeted layout revalidation), per the RSC
  rules. No client-side refetch loop.

## Security (working agreement / RLS)

- New RPCs are **default-deny, org-scoped**; the caller must have access to the
  source board/dashboard. No cross-tenant copy. Service-role key never reaches the
  client. Covered by RLS integration tests.

## Testing

- **Server actions / RPCs:** integration + RLS tests following existing
  `*.integration.test.ts` / `*.rls.integration.test.ts` patterns —
  `duplicateBoard` copies groups/columns/views and **no** items/cells; cross-tenant
  duplicate is denied; `deleteDashboard` removes the dashboard + cascades widgets;
  `duplicateDashboard` copies widgets.
- **Components:** Vitest + testing-library — menu renders the three actions; rename
  dialog submits and calls `renameBoard`/`renameDashboard`; delete confirm calls
  the delete action; duplicate calls the duplicate action; menu is hidden on
  "Shared with me" rows.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.

## Execution DAG (working agreement #6)

- **Batch 1 (parallel):**
  - T1 — Migration (`duplicate_board_structure`, `duplicate_dashboard`) +
    server actions (`duplicateBoard`, `deleteDashboard`, `duplicateDashboard`) +
    Zod schemas + `pnpm db:types`. _Produces:_ action signatures.
  - T2 — Typography + separators refactor (section headers/labels/separators in
    `sidebar.tsx`, `BoardsNav.tsx`, `DashboardsNav.tsx`). _Pure presentational,
    independent of T1._
- **Batch 2 (after T1 + T2):**
  - T3 — `BoardItemMenu` + `DashboardItemMenu` components and their row
    integration in `BoardsNav.tsx` / `DashboardsNav.tsx`. _Consumes:_ T1 actions,
    T2 row layout. (T2 and T3 both edit the two Nav files → T3 runs **after** T2,
    not concurrently, to avoid conflicts.)
- **Batch 3:** tests + `verification-before-completion` + the four gates.
- **Critical path:** T1 → T3 → tests.

## How to test (to be filled at closure)

A numbered manual walkthrough (open sidebar → hover a board → 3-dots → Rename /
Duplicate / Delete; repeat for a dashboard; confirm shared boards have no menu;
confirm typography + separators) goes in the closing message and the `/wrapup`
note once merged.
