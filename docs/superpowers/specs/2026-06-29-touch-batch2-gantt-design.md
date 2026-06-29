# TOUCH Batch 2 — Gantt / Timeline iPad Touch-Ergonomics Pass — Spec + Plan

**Date:** 2026-06-29
**Status:** Spec written — awaiting review
**Scope owner:** Danijel Jovanovic
**Parent spec:** [`2026-06-26-ipad-touch-optimization-design.md`](./2026-06-26-ipad-touch-optimization-design.md) — surface ④ (Gantt, "High")
**Worktree / branch:** `.claude/worktrees/touch-gantt` / `task/touch-gantt`

> This is **both** the design spec and the implementation plan for one Batch‑2 surface. It is a
> mechanical adoption pass — the touch **foundation already shipped in Batch 1** (`useCoarsePointer`,
> `useTouchAwareSensors`, `<DragHandle>`, `<RevealOnHover>`, `pointer-coarse:` sizing on `ui/`
> primitives). We only **consume** those primitives on the Gantt surface. No new primitives, no
> layout reflow, no new server round‑trips.

---

## 1. Goal

Make the board **Gantt / Timeline** view fully usable by a finger on an iPad (portrait 768px /
landscape 1024px), matching desktop authoring parity, with **no layout reflow** (the `md:` breakpoint
already renders the desktop layout ≥768px). Concretely:

- **Bar move** (drag a bar/milestone left/right to reschedule) works by **long‑press lift** — a quick
  swipe still scrolls the timeline.
- **Zoom controls** (Week / Month toggle) get **≥44px** touch targets.
- **Per‑row ⋯ menu** (dependency management), currently `opacity-0 group-hover:opacity-100` and
  `size-6`, becomes **always visible on coarse pointers** and **≥44px**.
- The **right‑edge bar resize handle** (`w-2` = 8px, hover‑only `hover:bg-…` feedback) gets a
  finger‑hittable **≥44px** hit area on coarse pointers, without widening the visible grab strip on
  desktop. This is the parent spec's **"bar resize via explicit edge `<DragHandle>`"** precision‑drag
  exception (it keeps the raw‑pointer resize logic; it does **not** opt into long‑press, it stays a
  precision drag).

This is **touch ergonomics only**: pointer detection, sensor config, hover‑reveal toggling, and
coarse‑pointer CSS sizing. No data, query, or behavior changes for mouse users.

## 2. Non‑goals

- **No layout reflow / new breakpoints.** `DAY_W = 28px`, `LABEL_W = 200px`, sticky name rail, and
  native timeline scroll are retained exactly. (Phone reflow is the deferred follow‑up project.)
- **No new server round‑trips, queries, or revalidation.** (See §6.)
- **No desktop behavior change.** Mouse/trackpad keeps 6px‑distance drag, hover‑reveal, the slim 8px
  resize strip, and current target sizes. Every change is gated on `(pointer: coarse)` (CSS
  `pointer-coarse:` variant).
- **No Table / Kanban / Item‑Panel / Nav / Calendar work.** Those are sibling Batch‑2 surfaces (§8).
- **No pinch‑to‑zoom gesture.** The parent spec explicitly scopes Gantt zoom to **minimal** controls
  (the existing Week/Month buttons), not a full zoom system. We only touch‑size the existing buttons.
- **No new DAY_W zoom level.** Adding a finer/coarser day‑width is out of scope; "zoom" here is the
  existing Week/Month window toggle.
- **No Playwright iPad E2E.** Deferred with the phone follow‑up (parent spec). Vitest component tests
  are mandatory here (§7).

## 3. Surfaces in scope (code‑verified inventory)

Single file: `src/components/boards/GanttBoard.tsx` (~980 lines on the `develop` snapshot).

| Site              | Line(s)  | Affordance                                                   | Current state                                                | Treatment                                             |
| ----------------- | -------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------- |
| Sensors           | L199–202 | `DndContext` bar move sensors, flagged `TODO(touch-batch-2)` | `useSensors(useSensor(PointerSensor, { distance: 6 }))`      | → `useTouchAwareSensors()` (long‑press lift)          |
| Zoom toggle       | L455–469 | Week / Month `<button>`s                                     | `px-2.5 py-1 text-xs`, no min touch size                     | + `pointer-coarse:min-h-11 pointer-coarse:px-3`       |
| Per‑row ⋯ menu    | L808–816 | Dependency menu trigger (`Button size="icon-xs"`)            | `size-6 opacity-0 group-hover:opacity-100`                   | + `pointer-coarse:opacity-100 pointer-coarse:size-11` |
| Bar resize handle | L930–937 | Right‑edge `onPointerDown` resize strip                      | `w-2` (8px), `hover:bg-primary-foreground/20`, no touch‑none | + `touch-none pointer-coarse:w-11`                    |

Notes:

- **Bar move long‑press** comes entirely from the TouchSensor inside `useTouchAwareSensors()`; the bar
  and milestone keep carrying their `useDraggable` `listeners`/`attributes` unchanged (the bar body IS
  the long‑press surface). No `<DragHandle>` swap for the bar move.
- **Resize handle** stays the raw‑pointer precision drag (it `stopPropagation()`s and uses
  `setPointerCapture`, so it already works with a finger). Pointer events fire for touch, so the logic
  is unchanged — we only (a) widen the coarse hit area to 44px and (b) add `touch-none` so a resize
  drag doesn't scroll the timeline. We do **not** route it through long‑press (that's for bar move).
- The Week/Month buttons are bare `<button>`s (do **not** inherit the `Button` primitive's
  `pointer-coarse:` sizing), so we add the variant inline — mirrors the sibling Table/Kanban approach.
- The `select` controls (Start / End / Color‑by) are native `<select>`s. On iOS Safari a native
  `<select>` already opens the system wheel picker on tap and a 1‑line select is borderline; to match
  the Kanban "Group by" treatment (which added `pointer-coarse:min-h-11`) we give the three selects the
  same `pointer-coarse:min-h-11 pointer-coarse:px-3` for a comfortable tap target. Low‑risk, consistent.

## 4. Shared primitives consumed (read‑only — DO NOT MODIFY)

Batch‑1 outputs, verified present in this worktree:

- `src/lib/dnd/sensors.ts` → `useTouchAwareSensors()` — PointerSensor 6px **+** TouchSensor
  `{ delay: 200, tolerance: 8 }` (long‑press lift). Drop‑in for the one old sensor block.
- `src/lib/hooks/use-coarse-pointer.ts` → `useCoarsePointer()` — available if a JS branch is needed;
  this surface needs only CSS `pointer-coarse:` classes, so we don't call it.
- `src/components/ui/drag-handle.tsx` → `<DragHandle>` — referenced as the precedent for the
  `pointer-coarse:size-11`/`touch-none` pattern on the resize strip (we do NOT swap the resize element
  for it — the resize element carries bespoke `onPointerDown/Move/Up` resize logic, not dnd listeners).
- **`pointer-coarse:` Tailwind variant** — already active (shipped in `ui/button.tsx`; tested in
  `ui/button.touch.test.tsx`). Used directly on the bare zoom `<button>`s, the resize strip, the
  selects, and appended to the existing per‑row menu `Button` className.

## 5. Design — how each surface is treated

**Bar move sensors (L199–202).** Replace
`const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));`
with `const sensors = useTouchAwareSensors();`. Delete the `TODO(touch-batch-2)` comment and remove
the now‑unused `PointerSensor`, `useSensor`, `useSensors` from the `@dnd-kit/core` import (L4–11) —
`DndContext`, `useDraggable`, `DragEndEvent` stay. The bar's `useDraggable` wiring is untouched;
long‑press lift comes from the shared hook's TouchSensor.

**Zoom toggle (L455–469).** Append `pointer-coarse:min-h-11 pointer-coarse:px-3` to each Week/Month
`<button>`'s className. The active/inactive color logic and `text-xs` are unchanged → desktop
identical, the buttons just grow to ≥44px tall under a finger.

**Per‑row ⋯ menu (L808–816).** Append `pointer-coarse:opacity-100 pointer-coarse:size-11` to the
existing `className="… size-6 opacity-0 group-hover:opacity-100"`. On a fine pointer the menu stays
hover‑revealed at `size-6`; on coarse it is **always visible** and ≥44px. The `MoreHorizontal` icon
stays `size-3.5`. (The menu's `group-hover:` is the **unnamed** row `group` — `<RevealOnHover>` could
target it, but the trigger is a shadcn `Button` we already pass a className to, so the inline
`pointer-coarse:opacity-100` add is the smaller, clearer diff and avoids wrapping the trigger.)

**Bar resize handle (L930–937).** Keep the visible 8px (`w-2`) strip and the raw pointer‑event resize
logic. Add `touch-none` (so a resize drag doesn't scroll the timeline) and `pointer-coarse:w-11` (44px
finger hit area on coarse pointers). The strip is right‑anchored inside the bar's flex row, so widening
it on coarse grows the grab zone leftward into the bar — no overflow past the bar edge, no desktop
change (the `w-2` base is unchanged for fine pointers).

**Selects (Start / End / Color‑by, L480–534).** Append `pointer-coarse:min-h-11 pointer-coarse:px-3`
to each `<select>`'s className for a comfortable coarse tap target, mirroring Kanban's "Group by".
Desktop sizing (`px-2 py-1 text-sm`) unchanged.

All four/seven edits are `pointer-coarse:`‑gated → **zero desktop change, no layout reflow** for mouse.

## 6. Data‑fetching & performance budget (working‑agreement #5)

- **(a) First paint vs. interaction:** First paint is **unchanged** — same RSC board payload, same
  bounded/indexed reads. Every change in this pass is a client‑side presentation/input concern (CSS
  `pointer-coarse:` classes + sensor config). Each touch interaction (long‑press bar lift, reveal,
  resize, zoom toggle) is **0 new server round‑trips**.
- **(b) Does the interaction change server data?** Only the **existing** mutations do: bar move
  (`onBarMoved` → `mutations.setCell`) and bar resize (`onBarResized` → `mutations.setCell`) already
  commit through their current **Server Actions** with targeted revalidation — **unchanged**. The
  zoom/Start/End/Color config persists via the existing `updateBoardView` Server Action in a
  background transition (in‑page client‑state update first, 0 round‑trips on the read path; see
  gotcha‑09 note already in the file). We change _how the gesture is initiated_ (finger vs. mouse),
  never _what it commits or how often_. No new Server Actions, no new revalidation.
- **(c) Bounded over indexed columns?** Untouched. The Gantt read keeps its existing build over the
  in‑memory `cache`; this pass adds no query.

**Net:** first‑paint and per‑interaction server cost is **identical to today**.

## 7. Testing (working‑agreement #4 — written & executed)

Per parent spec: jsdom can't simulate touch‑drag physics, so we assert **sensor config + class
presence**, not gesture playback. Tests extend the existing `GanttBoard.test.tsx`, mirroring the
sibling `KanbanBoard.test.tsx` approach (spy `useTouchAwareSensors`, assert `pointer-coarse:` classes).

- **Sensor regression guard:** `vi.mock("@/lib/dnd/sensors", …)` with `importOriginal` + spy; assert
  `useTouchAwareSensors` is **called** when the board renders (proves the DndContext is wired to the
  shared touch sensors, not the old PointerSensor‑only block).
- **Zoom toggle:** the Week/Month buttons carry `pointer-coarse:min-h-11`.
- **Per‑row ⋯ menu:** the dependency menu trigger carries `pointer-coarse:opacity-100` and
  `pointer-coarse:size-11` (always visible + ≥44px on coarse).
- **Bar resize handle:** the resize strip (`aria-label="Resize …"`) carries `touch-none` and
  `pointer-coarse:w-11`.
- **Selects:** the Start/End/Color‑by selects carry `pointer-coarse:min-h-11`.
- **Desktop‑regression safety:** existing `GanttBoard.test.tsx` cases (bar render, presence ring,
  empty state, color, no‑refresh on picker change) stay green — they assert no class change broke
  layout/behavior.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Deferred:** Playwright iPad device profiles + real touch‑drag E2E (phone follow‑up).

## 8. Disjointness from sibling Batch‑2 passes (no shared file writes)

This surface writes **exactly one file** — `src/components/boards/GanttBoard.tsx` — plus its test
`src/components/boards/GanttBoard.test.tsx`. No other Batch‑2 surface (Table, Kanban, Item‑Panel, Nav,
Calendar) writes either file. The only shared code is the **read‑only Batch‑1 primitives** in §4
(consumed, never modified). It is therefore **file‑disjoint** from the parallel **Calendar** pass and
every other surface, and runs fully concurrently in its own `task/touch-gantt` worktree with no merge
contention beyond ordinary `develop` integration.

---

# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development +
> superpowers:verification-before-completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the Batch‑1 touch primitives across the Gantt surface so it is finger‑usable on iPad,
with zero desktop behavior change and zero new server round‑trips.

**Architecture:** Single‑file, mechanical adoption of `useTouchAwareSensors()` and `pointer-coarse:`
≥44px sizing / always‑visible reveal on the bare controls. All changes gated on `(pointer: coarse)`.

**Tech Stack:** Next.js 16 / React 19 / Tailwind v4 (`pointer-coarse:` variant) / dnd‑kit 6.3 /
Vitest + jsdom.

---

### Task 1: GanttBoard — migrate bar‑move sensors to the shared touch sensors

**Files:**

- Modify: `src/components/boards/GanttBoard.tsx` (sensors L199–202; imports L4–11)
- Test: `src/components/boards/GanttBoard.test.tsx`

- [ ] **Step 1 — Failing test.** Add `vi.mock("@/lib/dnd/sensors", …)` (importOriginal + spy) and a
      test asserting `useTouchAwareSensors` is called on render. Run `pnpm test:unit GanttBoard` → FAIL
      (hook not imported/called yet).
- [ ] **Step 2 — Implement.** `import { useTouchAwareSensors } from "@/lib/dnd/sensors";`; replace the
      sensor block with `const sensors = useTouchAwareSensors();`; delete the `TODO(touch-batch-2)`
      comment; remove now‑unused `PointerSensor`/`useSensor`/`useSensors` from the dnd import.
- [ ] **Step 3 — Run.** `pnpm test:unit GanttBoard` → PASS; `pnpm typecheck` → no unused‑import error.
- [ ] **Step 4 — Commit.** `git add src/components/boards/GanttBoard.tsx src/components/boards/GanttBoard.test.tsx`
      → `feat(boards): touch-aware bar-move sensors in gantt timeline`.

### Task 2: GanttBoard — ≥44px / always‑visible touch targets on zoom, menu, resize, selects

**Files:**

- Modify: `src/components/boards/GanttBoard.tsx` (zoom L455–469; menu L808–816; resize L930–937;
  selects L480–534)
- Test: `src/components/boards/GanttBoard.test.tsx`

- [ ] **Step 1 — Failing test.** Assert: Week/Month buttons have `pointer-coarse:min-h-11`; per‑row ⋯
      trigger has `pointer-coarse:opacity-100` + `pointer-coarse:size-11`; resize strip has `touch-none` + `pointer-coarse:w-11`; Start/End/Color‑by selects have `pointer-coarse:min-h-11`. Run
      `pnpm test:unit GanttBoard` → FAIL.
- [ ] **Step 2 — Implement.** Append the `pointer-coarse:` classes per §5 to each site. Desktop base
      classes untouched.
- [ ] **Step 3 — Run.** `pnpm test:unit GanttBoard` → PASS.
- [ ] **Step 4 — Commit.** `git add src/components/boards/GanttBoard.tsx src/components/boards/GanttBoard.test.tsx`
      → `feat(boards): finger-friendly zoom, row menu, bar resize in gantt`.

### Task 3: Full gate

**Files:** none (verification + closure)

- [ ] **Step 1 — Full gates.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green
      (treat `*.integration.test.ts` flake per the orchestrator note; `pnpm test:unit` is the real gate).
- [ ] **Step 2 — Reasoning pass.** Grep the diff: every sizing/opacity change is `pointer-coarse:`‑gated;
      no `TODO(touch-batch-2)` marker remains in the file.
- [ ] **Step 3 — STOP.** Hand the orchestrator the gate evidence + "How to test". Do **not** run
      finish‑task (orchestrator merges).

---

## Execution DAG (working‑agreement #6)

**Dependency edges (Consumes → Produces):**

- Both implementation tasks **Consume** the read‑only Batch‑1 primitives (already merged → no in‑plan
  dependency).
- Task 1 (sensors) and Task 2 (sizing) **both write `GanttBoard.tsx`** → they must **not** run in
  parallel (same‑file write contention). Sequence: **1 → 2**.
- Task 3 (full gate) **depends on** 1 and 2.

```
[1 → 2] → 3
```

- **Parallel batches:** none within this surface — it is one file, so the work is an inherently serial
  1→2→3 chain. (The whole surface itself is one parallel lane in the parent Batch‑2 DAG, concurrent
  with Calendar and the already‑shipped Table/Kanban/Item‑Panel/Nav.)
- **Critical path (wall‑clock floor):** `Task 1 → Task 2 → Task 3` = 3 sequential tasks.
- **Dispatch:** single‑file, single lane → executed **in‑session** (TDD, one task at a time), not
  across subagents/worktrees.

**Task count:** 3 (2 implementation + 1 gate). **Critical path:** 3. **Size:** Small–Medium
(single‑file mechanical adoption).

## How to test this (post‑merge, for the user)

1. Pull `develop`; open the app on an **iPad** (or browser DevTools device mode set to iPad + touch
   emulation) at a board's **Gantt / Timeline** view.
2. **Bar move:** press‑and‑hold (~200ms) a bar (or milestone diamond) → it lifts → drag left/right to
   reschedule; release to commit. A quick swipe should **scroll** the timeline instead of dragging.
3. **Zoom:** tap the **Week** / **Month** toggle — the buttons are comfortably tall (≥44px) and switch
   the timeline window.
4. **Bar resize:** drag a bar's **right edge** with a finger — the grab zone is wide enough to catch;
   the bar's end date persists on release, and dragging it does **not** scroll the timeline.
5. **Row menu:** without hovering, each row's ⋯ menu (left rail) is **visible** and ≥44px — tap it to
   open the "Blocked by…" dependency menu.
6. **Pickers:** the Start / End / Color‑by selects are tall enough to tap comfortably.
7. **Desktop regression:** on a mouse/trackpad, everything looks and behaves **exactly as before**
   (hover‑reveal ⋯ menu, slim 8px resize strip, 6px‑distance bar drag, compact zoom buttons/selects).

## Risks & open questions

- **Resize hit‑area widening** grows the coarse grab zone leftward into the bar (right‑anchored strip);
  verify it doesn't swallow taps on the bar label on very short bars. Acceptable: resize > body tap on
  the right edge is the intended affordance, and it's coarse‑only.
- **Bar move vs. resize on touch:** the resize strip `stopPropagation()`s its pointer events, so a
  long‑press on the strip resizes rather than lifting the bar — same as desktop. Confirm in review.
- **jsdom can't play touch‑drag physics** — accepted; we assert sensor config + class presence, with
  the Playwright iPad matrix deferred to the phone follow‑up.
