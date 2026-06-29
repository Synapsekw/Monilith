# TOUCH Batch 2 — Dashboard Canvas iPad Touch-Ergonomics Pass — Spec + Plan

**Date:** 2026-06-29
**Status:** Spec written — awaiting review (do NOT build yet)
**Scope owner:** Danijel Jovanovic
**Parent spec:** [`2026-06-26-ipad-touch-optimization-design.md`](./2026-06-26-ipad-touch-optimization-design.md) — surface ⑥ (Dashboard canvas, "Low (verify)")
**Worktree / branch:** `.claude/worktrees/touch-dashboard-canvas` / `task/touch-dashboard-canvas`

> This is **both** the design spec and the implementation plan for one Batch‑2 surface (the 7th of
> 8). It is a mechanical adoption pass — the touch **foundation already shipped in Batch 1**
> (`useCoarsePointer`, `<RevealOnHover>`, `pointer-coarse:` sizing on `ui/` primitives). We only
> **consume** those primitives. No new primitives, no layout reflow, no new server round‑trips.
> `useTouchAwareSensors` is **NOT applicable** here — this surface uses `react-grid-layout`'s own
> pointer/touch handling, not dnd-kit.

---

## TL;DR — honest scope read (read this first)

The parent spec rated this surface **"Low (verify)"**, and the code audit confirms that rating: the
dashboard canvas is **mostly already touch-functional**, because `react-grid-layout` v2.2.3 drives
its drag/resize through `react-draggable` v4, which binds **both** mouse and touch events natively.
After reading the actual source + the installed package types, exactly **two** real gaps remain, and
**one footprint claim in the brief is wrong**:

1. **REAL — resize handles are invisible + too small on touch.** `react-grid-layout/css/styles.css`
   renders `.react-resizable-handle` at **20px** and `opacity: 0`, revealed **only** on
   `.react-grid-item:hover`. A finger can't hover, so on iPad the resize grips are both invisible
   **and** below the 44px minimum. This is the surface's one genuine touch blocker.
2. **REAL — the dashboard-list `⋯` menu is hover-only.** `DashboardItemMenu.tsx:102` uses
   `opacity-0 … group-hover/row:opacity-100` — invisible to a finger. (This is the per-dashboard
   menu in the **left nav rail**, used by `DashboardsNav.tsx`, not a per-widget menu.)
3. **CORRECTION to the brief — the brief said v2.2.3 "doesn't expose a native `resizeHandles`
   prop." That is wrong for the installed build.** `react-grid-layout@2.2.3` exposes a
   **`resizeConfig`** prop whose type (`dist/types-jd8MiKM1.d.ts:379`) includes
   `handles: readonly ResizeHandleAxis[]` and an optional `handleComponent`. The component already
   passes `resizeConfig={{ enabled: editing }}` (`DashboardCanvas.tsx:167`). **However**, neither
   `handles` nor `handleComponent` solves the touch problem — they control _which axis_ handles
   exist and _what element_ renders, **not** the handle's size or hover-gated visibility, which live
   entirely in the **imported stylesheet**. So a **scoped CSS override** of `.react-resizable-handle`
   (≥44px + always-visible under `@media (pointer: coarse)`) remains the correct, minimal approach.
   We document the rejected `handleComponent` alternative in §5 so a reviewer doesn't re-litigate it.

**Also confirmed NON-gaps (documented so a reviewer doesn't flag their absence):**

- **Widget DRAG already works on touch.** `react-draggable` (rgl's engine) binds `touchstart`; drag
  is gated by `dragConfig={{ enabled: editing }}` and works with a finger today. No change.
- **The per-widget header menu is already always-visible.** `DashboardWidget.tsx:96` renders its
  `DropdownMenu` (`aria-label="Widget menu"`) unconditionally while `editing` — it is **not**
  hover-gated, so it needs nothing. The brief's "DashboardItemMenu" reference is the **nav** menu
  (gap #2), a different component.

**Net: 2 small edits + 1 stylesheet override, all `(pointer: coarse)`-gated.** Size: **Small.**

---

## 1. Goal

Make the **Dashboard canvas** (`react-grid-layout` widget grid) fully usable by a finger on an iPad
(portrait 768px / landscape 1024px), with desktop (mouse/trackpad) behavior **byte-for-byte
unchanged**. Concretely:

- **Widget resize** works with a finger: the `react-resizable-handle` grip becomes **always visible**
  and **≥44px** on coarse pointers (today: 20px, hover-only → unusable on touch).
- **The dashboard-list `⋯` menu** (`DashboardItemMenu`) becomes **always visible** on coarse pointers
  instead of hover-only, by adopting the Batch‑1 `<RevealOnHover>` primitive.
- **Widget drag** (already touch-functional via `react-draggable`) is **verified**, not changed.

Touch ergonomics only: a scoped CSS override + one `RevealOnHover` adoption. No data, query, layout,
or behavior changes for mouse users.

## 2. Non‑goals

- **No layout reflow / new breakpoints.** The existing `BREAKPOINTS` / `COLS` / `rowHeight={80}` /
  `margin={[12,12]}` config in `DashboardCanvas.tsx` is retained verbatim.
- **No new server round‑trips, queries, or revalidation.** (See §6.) The debounced `persistLayout`
  mutation path is untouched.
- **No desktop behavior change.** Mouse keeps the slim 20px hover-revealed resize grip and the
  hover-only nav `⋯` menu. Every change is gated on `(pointer: coarse)` (CSS `pointer-coarse:`
  variant / a `@media (pointer: coarse)` block / the `useCoarsePointer()`-driven `<RevealOnHover>`).
- **No `useTouchAwareSensors` / dnd-kit.** This surface has no dnd-kit; `react-grid-layout` owns its
  own pointer/touch handling. Adopting the dnd-kit sensor hook here would be wrong.
- **No new widget-menu work.** The per-widget header menu is already always-visible (§3). Out of
  scope.
- **No `handleComponent` / custom resize-handle React node.** Rejected in §5 — heavier, and doesn't
  avoid the stylesheet override anyway.
- **No Playwright iPad E2E.** Deferred with the phone follow‑up (parent spec). Vitest component tests
  are mandatory here (§7).

## 3. Surfaces in scope (code‑verified inventory)

| Site                  | File / line                                              | Current state                                                                                                   | Treatment                                                                                    |
| --------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Resize handle CSS** | `react-grid-layout/css/styles.css` (imported in layout)  | `.react-resizable-handle` = `width/height: 20px; opacity: 0`; revealed only on `:hover`                         | **Scoped `@media (pointer: coarse)` override** → ≥44px + `opacity: 1` + `touch-action: none` |
| **CSS override home** | `src/app/(app)/dashboards/dashboards.touch.css` (NEW)    | n/a                                                                                                             | New tiny stylesheet, imported alongside the rgl stylesheet in `dashboards/layout.tsx`        |
| **Nav `⋯` menu**      | `src/components/dashboards/DashboardItemMenu.tsx:93–106` | `Button` trigger: `opacity-0 … group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100` | Wrap trigger in `<RevealOnHover>` (always-visible on coarse) **and** coarse-size it to ≥44px |

**Non-gaps confirmed (no edit):**

| Concern (from parent spec ⑥)             | Status in code today                                                                                       | Action |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| Widget **drag** touch-functional         | **DONE** — `react-draggable` (rgl engine) binds `touchstart`; gated by `dragConfig={{ enabled: editing }}` | verify |
| Per-**widget** header menu hover-only?   | **N/A** — `DashboardWidget.tsx:96` renders the menu unconditionally while `editing` (not hover-gated)      | none   |
| Widget rename / title button             | Plain `<button>` inside the always-visible (while editing) header; finger-reachable                        | none   |
| Edit / Add-widget / Done toolbar buttons | shadcn `Button size="sm"` — already inherits Batch‑1 `pointer-coarse:` sizing from `ui/button.tsx`         | none   |

## 4. Shared primitives consumed (read‑only — DO NOT MODIFY)

Batch‑1 outputs, verified present in this worktree:

- `src/components/ui/reveal-on-hover.tsx` → `<RevealOnHover>` — converts an
  `opacity-0 group-hover:opacity-100` block to **always-visible** under `useCoarsePointer()`. Adopted
  for the nav `⋯` menu trigger (gap #2). Drop-in replacement for the hand-rolled opacity block.
- `src/lib/hooks/use-coarse-pointer.ts` → `useCoarsePointer()` — backs `<RevealOnHover>`; we do
  **not** call it directly (the resize-handle fix is pure CSS; the menu fix uses `<RevealOnHover>`).
- **`pointer-coarse:` Tailwind variant** — already active (shipped in `ui/button.tsx`; tested in
  `ui/button.touch.test.tsx`). Used inline to grow the nav `⋯` trigger to ≥44px on coarse.
- **NOT used:** `src/lib/dnd/sensors.ts` (`useTouchAwareSensors`) and `src/components/ui/drag-handle.tsx`
  (`<DragHandle>`) — there is no dnd-kit on this surface (§2). Documented here so their absence isn't
  flagged.

## 5. Design — how each surface is treated, and the resize-handle decision

### 5.1 Resize handle — the central decision (scoped CSS override)

**The problem lives in the imported stylesheet, not in props.** `dashboards/layout.tsx` does
`import "react-grid-layout/css/styles.css"`, which ships:

```css
.react-grid-item > .react-resizable-handle {
  position: absolute;
  width: 20px;
  height: 20px;
  opacity: 0;
}
.react-grid-item:hover > .react-resizable-handle {
  opacity: 1;
}
```

Three options were evaluated:

- **(A) `resizeConfig.handleComponent` — REJECTED.** v2.2.3 _does_ expose
  `resizeConfig={{ enabled, handles, handleComponent }}` (verified in `dist/types-jd8MiKM1.d.ts:379`),
  so we _could_ render a custom 44px handle React node. But: (i) the default handle's **20px +
  hover-gating still comes from the stylesheet**, so a custom node that doesn't also override the CSS
  inherits `opacity:0`; (ii) `handleComponent` requires correctly forwarding the library's `ref` and
  re-implementing the SE-corner positioning to match desktop — more code, more risk, for a worse diff;
  (iii) it would change desktop rendering unless _also_ `pointer-coarse:`-gated, which a React node
  can't express as cleanly as a media query. Heavier and doesn't avoid the CSS override. Rejected.
- **(B) `resizeConfig.handles` axis change — N/A.** `handles` picks _which corners/edges_ show a
  handle (default `['se']`); it does nothing for size or hover-visibility. Not a fix.
- **(C) Scoped CSS override under `@media (pointer: coarse)` — CHOSEN.** A tiny stylesheet, imported
  right after the rgl stylesheet so it wins by source order at equal specificity, overrides **only**
  under a coarse pointer:

  ```css
  /* src/app/(app)/dashboards/dashboards.touch.css */
  @media (pointer: coarse) {
    .react-grid-item > .react-resizable-handle {
      width: 44px;
      height: 44px;
      opacity: 1; /* finger can't hover → always visible */
      touch-action: none; /* a resize drag must not scroll the page */
    }
    /* keep the visual chevron glyph anchored to the true corner while the hit area grows */
    .react-grid-item > .react-resizable-handle::after {
      right: 6px;
      bottom: 6px;
    }
  }
  ```

  **Why this is desktop-safe:** the entire override is inside `@media (pointer: coarse)`, which is
  **inert on a mouse/trackpad** (a fine pointer never matches), so desktop keeps the exact 20px
  hover-revealed grip. The selector matches the library's own specificity
  (`.react-grid-item > .react-resizable-handle`), and importing our file **after** the vendor
  stylesheet makes the coarse rules win without `!important`. Only the `se` handle is shown by default
  (rgl default `handles: ['se']`), so we grow exactly one grip per widget — no overlap.

  **Pulse-UI note:** this is chrome/affordance sizing, not color — no tokens involved; we touch only
  geometry/visibility. The `::after` chevron keeps the existing monochrome look. No brand color, no
  status color (consistent with the pulse-ui "chrome is monochrome" rule).

### 5.2 Nav `⋯` menu — adopt `<RevealOnHover>` + coarse-size

`DashboardItemMenu.tsx` currently renders:

```tsx
<DropdownMenuTrigger asChild>
  <Button … size="icon-xs"
    className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100">
    <MoreHorizontal className="size-4" />
  </Button>
</DropdownMenuTrigger>
```

Replace the hand-rolled opacity block with the Batch‑1 primitive. `<RevealOnHover>` renders a wrapper
`<div>` that is `opacity-100` on coarse and `opacity-0 group-hover:opacity-100 focus-within:opacity-100`
on fine — exactly the desktop behavior we want to preserve. Wrap the trigger:

```tsx
<RevealOnHover className="shrink-0">
  <DropdownMenuTrigger asChild>
    <Button … size="icon-xs"
      className="text-muted-foreground hover:text-foreground pointer-coarse:size-11">
      <MoreHorizontal className="size-4" />
    </Button>
  </DropdownMenuTrigger>
</RevealOnHover>
```

Notes:

- The opacity utilities (`opacity-0 … group-hover/row:opacity-100 focus-visible:opacity-100
aria-expanded:opacity-100`) move **off** the Button and are subsumed by `<RevealOnHover>`'s own
  `focus-within:opacity-100`. The wrapper sits inside the `group/row` ancestor in `DashboardsNav.tsx:247`,
  so the hover variant still resolves on desktop. (`RevealOnHover` uses the unnamed `group-hover:`; the
  row group is named `group/row`. `group-hover:` matches the **nearest** group ancestor regardless of
  name, so hover-reveal still works — verified against the Tailwind v4 group-variant semantics already
  relied on by the other Batch‑2 surfaces.)
- `pointer-coarse:size-11` (44px) gives the trigger a finger target on coarse; `size-icon-xs` is kept
  as the fine-pointer base, so **desktop is unchanged**.
- The `aria-expanded:opacity-100` behavior (keep visible while the menu is open) is preserved on
  desktop by `<RevealOnHover>`'s `focus-within` (the open menu keeps focus within the wrapper);
  acceptable per the sibling surfaces' precedent. If review wants the exact `aria-expanded` keep-open,
  add `[&:has([data-state=open])]:opacity-100` to the `RevealOnHover` className — noted as an optional
  refinement, not required.

### 5.3 Widget drag — verify only

No edit. `react-draggable` binds `touchstart`; the widget body is the long-press-free drag surface
(rgl uses a small move threshold, `dragConfig.threshold` default 3px, to distinguish tap from drag).
Drag is gated by `dragConfig={{ enabled: editing }}` — already correct. We assert in §7 that the
config is wired (regression guard), and verify the gesture manually on iPad (§ How to test).

## 6. Data‑fetching & performance budget (working‑agreement #5)

- **(a) First paint vs. interaction:** First paint is **unchanged** — same RSC dashboard payload
  (`useDashboardCache(dashboardId, initialData)`), same hydration. Every change in this pass is a
  client-side presentation concern (a CSS media-query block + one `<RevealOnHover>` wrapper + a
  `pointer-coarse:` class). Each touch interaction (resize grip, reveal menu, widget drag) is **0 new
  server round‑trips**.
- **(b) Does the interaction change server data?** Only the **existing** mutation does: a
  drag/resize commits the new rect via the **already-debounced** `persistLayout.mutate(rects)` path
  (`DashboardCanvas.tsx:83–95`), which `onMutate`-patches the cache (no refetch) and persists 600ms
  after the last gesture. We change _how the gesture is initiated_ (finger vs. mouse) and _the size of
  the grip_, never _what it commits or how often_. No new Server Actions, no new revalidation.
- **(c) Bounded over indexed columns?** Untouched. This pass adds no query and no read.

**Net:** first‑paint and per‑interaction server cost is **identical to today**.

## 7. Testing (working‑agreement #4 — written & executed)

jsdom can't simulate touch-drag physics or evaluate `@media (pointer: coarse)`, so — per the parent
spec and the sibling Kanban/Gantt specs — we assert **markup/config + the presence of the override
stylesheet**, not gesture playback or computed layout. Two test files:

**A. `src/components/dashboards/DashboardItemMenu.test.tsx`** (extend the existing suite):

1. **Trigger is coarse-sized.** Render `<DashboardItemMenu>`; query the trigger
   (`screen.getByRole("button", { name: /dashboard actions/i })`); assert `className` contains
   `pointer-coarse:size-11`. Pins the ≥44px coarse target.
2. **Trigger is wrapped for always-visible-on-coarse.** Assert the trigger's wrapper carries the
   `RevealOnHover` data attribute (`data-slot="reveal-on-hover"`) — i.e.
   `trigger.closest('[data-slot="reveal-on-hover"]')` is non-null. Proves the hand-rolled
   `opacity-0 group-hover` block was replaced by the Batch‑1 primitive (which renders
   `opacity-100` on coarse).
3. **Regression guards (existing tests stay green):** the three existing cases — menu shows
   Rename/Duplicate/Delete, Duplicate calls `duplicateDashboard`, Delete confirms then calls
   `deleteDashboard` — must still pass unchanged (proves we didn't break the dropdown wiring).

**B. `src/components/dashboards/DashboardCanvas.test.tsx`** (NEW — no canvas test exists today;
mirror the colocated `DashboardWidget.test.tsx` mock setup):

4. **Resize + drag are gated on `editing` (regression / behavior guard).** Render `<DashboardCanvas>`
   with `editing` off by default and at least one widget; assert the grid renders. Toggle to edit
   (click the "Edit" button) and assert the rgl container is present. This guards that we did **not**
   disturb the `dragConfig`/`resizeConfig={{ enabled: editing }}` wiring. (We assert the rendered
   structure, not rgl internals — mock the four widget leaf components and the
   `use-dashboard-cache`/`use-dashboard-mutations` hooks as `DashboardWidget.test.tsx` already does.)
5. **The coarse override stylesheet is wired.** A lightweight assertion that the dashboards layout
   imports the new touch stylesheet, so the override can't silently drop out of the bundle. Implement
   as a source-level check: read `src/app/(app)/dashboards/dashboards.touch.css` exists and contains
   `@media (pointer: coarse)` + `.react-resizable-handle` + `width: 44px`, **and** that
   `dashboards/layout.tsx` source contains the import string `dashboards.touch.css`. (Plain
   `fs.readFileSync` in the test — jsdom can't evaluate the media query, so we assert the rule text
   is present and imported, which is the meaningful, non-flaky guarantee.)

- **Desktop‑regression safety:** because every change is inside `@media (pointer: coarse)` or a
  `pointer-coarse:` variant or `<RevealOnHover>`'s coarse branch, the existing
  `DashboardItemMenu.test.tsx` cases (which run under jsdom's default fine pointer) prove the desktop
  path is untouched.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Deferred:** Playwright iPad device profiles + real touch resize/drag E2E (phone follow‑up).

## 8. Disjointness from sibling Batch‑2 passes (no shared file writes)

This surface writes:

- `src/components/dashboards/DashboardItemMenu.tsx` (+ its test)
- `src/app/(app)/dashboards/dashboards.touch.css` (NEW) and `src/app/(app)/dashboards/layout.tsx`
  (one import line)
- `src/components/dashboards/DashboardCanvas.test.tsx` (NEW)

No other Batch‑2 surface (Table, Kanban, Gantt, Item‑Panel, Nav, Calendar) writes any of these files.
The only shared code is the **read‑only Batch‑1 primitive** `<RevealOnHover>` (§4, consumed, never
modified). It is therefore **file‑disjoint** from the remaining sibling pass (Calendar) and every
already-shipped surface, and runs fully concurrently in its own `task/touch-dashboard-canvas` worktree
with no merge contention beyond ordinary `develop` integration.

> **Nav-surface overlap note:** `DashboardItemMenu` is rendered by `DashboardsNav.tsx`, which already
> had a Batch‑2 Nav pass (it uses `useCoarsePointer` + `pointer-coarse:` sizing on the rail items).
> That pass **did not** migrate the per-row `⋯` trigger inside `DashboardItemMenu` — this spec closes
> that remaining hover-only gap. We edit `DashboardItemMenu.tsx` only; `DashboardsNav.tsx` is **not**
> touched, so there's no contention with the (already-merged) Nav work.

---

# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Load `pulse-ui` + `frontend-design` before editing UI.

**Goal:** Make the dashboard widget grid finger-usable on iPad — resize grips always-visible & ≥44px
on coarse pointers, and the dashboard-list `⋯` menu always-visible on coarse — with zero desktop
behavior change and zero new server round‑trips.

**Architecture:** (1) A scoped `@media (pointer: coarse)` CSS override of `.react-resizable-handle`,
imported after the vendor `react-grid-layout` stylesheet. (2) Adopt the Batch‑1 `<RevealOnHover>`
primitive + a `pointer-coarse:size-11` class on the `DashboardItemMenu` trigger. All changes gated on
`(pointer: coarse)`. No dnd-kit, no new primitives, no layout reflow.

**Tech Stack:** Next.js 16 (App Router) / React 19 / Tailwind v4 (`pointer-coarse:` variant) /
react-grid-layout 2.2.3 / Vitest + jsdom.

---

### Task 1: Coarse-pointer CSS override for react-grid-layout resize handles

**Files:**

- Create: `src/app/(app)/dashboards/dashboards.touch.css`
- Modify: `src/app/(app)/dashboards/layout.tsx` (add one import after the vendor stylesheet import)
- Test: `src/components/dashboards/DashboardCanvas.test.tsx` (created in Task 3; the stylesheet
  presence assertion lands there — this task creates the file the test reads)

- [ ] **Step 1: Create the override stylesheet.** Write `src/app/(app)/dashboards/dashboards.touch.css`:

```css
/* Touch (Batch 2, surface ⑥): make react-grid-layout's resize grip finger-usable.
 * Scoped to (pointer: coarse) so desktop (fine pointer) keeps the slim 20px hover grip.
 * Imported AFTER react-grid-layout/css/styles.css so these rules win at equal specificity. */
@media (pointer: coarse) {
  .react-grid-item > .react-resizable-handle {
    width: 44px;
    height: 44px;
    opacity: 1; /* a finger can't hover — keep the grip always visible */
    touch-action: none; /* a resize drag must not scroll the page */
  }
  /* keep the chevron glyph anchored near the true corner while the hit area grows */
  .react-grid-item > .react-resizable-handle::after {
    right: 6px;
    bottom: 6px;
  }
}
```

- [ ] **Step 2: Import it after the vendor stylesheet.** In
      `src/app/(app)/dashboards/layout.tsx`, add the import immediately below the existing
      `import "react-grid-layout/css/styles.css";` line:

```tsx
import "react-grid-layout/css/styles.css";
import "./dashboards.touch.css";
```

(Source order matters: the local override must come **after** the vendor CSS so the coarse rules win
without `!important`.)

- [ ] **Step 3: Typecheck + build to confirm the CSS import resolves.**

Run: `pnpm typecheck && pnpm build`
Expected: both pass (the new CSS import is picked up by the dashboards route bundle; no type error).

- [ ] **Step 4: Commit (stage by path only).**

```bash
git add src/app/\(app\)/dashboards/dashboards.touch.css src/app/\(app\)/dashboards/layout.tsx
git commit -m "feat(dashboards): finger-sized always-visible resize grips on coarse pointers

Changelog: improved | Dashboard widget resize on touch | Resize grips are now visible and finger-sized on iPad"
```

---

### Task 2: Adopt `<RevealOnHover>` + coarse-size the dashboard `⋯` menu trigger

**Files:**

- Modify: `src/components/dashboards/DashboardItemMenu.tsx` (trigger block, lines ~95–106)
- Test: `src/components/dashboards/DashboardItemMenu.test.tsx` (extend existing suite)

- [ ] **Step 1: Write the failing tests.** Add to `DashboardItemMenu.test.tsx`, inside the existing
      `describe("DashboardItemMenu", …)` block:

```tsx
it("gives the actions trigger a coarse-pointer touch target (>=44px)", () => {
  render(
    <DashboardItemMenu
      dashboard={{ id: "d1", name: "Ops" }}
      isActive={false}
    />,
  );
  const trigger = screen.getByRole("button", { name: /dashboard actions/i });
  expect(trigger.className).toContain("pointer-coarse:size-11");
});

it("wraps the actions trigger in RevealOnHover (always-visible on coarse)", () => {
  render(
    <DashboardItemMenu
      dashboard={{ id: "d1", name: "Ops" }}
      isActive={false}
    />,
  );
  const trigger = screen.getByRole("button", { name: /dashboard actions/i });
  expect(trigger.closest('[data-slot="reveal-on-hover"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run the new tests to confirm they fail.**

Run: `pnpm test -- src/components/dashboards/DashboardItemMenu.test.tsx`
Expected: FAIL — `pointer-coarse:size-11` not present and no `reveal-on-hover` wrapper yet; the three
pre-existing tests still PASS.

- [ ] **Step 3: Add the import.** At the top of `DashboardItemMenu.tsx`, add:

```tsx
import { RevealOnHover } from "@/components/ui/reveal-on-hover";
```

- [ ] **Step 4: Wrap the trigger + move the opacity utilities onto the wrapper, add coarse size.**
      Replace the existing trigger block:

```tsx
<DropdownMenuTrigger asChild>
  <Button
    type="button"
    variant="ghost"
    size="icon-xs"
    aria-label="Dashboard actions"
    className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
  >
    <MoreHorizontal className="size-4" />
  </Button>
</DropdownMenuTrigger>
```

with:

```tsx
<RevealOnHover className="shrink-0 [&:has([data-state=open])]:opacity-100">
  <DropdownMenuTrigger asChild>
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label="Dashboard actions"
      className="text-muted-foreground hover:text-foreground pointer-coarse:size-11"
    >
      <MoreHorizontal className="size-4" />
    </Button>
  </DropdownMenuTrigger>
</RevealOnHover>
```

(`<RevealOnHover>` supplies `opacity-0 transition-opacity group-hover:opacity-100
focus-within:opacity-100` on fine pointers and `opacity-100` on coarse. The
`[&:has([data-state=open])]:opacity-100` preserves the old `aria-expanded:opacity-100` keep-open
behavior on desktop. `pointer-coarse:size-11` grows the trigger to 44px on coarse; `size-icon-xs`
stays the fine-pointer base → desktop unchanged.)

- [ ] **Step 5: Run the full test file to confirm green.**

Run: `pnpm test -- src/components/dashboards/DashboardItemMenu.test.tsx`
Expected: PASS — both new tests pass; the three pre-existing tests still pass.

- [ ] **Step 6: Commit (stage by path only).**

```bash
git add src/components/dashboards/DashboardItemMenu.tsx src/components/dashboards/DashboardItemMenu.test.tsx
git commit -m "feat(dashboards): always-visible finger-sized dashboard actions menu on touch

Changelog: improved | Dashboard menu on touch | The per-dashboard actions menu is always visible and finger-sized on iPad"
```

---

### Task 3: Canvas regression test + stylesheet-wiring guard, then full gate

**Files:**

- Create: `src/components/dashboards/DashboardCanvas.test.tsx`
- Test: (this task IS the test) + final gate

- [ ] **Step 1: Write the canvas test.** Create `src/components/dashboards/DashboardCanvas.test.tsx`,
      mirroring the mock setup in the colocated `DashboardWidget.test.tsx` (mock
      `@/lib/dashboards/use-dashboard-cache`, `@/lib/dashboards/use-dashboard-mutations`, and the
      widget leaf components so the grid renders without real data/network). Read
      `DashboardWidget.test.tsx` first and copy its mock shape exactly to avoid drift. The test asserts:

  1. The canvas renders an "Edit" toggle button and (with ≥1 widget) the grid container.
  2. Clicking "Edit" flips the toggle to "Done" (guards the `editing` state that gates
     `dragConfig`/`resizeConfig`).
  3. **Stylesheet wiring (source-level, fs-based):** `dashboards.touch.css` exists and its contents
     include `@media (pointer: coarse)`, `.react-resizable-handle`, and `width: 44px`; and
     `layout.tsx` source contains the import `./dashboards.touch.css`. Example:

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("ships the coarse-pointer resize-handle override and imports it in the layout", () => {
  const css = readFileSync(
    join(process.cwd(), "src/app/(app)/dashboards/dashboards.touch.css"),
    "utf8",
  );
  expect(css).toContain("@media (pointer: coarse)");
  expect(css).toContain(".react-resizable-handle");
  expect(css).toContain("width: 44px");

  const layout = readFileSync(
    join(process.cwd(), "src/app/(app)/dashboards/layout.tsx"),
    "utf8",
  );
  expect(layout).toContain("./dashboards.touch.css");
});
```

(If `process.cwd()` resolves to a worktree root, the relative paths above are correct; adjust only
if the test runner's cwd differs — verify by running the test.)

- [ ] **Step 2: Run the canvas test to confirm it passes** (the CSS + import exist from Task 1; the
      render assertions exercise the existing component).

Run: `pnpm test -- src/components/dashboards/DashboardCanvas.test.tsx`
Expected: PASS. If a render assertion fails due to a missing mock, fix the mock to match
`DashboardWidget.test.tsx` (do not change the component).

- [ ] **Step 3: Run the full gate.**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four pass. (Treat any `*.integration.test.ts` remote-DB flake per the standing
orchestrator note; the unit suite is the real gate.)

- [ ] **Step 4: Reasoning pass.** `git diff` the branch: confirm every size/visibility change is
      `@media (pointer: coarse)`-scoped, a `pointer-coarse:` variant, or inside `<RevealOnHover>`'s
      coarse branch; confirm `DashboardCanvas.tsx`, `DashboardWidget.tsx`, and `DashboardsNav.tsx`
      were **not** modified (the brief's footprint is fully covered without touching them).

- [ ] **Step 5: Commit (stage by path only).**

```bash
git add src/components/dashboards/DashboardCanvas.test.tsx
git commit -m "test(dashboards): canvas edit-toggle regression + touch override wiring guard"
```

- [ ] **Step 6: STOP / hand off.** If running as an orchestrated subagent, hand the orchestrator the
      gate evidence + "How to test"; do **not** run `finish-task.sh`. If running standalone, run
      `scripts/finish-task.sh` from inside the worktree to merge to `develop`.

---

## Execution DAG (working‑agreement #6)

**Dependency edges (Consumes → Produces):**

- **Task 1** (CSS override + layout import) — Consumes: nothing in-plan (read-only Batch‑1 +
  installed rgl). Produces: `dashboards.touch.css`, the layout import.
- **Task 2** (`RevealOnHover` adoption + coarse size on `DashboardItemMenu`) — Consumes: read-only
  `<RevealOnHover>` (already merged). Produces: the migrated trigger. **Independent of Task 1** (no
  shared file: different files entirely).
- **Task 3** (canvas test + stylesheet-wiring guard + full gate) — Consumes: Task 1's
  `dashboards.touch.css` + layout import (the wiring test reads them). Depends on Task 1. Does **not**
  depend on Task 2 (different file), but the **full gate** in Step 3 naturally runs against both
  merged, so Task 3 is scheduled last.

```
Task 1 ─┐
        ├─→ Task 3 (gate)
Task 2 ─┘
```

- **Dependency graph:** Task 3 depends on Task 1 (stylesheet-wiring assertion). Task 2 is independent
  of Task 1. Task 3's gate covers all three.
- **Parallel batches:** **Batch A = {Task 1, Task 2}** (file-disjoint — `dashboards.touch.css` +
  `layout.tsx` vs. `DashboardItemMenu.tsx`; can run as two concurrent agents). **Batch B = {Task 3}**
  (after A).
- **Critical path (wall-clock floor):** `Task 1 → Task 3` (Task 2 overlaps Task 1). 2 sequential
  hops.
- **Dispatch:** Small surface. If parallelized, Tasks 1 & 2 are concurrent subagents (disjoint files),
  then Task 3. In practice this is small enough to also run in-session as a 1→2→3 TDD chain; the
  parallel option exists but isn't required. The whole surface is **one lane** in the parent Batch‑2
  DAG (light lane), concurrent with the remaining Calendar surface and the already-shipped
  Table/Kanban/Gantt/Item-Panel/Nav.

**Task count:** 3. **Critical path:** 2. **Size:** Small.

---

## Self-review (spec + plan)

- **Spec coverage:** parent spec ⑥'s three asks — (a) confirm widget drag touch-sized → verified
  NON-gap (§3, §5.3); (b) confirm resize handles touch-sized → Task 1 (the one real fix); (c) ensure
  edit-layout affordances aren't hover-only → Task 2 (nav `⋯` menu) + verified NON-gap for the
  per-widget header menu (§3). No silent gaps.
- **Brief reconciliation:** the brief's "v2.2.3 doesn't expose `resizeHandles`" claim is **corrected**
  (it exposes `resizeConfig.handles`/`handleComponent`), and the brief's suggested CSS-override
  approach is **confirmed** as still correct after evaluating and rejecting `handleComponent` (§5.1).
  The brief's "DashboardItemMenu" is correctly identified as the **nav** menu, not a widget menu.
- **Placeholders:** none — every step has concrete file contents, class strings, commands, and
  expected output.
- **Type/name consistency:** `RevealOnHover`, `data-slot="reveal-on-hover"`, `useCoarsePointer`,
  `pointer-coarse:size-11`, `react-resizable-handle`, `resizeConfig`, `dragConfig`,
  `aria-label="Dashboard actions"`, `aria-label="Widget menu"`, `persistLayout`, the `(app)/dashboards`
  paths — all match the verified source and existing test fixtures.
- **Scope:** Small — 2 source edits + 1 new CSS file + 2 test files; honest "Low (verify)" rating
  upheld, with the one genuine blocker (resize-handle CSS) surfaced front and center.

## How to test this (post‑merge, for the user)

1. Pull `develop`; open the app on an **iPad** (or Chrome DevTools device mode set to iPad + touch
   emulation) and go to **Dashboards** → open any dashboard with at least one widget.
2. **Resize a widget (the core fix):** tap **Edit**, then look at a widget's **bottom-right corner** —
   a resize grip should now be **visible** (it's invisible/hover-only on desktop). Drag it with a
   finger to resize the widget; release and the new size should persist (reload to confirm). A resize
   drag should **not** scroll the page.
3. **Drag a widget:** in Edit mode, press a widget's header/body and drag it to a new grid cell — it
   should move and snap. (This already worked on touch; confirm it still does.)
4. **Dashboard `⋯` menu (left rail):** without hovering, each dashboard row's `⋯` actions menu in the
   left navigation should be **visible** and comfortably tappable (≥44px) — tap it to Rename /
   Duplicate / Delete.
5. **Tap Done** to leave edit mode; the resize grips disappear (drag/resize disabled), as before.
6. **Desktop regression (mouse/trackpad):** everything looks and behaves **exactly as before** — the
   resize grip is the slim 20px grip that only appears on widget hover, and the dashboard `⋯` menu is
   hidden until you hover the row. No reflow, identical spacing.

## Risks & open questions

- **CSS source-order assumption.** The override relies on `dashboards.touch.css` being imported
  **after** `react-grid-layout/css/styles.css` so equal-specificity coarse rules win without
  `!important`. If Turbopack/Next reorders CSS imports in the production bundle, the override could
  lose. **Mitigation in the plan:** both imports live in the same `layout.tsx` in deterministic order;
  if review/manual-test shows it losing, the fallback is a single `!important` on the four coarse
  properties (still coarse-scoped → desktop-safe). **Open question for the human:** acceptable to fall
  back to `!important` (coarse-only) if bundling reorders, or prefer a higher-specificity selector
  (e.g. prefixing `.react-grid-layout`)? Recommendation: higher-specificity selector first,
  `!important` only if that also fails.
- **`RevealOnHover` + named row group.** `RevealOnHover` uses the unnamed `group-hover:`; the row in
  `DashboardsNav.tsx` is `group/row`. `group-hover:` matches the nearest group ancestor regardless of
  its name, so desktop hover-reveal is preserved — but this should be **eyeballed on desktop** in
  review (it's the one behavioral nuance). If it ever regresses, the alternative is to keep the
  hand-rolled `group-hover/row:` block and only add `pointer-coarse:opacity-100 pointer-coarse:size-11`
  inline (the Gantt-menu approach), skipping `RevealOnHover`. Recommendation: prefer `RevealOnHover`
  (matches the brief's explicit ask to adopt the primitive); fall back inline only if hover-reveal
  visibly breaks.
- **44px grip on small widgets.** A 44px coarse grip on a 1×1 (≈80px tall) widget covers a meaningful
  corner fraction. Acceptable — resize > content-tap at the very corner is the intended affordance, and
  it's coarse-only. Flag for visual review on the smallest widget size.
- **jsdom can't evaluate `@media (pointer: coarse)`** — accepted; we assert the rule **text** is
  present and imported (source-level guard), with the Playwright iPad matrix deferred to the phone
  follow‑up.
