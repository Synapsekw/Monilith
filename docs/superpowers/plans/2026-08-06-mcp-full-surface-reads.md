# MCP Full-Surface Reads + Time Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Pulse's MCP server from 7 board/item tools to 22, giving connected clients a complete read surface over My Work, Time, Goals, Portfolios, Dashboards, Workload and Reports, plus one write verb for logging time.

**Architecture:** Two layers. Layer 1 extracts **client-injected cores** (`…Core(supabase, …)`) out of the seven cookie-bound query modules, leaving the existing exports as thin wrappers so every RSC page is untouched. Layer 2 adds one thin tool module per operation in `src/lib/mcp/tools/`, each projecting a core's result to trimmed, agent-shaped JSON. Cores live in non-`"use server"` modules so they can be imported without becoming server-action endpoints.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript strict, `@modelcontextprotocol/sdk`, Supabase (RLS + RPC), Zod, Vitest.

**Spec:** [`docs/superpowers/specs/2026-08-06-mcp-full-surface-reads-design.md`](../specs/2026-08-06-mcp-full-surface-reads-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **RLS is the security boundary.** A tool module MUST NEVER call `createServiceClient()`. Reads run on the bridged client from `getClient()`.
- **`getClient()` is called EXACTLY ONCE per handler invocation.** Each call charges the MCP rate limit and rotates the OAuth bridge secret (`src/lib/mcp/context.ts:56-77`). Never inside a loop.
- **Service-client caller contract.** `listOrgMembersCached` / `listReadableBoardsCached` / the `*Cached` widget helpers use `createServiceClient()` and document: _"CALLER CONTRACT: pass an orgId the current user is entitled to."_ MCP satisfies this only with an `orgId` that came from `resolveToolOrg` (membership-validated) or off a row already read through the bridged RLS client. Never from raw tool input.
- **Cores live outside `"use server"` files.** Every export of a `"use server"` module becomes a public server-action endpoint. Cores therefore go in plain modules (the `src/lib/boards/actions/cell-core.ts` precedent).
- **Tool result shape:** `ToolResult` from `src/lib/mcp/tools/shared.ts` — one text block, optional `isError: true`.
- **Zod validates every tool input** at the boundary. TypeScript strict; no `any`.
- **Reuse canonical modules.** `ActionResult` / `fail` from `src/lib/actions/result.ts`. Grep before writing any helper.
- **Bounded reads.** Every list tool has an exported cap const, states it in its description, and asserts it in a test.
- **Commit identity is pinned:** `Danijel Jovanovic <info@synapse-solutions.ai>`.
- **Stage explicitly by path.** Never `git add -A` / `git add .` / `git commit -a`.
- **commitlint:** conventional commits, subject must be lower-case (`feat(mcp): add …`, not `feat(mcp): Add …`). Prettier reformats staged files via lint-staged on commit.
- **Gates before merge:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

### Spec amendments made during planning

Reading the actual modules changed four details. The spec has been amended to match; they are listed here so a reviewer can see the divergence.

1. **`get_my_work` takes no `orgId`.** `getMyWorkItems` resolves through the `get_my_work_items` RPC (SECURITY INVOKER, RLS-filtered per caller). It is user-scoped by construction; an `orgId` parameter would be inert.
2. **`list_organizations` returns `{ id, name, timezone }`, not `role`.** `UserOrg` (`src/lib/auth/session.ts:17`) is `Pick<Organization, "id" | "name" | "timezone">`. Adding `role` would need a second `org_members` query for negligible agent value.
3. **Cores take only the context they need**, not a uniform `{ userId, orgId }`. My Work needs neither; time reads need `userId`; workload/goals/portfolios need `orgId`.
4. **`get_report` returns the report's structure, not resolved chart data.** `shapeReport` / `computeKpis` / `computeChartSeries` (`src/lib/reports/{shape,chart-data}.ts`) all take a full `BoardPayload` — every cell value, attachment and time entry for the board. Resolving a report inside a tool would be an unbounded read, violating spec §5. Resolved report data moves to Spec 2, which can build a bounded report-data core.

## File Structure

**New — MCP shared helpers**

| File                         | Responsibility                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/mcp/org-scope.ts`   | `resolveToolOrg` (pure), `listToolOrgs`, `listOrgMemberProfiles` — bridged, RLS-scoped org + member reads. No service client. |
| `src/lib/mcp/tools/range.ts` | `validateRange(from, to, maxDays)` — shared date-span guard.                                                                  |

**New — one module per tool** (all in `src/lib/mcp/tools/`)

`list-organizations.ts`, `get-my-work.ts`, `list-time-allocations.ts`, `get-time-summary.ts`, `log-time-allocation.ts`, `list-goals.ts`, `get-goal.ts`, `list-portfolios.ts`, `get-portfolio.ts`, `list-dashboards.ts`, `get-dashboard.ts`, `get-widget-data.ts`, `get-workload.ts`, `list-reports.ts`, `get-report.ts`

**New — cores that cannot live in their existing home**

| File                                     | Why                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `src/lib/time/allocation-core.ts`        | `src/lib/time/actions.ts` is `"use server"`.                             |
| `src/lib/time/summary.ts`                | Pure fold for `get_time_summary`; unit-testable without a client.        |
| `src/lib/dashboards/widget-slot-core.ts` | Hosts `resolveWidgetSlot`, moved out of the `"use server"` `actions.ts`. |

**Modified — core extraction in place**

`src/lib/my-work/queries.ts`, `src/lib/time/queries.ts`, `src/lib/time/actions.ts`, `src/lib/goals/queries.ts`, `src/lib/portfolios/queries.ts`, `src/lib/dashboards/queries.ts`, `src/lib/dashboards/actions.ts`, `src/lib/workload/queries.ts`, `src/lib/reports/queries.ts`, `src/lib/mcp/tools/register.ts`, `src/components/settings/mcp/mcp-tools-table.tsx`

### Testing conventions for this plan

- **Single-query cores → fake client**, matching `src/lib/mcp/tools/list-boards.test.ts`. Inline object literals cast with `as never` at the `getClient` boundary.
- **Multi-query cores → `vi.mock` the core module** and assert the tool's projection, caps and error path in isolation. Do NOT extend `src/test/mcp-fake-client.ts`; its header scopes it to four specific call shapes.
- Every tool test asserts `getClient` was called **exactly once**.

---

## Execution DAG

**Dependencies**

- Task 1 → (Tasks 4, 5, 6, 7, 8, 9) — every org-scoped tool consumes `resolveToolOrg`.
- Tasks 2, 3 have no dependencies (user-scoped surfaces).
- Task 10 ← Tasks 1–9 (the settings table lists every registered tool).
- Task 11 ← Tasks 1–9 (cross-org tests exercise every org-scoped tool).

**Parallel batches**

| Batch | Tasks                  | Notes                                                           |
| ----- | ---------------------- | --------------------------------------------------------------- |
| A     | 1                      | Dependency root.                                                |
| B     | 2, 3, 4, 5, 6, 7, 8, 9 | Mutually independent — disjoint files apart from `register.ts`. |
| C     | 10, 11                 | Both need every tool registered.                                |

**Critical path:** Task 1 → Task 7 (dashboards, the largest surface) → Task 10. Batch B is the wall-clock floor.

**Worktree note:** if Batch B runs as parallel agents, every task appends two lines to `src/lib/mcp/tools/register.ts` — a guaranteed trivial rebase conflict. Running Batch B sequentially in one worktree avoids it entirely and is the recommended execution mode.

---

## Task 1: Org scope helper + `list_organizations`

**Files:**

- Create: `src/lib/mcp/org-scope.ts`
- Create: `src/lib/mcp/org-scope.test.ts`
- Create: `src/lib/mcp/tools/list-organizations.ts`
- Create: `src/lib/mcp/tools/list-organizations.test.ts`
- Modify: `src/lib/mcp/tools/register.ts`

**Interfaces:**

- Consumes: `UserOrg` from `src/lib/auth/session.ts`; `GetClient`, `ToolResult` from `src/lib/mcp/tools/shared.ts`.
- Produces:
  - `resolveToolOrg(orgs: UserOrg[], requested?: string): UserOrg | null`
  - `listToolOrgs(supabase: SupabaseClient<Database>): Promise<UserOrg[]>`
  - `listOrgMemberProfiles(supabase, orgId): Promise<OrgMemberProfile[]>` where `OrgMemberProfile = { userId: string; fullName: string | null; avatarUrl: string | null }`
  - `resolveOrgForTool(supabase, requested?): Promise<{ org: UserOrg } | { error: string }>`
  - `listOrganizationsHandler(getClient: GetClient): Promise<ToolResult>`
  - `registerListOrganizationsTool(server: McpServer, getClient: GetClient): void`

- [ ] **Step 1: Write the failing test for `resolveToolOrg`**

Create `src/lib/mcp/org-scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveToolOrg } from "./org-scope";
import type { UserOrg } from "@/lib/auth/session";

const ORGS: UserOrg[] = [
  { id: "o1", name: "Acme", timezone: "UTC" },
  { id: "o2", name: "Globex", timezone: "Europe/Berlin" },
];

describe("resolveToolOrg", () => {
  it("returns the first org when nothing is requested", () => {
    expect(resolveToolOrg(ORGS)?.id).toBe("o1");
  });

  it("honours a requested id the user is a member of", () => {
    expect(resolveToolOrg(ORGS, "o2")?.id).toBe("o2");
  });

  it("returns null for a foreign id rather than falling back", () => {
    expect(resolveToolOrg(ORGS, "o-foreign")).toBeNull();
  });

  it("returns null when the user has no orgs", () => {
    expect(resolveToolOrg([], undefined)).toBeNull();
  });
});
```

The third case is the deliberate difference from `pickActiveOrg` (`src/lib/org/active.ts:26-34`), which falls back to the first org on a stale cookie. A stale cookie is a UX detail; an agent passing an explicit wrong `orgId` must get an error, not silently different data.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/lib/mcp/org-scope.test.ts`
Expected: FAIL — `Failed to resolve import "./org-scope"`.

- [ ] **Step 3: Implement `org-scope.ts`**

Create `src/lib/mcp/org-scope.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { UserOrg } from "@/lib/auth/session";

/**
 * The org an MCP tool acts in. Mirrors `pickActiveOrg` with ONE deliberate
 * difference: an explicitly requested id that is not a membership returns null
 * instead of falling back to the first org. A stale cookie is a UX detail; an
 * agent passing the wrong `orgId` must be told, not silently served another
 * tenant's view. RLS remains the actual boundary underneath either way.
 */
export function resolveToolOrg(
  orgs: UserOrg[],
  requested?: string,
): UserOrg | null {
  if (requested) return orgs.find((o) => o.id === requested) ?? null;
  return orgs[0] ?? null;
}

/** The connected user's orgs, read through the bridged RLS client. */
export async function listToolOrgs(
  supabase: SupabaseClient<Database>,
): Promise<UserOrg[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, timezone")
    .order("name", { ascending: true });
  if (error) throw new Error(`Failed to load organizations: ${error.message}`);
  return data ?? [];
}

export type OrgMemberProfile = {
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
};

/** Hot-path cap. `org_members` PK is (org_id, user_id) — index-covered. */
export const ORG_MEMBER_PROFILES_LIMIT = 500;

/**
 * Org member profiles over the BRIDGED client. Deliberately not
 * `listOrgMembersCached`: that helper runs on the service client, and keeping
 * MCP off the service client entirely (spec §3.2) is worth one small
 * RLS-scoped query.
 */
export async function listOrgMemberProfiles(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<OrgMemberProfile[]> {
  const { data, error } = await supabase
    .from("org_members")
    .select("user_id, profiles(full_name, avatar_url)")
    .eq("org_id", orgId)
    .is("deactivated_at", null)
    .limit(ORG_MEMBER_PROFILES_LIMIT);
  if (error) throw new Error(`Failed to load org members: ${error.message}`);
  return (data ?? []).map((r) => {
    const p = r.profiles as {
      full_name: string | null;
      avatar_url: string | null;
    } | null;
    return {
      userId: r.user_id,
      fullName: p?.full_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
    };
  });
}

/** Load + resolve in one step. Returns a message every org-scoped tool surfaces verbatim. */
export async function resolveOrgForTool(
  supabase: SupabaseClient<Database>,
  requested?: string,
): Promise<{ org: UserOrg } | { error: string }> {
  const orgs = await listToolOrgs(supabase);
  const org = resolveToolOrg(orgs, requested);
  if (!org)
    return {
      error: requested
        ? `You are not a member of organization ${requested}.`
        : "No organization.",
    };
  return { org };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/mcp/org-scope.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for the tool handler**

Create `src/lib/mcp/tools/list-organizations.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { listOrganizationsHandler } from "./list-organizations";

function fakeClient(rows: unknown[], error: { message: string } | null = null) {
  return {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: rows, error }),
      }),
    }),
  };
}

describe("listOrganizationsHandler", () => {
  it("returns the user's orgs", async () => {
    const client = fakeClient([{ id: "o1", name: "Acme", timezone: "UTC" }]);
    const getClient = vi.fn(async () => client as never);
    const result = await listOrganizationsHandler(getClient);

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: "o1", name: "Acme", timezone: "UTC" },
    ]);
  });

  it("reports a read failure as a tool error", async () => {
    const client = fakeClient([], { message: "boom" });
    const result = await listOrganizationsHandler(async () => client as never);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `pnpm vitest run src/lib/mcp/tools/list-organizations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the tool**

Create `src/lib/mcp/tools/list-organizations.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listToolOrgs } from "@/lib/mcp/org-scope";
import type { GetClient, ToolResult } from "./shared";

export async function listOrganizationsHandler(
  getClient: GetClient,
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const orgs = await listToolOrgs(supabase);
    return { content: [{ type: "text", text: JSON.stringify(orgs) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerListOrganizationsTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_organizations",
    {
      title: "List organizations",
      description:
        "List the organizations the connected user belongs to. Use the returned id as the optional `orgId` argument on org-scoped tools.",
      inputSchema: {},
    },
    async () => listOrganizationsHandler(getClient),
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/mcp/tools/list-organizations.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Register the tool**

In `src/lib/mcp/tools/register.ts`, add the import beside the existing seven and the call inside `registerTools`:

```ts
import { registerListOrganizationsTool } from "./list-organizations";
// …
registerListOrganizationsTool(server, getClient);
```

- [ ] **Step 10: Run the full suite and typecheck**

Run: `pnpm typecheck && pnpm vitest run src/lib/mcp`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/mcp/org-scope.ts src/lib/mcp/org-scope.test.ts \
        src/lib/mcp/tools/list-organizations.ts \
        src/lib/mcp/tools/list-organizations.test.ts \
        src/lib/mcp/tools/register.ts
git commit -m "feat(mcp): add org scope helper and list_organizations tool"
```

---

## Task 2: `get_my_work`

**Files:**

- Modify: `src/lib/my-work/queries.ts:35-63`
- Create: `src/lib/mcp/tools/get-my-work.ts`
- Create: `src/lib/mcp/tools/get-my-work.test.ts`
- Modify: `src/lib/mcp/tools/register.ts`

**Interfaces:**

- Consumes: `GetClient`, `ToolResult`; `bucketMyWork`, `MyWorkItem` from `src/lib/my-work/bucket.ts`; `serverToday` from `src/lib/portfolios/rollup.ts`.
- Produces:
  - `getMyWorkItemsCore(supabase: SupabaseClient<Database>, limit?: number): Promise<MyWorkItem[]>`
  - `MY_WORK_TOOL_LIMIT: number`
  - `getMyWorkHandler(getClient: GetClient): Promise<ToolResult>`
  - `registerGetMyWorkTool(server: McpServer, getClient: GetClient): void`

This surface takes **no `orgId`** — `get_my_work_items` is SECURITY INVOKER and RLS-filtered per caller.

- [ ] **Step 1: Extract the core**

In `src/lib/my-work/queries.ts`, replace `getMyWorkItems` (lines 35–63) with a core plus wrapper. Add the two imports at the top:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
```

Then:

```ts
/**
 * Client-injected core. Takes the client as a parameter so both the RSC path
 * (cookie-bound) and the MCP path (OAuth-bridged) share ONE implementation —
 * the `upsertCellCore` precedent. The RPC is SECURITY INVOKER, so RLS scopes
 * rows to the caller and no userId/orgId argument is needed.
 */
export async function getMyWorkItemsCore(
  supabase: SupabaseClient<Database>,
  limit: number = MY_WORK_ITEM_LIMIT,
): Promise<MyWorkItem[]> {
  const { data, error } = await supabase.rpc("get_my_work_items", {
    p_limit: limit,
  });
  if (error || !data) return [];

  return data.map((r) => {
    let status: MyWorkStatus | null = null;
    if (r.status_option_id && r.status_settings) {
      const opt = parseOptions(r.status_settings).find(
        (o) => o.id === r.status_option_id,
      );
      if (opt) status = { label: opt.label, color: opt.color };
    }
    return {
      itemId: r.item_id,
      itemName: r.item_name,
      boardId: r.board_id,
      boardName: r.board_name ?? "Unknown board",
      groupName: r.group_name,
      status,
      dueDate: r.due_date,
    };
  });
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export async function getMyWorkItems(): Promise<MyWorkItem[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  return getMyWorkItemsCore(supabase);
}
```

`getMyWorkPageData` (lines 71–78) is unchanged.

- [ ] **Step 2: Run the existing my-work tests to prove the extraction changed nothing**

Run: `pnpm vitest run src/lib/my-work`
Expected: PASS — same tests, same results. If any fail, the extraction was not mechanical; revert and redo.

- [ ] **Step 3: Write the failing tool test**

Create `src/lib/mcp/tools/get-my-work.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getMyWorkHandler, MY_WORK_TOOL_LIMIT } from "./get-my-work";

const ROW = {
  item_id: "i1",
  item_name: "Ship the API",
  board_id: "b1",
  board_name: "Roadmap",
  group_name: "In progress",
  status_option_id: null,
  status_settings: null,
  due_date: "2020-01-01",
};

describe("getMyWorkHandler", () => {
  it("buckets items and projects them without UI fields", async () => {
    const rpc = vi.fn(async () => ({ data: [ROW], error: null }));
    const getClient = vi.fn(async () => ({ rpc }) as never);

    const result = await getMyWorkHandler(getClient);

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_my_work_items", {
      p_limit: MY_WORK_TOOL_LIMIT,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.groups[0].bucket).toBe("overdue");
    expect(parsed.groups[0].items[0]).toEqual({
      id: "i1",
      name: "Ship the API",
      boardId: "b1",
      boardName: "Roadmap",
      groupName: "In progress",
      dueDate: "2020-01-01",
      status: null,
    });
  });

  it("returns an empty group list when nothing is assigned", async () => {
    const getClient = vi.fn(
      async () => ({ rpc: async () => ({ data: [], error: null }) }) as never,
    );
    const result = await getMyWorkHandler(getClient);
    expect(JSON.parse(result.content[0].text).groups).toEqual([]);
  });
});
```

The 2020 due date guarantees the `overdue` bucket regardless of when the suite runs.

- [ ] **Step 4: Run it to make sure it fails**

Run: `pnpm vitest run src/lib/mcp/tools/get-my-work.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the tool**

Create `src/lib/mcp/tools/get-my-work.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMyWorkItemsCore } from "@/lib/my-work/queries";
import { bucketMyWork } from "@/lib/my-work/bucket";
import { serverToday } from "@/lib/portfolios/rollup";
import type { GetClient, ToolResult } from "./shared";

/** Tool-side cap — well under MY_WORK_ITEM_LIMIT (500), which sizes a scrollable
 *  page. An agent reading 200 assigned items already has more than it can use. */
export const MY_WORK_TOOL_LIMIT = 200;

export async function getMyWorkHandler(
  getClient: GetClient,
): Promise<ToolResult> {
  const supabase = await getClient();
  const items = await getMyWorkItemsCore(supabase, MY_WORK_TOOL_LIMIT);
  const today = serverToday(Date.now());

  // Projection drops status.color — a UI token with no meaning to an agent.
  const groups = bucketMyWork(items, today).map((g) => ({
    bucket: g.bucket,
    label: g.label,
    items: g.items.map((i) => ({
      id: i.itemId,
      name: i.itemName,
      boardId: i.boardId,
      boardName: i.boardName,
      groupName: i.groupName,
      dueDate: i.dueDate,
      status: i.status?.label ?? null,
    })),
  }));

  return {
    content: [{ type: "text", text: JSON.stringify({ today, groups }) }],
  };
}

export function registerGetMyWorkTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_my_work",
    {
      title: "Get my work",
      description: `Every item assigned to the connected user across all boards, grouped by due date (overdue, today, this week, later, no date). Returns at most ${MY_WORK_TOOL_LIMIT} items. Scoped to the user automatically — no organization argument.`,
      inputSchema: {},
    },
    async () => getMyWorkHandler(getClient),
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/mcp/tools/get-my-work.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Register the tool**

In `src/lib/mcp/tools/register.ts`:

```ts
import { registerGetMyWorkTool } from "./get-my-work";
// …
registerGetMyWorkTool(server, getClient);
```

- [ ] **Step 8: Verify nothing regressed**

Run: `pnpm typecheck && pnpm vitest run src/lib/mcp src/lib/my-work`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/my-work/queries.ts src/lib/mcp/tools/get-my-work.ts \
        src/lib/mcp/tools/get-my-work.test.ts src/lib/mcp/tools/register.ts
git commit -m "feat(mcp): add get_my_work tool with client-injected core"
```

---

## Task 3: Time reads — `list_time_allocations` + `get_time_summary`

**Files:**

- Modify: `src/lib/time/queries.ts` (append a new core; existing functions untouched)
- Create: `src/lib/time/summary.ts`
- Create: `src/lib/time/summary.test.ts`
- Create: `src/lib/mcp/tools/range.ts`
- Create: `src/lib/mcp/tools/range.test.ts`
- Create: `src/lib/mcp/tools/list-time-allocations.ts`
- Create: `src/lib/mcp/tools/list-time-allocations.test.ts`
- Create: `src/lib/mcp/tools/get-time-summary.ts`
- Create: `src/lib/mcp/tools/get-time-summary.test.ts`
- Modify: `src/lib/mcp/tools/register.ts`

**Interfaces:**

- Consumes: `GetClient`, `ToolResult`; `mcpActorId` is NOT needed (reads filter on the bridged user via an explicit `userId`).
- Produces:
  - `TimeAllocationFlat = { date: string; itemId: string | null; itemName: string | null; boardId: string | null; category: string | null; secs: number; note: string | null }`
  - `listTimeAllocationsCore(supabase, args: { userId: string; from: string; to: string; limit?: number }): Promise<TimeAllocationFlat[]>`
  - `TIME_ALLOCATIONS_LIMIT`, `TIME_RANGE_MAX_DAYS`
  - `summarizeAllocations(rows: TimeAllocationFlat[], groupBy: "item" | "category" | "day"): SummaryBucket[]` where `SummaryBucket = { key: string; label: string; totalSecs: number }`
  - `validateRange(from: string, to: string, maxDays: number): string | null`
  - `listTimeAllocationsHandler`, `getTimeSummaryHandler`, and their `register…Tool` functions

`getTimeCardData` is deliberately NOT extracted: the tool returns flat rows, and the card's `weekStart` / `days` / `cells` scaffolding exists only for the grid UI.

- [ ] **Step 1: Write the failing test for the range guard**

Create `src/lib/mcp/tools/range.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateRange } from "./range";

describe("validateRange", () => {
  it("accepts a range inside the cap", () => {
    expect(validateRange("2026-01-01", "2026-01-31", 92)).toBeNull();
  });

  it("accepts a single day", () => {
    expect(validateRange("2026-01-01", "2026-01-01", 92)).toBeNull();
  });

  it("rejects a reversed range", () => {
    expect(validateRange("2026-02-01", "2026-01-01", 92)).toContain("before");
  });

  it("rejects a range longer than the cap, naming the cap", () => {
    const msg = validateRange("2026-01-01", "2026-12-31", 92);
    expect(msg).toContain("92");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/lib/mcp/tools/range.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the range guard**

Create `src/lib/mcp/tools/range.ts`:

```ts
const DAY_MS = 86_400_000;

/**
 * Guards a date-ranged tool. Returns null when the range is usable, otherwise
 * the message the handler surfaces verbatim.
 *
 * Date-ranged tools cap the SPAN, not the row count: silently truncating a
 * year of time data to the first N rows produces a confident, wrong total.
 * Failing loudly makes the agent narrow the window instead.
 */
export function validateRange(
  from: string,
  to: string,
  maxDays: number,
): string | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end))
    return "Dates must be ISO `YYYY-MM-DD`.";
  if (end < start) return "`from` must be on or before `to`.";
  const days = Math.round((end - start) / DAY_MS) + 1;
  if (days > maxDays)
    return `Range too large: ${days} days requested, limit is ${maxDays}. Narrow the window and call again.`;
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/mcp/tools/range.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for the summary fold**

Create `src/lib/time/summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeAllocations } from "./summary";
import type { TimeAllocationFlat } from "./queries";

const ROWS: TimeAllocationFlat[] = [
  {
    date: "2026-01-01",
    itemId: "i1",
    itemName: "API",
    boardId: "b1",
    category: null,
    secs: 3600,
    note: null,
  },
  {
    date: "2026-01-01",
    itemId: "i1",
    itemName: "API",
    boardId: "b1",
    category: null,
    secs: 1800,
    note: null,
  },
  {
    date: "2026-01-02",
    itemId: null,
    itemName: null,
    boardId: null,
    category: "Admin",
    secs: 900,
    note: null,
  },
];

describe("summarizeAllocations", () => {
  it("groups by item and sums seconds", () => {
    expect(summarizeAllocations(ROWS, "item")).toEqual([
      { key: "i1", label: "API", totalSecs: 5400 },
    ]);
  });

  it("groups by category", () => {
    expect(summarizeAllocations(ROWS, "category")).toEqual([
      { key: "Admin", label: "Admin", totalSecs: 900 },
    ]);
  });

  it("groups by day, sorted ascending", () => {
    expect(summarizeAllocations(ROWS, "day")).toEqual([
      { key: "2026-01-01", label: "2026-01-01", totalSecs: 5400 },
      { key: "2026-01-02", label: "2026-01-02", totalSecs: 900 },
    ]);
  });
});
```

Note `item` grouping omits the category-only row and `category` grouping omits the item rows — each grouping reports only the rows that carry that dimension.

- [ ] **Step 6: Run it to make sure it fails**

Run: `pnpm vitest run src/lib/time/summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the fold**

Create `src/lib/time/summary.ts`:

```ts
import type { TimeAllocationFlat } from "./queries";

export type SummaryGroupBy = "item" | "category" | "day";

export type SummaryBucket = {
  key: string;
  label: string;
  totalSecs: number;
};

/**
 * Pure fold over flat allocation rows. No client, no clock — the caller has
 * already bounded the window, so this is trivially unit-testable.
 *
 * A row only participates in the grouping whose dimension it carries: an
 * allocation is keyed by EITHER item_id OR category (the two unique partial
 * indexes on time_allocations), never both.
 */
export function summarizeAllocations(
  rows: TimeAllocationFlat[],
  groupBy: SummaryGroupBy,
): SummaryBucket[] {
  const acc = new Map<string, SummaryBucket>();

  for (const r of rows) {
    let key: string | null = null;
    let label = "";
    if (groupBy === "item") {
      if (!r.itemId) continue;
      key = r.itemId;
      label = r.itemName ?? r.itemId;
    } else if (groupBy === "category") {
      if (!r.category) continue;
      key = r.category;
      label = r.category;
    } else {
      key = r.date;
      label = r.date;
    }

    const existing = acc.get(key);
    if (existing) existing.totalSecs += r.secs;
    else acc.set(key, { key, label, totalSecs: r.secs });
  }

  return [...acc.values()].sort((a, b) =>
    groupBy === "day"
      ? a.key.localeCompare(b.key)
      : b.totalSecs - a.totalSecs || a.label.localeCompare(b.label),
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/time/summary.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Add the flat-rows core**

Append to `src/lib/time/queries.ts` (and add the `SupabaseClient` / `Database` type imports at the top):

```ts
/** Hot-path caps (AGENTS.md: bounded reads over indexed columns). The row read
 *  is served by the (user_id, work_date) unique partial indexes. */
export const TIME_ALLOCATIONS_LIMIT = 1000;
export const TIME_RANGE_MAX_DAYS = 92;

/** One manual allocation, flattened for agent consumption — no week/cell
 *  scaffolding (that shape exists for the grid UI only). */
export type TimeAllocationFlat = {
  date: string;
  itemId: string | null;
  itemName: string | null;
  boardId: string | null;
  category: string | null;
  secs: number;
  note: string | null;
};

/**
 * Flat manual allocations for one user over [from, to]. Client-injected so the
 * MCP path shares this implementation; the caller bounds the span
 * (`validateRange`) before calling.
 */
export async function listTimeAllocationsCore(
  supabase: SupabaseClient<Database>,
  args: { userId: string; from: string; to: string; limit?: number },
): Promise<TimeAllocationFlat[]> {
  const { data, error } = await supabase
    .from("time_allocations")
    .select("work_date, item_id, board_id, category, duration_secs, note")
    .eq("user_id", args.userId)
    .gte("work_date", args.from)
    .lte("work_date", args.to)
    .order("work_date", { ascending: true })
    .limit(args.limit ?? TIME_ALLOCATIONS_LIMIT);
  if (error)
    throw new Error(`Failed to load time allocations: ${error.message}`);

  const rows = data ?? [];
  const itemIds = [
    ...new Set(rows.map((r) => r.item_id).filter((id): id is string => !!id)),
  ];

  // ONE metadata read for every referenced item — never per row.
  const names = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("id, name")
      .in("id", itemIds);
    if (itemsErr)
      throw new Error(`Failed to load item metadata: ${itemsErr.message}`);
    for (const it of items ?? []) names.set(it.id, it.name);
  }

  return rows.map((r) => ({
    date: r.work_date,
    itemId: r.item_id,
    itemName: r.item_id ? (names.get(r.item_id) ?? null) : null,
    boardId: r.board_id,
    category: r.category,
    secs: Number(r.duration_secs ?? 0),
    note: r.note,
  }));
}
```

- [ ] **Step 10: Write the failing tests for both tools**

Create `src/lib/mcp/tools/list-time-allocations.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { listTimeAllocationsHandler } from "./list-time-allocations";

vi.mock("@/lib/time/queries", () => ({
  TIME_ALLOCATIONS_LIMIT: 1000,
  TIME_RANGE_MAX_DAYS: 92,
  listTimeAllocationsCore: vi.fn(async () => [
    {
      date: "2026-01-01",
      itemId: "i1",
      itemName: "API",
      boardId: "b1",
      category: null,
      secs: 3600,
      note: "morning",
    },
  ]),
}));

describe("listTimeAllocationsHandler", () => {
  it("returns flat rows for a valid range", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await listTimeAllocationsHandler(getClient, "u1", {
      from: "2026-01-01",
      to: "2026-01-31",
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        date: "2026-01-01",
        itemId: "i1",
        itemName: "API",
        boardId: "b1",
        category: null,
        secs: 3600,
        note: "morning",
      },
    ]);
  });

  it("rejects an over-long range without touching the client", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await listTimeAllocationsHandler(getClient, "u1", {
      from: "2026-01-01",
      to: "2026-12-31",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("92");
    expect(getClient).not.toHaveBeenCalled();
  });
});
```

Create `src/lib/mcp/tools/get-time-summary.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getTimeSummaryHandler } from "./get-time-summary";

vi.mock("@/lib/time/queries", () => ({
  TIME_ALLOCATIONS_LIMIT: 1000,
  TIME_RANGE_MAX_DAYS: 92,
  listTimeAllocationsCore: vi.fn(async () => [
    {
      date: "2026-01-01",
      itemId: "i1",
      itemName: "API",
      boardId: "b1",
      category: null,
      secs: 3600,
      note: null,
    },
    {
      date: "2026-01-02",
      itemId: "i1",
      itemName: "API",
      boardId: "b1",
      category: null,
      secs: 1800,
      note: null,
    },
  ]),
}));

describe("getTimeSummaryHandler", () => {
  it("folds rows into totals for the requested grouping", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await getTimeSummaryHandler(getClient, "u1", {
      from: "2026-01-01",
      to: "2026-01-31",
      groupBy: "item",
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual([
      { key: "i1", label: "API", totalSecs: 5400 },
    ]);
  });

  it("rejects an over-long range", async () => {
    const result = await getTimeSummaryHandler(
      async () => ({}) as never,
      "u1",
      { from: "2026-01-01", to: "2026-12-31", groupBy: "day" },
    );
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 11: Run them to make sure they fail**

Run: `pnpm vitest run src/lib/mcp/tools/list-time-allocations.test.ts src/lib/mcp/tools/get-time-summary.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 12: Implement `list_time_allocations`**

Create `src/lib/mcp/tools/list-time-allocations.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listTimeAllocationsCore,
  TIME_ALLOCATIONS_LIMIT,
  TIME_RANGE_MAX_DAYS,
} from "@/lib/time/queries";
import { validateRange } from "./range";
import type { GetClient, ToolResult } from "./shared";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use `YYYY-MM-DD`.");

export const listTimeAllocationsInput = {
  from: isoDate,
  to: isoDate,
};

export async function listTimeAllocationsHandler(
  getClient: GetClient,
  userId: string,
  args: { from: string; to: string },
): Promise<ToolResult> {
  // Guard BEFORE getClient(): an invalid range should not charge the rate
  // limit or rotate the bridge secret.
  const rangeError = validateRange(args.from, args.to, TIME_RANGE_MAX_DAYS);
  if (rangeError)
    return { content: [{ type: "text", text: rangeError }], isError: true };

  const supabase = await getClient();
  try {
    const rows = await listTimeAllocationsCore(supabase, {
      userId,
      from: args.from,
      to: args.to,
    });
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerListTimeAllocationsTool(
  server: McpServer,
  getClient: GetClient,
  actorId: string,
): void {
  server.registerTool(
    "list_time_allocations",
    {
      title: "List time allocations",
      description: `The connected user's manually logged time between two dates, as flat rows. Range must be at most ${TIME_RANGE_MAX_DAYS} days; returns at most ${TIME_ALLOCATIONS_LIMIT} rows. Does not include running-timer entries.`,
      inputSchema: listTimeAllocationsInput,
    },
    async (args) => listTimeAllocationsHandler(getClient, actorId, args),
  );
}
```

- [ ] **Step 13: Implement `get_time_summary`**

Create `src/lib/mcp/tools/get-time-summary.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listTimeAllocationsCore,
  TIME_RANGE_MAX_DAYS,
} from "@/lib/time/queries";
import { summarizeAllocations, type SummaryGroupBy } from "@/lib/time/summary";
import { validateRange } from "./range";
import type { GetClient, ToolResult } from "./shared";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use `YYYY-MM-DD`.");

export const getTimeSummaryInput = {
  from: isoDate,
  to: isoDate,
  groupBy: z.enum(["item", "category", "day"]),
};

export async function getTimeSummaryHandler(
  getClient: GetClient,
  userId: string,
  args: { from: string; to: string; groupBy: SummaryGroupBy },
): Promise<ToolResult> {
  const rangeError = validateRange(args.from, args.to, TIME_RANGE_MAX_DAYS);
  if (rangeError)
    return { content: [{ type: "text", text: rangeError }], isError: true };

  const supabase = await getClient();
  try {
    const rows = await listTimeAllocationsCore(supabase, {
      userId,
      from: args.from,
      to: args.to,
    });
    const buckets = summarizeAllocations(rows, args.groupBy);
    return { content: [{ type: "text", text: JSON.stringify(buckets) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerGetTimeSummaryTool(
  server: McpServer,
  getClient: GetClient,
  actorId: string,
): void {
  server.registerTool(
    "get_time_summary",
    {
      title: "Get time summary",
      description: `Totals of the connected user's manually logged time between two dates, grouped by item, category or day. Range must be at most ${TIME_RANGE_MAX_DAYS} days.`,
      inputSchema: getTimeSummaryInput,
    },
    async (args) => getTimeSummaryHandler(getClient, actorId, args),
  );
}
```

- [ ] **Step 14: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/mcp/tools/list-time-allocations.test.ts src/lib/mcp/tools/get-time-summary.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 15: Register both tools**

In `src/lib/mcp/tools/register.ts`:

```ts
import { registerListTimeAllocationsTool } from "./list-time-allocations";
import { registerGetTimeSummaryTool } from "./get-time-summary";
// …
registerListTimeAllocationsTool(server, getClient, actorId);
registerGetTimeSummaryTool(server, getClient, actorId);
```

- [ ] **Step 16: Verify nothing regressed**

Run: `pnpm typecheck && pnpm vitest run src/lib/mcp src/lib/time`
Expected: PASS.

- [ ] **Step 17: Commit**

```bash
git add src/lib/time/queries.ts src/lib/time/summary.ts src/lib/time/summary.test.ts \
        src/lib/mcp/tools/range.ts src/lib/mcp/tools/range.test.ts \
        src/lib/mcp/tools/list-time-allocations.ts src/lib/mcp/tools/list-time-allocations.test.ts \
        src/lib/mcp/tools/get-time-summary.ts src/lib/mcp/tools/get-time-summary.test.ts \
        src/lib/mcp/tools/register.ts
git commit -m "feat(mcp): add time allocation read tools"
```

---

## Task 4: `log_time_allocation` (the write verb)

**Files:**

- Create: `src/lib/time/allocation-core.ts`
- Create: `src/lib/time/allocation-core.test.ts`
- Modify: `src/lib/time/actions.ts:21-62`
- Create: `src/lib/mcp/tools/log-time-allocation.ts`
- Create: `src/lib/mcp/tools/log-time-allocation.test.ts`
- Modify: `src/lib/mcp/tools/register.ts`

**Interfaces:**

- Consumes: `resolveOrgForTool` (Task 1); `upsertTimeAllocationSchema` from `src/lib/validations/time.ts`; `ActionResult` / `fail` from `src/lib/actions/result.ts`; `mcpActorId` via the `actorId` already threaded into `registerTools`.
- Produces:
  - `upsertTimeAllocationCore(supabase, input: UpsertTimeAllocationInput, ctx: { userId: string; orgId: string }): Promise<ActionResult<{ durationSecs: number }>>`
  - `logTimeAllocationHandler(getClient, actorId, args): Promise<ToolResult>`
  - `registerLogTimeAllocationTool(server, getClient, actorId): void`

The core must live in a new module: `src/lib/time/actions.ts` is `"use server"`, where every export becomes a public server-action endpoint.

- [ ] **Step 1: Write the failing core test**

Create `src/lib/time/allocation-core.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { upsertTimeAllocationCore } from "./allocation-core";

function fakeClient(error: { message: string } | null = null) {
  const upsert = vi.fn(async () => ({ error }));
  return { client: { from: () => ({ upsert }) }, upsert };
}

describe("upsertTimeAllocationCore", () => {
  it("upserts on the item key when an itemId is given", async () => {
    const { client, upsert } = fakeClient();
    const res = await upsertTimeAllocationCore(
      client as never,
      {
        workDate: "2026-01-01",
        itemId: "i1",
        boardId: "b1",
        durationSecs: 3600,
      },
      { userId: "u1", orgId: "o1" },
    );

    expect(res).toEqual({ ok: true, data: { durationSecs: 3600 } });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "o1",
        user_id: "u1",
        work_date: "2026-01-01",
        item_id: "i1",
        board_id: "b1",
        category: null,
        duration_secs: 3600,
      }),
      { onConflict: "user_id,work_date,item_id" },
    );
  });

  it("upserts on the category key when no itemId is given", async () => {
    const { client, upsert } = fakeClient();
    await upsertTimeAllocationCore(
      client as never,
      { workDate: "2026-01-01", category: "Admin", durationSecs: 900 },
      { userId: "u1", orgId: "o1" },
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        item_id: null,
        board_id: null,
        category: "Admin",
      }),
      { onConflict: "user_id,work_date,category" },
    );
  });

  it("returns a failure result on a DB error", async () => {
    const { client } = fakeClient({ message: "denied" });
    const res = await upsertTimeAllocationCore(
      client as never,
      { workDate: "2026-01-01", category: "Admin", durationSecs: 900 },
      { userId: "u1", orgId: "o1" },
    );
    expect(res).toEqual({ ok: false, error: "denied" });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/lib/time/allocation-core.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the core**

Create `src/lib/time/allocation-core.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";

/** The validated shape both callers pass — the output of
 *  `upsertTimeAllocationSchema` in `src/lib/validations/time.ts`. */
export type UpsertTimeAllocationInput = {
  workDate: string;
  itemId?: string | null;
  boardId?: string | null;
  category?: string | null;
  durationSecs: number;
  note?: string | null;
};

/**
 * Upsert one manual allocation cell (self-only). Client-injected so the `/time`
 * Server Action and the MCP tool share ONE implementation — the `upsertCellCore`
 * precedent (gotcha-60: the MCP write path silently diverging is what this
 * shape exists to prevent).
 *
 * `userId` is passed in, never read from `supabase.auth`: the RSC path already
 * knows it, and an auth lookup on a bridged client costs a GoTrue round-trip
 * per write. RLS still enforces `user_id = auth.uid()`, so a mismatched id
 * fails closed.
 *
 * The unique partial indexes drive the upsert: exactly one of itemId/category
 * is set, and that choice selects the conflict target.
 */
export async function upsertTimeAllocationCore(
  supabase: SupabaseClient<Database>,
  input: UpsertTimeAllocationInput,
  ctx: { userId: string; orgId: string },
): Promise<ActionResult<{ durationSecs: number }>> {
  const onConflict = input.itemId
    ? "user_id,work_date,item_id"
    : "user_id,work_date,category";

  const { error } = await supabase.from("time_allocations").upsert(
    {
      org_id: ctx.orgId,
      user_id: ctx.userId,
      work_date: input.workDate,
      item_id: input.itemId ?? null,
      board_id: input.itemId ? (input.boardId ?? null) : null,
      category: input.category ?? null,
      duration_secs: input.durationSecs,
      note: input.note ?? null,
    },
    { onConflict },
  );
  if (error) return fail(error.message);
  return { ok: true, data: { durationSecs: input.durationSecs } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/time/allocation-core.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Reduce the Server Action to a wrapper**

In `src/lib/time/actions.ts`, replace the body of `upsertTimeAllocation` (lines 21–62) after the Zod parse and org lookup:

```ts
export async function upsertTimeAllocation(
  input: z.input<typeof upsertTimeAllocationSchema>,
): Promise<ActionResult<{ durationSecs: number }>> {
  const parsed = upsertTimeAllocationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const orgId = await getActiveOrgId();
  if (!orgId) return fail("No organization.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const res = await upsertTimeAllocationCore(supabase, parsed.data, {
    userId: user.id,
    orgId,
  });
  if (!res.ok) return res;

  // NO revalidatePath("/time"): the card reconciles the written seconds into a
  // durable local overlay and coalesces one trailing router.refresh() per edit
  // burst. /workload is server-derived and has no such overlay, so keep it.
  revalidatePath("/workload");
  return res;
}
```

Add the import: `import { upsertTimeAllocationCore } from "@/lib/time/allocation-core";`

Revalidation stays in the action — an MCP call has no Next.js cache to revalidate.

- [ ] **Step 6: Run the existing time-action tests to prove nothing changed**

Run: `pnpm vitest run src/lib/time`
Expected: PASS — existing behaviour preserved.

- [ ] **Step 7: Write the failing tool test**

Create `src/lib/mcp/tools/log-time-allocation.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { logTimeAllocationHandler } from "./log-time-allocation";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async (_c: unknown, requested?: string) =>
    requested === "o-foreign"
      ? { error: "You are not a member of organization o-foreign." }
      : { org: { id: "o1", name: "Acme", timezone: "UTC" } },
  ),
}));

const core = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, data: { durationSecs: 7200 } })),
);
vi.mock("@/lib/time/allocation-core", () => ({
  upsertTimeAllocationCore: core,
}));

describe("logTimeAllocationHandler", () => {
  it("writes an item allocation as the connected user", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await logTimeAllocationHandler(getClient, "u1", {
      date: "2026-01-05",
      itemId: "i1",
      secs: 7200,
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workDate: "2026-01-05",
        itemId: "i1",
        durationSecs: 7200,
      }),
      { userId: "u1", orgId: "o1" },
    );
    expect(JSON.parse(result.content[0].text)).toEqual({
      date: "2026-01-05",
      secs: 7200,
    });
  });

  it("rejects a call with neither itemId nor category", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await logTimeAllocationHandler(getClient, "u1", {
      date: "2026-01-05",
      secs: 7200,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("itemId");
    expect(getClient).not.toHaveBeenCalled();
  });

  it("rejects a call with BOTH itemId and category", async () => {
    const result = await logTimeAllocationHandler(
      async () => ({}) as never,
      "u1",
      {
        date: "2026-01-05",
        itemId: "i1",
        category: "Admin",
        secs: 7200,
      },
    );
    expect(result.isError).toBe(true);
  });

  it("surfaces a foreign orgId as an error", async () => {
    const result = await logTimeAllocationHandler(
      async () => ({}) as never,
      "u1",
      {
        orgId: "o-foreign",
        date: "2026-01-05",
        category: "Admin",
        secs: 900,
      },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("o-foreign");
  });
});
```

- [ ] **Step 8: Run it to make sure it fails**

Run: `pnpm vitest run src/lib/mcp/tools/log-time-allocation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 9: Implement the tool**

Create `src/lib/mcp/tools/log-time-allocation.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { upsertTimeAllocationCore } from "@/lib/time/allocation-core";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import type { GetClient, ToolResult } from "./shared";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use `YYYY-MM-DD`.");

/** Max seconds in one cell — 24h. Guards a mis-parsed "2" meaning 2 hours. */
export const MAX_ALLOCATION_SECS = 86_400;

export const logTimeAllocationInput = {
  orgId: z.string().uuid().optional(),
  date: isoDate,
  itemId: z.string().uuid().optional(),
  category: z.string().trim().min(1).max(100).optional(),
  secs: z.number().int().min(0).max(MAX_ALLOCATION_SECS),
  note: z.string().trim().max(500).optional(),
};

type Args = {
  orgId?: string;
  date: string;
  itemId?: string;
  category?: string;
  secs: number;
  note?: string;
};

export async function logTimeAllocationHandler(
  getClient: GetClient,
  actorId: string,
  args: Args,
): Promise<ToolResult> {
  // Exactly one of itemId/category: the choice selects the upsert conflict
  // target (the two unique partial indexes on time_allocations). Checked
  // BEFORE getClient() so a malformed call costs no rate-limit budget.
  const hasItem = !!args.itemId;
  const hasCategory = !!args.category;
  if (hasItem === hasCategory)
    return {
      content: [
        {
          type: "text",
          text: "Provide exactly one of `itemId` or `category`.",
        },
      ],
      isError: true,
    };

  const supabase = await getClient();
  const scope = await resolveOrgForTool(supabase, args.orgId);
  if ("error" in scope)
    return { content: [{ type: "text", text: scope.error }], isError: true };

  const res = await upsertTimeAllocationCore(
    supabase,
    {
      workDate: args.date,
      itemId: args.itemId ?? null,
      category: args.category ?? null,
      durationSecs: args.secs,
      note: args.note ?? null,
    },
    { userId: actorId, orgId: scope.org.id },
  );
  if (!res.ok)
    return { content: [{ type: "text", text: res.error }], isError: true };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ date: args.date, secs: args.secs }),
      },
    ],
  };
}

export function registerLogTimeAllocationTool(
  server: McpServer,
  getClient: GetClient,
  actorId: string,
): void {
  server.registerTool(
    "log_time_allocation",
    {
      title: "Log time",
      description:
        "Record manually logged time for the connected user on one day. Provide exactly one of `itemId` (get ids from query/search tools) or `category` (free text). This UPSERTS: calling it again for the same day and target replaces the value rather than adding to it. Writes only the caller's own time.",
      inputSchema: logTimeAllocationInput,
    },
    async (args) => logTimeAllocationHandler(getClient, actorId, args as Args),
  );
}
```

`boardId` is deliberately omitted from the tool input — an agent has no reason to supply it, and the column is nullable.

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/mcp/tools/log-time-allocation.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 11: Register the tool**

In `src/lib/mcp/tools/register.ts`:

```ts
import { registerLogTimeAllocationTool } from "./log-time-allocation";
// …
registerLogTimeAllocationTool(server, getClient, actorId);
```

- [ ] **Step 12: Verify nothing regressed**

Run: `pnpm typecheck && pnpm vitest run src/lib/mcp src/lib/time`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/lib/time/allocation-core.ts src/lib/time/allocation-core.test.ts \
        src/lib/time/actions.ts \
        src/lib/mcp/tools/log-time-allocation.ts src/lib/mcp/tools/log-time-allocation.test.ts \
        src/lib/mcp/tools/register.ts
git commit -m "feat(mcp): add log_time_allocation write tool"
```

---

## Task 5: Goals — `list_goals` + `get_goal`

**Files:**

- Modify: `src/lib/goals/queries.ts:99-122`
- Create: `src/lib/mcp/tools/list-goals.ts`
- Create: `src/lib/mcp/tools/list-goals.test.ts`
- Create: `src/lib/mcp/tools/get-goal.ts`
- Create: `src/lib/mcp/tools/get-goal.test.ts`
- Modify: `src/lib/mcp/tools/register.ts`

**Interfaces:**

- Consumes: `resolveOrgForTool`, `listOrgMemberProfiles` (Task 1); `buildGoalTree`, `serverToday` from `src/lib/goals/progress.ts`; `GoalNode`, `RowOwner` from `src/lib/goals/types.ts`.
- Produces:
  - `getGoalsTreeCore(supabase, ctx: { owners: Map<string, RowOwner>; nowMs: number }): Promise<GoalNode[]>`
  - `flattenGoals(nodes: GoalNode[], depth?: number): FlatGoal[]` where `FlatGoal = { id: string; name: string; parentId: string | null; depth: number; percent: number | null; status: string; ownerName: string | null; dueDate: string | null }`
  - `listGoalsHandler`, `getGoalHandler`, and their `register…Tool` functions

The core takes `owners` as a parameter rather than calling `getGoalOwners()` internally, because `getGoalOwners` reads the active-org cookie AND routes through the service-client `listOrgMembersCached`. The RSC wrapper keeps calling `getGoalOwners()`; MCP supplies `listOrgMemberProfiles` over the bridged client. One implementation, two entry points, no service client on the MCP path.

- [ ] **Step 1: Extract the core**

In `src/lib/goals/queries.ts`, replace `getGoalsTree` (lines 99–122). Add the type imports at the top:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
```

Then:

```ts
/**
 * Client-injected core: goals SELECT + goals_rollup() RPC → assembled tree.
 * `owners` is a PARAMETER because the RSC path resolves it from the active-org
 * cookie via the service-client cache, while MCP resolves it over the bridged
 * client (spec §3.2: no service client on the MCP path).
 */
export async function getGoalsTreeCore(
  supabase: SupabaseClient<Database>,
  ctx: { owners: Map<string, RowOwner>; nowMs: number },
): Promise<GoalNode[]> {
  const [{ data: goals }, { data: aggs }] = await Promise.all([
    supabase
      .from("goals")
      .select(
        "id, parent_goal_id, name, description, owner_id, workspace_id, progress_mode, status, start_value, current_value, target_value, unit, percent, start_date, due_date, position",
      )
      .order("position")
      .limit(GOALS_LIMIT),
    supabase.rpc("goals_rollup"),
  ]);

  const rows: GoalRow[] = (goals ?? []).map((g) => toGoalRow(g as GoalDbRow));
  const boardAggs: BoardAgg[] = (aggs ?? []).map((a) => ({
    goalId: a.goal_id,
    boardId: a.board_id,
    total: Number(a.total_items),
    done: Number(a.done_items),
  }));
  return buildGoalTree(rows, boardAggs, ctx.owners, serverToday(ctx.nowMs));
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export async function getGoalsTree(): Promise<GoalNode[]> {
  const nowMs = Date.now();
  const [supabase, owners] = await Promise.all([
    createClient(),
    getGoalOwners(),
  ]);
  return getGoalsTreeCore(supabase, { owners, nowMs });
}
```

- [ ] **Step 2: Run the existing goals tests to prove the extraction changed nothing**

Run: `pnpm vitest run src/lib/goals`
Expected: PASS.

- [ ] **Step 3: Write the failing tool tests**

Create `src/lib/mcp/tools/list-goals.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { listGoalsHandler } from "./list-goals";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async () => ({
    org: { id: "o1", name: "Acme", timezone: "UTC" },
  })),
  listOrgMemberProfiles: vi.fn(async () => [
    { userId: "u1", fullName: "Ada", avatarUrl: null },
  ]),
}));

const tree = vi.hoisted(() => vi.fn());
vi.mock("@/lib/goals/queries", () => ({
  GOALS_LIMIT: 1000,
  getGoalsTreeCore: tree,
}));

describe("listGoalsHandler", () => {
  it("flattens the tree with depth and drops UI-only fields", async () => {
    tree.mockResolvedValue([
      {
        id: "g1",
        name: "Grow revenue",
        parentGoalId: null,
        status: "on_track",
        percent: 40,
        dueDate: "2026-12-31",
        owner: { userId: "u1", fullName: "Ada", avatarUrl: "http://x/y.png" },
        children: [
          {
            id: "g2",
            name: "Land 10 logos",
            parentGoalId: "g1",
            status: "at_risk",
            percent: 10,
            dueDate: null,
            owner: null,
            children: [],
          },
        ],
      },
    ]);

    const getClient = vi.fn(async () => ({}) as never);
    const result = await listGoalsHandler(getClient, {});

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        id: "g1",
        name: "Grow revenue",
        parentId: null,
        depth: 0,
        percent: 40,
        status: "on_track",
        ownerName: "Ada",
        dueDate: "2026-12-31",
      },
      {
        id: "g2",
        name: "Land 10 logos",
        parentId: "g1",
        depth: 1,
        percent: 10,
        status: "at_risk",
        ownerName: null,
        dueDate: null,
      },
    ]);
  });
});
```

Create `src/lib/mcp/tools/get-goal.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getGoalHandler } from "./get-goal";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async () => ({
    org: { id: "o1", name: "Acme", timezone: "UTC" },
  })),
  listOrgMemberProfiles: vi.fn(async () => []),
}));

const tree = vi.hoisted(() => vi.fn());
vi.mock("@/lib/goals/queries", () => ({
  GOALS_LIMIT: 1000,
  getGoalsTreeCore: tree,
}));

const NODE = {
  id: "g1",
  name: "Grow revenue",
  parentGoalId: null,
  status: "on_track",
  percent: 40,
  dueDate: "2026-12-31",
  owner: null,
  children: [],
};

describe("getGoalHandler", () => {
  it("returns the requested goal with its direct children", async () => {
    tree.mockResolvedValue([NODE]);
    const result = await getGoalHandler(async () => ({}) as never, {
      goalId: "g1",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("g1");
    expect(parsed.children).toEqual([]);
  });

  it("errors when the goal is not visible", async () => {
    tree.mockResolvedValue([NODE]);
    const result = await getGoalHandler(async () => ({}) as never, {
      goalId: "missing",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });
});
```

- [ ] **Step 4: Run them to make sure they fail**

Run: `pnpm vitest run src/lib/mcp/tools/list-goals.test.ts src/lib/mcp/tools/get-goal.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 5: Implement `list_goals`**

Create `src/lib/mcp/tools/list-goals.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getGoalsTreeCore, GOALS_LIMIT } from "@/lib/goals/queries";
import { resolveOrgForTool, listOrgMemberProfiles } from "@/lib/mcp/org-scope";
import type { GoalNode, RowOwner } from "@/lib/goals/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { GetClient, ToolResult } from "./shared";

export type FlatGoal = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  percent: number | null;
  status: string;
  ownerName: string | null;
  dueDate: string | null;
};

/** Depth-first flatten. A tree is hard for a model to scan; `depth` preserves
 *  the hierarchy without the nesting. */
export function flattenGoals(nodes: GoalNode[], depth = 0): FlatGoal[] {
  const out: FlatGoal[] = [];
  for (const n of nodes) {
    out.push({
      id: n.id,
      name: n.name,
      parentId: n.parentGoalId,
      depth,
      percent: n.percent,
      status: n.status,
      ownerName: n.owner?.fullName ?? null,
      dueDate: n.dueDate,
    });
    out.push(...flattenGoals(n.children, depth + 1));
  }
  return out;
}

/** Shared by list_goals and get_goal: resolve org, build the owner map over the
 *  BRIDGED client, then assemble the tree. */
export async function loadGoalTree(
  supabase: SupabaseClient<Database>,
  requestedOrgId?: string,
): Promise<{ nodes: GoalNode[] } | { error: string }> {
  const scope = await resolveOrgForTool(supabase, requestedOrgId);
  if ("error" in scope) return { error: scope.error };

  const members = await listOrgMemberProfiles(supabase, scope.org.id);
  const owners = new Map<string, RowOwner>(
    members.map((m) => [
      m.userId,
      { userId: m.userId, fullName: m.fullName, avatarUrl: m.avatarUrl },
    ]),
  );
  return {
    nodes: await getGoalsTreeCore(supabase, { owners, nowMs: Date.now() }),
  };
}

export async function listGoalsHandler(
  getClient: GetClient,
  args: { orgId?: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  const res = await loadGoalTree(supabase, args.orgId);
  if ("error" in res)
    return { content: [{ type: "text", text: res.error }], isError: true };
  return {
    content: [{ type: "text", text: JSON.stringify(flattenGoals(res.nodes)) }],
  };
}

export function registerListGoalsTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_goals",
    {
      title: "List goals",
      description: `Every goal visible to the connected user, flattened depth-first with a \`depth\` field preserving the hierarchy. Returns at most ${GOALS_LIMIT} goals.`,
      inputSchema: { orgId: z.string().uuid().optional() },
    },
    async (args) => listGoalsHandler(getClient, args),
  );
}
```

- [ ] **Step 6: Implement `get_goal`**

Create `src/lib/mcp/tools/get-goal.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadGoalTree } from "./list-goals";
import type { GoalNode } from "@/lib/goals/types";
import type { GetClient, ToolResult } from "./shared";

function findGoal(nodes: GoalNode[], goalId: string): GoalNode | null {
  for (const n of nodes) {
    if (n.id === goalId) return n;
    const hit = findGoal(n.children, goalId);
    if (hit) return hit;
  }
  return null;
}

export async function getGoalHandler(
  getClient: GetClient,
  args: { goalId: string; orgId?: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  const res = await loadGoalTree(supabase, args.orgId);
  if ("error" in res)
    return { content: [{ type: "text", text: res.error }], isError: true };

  const goal = findGoal(res.nodes, args.goalId);
  if (!goal)
    return {
      content: [{ type: "text", text: `Goal ${args.goalId} not found.` }],
      isError: true,
    };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          id: goal.id,
          name: goal.name,
          description: goal.description,
          parentId: goal.parentGoalId,
          status: goal.status,
          percent: goal.percent,
          progressMode: goal.progressMode,
          startValue: goal.startValue,
          currentValue: goal.currentValue,
          targetValue: goal.targetValue,
          unit: goal.unit,
          startDate: goal.startDate,
          dueDate: goal.dueDate,
          ownerName: goal.owner?.fullName ?? null,
          children: goal.children.map((c) => ({
            id: c.id,
            name: c.name,
            percent: c.percent,
            status: c.status,
          })),
        }),
      },
    ],
  };
}

export function registerGetGoalTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_goal",
    {
      title: "Get goal",
      description:
        "One goal's full detail — progress mode, current/target values, dates, owner — plus a summary of its direct children. Get ids from list_goals.",
      inputSchema: {
        goalId: z.string().uuid(),
        orgId: z.string().uuid().optional(),
      },
    },
    async (args) => getGoalHandler(getClient, args),
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/mcp/tools/list-goals.test.ts src/lib/mcp/tools/get-goal.test.ts`
Expected: PASS (3 tests).

If `GoalNode` lacks any field referenced above (`description`, `progressMode`, `startValue`, `currentValue`, `targetValue`, `unit`, `startDate`), read `src/lib/goals/types.ts` and drop the missing ones from the projection — do not add them to the type.

- [ ] **Step 8: Register both tools**

In `src/lib/mcp/tools/register.ts`:

```ts
import { registerListGoalsTool } from "./list-goals";
import { registerGetGoalTool } from "./get-goal";
// …
registerListGoalsTool(server, getClient);
registerGetGoalTool(server, getClient);
```

- [ ] **Step 9: Verify nothing regressed**

Run: `pnpm typecheck && pnpm vitest run src/lib/mcp src/lib/goals`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/goals/queries.ts \
        src/lib/mcp/tools/list-goals.ts src/lib/mcp/tools/list-goals.test.ts \
        src/lib/mcp/tools/get-goal.ts src/lib/mcp/tools/get-goal.test.ts \
        src/lib/mcp/tools/register.ts
git commit -m "feat(mcp): add goals read tools"
```

---

## Task 6: Portfolios — `list_portfolios` + `get_portfolio`

**Files:**

- Modify: `src/lib/portfolios/queries.ts:17-30, 75-127`
- Create: `src/lib/mcp/tools/list-portfolios.ts`
- Create: `src/lib/mcp/tools/list-portfolios.test.ts`
- Create: `src/lib/mcp/tools/get-portfolio.ts`
- Create: `src/lib/mcp/tools/get-portfolio.test.ts`
- Modify: `src/lib/mcp/tools/register.ts`

**Interfaces:**

- Consumes: `listOrgMemberProfiles` (Task 1); `mergeRows`, `serverToday` from `src/lib/portfolios/rollup.ts`; `PortfolioRow`, `RowOwner` from `src/lib/portfolios/types.ts`.
- Produces:
  - `listPortfoliosCore(supabase, limit?): Promise<{ id: string; name: string }[]>`
  - `getPortfolioRowsCore(supabase, portfolioId, ctx: { owners: Map<string, RowOwner>; todayIso: string }): Promise<PortfolioRowsResult | null>`
  - `listPortfoliosHandler`, `getPortfolioHandler`, and their `register…Tool` functions

- [ ] **Step 1: Extract both cores**

In `src/lib/portfolios/queries.ts`, add the type imports and replace the two functions.

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
```

```ts
/** Client-injected core. */
export async function listPortfoliosCore(
  supabase: SupabaseClient<Database>,
  limit: number = PORTFOLIO_LIMIT,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("portfolios")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to load portfolios: ${error.message}`);
  return data ?? [];
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export async function listPortfolios(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient();
  return listPortfoliosCore(supabase);
}
```

Then the rows core. `owners` and `todayIso` become parameters for the same reason as goals — `listOrgMembersCached` is a service-client call MCP must not make.

```ts
/** Client-injected core: portfolio + placements + rollup, merged with owners. */
export async function getPortfolioRowsCore(
  supabase: SupabaseClient<Database>,
  portfolioId: string,
  ctx: { owners: Map<string, RowOwner>; todayIso: string },
): Promise<PortfolioRowsResult | null> {
  const [portfolioRes, placementsRes, rollupRes] = await Promise.all([
    supabase.from("portfolios").select("*").eq("id", portfolioId).maybeSingle(),
    supabase
      .from("portfolio_boards")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .order("position", { ascending: true }),
    supabase.rpc("portfolio_rollup", {
      p_portfolio_id: portfolioId,
      p_today: ctx.todayIso,
    }),
  ]);

  if (portfolioRes.error)
    throw new Error(`Failed to load portfolio: ${portfolioRes.error.message}`);
  if (placementsRes.error)
    throw new Error(
      `Failed to load portfolio placements: ${placementsRes.error.message}`,
    );
  if (rollupRes.error)
    throw new Error(
      `Failed to load portfolio rollup: ${rollupRes.error.message}`,
    );
  if (!portfolioRes.data) return null;

  const placements = (placementsRes.data ?? []).map(toPlacement);
  const rollups: RollupRow[] = (rollupRes.data ?? []).map((r) => ({
    boardId: r.board_id,
    name: r.name,
    totalItems: Number(r.total_items),
    doneItems: Number(r.done_items),
    timelineStart: r.timeline_start,
    timelineEnd: r.timeline_end,
    overdueItems: Number(r.overdue_items),
  }));

  return {
    portfolio: portfolioRes.data,
    rows: mergeRows(placements, rollups, ctx.owners, ctx.todayIso),
  };
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export async function getPortfolioRows(
  portfolioId: string,
): Promise<PortfolioRowsResult | null> {
  const supabase = await createClient();
  const todayIso = serverToday(Date.now());

  // The owner map needs the portfolio's org, so the head row is read first here
  // (the core re-reads it inside its Promise.all — one extra bounded PK read on
  // the RSC path, in exchange for the core owning ALL of its own queries).
  const head = await getPortfolio(portfolioId);
  if (!head) return null;

  const members = await listOrgMembersCached(head.org_id);
  const owners = new Map<string, RowOwner>(
    members.map((m) => [
      m.userId,
      { userId: m.userId, fullName: m.fullName, avatarUrl: m.avatarUrl },
    ]),
  );
  return getPortfolioRowsCore(supabase, portfolioId, { owners, todayIso });
}
```

- [ ] **Step 2: Run the existing portfolio tests to prove the extraction changed nothing**

Run: `pnpm vitest run src/lib/portfolios`
Expected: PASS.

- [ ] **Step 3: Write the failing tool tests**

Create `src/lib/mcp/tools/list-portfolios.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { listPortfoliosHandler } from "./list-portfolios";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portfolios/queries", () => ({
  PORTFOLIO_LIMIT: 200,
  listPortfoliosCore: core,
}));

describe("listPortfoliosHandler", () => {
  it("returns portfolios with a board count", async () => {
    core.mockResolvedValue([{ id: "p1", name: "Q1 delivery" }]);
    const client = {
      from: () => ({
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [{ portfolio_id: "p1" }, { portfolio_id: "p1" }],
              error: null,
            }),
        }),
      }),
    };
    const getClient = vi.fn(async () => client as never);

    const result = await listPortfoliosHandler(getClient);

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: "p1", name: "Q1 delivery", boardCount: 2 },
    ]);
  });

  it("returns an empty array when there are no portfolios", async () => {
    core.mockResolvedValue([]);
    const result = await listPortfoliosHandler(async () => ({}) as never);
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });
});
```

Create `src/lib/mcp/tools/get-portfolio.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getPortfolioHandler } from "./get-portfolio";

vi.mock("@/lib/mcp/org-scope", () => ({
  listOrgMemberProfiles: vi.fn(async () => [
    { userId: "u1", fullName: "Ada", avatarUrl: null },
  ]),
}));

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portfolios/queries", () => ({ getPortfolioRowsCore: core }));

describe("getPortfolioHandler", () => {
  it("projects rollup rows without UI placement fields", async () => {
    core.mockResolvedValue({
      portfolio: { id: "p1", name: "Q1 delivery", org_id: "o1" },
      rows: [
        {
          boardId: "b1",
          name: "Roadmap",
          totalItems: 10,
          doneItems: 4,
          overdueItems: 1,
          health: "at_risk",
          owner: { userId: "u1", fullName: "Ada", avatarUrl: null },
        },
      ],
    });

    const getClient = vi.fn(async () => ({}) as never);
    const result = await getPortfolioHandler(getClient, { portfolioId: "p1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("Q1 delivery");
    expect(parsed.boards[0]).toEqual({
      boardId: "b1",
      boardName: "Roadmap",
      totalItems: 10,
      doneItems: 4,
      overdueItems: 1,
      health: "at_risk",
      ownerName: "Ada",
    });
  });

  it("errors when the portfolio is not visible", async () => {
    core.mockResolvedValue(null);
    const result = await getPortfolioHandler(async () => ({}) as never, {
      portfolioId: "missing",
    });
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 4: Run them to make sure they fail**

Run: `pnpm vitest run src/lib/mcp/tools/list-portfolios.test.ts src/lib/mcp/tools/get-portfolio.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 5: Implement `list_portfolios`**

Create `src/lib/mcp/tools/list-portfolios.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listPortfoliosCore, PORTFOLIO_LIMIT } from "@/lib/portfolios/queries";
import type { GetClient, ToolResult } from "./shared";

export async function listPortfoliosHandler(
  getClient: GetClient,
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const portfolios = await listPortfoliosCore(supabase);
    if (portfolios.length === 0)
      return { content: [{ type: "text", text: "[]" }] };

    // ONE grouped read for the counts — never one query per portfolio.
    const { data, error } = await supabase
      .from("portfolio_boards")
      .select("portfolio_id")
      .in(
        "portfolio_id",
        portfolios.map((p) => p.id),
      );
    if (error)
      throw new Error(`Failed to load portfolio boards: ${error.message}`);

    const counts = new Map<string, number>();
    for (const r of data ?? [])
      counts.set(r.portfolio_id, (counts.get(r.portfolio_id) ?? 0) + 1);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            portfolios.map((p) => ({
              ...p,
              boardCount: counts.get(p.id) ?? 0,
            })),
          ),
        },
      ],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerListPortfoliosTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_portfolios",
    {
      title: "List portfolios",
      description: `Portfolios visible to the connected user, with how many boards each contains. Returns at most ${PORTFOLIO_LIMIT}.`,
      inputSchema: {},
    },
    async () => listPortfoliosHandler(getClient),
  );
}
```

- [ ] **Step 6: Implement `get_portfolio`**

Create `src/lib/mcp/tools/get-portfolio.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPortfolioRowsCore } from "@/lib/portfolios/queries";
import { serverToday } from "@/lib/portfolios/rollup";
import { listOrgMemberProfiles } from "@/lib/mcp/org-scope";
import type { RowOwner } from "@/lib/portfolios/types";
import type { GetClient, ToolResult } from "./shared";

export async function getPortfolioHandler(
  getClient: GetClient,
  args: { portfolioId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const todayIso = serverToday(Date.now());

    // First pass with an empty owner map to learn the portfolio's org (RLS has
    // already vetted visibility), then a second pass with real owners. The org
    // id comes off a row read through the BRIDGED client, which is what makes
    // the member read entitled.
    const head = await getPortfolioRowsCore(supabase, args.portfolioId, {
      owners: new Map(),
      todayIso,
    });
    if (!head)
      return {
        content: [
          { type: "text", text: `Portfolio ${args.portfolioId} not found.` },
        ],
        isError: true,
      };

    const members = await listOrgMemberProfiles(
      supabase,
      head.portfolio.org_id,
    );
    const owners = new Map<string, RowOwner>(
      members.map((m) => [
        m.userId,
        { userId: m.userId, fullName: m.fullName, avatarUrl: m.avatarUrl },
      ]),
    );
    const full = await getPortfolioRowsCore(supabase, args.portfolioId, {
      owners,
      todayIso,
    });
    const result = full ?? head;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            id: result.portfolio.id,
            name: result.portfolio.name,
            boards: result.rows.map((r) => ({
              boardId: r.boardId,
              boardName: r.name,
              totalItems: r.totalItems,
              doneItems: r.doneItems,
              overdueItems: r.overdueItems,
              health: r.health,
              ownerName: r.owner?.fullName ?? null,
            })),
          }),
        },
      ],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerGetPortfolioTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_portfolio",
    {
      title: "Get portfolio",
      description:
        "One portfolio's board rollup — item totals, done counts, overdue counts, health and owner per board. Get ids from list_portfolios.",
      inputSchema: { portfolioId: z.string().uuid() },
    },
    async (args) => getPortfolioHandler(getClient, args),
  );
}
```

If `PortfolioRow` names the health field differently, read `src/lib/portfolios/types.ts` and match it — do not add a field to the type.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/mcp/tools/list-portfolios.test.ts src/lib/mcp/tools/get-portfolio.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Register both tools**

```ts
import { registerListPortfoliosTool } from "./list-portfolios";
import { registerGetPortfolioTool } from "./get-portfolio";
// …
registerListPortfoliosTool(server, getClient);
registerGetPortfolioTool(server, getClient);
```

- [ ] **Step 9: Verify nothing regressed**

Run: `pnpm typecheck && pnpm vitest run src/lib/mcp src/lib/portfolios`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/portfolios/queries.ts \
        src/lib/mcp/tools/list-portfolios.ts src/lib/mcp/tools/list-portfolios.test.ts \
        src/lib/mcp/tools/get-portfolio.ts src/lib/mcp/tools/get-portfolio.test.ts \
        src/lib/mcp/tools/register.ts
git commit -m "feat(mcp): add portfolio read tools"
```

---

## Task 7: Dashboards — `list_dashboards`, `get_dashboard`, `get_widget_data`

**Files:**

- Modify: `src/lib/dashboards/queries.ts:16-54`
- Create: `src/lib/dashboards/widget-slot-core.ts`
- Modify: `src/lib/dashboards/actions.ts:434-462` (move `resolveWidgetSlot` out)
- Create: `src/lib/mcp/tools/list-dashboards.ts` + `.test.ts`
- Create: `src/lib/mcp/tools/get-dashboard.ts` + `.test.ts`
- Create: `src/lib/mcp/tools/get-widget-data.ts` + `.test.ts`
- Modify: `src/lib/mcp/tools/register.ts`

**Interfaces:**

- Consumes: `resolveOrgForTool` (Task 1); `DashboardPayload`, `DashboardWidget` from `src/lib/dashboards/queries.ts`.
- Produces:
  - `getDashboardPayloadCore(supabase, dashboardId): Promise<DashboardPayload | null>`
  - `listDashboardsCore(supabase, orgId, limit?): Promise<{ id: string; name: string }[]>`
  - `resolveWidgetSlot(supabase, widgetId, widget): Promise<WidgetDataResult>` (moved, now exported)
  - `listDashboardsHandler`, `getDashboardHandler`, `getWidgetDataHandler`, and their `register…Tool` functions

`resolveWidgetSlot` already takes `supabase` as its first parameter — this is a module move, not a rewrite. It must leave `actions.ts` because that file is `"use server"`.

- [ ] **Step 1: Extract the dashboard payload core**

In `src/lib/dashboards/queries.ts`, add the type imports and split the cached const:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
```

```ts
/** Client-injected core. Uncached — `cache()` stays on the RSC wrapper so the
 *  tool path never depends on a React request scope existing. */
export async function getDashboardPayloadCore(
  supabase: SupabaseClient<Database>,
  dashboardId: string,
): Promise<DashboardPayload | null> {
  const [dashRes, widgetsRes] = await Promise.all([
    supabase.from("dashboards").select("*").eq("id", dashboardId).maybeSingle(),
    supabase
      .from("dashboard_widgets")
      .select("*")
      .eq("dashboard_id", dashboardId)
      .order("position", { ascending: true }),
  ]);

  const { data: dashboard, error } = dashRes;
  if (error) throw new Error(`Failed to load dashboard: ${error.message}`);
  if (!dashboard) return null;

  const { data: widgets, error: widgetsErr } = widgetsRes;
  if (widgetsErr)
    throw new Error(`Failed to load dashboard widgets: ${widgetsErr.message}`);

  return { dashboard, widgets: widgets ?? [] };
}

/** A dashboard + its widgets. Returns null when not visible (RLS) or absent. */
export const getDashboardPayload = cache(
  async (dashboardId: string): Promise<DashboardPayload | null> => {
    const supabase = await createClient();
    return getDashboardPayloadCore(supabase, dashboardId);
  },
);

/** Hot-path cap for the MCP dashboard list. */
export const DASHBOARD_LIST_LIMIT = 100;

/** Client-injected list. Deliberately not `listDashboardsCached` — that runs on
 *  the service client, and MCP stays off it entirely (spec §3.2). */
export async function listDashboardsCore(
  supabase: SupabaseClient<Database>,
  orgId: string,
  limit: number = DASHBOARD_LIST_LIMIT,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("dashboards")
    .select("id, name")
    .eq("org_id", orgId)
    .order("name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to load dashboards: ${error.message}`);
  return data ?? [];
}
```

- [ ] **Step 2: Move `resolveWidgetSlot` into its own module**

Create `src/lib/dashboards/widget-slot-core.ts` containing the current `resolveWidgetSlot` body from `src/lib/dashboards/actions.ts:434-462`, exported, with its imports (`resolveSeries`, `resolveRows`, `resolveWidgetAggregate`, and the `WidgetAggRow` / `WidgetDataResult` types) moved or re-imported alongside it. Keep the existing doc comment verbatim and add:

```ts
/**
 * Lives here rather than in actions.ts because that module is `"use server"`,
 * where every export becomes a public server-action endpoint. The signature is
 * unchanged — it already took the client as a parameter, which is what makes
 * the MCP path a straight reuse.
 */
```

In `actions.ts`, delete the local definition and import it:

```ts
import { resolveWidgetSlot } from "@/lib/dashboards/widget-slot-core";
```

If `resolveWidgetAggregate` is also local to `actions.ts`, move it into `widget-slot-core.ts` too and re-import it in `actions.ts` — it is called by both.

- [ ] **Step 3: Run the existing dashboards tests to prove the move changed nothing**

Run: `pnpm vitest run src/lib/dashboards`
Expected: PASS. A failure here means the move dropped an import — fix it before continuing.

- [ ] **Step 4: Write the failing tool tests**

Create `src/lib/mcp/tools/list-dashboards.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { listDashboardsHandler } from "./list-dashboards";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async (_c: unknown, requested?: string) =>
    requested === "o-foreign"
      ? { error: "You are not a member of organization o-foreign." }
      : { org: { id: "o1", name: "Acme", timezone: "UTC" } },
  ),
}));

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dashboards/queries", () => ({
  DASHBOARD_LIST_LIMIT: 100,
  listDashboardsCore: core,
}));

describe("listDashboardsHandler", () => {
  it("lists dashboards in the resolved org", async () => {
    core.mockResolvedValue([{ id: "d1", name: "Delivery" }]);
    const getClient = vi.fn(async () => ({}) as never);

    const result = await listDashboardsHandler(getClient, {});

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledWith(expect.anything(), "o1");
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: "d1", name: "Delivery" },
    ]);
  });

  it("surfaces a foreign orgId as an error", async () => {
    const result = await listDashboardsHandler(async () => ({}) as never, {
      orgId: "o-foreign",
    });
    expect(result.isError).toBe(true);
  });
});
```

Create `src/lib/mcp/tools/get-dashboard.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getDashboardHandler } from "./get-dashboard";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dashboards/queries", () => ({ getDashboardPayloadCore: core }));

describe("getDashboardHandler", () => {
  it("returns widget descriptors without layout or palette", async () => {
    core.mockResolvedValue({
      dashboard: { id: "d1", name: "Delivery" },
      widgets: [
        {
          id: "w1",
          kind: "chart",
          title: "Throughput",
          source_board_id: "b1",
          position: 0,
          config: { x: 1, y: 2, w: 4, h: 3, metric: "count" },
        },
      ],
    });

    const getClient = vi.fn(async () => ({}) as never);
    const result = await getDashboardHandler(getClient, { dashboardId: "d1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("Delivery");
    expect(parsed.widgets[0]).toEqual({
      widgetId: "w1",
      title: "Throughput",
      kind: "chart",
      boardId: "b1",
    });
  });

  it("errors when the dashboard is not visible", async () => {
    core.mockResolvedValue(null);
    const result = await getDashboardHandler(async () => ({}) as never, {
      dashboardId: "missing",
    });
    expect(result.isError).toBe(true);
  });
});
```

Create `src/lib/mcp/tools/get-widget-data.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getWidgetDataHandler } from "./get-widget-data";

const slot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dashboards/widget-slot-core", () => ({
  resolveWidgetSlot: slot,
}));

function fakeClient(widget: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: widget, error: null }),
        }),
      }),
    }),
  };
}

describe("getWidgetDataHandler", () => {
  it("resolves the widget slot and returns its payload", async () => {
    slot.mockResolvedValue({
      ok: true,
      shape: "series",
      series: [{ x: "Mon", y: 3 }],
    });
    const client = fakeClient({
      kind: "chart",
      config: {},
      source_board_id: "b1",
      org_id: "o1",
    });
    const getClient = vi.fn(async () => client as never);

    const result = await getWidgetDataHandler(getClient, { widgetId: "w1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual({
      shape: "series",
      series: [{ x: "Mon", y: 3 }],
    });
  });

  it("errors when the widget is not visible", async () => {
    const getClient = vi.fn(async () => fakeClient(null) as never);
    const result = await getWidgetDataHandler(getClient, {
      widgetId: "missing",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("surfaces a slot resolution failure", async () => {
    slot.mockResolvedValue({ ok: false, error: "bad config" });
    const client = fakeClient({
      kind: "chart",
      config: {},
      source_board_id: "b1",
      org_id: "o1",
    });
    const result = await getWidgetDataHandler(async () => client as never, {
      widgetId: "w1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("bad config");
  });
});
```

- [ ] **Step 5: Run them to make sure they fail**

Run: `pnpm vitest run src/lib/mcp/tools/list-dashboards.test.ts src/lib/mcp/tools/get-dashboard.test.ts src/lib/mcp/tools/get-widget-data.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 6: Implement `list_dashboards`**

Create `src/lib/mcp/tools/list-dashboards.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listDashboardsCore,
  DASHBOARD_LIST_LIMIT,
} from "@/lib/dashboards/queries";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import type { GetClient, ToolResult } from "./shared";

export async function listDashboardsHandler(
  getClient: GetClient,
  args: { orgId?: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  const scope = await resolveOrgForTool(supabase, args.orgId);
  if ("error" in scope)
    return { content: [{ type: "text", text: scope.error }], isError: true };

  try {
    const dashboards = await listDashboardsCore(supabase, scope.org.id);
    return { content: [{ type: "text", text: JSON.stringify(dashboards) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerListDashboardsTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_dashboards",
    {
      title: "List dashboards",
      description: `Dashboards visible to the connected user in one organization. Returns at most ${DASHBOARD_LIST_LIMIT}.`,
      inputSchema: { orgId: z.string().uuid().optional() },
    },
    async (args) => listDashboardsHandler(getClient, args),
  );
}
```

- [ ] **Step 7: Implement `get_dashboard`**

Create `src/lib/mcp/tools/get-dashboard.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDashboardPayloadCore } from "@/lib/dashboards/queries";
import type { GetClient, ToolResult } from "./shared";

export async function getDashboardHandler(
  getClient: GetClient,
  args: { dashboardId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const payload = await getDashboardPayloadCore(supabase, args.dashboardId);
    if (!payload)
      return {
        content: [
          { type: "text", text: `Dashboard ${args.dashboardId} not found.` },
        ],
        isError: true,
      };

    // Descriptors only. Resolving each widget's data is a separate, explicit
    // get_widget_data call — listing a dashboard never fires N aggregations.
    // Layout (x/y/w/h) and palette are dropped: canvas geometry, not meaning.
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            id: payload.dashboard.id,
            name: payload.dashboard.name,
            widgets: payload.widgets.map((w) => ({
              widgetId: w.id,
              title: w.title,
              kind: w.kind,
              boardId: w.source_board_id,
            })),
          }),
        },
      ],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerGetDashboardTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_dashboard",
    {
      title: "Get dashboard",
      description:
        "One dashboard's widgets as descriptors (id, title, kind, source board) — no data. Call get_widget_data with a widgetId to resolve one widget's numbers.",
      inputSchema: { dashboardId: z.string().uuid() },
    },
    async (args) => getDashboardHandler(getClient, args),
  );
}
```

- [ ] **Step 8: Implement `get_widget_data`**

Create `src/lib/mcp/tools/get-widget-data.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveWidgetSlot } from "@/lib/dashboards/widget-slot-core";
import type { GetClient, ToolResult } from "./shared";

export async function getWidgetDataHandler(
  getClient: GetClient,
  args: { widgetId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    // Re-read the widget through RLS — a client-supplied id is never trusted
    // for board/org access (the same rule getWidgetsData applies).
    const { data: widget, error } = await supabase
      .from("dashboard_widgets")
      .select("kind, config, source_board_id, org_id")
      .eq("id", args.widgetId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load widget: ${error.message}`);
    if (!widget)
      return {
        content: [{ type: "text", text: `Widget ${args.widgetId} not found.` }],
        isError: true,
      };

    const slot = await resolveWidgetSlot(supabase, args.widgetId, widget);
    if (!slot.ok)
      return { content: [{ type: "text", text: slot.error }], isError: true };

    const { ok: _ok, ...payload } = slot;
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerGetWidgetDataTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_widget_data",
    {
      title: "Get widget data",
      description:
        "Resolve one dashboard widget's data — a chart's series, a list widget's rows, or an aggregate number. Row and series counts are bounded by the widget's own configuration. Get ids from get_dashboard.",
      inputSchema: { widgetId: z.string().uuid() },
    },
    async (args) => getWidgetDataHandler(getClient, args),
  );
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/mcp/tools/list-dashboards.test.ts src/lib/mcp/tools/get-dashboard.test.ts src/lib/mcp/tools/get-widget-data.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 10: Register all three tools**

```ts
import { registerListDashboardsTool } from "./list-dashboards";
import { registerGetDashboardTool } from "./get-dashboard";
import { registerGetWidgetDataTool } from "./get-widget-data";
// …
registerListDashboardsTool(server, getClient);
registerGetDashboardTool(server, getClient);
registerGetWidgetDataTool(server, getClient);
```

- [ ] **Step 11: Verify nothing regressed**

Run: `pnpm typecheck && pnpm vitest run src/lib/mcp src/lib/dashboards`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/lib/dashboards/queries.ts src/lib/dashboards/widget-slot-core.ts \
        src/lib/dashboards/actions.ts \
        src/lib/mcp/tools/list-dashboards.ts src/lib/mcp/tools/list-dashboards.test.ts \
        src/lib/mcp/tools/get-dashboard.ts src/lib/mcp/tools/get-dashboard.test.ts \
        src/lib/mcp/tools/get-widget-data.ts src/lib/mcp/tools/get-widget-data.test.ts \
        src/lib/mcp/tools/register.ts
git commit -m "feat(mcp): add dashboard read tools"
```

---

## Task 8: `get_workload`

**Files:**

- Modify: `src/lib/workload/queries.ts:105-174`
- Create: `src/lib/mcp/tools/get-workload.ts`
- Create: `src/lib/mcp/tools/get-workload.test.ts`
- Modify: `src/lib/mcp/tools/register.ts`

**Interfaces:**

- Consumes: `resolveOrgForTool`, `listOrgMemberProfiles` (Task 1); `validateRange` (Task 3); `EFFORT_FALLBACK` from `src/lib/workload/types.ts`.
- Produces:
  - `WorkloadSummaryRow = { userId: string; name: string | null; allocatedSecs: number; itemCount: number; capacitySecs: number }`
  - `getWorkloadSummaryCore(supabase, args: { orgId: string; from: string; to: string; members: OrgMemberProfile[] }): Promise<WorkloadSummaryRow[]>`
  - `getWorkloadHandler`, `registerGetWorkloadTool`

`getWorkloadPageData` is **not** extracted. It ships raw rows plus board and workspace metadata so the grid can recompute client-side with zero round-trips — the right shape for a UI, the wrong shape for an agent. The tool gets a new, purpose-built summary core over the same `workload_rollup` RPC.

- [ ] **Step 1: Write the failing core test**

Create `src/lib/workload/summary-core.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getWorkloadSummaryCore } from "./queries";

const MEMBERS = [
  { userId: "u1", fullName: "Ada", avatarUrl: null },
  { userId: "u2", fullName: "Grace", avatarUrl: null },
];

function fakeClient(rawRows: unknown[], capacityRows: unknown[]) {
  return {
    rpc: vi.fn(async () => ({ data: rawRows, error: null })),
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: table === "member_capacity" ? capacityRows : [],
            error: null,
          }),
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
  };
}

describe("getWorkloadSummaryCore", () => {
  it("sums estimates per member and joins their name", async () => {
    const client = fakeClient(
      [
        {
          item_id: "i1",
          board_id: "b1",
          item_name: "A",
          user_id: "u1",
          start_date: null,
          end_date: null,
          estimate_secs: 3600,
        },
        {
          item_id: "i2",
          board_id: "b1",
          item_name: "B",
          user_id: "u1",
          start_date: null,
          end_date: null,
          estimate_secs: 1800,
        },
        {
          item_id: "i3",
          board_id: "b1",
          item_name: "C",
          user_id: "u2",
          start_date: null,
          end_date: null,
          estimate_secs: null,
        },
      ],
      [{ user_id: "u1", hours_per_day: 8, working_days: [1, 2, 3, 4, 5] }],
    );

    const rows = await getWorkloadSummaryCore(client as never, {
      orgId: "o1",
      from: "2026-01-05",
      to: "2026-01-09",
      members: MEMBERS,
    });

    const ada = rows.find((r) => r.userId === "u1");
    expect(ada?.allocatedSecs).toBe(5400);
    expect(ada?.itemCount).toBe(2);
    expect(ada?.name).toBe("Ada");

    // u2's single item has no estimate — counted, but contributes no seconds.
    const grace = rows.find((r) => r.userId === "u2");
    expect(grace?.allocatedSecs).toBe(0);
    expect(grace?.itemCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/lib/workload/summary-core.test.ts`
Expected: FAIL — `getWorkloadSummaryCore` is not exported.

- [ ] **Step 3: Add the summary core**

Append to `src/lib/workload/queries.ts` (adding the `SupabaseClient` / `Database` / `OrgMemberProfile` imports):

```ts
export type WorkloadSummaryRow = {
  userId: string;
  name: string | null;
  allocatedSecs: number;
  itemCount: number;
  capacitySecs: number;
};

/**
 * Per-member planned load over a window, for the MCP surface.
 *
 * Deliberately NOT an extraction of `getWorkloadPageData`: that ships raw rows
 * plus board/workspace metadata so the grid recomputes client-side with zero
 * round-trips (AGENTS.md §5) — the right shape for a UI, the wrong shape for an
 * agent. This folds the same `workload_rollup` RPC into one row per member.
 *
 * Capacity uses the member's own row when present, else the org default, else
 * EFFORT_FALLBACK — the same precedence the page applies.
 */
export async function getWorkloadSummaryCore(
  supabase: SupabaseClient<Database>,
  args: {
    orgId: string;
    from: string;
    to: string;
    members: OrgMemberProfile[];
  },
): Promise<WorkloadSummaryRow[]> {
  const [rollupRes, capacityRes, defaultsRes] = await Promise.all([
    supabase.rpc("workload_rollup", { p_from: args.from, p_to: args.to }),
    supabase
      .from("member_capacity")
      .select("user_id, hours_per_day, working_days")
      .eq("org_id", args.orgId),
    supabase
      .from("org_workload_settings")
      .select("default_hours_per_day, default_working_days")
      .eq("org_id", args.orgId)
      .maybeSingle(),
  ]);

  const defaultHours = Number(
    defaultsRes.data?.default_hours_per_day ?? EFFORT_FALLBACK.hoursPerDay,
  );
  const defaultDays = (
    defaultsRes.data?.default_working_days ?? EFFORT_FALLBACK.workingDays
  ).map(Number);

  const capacity = new Map<
    string,
    { hoursPerDay: number; workingDays: number[] }
  >();
  for (const c of capacityRes.data ?? [])
    capacity.set(c.user_id, {
      hoursPerDay: Number(c.hours_per_day),
      workingDays: (c.working_days ?? []).map(Number),
    });

  const workingDaysInWindow = countWorkingDays(args.from, args.to, defaultDays);

  const totals = new Map<string, { secs: number; items: number }>();
  for (const r of rollupRes.data ?? []) {
    if (!r.user_id) continue;
    const t = totals.get(r.user_id) ?? { secs: 0, items: 0 };
    t.secs += r.estimate_secs == null ? 0 : Number(r.estimate_secs);
    t.items += 1;
    totals.set(r.user_id, t);
  }

  return args.members.map((m) => {
    const t = totals.get(m.userId) ?? { secs: 0, items: 0 };
    const cap = capacity.get(m.userId);
    const hoursPerDay = cap?.hoursPerDay ?? defaultHours;
    const days = cap
      ? countWorkingDays(args.from, args.to, cap.workingDays)
      : workingDaysInWindow;
    return {
      userId: m.userId,
      name: m.fullName,
      allocatedSecs: t.secs,
      itemCount: t.items,
      capacitySecs: Math.round(hoursPerDay * 3600 * days),
    };
  });
}

const DAY_MS = 86_400_000;

/** Working days in [from, to] whose UTC weekday is in `workingDays` (1 = Mon). */
function countWorkingDays(
  from: string,
  to: string,
  workingDays: number[],
): number {
  const allowed = new Set(workingDays);
  let count = 0;
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += DAY_MS
  ) {
    const dow = new Date(t).getUTCDay(); // 0 = Sun … 6 = Sat
    if (allowed.has(dow === 0 ? 7 : dow)) count++;
  }
  return count;
}
```

Check `EFFORT_FALLBACK.workingDays`' convention in `src/lib/workload/types.ts` before finalising `countWorkingDays`: if it stores Sunday as `0` rather than `7`, drop the `dow === 0 ? 7 : dow` remap.

- [ ] **Step 4: Run the core test to verify it passes**

Run: `pnpm vitest run src/lib/workload/summary-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tool test**

Create `src/lib/mcp/tools/get-workload.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getWorkloadHandler } from "./get-workload";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async () => ({
    org: { id: "o1", name: "Acme", timezone: "UTC" },
  })),
  listOrgMemberProfiles: vi.fn(async () => [
    { userId: "u1", fullName: "Ada", avatarUrl: null },
  ]),
}));

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workload/queries", () => ({ getWorkloadSummaryCore: core }));

describe("getWorkloadHandler", () => {
  it("returns per-member load for the window", async () => {
    core.mockResolvedValue([
      {
        userId: "u1",
        name: "Ada",
        allocatedSecs: 5400,
        itemCount: 2,
        capacitySecs: 144000,
      },
    ]);
    const getClient = vi.fn(async () => ({}) as never);

    const result = await getWorkloadHandler(getClient, {
      from: "2026-01-05",
      to: "2026-01-09",
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual({
      from: "2026-01-05",
      to: "2026-01-09",
      members: [
        {
          userId: "u1",
          name: "Ada",
          allocatedSecs: 5400,
          itemCount: 2,
          capacitySecs: 144000,
        },
      ],
    });
  });

  it("rejects an over-long range without touching the client", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await getWorkloadHandler(getClient, {
      from: "2026-01-01",
      to: "2027-01-01",
    });
    expect(result.isError).toBe(true);
    expect(getClient).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `pnpm vitest run src/lib/mcp/tools/get-workload.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the tool**

Create `src/lib/mcp/tools/get-workload.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getWorkloadSummaryCore } from "@/lib/workload/queries";
import { resolveOrgForTool, listOrgMemberProfiles } from "@/lib/mcp/org-scope";
import { validateRange } from "./range";
import type { GetClient, ToolResult } from "./shared";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use `YYYY-MM-DD`.");

/** A quarter is the longest window a capacity comparison stays meaningful over. */
export const WORKLOAD_RANGE_MAX_DAYS = 92;
const DAY_MS = 86_400_000;

function defaultWindow(): { from: string; to: string } {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(now), to: iso(now + 27 * DAY_MS) };
}

export async function getWorkloadHandler(
  getClient: GetClient,
  args: { orgId?: string; from?: string; to?: string },
): Promise<ToolResult> {
  const window =
    args.from && args.to ? { from: args.from, to: args.to } : defaultWindow();

  const rangeError = validateRange(
    window.from,
    window.to,
    WORKLOAD_RANGE_MAX_DAYS,
  );
  if (rangeError)
    return { content: [{ type: "text", text: rangeError }], isError: true };

  const supabase = await getClient();
  const scope = await resolveOrgForTool(supabase, args.orgId);
  if ("error" in scope)
    return { content: [{ type: "text", text: scope.error }], isError: true };

  try {
    const members = await listOrgMemberProfiles(supabase, scope.org.id);
    const rows = await getWorkloadSummaryCore(supabase, {
      orgId: scope.org.id,
      from: window.from,
      to: window.to,
      members,
    });
    return {
      content: [
        { type: "text", text: JSON.stringify({ ...window, members: rows }) },
      ],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerGetWorkloadTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_workload",
    {
      title: "Get workload",
      description: `Planned load per team member over a date window: allocated seconds from item estimates, item count, and capacity seconds. Defaults to the next four weeks. Range must be at most ${WORKLOAD_RANGE_MAX_DAYS} days. Pass both \`from\` and \`to\` together, or neither.`,
      inputSchema: {
        orgId: z.string().uuid().optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      },
    },
    async (args) => getWorkloadHandler(getClient, args),
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/mcp/tools/get-workload.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Register the tool**

```ts
import { registerGetWorkloadTool } from "./get-workload";
// …
registerGetWorkloadTool(server, getClient);
```

- [ ] **Step 10: Verify nothing regressed**

Run: `pnpm typecheck && pnpm vitest run src/lib/mcp src/lib/workload`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/workload/queries.ts src/lib/workload/summary-core.test.ts \
        src/lib/mcp/tools/get-workload.ts src/lib/mcp/tools/get-workload.test.ts \
        src/lib/mcp/tools/register.ts
git commit -m "feat(mcp): add get_workload tool"
```

---

## Task 9: Reports — `list_reports` + `get_report`

**Files:**

- Modify: `src/lib/reports/queries.ts:33-54`
- Create: `src/lib/mcp/tools/list-reports.ts` + `.test.ts`
- Create: `src/lib/mcp/tools/get-report.ts` + `.test.ts`
- Modify: `src/lib/mcp/tools/register.ts`

**Interfaces:**

- Consumes: `ReportRow`, `parseReportConfig` from `src/lib/reports/{queries,config}.ts`.
- Produces:
  - `getReportCore(supabase, reportId): Promise<ReportRow | null>`
  - `listReportsCore(supabase, boardId, limit?): Promise<ReportRow[]>`
  - `REPORTS_LIMIT: number`
  - `listReportsHandler`, `getReportHandler`, and their `register…Tool` functions

`get_report` returns the report's **structure** — name, board, and its blocks' types and titles — not resolved chart data. `shapeReport` / `computeKpis` / `computeChartSeries` all take a full `BoardPayload` (every cell value, attachment and time entry on the board); resolving inside a tool would be an unbounded read. Resolved report data is Spec 2's job.

- [ ] **Step 1: Extract both cores**

In `src/lib/reports/queries.ts`, add the type imports and split:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
```

```ts
/** Hot-path cap (AGENTS.md: bounded reads). Was an inline 100 in listReports. */
export const REPORTS_LIMIT = 100;

const REPORT_COLUMNS = "id, org_id, board_id, name, config, updated_at";

/** Client-injected core. */
export async function getReportCore(
  supabase: SupabaseClient<Database>,
  reportId: string,
): Promise<ReportRow | null> {
  const { data } = await supabase
    .from("reports")
    .select(REPORT_COLUMNS)
    .eq("id", reportId)
    .maybeSingle();
  return data ? rowToReport(data) : null;
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export const getReport = cache(
  async (reportId: string): Promise<ReportRow | null> => {
    const supabase = await createClient();
    return getReportCore(supabase, reportId);
  },
);

/** Client-injected core. */
export async function listReportsCore(
  supabase: SupabaseClient<Database>,
  boardId: string,
  limit: number = REPORTS_LIMIT,
): Promise<ReportRow[]> {
  const { data } = await supabase
    .from("reports")
    .select(REPORT_COLUMNS)
    .eq("board_id", boardId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(rowToReport);
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export async function listReports(boardId: string): Promise<ReportRow[]> {
  const supabase = await createClient();
  return listReportsCore(supabase, boardId);
}
```

- [ ] **Step 2: Run the existing report tests to prove the extraction changed nothing**

Run: `pnpm vitest run src/lib/reports`
Expected: PASS.

- [ ] **Step 3: Write the failing tool tests**

Create `src/lib/mcp/tools/list-reports.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { listReportsHandler } from "./list-reports";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reports/queries", () => ({
  REPORTS_LIMIT: 100,
  listReportsCore: core,
}));

describe("listReportsHandler", () => {
  it("returns report summaries for a board", async () => {
    core.mockResolvedValue([
      {
        id: "r1",
        orgId: "o1",
        boardId: "b1",
        name: "Weekly status",
        updatedAt: "2026-01-05T10:00:00Z",
        config: { version: 1, blocks: [{ type: "kpis" }, { type: "chart" }] },
      },
    ]);
    const getClient = vi.fn(async () => ({}) as never);

    const result = await listReportsHandler(getClient, { boardId: "b1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        id: "r1",
        name: "Weekly status",
        boardId: "b1",
        updatedAt: "2026-01-05T10:00:00Z",
        blockCount: 2,
      },
    ]);
  });
});
```

Create `src/lib/mcp/tools/get-report.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getReportHandler } from "./get-report";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reports/queries", () => ({ getReportCore: core }));

describe("getReportHandler", () => {
  it("returns the report's block structure", async () => {
    core.mockResolvedValue({
      id: "r1",
      orgId: "o1",
      boardId: "b1",
      name: "Weekly status",
      updatedAt: "2026-01-05T10:00:00Z",
      config: {
        version: 1,
        blocks: [
          { type: "kpis", title: "Headline" },
          { type: "chart", title: "By status" },
        ],
      },
    });

    const result = await getReportHandler(async () => ({}) as never, {
      reportId: "r1",
    });

    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "r1",
      name: "Weekly status",
      boardId: "b1",
      updatedAt: "2026-01-05T10:00:00Z",
      blocks: [
        { type: "kpis", title: "Headline" },
        { type: "chart", title: "By status" },
      ],
    });
  });

  it("errors when the report is not visible", async () => {
    core.mockResolvedValue(null);
    const result = await getReportHandler(async () => ({}) as never, {
      reportId: "missing",
    });
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 4: Run them to make sure they fail**

Run: `pnpm vitest run src/lib/mcp/tools/list-reports.test.ts src/lib/mcp/tools/get-report.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 5: Implement `list_reports`**

Create `src/lib/mcp/tools/list-reports.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listReportsCore, REPORTS_LIMIT } from "@/lib/reports/queries";
import type { GetClient, ToolResult } from "./shared";

export async function listReportsHandler(
  getClient: GetClient,
  args: { boardId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const reports = await listReportsCore(supabase, args.boardId);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            reports.map((r) => ({
              id: r.id,
              name: r.name,
              boardId: r.boardId,
              updatedAt: r.updatedAt,
              blockCount: r.config.blocks.length,
            })),
          ),
        },
      ],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerListReportsTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_reports",
    {
      title: "List reports",
      description: `Reports saved against one board, newest first. Returns at most ${REPORTS_LIMIT}. Get board ids from list_boards.`,
      inputSchema: { boardId: z.string().uuid() },
    },
    async (args) => listReportsHandler(getClient, args),
  );
}
```

- [ ] **Step 6: Implement `get_report`**

Create `src/lib/mcp/tools/get-report.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getReportCore } from "@/lib/reports/queries";
import type { GetClient, ToolResult } from "./shared";

export async function getReportHandler(
  getClient: GetClient,
  args: { reportId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const report = await getReportCore(supabase, args.reportId);
    if (!report)
      return {
        content: [{ type: "text", text: `Report ${args.reportId} not found.` }],
        isError: true,
      };

    // Structure only. Resolving a report's numbers needs the board's full
    // payload (every cell value, attachment, time entry) — an unbounded read
    // this tool must not perform. Deferred to Spec 2.
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            id: report.id,
            name: report.name,
            boardId: report.boardId,
            updatedAt: report.updatedAt,
            blocks: report.config.blocks.map((b) => ({
              type: b.type,
              title: "title" in b ? (b.title ?? null) : null,
            })),
          }),
        },
      ],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerGetReportTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_report",
    {
      title: "Get report",
      description:
        "One report's structure — its name, board, and the ordered blocks it is built from. Does not resolve the blocks' data; use list_items or get_widget_data for numbers. Get ids from list_reports.",
      inputSchema: { reportId: z.string().uuid() },
    },
    async (args) => getReportHandler(getClient, args),
  );
}
```

If `blockSchema`'s variants do not all carry `title`, the `"title" in b` guard above already handles it. Confirm against `src/lib/reports/config.ts:67`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/mcp/tools/list-reports.test.ts src/lib/mcp/tools/get-report.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Register both tools**

```ts
import { registerListReportsTool } from "./list-reports";
import { registerGetReportTool } from "./get-report";
// …
registerListReportsTool(server, getClient);
registerGetReportTool(server, getClient);
```

- [ ] **Step 9: Verify nothing regressed**

Run: `pnpm typecheck && pnpm vitest run src/lib/mcp src/lib/reports`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/reports/queries.ts \
        src/lib/mcp/tools/list-reports.ts src/lib/mcp/tools/list-reports.test.ts \
        src/lib/mcp/tools/get-report.ts src/lib/mcp/tools/get-report.test.ts \
        src/lib/mcp/tools/register.ts
git commit -m "feat(mcp): add report read tools"
```

---

## Task 10: Settings table + enforced sync

**Files:**

- Modify: `src/lib/mcp/tools/register.ts`
- Modify: `src/components/settings/mcp/mcp-tools-table.tsx`
- Modify: `src/components/settings/mcp/mcp-tools-table.test.tsx`

**Interfaces:**

- Consumes: every `register…Tool` from Tasks 1–9.
- Produces: `MCP_TOOL_NAMES: readonly string[]` exported from `register.ts` — the single source of truth both the server and the settings table read.

The current test asserts _"lists all seven registered tools"_ — a hardcoded count, not a comparison. The component's own header says the list _"must stay in sync"_ with the registrations because it is the user's only account of what they are granting. Nothing enforces it. Fix that here.

- [ ] **Step 1: Write the failing sync test**

Replace `src/components/settings/mcp/mcp-tools-table.test.tsx` with:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { McpToolsTable, MCP_TOOLS_TABLE_ROWS } from "./mcp-tools-table";
import { MCP_TOOL_NAMES } from "@/lib/mcp/tools/register";

describe("McpToolsTable", () => {
  it("lists exactly the registered tools — no more, no fewer", () => {
    // This table is the user's ONLY account of what a connected client may do.
    // A tool registered without a row here understates the access being granted.
    expect([...MCP_TOOLS_TABLE_ROWS.map((r) => r.name)].sort()).toEqual(
      [...MCP_TOOL_NAMES].sort(),
    );
  });

  it("marks exactly the three write tools as writes", () => {
    const writes = MCP_TOOLS_TABLE_ROWS.filter((r) => r.access === "write").map(
      (r) => r.name,
    );
    expect(writes.sort()).toEqual([
      "create_item",
      "log_time_allocation",
      "update_item",
    ]);
  });

  it("renders every tool name", () => {
    render(<McpToolsTable />);
    for (const name of MCP_TOOL_NAMES) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/components/settings/mcp/mcp-tools-table.test.tsx`
Expected: FAIL — `MCP_TOOL_NAMES` and `MCP_TOOLS_TABLE_ROWS` are not exported.

- [ ] **Step 3: Export the registered names from `register.ts`**

At the bottom of `src/lib/mcp/tools/register.ts`:

```ts
/**
 * Every tool name `registerTools` registers, in registration order.
 *
 * The settings table (`src/components/settings/mcp/mcp-tools-table.tsx`) is
 * checked against this list by test, so a tool added above without a row there
 * fails CI. That table is the user's only account of what they are granting;
 * an understated list is a consent bug, not a docs bug.
 */
export const MCP_TOOL_NAMES = [
  "list_boards",
  "get_board",
  "list_items",
  "search_items",
  "get_item",
  "create_item",
  "update_item",
  "list_organizations",
  "get_my_work",
  "list_time_allocations",
  "get_time_summary",
  "log_time_allocation",
  "list_goals",
  "get_goal",
  "list_portfolios",
  "get_portfolio",
  "list_dashboards",
  "get_dashboard",
  "get_widget_data",
  "get_workload",
  "list_reports",
  "get_report",
] as const;
```

- [ ] **Step 4: Expand the settings table and export its rows**

In `src/components/settings/mcp/mcp-tools-table.tsx`, rename the local `TOOLS` to an exported `MCP_TOOLS_TABLE_ROWS`, update the header comment to point at the test rather than at goodwill, and add the 15 new rows:

```tsx
/**
 * The tools a connected client can call.
 *
 * Kept in sync with `src/lib/mcp/tools/register.ts` BY TEST
 * (`mcp-tools-table.test.tsx` compares this list against `MCP_TOOL_NAMES`).
 * This is the user's only account of what they are granting, so a registered
 * tool missing here understates the access being approved.
 */
export const MCP_TOOLS_TABLE_ROWS = [
  { name: "list_boards", access: "read", what: "List the boards you can see." },
  {
    name: "get_board",
    access: "read",
    what: "Read a board's columns and groups.",
  },
  {
    name: "list_items",
    access: "read",
    what: "Read a board's items and their values.",
  },
  {
    name: "search_items",
    access: "read",
    what: "Find items by name within a board.",
  },
  {
    name: "get_item",
    access: "read",
    what: "Read one item's fields and values.",
  },
  { name: "create_item", access: "write", what: "Add a new item to a board." },
  {
    name: "update_item",
    access: "write",
    what: "Change values on an existing item.",
  },
  {
    name: "list_organizations",
    access: "read",
    what: "List the organizations you belong to.",
  },
  {
    name: "get_my_work",
    access: "read",
    what: "Read everything assigned to you, by due date.",
  },
  {
    name: "list_time_allocations",
    access: "read",
    what: "Read the time you have logged.",
  },
  {
    name: "get_time_summary",
    access: "read",
    what: "Read totals of your logged time.",
  },
  {
    name: "log_time_allocation",
    access: "write",
    what: "Log time against an item or category, for you.",
  },
  {
    name: "list_goals",
    access: "read",
    what: "Read your organization's goals and progress.",
  },
  { name: "get_goal", access: "read", what: "Read one goal in detail." },
  {
    name: "list_portfolios",
    access: "read",
    what: "List the portfolios you can see.",
  },
  {
    name: "get_portfolio",
    access: "read",
    what: "Read a portfolio's board rollup.",
  },
  {
    name: "list_dashboards",
    access: "read",
    what: "List the dashboards you can see.",
  },
  {
    name: "get_dashboard",
    access: "read",
    what: "Read a dashboard's widgets.",
  },
  {
    name: "get_widget_data",
    access: "read",
    what: "Read one widget's resolved data.",
  },
  {
    name: "get_workload",
    access: "read",
    what: "Read your team's planned load and capacity.",
  },
  {
    name: "list_reports",
    access: "read",
    what: "List a board's saved reports.",
  },
  { name: "get_report", access: "read", what: "Read a report's structure." },
] as const;
```

Update the component body to map over `MCP_TOOLS_TABLE_ROWS`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/components/settings/mcp/mcp-tools-table.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Prove the guard actually guards**

Temporarily delete the `list_goals` row from `MCP_TOOLS_TABLE_ROWS` and re-run the test.
Expected: FAIL on the first assertion. **Restore the row** and re-run to confirm PASS. A guard that cannot fail is not a guard.

- [ ] **Step 7: Run all four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/tools/register.ts \
        src/components/settings/mcp/mcp-tools-table.tsx \
        src/components/settings/mcp/mcp-tools-table.test.tsx
git commit -m "feat(mcp): list all 22 tools in settings and enforce the sync by test"
```

---

## Task 11: Cross-org RLS integration tests

**Files:**

- Modify: `src/lib/mcp/tools/cross-org-access.rls.integration.test.ts`
- Create: `src/lib/mcp/tools/surface-reads.rls.integration.test.ts`

**Interfaces:**

- Consumes: every handler from Tasks 1–9; the existing integration harness (`src/test/integration-auth.ts`, `src/test/integration-env.ts`).

These suites skip unless `PULSE_TEST_DB` is set, so they never run against the live DEV database in CI.

- [ ] **Step 1: Read the existing harness**

Read `src/lib/mcp/tools/cross-org-access.rls.integration.test.ts` end to end and reuse its exact setup — two orgs, two users, the bridged-client construction and the skip guard. Do not invent a second harness shape.

- [ ] **Step 2: Add the foreign-org cases**

Append to `cross-org-access.rls.integration.test.ts` one case per org-scoped tool, each asserting a foreign `orgId` is refused rather than honoured:

```ts
describe("org-scoped tools reject a foreign orgId", () => {
  const cases: {
    name: string;
    run: (orgId: string) => Promise<{ isError?: boolean }>;
  }[] = [
    {
      name: "list_goals",
      run: (orgId) => listGoalsHandler(getClientB, { orgId }),
    },
    {
      name: "list_dashboards",
      run: (orgId) => listDashboardsHandler(getClientB, { orgId }),
    },
    {
      name: "get_workload",
      run: (orgId) => getWorkloadHandler(getClientB, { orgId }),
    },
    {
      name: "log_time_allocation",
      run: (orgId) =>
        logTimeAllocationHandler(getClientB, userB.id, {
          orgId,
          date: "2026-01-05",
          category: "Admin",
          secs: 900,
        }),
    },
  ];

  for (const c of cases) {
    it(`${c.name} refuses org A when called as user B`, async () => {
      const result = await c.run(orgA.id);
      expect(result.isError).toBe(true);
    });
  }
});
```

- [ ] **Step 3: Add the positive-path suite**

Create `surface-reads.rls.integration.test.ts` asserting that, as a legitimate member, each read tool returns only that org's rows: seed one item, one allocation, one goal and one dashboard in org A, call each handler as user A, and assert the seeded row is present; then call as user B and assert it is absent.

- [ ] **Step 4: Run the integration suites**

Run: `PULSE_TEST_DB=1 pnpm vitest run src/lib/mcp/tools/cross-org-access.rls.integration.test.ts src/lib/mcp/tools/surface-reads.rls.integration.test.ts`
Expected: PASS.

Run them once WITHOUT the env var too, and confirm they SKIP rather than fail:
Run: `pnpm vitest run src/lib/mcp/tools/surface-reads.rls.integration.test.ts`
Expected: SKIPPED.

- [ ] **Step 5: Run all four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/tools/cross-org-access.rls.integration.test.ts \
        src/lib/mcp/tools/surface-reads.rls.integration.test.ts
git commit -m "test(mcp): cover cross-org refusal and per-surface reads"
```

---

## Closure

- [ ] Run `scripts/finish-task.sh` from inside the worktree. It rebases onto the latest `develop`, runs all four gates against the merged state, merges, pushes, then removes the worktree and deletes the branch.
- [ ] Hand the user the numbered "How to test this" walkthrough from spec §11.
- [ ] Run `/wrapup` to log the session note and bump `vault/00-north-star.md`.

The task is not complete while the `task/*` branch is unmerged or the worktree still exists.
