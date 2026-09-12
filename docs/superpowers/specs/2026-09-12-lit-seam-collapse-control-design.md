# Lit-seam collapse control (S4)

**Date:** 2026-09-12
**Status:** approved (design), ready to plan
**Supersedes:** the brand-row chevron in `src/components/sidebar.tsx` and the dock's
`PanelRightClose` / `PanelRightOpen` buttons on the wide surface.

## Problem

The two panel-collapse controls sit in different places and neither is near the edge it
moves. The sidebar's chevron lives in the brand row (top-left, beside the wordmark); the
dock's close button lives in the dock header and its open button at the top of the 48px
rail. The result is asymmetric, far from the eye, and — when the rail collapses — the mark
and the chevron stack awkwardly in a 56px column.

## Design

The control moves to the seam it operates, and the seam becomes the control.

At rest, each edge of the content card shows a **30px lit tick** at its vertical middle —
the card's own hairline, brightened. On hover or keyboard focus, that tick **opens from its
own middle in both directions**, running the full edge and **rounding both corners**,
stopping exactly where each corner meets the top and bottom edge. The lit stroke also takes
a soft `drop-shadow` bloom, so the edge reads as illuminated rather than merely paler. A
chevron capsule fades in at the midpoint. Clicking anywhere on the edge folds the panel.

Left edge folds the sidebar. Right edge folds the agent dock, and — because that edge is
already the dock's resize grip — **the same element resizes on drag and folds on click**.

### Why a stroked path and not a `div`

The card is `rounded-xl` (`--radius × 1.4` ≈ 19.6px). A `div` with a height produces a
straight rule that ends in a stub short of the corner; the light has to follow the radius.
So the seam is **the card's own outline, stroked on top of itself**: an SVG path built from
the card's measured box and its computed `borderTopLeftRadius`, inset by half a stroke so
the 1px line lands on the 1px border it is brightening rather than half a pixel outside it.

### Why two paths per edge

Each edge is drawn as **two paths that both start at the middle of that edge** — one running
up, one running down. A single `stroke-dasharray` dash growing from each path's own origin
then opens the light evenly in both directions and reaches the two corners at the same
instant. Revealing one path with a `stroke-dashoffset` was tried first and is the wrong
shape: the offset has to be recomputed against the total length and puts the rest tick out
of phase with the middle.

### Why the length is computed, not measured

`SVGPathElement.getTotalLength()` does not exist in jsdom, and a layout read per frame is
waste besides. The geometry is known, so the path builder returns its own length
analytically — `(H/2 − R)` of straight run plus `π·r/2` of quarter arc, where `r = R − 0.5`.
That makes the whole builder a pure function, unit-testable without a browser, and the only
thing the component reads from the DOM is the card's box and radius.

### Why a ResizeObserver is required, not an optimisation

The card is a flex child between two animated widths. Its box is wrong at first paint and
changes on every frame of a fold. A one-shot measure in an effect produced a 56px-tall card
and lit only the top corner. A `ResizeObserver` on the card is the only thing that knows the
real box at every moment; it redraws two paths per edge, which is cheap.

## Decisions taken

1. **The seam replaces both existing controls** on the wide surface. `⌘\` is unchanged. The
   narrow (`< md`) Sheet keeps its own close button — there is no seam on a phone.
2. **The dock's edge is merged**: one element, `click` folds, `drag` resizes, arrow keys
   still resize. A pointer that moved more than **4px**, or was down longer than **400ms**,
   is a resize and never a fold.
3. **Touch keeps a target.** On `pointer-coarse` the hit area is not the full edge — that
   would steal the card's left gutter from board scrolling and dragging — but a persistent
   **44 × 44** region at the midpoint, with the chevron capsule always visible.
4. **Keyboard keeps a real button.** The visible capsule is a `<button>` with an
   `aria-label` and `aria-expanded`; `:focus-visible` lights the seam exactly as hover does,
   and the capsule carries the focus ring. On the dock the outer strip keeps
   `role="separator"` with its `aria-valuenow/min/max` (resize), and the capsule button
   nests inside it (fold) — both contracts stay intact.

## Components

| Unit                                      | Responsibility                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ui/seam-path.ts`                 | Pure. `seamPath({ width, height, radius, side })` → `{ up, down }`, each `{ d, length }`. No DOM.                                                                                   |
| `src/components/shell/card-seam.tsx`      | Client. Measures the card (ResizeObserver), renders the two SVG paths per edge, owns the lit/rest dash state. Renders `children` as its control layer.                              |
| `src/components/shell/sidebar-seam.tsx`   | Client. `CardSeam side="left"` + a full-height `<button>` bound to `useUIStore.toggleSidebar`.                                                                                      |
| `src/components/boards/dock/DockSeam.tsx` | Client. `CardSeam side="right"` + the existing `role="separator"` resize strip, now also folding on click, with the capsule `<button>` nested. Portalled into the card's seam slot. |

### Shell markup

`<main>` gains a positioned wrapper so the overlay has a containing block, and the dock gets
a portal target on the card — the same pattern `#app-dock-slot` already uses:

```tsx
<div className="relative mr-2 mb-2 ml-1 min-h-0 flex-1">
  <main className="bg-content-surface border-content-edge shadow-content-lift absolute inset-0 overflow-auto rounded-xl border">
    {children}
  </main>
  <SidebarSeam />
  <div id="card-seam-slot" />
</div>
```

The root's existing `:has(#app-dock-slot:not(:empty))` variant moves from `>div>main` to the
wrapper. `<main>` keeps its own `overflow-auto`, radius, border and shadow, so nothing that
measures or scrolls inside it changes.

### Token

One addition to `:root` in `globals.css`, resolved per-theme through `--foreground`:

```css
--seam-glow: 0 0 7px color-mix(in oklab, var(--foreground) 45%, transparent);
```

It is a derived token, not a preset seed, so every theme preset inherits it unchanged.

## Fetching budget (working agreement #5)

Zero. Folding either panel is client state only — `useUIStore` for the sidebar,
`useDockState` (localStorage, per board) for the dock. No Server Action, no navigation, no
`router.refresh`, so no RSC re-run and no board query re-issued (gotcha-09). First paint
adds one client component to the shell and two `<path>` elements per visible edge.

## Testing

- `seam-path.test.ts` — the builder, in jsdom, with no browser: path shape per side, the
  analytic length against a numeric integration of the same curve, behaviour at small
  heights (`H < 2R`), and radius 0.
- `card-seam.test.tsx` — rest dash is half `REST` per path; hover and `focus-visible` set
  the lit dash; `ResizeObserver` (polyfilled in `vitest.setup.ts`, which already carries the
  `localStorage` and `next/font` polyfills) drives a redraw.
- `sidebar.test.tsx` — the brand-row chevron is gone; `⌘\` still toggles.
- `DockSeam.test.tsx` — a 2px pointer move folds; a 10px move resizes and does not fold;
  arrow keys resize; `aria-expanded` tracks the dock.
- Browser check (jsdom renders no geometry — see
  `verify-css-geometry-in-a-browser`): both themes, the lit path against the real card
  radius, and `pointer-coarse` emulation for the 44px target.

## Out of scope

The bow/keyhole variants explored alongside this (masking the card edge) are not being
built. `/ask` has no collapse affordance and gains no seam.
