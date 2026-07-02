---
type: session
date: 2026-06-28-1822
branch: develop
trigger: wrapup
status: complete
tags: [session, touch, ipad, ui, foundation]
related:
  - "[[2026-06-28-gotcha-47-coarse-tooltip-suppresses-focus-label]]"
---

# iPad Touch Foundation (Batch 1)

## What changed

- Brainstormed → spec'd → planned → built the **iPad touch-optimization foundation** (Batch 1 of a larger effort). Spec `docs/superpowers/specs/2026-06-26-ipad-touch-optimization-design.md`; plan `docs/superpowers/plans/2026-06-26-ipad-touch-foundation.md`.
- Merged to `develop` as `eb16d70` (8 TDD commits `e332677`…`e23f539`). New primitives: `useCoarsePointer()` (`src/lib/hooks`), `useTouchAwareSensors()` (`src/lib/dnd`, long-press lift @200ms + existing 6px mouse), `<DragHandle>`, `<RevealOnHover>` (`src/components/ui`), Button `pointer-coarse:` 44px tap targets, touch-aware tooltip (`tooltip-open.ts`). Kanban wired as the reference sensor integration.
- Scope decided: **iPad-first, full authoring parity, touch-ergonomics only** (no layout reflow — `md:` already shows the sidebar ≥768px). Drag = long-press default + explicit handles for Gantt/column resize. Phone, PWA/offline, keyboard-UX, and the Playwright iPad E2E matrix all explicitly deferred.
- Built via subagent-driven development (fresh implementer + independent spec/quality review per task) in a `task/touch-foundation` worktree. The other 5 drag surfaces marked `TODO(touch-batch-2)`. ADR for the tooltip/focus-label gotcha.

## Why

Pulse is desktop-first; on touch the board surfaces have tiny hit targets, hover-only actions a finger can't reach, and drag gestures that fight scroll. Building shared touch primitives **once** (foundation-first) lets the 8 per-surface Batch-2 plans adopt one consistent, tested API instead of each re-deriving touch handling.

## How to test (for the user)

Pull `develop` (`git pull`), `pnpm dev`. Best seen on a real iPad or Chrome DevTools device toolbar (⌘⇧M) set to a touch/iPad profile so `(pointer: coarse)` matches.

1. Open a board in **Kanban** view. In a touch profile, **press-and-hold a card ~0.2s** → it lifts and drags between lanes; a quick swipe scrolls the lanes instead. (Native-feeling long-press.)
2. Switch back to a **mouse** pointer → Kanban drag still starts after ~6px move, no long-press. Confirms desktop is unchanged.
3. In a touch profile, inspect any toolbar **icon button** → ≥44px. Back on mouse → compact `h-8`/`size-8`.
4. In a touch profile, controls with tooltips **don't** pop a hover tooltip (by design — see Open threads / ADR).

## Open threads

- **Batch 2 (the real surface work):** 8 per-surface plans (Table, Kanban full, Gantt+zoom, Nav, Calendar, Dashboard, Item Panel, command palette/menus), each written against the merged foundation API, dispatchable as parallel worktrees per the spec's execution DAG.
- **a11y carryover:** suppressing hover tooltips on touch also hides keyboard-focus tooltips. Icon-only nav (sidebar) relies on the tooltip AS its label → Batch 2 must add visible labels on touch. See [[2026-06-28-gotcha-47-coarse-tooltip-suppresses-focus-label]].
- Deferred: phone (~375px, needs layout reflow), PWA/offline, Playwright iPad E2E device matrix.

## Next session entry point

Foundation is on `develop` (also part of the unpromoted bundle awaiting `/promote`). Start Batch 2 by scoping the first surface plan (suggest **Kanban full pass** or **Item Panel** — medium effort, high touch value) against the `src/lib/hooks/use-coarse-pointer` + `src/lib/dnd/sensors` + `src/components/ui/{drag-handle,reveal-on-hover}` primitives.
