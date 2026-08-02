---
type: spec
status: approved
date: 2026-06-18
phase: experiment
title: "Mono — landing on-load reveal animation (test page)"
tags: [project/monolith, spec, landing, animation, experiment]
related:
  - "[[2026-06-18-1957-landing-light-rays-hero]]"
  - "[[00-north-star]]"
---

# Mono — landing on-load reveal animation

## 1. Goal & context

A delightful, one-shot intro animation for the public landing hero, built on a **throwaway test
page** (`/landing-test`) so it can be iterated in isolation before any decision to graduate it onto
the real `/landing`.

A small cartoon character — **"mono", a monochrome wisp born from the light source** — descends on a
thin indigo rope from the top-center light bloom, hooks onto the letter **O** in the `MONOLITH`
wordmark, lowers itself to the subtitle, and **pulls the subtitle into view** (it starts hidden
behind the wordmark). It then curls up to **perch on the O** as a permanent tiny mascot.

This is a **scripted, forward-only, on-load** choreography — not physics-driven, not interactive
after it plays. It must respect `prefers-reduced-motion`, be SSR-safe, and add **zero** new
runtime dependencies.

The character is **authored in code as SVG** (no Rive/Lottie/After-Effects asset).

## 2. Scope & non-goals

**In scope**

- New route `/landing-test` (always-dark, clones the real hero layout: light-rays backdrop, source
  bloom, `MONOLITH` wordmark, subtitle, CTA row).
- `mono` SVG character (the wisp) + the 6-beat reveal sequence.
- Reduced-motion + SSR-correct final state.
- Unit/integration tests + a Playwright smoke check.

**Non-goals (YAGNI for this experiment)**

- Touching the real `/landing` page or its components (we clone, we don't refactor production).
- Mouse-interactivity / drag / replay controls / sound.
- Mobile-bespoke choreography — we degrade gracefully (see §7), full polish is desktop-first.
- Graduating onto `/landing` — a _separate_ follow-up decision once this looks right live.
- Physics / inverse-kinematics. The rope is a drawn path, mono rides it.

## 3. The page (`/landing-test`)

A Server Component route mirroring `src/app/landing/page.tsx` (same always-dark shell, same auth-CTA
derivation is **not** needed — this is an experiment, so CTAs can be static placeholders). It renders
a dedicated client scene component (`MonoScene`) rather than reusing the production `MonolithScene`,
because the test scene needs **different reveal semantics** (the subtitle must start _hidden_ and be
revealed by mono, whereas `MonolithScene` rises everything in on a generic stagger).

Layered structure (z-order, all inside one positioned `.stage`):

```
.stage (position: relative; isolation: isolate; always-dark #06070c)
├─ LightRays            z0   (reuse existing component as-is)
├─ .source bloom        z1   (reuse existing CSS)
├─ .vignette            z1   (reuse existing CSS)
├─ wordmark "MONOLITH"  z5   (the target O wrapped in a ref'd span)
├─ subtitle             z4   (starts hidden, BEHIND wordmark; revealed by the pull)
├─ CTA row              z5   (static placeholders)
└─ MonoLayer (overlay)  z6   (absolutely-positioned SVG: rope + mono wisp)
```

## 4. The character — "mono" the wisp

A small, friendly **monochrome wisp**: a soft rounded body (off-white `#f4f4f6`, the wordmark color)
with a faint **indigo inner glow** (`#bcc4ff`, the brand ray color), two dot eyes, and a wispy tail
instead of legs. Authored as an inline SVG component (`MonoWisp`) with **named, separately
animatable parts**:

- `body` — the rounded blob (squash/stretch on landings + the pull strain).
- `eyes` — two dots (blink + dart for "where am I" / "phew" comedy beats).
- `tail` — the wispy bottom (curls around the O to "grip"; trails during descent).
- `glow` — a soft radial behind the body (pulses as it's born from the light).

Target size ~28–36px tall. Pure vector, no raster. The whole wisp sits inside the `MonoLayer` SVG so
it shares the overlay's coordinate space (simplifies path math).

> Note: a wisp has no hands/legs, so "climb" reads as a floaty **pour/slide** down the rope and a
> **tail-curl** grip — deliberately matching the character rather than hand-over-hand climbing.

## 5. Choreography (6 beats)

Total ~4.2s. Times are nominal; final tuning happens live on the test page.

| #   | Beat                    | ~Duration | What animates                                                                                                                                   |
| --- | ----------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Born from the light** | 0.6s      | source bloom pulse; `mono.glow`+`body` fade/scale in at the bloom; rope `pathLength` 0.001→ begins                                              |
| 2   | **Descent**             | 1.0s      | `mono` rides `offsetPath` (light→O) via `offsetDistance` 0→100%; rope `pathLength`→1 in parallel; `eyes` dart; `tail` trails                    |
| 3   | **Hook the O**          | 0.5s      | small settle/swing (`rotate` overshoot→0) at the O; `tail` curls; `body` squash; "phew" blink                                                   |
| 4   | **Lower to subtitle**   | 0.8s      | `mono` translates down from O to the subtitle line; rope extends with it                                                                        |
| 5   | **The pull**            | 0.7s      | `body` braces (squash) + strain wiggle; **subtitle** reveals (`opacity` 0→1, `y` from behind wordmark via clip/translate) overlapping the brace |
| 6   | **Settle & perch**      | 0.6s      | `mono` floats back up to the O, curls onto its top, idle bob loop begins; rope fades/retracts                                                   |

After beat 6, mono enters a subtle **idle perch loop** (gentle bob + occasional blink) — cheap, can
be disabled.

## 6. Technical approach

**Library: Motion (framer-motion v12.40.0), already installed and already used in the repo.** No new
dependency. (Researched 2026-06-18: ranked #1 for this repo over GSAP — which would mean a second
animation lib for one intro — and over CSS/SMIL-native, which can't read the live `O` position.
Rive/Lottie rejected: they require an externally-authored asset.)

**Orchestration** — `useAnimate()` returns `[scope, animate]`; the scene runs a **sequence array**
of `[target, props, options]` segments with `at` timing (`"<"` parallel, `"+0.05"` gap) to express
the dependent beats. Selectors are auto-scoped to `scope`.

**Rope descent (path-following)** — CSS Motion Path: the moving `mono` group gets
`style.offsetPath = "path('M …')"` built from measured coordinates; the sequence animates
`offsetDistance` `"0%" → "100%"`. `offsetRotate` kept fixed (`0deg`) so the wisp stays upright.

**Rope draw-on** — a `<motion.path className="rope">` animated `pathLength` `0.001 → 1` (start at
`0.001` to avoid the round-cap glitch).

**Subtitle reveal ("pulled from behind the wordmark")** — subtitle sits at `z4` (behind the `z5`
wordmark) with a `clip-path`/`overflow` mask + `opacity:0`; the pull animates `opacity → 1` and `y`
from a tucked offset to rest, so it visually slides out from under the wordmark.

**Glyph & subtitle anchoring (the hard part)** — the rope must end exactly on the live `O`, and the
descent target moves with viewport/font:

1. Wrap the **2nd O** (`MON`**`O`**`LITH`, nearest dead-center under the bloom) in
   `<span ref={oRef}>O</span>`, and the subtitle in `subtitleRef`. Give the bloom/source a `sourceRef`.
2. In an effect: `await document.fonts.ready` (latch onto Nunito's real metrics, not fallback), then
   inside a `requestAnimationFrame`, read `getBoundingClientRect()` of source/O/subtitle **and** the
   stage container; convert to the overlay SVG's coordinate space (subtract stage rect).
3. Build the `offsetPath` string + climb distance from those points, set them, then `animate(sequence)`.
4. Recompute on resize via `ResizeObserver` is **out of scope** for the one-shot (measure once after
   `fonts.ready`); if the user resizes mid-play, the worst case is a cosmetic mismatch on a 4s intro.

**One-shot, StrictMode-safe firing** — fire in `useEffect` after mount; return `controls.stop()` for
cleanup (handles React 19 dev double-invoke + unmount). Guard with a ref only as belt-and-suspenders.

**Reduced-motion + SSR** — two layers:

- Markup renders the **final** state (subtitle visible, mono perched) so server HTML + first client
  render match — no hydration mismatch, no FOUC. The animation starts from that state by setting
  initial hidden values imperatively _after_ mount (so SSR never shows hidden content).
- `useReducedMotion()` → `if (reduce) return;` skips the JS sequence entirely; a
  `@media (prefers-reduced-motion: reduce)` CSS rule pins the final state.

## 7. Component breakdown

All new, under `src/components/landing/mono/` (isolated from production landing components):

| Unit                         | Type        | Responsibility                                                                                          | Depends on                      |
| ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `app/landing-test/page.tsx`  | RSC         | Route shell; always-dark; renders `<MonoScene/>`                                                        | `MonoScene`                     |
| `mono/mono-scene.tsx`        | client      | Layout (wordmark/subtitle/CTAs/overlay), refs, runs the sequence via `useAnimate`, reduced-motion guard | `MonoLayer`, `MonoWisp`, Motion |
| `mono/mono-layer.tsx`        | client      | Absolutely-positioned overlay SVG: the `rope` path + slot for `MonoWisp`                                | `MonoWisp`                      |
| `mono/mono-wisp.tsx`         | client/pure | The wisp SVG art with named parts (`body`/`eyes`/`tail`/`glow`)                                         | —                               |
| `mono/sequence.ts`           | pure        | Builds the Motion sequence array from measured coords (testable in isolation)                           | —                               |
| `mono/measure.ts`            | pure-ish    | `getBoundingClientRect`→overlay-space conversion + path-string builder (pure given rects)               | —                               |
| `mono/mono-scene.module.css` | css         | Stage/overlay/subtitle-mask positioning + reduced-motion final-state rule                               | —                               |

Reused as-is (not modified): `LightRays`, the `.source`/`.vignette`/`.wordmark` CSS patterns
(copied into the module, since the production module is owned by `/landing`).

## 8. Performance & data-fetching budget

(Per `AGENTS.md` rule 5.) This page has **no server data and no views/tabs/filters/sorts**:

- **First paint:** static RSC render of the final hero state. **0 server round-trips.**
- **Interaction:** none that touch server data; the animation is a client-only enhancement.
- **Bounded reads:** N/A (no data reads). The only runtime cost is one WebGL canvas (already used on
  `/landing`) + a short Motion sequence; both pause/stop on completion. Idle perch loop is a cheap
  transform loop, disableable.

## 9. Testing plan

Per the working agreement, tests are written + executed.

- **`sequence.ts` unit (Vitest):** given fixture coords, the produced sequence array has the expected
  segments, order, targets, and `at` timing. This is the choreography's logic, tested without a DOM.
- **`measure.ts` unit (Vitest):** rect→overlay-space conversion + path-string builder produce correct
  geometry for known rects (incl. the stage-offset subtraction).
- **`mono-scene` component (Vitest + jsdom):** renders the **final state** server-equivalently
  (subtitle present/visible in DOM); under mocked `prefers-reduced-motion: reduce` it does **not**
  call `animate`; mock `framer-motion` (mirroring the existing `ogl` global mock pattern) +
  `document.fonts.ready`. Asserts cleanup (`controls.stop`) on unmount.
- **Playwright smoke (`e2e/`):** `/landing-test` loads, wordmark + subtitle + CTAs render, no console
  errors; with reduced-motion emulation the subtitle is immediately visible. (Frame-accurate motion
  assertions are out of scope — we verify _presence + final state_, not pixels.)
- **Full gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; manual live view on
  the dev server (the real acceptance — animation feel is judged by eye).

## 10. Risks & gotchas (from research)

- **Font-swap layout shift** → measure only after `await document.fonts.ready`, else mono latches
  onto fallback-font glyph positions and the O jumps.
- **`getBoundingClientRect` is non-live** → read inside `requestAnimationFrame` after mount.
- **SSR FOUC** → never render hidden content on the server; final state is the SSR state, hidden
  initial values are applied imperatively post-mount.
- **StrictMode double-fire (dev)** → cleanup via `controls.stop()`.
- **`offset-path` creates a stacking context** → keep mono's overlay z-order explicit (z6 above the
  z5 wordmark) so it reads as "in front of" the letters when hooking the O.
- **`pathLength` from `0.001`** not `0` (round-cap render glitch).
- **Import convention** → import from `"framer-motion"` (repo standard), not `"motion/react"`.

## 11. Open questions

None blocking. Tuning (exact durations, easing, the 2nd-vs-1st O if center math prefers the other,
idle-loop on/off) is done live on the test page and doesn't change the architecture.
