---
type: session
date: 2026-07-25-1056
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-24-1950-mcp-server-oauth]]"
  - "[[2026-07-25-gotcha-58-playwright-reuses-port-3000-server]]"
---

# Settings redesign + in-app MCP connection guide

## What changed

- **`/settings` is now a left sub-nav over nine nested routes** (Account: Profile/Preferences/Notifications/Security · Organization: General/Workspaces/Members · Integrations: AI/Connect via MCP), replacing a 4-column masonry of 8 unequal cards. `layout.tsx` owns the header, nav, and the three shared reads; `/settings` redirects to `/settings/profile`.
- **New primitives** `SettingsSection` + `SettingRow` carry the alignment contract (label left, control right-aligned in a fixed 280px column, hairline between rows). Cards survive only for repeated objects.
- **Connect via MCP page** — the app previously shipped a hosted MCP server with zero in-app instructions. Now: per-request server URL with copy, per-client setup steps (Claude Desktop / claude.ai / Claude Code / generic, History-API picker), a table of the six tools with Read/Write pills, access-and-safety notes, connected apps, troubleshooting.
- **Revoke errors surfaced** — `ConnectedAppsSection` submitted an inline `form action` and discarded the `ActionResult`, so a failed revoke was indistinguishable from success. Replaced by `ConnectedAppsList` (confirm dialog + toast). Closes a north-star owed item.
- **Added:** org rename (`updateOrgName`), leave organization (`leaveOrg`, refuses the sole owner), appearance (light/dark/system), security (email, change-password link, sign out everywhere). The two adjacent "AI" cards merged into one page.
- **Data:** `/settings/profile` went from ~10 queries to one plus shared layout reads; the members RPC + invites + 50-row audit slice now only run on `/settings/members`. Layout uses `isOrgAdminCached`, not `isOrgAdmin()` (the latter runs `get_org_members`).
- 9 commits merged as `1555dc1`. No migrations — rename and leave both ride existing RLS policies. Spec + plan: `docs/superpowers/specs/2026-07-25-settings-page-redesign-design.md`, `docs/superpowers/plans/2026-07-25-settings-page-redesign.md`.

## Why

The page had no alignment, a box per setting, two cards both about AI, and — the real gap — no way for a user to discover the MCP server URL or learn how to point a client at it. The MCP server shipped 2026-07-24 was effectively undiscoverable to anyone who wasn't its author.

## How to test (for the user)

1. `git pull` on `develop`, then `pnpm dev`.
2. Visit **`/settings`** — it should bounce to `/settings/profile`, nav left, Profile highlighted.
3. Click each nav item: labels left, controls aligned on one right edge; the nav must not blank while a section loads.
4. **Organization → General:** change the name, Save, reload — it persists. As a non-admin the name is plain text with no Save.
5. **Notifications:** flip a switch, reload — state sticks.
6. **Connect via MCP:** URL reads `http://localhost:3000/api/mcp`; Copy shows "Copied"; clicking all four client tabs must **not** reload the page (only `?client=` changes).
7. **Security:** Change password links out; **Leave organization** opens a confirm. As sole owner, confirming shows the error toast and you stay put — correct behavior.
8. As a non-admin, Members is absent from the nav and `/settings/members` 404s.

## Open threads

- **Delete account deliberately deferred to its own spec** — 28 columns reference `auth.users` without `on delete cascade` (~15 `not null`: `boards.created_by`, `item_updates.author_id`, `goals.owner_id`, `attachments.uploaded_by`, …), so deleting the auth user raises an FK violation even after a sole-owner check. Needs a migration converting those to `on delete set null` plus every consumer that assumes non-null authorship.
- **Real end-to-end MCP connection test still not run** (Claude Desktop/claude.ai against a deployed `develop`) — unchanged from the MCP session, and now the guide's per-client steps are unverified against the real clients too.
- `/login` still ignores `?next=`, so the OAuth connect flow can't resume for a signed-out user. Untouched here.
- [[2026-07-25-gotcha-58-playwright-reuses-port-3000-server]] — visual verification from a worktree hit the main checkout's dev server on :3000 and tested the wrong code.

## Next session entry point

`develop` now carries MCP server + E5 + the ACL migration + this redesign, all ahead of prod — **promote `develop → main`** is the standing next move (E5 needs env vars + an embeddings backfill first). Otherwise: delete-account as its own spec, or a fresh roadmap build (Report Builder v2, E6).
