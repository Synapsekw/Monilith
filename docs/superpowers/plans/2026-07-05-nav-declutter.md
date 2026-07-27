# Navigation Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the authenticated sidebar into Direction B — a grouped, collapsible rail with a top workspace switcher that scopes the Boards + Dashboards lists — and move Platform admin to a single top-right button, removing the dead "Inbox".

**Architecture:** The sidebar is a client component (`SidebarNav`) fed by one streamed server loader (`getSidebarNavData`). We add a persisted **active-workspace** cookie read in the loader, filter the cached board/dashboard reads by it, and thread the active workspace into a new `WorkspaceSwitcher`. A reusable `NavSection` collapsible primitive (collapse state in the existing Zustand `useUIStore`) groups the static items and wraps the Boards/Dashboards lists. Platform admin becomes a header `PlatformAdminMenu` (reusing the existing `/admin/*` links) and is removed from the sidebar and the user menu.

**Tech Stack:** Next.js 16 (App Router, RSC + `use cache`), React 19, TypeScript strict, Zustand (persisted), shadcn/ui + Tailwind v4, lucide-react, Vitest + @testing-library/react, Supabase (service client, RLS elsewhere).

## Global Constraints

Copied verbatim from the spec / AGENTS.md — every task's requirements implicitly include these:

- **Server Components by default.** `"use client"` only for interactivity; **all mutations go through Server Actions**.
- **Monolith tokens only** (`bg-sidebar`, `bg-accent` hover, `bg-primary/80` active, `text-muted-foreground`, `border`). Chrome stays monochrome; the brand accent marks active/focus only. Icons: lucide-react, `size-4` inline / `size-3.5` dense.
- **Data-fetching budget:** in-page toggles (section collapse, opening menus) are **client state / `useUIStore`, 0 server round-trips**. **Switching workspace changes server-data scope → Server Action (`setActiveWorkspace`) + `router.refresh()`**, exactly one refetch of the scoped nav lists.
- **Bounded reads:** board/dashboard nav reads filter by the indexed `workspace_id` FK.
- **Commit identity pinned:** author every commit as `Danijel Jovanovic <info@synapse-solutions.ai>`. Commit subjects are **lowercase** after `type(scope):`, include a descriptive **body** and a `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- **Isolation:** run in a git worktree on `task/nav-declutter` (`scripts/start-task.sh nav-declutter`), not the main checkout.
- **Definition of done:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green, then `scripts/finish-task.sh`.

## File map

**New**

- `src/lib/workspaces/active.ts` — `ACTIVE_WS_COOKIE` const + `getActiveWorkspaceId(workspaces)` (server-only, reads cookie).
- `src/lib/workspaces/active-actions.ts` — `setActiveWorkspace(workspaceId)` server action (sets cookie).
- `src/components/shell/nav-section.tsx` — reusable collapsible group.
- `src/components/shell/workspace-switcher.tsx` — top-of-sidebar switcher.
- `src/components/shell/platform-admin-menu.tsx` — top-right admin button + dropdown.
- Test siblings for each of the above.

**Modified**

- `src/stores/ui.ts` — add `collapsedSections` + `toggleSection` (persisted).
- `src/lib/boards/queries-cached.ts` — `listMyBoardsCached(userId, workspaceId?)`.
- `src/lib/dashboards/queries-cached.ts` — `listDashboardsCached(orgId, workspaceId?)`.
- `src/components/shell/sidebar-nav-data.tsx` — read active workspace, filter, pass new props.
- `src/components/shell/sidebar-nav.tsx` — restructure to Direction B.
- `src/components/boards/BoardsNav.tsx` — `activeWorkspaceId` prop + `NavSection` wrapper.
- `src/components/dashboards/DashboardsNav.tsx` — `activeWorkspaceId` prop + `NavSection` wrapper.
- `src/components/shell/user-menu.tsx` — remove the Platform-admin item.
- `src/components/shell/header-user-data.tsx` — mount `PlatformAdminMenu`.
- `src/components/workspaces/NewWorkspaceDialog.tsx` — support controlled / triggerless mode.
- `src/app/(app)/settings/page.tsx` — add a "Workspaces" management card (reuses `WorkspaceNavItem`).
- `src/components/shell/sidebar-nav.test.tsx` — update for the new structure.

**Retired (no longer mounted; left in tree):** `src/components/platform/PlatformNav.tsx`, `src/components/workspaces/WorkspaceNavItem.tsx` (reused in Settings).

## Execution DAG

- **Batch 1 (no unmet deps):** Task 1 (store), Task 2 (active-workspace lib), Task 3 (scoped queries), Task 6 (`PlatformAdminMenu`), Task 7 (user-menu removal).
- **Batch 2:** Task 4 (`NavSection` — needs Task 1), Task 5 (`WorkspaceSwitcher` — needs Task 2), Task 8 (header mount — needs Task 6).
- **Batch 3:** Task 9 (`sidebar-nav-data` — needs Tasks 2, 3), Task 10 (`BoardsNav`/`DashboardsNav` — needs Task 4), Task 11 (Settings card).
- **Batch 4:** Task 12 (`sidebar-nav` restructure + test update — needs Tasks 4, 5, 9, 10), Task 13 (final verification).

Critical path: Task 2 → Task 9 → Task 12 → Task 13.

---

### Task 1: UI store — per-section collapse state

**Files:**

- Modify: `src/stores/ui.ts`
- Test: `src/stores/ui.test.ts`

**Interfaces:**

- Produces: `useUIStore` gains `collapsedSections: Record<string, boolean>` and `toggleSection(key: string): void`. A section is **open when its key is absent or `false`** (default-open). Persisted to localStorage alongside `sidebarCollapsed`.

- [ ] **Step 1: Write the failing test** — append to `src/stores/ui.test.ts`:

```ts
describe("collapsedSections", () => {
  beforeEach(() => {
    useUIStore.setState({ collapsedSections: {} });
  });

  it("defaults a section to open (absent key)", () => {
    expect(useUIStore.getState().collapsedSections["boards"]).toBeUndefined();
  });

  it("toggleSection flips a section collapsed then open", () => {
    useUIStore.getState().toggleSection("boards");
    expect(useUIStore.getState().collapsedSections["boards"]).toBe(true);
    useUIStore.getState().toggleSection("boards");
    expect(useUIStore.getState().collapsedSections["boards"]).toBe(false);
  });

  it("keeps sections independent", () => {
    useUIStore.getState().toggleSection("boards");
    expect(useUIStore.getState().collapsedSections["planning"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`toggleSection is not a function`):

```
pnpm vitest run src/stores/ui.test.ts
```

- [ ] **Step 3: Implement.** In `src/stores/ui.ts` add to the `UIState` interface (after `hasHydrated` members):

```ts
  collapsedSections: Record<string, boolean>;
  toggleSection: (key: string) => void;
```

Add to the store initializer (after the `newDashboardOpen` block):

```ts
      collapsedSections: {},
      toggleSection: (key) =>
        set((s) => ({
          collapsedSections: {
            ...s.collapsedSections,
            [key]: !s.collapsedSections[key],
          },
        })),
```

Update `partialize` so the collapse map persists:

```ts
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        collapsedSections: s.collapsedSections,
      }),
```

- [ ] **Step 4: Run — expect PASS:** `pnpm vitest run src/stores/ui.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/stores/ui.ts src/stores/ui.test.ts
git commit -m "feat(nav): add per-section collapse state to the ui store"
```

---

### Task 2: Active-workspace cookie (lib + server action)

**Files:**

- Create: `src/lib/workspaces/active.ts`
- Create: `src/lib/workspaces/active-actions.ts`
- Test: `src/lib/workspaces/active.test.ts`

**Interfaces:**

- Produces: `ACTIVE_WS_COOKIE = "pulse_active_ws"`; `getActiveWorkspaceId(workspaces: { id: string }[]): Promise<string>` — returns the cookie value if it matches a passed workspace, else the first workspace's id, else `""`. `setActiveWorkspace(workspaceId: string): Promise<void>` — server action, sets the cookie (1-year, `sameSite: "lax"`, `path: "/"`).

- [ ] **Step 1: Write the failing test** — `src/lib/workspaces/active.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      store.has(n) ? { name: n, value: store.get(n)! } : undefined,
  }),
}));

import { getActiveWorkspaceId } from "./active";

afterEach(() => store.clear());

describe("getActiveWorkspaceId", () => {
  const ws = [{ id: "w1" }, { id: "w2" }];

  it("returns the cookie value when it matches a workspace", async () => {
    store.set("pulse_active_ws", "w2");
    expect(await getActiveWorkspaceId(ws)).toBe("w2");
  });

  it("falls back to the first workspace when the cookie is stale", async () => {
    store.set("pulse_active_ws", "gone");
    expect(await getActiveWorkspaceId(ws)).toBe("w1");
  });

  it("falls back to the first workspace when no cookie is set", async () => {
    expect(await getActiveWorkspaceId(ws)).toBe("w1");
  });

  it("returns empty string when there are no workspaces", async () => {
    expect(await getActiveWorkspaceId([])).toBe("");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found): `pnpm vitest run src/lib/workspaces/active.test.ts`

- [ ] **Step 3: Implement `src/lib/workspaces/active.ts`:**

```ts
import "server-only";
import { cookies } from "next/headers";

/** Persisted "current workspace" selection. Read in the sidebar loader (outside
 * any `use cache` scope) and passed into the cached board/dashboard reads. */
export const ACTIVE_WS_COOKIE = "pulse_active_ws";

/**
 * The active workspace id: the cookie value when it still matches one of the
 * user's workspaces, otherwise the first workspace (stable default), otherwise
 * "". Validating against the passed list means a deleted/foreign id can never
 * scope the nav to nothing.
 */
export async function getActiveWorkspaceId(
  workspaces: { id: string }[],
): Promise<string> {
  const jar = await cookies();
  const raw = jar.get(ACTIVE_WS_COOKIE)?.value;
  if (raw && workspaces.some((w) => w.id === raw)) return raw;
  return workspaces[0]?.id ?? "";
}
```

- [ ] **Step 4: Implement `src/lib/workspaces/active-actions.ts`:**

```ts
"use server";
import { cookies } from "next/headers";
import { ACTIVE_WS_COOKIE } from "./active";

/**
 * Switch the active workspace. Sets the cookie only — the caller triggers a
 * `router.refresh()` so the streamed sidebar re-renders with the newly scoped
 * board/dashboard lists (rule #5: a change of server-data scope, not an in-page
 * toggle). No revalidateTag: the cached reads are keyed by workspace id, so a
 * switch simply hits a different cache entry.
 */
export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACTIVE_WS_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
```

- [ ] **Step 5: Run — expect PASS:** `pnpm vitest run src/lib/workspaces/active.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspaces/active.ts src/lib/workspaces/active-actions.ts src/lib/workspaces/active.test.ts
git commit -m "feat(nav): add active-workspace cookie helper and switch action"
```

---

### Task 3: Workspace-scoped board & dashboard queries

**Files:**

- Modify: `src/lib/boards/queries-cached.ts:13-34`
- Modify: `src/lib/dashboards/queries-cached.ts:25-40`
- Test: `src/lib/boards/queries-cached.test.ts` (extend if present; else create)

**Interfaces:**

- Consumes: nothing.
- Produces: `listMyBoardsCached(userId: string, workspaceId?: string)` — when `workspaceId` is a non-empty string, adds `.eq("workspace_id", workspaceId)`. `listDashboardsCached(orgId: string, workspaceId?: string)` — same. `cacheTag` stays `boardsTag(userId)` / `dashboardsTag(orgId)` (invalidation is per-user/per-org across all workspaces).

- [ ] **Step 1: Write the failing test** — `src/lib/boards/queries-cached.test.ts` (create if absent):

```ts
import { describe, expect, it, vi } from "vitest";

// Chainable query-builder stub that records the filters applied.
function makeClient(rows: unknown[]) {
  const calls: Array<[string, unknown]> = [];
  const qb: Record<string, unknown> = {};
  const chain = (name: string, val?: unknown) => {
    if (val !== undefined) calls.push([name, val]);
    return qb;
  };
  qb.select = () => chain("select");
  qb.eq = (col: string, val: unknown) => chain("eq:" + col, val);
  qb.order = () => Promise.resolve({ data: rows, error: null });
  return {
    client: { from: () => ({ select: () => qb }) },
    calls,
  };
}

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));
import { createServiceClient } from "@/lib/supabase/service";
import { listMyBoardsCached } from "./queries-cached";

describe("listMyBoardsCached workspace scoping", () => {
  it("adds a workspace_id filter when a workspaceId is passed", async () => {
    const { client, calls } = makeClient([]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    await listMyBoardsCached("u1", "w2");
    expect(calls).toContainEqual(["eq:created_by", "u1"]);
    expect(calls).toContainEqual(["eq:workspace_id", "w2"]);
  });

  it("omits the workspace filter when no workspaceId is passed", async () => {
    const { client, calls } = makeClient([]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    await listMyBoardsCached("u1");
    expect(calls).not.toContainEqual(["eq:workspace_id", expect.anything()]);
  });
});
```

> Note: `"use cache"` is a no-op under Vitest (the directive is stripped by the test transform), so the function runs as a plain async function. If the suite errors on the directive, mirror the existing `queries-cached` test's setup in this folder.

- [ ] **Step 2: Run — expect FAIL** (`workspace_id` filter never applied): `pnpm vitest run src/lib/boards/queries-cached.test.ts`

- [ ] **Step 3: Implement — `src/lib/boards/queries-cached.ts`.** Change the signature and query:

```ts
export async function listMyBoardsCached(
  userId: string,
  workspaceId?: string,
): Promise<BoardListEntry[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(boardsTag(userId));

  const supabase = createServiceClient();
  let query = supabase
    .from("boards")
    .select("id, name, workspace_id, position, board_members(user_id)")
    .eq("created_by", userId);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data, error } = await query.order("position", { ascending: true });
  if (error) return [];
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    workspace_id: b.workspace_id,
    position: b.position,
    shared_out: (b.board_members ?? []).length > 0,
  }));
}
```

- [ ] **Step 4: Implement — `src/lib/dashboards/queries-cached.ts`.** Change the signature and query:

```ts
export async function listDashboardsCached(
  orgId: string,
  workspaceId?: string,
): Promise<Dashboard[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(dashboardsTag(orgId));

  const supabase = createServiceClient();
  let query = supabase.from("dashboards").select("*").eq("org_id", orgId);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data } = await query
    .order("created_at", { ascending: true })
    .limit(DASHBOARDS_LIMIT);
  return data ?? [];
}
```

- [ ] **Step 5: Run — expect PASS:** `pnpm vitest run src/lib/boards/queries-cached.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/queries-cached.ts src/lib/dashboards/queries-cached.ts src/lib/boards/queries-cached.test.ts
git commit -m "feat(nav): scope cached board and dashboard lists by workspace"
```

---

### Task 4: `NavSection` collapsible primitive

**Files:**

- Create: `src/components/shell/nav-section.tsx`
- Test: `src/components/shell/nav-section.test.tsx`

**Interfaces:**

- Consumes: `useUIStore` `collapsedSections` + `toggleSection` (Task 1).
- Produces: `NavSection({ storageKey, title, titleHref?, icon?, action?, children })`. Header is a chevron toggle + title (a `<Link>` when `titleHref`, else a toggle button) + optional right-aligned `action` node. Children render only when open (default open).

- [ ] **Step 1: Write the failing test** — `src/components/shell/nav-section.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavSection } from "./nav-section";
import { useUIStore } from "@/stores/ui";

beforeEach(() => useUIStore.setState({ collapsedSections: {} }));

describe("NavSection", () => {
  it("renders children when open (default)", () => {
    render(
      <NavSection storageKey="planning" title="Planning">
        <a href="/goals">Goals</a>
      </NavSection>,
    );
    expect(screen.getByText("Goals")).toBeInTheDocument();
  });

  it("hides children after toggling collapsed", async () => {
    render(
      <NavSection storageKey="planning" title="Planning">
        <a href="/goals">Goals</a>
      </NavSection>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /collapse planning/i }),
    );
    expect(screen.queryByText("Goals")).not.toBeInTheDocument();
  });

  it("renders the title as a link when titleHref is set", () => {
    render(
      <NavSection storageKey="dash" title="Dashboards" titleHref="/dashboards">
        <span>child</span>
      </NavSection>,
    );
    expect(screen.getByRole("link", { name: "Dashboards" })).toHaveAttribute(
      "href",
      "/dashboards",
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found): `pnpm vitest run src/components/shell/nav-section.test.tsx`

- [ ] **Step 3: Implement `src/components/shell/nav-section.tsx`:**

```tsx
"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useUIStore } from "@/stores/ui";

/**
 * A labelled, collapsible sidebar group. Collapse state lives in `useUIStore`
 * (client-only, persisted) keyed by `storageKey`, so folding a group is 0 server
 * round-trips. Default open (absent key). The chevron and — when there is no
 * `titleHref` — the title both toggle; a `titleHref` makes the title a real link
 * (e.g. Dashboards → /dashboards) while the chevron still toggles.
 */
export function NavSection({
  storageKey,
  title,
  titleHref,
  icon: Icon,
  action,
  children,
}: {
  storageKey: string;
  title: string;
  titleHref?: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
}) {
  const collapsedSections = useUIStore((s) => s.collapsedSections);
  const toggleSection = useUIStore((s) => s.toggleSection);
  const open = !collapsedSections[storageKey];
  const bodyId = `nav-section-${storageKey}`;

  const titleCn =
    "text-muted-foreground hover:text-foreground text-xs font-semibold uppercase tracking-wide transition-colors";

  return (
    <div className="flex flex-col gap-0.5 px-2 pt-2">
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <button
          type="button"
          onClick={() => toggleSection(storageKey)}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
          className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded transition-colors"
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        {Icon ? <Icon className="text-muted-foreground size-3.5" /> : null}
        {titleHref ? (
          <Link href={titleHref} className={titleCn}>
            {title}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => toggleSection(storageKey)}
            className={titleCn}
          >
            {title}
          </button>
        )}
        {action ? (
          <div className="ml-auto flex items-center">{action}</div>
        ) : null}
      </div>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-0.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS:** `pnpm vitest run src/components/shell/nav-section.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/nav-section.tsx src/components/shell/nav-section.test.tsx
git commit -m "feat(nav): add reusable collapsible NavSection primitive"
```

---

### Task 5: `WorkspaceSwitcher` (+ controlled `NewWorkspaceDialog`)

**Files:**

- Modify: `src/components/workspaces/NewWorkspaceDialog.tsx`
- Create: `src/components/shell/workspace-switcher.tsx`
- Test: `src/components/shell/workspace-switcher.test.tsx`

**Interfaces:**

- Consumes: `setActiveWorkspace` (Task 2); `NewWorkspaceDialog` (controlled mode below).
- Produces: `WorkspaceSwitcher({ workspaces, activeWorkspaceId, collapsed?, isOrgAdmin? })`. `NewWorkspaceDialog` gains optional `{ open?, onOpenChange?, showTrigger? }` (default `showTrigger = true`, uncontrolled — backward compatible).

- [ ] **Step 1: Make `NewWorkspaceDialog` controllable.** Replace its signature/return in `src/components/workspaces/NewWorkspaceDialog.tsx`:

```tsx
export function NewWorkspaceDialog({
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
} = {}) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp ?? openLocal;
  const setOpen = (next: boolean) => {
    setOpenLocal(next);
    onOpenChange?.(next);
  };
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // ...submit() unchanged...
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <DialogTrigger asChild>
          <button
            aria-label="New workspace"
            className="text-muted-foreground hover:text-foreground ml-auto"
          >
            <Plus className="size-4" />
          </button>
        </DialogTrigger>
      ) : null}
      {/* DialogContent unchanged */}
```

Leave `submit()` and `DialogContent` exactly as they are.

- [ ] **Step 2: Write the failing test** — `src/components/shell/workspace-switcher.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { setActiveWorkspace } from "@/lib/workspaces/active-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/workspaces/active-actions", () => ({
  setActiveWorkspace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/workspaces/actions", () => ({ createWorkspace: vi.fn() }));

const ws = [
  { id: "w1", name: "Product" },
  { id: "w2", name: "Growth" },
];

function renderSwitcher(active = "w1") {
  return render(
    <TooltipProvider>
      <WorkspaceSwitcher
        workspaces={ws}
        activeWorkspaceId={active}
        isOrgAdmin
      />
    </TooltipProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("WorkspaceSwitcher", () => {
  it("shows the active workspace name", () => {
    renderSwitcher("w2");
    expect(screen.getByText("Growth")).toBeInTheDocument();
  });

  it("switches workspace and refreshes on select", async () => {
    renderSwitcher("w1");
    await userEvent.click(
      screen.getByRole("button", { name: /switch workspace/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /growth/i }));
    expect(vi.mocked(setActiveWorkspace)).toHaveBeenCalledWith("w2");
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (module not found): `pnpm vitest run src/components/shell/workspace-switcher.test.tsx`

- [ ] **Step 4: Implement `src/components/shell/workspace-switcher.tsx`:**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react";
import { setActiveWorkspace } from "@/lib/workspaces/active-actions";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Workspace = { id: string; name: string };

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  collapsed = false,
  isOrgAdmin = false,
}: {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  collapsed?: boolean;
  isOrgAdmin?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);

  const active =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];
  const initial = (active?.name ?? "?").charAt(0).toUpperCase();

  function switchTo(id: string) {
    if (id === activeWorkspaceId) return;
    startTransition(async () => {
      await setActiveWorkspace(id);
      router.refresh();
    });
  }

  if (workspaces.length === 0) return null;

  const avatar = (
    <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
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
                aria-label="Switch workspace"
                className="hover:bg-accent flex size-9 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {avatar}
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{active?.name}</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger
            aria-label="Switch workspace"
            className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
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
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => switchTo(w.id)}
              className="gap-2"
            >
              <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded text-[10px] font-semibold">
                {w.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.id === activeWorkspaceId ? (
                <Check className="text-primary size-4 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setNewOpen(true)} className="gap-2">
            <Plus className="size-4" />
            New workspace
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings" className="flex items-center gap-2">
              <Settings2 className="size-4" />
              Manage workspaces
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Controlled, triggerless — opened from the menu item above. */}
      <NewWorkspaceDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        showTrigger={false}
      />
    </div>
  );
}
```

- [ ] **Step 5: Run — expect PASS:** `pnpm vitest run src/components/shell/workspace-switcher.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/workspace-switcher.tsx src/components/shell/workspace-switcher.test.tsx src/components/workspaces/NewWorkspaceDialog.tsx
git commit -m "feat(nav): add top-of-sidebar workspace switcher"
```

---

### Task 6: `PlatformAdminMenu` (top-right button)

**Files:**

- Create: `src/components/shell/platform-admin-menu.tsx`
- Test: `src/components/shell/platform-admin-menu.test.tsx`

**Interfaces:**

- Produces: `PlatformAdminMenu({ isPlatformAdmin?, newCount? })` — renders **nothing** when `!isPlatformAdmin`; otherwise a shield `Button` (aria-label "Platform admin") opening a dropdown with the five `/admin/*` links + a "Feedback" badge when `newCount > 0`, headed by a SUPER label.

- [ ] **Step 1: Write the failing test** — `src/components/shell/platform-admin-menu.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAdminMenu } from "./platform-admin-menu";

describe("PlatformAdminMenu", () => {
  it("renders nothing for non-admins", () => {
    const { container } = render(<PlatformAdminMenu isPlatformAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the five admin destinations for admins", async () => {
    render(<PlatformAdminMenu isPlatformAdmin newCount={3} />);
    await userEvent.click(
      screen.getByRole("button", { name: /platform admin/i }),
    );
    expect(screen.getByRole("menuitem", { name: /overview/i })).toHaveAttribute(
      "href",
      "/admin",
    );
    for (const label of ["Organizations", "Users", "Audit log", "Feedback"]) {
      expect(
        screen.getByRole("menuitem", { name: new RegExp(label, "i") }),
      ).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found): `pnpm vitest run src/components/shell/platform-admin-menu.test.tsx`

- [ ] **Step 3: Implement `src/components/shell/platform-admin-menu.tsx`:**

```tsx
"use client";

import Link from "next/link";
import {
  Shield,
  LayoutDashboard,
  Building2,
  Users,
  ScrollText,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const LINKS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/feedback", label: "Feedback", icon: MessageSquare },
] as const;

/**
 * The single home for platform (super-admin) tools — a header button, gated on
 * `isPlatformAdmin`. Replaces the old bottom-of-sidebar PlatformNav group and
 * the duplicate item in the user menu. A dot on the button + a count next to
 * Feedback surface unresolved feedback.
 */
export function PlatformAdminMenu({
  isPlatformAdmin = false,
  newCount = 0,
}: {
  isPlatformAdmin?: boolean;
  newCount?: number;
}) {
  if (!isPlatformAdmin) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Platform admin"
          className="text-muted-foreground hover:text-foreground relative"
        >
          <Shield className="size-5" />
          {newCount > 0 ? (
            <span
              aria-hidden
              className="bg-primary absolute top-1.5 right-1.5 size-2 rounded-full"
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Shield className="size-3.5" />
          Platform admin
          <span className="bg-primary/15 text-primary ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider">
            SUPER
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LINKS.map((l) => (
          <DropdownMenuItem asChild key={l.href}>
            <Link href={l.href} className="flex items-center gap-2">
              <l.icon className="size-4" />
              {l.label}
              {l.href === "/admin/feedback" && newCount > 0 ? (
                <span className="bg-primary/15 text-primary ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold tabular-nums">
                  {newCount}
                </span>
              ) : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Run — expect PASS:** `pnpm vitest run src/components/shell/platform-admin-menu.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/platform-admin-menu.tsx src/components/shell/platform-admin-menu.test.tsx
git commit -m "feat(nav): add top-right platform-admin menu button"
```

---

### Task 7: Remove Platform admin from the user menu

**Files:**

- Modify: `src/components/shell/user-menu.tsx:1-68`
- Test: `src/components/shell/user-menu.test.tsx` (create)

**Interfaces:**

- Produces: `UserMenu({ user })` — the `isPlatformAdmin` prop and the `/admin` item are removed. Keeps Settings + Sign out.

- [ ] **Step 1: Write the failing test** — `src/components/shell/user-menu.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserMenu } from "./user-menu";

vi.mock("@/app/auth/actions", () => ({ signOut: vi.fn() }));

describe("UserMenu", () => {
  it("no longer offers a Platform admin item", async () => {
    render(<UserMenu user={{ email: "a@b.co", full_name: "Ada" }} />);
    await userEvent.click(
      screen.getByRole("button", { name: /open user menu/i }),
    );
    expect(
      screen.getByRole("menuitem", { name: /settings/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /platform admin/i }),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (the item is still rendered when the prop is passed; here it compiles because the prop is optional, but the menu will still contain the item only when `isPlatformAdmin` — with the prop gone the test asserts absence). Run: `pnpm vitest run src/components/shell/user-menu.test.tsx`. If it passes prematurely because the default `isPlatformAdmin` is undefined, proceed — Step 3 still removes the dead branch and the prop.

- [ ] **Step 3: Implement — `src/components/shell/user-menu.tsx`.** Remove the `Shield` import, drop `isPlatformAdmin` from the props, and delete the admin `DropdownMenuItem`. Resulting file:

```tsx
import Link from "next/link";
import { Settings } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type AppShellUser = {
  email?: string | null;
  full_name?: string | null;
};

function initialFor(user: AppShellUser): string {
  const source = user.full_name?.trim() || user.email?.trim() || "";
  return source ? source.charAt(0).toUpperCase() : "?";
}

export function UserMenu({ user }: { user: AppShellUser }) {
  const label = user.full_name?.trim() || user.email || "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open user menu"
        className="bg-surface text-foreground hover:bg-accent flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {initialFor(user)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center gap-2">
            <Settings className="size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild variant="destructive">
          <form action={signOut}>
            <button type="submit" className="w-full text-left">
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Run — expect PASS:** `pnpm vitest run src/components/shell/user-menu.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/user-menu.tsx src/components/shell/user-menu.test.tsx
git commit -m "refactor(nav): drop platform-admin item from the user menu"
```

---

### Task 8: Mount `PlatformAdminMenu` in the header

**Files:**

- Modify: `src/components/shell/header-user-data.tsx:1-30`

**Interfaces:**

- Consumes: `PlatformAdminMenu` (Task 6), the already-computed `platformAdmin`, and `countNewFeedback` (mirrors `sidebar-nav-data`).
- Produces: the header user region now leads with the admin button; `UserMenu` is called without `isPlatformAdmin`.

- [ ] **Step 1: Implement — replace `src/components/shell/header-user-data.tsx` body:**

```tsx
import { requireUser } from "@/lib/auth/session";
import { isPlatformAdminCached } from "@/lib/platform/guard";
import { countNewFeedback } from "@/lib/feedback/queries";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { PlatformAdminMenu } from "@/components/shell/platform-admin-menu";
import { UserMenu } from "@/components/shell/user-menu";

/**
 * Streamed header user region (platform-admin button + notifications bell +
 * feedback + account menu). Rendered behind a <Suspense> in the authenticated
 * layout so its cookie-bound awaits stream into the static shell.
 */
export async function HeaderUserData() {
  const user = await requireUser();
  const platformAdmin = await isPlatformAdminCached(user.id);
  const newFeedbackCount = platformAdmin ? await countNewFeedback() : 0;
  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null;

  return (
    <>
      <PlatformAdminMenu
        isPlatformAdmin={platformAdmin}
        newCount={newFeedbackCount}
      />
      <NotificationsBell userId={user.id} />
      <FeedbackButton />
      <UserMenu user={{ email: user.email, full_name: fullName }} />
    </>
  );
}
```

- [ ] **Step 2: Verify the app-shell test still passes** (it renders the header region): `pnpm vitest run src/components/app-shell.test.tsx`. If it asserted a Platform-admin link inside the user menu, update that assertion to look for the header button (`getByRole("button", { name: /platform admin/i })`).

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/header-user-data.tsx
git commit -m "feat(nav): mount the platform-admin button in the header"
```

---

### Task 9: `sidebar-nav-data` — read active workspace and scope the lists

**Files:**

- Modify: `src/components/shell/sidebar-nav-data.tsx:24-62`

**Interfaces:**

- Consumes: `getActiveWorkspaceId` (Task 2), the workspace-scoped queries (Task 3).
- Produces: `getSidebarNavData()` now returns an added `activeWorkspaceId: string`, and the returned `boards`/`dashboards` are scoped to it. (`SidebarNav`'s prop type gains `activeWorkspaceId` in Task 12; until then TS may flag the extra field — that is expected mid-batch.)

- [ ] **Step 1: Implement — replace the body of `getSidebarNavData` (`src/components/shell/sidebar-nav-data.tsx`):**

```tsx
import { getUser, getUserOrgs } from "@/lib/auth/session";
import {
  listMyBoardsCached,
  listSharedBoardsCached,
} from "@/lib/boards/queries-cached";
import { listDashboardsCached } from "@/lib/dashboards/queries-cached";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import { isPlatformAdminCached } from "@/lib/platform/guard";
import { isOrgAdminCached } from "@/lib/org/guard";
import { countNewFeedback } from "@/lib/feedback/queries";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import type { ComponentProps } from "react";

type SidebarNavProps = ComponentProps<typeof SidebarNav>;

export async function getSidebarNavData(): Promise<
  Omit<SidebarNavProps, "forceExpanded">
> {
  const [user, orgs] = await Promise.all([getUser(), getUserOrgs()]);
  const userId = user?.id ?? "";
  const orgId = orgs[0]?.id ?? "";

  // Workspaces first: the active-workspace cookie is validated against this list,
  // and the resolved id scopes the board + dashboard reads below.
  const workspaces = await listWorkspacesCached(orgId);
  const activeWorkspaceId = await getActiveWorkspaceId(workspaces);

  const [boards, sharedBoards, dashboards, platformAdmin, orgAdmin] =
    await Promise.all([
      listMyBoardsCached(userId, activeWorkspaceId),
      listSharedBoardsCached(userId),
      listDashboardsCached(orgId, activeWorkspaceId),
      isPlatformAdminCached(userId),
      isOrgAdminCached(userId, orgId),
    ]);

  const newFeedbackCount = platformAdmin ? await countNewFeedback() : 0;

  return {
    boards,
    sharedBoards,
    workspaces,
    activeWorkspaceId,
    dashboards: dashboards.map((d) => ({ id: d.id, name: d.name })),
    isPlatformAdmin: platformAdmin,
    isOrgAdmin: orgAdmin,
    newFeedbackCount,
  };
}
```

Leave the `SidebarNavData()` server component below it unchanged.

- [ ] **Step 2: Typecheck the module** (will pass once Task 12 adds the prop; if running this task first, note the single expected error `activeWorkspaceId does not exist on SidebarNav props` and resolve it in Task 12): `pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/sidebar-nav-data.tsx
git commit -m "feat(nav): scope sidebar board and dashboard lists to the active workspace"
```

---

### Task 10: Wrap Boards & Dashboards in `NavSection`; target the active workspace

**Files:**

- Modify: `src/components/boards/BoardsNav.tsx:111-204`
- Modify: `src/components/dashboards/DashboardsNav.tsx:59-164`

**Interfaces:**

- Consumes: `NavSection` (Task 4).
- Produces: `BoardsNav` and `DashboardsNav` replace their `workspaces` prop with `activeWorkspaceId?: string`; their expanded header becomes a `NavSection` (storageKey `"boards"` / `"dash"`); new board/dashboard creation targets `activeWorkspaceId`.

- [ ] **Step 1: `BoardsNav`.** Change the props (line ~111):

```tsx
export function BoardsNav({
  boards,
  sharedBoards,
  activeWorkspaceId,
  collapsed = false,
}: {
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
  activeWorkspaceId?: string;
  collapsed?: boolean;
}) {
```

Add the import at the top:

```tsx
import { NavSection } from "@/components/shell/nav-section";
```

- [ ] **Step 2: `BoardsNav` — collapsed branch.** In the `collapsed ? (...)` block, change the `NewBoardDialog` target from `workspaces[0]?.id` to `activeWorkspaceId`:

```tsx
<NewBoardDialog workspaceId={activeWorkspaceId} collapsed />
```

- [ ] **Step 3: `BoardsNav` — expanded branch.** Replace the expanded header `<div className="flex items-center justify-between px-3 py-1">…</div>` **and** wrap the board list + "Shared with me" block in a `NavSection`. Concretely, restructure the returned JSX so that when **not** collapsed the whole group is:

```tsx
      {collapsed ? (
        /* ...unchanged collapsed icon rail (Boards icon + triggerless dialog)... */
      ) : (
        <NavSection
          storageKey="boards"
          title="Boards"
          icon={FolderKanban}
          action={<NewBoardDialog workspaceId={activeWorkspaceId} />}
        >
          {boards.length === 0 ? (
            <p className="text-muted-foreground px-3 py-1 text-xs">
              No boards yet
            </p>
          ) : (
            <DndContext
              id="sidebar-boards"
              sensors={sensors}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={ordered.map((b) => b.id)}
                strategy={verticalListSortingStrategy}
              >
                {ordered.map((b) => (
                  <SortableBoardRow
                    key={b.id}
                    board={b}
                    isActive={b.id === activeBoardId}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
          {sharedBoards.length > 0 ? (
            <>
              <p className="text-muted-foreground px-3 pt-3 text-xs font-medium">
                Shared with me
              </p>
              {sharedBoards.map((b) => (
                /* ...unchanged expanded shared-board <Link>... */
              ))}
            </>
          ) : null}
        </NavSection>
      )}
```

Keep the outer wrapper `<div className={cn("flex flex-col gap-0.5 py-2", collapsed ? "items-center px-2" : "px-2")}>` only for the collapsed branch; in the expanded branch `NavSection` supplies its own padding, so render `NavSection` directly (no extra `px-2 py-2` wrapper, to avoid double indentation). The collapsed-icon markup, `SortableBoardRow`, `handleDragEnd`, sensors, and the shared-board `<Link>` bodies are all unchanged — only the header and the wrapping container change.

- [ ] **Step 4: `DashboardsNav`.** Change props (line ~59) and the `workspaceId` source (line ~90):

```tsx
export function DashboardsNav({
  dashboards,
  activeWorkspaceId,
  collapsed = false,
}: {
  dashboards: { id: string; name: string }[];
  activeWorkspaceId?: string;
  collapsed?: boolean;
}) {
```

```tsx
const workspaceId = activeWorkspaceId;
```

Add the import:

```tsx
import { NavSection } from "@/components/shell/nav-section";
```

- [ ] **Step 5: `DashboardsNav` — expanded branch.** Replace the expanded `<div className="flex items-center justify-between px-3 py-1">…</div>` header + the list with a `NavSection` whose title links to `/dashboards` and whose `action` is the existing New dropdown. The controlled `Dialog` and `AiDashboardWizard` stay mounted **outside** the collapsed/expanded branch (as today) so `⌘K` can open them. Expanded group:

```tsx
      {collapsed ? (
        /* ...unchanged collapsed icon link... */
      ) : (
        <NavSection
          storageKey="dash"
          title="Dashboards"
          titleHref="/dashboards"
          icon={LayoutGrid}
          action={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="New dashboard"
                  className="size-6"
                >
                  <Plus className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => setOpen(true)}>
                  <Plus className="size-4" />
                  Blank dashboard
                </DropdownMenuItem>
                {workspaceId ? (
                  <DropdownMenuItem onSelect={() => setAiOpen(true)}>
                    <Sparkles className="size-4" />
                    Generate with AI
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        >
          {dashboards.length === 0 ? (
            <p className="text-muted-foreground px-3 py-1 text-xs">
              No dashboards yet
            </p>
          ) : (
            dashboards.map((d) => (
              /* ...unchanged expanded dashboard row <div>…</div>... */
            ))
          )}
        </NavSection>
      )}
```

- [ ] **Step 6: Run the affected suites — expect PASS** (BoardsNav/DashboardsNav have no dedicated tests; they are covered via `sidebar-nav.test.tsx`, updated in Task 12). Run the workspace/nav unit suites to confirm nothing regressed:

```
pnpm vitest run src/components/shell
```

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/BoardsNav.tsx src/components/dashboards/DashboardsNav.tsx
git commit -m "feat(nav): make boards and dashboards collapsible, target active workspace"
```

---

### Task 11: Settings — Workspaces management card (rename/delete parity)

**Files:**

- Modify: `src/app/(app)/settings/page.tsx:1-161`

**Interfaces:**

- Consumes: `listWorkspacesCached` (existing), `WorkspaceNavItem` + `NewWorkspaceDialog` (existing).
- Produces: a "Workspaces" card in Settings so rename/delete survive the sidebar's switch to a switcher.

- [ ] **Step 1: Add imports** to `src/app/(app)/settings/page.tsx`:

```tsx
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { WorkspaceNavItem } from "@/components/workspaces/WorkspaceNavItem";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";
```

- [ ] **Step 2: Fetch workspaces.** After `const org = orgs[0]; if (!org) redirect("/onboarding");` add:

```tsx
const workspaces = await listWorkspacesCached(org.id);
```

- [ ] **Step 3: Render the card.** Insert this `Card` inside the `<div className="space-y-4">`, directly **after** the "Organization" card and before the `{isAdmin && me && (...)}` Members card:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Workspaces</CardTitle>
    <CardDescription>
      Organize boards and dashboards. Rename or delete here; switch the active
      workspace from the sidebar.
    </CardDescription>
  </CardHeader>
  <CardContent>
    <div className="flex items-center justify-between px-1 pb-2">
      <p className="text-muted-foreground text-xs font-medium">
        {workspaces.length} workspace
        {workspaces.length === 1 ? "" : "s"}
      </p>
      <NewWorkspaceDialog />
    </div>
    <div className="flex flex-col gap-0.5">
      {workspaces.map((w) => (
        <WorkspaceNavItem
          key={w.id}
          workspace={w}
          isOrgAdmin={isAdmin}
          isLast={workspaces.length <= 1}
        />
      ))}
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 4: Typecheck + lint the file:** `pnpm typecheck && pnpm lint`

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/settings/page.tsx"
git commit -m "feat(settings): add workspaces management card (rename/delete)"
```

---

### Task 12: `sidebar-nav` — restructure to Direction B (+ test update)

**Files:**

- Modify: `src/components/shell/sidebar-nav.tsx:1-218` (full rewrite)
- Modify: `src/components/shell/sidebar-nav.test.tsx:1-238`

**Interfaces:**

- Consumes: `WorkspaceSwitcher` (Task 5), `NavSection` (Task 4), the `activeWorkspaceId` field from `getSidebarNavData` (Task 9), and the new `BoardsNav`/`DashboardsNav` props (Task 10).
- Produces: `SidebarNav` props gain `activeWorkspaceId?: string`; `workspaces` is still passed (to the switcher). Inbox and the old inline Workspaces block and `PlatformNav` are gone. Order: switcher → My Work → Planning → Boards → Dashboards → Personal.

- [ ] **Step 1: Rewrite `src/components/shell/sidebar-nav.tsx`:**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Clock, Gauge, ListTodo, Target } from "lucide-react";
import type { ComponentType } from "react";
import { BoardsNav } from "@/components/boards/BoardsNav";
import { DashboardsNav } from "@/components/dashboards/DashboardsNav";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { NavSection } from "@/components/shell/nav-section";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/ui";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import { cn } from "@/lib/utils";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";

type NavLink = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const HOME: NavLink = { label: "My Work", href: "/my-work", icon: ListTodo };
const PLANNING: NavLink[] = [
  { label: "Goals", href: "/goals", icon: Target },
  { label: "Portfolios", href: "/portfolios", icon: BarChart3 },
  { label: "Workload", href: "/workload", icon: Gauge },
];
const PERSONAL: NavLink[] = [{ label: "My Time", href: "/time", icon: Clock }];
const ALL_LINKS: NavLink[] = [HOME, ...PLANNING, ...PERSONAL];

function CoarseCaption({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground max-w-full truncate text-[10px] leading-tight">
      {label}
    </span>
  );
}

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/** Expanded (full-label) nav link. */
function ExpandedLink({ item, active }: { item: NavLink; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-primary/80 text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <item.icon className="size-4" />
      {item.label}
    </Link>
  );
}

/** Collapsed icon-only rail link (with a coarse-pointer caption; gotcha-47). */
function CollapsedLink({
  item,
  active,
  coarse,
}: {
  item: NavLink;
  active: boolean;
  coarse: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          aria-label={item.label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex size-9 max-w-full flex-col items-center justify-center gap-0.5 rounded-md transition-colors pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-1 pointer-coarse:py-1.5",
            active
              ? "bg-primary/80 text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <item.icon className="size-4 shrink-0" />
          {coarse ? <CoarseCaption label={item.label} /> : null}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Direction B sidebar body. Order: workspace switcher → My Work → Planning →
 * Boards → Dashboards → Personal. Boards/Dashboards carry their own collapsible
 * headers (NavSection). Platform admin now lives in the header, not here.
 */
export function SidebarNav({
  boards,
  sharedBoards,
  workspaces,
  activeWorkspaceId = "",
  dashboards,
  isOrgAdmin,
  forceExpanded = false,
}: {
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
  workspaces: { id: string; name: string }[];
  activeWorkspaceId?: string;
  dashboards: { id: string; name: string }[];
  isPlatformAdmin?: boolean;
  isOrgAdmin?: boolean;
  newFeedbackCount?: number;
  forceExpanded?: boolean;
}) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const isCollapsed = !forceExpanded && hasHydrated && collapsed;
  const coarse = useCoarsePointer();
  const isActive = useActive();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        collapsed={isCollapsed}
        isOrgAdmin={!!isOrgAdmin}
      />

      {!isCollapsed ? (
        <Separator className="mx-3 my-1 data-horizontal:w-auto" />
      ) : null}

      {isCollapsed ? (
        <nav className="flex flex-col items-center gap-0.5 px-2 py-2">
          {ALL_LINKS.map((item) => (
            <CollapsedLink
              key={item.href}
              item={item}
              active={isActive(item.href)}
              coarse={coarse}
            />
          ))}
        </nav>
      ) : (
        <nav className="flex flex-col gap-0.5 px-2 pt-2">
          <ExpandedLink item={HOME} active={isActive(HOME.href)} />
        </nav>
      )}

      {!isCollapsed ? (
        <NavSection storageKey="planning" title="Planning">
          {PLANNING.map((item) => (
            <ExpandedLink
              key={item.href}
              item={item}
              active={isActive(item.href)}
            />
          ))}
        </NavSection>
      ) : null}

      {!isCollapsed ? (
        <Separator className="mx-3 my-1 data-horizontal:w-auto" />
      ) : null}

      <BoardsNav
        boards={boards}
        sharedBoards={sharedBoards}
        activeWorkspaceId={activeWorkspaceId}
        collapsed={isCollapsed}
      />

      {!isCollapsed ? (
        <Separator className="mx-3 my-1 data-horizontal:w-auto" />
      ) : null}

      <DashboardsNav
        dashboards={dashboards}
        activeWorkspaceId={activeWorkspaceId}
        collapsed={isCollapsed}
      />

      {!isCollapsed ? (
        <NavSection storageKey="personal" title="Personal">
          {PERSONAL.map((item) => (
            <ExpandedLink
              key={item.href}
              item={item}
              active={isActive(item.href)}
            />
          ))}
        </NavSection>
      ) : null}
    </div>
  );
}
```

> `isPlatformAdmin` and `newFeedbackCount` remain in the prop type (still supplied by `getSidebarNavData` and spread by `MobileNav`) but are intentionally unused here — the admin UI moved to the header. Keeping them avoids changing the shared loader's return shape.

- [ ] **Step 2: Update the test — `src/components/shell/sidebar-nav.test.tsx`.** Add a mock for the switch action and thread `activeWorkspaceId`. At the top, alongside the existing `vi.mock("@/lib/workspaces/actions", …)`, add:

```tsx
vi.mock("@/lib/workspaces/active-actions", () => ({
  setActiveWorkspace: vi.fn(),
}));
```

Ensure `next/navigation` mock includes `useRouter` with `refresh` (it already does). Then update the specific cases:

- **Replace** the `"renders the wired section links and a disabled Inbox stub"` test with:

```tsx
it("renders the grouped section links and no Inbox", () => {
  renderNav(
    <SidebarNav
      boards={[]}
      sharedBoards={[]}
      workspaces={[]}
      dashboards={[]}
    />,
  );
  expect(screen.getByText("Dashboards").closest("a")).toHaveAttribute(
    "href",
    "/dashboards",
  );
  for (const [label, href] of [
    ["My Work", "/my-work"],
    ["Goals", "/goals"],
    ["Portfolios", "/portfolios"],
    ["Workload", "/workload"],
    ["My Time", "/time"],
  ] as const) {
    expect(screen.getByText(label).closest("a")).toHaveAttribute("href", href);
  }
  expect(screen.queryByText("Inbox")).not.toBeInTheDocument();
});
```

- **Replace** the `"renders the Workspaces block when workspaces exist"` test with:

```tsx
it("shows the active workspace in the switcher", () => {
  renderNav(
    <SidebarNav
      boards={[]}
      sharedBoards={[]}
      workspaces={[{ id: "w1", name: "Engineering" }]}
      activeWorkspaceId="w1"
      dashboards={[]}
    />,
  );
  expect(screen.getByText("Engineering")).toBeInTheDocument();
});
```

- In the coarse-pointer `for (const label of [...])` loop, **remove `"Inbox"`** so it reads `["My Work", "Goals", "Portfolios", "Workload", "My Time"]`. (These now render in the collapsed rail.)

- The `"hides text labels when collapsed"` and `forceExpanded` tests keep working; no change needed beyond the mocks above.

- [ ] **Step 3: Run the sidebar suite — expect PASS:** `pnpm vitest run src/components/shell/sidebar-nav.test.tsx`

- [ ] **Step 4: Run the mobile-nav suite** (it spreads the same props; should still pass): `pnpm vitest run src/components/shell/mobile-nav.test.tsx`. If it asserted Inbox/Workspaces, mirror the Step-2 edits there.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/sidebar-nav.tsx src/components/shell/sidebar-nav.test.tsx
git commit -m "feat(nav): restructure sidebar into grouped Direction B layout"
```

---

### Task 13: Full verification + manual walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Typecheck** — `pnpm typecheck` — Expected: no errors. (The `activeWorkspaceId` field flagged mid-batch in Task 9 is now defined on `SidebarNav`.)

- [ ] **Step 2: Lint** — `pnpm lint` — Expected: clean. If `sidebar-nav.tsx` warns on the unused `isPlatformAdmin`/`newFeedbackCount` props, prefix them or add the destructure comment `// eslint-disable-next-line @typescript-eslint/no-unused-vars` only if the repo's config actually flags unused destructured props (it typically does not).

- [ ] **Step 3: Tests** — `pnpm test` — Expected: all suites green.

- [ ] **Step 4: Production build** — `pnpm build` — Expected: success. Watch for the Cache Components rule (awaited cookies/searchParams outside Suspense) — `getActiveWorkspaceId` reads cookies inside the already-Suspense-streamed `SidebarNavData`, so it is compliant; if the build flags an uncached-data error, confirm the sidebar loader is still behind its `<Suspense>` in the authenticated layout.

- [ ] **Step 5: Manual walkthrough** (the human-acceptance path — also paste into the `/wrapup` note):
  1. Pull `develop`, run `pnpm dev`, sign in.
  2. **Switcher scopes lists:** top-left shows the active workspace. Open it → pick another workspace → the Boards and Dashboards lists rescope to that workspace, and the page refreshes once (no full reload flash).
  3. **New item targets the active workspace:** with workspace B active, create a board → it appears in B's list; switch to A → it's absent; switch back to B → present.
  4. **Collapsible groups:** click the chevrons on Planning / Boards / Dashboards / Personal → each folds/unfolds; reload → the collapsed state persists.
  5. **Platform admin (super-admin account):** the shield button is top-right; its menu lists Overview / Organizations / Users / Audit log / Feedback (+count). Confirm the sidebar has **no** platform group and the user menu has **no** "Platform admin" item.
  6. **Inbox is gone.** Collapse the whole rail (⌘\ / Ctrl+\) → icons only, switcher becomes an avatar, everything still reachable.
  7. **Rename/delete:** Settings → Workspaces card → rename and (as admin, non-last) delete work.

- [ ] **Step 6: Finish the task** (merges to `develop`, runs the gates, cleans up the worktree):

```bash
scripts/finish-task.sh
```

---

## Self-review

**Spec coverage:** Grouped sidebar (Task 12) ✓ · top switcher scoping lists (Tasks 2, 3, 5, 9) ✓ · single top-right admin button (Tasks 6, 8) + removed from user menu (Task 7) ✓ · Inbox removed (Task 12) ✓ · collapse persists client-side (Tasks 1, 4) ✓ · rename/delete parity (Task 11) ✓ · mobile parity (Tasks 10, 12 spread) ✓ · data-fetching budget honored (switch = action + refresh; collapse = store) ✓ · bounded reads by `workspace_id` (Task 3) ✓ · tests written + executed (every task) ✓.

**Deferred consciously (spec non-goals):** "Shared with me" boards stay **unscoped** (they belong to the sharer's workspace, not the viewer's active one) — noted so it isn't read as a miss. Goals/Portfolios/Workload/My Time are not workspace-scoped in v1.

**Type consistency:** `activeWorkspaceId: string` flows loader → `SidebarNav` → `WorkspaceSwitcher`/`BoardsNav`/`DashboardsNav`; `setActiveWorkspace(workspaceId: string)` and `getActiveWorkspaceId(workspaces)` match across Tasks 2/5/9; `ACTIVE_WS_COOKIE` is defined once in `active.ts` and imported by the action; `collapsedSections`/`toggleSection` names match across Tasks 1/4.
