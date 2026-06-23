# Phase 9.2 — Streaming Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prerender the static app chrome (sidebar frame + header bar) into the Next.js 16 PPR static shell and stream per-user data (nav lists, notifications, user menu) into `<Suspense>` boundaries with content-shaped skeleton fallbacks, section by section.

**Architecture:** Enable `cacheComponents` (PPR by default). Split `AppShell` into a synchronous static **frame** that takes pre-wrapped **slot** `ReactNode`s; move the per-user data fetches into small streamed server components (`SidebarNavData`, `HeaderUserData`) wrapped in `<Suspense>` with shell skeletons. Section layouts become synchronous and compose the frame + slots via one shared helper. No `use cache` here — the session reads `cookies()`, which the Next 16 docs forbid inside `use cache`; caching is 9.3's job. Roll out boards-first (atomic with the flag flip), then the other sections in parallel.

**Tech Stack:** Next.js 16.2.9 (App Router, Cache Components / PPR), React 19 Suspense, Supabase SSR (anon client, RLS), Zustand (sidebar collapse), Vitest + @testing-library/react (jsdom), @next/playwright (`instant()` e2e).

**Source spec:** `docs/superpowers/specs/2026-06-23-phase-9-2-streaming-shell-design.md`. Read it first — it carries the verified Next-16 constraints and decisions D1–D4.

**Locked decisions (from spec §9, resolved here):**

- **D1:** `unstable_instant = false` on each section **layout** (cookie-bound page-load entry is dynamic); `{ prefetch: 'static' }` on the section **page** segments to validate sibling client-nav. Cold page-load still streams the static shell instantly; it just isn't `instant`-validated.
- **D2:** The streamed nav slot renders its markup and reads the client `collapsed` flag via a CSS `data-collapsed` attribute on the client `<aside>` (pure-CSS compaction, no extra client JS in the slot).
- **D3:** `TimeZoneProvider` receives the timezone as a resolved value from a streamed boundary (`TimeZoneBoundary` server component awaits `getUserTimeZone()` and renders the provider around `children`), so the frame stays static.
- **D4:** Task 1 (boards) is atomic with the flag flip; the other sections parallelize after primitives exist.

---

## File Structure

**New files:**

- `src/components/ui/skeleton.tsx` — shared `<Skeleton>` primitive (styled `animate-pulse` block). Reused by 9.2 shell skeletons and (later) 9.4 page skeletons.
- `src/components/shell/sidebar-nav-skeleton.tsx` — content-shaped fallback for the sidebar data region.
- `src/components/shell/header-user-skeleton.tsx` — content-shaped fallback for the header user region.
- `src/components/shell/sidebar-nav-data.tsx` — streamed server component: fetches + renders the per-user sidebar nav.
- `src/components/shell/header-user-data.tsx` — streamed server component: fetches + renders notifications bell + user menu.
- `src/components/shell/timezone-boundary.tsx` — streamed server component: awaits timezone, renders `TimeZoneProvider` around `children`.
- `src/components/shell/authenticated-shell.tsx` — composition helper: assembles `AppShell` + the two Suspense slots + timezone boundary. The one place the 8 layouts converge.
- `src/components/shell/sidebar-nav-data.test.tsx`, `header-user-data.test.tsx`, `sidebar-nav-skeleton.test.tsx`, `header-user-skeleton.test.tsx` — unit tests.
- `e2e/streaming-shell.spec.ts` — `@next/playwright instant()` regression test (boards).

**Modified files:**

- `next.config.ts` — add `cacheComponents: true` + `experimental.instantNavigationDevToolsToggle`.
- `src/components/app-shell.tsx` — frame-only; takes `sidebarNav`/`headerUser` slot props + `children`; drops data props.
- `src/components/sidebar.tsx` — takes `navSlot: ReactNode` instead of data arrays; renders it; keeps collapse shell + static nav.
- `src/components/app-shell.test.tsx` — update to the new slot contract.
- `src/components/sidebar.test.tsx` — update to the `navSlot` contract.
- `src/app/boards/layout.tsx` … `src/app/admin/layout.tsx` (8 files) — become synchronous, compose `<AuthenticatedShell>`.
- The section **page** segments get `export const unstable_instant = { prefetch: 'static' }` (D1).

**Untouched (explicitly):** `src/app/boards/[boardId]/loading.tsx` (9.4 family), `src/proxy.ts`, `src/lib/auth/session.ts`, the query modules.

---

## Conventions every task follows

- **Commit identity** is pinned by `start-task.sh` to `Danijel Jovanovic <info@synapse-solutions.ai>` — do not override.
- **Stage by path** (`git add <paths>`), never `git add -A`.
- Run the relevant test with `pnpm vitest run <path>` (unit project). Full gate before any merge: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Tests live beside source as `*.test.tsx`; jsdom; mock `next/navigation` and server-action modules as the existing `app-shell.test.tsx` does (it polyfills Radix pointer-capture in `beforeEach`).

---

## Task 1: Shared `<Skeleton>` primitive

**Files:**

- Create: `src/components/ui/skeleton.tsx`
- Test: `src/components/ui/skeleton.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/skeleton.test.tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders an animated muted block and merges className", () => {
    const { container } = render(<Skeleton className="h-8 w-48" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("animate-pulse");
    expect(el).toHaveClass("h-8");
    expect(el).toHaveClass("w-48");
  });

  it("forwards arbitrary props like aria-hidden", () => {
    const { container } = render(<Skeleton aria-hidden="true" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/skeleton.test.tsx`
Expected: FAIL — cannot resolve `./skeleton`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/ui/skeleton.tsx
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared loading-block primitive. The single skeleton token reused by the
 * Phase 9.2 shell fallbacks and the Phase 9.4 page-content loading skeletons.
 */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("bg-muted animate-pulse rounded-md", className)}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/skeleton.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/skeleton.tsx src/components/ui/skeleton.test.tsx
git commit -m "feat(shell): add shared Skeleton primitive"
```

---

## Task 2: Shell skeleton fallbacks

**Files:**

- Create: `src/components/shell/sidebar-nav-skeleton.tsx`, `src/components/shell/header-user-skeleton.tsx`
- Test: `src/components/shell/sidebar-nav-skeleton.test.tsx`, `src/components/shell/header-user-skeleton.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/shell/sidebar-nav-skeleton.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarNavSkeleton } from "./sidebar-nav-skeleton";

describe("SidebarNavSkeleton", () => {
  it("is a labelled busy region with several row placeholders", () => {
    render(<SidebarNavSkeleton />);
    const region = screen.getByRole("status", { name: /loading navigation/i });
    expect(region).toHaveAttribute("aria-busy", "true");
    // content-shaped: at least a few rows so layout is reserved (CLS guard)
    expect(
      region.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThanOrEqual(4);
  });
});
```

```tsx
// src/components/shell/header-user-skeleton.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeaderUserSkeleton } from "./header-user-skeleton";

describe("HeaderUserSkeleton", () => {
  it("reserves a circular avatar-sized placeholder", () => {
    render(<HeaderUserSkeleton />);
    const region = screen.getByRole("status", { name: /loading account/i });
    expect(region).toHaveAttribute("aria-busy", "true");
    const avatar = region.querySelector(".rounded-full");
    expect(avatar).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/shell/sidebar-nav-skeleton.test.tsx src/components/shell/header-user-skeleton.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

```tsx
// src/components/shell/sidebar-nav-skeleton.tsx
import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback for the streamed sidebar nav. Rows match BoardsNav/
 * DashboardsNav heights so streamed content swaps in with zero layout shift. */
export function SidebarNavSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading navigation"
      className="flex flex-col gap-1.5 px-3 py-2"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}
```

```tsx
// src/components/shell/header-user-skeleton.tsx
import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback for the streamed header user region (bell + avatar). */
export function HeaderUserSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading account"
      className="flex items-center gap-2"
    >
      <Skeleton className="size-8" />
      <Skeleton className="size-8 rounded-full" />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/shell/sidebar-nav-skeleton.test.tsx src/components/shell/header-user-skeleton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/sidebar-nav-skeleton.tsx src/components/shell/header-user-skeleton.tsx src/components/shell/sidebar-nav-skeleton.test.tsx src/components/shell/header-user-skeleton.test.tsx
git commit -m "feat(shell): add sidebar/header Suspense skeleton fallbacks"
```

---

## Task 3: `Sidebar` takes a `navSlot`

Change `Sidebar` to render a pre-built `navSlot` `ReactNode` instead of raw `boards`/`sharedBoards`/`workspaces`/`dashboards`/`isPlatformAdmin`/`isOrgAdmin`. The collapse shell (frame, `Brand`, toggle, static nav array) is unchanged. The client `<aside>` already sets `data-collapsed`; the slot's children use that for CSS compaction (D2) — so `Sidebar` keeps exposing `data-collapsed`.

**Files:**

- Modify: `src/components/sidebar.tsx`
- Modify: `src/components/sidebar.test.tsx`

- [ ] **Step 1: Update the test to the new contract (write failing)**

Replace the data-prop assertions with a `navSlot` assertion. Add/keep a collapse test.

```tsx
// src/components/sidebar.test.tsx — key cases (keep existing collapse/store setup)
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./sidebar";
import { useUIStore } from "@/stores/ui";

beforeEach(() => {
  useUIStore.setState({ sidebarCollapsed: false, hasHydrated: true });
});

describe("Sidebar", () => {
  it("renders the provided navSlot", () => {
    render(<Sidebar navSlot={<div>NAV_SLOT_MARKER</div>} />);
    expect(screen.getByText("NAV_SLOT_MARKER")).toBeInTheDocument();
  });

  it("renders the static nav links (Goals/Portfolios/Workload) and a disabled Inbox", () => {
    render(<Sidebar navSlot={<div />} />);
    expect(screen.getByText("Goals").closest("a")).toHaveAttribute(
      "href",
      "/goals",
    );
    expect(screen.getByText("Workload").closest("a")).toHaveAttribute(
      "href",
      "/workload",
    );
    expect(screen.getByText("Inbox").closest("button")).toBeDisabled();
  });

  it("exposes data-collapsed for slot CSS compaction", () => {
    useUIStore.setState({ sidebarCollapsed: true, hasHydrated: true });
    const { container } = render(<Sidebar navSlot={<div />} />);
    expect(container.querySelector("aside")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/sidebar.test.tsx`
Expected: FAIL — `Sidebar` still requires `boards`/etc.; `navSlot` unknown.

- [ ] **Step 3: Edit `Sidebar`**

Change the props type and body. Remove the `BoardsNav`/`DashboardsNav`/Workspaces/`PlatformNav` data wiring and their data props; render `{navSlot}` where those used to be. Keep `useUIStore` collapse logic, `Brand`, toggle, the static `nav` array, and `data-collapsed`.

```tsx
// src/components/sidebar.tsx — new signature + body sketch
"use client";
import { useEffect, type ReactNode } from "react";
// ...keep Link, lucide icons used by the static nav array, Brand, Button,
//    Tooltip*, useUIStore, cn. Remove BoardsNav/DashboardsNav/WorkspaceNavItem/
//    NewWorkspaceDialog/Separator-for-data-regions/PlatformNav and the board/
//    dashboard type imports — those move into SidebarNavData (Task 4).

export function Sidebar({ navSlot }: { navSlot: ReactNode }) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const isCollapsed = hasHydrated && collapsed;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        data-collapsed={isCollapsed}
        className={cn(
          "bg-sidebar hidden shrink-0 flex-col border-r md:flex",
          hasHydrated && "transition-[width] duration-200 ease-out",
          isCollapsed ? "w-14" : "w-60",
        )}
      >
        {/* Brand + collapse toggle block — UNCHANGED from current file */}
        {/* ...keep the existing header block verbatim... */}

        {/* Streamed per-user nav (boards/dashboards/workspaces/platform). The
            slot's own children read the aside's data-collapsed for compaction. */}
        {navSlot}

        {/* Static section nav array (Goals/Portfolios/Workload/Inbox) —
            UNCHANGED from current file. */}
        {/* ...keep the existing <nav> map verbatim... */}
      </aside>
    </TooltipProvider>
  );
}
```

> Note for the implementer: preserve the existing Brand/toggle header block and the static `nav` array map **verbatim** from the current `sidebar.tsx`; only the data-nav region and the props change. The Workspaces block and `PlatformNav` move to `SidebarNavData` (Task 4).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/components/sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar.tsx src/components/sidebar.test.tsx
git commit -m "refactor(shell): Sidebar renders a navSlot instead of data props"
```

---

## Task 4: `SidebarNavData` streamed server component

The component that actually fetches and renders the per-user sidebar nav (boards, shared boards, dashboards, workspaces, platform-admin nav). It moves the data wiring out of `Sidebar`. Reads `collapsed`? No — compaction is CSS via `data-collapsed` (D2), so this renders both states' markup and lets CSS hide/compact. (If the existing `BoardsNav`/`DashboardsNav` require a `collapsed` boolean prop, pass `collapsed={false}` and add a `group-data-[collapsed=true]` CSS rule on the wrapper, OR keep their `collapsed` prop driven by a tiny client wrapper — implementer picks per those components' API; the test below only asserts data rendering, not compaction.)

**Files:**

- Create: `src/components/shell/sidebar-nav-data.tsx`
- Test: `src/components/shell/sidebar-nav-data.test.tsx`

- [ ] **Step 1: Write the failing test**

Mock the query modules + guards and assert the nav renders board/dashboard names. (Async server component: call it as a function and render the resolved element — the repo has no RSC harness, so resolve the promise then render.)

```tsx
// src/components/shell/sidebar-nav-data.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/boards",
  useParams: () => ({}),
}));
vi.mock("@/lib/workspaces/actions", () => ({
  createWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));
vi.mock("@/lib/boards/queries", () => ({
  listMyBoards: vi.fn(async () => [
    {
      id: "b1",
      name: "Sprint backlog",
      workspace_id: "w1",
      position: 0,
      shared_out: false,
    },
  ]),
  listSharedBoards: vi.fn(async () => []),
}));
vi.mock("@/lib/dashboards/queries", () => ({
  listDashboards: vi.fn(async () => [{ id: "d1", name: "Velocity" }]),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: async () => ({ data: [{ id: "w1", name: "Eng" }] }),
    }),
  })),
}));
vi.mock("@/lib/platform/guard", () => ({
  isPlatformAdmin: vi.fn(async () => false),
}));
vi.mock("@/lib/org/guard", () => ({ isOrgAdmin: vi.fn(async () => false) }));

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

describe("SidebarNavData", () => {
  it("renders boards, dashboards and workspaces from the queries", async () => {
    const { SidebarNavData } = await import("./sidebar-nav-data");
    render(await SidebarNavData());
    expect(screen.getByText("Sprint backlog")).toBeInTheDocument();
    expect(screen.getByText("Velocity")).toBeInTheDocument();
    expect(screen.getByText("Eng")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/shell/sidebar-nav-data.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Move the data wiring here. Kick off the fetches with `Promise.all` _inside this streamed component_ (it is already behind a Suspense boundary in the layout, so awaiting here is correct — it does not block the shell).

```tsx
// src/components/shell/sidebar-nav-data.tsx
import { listMyBoards, listSharedBoards } from "@/lib/boards/queries";
import { listDashboards } from "@/lib/dashboards/queries";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/platform/guard";
import { isOrgAdmin } from "@/lib/org/guard";
import { BoardsNav } from "@/components/boards/BoardsNav";
import { DashboardsNav } from "@/components/dashboards/DashboardsNav";
import { PlatformNav } from "@/components/platform/PlatformNav";
import { WorkspaceNavItem } from "@/components/workspaces/WorkspaceNavItem";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";
import { Separator } from "@/components/ui/separator";

/**
 * Streamed per-user sidebar nav. Rendered behind a <Suspense> boundary in the
 * authenticated layout, so its awaits stream into the static shell rather than
 * blocking first paint. NOT cached (session reads cookies → use cache is
 * disallowed; caching is Phase 9.3).
 */
export async function SidebarNavData() {
  const supabase = await createClient();
  const [
    boards,
    sharedBoards,
    dashboards,
    { data: workspaces },
    platformAdmin,
    orgAdmin,
  ] = await Promise.all([
    listMyBoards(),
    listSharedBoards(),
    listDashboards(),
    supabase.from("workspaces").select("id, name"),
    isPlatformAdmin(),
    isOrgAdmin(),
  ]);
  const ws = workspaces ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col group-data-[collapsed=true]/sidebar:contents">
      <BoardsNav
        boards={boards}
        sharedBoards={sharedBoards}
        workspaces={ws}
        collapsed={false}
      />
      <Separator className="mx-3 my-1 w-auto group-data-[collapsed=true]/sidebar:hidden" />
      <DashboardsNav
        dashboards={dashboards.map((d) => ({ id: d.id, name: d.name }))}
        workspaces={ws}
        collapsed={false}
      />
      {ws.length > 0 ? (
        <>
          <Separator className="mx-3 my-1 w-auto group-data-[collapsed=true]/sidebar:hidden" />
          <div className="mt-2 flex flex-col gap-0.5 px-2 group-data-[collapsed=true]/sidebar:hidden">
            <div className="flex items-center px-3 py-1">
              <p className="text-muted-foreground text-xs font-medium">
                Workspaces
              </p>
              <NewWorkspaceDialog />
            </div>
            {ws.map((w) => (
              <WorkspaceNavItem
                key={w.id}
                workspace={w}
                isOrgAdmin={orgAdmin}
                isLast={ws.length <= 1}
              />
            ))}
          </div>
        </>
      ) : null}
      <div className="mt-auto">
        <PlatformNav isPlatformAdmin={platformAdmin} collapsed={false} />
      </div>
    </div>
  );
}
```

> Implementer note (D2): add `group/sidebar` to the `<aside>` in `Sidebar` (Task 3) so the `group-data-[collapsed=true]/sidebar:*` utilities above resolve. If `BoardsNav`/`DashboardsNav`/`PlatformNav` already handle their own collapsed compaction via a prop and that is simpler, you may instead thread `collapsed` through a thin client wrapper — but keep the slot a server component so the data fetch stays server-side. The test asserts only data rendering, so either path passes.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/components/shell/sidebar-nav-data.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/sidebar-nav-data.tsx src/components/shell/sidebar-nav-data.test.tsx
git commit -m "feat(shell): add streamed SidebarNavData server component"
```

---

## Task 5: `HeaderUserData` streamed server component

Moves `NotificationsBell` + `UserMenu` (the per-user header bits) out of the frame into a streamed component.

**Files:**

- Create: `src/components/shell/header-user-data.tsx`
- Test: `src/components/shell/header-user-data.test.tsx`
- Modify: `src/components/app-shell.tsx` — export `UserMenu` (currently a private function) so `HeaderUserData` can reuse it, OR move `UserMenu` into its own file `src/components/shell/user-menu.tsx`. **Pick the move** (cleaner; `app-shell.tsx` shrinks). Update `app-shell.test.tsx` import accordingly in Task 6.

- [ ] **Step 1: Move `UserMenu` to its own file**

Create `src/components/shell/user-menu.tsx` containing the existing `UserMenu` + its `initialFor` helper + the `AppShellUser` type usage, exported. Remove them from `app-shell.tsx` (Task 6 finalizes app-shell).

- [ ] **Step 2: Write the failing test**

```tsx
// src/components/shell/header-user-data.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/boards",
  useParams: () => ({}),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    id: "u1",
    email: "info@synapse-solutions.ai",
    user_metadata: {},
    app_metadata: {},
  })),
}));
vi.mock("@/lib/platform/guard", () => ({
  isPlatformAdmin: vi.fn(async () => true),
}));
// NotificationsBell hits realtime/supabase; stub to a marker.
vi.mock("@/components/notifications/NotificationsBell", () => ({
  NotificationsBell: ({ userId }: { userId: string }) => (
    <div>bell:{userId}</div>
  ),
}));

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

describe("HeaderUserData", () => {
  it("renders the notifications bell for the current user", async () => {
    const { HeaderUserData } = await import("./header-user-data");
    render(await HeaderUserData());
    expect(screen.getByText("bell:u1")).toBeInTheDocument();
  });

  it("shows the platform-admin link in the user menu for admins", async () => {
    const { HeaderUserData } = await import("./header-user-data");
    render(await HeaderUserData());
    await userEvent.click(
      screen.getByRole("button", { name: /open user menu/i }),
    );
    expect(
      await screen.findByRole("menuitem", { name: /platform admin/i }),
    ).toHaveAttribute("href", "/admin");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run src/components/shell/header-user-data.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```tsx
// src/components/shell/header-user-data.tsx
import { requireUser } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform/guard";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { UserMenu } from "@/components/shell/user-menu";

/**
 * Streamed header user region (notifications bell + account menu). Behind a
 * <Suspense> in the authenticated layout; awaits stream rather than block.
 */
export async function HeaderUserData() {
  const user = await requireUser();
  const platformAdmin = await isPlatformAdmin();
  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null;

  return (
    <>
      <NotificationsBell userId={user.id} />
      <UserMenu
        user={{ email: user.email, full_name: fullName }}
        isPlatformAdmin={platformAdmin}
      />
    </>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/components/shell/header-user-data.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/user-menu.tsx src/components/shell/header-user-data.tsx src/components/shell/header-user-data.test.tsx
git commit -m "feat(shell): add streamed HeaderUserData + extract UserMenu"
```

---

## Task 6: `AppShell` frame + `TimeZoneBoundary` + `AuthenticatedShell`

Turn `AppShell` into a pure frame taking slots; add the timezone boundary (D3) and the composition helper the layouts use.

**Files:**

- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-shell.test.tsx`
- Create: `src/components/shell/timezone-boundary.tsx`
- Create: `src/components/shell/authenticated-shell.tsx`

- [ ] **Step 1: Update `app-shell.test.tsx` to the slot contract (write failing)**

```tsx
// src/components/app-shell.test.tsx — replace data-prop cases with slot cases
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";
import { useUIStore } from "@/stores/ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
}));

beforeEach(() => {
  useUIStore.setState({ sidebarCollapsed: false, hasHydrated: true });
});

describe("AppShell frame", () => {
  it("renders children, the command trigger, and both slots", () => {
    render(
      <AppShell
        sidebarNav={<div>SIDEBAR_NAV_SLOT</div>}
        headerUser={<div>HEADER_USER_SLOT</div>}
      >
        <div>Board content</div>
      </AppShell>,
    );
    expect(screen.getByText("Board content")).toBeInTheDocument();
    expect(screen.getByText("Search…")).toBeInTheDocument(); // CommandTrigger, static
    expect(screen.getByText("SIDEBAR_NAV_SLOT")).toBeInTheDocument();
    expect(screen.getByText("HEADER_USER_SLOT")).toBeInTheDocument();
    expect(screen.getAllByText("MONOLITH").length).toBeGreaterThan(0); // Brand, static
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/app-shell.test.tsx`
Expected: FAIL — `AppShell` doesn't accept `sidebarNav`/`headerUser`.

- [ ] **Step 3: Rewrite `AppShell` as a frame**

```tsx
// src/components/app-shell.tsx
import type { ReactNode } from "react";
import { Brand } from "@/components/brand/brand";
import { Sidebar } from "@/components/sidebar";
import { CommandTrigger } from "@/components/command-trigger";
import { ThemeToggle } from "@/components/theme-toggle";

type AppShellProps = {
  children: ReactNode;
  /** Streamed per-user sidebar nav (already Suspense-wrapped by the caller). */
  sidebarNav: ReactNode;
  /** Streamed header user region (already Suspense-wrapped by the caller). */
  headerUser: ReactNode;
};

export function AppShell({ children, sidebarNav, headerUser }: AppShellProps) {
  return (
    <div className="flex h-svh w-full overflow-hidden">
      <Sidebar navSlot={sidebarNav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <CommandTrigger />
            <ThemeToggle />
            {headerUser}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
```

> The old `AppShell` also rendered `<CommandPalette boards dashboards workspaces />`. The palette needs board/dashboard data → it becomes a third streamed slot. Add `commandPalette?: ReactNode` to `AppShellProps` and render it after `</div>`, OR fold the palette into `SidebarNavData`'s data fetch by rendering it from a sibling streamed component `CommandPaletteData`. **Decision (lock):** add `CommandPaletteData` (`src/components/shell/command-palette-data.tsx`) mirroring Task 4's fetch and render `<CommandPalette …>`; pass it as a `commandPalette` slot. Add a one-line test that it renders given mocked queries (same mock setup as Task 4). Update the `AuthenticatedShell` below to wire it behind its own `<Suspense fallback={null}>` (palette is hidden until opened, so a null fallback is fine).

- [ ] **Step 4: Add `TimeZoneBoundary` and `AuthenticatedShell`**

```tsx
// src/components/shell/timezone-boundary.tsx
import type { ReactNode } from "react";
import { getUserTimeZone } from "@/lib/auth/session";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";

/** Resolves the user timezone in its own streamed boundary so the static shell
 * does not block on it, then provides it to page content. */
export async function TimeZoneBoundary({ children }: { children: ReactNode }) {
  const timeZone = await getUserTimeZone();
  return <TimeZoneProvider timeZone={timeZone}>{children}</TimeZoneProvider>;
}
```

```tsx
// src/components/shell/authenticated-shell.tsx
import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { SidebarNavData } from "@/components/shell/sidebar-nav-data";
import { HeaderUserData } from "@/components/shell/header-user-data";
import { CommandPaletteData } from "@/components/shell/command-palette-data";
import { TimeZoneBoundary } from "@/components/shell/timezone-boundary";
import { SidebarNavSkeleton } from "@/components/shell/sidebar-nav-skeleton";
import { HeaderUserSkeleton } from "@/components/shell/header-user-skeleton";

/**
 * Single composition the 8 authenticated section layouts share. The frame +
 * skeleton fallbacks are static (prerendered); the three data slots stream.
 */
export function AuthenticatedShell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      sidebarNav={
        <Suspense fallback={<SidebarNavSkeleton />}>
          <SidebarNavData />
        </Suspense>
      }
      headerUser={
        <Suspense fallback={<HeaderUserSkeleton />}>
          <HeaderUserData />
        </Suspense>
      }
      commandPalette={
        <Suspense fallback={null}>
          <CommandPaletteData />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <TimeZoneBoundary>{children}</TimeZoneBoundary>
      </Suspense>
    </AppShell>
  );
}
```

> Add `commandPalette: ReactNode` to `AppShellProps` and render `{commandPalette}` in `AppShell` (Step 3). Create `CommandPaletteData` as noted. `TimeZoneBoundary` wraps `children`; because it awaits, wrap it in `<Suspense fallback={null}>` — the page's own `loading.tsx` (9.4) is the visible fallback for content, so null here is correct.

- [ ] **Step 5: Run the shell unit tests**

Run: `pnpm vitest run src/components/app-shell.test.tsx src/components/shell/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/app-shell.tsx src/components/app-shell.test.tsx src/components/shell/timezone-boundary.tsx src/components/shell/authenticated-shell.tsx src/components/shell/command-palette-data.tsx src/components/shell/command-palette-data.test.tsx
git commit -m "feat(shell): AppShell frame + AuthenticatedShell composition + timezone boundary"
```

---

## Task 7: Enable Cache Components + convert the **boards** layout (ATOMIC)

This is the keystone: flipping `cacheComponents` makes the build **fail** on any un-wrapped cookie/dynamic access, so the flag and the first converted section must land together.

**Files:**

- Modify: `next.config.ts`
- Modify: `src/app/boards/layout.tsx`
- Modify: `src/app/boards/page.tsx` (add `unstable_instant`) — and any other boards page segments (e.g. `src/app/boards/[boardId]/page.tsx`).

- [ ] **Step 1: Enable the flag**

```ts
// next.config.ts — add inside nextConfig
  cacheComponents: true,
  experimental: {
    instantNavigationDevToolsToggle: true,
  },
```

- [ ] **Step 2: Convert the boards layout to synchronous + AuthenticatedShell**

```tsx
// src/app/boards/layout.tsx
import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

// Cookie-bound page-load entry is dynamic; validate sibling client-nav only (D1).
export const unstable_instant = false;

export default function BoardsLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
```

- [ ] **Step 3: Add instant validation to boards page segments**

```tsx
// src/app/boards/page.tsx (and src/app/boards/[boardId]/page.tsx) — top of file
export const unstable_instant = { prefetch: "static" };
```

- [ ] **Step 4: Add the config regression test**

```tsx
// src/app/streaming-shell-config.test.ts
import { describe, expect, it } from "vitest";
import config from "../../next.config";

describe("next.config", () => {
  it("has Cache Components enabled", () => {
    expect(config.cacheComponents).toBe(true);
  });
});
```

Run: `pnpm vitest run src/app/streaming-shell-config.test.ts` → PASS.

- [ ] **Step 5: Build — the real PPR gate**

Run: `pnpm build`
Expected: PASS. If it fails with a `blocking-route` / "Uncached data was accessed outside of <Suspense>" error, the message names the offending component — wrap it in a boundary or move its data fetch into a streamed component. Do **not** silence by caching (that's 9.3).

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add next.config.ts src/app/boards/layout.tsx src/app/boards/page.tsx src/app/boards/[boardId]/page.tsx src/app/streaming-shell-config.test.ts
git commit -m "feat(shell): enable Cache Components + stream the boards shell"
```

---

## Task 8: Add the `instant()` e2e (boards)

**Files:**

- Create: `e2e/streaming-shell.spec.ts`

- [ ] **Step 1: Confirm `@next/playwright` is available**

Run: `pnpm ls @next/playwright || pnpm add -D @next/playwright`
(If the repo has no Playwright harness at all, scope this task to: add the dep + a single spec under `e2e/`, matching the existing `e2e/**` exclude already in `vitest.config.ts`. If e2e infra is absent and out of budget, mark this task **deferred** and rely on build-time `unstable_instant` validation — note it explicitly in the wrapup. Do not fake a passing e2e.)

- [ ] **Step 2: Write the instant-shell assertion**

```ts
// e2e/streaming-shell.spec.ts
import { test, expect } from "@playwright/test";
import { instant } from "@next/playwright";

test("board chrome is present in the instant shell", async ({ page }) => {
  await page.goto("/boards");
  await instant(page, async () => {
    // Static chrome + skeletons are in the instant shell before data streams.
    await expect(page.getByText("MONOLITH").first()).toBeVisible();
    await expect(
      page.getByRole("status", { name: /loading navigation/i }),
    ).toBeVisible();
  });
  // After instant() exits, streamed nav replaces the skeleton.
  await expect(
    page.getByRole("status", { name: /loading navigation/i }),
  ).toBeHidden();
});
```

- [ ] **Step 3: Run it**

Run: `pnpm exec playwright test e2e/streaming-shell.spec.ts` (or the repo's e2e script if one exists)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/streaming-shell.spec.ts package.json pnpm-lock.yaml
git commit -m "test(shell): instant-shell e2e for the boards section"
```

---

## Task 9: Convert **dashboards** layout

Identical shape to Task 7's boards layout; `dashboards` keeps its `react-grid-layout/css/styles.css` import.

**Files:**

- Modify: `src/app/dashboards/layout.tsx`, `src/app/dashboards/page.tsx`

- [ ] **Step 1: Convert the layout**

```tsx
// src/app/dashboards/layout.tsx
import type { ReactNode } from "react";
import "react-grid-layout/css/styles.css";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export const unstable_instant = false;

export default function DashboardsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
```

- [ ] **Step 2: Add instant validation to the page**

```tsx
// src/app/dashboards/page.tsx — top of file
export const unstable_instant = { prefetch: "static" };
```

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green (build re-validates PPR for this route).

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/layout.tsx src/app/dashboards/page.tsx
git commit -m "feat(shell): stream the dashboards shell"
```

---

## Task 10: Convert **goals**, **portfolios**, **workload** layouts

These three skip `isOrgAdmin` today, but `SidebarNavData` now always fetches it — that's fine (the org-admin flag only gates a workspace delete action; making it consistently available is a minor, intended fix, noted in spec §2). Same conversion for each.

**Files:**

- Modify: `src/app/goals/layout.tsx`, `src/app/portfolios/layout.tsx`, `src/app/workload/layout.tsx`, and each section's `page.tsx`.

- [ ] **Step 1: Convert each layout (×3)** — identical body; example for goals:

```tsx
// src/app/goals/layout.tsx (repeat verbatim for portfolios/, workload/)
import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export const unstable_instant = false;

export default function GoalsLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
```

> Repeat for `portfolios/layout.tsx` (rename fn `PortfoliosLayout`) and `workload/layout.tsx` (`WorkloadLayout`).

- [ ] **Step 2: Add instant validation to each page (×3)**

```tsx
// top of src/app/goals/page.tsx, src/app/portfolios/page.tsx, src/app/workload/page.tsx
export const unstable_instant = { prefetch: "static" };
```

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/app/goals/layout.tsx src/app/goals/page.tsx src/app/portfolios/layout.tsx src/app/portfolios/page.tsx src/app/workload/layout.tsx src/app/workload/page.tsx
git commit -m "feat(shell): stream the goals/portfolios/workload shells"
```

---

## Task 11: Convert **settings** + **admin** layouts

`settings` is a straight conversion. `admin` keeps its `requirePlatformAdmin()` gate — that gate **must run before any Suspense boundary** so it can still produce a real redirect (per `streaming.md` "When does streaming start"): call it at the top of the admin layout (it's a fast auth check, not the heavy data), then render `AuthenticatedShell`.

**Files:**

- Modify: `src/app/settings/layout.tsx`, `src/app/admin/layout.tsx`, and their `page.tsx` segments.

- [ ] **Step 1: Convert settings layout**

```tsx
// src/app/settings/layout.tsx
import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export const unstable_instant = false;

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
```

- [ ] **Step 2: Convert admin layout (keep the gate before any boundary)**

```tsx
// src/app/admin/layout.tsx
import type { ReactNode } from "react";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export const unstable_instant = false;

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Gate runs before any Suspense boundary → still a real redirect, not a
  // mid-stream client redirect. This await is a fast auth check, not the heavy
  // shell data (which streams inside AuthenticatedShell).
  await requirePlatformAdmin();
  return (
    <AuthenticatedShell>
      <div className="w-full px-6 py-8 lg:px-10">{children}</div>
    </AuthenticatedShell>
  );
}
```

> Note: `requirePlatformAdmin()` must exist and redirect (it's used by the current admin layout). Confirm its import path; the current layout imports the gate — reuse the same symbol.

- [ ] **Step 3: Add instant validation to the page segments**

```tsx
// top of src/app/settings/page.tsx and src/app/admin/page.tsx (and admin subpages as desired)
export const unstable_instant = { prefetch: "static" };
```

- [ ] **Step 4: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/layout.tsx src/app/settings/page.tsx src/app/admin/layout.tsx src/app/admin/page.tsx
git commit -m "feat(shell): stream the settings + admin shells"
```

---

## Task 12: Final verification + dead-code sweep

**Files:**

- Possibly modify: remove now-unused imports/types from `src/components/app-shell.tsx` (`AppShellUser`/`AppShellWorkspace`/`AppShellDashboard`/`AppShellOrg` types — keep `AppShellUser` if `user-menu.tsx` imports it; delete the rest if unreferenced).

- [ ] **Step 1: Grep for dead references**

Run: `pnpm exec tsc --noEmit` then `grep -rn "AppShellOrg\|AppShellWorkspace\|AppShellDashboard" src/`
Remove any type/prop now unreferenced. Keep `AppShellUser` only if still imported.

- [ ] **Step 2: Confirm no layout still awaits shell data at the top**

Run: `grep -rn "Promise.all\|await requireUser\|listMyBoards" src/app/*/layout.tsx`
Expected: only `admin/layout.tsx`'s `await requirePlatformAdmin()` remains (the gate). No `Promise.all` of shell data in any layout.

- [ ] **Step 3: Full gate (final)**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green; build output shows the authenticated routes producing a partial-prerender shell.

- [ ] **Step 4: Commit**

```bash
git add -p   # stage only the dead-code removals by hunk
git commit -m "chore(shell): drop unused AppShell data types after streaming refactor"
```

---

## Execution DAG

**Per-task interfaces (Consumes → Produces):**

| Task                                  | Consumes                               | Produces                                                                         |
| ------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| 1 Skeleton primitive                  | —                                      | `<Skeleton>`                                                                     |
| 2 Shell skeletons                     | `<Skeleton>`                           | `SidebarNavSkeleton`, `HeaderUserSkeleton`                                       |
| 3 Sidebar navSlot                     | —                                      | `Sidebar({navSlot})` + `group/sidebar` `data-collapsed`                          |
| 4 SidebarNavData                      | (renders into Sidebar slot)            | `SidebarNavData`                                                                 |
| 5 HeaderUserData                      | —                                      | `HeaderUserData`, `user-menu.tsx`                                                |
| 6 AppShell frame + AuthenticatedShell | T2, T3, T4, T5 (+`CommandPaletteData`) | `AppShell` frame, `AuthenticatedShell`, `TimeZoneBoundary`, `CommandPaletteData` |
| 7 Flag + boards (ATOMIC)              | T6                                     | `cacheComponents:true`, streamed boards shell                                    |
| 8 instant() e2e                       | T7                                     | e2e regression guard                                                             |
| 9 dashboards                          | T6 (+ flag from T7)                    | streamed dashboards shell                                                        |
| 10 goals/portfolios/workload          | T6 (+ flag from T7)                    | streamed shells (×3)                                                             |
| 11 settings/admin                     | T6 (+ flag from T7)                    | streamed shells (×2)                                                             |
| 12 final sweep                        | T7–T11                                 | clean build                                                                      |

**Dependency graph:**

```
T1 → T2 ┐
T3 ─────┤
T4 ─────┼─→ T6 → T7 ┬─→ T8
T5 ─────┘            ├─→ T9
                     ├─→ T10
                     └─→ T11 ─┐
T8,T9,T10 ───────────────────┴→ T12
```

**Parallel batches (waves of concurrent agents, each in its own worktree per working-agreement #1/#6):**

- **Batch A (3 parallel):** T1, T3, T5 — no shared files (T1 = ui/, T3 = sidebar.tsx, T5 = shell/ + app-shell UserMenu extract). _Note: T5 lightly touches `app-shell.tsx` (removing UserMenu) and T6 rewrites it — sequence T5 before T6; T5 stays in Batch A only if it does the UserMenu move without colliding with T3/T1, which it does._
- **Batch B (1):** T2 (needs T1) — can run alongside Batch A's T3/T5 once T1 lands; effectively T2 trails T1 by one step.
- **Batch C (1):** T6 — the join; needs T2+T3+T4+T5. T4 needs nothing but is naturally grouped with T6's data slots; run T4 in Batch A/B window (it has no file collision).
- **Batch D (1, ATOMIC):** T7 — flag flip + boards; gates the whole rest (build must be green).
- **Batch E (4 parallel):** T8, T9, T10, T11 — independent sections/files after T7. Each its own worktree; no shared files (distinct `src/app/<section>/` trees; T8 is e2e-only).
- **Batch F (1):** T12 — final sweep after E.

**Critical path (wall-clock floor):** T1 → T2 → T6 → T7 → (longest of T8–T11, all ~equal) → T12. ≈ **6 sequential hops** through **12 tasks**, with the widest parallel wave = **4** (Batch E).

**Headline:** 12 tasks; 6 parallel batches (widest wave 4); critical path T1→T2→T6→T7→T11→T12.

---

## How to test this (hand to the user after merge)

1. Pull `develop`. Run `pnpm dev` (or hit the preview deploy).
2. Sign in, navigate to **/boards**. Throttle the network (DevTools → Network → Slow 3G) and hard-reload. **Expected:** the sidebar frame, brand, collapse toggle, header bar, and command trigger paint **immediately**; the board/dashboard nav lists and the header avatar/bell show **skeleton placeholders** that then fill in — with **no layout shift** when they do.
3. Click between **/boards → /dashboards → /goals**. **Expected:** the chrome never blanks; only the data regions re-stream behind the already-painted shell.
4. Open a board, then switch to a sibling board (`/boards/A → /boards/B`). **Expected:** the sidebar stays put (no skeleton flash) — shared layout is preserved; only the board content swaps.
5. Toggle the sidebar collapse (`⌘\`). **Expected:** instant, no network request, state persists across reload.
6. As a platform admin, open the header user menu. **Expected:** the **Platform admin** link is present (it streams in with the header user region).
7. Build check (maintainer): `pnpm build` succeeds and the boards/dashboards/etc. routes show a partial-prerender (static shell) in the build output.
