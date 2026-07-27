---
type: spec
status: built
date: 2026-07-25
tags: [project/pulse, spec, settings, auth, gdpr, migrations, rls]
related:
  - "[[2026-07-25-1056-settings-redesign-mcp-guide]]"
  - "[[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]]"
  - "[[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
---

# Delete account — self-serve account deletion in Settings

## 1. Problem

Monolith has no way for a user to delete their own account. The settings redesign
(2026-07-25) deliberately deferred it because of an "FK blocker" recorded in the session
note. This spec resolves that blocker and specifies the feature.

The blocker is worse than recorded. **Account deletion is impossible in Monolith today — for
anybody, by any path.** Verified empirically against the live DEV database in a rolled-back
transaction:

```
PROBE(minimal-user): BLOCKED by [organizations_created_by_fkey]
  :: update or delete on table "users" violates foreign key constraint
     "organizations_created_by_fkey" on table "organizations"
```

That probe targeted a user with **zero boards and zero items**. Every real Monolith user has
created at least one organization during onboarding, so `organizations.created_by`
(`NOT NULL`, `ON DELETE NO ACTION`, not deferrable) blocks every deletion unconditionally.

**Corollary — `platformDeleteUser` is a live latent bug.** The admin "Delete permanently"
button (`src/lib/platform/actions.ts:213-255`, surfaced via
`src/components/admin/user-row-actions.tsx`) writes an `admin_audit_log` row with
`target_user_id = <the user being deleted>` and _then_ calls `svc.auth.admin.deleteUser`.
That FK is also `NO ACTION`, so the action's own audit write blocks its own delete.
Verified, rolled back:

```
PROBE(audit): BLOCKED by [admin_audit_log_target_user_id_fkey]
```

So the admin path has never worked either. It returns `fail("Could not delete the
user.")` every time. **Fixing the schema fixes both paths with one change** — which is why
this spec covers both, and why the self-serve path is a reuse of the admin path rather than
a parallel implementation.

## 2. Verified schema facts (live DEV, `supabase-dev` MCP, read-only)

**40 columns in `public` reference `auth.users`.** The prior scout's counts are confirmed
exactly, column-for-column:

| `ON DELETE`             | Count  | Status                                                                   |
| ----------------------- | ------ | ------------------------------------------------------------------------ |
| `cascade`               | 12     | Already correct — no work                                                |
| `set null`              | 2      | `portfolio_boards.owner_user_id`, `reports.created_by` — already correct |
| `no action`, `NOT NULL` | **16** | Hard blockers                                                            |
| `no action`, nullable   | **10** | Blockers, but only the FK action is wrong                                |

No FK to `auth.users` is `DEFERRABLE`, so `NO ACTION` fires at statement end and blocks
immediately. **No other schema contributes a blocker** — all 8 non-`public` references are
`auth`-internal (`auth.sessions`, `auth.identities`, `auth.mfa_factors`, …), all already
`cascade`. `storage.objects` has no FK to `auth.users` in this project (see §7 — the avatar
file is therefore an _unreferenced_ GDPR leak, not an FK blocker).

The 16 `NOT NULL` blockers: `admin_audit_log.actor_id`, `attachments.uploaded_by`,
`board_members.granted_by`, `boards.created_by`, `dashboards.created_by`,
`feedback.submitted_by`, `goals.created_by`, `goals.owner_id`, `item_updates.author_id`,
`items.created_by`, `member_capacity.created_by`, `org_invitations.invited_by`,
`organizations.created_by`, `portfolios.created_by`, `time_entries.user_id`,
`workspaces.created_by`.

The 10 nullable-but-`no action`: `admin_audit_log.target_user_id`,
`automations.created_by`, `board_agents.created_by`, `boards.archived_by`,
`feedback.responded_by`, `groups.archived_by`, `item_activities.actor_id`,
`items.archived_by`, `notifications.actor_id`, `org_members.deactivated_by`.

### 2.1 Ownership in Monolith is derived, not stored — and the blast radius is larger than recorded

The vault's original note proposed converting the `NOT NULL` columns to `ON DELETE SET
NULL`. That would cause **silent, irreversible, org-wide data loss.**

`boards.created_by` _is_ the ownership record. There is no owner grant row. The test lives
in three places at once:

- **TypeScript** — `src/lib/boards/queries.ts:126` (`if (board.created_by === user.id)
return "owner"`) and `:147` (`deriveBoardAccess`).
- **RLS policy** — `boards: read if can read` = `is_org_member(org_id) AND (created_by =
auth.uid() OR is_board_member(id))`; `boards: delete if owner` = `created_by = auth.uid()`.
- **Two `SECURITY DEFINER` functions that gate five other tables** — this is the part the
  prior scout missed:

```sql
create or replace function public.readable_board_ids() returns setof uuid
language sql stable security definer set search_path to '' as $$
  select b.id from public.boards b
  where public.is_org_member(b.org_id)
    and ( b.created_by = (select auth.uid())
          or exists (select 1 from public.board_members m
                     where m.board_id = b.id and m.user_id = (select auth.uid())) );
$$;
```

`readable_board_ids()` is the `SELECT` gate for **`items`, `groups`, `item_activities`,
`time_entries` and `automations`**. `can_edit_board()` has the same shape and is the
`INSERT`/`UPDATE`/`DELETE` gate for the same five tables.

**The decisive measurement: on DEV, 12 of 15 boards have no `board_members` row for their
own creator.** So for 80% of boards, nulling `created_by` makes the `OR` collapse to
`false` for every user in the org. The board, and every item, group, activity, time entry
and automation on it, becomes **unreadable by anyone, forever** — with no UI anywhere to
recover it. Two service-client readers that hand-replicate RLS
(`src/lib/boards/queries-cached.ts:59,61,72`, `src/lib/portfolios/queries-cached.ts:45`)
filter on `created_by = userId`, so the boards also silently vanish from the nav.

One member clicking "Delete my account" would destroy their colleagues' work. `SET NULL` is
disqualified.

### 2.2 Reassigning to the bot principal is _also_ disqualified — for ownership columns

The scout recommended reassignment, offering either a surviving org owner or the existing
bot principal `pulse-autopilot@pulse.internal`
(`supabase/migrations/20260720120517_board_agents.sql:44`, fixed id
`00000000-0000-4000-8000-00000000b071`). Verified: the bot exists, has a `profiles` row
with `is_agent = true`, and — critically — **`org_members` count = 0**.

`readable_board_ids()` requires `is_org_member(b.org_id) AND (created_by = auth.uid() …)`.
With `created_by = <bot>`, `created_by = auth.uid()` is `false` for every real user —
_exactly as if it were NULL_. **Bot-reassignment reproduces the invisibility bug verbatim.**

The bot is the right principal for _authoring content_ (that is what `board_agent_apply`
uses it for) and the wrong principal for _bearing ownership_. Any ownership column must be
reassigned to a **real, active, org-member human**.

Availability is guaranteed: on DEV, `orgs_without_active_owner = 0`, and the sole-owner
guard (§4.2) already refuses the one case where no other owner exists.

## 3. Decision: per-column hybrid — reassign ownership, null attribution, cascade personal records

Four treatments, assigned by what the column _means_ rather than by its nullability. (The
fourth — the bot principal for `item_updates.author_id` — is decision **D2**, resolved in
favour of the recommendation in §9; the table below reflects what was **built**.)

| Treatment                                                                                | Columns                                                                                                                                                                                                                                                                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reassign to a surviving org owner** (stays `NOT NULL`, stays `NO ACTION`)              | `boards.created_by`, `goals.created_by`, `goals.owner_id`, `portfolios.created_by`, `organizations.created_by`, `workspaces.created_by`, `dashboards.created_by`, `items.created_by`, `board_members.granted_by`, `org_invitations.invited_by`, `member_capacity.created_by`, `attachments.uploaded_by` (12) | These bear authority (`readable_board_ids`, `can_edit_board`, `can_edit_goal`, `can_edit_portfolio`) or are org work product. A live human must resolve to "owner".                                                                                                                                                                                                                                                                |
| **Reassign to the platform bot** (stays `NOT NULL`, stays `NO ACTION`) — **decision D2** | `item_updates.author_id` (1)                                                                                                                                                                                                                                                                                 | The only column where the bot is right rather than disqualified. It is the truthful attribution ("no longer attributable to a person") and it hands nobody edit authority over another person's words. Safe **because** `item_updates` is gated by `author_id = auth.uid() OR can_edit_board(board_id)`, so board editors keep control regardless — unlike `boards.created_by`, this column is not visibility-load-bearing (§2.2). |
| **Cascade** (`NOT NULL` → `ON DELETE CASCADE`)                                           | `time_entries.user_id` (1)                                                                                                                                                                                                                                                                                   | This is a _fact about the person_, not authorship. Reassigning would falsify who did the work. Its two siblings `time_allocations.user_id` and `member_capacity.user_id` are **already** `cascade` — this is consistency, not a new idea.                                                                                                                                                                                          |
| **Nullable + `SET NULL`**                                                                | `admin_audit_log.actor_id`, `feedback.submitted_by` (2 newly nullable) + the **10** already-nullable attributive columns (12)                                                                                                                                                                                | Audit integrity forbids reassigning `actor_id` (it would attribute one admin's action to another). `feedback` is personal input to Monolith, erasable — `feedback_select` already falls back to `is_platform_admin()`. The 10 attributive columns need only the FK action changed.                                                                                                                                                    |

12 + 1 + 1 + 12 = 26. ✓ (13 of them reassigned by the RPC, so 13 stay
`NOT NULL`/`NO ACTION` — verified live: `no action` went 26 → 13.)

Ordering inside one transaction: **reassign → cascade-eligible rows are removed by the
delete itself → the `SET NULL` FKs fire on delete.** The `NOT NULL` reassign columns keep
`NO ACTION` deliberately (§3.2).

### 3.1 Why this is the right call: the churn is ~zero, not "manageable"

This is the strongest argument and it is quantitative. Flipping 26 columns to nullable, as
the vault note proposed, forces:

- **16 columns** from `string` → `string | null` in `src/types/database.types.ts`, cascading
  into **~18 consumer files** — `src/lib/boards/queries.ts`, `queries-cached.ts`
  (`:61` feeds a possibly-null id into `.in()`, `:72` an unguarded `Map.get`),
  `trash-queries.ts`, `actions/board.ts`, `src/lib/goals/queries.ts` (`:20` declares
  `owner_id: string` and `:114` _casts_ the DB row into it), `src/lib/goals/patch.ts:40`
  (unguarded `owners.get(row.owner_id)`), `src/lib/platform/queries.ts:105`,
  `src/lib/feedback/actions.ts:118,124`, `src/lib/portfolios/queries-cached.ts`,
  `src/lib/collaboration/actions.ts`, `src/lib/boards/mutations/files.ts:86`
  (`uploaded_by: user?.id ?? ""` — an existing `""` sentinel lying about non-nullness),
  `src/lib/workspaces/actions.ts`, `src/lib/reports/actions.ts`, plus
  `FilesTab.tsx:141,155`, `AttachmentRow.tsx:28`, `AttachmentCard.tsx:40`,
  `UpdatesTab.tsx:151`.
- **15 RLS policies** and **5 `SECURITY DEFINER` functions** (`readable_board_ids`,
  `can_edit_board`, `can_edit_goal`, `can_edit_portfolio`, `is_board_member`) rewritten —
  and rewriting them means **inventing a new ownership model** (an explicit `board_owner`
  grant row and a backfill), because once `created_by` can be null there is nothing left to
  key on. That is a separate epic, not a task in this one.

The hybrid instead:

- **2 columns** become nullable (`admin_audit_log.actor_id`, `feedback.submitted_by`) →
  **2 files** to fix (`src/lib/platform/queries.ts:105` — a one-line type widening;
  `src/lib/feedback/actions.ts:118,124` — one null guard before a `notifications` insert).
- **0 RLS policy changes. 0 `SECURITY DEFINER` function changes. 0 ownership-model changes.**
- The 10 already-nullable columns are typed `string | null` in `database.types.ts`
  _today_, so changing their FK action is a **zero-diff** type change (FK actions are not
  represented in generated types).
- The display sites already degrade correctly: `AttachmentRow.tsx:28`,
  `AttachmentCard.tsx:40` and `UpdatesTab.tsx:151` all resolve names via
  `members.find(…) ?? "Someone"`, and `src/lib/boards/trash-queries.ts:69,87-89` is a
  working precedent for a nullable `archived_by`.

**Blast radius: ~18 files + 20 database objects → 2 files + 0 database objects.** That is
the decision.

### 3.2 Keeping `NO ACTION` on the reassign columns is a feature

Because those 13 columns stay `NOT NULL`/`NO ACTION`, deletion **only** succeeds if the
reassignment RPC has emptied every one of them first. If a future migration adds a new
authorship column and nobody updates the RPC, deletion fails **loudly** with a named
constraint, instead of silently orphaning data. That is the better failure mode, and §8.2
turns it into an automated, schema-driven test rather than a hope.

It paid for itself immediately — see §3.3.

### 3.3 Found during the build: two freeze triggers make the reassignment a silent no-op

**This is the one thing neither this spec nor the plan predicted**, and it would have
shipped the feature broken. Two `BEFORE UPDATE` triggers exist precisely to make
attribution immutable:

| Trigger function                          | Migration                                   | Effect                             |
| ----------------------------------------- | ------------------------------------------- | ---------------------------------- |
| `public.items_protect_creation_metadata`  | `20260625120000_item_created_by`            | `new.created_by := old.created_by` |
| `public.item_updates_protect_attribution` | `20260704111000_item_updates_freeze_author` | `new.author_id := old.author_id`   |

They rewrite the NEW row back to OLD, so `update public.items set created_by = <owner>`
reports `row_count = 1` **and changes nothing**. The delete then dies on
`items_created_by_fkey` / `item_updates_author_id_fkey` — i.e. §3.2's tripwire is what
caught it, exactly as designed.

They are genuine hardening (they stop a board editor re-attributing someone else's comment
through the raw REST/RLS surface), so they are **not** relaxed. Migration
`20260725103609_account_deletion_reattribution_triggers` gives each one branch that opens
only when **three** things hold at once:

1. `pulse.reassigning_authorship` is `'on'` — a **transaction-local** GUC
   (`set_config(…, is_local => true)`) set by exactly one function,
   `user_delete_reassign_authorship`, and cleared before it returns. A client cannot set
   it: PostgREST only calls functions in the exposed schema, and `set_config` lives in
   `pg_catalog`, so there is no reachable entrypoint; being transaction-local it also
   cannot leak onto a pooled connection.
2. The column is actually changing.
3. The NEW value is a legal target **for that row** — an active `owner` of the row's own
   org for `items`, and the platform bot and nothing else for `item_updates`.

Condition 3 is the real protection: even a forged flag can only reproduce the exact
transition account deletion performs, never "re-attribute Bob's comment to me". Every other
frozen column (`items.created_at`, `item_updates.org_id`/`board_id`/`item_id`) stays frozen
on the sanctioned path too, so the hole is authorship-only and cannot move a row between
boards or orgs.

The same migration also skips the two embed-enqueue triggers during reassignment: a pure
re-attribution changes no embeddable text, so re-embedding a departing member's whole
back-catalogue would spend tokens producing identical vectors.

`account_deletion_reattribution_frozen_columns()` turns this into a schema assertion too, so
the _next_ freeze trigger someone adds cannot silently re-break deletion (§8.2).

### 3.4 The nullable-`created_by` precedent

`src/lib/ai/agentic/board-agents-db.ts:28` already declares `created_by: string | null`,
selects it, and **never reads it for authorization** — authority comes from RLS, and the
acting principal from a separate SQL resolver (`platform_agent_user_id()`,
`:150-159`, typed `string | null`). That is precisely the discipline the 12 `SET NULL`
columns follow here.

## 4. Architecture

### 4.1 `public.user_delete_reassign_authorship(p_user_id uuid) returns jsonb`

One new `SECURITY DEFINER` function, `set search_path = ''`, the single seam where
authorship moves.

- **Gate:** `is_platform_admin() OR p_user_id = (select auth.uid())` — the same shape as
  the existing definer RPCs, and the only self-serve concession.
- **Grants:** `revoke all from public, anon` → `grant execute to authenticated,
service_role`. Required by
  `src/lib/supabase/function-execute-grants.integration.test.ts` and
  `20260704114000_definer_execution_lockdown_hygiene.sql`.
- **Target resolution is per-org, not global.** A user in three orgs gets three different
  targets. For each `org_id` the user belongs to:

  ```sql
  select user_id from public.org_members
  where org_id = <org> and role = 'owner' and deactivated_at is null
    and user_id <> p_user_id
  order by created_at asc limit 1
  ```

  Every reassignment `UPDATE` therefore joins on the row's own `org_id`. Rows with no org
  context (`feedback`, `admin_audit_log`) are not reassigned — they are `SET NULL` columns.

- **Returns** a `jsonb` summary (`{"boards": 8, "items": 276, …, "targets": {"<org>": "<uuid>"}}`)
  for the audit `metadata` and for the tests to assert against.
- **Raises** if any org in scope has no eligible target — a belt-and-braces backstop behind
  the sole-owner guard, so the function can never half-reassign.

### 4.2 Reuse: widen the existing sole-owner RPC, don't clone it

`platform_user_sole_owned_orgs(p_user_id uuid)`
(`supabase/migrations/20260619250000_platform_user_sole_owned_orgs.sql`) already returns the
orgs where the user is the only active owner, and `platformDeleteUser:228-236` already turns
that into `fail("Reassign ownership first — sole owner of: …")`. Its gate is
`if not public.is_platform_admin() then raise`, which a self-serve caller cannot pass.

**Widen the gate to `is_platform_admin() OR p_user_id = (select auth.uid())`** rather than
adding a `user_sole_owned_orgs()` sibling. Per AGENTS.md ("grep before writing a helper")
this is one `create or replace`, and both paths then share one definition of "sole owner".
`leaveOrg` (`src/lib/org/actions.ts:98-102`) hand-rolls the same refusal via
`rpc("get_org_members")` — out of scope to unify, noted for a follow-up.

### 4.3 `deleteOwnAccount` — new server action, `src/lib/account/actions.ts`

Mirrors `platformDeleteUser` step for step; the differences are all about _self_:

|               | `platformDeleteUser` (admin)     | `deleteOwnAccount` (self)                                                 |
| ------------- | -------------------------------- | ------------------------------------------------------------------------- |
| Authorization | `isPlatformAdmin()`              | authenticated; **actor === target** by construction                       |
| Self-delete   | explicitly refused (`:225`)      | the whole point                                                           |
| Confirmation  | type the target's email (client) | type **your own** email, re-verified **server-side** against `user.email` |
| Sole-owner    | `fail(...)`                      | `fail(...)` with a link to `/settings/members`                            |
| Session       | untouched                        | **must be torn down** (§4.4)                                              |
| Audit actor   | the admin, retained              | the user, `SET NULL` on delete; `actor_kind = 'user'`                     |
| Revalidation  | `revalidatePath("/admin/users")` | `redirect("/login?deleted=1")`                                            |

Sequence — Zod (`deleteAccountSchema = z.object({ confirmEmail: z.string().email() })`) →
`getUser()` → `confirmEmail.toLowerCase() !== user.email?.toLowerCase()` ⇒
`fail("That's not your email address.")` → `rpc("platform_user_sole_owned_orgs", { p_user_id: user.id })`
⇒ `fail` if non-empty → **service client** from here → `rpc("user_delete_reassign_authorship")`
→ write audit rows (§4.5) → `svc.auth.admin.deleteUser(user.id)` → tear down session →
`redirect`.

Returns `ActionResult` from `src/lib/actions/result.ts` on every failure path (never a
thrown error), so the dialog can render the reason in place.

### 4.4 Session teardown

Supabase access tokens are stateless JWTs — deleting the `auth.users` row does not
invalidate an already-issued token, it only revokes the refresh token. So:

1. `svc.auth.admin.deleteUser(user.id)` — cascades `auth.sessions` and `auth.identities`
   (verified `cascade`), revoking refresh tokens.
2. `await supabase.auth.signOut()` on the **SSR** client, wrapped in `try/catch` (GoTrue may
   answer 401 for a now-nonexistent user) — this is what clears the cookies; the cookie
   adapter in `src/lib/supabase/server.ts` handles it, exactly as `signOut()` in
   `src/app/auth/actions.ts:219-223` does. No hand-rolled cookie clearing.
3. `redirect("/login?deleted=1")`.

Any residual cookie is harmless: `requireUser()` / `getUser()` fails against the deleted
row and bounces to `/login`. This is why the `signOut` must come **after** the delete — the
action needs an authenticated context to reach step 1.

### 4.5 What the organization sees afterwards

Content stays; the "created by" name becomes the receiving owner's. That must not be
invisible, so the RPC's caller writes **one `admin_audit_log` row per affected org**:

```
org_id = <org>, actor_id = <the user>, actor_kind = 'org',
action = 'account.self_deleted', target_user_id = <the user>,
target_email = <the deleted email>, metadata = <per-table reassignment counts + targets>
```

The row is written **before** the delete, with both user pointers populated; the new
`SET NULL` FKs blank them as the `auth.users` row goes. Written afterwards it would fail its
own FK. `target_email` is what survives (decision D1).

**Correction found during the build:** `actor_kind` carries a CHECK constraint
`actor_kind = any (array['org','platform'])`, so this spec's original `'user'` would have
failed at runtime on every deletion. Per-org rows use `'org'`; the platform-level row
(`org_id = null`) uses `'platform'`, matching `platformDeleteUser`.

`admin_audit_log`'s `SELECT` policy is
`(org_id is not null and has_org_role(org_id, owner|admin)) or is_platform_admin()`, so org
owners and admins see it in their existing audit view (`/settings/members` → activity) with
**zero new UI**. A platform-level row (`org_id = null`) is written too, matching
`platformDeleteUser:241-249`.

**Decision D4 (built):** the audit row is passive, so each receiving owner also gets a
`notifications` row — `kind = 'account_deleted'`, `actor_id = null` (system-authored, legal
because the column is nullable), `payload = { deletedEmail, counts }`. It reuses the existing
bell UI and lands the reader on `/settings/members`, where the matching audit row already
renders. Written **after** the delete, best-effort: the recipient is a surviving user, so
nothing here references the erased row.

## 5. UI

`src/app/(app)/settings/security/page.tsx:45-55` already renders a
`SettingsSection title="Danger zone"` holding one `SettingRow` for "Leave organization".
Add a **second** `SettingRow` after it. No new page, no new route.

```tsx
<SettingRow
  label="Delete account"
  description="Permanently delete your Pulse account and personal data. Boards, items and updates you created stay with your organization."
>
  <DeleteAccount email={user.email ?? ""} />
</SettingRow>
```

`src/components/settings/delete-account.tsx` — new client component, `email: string` its
only prop. It follows the **type-to-confirm** precedent from
`src/components/admin/user-row-actions.tsx:166-209` (a `Dialog`, not an `AlertDialog`,
because the confirm input needs focus management), reusing the shadcn `<Input>` form of it
from `src/components/workspaces/WorkspaceNavItem.tsx:140-145`:

- `Button variant="outline" size="sm"` with
  `className="text-destructive border-destructive/40 hover:bg-destructive/10"` — matching
  the sibling "Leave organization" trigger in `danger-zone.tsx:52-60` exactly, so the two
  rows read as one section.
- Dialog title "Delete your account?"; description states plainly what is erased (name,
  email, avatar, notifications, time entries) and what stays (boards, items, updates, now
  attributed to an org owner). Honesty here is the whole UX.
- `<Input placeholder={email} aria-label="Type your email address to confirm deletion" />`;
  the confirm button is `disabled={pending || confirm.trim().toLowerCase() !== email.toLowerCase()}`.
- `variant="destructive"`, label "Delete permanently" / "Deleting…".
- Failures render **in place** via `<p role="alert" className="text-destructive text-xs">`
  (as `user-row-actions.tsx:183-187` does) — not a toast, because the sole-owner refusal is
  a paragraph the user must read and act on.
- `e.preventDefault()` in the action handler to keep the dialog mounted during the
  transition — the pattern already used at `danger-zone.tsx:74-78`.

Keystone conformance: semantic tokens only (`text-destructive`, `bg-surface`, hairline
`border` that brightens on hover — never thickens), `rounded-lg` dialog, `size-4` lucide
icons, keyboard-reachable with a visible `focus-visible` ring, and the destructive state
carried by **text plus placement**, not colour alone.

Deliberately **not** built: a grace period / soft-delete-and-restore, a data export, an
email confirmation link, or a reason-for-leaving survey. YAGNI — all four are separable
follow-ups, and none of them is what "the FK blocker" was blocking.

## 6. Performance & data-fetching budget (working agreement #5)

**(a) First paint vs. interaction.** Zero new first-paint cost: the new `SettingRow` reads
`user.email`, which `security/page.tsx:14` already has from `requireUser()`. Opening the
dialog, typing the confirmation, and enabling the button are **0 server round-trips** —
local `useState` in a leaf client component. No `<Link>`, no `router.push`, no
`searchParams`, so no RSC re-run (gotcha-09).

**(b) Does the interaction change server data?** Only on submit — one Server Action, then a
`redirect`. There is no in-page state to revalidate afterwards because the session ends;
`revalidatePath` would be meaningless and is deliberately omitted.

**(c) Is the hot-path read bounded over indexed columns?** The sole-owner RPC is two
bounded lookups over `org_members` keyed on indexed `(org_id, user_id)`.

The reassignment `UPDATE`s are the real cost, and **9 of the 26 target columns have no
leading index today** — measured:

| Column                               | Leading index | Est. rows                   |
| ------------------------------------ | ------------- | --------------------------- |
| `items.created_by`                   | **NONE**      | 402 (fastest-growing table) |
| `items.archived_by`                  | **NONE**      | 402                         |
| `groups.archived_by`                 | **NONE**      | 37                          |
| `boards.archived_by`                 | **NONE**      | 10                          |
| `goals.created_by`, `goals.owner_id` | **NONE**      | 0                           |
| `member_capacity.created_by`         | **NONE**      | 1                           |
| `feedback.responded_by`              | **NONE**      | 5                           |
| `board_agents.created_by`            | **NONE**      | —                           |

The other 17 are covered (`items_activities_actor_id_idx` over 2 112 rows,
`boards_created_by_idx`, `attachments_uploaded_by_idx`, …). Unindexed, the RPC sequential-scans
`items` **twice** per deletion, and that table only grows. **The migration adds the 9
missing indexes**, so every statement in the RPC is an index scan on the FK column. Deletion
is a rare, user-initiated, single-transaction operation with no hot path — but it must not be
`O(table)` on the org's largest table.

## 7. GDPR / erasure position

Separating _identity_ from _work product_ is what makes the hybrid defensible.

**Erased** (all via existing `cascade`, verified): `profiles` (full name, email, avatar
URL), `notification_preferences`, `ai_conversations`, `user_ai_credentials`, `oauth_tokens`,
`oauth_codes`, `org_members`, `board_members.user_id`, `time_allocations`,
`member_capacity.user_id`, `platform_admins`, plus every `auth.*` record (identities, MFA
factors, sessions, WebAuthn credentials, one-time tokens). Newly erased by this spec:
`time_entries` (cascade) and the `actor_id`/`submitted_by`/attributive pointers (`SET NULL`).

**Retained:** boards, items, item updates, attachments, goals, portfolios, dashboards — the
organization's records, with the authorship pointer moved to a different data subject. Under
GDPR Art. 17 the erasure right covers the individual's personal data, not the controller's
business records; reparenting an `owner` pointer to a surviving account is the standard
orphaned-record pattern and retains **no identifier** of the erased person. Content the user
_wrote_ (an item update body) is retained as org record — Monolith's Terms should say so, which
is a legal-copy task, not a code task.

**Two genuine gaps**, both in scope:

1. **`admin_audit_log.target_email` retains the email in plaintext.** That is personal data,
   and no FK touches it. See decision point **D1**.
2. **The avatar file in Storage is orphaned, not deleted.** `storage.objects` has **no** FK
   to `auth.users` in this project (verified), so nothing removes it; `profiles.avatar_url`
   cascades away and leaves an unreferenced image addressable by anyone who kept the URL.
   `deleteOwnAccount` must explicitly `svc.storage.from("avatars").remove([...])` for the
   user's prefix **before** the delete. Best-effort and logged — a Storage failure must not
   abort the deletion.

## 8. Testing (working agreement #4, TDD)

### 8.1 Unit (Vitest, no DB)

- `delete-account.test.tsx` — the confirm button is disabled until the typed email matches
  (case-insensitively, trimmed); a `fail` result renders in place via `role="alert"` and the
  dialog stays open; success does not re-enable the button. Model on the existing
  `src/components/settings/danger-zone.test.tsx`.
- `src/lib/account/actions.test.ts` — Zod rejection; email-mismatch refusal **server-side**
  even when the client sends a matching payload for a different address.

### 8.2 Schema-conformance test (the tripwire for §3.2)

A test that queries `pg_constraint` for every `NOT NULL` + `NO ACTION` FK to `auth.users`
and asserts each one is covered by `user_delete_reassign_authorship`'s statement list. A
future migration that adds an authorship column fails this test instead of silently breaking
deletion in production. This is the highest-value test in the spec.

**Built in two halves, because a skipped test is not a passing test.** Integration suites
skip without `.env.test` (the repo default that keeps DEV clean), which would have left the
most important assertion in this spec unexecuted on most machines and in CI:

| Test                                          | Needs a DB? | Asks                                                                               |
| --------------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `account-deletion-schema.integration.test.ts` | yes         | Are these still the columns that exist? (live `pg_constraint`)                     |
| `account-deletion-rpc-coverage.test.ts`       | **no**      | Does the RPC handle the columns we believe exist? (parses the committed migration) |

The second runs in every `pnpm test`, covers the other direction of drift, and also pins
decision D2's principal and the §3.3 GUC handshake. Both were verified live against DEV via
the `supabase-dev` MCP: `account_deletion_blocking_fks()` returns exactly the 13 expected
columns, and `account_deletion_reattribution_frozen_columns()` exactly the 2 handled freezes.

### 8.3 Integration (`*.integration.test.ts`, skips without `.env.test`)

Model on `src/lib/org/admin.rls.integration.test.ts:50,76` (`createUser` + `provisionOrg`
are the most complete factories in the repo; there is no shared factory to reuse).

1. **Happy path** — user B in A's org, B creates a board + items + an update; delete B;
   assert the `auth.users` row is gone, the board's `created_by` is now A, A still resolves
   as `"owner"` via `getBoardAccess`, and the items are still readable by A.
2. **The §2.1 regression guard** — the reassigned board must still be returned by
   `readable_board_ids()` for A **when A has no `board_members` row for it**. This is the
   single test that would have caught the `SET NULL` design.
3. **Sole-owner blocked** — a sole-owner's delete returns `fail` naming the org, and
   _nothing_ was mutated (`auth.users` row intact, authorship untouched). Asserting the
   no-partial-mutation half matters as much as the refusal.
4. **Cross-tenant / RLS** — a second, unrelated org's boards, items and `org_members` are
   byte-for-byte unchanged; and a non-admin calling
   `user_delete_reassign_authorship(<someone else's id>)` is refused by the gate. Pairs with
   `src/lib/cache/cross-tenant-isolation.integration.test.ts` and
   `src/lib/supabase/function-execute-grants.integration.test.ts`.
5. **`platformDeleteUser` now works** — the regression test for the §1 corollary. There is no
   existing coverage of it (`src/lib/platform/platform.integration.test.ts` covers the gate
   and search RPCs, not delete), which is why the bug shipped.

## 9. Decision points for the owner — ALL RESOLVED

Real product/legal judgments, not implementation gaps. The owner delegated all four; the
resolutions below are what was **built**:

| #      | Resolved as                                                                               | Where                                                                                   |
| ------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **D1** | (a/b) retain `target_email`; purge window is a **documented follow-up, not built**        | `src/lib/account/actions.ts` audit block                                                |
| **D2** | **(b) the platform bot inherits the words** — the recommendation, not the simpler default | migration `…103609` Part G; §3 table; pinned by `account-deletion-rpc-coverage.test.ts` |
| **D3** | (a) `time_entries` cascades                                                               | migration `…102934` Part C                                                              |
| **D4** | **(b) the receiving owner is notified**                                                   | `account_deleted` notification kind + `NotificationsList`/`NotificationsBell` (§4.5)    |

### 9.0 Follow-ups deliberately NOT built

- **D1's purge window** for `admin_audit_log.target_email` (e.g. 90 days). Retained
  indefinitely today.
- Unifying `leaveOrg`'s hand-rolled sole-owner refusal (`src/lib/org/actions.ts`) onto
  `platform_user_sole_owned_orgs` (§4.2).
- Grace period / soft-delete-and-restore, data export, email-confirmation link, and a
  reason-for-leaving survey (§5) — all separable, none of them what the FK blocker blocked.

The original analysis of each decision is kept below for the record.

**D1 — `admin_audit_log.target_email` after erasure.** The audit row survives with both user
pointers nulled but the email in plaintext.
_Options:_ (a) retain indefinitely; (b) retain, with a documented purge window (e.g. 90
days) implemented later; (c) store a salted hash instead, keeping "did this account exist"
answerable without keeping the address.
**Recommendation: (b)** — retain now, ship the purge as a follow-up. Anti-abuse and
"was this account deleted?" support questions both need the address, and (c) breaks the
existing admin audit view which renders `target_email` directly. **Default if no answer: (b).**
**→ BUILT AS (b):** retained in plaintext. The purge window is a documented follow-up (§9.0)
and was deliberately **not** implemented.

**D2 — `item_updates.author_id`: who inherits the words?** Currently specified as reassign to
a surviving org owner, which also hands them the `author_id = auth.uid()` edit/delete gate
over text they did not write.
_Options:_ (a) reassign to the org owner (specified); (b) reassign to the bot principal
`pulse-autopilot` — honest ("not attributable to a person any more"), and safe here
_because_ `item_updates` is gated by `author_id = auth.uid() OR can_edit_board(board_id)`,
so board editors retain control regardless — unlike `boards.created_by`, this column is not
load-bearing for visibility; (c) delete the updates outright.
**Recommendation: (b), the bot.** It is the most truthful attribution, grants nobody
authority over another person's words, and reuses the principal
`20260720120517_board_agents.sql` already ships. It is also the one place the scout's
bot suggestion genuinely fits. This differs from §3's table and is the change I would
make first. **Default if no answer: (a)**, as specified, since it is strictly simpler.
**→ BUILT AS (b), the bot.** §3's table and migration `…103609` Part G now agree; the
principal is pinned by a unit test so it cannot silently regress to the owner.

**D3 — `time_entries` cascade deletes the org's time data.** Specified as cascade, matching
`time_allocations`/`member_capacity`. If Monolith ever bills or reports on historical time,
losing a departed member's entries is a business-data loss.
_Options:_ (a) cascade (specified); (b) keep the rows and null `user_id`, losing per-person
attribution but keeping totals — costs one nullable column and one guard.
**Recommendation: (a)** — time entries are personal records, no billing feature exists today,
and reporting on an anonymous bucket is misleading. Revisit if time-based billing ships.
**Default: (a).** **→ BUILT AS (a), cascade.**

**D4 — should the receiving org owner be notified?** The audit row (§4.5) is passive; owners
see it only if they open the audit view.
_Options:_ (a) audit row only (specified); (b) also insert a `notifications` row per
affected org owner, reusing the existing table and bell UI.
**Recommendation: (b)** — inheriting ownership of someone else's boards is exactly the kind
of thing that should surface, the plumbing already exists, and `notifications.actor_id` is
nullable so a system-authored row is legal. **Default: (a)**, to keep the first cut small.
**→ BUILT AS (b).** New `notification_kind` value `account_deleted`, one row per affected org
addressed to the receiving owner, with copy in `NotificationsList` and a click-through to
`/settings/members` where the matching audit row already renders.

## 10. Independent units (for the execution DAG)

Pieces with no shared state and no sequential dependency, so the plan can schedule them
concurrently:

- **DB migration** — 26 FK actions + 2 nullability changes + 9 indexes + the reassignment
  RPC + the widened sole-owner gate. One migration file; the root of the DAG.
- **Type regeneration + the 2 consumer fixes** (`platform/queries.ts`,
  `feedback/actions.ts`) — depends only on the migration.
- **Server action** (`src/lib/account/actions.ts` + Zod schema + Storage avatar cleanup) —
  depends on the RPC's signature, not on the UI.
- **UI component** (`delete-account.tsx` + its unit test) — depends only on the action's
  _exported signature_, so it can be built against a stub in parallel.
- **Settings page wiring** — trivially depends on the component.
- **Schema-conformance test** — depends on the migration only; independent of all TS.
- **Integration suite** — depends on the migration + the action.
- **`platformDeleteUser` regression test** — depends on the migration only; fully parallel to
  everything self-serve.
