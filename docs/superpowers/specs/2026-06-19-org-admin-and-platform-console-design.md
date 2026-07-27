# Org Admin Console + Platform Super-Admin — Design

- **Date:** 2026-06-19
- **Status:** Approved (brainstorming) — pending implementation plan
- **Author:** danijel + Claude
- **Phase:** Cross-cutting (extends Phase 1 — Auth & tenancy)

## 1. Summary

Monolith has a role enum (`owner / admin / member / guest`) and RLS that gates org
mutations to owners/admins, but **no admin operations exist** — the Settings page only
edits org name (read-only) + timezone. There is also no platform-level oversight.

This adds **two surfaces**:

1. **Platform super-admin** (a single bootstrapped account — `danijel@synapse-solutions.ai`):
   a **cross-organization** role above every org. Sees all orgs, assigns/revokes each
   org's admins, and runs account recovery on any user. Full control of the application.
2. **Org admin console** (per-org): an org's own owners/admins manage **their** members,
   invitations, account recovery, and an audit log — strictly inside their tenant.

The platform layer is a thin, heavily-guarded tier built on top of the org layer; they
share the member-list / role / recovery / audit machinery.

## 2. Goals / Non-goals

**Goals**

- A working org admin console: member list + role management, email invitations,
  admin-triggered password reset, org-scoped deactivation, and an audit log.
- A platform super-admin console: all-orgs view, assign/revoke org admins anywhere,
  global user lookup, global deactivation (ban), platform audit feed.
- Keep **RLS as the security boundary**; the cross-tenant super-admin path is a separate,
  explicitly-guarded mechanism that never weakens org isolation for normal users.

**Non-goals (YAGNI — noted as possible future work)**

- SSO / SCIM provisioning.
- Bulk CSV member import.
- A bespoke ownership-_transfer_ flow (use promote-then-demote).
- Board/item-level permission scoping; guest-specific rules beyond the role.
- Login-as / impersonation.
- Email digests of admin activity.
- Billing / seat enforcement (already a PRD non-goal).

## 3. Critical architectural note — cross-tenant boundary

A platform super-admin **deliberately breaks** the repo's hardest invariant —
_"RLS is the security boundary — default-deny, org-scoped, no cross-tenant access."_

Consequences baked into this design:

- The super-admin is **not** a row in `org_members` (that table is org-scoped). It is a
  separate identity in a dedicated `platform_admins` table.
- Cross-tenant operations run through a **separate set** of `SECURITY DEFINER` RPCs /
  service-role server actions, each gated by a single `is_platform_admin()` check that
  **fails closed**.
- The normal org code path is **untouched and strengthened**; we never relax org RLS to
  accommodate the super-admin.

## 4. Role model

| Role                                             | Scope     | Powers                                                                                                                                |
| ------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform super-admin**                         | Cross-org | Everything, everywhere: see all orgs, assign/revoke org admins, run recovery on any user, global deactivation. Separate guarded path. |
| **Org owner** (signup creator)                   | One org   | Top of their org. Manages owners/admins/members/guests. "Owner-supreme."                                                              |
| **Org admin** (assigned by owner or super-admin) | One org   | Manages members & guests, invitations, recovery. **Cannot** modify owners or other admins.                                            |
| **member / guest**                               | One org   | No admin-console access.                                                                                                              |

- **Owner-supreme:** only an owner may promote to owner or demote/remove another
  owner/admin. An admin may manage members & guests only.
- **Last-owner protection:** an org's final owner cannot be demoted or removed.
- **Multiple owners** allowed.
- **Provisioning unchanged:** self-serve signup still auto-creates an org and makes the
  signup user its first owner (`provision_account`). The super-admin oversees on top.

## 5. Enforcement approach (decision: "A — RPC-first")

- **Org-scoped privileged mutations** (role change, remove, deactivate toggle) run through
  `SECURITY DEFINER` RPCs that enforce hierarchy + last-owner **and write the audit row
  atomically in SQL**.
- **Auth-plane operations** with no SQL equivalent (invite email, password-reset email,
  global ban) run through **Server Actions using the service-role admin client**.
- **Cross-tenant super-admin operations** are a **separate** set of RPCs/actions gated by
  `is_platform_admin()`.
- **RLS is strengthened**, not bypassed: direct `org_members` writes are locked down so
  role/removal changes can only flow through the guarded RPCs.

Rejected alternatives: **B (server-action-centric with service-role)** moves the security
boundary into app code, against the repo invariant; **C (pure-RLS hierarchy)** makes
owner-supreme + last-owner logic gnarly in policy clauses and still needs a separate
cross-tenant path anyway.

## 6. Data model

### 6.1 New tables

```sql
-- Cross-tenant superpower. Seeded by migration (idempotent email lookup).
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Pending/accepted/revoked org invitations.
create table public.org_invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  email       text not null,
  role        public.org_role not null default 'member',
  invited_by  uuid not null references auth.users (id),
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'revoked')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);
-- One live invite per (org, email).
create unique index org_invitations_pending_uq
  on public.org_invitations (org_id, lower(email))
  where status = 'pending';
create index org_invitations_org_id_idx on public.org_invitations (org_id);
create index org_invitations_email_idx  on public.org_invitations (lower(email));

-- Append-only audit of every privileged action. org_id null = platform-level.
create table public.admin_audit_log (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references public.organizations (id) on delete cascade,
  actor_id       uuid not null references auth.users (id),
  actor_kind     text not null check (actor_kind in ('org', 'platform')),
  action         text not null,
  target_user_id uuid references auth.users (id),
  target_email   text,
  metadata       jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index admin_audit_log_org_created_idx
  on public.admin_audit_log (org_id, created_at desc);
```

`action` values (string constants): `member.invited`, `member.invite_revoked`,
`member.role_changed`, `member.removed`, `member.password_reset`, `member.deactivated`,
`member.reactivated`, `org_admin.assigned`, `org_admin.revoked`,
`platform.user_deactivated`, `platform.user_reactivated`.

### 6.2 Changed table

```sql
alter table public.org_members
  add column deactivated_at  timestamptz,
  add column deactivated_by  uuid references auth.users (id);
```

### 6.3 Seeding the platform admin

Migration seeds the bootstrap super-admin by email lookup, idempotently:

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'danijel@synapse-solutions.ai'
on conflict (user_id) do nothing;
```

> If the account does not exist at migration time the insert is a no-op; a follow-up
> idempotent re-run (or a one-line manual seed) establishes it. This is the **only**
> out-of-band step in the system, by design.

## 7. Helper functions

### 7.1 New gate

```sql
create function public.is_platform_admin()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins where user_id = (select auth.uid())
  );
$$;
```

### 7.2 Deactivation-aware membership helpers (changed)

`is_org_member`, `has_org_role`, and `auth_user_orgs` are amended to **exclude deactivated
memberships** (`deactivated_at is null`). A deactivated member is thereby denied that org's
data through the **existing** RLS everywhere — no per-policy edits required.

> **Blast radius:** these helpers back every org-scoped RLS policy. The full existing RLS
> integration suite MUST stay green after this change (regression gate in §10).

## 8. Operations

### 8.1 Org-scoped — `SECURITY DEFINER` RPCs (called from server actions)

Each validates the caller's role, enforces hierarchy + last-owner, performs the mutation,
and writes the audit row atomically.

- `set_member_role(p_org_id, p_user_id, p_new_role)` — owner-supreme; admin cannot modify
  an owner/admin; blocks demoting the last owner.
- `remove_member(p_org_id, p_user_id)` — same guards; last-owner protected.
- `deactivate_member(p_org_id, p_user_id)` / `reactivate_member(p_org_id, p_user_id)` —
  toggles `deactivated_at` / `deactivated_by`. **Org-scoped only** (no auth ban).

### 8.2 Org-scoped — auth-plane server actions (service-role client)

- `inviteMember(orgId, email, role)` — `auth.admin.inviteUserByEmail` (creates the auth
  user if absent, sends the branded invite email) + insert `org_invitations`. Handles
  "already a user" and "already a member" gracefully.
- `revokeInvite(inviteId)` — mark `status = 'revoked'`.
- `resetMemberPassword(orgId, userId)` — sends a Supabase password-recovery email to the
  target (admin never sees or sets the password).

### 8.3 Cross-tenant — platform-admin-gated (`is_platform_admin()`)

Separate path; `SECURITY DEFINER` RPCs / service-role actions that bypass org RLS only
after the gate passes.

- `platform_set_org_role(p_org_id, p_user_id, p_role)` — assign/revoke org admins (and any
  role) in any org.
- `platform_deactivate_user(userId)` / `platform_reactivate_user(userId)` — **global auth
  ban** via service role (`banned_until`), blocking all login. Writes platform audit.
- Platform-scoped reads: all orgs (paginated), global user lookup, platform audit feed.

### 8.4 Auth-callback integration — redeem before provision

On first confirmed sign-in, the auth callback runs **`redeem_invitations()` before
`provision_account`**:

- `redeem_invitations()` (`SECURITY DEFINER`) finds `pending` invites matching the user's
  email, inserts the corresponding `org_members` rows with the invited role, marks invites
  `accepted` (`accepted_at = now()`).
- If the user now belongs to ≥1 org, **skip** `provision_account` (do not auto-create a new
  org); otherwise self-provision as today.

## 9. RLS

- **`platform_admins`** — no `authenticated` access; readable only via `is_platform_admin()`
  / service role. Never client-writable.
- **`org_invitations`** — select/insert/update for that org's owners/admins
  (`has_org_role(org_id, {owner,admin})`); platform admin sees all. No member/guest access.
- **`admin_audit_log`** — select for that org's owners/admins; platform admin sees all
  (incl. `org_id is null`). **Insert only via the RPCs/actions** (no direct client insert);
  no update/delete (append-only).
- **`org_members` hardening** — direct `update`/`delete` policies tightened so role/removal
  changes flow only through the guarded RPCs; the existing "delete self" affordance is
  retained.

## 10. Testing (mandatory — written and run)

Follows existing `*.rls.integration.test.ts` / `*.test.tsx` patterns; integration suites
skip when `SUPABASE_SERVICE_ROLE_KEY` is absent.

**RLS / RPC integration**

- Hierarchy: admin cannot modify owner/admin; owner-supreme holds.
- Last-owner protection: cannot demote or remove the final owner.
- Deactivated membership is denied that org's data (helper-function behavior).
- `org_invitations` + `admin_audit_log` visibility per role; audit is append-only.
- `is_platform_admin()` gating: a non-platform user is blocked from every cross-tenant RPC
  and from `/admin`.
- An audit row is written for each privileged mutation.
- `redeem_invitations` binds the correct role and suppresses auto-provision; self-serve
  signup (no invite) still provisions.

**Regression**

- The full existing RLS suite stays green after the membership-helper change.

**Unit**

- Zod schemas; UI components (role dropdown disabled-states, invite-form validation, status
  badges); `ActionResult` handling.

## 11. UI surfaces

### 11.1 Org admin console — extend `/settings`

A **Members** area with in-page tabs **Members / Invitations / Activity**:

- **Members:** table (name, email, role, status) with inline role dropdown (disabled per
  hierarchy), remove, reset-password, deactivate/reactivate.
- **Invitations:** invite form (email + role) + pending-invites list with revoke.
- **Activity:** read-only audit feed (bounded).

Renders only for org owners/admins.

### 11.2 Platform console — new route `/admin`

Server-guarded by `requirePlatformAdmin()` (404/redirect for everyone else; never
client-exposed). All-orgs list (paginated) → drill into any org → the same member
management **plus assign/revoke org admins**; global user search; platform audit feed.

## 12. Performance & data-fetching budget (AGENTS.md §5)

- **First paint** loads members + pending invites + a bounded audit slice (last ~50).
- **Tab switches (Members / Invitations / Activity) = client state + History API, 0 server
  round-trips** — the data is already loaded (no `<Link>`/router navigation).
- **Mutations** = Server Action + targeted `revalidatePath` (`/settings` or `/admin/...`).
- **Bounded + indexed reads:** member list paginated (~50/page) over `org_members(org_id)`
  (index exists); audit over new `(org_id, created_at desc)` index; `/admin` org list
  paginated likewise.

## 13. Error handling

- `ActionResult<T>` discriminated union (as in `src/lib/org/actions.ts`): friendly,
  non-leaking messages.
- Hierarchy / last-owner violations return specific messages
  (e.g. "Can't demote the last owner").
- Service-role failures (invite/reset) degrade gracefully.
- `is_platform_admin()` and `requirePlatformAdmin()` **fail closed**.

## 14. Independent units (for the plan's Execution DAG — AGENTS.md §6)

- **U1 — DB migration:** tables, `deactivated_at`, helper-fn changes, all RPCs, RLS,
  indexes, seed. _(foundation)_
- **U2 — Zod schemas** for all admin inputs. _(no DB dep)_
- **U3 — Org-admin server actions** (role/remove/deactivate + invite/reset/revoke).
  _(needs U1 + U2)_
- **U4 — Platform server actions + `requirePlatformAdmin` guard.** _(needs U1 + U2)_
- **U5 — Org admin console UI** (`/settings` Members/Invitations/Activity). _(needs U3)_
- **U6 — Platform console UI** (`/admin`). _(needs U4)_
- **U7 — Auth-callback redeem-before-provision integration.** _(needs U1)_

Rough batches: **[U1, U2]** → **[U3, U4, U7]** → **[U5, U6]**. The full dependency graph,
parallel batches, and critical path are produced in the implementation plan.

## 15. Open questions / risks

- **Membership-helper blast radius** (§7.2): broad change; mitigated by the regression
  gate.
- **Invite ↔ existing user:** `inviteUserByEmail` behavior when the email is already a
  confirmed user — the action must branch to "add membership directly" rather than error.
- **Seed timing** (§6.3): the bootstrap account must exist for the seed to take; otherwise
  a one-line re-run is required.

## 16. Related

- `docs/prd.md` §5.1 F-1 (roles), §9 (permissions granularity — open)
- `supabase/migrations/20260614174043_init_auth_tenancy.sql` (role enum, helpers, RLS)
- `supabase/migrations/20260619184702_provision_account.sql` (self-serve provisioning)
- `src/lib/org/actions.ts` (`ActionResult` pattern), `src/lib/auth/session.ts`
- `AGENTS.md` §5 (perf budget), §6 (execution DAG)
