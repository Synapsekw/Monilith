---
type: session
date: 2026-09-09-1131
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-09-gotcha-102-a-new-postgres-function-is-executable-by-anon-until-you-revoke-it]]"
---

# Board view preferences persist per user

## What changed

- **New `board_view_prefs` table** (migration `20260909064520`), one row per `(user_id, board_id)`
  holding a strict-Zod `jsonb` blob: collapsed groups, expanded sub-item rows, last active view,
  last filter query. Default-deny RLS, every policy scoped to `user_id = auth.uid()`, org
  membership asserted on writes. `save_board_view_prefs` is a security-invoker RPC so the board
  lookup that resolves `org_id` runs under the caller's RLS — one round trip, and a user cannot
  create a row for a board they cannot see.
- **Group collapse was lifted out of `GroupSection`.** It had lived as a separate `useState` in
  every group, so nothing in the tree knew the full set and nothing could persist it. It now lives
  in a `BoardViewPrefsProvider` alongside row expansion; `GanttBoard` dropped its private copy and
  shares the same set.
- **The board page reads prefs as a fourth entry in its existing `Promise.all`** — a point read on
  the primary key, so the first painted frame is already correct with no expand-then-collapse
  flash. The URL still wins: a link carrying `?view=` or filter params behaves exactly as before.
- **Writes are debounced 800 ms and coalesced into one upsert, with no revalidation.** Per-user
  chrome that no other client's query renders, so revalidating would re-run every board query to
  change nothing on screen ([[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]).
- **A second migration** (`20260909070508`) revokes the PUBLIC execute grant Postgres hands every
  new function. The first migration created the RPC without the repo's lockdown idiom, so anon
  could reach the function body. Caught by `anon-reachability.conformance.test.ts`, not by review.
- Seven tasks, nine commits, merged as `59a1dd1d`. Ledger **161/161**. `gotcha-55` fired on both
  migrations — the tenth and eleventh consecutive `apply_migration` mis-stamp.
- `/updates`: announced, three entries dated today.
- **Post-merge fix (`1981a14f`): a missing arrangement crashed the board.** The owner hit
  `Cannot read properties of undefined (reading 'collapsedGroupIds')` on a running dev server. The
  proximate cause was a stale Turbopack module graph — `pnpm dev` was running across the merge, so
  a new provider was paired with an older page that had no arrangement to hand it, and a restart
  clears it. The real defect was mine: the provider read the field straight off its prop, which
  breaks the contract stated three lines above it in the same file — remembering an arrangement is
  a convenience whose absence must never break a board. The seed now spreads over
  `EMPTY_BOARD_VIEW_PREFS`, absorbing a missing prop and a half-shaped one alike. Both new tests
  were run against the unfixed code first and reproduce the reported TypeError exactly.

## Why

Arranging a board was disposable. Collapse a few groups, expand some rows, pick a view, set a
filter, and all of it was gone on the next visit — the arrangement lived in `useState` or the URL
and nowhere else. Column widths and summary aggregations already persisted, but those are
board-global and org-shared; there was no home at all for state that belongs to one person.

## How to test

1. Pull `develop`, then **stop and restart `pnpm dev`** — a server left running across the merge
   serves a stale Turbopack module graph and throws on the board page. This is on `develop`, not
   yet promoted, so test locally rather than on `www.monolith.works`.
2. Open any board with two or more groups. Collapse one group with the chevron beside its name.
   Reload the page. It should still be collapsed, and it should not flash open first.
3. Expand a row that has sub-items. Reload. The sub-items should still be showing.
4. Switch to the Timeline view. Navigate away to another board, then come back to this one with no
   query string on the URL. It should open on Timeline.
5. Apply a filter or a sort from the toolbar. Reload. The filter should still be applied and the
   URL should carry it. Now click Clear all and reload again — it must stay cleared, not spring
   back.
6. Paste a link that carries `?view=<some other view id>`. That view wins over your saved one.
7. Sign in as a second user on the same board, in another browser. Their arrangement must be
   independent of yours in both directions.

## Open threads

- **Not promoted.** `develop` now holds three unpromoted tracks: this one, the UI polish + theme
  presets batch, and the dependency sweep + mcp-handler v2 migration. Both migrations are on DEV
  and not on PROD.
- **Neither migration was written with the execute-lockdown idiom the first time.** The conformance
  suite caught it, but only because it exists — a new RPC needs the revoke/grant pair in the same
  migration.
- The RLS suite skips like every other integration suite, since `integrationTargetReady()` refuses
  DEV by design. Its assertions were verified out-of-band against DEV before commit.
- **Nothing in the manual pass has been walked yet.** Every claim above rests on the four gates and
  the suite; no board was opened in a browser this session. The crash the owner hit is what a first
  page load buys you and the gates could not.

## Next session entry point

Promote, or keep building. If promoting, the three tracks go together and the manual pass covers
this session's step-by-step above plus the Light-mode/preset walk the theme-presets note still
owes.
