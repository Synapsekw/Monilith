# Phase 9.3 Cache (tagged `use cache` for hot shell reads) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache the per-user/per-org shell reads (sidebar board/dashboard/workspace lists + admin guards) with tagged Next.js 16 `use cache`, invalidated read-your-own-writes by the mutations that change them, so cross-section navigation stops re-hitting Supabase.

**Architecture:** Each hot read gets a cookie-free cached sibling: identity (`userId`/`orgId`) is read _outside_ the cache via the existing session helpers, then passed as an argument into a `use cache` function that uses the privileged-but-stateless `createServiceClient()` and re-applies the tenant filter as an explicit `WHERE` clause (the service client bypasses RLS, so that filter IS the tenant boundary). Each cached read calls `cacheTag(<per-identity tag>)` + `cacheLife(<profile>)`; the mutating Server Actions call `updateTag(<same tag>)` so the next read is fresh.

**Tech Stack:** Next.js 16 (Cache Components / `use cache` / `cacheTag` / `cacheLife` / `updateTag`), Supabase SSR + service-role client, Zod, Vitest.

## Global Constraints

- **`cacheComponents: true`** is already enabled in `next.config.ts` — do not remove it.
- **Public `use cache` MUST NOT read `cookies()`/`headers()`** (it throws). Identity is always passed in as a `string` argument, never read from the session inside a cached scope.
- **The explicit `WHERE` filter inside each cached read IS the security boundary** (service client bypasses RLS). Every cached read MUST filter on its identity argument. A cross-tenant isolation test is mandatory.
- **`SUPABASE_SERVICE_ROLE_KEY` is server-only.** Every new cached module starts with `import "server-only";`. No service client, key, or unfiltered row reaches the browser.
- **Mutations stay Server Actions** (`"use server"`); invalidation uses **`updateTag(tag)`** (read-your-own-writes), NOT `revalidateTag`. `updateTag` is Server-Action-only.
- **Keep all existing `revalidatePath(...)` calls** in the mutations — 9.3 is additive. Do not delete them.
- **Tag strings come only from `src/lib/cache/tags.ts` builders** — never inline a tag literal in a read or an action (typo'd tags silently never invalidate).
- **cacheLife profiles:** `nav` = `{ stale: 60, revalidate: 60, expire: 3600 }`, `guard` = `{ stale: 60, revalidate: 300, expire: 3600 }`. Always name a profile explicitly; never rely on `default`.
- **Commit identity:** `Danijel Jovanovic <info@synapse-solutions.ai>` (pinned by the worktree; do not override).
- **No `any` creep.** Reuse existing generated types (`BoardListEntry`, `SharedBoardEntry`, `Dashboard`).
- **Test mock convention** (match existing `guard.test.ts`): `vi.mock("@/lib/supabase/service", ...)` / `vi.mock("@/lib/supabase/server", ...)` returning a stub client whose `from`/`rpc` are `vi.fn()`.
- **Gates (a task is not done until all pass):** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## File Structure

| File                                                                                                       | Responsibility                                                  | Task |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---- |
| `src/lib/cache/tags.ts`                                                                                    | Typed tag-builder functions (single source of every tag string) | T1   |
| `src/lib/cache/tags.test.ts`                                                                               | Tag-builder unit tests                                          | T1   |
| `next.config.ts`                                                                                           | Add `cacheLife.nav` + `cacheLife.guard` profiles                | T1   |
| `src/lib/boards/queries-cached.ts`                                                                         | `listMyBoardsCached` / `listSharedBoardsCached`                 | T2   |
| `src/lib/boards/queries-cached.test.ts`                                                                    | Cross-tenant + shape tests                                      | T2   |
| `src/lib/dashboards/queries-cached.ts`                                                                     | `listDashboardsCached`                                          | T3   |
| `src/lib/dashboards/queries-cached.test.ts`                                                                | tests                                                           | T3   |
| `src/lib/workspaces/queries-cached.ts`                                                                     | `listWorkspacesCached`                                          | T3   |
| `src/lib/workspaces/queries-cached.test.ts`                                                                | tests                                                           | T3   |
| `src/lib/platform/guard.ts`                                                                                | add `isPlatformAdminCached(userId)`                             | T4   |
| `src/lib/org/guard.ts`                                                                                     | add `isOrgAdminCached(userId, orgId)`                           | T4   |
| `src/lib/platform/guard.test.ts` / `src/lib/org/guard.test.ts`                                             | cached-variant tests                                            | T4   |
| `src/components/shell/sidebar-nav-data.tsx` / `header-user-data.tsx` / `command-palette-data.tsx`          | call the cached variants with in-scope ids                      | T5   |
| `src/lib/dashboards/actions.ts` / `workspaces/actions.ts` / `org/admin-actions.ts` / `platform/actions.ts` | add `updateTag` calls                                           | T6   |
| `src/lib/boards/actions.ts` / `boards/sharing-actions.ts`                                                  | add `updateTag` calls (coordination-sensitive — last)           | T7   |

---

## Execution DAG

```
T1 (tags + cacheLife profiles)  ── foundational, no deps
   ├──────────────┬───────────────┬──────────────┐
   ▼              ▼               ▼              ▼
  T2 (boards    T3 (dash +      T4 (guards     T6 (dash/ws/org/
   cached reads) ws cached)      cached)        platform invalidation)
   └──────────────┴───────────────┘
                  ▼
                 T5 (shell wiring — consumes T2,T3,T4)

  T7 (boards/actions.ts + sharing invalidation) ── consumes T1; scheduled LAST
```

- **Dependency edges:** T2,T3,T4,T6 depend on T1. T5 depends on T2,T3,T4. T7 depends on T1.
- **Parallel batches:**
  - **Batch A:** {T1} (must finish first — everything consumes the tags + profiles).
  - **Batch B:** {T2, T3, T4, T6} — four agents in parallel; disjoint files.
  - **Batch C:** {T5} — after Batch B's T2/T3/T4.
  - **Batch D:** {T7} — run **last**, after `develop` has absorbed the parallel "optimistic board mutations" task, so its `boards/actions.ts` `updateTag` hunks rebase cleanly. T7 only depends on T1, so it _can_ start early, but its merge is deliberately deferred (see Coordination risk in the spec). If the other task has already merged, T7 may run in Batch B.
- **Critical path:** T1 → T2/T3/T4 → T5 (the shell win). T6 and T7 are leaf invalidation tasks off T1.

**Coordination note:** T7 edits the same `createBoard`/`renameBoard`/`deleteBoard`/`duplicateBoard` lines as the parallel optimistic-board-mutations task. Each T7 edit is a one-line `updateTag(...)` + one import — trivial to rebase. Land T7 last; `finish-task.sh` auto-rebases onto `develop` before gating.

---

### Task 1: Tag builders + cacheLife profiles

**Files:**

- Create: `src/lib/cache/tags.ts`
- Create: `src/lib/cache/tags.test.ts`
- Modify: `next.config.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `boardsTag(userId: string): string` → `boards:user:<userId>`
  - `sharedBoardsTag(userId: string): string` → `shared-boards:user:<userId>`
  - `dashboardsTag(orgId: string): string` → `dashboards:org:<orgId>`
  - `workspacesTag(orgId: string): string` → `workspaces:org:<orgId>`
  - `platformAdminTag(userId: string): string` → `platform-admin:user:<userId>`
  - `orgAdminTag(userId: string, orgId: string): string` → `org-admin:user:<userId>:org:<orgId>`
  - `next.config.ts` cacheLife profiles `nav` and `guard`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cache/tags.test.ts
import { describe, expect, it } from "vitest";
import {
  boardsTag,
  sharedBoardsTag,
  dashboardsTag,
  workspacesTag,
  platformAdminTag,
  orgAdminTag,
} from "./tags";

describe("cache tag builders", () => {
  it("produce identity-scoped strings", () => {
    expect(boardsTag("u1")).toBe("boards:user:u1");
    expect(sharedBoardsTag("u1")).toBe("shared-boards:user:u1");
    expect(dashboardsTag("o1")).toBe("dashboards:org:o1");
    expect(workspacesTag("o1")).toBe("workspaces:org:o1");
    expect(platformAdminTag("u1")).toBe("platform-admin:user:u1");
    expect(orgAdminTag("u1", "o1")).toBe("org-admin:user:u1:org:o1");
  });

  it("are distinct across identities (no collisions)", () => {
    expect(boardsTag("u1")).not.toBe(boardsTag("u2"));
    expect(orgAdminTag("u1", "o1")).not.toBe(orgAdminTag("u1", "o2"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/cache/tags.test.ts`
Expected: FAIL — `Cannot find module './tags'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/cache/tags.ts
import "server-only";

/**
 * Single source of truth for `use cache` tag strings. Producers (cached reads,
 * via cacheTag) and consumers (Server Actions, via updateTag) MUST both import
 * from here — never inline a literal, or invalidation silently breaks.
 *
 * Tags are identity-scoped so a user can only ever serve/invalidate their own
 * cache entry: a leak across tenants is impossible by construction.
 */
export const boardsTag = (userId: string) => `boards:user:${userId}`;
export const sharedBoardsTag = (userId: string) =>
  `shared-boards:user:${userId}`;
export const dashboardsTag = (orgId: string) => `dashboards:org:${orgId}`;
export const workspacesTag = (orgId: string) => `workspaces:org:${orgId}`;
export const platformAdminTag = (userId: string) =>
  `platform-admin:user:${userId}`;
export const orgAdminTag = (userId: string, orgId: string) =>
  `org-admin:user:${userId}:org:${orgId}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/cache/tags.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add cacheLife profiles to `next.config.ts`**

Add the `cacheLife` key to the existing `nextConfig` object (it currently has `cacheComponents`, `devIndicators`, `turbopack`). Insert directly after the `cacheComponents: true,` line:

```ts
  cacheComponents: true,
  // Phase 9.3 named cache profiles. `nav` for per-user/per-org sidebar lists
  // (tolerate ~1m staleness; read-your-own-writes handled by updateTag). `guard`
  // for the admin-flag reads (change very rarely). Both keep revalidate ≥ 60s and
  // expire ≥ 5m so neither becomes a forced dynamic hole inside the 9.2 shell.
  cacheLife: {
    nav: { stale: 60, revalidate: 60, expire: 3600 },
    guard: { stale: 60, revalidate: 300, expire: 3600 },
  },
```

- [ ] **Step 6: Verify the config typechecks and builds**

Run: `pnpm typecheck`
Expected: PASS (no type error on the `cacheLife` key).

- [ ] **Step 7: Commit**

```bash
git add src/lib/cache/tags.ts src/lib/cache/tags.test.ts next.config.ts
git commit -m "feat(cache): add tag builders and nav/guard cacheLife profiles"
```

---

### Task 2: Cached boards reads

**Files:**

- Create: `src/lib/boards/queries-cached.ts`
- Create: `src/lib/boards/queries-cached.test.ts`

**Interfaces:**

- Consumes (from T1): `boardsTag`, `sharedBoardsTag` from `@/lib/cache/tags`.
- Consumes (existing): `createServiceClient` from `@/lib/supabase/service`; types `BoardListEntry`, `SharedBoardEntry` from `@/lib/boards/queries`.
- Produces:
  - `listMyBoardsCached(userId: string): Promise<BoardListEntry[]>`
  - `listSharedBoardsCached(userId: string): Promise<SharedBoardEntry[]>`

**Note on scoping:** the existing `listMyBoards`/`listSharedBoards` read `user.id` from the session and rely on RLS. The cached variants take `userId` as an argument and use the **service client with an explicit `created_by`/`user_id` filter** — that filter is the tenant boundary here.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/boards/queries-cached.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// The cached reads use the service client. We stub it and assert the explicit
// identity filter is applied (the tenant boundary), then return scoped rows.
const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

import { listMyBoardsCached } from "./queries-cached";

beforeEach(() => {
  from.mockClear();
  select.mockClear();
  eq.mockClear();
  order.mockReset();
});

describe("listMyBoardsCached", () => {
  it("filters by the passed userId (tenant boundary) and maps shared_out", async () => {
    order.mockResolvedValue({
      data: [
        {
          id: "b1",
          name: "Mine",
          workspace_id: "w1",
          position: 1,
          board_members: [{ user_id: "x" }],
        },
      ],
      error: null,
    });

    const result = await listMyBoardsCached("user-A");

    expect(from).toHaveBeenCalledWith("boards");
    expect(eq).toHaveBeenCalledWith("created_by", "user-A");
    expect(result).toEqual([
      {
        id: "b1",
        name: "Mine",
        workspace_id: "w1",
        position: 1,
        shared_out: true,
      },
    ]);
  });

  it("returns [] on error", async () => {
    order.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await listMyBoardsCached("user-A")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/boards/queries-cached.test.ts`
Expected: FAIL — `Cannot find module './queries-cached'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/boards/queries-cached.ts
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { boardsTag, sharedBoardsTag } from "@/lib/cache/tags";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";

/**
 * Cached `listMyBoards`. `userId` is read OUTSIDE this scope (in the shell server
 * component) and passed in, so it is part of the cache key and the cacheTag. Uses
 * the cookie-free service client with an EXPLICIT `created_by = userId` filter —
 * that filter is the tenant boundary (the service client bypasses RLS).
 */
export async function listMyBoardsCached(
  userId: string,
): Promise<BoardListEntry[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(boardsTag(userId));

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("boards")
    .select("id, name, workspace_id, position, board_members(user_id)")
    .eq("created_by", userId)
    .order("position", { ascending: true });
  if (error) return [];
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    workspace_id: b.workspace_id,
    position: b.position,
    shared_out: (b.board_members ?? []).length > 0,
  }));
}

/**
 * Cached `listSharedBoards` — boards shared WITH `userId` by someone else.
 * Explicit `user_id = userId` filter is the tenant boundary; owner names are
 * resolved in a second scoped read.
 */
export async function listSharedBoardsCached(
  userId: string,
): Promise<SharedBoardEntry[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(sharedBoardsTag(userId));

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("board_members")
    .select("access_level, boards!inner(id, name, position, created_by)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  const rows = data.filter((r) => r.boards && r.boards.created_by !== userId);

  const ownerIds = [...new Set(rows.map((r) => r.boards.created_by))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ownerIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return rows.map((r) => ({
    id: r.boards.id,
    name: r.boards.name,
    position: r.boards.position,
    owner_name: nameById.get(r.boards.created_by) ?? null,
    access_level: r.access_level,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/boards/queries-cached.test.ts`
Expected: PASS (2 tests). Note: `"use cache"` is a no-op shape change under Vitest's transform — the function still runs and the mocks intercept `from`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/queries-cached.ts src/lib/boards/queries-cached.test.ts
git commit -m "feat(cache): add cached boards shell reads scoped by userId"
```

---

### Task 3: Cached dashboards + workspaces reads

**Files:**

- Create: `src/lib/dashboards/queries-cached.ts`
- Create: `src/lib/dashboards/queries-cached.test.ts`
- Create: `src/lib/workspaces/queries-cached.ts`
- Create: `src/lib/workspaces/queries-cached.test.ts`

**Interfaces:**

- Consumes (from T1): `dashboardsTag`, `workspacesTag` from `@/lib/cache/tags`.
- Consumes (existing): `createServiceClient`; type `Dashboard` from `@/lib/dashboards/queries`.
- Produces:
  - `listDashboardsCached(orgId: string): Promise<Dashboard[]>`
  - `listWorkspacesCached(orgId: string): Promise<{ id: string; name: string }[]>`

**Note:** the existing `listDashboards`/inline workspace select rely on RLS to org-scope. The cached variants take `orgId` and filter `org_id = orgId` explicitly.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/dashboards/queries-cached.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

import { listDashboardsCached } from "./queries-cached";

beforeEach(() => {
  from.mockClear();
  eq.mockClear();
  order.mockReset();
});

describe("listDashboardsCached", () => {
  it("filters by orgId (tenant boundary)", async () => {
    order.mockResolvedValue({ data: [{ id: "d1", name: "D" }], error: null });
    const result = await listDashboardsCached("org-A");
    expect(from).toHaveBeenCalledWith("dashboards");
    expect(eq).toHaveBeenCalledWith("org_id", "org-A");
    expect(result).toEqual([{ id: "d1", name: "D" }]);
  });

  it("returns [] when none", async () => {
    order.mockResolvedValue({ data: null, error: null });
    expect(await listDashboardsCached("org-A")).toEqual([]);
  });
});
```

```ts
// src/lib/workspaces/queries-cached.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

import { listWorkspacesCached } from "./queries-cached";

beforeEach(() => {
  from.mockClear();
  eq.mockClear();
  order.mockReset();
});

describe("listWorkspacesCached", () => {
  it("filters by orgId and selects id+name", async () => {
    order.mockResolvedValue({
      data: [{ id: "w1", name: "W" }],
      error: null,
    });
    const result = await listWorkspacesCached("org-A");
    expect(from).toHaveBeenCalledWith("workspaces");
    expect(eq).toHaveBeenCalledWith("org_id", "org-A");
    expect(result).toEqual([{ id: "w1", name: "W" }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/dashboards/queries-cached.test.ts src/lib/workspaces/queries-cached.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```ts
// src/lib/dashboards/queries-cached.ts
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { dashboardsTag } from "@/lib/cache/tags";
import type { Dashboard } from "@/lib/dashboards/queries";

/**
 * Cached org dashboards list. `orgId` is passed in (part of the cache key + tag);
 * the explicit `org_id = orgId` filter is the tenant boundary (service client
 * bypasses RLS).
 */
export async function listDashboardsCached(
  orgId: string,
): Promise<Dashboard[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(dashboardsTag(orgId));

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("dashboards")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  return data ?? [];
}
```

```ts
// src/lib/workspaces/queries-cached.ts
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { workspacesTag } from "@/lib/cache/tags";

export type WorkspaceListEntry = { id: string; name: string };

/**
 * Cached org workspaces list (extracted from the inline shell select). Explicit
 * `org_id = orgId` filter is the tenant boundary.
 */
export async function listWorkspacesCached(
  orgId: string,
): Promise<WorkspaceListEntry[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(workspacesTag(orgId));

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  return data ?? [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/dashboards/queries-cached.test.ts src/lib/workspaces/queries-cached.test.ts`
Expected: PASS (3 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/queries-cached.ts src/lib/dashboards/queries-cached.test.ts src/lib/workspaces/queries-cached.ts src/lib/workspaces/queries-cached.test.ts
git commit -m "feat(cache): add cached dashboards and workspaces shell reads scoped by orgId"
```

---

### Task 4: Cached admin guards

**Files:**

- Modify: `src/lib/platform/guard.ts` (add `isPlatformAdminCached`)
- Modify: `src/lib/org/guard.ts` (add `isOrgAdminCached`)
- Modify: `src/lib/platform/guard.test.ts`
- Modify: `src/lib/org/guard.test.ts`

**Interfaces:**

- Consumes (from T1): `platformAdminTag`, `orgAdminTag`; cacheLife profile `guard`.
- Consumes (existing): `createServiceClient`; RPCs `is_platform_admin` (no args here — see note) / `get_org_members`.
- Produces:
  - `isPlatformAdminCached(userId: string): Promise<boolean>`
  - `isOrgAdminCached(userId: string, orgId: string): Promise<boolean>`

**Note:** the existing `is_platform_admin` RPC reads the caller from the session (`auth.uid()`), which the service client does not carry. Use the **service client with an explicit user filter** instead: read the platform-admin membership directly. Confirm the table/RPC during implementation — if a parameterized RPC `is_platform_admin(p_user_id)` does not exist, query the underlying `platform_admins` table by `user_id`. The test below pins the _behavior_ (true/false/fails-closed), not the exact query, so the implementer wires whichever scoped read exists.

- [ ] **Step 1: Write the failing tests (append to existing files)**

Append to `src/lib/platform/guard.test.ts`:

```ts
describe("isPlatformAdminCached", () => {
  it("is true when the scoped read returns a row for the user", async () => {
    // maybeSingle resolves a row → admin
    maybeSingle.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    const { isPlatformAdminCached } = await import("./guard");
    expect(await isPlatformAdminCached("u1")).toBe(true);
  });
  it("fails closed (false) on error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "x" } });
    const { isPlatformAdminCached } = await import("./guard");
    expect(await isPlatformAdminCached("u1")).toBe(false);
  });
});
```

(Add the service-client mock with an `eq().maybeSingle()` chain at the top of the file, mirroring the `rpc` mock already there. Define `const maybeSingle = vi.fn();` and a `from`/`select`/`eq` chain resolving to it; `vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from }) }));`.)

Append to `src/lib/org/guard.test.ts` an analogous `isOrgAdminCached` block asserting: returns `true` when the member row's role is `owner`/`admin`, `false` for `member`, and `false` (fails closed) on error.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/platform/guard.test.ts src/lib/org/guard.test.ts`
Expected: FAIL — `isPlatformAdminCached`/`isOrgAdminCached` not exported.

- [ ] **Step 3: Implement the cached guards**

Append to `src/lib/platform/guard.ts`:

```ts
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { platformAdminTag } from "@/lib/cache/tags";

/**
 * Cached platform-admin flag for the SIDEBAR VISIBILITY only. `userId` is passed
 * in (cache key + tag); the explicit user filter is the boundary. NOTE: keep the
 * uncached `requirePlatformAdmin` for sensitive /admin routes — only the sidebar
 * flag is cached (9.1 decision).
 */
export async function isPlatformAdminCached(userId: string): Promise<boolean> {
  "use cache";
  cacheLife("guard");
  cacheTag(platformAdminTag(userId));

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("platform_admins") // confirm table name during impl
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return data !== null;
}
```

Append to `src/lib/org/guard.ts`:

```ts
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { orgAdminTag } from "@/lib/cache/tags";

/**
 * Cached org-admin flag for the sidebar. `userId`+`orgId` passed in (cache key +
 * tag); explicit filters are the boundary. Mirrors the role check in the existing
 * isOrgAdmin (owner|admin), but for an explicit identity rather than the session.
 */
export async function isOrgAdminCached(
  userId: string,
  orgId: string,
): Promise<boolean> {
  "use cache";
  cacheLife("guard");
  cacheTag(orgAdminTag(userId, orgId));

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return false;
  return data.role === "owner" || data.role === "admin";
}
```

- [ ] **Step 4: Verify the `org_members` columns**

Run: `pnpm typecheck`
Expected: PASS — confirms `org_members` has `role`/`org_id`/`user_id` and `platform_admins` exists in the generated types. If `platform_admins` is not the real table, grep `supabase/migrations` for the platform-admin source and adjust the `.from(...)` before re-running.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/platform/guard.test.ts src/lib/org/guard.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/platform/guard.ts src/lib/org/guard.ts src/lib/platform/guard.test.ts src/lib/org/guard.test.ts
git commit -m "feat(cache): add cached admin-guard reads scoped by identity"
```

---

### Task 5: Shell wiring

**Files:**

- Modify: `src/components/shell/sidebar-nav-data.tsx`
- Modify: `src/components/shell/header-user-data.tsx`
- Modify: `src/components/shell/command-palette-data.tsx`
- Modify: `src/components/shell/sidebar-nav-data.test.tsx` (and the two sibling `.test.tsx` if they assert specific fetcher calls)

**Interfaces:**

- Consumes (from T2,T3,T4): `listMyBoardsCached`, `listSharedBoardsCached`, `listDashboardsCached`, `listWorkspacesCached`, `isPlatformAdminCached`, `isOrgAdminCached`.
- Consumes (existing): `getUser` (`@/lib/auth/session`) and `getUserOrgs` for the identity reads (these stay uncached, cookie-bound).
- Produces: the shell renders identical props, now fed by cached reads.

**Critical:** read identity OUTSIDE any cache. `getUser()` returns `SessionUser | null`; `getUserOrgs()` returns `Organization[]`. Derive `userId = user.id` and `orgId = orgs[0]?.id`. Guard the null/empty case (render the existing empty shell — match current behavior where `listMyBoards` returns `[]` for no user).

- [ ] **Step 1: Update `sidebar-nav-data.tsx`**

Replace the body of `SidebarNavData` so identity is read first, then the cached variants are called with ids:

```tsx
import { getUser, getUserOrgs } from "@/lib/auth/session";
import {
  listMyBoardsCached,
  listSharedBoardsCached,
} from "@/lib/boards/queries-cached";
import { listDashboardsCached } from "@/lib/dashboards/queries-cached";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { isPlatformAdminCached } from "@/lib/platform/guard";
import { isOrgAdminCached } from "@/lib/org/guard";
import { countNewFeedback } from "@/lib/feedback/queries";
import { SidebarNav } from "@/components/shell/sidebar-nav";

export async function SidebarNavData() {
  // Identity read OUTSIDE any cache (cookie-bound, uncached). getClaims is local
  // (9.1), so this is cheap.
  const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
  const userId = user?.id ?? "";
  const orgId = orgs[0]?.id ?? "";

  const [
    boards,
    sharedBoards,
    dashboards,
    workspaces,
    platformAdmin,
    orgAdmin,
  ] = await Promise.all([
    listMyBoardsCached(userId),
    listSharedBoardsCached(userId),
    listDashboardsCached(orgId),
    listWorkspacesCached(orgId),
    isPlatformAdminCached(userId),
    isOrgAdminCached(userId, orgId),
  ]);

  const newFeedbackCount = platformAdmin ? await countNewFeedback() : 0;

  return (
    <SidebarNav
      boards={boards}
      sharedBoards={sharedBoards}
      workspaces={workspaces}
      dashboards={dashboards.map((d) => ({ id: d.id, name: d.name }))}
      isPlatformAdmin={platformAdmin}
      isOrgAdmin={orgAdmin}
      newFeedbackCount={newFeedbackCount}
    />
  );
}
```

Update the doc comment to drop the "NOT cached … Phase 9.3's job" note (it's now done).

- [ ] **Step 2: Update `header-user-data.tsx`**

It calls `requireUser()` + `isPlatformAdmin()`. Keep `requireUser()` (it must redirect when unauthenticated — do NOT replace it), and swap the admin flag for the cached variant using the user's id:

```tsx
const user = await requireUser();
const platformAdmin = await isPlatformAdminCached(user.id);
```

Import `isPlatformAdminCached` from `@/lib/platform/guard`; remove the now-unused `isPlatformAdmin` import if nothing else uses it.

- [ ] **Step 3: Update `command-palette-data.tsx`**

It calls `listMyBoards()`, `listDashboards()`, and an inline `workspaces` select. Read identity first, then use cached variants:

```tsx
const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
const userId = user?.id ?? "";
const orgId = orgs[0]?.id ?? "";
const [boards, dashboards, workspaces] = await Promise.all([
  listMyBoardsCached(userId),
  listDashboardsCached(orgId),
  listWorkspacesCached(orgId),
]);
```

Then feed the existing rendered output from these (drop the inline `supabase.from("workspaces")` read and its `createClient` import if now unused).

- [ ] **Step 4: Update the shell tests**

Run the three shell tests; for each that mocked `listMyBoards`/`listDashboards`/`isPlatformAdmin`, repoint the `vi.mock` to the cached modules (`@/lib/boards/queries-cached`, `@/lib/dashboards/queries-cached`, `@/lib/workspaces/queries-cached`, `@/lib/platform/guard`, `@/lib/org/guard`) and add mocks for `getUser`/`getUserOrgs` returning a user + one org. Assert the rendered props are unchanged.

Run: `pnpm vitest run src/components/shell/sidebar-nav-data.test.tsx src/components/shell/header-user-data.test.tsx src/components/shell/command-palette-data.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add src/components/shell/sidebar-nav-data.tsx src/components/shell/header-user-data.tsx src/components/shell/command-palette-data.tsx src/components/shell/sidebar-nav-data.test.tsx src/components/shell/header-user-data.test.tsx src/components/shell/command-palette-data.test.tsx
git commit -m "feat(cache): wire shell components to cached identity-scoped reads"
```

---

### Task 6: Invalidation in dashboards / workspaces / org / platform actions

**Files:**

- Modify: `src/lib/dashboards/actions.ts` (`createDashboard`, `renameDashboard`, `deleteDashboard`, `duplicateDashboard`)
- Modify: `src/lib/workspaces/actions.ts` (`createWorkspace`, `renameWorkspace`, `deleteWorkspace`)
- Modify: `src/lib/org/admin-actions.ts` (`setMemberRole`, `removeMember`, `deactivateMember`, `reactivateMember`)
- Modify: `src/lib/platform/actions.ts` (`platformSetOrgRole`)
- Test: extend the existing `src/lib/dashboards/*` / `workspaces/actions.test.ts` / `org/admin-actions.test.ts` / `platform/actions.test.ts` to assert the `updateTag` call.

**Interfaces:**

- Consumes (from T1): `dashboardsTag`, `workspacesTag`, `orgAdminTag`.
- Consumes (existing): `updateTag` from `next/cache`; `getUser`/`getUserOrgs` (already imported in `workspaces/actions.ts`).
- Produces: each listed action calls `updateTag(<tag>)` after a successful mutation, before its existing `revalidatePath`.

**Identity derivation (server-side, never trusted from client):**

- Dashboards: derive `orgId` from the mutated/returned row. `createDashboard`/`renameDashboard` return `data` with `org_id` (the row). `deleteDashboard`/`duplicateDashboard`: read the dashboard's `org_id` before/with the mutation (add a `.select("org_id")` to the delete, or read it first). Use that for `dashboardsTag(orgId)`.
- Workspaces: `createWorkspace` already has `orgId` in scope (from `getUserOrgs`). `renameWorkspace`/`deleteWorkspace`: read `org_id` from the workspace row (add `.select("org_id")`).
- Org membership: `setMemberRole`/`removeMember`/`deactivateMember`/`reactivateMember` already parse `orgId` and `userId` from input → `orgAdminTag(parsed.data.userId, parsed.data.orgId)`.
- Platform: `platformSetOrgRole` parses `orgId` and `userId` → `orgAdminTag(parsed.data.userId, parsed.data.orgId)`.

- [ ] **Step 1: Write a failing test (dashboards example — repeat the pattern for each file)**

```ts
// add to the dashboards actions test file
import { updateTag } from "next/cache";
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

it("createDashboard updates the org dashboards tag", async () => {
  // arrange the supabase mock so rpc('create_dashboard') resolves a row with org_id
  // ...existing arrange...
  await createDashboard({ workspaceId: "w1", name: "D" });
  expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/dashboards` (the actions test)
Expected: FAIL — `updateTag` not called.

- [ ] **Step 3: Add the `updateTag` calls**

In `src/lib/dashboards/actions.ts`, add `updateTag` to the `next/cache` import and call it after each successful dashboard-list mutation, e.g.:

```ts
import { revalidatePath, updateTag } from "next/cache";
import { dashboardsTag } from "@/lib/cache/tags";
// ...
// createDashboard, after success (data has org_id):
updateTag(dashboardsTag((data as { org_id: string }).org_id));
revalidatePath("/dashboards");
```

Apply the analogous edit to `renameDashboard`, `deleteDashboard`, `duplicateDashboard` (reading `org_id` where not already present), to `workspaces/actions.ts` (`workspacesTag(orgId)`), to `org/admin-actions.ts` (`orgAdminTag(parsed.data.userId, parsed.data.orgId)` in the four membership actions), and to `platform/actions.ts::platformSetOrgRole` (`orgAdminTag(parsed.data.userId, parsed.data.orgId)`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/dashboards src/lib/workspaces src/lib/org src/lib/platform`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/actions.ts src/lib/workspaces/actions.ts src/lib/org/admin-actions.ts src/lib/platform/actions.ts src/lib/dashboards/*.test.ts src/lib/workspaces/actions.test.ts src/lib/org/admin-actions.test.ts src/lib/platform/actions.test.ts
git commit -m "feat(cache): invalidate dashboards/workspaces/org-admin tags on mutation"
```

---

### Task 7: Invalidation in boards actions + sharing (coordination-sensitive — run LAST)

**Files:**

- Modify: `src/lib/boards/actions.ts` (`createBoard`, `createBoardFromTemplate`, `renameBoard`, `deleteBoard`, `duplicateBoard`)
- Modify: `src/lib/boards/sharing-actions.ts` (`shareBoard`, `unshareBoard`)
- Test: extend `src/lib/boards/actions.test.ts` and add/extend a sharing-actions test.

**Interfaces:**

- Consumes (from T1): `boardsTag`, `sharedBoardsTag`.
- Consumes (existing): `updateTag` from `next/cache`; `getUser` from `@/lib/auth/session` (for the owner's id on board-list mutations).
- Produces: each board-list mutation calls `updateTag(boardsTag(<ownerId>))`; share/unshare call `updateTag(sharedBoardsTag(<granteeId>))`.

**⚠ Coordination:** these are the exact functions the parallel "optimistic board mutations" task edits. Run this task **after** that task has merged to `develop` (or accept a one-line rebase per function). Each edit is a single `updateTag(...)` line + the import — keep the hunks minimal so rebase is trivial.

**Identity derivation:**

- Board-list mutations are scoped to the current user as owner (`created_by = me`). Read the owner id once via `getUser()` at the top of each action (or reuse if already read): `const user = await getUser();` then `updateTag(boardsTag(user.id))`. For `createBoard`/`createBoardFromTemplate`/`duplicateBoard`/`deleteBoard`/`renameBoard`, the owner is the current user.
- `shareBoard`/`unshareBoard`: the grantee is `parsed.data.userId` → `updateTag(sharedBoardsTag(parsed.data.userId))` (the recipient's shared-boards list is what changed).

- [ ] **Step 1: Write a failing test**

```ts
// add to src/lib/boards/actions.test.ts
import { updateTag } from "next/cache";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  getUser: async () => ({ id: "owner-1" }),
}));

it("createBoard updates the owner's boards tag", async () => {
  // arrange rpc('create_board') → { id: 'b1' }
  await createBoard({ workspaceId: "w1", name: "B" });
  expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
});
```

And a sharing test asserting `shareBoard({ boardId, userId: "grantee-1", access })` calls `updateTag("shared-boards:user:grantee-1")`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/boards/actions.test.ts`
Expected: FAIL — `updateTag` not called.

- [ ] **Step 3: Add the `updateTag` calls**

In `src/lib/boards/actions.ts`:

```ts
import { revalidatePath, updateTag } from "next/cache";
import { getUser } from "@/lib/auth/session";
import { boardsTag } from "@/lib/cache/tags";
// ...inside each board-list mutation, after success and before revalidatePath:
const user = await getUser();
if (user) updateTag(boardsTag(user.id));
revalidatePath("/", "layout");
```

In `src/lib/boards/sharing-actions.ts`:

```ts
import { revalidatePath, updateTag } from "next/cache";
import { sharedBoardsTag } from "@/lib/cache/tags";
// shareBoard / unshareBoard, after success:
updateTag(sharedBoardsTag(parsed.data.userId));
revalidatePath("/boards", "layout");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/boards/actions.test.ts src/lib/boards/sharing-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/actions.ts src/lib/boards/sharing-actions.ts src/lib/boards/actions.test.ts src/lib/boards/sharing-actions.test.ts
git commit -m "feat(cache): invalidate board and shared-board tags on board mutations"
```

---

### Task 8: Cross-tenant isolation integration test + full-suite gate

**Files:**

- Create: `src/lib/cache/cross-tenant-isolation.integration.test.ts`

**Interfaces:**

- Consumes: all cached reads (T2,T3,T4) + the test Supabase project harness used by the other `*.integration.test.ts` files (mirror their setup — they provision two orgs/users).

**This is the headline safety test of the phase.** Because the cached reads use the service client and re-implement the tenant filter by hand, a bug there is a cross-tenant leak. This test proves the filter holds.

- [ ] **Step 1: Write the isolation test**

```ts
// src/lib/cache/cross-tenant-isolation.integration.test.ts
// Mirror the provisioning helpers from src/lib/dashboards/dashboards.rls.integration.test.ts.
import { describe, expect, it } from "vitest";
import { listMyBoardsCached } from "@/lib/boards/queries-cached";
import { listDashboardsCached } from "@/lib/dashboards/queries-cached";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";

describe("cached reads never cross tenants", () => {
  it("user A's cached boards exclude user B's boards", async () => {
    // provision: userA in orgA with boardA; userB in orgB with boardB
    const aBoards = await listMyBoardsCached(/* userA.id */);
    const bBoards = await listMyBoardsCached(/* userB.id */);
    expect(aBoards.map((b) => b.id)).not.toContain(/* boardB.id */);
    expect(bBoards.map((b) => b.id)).not.toContain(/* boardA.id */);
  });

  it("org A's cached dashboards/workspaces exclude org B's", async () => {
    const aDash = await listDashboardsCached(/* orgA.id */);
    expect(aDash.map((d) => d.org_id)).not.toContain(/* orgB.id */);
    const aWs = await listWorkspacesCached(/* orgA.id */);
    // workspace list returns id+name only; assert by known ids instead
    expect(aWs.map((w) => w.id)).not.toContain(/* workspaceB.id */);
  });
});
```

Fill the provisioning blanks from the existing integration harness (the same `create_organization` + sign-in helpers the `*.rls.integration.test.ts` files use).

- [ ] **Step 2: Run the isolation test**

Run: `pnpm vitest run src/lib/cache/cross-tenant-isolation.integration.test.ts`
Expected: PASS — neither tenant sees the other's rows.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cache/cross-tenant-isolation.integration.test.ts
git commit -m "test(cache): prove cached shell reads never cross tenants"
```

---

## Self-Review

**Spec coverage:**

- Tag scheme → T1. cacheLife profiles → T1. ✓
- Strategy A (service client + explicit scoping + per-identity tag) → T2/T3/T4 (cached reads). ✓
- Shell wiring (sidebar/header/command-palette) → T5. ✓
- Invalidation map: dashboards/workspaces/org/platform → T6; boards + sharing → T7. ✓
- Perf/data-fetching budget → captured in spec + reflected in T5 (identity read outside cache; cached reads inside). ✓
- Zod/RLS/Server-Action invariants → Global Constraints + per-task notes. ✓
- Cross-tenant isolation test → T8; per-mutation invalidation tests → T6/T7. ✓
- Execution DAG with Consumes/Produces → DAG section + per-task Interfaces. ✓
- `boards/actions.ts` coordination risk → T7 (scheduled last). ✓
- Scoped-out widget aggregates → documented in spec; no task (correct). ✓

**Placeholder scan:** The intentional fill-in-from-harness blanks are in T4 (confirm `platform_admins` table name) and T8 (provisioning ids) — both are explicit "confirm against existing code" steps with the source named, not vague TODOs. Acceptable for an integration test that must reuse the repo's provisioning helpers.

**Type consistency:** `listMyBoardsCached`/`listSharedBoardsCached`/`listDashboardsCached`/`listWorkspacesCached`/`isPlatformAdminCached`/`isOrgAdminCached` names are identical across producing tasks (T2–T4) and the consuming task (T5). Tag builders (`boardsTag`, `sharedBoardsTag`, `dashboardsTag`, `workspacesTag`, `platformAdminTag`, `orgAdminTag`) are consistent T1 → T6/T7. ✓
