# Refined Monolith Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the full-screen click-anywhere "MONOLITH" hero into a striking landing with explicit Log in / Sign up entry points (top nav + hero CTAs) and richer motion (mouse-parallax monolith, light-sweep shimmer, staggered load reveal, magnetic glowing buttons), without losing its cinematic monochrome + indigo identity.

**Architecture:** `MonolithHero` stays a Server Component that derives nav/CTA labels + hrefs from a new `signedIn` prop and renders a top nav (plain styled `<Link>`s) plus a client `MonolithScene`. `MonolithScene` (`"use client"`) owns pointer parallax + staggered reveal via Framer Motion. CTAs are `MagneticButton`s (`"use client"`, reusable) that pull toward the cursor with an indigo glow. Atmosphere + light-sweep live in the existing CSS module. All motion degrades to static under `prefers-reduced-motion`.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Tailwind v4 semantic tokens, shadcn `Button`, `framer-motion@^12`, CSS Modules, Vitest + Testing Library, Playwright.

---

## Spec

`docs/superpowers/specs/2026-06-18-refined-monolith-landing-design.md`

## Component API (locked — use these exact names everywhere)

```ts
// MonolithHero (server)
function MonolithHero(props: { signedIn?: boolean }): JSX.Element; // default signedIn = false

// MonolithScene (client) — interactive centerpiece, renders the CTAs passed as children
function MonolithScene(props: { children: React.ReactNode }): JSX.Element;

// MagneticButton (client) — a single magnetic CTA that is a real link
function MagneticButton(props: {
  href: string;
  children: React.ReactNode;
  variant?: "default" | "outline";
  size?: "default" | "lg";
}): JSX.Element;
```

Labels & targets by auth state:

| State            | Nav                                                      | Hero CTAs                                                       |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `signedIn=false` | `Log in`→`/login` (ghost), `Sign up`→`/signup` (default) | `Get started`→`/signup` (default), `Sign in`→`/login` (outline) |
| `signedIn=true`  | `Enter app`→`/` (default)                                | `Enter app`→`/` (default)                                       |

## File Structure

- Modify: `vitest.setup.ts` — add `window.matchMedia` stub (Framer's `useReducedMotion` needs it under jsdom).
- Create: `src/components/landing/magnetic-button.tsx` — reusable magnetic CTA (client).
- Create: `src/components/landing/magnetic-button.test.tsx` — render/href/a11y tests.
- Create: `src/components/landing/monolith-scene.tsx` — parallax + staggered reveal centerpiece (client).
- Modify: `src/components/landing/monolith-hero.module.css` — restructure for page/nav/scene + subcopy/ctas + light-sweep keyframe.
- Modify: `src/components/landing/monolith-hero.tsx` — server composition; `signedIn` prop replaces `href`.
- Modify: `src/components/landing/monolith-hero.test.tsx` — rewrite for new controls.
- Modify: `src/app/landing/page.tsx` — pass `signedIn={!!user}` instead of `href`.
- Modify: `src/app/landing/page.test.tsx` — mock `MonolithHero` by `signedIn`, assert targets.
- Modify: `e2e/home.spec.ts` — assert nav + CTA controls and navigation.
- Unchanged (verified): `src/app/page.tsx` logged-out branch stays `<MonolithHero />`; `src/app/page.test.tsx` mocks `MonolithHero` so it needs no edit.

---

### Task 1: matchMedia stub for jsdom

Framer Motion's `useReducedMotion` calls `window.matchMedia`, which jsdom does not implement. Without a stub the new client components throw in tests.

**Files:**

- Modify: `vitest.setup.ts`

- [ ] **Step 1: Add the stub**

In `vitest.setup.ts`, immediately after the existing `Element.prototype.releasePointerCapture` block (around line 23) and before the PointerEvent block, add:

```ts
// jsdom lacks matchMedia; Framer Motion's useReducedMotion (and any media-query
// reads) need it. Default to "no match" (motion enabled) so components render.
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
```

- [ ] **Step 2: Verify the suite still passes**

Run: `pnpm test --run`
Expected: PASS (no behavior change yet; this only adds a global).

- [ ] **Step 3: Commit**

```bash
git add vitest.setup.ts
git commit -m "test(setup): stub matchMedia for Framer Motion under jsdom"
```

---

### Task 2: MagneticButton component

A reusable client CTA: a real `<Link>` styled with our `Button`, wrapped in a `motion.div` that translates toward the cursor (spring) with an indigo glow on hover. No-op under reduced motion.

**Files:**

- Create: `src/components/landing/magnetic-button.tsx`
- Test: `src/components/landing/magnetic-button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/landing/magnetic-button.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MagneticButton } from "./magnetic-button";

// next/link needs the app-router context in Next 16; render a plain anchor.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("MagneticButton", () => {
  it("renders a link to href with its label as the accessible name", () => {
    render(<MagneticButton href="/signup">Get started</MagneticButton>);
    const link = screen.getByRole("link", { name: "Get started" });
    expect(link).toHaveAttribute("href", "/signup");
  });

  it("does not crash on pointer move/leave", () => {
    render(<MagneticButton href="/login">Sign in</MagneticButton>);
    const link = screen.getByRole("link", { name: "Sign in" });
    const wrapper = link.parentElement as HTMLElement;
    fireEvent.pointerMove(wrapper, { clientX: 10, clientY: 10 });
    fireEvent.pointerLeave(wrapper);
    expect(link).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/components/landing/magnetic-button.test.tsx`
Expected: FAIL — `Failed to resolve import "./magnetic-button"` / module not found.

- [ ] **Step 3: Write the implementation**

Create `src/components/landing/magnetic-button.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRef } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import { Button } from "@/components/ui/button";

type MagneticButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: "default" | "outline";
  size?: "default" | "lg";
};

const STRENGTH = 8; // px the button drifts toward the cursor

/**
 * A real navigation link styled as a Button that gently pulls toward the cursor
 * with an indigo glow on hover. Pure progressive enhancement: under reduced
 * motion the magnetic transform is skipped and it behaves as a static link.
 */
export function MagneticButton({
  href,
  children,
  variant = "default",
  size = "lg",
}: MagneticButtonProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.4 });

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const relX = e.clientX - (rect.left + rect.width / 2);
    const relY = e.clientY - (rect.top + rect.height / 2);
    x.set((relX / (rect.width / 2)) * STRENGTH);
    y.set((relY / (rect.height / 2)) * STRENGTH);
  }

  function reset() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={reset}
      style={reduce ? undefined : { x: sx, y: sy }}
      className="inline-flex"
    >
      <Button
        asChild
        variant={variant}
        size={size}
        className="transition-shadow duration-200 hover:shadow-[0_0_30px_-6px_var(--brand)]"
      >
        <Link href={href}>{children}</Link>
      </Button>
    </motion.div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/components/landing/magnetic-button.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/magnetic-button.tsx src/components/landing/magnetic-button.test.tsx
git commit -m "feat(landing): magnetic CTA button"
```

---

### Task 3: Restructure the CSS module (page / nav / scene + sweep)

Reshape the module from a single `.hero` link into a `.page` wrapper containing a `.nav` bar and a centered `.scene`, and add the subcopy/cta layout + light-sweep keyframe. Keep the existing atmosphere (vignette, glow, slab, wordmark, float/shaft).

**Files:**

- Modify: `src/components/landing/monolith-hero.module.css`

- [ ] **Step 1: Replace the file contents**

Overwrite `src/components/landing/monolith-hero.module.css` with:

```css
.page {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  isolation: isolate;
  overflow: hidden;
  background: #0d0d0f;
}

.nav {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem clamp(1rem, 4vw, 2.5rem);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #f4f4f6;
}

.brandMark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 6px;
  background: var(--brand);
  color: var(--brand-foreground);
  font-size: 0.8rem;
}

.navActions {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.scene {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.75rem;
  overflow: hidden;
}

.vignette {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(
    120% 90% at 50% 45%,
    transparent 40%,
    rgba(0, 0, 0, 0.55) 100%
  );
}

.glow {
  position: absolute;
  z-index: 1;
  width: min(15vh, 150px);
  height: min(70vh, 620px);
  filter: blur(40px);
  pointer-events: none;
  background: linear-gradient(
    to top,
    rgba(186, 200, 255, 0),
    rgba(186, 200, 255, 0.55) 45%,
    rgba(224, 231, 255, 0.2)
  );
  animation: shaft 7s ease-in-out infinite;
}

.slab {
  position: absolute;
  z-index: 2;
  width: min(15vh, 140px);
  height: min(52vh, 470px);
  border-radius: 3px;
  pointer-events: none;
  background: linear-gradient(160deg, #1c1c22, #0a0a0c);
  box-shadow:
    inset 1.5px 0 0 rgba(255, 255, 255, 0.1),
    inset -1.5px 0 0 rgba(0, 0, 0, 0.6),
    0 40px 90px rgba(0, 0, 0, 0.65);
  clip-path: polygon(0 11%, 100% 0, 100% 100%, 0 100%);
  animation: float 6.5s ease-in-out infinite;
}

.wordmark {
  position: relative;
  z-index: 5;
  font-size: clamp(40px, 9vw, 124px);
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #f4f4f6;
  text-shadow: 0 4px 50px rgba(0, 0, 0, 0.7);
  background-image: linear-gradient(
    100deg,
    transparent 35%,
    rgba(186, 200, 255, 0.85) 50%,
    transparent 65%
  );
  background-size: 250% 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  animation: sweep 6s ease-in-out 1.2s infinite;
  transition: letter-spacing 0.6s ease;
}

.scene:hover .wordmark {
  letter-spacing: 0.05em;
}

.subcopy {
  position: relative;
  z-index: 5;
  margin: 0;
  font-size: clamp(0.9rem, 1.4vw, 1.05rem);
  letter-spacing: 0.01em;
  color: #a1a1aa;
  text-align: center;
}

.ctas {
  position: relative;
  z-index: 5;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

@keyframes shaft {
  0%,
  100% {
    opacity: 0.5;
    transform: translateY(8px) scaleY(0.96);
  }
  50% {
    opacity: 0.92;
    transform: translateY(-6px) scaleY(1.04);
  }
}

@keyframes float {
  0%,
  100% {
    transform: translateY(6px);
  }
  50% {
    transform: translateY(-8px);
  }
}

@keyframes sweep {
  0% {
    background-position: 200% 0;
  }
  40%,
  100% {
    background-position: -120% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .glow,
  .slab,
  .wordmark {
    animation: none;
  }
}
```

Note: the `.glow`/`.slab` parallax transform is applied by Framer Motion via inline `style` in `MonolithScene`; the keyframes here animate the existing float/shaft on top of that, which composes correctly because Framer writes `transform` and these keyframes also write `transform` only on the element — to avoid conflict the float/shaft motion is moved into the Framer layer in Task 4 (the CSS `animation` on `.glow`/`.slab` is overridden there). Keeping the CSS keyframes as the reduced-motion-safe fallback is intentional.

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS (CSS module change does not affect types; this confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/monolith-hero.module.css
git commit -m "style(landing): restructure hero css for nav/scene + light sweep"
```

---

### Task 4: MonolithScene client component

The interactive centerpiece: renders the atmosphere layers + wordmark + subcopy + a CTA slot (`children`), applies pointer parallax to glow/slab, and orchestrates a staggered load reveal. No-op transforms under reduced motion.

**Files:**

- Create: `src/components/landing/monolith-scene.tsx`

> Tested indirectly through `MonolithHero` in Task 5 (render-smoke + a11y). Motion feel is verified manually in Task 8 — pointer-spring animation cannot be meaningfully asserted in jsdom.

- [ ] **Step 1: Write the implementation**

Create `src/components/landing/monolith-scene.tsx`:

```tsx
"use client";

import { useRef } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  type Variants,
} from "framer-motion";
import { archivo } from "@/lib/fonts";
import styles from "./monolith-hero.module.css";

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
};

/**
 * Interactive landing centerpiece. Glow + slab drift toward the cursor (parallax
 * at two depths); wordmark, subcopy and the CTA slot rise in on load. `children`
 * is the CTA row, rendered by the server `MonolithHero`. All motion is disabled
 * under prefers-reduced-motion.
 */
export function MonolithScene({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const spring = { stiffness: 120, damping: 20, mass: 0.6 };
  // Two depths: slab moves more than the glow behind it.
  const glowX = useSpring(px, spring);
  const glowY = useSpring(py, spring);
  const slabX = useSpring(useMotionValue(0), spring);
  const slabY = useSpring(useMotionValue(0), spring);

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const nx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const ny = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    px.set(nx * 14);
    py.set(ny * 10);
    slabX.set(nx * 26);
    slabY.set(ny * 16);
  }

  function reset() {
    px.set(0);
    py.set(0);
    slabX.set(0);
    slabY.set(0);
  }

  return (
    <motion.div
      ref={ref}
      className={styles.scene}
      onPointerMove={handleMove}
      onPointerLeave={reset}
      variants={container}
      initial={reduce ? false : "hidden"}
      animate="show"
    >
      <span className={styles.vignette} aria-hidden />
      <motion.span
        className={styles.glow}
        aria-hidden
        style={reduce ? undefined : { x: glowX, y: glowY }}
      />
      <motion.span
        className={styles.slab}
        aria-hidden
        style={reduce ? undefined : { x: slabX, y: slabY }}
      />
      <motion.span
        className={`${styles.wordmark} ${archivo.className}`}
        variants={item}
      >
        MONOLITH
      </motion.span>
      <motion.p className={styles.subcopy} variants={item}>
        One coherent surface for all your work.
      </motion.p>
      <motion.div className={styles.ctas} variants={item}>
        {children}
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/monolith-scene.tsx
git commit -m "feat(landing): interactive monolith scene (parallax + reveal)"
```

---

### Task 5: Rewrite MonolithHero as server composition + tests

Replace the single-link hero with a server component that renders a top nav (logo + auth links) and the `MonolithScene` containing the CTAs, driven by `signedIn`.

**Files:**

- Modify: `src/components/landing/monolith-hero.tsx`
- Modify: `src/components/landing/monolith-hero.test.tsx`

- [ ] **Step 1: Rewrite the test (failing)**

Overwrite `src/components/landing/monolith-hero.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonolithHero } from "./monolith-hero";

// next/link needs the app-router context in Next 16; render a plain anchor.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("MonolithHero", () => {
  it("renders the MONOLITH wordmark", () => {
    render(<MonolithHero />);
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
  });

  it("logged out: nav and hero link to both /login and /signup", () => {
    render(<MonolithHero />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("signed in: shows Enter app → / and no signup link", () => {
    render(<MonolithHero signedIn />);
    const enter = screen.getAllByRole("link", { name: "Enter app" });
    expect(enter.length).toBeGreaterThan(0);
    enter.forEach((link) => expect(link).toHaveAttribute("href", "/"));
    expect(
      screen.queryByRole("link", { name: "Sign up" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Get started" }),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/components/landing/monolith-hero.test.tsx`
Expected: FAIL — no `Log in`/`Get started` links yet (current hero renders a single anchor + "Click to enter").

- [ ] **Step 3: Rewrite the implementation**

Overwrite `src/components/landing/monolith-hero.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MagneticButton } from "./magnetic-button";
import { MonolithScene } from "./monolith-scene";
import styles from "./monolith-hero.module.css";

/**
 * Public landing hero. Server Component: derives the nav + CTA labels/targets
 * from auth state and renders the interactive client `MonolithScene`. The top
 * nav holds quick auth links; the hero holds primary magnetic CTAs.
 *
 * `signedIn` drives the copy: logged-out visitors get Log in / Sign up; a
 * signed-in viewer (the `/landing` splash) gets a single "Enter app" path back
 * into the product (`/`, which routes on to their board).
 */
export function MonolithHero({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <span className={styles.brand}>
          <span className={styles.brandMark} aria-hidden>
            P
          </span>
          Pulse
        </span>
        <nav className={styles.navActions}>
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/">Enter app</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Sign up</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <MonolithScene>
        {signedIn ? (
          <MagneticButton href="/">Enter app</MagneticButton>
        ) : (
          <>
            <MagneticButton href="/signup">Get started</MagneticButton>
            <MagneticButton href="/login" variant="outline">
              Sign in
            </MagneticButton>
          </>
        )}
      </MonolithScene>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/components/landing/monolith-hero.test.tsx`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/monolith-hero.tsx src/components/landing/monolith-hero.test.tsx
git commit -m "feat(landing): nav + hero CTAs driven by auth state"
```

---

### Task 6: Update the /landing splash route + test

`/landing` must pass `signedIn` instead of the removed `href` prop.

**Files:**

- Modify: `src/app/landing/page.tsx`
- Modify: `src/app/landing/page.test.tsx`

- [ ] **Step 1: Update the test (failing)**

Overwrite `src/app/landing/page.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));
vi.mock("@/components/landing/monolith-hero", () => ({
  MonolithHero: ({ signedIn }: { signedIn?: boolean }) => (
    <div>monolith:{signedIn ? "in" : "out"}</div>
  ),
}));

import LandingPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LandingPage (/landing splash)", () => {
  it("renders the logged-out hero for visitors", async () => {
    getUser.mockResolvedValue(null);
    render(await LandingPage());
    expect(screen.getByText("monolith:out")).toBeInTheDocument();
  });

  it("renders the signed-in hero for authenticated viewers", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    render(await LandingPage());
    expect(screen.getByText("monolith:in")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/app/landing/page.test.tsx`
Expected: FAIL — the page still passes `href`, so the mock renders `monolith:out` in both cases (the signed-in assertion fails).

- [ ] **Step 3: Update the implementation**

In `src/app/landing/page.tsx`, change the render line. Replace:

```tsx
return <MonolithHero href={user ? "/" : "/login"} />;
```

with:

```tsx
return <MonolithHero signedIn={!!user} />;
```

Also update the surrounding doc comment's last sentence to reflect the new behavior. Replace:

```tsx
 * which routes on to their board) and a logged-out visitor to `/login`.
```

with:

```tsx
 * which routes on to their board) via the "Enter app" CTA; logged-out visitors
 * get the Log in / Sign up entry points.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/app/landing/page.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/landing/page.tsx src/app/landing/page.test.tsx
git commit -m "feat(landing): pass signedIn to hero from /landing splash"
```

---

### Task 7: Update the e2e flow

The hero is no longer one link named "MONOLITH". Assert the new nav + CTA controls and that they navigate to `/login` / `/signup`.

**Files:**

- Modify: `e2e/home.spec.ts`

- [ ] **Step 1: Replace the two landing tests**

In `e2e/home.spec.ts`, replace the first two tests (the `/` and `/landing` blocks, lines 3–27) with:

```ts
test("unauthenticated / shows the landing with Log in + Sign up entry points", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);

  await expect(page.getByText("MONOLITH")).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute(
    "href",
    "/login",
  );
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveAttribute(
    "href",
    "/signup",
  );
  await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute(
    "href",
    "/signup",
  );
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/login",
  );

  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByText("Create your account")).toBeVisible();
});

test("landing Log in navigates to the sign-in form", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Welcome back")).toBeVisible();
});

test("unauthenticated /landing shows the splash entry points (proxy lets it through)", async ({
  page,
}) => {
  await page.goto("/landing");
  await expect(page).toHaveURL(/\/landing$/);
  await expect(page.getByText("MONOLITH")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveAttribute(
    "href",
    "/signup",
  );
});
```

Leave the existing `/login` and `/signup` form tests (lines 29–45) unchanged.

- [ ] **Step 2: Run the landing e2e**

Run: `pnpm exec playwright test e2e/home.spec.ts`
Expected: PASS. (If the e2e harness needs the dev/preview server, follow the repo's standard `pnpm test:e2e` flow per `playwright.config.ts`.)

- [ ] **Step 3: Commit**

```bash
git add e2e/home.spec.ts
git commit -m "test(e2e): landing nav + CTA navigation to login/signup"
```

---

### Task 8: Full verification + manual check

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test --run && pnpm build
```

Expected: all PASS. Investigate and fix any failure before continuing (do not claim done on red).

- [ ] **Step 2: Manual verification in the running app**

Run the dev server (`pnpm dev`) and confirm, logged **out** at `/`:

- Top nav shows `Pulse` brand + `Log in` (ghost) and `Sign up` (filled indigo).
- Hero shows `MONOLITH`, the subcopy, and `Get started` + `Sign in` CTAs.
- Moving the mouse across the scene drifts the slab/glow toward the cursor (parallax); CTAs pull toward the cursor with an indigo glow on hover; the wordmark gets a periodic light sweep; on load the wordmark → subcopy → CTAs rise in.
- Keyboard: Tab reaches every control with a visible focus ring; Enter on `Sign up` → `/signup`, `Log in` → `/login`.
- OS "Reduce motion" on: no parallax/sweep/reveal, layout static, all links work.

Confirm at `/landing` while signed in (or temporarily stub auth): a single `Enter app` nav button + `Enter app` CTA, both → `/`.

- [ ] **Step 3: Final commit (if any manual fixes were made)**

```bash
git add -A
git commit -m "fix(landing): polish from manual verification"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** nav + hero CTAs (Tasks 5), `signedIn` routing (Tasks 5–6), parallax + reveal (Task 4), magnetic buttons (Task 2), light sweep + structure (Task 3), reduced-motion (Tasks 1/3/4), perf budget (no new server calls — Tasks 5–6 are pure presentation; existing `getUser()` only), tests incl. e2e (Tasks 5–7), full gate (Task 8). All covered.
- **API consistency:** `signedIn?: boolean` used identically in `MonolithHero`, `landing/page.tsx`, and both tests; `MagneticButton` props (`href`, `variant`, `size`) match call sites in Task 5; CSS class names (`page`, `nav`, `brand`, `brandMark`, `navActions`, `scene`, `vignette`, `glow`, `slab`, `wordmark`, `subcopy`, `ctas`) defined in Task 3 match consumers in Tasks 4–5.
- **No placeholders:** every code step is complete and runnable.
- **Insulated:** `src/app/page.tsx` logged-out branch (`<MonolithHero />`) and `src/app/page.test.tsx` (mocks `MonolithHero`) need no change — verified against current source.

```

```
