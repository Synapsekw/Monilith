# UI Polish + Theme Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the washed-out light-mode nav, add user-selectable full theme presets, and close the six polish gaps the 2026-09-08 audit found (page headers, kickers, AA pills, radius, shadows, loading/error states, landing/brand hex drift).

**Architecture:** Six independent tracks (A–F), each a `task/<name>` worktree merged into `develop` by `scripts/finish-task.sh`. Theme presets override a small seed-token set in `globals.css` via `data-theme-preset` on `<html>`, persisted on `profiles.theme_preset` with a localStorage no-flash mirror. Everything else in the app already derives from those seeds.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), Tailwind v4 `@theme inline`, next-themes, Supabase (RLS, versioned migrations), Zod, Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-09-08-ui-polish-and-theme-presets-design.md`.

## Global Constraints

- Tokens only — never raw Tailwind palette colors or hardcoded hex in app code (`pulse-ui` skill; guarded by `status-pill.test.tsx:13`).
- `globals.tokens.test.ts` enforces light/dark **parity** of every token in `:root` vs `.dark` — declare new tokens in both.
- `globals.contrast.test.ts` reads real CSS values — any wash/bloom/kicker/muted change must keep it green.
- Migrations: mint with `scripts/new-migration.sh <slug>`; apply to DEV via the `supabase-dev` MCP `apply_migration` with the **same version + name**; run `pnpm db:ledger-check`; regenerate types with the MCP `generate_typescript_types` + prettier (worktree `pnpm db:types` fails). DEV holds live user data — additive migrations only.
- Server Actions return `ActionResult` / `fail` from `src/lib/actions/result.ts`.
- Every track: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green, then `scripts/finish-task.sh` from inside the worktree. Commit author `Danijel Jovanovic <info@synapse-solutions.ai>`; stage by path; commitlint subjects lowercase.
- `pnpm lint` also runs `scripts/check-hover-tokens.mjs`, `check-px-text.mjs`, `check-board-chrome.mjs` — read their headers if they fail.
- Load `pulse-ui` + `frontend-design` skills before touching any UI.

---

## Execution DAG

| Task | Track | Depends on | Batch |
| ---- | ----- | ---------- | ----- |
| 1    | A     | —          | 1     |
| 2    | C     | —          | 1     |
| 3    | D     | —          | 1     |
| 4    | E     | —          | 1     |
| 5    | B     | 1 (merged) | 2     |
| 6    | F     | 5 (merged) | 3     |

- **Batch 1 (parallel):** Tasks 1, 2, 3, 4 — four worktrees, one agent each.
- **Batch 2:** Task 5 after Task 1 merges (both edit `globals.css` light block + contrast test).
- **Batch 3:** Task 6 after Task 5 merges (imports `src/lib/theme/presets.ts`).
- **Critical path:** 1 → 5 → 6.
- **Merge order within batch 1** (orchestrator serializes `finish-task.sh`): 1, then 3 (adds `--shadow-drag` to `globals.css` — trivial rebase), then 2, then 4.

---

### Task 1: Light-mode nav fix (Track A)

**Worktree:** `scripts/start-task.sh light-nav-fix`

**Files:**

- Modify: `src/app/globals.css` (light `:root` block, lines ~177–250)
- Modify: `src/components/shell/sidebar-nav.tsx:84-85, 114-115`
- Test: `src/app/globals.contrast.test.ts`

**Interfaces:**

- Consumes: existing tokens `--brand`, `--app-wash`, `--app-bloom`, `--kicker`, `--content-edge`, `--state-selected`, `--content-surface`.
- Produces: the light `--app-bloom` recipe `color-mix(in oklab, var(--brand) 12%, white)` (Task 5 copies it into every preset); `--kicker` guarded by the contrast test; `bg-state-selected` as the nav active fill.

- [ ] **Step 1: Write the failing contrast tests**

Append to `src/app/globals.contrast.test.ts` (reuse the file's `hex`, `contrast`, `over`, `washStops`, `declaration` helpers):

```ts
describe("kicker text clears WCAG AA on the wash — light", () => {
  const fg = hex(declaration(":root", "--kicker"));
  it.each(washStops(":root"))("clears AA on the %s stop", (stop) => {
    expect(contrast(fg, hex(stop))).toBeGreaterThanOrEqual(AA);
  });
});

describe("kicker text clears WCAG AA on the wash — dark", () => {
  const fg = hex(declaration(".dark", "--kicker"));
  const brand = hex(declaration(".dark", "--brand"));
  const bloomPeak = (() => {
    const m = declaration(".dark", "--app-bloom").match(
      /var\(--brand\)\s+(\d+)%/,
    );
    if (!m) throw new Error("could not read the dark bloom percentage");
    return Number(m[1]) / 100;
  })();
  it.each(washStops(".dark"))(
    "clears AA on the %s stop under the bloom",
    (stop) => {
      expect(
        contrast(fg, over(brand, bloomPeak, hex(stop))),
      ).toBeGreaterThanOrEqual(AA);
    },
  );
});

describe("light chrome separates from the content card", () => {
  // The bloom source is `color-mix(in oklab, var(--brand) P%, white)` at alpha A
  // over the FIRST wash stop (top-left is where the header band lives).
  // Approximate the oklab mix with an sRGB mix — conservative for this check.
  it("bloomed header band vs --content-surface ≥ 1.15:1", () => {
    const bloom = declaration(":root", "--app-bloom");
    const pm = bloom.match(/var\(--brand\)\s+(\d+)%,\s*white\)\s*\/?\s*(\d+)%/);
    if (!pm)
      throw new Error(
        "light bloom must be color-mix(in oklab, var(--brand) P%, white) / A%",
      );
    const brand = hex(declaration(":root", "--brand"));
    const src = over(brand, Number(pm[1]) / 100, [255, 255, 255]);
    const band = over(src, Number(pm[2]) / 100, hex(washStops(":root")[0]));
    const card = hex(declaration(":root", "--content-surface"));
    expect(contrast(band, card)).toBeGreaterThanOrEqual(1.15);
  });
});
```

Note: the existing dark `--muted-foreground` describe already declares `bloomPeak`; keep the new one local to its own describe (no shared top-level state).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/app/globals.contrast.test.ts`
Expected: light kicker stops FAIL (~2.5:1); "light chrome separates" FAILS (bloom regex does not match the current `rgb(226 232 250 / 55%)` form).

- [ ] **Step 3: Retune the light tokens in `globals.css`**

In the `:root` block:

```css
--kicker: #6e6e77;
/* … */
--content-edge: rgb(0 0 0 / 12%);
/* … */
--state-selected: color-mix(in oklab, var(--brand) 14%, transparent);
/* Periwinkle Dusk — light. Chrome only; content stays neutral. The first stop
     sits slightly below the bloom so the bloom has visible range (the Aug 27
     tint had collapsed the two onto the same value — a no-op bloom). */
--app-wash: linear-gradient(168deg, #dde2f2 0%, #d6dbee 46%, #cfd4e6 100%);
/* Brand-derived, lighter than every wash stop: raises contrast against dark
     text (see globals.contrast.test.ts) and lets theme presets inherit it. */
--app-bloom: radial-gradient(
  110% 85% at 8% -6%,
  color-mix(in oklab, var(--brand) 12%, white) / 70% 0%,
  transparent 58%
);
```

If `color-mix(...) / 70%` does not parse in the build (Tailwind/Lightning CSS), use the equivalent `color-mix(in oklab, color-mix(in oklab, var(--brand) 12%, white) 70%, transparent)` and adjust the test regex to `var\(--brand\)\s+(\d+)%,\s*white\)\s+(\d+)%`.

Verify light `--muted-foreground` (`#5c5c63`) still clears 4.5 on the deepened stops (test covers it). Dark `--kicker` `#6b6b72`: if the new dark test fails, lift to `#8a8a93`.

- [ ] **Step 4: Update the nav active state in `sidebar-nav.tsx`**

Both `ExpandedLink` (line ~84) and `CollapsedLink` (line ~114):

```tsx
active
  ? "bg-state-selected border-primary/40 text-foreground"
  : "text-muted-foreground hover:border-border hover:text-foreground",
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/app/globals.contrast.test.ts src/app/globals.tokens.test.ts src/components/shell`
Expected: PASS.

- [ ] **Step 6: Visual check + commit**

Run the dev server, toggle Light: sidebar shows a visible top-left bloom fading to lavender; "BOARDS"/"DASHBOARDS" legible; active item clearly tinted; visible edge between chrome and the white card. Then:

```bash
git add src/app/globals.css src/components/shell/sidebar-nav.tsx src/app/globals.contrast.test.ts
git commit -m "fix(theme): give the light-mode chrome real contrast

The light bloom collapsed onto the first wash stop (no-op), --kicker sat at
2.5:1, the nav active fill was 10% brand on a brand-tinted ground, and the
chrome/card edge was 7% black. Bloom is now brand-derived and lighter than the
wash, kicker clears AA on every stop (guarded), active uses --state-selected,
content-edge is 12%."
```

- [ ] **Step 7: Gate + finish**

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` → `scripts/finish-task.sh`.

---

### Task 2: PageHeader primitive + Kicker migration (Track C)

**Worktree:** `scripts/start-task.sh page-header-kicker`

**Files:**

- Create: `src/components/ui/page-header.tsx`, `src/components/ui/page-header.test.tsx`
- Modify: `src/components/ui/kicker.tsx` (add `size` prop), `src/components/ui/kicker.test.tsx` (create if absent)
- Modify: route headers — `src/app/(app)/boards/page.tsx:47`, `(app)/my-work/page.tsx:20`, `(app)/goals/page.tsx:30`, `(app)/portfolios/page.tsx:14`, `src/components/workload/WorkloadGrid.tsx:248`, `src/components/time/TimeCard.tsx:184`, `src/components/dashboards/DashboardCanvas.tsx:122`, `src/components/reports/ReportsIndex.tsx:88`, `src/components/boards/BoardHeader.tsx:154`, `src/components/settings/settings-section.tsx:21`, `src/app/updates/page.tsx:29-30`, `src/app/admin/page.tsx`, `admin/users/page.tsx:62`, `admin/organizations/page.tsx:49`, `admin/audit/page.tsx`
- Modify: the 39 hand-rolled kicker sites (find with `grep -rn "uppercase" src --include=*.tsx | grep "tracking-"`), notably `src/components/platform/stat-card.tsx:4`, `feedback/AdminFeedbackDetail.tsx:100,219`, `feedback/FeedbackFilters.tsx:144`, `boards/FirstBoardEmptyState.tsx:95`, `boards/ColumnHeader.tsx:136`, `boards/SummaryRow.tsx:156`, `reports/ReportsIndex.tsx:38`
- Test: `src/components/ui/kicker-usage.test.ts` (grep guard)

**Interfaces:**

- Produces:

  ```ts
  // src/components/ui/kicker.tsx
  export function Kicker(props: {
    index?: string;
    size?: "sm" | "xs";
    className?: string;
    children: ReactNode;
  }): JSX.Element;
  // size "sm" (default) = text-2xs; "xs" = text-3xs (dense table/column labels)

  // src/components/ui/page-header.tsx  (server component)
  export function PageHeader(props: {
    title: ReactNode;
    kicker?: ReactNode;
    index?: string;
    description?: ReactNode;
    actions?: ReactNode;
    as?: "h1" | "h2"; // default h1; settings sections pass h2
    className?: string;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write failing tests**

`src/components/ui/page-header.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders an h1 with the shared type ramp", () => {
    render(<PageHeader title="Boards" />);
    const h = screen.getByRole("heading", { level: 1, name: "Boards" });
    expect(h.className).toMatch(/font-heading/);
    expect(h.className).toMatch(/text-lg/);
    expect(h.className).toMatch(/font-semibold/);
  });
  it("renders kicker, description and actions when given", () => {
    render(
      <PageHeader
        kicker="Planning"
        index="01"
        title="Goals"
        description="Quarter view"
        actions={<button>New</button>}
      />,
    );
    expect(screen.getByText("Planning")).toHaveClass("text-kicker");
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("Quarter view")).toHaveClass(
      "text-muted-foreground",
    );
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
  it("can render as h2 for nested sections", () => {
    render(<PageHeader as="h2" title="Profile" />);
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });
});
```

`src/components/ui/kicker-usage.test.ts` (grep guard; mirrors `status-pill.test.tsx`'s approach):

```ts
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

const ALLOW = ["src/components/ui/kicker.tsx", "src/components/landing/"];

describe("kickers use <Kicker>", () => {
  it("no hand-rolled uppercase+tracking labels outside the primitive", () => {
    const out = execFileSync(
      "grep",
      [
        "-rlE",
        'uppercase[^"]*tracking-|tracking-[^"]*uppercase',
        "src",
        "--include=*.tsx",
      ],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter((f) => !ALLOW.some((a) => f.startsWith(a)));
    expect(out).toEqual([]);
  });
});
```

(If `grep` exits 1 on zero matches, wrap in try/catch and treat as empty.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/ui/page-header.test.tsx src/components/ui/kicker-usage.test.ts`
Expected: FAIL (module not found; ~39 files listed).

- [ ] **Step 3: Implement `Kicker` size + `PageHeader`**

`kicker.tsx`: add `size?: "sm" | "xs"` → `size === "xs" ? "text-3xs" : "text-2xs"` in the class list; everything else unchanged.

`page-header.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";

/**
 * The one page-title recipe. Kicker (optional) above an h1 on the shared type
 * ramp, optional description, right-aligned actions. Every top-level route
 * renders this so headings stop drifting between weights and sizes.
 */
export function PageHeader({
  title,
  kicker,
  index,
  description,
  actions,
  as: Tag = "h1",
  className,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  index?: string;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {kicker ? (
          <Kicker index={index} className="block">
            {kicker}
          </Kicker>
        ) : null}
        <Tag className="font-heading text-lg font-semibold tracking-tight">
          {title}
        </Tag>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Migrate the route headers**

Replace each listed heading with `<PageHeader …>`; `updates/page.tsx` drops `nunito.className` (fonts come from `layout.tsx`). `settings-section.tsx` uses `as="h2"`. `BoardHeader.tsx` keeps its own dense row but changes the title classes to `font-heading text-lg font-semibold tracking-tight`. Goals/portfolios pass `kicker="Planning"`; admin pages pass `kicker="Platform"`; boards/my-work/dashboards/reports/time/workload pass no kicker (keep the header quiet — kickers are for grouped sections).

- [ ] **Step 5: Migrate the 39 kicker sites**

For each grep hit: replace the class string with `<Kicker>` (or `<Kicker size="xs">` where it was `text-3xs`). If the host is a `<th>`/table label, keep the element and put `<Kicker>` inside. Column headers in `ColumnHeader.tsx` are `size="xs"`.

- [ ] **Step 6: Run all tests**

Run: `pnpm vitest run src/components src/app`
Expected: PASS, guard lists `[]`.

- [ ] **Step 7: Commit + gate + finish**

```bash
git add src/components/ui/page-header.tsx src/components/ui/page-header.test.tsx src/components/ui/kicker.tsx src/components/ui/kicker-usage.test.ts <migrated files>
git commit -m "feat(ui): shared PageHeader and Kicker everywhere"
```

Then gates → `scripts/finish-task.sh`.

---

### Task 3: AA pills, radius unification, shadows (Track D)

**Worktree:** `scripts/start-task.sh pill-aa-radius-shadows`

**Files:**

- Modify: `src/components/boards/cells/index.tsx:341, 203`, `src/components/boards/cells/editors/index.tsx:249`, `src/components/boards/FileTypeChip.tsx:58`, `src/components/boards/presence/PresenceRing.tsx:52`
- Modify (soft pills): `src/components/ai/column-fill/SmartFillGrid.tsx:111`, `boards/import/ConfirmStep.tsx:125`, `import/MapStep.tsx:207`, `import/MappingGrid.tsx:210,216,318`, `boards/gantt/GanttRowItem.tsx:237`
- Modify (radius): `src/components/ui/card.tsx:15`, `ui/dialog.tsx:64`, `ui/alert-dialog.tsx:61` (`rounded-xl` → `rounded-lg`, incl. `*:[img:first-child]:rounded-t-xl` → `rounded-t-lg`), and the 32 `rounded-xl` sites under `src/app/admin/**`, `src/components/platform/stat-card.tsx`, `src/components/feedback/**` (grep `rounded-xl` in those paths). **Do not** touch `app-shell.tsx` / `ask/layout.tsx` `<main>`.
- Modify (shadows): `SubmitFeedbackForm.tsx:55,67`, `FeedbackPopover.tsx:27,39`, `PresenceFlashMessage.tsx:40`, `PresenceRing.tsx:52`, `item-panel/PdfPreview.tsx:96` (remove `shadow-sm`); `BoardBulkBar.tsx:92`, `table/BoardTableInner.tsx:717`, `item-panel/MentionTextarea.tsx:103` (→ `shadow-panel`); drag-lift `BoardsNavSortable.tsx:109`, `PlainBoardRow.tsx:53`, `SharedBoardRow.tsx:72`, `table/GroupSection.tsx:183`, `table/ItemRow.tsx:159`, `table/SortableSubitemRow.tsx:78`, `ColumnHeader.tsx:107` (`shadow-lg` → `shadow-drag`)
- Modify: `src/app/globals.css` (add `--shadow-drag` light + dark, `--shadow-drag: var(--shadow-drag)` in `@theme inline`), `src/app/globals.tokens.test.ts` (register `--shadow-drag:`)
- Modify: `.claude/skills/pulse-ui/SKILL.md` (one line: content card is the only `rounded-xl`; `shadow-drag` is the drag-lift shadow)
- Test: `src/components/ui/status-pill.test.tsx` (extend), `src/components/ui/radius.test.ts` (new grep guard)

**Interfaces:**

- Consumes: `StatusPill`, `statusToneClasses` from `src/components/ui/status-pill.tsx`.
- Produces: `--shadow-drag` token / `shadow-drag` utility.

- [ ] **Step 1: Write failing guards**

Extend `status-pill.test.tsx` regex guard so it also fails on `text-white` adjacent to `bg-status-*` or `TONE_FILL` anywhere in `src/components` (the current guard only checks raw palette colors — read it and add a second `it`). Add `src/components/ui/radius.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
const ALLOW = ["src/components/app-shell.tsx", "src/app/ask/layout.tsx"];
describe("one card radius", () => {
  it("no rounded-xl outside the content card", () => {
    let files: string[] = [];
    try {
      files = execFileSync(
        "grep",
        ["-rl", "rounded-xl", "src", "--include=*.tsx"],
        { encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean);
    } catch {
      files = [];
    }
    expect(files.filter((f) => !ALLOW.includes(f))).toEqual([]);
  });
  it("no raw shadow-{sm,md,lg,xl} in app components", () => {
    let files: string[] = [];
    try {
      files = execFileSync(
        "grep",
        [
          "-rlE",
          "\\bshadow-(sm|md|lg|xl|2xl)\\b",
          "src/components",
          "src/app",
          "--include=*.tsx",
        ],
        { encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean);
    } catch {
      files = [];
    }
    expect(files.filter((f) => !f.startsWith("src/components/ui/"))).toEqual(
      [],
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm vitest run src/components/ui/status-pill.test.tsx src/components/ui/radius.test.ts`

- [ ] **Step 3: Add the drag shadow token**

`globals.css` `:root`: `--shadow-drag: 0 12px 32px -12px rgb(30 40 90 / 30%);` `.dark`: `--shadow-drag: 0 12px 32px -12px rgb(0 0 0 / 70%);` `@theme inline`: `--shadow-drag: var(--shadow-drag);`. Register `"--shadow-drag:"` in `globals.tokens.test.ts`'s Tailwind list.

- [ ] **Step 4: Fix the pills**

`cells/index.tsx:341` + `editors/index.tsx:249`: `<StatusPill color="red" variant="solid">Critical</StatusPill>` (editors: use `statusToneClasses("red")` if the site is a class map). `FileTypeChip.tsx:58` / `PresenceRing.tsx:52`: replace `text-white` with the near-black solid text via `statusToneClasses(tone)` or, for the presence counter, `text-primary-foreground` on `bg-primary`. Soft sites → `<StatusPill color={…} variant="soft">`.

- [ ] **Step 5: Radius + shadows** — apply the file list above; run `pnpm lint` (the `check-board-chrome.mjs` script may have opinions on board chrome classes).

- [ ] **Step 6: Tests** — `pnpm vitest run src/components` → PASS.

- [ ] **Step 7: Commit + gate + finish**

```bash
git add <files>
git commit -m "style(ui): aa status pills, one card radius, named drag shadow"
```

---

### Task 4: Loading + error states (Track E)

**Worktree:** `scripts/start-task.sh loading-error-states`

**Files:**

- Modify: `src/app/(app)/boards/[boardId]/loading.tsx`
- Create: `src/app/(app)/boards/[boardId]/loading.test.tsx`, `src/app/ask/loading.tsx`, `src/app/ask/[conversationId]/loading.tsx`, `src/app/ask/error.tsx`, `src/app/admin/error.tsx`, `src/app/updates/loading.tsx`, `src/app/(app)/boards/[boardId]/reports/loading.tsx`, `src/app/(app)/boards/[boardId]/reports/[reportId]/loading.tsx`, `src/app/(auth)/loading.tsx`, plus one `*.test.tsx` per new `loading.tsx`
- Modify: `src/components/ai/ask/Composer.tsx` (+ its caller that passes `onSubmit` — find with `grep -rn "<Composer" src`) and `Composer.test.tsx`

**Interfaces:**

- Consumes: `Skeleton` from `src/components/ui/skeleton.tsx`, `ErrorFallback` from `src/components/shell/error-fallback.tsx`, `FieldStatus` from `src/components/ui/field-status.tsx`, `ROW_HEIGHT` from `src/components/boards/BoardTable.tsx`.
- Produces: `Composer` prop `error?: string | null` and `onRetry?: () => void` (the parent that owns the send transition passes the last failure message).

- [ ] **Step 1: Failing tests** — for each new loading file, a test like `src/app/admin/loading.test.tsx` (role `status`, `aria-busy`, label `/^Loading/`, no heading/nav). Board loading test additionally: `getAllByTestId("board-row-skeleton")` length 8, one `getByTestId("board-toolbar-skeleton")`. Composer test: renders `error` text in an element with `role="alert"` and a "Retry" button calling `onRetry`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

Board skeleton:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
export default function BoardLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading board"
      className="flex h-full flex-col"
    >
      <div className="flex h-14 items-center justify-between px-4">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div
        data-testid="board-toolbar-skeleton"
        className="border-border flex h-11 items-center gap-2 border-b px-4"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20" />
        ))}
      </div>
      <div className="flex flex-col">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            data-testid="board-row-skeleton"
            className="border-border flex h-9 items-center gap-3 border-b px-4"
          >
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-5 w-20 rounded-sm" />
            <Skeleton className="size-6 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

`ask/loading.tsx` (+ `[conversationId]`): a column of 3 message-shaped skeletons + composer bar skeleton, `aria-label="Loading conversation"`. `updates/loading.tsx`: 4 entry skeletons. Reports loaders: header + 3 block skeletons. `(auth)/loading.tsx`: one centered card skeleton. `ask/error.tsx` and `admin/error.tsx`: copy `(app)/error.tsx` verbatim (client component using `ErrorFallback`, prop `unstable_retry`).

Composer: add `error`/`onRetry` props; render below the textarea:

```tsx
{
  error ? (
    <div
      role="alert"
      className="text-destructive flex items-center gap-2 px-1 text-xs"
    >
      <span>{error}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2"
        >
          Retry
        </button>
      ) : null}
    </div>
  ) : null;
}
```

Parent: keep the last failed `(text, agentId)`; on action failure set `error`, `onRetry` resends.

- [ ] **Step 4: Tests pass** — `pnpm vitest run src/app src/components/ai/ask`.

- [ ] **Step 5: Commit + gate + finish** — `git commit -m "feat(ux): skeletons and error boundaries for board, ask, updates, auth"`.

---

### Task 5: Theme presets (Track B) — after Task 1 merges

**Worktree:** `scripts/start-task.sh theme-presets`

**Files:**

- Create: `src/lib/theme/presets.ts`, `src/lib/theme/presets.test.ts`, `src/lib/theme/use-theme-preset.ts`, `src/lib/theme/theme-preset-script.ts`, `src/components/theme-preset-sync.tsx`, `src/components/settings/theme-preset-form.tsx`, `src/components/settings/theme-preset-form.test.tsx`, migration via `scripts/new-migration.sh profiles_theme_preset`
- Modify: `src/app/globals.css` (5 × 2 preset blocks after `.dark`), `src/app/globals.contrast.test.ts` (iterate presets), `src/app/layout.tsx` (inline script), `src/lib/validations/profile.ts`, `src/lib/profile/actions.ts`, `src/lib/profile/queries-cached.ts`, `src/components/shell/authenticated-shell.tsx`, `src/app/ask/layout.tsx`, `src/app/(app)/settings/preferences/page.tsx`, `src/types/database.types.ts` (regenerated)
- Test: `src/lib/profile/actions.test.ts` (if present; else add a schema test in `src/lib/validations/profile.test.ts`)

**Interfaces:**

- Produces:

  ```ts
  // src/lib/theme/presets.ts
  export const THEME_PRESET_IDS = ["keystone","graphite","ocean","forest","ember","rose"] as const;
  export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];
  export const DEFAULT_THEME_PRESET: ThemePresetId = "keystone";
  export const THEME_PRESET_STORAGE_KEY = "pulse-theme-preset";
  export const THEME_PRESET_ATTR = "data-theme-preset";
  export const THEME_PRESETS: ReadonlyArray<{ id: ThemePresetId; label: string; swatch: { light: { chrome: string; accent: string }; dark: { chrome: string; accent: string } } }>;
  export const KEYSTONE_BRAND_HEX = { light: "#5b6fd6", dark: "#8ea2eb" } as const;
  export function isThemePresetId(v: unknown): v is ThemePresetId;
  export function applyThemePreset(id: ThemePresetId): void; // sets/removes attr on document.documentElement (removes for the default)

  // src/lib/theme/use-theme-preset.ts ("use client")
  export function useThemePreset(): { preset: ThemePresetId; setPreset: (id: ThemePresetId) => void; pending: boolean; error: string | null };

  // src/lib/profile/queries-cached.ts
  export async function getUserThemePresetCached(userId: string): Promise<ThemePresetId>;
  // src/lib/profile/actions.ts
  export async function updateProfileThemePreset(input: { themePreset: ThemePresetId }): Promise<ActionResult>;
  // src/lib/validations/profile.ts
  export const updateProfileThemePresetSchema: z.ZodObject<{ themePreset: z.ZodEnum<...> }>;
  // src/components/theme-preset-sync.tsx ("use client")
  export function ThemePresetSync(props: { preset: Promise<ThemePresetId> }): null;
  ```

- [ ] **Step 1: Migration**

```bash
scripts/new-migration.sh profiles_theme_preset
```

Body:

```sql
-- Per-user theme preset (accent + neutral tint + chrome wash). App code (Zod)
-- owns the id list; the DB only bounds the shape so a new preset needs no
-- migration. Unknown stored values fall back to 'keystone' on read. Writes are
-- gated by the existing "profiles: update self" RLS policy.
alter table public.profiles
  add column theme_preset text not null default 'keystone'
  check (char_length(theme_preset) <= 32);
comment on column public.profiles.theme_preset is
  'Per-user theme preset id (see src/lib/theme/presets.ts). Default keystone.';
```

Apply via `supabase-dev` MCP `apply_migration` with the exact `<version>` and `profiles_theme_preset`; `pnpm db:ledger-check`; regenerate types via MCP `generate_typescript_types` → write to `src/types/database.types.ts` → `pnpm prettier --write src/types/database.types.ts`.

- [ ] **Step 2: Failing tests — presets drift guard**

`src/lib/theme/presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  THEME_PRESET_IDS,
  DEFAULT_THEME_PRESET,
  THEME_PRESETS,
  isThemePresetId,
} from "./presets";
const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const SEEDS = [
  "--brand",
  "--brand-foreground",
  "--app-wash",
  "--app-bloom",
  "--background",
  "--foreground",
  "--surface",
  "--surface-muted",
  "--surface-sunken",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--kicker",
  "--accent",
  "--accent-foreground",
  "--content-surface",
];
function block(sel: string) {
  const s = CSS.indexOf(`${sel} {`);
  if (s === -1) return null;
  return CSS.slice(s, CSS.indexOf("\n}", s));
}
function tokens(b: string) {
  return new Set([...b.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]));
}
describe("theme presets", () => {
  it("every non-default preset has light + dark override blocks with exactly the seed tokens", () => {
    for (const id of THEME_PRESET_IDS.filter(
      (i) => i !== DEFAULT_THEME_PRESET,
    )) {
      for (const sel of [
        `:root[data-theme-preset="${id}"]`,
        `.dark[data-theme-preset="${id}"]`,
      ]) {
        const b = block(sel);
        expect(b, `${sel} missing`).not.toBeNull();
        const t = [...tokens(b!)].sort();
        const want = [
          ...SEEDS,
          ...(sel.startsWith(":root") ? ["--glow-primary"] : []),
        ].sort();
        expect(t, sel).toEqual(want);
      }
    }
  });
  it("no CSS preset block without a TS entry", () => {
    const ids = new Set(
      [...CSS.matchAll(/data-theme-preset="([a-z]+)"/g)].map((m) => m[1]),
    );
    for (const id of ids) expect(isThemePresetId(id), id).toBe(true);
  });
  it("swatches are hex", () => {
    for (const p of THEME_PRESETS)
      for (const m of ["light", "dark"] as const) {
        expect(p.swatch[m].chrome).toMatch(/^#[0-9a-f]{6}$/);
        expect(p.swatch[m].accent).toMatch(/^#[0-9a-f]{6}$/);
      }
  });
});
```

Extend `globals.contrast.test.ts`: wrap the existing light/dark describes in a loop over selectors `[":root", ".dark", ...presets × 2]` by parameterizing `declaration(selector, token)` with the preset selector (override blocks contain every seed the tests read: `--muted-foreground`, `--kicker`, `--brand`, `--app-wash`, `--app-bloom`, `--content-surface`, `--surface-muted`). Add per selector: `contrast(brandForeground, brand) ≥ 4.5`, `contrast(brand, contentSurface) ≥ 3`, `contrast(foreground, surface) ≥ 7`.

- [ ] **Step 3: Run → fail** (`src/lib/theme` module missing; no preset blocks).

- [ ] **Step 4: `presets.ts` + CSS blocks**

Write `presets.ts` per the interface. Then add ten blocks to `globals.css` after `.dark { … }`. Each light block copies the Task 1 recipe with its own hexes; dark blocks copy `.dark`'s shape. Starting points (tune until the contrast test is green):

| id       | light brand / fg      | dark brand / fg       | light wash stops (0/46/100%) | dark wash stops           | neutral cast (light bg / dark bg) |
| -------- | --------------------- | --------------------- | ---------------------------- | ------------------------- | --------------------------------- |
| graphite | `#4b4b55` / `#ffffff` | `#c9c9d2` / `#0e0e10` | `#e2e2e6 #dadade #d1d1d6`    | `#26262b #16161a #09090b` | `#f5f5f6` / `#0f0f10`             |
| ocean    | `#1f7a8c` / `#ffffff` | `#6fc6d6` / `#0e0e10` | `#dbe9ee #d2e2e8 #c8d9df`    | `#1b3037 #121e23 #080c0e` | `#f4f7f8` / `#0e1112`             |
| forest   | `#2f7a4f` / `#ffffff` | `#7fcf9c` / `#0e0e10` | `#dfeae2 #d6e3da #ccd9d0`    | `#1d3126 #131f19 #080d0a` | `#f4f7f5` / `#0e110f`             |
| ember    | `#b4581a` / `#ffffff` | `#f0a868` / `#0e0e10` | `#f0e4da #e8dbcf #dfd1c4`    | `#332419 #211711 #0d0906` | `#f8f5f2` / `#12100e`             |
| rose     | `#b8375f` / `#ffffff` | `#f08fb0` / `#0e0e10` | `#f0dfe5 #e8d5dc #dfcad2`    | `#33202a #21151b #0d080b` | `#f8f4f6` / `#120f10`             |

Surfaces follow the cast: light `--surface: #ffffff`, `--surface-muted`/`--surface-sunken`/`--secondary`/`--muted`/`--accent` a 2–3% tint of the bg; dark `--surface` ≈ bg + 8, `--surface-muted` ≈ bg + 14. Text: light `--foreground: #1a1a1f`-family tinted, `--muted-foreground` ≥ 4.5 on the darkest wash stop (start `#5c5c63`), `--kicker` ≥ 4.5 (start `#6e6e77`); dark `--foreground: #f4f4f6`, `--muted-foreground: #b2b2ba`, `--kicker: #8a8a93`.

- [ ] **Step 5: Zod, action, cached read**

`profile.ts`: `export const updateProfileThemePresetSchema = z.object({ themePreset: z.enum(THEME_PRESET_IDS) });`
`actions.ts`: `updateProfileThemePreset` = copy of `updateProfileTimezone` with `{ theme_preset: parsed.data.themePreset }` and error text "Could not update theme."
`queries-cached.ts`: `getUserThemePresetCached` selects `theme_preset`, returns `isThemePresetId(v) ? v : DEFAULT_THEME_PRESET`.

- [ ] **Step 6: No-flash script + sync**

`theme-preset-script.ts` exports a string built from `THEME_PRESET_IDS`:

```ts
export const THEME_PRESET_INLINE_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(THEME_PRESET_STORAGE_KEY)});if(v&&${JSON.stringify([...THEME_PRESET_IDS])}.indexOf(v)>-1&&v!==${JSON.stringify(DEFAULT_THEME_PRESET)}){document.documentElement.setAttribute(${JSON.stringify(THEME_PRESET_ATTR)},v)}}catch(e){}})();`;
```

`layout.tsx`: `<head><script dangerouslySetInnerHTML={{ __html: THEME_PRESET_INLINE_SCRIPT }} /></head>` inside `<html>` before `<body>`.
`theme-preset-sync.tsx`: `use(preset)` inside a `Suspense` boundary; `useEffect` → if `preset !== current attribute` → `applyThemePreset(preset)` + `localStorage.setItem`. Mount `<Suspense fallback={null}><ThemePresetSync preset={resolveUserThemePreset()} /></Suspense>` in `AuthenticatedShell` next to `TimeZoneProvider` (same `getUser().then(...)` promise pattern) and in `ask/layout.tsx` header.

- [ ] **Step 7: Hook + settings form**

`use-theme-preset.ts`: state initialised from the attribute (or default); `setPreset` applies attr + localStorage synchronously, then `startTransition(async () => { const r = await updateProfileThemePreset({ themePreset }); if (!r.ok) { revert; setError(r.error); } })`.
`theme-preset-form.tsx`: fieldset/legend "Theme", six `<label>` tiles with a visually-hidden radio each (copy `AppearanceForm`'s recipe), tile = 2-tone swatch (`style={{ background: swatch.chrome }}` with an accent dot — `style` inline hex is allowed here because the swatch **is** the data) + label; current tile `border-border-bright`; `pointer-coarse:min-h-11`; `role="alert"` for `error`. Mount as `<SettingRow label="Theme" description="Accent and surface tint. Applies to light and dark.">` under Appearance in `preferences/page.tsx`.

Test `theme-preset-form.test.tsx`: renders 6 radios; choosing "Ocean" sets `document.documentElement.getAttribute("data-theme-preset") === "ocean"` synchronously and calls the (mocked) action with `{ themePreset: "ocean" }`; a failed action reverts the attribute and shows the error.

- [ ] **Step 8: Run everything** — `pnpm vitest run src/lib/theme src/app/globals.contrast.test.ts src/app/globals.tokens.test.ts src/components/settings src/lib/validations`.

- [ ] **Step 9: Visual check** — Settings → Preferences → Theme: switch presets in both Light and Dark; reload persists; sign in elsewhere → same preset.

- [ ] **Step 10: Commit + gate + finish**

```bash
git add supabase/migrations/<version>_profiles_theme_preset.sql src/types/database.types.ts src/lib/theme src/lib/validations/profile.ts src/lib/profile src/components/theme-preset-sync.tsx src/components/settings/theme-preset-form.tsx src/components/settings/theme-preset-form.test.tsx src/app/globals.css src/app/globals.contrast.test.ts src/app/layout.tsx src/components/shell/authenticated-shell.tsx src/app/ask/layout.tsx "src/app/(app)/settings/preferences/page.tsx"
git commit -m "feat(theme): user-selectable theme presets"
```

---

### Task 6: Landing + stale brand hex (Track F) — after Task 5 merges

**Worktree:** `scripts/start-task.sh landing-brand-hex`

**Files:**

- Modify: `src/components/landing/monolith-hero.module.css`, `landing/landing-agent-mocks.tsx:30`, `landing/light-rays.tsx:68`, `landing/monolith-scene.tsx:78`, `src/components/dashboards/widgets/chart-theme.ts:25-26`, `src/lib/agents/briefing-render.ts:83,91`, `src/components/boards/item-panel/DocxPreview.tsx:62`, `src/components/reports/PreviewPane.tsx:53`, `src/app/globals.css` (`--chart-spectrum-1..3` light + dark + `@theme inline`), `src/app/globals.tokens.test.ts` (register)
- Test: `src/lib/agents/briefing-render.test.ts` (unchanged values, now imported), `src/components/dashboards/widgets/chart-theme.test.ts` (new: spectrum entries are `var(--chart-spectrum-N)`), `src/components/landing/landing-tokens.test.ts` (new grep guard: no `#[0-9a-f]{3,6}` / `rgba(` in `monolith-hero.module.css` and `landing/*.tsx`)

**Interfaces:**

- Consumes: `KEYSTONE_BRAND_HEX` from `src/lib/theme/presets.ts`.
- Produces: `--chart-spectrum-1/2/3` tokens.

- [ ] **Step 1: Failing guards** (grep tests above + chart-theme test).
- [ ] **Step 2: Spectrum tokens** — light: `--chart-spectrum-1: color-mix(in oklab, var(--brand) 85%, black); -2: var(--brand); -3: color-mix(in oklab, var(--brand) 60%, white);` dark: `-1: color-mix(in oklab, var(--brand) 70%, white); -2: var(--brand); -3: color-mix(in oklab, var(--brand) 55%, black);` `@theme inline`: `--color-chart-spectrum-1..3`. `chart-theme.ts`: `SPECTRUM_STOPS = ["var(--chart-spectrum-1)", "var(--chart-spectrum-2)", "var(--chart-spectrum-3)"]`, `SPECTRUM_SOLID = "var(--chart-spectrum-2)"`.
- [ ] **Step 3: Landing** — hero CSS: `#06070c` → `var(--background)`, `#f4f4f6` → `var(--foreground)`, `#a1a1aa`/`#71717a` → `var(--muted-foreground)`/`var(--kicker)`, `rgba(142,162,235,x)` → `color-mix(in oklab, var(--brand) X%, transparent)`, nav `rgba(6,7,12,.72)` → `color-mix(in oklab, var(--background) 72%, transparent)`, `rgba(244,244,246,.08)` → `var(--border)`. `landing-agent-mocks.tsx` inline glow → `className="shadow-glow-primary"`. `light-rays.tsx`: `DEFAULT_COLOR` becomes a function reading `getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || KEYSTONE_BRAND_HEX.dark` at mount (guard SSR: only in `useEffect`); `monolith-scene.tsx` drops the literal.
- [ ] **Step 4: Emails + previews** — `briefing-render.ts` uses `KEYSTONE_BRAND_HEX.light` (import; template literal). `DocxPreview`/`PreviewPane`: wrapper `className="bg-surface-muted"`, iframe body stays white.
- [ ] **Step 5: Tests** — `pnpm vitest run src/components/landing src/components/dashboards src/lib/agents src/app/globals.tokens.test.ts`.
- [ ] **Step 6: Visual** — `/landing` in Light and Dark; a spectrum chart on a dashboard with Ocean selected.
- [ ] **Step 7: Commit + gate + finish** — `git commit -m "style(brand): landing and charts follow the theme tokens"`.

---

## Self-review (done inline)

- Spec coverage: A→Task 1, B→Task 5, C→Task 2, D→Task 3, E→Task 4, F→Task 6. DAG matches spec.
- Types: `ThemePresetId`, `THEME_PRESET_IDS`, `isThemePresetId`, `applyThemePreset`, `KEYSTONE_BRAND_HEX` consistent across Tasks 5/6. `PageHeader` `as` prop consistent. `--shadow-drag` named once.
- Placeholders: preset hexes are explicit starting points with the test as arbiter, per spec.
