---
type: adr
date: 2026-06-28
status: accepted
tags: [decision, gotcha, touch, ipad, accessibility, tooltip]
related:
  - "[[2026-06-28-1822-ipad-touch-foundation]]"
---

# Gotcha 47: Suppressing hover tooltips on touch also kills keyboard-focus labels

## Context

The iPad touch foundation made the shared `Tooltip` touch-aware: on a coarse pointer
`resolveTooltipOpen(coarse, open)` returns `open={false}`, fully closing the tooltip. Rationale:
touch has no hover, so a hover tooltip never fires usefully, and a long-press tooltip would fight the
long-press drag "lift" used elsewhere.

The trap: **Radix Tooltip does not distinguish hover from keyboard-focus** — forcing `open={false}`
suppresses BOTH. Several icon-only controls (sidebar nav: `sidebar.tsx`, `sidebar-nav.tsx`,
`PlatformNav.tsx`, `BoardsNav.tsx`) use the tooltip AS their only visible label. So an iPad user with
a hardware keyboard who tabs to such an icon gets no visible label at all (only the trigger's
`aria-label`, which is invisible). On pure-touch it's also unlabeled, just less likely to be noticed.

## Decision / what to do

- Keep the touch suppression (it's correct for the hover/long-press conflict), but treat it as a
  **known constraint**: any icon-only control whose label lives only in a tooltip MUST carry a
  **visible text label on touch** (coarse pointer). This is owed work for the Batch-2 surface plans
  (Nav especially) before the iPad experience ships publicly.
- The constraint is documented inline in `src/components/ui/tooltip-open.ts` JSDoc so a future editor
  of that helper sees it.

## Rationale

Per the touch spec, "essential info should live in an always-visible label on touch." A tooltip is
not an accessible label substitute on touch/keyboard. Fixing it per-surface (where the visible label
belongs in the layout) is cleaner than special-casing Radix focus-vs-hover in the shared primitive.

## Consequences

- Positive: foundation tooltip behavior is simple and consistent; the gap is explicit, not silent.
- Watch: don't ship Batch-2 Nav without visible touch labels on icon-only items. A holistic
  "icon-only controls need a coarse-pointer label" sweep may be worth a checklist item in each
  surface plan.

## Related

- [[2026-06-28-1822-ipad-touch-foundation]]
- Spec: `docs/superpowers/specs/2026-06-26-ipad-touch-optimization-design.md`
