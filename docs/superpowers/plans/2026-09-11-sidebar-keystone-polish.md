# Sidebar Keystone Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the sidebar one row grammar (one primitive, one active state, one hover, one label style, one text edge), fix the two defects (AA-failing active rows, non-scrolling desktop nav), and add the four Keystone signatures the owner chose: 3px edge bar, ledger section headers, one context chip, pinned footer.

**Architecture:** A new markup-only primitive `src/components/shell/sidebar-row.tsx` exports the row / lead-slot / label / rail-tile class recipes and a `SidebarRow` container + `SidebarLink`. `NavSection` becomes a ledger header. `ContextSwitcher` replaces the two switchers. `SidebarNav` gains a scroll body and a pinned footer. Every board / folder / dashboard row migrates onto the primitive. No data, no server actions, no schema change.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 (semantic tokens only — `src/app/globals.css`), shadcn/ui (`dropdown-menu`, `tooltip`, `kicker`), lucide-react, Zustand `useUIStore`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-11-sidebar-keystone-polish-design.md` (+ the live prototype `2026-09-11-sidebar-keystone-polish.prototype.html` next to it — open it in a browser to see the target).

## Global Constraints

- Tokens only. Never a raw Tailwind colour (`bg-zinc-*`, `text-blue-*`). Never `bg-primary/80` with `text-foreground` (the AA defect). Never `card-lift` inside the sidebar. Never `text-[Npx]` (`scripts/check-px-text.mjs` fails the lint gate).
- Hairlines brighten, never thicken: `border` → `hover:border-border-bright`; rules `bg-border` → `bg-border-bright`.
- Row text edge is **36px** from the sidebar's outer edge everywhere: sidebar `px-2` (8) + lead slot `size-6` (24) + label `pl-1` (4). Section kickers use `pl-7` (28) inside the same `px-2` to land on 36px.
- A row container carries **no `gap-*` and no `pl-*`** (the "folder row alignment" suite in `src/components/boards/BoardsNav.test.tsx` asserts this on filed rows). The 4px between slot and label lives on the label (`pl-1`).
- Rail tiles keep the gotcha-47 contract: `pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-1 pointer-coarse:py-1.5` and a visible `CoarseCaption` under a coarse pointer.
- Colour transitions use the default `transition-colors` (150ms). Only hairlines/rules use `duration-300 ease-keystone`. Chevron rotation `duration-200 ease-keystone`.
- Storage keys: `planning`, `boards`, `dash`, `folder:<id>` stay. `personal` is removed.
- Gates before finishing: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Commit identity `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage by path.
- Work happens in the worktree `.claude/worktrees/sidebar-keystone` on `task/sidebar-keystone` (created with `scripts/start-task.sh sidebar-keystone`).

---

## File map

| File                                                   | Change | Owner task |
| ------------------------------------------------------ | ------ | ---------- |
| `src/components/shell/sidebar-row.tsx`                 | create | T1         |
| `src/components/shell/sidebar-row.test.tsx`            | create | T1         |
| `src/components/shell/nav-section.tsx`                 | modify | T2         |
| `src/components/shell/nav-section.test.tsx`            | modify | T2         |
| `src/components/boards/SharedBoardsSection.tsx`        | modify | T2         |
| `src/components/shell/context-switcher.tsx`            | create | T3         |
| `src/components/shell/context-switcher.test.tsx`       | create | T3         |
| `src/components/shell/org-switcher.tsx` (+ test)       | delete | T3         |
| `src/components/shell/workspace-switcher.tsx` (+ test) | delete | T3         |
| `src/components/shell/sidebar-nav.tsx`                 | modify | T4         |
| `src/components/shell/sidebar-nav.test.tsx`            | modify | T4         |
| `src/components/sidebar.tsx`                           | modify | T4         |
| `src/app/globals.css`                                  | modify | T4         |
| `src/components/boards/PlainBoardRow.tsx`              | modify | T5         |
| `src/components/boards/SharedBoardRow.tsx`             | modify | T5         |
| `src/components/boards/BoardsNavSortable.tsx`          | modify | T5         |
| `src/components/boards/BoardFolderRow.tsx`             | modify | T5         |
| `src/components/boards/BoardsNav.tsx`                  | modify | T5         |
| `src/components/boards/BoardsNav.test.tsx`             | modify | T5         |
| `src/components/dashboards/DashboardsNav.tsx`          | modify | T5         |
| `src/components/dashboards/DashboardsNav.test.tsx`     | modify | T5         |
| `src/components/shell/sidebar-active-guard.test.ts`    | create | T5         |

## Execution DAG

```
T1 (row primitive) ──┬──> T4 (shell: scroll body, footer, rail groups)
T3 (context chip)  ──┘
T1 ──┬──> T5 (row migration: boards, folders, dashboards)
T2 (ledger header) ─┘
```

- **Batch 1 (parallel, disjoint files):** T1, T2, T3.
- **Batch 2 (parallel, disjoint files):** T4 (`shell/sidebar-nav.tsx`, `sidebar.tsx`, `globals.css`), T5 (`boards/*`, `dashboards/*`, guard test).
- **Critical path:** T1 → T5. Then one whole-branch review, then `scripts/finish-task.sh`.
- Batch-2 agents run gates and **commit but do not run finish-task**; the orchestrator runs the four gates once more on the merged branch and finishes.

---

### Task 1: `SidebarRow` primitive

**Files:**

- Create: `src/components/shell/sidebar-row.tsx`
- Test: `src/components/shell/sidebar-row.test.tsx`

**Interfaces:**

- Consumes: `cn` from `@/lib/utils`, `Link` from `next/link`.
- Produces (used by T4, T5):

  ```ts
  export const SIDEBAR_LEAD_CLASS: string; // "flex size-6 shrink-0 items-center justify-center"
  export function sidebarRowClass(opts: {
    active?: boolean;
    child?: boolean;
    className?: string;
  }): string;
  export function sidebarLabelClass(child?: boolean): string; // label (text or <Link>) inside a SidebarRow
  export function railTileClass(opts: {
    active?: boolean;
    className?: string;
  }): string;
  export const RailDivider: () => JSX.Element; // 16px hairline between rail groups
  export const SidebarRow: ForwardRef<HTMLDivElement, SidebarRowProps>;
  export function SidebarLink(props: SidebarLinkProps): JSX.Element;
  type SidebarRowProps = ComponentPropsWithoutRef<"div"> & {
    active?: boolean;
    child?: boolean;
    /** undefined → inert 24px spacer; null → nothing (caller renders its own leading element); node → rendered in the slot */
    lead?: ReactNode | null;
    trailing?: ReactNode;
  };
  type SidebarLinkProps = {
    href: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
    active?: boolean;
    child?: boolean;
    className?: string;
  };
  ```

- [ ] **Step 1: Write the failing tests**

`src/components/shell/sidebar-row.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListTodo } from "lucide-react";
import {
  RailDivider,
  SIDEBAR_LEAD_CLASS,
  SidebarLink,
  SidebarRow,
  railTileClass,
  sidebarLabelClass,
  sidebarRowClass,
} from "./sidebar-row";

describe("sidebarRowClass", () => {
  it("uses the Keystone tint + edge bar when active, never the 80% brand fill", () => {
    const active = sidebarRowClass({ active: true });
    expect(active).toContain("bg-state-selected");
    expect(active).toContain("text-foreground");
    expect(active).toContain("before:bg-primary");
    expect(active).toContain("before:-left-2");
    expect(active).not.toContain("bg-primary/80");
    expect(active).not.toMatch(/\bborder-primary/);
  });

  it("hovers with a fill, not a hairline", () => {
    const idle = sidebarRowClass({});
    expect(idle).toContain("hover:bg-state-hover");
    expect(idle).not.toContain("hover:border");
    expect(idle).toContain("text-muted-foreground");
  });

  it("carries no row-level gap or left padding (text edge comes from slot + label)", () => {
    for (const cls of [sidebarRowClass({}), sidebarRowClass({ child: true })]) {
      expect(cls).not.toMatch(/(^|\s)gap-/);
      expect(cls).not.toMatch(/(^|\s)pl-\d/);
    }
    expect(SIDEBAR_LEAD_CLASS).toContain("size-6");
    expect(sidebarLabelClass()).toContain("pl-1");
    expect(sidebarLabelClass(true)).toContain("pl-1");
  });

  it("sizes top-level rows 32px/text-sm and child rows 28px/text-xs", () => {
    expect(sidebarRowClass({})).toContain("min-h-8");
    expect(sidebarRowClass({ child: true })).toContain("min-h-7");
    expect(sidebarLabelClass()).toContain("text-sm");
    expect(sidebarLabelClass(true)).toContain("text-xs");
  });

  it("lets a caller override the bar offset for indented rows", () => {
    // tailwind-merge keeps the last conflicting utility.
    const cls = sidebarRowClass({ active: true, className: "before:-left-5" });
    expect(cls).toContain("before:-left-5");
    expect(cls).not.toContain("before:-left-2 ");
  });
});

describe("SidebarRow", () => {
  it("always renders the 24px lead slot first, even when no lead is given", () => {
    const { container } = render(<SidebarRow>label</SidebarRow>);
    const row = container.firstElementChild as HTMLElement;
    expect(row.firstElementChild?.className).toContain("size-6");
  });

  it("renders nothing in the slot position when lead is null", () => {
    const { container } = render(
      <SidebarRow lead={null}>
        <button className={SIDEBAR_LEAD_CLASS}>own</button>
      </SidebarRow>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.firstElementChild?.tagName).toBe("BUTTON");
  });

  it("forwards ref, style and data attributes (drag layer contract)", () => {
    let node: HTMLDivElement | null = null;
    render(
      <SidebarRow
        ref={(n) => {
          node = n;
        }}
        data-board-row="b1"
        style={{ transform: "translate(1px, 0)" }}
      >
        x
      </SidebarRow>,
    );
    expect(node).not.toBeNull();
    expect(node!.dataset.boardRow).toBe("b1");
    expect(node!.style.transform).toBe("translate(1px, 0)");
  });

  it("puts trailing controls after the label", () => {
    render(
      <SidebarRow trailing={<button>menu</button>}>
        <span>Roadmap</span>
      </SidebarRow>,
    );
    const label = screen.getByText("Roadmap");
    const menu = screen.getByRole("button", { name: "menu" });
    expect(
      label.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("SidebarLink", () => {
  it("renders a link with icon in the lead slot and aria-current when active", () => {
    render(
      <SidebarLink href="/my-work" label="My Work" icon={ListTodo} active />,
    );
    const link = screen.getByRole("link", { name: "My Work" });
    expect(link).toHaveAttribute("href", "/my-work");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("bg-state-selected");
    expect(link.firstElementChild?.className).toContain("size-6");
  });

  it("omits aria-current when idle", () => {
    render(<SidebarLink href="/goals" label="Goals" icon={ListTodo} />);
    expect(screen.getByRole("link", { name: "Goals" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("rail", () => {
  it("tiles are 36px, keep the coarse-pointer 44px contract, and use the tint + bar when active", () => {
    const idle = railTileClass({});
    expect(idle).toContain("size-9");
    expect(idle).toContain("pointer-coarse:min-h-11");
    expect(idle).toContain("hover:bg-state-hover");
    expect(idle).not.toContain("hover:border");
    const active = railTileClass({ active: true });
    expect(active).toContain("bg-state-selected");
    expect(active).toContain("before:bg-primary");
    expect(active).not.toContain("bg-primary/80");
  });

  it("RailDivider is a decorative 16px hairline", () => {
    const { container } = render(<RailDivider />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.className).toContain("h-px");
    expect(el.className).toContain("w-4");
    expect(el.className).toContain("bg-border");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/shell/sidebar-row.test.tsx`
Expected: FAIL — `Failed to resolve import "./sidebar-row"`.

- [ ] **Step 3: Write the primitive**

`src/components/shell/sidebar-row.tsx`:

```tsx
import Link from "next/link";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/**
 * The sidebar's one row grammar (spec: 2026-09-11-sidebar-keystone-polish).
 *
 * Every navigable row — top-level links, folder headers, board rows (plain,
 * shared, sortable), dashboard rows, footer links — is built from these three
 * pieces so text edges, hover and active state are identical everywhere:
 *
 *   [ 24px lead slot ][ label (pl-1) … ][ trailing ]
 *
 * The row itself carries NO `gap-*` and NO `pl-*` (BoardsNav's alignment
 * suite pins that): the 4px between slot and label is the label's `pl-1`.
 * Text edge = sidebar px-2 (8) + slot (24) + pl-1 (4) = 36px.
 *
 * Active = `--state-selected` tint + a 3px `--brand` bar on the sidebar's
 * outer edge (`before:-left-2` cancels the sidebar's px-2). Rows nested in a
 * folder body (`pl-3`) pass `before:-left-5` so the bar stays on the edge.
 * Never `bg-primary/80 text-foreground` — white on periwinkle fails AA.
 */
export const SIDEBAR_LEAD_CLASS =
  "flex size-6 shrink-0 items-center justify-center";

const ROW_BASE =
  "group/row relative flex items-center rounded-md pr-1 transition-colors";
const ROW_IDLE =
  "text-muted-foreground hover:bg-state-hover hover:text-foreground";
const ROW_ACTIVE =
  "bg-state-selected text-foreground before:absolute before:-left-2 before:w-[3px] before:rounded-r-full before:bg-primary before:content-['']";

export function sidebarRowClass({
  active = false,
  child = false,
  className,
}: {
  active?: boolean;
  child?: boolean;
  className?: string;
}): string {
  return cn(
    ROW_BASE,
    child ? "min-h-7" : "min-h-8",
    active ? ROW_ACTIVE : ROW_IDLE,
    active &&
      (child
        ? "before:top-1 before:bottom-1"
        : "before:top-1.5 before:bottom-1.5"),
    className,
  );
}

export function sidebarLabelClass(child = false): string {
  return cn(
    "min-w-0 flex-1 truncate py-1 pr-1 pl-1",
    child ? "text-xs font-medium" : "text-sm",
  );
}

export type SidebarRowProps = ComponentPropsWithoutRef<"div"> & {
  active?: boolean;
  child?: boolean;
  /** `undefined` → inert 24px spacer; `null` → nothing (the caller renders its
   *  own leading element as its first child); a node → rendered in the slot. */
  lead?: ReactNode | null;
  trailing?: ReactNode;
};

export const SidebarRow = forwardRef<HTMLDivElement, SidebarRowProps>(
  function SidebarRow(
    { active, child, lead, trailing, className, children, ...rest },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={sidebarRowClass({ active, child, className })}
        {...rest}
      >
        {lead === null ? null : (
          <span
            className={SIDEBAR_LEAD_CLASS}
            aria-hidden={lead === undefined || undefined}
          >
            {lead}
          </span>
        )}
        {children}
        {trailing}
      </div>
    );
  },
);

export function SidebarLink({
  href,
  label,
  icon: Icon,
  active = false,
  child = false,
  className,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active?: boolean;
  child?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={sidebarRowClass({ active, child, className })}
    >
      <span className={SIDEBAR_LEAD_CLASS}>
        <Icon className="size-4" />
      </span>
      <span className={sidebarLabelClass(child)}>{label}</span>
    </Link>
  );
}

/* ---------- collapsed rail ---------- */

const TILE_BASE =
  "relative flex size-9 max-w-full flex-col items-center justify-center gap-0.5 rounded-md text-sm font-medium transition-colors pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-1 pointer-coarse:py-1.5";
const TILE_IDLE =
  "text-muted-foreground hover:bg-state-hover hover:text-foreground";
const TILE_ACTIVE =
  "bg-state-selected text-foreground before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-primary before:content-['']";

export function railTileClass({
  active = false,
  className,
}: {
  active?: boolean;
  className?: string;
}): string {
  return cn(TILE_BASE, active ? TILE_ACTIVE : TILE_IDLE, className);
}

/** Decorative 16px hairline between rail groups. */
export function RailDivider() {
  return (
    <span aria-hidden="true" className="bg-border my-1.5 h-px w-4 shrink-0" />
  );
}
```

Note on `aria-hidden` for the spacer: keep it simple — if the expression reads awkwardly, replace with `aria-hidden={lead === undefined ? true : undefined}`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/components/shell/sidebar-row.test.tsx`
Expected: PASS (all 12).

- [ ] **Step 5: Typecheck + lint the new file, commit**

```bash
pnpm typecheck && pnpm eslint src/components/shell/sidebar-row.tsx
git add src/components/shell/sidebar-row.tsx src/components/shell/sidebar-row.test.tsx
git commit -m "feat(shell): SidebarRow primitive — one row grammar, edge-bar active state"
```

---

### Task 2: `NavSection` ledger header + "Shared with me" kicker

**Files:**

- Modify: `src/components/shell/nav-section.tsx`
- Modify: `src/components/shell/nav-section.test.tsx`
- Modify: `src/components/boards/SharedBoardsSection.tsx`

**Interfaces:**

- Consumes: `Kicker` (`@/components/ui/kicker`), `useUIStore` (`collapsedSections`, `toggleSection`).
- Produces: `NavSection` props `{ storageKey: string; title: string; titleHref?: string; action?: ReactNode; children: ReactNode }` — **`icon` prop removed**. Section wrapper class `flex flex-col gap-0.5 px-2 pt-3.5`. Body id `nav-section-${storageKey}` unchanged.

- [ ] **Step 1: Rewrite the tests**

Replace `src/components/shell/nav-section.test.tsx` with:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavSection } from "./nav-section";
import { useUIStore } from "@/stores/ui";

beforeEach(() => {
  useUIStore.setState({ collapsedSections: {} });
});

function renderSection() {
  return render(
    <NavSection
      storageKey="planning"
      title="Planning"
      action={<button>add</button>}
    >
      <a href="/goals">Goals</a>
    </NavSection>,
  );
}

describe("NavSection (ledger header)", () => {
  it("is one toggle button named by the title, with a resolvable aria-controls", () => {
    renderSection();
    const toggle = screen.getByRole("button", { name: "Planning" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "nav-section-planning");
    expect(document.getElementById("nav-section-planning")).not.toHaveAttribute(
      "hidden",
    );
    // Exactly one toggle — the old chevron button + title button pair is gone.
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
  });

  it("keeps the body in the DOM (hidden) when collapsed and persists the key", async () => {
    renderSection();
    await userEvent.click(screen.getByRole("button", { name: "Planning" }));
    expect(screen.getByRole("button", { name: "Planning" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(document.getElementById("nav-section-planning")).toHaveAttribute(
      "hidden",
    );
    expect(useUIStore.getState().collapsedSections["planning"]).toBe(true);
  });

  it("renders the label as a mono Keystone kicker on the 36px text edge", () => {
    renderSection();
    const label = screen.getByText("Planning");
    expect(label.className).toContain("font-mono");
    expect(label).toHaveClass("text-kicker", "uppercase");
    const header = screen.getByRole("button", {
      name: "Planning",
    }).parentElement!;
    expect(header.className).toContain("pl-7");
  });

  it("draws a hairline rule that brightens on hover, and no section icon", () => {
    const { container } = renderSection();
    const rule = container.querySelector("[data-nav-rule]") as HTMLElement;
    expect(rule).not.toBeNull();
    expect(rule.className).toContain("bg-border");
    expect(rule.className).toContain("group-hover/sec:bg-border-bright");
    expect(rule.className).toContain("ease-keystone");
    expect(container.querySelector("svg.lucide-folder-kanban")).toBeNull();
  });

  it("hides the chevron until hover while open, shows it while closed, always on touch", async () => {
    renderSection();
    const chevron = () =>
      document.querySelector("[data-nav-chevron]") as HTMLElement;
    expect(chevron().className).toContain("opacity-0");
    expect(chevron().className).toContain("group-hover/sec:opacity-100");
    expect(chevron().className).toContain("pointer-coarse:opacity-100");
    await userEvent.click(screen.getByRole("button", { name: "Planning" }));
    expect(chevron().className).not.toContain("opacity-0");
    expect(chevron().className).toContain("-rotate-90");
  });

  it("keeps the action outside the toggle button", () => {
    renderSection();
    const toggle = screen.getByRole("button", { name: "Planning" });
    expect(toggle).not.toContainElement(
      screen.getByRole("button", { name: "add" }),
    );
  });

  it("renders the title as a link when titleHref is set, with a separate toggle", async () => {
    render(
      <NavSection storageKey="dash" title="Dashboards" titleHref="/dashboards">
        <span>child</span>
      </NavSection>,
    );
    expect(screen.getByRole("link", { name: "Dashboards" })).toHaveAttribute(
      "href",
      "/dashboards",
    );
    const toggle = screen.getByRole("button", { name: /collapse dashboards/i });
    expect(toggle).toHaveAttribute("aria-controls", "nav-section-dash");
    await userEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: /expand dashboards/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/components/shell/nav-section.test.tsx`
Expected: FAIL — "is one toggle button" (two expanded buttons), rule/chevron data attributes missing, `pl-7` missing.

- [ ] **Step 3: Rewrite `nav-section.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Kicker } from "@/components/ui/kicker";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";

/**
 * A labelled, collapsible sidebar group in the Keystone "ledger" style:
 *
 *   [ KICKER ][ ───── hairline rule ───── ][ chevron ][ actions ]
 *
 * Collapse state lives in `useUIStore.collapsedSections` (client-only,
 * persisted) keyed by `storageKey`, so folding is 0 server round-trips.
 * Default open (absent key).
 *
 * The whole header (kicker + rule + chevron) is ONE toggle button whose
 * accessible name is the title. With `titleHref` the kicker becomes a real
 * link (Dashboards → /dashboards) and the rule + chevron form the toggle,
 * labelled "Collapse/Expand <title>". Actions stay outside the button.
 *
 * The chevron is hidden until the header is hovered/focused, always visible
 * while the section is closed (so a folded group still says so), and always
 * visible under a coarse pointer (no hover on touch).
 */
export function NavSection({
  storageKey,
  title,
  titleHref,
  action,
  children,
}: {
  storageKey: string;
  title: string;
  titleHref?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const collapsedSections = useUIStore((s) => s.collapsedSections);
  const toggleSection = useUIStore((s) => s.toggleSection);
  const open = !collapsedSections[storageKey];
  const bodyId = `nav-section-${storageKey}`;

  const kicker = (
    <Kicker className="ease-keystone group-hover/sec:text-foreground transition-colors duration-300">
      {title}
    </Kicker>
  );
  const rule = (
    <span
      aria-hidden="true"
      data-nav-rule
      className="bg-border ease-keystone group-hover/sec:bg-border-bright h-px min-w-3 flex-1 transition-colors duration-300"
    />
  );
  const chevron = (
    <ChevronDown
      aria-hidden="true"
      data-nav-chevron
      className={cn(
        "text-muted-foreground ease-keystone size-3.5 shrink-0 transition-[opacity,transform] duration-200 group-focus-within/sec:opacity-100 group-hover/sec:opacity-100 pointer-coarse:opacity-100",
        open ? "opacity-0" : "-rotate-90",
      )}
    />
  );
  const toggleBase =
    "flex min-w-0 flex-1 items-center gap-2 rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

  return (
    <div className="flex flex-col gap-0.5 px-2 pt-3.5">
      <div className="group/sec flex h-6.5 items-center gap-2 pr-1 pl-7">
        {titleHref ? (
          <>
            <Link
              href={titleHref}
              className="focus-visible:ring-ring shrink-0 rounded focus-visible:ring-2 focus-visible:outline-none"
            >
              {kicker}
            </Link>
            <button
              type="button"
              onClick={() => toggleSection(storageKey)}
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
              className={toggleBase}
            >
              {rule}
              {chevron}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => toggleSection(storageKey)}
            aria-expanded={open}
            aria-controls={bodyId}
            className={toggleBase}
          >
            {kicker}
            {rule}
            {chevron}
          </button>
        )}
        {action ? (
          <div className="flex shrink-0 items-center">{action}</div>
        ) : null}
      </div>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-0.5">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/components/shell/nav-section.test.tsx`
Expected: PASS (7).

- [ ] **Step 5: "Shared with me" as a kicker sub-header**

In `src/components/boards/SharedBoardsSection.tsx` replace the `<p>`:

```tsx
// before
<p className="text-muted-foreground px-3 pt-3 text-xs font-medium">
  Shared with me
</p>
// after
<div className="mt-1.5 flex h-6 items-center gap-2 pr-1 pl-7">
  <Kicker size="xs">Shared with me</Kicker>
  <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />
</div>
```

Add `import { Kicker } from "@/components/ui/kicker";`. Any test asserting `getByText("Shared with me")` still passes (same text). Add one assertion to `src/components/boards/BoardsNav.test.tsx` next to the existing "Shared with me" render test (search the file for `"Shared with me"`):

```tsx
expect(screen.getByText("Shared with me")).toHaveClass(
  "text-kicker",
  "uppercase",
);
```

- [ ] **Step 6: Run the boards nav tests, then commit**

Run: `pnpm vitest run src/components/boards/BoardsNav.test.tsx src/components/shell/nav-section.test.tsx`
Expected: PASS. (If a BoardsNav test looked up the old `<p>` by tag, switch it to `getByText`.)

```bash
pnpm typecheck
git add src/components/shell/nav-section.tsx src/components/shell/nav-section.test.tsx src/components/boards/SharedBoardsSection.tsx src/components/boards/BoardsNav.test.tsx
git commit -m "feat(shell): ledger NavSection header + Shared-with-me kicker"
```

Note: `BoardsNav.tsx` / `DashboardsNav.tsx` still pass `icon={…}` to `NavSection` until T5 removes it; TypeScript will flag the excess prop. **T2 must delete those two `icon={FolderKanban}` / `icon={LayoutGrid}` props** (and now-unused imports) so `pnpm typecheck` stays green after this commit — that is the only edit T2 makes in those files.

---

### Task 3: `ContextSwitcher` replaces org + workspace switchers

**Files:**

- Create: `src/components/shell/context-switcher.tsx`
- Create: `src/components/shell/context-switcher.test.tsx`
- Delete: `src/components/shell/org-switcher.tsx`, `src/components/shell/org-switcher.test.tsx`, `src/components/shell/workspace-switcher.tsx`, `src/components/shell/workspace-switcher.test.tsx`
- Modify (import swap only, to keep typecheck green): `src/components/shell/sidebar-nav.tsx`

**Interfaces:**

- Consumes: `setActiveOrg` (`@/lib/org/active-actions`), `setActiveWorkspace` (`@/lib/workspaces/active-actions`), `NewWorkspaceDialog` (`@/components/workspaces/NewWorkspaceDialog`, props `open`, `onOpenChange`, `showTrigger`), `Kicker`, shadcn `dropdown-menu`, `tooltip`.
- Produces:

  ```ts
  export function ContextSwitcher(props: {
    orgs?: { id: string; name: string }[];
    activeOrgId?: string;
    workspaces: { id: string; name: string }[];
    activeWorkspaceId?: string;
    collapsed?: boolean;
  }): JSX.Element | null; // null when workspaces.length === 0
  ```

- [ ] **Step 1: Write the failing tests**

`src/components/shell/context-switcher.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ContextSwitcher } from "./context-switcher";
import { setActiveWorkspace } from "@/lib/workspaces/active-actions";
import { setActiveOrg } from "@/lib/org/active-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/workspaces/active-actions", () => ({
  setActiveWorkspace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/org/active-actions", () => ({
  setActiveOrg: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/workspaces/actions", () => ({ createWorkspace: vi.fn() }));

const ws = [
  { id: "w1", name: "Product" },
  { id: "w2", name: "Growth" },
];
const orgs = [
  { id: "o1", name: "Acme" },
  { id: "o2", name: "Globex" },
];

function renderIt(
  props: Partial<React.ComponentProps<typeof ContextSwitcher>> = {},
) {
  return render(
    <TooltipProvider>
      <ContextSwitcher workspaces={ws} activeWorkspaceId="w1" {...props} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

describe("ContextSwitcher", () => {
  it("renders nothing without workspaces", () => {
    const { container } = renderIt({ workspaces: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("single org: shows the workspace only, labelled 'Switch workspace'", () => {
    renderIt({ orgs: [orgs[0]], activeOrgId: "o1" });
    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger).toHaveTextContent("Product");
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
  });

  it("multi org: org name as a kicker above the workspace, one trigger, one menu with both groups", async () => {
    renderIt({ orgs, activeOrgId: "o2" });
    const trigger = screen.getByRole("button", {
      name: "Switch organization or workspace",
    });
    expect(screen.getByText("Globex")).toHaveClass("text-kicker");
    expect(trigger).toHaveTextContent("Product");
    await userEvent.click(trigger);
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /acme/i })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /growth/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /new workspace/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /manage workspaces/i }),
    ).toHaveAttribute("href", "/settings");
  });

  it("switches org / workspace and refreshes; the active one is a no-op", async () => {
    renderIt({ orgs, activeOrgId: "o1" });
    await userEvent.click(
      screen.getByRole("button", { name: /switch organization/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /globex/i }));
    expect(vi.mocked(setActiveOrg)).toHaveBeenCalledWith("o2");
    await userEvent.click(
      screen.getByRole("button", { name: /switch organization/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /growth/i }));
    expect(vi.mocked(setActiveWorkspace)).toHaveBeenCalledWith("w2");
    await userEvent.click(
      screen.getByRole("button", { name: /switch organization/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /product/i }));
    expect(vi.mocked(setActiveWorkspace)).toHaveBeenCalledTimes(1);
  });

  it("chip: alpha fill, brightening hairline, no card-lift", () => {
    renderIt();
    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger.className).toContain("bg-chrome-fill");
    expect(trigger.className).toContain("hover:border-border-bright");
    expect(trigger.className).not.toContain("card-lift");
  });

  it("collapsed: a 36px chip with the workspace initial", () => {
    renderIt({ collapsed: true, orgs, activeOrgId: "o1" });
    const trigger = screen.getByRole("button", {
      name: "Switch organization or workspace",
    });
    expect(trigger.className).toContain("size-9");
    expect(trigger).toHaveTextContent("P");
    expect(screen.queryByText("Product")).not.toBeInTheDocument();
  });

  it("opens the New workspace dialog from the menu", async () => {
    renderIt();
    await userEvent.click(
      screen.getByRole("button", { name: "Switch workspace" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: /new workspace/i }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/components/shell/context-switcher.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `context-switcher.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react";
import { setActiveOrg } from "@/lib/org/active-actions";
import { setActiveWorkspace } from "@/lib/workspaces/active-actions";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";
import { Kicker } from "@/components/ui/kicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Named = { id: string; name: string };

const NO_ORGS: Named[] = [];

/**
 * The sidebar's one context control: which organization and which workspace
 * you are looking at. Replaces the former stacked OrgSwitcher + WorkspaceSwitcher
 * twins. The org only appears (as a mono kicker over the workspace name, and
 * as a group in the menu) when the user belongs to more than one.
 *
 * A Keystone chip: alpha fill on the wash, hairline that BRIGHTENS on hover —
 * no lift (that is a card gesture, not a nav one).
 */
export function ContextSwitcher({
  orgs = NO_ORGS,
  activeOrgId = "",
  workspaces,
  activeWorkspaceId = "",
  collapsed = false,
}: {
  orgs?: Named[];
  activeOrgId?: string;
  workspaces: Named[];
  activeWorkspaceId?: string;
  collapsed?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);

  const multiOrg = orgs.length > 1;
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  const activeWs =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

  function switchOrg(id: string) {
    if (id === activeOrgId) return;
    startTransition(async () => {
      await setActiveOrg(id);
      router.refresh();
    });
  }
  function switchWorkspace(id: string) {
    if (id === activeWorkspaceId) return;
    startTransition(async () => {
      await setActiveWorkspace(id);
      router.refresh();
    });
  }

  if (workspaces.length === 0 || !activeWs) return null;

  const label = multiOrg
    ? "Switch organization or workspace"
    : "Switch workspace";
  const initial = activeWs.name.charAt(0).toUpperCase();
  const chip =
    "bg-chrome-fill border-border hover:border-border-bright focus-visible:ring-ring flex items-center rounded-lg border transition-colors duration-300 ease-keystone focus-visible:ring-2 focus-visible:outline-none";

  const menu = (
    <DropdownMenuContent align="start" className="w-60">
      {multiOrg ? (
        <>
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            Organization
          </DropdownMenuLabel>
          {orgs.map((o) => (
            <MenuRow
              key={o.id}
              item={o}
              active={o.id === activeOrgId}
              onSelect={() => switchOrg(o.id)}
            />
          ))}
          <DropdownMenuSeparator />
        </>
      ) : null}
      <DropdownMenuLabel className="text-muted-foreground text-xs">
        Workspaces
      </DropdownMenuLabel>
      {workspaces.map((w) => (
        <MenuRow
          key={w.id}
          item={w}
          active={w.id === activeWs.id}
          onSelect={() => switchWorkspace(w.id)}
        />
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => setNewOpen(true)} className="gap-2">
        <Plus className="size-4" />
        New workspace
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link href="/settings" className="flex items-center gap-2">
          <Settings2 className="size-4" />
          Manage workspaces
        </Link>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  return (
    <div className={cn("px-2 pt-2", collapsed && "flex justify-center")}>
      <DropdownMenu>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger
                aria-label={label}
                className={cn(chip, "size-9 justify-center")}
              >
                <Avatar initial={initial} />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">
              {multiOrg && activeOrg
                ? `${activeWs.name} · ${activeOrg.name}`
                : activeWs.name}
            </TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger
            aria-label={label}
            className={cn(chip, "w-full gap-2.5 px-2 py-1.5 text-left")}
          >
            <Avatar initial={initial} />
            <span className="flex min-w-0 flex-1 flex-col">
              {multiOrg && activeOrg ? (
                <Kicker size="xs" className="truncate leading-tight">
                  {activeOrg.name}
                </Kicker>
              ) : null}
              <span className="truncate text-sm leading-tight font-bold">
                {activeWs.name}
              </span>
            </span>
            <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
          </DropdownMenuTrigger>
        )}
        {menu}
      </DropdownMenu>

      {/* Controlled, triggerless — opened from the menu item above. */}
      <NewWorkspaceDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        showTrigger={false}
      />
    </div>
  );
}

function Avatar({ initial }: { initial: string }) {
  return (
    <span className="bg-primary/[0.18] text-primary flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold">
      {initial}
    </span>
  );
}

function MenuRow({
  item,
  active,
  onSelect,
}: {
  item: Named;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2">
      <span className="bg-primary text-primary-foreground text-3xs flex size-5 items-center justify-center rounded font-semibold">
        {item.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {active ? <Check className="text-primary size-4 shrink-0" /> : null}
    </DropdownMenuItem>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/components/shell/context-switcher.test.tsx`
Expected: PASS (7). If the "collapsed" test finds the tooltip text "Product" in the DOM, Radix tooltips are closed by default — the `queryByText("Product")` assertion holds; if your Radix version renders hidden content, change that assertion to `expect(trigger).not.toHaveTextContent("Product")`.

- [ ] **Step 5: Swap the import in `sidebar-nav.tsx` and delete the old switchers**

In `src/components/shell/sidebar-nav.tsx` replace the two imports and the two JSX usages:

```tsx
// imports: remove OrgSwitcher + WorkspaceSwitcher, add
import { ContextSwitcher } from "@/components/shell/context-switcher";
// JSX: replace <OrgSwitcher …/> and <WorkspaceSwitcher …/> with
<ContextSwitcher
  orgs={orgs}
  activeOrgId={activeOrgId}
  workspaces={workspaces}
  activeWorkspaceId={activeWorkspaceId}
  collapsed={isCollapsed}
/>;
```

Then:

```bash
git rm src/components/shell/org-switcher.tsx src/components/shell/org-switcher.test.tsx src/components/shell/workspace-switcher.tsx src/components/shell/workspace-switcher.test.tsx
```

In `src/components/shell/sidebar-nav.test.tsx`, update the two org tests: "shows the org switcher for a multi-org user" now queries `getByRole("button", { name: /switch organization or workspace/i })`; "hides the org switcher for a single-org user" asserts `queryByRole("button", { name: /switch organization/i })` is null **and** `getByRole("button", { name: "Switch workspace" })` exists (pass `workspaces={[{ id: "w1", name: "Eng" }]}` in that test so the chip renders).

- [ ] **Step 6: Gates + commit**

Run: `pnpm typecheck && pnpm vitest run src/components/shell`
Expected: PASS.

```bash
git add src/components/shell/context-switcher.tsx src/components/shell/context-switcher.test.tsx src/components/shell/sidebar-nav.tsx src/components/shell/sidebar-nav.test.tsx
git commit -m "feat(shell): ContextSwitcher — one org/workspace chip replaces the twin switchers"
```

---

### Task 4: `SidebarNav` — scroll body, groups, pinned footer, rail dividers

**Files:**

- Modify: `src/components/shell/sidebar-nav.tsx`
- Modify: `src/components/shell/sidebar-nav.test.tsx`
- Modify: `src/components/sidebar.tsx` (aside `overflow-hidden`)
- Modify: `src/app/globals.css` (`.nav-scroll` utility next to `.card-lift`)

**Interfaces:**

- Consumes (T1): `SidebarLink`, `railTileClass`, `RailDivider` from `@/components/shell/sidebar-row`. (T3): `ContextSwitcher` (already wired). `NavSection` (T2 API, no `icon`). `BoardsNav` / `DashboardsNav` keep their current props; when `collapsed` they render their own head tile + tiles (unchanged contract).
- Produces: the shell layout every route uses; `data-testid="sidebar-scroll"` on the scroll body, `<footer>` landmark for My Time + Trash.

- [ ] **Step 1: Add / update tests in `sidebar-nav.test.tsx`**

Keep every existing test (they still hold), except: the "marks the active nav item…" test drops the `border-primary/40` assertion and asserts the bar instead. Add these inside `describe("SidebarNav")`:

```tsx
it("marks the active nav item with the Keystone tint + edge bar", () => {
  vi.mocked(usePathname).mockReturnValue("/my-work");
  renderNav(
    <SidebarNav
      boards={[]}
      sharedBoards={[]}
      workspaces={[]}
      dashboards={[]}
    />,
  );
  const active = screen.getByText("My Work").closest("a")!;
  expect(active).toHaveClass("bg-state-selected");
  expect(active.className).toContain("before:bg-primary");
  expect(active.className).not.toContain("border-primary");
  expect(active).toHaveAttribute("aria-current", "page");
});

it("has no Personal section: My Time and Trash live in a pinned footer", () => {
  renderNav(
    <SidebarNav
      boards={[]}
      sharedBoards={[]}
      workspaces={[]}
      dashboards={[]}
    />,
  );
  expect(screen.queryByText("Personal")).not.toBeInTheDocument();
  const footer = screen.getByRole("contentinfo");
  expect(footer).toContainElement(
    screen.getByRole("link", { name: "My Time" }),
  );
  expect(footer).toContainElement(screen.getByRole("link", { name: /trash/i }));
  expect(footer.className).toContain("border-t");
});

it("scrolls the middle, not the footer, and draws no separators", () => {
  renderNav(
    <SidebarNav
      boards={[]}
      sharedBoards={[]}
      workspaces={[]}
      dashboards={[]}
    />,
  );
  const body = screen.getByTestId("sidebar-scroll");
  expect(body.className).toContain("overflow-y-auto");
  expect(body.className).toContain("nav-scroll");
  expect(body).toHaveAttribute("data-scroll-container");
  expect(body).toContainElement(screen.getByText("Goals"));
  expect(body).not.toContainElement(screen.getByRole("contentinfo"));
  expect(
    document.querySelector('[data-orientation="horizontal"][role="none"]'),
  ).toBeNull();
});

it("collapsed: groups the rail with hairline dividers and keeps the footer", () => {
  useUIStore.setState({ sidebarCollapsed: true, hasHydrated: true });
  renderNav(
    <SidebarNav
      boards={[]}
      sharedBoards={[]}
      workspaces={[{ id: "w1", name: "Eng" }]}
      activeWorkspaceId="w1"
      dashboards={[]}
    />,
  );
  // ws chip | My Work+Agents | Planning | Boards | Dashboards  → 4 dividers in the body, 1 above the footer
  expect(
    document.querySelectorAll("span[aria-hidden='true'].w-4.h-px").length,
  ).toBe(5);
  expect(screen.getByRole("contentinfo")).toContainElement(
    screen.getByLabelText("Trash"),
  );
});

it("collapsed: the active tile carries the edge bar, not the 80% fill", () => {
  useUIStore.setState({ sidebarCollapsed: true, hasHydrated: true });
  vi.mocked(usePathname).mockReturnValue("/goals");
  renderNav(
    <SidebarNav
      boards={[]}
      sharedBoards={[]}
      workspaces={[]}
      dashboards={[]}
    />,
  );
  const goals = screen.getByLabelText("Goals");
  expect(goals.className).toContain("bg-state-selected");
  expect(goals.className).toContain("before:bg-primary");
  expect(goals.className).not.toContain("bg-primary/80");
  expect(goals.className).not.toContain("hover:border");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/components/shell/sidebar-nav.test.tsx`
Expected: the five new tests FAIL (no footer landmark, no `sidebar-scroll`, `Personal` present, old classes).

- [ ] **Step 3: Rewrite `sidebar-nav.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Clock,
  FileText,
  Gauge,
  ListTodo,
  Target,
  Trash2,
} from "lucide-react";
import type { ComponentType } from "react";
import { AskAiMark } from "@/components/brand/ask-ai-mark";
import { BoardsNav } from "@/components/boards/BoardsNav";
import { DashboardsNav } from "@/components/dashboards/DashboardsNav";
import { ContextSwitcher } from "@/components/shell/context-switcher";
import { NavSection } from "@/components/shell/nav-section";
import {
  RailDivider,
  SidebarLink,
  railTileClass,
} from "@/components/shell/sidebar-row";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUIStore } from "@/stores/ui";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import type { BoardListEntry, SharedBoardEntry } from "@/lib/boards/queries";
import type {
  BoardFolder,
  BoardFolderPlacement,
} from "@/lib/boards/folders/types";

type NavLink = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const TOP: NavLink[] = [
  { label: "My Work", href: "/my-work", icon: ListTodo },
  { label: "Agents", href: "/ask", icon: AskAiMark },
];
const PLANNING: NavLink[] = [
  { label: "Goals", href: "/goals", icon: Target },
  { label: "Portfolios", href: "/portfolios", icon: BarChart3 },
  { label: "Reports", href: "/reports", icon: FileText },
  { label: "Workload", href: "/workload", icon: Gauge },
];
const FOOTER: NavLink[] = [
  { label: "My Time", href: "/time", icon: Clock },
  { label: "Trash", href: "/boards#archived", icon: Trash2 },
];

/** Visible caption under a collapsed rail tile on a coarse pointer (gotcha-47). */
function CoarseCaption({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground text-3xs max-w-full truncate leading-tight">
      {label}
    </span>
  );
}

function useActive() {
  const pathname = usePathname();
  // Unchanged from today: "/boards#archived" never prefix-matches a board page.
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/** Collapsed icon-only rail link (tooltip + coarse caption). */
function RailLink({
  item,
  active,
  coarse,
}: {
  item: NavLink;
  active: boolean;
  coarse: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          aria-label={item.label}
          aria-current={active ? "page" : undefined}
          className={railTileClass({ active })}
        >
          <item.icon className="size-4 shrink-0" />
          {coarse ? <CoarseCaption label={item.label} /> : null}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Keystone sidebar body. Order: context chip → My Work / Agents → Planning →
 * Boards → Dashboards, all inside ONE scroll region, then a pinned footer with
 * My Time + Trash. No separators: the ledger rules + 14px section rhythm are
 * the structure. Platform admin lives in the header, not here.
 */
export function SidebarNav({
  orgs = [],
  activeOrgId = "",
  boards,
  sharedBoards,
  folders,
  placements,
  workspaces,
  activeWorkspaceId = "",
  dashboards,
  forceExpanded = false,
}: {
  orgs?: { id: string; name: string }[];
  activeOrgId?: string;
  boards: BoardListEntry[];
  sharedBoards: SharedBoardEntry[];
  folders?: BoardFolder[];
  placements?: BoardFolderPlacement[];
  workspaces: { id: string; name: string }[];
  activeWorkspaceId?: string;
  dashboards: { id: string; name: string }[];
  forceExpanded?: boolean;
}) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const isCollapsed = !forceExpanded && hasHydrated && collapsed;
  const coarse = useCoarsePointer();
  const isActive = useActive();

  const boardsNav = (
    <BoardsNav
      boards={boards}
      sharedBoards={sharedBoards}
      folders={folders}
      placements={placements}
      activeWorkspaceId={activeWorkspaceId}
      collapsed={isCollapsed}
    />
  );
  const dashboardsNav = (
    <DashboardsNav
      dashboards={dashboards}
      activeWorkspaceId={activeWorkspaceId}
      collapsed={isCollapsed}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ContextSwitcher
        orgs={orgs}
        activeOrgId={activeOrgId}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        collapsed={isCollapsed}
      />

      <div
        data-testid="sidebar-scroll"
        data-scroll-container
        className="nav-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
      >
        {isCollapsed ? (
          <nav className="flex flex-col items-center gap-0.5 px-2 pt-2">
            <RailDivider />
            {TOP.map((item) => (
              <RailLink
                key={item.href}
                item={item}
                active={isActive(item.href)}
                coarse={coarse}
              />
            ))}
            <RailDivider />
            {PLANNING.map((item) => (
              <RailLink
                key={item.href}
                item={item}
                active={isActive(item.href)}
                coarse={coarse}
              />
            ))}
            <RailDivider />
            {boardsNav}
            <RailDivider />
            {dashboardsNav}
          </nav>
        ) : (
          <>
            <nav className="flex flex-col gap-0.5 px-2 pt-2.5">
              {TOP.map((item) => (
                <SidebarLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isActive(item.href)}
                />
              ))}
            </nav>
            <NavSection storageKey="planning" title="Planning">
              {PLANNING.map((item) => (
                <SidebarLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isActive(item.href)}
                />
              ))}
            </NavSection>
            {boardsNav}
            {dashboardsNav}
            <div className="h-3.5 shrink-0" aria-hidden="true" />
          </>
        )}
      </div>

      <footer
        className={
          isCollapsed
            ? "border-border flex flex-col items-center gap-0.5 border-t px-2 pt-2 pb-2"
            : "border-border flex flex-col gap-0.5 border-t px-2 pt-2 pb-2"
        }
      >
        {isCollapsed ? (
          <>
            <RailDivider />
            {FOOTER.map((item) => (
              <RailLink
                key={item.href}
                item={item}
                active={isActive(item.href)}
                coarse={coarse}
              />
            ))}
          </>
        ) : (
          FOOTER.map((item) => (
            <SidebarLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(item.href)}
            />
          ))
        )}
      </footer>
    </div>
  );
}
```

Notes:

- The collapsed footer's `RailDivider` is what makes the divider count 5 in the test (4 in the body + 1 here). If you would rather rely on the `border-t` alone, drop it and change the test to 4 — pick one and keep the test honest.
- `BoardsNav` / `DashboardsNav` collapsed output is unchanged in this task (T5 restyles their tiles). Their wrappers are `flex flex-col items-center gap-0.5 px-2 py-2`; inside the rail `<nav>` that nests fine.
- The footer `border-t` on `px-2` runs edge to edge; the spec's inset hairline is `mx-3` — use `mx-2 border-t px-0` if you prefer the inset; the test only checks `border-t`.

- [ ] **Step 4: `sidebar.tsx` and `globals.css`**

`src/components/sidebar.tsx` — the `<aside>` class list gains `overflow-hidden`:

```tsx
"hidden shrink-0 flex-col overflow-hidden md:flex",
```

`src/app/globals.css` — directly after the `.card-lift:hover` media block (≈ line 896), add:

```css
/* Sidebar scroll body: rows fade at both ends instead of clipping. */
.nav-scroll {
  mask-image: linear-gradient(
    to bottom,
    transparent,
    black 10px,
    black calc(100% - 14px),
    transparent
  );
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/components/shell src/components/app-shell.test.tsx src/test/static-shell.test.ts`
Expected: PASS. (`mobile-nav.test.tsx` renders `SidebarNav forceExpanded` — it must still pass; if it asserted on "Personal", update it to the footer.)

- [ ] **Step 6: Gates + commit**

```bash
pnpm typecheck && pnpm lint
git add src/components/shell/sidebar-nav.tsx src/components/shell/sidebar-nav.test.tsx src/components/sidebar.tsx src/app/globals.css
git commit -m "feat(shell): scrolling sidebar body, pinned footer, rail groups; drop Personal + separators"
```

---

### Task 5: Migrate board, folder and dashboard rows onto `SidebarRow`; kill `bg-primary/80`

**Files:**

- Modify: `src/components/boards/PlainBoardRow.tsx`
- Modify: `src/components/boards/SharedBoardRow.tsx`
- Modify: `src/components/boards/BoardsNavSortable.tsx` (`SortableBoardRow`, `GRIP_CLASS`, `DraggableSharedRow`/`DraggableFiledRow` prop rename)
- Modify: `src/components/boards/BoardFolderRow.tsx`
- Modify: `src/components/boards/BoardsNav.tsx` (collapsed tiles; `renderPlainRow`; drop `icon` prop if T2 has not already)
- Modify: `src/components/boards/BoardsNav.test.tsx` (`leading` → `lead` where tests pass it; active assertions)
- Modify: `src/components/dashboards/DashboardsNav.tsx`
- Modify: `src/components/dashboards/DashboardsNav.test.tsx`
- Create: `src/components/shell/sidebar-active-guard.test.ts`

**Interfaces:**

- Consumes (T1): `SidebarRow`, `SIDEBAR_LEAD_CLASS`, `sidebarLabelClass`, `railTileClass`. (T2): `NavSection` without `icon`.
- Produces: `PlainBoardRow` / `SharedBoardRow` prop **`leading` renamed to `lead`** (same 24px contract; `undefined` → spacer). `BoardFolderRow` unchanged API.

- [ ] **Step 1: Write the guard test (fails now)**

`src/components/shell/sidebar-active-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The sidebar's active state is `bg-state-selected` + the brand edge bar
 * (see sidebar-row.tsx). `bg-primary/80 text-foreground` was the old recipe
 * for board/dashboard rows: white on periwinkle in dark, ~2:1, fails AA.
 * Guard the three folders that render sidebar rows.
 */
const ROOTS = [
  "src/components/shell",
  "src/components/boards",
  "src/components/dashboards",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

describe("sidebar active-state guard", () => {
  it("no sidebar component uses the AA-failing bg-primary/80 fill", () => {
    const offenders = ROOTS.flatMap(walk).filter((p) =>
      /bg-primary\/80/.test(readFileSync(p, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/components/shell/sidebar-active-guard.test.ts` — Expected: FAIL listing `PlainBoardRow.tsx`, `SharedBoardRow.tsx`, `BoardsNavSortable.tsx`, `BoardsNav.tsx`, `DashboardsNav.tsx`.

- [ ] **Step 2: Update the row tests first**

In `src/components/boards/BoardsNav.test.tsx`:

- Every `leading={…}` prop passed in tests (grep `leading=`) → `lead={…}`.
- Find the test(s) asserting the active board row (grep `bg-primary/80`); change to:
  ```tsx
  expect(row.className).toContain("bg-state-selected");
  expect(row.className).toContain("before:bg-primary");
  expect(row.className).not.toContain("bg-primary/80");
  ```
- Add to the "folder row alignment" describe:
  ```tsx
  it("keeps the edge bar on the sidebar edge for an active filed row", () => {
    // Folder bodies indent with pl-3 (12px); the bar offsets by px-2 + pl-3.
    // Re-render with the filed owned board active.
  });
  ```
  Implement by rendering `BoardsNav` with `useParams` mocked to `{ boardId: "own" }` (see how the file mocks `next/navigation`) and asserting `filedRow("own").className` contains `before:-left-5`.

In `src/components/dashboards/DashboardsNav.test.tsx` add:

```tsx
it("renders dashboard rows as child SidebarRows with the tint+bar when active", () => {
  vi.mocked(useParams).mockReturnValue({ dashboardId: "d1" }); // adjust to how the file mocks useParams
  render(
    <TooltipProvider>
      <DashboardsNav
        dashboards={[
          { id: "d1", name: "Team" },
          { id: "d2", name: "Ops" },
        ]}
        activeWorkspaceId="ws1"
      />
    </TooltipProvider>,
  );
  const active = screen.getByRole("link", { name: "Team" }).parentElement!;
  expect(active.className).toContain("bg-state-selected");
  expect(active.className).toContain("before:bg-primary");
  expect(active.className).not.toContain("bg-primary/80");
  expect(screen.getByRole("link", { name: "Ops" }).className).toContain(
    "text-xs",
  );
  // 24px lead slot first, like every other row
  expect(active.firstElementChild?.className).toContain("size-6");
});
```

(If the file's `next/navigation` mock returns a fixed `useParams: () => ({})`, change it to `useParams: vi.fn(() => ({}))` and import `useParams` to drive it.)

Run: `pnpm vitest run src/components/boards/BoardsNav.test.tsx src/components/dashboards/DashboardsNav.test.tsx` — Expected: the new/changed assertions FAIL.

- [ ] **Step 3: `PlainBoardRow.tsx`**

```tsx
"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Users2 } from "lucide-react";
import type { BoardListEntry } from "@/lib/boards/queries";
import type { BoardFolder } from "@/lib/boards/folders/types";
import { cn } from "@/lib/utils";
import { BoardItemMenu } from "@/components/boards/BoardItemMenu";
import { SidebarRow, sidebarLabelClass } from "@/components/shell/sidebar-row";

/**
 * An owned-board row that is NOT a `useSortable` item (first paint, and the
 * row the drag layer wraps inside a folder). Built on `SidebarRow`: `lead` is
 * the 24px slot — an inert spacer by default, a real grip when the drag layer
 * passes one — so a row never shifts when the drag tree swaps in. Same prop
 * names as `SharedBoardRow`: one pattern for both row kinds.
 *
 * Structural drag props (ref callback, style, boolean) keep this file free of
 * @dnd-kit so it can render in the shell bundle.
 */
export function PlainBoardRow({
  board,
  isActive,
  folders = [],
  currentFolderId = null,
  lead,
  dragRef,
  isDragging = false,
  style,
}: {
  board: BoardListEntry;
  isActive: boolean;
  folders?: BoardFolder[];
  currentFolderId?: string | null;
  lead?: ReactNode;
  dragRef?: (node: HTMLElement | null) => void;
  isDragging?: boolean;
  style?: CSSProperties;
}) {
  return (
    <SidebarRow
      child
      active={isActive}
      data-board-row={board.id}
      ref={dragRef}
      style={style}
      lead={lead}
      className={cn(
        isDragging && "shadow-drag z-20",
        // Inside a folder body (pl-3) the bar must still sit on the sidebar edge.
        currentFolderId && "before:-left-5",
      )}
      trailing={
        <>
          {board.shared_out ? (
            <Users2
              aria-label="Shared with others"
              className="text-muted-foreground mr-0.5 size-3.5 shrink-0"
            />
          ) : null}
          <BoardItemMenu
            board={{ id: board.id, name: board.name }}
            isActive={isActive}
            folders={folders}
            currentFolderId={currentFolderId}
          />
        </>
      }
    >
      <Link
        href={`/boards/${board.id}`}
        aria-current={isActive ? "page" : undefined}
        className={sidebarLabelClass(true)}
      >
        {board.name}
      </Link>
    </SidebarRow>
  );
}
```

`dragRef` is typed `(node: HTMLElement | null) => void`; `SidebarRow`'s ref is `HTMLDivElement` — assignable, no cast needed.

- [ ] **Step 4: `SharedBoardRow.tsx`** — same shape. Keep the `Eye` "View only" hint and the `SharedBoardMenu` in `trailing`, `lead` in place of `leading`, `sidebarLabelClass(true)` on the `<Link>`, `currentFolderId && "before:-left-5"`, `isDragging && "shadow-drag z-20"`. Read the current file and keep every prop and tooltip it renders (owner-name tooltip etc.) — only the container and label classes change.

- [ ] **Step 5: `BoardsNavSortable.tsx`**

- `GRIP_CLASS`: keep as is (it already is a `size-6` slot; it becomes the `lead`).
- `SortableBoardRow`: replace the outer `<div …>` with

  ```tsx
  <SidebarRow
    child
    active={isActive}
    ref={setNodeRef}
    data-board-row={board.id}
    style={{ transform: DndCSS.Translate.toString(transform), transition }}
    className={cn(isDragging && "shadow-drag z-20")}
    lead={
      <button
        type="button"
        aria-label={`Reorder ${board.name}`}
        className={GRIP_CLASS}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
    }
    trailing={/* Users2 + BoardItemMenu exactly as today */}
  >
    <Link
      href={`/boards/${board.id}`}
      aria-current={isActive ? "page" : undefined}
      className={sidebarLabelClass(true)}
    >
      {board.name}
    </Link>
  </SidebarRow>
  ```

  Note: with `lead` given, `SidebarRow` wraps it in the `size-6` span — the grip button is itself `size-6`, so make `GRIP_CLASS` drop `size-6 shrink-0` and use `flex h-full w-full items-center justify-center` inside the slot, **or** pass `lead={null}` and render the button as the first child (then `firstElementChild` is the `size-6` button — the alignment test passes either way). Pick `lead={null}` + button-first for zero double-wrapping.

- `DraggableSharedRow` / `DraggableFiledRow`: `leading:` → `lead:` in the shared props object and JSX. The `DragSourceGrip` they pass is the `size-6` button — pass it as `lead={null}`'s first child? No: `PlainBoardRow`/`SharedBoardRow` take `lead` (node) and hand it to `SidebarRow`, which wraps it in the slot span. To avoid a `size-6` inside a `size-6`, make `DragSourceGrip` render `flex h-full w-full …` (no `size-6`) — then the slot span is the 24px box and the test's `firstElementChild` (the span) still contains `size-6`.
- Imports: add `SidebarRow`, `sidebarLabelClass` from `@/components/shell/sidebar-row`; remove `cn` if unused.

- [ ] **Step 6: `BoardFolderRow.tsx`**

Replace the header `<div ref={dropRef} …>` with:

```tsx
<SidebarRow
  child
  lead={null}
  ref={dropRef}
  data-folder-row={folder.id}
  data-testid={dropRef ? `folder-drop-${folder.id}` : undefined}
  className={cn(
    isOver && "bg-state-hover ring-primary/60 text-foreground ring-1",
  )}
  trailing={
    <>
      <span
        aria-hidden
        className="text-3xs text-muted-foreground mr-0.5 shrink-0 font-mono tabular-nums"
      >
        {count}
      </span>
      <BoardFolderMenu folder={folder} />
    </>
  }
>
  <button
    type="button"
    onClick={() => toggleSection(key)}
    aria-expanded={open}
    aria-controls={bodyId}
    className={cn(
      "focus-visible:ring-ring flex min-w-0 flex-1 items-center rounded text-left focus-visible:ring-2 focus-visible:outline-none",
      sidebarLabelClass(true),
      "pl-0",
    )}
  >
    <span aria-hidden className={SIDEBAR_LEAD_CLASS}>
      <ChevronDown
        className={cn(
          "ease-keystone size-3.5 transition-transform duration-200",
          !open && "-rotate-90",
        )}
      />
    </span>
    {open ? (
      <FolderOpen className="mr-1.5 size-3.5 shrink-0" aria-hidden />
    ) : (
      <Folder className="mr-1.5 size-3.5 shrink-0" aria-hidden />
    )}
    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
  </button>
</SidebarRow>
```

The button spans slot + label (`pl-0` overrides the label's `pl-1` because the chevron slot is inside the button and the folder icon follows with its own margin — the folder NAME lands ~18px right of the board-name edge, which is the existing, intended tree indent). Keep the `hidden` body with `pl-3`. Drop the `ChevronRight` import (one rotated `ChevronDown`).

- [ ] **Step 7: `BoardsNav.tsx` collapsed tiles + head**

- Both collapsed letter-tile `<Link>` lists (owned and shared) use `className={railTileClass({ active: b.id === activeBoardId, className: "uppercase" })}`.
- The collapsed "Boards" head `<span>` uses `className={railTileClass({ className: "pointer-events-none" })}` (it is not a link today; keep it non-interactive).
- Remove `icon={FolderKanban}` from the `<NavSection>` if T2 has not already; keep the `FolderKanban` import only for the collapsed head tile.
- Import `railTileClass` from `@/components/shell/sidebar-row`; remove the now-unused `cn` if nothing else uses it.
- `renderPlainRow` / any `leading=` usage in this file → `lead=`.

- [ ] **Step 8: `DashboardsNav.tsx`**

- Collapsed: the "Dashboards" head `<Link>` and each tile use `railTileClass({ active: d.id === activeDashboardId, className: "uppercase" })` (head: no `uppercase`).
- Expanded rows:

  ```tsx
  dashboards.map((d) => (
    <SidebarRow
      key={d.id}
      child
      active={d.id === activeDashboardId}
      trailing={
        <DashboardItemMenu
          dashboard={{ id: d.id, name: d.name }}
          isActive={d.id === activeDashboardId}
        />
      }
    >
      <Link
        href={`/dashboards/${d.id}`}
        aria-current={d.id === activeDashboardId ? "page" : undefined}
        className={sidebarLabelClass(true)}
      >
        {d.name}
      </Link>
    </SidebarRow>
  ));
  ```

- Remove `icon={LayoutGrid}` from `<NavSection>` if still present (keep the import for the collapsed head tile). Remove `cn` import if unused.

- [ ] **Step 9: Run everything touched**

Run: `pnpm vitest run src/components/boards src/components/dashboards src/components/shell`
Expected: PASS, including the guard test and the "folder row alignment" suite (row `firstElementChild` is the `size-6` slot span or the `size-6` grip button; no `gap-`/`pl-` on the row).

- [ ] **Step 10: Gates + commit**

```bash
pnpm typecheck && pnpm lint
git add src/components/boards/PlainBoardRow.tsx src/components/boards/SharedBoardRow.tsx src/components/boards/BoardsNavSortable.tsx src/components/boards/BoardFolderRow.tsx src/components/boards/BoardsNav.tsx src/components/boards/BoardsNav.test.tsx src/components/dashboards/DashboardsNav.tsx src/components/dashboards/DashboardsNav.test.tsx src/components/shell/sidebar-active-guard.test.ts
git commit -m "feat(nav): board, folder and dashboard rows on SidebarRow; retire the AA-failing active fill"
```

---

## Whole-branch verification (orchestrator, after batch 2)

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` in the worktree.
2. `pnpm dev -p 3001` in the worktree, screenshot `/my-work` expanded + collapsed, dark + light (Playwright from `node_modules/.cache/`, see the `playwright-screenshots-from-worktree` memory) and compare with the prototype: bar on the sidebar edge for top-level, filed and rail rows; rules brighten on hover; footer pinned; body scrolls with fade when the window is short. `git checkout -- AGENTS.md` afterwards (`next dev` rewrites it).
3. `scripts/finish-task.sh` from inside the worktree; then `/wrapup` with the "How to test" walkthrough from the spec.
