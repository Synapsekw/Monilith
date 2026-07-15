# Notification Preferences — Design Spec

- **Date:** 2026-07-15
- **Status:** Draft — awaiting owner review
- **Origin:** Audit Batch B deferred item — "user-configurable notification settings"
- **Author:** scoping agent (`task/notification-prefs`)

## 1. Problem & intent

Pulse fans out per-user notifications (in-app rows + one email path) with **no
user control over which event-types they receive**. The only existing
preference is a weekly-digest _email_ opt-out. A user who does not want, say,
"assigned to an item" pings has no way to turn them off. This feature gives each
user per-event-type control over their **in-app** notifications, with a data
model that is future-proofed for a second **email** channel.

Success = a user can, from Settings, toggle individual notification event-types
off; a toggled-off type stops creating in-app notifications for them; existing
users see **zero behavior change** until they opt out (opt-out model, no
backfill).

## 2. Grounded footprint (verified against code)

### 2.1 Notification event-types (the `notification_kind` enum)

Read from `src/types/database.types.ts` (enum) cross-referenced with every
non-test `.from("notifications").insert(...)` site:

| `kind`              | Emitted today? | Emit site                                                                                | Channel(s) today   | User-controllable in this feature?             |
| ------------------- | -------------- | ---------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------- |
| `mention`           | ✅ yes         | `src/lib/collaboration/actions.ts:66` (`addUpdate`)                                      | in-app             | **Yes**                                        |
| `assigned`          | ✅ yes         | `src/lib/boards/actions/cell.ts:92` (`upsertCell`, people column)                        | in-app             | **Yes**                                        |
| `health_digest`     | ✅ yes         | `src/lib/digest/run.ts:234` (weekly digest)                                              | in-app **+ email** | **Yes** (in-app); email keeps existing opt-out |
| `feedback_response` | ✅ yes         | `src/lib/feedback/actions.ts:126` (`adminUpdateFeedback`, **service client**, cross-org) | in-app             | **No** (always-on — see §6)                    |
| `update_on_item`    | ❌ reserved    | none yet (enum only)                                                                     | —                  | Modeled, no UI until emitted                   |
| `automation`        | ❌ reserved    | none yet (`automation_id` column exists)                                                 | —                  | Modeled, no UI until emitted                   |

Key facts:

- **In-app delivery = one choke point:** every kind becomes a row in
  `public.notifications`. `useNotifications` (`src/lib/collaboration/use-notifications.ts`)
  reads that table and subscribes to realtime INSERT/UPDATE. Gating an in-app
  type therefore means "don't create the row."
- **Email delivery exists for exactly one kind — `health_digest`** — sent in
  `digest/run.ts` via Resend, gated by `profiles.email_digest_opt_out`
  (`DigestPreferenceForm` + `digest-actions.ts`). No other kind sends email.
- **`feedback_response` is inserted with the SERVICE client** because the
  platform admin is not a member of the recipient's org (RLS would block a
  normal insert). Any gating mechanism must therefore sit at a layer the service
  client also passes through.

### 2.2 The existing prefs primitive (the pattern to extend)

- `profiles.email_digest_opt_out boolean not null default false`
  (migration `20260703121000_health_digest.sql`). **Inverted/opt-out** storage
  so existing users stay subscribed with no backfill.
- Server action `setEmailDigestOptOut` (`src/lib/settings/digest-actions.ts`):
  Zod-validated, `ActionResult`, RLS "update self".
- Client `DigestPreferenceForm` (`src/components/settings/DigestPreferenceForm.tsx`):
  `useTransition`, optimistic checkbox, revert-on-failure.
- Rendered in the **Notifications** card of `src/app/(app)/settings/page.tsx`.

### 2.3 Notifications RLS (why cross-user pref reads are hard)

`notifications` RLS (`20260617100000_notifications.sql` +
`20260617102000_notifications_insert_org_integrity.sql`):

- **read/update own** (`recipient_id = auth.uid()`).
- **insert as member+actor**: any org member may insert rows _for other members_
  (`is_org_member(org_id) AND actor_id = auth.uid() AND is_member_of(recipient_id, org_id) …`).

Consequence: the actor creating a notification is a **different user** from the
recipient. A self-scoped `notification_preferences` table cannot be read by the
actor under RLS. This drives the gating design (§5).

## 3. Scope

**In scope**

- New `notification_preferences` table (per-type × per-channel, opt-out model).
- New `notification_channel` enum (`in_app`, `email`).
- Server action(s) to set a preference; RLS self-only.
- A settings UI (unified "Notifications" card) exposing per-type **in-app**
  toggles for the user-controllable emitted kinds (`mention`, `assigned`,
  `health_digest`).
- **In-app gating** at notification-creation time via a single DB-layer choke
  point that covers all present and future kinds (including the service-client
  `feedback_response` and `health_digest` paths).
- Tests: unit (action + component) and integration (RLS + trigger gating).
- Migration + `pnpm db:types` regen + Supabase advisors run.

**Out of scope (YAGNI / deferred)**

- Net-new **email** delivery for `mention`/`assigned` (no email pipeline exists
  for them; nothing to gate). The `email` channel is modeled in the schema but
  only `health_digest` has an email path.
- **Retiring `email_digest_opt_out`** / migrating it into the unified table.
  It works, is tested, and rewiring `digest/run.ts` is extra blast radius. See
  the owner question in §11.
- UI toggles for `update_on_item` / `automation` (not emitted yet).
- Per-org admin defaults / notification schedules / digest frequency.

## 4. Data model

New enum + table (opt-out semantics — a row exists **only to record a disabled
preference**; absence = enabled):

```sql
create type public.notification_channel as enum ('in_app', 'email');

create table public.notification_preferences (
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       public.notification_kind    not null,
  channel    public.notification_channel not null,
  -- Present in the shape but semantics are opt-out: we only ever store
  -- disabled rows. `enabled` is pinned false via a check so a stray `true`
  -- row can never mean something ambiguous.
  enabled    boolean not null default false check (enabled = false),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, channel)
);

alter table public.notification_preferences enable row level security;

create policy "notif prefs: read own"   on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notif prefs: write own"  on public.notification_preferences
  for all    to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.notification_preferences to authenticated;
```

**Why disabled-rows-only (opt-out):** existing users have no rows → everything
enabled → zero backfill, zero behavior change. The table stays tiny (only
records the exceptions). "Enable a type" = delete the row; "disable" = upsert a
row. Reads default to enabled.

**Rejected alternatives**

- **JSONB `notification_prefs` column on `profiles`** — simpler write path but
  can't be read by the actor for gating (still self-RLS), and the trigger below
  would parse JSON per insert. Normalized table wins for the gating join.
- **Boolean column per kind×channel** — schema churn on every new kind; rejected.

## 5. In-app gating — DB `BEFORE INSERT` trigger (the choke point)

Gate at the **single table every kind flows through**, not at each call site:

```sql
create or replace function public.gate_notification_by_pref()
returns trigger language plpgsql security definer stable
set search_path = '' as $$
begin
  if exists (
    select 1 from public.notification_preferences p
    where p.user_id = new.recipient_id
      and p.kind    = new.kind
      and p.channel = 'in_app'
  ) then
    return null;  -- recipient opted out of this in-app type: skip the row
  end if;
  return new;
end;
$$;

create trigger gate_notification_by_pref
  before insert on public.notifications
  for each row execute function public.gate_notification_by_pref();
```

Why a trigger (chosen) over an app-layer filter:

- **Covers every insert path with zero per-call-site code** — the `mention`,
  `assigned`, `health_digest`, and service-client `feedback_response` inserts,
  plus the two reserved kinds when they ship, are all gated automatically.
- **Solves the cross-user RLS read** — `security definer` reads the _recipient's_
  prefs without the actor needing select rights on another user's rows.
- **Right semantics for realtime** — a skipped row never inserts, so
  `useNotifications`' realtime subscription simply never fires for it. Correct.
- Row-level `BEFORE INSERT … RETURN NULL` cleanly skips just that row in a bulk
  fan-out insert (mentions/assignees insert arrays).

Trade-off: a silently-dropped row is invisible to the caller. That is exactly
the desired behavior (best-effort fan-out is already the norm — see the
`console.error` best-effort comments at each site), and integration tests assert
the drop. Because the UI only lets a user disable the controllable kinds,
`feedback_response` can never get a disabled row and is thus always-on with no
special-casing in the trigger.

## 6. `feedback_response` is intentionally always-on

It is a **direct reply to something the user submitted** (a support-style
response), not an ambient activity ping. Suppressing it would hide an answer the
user asked for. We therefore **do not render a toggle** for it. Because the
opt-out model only creates rows the UI offers, no disabled `feedback_response`
row can exist and the trigger never skips it — no code branch required.

## 7. Email channel — this iteration

Only `health_digest` has an email path, already gated by
`profiles.email_digest_opt_out`. This iteration **keeps that mechanism as-is**.
The unified Notifications settings card surfaces the existing digest-email toggle
alongside the new in-app toggles so the user sees one coherent panel, but the
digest-email toggle keeps writing `email_digest_opt_out` via the existing
`setEmailDigestOptOut` action (no data migration, no `digest/run.ts` change).

The `email` value of `notification_channel` is defined in the schema so a future
iteration can add email delivery + gating for other kinds without a migration to
the enum's _table_ usage. Unifying digest email into `notification_preferences`
is deferred (owner question §11).

## 8. Settings UI

Extend the existing **Notifications** card in `settings/page.tsx`:

- New Server Component reads the caller's disabled rows
  (`select kind, channel from notification_preferences where user_id = me`) on
  first paint — bounded, indexed by the PK, tiny.
- New client `NotificationPreferencesForm` renders a compact list of the
  controllable in-app types with human labels (reuse the copy already in
  `NotificationsList.tsx`'s `label()`: "Mentions", "Assignments", "Weekly
  digest"). Each row is an optimistic checkbox mirroring `DigestPreferenceForm`
  (`useTransition`, revert-on-failure).
- The existing digest **email** checkbox stays (renders via `DigestPreferenceForm`
  as today) inside the same card, visually grouped under an "Email" subheading;
  the new in-app toggles sit under an "In-app" subheading.

Copy/labels (in-app section):

| kind            | label         | description                              |
| --------------- | ------------- | ---------------------------------------- |
| `mention`       | Mentions      | When someone @-mentions you in an update |
| `assigned`      | Assignments   | When you're assigned to an item          |
| `health_digest` | Weekly digest | The weekly plan-health digest, in-app    |

## 9. Performance & data-fetching budget (working agreement #5)

- **First paint:** one extra bounded read (`notification_preferences` for the
  current user, PK-indexed, ≤ #kinds×#channels rows). Runs inside the existing
  `Promise.all` in `settings/page.tsx`. No unbounded `select *` on a growing
  table.
- **Each toggle:** a **Server Action** (it changes server data) with **no**
  RSC navigation and **no** `revalidatePath` of the settings route — the
  component holds optimistic local state exactly like `DigestPreferenceForm`, so
  a toggle is **1 write round-trip, 0 refetches** of page data.
- **Gating hot path:** the trigger adds one indexed `exists` lookup per
  notification insert (PK-covered). Fan-out inserts are already small (mention
  recipients / newly-assigned people). Acceptable.

## 10. Testing strategy (evidence before claims)

- **Unit — action** (`vitest`, mock Supabase like `digest-actions.test.ts`):
  set-preference action upserts a disabled row / deletes on enable; validates
  input; rejects unauthenticated; writes only the caller's `user_id`.
- **Unit — component**: `NotificationPreferencesForm` toggles optimistically and
  reverts on failure (mirror `DigestPreferenceForm.test.tsx`).
- **Integration — RLS** (`*.rls.integration.test.ts`, skipped unless
  `PULSE_TEST_DB` per the dev-DB split): a user cannot read/write another user's
  preference rows.
- **Integration — trigger gating** (the load-bearing test): with a disabled
  `(recipient, mention, in_app)` row, an `addUpdate`-style notification insert
  for that recipient **creates no row**; without it, the row appears; a
  non-disabled recipient in the same fan-out still gets theirs.
- All four gates green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## 11. Open question for the owner (only genuinely blocking one)

**Unify the digest email opt-out into `notification_preferences` now, or later?**

- _Now:_ single source of truth; migrate `email_digest_opt_out` → seed
  `(health_digest, email)` disabled rows, repoint `digest/run.ts` + the digest
  form at the unified prefs, drop/deprecate the column. Cleaner end state, but
  touches the tested digest pipeline (more blast radius, higher regression risk
  on a working path).
- _Later (spec default):_ leave `email_digest_opt_out` standalone; the new table
  covers **in-app** per-type control + a future-proofed `email` enum value.
  Smallest complete, testable increment; no risk to digest delivery.

**Default taken in this spec: later.** Flag if you'd rather unify now.

## 12. Build-time collision flag (do not resolve here)

`src/app/(app)/settings/page.tsx` is **also edited by the parallel org-switcher
work**. This feature adds imports + a preferences read + renders the new form in
the Notifications card — a near-certain merge conflict with that branch. Flagged
for the coordinator to sequence/rebase; **not resolved in this spec**. Keeping
the new form self-contained (own component + own read helper) minimizes the
conflicting surface in `page.tsx` to a couple of import lines and one card body.
