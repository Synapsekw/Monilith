# Org invitations arrive in real time

**Date:** 2026-08-07
**Status:** Approved, ready to plan

## Problem

An org admin sends an invite; the recipient sees nothing for minutes. Reported as "more
than 5 minutes", but there is no five-minute timer anywhere — there is no push at all. The
invite surfaces only on the recipient's next **full page load**, so the observed delay is
arbitrary and unbounded (an invitee with the tab already open never sees it).

### Root cause

`inviteMember` (`src/lib/org/admin-actions.ts:114`) does three things: inserts an
`org_invitations` row, calls `svc.auth.admin.inviteUserByEmail(email)`, and writes an audit
row. Two gaps follow.

**No email for existing users.** Lines 141-144 deliberately swallow Supabase's
`"User already registered"` error. For an email that already has an account, Supabase Auth
sends nothing. Verified on DEV: the 2026-08-07 06:32 UTC invite went to an address
registered since 2026-07-06, whose `auth.users.invited_at` is `null` — Auth never issued a
mail.

**No in-app push either.** Verified against the live DEV database:

- `org_invitations` has **zero triggers** — no `notifications` row is ever created for an
  invite.
- `org_invitations` is **not in the `supabase_realtime` publication** (only `notifications`,
  `items`, `boards`, `cell_values`, `columns`, `groups`, `attachments`, `board_members`,
  `item_activities`, `item_updates` are).
- `org_invitations` has **no SELECT policy for the invitee** — only org admins and platform
  admins can read it. Invitees reach their invites solely through the `SECURITY DEFINER` RPC
  `my_pending_invitations`.

So the only surface is the bell's Invitations section, and every refresh path into it is
closed:

| Where                                         | Setting                       | Effect                        |
| --------------------------------------------- | ----------------------------- | ----------------------------- |
| `src/lib/collaboration/use-invitations.ts:12` | `staleTime: Infinity`         | never goes stale              |
| `src/components/providers.tsx:14`             | `refetchOnWindowFocus: false` | tab focus does not refetch    |
| `use-invitations.ts`                          | no realtime channel           | nothing pushes it             |
| `NotificationsBell.tsx:87`                    | no `onOpenChange` refetch     | opening the bell does nothing |

`useNotifications` (`use-notifications.ts:38-80`) _does_ subscribe to postgres changes. That
asymmetry is the whole bug: mentions land instantly, invitations do not.

## Scope

In-app only. Make a pending invitation appear in the recipient's bell within a second, and
disappear just as fast when an admin revokes it. Email is explicitly **out of scope** —
existing users still receive no invite email, which remains a known gap (see Out of scope).

## Approach

Mirror the notifications pattern onto invitations: push over Supabase Realtime, invalidate
the query, let the existing UI re-render. `useInvitations` becomes structurally the same
hook as `useNotifications`.

### Alternatives rejected

**Insert a `notifications` row per invite** (add `org_invitation` to the `notification_kind`
enum, plus a trigger on `org_invitations`). Rides the existing channel, but produces two
surfaces for one thing — a notification row rendered directly above the Invitations block
that already carries the Accept/Decline buttons. It also needs split migrations (Postgres
will not let a new enum value be used in the transaction that adds it) and manual cleanup of
the notification on accept, decline, and revoke. More moving parts, worse UI.

**Poll on an interval.** No schema change, but a permanent per-tab request tax to catch an
event that happens a few times a week, and it still leaves a delay equal to the interval.

## Design

### 1. Migration

One file, two statements.

```sql
create policy "org_invitations: read own by email" on public.org_invitations
  for select to authenticated
  using (lower(email) = lower((select auth.jwt() ->> 'email')));

alter publication supabase_realtime add table public.org_invitations;
```

The policy is load-bearing, not incidental: `postgres_changes` evaluates RLS per subscriber,
so without a SELECT policy the invitee is never sent the row. Existing policies are
permissive, so this adds a read path without narrowing the admin ones.

Two facts from the live DB keep this cheap:

- **Revoke, accept, and decline are all `UPDATE status = …`, never `DELETE`**
  (`revokeInvite` sets `status = 'revoked'`; `accept_invitation` and `decline_invitation` set
  `'accepted'` / `'declined'`). So INSERT + UPDATE covers every case, with no
  `REPLICA IDENTITY FULL` and no DELETE-event exposure. Replica identity stays `default`.
- **`org_invitations_email_idx` on `lower(email)` already exists**, so both the RLS check and
  the `my_pending_invitations` refetch are index-covered. The table holds 12 rows today.

On the RLS `UPDATE` path: the policy is evaluated against the NEW row, which still carries
the invitee's email, so a revoke reaches the invitee before the row leaves their view.

**Security note (deliberate widening).** The invitee gains direct read on invitation rows
addressed to them. Relative to `my_pending_invitations` that adds `invited_by`, `status`, and
their own non-pending history. This is the invitee's own data and does not cross a tenant
boundary — an invitation names exactly one recipient. No other role's access changes.

### 2. Client — `src/lib/collaboration/use-invitations.ts`

Add a `useEffect` that subscribes to `postgres_changes` on `public.org_invitations` for
INSERT and UPDATE, invalidating `invitationsKey(userId)` on either, and removes the channel
on unmount. Shape follows `use-notifications.ts:38-80`.

**No channel filter, by design.** Recipient matching is case-insensitive on email, which a
Realtime filter string (exact equality on one column) cannot express. RLS is the gate
instead. At this volume the per-subscriber RLS check is negligible, and correctness beats a
filter that silently drops events on a casing mismatch.

**Invalidate, do not patch the cache.** The payload row has no `org_name` — that is a join on
`organizations`, which the invitee cannot read directly — so a refetch through the RPC is the
only way to build a complete `PendingInvitation`. This is the documented exception to the
optimistic-patch convention used elsewhere in `src/lib/collaboration`, and it is safe because
invitations are not a hot path.

`staleTime: Infinity` stays. It is correct once the data is push-driven and matches every
other cache in the codebase.

### 3. UI

No component changes. `NotificationsBell` already derives its badge from
`unread + inviteCount` (`NotificationsBell.tsx:24`) and renders `InvitationsSection` from the
same query, so both update from the invalidation alone.

## Testing

- **RLS integration test** — invitee can select their own invitation row; a third party
  cannot. Follows `src/lib/org/invite-acceptance.rls.integration.test.ts`; skips unless
  `PULSE_TEST_DB` is set.
- **Hook test** for `useInvitations` — an INSERT event invalidates the query; an UPDATE
  (revoke) event invalidates it; the channel is removed on unmount. Follows the existing
  collaboration hook test setup.
- **Gates** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green before merge.

## Performance & data-fetching budget

- **First paint:** unchanged — the same single `my_pending_invitations` RPC.
- **Interaction:** zero new server round-trips. No in-page toggle changes.
- **New traffic:** one Realtime channel, multiplexed onto the socket `useNotifications`
  already opens for the same user.
- **Refetch:** fires only on a real invitation change (a few per week), bounded and
  index-covered via `org_invitations_email_idx`.

## Execution DAG

Migration → hook → tests is a single dependency chain. One task, no parallel batch, critical
path equals total work. Fanning out would cost more in coordination than it saves.

## Out of scope

- **Invite email for already-registered users.** They receive none today, by design of the
  `"User already registered"` swallow. Worth revisiting as its own task (a Resend send, since
  `inviteUserByEmail` cannot serve this case).
- **SMTP for brand-new invitees.** Whether the hosted project still uses Supabase's built-in
  email service (best-effort delivery, ~2/hour cap) is a dashboard setting, not a code change,
  and could not be verified from the repo.
