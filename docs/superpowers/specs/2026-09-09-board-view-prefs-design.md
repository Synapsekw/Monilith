# Board view preferences — per-user, per-board, persisted

**Date:** 2026-09-09
**Status:** Approved (design)

## Problem

Open a board, collapse a couple of groups, expand some sub-items, switch to the
Timeline view, apply a filter. Close the tab. Come back to the same board and
every one of those choices is gone: the groups are expanded again, the rows are
collapsed again, you are back on the first view with no filter.

Everything a user arranges on a board today is either ephemeral React state or
lives only in the URL:

| State                               | Where it lives now                                                          | Survives a revisit?   |
| ----------------------------------- | --------------------------------------------------------------------------- | --------------------- |
| Group collapse                      | `useState(false)` per `GroupSection`                                        | No                    |
| Sub-item row expansion              | `useState<Set<string>>` in `BoardTableInner`, a second copy in `GanttBoard` | No                    |
| Active view tab                     | `?view=` in the URL, resolved server-side                                   | Only via a saved link |
| Filter / sort / quick-search        | URL query params (History API)                                              | Only via a saved link |
| Column widths, summary aggregations | Database, but **board-global and org-shared**                               | Yes, for everyone     |

The board-global things are fine as they are. The gap is the per-user layout
state, which currently has no home at all.

## Goal

A user's own arrangement of a board persists across reloads, tabs, sessions and
devices, without changing what anyone else sees and without costing a server
round-trip on any in-page interaction.

## Non-goals

- Sharing arrangement between users. This is strictly per-user state.
- Persisting column widths or summary aggregations differently. Those are
  already board-level and shared on purpose.
- A general-purpose user-preferences service. This table is board view state
  only; other preferences keep their existing homes (`profiles.theme_preset`,
  `notification_preferences`, the `pulse-ui` localStorage store).

## Storage

A new table, one row per user per board.

```sql
create table public.board_view_prefs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, board_id)
);
```

The primary key is also the only index the feature needs: every read is a point
lookup on `(user_id, board_id)` and every write is an upsert on the same key.

`org_id` is denormalised from the board so the write policy can assert org
membership without a join, and so the row dies with the org.

### Row-level security

Default-deny, four policies, all of them `user_id = auth.uid()`. Writes
additionally require `is_org_member(org_id)`, the helper used throughout the
schema. A user can only ever see or write their own row; there is no policy
under which one user's arrangement is visible to another.

### The `state` blob

Validated by a strict Zod schema at both boundaries — before the write, and
again on read, because a row written by an older client version must not be
trusted to match the current shape.

```ts
{
  viewId?: string | null,        // last active board view
  collapsedGroupIds?: string[],  // capped at 500
  expandedItemIds?: string[],    // capped at 500
  filterQuery?: string,          // serialized filter params, capped at 2000 chars
}
```

Scope is per board, not per view. Groups are a board-level concept in the table
view, and the filter already applies across views through a single set of URL
params, so per-board matches the behaviour that exists.

`filterQuery` deliberately stores the **serialized URL query string** for the
filter params (`q`, `people`, `status`, `filter`, `sort`) rather than a parsed
object. The existing `serializeBoardFilter` / `parseBoardFilter` pair is then
the only encoder in the system, so the persisted form and the URL form cannot
drift, and no second schema has to mirror the `ListFilter` condition tree.

Unknown or malformed state fails open: the board renders with today's defaults.

## Reading — first paint, no flash

`src/app/(app)/boards/[boardId]/page.tsx` already issues three queries inside
one `Promise.all`. The prefs read joins that array as a fourth. It is a
single-row primary-key lookup running in parallel with work that is already
slower, so it costs no measurable added latency.

Because the state is resolved server-side, the first rendered frame is already
correct: collapsed groups arrive collapsed, the saved view is the view that
renders. There is no expand-then-collapse flash.

**The URL always wins.** Saved state is consulted only for values the URL does
not carry. A link with `?view=` opens that view; a link carrying filter params
opens with those filters. This keeps every shared link and bookmark behaving
exactly as it does today, and it means the persistence is invisible to anyone
who arrives by link.

## Writing — zero extra round-trips on interaction

Toggling a group updates local React state immediately; the UI never waits on
the network. A debounced Server Action (about 800 ms, coalescing into a single
upsert of the whole blob) writes the row.

The action **must not revalidate**. This is per-user chrome that no other
client's query renders, so `revalidatePath` would re-run every board query on
the page to change nothing on screen — precisely the regression recorded in
`vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`.

Writes are fire-and-forget: a failed persist is logged and dropped, never
surfaced as an error and never allowed to roll back the local state. Failing to
remember a collapsed group is not worth interrupting the user for.

The action returns `ActionResult` from `src/lib/actions/result.ts` and uses
`fail` for its failure arm, per the canonical-modules invariant.

## Performance and data-fetching budget

Answering working agreement #5 directly:

**(a) First paint vs. interaction.** First paint adds exactly one primary-key
row read, issued in parallel with the three queries already there. Every in-page
interaction — collapsing a group, expanding a row, switching a view, changing a
filter — costs **0 new server reads**. The only network traffic an interaction
produces is the debounced write.

**(b) Does the interaction change server data?** Yes, but only the user's own
prefs row, which nothing else renders. So: Server Action for the write,
deliberately **no revalidation**. View switching and filtering keep using the
History API exactly as they do now, never a `<Link>` or router navigation.

**(c) Is the hot-path read bounded?** It is a point read of one row on the
primary key. The blob is bounded too: both id arrays cap at 500 entries and
`filterQuery` at 2000 characters, so a long-lived row cannot grow without limit.

## Staleness

Groups and items get deleted while ids sit in a saved blob. Two defences:

1. **On read**, the client intersects saved ids against the ids actually present
   in the loaded board. A dead id simply has no effect.
2. **On write**, the pruned set is what gets persisted, so dead ids fall out of
   the row the first time the user touches the board after a deletion.

The 500-entry cap is the backstop if both somehow fail.

## The refactor this needs

Group collapse currently lives as `useState` inside each `GroupSection`, one
independent copy per group. Nothing in the tree knows the full set, so nothing
can persist it.

It lifts to `BoardTableInner` as a single `collapsedGroups: Set<string>`,
mirroring the `expandedItems` set that already lives there. `GroupSection` takes
`collapsed` and `onToggleCollapse` as props and stops owning the state.
`GanttBoard` drops its private expansion copy and shares the same set, so
expanding a row in the table and switching to Timeline shows it expanded there
too.

This is the minimum change that makes the state addressable. No other
restructuring is in scope.

## The one sharp edge: clearing a filter

A naive rule — "if the URL has no filter params, use the saved filter" — has a
bug. Clearing a filter removes the params from the URL, which immediately looks
identical to a fresh visit, so the filter the user just cleared springs back.

The rule is therefore narrower: **the saved filter seeds the first render only.**
Once the session has written the filter URL even once, the URL is authoritative
and an empty URL means an empty filter. Clearing also persists the cleared
state, so the next visit opens unfiltered.

## Components

| Unit                           | Responsibility                                                              | Depends on   |
| ------------------------------ | --------------------------------------------------------------------------- | ------------ |
| Migration + regenerated types  | `board_view_prefs` table, RLS, type regen                                   | —            |
| `src/lib/boards/view-prefs.ts` | Zod schema, read query, `saveBoardViewPrefs` Server Action                  | Migration    |
| Collapse/expansion lift        | `GroupSection` to `BoardTableInner`; `GanttBoard` shares the set            | Prefs module |
| View + filter seeding          | Board page passes saved view and filter; `useBoardFilterSort` seeds from it | Prefs module |

The last three are independent of one another and can be built in parallel once
the first two exist.

## Testing

- **Schema unit tests** — the Zod schema rejects over-cap arrays, over-long
  filter strings and unknown keys; malformed stored state parses to defaults.
- **Filter seeding** — a saved filter applies on first render; clearing it does
  not resurrect it; a URL filter beats the saved one.
- **Collapse lift** — toggling a group updates the lifted set; stale ids are
  pruned against the live board.
- **View resolution** — `?view=` beats the saved view; the saved view is used
  when the URL is silent; a deleted saved view falls back to the first view.
- **RLS** — a second user cannot read or write the first user's row. Runs
  against DEV only when `PULSE_TEST_DB` is set, as with the other integration
  suites.

All four gates must pass: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
