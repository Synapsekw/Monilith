# Keystone Wash Follow-ups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five composition defects the post-merge whole-branch review of `4d17d02b..ec871dca` found, then perform the both-themes visual pass that never happened, so the Keystone wash is promotable to `main`.

**Architecture:** Four of the five defects are token-layer changes in `src/app/globals.css` plus a handful of consumer class swaps; the fifth (`/ask`) ports the shell's surface model to the one route that lives outside the `(app)` group. Nothing here touches server data, RSC boundaries, the database, or any query. Every change is CSS-visible only, so the automated gates prove _non-regression_ and the human visual walk is the actual acceptance gate.

**Tech Stack:** Tailwind CSS v4 (`@theme inline`), shadcn/ui primitives, Next.js 16 App Router (RSC), Vitest + Testing Library.

**Source findings:** `docs/superpowers/plans/2026-08-02-keystone-wash-followups.md`
**Spec:** `docs/superpowers/specs/2026-08-02-keystone-wash-and-polish-design.md`
**Parent plan:** `docs/superpowers/plans/2026-08-02-keystone-wash-and-polish.md`
**Session note:** `vault/sessions/2026-08-02-2012-keystone-wash-and-polish.md`

---

## Corrections to the findings document (verified against the tree at `60e7849`)

The findings doc was written from a review transcript, not re-read against the tree. These
are wrong or imprecise and are corrected throughout this plan. **Do not re-derive them.**

| #   | Findings doc says                                                  | Actually                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/components/shell/app-shell.tsx:50`                            | The file is **`src/components/app-shell.tsx`**, and `main` is on **line 50** there. `src/components/shell/` contains no `app-shell.tsx`.                                                                                                                       |
| 2   | `Skeleton` "affects content-card skeletons too"                    | Confirmed shared, but the scale is **12 importing files / 13 files using `<Skeleton>` / 67 JSX usages** — not the ~37 quoted elsewhere. The conclusion stands: fix via a **variant prop**, never by changing the default.                                      |
| 3   | Light nav labels on the wash = **4.13:1**                          | The true worst case is **3.87:1** — `#6b6b72` on the wash's 100% stop `#d9dce8`, with no bloom. 4.13 is a mid-ramp value. The defect is **worse** than reported.                                                                                               |
| 4   | Dark nav labels under the bloom = **4.40:1**                       | 4.40 is the composite at **11%** bloom coverage. The bloom's declared peak is **22%**, giving `#394166` and **3.54:1**. Again **worse** than reported.                                                                                                         |
| 5   | Proposed dark fix `#9a9aa2 → ~#a8a8b0` "5.21:1"                    | `#a8a8b0` reaches 5.20:1 only at 11% bloom. At the 22% peak it is **4.19:1 — still below AA**. This plan uses **`#b2b2ba`** (4.70:1 at the peak). See Task 3.                                                                                                  |
| 6   | Defect #4's real scrollers are three files                         | There are **~22** page-region scrollers matching the codebase's `flex-1 overflow-[y-]auto` idiom, including **five skeleton mirrors** that must be changed in lockstep or the gutter itself causes the layout shift it exists to prevent. Full list in Task 4. |
| 7   | "Compare against direction B in `scratchpad/wash-directions.html`" | **That file does not exist.** `scratchpad/` is absent from this worktree _and_ from the main checkout, is not in `.gitignore`, and `git ls-files` has never tracked it. The acceptance reference is reconstructed inline in Task 6.                            |
| 8   | Defect #5 cites `globals.css:405-409`                              | The hovered-thumb rules are **405–413**, and the Firefox fallback at **415–419** reuses `--state-active` too. Both must change or Firefox keeps the old value.                                                                                                 |

Everything else in the findings doc reproduced correctly, including the "Known-good" section.

---

## Global Constraints

- **This branch does not self-close.** Tasks 1–5 are code; **Task 6 is a human visual pass**. Do
  **not** run `scripts/finish-task.sh` until Task 6 has been walked and signed off by the owner.
  The prior session's Task 7 implementer closed the branch on its own initiative and destroyed the
  review ledger — that is the specific failure this plan exists to not repeat.
- **UI is governed by `pulse-ui` + `frontend-design`.** Load both before touching any component.
  Semantic tokens only (never `bg-zinc-*`); hairlines **brighten**, never thicken.
- **Every new custom property is declared in BOTH `:root` and `.dark`.** `src/app/globals.tokens.test.ts`
  asserts light/dark parity (`onlyLight`/`onlyDark` must both be empty) and `@theme inline`
  registration. A token added to one theme only fails the existing suite.
- **A token is only Tailwind-addressable if `@theme inline` maps it.** `--chrome-fill` needs
  `--color-chrome-fill` (it backs a `bg-*` utility). `--scrollbar-thumb` does **not** — it is
  referenced from raw CSS only, and adding a `--color-*` alias for it would advertise a utility
  nobody uses.
- **Server Components by default**; no mutation, no Server Action, no migration in this plan.
- **Performance & data-fetching budget (working agreement #5):** first paint gains **zero** bytes
  beyond four token declarations; interactions cost **0 new server round-trips**; no query, index,
  or pagination boundary is touched. Task 4 adds a static `data-scroll-container` attribute — no JS,
  no listener, no re-render.
- **Commits:** subject lowercase after `type(scope):`, descriptive body, `Co-Authored-By` trailer.
  **Stage explicitly by path** — never `git add -A`.
- **Gates before merge:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Guard discipline:** if any task adds or modifies a lint-guard script or a guard-shaped
  conformance test, it MUST be **proven to fail** — inject a violation, confirm it prints and
  exits non-zero, revert. A guard nobody has watched fail is decorative. (Both shipped guards were
  decorative on Windows for exactly this reason; see the session note.)

---

## File structure

**Created**

| File                                      | Responsibility                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/ask/layout.test.tsx`             | Locks `/ask` to the same surface model as `AppShell`.                                                                                |
| `src/app/globals.contrast.test.ts`        | Computes WCAG contrast of `--muted-foreground` against every wash stop in both themes. The only machine-checkable half of defect #3. |
| `src/app/scroll-containers.test.ts`       | Guard-shaped: every page-region scroller opts into the gutter.                                                                       |
| `src/components/command-trigger.test.tsx` | The ⌘K trigger paints nothing opaque on the wash.                                                                                    |

**Modified**

| File                                                          | Change                                                                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/globals.css`                                         | `--chrome-fill` (T2), `--muted-foreground` values (T3), `--scrollbar-thumb` + thumb rules (T5). **Four tasks, one file — see the DAG.** |
| `src/app/globals.tokens.test.ts`                              | New token assertions (T2, T5) + hardened gutter assertion (T4).                                                                         |
| `src/app/ask/layout.tsx`                                      | Wash root, transparent aside, inset content card (T1).                                                                                  |
| `src/components/ui/skeleton.tsx`                              | `variant?: "content" \| "chrome"` (T2).                                                                                                 |
| `src/components/ui/skeleton.test.tsx`                         | Default-unchanged regression lock + chrome variant (T2).                                                                                |
| `src/components/shell/sidebar-nav-skeleton.tsx` / `.test.tsx` | `variant="chrome"` (T2).                                                                                                                |
| `src/components/shell/header-user-skeleton.tsx` / `.test.tsx` | `variant="chrome"` (T2).                                                                                                                |
| `src/components/shell/org-switcher.tsx` / `.test.tsx`         | `bg-surface-muted` → `bg-chrome-fill` ×2 (T2).                                                                                          |
| `src/components/shell/workspace-switcher.tsx` / `.test.tsx`   | `bg-surface-muted` → `bg-chrome-fill` ×2 (T2).                                                                                          |
| `src/components/command-trigger.tsx`                          | `bg-transparent` on the button, `bg-chrome-fill` on the kbd (T2).                                                                       |
| 21 scroller components (listed in Task 4)                     | `data-scroll-container` attribute (T4).                                                                                                 |

---

## Task 1: `/ask` adopts the shell surface model (defect #1)

**Severity:** highest — this is a screen that currently looks broken. The session note already
warns the owner to "expect this one to look wrong".

**Root cause.** Task 1 of the parent plan retired `--sidebar` to `transparent` on the reasoning
that any straggler "degrades to showing the wash". That holds only for consumers **inside**
`AppShell`, which carries `.app-wash`. `/ask` deliberately lives outside the `(app)` group
(`src/app/ask/layout.tsx` owns its own frame) and has no `.app-wash`, so `bg-sidebar` degrades to
`body`'s `--background` instead. In dark that is `#0e0e10` — byte-identical to the conversation
pane beside it, leaving only `border-r` to separate them. This is the last `bg-sidebar` consumer
in `src/` (the only other match is a negative assertion in `src/components/sidebar.test.tsx:65`).

### Decision: take the "better" option, not the minimal one

The findings doc left the choice open between `bg-surface` on the aside (minimal) and porting the
full shell treatment (better). **Take the better option.** Three reasons, in order of weight:

1. **The minimal fix makes `/ask` the one screen still running the pre-wash surface model.** After
   this branch, chrome everywhere else is transparent atmosphere and content is an opaque inset
   card. `bg-surface` on the `/ask` aside restores a _raised panel above a flat page_ — the exact
   inversion the spec §1 was written to eliminate. It would not read as a bug; it would read as a
   different product, which is worse, because nobody would ever go back and fix it.
2. **It makes the invariant uniform and therefore testable in one shape.** `sidebar.test.tsx:62-67`
   already asserts the shell aside paints nothing and carries no `border-r`. Task 1's new test
   asserts the identical three properties for `/ask`. Two routes, one rule. Under the minimal fix
   the two asides need two different, mutually contradictory tests.
3. **The effort is the same.** Both are edits to one 46-line file. The better option is four class
   changes instead of one.

Cost, stated honestly: `/ask`'s `<main>` becomes an inset card, so the conversation pane gains the
same 8px right/bottom gutter as every other page. That is a real visual change to a shipped screen
and it goes on the Task 6 walk list.

**Files:**

- Modify: `src/app/ask/layout.tsx:20-44`
- Test: `src/app/ask/layout.test.tsx` (create)

**Interfaces:**

- Consumes: `.app-wash` and the `--content-surface` / `--content-edge` / `--content-lift` tokens —
  all already shipped in `src/app/globals.css` (`:root` 190-199, `.dark` 291-300). Nothing from
  another task in this plan.
- Produces: nothing consumed by a later task. Task 4 separately adds `data-scroll-container` to
  `/ask`'s two internal scrollers (`MessageList`, `ConversationRail`); those are different files
  and different lines, so there is no edit collision.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/ask/layout.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AskLayout from "./layout";

// The rail is an async RSC behind `requireUser()`. Stub it — this test is about
// the frame's surface model, not the rail's data.
vi.mock("@/components/ai/ask/AskRailData", () => ({
  AskRailData: () => <div>RAIL_DATA</div>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ask",
  useParams: () => ({}),
}));

/**
 * `/ask` lives OUTSIDE the `(app)` group and owns its own frame, so it does not
 * inherit AppShell's wash. These assertions are the same three that
 * `src/components/sidebar.test.tsx` and `src/components/app-shell.test.tsx`
 * make about the shell — one surface model, asserted per frame.
 */
describe("AskLayout surface model", () => {
  it("paints the wash on its own root", () => {
    const { container } = render(<AskLayout>chat</AskLayout>);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("app-wash");
    expect(root).toHaveClass("h-svh");
  });

  it("leaves the conversation rail transparent — no fill, no dividing line", () => {
    const { container } = render(<AskLayout>chat</AskLayout>);
    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.className).not.toMatch(/\bbg-sidebar\b/);
    expect(aside.className).not.toMatch(/\bbg-surface\b/);
    expect(aside.className).not.toMatch(/\bborder-r\b/);
  });

  it("renders main as the one inset opaque card", () => {
    render(<AskLayout>chat</AskLayout>);
    const main = screen.getByRole("main");
    expect(main).toHaveClass("bg-content-surface");
    expect(main).toHaveClass("rounded-xl");
    expect(main).toHaveClass("border-content-edge");
    expect(main).toHaveClass("shadow-content-lift");
  });

  it("still renders the brand, the back link and the rail slot", () => {
    render(<AskLayout>CHAT_CHILDREN</AskLayout>);
    expect(screen.getByText("RAIL_DATA")).toBeInTheDocument();
    expect(screen.getByText("CHAT_CHILDREN")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to monolith/i }),
    ).toHaveAttribute("href", "/my-work");
  });
});
```

**New vs. existing coverage:** all four cases are **new**. No test in the tree renders
`src/app/ask/layout.tsx` today — that absence is precisely why the defect shipped. The last case
is a regression lock so the surface edits cannot silently drop the rail or the back link.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/ask/layout.test.tsx`
Expected: FAIL — 3 of 4 cases red. `app-wash` missing on the root; `bg-sidebar` and `border-r`
still on the aside; `main` has none of the four card classes. The fourth case ("still renders…")
passes from the start, which is what makes it a useful regression lock.

- [ ] **Step 3: Write the implementation**

Replace the returned JSX in `src/app/ask/layout.tsx` (lines 19-45) with:

```tsx
return (
  <div className="app-wash flex h-svh w-full overflow-hidden">
    <aside className="flex w-64 shrink-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <Brand />
      </div>
      <Link
        href="/my-work"
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-4 py-3 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" /> Back to Monolith
      </Link>
      <Suspense
        fallback={
          <div className="text-muted-foreground px-4 py-3 text-xs">
            Loading conversations…
          </div>
        }
      >
        <AskRailData />
      </Suspense>
    </aside>
    <main className="bg-content-surface border-content-edge shadow-content-lift mr-2 mb-2 ml-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border">
      <Suspense fallback={null}>{children}</Suspense>
    </main>
  </div>
);
```

Four changes, each deliberate:

- `app-wash` on the root — `/ask` gets the same atmosphere as the shell.
- `bg-sidebar` **and** `border-r` dropped from the aside. Dropping the border is not optional
  cleanup: once the rail is transparent, that line is exactly the orphaned structural border spec
  §8 removes, and leaving it would draw a hard edge through a continuous gradient.
- `border-b` dropped from the brand row for the same reason — the shell's header (`app-shell.tsx:39`)
  carries no `border-b`, and `app-shell.test.tsx:66-71` asserts it must not.
- `<main>` becomes the inset card with the **same** `mr-2 mb-2 ml-1 rounded-xl border` geometry as
  `app-shell.tsx:50`. It keeps `overflow-hidden`, **not** `overflow-auto`: `/ask` delegates
  scrolling to `MessageList` (`src/components/ai/ask/MessageList.tsx:93`), and giving the card its
  own scroller would produce two nested scrollbars on the same axis.

Also update the file's doc comment to say the layout now mirrors the shell's surface model rather
than owning a bespoke one.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/app/ask/layout.test.tsx`
Expected: PASS — 4/4.

Then confirm nothing else regressed:

Run: `pnpm vitest run src/components/sidebar.test.tsx src/components/app-shell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/ask/layout.tsx src/app/ask/layout.test.tsx
git commit -m "fix(ask): port the wash surface model to the ask frame"
```

**Only verifiable by eye:** whether the conversation rail still reads as a _rail_ once it is pure
gradient with no divider. The test proves the classes are gone; it cannot prove the result is
legible. Task 6, `/ask`, both themes.

---

## Task 2: `--chrome-fill` — resting fills stop punching holes in the wash (defect #2)

**Root cause.** Parent Task 4 migrated **interaction states** to alpha-on-parent. Parent Task 3
moved the chrome **onto the gradient**. Nobody composed the two, so the _resting_ opaque fills now
sitting on the wash were never touched. `check-hover-tokens.mjs` cannot catch them by design — its
regex is `(?:hover|focus|active|…):bg-(?:accent|muted|secondary)`, i.e. **state prefixes only**
(`scripts/check-hover-tokens.mjs:18-20`). A bare `bg-muted` is invisible to it, correctly, because
`bg-muted` is still the right answer on the opaque content card.

**Verified sites** (all confirmed present at `60e7849`):

| File                                          | Line(s) | Class               | What lands on the wash                                                                                                                                                        |
| --------------------------------------------- | ------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/shell/org-switcher.tsx`       | 62, 72  | `bg-surface-muted`  | `#1c1c20` (dark) / `#f1f1f4` (light) chip at the top of the sidebar, where the bloom is strongest                                                                             |
| `src/components/shell/workspace-switcher.tsx` | 67, 77  | `bg-surface-muted`  | same, directly below it                                                                                                                                                       |
| `src/components/ui/skeleton.tsx`              | 11      | `bg-muted`          | via `SidebarNavSkeleton` (6 bars) + `HeaderUserSkeleton` (2 blocks), mounted at `authenticated-shell.tsx:69,79` — **opaque grey rectangles on the wash on every first paint** |
| `src/components/command-trigger.tsx`          | 19      | `bg-muted` kbd      | ⌘K chip in the header                                                                                                                                                         |
| `src/components/command-trigger.tsx`          | 12      | `variant="outline"` | the wrapping Button, whose variant carries opaque `bg-background` (`ui/button.tsx:15`); dark is already fine via `dark:bg-input/30`                                           |

**Why a new token rather than reusing `bg-state-active`.** `--state-active` is the _pressed_
interaction fill. Overloading it means a future "the pressed state is too weak" tweak silently
brightens every resting chip in the sidebar. The findings doc makes the same argument for the
scrollbar thumb in defect #5; apply it consistently. One new token, two themes, one `@theme` entry.

**Measured result** (composited, sRGB):

| Theme | Token                   | On the wash                      | Composite | Versus today                                                                                            |
| ----- | ----------------------- | -------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| Light | `rgb(0 0 0 / 5%)`       | `#eef0f8` (top stop)             | `#e2e4ec` | replaces flat `#f1f1f4`, which is _lighter_ than the wash below it — the chip currently reads as a hole |
| Dark  | `rgb(255 255 255 / 6%)` | `#353c5f` (top stop + 18% bloom) | `#454b6b` | replaces flat `#1c1c20`, a warm near-black patch on a cool periwinkle field                             |

**Files:**

- Modify: `src/app/globals.css` — `:root` (after line 203), `.dark` (after line 304), `@theme inline` (after line 44)
- Modify: `src/app/globals.tokens.test.ts` — `NEW_TOKENS` (line 19-28) and the registration list (line 60-69)
- Modify: `src/components/ui/skeleton.tsx`
- Modify: `src/components/ui/skeleton.test.tsx`
- Modify: `src/components/shell/sidebar-nav-skeleton.tsx` (line 16), `src/components/shell/sidebar-nav-skeleton.test.tsx`
- Modify: `src/components/shell/header-user-skeleton.tsx` (lines 12-13), `src/components/shell/header-user-skeleton.test.tsx`
- Modify: `src/components/shell/org-switcher.tsx` (62, 72), `src/components/shell/org-switcher.test.tsx`
- Modify: `src/components/shell/workspace-switcher.tsx` (67, 77), `src/components/shell/workspace-switcher.test.tsx`
- Modify: `src/components/command-trigger.tsx` (12, 19)
- Test: `src/components/command-trigger.test.tsx` (create)

**Interfaces:**

- Consumes: nothing from another task.
- Produces: CSS custom property **`--chrome-fill`** in `:root` and `.dark`; Tailwind theme entry
  **`--color-chrome-fill`**, i.e. the utility **`bg-chrome-fill`**; `Skeleton` prop
  **`variant?: "content" | "chrome"`**, defaulting to `"content"`. Tasks 3 and 5 edit the same two
  token blocks in `globals.css` and therefore run **after** this task, not beside it.

- [ ] **Step 1: Write the failing tests**

Add `--chrome-fill` to the `NEW_TOKENS` array in `src/app/globals.tokens.test.ts` (line 19-28):

```ts
const NEW_TOKENS = [
  "--app-wash",
  "--app-bloom",
  "--content-surface",
  "--content-edge",
  "--content-lift",
  "--state-hover",
  "--state-active",
  "--state-selected",
  "--chrome-fill",
];
```

and `"--color-chrome-fill:"` to the registration list in the third `it` (line 60-69).

**New vs. existing:** the two entries above are new; the _parity_ case ("keeps light and dark
palettes at parity", line 47-57) already covers both-theme declaration generically — declaring
`--chrome-fill` in only one block fails it with no new assertion required. That is the safety net
Global Constraints relies on.

Replace `src/components/ui/skeleton.test.tsx` with:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders an animated muted block and merges className", () => {
    const { container } = render(<Skeleton className="h-8 w-48" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("animate-pulse");
    expect(el).toHaveClass("h-8");
    expect(el).toHaveClass("w-48");
  });

  it("forwards arbitrary props like aria-hidden", () => {
    const { container } = render(<Skeleton aria-hidden="true" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  // REGRESSION LOCK. `Skeleton` is a shared primitive: 12 modules import it and
  // 67 call sites render it, almost all inside the opaque content card where
  // `bg-muted` is still exactly right. The chrome fix MUST be opt-in, so this
  // case exists to make "just change the default" fail loudly.
  it("defaults to the opaque content fill", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("bg-muted");
    expect(el.className).not.toMatch(/\bbg-chrome-fill\b/);
  });

  it("paints alpha-on-parent in the chrome variant", () => {
    const { container } = render(<Skeleton variant="chrome" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("bg-chrome-fill");
    expect(el.className).not.toMatch(/\bbg-muted\b/);
  });
});
```

Append to `src/components/shell/sidebar-nav-skeleton.test.tsx`:

```tsx
it("uses the chrome fill — it paints directly on the wash", () => {
  render(<SidebarNavSkeleton />);
  const region = screen.getByRole("status", { name: /loading navigation/i });
  const bars = region.querySelectorAll(".animate-pulse");
  expect(bars.length).toBeGreaterThanOrEqual(4);
  for (const bar of bars) {
    expect(bar).toHaveClass("bg-chrome-fill");
    expect(bar.className).not.toMatch(/\bbg-muted\b/);
  }
});
```

Append the equivalent to `src/components/shell/header-user-skeleton.test.tsx`, querying
`screen.getByRole("status", { name: /loading account/i })` and expecting exactly 2 bars.

Append to `src/components/shell/org-switcher.test.tsx` (and the identical case, with
`/switch workspace/i`, to `workspace-switcher.test.tsx`):

```tsx
it("gives the trigger an alpha-on-parent fill, not an opaque patch", () => {
  render(<OrgSwitcher orgs={orgs} activeOrgId="a" />);
  const trigger = screen.getByRole("button", {
    name: /switch organization/i,
  });
  expect(trigger.className).toContain("bg-chrome-fill");
  expect(trigger.className).not.toMatch(/\bbg-surface-muted\b/);
});
```

Create `src/components/command-trigger.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandTrigger } from "./command-trigger";
import { useUIStore } from "@/stores/ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
}));

describe("CommandTrigger", () => {
  it("opens the command palette", async () => {
    useUIStore.setState({ commandOpen: false });
    render(<CommandTrigger />);
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(useUIStore.getState().commandOpen).toBe(true);
  });

  /**
   * The trigger sits in the header, i.e. directly on the wash. The `outline`
   * button variant ships an opaque `bg-background` for light mode
   * (ui/button.tsx:15). Scoping the override HERE rather than editing the
   * variant is deliberate: `outline` is used across the whole product on the
   * opaque content card, where an opaque fill is correct. tailwind-merge drops
   * the losing `bg-background` from the emitted class string, and leaves the
   * variant's `dark:bg-input/30` alone because that is a different modifier
   * group — dark was already translucent and already fine.
   */
  it("does not paint an opaque button fill on the wash", () => {
    render(<CommandTrigger />);
    const button = screen.getByRole("button", { name: /search/i });
    expect(button.className).toContain("bg-transparent");
    expect(button.className).not.toMatch(/\bbg-background\b/);
    expect(button.className).toContain("dark:bg-input/30");
  });

  it("gives the kbd chip an alpha-on-parent fill", () => {
    const { container } = render(<CommandTrigger />);
    const kbd = container.querySelector("kbd") as HTMLElement;
    expect(kbd.className).toContain("bg-chrome-fill");
    expect(kbd.className).not.toMatch(/\bbg-muted\b/);
  });
});
```

**New vs. existing:** `command-trigger.test.tsx` is entirely new (the component had no test — the
first case is baseline behaviour coverage, cases 2-3 are the defect). The skeleton default-lock,
the two shell-skeleton cases and the two switcher cases are new assertions appended to existing
suites, all of which keep their current cases untouched.

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm vitest run src/app/globals.tokens.test.ts src/components/ui/skeleton.test.tsx \
  src/components/shell/sidebar-nav-skeleton.test.tsx \
  src/components/shell/header-user-skeleton.test.tsx \
  src/components/shell/org-switcher.test.tsx \
  src/components/shell/workspace-switcher.test.tsx \
  src/components/command-trigger.test.tsx
```

Expected: FAIL —
`--chrome-fill missing from :root`; `--color-chrome-fill: not registered in @theme`;
`variant="chrome"` is a TS error and renders `bg-muted`; the two shell skeletons render `bg-muted`;
both switcher triggers still carry `bg-surface-muted`; the ⌘K button has no `bg-transparent` and
the kbd has `bg-muted`. The `Skeleton` "defaults to the opaque content fill" case and the
CommandTrigger "opens the command palette" case **pass** immediately — those are the locks.

- [ ] **Step 3: Add the token**

In `src/app/globals.css`, in `:root` immediately after `--state-selected` (line 203):

```css
/* Resting fill for chrome that sits ON the wash — switcher chips, the ⌘K
     kbd, and the shell's first-paint skeletons. Alpha-on-parent so the
     gradient reads through instead of being punched out by a rectangular
     patch. Deliberately NOT --state-active: that is the pressed interaction
     fill and must stay free to be strengthened on its own. `--muted` /
     `--surface-muted` keep their identity as opaque fills on the content
     card, where they are still correct. */
--chrome-fill: rgb(0 0 0 / 5%);
```

In `.dark`, immediately after its `--state-selected` (line 304):

```css
--chrome-fill: rgb(255 255 255 / 6%);
```

In `@theme inline`, immediately after `--color-state-selected` (line 44):

```css
--color-chrome-fill: var(--chrome-fill);
```

- [ ] **Step 4: Add the Skeleton variant**

Replace `src/components/ui/skeleton.tsx` with:

```tsx
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  /**
   * Which surface this skeleton is painted on.
   *
   * - `content` (default) — the opaque `--muted` fill. Correct on the opaque
   *   inset content card, which is where all but two of the call sites live.
   * - `chrome` — alpha-on-parent `--chrome-fill`, for skeletons that paint
   *   directly on the wash (the shell's sidebar and header fallbacks). An
   *   opaque block there reads as a grey rectangle punched into the gradient
   *   on every first paint.
   *
   * A variant rather than a changed default on purpose: 12 modules import this
   * primitive across 67 call sites, and flipping the default would repaint all
   * of them to fix two.
   */
  variant?: "content" | "chrome";
};

export function Skeleton({
  className,
  variant = "content",
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md",
        variant === "chrome" ? "bg-chrome-fill" : "bg-muted",
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 5: Point the five consumers at it**

`src/components/shell/sidebar-nav-skeleton.tsx:16`:

```tsx
<Skeleton key={i} variant="chrome" className="h-7 w-full" />
```

`src/components/shell/header-user-skeleton.tsx:12-13`:

```tsx
      <Skeleton variant="chrome" className="size-8" />
      <Skeleton variant="chrome" className="size-8 rounded-full" />
```

`src/components/shell/org-switcher.tsx` lines 62 and 72, and
`src/components/shell/workspace-switcher.tsx` lines 67 and 77 — in each of the four
`DropdownMenuTrigger` className strings, replace the leading `bg-surface-muted` with
`bg-chrome-fill`. Change nothing else on those lines; `border-border card-lift
hover:border-border-bright` all stay.

`src/components/command-trigger.tsx` lines 11-21:

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={() => setOpen(true)}
  className="text-muted-foreground gap-2 bg-transparent"
>
  <Search className="size-4" />
  <span className="hidden sm:inline">Search…</span>
  <kbd className="bg-chrome-fill text-3xs ml-2 hidden rounded border px-1.5 font-mono sm:inline">
    ⌘K
  </kbd>
</Button>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run the same command as Step 2.
Expected: PASS — all suites green, including the unchanged pre-existing cases.

Then prove the blast radius really is contained:

Run: `pnpm vitest run src/components src/app`
Expected: PASS. Specifically, no content-card skeleton suite
(`MyWorkSkeleton`, `BoardsIndexSkeleton`, `PortfolioGridSkeleton`, `TimeCardSkeleton`,
`WorkloadGridSkeleton`, `GoalTreeSkeleton`, `DashboardCanvasSkeleton`, `settings/loading`) changes
behaviour — they never pass `variant`, so they keep `bg-muted`.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css src/app/globals.tokens.test.ts \
  src/components/ui/skeleton.tsx src/components/ui/skeleton.test.tsx \
  src/components/shell/sidebar-nav-skeleton.tsx src/components/shell/sidebar-nav-skeleton.test.tsx \
  src/components/shell/header-user-skeleton.tsx src/components/shell/header-user-skeleton.test.tsx \
  src/components/shell/org-switcher.tsx src/components/shell/org-switcher.test.tsx \
  src/components/shell/workspace-switcher.tsx src/components/shell/workspace-switcher.test.tsx \
  src/components/command-trigger.tsx src/components/command-trigger.test.tsx
git commit -m "fix(design): alpha-on-parent resting fills for chrome on the wash"
```

**Only verifiable by eye:** whether 5%/6% is the right strength. The tests prove the _right token_
is applied; they cannot prove the chip is still distinguishable from the wash behind it. If the
switcher chips vanish in light mode, raise the light value toward `rgb(0 0 0 / 7%)` — it is a
one-line change and the tests stay green. Task 6, sidebar top-left, both themes.

---

## Task 3: `--muted-foreground` clears WCAG AA on the wash (defect #3)

**Blast radius, stated up front.** `--muted-foreground` is referenced from **624 `text-muted-foreground`
class usages across 226 non-test `.tsx` files** (641 references counting `.ts`/`.css`). Changing the
token **repaints every muted label in the product** — nav labels, table meta, empty states, form
help text, timestamps, kickers' neighbours, everything. There is no scoped fix that is also honest:
the defect is that the _global_ muted grey is now judged against a _new_ background, and inventing a
chrome-only `--chrome-foreground` would leave two nearly-identical greys for the next reader to
confuse and to drift apart. Take the global change, and rely on the fact that it is **monotone
safe**: both values move _away_ from their backgrounds, so every existing pairing's contrast goes
**up**, never down. No surface in the app can acquire a new AA failure from this change.

**Measured, against the shipped hex values** (WCAG 2.x relative luminance, sRGB):

Light — the wash is `linear-gradient(168deg, #eef0f8 0%, #e6e9f3 46%, #d9dce8 100%)` and the bloom
is _white_ at 65%, which only ever **lightens** the surface, so the worst case is the darkest stop
with zero bloom:

| Surface                              | today `#6b6b72` | **new `#5c5c63`** |
| ------------------------------------ | --------------- | ----------------- |
| wash 0% `#eef0f8`                    | 4.65 ✓          | **5.83**          |
| wash 46% `#e6e9f3`                   | 4.36 ✗          | **5.47**          |
| **wash 100% `#d9dce8` — worst case** | **3.87 ✗**      | **4.85 ✓**        |
| content card `#ffffff`               | 5.29            | **6.63**          |
| `--surface-muted` `#f1f1f4`          | 4.69            | **5.88**          |

Dark — the bloom is `--brand` (`#8ea2eb`) at up to **22%** over the ramp, which **lightens** the
surface and therefore **reduces** contrast against light text. Worst case is the top stop at full
bloom:

| Surface                                            | today `#9a9aa2` | doc's `#a8a8b0` | **new `#b2b2ba`** |
| -------------------------------------------------- | --------------- | --------------- | ----------------- |
| `#212540` + 14% bloom (`#303758`)                  | 4.72            | 4.90            | **5.50**          |
| `#212540` + 18% bloom (`#353c5f`)                  | 4.36 ✗          | 4.53            | **5.08**          |
| **`#212540` + 22% bloom (`#394166`) — worst case** | **3.54 ✗**      | **4.19 ✗**      | **4.70 ✓**        |
| wash 46% `#141728`                                 | 6.36            | 7.52            | **8.43**          |
| content card `#0e0e10`                             | 6.90            | 8.17            | **9.16**          |

**Target contrast, stated as required:** ≥ **4.5:1** at every declared wash stop in both themes,
including the dark bloom composited at its full declared 22%. Achieved: **4.85:1** light,
**4.70:1** dark. The findings doc's suggested `#a8a8b0` is rejected — it fails at the bloom peak.

**Why not soften the wash instead.** The findings doc's alternative (bloom 22%→14%, light bottom
stop `#d9dce8`→`#e2e5ef`) changes the _owner-approved_ direction B, and the preview it says to check
against **does not exist** (see corrections table, row 7). Changing an approved look with no
reference to compare against is not a decision this plan can make. Nudging the token keeps the
approved wash byte-identical.

**Explicitly out of scope:** `--kicker` is `#9a9aa2` in light, which is ≈2.8:1 on the white content
card — already below AA _before_ this branch, unrelated to the wash, and `<Kicker>` is an eyebrow
label whose sites were not audited here. Do not fix it in this task; file it as its own follow-up.

**Files:**

- Modify: `src/app/globals.css:177` (`:root`), `src/app/globals.css:278` (`.dark`)
- Test: `src/app/globals.contrast.test.ts` (create)

**Interfaces:**

- Consumes: nothing from another task. Edits `globals.css` and therefore runs **after** Task 2.
- Produces: no new symbol. Later tasks depend on nothing from here.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/globals.contrast.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * WCAG AA for the dominant muted text ON THE WASH.
 *
 * This is the machine-checkable half of follow-up #3. It reads the shipped
 * values out of globals.css — the wash stops, the bloom alpha and
 * --muted-foreground — and recomputes contrast, so the numbers can never drift
 * away from the stylesheet the way a comment would.
 *
 * WHAT IT DOES NOT PROVE: that the resulting grey still reads as "muted"
 * rather than as body text. That is an eye judgement and belongs to the
 * visual pass, not here.
 *
 * Direction of the bloom matters and is why the two themes have different
 * worst cases:
 *   - light bloom is WHITE, so it lightens the surface and RAISES contrast
 *     against dark text → worst case is the darkest stop, bloom ignored.
 *   - dark bloom is --brand, so it lightens the surface and LOWERS contrast
 *     against light text → worst case is the lightest stop at full bloom.
 */
const AA = 4.5;

function blockOf(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  return CSS.slice(start, CSS.indexOf("\n}", start));
}

function declaration(selector: string, token: string): string {
  const m = blockOf(selector).match(
    new RegExp(`^\\s{2}${token}:\\s*([^;]+);`, "m"),
  );
  if (!m) throw new Error(`${token} not declared in ${selector}`);
  return m[1].trim();
}

type RGB = [number, number, number];

function hex(h: string): RGB {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Source-over composite of `fg` at `alpha` onto opaque `bg`. */
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i])) as RGB;
}

/** Every colour stop of a `linear-gradient(...)` declaration. */
function washStops(selector: string): string[] {
  const stops = declaration(selector, "--app-wash").match(/#[0-9a-f]{6}/gi);
  if (!stops || stops.length < 2) {
    throw new Error(`--app-wash in ${selector} has no parseable stops`);
  }
  return stops;
}

describe("muted text clears WCAG AA on the wash — light", () => {
  const fg = hex(declaration(":root", "--muted-foreground"));

  it.each(washStops(":root"))("clears AA on the %s stop", (stop) => {
    expect(contrast(fg, hex(stop))).toBeGreaterThanOrEqual(AA);
  });

  it("clears AA on the content card and on --surface-muted", () => {
    expect(
      contrast(fg, hex(declaration(":root", "--content-surface"))),
    ).toBeGreaterThanOrEqual(AA);
    expect(
      contrast(fg, hex(declaration(":root", "--surface-muted"))),
    ).toBeGreaterThanOrEqual(AA);
  });
});

describe("muted text clears WCAG AA on the wash — dark", () => {
  const fg = hex(declaration(".dark", "--muted-foreground"));
  const brand = hex(declaration(".dark", "--brand"));

  // The declared peak of `color-mix(in oklab, var(--brand) N%, transparent)`.
  const bloomPeak = (() => {
    const m = declaration(".dark", "--app-bloom").match(
      /var\(--brand\)\s+(\d+)%/,
    );
    if (!m) throw new Error("could not read the dark bloom percentage");
    return Number(m[1]) / 100;
  })();

  it.each(washStops(".dark"))("clears AA on the %s stop, unbloomed", (stop) => {
    expect(contrast(fg, hex(stop))).toBeGreaterThanOrEqual(AA);
  });

  it.each(washStops(".dark"))(
    "clears AA on the %s stop under the bloom at its declared peak",
    (stop) => {
      expect(
        contrast(fg, over(brand, bloomPeak, hex(stop))),
      ).toBeGreaterThanOrEqual(AA);
    },
  );

  it("clears AA on the content card", () => {
    expect(
      contrast(fg, hex(declaration(".dark", "--content-surface"))),
    ).toBeGreaterThanOrEqual(AA);
  });
});
```

**New vs. existing:** entirely new. No existing test computes contrast anywhere in the tree, which
is exactly why a token whose contrast the wash invalidated could ship green.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/globals.contrast.test.ts`
Expected: FAIL — 4 red cases with concrete numbers:
light `#e6e9f3` **4.36**, light `#d9dce8` **3.87**, dark `#212540` under peak bloom **3.54**, dark
`#141728` under peak bloom **4.24**. All four are below 4.5. The unbloomed dark stops and both
content-card cases pass, confirming the defect is specific to the wash and not to the token in
general.

- [ ] **Step 3: Nudge the token**

`src/app/globals.css:177` (`:root`):

```css
--muted-foreground: #5c5c63;
```

`src/app/globals.css:278` (`.dark`):

```css
--muted-foreground: #b2b2ba;
```

Add above the `:root` declaration:

```css
/* Tuned against the WASH, not against --background: the sidebar's muted nav
     labels sit on the gradient's dark end (light) and under the brand bloom
     (dark), which is where the old #6b6b72 / #9a9aa2 fell to 3.87:1 and
     3.54:1. Worst case is now 4.85:1 light / 4.70:1 dark at the bloom's full
     22%. Both moves are AWAY from their background, so every other pairing in
     the app gains contrast — see globals.contrast.test.ts. */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/app/globals.contrast.test.ts`
Expected: PASS — every stop, both themes, bloomed and unbloomed.

Run: `pnpm vitest run src/app/globals.tokens.test.ts`
Expected: PASS — parity is unaffected (values changed, names did not).

Run: `pnpm test`
Expected: PASS. No suite asserts a literal `--muted-foreground` hex; the change is value-only.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/globals.contrast.test.ts
git commit -m "fix(design): lift muted-foreground to AA against the wash"
```

**Only verifiable by eye — and this is the largest such gap in the plan.** The test proves the new
greys clear 4.5:1 everywhere they are painted. It cannot prove:

- that `#5c5c63` still reads as _secondary_ against `--foreground` `#1a1a1f` on the white card
  rather than as body text (the two are now 6.63:1 and 15.7:1 against white — a real but narrowed
  gap);
- that `#b2b2ba` at 9.16:1 on the dark card is not _too_ loud for meta text;
- that 624 call sites across 226 files all still look intentional.

Walk settings, an item panel and a board's table meta specifically for this, in **both** themes.
If the muted tone reads too strong on the content card, the correct escalation is **not** to revert
the token — it is to introduce a card-scoped muted variant in a follow-up, keeping the wash's AA fix
intact.

---

## Task 4: the scrollbar gutter reaches the real scrollers (defect #4)

**Root cause.** `globals.css:383-386` reserves the gutter for `main, [data-scroll-container]`. The
opt-in hook has **zero usages in `src/`** — the only match in the whole tree is its own declaration.
So spec §7's promise ("kills the content shift when a list crosses the overflow threshold") is
delivered to exactly one element, `<main>`, and missed by every list that actually grows.

**Why the skeleton mirrors are load-bearing.** Five loading skeletons duplicate their component's
scroller geometry precisely so the swap from fallback to content is CLS-free — the contract is
written into `sidebar-nav-skeleton.tsx:4-6` ("Rows match BoardsNav/DashboardsNav heights so streamed
content swaps in with zero layout shift"). If `WorkloadGrid` reserves a 10px gutter and
`WorkloadGridSkeleton` does not, the gutter _becomes_ the layout shift. The findings doc missed all
five. **Change each pair in the same commit.**

**Decision: keep `main` in the selector.** The findings doc suggests dropping it once the real
scrollers opt in. Don't. `main` genuinely scrolls on every form/prose page — settings, onboarding,
admin — and those are precisely where a list crossing the threshold shifts content. Removing it
reintroduces the defect on that whole class of page to save 10px on another. The accepted cost is
that board-style pages, which delegate scrolling to an inner container, reserve a gutter in `main`
that never fills: 10px of extra right padding inside the card, uniform across pages, so it reads as
padding rather than as a jump. **Put "does the double gutter read as dead space on a board?" on the
Task 6 checklist** — if it does, the follow-up is to make `main` `overflow-hidden` on routes that
own an inner scroller, which is a layout change and its own piece of work, not a drive-by here.

**The 21 sites** (all verified at `60e7849`). Content scrollers:

| #   | File                                                | Line |
| --- | --------------------------------------------------- | ---- |
| 1   | `src/components/boards/table/BoardTableInner.tsx`   | 653  |
| 2   | `src/components/boards/item-panel/ItemPanel.tsx`    | 172  |
| 3   | `src/components/boards/KanbanBoard.tsx`             | 440  |
| 4   | `src/components/boards/GanttBoard.tsx`              | 684  |
| 5   | `src/components/boards/calendar/CalendarMonth.tsx`  | 55   |
| 6   | `src/components/boards/calendar/CalendarWeek.tsx`   | 48   |
| 7   | `src/components/boards/calendar/CalendarAgenda.tsx` | 73   |
| 8   | `src/components/boards/import/ImportWizard.tsx`     | 324  |
| 9   | `src/components/goals/GoalTree.tsx`                 | 199  |
| 10  | `src/components/portfolios/PortfolioGrid.tsx`       | 120  |
| 11  | `src/components/time/TimeCard.tsx`                  | 215  |
| 12  | `src/components/workload/WorkloadGrid.tsx`          | 339  |
| 13  | `src/app/(app)/my-work/page.tsx`                    | 27   |
| 14  | `src/components/ai/ask/MessageList.tsx`             | 93   |
| 15  | `src/components/ai/ask/ConversationRail.tsx`        | 202  |
| 16  | `src/components/dashboards/WidgetConfigSheet.tsx`   | 141  |
| 17  | `src/components/reports/ReportBuilder.tsx`          | 140  |
| 18  | `src/components/shell/mobile-nav.tsx`               | 49   |

Skeleton mirrors — same commit, same attribute:

| #   | File                                                  | Line | Mirrors |
| --- | ----------------------------------------------------- | ---- | ------- |
| 19  | `src/components/goals/GoalTreeSkeleton.tsx`           | 26   | #9      |
| 20  | `src/components/my-work/MyWorkSkeleton.tsx`           | 31   | #13     |
| 21  | `src/components/portfolios/PortfolioGridSkeleton.tsx` | 18   | #10     |
| 22  | `src/components/time/TimeCardSkeleton.tsx`            | 33   | #11     |
| 23  | `src/components/workload/WorkloadGridSkeleton.tsx`    | 32   | #12     |

**Documented exemptions** (matched by the idiom, deliberately excluded):

| File                                                     | Line | Why                                                                                                                                                                                                      |
| -------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/dashboards/widgets/CompletionWidget.tsx` | 58   | A widget tile inside a dashboard card, often under 200px wide. A 10px permanent gutter is a large fraction of the tile — exactly the "short dropdown" case `globals.css:379-382` already argues against. |
| `src/components/ai/actions/QuickAction.tsx`              | 123  | A bounded modal panel with a fixed action list; it does not grow with user data.                                                                                                                         |

Not matched by the idiom and therefore never in scope: `GoalDetailDrawer.tsx:495` (`SheetContent`,
no `flex-1`), `ListWidget.tsx:29` (`h-full`), `FeedbackPopover.tsx:49` (`max-h`), and
`app-shell.tsx:50` (`main`, already covered by the selector).

**Files:**

- Modify: the 23 components/pages above (one attribute each)
- Modify: `src/app/globals.tokens.test.ts` — harden the gutter assertion (line 98-100)
- Test: `src/app/scroll-containers.test.ts` (create)

**Interfaces:**

- Consumes: the `[data-scroll-container]` selector already shipped at `globals.css:384`. Nothing
  from another task. Task 1 rewrites `src/app/ask/layout.tsx`; this task touches
  `MessageList.tsx` and `ConversationRail.tsx`, which are different files — no collision, but the
  `globals.tokens.test.ts` edit collides with Tasks 2 and 5, so this runs after both… see the DAG.
- Produces: the invariant "**every page-region scroller carries `data-scroll-container`**", enforced
  by `src/app/scroll-containers.test.ts`. Task 5 relies on nothing from here.

- [ ] **Step 1: Harden the existing gutter assertion**

The findings doc correctly notes the parent plan's test was a bare substring check that "would not
catch a revert to `*`" — it is what masked this defect. In `src/app/globals.tokens.test.ts`, replace
the third case of `describe("base-layer polish")` (lines 98-100) with:

```ts
it("reserves the gutter for main AND the opt-in hook — not for everything", () => {
  // A substring check for "scrollbar-gutter: stable" passes even if the
  // selector is reverted to `*`, which is what hid follow-up #4. Assert the
  // selector list itself.
  expect(CSS).toMatch(
    /\bmain,\s*\[data-scroll-container\]\s*\{\s*scrollbar-gutter:\s*stable;/,
  );
  // `*` would put a permanent 10px dead strip in every dropdown and popover.
  expect(CSS).not.toMatch(/^\s*\*\s*\{\s*scrollbar-gutter/m);
});
```

- [ ] **Step 2: Write the failing guard test**

```ts
// src/app/scroll-containers.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Every page-region scroller opts into `scrollbar-gutter: stable`.
 *
 * `globals.css` reserves the gutter for `main, [data-scroll-container]`, and
 * the opt-in hook shipped with ZERO usages — so the board table, the item
 * panel, kanban, gantt, calendar, my-work and the rest all still shift
 * sideways when a list crosses the overflow threshold. This test is what stops
 * that regressing back to zero.
 *
 * The idiom it recognises is this codebase's page-region scroller: `flex-1`
 * plus `overflow-auto` / `overflow-y-auto` on the same className string. That
 * deliberately excludes `max-h` popovers, `h-full` widget bodies and
 * `SheetContent` drawers, where a permanent gutter is dead space.
 *
 * LIMITATION, stated rather than hidden: this compares COUNTS per file, not
 * per element, so it cannot prove the attribute landed on the same JSX node as
 * the classes. It catches deletion, which is the regression that matters; the
 * visual pass catches misplacement.
 */

const SRC = join(process.cwd(), "src");

/** Bounded surfaces that match the idiom but must NOT reserve a gutter. */
const EXEMPT = new Set([
  // A dashboard widget tile, often <200px wide — 10px is a large fraction.
  "src/components/dashboards/widgets/CompletionWidget.tsx",
  // A bounded modal panel with a fixed action list; it does not grow.
  "src/components/ai/actions/QuickAction.tsx",
]);

const SCROLLER =
  /className=(?:"|\{`)[^"`]*\bflex-1\b[^"`]*\boverflow-(?:y-)?auto\b[^"`]*(?:"|`\})|className=(?:"|\{`)[^"`]*\boverflow-(?:y-)?auto\b[^"`]*\bflex-1\b[^"`]*(?:"|`\})/g;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (full.endsWith(".tsx") && !full.includes(".test.")) out.push(full);
  }
  return out;
}

export function findUnguardedScrollers(
  files: { path: string; source: string }[],
  exempt: Set<string> = EXEMPT,
): { path: string; scrollers: number; guards: number }[] {
  const hits = [];
  for (const { path, source } of files) {
    if (exempt.has(path)) continue;
    const scrollers = [...source.matchAll(SCROLLER)].length;
    if (scrollers === 0) continue;
    const guards = [...source.matchAll(/data-scroll-container/g)].length;
    if (guards < scrollers) hits.push({ path, scrollers, guards });
  }
  return hits;
}

describe("page-region scrollers reserve the scrollbar gutter", () => {
  const files = tsxFiles(SRC).map((path) => ({
    path: relative(process.cwd(), path).split(sep).join("/"),
    source: readFileSync(path, "utf8"),
  }));

  it("finds the known scrollers at all — the matcher is not vacuous", () => {
    // A regex that matched nothing would make the next case pass forever.
    const found = files
      .filter((f) => SCROLLER.test(f.source))
      .map((f) => f.path);
    SCROLLER.lastIndex = 0;
    expect(found).toContain("src/components/boards/table/BoardTableInner.tsx");
    expect(found).toContain("src/components/boards/item-panel/ItemPanel.tsx");
    expect(found.length).toBeGreaterThanOrEqual(20);
  });

  it("leaves no page-region scroller without the opt-in hook", () => {
    expect(findUnguardedScrollers(files)).toEqual([]);
  });

  it("keeps every skeleton in lockstep with the component it mirrors", () => {
    // A gutter on the content but not on its loading fallback turns the fix
    // into the layout shift it exists to prevent.
    const pairs: [string, string][] = [
      [
        "src/components/goals/GoalTree.tsx",
        "src/components/goals/GoalTreeSkeleton.tsx",
      ],
      [
        "src/app/(app)/my-work/page.tsx",
        "src/components/my-work/MyWorkSkeleton.tsx",
      ],
      [
        "src/components/portfolios/PortfolioGrid.tsx",
        "src/components/portfolios/PortfolioGridSkeleton.tsx",
      ],
      [
        "src/components/time/TimeCard.tsx",
        "src/components/time/TimeCardSkeleton.tsx",
      ],
      [
        "src/components/workload/WorkloadGrid.tsx",
        "src/components/workload/WorkloadGridSkeleton.tsx",
      ],
    ];
    const has = (p: string) =>
      files.find((f) => f.path === p)?.source.includes("data-scroll-container");
    for (const [component, skeleton] of pairs) {
      expect(has(component), `${component} must opt in`).toBe(true);
      expect(has(skeleton), `${skeleton} must match ${component}`).toBe(true);
    }
  });
});
```

**New vs. existing:** the whole file is new. The `globals.tokens.test.ts` case in Step 1 **replaces**
an existing weak assertion — note that in the commit message, since it is a strengthening, not an
addition.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/app/scroll-containers.test.ts src/app/globals.tokens.test.ts`
Expected: FAIL — "finds the known scrollers at all" **passes** (proving the matcher is live), while
"leaves no page-region scroller without the opt-in hook" reports ~21 files each with
`guards: 0`, and all five skeleton pairs report `false`. The hardened gutter assertion passes
immediately (the selector is already correct — it is the _usage_ that was missing), which is worth
noting in the report so nobody mistakes it for coverage of this defect.

- [ ] **Step 4: Prove the guard fails on purpose**

Guard discipline (Global Constraints). This test is guard-shaped — a passing green from an
allowlist that quietly swallowed everything looks identical to a real pass.

```bash
# 1. Temporarily exempt a file that genuinely needs the gutter.
#    Add "src/components/boards/table/BoardTableInner.tsx" to EXEMPT.
pnpm vitest run src/app/scroll-containers.test.ts
#    Expected: the "matcher is not vacuous" case still passes, proving the
#    exemption silenced a REAL scroller rather than the regex going blind.
# 2. Revert the EXEMPT edit.
# 3. Remove `data-scroll-container` from ItemPanel.tsx:172.
pnpm vitest run src/app/scroll-containers.test.ts
#    Expected: FAIL — [{ path: ".../ItemPanel.tsx", scrollers: 1, guards: 0 }]
# 4. Restore it. Re-run. Expected: PASS.
```

Record both failure outputs in the task report. A guard nobody has watched fail is decorative.

- [ ] **Step 5: Add the attribute to all 23 sites**

Mechanical and identical everywhere: add `data-scroll-container` as a bare boolean attribute on the
element that already carries the `flex-1 … overflow-*` className. Two worked examples —

`src/components/boards/table/BoardTableInner.tsx:653` (the element already has other `data-*`
attributes at 645-646; add alongside them, above `onScroll`):

```tsx
        data-testid="board-scroll"
        data-scroll-container
        data-scrolledx={scrolledX}
```

`src/components/boards/item-panel/ItemPanel.tsx:172`:

```tsx
        <div data-scroll-container className="flex-1 overflow-y-auto">
```

Apply the same edit to every row of both tables above. **Change nothing else** — no className
edits, no reflow, no reformatting. If a file's target element is hard to identify, cross-check
against the line number in the tables; they were read at `60e7849` and a rebase may have moved
them by a line or two.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/app/scroll-containers.test.ts src/app/globals.tokens.test.ts`
Expected: PASS — 3/3 and the hardened gutter case.

Run: `pnpm test`
Expected: PASS. `data-scroll-container` is inert markup — no suite queries by it, and Testing
Library selectors used elsewhere (`data-testid="board-scroll"`, roles, text) are untouched.

- [ ] **Step 7: Commit**

```bash
git add src/app/scroll-containers.test.ts src/app/globals.tokens.test.ts \
  src/components/boards src/components/goals src/components/portfolios \
  src/components/time src/components/workload src/components/my-work \
  src/components/ai/ask src/components/dashboards/WidgetConfigSheet.tsx \
  src/components/reports/ReportBuilder.tsx src/components/shell/mobile-nav.tsx \
  "src/app/(app)/my-work/page.tsx"
git commit -m "fix(design): opt the real page scrollers into the stable gutter"
```

Run `git status` first and confirm every staged path is one of the 23 plus the two test files —
those directory-level `git add`s are convenient but broad.

**Only verifiable by eye:** whether the gutter reads as intentional padding or as dead space,
especially on a board where `main`'s reserved gutter and the table's own now stack. That is the
open question this task deliberately defers — Task 6 decides it.

---

## Task 5: `--scrollbar-thumb` — the hover-only thumb becomes findable (defect #5)

**Root cause.** `globals.css:405-408` gives the resting hovered thumb `var(--state-active)` =
`rgb(0 0 0 / 7%)` in light. Over the white `--content-surface` that composites to `#ededed`, i.e.
**1.17:1** against the card. The escalation to `--border-bright` (22%) at `globals.css:410-413`
requires hovering the thumb itself — but you cannot aim at something you cannot see. Dark
(`rgb(255 255 255 / 9%)` → `#242426`, 1.24:1) is faint but findable against `#0e0e10`.

The Firefox fallback at `globals.css:415-419` sets `scrollbar-color: var(--state-active) transparent`
and has no thumb-hover selector at all, so on Firefox the weak value is the _only_ value. The
findings doc cites only lines 405-409 and would have left Firefox unfixed.

**Measured** (composited over `--content-surface`):

| Theme          | Value                    | Composite                  | vs. card   |
| -------------- | ------------------------ | -------------------------- | ---------- |
| Light, today   | `rgb(0 0 0 / 7%)`        | `#ededed` on `#ffffff`     | 1.17:1     |
| **Light, new** | `rgb(0 0 0 / 16%)`       | **`#d6d6d6`** on `#ffffff` | **1.45:1** |
| Dark, today    | `rgb(255 255 255 / 9%)`  | `#242426` on `#0e0e10`     | 1.24:1     |
| **Dark, new**  | `rgb(255 255 255 / 12%)` | **`#2b2b2d`** on `#0e0e10` | **1.36:1** |

**Honest framing:** this is a _findability_ fix, not a WCAG one. WCAG 1.4.11 wants 3:1 for
essential UI components; no alpha-on-white reaches that without turning the thumb into a solid mid-
grey bar, which is the always-visible scrollbar spec §7 deliberately removed. Browsers' own
overlay scrollbars sit in the same band. So the target is "unambiguously present at a glance", the
composited hexes above are the checkable artefact, and the judgement is the visual pass's.

**Why its own token.** `--state-active` doubles as the pressed interaction fill across the product.
Strengthening it to 16% to make a scrollbar visible would make every pressed row noticeably darker.
The findings doc makes this argument and it is correct; Task 2 applies the same reasoning to
`--chrome-fill`.

**Files:**

- Modify: `src/app/globals.css` — `:root` (after the `--chrome-fill` line added in Task 2), `.dark`
  (likewise), and the base-layer rules at 405-408, 410-413, 415-419
- Modify: `src/app/globals.tokens.test.ts` — `NEW_TOKENS` + a base-layer assertion

**Interfaces:**

- Consumes: nothing from another task, but edits the same two token blocks and the same
  `globals.tokens.test.ts` as Tasks 2-4 — it runs last in the `globals.css` chain.
- Produces: CSS custom property `--scrollbar-thumb` in both themes. **No `@theme inline` entry** —
  it is referenced only from raw CSS, and a `--color-scrollbar-thumb` alias would advertise a
  `bg-scrollbar-thumb` utility that nothing should use.

- [ ] **Step 1: Write the failing tests**

Add `"--scrollbar-thumb"` to `NEW_TOKENS` in `src/app/globals.tokens.test.ts`. The existing parity
case then enforces both-theme declaration with no further assertion.

Append to `describe("base-layer polish")`:

```ts
it("gives the scrollbar thumb its own token, not the interaction fill", () => {
  // --state-active is the PRESSED fill for rows, menu items and buttons.
  // Reusing it here means "make the scrollbar visible" and "make the pressed
  // state stronger" are the same knob — see follow-up #5.
  expect(CSS).toMatch(
    /:hover::-webkit-scrollbar-thumb,\s*:focus-within::-webkit-scrollbar-thumb\s*\{\s*background:\s*var\(--scrollbar-thumb\);/,
  );
  // Firefox has no thumb-hover selector, so its fallback is the ONLY value
  // it ever gets. Missing this is how the fix half-lands.
  expect(CSS).toMatch(
    /scrollbar-color:\s*var\(--scrollbar-thumb\)\s+transparent;/,
  );
  expect(CSS).not.toMatch(/scrollbar-color:\s*var\(--state-active\)/);
});
```

**New vs. existing:** both are new. The `NEW_TOKENS` entry rides the existing parity and
registration machinery.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/globals.tokens.test.ts`
Expected: FAIL — `--scrollbar-thumb missing from :root`; the hovered-thumb regex does not match
(the rule still says `var(--state-active)`); `scrollbar-color: var(--state-active)` is still
present.

- [ ] **Step 3: Add the token and rewire the rules**

In `:root`, directly after the `--chrome-fill` declaration added in Task 2:

```css
/* The hover-revealed scrollbar thumb. Its OWN token rather than
     --state-active: that token is also the pressed interaction fill, and the
     thumb needs roughly double the alpha to be findable on the white content
     card (7% composites to #ededed — 1.17:1, invisible). Hovering the thumb
     still escalates to --border-bright. */
--scrollbar-thumb: rgb(0 0 0 / 16%);
```

In `.dark`, after its `--chrome-fill`:

```css
--scrollbar-thumb: rgb(255 255 255 / 12%);
```

Then, in `@layer base`, replace `var(--state-active)` with `var(--scrollbar-thumb)` in **both**
places — `globals.css:405-408`:

```css
:hover::-webkit-scrollbar-thumb,
:focus-within::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  background-clip: content-box;
}
```

and the Firefox fallback at `globals.css:415-419`:

```css
@supports not selector(::-webkit-scrollbar) {
  * {
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }
}
```

Leave `:hover::-webkit-scrollbar-thumb:hover { background: var(--border-bright); }` (410-413)
untouched — the escalation is correct and now has a visible resting state to escalate _from_.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/app/globals.tokens.test.ts`
Expected: PASS — parity, registration (no new `@theme` entry expected), and the two new base-layer
matches.

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four green. This is the last code task; the full gate runs here.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/globals.tokens.test.ts
git commit -m "fix(design): give the scrollbar thumb its own visible token"
```

**Only verifiable by eye:** whether 16%/12% is actually findable without being an always-on bar.
Scroll a long board table and a settings page in both themes; the thumb should appear on pointer
entry, be obvious enough to aim at, and darken further on direct hover.

---

## Task 6: the both-themes visual pass — THE ACCEPTANCE GATE

> **This task cannot be discharged by the test suite, and the branch does not close without it.**
> It requires a running dev server **and an authenticated browser session**. The entire app is
> behind auth; the previous session could not sign in, which is why the only thing ever _seen_ was
> a static probe page against the compiled stylesheet — and why five defects reached `develop`. All
> of findings #1-#3 would have been caught by a five-minute walk.

**Files:** none. This task produces a written verdict, not a diff.

**Interfaces:**

- Consumes: Tasks 1-5, all merged into this branch.
- Produces: a go/no-go on promotion to `main`, plus any newly-found defect written up as a
  follow-up rather than silently patched.

- [ ] **Step 1: Reconstruct the acceptance reference**

The spec and the findings doc both say "compare against direction B in
`scratchpad/wash-directions.html`". **That file does not exist** — `scratchpad/` is absent from
this worktree and from the main checkout, is not in `.gitignore`, and `git ls-files` has never
tracked it. It was a throwaway preview in a session whose worktree was deleted.

Do **not** invent a new preview and compare against that — a fresh mockup would just re-approve
whatever was built. Use the written record instead, which is what the preview was made from:

- **Spec §1** (surface inversion), **§2** (Periwinkle Dusk token values), **§3** (the four
  highlights), **§4** (alpha-on-parent states) — `docs/superpowers/specs/2026-08-02-keystone-wash-and-polish-design.md:65-150`.
- The shipped values in `globals.css`: light wash `#eef0f8 → #e6e9f3 → #d9dce8` with a white 65%
  corner bloom; dark wash `#212540 → #141728 → #08090d` with a `--brand` 22% corner bloom; content
  card `#ffffff` light / `#0e0e10` dark.
- The composited hexes measured in Tasks 2, 3 and 5 of this plan.

- [ ] **Step 2: Walk both themes**

Start the app (`pnpm dev`), sign in, and walk this route list **twice — once in light, once in
dark** (toggle via the header theme control, which also exercises `next-themes`):

1. **Boards list** (`/boards`)
2. **A board — table view** (`/boards/<id>`)
3. **The same board — kanban view**
4. **An item panel** (open any item from the table)
5. **Settings** (`/settings`, and one sub-section so the `loading.tsx` skeleton flashes)
6. **`/ask`** — the Task 1 rewrite, the screen most changed by this branch
7. **Agents roster** (`/settings/agents`)

- [ ] **Step 3: Check the specific defects, per screen**

| Check                        | Where                                             | Expected                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#1** `/ask` rail           | `/ask`                                            | Rail is pure gradient, no fill, no divider line; conversation pane is a rounded inset card with a visible gutter. It must read as the same product as `/boards`.                                                                                      |
| **#2** switcher chips        | Sidebar top-left, both themes                     | Org/workspace chips read as a soft lightening of the wash beneath, not a rectangular patch. Compare against `#e2e4ec` (light) / `#454b6b` (dark).                                                                                                     |
| **#2** first-paint skeletons | Hard-reload any page and watch the sidebar/header | The 6 nav bars and 2 header blocks pulse as translucent shapes on the gradient — **no opaque grey rectangles**. This is the highest-frequency artefact in the whole branch; every single page load shows it.                                          |
| **#2** ⌘K chip               | Header                                            | Button has no opaque light-mode fill; the kbd chip is a soft alpha block.                                                                                                                                                                             |
| **#3** nav labels            | Sidebar, top **and bottom** items, both themes    | Inactive labels legible against the strongest bloom (top) and the darkest ramp end (bottom).                                                                                                                                                          |
| **#3** muted text at large   | Settings, item panel, board table meta            | Muted text still reads as _secondary_, not as body text (light) and not as too loud (dark). **This is the judgement the contrast test cannot make.**                                                                                                  |
| **#4** gutter                | Board table, item panel, kanban, my-work          | Crossing the overflow threshold (filter a list down and back) must not shift content sideways.                                                                                                                                                        |
| **#4** double gutter         | A board page                                      | **Open question this plan defers:** does `main`'s reserved gutter plus the table's own read as intentional padding or as dead space? If dead space, file a follow-up for `main: overflow-hidden` on inner-scroller routes — do **not** patch it here. |
| **#4** skeleton lockstep     | Reload `/my-work`, `/workload`, a portfolio       | No sideways jump when the skeleton swaps for content.                                                                                                                                                                                                 |
| **#5** scrollbar thumb       | Long board table + settings, both themes          | Thumb appears on pointer entry, is obvious enough to aim at, darkens on direct hover. Light is the failing case today.                                                                                                                                |

- [ ] **Step 4: Check what nobody has ever seen**

Findings 1-3 came from composition. These three migrations were reviewed per-task and **never
looked at**:

- **51-file hover-state migration** — hover a board row, a sidebar nav item, a dropdown item, a
  table cell and a kanban card. Each should be a soft lightening of what is beneath, with **no**
  rectangular grey patch. Check the carried-over alpha modifiers (`/50`, `/30`, `/20`) especially,
  since they now compound with the token's own alpha.
- **52-file type-scale migration (133 sites)** — nothing should read noticeably larger or smaller
  than before. Watch for flattened hierarchy where two previously-different sizes collapsed onto
  one token: settings rows, the agents roster, board column headers, item-panel field labels.
- **11 border removals** — no element should look unbounded or run into its neighbour.

- [ ] **Step 5: Record the verdict**

Write the result into the task report and the eventual `/wrapup` note:

- **Pass** → the branch may be closed (Step 6).
- **Fail** → capture each defect with screen, theme and expected-vs-actual. Small and local: fix in
  this branch with a test. Anything requiring a design decision (softening the wash, changing
  `main`'s overflow, a card-scoped muted variant): **new follow-up doc, do not decide it solo.**

- [ ] **Step 6: Close the branch — only after the owner signs off**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
scripts/finish-task.sh
```

Then hand the owner the "How to test this" walkthrough below. **Do not run `finish-task.sh` before
Step 5 returns a pass.** The prior session's implementer closed on its own initiative, skipped the
whole-branch review and destroyed the SDD ledger — that is the specific failure this plan exists
not to repeat.

---

## Execution DAG (working agreement #6)

### Dependency graph

```
T1  /ask surface model          depends on: nothing
T2  --chrome-fill               depends on: nothing
T3  --muted-foreground AA       depends on: T2   (file collision only)
T4  scrollbar gutter reach      depends on: T3   (file collision only)
T5  --scrollbar-thumb           depends on: T4   (file collision only)
T6  visual pass (ACCEPTANCE)    depends on: T1, T2, T3, T4, T5
```

### Why T2 → T3 → T4 → T5 is serial, and not a DAG failure

There is **no logical dependency** between defects #2-#5 — each is independently correct and none
consumes a symbol from another. The edge is purely **file collision**, and it is real:

|        | `globals.css` `:root`     | `globals.css` `.dark`     | `globals.css` `@theme`    | `globals.css` `@layer base` | `globals.tokens.test.ts`         |
| ------ | ------------------------- | ------------------------- | ------------------------- | --------------------------- | -------------------------------- |
| **T2** | add `--chrome-fill`       | add `--chrome-fill`       | add `--color-chrome-fill` | —                           | `NEW_TOKENS` + registration list |
| **T3** | edit `--muted-foreground` | edit `--muted-foreground` | —                         | —                           | —                                |
| **T4** | —                         | —                         | —                         | —                           | replace the gutter case          |
| **T5** | add `--scrollbar-thumb`   | add `--scrollbar-thumb`   | —                         | rewrite thumb rules ×2      | `NEW_TOKENS` + new case          |

Three of the four tasks append to the _same two token blocks_, and three edit the same test file —
T2 and T5 both mutate the same `NEW_TOKENS` array literal. Run in parallel worktrees these are
**guaranteed** rebase conflicts in the highest-traffic file on the branch, and the merge resolution
would be hand-reconstructing a stylesheet, which is exactly how a token gets silently dropped from
one theme. Serializing four ~15-minute edits is strictly cheaper than that. Say it plainly rather
than drawing a wide batch that cannot actually run.

### Parallel batches

| Batch | Tasks          | Concurrency | Note                                                                                                                                                              |
| ----- | -------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | **T1**, **T2** | 2 agents    | The only genuine parallelism. T1 touches `src/app/ask/layout.tsx` + a new test; T2 touches `globals.css`, `ui/skeleton.tsx` and `shell/*`. **Zero file overlap.** |
| **B** | T3             | 1           | `globals.css` after T2                                                                                                                                            |
| **C** | T4             | 1           | `globals.tokens.test.ts` after T2; 23 component files, none touched by T1-T3                                                                                      |
| **D** | T5             | 1           | `globals.css` + `globals.tokens.test.ts` after T4                                                                                                                 |
| **E** | **T6**         | 1 (human)   | The acceptance gate                                                                                                                                               |

**Practical note:** all six tasks run in the single existing worktree
`.claude/worktrees/keystone-wash-followups` on `task/keystone-wash-followups`. Under
`subagent-driven-development` in one worktree, execution is serial anyway — Batch A's value is that
T1 and T2 may be dispatched together without either needing to wait for a review of the other, and
that a reviewer can gate them independently.

### Critical path

```
T2 → T3 → T4 → T5 → T6        (5 nodes)
```

T1 is off the critical path entirely — it is the highest-severity defect and the cheapest fix, so
schedule it in Batch A and it is done before the token chain reaches its second link.

**Wall-clock floor:** four small serial edits plus the visual walk. T4 is the longest code task (23
mechanical file edits + a guard proven to fail); T6 is the longest overall and is human-bound —
roughly 20-30 minutes for a careful two-theme, seven-screen walk. **The floor is set by T6, not by
the code.**

---

## Self-review

Run against the findings doc, section by section.

**1. Coverage.** All five defects have a task, in the findings doc's severity order:
#1→T1, #2→T2, #3→T3, #4→T4, #5→T5. The "Then: the visual pass that never happened" section →T6.

**Deliberately not in this plan** (from the findings doc's "Loose ends worth knowing" — each is a
real item, none blocks promotion, and folding them in would smuggle unreviewed scope into a
defect-fix branch):

- `--duration-instant/standard/arrival` emit nothing (Tailwind 4.3 has no `--duration-*` theme
  namespace). Documentation, not utilities. Confirmed still true; `globals.tokens.test.ts:74-84`
  asserts they are _declared_, which is honest as far as it goes. **Follow-up.**
- The spec §3.3 "2px left indicator" on the selected state was never built. **Follow-up.**
- `--sidebar*` is 6 dead declarations × 2 themes. After T1 removes the last `bg-sidebar` consumer
  they are provably unreferenced. **Follow-up** — deleting 12 declarations is a separate, testable
  cleanup, and doing it inside T1 would bury it.
- `--kicker` at ≈2.8:1 on the white card (found while measuring T3). Pre-existing, unrelated to the
  wash. **Follow-up.**
- `.claude/worktrees/keystone-wash` empty directory — housekeeping, not code.

**2. Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar to Task N", no
"write tests for the above". Every code step carries the literal code. Every test step names the
command and the expected failure text.

**3. Type/name consistency.**

- `--chrome-fill` / `--color-chrome-fill` / `bg-chrome-fill` — spelled identically in T2's CSS,
  T2's `NEW_TOKENS` entry, all six consumer edits and every assertion.
- `--scrollbar-thumb` — T5 only; deliberately **no** `--color-*` alias, stated in two places so a
  future reader does not "fix" the omission.
- `Skeleton`'s prop is `variant?: "content" | "chrome"`, default `"content"` — same spelling in the
  type, the implementation, both consumers and all four test cases.
- `data-scroll-container` — matches the selector already shipped at `globals.css:384`.
- `findUnguardedScrollers` is exported from `scroll-containers.test.ts` so the guard-failure drill
  in T4 Step 4 can be reasoned about directly.

**4. One thing this plan cannot promise.** Four of five defects are "the wrong colour on the wrong
surface". Every test here proves the _right token is applied_; none proves the _result looks right_.
That is stated per task under "Only verifiable by eye", and it is why T6 is a task with a checklist
rather than a closing sentence.

---

## How to test this (for the user)

Everything below needs a login. Nothing is live — `develop` does not deploy; only `main` does.

1. **Get the code.** Pull `develop`, run `pnpm install` (a rebase may have moved deps), then
   `pnpm dev`. Sign in.
2. **Open `/ask`.** This is the screen that currently looks broken. **Expected:** the conversation
   rail on the left is a soft periwinkle gradient with no fill and **no vertical divider line**, and
   the conversation itself sits in a rounded card with a visible gutter on its right and bottom —
   exactly like a board page. _Before this branch it was a flat slab identical in colour to the pane
   beside it._
3. **Hard-reload any page and watch the sidebar for the first half-second.** **Expected:** the six
   nav placeholder bars and the two header blocks pulse as translucent shapes that let the gradient
   through. _Before: eight opaque grey rectangles punched into the wash, on every single page load._
4. **Look at the top-left of the sidebar** (the org / workspace chips). **Expected:** each reads as
   a soft lightening of the gradient behind it. _Before: a flat rectangular patch — warm near-black
   in dark, near-white in light._
5. **Read the sidebar nav labels — the top ones and the bottom ones.** **Expected:** comfortably
   legible in both places. _Before: the bottom labels measured 3.87:1 in light and the top ones
   3.54:1 under the dark bloom, against a 4.5:1 accessibility floor._
6. **Open a board in table view and filter the list down until the scrollbar disappears, then clear
   the filter.** **Expected:** the columns do **not** jump sideways. Repeat in the item panel and on
   `/my-work`.
7. **Scroll a long board table and hover near the right edge.** **Expected:** a scrollbar thumb
   fades in, is obvious enough to aim at, and darkens when you hover it directly. _Before, in light
   mode, it was `#ededed` on white — effectively invisible, so the "hover the thumb" affordance was
   unusable._
8. **Toggle to the other theme (header control) and repeat steps 2-7.** Both themes are in scope;
   light changed more than dark.
9. **Walk `/boards`, a board in table **and** kanban, an item panel, `/settings`, `/ask` and
   `/settings/agents` in both themes** and say whether anything looks wrong. Specifically: does
   muted text still read as _secondary_ rather than as body text? Do hover states read as a soft
   lightening rather than a grey block? Does any text look noticeably bigger or smaller than you
   remember? **This step is the actual acceptance gate — the test suite cannot answer any of it.**
10. **Verdict.** If it all reads right, this is promotable to `main`. If anything is off, say which
    screen and which theme; small fixes land on this branch, anything needing a design decision
    becomes its own follow-up.
