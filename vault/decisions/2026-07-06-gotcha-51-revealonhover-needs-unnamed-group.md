---
type: adr
date: 2026-07-06
status: accepted
tags: [decision, gotcha, tailwind, ui, touch, boards, dashboards]
related:
  - "[[2026-07-06-2022-ui-fixes-group-gap-nav-menu]]"
  - "[[2026-06-28-gotcha-47-coarse-tooltip-suppresses-focus-label]]"
---

# Gotcha 51: `RevealOnHover` requires an _unnamed_ `group` ancestor, not `group/<name>`

## Context

`RevealOnHover` (`src/components/ui/reveal-on-hover.tsx`) is the shared primitive for
row/card actions that fade in on hover for mouse users and stay visible on touch. It
reveals with Tailwind's **unnamed** `group-hover:opacity-100` variant.

`DashboardsNav` wrapped its dashboard rows in the _named_ group `group/row` and dropped a
`DashboardItemMenu` (rename/duplicate/delete) inside a `RevealOnHover`. The menu existed and
was wired up correctly — but its trigger was stuck at `opacity-0` forever, so it looked like
the feature was missing entirely.

## The trap

Tailwind named and unnamed group variants **do not cross-match**: `group-hover:` only responds
to a plain `group` ancestor, and `group-hover/row:` only to `group/row`. `RevealOnHover` hardcodes
the _unnamed_ form, so any consumer that tags its hover container with a _named_ group silently
breaks the reveal — no error, no warning, just an action that never appears (and only on fine
pointers; touch pins it visible via `useCoarsePointer`, so it's invisible to touch testing too).

Boards avoided this by accident: `BoardItemMenu` does **not** use `RevealOnHover` — it inlines
`group-hover/row:opacity-100` directly, matching its own `group/row` row. So the two sidebar
menus that look identical revealed via two different mechanisms, and only the `RevealOnHover`
one was misdenamed.

## Decision

Consumers of `RevealOnHover` must place it inside a plain **`group`** ancestor (as its own
docstring says). `DashboardsNav`'s row is now `group`, not `group/row`. When wiring a hover-reveal:

- Using **`RevealOnHover`** → the container must be unnamed `group`.
- Rolling your own inline `group-hover/<name>:` → the container must be the matching `group/<name>`.

Don't mix the two. If a row genuinely needs a named group (to disambiguate from an outer `group`),
don't use `RevealOnHover` — inline the named variant like `BoardItemMenu` does.
