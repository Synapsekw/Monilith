---
type: adr
date: 2026-09-12
status: accepted
tags: [decision, gotcha, tailwind, ui]
related: ["[[2026-09-12-1252-quiet-grid-inter-table]]"]
---

# Gotcha 105 — tailwind-merge classifies a custom `--text-*` token as a COLOUR, so `cn()` deletes it

## Context

The Quiet Grid work added two font-size tokens to `@theme inline` in `src/app/globals.css`:

```css
--text-cell: 0.8125rem; /* 13px — board table data cells */
--text-item: 0.84375rem; /* 13.5px — board table item + group names */
```

They exist because `scripts/check-px-text.mjs` fails `pnpm lint` on any `text-[Npx]` — the scale is
rem so it responds to the reader's browser font-size setting.

tailwind-merge (3.6.0) does not read our theme. Its class map is built from Tailwind's OWN scale, so
a name it does not recognise as a size falls into the **text-colour** group — the same group as
`text-foreground` and `text-muted-foreground`. Verified:

```
twMerge("text-foreground text-cell") === "text-cell"
twMerge("text-cell text-foreground") === "text-foreground"
```

So inside `cn()` a size token and a colour class delete each other, last one wins. Two shipped on
one branch and survived every task review, a full browser pass and a whole-branch review, because
the source reads perfectly:

- `TimeTrackingCell.tsx` — `cn("text-cell …", isEmpty && "text-muted-foreground/40", !isEmpty && "text-foreground")`
  dropped `text-cell`; that cell rendered ~14px among 13px neighbours.
- `GroupHeaderRow.tsx` — `cn("… text-foreground text-item …", NAME_FREEZE_EDGE)` dropped
  `text-foreground`, so the element inherited `text-muted-foreground` from its parent and **every
  group name on every board rendered grey**. Confirmed in-browser: computed `color` was
  `rgb(178,178,186)` before the fix, `rgb(244,244,246)` after.

Plain `className="text-muted-foreground text-cell"` literals are unaffected — they never reach
twMerge. **Only `cn()` call sites are exposed.**

## Decision

Keep a custom `--text-*` size token OUT of any `cn()` call that also carries a text-colour class.
Put it in a plain literal on the element (or on a wrapper) so tailwind-merge never sees the pair.
Reordering is not the fix: it works until someone appends an argument.

`src/components/boards/text-size-token-cn-merge.test.ts` runs the real `cn` over both call sites'
exact compositions and asserts the size token and the colour class both survive.

## Rationale

Two alternatives were rejected. **Reordering** is order-dependent and silently regresses on the next
edit. **Extending tailwind-merge's config** with a custom class-group would fix it centrally, but it
is a second source of truth for the design tokens that nothing forces anyone to update when a token
is added — the same drift that caused the bug.

## Consequences

- Positive: the failure is now caught by a test that exercises the actual merge, not the source text.
- Positive: the rule generalises — any future `--text-*` token inherits it.
- Negative: the guard names two call sites explicitly; a third would need adding. A repo-wide scan
  for `cn(` calls mixing a `text-<token>` with a `text-<colour>` is the stronger version, unwritten.
- Watch for this with any custom theme key whose utility name collides with a Tailwind group —
  size, colour, width, background. The symptom is always the same: the class is right in the
  source and absent from the DOM.
