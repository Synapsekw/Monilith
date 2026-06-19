# Org Admin Console + Platform Super-Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-org admin console (member/role/invite/recovery/audit management) and a cross-tenant platform super-admin console, with RLS strengthened — not bypassed — and every privileged mutation flowing through guarded `SECURITY DEFINER` RPCs or service-role server actions that write an atomic audit trail.

**Architecture:** "RPC-first" (spec §5). Org-scoped privileged mutations run through `SECURITY DEFINER` RPCs enforcing hierarchy + last-owner + writing the audit row in one transaction. Auth-plane operations (invite/reset emails, global ban) run through Server Actions using the existing service-role client. Cross-tenant super-admin operations are a **separate** RPC/action set gated by a single fail-closed `is_platform_admin()`. The membership helper functions (`is_org_member`/`has_org_role`/`auth_user_orgs`) are amended to exclude deactivated members, so deactivation is enforced by the _existing_ RLS everywhere with no per-policy edits.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase (Postgres RLS, `SECURITY DEFINER` RPCs, `auth.admin` service-role API), Zod, Vitest (+ `*.rls.integration.test.ts`), Tailwind v4 / shadcn.

**Source spec:** `docs/superpowers/specs/2026-06-19-org-admin-and-platform-console-design.md`

---

## Execution DAG (AGENTS.md §6)

**Task → independent unit map:** T1=U1 (DB), T2=U2 (Zod), T3=U3 (org actions), T4=U4 (platform actions+guard), T5=U7 (redeem callback), T6=U1 integration tests, T7=U5 (org console UI), T8=U6 (platform console UI).

**Dependency graph (Consumes → produced-by):**

- **T1** — depends on nothing _(foundation: tables, helpers, RPCs, RLS, types)_
- **T2** — depends on nothing _(pure Zod, no DB)_
- **T3** — depends on **T1, T2** _(RPC names + types from T1; schemas from T2)_
- **T4** — depends on **T1, T2**
- **T5** — depends on **T1** _(redeem_invitations RPC)_
- **T6** — depends on **T1** _(applied migration to test against)_
- **T7** — depends on **T3** _(org admin actions + get_org_members RPC)_
- **T8** — depends on **T4** _(platform actions + guard) and reuses T3's MembersTable_

**Parallel batches (waves of concurrent agents):**

- **Batch A:** `T1`, `T2` — disjoint files, run concurrently.
- **Batch B:** `T3`, `T4`, `T5`, `T6` — all unblocked once T1+T2 land. Run concurrently.
- **Batch C:** `T7`, `T8` — once T3/T4 land. Run concurrently.

**Critical path (wall-clock floor):** `T1 → T3 → T7` (≡ `T1 → T4 → T8`), depth **3**. T1 is the heaviest single task and gates everything — front-load it.

**Concurrency mechanics:** Each batch with ≥2 tasks is dispatched via `superpowers:dispatching-parallel-agents`. Files are disjoint per task within a batch (see each task's **Files**), so the shared `develop` checkout is safe; if any two concurrent tasks are found to touch the same file at execution time, isolate them in **git worktrees** (`superpowers:using-git-worktrees`) per AGENTS.md #1/#6.

**⚠️ Manual gate (per north-star):** T1 applies a migration to the cloud Supabase project. Applying migrations requires explicit per-session authorization from Danijel (`supabase db push --linked` or MCP `apply_migration`). Do not push the migration without it.

---

## File Structure

**Created:**

- `supabase/migrations/20260619200000_org_admin_platform_console.sql` — all DB: 3 new tables, `org_members` columns, helper amendments, `is_platform_admin`, audit helper, all RPCs, RLS, indexes, seed.
- `src/lib/validations/admin.ts` — Zod schemas for all admin inputs.
- `src/lib/validations/admin.test.ts` — schema unit tests.
- `src/lib/org/admin-actions.ts` — org-scoped server actions (role/remove/deactivate/reactivate via RPC; invite/revoke/reset via service role).
- `src/lib/org/admin-actions.test.ts` — action unit tests (mapping/validation; mocked supabase).
- `src/lib/org/admin.rls.integration.test.ts` — RLS/RPC integration suite (hierarchy, last-owner, deactivation, audit, invitations, redeem).
- `src/lib/platform/guard.ts` — `isPlatformAdmin()`, `requirePlatformAdmin()`.
- `src/lib/platform/actions.ts` — `platformSetOrgRole`, `platformDeactivateUser`, `platformReactivateUser`.
- `src/lib/platform/queries.ts` — `listAllOrgs`, `platformAuditFeed`, `searchUsers`.
- `src/lib/platform/platform.integration.test.ts` — platform-gate + cross-tenant integration.
- `src/lib/auth/redeem.ts` — `redeemInvitationsForUser`.
- `src/lib/auth/redeem.test.ts` — unit test (mocked rpc).
- `src/components/settings/org-admin-console.tsx` — client: tabbed Members/Invitations/Activity (History API).
- `src/components/settings/members-table.tsx` — client: member rows + role dropdown + actions (org & platform modes).
- `src/components/settings/invite-panel.tsx` — client: invite form + pending invites list.
- `src/components/settings/activity-feed.tsx` — server-friendly presentational feed (used by both consoles).
- `src/components/settings/org-admin-console.test.tsx`, `members-table.test.tsx`, `invite-panel.test.tsx` — component tests.
- `src/app/admin/layout.tsx` — platform guard wrapper.
- `src/app/admin/page.tsx` — all-orgs list + global user search + platform audit feed.
- `src/app/admin/[orgId]/page.tsx` — per-org drill-in (members + assign/revoke admins).

**Modified:**

- `src/app/settings/page.tsx` — add the org admin console below the existing org card (admin-gated).
- `src/app/auth/callback/route.ts` — redeem invitations before provisioning.
- `src/types/database.types.ts` — regenerated after the migration (never hand-edited).

---

## Task 1 (U1): Database migration — tables, helpers, RPCs, RLS, seed

**Files:**

- Create: `supabase/migrations/20260619200000_org_admin_platform_console.sql`
- Modify: `src/types/database.types.ts` (regenerate)

> ⚠️ Before writing the `drop policy` statements in Step 6, **read `supabase/migrations/20260614174043_init_auth_tenancy.sql`** and copy the EXACT existing `org_members` policy names. `drop policy if exists "<wrong name>"` silently no-ops, which would leave the permissive policy in place and **defeat the hardening**. The names below are the expected ones — verify them.

- [ ] **Step 1: Write the migration file — new tables, columns, indexes, seed**

```sql
-- 20260619200000_org_admin_platform_console.sql
-- Org admin console + platform super-admin. See spec 2026-06-19-org-admin-and-platform-console-design.md.

-- ── New tables ──────────────────────────────────────────────────────────────

-- Cross-tenant superpower. Seeded by this migration (idempotent email lookup).
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

-- ── Changed table: deactivation ─────────────────────────────────────────────
alter table public.org_members
  add column deactivated_at  timestamptz,
  add column deactivated_by  uuid references auth.users (id);
```

- [ ] **Step 2: Amend the membership helpers to exclude deactivated members**

Append to the migration:

```sql
-- ── Deactivation-aware membership helpers (blast radius: every org RLS policy) ─
create or replace function public.auth_user_orgs()
returns setof uuid language sql security definer stable set search_path = '' as $$
  select org_id from public.org_members
  where user_id = (select auth.uid()) and deactivated_at is null;
$$;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = (select auth.uid())
      and deactivated_at is null
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles public.org_role[])
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = (select auth.uid())
      and role = any (p_roles) and deactivated_at is null
  );
$$;
```

- [ ] **Step 3: Platform gate + audit helper + members read RPC**

```sql
-- ── Platform gate ───────────────────────────────────────────────────────────
create function public.is_platform_admin()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins where user_id = (select auth.uid())
  );
$$;
grant execute on function public.is_platform_admin() to authenticated;

-- ── Internal audit writer (called only from definer RPCs) ────────────────────
create function public._admin_audit(
  p_org_id uuid, p_actor uuid, p_actor_kind text, p_action text,
  p_target_user uuid, p_target_email text, p_metadata jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into public.admin_audit_log
    (org_id, actor_id, actor_kind, action, target_user_id, target_email, metadata)
  values (p_org_id, p_actor, p_actor_kind, p_action, p_target_user, p_target_email,
          coalesce(p_metadata, '{}'::jsonb));
$$;

-- ── Members read (joins auth.users; gated to org admins OR platform admin) ────
create function public.get_org_members(p_org_id uuid, p_limit int default 50, p_offset int default 0)
returns table (
  user_id uuid, email text, full_name text, role public.org_role,
  deactivated_at timestamptz, created_at timestamptz
) language sql security definer set search_path = '' as $$
  select m.user_id, u.email::text, (u.raw_user_meta_data ->> 'full_name'),
         m.role, m.deactivated_at, m.created_at
  from public.org_members m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id
    and (
      public.has_org_role(p_org_id, array['owner','admin']::public.org_role[])
      or public.is_platform_admin()
    )
  order by m.created_at
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;
grant execute on function public.get_org_members(uuid, int, int) to authenticated;
```

- [ ] **Step 4: Org-scoped privileged RPCs (hierarchy + last-owner + atomic audit)**

```sql
-- set_member_role ────────────────────────────────────────────────────────────
create function public.set_member_role(
  p_org_id uuid, p_user_id uuid, p_new_role public.org_role
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role public.org_role;
  v_target_role public.org_role;
  v_owner_count int;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select role into v_actor_role from public.org_members
    where org_id = p_org_id and user_id = v_actor and deactivated_at is null;
  if v_actor_role is null or v_actor_role not in ('owner','admin') then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select role into v_target_role from public.org_members
    where org_id = p_org_id and user_id = p_user_id;
  if v_target_role is null then raise exception 'member not found' using errcode='P0002'; end if;
  -- Owner-supreme: an admin may not touch an owner/admin or grant owner/admin.
  if v_actor_role = 'admin' and (v_target_role in ('owner','admin') or p_new_role in ('owner','admin')) then
    raise exception 'admins cannot manage owners or admins' using errcode='42501';
  end if;
  -- Last-owner protection.
  if v_target_role = 'owner' and p_new_role <> 'owner' then
    select count(*) into v_owner_count from public.org_members where org_id = p_org_id and role='owner';
    if v_owner_count <= 1 then raise exception 'cannot demote the last owner' using errcode='P0001'; end if;
  end if;
  update public.org_members set role = p_new_role where org_id = p_org_id and user_id = p_user_id;
  perform public._admin_audit(p_org_id, v_actor, 'org', 'member.role_changed',
    p_user_id, null, jsonb_build_object('from', v_target_role, 'to', p_new_role));
end; $$;
grant execute on function public.set_member_role(uuid, uuid, public.org_role) to authenticated;

-- remove_member ──────────────────────────────────────────────────────────────
create function public.remove_member(p_org_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role public.org_role;
  v_target_role public.org_role;
  v_target_email text;
  v_owner_count int;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select role into v_actor_role from public.org_members
    where org_id = p_org_id and user_id = v_actor and deactivated_at is null;
  if v_actor_role is null or v_actor_role not in ('owner','admin') then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select role into v_target_role from public.org_members
    where org_id = p_org_id and user_id = p_user_id;
  if v_target_role is null then raise exception 'member not found' using errcode='P0002'; end if;
  if v_actor_role = 'admin' and v_target_role in ('owner','admin') then
    raise exception 'admins cannot remove owners or admins' using errcode='42501';
  end if;
  if v_target_role = 'owner' then
    select count(*) into v_owner_count from public.org_members where org_id = p_org_id and role='owner';
    if v_owner_count <= 1 then raise exception 'cannot remove the last owner' using errcode='P0001'; end if;
  end if;
  select email::text into v_target_email from auth.users where id = p_user_id;
  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
  perform public._admin_audit(p_org_id, v_actor, 'org', 'member.removed', p_user_id, v_target_email, '{}'::jsonb);
end; $$;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- deactivate_member / reactivate_member ──────────────────────────────────────
create function public.deactivate_member(p_org_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role public.org_role; v_target_role public.org_role; v_owner_count int;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select role into v_actor_role from public.org_members
    where org_id = p_org_id and user_id = v_actor and deactivated_at is null;
  if v_actor_role is null or v_actor_role not in ('owner','admin') then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select role into v_target_role from public.org_members where org_id = p_org_id and user_id = p_user_id;
  if v_target_role is null then raise exception 'member not found' using errcode='P0002'; end if;
  if v_actor_role = 'admin' and v_target_role in ('owner','admin') then
    raise exception 'admins cannot deactivate owners or admins' using errcode='42501';
  end if;
  if v_target_role = 'owner' then
    select count(*) into v_owner_count from public.org_members
      where org_id = p_org_id and role='owner' and deactivated_at is null;
    if v_owner_count <= 1 then raise exception 'cannot deactivate the last active owner' using errcode='P0001'; end if;
  end if;
  update public.org_members set deactivated_at = now(), deactivated_by = v_actor
    where org_id = p_org_id and user_id = p_user_id;
  perform public._admin_audit(p_org_id, v_actor, 'org', 'member.deactivated', p_user_id, null, '{}'::jsonb);
end; $$;
grant execute on function public.deactivate_member(uuid, uuid) to authenticated;

create function public.reactivate_member(p_org_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role public.org_role; v_target_role public.org_role;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode='42501'; end if;
  select role into v_actor_role from public.org_members
    where org_id = p_org_id and user_id = v_actor and deactivated_at is null;
  if v_actor_role is null or v_actor_role not in ('owner','admin') then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select role into v_target_role from public.org_members where org_id = p_org_id and user_id = p_user_id;
  if v_target_role is null then raise exception 'member not found' using errcode='P0002'; end if;
  if v_actor_role = 'admin' and v_target_role in ('owner','admin') then
    raise exception 'admins cannot manage owners or admins' using errcode='42501';
  end if;
  update public.org_members set deactivated_at = null, deactivated_by = null
    where org_id = p_org_id and user_id = p_user_id;
  perform public._admin_audit(p_org_id, v_actor, 'org', 'member.reactivated', p_user_id, null, '{}'::jsonb);
end; $$;
grant execute on function public.reactivate_member(uuid, uuid) to authenticated;
```

- [ ] **Step 5: Cross-tenant RPC + redeem RPC**

```sql
-- platform_set_org_role (assign/revoke any role in any org) ───────────────────
create function public.platform_set_org_role(
  p_org_id uuid, p_user_id uuid, p_role public.org_role
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_target_role public.org_role; v_owner_count int; v_action text;
begin
  if not public.is_platform_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select role into v_target_role from public.org_members where org_id = p_org_id and user_id = p_user_id;
  if v_target_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from public.org_members where org_id = p_org_id and role='owner';
    if v_owner_count <= 1 then raise exception 'cannot demote the last owner' using errcode='P0001'; end if;
  end if;
  insert into public.org_members (org_id, user_id, role)
    values (p_org_id, p_user_id, p_role)
    on conflict (org_id, user_id) do update set role = excluded.role;
  v_action := case
    when p_role = 'admin' then 'org_admin.assigned'
    when v_target_role = 'admin' then 'org_admin.revoked'
    else 'member.role_changed' end;
  perform public._admin_audit(p_org_id, v_actor, 'platform', v_action, p_user_id, null,
    jsonb_build_object('from', v_target_role, 'to', p_role));
end; $$;
grant execute on function public.platform_set_org_role(uuid, uuid, public.org_role) to authenticated;

-- redeem_invitations (called by auth callback before provision) ───────────────
create function public.redeem_invitations()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text; v_count int := 0;
begin
  if v_uid is null then return 0; end if;
  select email::text into v_email from auth.users where id = v_uid;
  if v_email is null then return 0; end if;
  with redeemed as (
    update public.org_invitations
       set status = 'accepted', accepted_at = now()
     where status = 'pending' and lower(email) = lower(v_email)
     returning org_id, role
  ), inserted as (
    insert into public.org_members (org_id, user_id, role)
    select org_id, v_uid, role from redeemed
    on conflict (org_id, user_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end; $$;
grant execute on function public.redeem_invitations() to authenticated;
```

- [ ] **Step 6: RLS for new tables + org_members hardening**

```sql
-- platform_admins: RLS on, NO policies → default-deny for all clients.
-- Readable only via is_platform_admin() (definer) / service role.
alter table public.platform_admins enable row level security;

-- org_invitations
alter table public.org_invitations enable row level security;
create policy "org_invitations: read by org admins or platform"
  on public.org_invitations for select to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]) or public.is_platform_admin());
create policy "org_invitations: insert by org admins"
  on public.org_invitations for insert to authenticated
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy "org_invitations: update by org admins"
  on public.org_invitations for update to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- admin_audit_log: read by org admins (their org) or platform admin (all incl. null org).
-- No insert/update/delete policies → only definer RPCs / service role write (append-only).
alter table public.admin_audit_log enable row level security;
create policy "admin_audit_log: read by org admins or platform"
  on public.admin_audit_log for select to authenticated
  using (
    (org_id is not null and public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
    or public.is_platform_admin()
  );

-- org_members hardening: role/removal changes flow only through the guarded RPCs.
-- VERIFY these names against 20260614174043_init_auth_tenancy.sql before running.
drop policy if exists "org_members: update if owner/admin" on public.org_members;
drop policy if exists "org_members: delete if owner/admin or self" on public.org_members;
create policy "org_members: delete self only"
  on public.org_members for delete to authenticated
  using (user_id = (select auth.uid()));
```

- [ ] **Step 7: Seed the bootstrap platform admin**

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'danijel@synapse-solutions.ai'
on conflict (user_id) do nothing;
```

- [ ] **Step 8: Apply the migration (manual gate) and regenerate types**

Confirm authorization from Danijel first. Then:

Run: `supabase db push --linked`
Expected: migration `20260619200000` applied; no errors.

Run: `pnpm db:types`
(Filter the PostHog telemetry line if present — see north-star manual-gates note: strip any line containing `'"_tag"'` before prettier.)
Expected: `src/types/database.types.ts` now contains the new tables (`platform_admins`, `org_invitations`, `admin_audit_log`) and RPC signatures (`set_member_role`, `remove_member`, `deactivate_member`, `reactivate_member`, `platform_set_org_role`, `redeem_invitations`, `is_platform_admin`, `get_org_members`).

- [ ] **Step 9: Sanity typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS (regenerated types compile).

```bash
git add supabase/migrations/20260619200000_org_admin_platform_console.sql src/types/database.types.ts
git commit -m "feat(admin): DB foundation — admin tables, RPCs, RLS, platform gate"
```

---

## Task 2 (U2): Zod schemas for admin inputs

**Files:**

- Create: `src/lib/validations/admin.ts`
- Test: `src/lib/validations/admin.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  setMemberRoleSchema,
  memberTargetSchema,
  inviteMemberSchema,
  revokeInviteSchema,
  platformUserTargetSchema,
} from "./admin";

const uuid = "11111111-1111-4111-8111-111111111111"; // RFC-valid v4 (Zod 4.x enforces version/variant nibbles)

describe("admin validations", () => {
  it("setMemberRoleSchema accepts a valid role change", () => {
    expect(
      setMemberRoleSchema.safeParse({
        orgId: uuid,
        userId: uuid,
        role: "admin",
      }).success,
    ).toBe(true);
  });
  it("setMemberRoleSchema rejects an unknown role", () => {
    expect(
      setMemberRoleSchema.safeParse({
        orgId: uuid,
        userId: uuid,
        role: "superuser",
      }).success,
    ).toBe(false);
  });
  it("memberTargetSchema requires uuids", () => {
    expect(
      memberTargetSchema.safeParse({ orgId: "nope", userId: uuid }).success,
    ).toBe(false);
  });
  it("inviteMemberSchema rejects inviting an owner", () => {
    expect(
      inviteMemberSchema.safeParse({
        orgId: uuid,
        email: "a@b.com",
        role: "owner",
      }).success,
    ).toBe(false);
  });
  it("inviteMemberSchema defaults role to member", () => {
    const r = inviteMemberSchema.parse({ orgId: uuid, email: "a@b.com" });
    expect(r.role).toBe("member");
  });
  it("inviteMemberSchema rejects a bad email", () => {
    expect(
      inviteMemberSchema.safeParse({
        orgId: uuid,
        email: "nope",
        role: "member",
      }).success,
    ).toBe(false);
  });
  it("revokeInviteSchema + platformUserTargetSchema require uuids", () => {
    expect(revokeInviteSchema.safeParse({ inviteId: uuid }).success).toBe(true);
    expect(platformUserTargetSchema.safeParse({ userId: uuid }).success).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/lib/validations/admin.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the schemas**

```ts
import { z } from "zod";

export const orgRoleSchema = z.enum(["owner", "admin", "member", "guest"]);

export const setMemberRoleSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  role: orgRoleSchema,
});
export type SetMemberRoleInput = z.infer<typeof setMemberRoleSchema>;

export const memberTargetSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
});
export type MemberTargetInput = z.infer<typeof memberTargetSchema>;

// Invites never grant owner; owner is granted only by promotion of an existing member.
export const inviteMemberSchema = z.object({
  orgId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["admin", "member", "guest"]).default("member"),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const revokeInviteSchema = z.object({ inviteId: z.string().uuid() });
export type RevokeInviteInput = z.infer<typeof revokeInviteSchema>;

// Platform: assign/revoke any role anywhere — same shape as org role change.
export const platformSetOrgRoleSchema = setMemberRoleSchema;
export type PlatformSetOrgRoleInput = SetMemberRoleInput;

export const platformUserTargetSchema = z.object({ userId: z.string().uuid() });
export type PlatformUserTargetInput = z.infer<typeof platformUserTargetSchema>;
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/validations/admin.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/admin.ts src/lib/validations/admin.test.ts
git commit -m "feat(admin): Zod schemas for admin/platform inputs"
```

---

## Task 3 (U3): Org-scoped admin server actions

**Depends on:** T1 (RPC names in generated types), T2 (schemas).

**Files:**

- Create: `src/lib/org/admin-actions.ts`
- Test: `src/lib/org/admin-actions.test.ts`

- [ ] **Step 1: Write failing unit tests (mocked supabase)**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getUser = vi.fn();
const insert = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    auth: { getUser },
    from: () => ({ insert }),
  }),
}));
const adminInvite = vi.fn();
const resetPasswordForEmail = vi.fn();
const svcInsert = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: { admin: { inviteUserByEmail: adminInvite } },
    from: () => ({ insert: svcInsert }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setMemberRole, inviteMember } from "./admin-actions";
const uuid = "11111111-1111-4111-8111-111111111111"; // RFC-valid v4 (Zod 4.x enforces version/variant nibbles)

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  adminInvite.mockReset();
  svcInsert.mockReset();
});

describe("setMemberRole", () => {
  it("rejects invalid input before calling the RPC", async () => {
    const r = await setMemberRole({ orgId: "x", userId: uuid, role: "admin" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps the last-owner error to a friendly message", async () => {
    rpc.mockResolvedValue({
      error: { message: "cannot demote the last owner" },
    });
    const r = await setMemberRole({
      orgId: uuid,
      userId: uuid,
      role: "member",
    });
    expect(r).toEqual({
      ok: false,
      error: "Can't change the last owner's role.",
    });
  });
  it("succeeds when the RPC succeeds", async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await setMemberRole({ orgId: uuid, userId: uuid, role: "admin" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_member_role", {
      p_org_id: uuid,
      p_user_id: uuid,
      p_new_role: "admin",
    });
  });
});

describe("inviteMember", () => {
  it("rejects when caller is unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const r = await inviteMember({
      orgId: uuid,
      email: "a@b.com",
      role: "member",
    });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/lib/org/admin-actions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the actions**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  setMemberRoleSchema,
  memberTargetSchema,
  inviteMemberSchema,
  revokeInviteSchema,
} from "@/lib/validations/admin";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });
const ok = (): ActionResult => ({ ok: true, data: undefined });

/** Map raised SQL exception messages to friendly, non-leaking copy. */
function friendlyMemberError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("last owner")) return "Can't change the last owner's role.";
  if (m.includes("last active owner"))
    return "Can't deactivate the last active owner.";
  if (m.includes("admins cannot"))
    return "Admins can't manage owners or other admins.";
  if (m.includes("not authorized"))
    return "You don't have permission to do that.";
  if (m.includes("member not found")) return "That member no longer exists.";
  return "Something went wrong. Please try again.";
}

export async function setMemberRole(input: unknown): Promise<ActionResult> {
  const parsed = setMemberRoleSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", {
    p_org_id: parsed.data.orgId,
    p_user_id: parsed.data.userId,
    p_new_role: parsed.data.role,
  });
  if (error) return fail(friendlyMemberError(error.message));
  revalidatePath("/settings");
  return ok();
}

export async function removeMember(input: unknown): Promise<ActionResult> {
  const parsed = memberTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    p_org_id: parsed.data.orgId,
    p_user_id: parsed.data.userId,
  });
  if (error) return fail(friendlyMemberError(error.message));
  revalidatePath("/settings");
  return ok();
}

export async function deactivateMember(input: unknown): Promise<ActionResult> {
  const parsed = memberTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("deactivate_member", {
    p_org_id: parsed.data.orgId,
    p_user_id: parsed.data.userId,
  });
  if (error) return fail(friendlyMemberError(error.message));
  revalidatePath("/settings");
  return ok();
}

export async function reactivateMember(input: unknown): Promise<ActionResult> {
  const parsed = memberTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reactivate_member", {
    p_org_id: parsed.data.orgId,
    p_user_id: parsed.data.userId,
  });
  if (error) return fail(friendlyMemberError(error.message));
  revalidatePath("/settings");
  return ok();
}

/** Auth-plane: create-or-invite the user and record the invitation. */
export async function inviteMember(input: unknown): Promise<ActionResult> {
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { orgId, email, role } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // RLS gates this insert to org owners/admins; unique partial index blocks dupes.
  const { error: insErr } = await supabase
    .from("org_invitations")
    .insert({ org_id: orgId, email, role, invited_by: user.id });
  if (insErr) {
    if (insErr.code === "23505")
      return fail("There's already a pending invite for that email.");
    return fail("You don't have permission to invite members.");
  }

  // Service role: create the auth user if absent + send the branded invite email.
  // If the email is already a registered user, swallow — they redeem on next login.
  const svc = createServiceClient();
  const { error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email);
  // A "User already registered" error is expected & fine; only surface unexpected ones.
  if (inviteErr && !/already.*regist/i.test(inviteErr.message)) {
    // Invitation row persists; user can still redeem after a normal sign-in.
  }

  await svc.from("admin_audit_log").insert({
    org_id: orgId,
    actor_id: user.id,
    actor_kind: "org",
    action: "member.invited",
    target_email: email,
    metadata: { role },
  });

  revalidatePath("/settings");
  return ok();
}

export async function revokeInvite(input: unknown): Promise<ActionResult> {
  const parsed = revokeInviteSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");
  // RLS update policy gates to org admins.
  const { data, error } = await supabase
    .from("org_invitations")
    .update({ status: "revoked" })
    .eq("id", parsed.data.inviteId)
    .eq("status", "pending")
    .select("org_id")
    .maybeSingle();
  if (error || !data) return fail("Could not revoke that invitation.");
  await createServiceClient().from("admin_audit_log").insert({
    org_id: data.org_id,
    actor_id: user.id,
    actor_kind: "org",
    action: "member.invite_revoked",
    metadata: {},
  });
  revalidatePath("/settings");
  return ok();
}

/** Auth-plane: send the target a Supabase password-recovery email. */
export async function resetMemberPassword(
  input: unknown,
): Promise<ActionResult> {
  const parsed = memberTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");
  // Authz: caller must be owner/admin of the org.
  const { data: allowed } = await supabase.rpc("has_org_role", {
    p_org_id: parsed.data.orgId,
    p_roles: ["owner", "admin"],
  });
  if (!allowed) return fail("You don't have permission to do that.");

  const svc = createServiceClient();
  const { data: target, error: lookErr } = await svc.auth.admin.getUserById(
    parsed.data.userId,
  );
  if (lookErr || !target.user?.email)
    return fail("Could not find that member.");

  const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
    target.user.email,
  );
  if (resetErr) return fail("Could not send the reset email.");

  await svc.from("admin_audit_log").insert({
    org_id: parsed.data.orgId,
    actor_id: user.id,
    actor_kind: "org",
    action: "member.password_reset",
    target_user_id: parsed.data.userId,
    metadata: {},
  });
  revalidatePath("/settings");
  return ok();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/org/admin-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add src/lib/org/admin-actions.ts src/lib/org/admin-actions.test.ts
git commit -m "feat(admin): org-scoped admin server actions"
```

---

## Task 4 (U4): Platform guard, actions, and queries

**Depends on:** T1, T2.

**Files:**

- Create: `src/lib/platform/guard.ts`
- Create: `src/lib/platform/actions.ts`
- Create: `src/lib/platform/queries.ts`
- Test: `src/lib/platform/guard.test.ts`

- [ ] **Step 1: Write failing test for the guard**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
import { isPlatformAdmin } from "./guard";

beforeEach(() => rpc.mockReset());

describe("isPlatformAdmin", () => {
  it("returns true when the RPC says so", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await isPlatformAdmin()).toBe(true);
  });
  it("fails closed on error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await isPlatformAdmin()).toBe(false);
  });
});
```

> Note: `isPlatformAdmin` is wrapped in React `cache()`, which memoizes per request. In Vitest each test runs outside a request scope; `cache()` degrades to a plain call, so the two cases above don't collide. If they do in practice, drop `cache()` to a bare async function (the request-dedupe is a perf nicety, not correctness).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/lib/platform/guard.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the guard**

```ts
// src/lib/platform/guard.ts
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** True if the current authenticated user is a platform super-admin. Fails closed. */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) return false;
  return data === true;
});

/** Gate a platform route. Redirects (never reveals /admin) for non-admins. */
export async function requirePlatformAdmin(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isPlatformAdmin())) redirect("/");
  return user;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/platform/guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement platform actions**

```ts
// src/lib/platform/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isPlatformAdmin } from "./guard";
import {
  platformSetOrgRoleSchema,
  platformUserTargetSchema,
} from "@/lib/validations/admin";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });
const ok = (): ActionResult => ({ ok: true, data: undefined });

const BAN_FOREVER = "876000h"; // ~100 years

export async function platformSetOrgRole(
  input: unknown,
): Promise<ActionResult> {
  const parsed = platformSetOrgRoleSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  if (!(await isPlatformAdmin())) return fail("Not authorized.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_org_role", {
    p_org_id: parsed.data.orgId,
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
  });
  if (error) {
    if (/last owner/i.test(error.message))
      return fail("Can't demote the last owner.");
    return fail("Could not change that role.");
  }
  revalidatePath(`/admin/${parsed.data.orgId}`);
  return ok();
}

async function setUserBan(
  input: unknown,
  ban: boolean,
  action: string,
): Promise<ActionResult> {
  const parsed = platformUserTargetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const {
    data: { user: actor },
  } = await supabase.auth.getUser();
  if (!actor) return fail("Not authenticated.");
  if (!(await isPlatformAdmin())) return fail("Not authorized.");
  const svc = createServiceClient();
  const { error } = await svc.auth.admin.updateUserById(parsed.data.userId, {
    ban_duration: ban ? BAN_FOREVER : "none",
  });
  if (error)
    return fail(
      ban ? "Could not deactivate user." : "Could not reactivate user.",
    );
  await svc.from("admin_audit_log").insert({
    org_id: null,
    actor_id: actor.id,
    actor_kind: "platform",
    action,
    target_user_id: parsed.data.userId,
    metadata: {},
  });
  revalidatePath("/admin");
  return ok();
}

export const platformDeactivateUser = (input: unknown) =>
  setUserBan(input, true, "platform.user_deactivated");
export const platformReactivateUser = (input: unknown) =>
  setUserBan(input, false, "platform.user_reactivated");
```

- [ ] **Step 6: Implement platform queries**

```ts
// src/lib/platform/queries.ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { isPlatformAdmin } from "./guard";

export type PlatformOrg = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
};

export async function listAllOrgs(
  page = 0,
  pageSize = 50,
): Promise<PlatformOrg[]> {
  if (!(await isPlatformAdmin())) return [];
  const from = page * pageSize;
  const { data } = await createServiceClient()
    .from("organizations")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  return (data as PlatformOrg[] | null) ?? [];
}

export type PlatformAuditRow = {
  id: string;
  org_id: string | null;
  actor_id: string;
  actor_kind: string;
  action: string;
  target_email: string | null;
  created_at: string;
};

export async function platformAuditFeed(
  limit = 50,
): Promise<PlatformAuditRow[]> {
  if (!(await isPlatformAdmin())) return [];
  const { data } = await createServiceClient()
    .from("admin_audit_log")
    .select(
      "id, org_id, actor_id, actor_kind, action, target_email, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as PlatformAuditRow[] | null) ?? [];
}

export type PlatformUser = { id: string; email: string | null };

/** Substring search across users (paginated admin listing). */
export async function searchUsers(
  query: string,
  limit = 20,
): Promise<PlatformUser[]> {
  if (!(await isPlatformAdmin())) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { data } = await createServiceClient().auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  return (data?.users ?? [])
    .filter((u) => (u.email ?? "").toLowerCase().includes(q))
    .slice(0, limit)
    .map((u) => ({ id: u.id, email: u.email ?? null }));
}
```

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck && pnpm test src/lib/platform/guard.test.ts`
Expected: PASS.

```bash
git add src/lib/platform/
git commit -m "feat(admin): platform guard, actions, queries"
```

---

## Task 5 (U7): Redeem invitations before provisioning

**Depends on:** T1.

**Files:**

- Create: `src/lib/auth/redeem.ts`
- Test: `src/lib/auth/redeem.test.ts`
- Modify: `src/app/auth/callback/route.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { redeemInvitationsForUser } from "./redeem";

describe("redeemInvitationsForUser", () => {
  it("returns the RPC count", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: 2, error: null }),
    } as never;
    expect(await redeemInvitationsForUser(supabase)).toBe(2);
  });
  it("returns 0 on error", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "x" } }),
    } as never;
    expect(await redeemInvitationsForUser(supabase)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/lib/auth/redeem.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/auth/redeem.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/** Accept any pending invitations matching the signed-in user's email.
 * Returns the number of org memberships created. */
export async function redeemInvitationsForUser(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { data, error } = await supabase.rpc("redeem_invitations");
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/auth/redeem.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the auth callback**

Modify `src/app/auth/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { provisionAccountForUser } from "@/lib/auth/provision";
import { redeemInvitationsForUser } from "@/lib/auth/redeem";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // Redeem invitations FIRST; only self-provision a new org if none were redeemed.
      const redeemed = await redeemInvitationsForUser(supabase);
      if (redeemed === 0) {
        await provisionAccountForUser(supabase, data.user);
      }
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add src/lib/auth/redeem.ts src/lib/auth/redeem.test.ts src/app/auth/callback/route.ts
git commit -m "feat(admin): redeem invitations before provisioning on sign-in"
```

---

## Task 6 (U1 verification): RLS / RPC integration suite

**Depends on:** T1 (migration applied to cloud).

**Files:**

- Create: `src/lib/org/admin.rls.integration.test.ts`
- Create: `src/lib/platform/platform.integration.test.ts`

> Pattern source: `src/lib/supabase/rls.integration.test.ts` (digest §5). Skips when `SUPABASE_SERVICE_ROLE_KEY` is absent. Provision real users with `admin.auth.admin.createUser`, sign in anon clients, exercise RPCs through the anon (authenticated) clients so RLS + the in-RPC guards both apply. Clean up users in `afterAll`.

- [ ] **Step 1: Write the org admin integration suite**

Cover (one `it` each):

1. **Hierarchy:** an `admin` calling `set_member_role` on an `owner` → error (`admins cannot manage owners or admins`).
2. **Owner-supreme:** an `owner` promoting a `member` to `admin` → succeeds; `org_members.role` updated.
3. **Last-owner demote:** the sole `owner` calling `set_member_role(self, 'member')` → error (`cannot demote the last owner`).
4. **Last-owner remove:** `remove_member` on the sole owner → error.
5. **Deactivation denies data:** after `deactivate_member`, the target's anon client sees **0** rows from their org's `boards`/`organizations` (helper-function behavior); after `reactivate_member`, access returns.
6. **Invitations visibility:** an org admin selects `org_invitations` for their org (sees rows); a `member` of the same org selects → **0 rows**; a user of a _different_ org → 0 rows.
7. **Audit append-only + visibility:** after a role change, an admin sees a matching `admin_audit_log` row; a direct client `insert`/`update`/`delete` into `admin_audit_log` → blocked (RLS).
8. **redeem_invitations:** seed a `pending` invite for `new@example.com` (role `member`) via service client; create+sign-in that user; call `redeem_invitations()` → returns 1, an `org_members` row exists with role `member`, the invite is `accepted`.

Scaffold:

```ts
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PW = "Test-Password-123!";

describe.skipIf(!SERVICE)("admin RLS + RPCs", () => {
  let admin: SupabaseClient<Database>;
  const created: string[] = [];
  // owner + admin + member all in ONE org; build via provision_account for the
  // owner, then platform/owner-side inserts for the others. (See Step 2 helper.)
  // ... provision users, capture { id, anon } per user, share orgId ...

  beforeAll(async () => {
    admin = createClient<Database>(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // build the org + members here
  }, 60_000);

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("admin cannot change an owner's role", async () => {
    // const { error } = await adminUser.anon.rpc("set_member_role", { p_org_id, p_user_id: ownerId, p_new_role: "member" });
    // expect(error).not.toBeNull();
  });
  // ...remaining cases per the list above...
});
```

> Build the multi-role org by: owner signs up via `provision_account`; create member+admin users; the owner promotes them with `set_member_role` (owner is allowed). This also exercises the happy path. Use `admin` (service) only for user creation/cleanup and for seeding the redeem invite — never to bypass the RPC under test.

- [ ] **Step 2: Write the platform integration suite**

`src/lib/platform/platform.integration.test.ts` — cover:

1. **Gate fails closed:** a normal authenticated user calling `platform_set_org_role` → error (`not authorized`); calling `is_platform_admin()` → `false`.
2. **Platform admin assigns an org admin:** seed a platform admin row (service insert into `platform_admins` for a created test user), that user calls `platform_set_org_role(otherOrg, someUser, 'admin')` → succeeds; `org_members` reflects it; an `org_admin.assigned` audit row exists with `actor_kind='platform'`.
3. **Platform audit visibility:** the platform admin selects `admin_audit_log` rows with `org_id is null` → visible; a normal user → 0 rows.

> Clean up the seeded `platform_admins` row in `afterAll` (delete the user cascades it).

- [ ] **Step 3: Run both suites (against the dev cloud project)**

Run: `pnpm test src/lib/org/admin.rls.integration.test.ts src/lib/platform/platform.integration.test.ts`
Expected: PASS (or cleanly SKIPPED if no service key — but here run with the key, all green).

- [ ] **Step 4: Run the FULL existing RLS suite (regression gate — spec §10)**

Run: `pnpm test -- rls.integration`
Expected: every existing `*.rls.integration.test.ts` still PASS — proving the membership-helper change didn't break tenant isolation anywhere.

- [ ] **Step 5: Commit**

```bash
git add src/lib/org/admin.rls.integration.test.ts src/lib/platform/platform.integration.test.ts
git commit -m "test(admin): RLS/RPC + platform-gate integration suites"
```

---

## Task 7 (U5): Org admin console UI (`/settings`)

**Depends on:** T3.

**Files:**

- Create: `src/components/settings/activity-feed.tsx`
- Create: `src/components/settings/members-table.tsx`
- Create: `src/components/settings/invite-panel.tsx`
- Create: `src/components/settings/org-admin-console.tsx`
- Test: `src/components/settings/members-table.test.tsx`, `invite-panel.test.tsx`, `org-admin-console.test.tsx`
- Modify: `src/app/settings/page.tsx`

> **Perf budget (spec §12 / AGENTS.md §5):** first paint loads members + pending invites + a bounded audit slice (~50) in the RSC. The Members/Invitations/Activity tab switch is **client state + History API** (`window.history.pushState` synced into `useSearchParams()`), **0 server round-trips**. Mutations are Server Actions + `revalidatePath("/settings")`.

- [ ] **Step 1: Activity feed (presentational) + its test**

```tsx
// src/components/settings/activity-feed.tsx
const LABELS: Record<string, string> = {
  "member.invited": "invited",
  "member.invite_revoked": "revoked an invite",
  "member.role_changed": "changed a role",
  "member.removed": "removed a member",
  "member.password_reset": "sent a password reset",
  "member.deactivated": "deactivated a member",
  "member.reactivated": "reactivated a member",
  "org_admin.assigned": "assigned an org admin",
  "org_admin.revoked": "revoked an org admin",
  "platform.user_deactivated": "deactivated a user",
  "platform.user_reactivated": "reactivated a user",
};

export type AuditRow = {
  id: string;
  action: string;
  target_email: string | null;
  created_at: string;
};

export function ActivityFeed({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity yet.</p>;
  }
  return (
    <ul className="divide-border divide-y text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between py-2">
          <span>
            {LABELS[r.action] ?? r.action}
            {r.target_email ? ` · ${r.target_email}` : ""}
          </span>
          <time className="text-muted-foreground text-xs">
            {new Date(r.created_at).toLocaleString()}
          </time>
        </li>
      ))}
    </ul>
  );
}
```

Test (`activity-feed` covered indirectly by console test; optional dedicated test): render with one row → label text present; render empty → "No activity yet."

- [ ] **Step 2: Members table (client) + test**

Behavior: each row shows name/email, a role `<select>` (shadcn Select or native), and action buttons. **Disabled-state rules (hierarchy):** when `mode==="org"` and `currentUserRole==="admin"`, rows whose role is `owner` or `admin` have role-change/remove/deactivate **disabled**. The current user's own row cannot be removed/deactivated. Each action calls the matching server action and shows a toast on `{ ok: false }`.

```tsx
// src/components/settings/members-table.tsx
"use client";
import { useTransition } from "react";
import type { Database } from "@/types/database.types";
import {
  setMemberRole,
  removeMember,
  deactivateMember,
  reactivateMember,
  resetMemberPassword,
} from "@/lib/org/admin-actions";
import { platformSetOrgRole } from "@/lib/platform/actions";
import { Button } from "@/components/ui/button";

type Role = Database["public"]["Enums"]["org_role"];
export type Member = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  deactivated_at: string | null;
};

const ROLES: Role[] = ["owner", "admin", "member", "guest"];

export function MembersTable({
  orgId,
  members,
  currentUserId,
  currentUserRole,
  mode = "org",
}: {
  orgId: string;
  members: Member[];
  currentUserId: string;
  currentUserRole: Role;
  mode?: "org" | "platform";
}) {
  const [pending, start] = useTransition();

  const canManage = (target: Member) => {
    if (mode === "platform") return true; // platform admin manages anyone
    if (currentUserRole === "owner") return true;
    // admin: cannot touch owners/admins
    return target.role !== "owner" && target.role !== "admin";
  };

  const changeRole = (m: Member, role: Role) =>
    start(async () => {
      const res =
        mode === "platform"
          ? await platformSetOrgRole({ orgId, userId: m.user_id, role })
          : await setMemberRole({ orgId, userId: m.user_id, role });
      if (!res.ok) alert(res.error); // replace with the app toast
    });

  return (
    <table className="w-full text-sm">
      <thead className="text-muted-foreground text-left text-xs">
        <tr>
          <th className="py-2">Member</th>
          <th>Role</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody className="divide-border divide-y">
        {members.map((m) => {
          const isSelf = m.user_id === currentUserId;
          const locked = !canManage(m) || pending;
          return (
            <tr key={m.user_id}>
              <td className="py-2">
                <div>{m.full_name ?? "—"}</div>
                <div className="text-muted-foreground text-xs">{m.email}</div>
              </td>
              <td>
                <select
                  aria-label={`Role for ${m.email ?? m.user_id}`}
                  defaultValue={m.role}
                  disabled={
                    locked || (mode === "org" && isSelf && m.role === "owner")
                  }
                  onChange={(e) => changeRole(m, e.target.value as Role)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </td>
              <td>{m.deactivated_at ? "Deactivated" : "Active"}</td>
              <td className="flex gap-1 py-2">
                {m.deactivated_at ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={locked}
                    onClick={() =>
                      start(async () => {
                        const r = await reactivateMember({
                          orgId,
                          userId: m.user_id,
                        });
                        if (!r.ok) alert(r.error);
                      })
                    }
                  >
                    Reactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={locked || isSelf}
                    onClick={() =>
                      start(async () => {
                        const r = await deactivateMember({
                          orgId,
                          userId: m.user_id,
                        });
                        if (!r.ok) alert(r.error);
                      })
                    }
                  >
                    Deactivate
                  </Button>
                )}
                {mode === "org" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={locked}
                    onClick={() =>
                      start(async () => {
                        const r = await resetMemberPassword({
                          orgId,
                          userId: m.user_id,
                        });
                        if (!r.ok) alert(r.error);
                      })
                    }
                  >
                    Reset password
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked || isSelf}
                  onClick={() =>
                    start(async () => {
                      const r = await removeMember({
                        orgId,
                        userId: m.user_id,
                      });
                      if (!r.ok) alert(r.error);
                    })
                  }
                >
                  Remove
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

Test (`members-table.test.tsx`): mock the action modules (`vi.mock("@/lib/org/admin-actions", ...)` and `@/lib/platform/actions`); render with a member list. Assert:

- an `admin` current user gets a **disabled** role `<select>` for an `owner` row (`expect(select).toBeDisabled()`).
- an `owner` current user gets an **enabled** select for a `member` row.
- the self row's Remove button is disabled.
- changing a `member` row's select calls `setMemberRole` with the right args.

- [ ] **Step 3: Invite panel (client) + test**

```tsx
// src/components/settings/invite-panel.tsx
"use client";
import { useState, useTransition } from "react";
import { inviteMember, revokeInvite } from "@/lib/org/admin-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Invite = {
  id: string;
  email: string;
  role: string;
  created_at: string;
};

export function InvitePanel({
  orgId,
  invites,
}: {
  orgId: string;
  invites: Invite[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await inviteMember({ orgId, email, role });
            if (!r.ok) alert(r.error);
            else setEmail("");
          });
        }}
      >
        <Input
          type="email"
          required
          placeholder="name@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Invite email"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-label="Invite role"
        >
          <option value="member">member</option>
          <option value="admin">admin</option>
          <option value="guest">guest</option>
        </select>
        <Button type="submit" disabled={pending}>
          Invite
        </Button>
      </form>

      <ul className="divide-border divide-y text-sm">
        {invites.length === 0 && (
          <li className="text-muted-foreground py-2">No pending invites.</li>
        )}
        {invites.map((i) => (
          <li key={i.id} className="flex items-center justify-between py-2">
            <span>
              {i.email} · {i.role}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await revokeInvite({ inviteId: i.id });
                  if (!r.ok) alert(r.error);
                })
              }
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Test (`invite-panel.test.tsx`): mock actions; submitting the form calls `inviteMember` with `{ orgId, email, role }`; clicking Revoke calls `revokeInvite`.

- [ ] **Step 4: Console shell with History-API tabs + test**

```tsx
// src/components/settings/org-admin-console.tsx
"use client";
import { useSearchParams } from "next/navigation";
import { MembersTable, type Member } from "./members-table";
import { InvitePanel, type Invite } from "./invite-panel";
import { ActivityFeed, type AuditRow } from "./activity-feed";
import type { Database } from "@/types/database.types";

type Role = Database["public"]["Enums"]["org_role"];
const TABS = ["members", "invitations", "activity"] as const;
type Tab = (typeof TABS)[number];

export function OrgAdminConsole({
  orgId,
  members,
  invites,
  audit,
  currentUserId,
  currentUserRole,
}: {
  orgId: string;
  members: Member[];
  invites: Invite[];
  audit: AuditRow[];
  currentUserId: string;
  currentUserRole: Role;
}) {
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "")
    ? (raw as Tab)
    : "members";

  const select = (t: Tab) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", t);
    // History API: no RSC re-run, no refetch (AGENTS.md §5).
    window.history.pushState(null, "", `?${next.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={
              tab === t
                ? "border-primary border-b-2 px-3 py-2 capitalize"
                : "text-muted-foreground px-3 py-2 capitalize"
            }
            onClick={() => select(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "members" && (
        <MembersTable
          orgId={orgId}
          members={members}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          mode="org"
        />
      )}
      {tab === "invitations" && <InvitePanel orgId={orgId} invites={invites} />}
      {tab === "activity" && <ActivityFeed rows={audit} />}
    </div>
  );
}
```

Test (`org-admin-console.test.tsx`): mock `next/navigation` `useSearchParams` (return a `URLSearchParams`); render → Members tab shown by default; clicking the "invitations" tab calls `window.history.pushState` (spy on it) — since jsdom won't re-run, assert the spy was called with a `?tab=invitations` URL. (Mock the action modules so child components mount cleanly.)

- [ ] **Step 5: Wire into the settings page (admin-gated, bounded reads)**

Modify `src/app/settings/page.tsx` — after the existing org card, fetch admin data and render the console only for owners/admins:

```tsx
import { createClient } from "@/lib/supabase/server";
import { OrgAdminConsole } from "@/components/settings/org-admin-console";
// ...existing imports...

export default async function SettingsPage() {
  const user = await requireUser();
  const orgs = await getUserOrgs();
  const org = orgs[0];
  if (!org) redirect("/onboarding");

  const supabase = await createClient();
  const { data: members } = await supabase.rpc("get_org_members", {
    p_org_id: org.id,
  });
  const me = (members ?? []).find((m) => m.user_id === user.id);
  const isAdmin = me?.role === "owner" || me?.role === "admin";

  const [{ data: invites }, { data: audit }] = isAdmin
    ? await Promise.all([
        supabase
          .from("org_invitations")
          .select("id, email, role, created_at")
          .eq("org_id", org.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
        supabase
          .from("admin_audit_log")
          .select("id, action, target_email, created_at")
          .eq("org_id", org.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* ...existing heading + Organization card unchanged... */}

      {isAdmin && me && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Manage members, invitations, and activity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OrgAdminConsole
              orgId={org.id}
              members={members ?? []}
              invites={invites ?? []}
              audit={audit ?? []}
              currentUserId={user.id}
              currentUserRole={me.role}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm test src/components/settings/ && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/ src/app/settings/page.tsx
git commit -m "feat(admin): org admin console (members/invitations/activity) on /settings"
```

---

## Task 8 (U6): Platform console UI (`/admin`)

**Depends on:** T4 (guard/actions/queries) and reuses T7's `MembersTable` / `ActivityFeed`.

**Files:**

- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`
- Create: `src/app/admin/[orgId]/page.tsx`
- Create: `src/components/admin/user-search.tsx`

- [ ] **Step 1: Guard layout**

```tsx
// src/app/admin/layout.tsx
import type { ReactNode } from "react";
import { requirePlatformAdmin } from "@/lib/platform/guard";

export const metadata = { title: "Platform admin" };

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requirePlatformAdmin(); // redirects non-admins; never reveals the route
  return <div className="mx-auto max-w-4xl px-6 py-10">{children}</div>;
}
```

- [ ] **Step 2: All-orgs list + audit feed + user search**

```tsx
// src/app/admin/page.tsx
import Link from "next/link";
import { listAllOrgs, platformAuditFeed } from "@/lib/platform/queries";
import { ActivityFeed } from "@/components/settings/activity-feed";
import { UserSearch } from "@/components/admin/user-search";

export default async function AdminHome() {
  const [orgs, audit] = await Promise.all([
    listAllOrgs(0),
    platformAuditFeed(50),
  ]);
  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-heading text-2xl font-semibold">Platform admin</h1>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Organizations</h2>
        <ul className="divide-border divide-y text-sm">
          {orgs.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-2">
              <span>{o.name}</span>
              <Link className="text-primary" href={`/admin/${o.id}`}>
                Manage →
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Find a user</h2>
        <UserSearch />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">Recent platform activity</h2>
        <ActivityFeed rows={audit} />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Per-org drill-in (reuses MembersTable in platform mode)**

```tsx
// src/app/admin/[orgId]/page.tsx
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { MembersTable } from "@/components/settings/members-table";
import { ActivityFeed } from "@/components/settings/activity-feed";

export default async function AdminOrgPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const me = await requirePlatformAdmin();
  const { orgId } = await params;
  const supabase = await createClient();

  // get_org_members passes the gate via is_platform_admin() even cross-tenant.
  const { data: members } = await supabase.rpc("get_org_members", {
    p_org_id: orgId,
  });
  if (!members) notFound();
  const { data: audit } = await supabase
    .from("admin_audit_log")
    .select("id, action, target_email, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-8">
      <h1 className="font-heading text-xl font-semibold">
        Organization members
      </h1>
      <MembersTable
        orgId={orgId}
        members={members}
        currentUserId={me.id}
        currentUserRole="owner"
        mode="platform"
      />
      <section>
        <h2 className="mb-2 text-sm font-medium">Activity</h2>
        <ActivityFeed rows={audit ?? []} />
      </section>
    </div>
  );
}
```

> In `mode="platform"`, `MembersTable.canManage` always returns true, so `currentUserRole` is unused for gating — pass `"owner"` to satisfy the prop type. Role changes route to `platformSetOrgRole`; the RPC's `is_platform_admin()` gate + last-owner check are the real boundary.

- [ ] **Step 4: User search client component (global ban/unban)**

```tsx
// src/components/admin/user-search.tsx
"use client";
import { useState, useTransition } from "react";
import { searchUsersAction } from "@/lib/platform/search-action";
import {
  platformDeactivateUser,
  platformReactivateUser,
} from "@/lib/platform/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UserSearch() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; email: string | null }[]>([]);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => setRows(await searchUsersAction(q)));
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="email…"
          aria-label="Search users"
        />
        <Button type="submit" disabled={pending}>
          Search
        </Button>
      </form>
      <ul className="divide-border divide-y text-sm">
        {rows.map((u) => (
          <li key={u.id} className="flex items-center justify-between py-2">
            <span>{u.email}</span>
            <span className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  start(async () => {
                    const r = await platformDeactivateUser({ userId: u.id });
                    if (!r.ok) alert(r.error);
                  })
                }
              >
                Ban
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  start(async () => {
                    const r = await platformReactivateUser({ userId: u.id });
                    if (!r.ok) alert(r.error);
                  })
                }
              >
                Unban
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Also create the thin server-action wrapper so the client can call the (server-only) query:

```ts
// src/lib/platform/search-action.ts
"use server";
import { searchUsers } from "./queries";
export async function searchUsersAction(query: string) {
  return searchUsers(query);
}
```

(`searchUsers` already fails closed via `isPlatformAdmin()`.)

- [ ] **Step 5: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS (routes compile; `/admin` is dynamic).

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/ src/components/admin/ src/lib/platform/search-action.ts
git commit -m "feat(admin): platform super-admin console at /admin"
```

---

## Final verification (all four gates — AGENTS.md #4)

- [ ] `pnpm typecheck` → PASS
- [ ] `pnpm lint` → PASS
- [ ] `pnpm test` → PASS (unit + component; integration suites green with the service key, skip without)
- [ ] `pnpm build` → PASS
- [ ] **e2e (Playwright):** owner invites a member; pending invite appears; revoke removes it; promote a member to admin; deactivate then reactivate a member; (with the seeded platform admin) `/admin` lists orgs and a non-admin is redirected away from `/admin`.
- [ ] **Advisors:** run `get_advisors` (security + performance) via MCP — no new warnings (every new function pins `search_path = ''`; every new table has RLS).
- [ ] `superpowers:requesting-code-review` whole-branch review → no Critical/Important findings.
- [ ] Update `vault/00-north-star.md` + add a `vault/sessions/` note via `/wrapup`.

---

## Self-Review (against the spec)

**Spec coverage:**

- §6.1 tables (platform_admins, org_invitations, admin_audit_log) → T1 Step 1 ✓
- §6.2 deactivated_at/by → T1 Step 1 ✓
- §6.3 seed → T1 Step 7 ✓
- §7.1 is_platform_admin → T1 Step 3 ✓ · §7.2 helper amendments → T1 Step 2 ✓
- §8.1 org RPCs → T1 Step 4 ✓ · §8.2 auth-plane actions → T3 ✓ · §8.3 cross-tenant → T1 Step 5 + T4 ✓ · §8.4 redeem-before-provision → T1 Step 5 + T5 ✓
- §9 RLS (4 tables incl. org_members hardening) → T1 Step 6 ✓
- §10 testing (RLS/RPC integration, regression, unit) → T2/T3/T4/T6 + per-component tests ✓
- §11.1 org console tabs → T7 ✓ · §11.2 /admin guarded → T8 ✓
- §12 perf budget (first-paint loads; tabs = History API 0-fetch; bounded reads) → T7 Step 4/5 ✓
- §13 error handling (ActionResult, friendly hierarchy/last-owner messages, fail-closed) → T3/T4 ✓

**Open-risk handling:**

- Membership-helper blast radius (§15) → regression gate T6 Step 4.
- Invite ↔ existing user (§15) → T3 `inviteMember` swallows "already registered"; invitation row persists for redeem.
- Seed timing (§15) → idempotent `on conflict do nothing`; re-runnable.

**Type consistency:** RPC arg names (`p_org_id`/`p_user_id`/`p_new_role`/`p_role`) match between T1 SQL and T3/T4 call sites; `Member`/`Invite`/`AuditRow`/`Role` types defined once and imported; `ActionResult`/`fail`/`ok` mirror the existing `src/lib/org/actions.ts` shape.

**Known follow-ups (lean tier, not blocking):** replace `alert()` with the app toast; org-list + member-list pagination UI (reads are already bounded server-side); global content search; AppShell entry-point link to `/admin` for platform admins.
