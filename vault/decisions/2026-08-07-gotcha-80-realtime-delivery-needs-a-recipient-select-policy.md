---
type: adr
date: 2026-08-07
status: accepted
tags: [decision, gotcha, realtime, rls]
related: ["[[2026-08-07-2016-invite-realtime-delivery]]"]
---

# Gotcha 80 — Realtime delivers nothing without a recipient SELECT policy, and `staleTime: Infinity` turns that silence into a one-shot read

## Context

Org invitations reached the recipient's bell only on their next **full page load** — reported as
"more than 5 minutes", but there was no timer anywhere. Three independent conditions had to hold
for a push, and none did:

1. `org_invitations` was **not in the `supabase_realtime` publication**.
2. It had **no SELECT policy for the invitee** — the three policies were all admin-scoped, and
   invitees reached their invites only through the `SECURITY DEFINER` RPC `my_pending_invitations`.
3. `useInvitations` held `staleTime: Infinity` with **no subscription**, and
   `refetchOnWindowFocus` is `false` globally (`providers.tsx`).

## Decision

Delivery to a specific recipient requires **publication membership AND a per-recipient RLS SELECT
policy**. `postgres_changes` evaluates RLS per subscriber, so a table can be in the publication and
still push nothing to the person who needs it. The policy is not an access convenience — it *is*
the delivery rule.

Correspondingly: **`staleTime: Infinity` is only correct when paired with a push channel.** Alone,
it is a one-shot read whose refresh interval is "whenever the user next hard-reloads".

## Rationale

Two alternatives were rejected. Inserting a `notifications` row per invite would ride the existing
channel but create two surfaces for one thing (a notification row directly above the Invitations
block that already carries Accept/Decline), plus split enum migrations and manual cleanup on
accept/decline/revoke. Polling is a permanent per-tab request tax to catch an event that happens a
few times a week, and still leaves a delay equal to the interval.

Two properties made the chosen fix cheap, and both were checked against the live DB rather than
assumed: every status transition is an **UPDATE, never a DELETE** (`revokeInvite` sets
`status='revoked'`), so INSERT + UPDATE covers the lot on default replica identity; and
`org_invitations_email_idx` on `lower(email)` already existed, so the RLS check and the refetch are
index-covered.

**No channel filter.** Recipient matching is case-insensitive on email; a Realtime filter is exact
equality on one column, so a casing mismatch would silently drop events. RLS is the gate instead.

## Consequences

- Positive: invites appear and disappear in about a second; revoke is symmetric, so no stale Accept
  button that would fail with "invitation not found".
- Positive: the invitee can now read their own invitation rows directly — deliberate widening, and
  it stays inside the tenant boundary because an invitation names exactly one recipient.
- Negative: every connected client gets an RLS check per `org_invitations` change (unfiltered
  subscription). Negligible at 12 rows and a handful of invites a week; revisit if invites scale.
- Watch for: any other `staleTime: Infinity` query with no subscription is the same bug in waiting.
  Realtime also needs a table-level `SELECT` **grant** for `authenticated`, not just a policy —
  `set local role authenticated` returning a row (rather than "permission denied") is the check.
