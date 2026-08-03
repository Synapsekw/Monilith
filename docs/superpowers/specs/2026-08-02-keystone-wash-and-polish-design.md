# Keystone wash & polish — design

- **Date:** 2026-08-02
- **Status:** approved (design) 2026-08-02 · plan: `docs/superpowers/plans/2026-08-02-keystone-wash-and-polish.md`
- **Direction chosen:** **B · Periwinkle Dusk** (of A Graphite / B Periwinkle / C Kiln — see "Directions considered")
- **Depends on:** nothing. Pure presentation layer — no schema, no server actions, no new data.
- **Blocks:** nothing. Every other in-flight feature keeps building against the same component APIs.

## Context

Monolith's shell is flat. `--background: #0e0e10` is painted edge to edge, the sidebar
(`#161619`) sits **raised above** it, and content bleeds to the window edges under a
`border-b` header. There is no gradient, no depth, and no highlight anywhere in the
chrome — the only place `--brand` appears is on primary buttons and the focus ring.

The reference is the Buzz desktop app, which the user identified as "clean and
responsive". Reading its source rather than its screenshots, the look is not a palette —
it is one structural decision plus a handful of cheap mechanics:

1. **The surface model is inverted from ours.** Buzz paints a single gradient on the app
   surface and forces every piece of chrome transparent
   (`desktop/src/shared/styles/globals/theme.css`: `--buzz-gradient-dark-top: #4a4616`
   → `--buzz-gradient-dark-bottom: #0a1423`). Content is one **opaque inset card**
   (`--buzz-content-dark: 0 0% 10.2%`) floating on that wash with visible gutters.
   Chrome is atmosphere; content is the object. **We do the reverse today.**
2. **Interaction states are alpha-on-parent, not opaque greys** — `rgb(0 0 0 / 4%)`
   hover, `rgb(0 0 0 / 7%)` active, `rgb(0 0 0 / 40%)` muted text. A fixed grey shows its
   seams against a gradient; alpha adapts to whatever is underneath. This is a
   _consequence_ of decision 1, not an independent taste choice.
3. **Hierarchy comes from weight and indentation, not size.** The app runs at
   essentially one font size; headings are heavier, not bigger.
4. **Cheap mechanics we simply lack:** `cursor: pointer` on interactive elements,
   `scrollbar-gutter: stable`, hover-only scrollbar thumbs, a named motion scale
   (4 durations + 2 easings).

Point 4 is why it feels _responsive_. Points 1–2 are why it feels _clean_.

## Goal

Give Monolith a gradient shell with real highlights, in our own brand rather than
Buzz's, and adopt the mechanics behind the "clean and responsive" read — without
repainting features, changing any data flow, or breaking the Keystone single-accent
doctrine.

**Non-goals:** the marketing/landing page (it already has its own page-wide wash
decision — do not touch it), any change to board/table/kanban information architecture,
and any new component.

## Directions considered

Three washes were mocked as live shells and compared side by side against today's
build (`scratchpad/wash-directions.html`).

|                         | ramp (dark)                           | keeps "chrome is monochrome"?           | verdict                                                                 |
| ----------------------- | ------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| **A · Graphite Ascent** | `#212127 → #08080a`, white bloom      | yes, literally                          | safe, unmemorable — kept as the fallback if B fights the status palette |
| **B · Periwinkle Dusk** | `#212540 → #08090d`, brand bloom @22% | yes in spirit — still exactly one hue   | **chosen**                                                              |
| **C · Kiln**            | `#3a301c → #0b1426` (bronze → navy)   | **no** — introduces a second chrome hue | most distinctive, but rewrites the doctrine and dates faster            |

**B was chosen** because it produces the depth and highlight the flat shell is missing
while keeping the product to a single hue top to bottom. Periwinkle stops being a
button colour and becomes the room's light — the brand appears on every screen without
one new colour token.

## Design

### 1. Surface inversion — the wash and the inset card

This is the load-bearing change; everything else is downstream of it.

- **`body` paints the wash.** A CSS gradient, not an image or a canvas.
- **Chrome paints nothing.** The sidebar (`src/components/sidebar.tsx`) drops
  `bg-sidebar` and `border-r`; the header in `src/components/app-shell.tsx` drops
  `border-b`. Both become transparent and show the wash through.
- **Content becomes one inset opaque card.** `<main>` gains `bg-background`, a
  `rounded-xl`, a hairline, a lift shadow, and a gutter (`mr-2 mb-2 ml-1`).
  Separation now comes from the **gutter**, not from a border line.

Critically, **`--background` keeps its current value and meaning** (`#0e0e10` dark /
`#ffffff` light) — it just stops being the page and becomes the card. The 29 files
using `bg-background` keep working untouched. Only the shell changes.

The content card stays **neutral** while the chrome is tinted. This is deliberate: it
means the status palette, progress ramp and chart colours are still being judged
against the same neutral surface they were tuned on, so the tinted wash cannot
introduce a contrast regression in content. It also matches Buzz, whose content
surface is a flat neutral inside a strongly-coloured shell.

### 2. Tokens — Periwinkle Dusk

New tokens in `src/app/globals.css`, alongside the existing palette:

```css
/* .dark */
--app-wash: linear-gradient(168deg, #212540 0%, #141728 46%, #08090d 100%);
--app-bloom: radial-gradient(
  110% 85% at 8% -6%,
  color-mix(in oklab, var(--brand) 22%, transparent) 0%,
  transparent 58%
);
--content-edge: rgb(255 255 255 / 8%);
--content-lift:
  inset 0 1px 0 0 rgb(255 255 255 / 5%), 0 8px 24px -12px rgb(0 0 0 / 60%);

/* :root (light) */
--app-wash: linear-gradient(168deg, #eef0f8 0%, #e6e9f3 46%, #d9dce8 100%);
--app-bloom: radial-gradient(
  110% 85% at 8% -6%,
  rgb(255 255 255 / 65%) 0%,
  transparent 58%
);
--content-edge: rgb(0 0 0 / 7%);
--content-lift:
  -1px -1px 0 0 rgb(30 40 90 / 8%), 0 1px 3px 0 rgb(30 40 90 / 8%);
```

The wash is capped at **~0.06 chroma** so it never competes with an actual accent
affordance. `--sidebar` and `--sidebar-border` are retired to `transparent` rather than
deleted, so any component still referencing them degrades to "shows the wash" instead
of breaking.

### 3. The highlight vocabulary

"No highlights" was the second half of the complaint. Four, and only four:

1. **Corner bloom** — `--app-bloom`, a brand-tinted radial anchored off the top-left,
   behind the rail. One per app surface.
2. **Card top edge** — the `inset 0 1px 0` in `--content-lift`. A light catching the
   top lip of the inset card.
3. **Selected state** — brand at 14% alpha plus a 2px left indicator, replacing
   today's opaque `--sidebar-accent`.
4. **Focus ring** — unchanged (`--ring: var(--brand)`), which now reads as part of the
   same family rather than as the only coloured thing on screen.

Keystone's "hairlines brighten, never thicken" rule is unchanged and extends to the
card edge.

### 4. Alpha-on-parent interaction states

```css
/* .dark */                      /* :root */
--state-hover:    rgb(255 255 255 / 5%);    rgb(0 0 0 / 4%);
--state-active:   rgb(255 255 255 / 9%);    rgb(0 0 0 / 7%);
--state-selected: color-mix(in oklab, var(--brand) 14%, transparent);
```

Components currently reaching for `bg-accent` / `bg-muted` / `bg-secondary` as a
_hover_ colour migrate to `--state-hover`. Those three tokens keep their identity as
**fills** (badges, inputs, chips) — this is a state/fill separation, not a rename.

### 5. Type scale — weight-based hierarchy first, then consolidation

The audit found **130 arbitrary pixel text sizes across 48 files**, in 16 distinct
values from 9px to 46px (42×`text-[10px]`, 26×`text-[11px]`, 10×`text-[9px]`, …).

Order matters here, and getting it backwards is the trap: shipping a CI guard first
would just make 48 files fail with nowhere to land. So:

1. **Adopt weight-and-indentation hierarchy.** At a given size, distinguish rank by
   weight (400 body / 500 emphasis / 600 heading) and indentation, not by shrinking
   text. This is what makes 16 sizes collapsible into 6.
2. **Add the two missing small tokens** — `--text-2xs: 0.6875rem` (11px) and
   `--text-3xs: 0.625rem` (10px). Their absence is the direct cause of most of the
   arbitrary values.
3. **Migrate all 130 sites** to the nearest token: 9/9.5/10/10.5 → `text-3xs`;
   11/11.5 → `text-2xs`; 12/12.5 → `text-xs`; 13/13.5/14/14.5 → `text-sm`;
   15 → `text-base`; 17 → `text-lg`; 32 → `text-3xl`; 46 → `text-5xl`. Each site is
   eyeballed, not blind-replaced.
4. **Then** add the CI guard (a `check-px-text.mjs` equivalent wired into `pnpm lint`)
   with a documented allowlist for genuinely decorative exceptions.

### 6. Motion scale

We have exactly one easing (`--ease-keystone`) and inline durations. Add the named
scale — note our existing `--ease-keystone` is already byte-identical to Buzz's
arrival curve, so this is naming what we half-have:

```css
--duration-instant: 120ms; /* pressed / feedback   */
--duration-fast: 180ms; /* hover, colour change */
--duration-standard: 240ms; /* state change, expand */
--duration-arrival: 500ms; /* composed entrance    */
--ease-standard: cubic-bezier(0.25, 1, 0.5, 1);
/* --ease-keystone (0.16, 1, 0.3, 1) stays as the arrival ease */
```

The existing global `prefers-reduced-motion` block already stands all of this down.

### 7. Cheap polish

- **`cursor: pointer`** on interactive elements as a base rule. Today only 13 files set
  it ad hoc, so most of the product's buttons show a text caret.
- **`scrollbar-gutter: stable`** on scroll containers — kills the content shift when a
  list crosses the overflow threshold.
- **Hover-only scrollbar thumbs** via the inset-pill technique
  (`border: 3px solid transparent; background-clip: content-box`), replacing today's
  always-visible 10px thumbs.
- **`overscroll-behavior: none`** on both axes; today `globals.css` sets `-x` only, so
  vertical rubber-banding still escapes the app frame.

### 8. Border restraint

Once the gutter separates chrome from content, the shell's `border-r` / `border-b` are
redundant lines. This pass removes structural borders that the new layout already
implies, and keeps borders only where they enclose a real object.

## Deferred (explicitly not in this design)

- **Skeleton → content blur cross-fade** (Buzz's `--skel-reveal-dur: 400ms`). Genuinely
  nice, genuinely separable, and it touches every Suspense boundary — its own piece of
  work once the wash lands.
- **`content-visibility: auto` on long lists.** A real paint win on big boards, but it
  interacts with scroll anchoring and needs its own measurement, not a drive-by.

## Performance & data-fetching budget (working agreement #5)

- **First paint:** the wash is a CSS gradient on `body` — zero requests, zero JS,
  rendered as part of the already-prerendered Cache Components shell. No new bytes
  beyond the token declarations.
- **Interaction:** **0 new server round-trips.** Nothing in this design reads or
  writes server data; every state is CSS or existing client state.
- **Scroll cost:** the shell is already `h-svh overflow-hidden` with scrolling confined
  to `<main>`, so the body gradient is painted once and never repaints on scroll. This
  is verified by the existing structure, not assumed — it is why the wash is safe to
  put on `body` rather than a fixed pseudo-element.
- **Hot-path reads:** unchanged. No query, index, or pagination boundary is touched.

## Risks

1. **Broad blast radius on the type migration** — 48 files across every feature. It is
   the one part of this that can cause visual regressions in code nobody is otherwise
   touching. Mitigation: its own task, reviewed per-site, and it can land independently
   of the wash.
2. **Concurrent sessions.** The shell files are high-traffic; this must rebase onto the
   latest `develop` before gating.
3. **Light mode is a bigger change than dark** — light users go from a flat `#f6f6f8`
   page to a white card on a cool-grey wash. Both modes get walked before merge.
4. **Fallback exists:** if the tinted wash turns out to fight the status chips in
   practice, direction A (neutral graphite) is a two-token change from B — the
   architecture is identical.

## Independent units (for the plan's execution DAG — working agreement #6)

- **U1 · Token layer** — wash, bloom, content edge/lift, state, motion, `text-2xs`/`3xs`.
  Foundation; everything else consumes it.
- **U2 · Shell inversion** — `app-shell.tsx`, `sidebar.tsx`, header. _Consumes U1._
- **U3 · State-token migration** — hover/active/selected across components. _Consumes U1._
- **U4 · Type-scale migration** — 130 sites / 48 files. _Consumes U1._ Independent of U2/U3.
- **U5 · Cheap polish** — cursor, scrollbar gutter + hover thumbs, overscroll. _Independent
  of everything;_ can run in the first wave alongside U1.
- **U6 · CI guard for px text.** _Consumes U4._
- **U7 · Border restraint pass.** _Consumes U2._

U1 and U5 form the first wave; U2, U3, U4 the second (three-way parallel); U6 and U7
the third. Critical path is U1 → U4 → U6.

## Verification

Automated: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

Manual, because this is entirely visual — both themes, walked: boards list, a board
(table + kanban), an item panel, settings, Ask Monolith, and the agents roster. Checked
against the approved preview (`scratchpad/wash-directions.html`, direction B), not just
against "it compiles".
