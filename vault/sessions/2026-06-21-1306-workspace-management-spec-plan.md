---
type: session
date: 2026-06-21-1306
branch: develop
trigger: wrapup
status: complete
tags: [session, workspaces, planning]
related: []
---

# Workspace management — spec + plan (6g)

## What changed

- Diagnosed a sidebar mystery ("verify WS"): it's a **workspace name** rendered live from the
  DB (`sidebar.tsx`), not a feature label. Confirmed the app has **no** rename/delete/create
  UI for workspaces, though RLS already permits all three (delete = owner/admin only).
- Brainstormed → wrote spec `docs/superpowers/specs/2026-06-21-workspace-management-design.md`.
- Wrote a 6-task TDD implementation plan with a 4-wave execution DAG:
  `docs/superpowers/plans/2026-06-21-workspace-management.md`.
- Added **6g — Workspace management** to the north-star (§2 Phase 6 block + §3 Next).
- Design decisions: sidebar hover ⋯ menu; type-to-confirm delete; block deleting the last
  workspace; add a "New workspace" button; delete clears attachment Storage objects (cascade
  orphans them, mirroring `deleteBoard`); `isOrgAdmin()` guard threaded layouts→AppShell→Sidebar.
- **No source code written** — planning only.

## Why

A stray test workspace ("verify WS") had no in-product way to be removed. Rather than a one-off
SQL delete, the user chose to build proper workspace management. It's cross-cutting (like board
sharing / org admin / invites), not a ClickUp-depth deliverable, so it's filed as 6g.

## How to test (for the user)

No user-facing behavior to test yet — this session produced a spec + plan only. The feature is
unbuilt. Execution (worktree + subagent-driven build) is deferred to a later session.

## Open threads

- **Shared-checkout collision (action needed).** A concurrent session (Portfolios 7a + /promote)
  ran in this same main checkout and `reset develop` to `origin/develop`, dropping my two doc
  commits out of branch history. They are **not lost**: files are on disk (untracked), and the
  commits are recoverable from reflog — spec `a76dfc8`, plan `2cfcf0b`. Re-commit the two files
  (`docs/superpowers/specs/2026-06-21-workspace-management-design.md`,
  `docs/superpowers/plans/2026-06-21-workspace-management.md`) onto current `develop` when the
  tree is untangled.
- **North-star is shared/contested.** `vault/00-north-star.md` holds my `6g` edit _and_ the
  other session's uncommitted portfolios/promote bumps. This wrapup deliberately did **not**
  commit vault paths to avoid sweeping in another session's work. Commit needs manual de-tangling.
- This collision is exactly what the worktree rule (working agreement #1) exists to prevent —
  two building sessions sharing one checkout.

## Next session entry point

When ready to build: re-commit the spec + plan to `develop` (files already on disk), then
`scripts/start-task.sh workspace-management`, `EnterWorktree`, and execute the 4-wave plan
subagent-driven (Wave A: schemas‖guard · B: actions · C: two components · D: wire-up).
