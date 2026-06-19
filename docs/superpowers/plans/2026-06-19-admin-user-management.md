# Admin User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the platform-admin nav to the bottom of the sidebar, and add a per-user actions dropdown on `/admin/users` (send reset email, set temporary password with forced change, suspend/reactivate, hard delete with sole-owner block-&-warn).

**Architecture:** Composes existing patterns. New platform server actions in `src/lib/platform/actions.ts` (gated by `isPlatformAdmin()`, audited via `admin_audit_log`), thin positional wrappers in `search-action.ts`, a shadcn `DropdownMenu` + `Dialog` row component, one new `SECURITY DEFINER` RPC for the sole-owner check, and a forced-password-change flow (flag in `app_metadata`, enforced in the layout auth gates, cleared on a new `/change-password` page under the `(auth)` group).

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase (auth admin + RLS + RPC), Zod, Vitest, shadcn/Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-19-admin-user-management-design.md`

---

## File Structure

| File                                                                   | Responsibility                                                               | Action             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------ |
| `src/components/sidebar.tsx`                                           | Sidebar render order; pin admin to bottom                                    | Modify             |
| `supabase/migrations/20260619250000_platform_user_sole_owned_orgs.sql` | RPC: orgs where target is sole active owner                                  | Create             |
| `src/types/database.types.ts`                                          | Regenerated after migration                                                  | Modify (generated) |
| `src/lib/validations/admin.ts`                                         | `platformSetPasswordSchema`                                                  | Modify             |
| `src/lib/platform/actions.ts`                                          | `platformResetUserPassword`, `platformSetUserPassword`, `platformDeleteUser` | Modify             |
| `src/lib/platform/actions.test.ts`                                     | Unit tests for the three new actions                                         | Create             |
| `src/lib/platform/search-action.ts`                                    | Positional client-callable wrappers                                          | Modify             |
| `src/components/admin/user-row-actions.tsx`                            | Dropdown + dialogs row UI                                                    | Modify (rewrite)   |
| `src/app/admin/users/page.tsx`                                         | Pass `email` to the row component                                            | Modify             |
| `src/lib/validations/auth.ts`                                          | `changePasswordSchema`                                                       | Modify             |
| `src/app/auth/actions.ts`                                              | `changeOwnPassword` action                                                   | Modify             |
| `src/components/auth/change-password-form.tsx`                         | Client form for forced change                                                | Create             |
| `src/app/(auth)/change-password/page.tsx`                              | Forced-change page                                                           | Create             |
| `src/lib/auth/session.ts`                                              | `enforcePasswordChange` + hook into `requireUser`                            | Modify             |
| `src/lib/platform/guard.ts`                                            | Hook `enforcePasswordChange` into `requirePlatformAdmin`                     | Modify             |
| `src/app/page.tsx`                                                     | Hook `enforcePasswordChange` for the welcome branch                          | Modify             |

## Execution DAG

- **Batch 1 (parallel):** Task 1 (sidebar), Task 2 (RPC migration + types), Task 3 (validation schema)
- **Batch 2:** Task 4 (server actions + wrappers + tests) — needs Task 2 (delete RPC) + Task 3 (schema)
- **Batch 3 (parallel):** Task 5 (dropdown UI) and Task 6 (forced-change flow) — both need Task 4

Critical path: Task 3 → Task 4 → Task 5. Tasks that touch disjoint files; if run with parallel agents, use git worktrees per working-agreement #1.

---

## Task 1: Sidebar reorder — admin section to the bottom

**Files:**

- Modify: `src/components/sidebar.tsx:105-120` (move `PlatformNav` below the primary nav + workspaces, pin with `mt-auto`)

- [ ] **Step 1: Move `PlatformNav` to the bottom and pin it**

In `src/components/sidebar.tsx`, the current order inside `<aside>` is: `BoardsNav` → `DashboardsNav` → `PlatformNav` → `<nav>` (Goals/Portfolios/Inbox) → Workspaces block. Remove the `PlatformNav` element from its current position (lines 117-120) and re-insert it as the **last child** of `<aside>`, wrapped so it sits at the very bottom.

Delete this block at its current location:

```tsx
<PlatformNav isPlatformAdmin={isPlatformAdmin} collapsed={isCollapsed} />
```

Then, immediately before the closing `</aside>` (after the Workspaces `{!isCollapsed && workspaces.length > 0 ? (...) : null}` block), add:

```tsx
<div className="mt-auto">
  <PlatformNav isPlatformAdmin={isPlatformAdmin} collapsed={isCollapsed} />
</div>
```

`mt-auto` pushes the admin section to the bottom of the flex column (`<aside>` is `flex-col`). `PlatformNav` already returns `null` for non-admins, so the wrapper is inert for them.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type changes; pure JSX move).

- [ ] **Step 3: Verify visually**

Run: `pnpm dev`, sign in as the platform admin (`danijel@synapse-solutions.ai`), confirm the sidebar order top→bottom is Boards → Dashboards → Goals/Portfolios/Inbox → Workspaces, with the **Platform** (admin) section pinned at the bottom. Confirm collapsed mode (⌘\) still renders the admin icons at the bottom.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat(admin): move platform-admin nav to sidebar bottom

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Sole-owner check RPC (migration)

**Files:**

- Create: `supabase/migrations/20260619250000_platform_user_sole_owned_orgs.sql`
- Modify (generated): `src/types/database.types.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260619250000_platform_user_sole_owned_orgs.sql`:

```sql
-- Platform admin: list orgs where the target user is the ONLY active owner.
-- Powers block-&-warn so hard-deleting a user can't strand an org with no owner.
create or replace function public.platform_user_sole_owned_orgs(p_user_id uuid)
returns table(org_id uuid, org_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select o.id, o.name
    from public.org_members m
    join public.organizations o on o.id = m.org_id
    where m.user_id = p_user_id
      and m.role = 'owner'
      and m.deactivated_at is null
      and (
        select count(*)
        from public.org_members m2
        where m2.org_id = m.org_id
          and m2.role = 'owner'
          and m2.deactivated_at is null
      ) = 1;
end;
$$;

revoke all on function public.platform_user_sole_owned_orgs(uuid)
  from public, anon, authenticated;
grant execute on function public.platform_user_sole_owned_orgs(uuid)
  to authenticated;
```

Note: column names (`org_members.user_id/org_id/role/deactivated_at`, `organizations.id/name`) match the existing schema (`20260619200000_org_admin_platform_console.sql`). Gating mirrors `is_platform_admin()` usage in the existing platform RPCs; the authed client supplies `auth.uid()`.

- [ ] **Step 2: Apply the migration**

Apply to the linked Supabase project (use the Supabase MCP `apply_migration` with the file contents, or `supabase migration up` if running a local stack). Expected: function created, no error.

- [ ] **Step 3: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` gains a `platform_user_sole_owned_orgs` entry under `Functions` with `Args: { p_user_id: string }` and a `Returns: { org_id: string; org_name: string }[]`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619250000_platform_user_sole_owned_orgs.sql src/types/database.types.ts
git commit -m "feat(admin): RPC platform_user_sole_owned_orgs for delete guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `platformSetPasswordSchema` validation

**Files:**

- Modify: `src/lib/validations/admin.ts:33-35` (append after `platformUserTargetSchema`)

- [ ] **Step 1: Add the schema**

Append to `src/lib/validations/admin.ts`:

```ts
// Platform: set a temporary password for a user (admin-typed). Min 8 chars.
export const platformSetPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});
export type PlatformSetPasswordInput = z.infer<
  typeof platformSetPasswordSchema
>;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/validations/admin.ts
git commit -m "feat(admin): platformSetPasswordSchema (min 8)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Platform server actions (reset / set-password / delete) + wrappers + tests

**Files:**

- Modify: `src/lib/platform/actions.ts` (add three actions; import the new schema)
- Modify: `src/lib/platform/search-action.ts` (add three positional wrappers)
- Create: `src/lib/platform/actions.test.ts`

Follows the existing `ActionResult` / `fail` / `ok` shape and the `setUserBan` audit pattern already in `actions.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/platform/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getUser = vi.fn();
const resetPasswordForEmail = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    auth: { getUser, resetPasswordForEmail },
  }),
}));

const getUserById = vi.fn();
const updateUserById = vi.fn();
const deleteUser = vi.fn();
const svcInsert = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: { admin: { getUserById, updateUserById, deleteUser } },
    from: () => ({ insert: svcInsert }),
  }),
}));

const isPlatformAdmin = vi.fn();
vi.mock("./guard", () => ({ isPlatformAdmin: () => isPlatformAdmin() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  platformResetUserPassword,
  platformSetUserPassword,
  platformDeleteUser,
} from "./actions";

const actor = "00000000-0000-4000-8000-000000000000";
const target = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: actor } } });
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  getUserById.mockReset().mockResolvedValue({
    data: {
      user: { id: target, email: "t@example.com", app_metadata: { x: 1 } },
    },
    error: null,
  });
  updateUserById
    .mockReset()
    .mockResolvedValue({ data: { user: {} }, error: null });
  deleteUser.mockReset().mockResolvedValue({ error: null });
  svcInsert.mockReset().mockResolvedValue({ error: null });
  isPlatformAdmin.mockReset().mockResolvedValue(true);
});

describe("authorization", () => {
  it("rejects a non-admin caller", async () => {
    isPlatformAdmin.mockResolvedValue(false);
    const r = await platformResetUserPassword({ userId: target });
    expect(r.ok).toBe(false);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("platformResetUserPassword", () => {
  it("sends the reset email and audits", async () => {
    const r = await platformResetUserPassword({ userId: target });
    expect(r.ok).toBe(true);
    expect(resetPasswordForEmail).toHaveBeenCalledWith("t@example.com");
    expect(svcInsert).toHaveBeenCalled();
  });
});

describe("platformSetUserPassword", () => {
  it("rejects a too-short password before any service call", async () => {
    const r = await platformSetUserPassword({
      userId: target,
      password: "short",
    });
    expect(r.ok).toBe(false);
    expect(updateUserById).not.toHaveBeenCalled();
  });
  it("sets the password and flags must_change_password, preserving metadata", async () => {
    const r = await platformSetUserPassword({
      userId: target,
      password: "longenough1",
    });
    expect(r.ok).toBe(true);
    expect(updateUserById).toHaveBeenCalledWith(target, {
      password: "longenough1",
      app_metadata: { x: 1, must_change_password: true },
    });
  });
});

describe("platformDeleteUser", () => {
  it("blocks when the user is the sole owner of an org", async () => {
    rpc.mockResolvedValue({
      data: [{ org_id: "o1", org_name: "Acme" }],
      error: null,
    });
    const r = await platformDeleteUser({ userId: target });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Acme");
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("deletes when no sole-owned orgs, auditing before deletion", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const r = await platformDeleteUser({ userId: target });
    expect(r.ok).toBe(true);
    expect(svcInsert).toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith(target);
  });
  it("refuses self-deletion", async () => {
    const r = await platformDeleteUser({ userId: actor });
    expect(r.ok).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/platform/actions.test.ts`
Expected: FAIL — `platformResetUserPassword`/`platformSetUserPassword`/`platformDeleteUser` are not exported yet.

- [ ] **Step 3: Implement the three actions**

In `src/lib/platform/actions.ts`, update the validations import to include the new schema:

```ts
import {
  platformSetOrgRoleSchema,
  platformUserTargetSchema,
  platformSetPasswordSchema,
} from "@/lib/validations/admin";
```

Append these three exported actions at the end of the file:

```ts
/** Auth-plane: send the target user a Supabase password-recovery email. */
export async function platformResetUserPassword(
  input: unknown,
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
  const { data: target, error: lookErr } = await svc.auth.admin.getUserById(
    parsed.data.userId,
  );
  if (lookErr || !target.user?.email) return fail("Could not find that user.");

  const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
    target.user.email,
  );
  if (resetErr) return fail("Could not send the reset email.");

  await svc.from("admin_audit_log").insert({
    org_id: null,
    actor_id: actor.id,
    actor_kind: "platform",
    action: "platform.user_password_reset",
    target_user_id: parsed.data.userId,
    target_email: target.user.email,
    metadata: {},
  });
  revalidatePath("/admin/users");
  return ok();
}

/** Set a temporary password and force a change at next login. */
export async function platformSetUserPassword(
  input: unknown,
): Promise<ActionResult> {
  const parsed = platformSetPasswordSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const supabase = await createClient();
  const {
    data: { user: actor },
  } = await supabase.auth.getUser();
  if (!actor) return fail("Not authenticated.");
  if (!(await isPlatformAdmin())) return fail("Not authorized.");

  const svc = createServiceClient();
  const { data: target, error: lookErr } = await svc.auth.admin.getUserById(
    parsed.data.userId,
  );
  if (lookErr || !target.user) return fail("Could not find that user.");

  // Merge so we don't clobber existing app_metadata (e.g. provider claims).
  const { error: updErr } = await svc.auth.admin.updateUserById(
    parsed.data.userId,
    {
      password: parsed.data.password,
      app_metadata: {
        ...target.user.app_metadata,
        must_change_password: true,
      },
    },
  );
  if (updErr) return fail("Could not set the password.");

  await svc.from("admin_audit_log").insert({
    org_id: null,
    actor_id: actor.id,
    actor_kind: "platform",
    action: "platform.user_password_set",
    target_user_id: parsed.data.userId,
    target_email: target.user.email ?? null,
    metadata: {},
  });
  revalidatePath("/admin/users");
  return ok();
}

/** Hard-delete a user. Blocked if they're the sole active owner of any org. */
export async function platformDeleteUser(
  input: unknown,
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
  if (actor.id === parsed.data.userId)
    return fail("You can't delete your own account.");

  const { data: soleOrgs, error: checkErr } = await supabase.rpc(
    "platform_user_sole_owned_orgs",
    { p_user_id: parsed.data.userId },
  );
  if (checkErr) return fail("Could not verify org ownership.");
  if (soleOrgs && soleOrgs.length > 0) {
    const names = soleOrgs.map((o) => o.org_name).join(", ");
    return fail(`Reassign ownership first — sole owner of: ${names}.`);
  }

  const svc = createServiceClient();
  // Capture email and audit BEFORE deletion so the record survives the cascade.
  const { data: target } = await svc.auth.admin.getUserById(parsed.data.userId);
  await svc.from("admin_audit_log").insert({
    org_id: null,
    actor_id: actor.id,
    actor_kind: "platform",
    action: "platform.user_deleted",
    target_user_id: parsed.data.userId,
    target_email: target?.user?.email ?? null,
    metadata: {},
  });

  const { error: delErr } = await svc.auth.admin.deleteUser(parsed.data.userId);
  if (delErr) return fail("Could not delete the user.");
  revalidatePath("/admin/users");
  return ok();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/platform/actions.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Add the client-callable wrappers**

In `src/lib/platform/search-action.ts`, extend the imports and add three wrappers (mirrors the existing `deactivateUserAction`/`reactivateUserAction` pattern):

```ts
import {
  platformDeactivateUser,
  platformReactivateUser,
  platformResetUserPassword,
  platformSetUserPassword,
  platformDeleteUser,
} from "./actions";
```

```ts
export async function resetUserPasswordAction(
  userId: string,
): Promise<ActionResult> {
  return platformResetUserPassword({ userId });
}

export async function setUserPasswordAction(
  userId: string,
  password: string,
): Promise<ActionResult> {
  return platformSetUserPassword({ userId, password });
}

export async function deleteUserAction(userId: string): Promise<ActionResult> {
  return platformDeleteUser({ userId });
}
```

- [ ] **Step 6: Typecheck + full test run**

Run: `pnpm typecheck && pnpm test src/lib/platform/actions.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/platform/actions.ts src/lib/platform/actions.test.ts src/lib/platform/search-action.ts
git commit -m "feat(admin): platform reset/set-password/delete user actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Per-user dropdown UI

**Files:**

- Modify (rewrite): `src/components/admin/user-row-actions.tsx`
- Modify: `src/app/admin/users/page.tsx:76` (pass `email`)

- [ ] **Step 1: Rewrite the row component**

Replace the entire contents of `src/components/admin/user-row-actions.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import {
  deactivateUserAction,
  reactivateUserAction,
  resetUserPasswordAction,
  setUserPasswordAction,
  deleteUserAction,
} from "@/lib/platform/search-action";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Result = { ok: boolean; error?: string };

/** Per-user actions for the admin Users page: reset email, set temp password,
 * suspend/reactivate, hard delete. Refreshes the route on success. */
export function UserRowActions({
  userId,
  email,
  banned,
}: {
  userId: string;
  email: string;
  banned: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");

  const run = (fn: () => Promise<Result>, onOk?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else {
        onOk?.();
        router.refresh();
      }
    });

  return (
    <span className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            aria-label="User actions"
            disabled={pending}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => run(() => resetUserPasswordAction(userId))}
          >
            Send password reset email
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setError(null);
              setPassword("");
              setPwOpen(true);
            }}
          >
            Set temporary password…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {banned ? (
            <DropdownMenuItem
              onSelect={() => run(() => reactivateUserAction(userId))}
            >
              Reactivate
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => run(() => deactivateUserAction(userId))}
            >
              Suspend
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setError(null);
              setConfirmEmail("");
              setDelOpen(true);
            }}
          >
            Delete user…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Set temporary password */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set temporary password</DialogTitle>
            <DialogDescription>
              {email} will be required to choose a new password at next login.
            </DialogDescription>
          </DialogHeader>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (min 8 characters)"
            aria-label="New temporary password"
            className="bg-surface focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPwOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              disabled={pending || password.length < 8}
              onClick={() =>
                run(
                  () => setUserPasswordAction(userId, password),
                  () => setPwOpen(false),
                )
              }
            >
              Set password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hard delete */}
      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user</DialogTitle>
            <DialogDescription>
              This permanently deletes {email} and all of their data. Type the
              email to confirm.
            </DialogDescription>
          </DialogHeader>
          <input
            type="text"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={email}
            aria-label="Type the user's email to confirm deletion"
            className="bg-surface focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDelOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending || confirmEmail !== email}
              onClick={() =>
                run(
                  () => deleteUserAction(userId),
                  () => setDelOpen(false),
                )
              }
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
```

Note: the delete dialog keeps the error visible (does not auto-close) when the action fails, so the sole-owner block message is shown. On success the `onOk` closes the dialog.

- [ ] **Step 2: Pass `email` from the page**

In `src/app/admin/users/page.tsx`, update the row usage (line 76):

```tsx
<UserRowActions
  userId={u.id}
  email={u.email ?? ""}
  banned={Boolean(u.bannedUntil)}
/>
```

- [ ] **Step 3: Verify `DropdownMenuItem` supports `variant="destructive"`**

Run: `pnpm typecheck`
Expected: PASS. If the local `dropdown-menu.tsx` `DropdownMenuItem` does not accept a `variant` prop, drop the `variant="destructive"` prop and instead add `className="text-destructive focus:text-destructive"` to that item.

- [ ] **Step 4: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Verify manually**

`pnpm dev` → `/admin/users` as the platform admin. Open the ⋯ menu on a user row and confirm: reset email fires (check Supabase logs/inbox), set-temp-password dialog enforces 8-char min and closes on success, Suspend flips to Reactivate after refresh, Delete dialog requires exact email and shows the sole-owner block message when applicable.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/user-row-actions.tsx src/app/admin/users/page.tsx
git commit -m "feat(admin): per-user actions dropdown on users page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Forced password change flow

**Files:**

- Modify: `src/lib/validations/auth.ts` (add `changePasswordSchema`)
- Modify: `src/app/auth/actions.ts` (add `changeOwnPassword`)
- Create: `src/components/auth/change-password-form.tsx`
- Create: `src/app/(auth)/change-password/page.tsx`
- Modify: `src/lib/auth/session.ts` (add + call `enforcePasswordChange` in `requireUser`)
- Modify: `src/lib/platform/guard.ts` (call `enforcePasswordChange` in `requirePlatformAdmin`)
- Modify: `src/app/page.tsx` (call `enforcePasswordChange` in the welcome branch)

- [ ] **Step 1: Add the validation schema**

Append to `src/lib/validations/auth.ts`:

```ts
export const changePasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
```

(If `z` is not already imported at the top of that file, add `import { z } from "zod";`.)

- [ ] **Step 2: Add the `enforcePasswordChange` helper and hook it into `requireUser`**

In `src/lib/auth/session.ts`, add the helper and call it from `requireUser`:

```ts
/** Redirect a flagged user to the forced password-change screen.
 * The flag is set by the platform admin via app_metadata.must_change_password. */
export function enforcePasswordChange(user: User): void {
  if (user.app_metadata?.must_change_password === true) {
    redirect("/change-password");
  }
}
```

Update `requireUser` to call it:

```ts
export async function requireUser(): Promise<User> {
  const user = await getUser();
  // redirect() throws — keep it outside any try/catch.
  if (!user) redirect("/login");
  enforcePasswordChange(user);
  return user;
}
```

- [ ] **Step 3: Hook the helper into `requirePlatformAdmin`**

In `src/lib/platform/guard.ts`, import and call the helper:

```ts
import { enforcePasswordChange } from "@/lib/auth/session";
```

```ts
export async function requirePlatformAdmin(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  enforcePasswordChange(user);
  if (!(await isPlatformAdmin())) redirect("/");
  return user;
}
```

- [ ] **Step 4: Hook the helper into the welcome branch of `page.tsx`**

In `src/app/page.tsx`, after the `if (!user) return <MonolithHero />;` line, add:

```tsx
enforcePasswordChange(user);
```

and extend the import:

```tsx
import {
  getUser,
  getUserOrgs,
  enforcePasswordChange,
} from "@/lib/auth/session";
```

- [ ] **Step 5: Add the `changeOwnPassword` action**

In `src/app/auth/actions.ts`, extend imports:

```ts
import { createServiceClient } from "@/lib/supabase/service";
import {
  signInSchema,
  signUpSchema,
  changePasswordSchema,
} from "@/lib/validations/auth";
```

Add the action:

```ts
export async function changeOwnPassword(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = changePasswordSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid password" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { error: error.message };

  // app_metadata is admin-only → clear the flag with the service-role client so
  // the user can't bypass the gate by editing their own metadata.
  const svc = createServiceClient();
  await svc.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, must_change_password: false },
  });

  // redirect() throws — outside any try/catch.
  redirect("/");
}
```

- [ ] **Step 6: Build the client form**

Create `src/components/auth/change-password-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { changeOwnPassword } from "@/app/auth/actions";
import type { AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    changeOwnPassword,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">
          Choose a new password
        </h1>
        <p className="text-muted-foreground text-sm">
          Your administrator set a temporary password. Pick a new one to
          continue.
        </p>
      </div>
      <input
        type="password"
        name="password"
        autoComplete="new-password"
        placeholder="New password (min 8 characters)"
        aria-label="New password"
        className="bg-surface focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
      />
      {state.error && (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        Update password
      </Button>
    </form>
  );
}
```

- [ ] **Step 7: Build the page**

Create `src/app/(auth)/change-password/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

export const metadata = { title: "Change your password" };

// Lives in the (auth) group so the app auth gates (requireUser /
// requirePlatformAdmin) don't run here — avoids a redirect loop with
// enforcePasswordChange. Uses getUser() directly, not requireUser().
export default async function ChangePasswordPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  return <ChangePasswordForm />;
}
```

- [ ] **Step 8: Write the failing test for the action**

Create `src/app/auth/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const updateUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser, updateUser } }),
}));

const updateUserById = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ auth: { admin: { updateUserById } } }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));

import { changeOwnPassword } from "./actions";

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({
    data: { user: { id: "u1", app_metadata: { y: 2 } } },
  });
  updateUser.mockReset().mockResolvedValue({ error: null });
  updateUserById.mockReset().mockResolvedValue({ error: null });
  redirect.mockClear();
});

const fd = (password: string) => {
  const f = new FormData();
  f.set("password", password);
  return f;
};

describe("changeOwnPassword", () => {
  it("rejects a too-short password", async () => {
    const r = await changeOwnPassword({}, fd("short"));
    expect(r.error).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("updates the password, clears the flag, and redirects home", async () => {
    await expect(changeOwnPassword({}, fd("longenough1"))).rejects.toThrow(
      "REDIRECT:/",
    );
    expect(updateUser).toHaveBeenCalledWith({ password: "longenough1" });
    expect(updateUserById).toHaveBeenCalledWith("u1", {
      app_metadata: { y: 2, must_change_password: false },
    });
  });
});
```

- [ ] **Step 9: Run the test**

Run: `pnpm test src/app/auth/actions.test.ts`
Expected: PASS (action implemented in Step 5).

- [ ] **Step 10: Full verification gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 11: Verify manually**

`pnpm dev`. As the platform admin, use ⋯ → Set temporary password on a _second_ test account. Log in as that account → confirm you're redirected to `/change-password` and cannot reach `/boards`, `/admin`, or `/`. Set a new password → confirm redirect to `/` and that navigation now works (flag cleared).

- [ ] **Step 12: Commit**

```bash
git add src/lib/validations/auth.ts src/app/auth/actions.ts src/app/auth/actions.test.ts src/components/auth/change-password-form.tsx "src/app/(auth)/change-password/page.tsx" src/lib/auth/session.ts src/lib/platform/guard.ts src/app/page.tsx
git commit -m "feat(admin): force password change after admin-set temp password

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the full mandatory gate once more from a clean state:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all PASS. Then push `develop`.

---

## Notes / deviations from the spec

- **Toasts → inline errors.** The repo has no toast primitive; per existing patterns (`members-table.tsx`, `invite-panel.tsx`) feedback is inline (`role="alert"` text) and failures `setError`. Immediate menu actions surface errors via the same inline mechanism after `router.refresh()`.
- **Self-deletion guard** added to `platformDeleteUser` (not in the spec) — cheap safety so an admin can't delete their own account.
- **Forced-change enforcement** uses the layout auth gates (`requireUser`, `requirePlatformAdmin`) + `page.tsx`, since the app has no middleware. The `/change-password` page sits in the `(auth)` route group specifically so those gates don't run on it (no redirect loop).
- **Flag storage** is `app_metadata.must_change_password` (admin-only), cleared server-side via the service-role client so a user can't self-clear it.
