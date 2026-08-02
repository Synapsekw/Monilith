# Keystone Wash & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Monolith's flat near-black shell with a periwinkle-tinted gradient wash, invert the surface model so content becomes an inset card floating on that wash, and adopt the interaction/typography/motion mechanics behind the "clean and responsive" read.

**Architecture:** One CSS token layer carries everything new (`--app-wash`, `--app-bloom`, `--content-edge`, `--content-lift`, `--state-*`, `--duration-*`, `--text-2xs/3xs`). The app shell root paints the wash; the sidebar and header stop painting anything and show it through; `<main>` becomes the one opaque card, separated by a gutter rather than a border. Everything downstream (state tokens, type scale, borders) consumes that layer. No data flow, server action, or schema is touched.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (`@theme` / `@theme inline` in `src/app/globals.css`), shadcn primitives, Vitest + Testing Library, Node `.mjs` tooling scripts.

**Spec:** `docs/superpowers/specs/2026-08-02-keystone-wash-and-polish-design.md` (approved 2026-08-02, direction **B · Periwinkle Dusk**).

## Global Constraints

- **Tailwind v4 token registration is mandatory.** A raw custom property in `:root`/`.dark` produces **no** utility class. Colors must also be declared in `@theme inline` under `--color-*`, shadows under `--shadow-*`, font sizes in `@theme` under `--text-*`. Adding a token without its `@theme` entry is the single most likely failure in this plan.
- **`--background` is not edited, and is NOT the content card.** Its real values are `#0e0e10` (dark) / `#f6f6f8` (light) — the light one is a warm grey, not white. The approved preview's content card is **white** in light and `#0e0e10` in dark, and no existing token carries that pair (`--surface` is `#ffffff`/`#161619` — right in light, too light in dark). So the card gets its own token, `--content-surface`. Leave `--background` alone; the 29 files using `bg-background` keep their current meaning.
- **The content card stays neutral.** Only chrome is tinted. Never apply `--app-wash` to `<main>` or to any content surface.
- **The wash is scoped to the app shell, NOT `body`.** The marketing/landing route is an explicit non-goal and already has its own page-wide wash; painting `body` would leak into it. (This supersedes the spec's "`body` paints the wash" line — same architecture, correct scope.)
- **Both themes, every time.** Every token added to `.dark` gets a `:root` counterpart in the same commit. Task 1's parity test enforces this.
- **Keystone rules that still hold:** hairlines brighten, never thicken. `--elevation-card: none` stays. Exactly one accent hue in the product.
- **Commit identity is pinned** to `Danijel Jovanovic <info@synapse-solutions.ai>`. Commit subjects are **lowercase** after `type(scope):` or husky's commitlint rejects them, and every commit needs a body plus the `Co-Authored-By` trailer.
- **Stage explicitly by path.** Never `git add -A` / `git add .` / `git commit -a` — this repo runs concurrent sessions against one checkout and a bare `git commit` sweeps in their staged work.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must pass before `scripts/finish-task.sh`.

## Execution DAG (working agreement #6)

**Dependency graph**

- Task 1 (token layer) — no dependencies
- Task 2 (cheap polish) — no dependencies
- Task 3 (shell inversion) — depends on Task 1
- Task 4 (state-token migration) — depends on Task 1
- Task 5 (type scale + migration) — depends on Task 1
- Task 6 (px-text CI guard) — depends on Task 5
- Task 7 (border restraint) — depends on Task 3

**Parallel batches**

| Batch | Tasks                      | Notes                                                                                                                                                                                                                                  |
| ----- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Task 1, Task 2**         | Task 2 touches only `@layer base` rules; Task 1 touches only token blocks. Same file, disjoint regions — run them sequentially in one worktree if the agent is uncomfortable with the overlap, otherwise parallel with a rebase.       |
| 2     | **Task 3, Task 4, Task 5** | Fully disjoint file sets: Task 3 = 2 shell components, Task 4 = 49 files' hover classes, Task 5 = 48 files' text classes. Task 4 and Task 5 overlap in _files_ but never in _tokens_ — if run in parallel, give each its own worktree. |
| 3     | **Task 6, Task 7**         | Independent of each other.                                                                                                                                                                                                             |

**Critical path:** Task 1 → Task 5 → Task 6. Task 5 is the long pole (130 edit sites across 48 files) and it also gates the CI guard, so start it the moment Task 1 lands.

## Performance & data-fetching budget (working agreement #5)

**(a) First paint vs. interaction.** First paint gains two CSS gradients and a handful of custom properties — no requests, no JS, no images. The shell is already prerendered as part of the Cache Components shell, and every token lives in the stylesheet that ships with it. Interactions cost **0 new server round-trips**: nothing in this plan reads or writes server data, and no in-page toggle is added.

**(b) Does any interaction change server data?** No. Every state introduced here is CSS (`:hover`, `:focus-within`) or existing client state (the Zustand sidebar-collapse flag, unchanged). No Server Action, no revalidation, no `<Link>`/router navigation is introduced — so working agreement #5's RSC-refetch trap is not in play.

**(c) Is the hot-path read bounded?** Unchanged — no query, index, or pagination boundary is touched by any task.

**Paint cost, specifically.** The wash goes on the AppShell root, which is `h-svh overflow-hidden` with scrolling confined to `<main>`. The gradient is therefore painted once and never repaints on scroll. `background-attachment: fixed` is safe here for the same reason — the element does not scroll. This is the reason the wash is not on `body`, beyond the landing-page scoping: a scrolling body with a fixed gradient is the classic scroll-jank pattern, and this structure avoids it by construction. If Task 3's manual pass shows any scroll stutter on a large board, drop `background-attachment: fixed` first — it is the only line here with a paint cost.

**Motion tokens.** Task 1 declares the scale and Task 2 is its first consumer (the scrollbar-thumb transition). Existing inline durations elsewhere are deliberately **not** migrated in this plan — that is a mechanical sweep with no visual payoff, and folding it in would inflate the highest-risk batch. The tokens are the contract for new work.

## File Structure

| File                                           | Responsibility                                                                         | Task    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- | ------- |
| `src/app/globals.css`                          | All new tokens + `@theme` registration; the `.app-wash` class; base-layer polish rules | 1, 2, 3 |
| `src/app/globals.tokens.test.ts`               | **Create.** Light/dark token parity + presence contract                                | 1, 2    |
| `src/components/app-shell.tsx`                 | Wash root, transparent header, inset `<main>` card                                     | 3, 7    |
| `src/components/sidebar.tsx`                   | Drops its own fill and right border                                                    | 3, 7    |
| `src/components/app-shell.test.tsx`            | Extended with surface-model assertions                                                 | 3       |
| `src/components/sidebar.test.tsx`              | Extended with "paints nothing" assertion                                               | 3       |
| `scripts/check-hover-tokens.mjs` + `.test.mjs` | **Create.** Guards the state-token migration                                           | 4       |
| `scripts/check-px-text.mjs` + `.test.mjs`      | **Create.** Guards the type-scale migration                                            | 6       |
| `package.json`                                 | `lint` wired to run both guards                                                        | 4, 6    |
| ~48–49 feature `.tsx` files                    | Mechanical class swaps only                                                            | 4, 5    |

---

### Task 1: Token layer — Periwinkle Dusk

**Files:**

- Modify: `src/app/globals.css` (the `@theme inline` block ~line 18-100, `:root` ~line 135-211, `.dark` ~line 213-292)
- Test: `src/app/globals.tokens.test.ts` (create)

**Interfaces:**

- Consumes: nothing.
- Produces — every later task depends on these exact names:
  - Utility classes: `bg-state-hover`, `bg-state-active`, `bg-state-selected`, `border-content-edge`, `shadow-content-lift`, `text-2xs`, `text-3xs`
  - Raw custom properties: `--app-wash`, `--app-bloom`, `--content-edge`, `--content-lift`, `--state-hover`, `--state-active`, `--state-selected`, `--duration-instant`, `--duration-fast`, `--duration-standard`, `--duration-arrival`, `--ease-standard`
  - `tokensIn(selector: string): Set<string>` is **local to `globals.tokens.test.ts`** — Task 2 extends that same file and reuses it; nothing else imports it.

- [ ] **Step 1: Write the failing test**

Create `src/app/globals.tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** Extract the custom-property names declared inside a top-level block. */
function tokensIn(selector: string): Set<string> {
  // Match `selector {` up to the matching close at column 0 (`\n}`).
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const end = CSS.indexOf("\n}", start);
  const body = CSS.slice(start, end);
  return new Set(
    [...body.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]),
  );
}

const NEW_TOKENS = [
  "--app-wash",
  "--app-bloom",
  "--content-surface",
  "--content-edge",
  "--content-lift",
  "--state-hover",
  "--state-active",
  "--state-selected",
];

/**
 * Tokens deliberately declared once in `:root` because they do not vary by
 * theme. `--radius` is the only pre-existing one; keep this list short and
 * justified — it is the escape hatch that could hide a real parity bug.
 */
const THEME_INVARIANT = new Set(["--radius"]);

describe("Keystone token contract", () => {
  it("declares every wash/state token in both themes", () => {
    const root = tokensIn(":root");
    const dark = tokensIn(".dark");
    for (const token of NEW_TOKENS) {
      expect(root, `${token} missing from :root`).toContain(token);
      expect(dark, `${token} missing from .dark`).toContain(token);
    }
  });

  it("keeps light and dark palettes at parity", () => {
    const root = tokensIn(":root");
    const dark = tokensIn(".dark");
    const onlyLight = [...root].filter(
      (t) => !dark.has(t) && !THEME_INVARIANT.has(t),
    );
    const onlyDark = [...dark].filter(
      (t) => !root.has(t) && !THEME_INVARIANT.has(t),
    );
    expect({ onlyLight, onlyDark }).toEqual({ onlyLight: [], onlyDark: [] });
  });

  it("registers the tokens Tailwind needs to emit utilities", () => {
    for (const entry of [
      "--color-state-hover:",
      "--color-state-active:",
      "--color-state-selected:",
      "--color-content-surface:",
      "--color-content-edge:",
      "--shadow-content-lift:",
      "--text-2xs:",
      "--text-3xs:",
    ]) {
      expect(CSS, `${entry} not registered in @theme`).toContain(entry);
    }
  });

  it("declares the named motion scale", () => {
    for (const d of [
      "--duration-instant: 120ms",
      "--duration-fast: 180ms",
      "--duration-standard: 240ms",
      "--duration-arrival: 500ms",
      "--ease-standard: cubic-bezier(0.25, 1, 0.5, 1)",
    ]) {
      expect(CSS).toContain(d);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/globals.tokens.test.ts`
Expected: FAIL — `--app-wash missing from :root`.

Note on the parity test: there is exactly one pre-existing asymmetry in `globals.css` — `--radius` is declared in `:root` (line 199) and not in `.dark`, which is correct because radius does not vary by theme. That is why `THEME_INVARIANT` exists. If any _other_ asymmetry surfaces, it is a genuine bug — fix it in this task rather than widening the invariant list.

- [ ] **Step 3: Add the theme registration**

In `src/app/globals.css`, inside the existing `@theme inline { … }` block, after the `/* Keystone additions */` group (~line 34):

```css
/* Wash & inset-card surfaces */
--color-content-surface: var(--content-surface);
--color-content-edge: var(--content-edge);
--shadow-content-lift: var(--content-lift);

/* Alpha-on-parent interaction states */
--color-state-hover: var(--state-hover);
--color-state-active: var(--state-active);
--color-state-selected: var(--state-selected);

/* Named motion scale (durations are literal — not aliases) */
--duration-instant: 120ms;
--duration-fast: 180ms;
--duration-standard: 240ms;
--duration-arrival: 500ms;
--ease-standard: cubic-bezier(0.25, 1, 0.5, 1);

/* The two missing small type steps */
--text-3xs: 0.625rem; /* 10px */
--text-2xs: 0.6875rem; /* 11px */
```

- [ ] **Step 4: Add the light-theme tokens**

In `:root`, immediately after `--glow-primary: …;` (~line 166):

```css
/* Periwinkle Dusk — light. Chrome only; content stays neutral. */
--app-wash: linear-gradient(168deg, #eef0f8 0%, #e6e9f3 46%, #d9dce8 100%);
--app-bloom: radial-gradient(
  110% 85% at 8% -6%,
  rgb(255 255 255 / 65%) 0%,
  transparent 58%
);
--content-surface: #ffffff;
--content-edge: rgb(0 0 0 / 7%);
--content-lift:
  -1px -1px 0 0 rgb(30 40 90 / 8%), 0 1px 3px 0 rgb(30 40 90 / 8%);

--state-hover: rgb(0 0 0 / 4%);
--state-active: rgb(0 0 0 / 7%);
--state-selected: color-mix(in oklab, var(--brand) 12%, transparent);
```

- [ ] **Step 5: Add the dark-theme tokens**

In `.dark`, immediately after `--glow-primary: …;` (~line 251):

```css
/* Periwinkle Dusk — dark. Chrome only; content stays neutral. */
--app-wash: linear-gradient(168deg, #212540 0%, #141728 46%, #08090d 100%);
--app-bloom: radial-gradient(
  110% 85% at 8% -6%,
  color-mix(in oklab, var(--brand) 22%, transparent) 0%,
  transparent 58%
);
--content-surface: #0e0e10;
--content-edge: rgb(255 255 255 / 8%);
--content-lift:
  inset 0 1px 0 0 rgb(255 255 255 / 5%), 0 8px 24px -12px rgb(0 0 0 / 60%);

--state-hover: rgb(255 255 255 / 5%);
--state-active: rgb(255 255 255 / 9%);
--state-selected: color-mix(in oklab, var(--brand) 14%, transparent);
```

- [ ] **Step 6: Retire the sidebar fills to transparent**

Still in `globals.css`, change `--sidebar` and `--sidebar-border` in **both** blocks so any component still referencing them degrades to "shows the wash" rather than punching a hole in it:

```css
/* :root */
--sidebar: transparent;
--sidebar-border: transparent;

/* .dark */
--sidebar: transparent;
--sidebar-border: transparent;
```

Leave `--sidebar-foreground`, `--sidebar-primary*`, `--sidebar-accent*` and `--sidebar-ring` untouched.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run src/app/globals.tokens.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Prove the registration actually produces utilities**

Tailwind only emits a utility that something _uses_, and no component uses these until Tasks 3–5. So grepping the build output now proves nothing. Force one use instead:

```bash
printf 'export const Probe = () => <div className="bg-state-hover text-2xs border-content-edge shadow-content-lift" />;\n' > src/components/__probe.tsx
pnpm build
grep -c "state-hover" .next/static/css/*.css
rm src/components/__probe.tsx
```

Expected: the grep reports **≥1**. If it reports 0, the `@theme inline` registration in Step 3 is wrong — a raw custom property alone emits no class. Fix it before committing, and make sure the probe file is deleted (it must not be staged).

- [ ] **Step 9: Commit**

```bash
git add src/app/globals.css src/app/globals.tokens.test.ts
git commit -F - <<'EOF'
feat(design): add the periwinkle dusk token layer

Introduces the wash, bloom, inset-card edge/lift, alpha-on-parent
interaction states, the named motion scale and the two missing small
type steps, in both themes, with the @theme registration Tailwind needs
to emit utilities for them.

Retires --sidebar/--sidebar-border to transparent so any component still
referencing them shows the wash instead of punching a hole in it.

Adds a token-contract test that pins light/dark parity -- adding a token
to one theme only is the failure mode this layer is most prone to.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Cheap polish — cursor, scrollbars, overscroll

**Files:**

- Modify: `src/app/globals.css` (`@layer base`, ~line 294-346)
- Test: `src/app/globals.tokens.test.ts` (extend)

**Interfaces:**

- Consumes: nothing. Independent of Task 1 — different region of the same file.
- Produces: no new names. Behavioral only.

- [ ] **Step 1: Write the failing test**

Append to `src/app/globals.tokens.test.ts`:

```ts
describe("base-layer polish", () => {
  it("restores the pointer cursor on interactive elements", () => {
    expect(CSS).toMatch(/button:not\(:disabled\)/);
    expect(CSS).toContain("cursor: pointer");
  });

  it("contains overscroll on both axes, not just x", () => {
    expect(CSS).toContain("overscroll-behavior: none");
    expect(CSS).not.toContain("overscroll-behavior-x: none");
  });

  it("reserves the scrollbar gutter so lists do not shift at the overflow threshold", () => {
    expect(CSS).toContain("scrollbar-gutter: stable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/globals.tokens.test.ts -t "base-layer polish"`
Expected: FAIL — no `cursor: pointer` base rule.

- [ ] **Step 3: Replace the axis-limited overscroll rule**

In `@layer base`, the `html` rule currently ends with `overscroll-behavior-x: none;` (~line 307). Replace that one declaration, keeping the surrounding comment intact and extending it:

```css
html {
  @apply font-sans;
  /* Disable the macOS trackpad two-finger swipe → browser back/forward
       gesture. Pulse is an app-like surface with horizontally scrolling boards;
       an accidental horizontal overscroll must not navigate away from the
       current board. Keyboard/back-button history navigation still works.
       Both axes: vertical rubber-banding otherwise escapes the app frame and
       reveals the browser canvas behind the wash. */
  overscroll-behavior: none;
}
```

- [ ] **Step 4: Add the pointer-cursor rule**

Add to `@layer base`, after the `html` rule:

```css
/* Interactive elements get the pointer cursor. Tailwind's preflight leaves
     buttons on the default arrow and the product only set this ad hoc in 13
     files, so most of the app showed a text caret over its own controls. */
button:not(:disabled),
a[href],
summary,
label[for],
select:not(:disabled),
[role="button"]:not([aria-disabled="true"]),
[role="option"]:not([aria-disabled="true"]),
[role="menuitem"]:not([aria-disabled="true"]),
[role="tab"]:not([aria-disabled="true"]) {
  cursor: pointer;
}
```

- [ ] **Step 5: Replace both scrollbar blocks with stable-gutter, hover-only thumbs**

Replace the four light-mode rules (~line 309-327) and four dark-mode rules (~line 328-346) with:

```css
/* Scroll containers reserve their gutter so a list crossing the overflow
     threshold does not shift content sideways. */
* {
  scrollbar-gutter: stable;
}

/* Thumbs are invisible until the pointer is over the scroller. The 3px
     transparent border + content-box clip is what makes the thumb read as an
     inset pill rather than a full-width bar. */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: transparent;
  border: 3px solid transparent;
  background-clip: content-box;
  border-radius: 999px;
  transition: background-color var(--duration-fast) var(--ease-standard);
}
:hover::-webkit-scrollbar-thumb,
:focus-within::-webkit-scrollbar-thumb {
  background: var(--state-active);
  background-clip: content-box;
}
:hover::-webkit-scrollbar-thumb:hover {
  background: var(--border-bright);
  background-clip: content-box;
}
/* Firefox has no thumb-hover selector; give it the resting alpha directly. */
@supports not selector(::-webkit-scrollbar) {
  * {
    scrollbar-width: thin;
    scrollbar-color: var(--state-active) transparent;
  }
}
```

Note: this depends on `--state-active` and `--duration-fast` from Task 1. If Task 2 lands first, use `var(--border)` and `180ms` literally and open a follow-up — do **not** block.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run src/app/globals.tokens.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Verify by eye — this is a cursor/scroll change, tests cannot see it**

Run: `pnpm dev`, open any board.
Expected: buttons show a hand cursor; scrollbars are invisible until you hover the list, then a thin inset pill appears; a vertical flick at the top of a board no longer rubber-bands the whole page.

- [ ] **Step 8: Commit**

```bash
git add src/app/globals.css src/app/globals.tokens.test.ts
git commit -F - <<'EOF'
feat(design): restore pointer cursors and quiet the scrollbars

Three mechanics the shell was missing. Interactive elements get
cursor: pointer as a base rule -- it was set ad hoc in only 13 files, so
most of the product showed a text caret over its own buttons. Scroll
containers reserve a stable gutter and their thumbs stay invisible until
hover, using the transparent-border + content-box clip that renders the
thumb as an inset pill. Overscroll containment extends to both axes;
it was x-only, so vertical rubber-banding still escaped the app frame.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Shell inversion — the wash and the inset card

**Files:**

- Modify: `src/app/globals.css` (add the `.app-wash` component class)
- Modify: `src/components/app-shell.tsx:35-51`
- Modify: `src/components/sidebar.tsx:43-50`
- Test: `src/components/app-shell.test.tsx` (extend), `src/components/sidebar.test.tsx` (extend)

**Interfaces:**

- Consumes (Task 1): `--app-wash`, `--app-bloom`, `border-content-edge`, `shadow-content-lift`.
- Produces: the `.app-wash` class (applied to the AppShell root only). Task 7 consumes the resulting borderless shell.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/app-shell.test.tsx`:

```tsx
describe("surface model", () => {
  it("paints the wash on the shell root, not on body", () => {
    const { container } = renderShell();
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("app-wash");
    expect(root).toHaveClass("h-svh");
  });

  it("renders main as the one inset opaque card", () => {
    renderShell();
    const main = screen.getByRole("main");
    expect(main).toHaveClass("bg-content-surface");
    expect(main).toHaveClass("rounded-xl");
    expect(main).toHaveClass("border-content-edge");
    expect(main).toHaveClass("shadow-content-lift");
  });

  it("leaves the header transparent — separation is the gutter, not a line", () => {
    renderShell();
    const header = screen.getByRole("banner");
    expect(header.className).not.toMatch(/\bborder-b\b/);
    expect(header.className).not.toMatch(/\bbg-/);
  });
});
```

Append to `src/components/sidebar.test.tsx` (inside the existing top-level `describe`):

```tsx
it("paints nothing — it shows the wash through", () => {
  const { container } = render(<Sidebar navSlot={<div>NAV</div>} />);
  const aside = container.querySelector("aside") as HTMLElement;
  expect(aside.className).not.toMatch(/\bbg-sidebar\b/);
  expect(aside.className).not.toMatch(/\bborder-r\b/);
});
```

If `sidebar.test.tsx` does not already import `render`/`Sidebar`, add them:
`import { render } from "@testing-library/react";` and `import { Sidebar } from "./sidebar";`

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/app-shell.test.tsx src/components/sidebar.test.tsx`
Expected: FAIL — `expect(element).toHaveClass("app-wash")` and `bg-sidebar` still present.

- [ ] **Step 3: Add the `.app-wash` class**

In `src/app/globals.css`, inside `@layer base` after the scrollbar rules:

```css
/* The app surface. Scoped to the AppShell root rather than `body` on
     purpose: the landing route has its own page-wide wash and must not
     inherit this one. Bloom is listed first so it composites above the ramp. */
.app-wash {
  background-image: var(--app-bloom), var(--app-wash);
  background-attachment: fixed;
}
```

- [ ] **Step 4: Invert the shell**

Replace the JSX body of `AppShell` (`src/components/app-shell.tsx:35-51`):

```tsx
<div className="app-wash flex h-svh w-full overflow-hidden">
  <Sidebar navSlot={sidebarNav} />

  <div className="flex min-w-0 flex-1 flex-col">
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
      <div className="flex items-center gap-1 md:hidden">
        {mobileNav}
        <Brand />
      </div>
      <div className="flex flex-1 items-center justify-end gap-2">
        <CommandTrigger />
        <ThemeToggle />
        {headerUser}
      </div>
    </header>
    <main className="bg-content-surface border-content-edge shadow-content-lift mr-2 mb-2 ml-1 min-h-0 flex-1 overflow-auto rounded-xl border">
      {children}
    </main>
  </div>
  {commandPalette}
</div>
```

Changes: `app-wash` added to the root; `border-b` dropped from `<header>`; `<main>` gained the card treatment and the gutter.

- [ ] **Step 5: Stop the sidebar painting**

In `src/components/sidebar.tsx:46`, change the first `cn()` argument:

```tsx
          "hidden shrink-0 flex-col md:flex",
```

(was `"bg-sidebar hidden shrink-0 flex-col border-r md:flex"` — both `bg-sidebar` and `border-r` are removed.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/components/app-shell.test.tsx src/components/sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 7: Verify by eye in both themes**

Run: `pnpm dev`. Walk: a board (table + kanban), an item panel, settings, Ask Monolith, the agents roster — in **dark and light**.
Expected: gradient visible behind the rail and header; content sits as a rounded card with a visible gutter on the right and bottom; a faint bloom top-left; no seam or hard line where the sidebar used to be. Compare against direction B in the approved preview.

- [ ] **Step 8: Commit**

```bash
git add src/app/globals.css src/components/app-shell.tsx src/components/sidebar.tsx src/components/app-shell.test.tsx src/components/sidebar.test.tsx
git commit -F - <<'EOF'
feat(design): invert the surface model onto the wash

The app shell root now paints the gradient, the sidebar and header paint
nothing and show it through, and main becomes the single opaque inset
card with a gutter instead of a border. Chrome is atmosphere; content is
the object -- the reverse of the previous model, where the sidebar was
raised above a flat page.

The wash is scoped to the shell rather than body because the landing
route has its own page-wide wash and must not inherit this one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Alpha-on-parent state migration

**Files:**

- Modify: ~49 `.tsx` files under `src/` using `hover:bg-accent` / `hover:bg-muted` / `hover:bg-secondary`
- Create: `scripts/check-hover-tokens.mjs`, `scripts/check-hover-tokens.test.mjs`
- Modify: `package.json` (`lint` script)

**Interfaces:**

- Consumes (Task 1): `bg-state-hover`, `bg-state-active`, `bg-state-selected`.
- Produces: `findOpaqueHoverStates(files: {path: string, source: string}[]): {path: string, line: number, klass: string}[]` exported from `scripts/check-hover-tokens.mjs`.

**Why:** an opaque grey hover (`--accent: #1c1c20`) reads as a rectangular patch against a gradient. Alpha adapts to whatever is underneath. The three tokens keep their identity as **fills** (badges, inputs, chips) — this is a state/fill separation, not a rename, so only `hover:`/`focus:`/`active:`/`data-[state]` _state_ prefixes migrate.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-hover-tokens.test.mjs`:

```js
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { findOpaqueHoverStates } from "./check-hover-tokens.mjs";

describe("findOpaqueHoverStates", () => {
  it("flags opaque tokens used as an interaction state", () => {
    const hits = findOpaqueHoverStates([
      { path: "a.tsx", source: '<div className="hover:bg-accent p-2" />' },
    ]);
    assert.deepEqual(hits, [
      { path: "a.tsx", line: 1, klass: "hover:bg-accent" },
    ]);
  });

  it("ignores the same tokens used as a resting fill", () => {
    assert.deepEqual(
      findOpaqueHoverStates([
        { path: "b.tsx", source: '<span className="bg-accent rounded" />' },
      ]),
      [],
    );
  });

  it("catches focus, active and data-state prefixes too", () => {
    const hits = findOpaqueHoverStates([
      {
        path: "c.tsx",
        source:
          "focus:bg-muted\nactive:bg-secondary\ndata-[state=open]:bg-accent",
      },
    ]);
    assert.deepEqual(
      hits.map((h) => h.line),
      [1, 2, 3],
    );
  });

  it("reports the correct line number in a multi-line file", () => {
    const hits = findOpaqueHoverStates([
      {
        path: "d.tsx",
        source: "one\ntwo\n<div className='hover:bg-accent' />",
      },
    ]);
    assert.deepEqual(hits, [
      { path: "d.tsx", line: 3, klass: "hover:bg-accent" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scripts/check-hover-tokens.test.mjs`
Expected: FAIL — cannot resolve `./check-hover-tokens.mjs`.

- [ ] **Step 3: Write the guard**

Create `scripts/check-hover-tokens.mjs`:

```js
#!/usr/bin/env node
/**
 * check-hover-tokens.mjs
 *
 * Fails when an OPAQUE surface token (--accent / --muted / --secondary) is used
 * as an interaction STATE. Against a gradient those read as rectangular
 * patches; the --state-* tokens are alpha-on-parent and adapt to whatever is
 * underneath. The same tokens remain correct as resting FILLS, so only state
 * prefixes are flagged.
 *
 * Exit 0 clean, 1 with findings. Written in node so the matcher is unit-
 * testable in the same `pnpm test` gate as everything else (AGENTS.md #4).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const STATE_PREFIX = String.raw`(?:hover|focus|focus-visible|active|data-\[[^\]]+\])`;
const OPAQUE = String.raw`(?:accent|muted|secondary)`;
const RE = new RegExp(`${STATE_PREFIX}:bg-${OPAQUE}\\b`, "g");

/** @param {{path: string, source: string}[]} files */
export function findOpaqueHoverStates(files) {
  const hits = [];
  for (const { path, source } of files) {
    source.split("\n").forEach((text, i) => {
      for (const m of text.matchAll(RE)) {
        hits.push({ path, line: i + 1, klass: m[0] });
      }
    });
  }
  return hits;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const files = walk(join(root, "src")).map((path) => ({
    path: relative(root, path),
    source: readFileSync(path, "utf8"),
  }));
  const hits = findOpaqueHoverStates(files);
  for (const h of hits) {
    console.error(`${h.path}:${h.line}  ${h.klass} → use the --state-* token`);
  }
  if (hits.length) {
    console.error(`\n${hits.length} opaque interaction state(s).`);
    process.exit(1);
  }
  console.log("check-hover-tokens: clean");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scripts/check-hover-tokens.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: See the real scope**

Run: `node scripts/check-hover-tokens.mjs`
Expected: ~72 findings across ~49 files (69 `hover:bg-accent`, 3 `hover:bg-muted`, plus any state-prefixed variants).

- [ ] **Step 6: Migrate every site**

Mechanical, one token each:

| From                                                                                       | To                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `hover:bg-accent`                                                                          | `hover:bg-state-hover`                                  |
| `hover:bg-muted`                                                                           | `hover:bg-state-hover`                                  |
| `hover:bg-secondary`                                                                       | `hover:bg-state-hover`                                  |
| `focus:bg-accent` / `focus-visible:bg-accent`                                              | `focus:bg-state-hover` / `focus-visible:bg-state-hover` |
| `active:bg-*`                                                                              | `active:bg-state-active`                                |
| `data-[state=open]:bg-accent`, `data-[selected=true]:bg-accent`, `aria-selected:bg-accent` | `…:bg-state-selected`                                   |

Two rules while editing:

1. **Do not touch resting fills.** A bare `bg-accent` with no state prefix stays.
2. **`hover:text-accent-foreground` stays.** Only the background migrates; the foreground pairing is still correct.

Re-run `node scripts/check-hover-tokens.mjs` until it prints `clean`.

- [ ] **Step 7: Wire the guard into lint**

In `package.json`, change the `lint` script:

```json
"lint": "eslint && node scripts/check-hover-tokens.mjs",
```

- [ ] **Step 8: Verify the whole gate**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: all pass, `check-hover-tokens: clean` in the lint output.

- [ ] **Step 9: Verify by eye**

Run: `pnpm dev`. Hover rows in a board table, sidebar nav items, dropdown menu items, and command-palette results, in **both themes**.
Expected: hover reads as a soft lightening of whatever is beneath, with no rectangular grey patch and no visible seam where a row meets the card edge.

- [ ] **Step 10: Commit**

```bash
git add src/ scripts/check-hover-tokens.mjs scripts/check-hover-tokens.test.mjs package.json
git commit -F - <<'EOF'
feat(design): migrate interaction states to alpha-on-parent tokens

Opaque surface tokens used as hover/focus/active states read as
rectangular patches against a gradient. The --state-* tokens are alpha
over the parent, so they adapt to whatever is underneath -- the sidebar
over the wash, a row over the content card.

The three opaque tokens keep their identity as resting fills; only state
prefixes moved. A node guard wired into pnpm lint keeps them separated,
with its matcher unit-tested in the same gate.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Type scale — weight-based hierarchy, then consolidation

**Files:**

- Modify: ~48 `.tsx` files under `src/` containing `text-[Npx]`

**Interfaces:**

- Consumes (Task 1): `text-2xs` (0.6875rem), `text-3xs` (0.625rem).
- Produces: a codebase with zero arbitrary pixel text sizes — the precondition Task 6's guard depends on.

**Why the order matters:** shipping the CI guard first would make 48 files fail with nowhere to land. The two missing small tokens are the direct cause of most arbitrary values, and Buzz can run at essentially one size only because it takes hierarchy from **weight and indentation**. Adopt that first; the sizes then collapse.

- [ ] **Step 1: Inventory the real scope**

```bash
grep -rEoh "text-\[[0-9.]+px\]" src/ --include=*.tsx | sort | uniq -c | sort -rn
```

Expected (2026-08-02 baseline): 130 total across 16 values — 42×`10px`, 26×`11px`, 10×`9px`, 9×`13.5px`, 8×`13px`, 6×`15px`, 5×`12.5px`, 4×`14.5px`, 4×`11.5px`, 3×`9.5px`, 3×`10.5px`, 2×`46px`, 2×`17px`, 2×`14px`, 1×`32px`, 1×`12px`.

- [ ] **Step 2: Apply the mapping, file by file**

| Arbitrary          | Token       | rem    |
| ------------------ | ----------- | ------ |
| 9, 9.5, 10, 10.5   | `text-3xs`  | 0.625  |
| 11, 11.5           | `text-2xs`  | 0.6875 |
| 12, 12.5           | `text-xs`   | 0.75   |
| 13, 13.5, 14, 14.5 | `text-sm`   | 0.875  |
| 15                 | `text-base` | 1      |
| 17                 | `text-lg`   | 1.125  |
| 32                 | `text-3xl`  | 1.875  |
| 46                 | `text-5xl`  | 3      |

**This is not a blind sed.** Work one file at a time and apply the weight rule at each site: where two adjacent elements were distinguished only by a half-pixel size difference (13px vs 13.5px, 10px vs 10.5px), they now land on the same token — restore the distinction with **weight** (`font-normal` body / `font-medium` emphasis / `font-semibold` heading) or indentation, never by reintroducing a size. Where a size difference was carrying real hierarchy (a `46px` hero over `17px` body), the mapping preserves it.

Commit in batches of roughly 8-10 files so a regression is bisectable.

- [ ] **Step 3: Verify none remain**

```bash
grep -rEoh "text-\[[0-9.]+px\]" src/ --include=*.tsx | wc -l
```

Expected: `0`. If a site genuinely cannot use a token (a decorative badge glyph, an icon-sized numeral), leave it and record the exact path — Task 6 needs it for the allowlist.

- [ ] **Step 4: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 5: Verify by eye — this is the highest-regression-risk task**

Run: `pnpm dev`. Walk **every** surface, both themes: boards list, board table, board kanban, item panel, settings (all tabs), Ask Monolith, agents roster + run history, dashboards, reports.
Expected: no text is noticeably larger or smaller than before; where two rows previously differed by a half pixel they now differ by weight; nothing wraps or truncates that did not before.

- [ ] **Step 6: Commit (per batch)**

```bash
git add <the 8-10 files in this batch>
git commit -F - <<'EOF'
refactor(design): move <area> onto the type scale

Replaces arbitrary pixel text sizes with the shared tokens, adding the
weight distinction where two elements previously differed only by a
half-pixel. Hierarchy now comes from weight and indentation rather than
from shrinking text, which is what lets 16 sizes collapse into six.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: CI guard against arbitrary pixel text

**Files:**

- Create: `scripts/check-px-text.mjs`, `scripts/check-px-text.test.mjs`
- Modify: `package.json` (`lint` script)

**Interfaces:**

- Consumes (Task 5): a `src/` tree with zero arbitrary pixel text sizes.
- Produces: `findPxText(files, allowlist): {path, line, klass}[]` exported from `scripts/check-px-text.mjs`.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-px-text.test.mjs`:

```js
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { findPxText } from "./check-px-text.mjs";

describe("findPxText", () => {
  it("flags an arbitrary pixel text size", () => {
    assert.deepEqual(
      findPxText(
        [{ path: "a.tsx", source: '<p className="text-[13px]" />' }],
        [],
      ),
      [{ path: "a.tsx", line: 1, klass: "text-[13px]" }],
    );
  });

  it("accepts fractional pixel values", () => {
    const hits = findPxText([{ path: "b.tsx", source: "text-[13.5px]" }], []);
    assert.equal(hits[0].klass, "text-[13.5px]");
  });

  it("ignores rem-based arbitrary values — those are on the scale", () => {
    assert.deepEqual(
      findPxText([{ path: "c.tsx", source: "text-[0.6875rem]" }], []),
      [],
    );
  });

  it("ignores non-text arbitrary pixel utilities", () => {
    assert.deepEqual(
      findPxText([{ path: "d.tsx", source: "w-[13px] gap-[2px]" }], []),
      [],
    );
  });

  it("honours the allowlist by exact path", () => {
    assert.deepEqual(
      findPxText(
        [{ path: "src/components/brand/mark.tsx", source: "text-[46px]" }],
        ["src/components/brand/mark.tsx"],
      ),
      [],
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scripts/check-px-text.test.mjs`
Expected: FAIL — cannot resolve `./check-px-text.mjs`.

- [ ] **Step 3: Write the guard**

Create `scripts/check-px-text.mjs`:

```js
#!/usr/bin/env node
/**
 * check-px-text.mjs
 *
 * Fails on arbitrary pixel text sizes (`text-[13px]`). They fragment the type
 * scale -- the repo carried 130 of them across 16 distinct values before this
 * guard -- and they do not respond to the user's browser font-size setting.
 * Use a token; the scale runs text-3xs (0.625rem) through text-5xl.
 *
 * ALLOWLIST is for genuinely decorative type whose size is part of a mark or
 * an icon, not part of the reading hierarchy. Add a path only with a comment
 * saying why.
 *
 * Exit 0 clean, 1 with findings.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Decorative exceptions — path, plus why it is exempt. */
export const ALLOWLIST = [
  // (empty at introduction — Task 5 left no unavoidable sites)
];

const RE = /text-\[[0-9]+(?:\.[0-9]+)?px\]/g;

/**
 * @param {{path: string, source: string}[]} files
 * @param {string[]} allowlist
 */
export function findPxText(files, allowlist = ALLOWLIST) {
  const exempt = new Set(allowlist.map((p) => p.replace(/\\/g, "/")));
  const hits = [];
  for (const { path, source } of files) {
    if (exempt.has(path.replace(/\\/g, "/"))) continue;
    source.split("\n").forEach((text, i) => {
      for (const m of text.matchAll(RE)) {
        hits.push({ path, line: i + 1, klass: m[0] });
      }
    });
  }
  return hits;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const files = walk(join(root, "src")).map((path) => ({
    path: relative(root, path).replace(/\\/g, "/"),
    source: readFileSync(path, "utf8"),
  }));
  const hits = findPxText(files);
  for (const h of hits) {
    console.error(`${h.path}:${h.line}  ${h.klass} → use a text-* token`);
  }
  if (hits.length) {
    console.error(`\n${hits.length} arbitrary pixel text size(s).`);
    process.exit(1);
  }
  console.log("check-px-text: clean");
}
```

If Task 5 left any unavoidable sites, add each to `ALLOWLIST` with its reason as a comment.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scripts/check-px-text.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run it against the real tree**

Run: `node scripts/check-px-text.mjs`
Expected: `check-px-text: clean`. A non-zero exit means Task 5 is incomplete — finish it rather than widening the allowlist.

- [ ] **Step 6: Wire into lint**

In `package.json`:

```json
"lint": "eslint && node scripts/check-hover-tokens.mjs && node scripts/check-px-text.mjs",
```

- [ ] **Step 7: Verify the gate**

Run: `pnpm lint`
Expected: passes, with both guards reporting clean.

- [ ] **Step 8: Commit**

```bash
git add scripts/check-px-text.mjs scripts/check-px-text.test.mjs package.json
git commit -F - <<'EOF'
feat(tooling): guard the type scale against arbitrary pixel sizes

Now that the 130 arbitrary sizes are gone, pin the result. Arbitrary
pixel text fragments the scale and ignores the reader's browser font-size
setting, so pnpm lint fails on it. The allowlist is for decorative type
that is part of a mark rather than the reading hierarchy, and each entry
carries its reason.

Matcher is unit-tested alongside the other repo tooling scripts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: Border restraint

**Files:**

- Modify: `src/components/app-shell.tsx`, `src/components/sidebar.tsx`, plus any panel/header component whose border the gutter now duplicates

**Interfaces:**

- Consumes (Task 3): the gutter-separated shell.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Find structural borders the layout now implies**

```bash
grep -rn "border-[trbl]\b" src/components/ src/app/ --include=*.tsx | grep -vi "rounded"
```

Review each hit against one rule: **a border is kept only when it encloses a real object.** A line that merely separates two regions the gutter already separates is removed.

- [ ] **Step 2: Remove the redundant ones**

Expected candidates: leftover `border-b` on in-page section headers directly under the now-borderless app header, and `border-r`/`border-l` on panes that sit inside the content card and are already separated by padding. **Keep** borders on cards, inputs, dropdown surfaces, table cell rules, and anything with a `rounded-*`.

- [ ] **Step 3: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 4: Verify by eye**

Run: `pnpm dev`. Both themes, boards + settings + item panel.
Expected: no orphaned line segments that stop mid-layout; every remaining border encloses something.

- [ ] **Step 5: Commit**

```bash
git add <the files changed>
git commit -F - <<'EOF'
refactor(design): drop borders the gutter already implies

With chrome separated from content by a gutter rather than a line, the
shell's structural borders became orphaned segments. Removes the ones
that only divided regions and keeps every border that encloses a real
object -- cards, inputs, dropdown surfaces, table rules.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Closure

After the last task merges, per working agreement #1:

1. Run `scripts/finish-task.sh` from inside the worktree (rebases onto `develop`, runs all four gates, merges, pushes, removes the worktree and branch).
2. Hand the user a numbered **"How to test this"** walkthrough — this change is entirely user-observable, so the "not user-facing" exemption does not apply. It must name the URL, the theme toggle, and the expected result on each surface.
3. Log the session with `/wrapup` and bump `vault/00-north-star.md`.
4. Update the spec's `Status:` line from `draft (design), pending approval` to `implemented`.
