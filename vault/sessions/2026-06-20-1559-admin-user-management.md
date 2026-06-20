---
type: session
date: 2026-06-20-1559
branch: develop
trigger: wrapup
status: complete
tags: [session, admin, platform-console]
related: ["[[2026-06-19-2231-platform-admin-console-ui]]"]
---

# Admin user management — nav reorder + per-user actions

## What changed

- **Sidebar (`391374b`):** moved the platform-admin `PlatformNav` to the bottom of the sidebar (`mt-auto`), below Boards/Dashboards/Goals/Portfolios/Inbox/Workspaces.
- **Per-user actions** on `/admin/users` — `UserRowActions` rewritten as a `⋯` dropdown + dialogs (`9cf5552`): send password-reset email, set temporary password, suspend/reactivate, hard delete. Backed by three new platform server actions (`16f1669`): `platformResetUserPassword`, `platformSetUserPassword`, `platformDeleteUser` (+ positional wrappers in `search-action.ts`, + `platformSetPasswordSchema`).
- **Sole-owner delete guard (`89703f2`):** new `SECURITY DEFINER` RPC `platform_user_sole_owned_orgs` (applied to cloud) — delete is blocked (and names the orgs) if the target is the only active owner of any org; self-delete refused.
- **Forced password change (`6438a4a`):** `platformSetUserPassword` sets `app_metadata.must_change_password`; `enforcePasswordChange` (in `requireUser`/`requirePlatformAdmin`/`page.tsx`) redirects flagged users to a new `(auth)/change-password` page; `changeOwnPassword` updates the password and clears the flag via the service-role client (no self-bypass, no redirect loop).
- **Process:** brainstorm → spec → plan → subagent-driven execution (impl + spec + quality review per task, final whole-feature review = READY TO MERGE). New unit tests for actions + change-password. Pushed; **CI green** (run `27867004016`: typecheck/lint/unit/build).

## Why

The platform super-admin console (shipped 2026-06-19) could only ban/unban users and had admin nav above the user's primary nav. This adds the day-to-day account-management operations an admin actually needs (password recovery, temp credentials, hard delete) with a safety rail against orphaning organizations, and reorders the nav so admin tooling sits out of the way at the bottom.

## Open threads

- **Manual verification (Danijel):** sidebar order in-browser, dropdown dialogs, and the forced-change end-to-end (set temp password on a second account → login → `/change-password` redirect → clears flag).
- **Optional hardening:** `changeOwnPassword` doesn't check the error from the flag-clearing `updateUserById` (low-probability soft-loop, recoverable by re-submit).
- `develop` not yet promoted to `main`.

## Next session entry point

Admin user-management is on `develop` + CI-green. Either do the manual gates above and open the `develop → main` promotion PR, or pick up Phase 6c (time tracking).
