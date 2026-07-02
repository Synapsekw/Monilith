# UI Polish Micro-Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Class-level smoothness/consistency pass — branded focus rings on drifted raw buttons, a 150 ms tab fade, one shared `EmptyState` component, hover/drag transitions, and a rename layout-shift fix.

**Architecture:** One new leaf component (`src/components/ui/empty-state.tsx`, server-compatible) plus class/ARIA edits to eight existing components. No data-flow, routing, or dependency changes. Spec: `docs/superpowers/specs/2026-07-02-ui-polish-micro-design.md` (read its verification table — several brief items were dropped as contradicted; do not "fix" them).

**Tech Stack:** Next.js 16 (App Router), React, Tailwind v4 semantic tokens (pulse-ui), shadcn/ui `Button`, Vitest + Testing Library (jsdom).

## Global Constraints

- **Micro-pass only:** class-level and small-component changes; no redesigns, no new dependencies, no new keyframes/CSS.
- **pulse-ui tokens only:** never raw Tailwind colors; branded focus pattern is `focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none`.
- **Motion:** reuse the existing `animate-fadein` utility (0.15 s ease-out, defined in `src/app/globals.css:86`; reduced-motion handled globally). No Framer Motion.
- **Performance budget:** 0 new server round-trips on any interaction; no new fetches, navigations, or Server Actions anywhere in this plan.
- **Tests:** DOM-class assertion style per `src/components/ui/button.touch.test.tsx` (assert class strings/roles; jsdom doesn't run media queries or animations).
- **Commits:** conventional, lowercase subject after `type(scope):`, descriptive body, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Stage explicitly by path (never `git add -A`).
- **Gates before finish:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## Execution DAG

**Dependency graph** (from the per-task Interfaces blocks):

- Task 1 (EmptyState + DashboardCanvas adoption): no dependencies
- Task 2 (Item-panel cluster): depends on Task 1 (imports `EmptyState`)
- Task 3 (NotificationsList): depends on Task 1 (imports `EmptyState`)
- Task 4 (BoardHeader + ViewSwitcher): no dependencies
- Task 5 (GoalTree + PortfolioGrid): no dependencies

**Parallel batches:**

- **Batch 1 (concurrent):** Task 1, Task 4, Task 5
- **Batch 2 (concurrent, after Task 1 lands):** Task 2, Task 3

**Critical path:** Task 1 → Task 2 (2 tasks deep — the wall-clock floor). Tasks 4 and 5 are pure
slack in Batch 1. When ≥2 tasks share a batch, dispatch them with
`superpowers:dispatching-parallel-agents` or parallel `subagent-driven-development` subagents.
All tasks touch disjoint files, so batches can share this worktree safely.

---

### Task 1: `EmptyState` component + DashboardCanvas adoption

**Files:**

- Create: `src/components/ui/empty-state.tsx`
- Create: `src/components/ui/empty-state.test.tsx`
- Modify: `src/components/dashboards/DashboardCanvas.tsx:150-154`
- Test (existing, verify green): `src/components/dashboards/DashboardCanvas.test.tsx`

**Interfaces:**

- Consumes: `cn` from `@/lib/utils`.
- Produces: `EmptyState({ children, variant?, className? }: { children: React.ReactNode; variant?: "panel" | "inline"; className?: string })` — a named export from `@/components/ui/empty-state`, rendering a `<div>`. `panel` (default) = `rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground`; `inline` = `py-8 text-center text-sm text-muted-foreground`. Tasks 2 and 3 import this exact signature.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/empty-state.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { EmptyState } from "./empty-state";

test("panel variant renders the dashed-box pattern", () => {
  render(<EmptyState>No widgets yet.</EmptyState>);
  const el = screen.getByText("No widgets yet.");
  for (const c of [
    "rounded-lg",
    "border-dashed",
    "p-12",
    "text-center",
    "text-muted-foreground",
  ]) {
    expect(el.className).toContain(c);
  }
});

test("inline variant renders unboxed with standardized padding", () => {
  render(<EmptyState variant="inline">No files yet.</EmptyState>);
  const el = screen.getByText("No files yet.");
  expect(el.className).toContain("py-8");
  expect(el.className).not.toContain("border-dashed");
});

test("merges a custom className", () => {
  render(
    <EmptyState variant="inline" className="my-2">
      Empty.
    </EmptyState>,
  );
  expect(screen.getByText("Empty.").className).toContain("my-2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/empty-state.test.tsx`
Expected: FAIL — cannot resolve `./empty-state`.

- [ ] **Step 3: Write the component**

Create `src/components/ui/empty-state.tsx` (no `"use client"` — server-compatible leaf):

```tsx
import { cn } from "@/lib/utils";

/**
 * Standard empty-state message. `panel` is the designed dashed-box pattern
 * (page/canvas-level emptiness); `inline` is unboxed for already-bounded
 * regions (item-panel tabs, popovers). Spec:
 * docs/superpowers/specs/2026-07-02-ui-polish-micro-design.md (D1).
 */
export function EmptyState({
  children,
  variant = "panel",
  className,
}: {
  children: React.ReactNode;
  variant?: "panel" | "inline";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-muted-foreground text-center text-sm",
        variant === "panel" && "rounded-lg border border-dashed p-12",
        variant === "inline" && "py-8",
        className,
      )}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/empty-state.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Adopt in DashboardCanvas (no visual change)**

In `src/components/dashboards/DashboardCanvas.tsx`, add the import:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
```

Replace lines 150–154:

```tsx
      {widgets.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-12 text-center text-sm">
          No widgets yet. Click <strong>Edit</strong> →{" "}
          <strong>Add widget</strong>.
        </div>
      ) : (
```

with:

```tsx
      {widgets.length === 0 ? (
        <EmptyState>
          No widgets yet. Click <strong>Edit</strong> →{" "}
          <strong>Add widget</strong>.
        </EmptyState>
      ) : (
```

- [ ] **Step 6: Verify the existing DashboardCanvas test still passes (regression guard)**

Run: `pnpm vitest run src/components/dashboards/DashboardCanvas.test.tsx`
Expected: PASS. If it asserts the old markup shape, update the assertion to the same class checks (`border-dashed`, `p-12`) — the rendered classes are unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/empty-state.tsx src/components/ui/empty-state.test.tsx src/components/dashboards/DashboardCanvas.tsx src/components/dashboards/DashboardCanvas.test.tsx
git commit -m "feat(ui): add shared emptystate component" -m "Extracts the DashboardCanvas dashed-box empty-state pattern into
src/components/ui/empty-state.tsx with panel/inline variants and adopts it
in DashboardCanvas (no visual change). Ends empty-state drift ahead of the
notifications and item-panel adopters. Spec D1.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Item-panel cluster (ItemPanel, FilesTab, UpdatesTab, ActivityTab)

**Files:**

- Modify: `src/components/boards/item-panel/ItemPanel.tsx:100-171`
- Modify: `src/components/boards/item-panel/FilesTab.tsx:53-55,123-126`
- Modify: `src/components/boards/item-panel/UpdatesTab.tsx:47-53,76-79`
- Modify: `src/components/boards/item-panel/ActivityTab.tsx:20-26`
- Test: `src/components/boards/item-panel/ItemPanel.test.tsx`, `FilesTab.test.tsx`, `UpdatesTab.test.tsx` (extend existing)

**Interfaces:**

- Consumes: `EmptyState({ children, variant?, className? })` from `@/components/ui/empty-state` (Task 1); existing `animate-fadein` utility (globals.css); shadcn `Button` from `@/components/ui/button`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/boards/item-panel/ItemPanel.test.tsx` (reuse the file's existing render/mock setup for `ItemPanel` props — the file already mocks the collab hooks; follow its local pattern for opening the panel):

```tsx
test("tabs expose tab semantics and the branded focus ring", () => {
  renderPanel(); // the file's existing helper; adapt name to what's there
  const tablist = screen.getByRole("tablist");
  expect(tablist).toBeTruthy();
  const updates = screen.getByRole("tab", { name: /updates/i });
  expect(updates.getAttribute("aria-selected")).toBe("true");
  expect(updates.className).toContain("focus-visible:ring");
  expect(updates.className).toContain("transition-colors");
});

test("tab body is wrapped in the fade-in wrapper", () => {
  renderPanel();
  expect(document.querySelector(".animate-fadein")).toBeTruthy();
});
```

Add to `src/components/boards/item-panel/FilesTab.test.tsx`:

```tsx
test("dropzone ring is transitioned, not popped", () => {
  renderFilesTab(); // existing helper/props in this file
  const zone = document.querySelector(".ring-2");
  expect(zone).toBeTruthy();
  expect(zone!.className).toContain("ring-transparent");
  expect(zone!.className).toContain("transition-shadow");
});

test("empty state uses the standardized inline EmptyState", () => {
  renderFilesTab({ cache: { attachments: [] } }); // adapt to the file's props shape
  const empty = screen.getByText(/no files yet/i);
  expect(empty.className).toContain("py-8");
});
```

Add to `src/components/boards/item-panel/UpdatesTab.test.tsx`:

```tsx
test("write-an-update cta is a real button primitive", () => {
  renderUpdatesTab(); // existing helper/props in this file
  const cta = screen.getByRole("button", { name: /write an update/i });
  expect(cta.getAttribute("data-slot")).toBe("button");
  expect(cta.className).toContain("focus-visible:ring");
});

test("empty state uses the standardized inline padding", () => {
  renderUpdatesTab({ cache: { updates: [] } }); // adapt to the file's props shape
  expect(screen.getByText(/no updates yet/i).className).toContain("py-8");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/boards/item-panel/ItemPanel.test.tsx src/components/boards/item-panel/FilesTab.test.tsx src/components/boards/item-panel/UpdatesTab.test.tsx`
Expected: the new tests FAIL (no tablist role / no `ring-transparent` / `data-slot` null / `py-6`≠`py-8`); pre-existing tests still pass.

- [ ] **Step 3: ItemPanel — tab semantics, focus ring, fade wrapper**

In `src/components/boards/item-panel/ItemPanel.tsx`, replace lines 100–114 (the tab strip):

```tsx
<div
  role="tablist"
  aria-label="Item panel sections"
  className="flex gap-1 border-b"
>
  {(["fields", "updates", "activity", "files"] as const).map((t) => (
    <button
      key={t}
      role="tab"
      aria-selected={tab === t}
      onClick={() => setTab(t)}
      className={`focus-visible:ring-ring rounded-sm px-3 py-2 text-sm capitalize transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 ${
        tab === t
          ? "border-primary border-b-2 font-medium"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {t === "activity" ? "Activity Log" : t}
    </button>
  ))}
</div>
```

Then wrap the tab body (lines 116–171) in a keyed fade wrapper — the outer scroll div stays, a new inner div keyed by `tab` re-mounts per switch:

```tsx
        <div className="flex-1 overflow-y-auto">
          <div key={tab} className="animate-fadein">
            {tab === "fields" && (
              …existing fields JSX unchanged…
            )}
            {tab === "updates" && (
              …existing UpdatesTab JSX unchanged…
            )}
            {tab === "activity" && (
              …existing ActivityTab JSX unchanged…
            )}
            {tab === "files" && (
              …existing FilesTab JSX unchanged…
            )}
          </div>
        </div>
```

(Only the wrapper div and the tab-strip classes/ARIA change; every child stays byte-identical.)

- [ ] **Step 4: FilesTab — drag-over transition + EmptyState**

In `src/components/boards/item-panel/FilesTab.tsx`, add the import:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
```

Replace line 55:

```tsx
      className={`flex flex-col gap-4 rounded-md ${dragOver ? "ring-ring ring-2" : ""}`}
```

with:

```tsx
      className={`flex flex-col gap-4 rounded-md ring-2 transition-shadow ${dragOver ? "ring-ring" : "ring-transparent"}`}
```

Replace lines 123–126 (the empty state):

```tsx
      {attachments.length === 0 ? (
        <EmptyState variant="inline">
          No files yet. Drop files here or use “Add files”.
        </EmptyState>
      ) : mode === "gallery" ? (
```

- [ ] **Step 5: UpdatesTab — Button CTA + EmptyState**

In `src/components/boards/item-panel/UpdatesTab.tsx` (Button is already imported), add:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
```

Replace lines 47–53 (the ad-hoc CTA):

```tsx
      {!open ? (
        <Button
          variant="outline"
          className="text-muted-foreground w-full justify-start font-normal"
          onClick={() => setOpen(true)}
        >
          Write an update
        </Button>
      ) : (
```

Replace lines 76–79 (the empty state):

```tsx
      {!cache || cache.updates.length === 0 ? (
        <EmptyState variant="inline">No updates yet for this item.</EmptyState>
      ) : (
```

- [ ] **Step 6: ActivityTab — EmptyState**

In `src/components/boards/item-panel/ActivityTab.tsx`, add the import and replace lines 20–26:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
```

```tsx
if (!cache || cache.activities.length === 0) {
  return <EmptyState variant="inline">No activity yet.</EmptyState>;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/boards/item-panel`
Expected: PASS — new tests green, all pre-existing item-panel tests green.

- [ ] **Step 8: Commit**

```bash
git add src/components/boards/item-panel/ItemPanel.tsx src/components/boards/item-panel/FilesTab.tsx src/components/boards/item-panel/UpdatesTab.tsx src/components/boards/item-panel/ActivityTab.tsx src/components/boards/item-panel/ItemPanel.test.tsx src/components/boards/item-panel/FilesTab.test.tsx src/components/boards/item-panel/UpdatesTab.test.tsx
git commit -m "polish(item-panel): tab a11y, fade, cta and empty-state consistency" -m "Tab buttons gain tablist/tab semantics, the branded focus-visible ring and
transition-colors; tab bodies fade in via the existing animate-fadein token
(150ms, reduced-motion-safe). FilesTab drag-over ring now transitions via
ring-transparent -> ring-ring. UpdatesTab CTA becomes a shadcn Button
(outline). All three tab empty states standardize on EmptyState inline
(py-8), ending the py-6/py-10 drift. Spec D2-D4.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: NotificationsList polish

**Files:**

- Modify: `src/components/notifications/NotificationsList.tsx:27-52`
- Test: `src/components/notifications/NotificationsList.test.tsx` (extend existing)

**Interfaces:**

- Consumes: `EmptyState({ children, variant?, className? })` from `@/components/ui/empty-state` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/notifications/NotificationsList.test.tsx` (reuse the file's existing notification fixtures; `read` below means `read_at` set, `unread` means `read_at: null`):

```tsx
test("empty state uses the standardized EmptyState", () => {
  render(<NotificationsList notifications={[]} onOpen={() => {}} />);
  const empty = screen.getByText(/no notifications/i);
  expect(empty.className).toContain("py-8");
  expect(empty.className).toContain("text-muted-foreground");
});

test("rows keep the dot slot when read so text aligns", () => {
  render(
    <NotificationsList notifications={[readNotification]} onOpen={() => {}} />,
  );
  const row = screen.getByRole("button");
  const dot = row.querySelector("span.size-2");
  expect(dot).toBeTruthy();
  expect(dot!.className).toContain("bg-transparent");
});

test("row button has hover transition and branded focus ring", () => {
  render(
    <NotificationsList notifications={[readNotification]} onOpen={() => {}} />,
  );
  const row = screen.getByRole("button");
  expect(row.className).toContain("transition-colors");
  expect(row.className).toContain("focus-visible:ring");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/notifications/NotificationsList.test.tsx`
Expected: new tests FAIL (empty state is a bare `p-4` p; no dot on read rows; no transition/focus classes).

- [ ] **Step 3: Implement**

In `src/components/notifications/NotificationsList.tsx`, add the import:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
```

Replace the empty-state block (lines 27–33):

```tsx
if (notifications.length === 0) {
  return <EmptyState variant="inline">No notifications.</EmptyState>;
}
```

Replace the row `<button>` and dot (lines 38–52):

```tsx
<button
  type="button"
  onClick={() => onOpen(n)}
  className="hover:bg-accent focus-visible:ring-ring flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
>
  <span
    className={`mt-1.5 size-2 shrink-0 rounded-full ${
      n.read_at ? "bg-transparent" : "bg-primary"
    }`}
    aria-label={n.read_at ? undefined : "unread"}
    aria-hidden={n.read_at ? true : undefined}
  />
  <span className={n.read_at ? "text-muted-foreground" : ""}>{label(n)}</span>
</button>
```

(`focus-visible:ring-inset` because the rows are edge-to-edge in a clipped popover; an outset ring would be cut off.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/notifications/NotificationsList.test.tsx`
Expected: PASS — new and pre-existing tests green. If a pre-existing test asserted the old bare-`p` empty state markup, update it to the EmptyState classes.

- [ ] **Step 5: Commit**

```bash
git add src/components/notifications/NotificationsList.tsx src/components/notifications/NotificationsList.test.tsx
git commit -m "polish(notifications): row transitions, aligned dot slot, emptystate" -m "Notification rows gain transition-colors and an inset branded focus ring;
the unread dot slot now always renders (transparent when read) so row text
aligns regardless of read state; the bare-text empty state adopts the shared
EmptyState inline variant. Spec D5.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: BoardHeader rename stability + ViewSwitcher tab focus ring

**Files:**

- Modify: `src/components/boards/BoardHeader.tsx:101-113`
- Modify: `src/components/boards/ViewSwitcher.tsx:199-211`
- Test: `src/components/boards/BoardHeader.test.tsx`, `src/components/boards/ViewSwitcher.test.tsx` (extend existing)

**Interfaces:**

- Consumes: nothing from other tasks (independent).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/boards/BoardHeader.test.tsx` (reuse the file's existing render helper/props):

```tsx
test("board title occupies a stable h-8 line box in display mode", () => {
  renderHeader(); // the file's existing setup; owner access
  const title = screen.getByRole("button", { name: boardName });
  expect(title.className).toContain("h-8");
  expect(title.className).toContain("items-center");
});
```

Add to `src/components/boards/ViewSwitcher.test.tsx`:

```tsx
test("view tab button carries the branded focus ring", () => {
  renderSwitcher(); // the file's existing setup
  const tab = screen.getAllByRole("tab")[0];
  expect(tab.className).toContain("focus-visible:ring");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/boards/BoardHeader.test.tsx src/components/boards/ViewSwitcher.test.tsx`
Expected: new tests FAIL (no `h-8` on the title button; no focus-visible class on the tab).

- [ ] **Step 3: Implement**

In `src/components/boards/BoardHeader.tsx`, replace lines 101–113 (viewer `<h1>` and the rename button) so both render at the Input's 32 px height — the rename toggle no longer jumps 4 px:

```tsx
        ) : isViewer ? (
          <h1 className="flex h-8 items-center truncate text-xl font-semibold tracking-tight">
            {boardName}
          </h1>
        ) : (
          <button
            type="button"
            onClick={openRename}
            className="hover:text-muted-foreground focus-visible:ring-ring flex h-8 items-center rounded-sm text-left text-xl font-semibold tracking-tight transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {boardName}
          </button>
        )}
```

In `src/components/boards/ViewSwitcher.tsx`, in the `ViewTab` tab button (lines 204–210), add the focus classes to the base string:

```tsx
        className={cn(
          "focus-visible:ring-ring flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
          selected
            ? "text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
          pending && "opacity-60",
        )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/boards/BoardHeader.test.tsx src/components/boards/ViewSwitcher.test.tsx`
Expected: PASS — new and pre-existing tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/BoardHeader.tsx src/components/boards/ViewSwitcher.tsx src/components/boards/BoardHeader.test.tsx src/components/boards/ViewSwitcher.test.tsx
git commit -m "polish(boards): stable rename height, view-tab focus ring" -m "Board title renders in a fixed h-8 line box in display mode so toggling
into the h-8 rename Input no longer shifts the header by 4px. ViewSwitcher
tab buttons gain the branded focus-visible ring used across the app. The
'View only' badge was verified static (server prop) and left unchanged.
Spec D6-D7.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: GoalTree + PortfolioGrid row polish

**Files:**

- Modify: `src/components/goals/GoalTree.tsx:83-108`
- Modify: `src/components/portfolios/PortfolioGrid.tsx:147`
- Create: `src/components/goals/GoalTree.test.tsx`

**Interfaces:**

- Consumes: nothing from other tasks (independent).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `src/components/goals/GoalTree.test.tsx`. `GoalTree` reads `useSearchParams` — mock navigation the same way the codebase's other client-component tests do (see `src/components/portfolios/PortfolioGridSkeleton.test.tsx` siblings for the project's vi.mock pattern; a plain `vi.mock("next/navigation")` returning `useSearchParams: () => new URLSearchParams()` suffices):

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { GoalTree } from "./GoalTree";
import type { GoalNode } from "@/lib/goals/types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const child: GoalNode = {
  id: "g2",
  name: "Child goal",
  status: "on_track",
  progress: 50,
  progressMode: "children",
  currentValue: null,
  targetValue: null,
  unit: null,
  autoHealth: null,
  owner: null,
  children: [],
} as GoalNode;

const parent: GoalNode = {
  ...child,
  id: "g1",
  name: "Parent goal",
  children: [child],
};

test("row expand and open controls carry the branded focus ring", () => {
  render(<GoalTree tree={[parent]} />);
  const chevron = screen.getByRole("button", { name: /collapse|expand/i });
  expect(chevron.className).toContain("focus-visible:ring");
  const name = screen.getByRole("button", { name: "Parent goal" });
  expect(name.className).toContain("focus-visible:ring");
});

test("data rows transition their hover background", () => {
  render(<GoalTree tree={[parent]} />);
  const row = screen.getByRole("button", { name: "Parent goal" }).closest("tr");
  expect(row!.className).toContain("hover:bg-accent/30");
  expect(row!.className).toContain("transition-colors");
});
```

If the `GoalNode` fields above don't match `src/lib/goals/types.ts` exactly, fix the fixture to the real type — do not cast through `any`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/goals/GoalTree.test.tsx`
Expected: FAIL — no `focus-visible` classes on either button; no `transition-colors` on the row.

- [ ] **Step 3: Implement**

In `src/components/goals/GoalTree.tsx`:

Line 83 — the data row:

```tsx
      <tr className="hover:bg-accent/30 border-t transition-colors">
```

Lines 87–98 — the expand chevron:

```tsx
              <button
                type="button"
                onClick={() => toggle(node.id)}
                aria-label={isOpen ? "Collapse" : "Expand"}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
```

Lines 102–108 — the goal-name button:

```tsx
            <button
              type="button"
              onClick={() => openGoal(node.id)}
              className="focus-visible:ring-ring rounded-sm text-left font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
```

In `src/components/portfolios/PortfolioGrid.tsx`, line 147 — the data row:

```tsx
              <tr key={row.id} className="hover:bg-accent/30 border-t transition-colors">
```

(No sort-button changes in either file — they are already correct; see the spec's verification table 9a.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/goals/GoalTree.test.tsx src/components/portfolios`
Expected: PASS — new GoalTree tests green; existing portfolios tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/components/goals/GoalTree.tsx src/components/goals/GoalTree.test.tsx src/components/portfolios/PortfolioGrid.tsx
git commit -m "polish(goals,portfolios): row focus rings and hover transitions" -m "GoalTree's expand chevron and goal-name buttons gain the branded
focus-visible ring and color transitions; GoalTree and PortfolioGrid data
rows transition their existing hover:bg-accent/30. Sort buttons untouched
(already have pressed feedback, focus rings and transitions); hover is not
added to non-interactive tables. Spec D7.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after all batches)

- [ ] Run the full gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green.
- [ ] Manual smoke (dev server): item panel tab switch fades and holds keyboard focus ring; drag a file over the Files tab (ring eases in); notifications popover rows align read/unread; board title click-to-rename doesn't jump; Tab-key through goal rows and view tabs shows brand rings.
- [ ] `scripts/finish-task.sh` from the worktree, then the "How to test this" walkthrough per AGENTS.md.

## Performance & data-fetching budget (rule #5 restated for the plan)

First paint: unchanged (classes/ARIA/one wrapper div only). Every interaction in this plan —
tab switch, hover, focus, drag-over, fade — is **0 new server round-trips**: pure client
rendering over already-loaded data; no fetch, navigation, or Server Action is added. No reads
added or altered, so bounded/indexed-read requirements are n/a. Motion is opacity/transform/
box-shadow/color only and globally disabled under `prefers-reduced-motion`.
