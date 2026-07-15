# Landing "Monolith Keystone" redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing single MONOLITH landing hero onto the app's shipped "Monolith Keystone" language (periwinkle accent, mono `<Kicker>` eyebrow, the earned glow CTA, brightening hairlines) without adding marketing sections or reimplementing the WebGL centerpiece.

**Architecture:** This is **Option S** from `docs/superpowers/specs/2026-07-14-landing-keystone-redesign-design.md` — a bounded retheme of ~4 colocated files behind existing tests. The changes cluster on the same files, so this is deliberately **one build wave / one worktree** (`task/landing-keystone`), not a parallel DAG. `light-rays.tsx` is touched **only** at its `raysColor` prop; its resize handler is owned by PF Task C5 (see spec §6) and must not be edited here.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Tailwind v4 (Keystone tokens in `src/app/globals.css`), framer-motion, `ogl` (WebGL), Vitest + @testing-library/react. Design skills required before UI edits: `pulse-ui` + `frontend-design`.

---

## Preconditions

- Working inside the worktree `/Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/landing-keystone` on branch `task/landing-keystone` (already created; `pnpm install` already run by `start-task.sh`).
- **Before any UI edit**, (re)load the `pulse-ui` and `frontend-design` skills (AGENTS.md #3).
- Read the spec `docs/superpowers/specs/2026-07-14-landing-keystone-redesign-design.md` in full — §4 (design), §5 (perf budget), §6 (C5 collision).
- Confirm the scope fork was approved as **Option S** before building. If review chose Option L, this plan does not apply — a new multi-section plan is required.

## File Structure

| File                                              | Change                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/components/landing/monolith-scene.tsx`       | Modify — swap the ad-hoc badge for `<Kicker>`; pass periwinkle `raysColor` to `LightRays`; retain dynamic import + reveal. |
| `src/components/landing/monolith-hero.tsx`        | Modify — dark-lock wrapper; primary CTA → Keystone glow CTA; secondary CTA → brightening hairline.                         |
| `src/components/landing/monolith-hero.module.css` | Modify — retune accent hues to periwinkle; Keystone hairline alphas + radius; near-zero shadow.                            |
| `src/components/landing/light-rays.tsx`           | Modify — **`raysColor` default/plumbing only.** Do NOT touch the resize handler (PF-C5).                                   |
| `src/components/landing/monolith-scene.test.tsx`  | Modify — assert `<Kicker>` present + `raysColor` plumbs through.                                                           |
| `src/components/landing/monolith-hero.test.tsx`   | Modify — assert eyebrow renders as a mono kicker; CTA target assertions preserved.                                         |
| `src/components/landing/light-rays.test.tsx`      | Modify — assert `raysColor` prop is accepted; keep the inert-degrade assertion; no resize assertion.                       |

---

### Task 1: Kicker eyebrow (replaces the ad-hoc dev badge)

**Files:**

- Modify: `src/components/landing/monolith-scene.tsx`
- Test: `src/components/landing/monolith-scene.test.tsx`

- [ ] **Step 1: Write the failing test.** Add to `monolith-scene.test.tsx` (the file already mocks `next/dynamic`, `framer-motion`, and `@/lib/fonts`):

```tsx
it("renders the dev-status eyebrow as a Keystone mono kicker", () => {
  render(
    <MonolithScene>
      <a href="#">Get started</a>
    </MonolithScene>,
  );
  const eyebrow = screen.getByText("In active development");
  // Keystone kicker recipe: mono + uppercase + kicker color.
  expect(eyebrow.className).toMatch(/font-mono/);
  expect(eyebrow.className).toMatch(/uppercase/);
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/landing-keystone && pnpm vitest run src/components/landing/monolith-scene.test.tsx`
Expected: FAIL — the current badge is a plain `<span className={styles.badge}>`, no `font-mono`/`uppercase`.

- [ ] **Step 3: Implement.** In `monolith-scene.tsx`, import the primitive and replace the badge span. Keep the periwinkle status dot (it is the one earned accent) and keep the framer-motion reveal wrapper:

```tsx
import { Kicker } from "@/components/ui/kicker";
```

Replace the existing `<motion.span className={styles.badge} …>…</motion.span>` block with:

```tsx
<motion.span className={styles.badge} variants={item}>
  <span className={styles.badgeDot} aria-hidden />
  <Kicker>In active development</Kicker>
</motion.span>
```

(Keep the child text exactly `In active development` so the existing "renders the … dev-status pill" test in `monolith-hero.test.tsx` still passes — CSS `uppercase` does not change `textContent`.) In `monolith-hero.module.css`, drop the now-redundant `font-size`/`letter-spacing`/`color` from `.badge` (the Kicker owns type now) but keep its layout: `display:inline-flex`, `align-items:center`, `gap`, padding, the hairline `border`, `border-radius`, translucent background, `backdrop-filter`.

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm vitest run src/components/landing/monolith-scene.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/landing/monolith-scene.tsx src/components/landing/monolith-scene.test.tsx src/components/landing/monolith-hero.module.css
git commit -m "feat(landing): Keystone mono kicker eyebrow on the hero"
```

---

### Task 2: Keystone CTAs (earned glow primary + brightening-hairline secondary)

**Files:**

- Modify: `src/components/landing/monolith-hero.tsx`
- Test: `src/components/landing/monolith-hero.test.tsx`

- [ ] **Step 1: Write the failing test.** The existing tests already assert CTA hrefs/labels (keep them). Add an assertion that the primary CTA adopts the Keystone glow utility rather than the bespoke white pill:

```tsx
it("primary CTA uses the Keystone earned-glow treatment", () => {
  render(<MonolithHero />);
  const primary = screen.getByRole("link", { name: "Get started" });
  // The glow CTA is periwinkle primary fill + the sanctioned glow utility.
  expect(primary.className).toMatch(/glow-primary/);
  expect(primary.className).toMatch(/bg-primary/);
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `pnpm vitest run src/components/landing/monolith-hero.test.tsx`
Expected: FAIL — `PRIMARY_CTA` currently hardcodes `bg-[#f4f4f6] text-[#0a0a0c]` and a bespoke box-shadow.

- [ ] **Step 3: Implement.** In `monolith-hero.tsx`, replace the two CTA constant strings. Primary becomes the Keystone glow CTA (periwinkle fill, near-black text via `primary-foreground`, the sanctioned white glow); secondary keeps the monochrome outline but switches its bespoke hover shadow for the **brightening hairline** (`border` → `hover:border-border-hover`, no width change):

```tsx
// Primary: the ONE earned loud moment in Keystone (periwinkle fill + near-black
// text + white glow). The landing is its natural host — see spec §4.2.
const PRIMARY_CTA =
  "h-11 rounded-full px-7 bg-primary text-primary-foreground shadow-glow-primary hover:brightness-110";
// Secondary: monochrome outline; hairline BRIGHTENS (never thickens) on hover.
const SECONDARY_CTA =
  "h-11 rounded-full px-7 border border-border hover:border-border-hover hover:bg-accent/40";
```

Leave the `signedIn` branching and `<MagneticButton>` usage unchanged. Note: `shadow-glow-primary` and `border-border-hover` are existing Keystone utilities in `globals.css` (verify with `grep -n "glow-primary\|border-hover" src/app/globals.css` before implementing).

- [ ] **Step 4: Run test to verify it passes.**

Run: `pnpm vitest run src/components/landing/monolith-hero.test.tsx`
Expected: PASS (new assertion + all existing href/label assertions).

- [ ] **Step 5: Commit.**

```bash
git add src/components/landing/monolith-hero.tsx src/components/landing/monolith-hero.test.tsx
git commit -m "feat(landing): Keystone earned-glow primary CTA + brightening-hairline secondary"
```

---

### Task 3: Periwinkle accent — hero hues + `raysColor`

**Files:**

- Modify: `src/components/landing/monolith-hero.module.css`
- Modify: `src/components/landing/monolith-scene.tsx` (pass `raysColor`)
- Modify: `src/components/landing/light-rays.tsx` (**`raysColor` plumbing/default only — NOT the resize handler**)
- Test: `src/components/landing/light-rays.test.tsx`

- [ ] **Step 1: Write the failing test.** In `light-rays.test.tsx`, assert the component accepts and renders with a `raysColor` prop without throwing (jsdom has no WebGL, so it degrades to the inert container — the existing test already relies on this):

```tsx
it("accepts a raysColor prop and still degrades to an inert container in jsdom", () => {
  const { container } = render(<LightRays raysColor="#8ea2eb" />);
  // No WebGL in jsdom → renders the decorative container, no throw.
  expect(container.firstChild).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails/passes.**

Run: `pnpm vitest run src/components/landing/light-rays.test.tsx`
Expected: If `raysColor` is already an optional prop (it is, per `LightRaysProps`), this passes immediately — that is fine; it locks the contract. If the prop were missing it would fail typecheck. Proceed either way.

- [ ] **Step 3: Implement the periwinkle retune.**
  - In `monolith-scene.tsx`, pass the accent explicitly: `<LightRays className={styles.rays} raysColor="#8ea2eb" />`.
  - In `light-rays.tsx`, set the **default** `raysColor` to `"#8ea2eb"` in the props destructure (do not otherwise alter the render/rAF/resize logic).
  - In `monolith-hero.module.css`, retune the accent hues from blue-drift toward periwinkle:
    - `.source` gradient: `rgba(170,180,255,0.35)` → `rgba(142,162,235,0.35)`.
    - `.wordmark` `text-shadow` bloom: `rgba(120,130,220,0.35)` → `rgba(142,162,235,0.32)`; the sweep gradient stop `rgba(186,200,255,0.85)` → `rgba(174,190,240,0.85)`.
    - Confirm `.badgeDot` stays `#8ea2eb` (already correct).

- [ ] **Step 4: Run tests.**

Run: `pnpm vitest run src/components/landing/`
Expected: PASS (all four landing suites).

- [ ] **Step 5: Commit.**

```bash
git add src/components/landing/light-rays.tsx src/components/landing/light-rays.test.tsx src/components/landing/monolith-scene.tsx src/components/landing/monolith-hero.module.css
git commit -m "feat(landing): unify landing accent on Keystone periwinkle (rays + bloom)"
```

---

### Task 4: Dark-lock the surface on Keystone tokens

**Files:**

- Modify: `src/components/landing/monolith-hero.tsx`
- Modify: `src/components/landing/monolith-hero.module.css`

- [ ] **Step 1: Implement (no new test — visual/structural).** The landing is intentionally dark-locked regardless of the visitor's theme (like `/updates`). Wrap the hero's root so Keystone's dark values resolve from tokens: add `dark` to the outer element in `monolith-hero.tsx` (the `styles.page` container) — e.g. `<div className={\`dark ${styles.page}\`}>`. This does not change the bespoke `#06070c`page background (kept — the reskin sanctions the dark-locked hero surface per spec §9), but it makes any token-driven child (Kicker`text-kicker`, `bg-accent`, `border-border-hover`) resolve to dark values. In `monolith-hero.module.css`, align `.badge`/`.footer`hairlines to Keystone alphas (border`rgba(255,255,255,.10)`, hover `.16`) and drop any lingering box-shadow (near-zero-shadow rule).

- [ ] **Step 2: Run the full landing suite + typecheck.**

Run: `pnpm vitest run src/components/landing/ && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/components/landing/monolith-hero.tsx src/components/landing/monolith-hero.module.css
git commit -m "feat(landing): dark-lock the hero on Keystone tokens"
```

---

### Task 5: Full gates + visual verification

- [ ] **Step 1: Run all four gates.**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/landing-keystone && pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 2: Visual check (`/run`).** Start the dev server and open `/` and `/landing`. Confirm: MONOLITH wordmark paints immediately (LCP), the periwinkle rays stream in behind it, the mono kicker eyebrow reads correctly, the primary CTA shows the periwinkle glow, hover brightens the secondary hairline (no width change), and `/landing` while signed in shows the single "Enter app" CTA. Confirm no horizontal scroll and no layout shift on load. Verify `prefers-reduced-motion` freezes the rays to a static frame (DevTools rendering emulation).

- [ ] **Step 3: Finish.** Only after all gates are green and the visual check passes, run `scripts/finish-task.sh` from inside the worktree (it fetches + rebases onto latest `develop` first — resolving the PF-C5 `light-rays.tsx` collision as a trivial non-overlapping rebase, spec §6 — then re-runs the gates against the merged state, merges to `develop`, and cleans up the worktree/branch).

---

## Execution DAG (working-agreement #6)

Option S is **one build unit / one wave / one worktree** — Tasks 1–5 mutate the **same 3–4 colocated files**, so they run **sequentially in a single session**, not as parallel agents (splitting them would only create write-conflicts on shared files for zero speed gain — the honest answer #6 requires). There is exactly one genuine external edge:

- **Cross-task edge (merge-order, not parallelism):** PF `2026-07-09-perf-polish-fluidity.md` **Task C5** also edits `light-rays.tsx` (resize handler). This plan touches only `raysColor` in that file — a disjoint region. Whichever merges to `develop` second rebases onto the first; `finish-task.sh` does this automatically (spec §6).

**Critical path = the single Task 1 → 5 chain** (no fan-out). Wall-clock floor ≈ the sum of the five small tasks, not reducible by concurrency.

## Performance & data-fetching budget (working-agreement #5)

Carried verbatim from spec §5: LCP = the MONOLITH **text** wordmark (Nunito 800, `next/font` self-hosted, `display:swap`, size-adjust fallback → CLS 0); no hero image; `LightRays` stays `next/dynamic({ssr:false})` off the critical path; framer-motion stays eager because it drives above-the-fold reveal (transform/opacity only — no reflow); **no tabs/filters/sorts** exist on the landing, so the "in-page toggle = 0 round-trips" clause has no surface to violate; the only server read is `/landing`'s single `getUser()` behind Suspense; no DB query on any growing table. Keystone adds **no** new fonts (JetBrains Mono for the Kicker is already in the root layout).

## Self-review

- **Spec coverage:** §4.1 route decision → Task 4 keeps both routes/shared component (no route file change needed; confirmed correct). §4.2 hero restyle → Tasks 1 (kicker), 2 (CTAs), 4 (dark-lock/hairlines). §4.3 light-rays retint → Task 3. §4.4 proof strip → intentionally omitted (stretch/default-off). §5 perf → carried above + Task 5 visual. §6 C5 collision → DAG + Task 5 finish. §9 tests → Tasks 1–3 add/keep colocated assertions.
- **Placeholder scan:** none — every step shows the exact code/command.
- **Type consistency:** `raysColor` matches `LightRaysProps` in `light-rays.tsx`; `<Kicker>` signature matches `src/components/ui/kicker.tsx`; utilities `shadow-glow-primary`/`border-border-hover` are existing Keystone tokens (grep-verify in Task 2 Step 3).
- **Utility-name caveat for the implementer:** verify the exact class names for the glow (`shadow-glow-primary`) and hover hairline (`hover:border-border-hover`) against `src/app/globals.css` before writing them — the pulse-ui skill lists both, but confirm the emitted Tailwind utility name matches.

```

```
