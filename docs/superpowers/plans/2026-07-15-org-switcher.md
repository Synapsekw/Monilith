# Org Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give multi-org users a sidebar org switcher whose selection persists and drives every org-scoped read/write, replacing the ~30 hardcoded `orgs[0]` / `(await getUserOrgs())[0]` call sites with a single active-org resolver.

**Architecture:** Mirror the existing workspace-switcher trio. A cookie (`pulse_active_org`) holds the selection; `resolveActiveOrg()` intersects it against `getUserOrgs()` (RLS-scoped — membership re-verified every read, cookie never trusted) and falls back to `orgs[0]`, so the migration is **behavior-preserving** for single-org users and each call-site swap is independently shippable. No DB migration; org-keyed caches self-select so a switch is just a Server Action + `router.refresh()`.

**Tech Stack:** Next.js 16 (App Router, async `cookies()`, Server Actions), React 19 (`cache()`, `useTransition`), Supabase RLS, Vitest + Testing Library, Tailwind v4 / shadcn.

**Spec:** `docs/superpowers/specs/2026-07-15-org-switcher-design.md`

---

## File Structure

| File                                         | Responsibility                                                                    | New/Modify |
| -------------------------------------------- | --------------------------------------------------------------------------------- | ---------- |
| `src/lib/org/active.ts`                      | `ACTIVE_ORG_COOKIE`, `pickActiveOrg` (pure), `resolveActiveOrg`, `getActiveOrgId` | New        |
| `src/lib/org/active-actions.ts`              | `setActiveOrg` server action                                                      | New        |
| `src/components/shell/org-switcher.tsx`      | Sidebar dropdown UI                                                               | New        |
| `src/lib/org/active.test.ts`                 | Unit tests for pick/resolve                                                       | New        |
| `src/lib/org/active-actions.test.ts`         | Action tests                                                                      | New        |
| `src/components/shell/org-switcher.test.tsx` | Component tests                                                                   | New        |
| `src/components/shell/sidebar-nav-data.tsx`  | Resolve active org; pass switcher props                                           | Modify     |
| `src/components/shell/sidebar-nav.tsx`       | Render `<OrgSwitcher>` above `<WorkspaceSwitcher>`                                | Modify     |
| 20 further call sites (see Task groups 4–7)  | Swap `orgs[0]` → resolver                                                         | Modify     |

---

## Execution DAG (working agreement #6)

```
Batch 0 (foundation — must land first, strictly sequential within):
  T1 pickActiveOrg + resolveActiveOrg + getActiveOrgId
  T2 setActiveOrg action           (depends: T1)

Batch 1 (UI + shell reads — depends on Batch 0; run T3 & T4 in parallel):
  T3 OrgSwitcher component                       (depends: T2)
  T4 sidebar-nav-data + sidebar-nav wiring       (depends: T1, T3)  ← T4 needs T3's component

Batch 2 (call-site migration — depends on T1; 4 fully-independent parallel groups,
         each its own worktree per agreement #1 to avoid clobbering `develop`):
  T5 pages group        (home, dashboards, settings⚠)      (depends: T1)
  T6 lib-non-AI group   (guard, goals, user-timezone, time, workspaces, workload) (depends: T1)
  T7 AI-subtree group   (10 files under src/lib/ai)        (depends: T1)
  T8 command-palette-data                                  (depends: T1)

Batch 3 (verification — depends on ALL):
  T9 full-gate + manual E2E on DEV
```

- **Dependency edges:** T2→T1; T3→T2; T4→{T1,T3}; T5,T6,T7,T8→T1; T9→all.
- **Parallel waves:** Batch 0 is the critical path head (T1→T2). Once T1 lands, T5/T6/T7/T8 can all run concurrently (disjoint file sets). T3 then T4 run alongside them.
- **Critical path (wall-clock floor):** T1 → T2 → T3 → T4 → T9. The call-site groups are wide but shallow and overlap the UI path.
- **Conflict isolation:** T5/T6/T7/T8 touch disjoint files, but if run by parallel agents give each its own git worktree (agreement #1). **T5 owns `settings/page.tsx`, which the parallel notification-prefs work also edits — land T5 after notif-prefs merges, or rebase (spec §10 Q3).**

---

## Task 1: Active-org resolver (`src/lib/org/active.ts`)

**Files:**

- Create: `src/lib/org/active.ts`
- Test: `src/lib/org/active.test.ts`

- [ ] **Step 1: Write failing unit tests for the pure core**

```ts
// src/lib/org/active.test.ts
import { describe, it, expect } from "vitest";
import { pickActiveOrg } from "./active";
import type { UserOrg } from "@/lib/auth/session";

const orgs: UserOrg[] = [
  { id: "a", name: "Alpha", timezone: "UTC" },
  { id: "b", name: "Beta", timezone: "UTC" },
];

describe("pickActiveOrg", () => {
  it("returns the cookie-matched org", () => {
    expect(pickActiveOrg(orgs, "b")?.id).toBe("b");
  });
  it("falls back to orgs[0] when cookie is absent", () => {
    expect(pickActiveOrg(orgs, undefined)?.id).toBe("a");
  });
  it("falls back to orgs[0] when cookie is foreign/stale", () => {
    expect(pickActiveOrg(orgs, "zzz")?.id).toBe("a");
  });
  it("returns null for an empty org list", () => {
    expect(pickActiveOrg([], "a")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/lib/org/active.test.ts`
Expected: FAIL — `pickActiveOrg` is not exported / module missing.

- [ ] **Step 3: Implement `src/lib/org/active.ts`**

```ts
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getUserOrgs, type UserOrg } from "@/lib/auth/session";

/** Persisted "current organization" selection. UX only — RLS + getUserOrgs()
 * remain the security boundary; the cookie is re-validated on every read. */
export const ACTIVE_ORG_COOKIE = "pulse_active_org";

/**
 * The active org: the cookie value when it still matches one of the user's
 * orgs, otherwise the first org (stable default), otherwise null. Validating
 * against the list means a deleted/foreign id can never scope the app to a
 * tenant the user doesn't belong to. Mirrors getActiveWorkspaceId.
 */
export function pickActiveOrg(
  orgs: UserOrg[],
  cookieValue: string | undefined,
): UserOrg | null {
  if (cookieValue) {
    const match = orgs.find((o) => o.id === cookieValue);
    if (match) return match;
  }
  return orgs[0] ?? null;
}

/**
 * Resolve the active org for the current request. React cache()-wrapped so the
 * sidebar, command palette, page, and guards in one render share one resolve.
 * getUserOrgs() is RLS-scoped (== membership verified) and throws on DB error;
 * we let that propagate (a transient error is not "no org").
 */
export const resolveActiveOrg = cache(async (): Promise<UserOrg | null> => {
  const orgs = await getUserOrgs();
  const raw = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  return pickActiveOrg(orgs, raw);
});

/** Convenience: the active org id, or "" when the user has no org. */
export async function getActiveOrgId(): Promise<string> {
  return (await resolveActiveOrg())?.id ?? "";
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run src/lib/org/active.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add a resolver integration test (mock `getUserOrgs` + `cookies`)**

Append to `src/lib/org/active.test.ts`:

```ts
import { vi } from "vitest";

vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  getUserOrgs: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { getUserOrgs } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { resolveActiveOrg, getActiveOrgId } from "./active";

function withCookie(value: string | undefined) {
  (cookies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: () => (value ? { value } : undefined),
  });
}

describe("resolveActiveOrg", () => {
  it("returns the cookie-matched org", async () => {
    (getUserOrgs as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      orgs,
    );
    withCookie("b");
    expect((await resolveActiveOrg())?.id).toBe("b");
    expect(await getActiveOrgId()).toBe("b");
  });
});
```

> Note: `resolveActiveOrg` is `cache()`-wrapped. `react`'s `cache` dedupes only
> within a request; across Vitest test cases it re-runs, but if a stale value is
> observed, wrap the assertion body so each `it` gets fresh mocks, or import the
> module fresh via `vi.resetModules()`. Keep the pure `pickActiveOrg` as the
> primary coverage; this test guards the wiring.

- [ ] **Step 6: Run, verify pass, commit**

Run: `pnpm vitest run src/lib/org/active.test.ts`
Expected: PASS.

```bash
git add src/lib/org/active.ts src/lib/org/active.test.ts
git commit -m "feat(org): active-org resolver (pickActiveOrg/resolveActiveOrg/getActiveOrgId)"
```

---

## Task 2: `setActiveOrg` server action

**Files:**

- Create: `src/lib/org/active-actions.ts`
- Test: `src/lib/org/active-actions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/org/active-actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set })) }));
vi.mock("@/lib/auth/session", () => ({ getUserOrgs: vi.fn() }));

import { cookies } from "next/headers";
import { getUserOrgs } from "@/lib/auth/session";
import { setActiveOrg } from "./active-actions";
import { ACTIVE_ORG_COOKIE } from "./active";

beforeEach(() => set.mockClear());

describe("setActiveOrg", () => {
  it("sets the cookie for an org the user belongs to", async () => {
    (getUserOrgs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "a" },
      { id: "b" },
    ]);
    await setActiveOrg("b");
    expect(set).toHaveBeenCalledWith(
      ACTIVE_ORG_COOKIE,
      "b",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });
  it("ignores a foreign org id (does not set the cookie)", async () => {
    (getUserOrgs as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "a" }]);
    await setActiveOrg("zzz");
    expect(set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm vitest run src/lib/org/active-actions.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/lib/org/active-actions.ts
"use server";
import { cookies } from "next/headers";
import { getUserOrgs } from "@/lib/auth/session";
import { ACTIVE_ORG_COOKIE } from "./active";

/**
 * Switch the active organization. Sets the cookie only — the caller triggers a
 * `router.refresh()` so the streamed shell re-renders scoped to the new org.
 * No revalidateTag: org caches (dashboards/workspaces/…) are keyed by org id, so
 * a switch simply hits a different cache entry. Membership is re-verified here as
 * defense-in-depth (reads also re-verify via resolveActiveOrg).
 */
export async function setActiveOrg(orgId: string): Promise<void> {
  const orgs = await getUserOrgs();
  if (!orgs.some((o) => o.id === orgId)) return;
  const jar = await cookies();
  jar.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm vitest run src/lib/org/active-actions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/org/active-actions.ts src/lib/org/active-actions.test.ts
git commit -m "feat(org): setActiveOrg server action (membership-checked cookie)"
```

---

## Task 3: OrgSwitcher component

> **Load the `pulse-ui` and `frontend-design` skills before editing** (agreement #3), even though styling is copied from the workspace switcher.

**Files:**

- Create: `src/components/shell/org-switcher.tsx`
- Test: `src/components/shell/org-switcher.test.tsx`
- Reference: `src/components/shell/workspace-switcher.tsx` (copy structure)

- [ ] **Step 1: Write failing component tests**

```tsx
// src/components/shell/org-switcher.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrgSwitcher } from "./org-switcher";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const setActiveOrg = vi.fn();
vi.mock("@/lib/org/active-actions", () => ({
  setActiveOrg: (id: string) => setActiveOrg(id),
}));

const orgs = [
  { id: "a", name: "Alpha", timezone: "UTC" },
  { id: "b", name: "Beta", timezone: "UTC" },
];

describe("OrgSwitcher", () => {
  it("renders nothing for a single-org user", () => {
    const { container } = render(
      <OrgSwitcher orgs={[orgs[0]]} activeOrgId="a" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists orgs and switches on select", async () => {
    render(<OrgSwitcher orgs={orgs} activeOrgId="a" />);
    await userEvent.click(
      screen.getByRole("button", { name: /switch organization/i }),
    );
    await userEvent.click(screen.getByText("Beta"));
    expect(setActiveOrg).toHaveBeenCalledWith("b");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm vitest run src/components/shell/org-switcher.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement (adapt `workspace-switcher.tsx`)**

Copy `src/components/shell/workspace-switcher.tsx` and change: prop names
(`orgs`/`activeOrgId`), the empty guard to `if (orgs.length <= 1) return null;`,
`aria-label="Switch organization"`, the label text to "Organizations", call
`setActiveOrg`, and **remove** the "New workspace" / "Manage workspaces" items
(no org-creation from the switcher — spec §6). Full component:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";
import { setActiveOrg } from "@/lib/org/active-actions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Org = { id: string; name: string };

export function OrgSwitcher({
  orgs,
  activeOrgId,
  collapsed = false,
}: {
  orgs: Org[];
  activeOrgId: string;
  collapsed?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const active = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  const initial = (active?.name ?? "?").charAt(0).toUpperCase();

  function switchTo(id: string) {
    if (id === activeOrgId) return;
    startTransition(async () => {
      await setActiveOrg(id);
      router.refresh();
    });
  }

  if (orgs.length <= 1) return null;

  const avatar = (
    <span className="bg-primary/[0.18] text-primary flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
      {initial}
    </span>
  );

  return (
    <div className={cn("px-2 pt-2", collapsed ? "flex justify-center" : "")}>
      <DropdownMenu>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger
                aria-label="Switch organization"
                className="bg-surface-muted border-border card-lift hover:border-border-bright flex size-9 items-center justify-center rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
              >
                {avatar}
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{active?.name}</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger
            aria-label="Switch organization"
            className="bg-surface-muted border-border card-lift hover:border-border-bright flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
          >
            {avatar}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {active?.name}
            </span>
            <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
          </DropdownMenuTrigger>
        )}

        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            Organizations
          </DropdownMenuLabel>
          {orgs.map((o) => (
            <DropdownMenuItem
              key={o.id}
              onSelect={() => switchTo(o.id)}
              className="gap-2"
            >
              <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded text-[10px] font-semibold">
                {o.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              {o.id === activeOrgId ? (
                <Check className="text-primary size-4 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm vitest run src/components/shell/org-switcher.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/org-switcher.tsx src/components/shell/org-switcher.test.tsx
git commit -m "feat(org): OrgSwitcher sidebar dropdown (hidden for single-org users)"
```

---

## Task 4: Wire the switcher into the sidebar

**Files:**

- Modify: `src/components/shell/sidebar-nav-data.tsx`
- Modify: `src/components/shell/sidebar-nav.tsx`
- Test: `src/components/shell/sidebar-nav-data.test.tsx` (extend), `src/components/shell/sidebar-nav.test.tsx` (extend)

- [ ] **Step 1: Update `getSidebarNavData` to resolve the active org and pass switcher props**

In `sidebar-nav-data.tsx`, add the import and change the org resolution:

```ts
import { resolveActiveOrg } from "@/lib/org/active";
```

Replace lines ~17-24:

```ts
const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
const userId = user?.id ?? "";
const activeOrg = await resolveActiveOrg(); // cache-deduped with getUserOrgs above
const orgId = activeOrg?.id ?? "";

// Workspaces first: the active-workspace cookie is validated against this list
// (and self-heals if it points at a workspace in a different org).
const workspaces = await listWorkspacesCached(orgId);
const activeWorkspaceId = await getActiveWorkspaceId(workspaces);
```

And extend the returned object with `orgs` + `activeOrgId: orgId`:

```ts
return {
  orgs,
  activeOrgId: orgId,
  boards,
  sharedBoards,
  workspaces,
  activeWorkspaceId,
  dashboards: dashboards.map((d) => ({ id: d.id, name: d.name })),
};
```

- [ ] **Step 2: Add `orgs`/`activeOrgId` to `SidebarNav` props and render `<OrgSwitcher>`**

In `sidebar-nav.tsx`: add to the props type:

```ts
orgs: {
  id: string;
  name: string;
}
[];
activeOrgId: string;
```

Add the import and render it directly above `<WorkspaceSwitcher>` (~line 142):

```tsx
import { OrgSwitcher } from "@/components/shell/org-switcher";
```

```tsx
      <OrgSwitcher
        orgs={orgs}
        activeOrgId={activeOrgId}
        collapsed={isCollapsed}
      />
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        collapsed={isCollapsed}
      />
```

(Destructure `orgs`, `activeOrgId` in the component signature alongside the existing props.)

- [ ] **Step 3: Extend the data test to assert the new fields**

In `sidebar-nav-data.test.tsx`, assert the returned shape now includes
`orgs` and `activeOrgId` (mock `resolveActiveOrg`/`getUserOrgs` to return a
2-org list; expect `activeOrgId` = the resolved id). Follow the existing mock
style in that file.

- [ ] **Step 4: Run the shell tests + typecheck, verify pass**

Run: `pnpm vitest run src/components/shell/sidebar-nav-data.test.tsx src/components/shell/sidebar-nav.test.tsx`
Then: `pnpm typecheck`
Expected: PASS (props flow through; single-org users still see nothing because OrgSwitcher self-hides).

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/sidebar-nav-data.tsx src/components/shell/sidebar-nav.tsx \
        src/components/shell/sidebar-nav-data.test.tsx src/components/shell/sidebar-nav.test.tsx
git commit -m "feat(org): render OrgSwitcher in sidebar; sidebar data resolves active org"
```

---

## Task 5: Migrate the **pages** group

> ⚠️ `settings/page.tsx` collides with the parallel notification-prefs work — land this task after that merges or rebase (spec §10 Q3). If run by a parallel agent, use an isolated worktree (agreement #1).

**Files:**

- Modify: `src/app/home/page.tsx:29`
- Modify: `src/app/(app)/dashboards/page.tsx:9`
- Modify: `src/app/(app)/settings/page.tsx:40`

- [ ] **Step 1: Apply the mechanical swap in each file**

`home/page.tsx` — replace:

```ts
const orgs = await getUserOrgs();
const org = orgs[0];
```

with:

```ts
const org = await resolveActiveOrg();
```

and swap the import `getUserOrgs` → `resolveActiveOrg` from `@/lib/org/active` (keep any other `@/lib/auth/session` imports it still uses).

`dashboards/page.tsx` — replace:

```ts
const orgs = await getUserOrgs();
const orgId = orgs[0]?.id;
```

with:

```ts
const orgId = await getActiveOrgId();
```

Import `getActiveOrgId` from `@/lib/org/active`; drop the now-unused `getUserOrgs` import.

`settings/page.tsx` — in the `Promise.all` (lines 32-40), remove `getUserOrgs()` from the tuple and replace `const org = orgs[0];` with a resolver call:

```ts
const [myTimeZone, aiCredential, orgAi] = await Promise.all([
  getUserTimeZoneCached(user.id),
  getMyAiCredential(),
  getOrgAiSettings(),
]);
const org = await resolveActiveOrg();
```

Add `import { resolveActiveOrg } from "@/lib/org/active";`; drop the `getUserOrgs` import. `if (!org) redirect("/onboarding");` stays.

- [ ] **Step 2: Verify no behavior change**

Run: `pnpm vitest run` for any existing page tests touching these routes, then
`pnpm typecheck`.
Expected: PASS — resolver returns `orgs[0]` when no cookie, identical to before.

- [ ] **Step 3: Commit**

```bash
git add src/app/home/page.tsx "src/app/(app)/dashboards/page.tsx" "src/app/(app)/settings/page.tsx"
git commit -m "refactor(org): pages resolve active org instead of orgs[0]"
```

---

## Task 6: Migrate the **lib (non-AI)** group

**Files & exact swaps:**

- `src/lib/org/guard.ts:15` — in `isOrgAdmin`, replace the `Promise.all([getUser(), getUserOrgs()])` + `orgs[0]?.id` with `const [user, orgId] = await Promise.all([getUser(), getActiveOrgId()]);` (import `getActiveOrgId` from `@/lib/org/active`; keep `getUser`). `isOrgAdminCached` is unchanged (takes `orgId` param).
- `src/lib/goals/queries.ts:93` — `getGoalOwners`: `const orgId = (await resolveActiveOrg())?.id;` (or `getActiveOrgId()` + `if (!orgId) return new Map();`).
- `src/lib/datetime/user-timezone.ts:24` — replace `getUserOrgs()` in the `Promise.all` with `resolveActiveOrg()`; `return profileTz ?? activeOrg?.timezone ?? "UTC";`.
- `src/lib/time/actions.ts:30` — `const orgId = await getActiveOrgId(); if (!orgId) return fail("No organization.");`.
- `src/lib/workspaces/actions.ts:24,49,69` — all three (`createWorkspace`, `renameWorkspace`, `deleteWorkspace`): replace `(await getUserOrgs())[0]?.id` / `orgs[0]?.id` with `await getActiveOrgId()`; update the stale comment at :48 to reference "the active org" instead of "the shell's `orgs[0]`". Drop `getUserOrgs` import if now unused.
- `src/lib/workload/queries.ts:90,170` — `getWorkloadGrid`, `getWorkloadPageData`: replace `orgs[0]?.id ?? ""` with `await getActiveOrgId()`; drop the `getUserOrgs` from the `Promise.all` at :168 (keep `getUser`).
- `src/lib/workload/actions.ts:23,58` — both actions: `const orgId = await getActiveOrgId(); if (!orgId) return fail("No organization.");`.

- [ ] **Step 1: Apply the swaps file-by-file** (mechanical; import `getActiveOrgId` / `resolveActiveOrg` from `@/lib/org/active`, remove now-unused `getUserOrgs` imports).

- [ ] **Step 2: Run affected tests + typecheck**

Run: `pnpm vitest run src/lib/org src/lib/goals src/lib/datetime src/lib/time src/lib/workspaces src/lib/workload`
Then: `pnpm typecheck`
Expected: PASS (behavior-preserving).

- [ ] **Step 3: Commit**

```bash
git add src/lib/org/guard.ts src/lib/goals/queries.ts src/lib/datetime/user-timezone.ts \
        src/lib/time/actions.ts src/lib/workspaces/actions.ts \
        src/lib/workload/queries.ts src/lib/workload/actions.ts
git commit -m "refactor(org): non-AI lib call sites resolve active org"
```

---

## Task 7: Migrate the **AI subtree** group (the surface the brief missed)

**Files (10) & swaps** — each replaces `orgs[0]` / `(await getUserOrgs())[0]` with `await resolveActiveOrg()`, then guards `if (!org) …` per the site's existing error style (most already do `if (!org) return fail(...)` or throw an AI error):

- `src/lib/ai/actions.ts:122` (`generateDashboardProposal`)
- `src/lib/ai/board-actions.ts:56` (`generateBoardProposal`)
- `src/lib/ai/settings-actions.ts:29,52` (`requireOrgAdmin`, `getOrgAiSettings`)
- `src/lib/ai/ask/actions.ts:36` (`askPulse`)
- `src/lib/ai/write/actions.ts:80,135` (`proposeActions`, `executeActions`)
- `src/lib/ai/summarize/actions.ts:42`
- `src/lib/ai/column-fill/actions.ts:73`
- `src/lib/ai/item-assist/actions.ts:77`
- `src/lib/ai/import-mapping-actions.ts:93`
- `src/lib/ai/automation-gen-actions.ts:45`

- [ ] **Step 1: Apply the swap in each file**

Per site: `const org = (await getUserOrgs())[0];` → `const org = await resolveActiveOrg();`
(and `const orgs = await getUserOrgs(); const org = orgs[0];` → `const org = await resolveActiveOrg();`). Import `resolveActiveOrg` from `@/lib/org/active`; drop the `getUserOrgs` import where now unused. Preserve each site's existing null-check and downstream `org.id` usage verbatim.

- [ ] **Step 2: Run the AI tests + typecheck**

Run: `pnpm vitest run src/lib/ai`
Then: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/actions.ts src/lib/ai/board-actions.ts src/lib/ai/settings-actions.ts \
        src/lib/ai/ask/actions.ts src/lib/ai/write/actions.ts src/lib/ai/summarize/actions.ts \
        src/lib/ai/column-fill/actions.ts src/lib/ai/item-assist/actions.ts \
        src/lib/ai/import-mapping-actions.ts src/lib/ai/automation-gen-actions.ts
git commit -m "refactor(org): AI-subtree call sites resolve active org"
```

---

## Task 8: Migrate `command-palette-data.tsx`

**Files:**

- Modify: `src/components/shell/command-palette-data.tsx:16`

- [ ] **Step 1: Swap**

Replace:

```ts
  const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
  ...
  const orgId = orgs[0]?.id ?? "";
```

with `getUser()` + `getActiveOrgId()` in the `Promise.all` (or resolve `orgId` after). Import `getActiveOrgId` from `@/lib/org/active`; drop `getUserOrgs` if unused.

- [ ] **Step 2: Run its test + typecheck**

Run: `pnpm vitest run src/components/shell/command-palette-data.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/command-palette-data.tsx
git commit -m "refactor(org): command palette resolves active org"
```

---

## Task 9: Full verification + manual E2E

- [ ] **Step 1: Confirm zero stragglers**

Run: `grep -rn "orgs\[0\]\|getUserOrgs())\[0\]" src --include="*.ts" --include="*.tsx" | grep -v ".test."`
Expected: **no output** except the intended-unchanged existence checks in
`onboarding/*` (which use `orgs.length`, not `[0]`) — those won't match this grep.
If any `[0]` selection remains, migrate it.

- [ ] **Step 2: Run the four gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all PASS.

- [ ] **Step 3: Manual E2E on DEV** (see "How to test" below). Verify a 2-org user can switch and every surface reflects the new org and the choice survives reload.

- [ ] **Step 4: Finish the task** — `scripts/finish-task.sh` from the worktree (rebases onto `develop`, re-runs gates, merges, cleans up).

---

## How to test this (hand to the user after merge)

Prereq: two orgs the same user belongs to on **DEV**. If none exists, in the
`supabase-dev` MCP add the test user to a second org (`org_members` insert in a
rolled-back verification, or seed a real second membership on DEV).

1. Pull `develop` and run the app (`pnpm dev`), log in as the multi-org user.
2. Look at the top of the left sidebar — above the workspace switcher there is now
   an **organization** switcher showing your current org's name + initial.
   (A single-org user sees nothing new here — expected.)
3. Click it → the dropdown lists all your orgs with a check on the active one.
4. Select the other org. The page refreshes; the sidebar's **workspaces**,
   **boards**, and **dashboards** now show that org's content (the workspace
   switcher resets to that org's first workspace).
5. Open **Settings** → the Organization card shows the newly-selected org's name
   and timezone; Members reflects the new org.
6. Open the **command palette** (Cmd-K) → dashboards/workspaces listed are the
   new org's.
7. Reload the browser → the selected org **persists** (cookie).
8. (Security) In devtools, tamper the `pulse_active_org` cookie to a random id and
   reload → the app safely falls back to your first org (no error, no cross-tenant
   leak — RLS + resolver reject the foreign id).

---

## Self-Review

- **Spec coverage:** resolver (§4)→T1; action (§5)→T2; UI (§6)→T3; sidebar wiring
  (§7)→T4; all 22 call-site files (§9)→T5–T8; perf budget (§8) preserved (no new
  queries, Server Action + refresh); testing (§11)→T1–T3 + T9; manual E2E→T9.
- **Placeholder scan:** none — every code step has concrete code/commands.
- **Type consistency:** `UserOrg` reused from `@/lib/auth/session`; `pickActiveOrg`,
  `resolveActiveOrg`, `getActiveOrgId`, `setActiveOrg`, `ACTIVE_ORG_COOKIE`,
  `OrgSwitcher` names identical across all tasks.
- **DAG:** T1→T2→T3→T4→T9 critical path; T5–T8 parallel after T1 on disjoint files;
  settings collision flagged.
- **No DB migration** anywhere (confirmed — cookie-only persistence).
