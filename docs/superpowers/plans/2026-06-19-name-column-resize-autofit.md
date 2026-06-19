# Name Column Auto-fit + Manual Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board table's built-in Name column auto-fit the longest item name by default and be manually resizable (drag) with double-click-to-refit, persisted per-board server-side.

**Architecture:** A nullable `boards.name_column_width` (NULL = auto-fit, int = manual) persists via a `resizeNameColumn` Server Action mirroring `resizeColumn`, wired into `use-board-mutations` with an optimistic `replaceBoard` patch. A pure `fitNameColumnWidth` util measures the longest name (offscreen canvas in the component). `BoardTable` gains a draggable `NameColumnHeader`.

**Tech Stack:** Next.js 16 RSC + Server Actions, Supabase (migration + RLS), Zod, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-19-name-column-resize-autofit-design.md`

---

### Task 1: Migration + regenerated types

**Files:**

- Create: `supabase/migrations/20260619110000_boards_name_column_width.sql`
- Modify: `src/types/database.types.ts` (regenerated, not hand-edited)

- [ ] **Step 1: Write the migration**

```sql
-- Per-board width for the built-in Name column. NULL = auto-fit (the client
-- measures the longest item name); an integer is a user-dragged width. Bounds
-- mirror the configurable-column resize handle (ColumnHeader MIN/MAX = 80/1200).
alter table public.boards
  add column name_column_width int
  check (name_column_width is null or name_column_width between 80 and 1200);
```

- [ ] **Step 2: Apply migration + regenerate types**

Run: `pnpm db:types` (script: `supabase gen types typescript --linked …`). If the
project is linked and migration is applied (e.g. `supabase db push` first), this
adds `name_column_width: number | null` to `boards` Row/Insert/Update.
Expected: `git diff src/types/database.types.ts` shows the new field in all three.

> If `db:types`/`--linked` is unavailable in this environment, surface it — do
> NOT hand-edit beyond the single `name_column_width: number | null` field, and
> flag that types must be regenerated against the DB before merge.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260619110000_boards_name_column_width.sql src/types/database.types.ts
git commit -m "feat(db): boards.name_column_width for resizable Name column"
```

---

### Task 2: Zod schema `resizeNameColumnSchema`

**Files:**

- Modify: `src/lib/validations/board-actions.ts` (after `resizeColumnSchema`, ~line 43)
- Test: `src/lib/validations/board-actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add `resizeNameColumnSchema` to the import block, then:
describe("resizeNameColumnSchema", () => {
  it("accepts an in-range width and null", () => {
    expect(
      resizeNameColumnSchema.safeParse({ boardId: uuid, width: 300 }).success,
    ).toBe(true);
    expect(
      resizeNameColumnSchema.safeParse({ boardId: uuid, width: null }).success,
    ).toBe(true);
  });
  it("rejects out-of-range and non-int widths", () => {
    expect(
      resizeNameColumnSchema.safeParse({ boardId: uuid, width: 5000 }).success,
    ).toBe(false);
    expect(
      resizeNameColumnSchema.safeParse({ boardId: uuid, width: 12.5 }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- board-actions`
Expected: FAIL — `resizeNameColumnSchema is not defined`.

- [ ] **Step 3: Add the schema**

```ts
export const resizeNameColumnSchema = z.object({
  boardId: uuid,
  width: z.number().int().min(80).max(1200).nullable(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- board-actions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/board-actions.ts src/lib/validations/board-actions.test.ts
git commit -m "feat(boards): resizeNameColumnSchema (nullable width)"
```

---

### Task 3: `resizeNameColumn` Server Action

**Files:**

- Modify: `src/lib/boards/actions.ts` (import schema; add action after `resizeColumn`)
- Test: `src/lib/boards/name-column-actions.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { resizeNameColumn } from "@/lib/boards/actions";

const BOARD = "11111111-1111-4111-8111-111111111111";
beforeEach(() => from.mockReset());

describe("resizeNameColumn", () => {
  it("updates name_column_width on the board", async () => {
    const update = vi
      .fn()
      .mockReturnValue({ eq: async () => ({ error: null }) });
    from.mockImplementation((t: string) => (t === "boards" ? { update } : {}));
    const res = await resizeNameColumn({ boardId: BOARD, width: 320 });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ name_column_width: 320 });
  });

  it("accepts null (auto-fit)", async () => {
    const update = vi
      .fn()
      .mockReturnValue({ eq: async () => ({ error: null }) });
    from.mockImplementation((t: string) => (t === "boards" ? { update } : {}));
    const res = await resizeNameColumn({ boardId: BOARD, width: null });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ name_column_width: null });
  });

  it("rejects out-of-range widths before any db call", async () => {
    const res = await resizeNameColumn({ boardId: BOARD, width: 5000 });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- name-column-actions`
Expected: FAIL — `resizeNameColumn` is not exported.

- [ ] **Step 3: Implement the action**

Add `resizeNameColumnSchema` to the `@/lib/validations/board-actions` import block in `actions.ts`, then:

```ts
export async function resizeNameColumn(input: {
  boardId: string;
  width: number | null;
}): Promise<ActionResult> {
  const parsed = resizeNameColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { error } = await supabase
    .from("boards")
    .update({ name_column_width: parsed.data.width })
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);
  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, data: undefined };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- name-column-actions`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/actions.ts src/lib/boards/name-column-actions.test.ts
git commit -m "feat(boards): resizeNameColumn server action"
```

---

### Task 4: `fitNameColumnWidth` pure util

**Files:**

- Create: `src/lib/boards/name-column-width.ts`
- Test: `src/lib/boards/name-column-width.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  fitNameColumnWidth,
  NAME_COL_MIN,
  NAME_COL_MAX,
} from "@/lib/boards/name-column-width";

// stub measurer: 7px per char (real canvas measureText returns 0 in jsdom)
const measure = (s: string) => s.length * 7;

describe("fitNameColumnWidth", () => {
  it("fits the longest name plus padding, clamped to the floor", () => {
    // longest = "abcd" → 28px + PADDING(60) = 88 < floor → floor
    expect(fitNameColumnWidth(["a", "abcd"], measure)).toBe(NAME_COL_MIN);
  });

  it("grows with a long name", () => {
    const long = "x".repeat(60); // 420 + 60 = 480
    expect(fitNameColumnWidth([long], measure)).toBe(480);
  });

  it("clamps to the max", () => {
    const huge = "x".repeat(1000);
    expect(fitNameColumnWidth([huge], measure)).toBe(NAME_COL_MAX);
  });

  it("falls back to the floor for no names", () => {
    expect(fitNameColumnWidth([], measure)).toBe(NAME_COL_MIN);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- name-column-width`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the util**

```ts
/** Bounds mirror ColumnHeader MIN/MAX and the DB check constraint. */
export const NAME_COL_MIN = 180; // floor: enough for the header + controls
export const NAME_COL_MAX = 1200;
/** Cell chrome around the text: px-4 left (16) + open-panel button + gap (~44). */
const PADDING = 60;

/**
 * Auto-fit width for the Name column: the widest measured name plus cell
 * padding, clamped to [NAME_COL_MIN, NAME_COL_MAX]. `measure` is injected so the
 * function is testable without a real canvas (jsdom measureText returns 0).
 */
export function fitNameColumnWidth(
  names: string[],
  measure: (text: string) => number,
): number {
  let widest = 0;
  for (const n of names) {
    const w = measure(n);
    if (w > widest) widest = w;
  }
  return Math.min(
    NAME_COL_MAX,
    Math.max(NAME_COL_MIN, Math.ceil(widest) + PADDING),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- name-column-width`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/name-column-width.ts src/lib/boards/name-column-width.test.ts
git commit -m "feat(boards): fitNameColumnWidth auto-fit util"
```

---

### Task 5: Wire `resizeNameColumn` mutation

**Files:**

- Modify: `src/lib/boards/use-board-mutations.ts`

- [ ] **Step 1: Add the action import**

In the `@/lib/boards/actions` import block add `resizeNameColumn`.

- [ ] **Step 2: Add the mutation + expose it**

Add a `ResizeNameColumnVars` type and mutation mirroring `renameBoardMutation`:

```ts
type ResizeNameColumnVars = { width: number | null };
```

```ts
const resizeNameColumnMutation = useMutation<
  unknown,
  Error,
  ResizeNameColumnVars,
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await resizeNameColumn({ boardId, width: vars.width });
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<BoardCache>(key);
    if (previous) {
      qc.setQueryData<BoardCache>(
        key,
        replaceBoard(previous, {
          ...previous.board,
          name_column_width: vars.width,
        }),
      );
    }
    return { previous };
  },
  onError: (_err, _vars, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});
```

In the returned object (near `renameBoard`):

```ts
resizeNameColumn: (width: number | null) =>
  resizeNameColumnMutation.mutate({ width }),
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors). `board.name_column_width` resolves via regenerated types.

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/use-board-mutations.ts
git commit -m "feat(boards): resizeNameColumn optimistic mutation"
```

---

### Task 6: BoardTable — auto-fit + draggable Name header

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`

- [ ] **Step 1: Replace the constant with a param in `gridTemplate`**

Delete `const NAME_COL_WIDTH = 280;`. Change the signature:

```ts
function gridTemplate(
  columns: { id: string; width: number | null }[],
  liveWidths: Record<string, number>,
  nameWidth: number,
): string {
  const tracks = columns
    .map((c) => `${liveWidths[c.id] ?? c.width ?? VALUE_COL_WIDTH}px`)
    .join(" ");
  return `${nameWidth}px ${tracks} ${ADD_COL_WIDTH}px`;
}
```

- [ ] **Step 2: Compute the effective name width in `BoardTable`**

Add imports:

```ts
import {
  fitNameColumnWidth,
  NAME_COL_MAX,
} from "@/lib/boards/name-column-width";
```

(`resizeNameColumn` is called via `mutations`, not imported here.) After `itemsByGroup`:

```ts
// Offscreen canvas measurer at the Name cell font (Geist 14px / text-sm).
const measureName = useMemo(() => {
  const canvas =
    typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = canvas?.getContext("2d") ?? null;
  if (ctx) ctx.font = "14px ui-sans-serif, system-ui, sans-serif";
  return (text: string) => ctx?.measureText(text).width ?? 0;
}, []);

const autoFitWidth = useMemo(
  () =>
    fitNameColumnWidth(
      items.map((it) => it.name),
      measureName,
    ),
  [items, measureName],
);

const [liveNameWidth, setLiveNameWidth] = useState<number | null>(null);
const nameWidth = liveNameWidth ?? board.name_column_width ?? autoFitWidth;
```

Update the `template` memo + deps:

```ts
const template = useMemo(
  () => gridTemplate(columns, liveWidths, nameWidth),
  [columns, liveWidths, nameWidth],
);
```

- [ ] **Step 3: Replace the static "Name" header cell with `NameColumnHeader`**

Swap the `<div … >Name</div>` (the sticky header label) for:

```tsx
<NameColumnHeader
  width={nameWidth}
  onResize={(w) => setLiveNameWidth(w)}
  onResizeEnd={(w) => {
    setLiveNameWidth(null);
    mutations.resizeNameColumn(w);
  }}
  onAutoFit={() => {
    setLiveNameWidth(null);
    mutations.resizeNameColumn(null);
  }}
/>
```

- [ ] **Step 4: Implement `NameColumnHeader`**

Add this component (reuses the `ColumnHeader` handle pattern; sticky-left; label not editable):

```tsx
const NAME_DRAG_MIN = 80; // manual drag floor (matches ColumnHeader MIN)

function NameColumnHeader({
  width,
  onResize,
  onResizeEnd,
  onAutoFit,
}: {
  width: number;
  onResize: (w: number) => void;
  onResizeEnd: (w: number) => void;
  onAutoFit: () => void;
}) {
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = width;
    const move = (ev: PointerEvent) => {
      last = Math.min(
        NAME_COL_MAX,
        Math.max(NAME_DRAG_MIN, startW + (ev.clientX - startX)),
      );
      onResize(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onResizeEnd(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="bg-surface-muted sticky left-0 z-10 flex items-center truncate px-4 py-1.5">
      Name
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Name column (double-click to auto-fit)"
        onPointerDown={onPointerDown}
        onDoubleClick={onAutoFit}
        className="hover:bg-primary/40 absolute top-0 right-0 h-full w-1 cursor-col-resize"
      />
    </div>
  );
}
```

- [ ] **Step 5: Fix `AddItemRow` width**

`AddItemRow` is rendered inside `GroupSection`; thread `nameWidth` to it. In `GroupSection` props add `nameWidth: number;`, pass it from `BoardTable` (`<GroupSection … nameWidth={nameWidth} />`), and forward to `<AddItemRow groupId={group.id} controls={controls} nameWidth={nameWidth} />`. In `AddItemRow` add `nameWidth: number;` to props and change `style={{ width: NAME_COL_WIDTH }}` to `style={{ width: nameWidth }}`.

- [ ] **Step 6: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, 0 errors (0 warnings).

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/BoardTable.tsx
git commit -m "feat(boards): auto-fit + draggable Name column header"
```

---

### Task 7: Full verification gate

- [ ] **Step 1: Run the gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green; tests include the new `board-actions`, `name-column-actions`, `name-column-width` suites.

- [ ] **Step 2: Manual smoke (optional, /run)**

Open a board: the Name column fits the longest item name; drag its right edge to resize; double-click the edge to re-fit; reload to confirm the manual width persisted.

- [ ] **Step 3: Final commit (if any cleanup)**

```bash
git commit -am "test(boards): name column resize verification" --allow-empty
```
