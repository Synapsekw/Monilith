# Mono Landing Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-shot, on-load landing animation on a throwaway `/landing-test` page where "mono" (a monochrome wisp) descends a rope from the light source, hooks the O in MONOLITH, pulls the hidden subtitle into view, and perches on the O.

**Architecture:** A Server Component route renders a client `MonoScene` that clones the hero layout (reusing `LightRays`). Pure helpers compute geometry (`measure.ts`) and the choreography (`sequence.ts`); a client overlay (`MonoLayer` + `MonoWisp`) draws the rope and character. Orchestration uses Motion (framer-motion v12, already in the repo) via `useAnimate()` + a sequence array, CSS Motion Path (`offsetPath`/`offsetDistance`) for the descent, and `pathLength` for the rope draw-on. Final state is the SSR/reduced-motion state; the animation is a client-only enhancement applied after `document.fonts.ready`.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, framer-motion v12.40.0 (`"framer-motion"` import), Vitest + Testing Library, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-18-mono-landing-animation-design.md`

---

## File structure

| File                                                | Responsibility                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/app/landing-test/page.tsx`                     | RSC route shell; always-dark; renders `<MonoScene/>`                      |
| `src/app/landing-test/page.test.tsx`                | route renders the scene                                                   |
| `src/components/landing/mono/measure.ts`            | pure geometry: rect→stage-space points, rope path string                  |
| `src/components/landing/mono/measure.test.ts`       | unit tests for geometry                                                   |
| `src/components/landing/mono/sequence.ts`           | pure choreography: builds the Motion sequence array                       |
| `src/components/landing/mono/sequence.test.ts`      | unit tests for sequence structure                                         |
| `src/components/landing/mono/mono-wisp.tsx`         | the wisp SVG character (`body`/`eyes`/`tail`/`glow`)                      |
| `src/components/landing/mono/mono-wisp.test.tsx`    | renders the named parts                                                   |
| `src/components/landing/mono/mono-layer.tsx`        | overlay: rope `<motion.path>` + positioned `.mono` div                    |
| `src/components/landing/mono/mono-scene.tsx`        | layout + refs + `useAnimate` orchestration + reduced-motion guard         |
| `src/components/landing/mono/mono-scene.test.tsx`   | reduced-motion / SSR-final-state / cleanup contract                       |
| `src/components/landing/mono/mono-scene.module.css` | stage / overlay / subtitle-mask / reduced-motion final state              |
| `e2e/landing-test.spec.ts`                          | Playwright smoke (loads, elements present, reduced-motion shows subtitle) |

All new files live under `src/components/landing/mono/` — production `/landing` is **not** touched.

---

## Task 1: Route shell `/landing-test`

**Files:**

- Create: `src/app/landing-test/page.tsx`
- Test: `src/app/landing-test/page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/landing-test/page.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/landing/mono/mono-scene", () => ({
  MonoScene: () => <div>mono-scene</div>,
}));

import LandingTestPage from "./page";

describe("LandingTestPage (/landing-test)", () => {
  it("renders the mono scene", () => {
    render(<LandingTestPage />);
    expect(screen.getByText("mono-scene")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/landing-test/page.test.tsx`
Expected: FAIL — cannot resolve `./page`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/app/landing-test/page.tsx
import { MonoScene } from "@/components/landing/mono/mono-scene";

/**
 * Throwaway experiment route for the "mono" on-load reveal animation. Always
 * dark, no auth derivation — CTAs are static placeholders. See
 * docs/superpowers/specs/2026-06-18-mono-landing-animation-design.md.
 */
export default function LandingTestPage() {
  return <MonoScene />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/landing-test/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/landing-test/page.tsx src/app/landing-test/page.test.tsx
git commit -m "feat(landing-test): route shell rendering MonoScene"
```

---

## Task 2: `measure.ts` — pure geometry

**Files:**

- Create: `src/components/landing/mono/measure.ts`
- Test: `src/components/landing/mono/measure.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/landing/mono/measure.test.ts
import { describe, expect, it } from "vitest";
import { topCenter, center, ropePath } from "./measure";

const stage = { left: 100, top: 50, width: 800, height: 600 };

describe("measure", () => {
  it("topCenter returns the top-middle of a rect in stage space", () => {
    const rect = { left: 300, top: 150, width: 40, height: 60 };
    expect(topCenter(rect, stage)).toEqual({ x: 300 - 100 + 20, y: 150 - 50 });
  });

  it("center returns the middle of a rect in stage space", () => {
    const rect = { left: 300, top: 150, width: 40, height: 60 };
    expect(center(rect, stage)).toEqual({ x: 220, y: 130 });
  });

  it("ropePath builds a cubic bezier from `from` to `to`", () => {
    const d = ropePath({ x: 400, y: 0 }, { x: 220, y: 130 });
    expect(d.startsWith("M 400,0 C ")).toBe(true);
    expect(d.endsWith("220,130")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/landing/mono/measure.test.ts`
Expected: FAIL — cannot resolve `./measure`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/landing/mono/measure.ts
export interface Point {
  x: number;
  y: number;
}

/** Subset of DOMRect we actually read (so tests can pass plain objects). */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Top-middle of `rect`, expressed relative to `stage`'s top-left corner. */
export function topCenter(rect: Rect, stage: Rect): Point {
  return {
    x: rect.left - stage.left + rect.width / 2,
    y: rect.top - stage.top,
  };
}

/** Middle of `rect`, expressed relative to `stage`'s top-left corner. */
export function center(rect: Rect, stage: Rect): Point {
  return {
    x: rect.left - stage.left + rect.width / 2,
    y: rect.top - stage.top + rect.height / 2,
  };
}

/**
 * A gentle cubic-bezier drape from `from` down to `to`. Control points sit at
 * the vertical midpoint, pulled slightly toward each end so the rope curves
 * rather than running dead straight.
 */
export function ropePath(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const midY = from.y + (to.y - from.y) * 0.5;
  const c1x = from.x + dx * 0.1;
  const c2x = to.x - dx * 0.1;
  return `M ${from.x},${from.y} C ${c1x},${midY} ${c2x},${midY} ${to.x},${to.y}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/landing/mono/measure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/mono/measure.ts src/components/landing/mono/measure.test.ts
git commit -m "feat(mono): pure geometry helpers (rect->stage-space + rope path)"
```

---

## Task 3: `sequence.ts` — pure choreography builder

**Files:**

- Create: `src/components/landing/mono/sequence.ts`
- Test: `src/components/landing/mono/sequence.test.ts`

The builder returns a Motion sequence array of `[selector, props, options]` segments. Selectors target elements inside the animation scope: `.rope`, `.mono`, `.subtitle`.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/landing/mono/sequence.test.ts
import { describe, expect, it } from "vitest";
import { buildSequence } from "./sequence";

describe("buildSequence", () => {
  const seq = buildSequence({ climbDistance: 120 });

  it("has the six choreography segments in order", () => {
    expect(seq).toHaveLength(6);
    expect(seq.map((s) => s[0])).toEqual([
      ".rope",
      ".mono",
      ".mono",
      ".mono",
      ".subtitle",
      ".mono",
    ]);
  });

  it("draws the rope on first via pathLength", () => {
    expect(seq[0][1]).toMatchObject({ pathLength: [0.001, 1] });
  });

  it("descends mono along the path in parallel with the rope draw", () => {
    expect(seq[1][1]).toMatchObject({ offsetDistance: ["0%", "100%"] });
    expect(seq[1][2]).toMatchObject({ at: "<" });
  });

  it("climbs by the measured distance then reveals the subtitle", () => {
    expect(seq[3][1]).toMatchObject({ y: [0, 120] });
    expect(seq[4][0]).toBe(".subtitle");
    expect(seq[4][1]).toMatchObject({ opacity: [0, 1] });
  });

  it("returns mono to the O to perch (y back to 0)", () => {
    expect(seq[5][1]).toMatchObject({ y: [120, 0] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/landing/mono/sequence.test.ts`
Expected: FAIL — cannot resolve `./sequence`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/landing/mono/sequence.ts

/** A single Motion sequence segment: [selector, keyframes, options?]. */
export type MonoSegment = [
  string,
  Record<string, unknown>,
  Record<string, unknown>?,
];
export type MonoSequence = MonoSegment[];

export interface SequenceInput {
  /** Vertical px from the O down to the subtitle line (mono's climb). */
  climbDistance: number;
}

/**
 * The six-beat reveal as a Motion sequence array. The rope draws on while mono
 * rides the (separately set) offsetPath down to the O; mono latches, climbs to
 * the subtitle, pulls it into view, then floats back to perch on the O.
 *
 * Note: `.mono`'s offsetPath is set imperatively on the element before this runs
 * (see mono-scene); here we only animate offsetDistance/transform keyframes.
 */
export function buildSequence({ climbDistance }: SequenceInput): MonoSequence {
  return [
    // 1+2. Born + descent: rope draws while mono rides the path down to the O.
    [".rope", { pathLength: [0.001, 1] }, { duration: 0.9, ease: "easeInOut" }],
    [
      ".mono",
      { offsetDistance: ["0%", "100%"], opacity: [0, 1] },
      { duration: 0.9, ease: "easeIn", at: "<" },
    ],
    // 3. Hook the O: small overshoot/settle.
    [".mono", { rotate: [0, -8, 0] }, { duration: 0.4, at: "+0.05" }],
    // 4. Lower to the subtitle line.
    [".mono", { y: [0, climbDistance] }, { duration: 0.7, ease: "easeIn" }],
    // 5. The pull: subtitle slides out from behind the wordmark.
    [
      ".subtitle",
      { opacity: [0, 1], y: [16, 0] },
      { duration: 0.6, ease: "easeOut", at: "-0.2" },
    ],
    // 6. Float back up and perch on the O.
    [".mono", { y: [climbDistance, 0] }, { duration: 0.6, ease: "easeOut" }],
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/landing/mono/sequence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/mono/sequence.ts src/components/landing/mono/sequence.test.ts
git commit -m "feat(mono): pure choreography sequence builder"
```

---

## Task 4: `MonoWisp` — the SVG character

**Files:**

- Create: `src/components/landing/mono/mono-wisp.tsx`
- Test: `src/components/landing/mono/mono-wisp.test.tsx`

Pure inline SVG, ~32px. Off-white body (`#f4f4f6`), indigo inner glow (`#bcc4ff`), two dot eyes, a wispy tail. Named via `data-part` so animation/styling can target parts later. This is the starting art — visual refinement happens by eye on the live page.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/landing/mono/mono-wisp.test.tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MonoWisp } from "./mono-wisp";

describe("MonoWisp", () => {
  it("renders the named animatable parts", () => {
    const { container } = render(
      <svg>
        <MonoWisp />
      </svg>,
    );
    expect(container.querySelector('[data-part="body"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-part="eye"]')).toHaveLength(2);
    expect(container.querySelector('[data-part="tail"]')).not.toBeNull();
    expect(container.querySelector('[data-part="glow"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/landing/mono/mono-wisp.test.tsx`
Expected: FAIL — cannot resolve `./mono-wisp`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/landing/mono/mono-wisp.tsx

/**
 * "mono" — a small monochrome wisp. Inline SVG group meant to be dropped inside
 * a parent <svg> or the .mono overlay element. Parts are tagged with `data-part`
 * so the scene can animate them. Drawn around a 32x36 box, origin top-center.
 */
export function MonoWisp() {
  return (
    <g aria-hidden>
      {/* soft glow behind the body */}
      <ellipse
        data-part="glow"
        cx="16"
        cy="16"
        rx="16"
        ry="16"
        fill="#bcc4ff"
        opacity="0.35"
      />
      {/* rounded body with a wispy tail merged into one path */}
      <path
        data-part="body"
        d="M16 2c-7 0-11 5-11 12 0 4 1 6 1 9 0 2-2 3-2 5 1 1 3-1 4-1s2 2 3 2 2-2 3-2 2 2 3 1 0-3 0-5c0-3 1-5 1-9 0-7-4-12-5-12z"
        fill="#f4f4f6"
      />
      {/* tail flourish (kept separate so it can curl/trail) */}
      <path
        data-part="tail"
        d="M11 26c2 2 4 2 5 2s3 0 5-2c-1 3-3 4-5 4s-4-1-5-4z"
        fill="#d7daf0"
      />
      <circle data-part="eye" cx="12" cy="14" r="1.6" fill="#0a0a0c" />
      <circle data-part="eye" cx="20" cy="14" r="1.6" fill="#0a0a0c" />
    </g>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/landing/mono/mono-wisp.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/mono/mono-wisp.tsx src/components/landing/mono/mono-wisp.test.tsx
git commit -m "feat(mono): wisp SVG character with named parts"
```

---

## Task 5: `MonoLayer` — rope + character overlay

**Files:**

- Create: `src/components/landing/mono/mono-layer.tsx`
- Test: `src/components/landing/mono/mono-layer.test.tsx`

An absolutely-positioned overlay containing the rope `<motion.path>` (in a full-bleed `<svg>` whose user units = px) and a positioned `.mono` div wrapping a 32px `<svg>` with `<MonoWisp/>`. `forwardRef` exposes the `.mono` div so the scene can set its `offsetPath`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/landing/mono/mono-layer.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// motion.path -> plain <path>; keep the className so queries work.
vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (props: any) => {
          const Tag = tag as keyof JSX.IntrinsicElements;
          return <Tag {...props} />;
        },
    },
  ),
}));

import { MonoLayer } from "./mono-layer";

describe("MonoLayer", () => {
  it("renders the rope path and the mono character", () => {
    const { container } = render(<MonoLayer />);
    expect(container.querySelector(".rope")).not.toBeNull();
    expect(container.querySelector(".mono")).not.toBeNull();
    expect(container.querySelector('[data-part="body"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/landing/mono/mono-layer.test.tsx`
Expected: FAIL — cannot resolve `./mono-layer`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/landing/mono/mono-layer.tsx
"use client";

import { forwardRef } from "react";
import { motion } from "framer-motion";
import { MonoWisp } from "./mono-wisp";
import styles from "./mono-scene.module.css";

/**
 * The animation overlay: a full-bleed SVG carrying the rope path (user units =
 * px, so the scene can feed it a pixel-space `d`) plus a positioned `.mono` div
 * that rides a CSS offsetPath. The `.mono` div is exposed via ref so the scene
 * can set `style.offsetPath` from measured coordinates.
 */
export const MonoLayer = forwardRef<HTMLDivElement>(function MonoLayer(_, ref) {
  return (
    <div className={styles.overlay} aria-hidden>
      <svg className={styles.ropeSvg} preserveAspectRatio="none">
        <motion.path
          className="rope"
          d=""
          fill="none"
          stroke="#bcc4ff"
          strokeWidth={1.5}
          strokeLinecap="round"
          pathLength={1}
        />
      </svg>
      <div ref={ref} className={`mono ${styles.mono}`}>
        <svg width="32" height="36" viewBox="0 0 32 36">
          <MonoWisp />
        </svg>
      </div>
    </div>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/landing/mono/mono-layer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/mono/mono-layer.tsx src/components/landing/mono/mono-layer.test.tsx
git commit -m "feat(mono): overlay layer with rope path + character"
```

---

## Task 6: `mono-scene.module.css` — stage, overlay, masks, reduced-motion

**Files:**

- Create: `src/components/landing/mono/mono-scene.module.css`

No unit test (CSS is exercised by the scene test + e2e). This task is structural setup for Task 7.

- [ ] **Step 1: Write the stylesheet**

```css
/* src/components/landing/mono/mono-scene.module.css */
.page {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  isolation: isolate;
  overflow: hidden;
  background: #06070c;
}

.stage {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  overflow: hidden;
}

.rays {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.source {
  position: absolute;
  top: -6%;
  left: 50%;
  z-index: 1;
  transform: translateX(-50%);
  width: min(560px, 70vw);
  height: 300px;
  pointer-events: none;
  filter: blur(50px);
  background: radial-gradient(
    ellipse at center,
    rgba(170, 180, 255, 0.35),
    transparent 70%
  );
}

.vignette {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: radial-gradient(
    130% 100% at 50% 30%,
    transparent 40%,
    rgba(6, 7, 12, 0.82) 100%
  );
}

.wordmark {
  position: relative;
  z-index: 5;
  font-size: clamp(40px, 9vw, 124px);
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.02em;
  color: #f4f4f6;
  text-shadow:
    0 4px 60px rgba(120, 130, 220, 0.35),
    0 4px 50px rgba(0, 0, 0, 0.6);
}

.subtitle {
  position: relative;
  z-index: 4;
  margin: 0;
  font-size: clamp(0.9rem, 1.4vw, 1.05rem);
  letter-spacing: 0.01em;
  color: #a1a1aa;
  text-align: center;
}

.ctas {
  position: relative;
  z-index: 5;
  margin-top: 1.25rem;
  display: inline-flex;
  gap: 0.75rem;
}

.cta {
  height: 2.75rem;
  padding: 0 1.75rem;
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  font-size: 0.9rem;
}

.ctaPrimary {
  background: #f4f4f6;
  color: #0a0a0c;
}

.ctaSecondary {
  border: 1px solid rgba(244, 244, 246, 0.4);
  color: #f4f4f6;
}

/* Animation overlay sits above the wordmark so mono reads as "in front". */
.overlay {
  position: absolute;
  inset: 0;
  z-index: 6;
  pointer-events: none;
}

.ropeSvg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.mono {
  position: absolute;
  top: 0;
  left: 0;
  width: 32px;
  height: 36px;
  margin-left: -16px; /* center on the offset point */
  margin-top: -4px;
  offset-rotate: 0deg;
  will-change: transform, offset-distance;
}

/* Reduced motion / SSR: land on the final result. Subtitle visible, no mono. */
@media (prefers-reduced-motion: reduce) {
  .mono,
  .ropeSvg {
    display: none;
  }
  .subtitle {
    opacity: 1;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/landing/mono/mono-scene.module.css
git commit -m "feat(mono): scene stylesheet (stage, overlay, reduced-motion final state)"
```

---

## Task 7: `MonoScene` — layout + orchestration

**Files:**

- Create: `src/components/landing/mono/mono-scene.tsx`
- Test: `src/components/landing/mono/mono-scene.test.tsx`

The client centerpiece: renders the hero clone (LightRays, wordmark with the **2nd O** ref'd, hidden subtitle, static CTAs, `MonoLayer`), measures anchors after `document.fonts.ready`, and runs the sequence. Contract under test: (a) renders the final state for SSR/no-DOM (subtitle text present), (b) under reduced motion it does **not** call `animate`, (c) with motion it **does** call `animate`, (d) it stops the controls on unmount.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/landing/mono/mono-scene.test.tsx
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const reduced = { value: false };
const stop = vi.fn();
const animate = vi.fn(() => ({ stop }));
vi.mock("framer-motion", () => ({
  useReducedMotion: () => reduced.value,
  useAnimate: () => [{ current: document.createElement("div") }, animate],
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (props: any) => {
          const Tag = tag as keyof JSX.IntrinsicElements;
          return <Tag {...props} />;
        },
    },
  ),
}));
// LightRays pulls in ogl/WebGL; stub it to a plain node here.
vi.mock("@/components/landing/light-rays", () => ({
  LightRays: () => <div data-testid="rays" />,
}));

import { MonoScene } from "./mono-scene";

beforeEach(() => {
  reduced.value = false;
  animate.mockClear();
  stop.mockClear();
  // jsdom lacks document.fonts; provide a resolved ready promise.
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
});
afterEach(() => {
  reduced.value = false;
});

describe("MonoScene", () => {
  it("renders the hero content (final state) for SSR", () => {
    render(<MonoScene />);
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
    expect(
      screen.getByText("The only work surface you need."),
    ).toBeInTheDocument();
  });

  it("runs the animation when motion is allowed", async () => {
    render(<MonoScene />);
    await waitFor(() => expect(animate).toHaveBeenCalled());
  });

  it("does not animate under reduced motion", async () => {
    reduced.value = true;
    render(<MonoScene />);
    // give any async effect a chance to (not) fire
    await new Promise((r) => setTimeout(r, 0));
    expect(animate).not.toHaveBeenCalled();
  });

  it("stops the animation on unmount", async () => {
    const view = render(<MonoScene />);
    await waitFor(() => expect(animate).toHaveBeenCalled());
    view.unmount();
    expect(stop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/landing/mono/mono-scene.test.tsx`
Expected: FAIL — cannot resolve `./mono-scene`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/landing/mono/mono-scene.tsx
"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useAnimate, useReducedMotion } from "framer-motion";
import { nunito } from "@/lib/fonts";
import { LightRays } from "@/components/landing/light-rays";
import { MonoLayer } from "./mono-layer";
import { buildSequence } from "./sequence";
import { topCenter, center, ropePath } from "./measure";
import styles from "./mono-scene.module.css";

/**
 * Test-page centerpiece. Renders the hero clone in its FINAL state (so SSR and
 * the first client paint are correct and reduced-motion needs no JS), then —
 * only when motion is allowed — hides the animated bits before paint and plays
 * the mono reveal after the webfont has settled.
 */
export function MonoScene() {
  const reduce = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const oRef = useRef<HTMLSpanElement>(null);
  const sourceRef = useRef<HTMLSpanElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const monoRef = useRef<HTMLDivElement>(null);

  // Hide the animated elements before first paint so we don't flash the final
  // state, then snap them back via the sequence's `[from, to]` keyframes.
  useLayoutEffect(() => {
    if (reduce) return;
    const sub = subtitleRef.current;
    const mono = monoRef.current;
    if (sub) sub.style.opacity = "0";
    if (mono) mono.style.opacity = "0";
  }, [reduce]);

  useEffect(() => {
    if (reduce) return;
    let cancelled = false;
    let controls: { stop: () => void } | undefined;
    (async () => {
      await document.fonts?.ready;
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled || !scope.current) return;
        const stage = scope.current.getBoundingClientRect();
        const o = oRef.current?.getBoundingClientRect();
        const source = sourceRef.current?.getBoundingClientRect();
        const sub = subtitleRef.current?.getBoundingClientRect();
        if (!o || !source || !sub) return;

        const from = topCenter(source, stage);
        const to = topCenter(o, stage);
        const d = ropePath(from, to);
        const climb = center(sub, stage).y - center(o, stage).y;

        const rope = scope.current.querySelector(".rope");
        rope?.setAttribute("d", d);
        if (monoRef.current) monoRef.current.style.offsetPath = `path('${d}')`;

        controls = animate(
          buildSequence({ climbDistance: climb }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ) as any;
      });
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [reduce, animate, scope]);

  return (
    <div className={styles.page}>
      <div ref={scope} className={styles.stage}>
        <LightRays className={styles.rays} />
        <span ref={sourceRef} className={styles.source} aria-hidden />
        <span className={styles.vignette} aria-hidden />
        <span className={`${styles.wordmark} ${nunito.className}`}>
          MON<span ref={oRef}>O</span>LITH
        </span>
        <p ref={subtitleRef} className={`subtitle ${styles.subtitle}`}>
          The only work surface you need.
        </p>
        <div className={styles.ctas}>
          <a href="/signup" className={`${styles.cta} ${styles.ctaPrimary}`}>
            Get started
          </a>
          <a href="/login" className={`${styles.cta} ${styles.ctaSecondary}`}>
            Sign in
          </a>
        </div>
        <MonoLayer ref={monoRef} />
      </div>
    </div>
  );
}
```

Note on typing the `animate(...)` call: framer-motion v12 may not re-export an `AnimationSequence` type cleanly (the repo already defines `Variants` locally for this reason in `monolith-scene.tsx`). The `as any` on the sequence argument is the pragmatic, localized escape hatch; if `AnimationSequence` is importable, prefer `animate(buildSequence({ climbDistance: climb }) as AnimationSequence)` and drop the eslint-disable.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/landing/mono/mono-scene.test.tsx`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/mono/mono-scene.tsx src/components/landing/mono/mono-scene.test.tsx
git commit -m "feat(mono): scene layout + useAnimate orchestration"
```

---

## Task 8: Playwright smoke test

**Files:**

- Create: `e2e/landing-test.spec.ts`

Check the route renders and the reduced-motion final state shows the subtitle. (Match the structure of the existing `e2e/` specs — adjust the import/helper to whatever `e2e/` already uses; do not assume auth.)

- [ ] **Step 1: Write the test**

```ts
// e2e/landing-test.spec.ts
import { test, expect } from "@playwright/test";

test.describe("/landing-test mono reveal", () => {
  test("renders the hero with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto("/landing-test");
    await expect(page.getByText("MONOLITH")).toBeVisible();
    await expect(page.getByText("The only work surface you need.")).toBeVisible(
      {
        timeout: 6000,
      },
    );
    expect(errors).toEqual([]);
  });

  test("shows the subtitle immediately under reduced motion", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/landing-test");
    await expect(
      page.getByText("The only work surface you need."),
    ).toBeVisible();
    await ctx.close();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm e2e e2e/landing-test.spec.ts` (or the repo's e2e invocation)
Expected: PASS — both cases. If the dev/preview server isn't auto-started by the e2e config, start it per the repo's existing e2e workflow.

- [ ] **Step 3: Commit**

```bash
git add e2e/landing-test.spec.ts
git commit -m "test(mono): e2e smoke for /landing-test + reduced-motion"
```

---

## Task 9: Full verification gate + live review

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green. Fix any failures before proceeding (do not claim done on red).

- [ ] **Step 2: Live review (the real acceptance)**

Start the dev server and open `/landing-test`. Watch the full sequence: mono born from the light → descends the rope → hooks the 2nd O → lowers to the subtitle → pulls it into view → perches on the O. Confirm: no FOUC of the subtitle before the pull, the rope lands on the O (not fallback-font position), and the OS "reduce motion" setting skips straight to the final state with the subtitle visible.

- [ ] **Step 3: Tune by eye (no architecture change)**

Adjust durations/easings in `sequence.ts`, the wisp art in `mono-wisp.tsx`, and rope curve constants in `measure.ts` until it feels right. Re-run `pnpm test` after edits (sequence structure assertions must still hold; loosen them only if you intentionally change the beat count).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "polish(mono): tune timings + wisp art after live review"
```

---

## Self-review notes (author)

- **Spec coverage:** route §3 → Task 1/7; wisp §4 → Task 4; 6 beats §5 → Task 3 (+7 wiring); technique §6 (useAnimate sequence, offsetPath/offsetDistance, pathLength, anchoring via fonts.ready→rAF→measure, reduced-motion/SSR) → Tasks 2/3/6/7; components §7 → Tasks 1–7; perf §8 → inherent (static page, Task 1); testing §9 → Tasks 2/3/4/5/7/8.
- **Idle perch loop** (spec §5 tail) is intentionally deferred to live tuning (Task 9) — it's a cosmetic add-on, not load-bearing, and keeps the first build focused.
- **2nd-vs-1st O** is wired to the 2nd O in Task 7; switching is a one-line ref move during Task 9 if center math prefers the other.
- **Type escape hatch:** the `animate(... as any)` in Task 7 mirrors the repo's existing local-type workaround for framer-motion v12; documented inline.
