# Signup approval

**Date:** 2026-11-13
**Status:** Design decided by the owner's standing instruction ("approve each new account, including invited teammates"; remaining choices delegated)
**Programme:** sub-project 0 of the AI turnaround (`docs/superpowers/plans/2026-11-13-unified-assistant-follow-ups.md`)

## Why

Signup is open. Anyone can create an account, and the first sign-in provisions an organisation for it. Nothing records whether an account was approved, and the only lever a platform admin has is to ban an account afterwards. The owner wants every new account to wait for a platform admin, and this must exist before any platform-paid AI key is switched on, because a fresh account would otherwise mean a fresh allowance.

Facts from the code and the live database (2026-11-13): 22 accounts, the newest from 2026-09-17; one `handle_new_user` trigger on `auth.users` that creates the profile; `platform_admins` and `admin_audit_log` exist; `profiles` is updatable by its owner, so an approval flag cannot live there.

## Decisions

| Question                  | Decision                                                                                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who waits                 | Every new account, including people invited into an existing organisation.                                                                                                                                                  |
| Existing accounts         | All marked approved by the migration. Nobody is locked out.                                                                                                                                                                 |
| Where the status lives    | A new table, `account_approvals`, that no client role can read or write.                                                                                                                                                    |
| What enforces it          | Two layers. The database refuses to create an organisation membership for an account that is not approved. The app sends such an account to a waiting screen.                                                               |
| Who decides               | A platform admin, from `/admin/users`. Each decision is written to `admin_audit_log`.                                                                                                                                       |
| Rejected accounts         | Status `rejected`; same lack of access; a different message. An admin can approve later or delete the account with the existing action.                                                                                     |
| How the admin finds out   | A "Waiting for approval" section at the top of `/admin/users` and a count on the admin overview. No email (production has no mail key) and no bell notification (that table requires an organisation and a new enum value). |
| Test and fixture accounts | An account created through the admin API with `app_metadata.pre_approved = true` starts approved. A person signing up cannot set `app_metadata`.                                                                            |

## Design

### 1. Data

```
account_approvals
  user_id     uuid primary key  → auth.users (on delete cascade)
  status      text  'pending' | 'approved' | 'rejected'
  created_at  timestamptz
  decided_at  timestamptz null
  decided_by  uuid null → auth.users (on delete set null)
```

- Row level security is on with no policies, and all privileges are revoked from `anon` and `authenticated`. Only the service role and security-definer functions touch it.
- `handle_new_user` inserts the row for every new account: `approved` when `raw_app_meta_data ->> 'pre_approved' = 'true'`, otherwise `pending`.
- The migration backfills every existing account as `approved`.

### 2. Database enforcement

A `before insert` trigger on `org_members` raises `account_not_approved` unless the new member's account is approved. Every path that grants access to tenant data goes through a membership row (`provision_account`, `create_organization`, `redeem_invitations`, `accept_invitation`), so one trigger covers them all, including paths added later, without rewriting those functions. An account with no membership sees nothing under the existing RLS, whether it comes through the app, PostgREST, Realtime or the MCP server.

### 3. App gate

- `src/lib/auth/approval.ts`: `getAccountApproval(userId)` reads the status with the service client inside a tagged `use cache` scope (the pattern `isPlatformAdminCached` already uses), so an approved account costs no query after the first read. `enforceApproval(user)` redirects anything but `approved` to `/pending-approval`.
- `requireUser()` calls it after the password check. `/home`, which calls `getUser()` directly, calls it too. A missing row counts as pending. A failed read throws; it never redirects and never lets the account through.
- `/auth/callback`: after exchanging the code, an account that is not approved is sent to `/pending-approval` without redeeming invitations or provisioning.
- `/pending-approval`: requires a session but not approval. It shows the waiting or the not-approved message, a "Check again" button and "Sign out". When the account has been approved, "Check again" finishes the setup the callback skipped (redeem invitations, otherwise provision) and continues to `/home`.
- `/onboarding`: before showing the create-organisation form, it redeems pending invitations, so an approved invited person who signs in later joins the organisation that invited them.
- Approving or rejecting clears that account's cache tag.

### 4. Admin

- `platform_search_users` returns `approval_status` and accepts an optional status filter.
- `/admin/users` gets a "Waiting for approval" section above the list: email, when it signed up, and Approve and Reject buttons. The status column shows Pending or Not approved where it applies.
- `platformApproveUser` and `platformRejectUser` in `src/lib/platform/actions.ts`: platform-admin check, update through the service client, audit row (`platform.user_approved` / `platform.user_rejected`), cache tag cleared, `/admin` revalidated.
- The admin overview shows how many accounts are waiting.

### 5. Rollout on the live database

Production runs on the DEV database, so the migration takes effect the moment it is applied, before the code is promoted:

- Existing accounts: unaffected (approved by the backfill).
- A new signup in that window: the account is created as pending, the membership trigger refuses its provisioning, and the currently deployed callback shows its existing "provisioning" error on the login page. Signup is effectively closed from that moment, with a rough message until the promotion delivers the waiting screen. The newest account is two months old, so this is expected to affect nobody.
- The migration is verified inside a rolled-back transaction on DEV before it is applied.

## Performance and data-fetching budget

- An approved account: one cached lookup per account, then none until the cache is cleared; no query added to any page for the normal case.
- `/admin/users`: one extra bounded query (pending accounts, limit 50) on first paint. Approve and Reject are Server Actions that revalidate `/admin`.
- No in-page toggle refetches server data.

## Tests

- Unit: the approval lookup (approved, pending, rejected, missing row, failed read); `requireUser` and `/home` redirecting; the callback skipping provisioning; the pending page's three states and its continue action; the onboarding redeem; the admin actions (not an admin, success, audit row, tag cleared); the admin page section.
- Database: in a rolled-back transaction on DEV, a new `auth.users` row gets a pending approval; a membership insert for it fails with `account_not_approved`; after approval it succeeds; `pre_approved` starts approved; existing accounts are approved.
- Conformance: the anon-reachability suite stays green (no new function or table is reachable by `anon`).
- Live run before merge: sign up a throwaway account, see the waiting screen, approve it as admin, continue into the app, then delete the account.

## Independent units

| Unit | What                                                                   | Depends on |
| ---- | ---------------------------------------------------------------------- | ---------- |
| M    | Migration, applied and typed                                           | none       |
| G    | Approval lookup and the app gate (session, home, callback, onboarding) | M          |
| P    | The pending page and its continue action                               | G          |
| A    | Admin queries, actions and UI                                          | M          |
| E    | Mark accounts created by end-to-end specs as pre-approved              | M          |

G, A and E can run together once M lands; P follows G.

## Not in this spec

- Email or bell notifications to admins.
- Closing signup at the auth provider, or invite-only signup.
- Banning rejected accounts automatically.
