# Board-Switch Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make switching between boards feel instant by moving the app shell into a persistent layout, adding an instant loading skeleton, and de-duplicating the auth call.

**Architecture:** Extract `AppShell` + its data (orgs/boards/workspaces) out of the board page into `app/boards/layout.tsx` — Next.js 16 preserves shared layouts across sibling dynamic-segment navigation, so the shell is fetched once and never re-fetched on switch. Add `app/boards/[boardId]/loading.tsx` so navigation shows an instant skeleton (and, via default `prefetch="auto"`, pre-warms sidebar links). The slimmed page fetches only board-specific data. `BoardsNav` derives the active board from `useParams()` since the layout no longer knows `boardId`.

**Tech Stack:** Next.js 16 (App Router, RSC), Supabase, React `cache()`, Vitest + Testing Library, Tailwind v4 / pulse-ui tokens.

**Spec:** `docs/superpowers/specs/2026-06-17-board-switch-perf-design.md`

**Branch:** Work on `develop` (per working agreement — no feature branches).

---

## File Structure

- Modify: `src/lib/auth/session.ts` — wrap `getUser` in React `cache()`.
- Modify: `src/components/app-shell.tsx` — remove `activeBoardId` prop.
- Modify: `src/components/boards/BoardsNav.tsx` — derive active board via `useParams`.
- Modify: `src/components/boards/BoardsNav.test.tsx` — add `useParams` to mock; assert active highlight.
- Modify: `src/components/app-shell.test.tsx` — no change to behavior; confirm still green after prop removal.
- Create: `src/app/boards/layout.tsx` — persistent shell.
- Modify: `src/app/boards/[boardId]/page.tsx` — slim to board-only data.
- Create: `src/app/boards/[boardId]/loading.tsx` — board skeleton.
- Create: `vault/decisions/2026-06-17-gotcha-10-board-payload-unbounded-reads.md` — deferred ADR.

---

### Task 1: Dedupe the auth call with React `cache()`

**Files:**

- Modify: `src/lib/auth/session.ts`

- [ ] **Step 1: Wrap `getUser` in `cache()`**

Replace the top of `src/lib/auth/session.ts` (imports + `getUser`) with:

```ts
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

export type Organization = Tables<"organizations">;

/**
 * Returns the authenticated Supabase user, or null when unauthenticated.
 * Wrapped in React `cache()` so the layout and page in one request share a
 * single `auth.getUser()` round-trip instead of two.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
```

Leave `requireUser` and `getUserOrgs` unchanged below it.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/session.ts
git commit -m "perf(boards): dedupe auth via React cache() in session.getUser"
```

---

### Task 2: Make `BoardsNav` derive the active board from `useParams`

**Files:**

- Modify: `src/components/boards/BoardsNav.test.tsx`
- Modify: `src/components/boards/BoardsNav.tsx`

- [ ] **Step 1: Update the test — add `useParams` mock + active-highlight assertion**

Replace the mock block and add a test in `src/components/boards/BoardsNav.test.tsx`. New mock (top of file):

```tsx
const mockUseParams = vi.fn(() => ({}) as Record<string, string>);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => mockUseParams(),
}));
```

Add this test inside `describe("BoardsNav", ...)`:

```tsx
it("marks the board matching the route param as active", () => {
  mockUseParams.mockReturnValue({ boardId: "board-123" });
  render(
    <BoardsNav
      boards={[
        {
          id: "board-123",
          name: "Active Board",
          workspace_id: "w1",
          position: 0,
        },
        {
          id: "board-456",
          name: "Other Board",
          workspace_id: "w1",
          position: 1,
        },
      ]}
      workspaces={noWorkspaces}
    />,
  );

  expect(screen.getByRole("link", { name: "Active Board" })).toHaveClass(
    "bg-surface",
  );
  expect(screen.getByRole("link", { name: "Other Board" })).not.toHaveClass(
    "bg-surface",
  );
});
```

Note: existing tests call `<BoardsNav boards={...} workspaces={...} />` with no `activeBoardId` — they keep working since `mockUseParams` defaults to `{}`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/boards/BoardsNav.test.tsx`
Expected: FAIL — `useParams` is not exported by the current mock / `BoardsNav` still expects an `activeBoardId` prop, so the active link is not highlighted.

- [ ] **Step 3: Update `BoardsNav` to use `useParams`**

In `src/components/boards/BoardsNav.tsx`:

Change the import line `import { useRouter } from "next/navigation";` to:

```tsx
import { useParams, useRouter } from "next/navigation";
```

Change the component signature — remove `activeBoardId` from props:

```tsx
export function BoardsNav({
  boards,
  workspaces,
}: {
  boards: BoardListEntry[];
  workspaces: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { boardId: activeBoardId } = useParams<{ boardId: string }>();
```

Leave the rest of the component (including the `b.id === activeBoardId` highlight on the `<Link>`) unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/boards/BoardsNav.test.tsx`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/BoardsNav.tsx src/components/boards/BoardsNav.test.tsx
git commit -m "refactor(boards): derive active board in BoardsNav via useParams"
```

---

### Task 3: Remove `activeBoardId` from `AppShell`

**Files:**

- Modify: `src/components/app-shell.tsx`
- Test: `src/components/app-shell.test.tsx` (no edit needed — confirm green)

- [ ] **Step 1: Remove the prop from the type and the component**

In `src/components/app-shell.tsx`:

Remove **only** the `activeBoardId?: string;` line from `AppShellProps`. **Keep** the
`currentUserId?: string;` prop and the `<NotificationsBell userId={currentUserId} />` usage — those
belong to the notifications feature and must stay.

Remove `activeBoardId,` from the destructured params in `export function AppShell({ ... })` (keep
`currentUserId,`).

Change the `<BoardsNav .../>` usage (currently passing `activeBoardId`) to:

```tsx
<BoardsNav boards={boards ?? []} workspaces={workspaces ?? []} />
```

- [ ] **Step 2: Run the AppShell tests**

Run: `pnpm test src/components/app-shell.test.tsx`
Expected: PASS — these tests never passed `activeBoardId`, and `BoardsNav` (mocked `useParams` returns `{}`) renders fine.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: FAIL — `src/app/boards/[boardId]/page.tsx` still passes `activeBoardId={boardId}` to `AppShell`. This is expected and fixed in Task 5. (If you prefer a green checkpoint, do Steps 4 of Task 4 + Task 5 before committing — but committing here is acceptable since the page is rewritten next.)

- [ ] **Step 4: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "refactor(boards): drop activeBoardId prop from AppShell"
```

---

### Task 4: Create the persistent boards layout

**Files:**

- Create: `src/app/boards/layout.tsx`

- [ ] **Step 1: Write the layout**

Create `src/app/boards/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { listBoards } from "@/lib/boards/queries";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Persistent shell for every board route. Next.js 16 preserves a shared layout
 * across navigation between sibling dynamic segments (`/boards/A → /boards/B`),
 * so these shell queries run once and are NOT re-fetched on board switch — the
 * sidebar stays mounted and only the page segment re-renders.
 */
export default async function BoardsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const [orgs, boards, { data: workspaces }] = await Promise.all([
    getUserOrgs(),
    listBoards(),
    supabase.from("workspaces").select("id, name"),
  ]);

  return (
    <AppShell
      currentUserId={user.id}
      user={{
        email: user.email,
        full_name:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : null,
      }}
      org={{ name: orgs[0]?.name ?? "Pulse" }}
      workspaces={workspaces ?? []}
      boards={boards}
    >
      {children}
    </AppShell>
  );
}
```

Note: `currentUserId={user.id}` is required so the notifications bell (`<NotificationsBell>` inside
`AppShell`) keeps working now that the shell lives in the layout.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: still FAILS only on `page.tsx` (it still references `AppShell`/`activeBoardId`). Fixed in Task 5. The layout itself must contribute no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/boards/layout.tsx
git commit -m "perf(boards): add persistent boards layout holding the app shell"
```

---

### Task 5: Slim the board page to board-only data

**Files:**

- Modify: `src/app/boards/[boardId]/page.tsx`

- [ ] **Step 1: Replace the page body**

Replace the entire contents of `src/app/boards/[boardId]/page.tsx` with:

```tsx
import { notFound } from "next/navigation";
import { BoardViews } from "@/components/boards/BoardViews";
import { getBoardPayload, listOrgMembers } from "@/lib/boards/queries";
import { resolveSelectedView } from "@/lib/boards/views";
import { requireUser } from "@/lib/auth/session";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { boardId } = await params;
  const user = await requireUser();

  const payload = await getBoardPayload(boardId);
  if (!payload) notFound();

  const { view } = await searchParams;
  const selected = resolveSelectedView(payload.views, view);
  const selectedViewId = selected?.id ?? payload.views[0]?.id ?? "";

  const members = await listOrgMembers(payload.board.org_id);

  return (
    <BoardViews
      payload={payload}
      members={members}
      initialViewId={selectedViewId}
      currentUserId={user.id}
    />
  );
}
```

This removes the `AppShell`, `getUserOrgs`, `listBoards`, and `workspaces` fetches (now in the layout) and keeps only `getBoardPayload` + `listOrgMembers`. `requireUser()` here reuses the layout's cached `getUser()` call (Task 1).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors anywhere now).

- [ ] **Step 3: Commit**

```bash
git add "src/app/boards/[boardId]/page.tsx"
git commit -m "perf(boards): slim board page to board-only data (shell moved to layout)"
```

---

### Task 6: Add the instant loading skeleton

**Files:**

- Create: `src/app/boards/[boardId]/loading.tsx`

> **UI step — load the `pulse-ui` skill first** (project rule 3) to confirm token names (`bg-muted`, spacing) before styling. The markup below is the baseline; adjust class tokens to match pulse-ui if they differ.

- [ ] **Step 1: Write the skeleton**

Create `src/app/boards/[boardId]/loading.tsx`:

```tsx
/**
 * Instant loading fallback for a board. Rendered immediately on navigation
 * while the board page streams in; the layout (sidebar + header) stays mounted,
 * so only this content area shows the skeleton.
 */
export default function BoardLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading board"
      className="flex h-full flex-col gap-4 p-6"
    >
      <div className="bg-muted h-8 w-48 animate-pulse rounded-md" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="bg-muted/60 h-10 w-full animate-pulse rounded-md"
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/boards/[boardId]/loading.tsx"
git commit -m "perf(boards): add instant loading skeleton for board navigation"
```

---

### Task 7: Log the deferred unbounded-read concern as an ADR

**Files:**

- Create: `vault/decisions/2026-06-17-gotcha-10-board-payload-unbounded-reads.md`

- [ ] **Step 1: Write the ADR**

Create `vault/decisions/2026-06-17-gotcha-10-board-payload-unbounded-reads.md`:

```markdown
---
type: adr
date: 2026-06-17
status: accepted
tags: [gotcha, performance, data-fetching, boards, scaling]
related:
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
---

# Gotcha 10 — getBoardPayload reads items/cell_values/dependencies unbounded

## Context

`getBoardPayload` (`src/lib/boards/queries.ts`) fetches `items`, `cell_values`, and
`item_dependencies` with `select("*")` and no `.limit()`. While fixing slow board switching
(see the board-switch perf work, 2026-06-17) we confirmed the DB is currently tiny
(~110 items, ~42 cell_values, ~8 dependencies total), so these reads are NOT the cause of
the switch slowness and cost effectively nothing today.

## Decision

Leave the reads unbounded for now (YAGNI), but record that on a hot path they MUST become
bounded before any board grows to hundreds of items / thousands of cell_values. The filter
columns (`board_id`) are indexed, so the work is pagination/virtualization of the read, not
indexing.

## Consequences

- No change now.
- Before boards scale: page/virtualize the `items`/`cell_values` reads (the board cache and
  Table already virtualize rendering; the _fetch_ would need bounding too), and reassess
  `item_dependencies` growth.
```

- [ ] **Step 2: Commit**

```bash
git add vault/decisions/2026-06-17-gotcha-10-board-payload-unbounded-reads.md
git commit -m "docs(adr): log deferred unbounded board-payload reads (gotcha 10)"
```

---

### Task 8: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four PASS.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Run `pnpm dev`, open a board, then click another board in the sidebar. Confirm:

- the sidebar does NOT flash/remount,
- a skeleton appears instantly in the content area,
- the new board renders.

- [ ] **Step 3: Final commit (only if Step 1/2 produced fixes)**

```bash
git add -A
git commit -m "test(boards): verify board-switch perf changes green"
```

---

## Self-Review Notes

- **Spec coverage:** layout extraction (Task 4), slim page (Task 5), loading.tsx (Task 6),
  session `cache()` (Task 1), AppShell prop removal (Task 3), BoardsNav `useParams` (Task 2),
  deferred-read ADR (Task 7), test/gate (Tasks 2, 3, 8). Prefetch is free (default `auto` +
  loading.tsx) — no task needed. `getBoardPayload` flatten intentionally excluded per decision.
- **Ordering note:** typecheck is intentionally red between Task 3 and Task 5 (AppShell prop
  removed before the page stops passing it). It goes green at Task 5 Step 2 and stays green.
