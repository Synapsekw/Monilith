---
type: session
date: 2026-06-22-1629
branch: develop
trigger: wrapup
status: complete
tags: [session, sidebar, boards, dashboards]
related:
  - "[[2026-06-22-1617-phase-9-design-and-91-auth-getclaims]]"
---

# Sidebar per-item actions menu + typography cleanup

## What changed

- **Sidebar 3-dots menu** on every owned board and every dashboard (expanded mode): Rename (dialog), Duplicate, Delete (AlertDialog confirm). Hover/focus-revealed; not shown on "Shared with me" boards or collapsed sidebar. New `BoardItemMenu`/`DashboardItemMenu` composing existing dropdown/dialog/alert-dialog primitives, wired via `useTransition` + `router.refresh()`.
- **Backend**: migration `20260622140000_duplicate_board_and_dashboard.sql` — `duplicate_board_structure` (copies groups+columns+views, NOT items/cell_values) and `duplicate_dashboard` (copies widgets); `duplicateBoard`/`duplicateDashboard`/`deleteDashboard` server actions + Zod schemas; types regenerated. Board-duplicate guard hardened to `can_read_board` (not just `is_org_member`) after review found an intra-tenant gap; regression test added.
- **Typography + separators**: section labels unified to `text-xs font-medium`; `Separator`s between Boards / Dashboards / nav / Workspaces / Platform (expanded only).
- **a11y polish**: `DialogDescription` added to both rename dialogs.
- Merged to `develop` via `finish-task.sh` (commit `3062ed5`; sub-commits `2de9fe9` RPC fix, `a9219f2`/`1d86ae1` menus, `cc1d4e9` a11y). Spec/plan: `docs/superpowers/{specs,plans}/2026-06-22-sidebar-board-menu-and-typography*`.
- Subagent-driven (6-task DAG); two code-quality reviewer agents died mid-run — findings recovered via the spec reviewers' consolidated reports, nothing lost.

## Why

You couldn't delete boards at all (delete existed as a server action but was exposed nowhere), and the sidebar fonts were inconsistent with no visual grouping. This adds the standard per-item management affordance and tidies the sidebar's hierarchy.

## How to test (for the user)

In the main checkout on `develop` (pull `develop`, then `pnpm install` — `react-day-picker` was added by a sibling feature — and restart `pnpm dev`):

1. Open the app, sidebar expanded — section headers read as smaller muted labels with separators between groups.
2. Hover a board under **My boards** → a `⋯` button appears at the right (also reachable via Tab).
3. `⋯` → **Rename** → change name, Save → row updates.
4. `⋯` → **Duplicate** → a "… (copy)" appears with the same columns/groups/views but **no items**.
5. `⋯` → **Delete** → confirm → removed; if you were viewing it you land on `/boards`.
6. A board under **Shared with me** has **no** menu.
7. Repeat 2–5 on a **dashboard** (Duplicate copies widgets; deleting the active one routes to `/dashboards`).
8. Collapse the sidebar (⌘\) → initials only, no menus.

## Open threads

- **Not yet promoted to `main`** — ships to production only on the next `/promote`.
- Minor (left as-is): a failed Duplicate surfaces no inline error (Rename does); `BoardItemMenu`/`DashboardItemMenu` are ~98% identical — a future shared `<ItemMenu>` is a reasonable backlog item.
- Two dev-environment traps hit while testing, both from `develop` gaining `react-day-picker` mid-session (a stale-worktree-deps instance of [[2026-06-22-gotcha-39-stale-worktree-deps-after-sibling-dependency-add]]): `Module not found: react-day-picker` → `pnpm install`; `ChunkLoadError` → kill the stale dev server + `rm -rf .next` + restart + hard-refresh.

## Next session entry point

Either `/promote` to ship this + the rest of the `develop` bundle, or continue Phase 9.2 (streaming shell / PPR).
