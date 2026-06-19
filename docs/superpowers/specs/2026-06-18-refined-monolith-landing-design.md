# Refined Monolith landing — design

**Date:** 2026-06-18
**Status:** Approved (brainstorming) — ready for implementation plan
**Surface:** Public landing (`/` logged-out, `/landing`) + entry points to `/login` and `/signup`

## Goal

Evolve the existing full-screen "MONOLITH" hero from a single click-anywhere
surface into a striking, modern landing with **explicit Log in / Sign up
entry points** and richer motion — without losing the cinematic, monochrome +
indigo-accent identity that makes it distinctive.

Chosen direction: **Refined Monolith** (keep the art-piece hero, layer in nav +
CTAs + motion). Buttons live in **both** a top-right nav and as centered hero
CTAs. Motion flourishes: **mouse-parallax monolith, light sweep/shimmer,
staggered load reveal, magnetic glowing buttons** (all four).

## Behavior & routing

The current full-surface `<Link>` ("click anywhere to enter") is **removed** — a
surface-wide link cannot wrap focusable buttons. Explicit controls replace it.
Auth state drives labels/targets via a new `signedIn?: boolean` prop on
`MonolithHero`:

| Viewer                 | Top-right nav                                                 | Hero CTAs                                              |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| Logged out (`/`)       | `Log in` (ghost → `/login`) · `Sign up` (primary → `/signup`) | `Get started →` (→ `/signup`) · `Sign in` (→ `/login`) |
| Signed in (`/landing`) | `Enter app` (primary → `/`)                                   | `Enter app →` (→ `/`)                                  |

- `src/app/page.tsx`: logged-out branch renders `<MonolithHero />` (default
  `signedIn={false}`). No other change to its auth/redirect logic.
- `src/app/landing/page.tsx`: renders `<MonolithHero signedIn={!!user} />`
  (replaces the current `href` prop usage).

## Architecture (client boundary pushed to the leaf)

- **`MonolithHero`** (`src/components/landing/monolith-hero.tsx`) — remains a
  **Server Component**. Derives nav/CTA labels + hrefs from `signedIn`, renders
  the top bar (plain `next/link` `<Link>`s styled as buttons) and the scene.
  Contains no client JS itself.
- **`MonolithScene`** (new, `src/components/landing/monolith-scene.tsx`,
  `"use client"`) — owns the interactive centerpiece:
  - **Pointer parallax**: glow + slab layers shift/tilt toward the cursor using
    Framer Motion `useMotionValue` + `useSpring` (subtle translate/rotate).
  - **Staggered load reveal**: Framer `variants` with `staggerChildren` —
    monolith → wordmark → subcopy → CTAs fade/rise in sequence, ease-out.
  - Renders the CTA buttons (passed as children or rendered from props).
- **`MagneticButton`** (new, `src/components/landing/magnetic-button.tsx`,
  `"use client"`, reusable) — wraps `ui/button` via `asChild` + `Link`;
  translates toward the cursor on hover with an indigo glow + subtle scale
  (spring), snaps back on leave.
- **`monolith-hero.module.css`** — keeps the existing atmosphere (vignette,
  glow, slab, wordmark, float/shaft keyframes) and gains a **light-sweep**
  shimmer keyframe (CSS-only specular streak across wordmark + slab edge).

### Reduced motion

All motion respects `prefers-reduced-motion: reduce`:

- CSS keyframes (float, shaft, sweep) already disabled via the existing media
  query — extend it to cover the new sweep.
- `MonolithScene` / `MagneticButton` read the media query (`useReducedMotion`
  from Framer Motion) and make parallax + magnetic transforms **no-ops** (static
  layout, instant reveal).

## Styling (on-system)

- Dark canvas, monochrome chrome, **indigo `--brand`** as the only accent
  (CTAs, focus ring, glow). No raw Tailwind colors — semantic tokens only.
- Nav buttons use the existing `Button` `ghost` (Log in) + `default` (Sign up)
  variants. Hero CTAs: primary `default` (`Get started` / `Enter app`) +
  `outline`/`ghost` secondary (`Sign in`).
- Geist (`font-sans`) for nav + subcopy; the `archivo` display font stays on the
  `MONOLITH` wordmark.
- Subcopy: "One coherent surface for all your work."
- Motion timing per `pulse-ui`: 150–250ms, ease-out, subtle; reveal stagger in
  that band. Framer Motion (`framer-motion@^12`, already installed).

## Accessibility

- Every control keyboard-reachable with a visible `focus-visible` ring
  (brand-colored). Nav + CTAs are real links.
- Magnetic/parallax are progressive enhancement: keyboard and reduced-motion
  users get a fully static, fully usable page.
- AA contrast verified for nav/CTA text on the dark canvas.

## Performance & data-fetching budget

- Static marketing surface. **First paint = hero only**; the sole server call is
  the existing `getUser()` in `page.tsx` / `landing/page.tsx`.
- All motion is client-side pointer math + CSS → **0 server round-trips** on any
  interaction (parallax, magnetic, sweep, reveal).
- CTAs are genuine **route navigations** (`/login`, `/signup`, `/`) — correct
  use of RSC nav (changing routes), not in-page view toggles.
- No data lists / tables on this surface, so no pagination/indexing concerns.

## Testing (mandatory)

Vitest component tests (`src/components/landing/__tests__/` or co-located):

1. Logged-out `MonolithHero` renders links to **both** `/login` and `/signup`
   (nav `Log in`/`Sign up` + hero `Sign in`/`Get started`).
2. `signedIn` `MonolithHero` renders the **`Enter app` → `/`** path and **no**
   `/signup` link.
3. Reduced-motion render path produces no error and keeps controls present
   (mock `matchMedia` / `useReducedMotion`).
4. Controls expose accessible names (`Log in`, `Sign up`, `Get started`,
   `Sign in`) and are links.

Playwright e2e (extend existing suite):

5. From the landing, clicking **Sign up** navigates to `/signup`; clicking
   **Log in** navigates to `/login`.

## Definition of done

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all green; behavior
verified in the running app (logged-out and signed-in states; keyboard + reduced
motion).

## Out of scope (YAGNI)

- Multi-section marketing page (feature grid, pricing, footer) — not this pass.
- WebGL/canvas centerpiece — deferred (the CSS + Framer approach meets the goal).
- Theme toggle on the landing — landing stays dark by design.
