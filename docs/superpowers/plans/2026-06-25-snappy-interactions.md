# Phase 9.5a — Interaction Responsiveness Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the authenticated app feel snappier — especially under concurrent multi-user editing — by adding shared debounce/throttle primitives, coalescing realtime re-renders, and removing redundant per-request network auth calls.

**Architecture:** Three disjoint workstreams. (1) Three tiny client timing hooks under `src/lib/hooks/`, then refactor the two existing hand-rolled timers + one unthrottled hot spot onto them. (2) Per-request server-read dedup: drop redundant network `auth.getUser()` in `queries.ts` in favor of the cached local-verify session, and wrap the live detail fetchers in `React.cache()`. (3) Buffer incoming Supabase `postgres_changes` and apply them in one `setQueryData` per animation frame via a pure, fully-tested fold function.

**Tech Stack:** Next.js 16, React 19, TypeScript (strict), `@tanstack/react-query` v5, Supabase JS realtime, Vitest + `@testing-library/react` (jsdom `unit` project).

## Global Constraints

- **Server Components by default; Server Actions for mutations.** This slice changes no mutation paths.
- **TypeScript strict; no unjustified `any`.** Hooks are generic over `A extends unknown[]`.
- **RLS is the security boundary.** WS2 only changes _how the user id is obtained_ (cached local verify vs. fresh network) — never the cookie-bound RLS-scoped data queries. Do **not** introduce the service client into `queries.ts` (that is the 9.3 `queries-cached.ts` layer, out of scope).
- **Do NOT touch** `src/lib/boards/queries-cached.ts`, `src/lib/dashboards/queries-cached.ts`, `src/lib/workspaces/queries-cached.ts`, or anything using `use cache` / `cacheTag`.
- **Commit identity** is pinned to `Danijel Jovanovic <info@synapse-solutions.ai>` (set by `start-task.sh`). Every commit: lowercase conventional subject + descriptive body + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Stage by explicit path only.
- **Gates** (all must pass before merge): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## Execution DAG (AGENTS.md rule #6)

```
Batch 1 (parallel — disjoint files):
  Task 1  WS1-hooks         src/lib/hooks/*                 (produces the primitives)
  Task 2  WS2-dedup         src/lib/boards/queries.ts, src/lib/dashboards/queries.ts
  Task 3  WS3-coalesce      src/lib/boards/realtime-buffer.ts, use-board-realtime.ts

Batch 2 (parallel — each touches one distinct file; all depend on Task 1):
  Task 4  presence refactor   src/lib/boards/use-board-presence.ts
  Task 5  dashboard refactor  src/components/dashboards/DashboardCanvas.tsx
  Task 6  board-resizer       src/components/boards/BoardTable.tsx
```

- **Dependency edges:** Tasks 4, 5, 6 each `Consume` Task 1's hooks. Tasks 2 and 3 depend on nothing in this slice.
- **Parallel batches:** Batch 1 = {1, 2, 3}. Batch 2 = {4, 5, 6}.
- **Critical path:** Task 1 → (Task 4 | 5 | 6) — two waves. Tasks 2 and 3 finish inside Batch 1.

---

## Task 1: Client timing hooks

**Files:**

- Create: `src/lib/hooks/use-debounced-callback.ts`
- Create: `src/lib/hooks/use-debounced-callback.test.ts`
- Create: `src/lib/hooks/use-throttled-callback.ts`
- Create: `src/lib/hooks/use-throttled-callback.test.ts`
- Create: `src/lib/hooks/use-raf-callback.ts`
- Create: `src/lib/hooks/use-raf-callback.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delayMs: number): (...args: A) => void` — trailing-edge debounce; timer resets on each call; fires once `delayMs` after the last call with that call's args; stable identity; clears pending timer on unmount.
  - `useThrottledCallback<A extends unknown[]>(fn: (...args: A) => void, intervalMs: number): (...args: A) => void` — trailing-only throttle: the first call opens a window and schedules a single flush `intervalMs` later that runs with the **latest** args seen in the window; calls during the window are coalesced (no reschedule); after the flush the next call opens a new window. Stable identity; clears pending timer on unmount. (This exactly matches the existing presence throttle semantics.)
  - `useRafCallback<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void` — coalesces all calls within one animation frame into a single call with the latest args, via `requestAnimationFrame`; stable identity; cancels a pending frame on unmount.

- [ ] **Step 1: Write the failing test for `useDebouncedCallback`**

`src/lib/hooks/use-debounced-callback.test.ts`:

```ts
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedCallback } from "./use-debounced-callback";

describe("useDebouncedCallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once after the quiet period with the latest args", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(fn, 200));
    act(() => {
      result.current(1);
      result.current(2);
      result.current(3);
    });
    expect(fn).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(200));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it("does not fire after unmount", () => {
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(fn, 200));
    act(() => result.current());
    unmount();
    act(() => void vi.advanceTimersByTime(500));
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps a stable identity across renders", () => {
    const fn = vi.fn();
    const { result, rerender } = renderHook(() =>
      useDebouncedCallback(fn, 200),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run src/lib/hooks/use-debounced-callback.test.ts`
Expected: FAIL — cannot find module `./use-debounced-callback`.

- [ ] **Step 3: Implement `useDebouncedCallback`**

`src/lib/hooks/use-debounced-callback.ts`:

```ts
import { useCallback, useEffect, useRef } from "react";

/**
 * Trailing-edge debounce. The returned callback resets its timer on every call
 * and fires `fn` once, `delayMs` after the last call, with that call's args.
 * Stable identity (safe in deps); pending timer is cleared on unmount.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        fnRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm vitest run src/lib/hooks/use-debounced-callback.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for `useThrottledCallback`**

`src/lib/hooks/use-throttled-callback.test.ts`:

```ts
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThrottledCallback } from "./use-throttled-callback";

describe("useThrottledCallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces calls in the window into one trailing flush with latest args", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(fn, 150));
    act(() => {
      result.current("a");
      result.current("b");
    });
    expect(fn).not.toHaveBeenCalled(); // trailing-only: nothing fires immediately
    act(() => void vi.advanceTimersByTime(150));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("b");
  });

  it("opens a fresh window after a flush", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(fn, 150));
    act(() => result.current("a"));
    act(() => void vi.advanceTimersByTime(150));
    act(() => result.current("c"));
    act(() => void vi.advanceTimersByTime(150));
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("c");
  });

  it("does not fire after unmount", () => {
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useThrottledCallback(fn, 150));
    act(() => result.current("x"));
    unmount();
    act(() => void vi.advanceTimersByTime(500));
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it — verify it fails**

Run: `pnpm vitest run src/lib/hooks/use-throttled-callback.test.ts`
Expected: FAIL — cannot find module `./use-throttled-callback`.

- [ ] **Step 7: Implement `useThrottledCallback`**

`src/lib/hooks/use-throttled-callback.ts`:

```ts
import { useCallback, useEffect, useRef } from "react";

/**
 * Trailing-only throttle. The first call opens a window and schedules a single
 * flush `intervalMs` later that runs `fn` with the LATEST args seen in the
 * window; calls during the window are coalesced (no reschedule). After the
 * flush, the next call opens a new window. Matches the board-presence throttle.
 * Stable identity; pending timer cleared on unmount.
 */
export function useThrottledCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<A | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (...args: A) => {
      latest.current = args;
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        const a = latest.current;
        latest.current = null;
        if (a) fnRef.current(...a);
      }, intervalMs);
    },
    [intervalMs],
  );
}
```

- [ ] **Step 8: Run it — verify it passes**

Run: `pnpm vitest run src/lib/hooks/use-throttled-callback.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Write the failing test for `useRafCallback`**

`src/lib/hooks/use-raf-callback.test.ts`:

```ts
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRafCallback } from "./use-raf-callback";

describe("useRafCallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces multiple calls in a frame to one call with latest args", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useRafCallback(fn));
    act(() => {
      result.current(1);
      result.current(2);
    });
    expect(fn).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersToNextFrame());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
  });

  it("does not fire after unmount", () => {
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useRafCallback(fn));
    act(() => result.current(1));
    unmount();
    act(() => void vi.advanceTimersToNextFrame());
    expect(fn).not.toHaveBeenCalled();
  });
});
```

> Note: `vi.advanceTimersToNextFrame()` (Vitest 4) drives the faked `requestAnimationFrame`. If unavailable in this version, substitute `vi.advanceTimersByTime(20)` — Vitest's fake timers back rAF with a ~16ms timer.

- [ ] **Step 10: Run it — verify it fails**

Run: `pnpm vitest run src/lib/hooks/use-raf-callback.test.ts`
Expected: FAIL — cannot find module `./use-raf-callback`.

- [ ] **Step 11: Implement `useRafCallback`**

`src/lib/hooks/use-raf-callback.ts`:

```ts
import { useCallback, useEffect, useRef } from "react";

/**
 * Coalesces all calls within one animation frame into a single call with the
 * latest args. Use for per-pixel pointer work (e.g. live column-resize) so the
 * handler updates at most once per frame. Stable identity; cancels a pending
 * frame on unmount.
 */
export function useRafCallback<A extends unknown[]>(
  fn: (...args: A) => void,
): (...args: A) => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const frame = useRef<number | null>(null);
  const latest = useRef<A | null>(null);
  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return useCallback((...args: A) => {
    latest.current = args;
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const a = latest.current;
      latest.current = null;
      if (a) fnRef.current(...a);
    });
  }, []);
}
```

- [ ] **Step 12: Run it — verify it passes**

Run: `pnpm vitest run src/lib/hooks/use-raf-callback.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 13: Commit**

```bash
git add src/lib/hooks/use-debounced-callback.ts src/lib/hooks/use-debounced-callback.test.ts \
  src/lib/hooks/use-throttled-callback.ts src/lib/hooks/use-throttled-callback.test.ts \
  src/lib/hooks/use-raf-callback.ts src/lib/hooks/use-raf-callback.test.ts
git commit -m "feat(perf): add shared debounce/throttle/raf timing hooks" -m "Typed, stable-identity client timing primitives with unmount cleanup, replacing the hand-rolled setTimeout patterns copy-pasted across presence and dashboard layout. Trailing-only throttle matches the existing presence semantics; raf hook coalesces per-pixel work to one update per frame.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Per-request server-read dedup (WS2)

**Files:**

- Modify: `src/lib/boards/queries.ts` (`listMyBoards` ~48-67, `listSharedBoards` ~70-98, `getBoardAccess` ~100-123, `getBoardPayload` ~133-297)
- Create: `src/lib/boards/queries.test.ts`
- Modify: `src/lib/dashboards/queries.ts` (`getDashboardPayload` ~25-44)
- Create: `src/lib/dashboards/queries.test.ts`

**Interfaces:**

- Consumes: `getUser` from `@/lib/auth/session` — `getUser(): Promise<SessionUser | null>` where `SessionUser` has `id: string`. (Already React-`cache()`-wrapped, `getClaims` local verify.)
- Produces: same public signatures, unchanged — `listMyBoards()`, `listSharedBoards()`, `getBoardAccess(boardId)`, `getBoardPayload(boardId)`, `getDashboardPayload(dashboardId)`. Behavior identical; only the user-id source and per-request memoization change.

- [ ] **Step 1: Write the failing test (boards)**

`src/lib/boards/queries.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

// Cached local-verify session — the source we want these queries to use.
const getUser = vi.fn(async () => ({ id: "u1", email: "u@x.com" }));
vi.mock("@/lib/auth/session", () => ({ getUser }));

// Spy that MUST NOT be called: the network auth round-trip.
const authGetUser = vi.fn(async () => ({ data: { user: { id: "u1" } } }));

// Minimal chainable + thenable supabase stub. Awaited chains resolve to an empty
// list; `.maybeSingle()` resolves to a board owned by u1.
function makeChain() {
  const thenable: Record<string, unknown> = {
    select: () => thenable,
    eq: () => thenable,
    in: () => thenable,
    not: () => thenable,
    limit: () => thenable,
    order: () => thenable,
    maybeSingle: async () => ({ data: { created_by: "u1" }, error: null }),
    then: (onF: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onF),
  };
  return thenable;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authGetUser },
    from: () => makeChain(),
  })),
}));

import { getBoardAccess, listMyBoards, listSharedBoards } from "./queries";

afterEach(() => vi.clearAllMocks());

describe("boards queries use the cached session, not network auth", () => {
  it("listMyBoards does not call supabase.auth.getUser", async () => {
    await listMyBoards();
    expect(getUser).toHaveBeenCalled();
    expect(authGetUser).not.toHaveBeenCalled();
  });

  it("listSharedBoards does not call supabase.auth.getUser", async () => {
    await listSharedBoards();
    expect(getUser).toHaveBeenCalled();
    expect(authGetUser).not.toHaveBeenCalled();
  });

  it("getBoardAccess does not call supabase.auth.getUser and resolves owner", async () => {
    const access = await getBoardAccess("b1");
    expect(authGetUser).not.toHaveBeenCalled();
    expect(access).toBe("owner");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run src/lib/boards/queries.test.ts`
Expected: FAIL — `authGetUser` is called (current code uses `supabase.auth.getUser()`).

- [ ] **Step 3: Edit `src/lib/boards/queries.ts` — swap the auth source + wrap the payload**

At the top, add the import and `cache`:

```ts
import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import type { Tables } from "@/types/database.types";
import type { RelationLink } from "@/lib/boards/relations";
```

In `listMyBoards`, replace:

```ts
const supabase = await createClient();
const {
  data: { user },
} = await supabase.auth.getUser();
if (!user) return [];
```

with:

```ts
const user = await getUser();
if (!user) return [];
const supabase = await createClient();
```

Apply the **same** replacement in `listSharedBoards` and `getBoardAccess`. Every later use of `user.id` is unchanged (the `getUser()` result also has `.id`).

Convert `getBoardPayload` from a function declaration to a `cache()`-wrapped const. Change:

```ts
export async function getBoardPayload(
  boardId: string,
): Promise<BoardPayload | null> {
  const supabase = await createClient();
  // ...rest of body unchanged...
}
```

to:

```ts
export const getBoardPayload = cache(
  async (boardId: string): Promise<BoardPayload | null> => {
    const supabase = await createClient();
    // ...rest of body unchanged...
  },
);
```

(Only the declaration line and the closing `}` → `});` change; the body is identical.)

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm vitest run src/lib/boards/queries.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test (dashboards)**

`src/lib/dashboards/queries.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

function makeChain(maybe: unknown, list: unknown[]) {
  const thenable: Record<string, unknown> = {
    select: () => thenable,
    eq: () => thenable,
    order: () => thenable,
    maybeSingle: async () => ({ data: maybe, error: null }),
    then: (onF: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: list, error: null }).then(onF),
  };
  return thenable;
}
const createClient = vi.fn(async () => ({
  from: () =>
    makeChain({ id: "d1", name: "Dash" }, [{ id: "w1", dashboard_id: "d1" }]),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { getDashboardPayload } from "./queries";

afterEach(() => vi.clearAllMocks());

describe("getDashboardPayload", () => {
  it("returns the dashboard with its widgets", async () => {
    const payload = await getDashboardPayload("d1");
    expect(payload?.dashboard.id).toBe("d1");
    expect(payload?.widgets).toHaveLength(1);
  });

  it("returns null when the dashboard is not visible", async () => {
    createClient.mockResolvedValueOnce({
      from: () => makeChain(null, []),
    } as never);
    expect(await getDashboardPayload("missing")).toBeNull();
  });
});
```

- [ ] **Step 6: Run it — verify it fails (or errors)**

Run: `pnpm vitest run src/lib/dashboards/queries.test.ts`
Expected: FAIL — the test exercises the not-yet-`cache()`-wrapped function; ensure it passes after Step 7 (the wrap must not change behavior). If it already passes pre-edit, that is fine — it is the behavioral guard for Step 7.

- [ ] **Step 7: Edit `src/lib/dashboards/queries.ts` — wrap `getDashboardPayload` in `cache()`**

Add the import:

```ts
import "server-only";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";
```

Convert:

```ts
export async function getDashboardPayload(
  dashboardId: string,
): Promise<DashboardPayload | null> {
  // ...body unchanged...
}
```

to:

```ts
export const getDashboardPayload = cache(
  async (dashboardId: string): Promise<DashboardPayload | null> => {
    // ...body unchanged...
  },
);
```

(Leave `listDashboards` as-is — the cached org list is the 9.3 `queries-cached.ts` layer's job; this uncached original stays for any direct caller.)

- [ ] **Step 8: Run it — verify it passes**

Run: `pnpm vitest run src/lib/dashboards/queries.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Typecheck the touched files compile**

Run: `pnpm typecheck`
Expected: no errors. (Confirms the `cache()` const conversions kept the exported types intact.)

- [ ] **Step 10: Commit**

```bash
git add src/lib/boards/queries.ts src/lib/boards/queries.test.ts \
  src/lib/dashboards/queries.ts src/lib/dashboards/queries.test.ts
git commit -m "perf(boards): dedup per-request reads, drop redundant network auth" -m "getBoardAccess/listMyBoards/listSharedBoards now read the user id from the cached local-verify session (getClaims) instead of a network auth.getUser round-trip — removes an auth hop from the board-page path. getBoardPayload/getDashboardPayload wrapped in React.cache() for per-request dedup. RLS-scoped data queries unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Coalesce realtime postgres_changes (WS3)

**Files:**

- Create: `src/lib/boards/realtime-buffer.ts`
- Create: `src/lib/boards/realtime-buffer.test.ts`
- Modify: `src/lib/boards/use-board-realtime.ts` (replace per-event `patch()` with a per-frame microbatch)
- Create: `src/lib/boards/use-board-realtime.test.tsx`

**Interfaces:**

- Consumes: existing pure cache reducers from `@/lib/boards/cache` (`upsertCellValue`, `removeCellValue`, `insertItem`, `replaceItem`, `insertColumn`, `replaceColumn`, `removeColumn`, `insertGroup`, `replaceGroup`, `addDependency`, `removeDependency`) and the `BoardCache`, `CacheCellValue`, `CacheItem`, `CacheColumn`, `CacheGroup`, `CacheDependency` types; `boardKey` from `@/lib/boards/use-board-cache`.
- Produces:
  - `type BoardRealtimeEvent` — discriminated union `{ table: "cell_values" | "items" | "item_dependencies" | "columns" | "groups"; payload: RealtimePostgresChangesPayload<…> }`.
  - `type BoardFlash = { targetId: string; valueChanged: boolean }`.
  - `foldBoardEvents(prev: BoardCache, events: BoardRealtimeEvent[]): { next: BoardCache; flashes: BoardFlash[] }` — applies events in order over `prev`, replicating the current per-handler logic incl. cell echo-dedup; returns the new cache and the flash events for changed cells.
  - `useBoardRealtime(boardId, opts?)` — unchanged signature.

- [ ] **Step 1: Write the failing test for `foldBoardEvents`**

`src/lib/boards/realtime-buffer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { foldBoardEvents, type BoardRealtimeEvent } from "./realtime-buffer";
import type { BoardCache } from "./cache";

function emptyCache(over: Partial<BoardCache> = {}): BoardCache {
  return {
    board: { id: "b1" },
    groups: [],
    columns: [],
    items: [],
    cellValues: [],
    views: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
    ...over,
  } as unknown as BoardCache;
}

function cellEvent(
  item_id: string,
  column_id: string,
  value: unknown,
): BoardRealtimeEvent {
  return {
    table: "cell_values",
    payload: {
      eventType: "UPDATE",
      new: { item_id, column_id, value, board_id: "b1" },
      old: {},
    } as never,
  };
}

describe("foldBoardEvents", () => {
  it("applies a cell upsert and emits one flash for the changed cell", () => {
    const { next, flashes } = foldBoardEvents(emptyCache(), [
      cellEvent("i1", "c1", { text: "hi" }),
    ]);
    expect(next.cellValues).toHaveLength(1);
    expect(flashes).toEqual([{ targetId: "cell:i1:c1", valueChanged: true }]);
  });

  it("echo-dedupes a cell whose value already matches (no change, no flash)", () => {
    const prev = emptyCache({
      cellValues: [
        { item_id: "i1", column_id: "c1", value: { text: "hi" } },
      ] as never,
    });
    const { next, flashes } = foldBoardEvents(prev, [
      cellEvent("i1", "c1", { text: "hi" }),
    ]);
    expect(next).toBe(prev); // unchanged reference → no re-render
    expect(flashes).toHaveLength(0);
  });

  it("applies multiple events in order (last write wins on the same cell)", () => {
    const { next } = foldBoardEvents(emptyCache(), [
      cellEvent("i1", "c1", { text: "a" }),
      cellEvent("i1", "c1", { text: "b" }),
    ]);
    const cell = next.cellValues.find(
      (c) => c.item_id === "i1" && c.column_id === "c1",
    );
    expect((cell?.value as { text: string }).text).toBe("b");
  });

  it("removes an item on DELETE", () => {
    const prev = emptyCache({ items: [{ id: "i1" }] as never });
    const ev: BoardRealtimeEvent = {
      table: "items",
      payload: { eventType: "DELETE", new: {}, old: { id: "i1" } } as never,
    };
    const { next } = foldBoardEvents(prev, [ev]);
    expect(next.items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm vitest run src/lib/boards/realtime-buffer.test.ts`
Expected: FAIL — cannot find module `./realtime-buffer`.

- [ ] **Step 3: Implement `realtime-buffer.ts`**

`src/lib/boards/realtime-buffer.ts` — the per-table logic is lifted verbatim from the current `use-board-realtime.ts` handlers, rewritten as pure `(cache) => cache` folds:

```ts
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  addDependency,
  insertColumn,
  insertGroup,
  insertItem,
  removeCellValue,
  removeColumn,
  removeDependency,
  replaceColumn,
  replaceGroup,
  replaceItem,
  upsertCellValue,
  type BoardCache,
  type CacheCellValue,
  type CacheColumn,
  type CacheDependency,
  type CacheGroup,
  type CacheItem,
} from "@/lib/boards/cache";

export type BoardRealtimeEvent =
  | {
      table: "cell_values";
      payload: RealtimePostgresChangesPayload<CacheCellValue>;
    }
  | { table: "items"; payload: RealtimePostgresChangesPayload<CacheItem> }
  | {
      table: "item_dependencies";
      payload: RealtimePostgresChangesPayload<CacheDependency>;
    }
  | { table: "columns"; payload: RealtimePostgresChangesPayload<CacheColumn> }
  | { table: "groups"; payload: RealtimePostgresChangesPayload<CacheGroup> };

export type BoardFlash = { targetId: string; valueChanged: boolean };

function applyCell(
  prev: BoardCache,
  p: RealtimePostgresChangesPayload<CacheCellValue>,
  flashes: BoardFlash[],
): BoardCache {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheCellValue>;
    if (oldRow.item_id && oldRow.column_id) {
      return removeCellValue(prev, oldRow.item_id, oldRow.column_id);
    }
    return prev;
  }
  const row = p.new as CacheCellValue;
  // Echo-dedupe: if the value already matches, skip (no re-render churn).
  const existing = prev.cellValues.find(
    (c) => c.item_id === row.item_id && c.column_id === row.column_id,
  );
  if (
    existing &&
    JSON.stringify(existing.value) === JSON.stringify(row.value)
  ) {
    return prev;
  }
  flashes.push({
    targetId: `cell:${row.item_id}:${row.column_id}`,
    valueChanged: true,
  });
  return upsertCellValue(prev, row);
}

function applyItem(
  prev: BoardCache,
  p: RealtimePostgresChangesPayload<CacheItem>,
): BoardCache {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheItem>;
    return { ...prev, items: prev.items.filter((i) => i.id !== oldRow.id) };
  }
  const row = p.new as CacheItem;
  return prev.items.some((i) => i.id === row.id)
    ? replaceItem(prev, row)
    : insertItem(prev, row);
}

function applyDependency(
  prev: BoardCache,
  p: RealtimePostgresChangesPayload<CacheDependency>,
): BoardCache {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheDependency>;
    return oldRow.id ? removeDependency(prev, oldRow.id) : prev;
  }
  return addDependency(prev, p.new as CacheDependency); // idempotent on id (echo-safe)
}

function applyColumn(
  prev: BoardCache,
  p: RealtimePostgresChangesPayload<CacheColumn>,
): BoardCache {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheColumn>;
    return oldRow.id ? removeColumn(prev, oldRow.id) : prev;
  }
  const row = p.new as CacheColumn;
  return prev.columns.some((c) => c.id === row.id)
    ? replaceColumn(prev, row)
    : insertColumn(prev, row);
}

function applyGroup(
  prev: BoardCache,
  p: RealtimePostgresChangesPayload<CacheGroup>,
): BoardCache {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheGroup>;
    return { ...prev, groups: prev.groups.filter((g) => g.id !== oldRow.id) };
  }
  const row = p.new as CacheGroup;
  return prev.groups.some((g) => g.id === row.id)
    ? replaceGroup(prev, row)
    : insertGroup(prev, row);
}

/**
 * Fold a batch of realtime events over the board cache in order, returning the
 * new cache and the flash events for changed cells. Pure — no React, no query
 * client — so it is exhaustively unit-testable. The hook buffers events and
 * calls this once per animation frame.
 */
export function foldBoardEvents(
  prev: BoardCache,
  events: BoardRealtimeEvent[],
): { next: BoardCache; flashes: BoardFlash[] } {
  let next = prev;
  const flashes: BoardFlash[] = [];
  for (const ev of events) {
    switch (ev.table) {
      case "cell_values":
        next = applyCell(next, ev.payload, flashes);
        break;
      case "items":
        next = applyItem(next, ev.payload);
        break;
      case "item_dependencies":
        next = applyDependency(next, ev.payload);
        break;
      case "columns":
        next = applyColumn(next, ev.payload);
        break;
      case "groups":
        next = applyGroup(next, ev.payload);
        break;
    }
  }
  return { next, flashes };
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm vitest run src/lib/boards/realtime-buffer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing hook test (coalescing)**

`src/lib/boards/use-board-realtime.test.tsx`:

```tsx
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// Capture the postgres_changes handlers the hook registers, keyed by table.
const handlers = new Map<string, (p: unknown) => void>();
const channel = {
  on(_event: string, opts: { table: string }, cb: (p: unknown) => void) {
    handlers.set(opts.table, cb);
    return channel;
  },
  subscribe() {
    return channel;
  },
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => channel,
    removeChannel: vi.fn(),
  }),
}));

import { useBoardRealtime } from "./use-board-realtime";
import { boardKey } from "./use-board-cache";

describe("useBoardRealtime coalescing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("applies N synchronous cell events in one setQueryData per frame", () => {
    const qc = new QueryClient();
    qc.setQueryData(boardKey("b1"), {
      board: { id: "b1" },
      groups: [],
      columns: [],
      items: [],
      cellValues: [],
      views: [],
      dependencies: [],
      attachments: [],
      timeEntries: [],
      relationLinks: [],
      mirrorTargetCells: [],
      mirrorTargetColumns: [],
    });
    const setSpy = vi.spyOn(qc, "setQueryData");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const onRemoteChange = vi.fn();
    renderHook(() => useBoardRealtime("b1", { onRemoteChange }), { wrapper });

    const fireCell = handlers.get("cell_values")!;
    act(() => {
      fireCell({
        eventType: "UPDATE",
        new: {
          item_id: "i1",
          column_id: "c1",
          value: { text: "a" },
          board_id: "b1",
        },
        old: {},
      });
      fireCell({
        eventType: "UPDATE",
        new: {
          item_id: "i2",
          column_id: "c1",
          value: { text: "b" },
          board_id: "b1",
        },
        old: {},
      });
    });
    expect(setSpy).not.toHaveBeenCalled(); // buffered, not yet flushed

    act(() => void vi.advanceTimersToNextFrame());
    expect(setSpy).toHaveBeenCalledTimes(1); // single coalesced flush
    const cache = qc.getQueryData(boardKey("b1")) as { cellValues: unknown[] };
    expect(cache.cellValues).toHaveLength(2);
    expect(onRemoteChange).toHaveBeenCalledTimes(2); // one flash per changed cell
  });
});
```

> If `vi.advanceTimersToNextFrame()` is unavailable, use `vi.advanceTimersByTime(20)`.

- [ ] **Step 6: Run it — verify it fails**

Run: `pnpm vitest run src/lib/boards/use-board-realtime.test.tsx`
Expected: FAIL — current hook calls `setQueryData` synchronously per event (`setSpy` called twice, before any frame), so the "not yet flushed" / "once" assertions fail.

- [ ] **Step 7: Rewrite `use-board-realtime.ts` to buffer + flush per frame**

Replace the whole file with:

```ts
"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { BoardCache } from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";
import {
  foldBoardEvents,
  type BoardRealtimeEvent,
} from "@/lib/boards/realtime-buffer";

/**
 * Subscribe one Realtime channel for the board, reconciling cell_values + items
 * (+ groups/columns/deps) changes into the ["board", boardId] cache. Incoming
 * events are BUFFERED and applied in a single setQueryData per animation frame,
 * so a burst of edits from many concurrent collaborators causes one re-render
 * per frame instead of one per event. Echo-dedupe of our own optimistic writes
 * and the onRemoteChange flash callback are preserved (see realtime-buffer.ts).
 */
export function useBoardRealtime(
  boardId: string,
  opts?: {
    onRemoteChange?: (e: { targetId: string; valueChanged: boolean }) => void;
  },
) {
  const qc = useQueryClient();
  // Keep latest callback in a ref so a new identity each render does NOT
  // resubscribe the channel (effect deps stay [boardId, qc]).
  const cbRef = useRef(opts?.onRemoteChange);
  useEffect(() => {
    cbRef.current = opts?.onRemoteChange;
  });

  useEffect(() => {
    const supabase = createClient();
    const filter = `board_id=eq.${boardId}`;
    const key = boardKey(boardId);

    const buffer: BoardRealtimeEvent[] = [];
    let frame: number | null = null;

    function flush() {
      frame = null;
      if (buffer.length === 0) return;
      const events = buffer.splice(0, buffer.length);
      const prev = qc.getQueryData<BoardCache>(key);
      if (!prev) return; // board cache not hydrated yet → drop (page seeds it)
      const { next, flashes } = foldBoardEvents(prev, events);
      if (next !== prev) qc.setQueryData<BoardCache>(key, next);
      for (const f of flashes) cbRef.current?.(f);
    }

    function enqueue(ev: BoardRealtimeEvent) {
      buffer.push(ev);
      if (frame == null) frame = requestAnimationFrame(flush);
    }

    const channel = supabase
      .channel(`board:${boardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cell_values", filter },
        (payload) => enqueue({ table: "cell_values", payload }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "items", filter },
        (payload) => enqueue({ table: "items", payload }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_dependencies", filter },
        (payload) => enqueue({ table: "item_dependencies", payload }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "columns", filter },
        (payload) => enqueue({ table: "columns", payload }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "groups", filter },
        (payload) => enqueue({ table: "groups", payload }),
      )
      .subscribe();

    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      buffer.length = 0;
      supabase.removeChannel(channel);
    };
  }, [boardId, qc]);
}
```

> Note the `.on(...)` callbacks pass `payload` straight through with a `table` tag — the per-table reducer logic now lives in `foldBoardEvents`. TypeScript infers each `payload` from the table literal; if the inference needs a nudge, cast at the `enqueue({ table: "...", payload })` site to the matching `BoardRealtimeEvent` member.

- [ ] **Step 8: Run it — verify it passes**

Run: `pnpm vitest run src/lib/boards/use-board-realtime.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 9: Run both WS3 test files + typecheck**

Run: `pnpm vitest run src/lib/boards/realtime-buffer.test.ts src/lib/boards/use-board-realtime.test.tsx && pnpm typecheck`
Expected: PASS; no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/boards/realtime-buffer.ts src/lib/boards/realtime-buffer.test.ts \
  src/lib/boards/use-board-realtime.ts src/lib/boards/use-board-realtime.test.tsx
git commit -m "perf(boards): coalesce realtime changes into one flush per frame" -m "Incoming postgres_changes are buffered and applied via a single setQueryData per animation frame, so concurrent multi-user editing causes one re-render per frame instead of one per event. Per-table reconciliation extracted into the pure, fully-tested foldBoardEvents; echo-dedupe and the onRemoteChange flash callback preserved.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Refactor board presence onto `useThrottledCallback`

**Files:**

- Modify: `src/lib/boards/use-board-presence.ts` (the `throttleRef` block, ~81-93)

**Interfaces:**

- Consumes: `useThrottledCallback` from `@/lib/hooks/use-throttled-callback` (Task 1).
- Produces: `useBoardPresence` unchanged signature/behavior.

- [ ] **Step 1: Confirm the existing presence tests pass (baseline guard)**

Run: `pnpm vitest run src/lib/boards/use-board-presence.test.ts`
Expected: PASS. (If no such file exists, run `pnpm vitest run src/lib/boards` to capture the presence-related suite as the baseline.) These tests are the behavioral-equivalence guard for this refactor — they must stay green.

- [ ] **Step 2: Edit `use-board-presence.ts`**

Add the import near the top:

```ts
import { useThrottledCallback } from "@/lib/hooks/use-throttled-callback";
```

Replace the `throttleRef` + `setFocus` block (currently ~81-93):

```ts
const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const setFocus = useCallback(
  (focus: PresenceFocus | null) => {
    focusRef.current = focus;
    setSelfFocusTargetId(focus?.targetId ?? null);
    if (throttleRef.current) return;
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null;
      void channelRef.current?.track(buildState(focusRef.current));
    }, 150);
  },
  [buildState],
);
```

with:

```ts
// Trailing-throttle the presence broadcast to ≤1 per 150ms; the synchronous
// focusRef update + local highlight happen on every call so self-focus stays
// instant. The throttled tracker reads the latest focus via focusRef.
const trackFocus = useThrottledCallback(() => {
  void channelRef.current?.track(buildState(focusRef.current));
}, 150);
const setFocus = useCallback(
  (focus: PresenceFocus | null) => {
    focusRef.current = focus;
    setSelfFocusTargetId(focus?.targetId ?? null);
    trackFocus();
  },
  [trackFocus],
);
```

(Behavior is identical: first call schedules a single trailing broadcast 150ms later that reads the latest focus; intermediate calls are coalesced.)

- [ ] **Step 3: Run the presence tests — verify still green**

Run: `pnpm vitest run src/lib/boards/use-board-presence.test.ts`
Expected: PASS (unchanged behavior). If the file does not exist, run `pnpm vitest run src/lib/boards`.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. (`useRef`/`useCallback` may now be unused imports — remove any that ESLint/tsc flags.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/use-board-presence.ts
git commit -m "refactor(boards): presence throttle uses shared timing hook" -m "Replace the hand-rolled setTimeout throttle with useThrottledCallback (identical trailing-edge 150ms semantics). No behavior change; the presence tests remain the guard.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Refactor dashboard layout debounce onto `useDebouncedCallback`

**Files:**

- Modify: `src/components/dashboards/DashboardCanvas.tsx` (the `timer` ref + `onLayoutChange`, ~38, ~81-97)

**Interfaces:**

- Consumes: `useDebouncedCallback` from `@/lib/hooks/use-debounced-callback` (Task 1).
- Produces: `DashboardCanvas` unchanged behavior.

- [ ] **Step 1: Edit `DashboardCanvas.tsx`**

Add the import:

```ts
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
```

Remove the manual timer ref (line ~38):

```ts
const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Replace `onLayoutChange` (~81-97) with a debounced persist:

```ts
// Persist 600ms after the last drag/resize. onMutate patches the cache
// immediately, so no data refetch happens here.
const persistRects = useDebouncedCallback(
  (rects: GridRect[]) => persistLayout.mutate(rects),
  600,
);
const onLayoutChange = useCallback(
  (next: Layout) => {
    if (!editing) return; // ignore layout events while in view mode
    persistRects(
      next.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h })),
    );
  },
  [editing, persistRects],
);
```

> `persistLayout.mutate` expects the rect array; confirm the `GridRect[]` element shape (`{ id, x, y, w, h }`) matches `persistLayout.mutate`'s parameter (it does — this is the same array previously passed). If `useRef` becomes unused, remove it from the React import.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Run the dashboard-canvas tests (if present) + lint**

Run: `pnpm vitest run src/components/dashboards && pnpm lint`
Expected: PASS; no lint errors. (If there is no DashboardCanvas test, the typecheck + build gate covers compilation; the debounce hook itself is unit-tested in Task 1.)

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboards/DashboardCanvas.tsx
git commit -m "refactor(dashboards): layout debounce uses shared timing hook" -m "Replace the hand-rolled setTimeout debounce with useDebouncedCallback (identical 600ms trailing debounce). No behavior change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Smooth column-resize drag with `useRafCallback`

**Files:**

- Modify: `src/components/boards/BoardTable.tsx` (`NameResizeHandle`, ~828-871)

**Interfaces:**

- Consumes: `useRafCallback` from `@/lib/hooks/use-raf-callback` (Task 1).
- Produces: `NameResizeHandle` unchanged props/behavior; live resize updates coalesced to one per frame.

- [ ] **Step 1: Edit `NameResizeHandle` in `BoardTable.tsx`**

Ensure the import is present at the top of the file (add if missing):

```ts
import { useRafCallback } from "@/lib/hooks/use-raf-callback";
```

In `NameResizeHandle`, wrap `onResize` so per-pixel pointer moves collapse to one update per frame. Change the body to:

```ts
function NameResizeHandle({
  width,
  onResize,
  onResizeEnd,
  onAutoFit,
}: {
  width: number;
  onResize: (w: number) => void;
  onResizeEnd: (w: number) => void;
  onAutoFit: () => void;
}) {
  // Coalesce per-pixel live-width updates to one state update per frame so the
  // drag stays smooth; the persist-on-release path (onResizeEnd) is unchanged.
  const throttledResize = useRafCallback(onResize);

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = width;
    const move = (ev: PointerEvent) => {
      last = clampDragWidth(
        startW + (ev.clientX - startX),
        NAME_DRAG_MIN,
        NAME_COL_MAX,
      );
      throttledResize(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onResizeEnd(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Name column (double-click to auto-fit)"
      onPointerDown={onPointerDown}
      onDoubleClick={onAutoFit}
      className="hover:bg-primary/40 absolute top-0 right-0 h-full w-1 cursor-col-resize"
    />
  );
}
```

(`onResizeEnd(last)` still fires once on release with the final width, so the persisted value is exact even if the last live frame was coalesced.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Run the board-table tests (if present) + lint**

Run: `pnpm vitest run src/components/boards && pnpm lint`
Expected: PASS; no lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/boards/BoardTable.tsx
git commit -m "perf(boards): coalesce live column-resize to one update per frame" -m "Wrap the Name-column resize handle's live onResize in useRafCallback so per-pixel pointer moves collapse to one state update per animation frame, keeping the drag smooth. Persist-on-release is unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **Run the full gate suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. `pnpm test` runs the `unit` project (jsdom). Integration suites may be flaky / hit the shared DB — if a `*.integration.test.ts` fails, confirm it is unrelated to this slice (none of these files touch integration paths) before proceeding.

- [ ] **Manual smoke (human acceptance — see handover):** open a board in two browsers, edit cells from one, confirm the other updates smoothly; drag the Name-column resize handle; drag a dashboard widget in edit mode; move the cursor across cells (presence). All should feel smooth with no regressions.

---

## Self-Review

**Spec coverage:**

- WS1 shared primitives → Task 1 (all three hooks, tested). ✓
- WS1b refactor existing timers → Tasks 4 (presence), 5 (dashboard). ✓
- WS1c column-resize → Task 6. ✓
- WS1d filter/search audit → covered by the manual smoke + the fact that cmdk filters locally (no code change needed; noted in spec). ✓
- WS2 drop redundant auth + cache() payloads → Task 2. ✓
- WS3 coalesce realtime → Task 3. ✓
- Out-of-scope items (9.3 cache layer, 9.4/9.5/9.6) → untouched. ✓

**Placeholder scan:** No "TBD"/"TODO"/"handle edge cases"; every code step shows full code; every test step shows the assertions. The two `> Note` callouts are version-fallback guidance, not placeholders. ✓

**Type consistency:** `BoardRealtimeEvent`, `BoardFlash`, `foldBoardEvents` are defined in Task 3 and consumed only there. `useDebouncedCallback`/`useThrottledCallback`/`useRafCallback` signatures defined in Task 1 match their consumers in Tasks 4/5/6. `getUser(): Promise<SessionUser | null>` consumed in Task 2 matches `@/lib/auth/session`. `GridRect` shape `{ id, x, y, w, h }` consistent in Task 5. ✓
