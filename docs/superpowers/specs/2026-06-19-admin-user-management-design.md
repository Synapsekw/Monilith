# Admin user management — design

**Date:** 2026-06-19
**Status:** Approved (brainstorming) — ready for implementation plan
**Area:** Platform admin console (`/admin`) + app sidebar

## Summary

Two pieces of admin work:

1. **Sidebar reorder** — move the platform-admin nav section to the bottom of the
   sidebar so the user's primary nav (Goals, Portfolios, Inbox, Workspaces) sits
   above it.
2. **Per-user actions dropdown** on the admin Users page (`/admin/users`) giving a
   platform admin four operations per user: send password reset email, set a
   temporary password (forces change at next login), suspend/reactivate, and hard
   delete.

Most backend building blocks already exist (service-role client, `is_platform_admin()`
gate, `admin_audit_log`, ban via `updateUserById`, org-level `resetMemberPassword`
pattern). This work mostly composes existing patterns plus one new RPC and one
auth-gate enforcement step.

## Context (current state)

- `src/components/sidebar.tsx` renders, top→bottom: Brand → `BoardsNav` →
  `DashboardsNav` → `PlatformNav` (admin) → Goals/Portfolios/Inbox placeholder nav →
  Workspaces list. The admin section is currently **above** the user nav.
- `src/components/platform/PlatformNav.tsx` — admin links, hidden unless
  `isPlatformAdmin`.
- `src/app/admin/users/page.tsx` — server component; `searchUsers()` →
  `platform_search_users` RPC; rows expose `{ id, email, bannedUntil, orgNames }`;
  page size 25.
- `src/components/admin/user-row-actions.tsx` — client component, currently just
  Ban/Unban buttons calling `platformDeactivateUser` / `platformReactivateUser`.
- `src/lib/platform/actions.ts` — `platformDeactivateUser`/`platformReactivateUser`
  (ban via service-role `auth.admin.updateUserById`), each writing an
  `admin_audit_log` row with `actor_kind:'platform'`. `BAN_FOREVER = "876000h"`.
- `src/lib/org/admin-actions.ts` — `resetMemberPassword` is the reference pattern for
  a password-reset email (service-role `getUserById` → `auth.resetPasswordForEmail`).
- `src/lib/supabase/service.ts` — service-role client (`createServiceClient`), used
  for auth admin ops; server-only.
- `src/lib/platform/guard.ts` — `isPlatformAdmin()` / `requirePlatformAdmin()`.
- `src/lib/validations/admin.ts` — Zod schemas incl. `platformUserTargetSchema`.

## Decisions (locked during brainstorming)

- **Delete + sole-owned orgs:** **block & warn.** Refuse to delete a user who is the
  only active owner of any org; return the offending org names so the admin can
  reassign ownership or delete the org first.
- **Temp password:** **admin types it** in a dialog; we set it via
  `updateUserById`. Shown once; admin relays it out-of-band.
- **Force change:** **yes** — after a temp password is set, the user must change it at
  next login.
- **Suspend:** **reuse the existing ban** mechanism (`platformDeactivateUser` /
  `platformReactivateUser`); surface as Suspend/Reactivate in the dropdown.

## Part A — Sidebar reorder

In `src/components/sidebar.tsx`, change render order to (top→bottom):

Brand → `BoardsNav` → `DashboardsNav` → Goals/Portfolios/Inbox nav → Workspaces list
→ **`PlatformNav` pinned to the bottom via `mt-auto`**.

- Wrap `PlatformNav` (or apply to its outer element) with `mt-auto` so the admin
  section sits at the very bottom of the flex column, visually separated from the
  primary nav.
- Boards/Dashboards stay at the top (primary working surfaces; not part of the ask).
- Preserve collapsed-mode rendering/tooltips.
- No data fetching changes — pure layout.

## Part B — Per-user dropdown

Replace the Ban/Unban buttons in `src/components/admin/user-row-actions.tsx` with a
shadcn `DropdownMenu` (⋯ trigger) per row containing, in order:

1. **Send password reset email** — fires immediately; toast on result.
2. **Set temporary password…** — opens a `Dialog`; admin types a password
   (client-side min-length hint matching the Zod rule); on save → flag user
   must-change-at-next-login; toast.
3. **Suspend** / **Reactivate** — single toggle item chosen by `bannedUntil`
   (suspended when `bannedUntil` is in the future). Reuses existing actions.
4. **Delete user…** — destructive item, separated at the bottom; opens a confirm
   `Dialog` that requires typing the user's exact email to enable the confirm button.
   On block-&-warn failure, the dialog shows the returned org names and the action is
   refused.

State/UX:

- Dialogs are local client state — **0 server round-trips** until an action is
  confirmed (satisfies the in-page-state invariant).
- Each successful action calls `router.refresh()`; server actions also
  `revalidatePath('/admin/users')` and `/admin`.
- Pending states disable the trigger/confirm; errors surface as toasts (or inline in
  the dialog for delete).

## Part C — Server actions & validation

All new actions live in `src/lib/platform/actions.ts`, follow the existing
`ActionResult` shape, gate on `isPlatformAdmin()` (and `auth.getUser()` for the
actor), and write an `admin_audit_log` row (`org_id:null`, `actor_kind:'platform'`,
`target_email` captured) on success.

| Action                             | Implementation                                                                                                                                                                                                                  | Audit `action`                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `platformResetUserPassword(input)` | parse `platformUserTargetSchema` → service-role `getUserById` for email → `supabase.auth.resetPasswordForEmail(email)`                                                                                                          | `platform.user_password_reset` |
| `platformSetUserPassword(input)`   | parse `platformSetPasswordSchema` → service-role `getUserById` to read current `app_metadata` → `auth.admin.updateUserById(id, { password, app_metadata: { ...existing, must_change_password: true } })` (merge, don't clobber) | `platform.user_password_set`   |
| `platformDeleteUser(input)`        | parse `platformUserTargetSchema` → call `platform_user_sole_owned_orgs(id)`; if it returns rows → `fail` with the org names; else write audit row (email captured first) → `auth.admin.deleteUser(id)`                          | `platform.user_deleted`        |
| Suspend / Reactivate               | **reuse** existing `platformDeactivateUser` / `platformReactivateUser`                                                                                                                                                          | (existing)                     |

Validation (`src/lib/validations/admin.ts`):

- New `platformSetPasswordSchema` = `{ userId: uuid, password: string min 8 }`.
- Reset & delete reuse `platformUserTargetSchema`.

Error mapping: friendly, non-leaking copy (mirror existing helpers). Delete returns a
distinct message containing the blocking org names.

## Part D — Supporting pieces

### D1. Sole-owner check (migration)

New versioned migration adding a `SECURITY DEFINER` RPC:

```
platform_user_sole_owned_orgs(p_user_id uuid)
  returns table(org_id uuid, org_name text)
```

- Gated internally by `is_platform_admin()` (raise/empty on non-admin, consistent
  with other platform RPCs).
- Returns one row per org where the target is an **active** owner
  (`org_members.role = 'owner'` and not deactivated) **and** that org's count of
  active owners = 1.
- After applying: `pnpm db:types` and commit regenerated `database.types.ts` in the
  same PR.

### D2. Force-change-password enforcement

- **Flag:** `auth.users.app_metadata.must_change_password = true`, set by
  `platformSetUserPassword`.
- **Enforcement:** the authenticated app gate redirects any logged-in user carrying
  the flag to a change-password screen; on a successful password change the flag is
  cleared (`app_metadata.must_change_password = false`, merged).
- **Planning task:** locate the existing auth gate (middleware and/or authenticated
  root layout) and the existing reset/update-password page under `src/app/auth/` or
  `(auth)`. **Reuse** them rather than building new surfaces. The exact wiring is the
  one item to confirm against the code at plan time. If no suitable update-password
  page exists, the plan adds a minimal one.

## Testing

- **Vitest unit tests** for each new action with mocked `createClient` /
  `createServiceClient`: not-authenticated, not-authorized, invalid input, success +
  audit row written, error mapping, and `platformDeleteUser` block-&-warn path
  (RPC returns orgs → no `deleteUser` call).
- **Schema tests** for `platformSetPasswordSchema` (min length, uuid).
- **Sidebar / dropdown:** typecheck + lint cover structure; a lightweight component
  render test for the dropdown items if it fits the existing test setup.
- **Full gate (mandatory, must pass):** `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`.

## Performance & data-fetching budget

- Sidebar reorder: layout only, no new reads.
- Dropdown: in-page dialogs are client state → **0 server round-trips** on
  open/close; server actions run only on confirm, each with targeted
  `revalidatePath`. No `<Link>`/router navigation for view toggles.
- Users page read is already bounded (page size 25 via `platform_search_users`).

## Execution DAG (for the plan)

Independent units (can run concurrently):

- **A** Sidebar reorder (`sidebar.tsx`) — no deps.
- **D1** Sole-owner RPC migration + `db:types` — no deps.
- **C-val** `platformSetPasswordSchema` in validations — no deps.

Dependent:

- **C-actions** new server actions — depends on **C-val** (set-password schema) and
  **D1** (delete needs the RPC).
- **B** dropdown component — depends on **C-actions** (action signatures).
- **D2** force-change enforcement — depends on **C-actions** (the flag is set there)
  and on locating the auth gate; otherwise independent of A/B.

Critical path: **C-val → C-actions → B**. Batch 1: {A, D1, C-val}. Batch 2:
{C-actions} (after D1, C-val). Batch 3: {B, D2}.

## Out of scope

- Bulk/multi-select user actions.
- Org-level (non-platform) versions of these actions beyond what already exists.
- Email template customization for reset emails.
- Self-service password change UX redesign (we reuse the existing page).
