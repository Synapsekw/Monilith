# Nav-declutter Minors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the four deferred nav-declutter Minors — kill the redundant sidebar `countNewFeedback` round-trip, delete the dead `isOrgAdmin`/`isPlatformAdmin`/`newFeedbackCount` plumbing, fix `NavSection`'s dangling `aria-controls`, and backfill the `listDashboardsCached` workspace-filter test.

**Architecture:** Three parallel-safe units over disjoint file sets. Unit A (Tasks 1+2, same files → serialized) removes dead sidebar plumbing; Unit B (Task 3) fixes `NavSection` a11y + adds its test; Unit C (Task 4) adds a dashboards-query test. Pure cleanup + coverage — no schema, no new features, no user-facing behavior change.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript (strict), Vitest + @testing-library/react, Zustand (`useUIStore`), Supabase.

**Spec:** `docs/superpowers/specs/2026-07-05-nav-declutter-minors-design.md`

---

## File Structure

- `src/components/shell/sidebar-nav-data.tsx` — RSC loader `getSidebarNavData` (Tasks 1, 2)
- `src/components/shell/sidebar-nav.tsx` — `SidebarNav` client component + props type (Tasks 1, 2)
- `src/components/shell/workspace-switcher.tsx` — `WorkspaceSwitcher` props type (Task 2)
- `src/components/shell/workspace-switcher.test.tsx` — drop `isOrgAdmin` prop (Task 2)
- `src/components/shell/sidebar-nav-data.test.tsx` — drop now-unused guard mocks (Task 2)
- `src/components/shell/nav-section.tsx` — always-render body + `hidden` + title-button ARIA (Task 3)
- `src/components/shell/nav-section.test.tsx` — **new** a11y test (Task 3)
- `src/lib/dashboards/queries-cached.test.ts` — workspace-filter test + chainable mock (Task 4)

**No files touched by more than one Unit.** Within Unit A, Tasks 1 and 2 both edit
`sidebar-nav-data.tsx` and `sidebar-nav.tsx`, so run them as one agent, sequentially.

---

## Execution DAG

**Dependency graph (edges = "must finish before"):**

- Task 1 → Task 2 (both edit `sidebar-nav-data.tsx` + `sidebar-nav.tsx`; same-file ordering only)
- Task 3 — no dependencies
- Task 4 — no dependencies

**Parallel batches (waves of concurrent agents):**

- **Batch 1 (run concurrently):** Unit A = {Task 1 then Task 2} (one agent, sequential internally) ‖ Task 3 (agent) ‖ Task 4 (agent)

Because Units A, B, C edit disjoint files, all three can be dispatched at once with
`superpowers:dispatching-parallel-agents`. This is a single small task branch (`task/nav-declutter-minors`)
— the three units are trivially non-conflicting in one worktree, so separate per-unit worktrees are
optional here (unlike large multi-task work). If dispatching parallel subagents in-session, prefer
one worktree and let each agent stage only its own paths.

**Critical path:** Task 1 → Task 2 (Unit A) — two serial edits over the shared sidebar files. Units
B and C finish within it. Wall-clock floor ≈ Unit A.

**Final gate (after all three units merge locally):** run the full suite once on the integrated
tree: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `scripts/finish-task.sh`.

---

## Task 1: Remove the redundant `countNewFeedback` round-trip from the sidebar loader

**Files:**

- Modify: `src/components/shell/sidebar-nav-data.tsx`
- Modify: `src/components/shell/sidebar-nav.tsx` (props type only)
- Test: `src/components/shell/sidebar-nav-data.test.tsx` (existing — must still pass)

> Run all commands from the worktree root
> (`/Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/nav-declutter-minors`).

- [ ] **Step 1: Run the existing loader test to capture the green baseline**

Run: `pnpm test src/components/shell/sidebar-nav-data.test.tsx`
Expected: PASS (3 assertions: "Sprint backlog", "Velocity", "Eng" render).

- [ ] **Step 2: Remove the feedback/platform-admin plumbing from the loader**

In `src/components/shell/sidebar-nav-data.tsx`, delete the two now-unused imports:

```ts
// DELETE these two lines:
import { isPlatformAdminCached } from "@/lib/platform/guard";
import { countNewFeedback } from "@/lib/feedback/queries";
```

Then rewrite the body of `getSidebarNavData` so the `Promise.all` drops `isPlatformAdminCached`
(and, in Task 2, `isOrgAdminCached`) and the `newFeedbackCount` line + returned keys are gone. After
this step (before Task 2) it reads:

```ts
const workspaces = await listWorkspacesCached(orgId);
const activeWorkspaceId = await getActiveWorkspaceId(workspaces);

const [boards, sharedBoards, dashboards, orgAdmin] = await Promise.all([
  listMyBoardsCached(userId, activeWorkspaceId),
  listSharedBoardsCached(userId),
  listDashboardsCached(orgId, activeWorkspaceId),
  isOrgAdminCached(userId, orgId),
]);

return {
  boards,
  sharedBoards,
  workspaces,
  activeWorkspaceId,
  dashboards: dashboards.map((d) => ({ id: d.id, name: d.name })),
  isOrgAdmin: orgAdmin,
};
```

(`isOrgAdminCached` / `isOrgAdmin` are removed in Task 2 — leave them here for now so this task
stays independently type-correct.)

- [ ] **Step 3: Remove `isPlatformAdmin` and `newFeedbackCount` from the `SidebarNav` props type**

In `src/components/shell/sidebar-nav.tsx`, delete these two lines from the props type object
(the `{ … }` after the destructure in the `SidebarNav` signature):

```ts
// DELETE:
isPlatformAdmin?: boolean;
newFeedbackCount?: number;
```

Leave `isOrgAdmin?: boolean` for now (removed in Task 2). `MobileNav` and `MobileNavData` inherit
the type via `ComponentProps<typeof SidebarNav>` — no edits needed there.

- [ ] **Step 4: Verify the loader test still passes and types are clean**

Run: `pnpm test src/components/shell/sidebar-nav-data.test.tsx && pnpm typecheck`
Expected: test PASS (same 3 assertions), typecheck PASS. If typecheck flags an unused
`isPlatformAdminCached`/`countNewFeedback` import you missed, remove it.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/sidebar-nav-data.tsx src/components/shell/sidebar-nav.tsx
git commit -m "perf(shell): drop redundant countNewFeedback round-trip from sidebar loader"
```

---

## Task 2: Delete the dead `isOrgAdmin` plumbing (loader → SidebarNav → WorkspaceSwitcher)

**Depends on:** Task 1 (same two files — do not run concurrently with Task 1).

**Files:**

- Modify: `src/components/shell/sidebar-nav-data.tsx`
- Modify: `src/components/shell/sidebar-nav.tsx`
- Modify: `src/components/shell/workspace-switcher.tsx`
- Modify: `src/components/shell/workspace-switcher.test.tsx`
- Modify: `src/components/shell/sidebar-nav-data.test.tsx`

- [ ] **Step 1: Remove `isOrgAdmin` from `WorkspaceSwitcher`'s props type**

In `src/components/shell/workspace-switcher.tsx`, delete the `isOrgAdmin?: boolean;` line from the
props type (the object after the destructure, currently around line 34). The component body already
never references it, so nothing else changes.

- [ ] **Step 2: Remove `isOrgAdmin` from `SidebarNav` (type, destructure, and pass-through)**

In `src/components/shell/sidebar-nav.tsx`:

1. Delete `isOrgAdmin,` from the destructured params.
2. Delete `isOrgAdmin?: boolean;` from the props type object.
3. In the `<WorkspaceSwitcher …>` JSX, delete the `isOrgAdmin={!!isOrgAdmin}` prop line.

The call site becomes:

```tsx
<WorkspaceSwitcher
  workspaces={workspaces}
  activeWorkspaceId={activeWorkspaceId}
  collapsed={isCollapsed}
/>
```

- [ ] **Step 3: Remove `isOrgAdminCached` from the loader**

In `src/components/shell/sidebar-nav-data.tsx`:

1. Delete the import `import { isOrgAdminCached } from "@/lib/org/guard";`.
2. Drop `isOrgAdminCached(userId, orgId)` from the `Promise.all` and `orgAdmin` from its
   destructure.
3. Drop `isOrgAdmin: orgAdmin,` from the returned object.

Final loader body:

```ts
const workspaces = await listWorkspacesCached(orgId);
const activeWorkspaceId = await getActiveWorkspaceId(workspaces);

const [boards, sharedBoards, dashboards] = await Promise.all([
  listMyBoardsCached(userId, activeWorkspaceId),
  listSharedBoardsCached(userId),
  listDashboardsCached(orgId, activeWorkspaceId),
]);

return {
  boards,
  sharedBoards,
  workspaces,
  activeWorkspaceId,
  dashboards: dashboards.map((d) => ({ id: d.id, name: d.name })),
};
```

- [ ] **Step 4: Drop the `isOrgAdmin` prop from the WorkspaceSwitcher test**

In `src/components/shell/workspace-switcher.test.tsx`, remove the `isOrgAdmin` prop from
`renderSwitcher`'s JSX so it reads:

```tsx
<WorkspaceSwitcher workspaces={ws} activeWorkspaceId={active} />
```

- [ ] **Step 5: Drop the now-unused guard mocks from the loader test**

In `src/components/shell/sidebar-nav-data.test.tsx`, delete both mock blocks that are no longer
referenced by the (smaller) loader:

```ts
// DELETE both:
vi.mock("@/lib/platform/guard", () => ({
  isPlatformAdminCached: vi.fn(async () => false),
}));
vi.mock("@/lib/org/guard", () => ({
  isOrgAdminCached: vi.fn(async () => false),
}));
```

Leave every other mock (session, boards, dashboards, workspaces, active) and all three assertions
intact.

- [ ] **Step 6: Run the two affected tests + typecheck**

Run: `pnpm test src/components/shell/sidebar-nav-data.test.tsx src/components/shell/workspace-switcher.test.tsx && pnpm typecheck`
Expected: both suites PASS; typecheck PASS with no unused-import or unused-variable errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/shell/sidebar-nav-data.tsx src/components/shell/sidebar-nav.tsx src/components/shell/workspace-switcher.tsx src/components/shell/workspace-switcher.test.tsx src/components/shell/sidebar-nav-data.test.tsx
git commit -m "refactor(shell): remove dead isOrgAdmin plumbing from sidebar + workspace switcher"
```

---

## Task 3: Fix `NavSection`'s dangling `aria-controls` + add its a11y test

**Files:**

- Modify: `src/components/shell/nav-section.tsx`
- Create: `src/components/shell/nav-section.test.tsx`

- [ ] **Step 1: Write the failing a11y test**

Create `src/components/shell/nav-section.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavSection } from "./nav-section";
import { useUIStore } from "@/stores/ui";

// Reset persisted collapse state so per-key state can't leak between cases.
beforeEach(() => {
  useUIStore.setState({ collapsedSections: {} });
});

function renderSection() {
  return render(
    <NavSection storageKey="planning" title="Planning">
      <a href="/goals">Goals</a>
    </NavSection>,
  );
}

describe("NavSection", () => {
  it("defaults to expanded with a resolvable aria-controls target", () => {
    renderSection();
    const toggle = screen.getByRole("button", { name: /collapse planning/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const bodyId = toggle.getAttribute("aria-controls");
    expect(bodyId).toBe("nav-section-planning");
    const body = document.getElementById(bodyId!);
    expect(body).not.toBeNull();
    expect(body).not.toHaveAttribute("hidden");
  });

  it("keeps the body element in the DOM (hidden) when collapsed", async () => {
    renderSection();
    await userEvent.click(
      screen.getByRole("button", { name: /collapse planning/i }),
    );
    const toggle = screen.getByRole("button", { name: /expand planning/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const body = document.getElementById("nav-section-planning");
    // aria-controls must still resolve to a real (hidden) element.
    expect(body).not.toBeNull();
    expect(body).toHaveAttribute("hidden");
  });

  it("gives the title toggle button matching aria-expanded/controls", () => {
    renderSection();
    const titleBtn = screen.getByRole("button", { name: "Planning" });
    expect(titleBtn).toHaveAttribute("aria-expanded", "true");
    expect(titleBtn).toHaveAttribute("aria-controls", "nav-section-planning");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/shell/nav-section.test.tsx`
Expected: FAIL — the "keeps the body element in the DOM (hidden)" case fails because the body is
currently unmounted when collapsed (`getElementById` returns `null`), and the "title toggle button"
case fails because the title button has no `aria-expanded`/`aria-controls` yet.

- [ ] **Step 3: Always render the body and toggle with `hidden`**

In `src/components/shell/nav-section.tsx`, replace the conditional body render:

```tsx
// BEFORE:
{
  open ? (
    <div id={bodyId} className="flex flex-col gap-0.5">
      {children}
    </div>
  ) : null;
}
```

```tsx
// AFTER:
<div id={bodyId} hidden={!open} className="flex flex-col gap-0.5">
  {children}
</div>
```

- [ ] **Step 4: Add matching ARIA to the title toggle button**

In the same file, the non-link title `<button>` (the `titleHref` `else` branch) gains the same
state/target attributes as the chevron:

```tsx
<button
  type="button"
  onClick={() => toggleSection(storageKey)}
  aria-expanded={open}
  aria-controls={bodyId}
  className={titleCn}
>
  {title}
</button>
```

Leave the `titleHref` `<Link>` branch unchanged (it navigates, it does not toggle).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/components/shell/nav-section.test.tsx`
Expected: PASS (all 3 cases).

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/nav-section.tsx src/components/shell/nav-section.test.tsx
git commit -m "fix(a11y): keep NavSection body mounted so aria-controls always resolves"
```

---

## Task 4: Test the `listDashboardsCached` workspace-filter path

**Files:**

- Modify: `src/lib/dashboards/queries-cached.test.ts`

- [ ] **Step 1: Make the list-query mock chainable for `.eq().eq()`**

In `src/lib/dashboards/queries-cached.test.ts`, replace the current single-`eq` list mock:

```ts
// BEFORE:
const limitForList = vi.fn();
const orderForList = vi.fn(() => ({ limit: limitForList }));
const listEq = vi.fn(() => ({ order: orderForList }));
const listSelect = vi.fn(() => ({ eq: listEq }));
```

with a chainable builder that supports a second `.eq` (workspace filter) then `.order().limit()`:

```ts
// AFTER:
const limitForList = vi.fn();
const orderForList = vi.fn(() => ({ limit: limitForList }));
// Builder returned by each .eq(): supports chaining another .eq() or terminating with .order().
const listBuilder: {
  eq: ReturnType<typeof vi.fn>;
  order: typeof orderForList;
} = {
  eq: vi.fn(() => listBuilder),
  order: orderForList,
};
const listEq = listBuilder.eq;
const listSelect = vi.fn(() => ({ eq: listEq }));
```

- [ ] **Step 2: Update `beforeEach` to reset the new mock shape**

In the `beforeEach`, keep resetting `orderForList`/`limitForList` and clear the builder's `eq`:

```ts
beforeEach(() => {
  listSelect.mockClear();
  listEq.mockClear();
  orderForList.mockClear();
  orderForList.mockReturnValue({ limit: limitForList });
  limitForList.mockReset();
  rpc.mockReset();
  colSelect.mockClear();
  colEq.mockClear();
  colMaybeSingle.mockReset();
});
```

(The three existing `listDashboardsCached` tests keep passing: `select().eq("org_id").order().limit()`
resolves because the builder exposes `order`, and `listEq` is still asserted via
`toHaveBeenCalledWith("org_id", "org-A")`.)

- [ ] **Step 3: Run the file to confirm the existing tests still pass under the new mock**

Run: `pnpm test src/lib/dashboards/queries-cached.test.ts`
Expected: PASS (existing `listDashboardsCached` + `getWidgetAggregationCached` cases unchanged).

- [ ] **Step 4: Add the workspace-filter tests**

Inside `describe("listDashboardsCached", …)`, add:

```ts
it("scopes to workspace_id when a workspaceId is given", async () => {
  limitForList.mockResolvedValue({ data: [], error: null });
  await listDashboardsCached("org-A", "ws-1");
  expect(listEq).toHaveBeenCalledWith("org_id", "org-A");
  expect(listEq).toHaveBeenCalledWith("workspace_id", "ws-1");
});

it("does not scope by workspace when no workspaceId is given", async () => {
  limitForList.mockResolvedValue({ data: [], error: null });
  await listDashboardsCached("org-A");
  expect(listEq).toHaveBeenCalledWith("org_id", "org-A");
  expect(listEq).not.toHaveBeenCalledWith("workspace_id", expect.anything());
});
```

- [ ] **Step 5: Run the test to verify the new cases pass**

Run: `pnpm test src/lib/dashboards/queries-cached.test.ts`
Expected: PASS (5 `listDashboardsCached` cases + the `getWidgetAggregationCached` cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboards/queries-cached.test.ts
git commit -m "test(dashboards): cover listDashboardsCached workspace-filter path"
```

---

## Final Gate (after all four tasks)

- [ ] **Run the full gate on the integrated tree**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four green. Then run `scripts/finish-task.sh` from the worktree to rebase onto latest
`develop`, re-gate, merge, push, and clean up the worktree/branch.

- [ ] **Closing note to the user**

No user-facing behavior changes — this is dead-code removal, an a11y fix, and added test coverage,
verified by the suite (typecheck/lint/test/build). Optional manual sanity check on `develop`:
collapse/expand a sidebar section (Planning/Personal) and switch workspaces — both behave exactly as
before; a screen reader no longer reports a control targeting a missing region.

---

## Self-Review

- **Spec coverage:** Item 1 → Task 1; Item 2 → Task 2; Item 3 → Task 3; Item 4 → Task 4. All four
  spec items map to a task. The spec's shared-file note (items 1+2) is honored by ordering Task 2
  after Task 1 over the same two files.
- **Placeholder scan:** none — every code step shows the exact before/after and each run step names
  the command + expected result.
- **Type consistency:** loader returns `{ boards, sharedBoards, workspaces, activeWorkspaceId,
dashboards }` after Task 2; `SidebarNav`/`MobileNav` prop types derive from this via
  `ComponentProps`, so removing props in one place propagates. `bodyId` (`nav-section-<key>`) is used
  identically in component and test. Mock builder `listBuilder.eq === listEq` keeps the assertion
  target stable across Task 4 steps.
- **AGENTS.md invariants:** Server-Components-default preserved (loader stays an RSC; no client
  conversion); no Zod boundary added or removed (no new external input); no `any` introduced (the
  test builder is explicitly typed); tests mandatory and written first where behavior changes (Tasks
  3, 4) or preserved-green where only dead code is removed (Tasks 1, 2). Perf budget: net −1 Supabase
  round-trip, 0 new fetches.
