# TOUCH Batch 2 — Navigation / Sidebar iPad Touch Pass + gotcha-47 a11y Label Fix — Design Spec

**Date:** 2026-06-29
**Status:** Spec written — awaiting review (not yet implemented)
**Scope owner:** Danijel Jovanovic
**Parent spec:** `docs/superpowers/specs/2026-06-26-ipad-touch-optimization-design.md` (Batch 2, surface ①: Nav / App shell)
**Fixes ADR:** `vault/decisions/2026-06-28-gotcha-47-coarse-tooltip-suppresses-focus-label.md`

## Goal

Make the sidebar / shell navigation fully usable and accessible under a finger on iPad, and
**close the gotcha-47 a11y regression**: on a coarse pointer the shared `Tooltip` is forced
`open=false` (correct — touch has no hover and a long-press tooltip would fight the drag lift),
but Radix can't distinguish hover from keyboard-focus, so this also suppresses the **focus**
tooltip. The icon-only **collapsed** sidebar uses the tooltip AS its only visible label — so on
touch (and for an iPad-with-keyboard user tabbing the rail) those nav items have **no visible
label at all**. Batch 2 must render a visible/explicit label when `coarse && collapsed`.

This is a **touch-ergonomics + a11y** pass on existing chrome, NOT a layout-reflow effort and
NOT a redesign. The label fix is **presentation** (render visible text when `coarse && collapsed`),
not a control-flow restructure. No new narrow-screen layouts; the `md:` sidebar already shows at
iPad widths.

## Non-goals (out of scope)

- **Modifying the shared foundation primitives.** `useCoarsePointer()`, `tooltip.tsx` /
  `tooltip-open.ts`, `useTouchAwareSensors()`, `RevealOnHover` already exist and are
  JSDoc-documented. We **adopt them read-only** — no edits to those files. (The gotcha-47 ADR is
  explicit that fixing this per-surface, where the visible label belongs in the layout, is cleaner
  than special-casing Radix focus-vs-hover in the shared primitive.)
- **The expanded sidebar.** When expanded (`w-60`) every nav item already shows a text label
  alongside its icon — no regression there. The fix is scoped to the **collapsed** (`w-14`) rail.
- **Layout reflow / new breakpoints.** No phone surfaces, no width changes to the rail, no
  restructure of the expand/collapse mechanics beyond touch-sizing the toggle.
- **The other Batch-2 surfaces** (Table, Kanban, Gantt, Calendar, Dashboard, Item Panel,
  Command-palette/menus). This surface is **disjoint** from those (see "Disjointness" below).
- **Playwright iPad E2E.** Deferred with the phone follow-up per the parent spec. Vitest component
  tests are mandatory here.

## Current state (code-verified in the `touch-nav` worktree)

Five in-scope files (size **M**, ~960 LOC total). The shared primitives already exist; only the
consumers below need touching.

| File                                          | Collapsed (`w-14`) icon-only items that rely on a tooltip-only label                                                                          | Other touch work                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/shell/sidebar-nav.tsx`        | `Goals`, `Portfolios`, `Workload`, `My Time` (`<Link>`), `Inbox` (disabled `<button>`) — each `size-9` icon, label only in `<TooltipContent>` | none beyond label                                                                                                              |
| `src/components/boards/BoardsNav.tsx`         | `Boards` header icon (`FolderKanban`, label-in-tooltip); per-board initial-letter tiles + "shared with me" tiles (`<TooltipContent>{b.name}`) | **board-reorder sensor**: `TODO(touch-batch-2)` at ~line 128 — migrate from inline `PointerSensor` to `useTouchAwareSensors()` |
| `src/components/dashboards/DashboardsNav.tsx` | `Dashboards` header icon (`LayoutGrid`); per-dashboard initial-letter tiles (`<TooltipContent>{d.name}`)                                      | none beyond label                                                                                                              |
| `src/components/platform/PlatformNav.tsx`     | admin links `Overview / Organizations / Users / Audit log / Feedback` — `size-9` icons, label only in tooltip                                 | none beyond label                                                                                                              |
| `src/components/sidebar.tsx`                  | collapse/expand toggle (`size-8` ghost button) carries an `aria-label` + a "(⌘\\)" tooltip (functional control, not its only label)           | touch-size the toggle ≥44px hit area                                                                                           |

**Important — collapsed-rail constraint:** the collapsed rail is `w-14` (56px). Each item is
`size-9` (36px). A visible text label cannot sit _inline beside_ the icon without overflowing /
reflowing the rail (forbidden). The visible label on touch must therefore be rendered in a way
that does **not** widen the rail — see "Design direction" for the chosen mechanism.

**Shared primitives (ADOPT read-only — do not modify):**

- `src/lib/hooks/use-coarse-pointer.ts` — `useCoarsePointer()`, `useSyncExternalStore` over
  `matchMedia('(pointer: coarse)')`, SSR-safe `false` default.
- `src/components/ui/tooltip.tsx` + `tooltip-open.ts` — the enforcement point; `resolveTooltipOpen`
  forces `open=false` on coarse. JSDoc already names this owed work.
- `src/lib/dnd/sensors.ts` — `useTouchAwareSensors()` (PointerSensor 6px + TouchSensor
  200ms/8px long-press) for the BoardsNav reorder.
- `src/components/ui/reveal-on-hover.tsx` — `RevealOnHover` (available if any nav hover-action
  needs it; the per-board/-dashboard row menus on the expanded list use `group/row` hover today —
  out of scope unless an item-menu in scope is hover-only; verify, don't expand scope).

**Existing tests (every in-scope file already has one):** `sidebar.test.tsx`,
`shell/sidebar-nav.test.tsx`, `boards/BoardsNav.test.tsx`, `dashboards/DashboardsNav.test.tsx`,
`platform/PlatformNav.test.tsx`. The established coarse-pointer test pattern is
`vi.mock("@/lib/hooks/use-coarse-pointer", () => ({ useCoarsePointer: vi.fn() }))` then
`vi.mocked(useCoarsePointer).mockReturnValue(true|false)` per case (see
`reveal-on-hover.test.tsx`). Reuse this verbatim — new tests extend these files in place.

## Design direction (pulse-ui + a11y)

Chrome stays monochrome; no color earned here. The label fix is the heart of the work.

**The visible-label mechanism (chosen):** when `coarse && collapsed`, render the item's label as a
**visible text element that does not widen the `w-14` rail** — a small caption rendered _under_ the
icon inside the existing `size-9`→column item (stacking icon + tiny truncated label vertically in a
flex-col), using `text-[10px]/`tight, `text-muted-foreground`, `truncate`, `max-w-full`, centered.
This keeps the rail width fixed (no reflow), gives a finger/keyboard user a real on-screen label,
and degrades to the unchanged icon-only render on a fine pointer. The Radix tooltip stays mounted
(it still serves fine-pointer hover), but is no longer the _only_ label on touch.

- For the **letter-tile** items (board / dashboard / shared-board initials) the tile already shows a
  letter; the visible label adds the **full name** as the caption beneath, so a touch user sees
  e.g. `M` + "Marketing" rather than an unexplained `M`.
- The label text MUST be the same string already in the `aria-label` / `<TooltipContent>` — single
  source, no drift. Keep the existing `aria-label` (it's still the accessible name and is read by
  AT regardless of pointer).
- AA: caption uses `text-muted-foreground` on `bg-sidebar`; verify contrast ≥ 4.5:1 (it is the
  same token pairing already used for collapsed section captions). Active items keep their
  `bg-primary/80 text-foreground` treatment.
- Active state: `aria-current="page"` is unchanged.

**Touch-target sizing.** Collapsed items are `size-9` (36px) today — under the Apple HIG 44px
minimum. The parent spec's foundation added a coarse-pointer `≥44px` layer on `ui/` primitives, but
these nav links/buttons are bespoke (`<Link>`/`<button>` with `flex size-9 …`), not `ui/Button`, so
they don't inherit it. Each in-scope collapsed item and the `sidebar.tsx` collapse toggle must reach
a **≥44px hit area on coarse pointer** — applied as a coarse-conditional class (e.g. taller min-height
on the item / `min-h-11 min-w-11`), without changing fine-pointer (desktop) size. Stacking the icon +
caption naturally increases the item's height toward 44px; confirm and top up where needed.

**BoardsNav reorder sensor.** Replace the inline
`useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))` with
`useTouchAwareSensors()` and delete the `TODO(touch-batch-2)` comment. This makes board-reorder a
200ms long-press lift on touch (quick swipe scrolls the list) while keeping the 6px mouse behavior.
Note: reorder is only rendered in the **expanded** list (the collapsed rail shows static letter
tiles, no DndContext), so this is independent of the collapsed-label work and can land in parallel.

## Data-fetching & performance budget (working-agreement #5)

- **(a) First paint vs. interaction:** Label rendering is derived from `useCoarsePointer()` (a
  `matchMedia` read) + the already-loaded `collapsed` flag (Zustand UI store) + nav data already
  passed as props from the streamed server component. **Zero new server round-trips** on first paint
  or on any interaction (collapse/expand toggle, pointer-type change).
- **(b) Does the interaction change server data?** No. Collapse/expand and pointer detection are
  **pure client state** — the collapse flag persists via the Zustand store (History API not needed;
  it's not URL state). Board reorder already persists via its existing Server Action
  (`reorderBoard`) and is deliberately **not** revalidated (gotcha-44, optimistic order is
  authoritative) — the sensor swap does not change that contract. No new mutations, no new
  revalidation.
- **(c) Bounded/indexed reads:** No reads added or changed. Nav lists are the same bounded
  shell-data props as today.

Net: first-paint and per-interaction server cost is **identical to today**.

## Testing (working-agreement #4 — mandatory, written & executed)

TDD: extend the existing test file for each in-scope component (reuse the
`vi.mock("@/lib/hooks/use-coarse-pointer")` pattern). The **coarse-pointer visible-label behavior is
the key new assertion**.

- **The a11y label test (key):** for each collapsed icon-only surface, under
  `coarse=true && collapsed=true`, assert the item's **visible label text is in the DOM** (e.g.
  `screen.getByText("Goals")` / the board name / dashboard name / admin link label is rendered as
  on-screen text, not only inside the never-opened tooltip content). Under `coarse=false` (fine
  pointer, collapsed) assert the rail stays **icon-only** (no visible caption) so desktop is
  unchanged. This is the regression gate for gotcha-47.
- **Touch-target sizing:** under `coarse=true && collapsed`, assert each item / the collapse toggle
  carries the `≥44px` coarse class (assert the class token, consistent with how
  `reveal-on-hover.test.tsx` asserts on `className`). Under `coarse=false` assert it does not.
- **aria parity:** assert the visible label string equals the existing `aria-label` (single source;
  no drift) and `aria-current` is preserved on active items.
- **BoardsNav sensor swap:** assert the reorder DndContext is wired via `useTouchAwareSensors()`
  (mock the module and assert it's called) rather than a bespoke `PointerSensor` config; keep the
  existing reorder behavior tests green (`reorderPosition` / `reorderBoard` call). The expanded list
  must still render and reorder.
- **No-regression on expanded:** existing expanded-sidebar label/render assertions stay green
  unchanged.
- **Gates per task:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
- **Deferred:** Playwright iPad `device` profiles / real touch-drag E2E (with the phone follow-up).

## Disjointness from the parallel Batch-2 surfaces (explicit)

This surface touches **only nav/shell files** —
`src/components/shell/sidebar-nav.tsx`, `src/components/boards/BoardsNav.tsx`,
`src/components/dashboards/DashboardsNav.tsx`, `src/components/platform/PlatformNav.tsx`,
`src/components/sidebar.tsx` (+ their co-located `*.test.tsx`). The parallel Table / Item-Panel /
Kanban / Gantt / Calendar passes touch **board-surface** files (`BoardTable.tsx`, `KanbanBoard.tsx`,
`GanttBoard.tsx`, the Item Panel sheet, etc.) and **none** of the nav/shell files above. The only
overlap is the **shared foundation primitives**, which all surfaces — including this one — consume
**read-only** (we do not edit them). Therefore there is **no shared mutable file** between this
worktree and the others: they can run fully concurrently with zero merge contention. (`BoardsNav.tsx`
lives under `components/boards/` but is the _sidebar_ board list, distinct from `BoardTable.tsx`/the
board canvas — confirmed in code.)

## Execution DAG (working-agreement #6)

Per-task `Interfaces` (Consumes / Produces):

- **T1 — Collapsed visible-label + touch-size: sidebar-nav.tsx (`Goals/Portfolios/Workload/My
Time/Inbox`).**
  Consumes: `useCoarsePointer` (read-only), UI store `collapsed`. Produces: labeled, ≥44px collapsed
  nav rows + tests. Files: `shell/sidebar-nav.tsx`, `shell/sidebar-nav.test.tsx`.
- **T2 — Collapsed visible-label + touch-size + sensor swap: BoardsNav.tsx.**
  Consumes: `useCoarsePointer`, `useTouchAwareSensors` (both read-only). Produces: labeled collapsed
  board/header/shared tiles, ≥44px, reorder on shared sensors, `TODO` removed + tests. Files:
  `boards/BoardsNav.tsx`, `boards/BoardsNav.test.tsx`.
- **T3 — Collapsed visible-label + touch-size: DashboardsNav.tsx.**
  Consumes: `useCoarsePointer`. Produces: labeled collapsed dashboard header + tiles, ≥44px + tests.
  Files: `dashboards/DashboardsNav.tsx`, `dashboards/DashboardsNav.test.tsx`.
- **T4 — Collapsed visible-label + touch-size: PlatformNav.tsx.**
  Consumes: `useCoarsePointer`. Produces: labeled collapsed admin links, ≥44px + tests. Files:
  `platform/PlatformNav.tsx`, `platform/PlatformNav.test.tsx`.
- **T5 — Touch-size the collapse toggle: sidebar.tsx.**
  Consumes: `useCoarsePointer`. Produces: ≥44px coarse hit area on the expand/collapse toggle +
  tests. Files: `sidebar.tsx`, `sidebar.test.tsx`.

Dependency graph: **T1, T2, T3, T4, T5 are mutually independent** — each owns a disjoint file pair,
no shared mutable state, all consume foundation primitives read-only.

```
Batch (single parallel wave, no unmet dependencies):
  ┌── T1  sidebar-nav.tsx
  ├── T2  BoardsNav.tsx (+ sensor swap)
  ├── T3  DashboardsNav.tsx
  ├── T4  PlatformNav.tsx
  └── T5  sidebar.tsx (toggle)
            │
            └─> integrate on task/touch-nav → gates → finish-task → develop
```

- **Parallel batch:** all 5 tasks in one wave (dispatch via
  `superpowers:subagent-driven-development` parallel subagents within this single
  `task/touch-nav` worktree — they edit disjoint files, so they share the branch without clobber;
  no nested worktrees needed for a 5-file same-surface change).
- **Critical path / wall-clock floor:** the single slowest task = **T2 (BoardsNav)** — it carries
  both the collapsed-label work AND the sensor swap, and BoardsNav is the largest/most-branchy file
  (~305 LOC, owned + shared lists). Everything else is a strict subset of T2's effort.
- **Size:** M (~960 LOC across 5 files; no new files, no migrations, no new dependencies).

## Risks & open questions

- **`w-14` rail + visible caption:** the chosen "caption under icon, vertical stack, truncate"
  mechanism must be verified to keep the rail at `w-14` (no horizontal reflow) and to look right for
  long names (truncation). If stacking proves visually poor, the fallback is an `sr-only`→visible
  swap is **not** acceptable (sr-only is invisible — that's the bug); the fallback is a wider tap
  target with a 2-line clamp. Reviewer to confirm the caption approach before build.
- **44px on a `w-14` (56px) rail:** 44px hit area fits within 56px width; height is the lever. Adding
  the caption increases height; confirm the combined item reaches 44px min without overlapping
  neighbors (the rail is vertically scrollable, so added height is acceptable).
- **iPad-with-trackpad** must keep reading as a _fine_ pointer (desktop affordance, icon-only,
  36px) — `useCoarsePointer()` already handles this; the coarse-only branches must be strictly
  gated on it. Verify on a Magic-Keyboard iPad.
- **Don't ship Batch-2 Nav without the visible labels** (gotcha-47 consequence). The label test is
  the gate that enforces this.

## How to test (manual acceptance, after merge)

Not all user-observable until on a touch device; provide both a desktop-regression check and a
touch check.

1. Pull `develop`. On **desktop** (fine pointer), open the app, collapse the sidebar (⌘\\ or the
   toggle). Expect: rail is icon-only as before — **no captions**, no size change. Hover an icon →
   tooltip still appears. (Desktop unchanged.)
2. On an **iPad** (touch, no trackpad) — or emulate a coarse pointer in dev — collapse the sidebar.
   Expect: each collapsed nav item (`Goals/Portfolios/Workload/My Time/Inbox`, the Boards/Dashboards
   headers, board & dashboard tiles, admin links) now shows a **visible text label**, and each is
   comfortably tappable (≥44px).
3. With an iPad **hardware keyboard**, Tab through the collapsed rail. Expect: every item has a
   visible on-screen label (no more silent icon-only focus) — the gotcha-47 fix.
4. On touch, in the **expanded** sidebar, press-and-hold a board's reorder grip ~200ms and drag.
   Expect: the board lifts and reorders; a quick swipe instead scrolls the list (long-press lift via
   the shared sensors).
