# Inline Status / % Editing on Calendar & Timeline Views — Design Spec

**Date:** 2026-07-03
**Status:** Spec written — awaiting review
**Scope owner:** Danijel Jovanovic
**Source:** MVP Final Features item 6 (`docs/superpowers/plans/2026-07-03-mvp-final-features.md`, from feedback F5.3)
**Worktree / branch:** `.claude/worktrees/calendar-timeline-inline-edit` / `task/calendar-timeline-inline-edit`

> Raw feedback (verbatim): _"Inline Status Editing on Calendar & Timeline Views — Allow Status and
> % complete to be edited directly in the Calendar and Timeline views, not just the Main Table."_

---

## 1. Goal

Let a user change an item's **Status** and **% complete** directly from the **Calendar** view
(Month / Week / Agenda) and the **Timeline / Gantt** view, without switching to the Main Table.
Every edit is a client-state interaction + **one Server Action with an optimistic cache update** —
never a router navigation or full-page RSC refetch (gotcha-09). The interaction must be fully
usable by a finger on iPad (TOUCH batch-2 conventions: ≥44px targets on coarse pointers, no
hover-gated affordances).

## 2. Current state (code-verified)

- **The Main Table is today the only place these fields are editable.** `BoardTable.tsx`'s
  `EditableCell` swaps a read-only `CellRenderer` for the kind's `CellEditor`
  (`src/components/boards/cells/editors/index.tsx`): `StatusEditor` = Radix `PopoverSurface` +
  option pills + `ClearButton`; `PercentEditor` = clamped (0–100) number `Input`. Commits go
  through `useBoardMutations(boardId)` → `setCell` (optimistic React Query cache patch on
  `["board", id]`, rollback + toast on error, no refetch — Realtime + revalidate keep peers fresh)
  and `clearCellValue` for explicit clears.
- **Calendar** (`CalendarBoard.tsx` + `calendar/*`): event chips (`EventBar`), agenda rows, and
  month-overflow rows all call `onOpenItem(itemId)` on click/Enter, which pushes `?item=` via the
  History API and opens the **ItemPanel**. `CalendarBoard` already derives the first status column
  (chip coloring) and already holds `setCell`/`addItem` from `useBoardMutations`.
- **Gantt** (`GanttBoard.tsx`): bars and milestone diamonds are **drag-only surfaces — a plain
  click does nothing today**; the sticky name rail has a ⋯ dependency menu. `GanttBoard` already
  holds the full `useBoardMutations` object.
- **The ItemPanel has no field editing** (`item-panel/ItemPanel.tsx` — Updates / Files / Activity
  only). So from Calendar/Timeline there is currently **no path at all** to change status or %.
- **ItemPanel opens from any view**: `BoardViews.tsx` renders it off the `?item=` search param
  regardless of the active view kind — so a peek surface on Gantt can offer "Open" for free.
- **Touch conventions** (shipped, `2026-06-29-touch-batch2-calendar-design.md` /
  `-gantt-design.md`): drag = long-press lift via `useTouchAwareSensors`; every tap target ≥44px
  on coarse pointers via `pointer-coarse:` classes; nothing hover-gated on touch.

## 3. Approaches considered

**A. Quick-edit peek popover on event/bar tap (chosen).** Tapping an event chip (Calendar) or a
bar/milestone (Gantt) opens a small anchored popover — the item's name, an **Open** affordance
(full ItemPanel), the **status option pills**, and a **% complete input**, all reading from the
already-loaded board cache and committing through the existing `setCell`/`clearCellValue`
mutations. This is the Monday-style "event peek". One new shared component, thin per-view wiring.

**B. Add editable fields to the ItemPanel.** Keeps click semantics untouched, benefits all views —
but it is a materially bigger feature (a full field-list section in the panel), and it is not
"directly in the view": the panel is a heavyweight side sheet, and the feedback explicitly asks
for in-view editing. Worth doing someday; not this feature.

**C. Hover-revealed edit glyph on the chip/bar, click keeps opening the panel.** Rejected: the
calendar chip is 18px tall and the Gantt bar 24px — no room for an in-bar micro-target, and
hover-gating violates the shipped touch conventions (would need an always-visible 44px glyph on
coarse pointers, which doesn't fit the chip at all).

**Decision: A.** On Gantt it is pure addition (bars gain a tap action where none existed). On
Calendar it _changes_ the chip tap from "open panel" to "open peek (with Open inside)" — a
deliberate trade: the peek makes the two requested edits one tap away, and the full panel stays
one further tap away. Boards with **neither** a status nor a percent column keep the old
behavior (tap → panel) so the peek never renders empty. Flagged in §10 for review.

## 4. Design

### 4.1 New shared component — `ItemQuickEdit`

`src/components/boards/quick-edit/ItemQuickEdit.tsx` (client). One instance rendered at board
level per view (not per chip/bar), anchored to the tapped element:

```ts
type QuickEditTarget = { itemId: string; anchorRect: DOMRect };

function ItemQuickEdit(props: {
  target: QuickEditTarget; // which item + where to anchor
  itemName: string;
  statusColumn: CacheColumn | null; // first kind === "status" column, if any
  percentColumn: CacheColumn | null; // first kind === "percent" column, if any
  statusValue: { optionId: string | null } | null; // from cellMap
  percentValue: { percent: number } | null; // from cellMap
  setCell: (v: { itemId: string; columnId: string; value: unknown }) => void;
  clearCellValue: (v: { itemId: string; columnId: string }) => void;
  onOpenItem: (itemId: string) => void; // existing ?item= pushState helper
  onClose: () => void; // clears the parent's target state
});
```

- **Surface:** Radix `Popover` (`open`, `onOpenChange(false) → onClose`) so it portals to the
  body and escapes the calendar/gantt `overflow-auto` scroll containers, exactly like the table's
  `PopoverSurface`. The anchor is a `PopoverAnchor` wrapping a `position: fixed` zero-chrome div
  sized/placed from `anchorRect` (captured at tap time via
  `e.currentTarget.getBoundingClientRect()`). This keeps chips/bars dumb — they pass a rect up
  instead of threading open-state down through Month/Week/Agenda internals.
- **Content (top → bottom):**
  1. **Header row:** item name (truncated, `text-sm font-medium`) + an **Open** button
     (`ArrowUpRight` icon + "Open", ghost) → `onOpenItem(itemId)` then `onClose()`.
  2. **Status section** (only when `statusColumn`): column name as a `text-muted-foreground
text-xs` label, then the **same option pills as the table's StatusEditor** via the extracted
     `StatusOptionList` (§4.2). Selecting a pill calls `setCell` with `{ optionId }` and **keeps
     the peek open** (optimistic cache patch re-renders `aria-selected` + chip/bar color live);
     the pill list's Clear routes `clearCellValue`.
  3. **Percent section** (only when `percentColumn`): column name label, then a number `Input`
     (0–100, `tabular-nums`, trailing `%` affix) with the **same commit semantics as the table's
     PercentEditor** via the extracted `parsePercentInput` helper (§4.2): Enter/blur commits the
     clamped value through `setCell`; emptying a previously-set cell commits a clear through
     `clearCellValue`; invalid input reverts. **No `autoFocus`** — unlike the in-cell editor, the
     peek must not pop the iPad keyboard on open.
- **Dismissal:** outside click / Escape (Radix default) → `onClose`. Both fields can be edited in
  one visit; each commit is its own Server Action (see §6).
- **Empty-capability rule:** the parent never opens the peek when both columns are absent — it
  falls back to `onOpenItem` directly (Calendar keeps today's behavior; Gantt opens the panel).
- **a11y:** `role="dialog"`, `aria-label={`Edit ${itemName}`}`; Radix moves focus into the
  popover; pills keep `role="option"`/`aria-selected` from `StatusOptionList`; the input is
  labeled with the column name.

### 4.2 Editor reuse — extract, don't fork

The table's editors stay the single source of truth for how these two kinds edit:

- **`StatusOptionList`** (new, `src/components/boards/cells/editors/status-options.tsx`): the
  option-pill list + `ClearButton` currently inlined in `StatusEditor`. `StatusEditor` becomes
  `PopoverSurface` + `StatusOptionList` — byte-identical rendering, existing
  `editors.test.tsx` stays green. `ItemQuickEdit` composes the same list without the
  `PopoverSurface` wrapper (it has its own popover).
- **`parsePercentInput(raw: string): { kind: "clear" } | { kind: "invalid" } | { kind: "commit";
percent: number }`** (new, same folder): the trim/NaN/clamp logic currently inlined in
  `PercentEditor.commit`. `PercentEditor` and the peek's percent field both call it, so the
  clamp-don't-reject behavior can never drift between surfaces.

### 4.3 Calendar wiring (`CalendarBoard.tsx` + `calendar/*`)

- `CalendarBoard` adds `percentColumn` (memo, first `kind === "percent"`) beside the existing
  `statusColumn` memo, destructures `clearCellValue` from `useBoardMutations`, and holds
  `const [quickEdit, setQuickEdit] = useState<QuickEditTarget | null>(null)`.
- The shared `onOpenItem` prop the sub-views receive becomes
  `onItemTap(itemId: string, anchorRect: DOMRect)`:
  - if `statusColumn || percentColumn` → `setQuickEdit({ itemId, anchorRect })`;
  - else → `openItemPanel(itemId)` (unchanged legacy path).
- `EventBar` (`onOpen`), `CalendarMonth`'s overflow rows, and `CalendarAgenda`'s rows change
  their callback signature to pass `e.currentTarget.getBoundingClientRect()` alongside the id
  (click and Enter/Space paths both). No other chip/cell/drag behavior changes; drag-vs-tap
  disambiguation is already handled by the sensors (a drag that activates suppresses the click).
- `CalendarBoard` renders `<ItemQuickEdit …/>` when `quickEdit` is set, deriving
  `statusValue`/`percentValue` from the existing `cellMap` and `itemName` from `cache.items`.
  "Open" routes to the existing `openItemPanel` helper (History API pushState — no RSC nav).

### 4.4 Gantt wiring (`GanttBoard.tsx`)

- Same additions: `statusColumn`/`percentColumn` memos, `quickEdit` state, one
  `<ItemQuickEdit …/>`, an `openItemPanel(itemId)` helper identical to CalendarBoard's
  (pushState `?item=` — the ItemPanel already renders from `BoardViews` on any view).
- **Bars and milestones become tappable:** add `onClick` (fires only when no drag activated —
  same dnd-kit behavior `EventBar` relies on today), `tabIndex={0}`,
  `aria-label={row.name}`, and Enter/Space key handling on the bar body (the flex-1 drag-handle
  div) and the milestone diamond → `openQuickEdit(row.itemId, rect)`. The right-edge resize strip
  keeps `stopPropagation` and never opens the peek.
- **Unscheduled section rows** become buttons with the same tap → peek (status/% are exactly what
  you'd triage on an unscheduled item). Fallback rule applies (no editable columns → panel).

### 4.5 Errors, concurrency, realtime

All error handling is inherited: `setCell`/`clearCellValue` already do optimistic patch →
rollback → `toast.error` on failure. Realtime echoes are idempotent upserts on the same cache, so
a peer's concurrent edit re-renders the open peek's pills/input live (LWW flash continues to
target the table cell; no new presence wiring — see §9). Permissions: viewers without edit rights
are already rejected server-side by the actions' RLS; the peek does not add a client-side
capability check beyond what the table has today (parity).

## 5. UI notes (pulse-ui + touch)

- **Monochrome chrome, color earned:** the peek surface is `bg-popover` chrome (Radix
  `PopoverContent` default) with hairline `border`; the **only** color inside is the status pills
  (option `color` + `pillTextColor` contrast, identical to the table) — never brand-colored
  chrome. Labels `text-muted-foreground text-xs`; name `text-sm font-medium`; `rounded-md`;
  4px-grid spacing (`p-2`/`gap-2`); width `min-w-[14rem] max-w-[18rem]`, list capped by
  `--radix-popover-content-available-height` with inner scroll (same pattern as
  `PopoverSurface`).
- **Touch (batch-2 parity):** pills keep `pointer-coarse:min-h-11`; the percent `Input`, Open
  button, and Clear get `pointer-coarse:min-h-11`; nothing in the peek is hover-gated; no
  `autoFocus` so the iPad keyboard only appears when the user taps the % field. Tap targets that
  _open_ the peek are the existing chips/bars/rows (already the drag/tap surfaces; long-press
  still lifts for drag, quick tap opens the peek).
- **Motion:** Radix popover's built-in open/close animation only — no Framer wrapper.
- **AA:** status conveyed by pill label text + color (never color alone); visible
  `focus-visible:ring-2 ring-ring` on every control; icon-only affordances carry `aria-label`s.

## 6. Performance & data-fetching budget (working agreement #5 / gotcha-09)

- **(a) First paint:** unchanged — the same RSC `BoardPayload` hydrated into the existing
  `useBoardCache` React Query cache. The peek adds **zero** first-paint queries. **Opening the
  peek = 0 new server round-trips** (item name, column settings/options, and both cell values are
  read from the in-memory cache/`cellMap`).
- **(b) Interactions that change server data:** exactly two, both **one Server Action each with
  an optimistic cache update and rollback** — a status pick = `upsertCell` via `setCell`; a %
  commit = `upsertCell` via `setCell` (or `clearCell` via `clearCellValue` when emptied/cleared).
  No `router.push`/`refresh`, no RSC re-run; "Open" and dismissal are History-API/client-state
  only. Peers converge via the existing Realtime channel + the actions' targeted revalidation.
- **(c) Bounded / indexed:** no new queries at all — the feature renders from the already-bounded
  board payload; writes hit `cell_values` by `(item_id, column_id)` exactly as the table does.

**Net:** first-paint cost identical to today; each edit costs exactly one Server Action.

## 7. Testing (working agreement #4)

- **`cells/editors`**: existing `editors.test.tsx` green after the `StatusOptionList` /
  `parsePercentInput` extraction (proves no rendering/behavior drift); new unit tests for
  `parsePercentInput` (clear / invalid / clamp low / clamp high / pass-through).
- **`quick-edit/ItemQuickEdit.test.tsx`**: renders name + Open; status pills from column
  settings; pick → `setCell` with `{ optionId }`, stays open; Clear → `clearCellValue`; percent
  Enter/blur → `setCell` clamped; emptied percent → `clearCellValue`; sections hidden when the
  column is absent; no `autoFocus`; `pointer-coarse:min-h-11` present on pills/input/buttons;
  Escape/outside → `onClose`.
- **`CalendarBoard.test.tsx`** (update): chip click now opens the peek when a status/percent
  column exists (assert peek content, assert **no** `router.push`/`refresh` and `?item=` not yet
  set); "Open" inside the peek sets `?item=` via pushState; a board with neither column keeps the
  legacy click → `?item=` behavior (existing assertions, re-targeted). `EventBar.test.tsx` /
  `CalendarAgenda` / month-overflow: callback now receives `(itemId, rect)`.
- **`GanttBoard.test.tsx`** (update): bar click opens the peek; resize-strip pointerdown does
  not; milestone + unscheduled row open it; keyboard (Enter) opens it; status pick from the peek
  calls `setCell`; regression: existing drag/zoom/menu tests stay green.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (unit project is the real
  test gate; integration flakes re-run in isolation per the vault runbook).

## 8. Independent units (parallelization, working agreement #6)

1. **Editor extraction** (`StatusOptionList`, `parsePercentInput`) — self-contained refactor of
   `cells/editors/*`; no consumer changes beyond `StatusEditor`/`PercentEditor` internals.
2. **`ItemQuickEdit` component** — depends on (1); no view files touched.
3. **Calendar wiring** — depends on (2); touches `CalendarBoard.tsx` + `calendar/*` only.
4. **Gantt wiring** — depends on (2); touches `GanttBoard.tsx` only.

(3) and (4) are file-disjoint and can build in parallel once (2) lands. The plan's Execution DAG
formalizes this.

## 9. Non-goals

- No editing of other kinds (date, people, text, …) in the peek — status + % only, per the
  feedback. (The component is deliberately shaped so more kinds can be added later.)
- No field editing added to the ItemPanel (approach B — separate future feature).
- No per-view "which status/percent column" picker — first column of each kind, mirroring how the
  calendar already picks its coloring status column (see §10).
- No Kanban changes (status is already the lane there; % editing on cards is out of scope).
- No new presence broadcasting from the peek (table-cell presence/LWW flash continues unchanged).
- No schema/migration work — zero DB changes.
- No Playwright iPad E2E (consistent with the touch batch-2 deferral); Vitest component tests only.

## 10. Open questions for review

1. **Calendar tap semantics** — the peek replaces the chip's direct "tap → ItemPanel" with
   "tap → peek, Open → panel" (panel is now two taps). Accepted trade for one-tap editing; if
   one-tap panel access matters more, alternatives are double-click → panel or peek-only-on-⌥/⋯.
2. **Multiple status/percent columns** — MVP binds to the _first_ column of each kind (same rule
   the calendar uses for chip coloring). Should the view config later grow explicit
   `status_column_id`/`percent_column_id` pickers like the Gantt's Start/End/Color-by?
3. **% input vs slider on touch** — a numeric input matches the table exactly (chosen); a slider
   would be more finger-friendly but introduces a new editing behavior that diverges from the
   table. Revisit if iPad feedback asks for it.
4. **Peek stays open after a status pick** — chosen so both fields can be edited in one visit;
   Monday closes on pick. Flip to close-on-pick if users find the extra dismissal tap annoying.
5. **Agenda rows** — they now open the peek like chips do. If the Agenda should instead render
   always-visible inline status pills per row (it has the horizontal room), that's a follow-up
   enhancement, not this MVP.
