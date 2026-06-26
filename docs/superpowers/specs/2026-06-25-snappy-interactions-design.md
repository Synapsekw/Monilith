# Phase 9.5a — Interaction Responsiveness Pass — design

**Status:** approved design — ready for plan.
**Date:** 2026-06-25
**Parent:** `docs/superpowers/specs/2026-06-22-phase-9-performance-optimization-design.md` (Phase 9 umbrella).
**Slice:** an **additive** responsiveness pass that sits on top of the shipped 9.1 (auth fast-path), 9.2 (streaming shell) and 9.3 (cached shell reads). It closes three concrete gaps the existing specs do **not** cover: no shared debounce/throttle primitive, uncoalesced realtime re-renders under concurrent editing, and redundant per-request auth network calls on the hot board path.

## Motivation

The reported symptom: the authenticated app feels heavier than the landing, **especially when other users are active from different computers**. An audit of the current responsiveness mechanisms (read-only, 2026-06-25) found that most of the obvious levers are already in place — virtualised board/kanban (`@tanstack/react-virtual`), presence broadcasts throttled to 150ms, dashboard-layout drag debounced 600ms, cell editors commit on blur/Enter (not per keystroke), realtime echo-dedup, heavy `useMemo`, and `React.cache()` on the session reads. React 19's compiler covers most `React.memo` needs automatically.

Three real gaps remain, and they map directly onto the request (debouncing, caching, memoization, multi-user snappiness):

1. **No shared debounce/throttle primitive.** The two throttles that exist are hand-rolled `setTimeout`s, copy-pasted. The remaining unthrottled hot spot — column-resize live drag — has nothing.
2. **Realtime `postgres_changes` are applied one-at-a-time.** Each remote edit from another user does its own `setQueryData` → its own re-render. A burst of edits from several collaborators is a re-render storm. **This is the direct cause of the "slow when others are active" symptom.**
3. **Redundant network auth calls on the board path.** `getBoardAccess`, `listMyBoards`, `listSharedBoards` in `src/lib/boards/queries.ts` each call `supabase.auth.getUser()` — a **network** round-trip to the Supabase auth server — even though the page already verified the same user via the cached, local `getClaims`-based `requireUser()`/`getUser()`. The heavy detail fetchers (`getBoardPayload`, `getDashboardPayload`) are also not per-request memoised.

## Current-state evidence (from the audit — file:line)

- **Presence throttle (exists):** `src/lib/boards/use-board-presence.ts:81-93` — manual `setTimeout` 150ms.
- **Dashboard layout debounce (exists):** `src/components/dashboards/DashboardCanvas.tsx:81-97` — manual `setTimeout` 600ms.
- **Column-resize live drag (unthrottled):** `src/components/boards/BoardTable.tsx` — `NameColumnResizer` calls `onResize` per pointer event → `setLiveNameWidth(w)` per pixel (~lines 823-860, 1140-1141). Persist (`onResizeEnd` → `resizeColumn`) already fires once on release.
- **No shared util:** there is no `useDebounce`/`useThrottle` in `src/lib/`.
- **Realtime applied per-event:** `src/lib/boards/use-board-realtime.ts:54-176` — five `postgres_changes` subscriptions (cell_values, items, item_dependencies, columns, groups), each handler calls `patch()` → `qc.setQueryData()` synchronously per event. Echo-dedup (`use-board-realtime.ts:71-79`) and an `onRemoteChange` flash callback (`:83-88`) exist and must be preserved.
- **Redundant network auth:** `src/lib/boards/queries.ts:48-67` (`listMyBoards`), `:70-98` (`listSharedBoards`), `:100-123` (`getBoardAccess`) each `await supabase.auth.getUser()`. `getBoardAccess` is on the board-page hot path (`src/app/(app)/boards/[boardId]/page.tsx:30-37`, in parallel with `getBoardPayload` + members + grants).
- **Cached session helper to reuse:** `src/lib/auth/session.ts` exports `getUser()` (React-`cache()`-wrapped, `getClaims` local verify) and `requireUser()`.
- **9.3 cache layer (do NOT touch):** `src/lib/boards/queries-cached.ts`, `src/lib/dashboards/queries-cached.ts`, `src/lib/workspaces/queries-cached.ts` — `use cache` + `cacheTag` over the **service client** with explicit tenant filters; consumed by `src/components/shell/sidebar-nav-data.tsx` + `command-palette-data.tsx`. These are already optimal and out of scope.

## Core realisation

Two different cache layers already coexist and must not be conflated:

- **`use cache` (Next Cache Components):** cross-request, tenant-keyed, tagged — for the **shell list reads** (9.3, done).
- **`React.cache()`:** per-request dedup — for **live per-request reads** (session helpers today; board/dashboard payloads here).

The board/dashboard **detail** payloads are live data — they cannot use `use cache` (would serve a collaborator stale data, and they read request cookies). They are the right home for `React.cache()` per-request dedup, and their redundant `auth.getUser()` calls are the right thing to replace with the already-cached local-verify session.

For realtime, the fix is not to drop events but to **coalesce** them: buffer incoming `postgres_changes` and apply them in a single `setQueryData` per animation frame. The cache reducers are already pure functions over `BoardCache` (`upsertCellValue`, `replaceItem`, etc. in `src/lib/boards/cache.ts`), so composing N buffered mutations into one flush is a mechanical fold — no semantic change, just one re-render per frame instead of N.

## Workstream 1 — Shared debounce/throttle primitives (+ apply)

**1a. Create the hooks.** New files under `src/lib/hooks/`:

- `use-debounced-callback.ts` → `useDebouncedCallback<A extends unknown[]>(fn: (...a: A) => void, delayMs: number): (...a: A) => void` — trailing-edge debounce; the returned callback has stable identity (safe in deps); pending timer cleared on unmount; latest `fn` kept in a ref so callers don't have to memoise it.
- `use-throttled-callback.ts` → `useThrottledCallback<A>(fn, intervalMs)` — leading-call + trailing-flush throttle matching the existing presence semantics (fire immediately is **not** required by presence — presence drops intermediate calls within the window and flushes the latest on the trailing edge; the hook replicates exactly that to keep behavior identical). Stable identity; cleanup on unmount.
- Optional `use-raf-callback.ts` (or a `rafThrottle` option on the throttle hook) → coalesce to one call per animation frame via `requestAnimationFrame`, for the column-resize drag. Decide during implementation whether this is a third hook or a `{ raf: true }` mode; keep one obvious primitive per timing strategy.

Each hook is co-located with a Vitest test (`*.test.ts`) using fake timers (`vi.useFakeTimers()`); rAF tested via a stubbed `requestAnimationFrame`.

**1b. Refactor the two existing hand-rolled timers** to consume the new hooks, asserting identical behavior:

- `src/lib/boards/use-board-presence.ts` — replace the `throttleRef` block with `useThrottledCallback(track, 150)`. Presence behavior (drop intermediate, flush latest) must be byte-for-byte equivalent; the existing presence tests must still pass.
- `src/components/dashboards/DashboardCanvas.tsx` — replace the `timer` debounce with `useDebouncedCallback(persistLayout.mutate, 600)`.

**1c. Apply to the unthrottled hot spot:** in `BoardTable.tsx`, wrap the live `setLiveNameWidth` update from `NameColumnResizer.onResize` in the rAF throttle so per-pixel pointer events collapse to one state update per frame. `onResizeEnd` → `resizeColumn` persist is unchanged.

**1d. Filter/search inputs:** the command palette filters locally (cmdk, no network) — no change. During build, confirm no board filter/search text input fires a Server Action or expensive recompute per keystroke; if one is found, debounce it with the new hook. (Expected: none — noted so the build verifies rather than assumes.)

## Workstream 2 — Faster server render (per-request dedup)

**2a. Remove redundant network auth.** In `src/lib/boards/queries.ts`, replace `await supabase.auth.getUser()` with the cached local-verify session in:

- `getBoardAccess` — the hot-path win (board page, every load).
- `listMyBoards`, `listSharedBoards` — the non-cached originals (still used by any caller not on the 9.3 cached path).

Use `getUser()` from `src/lib/auth/session.ts` (React-`cache()` + `getClaims`, per-request memoised) for the user id; keep the existing data queries and the early-return-on-null behavior identical. **Security note:** these reads stay RLS-scoped via the cookie-bound `createClient()` — we only change _how the user id is obtained_ (cached local verify vs. fresh network), not the tenant boundary. The `getClaims` scope decision from 9.1 (local verify for normal routes) already governs this path.

**2b. Per-request memoise the detail payloads.** Wrap `getBoardPayload` (`queries.ts`) and `getDashboardPayload` (`src/lib/dashboards/queries.ts`) in `React.cache()`. Harmless when called once; prevents a double round-trip if a layout, `generateMetadata`, or a future parallel reader hits the same id in one request. No staleness risk — `React.cache()` is per-request only.

## Workstream 3 — Smooth multi-user editing (coalesce realtime)

In `src/lib/boards/use-board-realtime.ts`, replace per-event `setQueryData` with a **per-frame microbatch**:

- Maintain a mutable buffer of pending mutations `Array<(prev: BoardCache) => BoardCache>` and a set of changed `targetId`s for the flash callback, in refs (no re-render on buffer push).
- Each handler (`onCell`/`onItem`/`onDependency`/`onColumn`/`onGroup`) pushes its reducer into the buffer instead of calling `patch()` directly. Echo-dedup stays where it is cheap to evaluate eagerly (cell value equality) — but because equality needs `prev`, the cleanest design is: handlers push a _typed event_; the single flush folds all buffered events over the current `BoardCache` in order, applying echo-dedup during the fold (so dedup still sees the latest committed cache). Collect changed cell `targetId`s during the fold.
- Schedule a flush via `requestAnimationFrame` (fallback `setTimeout(…, 16)` for jsdom/tests) when the buffer goes from empty → non-empty; on flush, do **one** `qc.setQueryData()` that applies the folded reducer, clear the buffer, then emit the collected `onRemoteChange` callbacks.
- On channel teardown / unmount, cancel any pending frame and drop the buffer.

Result: under N concurrent remote edits in one frame, exactly **one** re-render instead of N. Ordering within a frame is preserved (FIFO fold). Echo-dedup and LWW flash highlighting behave as before.

This is the change that directly addresses the reported "slow when others are active from different computers."

## Performance & data-fetching budget (AGENTS.md rule #5)

- **First paint vs. interaction:** WS1 and WS3 are **client-only** re-render/timing changes — **0 new server round-trips** on any interaction (in-page edits, drags, incoming realtime). WS2 _removes_ server round-trips (one fewer auth network call per board load; dedups detail reads).
- **Server data change?** No mutation semantics change anywhere. Column-resize still persists via its existing Server Action on release; realtime only changes _how_ already-arriving events are applied to the client cache.
- **Bounded/indexed hot-path reads?** Unchanged — `getBoardPayload` keeps its existing bounds (attachments 200, time_entries 1000, relation_links 2000, mirror cells 4000) and indexes.
- **Net effect:** lower INP under concurrent editing (WS3), lower TTFB/render cost (WS2), smoother drag (WS1). Latency added by realtime coalescing is ≤1 animation frame (~16ms) before a remote edit appears — imperceptible. No bytes added to the critical client bundle (the hooks are tiny; they replace existing inline timers).

## Testing strategy (AGENTS.md rule #4)

Stack already present: Vitest (`unit`, jsdom) + `@testing-library/react`. Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

- **WS1 hooks:** unit tests with `vi.useFakeTimers()` — debounce fires once after quiet period and uses latest args; throttle drops intermediate calls and flushes the latest on the trailing edge; rAF variant coalesces to one call per frame; all clear pending timers on unmount (no leak / no post-unmount fire). Stable-identity assertion (same reference across renders).
- **WS1 refactors:** existing presence and dashboard-canvas tests must still pass unchanged (behavioral-equivalence guard). Add a focused test that the column-resize live update is coalesced (rAF stubbed → multiple `onResize` calls produce one state update per frame).
- **WS2:** test `getBoardAccess`/`listMyBoards`/`listSharedBoards` no longer call `auth.getUser()` (mock the supabase client; assert `auth.getUser` not invoked and the cached session is used) and return the same shapes for owner/editor/viewer/none. Test that `getBoardPayload`/`getDashboardPayload` wrapped in `cache()` issue a single underlying read when called twice in one request (mock client call-count).
- **WS3:** the core test — feed several `postgres_changes` payloads synchronously, advance the stubbed rAF/timer once, assert `setQueryData` ran **once** and the resulting cache reflects all events in order; assert echo (no-op value) produces no flash callback; assert a real change emits exactly one `onRemoteChange` with the right `targetId`; assert teardown cancels a pending flush.

## Independent units / Execution DAG (AGENTS.md rule #6)

File footprints are disjoint except WS1's internal hook→consumer dependency:

- **WS1-hooks:** `src/lib/hooks/*` (new) — _produces_ the primitives.
- **WS1-consumers:** `use-board-presence.ts`, `DashboardCanvas.tsx`, `BoardTable.tsx` — _consume_ WS1-hooks.
- **WS2:** `src/lib/boards/queries.ts`, `src/lib/dashboards/queries.ts` — independent.
- **WS3:** `src/lib/boards/use-board-realtime.ts` — independent.

```
Batch 1 (parallel):  [WS1-hooks]   [WS2]   [WS3]
                          │
Batch 2 (parallel):  [WS1-consumers: presence | dashboard | board-resizer]
```

- **Dependency edges:** WS1-consumers depend on WS1-hooks. WS2 and WS3 depend on nothing in this slice.
- **Parallel batches:** Batch 1 = {WS1-hooks, WS2, WS3} (three concurrent agents, disjoint files). Batch 2 = the three WS1-consumer refactors (concurrent; each touches a distinct file).
- **Critical path:** WS1-hooks → WS1-consumers (2 waves). WS2/WS3 finish within Batch 1.

All tasks are TDD (tests written and executed before/with implementation). Subagents operate inside this worktree (`task/snappy-interactions`).

## Risks & decisions

- **Risk — realtime fold changes echo-dedup timing.** Folding buffered events over a single `prev` means dedup compares against the last _committed_ cache, not intermediate buffered state. For cell values this is correct (last-write-wins within a frame is the desired result) and matches today's behavior at frame granularity. Mitigation: explicit ordering test (WS3).
- **Risk — presence behavioral drift.** The throttle hook must replicate "drop intermediate, flush latest on trailing edge" exactly, or remote cursors stutter. Mitigation: existing presence tests are the guard; refactor must keep them green.
- **Decision — `React.cache()` for live payloads, `use cache` left to 9.3.** Per-request dedup for live reads; cross-request tenant cache stays the 9.3 layer, untouched.
- **Decision — rAF for coalescing, `setTimeout(16)` fallback** so the logic is testable in jsdom and degrades gracefully where rAF is absent.
- **Decision — keep the persist-on-release Server Action for column resize.** WS1c only smooths the _live_ visual width; it does not change when/how the width is saved.

## Out of scope (YAGNI)

- Phase 9.4 skeletons, 9.5 bundle-splitting / code-splitting, 9.6 Web-Vitals gate — separate slices.
- Any change to the 9.3 `queries-cached.ts` / `use cache` layer.
- Realtime _server-side_ changes (channel topology, RLS, publication filters) — this slice is purely client-side coalescing.
- Adding `React.memo` broadly — React 19's compiler handles it; not needed.
- Batching cell _writes_ (mutations) — out of scope; writes are already single optimistic mutations on commit.
