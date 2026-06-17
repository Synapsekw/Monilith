# MONOLITH Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal public landing page at `/` — an animated MONOLITH wordmark over a cleaved, floating monolith with an Ice-colored column-shaft glow; the whole hero links to `/login`.

**Architecture:** A pure Server Component (`MonolithHero`) wrapped in a Next.js `<Link href="/login">`, styled by a co-located CSS module (CSS-only animation + hover affordance + reduced-motion off-switch). The root `src/app/page.tsx` switches from `requireUser()` to `getUser()`: logged-out visitors get the landing; logged-in users keep today's redirect behavior unchanged.

**Tech Stack:** Next.js 16 (App Router, RSC), `next/font/google` (Archivo), CSS Modules, Vitest + React Testing Library.

---

## File Structure

- **Create** `src/components/landing/monolith-hero.tsx` — the Server Component hero (link, layers, wordmark, cue).
- **Create** `src/components/landing/monolith-hero.module.css` — landing-only keyframes/shapes/glow/reduced-motion.
- **Create** `src/components/landing/monolith-hero.test.tsx` — unit tests for the hero.
- **Modify** `src/app/page.tsx` — route logged-out visitors to the landing; keep authed branch as-is.
- **Create** `src/app/page.test.tsx` — branch tests for the root route.

Locked visual values (from the approved mockup, dark-first palette):

- Base `#0d0d0f`, wordmark `#f4f4f6`, cue `#a1a1aa`, hover glow indigo `#6366f1`.
- Ice glow gradient stops: `rgba(186,200,255,…)` → `rgba(224,231,255,.2)`.
- Slab: `clip-path: polygon(0 11%, 100% 0, 100% 100%, 0 100%)` (cleaved top), `float` 6.5s.
- Glow: vertical shaft, `shaft` 7s.

---

## Task 1: MonolithHero component

**Files:**

- Create: `src/components/landing/monolith-hero.tsx`
- Create: `src/components/landing/monolith-hero.module.css`
- Test: `src/components/landing/monolith-hero.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/landing/monolith-hero.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonolithHero } from "./monolith-hero";

// next/font requires the Next build loader; stub it for the jsdom test env.
vi.mock("next/font/google", () => ({
  Archivo: () => ({ className: "font-archivo", variable: "", style: {} }),
}));

// next/link needs the app-router context in Next 16; render a plain anchor instead.
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

  it("links the hero to /login", () => {
    render(<MonolithHero />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/login");
  });

  it("shows the click-to-enter cue", () => {
    render(<MonolithHero />);
    expect(screen.getByText("Click to enter")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/landing/monolith-hero.test.tsx`
Expected: FAIL — cannot resolve `./monolith-hero` (module does not exist yet).

- [ ] **Step 3: Write the CSS module**

Create `src/components/landing/monolith-hero.module.css`:

```css
.hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;
  isolation: isolate;
  overflow: hidden;
  background: #0d0d0f;
  cursor: pointer;
  text-decoration: none;
}

.vignette {
  position: absolute;
  inset: 0;
  z-index: 0;
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
  transition:
    letter-spacing 0.6s ease,
    text-shadow 0.6s ease;
}

.enter {
  position: absolute;
  z-index: 5;
  bottom: 13%;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: #a1a1aa;
  opacity: 0;
  transition: opacity 0.5s ease;
}

.hero:hover .enter,
.hero:focus-visible .enter {
  opacity: 0.85;
}

.hero:hover .wordmark {
  letter-spacing: 0.05em;
  text-shadow: 0 4px 60px rgba(99, 102, 241, 0.35);
}

.hero:focus-visible {
  outline: 2px solid #6366f1;
  outline-offset: -4px;
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

@media (prefers-reduced-motion: reduce) {
  .glow,
  .slab {
    animation: none;
  }
}
```

- [ ] **Step 4: Write the component**

Create `src/components/landing/monolith-hero.tsx`:

```tsx
import Link from "next/link";
import { Archivo } from "next/font/google";
import styles from "./monolith-hero.module.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["800"],
  display: "swap",
});

/**
 * Public landing hero. Pure Server Component: CSS-only animation + hover
 * affordance, the whole surface is a single navigation to /login. No client JS.
 */
export function MonolithHero() {
  return (
    <Link href="/login" className={styles.hero}>
      <span className={styles.vignette} aria-hidden />
      <span className={styles.glow} aria-hidden />
      <span className={styles.slab} aria-hidden />
      <span className={`${styles.wordmark} ${archivo.className}`}>
        MONOLITH
      </span>
      <span className={styles.enter} aria-hidden>
        Click to enter
      </span>
    </Link>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- src/components/landing/monolith-hero.test.tsx`
Expected: PASS — 3 passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/monolith-hero.tsx src/components/landing/monolith-hero.module.css src/components/landing/monolith-hero.test.tsx
git commit -m "feat(landing): add MONOLITH hero component"
```

---

## Task 2: Wire the landing into the root route

**Files:**

- Modify: `src/app/page.tsx`
- Test: `src/app/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/page.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getUser, getUserOrgs, listBoards, redirect } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserOrgs: vi.fn(),
  listBoards: vi.fn(),
  // Real next/navigation redirect() throws to halt rendering — mirror that.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUser(),
  getUserOrgs: () => getUserOrgs(),
}));
vi.mock("@/lib/boards/queries", () => ({ listBoards: () => listBoards() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: async () => ({ data: [] }) }),
  }),
}));
vi.mock("@/components/landing/monolith-hero", () => ({
  MonolithHero: () => <a href="/login">MONOLITH</a>,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import Home from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Home (root route)", () => {
  it("renders the landing for logged-out visitors", async () => {
    getUser.mockResolvedValue(null);

    render(await Home());

    expect(screen.getByRole("link")).toHaveAttribute("href", "/login");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects a logged-in user with a board to that board", async () => {
    getUser.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      user_metadata: {},
    });
    getUserOrgs.mockResolvedValue([{ id: "o1", name: "Acme" }]);
    listBoards.mockResolvedValue([{ id: "b1" }]);

    await expect(Home()).rejects.toThrow("REDIRECT:/boards/b1");
    expect(redirect).toHaveBeenCalledWith("/boards/b1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/app/page.test.tsx`
Expected: FAIL — the logged-out case currently bounces through `requireUser()`/`redirect` instead of rendering the hero link (no `/login` link rendered; or redirect called).

- [ ] **Step 3: Modify the page**

Edit `src/app/page.tsx`. Change the import line

```tsx
import { getUserOrgs, requireUser } from "@/lib/auth/session";
```

to

```tsx
import { MonolithHero } from "@/components/landing/monolith-hero";
import { getUser, getUserOrgs } from "@/lib/auth/session";
```

Then replace the opening of the function

```tsx
export default async function Home() {
  const user = await requireUser();

  const orgs = await getUserOrgs();
```

with

```tsx
export default async function Home() {
  const user = await getUser();
  if (!user) return <MonolithHero />;

  const orgs = await getUserOrgs();
```

Leave the rest of the function (orgs/onboarding redirect, boards redirect, workspaces query, `AppShell` return) exactly as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/app/page.test.tsx`
Expected: PASS — 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/page.test.tsx
git commit -m "feat(landing): serve MONOLITH landing at public root"
```

---

## Task 3: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — no errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS — no errors.

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: PASS — all suites, including the two new files.

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: PASS — `/` builds as a static/server route with no errors.

- [ ] **Step 5: Manual visual check**

Run: `pnpm dev`, open `http://localhost:3000` while logged out.
Verify: MONOLITH wordmark centered on near-black; cleaved slab floating with the Ice column shaft breathing behind it; hovering opens the wordmark spacing + reveals "Click to enter"; clicking navigates to `/login`. Toggle OS "reduce motion" and confirm the animation stops.

- [ ] **Step 6: Commit (only if any fix-ups were needed)**

```bash
git add -A
git commit -m "chore(landing): verification fix-ups"
```

---

## Self-Review

- **Spec coverage:** route change (Task 2) ✓; click→/login (Task 1) ✓; Archivo wordmark + Cleaved slab + Ice Column glow + vignette (Task 1 CSS) ✓; hover affordance (Task 1 CSS) ✓; reduced-motion off-switch (Task 1 CSS) ✓; zero-JS Server Component (Task 1) ✓; tests for hero + root branches (Tasks 1–2) ✓; verification gate (Task 3) ✓.
- **Placeholders:** none — full code in every step.
- **Type/name consistency:** `MonolithHero` used identically in component, page, and both test mocks; CSS class names (`hero`, `vignette`, `glow`, `slab`, `wordmark`, `enter`) match between the module and the component.
