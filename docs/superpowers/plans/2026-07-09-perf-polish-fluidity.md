# Performance & Fluidity Implementation Plan (PF)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pulse feel polished, fast and snappy — cut cold-load latency on the hottest routes, give every navigation instant feedback, keep the client bundle off the critical path, and remove interaction jank — without regressing the gotcha-09 0-refetch view model or the RLS boundary.

**Architecture:** Four independent workstreams, each in its own `task/*` worktree, derived from a four-dimension performance scan (rendering/caching, data-fetching, client smoothness, bundle). The baseline is already strong (Cache Components/PPR, streamed shell, `React.cache` on auth/org reads, optimistic board mutations, virtualized Table/Kanban, disciplined code-splitting), so this is a **targeted-gap** program, not a rewrite. Batch A removes server round-trips on the board / home / dashboard / my-work paths; Batch B removes typing lag and un-virtualized renders in the board views; Batch C trims the always-loaded JS bundle; Batch D removes redundant refreshes and blank-content windows.

**Tech Stack:** Next.js 16 (App Router, Cache Components/PPR, Turbopack), React 19 (`useDeferredValue`, `use()`, `memo`), TypeScript strict, Supabase (RLS + SECURITY INVOKER RPC), `@tanstack/react-virtual`, Zustand, `next/dynamic`, Vitest + @testing-library/react.

---

## Global Constraints

Copied from AGENTS.md / the north-star — every task's requirements implicitly include these:

- **Server Components by default.** `"use client"` only for interactivity; **all mutations go through Server Actions**. This is Next.js 16 — confirm framework APIs against `node_modules/next/dist/docs/` before writing them.
- **gotcha-09 is non-negotiable.** In-page view/tab/filter/sort/search state stays **client state + History API** (`window.history.pushState`/`replaceState`), never a `<Link>`/`router` navigation. Any URL param a task touches must stay shareable/restorable. Rationale: `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`.
- **RLS is the security boundary.** Default-deny, org-scoped; never trust the client. Any new RPC is `SECURITY INVOKER` unless a DEFINER helper is explicitly justified; identity comes from `auth.uid()` inside the function, never a parameter. `SUPABASE_SERVICE_ROLE_KEY` never reaches the browser.
- **Schema changes are versioned migrations** applied to **DEV via the `supabase-dev` MCP only** (never prod, never dashboard click-ops). After a migration: `pnpm db:types` and commit the regenerated `src/types/database.types.ts` in the same task. Verify live behavior in a **rolled-back transaction** on DEV.
- **Bounded reads.** Hot-path list/board reads stay bounded (pagination/virtualization) over indexed columns — no unbounded `select *` on growing tables.
- **Commit identity pinned.** Author every commit as `Danijel Jovanovic <info@synapse-solutions.ai>` (verified on Synapsekw — any other email makes Vercel silently skip the deploy). Conventional-commit subjects lowercase after `type(scope):`, with a descriptive body and the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Commit your own work only.** Stage explicitly by path (`git add <paths>`) — never `git add -A`/`.`/`-a`.
- **Isolation.** Each batch runs in its own worktree via `scripts/start-task.sh <name>`; **do not build in the main checkout.** A batch is done only when `pnpm typecheck && pnpm lint && pnpm test && pnpm build` are green and `scripts/finish-task.sh` has merged it to `develop` and removed the worktree.
- **Tests are mandatory** (TDD): a failing test first, then the minimal change, then green — evidence before claims.

## Execution DAG

Four batches, each a worktree; the four are **mutually independent** and can run as concurrent worktrees (they touch disjoint file sets — the only shared-ish file is `src/lib/boards/queries.ts`, edited by A1/A4-adjacent reads and C4, in non-overlapping functions; sequence A before C at merge, or accept a trivial rebase).

- **Batch A — Server latency** (`task/perf-server-latency`): A1, A2, A4, A5, A6 have no unmet deps and run as one wave; **A3 depends on A2** (both edit `src/app/home/page.tsx`). Critical path A2 → A3. Dispatch A6 (migration + DEV apply + `db:types`) first — it is the longest single task.
- **Batch B — Board interaction** (`task/perf-board-interaction`): B1, B3, B4 independent; **B2 lands after B1** (both edit `BoardTable.tsx`). Critical path B1 → B2.
- **Batch C — Bundle & payload** (`task/perf-bundle`): C1, C2, C3, C4, C5 mutually independent — one wave.
- **Batch D — Interaction polish** (`task/perf-polish`): D1–D5 mutually independent (disjoint file sets) — one wave. Critical path = the longest single task (D1).

**Recommended order if run serially:** A (biggest felt win: fewer round-trips + instant skeletons) → C (lighter shell everywhere) → B (board typing/scroll) → D (polish). If run in parallel, all four worktrees at once; each finishes independently.

---

# Batch A — Server latency

> Worktree: `task/perf-server-latency` (`scripts/start-task.sh perf-server-latency`). Removes serial DB round-trips and blank-screen windows on the four hottest entry paths.

### Task A1: Parallelize the board-payload head query

**Files:**

- Modify: `src/lib/boards/queries.ts:146-170` (the head read + the 9-way `Promise.all` inside `getBoardPayload`)
- Test: `src/lib/boards/queries.payload.test.ts` (extend)

**Interfaces:**

- Consumes: nothing (leaf task).
- Produces: `getBoardPayload(boardId)` — signature, return type (`BoardPayload | null`), and error contract unchanged (head-read DB error still throws; missing/RLS-hidden board still returns `null`; satellite-read errors still throw). Only the wire shape changes: the `boards` head row is now fetched **inside** the same `Promise.all` as the 9 board-scoped satellite reads (they filter only on `board_id`, so nothing depends on the head row), collapsing 2 serial round-trips into 1. The two follow-up reads (linked-item names, mirror cells) keep their real data dependency and stay as-is.

- [ ] **Step 1: Write the failing test** — append to `src/lib/boards/queries.payload.test.ts` (inside the existing `describe`; the file wraps `getBoardPayload` in React `cache()`, so every test uses a DISTINCT boardId — these use `b6`/`b7`):

```ts
it("issues the head read and the 9 satellite reads concurrently (one batch)", async () => {
  // With the head read parallelized, a missing board no longer gates the
  // satellites: all 10 table reads fire even when boards resolves empty.
  from.mockImplementation(() => tableMock({ data: null, error: null }));
  expect(await getBoardPayload("b6")).toBeNull();
  const tables = from.mock.calls.map((c) => c[0]);
  expect(tables).toContain("boards");
  expect(tables).toContain("items");
  expect(tables).toContain("cell_values");
  expect(tables).toHaveLength(10);
});

it("a missing board wins over a satellite error (null, not throw)", async () => {
  from.mockImplementation((table: string) =>
    table === "boards"
      ? tableMock({ data: null, error: null })
      : tableMock({ data: null, error: { message: "satellite broke" } }),
  );
  expect(await getBoardPayload("b7")).toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL** (first new test: `tables` has length 1 — the head read short-circuits today): `pnpm vitest run src/lib/boards/queries.payload.test.ts`

- [ ] **Step 3: Implement.** In `src/lib/boards/queries.ts`, delete the standalone head read (lines 150-158) and make it the first member of the `Promise.all`. Remove:

```ts
    const { data: board, error: boardErr } = await supabase
      .from("boards")
      .select("*")
      .eq("id", boardId)
      .maybeSingle();
    if (boardErr) throw new Error(`Failed to load board: ${boardErr.message}`);
    if (!board) return null;

    const [
      groupsRes,
```

and write:

```ts
    // The head row and the 9 satellite reads all key on boardId alone — nothing
    // downstream of the head row is needed to ISSUE them, so they share one
    // Promise.all (1 RTT instead of 2). The head result is still checked FIRST
    // after settle: a missing/RLS-hidden board returns null before any
    // satellite error can throw, preserving the previous error contract.
    const [
      boardRes,
      groupsRes,
```

As the first entry of the `Promise.all` array (before the `groups` query):

```ts
    ] = await Promise.all([
      supabase.from("boards").select("*").eq("id", boardId).maybeSingle(),
```

And immediately **after** the `Promise.all` closes (before the `reads` error loop):

```ts
const { data: board, error: boardErr } = boardRes;
if (boardErr) throw new Error(`Failed to load board: ${boardErr.message}`);
if (!board) return null;
```

Everything else — the `reads` error loop, both follow-up reads, and the returned object (`board` is still in scope with the same inferred type) — is untouched.

- [ ] **Step 4: Run — expect PASS** (all payload tests): `pnpm vitest run src/lib/boards/queries.payload.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/queries.ts src/lib/boards/queries.payload.test.ts
git commit -m "perf(boards): fetch board head row concurrently with satellite reads" -m "The head read gated a 9-way Promise.all whose queries all filter on board_id alone — 2 serial round-trips where 1 suffices. The head row is now the 10th member of the batch; the null/throw contract is checked first so notFound() and the error boundary behave exactly as before." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A2: Parallelize the /home dispatcher + real Suspense fallback

**Files:**

- Modify: `src/app/home/page.tsx:26-43` (serial awaits) and `:55-63` (null fallback)
- Test: `src/app/home/page.test.tsx` (extend)

**Interfaces:**

- Consumes: `Skeleton` (`src/components/ui/skeleton.tsx` — existing primitive).
- Produces: `HomeDispatch()` — same exported name, same redirect **order** (`/onboarding` → owned board → shared board → first-run empty state), but `getUserOrgs()`, `listMyBoards()`, `listSharedBoards()` are fetched in one `Promise.all` (independent reads; 3 RTTs → 1). `Home()` renders a visible centered fallback instead of `fallback={null}`. **A3 modifies this same file — A3 must run after A2.**

- [ ] **Step 1: Write the failing test** — append to the `describe` in `src/app/home/page.test.tsx`:

```ts
it("fetches orgs, boards and shared boards in parallel (no serial gating)", async () => {
  // Even the org-less user's board reads fire — the three lists are
  // independent, so none may await another. Decision order is still checked
  // sequentially after the single batch resolves.
  getUser.mockResolvedValue({ id: "u1", email: "a@b.com", user_metadata: {} });
  getUserOrgs.mockResolvedValue([]);
  listMyBoards.mockResolvedValue([]);
  listSharedBoards.mockResolvedValue([]);

  await expect(HomeDispatch()).rejects.toThrow("REDIRECT:/onboarding");
  expect(listMyBoards).toHaveBeenCalledTimes(1);
  expect(listSharedBoards).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run — expect FAIL** (`listMyBoards` called 0 times — today it only runs after the orgs check passes): `pnpm vitest run src/app/home/page.test.tsx`

- [ ] **Step 3: Implement the parallel dispatch.** In `src/app/home/page.tsx`, replace the three serial awaits + checks:

```ts
// The three reads are independent (orgs gate onboarding; the two board lists
// gate the redirects) — batch them into one round-trip. Decision ORDER is
// unchanged: onboarding wins over any board redirect, owned over shared.
const [orgs, boards, sharedBoards] = await Promise.all([
  getUserOrgs(),
  listMyBoards(),
  listSharedBoards(),
]);

if (orgs.length === 0) redirect("/onboarding");

if (boards.length > 0) redirect(`/boards/${boards[0].id}`);

// A member who owns no boards but has one shared with them should land on it,
// not on the empty welcome screen. Mirrors the owned-board redirect above.
if (sharedBoards.length > 0) redirect(`/boards/${sharedBoards[0].id}`);
```

- [ ] **Step 4: Implement the fallback.** Add the import and replace the default export:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
```

```tsx
/** Minimal centered pulse shown while the dispatch's reads stream. /home lives
 * outside the (app) shell, so this owns the whole viewport. */
function HomeDispatchFallback() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading your workspace"
      className="flex min-h-dvh items-center justify-center"
    >
      <Skeleton className="size-8 rounded-full" />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<HomeDispatchFallback />}>
      <HomeDispatch />
    </Suspense>
  );
}
```

- [ ] **Step 5: Run — expect PASS** (the pre-existing dispatch tests are unaffected): `pnpm vitest run src/app/home/page.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/app/home/page.tsx src/app/home/page.test.tsx
git commit -m "perf(home): batch dispatcher reads and show a real loading fallback" -m "getUserOrgs then listMyBoards then listSharedBoards ran serially (3 RTTs) though independent; they now share one Promise.all with the decision order intact. The Suspense fallback was null — a blank screen for the whole dispatch — and is now a centered Skeleton pulse." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A3: Last-board cookie fast path (depends on A2)

**Files:**

- Create: `src/lib/boards/last-board.ts`
- Modify: `src/proxy.ts` (set the cookie on board visits — RSC render can't write cookies in Next 16; the proxy already owns response-cookie writes for session refresh and runs on every `/boards/*` navigation, so this costs **zero extra requests**)
- Modify: `src/app/home/page.tsx` (read + validate + redirect before the 3-list fallback)
- Test: `src/lib/boards/last-board.test.ts` (create), `src/app/home/page.test.tsx` (extend)

**Interfaces:**

- Consumes: A2's restructured `HomeDispatch` (same file); the proxy's existing `response` cookie plumbing; `createClient` (RLS-scoped) in the home page.
- Produces: `LAST_BOARD_COOKIE = "pulse_last_board"`; `boardIdFromPath(pathname): string | null` (UUID-validated extraction from `/boards/<uuid>` — a garbage cookie can never reach Postgres as a malformed `uuid` filter); the proxy sets the cookie (httpOnly, lax, path `/`, 1y — mirrors `setActiveWorkspace`) on authenticated, non-prefetch board navigations; `/home` redirects straight to the cookie board after **one** bounded RLS-scoped PK query.
- **Perf budget:** common login path (returning user with a valid last board) = **1 query** (`boards.select("id").eq("id", …).maybeSingle()` over the PK, under RLS) instead of the 3-list batch. Invalid/stale cookie → the single probe misses, ignore the cookie and fall through.

- [ ] **Step 1: Write the failing test** — `src/lib/boards/last-board.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { boardIdFromPath, LAST_BOARD_COOKIE } from "./last-board";

const B = "0b9e2a51-6f5c-4d7a-9c3e-8f1d2b4a6c0e";

describe("boardIdFromPath", () => {
  it("extracts the board id from a board path", () => {
    expect(boardIdFromPath(`/boards/${B}`)).toBe(B);
  });

  it("ignores sub-paths, non-board routes and non-uuid segments", () => {
    expect(boardIdFromPath(`/boards/${B}/settings`)).toBeNull();
    expect(boardIdFromPath("/boards")).toBeNull();
    expect(boardIdFromPath("/dashboards/" + B)).toBeNull();
    expect(boardIdFromPath("/boards/not-a-uuid")).toBeNull();
  });

  it("exports the cookie name", () => {
    expect(LAST_BOARD_COOKIE).toBe("pulse_last_board");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found): `pnpm vitest run src/lib/boards/last-board.test.ts`

- [ ] **Step 3: Implement `src/lib/boards/last-board.ts`:**

```ts
/**
 * Last-visited-board cookie. WRITTEN by the proxy (cookies can't be set during
 * RSC render in Next 16; the proxy already runs on every board navigation and
 * owns response-cookie writes) and READ by the /home dispatcher, which turns
 * the common login into ONE bounded PK probe instead of the 3-list fallback.
 * Deliberately NOT "server-only": the proxy imports it too, and it is pure.
 */
export const LAST_BOARD_COOKIE = "pulse_last_board";

const BOARD_PATH_RE =
  /^\/boards\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The boardId of an exact `/boards/<uuid>` path, else null. UUID-shape
 * validation means a tampered cookie can never reach Postgres as a malformed
 * uuid filter (22P02) — a non-matching value is simply ignored. */
export function boardIdFromPath(pathname: string): string | null {
  return BOARD_PATH_RE.exec(pathname)?.[1] ?? null;
}
```

- [ ] **Step 4: Run — expect PASS:** `pnpm vitest run src/lib/boards/last-board.test.ts`

- [ ] **Step 5: Set the cookie in the proxy.** In `src/proxy.ts`, add the import `import { boardIdFromPath, LAST_BOARD_COOKIE } from "@/lib/boards/last-board";` and insert immediately **before** the final `return response;` (after all redirect branches, so it only runs on requests that actually render):

```ts
// Remember the last board the user actually navigated to, so /home can skip
// its list reads next login. Prefetches are excluded — a hovered board link
// must not hijack the fast path. Set on the FINAL response object (the
// supabase adapter above may have rebuilt `response`).
const lastBoardId = isAuthenticated ? boardIdFromPath(pathname) : null;
const isPrefetch =
  request.headers.get("next-router-prefetch") !== null ||
  request.headers.get("purpose") === "prefetch";
if (lastBoardId && !isPrefetch) {
  response.cookies.set(LAST_BOARD_COOKIE, lastBoardId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
```

(Cookie flags mirror `src/lib/workspaces/active-actions.ts`. Assumption: `Next-Router-Prefetch` is the App Router prefetch marker; the `purpose` check is a belt-and-braces fallback. Verify `isAuthenticated`/`pathname`/`response` variable names against the current `proxy.ts` and adapt.)

- [ ] **Step 6: Write the failing home-page tests** — in `src/app/home/page.test.tsx`, add a cookie store + supabase probe mock (replace the existing `@/lib/supabase/server` mock with this richer one):

```ts
// In vi.hoisted(): add `cookieStore: new Map<string, string>()` and `boardProbe: vi.fn()`.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      cookieStore.has(n) ? { name: n, value: cookieStore.get(n)! } : undefined,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ maybeSingle: () => boardProbe() }) }),
      }),
    }),
  }),
}));
```

add `cookieStore.clear();` to `beforeEach`, then:

```ts
const LAST = "0b9e2a51-6f5c-4d7a-9c3e-8f1d2b4a6c0e";

it("redirects straight to a valid last-board cookie with one probe and no list reads", async () => {
  getUser.mockResolvedValue({ id: "u1", email: "a@b.com", user_metadata: {} });
  cookieStore.set("pulse_last_board", LAST);
  boardProbe.mockResolvedValue({ data: { id: LAST }, error: null });

  await expect(HomeDispatch()).rejects.toThrow(`REDIRECT:/boards/${LAST}`);
  expect(boardProbe).toHaveBeenCalledTimes(1);
  expect(listMyBoards).not.toHaveBeenCalled();
});

it("falls through to the list dispatch when the cookie board is gone/RLS-hidden", async () => {
  getUser.mockResolvedValue({ id: "u1", email: "a@b.com", user_metadata: {} });
  cookieStore.set("pulse_last_board", LAST);
  boardProbe.mockResolvedValue({ data: null, error: null });
  getUserOrgs.mockResolvedValue([{ id: "o1", name: "Acme" }]);
  listMyBoards.mockResolvedValue([{ id: "b1" }]);
  listSharedBoards.mockResolvedValue([]);

  await expect(HomeDispatch()).rejects.toThrow("REDIRECT:/boards/b1");
});

it("ignores a malformed cookie without querying", async () => {
  getUser.mockResolvedValue({ id: "u1", email: "a@b.com", user_metadata: {} });
  cookieStore.set("pulse_last_board", "drop table boards");
  getUserOrgs.mockResolvedValue([]);
  listMyBoards.mockResolvedValue([]);
  listSharedBoards.mockResolvedValue([]);

  await expect(HomeDispatch()).rejects.toThrow("REDIRECT:/onboarding");
  expect(boardProbe).not.toHaveBeenCalled();
});
```

- [ ] **Step 7: Run — expect FAIL** (redirect goes to the list dispatch, probe never called): `pnpm vitest run src/app/home/page.test.tsx`

- [ ] **Step 8: Implement the fast path.** In `src/app/home/page.tsx`, add imports:

```ts
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { boardIdFromPath, LAST_BOARD_COOKIE } from "@/lib/boards/last-board";
```

and insert in `HomeDispatch`, after the user/password checks and **before** A2's `Promise.all`:

```ts
// Fast path: the proxy stamps the last board the user visited. One bounded
// RLS-scoped PK probe replaces the 3-list dispatch for a returning user. A
// readable board implies org membership, so the orgs check is safely skipped
// here. Shape-validate via boardIdFromPath so a tampered cookie never reaches
// the uuid filter. Invalid/stale → ignore and fall through (the next board
// visit overwrites it in the proxy).
const jar = await cookies();
const rawLast = jar.get(LAST_BOARD_COOKIE)?.value;
const lastBoardId = rawLast ? boardIdFromPath(`/boards/${rawLast}`) : null;
if (lastBoardId) {
  const supabase = await createClient();
  const { data: lastBoard } = await supabase
    .from("boards")
    .select("id")
    .eq("id", lastBoardId)
    .is("archived_at", null)
    .maybeSingle();
  if (lastBoard) redirect(`/boards/${lastBoard.id}`);
}
```

- [ ] **Step 9: Run — expect PASS** (all home tests): `pnpm vitest run src/app/home/page.test.tsx`

- [ ] **Step 10: Commit**

```bash
git add src/lib/boards/last-board.ts src/lib/boards/last-board.test.ts src/proxy.ts src/app/home/page.tsx src/app/home/page.test.tsx
git commit -m "perf(home): last-board cookie fast path for the login dispatch" -m "The proxy stamps pulse_last_board on every real (non-prefetch) board navigation. /home validates it with a single RLS-scoped PK probe and redirects: 1 bounded query on the common login path instead of the 3-list dispatch. Stale or malformed cookies fall through unchanged." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A4: Route skeletons for /my-work and /boards

**Files:**

- Create: `src/app/(app)/my-work/loading.tsx`
- Create: `src/app/(app)/boards/loading.tsx`
- Test: `src/app/(app)/route-loading.test.tsx` (create)

**Interfaces:**

- Consumes: nothing (leaf task).
- Produces: instant `loading.tsx` fallbacks for the two routes that lacked one, matching their real rendered layout shapes so the swap-in doesn't jump. Reference: `src/app/(app)/boards/[boardId]/loading.tsx` (`role="status"`, `aria-busy`, `bg-muted`/`bg-muted/60` blocks, `animate-pulse`). Verified: neither `streaming-shell-config.test.ts` nor `app-shell-structure.test.ts` enumerates `loading.tsx` files — no existing test to update.

- [ ] **Step 1: Write the failing test** — `src/app/(app)/route-loading.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MyWorkLoading from "./my-work/loading";
import BoardsLoading from "./boards/loading";

describe("route loading skeletons", () => {
  it("my-work loading is an accessible busy region", () => {
    render(<MyWorkLoading />);
    const region = screen.getByRole("status", { name: /loading my work/i });
    expect(region).toHaveAttribute("aria-busy", "true");
  });

  it("boards loading is an accessible busy region", () => {
    render(<BoardsLoading />);
    const region = screen.getByRole("status", { name: /loading boards/i });
    expect(region).toHaveAttribute("aria-busy", "true");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (modules not found): `pnpm vitest run "src/app/(app)/route-loading.test.tsx"`

- [ ] **Step 3: Implement `src/app/(app)/my-work/loading.tsx`** (mirrors `my-work/page.tsx`: bordered header over the `max-w-3xl` grouped list — adapt the exact section/row counts to the real layout after reading `page.tsx` + `MyWorkList`):

```tsx
/** Instant loading fallback for /my-work. Mirrors the page's shape — bordered
 * header (title + subtitle) over the max-w-3xl grouped list — so streamed
 * content swaps in without layout jump. Static Server Component. */
export default function MyWorkLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading my work"
      className="flex h-full flex-col"
    >
      <div className="border-b px-6 py-3">
        <div className="bg-muted h-6 w-24 animate-pulse rounded-md" />
        <div className="bg-muted/60 mt-1.5 h-3 w-72 animate-pulse rounded-md" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <div className="flex flex-col gap-8">
            {[3, 4, 2].map((rows, section) => (
              <section key={section}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <div className="bg-muted/60 h-3 w-20 animate-pulse rounded-md" />
                  <div className="bg-muted/60 h-3 w-6 animate-pulse rounded-md" />
                </div>
                <div className="bg-surface divide-y overflow-hidden rounded-md border">
                  {Array.from({ length: rows }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="bg-muted h-4 w-2/5 animate-pulse rounded-md" />
                        <div className="bg-muted/60 mt-1 h-3 w-1/4 animate-pulse rounded-md" />
                      </div>
                      <div className="bg-muted/60 h-5 w-16 shrink-0 animate-pulse rounded-md" />
                      <div className="bg-muted/60 h-3 w-10 shrink-0 animate-pulse rounded-md" />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/app/(app)/boards/loading.tsx`** (mirrors the `/boards` index: `max-w-3xl p-6` title block over a bordered list card — the redirect fast-path rarely paints it, but the Trash index render does):

```tsx
/** Instant loading fallback for the /boards index (fallback landing + Trash).
 * Static Server Component. */
export default function BoardsLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading boards"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6"
    >
      <div>
        <div className="bg-muted h-6 w-24 animate-pulse rounded-md" />
        <div className="bg-muted/60 mt-2 h-4 w-80 animate-pulse rounded-md" />
      </div>
      <div className="bg-surface rounded-md border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={i > 0 ? "border-t px-3 py-2" : "px-3 py-2"}>
            <div className="bg-muted/60 h-5 w-1/3 animate-pulse rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run — expect PASS:** `pnpm vitest run "src/app/(app)/route-loading.test.tsx"`; also confirm the structural suites still pass: `pnpm vitest run src/app/app-shell-structure.test.ts src/app/streaming-shell-config.test.ts`

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/my-work/loading.tsx" "src/app/(app)/boards/loading.tsx" "src/app/(app)/route-loading.test.tsx"
git commit -m "perf(shell): add loading skeletons for /my-work and /boards" -m "Both routes streamed with no loading.tsx, so navigation showed a dead content pane until their queries resolved. Skeletons mirror each page's real layout using the sibling animate-pulse pattern and monochrome tokens." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A5: Parallelize the dashboard payload

**Files:**

- Modify: `src/lib/dashboards/queries.ts:20-33`
- Test: `src/lib/dashboards/queries.test.ts` (extend)

**Interfaces:**

- Consumes: nothing (leaf task).
- Produces: `getDashboardPayload(dashboardId)` — signature and `DashboardPayload | null` contract unchanged; the `dashboards` head read and the `dashboard_widgets` read (filters only on `dashboardId`) now share one `Promise.all` (2 RTTs → 1). The boards/columns follow-up in `src/app/(app)/dashboards/[dashboardId]/page.tsx` stays as-is (real dependency on `payload.dashboard.workspace_id`).

- [ ] **Step 1: Write the failing test** — append to `src/lib/dashboards/queries.test.ts` (this fn is wrapped in React `cache()` — use a distinct dashboardId per test):

```ts
it("fetches the dashboard row and its widgets concurrently", async () => {
  const issued: string[] = [];
  createClient.mockResolvedValueOnce({
    from: (table: string) => {
      issued.push(table);
      return makeChain({ id: "d2", name: "Dash" }, [
        { id: "w1", dashboard_id: "d2" },
      ]);
    },
  } as never);

  const payload = await getDashboardPayload("d2");
  expect(payload?.dashboard.id).toBe("d2");
  expect(payload?.widgets).toHaveLength(1);
  expect(issued).toEqual(["dashboards", "dashboard_widgets"]);
});

it("still returns null when the head read errors", async () => {
  createClient.mockResolvedValueOnce({
    from: (table: string) =>
      table === "dashboards"
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { message: "boom" },
                }),
              }),
            }),
          }
        : makeChain(null, []),
  } as never);
  expect(await getDashboardPayload("d3")).toBeNull();
});
```

(Adapt `makeChain` to the file's existing query-chain test helper; if none exists, model it on `queries.payload.test.ts`'s `tableMock`.)

- [ ] **Step 2: Run — expect the suite green pre-change** (the second test is the regression net; the ordering assertion in the first is what the parallel shape must satisfy): `pnpm vitest run src/lib/dashboards/queries.test.ts`

- [ ] **Step 3: Implement.** In `src/lib/dashboards/queries.ts`, replace the two serial awaits + return:

```ts
// The widgets read filters on dashboardId alone — it never needed the head
// row, so both reads share one Promise.all (1 RTT instead of 2). Null/RLS
// contract unchanged: head error or missing row → null, widgets discarded.
const [dashRes, widgetsRes] = await Promise.all([
  supabase.from("dashboards").select("*").eq("id", dashboardId).maybeSingle(),
  supabase
    .from("dashboard_widgets")
    .select("*")
    .eq("dashboard_id", dashboardId)
    .order("position", { ascending: true }),
]);
if (dashRes.error || !dashRes.data) return null;

return { dashboard: dashRes.data, widgets: widgetsRes.data ?? [] };
```

- [ ] **Step 4: Run — expect PASS:** `pnpm vitest run src/lib/dashboards/queries.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/queries.ts src/lib/dashboards/queries.test.ts
git commit -m "perf(dashboards): fetch dashboard row and widgets concurrently" -m "The widgets read filters only on dashboardId but awaited the dashboard head row first — 2 serial round-trips where 1 suffices. The follow-up boards/columns read keeps its real dependency on workspace_id and is untouched." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A6: Collapse the My Work 4-phase serial chain into one RPC

**Files:**

- Create: `supabase/migrations/20260709120000_my_work_rpc.sql`
- Modify: `src/lib/my-work/queries.ts:69-196` (`getMyWorkItems` — consumers in `src/app/(app)/my-work/` untouched; the `MyWorkItem[]` return type is preserved exactly)
- Modify: `src/types/database.types.ts` (regenerated — **never hand-edit**)
- Test: `src/lib/my-work/queries.test.ts` (create)

**Interfaces:**

- Consumes: nothing intra-batch. DB precedent: `supabase/migrations/20260707120000_search_items_ranked_rpc.sql` (the repo's SECURITY INVOKER row-returning RPC pattern: explicit `security invoker`, `stable`, `set search_path = ''`, `revoke … from public` + `grant … to authenticated, service_role`), plus the 2026-07-05 audit's dashboard-RPC RLS-hardening precedent.
- Produces: `public.get_my_work_items(p_limit int default 500)` — one RPC returning the joined (item, board, group, first-date-cell, first-status-cell, status-column-settings) rows in **1 RTT** (was 4 serial phases: people-columns → containment scan → 4-way batch → 2-way batch). SECURITY INVOKER, so every table access runs under the **caller's** RLS. Status-option resolution (Zod `optionSchema`) stays in TypeScript: the settings jsonb is returned raw so the validation boundary is preserved.
- **Migration applied to DEV via the `supabase-dev` MCP only.**

> **Judgment note:** the RPC is the higher-value fix (1 RTT, always fresh) but the more invasive. If, after reading the current 4-phase implementation, the risk feels too high for one task, the fallback is `'use cache'` + a short user-keyed `cacheLife` profile (see `next.config.ts` `widget` profile) — pick ONE and write it fully. This plan takes the RPC.

- [ ] **Step 1: Write the failing unit test** — `src/lib/my-work/queries.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

import { getMyWorkItems, MY_WORK_ITEM_LIMIT } from "./queries";

const ROW = {
  item_id: "i1",
  item_name: "Ship it",
  board_id: "b1",
  board_name: "Launch",
  group_name: "Sprint 1",
  due_date: "2026-07-10",
  status_option_id: "opt1",
  status_settings: {
    options: [{ id: "opt1", label: "Working on it", color: "#e8a33d" }],
  },
};

describe("getMyWorkItems (RPC)", () => {
  it("returns [] for a logged-out caller without calling the RPC", async () => {
    getUser.mockResolvedValue(null);
    expect(await getMyWorkItems()).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fetches everything in ONE rpc call and maps to MyWorkItem", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const items = await getMyWorkItems();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_my_work_items", {
      p_limit: MY_WORK_ITEM_LIMIT,
    });
    expect(items).toEqual([
      {
        itemId: "i1",
        itemName: "Ship it",
        boardId: "b1",
        boardName: "Launch",
        groupName: "Sprint 1",
        status: { label: "Working on it", color: "#e8a33d" },
        dueDate: "2026-07-10",
      },
    ]);
  });

  it("degrades gracefully: unknown option, missing board name, rpc error", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    rpc.mockResolvedValueOnce({
      data: [
        {
          ...ROW,
          board_name: null,
          group_name: null,
          due_date: null,
          status_option_id: "gone",
        },
      ],
      error: null,
    });
    expect(await getMyWorkItems()).toEqual([
      {
        itemId: "i1",
        itemName: "Ship it",
        boardId: "b1",
        boardName: "Unknown board",
        groupName: null,
        status: null,
        dueDate: null,
      },
    ]);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await getMyWorkItems()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`rpc` never called — the current impl issues `.from()` reads this mock doesn't provide): `pnpm vitest run src/lib/my-work/queries.test.ts`

- [ ] **Step 3: Write the migration** — `supabase/migrations/20260709120000_my_work_rpc.sql`:

```sql
-- My Work in one round-trip. Fuses getMyWorkItems' four serial phases
-- (people-columns -> jsonb containment scan -> items/boards/columns batch ->
-- date+status cells batch) into one statement, cutting 4+ sequential
-- round-trips to 1 per visit. Identity comes from auth.uid() INSIDE the
-- function -- never a parameter -- so a caller cannot read another user's
-- assignments.
--
-- SECURITY INVOKER (stated explicitly, matching search_items_ranked): every
-- table touched (columns, cell_values, items, boards, groups) is filtered by
-- the CALLER's RLS policies, so the candidate set is inherently the caller's
-- readable boards -- the function adds no privilege.
--
-- Status option resolution stays in TypeScript behind the Zod optionSchema
-- boundary; this returns the first status column's raw settings jsonb per row.
-- "First" date/status column per board = lowest position, matching the previous
-- Map-building loops. Caps mirror the TS constants.

create or replace function public.get_my_work_items(p_limit int default 500)
returns table (
  item_id uuid, item_name text, board_id uuid, board_name text,
  group_name text, due_date text, status_option_id text, status_settings jsonb
)
language sql
security invoker
stable
set search_path = ''
as $func$
  with people_cols as (
    select c.id from public.columns c where c.kind = 'people' limit 2000
  ),
  assigned as (
    select distinct cv.item_id, cv.board_id
    from public.cell_values cv
    where cv.column_id in (select pc.id from people_cols pc)
      and cv.value @> jsonb_build_object(
        'userIds', jsonb_build_array((select auth.uid())::text)
      )
    limit least(greatest(coalesce(p_limit, 500), 1), 500)
  ),
  first_date_col as (
    select distinct on (c.board_id) c.board_id, c.id
    from public.columns c
    where c.kind = 'date' and c.board_id in (select a.board_id from assigned a)
    order by c.board_id, c.position asc
  ),
  first_status_col as (
    select distinct on (c.board_id) c.board_id, c.id, c.settings
    from public.columns c
    where c.kind = 'status' and c.board_id in (select a.board_id from assigned a)
    order by c.board_id, c.position asc
  )
  select
    i.id as item_id,
    i.name as item_name,
    i.board_id,
    b.name as board_name,
    g.name as group_name,
    nullif(dcv.value ->> 'date', '') as due_date,
    nullif(scv.value ->> 'optionId', '') as status_option_id,
    fsc.settings as status_settings
  from assigned a
  join public.items i on i.id = a.item_id and i.archived_at is null
  left join public.boards b on b.id = i.board_id and b.archived_at is null
  left join public.groups g on g.id = i.group_id
  left join first_date_col fdc on fdc.board_id = i.board_id
  left join public.cell_values dcv on dcv.item_id = i.id and dcv.column_id = fdc.id
  left join first_status_col fsc on fsc.board_id = i.board_id
  left join public.cell_values scv on scv.item_id = i.id and scv.column_id = fsc.id
  order by i.id
$func$;

revoke execute on function public.get_my_work_items(int) from public;
grant execute on function public.get_my_work_items(int) to authenticated, service_role;
```

> **Verify against the real `queries.ts:69-196` before finalizing the SQL:** confirm the people-cell jsonb shape (`value @> {"userIds":[<uid>]}`), the date cell key (`value->>'date'`), the status cell key (`value->>'optionId'`), the "first column = lowest position" rule, and the archived-board "Unknown board" behavior (left join with the archived filter in the join condition). Adjust column names/kinds to match exactly — these are the load-bearing details.

- [ ] **Step 4: Apply the migration to DEV** via `mcp__supabase-dev__apply_migration` (name `my_work_rpc`), then sanity-check in a rolled-back txn via `mcp__supabase-dev__execute_sql`:

```sql
begin;
select * from public.get_my_work_items(5);
rollback;
```

Expected: 0 rows (service-role caller has no `auth.uid()` assignments), no error — proving it compiles, the jsonb shape is valid, and grants are in place.

- [ ] **Step 5: Regenerate types** (same-task rule): `pnpm db:types`. Expected: `get_my_work_items` appears under `Database.public.Functions` with `Args: { p_limit?: number }` and the 8-column `Returns` row type.

- [ ] **Step 6: Rewrite `getMyWorkItems`** in `src/lib/my-work/queries.ts` — keep `MY_WORK_ITEM_LIMIT`/`MY_WORK_COLUMN_LIMIT` and `parseOptions` exported; delete the now-unused `readDate`/`readOptionId` helpers:

```ts
/**
 * Every item assigned to the current user across every board they can read,
 * enriched with board name, group, status and due date — in ONE round-trip.
 * The four serial TypeScript phases now live in public.get_my_work_items
 * (SECURITY INVOKER — every table still RLS-filtered by the caller; see the
 * migration). Status-option resolution stays here, behind the Zod optionSchema
 * boundary, from the raw settings jsonb the RPC returns per row.
 */
export async function getMyWorkItems(): Promise<MyWorkItem[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_my_work_items", {
    p_limit: MY_WORK_ITEM_LIMIT,
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
```

(If the generated `Returns` marks `item_id`/`item_name`/`board_id` nullable — Postgres can't prove joined-column non-nullness for table functions — narrow at the boundary with a guard/`flatMap`, not `any`. Do **not** hand-edit `database.types.ts`.)

- [ ] **Step 7: Run — expect PASS** plus the untouched consumers' suites: `pnpm vitest run src/lib/my-work src/components/my-work`

- [ ] **Step 8: Verify on DEV against real data** in a rolled-back txn (impersonate an assigned user — RLS check):

```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', '<dev-user-uuid>', 'role', 'authenticated')::text, true);
set local role authenticated;
select item_id, board_name, due_date, status_option_id from public.get_my_work_items(500);
rollback;
```

Expected: only rows for boards that user can read; spot-check one against /my-work on DEV.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260709120000_my_work_rpc.sql src/lib/my-work/queries.ts src/lib/my-work/queries.test.ts src/types/database.types.ts
git commit -m "perf(my-work): collapse 4-phase serial read chain into one rpc" -m "getMyWorkItems ran 4 data-dependent serial phases (4+ RTTs, uncached, per visit). public.get_my_work_items fuses them into one SECURITY INVOKER statement — every table still RLS-filtered under the caller, identity from auth.uid() only — returning the joined rows in 1 RTT. Return type and the Zod status-option boundary are unchanged. Migration applied to DEV via supabase-dev MCP; types regenerated." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

**Batch A intra-batch dependencies:** A3 depends on A2 (both rewrite `src/app/home/page.tsx`; A3 inserts above A2's `Promise.all` and extends A2's suite). A1, A4, A5, A6 are edge-free. Wave 1: A1, A2, A4, A5, A6 (dispatch A6 first — longest). Wave 2: A3. Critical path: A2 → A3.

---

# Batch B — Board interaction smoothness

> Worktree: `task/perf-board-interaction` (`scripts/start-task.sh perf-board-interaction`). Removes typing lag and un-virtualized renders in the board views. **Hard constraint (gotcha-09):** board view/filter/search state stays client state + History API — the URL `q` param must remain shareable/restorable.

### Task B1: Decouple board quick-search typing from the full re-filter/sort

**Files:**

- Modify: `src/components/boards/BoardToolbar.tsx` (the quick-search `InputGroupInput`, ~line 182-188)
- Modify: `src/lib/boards/use-board-filter-sort.ts` (`setSearch`, ~line 60-63)
- Modify: `src/components/boards/BoardTable.tsx` (the `visibleItemsByGroup` memo and its stale comment, ~line 503-523)
- Test: `src/lib/boards/use-board-filter-sort.test.ts` (create/extend)
- Test: `src/components/boards/BoardTable.test.tsx` (extend, if a search-filter test exists)

**Interfaces:**

- Consumes: nothing (leaf; B2 lands after this in the same file).
- Produces: the search field keeps an **immediate local value** (typed text never lags); the URL/state write is **debounced ~200ms** (reuse the command-palette pattern) so the History API write and the `useSearchParams`-derived `state` rebuild happen once per pause, not per keystroke; the filter memo additionally consumes the search term via **`useDeferredValue`** so even the post-debounce scan yields to input paint. The `q` param stays shareable and clear-on-`X` stays instant.

**Runtime problem (verified):** `BoardToolbar.tsx` binds `value={state.q}` + `onChange={(e) => setSearch(e.target.value)}`; `setSearch` (`use-board-filter-sort.ts:60`) calls `write({ ...state, q }, { replace: true })` → `history.replaceState` on **every keystroke**. That changes `useSearchParams()`, rebuilds `state` (the `[raw]` memo), rebuilds `predicate`/`comparator`, and reruns the `visibleItemsByGroup` memo (`BoardTable.tsx:513`) — a full `filter()` + `[...].sort()` over every top-level item, synchronously, per keystroke. The comment at `BoardTable.tsx:502` ("Memoized so 5k rows aren't re-scanned … per keystroke") is **false**: the memo key includes `filter.state`, which changes each keystroke.

- [ ] **Step 1: Write the failing test** — `src/lib/boards/use-board-filter-sort.test.ts` (create if absent), asserting the URL write is debounced under fake timers:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardFilterSort } from "./use-board-filter-sort";

// useSearchParams reads window.location in the hook's `write`; jsdom provides it.
describe("useBoardFilterSort search debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes the q param only once after typing settles", () => {
    const spy = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useBoardFilterSort());

    act(() => {
      result.current.setSearch("r");
      result.current.setSearch("re");
      result.current.setSearch("rep");
    });
    expect(spy).not.toHaveBeenCalled(); // debounced — nothing written yet

    act(() => vi.advanceTimersByTime(250));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][2])).toContain("q=rep");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`replaceState` called 3× immediately): `pnpm vitest run src/lib/boards/use-board-filter-sort.test.ts`

- [ ] **Step 3: Debounce the write in the hook.** In `src/lib/boards/use-board-filter-sort.ts`, add a ref-held timer and split the search write so only the URL is debounced (discrete toggles stay immediate). Replace the `setSearch` callback:

```ts
// Quick-search typing must not write the URL (and rebuild the searchParams-
// derived state → re-scan every row) on every keystroke. Debounce the write
// ~200ms; the toolbar holds the immediate text locally so the field never
// lags. Discrete toggles (people/status/sort) stay immediate below.
const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const setSearch = useCallback(
  (q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    // Clearing (empty q, e.g. the X button) applies immediately.
    if (q === "") {
      write({ ...stateRef.current, q: "" }, { replace: true });
      return;
    }
    searchTimer.current = setTimeout(() => {
      write({ ...stateRef.current, q }, { replace: true });
    }, 200);
  },
  [write],
);
```

Because the debounced closure runs later, read `state` from a ref so it isn't stale — add near the top of the hook:

```ts
import { useCallback, useEffect, useMemo, useRef } from "react";
```

```ts
// Latest state for the debounced search write (avoids a stale closure without
// re-creating the timer on every state change).
const stateRef = useRef(state);
stateRef.current = state;
useEffect(
  () => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  },
  [],
);
```

- [ ] **Step 4: Hold the immediate value in the toolbar.** In `src/components/boards/BoardToolbar.tsx`, keep a local input value seeded from `state.q` and re-synced when the URL changes externally (clear button, shared link), so the field reflects keystrokes instantly while the store write trails:

```tsx
// Immediate local mirror of the search box; the store write is debounced in
// useBoardFilterSort, so bind the field to local state and re-sync when the
// URL-derived value changes from elsewhere (X button, restored link).
const [searchDraft, setSearchDraft] = useState(state.q);
useEffect(() => setSearchDraft(state.q), [state.q]);
```

and change the input:

```tsx
<InputGroupInput
  aria-label="Search items"
  placeholder="Search…"
  value={searchDraft}
  onChange={(e) => {
    setSearchDraft(e.target.value);
    setSearch(e.target.value);
  }}
/>
```

The `X` button's `onClick={() => setSearch("")}` also sets the draft: `onClick={() => { setSearchDraft(""); setSearch(""); }}`.

- [ ] **Step 5: Defer the scan in BoardTable + fix the false comment.** In `src/components/boards/BoardTable.tsx`, deconstruct the search term through `useDeferredValue` so the filter memo trails input under load, and correct the comment. Replace the memo block header:

```tsx
const filter = useBoardFilterSort();
// Defer the *search* term so a fast typist never blocks on the row scan; the
// heavy filter memo recomputes against the trailing value while the input
// stays responsive. Non-search filter changes (discrete) are not deferred.
const deferredQ = useDeferredValue(filter.state.q);
const effectiveFilterState = useMemo(
  () => ({ ...filter.state, q: deferredQ }),
  [filter.state, deferredQ],
);
const predicate = useMemo(
  () => buildItemPredicate(effectiveFilterState, { columns, cellMap }),
  [effectiveFilterState, columns, cellMap],
);
const comparator = useMemo(
  () => buildItemComparator(effectiveFilterState, { columns, cellMap }),
  [effectiveFilterState, columns, cellMap],
);
```

Add `useDeferredValue` to the React import. Update the stale comment above `filter` (was "Memoized so 5k rows aren't re-scanned … per keystroke") to state the truth: the scan is now debounced upstream (one write per pause) and deferred here (yields to paint), so typing stays smooth even on large boards.

- [ ] **Step 6: Run — expect PASS** (debounce test + existing filter/sort tests): `pnpm vitest run src/lib/boards/use-board-filter-sort.test.ts src/components/boards/BoardTable.test.tsx`

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/use-board-filter-sort.ts src/lib/boards/use-board-filter-sort.test.ts src/components/boards/BoardToolbar.tsx src/components/boards/BoardTable.tsx
git commit -m "perf(boards): debounce + defer quick-search so typing never blocks the row scan" -m "Every keystroke wrote the URL, rebuilt the searchParams-derived filter state, and re-ran a full filter+sort over all rows synchronously. The field now holds an immediate local value; the URL write is debounced ~200ms; and the filter memo consumes the term via useDeferredValue so the scan yields to input paint. The q param stays shareable." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task B2: Hoist the dependents-count map + memoize row/cell components (lands after B1)

**Files:**

- Modify: `src/components/boards/BoardTable.tsx` (`BoardTableInner` ~373 to build the map once + thread via `controls`; `ItemRow` ~1903; `EditableCell` ~2375; `NameCell` ~2563; `SubitemBlock` ~2246; the per-row `dependentsByItem` memo ~1945)
- Modify: `src/components/boards/KanbanBoard.tsx` (`KanbanCard` ~492)
- Test: `src/components/boards/BoardTable.test.tsx` (extend — a render-count assertion)

**Interfaces:**

- Consumes: B1's `BoardTable.tsx` edits (same file — land B2 after B1 to avoid a rebase).
- Produces: `buildDependentsCountMap(cache.dependencies)` computed **once** in `BoardTableInner` and threaded through the existing `controls: CellControls` object (mirroring how `cellMap` is threaded), instead of recomputed inside every visible `ItemRow`; `ItemRow`/`EditableCell`/`NameCell`/`SubitemBlock`/`KanbanCard` wrapped in `React.memo` so a single-cell optimistic write re-renders only the changed cell, not the whole visible viewport.

**Runtime problem (verified):** `ItemRow` (`BoardTable.tsx:1945`) does `useMemo(() => buildDependentsCountMap(controls.cache.dependencies), [controls.cache.dependencies])` — an O(edges) pass over the board's entire dependency set, per visible row (~20-30×). And the row/cell components are plain functions, so any optimistic cell write re-renders `BoardTableInner` → every mounted `ItemRow` and all its `EditableCell`s.

- [ ] **Step 1: Write the failing test** — in `src/components/boards/BoardTable.test.tsx`, add a render-count probe. Wrap a spy around a cell's render (or use a `renderSpy` module-level counter incremented in a test-only `data-render` effect) and assert that editing one cell does not re-render an unrelated row's cells. If the harness can't easily count child renders, assert the observable proxy instead: after B2, `buildDependentsCountMap` (spy via `vi.spyOn` on the priority module) is called **once per board render**, not once per visible row:

```tsx
import * as priority from "@/lib/boards/priority";

it("computes the dependents-count map once per board render, not per row", () => {
  const spy = vi.spyOn(priority, "buildDependentsCountMap");
  renderBoardTableWithRows(30); // existing/added test helper: 30 top-level rows
  // One call in BoardTableInner — not one per visible ItemRow.
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
```

- [ ] **Step 2: Run — expect FAIL** (called once per visible row): `pnpm vitest run src/components/boards/BoardTable.test.tsx`

- [ ] **Step 3: Hoist the map into `BoardTableInner`.** Near where `cellMap` is derived, add:

```tsx
// Direct-dependent counts for priority cells: one O(edges) pass for the whole
// board, threaded down via `controls` (same pattern as cellMap) instead of
// recomputed inside every visible ItemRow.
const dependentsByItem = useMemo(
  () => buildDependentsCountMap(cache.dependencies),
  [cache.dependencies],
);
```

Add `dependentsByItem` to the `CellControls` type and to the `controls` object literal (line ~635). Import `buildDependentsCountMap` at the top of `BoardTable.tsx` (it already imports from `@/lib/boards/priority` in `ItemRow`; move/keep the import at module scope).

- [ ] **Step 4: Consume it in `ItemRow`.** Delete the per-row `dependentsByItem` `useMemo` (~1945-1948) and read `controls.dependentsByItem` where the count is used (`dependentsByItem.get(item.id) ?? 0`). Confirm no other `ItemRow` code depends on the local const.

- [ ] **Step 5: Memoize the leaf components.** Wrap `ItemRow`, `EditableCell`, `NameCell`, `SubitemBlock` (BoardTable) and `KanbanCard` (KanbanBoard) in `React.memo`. Example:

```tsx
const EditableCell = memo(function EditableCell(
  {
    /* same props */
  },
) {
  /* unchanged body */
});
```

Add `memo` to the React import in both files. Verify prop stability: `controls`, `columns`, `cellMap`, `template` must be referentially stable across a sibling-cell edit — `controls` is already built once in `BoardTableInner` (`memo` will only help if it isn't rebuilt each render; if it is, wrap the `controls` object in `useMemo` keyed on its real deps, and wrap any inline callbacks passed to rows/cells in `useCallback`). Where a cell receives an inline `onChange`/`onOpen` closure, hoist it to a stable `useCallback` keyed on the item/column id so `memo` can actually skip.

- [ ] **Step 6: Run — expect PASS** (render-count test + full board suite): `pnpm vitest run src/components/boards/BoardTable.test.tsx src/components/boards/KanbanBoard.test.tsx`

- [ ] **Step 7: Verify the interaction** (optional but recommended): with `/run` or a React DevTools profiler on a real board, confirm editing one cell highlights only that cell's render, not the whole column.

- [ ] **Step 8: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx src/components/boards/KanbanBoard.tsx
git commit -m "perf(boards): hoist dependents-count map and memoize row/cell components" -m "buildDependentsCountMap ran once per visible ItemRow (O(rows x edges) per interaction); it now runs once per board render, threaded via controls like cellMap. ItemRow/EditableCell/NameCell/SubitemBlock/KanbanCard are memoized so a single optimistic cell write re-renders only the changed cell instead of the whole visible viewport." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task B3: Virtualize the Gantt timeline rows

**Files:**

- Modify: `src/components/boards/GanttBoard.tsx` (the `scheduledRows.map` at ~641 inside the `overflow-auto` scroll container at ~605; the arrow overlay `allRows`/`dependencies` props)
- Test: `src/components/boards/GanttBoard.test.tsx` (extend)

**Interfaces:**

- Consumes: nothing (leaf).
- Produces: the scheduled-row list windowed with `@tanstack/react-virtual` keyed to the existing `overflow-auto` container, and the SVG dependency-arrow overlay clamped to arrows whose endpoints are within the rendered window. Row geometry is unchanged (`ROW_H` per row, absolute-positioned bars), so this is a rendering-count change only.

> **Complexity note (honest):** the Gantt is absolute-positioned with an SVG arrow layer that references `allRows={scheduledRows}` and `dependencies` across the whole set (`GanttBoard.tsx:659-660`), and `rowIndexMap`/critical-path math indexes into `scheduledRows`. Full virtualization is the most invasive task in this plan. **Split into B3a (row windowing) and B3b (arrow clamp)** and land them in order; if B3b proves to need whole-set indices for correctness, ship B3a alone (the row-node count is the dominant cost) and leave a `// PERF:` note that arrow clamping is deferred, rather than shipping incorrect arrows.

- [ ] **Step 1 (B3a): Write the failing test** — assert only a window of `GanttRowItem`s mount for a large board. Add a test that renders the Gantt with, say, 200 scheduled rows in a fixed-height container and asserts the mounted row count is bounded (e.g. `< 60`), mirroring the BoardTable virtualization test's approach (jsdom returns 0 heights → the virtualizer's `measureElement` fallback to `ROW_H` must be set, as in `BoardTable.tsx:1704`):

```tsx
it("mounts only a window of scheduled rows on a large board", () => {
  renderGanttWithScheduledRows(200); // test helper
  const rows = screen.getAllByTestId("gantt-row");
  expect(rows.length).toBeLessThan(60);
});
```

(Add `data-testid="gantt-row"` to `GanttRowItem`'s root if not present.)

- [ ] **Step 2: Run — expect FAIL** (all 200 mount): `pnpm vitest run src/components/boards/GanttBoard.test.tsx`

- [ ] **Step 3 (B3a): Window the rows.** Introduce a `useVirtualizer` over `scheduledRows.length` keyed to the scroll container ref (the `overflow-auto` div at ~605 — add a ref if it lacks one), copying the config from `BoardTable.tsx:1697-1705` (`estimateSize: () => ROW_H`, `overscan: 6`, `measureElement` with the `|| ROW_H` jsdom fallback). Replace `scheduledRows.map((row, rowIdx) => …)` with a map over `virtualizer.getVirtualItems()`, positioning each `GanttRowItem` by `virtualRow.start` (absolute `top`) and keeping `rowIdx={virtualRow.index}` so the existing per-row math is unchanged. The spacer height stays `scheduledRows.length * ROW_H` (already present at ~684).

- [ ] **Step 4 (B3b): Clamp the arrow overlay.** The arrow layer draws dependency arrows between `scheduledRows` endpoints. Compute the visible index range from the virtualizer (`[first, last]` of `getVirtualItems()`), and render only arrows where **either** endpoint's `rowIndexMap` index falls in `[first - overscan, last + overscan]`. Pass the clamped arrow list (or the visible range) into the overlay instead of the full `dependencies`. Keep the endpoint→coordinate math against the full `scheduledRows` (positions are absolute and correct regardless of what's mounted).

- [ ] **Step 5: Run — expect PASS:** `pnpm vitest run src/components/boards/GanttBoard.test.tsx`

- [ ] **Step 6: Verify** with `/run` on a board with many scheduled items — scroll/zoom should stay smooth and arrows should track correctly at the window edges.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/GanttBoard.tsx src/components/boards/GanttBoard.test.tsx
git commit -m "perf(gantt): virtualize timeline rows and clamp the arrow overlay to the window" -m "GanttBoard rendered every scheduled row plus a whole-board SVG dependency-arrow overlay up front — slow first paint and janky scroll on large timelines. Rows are now windowed with react-virtual (same config as the Table view) and arrows are clamped to endpoints within the rendered window; absolute row geometry is unchanged." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task B4: Clamp the Calendar agenda density

**Files:**

- Modify: `src/components/boards/calendar/CalendarAgenda.tsx` (the `group.items.map` at ~91)
- Test: `src/components/boards/calendar/CalendarAgenda.test.tsx` (extend)

**Interfaces:**

- Consumes: nothing (leaf).
- Produces: a per-day render clamp (default 8 items) with a client-state "+N more" expander — reusing the **existing** "+N more" pattern already shipped in `CalendarMonth.tsx` (line 165/249, verified working via `CalendarMonth.test.tsx`). Pulse monochrome tokens for the expander trigger.

> **Scan correction:** there is no `CalendarBoard.tsx`; the calendar views are `CalendarMonth` (already lane-capped with "+N more"), `CalendarWeek`, and `CalendarAgenda`. Only **Agenda** renders every dated item unbounded (`groups.map` → `group.items.map` with no cap). This task targets Agenda only; model the expander on `CalendarMonth`'s.

- [ ] **Step 1: Write the failing test** — in `CalendarAgenda.test.tsx`, render a day-group with, say, 12 items and assert at most 8 render with a "+4 more" trigger, and that clicking it reveals the rest:

```tsx
it("clamps a dense day to 8 items behind a +N more expander", async () => {
  renderAgendaWithDay({ items: 12 }); // test helper
  expect(screen.getAllByTestId("agenda-item")).toHaveLength(8);
  const more = screen.getByRole("button", { name: /\+4 more/i });
  await userEvent.click(more);
  expect(screen.getAllByTestId("agenda-item")).toHaveLength(12);
});
```

- [ ] **Step 2: Run — expect FAIL** (all 12 render, no trigger): `pnpm vitest run src/components/boards/calendar/CalendarAgenda.test.tsx`

- [ ] **Step 3: Implement the clamp.** Extract the per-day `<ul>` body into a small client component holding an `expanded` boolean; render `group.items.slice(0, expanded ? undefined : DAY_CAP)` (with `const DAY_CAP = 8`), and when `group.items.length > DAY_CAP && !expanded`, render a "+{group.items.length - DAY_CAP} more" button styled with the same tokens as `CalendarMonth`'s trigger (`text-muted-foreground text-xs`, `hover:bg-accent`, `rounded-md px-2 py-0.5`). Add `data-testid="agenda-item"` to the item `<li>`. The clamp is pure client state (no refetch — gotcha-09 safe).

- [ ] **Step 4: Run — expect PASS:** `pnpm vitest run src/components/boards/calendar/CalendarAgenda.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/calendar/CalendarAgenda.tsx src/components/boards/calendar/CalendarAgenda.test.tsx
git commit -m "perf(calendar): clamp dense agenda days behind a +N more expander" -m "The agenda view rendered every dated item for every day; a busy month painted every event node. Days now cap at 8 with a client-state +N more expander, matching the lane cap already shipped in CalendarMonth." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

**Batch B intra-batch dependencies:** B2 lands after B1 (both edit `BoardTable.tsx`; B1 restructures the filter memo B2 memoizes around). B3 and B4 are edge-free (disjoint files). Wave 1: B1, B3, B4. Wave 2: B2. Critical path: B1 → B2.

---

# Batch C — Bundle & payload

> Worktree: `task/perf-bundle` (`scripts/start-task.sh perf-bundle`). Trims the always-loaded JS bundle and makes bundle analysis actually work. C1–C5 are mutually independent — one wave.

### Task C1: Split @dnd-kit out of the always-loaded sidebar

**Files:**

- Modify: `src/components/boards/BoardsNav.tsx` (extract the DnD wrapper)
- Create: `src/components/boards/BoardsNavSortable.tsx` (holds all @dnd-kit imports + `SortableBoardRow`)
- Test: `src/components/sidebar.test.tsx` or the colocated BoardsNav test (find and extend)

**Interfaces:**

- Consumes: nothing (leaf).
- Produces: `BoardsNav` renders a **plain, navigable** board list by default (no @dnd-kit in the initial chunk); the sortable variant (`DndContext` + `SortableContext` + `SortableBoardRow`, all @dnd-kit imports) lives in `BoardsNavSortable` and is mounted via `next/dynamic(() => import('./BoardsNavSortable'), { ssr: false })`, activated so the **first** drag still works.

**Runtime problem (verified):** `BoardsNav.tsx` statically imports `@dnd-kit/core`, `/sortable`, `/modifiers`, `/utilities` (lines 6-16). It renders inside `sidebar-nav.tsx` on every authenticated route, but the DnD stack (~30-40KB gz) is only exercised when reordering boards in the expanded sidebar. Note: the DnD path is only the **expanded, non-collapsed** owned-boards branch (`collapsed` renders plain `<Link>`s already).

- [ ] **Step 1: Write the failing test** — assert `BoardsNav` renders its board links without mounting the DnD context synchronously (the dynamic import resolves lazily). A pragmatic assertion: the plain list renders board links immediately on first paint (before the dynamic chunk resolves), so a shallow render finds the board `<Link>`s and no `DndContext`-specific test id yet:

```tsx
it("renders board links without a synchronous dnd context", () => {
  render(<BoardsNav boards={twoBoards} sharedBoards={[]} />);
  expect(screen.getByRole("link", { name: /board one/i })).toBeInTheDocument();
  // The sortable wrapper is dynamically imported (ssr:false) — not present on
  // the first synchronous render.
  expect(screen.queryByTestId("boards-nav-sortable")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run — expect FAIL** (today the DndContext mounts synchronously): `pnpm vitest run src/components/sidebar.test.tsx`

- [ ] **Step 3: Extract `BoardsNavSortable.tsx`.** Move `SortableBoardRow`, the `DndContext`/`SortableContext` wrapper, `handleDragEnd`, `useTouchAwareSensors`, the optimistic `ordered`/`syncedBoards` state, and **all** `@dnd-kit/*` + `reorderBoard`/`reorderPosition`/`toast` imports into a new `"use client"` `src/components/boards/BoardsNavSortable.tsx` exporting `BoardsNavSortable({ boards, activeBoardId })`. Add `data-testid="boards-nav-sortable"` to its root.

- [ ] **Step 4: Reduce `BoardsNav` to the plain list + lazy mount.** In `BoardsNav.tsx`, remove the @dnd-kit imports. Render a plain non-draggable list of board rows (reuse the existing row markup minus the grip handle/sortable hooks — the name `<Link>` + share marker + `BoardItemMenu`). Mount the sortable version lazily, activating on first pointer interaction so the initial drag isn't lost:

```tsx
import dynamic from "next/dynamic";

const BoardsNavSortable = dynamic(
  () => import("./BoardsNavSortable").then((m) => m.BoardsNavSortable),
  { ssr: false },
);
```

```tsx
// Keep @dnd-kit out of the shared shell bundle: render a plain, fully
// navigable list, and swap in the drag-enabled variant on first pointer
// interaction over the list (so the first reorder still works — the handoff
// mounts before dragstart because a grab begins with pointerdown, and dnd-kit
// needs its 6px activation distance / 200ms touch long-press first anyway).
const [dndReady, setDndReady] = useState(false);
```

In the expanded owned-boards branch, wrap the list in a container with `onPointerDown={() => setDndReady(true)}` that renders `<BoardsNavSortable boards={boards} activeBoardId={activeBoardId} />` when `dndReady`, else the plain list. (If preserving the very first drag proves flaky with interaction-triggered mount, fall back to mounting after idle: `useEffect(() => { const id = requestIdleCallback(() => setDndReady(true)); return () => cancelIdleCallback(id); }, [])` — still off the critical bundle. Pick whichever the test can prove.)

- [ ] **Step 5: Run — expect PASS** (plain links render; sortable is lazy): `pnpm vitest run src/components/sidebar.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/BoardsNav.tsx src/components/boards/BoardsNavSortable.tsx src/components/sidebar.test.tsx
git commit -m "perf(shell): lazy-load @dnd-kit board reordering out of the sidebar bundle" -m "BoardsNav statically imported the full @dnd-kit stack (~30-40KB gz) into the shell that mounts on every authenticated page, though drag only reorders sidebar boards. The plain list renders by default; the sortable variant is a next/dynamic(ssr:false) chunk mounted on first pointer interaction." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task C2: Lazy-load DashboardCanvas (react-grid-layout)

**Files:**

- Create: `src/components/dashboards/DashboardCanvasLazy.tsx` (client wrapper — `ssr:false` needs a client boundary)
- Modify: `src/app/(app)/dashboards/[dashboardId]/page.tsx` (import the lazy wrapper instead of `DashboardCanvas`)
- Test: existing dashboard page/canvas test (extend if one asserts eager import; else a light render test on the wrapper)

**Interfaces:**

- Consumes: nothing (leaf).
- Produces: `DashboardCanvas` (and its static `react-grid-layout` import at `DashboardCanvas.tsx:4-10`) loaded via `next/dynamic` with `DashboardWidgetSkeleton`-based loading, so react-grid-layout leaves the dashboards route's first-load JS. Canvas internals (gotcha-14: react-grid-layout v2 API) are **untouched** — only the loading boundary changes.

**Next 16 note:** `page.tsx` is a Server Component; `next/dynamic` with `ssr:false` is only allowed in a Client Component, so the dynamic call goes in a small `"use client"` wrapper. Confirm against `node_modules/next/dist/docs` (`next-dynamic` / lazy-loading) before finalizing.

- [ ] **Step 1: Write the failing/guard test** — a render test on the wrapper asserting it shows the skeleton before the chunk resolves and passes props through. (If the harness can't resolve dynamic imports in jsdom, assert the wrapper renders a `widget-skeleton` fallback synchronously.)

```tsx
it("shows the canvas skeleton while the grid chunk loads", () => {
  render(<DashboardCanvasLazy initialData={payload} boards={[]} />);
  expect(screen.getAllByTestId("widget-skeleton").length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run — expect FAIL** (module not created): `pnpm vitest run src/components/dashboards/DashboardCanvasLazy.test.tsx`

- [ ] **Step 3: Create `DashboardCanvasLazy.tsx`:**

```tsx
"use client";

import dynamic from "next/dynamic";
import { DashboardCanvasSkeleton } from "@/components/dashboards/DashboardCanvasSkeleton";
import type { ComponentProps } from "react";
import type { DashboardCanvas as DashboardCanvasType } from "@/components/dashboards/DashboardCanvas";

/** Client boundary so react-grid-layout (DashboardCanvas' only heavy dep) is
 * a lazy chunk instead of first-load JS on the dashboards route. ssr:false is
 * required here — the grid measures the DOM — and is only legal in a client
 * component, hence this wrapper. */
const DashboardCanvas = dynamic(
  () =>
    import("@/components/dashboards/DashboardCanvas").then(
      (m) => m.DashboardCanvas,
    ),
  { ssr: false, loading: () => <DashboardCanvasSkeleton /> },
);

export function DashboardCanvasLazy(
  props: ComponentProps<typeof DashboardCanvasType>,
) {
  return <DashboardCanvas {...props} />;
}
```

(Confirm `DashboardCanvasSkeleton` exports a default full-canvas skeleton element; the file also exports `DashboardWidgetSkeleton`. Use whichever renders the whole canvas — it is already wired into both `loading.tsx` files, so reuse that same top-level export.)

- [ ] **Step 4: Swap the page import.** In `src/app/(app)/dashboards/[dashboardId]/page.tsx`, replace `import { DashboardCanvas } from "@/components/dashboards/DashboardCanvas";` with `import { DashboardCanvasLazy } from "@/components/dashboards/DashboardCanvasLazy";` and render `<DashboardCanvasLazy initialData={payload} boards={boards} />`.

- [ ] **Step 5: Run — expect PASS**, then confirm the route builds and the canvas still works: `pnpm vitest run src/components/dashboards && pnpm build`

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboards/DashboardCanvasLazy.tsx src/components/dashboards/DashboardCanvasLazy.test.tsx "src/app/(app)/dashboards/[dashboardId]/page.tsx"
git commit -m "perf(dashboards): lazy-load the react-grid-layout canvas" -m "DashboardCanvas statically imported react-grid-layout into the dashboards route's first-load JS while widgets were already lazy. It now loads via next/dynamic behind the existing canvas skeleton through a client wrapper (ssr:false). Canvas internals untouched (gotcha-14 v2 API)." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task C3: Make bundle analysis work under Turbopack + broaden optimizePackageImports

**Files:**

- Modify: `next.config.ts` (fix the comment; extend `optimizePackageImports`)
- Modify: `package.json` (add a `build:analyze` script)

**Interfaces:**

- Consumes: nothing (leaf).
- Produces: a working bundle-analysis command for the default (Turbopack) build path, so regressions like C1/C2 stay visible; `optimizePackageImports` extended with `framer-motion` (and any of `cmdk`/`react-day-picker` the Next 16 docs list as beneficial — verify, don't guess).

- [ ] **Step 1: Verify the real analyzer path.** Read `node_modules/next/dist/docs` for Turbopack bundle analysis in 16.2.9 — either `next build --webpack` (runs the existing `@next/bundle-analyzer`) or `next experimental-analyze` (Turbopack-native). Pick the one that actually exists in this version; the config comment already references both.

- [ ] **Step 2: Add the script.** In `package.json` scripts, add (using whichever the docs confirm — example assumes the webpack analyzer path, which the wired `withBundleAnalyzer` supports):

```json
    "build:analyze": "ANALYZE=true next build --webpack",
```

- [ ] **Step 3: Fix the config comment + extend the allowlist.** In `next.config.ts`, update the `withBundleAnalyzer` comment so it states the exact working command (`pnpm build:analyze`), and extend `optimizePackageImports`:

```ts
    // Barrel-optimize single-package deps whose named imports would otherwise
    // drag their whole barrel into a chunk. radix-ui (shadcn primitives) +
    // framer-motion (landing). lucide-react / recharts are default-optimized.
    optimizePackageImports: ["radix-ui", "framer-motion"],
```

- [ ] **Step 4: Verify the analyze command runs and emits a report** (or at least doesn't error): `pnpm build:analyze` (expect the analyzer report to open/emit, not the Turbopack "no report" warning). Then a normal build stays green: `pnpm build`.

- [ ] **Step 5: Commit**

```bash
git add next.config.ts package.json
git commit -m "build: add a working bundle-analyze script and broaden optimizePackageImports" -m "@next/bundle-analyzer is webpack-only and emitted nothing under the default Turbopack build. Added a build:analyze script on the path that actually produces a report, corrected the config comment, and barrel-optimized framer-motion." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task C4: Defensive bounds on the sidebar board lists

**Files:**

- Modify: `src/lib/boards/queries.ts` (`listMyBoards` ~50-67, `listSharedBoards` ~71-90)
- Test: `src/lib/boards/queries.test.ts` (extend, if it covers these)

**Interfaces:**

- Consumes: nothing (leaf).
- Produces: explicit `.limit()` caps on the two uncapped hot-path reads (they run on the shell/home dispatch on nearly every navigation), consistent with the repo's other bounded reads (match the cap style used for org members/portfolios — e.g. 500 — and add a one-line comment). Per-user board counts are naturally bounded, so this is defensive, not a behavior change at current scale.

- [ ] **Step 1: Add the caps.** In `listMyBoards`, before `.order(...)` add `.limit(MY_BOARDS_LIMIT)`; same for the `board_members` read in `listSharedBoards`. Define the constant near the top of the file mirroring the existing cap constants' style:

```ts
// Defensive cap on the sidebar board lists (hot path — runs on ~every nav).
// Per-user board counts are naturally small; this bounds a pathological org.
const MY_BOARDS_LIMIT = 500;
```

- [ ] **Step 2: Run the existing suite green:** `pnpm vitest run src/lib/boards/queries.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/boards/queries.ts
git commit -m "perf(boards): bound the sidebar board-list reads defensively" -m "listMyBoards and listSharedBoards run on the shell/home dispatch on nearly every navigation but had no .limit(). Added a 500-row cap matching the repo's other hot-path bounds." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task C5: Landing page trims (small)

**Files:**

- Modify: `src/components/landing/light-rays.tsx` (~line 290, the resize handler)
- (Investigate) `src/components/landing/monolith-scene.tsx`, `magnetic-button.tsx` (framer-motion boundary)

**Interfaces:**

- Consumes: nothing (leaf; landing route only, off the authenticated hot path).
- Produces: the WebGL resize handler rAF-coalesced instead of running `place()` synchronously per resize event; a decision (with evidence) on whether the framer-motion import can be cleanly lazy-bounded or is load-bearing for above-the-fold LCP animation.

- [ ] **Step 1: rAF-coalesce the resize.** In `light-rays.tsx`, replace the direct `window.addEventListener("resize", place)` with a coalesced handler, preserving the existing cleanup (both the reduced-motion early-return path and the main path remove the listener):

```ts
let resizeRaf = 0;
const onResize = () => {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    place();
  });
};
place();
window.addEventListener("resize", onResize);
```

and in **both** cleanup returns, replace `window.removeEventListener("resize", place)` with:

```ts
window.removeEventListener("resize", onResize);
if (resizeRaf) cancelAnimationFrame(resizeRaf);
```

- [ ] **Step 2: Assess framer-motion.** Read `monolith-scene.tsx` / `magnetic-button.tsx`. framer-motion (~40KB gz) loads on the public landing page. Note (from the bundle scan): `monolith-scene.tsx` already `next/dynamic`s the ogl-based `LightRays` (`ssr:false`), so ogl is not in the initial bundle. If the `motion` wrappers drive above-the-fold hero animation, **leave them eager** and state so in a one-line `// PERF:` comment (C3 already barrel-optimizes framer-motion). If they animate only below-the-fold/on-interaction content, lazy-mount that subtree. Decide from the code; do not force a lazy boundary that hurts LCP.

- [ ] **Step 3: Verify** the landing page still renders and animates: `pnpm build` and a quick `/run` of the landing route.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/light-rays.tsx
git commit -m "perf(landing): rAF-coalesce the WebGL resize handler" -m "place() resized the GL renderer and recomputed uniforms synchronously on every resize event; window drags thrashed it. The handler now coalesces to one rAF per frame, with cleanup on both the reduced-motion and animated paths." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

**Batch C intra-batch dependencies:** none — C1–C5 touch disjoint files (BoardsNav; DashboardCanvas wrapper + dashboards page; next.config + package.json; boards/queries.ts `list*`; landing). All run as one wave. (C4 and A1 both touch `src/lib/boards/queries.ts` but in different functions — sequence Batch A before Batch C at merge, or accept a trivial rebase.)

---

# Batch D — Interaction polish

> Worktree: `task/perf-polish` (`scripts/start-task.sh perf-polish`). Removes redundant page refreshes and blank-content windows. Mutations stay Server Actions. D1–D5 are mutually independent (disjoint file sets) — one wave.
>
> **Verified context** (line numbers checked against `develop` as of 2026-07-09): `GoalDetailDrawer.tsx` calls `router.refresh()` at lines 94, 114, 190, 450; `TimeCard.tsx` at 116 and 128 (week nav `router.push` at 72); `authenticated-shell.tsx:61-63` wraps children in `<Suspense fallback={null}><TimeZoneBoundary>`; `(app)/layout.tsx:13-22` docblock claims `{ prefetch: 'static' }` which exists nowhere. `@supabase/storage-js@2.108.1`: `createSignedUrl(path, expiresIn, { transform })` supports `{ width, height, resize }`; **`createSignedUrls` (plural) does NOT accept `transform`** — thumbnails must be signed per-file. Every goals/time server action already calls `revalidatePath` for its route, so the drawer/card `router.refresh()` calls were a _second_ full refetch.

### Task D1: Goal drawer — drop per-field `router.refresh()`, reconcile locally

**Files:**

- Modify: `src/lib/goals/actions.ts` (`updateGoal` returns the patched row, drops its `revalidatePath`)
- Create: `src/lib/goals/patch.ts` + `src/lib/goals/patch.test.ts`
- Create: `src/components/goals/GoalsView.tsx`
- Modify: `src/app/(app)/goals/page.tsx`
- Modify: `src/components/goals/GoalDetailDrawer.tsx` + `src/components/goals/GoalDetailDrawer.test.tsx`

**Interfaces:**

- Consumes: `leafProgress`, `computeGoalHealth`, `serverToday` from `src/lib/goals/progress.ts`; `Tables<"goals">`.
- Produces: `updateGoal(): Promise<ActionResult<{ goal: Tables<"goals"> }>>` (no longer revalidates `/goals`); `applyGoalPatch(tree, row, owners?, today?)`; `GoalsView({ tree, members, boards, links })` — client owner of goals state; `GoalDetailDrawer` gains `onGoalPatched?: (goal: Tables<"goals">) => void`.

**Design (three reconciliation tiers, from the code):**

1. **Field blurs (`patch()`, line 94):** `updateGoal` gains `.select().single()` and **loses `revalidatePath("/goals")`**; the drawer patches the returned row into client tree state. 0 server re-renders per blur (was: action `revalidatePath` re-render **plus** `router.refresh()` — two full runs of the 4-query page per blur).
2. **Link edits (`saveLinks` 114, `onAddBoard` 190) + delete (450):** `setGoalLinks`/`deleteGoal` **keep** `revalidatePath("/goals")` — `auto_boards` progress comes from server-side `goals_rollup` aggregates the client can't patch. The action response already carries the re-rendered page, so the drawer's **extra** `router.refresh()` is deleted (halving those to one round-trip).
3. `auto_subgoals` parent rollups are recomputed client-side (mean-of-children, same as `buildGoalTree`), so a child's percent blur moves its parent's bar with 0 refetches.

- [ ] **Step 1: Write the failing tests** — `src/lib/goals/patch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyGoalPatch } from "./patch";
import type { GoalNode } from "./types";
import type { Tables } from "@/types/database.types";

function node(over: Partial<GoalNode>): GoalNode {
  return {
    id: "g1",
    parentGoalId: null,
    name: "Goal",
    description: null,
    ownerId: "u1",
    workspaceId: null,
    progressMode: "manual_percent",
    status: "on_track",
    startValue: null,
    currentValue: null,
    targetValue: null,
    unit: null,
    percent: 20,
    startDate: null,
    dueDate: null,
    position: 0,
    children: [],
    progress: 0.2,
    autoHealth: null,
    owner: null,
    ...over,
  };
}
function row(over: Partial<Tables<"goals">>): Tables<"goals"> {
  return {
    id: "g1",
    name: "Goal",
    description: null,
    owner_id: "u1",
    workspace_id: null,
    parent_goal_id: null,
    progress_mode: "manual_percent",
    status: "on_track",
    start_value: null,
    current_value: null,
    target_value: null,
    unit: null,
    percent: 20,
    start_date: null,
    due_date: null,
    position: 0,
    ...over,
  } as Tables<"goals">;
}

describe("applyGoalPatch", () => {
  it("patches fields and recomputes manual_percent progress", () => {
    const next = applyGoalPatch([node({})], row({ percent: 80 }));
    expect(next[0].percent).toBe(80);
    expect(next[0].progress).toBeCloseTo(0.8);
  });
  it("rolls a child's new progress up into an auto_subgoals parent", () => {
    const tree = [
      node({
        id: "parent",
        progressMode: "auto_subgoals",
        percent: null,
        progress: 0.2,
        children: [node({ id: "g1", parentGoalId: "parent" })],
      }),
    ];
    const next = applyGoalPatch(tree, row({ percent: 100 }));
    expect(next[0].children[0].progress).toBeCloseTo(1);
    expect(next[0].progress).toBeCloseTo(1);
  });
  it("leaves auto_boards progress untouched (server-derived rollup)", () => {
    const tree = [
      node({ progressMode: "auto_boards", percent: null, progress: 0.5 }),
    ];
    const next = applyGoalPatch(
      tree,
      row({ progress_mode: "auto_boards", name: "Renamed", percent: null }),
    );
    expect(next[0].name).toBe("Renamed");
    expect(next[0].progress).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found): `pnpm vitest run src/lib/goals/patch.test.ts`

- [ ] **Step 3: Implement `src/lib/goals/patch.ts`:**

```ts
import { computeGoalHealth, leafProgress, serverToday } from "./progress";
import type { GoalNode, RowOwner } from "./types";
import type { Tables } from "@/types/database.types";

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

/**
 * Patch one goal row (as returned by updateGoal) into an already-built client
 * tree, recomputing what is derivable client-side: the patched node's own
 * progress for manual modes; auto_subgoals rollups up the tree; autoHealth for
 * touched nodes. auto_boards progress is left untouched (server goals_rollup;
 * link edits reconcile via revalidatePath). This is what lets a field blur cost
 * 0 server round-trips.
 */
export function applyGoalPatch(
  tree: GoalNode[],
  row: Tables<"goals">,
  owners?: Map<string, RowOwner>,
  today: string = serverToday(Date.now()),
): GoalNode[] {
  const walk = (nodes: GoalNode[]): GoalNode[] =>
    nodes.map((node) => {
      const children = walk(node.children);
      let next: GoalNode = { ...node, children };
      if (node.id === row.id) {
        next = {
          ...next,
          name: row.name,
          description: row.description,
          ownerId: row.owner_id,
          progressMode: row.progress_mode,
          status: row.status,
          startValue: row.start_value,
          currentValue: row.current_value,
          targetValue: row.target_value,
          unit: row.unit,
          percent: row.percent,
          startDate: row.start_date,
          dueDate: row.due_date,
          owner: owners?.get(row.owner_id) ?? node.owner,
        };
      }
      let progress = next.progress;
      if (next.progressMode === "auto_subgoals") {
        const vals = children
          .map((c) => c.progress)
          .filter((p): p is number => p != null);
        progress =
          vals.length === 0
            ? null
            : clamp01(vals.reduce((s, v) => s + v, 0) / vals.length);
      } else if (
        next.id === row.id &&
        (next.progressMode === "manual_percent" ||
          next.progressMode === "manual_number")
      ) {
        progress = leafProgress(next, []);
      }
      return {
        ...next,
        progress,
        autoHealth: computeGoalHealth({
          progress,
          startDate: next.startDate,
          dueDate: next.dueDate,
          today,
        }),
      };
    });
  return walk(tree);
}
```

- [ ] **Step 4: Run — expect PASS:** `pnpm vitest run src/lib/goals/patch.test.ts`

- [ ] **Step 5: Extend `updateGoal`** in `src/lib/goals/actions.ts` — change the return type to `ActionResult<{ goal: Tables<"goals"> }>`, `.select().single()` the patched row, and **delete `revalidatePath("/goals")`** (with a comment explaining field edits reconcile client-side). `createGoal`, `deleteGoal`, `reorderGoal`, `setGoalLinks` keep their `revalidatePath` unchanged. Confirm no other `updateGoal` caller assumes `data: null`: `grep -rn "updateGoal" src --include="*.ts*" | grep -v test`.

- [ ] **Step 6: Create `src/components/goals/GoalsView.tsx`** — the shared client owner so drawer and tree render one reconciled state:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GoalTree } from "./GoalTree";
import { GoalDetailDrawer } from "./GoalDetailDrawer";
import { applyGoalPatch } from "@/lib/goals/patch";
import type { GoalNode, RowOwner } from "@/lib/goals/types";
import type { GoalLink } from "@/lib/goals/queries";
import type { Tables } from "@/types/database.types";

/**
 * Client owner of the goals tree. Field edits in the drawer call onGoalPatched
 * with the row returned by updateGoal and we reconcile locally (0 refetches).
 * Structural mutations revalidate "/goals" in their actions; when that payload
 * lands, the `tree` prop changes and the effect resyncs to server truth.
 */
export function GoalsView({
  tree,
  members,
  boards,
  links,
}: {
  tree: GoalNode[];
  members: RowOwner[];
  boards: { id: string; name: string }[];
  links: Record<string, GoalLink[]>;
}) {
  const [localTree, setLocalTree] = useState(tree);
  useEffect(() => setLocalTree(tree), [tree]);
  const owners = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members],
  );
  const onGoalPatched = useCallback(
    (row: Tables<"goals">) =>
      setLocalTree((prev) => applyGoalPatch(prev, row, owners)),
    [owners],
  );
  return (
    <>
      <div className="min-h-0 flex-1">
        <GoalTree tree={localTree} />
      </div>
      <GoalDetailDrawer
        tree={localTree}
        members={members}
        boards={boards}
        links={links}
        onGoalPatched={onGoalPatched}
      />
    </>
  );
}
```

- [ ] **Step 7: Rewire the page** — in `src/app/(app)/goals/page.tsx`, replace the `GoalTree` + `GoalDetailDrawer` JSX (and their imports) with a single `<GoalsView tree={tree} members={members} boards={boardOptions} links={links} />`. The header block is unchanged.

- [ ] **Step 8: Rewrite the drawer's reconciliation** in `GoalDetailDrawer.tsx`. Thread `onGoalPatched?: (goal: Tables<"goals">) => void` through `GoalDetailDrawer` → `GoalEditor`. Replace `patch()`:

```tsx
function patch(input: Parameters<typeof updateGoal>[0]) {
  setSaveError(null);
  startTransition(async () => {
    const res = await updateGoal(input);
    if (res.ok) {
      onGoalPatched?.(res.data.goal); // reconcile locally — no page refetch
    } else {
      resetFields();
      setSaveError(res.error);
    }
  });
}
```

Replace `saveLinks()`'s success branch (`if (res.ok) router.refresh()`) with `if (!res.ok) setLinkError(res.error);` (the action's `revalidatePath` is the single refetch). Same for `onAddBoard()`'s tail and the Delete button transition (`deleteGoal` keeps its own `revalidatePath`). Remove the now-unused `const router = useRouter();` and `useRouter` import from `GoalEditor`, and update the stale `resetFields` docblock.

- [ ] **Step 9: Update `GoalDetailDrawer.test.tsx`.** Hoist a `refresh` spy in the `next/navigation` mock, set `updateGoal.mockResolvedValue({ ok: true, data: { goal: {} } })`, and add tests asserting a field blur calls `onGoalPatched` with the returned row and **never** `router.refresh()`, and that link edits rely on the action's revalidate (no client refresh). Keep the existing done-mapping + revert-on-failure tests green.

- [ ] **Step 10: Run — expect PASS:** `pnpm vitest run src/lib/goals src/components/goals`

- [ ] **Step 11: Commit**

```bash
git add src/lib/goals/actions.ts src/lib/goals/patch.ts src/lib/goals/patch.test.ts src/components/goals/GoalsView.tsx src/components/goals/GoalDetailDrawer.tsx src/components/goals/GoalDetailDrawer.test.tsx "src/app/(app)/goals/page.tsx"
git commit -m "perf(goals): reconcile drawer field edits locally instead of refreshing /goals" -m "Every field blur re-ran the whole /goals page (4 queries) via router.refresh() on top of the action's own revalidate. updateGoal now returns the patched row; GoalsView reconciles it into the tree client-side (0 refetches). Structural link/delete edits keep their single revalidate." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task D2: TimeCard — coalesce per-cell refresh into one debounced refresh

**Files:**

- Modify: `src/lib/time/actions.ts` (`upsertTimeAllocation` returns the written seconds; both actions drop `revalidatePath("/time")`, keep `"/workload"`)
- Modify: `src/components/time/TimeCard.tsx` + `src/components/time/TimeCard.test.tsx`

**Interfaces:**

- Consumes: `upsertTimeAllocation`/`deleteTimeAllocation` (extended); `TimeCardData`.
- Produces: `upsertTimeAllocation(): Promise<ActionResult<{ durationSecs: number }>>`; `TimeCard` keeps a **durable** local-edits overlay (plain `useState`, replacing the transition-scoped `useOptimistic`) and fires **one** `router.refresh()` 2s after the last edit in a burst. Week-nav `router.push` (line 72) untouched.

**Design:** everything visible on `/time` is computed in `TimeCard` from `data.rows` + the overlay, so no other component needs per-edit revalidation. `timerSecs` (merged from `time_entries`) and `/workload` are server-derived, so: (a) drop `revalidatePath("/time")` from both actions (it shipped a full re-rendered `/time` payload per cell on top of `router.refresh()`); (b) keep `revalidatePath("/workload")` (invalidates that route's cache, no current re-render); (c) one trailing-debounced `router.refresh()` reconciles `/time` once per burst. The overlay is durable state (not `useOptimistic`) because the truth must survive the transition until the coalesced refresh lands.

- [ ] **Step 1: Extend the actions.** `upsertTimeAllocation` returns `{ ok: true, data: { durationSecs: d.durationSecs } }`, drops `revalidatePath("/time")`, keeps `revalidatePath("/workload")`. `deleteTimeAllocation` keeps `ActionResult<null>`, same revalidate change.

- [ ] **Step 2: Write the failing test** in `TimeCard.test.tsx` (adapt to the file's cell-commit helper; hoist a `refresh` spy):

```tsx
describe("coalesced refresh", () => {
  it("does not refresh per cell edit; one refresh ~2s after the last commit", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    try {
      render(<TimeCard data={data} categories={[]} />);
      await commitCellValue(user, 0, "2");
      await commitCellValue(user, 1, "1.5");
      expect(refresh).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2100);
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps the committed value visible after the transition settles (durable overlay)", async () => {
    const user = userEvent.setup();
    render(<TimeCard data={data} categories={[]} />);
    await commitCellValue(user, 0, "2");
    expect(await screen.findByText(/2h/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

Update the `upsertTimeAllocation` mock to resolve `{ ok: true, data: { durationSecs: 7200 } }` and invert any per-commit refresh assertion.

- [ ] **Step 3: Run — expect FAIL** (refresh fires per commit; value reverts): `pnpm vitest run src/components/time/TimeCard.test.tsx`

- [ ] **Step 4: Rewrite `TimeCard.tsx` state + commit paths.** Drop `useOptimistic`; add a durable `localEdits: Map<string, number>` keyed `` `${rowKey}::${day}` `` reset on `data.weekStart` change; a `scheduleRefresh()` that trailing-debounces one `router.refresh()` 2s after the last edit (cleared on unmount). `commitCell`/`clearCell` set the overlay optimistically, revert on failure, reconcile from the action's `durationSecs` return, then `scheduleRefresh()`. The cell input reads the overlay-aware `effManual(row.key, cell)`. Update the two stale comments referencing per-edit `router.refresh()`. (Full code in the batch-D draft; keep `gotoWeek`/`router.push` at line 72 untouched.)

- [ ] **Step 5: Run — expect PASS:** `pnpm vitest run src/components/time`

- [ ] **Step 6: Commit**

```bash
git add src/lib/time/actions.ts src/components/time/TimeCard.tsx src/components/time/TimeCard.test.tsx
git commit -m "perf(time): coalesce per-cell refresh into one debounced reconcile" -m "commitCell/clearCell awaited the action then router.refresh() per cell, shipping a full /time payload each keystroke-commit. A durable local overlay now holds server-acknowledged values and one trailing-debounced refresh (2s) reconciles the page per edit burst. Week nav untouched." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task D3: Shell timezone boundary must not blank the content area

**Files:**

- Modify: `src/lib/datetime/timezone-context.tsx`; `src/components/shell/authenticated-shell.tsx`; `src/components/datetime/date-time.tsx`
- Delete: `src/components/shell/timezone-boundary.tsx`
- Test: `src/lib/datetime/timezone-context.test.tsx` (create)

**Interfaces:**

- Consumes: `getUser`, `getUserTimeZoneCached` — same reads, not awaited before children render.
- Produces: `TimeZoneProvider({ timeZone: string | null | Promise<string | null> })`; `useTimeZone(): string | null` suspends **only the calling component** while the promise streams; `DateTime` wraps itself in a local `<Suspense>` with an empty `<time>` fallback (no wrong-timezone flash). `TimeZoneBoundary` retired.

**Design (promise-prop + React 19 `use()`):** today `authenticated-shell.tsx:61-63` awaits user + timezone inside `TimeZoneBoundary` behind `<Suspense fallback={null}>` around **all** children, so a hard load blanks the whole content area (including each route's `loading.tsx`) until two reads resolve. The fix passes the timezone read as an **unresolved promise prop** to the client provider; only `useTimeZone()` consumers suspend. The sole consumer is `DateTime` (`grep -rn "useTimeZone" src` → `date-time.tsx` only), which gets a component-local `<Suspense>` with an empty `<time dateTime=…>` fallback. Verify the pattern against `node_modules/next/dist/docs` + React 19 `use` docs, and that it survives the Cache Components prerender (`pnpm build`).

- [ ] **Step 1: Write the failing test** — `src/lib/datetime/timezone-context.test.tsx` (renders siblings immediately while the promise is pending, resolves consumers after; still accepts a plain resolved value):

```tsx
import { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeZoneProvider, useTimeZone } from "./timezone-context";

function Zone() {
  return <span>zone:{useTimeZone() ?? "auto"}</span>;
}

describe("TimeZoneProvider with a promise value", () => {
  it("renders siblings while pending, then resolves consumers", async () => {
    let resolve!: (v: string | null) => void;
    const pending = new Promise<string | null>((r) => (resolve = r));
    render(
      <TimeZoneProvider timeZone={pending}>
        <p>content paints now</p>
        <Suspense fallback={<span>tz-pending</span>}>
          <Zone />
        </Suspense>
      </TimeZoneProvider>,
    );
    expect(screen.getByText("content paints now")).toBeInTheDocument();
    expect(screen.getByText("tz-pending")).toBeInTheDocument();
    await act(async () => resolve("Asia/Kuwait"));
    expect(await screen.findByText("zone:Asia/Kuwait")).toBeInTheDocument();
  });
  it("still accepts a plain resolved value", () => {
    render(
      <TimeZoneProvider timeZone="Europe/Belgrade">
        <Zone />
      </TimeZoneProvider>,
    );
    expect(screen.getByText("zone:Europe/Belgrade")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL:** `pnpm vitest run src/lib/datetime/timezone-context.test.tsx`

- [ ] **Step 3: Implement `timezone-context.tsx`** — a context holding `string | null | Promise<string | null>`; `useTimeZone()` unwraps a thenable via React 19 `use()`, else returns the value:

```tsx
"use client";

import { createContext, use, useContext, type ReactNode } from "react";

type TimeZoneValue = string | null | Promise<string | null>;
const TimeZoneContext = createContext<TimeZoneValue>(null);

export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: TimeZoneValue;
  children: ReactNode;
}) {
  return (
    <TimeZoneContext.Provider value={timeZone}>
      {children}
    </TimeZoneContext.Provider>
  );
}

/** The user's zone, or null (Automatic). While the shell's promise is
 * unresolved this suspends the CALLING component only. Wrap consumers in a
 * local <Suspense> with no date text so a wrong-timezone value can't flash. */
export function useTimeZone(): string | null {
  const v = useContext(TimeZoneContext);
  return v !== null && typeof v === "object" && "then" in v ? use(v) : v;
}
```

- [ ] **Step 4: Re-root the shell** — in `authenticated-shell.tsx`, drop the `TimeZoneBoundary` import; add a non-awaited `resolveUserTimeZone(): Promise<string | null>` (`getUser` → `getUserTimeZoneCached(user.id)`), and wrap children with `<TimeZoneProvider timeZone={resolveUserTimeZone()}>{children}</TimeZoneProvider>`. Then `git rm src/components/shell/timezone-boundary.tsx` after confirming `grep -rn "TimeZoneBoundary" src` shows only the (now-removed) shell import.

- [ ] **Step 5: Gate the consumer** — rewrite `date-time.tsx` so `DateTime` renders a local `<Suspense>` whose fallback is an empty `<time dateTime={iso} />` (machine-readable, no visible text) around a `ResolvedDateTime` that calls `useTimeZone()` and formats.

- [ ] **Step 6: Run — expect PASS**, and verify the streamed-promise pattern survives the prerender: `pnpm vitest run src/lib/datetime src/components/datetime && pnpm build` (if the build flags the un-awaited read, consult `node_modules/next/dist/docs` on `cacheComponents` + streaming before deviating).

- [ ] **Step 7: Commit**

```bash
git add src/lib/datetime/timezone-context.tsx src/lib/datetime/timezone-context.test.tsx src/components/shell/authenticated-shell.tsx src/components/datetime/date-time.tsx
git rm src/components/shell/timezone-boundary.tsx
git commit -m "perf(shell): stream timezone as a promise so content never blanks" -m "The shell awaited getUser + getUserTimeZoneCached inside a Suspense(fallback=null) around all children, blanking the whole content area (and every route skeleton) on hard load. The timezone is now an unresolved promise prop; only DateTime suspends, behind an empty <time> fallback that can't flash a wrong zone." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task D4: Thumbnail-size images via Supabase image transforms

**Files:**

- Modify: `src/lib/collaboration/actions.ts` (`getAttachmentPreviewUrls` gains a `thumb` variant)
- Modify: `src/components/boards/cells/FilesCell.tsx`; `src/components/boards/item-panel/AttachmentCard.tsx`
- Modify: the two callers of `getAttachmentPreviewUrls` (`src/components/boards/BoardTable.tsx`, `src/lib/collaboration/use-item-attachments.ts`)
- Test: `src/components/boards/cells/FilesCell.test.tsx` (extend/create)

**Interfaces:**

- Consumes: `supabase.storage.from("attachments").createSignedUrl(path, ttl, { transform })` (verified `@supabase/storage-js@2.108.1`: `transform?: { width?, height?, resize? }`; **`createSignedUrls` plural has no `transform`** — thumbs signed per-file).
- Produces: `getAttachmentPreviewUrls({ attachmentIds, thumb? }): ActionResult<{ urls, thumbUrls }>` — `urls` unchanged (full-res, keeps `FilePreviewLightbox` working); `thumbUrls` populated only for `image/*` rows when `thumb` is passed. `FilesCell` gains `thumbUrls?`; `AttachmentCard` gains `thumbUrl?`. Both fall back to full-res via `onError` (Supabase image transformation is a **Pro-plan feature** — signing succeeds on any plan, but the `/render/image` fetch 4xxs when the flag is off; `onError` catches that).

- [ ] **Step 1: Extend the action.** `getAttachmentPreviewUrls` keeps the plural `createSignedUrls` for the full-res `urls` map, and when `thumb` is passed, additionally signs **per-file** `createSignedUrl(path, ttl, { transform: { width, height, resize: "cover" } })` for `image/*` rows into `thumbUrls`. Return `{ urls, thumbUrls }`. (Full code in the batch-D draft.)

- [ ] **Step 2: Write the failing component test** — `FilesCell.test.tsx`: with `thumbUrls` set, the img `src` is the thumb URL and falls back to the full-res `previewUrls` entry on `fireEvent.error`; with no thumb, it uses the full-res URL directly.

- [ ] **Step 3: Run — expect FAIL** (`thumbUrls` prop unknown): `pnpm vitest run src/components/boards/cells/FilesCell.test.tsx`

- [ ] **Step 4: Implement the components.** Add a small `ThumbImg`/state-driven `<img>` in `FilesCell.tsx` and `AttachmentCard.tsx` that renders `thumbUrl ?? fullUrl` and swaps to `fullUrl` on `onError` (once). Extend their props (`thumbUrls?` / `thumbUrl?`). Keep `loading="lazy"` + `object-cover`.

- [ ] **Step 5: Thread the maps through the callers.** In `BoardTable.tsx` pass `thumb: { width: 96, height: 96 }` (the `size-6`/coarse-`size-11` chip → 96 covers 2× DPR); in `use-item-attachments.ts` pass `thumb: { width: 640, height: 360 }` (the `aspect-video` card). Store `res.data.thumbUrls` alongside the existing `urls` map and pass down as `thumbUrls`/`thumbUrl`. **`FilePreviewLightbox` keeps consuming the full-res `urls` map — do not hand it thumbs.** (Adapt to the real state-variable names in those two files.)

- [ ] **Step 6: Run — expect PASS:** `pnpm vitest run src/components/boards src/lib/collaboration && pnpm typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/lib/collaboration/actions.ts src/components/boards/cells/FilesCell.tsx src/components/boards/cells/FilesCell.test.tsx src/components/boards/item-panel/AttachmentCard.tsx src/components/boards/BoardTable.tsx src/lib/collaboration/use-item-attachments.ts
git commit -m "perf(attachments): serve width-transformed thumbnails with full-res fallback" -m "24px file chips and card thumbnails loaded full-resolution signed storage URLs. getAttachmentPreviewUrls now also mints width-constrained /render/image signed URLs for image attachments; components render the thumb and fall back to full-res on error (transforms are a Pro-plan feature). The lightbox keeps full-res." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task D5: Truthful instant-nav comment in the (app) layout

**Files:**

- Modify: `src/app/(app)/layout.tsx:13-22`

**Interfaces:**

- Consumes: nothing.
- Produces: no behavior change — `unstable_instant` **stays `false`** (do NOT enable it; gotcha-48). One-file docblock diff.

- [ ] **Step 1: Replace the docblock** so it states the truth: `unstable_instant` is off and no page segment exports `{ prefetch: 'static' }` (an earlier comment claimed they did — they never validated); the shell reads `useSearchParams()` pervasively for gotcha-09's 0-refetch view switching, which fails instant validation, so route-level `loading.tsx` skeletons are the instant-nav mechanism instead; do not flip the flag without the `useSearchParams`-decoupling spec — see `vault/decisions/2026-07-04-gotcha-48-unstable-instant-blocked-by-shell-searchparams.md`. Keep `export const unstable_instant = false;`.

- [ ] **Step 2: Verify only the comment changed:** `git diff --stat "src/app/(app)/layout.tsx"` (1 file, comment lines only) and `pnpm typecheck`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/layout.tsx"
git commit -m "docs(app): correct instant-nav docblock to match gotcha-48 reality" -m "The docblock claimed page segments validate with { prefetch: 'static' }; no such export exists and unstable_instant is architecturally blocked by the shell's pervasive useSearchParams (gotcha-48). Comment now states the truth and points at the ADR." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

**Batch D intra-batch dependencies:** none — D1–D5 touch disjoint file sets (goals / time / shell+datetime / collaboration+boards / (app) layout docblock). All five run as one wave. Critical path = the longest single task (D1).

---

## How to test this program (after each batch merges to `develop`)

Pull `develop`; app runs on DEV env (`.env.local`). All manual acceptance is in addition to the automated gates.

**Batch A — server latency**

1. Log in as a returning user who has visited a board → you land **directly** on your last board with no white flash (A2+A3). Confirm the network panel shows one board-probe query, not three list reads.
2. Hard-refresh a large board → first paint is faster; no double flash (A1).
3. Click **My Work** in the sidebar → a skeleton appears **instantly**, then content (A4); the page's TTFB is lower on a busy account (A6).
4. Open a dashboard → loads a touch faster (A5).

**Batch B — board interaction**

1. On a board with many rows, type in the quick-search box → typing stays smooth, results settle a beat behind; the `?q=` in the URL is still shareable (B1).
2. Edit a single cell → only that cell flickers, not the whole column (B2).
3. Open a Gantt board with many scheduled items → scroll/zoom is smooth and dependency arrows track correctly (B3).
4. Open the Calendar **Agenda** on a busy month → dense days show 8 items + "+N more"; expanding reveals the rest (B4).

**Batch C — bundle**

1. DevTools → Network → reload any authenticated page: the @dnd-kit chunk is **not** in the initial JS; reordering a sidebar board still works on first drag (C1).
2. Open a dashboard: react-grid-layout loads as a lazy chunk behind the canvas skeleton (C2).
3. `pnpm build:analyze` produces a real report (C3).

**Batch D — polish**

1. Edit several fields of one goal in the drawer → each saves with **no** full-page reload/flicker; the tree bar updates live (D1).
2. Fill in several `/time` cells quickly → no per-cell flicker; values stick; the page reconciles once ~2s after you stop (D2).
3. Hard-refresh any authenticated page → the route skeleton shows immediately (no blank content pane while the timezone resolves); dates render correctly a moment later (D3).
4. Open a board with an image files column → tiny thumbnails load quickly (small transferred sizes in DevTools); the lightbox still shows full-res (D4).
