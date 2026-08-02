# Landing dev-note + public /updates page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small "in active development / invitation only" note to the public landing hero and ship a public, unauthenticated `/updates` page that renders a curated, hand-written changelog.

**Architecture:** A typed, hand-written changelog data module (`src/lib/changelog/`) feeds a set of static Server Components (`src/components/changelog/`). A new public RSC route `src/app/updates/page.tsx` renders them inside an always-dark, self-contained shell. The landing hero gains a status pill (inside `MonolithScene`) and a footer with an `Updates →` link (inside `MonolithHero`). Everything is fully static — no DB, no data fetching, zero server round-trips on interaction.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript (strict), Tailwind v4 + Monolith semantic tokens, framer-motion (existing hero), Vitest + @testing-library/react, lucide-react.

**Spec:** `docs/superpowers/specs/2026-06-18-landing-note-and-updates-page-design.md`

**Conventions to honor:**

- Filenames are **kebab-case** (matches `monolith-hero.tsx`, `app-shell.tsx`). Diverge from Mubarak's PascalCase.
- Components are **Server Components** (no `"use client"`) — they're all static.
- Style with **Monolith semantic tokens** only (`bg-surface`, `text-muted-foreground`, `border`, `bg-primary`); no raw Tailwind colors. The hero CSS module keeps its existing fixed dark values (theme-independent surface).
- Badge palette: `new` → brand accent; `improved`/`fixed` → muted outline. **Not** Mubarak's gold/blue/emerald.
- All work on `develop`. Commit after each task.

---

## File structure

| File                                                     | Responsibility                                                                          | New/Modify |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- |
| `src/lib/changelog/types.ts`                             | `ChangelogKind`, `ChangelogEntry` types                                                 | New        |
| `src/lib/changelog/entries.ts`                           | Curated `CHANGELOG` data + `groupByDate` + `formatDate` helpers + `ChangelogGroup` type | New        |
| `src/lib/changelog/entries.test.ts`                      | Unit tests for helpers                                                                  | New        |
| `src/components/changelog/changelog-item-badge.tsx`      | Small per-kind badge                                                                    | New        |
| `src/components/changelog/changelog-item-badge.test.tsx` | Badge test                                                                              | New        |
| `src/components/changelog/changelog-date-group.tsx`      | One date header + its entry cards                                                       | New        |
| `src/components/changelog/changelog-timeline.tsx`        | Groups entries; renders groups or empty state                                           | New        |
| `src/components/changelog/changelog-timeline.test.tsx`   | Timeline + empty-state test                                                             | New        |
| `src/app/updates/page.tsx`                               | Public `/updates` route (RSC, always-dark shell)                                        | New        |
| `src/app/updates/page.test.tsx`                          | Page smoke test                                                                         | New        |
| `src/components/landing/monolith-scene.tsx`              | Add status pill above wordmark                                                          | Modify     |
| `src/components/landing/monolith-hero.tsx`               | Add hero footer with `Updates →` link                                                   | Modify     |
| `src/components/landing/monolith-hero.module.css`        | Pill + footer styles                                                                    | Modify     |
| `src/components/landing/monolith-hero.test.tsx`          | Assert pill + footer link; fix link counts                                              | Modify     |

---

## Task 1: Changelog types, curated data, and helpers

**Files:**

- Create: `src/lib/changelog/types.ts`
- Create: `src/lib/changelog/entries.ts`
- Test: `src/lib/changelog/entries.test.ts`

- [ ] **Step 1: Write the types**

Create `src/lib/changelog/types.ts`:

```ts
export type ChangelogKind = "new" | "improved" | "fixed";

export interface ChangelogEntry {
  /** ISO date, "YYYY-MM-DD". */
  date: string;
  kind: ChangelogKind;
  /** Short, user-facing headline. */
  title: string;
  /** Optional one-line detail. */
  description?: string;
}
```

- [ ] **Step 2: Write the failing helper test**

Create `src/lib/changelog/entries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CHANGELOG, formatDate, groupByDate } from "./entries";
import type { ChangelogEntry } from "./types";

describe("groupByDate", () => {
  it("returns [] for no entries", () => {
    expect(groupByDate([])).toEqual([]);
  });

  it("sorts groups newest-first and groups same-date entries", () => {
    const entries: ChangelogEntry[] = [
      { date: "2026-06-01", kind: "fixed", title: "A" },
      { date: "2026-06-10", kind: "new", title: "B" },
      { date: "2026-06-10", kind: "improved", title: "C" },
    ];
    const groups = groupByDate(entries);
    expect(groups.map((g) => g.date)).toEqual(["2026-06-10", "2026-06-01"]);
    expect(groups[0].entries.map((e) => e.title)).toEqual(["B", "C"]);
    expect(groups[1].entries.map((e) => e.title)).toEqual(["A"]);
  });
});

describe("formatDate", () => {
  it("formats an ISO date as a long en-US date", () => {
    expect(formatDate("2026-06-18")).toBe("June 18, 2026");
  });
});

describe("CHANGELOG", () => {
  it("is non-empty and every entry is well-formed", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["new", "improved", "fixed"]).toContain(e.kind);
      expect(e.title.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/lib/changelog/entries.test.ts`
Expected: FAIL — `Failed to resolve import "./entries"`.

- [ ] **Step 4: Write the data + helpers**

Create `src/lib/changelog/entries.ts`:

```ts
import type { ChangelogEntry, ChangelogKind } from "./types";

export interface ChangelogGroup {
  date: string;
  entries: ChangelogEntry[];
}

/**
 * Hand-written, user-facing changelog. Newest entries can go anywhere —
 * `groupByDate` sorts. Add an entry when something noteworthy ships; keep the
 * wording for end users (no internal jargon, milestone codes, or file names).
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-06-18",
    kind: "new",
    title: "Board automations",
    description:
      "Set up rules that react to changes on your board — a guided builder with ready-made recipes.",
  },
  {
    date: "2026-06-10",
    kind: "improved",
    title: "Faster board loads",
    description: "Large boards open noticeably quicker.",
  },
  {
    date: "2026-06-02",
    kind: "new",
    title: "Command palette",
    description: "Press ⌘K to jump anywhere and run actions without the mouse.",
  },
];

const KIND_ORDER: Record<ChangelogKind, number> = {
  new: 0,
  improved: 1,
  fixed: 2,
};
void KIND_ORDER; // reserved for future intra-day ordering; keep entries in authored order for now

/** Group entries by date, newest date first, preserving authored order within a date. */
export function groupByDate(entries: ChangelogEntry[]): ChangelogGroup[] {
  const sorted = [...entries].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
  const groups: ChangelogGroup[] = [];
  for (const entry of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.date === entry.date) {
      last.entries.push(entry);
    } else {
      groups.push({ date: entry.date, entries: [entry] });
    }
  }
  return groups;
}

/** Format an ISO "YYYY-MM-DD" as e.g. "June 18, 2026" (parsed in local time). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
```

> Note: the `KIND_ORDER`/`void` lines are scaffolding only if you want deterministic intra-day ordering later. If ESLint flags the unused binding, delete both the `const KIND_ORDER` and the `void KIND_ORDER;` lines — they are not used by any test.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/lib/changelog/entries.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 6: Commit**

```bash
git add src/lib/changelog
git commit -m "feat(changelog): curated changelog data + group/format helpers"
```

---

## Task 2: ChangelogItemBadge

**Files:**

- Create: `src/components/changelog/changelog-item-badge.tsx`
- Test: `src/components/changelog/changelog-item-badge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/changelog/changelog-item-badge.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChangelogItemBadge } from "./changelog-item-badge";

describe("ChangelogItemBadge", () => {
  it("renders the human label for each kind", () => {
    const { rerender } = render(<ChangelogItemBadge kind="new" />);
    expect(screen.getByText("New")).toBeInTheDocument();
    rerender(<ChangelogItemBadge kind="improved" />);
    expect(screen.getByText("Improved")).toBeInTheDocument();
    rerender(<ChangelogItemBadge kind="fixed" />);
    expect(screen.getByText("Fixed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/changelog/changelog-item-badge.test.tsx`
Expected: FAIL — cannot resolve `./changelog-item-badge`.

- [ ] **Step 3: Write the component**

Create `src/components/changelog/changelog-item-badge.tsx`:

```tsx
import { cn } from "@/lib/utils";
import type { ChangelogKind } from "@/lib/changelog/types";

// new = the earned brand accent; improved/fixed = muted monochrome outline.
const BADGES: Record<ChangelogKind, { label: string; className: string }> = {
  new: { label: "New", className: "bg-primary text-primary-foreground" },
  improved: { label: "Improved", className: "text-muted-foreground border" },
  fixed: { label: "Fixed", className: "text-muted-foreground border" },
};

export function ChangelogItemBadge({ kind }: { kind: ChangelogKind }) {
  const { label, className } = BADGES[kind];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/changelog/changelog-item-badge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/changelog/changelog-item-badge.tsx src/components/changelog/changelog-item-badge.test.tsx
git commit -m "feat(changelog): per-kind badge (accent for new, muted for improved/fixed)"
```

---

## Task 3: ChangelogDateGroup

**Files:**

- Create: `src/components/changelog/changelog-date-group.tsx`

(No standalone test — exercised through `changelog-timeline.test.tsx` in Task 4.)

- [ ] **Step 1: Write the component**

Create `src/components/changelog/changelog-date-group.tsx`:

```tsx
import { ChangelogItemBadge } from "./changelog-item-badge";
import { formatDate } from "@/lib/changelog/entries";
import type { ChangelogGroup } from "@/lib/changelog/entries";

export function ChangelogDateGroup({ group }: { group: ChangelogGroup }) {
  return (
    <section className="relative pl-6">
      <span
        className="bg-primary absolute top-1.5 left-0 size-2 -translate-x-1/2 rounded-full"
        aria-hidden
      />
      <h2 className="text-muted-foreground mb-4 text-sm font-medium">
        {formatDate(group.date)}
      </h2>
      <ul className="space-y-3">
        {group.entries.map((entry, i) => (
          <li key={i} className="bg-surface rounded-md border p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <ChangelogItemBadge kind={entry.kind} />
              <h3 className="text-sm font-semibold">{entry.title}</h3>
            </div>
            {entry.description ? (
              <p className="text-muted-foreground text-sm text-pretty">
                {entry.description}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Verify it type-checks (compiled in Task 4's test)**

Run: `pnpm typecheck`
Expected: PASS (no errors). The component is consumed in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/components/changelog/changelog-date-group.tsx
git commit -m "feat(changelog): date-group with timeline dot + entry cards"
```

---

## Task 4: ChangelogTimeline (+ empty state)

**Files:**

- Create: `src/components/changelog/changelog-timeline.tsx`
- Test: `src/components/changelog/changelog-timeline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/changelog/changelog-timeline.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChangelogTimeline } from "./changelog-timeline";
import type { ChangelogEntry } from "@/lib/changelog/types";

const entries: ChangelogEntry[] = [
  {
    date: "2026-06-18",
    kind: "new",
    title: "Automations",
    description: "Rules engine.",
  },
  { date: "2026-06-10", kind: "fixed", title: "Board load bug" },
];

describe("ChangelogTimeline", () => {
  it("renders an entry's title, description and badge", () => {
    render(<ChangelogTimeline entries={entries} />);
    expect(screen.getByText("Automations")).toBeInTheDocument();
    expect(screen.getByText("Rules engine.")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Fixed")).toBeInTheDocument();
  });

  it("renders both date headers, newest first", () => {
    render(<ChangelogTimeline entries={entries} />);
    const headers = screen.getAllByRole("heading", { level: 2 });
    expect(headers[0]).toHaveTextContent("June 18, 2026");
    expect(headers[1]).toHaveTextContent("June 10, 2026");
  });

  it("renders an empty state when there are no entries", () => {
    render(<ChangelogTimeline entries={[]} />);
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/changelog/changelog-timeline.test.tsx`
Expected: FAIL — cannot resolve `./changelog-timeline`.

- [ ] **Step 3: Write the component**

Create `src/components/changelog/changelog-timeline.tsx`:

```tsx
import { groupByDate } from "@/lib/changelog/entries";
import type { ChangelogEntry } from "@/lib/changelog/types";
import { ChangelogDateGroup } from "./changelog-date-group";

export function ChangelogTimeline({ entries }: { entries: ChangelogEntry[] }) {
  const groups = groupByDate(entries);

  if (groups.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing here yet — check back soon.
      </p>
    );
  }

  return (
    <div className="relative space-y-10 border-l">
      {groups.map((group) => (
        <ChangelogDateGroup key={group.date} group={group} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/changelog/changelog-timeline.test.tsx`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/changelog/changelog-timeline.tsx src/components/changelog/changelog-timeline.test.tsx
git commit -m "feat(changelog): timeline groups entries by date with empty state"
```

---

## Task 5: Public /updates route

**Files:**

- Create: `src/app/updates/page.tsx`
- Test: `src/app/updates/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/updates/page.test.tsx`:

```tsx
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// next/link needs app-router context in Next 16; render a plain anchor.
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

import UpdatesPage from "./page";

describe("UpdatesPage", () => {
  it("renders the heading and a back-to-home link", () => {
    render(<UpdatesPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "What's new" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to home/i })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("renders at least one shipped item from the curated changelog", () => {
    render(<UpdatesPage />);
    expect(screen.getByText("Board automations")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/app/updates/page.test.tsx`
Expected: FAIL — cannot resolve `./page`.

- [ ] **Step 3: Write the page**

Create `src/app/updates/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { archivo } from "@/lib/fonts";
import { ChangelogTimeline } from "@/components/changelog/changelog-timeline";
import { CHANGELOG } from "@/lib/changelog/entries";

export const metadata: Metadata = {
  title: "Updates · Monolith",
  description:
    "What's new in Monolith — the latest features and fixes. Monolith is in active development.",
};

// Public, unauthenticated, fully static. Wrapped in `dark` so Pulse tokens
// resolve to the always-dark hero aesthetic regardless of the visitor's theme.
export default function UpdatesPage() {
  return (
    <div className="dark bg-background text-foreground min-h-dvh">
      <div className="mx-auto max-w-2xl px-6 py-20">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground mb-12 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        <header className="mb-12">
          <h1
            className={`${archivo.className} text-3xl font-bold tracking-tight`}
          >
            What&apos;s new
          </h1>
          <p className="text-muted-foreground mt-3 text-sm text-pretty">
            Monolith is in active development. Here&apos;s what we&apos;ve
            shipped, newest first.
          </p>
        </header>

        <ChangelogTimeline entries={CHANGELOG} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/app/updates/page.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/updates
git commit -m "feat(updates): public /updates page rendering curated changelog"
```

---

## Task 6: Landing pill + footer link

**Files:**

- Modify: `src/components/landing/monolith-scene.tsx`
- Modify: `src/components/landing/monolith-hero.tsx`
- Modify: `src/components/landing/monolith-hero.module.css`
- Test: `src/components/landing/monolith-hero.test.tsx`

- [ ] **Step 1: Update the test first (it will fail)**

Edit `src/components/landing/monolith-hero.test.tsx`. Add a pill assertion to the wordmark test, add the footer link, and fix the link counts (a third logged-out link / second signed-in link now exists). Replace the body of the `describe("MonolithHero", ...)` block with:

```tsx
describe("MonolithHero", () => {
  it("renders the MONOLITH wordmark and the dev-status pill", () => {
    render(<MonolithHero />);
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
    expect(screen.getByText("In active development")).toBeInTheDocument();
  });

  it("links to the public /updates page from the footer", () => {
    render(<MonolithHero />);
    expect(screen.getByText("Invitation only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /updates/i })).toHaveAttribute(
      "href",
      "/updates",
    );
  });

  it("logged out: hero CTAs link to both /signup and /login", () => {
    render(<MonolithHero />);
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    // 2 CTAs + the footer Updates link.
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("signed in: shows a single Enter app → / plus the Updates link", () => {
    render(<MonolithHero signedIn />);
    const enter = screen.getByRole("link", { name: "Enter app" });
    expect(enter).toHaveAttribute("href", "/");
    // Enter app + footer Updates link.
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(
      screen.queryByRole("link", { name: "Get started" }),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/landing/monolith-hero.test.tsx`
Expected: FAIL — "In active development" not found; no link named "updates"; link counts are 2/1.

- [ ] **Step 3: Add the status pill to MonolithScene**

Edit `src/components/landing/monolith-scene.tsx`. Add the pill as the first staggered `item`, immediately before the wordmark `motion.span`:

```tsx
      <motion.span className={styles.badge} variants={item}>
        <span className={styles.badgeDot} aria-hidden />
        In active development
      </motion.span>
      <motion.span
        className={`${styles.wordmark} ${archivo.className}`}
        variants={item}
      >
        MONOLITH
      </motion.span>
```

(Leave the rest of `MonolithScene` unchanged — `subcopy` and `ctas` follow as before.)

- [ ] **Step 4: Add the footer to MonolithHero**

Edit `src/components/landing/monolith-hero.tsx`. Add the import at the top:

```tsx
import Link from "next/link";
```

Then wrap the existing return so the footer is a sibling of `MonolithScene` inside `styles.page`:

```tsx
return (
  <div className={styles.page}>
    <MonolithScene>
      {signedIn ? (
        <MagneticButton href="/" className={PRIMARY_CTA}>
          Enter app
        </MagneticButton>
      ) : (
        <>
          <MagneticButton href="/signup" className={PRIMARY_CTA}>
            Get started
          </MagneticButton>
          <MagneticButton
            href="/login"
            variant="outline"
            className={SECONDARY_CTA}
          >
            Sign in
          </MagneticButton>
        </>
      )}
    </MonolithScene>
    <footer className={styles.footer}>
      <span>Invitation only</span>
      <Link href="/updates" className={styles.footerLink}>
        Updates →
      </Link>
    </footer>
  </div>
);
```

- [ ] **Step 5: Add the pill + footer styles**

Edit `src/components/landing/monolith-hero.module.css`. Append these rules (before the `@keyframes`/media-query block is fine):

```css
.badge {
  position: relative;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  padding: 0.3rem 0.8rem;
  border: 1px solid rgba(244, 244, 246, 0.16);
  border-radius: 9999px;
  background: rgba(244, 244, 246, 0.06);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  color: #d4d4d8;
  backdrop-filter: blur(4px);
}

.badgeDot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: #8ea2eb;
  box-shadow: 0 0 8px 1px rgba(142, 162, 235, 0.85);
}

.footer {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  font-size: 0.8rem;
  color: #71717a;
}

.footerLink {
  color: #a1a1aa;
  transition: color 0.2s ease;
}

.footerLink:hover {
  color: #f4f4f6;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test src/components/landing/monolith-hero.test.tsx`
Expected: PASS (pill text found, footer link → `/updates`, counts 3 / 2).

- [ ] **Step 7: Commit**

```bash
git add src/components/landing/monolith-scene.tsx src/components/landing/monolith-hero.tsx src/components/landing/monolith-hero.module.css src/components/landing/monolith-hero.test.tsx
git commit -m "feat(landing): active-development pill + Updates footer link"
```

---

## Task 7: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS, no errors. (If ESLint/tsc flags the unused `KIND_ORDER` in `entries.ts`, delete the `const KIND_ORDER` and `void KIND_ORDER;` lines per the note in Task 1.)

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS, no errors/warnings introduced.

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: PASS — all existing tests plus the new changelog/landing/updates tests.

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: PASS. `/updates` appears in the route list as a static (prerendered) route; no "dynamic server usage" warnings.

- [ ] **Step 5: Visual check (manual)**

Run: `pnpm dev`, then:

- Open `/` logged out → pill reads "In active development" above the wordmark; footer shows "Invitation only" left and "Updates →" right; backdrop animation intact.
- Click "Updates →" → lands on `/updates`, always-dark, "What's new" heading, three entries newest-first with the right badges, "Back to home" returns to `/`.
- Toggle the OS to light theme → `/updates` stays dark (wrapped in `dark`).

- [ ] **Step 6: Final commit (if Step 1 required the KIND_ORDER cleanup, or any lint fixups)**

```bash
git add -A
git commit -m "chore(changelog): verification fixups"
```

(Skip if the tree is already clean after Task 6.)

---

## Self-review notes (author)

- **Spec coverage:** landing pill (Task 6) ✓; "invitation only" + Updates link (Task 6) ✓; public `/updates` route (Task 5) ✓; curated data + shared shape (Task 1) ✓; timeline/badge/date-group components (Tasks 2–4) ✓; empty state (Task 4) ✓; tests for helper/components/landing/page (all tasks) ✓; perf budget — all static, 0 round-trips (by construction) ✓.
- **Type consistency:** `ChangelogEntry`/`ChangelogKind` (types.ts) and `ChangelogGroup`/`groupByDate`/`formatDate`/`CHANGELOG` (entries.ts) are referenced with identical names across Tasks 2–5. Components import types from `@/lib/changelog/types` and helpers/data from `@/lib/changelog/entries`.
- **No placeholders:** every code step has full content; no TBDs.
- **Out of scope (unchanged from spec):** git auto-generation, jargon filter, pre-commit hook, RSS, pagination.
- **Post-merge:** when this lands and `develop` is green, this `/updates` entry set itself is a candidate first changelog item; update `CHANGELOG` as future work ships. Run `/wrapup` at end of the working block.
