# Calendar open-item — design

**Date:** 2026-06-25
**Topic:** Wire the Calendar view's event bars, multi-day spans, "+N more" popover rows, and agenda rows to **open the item detail panel** on click / keyboard activation — closing the last deliberate stub left by the calendar build.
**Status:** Spec — ready for plan. Nothing built.
**Estimated size:** S (one handler in one component file + tests; no schema, no new data fetch, no new component).

---

## Problem

The Calendar view is fully built except for one deliberately-stubbed wire: clicking an event does nothing. `CalendarBoard` assembles a `shared` props object that every calendar subview receives, and it currently hard-codes:

```ts
onOpenItem: undefined as ((id: string) => void) | undefined,
```

(`src/components/boards/CalendarBoard.tsx` ~L225). Every leaf that should open an item already **accepts and calls** an `onOpenItem`/`onOpen` callback — they are wired and unit-tested — but because the board passes `undefined`, the optional-chained call (`onOpen?.(itemId)`) is a no-op. So the Table and Kanban views open the item panel on click while the Calendar silently swallows it.

Grounding (all paths relative to the worktree `.claude/worktrees/calendar-open-item`):

- `src/components/boards/CalendarBoard.tsx`
  - The `shared` object (~L218–226) threads `onOpenItem: undefined` into `CalendarMonth`, `CalendarWeek`, and `CalendarAgenda`. **This single line is the root cause.**
  - A `PointerSensor` with `activationConstraint: { distance: 6 }` is already configured (~L125–127) — the drag-vs-click discriminator already exists (see Edge cases).
- `src/components/boards/calendar/EventBar.tsx`
  - `EventBar` takes `onOpen?: (itemId: string) => void` (L56). Single-day chips (L96–123) and multi-day spans (L126–148) both fire `onOpen?.(interval.itemId)` on `onClick` with `e.stopPropagation()` (L105–108, L138–141) and on Enter/Space via `handleKeyDown` (L80–86). Already tested in `EventBar.test.tsx` (click + Enter).
- `src/components/boards/calendar/CalendarMonth.tsx`
  - Accepts `onOpenItem?` (L44), forwards it to each `BarForDay` → `EventBar` (L157, L209–222) **and** to `DayMorePopover`, whose hidden-item buttons call `onOpenItem?.(iv.itemId)` (L233, L254–260). Already tested for rendering the popover list in `CalendarMonth.test.tsx`.
- `src/components/boards/calendar/CalendarWeek.tsx`
  - Accepts `onOpenItem?` (L32), forwards to each `EventBar` as `onOpen` (L115).
- `src/components/boards/calendar/CalendarAgenda.tsx`
  - Accepts `onOpenItem?` (L47); each agenda row is a `<button>` calling `onOpenItem?.(item.itemId)` (L98).
- `src/components/boards/BoardViews.tsx`
  - The panel-open contract already exists and is used by Table/Kanban: `openItemId = searchParams.get("item")` (L81), the item is resolved from the **already-loaded** payload cache (L82–84), `<ItemPanel … onClose={closeItem}>` is rendered (L132–144), and `closeItem()` (L86–90) deletes `?item` via `window.history.pushState` — i.e. **panel close already restores the URL.** No change here.
- `src/components/boards/BoardTable.tsx`
  - The proven helper to mirror: `openItemPanel(itemId)` (L211–215) sets `?item=<id>` via `window.history.pushState` — History API, **no RSC navigation**, so the board page's queries don't re-run.

So the entire open/close/render pipeline is already in place and proven. The Calendar is the only view that doesn't feed it a handler.

---

## Goal / non-goals

**Goal.** Clicking — or keyboard-activating (Enter/Space) — any calendar event opens the item detail panel for that item, identically to the Table and Kanban views:

- a **single-day** event chip (month + week),
- a **multi-day span** (any visible segment of it, in month + week),
- a **"+N more"** overflow popover row (month), and
- an **agenda** row,

by replacing `CalendarBoard`'s `onOpenItem: undefined` stub with an `openItemPanel(itemId)` that sets `?item=<id>` via the **History API** (`window.history.pushState`), exactly mirroring `BoardTable.openItemPanel`. `BoardViews` already reads `?item=` and renders `ItemPanel`; close already restores the URL.

**Non-goals (YAGNI).**

- **No shared-helper extraction.** Two call sites (`BoardTable`, `CalendarBoard`) is below the threshold where a shared `lib` helper earns its keep; duplicating the 4-line function keeps each view self-contained and matches the existing codebase (the helper already lives inline in `BoardTable`). Extraction can happen later if a third view needs it.
- **No router/`<Link>` navigation.** That would re-run the whole board page (every query) on each open — the exact anti-pattern AGENTS.md #5 / gotcha-09 forbids. History API only.
- **No change to any calendar subcomponent** (`EventBar`, `CalendarMonth`, `CalendarWeek`, `CalendarAgenda`, `DayMorePopover`). They already accept and correctly call the callback — feeding them a real function is the whole fix.
- **No change to `BoardViews`, `ItemPanel`, or the close behavior.** The read side and close-restores-URL are already correct.
- **No new drag-vs-click logic.** The existing 6px `PointerSensor` activation constraint already discriminates (see Edge cases).
- **No editing/quick-actions from the calendar** beyond opening the panel — opening is the scope.

---

## Design

A single, mechanical change in `CalendarBoard.tsx`:

1. **Add the helper.** Define `openItemPanel(itemId: string)` at module scope (above the component), byte-for-byte mirroring `BoardTable`'s version, with the same doc-comment explaining the History-API-not-RSC rationale:

   ```ts
   /**
    * Open the item detail panel by setting `?item=<id>` via the History API — no
    * RSC navigation, so the board page's queries don't re-run (mirrors
    * `BoardTable`/`ViewSwitcher`). `BoardViews` reads the param and renders the panel.
    */
   function openItemPanel(itemId: string) {
     const url = new URL(window.location.href);
     url.searchParams.set("item", itemId);
     window.history.pushState({}, "", url);
   }
   ```

2. **Feed it in.** In the `shared` object, replace

   ```ts
   onOpenItem: undefined as ((id: string) => void) | undefined,
   ```

   with

   ```ts
   onOpenItem: openItemPanel,
   ```

That's the entire production change. `onOpenItem` flows unchanged through `CalendarMonth`/`CalendarWeek`/`CalendarAgenda` to every leaf, which already invokes it.

### Data flow

```
CalendarBoard.openItemPanel(itemId)         [NEW: replaces the undefined stub]
  → pushState ?item=<id>  (History API, 0 RSC re-run)
       → BoardViews reads searchParams.get("item")   [existing]
            → resolves item from already-loaded payload cache   [existing]
                 → <ItemPanel itemId=… onClose={closeItem}/>    [existing]
```

`shared.onOpenItem` is consumed by:

```
CalendarMonth → BarForDay → EventBar(onOpen)            [single + multi-day]
              → DayMorePopover (hidden rows)            [+N more]
CalendarWeek  → EventBar(onOpen)                        [single + multi-day]
CalendarAgenda → row <button> onClick                  [agenda]
```

---

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint:** unchanged. No new query, `select`, prop, or Server Action. The change adds a client function reference to an already-built props object.
- **Per interaction (opening an item):** **0 new server round-trips.** Opening is a pure `window.history.pushState`; Next.js 16 syncs the new `?item=` into `useSearchParams()` in `BoardViews` with **no RSC re-run** (the documented History-API behavior this codebase relies on for `?view=` and the Table/Kanban item panel — see gotcha-09). The opened item's name/fields come from the **already-loaded** `payload` cache (`BoardViews` L82–84), not a fetch. Closing (existing `closeItem`) is likewise a `pushState` deleting `?item` — 0 round-trips.
- **Server data vs. client state:** opening/closing the panel changes **URL/client state only**, not server data — so History API is correct, and a Server Action / `router` navigation would be wrong. Matches the in-page-state invariant exactly.
- **Bounded hot path:** no list read is added or widened. The calendar already renders bars from the loaded cache; this change adds no iteration. (`ItemPanel`'s own data behavior is pre-existing and unchanged by this task.)

Net: the cheapest possible wire — one function reference replaces a `undefined`.

---

## Testing (mandatory — AGENTS.md #4)

The leaf-level invocation (`EventBar` firing `onOpen` on click and Enter; `CalendarMonth` rendering the `+N more` list) is **already** unit-tested in `EventBar.test.tsx` and `CalendarMonth.test.tsx`. The gap this task introduces a regression risk for is the **board-level wiring**: that `CalendarBoard` actually supplies a real `onOpenItem` that pushes `?item=<id>`. Tests must prove that wiring end-to-end at the board level, in a new colocated `src/components/boards/CalendarBoard.test.tsx` (no such file exists yet).

Test approach (Testing Library, same style as the other board tests):

1. **Month-view click opens the item via the URL.** Render `CalendarBoard` with a minimal payload (one board, one group, one **date** column, one item with a single-day date in the rendered month). Click the item's event chip. Assert `window.location.search` now contains `item=<that item id>` (i.e. `new URLSearchParams(window.location.search).get("item")` equals the item id). This proves the board fed a real `openItemPanel` that pushes the param — the exact thing that was `undefined` before.
2. **Keyboard activation opens the item.** Same setup; focus the chip and `fireEvent.keyDown(bar, { key: "Enter" })`; assert `?item=<id>` is set. (Guards the Enter/Space path through the board, complementing the leaf-only Enter test in `EventBar.test.tsx`.)
3. **Agenda-row click opens the item.** Render `CalendarBoard`, switch to **agenda** mode (the agenda toggle in `CalendarControls`), click the agenda row button, assert `?item=<id>` is set. (Proves the agenda branch of `shared` is wired, which no leaf test covers at the board level.)
4. **Reset between tests.** Each test resets the URL (e.g. `window.history.pushState({}, "", "/")` in `beforeEach`) so `item=` assertions don't leak across tests.

Notes for the implementer:

- `CalendarBoard` reads its data through `useBoardCache`, so the test renders it inside a `QueryClientProvider` (match the pattern in `KanbanBoard.test.tsx` / other board tests) and within `BoardPresenceProvider` if the rendered subtree requires presence context — follow whatever the existing calendar-adjacent tests already do; mirror their providers exactly so the test harness matches production.
- jsdom implements `window.history.pushState` and `window.location`, so asserting on `window.location.search` after a click needs no mock. We assert the **URL effect** of `openItemPanel`, not a spy, because the URL is the real contract `BoardViews` consumes.
- The "+N more" popover path is already covered by `CalendarMonth.test.tsx` rendering the list and is wired through the same `onOpenItem` prop as the chips; a dedicated board-level overflow test is **optional** (cheap to add if the implementer wants belt-and-suspenders, but the chip + agenda tests already prove `shared.onOpenItem` is a real function reaching all subviews).

Gates that must pass before merge: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## Edge cases & decisions

- **Drag vs. click (the key interaction).** Event bars are `useDraggable`. The board's `PointerSensor` already uses `activationConstraint: { distance: 6 }` (`CalendarBoard` ~L126): a pointer-up under 6px of movement is a **click** (fires `onClick` → `onOpen`), while crossing 6px starts a **drag** and dnd-kit suppresses the subsequent click. So drag-to-reschedule and click-to-open coexist with **no new code** — this is exactly why the constraint was set. (If the implementer finds any case where a completed drag still fires `onClick`, that is a pre-existing dnd-kit behavior to note, not something this task introduces; the activation distance is the standard guard and is already present.)
- **Click must not also create an item.** Day cells have an `onClick={onDayClick}` add-item handler. `EventBar`'s click/keydown handlers call `e.stopPropagation()` (L106, L139, L83) so opening an item never bubbles up to "add item on this day." Already handled — no change.
- **Multi-day span: name shown once, every segment clickable.** A span's name renders only at its visible start (`showName = !continuesLeft`), but **each** segment is its own `EventBar` with its own `onClick`/`onKeyDown` bound to the same `interval.itemId`, so clicking any segment (including a week-2 continuation that shows no text) opens the right item. The test targets the named segment for a stable selector; the continuation segments are wired identically by construction.
- **Keyboard (Enter/Space).** `EventBar` handles both in `handleKeyDown` with `preventDefault` (so Space doesn't scroll) and `stopPropagation`. Day cells and agenda buttons have their own keyboard handling. No new keyboard code in this task.
- **Panel close restores the URL.** `BoardViews.closeItem` already `pushState`s `?item` away; nothing to add. Closing from a calendar-opened panel behaves identically to closing a table-opened one.
- **Opening an item not in the loaded payload.** `BoardViews` resolves `payload.items.find(...) ?? null`; an unknown id yields a null item and `ItemPanel` renders closed/empty. Calendar only ever passes ids of items it rendered (which are in the payload), so this can't happen via the calendar — same safety as Table/Kanban.
- **Helper duplication is intentional.** See Non-goals: two inline copies beat a premature shared module. Keep the doc-comment so the next reader understands the History-API rationale at both sites.

---

## Execution DAG (AGENTS.md #6)

This is a **single, indivisible task** — one production file (`CalendarBoard.tsx`) plus its new colocated test file. No shared-state subsystems, no independent units to parallelize.

- **Tasks:** `T1` — replace the `onOpenItem: undefined` stub with an inline `openItemPanel` helper and add the board-level open tests.
- **Dependency graph:** none (single node).
- **Parallel batches:** Batch 1 = { T1 }. No concurrency available or warranted.
- **Critical path:** T1 (the whole task). Wall-clock floor = one small TDD cycle.

Explicitly **no parallel dispatch** — dispatching subagents here would add coordination cost for zero wall-clock gain.

---

## Open questions

None blocking. Defaults chosen to match the proven `BoardTable`/`BoardViews` pattern:

1. **Extract a shared `openItemPanel`?** Assumed **no** (YAGNI at two call sites). Revisit only when a third view needs it.
2. **Board-level "+N more" overflow test?** Assumed **optional** — the popover render is covered by `CalendarMonth.test.tsx` and it's the same `onOpenItem` prop the chip tests already prove is real. Implementer may add it cheaply if desired.
