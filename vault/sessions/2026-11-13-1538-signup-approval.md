---
type: session
date: 2026-11-13-1538
branch: develop
trigger: wrapup
status: complete
tags: [session, auth, admin, security]
related:
  - "[[2026-11-13-1254-unified-assistant-runtime-plan-a]]"
  - "[[2026-09-15-gotcha-107-partition-after-paginate-hides-the-people-it-protects]]"
---

# Signup approval

## What changed

- Every new account now waits for a platform admin. Merged to `develop` as `d5bd9718` (163 files, most of them a mechanical test change). Spec and plan: `docs/superpowers/specs/2026-11-13-signup-approval-design.md`, `docs/superpowers/plans/2026-11-13-signup-approval.md`.
- Migration `20261113091436_signup_approval`, applied to DEV after a rolled-back dry run: table `account_approvals` (service role only), all 22 existing accounts backfilled as approved, `handle_new_user` creates a pending row for each new account, and a `before insert` trigger on `org_members` refuses a membership for an account that is not approved. `platform_search_users` gained `approval_status` and a status filter. Ledger 178/178.
- App: `requireUser()` and `/home` send an unapproved account to `/pending-approval`; sign-in and the auth callback do the same without redeeming invitations or provisioning; only a cached "approved" is trusted, anything else is re-read live. `/pending-approval` has "Check again", which finishes account setup once approved.
- Admin: "Waiting for approval" section on `/admin/users` with Approve and Reject (audit-logged), a waiting count on the admin overview. Reject is refused for an account that is already approved; Deactivate is the tool for that.
- 144 test `createUser` calls now pass `app_metadata: { pre_approved: true }`; `CONTRIBUTING.md` explains it.
- Also this session: the three local commits from the assistant work were pushed, and the "Assistant test" board was moved to Trash.
- Announced on `/updates` as one "new" entry.

## Why

Signup was open and the first sign-in provisioned an organisation. The owner wants every account approved, and it had to exist before any platform-paid AI key is switched on, since a fresh account would otherwise mean a fresh allowance.

## How to test (for the user)

Setup: pull `develop`, `pnpm dev`. Uses the DEV database (live data). You need a second browser profile or a private window for the new account.

1. In a private window open `/signup`, create an account with an address you can receive mail at, and confirm the email if asked. Expect to land on "Your account is waiting for approval", not in the app.
2. In that window try `/boards`. Expect to be sent back to the waiting screen.
3. Press "Check again". Expect "Still waiting for approval."
4. In your normal window open `/admin/users`. Expect a "Waiting for approval" section listing the new address, and "1 account waiting for approval" on `/admin`.
5. Click Approve. Expect the row to disappear.
6. Back in the private window press "Check again". Expect to continue into the app (your new organisation, or the create-organisation form if no name was given).
7. Repeat steps 1 to 4 with a second address and click Reject, confirm. Expect that account's screen to read "Your account was not approved" after "Check again".
8. Delete both test accounts from `/admin/users` (row menu, Delete).
9. Sign out and in again as yourself. Expect no change from before.

## Open threads

- **PR #150 is open for this and awaits the owner's manual merge** (develop CI and PR checks green). Until it is merged, a new signup on production is refused with the old "provisioning" error instead of the waiting screen, because the database rule is already live.
- **Correction found while promoting:** PR #149 had already been merged at 09:29 UTC and it included the unified assistant runtime, so the assistant has been live in production since then, before its remaining acceptance checks (non-Anthropic model, old proposal thread, step limit, two-organisation person) were run. That merge was not followed by the heal; `develop` was healed just before PR #150 (`251839bd`). The commit range since the last heal was therefore misleading and the PR was described from the tree difference against `main`.
- Not exercised live: a real email-confirmation signup through the form, an invited person, a password-recovery link for a pending account. Unit-tested only.
- Rejected accounts can still sign in and reset a password; they just never get past the waiting screen. No email is sent to the admin when someone signs up.
- Two Opus-tier subagents died twice on an API auth error mid-task; the orchestrator finished their gates and commits. No work was lost, but those two tasks have no implementer report.
- Pre-existing, found in review: the `board_members` insert policy does not check that the target is a member of the organisation.
- Assistant runtime follow-ups are unchanged: `docs/superpowers/plans/2026-11-13-unified-assistant-follow-ups.md`.

## Next session entry point

After the owner merges PR #150: verify the merge, heal `develop`, watch main CI and the Vercel deploy. Then run the assistant's four outstanding acceptance checks on production, and pick Plan B (assistant dock on every page) or the `create_goal`/`create_portfolio` organisation fix.
