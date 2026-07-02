# Perf: Bounded Queries + Caching + Lazy Charts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-02-perf-query-bounds-design.md` (read it first — it contains the verified findings, the invalidation matrices, and the decisions taken).

**Goal:** Bound every hot-path list read in this slice, serve org-members and readable-boards from the `use cache` layer with correct tag invalidation, split `recharts` out of the dashboard first-paint bundle, and collapse the portfolio page's await waterfall.

**Architecture:** Follows the established Phase 9.3 pattern exactly: `use cache` wrappers in `*/queries-cached.ts` using the service client with explicit tenant filters (the filter IS the boundary — service client bypasses RLS), tag strings only from `src/lib/cache/tags.ts`, `updateTag` in every Server Action that writes tagged data, and unit + cross-tenant integration tests for every service-client read. Bundle split mirrors the existing `PdfPreview` `next/dynamic` pattern.

**Tech Stack:** Next.js 16 (cacheComponents, `use cache`, `cacheLife("nav")`, `next/dynamic`), Supabase (service + RLS clients), Vitest, TypeScript strict.

## Global Constraints

- This is Next.js 16 with breaking changes — confirm any API doubt against `node_modules/next/dist/docs/` before writing code.
- Never inline a cache tag string — import from `src/lib/cache/tags.ts` (producers via `cacheTag`, consumers via `updateTag`).
- `createServiceClient` reads live only in `server-only` modules; every service-client query carries an explicit tenant filter.
- No `any`; no schema changes; no new dependencies.
- Commit subjects lowercase after `type(scope):`; every commit gets a descriptive body + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer; stage explicitly by path.
- Limits (from spec): readable boards **500**, org members **500**, portfolios **200**, goals **1000**, goal links **2000**, dashboards **100**.
- Performance budget (spec, AGENTS.md §5): no interaction gains a server round-trip; every touched read is bounded over an indexed column; the portfolio page goes from 3 await stages to 2.

---

## File structure (what's created/modified where)

| File                                                                | Task    | Responsibility                                                                                    |
| ------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `src/components/dashboards/DashboardWidget.tsx`                     | 1       | dynamic-import the chart path                                                                     |
| `src/components/dashboards/DashboardWidget.test.tsx` (new)          | 1       | widget-kind dispatch incl. lazy chart                                                             |
| `src/lib/portfolios/queries.ts`                                     | 2, 5, 8 | bounds (T2), readable-boards bound (T5), `getPortfolioRows` parallelization + cached members (T8) |
| `src/lib/portfolios/queries.test.ts` (new)                          | 2, 8    | limit + waterfall regression tests                                                                |
| `src/lib/goals/queries.ts`                                          | 2, 6    | bounds + JSDoc (T2), cached members in `getGoalOwners` (T6)                                       |
| `src/lib/goals/queries.test.ts` (new)                               | 2       | limit assertions                                                                                  |
| `src/lib/goals/progress.test.ts`                                    | 2       | orphan-tolerance case                                                                             |
| `src/lib/cache/tags.ts` + `tags.test.ts`                            | 3       | `orgMembersTag`                                                                                   |
| `src/lib/org/queries-cached.ts` (new) + test                        | 3       | `listOrgMembersCached`                                                                            |
| `src/lib/org/admin-actions.ts` + test                               | 4       | tag invalidation on membership changes                                                            |
| `src/lib/portfolios/queries-cached.ts` (new) + test                 | 5       | `listReadableBoardsCached`                                                                        |
| `src/app/(app)/boards/[boardId]/page.tsx`                           | 6       | cached members                                                                                    |
| `src/lib/workload/queries.ts`                                       | 6, 7    | cached members (T6), cached readable boards (T7)                                                  |
| `src/app/(app)/goals/page.tsx`                                      | 7       | cached readable boards                                                                            |
| `src/app/(app)/portfolios/[portfolioId]/page.tsx`                   | 8       | parallel fetch + cached reads                                                                     |
| `src/app/(app)/dashboards/page.tsx`                                 | 9       | cached dashboards list                                                                            |
| `src/lib/dashboards/queries.ts` + tests, `queries-cached.ts` + test | 9       | delete `listDashboards`, bound cached list                                                        |
| `src/lib/cache/cross-tenant-isolation.integration.test.ts`          | 10      | isolation proofs for both new wrappers                                                            |
| `src/lib/boards/queries.ts`                                         | 6       | delete `listOrgMembers` (keep `OrgMember` type)                                                   |

---

### Task 1: Lazy-load the chart rendering path

**Files:**

- Modify: `src/components/dashboards/DashboardWidget.tsx` (line 14: static `ChartWidget` import)
- Test: `src/components/dashboards/DashboardWidget.test.tsx` (new)

**Interfaces:**

- Consumes: existing `ChartWidget` named export from `@/components/dashboards/widgets/ChartWidget`; `next/dynamic`.
- Produces: no API change — `DashboardWidget` props are unchanged. Later tasks do not depend on this task.

- [ ] **Step 1: Write the failing test**

Create `src/components/dashboards/DashboardWidget.test.tsx`. Mock `next/dynamic` the way `FilePreviewLightbox.test.tsx` does (loader resolved eagerly so the lazy component renders synchronously in jsdom), and mock the leaf widgets so the test pins _dispatch_, not chart internals:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Resolve next/dynamic loaders eagerly so the lazy ChartWidget renders in jsdom.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    let Comp: React.ComponentType<Record<string, unknown>> | null = null;
    void loader().then((m) => {
      Comp = (m as { ChartWidget: React.ComponentType }).ChartWidget;
    });
    return function Lazy(props: Record<string, unknown>) {
      return Comp ? <Comp {...props} /> : null;
    };
  },
}));

vi.mock("@/components/dashboards/widgets/ChartWidget", () => ({
  ChartWidget: () => <div data-testid="chart-widget" />,
}));
vi.mock("@/components/dashboards/widgets/NumberWidget", () => ({
  NumberWidget: () => <div data-testid="number-widget" />,
}));
vi.mock("@/components/dashboards/widgets/BatteryWidget", () => ({
  BatteryWidget: () => <div data-testid="battery-widget" />,
}));
vi.mock("@/components/dashboards/widgets/ListWidget", () => ({
  ListWidget: () => <div data-testid="list-widget" />,
}));
vi.mock("@/lib/dashboards/use-dashboard-mutations", () => ({
  useDashboardMutations: () => ({
    removeWidget: { mutate: vi.fn() },
    editWidget: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock("@/components/dashboards/WidgetConfigSheet", () => ({
  WidgetConfigSheet: () => null,
}));

import { DashboardWidget } from "./DashboardWidget";
import type { CacheWidget } from "@/lib/dashboards/cache";

const base = {
  id: "w1",
  title: "W",
  source_board_id: "b1",
  config: {},
} as unknown as CacheWidget;

function renderKind(kind: string) {
  return render(
    <DashboardWidget
      widget={{ ...base, kind } as CacheWidget}
      dashboardId="d1"
      editing={false}
      boards={[]}
    />,
  );
}

describe("DashboardWidget", () => {
  it("renders the chart widget through the lazy path", async () => {
    renderKind("chart");
    expect(await screen.findByTestId("chart-widget")).toBeInTheDocument();
  });

  it("renders static widgets directly", () => {
    renderKind("number");
    expect(screen.getByTestId("number-widget")).toBeInTheDocument();
  });
});
```

Note: with the current static import, the `next/dynamic` mock is unused and the chart test may pass trivially — the _load-bearing_ failure is Step 2's import assertion. Keep both.

Add a static-import guard test to the same file (this is the one that MUST fail now):

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("does not statically import ChartWidget (recharts stays out of first paint)", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/dashboards/DashboardWidget.tsx"),
    "utf8",
  );
  expect(src).not.toMatch(/^import\s+\{\s*ChartWidget\s*\}\s+from/m);
  expect(src).toContain("dynamic(");
});
```

- [ ] **Step 2: Run the test — verify the guard fails**

Run: `pnpm vitest run src/components/dashboards/DashboardWidget.test.tsx`
Expected: FAIL on "does not statically import ChartWidget".

- [ ] **Step 3: Implement the dynamic import**

In `src/components/dashboards/DashboardWidget.tsx`, replace line 14
(`import { ChartWidget } from "@/components/dashboards/widgets/ChartWidget";`) with:

```tsx
import dynamic from "next/dynamic";

// Client-only recharts renderer (~35 KB gzip) — lazily loaded only when a chart
// widget mounts, so recharts never enters the dashboard first-paint bundle.
// Fallback mirrors ChartWidget's own series-loading skeleton (no layout shift:
// the widget shell owns the sizing). Mirrors the PdfPreview pattern in
// FilePreviewLightbox.tsx.
const ChartWidget = dynamic(
  () =>
    import("@/components/dashboards/widgets/ChartWidget").then(
      (m) => m.ChartWidget,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted/40 h-full animate-pulse rounded-md" />
    ),
  },
);
```

(Place the `dynamic` import with the other imports; the `const ChartWidget` after the import block. Everything else in the file is unchanged — the JSX usage `<ChartWidget widget={widget} />` still typechecks because `dynamic` preserves the prop type.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/dashboards/DashboardWidget.test.tsx src/components/dashboards/widgets/ChartWidget.test.tsx`
Expected: PASS (ChartWidget's own tests are untouched and must stay green).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/DashboardWidget.tsx src/components/dashboards/DashboardWidget.test.tsx
git commit -m "perf(dashboards): lazy-load the recharts chart widget" \
  -m "Statically importing ChartWidget pulled recharts (~35 KB gzip) into the
dashboard first-paint bundle even when no chart widget exists. Load it via
next/dynamic (ssr:false) with the same skeleton ChartWidget shows while its
series loads, mirroring the PdfPreview pattern in FilePreviewLightbox.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Bound `listPortfolios`, `getGoalsTree`, `getGoalLinks`

**Files:**

- Modify: `src/lib/portfolios/queries.ts:8-15` (`listPortfolios`)
- Modify: `src/lib/goals/queries.ts:61-77` (`getGoalLinks`), `:89-111` (`getGoalsTree`)
- Test: `src/lib/portfolios/queries.test.ts` (new), `src/lib/goals/queries.test.ts` (new), `src/lib/goals/progress.test.ts` (add one case)

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: same signatures as today — `listPortfolios(): Promise<{id: string; name: string}[]>`, `getGoalsTree(): Promise<GoalNode[]>`, `getGoalLinks(): Promise<Map<string, GoalLink[]>>`. Exported constants `PORTFOLIO_LIMIT = 200` (portfolios/queries.ts), `GOALS_LIMIT = 1000`, `GOAL_LINKS_LIMIT = 2000` (goals/queries.ts) so tests reference them instead of magic numbers.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/portfolios/queries.test.ts` (mock-chain style copied from `src/lib/dashboards/queries.test.ts`):

```ts
import { describe, expect, it, vi } from "vitest";

const limit = vi.fn();
function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    limit: (n: number) => {
      limit(n);
      return chain;
    },
    then: (onF: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onF),
  };
  return chain;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => makeChain([{ id: "p1", name: "P" }]),
  })),
}));
// listOrgMembers import inside portfolios/queries.ts must not explode at import time
vi.mock("@/lib/boards/queries", () => ({ listOrgMembers: vi.fn() }));

import { listPortfolios, PORTFOLIO_LIMIT } from "./queries";

describe("listPortfolios", () => {
  it("is bounded", async () => {
    const rows = await listPortfolios();
    expect(limit).toHaveBeenCalledWith(PORTFOLIO_LIMIT);
    expect(rows).toEqual([{ id: "p1", name: "P" }]);
  });
});
```

Create `src/lib/goals/queries.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const limits: number[] = [];
function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    limit: (n: number) => {
      limits.push(n);
      return chain;
    },
    then: (onF: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onF),
  };
  return chain;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => makeChain([]),
    rpc: vi.fn(async () => ({ data: [], error: null })),
  })),
}));
vi.mock("@/lib/boards/queries", () => ({
  listOrgMembers: vi.fn(async () => []),
}));
vi.mock("@/lib/auth/session", () => ({ getUserOrgs: vi.fn(async () => []) }));

import {
  getGoalLinks,
  getGoalsTree,
  GOALS_LIMIT,
  GOAL_LINKS_LIMIT,
} from "./queries";

describe("goals reads are bounded", () => {
  it("getGoalLinks applies the links cap", async () => {
    limits.length = 0;
    await getGoalLinks();
    expect(limits).toContain(GOAL_LINKS_LIMIT);
  });

  it("getGoalsTree applies the goals cap", async () => {
    limits.length = 0;
    await getGoalsTree();
    expect(limits).toContain(GOALS_LIMIT);
  });
});
```

Add to `src/lib/goals/progress.test.ts` (pins truncation tolerance — a child whose parent fell past the cap is silently dropped, never a crash; roots come from `byParent.get(null)`):

```ts
it("drops orphaned children (truncated parent) without crashing", () => {
  const orphan = makeRow({ id: "g2", parentGoalId: "missing-parent" });
  const root = makeRow({ id: "g1", parentGoalId: null });
  const tree = buildGoalTree([root, orphan], [], new Map(), "2026-07-02");
  expect(tree.map((n) => n.id)).toEqual(["g1"]);
});
```

(Reuse the file's existing row-factory helper; if it's named differently than `makeRow`, use that name — do not add a second factory.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/portfolios/queries.test.ts src/lib/goals/queries.test.ts src/lib/goals/progress.test.ts`
Expected: FAIL — `PORTFOLIO_LIMIT`/`GOALS_LIMIT`/`GOAL_LINKS_LIMIT` not exported, `limit` never called. The progress.test case should PASS already (behavior exists; the test pins it).

- [ ] **Step 3: Implement the bounds**

`src/lib/portfolios/queries.ts` — replace `listPortfolios`:

```ts
/** Hot-path caps (AGENTS.md: bounded reads over indexed columns). Truncates
 * silently at the cap — raise alongside pagination if an org ever approaches it. */
export const PORTFOLIO_LIMIT = 200;

export async function listPortfolios(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolios")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(PORTFOLIO_LIMIT);
  return data ?? [];
}
```

`src/lib/goals/queries.ts` — add the caps and apply them:

```ts
/** Hot-path caps (AGENTS.md: bounded reads over indexed columns). Both reads
 * truncate SILENTLY at the cap: `buildGoalTree` roots from parent_goal_id=null,
 * so a child whose parent fell past the cap is dropped, never a crash. Caps are
 * ≥10× any realistic org today; add pagination before raising them. */
export const GOALS_LIMIT = 1000;
export const GOAL_LINKS_LIMIT = 2000;
```

In `getGoalLinks`, append `.limit(GOAL_LINKS_LIMIT)` to the `goal_links` select. In `getGoalsTree`, append `.limit(GOALS_LIMIT)` after `.order("position")` on the `goals` select.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/portfolios/queries.test.ts src/lib/goals/queries.test.ts src/lib/goals/progress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolios/queries.ts src/lib/portfolios/queries.test.ts \
        src/lib/goals/queries.ts src/lib/goals/queries.test.ts src/lib/goals/progress.test.ts
git commit -m "perf(queries): bound portfolios, goals, and goal-links reads" \
  -m "listPortfolios, getGoalsTree, and getGoalLinks were unbounded selects on
growing tables. Cap them (200/1000/2000) over indexed columns and document
the silent-truncation behavior; buildGoalTree drops orphaned children of a
truncated parent, pinned by test.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `orgMembersTag` + `listOrgMembersCached`

**Files:**

- Modify: `src/lib/cache/tags.ts`, `src/lib/cache/tags.test.ts`
- Create: `src/lib/org/queries-cached.ts`
- Test: `src/lib/org/queries-cached.test.ts` (new)

**Interfaces:**

- Consumes: `createServiceClient` from `@/lib/supabase/service`; `OrgMember` type from `@/lib/boards/queries`.
- Produces (later tasks rely on these exact names):
  - `orgMembersTag(orgId: string): string` → `` `org-members:org:${orgId}` `` (from `@/lib/cache/tags`)
  - `listOrgMembersCached(orgId: string): Promise<OrgMember[]>` (from `@/lib/org/queries-cached`)
  - `ORG_MEMBERS_LIMIT = 500` (same module)

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/cache/tags.test.ts` (follow the file's existing assertion style):

```ts
it("orgMembersTag is org-scoped", () => {
  expect(orgMembersTag("org-1")).toBe("org-members:org:org-1");
});
```

Create `src/lib/org/queries-cached.test.ts` (pattern: `src/lib/dashboards/queries-cached.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// cacheTag/cacheLife throw outside a compiled `use cache` scope under Vitest.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// listOrgMembersCached path:
//   from("org_members").select("user_id").eq("org_id", …).limit(…)
//   from("profiles").select(…).in("id", userIds)
const memberLimit = vi.fn();
const memberEq = vi.fn(() => ({ limit: memberLimit }));
const memberSelect = vi.fn(() => ({ eq: memberEq }));
const profilesIn = vi.fn();
const profilesSelect = vi.fn(() => ({ in: profilesIn }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      table === "org_members"
        ? { select: memberSelect }
        : { select: profilesSelect },
  }),
}));

import { listOrgMembersCached, ORG_MEMBERS_LIMIT } from "./queries-cached";

beforeEach(() => {
  memberSelect.mockClear();
  memberEq.mockClear();
  memberLimit.mockReset();
  profilesSelect.mockClear();
  profilesIn.mockReset();
});

describe("listOrgMembersCached", () => {
  it("filters by orgId (tenant boundary) and bounds the read", async () => {
    memberLimit.mockResolvedValue({ data: [{ user_id: "u1" }], error: null });
    profilesIn.mockResolvedValue({
      data: [{ id: "u1", full_name: "Ana", email: "a@x.io", avatar_url: null }],
      error: null,
    });
    const members = await listOrgMembersCached("org-A");
    expect(memberEq).toHaveBeenCalledWith("org_id", "org-A");
    expect(memberLimit).toHaveBeenCalledWith(ORG_MEMBERS_LIMIT);
    expect(members).toEqual([
      { userId: "u1", fullName: "Ana", email: "a@x.io", avatarUrl: null },
    ]);
  });

  it("keeps members whose profile row is missing (null display fields)", async () => {
    memberLimit.mockResolvedValue({ data: [{ user_id: "u2" }], error: null });
    profilesIn.mockResolvedValue({ data: [], error: null });
    expect(await listOrgMembersCached("org-A")).toEqual([
      { userId: "u2", fullName: null, email: null, avatarUrl: null },
    ]);
  });

  it("returns [] when the org has no members or on error", async () => {
    memberLimit.mockResolvedValue({ data: [], error: null });
    expect(await listOrgMembersCached("org-A")).toEqual([]);
    memberLimit.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await listOrgMembersCached("org-A")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/cache/tags.test.ts src/lib/org/queries-cached.test.ts`
Expected: FAIL — `orgMembersTag` not exported; module `./queries-cached` not found.

- [ ] **Step 3: Implement**

`src/lib/cache/tags.ts` — append:

```ts
export const orgMembersTag = (orgId: string) => `org-members:org:${orgId}`;
```

Create `src/lib/org/queries-cached.ts`:

```ts
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { orgMembersTag } from "@/lib/cache/tags";
import type { OrgMember } from "@/lib/boards/queries";

/** Hot-path cap (AGENTS.md: bounded reads). org_members' PK is (org_id, user_id),
 * so the filter is index-covered. Truncates silently at the cap. */
export const ORG_MEMBERS_LIMIT = 500;

/**
 * Cached org member list (people pickers, owner maps, workload rows). `orgId`
 * is part of the cache key AND the tag; the explicit `org_id = orgId` filter is
 * the tenant boundary (the service client bypasses RLS). CALLER CONTRACT: pass
 * an orgId the current user is entitled to (their getUserOrgs() org, or the
 * org_id of a board/portfolio row they can read) — same contract as
 * `listDashboardsCached`.
 *
 * Matches `listOrgMembers`' RLS-read behavior 1:1 (two-query profiles join,
 * deactivated rows included) so migrating callers is not a behavior change.
 *
 * Invalidation: remove/deactivate/reactivateMember update `orgMembersTag`.
 * Invite redemption (`redeem_invitations` returns only a count) and future
 * profile display edits are TTL-covered by cacheLife("nav") (≤60 s stale) —
 * any future full_name/avatar edit action MUST updateTag(orgMembersTag(orgId))
 * for each of the user's orgs. If OrgMember ever grows a `role` field,
 * setMemberRole must be added to the invalidation set.
 */
export async function listOrgMembersCached(
  orgId: string,
): Promise<OrgMember[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(orgMembersTag(orgId));

  const supabase = createServiceClient();
  const { data: members, error: membersErr } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .limit(ORG_MEMBERS_LIMIT);
  if (membersErr || !members || members.length === 0) return [];

  const userIds = members.map((m) => m.user_id);
  // Two-query JS join: org_members → profiles has no declared FK (user_id
  // references auth.users), so the nested PostgREST embed does not typecheck.
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", userIds);
  if (profilesErr || !profiles) return [];

  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  return userIds.map((userId) => {
    const profile = profileMap.get(userId) ?? null;
    return {
      userId,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? null,
      avatarUrl: profile?.avatar_url ?? null,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/cache/tags.test.ts src/lib/org/queries-cached.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache/tags.ts src/lib/cache/tags.test.ts \
        src/lib/org/queries-cached.ts src/lib/org/queries-cached.test.ts
git commit -m "perf(org): add cached, bounded org member list" \
  -m "listOrgMembers is re-fetched fresh (two queries) on the board, portfolio,
goals, and workload pages. Add listOrgMembersCached(orgId): use cache +
cacheLife(nav) + orgMembersTag(orgId), service client with the explicit
org_id filter as the tenant boundary, bounded at 500. Callers migrate in a
follow-up task.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Invalidate `orgMembersTag` (+ target user's board tags) on membership changes

**Files:**

- Modify: `src/lib/org/admin-actions.ts` (`removeMember`, `deactivateMember`, `reactivateMember`)
- Test: `src/lib/org/admin-actions.test.ts`

**Interfaces:**

- Consumes: `orgMembersTag`, `boardsTag`, `sharedBoardsTag` from `@/lib/cache/tags` (Task 3 for `orgMembersTag`).
- Produces: no new exports — behavior only (later tasks' caches stay correct because of this task).

- [ ] **Step 1: Write the failing tests**

`src/lib/org/admin-actions.test.ts` already mocks `next/cache` with an `updateTag` spy (line 21-24). Add assertions to the existing success-path tests for the three actions (or add new cases following the file's arrange/act pattern):

```ts
it("removeMember invalidates the member list and the target's board caches", async () => {
  // arrange: reuse the file's existing successful-rpc mock setup for removeMember
  await removeMember({ orgId: "org-1", userId: "user-9" });
  expect(updateTag).toHaveBeenCalledWith("org-members:org:org-1");
  expect(updateTag).toHaveBeenCalledWith("boards:user:user-9");
  expect(updateTag).toHaveBeenCalledWith("shared-boards:user:user-9");
});

it("deactivateMember invalidates the member list and the target's board caches", async () => {
  await deactivateMember({ orgId: "org-1", userId: "user-9" });
  expect(updateTag).toHaveBeenCalledWith("org-members:org:org-1");
  expect(updateTag).toHaveBeenCalledWith("boards:user:user-9");
  expect(updateTag).toHaveBeenCalledWith("shared-boards:user:user-9");
});

it("reactivateMember invalidates the member list and the target's board caches", async () => {
  await reactivateMember({ orgId: "org-1", userId: "user-9" });
  expect(updateTag).toHaveBeenCalledWith("org-members:org:org-1");
  expect(updateTag).toHaveBeenCalledWith("boards:user:user-9");
  expect(updateTag).toHaveBeenCalledWith("shared-boards:user:user-9");
});
```

(`setMemberRole` intentionally does NOT invalidate — the cached payload carries no role. Add a negative assertion to its existing test: `expect(updateTag).not.toHaveBeenCalledWith("org-members:org:org-1");`)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/org/admin-actions.test.ts`
Expected: FAIL — `updateTag` not called with the new tags.

- [ ] **Step 3: Implement**

In `src/lib/org/admin-actions.ts`, extend the tags import:

```ts
import {
  boardsTag,
  orgAdminTag,
  orgMembersTag,
  sharedBoardsTag,
} from "@/lib/cache/tags";
```

In each of `removeMember`, `deactivateMember`, `reactivateMember`, directly after the existing `updateTag(orgAdminTag(parsed.data.userId, parsed.data.orgId));` line, add:

```ts
updateTag(orgMembersTag(parsed.data.orgId));
// The target's cached board lists (listMyBoardsCached / listSharedBoardsCached /
// listReadableBoardsCached all hang off these two tags) must drop immediately
// when their membership flips — don't wait out the nav TTL.
updateTag(boardsTag(parsed.data.userId));
updateTag(sharedBoardsTag(parsed.data.userId));
```

`setMemberRole`, `inviteMember`, `revokeInvite`, `resetMemberPassword` are unchanged (invites don't create memberships; redemption is TTL-covered per the spec decision).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/org/admin-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/org/admin-actions.ts src/lib/org/admin-actions.test.ts
git commit -m "fix(org): invalidate member + board caches on membership changes" \
  -m "remove/deactivate/reactivateMember now updateTag orgMembersTag(orgId) so
cached people pickers refresh instantly, plus the target user's boardsTag/
sharedBoardsTag so their cached board lists (incl. the upcoming readable-
boards cache) drop the org's boards without waiting out the nav TTL.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Bound `listReadableBoards` + `listReadableBoardsCached`

**Files:**

- Modify: `src/lib/portfolios/queries.ts:104-111` (`listReadableBoards`)
- Create: `src/lib/portfolios/queries-cached.ts`
- Test: `src/lib/portfolios/queries-cached.test.ts` (new); extend `src/lib/portfolios/queries.test.ts`

**Interfaces:**

- Consumes: `boardsTag`, `sharedBoardsTag` from `@/lib/cache/tags`; `createServiceClient`.
- Produces (later tasks rely on these exact names):
  - `listReadableBoardsCached(userId: string): Promise<{ id: string; name: string; workspaceId: string }[]>` (from `@/lib/portfolios/queries-cached`)
  - `READABLE_BOARDS_LIMIT = 500` (exported from `@/lib/portfolios/queries`, reused by the cached module)

- [ ] **Step 1: Write the failing tests**

Extend `src/lib/portfolios/queries.test.ts` with a bound assertion for the RLS variant (reuse the file's `makeChain`, which already records `limit` calls; add `eq`/`in` no-ops to the chain if missing):

```ts
import { listReadableBoards, READABLE_BOARDS_LIMIT } from "./queries";

it("listReadableBoards is bounded", async () => {
  await listReadableBoards();
  expect(limit).toHaveBeenCalledWith(READABLE_BOARDS_LIMIT);
});
```

Create `src/lib/portfolios/queries-cached.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// Three query shapes:
//  org_members:  select("org_id").eq("user_id", …).is("deactivated_at", null)
//  boards:       select(…).eq("created_by", …).in("org_id", …).limit(…)
//  board_members: select("boards!inner(…)").eq("user_id", …).limit(…)
const orgIs = vi.fn();
const orgEq = vi.fn(() => ({ is: orgIs }));
const orgSelect = vi.fn(() => ({ eq: orgEq }));

const ownLimit = vi.fn();
const ownIn = vi.fn(() => ({ limit: ownLimit }));
const ownEq = vi.fn(() => ({ in: ownIn }));
const ownSelect = vi.fn(() => ({ eq: ownEq }));

const sharedLimit = vi.fn();
const sharedEq = vi.fn(() => ({ limit: sharedLimit }));
const sharedSelect = vi.fn(() => ({ eq: sharedEq }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      table === "org_members"
        ? { select: orgSelect }
        : table === "boards"
          ? { select: ownSelect }
          : { select: sharedSelect },
  }),
}));

import { listReadableBoardsCached } from "./queries-cached";
import { READABLE_BOARDS_LIMIT } from "./queries";

beforeEach(() => {
  [
    orgSelect,
    orgEq,
    orgIs,
    ownSelect,
    ownEq,
    ownIn,
    ownLimit,
    sharedSelect,
    sharedEq,
    sharedLimit,
  ].forEach((m) => m.mockReset());
  orgEq.mockReturnValue({ is: orgIs });
  ownEq.mockReturnValue({ in: ownIn });
  ownIn.mockReturnValue({ limit: ownLimit });
  sharedEq.mockReturnValue({ limit: sharedLimit });
  orgSelect.mockReturnValue({ eq: orgEq });
  ownSelect.mockReturnValue({ eq: ownEq });
  sharedSelect.mockReturnValue({ eq: sharedEq });
});

describe("listReadableBoardsCached", () => {
  it("replicates the RLS policy: active membership + (creator OR grant), bounded, deduped, name-sorted", async () => {
    orgIs.mockResolvedValue({ data: [{ org_id: "org-1" }], error: null });
    ownLimit.mockResolvedValue({
      data: [
        { id: "b2", name: "Zeta", workspace_id: "ws1" },
        { id: "b1", name: "Alpha", workspace_id: "ws1" },
      ],
      error: null,
    });
    sharedLimit.mockResolvedValue({
      data: [
        // duplicate of an owned board + a granted board + a foreign-org grant
        {
          boards: {
            id: "b1",
            name: "Alpha",
            workspace_id: "ws1",
            org_id: "org-1",
          },
        },
        {
          boards: {
            id: "b3",
            name: "Mid",
            workspace_id: "ws2",
            org_id: "org-1",
          },
        },
        {
          boards: {
            id: "bX",
            name: "Foreign",
            workspace_id: "wsX",
            org_id: "org-OTHER",
          },
        },
      ],
      error: null,
    });

    const boards = await listReadableBoardsCached("u1");
    expect(orgEq).toHaveBeenCalledWith("user_id", "u1");
    expect(orgIs).toHaveBeenCalledWith("deactivated_at", null);
    expect(ownEq).toHaveBeenCalledWith("created_by", "u1");
    expect(ownIn).toHaveBeenCalledWith("org_id", ["org-1"]);
    expect(ownLimit).toHaveBeenCalledWith(READABLE_BOARDS_LIMIT);
    expect(sharedEq).toHaveBeenCalledWith("user_id", "u1");
    expect(sharedLimit).toHaveBeenCalledWith(READABLE_BOARDS_LIMIT);
    expect(boards).toEqual([
      { id: "b1", name: "Alpha", workspaceId: "ws1" },
      { id: "b3", name: "Mid", workspaceId: "ws2" },
      { id: "b2", name: "Zeta", workspaceId: "ws1" },
    ]);
  });

  it("returns [] for a user with no active org membership", async () => {
    orgIs.mockResolvedValue({ data: [], error: null });
    expect(await listReadableBoardsCached("u1")).toEqual([]);
    expect(ownSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/portfolios/queries.test.ts src/lib/portfolios/queries-cached.test.ts`
Expected: FAIL — `READABLE_BOARDS_LIMIT` not exported; `./queries-cached` module not found.

- [ ] **Step 3: Implement**

`src/lib/portfolios/queries.ts` — bound the RLS variant:

```ts
/** Hot-path cap (AGENTS.md: bounded reads). Truncates silently at the cap —
 * raise alongside pagination if a user's readable set ever approaches it. */
export const READABLE_BOARDS_LIMIT = 500;

/** Boards the current user can add to a portfolio (RLS already filters reads). */
export async function listReadableBoards(): Promise<
  { id: string; name: string; workspaceId: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("boards")
    .select("id, name, workspace_id")
    .order("name", { ascending: true })
    .limit(READABLE_BOARDS_LIMIT);
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    workspaceId: b.workspace_id,
  }));
}
```

Create `src/lib/portfolios/queries-cached.ts`:

```ts
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { boardsTag, sharedBoardsTag } from "@/lib/cache/tags";
import { READABLE_BOARDS_LIMIT } from "@/lib/portfolios/queries";

export type ReadableBoard = { id: string; name: string; workspaceId: string };

/**
 * Cached `listReadableBoards`. `userId` is read OUTSIDE this scope and passed in
 * (cache key). The service client bypasses RLS, so this REPLICATES the boards
 * read policy (20260621000000_board_access_require_membership_and_returning.sql)
 * by hand: readable = ACTIVE org member AND (creator OR board_members grant).
 * Any change to that policy must be mirrored here — the cross-tenant isolation
 * integration test is the tripwire.
 *
 * Tagged with the two EXISTING per-user tags, so every mutation that changes
 * this set already invalidates it with zero writer changes: board create/
 * delete/rename → boardsTag (boards/actions.ts); share/unshare →
 * sharedBoardsTag (sharing-actions.ts); membership removal/deactivation →
 * both (org/admin-actions.ts).
 */
export async function listReadableBoardsCached(
  userId: string,
): Promise<ReadableBoard[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(boardsTag(userId), sharedBoardsTag(userId));

  const supabase = createServiceClient();

  // Active memberships only — mirrors is_org_member's deactivated_at filter.
  const { data: orgRows } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .is("deactivated_at", null);
  const orgIds = (orgRows ?? []).map((r) => r.org_id);
  if (orgIds.length === 0) return [];

  const [own, shared] = await Promise.all([
    supabase
      .from("boards")
      .select("id, name, workspace_id")
      .eq("created_by", userId)
      .in("org_id", orgIds)
      .limit(READABLE_BOARDS_LIMIT),
    supabase
      .from("board_members")
      .select("boards!inner(id, name, workspace_id, org_id)")
      .eq("user_id", userId)
      .limit(READABLE_BOARDS_LIMIT),
  ]);

  const byId = new Map<string, ReadableBoard>();
  for (const b of own.data ?? []) {
    byId.set(b.id, { id: b.id, name: b.name, workspaceId: b.workspace_id });
  }
  for (const r of shared.data ?? []) {
    const b = r.boards;
    if (b && orgIds.includes(b.org_id)) {
      byId.set(b.id, { id: b.id, name: b.name, workspaceId: b.workspace_id });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
```

(If typecheck flags a `queries.ts` → `queries-cached.ts` import direction concern, note the dependency is one-way — cached imports the constant from queries — so there is no cycle.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/portfolios/queries.test.ts src/lib/portfolios/queries-cached.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolios/queries.ts src/lib/portfolios/queries.test.ts \
        src/lib/portfolios/queries-cached.ts src/lib/portfolios/queries-cached.test.ts
git commit -m "perf(portfolios): bound and cache the readable-boards read" \
  -m "listReadableBoards was an unbounded per-request select on /goals,
/portfolios/[id], and workload. Bound it (500) and add
listReadableBoardsCached(userId), which replicates the boards RLS policy
(active member AND creator-or-grant) over the service client and reuses the
existing boardsTag/sharedBoardsTag invalidation — zero writer changes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Migrate members callers to `listOrgMembersCached`; delete `listOrgMembers`

**Files:**

- Modify: `src/app/(app)/boards/[boardId]/page.tsx:3-7,31`
- Modify: `src/lib/goals/queries.ts:3,84` (`getGoalOwners`)
- Modify: `src/lib/workload/queries.ts:4,23` (`listOrgMembersForWorkload`)
- Modify: `src/lib/portfolios/queries.ts:2,76` (`getPortfolioRows`)
- Modify: `src/lib/boards/queries.ts:311-339` (delete `listOrgMembers`; KEEP the `OrgMember` type export)
- Test: existing suites (`src/lib/goals/queries.test.ts` mock updates, plus repo-wide grep)

**Interfaces:**

- Consumes: `listOrgMembersCached(orgId: string): Promise<OrgMember[]>` from `@/lib/org/queries-cached` (Task 3).
- Produces: no signature changes anywhere — `getGoalOwners`, `listOrgMembersForWorkload`, `getPortfolioRows` keep their exact signatures. `listOrgMembers` no longer exists; `OrgMember` still exports from `@/lib/boards/queries`.

- [ ] **Step 1: Swap the four call sites**

In each file, replace the `listOrgMembers` import with:

```ts
import { listOrgMembersCached } from "@/lib/org/queries-cached";
```

and the call `listOrgMembers(<orgId>)` with `listOrgMembersCached(<orgId>)` — the argument expressions stay exactly as they are (`payload.board.org_id`, `orgId`, `portfolio.org_id`). Each already satisfies the caller contract (an org the current user belongs to / a row RLS let them read).

In `src/app/(app)/boards/[boardId]/page.tsx` the import block becomes:

```ts
import { getBoardAccess, getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
```

- [ ] **Step 2: Delete the dead function**

Remove `listOrgMembers` (lines 311-339) from `src/lib/boards/queries.ts`, keeping the `OrgMember` type and its doc comment (move the "two-query JS join" note onto `listOrgMembersCached` — Task 3 already carries it). Then prove it's dead:

Run: `pnpm exec rg -n "listOrgMembers\b" src --glob '!**/queries-cached*'`
Expected: no hits outside `@/lib/org/queries-cached` imports (`listOrgMembersCached` contains the substring — check matches are only the cached name; adjust mocks in `src/lib/goals/queries.test.ts` and `src/lib/portfolios/queries.test.ts` from `vi.mock("@/lib/boards/queries", …)` to `vi.mock("@/lib/org/queries-cached", () => ({ listOrgMembersCached: vi.fn(async () => []) }))`).

- [ ] **Step 3: Typecheck + run the touched suites**

Run: `pnpm typecheck && pnpm vitest run src/lib/goals src/lib/portfolios src/lib/workload src/lib/boards/queries.test.ts`
Expected: PASS (note: a cold `pnpm typecheck` can fail on `cacheLife("nav")` `.next/types` until a build has run — if you hit that, run `pnpm build` once first; it's a known non-break).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/boards/\[boardId\]/page.tsx src/lib/goals/queries.ts \
        src/lib/goals/queries.test.ts src/lib/workload/queries.ts \
        src/lib/portfolios/queries.ts src/lib/portfolios/queries.test.ts \
        src/lib/boards/queries.ts
git commit -m "perf(queries): serve org members from the cached read everywhere" \
  -m "Migrate the board page, goal owners, workload, and portfolio rollup to
listOrgMembersCached — the fresh two-query members fetch on every request
becomes a nav-profile cache hit, and the portfolio page's duplicate fetch
dedups on the shared cache key. Delete the now-dead listOrgMembers (the
OrgMember type stays).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Migrate readable-boards callers (`/goals`, workload)

**Files:**

- Modify: `src/app/(app)/goals/page.tsx:2-7,14-19`
- Modify: `src/lib/workload/queries.ts:5,184`
- Modify: `src/lib/goals/queries.ts:9-12` (re-export surface)

**Interfaces:**

- Consumes: `listReadableBoardsCached(userId)` from `@/lib/portfolios/queries-cached` (Task 5); `requireUser()` from `@/lib/auth/session` (returns the user with `.id`); `getUserOrgs()` already used in `getWorkloadPageData`.
- Produces: no signature changes. `src/lib/goals/queries.ts` re-exports `listReadableBoardsCached` alongside the existing `getBoardStatusColumns` re-export.

- [ ] **Step 1: `/goals` page**

In `src/app/(app)/goals/page.tsx`, capture the user (identity read outside the cache) and swap the read:

```ts
const user = await requireUser();
const [tree, ownerMap, boards, linkMap] = await Promise.all([
  getGoalsTree(),
  getGoalOwners(),
  listReadableBoardsCached(user.id),
  getGoalLinks(),
]);
```

Update the goals re-export surface in `src/lib/goals/queries.ts` so the page keeps importing from one place:

```ts
export {
  getBoardStatusColumns,
  listReadableBoards,
} from "@/lib/portfolios/queries";
export { listReadableBoardsCached } from "@/lib/portfolios/queries-cached";
```

(If after this task `listReadableBoards` has no importers left anywhere — check with `rg -n "listReadableBoards\b" src` excluding the cached name — delete the RLS variant and its re-export; if the goals drawer/actions still use it, leave it, it's bounded now.)

- [ ] **Step 2: Workload**

In `src/lib/workload/queries.ts` `getWorkloadPageData`, replace the import of `listReadableBoards` from `@/lib/portfolios/queries` with `listReadableBoardsCached` from `@/lib/portfolios/queries-cached`, and in the `Promise.all` replace `listReadableBoards()` with `listReadableBoardsCached(userId)`. `getWorkloadPageData` already resolves `getUserOrgs()` before the `Promise.all`; it needs the user id as well — read it the same way the shell does:

```ts
import { getUser, getUserOrgs } from "@/lib/auth/session";
// …
const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
const userId = user?.id ?? "";
const orgId = orgs[0]?.id ?? "";
```

(`listReadableBoardsCached("")` returns `[]` via the no-membership guard — same failure shape as today's RLS empty read.)

- [ ] **Step 3: Typecheck + test + commit**

Run: `pnpm typecheck && pnpm vitest run src/lib/workload src/lib/goals`
Expected: PASS.

```bash
git add src/app/\(app\)/goals/page.tsx src/lib/workload/queries.ts src/lib/goals/queries.ts
git commit -m "perf(goals,workload): serve readable boards from the cached read" \
  -m "The /goals page and workload page data re-fetched the user's readable
boards on every request; both now hit listReadableBoardsCached keyed on the
session user id (identity read outside the cache scope, 9.3 pattern).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Parallelize `/portfolios/[portfolioId]` (F7)

**Files:**

- Modify: `src/lib/portfolios/queries.ts:48-82` (`getPortfolioRows`)
- Modify: `src/app/(app)/portfolios/[portfolioId]/page.tsx`
- Test: extend `src/lib/portfolios/queries.test.ts`

**Interfaces:**

- Consumes: `listOrgMembersCached` (Task 3, already wired into `getPortfolioRows` by Task 6), `listReadableBoardsCached` (Task 5), `requireUser()` returning the user object.
- Produces: `getPortfolioRows(portfolioId)` signature unchanged (`Promise<PortfolioRowsResult | null>`).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/portfolios/queries.test.ts` a waterfall regression for `getPortfolioRows` (mock `@/lib/org/queries-cached` and the supabase client; record call order):

```ts
import { getPortfolioRows } from "./queries";

it("fires portfolio, placements, and rollup concurrently (single stage before members)", async () => {
  const order: string[] = [];
  // chain that records which table/rpc resolved and in what tick
  // portfolio (maybeSingle) resolves on a deferred promise; placements/rollup
  // must have been INITIATED before it resolves:
  let releasePortfolio!: () => void;
  const portfolioGate = new Promise<void>((r) => (releasePortfolio = r));
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            await portfolioGate;
            order.push("portfolio");
            return {
              data: { id: "p1", org_id: "org-1", name: "P" },
              error: null,
            };
          },
          order: () => {
            order.push(`start:${table}`);
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    }),
    rpc: (name: string) => {
      order.push(`start:${name}`);
      return Promise.resolve({ data: [], error: null });
    },
  };
  createClient.mockResolvedValue(client as never);
  const pending = getPortfolioRows("p1");
  await Promise.resolve(); // flush microtasks so parallel starts are recorded
  releasePortfolio();
  await pending;
  expect(order.filter((e) => e.startsWith("start:"))).toEqual(
    expect.arrayContaining([
      "start:portfolio_boards",
      "start:portfolio_rollup",
    ]),
  );
  expect(order.indexOf("start:portfolio_rollup")).toBeLessThan(
    order.indexOf("portfolio"),
  );
});
```

(Adapt the chain shape to the file's existing `makeChain` helper if easier — the load-bearing assertion is that `portfolio_boards`/`portfolio_rollup` START before the portfolio read RESOLVES.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/portfolios/queries.test.ts`
Expected: FAIL — with today's code, placements/rollup only start after `getPortfolio` resolves.

- [ ] **Step 3: Implement**

`getPortfolioRows` — one `Promise.all` for the three portfolio-id-keyed reads (RLS returns empty/null for invisible rows, so firing placements/rollup before the existence check is safe; they're discarded on the 404 path, which is cold):

```ts
export async function getPortfolioRows(
  portfolioId: string,
): Promise<PortfolioRowsResult | null> {
  const supabase = await createClient();
  const today = serverToday(Date.now());

  const [portfolio, placementsRes, rollupRes] = await Promise.all([
    getPortfolio(portfolioId),
    supabase
      .from("portfolio_boards")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .order("position", { ascending: true }),
    supabase.rpc("portfolio_rollup", {
      p_portfolio_id: portfolioId,
      p_today: today,
    }),
  ]);
  if (!portfolio) return null;

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

  const members = await listOrgMembersCached(portfolio.org_id);
  const owners = new Map<string, RowOwner>(
    members.map((m) => [
      m.userId,
      { userId: m.userId, fullName: m.fullName, avatarUrl: m.avatarUrl },
    ]),
  );

  return { portfolio, rows: mergeRows(placements, rollups, owners, today) };
}
```

`src/app/(app)/portfolios/[portfolioId]/page.tsx` — two stages, cached members dedup:

```tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getPortfolioRows } from "@/lib/portfolios/queries";
import { listReadableBoardsCached } from "@/lib/portfolios/queries-cached";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { PortfolioGrid } from "@/components/portfolios/PortfolioGrid";

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ portfolioId: string }>;
}) {
  const { portfolioId } = await params;
  const user = await requireUser();

  // Stage 1: everything keyed on portfolioId / userId, concurrent.
  const [result, addableBoards] = await Promise.all([
    getPortfolioRows(portfolioId),
    listReadableBoardsCached(user.id),
  ]);
  if (!result) notFound();

  // Stage 2: same use-cache key getPortfolioRows just resolved → warm hit,
  // not a second Supabase round-trip (this used to be a duplicate fresh fetch).
  const members = await listOrgMembersCached(result.portfolio.org_id);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <h1 className="text-base font-semibold">{result.portfolio.name}</h1>
      </div>
      <div className="min-h-0 flex-1">
        <PortfolioGrid
          portfolioId={portfolioId}
          rows={result.rows}
          members={members.map((m) => ({
            userId: m.userId,
            fullName: m.fullName,
            avatarUrl: m.avatarUrl,
          }))}
          addableBoards={addableBoards.map((b) => ({ id: b.id, name: b.name }))}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm typecheck && pnpm vitest run src/lib/portfolios`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolios/queries.ts src/lib/portfolios/queries.test.ts \
        src/app/\(app\)/portfolios/\[portfolioId\]/page.tsx
git commit -m "perf(portfolios): collapse the portfolio page await waterfall" \
  -m "getPortfolioRows now fires the portfolio, placements, and rollup reads in
one Promise.all (all keyed on portfolioId; RLS keeps the not-found path
safe), and the page runs it concurrently with the cached readable-boards
read. The members read dedups on the cache key getPortfolioRows already
warmed — previously a duplicate fresh fetch. Three await stages become two.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `/dashboards` index reuses `listDashboardsCached`; delete `listDashboards`; bound the cached list

**Files:**

- Modify: `src/app/(app)/dashboards/page.tsx`
- Modify: `src/lib/dashboards/queries.ts:15-23` (delete `listDashboards`)
- Modify: `src/lib/dashboards/queries-cached.ts:14-28` (add limit)
- Test: `src/lib/dashboards/queries-cached.test.ts`, `src/lib/dashboards/queries.test.ts` (no change needed — it only covers `getDashboardPayload`; verify)

**Interfaces:**

- Consumes: `listDashboardsCached(orgId)` (existing), `getUserOrgs()` from `@/lib/auth/session`.
- Produces: `DASHBOARDS_LIMIT = 100` exported from `@/lib/dashboards/queries-cached`. `listDashboards` no longer exists.

- [ ] **Step 1: Write the failing test**

In `src/lib/dashboards/queries-cached.test.ts`, the `listDashboardsCached` chain is `select().eq().order()`; extend it with a `limit` recorder (add `limit` after `order` in the mock chain: `const orderForList = vi.fn(() => ({ limit: limitForList }));` with `const limitForList = vi.fn();`) and assert:

```ts
it("is bounded", async () => {
  limitForList.mockResolvedValue({ data: [], error: null });
  await listDashboardsCached("org-A");
  expect(limitForList).toHaveBeenCalledWith(DASHBOARDS_LIMIT);
});
```

(The two existing `listDashboardsCached` tests move their `mockResolvedValue` from `orderForList` to `limitForList`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/dashboards/queries-cached.test.ts`
Expected: FAIL — `DASHBOARDS_LIMIT` not exported / `limit` not in the chain.

- [ ] **Step 3: Implement**

`src/lib/dashboards/queries-cached.ts`:

```ts
/** Hot-path cap (AGENTS.md: bounded reads over dashboards_org_id_idx). */
export const DASHBOARDS_LIMIT = 100;
```

and append `.limit(DASHBOARDS_LIMIT)` to the query in `listDashboardsCached`.

`src/app/(app)/dashboards/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getUserOrgs } from "@/lib/auth/session";
import { listDashboardsCached } from "@/lib/dashboards/queries-cached";

export default async function DashboardsIndex() {
  // Identity read OUTSIDE the cache (9.3 rule); the sidebar calls
  // listDashboardsCached with the same key, so this is a warm hit.
  const orgs = await getUserOrgs();
  const orgId = orgs[0]?.id;
  const dashboards = orgId ? await listDashboardsCached(orgId) : [];
  if (dashboards.length > 0) redirect(`/dashboards/${dashboards[0].id}`);
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-12 text-sm">
      No dashboards yet. Create one from the sidebar.
    </div>
  );
}
```

Delete `listDashboards` from `src/lib/dashboards/queries.ts` (lines 15-23). Prove it's dead:

Run: `pnpm exec rg -n "listDashboards\b" src`
Expected: only `listDashboardsCached` matches remain (check word-boundary hits carefully).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm typecheck && pnpm vitest run src/lib/dashboards`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboards/page.tsx src/lib/dashboards/queries.ts \
        src/lib/dashboards/queries-cached.ts src/lib/dashboards/queries-cached.test.ts
git commit -m "perf(dashboards): index page reuses the cached, now-bounded list" \
  -m "The /dashboards index ran its own unbounded select * just to pick a
redirect target. Reuse listDashboardsCached(orgId) — warm from the sidebar's
identical key, invalidated by the existing dashboardsTag writers — bound it
at 100, and delete the dead uncached listDashboards.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Cross-tenant isolation coverage for the two new service-client reads

**Files:**

- Modify: `src/lib/cache/cross-tenant-isolation.integration.test.ts`

**Interfaces:**

- Consumes: `listOrgMembersCached` (Task 3), `listReadableBoardsCached` (Task 5); the file's existing two-tenant `provision()` fixture (`a`, `b` with `id`, `orgId`, `boardId`).
- Produces: nothing — safety net only.

- [ ] **Step 1: Add the two isolation tests**

Append inside the existing `describe` (reusing tenants `a` and `b`; both users are members of their own org via `create_organization`):

```ts
it("org A's cached members exclude org B's user (and vice versa)", async () => {
  const { listOrgMembersCached } = await import("@/lib/org/queries-cached");
  const aMembers = await listOrgMembersCached(a.orgId);
  const bMembers = await listOrgMembersCached(b.orgId);

  const aIds = aMembers.map((m) => m.userId);
  const bIds = bMembers.map((m) => m.userId);
  expect(aIds).toContain(a.id);
  expect(aIds).not.toContain(b.id);
  expect(bIds).toContain(b.id);
  expect(bIds).not.toContain(a.id);
});

it("user A's cached readable boards exclude user B's boards (and vice versa)", async () => {
  const { listReadableBoardsCached } =
    await import("@/lib/portfolios/queries-cached");
  const aBoards = await listReadableBoardsCached(a.id);
  const bBoards = await listReadableBoardsCached(b.id);

  const aIds = aBoards.map((x) => x.id);
  const bIds = bBoards.map((x) => x.id);
  expect(aIds).toContain(a.boardId);
  expect(aIds).not.toContain(b.boardId);
  expect(bIds).toContain(b.boardId);
  expect(bIds).not.toContain(a.boardId);
});
```

- [ ] **Step 2: Run (skips cleanly without an integration target; runs it when configured)**

Run: `pnpm vitest run src/lib/cache/cross-tenant-isolation.integration.test.ts`
Expected: PASS (or `skipped` when `integrationTargetReady()` is false — the suite self-skips; note integration tests are known-flaky under auth rate limits, retry once before investigating).

- [ ] **Step 3: Commit**

```bash
git add src/lib/cache/cross-tenant-isolation.integration.test.ts
git commit -m "test(cache): prove the new cached reads never cross tenants" \
  -m "listOrgMembersCached and listReadableBoardsCached use the service client
with hand-rolled tenant filters, so both join the Phase 9.3 headline
isolation suite: two provisioned tenants, each read must return only the
caller-identity's rows.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Full gates + bundle verification

**Files:** none (verification only; fix-forward anything red).

**Interfaces:**

- Consumes: everything above.
- Produces: evidence for the completion claim (verification-before-completion).

- [ ] **Step 1: Run the four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. (Known repo gotchas: cold typecheck may need a prior `pnpm build` for `.next/types`; if `pnpm build` fails with module-not-found on a dep another session added, run `pnpm install` and retry.)

- [ ] **Step 2: Verify the recharts split in the build output**

In the `pnpm build` route table, confirm the dashboards route's First Load JS dropped relative to `develop` (recharts now lives in an async chunk). Quick check:

Run: `pnpm exec rg -l "recharts" .next/server/chunks --max-count 1 2>/dev/null || true` — presence in an async chunk is fine; the load-bearing check is the route-table delta plus Task 1's static-import guard test.

- [ ] **Step 3: Commit any straggler fixes (own files only), then stop**

Per the working agreement this branch then goes through `scripts/finish-task.sh` (rebase onto develop, gates against merged state, merge, cleanup) — that is the executing session's closure step, not part of this plan's tasks.

---

## Execution DAG

**Interfaces recap (edge list):** T4 consumes T3's tag; T5 is file-serialized after T2 (both edit `src/lib/portfolios/queries.ts`); T6 consumes T3's wrapper and edits files T2/T5 touched; T7 consumes T5 and edits `workload/queries.ts` after T6 does; T8 consumes T3+T5+T6 (restructures the function T6 migrated); T9 independent; T10 consumes T3+T5; T11 consumes all.

**Dependency graph:**

```
T1  ─────────────────────────────┐
T2 ──► T5 ──► T7 ────────────────┤
  └──────┐      ▲                │
T3 ──► T4 │     │                ├──► T11
  └──► T6 ┴──► T8                │
T3,T5 ──► T10 ───────────────────┤
T9  ─────────────────────────────┘
```

- T5 depends on T2 (shared file `portfolios/queries.ts`)
- T4 depends on T3
- T6 depends on T2, T3, T5 (shared files `goals/queries.ts`, `portfolios/queries.ts`)
- T7 depends on T5, T6 (shared file `workload/queries.ts`)
- T8 depends on T5, T6
- T10 depends on T3, T5
- T11 depends on all

**Parallel batches** (each wave = one dispatch of concurrent agents; ≥2 tasks in a wave → use `superpowers:dispatching-parallel-agents` / parallel subagent-driven subagents; all waves run inside this one task worktree, so waves are also file-disjoint by construction):

| Wave | Tasks              | Why safe together                                                                                                 |
| ---- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 1    | **T1, T2, T3, T9** | fully disjoint file sets (dashboards component / portfolios+goals queries / cache+org / dashboards pages+queries) |
| 2    | **T4, T5**         | T4 touches `org/admin-actions.*` only; T5 touches `portfolios/queries*` only                                      |
| 3    | **T6, T10**        | T6 touches caller files; T10 touches only the integration test file                                               |
| 4    | **T7, T8**         | T7: goals page + workload; T8: portfolios queries/page — disjoint                                                 |
| 5    | **T11**            | global gates                                                                                                      |

**Critical path:** T2 → T5 → T6 → T8 → T11 (5 tasks; wall-clock floor ≈ 5 sequential task cycles; the other 6 tasks absorb into the waves).

---

## Performance & data-fetching budget (restated from spec — the plan must hold these)

- **First paint:** `/dashboards` index 0 new reads warm (1 bounded cold); portfolio page 2 await stages (was 3 + a duplicate members fetch); goals/board/workload members + readable-boards become `nav`-profile cache hits; dashboards route First Load JS −~35 KB gzip when no chart mounts.
- **Interactions:** zero changes — no interaction gains a server round-trip; all mutations stay Server Actions with targeted `updateTag` (matrices in spec).
- **Bounds over indexes:** members 500 (`org_members` PK), readable boards 500 (`boards_created_by_idx`/`board_members` PK), portfolios 200 (`portfolios_org_id_idx` via RLS), goals 1000 (`goals_org_id_idx`), links 2000 (`goal_links_goal_id_idx`), dashboards 100 (`dashboards_org_id_idx`).
