# ⌘K Command-Palette Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ⌘K command palette navigate to any board/dashboard and trigger New-board / New-dashboard creation, reusing already-loaded data and the existing create dialogs.

**Architecture:** Move `<CommandPalette>` from root `Providers` into `AppShell` (authed-only), passing the `boards`/`dashboards`/`workspaces` lists it already loads — so navigation is client-side fuzzy filtering with zero new fetches. "Create" commands flip ephemeral `useUIStore` flags (`newBoardOpen`/`newDashboardOpen`) that the existing `NewBoardDialog` and DashboardsNav create-dialog read, so one dialog serves both the sidebar `+` button and the palette.

**Tech Stack:** Next.js 16 (App Router, `useRouter`), React 19, cmdk, Zustand, shadcn/ui, Vitest + Testing Library, Playwright.

---

## File structure

- **Modify** `src/stores/ui.ts` — add `newBoardOpen`/`newDashboardOpen` ephemeral flags + setters.
- **Create** `src/stores/ui.test.ts` — verify the new flag setters.
- **Modify** `src/components/boards/NewBoardDialog.tsx` — make open-state controllable from the store.
- **Modify** `src/components/boards/NewBoardDialog.test.tsx` — assert it opens when the store flag is set.
- **Modify** `src/components/dashboards/DashboardsNav.tsx` — same controllable treatment for its create-dialog.
- **Create** `src/components/dashboards/DashboardsNav.test.tsx` — assert it opens via the store flag.
- **Modify** `src/components/command-palette.tsx` — accept props; render Navigation + Create groups.
- **Modify** `src/components/command-palette.test.tsx` — props + navigation/create behavior.
- **Modify** `src/components/app-shell.tsx` — render `<CommandPalette>` with props.
- **Modify** `src/components/providers.tsx` — remove `<CommandPalette>`.
- **Create** `e2e/command-palette.spec.ts` — ⌘K → navigate to a board.

---

## Task 1: UI-store flags for the create dialogs

**Files:**

- Modify: `src/stores/ui.ts`
- Create: `src/stores/ui.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/ui.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "@/stores/ui";

beforeEach(() => {
  useUIStore.setState({ newBoardOpen: false, newDashboardOpen: false });
});

describe("useUIStore create-dialog flags", () => {
  it("setNewBoardOpen toggles newBoardOpen", () => {
    useUIStore.getState().setNewBoardOpen(true);
    expect(useUIStore.getState().newBoardOpen).toBe(true);
    useUIStore.getState().setNewBoardOpen(false);
    expect(useUIStore.getState().newBoardOpen).toBe(false);
  });

  it("setNewDashboardOpen toggles newDashboardOpen", () => {
    useUIStore.getState().setNewDashboardOpen(true);
    expect(useUIStore.getState().newDashboardOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm exec vitest run src/stores/ui.test.ts`
Expected: FAIL — `setNewBoardOpen is not a function`.

- [ ] **Step 3: Add the flags to `src/stores/ui.ts`**

In the `UIState` interface, after the `commandOpen` lines, add:

```ts
  newBoardOpen: boolean;
  setNewBoardOpen: (open: boolean) => void;
  newDashboardOpen: boolean;
  setNewDashboardOpen: (open: boolean) => void;
```

In the store creator, after the `toggleCommand` line, add:

```ts
      newBoardOpen: false,
      setNewBoardOpen: (open) => set({ newBoardOpen: open }),
      newDashboardOpen: false,
      setNewDashboardOpen: (open) => set({ newDashboardOpen: open }),
```

Leave `partialize` unchanged (these stay ephemeral / non-persisted).

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm exec vitest run src/stores/ui.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/ui.ts src/stores/ui.test.ts
git commit -m "feat(cmdk): add newBoardOpen/newDashboardOpen UI-store flags"
```

---

## Task 2: Make `NewBoardDialog` controllable from the store

**Files:**

- Modify: `src/components/boards/NewBoardDialog.tsx`
- Modify: `src/components/boards/NewBoardDialog.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `src/components/boards/NewBoardDialog.test.tsx`

```ts
import { useUIStore } from "@/stores/ui";

it("opens when the newBoardOpen store flag is set (controlled path)", async () => {
  useUIStore.setState({ newBoardOpen: false });
  render(<NewBoardDialog workspaceId="ws1" />);
  // not open yet
  expect(screen.queryByText("Pick a template to start from, then name your board.")).toBeNull();
  // flip the store flag → dialog opens without clicking the + trigger
  useUIStore.setState({ newBoardOpen: true });
  await waitFor(() =>
    expect(
      screen.getByText("Pick a template to start from, then name your board."),
    ).toBeInTheDocument(),
  );
});
```

(`waitFor` is already imported in this test file. Reset the flag in the existing `beforeEach` by adding `useUIStore.setState({ newBoardOpen: false });` there.)

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm exec vitest run src/components/boards/NewBoardDialog.test.tsx`
Expected: the new test FAILS (dialog never opens from the flag).

- [ ] **Step 3: Implement controllable open state in `NewBoardDialog.tsx`**

Add the store import near the other imports:

```ts
import { useUIStore } from "@/stores/ui";
```

Replace the local open state line:

```ts
const [open, setOpen] = useState(false);
```

with:

```ts
const storeOpen = useUIStore((s) => s.newBoardOpen);
const setNewBoardOpen = useUIStore((s) => s.setNewBoardOpen);
const [localOpen, setLocalOpen] = useState(false);
const open = storeOpen || localOpen;
const setOpen = (next: boolean) => {
  setLocalOpen(next);
  if (!next) setNewBoardOpen(false);
};
```

Everything else (the `<Dialog open={open} onOpenChange={setOpen}>`, the `+` `DialogTrigger`, `submit()`'s `setOpen(false)`) stays unchanged.

- [ ] **Step 4: Run, verify all pass**

Run: `pnpm exec vitest run src/components/boards/NewBoardDialog.test.tsx`
Expected: PASS (3 tests — the 2 existing + the new controlled-open test).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/NewBoardDialog.tsx src/components/boards/NewBoardDialog.test.tsx
git commit -m "feat(cmdk): make NewBoardDialog openable from the UI store"
```

---

## Task 3: Make the DashboardsNav create-dialog controllable

**Files:**

- Modify: `src/components/dashboards/DashboardsNav.tsx`
- Create: `src/components/dashboards/DashboardsNav.test.tsx`

- [ ] **Step 1: Write the failing test** — create `src/components/dashboards/DashboardsNav.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DashboardsNav } from "./DashboardsNav";
import { useUIStore } from "@/stores/ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({}),
}));
vi.mock("@/lib/dashboards/actions", () => ({
  createDashboard: vi.fn(),
}));

beforeEach(() => {
  useUIStore.setState({ newDashboardOpen: false });
});

describe("DashboardsNav", () => {
  const workspaces = [{ id: "ws1", name: "WS" }];

  it("opens the create dialog when the newDashboardOpen store flag is set", async () => {
    render(<DashboardsNav dashboards={[]} workspaces={workspaces} />);
    expect(
      screen.queryByText("Give your dashboard a name to get started."),
    ).toBeNull();
    useUIStore.setState({ newDashboardOpen: true });
    await waitFor(() =>
      expect(
        screen.getByText("Give your dashboard a name to get started."),
      ).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm exec vitest run src/components/dashboards/DashboardsNav.test.tsx`
Expected: FAIL (dialog never opens from the flag).

- [ ] **Step 3: Implement controllable open state in `DashboardsNav.tsx`**

Add the store import near the other imports:

```ts
import { useUIStore } from "@/stores/ui";
```

Replace the local open state line:

```ts
const [open, setOpen] = useState(false);
```

with:

```ts
const storeOpen = useUIStore((s) => s.newDashboardOpen);
const setNewDashboardOpen = useUIStore((s) => s.setNewDashboardOpen);
const [localOpen, setLocalOpen] = useState(false);
const open = storeOpen || localOpen;
const setOpen = (next: boolean) => {
  setLocalOpen(next);
  if (!next) setNewDashboardOpen(false);
};
```

Everything else stays unchanged (`<Dialog open={open} onOpenChange={setOpen}>`, the `+` trigger, `submit()`'s `setOpen(false)`).

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm exec vitest run src/components/dashboards/DashboardsNav.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/DashboardsNav.tsx src/components/dashboards/DashboardsNav.test.tsx
git commit -m "feat(cmdk): make DashboardsNav create-dialog openable from the UI store"
```

---

## Task 4: Rewrite `CommandPalette` with navigation + create

**Files:**

- Modify: `src/components/command-palette.tsx`
- Modify: `src/components/command-palette.test.tsx`

- [ ] **Step 1: Replace the test** — overwrite `src/components/command-palette.test.tsx`

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./command-palette";
import { useUIStore } from "@/stores/ui";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}));

const boards = [
  { id: "b1", name: "Sprint backlog", workspace_id: "ws1", position: 0 },
  { id: "b2", name: "Roadmap", workspace_id: "ws1", position: 1 },
];
const dashboards = [{ id: "d1", name: "Team overview" }];
const workspaces = [{ id: "ws1", name: "WS" }];

function renderOpen() {
  useUIStore.setState({
    commandOpen: true,
    newBoardOpen: false,
    newDashboardOpen: false,
  });
  return render(
    <CommandPalette
      boards={boards}
      dashboards={dashboards}
      workspaces={workspaces}
    />,
  );
}

beforeEach(() => {
  push.mockReset();
  useUIStore.setState({ commandOpen: false });
});

describe("CommandPalette", () => {
  it("renders a navigation item per board and per dashboard", () => {
    renderOpen();
    expect(screen.getByText("Sprint backlog")).toBeInTheDocument();
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Team overview")).toBeInTheDocument();
  });

  it("navigates to a board on select and closes", () => {
    renderOpen();
    fireEvent.click(screen.getByText("Sprint backlog"));
    expect(push).toHaveBeenCalledWith("/boards/b1");
    expect(useUIStore.getState().commandOpen).toBe(false);
  });

  it("New board sets the newBoardOpen flag and closes", () => {
    renderOpen();
    fireEvent.click(screen.getByText("New board"));
    expect(useUIStore.getState().newBoardOpen).toBe(true);
    expect(useUIStore.getState().commandOpen).toBe(false);
  });

  it("New dashboard sets the newDashboardOpen flag", () => {
    renderOpen();
    fireEvent.click(screen.getByText("New dashboard"));
    expect(useUIStore.getState().newDashboardOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm exec vitest run src/components/command-palette.test.tsx`
Expected: FAIL (component takes no props yet; items/labels absent; no router mock used).

- [ ] **Step 3: Rewrite `src/components/command-palette.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  LayoutGrid,
  Monitor,
  Moon,
  Plus,
  Sun,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useUIStore } from "@/stores/ui";
import type { BoardListEntry } from "@/lib/boards/queries";

export function CommandPalette({
  boards,
  dashboards,
  workspaces,
}: {
  boards: BoardListEntry[];
  dashboards: { id: string; name: string }[];
  workspaces: { id: string; name: string }[];
}) {
  const open = useUIStore((s) => s.commandOpen);
  const setOpen = useUIStore((s) => s.setCommandOpen);
  const toggle = useUIStore((s) => s.toggleCommand);
  const setNewBoardOpen = useUIStore((s) => s.setNewBoardOpen);
  const setNewDashboardOpen = useUIStore((s) => s.setNewDashboardOpen);
  const router = useRouter();
  const { setTheme } = useTheme();
  const canCreate = Boolean(workspaces[0]?.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search and run actions"
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => run(() => router.push("/dashboards"))}>
            <LayoutDashboard className="size-4" /> Dashboards
          </CommandItem>
          {boards.map((b) => (
            <CommandItem
              key={b.id}
              value={`board ${b.name}`}
              onSelect={() => run(() => router.push(`/boards/${b.id}`))}
            >
              <LayoutGrid className="size-4" /> {b.name}
            </CommandItem>
          ))}
          {dashboards.map((d) => (
            <CommandItem
              key={d.id}
              value={`dashboard ${d.name}`}
              onSelect={() => run(() => router.push(`/dashboards/${d.id}`))}
            >
              <LayoutDashboard className="size-4" /> {d.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Create">
          <CommandItem
            disabled={!canCreate}
            onSelect={() => run(() => setNewBoardOpen(true))}
          >
            <Plus className="size-4" /> New board
          </CommandItem>
          <CommandItem
            disabled={!canCreate}
            onSelect={() => run(() => setNewDashboardOpen(true))}
          >
            <Plus className="size-4" /> New dashboard
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem onSelect={() => run(() => setTheme("light"))}>
            <Sun className="size-4" /> Light
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("dark"))}>
            <Moon className="size-4" /> Dark
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("system"))}>
            <Monitor className="size-4" /> System
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
```

Note: `value={`board ${b.name}`}` / `value={`dashboard ${d.name}`}` gives cmdk's fuzzy filter distinct, searchable strings (and disambiguates a board and dashboard sharing a name).

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm exec vitest run src/components/command-palette.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/command-palette.tsx src/components/command-palette.test.tsx
git commit -m "feat(cmdk): wire navigation + create commands into the palette"
```

---

## Task 5: Mount the palette in `AppShell`, remove from `Providers`

**Files:**

- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/providers.tsx`

- [ ] **Step 1: Remove the palette from `Providers`**

In `src/components/providers.tsx`:

- Delete the import line `import { CommandPalette } from "@/components/command-palette";`.
- Delete the `<CommandPalette />` line (the `{children}` stays).

- [ ] **Step 2: Render it in `AppShell` with props**

In `src/components/app-shell.tsx`:

- Add the import: `import { CommandPalette } from "@/components/command-palette";`
- Inside the component's returned tree, render the palette once (it is a portal/dialog, so placement is cosmetic — put it just before the closing `</div>` of the outer flex container, after the main content column). Add:

```tsx
<CommandPalette
  boards={boards ?? []}
  dashboards={dashboards ?? []}
  workspaces={workspaces ?? []}
/>
```

The component already destructures `workspaces`, `boards`, `dashboards` from props, so they are in scope.

- [ ] **Step 3: Typecheck + lint + run the affected component tests**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (no unused `CommandPalette` import in providers; no missing-prop error in app-shell).

Run: `pnpm exec vitest run src/components/app-shell.test.tsx src/components/command-palette.test.tsx`
Expected: PASS. If `app-shell.test.tsx` renders `<AppShell>` without the new children and now fails because `CommandPalette` needs a router context, wrap or mock as the test already does for other client bits — but most likely it passes since props default to `[]` and cmdk renders nothing until opened. If it fails specifically on `useRouter`, add `vi.mock("next/navigation", ...)` to that test mirroring `command-palette.test.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/app-shell.tsx src/components/providers.tsx
git commit -m "feat(cmdk): mount CommandPalette in AppShell with nav data"
```

---

## Task 6: e2e — ⌘K navigates to a board

**Files:**

- Create: `e2e/command-palette.spec.ts`

- [ ] **Step 1: Write the spec** — model auth/onboarding EXACTLY on `e2e/board-templates.spec.ts` (read it first; reuse its confirmed-user provisioning, login, onboarding-to-workspace sequence, and `hasSecrets` skip guard).

After login + reaching the app shell, create a board to navigate to (use the New-board flow already exercised in `board-templates.spec.ts`: click `New board`, pick a template, Create — or create via the sidebar). Then:

```ts
// open the palette via the header trigger (avoids OS-specific ⌘K key events)
await page.getByRole("button", { name: /search/i }).click();
// the CommandDialog input
const input = page.getByPlaceholder("Type a command or search…");
await expect(input).toBeVisible();
await input.fill("Sprint"); // or the created board's name
await page.getByText("Sprint planning", { exact: false }).first().click();
await page.waitForURL(/\/boards\/[0-9a-f-]+/);
```

Assert a seeded element of the destination board is visible (e.g. `await expect(page.getByText("Backlog")).toBeVisible();`).

> If the header trigger's accessible name differs, inspect `CommandTrigger` (it renders "Search…" text + a ⌘K kbd) and match accordingly. If clicking the trigger proves flaky, fall back to `page.keyboard.press("Meta+k")` then `"Control+k"`.

- [ ] **Step 2: Run**

Run: `pnpm exec playwright test e2e/command-palette.spec.ts`
Expected: 1 passed (skips only if secrets absent — they are present here).

- If it fails on a selector/onboarding step, fix to match the real app (compare to `board-templates.spec.ts`).
- If it fails because navigation genuinely doesn't happen, report DONE_WITH_CONCERNS — do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add e2e/command-palette.spec.ts
git commit -m "test(cmdk): e2e navigate to a board via the command palette"
```

---

## Task 7: Full gate + push + wrap-up

- [ ] **Step 1: Full verification gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS; the new store/dialog/palette tests included and green.

- [ ] **Step 2: Push**

```bash
git push origin develop
```

- [ ] **Step 3: Wrap-up**

Run `/wrapup` to log a session note and bump `vault/00-north-star.md` (mark the ⌘K slice of Phase 8 done; Phase 8 then has only light-mode reskin / later phases remaining).

---

## Self-review notes

- **Spec coverage:** §3 mount move → Task 5; §4.1 palette nav+create → Task 4; §4.2 store flags → Task 1; §4.3 NewBoardDialog controllable → Task 2; §4.4 DashboardsNav controllable → Task 3; §6 tests → Tasks 1–4 (unit/component) + Task 6 (e2e). Theme group unchanged (carried verbatim in Task 4's rewrite). Global search correctly absent (deferred per spec §1).
- **Data-fetching budget:** navigation items + cmdk filtering are client-only over props already loaded by `AppShell` — 0 new round-trips; create reuses existing dialogs/actions; only the final navigate (RSC) / create (mutation) hits the server.
- **Type consistency:** `BoardListEntry` = `{id,name,workspace_id,position}` (from `queries.ts`); dashboards `{id,name}`; workspaces `{id,name}` — matches `AppShell` props. `setNewBoardOpen`/`setNewDashboardOpen` names identical across Tasks 1/2/3/4. The combined `open = storeOpen || localOpen` + `setOpen` pattern is identical in Tasks 2 and 3.
- **Mount-move risk:** `app-shell.test.tsx` may need a `next/navigation` mock once it renders `CommandPalette` — flagged in Task 5 Step 3.

```

```
