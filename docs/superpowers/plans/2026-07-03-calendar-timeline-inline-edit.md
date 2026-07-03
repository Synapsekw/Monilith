# Calendar & Timeline Inline Status/% Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. REQUIRED per task: superpowers:test-driven-development.

**Spec:** `docs/superpowers/specs/2026-07-03-calendar-timeline-inline-edit-design.md` — read it
first; it carries the product decisions, UI notes, perf budget, and open questions.

**Goal:** A shared quick-edit peek popover (`ItemQuickEdit`) that opens on tapping a Calendar
event chip / agenda row or a Gantt bar / milestone / unscheduled row, letting the user edit the
item's Status and % complete in place — each edit exactly one Server Action (`upsertCell` /
`clearCell`) with the existing optimistic cache update, zero RSC navigation (gotcha-09).

**Architecture:** Extract the table's status-pill list and percent-parse logic out of
`cells/editors/index.tsx` into shared units; build one `ItemQuickEdit` popover that composes
them and commits through the existing `useBoardMutations().setCell/clearCellValue`; wire it into
`CalendarBoard` (tap callbacks gain an anchor rect) and `GanttBoard` (bars gain a tap action).
Boards with neither a status nor a percent column keep today's tap → ItemPanel behavior.

**Tech Stack:** Next.js 16 / React 19 / Radix Popover (shadcn `ui/popover`) / TanStack Query
board cache / Tailwind v4 (`pointer-coarse:` variant) / Vitest + jsdom + Testing Library.

## Global Constraints

- **Gotcha-09:** no `router.push`/`router.refresh`/`<Link>` for any interaction here; panel-open
  stays History-API `pushState` of `?item=`; edits are Server Actions via the existing mutation
  hook only. 0 new server round-trips to open the peek.
- **No new queries, schema, or migrations.** Everything reads the in-memory board cache.
- **Touch (TOUCH batch-2 parity):** every control in the peek carries `pointer-coarse:min-h-11`;
  nothing hover-gated; **no `autoFocus`** inside the peek (iPad keyboard must not pop on open).
- **pulse-ui:** monochrome chrome, semantic tokens only; color appears only in status pills
  (option `color` + `pillTextColor`); `text-destructive` allowed for destructive menu items only.
- **Commit hygiene:** stage by explicit path; lowercase conventional-commit subjects; descriptive
  body; end body with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Gates for "done":** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (unit project is
  the real test gate; re-run integration flakes in isolation).

## File structure (what exists → what changes)

| File                                                                                           | Role                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/components/boards/cells/editors/status-options.tsx`                                       | **Create** — `StatusOptionList` (pills + Clear) + `parsePercentInput`, extracted from the table editors    |
| `src/components/boards/cells/editors/status-options.test.tsx`                                  | **Create** — unit tests for both exports                                                                   |
| `src/components/boards/cells/editors/index.tsx`                                                | **Modify** — `StatusEditor` and `PercentEditor` consume the extracted units (rendering/behavior unchanged) |
| `src/components/boards/quick-edit/ItemQuickEdit.tsx`                                           | **Create** — the peek popover                                                                              |
| `src/components/boards/quick-edit/ItemQuickEdit.test.tsx`                                      | **Create** — component tests                                                                               |
| `src/components/boards/CalendarBoard.tsx`                                                      | **Modify** — quick-edit state, percent memo, tap routing, render peek                                      |
| `src/components/boards/calendar/EventBar.tsx`                                                  | **Modify** — `onOpen` gains the anchor rect                                                                |
| `src/components/boards/calendar/CalendarMonth.tsx` / `CalendarWeek.tsx` / `CalendarAgenda.tsx` | **Modify** — thread the new `(itemId, rect)` callback signature                                            |
| `src/components/boards/GanttBoard.tsx`                                                         | **Modify** — bars/milestones/unscheduled rows tappable, quick-edit state, render peek                      |
| matching `*.test.tsx` for every modified component                                             | **Modify** — per task below                                                                                |

---

### Task 1: Extract `StatusOptionList` + `parsePercentInput` from the table editors

**Files:**

- Create: `src/components/boards/cells/editors/status-options.tsx`
- Create: `src/components/boards/cells/editors/status-options.test.tsx`
- Modify: `src/components/boards/cells/editors/index.tsx` (StatusEditor ~L192–219, PercentEditor
  ~L159–190; keep `ClearButton` where it is and import it, or move it — mover's choice, exports
  must not break)

**Interfaces:**

- Consumes: `ColumnOption` from `@/lib/validations/boards`; `pillTextColor` from
  `@/lib/boards/contrast`; `cn` from `@/lib/utils`. Nothing from other tasks.
- Produces (Tasks 2 depends on these exact exports from
  `@/components/boards/cells/editors/status-options`):
  - `function StatusOptionList(props: { options: ColumnOption[]; selected: string | null; onSelect: (optionId: string) => void; onClear: () => void }): JSX.Element`
  - `type PercentParse = { kind: "clear" } | { kind: "invalid" } | { kind: "commit"; percent: number }`
  - `function parsePercentInput(raw: string): PercentParse`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/boards/cells/editors/status-options.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StatusOptionList, parsePercentInput } from "./status-options";

const options = [
  { id: "o1", label: "Done", color: "#00854d" },
  { id: "o2", label: "Stuck", color: "#d83a52" },
];

describe("parsePercentInput", () => {
  it("clears on empty/whitespace", () => {
    expect(parsePercentInput("")).toEqual({ kind: "clear" });
    expect(parsePercentInput("   ")).toEqual({ kind: "clear" });
  });
  it("rejects non-numbers", () => {
    expect(parsePercentInput("abc")).toEqual({ kind: "invalid" });
  });
  it("clamps to 0..100", () => {
    expect(parsePercentInput("150")).toEqual({ kind: "commit", percent: 100 });
    expect(parsePercentInput("-3")).toEqual({ kind: "commit", percent: 0 });
  });
  it("passes valid values through", () => {
    expect(parsePercentInput("42")).toEqual({ kind: "commit", percent: 42 });
  });
});

describe("StatusOptionList", () => {
  it("renders a pill per option with aria-selected on the current one", () => {
    render(
      <StatusOptionList
        options={options}
        selected="o1"
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: "Done" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "Stuck" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
  it("fires onSelect with the option id", () => {
    const onSelect = vi.fn();
    render(
      <StatusOptionList
        options={options}
        selected={null}
        onSelect={onSelect}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("option", { name: "Stuck" }));
    expect(onSelect).toHaveBeenCalledWith("o2");
  });
  it("fires onClear from the Clear affordance and keeps 44px coarse targets", () => {
    const onClear = vi.fn();
    render(
      <StatusOptionList
        options={options}
        selected={null}
        onSelect={vi.fn()}
        onClear={onClear}
      />,
    );
    const clear = screen.getByRole("button", { name: "Clear" });
    expect(clear.className).toContain("pointer-coarse:");
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByRole("option", { name: "Done" }).className).toContain(
      "pointer-coarse:min-h-11",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:unit status-options`
Expected: FAIL — module `./status-options` not found.

- [ ] **Step 3: Implement the extraction**

```tsx
// src/components/boards/cells/editors/status-options.tsx
"use client";

import type { ColumnOption } from "@/lib/validations/boards";
import { pillTextColor } from "@/lib/boards/contrast";

/** Trailing "Clear" affordance shared by selector editors and the quick-edit peek. */
export function ClearOptionButton({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="text-muted-foreground hover:bg-accent focus-visible:ring-ring inline-flex items-center justify-center rounded-md px-2 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-11"
    >
      Clear
    </button>
  );
}

/**
 * The status option pills + Clear — the single source of truth for how a
 * status value is picked, shared by the table's StatusEditor (inside its
 * PopoverSurface) and the ItemQuickEdit peek (inside its own popover).
 */
export function StatusOptionList({
  options,
  selected,
  onSelect,
  onClear,
}: {
  options: ColumnOption[];
  selected: string | null;
  onSelect: (optionId: string) => void;
  onClear: () => void;
}) {
  return (
    <>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="option"
          aria-selected={selected === o.id}
          onClick={() => onSelect(o.id)}
          className="focus-visible:ring-ring inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11"
          style={{ backgroundColor: o.color, color: pillTextColor(o.color) }}
        >
          {o.label}
        </button>
      ))}
      <ClearOptionButton onClear={onClear} />
    </>
  );
}

export type PercentParse =
  | { kind: "clear" }
  | { kind: "invalid" }
  | { kind: "commit"; percent: number };

/**
 * Shared percent-input semantics (identical to the table's PercentEditor):
 * empty → clear the cell; NaN → invalid (revert); otherwise clamp 0..100 so a
 * fat-fingered 150 still commits a sensible value.
 */
export function parsePercentInput(raw: string): PercentParse {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "clear" };
  const n = Number(trimmed);
  if (Number.isNaN(n)) return { kind: "invalid" };
  return { kind: "commit", percent: Math.max(0, Math.min(100, n)) };
}
```

Then in `src/components/boards/cells/editors/index.tsx`:

- `StatusEditor` body becomes `PopoverSurface` wrapping
  `<StatusOptionList options={options} selected={selected} onSelect={(optionId) => onCommit({ optionId })} onClear={() => (onClear ?? onCancel)()} />`
  (delete the inlined pill map + its `ClearButton` usage).
- `PercentEditor.commit` becomes:

```tsx
function commit() {
  const parsed = parsePercentInput(raw);
  if (parsed.kind === "clear") return (onClear ?? onCancel)();
  if (parsed.kind === "invalid") return onCancel();
  onCommit({ percent: parsed.percent });
}
```

- Keep the existing local `ClearButton` for the other editors (Dropdown/People/Date) or replace
  all its uses with the exported `ClearOptionButton` and delete the local copy — either way there
  must be exactly **one** implementation left.
- Add `import { StatusOptionList, parsePercentInput } from "./status-options";`.

- [ ] **Step 4: Run and verify green — including no drift**

Run: `pnpm test:unit status-options` → PASS.
Run: `pnpm test:unit editors` → PASS (existing `editors.test.tsx` proves StatusEditor /
PercentEditor rendering and commit/clear behavior did not change).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/cells/editors/status-options.tsx \
        src/components/boards/cells/editors/status-options.test.tsx \
        src/components/boards/cells/editors/index.tsx
git commit -m "refactor(boards): extract status option list + percent parsing from cell editors"
```

(with a body explaining the upcoming quick-edit reuse + the co-author trailer per Global
Constraints.)

---

### Task 2: `ItemQuickEdit` peek popover

**Files:**

- Create: `src/components/boards/quick-edit/ItemQuickEdit.tsx`
- Create: `src/components/boards/quick-edit/ItemQuickEdit.test.tsx`

**Interfaces:**

- Consumes (from Task 1, `@/components/boards/cells/editors/status-options`):
  `StatusOptionList`, `parsePercentInput`. Also existing: `Popover`, `PopoverAnchor`,
  `PopoverContent` from `@/components/ui/popover`; `Input` from `@/components/ui/input`;
  `Button` from `@/components/ui/button`; `CacheColumn` from `@/lib/boards/cache`;
  `ColumnOption` from `@/lib/validations/boards`; `ArrowUpRight` from `lucide-react`.
- Produces (Tasks 3 & 4 depend on these exact exports from
  `@/components/boards/quick-edit/ItemQuickEdit`):
  - `type QuickEditTarget = { itemId: string; anchorRect: DOMRect }`
  - `function ItemQuickEdit(props: { target: QuickEditTarget; itemName: string; statusColumn: CacheColumn | null; percentColumn: CacheColumn | null; statusValue: { optionId: string | null } | null; percentValue: { percent: number } | null; setCell: (vars: { itemId: string; columnId: string; value: unknown }) => void; clearCellValue: (vars: { itemId: string; columnId: string }) => void; onOpenItem: (itemId: string) => void; onClose: () => void }): JSX.Element`
  - Behavior contract: renders nothing editable when a column prop is `null`; **callers must not
    open it when both are `null`** (they fall back to opening the ItemPanel directly).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/boards/quick-edit/ItemQuickEdit.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ItemQuickEdit, type QuickEditTarget } from "./ItemQuickEdit";
import type { CacheColumn } from "@/lib/boards/cache";

const target: QuickEditTarget = {
  itemId: "i1",
  anchorRect: new DOMRect(100, 100, 80, 18),
};
const statusColumn = {
  id: "c-status",
  kind: "status",
  name: "Status",
  settings: {
    options: [
      { id: "o1", label: "Done", color: "#00854d" },
      { id: "o2", label: "Stuck", color: "#d83a52" },
    ],
  },
} as unknown as CacheColumn;
const percentColumn = {
  id: "c-pct",
  kind: "percent",
  name: "% complete",
  settings: {},
} as unknown as CacheColumn;

function setup(overrides: Partial<Parameters<typeof ItemQuickEdit>[0]> = {}) {
  const props = {
    target,
    itemName: "Design homepage",
    statusColumn,
    percentColumn,
    statusValue: { optionId: "o1" },
    percentValue: { percent: 40 },
    setCell: vi.fn(),
    clearCellValue: vi.fn(),
    onOpenItem: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ItemQuickEdit {...props} />);
  return props;
}

describe("ItemQuickEdit", () => {
  it("renders the item name, status pills, and percent input from the cache values", () => {
    setup();
    expect(
      screen.getByRole("dialog", { name: "Edit Design homepage" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Done" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("% complete")).toHaveValue(40);
  });

  it("commits a status pick through setCell and stays open", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("option", { name: "Stuck" }));
    expect(p.setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "c-status",
      value: { optionId: "o2" },
    });
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it("routes status Clear through clearCellValue", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(p.clearCellValue).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "c-status",
    });
  });

  it("commits a clamped percent on Enter and a clear when emptied", () => {
    const p = setup();
    const input = screen.getByLabelText("% complete");
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "c-pct",
      value: { percent: 100 },
    });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(p.clearCellValue).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "c-pct",
    });
  });

  it("hides absent sections and never autofocuses", () => {
    setup({ percentColumn: null, percentValue: null });
    expect(screen.queryByLabelText("% complete")).not.toBeInTheDocument();
    expect(document.activeElement?.tagName).not.toBe("INPUT");
  });

  it("Open hands off to the item panel and closes", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(p.onOpenItem).toHaveBeenCalledWith("i1");
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it("carries 44px coarse-pointer targets", () => {
    setup();
    expect(screen.getByLabelText("% complete").className).toContain(
      "pointer-coarse:min-h-11",
    );
    expect(screen.getByRole("button", { name: /open/i }).className).toContain(
      "pointer-coarse:min-h-11",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:unit ItemQuickEdit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/components/boards/quick-edit/ItemQuickEdit.tsx
"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { CacheColumn } from "@/lib/boards/cache";
import type { ColumnOption } from "@/lib/validations/boards";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  StatusOptionList,
  parsePercentInput,
} from "@/components/boards/cells/editors/status-options";

export type QuickEditTarget = { itemId: string; anchorRect: DOMRect };

/**
 * The quick-edit "peek" for Calendar events and Gantt bars: edit Status and
 * % complete in place (one Server Action per commit, optimistic via the
 * board mutations), with an Open affordance to the full ItemPanel.
 * Callers must not render it when BOTH columns are null — fall back to
 * opening the ItemPanel directly (spec §4.1 empty-capability rule).
 */
export function ItemQuickEdit({
  target,
  itemName,
  statusColumn,
  percentColumn,
  statusValue,
  percentValue,
  setCell,
  clearCellValue,
  onOpenItem,
  onClose,
}: {
  target: QuickEditTarget;
  itemName: string;
  statusColumn: CacheColumn | null;
  percentColumn: CacheColumn | null;
  statusValue: { optionId: string | null } | null;
  percentValue: { percent: number } | null;
  setCell: (vars: { itemId: string; columnId: string; value: unknown }) => void;
  clearCellValue: (vars: { itemId: string; columnId: string }) => void;
  onOpenItem: (itemId: string) => void;
  onClose: () => void;
}) {
  const { itemId, anchorRect } = target;
  const options =
    (statusColumn?.settings as { options?: ColumnOption[] } | null)?.options ??
    [];
  const [pctRaw, setPctRaw] = useState(
    percentValue ? String(percentValue.percent) : "",
  );

  function commitPercent() {
    if (!percentColumn) return;
    const parsed = parsePercentInput(pctRaw);
    if (parsed.kind === "invalid") {
      setPctRaw(percentValue ? String(percentValue.percent) : "");
      return;
    }
    if (parsed.kind === "clear") {
      if (percentValue) clearCellValue({ itemId, columnId: percentColumn.id });
      return;
    }
    setCell({
      itemId,
      columnId: percentColumn.id,
      value: { percent: parsed.percent },
    });
  }

  return (
    <Popover
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* Fixed-position anchor at the tapped chip/bar's rect (portals past overflow). */}
      <PopoverAnchor asChild>
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: anchorRect.left,
            top: anchorRect.top,
            width: anchorRect.width,
            height: anchorRect.height,
            pointerEvents: "none",
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        role="dialog"
        aria-label={`Edit ${itemName}`}
        align="start"
        sideOffset={4}
        className="flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-auto max-w-[18rem] min-w-[14rem] flex-col gap-2 overflow-auto p-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium">
            {itemName}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 pointer-coarse:min-h-11"
            onClick={() => {
              onOpenItem(itemId);
              onClose();
            }}
          >
            <ArrowUpRight className="size-3.5" aria-hidden />
            Open
          </Button>
        </div>

        {statusColumn && (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">
              {statusColumn.name}
            </span>
            <div
              className="flex flex-col gap-0.5"
              role="listbox"
              aria-label={statusColumn.name}
            >
              <StatusOptionList
                options={options}
                selected={statusValue?.optionId ?? null}
                onSelect={(optionId) =>
                  setCell({
                    itemId,
                    columnId: statusColumn.id,
                    value: { optionId },
                  })
                }
                onClear={() =>
                  clearCellValue({ itemId, columnId: statusColumn.id })
                }
              />
            </div>
          </div>
        )}

        {percentColumn && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`quick-edit-pct-${itemId}`}
              className="text-muted-foreground text-xs"
            >
              {percentColumn.name}
            </label>
            <Input
              id={`quick-edit-pct-${itemId}`}
              type="number"
              min={0}
              max={100}
              value={pctRaw}
              onChange={(e) => setPctRaw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitPercent();
                }
              }}
              onBlur={commitPercent}
              className="h-8 tabular-nums pointer-coarse:min-h-11"
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

Adjust against reality while implementing (e.g. `aria-label` resolution for the input via the
`<label htmlFor>`; if `getByLabelText` needs it, keep the explicit label element as shown). Keep
the no-`autoFocus` rule.

- [ ] **Step 4: Run to verify green**

Run: `pnpm test:unit ItemQuickEdit` → PASS. Also `pnpm test:unit editors status-options` → still
PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/quick-edit/ItemQuickEdit.tsx \
        src/components/boards/quick-edit/ItemQuickEdit.test.tsx
git commit -m "feat(boards): item quick-edit peek popover for status and percent"
```

---

### Task 3: Calendar wiring — tap opens the peek

**Files:**

- Modify: `src/components/boards/CalendarBoard.tsx` (statusColumn memo ~L125; `shared` props
  ~L252–260; render block ~L262–316)
- Modify: `src/components/boards/calendar/EventBar.tsx` (`onOpen` prop + click/key handlers
  ~L56, L80–86, L105–109, L138–142)
- Modify: `src/components/boards/calendar/CalendarMonth.tsx` (`onOpenItem` prop ~L34/L44,
  EventBar pass-through ~L214–221, overflow rows ~L256)
- Modify: `src/components/boards/calendar/CalendarWeek.tsx` (`onOpenItem` pass-through)
- Modify: `src/components/boards/calendar/CalendarAgenda.tsx` (`onOpenItem` prop ~L37/L47, row
  onClick ~L98)
- Test: `src/components/boards/CalendarBoard.test.tsx`, `calendar/EventBar.test.tsx`,
  `calendar/CalendarMonth.test.tsx`, `calendar/CalendarWeek.test.tsx`,
  `calendar/CalendarAgenda.test.tsx`

**Interfaces:**

- Consumes (Task 2): `ItemQuickEdit`, `QuickEditTarget` from
  `@/components/boards/quick-edit/ItemQuickEdit`. Existing: `useBoardMutations` (add
  `clearCellValue` to the destructure), `buildCellMap`/`cellKey` from `@/lib/boards/cache`,
  `openItemPanel` (already in `CalendarBoard.tsx`).
- Produces: new sub-view callback signature `onItemTap?: (itemId: string, anchorRect: DOMRect) =>
void` (replaces `onOpenItem?: (itemId: string) => void` on `CalendarMonth`, `CalendarWeek`,
  `CalendarAgenda`, and `onOpen` on `EventBar`). Nothing downstream consumes this beyond Task 3
  itself — Task 4 is independent.

- [ ] **Step 1: Write the failing tests**

In `CalendarBoard.test.tsx` (board payload fixtures already exist there — extend them so the
board has a status column with options and a percent column):

```tsx
it("opens the quick-edit peek on event click instead of the item panel", () => {
  renderCalendarWithStatusAndPercent(); // fixture: status + percent columns present
  fireEvent.click(screen.getByLabelText("Design homepage")); // the EventBar chip
  expect(
    screen.getByRole("dialog", { name: "Edit Design homepage" }),
  ).toBeInTheDocument();
  expect(new URL(window.location.href).searchParams.get("item")).toBeNull();
});

it("the peek's Open button pushes ?item= via the History API (no RSC nav)", () => {
  renderCalendarWithStatusAndPercent();
  fireEvent.click(screen.getByLabelText("Design homepage"));
  fireEvent.click(screen.getByRole("button", { name: /open/i }));
  expect(new URL(window.location.href).searchParams.get("item")).toBe("i1");
});

it("falls back to opening the item panel when no status/percent column exists", () => {
  renderCalendarWithoutEditableColumns(); // fixture: date column only
  fireEvent.click(screen.getByLabelText("Design homepage"));
  expect(
    screen.queryByRole("dialog", { name: /edit/i }),
  ).not.toBeInTheDocument();
  expect(new URL(window.location.href).searchParams.get("item")).toBe("i1");
});
```

In `EventBar.test.tsx`, update the two existing `onOpen` tests to assert the new signature:

```tsx
expect(onOpen).toHaveBeenCalledWith("i1", expect.any(Object)); // DOMRect from currentTarget
```

Router-safety: keep/extend the existing "no router navigation" assertions (mock
`next/navigation`'s router and assert `push`/`refresh` uncalled through all of the above).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:unit CalendarBoard EventBar`
Expected: FAIL — peek dialog not rendered; `onOpen` called with 1 arg.

- [ ] **Step 3: Implement**

`EventBar.tsx` — widen the callback and pass the rect (both pointer + keyboard paths):

```tsx
onOpen?: (itemId: string, anchorRect: DOMRect) => void;
// click:
onClick={(e) => {
  e.stopPropagation();
  onOpen?.(interval.itemId, e.currentTarget.getBoundingClientRect());
}}
// keydown (Enter/Space):
onOpen?.(interval.itemId, e.currentTarget.getBoundingClientRect());
```

`CalendarMonth.tsx` / `CalendarWeek.tsx` / `CalendarAgenda.tsx` — rename the prop to
`onItemTap?: (itemId: string, anchorRect: DOMRect) => void` and pass
`e.currentTarget.getBoundingClientRect()` from the overflow/agenda row `onClick`s; `EventBar`'s
`onOpen` receives `onItemTap` unchanged (signatures now match).

`CalendarBoard.tsx`:

```tsx
const { setCell, clearCellValue, addItem } = useBoardMutations(
  payload.board.id,
);
const percentColumn = useMemo(
  () => cache.columns.find((c) => c.kind === "percent"),
  [cache.columns],
);
const [quickEdit, setQuickEdit] = useState<QuickEditTarget | null>(null);

function handleItemTap(itemId: string, anchorRect: DOMRect) {
  if (statusColumn || percentColumn) setQuickEdit({ itemId, anchorRect });
  else openItemPanel(itemId);
}

// shared props: onOpenItem → onItemTap: handleItemTap
```

Render (after the mode block, inside the root flex column):

```tsx
{
  quickEdit && (
    <ItemQuickEdit
      target={quickEdit}
      itemName={cache.items.find((i) => i.id === quickEdit.itemId)?.name ?? ""}
      statusColumn={statusColumn ?? null}
      percentColumn={percentColumn ?? null}
      statusValue={
        statusColumn
          ? ((cellMap.get(cellKey(quickEdit.itemId, statusColumn.id)) ??
              null) as { optionId: string | null } | null)
          : null
      }
      percentValue={
        percentColumn
          ? ((cellMap.get(cellKey(quickEdit.itemId, percentColumn.id)) ??
              null) as { percent: number } | null)
          : null
      }
      setCell={setCell}
      clearCellValue={clearCellValue}
      onOpenItem={openItemPanel}
      onClose={() => setQuickEdit(null)}
    />
  );
}
```

(`cellKey` import from `@/lib/boards/cache`; the peek re-renders live from `cellMap` after the
optimistic patch because `quickEdit` state survives the cache update.)

- [ ] **Step 4: Run to verify green**

Run: `pnpm test:unit CalendarBoard EventBar CalendarMonth CalendarWeek CalendarAgenda` → PASS
(including all pre-existing calendar tests, some re-targeted per Step 1).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/CalendarBoard.tsx \
        src/components/boards/CalendarBoard.test.tsx \
        src/components/boards/calendar/EventBar.tsx \
        src/components/boards/calendar/EventBar.test.tsx \
        src/components/boards/calendar/CalendarMonth.tsx \
        src/components/boards/calendar/CalendarMonth.test.tsx \
        src/components/boards/calendar/CalendarWeek.tsx \
        src/components/boards/calendar/CalendarWeek.test.tsx \
        src/components/boards/calendar/CalendarAgenda.tsx \
        src/components/boards/calendar/CalendarAgenda.test.tsx
git commit -m "feat(boards): quick-edit status and percent from calendar events"
```

---

### Task 4: Gantt wiring — bars/milestones/unscheduled rows open the peek

**Files:**

- Modify: `src/components/boards/GanttBoard.tsx` (imports; board body ~L150–190 for memos/state;
  bar body ~L905–920; milestone ~L865–885; `UnscheduledSection` ~L941–972; render peek near root)
- Test: `src/components/boards/GanttBoard.test.tsx`

**Interfaces:**

- Consumes (Task 2): `ItemQuickEdit`, `QuickEditTarget` from
  `@/components/boards/quick-edit/ItemQuickEdit`. Existing: `mutations.setCell` /
  `mutations.clearCellValue` (already returned by `useBoardMutations`), `buildCellMap`/`cellKey`
  from `@/lib/boards/cache` (GanttBoard does not currently build a cellMap — add the same
  `useMemo` CalendarBoard uses).
- Produces: `GanttRowItem` gains `onItemTap: (itemId: string, anchorRect: DOMRect) => void`;
  `UnscheduledSection` gains the same prop. Internal to this file — nothing else consumes them.

- [ ] **Step 1: Write the failing tests**

In `GanttBoard.test.tsx` (fixtures exist; extend the board fixture with a status column with
options + a percent column):

```tsx
it("opens the quick-edit peek when a bar is clicked", () => {
  renderGanttWithStatusAndPercent();
  fireEvent.click(screen.getByText("Design homepage")); // bar label inside the bar body
  expect(
    screen.getByRole("dialog", { name: "Edit Design homepage" }),
  ).toBeInTheDocument();
});

it("commits a status pick from the peek through setCell (one server action, no router nav)", () => {
  renderGanttWithStatusAndPercent();
  fireEvent.click(screen.getByText("Design homepage"));
  fireEvent.click(screen.getByRole("option", { name: "Stuck" }));
  expect(upsertCellMock).toHaveBeenCalledOnce(); // the mocked server action
  expect(routerRefreshMock).not.toHaveBeenCalled();
});

it("opens the peek from a milestone and from an unscheduled row", () => {
  renderGanttWithMilestoneAndUnscheduled();
  fireEvent.click(screen.getByLabelText("Ship it")); // milestone diamond (new aria-label)
  expect(
    screen.getByRole("dialog", { name: "Edit Ship it" }),
  ).toBeInTheDocument();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" }); // close
  fireEvent.click(screen.getByRole("button", { name: "Backlog task" })); // unscheduled row
  expect(
    screen.getByRole("dialog", { name: "Edit Backlog task" }),
  ).toBeInTheDocument();
});

it("resize-strip pointerdown does not open the peek", () => {
  renderGanttWithStatusAndPercent();
  fireEvent.pointerDown(screen.getByLabelText("Resize Design homepage"));
  fireEvent.click(screen.getByLabelText("Resize Design homepage"));
  expect(
    screen.queryByRole("dialog", { name: /edit/i }),
  ).not.toBeInTheDocument();
});
```

Mocking follows the existing `GanttBoard.test.tsx` patterns (server actions mocked at the
`@/lib/boards/actions` boundary; router mocked from `next/navigation`).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:unit GanttBoard`
Expected: FAIL — no dialog on click.

- [ ] **Step 3: Implement**

In `GanttBoard` body (mirrors CalendarBoard):

```tsx
const statusColumn = useMemo(
  () => cache.columns.find((c) => c.kind === "status"),
  [cache.columns],
);
const percentColumn = useMemo(
  () => cache.columns.find((c) => c.kind === "percent"),
  [cache.columns],
);
const cellMap = useMemo(
  () => buildCellMap(cache.cellValues),
  [cache.cellValues],
);
const [quickEdit, setQuickEdit] = useState<QuickEditTarget | null>(null);

/** Open the item detail panel via ?item= pushState — no RSC navigation (gotcha-09). */
function openItemPanel(itemId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("item", itemId);
  window.history.pushState({}, "", url);
}
function handleItemTap(itemId: string, anchorRect: DOMRect) {
  if (statusColumn || percentColumn) setQuickEdit({ itemId, anchorRect });
  else openItemPanel(itemId);
}
```

- Pass `onItemTap={handleItemTap}` into every `GanttRowItem` and into `UnscheduledSection`.
- **Bar body** (the flex-1 drag-handle div): add
  `role="button" tabIndex={0} aria-label={row.name}`, an `onClick={(e) =>
onItemTap(row.itemId, e.currentTarget.getBoundingClientRect())}`, and Enter/Space `onKeyDown`
  doing the same (dnd-kit only swallows the click when a drag actually activated — same behavior
  `EventBar` relies on). Keep `listeners`/`attributes` spread as-is.
- **Milestone diamond**: same `onClick`/`onKeyDown`/`tabIndex`; replace `title={row.name}` with
  `aria-label={row.name}` (keep `title` too if desired).
- **Resize strip**: unchanged — its `stopPropagation()` pointer handlers already isolate it; add
  `e.stopPropagation()` to a new `onClick` no-op ONLY if the failing test shows click bubbling
  from the strip into the bar body.
- **UnscheduledSection rows**: `<li>` content becomes a full-width `<button type="button">` with
  the row name, `className` keeping current typography + `hover:bg-accent rounded-md text-left
w-full pointer-coarse:min-h-11`, `onClick` → `onItemTap(row.itemId, rect)`.
- Render `<ItemQuickEdit …/>` at the root (same prop derivation as CalendarBoard Task 3 Step 3,
  reading `statusValue`/`percentValue` from this file's new `cellMap`, `onOpenItem={openItemPanel}`).

- [ ] **Step 4: Run to verify green**

Run: `pnpm test:unit GanttBoard` → PASS, including all pre-existing drag/zoom/menu/touch tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/GanttBoard.tsx src/components/boards/GanttBoard.test.tsx
git commit -m "feat(boards): quick-edit status and percent from gantt bars"
```

---

### Task 5: Full gates + closure

**Files:** none (verification + closure)

**Interfaces:**

- Consumes: everything above merged into the worktree branch.
- Produces: green gates; merged `develop`; "How to test" walkthrough.

- [ ] **Step 1: Full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → all green (re-run any
`*.integration.test.ts` flake in isolation; `pnpm test:unit` is the deciding signal for this
feature's surfaces).

- [ ] **Step 2: Budget & convention audit (manual reasoning pass)**

- Grep the diff for `router.push|router.refresh|<Link` in the changed files → none added.
- Grep for `autoFocus` in `ItemQuickEdit.tsx` → none.
- Every new interactive element carries a `pointer-coarse:` ≥44px class and a
  `focus-visible:ring` treatment; no raw Tailwind colors introduced.

- [ ] **Step 3: Finish**

Run `scripts/finish-task.sh` from the worktree (rebases onto `develop`, re-gates, merges, cleans
up). Then deliver the "How to test" walkthrough below + `/wrapup`.

**How to test (post-merge, for the user):**

1. Pull `develop`, run the app, open a board that has a **Status** column (with options) and a
   **% complete (percent)** column, plus a Date column.
2. Switch to the **Calendar** view → click an event chip → a small popover opens showing the item
   name, status pills, and a % field. Pick a different status → the chip/span color updates
   instantly; reload to confirm it persisted.
3. Type `150` in the % field and press Enter → it commits as `100` (check the Table view's
   percent cell). Clear the field and blur → the percent cell empties.
4. Click **Open** in the popover → the full item panel opens (URL gains `?item=`, no page
   reload/flash).
5. Switch to the **Timeline** view → click a bar (a plain click, not a drag) → same popover;
   edit status/% and verify the bar recolors (when "Color by" = Status) and the table agrees.
   Milestones (diamonds) and rows under **Unscheduled** open it too.
6. On a board whose only columns are Name + Date (no status/percent), clicking a calendar event
   opens the item panel directly, exactly as before.
7. **iPad / touch emulation:** tap targets in the popover are ≥44px; opening the popover does not
   pop the keyboard; long-press still lifts chips/bars for drag; a quick tap opens the popover.

---

## Execution DAG (working agreement #6)

**Dependency edges (from the Interfaces blocks):**

- Task 2 consumes Task 1's `StatusOptionList` + `parsePercentInput` → **2 depends on 1**.
- Tasks 3 and 4 consume Task 2's `ItemQuickEdit`/`QuickEditTarget` → **3, 4 depend on 2**.
- Tasks 3 and 4 are **file-disjoint** (3: `CalendarBoard.tsx` + `calendar/*`; 4:
  `GanttBoard.tsx` only) and share no new state → independent of each other.
- Task 5 depends on 3 and 4.

```
1 ──► 2 ──►┬──► 3 ──►┐
           │          ├──► 5
           └──► 4 ──►┘
```

- **Parallel batches:** Batch A = {1} → Batch B = {2} → **Batch C = {3, 4} (dispatch as 2
  concurrent lanes** — same worktree is fine for subagent-driven execution since the file sets
  are disjoint; use separate worktrees only if executed as independent sessions) → Batch D = {5}.
- **Critical path (wall-clock floor):** 1 → 2 → 3 (calendar is the wider lane: 5 files + 5 test
  files) → 5 = **4 sequential tasks**.
- **Task count:** 5 (4 implementation + 1 gate/closure). **Size:** Medium.
