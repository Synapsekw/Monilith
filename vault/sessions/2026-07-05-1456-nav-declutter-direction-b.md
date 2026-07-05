---
type: session
date: 2026-07-05-1456
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Navigation declutter — Direction B (grouped sidebar + workspace switcher + top-right admin)

## What changed

- Restructured the authed sidebar into **Direction B**: workspace switcher (top) → My Work → Planning → Boards → Dashboards → Personal, with collapsible sections. 13 commits (`6c05959..52f2002`) on `develop`.
- New components: `WorkspaceSwitcher` (scopes Boards+Dashboards to an active workspace via a `pulse_active_ws` cookie + `setActiveWorkspace` server action + `router.refresh` — rule #5), `NavSection` (per-section collapse persisted in `useUIStore`), `PlatformAdminMenu` (top-right shield button).
- Scoped `listMyBoardsCached`/`listDashboardsCached` by the indexed `workspace_id`; `getSidebarNavData` reads the active workspace.
- Removed dead "Inbox"; de-duplicated Platform admin (gone from sidebar + user menu → one header button); deleted now-dead `PlatformNav`; moved workspace rename/delete into a **Settings → Workspaces** card.
- Executed via subagent-driven TDD: 13 tasks, per-task spec+quality reviews, an opus whole-branch review (merge-ready, no Critical/Important), full gates green (typecheck/lint/2383 tests/build).

## Why

The sidebar had grown cluttered — two unbounded all-workspace lists stacked full-height, a management list, a dead item, and admin reachable two ways. Direction B (picked from a 3-way interactive mockup) declutters via grouping + a real workspace-scoping switcher.

## How to test (for the user)

1. Pull `develop` (`git pull --rebase origin develop`), `pnpm dev`, sign in.
2. Top-left **workspace switcher** → pick another workspace → Boards + Dashboards lists rescope; a new board/dashboard defaults to the active workspace.
3. Collapse **Planning / Boards / Dashboards / Personal** via the chevrons → state persists across reload.
4. Super-admins: **shield button top-right** (Overview / Orgs / Users / Audit / Feedback); confirm it's gone from the sidebar and the avatar menu.
5. **Settings → Workspaces** card → rename/delete works. "Inbox" is gone.

## Open threads

- finish-task's _local_ merge was blocked by a concurrent session's uncommitted import-wizard work in the shared checkout; recovered by rebasing onto `origin/develop` + FF-pushing `HEAD:develop`, then FF-ing local develop once files proved disjoint (memory: `finish-task-merge-blocked-by-concurrent-uncommitted`).
- Deferred Minors (reviewer-OK-to-defer): trim now-unused `isPlatformAdmin`/`newFeedbackCount` from the sidebar loader (a redundant admin-only `countNewFeedback` query — header computes its own); remove/wire dead `WorkspaceSwitcher.isOrgAdmin`; `NavSection` a11y polish (`aria-controls`/`aria-hidden`); direct test for `listDashboardsCached` workspace filter.
- Spec `docs/superpowers/specs/2026-07-05-nav-declutter-design.md`; plan `docs/superpowers/plans/2026-07-05-nav-declutter.md`.

## Next session entry point

`develop` is at `52f2002` with nav-declutter shipped; **promotion `develop → main` still pending** (also gates the audit-fix sweep + summary-footer work). Otherwise, knock out the four deferred nav Minors above.
