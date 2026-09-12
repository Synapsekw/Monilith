---
type: adr
date: 2026-09-12
status: accepted
tags: [decision, gotcha, tailwind, ui, testing]
related: ["[[2026-09-12-1252-quiet-grid-inter-table]]"]
---

# Gotcha 106 — a `group-hover/x:` on the element that declares `group/x` is a selector nothing can match

## Context

Quiet Grid's signature interaction is a 2px periwinkle seam that wipes in on the frozen name cell
when a row is hovered. It was written as a pseudo-element on the cell itself:

```tsx
"group/name … after:scale-y-0 group-hover/name:after:scale-y-100";
```

`group-hover/name:` compiles to `.group\/name:hover .group-hover\/name\:…` — a **descendant**
combinator. Here both halves are the same node, and an element is not its own descendant, so the
rule can never apply. **The seam was dead on every row, in every theme, for the entire branch.**

Nothing caught it:

- four task implementations and five task reviews read the class string as correct;
- jsdom applies no CSS, so every unit test passed;
- the class is real, spelled correctly, and present in the compiled bundle — a grep proves nothing;
- even a whole-branch review reading the diff would not see it without tracing the selector.

It was found in Task 5, the browser pass, by looking at a hovered row.

The same branch shipped two sibling failures of the same family — a class that is present in the
source and absent from the rendered result:
[[2026-09-12-gotcha-105-tailwind-merge-classifies-custom-text-tokens-as-colour]] (tailwind-merge
deletes it) and a `NAME_FREEZE_EDGE` collision where two `after:` sets on one element deleted each
other's utilities.

## Decision

A `group-*` variant belongs on a DESCENDANT of the element declaring the group. For an element's own
hover state, use plain `hover:`.

`NameCell.test.tsx` now asserts the **absence** of `group-hover/name:after:scale-y-100` alongside the
presence of the working `hover:` form, so the broken shape cannot come back silently.

## Rationale

The repo has nine named groups and every other consumer is a genuine descendant; this was a
one-off mistake, not a pattern to design around. A lint rule matching "a `group-x:` variant on an
element carrying `group/x`" is writable and would be cheap — noted, not built.

## Consequences

- Positive: the dead-selector shape is now pinned by a test on the one element that had it.
- Negative: nothing prevents the next instance elsewhere.
- **The durable lesson is about verification, not Tailwind.** Three defects on this branch shared a
  shape: the class is correct in the source and absent from the rendered page. Unit tests that
  compare class strings cannot see any of them, and they read as false confidence — green tests over
  a feature that does not work. A visual change is not verified until it has been looked at, in a
  browser, in both themes. The measurement half of the same rule is the auto-memory
  [[verify-css-geometry-in-a-browser]] — jsdom renders nothing, so geometry needs a static harness
  plus the built CSS chunk in Chromium.
