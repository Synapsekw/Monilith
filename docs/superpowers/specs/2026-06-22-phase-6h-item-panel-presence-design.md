# Phase 6h follow-up — Item-panel "who's viewing this item" presence

Date: 2026-06-22
Status: Design (approved for planning)
Related:

- `docs/superpowers/specs/2026-06-22-phase-6h-realtime-collaboration-design.md`
- `docs/superpowers/plans/2026-06-22-phase-6h-realtime-collaboration.md`
- `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`
- `vault/decisions/2026-06-22-gotcha-36-realtime-socket-integration-tests-need-native-event-globals-under-jsdom.md`

## Problem

Phase 6h shipped real-time collaboration presence: a board-wide avatar stack
(`BoardPresenceBar`) plus per-element "who's editing here" rings (`PresenceRing`)
driven by Supabase Realtime Presence on the private channel
`presence:board:<id>`, using a shared focus-target model (`PresenceFocus =
{ viewKind, targetId }`).

The gap: when a user opens the item detail panel (the `?item=` drawer rendered by
`ItemPanel`), there is **no signal of who else has that same item open**. Two
people can be reading/working the same item with zero awareness of each other.

## Goal (this slice)

Add a "who's viewing this item" indicator to the **item-panel header**: an avatar
stack of the _other_ users who currently have the same item's panel open. Keyed
purely on the open item id. Reuse the existing presence channel, focus-target
model, and avatar primitives.

## Out of scope (blocked / deferred)

- **Field-level "who's editing this field" indicators in the panel.** Blocked on
  inline field editing in the panel, which does not exist yet (the Fields tab is a
  placeholder pointing users to the grid). This slice is **only** panel-open
  _viewing_ presence keyed on the open item id — not per-field editing presence.
- No DM/notification, no "follow them," no cursor sharing.

## What already exists (verified in code — reuse, do not rebuild)

- **Provider boundary is already correct.** `BoardViews` renders `<ItemPanel />`
  **inside** `<BoardPresenceProvider value={presenceValue}>`
  (`src/components/boards/BoardViews.tsx`, lines ~129–145). The panel already sits
  in the presence context — **no provider plumbing needed**.
- **The panel open-id is already client state via History API.** `openItemId =
searchParams.get("item")` (BoardViews ~81). Opening/closing the panel is a
  `window.history.pushState` (`closeItem`, ~86–90) — **0 RSC re-runs**, satisfying
  gotcha-09. Presence is owned high in the tree (the provider wraps both the view
  and the panel), so it survives view switches.
- **Focus model + hook.** `PresenceFocus = { viewKind: PresenceViewKind;
targetId: string }` and `viewKind: "panel"` already exist
  (`src/lib/boards/presence-types.ts`). `usePresenceFocus(target, active)`
  (`src/lib/boards/use-presence-focus.ts`) registers a focus target while
  `active`, clears it on blur/unmount, and no-ops outside a provider — exactly the
  lifecycle the panel needs.
- **Target builder.** `presenceTarget` (`src/lib/boards/presence-target.ts`)
  exposes `cell/card/event/field` builders but **no `item` builder yet** — that is
  the one new entry this slice adds.
- **Reducer already aggregates by target.** `toFocusMap(raw)`
  (`src/lib/boards/presence-reducer.ts`) returns `Map<targetId, RosterOccupant[]>`
  (distinct users per target). The context exposes it as `focusMap`, plus
  `selfUserId` (`src/lib/boards/use-board-presence.ts`,
  `src/lib/boards/presence-context.tsx`). So "others viewing item X" is already
  computable: `focusMap.get(presenceTarget.item(itemId)) filtered by userId !==
selfUserId`. **No reducer change needed.**
- **Avatar primitive to reuse.** `BoardPresenceBar`
  (`src/components/boards/presence/BoardPresenceBar.tsx`) is the overlapping
  avatar-stack + `+k` overflow chip + tooltip pattern, but it reads the **roster**
  (everyone on the board), not a per-target subset. `PresenceRing` reads a single
  target from `focusMap` but renders an overlay ring, not a header stack. Neither
  is a drop-in; we extract the avatar-stack rendering so both the board bar and the
  new panel indicator share one presentational component.

## Approaches considered

**A. New `ItemViewersBar` component reading `focusMap` directly (recommended).**
Add `presenceTarget.item(itemId)`. In `ItemPanel`, call
`usePresenceFocus({ viewKind: "panel", targetId: presenceTarget.item(itemId) },
open)` while the panel is open. Render a new presentational `ItemViewersBar` in the
panel header that reads `focusMap.get(target)` from context, filters out self, and
shows the avatar stack ("also viewing"). Refactor the shared avatar-stack markup
out of `BoardPresenceBar` into a small `PresenceAvatarStack` primitive that both
the board bar and the panel viewers bar consume.
_Pros:_ zero new data path, reuses reducer/context/channel verbatim, the only
"logic" is a target lookup; honors single-purpose component boundaries.
_Cons:_ one small refactor of `BoardPresenceBar` to share markup.

**B. Reuse `BoardPresenceBar` as-is by passing it a roster subset.** Compute the
viewers list in the panel and feed `BoardPresenceBar` a prop.
_Rejected:_ `BoardPresenceBar` currently reads context internally (no
roster prop); bolting a prop on muddies its single responsibility, and the panel
needs the _focusMap_ subset, not the roster — different selector.

**C. Add a dedicated "panel viewers" array to the presence context/reducer.**
_Rejected:_ YAGNI. `focusMap` already keys by target; a `presenceTarget.item`
lookup is all that's required. No reason to widen the context shape.

**Chosen: A.** It is the smallest change that respects existing boundaries and the
focus-target model, and the extracted `PresenceAvatarStack` removes duplication
between the board bar and the panel indicator.

## Design

### Components / units (each single-purpose, independently testable)

1. **`presenceTarget.item(itemId)`** — pure function, returns
   `` `item:${itemId}` ``. Mirrors the existing `card`/`event` builders. One-line
   addition to `presence-target.ts`. Tested in `presence-target.test.ts`.

2. **`PresenceAvatarStack`** (new presentational primitive, extracted from
   `BoardPresenceBar`) — props: `occupants: RosterOccupant[]`, `maxFaces?: number`,
   `ariaLabel: string`, and an optional `emptyFallback`/returns `null` when empty.
   Renders the overlapping avatar chips + `+k` overflow + tooltips. **Reads no
   context** — pure props in. `BoardPresenceBar` is refactored to compute its
   roster (as today) and delegate rendering to this primitive, so its existing
   behavior/tests stay green. Tested directly with occupant fixtures.

3. **`ItemViewersBar`** (new) — props: `itemId: string | null`. Reads
   `useBoardPresenceContextOptional()`; if no context or no `itemId`, renders
   `null`. Computes `others = (focusMap.get(presenceTarget.item(itemId)) ??
[]).filter(o => o.userId !== selfUserId)`. If empty, renders `null`. Otherwise
   renders a compact "Also viewing" label + `<PresenceAvatarStack occupants=
{others} ariaLabel="Also viewing this item" maxFaces={3} />`. Lives in
   `src/components/boards/presence/ItemViewersBar.tsx`. Tested by wrapping in a
   stub provider with a seeded `focusMap`.

4. **`ItemPanel` wiring** (edit) — when the panel is open (`itemId != null`), call
   `usePresenceFocus({ viewKind: "panel", targetId: presenceTarget.item(itemId) },
itemId != null)`. The hook no-ops when `itemId` is null (target null / inactive)
   and clears on close/unmount. Render `<ItemViewersBar itemId={itemId} />` in the
   `SheetHeader`, next to the title. No prop-drilling — `ItemViewersBar` reads
   context the same way `PresenceRing` already does.

### Data flow

```
ItemPanel open (itemId from ?item=, History API)
  └─ usePresenceFocus({viewKind:"panel", targetId:"item:<id>"}, true)
        └─ ctx.setFocus  →  channelRef.track(state)  [throttled 150ms]
                              └─ Supabase Realtime Presence (presence:board:<id>)
                                    └─ other tabs receive sync/join/leave
                                          └─ useBoardPresence setRaw → toFocusMap
                                                └─ context.focusMap
ItemViewersBar (other user's panel header)
  └─ focusMap.get("item:<id>")  minus self  →  PresenceAvatarStack
```

When the user closes the panel (or navigates the item away, or unmounts), the hook
calls `setFocus(null)` → the next `track` clears their focus → others' panels drop
the avatar. Multi-tab dedupe is already handled by `toFocusMap` (distinct by
userId).

### Error / edge handling

- **No provider / isolated render:** `ItemViewersBar` and `usePresenceFocus` both
  no-op (context optional). Panel still works.
- **Self only:** others filtered out → renders `null` (no "you are viewing").
- **Channel not yet `SUBSCRIBED`:** `focusMap` is empty → renders `null`; fills in
  on first sync. No spinner — presence is ambient.
- **Item switched while panel open** (`?item=` changes to a new id without closing):
  `usePresenceFocus` depends on `target.targetId`, so it re-fires `setFocus` with
  the new `item:<id>` and clears the old — verified against the hook's dep array.
- **`maxFaces` overflow:** handled by `PresenceAvatarStack`'s `+k` chip (same as
  the board bar). Panel cap is smaller (3) since header space is tighter.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint:** 0 new server round-trips. The panel already opens from
  already-loaded cache (`payload.items.find`); this slice adds only an in-memory
  `focusMap` lookup.
- **Each interaction:** Opening/closing the panel is `pushState` (no RSC re-run,
  gotcha-09). Registering focus is a throttled (150ms) Realtime `track` — an
  ephemeral WebSocket message, **not** a server round-trip / DB write.
- **Server data changed?** No. Viewing presence is ephemeral; it rides the
  existing private channel. So: client state + History API + Realtime presence —
  **no Server Action, no revalidation, no new query**.
- **Bounded reads:** No DB read at all. `focusMap` is bounded by channel occupancy
  (the board's online members), already capped/deduped in the reducer; the UI caps
  faces with an overflow chip.
- **Survives view switches:** Presence/provider are owned high in the tree
  (`BoardPresenceProvider` wraps both `view` and `ItemPanel`), so switching views
  does not tear down presence.

## Security

- **No new DB table, no new migration.** Confirmed: this slice reads only the
  in-memory `focusMap` derived from the existing presence channel. The channel
  `presence:board:<id>` is already a **private** channel gated by RLS
  `can_read_board` (established in 6h). Only board members can join, so only board
  members' presence is ever visible — the existing tenant boundary covers it.
- **Zod at boundaries:** The only new boundary is the focus-target string. The
  presence payload (`PresenceState`) is already the shared shape; `targetId` is an
  opaque string. We add a Zod schema for the panel focus target builder's input
  (`itemId` is a non-empty string / uuid) where the panel constructs it, to keep
  the "validate at boundaries" invariant — no untyped string flows into the
  channel from this slice. (Lightweight: the builder is pure; validation guards the
  call site in `ItemPanel`.)

## Testing strategy (TDD — AGENTS.md #4)

- **`presence-target.test.ts`:** add a case for `presenceTarget.item(itemId)` ⇒
  `item:<id>` (and uniqueness vs `card`).
- **`PresenceAvatarStack.test.tsx`:** renders N faces, `+k` overflow at the cap,
  tooltips, empty ⇒ `null`. (Move/duplicate the relevant `BoardPresenceBar`
  assertions onto the extracted primitive.)
- **`BoardPresenceBar.test.tsx`:** keep green after the refactor (delegates to the
  primitive; behavior unchanged).
- **`ItemViewersBar.test.tsx`:** stub `BoardPresenceProvider` with a seeded
  `focusMap` keyed on `item:<id>`; assert (a) renders others, (b) filters self,
  (c) `null` when no others, (d) `null` when no `itemId`/no provider.
- **`ItemPanel` test:** assert that opening with an `itemId` registers a panel
  focus (spy on context `setFocus`) and that the header renders `ItemViewersBar`;
  closing clears focus.
- **No new socket integration test required** for this slice (no new channel/RLS
  path). If one is added later, follow **gotcha-36**: restore native
  `Event`/`EventTarget` globals under jsdom, symlink `.env.local`, bump per-test
  timeout (~30s), and tear down channels in `afterAll`. Noted so the builder
  doesn't trip on it.

## UI / design notes

- Load **`pulse-ui`** + **`frontend-design`** skills before building the visual
  bits. Honor the monochromatic + single-accent system: chrome stays monochrome;
  the only color is the per-user presence color (already applied inline as an inner
  ring on avatar chips — reuse verbatim from `BoardPresenceBar`/`PresenceRing`).
- Header treatment: small "Also viewing" muted label + the avatar stack, right of
  the title in `SheetHeader`. Cap faces at 3 in the tighter header. Tooltips list
  names. No layout shift when empty (renders `null`).

## Independent units (for the execution DAG)

- **U1 `presenceTarget.item`** — pure, no deps. Independent.
- **U2 `PresenceAvatarStack`** (extract from `BoardPresenceBar`) — presentational,
  depends only on existing `RosterOccupant` type. Independent of U1.
- **U3 `ItemViewersBar`** — depends on **U1** (target builder) and **U2** (stack
  primitive).
- **U4 `ItemPanel` wiring** — depends on **U1** (builds the target) and **U3**
  (renders the bar).

U1 and U2 are fully parallel; U3 joins them; U4 finishes. See the plan's Execution
DAG.
