---
type: adr
date: 2026-06-17
status: accepted
tags: [decision, gotcha]
related: ["[[2026-06-17-2048-dashboards-d1-foundation]]"]
---

# gotcha-14 — react-grid-layout v2 has a rewritten API (don't trust v1 training data)

## Context

The dashboards D1 canvas plan was written against react-grid-layout **v1.x** (the version in model
training data). The installed package is **v2.2.3**, a ground-up rewrite with a different public API.
The plan's code did not exist in v2 and would not have compiled.

## Decision

Use the v2 API for the dashboard canvas (`src/components/dashboards/DashboardCanvas.tsx`) and treat
rgl as a "read the installed source/types, not your memory" dependency — same discipline `AGENTS.md`
mandates for Next.js 16.

## Rationale

v2 removed the pieces the plan relied on. The working equivalents:

- **No `WidthProvider` HOC** → measure with the `useContainerWidth()` hook, feed
  `width`/`containerRef`/`mounted` to `ResponsiveGridLayout` (render the grid only once `mounted`).
- **`isDraggable`/`isResizable` props** → `dragConfig={{ enabled }}` / `resizeConfig={{ enabled }}`.
- **`onLayoutChange(layout, layouts)`** new signature; `Layout` is `readonly LayoutItem[]` (still
  `i/x/y/w/h`).
- **`react-grid-layout` ships its own types** → no `@types/react-grid-layout` (the stub is
  deprecated and conflicts). And it ships its own `css/styles.css` (includes resize-handle styles);
  there is **no** `react-resizable/css/styles.css` to import (that import breaks the build).

## Consequences

- Positive: canvas works on v2 with no `any`/`@ts-ignore`; drag/resize/persist verified by e2e.
- Negative: plans authored from training-data library APIs can be wrong; cost a mid-build adaptation.
- Open follow-ups: D2/D3 chart work (recharts) — re-check the installed major version before writing
  plan code; verify library APIs against `node_modules`, not memory.

## Related

- [[2026-06-17-2048-dashboards-d1-foundation]]
