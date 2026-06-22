# Phase 7b Done-Mapping (per-option) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **REQUIRED at build time:** load `pulse-ui` + `frontend-design` skills before writing any JSX (project rule — UI work). Read the relevant Next.js 16 guide in `node_modules/next/dist/docs/` if touching server-action/RSC semantics. This is Next.js 16 — do not assume training-data APIs.

**Goal:** Let users edit, per linked board on an `auto_boards` goal, exactly which status column and which of its options count as "done" — replacing the one-shot name-guess with an editable inline picker in the goal detail drawer.

**Architecture:** UI-only. Extract the portfolio `AddBoardDialog`'s column+options picker body into a shared presentational `DoneMappingFields` component (Task 1, also re-consumed by `AddBoardDialog` with no behavior change). Then make the goal drawer's `auto_boards` board list expandable, lazily fetch+cache each board's status columns on first expand, and persist column/option edits through the **existing** `setGoalLinks` Server Action (Task 2). No schema, RPC, validation, or `database.types.ts` change — the data layer already stores `done_column_id` + `done_option_ids` per `goal_links` row.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), React 19, Tailwind v4 + shadcn/ui, Zod (existing schema), Vitest + @testing-library/react.

---

## Data-layer confirmation (no work needed — verified)

- `GoalLink` already has `doneColumnId: string | null` + `doneOptionIds: string[]` — `src/lib/goals/queries.ts:54-58`.
- `getGoalLinks()` reads `done_column_id, done_option_ids` — `queries.ts:61-77`.
- `setGoalLinks()` persists `{ board_id, done_column_id, done_option_ids }` via `set_goal_links` RPC + `revalidatePath("/goals")` — `src/lib/goals/actions.ts:111-130`.
- `setGoalLinksSchema` validates `doneColumnId: uuid.nullable()`, `doneOptionIds: z.array(uuid)` — `src/lib/validations/goals.ts:52-63`.
- `getStatusColumnsForBoard(boardId)` action → `StatusColumn[] = { id, name, options: { id, label, color }[] }` — `actions.ts:132-139`, `src/lib/portfolios/queries.ts:87-101`, `src/lib/validations/boards.ts:25-30`.

**There is no migration, no RPC change, and no types regen in this plan.**

## File Structure

- **Create:** `src/components/goals/DoneMappingFields.tsx` — presentational, controlled status-column + per-option "done" picker (shared by goals + portfolios). One responsibility: render columns/options and report changes; no fetching, no Server Action calls.
- **Create:** `src/components/goals/DoneMappingFields.test.tsx` — unit tests for the picker.
- **Modify:** `src/components/portfolios/AddBoardDialog.tsx` — replace the inlined column+options markup (lines ~173-243) with `<DoneMappingFields>`; keep all existing behavior (board select, defaults, submit) unchanged.
- **Modify:** `src/components/goals/GoalDetailDrawer.tsx` — the `auto_boards` branch (`GoalEditor`, lines ~211-257): expandable board list, per-board column cache, column/option edits → `setGoalLinks`.
- **Create:** `src/components/goals/GoalDetailDrawer.test.tsx` — tests for the goal drawer edit flow (mocking the goals actions).

## Shared "done" default helper (DRY)

Both `AddBoardDialog` (`DONE_RE = /done|complete|closed/i`) and the goal drawer (`DONE_HINTS = ["done","complete","closed","shipped"]`) currently inline a name-guess. Consolidate into one exported helper so add and edit agree. Put it in the new component file (it is picker-adjacent and the only two callers import the picker anyway):

```ts
// in src/components/goals/DoneMappingFields.tsx
const DONE_RE = /done|complete|closed|shipped/i;

/** Default "done" option ids for a status column, guessed by option label. */
export function defaultDoneOptionIds(
  column: StatusColumn | undefined,
): string[] {
  if (!column) return [];
  return column.options.filter((o) => DONE_RE.test(o.label)).map((o) => o.id);
}
```

> Note: this unifies the two regexes (goal drawer gains `shipped`, portfolio gains nothing it lacked except already had `done|complete|closed`). Behavior change is limited to defaults-on-add and is intentional (one source of truth). The goal drawer's old fallback "if no name match, select ALL options" (`actions`-side `onAddBoard`) is preserved explicitly in Task 2 Step 7 — do not drop it.

---

## Task 1: Extract shared `DoneMappingFields` picker + refactor `AddBoardDialog`

**Files:**

- Create: `src/components/goals/DoneMappingFields.tsx`
- Create: `src/components/goals/DoneMappingFields.test.tsx`
- Modify: `src/components/portfolios/AddBoardDialog.tsx` (replace lines ~173-243 picker body; remove now-unused local `DONE_RE`)

**Interfaces:**

- **Consumes:** `StatusColumn` from `@/lib/portfolios/queries` (`{ id, name, options: { id, label, color }[] }`); `cn` from `@/lib/utils`; `Label` from `@/components/ui/label`.
- **Produces:** `DoneMappingFields` component + `defaultDoneOptionIds(column)` helper, consumed by Task 2 and by the refactored `AddBoardDialog`.

Component contract:

```ts
export type DoneMappingFieldsProps = {
  idPrefix: string; // unique id/htmlFor/aria namespace per instance
  columns: StatusColumn[];
  loading?: boolean;
  doneColumnId: string | null;
  doneOptionIds: string[];
  onColumnChange: (columnId: string | null) => void; // null = "No mapping"
  onToggleOption: (optionId: string) => void;
};
```

- [ ] **Step 1: Write the failing test**

`src/components/goals/DoneMappingFields.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DoneMappingFields,
  defaultDoneOptionIds,
} from "@/components/goals/DoneMappingFields";
import type { StatusColumn } from "@/lib/portfolios/queries";

const columns: StatusColumn[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Status",
    options: [
      {
        id: "aaaaaaaa-0000-0000-0000-000000000001",
        label: "Working",
        color: "#3b82f6",
      },
      {
        id: "aaaaaaaa-0000-0000-0000-000000000002",
        label: "Done",
        color: "#22c55e",
      },
    ],
  },
];

describe("defaultDoneOptionIds", () => {
  it("guesses done options by label", () => {
    expect(defaultDoneOptionIds(columns[0])).toEqual([
      "aaaaaaaa-0000-0000-0000-000000000002",
    ]);
  });
  it("returns [] for undefined", () => {
    expect(defaultDoneOptionIds(undefined)).toEqual([]);
  });
});

describe("DoneMappingFields", () => {
  it("renders an option checkbox per status option, checked from doneOptionIds", () => {
    render(
      <DoneMappingFields
        idPrefix="t1"
        columns={columns}
        doneColumnId={columns[0].id}
        doneOptionIds={["aaaaaaaa-0000-0000-0000-000000000002"]}
        onColumnChange={() => {}}
        onToggleOption={() => {}}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: /working/i }),
    ).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /done/i })).toBeChecked();
  });

  it("calls onToggleOption with the option id when a checkbox is clicked", async () => {
    const onToggleOption = vi.fn();
    render(
      <DoneMappingFields
        idPrefix="t2"
        columns={columns}
        doneColumnId={columns[0].id}
        doneOptionIds={[]}
        onColumnChange={() => {}}
        onToggleOption={onToggleOption}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /done/i }));
    expect(onToggleOption).toHaveBeenCalledWith(
      "aaaaaaaa-0000-0000-0000-000000000002",
    );
  });

  it("calls onColumnChange(null) when 'No mapping' is selected", async () => {
    const onColumnChange = vi.fn();
    render(
      <DoneMappingFields
        idPrefix="t3"
        columns={columns}
        doneColumnId={columns[0].id}
        doneOptionIds={[]}
        onColumnChange={onColumnChange}
        onToggleOption={() => {}}
      />,
    );
    await userEvent.selectOptions(
      screen.getByLabelText(/completion status/i),
      "",
    );
    expect(onColumnChange).toHaveBeenCalledWith(null);
  });

  it("shows loading and no-columns states", () => {
    const { rerender } = render(
      <DoneMappingFields
        idPrefix="t4"
        columns={[]}
        loading
        doneColumnId={null}
        doneOptionIds={[]}
        onColumnChange={() => {}}
        onToggleOption={() => {}}
      />,
    );
    expect(screen.getByText(/loading status columns/i)).toBeInTheDocument();
    rerender(
      <DoneMappingFields
        idPrefix="t4"
        columns={[]}
        doneColumnId={null}
        doneOptionIds={[]}
        onColumnChange={() => {}}
        onToggleOption={() => {}}
      />,
    );
    expect(screen.getByText(/no status columns/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/goals/DoneMappingFields.test.tsx`
Expected: FAIL — cannot resolve `@/components/goals/DoneMappingFields`.

- [ ] **Step 3: Implement `DoneMappingFields`**

`src/components/goals/DoneMappingFields.tsx` (markup ported verbatim from `AddBoardDialog` lines ~173-243; swatch = `style={{ backgroundColor: o.color }}`, paired with text label per pulse-ui status-color rule):

```tsx
"use client";

import type { StatusColumn } from "@/lib/portfolios/queries";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const DONE_RE = /done|complete|closed|shipped/i;
const SELECT_CLASS =
  "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50 dark:bg-input/30";

/** Default "done" option ids for a status column, guessed by option label. */
export function defaultDoneOptionIds(
  column: StatusColumn | undefined,
): string[] {
  if (!column) return [];
  return column.options.filter((o) => DONE_RE.test(o.label)).map((o) => o.id);
}

export type DoneMappingFieldsProps = {
  idPrefix: string;
  columns: StatusColumn[];
  loading?: boolean;
  doneColumnId: string | null;
  doneOptionIds: string[];
  onColumnChange: (columnId: string | null) => void;
  onToggleOption: (optionId: string) => void;
};

export function DoneMappingFields({
  idPrefix,
  columns,
  loading = false,
  doneColumnId,
  doneOptionIds,
  onColumnChange,
  onToggleOption,
}: DoneMappingFieldsProps) {
  const selectId = `${idPrefix}-status-column`;
  const activeColumn = columns.find((c) => c.id === doneColumnId) ?? null;

  if (loading) {
    return (
      <p className="text-muted-foreground text-xs">Loading status columns…</p>
    );
  }
  if (columns.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        This board has no status columns — progress will show as n/a.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={selectId}>Completion status</Label>
      <select
        id={selectId}
        className={SELECT_CLASS}
        value={doneColumnId ?? ""}
        onChange={(e) =>
          onColumnChange(e.target.value === "" ? null : e.target.value)
        }
      >
        <option value="">No mapping (progress n/a)</option>
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {activeColumn ? (
        <fieldset className="mt-1 flex flex-col gap-1.5">
          <legend className="text-muted-foreground mb-1 text-xs">
            Statuses that count as done
          </legend>
          {activeColumn.options.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No statuses defined on this column.
            </p>
          ) : (
            activeColumn.options.map((o) => {
              const checked = doneOptionIds.includes(o.id);
              return (
                <label
                  key={o.id}
                  className={cn(
                    "hover:bg-accent/40 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    checked && "bg-accent/50",
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-primary size-3.5"
                    checked={checked}
                    onChange={() => onToggleOption(o.id)}
                  />
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: o.color }}
                  />
                  {o.label}
                </label>
              );
            })
          )}
        </fieldset>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/goals/DoneMappingFields.test.tsx`
Expected: PASS (all `DoneMappingFields` + `defaultDoneOptionIds` cases).

- [ ] **Step 5: Refactor `AddBoardDialog` to consume the shared picker (no behavior change)**

In `src/components/portfolios/AddBoardDialog.tsx`:

1. Remove the local `const DONE_RE = /done|complete|closed/i;` (line ~25).
2. Add import: `import { DoneMappingFields, defaultDoneOptionIds } from "@/components/goals/DoneMappingFields";`
3. In `applyColumnDefaults`, replace the inline filter with the helper:

```tsx
function applyColumnDefaults(column: StatusColumn | undefined) {
  if (!column) {
    setDoneColumnId(null);
    setDoneOptionIds([]);
    return;
  }
  setDoneColumnId(column.id);
  setDoneOptionIds(defaultDoneOptionIds(column));
}
```

4. Replace the picker JSX block (the `loadingColumns ? … : columns.length === 0 ? … : ( <> <select…/> {activeColumn ? <fieldset…/> : null} </> )` region, lines ~178-241) with:

```tsx
<DoneMappingFields
  idPrefix="add-board"
  columns={columns}
  loading={loadingColumns}
  doneColumnId={doneColumnId}
  doneOptionIds={doneOptionIds}
  onColumnChange={(columnId) =>
    columnId === null
      ? applyColumnDefaults(undefined)
      : applyColumnDefaults(columns.find((c) => c.id === columnId))
  }
  onToggleOption={(optionId) =>
    setDoneOptionIds((prev) =>
      prev.includes(optionId)
        ? prev.filter((id) => id !== optionId)
        : [...prev, optionId],
    )
  }
/>
```

5. Remove the now-unused `toggleOption`, `onColumnChange`, and `activeColumn` locals (their logic moved into the props above / into the picker). Keep `boardId`, `onBoardChange`, `submit`, `error`, the board `<select>`, and the surrounding `{boardId ? (…) : null}` + `<Label>Completion status</Label>` wrapper — note `DoneMappingFields` now renders its own "Completion status" label, so **delete the outer duplicate `<Label htmlFor="add-board-status-column">Completion status</Label>`** (line ~175) to avoid two labels.

- [ ] **Step 6: Verify portfolio behavior is unchanged**

Run: `pnpm test src/lib/validations/portfolios.test.ts src/lib/portfolios/rollup.test.ts`
Expected: PASS (no logic change). Then `pnpm typecheck` — expected: PASS (no unused-var or type errors).
Manually reason: the `AddBoardDialog` add flow still selects a board, defaults done options, toggles, and submits the same `{ portfolioId, boardId, doneColumnId, doneOptionIds }` payload.

- [ ] **Step 7: Commit**

```bash
git add src/components/goals/DoneMappingFields.tsx src/components/goals/DoneMappingFields.test.tsx src/components/portfolios/AddBoardDialog.tsx
git commit -m "refactor(goals): extract shared DoneMappingFields done-mapping picker"
```

---

## Task 2: Make the goal drawer's linked-board list editable

**Files:**

- Modify: `src/components/goals/GoalDetailDrawer.tsx` (the `auto_boards` branch of `GoalEditor`, lines ~211-257; plus add a column cache + expand state; remove the local `DONE_HINTS`)
- Create: `src/components/goals/GoalDetailDrawer.test.tsx`

**Interfaces:**

- **Consumes:** `DoneMappingFields`, `defaultDoneOptionIds` (Task 1); existing `setGoalLinks`, `getStatusColumnsForBoard` actions; existing `GoalLink` type; `StatusColumn` type.
- **Produces:** the user-facing editable done-mapping UI (terminal feature; nothing downstream consumes it).

Design decisions (locked from spec's deferred points):

- **Single-open accordion:** one expanded board at a time — local `useState<string | null>(expandedBoardId)`. Simpler than a Set and sufficient.
- **Column cache:** `useState<Record<string, StatusColumn[]>>({})` keyed by boardId; fetch once per board on first expand. Add a `loadingBoardId` to show the loading state.
- **Edits go through the existing `saveLinks(next)`** (which calls `setGoalLinks` + `router.refresh()` on ok). Server-data change ⇒ Server Action (per AGENTS.md #5), not History API.
- **Error on expand-fetch failure:** set an inline `errorBoardId` + message; leave the row expandable.

- [ ] **Step 1: Write the failing test**

`src/components/goals/GoalDetailDrawer.test.tsx`. Mock the goals actions module so no network/Supabase is hit; render `GoalDetailDrawer` with one `auto_boards` goal selected via the URL search param.

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalDetailDrawer } from "@/components/goals/GoalDetailDrawer";
import type { GoalNode, RowOwner } from "@/lib/goals/types";
import type { GoalLink } from "@/lib/goals/queries";

const setGoalLinks = vi.fn().mockResolvedValue({ ok: true, data: null });
const getStatusColumnsForBoard = vi.fn();

vi.mock("@/lib/goals/actions", () => ({
  setGoalLinks: (...a: unknown[]) => setGoalLinks(...a),
  getStatusColumnsForBoard: (...a: unknown[]) => getStatusColumnsForBoard(...a),
  updateGoal: vi.fn().mockResolvedValue({ ok: true, data: null }),
  deleteGoal: vi.fn().mockResolvedValue({ ok: true, data: null }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("goal=g1"),
}));

// NewGoalDialog pulls in extra deps; stub it for this drawer test.
vi.mock("@/components/goals/NewGoalDialog", () => ({
  NewGoalDialog: () => null,
}));

const BOARD_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const COL_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OPT_WORKING = "dddddddd-0000-0000-0000-000000000001";
const OPT_DONE = "dddddddd-0000-0000-0000-000000000002";

const goal: GoalNode = {
  id: "g1",
  parentGoalId: null,
  name: "Ship v1",
  description: null,
  ownerId: "u1",
  workspaceId: null,
  progressMode: "auto_boards",
  status: "on_track",
  startValue: null,
  currentValue: null,
  targetValue: null,
  unit: null,
  percent: null,
  startDate: null,
  dueDate: null,
  position: 0,
  children: [],
  progress: 0.5,
  autoHealth: "on_track",
  owner: null,
};

const members: RowOwner[] = [
  { userId: "u1", fullName: "Dani", email: "d@x.io", avatarUrl: null },
];
const boards = [{ id: BOARD_ID, name: "Engineering" }];
const links: Record<string, GoalLink[]> = {
  g1: [{ boardId: BOARD_ID, doneColumnId: COL_ID, doneOptionIds: [OPT_DONE] }],
};

beforeEach(() => {
  setGoalLinks.mockClear();
  getStatusColumnsForBoard.mockClear();
  getStatusColumnsForBoard.mockResolvedValue({
    ok: true,
    data: {
      columns: [
        {
          id: COL_ID,
          name: "Status",
          options: [
            { id: OPT_WORKING, label: "Working", color: "#3b82f6" },
            { id: OPT_DONE, label: "Done", color: "#22c55e" },
          ],
        },
      ],
    },
  });
});
afterEach(() => vi.clearAllMocks());

function renderDrawer() {
  return render(
    <GoalDetailDrawer
      tree={[goal]}
      members={members}
      boards={boards}
      links={links}
    />,
  );
}

describe("GoalDetailDrawer done-mapping", () => {
  it("lists the linked board and expands to show the persisted mapping", async () => {
    renderDrawer();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", {
        name: /edit done mapping for engineering/i,
      }),
    );
    await waitFor(() =>
      expect(getStatusColumnsForBoard).toHaveBeenCalledWith(BOARD_ID),
    );
    expect(
      await screen.findByRole("checkbox", { name: /done/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /working/i }),
    ).not.toBeChecked();
  });

  it("toggling an option persists the full links array via setGoalLinks", async () => {
    renderDrawer();
    await userEvent.click(
      screen.getByRole("button", {
        name: /edit done mapping for engineering/i,
      }),
    );
    await userEvent.click(
      await screen.findByRole("checkbox", { name: /working/i }),
    );
    await waitFor(() => expect(setGoalLinks).toHaveBeenCalled());
    expect(setGoalLinks).toHaveBeenCalledWith({
      goalId: "g1",
      links: [
        {
          boardId: BOARD_ID,
          doneColumnId: COL_ID,
          doneOptionIds: [OPT_DONE, OPT_WORKING],
        },
      ],
    });
  });

  it("does not refetch columns when re-expanding the same board", async () => {
    renderDrawer();
    const toggle = screen.getByRole("button", {
      name: /edit done mapping for engineering/i,
    });
    await userEvent.click(toggle); // expand
    await waitFor(() =>
      expect(getStatusColumnsForBoard).toHaveBeenCalledTimes(1),
    );
    await userEvent.click(toggle); // collapse
    await userEvent.click(toggle); // expand again
    expect(getStatusColumnsForBoard).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/goals/GoalDetailDrawer.test.tsx`
Expected: FAIL — no "Edit done mapping for Engineering" button exists yet (current UI has no expand control).

- [ ] **Step 3: Remove the local `DONE_HINTS` and import the shared picker**

In `src/components/goals/GoalDetailDrawer.tsx`:

- Delete `const DONE_HINTS = ["done", "complete", "closed", "shipped"];` (line ~39).
- Add to imports:

```tsx
import { ChevronDown, ChevronRight, Trash2, X } from "lucide-react";
import {
  DoneMappingFields,
  defaultDoneOptionIds,
} from "@/components/goals/DoneMappingFields";
import type { StatusColumn } from "@/lib/portfolios/queries";
```

(Replace the existing `import { Trash2, X } from "lucide-react";` line.)

- [ ] **Step 4: Add expand + column-cache state to `GoalEditor`**

Inside `GoalEditor`, after the existing `useState` calls (near line ~61), add:

```tsx
const [expandedBoardId, setExpandedBoardId] = useState<string | null>(null);
const [columnsByBoard, setColumnsByBoard] = useState<
  Record<string, StatusColumn[]>
>({});
const [loadingBoardId, setLoadingBoardId] = useState<string | null>(null);
const [linkError, setLinkError] = useState<string | null>(null);
```

- [ ] **Step 5: Add the expand/fetch handler**

Inside `GoalEditor` (alongside `saveLinks`, before the `return`):

```tsx
function toggleExpand(boardId: string) {
  setLinkError(null);
  if (expandedBoardId === boardId) {
    setExpandedBoardId(null);
    return;
  }
  setExpandedBoardId(boardId);
  if (columnsByBoard[boardId]) return; // cached — no refetch
  setLoadingBoardId(boardId);
  startTransition(async () => {
    const res = await getStatusColumnsForBoard(boardId);
    setLoadingBoardId(null);
    if (!res.ok) {
      setLinkError(res.error);
      return;
    }
    setColumnsByBoard((prev) => ({ ...prev, [boardId]: res.data.columns }));
  });
}
```

- [ ] **Step 6: Add the per-board edit handlers**

Inside `GoalEditor`:

```tsx
function setColumnForBoard(boardId: string, columnId: string | null) {
  const cols = columnsByBoard[boardId] ?? [];
  const col = columnId ? cols.find((c) => c.id === columnId) : undefined;
  const next = links.map((l) =>
    l.boardId === boardId
      ? {
          ...l,
          doneColumnId: columnId,
          doneOptionIds: defaultDoneOptionIds(col),
        }
      : l,
  );
  saveLinks(next);
}

function toggleOptionForBoard(boardId: string, optionId: string) {
  const next = links.map((l) =>
    l.boardId === boardId
      ? {
          ...l,
          doneOptionIds: l.doneOptionIds.includes(optionId)
            ? l.doneOptionIds.filter((id) => id !== optionId)
            : [...l.doneOptionIds, optionId],
        }
      : l,
  );
  saveLinks(next);
}
```

- [ ] **Step 7: Replace the `auto_boards` linked-board list with the expandable version**

Replace the `<ul>…</ul>` block inside the `auto_boards` branch (lines ~217-235) with:

```tsx
<ul className="flex flex-col gap-1">
  {links.map((l) => {
    const open = expandedBoardId === l.boardId;
    const panelId = `done-map-${l.boardId}`;
    return (
      <li key={l.boardId} className="bg-muted/40 rounded">
        <div className="flex items-center justify-between px-2 py-1 text-sm">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`Edit done mapping for ${boardName(l.boardId)}`}
            onClick={() => toggleExpand(l.boardId)}
            className="text-muted-foreground hover:text-foreground flex flex-1 items-center gap-1.5 text-left"
          >
            {open ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
            <span className="text-foreground">{boardName(l.boardId)}</span>
          </button>
          <button
            type="button"
            aria-label={`Remove ${boardName(l.boardId)}`}
            onClick={() =>
              saveLinks(links.filter((x) => x.boardId !== l.boardId))
            }
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        {open ? (
          <div
            id={panelId}
            className="border-border/60 border-t px-2 pt-1.5 pb-2"
          >
            <DoneMappingFields
              idPrefix={panelId}
              columns={columnsByBoard[l.boardId] ?? []}
              loading={loadingBoardId === l.boardId}
              doneColumnId={l.doneColumnId}
              doneOptionIds={l.doneOptionIds}
              onColumnChange={(columnId) =>
                setColumnForBoard(l.boardId, columnId)
              }
              onToggleOption={(optionId) =>
                toggleOptionForBoard(l.boardId, optionId)
              }
            />
          </div>
        ) : null}
      </li>
    );
  })}
</ul>;
{
  linkError ? (
    <p role="alert" className="text-destructive text-xs">
      {linkError}
    </p>
  ) : null;
}
```

- [ ] **Step 8: Keep `onAddBoard` working with the shared helper**

In `onAddBoard` (lines ~86-113), replace the inline `DONE_HINTS` filter with the shared helper while **preserving the existing fallback** (if no name match, count all options as done):

```tsx
const guessed = defaultDoneOptionIds(col);
const link: GoalLink = {
  boardId,
  doneColumnId: col?.id ?? null,
  doneOptionIds:
    guessed.length > 0 ? guessed : (col?.options.map((o) => o.id) ?? []),
};
```

- [ ] **Step 9: Run the drawer test to verify it passes**

Run: `pnpm test src/components/goals/GoalDetailDrawer.test.tsx`
Expected: PASS — expand fetches once, persisted mapping shows checked, toggle persists the full links array, re-expand does not refetch.

- [ ] **Step 10: Commit**

```bash
git add src/components/goals/GoalDetailDrawer.tsx src/components/goals/GoalDetailDrawer.test.tsx
git commit -m "feat(goals): editable per-option done mapping in goal detail drawer"
```

---

## Task 3: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS, no errors. (Watch for unused vars left in `AddBoardDialog` after the Task 1 refactor.)

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS, no errors/warnings introduced.

- [ ] **Step 3: Test (full suite)**

Run: `pnpm test`
Expected: PASS — all existing tests plus the two new test files green.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: production build succeeds.

- [ ] **Step 5: Finish the task (merge to develop + cleanup)**

From inside the worktree: `scripts/finish-task.sh` (rebases onto latest `develop`, re-runs all four gates against merged state, merges, pushes, removes worktree + branch). Then hand the user the "How to test this" walkthrough (below) and run `/wrapup`.

---

## Execution DAG (AGENTS.md #6)

**Dependency graph:**

- Task 1 (`DoneMappingFields` + `AddBoardDialog` refactor) — no deps.
- Task 2 (goal drawer wiring) — **depends on Task 1** (imports `DoneMappingFields` + `defaultDoneOptionIds`).
- Task 3 (verification gate) — **depends on Tasks 1 and 2**.

```
Task 1 ──► Task 2 ──► Task 3
```

**Parallel batches:** none with >1 task — every task depends on the prior one (Task 2 consumes Task 1's component interface; Task 3 verifies both). **This is a sequential, single-track plan; there is no parallelism to exploit, so tasks run one-at-a-time (no `dispatching-parallel-agents`, no extra worktrees).** This is stated explicitly per AGENTS.md #6 — the plan is small and the DAG is a chain, not a fan-out.

**Critical path:** Task 1 → Task 2 → Task 3 (the entire plan). Wall-clock floor = the sum of the three; ~one focused session.

## Performance & data-fetching budget (AGENTS.md #5) — restated

- **First paint (drawer open):** 0 new server round-trips — renders from props (`getGoalLinks` already ran on the page).
- **Expand a board:** ≤1 read round-trip (`getStatusColumnsForBoard`), first-expand only; cached after → 0 on re-expand. Not the goals list / `goals_rollup`.
- **Edit (column/option):** server-data change → Server Action `setGoalLinks` + `revalidatePath("/goals")` + `router.refresh()` (existing path). Correct per the rule (not History API).
- **Bounded:** all reads bounded/indexed (`board_id` + `kind="status"`); no new unbounded `select *`.

## Self-review

- **Spec coverage:** editable per-option mapping (Task 2 Steps 6-7), shared picker donor (Task 1), name-guess default preserved + unified (`defaultDoneOptionIds`, Task 1 Step 3 + Task 2 Step 8), expand-cache no-refetch (Task 2 Step 5 + test), 0-round-trip first paint (DAG/budget sections), Server-Action edit (Task 2 Step 6), portfolio unchanged (Task 1 Steps 5-6), tests for both new units (Task 1 Step 1, Task 2 Step 1), full gate (Task 3). All spec acceptance items 1-5 mapped.
- **Placeholder scan:** none — every code step has full code; commands have expected output.
- **Type consistency:** `DoneMappingFieldsProps`, `defaultDoneOptionIds`, `StatusColumn`, `GoalLink` used consistently across Tasks 1-2; `onColumnChange(string | null)` / `onToggleOption(string)` signatures match between definition (Task 1) and call sites (Task 2 Step 7, `AddBoardDialog` Task 1 Step 5).

## How to test this (hand to user after merge)

1. Pull `develop`. Open the app, go to **/goals**.
2. Open (or create) a goal whose progress mode is **Auto from boards** that has at least one linked board. (If none, link a board via the drawer's "Add a board…" select first.)
3. In the goal's drawer, under **Contributing boards**, click a board row's chevron to expand it.
4. Confirm the **Completion status** column and the **Statuses that count as done** checkboxes appear, with the currently-counted statuses already checked (colored swatch + label per status).
5. Check or uncheck a status, or change the column. The goal's progress should recompute on the page (the % of done items reflects your new mapping).
6. Reload the page and re-expand the same board — your mapping is still there (persisted), and expanding it again does not re-flash a loading state (columns are cached for the session).
