# TOUCH Batch 2 — Kanban iPad Touch Polish — Spec + Plan

**Date:** 2026-06-29
**Status:** Spec written — awaiting review (do NOT build yet)
**Scope owner:** Danijel Jovanovic
**Parent spec:** `docs/superpowers/specs/2026-06-26-ipad-touch-optimization-design.md` (surface ③ Kanban)
**Worktree / branch:** `.claude/worktrees/touch-kanban` / `task/touch-kanban`

---

## TL;DR — honest scope read (read this first)

**The Kanban surface is already ~90% touch-complete, and the parent spec's "Medium effort"
estimate is wrong for this file as it stands today.** The brief assumed the card has
hover-hidden action menus / per-card affordances that need wrapping in `RevealOnHover`. **It does
not.** Code audit of `src/components/boards/KanbanBoard.tsx` (594 lines) found:

- **Zero** hover-hidden affordances on this surface. No `group-hover`, no `opacity-0`, no
  per-card overflow/`…` menu, no `DropdownMenu`, no row-hover action buttons. `grep` for
  `onClick`/`DropdownMenu`/`button`/`Menu` inside the file returns **nothing** except the
  `AddCardInput` text field.
- **The DnD foundation is genuinely done.** Line 142 already calls `useTouchAwareSensors()` — this
  is the Batch-1 reference integration. Long-press lift (200ms / 8px) vs. quick-swipe-scroll is
  already wired via the shared `TouchSensor`. Lanes use native `overflow-x-auto` / `overflow-y-auto`,
  so a swipe scrolls and a hold drags. **Nothing to do here.**
- The card (`<article>`) is a pure drag-presentation surface — it does **not** even open the Item
  Panel on tap, has no buttons, and reveals nothing on hover.

**What's actually left is small and real, but minor:** two **native** form controls on this
surface (the "Group by" `<select>` and the per-lane `AddCardInput` `<input>`) are **not** the
shadcn `Button`/`Input` primitives, so they did **not** inherit Batch-1's `pointer-coarse:`
auto-sizing and sit below the 44px touch minimum. Plus a couple of belt-and-suspenders touch
hardening details (drag-handle affordance discoverability, `touch-action` correctness). That's the
whole job.

**Recommendation:** This does **not** warrant a standalone multi-task build. It is **one small
task** (~30–45 min including tests). The cleanest path is to **fold it into another light-lane
surface pass** (e.g. bundle with Nav or Command/menus) OR run it as a single fast worktree task if
parallelism is already in flight. The plan below is written as **one task** so it can be dropped
into either. We deliberately do **not** pad it with `RevealOnHover` migrations that this file
doesn't need.

---

## Goal

Bring the two native (non-shadcn) interactive controls on the Kanban surface up to the ≥44px
touch-target minimum under a coarse pointer, and confirm the already-wired long-press drag is
robust — **without any layout reflow** and with **zero new server round-trips**. iPad-first.

## Surface & files

- **Single surface:** `src/components/boards/KanbanBoard.tsx` (size S, ~594 lines).
- **Test:** `src/components/boards/KanbanBoard.test.tsx` (already exists; extend, don't replace).
- **Shared primitives — ADOPT READ-ONLY (do not modify):**
  - `src/lib/dnd/sensors.ts` — `useTouchAwareSensors()` (already imported & used at line 142)
  - `src/components/ui/reveal-on-hover.tsx` — `RevealOnHover` (audit says: **not needed on this
    surface**; documented below so a reviewer doesn't flag its absence)
  - `src/components/ui/drag-handle.tsx` — `DragHandle` (not needed — long-press lift is the chosen
    Kanban gesture, not an explicit handle; handles are reserved for Table/Gantt precision drags)
  - `src/lib/hooks/use-coarse-pointer.ts` — `useCoarsePointer()` (only needed if we choose the
    JS-driven sizing variant; the plan uses the CSS `pointer-coarse:` variant instead, so this stays
    untouched too)
- **Constraint:** touch-ergonomics only; **NO layout reflow**. The `w-72` (288px) lanes are
  retained verbatim, per the parent spec.

## Disjointness note (working-agreement #6 / parallel-safety)

This surface is **fully disjoint** from the parallel Table / Item-Panel / Nav passes. It mutates
exactly **one** app file (`KanbanBoard.tsx`) plus its colocated test, and only **reads** shared
primitives (it does not edit any `src/components/ui/*`, `src/lib/dnd/*`, or `src/lib/hooks/*`).
There is **no shared mutable state** with any other Batch-2 surface, so it can run in its own
worktree concurrently with all other surfaces with zero merge contention beyond the (already
landed) Batch-1 foundation.

---

## Audit detail — what's already done vs. what remains

| Concern (from parent spec ③)          | Status in code today                                                                                                   | Action                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Card drag via long-press lift         | **DONE** — `useTouchAwareSensors()` (line 142) → `TouchSensor` 200ms/8px                                               | none                                    |
| Quick swipe scrolls lanes, hold drags | **DONE** — native `overflow-x-auto` (line 259) + `overflow-y-auto` (line 362); TouchSensor delay yields scroll-vs-drag | verify only                             |
| 288px lanes retained                  | **DONE** — `w-72` (line 329), unchanged                                                                                | none                                    |
| Card hover-actions → always-visible   | **N/A** — there are **no** hover-gated card actions on this surface                                                    | none (document why)                     |
| `add-card` touch-sized                | **GAP** — `AddCardInput` is a raw `<input>`, no coarse sizing → row ~32px tall                                         | **size to ≥44px on coarse**             |
| `lane-menu` touch-sized               | **N/A** — there is no lane menu; the only lane control is the add-card input                                           | none                                    |
| "Group by" picker touch-reachable     | **GAP** — native `<select>` with `py-1` (~28–30px) → below 44px on coarse                                              | **size to ≥44px on coarse**             |
| Card itself a tap target              | Card is drag-only (no tap action). The `cursor-grab` drag-from-card is the affordance.                                 | add `touch-none` correctness (see risk) |

### Why no `RevealOnHover`

`RevealOnHover` exists to convert `opacity-0 group-hover:opacity-100` blocks to always-visible on
coarse pointers. **This file has none of those blocks.** Wrapping nonexistent affordances would be
dead code. If a future change adds a per-card menu, it should use `RevealOnHover` then — that's a
follow-up, explicitly out of scope here.

### Why no `DragHandle`

`DragHandle` (≥44px grip) is the parent spec's chosen treatment for the **two precision drags**
(Table column resize, Gantt bar resize) that opt **out** of long-press. Kanban's chosen gesture is
**long-press lift on the whole card** — adding an explicit handle would be a behavior change the
parent spec didn't ask for and would shrink the drag target, not grow it. Skip it.

---

## Design decisions

1. **Size native controls via the CSS `pointer-coarse:` variant, not JS.** Tailwind v4 ships
   `pointer-coarse:` as a built-in `@media (pointer: coarse)` variant (already used across
   `src/components/ui/button.tsx` and `drag-handle.tsx`). Applying `pointer-coarse:` utilities to
   the native `<select>` and `<input>` gives them a ≥44px hit area on touch with **zero desktop
   change** and **no extra hook/JS** (so `useCoarsePointer()` and a client re-render are avoided —
   the sizing is pure CSS, SSR-stable, PPR-safe). This mirrors exactly how the shadcn primitives got
   their coarse sizing in Batch 1.
2. **Grow the hit area, keep the visual.** Per the parent spec's "ergonomics, not reflow" rule, we
   enlarge the _interactive_ area (min-height / padding) of the two controls on coarse pointers only.
   Desktop spacing is untouched. The Group-by bar and per-lane add-row already live outside the
   virtualized scroll region, so growing them does not perturb card virtualization.
3. **No new gestures, no Item-Panel-open on card tap.** Out of scope — the card is drag-only today
   and stays that way. Adding tap-to-open is a feature, not touch polish.

---

## Data-fetching & performance budget (working-agreement #5)

- **First paint:** unchanged. No new queries, no new server reads. The board payload, the
  `["board", boardId]` cache hydration, the virtualizer, and the realtime subscription are all
  untouched.
- **Per interaction:** **0 new server round-trips.** The only changes are CSS utility classes on
  two existing client controls. The pre-existing drag-commit (`setCell` / `clearCellValue` via
  `useBoardMutations`) and quick-add (`addItem`) are **existing Server Actions** — we do not add,
  remove, or alter any of them. View toggles / group-by already use the existing
  `updateBoardView` Server Action + `router.refresh()` (pre-existing, unchanged).
- **Does the interaction change server data?** No — touch-target sizing is pure client CSS. The
  one interaction that _does_ change server data (drag-to-set-status) already routes through its
  existing Server Action; we don't touch that wiring.
- **Bounded/indexed reads:** unchanged. Card lists are already virtualized
  (`@tanstack/react-virtual`, `overscan: 8`); we add no unbounded reads.

---

## Testing plan (working-agreement #4 — mandatory, written & executed)

All in `src/components/boards/KanbanBoard.test.tsx` (Vitest / jsdom), extending the existing suite.
jsdom can't simulate touch-drag physics, so per the parent spec we assert **markup/config**, not
gesture playback.

1. **Group-by select is coarse-sized.** Render `<KanbanBoard>`; query the `kanban-group-column`
   select (`screen.getByLabelText("Group by")` via its `<label htmlFor>`); assert its `className`
   contains the `pointer-coarse:` min-height utility (e.g. `pointer-coarse:min-h-11`). This pins the
   ≥44px coarse target without needing real `matchMedia` layout.
2. **Add-card input is coarse-sized.** Query an add-card input
   (`screen.getByLabelText("Add item to Working")`); assert its (or its row wrapper's) `className`
   contains the `pointer-coarse:` min-height utility. Confirms the per-lane add affordance is
   touch-reachable.
3. **Regression guard — sensors still wired.** The existing
   `expect(useTouchAwareSensors).toHaveBeenCalled()` test (line 157) must still pass — proves we
   didn't disturb the drag foundation.
4. **Regression guard — drag/drop logic intact.** The existing `onCardDropped` unit tests and the
   add-card → `setCell` tests must still pass unchanged.
5. **(Optional, if `touch-action` change is made):** assert the draggable `<article>` carries the
   expected `touch-action`/`touch-none`-equivalent class so a card-drag doesn't fight page scroll.

**Gates (must pass before finish-task):**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

---

## Execution DAG (working-agreement #6)

This is a **single-task** slice — there is genuinely no sub-task parallelism to extract.

```
Batch 1 (Foundation) ──merged already──> Task 1 (Kanban coarse-size native controls)
```

- **Dependency graph:** Task 1 depends only on Batch-1 foundation (already merged to `develop`).
- **Parallel batches:** one batch, one task. No intra-slice fan-out.
- **Critical path:** Task 1 alone (~30–45 min). Trivially the shortest of all Batch-2 surfaces.
- **Cross-surface concurrency:** safe to run alongside Table / Item-Panel / Nav passes (disjoint
  files — see Disjointness note). At the Batch-2 level it sits in the **light lane**, finishing
  well inside the heavy lane (Table / Gantt).

---

## Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Load `pulse-ui` + `frontend-design` before editing UI.

**Goal:** Give the Kanban "Group by" `<select>` and per-lane add-card `<input>` a ≥44px touch
target on coarse pointers, via the CSS `pointer-coarse:` variant, with no layout reflow and no new
server round-trips.

**Architecture:** Pure additive Tailwind utility classes (`pointer-coarse:min-h-11` and matching
padding) on two existing native controls in `KanbanBoard.tsx`. No new components, hooks, or
Server Actions. The shared touch foundation is consumed read-only and is already wired for drag.

**Tech Stack:** Next.js 16, React 19, Tailwind v4 (`pointer-coarse:` built-in variant),
@dnd-kit (already configured), Vitest/jsdom.

---

### Task 1: Coarse-size the Kanban native controls

**Files:**

- Modify: `src/components/boards/KanbanBoard.tsx`
  - Group-by `<select>` block (around lines 240–251)
  - `AddCardInput` row wrapper / `<input>` (around lines 565–583)
- Test: `src/components/boards/KanbanBoard.test.tsx` (extend existing suite)

- [ ] **Step 1: Write the failing tests.** Add to `KanbanBoard.test.tsx`, inside the existing
      `describe("KanbanBoard", …)` block:

```tsx
it("gives the Group-by select a coarse-pointer touch target (>=44px)", () => {
  renderKanban();
  const select = screen.getByLabelText("Group by");
  expect(select.className).toContain("pointer-coarse:min-h-11");
});

it("gives each add-card input a coarse-pointer touch target (>=44px)", () => {
  renderKanban();
  const input = screen.getByLabelText("Add item to Working");
  // The add-card affordance is the input + its row; assert the touch target on
  // whichever element carries the sizing (input here).
  expect(input.className).toContain("pointer-coarse:min-h-11");
});
```

- [ ] **Step 2: Run the new tests to confirm they fail.**

Run: `pnpm test -- src/components/boards/KanbanBoard.test.tsx`
Expected: FAIL — the two new assertions fail (`className` does not yet contain
`pointer-coarse:min-h-11`); all pre-existing tests still PASS.

- [ ] **Step 3: Add coarse sizing to the Group-by `<select>`.** In `KanbanBoard.tsx`, append the
      coarse utilities to the select's `className` (keep everything already there). Final class
      string:

```tsx
className =
  "bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-3";
```

(Adds `pointer-coarse:min-h-11 pointer-coarse:px-3` only; desktop rendering is byte-for-byte
unchanged because `pointer-coarse:` is inert under a fine pointer.)

- [ ] **Step 4: Add coarse sizing to the add-card `<input>`.** In `AddCardInput`, append the same
      coarse min-height to the `<input>`'s `className`. Final class string:

```tsx
className =
  "text-foreground placeholder:text-muted-foreground focus-visible:ring-ring w-full bg-transparent text-sm outline-none focus-visible:rounded-sm focus-visible:ring-2 disabled:opacity-50 pointer-coarse:min-h-11";
```

(If desired for visual balance, also widen the row wrapper's vertical padding on coarse only by
adding `pointer-coarse:py-1` to the row `div` at line ~566 — optional, not asserted by tests.)

- [ ] **Step 5: Run the full test file to confirm green.**

Run: `pnpm test -- src/components/boards/KanbanBoard.test.tsx`
Expected: PASS — both new tests pass; every pre-existing test (sensors wired, columns render,
add-card → setCell, presence ring, card fields, `onCardDropped`) still passes.

- [ ] **Step 6: Run the full gate.**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four pass.

- [ ] **Step 7: Commit (stage by path only).**

```bash
git add src/components/boards/KanbanBoard.tsx src/components/boards/KanbanBoard.test.tsx
git commit -m "feat(boards): coarse-pointer touch targets for Kanban group-by + add-card

Changelog: improved | Kanban touch targets | Group-by and add-card controls are now finger-sized on iPad"
```

---

### (Conditional) Task 1b: touch-action correctness on the draggable card

Only do this if manual iPad testing (or review) shows a card long-press-drag fighting vertical
lane scroll. The `TouchSensor` 200ms delay usually resolves this, so this is a **contingency**, not
a planned change.

- If needed: add `touch-none` (or `touch-pan-y` if vertical scroll must survive) to the draggable
  `<article>` `className` (line ~448) **under `pointer-coarse:` only**, add a Vitest assertion for
  the class, re-run the gate, and commit. Do **not** apply it unconditionally — `touch-none` on a
  fine pointer is harmless but `pointer-coarse:` keeps intent clear.

---

## Self-review (spec + plan)

- **Spec coverage:** parent spec ③'s real gaps (add-card sizing, group-by/lane-control
  reachability) → Task 1. Items the parent listed that don't exist on this surface (hover card
  actions, lane menu) → explicitly documented as N/A with rationale. No silent gaps.
- **Placeholders:** none — every step has concrete class strings, commands, and expected output.
- **Type/name consistency:** `useTouchAwareSensors`, `RevealOnHover`, `DragHandle`,
  `useCoarsePointer`, `AddCardInput`, `pointer-coarse:min-h-11`, label text "Group by" / "Add item
  to Working" all match the verified source and existing test fixtures.
- **Scope:** single task, single file + test; honest "this barely warrants its own build" call
  surfaced in the TL;DR.

## How to test (manual, post-merge)

On an iPad (or Chrome DevTools device emulation with a coarse-pointer profile), open a board's
**Kanban** view:

1. Tap the **"Group by"** dropdown at the top of the board → it should be comfortably tappable
   (≥44px tall), open the native picker, and switch the grouping column.
2. Tap a lane's **"Add item"** field at the bottom of a column → the tap target should be
   finger-sized (≥44px), focus the input, and let you type + Enter to add a card under that status.
3. **Press-and-hold** a card ~0.2s then drag it to another lane → it lifts and drops, setting the
   card's status. A quick **swipe** on the lane should scroll, not pick up a card.
4. On desktop (mouse), confirm the Group-by bar and add-card rows look **identical to before** (no
   reflow, same compact height).

If the change ships bundled into another surface's task, note that in the closing message.
