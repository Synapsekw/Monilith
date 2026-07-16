# Cross-Org Reciprocal Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When someone accepts an org invite, also add the inviter into the invitee's own org as a `guest`, so board-sharing works in both directions with no reverse invite.

**Architecture:** Two SECURITY DEFINER RPCs (`accept_invitation`, `redeem_invitations`) get a reciprocal `org_members` insert (inviter → invitee's owned org, `guest`, idempotent). The RLS/security boundary (`share_board`, `can_read_board`, `board_members`) is **not** touched — once both users are members of both orgs, the existing sharing machinery works both ways. One new migration; one line of invite-accept UI copy; integration tests.

**Tech Stack:** Postgres/PL-pgSQL (Supabase migrations), Next.js 16 RSC, Vitest integration harness (real Supabase, RLS via JWT sign-in), React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-16-mutual-org-membership-cross-org-sharing-design.md`

---

## File Structure

| File                                                                  | Responsibility                                              | Action                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| `supabase/migrations/<new>_cross-org-reciprocal-membership.sql`       | `create or replace` both accept RPCs with reciprocal insert | **Create** (via `scripts/new-migration.sh`) |
| `src/lib/org/cross-org-reciprocal-membership.rls.integration.test.ts` | Real-DB proof of reciprocity + edge cases                   | **Create**                                  |
| `src/components/notifications/InvitationsSection.tsx`                 | Add reciprocity notice line to each pending-invite row      | **Modify**                                  |
| `src/components/notifications/InvitationsSection.test.tsx`            | Assert notice renders                                       | **Create** (or extend if it exists)         |

**No changes** to `share_board`, `can_read_board`, `can_edit_board`, `board_members`, `my_pending_invitations`, `database.types.ts` (RPC signatures unchanged), or any RLS policy.

---

## Task 0: Set up the worktree

- [ ] **Step 1: Create the task worktree**

Run: `scripts/start-task.sh cross-org-reciprocal-membership`
Then `cd .claude/worktrees/cross-org-reciprocal-membership` (or `EnterWorktree({ path: ".claude/worktrees/cross-org-reciprocal-membership" })` for a subagent-driven session).

This cuts `task/cross-org-reciprocal-membership` off latest `origin/develop`, runs `pnpm install`, symlinks `.env.local`, and pins commit identity. All subsequent commands run **inside** the worktree.

> Note: the spec was committed to local `develop` but may not be on `origin/develop` yet. If the worktree doesn't contain the spec, that's fine — this plan is self-contained.

---

## Task 1: Integration tests for reciprocal membership (write first, red)

**Files:**

- Create: `src/lib/org/cross-org-reciprocal-membership.rls.integration.test.ts`

Mirrors the existing harness in `src/lib/org/invite-acceptance.rls.integration.test.ts` and `src/lib/boards/board-sharing.rls.integration.test.ts` (service-role admin client seeds; each user impersonated via a separate anon client + `signInWithRetry`; suite self-skips via `describe.skipIf(!integrationTargetReady())`).

- [ ] **Step 1: Write the failing integration test file**

```ts
import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PW = "Test-Password-123!";
type Role = Database["public"]["Enums"]["org_role"];

describe.skipIf(!integrationTargetReady())(
  "cross-org reciprocal membership",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    async function makeUser(email: string) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PW,
        email_confirm: true,
      });
      expect(error).toBeNull();
      const id = created.user!.id;
      createdUserIds.push(id);
      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: sErr } = await signInWithRetry(anon, {
        email,
        password: PW,
      });
      expect(sErr).toBeNull();
      return { id, anon };
    }

    // owner_id owns the org; returns the new org id.
    async function makeOwnedOrg(anon: SupabaseClient<Database>, label: string) {
      const { data, error } = await anon.rpc("create_organization", {
        p_name: `${label} Org`,
        p_slug: `${label}-${randomUUID().slice(0, 8)}`,
      });
      expect(error, `create_organization for ${label}`).toBeNull();
      return (data as { id: string }).id;
    }

    // Seed a pending invite from `inviterId` in `orgId` to `email`.
    async function seedInvite(
      orgId: string,
      inviterId: string,
      email: string,
      role: Role,
    ) {
      const { data, error } = await admin
        .from("org_invitations")
        .insert({
          org_id: orgId,
          email,
          role,
          invited_by: inviterId,
          status: "pending",
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      return (data as { id: string }).id;
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    });

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    });

    it("accept_invitation adds the inviter as a guest of the invitee's owned org", async () => {
      // Alice owns Org A; Bob owns Org B. Alice invites Bob into Org A.
      const alice = await makeUser(`alice-${randomUUID()}@example.com`);
      const orgA = await makeOwnedOrg(alice.anon, "alice");
      const bobEmail = `bob-${randomUUID()}@example.com`;
      const bob = await makeUser(bobEmail);
      const orgB = await makeOwnedOrg(bob.anon, "bob");

      const inviteId = await seedInvite(orgA, alice.id, bobEmail, "member");
      const { error } = await bob.anon.rpc("accept_invitation", {
        p_invite_id: inviteId,
      });
      expect(error).toBeNull();

      // Forward: Bob is a member of Org A (unchanged behavior).
      const fwd = await admin
        .from("org_members")
        .select("role")
        .eq("org_id", orgA)
        .eq("user_id", bob.id)
        .single();
      expect((fwd.data as { role: Role }).role).toBe("member");

      // Reciprocal: Alice is now a GUEST of Org B.
      const recip = await admin
        .from("org_members")
        .select("role")
        .eq("org_id", orgB)
        .eq("user_id", alice.id)
        .single();
      expect(recip.error, "reciprocal membership row should exist").toBeNull();
      expect((recip.data as { role: Role }).role).toBe("guest");
    });

    it("reverse-share works end-to-end after reciprocation", async () => {
      const alice = await makeUser(`alice2-${randomUUID()}@example.com`);
      const orgA = await makeOwnedOrg(alice.anon, "alice2");
      const bobEmail = `bob2-${randomUUID()}@example.com`;
      const bob = await makeUser(bobEmail);
      const orgB = await makeOwnedOrg(bob.anon, "bob2");

      const inviteId = await seedInvite(orgA, alice.id, bobEmail, "member");
      await bob.anon.rpc("accept_invitation", { p_invite_id: inviteId });

      // Bob creates a board in HIS org (Org B). Mirror the board-creation block in
      // src/lib/boards/board-sharing.rls.integration.test.ts (beforeAll, ~lines
      // 59-110): fetch Bob's workspace for orgB, call create_board, capture boardId.
      const { data: ws } = await admin
        .from("workspaces")
        .select("id")
        .eq("org_id", orgB)
        .limit(1)
        .single();
      const workspaceId = (ws as { id: string }).id;
      const { data: board, error: boardErr } = await bob.anon.rpc(
        "create_board",
        {
          p_workspace_id: workspaceId,
          p_name: "Bob's board",
        },
      );
      expect(boardErr, "create_board").toBeNull();
      const boardId = (board as { id: string }).id;

      // Bob shares his Org-B board with Alice — this is the direction that was
      // previously impossible (Alice was not in Org B).
      const { error: shareErr } = await bob.anon.rpc("share_board", {
        p_board_id: boardId,
        p_user_id: alice.id,
        p_access: "viewer",
      });
      expect(shareErr, "Bob can now share his board with Alice").toBeNull();

      // Alice can read Bob's board via her RLS-scoped client.
      const { data: readable } = await alice.anon
        .from("boards")
        .select("id")
        .eq("id", boardId);
      expect(readable, "Alice reads Bob's shared board").toHaveLength(1);
    });

    it("accept_invitation does NOT reciprocate when the invitee owns no org", async () => {
      // Alice owns Org A; Carol owns nothing. Alice invites Carol.
      const alice = await makeUser(`alice3-${randomUUID()}@example.com`);
      const orgA = await makeOwnedOrg(alice.anon, "alice3");
      const carolEmail = `carol-${randomUUID()}@example.com`;
      const carol = await makeUser(carolEmail); // no create_organization → owns no org

      const inviteId = await seedInvite(orgA, alice.id, carolEmail, "member");
      const { error } = await carol.anon.rpc("accept_invitation", {
        p_invite_id: inviteId,
      });
      expect(error, "accept still succeeds").toBeNull();

      // Carol joined Org A; Alice gained NO new membership anywhere.
      const aliceMemberships = await admin
        .from("org_members")
        .select("org_id")
        .eq("user_id", alice.id);
      expect(
        (aliceMemberships.data ?? []).map(
          (m) => (m as { org_id: string }).org_id,
        ),
      ).toEqual([orgA]); // only her own org
    });

    it("reciprocal insert never demotes an existing higher role (on conflict do nothing)", async () => {
      // Bob owns Org B AND Alice is already an owner-invited admin of Org B.
      const alice = await makeUser(`alice4-${randomUUID()}@example.com`);
      const orgA = await makeOwnedOrg(alice.anon, "alice4");
      const bobEmail = `bob4-${randomUUID()}@example.com`;
      const bob = await makeUser(bobEmail);
      const orgB = await makeOwnedOrg(bob.anon, "bob4");
      // Pre-existing: Alice is already an 'admin' of Org B.
      await admin
        .from("org_members")
        .insert({ org_id: orgB, user_id: alice.id, role: "admin" });

      const inviteId = await seedInvite(orgA, alice.id, bobEmail, "member");
      await bob.anon.rpc("accept_invitation", { p_invite_id: inviteId });

      // Alice's Org-B role is untouched — still 'admin', not demoted to 'guest'.
      const recip = await admin
        .from("org_members")
        .select("role")
        .eq("org_id", orgB)
        .eq("user_id", alice.id)
        .single();
      expect((recip.data as { role: Role }).role).toBe("admin");
    });

    it("redeem_invitations reciprocates for a redeemer who already owns an org", async () => {
      // Alice owns Org A. Dave owns Org D. A pending invite from Alice to Dave
      // exists; Dave redeems the batch (simulating the login-callback path).
      const alice = await makeUser(`alice5-${randomUUID()}@example.com`);
      const orgA = await makeOwnedOrg(alice.anon, "alice5");
      const daveEmail = `dave-${randomUUID()}@example.com`;
      const dave = await makeUser(daveEmail);
      const orgD = await makeOwnedOrg(dave.anon, "dave");

      await seedInvite(orgA, alice.id, daveEmail, "member");
      const { error } = await dave.anon.rpc("redeem_invitations");
      expect(error).toBeNull();

      const recip = await admin
        .from("org_members")
        .select("role")
        .eq("org_id", orgD)
        .eq("user_id", alice.id)
        .single();
      expect(recip.error, "reciprocal via redeem path").toBeNull();
      expect((recip.data as { role: Role }).role).toBe("guest");
    });
  },
);
```

- [ ] **Step 2: Run the suite; confirm it either fails (test project on old schema) or skips (no `.env.test`)**

Run: `pnpm test -- src/lib/org/cross-org-reciprocal-membership.rls.integration.test.ts`
Expected, one of:

- **Skipped** (`↓` / 0 ran) if no `.env.test` with `PULSE_TEST_DB=1` + service-role + a safe (non-DEV/PROD) URL is configured — this is normal; evidence then comes from Task 4's live DEV verification + Task 6's manual E2E.
- **FAIL** on the reciprocal-membership assertions (`reciprocal membership row should exist` → row missing) if a throwaway test project IS configured but the migration isn't applied yet. This is the red state.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/lib/org/cross-org-reciprocal-membership.rls.integration.test.ts
git commit -m "test(org): reciprocal cross-org membership on invite accept (red)"
```

---

## Task 2: The migration — reciprocal insert in both accept RPCs

**Files:**

- Create: `supabase/migrations/<version>_cross-org-reciprocal-membership.sql`

- [ ] **Step 1: Mint the migration file (never hand-stamp the version)**

Run: `scripts/new-migration.sh cross-org-reciprocal-membership`
This prints the created path, e.g. `supabase/migrations/2026071612..._cross-org-reciprocal-membership.sql`. Use that exact version+name everywhere below.

- [ ] **Step 2: Write the migration body**

Paste this into the new file (it `create or replace`s both RPCs; nothing else changes):

```sql
-- Cross-org reciprocal membership.
-- When a user accepts an org invite, also add the INVITER into the invitee's
-- OWNED org as a guest, so per-board sharing works in both directions without a
-- second reverse invite. Security boundary (share_board / can_read_board /
-- board_members / RLS) is unchanged: reciprocity is a real, auditable membership
-- created only inside these SECURITY DEFINER RPCs.

-- 1. accept_invitation — in-app accept path.
create or replace function public.accept_invitation(p_invite_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org_id uuid;
  v_role public.org_role;
  v_invited_by uuid;
  v_home_org uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select lower(u.email::text) into v_email from auth.users u where u.id = v_uid;

  update public.org_invitations
     set status = 'accepted', accepted_at = now()
   where id = p_invite_id
     and status = 'pending'
     and lower(email) = v_email
   returning org_id, role, invited_by into v_org_id, v_role, v_invited_by;

  if v_org_id is null then
    raise exception 'invitation not found';
  end if;

  insert into public.org_members (org_id, user_id, role)
  values (v_org_id, v_uid, v_role)
  on conflict (org_id, user_id) do nothing;

  -- Reciprocal: inviter → invitee's owned org (0 or 1) as guest.
  select org_id into v_home_org
    from public.org_members
   where user_id = v_uid and role = 'owner'
   limit 1;

  if v_home_org is not null
     and v_invited_by is not null
     and v_invited_by <> v_uid then
    insert into public.org_members (org_id, user_id, role)
    values (v_home_org, v_invited_by, 'guest'::public.org_role)
    on conflict (org_id, user_id) do nothing;  -- never demote an existing role
  end if;

  return v_org_id;
end; $$;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- 2. redeem_invitations — login-callback batch path.
create or replace function public.redeem_invitations()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text; v_count int := 0;
  v_home_org uuid;
begin
  if v_uid is null then return 0; end if;
  select email::text into v_email from auth.users where id = v_uid;
  if v_email is null then return 0; end if;

  -- The redeemer's owned org is stable across this call (redemption only adds
  -- member/guest rows, never owner rows). Brand-new invite-only users own none
  -- yet at redeem time, so reciprocity correctly no-ops for them.
  select org_id into v_home_org
    from public.org_members
   where user_id = v_uid and role = 'owner'
   limit 1;

  with redeemed as (
    update public.org_invitations
       set status = 'accepted', accepted_at = now()
     where status = 'pending' and lower(email) = lower(v_email)
     returning org_id, role, invited_by
  ), inserted as (
    insert into public.org_members (org_id, user_id, role)
    select org_id, v_uid, role from redeemed
    on conflict (org_id, user_id) do nothing
    returning 1
  ), reciprocal as (
    -- Data-modifying CTE runs to completion even though the final SELECT does
    -- not reference it. distinct dedupes repeat inviters within one batch.
    insert into public.org_members (org_id, user_id, role)
    select distinct v_home_org, r.invited_by, 'guest'::public.org_role
      from redeemed r
     where v_home_org is not null
       and r.invited_by is not null
       and r.invited_by <> v_uid
    on conflict (org_id, user_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end; $$;
grant execute on function public.redeem_invitations() to authenticated;
```

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/*_cross-org-reciprocal-membership.sql
git commit -m "feat(org): reciprocal cross-org membership on invite accept"
```

---

## Task 3: Apply to DEV and verify the ledger

- [ ] **Step 1: Apply the migration to DEV via the `supabase-dev` MCP**

Call `mcp__supabase-dev__apply_migration` with **the same version + name** as the committed file (e.g. name `2026071612..._cross-org-reciprocal-membership`), body = the migration SQL from Task 2.

- [ ] **Step 2: Verify the ledger matches the committed file**

Call `mcp__supabase-dev__list_migrations`. Confirm the new version+name appears exactly once and matches the filename. If there's any drift, run `scripts/reconcile-migration-version.sh` per AGENTS.md.

- [ ] **Step 3: Regenerate types and confirm a no-op diff**

Run: `pnpm db:types`
Then: `git status --short src/types/database.types.ts`
Expected: **no change** (both RPC signatures are unchanged — `accept_invitation` still returns `uuid`, `redeem_invitations` still returns `int`; no tables/columns/enums added). If the file changed, inspect why before proceeding — an unexpected diff means the migration altered a signature it shouldn't have.

---

## Task 4: Prove it live on DEV (green)

- [ ] **Step 1: If a throwaway test project is configured, run the suite green**

If `.env.test` provides `PULSE_TEST_DB=1` + `SUPABASE_SERVICE_ROLE_KEY` + a safe (non-DEV/PROD) `NEXT_PUBLIC_SUPABASE_URL`, first apply the migration to **that** project too (via its MCP or CLI), then:

Run: `pnpm test -- src/lib/org/cross-org-reciprocal-membership.rls.integration.test.ts`
Expected: **all 5 tests PASS**.

- [ ] **Step 2: If no test project exists, verify live on DEV in a rolled-back transaction**

The integration suite self-skips without `.env.test`; get live evidence directly against DEV using `mcp__supabase-dev__execute_sql`. This impersonates a user by setting the JWT claim inside a transaction, then rolls back so DEV is untouched. Substitute two real DEV `auth.users` ids you own for `:bob` (invitee, owns an org) and `:alice` (inviter) — or seed throwaway ones. Run as a single statement:

```sql
begin;
  -- Arrange: Alice owns org_a, Bob owns org_b, pending invite Alice->Bob.
  -- (Use existing owned orgs, or insert throwaway organizations + owner
  --  org_members rows for two throwaway auth user ids here.)
  insert into public.org_invitations (org_id, email, role, invited_by, status)
  values (:org_a, lower(:bob_email), 'member', :alice, 'pending')
  returning id \gset

  -- Act: accept as Bob.
  set local request.jwt.claims = json_build_object('sub', :'bob')::text;
  select public.accept_invitation(:'id');

  -- Assert: Alice is now a guest of Bob's owned org (org_b).
  select role from public.org_members
   where org_id = :org_b and user_id = :alice;   -- expect: guest
rollback;
```

Expected: the final SELECT returns `guest`. (If your MCP can't do `\gset`/`set local` in one call, run the arrange/act/assert as one `do $$ … $$` block with a nested `assert`, still wrapped in `begin … rollback`.) Record the observed `guest` result as the evidence.

---

## Task 5: Invite-accept UI — reciprocity notice

**Files:**

- Modify: `src/components/notifications/InvitationsSection.tsx` (pending-invite `<li>`, after the `<p>`)
- Create: `src/components/notifications/InvitationsSection.test.tsx`

Load the `pulse-ui` skill before touching the component (working agreement #3). The inviter's name is **not** available to this component (`my_pending_invitations` returns only `org_name`/`role`), so the copy is generic — no RPC/type change.

- [ ] **Step 1: Write the failing component test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InvitationsSection } from "./InvitationsSection";

describe("InvitationsSection", () => {
  const invite = {
    id: "11111111-1111-1111-1111-111111111111",
    org_id: "22222222-2222-2222-2222-222222222222",
    org_name: "Acme",
    role: "member" as const,
    created_at: new Date(0).toISOString(),
  };

  it("shows the reciprocity notice on a pending invite", () => {
    render(
      <InvitationsSection
        invites={[invite]}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        /collaborate on boards you share from your own workspace/i,
      ),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `pnpm test -- src/components/notifications/InvitationsSection.test.tsx`
Expected: FAIL — notice text not found.

- [ ] **Step 3: Add the notice line to the component**

In `src/components/notifications/InvitationsSection.tsx`, inside the `invites.map(...)` `<li>`, immediately after the closing `</p>` of the "You've been invited to…" line and before `<div className="flex gap-2">`, add:

```tsx
<p className="text-muted-foreground text-xs">
  Accepting also lets the person who invited you collaborate on boards you share
  from your own workspace.
</p>
```

- [ ] **Step 4: Run the test; confirm it passes**

Run: `pnpm test -- src/components/notifications/InvitationsSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/notifications/InvitationsSection.tsx src/components/notifications/InvitationsSection.test.tsx
git commit -m "feat(org): note reciprocal sharing on invite accept"
```

---

## Task 6: Gates, manual E2E, finish

- [ ] **Step 1: Run all four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. (The new integration suite self-skips unless a test project is configured — that's expected and does not fail the run.)

- [ ] **Step 2: Manual E2E on DEV (human acceptance path)**

With two accounts you control (each having created their own org during onboarding):

1. As **User A**, go to Settings → Members → invite **User B**'s email.
2. As **User B**, open the notifications bell → pending invitations. Confirm the new line "Accepting also lets the person who invited you collaborate on boards you share from your own workspace." is shown. Click **Accept**.
3. Still as **User B**, open one of **B's own** boards → **Share** → confirm **User A** now appears in the people list. Share it as Viewer.
4. As **User A**, switch to (or open) the org context and confirm **B's** shared board is visible/readable. This is the direction that was impossible before.
5. Sanity: confirm A can still share A's boards with B (unchanged forward direction).

Expected: sharing works **both** directions with only the single invite from A.

- [ ] **Step 3: Finish the task (auto-integrates, gates, merges to develop)**

Run: `scripts/finish-task.sh`
Expected: rebases onto latest `develop`, runs the four gates against the merged state, merges `task/cross-org-reciprocal-membership` into `develop`, pushes, removes the worktree and branch. If it stops on a rebase conflict, resolve `git rebase develop` and re-run.

> The DEV migration was already applied in Task 3. Promotion to prod (and the prod migration) happens later via `/promote` + `/sync-prod` — out of scope for this task.

---

## Self-Review

**Spec coverage:**

- §2/§5a reciprocal on `accept_invitation` → Task 2 Step 2 (RPC 1) + Task 1 test 1.
- §5b reciprocal on `redeem_invitations` → Task 2 Step 2 (RPC 2) + Task 1 test 5.
- §5c migration via `new-migration.sh`, apply to DEV, verify ledger, db:types no-op → Task 2 Step 1, Task 3.
- §5d UI copy (generic, no inviter name — matches the harness finding that inviter isn't in the UI type) → Task 5.
- §3 Non-Goal "no security-boundary change" → migration only `create or replace`s the two RPCs; no policy/table touched. §6 upheld.
- §7 edge cases: zero-owned-org skip → test 3; on-conflict-preserve → test 4; self-invite guard (`v_invited_by <> v_uid`) present in both RPCs.
- §10 testing: integration proof (tests 1–5) + reverse-share E2E (test 2) + manual E2E (Task 6 Step 2) + isolation invariant is implicitly held (no RLS change).
- §11 execution DAG: T1(migration)→T2(tests)→T4(gates) with T3(UI copy) parallel — reflected as Tasks 2→1/4→6 with Task 5 independent.

**Placeholder scan:** No TBD/TODO. The only "mirror the sibling file" reference is Task 1 test 2's board-creation block (the exact `create_board` args live in `board-sharing.rls.integration.test.ts`); the call is shown with its known args (`p_workspace_id`, `p_name`) and the builder confirms against that file. Acceptable — not a code-behavior placeholder.

**Type consistency:** `Role = Database["public"]["Enums"]["org_role"]` used throughout; RPC names (`accept_invitation`, `redeem_invitations`, `create_organization`, `create_board`, `share_board`) match generated types; `PendingInvitation` shape in the component test matches `my_pending_invitations` Returns (`id/org_id/org_name/role/created_at`).
