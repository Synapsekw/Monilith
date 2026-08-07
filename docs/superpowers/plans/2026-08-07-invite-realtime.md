# Real-Time Org Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pending org invitation appears in the recipient's notification bell within a second of being sent, and disappears within a second of being revoked — with no page reload and no polling.

**Architecture:** Give `org_invitations` the two things `notifications` already has: an RLS SELECT policy for the recipient, and membership in the `supabase_realtime` publication. Then subscribe `useInvitations` to postgres INSERT/UPDATE events on that table and invalidate its TanStack Query key, exactly as `useNotifications` does today.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + Realtime + RLS), TanStack Query v5, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-07-invite-realtime-design.md`

## Global Constraints

- Migrations are minted **only** via `scripts/new-migration.sh <slug>` — never hand-stamp a version. Apply to DEV through the `supabase-dev` MCP with the **same version + name** as the committed file, then verify with `pnpm db:ledger-check`.
- Commit identity is pinned to `Danijel Jovanovic <info@synapse-solutions.ai>`. `start-task.sh` already set it in this worktree; do not override.
- Stage explicitly by path (`git add <paths>`). Never `git add -A` / `git add .` / `git commit -a`.
- TypeScript strict; no `any` without written justification.
- Integration suites (`*.integration.test.ts`) **skip unless a dedicated test project + `.env.test` is present**, which is not the case in this worktree. They are written to the existing convention and run under `pnpm test:integration`; they are NOT part of `pnpm test`. Live behavior is instead verified against DEV inside a rolled-back transaction (Task 1, Step 6).
- The four gates must pass before merge: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- No schema type changes in this plan (a policy and a publication do not alter generated types), so `pnpm db:types` is **not** run.

## File Structure

| File                                                                     | Responsibility                                                                                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/<stamp>_invitee_reads_own_invitations.sql` (create) | The invitee SELECT policy + publication membership. The whole server-side change.                                                                     |
| `src/lib/org/invite-acceptance.rls.integration.test.ts` (modify)         | Already owns invitation RLS/RPC coverage and has the `makeUser` / `seedInvite` helpers. The two new policy assertions belong here, not in a new file. |
| `src/lib/collaboration/use-invitations.ts` (modify)                      | Gains the realtime subscription. Stays a single-purpose hook: fetch + subscribe, mirroring `use-notifications.ts`.                                    |
| `src/lib/collaboration/use-invitations.test.tsx` (create)                | New — the hook currently has no test file. Covers subscribe/invalidate/unsubscribe.                                                                   |

## Execution DAG

- **Task 1** (migration + RLS tests) and **Task 2** (hook + hook test) touch disjoint files and have no code-level dependency — Task 2's test mocks Supabase entirely.
- They are nonetheless run **sequentially**, because the end-to-end verification in Task 2 Step 7 requires the policy and publication from Task 1 to be live on DEV.
- Critical path = Task 1 → Task 2. Two tasks, no parallel batch; dispatching agents would cost more coordination than it saves.

---

### Task 1: Let the invitee read (and be pushed) their own invitations

**Files:**

- Create: `supabase/migrations/<stamp>_invitee_reads_own_invitations.sql`
- Modify: `src/lib/org/invite-acceptance.rls.integration.test.ts` (append two `it` blocks inside the existing `describe`)

**Interfaces:**

- Consumes: nothing.
- Produces: a `SELECT` policy named `org_invitations: read own by email` on `public.org_invitations`, and `public.org_invitations` as a member of the `supabase_realtime` publication. Task 2's client subscription is inert without both.

**Context an implementer needs:** `org_invitations` today has exactly three policies — insert/read/update, all gated on `has_org_role(org_id, ARRAY['owner','admin'])` or `is_platform_admin()`. The invitee is not covered by any of them; they reach their invites only through the `SECURITY DEFINER` RPC `my_pending_invitations`. Postgres RLS policies are **permissive** (OR-ed), so adding a SELECT policy widens reads without weakening the admin ones.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe.skipIf(!integrationTargetReady())("invite acceptance RPCs", …)` block in `src/lib/org/invite-acceptance.rls.integration.test.ts`. The `makeUser` and `seedInvite` helpers are already defined at the top of that describe.

```ts
it("lets the invitee read the invitation addressed to them (realtime RLS gate)", async () => {
  const email = `direct-reader-${randomUUID()}@example.com`;
  const inviteId = await seedInvite(email);
  const invitee = await makeUser(email);

  const { data, error } = await invitee.anon
    .from("org_invitations")
    .select("id, status, role")
    .eq("id", inviteId);

  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(data![0].status).toBe("pending");
});

it("does not let a third party read an invitation addressed to someone else", async () => {
  const inviteId = await seedInvite(`target-${randomUUID()}@example.com`);
  const stranger = await makeUser(`nosy-${randomUUID()}@example.com`);

  const { data, error } = await stranger.anon
    .from("org_invitations")
    .select("id")
    .eq("id", inviteId);

  expect(error).toBeNull();
  expect(data).toHaveLength(0);
});
```

The second test is the one that keeps the policy honest: RLS returns an empty set rather than an error, so asserting `toHaveLength(0)` is the real check, not `error`.

- [ ] **Step 2: Run the tests and confirm they SKIP (not pass)**

Run: `pnpm test:integration -- src/lib/org/invite-acceptance.rls.integration.test.ts`

Expected: the whole suite reports **skipped** — there is no `.env.test`, so `integrationTargetReady()` is false. This is the documented state of all 70 integration suites in this repo. A _skipped_ test is not evidence, which is why Step 6 verifies the same two behaviors live against DEV.

- [ ] **Step 3: Mint the migration file**

Run: `scripts/new-migration.sh invitee_reads_own_invitations`

Expected: prints the created path `supabase/migrations/<UTC-stamp>_invitee_reads_own_invitations.sql`. Never hand-write the stamp.

- [ ] **Step 4: Write the migration**

Replace the generated file's contents with:

```sql
-- An invitation names exactly one recipient, but until now only org admins
-- could read org_invitations — invitees reached theirs solely through the
-- SECURITY DEFINER RPC my_pending_invitations. That left no way to PUSH an
-- invite: Realtime evaluates RLS per subscriber, so with no SELECT policy the
-- recipient is never sent the row, and an invite surfaced only on their next
-- full page load. Policies are permissive, so this widens the invitee's read
-- without touching the admin policies.
create policy "org_invitations: read own by email"
  on public.org_invitations
  for select
  to authenticated
  using (lower(email) = lower((select auth.jwt() ->> 'email')));

-- Deliver INSERT (invite sent) and UPDATE (revoked/accepted/declined) to the
-- recipient. Every status transition in the app is an UPDATE, never a DELETE
-- (revokeInvite sets status='revoked'; accept_invitation / decline_invitation
-- set 'accepted' / 'declined'), so default replica identity is sufficient and
-- no DELETE payload is ever emitted.
alter publication supabase_realtime add table public.org_invitations;
```

- [ ] **Step 5: Apply to DEV via the `supabase-dev` MCP**

Call `mcp__supabase-dev__apply_migration` with `name` set to the **exact** `<stamp>_invitee_reads_own_invitations` from Step 3 and `query` set to the file contents verbatim. Version and name must match the committed filename or `pnpm db:ledger-check` fails.

- [ ] **Step 6: Verify the policy live on DEV, in a rolled-back transaction**

Skipped tests are not evidence. Run this through `mcp__supabase-dev__execute_sql` — it impersonates the two roles against real rows and rolls everything back, so no live data is touched:

```sql
begin;
-- a throwaway org + invite addressed to "invitee@example.test"
insert into public.organizations (id, name, slug)
values ('00000000-0000-4000-8000-00000000dead', 'RLS Probe', 'rls-probe-dead');
insert into public.org_invitations (id, org_id, email, role, status)
values ('00000000-0000-4000-8000-00000000beef',
        '00000000-0000-4000-8000-00000000dead',
        'Invitee@Example.test', 'member', 'pending');

set local role authenticated;

-- (a) the recipient sees it, and casing must not matter
set local request.jwt.claims = '{"role":"authenticated","email":"invitee@example.test"}';
select 'recipient' as who, count(*) as visible from public.org_invitations
 where id = '00000000-0000-4000-8000-00000000beef';

-- (b) an unrelated authenticated user sees nothing
set local request.jwt.claims = '{"role":"authenticated","email":"stranger@example.test"}';
select 'stranger' as who, count(*) as visible from public.org_invitations
 where id = '00000000-0000-4000-8000-00000000beef';
rollback;
```

Expected: `recipient → 1`, `stranger → 0`. The mixed-case seed (`Invitee@Example.test`) proves the `lower()` comparison on both sides.

Then confirm publication membership:

```sql
select count(*) from pg_publication_tables
 where pubname = 'supabase_realtime' and tablename = 'org_invitations';
```

Expected: `1`.

- [ ] **Step 7: Verify the ledger matches the committed file**

Run: `pnpm db:ledger-check`
Expected: clean — no drift in either direction.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/*_invitee_reads_own_invitations.sql src/lib/org/invite-acceptance.rls.integration.test.ts
git commit -m "feat(invites): let invitees read their own invitations + publish to realtime"
```

---

### Task 2: Push invitation changes into the bell

**Files:**

- Modify: `src/lib/collaboration/use-invitations.ts`
- Create: `src/lib/collaboration/use-invitations.test.tsx`

**Interfaces:**

- Consumes: the policy + publication from Task 1. `invitationsKey(userId)` from `./invitations` (returns `["invitations", userId] as const`). `fetchPendingInvitations(client)` from `./invitations-data`.
- Produces: no signature change. `useInvitations(userId)` still returns `{ query, invites, count }`, so `NotificationsBell` needs no edit — its badge is already `unread + inviteCount`.

**Context an implementer needs:** copy the shape of `src/lib/collaboration/use-notifications.ts:38-80`. Two deliberate differences from that file: **no channel filter** (recipient matching is case-insensitive on email, which a Realtime filter — exact equality on one column — cannot express, so RLS is the gate), and **invalidate rather than patch the cache** (the payload row has no `org_name`; that is a join on `organizations`, which the invitee cannot read, so only a refetch through the RPC yields a complete `PendingInvitation`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/collaboration/use-invitations.test.tsx`. The Supabase-client mock follows `use-item-collab.test.tsx:6-17`; here the channel also records its handlers so the test can fire a realtime event.

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the browser Supabase client: the RPC read plus the realtime channel the
// hook subscribes to. `handlers` captures each .on() callback by event name so
// a test can fire the event the server would have sent.
const rpc = vi.fn();
const handlers = new Map<string, () => void>();
const channel: Record<string, unknown> = {};
channel.on = vi.fn((_type: string, cfg: { event: string }, cb: () => void) => {
  handlers.set(cfg.event, cb);
  return channel;
});
channel.subscribe = vi.fn(() => channel);
const client = {
  rpc,
  channel: vi.fn(() => channel),
  removeChannel: vi.fn(),
};
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));

import { useInvitations } from "./use-invitations";

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  rpc.mockReset();
  handlers.clear();
  // Both must be cleared: `channel` and `removeChannel` are module-level
  // vi.fn()s, so call counts would otherwise leak across tests and the
  // "does not subscribe without a user id" assertion would see earlier calls.
  client.channel.mockClear();
  client.removeChannel.mockClear();
  rpc.mockResolvedValue({ data: [], error: null });
});

describe("useInvitations", () => {
  it("subscribes to INSERT and UPDATE on org_invitations", async () => {
    const { result } = renderHook(() => useInvitations("u1"), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(client.channel).toHaveBeenCalledWith("invitations:u1");
    expect(handlers.has("INSERT")).toBe(true);
    expect(handlers.has("UPDATE")).toBe(true);
  });

  it("refetches when an invite arrives, so a new invite needs no reload", async () => {
    const { result } = renderHook(() => useInvitations("u1"), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.count).toBe(0));

    rpc.mockResolvedValue({
      data: [
        {
          id: "i1",
          org_id: "o1",
          org_name: "Acme",
          role: "member",
          created_at: "2026-08-07T00:00:00Z",
        },
      ],
      error: null,
    });
    handlers.get("INSERT")!();

    await waitFor(() => expect(result.current.count).toBe(1));
    expect(result.current.invites[0].org_name).toBe("Acme");
  });

  it("refetches when an invite is revoked, so it leaves an open bell", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "i1",
          org_id: "o1",
          org_name: "Acme",
          role: "member",
          created_at: "2026-08-07T00:00:00Z",
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => useInvitations("u1"), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.count).toBe(1));

    // revokeInvite sets status='revoked', so the RPC now returns nothing.
    rpc.mockResolvedValue({ data: [], error: null });
    handlers.get("UPDATE")!();

    await waitFor(() => expect(result.current.count).toBe(0));
  });

  it("removes the channel on unmount", async () => {
    const { result, unmount } = renderHook(() => useInvitations("u1"), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));

    unmount();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("does not subscribe without a user id", () => {
    renderHook(() => useInvitations(""), { wrapper: wrapperFor(newClient()) });
    expect(client.channel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:unit -- src/lib/collaboration/use-invitations.test.tsx`

Expected: FAIL. The subscribe/unmount tests fail because the hook has no effect yet (`client.channel` never called); the two refetch tests fail because nothing invalidates the query.

- [ ] **Step 3: Add the subscription to the hook**

Rewrite `src/lib/collaboration/use-invitations.ts` as:

```ts
"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { invitationsKey, type PendingInvitation } from "./invitations";
import { fetchPendingInvitations } from "./invitations-data";

export function useInvitations(userId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: invitationsKey(userId),
    enabled: !!userId,
    staleTime: Infinity,
    queryFn: (): Promise<PendingInvitation[]> =>
      fetchPendingInvitations(createClient()),
  });

  // Push, don't poll. `staleTime: Infinity` above is only correct because of
  // this subscription: without it an invite surfaced solely on the recipient's
  // next full page load (refetchOnWindowFocus is off globally).
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const key = invitationsKey(userId);

    // Refetch rather than patch the payload row into the cache: the row has no
    // `org_name` (a join on `organizations`, which the invitee cannot read), so
    // only the RPC yields a complete PendingInvitation. Invites are rare, so
    // the extra round-trip is bounded and off the hot path.
    function refetch() {
      void qc.invalidateQueries({ queryKey: key });
    }

    // No filter, deliberately: recipient matching is case-insensitive on email
    // and a Realtime filter is exact equality on one column, so a casing
    // mismatch would silently drop events. The RLS policy is the gate instead.
    const channel = supabase
      .channel(`invitations:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "org_invitations" },
        refetch,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "org_invitations" },
        refetch,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  const invites = query.data ?? [];
  return { query, invites, count: invites.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:unit -- src/lib/collaboration/use-invitations.test.tsx`
Expected: 5 passed.

- [ ] **Step 5: Run the full unit suite for regressions**

Run: `pnpm test`
Expected: all green. `NotificationsBell.test.tsx` and `InvitationsSection.test.tsx` exercise this hook's consumers and must be unaffected — the hook's return shape did not change.

- [ ] **Step 6: Run the four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four pass. Watch typecheck specifically for the `.on("postgres_changes", …)` overload — the config object omits `filter`, which is optional in `RealtimePostgresChangesFilter`.

- [ ] **Step 7: Verify end-to-end against DEV**

With `pnpm dev` running and signed in as a user who has a pending invite seeded by an admin, confirm the invite appears in the bell with no reload. If two accounts are not available, drive it from SQL — insert a `pending` row addressed to the signed-in user's email through `mcp__supabase-dev__execute_sql`, watch the badge increment, then set `status='revoked'` and watch it clear. Delete the probe row afterwards.

- [ ] **Step 8: Commit**

```bash
git add src/lib/collaboration/use-invitations.ts src/lib/collaboration/use-invitations.test.tsx
git commit -m "feat(invites): deliver org invitations over realtime instead of on reload"
```

---

## Closure

- [ ] Run `scripts/finish-task.sh` from inside the worktree. It rebases `task/invite-realtime` onto the latest `develop`, re-runs the gates against the merged state, merges, pushes, then removes the worktree and deletes the branch.
- [ ] Write the numbered "How to test this" walkthrough for the user (where to go, what to click, expected result at each step) — in the closing message.
