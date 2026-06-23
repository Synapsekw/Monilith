# Phase 9.2 — Streaming Shell (Next 16 PPR / Cache Components) — design

**Status:** approved design — awaiting user review before plan.
**Date:** 2026-06-23
**Parent:** `docs/superpowers/specs/2026-06-22-phase-9-performance-optimization-design.md` (umbrella, §9.2).
**Prerequisite:** 9.1 (auth fast-path / `getClaims`) — **shipped**. `src/lib/auth/session.ts` already verifies the JWT locally; this design builds on it.
**Verified against:** Next.js **16.2.9** docs in `node_modules/next/dist/docs/` — `01-getting-started/08-caching.md`, `02-guides/streaming.md`, `02-guides/migrating-to-cache-components.md`, `02-guides/instant-navigation.md`, `03-api-reference/.../route-segment-config/instant.md`. (AGENTS.md warns this Next.js differs from training data; every API below was read from the installed docs, not memory.)

---

## 1. Problem & goal

Today every authenticated section layout (`boards`, `dashboards`, `goals`, `portfolios`, `settings`, `workload`, `admin`) is an **async server component that `await`s a `Promise.all` of 6–8 per-user queries before returning any JSX**. Nothing — not even the static sidebar frame or header bar — paints until the slowest of those queries resolves. The shell is the chrome the user stares at on every navigation; making it block on data is the single biggest perceived-speed cost in the app.

**Goal:** prerender the **static app chrome** (sidebar rail + frame, header bar structure, static nav links) into the PPR static shell so it paints instantly from the edge, and **stream the per-user data** (board/dashboard/workspace nav lists, notifications bell, user menu) into `<Suspense>` boundaries with content-shaped skeleton fallbacks. This is the bridge between Track A (actual speed) and Track B (perceived speed) in the umbrella design.

**Non-goal (explicitly deferred to 9.3):** caching the per-user lists with `use cache`. See §6.

---

## 2. Current-state facts (verified in-repo)

- **`next.config.ts`** has **no** `cacheComponents` / `experimental.ppr`. Adding it is step 1.
- **8 section layouts** each `await` a near-identical block: `getUserOrgs()`, `listMyBoards()`, `listSharedBoards()`, `listDashboards()`, `supabase.from("workspaces").select("id,name")`, `isPlatformAdmin()`, `getUserTimeZone()`, and (5 of 8) `isOrgAdmin()`. All block before returning JSX. (`admin` additionally gates with `requirePlatformAdmin()`.)
- **`AppShell`** (`src/components/app-shell.tsx`, 154 LOC) is a **server component**: a 3-region frame (`<Sidebar>` | header+`<main>` | `<CommandPalette>`). It receives `user`, `currentUserId`, `boards`, `sharedBoards`, `dashboards`, `workspaces`, `isPlatformAdmin`, `isOrgAdmin` as props. The header renders `CommandTrigger` (static), `ThemeToggle` (static), **`NotificationsBell` (needs `currentUserId`)**, and **`UserMenu` (needs `user` + `isPlatformAdmin`)**.
- **`Sidebar`** (`src/components/sidebar.tsx`, 220 LOC) is a **client component** (holds Zustand collapse state, `⌘\` shortcut, width animation). Inside it: **static chrome** (the `<aside>` frame, `Brand`, collapse toggle, the hardcoded `nav` array = Goals/Portfolios/Workload/Inbox links) **plus data-bearing nav** (`BoardsNav`, `DashboardsNav`, the Workspaces list, `PlatformNav`) that take the per-user props.
- **Session is cookie-bound.** `getUser()` → `createClient()` → `await cookies()`. Every shell query transitively reads cookies. **Per the Next 16 docs, code that reads `cookies()`/`headers()` cannot run inside `use cache`** — it must stream behind `<Suspense>` (or have the cookie-derived value extracted and passed as a cache-key arg). This is the load-bearing constraint that shapes the whole design.
- **Sidebar nav reads are small but unbounded.** `listMyBoards`/`listSharedBoards` are RLS-scoped + `order`ed (no `.limit()`); `workspaces` and `listDashboards` are unbounded `select`. Naturally small (a user's own boards/dashboards/workspaces), acceptable for nav, but the budget notes it (§5).
- **Only one `loading.tsx`** exists: `src/app/boards/[boardId]/loading.tsx`. No skeleton component library.
- **Tests:** Vitest, jsdom, `@testing-library/react`, two projects (`unit` parallel / `integration` serial). Existing `app-shell.test.tsx` + `sidebar.test.tsx` render the components directly with synchronous props — these change with this refactor (§7).

---

## 3. The three content buckets (PPR model)

Per `08-caching.md`, with `cacheComponents: true` every route is PPR by default; each component falls into one bucket:

| Bucket                         | What goes here                                                                                                                                                                                     | Mechanism                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Static (prerendered shell)** | AppShell frame; sidebar `<aside>` rail + `Brand` + collapse toggle + the static nav array (Goals/Portfolios/Workload/Inbox); header bar + `CommandTrigger` + `ThemeToggle`; Suspense **fallbacks** | synchronous render — auto-included in shell              |
| **Streamed (dynamic)**         | per-user nav lists (`BoardsNav`, `DashboardsNav`, workspaces, `PlatformNav`); header `NotificationsBell` + `UserMenu`; anything reading `cookies()` via the session helpers                        | `<Suspense>` boundary; **no `use cache`** (cookie-bound) |
| **Cached**                     | _none in 9.2_                                                                                                                                                                                      | deferred to 9.3                                          |

**Critical placement rule (from `streaming.md` "Push dynamic access down" + `instant-navigation.md`):** do **not** `await` data at the top of the layout. Kick off each query without awaiting, pass the **promise** down into a small streamed server component that lives behind its own `<Suspense>`, and resolve it there. Anything `await`ed above a boundary blocks the shell.

---

## 4. Locked approach

### 4.1 Enable Cache Components

`next.config.ts`: add `cacheComponents: true` and `experimental: { instantNavigationDevToolsToggle: true }`. Node runtime only (already the case). This is a **repo-wide flag** — see §8 for the blast-radius risks it introduces (Activity-based state preservation, blocking-route build errors).

### 4.2 Restructure the shell into static frame + streamed slots

Refactor so the static frame renders synchronously and the data regions stream:

- **`AppShell` becomes a pure static frame.** It stops taking data props (`boards`, `user`, `currentUserId`, …). Instead it accepts **slot props** — already-wrapped `ReactNode`s for the sidebar data region and the header user region — plus `children`. The frame, header bar, `CommandTrigger`, `ThemeToggle` all render in the static shell.
- **`Sidebar` keeps its client collapse shell** (frame, `Brand`, toggle, static nav array) but receives the data-bearing nav (`BoardsNav`/`DashboardsNav`/workspaces/`PlatformNav`) as a **`navSlot` `ReactNode`** instead of raw `boards`/`dashboards`/… arrays. The slot is a server-rendered, Suspense-wrapped subtree passed from the layout. The client sidebar renders `{navSlot}` in place; the collapse state still drives width/visibility of the frame, and the slot's own collapsed styling is handled by passing `collapsed` through context or a thin client wrapper (decision D2, §9).
- **New streamed server components** (the units that actually `await`):
  - `SidebarNavData` — kicks off `listMyBoards`/`listSharedBoards`/`listDashboards`/workspaces/`isPlatformAdmin`/`isOrgAdmin`, renders `BoardsNav`+`DashboardsNav`+Workspaces+`PlatformNav`. Behind `<Suspense fallback={<SidebarNavSkeleton/>}>`.
  - `HeaderUserData` — resolves `getUser()`/`currentUserId`/`isPlatformAdmin`, renders `NotificationsBell` + `UserMenu`. Behind `<Suspense fallback={<HeaderUserSkeleton/>}>`.
  - (`getUserTimeZone()` feeds `TimeZoneProvider`, which wraps `children`. Because the provider must wrap page content, resolve it in its own streamed boundary or pass the timezone promise into a client provider via `use()` — decision D3, §9.)
- **Each section layout becomes synchronous**: it composes `<AppShell sidebarNav={<Suspense…><SidebarNavData/></Suspense>} headerUser={<Suspense…><HeaderUserData/></Suspense>}>{children}</AppShell>`. No top-level `await`. The shared per-section logic lives in one composition helper so the 8 layouts don't re-duplicate it (§4.4).

### 4.3 Suspense fallbacks: shell skeletons, scoped to 9.2 — the 9.4 boundary

9.2 owns **shell-region Suspense fallbacks only**: `SidebarNavSkeleton` and `HeaderUserSkeleton`, content-shaped (rows that match `BoardsNav`/`DashboardsNav` dimensions; a circular avatar + bell placeholder) so there is **zero layout shift** when data streams in. These are small components co-located with the shell (e.g. `src/components/shell/`), **not** `loading.tsx` files.

**9.4 owns page-content `loading.tsx`** (the per-section full-page skeletons for `boards`/`dashboards`/`goals`/`portfolios`/`workload`/`settings`). The two never overlap:

- 9.2 boundary wraps **shell data inside the layout** (sidebar nav, header user). Scope = chrome.
- 9.4 `loading.tsx` wraps the **page segment** (`{children}` / `<main>` content). Scope = page body.

The existing `boards/[boardId]/loading.tsx` is a page-content skeleton → it stays as-is and belongs to the 9.4 family; 9.2 does not touch it. 9.2 may extract a shared `<Skeleton>` primitive (a styled `animate-pulse` block) that **both** 9.2 shell skeletons and 9.4 page skeletons reuse, so the two phases share a token, not a layout. Building that primitive is in 9.2 scope (it's needed for the shell fallbacks) and is the single intentional, documented hand-off seam to 9.4.

### 4.4 De-duplicate the 8-layout query block

The identical `Promise.all` block across 8 layouts is extracted into the streamed components (`SidebarNavData`, `HeaderUserData`) which are imported by a single `<AuthenticatedShell>` composition. Each section layout shrinks to a thin wrapper (mostly just `unstable_instant` config + any section-specific extras like `admin`'s gate or `dashboards`' CSS import). This is a targeted improvement justified by the work (we're rewriting all 8 anyway), not unrelated refactoring.

### 4.5 `unstable_instant` validation + e2e

Add `export const unstable_instant = { prefetch: 'static' }` to the section **page/segment** to turn on dev+build validation that the shell is genuinely instant at every entry point. **Caveat (verified):** the authenticated **layout** reads cookies, so page-load entry into a section is inherently dynamic — the guide's own dashboard example sets `unstable_instant = false` on such a layout to exempt the cold page-load entry while still validating sibling client navigations (e.g. `/boards/A → /boards/B`). Decision D1 (§9) picks the exact placement. `unstable_instant` is **draft/unstable** and **cannot go on a client component** (so never on `Sidebar`). Add one `@next/playwright instant()` e2e on the boards section as the regression guard (not one per route — build-time validation is the structural guarantee).

---

## 5. Performance & data-fetching budget (working-agreement rule #5)

**First paint (page load):**

- **Static shell streams immediately**: AppShell frame, sidebar rail + Brand + collapse toggle + static nav links, header bar + command trigger + theme toggle, and both skeleton fallbacks. TTFB is decoupled from data (target < 200 ms per umbrella budget); FCP/LCP paint the chrome without waiting on any query.
- **Then streams in** (independent Suspense boundaries, in whatever order they resolve): sidebar nav lists; header notifications bell + user menu. Each is one network-bound RSC behind its own boundary, so a slow boards query never blocks the header and vice-versa.

**Each interaction (in-page toggles — gotcha-09):**

- Sidebar **collapse** = client Zustand state, **0 server round-trips** (unchanged). Width/visibility is pure client state + persisted store. No `<Link>`/router nav.
- View/tab/filter/sort toggles inside a page = client state + History API (unchanged; out of 9.2 scope, owned by the page).
- **Cross-section navigation** (`/boards → /dashboards`) re-runs the destination layout's streamed shell data. In 9.2 this is **uncached** (streams fresh each time) — acceptable because it streams behind the already-painted static shell (no blank frame). **9.3** makes this near-free by caching the lists; 9.2 deliberately leaves that lever for 9.3 to avoid the cookie-in-`use cache` trap.
- **Sibling navigation** (`/boards/A → /boards/B`) keeps the shared layout mounted → shell data is **not** re-fetched (Next preserves the shared layout; verified in the existing boards-layout comment). Only the page segment re-renders. `unstable_instant` validates this path is instant.

**Bounded/indexed hot-path reads:**

- Shell nav reads (`listMyBoards`/`listSharedBoards`/`listDashboards`/workspaces) are RLS-scoped to the user's own small set and `order`ed on indexed columns (`position`, `created_at`). They are **unbounded by design** (a user's nav list is inherently small). 9.2 does **not** add pagination to them (YAGNI for nav scale); the budget records this as an accepted bound. The heavy bounded reads (`.limit(200/1000/2000/4000)`) are board-**content** queries, not shell, and are out of scope.

---

## 6. Why no `use cache` in 9.2 (the 9.2/9.3 seam)

Every shell query transitively calls `await cookies()` (via `createClient`). The Next 16 docs are explicit: `cookies()`/`headers()` **cannot** be called inside `use cache`; you must either stream behind `<Suspense>` or extract the cookie-derived value (the userId) **outside** the cached function and pass it as an argument (which becomes the cache key). 9.2 takes the **stream-behind-Suspense** path — simplest, correct, and it establishes exactly the Suspense structure 9.3 needs. **9.3** then slots `use cache` into the leaf data functions, keyed on the extracted `userId`, with `cacheTag`/`updateTag` invalidation on the relevant mutations. Because 9.2 produces the boundaries and 9.3 fills them, the two **share files but not directives** — no collision.

---

## 7. Testing strategy (working-agreement rule #4 — written + executed)

- **Unit (jsdom, `@testing-library/react`):**
  - `AppShell` new contract: renders the static frame + provided slots; renders `children`; `CommandTrigger`/`ThemeToggle` present without any data props. (Update the existing `app-shell.test.tsx` — its current tests pass `boards`/`user` props that no longer exist on the frame; move those assertions onto `SidebarNavData`/`HeaderUserData` tests rendered with mock data.)
  - `SidebarNavSkeleton` / `HeaderUserSkeleton` render with the documented `aria-busy`/`aria-label` and stable dimensions (CLS guard).
  - `SidebarNavData` / `HeaderUserData` render the right nav given mocked query results (mock `@/lib/boards/queries` etc., as existing tests already mock server modules).
  - `Sidebar` still toggles collapse and renders the passed `navSlot` (extend `sidebar.test.tsx`).
- **Config:** assert `next.config.ts` exports `cacheComponents: true` (cheap regression test that the flag is on).
- **Build is the real PPR gate.** `pnpm build` with `cacheComponents` on **fails** (`blocking-route` error) if any uncached/cookie-reading code sits outside a `<Suspense>` boundary — so a green build is positive evidence the shell prerenders and the data streams. Plus `unstable_instant` validation runs at build.
- **E2e:** one `@next/playwright` `instant()` test on the boards section asserting the chrome is present in the instant shell before data streams.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all four green per section before merge.

---

## 8. Risks & blast radius

- **`cacheComponents` is a repo-wide flag.** Enabling it changes navigation semantics app-wide: per `migrating-to-cache-components.md`, routes are preserved with React `<Activity>` in `hidden` mode instead of unmounting, so `useState`/form inputs/scroll/popover-open state **persist across back-nav**. This can surface latent bugs in existing client components (dropdowns staying open, dialogs not re-initializing). Mitigation: roll out section-by-section, run the full suite + manual smoke per section, and add explicit reset logic where the audit finds reliance on unmount.
- **Build can hard-fail on un-wrapped dynamic access.** Any place in an authenticated route that reads cookies/headers outside a boundary becomes a `blocking-route` build error once the flag is on. This is a _feature_ (it forces correctness) but means turning the flag on and fixing the boards section must land **together** in the first task, or the build is red. Boards-first bounds this.
- **`unstable_instant` is draft.** API may shift; we pin to the 16.2.9 shape and treat validation as advisory-but-enforced. Documented known issue: the DevTools instant cookie is shared across localhost ports.
- **Streaming infra:** Vercel supports streaming natively (umbrella already on Vercel/Fluid Node) — no proxy/CDN buffering change needed.

---

## 9. Open decisions (carried into the plan / flagged for user)

- **D1 — `unstable_instant` placement.** Because the authenticated layout reads cookies (dynamic page-load entry), do we (a) put `unstable_instant = false` on the section **layout** and `{ prefetch: 'static' }` on inner **page** segments to validate sibling nav only, or (b) attempt to make page-load entry instant too by deferring the cookie read deeper? Recommendation: **(a)** for v1 — matches the docs' dashboard pattern, lowest risk; revisit (b) if the budget needs cold-entry instant. _Needs user confirmation it's acceptable that cold page-load into a section is not `instant`-validated (it still streams the static shell instantly — just not validated)._
- **D2 — passing `collapsed` into the streamed nav slot.** The data nav needs the client `collapsed` flag for its compact styling, but the slot is server-rendered. Options: (i) render both expanded+collapsed markup in the slot and toggle with CSS driven by a `data-collapsed` attribute on the client `<aside>` (no extra client JS, pure CSS) — **recommended**; (ii) a thin client wrapper that reads the store and passes `collapsed` down. Lock in the plan.
- **D3 — `TimeZoneProvider` placement.** It currently wraps `children` and needs `getUserTimeZone()`. To keep `children` in the static shell, resolve the timezone in its own streamed boundary or hand the promise to a client provider via `use()`. Lock the exact shape in the plan; low risk either way.
- **D4 — rollout granularity.** Boards first (task 1, also flips the flag + builds the shell primitives). Then a parallel batch for the remaining sections? Decided in the plan's Execution DAG, but the **flag-flip + boards must be one task** (build can't be green otherwise).

---

## 10. Rollout order (section-by-section, per umbrella)

1. **boards** — canonical; flips `cacheComponents`, builds the shell primitives (`AppShell` frame, slots, `SidebarNavData`, `HeaderUserData`, skeletons, `<Skeleton>` token), wires the boards layout, adds `unstable_instant` + the e2e. The flag-flip and boards conversion are **atomic** (build correctness).
2. **dashboards** (has the extra `react-grid-layout` CSS import).
3. **goals**, **portfolios**, **workload** (the three that skip `isOrgAdmin`) — structurally identical, parallelizable.
4. **settings**, **admin** (admin has the `requirePlatformAdmin` gate) — parallelizable with #3 once primitives exist.

Each section: convert layout → streamed shell, verify all four gates green, manual smoke, commit.

---

## 11. Out of scope (YAGNI)

- `use cache` / `cacheTag` for the lists → **9.3**.
- Page-content `loading.tsx` skeletons for the sections → **9.4** (9.2 only ships shell-region fallbacks + the shared `<Skeleton>` token).
- Bundle code-splitting → **9.5**. Web-Vitals instrumentation / Lighthouse CI → **9.6**.
- Pagination of nav lists (not needed at nav scale).
- Touching `proxy.ts` auth (its `getUser()` token-refresh stays; that's 9.1 territory and correct).
