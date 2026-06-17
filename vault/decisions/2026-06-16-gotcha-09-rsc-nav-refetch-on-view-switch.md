---
type: adr
date: 2026-06-16
status: accepted
tags: [gotcha, performance, data-fetching, rsc, boards, react-query]
related:
  - "[[00-north-star]]"
  - "[[2026-06-15-gotcha-05-board-cache-coherence]]"
---

# Gotcha 09 — RSC navigation refetches everything on in-page view switches

## Context

Switching between a board's **Table** and **Kanban** views felt sluggish. Investigation
(three parallel read-only sweeps over routing, the data layer, and rendering) found the cause is
**not the tech stack** — Next.js 16 RSC + Supabase + React Query + TanStack Table/Virtual + dnd-kit
is appropriate. The cause is how view switching was wired.

The board view tabs (`ViewSwitcher`) switched views with `<Link href="/boards/[id]?view=...">`.
Changing that query param is a **full RSC navigation**, which re-runs `boards/[boardId]/page.tsx`
top to bottom. That page issues **~10 Supabase queries on every switch**:

- `getBoardPayload` = 6 reads (board, groups, columns, items, cell_values, board_views)
- plus the shell: `getUserOrgs`, `listBoards`, `workspaces`, and `listOrgMembers` (a 2-query JS join)

None of that data changes when you flip Table ↔ Kanban. Worse, the client **already** holds the
whole board in a `["board", boardId]` React Query cache with `staleTime: Infinity`
(`use-board-cache.ts`) — the refetch is pure waste, and the conditional render in the RSC forces a
full client unmount/remount of the view (realtime resubscribe, dnd-kit re-init, lost scroll/edit
state) on top of it.

Secondary amplifiers found (not the dominant cost, logged for the follow-up plan):

- **Derive-on-every-render with no memo:** `buildKanbanColumns`, the `cellMap`/`itemsByGroup`
  builds, and `useReactTable` rebuild each render; kanban cards do `cellValues.find(...)`
  per summary column → O(items × columns × cellValues).
- **No virtualization in Kanban** (Table virtualizes via `@tanstack/react-virtual`).
- **`cell_values` fetched unbounded** (no `.limit()`) and has **no `board_id` index** (only
  `org_id`/`column_id`), so large boards scan more than necessary.

## Decision

**In-page state that does not change server data must not trigger an RSC navigation.**

For view toggles, tab switches, filters, sorts, and similar client-only state, keep the state on the
client and update the URL with the **native History API** (`window.history.pushState` /
`replaceState`) — Next.js 16 integrates these into the router so `useSearchParams()` updates
**without re-running the server component** (see
`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`). Reserve full
RSC navigation (`<Link>` / `router.push` / `router.refresh`) for actions that genuinely change
server data (here: create / delete / rename a view).

Concretely for boards: a client `BoardViews` component reads the active view from `useSearchParams`
and decides Table-vs-Kanban on the client; `ViewSwitcher` tab clicks call `pushState`. The board
payload is fetched once on initial load and read from the existing React Query cache thereafter.

## Consequences

- View switching becomes an instant client re-render — zero Supabase round-trips.
- The URL stays shareable/bookmarkable (`?view=` still reflects the active view).
- Follow-up (separate plan): hoist `useBoardCache`/`useBoardRealtime` so views don't remount,
  memoize the per-render derivations, virtualize Kanban, and add a `cell_values(board_id)` index
  with a bounded fetch.

## Rule for specs and plans

When `brainstorming`/`writing-plans` (agent or human) designs a feature with a UI that has
**multiple views, tabs, filters, or sorts over the same data**, the spec/plan MUST state a
**performance & data-fetching budget**:

1. What is fetched on **first load** vs. on each **interaction**? In-page toggles should be **0 new
   server round-trips** (read from cache / client state), not a refetch.
2. Does the interaction change **server data**? If no → client state + History API. If yes → Server
   Action + targeted revalidation.
3. For lists/boards: is rendering **bounded** (pagination/virtualization) and are the **filter
   columns indexed**? No unbounded `select *` over growing tables on a hot path.

If a plan can't answer these, it isn't ready to build.
