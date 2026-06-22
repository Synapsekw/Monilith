# Phase 6h — Real-time collaboration (presence + visible last-write-wins) — design

**Date:** 2026-06-22
**Status:** Approved (spec)

## Problem & context

Pulse already has working `postgres_changes` realtime **data** sync on boards
(`src/lib/boards/use-board-realtime.ts`, channel `board:${boardId}`): cell values, items,
columns, groups, and dependencies reconcile into the `["board", boardId]` React Query cache and
re-render every viewer. That part is solid and **must not change**.

What's missing — and what hurts when people share a board — is everything *around* that sync:

1. **No awareness of others.** You can't see who else is on the board, or who is editing the
   exact cell/card/field you're about to touch. Collaboration feels blind.
2. **Silent clobbering.** Conflict resolution is last-write-wins (LWW). Two people editing the
   same cell means the second write silently overwrites the first, with no signal to either
   person that it happened.

This is **not** a reliability problem (sync works), and **not** primarily a coverage gap. It is
an *awareness* and *conflict-visibility* problem. Phase 6h adds a presence layer on top of the
existing data sync, and makes LWW collisions **seen** rather than silent.

## Goals

- **Awareness — board-wide:** a live avatar stack in the board header showing who is currently
  on this board (across all views).
- **Awareness — per-element:** "who is editing here" markers on the specific element another user
  has focused — in **every** view (Table cells, Kanban cards, Calendar/Gantt events) and the
  item-detail panel (fields).
- **Visible LWW:** when a value changes under an element the local user currently has focused, a
  brief flash + a small toast attributed to the person who changed it. Nothing blocks; LWW stays.
- **Reconnect resync:** after a presence-channel drop/reconnect, do one bounded board refetch so
  anything missed while offline is caught up.

## Non-goals (explicitly out of scope for v1)

- **No locking / no pessimistic concurrency.** Collisions are made visible, never prevented.
- **No live cursors / no continuous selection streaming.** Focus is discrete (click → focus,
  blur → clear), throttled — not a high-frequency mouse/selection stream.
- **No schema for presence.** No new tables; no `updated_by` column on any data table; the
  existing `postgres_changes` data channel is untouched.
- **No cross-board presence**, no "currently typing…" character streaming, no historical
  presence/audit.

## Settled decisions (do not re-litigate)

1. **Conflict strategy = visible LWW, no locking.** Keep LWW; surface collisions with a brief
   flash + small toast only when the changed value is under the local user's *currently focused*
   element. Never block the user.
2. **Awareness level = editing indicators.** Board-wide avatar stack + per-element "who is
   editing here" markers. No live cursors / continuous selection streaming.
3. **Surfaces = all views.** Per-element indicators in Table (cells), Kanban (cards),
   Calendar + Gantt (events), and the item panel (fields). Avatar stack is board-wide.
4. **Transport = Supabase Realtime Presence on a private channel, schema-free.** A **separate**
   channel `presence:board:${boardId}` (the existing `board:${boardId}` data channel is left
   completely alone). No new tables, no `updated_by` column.
5. **Security = private channel via Realtime Authorization.** Presence/Broadcast channels are
   **not** gated by table RLS — any authenticated user could otherwise join
   `presence:board:<id>` and read presence. The channel MUST be **private**, enforced by an RLS
   policy on `realtime.messages` that extracts the board id from the topic and calls the existing
   `public.can_read_board(uuid)` SECURITY DEFINER function. See **Security model** below.

## Architecture & units

### Channel & message model

- **Channel topic:** `presence:board:${boardId}` (distinct from the data channel `board:${boardId}`).
- **Private:** the browser client subscribes with `config: { private: true }`. The
  `@supabase/ssr` browser client already carries the user's auth JWT, which Realtime uses to
  evaluate the `realtime.messages` RLS policy at join time — no extra `setAuth` plumbing needed
  for the standard authenticated session (verified against the current Realtime Authorization
  docs).
- **Transport = Presence only** (no Broadcast in v1). Each client `track()`s an ephemeral
  presence payload; join/leave/sync events drive the roster. The "who changed it" attribution for
  the LWW flash is read **from presence state**, not from any DB column.

### Presence payload (ephemeral, per-tab)

```ts
type PresenceFocus = {
  viewKind: "table" | "kanban" | "calendar" | "timeline" | "panel";
  targetId: string; // composite id — see focus-target model
};

type PresenceState = {
  userId: string;
  name: string; // EditorMember.fullName ?? email ?? "Someone"
  avatarUrl: string | null;
  color: string; // deterministic hash of userId
  focus: PresenceFocus | null; // null when nothing is focused
};
```

### Unit 1 — Realtime-Authorization migration + private-channel helper (foundation)

- **Migration** `supabase/migrations/<ts>_realtime_presence_authorization.sql`:
  - Adds two RLS policies on `realtime.messages` (the table Realtime uses to compute per-client
    access at connect time), both scoped to `extension = 'presence'` and `to authenticated`:
    - **SELECT** (receive presence) — `using (...)`
    - **INSERT** (publish presence) — `with check (...)`
  - Both predicates extract the board id from the topic and gate on the existing function:

    ```sql
    public.can_read_board( (split_part(realtime.topic(), ':', 3))::uuid )
    ```

    The topic is `presence:board:<uuid>`, so `split_part(topic, ':', 3)` is the uuid. Guard the
    cast so a malformed topic fails closed (no policy match → denied), e.g. only treat the topic
    when it matches `presence:board:%`.
  - A short comment notes the prerequisite: Realtime "Allow public access" must be **off** for the
    project so private channels are actually enforced (project setting, recorded here for
    traceability — not click-ops schema).
- **Client helper** `src/lib/boards/presence-channel.ts`:
  - `boardPresenceTopic(boardId: string): string` → `presence:board:${boardId}`.
  - `createBoardPresenceChannel(boardId)` → builds the private channel from the browser client
    (`createClient().channel(topic, { config: { private: true } })`). Single source of truth for
    the topic string so the migration's `split_part` index and the client never drift.

**Interfaces — Consumes:** existing `public.can_read_board(uuid)`; `@/lib/supabase/client`.
**Produces:** the RLS policies; `boardPresenceTopic`, `createBoardPresenceChannel`.

### Unit 2 — presence reducer + identity/color util (pure logic)

- `src/lib/boards/presence-color.ts` — `presenceColor(userId: string): string`: deterministic
  hash → one of a fixed palette (Pulse accent-compatible). Same user → same color everywhere.
- `src/lib/boards/presence-reducer.ts` — pure functions over the raw Supabase presence state
  (`channel.presenceState()` shape: `Record<presenceKey, PresenceState[]>`):
  - `toRoster(raw, selfUserId)` → deduped list of occupants (merge a user's multiple
    tabs/presence-keys into one roster entry; self may be flagged but is still counted).
  - `toFocusMap(raw)` → `Map<targetId, RosterOccupant[]>` (who is focused on each target).
  - `flashDecision({ incomingTargetId, incomingValue, focusedTargetId, currentValue })` →
    `boolean` (true ⇢ flash+toast): true only when `incomingTargetId === focusedTargetId` **and**
    `incomingValue` differs from `currentValue`.
  - These are framework-free and unit-tested against fixture presence states — no live socket.

**Interfaces — Consumes:** `PresenceState` type. **Produces:** `presenceColor`, `toRoster`,
`toFocusMap`, `flashDecision`, `RosterOccupant`/`PresenceState` types. (Independent of Unit 1 —
testable against mock presence states in parallel.)

### Unit 3 — `useBoardPresence` hook + `usePresenceFocus` hook

- `src/lib/boards/use-board-presence.ts`:
  - `useBoardPresence(boardId, self: { userId; name; avatarUrl })` — **owned by `BoardViews.tsx`**
    (mounted once, persists across view switches; never remounts per-view — respects
    gotcha-09). Subscribes the private presence channel via `createBoardPresenceChannel`,
    `track()`s the local `PresenceState`, listens to `presence` `sync`/`join`/`leave`, and keeps a
    derived `{ roster, focusMap }` in React state (computed via Unit 2's reducer).
  - Returns `{ roster, focusMap, setFocus, channelStatus }`. `setFocus(focus | null)` re-`track()`s
    the local state with a **throttled** update (focus changes are discrete clicks; throttle to
    coalesce rapid focus churn — target ~no more than a few updates/sec).
  - **Reconnect resync:** on the channel transitioning back to `SUBSCRIBED` after a prior drop,
    invalidate/refetch `["board", boardId]` **once** (bounded) via React Query so anything missed
    while offline is reconciled. Presence itself auto-resyncs.
- `src/lib/boards/use-presence-focus.ts`:
  - `usePresenceFocus(target: PresenceFocus | null)` — a thin hook each editable element calls on
    focus/blur. Reads `setFocus` from a small React context (`BoardPresenceProvider`, provided by
    `BoardViews`) so views/cells don't need prop-drilling. On focus → `setFocus(target)`; on
    blur/unmount → `setFocus(null)`.
  - Also exposes `useBoardPresenceContext()` → `{ focusMap, roster }` for `PresenceRing` lookups.

**Focus-target model (one abstraction, all views):** stable composite ids built by a single
helper `presenceTarget` in `src/lib/boards/presence-target.ts`:

| Surface     | targetId format            |
| ----------- | -------------------------- |
| Table cell  | `cell:${itemId}:${columnId}` |
| Kanban card | `card:${itemId}`           |
| Cal/Gantt   | `event:${itemId}`          |
| Panel field | `field:${itemId}:${fieldKey}` |

**Interfaces — Consumes:** Unit 1 (`createBoardPresenceChannel`), Unit 2 (reducer + color),
React Query client (`["board", boardId]`). **Produces:** `BoardPresenceProvider`,
`useBoardPresence`, `usePresenceFocus`, `useBoardPresenceContext`, `presenceTarget`.

### Unit 4 — UI primitives (`pulse-ui` + `frontend-design` skills required at build time)

- `src/components/boards/presence/BoardPresenceBar.tsx` — avatar stack in the board header.
  Renders ~5 faces + a "+k" overflow chip; each face is colored by `presenceColor`, with a
  tooltip naming the user. Caps the **rendered** avatar count (overflow folded into "+k") so a
  busy board never renders dozens of nodes.
- `src/components/boards/presence/PresenceRing.tsx` — `<PresenceRing target=… />`: looks up
  `focusMap.get(target)` from context; if one or more *other* users are focused there, overlays a
  colored ring/initials badge (their color). Renders nothing when the target has no other
  occupants. This is the only per-view rendering primitive — each view drops it onto its element.

**Interfaces — Consumes:** Unit 3 context (`useBoardPresenceContext`), Unit 2 color.
**Produces:** `<BoardPresenceBar>`, `<PresenceRing>`.

### Unit 5 — view wiring (4 parallel sub-tasks; disjoint files)

Each view: render `<PresenceRing target={presenceTarget(...)} />` on its element and call
`usePresenceFocus(target)` from the element's focus/blur. **No view fetches anything** — all data
comes from the shared context map.

- **5a — Table** (`BoardTable.tsx` + cell wrapper): `cell:${itemId}:${columnId}`.
- **5b — Kanban** (`KanbanBoard.tsx`): `card:${itemId}`.
- **5c — Calendar + Gantt** (`CalendarBoard.tsx`, `GanttBoard.tsx`): `event:${itemId}`.
- **5d — Item panel** (`item-panel/…`): `field:${itemId}:${fieldKey}` per editable field.

Plus the header mount of `<BoardPresenceBar>` (in `BoardViews`/`BoardHeader`) and the
`BoardPresenceProvider` wrapper — done in `BoardViews` as part of Unit 3 integration.

**Interfaces — Consumes:** Unit 3 (`usePresenceFocus`, `presenceTarget`), Unit 4
(`<PresenceRing>`). **Produces:** presence indicators live in each view.

### Unit 6 — visible-LWW flash

- `src/lib/boards/use-lww-flash.ts` (or folded into the data-realtime path via a small callback):
  when an incoming `postgres_changes` event from the **existing** data sync targets an element the
  local user currently has focused **and** the value differs (`flashDecision` from Unit 2), trigger
  a brief flash on that element + a toast: *"<name> changed this just now"*, where `<name>` is the
  presence occupant of that target (fallback **"Updated just now"** if they've already left).
- **No change to `use-board-realtime.ts`'s reconciliation behavior** — the flash hook observes the
  same events (e.g. via a lightweight subscription callback or an event the data hook emits); it
  does not alter how the cache is patched. Attribution comes from presence (`focusMap`/`roster`),
  never from a DB column.

**Interfaces — Consumes:** existing data-sync events, Unit 2 (`flashDecision`), Unit 3
(`focusMap`/`roster` for attribution), the toast primitive. **Produces:** the flash + toast UX.

## Security model (load-bearing)

Realtime Presence/Broadcast are **not** governed by table RLS by default. Without a private
channel, any authenticated user in *any* org could `channel('presence:board:<id>')` and read who
is on a board they cannot see — a cross-tenant leak. So:

- The channel is **private** (`config: { private: true }`). Realtime evaluates RLS policies on
  `realtime.messages` at connect/join time using the client's auth JWT and the channel topic.
- Two policies (SELECT to receive, INSERT to publish), both:
  `extension = 'presence'` **AND** `public.can_read_board((split_part(realtime.topic(), ':', 3))::uuid)`.
- `can_read_board` is the same SECURITY DEFINER function the data tables already trust (owner or
  `board_members` row). This keeps presence access **identical** to data-read access — one
  security boundary, org-scoped, no cross-tenant. A non-member's join is **denied** at the socket.
- Malformed topics fail closed (no policy match → no access). "Allow public access" must be
  **disabled** on the project's Realtime settings for private enforcement to take effect (noted in
  the migration comment and the plan's manual steps).

## Data flow

1. **First paint:** RSC renders the board exactly as today (one `getBoardPayload`, members,
   grants). The client mounts `useBoardPresence` → **one extra websocket subscribe** to the
   private presence channel. The initial roster arrives over the socket (`presence sync`) — **zero
   added server/RSC round-trips**.
2. **Focusing an element:** the element calls `usePresenceFocus(target)` → one **throttled**
   `track()` over the socket. **0 server round-trips, 0 RSC re-run, 0 React Query refetch.**
3. **Someone else focuses/edits:** presence `sync`/`join`/`leave` updates `focusMap` → affected
   `<PresenceRing>`s re-render. Data edits still flow over the **existing** data channel; if one
   lands on the locally-focused target, the LWW flash fires (Unit 6).
4. **Reconnect:** presence auto-resyncs; on `SUBSCRIBED`-after-drop the hook triggers **one
   bounded** `["board", boardId]` refetch to catch missed data. No new growing-table reads ever.

## Performance & data-fetching budget (AGENTS.md rule 5)

- **(a) First paint vs interaction.** First paint: one extra websocket subscribe, **zero** added
  server/RSC round-trips (roster comes over the socket). Each in-page interaction (view switch,
  focus) adds **zero** server round-trips: view switch is the existing History-API path (no RSC
  re-run, presence hook stays mounted in `BoardViews`); focusing an element is one throttled
  presence `track()`.
- **(b) Server data vs client state.** Presence is **ephemeral client state over the socket** — it
  is *not* server data, so it never uses Server Actions or `revalidatePath`. The only server touch
  is the **reconnect** path: one bounded React Query refetch of `getBoardPayload` (catch-up only).
- **(c) Bounded + indexed.** No new DB reads on the hot path; presence carries no table reads. The
  reconnect refetch reuses the existing bounded, indexed `getBoardPayload`. Rendered avatars are
  **capped** (≈5 + overflow); the focus map is keyed by target id (O(1) lookup per element).
- **Scale target:** ~25 concurrent editors per board. Presence payloads are tiny and ephemeral;
  `PresenceRing` renders only on targets with other occupants; the avatar bar caps rendered nodes.

## Testing strategy (TDD — mandatory)

- **Unit (pure, no socket):**
  - `presence-reducer`: `toRoster` merges a user's multiple tabs/presence-keys into one entry;
    `toFocusMap` maps `targetId → occupants`; `flashDecision` true only on same-target +
    value-differs, false otherwise.
  - `presence-color`: deterministic (same userId → same color), stays within palette.
- **Component (Testing Library + jsdom):**
  - `BoardPresenceBar`: renders ≤ cap faces, folds the rest into "+k", tooltips name users.
  - `PresenceRing`: renders a ring when another user is focused on the target; renders nothing
    when only self / nobody is.
- **Live integration (`*.integration.test.ts`, mirror the repo's live-RLS pattern):**
  - Two authenticated member clients subscribe `presence:board:<id>` (`private: true`): each sees
    the other's join/leave and a focus update.
  - A **non-member** client is **denied** subscribing to the private channel (RLS on
    `realtime.messages` via `can_read_board`) — the negative gate, mirroring existing
    `*.rls.integration.test.ts` files (service-role admin sets up users/board, anon clients act).
- **Definition of done:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green +
  manual two-browser acceptance.

### Worktree test gotchas (note for the plan)

- `*.integration.test.ts` **silently skip** in a worktree without a `.env.local` — symlink it from
  the main checkout before running the live presence/RLS tests, or they pass vacuously.
- `next build` cannot run from the worktree — run the production build in the **main checkout**
  for a clean compile graph before merge.

## Risks

- **Project setting dependency.** Private enforcement requires Realtime "Allow public access" =
  off. If left on, the policies exist but the channel isn't actually private. → Call this out as
  an explicit manual step + verify via the non-member-denied integration test.
- **Realtime RLS latency.** Per the docs, RLS on `realtime.messages` adds connect-time cost.
  `can_read_board` is `stable` + indexed on `board_members`/`boards`, so the predicate is cheap;
  still, keep the policy minimal (single function call) — covered.
- **Topic parsing fragility.** If the topic format ever changes, `split_part(...,3)` breaks.
  Mitigated by the single `boardPresenceTopic` helper as the one source of truth and a
  fail-closed cast.
- **Flash attribution gap.** If the editor has already left presence when their write lands, we
  fall back to "Updated just now" — acceptable (no schema added to guarantee attribution).
- **Tab dedup correctness.** Roster must merge multiple presence-keys for one user; covered by a
  dedicated reducer unit test.

## Independent units (for the plan's execution DAG)

- **U1** — Realtime-Authorization migration + presence-channel helper. *(foundation)*
- **U2** — presence reducer + color util. *(pure logic; parallel with U1)*
- **U3** — `useBoardPresence` + `usePresenceFocus` + provider. *(consumes U1, U2)*
- **U4** — UI primitives `BoardPresenceBar` / `PresenceRing`. *(consumes U2, U3 context)*
- **U5a–d** — view wiring: Table / Kanban / Calendar+Gantt / item-panel. *(4 parallel; consume U3, U4)*
- **U6** — visible-LWW flash. *(consumes U2, U3, existing data sync)*
- **U7** — live integration tests (presence join/leave/focus + non-member denied). *(consumes U1, U3)*

The plan turns these into a dependency graph + parallel batches + critical path.
