---
type: session
date: 2026-09-15-1915
branch: develop
trigger: wrapup
status: complete
tags: [session, dashboards, folders, command-center]
related:
  - "[[2026-09-15-1309-intelligence-act-ask]]"
---

# Folder command center shipped: dashboards rethought as per-project control towers

## What changed

- **Spec + plan** (`docs/superpowers/specs/2026-09-15-folder-command-center-design.md`, `docs/superpowers/plans/2026-09-15-folder-command-center.md`): brainstormed from three rejected single-page mockups to a "Control Tower" shape — sectioned tabs under the folder header, a stage filter, dense KPIs, burn chart. Live prototype: https://claude.ai/code/artifact/186ce58b-5510-473c-9506-eed73ee1a576.
- **Merged to `develop` as `d0aa29ae`** (34 commits, 139 files, +11752/−1427): shared workspace `folders` + `folder_boards` (replacing private per-user sidebar folders; read gate on `can_read_board`, composite `(folder_id, org_id)` FKs, tenant-move trigger), five SECURITY DEFINER read RPCs (`folder_rollup`, `folder_attention`, `folder_burn`, `folder_workload`, `folder_gallery`, all behind one `_folder_readable_boards` helper), the `/folders/[folderId]` command center (Overview · Stages · Boards · People; stage = same-named groups across boards; filter/tab/sort = `history.replaceState`, zero refetch), the `/dashboards` folder gallery + Unfiled section, the legacy dashboard redirect, ⌘K folder entries, the "Your widgets" strip, Share / Export PDF / Ask-about-this-folder, and the Ask folder scope.
- **Data migration ran on live DEV**: 5 private folders → 5 shared folders, 18 boards placed, 0 of 2 dashboards backfilled. The private tables were deliberately **not** dropped (ruling) — a follow-up drop migration is owed after the owner verifies the sidebar. Seven migrations total (`20260915074830` … `20260915145912`), ledger 174/174.
- **Process**: 15 tasks in 7 waves, one worktree per task, 13 task reviews + 1 whole-branch review (1 Critical, 13 Important cross-task findings — none caught per task), one fix wave, one repair (the fix wave's print scoping had inverted the CSS cascade; caught only by a Chromium print-media check, now `e2e/print-styles.spec.ts`).
- **Announced** on `/updates` (backdated empty commit for 2026-09-15): folders as project command centers, folder gallery, shared folders.

## Why

Dashboards were a flat workspace-wide widget canvas with no notion of a project; the owner wanted every folder to be a command center that shows all stages at a glance. Promoting folders to shared workspace objects is what makes a folder a project the whole team sees.

## How to test (for the user)

Setup: pull `develop`, `pnpm install`, `pnpm dev` (DEV database — your live data), sign in to a workspace with at least two boards that have a Status column, a Date column, a People column, and groups named alike across boards (e.g. "Wave 1" / "Wave 2").

1. Sidebar → Boards → your old private folders now appear as shared folders (same names) and each folder name is a link. Click "+ folder", name it, then on a board row "⋯ → Move to folder". Expected: the board nests under the folder; a teammate sees the same folder.
2. Click the folder name → `/folders/<id>`: header with the folder name and a `Snapshot · <time> · live` chip; tabs Overview · Stages · Boards · People; a filter bar with one chip per stage and a board dropdown.
3. Overview: six KPI cards, Planned vs completed (dashed plan, accent completed, red Today line), Status by board bars, Needs attention (captioned "Top 20 across the folder"), Intelligence (latest per-board briefs, if any), Next milestones.
4. Click a stage chip → every number recalculates instantly and the URL gains `?stage=…`; the Network tab shows no new request. Reload: the same stage is selected. Pick one board in the dropdown: the burn chart shows a "Scope: All boards" note (it cannot be board-filtered yet).
5. Stages tab: one card per stage marked COMPLETE / IN FLIGHT / UPCOMING; clicking a card selects it; the Stage × board matrix shows % badges; "Stages on only one board" lists unmatched group names with "merge into stage".
6. Boards tab: health pill per board, Sort by Health / Size / A–Z re-orders without a reload; row name opens the board.
7. People tab: first open shows a skeleton then Workload bars (red above 15 open), Who owns what (names visible), Unassigned; switching stage chips refilters without a request.
8. Share → toast "Link copied". Export PDF (Overview only) → the print preview shows the folder title plus the Overview panels on a white page, in both dark and light theme; other pages (a board, Ctrl+P) still print normally.
9. Ask about this folder → `/ask?folder=<id>` opens a thread whose first answer knows the folder's boards.
10. Sidebar → Folders (`/dashboards`): one card per folder with done % / overdue / attention counts and an "Unfiled dashboards" section listing your old dashboards with an "Attach to folder" picker. ⌘K "New dashboard" opens the create dialog here; `/dashboards?ai=1` opens the AI wizard.
11. Attach an old dashboard to a folder → open `/dashboards/<that id>` → you are redirected to `/folders/<id>?tab=overview#widgets` and land on the "Your widgets" strip; edit mode, Add widget and Generate with AI work there and land in this folder. Generate one: the review banner (Keep / Regenerate / Discard) still appears on the legacy page and returns you to the folder.
12. On an iPad: stage chips, tabs and the folder chevron are 44px targets and tapping the chevron never opens the neighbouring row.

## Open threads

- **Owed migration:** drop `board_folders` / `board_folder_boards` (and the two orphaned tests that say so) after the owner confirms the sidebar on DEV.
- **Parked from the final review (perf pass):** `folder_gallery` is O(folders × boards × items) per gallery load (5 folders on DEV today); `folder_rollup` evaluates the readable-board set twice; the Needs-attention panel ignores the board filter (caption says "across the folder"); `burn` rows are unbounded on the stage axis.
- Empty private folders were not copied forward (no derivable workspace; 0 on DEV). `folder_burn` has no `board_id`, so the board filter cannot narrow the chart (noted in-UI).
- Intelligence panel is per-viewer (briefs are per user); Unassigned rows link to the board, not the item (`folder_workload` carries no item ids).
- Manual print preview and the iPad geometry pass are owed to the walkthrough above; the print CSS is verified by `e2e/print-styles.spec.ts` in Chromium only.
- Not promoted: `develop` is ahead of `main` by this feature; run `/promote` after the walkthrough.

## Next session entry point

Do the walkthrough above against DEV, then `/promote`; if the sidebar checks out, mint the drop migration for the private folder tables and schedule the parked perf pass.
