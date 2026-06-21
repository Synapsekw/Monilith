# In-app organization invite acceptance — design

**Date:** 2026-06-20
**Status:** Approved (ready for implementation plan)

## Problem

An admin can invite a member to an organization, but the invited person receives
**nothing actionable** and has **no way to accept**:

- `inviteMember` (`src/lib/org/admin-actions.ts:91-133`) inserts an
  `org_invitations` row and calls `supabase.auth.admin.inviteUserByEmail(email)`.
  For an email that is **already a registered user**, `inviteUserByEmail` returns
  _"User already registered"_, which the code deliberately swallows
  (`admin-actions.ts:116-120`) — so **no email is sent**.
- The pending `org_invitations` row is hidden from the invitee by RLS
  (`org_invitations` SELECT is admins/platform-only,
  `20260619200000_org_admin_platform_console.sql:293-296`).
- The only code path that enrolls an invitee, `redeem_invitations()`
  (`...console.sql:259-283`), is called **only** from the magic-link callback
  `src/app/auth/callback/route.ts:16`. A normal email+password sign-in
  (`src/app/auth/actions.ts:42-52`) returns a session directly and `redirect("/")`
  — it **never** calls redeem. The comment at `admin-actions.ts:119` claiming
  "user can still redeem after a normal sign-in" is therefore false.

**Net effect for an existing user (the reported case):** no email, no in-app
notice, no membership, no accept button.

## Goal

A logged-in user with pending invitation(s) for their email sees them in the
**notification bell** and can **Accept** or **Decline** in-app — no email
required. Admins can see declined invites and re-invite.

## Non-goals

- Changing the brand-new-user (no account) onboarding. Such a user still needs the
  existing Supabase invite email to set a password; once logged in, the in-app
  flow applies. The email/SMTP path is unchanged by this work.
- Email template or deliverability changes.
- Multi-invite "accept all" — acceptance is per-invitation.

## Approach (chosen)

**Definer RPCs.** All invitee-facing reads/writes go through `SECURITY DEFINER`
functions keyed on the caller's auth email. This avoids exposing the
`org_invitations` table to invitees via RLS and lets a single call return the org
_name_ (which the invitee can't otherwise read, not being a member yet).

Rejected alternatives:

- **RLS SELECT policy for invitees + separate org-name lookup** — more moving
  parts, exposes invitation columns, still needs an org-name workaround.
- **Write rows into the existing `notifications` table on invite** — that table is
  keyed by `recipient_id` (a user id); invitees are keyed by email and may have no
  account. Doesn't fit.

## Components

### 1. Migration (`supabase/migrations/<ts>_invite_acceptance.sql`)

- **Relax status check** on `org_invitations`: allow `'declined'` in addition to
  `pending | accepted | revoked`. (Drop and re-add the CHECK constraint.)
- **`my_pending_invitations()`** — `SECURITY DEFINER`, `set search_path = ''`,
  `grant execute to authenticated`. Returns rows of
  `(id uuid, org_id uuid, org_name text, role public.org_role, created_at timestamptz)`
  for `org_invitations` where `status = 'pending'` and
  `lower(email) = lower(<caller auth.users email>)`, joined to
  `public.organizations` for the name. Returns empty set if `auth.uid()` is null.
- **`accept_invitation(p_invite_id uuid)` returns uuid** — `SECURITY DEFINER`.
  Resolves caller email from `auth.users`; selects the invite by id where
  `status = 'pending'` and `lower(email) = caller email`; if none, raises (or
  returns null) so the client shows a friendly error. Otherwise sets
  `status = 'accepted', accepted_at = now()`, inserts into `org_members
(org_id, user_id, role)` `on conflict (org_id, user_id) do nothing`, returns the
  `org_id`. `grant execute to authenticated`.
- **`decline_invitation(p_invite_id uuid)` returns void** — `SECURITY DEFINER`.
  Same email/pending guard; sets `status = 'declined'`. `grant execute to
authenticated`.
- **Keep `redeem_invitations()`** unchanged (brand-new-user magic-link path).
- Regenerate `src/types/database.types.ts` (`pnpm db:types`) in the same change.

**Security:** every RPC re-derives the caller's email server-side from
`auth.users` via `auth.uid()`; `p_invite_id` is validated against that email, so a
user cannot accept/decline another person's invite by guessing an id.

### 2. Invitee bell UI

- **`src/lib/collaboration/use-invitations.ts`** — `useInvitations()` react-query
  hook calling the `my_pending_invitations` RPC. One fetch on mount
  (`staleTime` high; no refetch on popover open/close). Exposes the list + count.
- **`src/lib/collaboration/use-invitation-mutations.ts`** — `acceptInvitation` /
  `declineInvitation` mutations calling the RPCs and invalidating the invitations
  query on settle.
- **`src/components/notifications/InvitationsSection.tsx`** (client) — renders
  pending invites: _"You've been invited to **{org_name}** as {role}"_ with
  **Accept** and **Decline** buttons (disabled while the mutation is pending,
  inline error on failure, consistent with `invite-panel.tsx`).
- **`src/components/notifications/NotificationsBell.tsx`** — render
  `InvitationsSection` above `NotificationsList` in the popover; badge count =
  unread notifications **+** pending invites. On **Accept** success, navigate to
  `/` (e.g. `window.location.assign("/")` or `router.refresh()`) so the new org
  context, sidebar, and boards load — membership is server data, so a refresh is
  correct here (not an in-page toggle).

### 3. Admin Settings

- **`src/app/settings/page.tsx`** — change the invitations query from
  `.eq("status","pending")` to `.in("status",["pending","declined"])` and select
  `status` too.
- **`src/components/settings/invite-panel.tsx`** (and its `Invite` type) — carry
  `status`; for `declined` rows show a **Re-invite** button (calls existing
  `inviteMember` with the same email/role → inserts a fresh `pending` row; the
  unique partial index only blocks duplicate **pending** invites, so a prior
  `declined` row does not conflict). Pending rows keep the existing **Revoke**.

## Data flow

- Invitee logs in → bell mounts → `my_pending_invitations` returns pending invites
  → badge + section show them.
- **Accept** → `accept_invitation(id)` → membership inserted, invite `accepted` →
  client navigates `/` → invitee lands in the workspace as a member.
- **Decline** → `decline_invitation(id)` → invite `declined` → disappears from the
  invitee's bell; appears as _Declined_ in the admin Settings list with
  **Re-invite**.

## Error handling

- RPC returns null / raises on no-matching-pending-invite (already accepted,
  revoked, or wrong email) → client surfaces a friendly inline message and
  refetches the list (the stale invite drops off).
- Mutation failure → inline error in `InvitationsSection`; buttons re-enabled.

## Performance & data-fetching budget

- Bell invites: **1 RPC on mount**, same shape as notifications. **0** round-trips
  on popover open/close or any in-page toggle.
- Accept/Decline change **server data** (membership / invite status) → an RPC
  mutation, and Accept follows with a **single** `/` navigation to reload the new
  org context. Consistent with the RSC-nav rule
  (`vault/decisions/2026-06-16-gotcha-09-...`).
- Reads are bounded: a user has a handful of pending invites; no unbounded scans.

## Testing (mandatory)

- **RPC / RLS integration** (`src/lib/org/*.integration.test.ts` style):
  - `my_pending_invitations` returns only the caller's `pending` invites, includes
    the org name, excludes accepted/revoked/declined and other users' invites.
  - `accept_invitation` enrolls the caller in `org_members` with the invited role
    and marks the invite `accepted`; rejects an invite whose email ≠ caller email;
    idempotent on conflict.
  - `decline_invitation` sets `declined`; rejects wrong-email invites.
- **Hooks / components** (Vitest): `InvitationsSection` renders an invite and fires
  accept/decline; bell badge includes invite count; admin panel shows **Re-invite**
  for declined rows and **Revoke** for pending.
- Gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Execution DAG

- **Task 1 — Migration + types** (foundation; blocks 2 and 3): status check
  relaxation, three RPCs, `pnpm db:types`, RPC integration tests.
- **Task 2 — Invitee bell** (depends on 1): hooks, `InvitationsSection`, bell
  wiring, component tests.
- **Task 3 — Admin Settings declined + Re-invite** (depends on 1): query +
  panel changes, tests.

Parallel batches: **[1]** → **[2, 3]**. Critical path: 1 → (2 or 3).
Tasks 2 and 3 touch disjoint files and can run concurrently after Task 1.
