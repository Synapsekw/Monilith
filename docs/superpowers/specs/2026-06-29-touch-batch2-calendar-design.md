# TOUCH Batch 2 — Calendar iPad Touch-Ergonomics Pass — Spec + Plan

**Date:** 2026-06-29
**Status:** Spec written — awaiting review
**Scope owner:** Danijel Jovanovic
**Parent spec:** [`2026-06-26-ipad-touch-optimization-design.md`](./2026-06-26-ipad-touch-optimization-design.md) — Calendar surface (final Batch-2 surface)
**Worktree / branch:** `.claude/worktrees/touch-calendar` / `task/touch-calendar`

> This is **both** the design spec and the implementation plan for the **last** Batch-2 surface. It
> is a mechanical adoption pass — the touch **foundation already shipped in Batch 1**
> (`useCoarsePointer`, `useTouchAwareSensors`, `<DragHandle>`, `<RevealOnHover>`, the
> `pointer-coarse:` Tailwind variant). The four sibling surfaces (Table, Item Panel, Nav, Kanban)
> plus Gantt already shipped this exact pattern. We only **consume** those primitives on the
> Calendar surface. No new primitives, no layout reflow, no new server round-trips.

---

## 1. Goal

Make the board **Calendar** view fully usable by a finger on an iPad (portrait 768px / landscape
1024px), matching desktop authoring parity, with **no layout reflow**. Concretely:

- Calendar **event drag** (move an event chip to another day) works by **long-press lift** — a quick
  swipe still scrolls. Today it's on the old `useSensor(PointerSensor, { distance: 6 })` (flagged
  `TODO(touch-batch-2)` at `CalendarBoard.tsx` ~L137), so a finger can only "swipe-drag" and never
  scroll cleanly.
- The month/week **navigation controls** (Prev / Next, and the Today / mode-tab / "Date by" cluster)
  get **≥44px** touch targets on coarse pointers — the Prev/Next chevron buttons are currently
  `h-7 w-7` (28px), below Apple HIG's 44px minimum.

This is **touch ergonomics only**: sensor config + coarse-pointer CSS sizing. No data, query, or
behavior changes for mouse users. Every change is gated on `(pointer: coarse)` → zero desktop
change, no layout reflow.

## 2. Non-goals

- **No layout reflow / new breakpoints.** The month grid, week columns, and agenda list keep their
  exact current layout. (Phone reflow is the deferred follow-up project.)
- **No new server round-trips, queries, or revalidation.** (See §6.)
- **No desktop behavior change.** Mouse/trackpad keeps the 6px-distance drag and the current 28px
  nav-control sizes. Every change is gated on `(pointer: coarse)` (CSS `pointer-coarse:` variant).
- **No work on sibling surfaces.** Table, Item Panel, Nav, Kanban, and Gantt are their own
  (already-shipped or parallel) Batch-2 passes (see §8).
- **No Playwright iPad E2E.** Deferred with the phone follow-up (parent spec). Vitest component tests
  are mandatory here (§7).
- **No rewrite of the event chip onto a `Button` primitive.** The `EventBar` chip already carries the
  dnd `listeners`/`attributes` and IS the long-press surface — long-press lift comes entirely from
  the shared `useTouchAwareSensors()` TouchSensor, so the chip needs **no** edit. The day cells are
  full-cell `role="button"` tap targets (`min-h-[6.5rem]` month / full-height week column) — already
  finger-sized and NOT hover-gated, so they need no edit either.

## 3. Surfaces in scope (code-verified inventory)

All paths under `src/components/boards/`. Line numbers are the current `develop`-snapshot state.

### 3a. `CalendarBoard.tsx` (296 lines) — primary file

**One `DndContext`** (L274–278, `id="calendar-${selectedViewId}"`) wrapping the month/week grid,
fed by **one sensor block** still on the old PointerSensor:

```
// TODO(touch-batch-2): migrate to useTouchAwareSensors() (src/lib/dnd/sensors.ts)   ← L137
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),               ← L138–140
);
```

The dnd imports (L5–11) currently pull `PointerSensor`, `useSensor`, `useSensors` from
`@dnd-kit/core`; `DndContext` and `DragEndEvent` are still needed. The drop targets are the day
cells (via `useDroppable` in `CalendarMonth`/`CalendarWeek`); the drag source is the `EventBar` chip
(via `useDraggable`). Migrating the sensor block is the **only** change in this file's drag wiring —
`handleDragEnd`, the droppables, and the `EventBar` draggable are all unchanged.

### 3b. `calendar/CalendarControls.tsx` (114 lines) — nav controls

- **Prev** button (L39–46): `h-7 w-7` (28px), `aria-label="Previous period"`, hover-only background
  feedback (`hover:bg-accent`). Sub-44px on touch.
- **Next** button (L54–61): `h-7 w-7` (28px), `aria-label="Next period"`. Same.
- **Today** button (L47–53), mode tabs (L72–88), and the "Date by" `<select>` (L98–110) are
  text/`px`-padded controls in a `py-1` row — comfortable-ish but the Prev/Next icon buttons are the
  ones below 44px. We bump the **icon buttons** to ≥44px on coarse, and (for parity) give the Today
  button + mode tabs a `pointer-coarse:` min-height so the whole nav row is a comfortable touch strip.

### 3c. Affordances already touch-ready (no edit — verified)

- **`EventBar.tsx`** — drag chip carries `listeners`/`attributes`; long-press lift comes from the
  shared TouchSensor. The chip is always visible (not hover-gated). Click/Enter opens the item panel.
  **No edit.**
- **`CalendarMonth.tsx` / `CalendarWeek.tsx`** — day cells are full-cell `role="button"`
  (`min-h-[6.5rem]` / full-height column) with an `onClick`/Enter "add item on `<date>`" affordance;
  not hover-gated, already finger-sized. The "+N more" / overflow buttons are full-width text rows.
  **No edit.**
- **`CalendarAgenda.tsx`** — full-width `py-1.5` row buttons; already finger-sized, not hover-gated.
  **No edit.**

### 3d. Existing tests (none cover touch)

`CalendarBoard.test.tsx`, `calendar/CalendarControls.test.tsx`, `calendar/CalendarMonth.test.tsx`,
`calendar/CalendarWeek.test.tsx`, `calendar/CalendarAgenda.test.tsx`, `calendar/EventBar.test.tsx` —
**none mock `matchMedia` / coarse pointer**. We assert `pointer-coarse:` class presence (stable in
jsdom; computed `matchMedia` styling doesn't resolve there) + spy `useTouchAwareSensors`, mirroring
the sibling Table/Kanban specs.

## 4. Shared primitives consumed (read-only — DO NOT MODIFY)

Batch-1 outputs, verified present in this worktree:

- `src/lib/dnd/sensors.ts` → `useTouchAwareSensors()` — PointerSensor 6px **+** TouchSensor
  `{ delay: 200, tolerance: 8 }` (long-press lift). Drop-in for the one old sensor block.
- `src/lib/hooks/use-coarse-pointer.ts` → `useCoarsePointer()` — `useSyncExternalStore` over
  `matchMedia('(pointer: coarse)')`, SSR-safe `false` default. (Not needed here — the nav controls
  use the pure-CSS `pointer-coarse:` variant, no JS branch.)
- **`pointer-coarse:` Tailwind variant** — already active (shipped in `ui/button.tsx`; tested in
  `ui/button.touch.test.tsx`). Use it directly on the bare `<button>`s in `CalendarControls` to get
  `pointer-coarse:size-11` / `pointer-coarse:min-h-11` without a primitive rewrite.

> `<DragHandle>` and `<RevealOnHover>` are **not** needed on this surface: there is no precision-drag
> resize handle here (the event chip is the long-press surface, not a separate grip), and there are
> no hover-only reveals on Calendar (every affordance is already always-visible). Listing them as
> "consumed" would be inaccurate — Calendar consumes only `useTouchAwareSensors` + the
> `pointer-coarse:` variant.

## 5. Design — how each surface is treated

**Event drag (`CalendarBoard.tsx` `DndContext`).** Swap
`useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))` for
`useTouchAwareSensors()`. Delete the `TODO(touch-batch-2)` comment and the now-unused `PointerSensor`
/ `useSensor` / `useSensors` names from the `@dnd-kit/core` import (keep `DndContext`, `DragEndEvent`).
The `EventBar` chip keeps carrying the dnd `listeners`/`attributes` — no behavioral change to wiring;
long-press lift comes entirely from the TouchSensor in the shared hook. A quick finger swipe now
scrolls the grid (200ms delay); a deliberate hold lifts the event to drag it to another day.

**Nav controls (`calendar/CalendarControls.tsx`).** Pure-CSS `pointer-coarse:` sizing, gated on
`(pointer: coarse)` → zero desktop change:

- **Prev / Next icon buttons** (L43, L58): the `h-7 w-7` becomes `h-7 w-7 pointer-coarse:size-11`
  (≥44px hit area on touch; stays 28px on desktop). The `ChevronLeft`/`ChevronRight` icon stays
  `size-4`.
- **Today button + mode tabs:** append `pointer-coarse:min-h-11` so the tappable height is ≥44px on
  touch while the desktop `py-1` height is unchanged. (These are text buttons with padding, so width
  is already comfortable; only height needs the coarse bump.) The mode tabs live inside a
  `role="tablist"` strip — bumping each tab's min-height keeps the segmented control a comfortable
  touch strip without changing its desktop look.

No layout reflow: `pointer-coarse:size-11` / `pointer-coarse:min-h-11` only grow the hit area on
coarse pointers; on the desktop fine-pointer media query none of these classes apply, so the rendered
chrome is byte-identical to today.

## 6. Data-fetching & performance budget (working-agreement #5)

This surface has **multiple views over the same data** (Month / Week / Agenda tabs + Prev/Next/Today
nav), so the budget rule applies directly:

- **(a) First paint vs. interaction:** First paint is **unchanged** — same RSC board payload
  (`BoardPayload`), hydrated into the client `useBoardCache` store. **Mode switching (Month ⇄ Week ⇄
  Agenda) and Prev/Next/Today nav are pure client state** (`useState` for `mode`/`cursorISO`) over
  already-loaded data — **0 new server round-trips** per interaction (verified: the existing test
  "switches to Week mode without any router navigation" asserts no `router.push`/`refresh`). This
  touch pass changes neither — it only swaps the drag sensor and adds `pointer-coarse:` classes, both
  client-side presentation/input concerns. Each touch interaction (long-press lift, nav tap) is
  **0 new server round-trips**.
- **(b) Does the interaction change server data?** Only the **existing** event-drag mutation does:
  dropping an event on a new day commits through the existing path
  (`onEventDropped` → `setCell` → the board's Server Action) with the cache's optimistic update —
  **unchanged**. We change _how the drag is initiated_ (finger long-press vs. mouse), never _what it
  commits or how often_. No new Server Actions, no new revalidation. The "Date by" `<select>` already
  goes through `updateBoardView` (Server Action) + `router.refresh()` — also unchanged.
- **(c) Bounded over indexed columns?** Untouched. The Calendar reads from the already-loaded board
  cache (the same bounded RSC payload the rest of the board surfaces use); this pass adds no query.

**Net:** first-paint and per-interaction server cost is **identical to today**.

## 7. Testing (working-agreement #4 — written & executed)

Per parent spec: jsdom can't simulate touch-drag physics, so we assert **config + class state**, not
gesture playback.

- **`CalendarBoard.test.tsx` (extend):** spy/mock `useTouchAwareSensors` from `@/lib/dnd/sensors`
  (delegating to the real impl so dnd-kit gets valid sensors) and assert the `DndContext` consumes it
  (hook called ≥1×) when a month/week grid is rendered. Regression-guard the existing drag wiring:
  the dated event chip still renders and still opens the item panel on click/Enter (existing tests).
  Add a guard that the agenda mode (no `DndContext`) does **not** call the sensor hook is **not**
  required — keeping it simple, we assert ≥1 call in the default (month) render.
- **`calendar/CalendarControls.test.tsx` (extend):** assert the Prev and Next buttons carry
  `pointer-coarse:size-11`, and the Today button + mode tabs carry `pointer-coarse:min-h-11`
  (class-presence assertion — stable in jsdom). Keep the existing control tests green.
- **A shared `matchMedia` mock is NOT needed** for the CSS-variant assertions (we assert class
  presence, not computed style). The sensor spy follows the exact pattern in `BoardTable.test.tsx`.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green. (`pnpm test`
  includes live-DB integration suites that can flake; the **unit project** `pnpm test:unit` is the
  real gate per the parent runbook.)
- **Deferred:** Playwright iPad device profiles + real touch-drag E2E (phone follow-up).

## 8. Disjointness from sibling Batch-2 passes (no shared file writes)

This surface is **file-disjoint** from every other Batch-2 surface. Files written by THIS task —
`CalendarBoard.tsx`, `calendar/CalendarControls.tsx`, and their tests — are written by **no** other
Batch-2 surface. In particular it is disjoint from the **parallel Gantt pass** (which writes
`GanttBoard.tsx` / `gantt/*`). The only things shared are the **read-only Batch-1 primitives** in §4
(`useTouchAwareSensors`, the `pointer-coarse:` variant), consumed never modified. So this runs in its
own `task/touch-calendar` worktree fully concurrently with Gantt; there is no merge contention beyond
ordinary `develop` integration.

---

# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the Batch-1 touch primitives across the Calendar surface so it is finger-usable on
iPad, with zero desktop behavior change and zero new server round-trips.

**Architecture:** Mechanical, per-file adoption of `useTouchAwareSensors()` (one DndContext) and
`pointer-coarse:` ≥44px sizing on the bare nav `<button>`s. All changes gated on `(pointer: coarse)`.

**Tech Stack:** Next.js 16 / React 19 / Tailwind v4 (`pointer-coarse:` variant) / dnd-kit 6.3 /
Vitest + jsdom.

---

### Task 1: CalendarBoard — migrate the event-drag sensor to `useTouchAwareSensors()`

**Files:**

- Modify: `src/components/boards/CalendarBoard.tsx` (sensor block L137–140; dnd import L5–11)
- Test: `src/components/boards/CalendarBoard.test.tsx`

- [ ] **Step 1 — Failing test.** In `CalendarBoard.test.tsx`, mock `@/lib/dnd/sensors` to spy
      `useTouchAwareSensors` (delegate to the real impl). Add a test asserting the hook is called when
      the (default month) calendar renders. Run: `pnpm test:unit CalendarBoard` → expect FAIL (hook
      not yet imported/called).
- [ ] **Step 2 — Implement.** Add `import { useTouchAwareSensors } from "@/lib/dnd/sensors";`. Replace
      the `const sensors = useSensors(useSensor(PointerSensor, …));` block with
      `const sensors = useTouchAwareSensors();`. Delete the `TODO(touch-batch-2)` comment. Remove
      `PointerSensor`, `useSensor`, `useSensors` from the `@dnd-kit/core` import (keep `DndContext`,
      `DragEndEvent`).
- [ ] **Step 3 — Run.** `pnpm test:unit CalendarBoard` → PASS. `pnpm typecheck` → no unused-import
      error.
- [ ] **Step 4 — Commit.** `git add src/components/boards/CalendarBoard.tsx
src/components/boards/CalendarBoard.test.tsx` → `feat(boards): touch-aware event-drag sensor in
calendar`.

### Task 2: CalendarControls — ≥44px nav touch targets on coarse pointers

**Files:**

- Modify: `src/components/boards/calendar/CalendarControls.tsx` (Prev L43, Next L58, Today L50,
  mode tabs L79–84)
- Test: `src/components/boards/calendar/CalendarControls.test.tsx`

- [ ] **Step 1 — Failing test.** Assert the Prev ("Previous period") and Next ("Next period") buttons
      carry `pointer-coarse:size-11`, and the Today button + each mode tab carry
      `pointer-coarse:min-h-11`. Run: `pnpm test:unit CalendarControls` → FAIL.
- [ ] **Step 2 — Implement.** Append `pointer-coarse:size-11` to the Prev/Next button classNames (keep
      `h-7 w-7` desktop base). Append `pointer-coarse:min-h-11` to the Today button and the mode-tab
      className. Icon sizes unchanged. All `pointer-coarse:`-gated → zero desktop change.
- [ ] **Step 3 — Run.** `pnpm test:unit CalendarControls` → PASS.
- [ ] **Step 4 — Commit.** `git add src/components/boards/calendar/CalendarControls.tsx
src/components/boards/calendar/CalendarControls.test.tsx` → `feat(boards): finger-friendly
calendar nav controls`.

### Task 3: Full gate + handoff

**Files:** none (verification + closure)

- [ ] **Step 1 — Full gates.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green
      (treat the unit project as the real test gate; re-run any `*.integration.test.ts` flake in
      isolation to confirm transient).
- [ ] **Step 2 — Manual reasoning pass.** Confirm every change is `pointer-coarse:`-gated (grep the
      diff for any unconditional sizing change → there should be none). Confirm no `TODO(touch-batch-2)`
      marker remains in `CalendarBoard.tsx`.
- [ ] **Step 3 — Hand off.** STOP — the orchestrator runs `finish-task.sh`. Hand the user the "How to
      test" walkthrough (below).

---

## Execution DAG (working-agreement #6)

**Dependency edges (Consumes → Produces):**

- Both tasks **Consume** the read-only Batch-1 primitives (already merged → no in-plan dependency).
- Task 1 writes `CalendarBoard.tsx` (+ its test); Task 2 writes `CalendarControls.tsx` (+ its test) —
  **disjoint files**, no write contention → **mutually independent**.
- Task 3 (full gate + handoff) **depends on both** 1 and 2.

```
Batch A (parallel):   1   2
                      │   │
                      └─┬─┘
                        ▼
Batch B:               3   (full gate + handoff)
```

- **Parallel batches:** Batch A = { 1, 2 } — two disjoint-file tasks that can run as **2 concurrent
  lanes**. Batch B = { 3 } after both.
- **Critical path (wall-clock floor):** `Task 1 (or 2) → Task 3` = **2 sequential tasks**. The surface
  is small enough that this is normally executed **in-session** (one task at a time with the TDD
  cycle) rather than across separate worktrees — the whole plan lives in one `task/touch-calendar`
  worktree.

**Task count:** 3 (2 implementation + 1 gate/handoff). **Critical path:** 2 (1→3).
**Size:** Small (mechanical adoption; one ~296-line file + one ~114-line file).

## How to test this (post-merge, for the user)

1. Pull `develop`; open the app on an **iPad** (or browser DevTools device mode set to iPad +
   touch emulation) at a board's **Calendar** view (Month or Week mode).
2. **Event drag:** press-and-hold (~200ms) an event chip → it lifts (semi-transparent) → drag it onto
   another day and release → the event moves and persists. A quick **swipe** over the grid should
   **scroll**, not drag.
3. **Nav controls:** the **Prev** (‹) and **Next** (›) chevron buttons are easy finger targets
   (≥44px); tapping them moves the period. The **Today**, **Month/Week/Agenda** tabs, and **Date by**
   picker are all comfortably tappable.
4. **Desktop regression:** on a mouse/trackpad, everything looks and behaves **exactly as before** —
   28px nav chevrons, 6px-distance drag, no visual change.

## Risks & open questions

- **`useTouchAwareSensors` only adds a TouchSensor** — the PointerSensor (mouse/trackpad) keeps its
  6px-distance activation, so desktop drag is byte-identical. Verified against the shared hook source.
- **`pointer-coarse:min-h-11` on the mode tabs** must not change the desktop segmented control's look
  — it doesn't, because the class only applies under `(pointer: coarse)`. Verified by class-gating.
- **jsdom can't play touch-drag physics** — accepted; we assert sensor config + `pointer-coarse:` size
  classes, with the Playwright iPad matrix deferred to the phone follow-up.
  </content>
  </invoke>
