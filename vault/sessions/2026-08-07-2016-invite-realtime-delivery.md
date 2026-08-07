---
type: session
date: 2026-08-07-2016
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  ["[[2026-08-07-gotcha-80-realtime-delivery-needs-a-recipient-select-policy]]"]
---

# Org invitations now arrive in real time

## What changed

- Diagnosed "invites take 5+ minutes" as **no push at all** — the invite surfaced only on the
  recipient's next full page load, so the delay was unbounded and never arrived for an open tab.
- Migration `20260807160159_invitee_reads_own_invitations` — recipient-scoped SELECT policy on
  `org_invitations` (`lower(email)` both sides) + added the table to `supabase_realtime`.
- `use-invitations.ts` subscribes to INSERT/UPDATE and invalidates the query, mirroring
  `use-notifications.ts`. No component changed — the bell's badge is already `unread + inviteCount`.
- Spec + plan committed; 5 new hook tests, 2 new RLS integration tests (skip without `.env.test`).
- Merged to `develop` via `finish-task.sh` (`f8b3f590`); worktree + branch cleaned up.
- **`apply_migration` mis-stamped the version again** (7th consecutive) — repaired with
  `reconcile-migration-version.sh`; ledger 134/134.

## Why

An org owner reported invitees not being notified. The root cause was structural, not a tuning
problem: `org_invitations` was absent from the realtime publication AND had no invitee SELECT
policy, so Realtime had nothing to deliver and no one to deliver it to — while `staleTime: Infinity`
with `refetchOnWindowFocus: false` meant the client never asked again either. Invitations were the
one collaboration surface in the app that was pull-only.

## How to test (for the user)

1. `git pull` on `develop`, then `pnpm dev` (migration already applied to DEV — no DB step).
2. Two browsers: normal window as an **org owner/admin**, incognito as a **second account that
   already has a Monolith login** (the case that previously got nothing at all).
3. In incognito, leave a page open and **watch the header bell** — do not reload.
4. As admin: **Settings → Members**, invite the second account's email, pick a role, send.
5. Expected: within ~1s the incognito badge increments and the popover shows "You've been invited
   to _\<org\>_ as \<role\>" with Accept / Decline — no reload.
6. As admin, **revoke** the invite. Expected: the incognito bell clears within ~1s.
7. Re-invite, click **Accept** in incognito — enrolls and lands on `/`.

## Open threads

- **Existing users still get no invite email.** `inviteUserByEmail` returns "User already
  registered" and `admin-actions.ts:144` swallows it by design. In-app is now instant; away-from-app
  is not covered. Would be a Resend send (key + batch client already exist for the digest).
- **Brand-new invitees** may still be on Supabase's built-in email service (best-effort, ~2/hour
  cap) — a dashboard setting, not readable from the repo. Unverified.
- Browser-level end-to-end was **not** run by me: it needs two signed-in accounts, and provisioning
  throwaway users on DEV is exactly what the integration guard forbids. Policy verified live in a
  rolled-back transaction instead (recipient 1 row, stranger 0, mixed-case row vs lowercase JWT).
- `develop` is further ahead of `main`; promotion still pending.

## Next session entry point

Promote `develop` → `main` (now carries MCP full-surface reads, offline read-only, long-text editor
and this fix), or pick up the invite-email gap above. The macOS desktop shell plan remains the
owner's chosen track.
