---
type: session
date: 2026-09-11-1945
branch: develop
trigger: wrapup
status: complete
tags: [session, ui, sidebar, keystone]
related:
  - "[[2026-09-11-1757-board-intelligence-phase1-orient]]"
  - "[[2026-09-09-1002-ui-polish-and-theme-presets]]"
---

# Sidebar Keystone polish

## What changed

- Audit of the whole sidebar package (code-only — Chrome extension down) found two defects and
  eight grammar inconsistencies; four visual options were rendered from the real tokens as a live
  gallery and the owner chose "Keystone". Spec + prototype committed under
  `docs/superpowers/specs/2026-09-11-sidebar-keystone-polish-design.md` (+ `.prototype.html`),
  plan under `docs/superpowers/plans/2026-09-11-sidebar-keystone-polish.md`.
- **Merged to `develop` at `75611f29`** (8 commits, +1471/−738): one row primitive
  `src/components/shell/sidebar-row.tsx` (24px lead slot, `text-sm`/`text-xs` tiers, active =
  `bg-state-selected` + 3px `bg-primary` edge bar via `before:`), `NavSection` as a ledger header
  (kicker + hairline rule + hover-only chevron, one toggle button), `ContextSwitcher` replacing the
  twin org/workspace chips, a scrolling nav body with a `.nav-scroll` fade mask + pinned footer
  (My Time, Trash) and rail group dividers, every board/folder/dashboard row and rail tile on the
  primitive.
- **Two defects retired:** active board/dashboard rows were `bg-primary/80 text-foreground` (white
  on periwinkle, ~2:1 in dark) — now guarded by `sidebar-active-guard.test.ts`; the desktop
  sidebar had no `overflow-y` at all, so a long board list pushed Trash off screen.
- Removed: `org-switcher.tsx`, `workspace-switcher.tsx`, the one-item "Personal" section, all
  sidebar `<Separator>`s, `card-lift` inside the nav. `leading` → `lead` on the board rows.
- Announced on `/updates` (one dated commit, three entries: sidebar redesign, active-row contrast
  fix, sidebar scrolling fix).

## Why

The owner liked the sidebar's direction but the package had drifted: two active-state languages, two
hover languages, three text left-edges, twin switcher chips, a third label style. A single row
primitive plus the Keystone signatures (edge bar, ledger rules) makes the grammar structurally
uniform instead of maintained by vigilance, and the AA and scroll defects were real user-facing bugs.

## How to test (for the user)

Pull `develop`, `pnpm dev`, sign in, open any board (dark and light both).

1. **Active bar:** the open board's row shows a 3px periwinkle bar flush on the sidebar's left edge
   plus a faint tint; the label is full-contrast in both themes. Top-level links (My Work, Goals…)
   and boards inside a folder get the same bar on the same edge.
2. **Ledger headers:** hover "PLANNING" — the hairline to its right brightens and a chevron
   appears; click anywhere on the header to fold it; the chevron stays visible while folded and
   the fold survives a reload. Same for BOARDS and DASHBOARDS (DASHBOARDS' label is still a link).
3. **Context chip:** one chip at the top shows the workspace name (with the org name as a small
   mono label above it if you belong to more than one org). Click it — organizations (if > 1) and
   workspaces share one menu, plus "New workspace" / "Manage workspaces". Hovering brightens the
   border; nothing lifts.
4. **Footer + scroll:** "My Time" and "Trash" sit at the bottom above an inset hairline. Shrink the
   window until the board list overflows: the middle scrolls with a soft fade at both ends while
   the brand row and footer stay put.
5. **Shared with me:** the label is a small mono kicker with a rule, aligned with the board names.
6. **Collapsed rail (⌘\\):** short hairlines separate the groups; the active board tile carries the
   same edge bar and all tiles are the same width; hovering the Boards head tile still shows its
   tooltip; My Time / Trash are pinned at the bottom.
7. **Touch (iPad):** section chevrons are always visible; captions show under rail tiles.

## Open threads

- **No authenticated browser this session** — the Chrome extension was down and no test
  credentials exist against the live DEV data, so the visual claims rest on the prototype, the
  class contracts and one headless-Chromium box-model measurement the final reviewer made (which
  is what caught the rail gutter squeeze). Step 6 above is the one to check first.
- Parked, carried-over: the collapsed context chip (36px) and the ledger header row (26px) carry no
  `pointer-coarse:` sizing; `activeOrg` falls back to `orgs[0]` on a stale id; the guard test greps
  raw text (a comment naming the class trips it) and scans `.tsx` only.
- Process: two subagents ran a bare `git stash` in the shared-stash worktree to bisect — nothing was
  lost, but the dispatch prompt now needs the "never stash" line up front.
- Unpromoted delta on `develop`: Board Intelligence Phase 1 + this — promote together.

## Next session entry point

Promote `develop → main` (Board Intelligence Phase 1 + sidebar Keystone polish), run this note's
walkthrough and the Board Intelligence one against production, then `writing-plans` for Board
Intelligence Phase 2 (Advise).
