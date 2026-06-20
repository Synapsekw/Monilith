# In-app Organization Invite Acceptance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in user see pending org invitation(s) in the notification bell and Accept/Decline them in-app, with no email required; let admins see declined invites and re-invite.

**Architecture:** Three `SECURITY DEFINER` RPCs key all invitee-facing reads/writes off the caller's auth email (`my_pending_invitations`, `accept_invitation`, `decline_invitation`). A small typed contract derived from the generated DB types feeds a react-query data layer and a presentational `InvitationsSection` rendered inside the existing `NotificationsBell`. Admin Settings is extended to surface declined invites with a Re-invite affordance.

**Tech Stack:** Next.js 16 (App Router, RSC), Supabase Postgres + RLS, `@supabase/ssr`, TanStack Query, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-20-in-app-invite-accept-design.md`

---

## File Structure

| File                                                       | Task | Responsibility                                         |
| ---------------------------------------------------------- | ---- | ------------------------------------------------------ |
| `supabase/migrations/20260620110000_invite_acceptance.sql` | 1    | status enum relax + 3 RPCs                             |
| `src/types/database.types.ts`                              | 1    | regenerated (RPC signatures)                           |
| `src/lib/collaboration/invitations.ts`                     | 1    | `PendingInvitation` type + `invitationsKey` (contract) |
| `src/lib/org/invite-acceptance.rls.integration.test.ts`    | 1    | RPC behaviour + email-scoping                          |
| `src/lib/collaboration/invitations-data.ts`                | 2    | pure supabase calls (fetch/accept/decline)             |
| `src/lib/collaboration/invitations-data.test.ts`           | 2    | unit tests for the pure calls                          |
| `src/lib/collaboration/use-invitations.ts`                 | 2    | react-query hook (read)                                |
| `src/lib/collaboration/use-invitation-mutations.ts`        | 2    | react-query hooks (accept/decline)                     |
| `src/components/notifications/InvitationsSection.tsx`      | 4    | presentational invite list                             |
| `src/components/notifications/InvitationsSection.test.tsx` | 4    | render + accept/decline callbacks                      |
| `src/components/notifications/NotificationsBell.tsx`       | 5    | wire hooks + section + badge                           |
| `src/components/notifications/NotificationsBell.test.tsx`  | 5    | badge includes invites; section renders                |
| `src/app/settings/page.tsx`                                | 3    | query pending **+** declined                           |
| `src/components/settings/invite-panel.tsx`                 | 3    | Re-invite for declined rows                            |
| `src/components/settings/invite-panel.test.tsx`            | 3    | Re-invite behaviour                                    |

## Execution DAG

```
Batch A (parallel):  Task 1 ── DB + contract        Task 3 ── Admin Settings (independent)
Batch B (parallel):  Task 2 ── data layer (needs 1) Task 4 ── InvitationsSection (needs 1's type)
Batch C:             Task 5 ── bell wiring (needs 2 + 4)
```

- **Dependencies:** 1 → 2; 1 → 4; (2, 4) → 5. Task 3 depends on nothing new (it only filters on the existing `status` text column and renders UI), so it runs in Batch A.
- **Parallel batches:** **[1, 3]** → **[2, 4]** → **[5]**.
- **Critical path:** 1 → 2 → 5 (three hops). Task 3 overlaps the whole chain; Task 4 overlaps Task 2.
- **Worktrees:** Within a batch, dispatch the tasks concurrently. Batch A (1 & 3) and Batch B (2 & 4) touch disjoint files but share the `develop` checkout — give each concurrent task its own git worktree (`superpowers:using-git-worktrees`) to avoid clobbering, then land sequentially.

---

## Task 1: DB migration + RPCs + typed contract

**Files:**

- Create: `supabase/migrations/20260620110000_invite_acceptance.sql`
- Modify (regenerate): `src/types/database.types.ts`
- Create: `src/lib/collaboration/invitations.ts`
- Test: `src/lib/org/invite-acceptance.rls.integration.test.ts`

> Note: `20260620110000` is greater than the current latest migration `20260620100001_board_sharing_storage_rls.sql`. If a newer migration has landed since, bump the prefix so this sorts last (`ls supabase/migrations | tail -1`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260620110000_invite_acceptance.sql`:

```sql
-- In-app invite acceptance: allow 'declined' status + invitee-facing RPCs.

-- 1. Relax the status check to permit 'declined'.
alter table public.org_invitations
  drop constraint if exists org_invitations_status_check;
alter table public.org_invitations
  add constraint org_invitations_status_check
  check (status in ('pending', 'accepted', 'revoked', 'declined'));

-- 2. Pending invitations addressed to the calling user (matched by email),
--    with the org name (which the invitee cannot read directly yet).
create function public.my_pending_invitations()
returns table (
  id uuid,
  org_id uuid,
  org_name text,
  role public.org_role,
  created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select i.id, i.org_id, o.name, i.role, i.created_at
    from public.org_invitations i
    join public.organizations o on o.id = i.org_id
   where i.status = 'pending'
     and lower(i.email) = (
       select lower(u.email::text) from auth.users u where u.id = (select auth.uid())
     );
$$;
grant execute on function public.my_pending_invitations() to authenticated;

-- 3. Accept a specific invitation addressed to the caller's email.
create function public.accept_invitation(p_invite_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org_id uuid;
  v_role public.org_role;
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
   returning org_id, role into v_org_id, v_role;

  if v_org_id is null then
    raise exception 'invitation not found';
  end if;

  insert into public.org_members (org_id, user_id, role)
  values (v_org_id, v_uid, v_role)
  on conflict (org_id, user_id) do nothing;

  return v_org_id;
end; $$;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- 4. Decline a specific invitation addressed to the caller's email.
create function public.decline_invitation(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select lower(u.email::text) into v_email from auth.users u where u.id = v_uid;

  update public.org_invitations
     set status = 'declined'
   where id = p_invite_id
     and status = 'pending'
     and lower(email) = v_email;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'invitation not found';
  end if;
end; $$;
grant execute on function public.decline_invitation(uuid) to authenticated;
```

- [ ] **Step 2: Apply the migration to the linked project**

Run: `supabase db push`
Expected: the new migration applies cleanly (no errors).
(Alternative if `db push` is unavailable in this environment: apply the same SQL via the Supabase MCP `apply_migration` tool with name `invite_acceptance`.)

- [ ] **Step 3: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` now contains `my_pending_invitations`, `accept_invitation`, and `decline_invitation` under `Database["public"]["Functions"]`.

Verify: `grep -c "my_pending_invitations\|accept_invitation\|decline_invitation" src/types/database.types.ts`
Expected: ≥ 3.

- [ ] **Step 4: Write the typed contract**

Create `src/lib/collaboration/invitations.ts`:

```ts
import type { Database } from "@/types/database.types";

/** One pending invitation as returned by the my_pending_invitations RPC. */
export type PendingInvitation =
  Database["public"]["Functions"]["my_pending_invitations"]["Returns"][number];

/** TanStack Query cache key for a user's pending invitations. */
export function invitationsKey(userId: string) {
  return ["invitations", userId] as const;
}
```

> If `pnpm typecheck` reports that `["Returns"]` is not an array (Supabase occasionally emits a non-array for table-returning functions), drop the trailing `[number]`.

- [ ] **Step 5: Write the failing integration test**

Create `src/lib/org/invite-acceptance.rls.integration.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PW = "Test-Password-123!";
type Role = Database["public"]["Enums"]["org_role"];

describe.skipIf(!SERVICE_ROLE_KEY)("invite acceptance RPCs", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];
  let owner: { id: string; anon: SupabaseClient<Database> };
  let orgId: string;

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

  async function seedInvite(email: string, role: Role = "member") {
    const { data, error } = await admin
      .from("org_invitations")
      .insert({
        org_id: orgId,
        email,
        role,
        invited_by: owner.id,
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
    owner = await makeUser(`invite-owner-${randomUUID()}@example.com`);
    const { data: org, error } = await owner.anon.rpc("create_organization", {
      p_name: "Invite Org",
      p_slug: `invite-${randomUUID().slice(0, 8)}`,
    });
    expect(error).toBeNull();
    orgId = (org as { id: string }).id;
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("my_pending_invitations returns the caller's pending invite with org name", async () => {
    const email = `invitee-${randomUUID()}@example.com`;
    await seedInvite(email);
    const invitee = await makeUser(email);
    const { data, error } = await invitee.anon.rpc("my_pending_invitations");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].org_id).toBe(orgId);
    expect(data![0].org_name).toBe("Invite Org");
    expect(data![0].role).toBe("member");
  });

  it("does not return invites addressed to a different email", async () => {
    await seedInvite(`someone-else-${randomUUID()}@example.com`);
    const stranger = await makeUser(`stranger-${randomUUID()}@example.com`);
    const { data, error } = await stranger.anon.rpc("my_pending_invitations");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("accept_invitation enrolls the caller and marks the invite accepted", async () => {
    const email = `accepter-${randomUUID()}@example.com`;
    const inviteId = await seedInvite(email, "admin");
    const invitee = await makeUser(email);
    const { data: returnedOrg, error } = await invitee.anon.rpc(
      "accept_invitation",
      {
        p_invite_id: inviteId,
      },
    );
    expect(error).toBeNull();
    expect(returnedOrg).toBe(orgId);

    const { data: membership } = await admin
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", invitee.id)
      .single();
    expect((membership as { role: Role }).role).toBe("admin");

    const { data: inv } = await admin
      .from("org_invitations")
      .select("status")
      .eq("id", inviteId)
      .single();
    expect((inv as { status: string }).status).toBe("accepted");
  });

  it("accept_invitation rejects an invite addressed to a different email", async () => {
    const inviteId = await seedInvite(`victim-${randomUUID()}@example.com`);
    const attacker = await makeUser(`attacker-${randomUUID()}@example.com`);
    const { error } = await attacker.anon.rpc("accept_invitation", {
      p_invite_id: inviteId,
    });
    expect(error).not.toBeNull();
    const { data: m } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", attacker.id)
      .maybeSingle();
    expect(m).toBeNull();
  });

  it("decline_invitation marks the invite declined", async () => {
    const email = `decliner-${randomUUID()}@example.com`;
    const inviteId = await seedInvite(email);
    const invitee = await makeUser(email);
    const { error } = await invitee.anon.rpc("decline_invitation", {
      p_invite_id: inviteId,
    });
    expect(error).toBeNull();
    const { data: inv } = await admin
      .from("org_invitations")
      .select("status")
      .eq("id", inviteId)
      .single();
    expect((inv as { status: string }).status).toBe("declined");
  });
});
```

- [ ] **Step 6: Run the integration test**

Run: `pnpm test src/lib/org/invite-acceptance.rls.integration.test.ts`
Expected: PASS locally (with `.env.local` service-role key). In CI without the key it reports as skipped — that is correct.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add supabase/migrations/20260620110000_invite_acceptance.sql src/types/database.types.ts src/lib/collaboration/invitations.ts src/lib/org/invite-acceptance.rls.integration.test.ts
git commit -m "feat(invites): invitee-facing RPCs + status='declined' + typed contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Invitee data layer (pure calls + hooks)

**Depends on:** Task 1 (RPC signatures in generated types; `PendingInvitation`/`invitationsKey`).

**Files:**

- Create: `src/lib/collaboration/invitations-data.ts`
- Test: `src/lib/collaboration/invitations-data.test.ts`
- Create: `src/lib/collaboration/use-invitations.ts`
- Create: `src/lib/collaboration/use-invitation-mutations.ts`

- [ ] **Step 1: Write the failing unit test for the pure calls**

Create `src/lib/collaboration/invitations-data.test.ts` (mirrors `src/lib/auth/redeem.test.ts`):

```ts
import { describe, expect, it, vi } from "vitest";
import {
  fetchPendingInvitations,
  acceptInvitation,
  declineInvitation,
} from "./invitations-data";

describe("invitations-data", () => {
  it("fetchPendingInvitations returns the rows", async () => {
    const rows = [
      {
        id: "i1",
        org_id: "o1",
        org_name: "Acme",
        role: "member",
        created_at: "t",
      },
    ];
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: rows, error: null }),
    } as never;
    expect(await fetchPendingInvitations(supabase)).toEqual(rows);
  });

  it("fetchPendingInvitations returns [] on error", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "x" } }),
    } as never;
    expect(await fetchPendingInvitations(supabase)).toEqual([]);
  });

  it("acceptInvitation passes the id and returns the org id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "org-9", error: null });
    const supabase = { rpc } as never;
    expect(await acceptInvitation(supabase, "inv-1")).toBe("org-9");
    expect(rpc).toHaveBeenCalledWith("accept_invitation", {
      p_invite_id: "inv-1",
    });
  });

  it("acceptInvitation throws on error", async () => {
    const supabase = {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: "nope" } }),
    } as never;
    await expect(acceptInvitation(supabase, "inv-1")).rejects.toThrow("nope");
  });

  it("declineInvitation passes the id and throws on error", async () => {
    const ok = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as never;
    await expect(declineInvitation(ok, "inv-2")).resolves.toBeUndefined();
    const bad = {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: "boom" } }),
    } as never;
    await expect(declineInvitation(bad, "inv-2")).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test src/lib/collaboration/invitations-data.test.ts`
Expected: FAIL — `Cannot find module './invitations-data'`.

- [ ] **Step 3: Implement the pure calls**

Create `src/lib/collaboration/invitations-data.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { PendingInvitation } from "./invitations";

type Client = SupabaseClient<Database>;

export async function fetchPendingInvitations(
  supabase: Client,
): Promise<PendingInvitation[]> {
  const { data, error } = await supabase.rpc("my_pending_invitations");
  if (error) return [];
  return (data ?? []) as PendingInvitation[];
}

export async function acceptInvitation(
  supabase: Client,
  inviteId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_invite_id: inviteId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function declineInvitation(
  supabase: Client,
  inviteId: string,
): Promise<void> {
  const { error } = await supabase.rpc("decline_invitation", {
    p_invite_id: inviteId,
  });
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm test src/lib/collaboration/invitations-data.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Implement the read hook**

Create `src/lib/collaboration/use-invitations.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { invitationsKey, type PendingInvitation } from "./invitations";
import { fetchPendingInvitations } from "./invitations-data";

export function useInvitations(userId: string) {
  const query = useQuery({
    queryKey: invitationsKey(userId),
    enabled: !!userId,
    staleTime: Infinity,
    queryFn: (): Promise<PendingInvitation[]> =>
      fetchPendingInvitations(createClient()),
  });
  const invites = query.data ?? [];
  return { query, invites, count: invites.length };
}
```

- [ ] **Step 6: Implement the mutation hooks**

Create `src/lib/collaboration/use-invitation-mutations.ts`:

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { invitationsKey } from "./invitations";
import { acceptInvitation, declineInvitation } from "./invitations-data";

export function useInvitationMutations(userId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: invitationsKey(userId) });

  const accept = useMutation({
    mutationFn: (inviteId: string) =>
      acceptInvitation(createClient(), inviteId),
    onSettled: invalidate,
  });
  const decline = useMutation({
    mutationFn: (inviteId: string) =>
      declineInvitation(createClient(), inviteId),
    onSettled: invalidate,
  });

  return { accept, decline };
}
```

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/lib/collaboration/invitations-data.ts src/lib/collaboration/invitations-data.test.ts src/lib/collaboration/use-invitations.ts src/lib/collaboration/use-invitation-mutations.ts
git commit -m "feat(invites): invitee data layer (fetch/accept/decline + react-query hooks)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Admin Settings — declined invites + Re-invite

**Depends on:** nothing new (filters the existing `status` text column; runs in Batch A).

**Files:**

- Modify: `src/components/settings/invite-panel.tsx`
- Test: `src/components/settings/invite-panel.test.tsx`
- Modify: `src/app/settings/page.tsx:32-47`

- [ ] **Step 1: Write the failing test for Re-invite**

Add to `src/components/settings/invite-panel.test.tsx` (inside the existing `describe("InvitePanel", ...)` block):

```ts
  it("shows Re-invite (not Revoke) for a declined invite and re-invites with the same email/role", () => {
    const invites: Invite[] = [
      {
        id: "inv-2",
        email: "declined@x.com",
        role: "member",
        status: "declined",
        created_at: new Date().toISOString(),
      },
    ];
    render(<InvitePanel orgId={ORG} invites={invites} />);
    const row = screen.getByText("declined@x.com").closest("li")!;
    expect(within(row).queryByRole("button", { name: "Revoke" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Re-invite" }));
    expect(inviteMember).toHaveBeenCalledWith({
      orgId: ORG,
      email: "declined@x.com",
      role: "member",
    });
  });
```

Also update the existing pending-invite fixtures in this file to include `status: "pending"` (the `Invite` type now requires it). For the `"calls revokeInvite..."` test, add `status: "pending"` to the `inv-1` fixture.

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test src/components/settings/invite-panel.test.tsx`
Expected: FAIL — `status` missing on `Invite`, and no `Re-invite` button found.

- [ ] **Step 3: Add `status` to the `Invite` type and branch the row action**

In `src/components/settings/invite-panel.tsx`, extend the type (around line 9-14):

```ts
export type Invite = {
  id: string;
  email: string;
  role: string;
  status: "pending" | "declined";
  created_at: string;
};
```

Replace the row's action button (the `<Button ... >Revoke</Button>` block, lines ~100-114) with a status branch:

```tsx
{
  i.status === "declined" ? (
    <Button
      size="sm"
      variant="ghost"
      className="shrink-0"
      disabled={pending}
      onClick={() =>
        start(async () => {
          setError(null);
          const r = await inviteMember({ orgId, email: i.email, role: i.role });
          if (!r.ok) setError(r.error);
        })
      }
    >
      Re-invite
    </Button>
  ) : (
    <Button
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive shrink-0"
      disabled={pending}
      onClick={() =>
        start(async () => {
          setError(null);
          const r = await revokeInvite({ inviteId: i.id });
          if (!r.ok) setError(r.error);
        })
      }
    >
      Revoke
    </Button>
  );
}
```

Also show the status for declined rows next to the role (in the `<span>` block, after the role span):

```tsx
{
  i.status === "declined" && (
    <span className="text-muted-foreground"> · Declined</span>
  );
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm test src/components/settings/invite-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update the Settings page query to include declined**

In `src/app/settings/page.tsx`, change the invitations query (lines ~34-39) from:

```ts
        supabase
          .from("org_invitations")
          .select("id, email, role, created_at")
          .eq("org_id", org.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
```

to:

```ts
        supabase
          .from("org_invitations")
          .select("id, email, role, status, created_at")
          .eq("org_id", org.id)
          .in("status", ["pending", "declined"])
          .order("created_at", { ascending: false }),
```

> `OrgAdminConsole` passes `invites` straight to `InvitePanel`; the added `status` field flows through with no further change. Verify with `pnpm typecheck` — if `OrgAdminConsole`'s `invites` prop is typed locally, widen it to include `status: "pending" | "declined"` to match the `Invite` type.

- [ ] **Step 6: Typecheck, lint + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test src/components/settings/invite-panel.test.tsx`
Expected: PASS.

```bash
git add src/components/settings/invite-panel.tsx src/components/settings/invite-panel.test.tsx src/app/settings/page.tsx
git commit -m "feat(invites): admin Settings shows declined invites with Re-invite

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: InvitationsSection (presentational)

**Depends on:** Task 1 (`PendingInvitation` type). Runs parallel to Task 2.

**Files:**

- Create: `src/components/notifications/InvitationsSection.tsx`
- Test: `src/components/notifications/InvitationsSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/notifications/InvitationsSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { InvitationsSection } from "./InvitationsSection";
import type { PendingInvitation } from "@/lib/collaboration/invitations";

const invite: PendingInvitation = {
  id: "inv-1",
  org_id: "org-1",
  org_name: "Acme Inc",
  role: "member",
  created_at: new Date().toISOString(),
};

describe("InvitationsSection", () => {
  it("renders nothing when there are no invites", () => {
    const { container } = render(
      <InvitationsSection
        invites={[]}
        onAccept={() => {}}
        onDecline={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the org name and role and fires Accept/Decline with the invite id", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(
      <InvitationsSection
        invites={[invite]}
        onAccept={onAccept}
        onDecline={onDecline}
      />,
    );
    expect(screen.getByText(/Acme Inc/)).toBeInTheDocument();
    expect(screen.getByText(/member/i)).toBeInTheDocument();

    const row = screen.getByText(/Acme Inc/).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalledWith("inv-1");
    fireEvent.click(within(row).getByRole("button", { name: "Decline" }));
    expect(onDecline).toHaveBeenCalledWith("inv-1");
  });

  it("renders an error message when provided", () => {
    render(
      <InvitationsSection
        invites={[invite]}
        onAccept={() => {}}
        onDecline={() => {}}
        error="Could not accept"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not accept");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test src/components/notifications/InvitationsSection.test.tsx`
Expected: FAIL — `Cannot find module './InvitationsSection'`.

- [ ] **Step 3: Implement the component**

Create `src/components/notifications/InvitationsSection.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import type { PendingInvitation } from "@/lib/collaboration/invitations";

export function InvitationsSection({
  invites,
  onAccept,
  onDecline,
  pendingId,
  error,
}: {
  invites: readonly PendingInvitation[];
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  pendingId?: string | null;
  error?: string | null;
}) {
  if (invites.length === 0) return null;

  return (
    <div className="border-b">
      <p className="text-muted-foreground px-3 pt-2 text-xs font-medium">
        Invitations
      </p>
      <ul>
        {invites.map((i) => (
          <li key={i.id} className="space-y-2 px-3 py-2 text-sm">
            <p>
              You&apos;ve been invited to{" "}
              <span className="font-medium">{i.org_name}</span>{" "}
              <span className="text-muted-foreground capitalize">
                as {i.role}
              </span>
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={pendingId === i.id}
                onClick={() => onAccept(i.id)}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pendingId === i.id}
                onClick={() => onDecline(i.id)}
              >
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-destructive px-3 pb-2 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm test src/components/notifications/InvitationsSection.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck, lint + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/components/notifications/InvitationsSection.tsx src/components/notifications/InvitationsSection.test.tsx
git commit -m "feat(invites): presentational InvitationsSection for the bell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire the bell

**Depends on:** Task 2 (hooks) + Task 4 (section).

**Files:**

- Modify: `src/components/notifications/NotificationsBell.tsx`
- Test: `src/components/notifications/NotificationsBell.test.tsx`

- [ ] **Step 1: Write the failing test (extend the existing suite)**

Replace `src/components/notifications/NotificationsBell.test.tsx` with (adds invite mocks + assertions; keeps existing badge tests, now summing invites):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PendingInvitation } from "@/lib/collaboration/invitations";

const markRead = vi.fn();
const markAllRead = vi.fn();
const acceptMutate = vi.fn();
const declineMutate = vi.fn();
let mockUnread = 0;
let mockNotifications: unknown[] = [];
let mockInvites: PendingInvitation[] = [];

vi.mock("@/lib/collaboration/use-notifications", () => ({
  useNotifications: () => ({
    query: { data: { notifications: mockNotifications } },
    unread: mockUnread,
  }),
}));
vi.mock("@/lib/collaboration/use-notification-mutations", () => ({
  useNotificationMutations: () => ({ markRead, markAllRead }),
}));
vi.mock("@/lib/collaboration/use-invitations", () => ({
  useInvitations: () => ({
    query: { data: mockInvites },
    invites: mockInvites,
    count: mockInvites.length,
  }),
}));
vi.mock("@/lib/collaboration/use-invitation-mutations", () => ({
  useInvitationMutations: () => ({
    accept: {
      mutate: acceptMutate,
      isPending: false,
      variables: undefined,
      error: null,
    },
    decline: {
      mutate: declineMutate,
      isPending: false,
      variables: undefined,
      error: null,
    },
  }),
}));

import { NotificationsBell } from "@/components/notifications/NotificationsBell";

const invite: PendingInvitation = {
  id: "inv-1",
  org_id: "org-1",
  org_name: "Acme Inc",
  role: "member",
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  mockUnread = 0;
  mockNotifications = [];
  mockInvites = [];
  acceptMutate.mockReset();
  declineMutate.mockReset();
});

describe("NotificationsBell", () => {
  it("badge counts unread notifications plus pending invites", () => {
    mockUnread = 2;
    mockInvites = [invite];
    render(<NotificationsBell userId="u1" />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders no badge when there are no unread and no invites", () => {
    render(<NotificationsBell userId="u1" />);
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("shows the invitation and accepts it by id", () => {
    mockInvites = [invite];
    render(<NotificationsBell userId="u1" />);
    fireEvent.click(screen.getByLabelText("Notifications"));
    expect(screen.getByText(/Acme Inc/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(acceptMutate).toHaveBeenCalled();
    expect(acceptMutate.mock.calls[0][0]).toBe("inv-1");
  });
});
```

> The Popover content may render only after the trigger is clicked — the third test clicks the `Notifications` trigger first. If the project's Popover renders content eagerly, the click is harmless.

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test src/components/notifications/NotificationsBell.test.tsx`
Expected: FAIL — badge shows `2` not `3`; no invite text/Accept button.

- [ ] **Step 3: Wire the bell**

Replace `src/components/notifications/NotificationsBell.tsx` with:

```tsx
"use client";

import { Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNotifications } from "@/lib/collaboration/use-notifications";
import { useNotificationMutations } from "@/lib/collaboration/use-notification-mutations";
import { useInvitations } from "@/lib/collaboration/use-invitations";
import { useInvitationMutations } from "@/lib/collaboration/use-invitation-mutations";
import type { AppNotification } from "@/lib/collaboration/notifications-cache";
import { NotificationsList } from "./NotificationsList";
import { InvitationsSection } from "./InvitationsSection";

export function NotificationsBell({ userId }: { userId: string }) {
  const { query, unread } = useNotifications(userId);
  const { markRead, markAllRead } = useNotificationMutations(userId);
  const { invites, count: inviteCount } = useInvitations(userId);
  const { accept, decline } = useInvitationMutations(userId);

  const badge = unread + inviteCount;
  const pendingId = accept.isPending
    ? (accept.variables ?? null)
    : decline.isPending
      ? (decline.variables ?? null)
      : null;
  const inviteError = (accept.error ?? decline.error)?.message ?? null;

  function open(n: AppNotification) {
    markRead(n.id);
    if (n.board_id) {
      const u = new URL(window.location.origin + `/boards/${n.board_id}`);
      if (n.item_id) u.searchParams.set("item", n.item_id);
      // Cross-board jump → a real navigation is correct here (unlike in-board
      // view/panel toggles, which use the History API to avoid an RSC refetch).
      window.location.assign(u.toString());
    }
  }

  function onAccept(id: string) {
    // Membership is server data → reload to pull the new org context + boards.
    accept.mutate(id, {
      onSuccess: () => window.location.assign("/"),
    });
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notifications"
        className="hover:bg-accent focus-visible:ring-ring relative grid size-9 place-items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <Bell className="size-4" />
        {badge > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Mark all read
            </button>
          )}
        </div>
        <InvitationsSection
          invites={invites}
          onAccept={onAccept}
          onDecline={(id) => decline.mutate(id)}
          pendingId={pendingId}
          error={inviteError}
        />
        <NotificationsList
          notifications={query.data?.notifications ?? []}
          onOpen={open}
        />
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm test src/components/notifications/NotificationsBell.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Full verification gate + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS (integration test skips in CI without service-role key).

```bash
git add src/components/notifications/NotificationsBell.tsx src/components/notifications/NotificationsBell.test.tsx
git commit -m "feat(invites): surface pending invites in the notification bell with accept/decline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks land)

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
- [ ] Manual smoke (two accounts): admin invites an existing user → that user logs in → bell badge shows 1 → opens bell → sees "You've been invited to {org} as {role}" → **Accept** → lands in the org workspace as a member. Repeat with **Decline** → invite leaves the bell → admin Settings shows it as _Declined_ with **Re-invite**.

```

```
