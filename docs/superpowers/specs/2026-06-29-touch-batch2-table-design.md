# TOUCH Batch 2 — Board Table iPad Touch-Ergonomics Pass — Spec + Plan

**Date:** 2026-06-29
**Status:** Spec written — awaiting review
**Scope owner:** Danijel Jovanovic
**Parent spec:** [`2026-06-26-ipad-touch-optimization-design.md`](./2026-06-26-ipad-touch-optimization-design.md) — surface ② (Board Table, "High (75KB)")
**Worktree / branch:** `.claude/worktrees/touch-table` / `task/touch-table`

> This is **both** the design spec and the implementation plan for one Batch‑2 surface. It is a
> mechanical adoption pass — the touch **foundation already shipped in Batch 1** (`useCoarsePointer`,
> `useTouchAwareSensors`, `<DragHandle>`, `<RevealOnHover>`, `pointer-coarse:` sizing on `ui/`
> primitives). We only **consume** those primitives on the Table surface. No new primitives, no
> layout reflow, no new server round‑trips.

---

## 1. Goal

Make the board **Table** view fully usable by a finger on an iPad (portrait 768px / landscape
1024px), matching desktop authoring parity, with **no layout reflow** (the `md:` breakpoint already
renders the desktop layout ≥768px). Concretely:

- Row / group / subitem reorder works by **long‑press lift** (a quick swipe still scrolls).
- Column **resize** works by a finger via an explicit **≥44px** edge target (precision drag, opts out
  of long‑press).
- Row / group / column **action menus and drag handles stop being hover‑only** — a finger can't
  hover, so on coarse pointers they are always visible.
- The highest‑traffic **inline cell editors** (status, checkbox, rating, clear) and the special‑cell
  inline action buttons (files, relation, time‑tracking) get **≥44px** tap targets on coarse
  pointers.

This is **touch ergonomics only**: pointer detection, sensor config, hover‑reveal toggling, and
coarse‑pointer CSS sizing. No data, query, or behavior changes for mouse users.

## 2. Non‑goals

- **No layout reflow / new breakpoints.** Sticky Name column + native horizontal scroll + ~180px
  column widths are retained exactly. (Phone reflow is the deferred follow‑up project.)
- **No new server round‑trips, queries, or revalidation.** (See §6.)
- **No desktop behavior change.** Mouse/trackpad keeps 6px‑distance drag, hover‑reveal, and current
  target sizes. Every change is gated on `(pointer: coarse)` (CSS `pointer-coarse:` variant or the
  `useCoarsePointer()` hook).
- **No Gantt zoom / Kanban / Item‑Panel / Nav work.** Those are sibling Batch‑2 surfaces (see §8).
- **No Playwright iPad E2E.** Deferred with the phone follow‑up (parent spec). Vitest component tests
  are mandatory here (§7).
- **No rewrite of cell editors onto the `Button` primitive.** We add the `pointer-coarse:` sizing
  variant to the existing bare `<button>` elements in place — smaller, lower‑risk diff than a
  primitive migration, and it reuses the exact variant the `ui/` primitives already use.

## 3. Surfaces in scope (code‑verified inventory)

All paths under `src/components/boards/`. Line numbers are the current `develop`‑snapshot state.

### 3a. `BoardTable.tsx` (~2,302 lines, size L) — primary file

**Three `DndContext` setups**, each on the old `useSensor(PointerSensor, { distance: 6 })`, each
flagged `TODO(touch-batch-2)`:

| Sensor decl | DndContext                                | What reorders   |
| ----------- | ----------------------------------------- | --------------- |
| L602–605    | L669–706 `id="board-groups"`              | Group reorder   |
| L1353–1356  | L1444–1505 `id="group-items-${group.id}"` | Item reorder    |
| L1824–1827  | L1844–1867 `id="subitems-${parentId}"`    | Subitem reorder |

**Seven hand‑rolled `opacity-0 … group-hover:opacity-100` reveals** (3 are drag handles, 4 are action
buttons):

| Line | Affordance                                                | Current size | Group ctx        | Type   |
| ---- | --------------------------------------------------------- | ------------ | ---------------- | ------ |
| 911  | Group menu (`MoreHorizontal`)                             | `size-7`     | `group/grouphdr` | action |
| 996  | Row menu (`MoreHorizontal`)                               | `size-7`     | `group/name`     | action |
| 1113 | Group drag handle (`GripVertical`, carries dnd listeners) | `size-7`     | `group/grouphdr` | handle |
| 1567 | Item drag handle (carries dnd listeners)                  | `size-6`     | `group/name`     | handle |
| 1614 | Add‑subitem (`Plus`)                                      | `size-7`     | `group/name`     | action |
| 1734 | Subitem drag handle (carries dnd listeners)               | `size-6`     | `group/name`     | handle |
| 2218 | Open‑item‑panel (`Maximize2`)                             | `size-7`     | `group/name`     | action |

### 3b. `ColumnHeader.tsx` (158 lines)

- **Column resize** via raw `onPointerDown` (L56–72) → window `pointermove`/`pointerup`; clamped by
  `clampDragWidth(MIN=80, MAX=1200)`. Resize target (L127–133) is `role="separator"`, **`w-1` (4px)**
  — far below 44px; `hover:bg-primary/40` is the only feedback (invisible to touch). This is the
  parent spec's **"column resize via explicit `<DragHandle>`"** precision‑drag exception.
- **Column menu trigger** (L92–122): bare `<button>` with `opacity-0 group-hover/col:opacity-100`
  (L96), no sizing — hover‑only and sub‑44px.

### 3c. `ColumnOptionsDialog.tsx` (option reorder)

- One `DndContext` on the old PointerSensor (decl L123–126, flagged `TODO(touch-batch-2)`).
- `OptionRow` (L254+): drag handle `size-7` always‑visible (L291–295), color swatch `size-6`
  (L300–306), remove `size-7` (L342–349) — all sub‑44px but already always‑visible (it's a dialog,
  no hover‑gate).

### 3d. `cells/` inline editors + special cells

Bare `<button>` / native controls (do **not** inherit the `Button` primitive's `pointer-coarse:`
sizing). Highest‑traffic targets to size up on coarse pointers:

- `cells/editors/index.tsx`: ClearButton (L100), StatusEditor option pills (L204), CheckboxEditor
  native checkbox `size-4` (L378–388), RatingEditor 5× `size-5` stars in a tight `gap-1` row
  (L401–413).
- `cells/FilesCell.tsx`: file chip `size-6` (L39), upload icon button (L63).
- `cells/RelationCell.tsx`: add‑chip `size-5` (L114).
- `cells/TimeTrackingCell.tsx`: start/stop quick action `p-0.5`+`size-3.5` (L72), **hover‑only
  edit/delete reveal** (L368) with `size-3` icons, DatePickerButton `h-6` (L461).

### 3e. Existing tests (none cover touch)

`BoardTable.test.tsx`, `ColumnHeader.test.tsx`, `ColumnOptionsDialog.test.tsx`,
`cells/editors/editors.test.tsx`, `cells/TimeTrackingCell.test.tsx`, etc. — **none mock `matchMedia`
/ coarse pointer**. New per‑surface coarse‑pointer tests are added where behavior changes.

## 4. Shared primitives consumed (read‑only — DO NOT MODIFY)

Batch‑1 outputs, verified present in this worktree:

- `src/lib/dnd/sensors.ts` → `useTouchAwareSensors()` — PointerSensor 6px **+** TouchSensor
  `{ delay: 200, tolerance: 8 }` (long‑press lift). Drop‑in for all four old sensor blocks.
- `src/lib/hooks/use-coarse-pointer.ts` → `useCoarsePointer()` — `useSyncExternalStore` over
  `matchMedia('(pointer: coarse)')`, SSR‑safe `false` default.
- `src/components/ui/drag-handle.tsx` → `<DragHandle>` — slim grip, `size-5 pointer-coarse:size-11`,
  `touch-none`, spread dnd `listeners`/`attributes` onto it. For the **column‑resize** precision drag.
- `src/components/ui/reveal-on-hover.tsx` → `<RevealOnHover>` — `opacity-0 group-hover/…` for fine
  pointers, **`opacity-100` on coarse**. Replaces the hand‑rolled BoardTable reveal blocks.
- **`pointer-coarse:` Tailwind variant** — already active (shipped in `ui/button.tsx`; tested in
  `ui/button.touch.test.tsx`). Use it directly on bare `<button>`s in `ColumnHeader`, `OptionRow`,
  and the cell editors to get `pointer-coarse:size-11` / `pointer-coarse:h-11` without a primitive
  rewrite.

## 5. Design — how each surface is treated

**Reorder (all 4 DndContexts).** Swap each `useSensors(useSensor(PointerSensor, …))` for
`useTouchAwareSensors()` and delete the `TODO(touch-batch-2)` comment + now‑unused `PointerSensor` /
`useSensor` / `useSensors` imports where they become unused. The drag handles **keep carrying the
dnd `listeners`/`attributes`** (no behavioral change to wiring); long‑press lift comes entirely from
the TouchSensor in the shared hook.

**Drag handles (BoardTable L1113 / L1567 / L1734).** Two problems on touch: hover‑gated (invisible)
and sub‑44px. Keep them as the listener‑carrying button (don't swap to `<DragHandle>` — these don't
opt out of long‑press, they ARE the long‑press surface), but: (a) wrap/replace the `opacity-0
group-hover:opacity-100` portion with the coarse‑aware reveal so they're **always visible on coarse**
(simplest: add `pointer-coarse:opacity-100` to the existing className — keeps the hover‑reveal for
mouse, forces visible for finger, no JS); (b) add `pointer-coarse:size-11` so the hit area is ≥44px
on touch while staying `size-6`/`size-7` on desktop. The `GripVertical` icon stays `size-3.5`/`size-4`.

**Action menus (BoardTable L911 / L996 / L1614 / L2218).** Same coarse‑reveal treatment: replace the
hand‑rolled `opacity-0 … group-hover:opacity-100` with `<RevealOnHover>` **or** the inline
`pointer-coarse:opacity-100` add (chosen per‑site by which yields the smaller, clearer diff — these
are inside existing `group/name`‑/`group/grouphdr`‑scoped ancestors, which `<RevealOnHover>`'s plain
`group-hover:` does **not** target, so for the named‑group sites we use the inline
`pointer-coarse:opacity-100` add to preserve the `group-hover/name:` scoping; `<RevealOnHover>` is
reserved for any unscoped `group-hover` site). Add `pointer-coarse:size-11` for the ≥44px hit area.

> **Design note on `<RevealOnHover>` vs inline class.** `<RevealOnHover>` hard‑codes
> `group-hover:opacity-100` (unscoped). BoardTable's reveals use **named** group scopes
> (`group-hover/name:`, `group-hover/grouphdr:`) so a parent hover reveals the whole row's controls.
> Swapping to the unscoped component would change desktop hover behavior. To honor "no desktop
> behavior change," BoardTable's named‑scope reveals get the **inline** `pointer-coarse:opacity-100`
> addition (1 class per site), not the component. The component is still the right tool for any
> unscoped reveal and for the sibling surfaces. This is a deliberate, documented divergence.

**Column resize (`ColumnHeader.tsx`).** The `w-1` (4px) separator becomes finger‑hittable on coarse
without widening the visible 4px line on desktop: expand the **hit area** via
`pointer-coarse:w-11 pointer-coarse:-right-5` (44px wide, centered on the edge) while the visible
fill stays a 4px line (use a child or `before:` for the visual, hit area on the parent). The raw
pointer‑event resize logic is **unchanged** (pointer events already fire for touch). Add
`touch-none` so a resize drag doesn't scroll the table. **Column menu trigger:** add
`pointer-coarse:opacity-100` (always visible on touch) + `pointer-coarse:size-11` (≥44px). Keep
`group/col` hover behavior for mouse.

**Option reorder (`ColumnOptionsDialog.tsx`).** Swap to `useTouchAwareSensors()`. `OptionRow` handle
/ swatch / remove get `pointer-coarse:size-11` (they're already always‑visible in the dialog, so no
reveal change).

**Inline cell editors (`cells/`).** Add `pointer-coarse:` sizing to the highest‑traffic targets:
ClearButton, StatusEditor option pills, CheckboxEditor (wrap the native `size-4` checkbox in a
`pointer-coarse:size-11` tap target / label), RatingEditor stars (`pointer-coarse:size-11` +
`pointer-coarse:gap-0` neutralized to comfortable spacing), FilesCell chip/upload, RelationCell
add‑chip, TimeTrackingCell start/stop + DatePicker. TimeTrackingCell's **hover‑only edit/delete
reveal (L368)** gets `pointer-coarse:opacity-100`. All `pointer-coarse:`‑gated → zero desktop change.

## 6. Data‑fetching & performance budget (working‑agreement #5)

- **(a) First paint vs. interaction:** First paint is **unchanged** — same RSC board payload, same
  bounded/indexed reads, same virtualization. Every change in this pass is a client‑side
  presentation/input concern (CSS `pointer-coarse:` classes, sensor config, reveal toggling). Each
  touch interaction (long‑press lift, reveal, resize) is **0 new server round‑trips**.
- **(b) Does the interaction change server data?** Only the **existing** mutations do: row/group/
  subitem reorder and column resize already commit through their current **Server Actions**
  (`reorderGroup`, `reorderItem`, `resizeColumn`, `onResizeEnd` → persist) with targeted
  revalidation — **unchanged**. We change _how the gesture is initiated_ (finger vs. mouse), never
  _what it commits or how often_. No new Server Actions, no new revalidation.
- **(c) Bounded over indexed columns?** Untouched. The hot‑path Table read keeps its existing
  pagination/virtualization over indexed columns; this pass adds no query.

**Net:** first‑paint and per‑interaction server cost is **identical to today**.

## 7. Testing (working‑agreement #4 — written & executed)

Per parent spec: jsdom can't simulate touch‑drag physics, so we assert **config + reveal state**,
not gesture playback. New tests mock `matchMedia` for coarse/fine.

- **`BoardTable.test.tsx` (extend):** with `matchMedia('(pointer: coarse)')` → `true`, row/group/
  subitem action buttons and drag handles render **visible** (assert no `opacity-0`, or
  `pointer-coarse:opacity-100` / `size-11` classes present). Assert each DndContext's sensors come
  from `useTouchAwareSensors` (assert the sensor descriptor list includes a `TouchSensor` — e.g. by
  spying the hook or asserting the rendered handle wiring is unchanged). Keep the existing
  virtualizer offset stubs.
- **`ColumnHeader.test.tsx` (extend):** coarse → resize separator has the `pointer-coarse:w-11` hit
  area + `touch-none`; column‑menu trigger is visible (not opacity‑gated) and ≥44px. Resize
  pointer‑event logic regression (existing behavior) still passes.
- **`ColumnOptionsDialog.test.tsx` (extend):** sensors are touch‑aware; OptionRow controls carry
  `pointer-coarse:size-11`.
- **`cells/editors/editors.test.tsx` + `cells/TimeTrackingCell.test.tsx` (extend):** coarse → the
  edited targets carry the `pointer-coarse:` sizing; TimeTrackingCell edit/delete render visible on
  coarse.
- **A shared test helper** for mocking `matchMedia` (coarse/fine) lives in the test files or a small
  `src/test/` helper if one already exists — reuse, don't duplicate.
- **Gates per task:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Deferred:** Playwright iPad device profiles + real touch‑drag E2E (phone follow‑up).

## 8. Disjointness from sibling Batch‑2 passes (no shared file writes)

This surface is **file‑disjoint** from the parallel Item‑Panel / Nav / Kanban / Gantt passes. The
only things shared are the **read‑only Batch‑1 primitives** in §4 (consumed, never modified). Files
written by THIS task — `BoardTable.tsx`, `ColumnHeader.tsx`, `ColumnOptionsDialog.tsx`, `cells/*`,
and their tests — are written by **no** other Batch‑2 surface. So this can run in its own
`task/touch-table` worktree fully concurrently with the other surfaces; there is no merge contention
beyond ordinary `develop` integration.

---

# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the Batch‑1 touch primitives across the board Table surface so it is finger‑usable on
iPad, with zero desktop behavior change and zero new server round‑trips.

**Architecture:** Mechanical, per‑file adoption of `useTouchAwareSensors()`, coarse‑aware reveal
(`pointer-coarse:opacity-100` for named‑scope sites / `<RevealOnHover>` for unscoped), and
`pointer-coarse:` ≥44px sizing on hand‑rolled `<button>`s. All changes gated on `(pointer: coarse)`.

**Tech Stack:** Next.js 16 / React 19 / Tailwind v4 (`pointer-coarse:` variant) / dnd‑kit 6.3 /
Vitest + jsdom.

---

### Task 1: BoardTable — migrate the three reorder sensors

**Files:**

- Modify: `src/components/boards/BoardTable.tsx` (L602–605, L1353–1356, L1824–1827; imports L28–31)
- Test: `src/components/boards/BoardTable.test.tsx`

- [ ] **Step 1 — Failing test.** In `BoardTable.test.tsx`, add a test that renders the board and
      asserts the group/item/subitem drag wiring uses the shared touch sensors. Practical assertion:
      spy/mock `useTouchAwareSensors` from `@/lib/dnd/sensors` and assert it is called (≥3×, once per
      DndContext). Run: `pnpm test BoardTable` → expect FAIL (hook not yet imported/called).
- [ ] **Step 2 — Implement.** Add `import { useTouchAwareSensors } from "@/lib/dnd/sensors";`.
      Replace each of the three `const … = useSensors(useSensor(PointerSensor, { activationConstraint:
{ distance: 6 } }));` blocks with `const sensors = useTouchAwareSensors();` (and `itemSensors`,
      `subitemSensors` respectively). Delete the three `TODO(touch-batch-2)` comments. Remove now‑unused
      `PointerSensor`, `useSensor`, `useSensors` from the dnd‑kit import (L28–31) **only if** no longer
      referenced.
- [ ] **Step 3 — Run.** `pnpm test BoardTable` → PASS. `pnpm typecheck` → no unused‑import error.
- [ ] **Step 4 — Commit.** `git add src/components/boards/BoardTable.tsx
src/components/boards/BoardTable.test.tsx` → `git commit -m "feat(boards): touch-aware reorder
sensors in board table"`.

### Task 2: BoardTable — coarse reveal + 44px sizing on the 7 handle/action affordances

**Files:**

- Modify: `src/components/boards/BoardTable.tsx` (L911, L996, L1113, L1567, L1614, L1734, L2218)
- Test: `src/components/boards/BoardTable.test.tsx`

- [ ] **Step 1 — Failing test.** With `matchMedia('(pointer: coarse)')` mocked to `true`, assert the
      group menu, row menu, add‑subitem, open‑panel buttons, and the three drag handles render with
      `pointer-coarse:opacity-100` (always visible) and `pointer-coarse:size-11` in their className (or
      assert computed visibility — class‑presence assertion is sufficient and stable). Run:
      `pnpm test BoardTable` → FAIL.
- [ ] **Step 2 — Implement.** For each of the 7 sites, append `pointer-coarse:opacity-100
pointer-coarse:size-11` to the existing className (keep the `opacity-0 … group-hover/<scope>:opacity-100`
      for mouse, keep `size-6`/`size-7` desktop base). The `GripVertical`/icon sizes stay unchanged.
      **Do not** swap to `<RevealOnHover>` here (named‑group scopes — see spec §5 design note).
- [ ] **Step 3 — Run.** `pnpm test BoardTable` → PASS. Quick manual reasoning check: desktop classes
      untouched.
- [ ] **Step 4 — Commit.** `git add src/components/boards/BoardTable.tsx
src/components/boards/BoardTable.test.tsx` → `git commit -m "feat(boards): always-visible touch
targets for board-table row actions"`.

### Task 3: ColumnHeader — touch resize hit area + visible touch menu

**Files:**

- Modify: `src/components/boards/ColumnHeader.tsx` (resize L127–133; menu trigger L92–99)
- Test: `src/components/boards/ColumnHeader.test.tsx`

- [ ] **Step 1 — Failing test.** Coarse‑pointer render: assert the resize separator has a
      ≥44px hit area class (`pointer-coarse:w-11`) and `touch-none`, and the column‑menu trigger has
      `pointer-coarse:opacity-100` + `pointer-coarse:size-11` (visible, ≥44px). Keep the existing
      rename/edit‑labels/delete tests green. Run: `pnpm test ColumnHeader` → FAIL.
- [ ] **Step 2 — Implement.** Resize separator (L132): keep the 4px visible line, add
      `touch-none pointer-coarse:w-11 pointer-coarse:-right-5` so the **hit area** is 44px centered on
      the edge on coarse pointers (move the visible 4px fill to a `before:` pseudo or a child if needed
      to keep it visually 4px). Menu trigger (L96): append `pointer-coarse:opacity-100
pointer-coarse:size-11 grid place-items-center` (keep `group-hover/col:opacity-100` for mouse).
      Resize `onPointerDown` logic is **unchanged**.
- [ ] **Step 3 — Run.** `pnpm test ColumnHeader` → PASS.
- [ ] **Step 4 — Commit.** `git add src/components/boards/ColumnHeader.tsx
src/components/boards/ColumnHeader.test.tsx` → `git commit -m "feat(boards): finger-friendly
column resize and menu in table header"`.

### Task 4: ColumnOptionsDialog — touch sensors + 44px OptionRow controls

**Files:**

- Modify: `src/components/boards/ColumnOptionsDialog.tsx` (sensors L123–126; OptionRow L288–349)
- Test: `src/components/boards/ColumnOptionsDialog.test.tsx`

- [ ] **Step 1 — Failing test.** Assert `useTouchAwareSensors` is used (spy/mock, called once), and
      on coarse pointer the OptionRow drag handle / color swatch / remove button carry
      `pointer-coarse:size-11`. Keep add/remove/usage‑confirm tests green. Run:
      `pnpm test ColumnOptionsDialog` → FAIL.
- [ ] **Step 2 — Implement.** Swap the sensor block for `const sensors = useTouchAwareSensors();`
      (delete TODO + unused dnd imports). Append `pointer-coarse:size-11` to the handle (L293), color
      swatch (L304/L320), and remove (L346) classNames.
- [ ] **Step 3 — Run.** `pnpm test ColumnOptionsDialog` → PASS. `pnpm typecheck` → clean.
- [ ] **Step 4 — Commit.** `git add src/components/boards/ColumnOptionsDialog.tsx
src/components/boards/ColumnOptionsDialog.test.tsx` → `git commit -m "feat(boards): touch-aware
option reorder and 44px controls"`.

### Task 5: Inline cell editors — coarse tap targets (high-traffic editors)

**Files:**

- Modify: `src/components/boards/cells/editors/index.tsx` (ClearButton L100, StatusEditor pills L204,
  CheckboxEditor L378–388, RatingEditor L401–413)
- Test: `src/components/boards/cells/editors/editors.test.tsx`

- [ ] **Step 1 — Failing test.** Coarse render: ClearButton, status pills, checkbox wrapper, and
      rating stars carry `pointer-coarse:` sizing (`pointer-coarse:size-11` / `pointer-coarse:h-11` /
      comfortable rating spacing). Run: `pnpm test editors` → FAIL.
- [ ] **Step 2 — Implement.** Add `pointer-coarse:` sizing to each target: ClearButton →
      `pointer-coarse:h-11`; status option pills → `pointer-coarse:min-h-11`; CheckboxEditor → wrap the
      native `size-4` input in a `pointer-coarse:size-11` tap label/area (input stays visually `size-4`);
      RatingEditor stars → `pointer-coarse:size-11` each with comfortable spacing. Desktop sizes
      unchanged.
- [ ] **Step 3 — Run.** `pnpm test editors` → PASS.
- [ ] **Step 4 — Commit.** `git add src/components/boards/cells/editors/index.tsx
src/components/boards/cells/editors/editors.test.tsx` → `git commit -m "feat(boards): 44px touch
targets for inline cell editors"`.

### Task 6: Special cells — Files / Relation / TimeTracking touch targets

**Files:**

- Modify: `src/components/boards/cells/FilesCell.tsx` (L39, L63),
  `src/components/boards/cells/RelationCell.tsx` (L114),
  `src/components/boards/cells/TimeTrackingCell.tsx` (start/stop L72, hover‑reveal L368, edit/delete
  L369–384, DatePicker L461)
- Test: `src/components/boards/cells/TimeTrackingCell.test.tsx` (extend); add coarse asserts to
  `FilesCell.test.tsx` / `RelationCell.test.tsx`

- [ ] **Step 1 — Failing test.** Coarse render: FilesCell chip/upload, RelationCell add‑chip, and
      TimeTrackingCell start/stop + DatePicker carry `pointer-coarse:` sizing; TimeTrackingCell
      edit/delete are **visible** on coarse (`pointer-coarse:opacity-100`). Run:
      `pnpm test TimeTrackingCell FilesCell RelationCell` → FAIL.
- [ ] **Step 2 — Implement.** Add `pointer-coarse:size-11` (or `pointer-coarse:h-11` for the date
      button) to each target. TimeTrackingCell hover‑reveal (L368): append `pointer-coarse:opacity-100`.
      All gated on coarse → no desktop change.
- [ ] **Step 3 — Run.** `pnpm test TimeTrackingCell FilesCell RelationCell` → PASS.
- [ ] **Step 4 — Commit.** `git add src/components/boards/cells/FilesCell.tsx
src/components/boards/cells/RelationCell.tsx src/components/boards/cells/TimeTrackingCell.tsx`
  - their tests → `git commit -m "feat(boards): touch targets for file/relation/time cells"`.

### Task 7: Full gate + finish

**Files:** none (verification + closure)

- [ ] **Step 1 — Full gates.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green.
- [ ] **Step 2 — Manual reasoning pass.** Confirm every change is `pointer-coarse:`‑gated (grep the
      diff for any unconditional sizing/opacity change → there should be none). Confirm no
      `TODO(touch-batch-2)` markers remain in the four files.
- [ ] **Step 3 — Finish.** Run `scripts/finish-task.sh` from the worktree (rebase onto `develop`,
      re‑gate, merge, push, delete branch + worktree). Hand the user the "How to test" walkthrough
      (below).

---

## Execution DAG (working‑agreement #6)

**Dependency edges (Consumes → Produces):**

- All tasks **Consume** the read‑only Batch‑1 primitives (already merged → no in‑plan dependency).
- Task 1 (BoardTable sensors) and Task 2 (BoardTable reveals/sizing) **both write `BoardTable.tsx`**
  → they must **not** run in parallel (same‑file write contention). Sequence: **1 → 2**.
- Tasks 3, 4, 5, 6 write disjoint files (`ColumnHeader.tsx`, `ColumnOptionsDialog.tsx`,
  `cells/editors/index.tsx`, special cells) → **mutually independent** and independent of 1/2.
- Task 7 (full gate + finish) **depends on all** of 1–6.

```
Batch A (parallel):   [1→2 chain]   3   4   5   6
                          │         │   │   │   │
                          └────┬────┴───┴───┴───┘
                               ▼
Batch B:                      7  (full gate + finish)
```

- **Parallel batches:** Batch A = { the 1→2 chain, 3, 4, 5, 6 } can run as up to **5 concurrent
  lanes** (the 1→2 lane runs its two tasks in series). Batch B = { 7 } after all of A.
- **Critical path (wall‑clock floor):** `Task 1 → Task 2 → Task 7` (the only two‑deep chain). Tasks
  3–6 each fit inside that window. So the floor is **3 sequential tasks**, not 7.
- **Dispatch:** because Batch A is single‑surface, single‑file‑contended only within the 1→2 lane,
  this is normally executed **in‑session** (subagent‑driven, one task at a time with review) rather
  than across separate worktrees — the whole plan lives in one `task/touch-table` worktree. If
  parallelizing 3/4/5/6 as subagents, they touch disjoint files so no extra worktrees are needed.

**Task count:** 7 (6 implementation + 1 gate/finish). **Critical path:** 3 (1→2→7).
**Size:** Medium (mechanical adoption; the only "L" file, `BoardTable.tsx`, is split across Tasks 1–2).

## How to test this (post‑merge, for the user)

1. Pull `develop`; open the app on an **iPad** (or browser DevTools device mode set to iPad +
   touch emulation) at a board's **Table** view.
2. **Reorder:** press‑and‑hold (~200ms) a row's grip → it lifts → drag to reorder. A quick swipe
   should scroll instead. Repeat for a group header and a subitem.
3. **Row/group actions:** without hovering, the row menu (⋯), open‑panel, add‑subitem, and group
   menu buttons should be **visible** and easily tappable (≥44px).
4. **Column resize:** drag the right edge of a column header with a finger — the grab zone is wide
   enough to catch; width persists on release.
5. **Column menu:** tap the column header's ⋯ (visible without hover) → Rename / Edit labels /
   Delete.
6. **Edit labels dialog:** drag an option's grip to reorder; tap color swatch / remove — all finger‑
   sized.
7. **Cells:** open a status / checkbox / rating cell editor, a files cell, a relation cell, and a
   time‑tracking cell — every tap target should be comfortable for a finger; time‑tracking
   edit/delete should be visible without hover.
8. **Desktop regression:** on a mouse/trackpad, everything looks and behaves **exactly as before**
   (hover‑reveal, slim 4px resize line, 6px‑distance drag).

## Risks & open questions

- **Named‑group scope vs `<RevealOnHover>`:** resolved by spec §5 — BoardTable uses the inline
  `pointer-coarse:opacity-100` add to preserve `group-hover/name:` scoping; `<RevealOnHover>` is left
  for unscoped sites / sibling surfaces. Verify in review this is acceptable (the alternative is
  generalizing `<RevealOnHover>` to accept a scope name — out of scope here, would modify a Batch‑1
  primitive).
- **Resize hit‑area widening** must not visually fatten the 4px line on desktop and must not overlap
  the adjacent column's content/menu. Keep the visible fill 4px; only the coarse hit area grows.
- **`BoardTable.tsx` is L (~2,302 lines)** — touch edits must not regress virtualization or
  desktop column‑resize; lean on the existing `BoardTable.test.tsx` virtualizer stubs.
- **jsdom can't play touch‑drag physics** — accepted; we assert sensor config + reveal/size classes,
  with the Playwright iPad matrix deferred to the phone follow‑up.
