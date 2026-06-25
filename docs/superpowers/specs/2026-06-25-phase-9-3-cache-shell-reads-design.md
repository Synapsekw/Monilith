# Phase 9.3 — Cache (tagged `use cache` for hot shell reads)

**Status:** approved design — awaiting implementation plan
**Date:** 2026-06-25
**Parent:** `docs/superpowers/specs/2026-06-22-phase-9-performance-optimization-design.md` (§9.3)
**Predecessors shipped:** 9.1 (auth `getClaims` fast-path), 9.2 (streaming shell / PPR / Cache Components — `cacheComponents: true` is already enabled in `next.config.ts`).

## Goal

Make cross-section navigation in the authenticated app **near-free** by caching the
per-user/per-org reads that re-run on every shell render, and invalidating them precisely
on the mutations that change them. The streaming shell (9.2) already paints chrome
instantly and streams these reads behind `<Suspense>`; 9.3 makes the _streamed_ region
reuse a cached result instead of re-hitting Supabase on every navigation.

The hot reads (all rendered in `SidebarNavData`, and several re-rendered in
`HeaderUserData` and `CommandPaletteData`):

| Read                 | Source                                                              | Scope                        | Changes when…                            |
| -------------------- | ------------------------------------------------------------------- | ---------------------------- | ---------------------------------------- |
| `listMyBoards()`     | `src/lib/boards/queries.ts:48`                                      | per-user (`created_by = me`) | board create/rename/delete/duplicate     |
| `listSharedBoards()` | `src/lib/boards/queries.ts:70`                                      | per-user (shared _with_ me)  | a board is shared/unshared with me       |
| `listDashboards()`   | `src/lib/dashboards/queries.ts:15`                                  | per-org (RLS)                | dashboard create/rename/delete/duplicate |
| `workspaces` select  | inline in `sidebar-nav-data.tsx:28` & `command-palette-data.tsx:17` | per-org (RLS)                | workspace create/rename/delete           |
| `isPlatformAdmin()`  | `src/lib/platform/guard.ts:9`                                       | per-user                     | platform-role grant (rare; out-of-band)  |
| `isOrgAdmin()`       | `src/lib/org/guard.ts:10`                                           | per-user-in-org              | org role change / membership change      |

## The core constraint (why this is a correctness project, not a mechanical one)

Next.js 16 **public `use cache` cannot read `cookies()`/`headers()`** (confirmed against
`node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md` §Request-time APIs).
A public `use cache` entry is also **stored on the server and shared across requests**
(serialized by build-id + function-id + serialized args).

Every read above is currently RLS-scoped through `createClient()` (`src/lib/supabase/server.ts:8`),
which **awaits `cookies()`**. So:

1. We cannot wrap the existing cookie-bound clients in `use cache` (illegal — throws).
2. If we naïvely cached without keying on identity, **request B could read request A's
   cached rows → cross-tenant leak.** This is the headline risk of the whole phase.

Therefore the cached scope must (a) take **no** cookie, and (b) carry the caller's identity
**as an explicit argument** so it is part of the cache key, with a **per-identity `cacheTag`**.

## Chosen approach — Strategy A: cookie-free service client + explicit identity scoping

We rejected two alternatives:

- **Strategy B — `use cache: private`** (browser-only cache, may read cookies): it is
  _never stored on the server_ (per `use-cache-private.md`), so it gives **zero** cross-request
  server reuse — it does not deliver "cross-section navigation near-free", which is the entire
  point of 9.3. It is also flagged `experimental` (depends on unstable runtime prefetching).
  Rejected.
- **Strategy C — leave RLS client, cache nothing:** the status quo. Rejected (no win).

**Strategy A** wraps each read in a `use cache` function that:

1. Receives `userId` (and where relevant `orgId`) as a **plain string argument** — read
   _outside_ the cache via the existing `getUser()` / `getUserOrgs()` helpers (which stay
   cookie-bound and uncached, in the `SidebarNavData`/`HeaderUserData`/`CommandPaletteData`
   server components).
2. Uses `createServiceClient()` (`src/lib/supabase/service.ts` — **already exists**, fully
   privileged, **no cookies**, RLS bypassed) inside the cache.
3. **Re-applies the org/user filter as explicit `WHERE` clauses** — replicating what RLS did,
   but now keyed off the passed-in identity rather than the session. This is the security-
   critical line of code in the whole project.
4. Calls `cacheTag(<per-identity tag>)` and `cacheLife(<profile>)`.

Because the service client bypasses RLS, **the explicit `WHERE org_id = $orgId` / `created_by =
$userId` IS the tenant boundary inside the cache.** A test suite (below) asserts a second
user/org never sees the first's cached rows. The split-fetcher shape (uncached identity read →
cached scoped read) is the same shape already documented as the intended target in
`sidebar-nav-data.tsx:12`.

### File shape

Add a `*-cached.ts` sibling per query module rather than mutating the existing RLS queries
(keeps the RLS path intact for non-shell callers and for tests):

- `src/lib/boards/queries-cached.ts` → `listMyBoardsCached(userId)`, `listSharedBoardsCached(userId)`
- `src/lib/dashboards/queries-cached.ts` → `listDashboardsCached(orgId)`
- `src/lib/workspaces/queries-cached.ts` → `listWorkspacesCached(orgId)` (extract the inline shell select into a real query)
- guards: add `isPlatformAdminCached(userId)` / `isOrgAdminCached(userId, orgId)` (cached siblings; the existing `cache()`-wrapped RLS versions stay for `requirePlatformAdmin` / sensitive paths)

The shell components call the `*Cached` variants with ids they already have in scope.

## Cache-tag scheme

Tags are **identity-scoped strings** so invalidation is surgical and a leak is impossible by
construction (a user can only ever invalidate / be served their own tag):

| Tag                                   | Applied in               | Cached read           |
| ------------------------------------- | ------------------------ | --------------------- |
| `boards:user:<userId>`                | `listMyBoardsCached`     | my boards list        |
| `shared-boards:user:<userId>`         | `listSharedBoardsCached` | boards shared with me |
| `dashboards:org:<orgId>`              | `listDashboardsCached`   | org dashboards        |
| `workspaces:org:<orgId>`              | `listWorkspacesCached`   | org workspaces        |
| `platform-admin:user:<userId>`        | `isPlatformAdminCached`  | platform-admin flag   |
| `org-admin:user:<userId>:org:<orgId>` | `isOrgAdminCached`       | org-admin flag        |

A single `src/lib/cache/tags.ts` exports typed builder functions
(`boardsTag(userId)`, `dashboardsTag(orgId)`, …) so producers (cached reads) and consumers
(actions) reference the **same** string — the #1 way tag-cache invalidation silently breaks
is a typo'd tag that nothing invalidates. Builders are unit-tested for stability.

## `cacheLife` profiles

Nav lists tolerate brief staleness (read-your-own-writes is handled by `updateTag`, below);
admin flags change extremely rarely. Add named profiles to `next.config.ts`:

| Profile | stale | revalidate | expire | Used by                          |
| ------- | ----- | ---------- | ------ | -------------------------------- |
| `nav`   | 60s   | 60s        | 1h     | board/dashboard/workspace lists  |
| `guard` | 60s   | 300s       | 1h     | `isPlatformAdmin` / `isOrgAdmin` |

`stale ≥ 60s` satisfies the documented 30s client-router minimum and keeps prefetched nav links
usable. Neither profile is "short-lived" (revalidate ≥ 60s, expire ≥ 5m), so neither becomes a
forced dynamic hole — they prerender/stream cleanly inside the 9.2 shell. (Confirmed against
`cacheLife.md` §Prerendering behavior.) `cacheLife` is called inside each cached scope with the
profile name; we deliberately avoid relying on the implicit `default` profile so behavior is
explicit per the docs' recommendation.

## Invalidation map (Server Actions → `updateTag`)

We use **`updateTag(tag)`** (not `revalidateTag`) in the mutating Server Actions: it is the
**read-your-own-writes** primitive — the next read after the mutation **waits for fresh data**
rather than serving stale (confirmed in `updateTag.md`). `updateTag` is Server-Action-only,
which all these mutations are. The identity for the tag is derived **server-side inside the
action** (from `getUser()`/`getUserOrgs()` or the row's `org_id`) — never trusted from the
client.

| Mutation (file:line)                                                                                                           | Tag(s) to `updateTag`                                               |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `createBoard`, `createBoardFromTemplate`, `deleteBoard`, `duplicateBoard`, `renameBoard` (`boards/actions.ts`)                 | `boards:user:<me>`                                                  |
| board share / unshare (`boards/sharing-actions.ts`)                                                                            | `shared-boards:user:<grantee>`                                      |
| `createDashboard`, `renameDashboard`, `deleteDashboard`, `duplicateDashboard` (`dashboards/actions.ts`)                        | `dashboards:org:<orgId>`                                            |
| `createWorkspace`, `renameWorkspace`, `deleteWorkspace` (`workspaces/actions.ts`)                                              | `workspaces:org:<orgId>`                                            |
| org role / membership change (`org/admin-actions.ts`: `setMemberRole`, `removeMember`, `deactivateMember`, `reactivateMember`) | `org-admin:user:<target>:org:<orgId>`                               |
| `platformSetOrgRole` (`platform/actions.ts:20`)                                                                                | `org-admin:user:<target>:org:<orgId>`                               |
| platform-role grant                                                                                                            | `platform-admin:user:<target>` — **out of band** (see Out of scope) |

**Keep existing `revalidatePath` calls.** The board _page_ (`/boards/<id>`) and dashboard _page_
re-render paths are orthogonal to these shell-list tags and are not part of 9.3. We are _adding_
`updateTag` for the cached shell lists alongside the existing `revalidatePath("/", "layout")` /
`revalidatePath("/dashboards")` calls. Once the cached lists are tag-driven, a _follow-up_ may
retire the now-redundant `revalidatePath("/", "layout")` from the list-membership mutations —
but that is explicitly **not** done in 9.3 to keep the change additive and low-risk while
another task is editing the same actions (see Coordination risk).

## Performance & data-fetching budget (AGENTS.md rule #5)

- **First paint:** unchanged — the static shell (9.2) paints chrome immediately; identity reads
  (`getUser`/`getUserOrgs`) and the cached lists stream behind the existing `<Suspense>`
  boundaries in `authenticated-shell.tsx`. **0 added blocking work on first paint.**
- **Per cross-section navigation (the win):** previously 6 Supabase round-trips per shell render
  (`listMyBoards` + `listSharedBoards` + `listDashboards` + `workspaces` + 2 guards). After 9.3,
  on a warm cache these are **served from the cache (0 Supabase round-trips)** for the `nav`/`guard`
  stale windows; only the uncached identity read (`getClaims`, already local per 9.1) runs.
- **Server-data change vs in-page toggle:** these reads change _server_ data, so invalidation is
  a **Server Action + `updateTag`** (correct per rule #5b) — never client History API.
- **Bounded reads:** the cached lists are the same bounded/indexed reads as today (`listMyBoards`
  orders by `position`; board/dashboard/workspace tables are org-scoped and small per tenant). No
  unbounded `select *` on a growing hot table is introduced.

## Invariants to preserve (AGENTS.md)

- **RLS is the security boundary — but inside a `use cache` scope the explicit `WHERE org_id/
created_by` IS that boundary** (service client bypasses RLS). Every cached read MUST filter on
  the passed identity, and a test MUST prove cross-tenant isolation. This is the single most
  important invariant in the project.
- **`SUPABASE_SERVICE_ROLE_KEY` stays server-only.** `createServiceClient` is already
  `server-only`; the cached modules import it and must themselves be `import "server-only"`.
  No service client, key, or unfiltered row ever crosses to the browser.
- **Zod at boundaries:** unchanged — the cached reads take a validated `userId`/`orgId` (uuid)
  and the mutations keep their existing Zod schemas. Add a uuid guard on the id args.
- **Server Components by default / Server Actions for mutations:** unchanged. Identity reads
  stay in server components; invalidation stays in `"use server"` actions.
- **No `any` creep:** the cached reads reuse the existing generated return types
  (`BoardListEntry`, `Dashboard`, …); no new `any`.

## Scoped OUT (with rationale)

- **Dashboard widget aggregation reads** (`getWidgetData`, `getWidgetRows`, `getWidgetSeries` in
  `dashboards/actions.ts`). The umbrella spec called these "the heavier cross-board aggregation
  reads", but on inspection they are **Server Actions** (`"use server"`) consumed by **client-side
  TanStack Query hooks** (`use-widget-data.ts` etc., `staleTime: 60_000`). `use cache` is illegal
  in a `"use server"` module, and these already have a client cache; converting them to cacheable
  query functions + rewiring the hooks is a separate, larger refactor that would collide with the
  existing React Query layer. **Deferred to a follow-up** ("9.3b — server-cache widget aggregates")
  and explicitly not built here. This keeps 9.3 to the high-value, low-risk shell reads.
- **`countNewFeedback`** (admin-only, conditional) — rare path, negligible win; left uncached.
- **Per-board / per-dashboard _page_ payload caching** (`getBoardPayload`, `getDashboardPayload`)
  — these are large, change constantly, and already revalidate per-page; not a "shell" read.
- **Retiring the redundant `revalidatePath("/", "layout")`** from list mutations — additive-only
  in 9.3 (see Coordination risk).
- **Platform-role grants invalidation** — there is no in-app Server Action that grants the
  platform-admin flag (it is provisioned out of band), so `platform-admin:user:<id>` has no
  in-app `updateTag` site. The `guard` profile's revalidate window (5m) bounds staleness; this is
  acceptable and documented. (`requirePlatformAdmin` keeps the live, uncached RLS check for
  sensitive admin routes per the 9.1 decision — only the _sidebar visibility flag_ is cached.)

## Coordination risk — concurrent edit of `boards/actions.ts`

A parallel task ("optimistic board mutations") is **also editing `src/lib/boards/actions.ts`** —
specifically the `createBoard` / `renameBoard` / `deleteBoard` / `duplicateBoard` revalidation
paths, which are the **exact** functions 9.3 adds `updateTag('boards:user:<me>')` to. This is a
guaranteed merge conflict zone.

Mitigations (carried into the plan's Execution DAG):

1. **Sequence, don't parallelize, the `boards/actions.ts` edits.** Land whichever task is closer
   first; the second rebases onto `develop` (`finish-task.sh` auto-rebases) and re-applies its
   hunk. The 9.3 change to each board action is a **single added line** (`updateTag(...)`) plus an
   import — a small, easy-to-rebase hunk.
2. **Isolate 9.3's boards-actions edit into the final task in the DAG** so it rebases last against
   the most current `develop`, minimizing the conflict window.
3. The boards _reader_ work (`queries-cached.ts`, tags, `next.config.ts`, shell wiring,
   dashboards/workspaces/guards) touches **files the other task does not**, so it proceeds fully
   in parallel; only the `boards/actions.ts` `updateTag` insertion is coordination-sensitive.

## Testing strategy (mandatory)

1. **Cross-tenant isolation (the critical test).** For each cached read: seed two users/orgs, call
   the cached fn with user/org A's id, then with B's id; assert each gets only its own rows and
   that A's cached entry never bleeds into B. (Integration test against the service client +
   explicit `WHERE`.)
2. **Invalidation-on-mutation, per action.** For every entry in the invalidation map: prime the
   cached read, run the mutation, assert the next read reflects the change (read-your-own-writes
   via `updateTag`). Spy/assert that each action calls `updateTag` with the **exact** tag string
   from `tags.ts` (catches typo drift).
3. **Tag-builder unit tests** (`tags.test.ts`): stable, collision-free strings for representative
   ids.
4. **`cacheLife` profile presence:** assert `next.config.ts` defines `nav` and `guard` with the
   intended numbers and that each cached fn names a profile (no implicit `default`).
5. **Existing suites stay green:** `sidebar-nav-data.test.tsx`, `header-user-data.test.tsx`,
   `command-palette-data.test.tsx`, `org/guard.test.ts`, `platform/guard.test.ts`, plus the
   board/dashboard/workspace action tests — updated where they now assert an added `updateTag`.
6. **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## How to test (manual, post-merge)

1. Pull `develop`; open the app, sign in.
2. Create a board in the sidebar → it appears immediately (read-your-own-writes via `updateTag`).
3. Navigate boards ↔ dashboards ↔ settings a few times → the sidebar is instant with no
   re-fetch flash. Optionally set `NEXT_PRIVATE_DEBUG_CACHE=1` and confirm cache hits on the
   nav reads across navigation.
4. Rename/delete a board, create/rename a workspace, create a dashboard → each reflects in the
   sidebar on the next render without a hard reload.
5. As a second user in a different org, confirm you never see org A's boards/dashboards/workspaces
   (cross-tenant isolation).

## Execution units (for the plan's DAG)

Independent, parallelizable units:

- **U1 — Tag builders + cacheLife profiles** (`src/lib/cache/tags.ts`, `next.config.ts`). Produces
  the shared tag vocabulary + profiles everything else consumes. **No dependencies.**
- **U2 — Cached boards reads** (`boards/queries-cached.ts`). Consumes U1.
- **U3 — Cached dashboards + workspaces reads** (`dashboards/queries-cached.ts`,
  `workspaces/queries-cached.ts`). Consumes U1.
- **U4 — Cached guards** (`platform/guard.ts`, `org/guard.ts` cached siblings). Consumes U1.
- **U5 — Shell wiring** (`sidebar-nav-data.tsx`, `header-user-data.tsx`, `command-palette-data.tsx`
  call the cached variants). Consumes U2, U3, U4.
- **U6 — Invalidation in dashboards/workspaces/org/platform actions.** Consumes U1. (Disjoint files
  from the parallel board-mutations task.)
- **U7 — Invalidation in `boards/actions.ts`** (the coordination-sensitive `updateTag` insertions).
  Consumes U1. **Scheduled last** to rebase against the latest `develop`.
