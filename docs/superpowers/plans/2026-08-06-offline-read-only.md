# Offline Read-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boards you have already opened stay readable with no network, every write clearly refused, healing automatically on reconnect.

**Architecture:** A service worker serves a precached `/offline` document for any navigation that fails. That route restores a user-namespaced IndexedDB snapshot of the exact props `BoardViews` was last rendered with, and re-renders it with `access="viewer"` — the read-only mode the board already has. Writes are refused by an `assertOnline()` guard at the top of every `mutationFn`, enforced by a static-analysis test. The online RSC path is not modified.

**Tech Stack:** Next.js 16 (App Router, `cacheComponents: true`), React 19, TanStack Query v5, `@tanstack/react-query-persist-client`, `idb-keyval`, Vitest, Playwright.

## Global Constraints

- **No offline writes, ever.** No queue, no local mutation log, no conflict resolution. A write attempted offline is refused, not deferred.
- **Boards only.** Dashboards, settings, goals, reports, `/ask` and the agent dock are online-only. The `/offline` route does not route to them.
- **One time window: 7 days.** Cache `maxAge`, session-staleness wipe, and entitlement grace all use the same constant. Never introduce a second number.
- **Persistence is allowlisted.** Only the `boardSnapshot` query key is written to disk. Everything else — AI streams, widget previews, agent run history, notifications — is excluded by default.
- **The cache is namespaced by user id and wiped on sign-out.** It is not encrypted at rest.
- **Zero new server round-trips on the online path.** No RSC query is added, moved, or duplicated. The service worker registers after load, on idle.
- **Never cache-first a real HTML document.** Only content-hashed `/_next/static/**` and the single `/offline` document are precached.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must pass before merge.
- **Workflow:** this is a building session — work in a worktree via `scripts/start-task.sh offline-read-only`, and close with `scripts/finish-task.sh`. Commit identity is pinned to `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage by explicit path; never `git add -A`.

---

## File Structure

**Created**

| File                                                | Responsibility                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `src/lib/offline/constants.ts`                      | The single 7-day window and the offline copy string              |
| `src/lib/offline/online-status.ts`                  | `isOnline`, `assertOnline`, `useOnlineStatus`                    |
| `src/lib/offline/persister.ts`                      | User-namespaced IndexedDB persister + key allowlist              |
| `src/lib/offline/wipe.ts`                           | `wipeOfflineData()` — IndexedDB + service-worker caches          |
| `src/lib/offline/snapshot.ts`                       | `boardSnapshotKey`, the `BoardSnapshot` type, `useBoardSnapshot` |
| `src/lib/offline/entitlement.ts`                    | Cached entitlement + 7-day grace evaluation                      |
| `src/components/offline/OfflinePersistence.tsx`     | Mounts persistence against the live QueryClient (write-only)     |
| `src/components/offline/OfflineBanner.tsx`          | The "You're offline" bar                                         |
| `src/components/offline/ServiceWorkerRegistrar.tsx` | Registers `/sw.js` after load on idle                            |
| `src/components/offline/OfflineBoard.tsx`           | Restores a snapshot and renders `BoardViews` read-only           |
| `src/app/offline/page.tsx`                          | The precached offline entry document                             |
| `public/sw.js`                                      | Service worker: static precache + navigation fallback            |
| `public/desktop-release.json`                       | Version contract consumed by the desktop shell (Plan 2)          |
| `e2e/offline.spec.ts`                               | End-to-end offline read, refused write, reconnect heal           |

**Modified**

| File                                                      | Change                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/lib/boards/mutations/*.ts` (8 files)                 | `assertOnline();` as the first statement of every `mutationFn`    |
| `src/lib/collaboration/use-*-mutations.ts` (4)            | same                                                              |
| `src/lib/dashboards/use-dashboard-mutations.ts`           | same                                                              |
| `src/lib/boards/use-bulk-mutations.ts`                    | same                                                              |
| `src/components/boards/automations/AutopilotCard.tsx`     | same                                                              |
| `src/components/boards/automations/AutomationsDialog.tsx` | same                                                              |
| `src/components/boards/BoardViews.tsx`                    | Mount `OfflinePersistence` + `useBoardSnapshot` + `OfflineBanner` |
| `src/components/shell/user-menu.tsx`                      | Wipe offline data before the sign-out action runs                 |
| `src/app/manifest.ts`                                     | Correct the "offline is out of scope" comment                     |

**Deliberately NOT modified:** `src/lib/boards/use-board-cache.ts`. The spec anticipated making `initialData` optional; the snapshot design removes that need, so the online board cache is untouched.

---

### Task 1: Online-status primitives

**Files:**

- Create: `src/lib/offline/constants.ts`
- Create: `src/lib/offline/online-status.ts`
- Test: `src/lib/offline/online-status.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `OFFLINE_WINDOW_MS: number`, `OFFLINE_MESSAGE: string`, `LAST_USER_KEY: string`, `ENTITLEMENT_KEY: string` from `@/lib/offline/constants`; `isOnline(): boolean`, `assertOnline(): void`, `useOnlineStatus(): boolean` from `@/lib/offline/online-status`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/offline/online-status.test.ts`:

```ts
import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { OFFLINE_MESSAGE } from "./constants";
import { assertOnline, isOnline } from "./online-status";

describe("assertOnline", () => {
  afterEach(() => onlineManager.setOnline(true));

  it("throws the offline message when offline", () => {
    onlineManager.setOnline(false);
    expect(() => assertOnline()).toThrow(OFFLINE_MESSAGE);
  });

  it("does not throw when online", () => {
    onlineManager.setOnline(true);
    expect(() => assertOnline()).not.toThrow();
  });

  it("isOnline tracks the manager", () => {
    onlineManager.setOnline(false);
    expect(isOnline()).toBe(false);
    onlineManager.setOnline(true);
    expect(isOnline()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/offline/online-status.test.ts`
Expected: FAIL — cannot resolve `./constants` / `./online-status`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/offline/constants.ts`:

```ts
/**
 * The ONE offline time window. Cache `maxAge`, session-staleness wipe and the
 * entitlement grace period all read this constant. Two numbers would drift and
 * produce a state where the cache survives but the entitlement does not (or
 * vice versa), which is unreasonable to debug — see the plan's Global
 * Constraints.
 */
export const OFFLINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Single source for the refusal copy, asserted by tests and shown in toasts. */
export const OFFLINE_MESSAGE = "You're offline — reconnect to make changes.";

/**
 * localStorage keys. They live here rather than in `entitlement.ts` because the
 * `/offline` route reads `LAST_USER_KEY` and must not import the entitlement
 * module — that would make the offline entry point depend on billing.
 */
export const LAST_USER_KEY = "monolith.offline.userId";
export const ENTITLEMENT_KEY = "monolith.offline.entitlement";
```

Create `src/lib/offline/online-status.ts`:

```ts
"use client";

import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { OFFLINE_MESSAGE } from "./constants";

/**
 * Connectivity is read from TanStack's `onlineManager` rather than
 * `navigator.onLine` directly: it is the same signal the query layer already
 * uses for retry/pause decisions, so the UI and the cache can never disagree
 * about whether we are online.
 */
export function isOnline(): boolean {
  return onlineManager.isOnline();
}

/**
 * Guard for every `mutationFn`. THROWS rather than returning an `ActionResult`
 * failure: TanStack treats a thrown error as the mutation's error path, which
 * is what fires the existing targeted rollback and the `showMutationError`
 * toast. A returned value would look like success to `useMutation`, leaving the
 * optimistic patch applied over data that was never written.
 */
export function assertOnline(): void {
  if (!onlineManager.isOnline()) throw new Error(OFFLINE_MESSAGE);
}

/**
 * Subscribe a component to connectivity. The server snapshot is `true` so the
 * server-rendered markup always matches the client's first paint; assuming
 * offline during SSR would produce a hydration mismatch (the failure shape of
 * gotcha-50).
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project unit src/lib/offline/online-status.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline/constants.ts src/lib/offline/online-status.ts src/lib/offline/online-status.test.ts
git commit -m "feat(offline): add online-status primitives and the shared 7-day window"
```

---

### Task 2: Refuse every mutation while offline

Sixteen files declare `useMutation`. Each `mutationFn` gains `assertOnline();` as its **first statement**. A static-analysis test then makes the rule permanent.

**Files:**

- Modify: `src/lib/boards/mutations/board.ts`, `cells.ts`, `columns.ts`, `files.ts`, `groups.ts`, `items.ts`, `relations.ts`, `time.ts`
- Modify: `src/lib/boards/use-bulk-mutations.ts`
- Modify: `src/lib/collaboration/use-attachment-mutations.ts`, `use-notification-mutations.ts`, `use-update-mutations.ts`, `use-invitation-mutations.ts`
- Modify: `src/lib/dashboards/use-dashboard-mutations.ts`
- Modify: `src/components/boards/automations/AutopilotCard.tsx`, `AutomationsDialog.tsx`
- Test: `src/lib/offline/mutation-guard.test.ts`

**Interfaces:**

- Consumes: `assertOnline()` from `@/lib/offline/online-status` (Task 1).
- Produces: nothing importable. Produces an invariant: every `mutationFn` in `src/` begins with `assertOnline();`.

- [ ] **Step 1: Write the failing guard test**

Create `src/lib/offline/mutation-guard.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

/**
 * Every `mutationFn` in the codebase must refuse to run offline, or a user with
 * no network gets an optimistic patch that silently never persists. Reviewers
 * cannot hold that rule across 16 files and every future one, so it is a test.
 *
 * Regex literals are constructed fresh at each use and none carry the `g` flag
 * into `.test()`. A global regex reused across `.test()` calls advances
 * `lastIndex` between calls and starts skipping matches — that is
 * gotcha-72, which has shipped three times in this repo.
 */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((p) => /\.tsx?$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p))
    .map((p) => join(SRC, p));
}

const MUTATION_FN_ARROW = /mutationFn:\s*async\s*\([^)]*\)\s*=>\s*\{/g;

describe("offline mutation guard", () => {
  it("every mutationFn opens with assertOnline()", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("useMutation")) continue;

      for (const match of src.matchAll(MUTATION_FN_ARROW)) {
        const body = src.slice(match.index + match[0].length);
        const firstStatement = body.trimStart().split("\n")[0].trim();
        if (firstStatement !== "assertOnline();") {
          offenders.push(`${file.slice(SRC.length)} → "${firstStatement}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("recognises the form of every declared mutationFn", () => {
    // A guard that silently skips an unrecognised syntax is worse than no
    // guard: it reports green over an unguarded mutation. If someone writes a
    // `mutationFn` this matcher cannot parse, fail here and widen the matcher.
    const mismatches: string[] = [];

    for (const file of sourceFiles()) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("useMutation")) continue;

      const declared = [...src.matchAll(/mutationFn:/g)].length;
      const recognised = [...src.matchAll(MUTATION_FN_ARROW)].length;
      if (declared !== recognised) {
        mismatches.push(
          `${file.slice(SRC.length)}: ${declared} declared, ${recognised} recognised`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/offline/mutation-guard.test.ts`
Expected: FAIL — the first test lists ~74 offenders.

- [ ] **Step 3: Add the guard to every mutation module**

In each of the 16 files, add the import and the first statement. Worked example for `src/lib/boards/mutations/cells.ts`:

```ts
import { assertOnline } from "@/lib/offline/online-status";
```

then, in each `mutationFn`:

```ts
const setCellMutation = useMutation<unknown, Error, SetCellVars, Ctx>({
  mutationFn: async (vars) => {
    assertOnline();
    const res = await upsertCell(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  // onMutate / onError / onSettled unchanged
});
```

Apply the identical two-line change to every `mutationFn` in all 16 files. Do not restructure anything else — `onMutate`, `onError`, rollback and toast behaviour stay exactly as they are. The existing `onError` already calls `showMutationError`, so the offline refusal surfaces through the toast path that is already tested.

- [ ] **Step 4: Run the guard and the full board mutation suite**

Run: `pnpm vitest run --project unit src/lib/offline/mutation-guard.test.ts src/lib/boards`
Expected: PASS. Both guard tests green and no board mutation regression.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline/mutation-guard.test.ts src/lib/boards/mutations src/lib/boards/use-bulk-mutations.ts src/lib/collaboration src/lib/dashboards/use-dashboard-mutations.ts src/components/boards/automations
git commit -m "feat(offline): refuse every mutation while offline, enforced by a guard test"
```

---

### Task 3: User-namespaced IndexedDB persister

**Files:**

- Create: `src/lib/offline/persister.ts`
- Create: `src/lib/offline/wipe.ts`
- Test: `src/lib/offline/persister.test.ts`
- Modify: `package.json` (two dependencies)

**Interfaces:**

- Consumes: `OFFLINE_WINDOW_MS` from `@/lib/offline/constants` (Task 1).
- Produces:
  - `PERSISTED_KEY_PREFIXES: readonly string[]`
  - `isPersistableKey(key: readonly unknown[]): boolean`
  - `createOfflinePersister(userId: string): Persister`
  - `persistOptionsFor(userId: string): { persister: Persister; maxAge: number; dehydrateOptions: { shouldDehydrateQuery: (q: Query) => boolean } }`
  - `wipeOfflineData(): Promise<void>` from `@/lib/offline/wipe`

- [ ] **Step 1: Install dependencies**

```bash
pnpm add @tanstack/react-query-persist-client idb-keyval
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/offline/persister.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isPersistableKey } from "./persister";

describe("isPersistableKey", () => {
  it("persists the board snapshot", () => {
    expect(isPersistableKey(["boardSnapshot", "abc"])).toBe(true);
  });

  it("refuses everything not on the allowlist", () => {
    // Persisting these would write AI conversation text, widget aggregations
    // and notification bodies to disk for a capability that only needs boards.
    expect(isPersistableKey(["board", "abc"])).toBe(false);
    expect(isPersistableKey(["notifications", "u1"])).toBe(false);
    expect(isPersistableKey(["agent-runs", "a1"])).toBe(false);
    expect(isPersistableKey(["widget-data", "w1"])).toBe(false);
  });

  it("refuses a non-string first segment", () => {
    expect(isPersistableKey([42])).toBe(false);
    expect(isPersistableKey([])).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/offline/persister.test.ts`
Expected: FAIL — cannot resolve `./persister`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/offline/persister.ts`:

```ts
"use client";

import type { Query } from "@tanstack/react-query";
import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import { OFFLINE_WINDOW_MS } from "./constants";

/**
 * The ONLY query keys written to disk. Offline is scoped to reading boards, so
 * nothing else earns a copy in unencrypted local storage. Adding a prefix here
 * is a deliberate act with a privacy consequence — see the plan's Global
 * Constraints before extending it.
 */
export const PERSISTED_KEY_PREFIXES = ["boardSnapshot"] as const;

/** Base IndexedDB key; the real key is suffixed with the user id. */
const IDB_KEY_BASE = "monolith-offline";

export function offlineIdbKey(userId: string): string {
  return `${IDB_KEY_BASE}:${userId}`;
}

export function isPersistableKey(key: readonly unknown[]): boolean {
  const head = key[0];
  return (
    typeof head === "string" &&
    (PERSISTED_KEY_PREFIXES as readonly string[]).includes(head)
  );
}

/**
 * Namespaced by user id so signing in as someone else on a shared machine can
 * never restore the previous account's boards. Sign-out wipes it outright
 * (see `wipeOfflineData`); the namespace is the second line of defence.
 */
export function createOfflinePersister(userId: string): Persister {
  const key = offlineIdbKey(userId);
  return {
    persistClient: (client: PersistedClient) => set(key, client),
    restoreClient: () => get<PersistedClient>(key),
    removeClient: () => del(key),
  };
}

export function persistOptionsFor(userId: string) {
  return {
    persister: createOfflinePersister(userId),
    maxAge: OFFLINE_WINDOW_MS,
    dehydrateOptions: {
      shouldDehydrateQuery: (query: Query) =>
        query.state.status === "success" && isPersistableKey(query.queryKey),
    },
  };
}
```

Create `src/lib/offline/wipe.ts`:

```ts
"use client";

import { clear } from "idb-keyval";

/**
 * Remove every trace of offline data. Called on sign-out BEFORE the server
 * action redirects, and whenever a stale session is detected at boot.
 *
 * Clears the whole idb-keyval store rather than one namespaced key: at
 * sign-out we want any other account's leftovers gone too, and this store holds
 * nothing but offline snapshots. Service-worker caches go with it, otherwise
 * the precached `/offline` document would still be served to the next user.
 */
export async function wipeOfflineData(): Promise<void> {
  await clear().catch(() => undefined);

  if (typeof caches !== "undefined") {
    const keys = await caches.keys().catch(() => [] as string[]);
    await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run --project unit src/lib/offline/persister.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/offline/persister.ts src/lib/offline/wipe.ts src/lib/offline/persister.test.ts
git commit -m "feat(offline): add a user-namespaced IndexedDB persister with a key allowlist"
```

---

### Task 4: Snapshot the board's render props

`BoardCache` is not enough to re-render a board: `BoardViews` reads `payload.views` (line 138) and `BoardCache` has no `views` field. So the snapshot stores the exact props `BoardViews` was rendered with.

**Files:**

- Create: `src/lib/offline/snapshot.ts`
- Create: `src/components/offline/OfflinePersistence.tsx`
- Modify: `src/components/boards/BoardViews.tsx`
- Test: `src/lib/offline/snapshot.test.ts`

**Interfaces:**

- Consumes: `persistOptionsFor` from `@/lib/offline/persister` (Task 3).
- Produces:
  - `boardSnapshotKey(boardId: string): readonly ["boardSnapshot", string]`
  - `type BoardSnapshot = { payload: BoardPayload; members: EditorMember[]; initialViewId: string; currentUserId: string; savedAt: number }`
  - `useBoardSnapshot(snapshot: Omit<BoardSnapshot, "savedAt">): void`
  - `<OfflinePersistence userId={string} />`

- [ ] **Step 1: Write the failing test**

Create `src/lib/offline/snapshot.test.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { boardSnapshotKey, useBoardSnapshot, type BoardSnapshot } from "./snapshot";

const payload = { board: { id: "b1", org_id: "o1" }, views: [{ id: "v1" }] };

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useBoardSnapshot", () => {
  it("writes the render props under the board snapshot key", () => {
    const qc = new QueryClient();
    renderHook(
      () =>
        useBoardSnapshot({
          payload: payload as never,
          members: [],
          initialViewId: "v1",
          currentUserId: "u1",
        }),
      { wrapper: wrapper(qc) },
    );

    const stored = qc.getQueryData<BoardSnapshot>(boardSnapshotKey("b1"));
    expect(stored?.initialViewId).toBe("v1");
    expect(stored?.currentUserId).toBe("u1");
    expect(stored?.payload.views).toHaveLength(1);
    expect(typeof stored?.savedAt).toBe("number");
  });
});
```

Rename the file to `snapshot.test.tsx` because it contains JSX.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/offline/snapshot.test.tsx`
Expected: FAIL — cannot resolve `./snapshot`.

- [ ] **Step 3: Write the snapshot module**

Create `src/lib/offline/snapshot.ts`:

```ts
"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { EditorMember } from "@/components/boards/cells/editors";
import type { BoardPayload } from "@/lib/boards/queries";

/**
 * The exact props `BoardViews` needs to render. Deliberately NOT `BoardCache`:
 * that type is the client mirror of the cell/item data and carries no `views`,
 * which `BoardViews` reads to resolve the active view. Storing the render props
 * makes prop-completeness true by construction rather than by remembering.
 */
export type BoardSnapshot = {
  payload: BoardPayload;
  members: EditorMember[];
  initialViewId: string;
  currentUserId: string;
  savedAt: number;
};

export function boardSnapshotKey(boardId: string) {
  return ["boardSnapshot", boardId] as const;
}

/**
 * Record the board's render props into the query cache, from where the
 * persister writes them to IndexedDB. This is a cache WRITE only — it issues no
 * request and does not participate in the board's own query, so it adds zero
 * server round-trips (working agreement #5).
 */
export function useBoardSnapshot(
  snapshot: Omit<BoardSnapshot, "savedAt">,
): void {
  const qc = useQueryClient();
  const boardId = snapshot.payload.board.id;

  useEffect(() => {
    qc.setQueryData<BoardSnapshot>(boardSnapshotKey(boardId), {
      ...snapshot,
      savedAt: Date.now(),
    });
    // `snapshot` is a fresh object each render; keying the effect on the board
    // id plus the view id keeps the write to once per meaningful change rather
    // than once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, boardId, snapshot.initialViewId]);
}
```

- [ ] **Step 4: Write the persistence mount**

Create `src/components/offline/OfflinePersistence.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { persistQueryClientSubscribe } from "@tanstack/react-query-persist-client";
import { persistOptionsFor } from "@/lib/offline/persister";

/**
 * Attaches the persister to the LIVE QueryClient without restructuring the
 * provider tree.
 *
 * Subscribe-only, by design: it never calls `persistQueryClientRestore`.
 * Restoring here would hydrate a disk snapshot over a board the server just
 * seeded via `initialData`, replacing fresh data with older data on every
 * online load. Restoration happens only on the `/offline` route, which is the
 * one place there is no fresher source.
 */
export function OfflinePersistence({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    return persistQueryClientSubscribe({
      queryClient,
      ...persistOptionsFor(userId),
    });
  }, [queryClient, userId]);

  return null;
}
```

- [ ] **Step 5: Mount both in `BoardViews`**

In `src/components/boards/BoardViews.tsx`, add the imports:

```tsx
import { OfflinePersistence } from "@/components/offline/OfflinePersistence";
import { useBoardSnapshot } from "@/lib/offline/snapshot";
```

Immediately after the existing `useBoardCache(...)` call on line 92, add:

```tsx
// Record what this board needs to re-render with no network. `currentUserId`
// is already a prop here, so persistence needs no layout change and no extra
// read to learn who is signed in.
useBoardSnapshot({ payload, members, initialViewId, currentUserId });
```

and render `<OfflinePersistence userId={currentUserId} />` as the first child of the component's returned tree.

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run --project unit src/lib/offline src/components/boards`
Expected: PASS. No board component regression.

- [ ] **Step 7: Commit**

```bash
git add src/lib/offline/snapshot.ts src/lib/offline/snapshot.test.tsx src/components/offline/OfflinePersistence.tsx src/components/boards/BoardViews.tsx
git commit -m "feat(offline): snapshot board render props and persist them to IndexedDB"
```

---

### Task 5: Wipe offline data on sign-out

`signOut` is a Server Action that redirects, so it cannot clear browser storage. The wipe must happen client-side before the action fires.

**Files:**

- Modify: `src/components/shell/user-menu.tsx`
- Test: `src/components/shell/user-menu.test.tsx`

**Interfaces:**

- Consumes: `wipeOfflineData()` from `@/lib/offline/wipe` (Task 3).
- Produces: nothing importable.

- [ ] **Step 1: Write the failing test**

Add to `src/components/shell/user-menu.test.tsx`:

```tsx
const wipeOfflineData = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/offline/wipe", () => ({ wipeOfflineData }));

it("wipes offline data before signing out", async () => {
  render(<UserMenu /* existing required props from the suite's helper */ />);
  await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
  expect(wipeOfflineData).toHaveBeenCalledTimes(1);
});
```

Match the existing suite's render helper and prop shape rather than inventing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit src/components/shell/user-menu.test.tsx`
Expected: FAIL — `wipeOfflineData` not called.

- [ ] **Step 3: Wire the wipe into the sign-out form**

In `src/components/shell/user-menu.tsx`, replace the bare `<form action={signOut}>` with a wrapper that clears local data first:

```tsx
<form
  action={async () => {
    // Must run before the action redirects: a Server Action cannot reach
    // IndexedDB or the Cache API, so this is the only point at which the
    // signed-out user's boards can be removed from disk.
    await wipeOfflineData();
    await signOut();
  }}
>
```

and import it:

```tsx
import { wipeOfflineData } from "@/lib/offline/wipe";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project unit src/components/shell/user-menu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/user-menu.tsx src/components/shell/user-menu.test.tsx
git commit -m "feat(offline): wipe cached boards from disk on sign-out"
```

---

### Task 6: Service worker and registrar

**Files:**

- Create: `public/sw.js`
- Create: `src/components/offline/ServiceWorkerRegistrar.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/manifest.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: a registered service worker serving `/offline` for failed navigations; `<ServiceWorkerRegistrar />`.

- [ ] **Step 1: Write the service worker**

Create `public/sw.js`:

```js
// Monolith offline service worker.
//
// TWO rules, both load-bearing:
//   1. Only content-hashed assets are cache-first. `/_next/static/**` filenames
//      change whenever their contents change, so a stale entry is impossible.
//   2. NO real HTML document is ever cached. Caching a document cache-first is
//      how a service worker pins users to a dead build. The single exception is
//      `/offline`, which is a static client-only shell with no user data in it.
const CACHE = "monolith-offline-v1";
const OFFLINE_URL = "/offline";
const NAV_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" }))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), ms),
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Content-hashed build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Navigations: network-first with a short timeout, falling back to the
  // offline shell. Never cache the real document.
  if (request.mode === "navigate") {
    event.respondWith(
      Promise.race([fetch(request), timeout(NAV_TIMEOUT_MS)]).catch(() =>
        caches.match(OFFLINE_URL).then((hit) => hit || Response.error()),
      ),
    );
  }
});
```

- [ ] **Step 2: Write the registrar**

Create `src/components/offline/ServiceWorkerRegistrar.tsx`:

```tsx
"use client";

import { useEffect } from "react";

/**
 * Registers the service worker AFTER load, on idle. Registering during
 * hydration would have it competing with the board's own JavaScript for the
 * main thread on exactly the paint the performance budget protects.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration costs offline support, never the app itself.
      });
    };

    const idle = window.requestIdleCallback?.bind(window);
    if (idle) {
      const handle = idle(register, { timeout: 5000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const t = window.setTimeout(register, 2000);
    return () => window.clearTimeout(t);
  }, []);

  return null;
}
```

- [ ] **Step 3: Mount it in the authenticated layout**

In `src/app/(app)/layout.tsx`, import and render it alongside `<Toaster />`:

```tsx
import { ServiceWorkerRegistrar } from "@/components/offline/ServiceWorkerRegistrar";
```

```tsx
      <AuthenticatedShell>{children}</AuthenticatedShell>
      <Toaster />
      <ServiceWorkerRegistrar />
```

Mounted in `(app)` and not the root layout on purpose: anonymous landing-page visitors get no service worker and no behaviour change.

- [ ] **Step 4: Correct the manifest comment**

In `src/app/manifest.ts`, replace the sentence `Offline is out of scope — no service worker references here.` with:

```
// Offline support IS now in scope (read-only boards, see the 2026-08-05 desktop
// spec and its ADR). The service worker is registered imperatively from
// `(app)/layout.tsx`, not referenced here — this manifest stays pure and
// synchronous so it keeps prerendering statically with no env requirement.
```

- [ ] **Step 5: Verify the build emits the worker**

Run: `pnpm build && ls -l .next/static > /dev/null && test -f public/sw.js && echo OK`
Expected: build succeeds, `OK`.

- [ ] **Step 6: Commit**

```bash
git add public/sw.js src/components/offline/ServiceWorkerRegistrar.tsx "src/app/(app)/layout.tsx" src/app/manifest.ts
git commit -m "feat(offline): add the service worker and register it on idle"
```

---

### Task 7: The `/offline` entry route

**Files:**

- Create: `src/app/offline/page.tsx`
- Create: `src/components/offline/OfflineBoard.tsx`
- Create: `src/components/offline/OfflineBanner.tsx`
- Test: `src/components/offline/OfflineBoard.test.tsx`

**Interfaces:**

- Consumes: `boardSnapshotKey`, `BoardSnapshot` (Task 4); `persistOptionsFor` (Task 3); `useOnlineStatus` (Task 1).
- Produces: the route `/offline`.

- [ ] **Step 1: Write the failing test**

Create `src/components/offline/OfflineBoard.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-query-persist-client", () => ({
  persistQueryClientRestore: vi.fn().mockResolvedValue(undefined),
}));

const boardViewsProps = vi.fn();
vi.mock("@/components/boards/BoardViews", () => ({
  BoardViews: (props: Record<string, unknown>) => {
    boardViewsProps(props);
    return <div data-testid="board-views" />;
  },
}));

import { OfflineBoard } from "./OfflineBoard";
import { boardSnapshotKey } from "@/lib/offline/snapshot";

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("OfflineBoard", () => {
  it("renders a cached board as a viewer", async () => {
    const qc = new QueryClient();
    qc.setQueryData(boardSnapshotKey("b1"), {
      payload: { board: { id: "b1", org_id: "o1" }, views: [{ id: "v1" }] },
      members: [],
      initialViewId: "v1",
      currentUserId: "u1",
      savedAt: Date.now(),
    });

    render(<OfflineBoard boardId="b1" userId="u1" />, { wrapper: wrap(qc) });

    expect(await screen.findByTestId("board-views")).toBeInTheDocument();
    // Read-only is not a new mode — it is the board's existing viewer access.
    expect(boardViewsProps).toHaveBeenCalledWith(
      expect.objectContaining({ access: "viewer" }),
    );
  });

  it("says so when the board was never cached", async () => {
    const qc = new QueryClient();
    render(<OfflineBoard boardId="never-opened" userId="u1" />, {
      wrapper: wrap(qc),
    });
    expect(
      await screen.findByText(/isn't available offline/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit src/components/offline/OfflineBoard.test.tsx`
Expected: FAIL — cannot resolve `./OfflineBoard`.

- [ ] **Step 3: Write the banner**

Create `src/components/offline/OfflineBanner.tsx`:

```tsx
"use client";

import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/offline/online-status";

/** Persistent bar shown whenever the app cannot reach the network. */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      className="bg-muted text-muted-foreground flex items-center gap-2 border-b px-4 py-2 text-sm"
    >
      <WifiOff className="size-4" aria-hidden />
      <span>
        You&rsquo;re offline. This board is read-only until you reconnect.
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Write the offline board**

Create `src/components/offline/OfflineBoard.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { persistQueryClientRestore } from "@tanstack/react-query-persist-client";
import { BoardViews } from "@/components/boards/BoardViews";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { persistOptionsFor } from "@/lib/offline/persister";
import { boardSnapshotKey, type BoardSnapshot } from "@/lib/offline/snapshot";

/**
 * Renders a board with no server. This is the ONE place that restores the
 * persisted cache — everywhere else the RSC payload is fresher.
 *
 * `access="viewer"` is the whole read-only story: the board already threads
 * `BoardAccess` into all four view renderers and derives `canEdit = access !==
 * "viewer"` (see `BoardTableInner.tsx`). Offline reuses that rather than
 * introducing a second, parallel notion of read-only that would drift.
 */
export function OfflineBoard({
  boardId,
  userId,
}: {
  boardId: string;
  userId: string;
}) {
  const qc = useQueryClient();
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void persistQueryClientRestore({
      queryClient: qc,
      ...persistOptionsFor(userId),
    })
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [qc, userId]);

  if (!restored) {
    return (
      <div role="status" aria-busy="true" className="p-6">
        <div className="bg-muted h-8 w-48 animate-pulse rounded-md" />
      </div>
    );
  }

  const snapshot = qc.getQueryData<BoardSnapshot>(boardSnapshotKey(boardId));

  if (!snapshot) {
    return (
      <div className="text-muted-foreground p-6 text-sm">
        <OfflineBanner />
        <p className="pt-4">
          This board isn&rsquo;t available offline. Open it once while connected
          and it will be here next time.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <OfflineBanner />
      {/* min-w-0 for the same reason the online board page carries it: board
          tables have a min-width and would otherwise push the PAGE sideways. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <BoardViews
          payload={snapshot.payload}
          members={snapshot.members}
          initialViewId={snapshot.initialViewId}
          currentUserId={snapshot.currentUserId}
          access="viewer"
          grants={[]}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the route**

Create `src/app/offline/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { OfflineBoard } from "@/components/offline/OfflineBoard";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { LAST_USER_KEY } from "@/lib/offline/constants";

/**
 * The document the service worker serves for any navigation that fails.
 *
 * Client-only and free of user data: it is precached, so anything baked into
 * its markup would be readable by the next person to use the machine. It reads
 * the attempted path from `location` after mount — during prerender there is no
 * URL to read, and guessing one would be a hydration mismatch.
 */
export default function OfflinePage() {
  const [target, setTarget] = useState<{
    boardId: string;
    userId: string;
  } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const match = /^\/boards\/([0-9a-f-]{36})/.exec(window.location.pathname);
    const userId = window.localStorage.getItem(LAST_USER_KEY);
    if (match && userId) setTarget({ boardId: match[1], userId });
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!target) {
    return (
      <div className="p-6">
        <OfflineBanner />
        <p className="text-muted-foreground pt-4 text-sm">
          You&rsquo;re offline. Boards you have already opened are available;
          everything else needs a connection.
        </p>
      </div>
    );
  }

  return <OfflineBoard boardId={target.boardId} userId={target.userId} />;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run --project unit src/components/offline`
Expected: PASS, both tests.

- [ ] **Step 7: Commit**

```bash
git add src/app/offline src/components/offline
git commit -m "feat(offline): serve cached boards read-only from an /offline entry route"
```

---

### Task 8: Entitlement grace and the identity marker

**Files:**

- Create: `src/lib/offline/entitlement.ts`
- Test: `src/lib/offline/entitlement.test.ts`
- Modify: `src/components/offline/OfflinePersistence.tsx`

**Interfaces:**

- Consumes: `OFFLINE_WINDOW_MS` (Task 1), `wipeOfflineData` (Task 3).
- Produces: `type CachedEntitlement = { plan: string; status: string; checkedAt: number }`, `isWithinGrace(e: CachedEntitlement | null, now: number): boolean`, `rememberIdentity(userId: string): void`, `readEntitlement(): CachedEntitlement | null`, `writeEntitlement(e: CachedEntitlement): void`, `enforceOfflineGrace(now: number): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/offline/entitlement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { OFFLINE_WINDOW_MS } from "./constants";
import { isWithinGrace } from "./entitlement";

const NOW = 1_700_000_000_000;

describe("isWithinGrace", () => {
  it("accepts an active entitlement checked just now", () => {
    expect(
      isWithinGrace({ plan: "pro", status: "active", checkedAt: NOW }, NOW),
    ).toBe(true);
  });

  it("accepts one checked one minute inside the window", () => {
    const checkedAt = NOW - OFFLINE_WINDOW_MS + 60_000;
    expect(
      isWithinGrace({ plan: "pro", status: "active", checkedAt }, NOW),
    ).toBe(true);
  });

  it("rejects one checked one minute outside the window", () => {
    const checkedAt = NOW - OFFLINE_WINDOW_MS - 60_000;
    expect(
      isWithinGrace({ plan: "pro", status: "active", checkedAt }, NOW),
    ).toBe(false);
  });

  it("rejects a non-active status even when freshly checked", () => {
    expect(
      isWithinGrace({ plan: "pro", status: "canceled", checkedAt: NOW }, NOW),
    ).toBe(false);
  });

  it("rejects a missing entitlement", () => {
    expect(isWithinGrace(null, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/offline/entitlement.test.ts`
Expected: FAIL — cannot resolve `./entitlement`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/offline/entitlement.ts`:

```ts
"use client";

import { ENTITLEMENT_KEY, LAST_USER_KEY, OFFLINE_WINDOW_MS } from "./constants";
import { wipeOfflineData } from "./wipe";

/**
 * Shape E6 (billing) must expose so the app can be used offline. Persisted
 * verbatim; `checkedAt` is when we last confirmed it with the server.
 */
export type CachedEntitlement = {
  plan: string;
  status: string;
  checkedAt: number;
};

/**
 * Offline access is honoured for `OFFLINE_WINDOW_MS` past the last successful
 * check — the same window as the cache `maxAge`, so a snapshot never outlives
 * the entitlement that justified keeping it.
 */
export function isWithinGrace(
  entitlement: CachedEntitlement | null,
  now: number,
): boolean {
  if (!entitlement) return false;
  if (entitlement.status !== "active") return false;
  return now - entitlement.checkedAt <= OFFLINE_WINDOW_MS;
}

export function rememberIdentity(userId: string): void {
  window.localStorage.setItem(LAST_USER_KEY, userId);
}

export function readEntitlement(): CachedEntitlement | null {
  try {
    const raw = window.localStorage.getItem(ENTITLEMENT_KEY);
    return raw ? (JSON.parse(raw) as CachedEntitlement) : null;
  } catch {
    return null;
  }
}

export function writeEntitlement(entitlement: CachedEntitlement): void {
  window.localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(entitlement));
}

/**
 * Wipe everything if the cached entitlement has aged out of its grace window.
 * Returns whether offline use is still permitted.
 *
 * Until E6 lands there is no entitlement to write, so `readEntitlement()`
 * returns null and this is a no-op that permits offline use — the gate is wired
 * and tested, waiting only for a producer. That is deliberate: retro-fitting the
 * gate after billing ships is how it gets forgotten.
 */
export async function enforceOfflineGrace(now: number): Promise<boolean> {
  const entitlement = readEntitlement();
  if (!entitlement) return true;
  if (isWithinGrace(entitlement, now)) return true;
  await wipeOfflineData();
  return false;
}
```

- [ ] **Step 4: Record identity where persistence mounts**

In `src/components/offline/OfflinePersistence.tsx`, extend the effect so the offline route can learn who was last signed in:

```tsx
import {
  enforceOfflineGrace,
  rememberIdentity,
} from "@/lib/offline/entitlement";
```

```tsx
useEffect(() => {
  rememberIdentity(userId);
  void enforceOfflineGrace(Date.now());
  return persistQueryClientSubscribe({
    queryClient,
    ...persistOptionsFor(userId),
  });
}, [queryClient, userId]);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run --project unit src/lib/offline`
Expected: PASS, all offline unit suites.

- [ ] **Step 6: Commit**

```bash
git add src/lib/offline/entitlement.ts src/lib/offline/entitlement.test.ts src/components/offline/OfflinePersistence.tsx
git commit -m "feat(offline): gate offline use on a cached entitlement with a 7-day grace"
```

---

### Task 9: Publish the desktop version contract

Plan 2's shell reads this file at boot to decide whether it is too old to run. It lives in this repo because it describes what the deployed web app supports.

**Files:**

- Create: `public/desktop-release.json`
- Test: `src/app/desktop-release.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `GET /desktop-release.json` → `{ minSupportedShell: string; latestShell: string; notes: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/app/desktop-release.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop-release.json", () => {
  it("declares semver-shaped shell versions", () => {
    const raw = readFileSync(
      join(process.cwd(), "public", "desktop-release.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // The shell hard-blocks when it is below `minSupportedShell`, so a typo
    // here bricks every installed desktop app. Shape is asserted, not assumed.
    expect(typeof parsed.minSupportedShell).toBe("string");
    expect(typeof parsed.latestShell).toBe("string");
    expect(parsed.minSupportedShell).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.latestShell).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit src/app/desktop-release.test.ts`
Expected: FAIL — ENOENT.

- [ ] **Step 3: Create the file**

Create `public/desktop-release.json`:

```json
{
  "minSupportedShell": "1.0.0",
  "latestShell": "1.0.0",
  "notes": "Read by the Monolith desktop shell at boot. A shell older than minSupportedShell blocks with an update prompt. Static and public by design: it carries no user data and must be reachable before sign-in."
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project unit src/app/desktop-release.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/desktop-release.json src/app/desktop-release.test.ts
git commit -m "feat(desktop): publish the shell version contract"
```

---

### Task 10: End-to-end offline acceptance

**Files:**

- Create: `e2e/offline.spec.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: the acceptance proof for the whole plan.

- [ ] **Step 1: Write the spec**

Create `e2e/offline.spec.ts`, following the sign-in helper used by `e2e/boards.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.describe("offline read-only", () => {
  test("a visited board stays readable, refuses writes, and heals on reconnect", async ({
    page,
    context,
  }) => {
    // Reuse whatever sign-in helper e2e/boards.spec.ts uses; do not invent one.
    await page.goto("/boards");
    await page.getByRole("link", { name: /.+/ }).first().click();
    await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}/);
    const boardUrl = page.url();

    // The service worker registers on idle and the snapshot is written in an
    // effect — give both a beat before cutting the network.
    await page.waitForTimeout(3000);

    await context.setOffline(true);
    await page.reload();

    // The board still renders, from the persisted snapshot.
    await expect(page.getByRole("status")).toContainText(/offline/i);
    await expect(page.getByRole("table").first()).toBeVisible();

    // And it renders as a viewer: no add-item affordance.
    await expect(page.getByRole("button", { name: /add item/i })).toHaveCount(
      0,
    );

    await context.setOffline(false);
    await page.goto(boardUrl);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("table").first()).toBeVisible();
  });

  test("a board never opened is honest about it", async ({ page, context }) => {
    await page.goto("/boards");
    await page.waitForTimeout(3000);
    await context.setOffline(true);
    await page.goto("/boards/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText(/isn't available offline/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm e2e e2e/offline.spec.ts`
Expected: PASS, 2 tests. If the "add item" locator does not match this board's markup, fix the locator against the real DOM — do not weaken the assertion to `toBeVisible()`-optional.

- [ ] **Step 3: Run all four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. `pnpm test` should report the previous total plus the new offline suites.

- [ ] **Step 4: Commit**

```bash
git add e2e/offline.spec.ts
git commit -m "test(e2e): prove offline boards read, refuse writes, and heal on reconnect"
```

- [ ] **Step 5: Write the ADRs the spec owes**

The spec owes three ADRs. Write all three — the second is time-sensitive and must exist before E6/Stripe starts.

1. `vault/decisions/2026-08-06-decision-35-offline-read-only-reverses-no-service-worker.md` — `src/app/manifest.ts`'s "offline is out of scope" is reversed; read-only reuses `access="viewer"` rather than a parallel mode; the cache is namespaced-and-wiped rather than encrypted.
2. `vault/decisions/2026-08-06-decision-36-desktop-ships-as-a-notarized-direct-download.md` — **not** the Mac App Store, because MAS mandates Apple IAP at 30%/15% on subscriptions. State plainly that choosing MAS later invalidates E6's Stripe integration.
3. `vault/decisions/2026-08-06-decision-37-electron-over-tauri-for-the-desktop-shell.md` — Tauri renders in WKWebView on macOS and `playwright.config` declares only a `chromium` project, so there is no coverage that would catch a divergence. Record the revisit condition: a real WebKit suite.

```bash
git add vault/decisions/2026-08-06-decision-3{5,6,7}-*.md
git commit -m "docs(adr): record the offline reversal, direct-download distribution and Electron choice"
```

- [ ] **Step 6: Finish the task**

Run: `scripts/finish-task.sh`
Expected: rebase onto `develop`, four gates green, merge, worktree removed, branch deleted.

---

## Execution DAG

| Task | Depends on |
| ---- | ---------- |
| 1    | —          |
| 2    | 1          |
| 3    | 1          |
| 4    | 3          |
| 5    | 3          |
| 6    | —          |
| 7    | 1, 3, 4    |
| 8    | 1, 3, 4    |
| 9    | —          |
| 10   | all        |

| Batch | Tasks   | Notes                                |
| ----- | ------- | ------------------------------------ |
| 1     | 1, 6, 9 | Three concurrent agents              |
| 2     | 2, 3    | Both consume Task 1                  |
| 3     | 4, 5    | Both consume Task 3                  |
| 4     | 7, 8    | Both consume Task 4                  |
| 5     | 10      | Serialising: gates, e2e, ADR, finish |

**Critical path:** 1 → 3 → 4 → 7 → 10.

## How to test (manual acceptance, post-merge)

1. Pull `develop`, `pnpm install`, `pnpm build && pnpm start`. Sign in.
2. Open two or three boards so they are cached. Wait a few seconds on each.
3. In DevTools → Application → Service Workers, confirm `sw.js` is activated.
4. Turn off Wi-Fi. Reload a board you opened. It renders, with an offline bar.
5. Try to edit a cell, add an item, and drag a card. Each is refused with "You're offline — reconnect to make changes." Nothing appears to succeed and then revert.
6. Navigate to a board you never opened — it says so honestly.
7. Turn Wi-Fi back on. The bar clears. Have someone else edit an item and confirm you see it without a manual reload.
8. Sign out, then go offline and reload. No cached board is reachable. Confirm IndexedDB is empty in DevTools → Application → Storage.
