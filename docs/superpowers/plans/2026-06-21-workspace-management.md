# Workspace Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI tasks (4, 5, 6) additionally require the `pulse-ui` + `frontend-design` skills.

**Goal:** Let users create, rename, and delete workspaces from the sidebar's "Workspaces" section.

**Architecture:** Three Server Actions in a new `src/lib/workspaces/` module (mirroring `src/lib/boards/actions.ts`) handle the mutations; RLS remains the security boundary. A new `isOrgAdmin()` guard (mirroring `isPlatformAdmin()`) is threaded through the 5 layouts → `AppShell` (kept synchronous) → `Sidebar` so the UI can hide Delete from non-admins. Two small client components (`WorkspaceNavItem`, `NewWorkspaceDialog`) replace the read-only `<span>` list, reusing the repo's inline-rename and type-to-confirm-delete patterns.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase, Zod, shadcn/ui (DropdownMenu, Dialog, Input, Button), lucide-react, Vitest + Testing Library.

---

## Execution DAG (parallelization)

**Interfaces (Consumes / Produces):**

| Task                                          | Consumes   | Produces                                                                  |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| T1 — Zod schemas                              | —          | `createWorkspaceSchema`, `renameWorkspaceSchema`, `deleteWorkspaceSchema` |
| T2 — Server Actions                           | T1         | `createWorkspace`, `renameWorkspace`, `deleteWorkspace`                   |
| T3 — `isOrgAdmin()` guard                     | —          | `isOrgAdmin()`                                                            |
| T4 — `WorkspaceNavItem`                       | T2         | `<WorkspaceNavItem>`                                                      |
| T5 — `NewWorkspaceDialog`                     | T2         | `<NewWorkspaceDialog>`                                                    |
| T6 — Wire-up (sidebar + AppShell + 5 layouts) | T3, T4, T5 | working feature                                                           |

**Dependency graph:** T2←T1; T4←T2; T5←T2; T6←T3,T4,T5. T3 depends on nothing.

**Parallel batches (waves):**

- **Wave A (concurrent):** T1, T3 — disjoint files (`validations/workspace-actions.ts` + its test; `lib/org/guard.ts` + its test).
- **Wave B:** T2 — needs T1.
- **Wave C (concurrent):** T4, T5 — disjoint files; both need only T2.
- **Wave D:** T6 — needs T3, T4, T5.

**Critical path (wall-clock floor):** T1 → T2 → (T4|T5) → T6 = **4 levels**.

**Execution note:** All work happens in ONE task worktree on a single `task/<name>` branch (working agreement #1). Within a wave, dispatch the concurrent tasks as parallel subagents (`superpowers:dispatching-parallel-agents`). The concurrent tasks in each wave touch **disjoint files**, so they won't clobber each other; sequence the `git commit` at the end of each wave (commit Wave A's two files together, etc.) to avoid index races. Do **not** start a wave until the previous wave's `pnpm typecheck && pnpm lint && pnpm test` is green.

---

## File Structure

| File                                                    | Action | Responsibility                                                           |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `src/lib/validations/workspace-actions.ts`              | create | Zod schemas (boundary validation)                                        |
| `src/lib/validations/workspace-actions.test.ts`         | create | Schema unit tests                                                        |
| `src/lib/workspaces/actions.ts`                         | create | `createWorkspace` / `renameWorkspace` / `deleteWorkspace` Server Actions |
| `src/lib/workspaces/actions.test.ts`                    | create | Action unit tests (mocked Supabase)                                      |
| `src/lib/org/guard.ts`                                  | create | `isOrgAdmin()` server guard                                              |
| `src/lib/org/guard.test.ts`                             | create | Guard unit test                                                          |
| `src/components/workspaces/WorkspaceNavItem.tsx`        | create | One workspace row: name, ⋯ menu, inline rename, type-to-confirm delete   |
| `src/components/workspaces/WorkspaceNavItem.test.tsx`   | create | Component tests                                                          |
| `src/components/workspaces/NewWorkspaceDialog.tsx`      | create | `+` create dialog                                                        |
| `src/components/workspaces/NewWorkspaceDialog.test.tsx` | create | Component test                                                           |
| `src/components/sidebar.tsx`                            | modify | Render the two new components; accept `isOrgAdmin` prop                  |
| `src/components/app-shell.tsx`                          | modify | Accept + forward `isOrgAdmin` prop                                       |
| `src/app/boards/layout.tsx`                             | modify | Compute + pass `isOrgAdmin`                                              |
| `src/app/dashboards/layout.tsx`                         | modify | Compute + pass `isOrgAdmin`                                              |
| `src/app/settings/layout.tsx`                           | modify | Compute + pass `isOrgAdmin`                                              |
| `src/app/admin/layout.tsx`                              | modify | Compute + pass `isOrgAdmin`                                              |
| `src/app/page.tsx`                                      | modify | Compute + pass `isOrgAdmin`                                              |

---

## Task 1: Zod schemas (Wave A)

**Files:**

- Create: `src/lib/validations/workspace-actions.ts`
- Test: `src/lib/validations/workspace-actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/validations/workspace-actions.test.ts
import { describe, it, expect } from "vitest";
import {
  createWorkspaceSchema,
  renameWorkspaceSchema,
  deleteWorkspaceSchema,
} from "@/lib/validations/workspace-actions";

describe("workspace schemas", () => {
  it("createWorkspaceSchema trims and accepts a valid name", () => {
    expect(createWorkspaceSchema.parse({ name: "  Marketing  " })).toEqual({
      name: "Marketing",
    });
  });

  it("createWorkspaceSchema rejects empty name", () => {
    expect(createWorkspaceSchema.safeParse({ name: "   " }).success).toBe(
      false,
    );
  });

  it("createWorkspaceSchema rejects names longer than 100 chars", () => {
    expect(
      createWorkspaceSchema.safeParse({ name: "x".repeat(101) }).success,
    ).toBe(false);
  });

  it("renameWorkspaceSchema requires a uuid workspaceId", () => {
    expect(
      renameWorkspaceSchema.safeParse({ workspaceId: "not-a-uuid", name: "A" })
        .success,
    ).toBe(false);
    expect(
      renameWorkspaceSchema.safeParse({
        workspaceId: "11111111-1111-1111-1111-111111111111",
        name: "A",
      }).success,
    ).toBe(true);
  });

  it("deleteWorkspaceSchema requires a uuid workspaceId", () => {
    expect(
      deleteWorkspaceSchema.safeParse({ workspaceId: "nope" }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/validations/workspace-actions.test.ts`
Expected: FAIL — cannot resolve `@/lib/validations/workspace-actions`.

- [ ] **Step 3: Write the schemas**

```ts
// src/lib/validations/workspace-actions.ts
import { z } from "zod";

const name = z.string().trim().min(1).max(100);
const uuid = z.string().uuid();

export const createWorkspaceSchema = z.object({ name });
export const renameWorkspaceSchema = z.object({ workspaceId: uuid, name });
export const deleteWorkspaceSchema = z.object({ workspaceId: uuid });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/validations/workspace-actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** (commit together with Task 3 at end of Wave A)

```bash
git add src/lib/validations/workspace-actions.ts src/lib/validations/workspace-actions.test.ts
```

---

## Task 3: `isOrgAdmin()` guard (Wave A — parallel with Task 1)

Mirrors `src/lib/platform/guard.ts` (`isPlatformAdmin`) and the role computation already in `src/app/settings/page.tsx` (the `get_org_members` RPC, then match the current user).

**Files:**

- Create: `src/lib/org/guard.ts`
- Test: `src/lib/org/guard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/org/guard.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const getUserOrgs = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUser(),
  getUserOrgs: () => getUserOrgs(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

import { isOrgAdmin } from "@/lib/org/guard";

beforeEach(() => {
  getUser.mockReset();
  getUserOrgs.mockReset();
  rpc.mockReset();
});

describe("isOrgAdmin", () => {
  it("returns true when the current user is an owner", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getUserOrgs.mockResolvedValue([{ id: "org1", name: "Acme" }]);
    rpc.mockResolvedValue({
      data: [{ user_id: "u1", role: "owner" }],
      error: null,
    });
    expect(await isOrgAdmin()).toBe(true);
  });

  it("returns false for a plain member", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getUserOrgs.mockResolvedValue([{ id: "org1", name: "Acme" }]);
    rpc.mockResolvedValue({
      data: [{ user_id: "u1", role: "member" }],
      error: null,
    });
    expect(await isOrgAdmin()).toBe(false);
  });

  it("fails closed (false) when there is no user or org", async () => {
    getUser.mockResolvedValue(null);
    getUserOrgs.mockResolvedValue([]);
    expect(await isOrgAdmin()).toBe(false);
  });

  it("fails closed when the RPC errors", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getUserOrgs.mockResolvedValue([{ id: "org1", name: "Acme" }]);
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await isOrgAdmin()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/org/guard.test.ts`
Expected: FAIL — cannot resolve `@/lib/org/guard`.

- [ ] **Step 3: Write the guard**

```ts
// src/lib/org/guard.ts
import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getUser, getUserOrgs } from "@/lib/auth/session";

/**
 * True if the current authenticated user is an owner/admin of their org.
 * Fails closed. Mirrors `isPlatformAdmin()` and the role check in settings.
 */
export const isOrgAdmin = cache(async (): Promise<boolean> => {
  const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
  const orgId = orgs[0]?.id;
  if (!user || !orgId) return false;

  const supabase = await createClient();
  const { data: members, error } = await supabase.rpc("get_org_members", {
    p_org_id: orgId,
  });
  if (error) return false;
  const me = (members ?? []).find((m) => m.user_id === user.id);
  return me?.role === "owner" || me?.role === "admin";
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/org/guard.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit Wave A**

```bash
git add src/lib/org/guard.ts src/lib/org/guard.test.ts
git commit -m "feat(workspaces): add workspace Zod schemas and isOrgAdmin guard"
```

(Wave-A checkpoint: run `pnpm typecheck && pnpm lint && pnpm test` before starting Wave B.)

---

## Task 2: Server Actions (Wave B)

**Files:**

- Create: `src/lib/workspaces/actions.ts`
- Test: `src/lib/workspaces/actions.test.ts`

Patterns mirror `src/lib/boards/actions.ts` exactly: `"use server"`, the `ActionResult<T>` union, the `fail()` helper, `revalidatePath("/", "layout")`, and the attachment-Storage cleanup from `deleteBoard`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/workspaces/actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const getUserOrgs = vi.fn();
const removeAttachmentObjects = vi.fn(async () => {});

vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUser(),
  getUserOrgs: () => getUserOrgs(),
}));
vi.mock("@/lib/collaboration/attachment-cleanup", () => ({
  removeAttachmentObjects: (paths: string[]) => removeAttachmentObjects(paths),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let currentClient: unknown;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentClient,
}));

import {
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
} from "@/lib/workspaces/actions";

/** Builds a Supabase client mock covering exactly the chains the actions use. */
function makeClient(
  opts: {
    workspaceCount?: number;
    boards?: { id: string }[];
    attachments?: { storage_path: string }[];
  } = {},
) {
  const { workspaceCount = 2, boards = [], attachments = [] } = opts;
  const insert = vi.fn(async () => ({ error: null }));
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const deleteEq = vi.fn(async () => ({ error: null }));
  const del = vi.fn(() => ({ eq: deleteEq }));

  const from = vi.fn((table: string) => {
    if (table === "workspaces") {
      return {
        insert,
        update,
        delete: del,
        // count query: .select("id", { count, head }) is awaited directly
        select: vi.fn(async () => ({ count: workspaceCount, error: null })),
      };
    }
    if (table === "boards") {
      return {
        select: vi.fn(() => ({ eq: vi.fn(async () => ({ data: boards })) })),
      };
    }
    if (table === "attachments") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: attachments })),
        })),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { client: { from }, insert, update, updateEq, del, deleteEq };
}

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ id: "user-1" });
  getUserOrgs.mockReset().mockResolvedValue([{ id: "org-1", name: "Acme" }]);
  removeAttachmentObjects.mockClear();
});

describe("createWorkspace", () => {
  it("rejects an invalid name without touching the DB", async () => {
    const m = makeClient();
    currentClient = m.client;
    const res = await createWorkspace({ name: "   " });
    expect(res.ok).toBe(false);
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("derives org_id + created_by server-side (ignores client input)", async () => {
    const m = makeClient();
    currentClient = m.client;
    const res = await createWorkspace({ name: "Marketing" });
    expect(res.ok).toBe(true);
    expect(m.insert).toHaveBeenCalledWith({
      org_id: "org-1",
      name: "Marketing",
      created_by: "user-1",
    });
  });
});

describe("renameWorkspace", () => {
  it("updates the workspace name", async () => {
    const m = makeClient();
    currentClient = m.client;
    const res = await renameWorkspace({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      name: "Renamed",
    });
    expect(res.ok).toBe(true);
    expect(m.update).toHaveBeenCalledWith({ name: "Renamed" });
    expect(m.updateEq).toHaveBeenCalledWith(
      "id",
      "11111111-1111-1111-1111-111111111111",
    );
  });
});

describe("deleteWorkspace", () => {
  it("blocks deleting the only workspace", async () => {
    const m = makeClient({ workspaceCount: 1 });
    currentClient = m.client;
    const res = await deleteWorkspace({
      workspaceId: "11111111-1111-1111-1111-111111111111",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/only workspace/i);
    expect(m.del).not.toHaveBeenCalled();
  });

  it("deletes and cleans up attachment storage objects", async () => {
    const m = makeClient({
      workspaceCount: 3,
      boards: [{ id: "b1" }],
      attachments: [{ storage_path: "p/1" }, { storage_path: "p/2" }],
    });
    currentClient = m.client;
    const res = await deleteWorkspace({
      workspaceId: "11111111-1111-1111-1111-111111111111",
    });
    expect(res.ok).toBe(true);
    expect(m.deleteEq).toHaveBeenCalledWith(
      "id",
      "11111111-1111-1111-1111-111111111111",
    );
    expect(removeAttachmentObjects).toHaveBeenCalledWith(["p/1", "p/2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/workspaces/actions.test.ts`
Expected: FAIL — cannot resolve `@/lib/workspaces/actions`.

- [ ] **Step 3: Write the actions**

```ts
// src/lib/workspaces/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser, getUserOrgs } from "@/lib/auth/session";
import { removeAttachmentObjects } from "@/lib/collaboration/attachment-cleanup";
import {
  createWorkspaceSchema,
  renameWorkspaceSchema,
  deleteWorkspaceSchema,
} from "@/lib/validations/workspace-actions";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export async function createWorkspace(input: {
  name: string;
}): Promise<ActionResult> {
  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Org + creator are derived server-side; never trusted from the client.
  const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
  const orgId = orgs[0]?.id;
  if (!user || !orgId) return fail("No organization found.");

  const supabase = await createClient();
  const { error } = await supabase.from("workspaces").insert({
    org_id: orgId,
    name: parsed.data.name,
    created_by: user.id,
  });
  if (error) return fail(error.message);

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function renameWorkspace(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameWorkspaceSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.workspaceId);
  if (error) return fail(error.message);

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function deleteWorkspace(input: {
  workspaceId: string;
}): Promise<ActionResult> {
  const parsed = deleteWorkspaceSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  // An org must keep at least one workspace so boards always have a home.
  // RLS scopes this count to the caller's org.
  const { count, error: countError } = await supabase
    .from("workspaces")
    .select("id", { count: "exact", head: true });
  if (countError) return fail(countError.message);
  if ((count ?? 0) <= 1) return fail("You can't delete your only workspace.");

  // Board/dashboard/item rows cascade in the DB, but attachment Storage objects
  // do not. Gather every attachment under this workspace's boards first
  // (mirrors deleteBoard's cleanup).
  const { data: boards } = await supabase
    .from("boards")
    .select("id")
    .eq("workspace_id", parsed.data.workspaceId);
  const boardIds = (boards ?? []).map((b) => b.id);
  let storagePaths: string[] = [];
  if (boardIds.length > 0) {
    const { data: attachments } = await supabase
      .from("attachments")
      .select("storage_path")
      .in("board_id", boardIds);
    storagePaths = (attachments ?? []).map((a) => a.storage_path);
  }

  const { error } = await supabase
    .from("workspaces")
    .delete()
    .eq("id", parsed.data.workspaceId);
  if (error) return fail(error.message);

  await removeAttachmentObjects(storagePaths);

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/workspaces/actions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspaces/actions.ts src/lib/workspaces/actions.test.ts
git commit -m "feat(workspaces): add create/rename/delete server actions"
```

(Wave-B checkpoint: `pnpm typecheck && pnpm lint && pnpm test`.)

---

## Task 4: `WorkspaceNavItem` component (Wave C)

> Load `pulse-ui` + `frontend-design` skills before writing this component.

**Files:**

- Create: `src/components/workspaces/WorkspaceNavItem.tsx`
- Test: `src/components/workspaces/WorkspaceNavItem.test.tsx`

Reuses the inline-rename pattern from `BoardHeader`/`ColumnHeader` and the type-to-confirm delete pattern from `src/components/admin/user-row-actions.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/workspaces/WorkspaceNavItem.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const renameWorkspace = vi.fn(async () => ({ ok: true, data: undefined }));
const deleteWorkspace = vi.fn(async () => ({ ok: true, data: undefined }));
vi.mock("@/lib/workspaces/actions", () => ({
  renameWorkspace: (a: unknown) => renameWorkspace(a),
  deleteWorkspace: (a: unknown) => deleteWorkspace(a),
}));

import { WorkspaceNavItem } from "@/components/workspaces/WorkspaceNavItem";

const ws = { id: "11111111-1111-1111-1111-111111111111", name: "verify WS" };

beforeEach(() => {
  // Radix needs these jsdom polyfills (also set globally in vitest.setup.ts).
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  renameWorkspace.mockClear();
  deleteWorkspace.mockClear();
});

describe("WorkspaceNavItem", () => {
  it("renders the workspace name", () => {
    render(
      <WorkspaceNavItem workspace={ws} isOrgAdmin={false} isLast={false} />,
    );
    expect(screen.getByText("verify WS")).toBeInTheDocument();
  });

  it("hides Delete from non-admins", async () => {
    render(
      <WorkspaceNavItem workspace={ws} isOrgAdmin={false} isLast={false} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /workspace menu/i }),
    );
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("shows Delete to admins and keeps confirm disabled until the name matches", async () => {
    render(
      <WorkspaceNavItem workspace={ws} isOrgAdmin={true} isLast={false} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /workspace menu/i }),
    );
    await userEvent.click(screen.getByText("Delete"));

    const confirmBtn = screen.getByRole("button", {
      name: /delete permanently/i,
    });
    expect(confirmBtn).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText(/type the workspace name/i),
      "verify WS",
    );
    expect(confirmBtn).toBeEnabled();

    await userEvent.click(confirmBtn);
    expect(deleteWorkspace).toHaveBeenCalledWith({ workspaceId: ws.id });
  });

  it("renames on Enter", async () => {
    render(
      <WorkspaceNavItem workspace={ws} isOrgAdmin={false} isLast={false} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /workspace menu/i }),
    );
    await userEvent.click(screen.getByText("Rename"));

    const input = screen.getByLabelText("Workspace name");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");
    expect(renameWorkspace).toHaveBeenCalledWith({
      workspaceId: ws.id,
      name: "Renamed",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/workspaces/WorkspaceNavItem.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Write the component**

```tsx
// src/components/workspaces/WorkspaceNavItem.tsx
"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameWorkspace, deleteWorkspace } from "@/lib/workspaces/actions";

export function WorkspaceNavItem({
  workspace,
  isOrgAdmin,
  isLast,
}: {
  workspace: { id: string; name: string };
  isOrgAdmin: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [delOpen, setDelOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function commitRename() {
    const trimmed = name.trim();
    setEditing(false);
    if (!trimmed || trimmed === workspace.name) {
      setName(workspace.name);
      return;
    }
    startTransition(async () => {
      const res = await renameWorkspace({
        workspaceId: workspace.id,
        name: trimmed,
      });
      if (!res.ok) {
        setError(res.error);
        setName(workspace.name);
      }
    });
  }

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteWorkspace({ workspaceId: workspace.id });
      if (res.ok) setDelOpen(false);
      else setError(res.error);
    });
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={name}
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitRename();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setName(workspace.name);
            setEditing(false);
          }
        }}
        aria-label="Workspace name"
        className="h-8 px-3 text-sm"
      />
    );
  }

  return (
    <div className="group/ws hover:bg-accent flex items-center gap-1 rounded-md px-3 py-1.5">
      <span className="text-muted-foreground truncate text-sm">
        {workspace.name}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`${workspace.name} workspace menu`}
            className="text-muted-foreground hover:text-foreground ml-auto opacity-0 transition-opacity group-hover/ws:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setName(workspace.name);
              setEditing(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          {isOrgAdmin ? (
            <DropdownMenuItem
              className="text-destructive"
              disabled={isLast}
              onSelect={() => {
                setError(null);
                setConfirmName("");
                setDelOpen(true);
              }}
            >
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{workspace.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently deletes the workspace and ALL boards and
              dashboards inside it. This can&apos;t be undone. Type the name to
              confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={workspace.name}
            aria-label="Type the workspace name to confirm deletion"
          />
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
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
              disabled={pending || confirmName !== workspace.name}
              onClick={confirmDelete}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/workspaces/WorkspaceNavItem.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspaces/WorkspaceNavItem.tsx src/components/workspaces/WorkspaceNavItem.test.tsx
git commit -m "feat(workspaces): add WorkspaceNavItem (rename + type-to-confirm delete)"
```

---

## Task 5: `NewWorkspaceDialog` component (Wave C — parallel with Task 4)

> Load `pulse-ui` + `frontend-design` skills before writing this component.

**Files:**

- Create: `src/components/workspaces/NewWorkspaceDialog.tsx`
- Test: `src/components/workspaces/NewWorkspaceDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/workspaces/NewWorkspaceDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createWorkspace = vi.fn(async () => ({ ok: true, data: undefined }));
vi.mock("@/lib/workspaces/actions", () => ({
  createWorkspace: (a: unknown) => createWorkspace(a),
}));

import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  createWorkspace.mockClear();
});

describe("NewWorkspaceDialog", () => {
  it("creates a workspace from the typed name", async () => {
    render(<NewWorkspaceDialog />);
    await userEvent.click(
      screen.getByRole("button", { name: /new workspace/i }),
    );

    const input = screen.getByLabelText("Workspace name");
    await userEvent.type(input, "Marketing");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(createWorkspace).toHaveBeenCalledWith({ name: "Marketing" });
  });

  it("disables Create for an empty name", async () => {
    render(<NewWorkspaceDialog />);
    await userEvent.click(
      screen.getByRole("button", { name: /new workspace/i }),
    );
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/workspaces/NewWorkspaceDialog.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Write the component**

```tsx
// src/components/workspaces/NewWorkspaceDialog.tsx
"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWorkspace } from "@/lib/workspaces/actions";

export function NewWorkspaceDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await createWorkspace({ name: trimmed });
      if (res.ok) {
        setName("");
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          aria-label="New workspace"
          className="text-muted-foreground hover:text-foreground ml-auto"
        >
          <Plus className="size-4" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Create a workspace to organize boards and dashboards.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          placeholder="Workspace name"
          aria-label="Workspace name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        {error ? (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/workspaces/NewWorkspaceDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspaces/NewWorkspaceDialog.tsx src/components/workspaces/NewWorkspaceDialog.test.tsx
git commit -m "feat(workspaces): add NewWorkspaceDialog"
```

(Wave-C checkpoint: `pnpm typecheck && pnpm lint && pnpm test`.)

---

## Task 6: Wire-up — sidebar, AppShell, layouts (Wave D)

> Load `pulse-ui` + `frontend-design` skills before editing the sidebar.

**Files:**

- Modify: `src/components/sidebar.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/app/boards/layout.tsx`, `src/app/dashboards/layout.tsx`, `src/app/settings/layout.tsx`, `src/app/admin/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Update the Sidebar — imports + props + Workspaces section**

In `src/components/sidebar.tsx`, add these imports near the other component imports:

```tsx
import { WorkspaceNavItem } from "@/components/workspaces/WorkspaceNavItem";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";
```

Add `isOrgAdmin` to the destructured props and the props type:

```tsx
export function Sidebar({
  boards,
  sharedBoards,
  workspaces,
  dashboards,
  isPlatformAdmin,
  isOrgAdmin,
}: {
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
  workspaces: { id: string; name: string }[];
  dashboards: { id: string; name: string }[];
  isPlatformAdmin?: boolean;
  isOrgAdmin?: boolean;
}) {
```

Replace the existing Workspaces block (currently lines ~155-169) with:

```tsx
{
  !isCollapsed && workspaces.length > 0 ? (
    <div className="mt-2 flex flex-col gap-0.5 px-2">
      <div className="flex items-center px-3 py-1">
        <p className="text-muted-foreground text-xs font-medium">Workspaces</p>
        <NewWorkspaceDialog />
      </div>
      {workspaces.map((workspace) => (
        <WorkspaceNavItem
          key={workspace.id}
          workspace={workspace}
          isOrgAdmin={!!isOrgAdmin}
          isLast={workspaces.length <= 1}
        />
      ))}
    </div>
  ) : null;
}
```

- [ ] **Step 2: Update AppShell to accept + forward the prop** (keep it synchronous)

In `src/components/app-shell.tsx`, add `isOrgAdmin?: boolean;` to `AppShellProps`, add `isOrgAdmin` to the destructured params, and pass it to `<Sidebar>`:

```tsx
type AppShellProps = {
  children: ReactNode;
  user?: AppShellUser;
  currentUserId?: string;
  org?: AppShellOrg;
  workspaces?: AppShellWorkspace[];
  boards?: BoardListEntry[];
  sharedBoards?: SharedBoardEntry[];
  dashboards?: AppShellDashboard[];
  /** When true, the user menu shows a link to the cross-org platform console. */
  isPlatformAdmin?: boolean;
  /** When true, the sidebar shows workspace Delete actions. */
  isOrgAdmin?: boolean;
};
```

```tsx
export function AppShell({
  children,
  user,
  currentUserId,
  workspaces,
  boards,
  sharedBoards,
  dashboards,
  isPlatformAdmin,
  isOrgAdmin,
}: AppShellProps) {
```

```tsx
<Sidebar
  boards={boards ?? []}
  sharedBoards={sharedBoards ?? []}
  workspaces={workspaces ?? []}
  dashboards={dashboards ?? []}
  isPlatformAdmin={isPlatformAdmin}
  isOrgAdmin={isOrgAdmin}
/>
```

- [ ] **Step 3: Thread `isOrgAdmin` through all 5 layouts**

For EACH of `src/app/boards/layout.tsx`, `src/app/dashboards/layout.tsx`, `src/app/settings/layout.tsx`, `src/app/admin/layout.tsx`, `src/app/page.tsx`:

1. Add the import:

```tsx
import { isOrgAdmin } from "@/lib/org/guard";
```

2. Add `isOrgAdmin()` to the existing `Promise.all([...])` and capture it. Example for `boards/layout.tsx` (adapt the destructure to each file's existing array):

```tsx
const [
  orgs,
  boards,
  sharedBoards,
  dashboards,
  { data: workspaces },
  platformAdmin,
  timeZone,
  orgAdmin,
] = await Promise.all([
  getUserOrgs(),
  listMyBoards(),
  listSharedBoards(),
  listDashboards(),
  supabase.from("workspaces").select("id, name"),
  isPlatformAdmin(),
  getUserTimeZone(),
  isOrgAdmin(),
]);
```

3. Pass the prop on `<AppShell ...>`:

```tsx
isOrgAdmin = { orgAdmin };
```

For layouts that don't already build a `Promise.all` (if any), simply add `const orgAdmin = await isOrgAdmin();` near the other awaits and pass `isOrgAdmin={orgAdmin}`. Verify each file compiles after editing.

- [ ] **Step 4: Guard the existing AppShell test**

`src/components/app-shell.test.tsx` renders `<AppShell>`, which now (via `Sidebar`) imports the workspace client components, which import `@/lib/workspaces/actions`. Add this mock near the top of that test file so the server-action module doesn't run in jsdom:

```tsx
vi.mock("@/lib/workspaces/actions", () => ({
  createWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));
```

- [ ] **Step 5: Run the full suite**

Run: `pnpm test -- src/components/app-shell.test.tsx src/components/workspaces`
Expected: PASS (existing AppShell tests still green; workspace component tests green).

- [ ] **Step 6: Full verification**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 7: Manual verification (verification-before-completion)**

Run the app, sign in, and in the sidebar confirm: the `+` creates a workspace; the ⋯ menu renames inline; as an owner/admin, Delete is offered (disabled on the only remaining workspace) and the type-to-confirm dialog actually removes the workspace; as a non-admin, Delete does not appear. **Delete "verify WS".**

- [ ] **Step 8: Commit**

```bash
git add src/components/sidebar.tsx src/components/app-shell.tsx src/components/app-shell.test.tsx \
  src/app/boards/layout.tsx src/app/dashboards/layout.tsx src/app/settings/layout.tsx \
  src/app/admin/layout.tsx src/app/page.tsx
git commit -m "feat(workspaces): wire workspace management into sidebar"
```

---

## Done criteria

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
- Manual check above confirmed; "verify WS" removed.
- `task/<name>` branch merged into `develop` via `scripts/finish-task.sh`; worktree + branch cleaned up.
- `/wrapup` session note logged.
