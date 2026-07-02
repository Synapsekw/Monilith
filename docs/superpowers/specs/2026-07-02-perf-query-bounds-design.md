# Perf: bounded queries + caching + lazy charts — design

- **Date:** 2026-07-02
- **Status:** Spec written, awaiting review
- **Branch:** `task/perf-query-bounds`
- **Mode:** Non-interactive brainstorm — decisions the user would normally arbitrate are
  recorded in "Open questions / decisions taken" at the end.

## Problem

A codebase sweep flagged seven hot-path performance issues: unbounded `select *` reads on
growing tables (violating the AGENTS.md bounded-reads invariant), a fresh per-request
`listOrgMembers` fetch on three page types (fetched **twice** on the portfolio page — once
inside `getPortfolioRows`, once in the page itself, with no `React.cache` dedup), a
sequential await waterfall on `/portfolios/[portfolioId]`, and a ~35 KB gzipped `recharts`
dependency statically imported into the dashboard first-paint bundle even when no chart
widget exists.

All seven findings were **verified against the code** in this worktree before speccing;
verdicts below.

## Verified findings

| #   | Brief claim                                                                             | Verdict                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/components/dashboards/DashboardWidget.tsx:14` statically imports the recharts path | **Confirmed.** `DashboardWidget` statically imports `ChartWidget`, which imports 18 recharts symbols. `ChartWidget` is the _only_ recharts importer in `src/` (verified by grep). Precedent for the fix exists: `FilePreviewLightbox.tsx:23` lazy-loads `PdfPreview` via `next/dynamic` with `ssr: false`.                                    |
| 2   | `src/lib/dashboards/queries.ts:16-23` `listDashboards()` unbounded                      | **Confirmed.** `select("*")` with no limit. Sole caller is `src/app/(app)/dashboards/page.tsx`, which only needs the first dashboard id to redirect. `listDashboardsCached(orgId)` already exists in `queries-cached.ts` and is warm from the sidebar (`sidebar-nav-data.tsx:38` calls it with the same key).                                 |
| 3   | `src/lib/portfolios/queries.ts:104-111` `listReadableBoards()` unbounded                | **Confirmed.** No limit. Callers: `/goals` page, `/portfolios/[portfolioId]` page, `getWorkloadPageData` (`src/lib/workload/queries.ts:184`). (The brief's "goal owners" is actually `getGoalOwners` → `listOrgMembers`, covered by finding 6.)                                                                                               |
| 4   | `src/lib/portfolios/queries.ts:8-14` `listPortfolios()` unbounded                       | **Confirmed.** No limit. Sole caller: `/portfolios` index page.                                                                                                                                                                                                                                                                               |
| 5   | `src/lib/goals/queries.ts:61-111` `getGoalsTree()` + `getGoalLinks()` unbounded         | **Confirmed.** `goals` select ordered by `position` with no limit; `goal_links` select with no filter and no limit (RLS-scoped only).                                                                                                                                                                                                         |
| 6   | `src/lib/boards/queries.ts:311-339` `listOrgMembers()` re-fetched fresh on 3 page types | **Confirmed — worse than reported.** Fresh 2-query fetch (org_members + profiles) on `/boards/[boardId]`, `/portfolios/[portfolioId]` (**twice**: `getPortfolioRows` line 76 + page line 19), `/goals` (via `getGoalOwners`), and the workload page (`listOrgMembersForWorkload`). Not wrapped in `React.cache`, so the double fetch is real. |
| 7   | `src/app/(app)/portfolios/[portfolioId]/page.tsx:15-20` sequential awaits               | **Confirmed.** `getPortfolioRows` is awaited fully before `Promise.all([listOrgMembers, listReadableBoards])`, and `getPortfolioRows` itself awaits `getPortfolio` before the placements/rollup pair — a 3-stage waterfall where 2 stages suffice, plus the duplicate members fetch.                                                          |

## Goals

1. Every hot-path list read in this slice is **bounded** (explicit `.limit(n)`) over
   **indexed** filter columns, with truncation behavior documented.
2. Org-member and readable-board reads on the boards/portfolios/goals/workload pages are
   served from the `use cache` layer (Phase 9.3 pattern) instead of fresh per-request
   Supabase round-trips — with **correct tag invalidation** from every mutation that
   writes the underlying data.
3. `recharts` leaves the dashboard first-paint JS bundle; the chunk loads only when a
   chart widget actually mounts.
4. `/portfolios/[portfolioId]` first paint drops from a 3-stage to a 2-stage await
   waterfall and stops double-fetching members.

## Non-goals

- No pagination UI, `hasMore` plumbing, or virtualization anywhere in this slice — the
  limits are safety valves far above current data sizes (documented via JSDoc), not
  product features.
- No caching of `listPortfolios`, `getGoalsTree`, or `getGoalLinks` (their pages are
  single-visit, mutation-heavy surfaces invalidated by `revalidatePath` today; caching
  them needs new tags on 5+ goal/portfolio mutations for negligible win — YAGNI).
- No changes to `getWidgetAggregationCached`, board cell reads, or any RPC internals
  (`goals_rollup`, `portfolio_rollup`, `workload_rollup` are already server-bounded
  aggregations).
- No schema/migration changes. All filter columns used are already indexed (verified:
  `org_members` PK `(org_id, user_id)`, `boards_org_id_idx`, `boards_created_by_idx`,
  `board_members_user_id` composite PK + `board_members_org_id_idx`,
  `dashboards_org_id_idx`, `portfolios_org_id_idx`, `goals_org_id_idx`,
  `goal_links_goal_id_idx`).

## Design

### F1 — Lazy-load the chart rendering path (`recharts`)

In `DashboardWidget.tsx` (already `"use client"`), replace the static `ChartWidget`
import with the `PdfPreview` dynamic pattern:

```tsx
const ChartWidget = dynamic(
  () =>
    import("@/components/dashboards/widgets/ChartWidget").then(
      (m) => m.ChartWidget,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted/40 h-full animate-pulse rounded-md" />
    ),
  },
);
```

- The loading fallback is the exact skeleton `ChartWidget` itself renders while its
  series loads, so the visual handoff is seamless (no layout shift: the widget shell owns
  the sizing).
- `ssr: false` is correct here: the chart is client-data-driven (`useWidgetSeries`) and
  renders a skeleton on the server today anyway.
- `NumberWidget`, `BatteryWidget`, `ListWidget` stay static — none import recharts
  (verified), and they're cheap.
- `ChartWidget.tsx` itself is unchanged; its existing tests stand.

### F2 — `/dashboards` index reuses the cached list

Replace `listDashboards()` in `src/app/(app)/dashboards/page.tsx` with the existing
Phase 9.3 read:

```tsx
const orgs = await getUserOrgs(); // identity read OUTSIDE the cache (9.3 rule)
const orgId = orgs[0]?.id;
const dashboards = orgId ? await listDashboardsCached(orgId) : [];
```

- The sidebar calls `listDashboardsCached(orgId)` with the same key on every
  authenticated page, so this is a warm cache hit — **0 additional Supabase round-trips**
  on the common path.
- `listDashboardsCached` gains `.limit(100)` (org-filtered over `dashboards_org_id_idx`)
  and already has correct invalidation: every dashboard mutation in
  `src/lib/dashboards/actions.ts` calls `updateTag(dashboardsTag(orgId))`.
- `listDashboards()` in `src/lib/dashboards/queries.ts` becomes dead code → delete it
  (and its test coverage in `queries.test.ts` moves/adjusts). `getDashboardPayload`
  stays.

### F3 — `listReadableBoards`: bound + cached wrapper

**Bound:** the underlying read gets `.limit(500)` + JSDoc ("truncates silently at 500;
raise alongside pagination if an org ever approaches that").

**Cache:** new `src/lib/portfolios/queries-cached.ts` with:

```ts
export async function listReadableBoardsCached(
  userId: string,
): Promise<{ id: string; name: string; workspaceId: string }[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(boardsTag(userId), sharedBoardsTag(userId));
  // service client; explicit filters are the tenant boundary
}
```

The service-client read must replicate the boards RLS read policy exactly
(`20260621000000_board_access_require_membership_and_returning.sql`):
**readable = active org member AND (creator OR board_members grant)**. Concretely:

1. `org_members` rows for `userId` (active only — mirror whatever activity predicate
   `is_org_member` uses) → the user's org ids.
2. `boards` where `created_by = userId` and `org_id in (orgIds)`, `.limit(500)`.
3. `boards` joined via `board_members` where `user_id = userId` and `org_id in (orgIds)`,
   `.limit(500)`.
4. Union by id, sort by name — same shape/order as today.

**Invalidation — zero writer changes needed.** The entry is tagged with the two
_existing_ per-user tags, and every mutation that changes this set already updates them:

- Board create/delete/rename → `updateTag(boardsTag(user.id))` (`boards/actions.ts:61`).
- Share/unshare with a user → `updateTag(sharedBoardsTag(targetUserId))`
  (`boards/sharing-actions.ts`).
- An org-mate creating a board the user _could_ be granted later doesn't change this
  user's readable set (creator-or-grant policy), so there is **no cross-user staleness
  hole by construction**.
- Membership deactivation/removal edge: the deactivated user's cached list could serve
  stale boards for up to `cacheLife("nav")` (60 s revalidate). To close it, `removeMember`
  and `deactivateMember` in `org/admin-actions.ts` additionally call
  `updateTag(boardsTag(userId), sharedBoardsTag(userId))` for the target user (they
  already know the target `userId`). Note RLS still protects every board _content_ read —
  this cache only leaks names for ≤60 s without the fix, but we fix it anyway.

**Callers migrated:** `/portfolios/[portfolioId]` page, `/goals` page,
`getWorkloadPageData`. Each already has (or trivially gets) `userId` from the
session-identity helpers _outside_ the cache scope, per the 9.3 rule. The RLS-scoped
`listReadableBoards` stays exported (bounded) for the goals re-export surface, but if no
callers remain after migration it is deleted.

### F4 — `listPortfolios`: bound only

`.limit(200)` + JSDoc. Keeps the RLS client — it's one indexed query
(`portfolios_org_id_idx` via RLS) on a single index page. No cache (see Non-goals).

### F5 — Goals reads: bound + document truncation

- `getGoalsTree()`: `.limit(1000)` on the `goals` select (ordered by `position`,
  org-scoped by RLS over `goals_org_id_idx`).
- `getGoalLinks()`: `.limit(2000)` on the `goal_links` select.
- JSDoc on both: silent truncation at the cap; the tree builder tolerates missing parents
  (verified in `progress.ts:buildGoalTree` — roots come from `byParent.get(null)`, so a
  child whose parent fell past the cap is silently dropped, never a crash; the unit test
  pins this); caps chosen ≥10× any realistic org today. **Decision: JSDoc, not `hasMore`** — no UI consumes a partial-tree signal, and
  inventing one is scope creep (recorded below).

### F6 — `listOrgMembersCached(orgId)`

New tag + new cached wrapper following `listDashboardsCached` exactly:

- `src/lib/cache/tags.ts`: `export const orgMembersTag = (orgId: string) =>
\`org-members:org:\${orgId}\`;`
- New `src/lib/org/queries-cached.ts` (members are org-domain; `boards/queries.ts` only
  hosts `listOrgMembers` for historical reasons):

```ts
export async function listOrgMembersCached(
  orgId: string,
): Promise<OrgMember[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(orgMembersTag(orgId));
  // service client; explicit org_id filter = tenant boundary (org_members PK is
  // (org_id, user_id) → indexed). Same two-query profiles join as listOrgMembers,
  // with .limit(500) on org_members and the profiles .in() bounded by that set.
}
```

**Caller contract (JSDoc, same as `listDashboardsCached`):** `orgId` must come from data
the current user is entitled to (their `getUserOrgs()`, a board/portfolio row they can
read) — the service client bypasses RLS and the explicit filter is the only boundary.
All five call sites satisfy this: `boards/[boardId]/page.tsx` (`payload.board.org_id`),
`portfolios/queries.ts:getPortfolioRows` (`portfolio.org_id`),
`portfolios/[portfolioId]/page.tsx` (`result.portfolio.org_id`),
`goals/queries.ts:getGoalOwners` (`getUserOrgs()[0]`),
`workload/queries.ts:listOrgMembersForWorkload` (`getUserOrgs()[0]`). All five migrate to
the cached read. `listOrgMembers` is deleted if no callers remain (the `OrgMember` type
stays exported from `boards/queries.ts` to avoid an import churn cascade).

**Invalidation matrix (every writer of the underlying data):**

| Mutation                                                | File                                                                                                                  | Change                                                                                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `removeMember`                                          | `org/admin-actions.ts`                                                                                                | add `updateTag(orgMembersTag(orgId))`                                                                                                                                          |
| `deactivateMember`                                      | `org/admin-actions.ts`                                                                                                | add `updateTag(orgMembersTag(orgId))`                                                                                                                                          |
| `reactivateMember`                                      | `org/admin-actions.ts`                                                                                                | add `updateTag(orgMembersTag(orgId))`                                                                                                                                          |
| `setMemberRole`                                         | `org/admin-actions.ts`                                                                                                | **no change** — role is not in the `OrgMember` payload                                                                                                                         |
| Invite redemption (`redeem_invitations` RPC at sign-in) | `auth/redeem.ts`                                                                                                      | **TTL-covered** — the RPC returns only a count (no org ids), so we can't target the tag; the new member appears within ≤60 s (`nav` revalidate). Recorded as a decision below. |
| Profile display changes (`full_name`/`avatar_url`)      | none exist today (`profile/actions.ts` edits timezone only; name/avatar set at onboarding, before membership matters) | **TTL-covered**; JSDoc notes that any future profile-edit action must `updateTag(orgMembersTag(orgId))` for each of the user's orgs                                            |

### F7 — `/portfolios/[portfolioId]` parallelization

Two changes, no behavior change:

1. **Inside `getPortfolioRows`:** run `getPortfolio(portfolioId)`, the placements select,
   and the `portfolio_rollup` RPC in one `Promise.all` (all three key on `portfolioId`
   alone; RLS returns empty rows for the not-found/not-visible case, so firing
   placements/rollup before the existence check is safe — they're discarded when
   `portfolio` is null). Members then come from `listOrgMembersCached(portfolio.org_id)`
   (needs `org_id`, so it stays a second stage — but it's now a cache hit).
2. **In the page:** `Promise.all([getPortfolioRows(portfolioId),
listReadableBoardsCached(userId)])`, then `listOrgMembersCached(result.portfolio.org_id)`
   — which dedups against the identical call just made inside `getPortfolioRows` (same
   `use cache` key within the request), eliminating today's duplicate fetch.

Resulting waterfall: `params/requireUser` → **stage 1** (portfolio + placements + rollup

- readable boards, concurrent) → **stage 2** (members, warm). Previously three stages
  plus a duplicate members query.

## Performance & data-fetching budget (AGENTS.md rule #5)

**(a) First paint vs. interaction:**

| Page                  | Server reads on first paint (after)                                                                                        | Interaction round-trips                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `/dashboards` (index) | 0 new — redirect decision served from the sidebar-warm `listDashboardsCached` entry (cold: 1 bounded query)                | n/a (redirects)                                                |
| Dashboard page charts | unchanged reads; **−~35 KB gzip** first-paint JS when no chart widget; chart chunk streams in on first chart mount         | unchanged (widget data via existing cached/query layer)        |
| `/portfolios`         | 1 bounded query (limit 200)                                                                                                | unchanged                                                      |
| `/portfolios/[id]`    | 2 stages: {portfolio, placements, rollup, readable-boards(cached)} ∥ then members(cached); duplicate members fetch removed | unchanged — grid interactions remain client-state              |
| `/goals`              | 4 parallel reads; goals/links now bounded; members + readable-boards served from cache                                     | unchanged                                                      |
| `/boards/[boardId]`   | members read becomes a cache hit after first visit                                                                         | unchanged                                                      |
| Workload              | members + readable-boards become cache hits                                                                                | unchanged (0-round-trip toggles preserved per existing design) |

**(b) Server data vs. client state:** this slice changes no interactions. All mutations
remain Server Actions; the new/changed cached reads get targeted `updateTag`
invalidation per the matrices above (read-your-own-writes preserved).

**(c) Bounded over indexed:** every read this slice touches gains an explicit limit —
readable boards 500, org members 500, portfolios 200, goals 1000, goal links 2000,
dashboards (already org-filtered, add `.limit(100)` to `listDashboardsCached` for
symmetry) — and every filter column is covered by an existing index (list in Non-goals).
No new migrations required.

## Security / cross-tenant isolation

Two new service-client (`RLS-bypassing`) cached reads are introduced, so both MUST be
added to the Phase 9.3 safety net:

- Unit tests (mocked client, `queries-cached.test.ts` style): assert the explicit
  tenant filter is applied (`eq("org_id", orgId)` / `eq("created_by", userId)` +
  `eq("user_id", userId)`).
- `src/lib/cache/cross-tenant-isolation.integration.test.ts`: extend the two-tenant
  provisioning with cases proving `listOrgMembersCached(a.orgId)` never contains tenant
  B's user and `listReadableBoardsCached(a.id)` never contains tenant B's board (and
  vice versa).

`SUPABASE_SERVICE_ROLE_KEY` usage stays inside `server-only` modules, matching the
existing wrappers.

## Testing strategy

Vitest throughout (`next/cache` stubbed as in existing cached tests). Per feature:

- **F1:** component test for `DashboardWidget` mocking `next/dynamic` (the
  `FilePreviewLightbox.test.tsx` pattern) asserting the chart path renders for
  `kind: "chart"` and the static widgets render for other kinds. Plus a lint-level
  guard: no static `from "recharts"` import remains outside `ChartWidget.tsx` /
  `chart-theme.ts` (grep assertion in the test or a simple unit check).
- **F2:** page-level behavior covered by adjusting `queries.test.ts` (removal of
  `listDashboards`) and asserting `listDashboardsCached` bound.
- **F3/F6:** unit tests for both cached wrappers (tenant filter, limit, shape, empty
  states); invalidation tests in `org/admin-actions.test.ts` asserting the new
  `updateTag` calls; integration isolation tests as above.
- **F4/F5:** unit tests asserting `.limit(...)` is applied (mock-chain style used across
  the repo) and that `buildGoalTree` tolerates a truncated row set (orphan handling).
- **F7:** unit test on `getPortfolioRows` (mock client) asserting single members fetch
  and null-portfolio short-circuit still returns null.
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (build also proves the
  recharts chunk split — verify via build output that the dashboard route's first-load JS
  drops).

## Independent units (for the plan's Execution DAG)

- **U1** F1 lazy charts — touches `DashboardWidget.tsx` (+ test) only.
- **U2** F2 dashboards index + `listDashboards` removal + `listDashboardsCached` bound.
- **U3** F6 members: tag + cached wrapper + admin-action invalidation + 5 caller
  migrations (+ tests).
- **U4** F3 readable boards: bound + cached wrapper + caller migrations (+ tests).
- **U5** F4+F5 pure bounds (portfolios, goals, links) — no shared state with U1–U4.
- **U6** F7 portfolio page parallelization — **depends on U3 and U4** (consumes both
  cached wrappers); everything else is mutually independent. U3 and U4 both touch
  `portfolios/[portfolioId]/page.tsx` and `org/admin-actions.ts` is U3-only; U4 and U3
  overlap on the goals/workload/portfolio caller files, so schedule them in the same
  wave only with file-level coordination, or serialize U4 after U3 (plan decides;
  see plan DAG).

## Open questions / decisions taken (non-interactive)

1. **`/dashboards` index: reuse `listDashboardsCached` vs. `select id limit 1`.** Chose
   the cached reuse — same key as the sidebar means a warm hit (0 round-trips) and one
   less bespoke query; `nav` staleness (≤60 s) is acceptable for a redirect target and
   already governs the sidebar list the user clicked.
2. **`hasMore` vs. JSDoc for goals truncation.** Chose JSDoc-documented silent caps
   (1000 goals / 2000 links): no consumer exists for a partial signal, current data is
   orders of magnitude below the caps, and the tree builder degrades gracefully.
3. **Cache `listReadableBoards` per-user reusing existing tags vs. new org-level tag.**
   Chose per-user entry tagged `boardsTag(userId) + sharedBoardsTag(userId)`: the RLS
   policy is creator-or-grant (not org-wide), so the readable set only changes via
   mutations that _already_ update those tags — zero new writer edges, no cross-user
   staleness hole.
4. **Invite redemption staleness for `listOrgMembersCached`.** Accepted ≤60 s TTL
   (`nav` profile): `redeem_invitations` returns only a count, so targeted invalidation
   would require an RPC signature change (out of scope). A just-joined member appearing
   in people-pickers within a minute is acceptable.
5. **Future profile-edit actions.** No name/avatar edit action exists today; the
   wrapper's JSDoc makes the invalidation obligation explicit for whoever adds one.
6. **`setMemberRole` does not invalidate the members tag** — the cached payload carries
   no role. If `OrgMember` ever grows a role field, the action must be added to the
   matrix (noted in JSDoc).
7. **Parallelizing the not-found path in `getPortfolioRows`** fires placements/rollup
   queries that get discarded when the portfolio is absent. Accepted: 404s are cold
   paths; both queries are indexed and cheap; the hot path loses a full stage.
8. **`listOrgMembers` / `listDashboards` deletion.** Delete-if-dead after migration
   (verified at build time by grep + typecheck) rather than keeping parallel uncached
   variants that invite drift.
