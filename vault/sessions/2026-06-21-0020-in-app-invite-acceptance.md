---
type: session
date: 2026-06-21-0020
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-20-in-app-invite-accept-design]]"
  - "[[2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir]]"
---

# In-app organization invite acceptance

## What changed

- **Bug fix → feature:** invited members now see pending org invites **in the notification bell**
  and can **Accept / Decline** in-app — no email required. 6 commits `67515a8..7b83fc3`, pushed to
  `origin/develop`.
- **DB:** migration `20260620110000_invite_acceptance.sql` — `status='declined'` + three
  `SECURITY DEFINER` RPCs (`my_pending_invitations`, `accept_invitation`, `decline_invitation`),
  each email-scoped to the caller (can't accept someone else's invite). Types regenerated.
- **Client:** `invitations-data.ts` + `use-invitations` / `use-invitation-mutations` hooks;
  `InvitationsSection` in the bell (badge = unread + invites; Accept reloads `/`); admin Settings
  shows declined invites with **Re-invite**.
- **Also (earlier in session, landed in `f8e693f` via a concurrent session):** branded the empty
  workspace shell — Monolith logo mark (theme-aware) + reworded welcome copy ("The only workspace
  you need").
- Verified: typecheck · lint · build green; 20/20 feature tests incl. live RPC integration 5/5.
  Two-stage subagent review (spec + quality) — approved, only a stale-comment nit (fixed).

## Why

Root cause: the entire "accept" path was wired **only** to the Supabase magic-link email →
`/auth/callback` → silent auto-redeem, which never fires for an already-registered user signing in
normally (password login doesn't call `redeem_invitations`). So an invited existing user got
nothing — no email (swallowed "already registered"), no in-app notice, no membership. This adds the
missing in-app surface and acceptance path.

## Open threads

- Full `pnpm test` shows **one pre-existing flaky failure** in `admin.rls.integration.test.ts`
  (board-insert RLS under GoTrue auth rate limits — unrelated; my migration never touches `boards`).
  Adding a second live integration suite worsens the 40-user-per-run rate-limit pressure; test-infra
  follow-up, not a regression.
- Brand-new (no-account) invitees still rely on the existing Supabase invite email to set a password
  first; the in-app flow only covers logged-in users (by design — non-goal in spec).
- Optional: two-account manual smoke (invite → bell → accept/decline) not yet run.
- Not promoted to `main` (stays on `develop` per branch model).

## Next session entry point

Phase 6d — relations + mirror columns (the next open Phase 6 slice). Invite acceptance is shipped
and pushed; nothing outstanding on it beyond the optional manual smoke.
