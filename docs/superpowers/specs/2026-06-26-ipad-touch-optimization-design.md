# iPad Touch Optimization — Design Spec

**Date:** 2026-06-26
**Status:** Approved (brainstorming) — ready for implementation plan
**Scope owner:** Danijel Jovanovic

## Goal

Make Pulse fully usable for **full authoring parity on iPad** by touch. Everything
desktop can do — create/restructure boards, drag Kanban/Gantt, resize columns, reorder
rows, build dashboards — must work well under a finger on an iPad in both portrait
(768px) and landscape (1024px).

This is a **touch-ergonomics** effort, not a layout-reflow effort. At iPad widths the
Tailwind `md:` breakpoint (768px) already shows the sidebar and desktop layout, so the
work is about input ergonomics: drag-vs-scroll resolution, tap-target sizing, and
replacing hover-only affordances — not new narrow-screen layouts.

## Non-goals (explicitly out of scope)

- **Phone (~375–430px).** Acknowledged as a **follow-up project** that needs real layout
  reflow / detail-views. We build the touch primitives here so phone can reuse them, but
  no phone breakpoints or phone-specific surfaces are in this spec.
- **PWA / installable / offline.** Pure responsive web. No service worker, no
  add-to-home-screen, no offline caching.
- **External-keyboard UX investment.** Existing shortcuts (⌘K, ⌘\) must keep working and
  must not break, but we do not invest in dedicated iPad+Magic-Keyboard UX or new focus
  treatments beyond what touch work incidentally improves.
- **Apple Pencil.** No drawing/annotation surface exists; nothing to optimize.
- **Playwright iPad E2E matrix.** Real touch-drag end-to-end tests with iPad device
  profiles are deferred and bundled with the phone follow-up. Vitest component tests are
  still mandatory here (see Testing).

## Current state (audit summary)

Desktop-first codebase. Relevant findings:

- **Already responsive / touch-friendly:** Dashboard canvas (`react-grid-layout` with
  full breakpoints), Item Panel (`Sheet`, full-width on mobile), dialogs. dnd-kit is
  configured with a `PointerSensor` (`activationConstraint: { distance: 6 }`).
- **Desktop-assuming:** Board **Table** (`BoardTable.tsx`, ~75KB; sticky name column +
  horizontal scroll, ~180px fixed column widths, drag handles too small for touch),
  **Kanban** (`KanbanBoard.tsx`; 288px `w-72` fixed lanes), **Gantt** (`GanttBoard.tsx`;
  `DAY_W = 28px`, `LABEL_W = 200px`). ~30+ components use hover-only affordances
  (`opacity-0 group-hover:opacity-100`-style) with no touch/focus fallback. Tooltips are
  hover-based (200ms delay) and invisible on touch.
- **Stack:** Next.js 16.2.9 (App Router, Cache Components/PPR), React 19, Tailwind v4,
  shadcn/ui (radix), dnd-kit 6.3.1. Design tokens in `src/app/globals.css`.
- **Tests:** Vitest (jsdom) + Playwright (Desktop Chrome only). Zero responsive/touch
  coverage today.

## Key decisions

1. **Approach: foundation-first, then per-surface slices.** Build shared touch primitives
   once, then harden each surface against them. (Chosen over surface-by-surface vertical
   slices, which drift/duplicate, and a global `(pointer: coarse)` CSS pass, which can't
   deliver authoring parity for drag-heavy surfaces.)
2. **Drag-vs-scroll: long-press lift as the default; explicit handles for the two awkward
   precision drags** (Gantt bar resize, Table column resize). A quick swipe always scrolls;
   a ~200ms press lifts the item to drag.
3. **Touch detection via `(pointer: coarse)` media query**, not user-agent sniffing — an
   iPad with a trackpad correctly reads as a fine pointer and keeps the desktop affordances.

## Architecture — the touch foundation (Batch 1, critical path)

All in shared `src/` locations so every surface consumes them identically.

1. **`useCoarsePointer()` hook + `<TouchProvider>`** — single source of truth for "is this
   a touch context," backed by `matchMedia('(pointer: coarse)')`. Re-evaluates on input
   change. **SSR-safe default** (assume fine pointer, hydrate to real value) so PPR/RSC is
   not broken. Components read this to choose always-visible-vs-hover and target sizing.

2. **Touch-target sizing tokens** — a coarse-pointer layer in `globals.css`: under
   `@media (pointer: coarse)`, interactive `ui/` primitives (button, icon button,
   dropdown-menu item, list row, drag handle) get a **≥44px** hit area (Apple HIG minimum)
   without changing desktop size. Done at the `ui/` primitive level so it propagates for
   free.

3. **Hover→reveal pattern** — one shared convention replacing the ~30 hover-only
   affordances. Fine pointer: reveal on hover (unchanged). Coarse pointer: controls are
   **always visible**. Implemented as a small utility/class for a mechanical migration, not
   30 bespoke rewrites.

4. **dnd-kit sensor config** — shared sensor setup: `TouchSensor` with
   `activationConstraint: { delay: 200, tolerance: 8 }` (long-press lift) composed with the
   existing `PointerSensor` for mouse. Plus a `<DragHandle>` primitive (≥44px hit area,
   visually slim) for the two handle exceptions. Every draggable surface imports this
   instead of configuring its own sensors.

5. **Tooltip → long-press fallback** — `ui/tooltip` becomes touch-aware: on coarse pointer,
   hover tooltips don't fire; where a tooltip carries essential info it surfaces via
   long-press or moves to an always-visible label.

**Interfaces — Produces (consumed by all Batch 2 surfaces):** `useCoarsePointer()`,
`<TouchProvider>`, coarse-pointer CSS layer + sizing on `ui/` primitives, hover→reveal
utility, shared dnd sensors + `<DragHandle>`, touch-aware `ui/tooltip`.

## Per-surface treatments (Batch 2 — parallel, after Batch 1 merges)

Each surface is its own `task/<name>` worktree. **Consumes:** the foundation. No layout
reflow; no new server round-trips.

| #   | Surface                     | Treatment                                                                                                                                                                                 | Effort       |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| ①   | **Nav / App shell**         | Collapse toggle + nav rows ≥44px; user menu / theme toggle / command trigger touch-sized; collapsed (w-14) rail tappable.                                                                 | Low          |
| ②   | **Board Table**             | Row reorder via long-press lift; **column resize via explicit `<DragHandle>`**; row-hover actions → always-visible; larger inline-cell editor targets; native horizontal scroll retained. | High (75KB)  |
| ③   | **Kanban**                  | Card drag via long-press lift (quick swipe scrolls lanes); 288px lanes retained; card hover-actions → always-visible; add-card / lane-menu touch-sized.                                   | Medium       |
| ④   | **Gantt**                   | Bar move = long-press lift; bar **resize via explicit edge `<DragHandle>`**; native timeline scroll; **add zoom controls** for day-width (28px/day too tight under a finger).             | High         |
| ⑤   | **Calendar**                | Day cells & event chips ≥44px; event drag (if present) → long-press lift.                                                                                                                 | Low          |
| ⑥   | **Dashboard canvas**        | Already responsive; confirm widget drag/resize handles touch-sized; ensure edit-layout affordances aren't hover-only.                                                                     | Low (verify) |
| ⑦   | **Item Panel (sheet)**      | Tabs (Fields/Updates/Activity/Files), field editors, file actions touch-sized; swipe-friendly tab bar; reachable close/back.                                                              | Medium       |
| ⑧   | **Command palette + menus** | ⌘K keeps working; touch entry point already in header; dropdown/context-menu rows ≥44px with generous spacing; tooltip→long-press fallback applied.                                       | Low–Med      |

## Data-fetching & performance budget (working-agreement #5)

**No new server round-trips.** Every change here is client-side touch ergonomics —
pointer detection, CSS sizing, hover-reveal toggling, dnd sensor config. No new queries,
no view/tab/filter changes to server data, no revalidation. First-paint and per-interaction
server cost is **unchanged** from today. Existing bounded/indexed reads on the board
surfaces are untouched.

## Testing (working-agreement #4 — mandatory, written & executed)

- **Foundation (Vitest/jsdom):** `useCoarsePointer()` against mocked `matchMedia`
  (coarse/fine, change events, SSR default); hover→reveal utility renders controls
  always-visible under coarse pointer; dnd sensor config exposes `TouchSensor` with the
  200ms/8px constraint.
- **Per-surface (Vitest):** each surface gets a coarse-pointer render test asserting
  actions are visible (not hover-gated) and that drag wiring uses the shared sensors. jsdom
  cannot truly simulate touch-drag physics, so drag behavior is covered by asserting the
  dnd config + handlers, not gesture playback.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass per task.
- **Deferred:** Playwright iPad `device` profiles + real touch-drag E2E (with the phone
  follow-up).

## Execution DAG (working-agreement #6)

```
Batch 1 (critical path):  Foundation  ─┐
                                        ├─> Batch 2 (parallel):
                                        │     Light lane:  ① Nav   ⑤ Calendar   ⑥ Dashboard   ⑦ Item Panel   ⑧ Cmd/menus
                                        └─>   Heavy lane:  ② Table   ③ Kanban   ④ Gantt(+zoom)
```

- **Batch 1 — Foundation:** one worktree/task. Blocks everything else.
- **Batch 2 — Surfaces:** dispatched concurrently after Batch 1 merges (each its own
  `task/<name>` worktree via `dispatching-parallel-agents` / parallel
  `subagent-driven-development`). Light lane finishes well inside the heavy lane.
- **Critical path / wall-clock floor:** Foundation → slowest heavy surface (Table or Gantt).

## Risks & open questions

- **iPad-with-trackpad** must read as fine pointer — `(pointer: coarse)` handles this;
  verify on a real Magic-Keyboard iPad.
- **Gantt zoom** adds scope to an already-high-effort surface; keep the control minimal
  (zoom in/out buttons or pinch) rather than a full zoom system.
- **Table is 75KB** — touch changes must not regress its virtualization or column-resize
  desktop behavior; lean on existing `BoardTable.test.tsx`.
- **jsdom touch limits** mean gesture physics aren't truly tested in CI; accepted, with
  the Playwright E2E matrix deferred to cover it later.
