# Collapsible Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app-shell sidebar collapse to an icon rail (w-60 ⇄ w-14), persisted to localStorage and toggled by a footer button or ⌘\, with labels becoming hover tooltips.

**Architecture:** Collapse state lives in the existing Zustand `useUIStore` (persisted, with a `hasHydrated` guard to avoid SSR flash). A new client `Sidebar` component replaces the inline `<aside>` in `AppShell`; `Brand` is extracted to its own module and `BoardsNav` gains a `collapsed` variant. Pure client state — zero server round-trips.

**Tech Stack:** Next.js 16 (App Router, RSC), Zustand v5 (`persist` middleware), shadcn Tooltip (provider already global in `providers.tsx`), lucide-react, Vitest + React Testing Library.

---

## File Structure

- **Modify** `src/stores/ui.ts` — add persisted `sidebarCollapsed` + `hasHydrated` and actions.
- **Modify** `src/stores/ui.test.ts` — cover the new state/actions.
- **Modify** `src/components/boards/BoardsNav.tsx` — add a `collapsed` prop (rail variant).
- **Modify** `src/components/boards/BoardsNav.test.tsx` — cover the collapsed variant.
- **Create** `src/components/brand/brand.tsx` — the `Brand` link (mark + wordmark), `collapsed`-aware.
- **Create** `src/components/brand/brand.test.tsx` — brand expanded/collapsed.
- **Create** `src/components/sidebar.tsx` — the collapsible sidebar (client); owns layout, toggle, ⌘\.
- **Create** `src/components/sidebar.test.tsx` — toggle, ⌘\, label hiding, a11y.
- **Modify** `src/components/app-shell.tsx` — use `<Sidebar>` + imported `Brand`; drop the inline aside.
- **Modify** `src/components/app-shell.test.tsx` — reset store between tests; keep existing assertions green.

Key facts (verified): `TooltipProvider` is mounted globally in `src/components/providers.tsx`, but the unit tests render components in isolation — so `Sidebar` wraps its own content in a `TooltipProvider` (nesting is safe), and `BoardsNav`'s collapsed test wraps the render in `TooltipProvider`. Tooltips only render in the rail; the footer toggle's tooltip renders in both states (hence the in-`Sidebar` provider). `next/link` works in this jsdom setup when `next/navigation` is mocked (mirror `app-shell.test.tsx`).

---

## Task 1: Persisted collapse state in the UI store

**Files:**

- Modify: `src/stores/ui.ts`
- Test: `src/stores/ui.test.ts`

- [ ] **Step 1: Write the failing tests** — replace the contents of `src/stores/ui.test.ts` with:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "./ui";

describe("useUIStore", () => {
  beforeEach(() => {
    useUIStore.setState({ commandOpen: false, sidebarCollapsed: false });
  });

  it("defaults the command palette to closed", () => {
    expect(useUIStore.getState().commandOpen).toBe(false);
  });

  it("toggles the command palette", () => {
    useUIStore.getState().toggleCommand();
    expect(useUIStore.getState().commandOpen).toBe(true);
    useUIStore.getState().toggleCommand();
    expect(useUIStore.getState().commandOpen).toBe(false);
  });

  it("sets the command palette open state explicitly", () => {
    useUIStore.getState().setCommandOpen(true);
    expect(useUIStore.getState().commandOpen).toBe(true);
  });

  it("defaults the sidebar to expanded", () => {
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it("toggles the sidebar collapsed state", () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it("sets the sidebar collapsed state explicitly", () => {
    useUIStore.getState().setSidebarCollapsed(true);
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/stores/ui.test.ts`
Expected: FAIL — `sidebarCollapsed`/`toggleSidebar`/`setSidebarCollapsed` are undefined.

- [ ] **Step 3: Implement the store** — replace the contents of `src/stores/ui.ts` with:

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Ephemeral UI state only (per the brief, server state lives in Supabase/TanStack Query).
 * `sidebarCollapsed` is persisted to localStorage; `hasHydrated` flips true once that
 * persisted value has rehydrated, so the UI can render the SSR-safe default first.
 */
interface UIState {
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  toggleCommand: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      commandOpen: false,
      setCommandOpen: (open) => set({ commandOpen: open }),
      toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "pulse-ui",
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    },
  ),
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- src/stores/ui.test.ts`
Expected: PASS — 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/stores/ui.ts src/stores/ui.test.ts
git commit -m "feat(ui): persisted sidebar-collapsed state in the UI store"
```

---

## Task 2: BoardsNav rail (collapsed) variant

**Files:**

- Modify: `src/components/boards/BoardsNav.tsx`
- Test: `src/components/boards/BoardsNav.test.tsx`

- [ ] **Step 1: Add the failing test** — append these tests inside the top-level `describe` in `src/components/boards/BoardsNav.test.tsx` (keep all existing tests). If the file's existing render calls don't already wrap in a Tooltip provider, import it as shown; the collapsed variant renders tooltips and needs the provider.

```tsx
import { TooltipProvider } from "@/components/ui/tooltip";

// ...inside describe("BoardsNav", () => { ... }) add:

it("collapsed: renders each board as an initial with the board name as its accessible label", () => {
  render(
    <TooltipProvider>
      <BoardsNav
        collapsed
        boards={[
          { id: "b1", name: "Sprint backlog", workspace_id: "w1", position: 0 },
        ]}
        workspaces={[{ id: "w1", name: "Acme" }]}
      />
    </TooltipProvider>,
  );

  const link = screen.getByRole("link", { name: "Sprint backlog" });
  expect(link).toHaveAttribute("href", "/boards/b1");
  expect(link).toHaveTextContent("S");
  // the expanded "Boards" header label is not shown in the rail
  expect(screen.queryByText("Boards")).not.toBeInTheDocument();
});
```

Note: the existing tests at the top of the file already import `render`/`screen` and mock `next/navigation`. Reuse those imports; only add the `TooltipProvider` import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/components/boards/BoardsNav.test.tsx`
Expected: FAIL — `collapsed` is not a prop yet; the board renders its full name (not "S"), and "Boards" is present.

- [ ] **Step 3: Add the `collapsed` prop and rail rendering.** In `src/components/boards/BoardsNav.tsx`:

(a) Add the Tooltip import near the other `@/components/ui` imports:

```tsx
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
```

(b) Change the component signature/props to accept `collapsed`:

```tsx
export function BoardsNav({
  boards,
  workspaces,
  collapsed = false,
}: {
  boards: BoardListEntry[];
  workspaces: { id: string; name: string }[];
  collapsed?: boolean;
}) {
```

(c) Replace the entire `return ( ... )` block with the collapsed-aware version below. The expanded branch is byte-for-byte the previous markup; the `Dialog` and its `DialogContent` form are unchanged (only the wrapper around the header and the board list become conditional):

```tsx
return (
  <div
    className={cn(
      "flex flex-col gap-0.5 py-2",
      collapsed ? "items-center px-2" : "px-2",
    )}
  >
    {collapsed ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label="Boards"
            className="text-muted-foreground flex size-9 items-center justify-center"
          >
            <FolderKanban className="size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">Boards</TooltipContent>
      </Tooltip>
    ) : (
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-muted-foreground flex items-center gap-2.5 text-sm">
          <FolderKanban className="size-4" />
          Boards
        </span>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="New board"
              className="size-6"
            >
              <Plus className="size-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New board</DialogTitle>
              <DialogDescription>
                Give your board a name to get started.
              </DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="board-name">Board name</Label>
                <Input
                  id="board-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sprint backlog"
                />
              </div>
              {error ? (
                <p role="alert" className="text-destructive text-xs">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={isPending || !name.trim()}>
                  {isPending ? "Creating…" : "Create board"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    )}

    {boards.length === 0 ? (
      collapsed ? null : (
        <p className="text-muted-foreground px-3 py-1 text-xs">No boards yet</p>
      )
    ) : (
      boards.map((b) =>
        collapsed ? (
          <Tooltip key={b.id}>
            <TooltipTrigger asChild>
              <Link
                href={`/boards/${b.id}`}
                aria-current={b.id === activeBoardId ? "page" : undefined}
                aria-label={b.name}
                className={cn(
                  "flex size-9 items-center justify-center rounded-md text-sm font-medium uppercase transition-colors",
                  b.id === activeBoardId
                    ? "bg-surface text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {b.name.charAt(0)}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{b.name}</TooltipContent>
          </Tooltip>
        ) : (
          <Link
            key={b.id}
            href={`/boards/${b.id}`}
            aria-current={b.id === activeBoardId ? "page" : undefined}
            className={cn(
              "truncate rounded-md px-3 py-1 text-sm transition-colors",
              b.id === activeBoardId
                ? "bg-surface text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {b.name}
          </Link>
        ),
      )
    )}
  </div>
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/components/boards/BoardsNav.test.tsx`
Expected: PASS — all existing tests plus the new collapsed test.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/BoardsNav.tsx src/components/boards/BoardsNav.test.tsx
git commit -m "feat(boards): collapsed rail variant for BoardsNav"
```

---

## Task 3: Brand module, Sidebar component, and AppShell wiring

**Files:**

- Create: `src/components/brand/brand.tsx`
- Create: `src/components/brand/brand.test.tsx`
- Create: `src/components/sidebar.tsx`
- Create: `src/components/sidebar.test.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-shell.test.tsx`

- [ ] **Step 1: Write the failing Brand test** — create `src/components/brand/brand.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Brand } from "./brand";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
}));

describe("Brand", () => {
  it("shows the MONOLITH wordmark and links to /landing when expanded", () => {
    render(<Brand />);
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /monolith/i })).toHaveAttribute(
      "href",
      "/landing",
    );
  });

  it("hides the wordmark when collapsed but keeps the link and accessible name", () => {
    render(<Brand collapsed />);
    expect(screen.queryByText("MONOLITH")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /monolith/i })).toHaveAttribute(
      "href",
      "/landing",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test -- src/components/brand/brand.test.tsx`
Expected: FAIL — `./brand` does not exist.

- [ ] **Step 3: Create the Brand module** — create `src/components/brand/brand.tsx`:

```tsx
import Link from "next/link";
import { archivo } from "@/lib/fonts";
import { MonolithMark } from "@/components/brand/monolith-mark";
import { cn } from "@/lib/utils";

/**
 * Nav brand: the monolith mark plus the MONOLITH wordmark, linking to /landing.
 * In the collapsed rail the wordmark is hidden; the mark and the link's
 * aria-label keep the accessible name intact.
 */
export function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link
      href="/landing"
      aria-label="MONOLITH — landing"
      className="focus-visible:ring-ring -ml-1 flex w-fit items-center gap-2 rounded-md px-1 py-0.5 focus-visible:ring-2 focus-visible:outline-none"
    >
      <MonolithMark className="text-foreground size-6" />
      {!collapsed ? (
        <span
          className={cn(
            archivo.className,
            "text-sm font-extrabold tracking-wide",
          )}
        >
          MONOLITH
        </span>
      ) : null}
    </Link>
  );
}
```

- [ ] **Step 4: Run the Brand test to verify it passes**

Run: `pnpm test -- src/components/brand/brand.test.tsx`
Expected: PASS — 2 passing.

- [ ] **Step 5: Write the failing Sidebar test** — create `src/components/sidebar.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "./sidebar";
import { useUIStore } from "@/stores/ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
}));

beforeEach(() => {
  useUIStore.setState({ sidebarCollapsed: false, hasHydrated: true });
});

describe("Sidebar", () => {
  it("renders the brand and nav labels when expanded", () => {
    render(<Sidebar boards={[]} workspaces={[]} />);
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
    expect(screen.getByText("Dashboards")).toBeInTheDocument();
  });

  it("collapses on toggle click, hiding the labels", () => {
    render(<Sidebar boards={[]} workspaces={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));

    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    expect(screen.queryByText("MONOLITH")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboards")).not.toBeInTheDocument();
    // the icon button keeps its accessible name in the rail
    expect(
      screen.getByRole("button", { name: "Dashboards" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });

  it("toggles with the Cmd/Ctrl+\\ shortcut", () => {
    render(<Sidebar boards={[]} workspaces={[]} />);

    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);

    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm test -- src/components/sidebar.test.tsx`
Expected: FAIL — `./sidebar` does not exist.

- [ ] **Step 7: Create the Sidebar** — create `src/components/sidebar.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { BarChart3, Inbox, LayoutGrid, PanelLeft, Target } from "lucide-react";
import { Brand } from "@/components/brand/brand";
import { BoardsNav } from "@/components/boards/BoardsNav";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import type { BoardListEntry } from "@/lib/boards/queries";

const nav = [
  { label: "Dashboards", icon: LayoutGrid },
  { label: "Goals", icon: Target },
  { label: "Portfolios", icon: BarChart3 },
  { label: "Inbox", icon: Inbox },
] as const;

export function Sidebar({
  boards,
  workspaces,
}: {
  boards: BoardListEntry[];
  workspaces: { id: string; name: string }[];
}) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  // Render the SSR-safe default (expanded) until the persisted value hydrates,
  // and only animate width afterwards so there's no first-paint jump.
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
        <div
          className={cn(
            "flex min-h-14 items-center px-4 py-2",
            isCollapsed && "justify-center px-0",
          )}
        >
          <Brand collapsed={isCollapsed} />
        </div>

        <BoardsNav
          boards={boards}
          workspaces={workspaces}
          collapsed={isCollapsed}
        />

        <nav
          className={cn(
            "flex flex-col gap-0.5 py-2",
            isCollapsed ? "items-center px-2" : "px-2",
          )}
        >
          {nav.map((item) =>
            isCollapsed ? (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled
                    aria-label={item.label}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-9 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <item.icon className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              <button
                key={item.label}
                type="button"
                disabled
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                <item.icon className="size-4" />
                {item.label}
              </button>
            ),
          )}
        </nav>

        {!isCollapsed && workspaces.length > 0 ? (
          <div className="mt-2 flex flex-col gap-0.5 px-2">
            <p className="text-muted-foreground px-3 py-1 text-xs font-medium">
              Workspaces
            </p>
            {workspaces.map((workspace) => (
              <span
                key={workspace.id}
                className="text-muted-foreground truncate rounded-md px-3 py-1.5 text-sm"
              >
                {workspace.name}
              </span>
            ))}
          </div>
        ) : null}

        <div
          className={cn(
            "mt-auto flex p-2",
            isCollapsed ? "justify-center" : "justify-end",
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!isCollapsed}
                onClick={toggleSidebar}
                className="size-8"
              >
                <PanelLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isCollapsed ? "Expand sidebar" : "Collapse sidebar"} (⌘\)
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
```

- [ ] **Step 8: Run the Sidebar test to verify it passes**

Run: `pnpm test -- src/components/sidebar.test.tsx`
Expected: PASS — 3 passing.

- [ ] **Step 9: Wire AppShell to the new Sidebar.** Replace the entire contents of `src/components/app-shell.tsx` with:

```tsx
import type { ReactNode } from "react";
import { signOut } from "@/app/auth/actions";
import { Brand } from "@/components/brand/brand";
import { Sidebar } from "@/components/sidebar";
import { CommandTrigger } from "@/components/command-trigger";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BoardListEntry } from "@/lib/boards/queries";

export type AppShellUser = {
  email?: string | null;
  full_name?: string | null;
};

export type AppShellOrg = {
  name: string;
};

export type AppShellWorkspace = {
  id: string;
  name: string;
};

type AppShellProps = {
  children: ReactNode;
  user?: AppShellUser;
  currentUserId?: string;
  org?: AppShellOrg;
  workspaces?: AppShellWorkspace[];
  boards?: BoardListEntry[];
};

function initialFor(user: AppShellUser): string {
  const source = user.full_name?.trim() || user.email?.trim() || "";
  return source ? source.charAt(0).toUpperCase() : "?";
}

function UserMenu({ user }: { user: AppShellUser }) {
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

export function AppShell({
  children,
  user,
  currentUserId,
  workspaces,
  boards,
}: AppShellProps) {
  return (
    <div className="flex h-svh w-full overflow-hidden">
      <Sidebar boards={boards ?? []} workspaces={workspaces ?? []} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <CommandTrigger />
            {currentUserId ? (
              <NotificationsBell userId={currentUserId} />
            ) : null}
            <ThemeToggle />
            {user ? <UserMenu user={user} /> : null}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Keep the AppShell test deterministic.** In `src/components/app-shell.test.tsx`, add a store reset so a collapsed state never leaks between tests. Add this import and `beforeEach` near the top (after the existing `next/navigation` mock):

```tsx
import { beforeEach } from "vitest";
import { useUIStore } from "@/stores/ui";

beforeEach(() => {
  useUIStore.setState({ sidebarCollapsed: false, hasHydrated: true });
});
```

Leave the existing test bodies unchanged — the expanded sidebar still renders "MONOLITH", "No boards yet", the brand link to `/landing`, etc.

- [ ] **Step 11: Run the affected tests**

Run: `pnpm test -- src/components/app-shell.test.tsx src/components/sidebar.test.tsx src/components/brand/brand.test.tsx`
Expected: PASS — all suites green.

- [ ] **Step 12: Commit**

```bash
git add src/components/brand/brand.tsx src/components/brand/brand.test.tsx src/components/sidebar.tsx src/components/sidebar.test.tsx src/components/app-shell.tsx src/components/app-shell.test.tsx
git commit -m "feat(shell): collapsible sidebar with rail, toggle, and cmd-backslash"
```

---

## Task 4: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck** — Run: `pnpm typecheck` — Expected: PASS, no errors. (If `cn`/`archivo`/`MonolithMark`/`Link` or lucide nav icons are now unused anywhere, remove those imports until clean.)
- [ ] **Step 2: Lint** — Run: `pnpm lint` — Expected: 0 errors (the 3 pre-existing KanbanBoard/BoardTable warnings are unrelated).
- [ ] **Step 3: Full test suite** — Run: `pnpm test` — Expected: PASS, all suites including the new store/brand/sidebar/BoardsNav tests.
- [ ] **Step 4: Production build** — Run: `pnpm build` — Expected: PASS.
- [ ] **Step 5: Manual check** — `pnpm dev`, sign in, then: click the footer toggle → sidebar collapses to the icon rail; hover a board/nav icon → tooltip shows its name; press **⌘\*\* → toggles; **reload the page\*\* → the collapsed/expanded state is remembered; confirm no expand→collapse flash on load.
- [ ] **Step 6: Commit (only if fix-ups were needed)**

```bash
git add -A
git commit -m "chore(shell): sidebar collapse verification fix-ups"
```

---

## Self-Review

- **Spec coverage:** persisted state + hasHydrated (Task 1) ✓; icon rail w-60⇄w-14 + animation suppressed on first paint (Task 3 Sidebar) ✓; Brand collapsed (Task 3) ✓; BoardsNav rail with initials + tooltips + aria-current (Task 2) ✓; main nav icons+tooltips, Workspaces hidden collapsed (Task 3) ✓; footer PanelLeft toggle + aria-expanded + ⌘\ (Task 3) ✓; tooltips/a11y names (Tasks 2–3) ✓; AppShell uses `<Sidebar>` (Task 3) ✓; 0 server round-trips (client store) ✓; tests for store/sidebar/BoardsNav/app-shell (Tasks 1–3) ✓; verification gate + manual persistence check (Task 4) ✓.
- **Placeholders:** none — full code in every step.
- **Type/name consistency:** `sidebarCollapsed`/`toggleSidebar`/`setSidebarCollapsed`/`hasHydrated`/`setHasHydrated` consistent across store, store test, Sidebar, and app-shell test; `Brand`'s `collapsed` and `BoardsNav`'s `collapsed` props named identically where used by `Sidebar`; `Sidebar` props `{ boards, workspaces }` match the `AppShell` call site.
