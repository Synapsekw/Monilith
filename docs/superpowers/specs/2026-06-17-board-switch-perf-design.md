# Design — Fix slow board-to-board switching

Date: 2026-06-17
Status: approved (pending spec review)
Related: `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`

## Problem

Switching between two different boards (`/boards/A` → `/boards/B`) feels slow. This is a
**full RSC navigation**, which is correct — board B is genuinely different server data. The slowness
is in how that navigation is wired, not in the data volume.

Evidence gathered during investigation:

- DB is tiny (110 items, 282 columns, 42 cell_values, 8 dependencies across 94 boards), so per-board
  query/row cost is negligible today. Row scanning is **not** the current cause.
- The board route is a single `src/app/boards/[boardId]/page.tsx` — **no `layout.tsx`, no
  `loading.tsx`**.

Root causes (ranked by impact on perceived switch latency):

1. **No `loading.tsx`** → no Suspense boundary. On click, Next.js keeps the old board frozen on
   screen and shows nothing until the entire server render (~10 queries) completes. Zero instant
   feedback is the dominant _felt_ slowness.
2. **The whole `AppShell` (sidebar, workspaces, board list) is rendered inside the page** and its
   data (`getUserOrgs`, `listBoards`, `workspaces`) fetched in `page.tsx`. None of it changes
   between boards, but with no shared layout it is re-fetched and the sidebar remounts on every
   switch — roughly half the queries per switch are pure waste.
3. **Serial waterfall**: `requireUser()` → `getBoardPayload()` → `Promise.all([...4 shell
queries])`, stacking latency layers and making the independent shell queries wait on the board
   payload.

Confirmed against the bundled Next.js 16 docs:

- Shared layouts are **preserved and do not re-render** on navigation between sibling dynamic
  segments (`03-layouts-and-pages.md:43`). → moving the shell into a layout removes the shell
  refetch on switch.
- `loading.tsx` shows an **instant** fallback while the layout stays visible/interactive
  (`loading.md:46-48`).
- Default `prefetch="auto"` prefetches a dynamic route **down to its `loading.js` boundary**
  (`link.md:301-304`) → adding `loading.tsx` makes the existing sidebar links prefetch the skeleton
  with **no `<Link>` change**.
- A layout at `app/boards/layout.tsx` does not receive `boardId`; `useParams()` in a client
  component reads it from the URL (`use-params.md`).

## Design

### New route structure

```
app/boards/
  layout.tsx          NEW: persistent shell, fetched once, preserved across switches
  [boardId]/
    page.tsx          slimmed to board-only data
    loading.tsx       NEW: board-content skeleton (sidebar persists from layout)
```

### `boards/layout.tsx` (server component, async)

Runs once and is preserved across `/boards/A → /boards/B`.

- `requireUser()` for the user menu.
- Parallel `Promise.all([getUserOrgs(), listBoards(), supabase.from("workspaces").select("id, name")])`.
- Renders `<AppShell user org workspaces boards>{children}</AppShell>`.

### `[boardId]/page.tsx` (server component, async)

The only segment that re-runs on a board switch.

- `requireUser()` (deduped — see `session.ts` change) for `currentUserId`.
- `getBoardPayload(boardId)` → `notFound()` when null.
- `resolveSelectedView(payload.views, view)` from `searchParams` (unchanged).
- `listOrgMembers(payload.board.org_id)`.
- Renders `<BoardViews payload members initialViewId currentUserId />`. No `AppShell` here.

Note: `getBoardPayload`'s internal `board`-then-batch waterfall is **left as-is** (not flattened) —
explicitly out of scope per decision.

### `[boardId]/loading.tsx`

A board-content-area skeleton (header bar + table-row shimmer) built from existing `ui` primitives,
matching `pulse-ui` tokens. The sidebar/header from the layout stay mounted, so the click is
instant.

### Supporting edits

- `src/lib/auth/session.ts`: wrap `getUser` in React `cache()` so the layout and page share **one**
  `supabase.auth.getUser()` call per request instead of two.
- `src/components/app-shell.tsx`: remove the `activeBoardId` prop (no longer passed down).
- `src/components/boards/BoardsNav.tsx`: remove the `activeBoardId` prop; derive the active board
  from `useParams<{ boardId: string }>().boardId`.

### Data-fetching budget (per the working agreement)

- **First load of a board:** layout shell queries (once) + page board-payload + members.
- **Subsequent board switch:** layout preserved (0 shell queries); only board-payload + members
  re-fetched; instant `loading.tsx` skeleton; sidebar links pre-warmed via default prefetch.
- **In-page view switch (Table/Kanban/Calendar):** already 0 round-trips via History API (gotcha-09).

## Out of scope (deferred, logged as ADR)

`getBoardPayload` reads `items`, `cell_values`, and `item_dependencies` **unbounded** (`select *`,
no `.limit()`). Harmless at current data volume but a scaling risk once boards reach hundreds of
items. Recorded as a vault decision for a future bounded/paginated read; **not** built here.

## Testing

- Update `src/components/boards/BoardsNav.test.tsx`: add `useParams` to the `next/navigation` mock;
  assert the active board highlight derives from `useParams`.
- Update `src/components/app-shell.test.tsx`: drop `activeBoardId`.
- Add coverage for the new `boards/layout.tsx` (renders shell + children) and the slimmed
  `page.tsx` / `loading.tsx` as feasible within the existing test setup.
- Gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.
