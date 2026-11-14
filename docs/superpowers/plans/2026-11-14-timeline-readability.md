# Timeline Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both timelines open on today with readable names: the board timeline keeps its groups as collapsible bands with a summary bar, the folder timeline opens as one row per board and drills down, late work is marked on the bar, and the folder stage filter stops eating 200px.

**Architecture:** Everything is client-side re-derivation over data that is already loaded. `GanttCanvas` (shared by the board and the folder timeline) gains a resizable name rail, a scroll-to-today handle, weekend shading, labels beside short bars, late styling and summary bars on section bands. Two pure builders feed it: `groupTimelineRows` (board: one band per group) and `buildFolderTimeline` (folder: board bands, then group bands, then items, closed by default). "Late" on the board comes from the same primitives Board Intelligence uses; on the folder it comes from the rollup rows the Command Center already holds.

**Tech Stack:** Next.js 16 App Router (client components only in this plan), React 19.2, TanStack Query + react-virtual, dnd-kit, Zod, Tailwind v4 semantic tokens, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-14-timeline-readability-design.md`

## Global Constraints

- Work only in the worktree `/Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability` on branch `task/timeline-readability`. `cd` to that absolute path in every Bash call.
- **Implementers never run `git add`, `git commit`, `git stash`, `git push`, `git merge`, `git rebase` or `scripts/finish-task.sh`.** The orchestrator commits each task by path and merges. Every task ends with a "Hand back" step, not a commit.
- Run every command in the foreground with a 600000 ms timeout. Never background `pnpm` or `vitest`.
- Tasks in the same parallel batch each get their own worktree cut from `task/timeline-readability` (a shared folder gets clobbered by lint-staged). The orchestrator rebases and fast-forwards them one at a time.
- **No database migration, no change to the `folder_timeline` RPC, no change to `src/types/database.types.ts`.** `board_views.config` is `jsonb not null default '{}'` with no check constraint (`supabase/migrations/20260615155909_board_views.sql:13`), so `label_width` needs only the Zod change in Task 5. If a task seems to need a schema change, stop and report.
- Semantic tokens only. No raw Tailwind colours, no new box-shadows (that includes `ring-*`, which is a box-shadow), no arbitrary `text-[Npx]`. Late styling uses the `destructive` token. Hairlines brighten on hover, they never thicken.
- Row heights are uniform for every row kind. Dependency arrows and the rows-area height both compute from `index * ROW_H`, so a section band, an item row and a sub-item row must all be exactly `ROW_H` tall.
- Coarse pointers keep their existing `pointer-coarse:` classes on every rail and bar control. Do not remove or shrink one.
- User-facing copy never says "Pulse". The product is Monolith.
- `src/components/folders/CommandCenter.tsx` must not statically import `GanttCanvas`, `TimelineInner` or `@dnd-kit/*` (`src/components/folders/no-gantt-in-first-paint.test.ts`). It may import types from `@/lib/folders/types`.
- Reuse the canonical modules named in each task. Before writing any other helper, grep for an existing one.
- Each task must leave `pnpm typecheck`, `pnpm lint` and its touched test files green on its own. `pnpm test` and `pnpm build` run in Task 12.
- This is Next.js 16. This plan touches no Next API; if a task finds it must, read the matching guide in `node_modules/next/dist/docs/` first.

## Open items from the spec, resolved against the code

**(a) Is "late" the same rule on the board and in the folder rollup?** Almost, with three differences that are recorded here and reported to the owner.

- Board Intelligence chip: `overdueSignals` in `src/lib/boards/intelligence/signals.ts:115-127`. An item is overdue when it is open and **any date-kind column** on the board holds a cell whose `end ?? date` is strictly before the viewer's local today (`isOverdue` + `localTodayISO` in `src/lib/boards/overdue.ts`). "Open" means not done; done means the item's cell in the board's **first status column by position** holds an option whose label matches `/done|complete/i` (`firstStatusColumn` + `isStatusValueComplete`, wired in `buildContext`, `signals.ts:79-96`). It counts every item in the cache, sub-items included.
- Folder rollup: `_board_health_flags` (latest definition in `supabase/migrations/20260727094245_digest_period_scoped_and_blocked_runs.sql`), read by `_folder_item_flags` and summed by `folder_rollup` (`supabase/migrations/20260915142403_folder_planned_on_and_rpc_review_fixes.sql`). `is_done` is the same label regex (`~* '(done|complete)'`) on the first status column by position. `is_overdue` is `has_past_due and not is_done`, where `has_past_due` is any date-kind column with `coalesce(value->>'end', value->>'date') < current_date::text`.
- Same: the done rule, "any date column", `end ?? date`, strict less-than.
- Different: (1) the rollup compares against the database's `current_date`, the chip against the viewer's local date, so they can disagree for a few hours around midnight; (2) the rollup counts **top-level items only** (`i.parent_id is null`), the chip counts sub-items too; (3) the rollup's `total` and `done` cover every top-level item in the group, dated or not.
- Decision: the board timeline (`lateFor` and the group summary) uses the Board Intelligence primitives through a new `buildTimelineLate` (Task 2), with a test that its late set equals the chip's item ids. The folder timeline keeps the rollup's numbers, because `folder_timeline` returns no status and changing that needs a migration. The spec's fallback ("use the Board Intelligence rule in both places") is therefore **not possible for the folder without a migration**; see "Where the spec was wrong" below.
- Consequence to know about: because the rule looks at any date column, a bar can be marked late while its own end date is in the future (another date column on the item is past due). The "Nd late" number is days since the item's earliest past-due date, which matches the SQL's `overdue_since`.

**(b) Are the rollup rows available and how are they keyed?** Yes. `CommandCenter.tsx:79-87` holds `rollup` and the stage/board-filtered `rows`. A `RollupRow` (`src/lib/folders/types.ts:45-68`) has `boardId` and `groupId` (a real group uuid; `string | null` in the type, never null from `folder_rollup` because it inner-joins `groups`). The folder timeline's items carry `board_id` and `group_id`, so the join key is `${boardId}:${groupId}`. Stage keys (normalised group names) are not involved. A board band sums every rollup row passed for that board, which are already stage-filtered by `CommandCenter`. `payload.rollup` is `null` when the RPC failed; `CommandCenter` turns that into `[]`, and every band then gets `null` progress.

**(c) `updateBoardView` validation.** `updateBoardViewSchema` accepts any `config` record; the real gate is `configSchemaForKind(view.kind)` inside `updateBoardViewCore` (`src/lib/boards/core/view.ts:82-88`), which for a timeline is `timelineConfigSchema` (`src/lib/validations/view-actions.ts:41-48`), a `.strict()` object. `label_width` is rejected today. Task 5 adds `label_width: z.number().int().min(160).max(520).optional()`. The MCP `manage_view` tool (`src/lib/mcp/tools/manage-view.ts`) takes `config: z.record(z.string(), z.unknown())` and calls the same `updateBoardViewCore`, so it shares the schema and needs no change; only the human-readable `VIEW_TYPE_SCHEMA.timeline` string in `src/lib/mcp/tools/describe-schema.ts:121-125` is updated. `updateBoardViewCore` **replaces** `config` with the parsed object, so `GanttBoard.persistConfig` must always send `label_width` along with the other keys (Task 11 does). No migration.

**(d) Groups and `collapsedGroups` in `GanttBoard`.** `cache.groups` (`useBoardCache`, `CacheGroup = Tables<"groups">` with `id`, `name`, `position`, `color`) is already in scope; `GanttBoard.tsx:360` maps it for the header. `useBoardViewPrefs()` (`src/lib/boards/view-prefs-context.tsx:105`) returns `collapsedGroups: Set<string>` and `toggleGroupCollapsed(groupId)`. `GanttBoard` is rendered inside `BoardViewPrefsProvider` (`src/components/boards/BoardViews.tsx:286`), the same provider the table reads, so collapse is shared and persisted (debounced, write-only). Outside a provider (tests) the hook falls back to working local state.

## Where the spec was wrong or needs a decision

1. **"The N late links counter is computed from totals that do not depend on collapse" is false.** `TimelineInner.tsx:172-177` derives it from `view.violations` and `view.externalLinks`, and both are built from `boardOfItem`, which only holds rows that are in view (`src/lib/folders/timeline.ts:181-196`). With every board closed by default the counter would read 0. Task 6 adds `totals.lateLinks`, computed over every charted item regardless of collapse.
2. **The folder cannot use the Board Intelligence rule** (see (a)). Folder band numbers come from the rollup: top-level items only, database date, and `donePct` is over all items in the group. The board's group band is over the rows on the timeline (sub-items included). The same group can therefore show slightly different numbers on the two timelines. This needs the owner's acceptance or a later migration.
3. **`buildGanttRows` is not changed.** The spec says it "takes the board's groups". It is also called once per group by `buildFolderTimeline` and has a 7-argument positional signature, so grouping is a new pure function, `groupTimelineRows`, applied to its output. Behaviour is what the spec describes.
4. **`LABEL_W` is 200 today, not a 300 constant.** It is renamed `DEFAULT_LABEL_W` (300) so that a stale `LABEL_W` use fails typecheck.
5. **No existing test asserts `ROW_H`, `BAR_H` or `LABEL_W`.** There is no test named "touch targets are at least 44px"; the coarse-pointer tests in `GanttBoard.test.tsx:671-711` assert class tokens (`pointer-coarse:size-11`, `pointer-coarse:w-11`, `pointer-coarse:min-h-11`). They keep passing because the classes are untouched. Real geometry: a 44px control is flex-centred in a 32px row and overflows it by 6px above and below (it was 2px at 40px rows). The next row's opaque rail paints over the lower overflow, so the effective vertical hit area is about 38px. Task 12 measures this in a browser under `pointer: coarse`; if it is under 44px the fix is a pointer-aware row height (`useCoarsePointer` exists in `src/lib/hooks/use-coarse-pointer.ts`), which is a spec change for the owner to approve, not something an implementer does on their own.
6. **Outside labels and link stubs compete for the same space.** A cross-board stub sits at `barEndX + 4`. The plan gives stubs priority: the date or "Nd late" label goes after the bar, else before it, else it is not drawn (the destructive border still marks a late bar).
7. **Milestones.** A diamond has no inside label, so by the spec's rule it always gets the date beside it. On a board with hundreds of single-date items that is a date on every row. Kept as specified; flagged for the browser pass.
8. **Range cap.** `timelineDayCount` caps at 3,660 days from the range start. A board whose earliest date is more than ten years ago will not have today on the grid; the canvas then simply does not scroll.
9. **Rail width for viewers.** `updateBoardView` fails under RLS for a viewer. The board timeline lets a viewer resize for the session and skips the write.

## File Structure

| File                                                           | Responsibility                                                   | Tasks      |
| -------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- |
| `src/components/boards/gantt/utils.ts`                         | Geometry constants and pure layout helpers                       | 1, 4, 7    |
| `src/components/boards/gantt/GanttCanvas.tsx`                  | Shared canvas: rail, scroll, bands, rows, arrows                 | 1, 4, 7, 9 |
| `src/components/boards/gantt/GanttRowItem.tsx`                 | One item row: rail cell, track, bar, labels                      | 1, 4, 7    |
| `src/components/boards/table/NameResizeHandle.tsx`             | Drag handle, generalised with `min` / `max` / `label`            | 1          |
| `src/lib/boards/gantt.ts`                                      | `GanttRow.summary`, `rangeIncludingToday`, `groupTimelineRows`   | 2          |
| `src/lib/boards/overdue.ts`                                    | `dueISO` extracted from `isOverdue`                              | 2          |
| `src/lib/boards/timeline-late.ts` (new)                        | `buildTimelineLate`: late days and done, Board Intelligence rule | 2          |
| `src/components/folders/FilterBar.tsx`                         | Stage chips up to 8, searchable menu above                       | 3          |
| `src/lib/validations/view-actions.ts`                          | `label_width` in the timeline view config                        | 5          |
| `src/lib/mcp/tools/describe-schema.ts`                         | Timeline config description string                               | 5          |
| `src/lib/folders/timeline.ts`                                  | Roll-up-first builder, summaries, rollup join, late-link total   | 6          |
| `src/components/folders/tabs/TimelineInner.tsx`                | Folder timeline state, toolbar, rail width in `localStorage`     | 6, 8       |
| `src/components/folders/CommandCenter.tsx`                     | Passes the filtered rollup rows to the lazy tab                  | 6          |
| `src/lib/text-measure.ts` (new)                                | Canvas text measurer shared with the table's Name auto-fit       | 7          |
| `src/components/boards/table/shared.ts`, `BoardTableInner.tsx` | Switch to the shared measurer                                    | 7          |
| `src/components/boards/GanttBoard.tsx`                         | Grouped rows, shared collapse, late, range, Today, rail width    | 10, 11     |

## Execution DAG

**Dependency graph** (edges come from the `Interfaces` blocks and from files two tasks both edit):

- Task 1 (canvas rail and row height): none.
- Task 2 (pure libs): none.
- Task 3 (stage menu): none.
- Task 4 (canvas today and weekends): Task 1 (same files: `GanttCanvas.tsx`, `GanttRowItem.tsx`, `utils.ts`, `GanttCanvas.test.tsx`).
- Task 5 (`label_width` validation): Task 1 (imports `LABEL_W_MIN` / `LABEL_W_MAX`).
- Task 6 (folder roll-up): Task 2 (`GanttRow.summary`, `rangeIncludingToday`, `spanOfRows`).
- Task 7 (canvas labels and late): Task 4 (same files).
- Task 8 (folder toolbar): Task 6 (same files: `TimelineInner.tsx`, `Timeline.test.tsx`), Task 1 (`labelWidth` props), Task 4 (`handleRef`).
- Task 9 (canvas summaries and group toggle): Task 7 (same file), Task 2 (`GanttRow.summary`).
- Task 10 (board grouping): Task 9 (group bands toggle in the real canvas), Task 7 (`lateFor`), Task 2.
- Task 11 (board Today and rail width): Task 10 (same files), Task 5, Task 4, Task 1.
- Task 12 (browser pass, review, build): everything.

**Parallel batches** (no two tasks in a batch edit the same file):

| Batch | Tasks   | Files in play                                                                                                    |
| ----- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| 1     | 1, 2, 3 | gantt canvas files · `lib/boards/{gantt,overdue,timeline-late}` · `FilterBar` + `CommandCenter.test`             |
| 2     | 4, 5, 6 | gantt canvas files · validations + describe-schema · folder timeline lib + `TimelineInner` + `CommandCenter.tsx` |
| 3     | 7, 8    | gantt canvas files + text measurer + table measurer · `TimelineInner` + `Timeline.test`                          |
| 4     | 9       | `GanttCanvas.tsx`                                                                                                |
| 5     | 10      | `GanttBoard.tsx` + its two test files                                                                            |
| 6     | 11      | `GanttBoard.tsx` + `GanttBoard.test.tsx`                                                                         |
| 7     | 12      | orchestrator only                                                                                                |

Task 3 edits `CommandCenter.test.tsx` and Task 6 edits `CommandCenter.tsx`; they are in different batches. Tasks 1, 4, 7 and 9 all edit `GanttCanvas.tsx` and `GanttCanvas.test.tsx` and are strictly sequential, as are Tasks 10 and 11 on `GanttBoard.tsx`, and Tasks 6 and 8 on `TimelineInner.tsx`.

Between Task 6 and Task 9 the folder's group bands exist but the real canvas cannot toggle them yet (the canvas learns that in Task 9). That is an intermediate state on the task branch only; tests are green throughout because the folder tab's tests drive a probe canvas.

**Critical path:** 1 → 4 → 7 → 9 → 10 → 11 → 12 (seven steps). Dispatch batches with `superpowers:dispatching-parallel-agents`, all agents of a batch in one message.

## Performance & data-fetching budget

- **First paint:** unchanged. The board timeline renders from the board cache already in memory. The folder timeline makes its one `getFolderTimeline` call when the tab first mounts; the rollup rows it joins are already in the Command Center's payload.
- **Interactions with 0 server round-trips:** the open-on-today scroll, the Today button, zoom, expand or collapse of a board band, a group band or a parent item, rail resize while dragging, the stage chips and the stage menu (URL state through `history.replaceState`, unchanged).
- **Interactions that write:** the board rail width writes once on drag end through `updateBoardView` (a Server Action, no revalidation, no refetch); a viewer writes nothing. The folder rail width writes to `localStorage`. Collapsing a board group goes through the existing debounced view-prefs write. Bar move and resize are unchanged.
- **Bounded reads:** no new reads. The folder RPC keeps its 5,000-item cap. Rows stay virtualized. Roll-up-first drops the mounted row count on open from thousands to the number of boards.
- **Client cost added:** `buildFolderTimeline` runs one extra pass for the late-link total (two calls that are linear in dependencies). `buildTimelineLate` is one pass over items × date columns, memoized on the cache. Label measuring is one `measureText` per mounted (virtualized) row.

---

### Task 1: Canvas — 32px rows, resizable name rail, rail tooltips

**Files:**

- Modify: `src/components/boards/gantt/utils.ts:7-9`
- Modify: `src/components/boards/table/NameResizeHandle.tsx:20-68`
- Modify: `src/components/boards/gantt/GanttCanvas.tsx` (imports 20-33, props 40-76, state 128-177, rail header 260-265, row render 309-340, arrow overlay 347-365, `SectionBand` 418-489)
- Modify: `src/components/boards/gantt/GanttRowItem.tsx` (imports 32-41, props 47-105, rail cell 301-306, name span 348-350)
- Test: `src/components/boards/gantt/utils.test.ts`, `src/components/boards/gantt/GanttCanvas.test.tsx`

**Interfaces:**

- Consumes: `clampDragWidth`, `NAME_COL_MAX` from `@/lib/boards/name-column-width`; `useRafThrottle` (already used by the handle).
- Produces:
  - `export const DEFAULT_LABEL_W = 300; export const LABEL_W_MIN = 160; export const LABEL_W_MAX = 520; export const ROW_H = 32; export const BAR_H = 20;` in `gantt/utils.ts`. `LABEL_W` no longer exists.
  - `NameResizeHandle` props gain `min?: number` (default 80), `max?: number` (default `NAME_COL_MAX`), `label?: string` (default `"Resize Name column (double-click to auto-fit)"`).
  - `GanttCanvasProps` gains `labelWidth?: number` (default 300) and `onLabelWidthChange?: (width: number) => void` (called once on drag end with an integer in 160..520, and with 300 on double-click; the handle is rendered only when it is given).
  - `GanttRowItem` gains a required prop `labelW: number`.
  - DOM hooks for tests: `data-testid="gantt-rail-header"` on the rail header cell.

**Existing tests that change:** none. Verified by grep: no test under `src/` or `e2e/` asserts `ROW_H`, `BAR_H`, `LABEL_W`, `40px`, `24px` or a 200px rail. The coarse-pointer tests in `GanttBoard.test.tsx:671-711` assert class tokens that this task does not touch.

**Why 44px targets survive 32px rows:** every rail and bar control keeps its `pointer-coarse:` class (`size-11` on the ⋯ trigger, `w-11` + `touch-none` on the resize strip, `h-11` on the band toggle, `size-8` on the sub-item chevron). The row has a fixed `height: ROW_H` and its children are flex-centred, so a 44px control overflows the row vertically instead of growing it. Row height stays uniform and arrow maths stays right. The real hit geometry is measured in Task 12.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/boards/gantt/utils.test.ts` (and add the five names to the existing import from `@/components/boards/gantt/utils`):

```ts
describe("row geometry constants", () => {
  it("uses compact rows and a 300px default rail clamped to 160–520", () => {
    expect(ROW_H).toBe(32);
    expect(BAR_H).toBe(20);
    expect(DEFAULT_LABEL_W).toBe(300);
    expect([LABEL_W_MIN, LABEL_W_MAX]).toEqual([160, 520]);
  });
});
```

In `src/components/boards/gantt/GanttCanvas.test.tsx` change the Testing Library import on line 2 to

```ts
import { fireEvent, render, screen, within } from "@testing-library/react";
```

and append this block at the end of the file. It reuses the file's existing `rows` fixture and `props()` helper:

```tsx
describe("GanttCanvas name rail", () => {
  it("draws every row kind at the same 32px height", () => {
    render(<GanttCanvas {...props()} />);
    expect(screen.getByTestId("gantt-section")).toHaveStyle({ height: "32px" });
    for (const row of screen.getAllByTestId("gantt-row")) {
      expect(row).toHaveStyle({ height: "32px" });
    }
  });

  it("defaults the rail to 300px and follows labelWidth", () => {
    const { rerender } = render(<GanttCanvas {...props()} />);
    expect(screen.getByTestId("gantt-rail-header")).toHaveStyle({
      width: "300px",
    });
    rerender(<GanttCanvas {...props({ labelWidth: 220 })} />);
    expect(screen.getByTestId("gantt-rail-header")).toHaveStyle({
      width: "220px",
    });
    // A band spans the rail plus the 300px track (30 days × 10px, unmeasured).
    expect(screen.getByTestId("gantt-section")).toHaveStyle({ width: "520px" });
  });

  it("shows no resize handle unless onLabelWidthChange is given", () => {
    render(<GanttCanvas {...props()} />);
    expect(
      screen.queryByRole("separator", { name: /Resize name rail/ }),
    ).not.toBeInTheDocument();
  });

  it("reports one clamped width on drag end and none while dragging", () => {
    const onLabelWidthChange = vi.fn();
    render(<GanttCanvas {...props({ labelWidth: 300, onLabelWidthChange })} />);
    const handle = screen.getByRole("separator", { name: /Resize name rail/ });
    fireEvent.pointerDown(handle, { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 600 });
    fireEvent.pointerMove(window, { clientX: 900 });
    expect(onLabelWidthChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    expect(onLabelWidthChange).toHaveBeenCalledTimes(1);
    expect(onLabelWidthChange).toHaveBeenCalledWith(520);
  });

  it("clamps a drag to the left at 160px", () => {
    const onLabelWidthChange = vi.fn();
    render(<GanttCanvas {...props({ labelWidth: 300, onLabelWidthChange })} />);
    const handle = screen.getByRole("separator", { name: /Resize name rail/ });
    fireEvent.pointerDown(handle, { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 0 });
    fireEvent.pointerUp(window);
    expect(onLabelWidthChange).toHaveBeenCalledWith(160);
  });

  it("resets the rail to 300px on double-click", () => {
    const onLabelWidthChange = vi.fn();
    render(<GanttCanvas {...props({ labelWidth: 420, onLabelWidthChange })} />);
    fireEvent.doubleClick(
      screen.getByRole("separator", { name: /Resize name rail/ }),
    );
    expect(onLabelWidthChange).toHaveBeenCalledWith(300);
  });

  it("gives rail names a title with the full name", () => {
    render(<GanttCanvas {...props()} />);
    expect(
      screen.getByRole("heading", { level: 3, name: "Procurement" }),
    ).toHaveAttribute("title", "Procurement");
    const first = screen.getAllByTestId("gantt-row")[0]!;
    expect(within(first).getByTitle("PO raised")).toBeInTheDocument();
  });
});
```

Notes on what these can and cannot prove: `NameResizeHandle` listens for `pointermove` / `pointerup` on `window`, and jsdom's `PointerEvent` carries `clientX` to a window listener (checked). jsdom renders no layout, so these assert inline styles and callbacks only; the handle's on-screen position is verified in a browser by the orchestrator (Task 12).

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/boards/gantt/utils.test.ts src/components/boards/gantt/GanttCanvas.test.tsx`

Expected: FAIL. `row geometry constants` fails with `expected 40 to be 32`. In `GanttCanvas name rail`: the height test fails on `height: 40px`, the rail tests fail with `Unable to find an element by: [data-testid="gantt-rail-header"]`, the handle tests fail with `Unable to find an accessible element with the role "separator"`, the title test fails on a missing `title` attribute. The older suites in the file still pass.

- [ ] **Step 3: Change the constants**

In `src/components/boards/gantt/utils.ts` replace lines 7-9

```ts
export const LABEL_W = 200; // px for the left name rail
export const ROW_H = 40; // px per row
export const BAR_H = 24; // px bar height
```

with

```ts
// The left name rail is resizable: this is the width it opens at and the
// width a double-click on its handle restores. Renamed from LABEL_W so a
// stale use of the old constant fails typecheck.
export const DEFAULT_LABEL_W = 300;
export const LABEL_W_MIN = 160;
export const LABEL_W_MAX = 520;
// One height for EVERY row kind (item, sub-item, section band): the arrow
// overlay and the rows-area height both compute from index * ROW_H.
export const ROW_H = 32;
export const BAR_H = 20; // px bar height
```

- [ ] **Step 4: Generalise the resize handle**

In `src/components/boards/table/NameResizeHandle.tsx` the function currently starts (lines 20-30)

```tsx
export function NameResizeHandle({
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
```

Replace that with

```tsx
export function NameResizeHandle({
  width,
  onResize,
  onResizeEnd,
  onAutoFit,
  min = NAME_DRAG_MIN,
  max = NAME_COL_MAX,
  label = "Resize Name column (double-click to auto-fit)",
}: {
  width: number;
  onResize: (w: number) => void;
  onResizeEnd: (w: number) => void;
  onAutoFit: () => void;
  /** Drag clamp. Defaults are the table Name column's bounds. */
  min?: number;
  max?: number;
  /** Accessible name. The default is the table Name column's. */
  label?: string;
}) {
```

Inside `move` (lines 41-45) replace `NAME_DRAG_MIN,` with `min,` and `NAME_COL_MAX,` with `max,`. On the returned `<div>` replace `aria-label="Resize Name column (double-click to auto-fit)"` with `aria-label={label}`. Nothing else in the file changes, so the table's two call sites (`GroupHeaderRow.tsx:214`) and `BoardTable.test.tsx:1590` behave exactly as before.

- [ ] **Step 5: Thread the rail width through `GanttRowItem`**

In `src/components/boards/gantt/GanttRowItem.tsx`:

1. In the import from `@/components/boards/gantt/utils` (lines 32-41) delete the `LABEL_W,` line.
2. In the destructured props add `labelW,` after `totalW,` and in the props type add, after `totalW: number;`:

```tsx
/** Width of the sticky name rail in px (resizable; owned by the canvas). */
labelW: number;
```

3. Line 306 is `style={{ width: LABEL_W, paddingLeft: 16 + depth * 16 }}`. Change it to `style={{ width: labelW, paddingLeft: 16 + depth * 16 }}`.
4. Lines 348-350 are

```tsx
<span className="text-foreground min-w-0 flex-1 truncate text-xs">
  {row.name}
</span>
```

Change them to

```tsx
<span
  title={row.name}
  className="text-foreground min-w-0 flex-1 truncate text-xs"
>
  {row.name}
</span>
```

- [ ] **Step 6: Make the rail a prop in `GanttCanvas`**

In `src/components/boards/gantt/GanttCanvas.tsx`:

1. In the utils import (lines 20-31) replace `LABEL_W,` with

```tsx
  DEFAULT_LABEL_W,
  LABEL_W_MAX,
  LABEL_W_MIN,
```

and add below the `GanttRowItem` import:

```tsx
import { NameResizeHandle } from "@/components/boards/table/NameResizeHandle";
```

2. In `GanttCanvasProps`, after the `footer?: ReactNode;` member add

```tsx
  /** Width of the name rail in px. Defaults to DEFAULT_LABEL_W (300). */
  labelWidth?: number;
  /** Given → the rail header shows a drag handle. Called ONCE on drag end with
   * an integer clamped to LABEL_W_MIN..LABEL_W_MAX, and with DEFAULT_LABEL_W on
   * double-click. Never called while dragging. */
  onLabelWidthChange?: (width: number) => void;
```

and add `labelWidth,` and `onLabelWidthChange,` to the destructured parameters after `footer,`.

3. Directly above `const [trackWidth, setTrackWidth] = useState(0);` (line 128) add

```tsx
// Live width while the rail handle is dragged (local state only — the parent
// hears about it once, on release).
const [liveLabelW, setLiveLabelW] = useState<number | null>(null);
const labelW = liveLabelW ?? labelWidth ?? DEFAULT_LABEL_W;
```

4. Line 161 `const width = scroller.clientWidth - LABEL_W;` becomes `const width = scroller.clientWidth - labelW;`.
5. In the `ResizeObserver` effect (lines 168-177) change `scroller.clientWidth - LABEL_W` to `scroller.clientWidth - labelW` and the dependency array `[]` to `[labelW]`.
6. The rail header (lines 260-265) is

```tsx
<div
  className="bg-background hover:border-border-hover sticky left-0 z-10 flex shrink-0 items-center border-r px-4 py-2.5"
  style={{ width: LABEL_W }}
>
  <Kicker>Item</Kicker>
</div>
```

Replace it with

```tsx
<div
  data-testid="gantt-rail-header"
  className="bg-background hover:border-border-hover sticky left-0 z-10 flex shrink-0 items-center border-r px-4 py-2.5"
  style={{ width: labelW }}
>
  <Kicker>Item</Kicker>
  {onLabelWidthChange && (
    <NameResizeHandle
      width={labelW}
      min={LABEL_W_MIN}
      max={LABEL_W_MAX}
      label="Resize name rail (double-click to reset)"
      onResize={setLiveLabelW}
      onResizeEnd={(w) => {
        setLiveLabelW(null);
        onLabelWidthChange(w);
      }}
      onAutoFit={() => {
        setLiveLabelW(null);
        onLabelWidthChange(DEFAULT_LABEL_W);
      }}
    />
  )}
</div>
```

(The header cell is `sticky`, which is a positioned box, so the handle's `absolute top-0 right-0` anchors to it.)

7. In the row render (lines 309-340) add `labelW={labelW}` to `<SectionBand … />` after `totalW={totalW}` and to `<GanttRowItem … />` after `totalW={totalW}`.
8. In the arrow overlay replace the three remaining `LABEL_W` uses: `width: LABEL_W + totalW,` (line 350) → `width: labelW + totalW,`; `LABEL_W +` at the start of `predEndX` (line 359) → `labelW +`; `LABEL_W + (succRow.startCol ?? 0) * dayW` (line 364) → `labelW + (succRow.startCol ?? 0) * dayW`.
9. Replace the whole `SectionBand` function (lines 418-489) with

```tsx
function SectionBand({
  row,
  totalW,
  labelW,
  expanded,
  onToggle,
}: {
  row: GanttRow;
  totalW: number;
  labelW: number;
  expanded: boolean;
  onToggle?: (itemId: string) => void;
}) {
  const isBoard = (row.level ?? 0) === 0;
  const label = (
    <span
      role="heading"
      aria-level={isBoard ? 3 : 4}
      title={row.name}
      className={cn(
        "min-w-0 truncate text-xs",
        isBoard
          ? "text-foreground font-semibold"
          : "text-muted-foreground font-medium",
      )}
    >
      {row.name}
    </span>
  );
  return (
    <div
      data-testid="gantt-section"
      className={cn(
        "flex border-b",
        isBoard ? "bg-surface-muted" : "bg-surface",
      )}
      style={{ height: ROW_H, width: labelW + totalW }}
    >
      <div
        className={cn(
          "sticky left-0 z-10 flex min-w-0 items-center pr-2",
          isBoard ? "bg-surface-muted" : "bg-surface",
        )}
        style={{
          width: labelW,
          paddingLeft: isBoard && onToggle ? 8 : isBoard ? 16 : 32,
        }}
      >
        {isBoard && onToggle ? (
          <button
            type="button"
            onClick={() => onToggle(row.itemId)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${row.name}`}
            className="hover:bg-state-hover focus-visible:ring-ring flex h-7 min-w-0 flex-1 items-center gap-1 rounded-sm px-1 text-left focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-11"
          >
            {expanded ? (
              <ChevronDown
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            ) : (
              <ChevronRight
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            )}
            {label}
          </button>
        ) : (
          label
        )}
      </div>
    </div>
  );
}
```

(Only three things differ from today's function: the `labelW` prop replaces the constant twice, and the label gets `title`.)

- [ ] **Step 7: Run the tests and see them pass**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/boards/gantt src/components/boards/GanttBoard.test.tsx src/components/boards/GanttBoard.intel.test.tsx src/components/boards/BoardTable.test.tsx src/components/folders/tabs/Timeline.test.tsx`

Expected: PASS, every file. `BoardTable.test.tsx` proves the generalised handle did not change the table.

- [ ] **Step 8: Typecheck and lint**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint`

Expected: both exit 0. A leftover `LABEL_W` anywhere shows up here as `Cannot find name 'LABEL_W'`.

- [ ] **Step 9: Hand back**

Report to the orchestrator: the files changed, the tail of each command's output, and any deviation from this task. Do not stage, commit or stash.

---

### Task 2: Pure libraries — section summary type, range padding, grouped rows, late days

**Files:**

- Modify: `src/lib/boards/gantt.ts` (type at 10-31; new exports after `visibleRows`, line 147)
- Modify: `src/lib/boards/overdue.ts:86-97`
- Create: `src/lib/boards/timeline-late.ts`
- Test: `src/lib/boards/gantt.test.ts`, `src/lib/boards/overdue.test.ts`
- Create test: `src/lib/boards/timeline-late.test.ts`

**Interfaces:**

- Consumes: `addDaysISO`, `diffDaysISO` from `@/lib/boards/calendar`; `cellKey`, `buildCellMap` from `@/lib/boards/cache`; `firstStatusColumn`, `isStatusValueComplete`, `isOverdue` from `@/lib/boards/overdue`; `visibleRows` (same file).
- Produces, in `src/lib/boards/gantt.ts`:

```ts
export type GanttSectionSummary = {
  startCol: number;
  spanCols: number;
  donePct: number | null; // null = unknown, draw the span without a fill
  lateCount: number | null;
};
// GanttRow gains:  summary?: GanttSectionSummary;
export const TODAY_PAD_BEFORE = 14;
export const TODAY_PAD_AFTER = 30;
export function rangeIncludingToday(
  minISO: string | null,
  maxISO: string | null,
  todayISO: string,
): { startISO: string; endISO: string };
export function spanOfRows(
  rows: readonly GanttRow[],
): { startCol: number; spanCols: number } | null;
export const UNGROUPED_GROUP_ID = "__ungrouped__";
export type TimelineGroupRef = { id: string; name: string; position: number };
export function groupTimelineRows(
  rows: readonly GanttRow[],
  groupOfItem: ReadonlyMap<string, string>,
  groups: readonly TimelineGroupRef[],
  opts: {
    collapsedGroups: ReadonlySet<string>;
    expanded: ReadonlySet<string>;
    isDone: (itemId: string) => boolean;
    lateFor: (row: GanttRow) => number | null;
  },
): GanttRow[];
```

- Produces, in `src/lib/boards/overdue.ts`: `export function dueISO(value: unknown): string | null`.
- Produces, in `src/lib/boards/timeline-late.ts`:

```ts
export type TimelineLate = {
  lateDays: Map<string, number>; // itemId → whole days late; late items only
  isDone: (itemId: string) => boolean;
};
export function buildTimelineLate(input: {
  items: readonly { id: string }[];
  columns: readonly CacheColumn[];
  cellMap: ReadonlyMap<string, unknown>;
  todayISO: string;
}): TimelineLate;
```

`buildGanttRows` is not changed (see "Where the spec was wrong", item 3). The logic below was run against the real modules in a scratch script before this plan was written; the expected values in the tests are the observed ones.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/boards/gantt.test.ts` and add `groupTimelineRows`, `rangeIncludingToday`, `spanOfRows` to its import from `@/lib/boards/gantt` (`GanttRow` is already imported as a type):

```ts
describe("rangeIncludingToday", () => {
  it("widens a past-only range forward to today + 30", () => {
    expect(
      rangeIncludingToday("2026-02-01", "2026-03-01", "2026-11-14"),
    ).toEqual({ startISO: "2026-02-01", endISO: "2026-12-14" });
  });
  it("widens a future-only range back to today − 14", () => {
    expect(
      rangeIncludingToday("2027-01-10", "2027-02-01", "2026-11-14"),
    ).toEqual({ startISO: "2026-10-31", endISO: "2027-02-01" });
  });
  it("falls back to the padded today window when nothing is dated", () => {
    expect(rangeIncludingToday(null, null, "2026-11-14")).toEqual({
      startISO: "2026-10-31",
      endISO: "2026-12-14",
    });
  });
  it("leaves a range that already contains the window alone", () => {
    expect(
      rangeIncludingToday("2026-01-01", "2027-06-01", "2026-11-14"),
    ).toEqual({ startISO: "2026-01-01", endISO: "2027-06-01" });
  });
});

describe("groupTimelineRows", () => {
  const row = (
    itemId: string,
    startCol: number,
    spanCols: number,
    over: Partial<GanttRow> = {},
  ): GanttRow => ({
    itemId,
    name: itemId,
    scheduled: true,
    depth: 0,
    parentId: null,
    startCol,
    spanCols,
    ...over,
  });
  // Board order (position across the whole board), as buildGanttRows emits it.
  const rows: GanttRow[] = [
    row("a1", 2, 3),
    row("b1", 0, 4, { hasChildren: true, childCount: 1 }),
    row("b1c", 5, 5, { depth: 1, parentId: "b1" }),
    row("b2", 8, 1),
  ];
  const groupOfItem = new Map([
    ["a1", "g2"],
    ["b1", "g1"],
    ["b1c", "g1"],
    ["b2", "g1"],
  ]);
  const groups = [
    { id: "g2", name: "Build", position: 1 },
    { id: "g1", name: "Discovery", position: 0 },
    { id: "g3", name: "Empty", position: 2 },
  ];
  const base = {
    collapsedGroups: new Set<string>(),
    expanded: new Set<string>(),
    isDone: (id: string) => id === "b2",
    lateFor: (r: GanttRow) => (r.itemId === "b1" ? 4 : null),
  };
  const ids = (out: GanttRow[]) => out.map((r) => r.itemId);

  it("emits a band per group in position order, then that group's rows", () => {
    expect(ids(groupTimelineRows(rows, groupOfItem, groups, base))).toEqual([
      "group:g1",
      "b1",
      "b2",
      "group:g2",
      "a1",
    ]);
  });

  it("skips a group with nothing on the timeline", () => {
    expect(
      ids(groupTimelineRows(rows, groupOfItem, groups, base)),
    ).not.toContain("group:g3");
  });

  it("summarises span, done share and late count over the group's scheduled rows", () => {
    const band = groupTimelineRows(rows, groupOfItem, groups, base)[0]!;
    expect(band).toMatchObject({
      kind: "section",
      level: 1,
      name: "Discovery",
      scheduled: false,
    });
    // b1 0–4, its hidden sub-item b1c 5–10, b2 8–9 → span 0–10; 1 of 3 done.
    expect(band.summary).toEqual({
      startCol: 0,
      spanCols: 10,
      donePct: 33,
      lateCount: 1,
    });
  });

  it("keeps a collapsed group's band and summary but hides its rows", () => {
    const out = groupTimelineRows(rows, groupOfItem, groups, {
      ...base,
      collapsedGroups: new Set(["g1"]),
    });
    expect(ids(out)).toEqual(["group:g1", "group:g2", "a1"]);
    expect(out[0]!.summary?.spanCols).toBe(10);
  });

  it("reveals the sub-items of an expanded parent inside its group", () => {
    expect(
      ids(
        groupTimelineRows(rows, groupOfItem, groups, {
          ...base,
          expanded: new Set(["b1"]),
        }),
      ),
    ).toEqual(["group:g1", "b1", "b1c", "b2", "group:g2", "a1"]);
  });

  it("collects rows whose group is unknown under a trailing band", () => {
    const partial = new Map([
      ["b1", "g1"],
      ["b1c", "g1"],
      ["b2", "g1"],
    ]);
    const out = groupTimelineRows(rows, partial, groups, base);
    expect(ids(out)).toEqual([
      "group:g1",
      "b1",
      "b2",
      "group:__ungrouped__",
      "a1",
    ]);
    expect(out[3]!.name).toBe("Other items");
  });
});

describe("spanOfRows", () => {
  it("is null when no row is scheduled", () => {
    expect(
      spanOfRows([
        { itemId: "p", name: "p", scheduled: false, hasChildren: true },
      ]),
    ).toBeNull();
  });
});
```

Append to `src/lib/boards/overdue.test.ts` and add `dueISO` to its import from `./overdue`:

```ts
describe("dueISO", () => {
  it("reads end ?? date and rejects anything else", () => {
    expect(dueISO({ date: "2026-07-02" })).toBe("2026-07-02");
    expect(dueISO({ date: "2026-06-01", end: "2026-07-04" })).toBe(
      "2026-07-04",
    );
    expect(dueISO({ date: 42 })).toBeNull();
    expect(dueISO(null)).toBeNull();
    expect(dueISO("2026-07-01")).toBeNull();
  });
});
```

Create `src/lib/boards/timeline-late.test.ts`. It builds its own small fixture with `as never` (the pattern `gantt.test.ts` uses); it does not import the helpers exported from `signals.test.ts`, because importing a test file would run that suite twice:

```ts
import { describe, expect, it } from "vitest";
import { buildCellMap } from "@/lib/boards/cache";
import { computeSignals } from "@/lib/boards/intelligence/signals";
import { localTodayISO } from "@/lib/boards/overdue";
import { buildTimelineLate } from "@/lib/boards/timeline-late";

// Sat 14 Nov 2026, 12:00 viewer-local.
const NOW = new Date(2026, 10, 14, 12, 0, 0);
const TODAY = localTodayISO(NOW);

const columns = [
  {
    id: "c-status",
    kind: "status",
    position: 0,
    settings: {
      options: [
        { id: "open", label: "Working" },
        { id: "done", label: "Done" },
      ],
    },
  },
  { id: "c-start", kind: "date", position: 1, settings: {} },
  { id: "c-due", kind: "date", position: 2, settings: {} },
] as never;

const items = ["late", "done", "future", "other-col", "sub"].map((id) => ({
  id,
  name: id,
  group_id: "g1",
  parent_id: id === "sub" ? "late" : null,
  position: 0,
  updated_at: "2026-11-01T00:00:00Z",
})) as never;

const cv = (item_id: string, column_id: string, value: unknown) => ({
  item_id,
  column_id,
  value,
  updated_at: "2026-11-01T00:00:00Z",
});
const cellValues = [
  cv("late", "c-start", { date: "2026-10-01", end: "2026-10-24" }),
  cv("done", "c-start", { date: "2026-10-01" }),
  cv("done", "c-status", { optionId: "done" }),
  cv("future", "c-start", { date: "2026-12-01" }),
  // On time in the timeline's own column, past due in another date column.
  cv("other-col", "c-start", { date: "2026-12-01" }),
  cv("other-col", "c-due", { date: "2026-11-10" }),
  cv("sub", "c-start", { date: "2026-11-13" }),
] as never;

function late() {
  return buildTimelineLate({
    items,
    columns,
    cellMap: buildCellMap(cellValues),
    todayISO: TODAY,
  });
}

describe("buildTimelineLate", () => {
  it("counts whole days since the earliest past-due date, open items only", () => {
    expect([...late().lateDays.entries()]).toEqual([
      ["late", 21],
      ["other-col", 4],
      ["sub", 1],
    ]);
  });

  it("reads done from the first status column's done/complete label", () => {
    expect(late().isDone("done")).toBe(true);
    expect(late().isDone("late")).toBe(false);
  });

  it("marks exactly the items the Board Intelligence overdue chip counts", () => {
    const overdue = computeSignals(
      { items, columns, cellValues, groups: [], dependencies: [] } as never,
      { now: NOW, lastSeenAt: null, currentUserId: "u1" },
    ).find((s) => s.kind === "overdue");
    expect([...late().lateDays.keys()].sort()).toEqual(
      [...(overdue?.itemIds ?? [])].sort(),
    );
    expect(overdue?.itemIds).toHaveLength(3);
  });

  it("has no late items on a board with no date column", () => {
    const res = buildTimelineLate({
      items,
      columns: [] as never,
      cellMap: buildCellMap(cellValues),
      todayISO: TODAY,
    });
    expect(res.lateDays.size).toBe(0);
    expect(res.isDone("done")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/lib/boards/gantt.test.ts src/lib/boards/overdue.test.ts src/lib/boards/timeline-late.test.ts`

Expected: FAIL. `timeline-late.test.ts` fails to load with `Failed to resolve import "@/lib/boards/timeline-late"`. The new blocks in the other two fail with `rangeIncludingToday is not a function`, `groupTimelineRows is not a function`, `spanOfRows is not a function`, `dueISO is not a function`. Every older test in those files still passes.

- [ ] **Step 3: Extract `dueISO`**

In `src/lib/boards/overdue.ts` replace the `isOverdue` function and its doc comment (lines 86-97) with

```ts
/**
 * The due date a date cell carries (`end ?? date`), or null when it is missing
 * or malformed. The one place that reads a cell's due date — `isOverdue` and
 * the timeline's "Nd late" label both go through it.
 */
export function dueISO(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const { date, end } = value as { date?: unknown; end?: unknown };
  return typeof end === "string" ? end : typeof date === "string" ? date : null;
}

/**
 * Overdue ⇔ due (`end ?? date`) is strictly before `todayISO`. ISO `YYYY-MM-DD`
 * strings compare correctly as strings; missing/malformed values are never
 * overdue.
 */
export function isOverdue(value: unknown, todayISO: string): boolean {
  const due = dueISO(value);
  return due !== null && due < todayISO;
}
```

- [ ] **Step 4: Add the late builder**

Create `src/lib/boards/timeline-late.ts`:

```ts
// "Late" for the board timeline. Built from the SAME primitives the Board
// Intelligence overdue chip uses (`overdueSignals` in intelligence/signals.ts):
// an item is late when it is open — its cell in the board's first status
// column is not a done/complete option — and ANY date-kind column holds a due
// date before the viewer's local today. timeline-late.test.ts pins the two
// together, so the bars and the chip cannot disagree.
import { cellKey, type CacheColumn } from "@/lib/boards/cache";
import { diffDaysISO } from "@/lib/boards/calendar";
import {
  dueISO,
  firstStatusColumn,
  isOverdue,
  isStatusValueComplete,
} from "@/lib/boards/overdue";

export type TimelineLate = {
  /** itemId → whole days since its earliest past-due date. Late items only. */
  lateDays: Map<string, number>;
  /** The chip's completeness rule, for the group summary's done share. */
  isDone: (itemId: string) => boolean;
};

export function buildTimelineLate(input: {
  items: readonly { id: string }[];
  columns: readonly CacheColumn[];
  cellMap: ReadonlyMap<string, unknown>;
  todayISO: string;
}): TimelineLate {
  const statusColumn = firstStatusColumn(input.columns);
  const isDone = (itemId: string) =>
    isStatusValueComplete(
      statusColumn
        ? (input.cellMap.get(cellKey(itemId, statusColumn.id)) ?? null)
        : null,
      statusColumn,
    );
  const dateColumns = input.columns.filter((c) => c.kind === "date");
  const lateDays = new Map<string, number>();
  for (const it of input.items) {
    if (isDone(it.id)) continue;
    let earliest: string | null = null;
    for (const col of dateColumns) {
      const value = input.cellMap.get(cellKey(it.id, col.id));
      if (!isOverdue(value, input.todayISO)) continue;
      const due = dueISO(value);
      if (due !== null && (earliest === null || due < earliest)) earliest = due;
    }
    if (earliest === null) continue;
    // A malformed-but-"earlier" string still counts as late for the chip, so
    // it stays in the set here too; it just reads as one day.
    const days = diffDaysISO(earliest, input.todayISO);
    lateDays.set(it.id, Number.isFinite(days) && days > 0 ? days : 1);
  }
  return { lateDays, isDone };
}
```

- [ ] **Step 5: Add the summary type, range padding and grouping**

In `src/lib/boards/gantt.ts`:

1. Line 3 already imports `addDaysISO` and `diffDaysISO` from `@/lib/boards/calendar`; no import changes are needed.
2. The `GanttRow` type ends (lines 27-31)

```ts
  /** "section" rows are label bands (folder board / group headers) with no bar. */
  kind?: "item" | "section";
  /** Section depth: 0 = board band, 1 = group band. */
  level?: 0 | 1;
};
```

Replace those lines with

```ts
  /** "section" rows are label bands (folder board / group headers) with no bar. */
  kind?: "item" | "section";
  /** Section depth: 0 = board band, 1 = group band. */
  level?: 0 | 1;
  /** Section rows only: the span of everything under the band and its
   * progress. Drawn as a thin summary bar; a section still has no draggable
   * bar and no `startCol` of its own (so arrows keep skipping it). */
  summary?: GanttSectionSummary;
};

export type GanttSectionSummary = {
  startCol: number;
  spanCols: number;
  /** null = unknown, draw the span without a fill. */
  donePct: number | null;
  lateCount: number | null;
};
```

3. Directly after the `visibleRows` function (after line 147) add

```ts
// ---------------------------------------------------------------------------
// Range padding
// ---------------------------------------------------------------------------

/** Days of context a timeline always shows before / after today. */
export const TODAY_PAD_BEFORE = 14;
export const TODAY_PAD_AFTER = 30;

/**
 * Widen a data range so it always contains today − 14 days … today + 30 days.
 * A timeline opens scrolled to today, which only works if today is on the
 * grid. Empty bounds (nothing dated) fall back to the padded today window.
 * `timelineDayCount`'s 3,660-day cap still applies on top of this.
 */
export function rangeIncludingToday(
  minISO: string | null,
  maxISO: string | null,
  todayISO: string,
): { startISO: string; endISO: string } {
  const from = addDaysISO(todayISO, -TODAY_PAD_BEFORE);
  const to = addDaysISO(todayISO, TODAY_PAD_AFTER);
  return {
    startISO: minISO && minISO < from ? minISO : from,
    endISO: maxISO && maxISO > to ? maxISO : to,
  };
}

// ---------------------------------------------------------------------------
// Section summaries and group bands
// ---------------------------------------------------------------------------

/** Earliest start → latest end (in day columns) of the scheduled rows. */
export function spanOfRows(
  rows: readonly GanttRow[],
): { startCol: number; spanCols: number } | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const r of rows) {
    if (!r.scheduled || r.startCol === undefined || r.spanCols === undefined)
      continue;
    const end = r.startCol + r.spanCols;
    if (min === null || r.startCol < min) min = r.startCol;
    if (max === null || end > max) max = end;
  }
  return min === null || max === null
    ? null
    : { startCol: min, spanCols: max - min };
}

/** Band id for rows whose group is not in the board's group list. */
export const UNGROUPED_GROUP_ID = "__ungrouped__";

export type TimelineGroupRef = { id: string; name: string; position: number };

/**
 * Lay a board's timeline rows out under one band per group.
 *
 * `rows` is `buildGanttRows` output already filtered to what belongs on the
 * timeline (scheduled rows + parents with a scheduled sub-item), in its nested
 * order: each top-level row followed by its sub-items. For each group in
 * position order this emits a section row (`group:<id>`, level 1) carrying a
 * summary, then — unless the group is collapsed — that group's rows, with
 * sub-items shown only under an expanded parent. A group with no rows is
 * skipped. The summary is computed from every scheduled row of the group,
 * collapsed or not: earliest start, latest end, share done, count late.
 */
export function groupTimelineRows(
  rows: readonly GanttRow[],
  groupOfItem: ReadonlyMap<string, string>,
  groups: readonly TimelineGroupRef[],
  opts: {
    collapsedGroups: ReadonlySet<string>;
    expanded: ReadonlySet<string>;
    isDone: (itemId: string) => boolean;
    lateFor: (row: GanttRow) => number | null;
  },
): GanttRow[] {
  const known = new Set(groups.map((g) => g.id));
  const byGroup = new Map<string, GanttRow[]>();
  for (const r of rows) {
    // A sub-item sits in its parent's group.
    const gid = groupOfItem.get(r.parentId ?? r.itemId);
    const key = gid !== undefined && known.has(gid) ? gid : UNGROUPED_GROUP_ID;
    const list = byGroup.get(key);
    if (list) list.push(r);
    else byGroup.set(key, [r]);
  }
  const ordered: TimelineGroupRef[] = [...groups].sort(
    (a, b) => a.position - b.position,
  );
  if (byGroup.has(UNGROUPED_GROUP_ID))
    ordered.push({
      id: UNGROUPED_GROUP_ID,
      name: "Other items",
      position: Number.MAX_SAFE_INTEGER,
    });

  const out: GanttRow[] = [];
  for (const g of ordered) {
    const groupRows = byGroup.get(g.id);
    if (!groupRows || groupRows.length === 0) continue;
    const band: GanttRow = {
      itemId: `group:${g.id}`,
      name: g.name,
      scheduled: false,
      kind: "section",
      level: 1,
    };
    const span = spanOfRows(groupRows);
    if (span) {
      const scheduled = groupRows.filter((r) => r.scheduled);
      const done = scheduled.filter((r) => opts.isDone(r.itemId)).length;
      band.summary = {
        ...span,
        donePct: Math.round((done / scheduled.length) * 100),
        lateCount: scheduled.filter((r) => opts.lateFor(r) !== null).length,
      };
    }
    out.push(band);
    if (opts.collapsedGroups.has(g.id)) continue;
    out.push(...visibleRows(groupRows, opts.expanded));
  }
  return out;
}
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/lib/boards/gantt.test.ts src/lib/boards/overdue.test.ts src/lib/boards/timeline-late.test.ts src/lib/boards/intelligence/signals.test.ts src/lib/folders/timeline.test.ts`

Expected: PASS, every file (`signals.test.ts` proves the `isOverdue` refactor changed nothing; `timeline.test.ts` proves `buildGanttRows` callers are untouched).

- [ ] **Step 7: Typecheck and lint**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 8: Hand back**

Report the files changed, the tail of each command's output and any deviation. Do not stage, commit or stash.

---

### Task 3: Stage filter — chips up to eight stages, a searchable menu above

**Files:**

- Modify: `src/components/folders/FilterBar.tsx` (whole file, 109 lines)
- Create test: `src/components/folders/FilterBar.test.tsx`
- Test: `src/components/folders/CommandCenter.test.tsx`

**Interfaces:**

- Consumes: `Popover`, `PopoverContent`, `PopoverTrigger` from `@/components/ui/popover`; `Command`, `CommandEmpty`, `CommandGroup`, `CommandInput`, `CommandItem`, `CommandList` from `@/components/ui/command` (the same composition as `src/components/ui/timezone-picker.tsx`); `Button`.
- Produces: `export const STAGE_CHIP_LIMIT = 8;` and an unchanged `FilterBar` props contract. With more than eight stages the bar renders a `role="combobox"` button named "Stage" instead of the `role="group"` chip row. `onStage(key | null)` is called exactly as before, so the `?stage=` URL contract in `command-center-state.ts` does not change.

**Existing tests that change:** none. `folderFixture()` has four stages, so every `CommandCenter.test.tsx` test that touches the chip row (`:97-109`, `:111-123`) still sees chips. This also changes the filter on the Overview, Stages, Boards and People tabs for a folder with more than eight stages; that is intended.

- [ ] **Step 1: Write the failing tests**

Create `src/components/folders/FilterBar.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageSummary } from "@/lib/folders/stages";
import { FilterBar, STAGE_CHIP_LIMIT } from "./FilterBar";

const stage = (i: number): StageSummary => ({
  key: `stage ${i}`,
  name: `Stage ${i}`,
  color: "#579bfc",
  position: i,
  boardIds: ["b1"],
  onlyOnBoard: "b1",
  total: 1,
  done: 0,
  inProgress: 0,
  overdue: 0,
  notStarted: 1,
  blocked: 0,
  stale: 0,
  unassigned: 0,
  minDue: null,
  maxDue: null,
  state: "upcoming",
});
const stages = (n: number) => Array.from({ length: n }, (_, i) => stage(i + 1));

function renderBar(count: number, selected: string | null = null) {
  const onStage = vi.fn();
  render(
    <FilterBar
      stages={stages(count)}
      boards={[{ id: "b1", name: "Backend", position: 0 }]}
      stage={selected}
      board={null}
      itemCount={count}
      onStage={onStage}
      onBoard={vi.fn()}
    />,
  );
  return onStage;
}

describe("FilterBar stage control", () => {
  it("keeps the chip row at the limit of eight stages", () => {
    expect(STAGE_CHIP_LIMIT).toBe(8);
    renderBar(8);
    const group = screen.getByRole("group", { name: "Stage" });
    // "All" + one chip per stage.
    expect(within(group).getAllByRole("button")).toHaveLength(9);
    expect(
      screen.queryByRole("combobox", { name: "Stage" }),
    ).not.toBeInTheDocument();
  });

  it("becomes one Stages menu at nine", () => {
    renderBar(9);
    expect(
      screen.queryByRole("group", { name: "Stage" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Stage" })).toHaveTextContent(
      "All stages",
    );
  });

  it("shows the selected stage on the button, as its description", () => {
    renderBar(9, "stage 3");
    const trigger = screen.getByRole("combobox", { name: "Stage" });
    expect(trigger).toHaveTextContent("Stage 3");
    expect(trigger).toHaveAccessibleDescription("Stage 3");
  });

  it("searches the list and selects a stage by its key", async () => {
    const user = userEvent.setup();
    const onStage = renderBar(12);
    await user.click(screen.getByRole("combobox", { name: "Stage" }));
    await user.type(screen.getByPlaceholderText("Search stages…"), "Stage 7");
    await user.click(await screen.findByRole("option", { name: /Stage 7/ }));
    expect(onStage).toHaveBeenCalledTimes(1);
    expect(onStage).toHaveBeenCalledWith("stage 7");
  }, 15_000);

  it("clears the filter from the All stages entry", async () => {
    const user = userEvent.setup();
    const onStage = renderBar(9, "stage 3");
    await user.click(screen.getByRole("combobox", { name: "Stage" }));
    await user.click(await screen.findByRole("option", { name: "All stages" }));
    expect(onStage).toHaveBeenCalledWith(null);
  }, 15_000);

  it("still hides the stage control with a single stage", () => {
    renderBar(1);
    expect(
      screen.queryByRole("group", { name: "Stage" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Stage" }),
    ).not.toBeInTheDocument();
  });
});
```

The open-click-select flow through Radix `Popover` + `cmdk` in jsdom is the one `src/components/ui/timezone-picker.test.tsx:70-83` already runs (including its 15 s timeout); `vitest.setup.ts` supplies the `ResizeObserver` and `scrollIntoView` stubs it needs.

In `src/components/folders/CommandCenter.test.tsx` add `import userEvent from "@testing-library/user-event";` after the Testing Library import, and add this test inside `describe("CommandCenter", …)`, after the test "switching tab and stage costs zero server calls…":

```tsx
it("a folder with more than eight stages filters through the Stages menu and still writes ?stage=", async () => {
  const user = userEvent.setup();
  const payload = folderFixture();
  const seed = payload.rollup![0]!;
  // The fixture has 4 stages; six more makes 10.
  payload.rollup = [
    ...payload.rollup!,
    ...Array.from({ length: 6 }, (_, i) => ({
      ...seed,
      groupId: `b1:extra-${i}`,
      groupName: `Extra ${i}`,
      groupPosition: 10 + i,
    })),
  ];
  render(wrap({ payload }));
  expect(
    screen.queryByRole("group", { name: "Stage" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("combobox", { name: "Stage" }));
  await user.click(await screen.findByRole("option", { name: /Extra 3/ }));
  expect(new URLSearchParams(window.location.search).get("stage")).toBe(
    "extra 3",
  );
  expect(routerPush).not.toHaveBeenCalled();
  expect(routerRefresh).not.toHaveBeenCalled();
  expect(getFolderWorkload).not.toHaveBeenCalled();
}, 15_000);
```

(`setStage` writes with `history.replaceState`, which jsdom reflects in `window.location`; the file's `beforeEach` resets the URL to `/folders/f1`.)

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/folders/FilterBar.test.tsx src/components/folders/CommandCenter.test.tsx`

Expected: FAIL. In `FilterBar.test.tsx`: `expected undefined to be 8`, and the nine-and-over tests fail with `Unable to find an accessible element with the role "combobox" and name "Stage"`. The new `CommandCenter` test fails the same way. The eight-stage and one-stage tests' DOM assertions would pass against today's code; only the `STAGE_CHIP_LIMIT` line fails in the first.

- [ ] **Step 3: Implement the menu**

Replace the whole of `src/components/folders/FilterBar.tsx` with

```tsx
"use client";

import { useId, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { StageSummary } from "@/lib/folders/stages";
import type { FolderBoardRef } from "@/lib/folders/types";
import { cn } from "@/lib/utils";

/** Up to this many stages render as chips; above it, one searchable menu. A
 * folder with dozens of stages would otherwise spend several rows of every
 * Command Center tab on chips. */
export const STAGE_CHIP_LIMIT = 8;

/**
 * The stage filter for a folder with many stages: one button showing the
 * selected stage (name + colour dot), opening a searchable list. The trigger's
 * accessible NAME stays "Stage"; the selection is its description — the same
 * split `TimezonePicker` uses, so a screen reader hears what the field is.
 */
function StageMenu({
  stages,
  stage,
  onStage,
}: {
  stages: StageSummary[];
  stage: string | null;
  onStage: (k: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const valueId = useId();
  const selected = stages.find((s) => s.key === stage) ?? null;
  function pick(k: string | null) {
    onStage(k);
    setOpen(false);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-label="Stage"
          aria-describedby={valueId}
          aria-expanded={open}
          className="gap-1.5 text-xs"
        >
          {selected ? (
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          ) : null}
          <span id={valueId} className="max-w-48 truncate">
            {selected ? selected.name : "All stages"}
          </span>
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Search stages…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No stage found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="All stages" onSelect={() => pick(null)}>
                <Check
                  className={cn(
                    "size-4",
                    stage === null ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />
                All stages
              </CommandItem>
              {stages.map((s) => (
                <CommandItem
                  key={s.key}
                  value={s.name}
                  onSelect={() => pick(s.key)}
                >
                  <Check
                    className={cn(
                      "size-4",
                      stage === s.key ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="truncate">{s.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Stage control (chips, or a menu above STAGE_CHIP_LIMIT) + board dropdown + mono hint (spec §5.1). Hidden stage control when ≤ 1 stage (spec §8). */
export function FilterBar({
  stages,
  boards,
  stage,
  board,
  itemCount,
  onStage,
  onBoard,
}: {
  stages: StageSummary[];
  boards: FolderBoardRef[];
  stage: string | null;
  board: string | null;
  itemCount: number;
  onStage: (k: string | null) => void;
  onBoard: (id: string | null) => void;
}) {
  const stageName = stages.find((s) => s.key === stage)?.name;
  const boardName = boards.find((b) => b.id === board)?.name ?? "All boards";
  const hint = [
    `${itemCount} items`,
    `${board ? 1 : boards.length} boards`,
    stageName,
  ]
    .filter(Boolean)
    .join(" · ");
  const chip = (active: boolean) =>
    cn(
      // Hand-rolled control: it has to buy its own 44px coarse touch target,
      // the app primitives (Button, DropdownMenuItem) get it for free.
      "focus-visible:ring-ring flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-3",
      active
        ? "border-border-bright bg-surface-muted text-foreground"
        : "hover:border-border-hover text-muted-foreground",
    );
  return (
    <div data-print-hide className="flex flex-wrap items-center gap-2 py-3">
      {stages.length > STAGE_CHIP_LIMIT ? (
        <StageMenu stages={stages} stage={stage} onStage={onStage} />
      ) : stages.length > 1 ? (
        <div role="group" aria-label="Stage" className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onStage(null)}
            className={chip(stage === null)}
            aria-pressed={stage === null}
          >
            All
          </button>
          {stages.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onStage(s.key)}
              className={chip(stage === s.key)}
              aria-pressed={stage === s.key}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
          >
            {boardName}
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={() => onBoard(null)}>
            All boards
          </DropdownMenuItem>
          {boards.map((b) => (
            <DropdownMenuItem key={b.id} onSelect={() => onBoard(b.id)}>
              {b.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-muted-foreground ml-auto font-mono text-xs">
        {hint}
      </span>
    </div>
  );
}
```

The chip row, the board dropdown and the hint are byte-for-byte today's markup; only the outer condition and the `StageMenu` are new. The stage colour dot's inline `backgroundColor` is user data (a group colour), the same pattern the chips already use.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/folders/FilterBar.test.tsx src/components/folders/CommandCenter.test.tsx src/components/folders/no-gantt-in-first-paint.test.ts src/components/folders/no-recharts-in-first-paint.test.ts`

Expected: PASS, every file. (`FilterBar` is statically imported by `CommandCenter`; the two first-paint guards prove `popover` and `command` pulled in neither the Gantt canvas nor recharts.)

- [ ] **Step 5: Typecheck and lint**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 6: Hand back**

Report the files changed, the tail of each command's output and any deviation. The menu's width, the popover's placement and the 44px target of the trigger on a coarse pointer are verified in a browser by the orchestrator (Task 12). Do not stage, commit or stash.

---

### Task 4: Canvas — open on today, Today handle, continuous today line, weekend shading

**Files:**

- Modify: `src/components/boards/gantt/utils.ts` (append helpers)
- Modify: `src/components/boards/gantt/GanttCanvas.tsx` (react import 3-11, utils import, props, the block after `todayOffset`, `SectionBand` and its call site)
- Modify: `src/components/boards/gantt/GanttRowItem.tsx` (props, track `div` originally at 391-402)
- Test: `src/components/boards/gantt/utils.test.ts`, `src/components/boards/gantt/GanttCanvas.test.tsx`

**Interfaces:**

- Consumes: Task 1's `labelW` and `SectionBand` shape.
- Produces, in `gantt/utils.ts`:

```ts
export const TODAY_ANCHOR = 0.34;
export function todayScrollLeft(
  todayOffset: number,
  dayW: number,
  trackWidth: number,
): number;
export function weekendStripes(
  rangeStartISO: string,
  dayW: number,
  zoom: TimelineZoom,
): CSSProperties | undefined;
```

- Produces, in `GanttCanvas.tsx`: `export type GanttCanvasHandle = { scrollToToday: () => void };` and a new prop `handleRef?: Ref<GanttCanvasHandle>`. It is a plain prop, not `ref`, so a test probe that stands in for the canvas receives it like any other prop.
- Produces: `GanttRowItem` prop `trackStyle?: CSSProperties`; DOM hooks `data-testid="gantt-track"` (item track), `data-testid="gantt-section-track"` (band track), `data-today-line` (both hairlines).

**Existing tests that change:** none break. `GanttCanvas.test.tsx` gains a module mock that pins `todayISO()` to 2026-11-14 for the whole file; the existing suites use a November 2026 range and assert nothing about today.

**What jsdom can and cannot prove here:** `scrollLeft` is a plain settable property in jsdom and `Element.prototype.scrollTo` does not exist (both checked), so the scroll target and the `scrollTo` call are asserted for real. `clientWidth` is 0 in jsdom; the new block defines it on `HTMLElement.prototype` for its own tests and removes it afterwards, because the older suites rely on the unmeasured track. Whether today lands 34% across on screen, and whether the weekend stripes line up with real Saturdays, is verified in a browser by the orchestrator (Task 12).

- [ ] **Step 1: Write the failing tests**

Append to `src/components/boards/gantt/utils.test.ts` (add `todayScrollLeft`, `weekendStripes` to the import):

```ts
describe("todayScrollLeft", () => {
  it("puts today 34% of the way across the visible track", () => {
    expect(todayScrollLeft(200, 10, 1000)).toBe(1660);
  });
  it("never scrolls to a negative offset", () => {
    expect(todayScrollLeft(10, 10, 1000)).toBe(0);
  });
});

describe("weekendStripes", () => {
  it("shades Saturday and Sunday on a Monday-first seven-day tile", () => {
    // 2026-11-02 is a Monday.
    expect(weekendStripes("2026-11-02", 10, "month")).toEqual({
      backgroundImage:
        "linear-gradient(to right, transparent 50px, var(--color-state-hover) 50px)",
      backgroundSize: "70px 100%",
      backgroundPosition: "0px 0",
    });
  });
  it("offsets the tile by the weekday the range starts on", () => {
    // 2026-11-01 is a Sunday: six days after Monday, at 28px a day.
    expect(weekendStripes("2026-11-01", 28, "week")?.backgroundPosition).toBe(
      "-168px 0",
    );
  });
  it("draws nothing at quarter and year zoom, or without a range", () => {
    expect(weekendStripes("2026-11-02", 4, "quarter")).toBeUndefined();
    expect(weekendStripes("2026-11-02", 1.5, "year")).toBeUndefined();
    expect(weekendStripes("", 10, "month")).toBeUndefined();
  });
});
```

In `src/components/boards/gantt/GanttCanvas.test.tsx`:

1. Change the first three import lines to

```tsx
import { createRef } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
```

and extend the canvas import to `import { GanttCanvas, type GanttCanvasHandle, type GanttCanvasProps } from "@/components/boards/gantt/GanttCanvas";`.

2. Directly under the existing `vi.mock("@/lib/dnd/sensors", …)` line add

```tsx
// Pin "today" for the whole file: the today line and the open-on-today scroll
// read todayISO(). The fixtures below sit in November 2026.
vi.mock("@/components/boards/gantt/utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/boards/gantt/utils")>();
  return { ...actual, todayISO: () => "2026-11-14" };
});
```

3. Append at the end of the file:

```tsx
describe("GanttCanvas today line and weekends", () => {
  it("draws the today hairline on section bands as well as item rows", () => {
    render(<GanttCanvas {...props()} />);
    // Range starts 2026-11-01; today is the 14th → day 13 × 10px.
    const band = screen.getByTestId("gantt-section");
    expect(band.querySelector("[data-today-line]")).toHaveStyle({
      left: "130px",
    });
    for (const row of screen.getAllByTestId("gantt-row")) {
      expect(row.querySelector("[data-today-line]")).toHaveStyle({
        left: "130px",
      });
    }
  });

  it("shades weekends on item and band tracks at month zoom, not at quarter", () => {
    const { rerender } = render(<GanttCanvas {...props()} />);
    expect(screen.getAllByTestId("gantt-track")[0]!.style.backgroundSize).toBe(
      "70px 100%",
    );
    expect(screen.getByTestId("gantt-section-track").style.backgroundSize).toBe(
      "70px 100%",
    );
    rerender(<GanttCanvas {...props({ zoom: "quarter" })} />);
    expect(screen.getAllByTestId("gantt-track")[0]!.style.backgroundSize).toBe(
      "",
    );
  });
});

describe("GanttCanvas opens on today", () => {
  // jsdom has no layout. Give every element a 1300px client width so the
  // scroller measures a 1300 − 300 (rail) = 1000px track. Scoped to this block
  // and removed afterwards: the suites above rely on the unmeasured track.
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 1300,
    });
  });
  afterAll(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  });

  // 2026-05-01 → 2026-11-14 is 197 days. 400 days at month zoom overflows the
  // track, so the base scale (10px/day) holds and the grid scrolls.
  const wide = { rangeStartISO: "2026-05-01", dayCount: 400 };
  const scrollerOf = (container: HTMLElement) =>
    container.querySelector("[data-scroll-container]") as HTMLElement;

  it("parks today 34% across the track once the track has a width", () => {
    const { container } = render(<GanttCanvas {...props(wide)} />);
    expect(scrollerOf(container).scrollLeft).toBe(197 * 10 - 340);
  });

  it("does not move the viewport when the data changes", () => {
    const { container, rerender } = render(<GanttCanvas {...props(wide)} />);
    const scroller = scrollerOf(container);
    scroller.scrollLeft = 40; // the user scrolled away
    rerender(<GanttCanvas {...props({ ...wide, rows: rows.slice(0, 2) })} />);
    expect(scroller.scrollLeft).toBe(40);
    // An earlier item moved the range start: today's offset changes, the
    // viewport still must not jump.
    rerender(
      <GanttCanvas
        {...props({ rangeStartISO: "2026-04-01", dayCount: 430 })}
      />,
    );
    expect(scroller.scrollLeft).toBe(40);
  });

  it("re-centres on today when the zoom changes", () => {
    const { container, rerender } = render(<GanttCanvas {...props(wide)} />);
    const scroller = scrollerOf(container);
    scroller.scrollLeft = 40;
    rerender(<GanttCanvas {...props({ ...wide, zoom: "week" })} />);
    expect(scroller.scrollLeft).toBe(197 * 28 - 340);
  });

  it("leaves the viewport alone when today is outside the range", () => {
    const { container } = render(
      <GanttCanvas
        {...props({ rangeStartISO: "2027-01-01", dayCount: 400 })}
      />,
    );
    expect(scrollerOf(container).scrollLeft).toBe(0);
  });

  it("smooth-scrolls to today through the handle", () => {
    const handleRef = createRef<GanttCanvasHandle>();
    const { container } = render(
      <GanttCanvas {...props({ ...wide, handleRef })} />,
    );
    const scroller = scrollerOf(container);
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    act(() => handleRef.current?.scrollToToday());
    expect(scrollTo).toHaveBeenCalledWith({ left: 1630, behavior: "smooth" });
  });

  it("falls back to an instant scroll where scrollTo is missing", () => {
    const handleRef = createRef<GanttCanvasHandle>();
    const { container } = render(
      <GanttCanvas {...props({ ...wide, handleRef })} />,
    );
    const scroller = scrollerOf(container);
    scroller.scrollLeft = 0;
    act(() => handleRef.current?.scrollToToday());
    expect(scroller.scrollLeft).toBe(1630);
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/boards/gantt/utils.test.ts src/components/boards/gantt/GanttCanvas.test.tsx`

Expected: FAIL. `todayScrollLeft is not a function`, `weekendStripes is not a function`; the band has no `[data-today-line]` (`received value must be an HTMLElement … received null`); `Unable to find an element by: [data-testid="gantt-track"]`; the open-on-today tests fail with `expected 0 to be 1630` (and `5176`), and the handle tests because `handleRef.current` is null. "does not move the viewport when the data changes" and "leaves the viewport alone…" already pass; they guard the implementation, not drive it.

- [ ] **Step 3: Add the pure helpers**

In `src/components/boards/gantt/utils.ts` add `import type { CSSProperties } from "react";` as the first import, and append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Today anchor + weekend shading
// ---------------------------------------------------------------------------

/** Share of the visible track left of today when a timeline opens: a little
 * recent past for context, most of the screen for what is coming. */
export const TODAY_ANCHOR = 0.34;

/** scrollLeft that puts today TODAY_ANCHOR of the way across the visible
 * track. `trackWidth` is the scroller's width minus the sticky name rail. */
export function todayScrollLeft(
  todayOffset: number,
  dayW: number,
  trackWidth: number,
): number {
  return Math.max(
    0,
    Math.round(todayOffset * dayW - trackWidth * TODAY_ANCHOR),
  );
}

/**
 * Weekend shading for a track, as ONE repeating background: a seven-day tile
 * (Monday first) whose last two days are tinted, shifted by the weekday the
 * range starts on. Week and Month zoom only — at Quarter and Year a day is 4px
 * or less and the stripes would be noise. The tint is the alpha-on-parent
 * hover token, so it reads on every surface, theme and reach.
 */
export function weekendStripes(
  rangeStartISO: string,
  dayW: number,
  zoom: TimelineZoom,
): CSSProperties | undefined {
  if (!rangeStartISO || (zoom !== "week" && zoom !== "month")) return undefined;
  const sinceMonday = (new Date(parseISO(rangeStartISO)).getUTCDay() + 6) % 7;
  const workdays = 5 * dayW;
  return {
    backgroundImage: `linear-gradient(to right, transparent ${workdays}px, var(--color-state-hover) ${workdays}px)`,
    backgroundSize: `${7 * dayW}px 100%`,
    backgroundPosition: `${-sinceMonday * dayW}px 0`,
  };
}
```

(`${-0 * 10}px` prints `0px`, which is what the first `weekendStripes` test expects.)

- [ ] **Step 4: Tint the item track and tag its today line**

In `src/components/boards/gantt/GanttRowItem.tsx`:

1. Add `trackStyle,` to the destructured props after `labelW,`, and to the props type:

```tsx
  /** Weekend shading for the track (see weekendStripes); undefined = none. */
  trackStyle?: CSSProperties;
```

(`CSSProperties` is already imported as a type on line 3.)

2. The track currently opens (originally lines 390-402)

```tsx
      {/* Timeline track */}
      <div
        className="relative overflow-hidden"
        style={{ width: totalW, height: ROW_H }}
      >
        {/* Today hairline */}
        {todayOffset >= 0 && todayOffset <= dayCount && (
          <div
            className="bg-destructive/30 absolute top-0 h-full w-px"
            style={{ left: todayOffset * dayW }}
            aria-hidden
          />
        )}
```

Replace it with

```tsx
      {/* Timeline track */}
      <div
        data-testid="gantt-track"
        className="relative overflow-hidden"
        style={{ width: totalW, height: ROW_H, ...trackStyle }}
      >
        {/* Today hairline */}
        {todayOffset >= 0 && todayOffset <= dayCount && (
          <div
            data-today-line
            className="bg-destructive/30 absolute top-0 h-full w-px"
            style={{ left: todayOffset * dayW }}
            aria-hidden
          />
        )}
```

- [ ] **Step 5: Scroll to today, expose the handle, draw the band track**

In `src/components/boards/gantt/GanttCanvas.tsx`:

1. Change the react import to

```tsx
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
```

and add `todayScrollLeft,` and `weekendStripes,` to the utils import.

2. Above `export type GanttCanvasProps` add

```tsx
/** What a toolbar may ask of the canvas without reaching into its scroller. */
export type GanttCanvasHandle = {
  /** Smooth-scroll so today sits TODAY_ANCHOR across the visible track. */
  scrollToToday: () => void;
};
```

In `GanttCanvasProps` add, after `onLabelWidthChange`:

```tsx
  /** Imperative handle (a plain prop, not `ref`): the toolbar's Today button. */
  handleRef?: Ref<GanttCanvasHandle>;
```

and add `handleRef,` to the destructured parameters.

3. The component currently has (originally lines 233-236)

```tsx
const today = todayISO();
const todayOffset = rangeStartISO
  ? Math.round((parseISO(today) - parseISO(rangeStartISO)) / 86_400_000)
  : -1;
```

Directly after it add

```tsx
const todayInRange = todayOffset >= 0 && todayOffset <= dayCount;

// Open on today. Runs after the first layout that has a real track width,
// and again when the zoom changes (a new dayW makes the old offset
// meaningless). Keyed by zoom through a ref — NOT by the data — so a drag,
// a collapse or a realtime edit that shifts the range never moves the
// viewport out from under the user.
const scrolledForZoom = useRef<TimelineZoom | null>(null);
useIsoLayoutEffect(() => {
  const scroller = scrollRef.current;
  if (!scroller || trackWidth <= 0 || !todayInRange) return;
  if (scrolledForZoom.current === zoom) return;
  scrolledForZoom.current = zoom;
  scroller.scrollLeft = todayScrollLeft(todayOffset, dayW, trackWidth);
}, [zoom, trackWidth, todayInRange, todayOffset, dayW]);

useImperativeHandle(
  handleRef,
  () => ({
    scrollToToday() {
      const scroller = scrollRef.current;
      if (!scroller || !todayInRange) return;
      const left = todayScrollLeft(todayOffset, dayW, Math.max(0, trackWidth));
      // Element.scrollTo is missing in some embedded webviews (and jsdom).
      if (typeof scroller.scrollTo === "function")
        scroller.scrollTo({ left, behavior: "smooth" });
      else scroller.scrollLeft = left;
    },
  }),
  [todayInRange, todayOffset, dayW, trackWidth],
);

// Weekend shading, computed once per canvas and handed to every track.
const trackStyle = useMemo(
  () => weekendStripes(rangeStartISO, dayW, zoom),
  [rangeStartISO, dayW, zoom],
);
```

4. In the header, the today line's condition `todayOffset >= 0 && todayOffset <= dayCount` may stay as it is.

5. In the row render, pass the new props. `<SectionBand … />` becomes

```tsx
<SectionBand
  row={row}
  totalW={totalW}
  labelW={labelW}
  dayW={dayW}
  todayOffset={todayOffset}
  dayCount={dayCount}
  trackStyle={trackStyle}
  expanded={isExpanded?.(row.itemId) ?? true}
  onToggle={onToggleExpand}
/>
```

and `<GanttRowItem … />` gets `trackStyle={trackStyle}` after `labelW={labelW}`.

6. In `SectionBand`, extend the parameter list and its type with

```tsx
  dayW,
  todayOffset,
  dayCount,
  trackStyle,
```

```tsx
  dayW: number;
  todayOffset: number;
  dayCount: number;
  trackStyle?: CSSProperties;
```

add `shrink-0` to the rail cell's class list (`"sticky left-0 z-10 flex min-w-0 shrink-0 items-center pr-2"`), and directly after the rail cell's closing `</div>` (before the band's own closing `</div>`) add the band's track:

```tsx
{
  /* The band's track: same weekend tint and today hairline as an item
          row, so the today line reads as one unbroken rule down the chart. */
}
<div
  data-testid="gantt-section-track"
  className="relative shrink-0"
  style={{ width: totalW, height: ROW_H, ...trackStyle }}
>
  {todayOffset >= 0 && todayOffset <= dayCount && (
    <div
      data-today-line
      className="bg-destructive/30 absolute top-0 h-full w-px"
      style={{ left: todayOffset * dayW }}
      aria-hidden
    />
  )}
</div>;
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/boards/gantt src/components/boards/GanttBoard.test.tsx src/components/boards/GanttBoard.intel.test.tsx src/components/folders/tabs/Timeline.test.tsx`

Expected: PASS, every file.

- [ ] **Step 7: Typecheck and lint**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 8: Hand back**

Report the files changed, the tail of each command's output and any deviation. Say explicitly that the 34% position and the stripe alignment are not proven by these tests and are on the orchestrator's browser list (Task 12). Do not stage, commit or stash.

---

### Task 5: `label_width` in the timeline view config

**Files:**

- Modify: `src/lib/validations/view-actions.ts:1-2`, `:38-48`
- Modify: `src/lib/mcp/tools/describe-schema.ts:121-125`
- Test: `src/lib/validations/view-actions.test.ts`, `src/lib/boards/view-actions.test.ts`

**Interfaces:**

- Consumes: `LABEL_W_MIN`, `LABEL_W_MAX` from `@/components/boards/gantt/utils` (Task 1). A lib file importing from that module has precedent: `src/lib/folders/timeline.ts:18-22` already does. `utils.ts` has no `"use client"` and imports only `@/lib/boards/priority`, so it is safe on the server.
- Produces: `timelineConfigSchema` accepts `label_width?: number` (an integer, 160..520). `updateBoardView` and the MCP `manage_view` tool both validate through `configSchemaForKind` → this schema, so both accept it with no other change. No migration: `board_views.config` is unconstrained `jsonb`.

**Existing tests that change:** none.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("timelineConfigSchema", …)` in `src/lib/validations/view-actions.test.ts`:

```ts
it.each([160, 300, 520])("accepts label_width %i", (label_width) => {
  expect(timelineConfigSchema.safeParse({ label_width }).success).toBe(true);
});

it.each([159, 521, 300.5, "300", null])(
  "rejects label_width %s",
  (label_width) => {
    expect(timelineConfigSchema.safeParse({ label_width }).success).toBe(false);
  },
);
```

In `src/lib/boards/view-actions.test.ts`, directly after the test "rejects an invalid zoom value on a timeline view" (line 206-220), add two tests that reuse that file's existing `from` mock, `updateClient` helper and `VIEW_ID` / `BOARD_ID` constants:

```ts
it("applies a label_width patch on a timeline view", async () => {
  const onUpdate = vi.fn();
  from.mockImplementation(
    updateClient({
      view: { data: { kind: "timeline", board_id: BOARD_ID }, error: null },
      onUpdate,
    }),
  );
  const res = await updateBoardView({
    viewId: VIEW_ID,
    config: { zoom: "month", label_width: 380 },
  });
  expect(res).toEqual({ ok: true, data: undefined });
  expect(onUpdate).toHaveBeenCalledWith({
    config: { zoom: "month", label_width: 380 },
  });
});

it("rejects a label_width outside the rail bounds", async () => {
  const onUpdate = vi.fn();
  from.mockImplementation(
    updateClient({
      view: { data: { kind: "timeline", board_id: BOARD_ID }, error: null },
      onUpdate,
    }),
  );
  const res = await updateBoardView({
    viewId: VIEW_ID,
    config: { label_width: 900 },
  });
  expect(res.ok).toBe(false);
  expect(onUpdate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/lib/validations/view-actions.test.ts src/lib/boards/view-actions.test.ts`

Expected: FAIL. The three "accepts label_width" cases and "applies a label_width patch" fail (`expected false to be true`; `res` is `{ ok: false, … }`) because the schema is `.strict()` and rejects the unknown key. The "rejects" cases already pass for the same reason; they pin the bounds once the key exists.

- [ ] **Step 3: Add the key**

In `src/lib/validations/view-actions.ts` add under the existing `dates` import (line 2):

```ts
import { LABEL_W_MAX, LABEL_W_MIN } from "@/components/boards/gantt/utils";
```

and replace the timeline block (lines 38-48)

```ts
// Timeline config: start date column id, optional end date column id,
// optional color-by column id (status/dropdown), and optional zoom level.
// `.strict()` for the same reason as kanbanConfigSchema above.
export const timelineConfigSchema = z
  .object({
    date_column_id: dateSourceId.nullable().optional(),
    end_column_id: dateSourceId.nullable().optional(),
    color_column_id: z.string().uuid().nullable().optional(),
    zoom: z.enum(["week", "month", "quarter", "year"]).optional(),
  })
  .strict();
```

with

```ts
// Timeline config: start date column id, optional end date column id,
// optional color-by column id (status/dropdown), optional zoom level, and the
// optional width of the name rail in px (an integer inside the rail's drag
// bounds). `.strict()` for the same reason as kanbanConfigSchema above.
export const timelineConfigSchema = z
  .object({
    date_column_id: dateSourceId.nullable().optional(),
    end_column_id: dateSourceId.nullable().optional(),
    color_column_id: z.string().uuid().nullable().optional(),
    zoom: z.enum(["week", "month", "quarter", "year"]).optional(),
    label_width: z.number().int().min(LABEL_W_MIN).max(LABEL_W_MAX).optional(),
  })
  .strict();
```

- [ ] **Step 4: Keep the MCP schema description honest**

In `src/lib/mcp/tools/describe-schema.ts` the timeline entry (lines 121-125) is

```ts
  timeline: {
    settings:
      '{ date_column_id?: string | null, end_column_id?: string | null, color_column_id?: string | null, zoom?: "week" | "month" | "quarter" | "year" }',
    note: 'date_column_id/end_column_id accept a date column id, or the sentinel "__created_at__" / "__updated_at__" to plot the item timestamp instead of a column; color_column_id should be a status or dropdown column.',
  },
```

Replace it with

```ts
  timeline: {
    settings:
      '{ date_column_id?: string | null, end_column_id?: string | null, color_column_id?: string | null, zoom?: "week" | "month" | "quarter" | "year", label_width?: number }',
    note: 'date_column_id/end_column_id accept a date column id, or the sentinel "__created_at__" / "__updated_at__" to plot the item timestamp instead of a column; color_column_id should be a status or dropdown column; label_width is the name rail width in px, an integer from 160 to 520. An update replaces the whole config, so send every key you want to keep.',
  },
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/lib/validations/view-actions.test.ts src/lib/boards/view-actions.test.ts src/lib/mcp/tools/describe-schema.test.ts src/lib/mcp/tools`

Expected: PASS, every file.

- [ ] **Step 6: Typecheck and lint**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 7: Hand back**

Report the files changed, the tail of each command's output and any deviation. Do not stage, commit or stash.

---

### Task 6: Folder timeline — roll-up first, band summaries, rollup join, late-link total

**Files:**

- Modify: `src/lib/folders/timeline.ts` (whole file, 208 lines)
- Modify: `src/components/folders/tabs/TimelineInner.tsx` (`Props` 44, `TimelineInner` 52-78, `FolderTimelineChart` 109-138, late count 171-177, expand state 354-369)
- Modify: `src/components/folders/CommandCenter.tsx:210-215`
- Test: `src/lib/folders/timeline.test.ts` (whole file), `src/components/folders/tabs/Timeline.test.tsx`

**Interfaces:**

- Consumes (Task 2): `GanttRow.summary`, `rangeIncludingToday`, `spanOfRows` from `@/lib/boards/gantt`; `RollupRow` from `@/lib/folders/types`.
- Produces: `buildFolderTimeline(data, opts)` where `opts` is

```ts
{
  stageKey: string | null;
  boardId: string | null;
  expanded: ReadonlySet<string>; // parent items showing sub-items
  zoom: TimelineZoom;
  expandedBoards: ReadonlySet<string>; // default empty = every board closed
  expandedGroups: ReadonlySet<string>; // default empty = every group closed
  rollup?: readonly RollupRow[]; // already filtered by the caller
  todayISO?: string; // tests only; defaults to todayISO()
}
```

`collapsedBoards` is gone. `FolderTimelineView.totals` becomes `{ boards: number; items: number; lateLinks: number }`. Board bands (`board:<id>`, level 0) and group bands (`group:<id>`, level 1) carry `summary` whenever something under them is dated.

- Produces: `TimelineInner` / `TimelineTab` prop `rollup?: readonly RollupRow[]`. `TimelineTab` is `next/dynamic` over `TimelineInner` and infers its props, so `Timeline.tsx` does not change.

**Join key (open item b):** `${boardId}:${groupId}` against `RollupRow.boardId` + `RollupRow.groupId`. A board band sums every rollup row passed for that board. No matching row → `donePct: null, lateCount: null`.

**Existing tests that change** (their new bodies are written out in Step 1):

- `timeline.test.ts`: every test, because `opts` loses `collapsedBoards` and the default is now closed. Rewritten whole.
- `Timeline.test.tsx`: "draws board and group bands and notes a board with no dates" and "zoom and board collapse re-derive locally with no new fetch" assert the open-by-default row list. Eight more tests reach an item row (`canvas().rows.find(...)`, `canEditItem(I1)`, `linkCandidates`, `onMoveBar`, `onResizeBar`), and item rows now exist only after a board and its group are opened; each gets one `openGroup(...)` line.

The new builder was run against the real modules with this file's fixture in a scratch script before the plan was written; the summary columns and totals asserted below are the observed values.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `src/lib/folders/timeline.test.ts` with

```ts
import { describe, expect, it } from "vitest";
import { buildFolderTimeline } from "@/lib/folders/timeline";
import { ALL_ITEMS_KEY } from "@/lib/folders/stages";
import type { FolderTimelineData } from "@/lib/boards/timeline-context";
import type { RollupRow } from "@/lib/folders/types";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const X = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DA = "f0000000-0000-4000-8000-00000000000a";
const DB = "f0000000-0000-4000-8000-00000000000b";

const item = (
  id: string,
  board: string,
  group: string,
  name: string,
  col: string,
  date: string,
) => ({
  id,
  board_id: board,
  group_id: group,
  parent_id: null,
  name,
  position: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  dates: { [col]: { date } },
});

const data: FolderTimelineData = {
  board_order: [A, B],
  boards: [
    {
      id: A,
      name: "Platform",
      can_edit: true,
      date_columns: [{ id: DA, name: "Due" }],
      timeline_config: null,
      groups: [{ id: GA, name: "MVP", color: "#888", position: 0 }],
    },
    {
      id: B,
      name: "Sites",
      can_edit: false,
      date_columns: [{ id: DB, name: "Due" }],
      timeline_config: null,
      groups: [{ id: GB, name: "Pilot", color: "#888", position: 0 }],
    },
    {
      id: X,
      name: "Regulatory",
      can_edit: false,
      date_columns: [],
      timeline_config: null,
      groups: [],
    },
  ],
  items: [
    item("a1", A, GA, "QCC build", DA, "2026-11-10"),
    item("b1", B, GB, "Site survey", DB, "2026-11-05"),
    { ...item("x1", X, GA, "Permit", DA, "2026-11-01"), dates: {} },
  ],
  external_item_ids: ["x1"],
  dependencies: [
    { id: "d1", predecessor_id: "a1", successor_id: "b1" },
    { id: "d2", predecessor_id: "x1", successor_id: "a1" },
  ],
  total_items: 2,
  truncated: false,
};

// The folder opens with everything closed.
const closed = {
  stageKey: null,
  boardId: null,
  expanded: new Set<string>(),
  zoom: "month" as const,
  expandedBoards: new Set<string>(),
  expandedGroups: new Set<string>(),
  todayISO: "2026-11-14",
};
// Every board and group opened, for the tests about item rows.
const opts = {
  ...closed,
  expandedBoards: new Set([A, B]),
  expandedGroups: new Set([GA, GB]),
};
const names = (v: { rows: { name: string }[] }) => v.rows.map((r) => r.name);
const roll = (
  boardId: string,
  groupId: string,
  total: number,
  done: number,
  overdue: number,
) => ({ boardId, groupId, total, done, overdue }) as RollupRow;

describe("buildFolderTimeline — roll-up first", () => {
  it("opens as one band per board", () => {
    expect(names(buildFolderTimeline(data, closed))).toEqual([
      "Platform",
      "Sites",
    ]);
  });
  it("an expanded board shows its group bands, not its items", () => {
    expect(
      names(
        buildFolderTimeline(data, { ...closed, expandedBoards: new Set([A]) }),
      ),
    ).toEqual(["Platform", "MVP", "Sites"]);
  });
  it("an expanded group shows its items", () => {
    expect(
      names(
        buildFolderTimeline(data, {
          ...closed,
          expandedBoards: new Set([A]),
          expandedGroups: new Set([GA]),
        }),
      ),
    ).toEqual(["Platform", "MVP", "QCC build", "Sites"]);
  });
  it("gives closed bands the span of what is under them", () => {
    // Range starts at today − 14 = 2026-10-31, so 11-10 is day 10, 11-05 day 5.
    const v = buildFolderTimeline(data, closed);
    expect(v.rangeStartISO).toBe("2026-10-31");
    expect(v.rows.map((r) => r.summary)).toEqual([
      { startCol: 10, spanCols: 1, donePct: null, lateCount: null },
      { startCol: 5, spanCols: 1, donePct: null, lateCount: null },
    ]);
  });
  it("joins rollup rows by board id and group id", () => {
    const v = buildFolderTimeline(data, {
      ...opts,
      rollup: [roll(A, GA, 20, 7, 8)],
    });
    const band = (id: string) => v.rows.find((r) => r.itemId === id)?.summary;
    expect(band(`board:${A}`)).toMatchObject({ donePct: 35, lateCount: 8 });
    expect(band(`group:${GA}`)).toMatchObject({ donePct: 35, lateCount: 8 });
    // No rollup row for this board or group: span only, no fill.
    expect(band(`board:${B}`)).toMatchObject({
      donePct: null,
      lateCount: null,
    });
    expect(band(`group:${GB}`)).toMatchObject({
      donePct: null,
      lateCount: null,
    });
  });
  it("sums a board band over every rollup row passed for that board", () => {
    const v = buildFolderTimeline(data, {
      ...closed,
      rollup: [roll(A, GA, 10, 2, 1), roll(A, "other-group", 10, 8, 2)],
    });
    expect(v.rows[0]!.summary).toMatchObject({ donePct: 50, lateCount: 3 });
  });
  it("gives an empty rollup group no percentage", () => {
    const v = buildFolderTimeline(data, {
      ...closed,
      rollup: [roll(A, GA, 0, 0, 0)],
    });
    expect(v.rows[0]!.summary).toMatchObject({ donePct: null, lateCount: 0 });
  });
  it("counts late links while every board is closed", () => {
    const v = buildFolderTimeline(data, closed);
    expect(v.dependencies).toEqual([]);
    expect(v.violations.size).toBe(0);
    // d1: b1 starts 11-05, before a1 ends 11-10.
    expect(v.totals.lateLinks).toBe(1);
  });
  it("widens the range to include today even when all dates are old", () => {
    const old = {
      ...data,
      items: data.items.map((i) =>
        i.id === "a1" ? { ...i, dates: { [DA]: { date: "2026-02-03" } } } : i,
      ),
    };
    const v = buildFolderTimeline(old, closed);
    expect(v.rangeStartISO).toBe("2026-02-03");
    // 2026-02-03 → 2026-12-14 (today + 30) inclusive, + 3 days of padding.
    expect(v.dayCount).toBe(318);
  });
});

describe("buildFolderTimeline — opened", () => {
  it("emits board bands, group bands and items in folder order", () => {
    const v = buildFolderTimeline(data, opts);
    expect(v.rows.map((r) => `${r.kind ?? "item"}:${r.name}`)).toEqual([
      "section:Platform",
      "section:MVP",
      "item:QCC build",
      "section:Sites",
      "section:Pilot",
      "item:Site survey",
    ]);
  });
  it("draws in-folder links as arrows and flags the late one", () => {
    const v = buildFolderTimeline(data, opts);
    expect(v.dependencies.map((d) => d.id)).toEqual(["d1"]);
    expect(v.violations.has("d1")).toBe(true); // b1 starts 11-05, before a1 ends 11-10
    expect(v.totals.lateLinks).toBe(1);
  });
  it("turns links to external items into stubs", () => {
    const v = buildFolderTimeline(data, opts);
    expect(v.externalLinks.get("a1")?.[0]).toMatchObject({
      itemName: "Permit",
      boardName: "Regulatory",
      direction: "waiting_on",
    });
  });
  it("filters by stage (group name) and board", () => {
    expect(
      names(buildFolderTimeline(data, { ...opts, stageKey: "pilot" })),
    ).toEqual(["Sites", "Pilot", "Site survey"]);
    expect(names(buildFolderTimeline(data, { ...opts, boardId: A }))).toEqual([
      "Platform",
      "MVP",
      "QCC build",
    ]);
  });
  it("treats the all-items stage as no stage filter", () => {
    expect(
      buildFolderTimeline(data, { ...opts, stageKey: ALL_ITEMS_KEY }).rows,
    ).toEqual(buildFolderTimeline(data, opts).rows);
  });
  it("counts boards and items independently of what is open", () => {
    expect(buildFolderTimeline(data, opts).totals).toMatchObject({
      boards: 2,
      items: 2,
    });
    expect(buildFolderTimeline(data, closed).totals).toMatchObject({
      boards: 2,
      items: 2,
    });
    expect(
      buildFolderTimeline(data, { ...opts, boardId: A }).totals,
    ).toMatchObject({ boards: 1, items: 1 });
  });
  it("still notes a closed board with no dates, and gives it no summary", () => {
    const undated = {
      ...data,
      items: data.items.map((i) =>
        i.board_id === B ? { ...i, dates: {} } : i,
      ),
    };
    const v = buildFolderTimeline(undated, closed);
    expect(v.noDateBoards.has(B)).toBe(true);
    expect(
      v.rows.find((r) => r.itemId === `board:${B}`)?.summary,
    ).toBeUndefined();
  });
  it("keeps undated leaves off the chart and notes boards with no dates", () => {
    const v = buildFolderTimeline(
      {
        ...data,
        boards: data.boards.map((b) =>
          b.id === B ? { ...b, date_columns: [] } : b,
        ),
        items: [
          ...data.items,
          { ...item("a2", A, GA, "Undated", DA, "2026-11-01"), dates: {} },
        ],
      },
      opts,
    );
    expect(names(v)).toEqual(["Platform", "MVP", "QCC build", "Sites"]);
    expect([...v.noDateBoards]).toEqual([B]);
    expect(v.boardOfItem.get("a1")).toBe(A);
    expect(v.boardOfItem.has("a2")).toBe(false);
  });
  it("turns a link to a filtered-out board into a stub", () => {
    const v = buildFolderTimeline(data, { ...opts, boardId: B });
    expect(v.dependencies).toEqual([]);
    expect(v.externalLinks.get("b1")?.[0]).toMatchObject({
      itemName: "QCC build",
      boardName: "Platform",
      direction: "waiting_on",
      late: true,
    });
    expect(v.totals.lateLinks).toBe(1);
  });
});
```

In `src/components/folders/tabs/Timeline.test.tsx`:

1. Add `import type { RollupRow } from "@/lib/folders/types";` under the `FolderTimelineData` import.
2. Replace the `renderTab` helper (lines 117-127) and add `openGroup` under the `canvas` helper:

```tsx
const renderTab = (rollup?: RollupRow[]) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TimelineInner folderId="f1" stage={null} board={null} rollup={rollup} />
    </QueryClientProvider>,
  );
  return client;
};
```

```tsx
/** Roll-up first: item rows exist only once a board and its group are open. */
const openGroup = (boardId: string, groupId: string) => {
  act(() => canvas().onToggleExpand?.(`board:${boardId}`));
  act(() => canvas().onToggleExpand?.(`group:${groupId}`));
};
const canvasText = () => screen.getByTestId("canvas").textContent;
```

3. Replace the test "draws board and group bands and notes a board with no dates" (lines 161-171) with

```tsx
it("opens as one row per board and drills down board → group → items", async () => {
  m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
  renderTab();
  await screen.findByTestId("canvas");
  expect(canvasText()).toBe("Platform|Sites · No dates on this board");
  expect(canvas().isExpanded?.(`board:${A}`)).toBe(false);
  act(() => canvas().onToggleExpand?.(`board:${A}`));
  expect(canvasText()).toBe("Platform|MVP|Sites · No dates on this board");
  expect(canvas().isExpanded?.(`board:${A}`)).toBe(true);
  expect(canvas().isExpanded?.(`group:${GA}`)).toBe(false);
  act(() => canvas().onToggleExpand?.(`group:${GA}`));
  expect(canvasText()).toBe(
    "Platform|MVP|QCC build|Bench test|Sites · No dates on this board",
  );
  expect(canvas().isExpanded?.(`group:${GA}`)).toBe(true);
  // Bars take their group's colour; edits only where the board allows.
  const qcc = canvas().rows.find((r) => r.name === "QCC build")!;
  expect(canvas().colorFor(qcc)).toBe("#579bfc");
  expect(canvas().canEditItem(I1)).toBe(true);
});
```

4. Replace the test "zoom and board collapse re-derive locally with no new fetch" (lines 173-189) with

```tsx
it("zoom, expand and collapse re-derive locally with no new fetch", async () => {
  m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
  renderTab();
  await screen.findByTestId("canvas");
  expect(screen.getByText(/2 boards · 2 items/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Week" }));
  expect(canvas().zoom).toBe("week");
  openGroup(A, GA);
  expect(canvasText()).toBe(
    "Platform|MVP|QCC build|Bench test|Sites · No dates on this board",
  );
  act(() => canvas().onToggleExpand?.(`board:${A}`));
  expect(canvasText()).toBe("Platform|Sites · No dates on this board");
  // Reopening the board finds its group still open.
  act(() => canvas().onToggleExpand?.(`board:${A}`));
  expect(canvasText()).toBe(
    "Platform|MVP|QCC build|Bench test|Sites · No dates on this board",
  );
  // The header counts the data, not the rows left visible.
  expect(screen.getByText(/2 boards · 2 items/)).toBeInTheDocument();
  expect(m.getFolderTimeline).toHaveBeenCalledTimes(1);
});
```

5. In each of these tests add the line `openGroup(A, GA);` directly after its `await screen.findByTestId("canvas");`:
   - "moves a bar optimistically through upsertCell, without a refresh"
   - "rolls a failed write back and says why"
   - "offers in-view items as link candidates and opens items on their board"
   - "leaves existing predecessors out of the link picker"
   - "resizes a bar through its board's date cell"
   - "a failed write does not undo a newer drag of the same bar"

6. In "offers no links and no edits on a board the viewer can only read" replace

```tsx
renderTab();
expect(await screen.findByTestId("canvas")).toHaveTextContent("Site survey");
```

with

```tsx
renderTab();
await screen.findByTestId("canvas");
openGroup(A, GA);
openGroup(B, GB);
expect(screen.getByTestId("canvas")).toHaveTextContent("Site survey");
```

7. Add two tests at the end of `describe("TimelineInner", …)`:

```tsx
it("puts the rollup's progress on board and group bands", async () => {
  m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
  renderTab([
    { boardId: A, groupId: GA, total: 20, done: 7, overdue: 8 } as RollupRow,
  ]);
  await screen.findByTestId("canvas");
  const band = (id: string) =>
    canvas().rows.find((r) => r.itemId === id)?.summary;
  expect(band(`board:${A}`)).toMatchObject({ donePct: 35, lateCount: 8 });
  act(() => canvas().onToggleExpand?.(`board:${A}`));
  expect(band(`group:${GA}`)).toMatchObject({ donePct: 35, lateCount: 8 });
  // A board with nothing dated draws no summary bar at all.
  expect(band(`board:${B}`)).toBeUndefined();
});

it("counts late links while every board is still closed", async () => {
  m.getFolderTimeline.mockResolvedValueOnce({
    ok: true,
    data: {
      ...data,
      // I1 (11-10) is meant to start after I2 ends (11-12): late.
      dependencies: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          predecessor_id: I2,
          successor_id: I1,
        },
      ],
    },
  });
  renderTab();
  await screen.findByTestId("canvas");
  expect(canvasText()).toBe("Platform|Sites · No dates on this board");
  expect(screen.getByText("1 late link")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/lib/folders/timeline.test.ts src/components/folders/tabs/Timeline.test.tsx`

Expected: FAIL. `timeline.test.ts`: today's builder reads `opts.collapsedBoards.has(boardId)`, and the new options no longer carry `collapsedBoards`, so every test that reaches a board throws `Cannot read properties of undefined (reading 'has')`. `Timeline.test.tsx`: the drill-down test fails on `expected "Platform|MVP|QCC build|Bench test|Sites · No dates on this board" to be "Platform|Sites · No dates on this board"`, and the rollup and late-link tests fail on a missing `summary` / missing "1 late link".

- [ ] **Step 3: Rewrite the builder**

Replace the whole of `src/lib/folders/timeline.ts` with

```ts
import type { CacheItem } from "@/lib/boards/cache";
import {
  crossBoardStubs,
  type ExternalLinkStub,
} from "@/lib/boards/cross-board";
import {
  isSyntheticDateSource,
  syntheticDateCellValues,
} from "@/lib/boards/dates";
import {
  buildGanttRows,
  detectViolations,
  rangeIncludingToday,
  spanOfRows,
  timelineDayCount,
  visibleRows,
  type GanttDependency,
  type GanttRow,
} from "@/lib/boards/gantt";
import {
  ZOOM_DAY_COUNT,
  todayISO,
  type TimelineZoom,
} from "@/components/boards/gantt/utils";
import {
  boardScheduleOf,
  contextCellValues,
  contextSpans,
  type FolderTimelineData,
  type TimelineItem,
} from "@/lib/boards/timeline-context";
import { ALL_ITEMS_KEY, stageKey } from "@/lib/folders/stages";
import type { RollupRow } from "@/lib/folders/types";

/** TanStack Query key for the folder Timeline tab's one payload. */
export const folderTimelineKey = (folderId: string) =>
  ["folder-timeline", folderId] as const;

export type FolderTimelineView = {
  rows: GanttRow[];
  dependencies: GanttDependency[];
  externalLinks: Map<string, ExternalLinkStub[]>;
  violations: Set<string>;
  rangeStartISO: string;
  dayCount: number;
  /** Item id → board id, for every item row in view. */
  boardOfItem: Map<string, string>;
  /** Boards shown as a band with nothing dated under it. */
  noDateBoards: Set<string>;
  /** Boards / items / late links on the chart under the current filters —
   * independent of which boards, groups or parents are open, so the header
   * doesn't jump and a closed folder still reports its late links. */
  totals: { boards: number; items: number; lateLinks: number };
};

type Counts = { total: number; done: number; overdue: number };

/** A band's progress from the folder rollup; unknown when no row matched. */
function progressOf(c: Counts | undefined): {
  donePct: number | null;
  lateCount: number | null;
} {
  if (!c) return { donePct: null, lateCount: null };
  return {
    donePct: c.total > 0 ? Math.round((c.done / c.total) * 100) : null,
    lateCount: c.overdue,
  };
}

/**
 * Lay a folder's boards out on one timeline, roll-up first: a band per board
 * (folder order); under an EXPANDED board a band per group; under an EXPANDED
 * group that group's scheduled items — each board read through its own date
 * sources. Every band carries a summary (the span of what is under it, plus
 * progress joined from the folder rollup by board id + group id), computed
 * whether or not the band is open. Links with both ends in view become arrows;
 * links to anything else become stubs on the local bar. Pure, so every zoom /
 * filter / expand toggle is a re-derive with no server round-trip.
 */
export function buildFolderTimeline(
  data: FolderTimelineData,
  opts: {
    stageKey: string | null;
    boardId: string | null;
    /** Parent items whose sub-items are shown. */
    expanded: ReadonlySet<string>;
    zoom: TimelineZoom;
    /** Boards showing their group bands. Empty = the roll-up view. */
    expandedBoards: ReadonlySet<string>;
    /** Groups showing their items. */
    expandedGroups: ReadonlySet<string>;
    /** Folder rollup rows, already filtered by stage/board by the caller. */
    rollup?: readonly RollupRow[];
    /** Injected in tests; defaults to the viewer's today. */
    todayISO?: string;
  },
): FolderTimelineView {
  const boards = new Map(data.boards.map((b) => [b.id, b]));
  const external = new Set(data.external_item_ids);
  const local = data.items.filter((i) => !external.has(i.id));
  const spans = contextSpans({ boards: data.boards, items: data.items });

  // One shared axis for every board: earliest local start to latest local
  // end, widened so today (− 14 / + 30 days) is always on the grid, and never
  // narrower than the zoom window.
  let min: string | null = null;
  let max: string | null = null;
  for (const it of local) {
    const s = spans.get(it.id);
    if (!s) continue;
    if (min === null || s.start < min) min = s.start;
    if (max === null || s.end > max) max = s.end;
  }
  const range = rangeIncludingToday(min, max, opts.todayISO ?? todayISO());
  const rangeStartISO = range.startISO;
  const dayCount = timelineDayCount(
    rangeStartISO,
    range.endISO,
    ZOOM_DAY_COUNT[opts.zoom],
  );

  // Bucket once: zoom / expand / collapse re-derive this on every toggle.
  const byGroup = new Map<string, TimelineItem[]>();
  for (const it of local) {
    const k = `${it.board_id}:${it.group_id}`;
    const list = byGroup.get(k);
    if (list) list.push(it);
    else byGroup.set(k, [it]);
  }

  // Rollup rows are one per board × group. Key them the way items are keyed
  // (board id + group id); a board band sums every row passed for its board.
  const groupCounts = new Map<string, Counts>();
  const boardCounts = new Map<string, Counts>();
  for (const r of opts.rollup ?? []) {
    if (r.groupId !== null)
      groupCounts.set(`${r.boardId}:${r.groupId}`, {
        total: r.total,
        done: r.done,
        overdue: r.overdue,
      });
    const b = boardCounts.get(r.boardId) ?? { total: 0, done: 0, overdue: 0 };
    boardCounts.set(r.boardId, {
      total: b.total + r.total,
      done: b.done + r.done,
      overdue: b.overdue + r.overdue,
    });
  }

  const stageFilter = opts.stageKey === ALL_ITEMS_KEY ? null : opts.stageKey;
  const rows: GanttRow[] = [];
  let totalBoards = 0;
  let totalItems = 0;
  const boardOfItem = new Map<string, string>();
  const noDateBoards = new Set<string>();
  // Every row on the chart under the current filters, open or not.
  const chartedRows: GanttRow[] = [];
  for (const boardId of data.board_order) {
    if (opts.boardId && boardId !== opts.boardId) continue;
    const board = boards.get(boardId);
    if (!board) continue;
    // Stage keys are group names. The synthetic ALL_ITEMS_KEY ("__all__") is
    // the folder's one stage when nothing is grouped — i.e. "everything",
    // the same as no stage filter.
    const groups = board.groups
      .filter((g) => stageFilter === null || stageKey(g.name) === stageFilter)
      .sort((a, b) => a.position - b.position);
    if (groups.length === 0) continue;
    const boardBand: GanttRow = {
      itemId: `board:${boardId}`,
      name: board.name,
      scheduled: false,
      kind: "section",
      level: 0,
    };
    rows.push(boardBand);
    totalBoards++;
    // A closed board is still laid out (for the totals, its summary and its
    // "no dates" note); its group bands just aren't emitted.
    const boardOpen = opts.expandedBoards.has(boardId);
    const schedule = boardScheduleOf(board);
    if (!schedule.startSourceId) {
      noDateBoards.add(boardId);
      continue;
    }
    const synthetic = [schedule.startSourceId, schedule.endSourceId].filter(
      (id): id is string => isSyntheticDateSource(id),
    );
    const boardRows: GanttRow[] = [];
    for (const g of groups) {
      const groupItems = byGroup.get(`${boardId}:${g.id}`) ?? [];
      if (groupItems.length === 0) continue;
      // buildGanttRows reads id / name / parent_id / position (+ the
      // timestamps for synthetic sources) — all present on a TimelineItem.
      const cacheItems = groupItems as unknown as CacheItem[];
      const cells = [
        ...contextCellValues(groupItems),
        ...(synthetic.length
          ? syntheticDateCellValues(cacheItems, synthetic)
          : []),
      ];
      const built = buildGanttRows(
        cacheItems,
        cells,
        schedule.startSourceId,
        schedule.endSourceId,
        rangeStartISO,
        dayCount,
        opts.zoom,
      ).rows;
      // Same rule as the board Gantt: dated items, plus undated parents that
      // carry a dated sub-item. Undated leaves stay off the folder chart.
      const onTimeline = built.filter((r) => r.scheduled || r.hasChildren);
      if (onTimeline.length === 0) continue;
      totalItems += onTimeline.length;
      boardRows.push(...onTimeline);
      if (!boardOpen) continue;
      const groupBand: GanttRow = {
        itemId: `group:${g.id}`,
        name: g.name,
        scheduled: false,
        kind: "section",
        level: 1,
      };
      const groupSpan = spanOfRows(onTimeline);
      if (groupSpan)
        groupBand.summary = {
          ...groupSpan,
          ...progressOf(groupCounts.get(`${boardId}:${g.id}`)),
        };
      rows.push(groupBand);
      if (!opts.expandedGroups.has(g.id)) continue;
      for (const r of visibleRows(onTimeline, opts.expanded)) {
        rows.push(r);
        boardOfItem.set(r.itemId, boardId);
      }
    }
    if (boardRows.length === 0) {
      noDateBoards.add(boardId);
      continue;
    }
    chartedRows.push(...boardRows);
    const boardSpan = spanOfRows(boardRows);
    if (boardSpan)
      boardBand.summary = {
        ...boardSpan,
        ...progressOf(boardCounts.get(boardId)),
      };
  }

  const inView = new Set(boardOfItem.keys());
  const dependencies = data.dependencies.filter(
    (d) => inView.has(d.predecessor_id) && inView.has(d.successor_id),
  );
  const itemRows = rows.filter((r) => r.kind !== "section");
  const violations = detectViolations(itemRows, dependencies);
  const externalItems: TimelineItem[] = data.items.filter(
    (i) => !inView.has(i.id),
  );
  const externalLinks = crossBoardStubs({
    dependencies: data.dependencies,
    localItemIds: inView,
    localSpans: spans,
    context: { boards: data.boards, items: externalItems },
    contextSpans: spans,
  });

  // Late links over everything charted, NOT just what is in view: with every
  // board closed there are no item rows, and the header must still say how
  // many links are late. Same two rules as above (detectViolations for links
  // inside the chart, a late stub for links leaving it), keyed by link id.
  const charted = new Set(chartedRows.map((r) => r.itemId));
  const lateLinks = detectViolations(
    chartedRows,
    data.dependencies.filter(
      (d) => charted.has(d.predecessor_id) && charted.has(d.successor_id),
    ),
  );
  const offChart = crossBoardStubs({
    dependencies: data.dependencies,
    localItemIds: charted,
    localSpans: spans,
    context: {
      boards: data.boards,
      items: data.items.filter((i) => !charted.has(i.id)),
    },
    contextSpans: spans,
  });
  for (const stubs of offChart.values())
    for (const s of stubs) if (s.late) lateLinks.add(s.dependencyId);

  return {
    rows,
    dependencies,
    externalLinks,
    violations,
    rangeStartISO,
    dayCount,
    boardOfItem,
    noDateBoards,
    totals: {
      boards: totalBoards,
      items: totalItems,
      lateLinks: lateLinks.size,
    },
  };
}
```

- [ ] **Step 4: Switch the tab to roll-up state**

In `src/components/folders/tabs/TimelineInner.tsx`:

1. Add under the `timeline` import (line 28): `import type { RollupRow } from "@/lib/folders/types";`
2. Line 44 `type Props = { folderId: string; stage: string | null; board: string | null };` becomes

```tsx
type Props = {
  folderId: string;
  stage: string | null;
  board: string | null;
  /** The Command Center's rollup rows under the same stage/board filter —
   * the source of each band's "% done · N late". */
  rollup?: readonly RollupRow[];
};
```

3. `export function TimelineInner({ folderId, stage, board }: Props) {` becomes `export function TimelineInner({ folderId, stage, board, rollup }: Props) {`, and the `<FolderTimelineChart … />` it returns gets `rollup={rollup}` after `board={board}`.
4. `FolderTimelineChart`'s parameter list and type (lines 109-119) gain `rollup,` and `rollup?: readonly RollupRow[];`.
5. Lines 122-138 are

```tsx
const [zoom, setZoom] = useState<TimelineZoom>("month");
const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
const [collapsedBoards, setCollapsedBoards] = useState<ReadonlySet<string>>(
  new Set(),
);

const view = useMemo(
  () =>
    buildFolderTimeline(data, {
      stageKey: stage,
      boardId: board,
      expanded,
      zoom,
      collapsedBoards,
    }),
  [data, stage, board, expanded, zoom, collapsedBoards],
);
```

Replace them with

```tsx
const [zoom, setZoom] = useState<TimelineZoom>("month");
const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
// Roll-up first: both sets start empty, so the chart opens as one row per
// board. Deliberately not persisted.
const [expandedBoards, setExpandedBoards] = useState<ReadonlySet<string>>(
  new Set(),
);
const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
  new Set(),
);

const view = useMemo(
  () =>
    buildFolderTimeline(data, {
      stageKey: stage,
      boardId: board,
      expanded,
      zoom,
      expandedBoards,
      expandedGroups,
      rollup,
    }),
  [data, stage, board, expanded, zoom, expandedBoards, expandedGroups, rollup],
);
```

6. Lines 171-177 are

```tsx
// Late links: in-view arrows that break finish-to-start, plus late stubs.
const lateCount = useMemo(() => {
  const late = new Set(view.violations);
  for (const stubs of view.externalLinks.values())
    for (const s of stubs) if (s.late) late.add(s.dependencyId);
  return late.size;
}, [view.violations, view.externalLinks]);
```

Replace them with

```tsx
// Late links across everything charted — independent of what is open.
const lateCount = view.totals.lateLinks;
```

7. Lines 354-369 are

```tsx
function isExpanded(id: string): boolean {
  if (id.startsWith("board:"))
    return !collapsedBoards.has(id.slice("board:".length));
  return expanded.has(id);
}
function toggle(id: string) {
  const flip = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  if (id.startsWith("board:"))
    setCollapsedBoards((s) => flip(s, id.slice("board:".length)));
  else setExpanded((s) => flip(s, id));
}
```

Replace them with

```tsx
function isExpanded(id: string): boolean {
  if (id.startsWith("board:"))
    return expandedBoards.has(id.slice("board:".length));
  if (id.startsWith("group:"))
    return expandedGroups.has(id.slice("group:".length));
  return expanded.has(id);
}
function toggle(id: string) {
  const flip = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  if (id.startsWith("board:"))
    setExpandedBoards((s) => flip(s, id.slice("board:".length)));
  else if (id.startsWith("group:"))
    setExpandedGroups((s) => flip(s, id.slice("group:".length)));
  else setExpanded((s) => flip(s, id));
}
```

The `{ boards: boardCount, items: itemCount } = view.totals` destructure on line 371 keeps working.

- [ ] **Step 5: Pass the rollup rows from the Command Center**

In `src/components/folders/CommandCenter.tsx` lines 210-215 are

```tsx
          ) : activeTab?.kind === "timeline" ? (
            <TimelineTab
              folderId={payload.folder.id}
              stage={stage}
              board={board}
            />
```

Replace them with

```tsx
          ) : activeTab?.kind === "timeline" ? (
            <TimelineTab
              folderId={payload.folder.id}
              stage={stage}
              board={board}
              rollup={rows}
            />
```

`rows` is the memoized, stage- and board-filtered rollup from line 84. No new import: `CommandCenter` still reaches the timeline only through the `next/dynamic` wrapper, so the first-paint guard holds.

- [ ] **Step 6: Run the tests and see them pass**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/lib/folders/timeline.test.ts src/components/folders/tabs/Timeline.test.tsx src/components/folders/CommandCenter.test.tsx src/components/folders/no-gantt-in-first-paint.test.ts`

Expected: PASS, every file.

- [ ] **Step 7: Typecheck and lint**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 8: Hand back**

Report the files changed, the tail of each command's output and any deviation. Note in the report that, until Task 9 lands, the real canvas shows group bands without a toggle. Do not stage, commit or stash.

---

### Task 7: Canvas — labels beside short bars, late bars

**Files:**

- Create: `src/lib/text-measure.ts`
- Create test: `src/lib/text-measure.test.ts`
- Modify: `src/components/boards/table/shared.ts:247-251`
- Modify: `src/components/boards/table/BoardTableInner.tsx:84-91`, `:434-462`
- Modify: `src/components/boards/gantt/utils.ts` (append helpers)
- Modify: `src/components/boards/gantt/GanttCanvas.tsx` (props, one memo, `GanttRowItem` call site)
- Modify: `src/components/boards/gantt/GanttRowItem.tsx` (props, bar and milestone markup originally at 404-519)
- Test: `src/components/boards/gantt/utils.test.ts`, `src/components/boards/gantt/GanttCanvas.test.tsx`

**Interfaces:**

- Consumes: `buildNameMeasureFont`'s behaviour (kept identical); Task 4's canvas.
- Produces, in `src/lib/text-measure.ts`:

```ts
export function buildMeasureFont(
  fontInterVar: string,
  weight: string,
  size: string,
): string;
/** Returns a measurer; it returns 0 for every string where there is no canvas. */
export function createTextMeasurer(
  weight: string,
  size: string,
): (text: string) => number;
```

- Produces, in `gantt/utils.ts`:

```ts
export const BAR_LABEL_PAD = 16;
export const BAR_RESIZE_W = 8;
export const OUTSIDE_LABEL_GAP = 6;
export function barLabelFits(
  barWidthPx: number,
  textWidthPx: number,
  editable: boolean,
): boolean;
export function formatShortDay(iso: string): string; // "Oct 24"
export function outsideBarLabel(a: {
  lateDays: number | null;
  insideFits: boolean;
  isMilestone: boolean;
  endISO: string | undefined;
}): { text: string; late: boolean } | null;
export function outsideLabelSide(a: {
  barStartX: number;
  barEndX: number;
  trackW: number;
  labelW: number;
  afterTaken: boolean;
  beforeTaken: boolean;
}): "after" | "before" | null;
```

- Produces: `GanttCanvasProps.lateFor?: (row: GanttRow) => number | null` (days late, or null). `GanttRowItem` props `lateDays?: number | null` and `measureLabel?: (text: string) => number`. DOM hook `data-testid="gantt-bar-meta"` on the label beside a bar.

**Rules implemented:**

- The name stays inside the bar when it fits: measured name width + 16px padding (+ 8px resize strip on an editable bar) ≤ bar width. An unmeasured name (width 0: no canvas, as in jsdom or SSR) counts as fitting, which keeps today's CSS-truncated label.
- When it does not fit, the name is dropped from the bar and the end date ("Oct 24") is drawn beside it. A milestone has no inside label, so it always gets the date.
- A late item (`lateFor` returns a number) gets a 1px `border-destructive` on its bar or diamond and "Nd late" beside it, in `text-destructive`, whether or not its name fits. The label carries the word "late", so the state is never colour alone.
- The label goes after the bar; if cross-board link stubs already sit there or it would clip the track, before the bar; otherwise it is not drawn. It is hidden while the bar is being dragged.

**Existing tests that change:** none. In every existing suite the canvas is unmeasured (jsdom has no canvas → every width is 0 → every name "fits") and `lateFor` is not passed, so `getAllByText("PO raised")` still finds the rail name and the bar label.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/text-measure.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMeasureFont, createTextMeasurer } from "@/lib/text-measure";

afterEach(() => vi.restoreAllMocks());

describe("buildMeasureFont", () => {
  it("uses the live font family when the variable is set", () => {
    expect(buildMeasureFont("'__Inter_1a2b3c'", "500", "11px")).toBe(
      "500 11px '__Inter_1a2b3c', ui-sans-serif, system-ui, sans-serif",
    );
  });
  it("falls back to the Inter literal when the variable is empty", () => {
    expect(buildMeasureFont("  ", "500", "13.5px")).toBe(
      "500 13.5px Inter, ui-sans-serif, system-ui, sans-serif",
    );
  });
});

describe("createTextMeasurer", () => {
  it("measures 0 where there is no canvas", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(createTextMeasurer("500", "11px")("abc")).toBe(0);
  });
  it("measures through the canvas context at the requested font", () => {
    const ctx = {
      font: "",
      measureText: (t: string) => ({ width: t.length * 7 }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as never,
    );
    const measure = createTextMeasurer("500", "11px");
    expect(measure("abcd")).toBe(28);
    expect(ctx.font).toBe(
      "500 11px Inter, ui-sans-serif, system-ui, sans-serif",
    );
  });
});
```

Append to `src/components/boards/gantt/utils.test.ts` (add the five names to the import):

```ts
describe("barLabelFits", () => {
  it("needs the text plus padding, plus the resize strip on an editable bar", () => {
    expect(barLabelFits(80, 64, false)).toBe(true); // 64 + 16
    expect(barLabelFits(80, 64, true)).toBe(false); // 64 + 16 + 8
    expect(barLabelFits(88, 64, true)).toBe(true);
  });
  it("treats an unmeasured name as fitting", () => {
    expect(barLabelFits(6, 0, true)).toBe(true);
  });
});

describe("formatShortDay", () => {
  it("prints month and day without drifting across time zones", () => {
    expect(formatShortDay("2026-10-24")).toBe("Oct 24");
    expect(formatShortDay("2026-01-01")).toBe("Jan 1");
  });
});

describe("outsideBarLabel", () => {
  const base = {
    lateDays: null,
    insideFits: true,
    isMilestone: false,
    endISO: "2026-10-24",
  };
  it("is nothing when the name fits and the item is on time", () => {
    expect(outsideBarLabel(base)).toBeNull();
  });
  it("is the end date when the name does not fit", () => {
    expect(outsideBarLabel({ ...base, insideFits: false })).toEqual({
      text: "Oct 24",
      late: false,
    });
  });
  it("is the date for a milestone, which has no inside label", () => {
    expect(outsideBarLabel({ ...base, isMilestone: true })?.text).toBe(
      "Oct 24",
    );
  });
  it("is 'Nd late' for a late item, even when the name fits", () => {
    expect(outsideBarLabel({ ...base, lateDays: 21 })).toEqual({
      text: "21d late",
      late: true,
    });
  });
});

describe("outsideLabelSide", () => {
  const base = {
    barStartX: 100,
    barEndX: 150,
    trackW: 300,
    labelW: 40,
    afterTaken: false,
    beforeTaken: false,
  };
  it("prefers the space after the bar", () => {
    expect(outsideLabelSide(base)).toBe("after");
  });
  it("goes before the bar when stubs hold the after side or it would clip", () => {
    expect(outsideLabelSide({ ...base, afterTaken: true })).toBe("before");
    expect(outsideLabelSide({ ...base, barEndX: 280 })).toBe("before");
  });
  it("is not drawn when neither side has room", () => {
    expect(
      outsideLabelSide({ ...base, barStartX: 10, barEndX: 290 }),
    ).toBeNull();
    expect(
      outsideLabelSide({ ...base, afterTaken: true, beforeTaken: true }),
    ).toBeNull();
  });
});
```

In `src/components/boards/gantt/GanttCanvas.test.tsx` change the vitest import to `import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";` and append:

```tsx
describe("GanttCanvas bar labels", () => {
  // jsdom has no canvas. Stand in a measurer of 7px per character so the fit
  // decision is exercised; "PO raised" is 63px, "Delivery" 56px.
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (t: string) => ({ width: t.length * 7 }),
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  const firstRow = () => screen.getAllByTestId("gantt-row")[0]!;

  it("drops a name that does not fit and shows the end date beside the bar", () => {
    render(<GanttCanvas {...props()} />);
    // i1 is 5 days × 10px = 50px; the name needs 63 + 16 + 8. Rail only now.
    expect(screen.getAllByText("PO raised")).toHaveLength(1);
    const meta = within(firstRow()).getByTestId("gantt-bar-meta");
    expect(meta).toHaveTextContent("Nov 5");
    expect(meta).toHaveStyle({ left: "56px" }); // bar end 50 + 6px gap
    expect(meta).toHaveClass("text-muted-foreground");
    // The bar still names itself to assistive tech.
    expect(screen.getByLabelText("PO raised")).toBeInTheDocument();
  });

  it("keeps the name inside a bar that is wide enough", () => {
    const wide: GanttRow[] = [
      { ...rows[1]!, spanCols: 20, endISO: "2026-11-20" },
    ];
    render(<GanttCanvas {...props({ rows: wide, dependencies: [] })} />);
    expect(screen.getAllByText("PO raised")).toHaveLength(2);
    expect(screen.queryByTestId("gantt-bar-meta")).not.toBeInTheDocument();
  });

  it("marks a late bar with the destructive border and an 'Nd late' label", () => {
    render(
      <GanttCanvas
        {...props({ lateFor: (r) => (r.itemId === "i1" ? 21 : null) })}
      />,
    );
    const bar = screen.getByLabelText("PO raised").parentElement as HTMLElement;
    expect(bar).toHaveClass("border", "border-destructive");
    const meta = within(firstRow()).getByTestId("gantt-bar-meta");
    expect(meta).toHaveTextContent("21d late");
    expect(meta).toHaveClass("text-destructive");
    // Its on-time neighbour is untouched.
    expect(screen.getByLabelText("Delivery").parentElement).not.toHaveClass(
      "border-destructive",
    );
  });

  it("gives a late milestone the border and the label too", () => {
    const dot: GanttRow[] = [
      {
        itemId: "m1",
        name: "Gate",
        scheduled: true,
        isMilestone: true,
        startCol: 10,
        spanCols: 1,
        startISO: "2026-11-11",
        endISO: "2026-11-11",
      },
    ];
    render(
      <GanttCanvas
        {...props({ rows: dot, dependencies: [], lateFor: () => 3 })}
      />,
    );
    expect(screen.getByLabelText("Gate")).toHaveClass("border-destructive");
    expect(screen.getByTestId("gantt-bar-meta")).toHaveTextContent("3d late");
  });

  it("leaves the after side to link stubs", () => {
    // The waiting-on stub flips after i1 (it starts at the track edge), and
    // there is no room before a bar that starts at x = 0.
    render(
      <GanttCanvas
        {...props({ externalLinks: new Map([["i1", [stub()]]]) })}
      />,
    );
    expect(
      within(firstRow()).queryByTestId("gantt-bar-meta"),
    ).not.toBeInTheDocument();
  });
});
```

These assert the decision and the inline position, which jsdom can hold. Whether the real Inter measurement matches the rendered label to the pixel, and whether a label collides with a neighbouring bar or an arrow, is verified in a browser by the orchestrator (Task 12).

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/lib/text-measure.test.ts src/components/boards/gantt/utils.test.ts src/components/boards/gantt/GanttCanvas.test.tsx`

Expected: FAIL. `text-measure.test.ts` fails to load (`Failed to resolve import "@/lib/text-measure"`). The new `utils` blocks fail with `… is not a function`. In `GanttCanvas bar labels`: `expected … to have a length of 1 but got 2`, `Unable to find an element by: [data-testid="gantt-bar-meta"]`, and the border assertions. "keeps the name inside a bar that is wide enough" and "leaves the after side to link stubs" already pass; they guard the implementation.

- [ ] **Step 3: Extract the text measurer**

Create `src/lib/text-measure.ts`:

```ts
// Canvas text measurement, shared by the board table's Name-column auto-fit
// and the timeline's "does the label fit in the bar" decision. Pure width
// measurement — no layout, no DOM writes.

/** The generic fallback stack `font-sans` itself falls back to. */
const FALLBACK_STACK = "ui-sans-serif, system-ui, sans-serif";

/**
 * A canvas font string for the app's UI face. `fontInterVar` is the LIVE value
 * of the `--font-inter` custom property: next/font self-hosts Inter under a
 * generated family name exposed only through that variable, so the bare
 * literal "Inter" never resolves in the browser. Empty (jsdom, or before
 * next/font registers it) falls back to the literal.
 */
export function buildMeasureFont(
  fontInterVar: string,
  weight: string,
  size: string,
): string {
  const family = fontInterVar.trim() || "Inter";
  return `${weight} ${size} ${family}, ${FALLBACK_STACK}`;
}

/**
 * A measurer for text set in the UI face at `weight` / `size` (CSS values,
 * e.g. "500", "11px"). Create it once per mount (`useMemo(…, [])`), not at
 * module scope: the font variable only exists on <html> at runtime. Where
 * there is no canvas (SSR, jsdom) it measures 0 for everything — callers treat
 * 0 as "unknown".
 */
export function createTextMeasurer(
  weight: string,
  size: string,
): (text: string) => number {
  const ctx =
    typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;
  if (!ctx) return () => 0;
  ctx.font = buildMeasureFont(
    getComputedStyle(document.documentElement).getPropertyValue("--font-inter"),
    weight,
    size,
  );
  return (text) => ctx.measureText(text).width;
}
```

In `src/components/boards/table/shared.ts` add `import { buildMeasureFont } from "@/lib/text-measure";` to the import block at the top, and replace the body of `buildNameMeasureFont` (lines 247-251)

```ts
export function buildNameMeasureFont(fontInterVar: string): string {
  const family = fontInterVar.trim();
  if (!family) return NAME_MEASURE_FONT;
  return `${NAME_MEASURE_FONT_WEIGHT} ${NAME_MEASURE_FONT_SIZE} ${family}, ${NAME_MEASURE_FONT_FALLBACK_STACK}`;
}
```

with

```ts
export function buildNameMeasureFont(fontInterVar: string): string {
  return buildMeasureFont(
    fontInterVar,
    NAME_MEASURE_FONT_WEIGHT,
    NAME_MEASURE_FONT_SIZE,
  );
}
```

(Same strings as before: `shared.test.ts:219-239` pins both branches, including that the empty case equals `NAME_MEASURE_FONT`.)

In `src/components/boards/table/BoardTableInner.tsx`:

1. The `./shared` import (lines 84-91) is

```tsx
import {
  buildNameMeasureFont,
  gridTemplate,
  type CellControls,
  type ColumnHeaderControls,
  type GroupControls,
  type GroupSummaryControls,
} from "./shared";
```

Replace it with

```tsx
import {
  NAME_MEASURE_FONT_SIZE,
  NAME_MEASURE_FONT_WEIGHT,
  gridTemplate,
  type CellControls,
  type ColumnHeaderControls,
  type GroupControls,
  type GroupSummaryControls,
} from "./shared";
```

and add `import { createTextMeasurer } from "@/lib/text-measure";` next to the other `@/lib` imports.

2. Lines 434-462 (the comment that starts `// Offscreen canvas measurer at the Name cell font` through the closing `}, []);` of the `measureName` memo) are replaced with

```tsx
// Offscreen canvas measurer at the Name cell font (500 13.5px Inter /
// text-item), used to auto-fit the Name column to the longest item name
// across ALL items (not just the virtualized rows). Pure measurement — no
// server round-trip. createTextMeasurer reads the LIVE `--font-inter`
// variable next/font sets on <html>, so it is created once per mount here,
// never at module scope; it measures 0 where there is no canvas (SSR, jsdom).
const measureName = useMemo(
  () => createTextMeasurer(NAME_MEASURE_FONT_WEIGHT, NAME_MEASURE_FONT_SIZE),
  [],
);
```

Everything below it (`hydrated`, `autoFitWidth`) is unchanged.

- [ ] **Step 4: Add the label helpers**

Append to `src/components/boards/gantt/utils.ts`:

```ts
// ---------------------------------------------------------------------------
// Bar labels
// ---------------------------------------------------------------------------

/** The inside label's own horizontal padding (`px-2`, both sides). */
export const BAR_LABEL_PAD = 16;
/** The resize strip at the end of an editable bar (`w-2`). */
export const BAR_RESIZE_W = 8;
/** Space between a bar's edge and the label drawn beside it. */
export const OUTSIDE_LABEL_GAP = 6;

/**
 * Does the name fit inside the bar? Decided from pixels — the bar's width
 * against the measured text — never from character counts. An unmeasured name
 * (0: no canvas) counts as fitting, which keeps the CSS-truncated label.
 */
export function barLabelFits(
  barWidthPx: number,
  textWidthPx: number,
  editable: boolean,
): boolean {
  if (textWidthPx <= 0) return true;
  return (
    textWidthPx + BAR_LABEL_PAD + (editable ? BAR_RESIZE_W : 0) <= barWidthPx
  );
}

/** "Oct 24" from YYYY-MM-DD, in UTC so the day never drifts. */
export function formatShortDay(iso: string): string {
  return new Date(parseISO(iso)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The short label drawn beside a bar, or null for none. The name is already
 * in the rail on the same row, so beside the bar goes what is missing: how
 * late the item is, or — when the bar is too short to carry its name, and for
 * a milestone, which has no inside label — its end date.
 */
export function outsideBarLabel(a: {
  lateDays: number | null;
  insideFits: boolean;
  isMilestone: boolean;
  endISO: string | undefined;
}): { text: string; late: boolean } | null {
  if (a.lateDays !== null) return { text: `${a.lateDays}d late`, late: true };
  if ((a.insideFits && !a.isMilestone) || !a.endISO) return null;
  return { text: formatShortDay(a.endISO), late: false };
}

/**
 * Which side of the bar the outside label goes on. After the bar by default;
 * before it when cross-board link stubs already hold the after side or the
 * label would clip the track; null (not drawn) when neither side has room.
 */
export function outsideLabelSide(a: {
  barStartX: number;
  barEndX: number;
  trackW: number;
  labelW: number;
  afterTaken: boolean;
  beforeTaken: boolean;
}): "after" | "before" | null {
  const need = a.labelW + OUTSIDE_LABEL_GAP;
  if (!a.afterTaken && a.barEndX + need <= a.trackW) return "after";
  if (!a.beforeTaken && a.barStartX - need >= 0) return "before";
  return null;
}
```

- [ ] **Step 5: Draw the label and the late border in `GanttRowItem`**

In `src/components/boards/gantt/GanttRowItem.tsx`:

1. Add to the utils import: `OUTSIDE_LABEL_GAP,`, `barLabelFits,`, `outsideBarLabel,`, `outsideLabelSide,`.
2. Under `const STUB_GAP = 4;` add

```tsx
/** Stand-in when the canvas hands down no measurer: everything "fits". */
const NO_MEASURE = () => 0;
```

3. Add to the destructured props `lateDays = null,` and `measureLabel = NO_MEASURE,`, and to the props type:

```tsx
  /** Whole days late, or null when the item is on time (or lateness is not
   * known on this timeline). */
  lateDays?: number | null;
  /** Width in px of a string at the bar-label font; 0 = not measurable. */
  measureLabel?: (text: string) => number;
```

4. Directly after the `stubGroups` memo (it ends `}, [stubs, barStartX, barEndX, totalW]);`) add

```tsx
// Inside label vs. the short label beside the bar (see outsideBarLabel).
const nameW = useMemo(() => measureLabel(row.name), [measureLabel, row.name]);
const insideFits = barLabelFits(barWidth, nameW, !readOnly);
const meta = outsideBarLabel({
  lateDays,
  insideFits,
  isMilestone: !!row.isMilestone,
  endISO: row.endISO ?? row.startISO,
});
const metaText = meta?.text ?? null;
const metaW = useMemo(
  () => (metaText ? measureLabel(metaText) : 0),
  [measureLabel, metaText],
);
const metaSide =
  meta && row.scheduled && !isDragging
    ? outsideLabelSide({
        barStartX,
        barEndX,
        trackW: totalW,
        labelW: metaW,
        afterTaken: stubGroups.some(([side]) => side === "after"),
        beforeTaken: stubGroups.some(([side]) => side === "before"),
      })
    : null;
```

5. The milestone's class list (originally lines 410-415) is

```tsx
            className={cn(
              "absolute rotate-45 rounded-sm",
              grabCursor,
              color ? "" : "bg-primary",
              isDragging && "opacity-50",
            )}
```

Add one line before the closing `)`: `lateDays !== null && "border-destructive border",`.

6. The bar's class list (originally lines 437-444) is

```tsx
            className={cn(
              "shadow-card absolute flex items-center rounded-sm transition-[filter] duration-200 hover:brightness-110",
              grabCursor,
              color
                ? "bg-[color-mix(in_oklab,var(--pill)_15%,transparent)]"
                : "bg-primary",
              isDragging && "opacity-50",
            )}
```

Add the same line before its closing `)`: `lateDays !== null && "border-destructive border",`. (A static 1px border in the destructive token. It is not a hover state, so "hairlines brighten, never thicken" is not in play, and it is a border, not a ring, so no box-shadow is added.)

7. The inside label (originally lines 472-481) is

```tsx
<span
  className={cn(
    "text-2xs truncate font-medium",
    color
      ? "text-[color:var(--pill-fg-light)] dark:text-[color:var(--pill-fg-dark)]"
      : "text-primary-foreground",
  )}
>
  {row.name}
</span>
```

Wrap it: put `{insideFits && (` on the line before `<span` and `)}` on the line after `</span>`. The handle around it keeps its `aria-label={row.name}`, so the bar stays named when the visible label is gone.

8. Directly after the link-stubs block (it ends `))}` after `<LinkStubs stubs={group} onTap={onStubTap} />`) and before the track's closing `</div>`, add

```tsx
{
  /* Short label beside the bar: "Nd late", or the end date when the bar
            is too short to carry its name (the name is in the rail). */
}
{
  meta && metaSide && (
    <span
      data-testid="gantt-bar-meta"
      className={cn(
        "text-2xs pointer-events-none absolute -translate-y-1/2 whitespace-nowrap tabular-nums",
        meta.late ? "text-destructive font-medium" : "text-muted-foreground",
      )}
      style={{
        top: ROW_H / 2,
        ...(metaSide === "after"
          ? { left: barEndX + OUTSIDE_LABEL_GAP }
          : { right: totalW - barStartX + OUTSIDE_LABEL_GAP }),
      }}
    >
      {meta.text}
    </span>
  );
}
```

- [ ] **Step 6: Hand the measurer and `lateFor` down from the canvas**

In `src/components/boards/gantt/GanttCanvas.tsx`:

1. Add `import { createTextMeasurer } from "@/lib/text-measure";`.
2. In `GanttCanvasProps`, after `criticalLabelFor`, add

```tsx
  /** Whole days an item is late, or null. Late bars get a destructive border
   * and an "Nd late" label. Omit where lateness is not known (the folder
   * timeline, whose payload carries no status). */
  lateFor?: (row: GanttRow) => number | null;
```

and add `lateFor,` to the destructured parameters.

3. Next to the `trackStyle` memo add

```tsx
// Measures bar labels at the label's own type: text-2xs (11px), medium.
const measureLabel = useMemo(() => createTextMeasurer("500", "11px"), []);
```

4. On `<GanttRowItem … />` add, after `criticalLabel={…}`:

```tsx
                        lateDays={lateFor?.(row) ?? null}
                        measureLabel={measureLabel}
```

Both timelines mount the canvas client-only (`GanttBoard` and the folder `TimelineTab` are `next/dynamic` with `ssr: false`), so a measurer that returns 0 on the server and real widths in the browser cannot cause a hydration mismatch here. The measurer is created at mount; if the Inter web font finishes loading after that, the first measurements use the fallback face's metrics. That is on the orchestrator's browser list (Task 12, check 10).

- [ ] **Step 7: Run the tests and see them pass**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/lib/text-measure.test.ts src/components/boards/gantt src/components/boards/table src/lib/boards/name-column-width.test.ts src/components/boards/BoardTable.test.tsx src/components/boards/GanttBoard.test.tsx src/components/boards/GanttBoard.intel.test.tsx`

Expected: PASS, every file. `src/components/boards/table` and `BoardTable.test.tsx` prove the table's measurer refactor changed nothing.

- [ ] **Step 8: Typecheck and lint**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint`

Expected: both exit 0. (`buildNameMeasureFont` is still exported from `shared.ts` and still used by `shared.test.ts`; only `BoardTableInner` stopped importing it.)

- [ ] **Step 9: Hand back**

Report the files changed, the tail of each command's output and any deviation. Do not stage, commit or stash.

---

### Task 8: Folder toolbar — Today button, rail width remembered per folder

**Files:**

- Modify: `src/components/folders/tabs/TimelineInner.tsx` (imports 3, 29-30; `TimelineInner`'s return; `FolderTimelineChart` state; toolbar originally at 389-410; `<GanttCanvas>` props)
- Test: `src/components/folders/tabs/Timeline.test.tsx`

**Interfaces:**

- Consumes: `GanttCanvasHandle`, `handleRef` (Task 4); `labelWidth`, `onLabelWidthChange`, `DEFAULT_LABEL_W`, `LABEL_W_MIN`, `LABEL_W_MAX` (Task 1); `clampDragWidth` from `@/lib/boards/name-column-width`; Task 6's `TimelineInner`.
- Produces: a "Today" button beside the zoom control; the rail width stored in `localStorage` under `monolith.folder-timeline.rail:<folderId>`. No server call for either.

**Existing tests that change:** the canvas probe mock at the top of `Timeline.test.tsx` (lines 36-45) is replaced so it exposes a handle. No assertion in an existing test changes.

- [ ] **Step 1: Write the failing tests**

In `src/components/folders/tabs/Timeline.test.tsx`:

1. Add `scrollToToday: vi.fn(),` to the `vi.hoisted` object (after `toastError: vi.fn(),`).
2. Replace the canvas mock (lines 36-45)

```tsx
// The real canvas is exercised in its own suite; here a probe records the
// props so the tests can assert what the tab hands it and drive its callbacks.
vi.mock("@/components/boards/gantt/GanttCanvas", () => ({
  GanttCanvas: (p: GanttCanvasProps) => {
    m.canvas.current = p;
    return (
      <div data-testid="canvas">{p.rows.map((r) => r.name).join("|")}</div>
    );
  },
}));
```

with

```tsx
// The real canvas is exercised in its own suite; here a probe records the
// props so the tests can assert what the tab hands it and drive its callbacks,
// and answers the imperative handle the Today button calls.
vi.mock("@/components/boards/gantt/GanttCanvas", () => {
  // `handleRef` is a plain prop holding a ref object; fill it the way the real
  // canvas's useImperativeHandle would.
  const answerHandle = (ref: GanttCanvasProps["handleRef"]) => {
    if (ref && typeof ref === "object")
      ref.current = { scrollToToday: m.scrollToToday };
  };
  return {
    GanttCanvas: (p: GanttCanvasProps) => {
      m.canvas.current = p;
      answerHandle(p.handleRef);
      return (
        <div data-testid="canvas">{p.rows.map((r) => r.name).join("|")}</div>
      );
    },
  };
});
```

(The probe keeps the shape of the existing mock, an arrow on an object property with no hooks, so it stays outside the React hooks lint rules exactly as today.)

3. Change the `beforeEach` to

```tsx
beforeEach(() => {
  vi.clearAllMocks();
  m.canvas.current = null;
  localStorage.clear();
});
```

4. Add at the end of `describe("TimelineInner", …)`:

```tsx
it("has a Today button that asks the canvas to scroll, with no fetch", async () => {
  m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
  renderTab();
  await screen.findByTestId("canvas");
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(m.scrollToToday).toHaveBeenCalledTimes(1);
  expect(m.getFolderTimeline).toHaveBeenCalledTimes(1);
  expect(m.refresh).not.toHaveBeenCalled();
});

it("opens the rail at 300px and remembers a new width for this folder", async () => {
  m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
  renderTab();
  await screen.findByTestId("canvas");
  expect(canvas().labelWidth).toBe(300);
  act(() => canvas().onLabelWidthChange?.(420));
  expect(canvas().labelWidth).toBe(420);
  expect(localStorage.getItem("monolith.folder-timeline.rail:f1")).toBe("420");
  expect(m.getFolderTimeline).toHaveBeenCalledTimes(1);
});

it("restores a stored rail width, clamped to the rail's bounds", async () => {
  localStorage.setItem("monolith.folder-timeline.rail:f1", "9000");
  m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
  renderTab();
  await screen.findByTestId("canvas");
  expect(canvas().labelWidth).toBe(520);
});

it("falls back to 300px when the store is blocked or holds junk", async () => {
  const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  m.getFolderTimeline.mockResolvedValueOnce({ ok: true, data });
  renderTab();
  await screen.findByTestId("canvas");
  expect(canvas().labelWidth).toBe(300);
  getItem.mockRestore();
});
```

(`vitest.setup.ts` installs an in-memory `localStorage`, so `spyOn(localStorage, "getItem")` works on the instance.)

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/folders/tabs/Timeline.test.tsx`

Expected: FAIL on the four new tests: `Unable to find an accessible element with the role "button" and name "Today"`, and `expected undefined to be 300` / `520` for `canvas().labelWidth`. Every older test still passes with the new probe.

- [ ] **Step 3: Implement the toolbar and the stored width**

In `src/components/folders/tabs/TimelineInner.tsx`:

1. Line 3 becomes `import { useCallback, useMemo, useRef, useState } from "react";`.
2. Replace the two canvas-related imports (lines 29-30)

```tsx
import type { TimelineZoom } from "@/components/boards/gantt/utils";
import { GanttCanvas } from "@/components/boards/gantt/GanttCanvas";
```

with

```tsx
import {
  DEFAULT_LABEL_W,
  LABEL_W_MAX,
  LABEL_W_MIN,
  type TimelineZoom,
} from "@/components/boards/gantt/utils";
import {
  GanttCanvas,
  type GanttCanvasHandle,
} from "@/components/boards/gantt/GanttCanvas";
import { clampDragWidth } from "@/lib/boards/name-column-width";
import { Button } from "@/components/ui/button";
```

3. Under the `MAX_LINK_CANDIDATES` constant add

```tsx
/** Per-viewer, per-folder rail width. A folder has no view config to hold it,
 * and it is a convenience, so it lives in localStorage. */
const railKey = (folderId: string) =>
  `monolith.folder-timeline.rail:${folderId}`;

/** The stored width, clamped; DEFAULT_LABEL_W when absent, junk or blocked. */
function readRailWidth(folderId: string): number {
  try {
    const raw = Number(localStorage.getItem(railKey(folderId)));
    return Number.isFinite(raw) && raw > 0
      ? clampDragWidth(raw, LABEL_W_MIN, LABEL_W_MAX)
      : DEFAULT_LABEL_W;
  } catch {
    return DEFAULT_LABEL_W;
  }
}

function writeRailWidth(folderId: string, width: number): void {
  try {
    localStorage.setItem(railKey(folderId), String(width));
  } catch {
    // Blocked or full store: the width simply isn't remembered.
  }
}
```

4. In `TimelineInner`'s return, give the chart a key so a different folder re-reads its own width: `<FolderTimelineChart key={folderId} folderId={folderId} … />`.
5. In `FolderTimelineChart`, under the `expandedGroups` state add

```tsx
const canvasRef = useRef<GanttCanvasHandle>(null);
// This component only ever renders on the client (the tab is ssr: false),
// so reading the store in the initializer is safe.
const [labelWidth, setLabelWidth] = useState(() => readRailWidth(folderId));
function handleLabelWidthChange(width: number) {
  setLabelWidth(width);
  writeRailWidth(folderId, width);
}
```

6. The zoom control (originally lines 389-410) is

```tsx
        <div
          role="group"
          aria-label="Zoom"
          className="ml-auto flex items-center gap-1 rounded-md border p-0.5"
        >
          {ZOOMS.map((z) => (
            …
          ))}
        </div>
```

Wrap it and add the button. The opening `<div role="group" …>` loses `ml-auto` (its class becomes `"flex items-center gap-1 rounded-md border p-0.5"`), and the whole control sits inside a new wrapper:

```tsx
<div className="ml-auto flex items-center gap-2">
  <div
    role="group"
    aria-label="Zoom"
    className="flex items-center gap-1 rounded-md border p-0.5"
  >
    {ZOOMS.map((z) => (
      <button
        key={z}
        type="button"
        aria-pressed={zoom === z}
        onClick={() => setZoom(z)}
        className={cn(
          "focus-visible:ring-ring rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-3",
          zoom === z
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-state-hover",
        )}
      >
        {ZOOM_LABEL[z]}
      </button>
    ))}
  </div>
  <Button
    type="button"
    variant="outline"
    size="sm"
    className="text-xs"
    onClick={() => canvasRef.current?.scrollToToday()}
  >
    Today
  </Button>
</div>
```

(`Button` is the app primitive, so it brings its own coarse-pointer target; the zoom buttons are unchanged.)

7. On `<GanttCanvas … />` add, after `zoom={zoom}`:

```tsx
handleRef = { canvasRef };
labelWidth = { labelWidth };
onLabelWidthChange = { handleLabelWidthChange };
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/folders/tabs/Timeline.test.tsx src/components/folders/CommandCenter.test.tsx src/components/folders/no-gantt-in-first-paint.test.ts`

Expected: PASS, every file.

- [ ] **Step 5: Typecheck and lint**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 6: Hand back**

Report the files changed, the tail of each command's output and any deviation. Do not stage, commit or stash.

---

### Task 9: Canvas — summary bars on section bands, collapsible group bands

**Files:**

- Modify: `src/components/boards/gantt/GanttCanvas.tsx` (utils import; `SectionBand`, whole function)
- Test: `src/components/boards/gantt/GanttCanvas.test.tsx`

**Interfaces:**

- Consumes: `GanttRow.summary` / `GanttSectionSummary` (Task 2); `SectionBand` as left by Task 4; `MIN_BAR_W`, `ROW_H` from `gantt/utils`.
- Produces: any section row is a toggle when the canvas is given `onToggleExpand` (level 0 and level 1; the callers decide what an id means). A section row with `summary` draws an 8px span bar on its track with a `donePct` fill, and "35% · 8 late" right-aligned in the rail. DOM hooks: `data-testid="gantt-summary"`, `"gantt-summary-fill"`, `"gantt-section-meta"`.

**Existing tests that change:** none. "makes a board band a collapse toggle only when onToggleExpand is given" (`GanttCanvas.test.tsx:294-310`) and "renders section bands as headings, not bar rows" keep passing: a level-0 band behaves as before.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/boards/gantt/GanttCanvas.test.tsx`:

```tsx
describe("GanttCanvas section summaries and group bands", () => {
  const groupBand = (summary?: GanttRow["summary"]): GanttRow => ({
    itemId: "group:g1",
    name: "Phase 1",
    scheduled: false,
    kind: "section",
    level: 1,
    ...(summary ? { summary } : {}),
  });
  // Row order: 0 board band, 1 group band, 2 i1, 3 i2.
  const grouped = (summary?: GanttRow["summary"]): GanttRow[] => [
    rows[0]!,
    groupBand(summary),
    rows[1]!,
    rows[2]!,
  ];
  const full = { startCol: 2, spanCols: 10, donePct: 35, lateCount: 8 };
  const bandOf = (name: string) =>
    screen
      .getByRole("heading", { name })
      .closest('[data-testid="gantt-section"]') as HTMLElement;

  it("makes a group band a toggle too when onToggleExpand is given", () => {
    const onToggleExpand = vi.fn();
    render(
      <GanttCanvas
        {...props({
          rows: grouped(full),
          onToggleExpand,
          isExpanded: () => true,
        })}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Collapse Phase 1" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle.className).toContain("pointer-coarse:h-11");
    fireEvent.click(toggle);
    expect(onToggleExpand).toHaveBeenCalledWith("group:g1");
  });

  it("leaves a group band a plain level-4 heading without onToggleExpand", () => {
    render(<GanttCanvas {...props({ rows: grouped(full) })} />);
    expect(
      screen.getByRole("heading", { level: 4, name: "Phase 1" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Phase 1/ }),
    ).not.toBeInTheDocument();
  });

  it("draws the summary span, its done share and the meta text", () => {
    render(<GanttCanvas {...props({ rows: grouped(full) })} />);
    const band = bandOf("Phase 1");
    // Day 2 → 20px; 10 days × 10px.
    expect(within(band).getByTestId("gantt-summary")).toHaveStyle({
      left: "20px",
      width: "100px",
    });
    expect(within(band).getByTestId("gantt-summary-fill")).toHaveStyle({
      width: "35%",
    });
    expect(within(band).getByTestId("gantt-section-meta")).toHaveTextContent(
      "35% · 8 late",
    );
  });

  it("draws an unknown-progress span without a fill or meta text", () => {
    render(
      <GanttCanvas
        {...props({
          rows: grouped({ ...full, donePct: null, lateCount: null }),
        })}
      />,
    );
    const band = bandOf("Phase 1");
    expect(within(band).getByTestId("gantt-summary")).toBeInTheDocument();
    expect(
      within(band).queryByTestId("gantt-summary-fill"),
    ).not.toBeInTheDocument();
    expect(
      within(band).queryByTestId("gantt-section-meta"),
    ).not.toBeInTheDocument();
  });

  it("omits the late part when nothing is late", () => {
    render(
      <GanttCanvas
        {...props({ rows: grouped({ ...full, donePct: 100, lateCount: 0 }) })}
      />,
    );
    const meta = within(bandOf("Phase 1")).getByTestId("gantt-section-meta");
    expect(meta).toHaveTextContent("100%");
    expect(meta).not.toHaveTextContent("late");
  });

  it("draws no summary on a band that has none", () => {
    render(<GanttCanvas {...props({ rows: grouped(full) })} />);
    expect(
      within(bandOf("Procurement")).queryByTestId("gantt-summary"),
    ).not.toBeInTheDocument();
  });

  it("keeps every band one row tall and arrows on the right rows", () => {
    const { container } = render(
      <GanttCanvas {...props({ rows: grouped(full) })} />,
    );
    for (const band of screen.getAllByTestId("gantt-section")) {
      expect(band).toHaveStyle({ height: "32px" });
    }
    // i1 is row 2, i2 row 3. Rail 300px, 10px/day, 32px rows:
    // from (300 + 5×10, 2×32 + 16) to (300 + 6×10, 3×32 + 16).
    expect(
      container.querySelector("svg path[marker-end]")?.getAttribute("d"),
    ).toBe("M350,80 C355,80 355,112 360,112");
  });
});
```

The last test is the guard for "row heights stay uniform": if a band ever grew taller than `ROW_H`, the arrow's y would no longer match the row it points at. jsdom cannot see a band actually growing (a CSS overflow), so the rendered height of a band with a summary is also on the orchestrator's browser list (Task 12).

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/boards/gantt/GanttCanvas.test.tsx`

Expected: FAIL in the new block: `Unable to find an accessible element with the role "button" and name "Collapse Phase 1"`, and `Unable to find an element by: [data-testid="gantt-summary"]` / `"gantt-section-meta"`. "leaves a group band a plain level-4 heading…", "draws no summary on a band that has none" and "keeps every band one row tall…" already pass; they guard the implementation.

- [ ] **Step 3: Implement the band**

In `src/components/boards/gantt/GanttCanvas.tsx` add `MIN_BAR_W,` to the utils import, and replace the whole `SectionBand` function and its doc comment with

```tsx
/**
 * A label band spanning the whole row — a board (level 0, the stronger surface
 * step) or a group (level 1, lighter, indented). It has no draggable bar and
 * no picker; the name stays pinned to the rail while the track scrolls
 * sideways. Any band becomes a collapse toggle when the canvas is given
 * `onToggleExpand` (the caller decides what a band id means). A band with a
 * `summary` draws the span of everything under it as a thin bar, filled to its
 * done share, with "35% · 8 late" in the rail. Always exactly ROW_H tall: the
 * arrow overlay computes y from the row index.
 */
function SectionBand({
  row,
  totalW,
  labelW,
  dayW,
  todayOffset,
  dayCount,
  trackStyle,
  expanded,
  onToggle,
}: {
  row: GanttRow;
  totalW: number;
  labelW: number;
  dayW: number;
  todayOffset: number;
  dayCount: number;
  trackStyle?: CSSProperties;
  expanded: boolean;
  onToggle?: (itemId: string) => void;
}) {
  const isBoard = (row.level ?? 0) === 0;
  const summary = row.summary;
  const pct =
    summary && summary.donePct !== null ? `${summary.donePct}%` : null;
  const late =
    summary && summary.lateCount !== null && summary.lateCount > 0
      ? `${summary.lateCount} late`
      : null;
  const label = (
    <span
      role="heading"
      aria-level={isBoard ? 3 : 4}
      title={row.name}
      className={cn(
        "min-w-0 truncate text-xs",
        isBoard
          ? "text-foreground font-semibold"
          : "text-muted-foreground font-medium",
      )}
    >
      {row.name}
    </span>
  );
  return (
    <div
      data-testid="gantt-section"
      className={cn(
        "flex border-b",
        isBoard ? "bg-surface-muted" : "bg-surface",
      )}
      style={{ height: ROW_H, width: labelW + totalW }}
    >
      <div
        className={cn(
          "sticky left-0 z-10 flex min-w-0 shrink-0 items-center pr-2",
          isBoard ? "bg-surface-muted" : "bg-surface",
        )}
        style={{
          width: labelW,
          // The toggle carries its own 4px of padding; a plain label does not.
          paddingLeft: onToggle ? (isBoard ? 8 : 24) : isBoard ? 16 : 32,
        }}
      >
        {onToggle ? (
          <button
            type="button"
            onClick={() => onToggle(row.itemId)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${row.name}`}
            className="hover:bg-state-hover focus-visible:ring-ring flex h-7 min-w-0 flex-1 items-center gap-1 rounded-sm px-1 text-left focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-11"
          >
            {expanded ? (
              <ChevronDown
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            ) : (
              <ChevronRight
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden
              />
            )}
            {label}
          </button>
        ) : (
          label
        )}
        {(pct || late) && (
          <span
            data-testid="gantt-section-meta"
            className="text-muted-foreground text-2xs ml-auto shrink-0 pl-2 tabular-nums"
          >
            {pct}
            {pct && late ? " · " : null}
            {late ? <span className="text-destructive">{late}</span> : null}
          </span>
        )}
      </div>
      {/* The band's track: same weekend tint and today hairline as an item
          row, so the today line reads as one unbroken rule down the chart. */}
      <div
        data-testid="gantt-section-track"
        className="relative shrink-0"
        style={{ width: totalW, height: ROW_H, ...trackStyle }}
      >
        {summary && (
          <div
            data-testid="gantt-summary"
            aria-hidden
            className="bg-muted-foreground/20 absolute h-2 overflow-hidden rounded-full"
            style={{
              left: summary.startCol * dayW,
              width: Math.max(MIN_BAR_W, summary.spanCols * dayW),
              top: ROW_H / 2 - 4,
            }}
          >
            {summary.donePct !== null && (
              <div
                data-testid="gantt-summary-fill"
                className="bg-brand-gradient h-full"
                style={{ width: `${summary.donePct}%` }}
              />
            )}
          </div>
        )}
        {todayOffset >= 0 && todayOffset <= dayCount && (
          <div
            data-today-line
            className="bg-destructive/30 absolute top-0 h-full w-px"
            style={{ left: todayOffset * dayW }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
```

Design notes for the reviewer: the fill uses `bg-brand-gradient`, which the design system sanctions for progress-bar fills; the unfilled span is the muted foreground at 20%; the late count is `text-destructive` and says "late" in words. The summary bar is `aria-hidden` because the rail text carries the same numbers. No shadow, no border-width change.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/boards/gantt src/components/boards/GanttBoard.test.tsx src/components/boards/GanttBoard.intel.test.tsx src/components/folders/tabs/Timeline.test.tsx`

Expected: PASS, every file.

- [ ] **Step 5: Typecheck and lint**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 6: Hand back**

Report the files changed, the tail of each command's output and any deviation. Do not stage, commit or stash.

---

### Task 10: Board timeline — grouped rows, shared collapse, late bars, range that includes today

**Files:**

- Modify: `src/components/boards/GanttBoard.tsx` (imports 9-36; range 156-191; prefs and visible rows 292-307; after the `cellMap` memo 330-333; `<GanttCanvas>` props 581-625)
- Test: `src/components/boards/GanttBoard.test.tsx`, `src/components/boards/GanttBoard.intel.test.tsx`

**Interfaces:**

- Consumes: `groupTimelineRows`, `rangeIncludingToday`, `UNGROUPED_GROUP_ID` from `@/lib/boards/gantt` and `buildTimelineLate` from `@/lib/boards/timeline-late` (Task 2); `localTodayISO` from `@/lib/boards/overdue`; `lateFor` (Task 7) and group-band toggles (Task 9) on `GanttCanvas`; `collapsedGroups` / `toggleGroupCollapsed` from `useBoardViewPrefs()`; `cache.groups`.
- Produces: no new exports. `GanttBoard` hands the canvas one band per group (`group:<groupId>`), collapse shared with the table, `lateFor` from the Board Intelligence rule, and a range that contains today − 14 … today + 30.

**Existing tests that change:**

- `GanttBoard.test.tsx` `payloadFixture()` (line 107) and `twoColPayload()` (line 334), and `GanttBoard.intel.test.tsx` `payload()` (line 59): their group is `{ id: "g1", board_id: "b1" }`, with no `name` or `position`. A band needs both, so the three fixtures get a real group. No assertion in an existing test changes: section bands use `data-testid="gantt-section"`, so the `gantt-row` counts (`GanttBoard.test.tsx:971`, `GanttBoard.intel.test.tsx:146`) are unaffected; bar widths (`"50px"`, `"80px"`) depend on `dayW`, which stays at the 10px base because jsdom measures no track; the cross-board test still finds exactly one arrow.
- Every fixture date is in June 2026 and no fixture item is done unless it says so, so against the real clock those items are late. That adds a destructive border and an "Nd late" label to their bars; no existing test asserts their absence.

- [ ] **Step 1: Update the fixtures and write the failing tests**

In `src/components/boards/GanttBoard.test.tsx`:

1. Change the Testing Library import (line 11) to `import { render, screen, fireEvent, within } from "@testing-library/react";` (unchanged) and add, under the presence imports:

```tsx
import { BoardViewPrefsProvider } from "@/lib/boards/view-prefs-context";
import { EMPTY_BOARD_VIEW_PREFS } from "@/lib/validations/view-prefs";
import { localTodayISO } from "@/lib/boards/overdue";
```

2. In `payloadFixture()` (line 107) and in `twoColPayload()` (line 334) replace `groups: [{ id: "g1", board_id: "b1" }],` with

```tsx
    groups: [
      { id: "g1", board_id: "b1", name: "Group One", position: 0, color: "#579bfc" },
    ],
```

3. Append at the end of the file:

```tsx
// ---------------------------------------------------------------------------
// Grouped Gantt — a band per board group, shared collapse, late bars
// ---------------------------------------------------------------------------

describe("GanttBoard — grouped rows", () => {
  function groupedPayload() {
    const base = payloadFixture() as unknown as {
      groups: Array<Record<string, unknown>>;
      items: Array<Record<string, unknown>>;
      dependencies: Array<Record<string, unknown>>;
    };
    // Listed out of order on purpose: position decides.
    base.groups = [
      {
        id: "g2",
        board_id: "b1",
        name: "Build",
        position: 1,
        color: "#888888",
      },
      {
        id: "g1",
        board_id: "b1",
        name: "Discovery",
        position: 0,
        color: "#579bfc",
      },
      {
        id: "g3",
        board_id: "b1",
        name: "Launch",
        position: 2,
        color: "#888888",
      },
    ];
    base.items = [
      // i1 is dated 2026-06-02 → 06-04, i2 2026-06-10 → 06-12 (payloadFixture).
      {
        id: "i1",
        name: "Item Alpha",
        group_id: "g2",
        position: 0,
        parent_id: null,
      },
      {
        id: "i2",
        name: "Item Beta",
        group_id: "g1",
        position: 0,
        parent_id: null,
      },
      // The only item in Launch has no dates.
      {
        id: "i3",
        name: "Unscheduled Item",
        group_id: "g3",
        position: 0,
        parent_id: null,
      },
    ];
    base.dependencies = [];
    return base as never;
  }
  /** Bands and rows in DOM order, by the full name on their rail label. */
  const railOrder = () =>
    screen
      .getAllByTestId(/^gantt-(section|row)$/)
      .map((el) => el.querySelector("[title]")?.getAttribute("title"));

  it("draws a band per group in position order with its rows under it", () => {
    renderGantt(groupedPayload());
    expect(railOrder()).toEqual([
      "Discovery",
      "Item Beta",
      "Build",
      "Item Alpha",
    ]);
  });

  it("skips a group with nothing on the timeline", () => {
    renderGantt(groupedPayload());
    expect(
      screen.queryByRole("heading", { name: "Launch" }),
    ).not.toBeInTheDocument();
    // Its undated item is still reachable in the Unscheduled section.
    expect(screen.getByText(/Unscheduled \(1\)/)).toBeInTheDocument();
  });

  it("collapsing a group hides its rows and keeps its band", () => {
    renderGantt(groupedPayload());
    fireEvent.click(screen.getByRole("button", { name: "Collapse Discovery" }));
    expect(railOrder()).toEqual(["Discovery", "Build", "Item Alpha"]);
    expect(
      screen.getByRole("button", { name: "Expand Discovery" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("reads and writes the same collapsed set the table uses", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardViewPrefsProvider
          boardId="b1"
          initial={{ ...EMPTY_BOARD_VIEW_PREFS, collapsedGroupIds: ["g1"] }}
        >
          <GanttBoard
            payload={groupedPayload()}
            members={[]}
            selectedViewId={VIEW_ID}
          />
        </BoardViewPrefsProvider>
      </QueryClientProvider>,
    );
    // A group collapsed in the table opens collapsed here.
    expect(railOrder()).toEqual(["Discovery", "Build", "Item Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand Discovery" }));
    expect(railOrder()).toEqual([
      "Discovery",
      "Item Beta",
      "Build",
      "Item Alpha",
    ]);
  });

  it("summarises each group on its band", () => {
    renderGantt(groupedPayload());
    const band = screen
      .getByRole("heading", { name: "Discovery" })
      .closest('[data-testid="gantt-section"]') as HTMLElement;
    // One scheduled item, not done, due in June 2026 → late.
    expect(within(band).getByTestId("gantt-section-meta")).toHaveTextContent(
      "0% · 1 late",
    );
    expect(within(band).getByTestId("gantt-summary")).toBeInTheDocument();
  });

  it("keeps sub-items nested under their parent inside the group", () => {
    const base = groupedPayload() as unknown as {
      items: Array<Record<string, unknown>>;
      cellValues: Array<Record<string, unknown>>;
    };
    base.items.push({
      id: "c1",
      name: "Child",
      group_id: "g1",
      position: 0,
      parent_id: "i2",
    });
    base.cellValues.push({
      item_id: "c1",
      column_id: DATE_COL_ID,
      value: { date: "2026-06-11" },
      board_id: "b1",
      org_id: "o1",
      updated_at: "2026-06-01T00:00:00Z",
    });
    renderGantt(base as never);
    fireEvent.click(
      screen.getByRole("button", { name: /expand sub-items of Item Beta/i }),
    );
    expect(railOrder()).toEqual([
      "Discovery",
      "Item Beta",
      "Child",
      "Build",
      "Item Alpha",
    ]);
  });
});

describe("GanttBoard — late bars and range", () => {
  it("marks an open, past-due item late and leaves a done one alone", () => {
    // twoColPayload: "Spanned" is Done; "DotOnly" (2026-06-03) has no status.
    renderBoard(twoColPayload());
    expect(screen.getByLabelText("DotOnly")).toHaveClass("border-destructive");
    expect(screen.getByLabelText("Spanned").parentElement).not.toHaveClass(
      "border-destructive",
    );
    expect(screen.getByText(/^\d+d late$/)).toBeInTheDocument();
  });

  it("widens the range so today is on the grid even when all dates are old", () => {
    const base = payloadFixture() as unknown as {
      cellValues: Array<Record<string, unknown>>;
      dependencies: Array<Record<string, unknown>>;
    };
    // One item, 200 days ago. The month window alone is 90 days.
    base.cellValues = [
      {
        item_id: "i1",
        column_id: DATE_COL_ID,
        value: { date: localTodayISO(new Date(Date.now() - 200 * 86_400_000)) },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ];
    base.dependencies = [];
    const { container } = renderGantt(base as never);
    // The header's today line renders only when today is inside the range.
    expect(container.querySelector('[aria-label="Today"]')).not.toBeNull();
  });

  it("puts today on the grid when every date is in the future", () => {
    const base = payloadFixture() as unknown as {
      cellValues: Array<Record<string, unknown>>;
      dependencies: Array<Record<string, unknown>>;
    };
    base.cellValues = [
      {
        item_id: "i1",
        column_id: DATE_COL_ID,
        value: { date: localTodayISO(new Date(Date.now() + 120 * 86_400_000)) },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ];
    base.dependencies = [];
    const { container } = renderGantt(base as never);
    expect(container.querySelector('[aria-label="Today"]')).not.toBeNull();
  });
});
```

In `src/components/boards/GanttBoard.intel.test.tsx` replace `groups: [{ id: "g1", board_id: "b1" }],` (line 59) with

```tsx
    groups: [
      { id: "g1", board_id: "b1", name: "Group One", position: 0, color: "#579bfc" },
    ],
```

and add one assertion at the end of the test "intel=overdue keeps only the overdue row and marks it":

```tsx
// The narrowed row's group band is still drawn; an emptied group is not.
expect(screen.getAllByTestId("gantt-section")).toHaveLength(1);
```

Notes on these tests: they run against the real clock. The fixture dates (June 2026) are in the past and stay there, and the two range tests build their dates relative to now, so nothing here goes stale. `renderGantt` renders without a `BoardViewPrefsProvider`, where `useBoardViewPrefs()` falls back to working local state; the fourth test mounts the real provider (its debounced save is cleared on unmount, so nothing is written).

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/boards/GanttBoard.test.tsx src/components/boards/GanttBoard.intel.test.tsx`

Expected: FAIL. In "grouped rows": `railOrder()` returns only item rows (`["Item Alpha", "Item Beta"]`), there is no "Collapse Discovery" button, no `gantt-section-meta`. In "late bars and range": no `border-destructive`, and both range tests get `null` for the today line. The intel test fails on `Unable to find an element by: [data-testid="gantt-section"]`. Every older test in both files passes with the new fixtures.

- [ ] **Step 3: Compute the range, the late map and the grouped rows**

In `src/components/boards/GanttBoard.tsx`:

1. In the import from `@/lib/boards/gantt` (lines 21-28) replace the list with

```tsx
import {
  UNGROUPED_GROUP_ID,
  buildGanttRows,
  detectViolations,
  groupTimelineRows,
  onBarMoved,
  onBarResized,
  rangeIncludingToday,
  timelineDayCount,
} from "@/lib/boards/gantt";
```

(`visibleRows` is no longer used here.) Add under the `timeline-color` import:

```tsx
import { localTodayISO } from "@/lib/boards/overdue";
import { buildTimelineLate } from "@/lib/boards/timeline-late";
```

2. Replace lines 156-191 — from the comment `// Earliest scheduled item start date for range anchoring.` through the closing `);` of `const dayCount = timelineDayCount(…)` — with

```tsx
// Viewer-local today: the clock the overdue rule and the canvas's today line
// both use.
const today = localTodayISO();

// Earliest scheduled start, or "" when nothing is dated.
const dataStartISO = useMemo(() => {
  if (!dateColumn || !startSourceId) return "";
  let min = "";
  for (const cv of effectiveCellValues) {
    if (cv.column_id !== startSourceId) continue;
    const d = (cv.value as { date?: unknown } | null)?.date;
    if (typeof d === "string" && (min === "" || d < min)) min = d;
  }
  return min;
}, [startSourceId, effectiveCellValues, dateColumn]);

// Latest date across the start and end sources — how far the last bar reaches.
const dataEndISO = useMemo(() => {
  let max = "";
  for (const cv of effectiveCellValues) {
    if (cv.column_id !== startSourceId && cv.column_id !== endSourceId)
      continue;
    const d = (cv.value as { date?: string } | null)?.date;
    if (typeof d === "string" && d > max) max = d;
  }
  return max;
}, [startSourceId, endSourceId, effectiveCellValues]);

// The grid's range: the data range, widened so today − 14 … today + 30 is
// always on it (the timeline opens scrolled to today). "" — no grid — when
// the board has no date column; that is the early-return path below.
const range =
  dateColumn && startSourceId
    ? rangeIncludingToday(dataStartISO || null, dataEndISO || null, today)
    : null;
const rangeStartISO = range?.startISO ?? "";

// Grid width in days: the zoom window, extended to fit the full range so
// bars beyond the window aren't clipped off-screen.
const dayCount = timelineDayCount(
  rangeStartISO,
  range?.endISO ?? "",
  ZOOM_DAY_COUNT[zoom],
);
```

(The old fallback — the first of the current month when nothing is dated — is replaced by today − 14.)

3. Lines 292-307 are the comment block that starts `// Sub-item nesting: parents collapsed by default` through the `visibleTimelineRows` memo. Replace them with

```tsx
// Sub-item nesting: parents collapsed by default so the timeline opens as a
// compact top-level overview; expand a parent to reveal its scheduled
// sub-items. Group bands collapse through `collapsedGroups`.
//
// Both sets are shared with the table view through the view-prefs provider:
// collapsing a group (or expanding a row) here and switching to Table shows
// the same thing there, and both survive a reload.
const {
  collapsedGroups,
  toggleGroupCollapsed,
  expandedItems: expanded,
  toggleItemExpanded: toggleExpand,
} = useBoardViewPrefs();
// The trailing "Other items" band (rows whose group is not on the board) is
// not a real group: its id is not a uuid, and the saved prefs accept only
// uuids — so its collapse lives here, never in the shared set.
const [otherCollapsed, setOtherCollapsed] = useState(false);
```

4. Directly after the `cellMap` memo (lines 330-333) add

```tsx
// Late + done by the Board Intelligence overdue rule (see timeline-late.ts),
// so a bar's "Nd late" and the overdue chip can never disagree.
const late = useMemo(
  () =>
    buildTimelineLate({
      items: cache.items,
      columns: cache.columns,
      cellMap,
      todayISO: today,
    }),
  [cache.items, cache.columns, cellMap, today],
);
const groupOfItem = useMemo(
  () => new Map(cache.items.map((i) => [i.id, i.group_id])),
  [cache.items],
);
// The rows actually drawn on the timeline: a band per group (position
// order, skipped when empty), then — unless the group is collapsed — its
// top-level rows, plus the sub-items of expanded parents. Virtualization,
// the rows-area height, and dependency-arrow indexing all key off this list.
const visibleTimelineRows = useMemo(
  () =>
    groupTimelineRows(timelineRows, groupOfItem, cache.groups, {
      collapsedGroups: otherCollapsed
        ? new Set([...collapsedGroups, UNGROUPED_GROUP_ID])
        : collapsedGroups,
      expanded,
      isDone: late.isDone,
      lateFor: (row) => late.lateDays.get(row.itemId) ?? null,
    }),
  [
    timelineRows,
    groupOfItem,
    cache.groups,
    collapsedGroups,
    otherCollapsed,
    expanded,
    late,
  ],
);
```

All of this sits above the `if (!dateColumn)` early return, so hook order is unchanged on every path.

5. Below the early return, next to `handleItemTap`, add

```tsx
// A canvas row id is an item id (a parent → its sub-items) or `group:<id>`.
function isRowExpanded(id: string): boolean {
  if (!id.startsWith(GROUP_ROW_PREFIX)) return expanded.has(id);
  const groupId = id.slice(GROUP_ROW_PREFIX.length);
  return groupId === UNGROUPED_GROUP_ID
    ? !otherCollapsed
    : !collapsedGroups.has(groupId);
}
function toggleRow(id: string) {
  if (!id.startsWith(GROUP_ROW_PREFIX)) {
    toggleExpand(id);
    return;
  }
  const groupId = id.slice(GROUP_ROW_PREFIX.length);
  if (groupId === UNGROUPED_GROUP_ID) setOtherCollapsed((c) => !c);
  else toggleGroupCollapsed(groupId);
}
```

and, at module level directly above `export const GanttBoard = memo(GanttBoardInner);`, the prefix `groupTimelineRows` gives a band's row id:

```tsx
/** `groupTimelineRows` ids a group band `group:<groupId>`. */
const GROUP_ROW_PREFIX = "group:";
```

6. On `<GanttCanvas … />` replace

```tsx
        isExpanded={(itemId) => expanded.has(itemId)}
        onToggleExpand={toggleExpand}
```

with

```tsx
        lateFor={(row) => late.lateDays.get(row.itemId) ?? null}
        isExpanded={isRowExpanded}
        onToggleExpand={toggleRow}
```

Nothing else changes: `rows`, `violations`, `localSpans`, `scheduledRows`, `timelineRows`, `unscheduledRows`, `rowColors` and `handleResizeBar` still work from the flat `buildGanttRows` output. Dependency arrows need no change, because their indices come from `visibleTimelineRows`: a collapsed group's rows leave the list and the rest re-index. The Board Intelligence filter still narrows items before grouping (`intelItems` → `buildGanttRows`), and a group left with no rows is skipped.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/boards/GanttBoard.test.tsx src/components/boards/GanttBoard.intel.test.tsx src/components/boards/gantt src/lib/boards/gantt.test.ts src/lib/boards/timeline-late.test.ts`

Expected: PASS, every file.

- [ ] **Step 5: Typecheck and lint**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 6: Hand back**

Report the files changed, the tail of each command's output and any deviation. Do not stage, commit or stash.

---

### Task 11: Board timeline — Today button, rail width saved in the view config

**Files:**

- Modify: `src/components/boards/GanttBoard.tsx` (react import 3; imports 47-52; config type 89-94; state 109-118; `persistConfig` 402-430; controls bar 494-512; `<GanttCanvas>` props)
- Test: `src/components/boards/GanttBoard.test.tsx`

**Interfaces:**

- Consumes: `GanttCanvasHandle` / `handleRef` (Task 4); `labelWidth` / `onLabelWidthChange` / `DEFAULT_LABEL_W` (Task 1); `label_width` accepted by `updateBoardView` (Task 5); Task 10's `GanttBoard`.
- Produces: a "Today" button beside the zoom control; `label_width` in the timeline view's config, written once on drag end through the existing `persistConfig` → `updateBoardView` path with no revalidation and no refetch. A viewer resizes for the session and writes nothing.

**Why `persistConfig` must carry `label_width` on every save:** `updateBoardViewCore` replaces the stored `config` with the object it is given. If a zoom change sent a config without `label_width`, the saved width would be erased.

**Existing tests that change:** `GanttBoard.test.tsx` does not mock `@/lib/boards/view-actions` today, so a zoom click runs the real Server Action in jsdom. This task mocks `updateBoardView` for the whole file (the rest of the module stays real, because `BoardHeader`'s view switcher imports its other exports). No existing assertion changes.

- [ ] **Step 1: Write the failing tests**

In `src/components/boards/GanttBoard.test.tsx`:

1. Change the Testing Library import to `import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";`.
2. Add under the `use-dependency-context` mock (after line 88):

```tsx
const { updateBoardView } = vi.hoisted(() => ({
  updateBoardView: vi.fn(async (_input: unknown) => ({
    ok: true as const,
    data: undefined,
  })),
}));
vi.mock("@/lib/boards/view-actions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/boards/view-actions")>();
  return { ...actual, updateBoardView };
});
```

3. Append at the end of the file:

```tsx
// ---------------------------------------------------------------------------
// Today button + persisted name-rail width
// ---------------------------------------------------------------------------

describe("GanttBoard — Today and the name rail", () => {
  beforeEach(() => {
    updateBoardView.mockClear();
    refresh.mockReset();
    push.mockReset();
  });

  const railHeader = () => screen.getByTestId("gantt-rail-header");
  const railHandle = () =>
    screen.getByRole("separator", { name: /Resize name rail/ });

  it("scrolls the canvas to today from the Today button, with no navigation", () => {
    const { container } = renderGantt();
    const scroller = container.querySelector(
      "[data-scroll-container]",
    ) as HTMLElement;
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const arg = scrollTo.mock.calls[0]![0] as {
      left: number;
      behavior: string;
    };
    expect(arg.behavior).toBe("smooth");
    // The fixture starts in June 2026, so today is well to the right of x = 0.
    expect(arg.left).toBeGreaterThan(0);
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(updateBoardView).not.toHaveBeenCalled();
  });

  it("gives the Today button a coarse-pointer target through the Button primitive", () => {
    renderGantt();
    // size="sm" of the app Button: 28px on a mouse, 44px on a finger.
    expect(screen.getByRole("button", { name: "Today" }).className).toContain(
      "pointer-coarse:h-11",
    );
  });

  it("opens the rail at 300px, or at the width saved in the view config", () => {
    const { unmount } = renderGantt();
    expect(railHeader()).toHaveStyle({ width: "300px" });
    unmount();
    const base = payloadFixture() as unknown as {
      views: Array<{ config: Record<string, unknown> }>;
    };
    base.views[0]!.config = {
      date_column_id: DATE_COL_ID,
      zoom: "month",
      label_width: 220,
    };
    renderGantt(base as never);
    expect(railHeader()).toHaveStyle({ width: "220px" });
  });

  it("saves the rail width once, on drag end, with the rest of the config", async () => {
    renderGantt();
    fireEvent.pointerDown(railHandle(), { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 340 });
    fireEvent.pointerMove(window, { clientX: 380 });
    expect(updateBoardView).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    await waitFor(() => expect(updateBoardView).toHaveBeenCalledTimes(1));
    expect(updateBoardView).toHaveBeenCalledWith({
      viewId: VIEW_ID,
      config: expect.objectContaining({
        date_column_id: DATE_COL_ID,
        zoom: "month",
        label_width: 380,
      }),
    });
    expect(railHeader()).toHaveStyle({ width: "380px" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the saved width when another setting is saved", async () => {
    const base = payloadFixture() as unknown as {
      views: Array<{ config: Record<string, unknown> }>;
    };
    base.views[0]!.config = {
      date_column_id: DATE_COL_ID,
      zoom: "month",
      label_width: 220,
    };
    renderGantt(base as never);
    fireEvent.click(screen.getByRole("button", { name: /^week$/i }));
    await waitFor(() => expect(updateBoardView).toHaveBeenCalledTimes(1));
    expect(updateBoardView).toHaveBeenCalledWith({
      viewId: VIEW_ID,
      config: expect.objectContaining({ zoom: "week", label_width: 220 }),
    });
  });

  it("lets a viewer resize for the session without writing", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <GanttBoard
          payload={payloadFixture()}
          members={[]}
          selectedViewId={VIEW_ID}
          access="viewer"
        />
      </QueryClientProvider>,
    );
    fireEvent.pointerDown(railHandle(), { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 400 });
    fireEvent.pointerUp(window);
    expect(railHeader()).toHaveStyle({ width: "400px" });
    expect(updateBoardView).not.toHaveBeenCalled();
  });
});
```

(`src/components/ui/button.tsx:34` gives `size="sm"` the class `pointer-coarse:h-11`; `button.touch.test.tsx` asserts the same token for the default size.)

What these prove: the button reaches the canvas handle, which computes a real, positive scroll target and asks for a smooth scroll; the width is written exactly once and never during the drag. Where today actually lands on screen is the orchestrator's browser check (Task 12).

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/boards/GanttBoard.test.tsx`

Expected: FAIL in the new block: `Unable to find an accessible element with the role "button" and name "Today"`, and `Unable to find an accessible element with the role "separator"` (the board does not pass `onLabelWidthChange` yet). "keeps the saved width when another setting is saved" fails on `label_width` missing from the saved config. Every older test passes with the new mock.

- [ ] **Step 3: Implement**

In `src/components/boards/GanttBoard.tsx`:

1. Line 3 becomes `import { memo, useRef, useState, useTransition, useMemo } from "react";`.
2. Add `import { Button } from "@/components/ui/button";` next to the other component imports, and replace the two gantt imports (lines 47-52)

```tsx
import {
  ZOOM_DAY_COUNT,
  effectiveCriticalLabel,
  type TimelineZoom,
} from "@/components/boards/gantt/utils";
import { GanttCanvas } from "@/components/boards/gantt/GanttCanvas";
```

with

```tsx
import {
  DEFAULT_LABEL_W,
  ZOOM_DAY_COUNT,
  effectiveCriticalLabel,
  type TimelineZoom,
} from "@/components/boards/gantt/utils";
import {
  GanttCanvas,
  type GanttCanvasHandle,
} from "@/components/boards/gantt/GanttCanvas";
```

3. The view config type (lines 89-94) gains a member:

```tsx
const config = (selectedView?.config ?? null) as {
  date_column_id?: string | null;
  end_column_id?: string | null;
  color_column_id?: string | null;
  zoom?: TimelineZoom;
  label_width?: number;
} | null;
```

4. Under the `colorColId` state (lines 116-118) add

```tsx
// Name-rail width: seeded from the view config, saved back on drag end.
const [labelWidth, setLabelWidth] = useState<number>(
  typeof config?.label_width === "number"
    ? config.label_width
    : DEFAULT_LABEL_W,
);
const canvasRef = useRef<GanttCanvasHandle>(null);
```

5. In `persistConfig` (lines 402-430) the parameter type gains `label_width?: number;` and the merged object gains the current width, so every save carries it:

```tsx
  function persistConfig(next: {
    date_column_id?: string | null;
    end_column_id?: string | null;
    color_column_id?: string | null;
    zoom?: TimelineZoom;
    label_width?: number;
  }) {
    const merged = {
      date_column_id: startColId,
      end_column_id: endColId,
      color_column_id: colorColId,
      zoom,
      // updateBoardView REPLACES the stored config, so the rail width has to
      // ride along on every save or a zoom change would erase it.
      label_width: labelWidth,
      ...next,
    };
```

The rest of the function (the `startTransition` block and its toast) is unchanged.

6. Under `handleColorColumnChange` add

```tsx
function handleLabelWidthChange(width: number) {
  setLabelWidth(width);
  // One write, on drag end (the canvas never calls this mid-drag). A viewer
  // may resize for the session, but the view config is not theirs to write —
  // RLS would reject it and the failure toast would be noise.
  if (access !== "viewer") persistConfig({ label_width: width });
}
```

7. In the controls bar, directly after the zoom toggle's closing `</div>` (originally line 512) and before `<div className="ml-auto flex items-center gap-3">`, add

```tsx
<Button
  type="button"
  variant="outline"
  size="sm"
  className="text-xs"
  onClick={() => canvasRef.current?.scrollToToday()}
>
  Today
</Button>
```

8. On `<GanttCanvas … />` add, after `zoom={zoom}`:

```tsx
handleRef = { canvasRef };
labelWidth = { labelWidth };
onLabelWidthChange = { handleLabelWidthChange };
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm vitest run --project unit src/components/boards/GanttBoard.test.tsx src/components/boards/GanttBoard.intel.test.tsx src/lib/boards/view-actions.test.ts src/lib/validations/view-actions.test.ts`

Expected: PASS, every file.

- [ ] **Step 5: Typecheck and lint**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint`

Expected: both exit 0.

- [ ] **Step 6: Hand back**

Report the files changed, the tail of each command's output and any deviation. Do not stage, commit or stash.

---

### Task 12: Orchestrator — browser pass, whole-branch review, gates

This task is the orchestrator's. No implementer is dispatched for it. It contains no code to write; it is the list of things jsdom could not prove, each with the way to measure it and the value that passes.

**Files:** none, unless a check fails.

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Whole-branch review**

Run `superpowers:requesting-code-review` over the whole `task/timeline-readability` diff against `develop`, not per task. Look specifically for cross-task defects: a stale `LABEL_W`, a second definition of "late", a `GanttCanvas` prop one caller forgot, `collapsedBoards` left anywhere (`grep -rn "collapsedBoards" src` must print nothing), "Pulse" in any new user-facing string (`git diff develop --unified=0 -- src | grep -n "^+.*Pulse"` must print nothing outside comments and storage keys).

- [ ] **Step 2: Gates**

Run: `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/timeline-readability && pnpm typecheck && pnpm lint && pnpm test && pnpm build`

Expected: all four exit 0. (`rm -rf .next/types` first if `typecheck` trips on stale generated types.)

- [ ] **Step 3: Browser checks on the built CSS**

Serve the app from the worktree against DEV. DEV holds the live data: do not drag a bar, do not edit an item. Dragging the board's rail handle writes one `label_width` into that view's config, which is the feature and is harmless; put it back to 300 with a double-click afterwards.

Open the DAAS folder and its "Programme Governance & PMO" board (the two surfaces the spec measured). In dark and in light theme, at a desktop viewport, check each line and record the measured value:

| #   | Check                                           | How to measure                                                                                                                                                                               | Passes when                                                                                                                                                                                                   |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Board timeline opens on today                   | `(todayLine.left − rail.right) / (scroller.clientWidth − rail.width)` from `getBoundingClientRect()`                                                                                         | 0.34 ± 0.02, at Week, Month and Quarter                                                                                                                                                                       |
| 2   | Folder timeline opens on today                  | same                                                                                                                                                                                         | 0.34 ± 0.02                                                                                                                                                                                                   |
| 3   | Today button                                    | scroll away, click                                                                                                                                                                           | returns to the same ratio, animated                                                                                                                                                                           |
| 4   | A drag or a collapse does not move the viewport | scroll away, collapse a group / toggle a board                                                                                                                                               | `scrollLeft` unchanged                                                                                                                                                                                        |
| 5   | Today line is continuous                        | screenshot                                                                                                                                                                                   | one unbroken rule through bands and rows                                                                                                                                                                      |
| 6   | Weekend stripes                                 | the x of a known Saturday from a header tick vs the stripe's left edge                                                                                                                       | within 1px, at Week and Month; no stripes at Quarter and Year                                                                                                                                                 |
| 7   | Rows are uniform                                | `getBoundingClientRect().height` of an item row, a sub-item row, a board band, a group band with a summary                                                                                   | all exactly 32                                                                                                                                                                                                |
| 8   | Arrows meet their bars                          | screenshot of a linked pair with a band between them                                                                                                                                         | arrow ends at the vertical middle of each bar                                                                                                                                                                 |
| 9   | Rail resize                                     | drag the handle; double-click                                                                                                                                                                | clamps at 160 and 520; resets to 300; track re-fits; on the board one `updateBoardView` request on release and none while dragging (network panel); on the folder none at all and the width survives a reload |
| 10  | Label fit                                       | bars narrower than their name                                                                                                                                                                | no clipped name inside a bar; the date or "Nd late" sits beside it and does not overlap the next bar's label on the same row                                                                                  |
| 11  | Late bars                                       | compare with the board's Intelligence "overdue" chip                                                                                                                                         | every bar with a destructive border is in the chip's set, and every scheduled item in the chip's set has the border                                                                                           |
| 12  | Milestone dates                                 | a board with many single-date items                                                                                                                                                          | readable; if it is noise, report to the owner (spec item 7 in "Where the spec was wrong")                                                                                                                     |
| 13  | Board groups                                    | order, collapse, switch to Table and back                                                                                                                                                    | same order as the table; a group collapsed in one view is collapsed in the other                                                                                                                              |
| 14  | Folder roll-up                                  | open the Timeline tab                                                                                                                                                                        | one row per board (not 2,127 rows); expand a board → group bands; expand a group → items; "N late links" is non-zero while everything is closed if it was non-zero before                                     |
| 15  | Folder band numbers                             | compare a board band's "% · N late" with that board's row on the Boards tab                                                                                                                  | equal                                                                                                                                                                                                         |
| 16  | Stage menu                                      | DAAS (56 stages)                                                                                                                                                                             | one "Stages" button on every tab; search filters; picking a stage sets `?stage=`; a folder with 8 or fewer stages still shows chips                                                                           |
| 17  | Coarse pointer                                  | emulate `pointer: coarse` (DevTools sensors, or Playwright `hasTouch` + `isMobile`); `elementFromPoint` sweep, or the bounding box, of the ⋯ trigger, a band toggle and the bar resize strip | 44px wide; report the measured height                                                                                                                                                                         |

For check 17: the plan expects the width to be 44px and the unobstructed height to be about 38px (a 44px control centred in a 32px row, with the next row's rail painting over the lower 6px). If the owner requires a full 44px in both axes, stop and report: the fix is a pointer-aware row height (`useCoarsePointer()` in `src/lib/hooks/use-coarse-pointer.ts`, 44px rows on coarse pointers), which changes the spec's "32px rows" and needs the owner's decision.

- [ ] **Step 4: AI surfaces**

None were touched. The Board Intelligence chip's rule (`overdueSignals`) is unchanged; `timeline-late.test.ts` pins the bars to it.

- [ ] **Step 5: Finish**

Only after Steps 1-3 pass: commit anything outstanding by path, run `scripts/finish-task.sh` from the worktree, and give the owner the "How to test this" walkthrough built from the table above (which page, what to click, what to expect), in the closing message and in the `/wrapup` session note. Report the three open decisions for the owner: the folder/board late-rule differences (open item (a)), milestone date labels (check 12), and the coarse-pointer hit height (check 17).
