# Landing "Monolith Keystone" redesign

**Date:** 2026-07-14
**Status:** **Built (Option L), 2026-07-15.** Owner overrode the §3 recommendation and chose
**Option L — a full marketing page** built _on top of the existing (Option S restyled) hero_, not a
hero-only restyle. The hero (`MonolithScene` + WebGL light-rays, Keystone restyle) is unchanged; new
sections were added below it in `src/components/landing/` (`landing-sections.tsx`, `landing-mocks.tsx`,
`landing-reveal.tsx`, `landing-view-switcher.tsx`). Delivered section stack: product showcase (board
Table) → a varied feature section (flagship Views row + an AI/automations **bento grid** + a 3-up
Plan/Goals/Time icon-card row) → client view-switcher → 12-cell capability grid → vision note →
waitlist CTA, over a restrained periwinkle gradient atmosphere that blends from the hero's near-black.
Real UI shown via faithful Keystone mockups (screenshots deferred). §3 below is retained as the
original recommendation for the record.
**Original status:** Design — awaiting review (scope fork was the open decision; see §3)
**Related:** memory `dark-first-monday-reskin` (2026-07-09 Keystone direction);
`docs/superpowers/specs/2026-07-09-keystone-reskin-design.md` (app design language this applies);
`docs/superpowers/specs/2026-07-10-keystone-secondary-surfaces-polish-design.md` (explicitly carved
"Landing" out as "its own separate track" — this is that track);
`docs/superpowers/plans/2026-07-09-perf-polish-fluidity.md` **Task C5** (already trims
`light-rays.tsx` + assesses framer-motion — **file-collision, see §6**); `vault/00-north-star.md` §1.

## 1. Goal

The MONOLITH landing is the one **public** surface in Monolith still living in its own bespoke,
theme-independent visual system (fixed hex `#06070c` page, `#f4f4f6` white-pill CTA) rather than
speaking the app's shipped **Monolith Keystone** language. Every authenticated surface now consumes
Keystone tokens + primitives; the landing was deliberately deferred ("its own separate track").
This spec converges the landing onto Keystone so the first thing a visitor sees is the same
identity the product uses inside — near-black layered surfaces, periwinkle `#8ea2eb` accent, mono
kickers, brightening hairlines, near-zero shadows, one earned glow on the primary CTA — **without
sacrificing the deliberate, high-craft restraint that is the brand's whole thesis.**

## 2. Current footprint (verified against this worktree)

The "landing" is **one isolated hero, ~640 LOC, zero app-shell coupling.** No layout, store, query,
or Server Action touches it beyond one `getUser()`.

| File                                              | LOC  | Role                                                                                                                                                                                           |
| ------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/page.tsx`                                | 12   | Root `/` — static Server Component (`○ Static`, edge). Renders `<MonolithHero />` (signed-out). `proxy.ts` redirects an **authed** hit on `/` → `/home`, so `/` is always the signed-out hero. |
| `src/app/landing/page.tsx`                        | 26   | `/landing` splash (nav-logo target). `getUser()` behind a `<Suspense>` → `<MonolithHero signedIn={…}/>`; signed-out hero is the prerendered fallback.                                          |
| `src/components/landing/monolith-hero.tsx`        | 53   | Server Component. Derives CTA labels/targets from `signedIn`; renders `<MonolithScene>` + footer ("Invitation only" · "Updates →").                                                            |
| `src/components/landing/monolith-scene.tsx`       | 75   | `"use client"`. framer-motion staggered reveal; `next/dynamic({ssr:false})` for `LightRays`; badge / wordmark / subcopy / CTA slot.                                                            |
| `src/components/landing/magnetic-button.tsx`      | 76   | `"use client"`. Real `<Link>` styled as `<Button>`, gently magnetic on hover; reduced-motion → static link.                                                                                    |
| `src/components/landing/light-rays.tsx`           | 397  | `"use client"`. WebGL (`ogl`) volumetric ray backdrop. Reduced-motion → one static frame; `IntersectionObserver` pauses off-screen; SSR/jsdom (no WebGL) degrades to inert container.          |
| `src/components/landing/monolith-hero.module.css` | ~170 | Bespoke dark surface: page `#06070c`, wordmark gradient sweep, source bloom, vignette, badge, footer.                                                                                          |
| `*.test.tsx` (×4)                                 | —    | Colocated tests for hero / scene / magnetic-button / light-rays.                                                                                                                               |

Also public + already-Keystone-aware: `src/app/updates/page.tsx` (`/updates` changelog, wrapped in
`.dark`, uses `bg-background`/`text-muted-foreground` tokens + Nunito). `src/lib/fonts.ts` exports
`nunito` (weight 800) for the wordmark. `src/components/brand/brand.tsx` exists but is **not**
imported by the landing. JetBrains Mono + Nunito are wired in the **root** `layout.tsx`, so the
`<Kicker>` primitive (`font-mono`) works on the landing without new font loads.

**Already partly Keystone:** the "In active development" badge dot is already periwinkle `#8ea2eb`
with a matching glow, and the reveal easing is Keystone's `cubic-bezier(0.16,1,0.3,1)`. This is a
convergence, not a rebuild.

## 3. THE scope fork (the decision this review must settle)

> **Recommendation: Option S — restyle the existing single hero into Keystone.** Defer Option L
> (full multi-section marketing page) to a future go-to-market track, documented in §8 so it is
> ready to pull when the product earns it.

**Option S — Keystone restyle of the single hero (recommended).**
Retheme the existing hero onto Keystone tokens/primitives, converge the route story, keep the
light-rays centerpiece, add at most one restrained "proof strip." Stays a **single-screen
statement.** Small; one build wave (see §7).

**Option L — full marketing page** (hero + features + how-it-works + social proof + pricing +
CTA/footer). Multi-section, each section an independent build unit; real execution DAG.

**Why S, not L — three independent reasons:**

1. **The product is invite-only and pre-GTM.** The footer says "Invitation only"; the badge says
   "In active development." A features/pricing/testimonials page would be **fabricating content the
   product does not yet have**: **pricing** depends on Phase-10 **E6 Stripe** (specced, _not
   shipped_), and there is **no social proof** (no customers/testimonials/logos) to show. A pricing
   section with invented numbers or an empty "trusted by" strip is worse than no section.
2. **Restraint is the brand.** North-star §1: "Linear-grade restraint applied to a colorful
   category." The single-statement hero — MONOLITH wordmark, "The only work surface you need." — _is_
   the positioning. A conventional SaaS long-scroll dilutes the one thing that is memorable.
3. **Cost/risk asymmetry.** S is a bounded retheme of ~4 files behind existing tests. L is 6+ net-new
   sections (copy, layout, imagery, responsive, a11y, tests each) for a page that will be **rewritten
   anyway** the moment real pricing + proof exist. Building it now is throwaway work (YAGNI).

**What S still delivers (so it is a redesign, not a token swap):** §4.

## 4. Option S — design

### 4.1 Route & duplication decision — _keep both routes, one shared component_

`/` and `/landing` already render the **same** `<MonolithHero>` — the markup is already DRY at the
component level; the "duplication" is only two thin route files, and they exist for a real reason:

- `/` must stay a **pure static** Server Component (no cookies/auth) so Next prerenders it (`○ Static`)
  and the edge serves an instant first byte; authed visitors never reach it (`proxy.ts` → `/home`).
- `/landing` must stay **dynamic** — it calls `getUser()` (behind Suspense) to swap the CTA to
  "Enter app" for a signed-in viewer who clicked the nav logo.

**Decision: do NOT merge the routes.** They encode two different caching contracts (static-edge vs
auth-aware-dynamic) that a single route cannot express cleanly. Convergence work = confirm both keep
consuming the one `<MonolithHero>` source (they do) and that the Suspense fallback stays the
signed-out hero. This resolves the "`/` vs `/landing` duplication" question as _already correct — no
change_.

### 4.2 Keystone hero restyle (the substance)

Move the bespoke surface onto the Keystone language while preserving the always-dark, cinematic
treatment (the landing is intentionally dark-locked regardless of visitor theme — like `/updates`,
wrap the tree in `dark`; the app's periwinkle-in-dark values then resolve from tokens):

- **Eyebrow → `<Kicker>`.** Replace the ad-hoc "In active development" pill text with the canonical
  `<Kicker>` primitive (`src/components/ui/kicker.tsx`) — mono, uppercase, 11px, `tracking-[0.12em]`,
  optional index prefix (e.g. `00 / IN ACTIVE DEVELOPMENT`). Keep the periwinkle status dot. This is
  the single strongest Keystone signature and it is currently missing.
- **Accent = periwinkle, from tokens.** Everywhere the hero reaches for an accent (dot, glow,
  wordmark bloom tint) use periwinkle `#8ea2eb` consistently (the wordmark bloom currently drifts to
  `rgba(120,130,220,…)` / `rgba(170,180,255,…)` — retune toward periwinkle so the hero and app share
  one hue).
- **Primary CTA → the earned glow CTA.** The Keystone system defines exactly one loud moment: a
  periwinkle-fill + near-black-text button with a white glow (`shadow-glow-primary`) that "has no
  host in-app" (per the reskin memory — items add inline). **The landing is its natural home.** Make
  the primary CTA the Keystone glow CTA instead of the current bespoke white pill. Secondary CTA
  keeps the monochrome outline but adopts the **brightening hairline** (`border` →
  `hover:border-border-hover`) instead of a bespoke shadow. _(Open sub-choice for review: periwinkle
  glow CTA vs. keep the clean white pill. Recommendation: periwinkle glow — it is the one place the
  system was designed for.)_
- **Surfaces & hairlines.** Badge/footer borders adopt translucent Keystone hairline alphas
  (`.10` → `.16` on hover) and near-zero shadow; radius aligns to the 14px/8px Keystone scale.
- **Motion unchanged in kind.** Keep the framer-motion staggered reveal and the magnetic CTA — both
  already use Keystone easing and are transform/opacity-only (no reflow). Reduced-motion paths stay.

### 4.3 light-rays — _keep, retint, do not reimagine_

Keep the 397-LOC centerpiece. It is the signature and is already perf-correct (dynamic/`ssr:false`,
`IntersectionObserver`-paused off-screen, reduced-motion static frame, WebGL-absent graceful
degrade). Reimagining it is high-cost, high-risk, and off-thesis. **Only change:** pass a periwinkle
`raysColor` so the rays match the Keystone accent (today they render near-white/blue). **Do not**
touch the resize handler — that is owned by **PF Task C5** (see §6).

### 4.4 Optional "proof strip" (stretch — the single concession toward marketing)

_If_ review wants slightly more than a bare hero without going to Option L: one restrained row below
the CTA — three mono `<MetaChip>`-style value tokens (e.g. `BOARDS · AUTOMATIONS · AI`) or a single
one-line capability triplet. No imagery, no cards, no scroll. This is the **ceiling** for S; anything
more is Option L. Default: **omit** unless review asks for it.

## 5. Performance & data-fetching budget (working-agreement #5)

The landing is a first-paint/LCP-sensitive **public** marketing surface — the budget is load-bearing.

- **LCP element = the MONOLITH wordmark (text, not an image).** Nunito 800, `display:"swap"`, loaded
  build-time via `next/font` (self-hosted, no external request). **No hero image → no image-LCP
  risk.** Keystone adds **no** new fonts (JetBrains Mono for the Kicker is already in the root layout).
- **CLS = 0.** Page is `min-height:100dvh`; wordmark size is `clamp()`; `next/font` supplies fallback
  metrics (size-adjust) so the swap does not reflow. The reveal animates `opacity`/`transform` only
  (no layout properties). No new above-the-fold image/box that could shift.
- **Animation stays off the critical path.** `LightRays` remains `next/dynamic({ssr:false})` — the
  wordmark/CTA paint immediately; the WebGL chunk streams in after and is `aria-hidden` decorative.
  framer-motion stays eager **only** because it drives the above-the-fold reveal (matches PF C5's
  own conclusion); do not lazy-bound it in a way that delays hero paint.
- **Interaction round-trips: N/A by construction.** There are **no tabs/filters/sorts/views** over
  shared data on the landing — working-agreement #5's "in-page toggle = 0 server round-trips" clause
  has no surface to violate. The only server read is `/landing`'s single `getUser()` (behind
  Suspense, prerendered fallback); `/` reads nothing. No new reads are introduced.
- **Bounded reads: N/A** — the landing issues no DB query on any growing table.

## 6. File-collision with PF Task C5 (must be coordinated, not ignored)

`docs/superpowers/plans/2026-07-09-perf-polish-fluidity.md` **Task C5** ("Landing page trims") edits
**`src/components/landing/light-rays.tsx`** (rAF-coalesce the resize handler) and assesses the
framer-motion boundary in `monolith-scene.tsx` / `magnetic-button.tsx`. This spec also touches
`monolith-scene.tsx` and (for `raysColor` only) `light-rays.tsx`.

**Coordination rule (normative for the plan):**

- This redesign changes `light-rays.tsx` **only** at the `raysColor` prop/uniform — it must **not**
  touch the resize handler C5 owns. The two edits are in different regions of the file.
- Whichever of {this task, PF-C5} merges to `develop` second **rebases** onto the first (a trivial,
  non-overlapping merge). The plan's finish step must `git fetch origin develop` + rebase before
  gating, per the working agreement.
- The framer-motion "eager vs lazy" decision is **shared**: both this spec (§5) and C5 conclude
  **keep eager** (drives above-the-fold LCP animation). No conflict of intent — just don't both add a
  contradictory `// PERF:` comment; if C5 landed first, respect its comment.

## 7. Independent units & concurrency (working-agreement #6)

Option S's changes are **not** independent — they cluster on the **same 3–4 files**
(`monolith-hero.tsx`, `monolith-scene.tsx`, `monolith-hero.module.css`, and a one-line `raysColor`
touch). Splitting them across parallel agents would guarantee write-conflicts on shared files for no
speed gain. **Therefore Option S is deliberately a single build unit (one wave, one agent).** The
plan states this explicitly rather than inventing a fake DAG (the honest answer #6 asks for).

The one genuine cross-task edge is the §6 collision with PF-C5, handled by merge-ordering, not by
parallelism.

(If review picks **Option L** instead, the section inventory in §8 _is_ the independent-unit set and
the plan would carry a real multi-batch DAG.)

## 8. Deferred: Option L section inventory (ready when GTM earns it)

Documented so the pivot is cheap, **not** to be built now:

| #   | Section                                 | Independent?                | Blocker before it is honest             |
| --- | --------------------------------------- | --------------------------- | --------------------------------------- |
| L1  | Hero (this spec's S output is the seed) | yes                         | —                                       |
| L2  | Features / capabilities grid            | yes                         | copy + product screenshots              |
| L3  | How-it-works (3-step)                   | yes                         | copy                                    |
| L4  | Social proof (logos / testimonials)     | yes                         | **real customers** (none yet)           |
| L5  | Pricing                                 | yes                         | **E6 Stripe pricing model** (unshipped) |
| L6  | CTA + full footer                       | yes (depends on shared nav) | —                                       |

**Option-L DAG sketch** (for when it is built): shared page shell + nav/footer = Wave 0; L1–L5 are a
single fully-parallel Wave 1 (six isolated worktrees, no shared state); L6 depends only on the shared
footer. Critical path = Wave 0 → any one section → integration (2 levels). Per-section size: S/M
each. This is a _future_ spec, not this one.

## 9. Testing (working-agreement #4)

Every touched component keeps its **colocated `.test.tsx`** green, updated for the new intent:

- `monolith-hero.test.tsx` — CTA labels/targets by `signedIn`; footer links; renders `<Kicker>`
  eyebrow.
- `monolith-scene.test.tsx` — reveal structure; `LightRays` dynamically mounted; reduced-motion path;
  Kicker present; decorative layers `aria-hidden`.
- `magnetic-button.test.tsx` — renders a real `<Link>` to `href`; reduced-motion → no transform.
- `light-rays.test.tsx` — jsdom (no WebGL) degrades to inert container; `raysColor` prop plumbs
  through; **no assertion on the resize handler** (owned by C5).
- No raw-Tailwind-color / off-token regressions introduced (Keystone tokens only, except the
  intentional dark-locked hero hex that the reskin already sanctions for the bespoke surface).

Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green before finish.

## 10. Non-goals

- No Option L sections (features/how-it-works/social-proof/pricing) — §3/§8.
- No route merge of `/` and `/landing` — §4.1.
- No reimplementation of `light-rays.tsx` — §4.3.
- No edit to the `light-rays.tsx` resize handler (PF-C5 owns it) — §6.
- No new fonts, no hero imagery, no external asset requests.
- No auth/redirect behavior change in `proxy.ts`.

```

```
