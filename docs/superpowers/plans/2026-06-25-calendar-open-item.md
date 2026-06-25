# Calendar Open-Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clicking (or keyboard-activating) any Calendar event — single-day chip, multi-day span, "+N more" popover row, or agenda row — open the item detail panel, by replacing `CalendarBoard`'s `onOpenItem: undefined` stub with an inline `openItemPanel` that sets `?item=<id>` via the History API.

**Architecture:** Pure client-side wiring. The calendar leaf components (`EventBar`, `CalendarMonth`/`DayMorePopover`, `CalendarWeek`, `CalendarAgenda`) already accept and call an `onOpenItem`/`onOpen` callback; `BoardViews` already reads `?item=` from the URL, resolves the item from the already-loaded payload cache, renders `ItemPanel`, and restores the URL on close. The only missing piece is that `CalendarBoard` passes `undefined` instead of a real handler. We add a 4-line `openItemPanel(itemId)` (byte-for-byte mirror of `BoardTable`'s) that `pushState`s `?item=<id>` — History API, **no RSC re-run** — and feed it into the `shared` props object. 0 new server round-trips.

**Tech Stack:** Next.js 16 (App Router, RSC + client components), React 19, TypeScript (strict), `@dnd-kit/core` (calendar bars are draggable), Vitest + Testing Library, `@tanstack/react-query` (`useBoardCache`).

## Global Constraints

- **In-page state via History API, never router/`<Link>`:** opening/closing the item panel is client/URL state over already-loaded data — use `window.history.pushState`, which Next.js 16 syncs into `useSearchParams()` with **no RSC re-run**. A `router`/`<Link>` navigation would re-run every board query (AGENTS.md #5, gotcha-09). Verbatim rule.
- **0 new server round-trips** for opening an item (the opened item's fields come from the already-loaded `payload` cache that `BoardViews` reads).
- **TypeScript strict; no `any`** (the existing stub's `as ((id: string) => void) | undefined` cast goes away — the real function is typed by inference).
- **Tests are mandatory and must be executed:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green before merge.
- **Commit identity is pinned** by the worktree to `Danijel Jovanovic <info@synapse-solutions.ai>` — do not override.
- **Stage explicitly by path** — never `git add -A` / `git add .` / `git commit -a`.
- **Commit subject lowercase** after `type(scope):`; include a descriptive body + the `Co-Authored-By` trailer.

**Spec:** `docs/superpowers/specs/2026-06-25-calendar-open-item-design.md`

---

## File Structure

- **Modify:** `src/components/boards/CalendarBoard.tsx`
  - Add a module-scope `openItemPanel(itemId: string)` helper (above the `CalendarBoard` function), mirroring `BoardTable.openItemPanel` (`src/components/boards/BoardTable.tsx:211-215`), with the same History-API doc-comment.
  - In the `shared` object (~L218–226), replace `onOpenItem: undefined as ((id: string) => void) | undefined,` with `onOpenItem: openItemPanel,`.
  - No other change. The `shared` object already flows into `CalendarMonth` / `CalendarWeek` / `CalendarAgenda` (~L254–280).
- **Create (test):** `src/components/boards/CalendarBoard.test.tsx`
  - Board-level tests proving `CalendarBoard` supplies a real `onOpenItem` that pushes `?item=<id>` for a month-view chip click, an Enter keypress, and an agenda-row click.

No other files touched. **Do not** edit `EventBar`, `CalendarMonth`, `CalendarWeek`, `CalendarAgenda`, `BoardViews`, or `ItemPanel` — they are already correct; their leaf behavior is already unit-tested.

---

## Execution DAG

Single indivisible task (`T1`). No dependencies, no parallel batches, critical path = T1. **Do not** dispatch parallel agents — there is no concurrency to exploit.

---

### Task 1: Wire `CalendarBoard.onOpenItem` to open the item panel

**Files:**

- Modify: `src/components/boards/CalendarBoard.tsx` (add helper above the component; `shared` object ~L218–226)
- Test: `src/components/boards/CalendarBoard.test.tsx` (new)

**Interfaces:**

- Consumes:
  - `BoardTable.openItemPanel` pattern (`src/components/boards/BoardTable.tsx:211-215`) — the function to mirror: `function openItemPanel(itemId: string): void` that does `const url = new URL(window.location.href); url.searchParams.set("item", itemId); window.history.pushState({}, "", url);`.
  - `BoardViews`' read-side contract (`src/components/boards/BoardViews.tsx:81-90`) — it reads `searchParams.get("item")` and renders `<ItemPanel>`; setting `?item=<id>` is the entire open API. No change consumed beyond this contract.
  - Existing `shared` props object in `CalendarBoard` carrying `onOpenItem?: (id: string) => void` to `CalendarMonth`/`CalendarWeek`/`CalendarAgenda`.
- Produces: nothing for downstream tasks (terminal, single-task plan). After this task, `CalendarBoard`'s rendered calendar pushes `?item=<id>` to the URL on event click/keyboard-activation.

This task is TDD: write the failing month-view click test first, watch it fail (the URL has no `?item=` because the board passes `undefined`), then add the helper + wire it, then verify pass + add the keyboard and agenda guards.

---

- [ ] **Step 1: Inspect the exact source to mirror and the test-harness providers**

Read these so the test fixture and helper match production exactly:

- `src/components/boards/BoardTable.tsx:205-215` — the `openItemPanel` helper + its doc-comment (the thing to copy).
- `src/components/boards/CalendarBoard.tsx:74-127` and `~205-282` — the component props, the `useBoardCache` call, the `PointerSensor` activation constraint, the `shared` object, and how `mode` selects `CalendarMonth`/`CalendarWeek`/`CalendarAgenda` and `CalendarControls`.
- `src/components/boards/calendar/CalendarBoard`-adjacent tests for the provider pattern. Look at how `CalendarMonth.test.tsx` / `EventBar.test.tsx` render (they wrap in `<DndContext>` only). Because `CalendarBoard` calls `useBoardCache` (react-query) and may render presence-aware leaves, check whether a `QueryClientProvider` (and `BoardPresenceProvider`) is needed by trying the render in Step 3; if react-query throws "No QueryClient set", wrap with `QueryClientProvider` exactly as `KanbanBoard.test.tsx` does. If a presence-context error appears, wrap with `BoardPresenceProvider` using the same value shape the other board tests use. **Mirror whatever the existing board tests do — do not invent a new harness.**

No code change in this step.

- [ ] **Step 2: Write the failing "month-view chip click opens the item" test**

Create `src/components/boards/CalendarBoard.test.tsx`. Use a minimal payload with one date column and one single-day item inside the rendered month, so exactly one event chip renders. Reset the URL before each test so `?item=` assertions don't leak.

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CalendarBoard } from "./CalendarBoard";

// Minimal board payload: one group, one date column, one single-day item in
// June 2026. `cursorISO` seeds from the first dated cell, so the month renders
// June 2026 and the chip is visible.
function payloadFixture() {
  return {
    board: { id: "b1", org_id: "o1", name: "Board" },
    groups: [{ id: "g1", board_id: "b1", name: "Group", position: 0 }],
    columns: [
      {
        id: "d1",
        board_id: "b1",
        org_id: "o1",
        kind: "date",
        name: "Due",
        position: 0,
        settings: {},
      },
    ],
    items: [{ id: "i1", name: "Launch Day", group_id: "g1", position: 0 }],
    cellValues: [
      { item_id: "i1", column_id: "d1", value: { date: "2026-06-16" } },
    ],
    views: [
      {
        id: "v1",
        kind: "calendar",
        name: "Calendar",
        config: { date_column_id: "d1" },
      },
    ],
  } as never;
}

function renderCalendar() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <CalendarBoard payload={payloadFixture()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

function openItemParam() {
  return new URLSearchParams(window.location.search).get("item");
}

describe("CalendarBoard — open item", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("opens the item panel (sets ?item=<id>) when a month-view event is clicked", () => {
    renderCalendar();
    fireEvent.click(screen.getByText("Launch Day"));
    expect(openItemParam()).toBe("i1");
  });
});
```

If Step 1 found that a presence provider is required, wrap `<CalendarBoard>` in it here too — but try without first; add only what the render actually demands.

- [ ] **Step 3: Run the new test to verify it FAILS**

Run: `pnpm test -- CalendarBoard --run -t "opens the item panel"`

Expected: FAIL. `CalendarBoard` currently passes `onOpenItem: undefined`, so clicking the chip calls `onOpen?.(...)` → no-op; `window.location.search` stays empty and `openItemParam()` returns `null`, not `"i1"`.

(If instead the render itself throws — e.g. "No QueryClient set" or a missing presence context — fix the harness per Step 1 first, then re-run until the failure is the **assertion** failing, not the render.)

- [ ] **Step 4: Add the `openItemPanel` helper to `CalendarBoard.tsx`**

In `src/components/boards/CalendarBoard.tsx`, add this function at module scope, above the `export function CalendarBoard(` declaration (place it near the other module-scope helpers like `firstOfMonth`):

```tsx
/**
 * Open the item detail panel by setting `?item=<id>` via the History API — no
 * RSC navigation, so the board page's queries don't re-run (mirrors
 * `BoardTable`/`ViewSwitcher`). `BoardViews` reads the param and renders the panel.
 */
function openItemPanel(itemId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("item", itemId);
  window.history.pushState({}, "", url);
}
```

- [ ] **Step 5: Wire it into the `shared` object**

In the `shared` object (currently ~L218–226), replace the stubbed line:

```tsx
    onOpenItem: undefined as ((id: string) => void) | undefined,
```

with:

```tsx
    onOpenItem: openItemPanel,
```

(The surrounding `shared` object and all three view branches are unchanged.)

- [ ] **Step 6: Run the click test to verify it PASSES**

Run: `pnpm test -- CalendarBoard --run -t "opens the item panel"`

Expected: PASS. Clicking the chip now calls the real `openItemPanel("i1")`, which `pushState`s `?item=i1`; `openItemParam()` returns `"i1"`.

- [ ] **Step 7: Add the keyboard-activation test**

Add inside the `describe` block in `src/components/boards/CalendarBoard.test.tsx`:

```tsx
it("opens the item panel when an event is activated with Enter", () => {
  renderCalendar();
  const bar = screen.getByText("Launch Day").closest("div[tabindex]")!;
  fireEvent.keyDown(bar, { key: "Enter" });
  expect(openItemParam()).toBe("i1");
});
```

Run: `pnpm test -- CalendarBoard --run -t "activated with Enter"`

Expected: PASS. `EventBar`'s `handleKeyDown` calls `onOpen?.("i1")` → the real helper sets `?item=i1`.

- [ ] **Step 8: Add the agenda-row test**

The agenda view is reached by clicking the "Agenda" toggle in `CalendarControls`. Add inside the `describe` block:

```tsx
it("opens the item panel when an agenda row is clicked", () => {
  renderCalendar();
  // Switch to agenda mode via the controls toggle, then click the row.
  fireEvent.click(screen.getByRole("button", { name: /agenda/i }));
  fireEvent.click(screen.getByText("Launch Day"));
  expect(openItemParam()).toBe("i1");
});
```

Note: the agenda toggle's accessible name comes from `CalendarControls`. If the `/agenda/i` name match doesn't resolve, open `src/components/boards/calendar/CalendarControls.tsx` and use the exact label/`aria-label` the agenda toggle exposes (it is the third mode option alongside Month/Week). Do not change `CalendarControls` — adjust the test selector to match it.

Run: `pnpm test -- CalendarBoard --run -t "agenda row"`

Expected: PASS. The agenda row `<button>` calls `onOpenItem?.("i1")` → `?item=i1`.

- [ ] **Step 9: Run the full CalendarBoard suite**

Run: `pnpm test -- CalendarBoard --run`

Expected: PASS — all three new tests green.

- [ ] **Step 10: Run the full gate suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

Expected: all four pass.

- `typecheck`: removing the `as ((id: string) => void) | undefined` cast and assigning the concrete `openItemPanel` (typed `(itemId: string) => void`) satisfies the `onOpenItem?: (id: string) => void` prop on all three calendar subviews.
- `build`: confirms no client/server boundary regression (`CalendarBoard` is already `"use client"`; `window.history`/`window.location` are only touched inside the click/keydown handlers, which run client-side — never during SSR).

- [ ] **Step 11: Commit**

Stage **only** the two files you changed (never `git add -A`):

```bash
git add src/components/boards/CalendarBoard.tsx src/components/boards/CalendarBoard.test.tsx
git commit -m "feat(boards): open item panel from calendar events

Replace the CalendarBoard onOpenItem stub (passed undefined) with an
openItemPanel helper that sets ?item=<id> via the History API, mirroring
BoardTable. Clicking or keyboard-activating a single-day chip, multi-day
span, +N more row, or agenda row now opens the item detail panel with no
RSC refetch. Adds board-level tests for the click, Enter, and agenda paths.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

(Commit identity is pinned by the worktree — do not override the author.)

---

## Self-Review

- **Spec coverage:**
  - Single-day chip opens (month + week) → the wired `onOpenItem` reaches every `EventBar`; month-click proven in Step 2/6, week uses the identical `EventBar`/`onOpen` path. ✅
  - Multi-day span opens → each segment is an `EventBar` bound to the same `itemId`, wired identically; covered by construction + leaf tests in `EventBar.test.tsx`. ✅
  - "+N more" popover row opens → same `onOpenItem` prop into `DayMorePopover` (covered by `CalendarMonth.test.tsx` render + the board-level wiring proof); spec marks a dedicated board test optional. ✅
  - Agenda row opens → Step 8. ✅
  - Keyboard (Enter/Space) → Step 7 (Enter; Space path is the same `handleKeyDown` branch). ✅
  - History API, 0 round-trips, no router nav → helper uses `window.history.pushState` only; Global Constraints + spec budget. ✅
  - Panel close restores URL → unchanged `BoardViews.closeItem`; no task needed (explicit non-goal). ✅
  - Drag-vs-click → existing 6px `PointerSensor` constraint; no new code (spec Edge cases). ✅
  - No edits to leaf components / `BoardViews` / `ItemPanel` → File Structure forbids; no task touches them. ✅
- **Placeholder scan:** none — every code step shows full code; every run step shows the exact command + expected result. The two "if the harness/selector differs, match production" notes (Steps 1/2 providers, Step 8 agenda label) are explicit fallbacks with concrete resolution instructions, not deferred work.
- **Type consistency:** the helper is `openItemPanel(itemId: string): void`; assigned to `onOpenItem` which every subview types as `onOpenItem?: (id: string) => void` / `onOpen?: (itemId: string) => void` — compatible. The removed cast (`as ((id: string) => void) | undefined`) is no longer needed. Test helper names (`payloadFixture`, `renderCalendar`, `openItemParam`) are used consistently across all three tests.

---

## How to test this (manual, post-merge)

User-observable change. After this merges to `develop` (pull `develop`):

1. Open a board that has a **Date** column and at least one item with a date set, then switch to the **Calendar** view (Views → Calendar).
2. **Month view:** click a single-day event chip. Expected: the item detail panel slides open for that item, and the URL gains `?item=<id>`. Click a multi-day span (any visible segment, including one that continues into the next week and shows no text) → the same item opens.
3. **"+N more":** on a day with more events than fit, click the "+N more" link, then click an item in the popover → its panel opens.
4. **Week view:** switch to Week; click any event bar → its panel opens.
5. **Agenda view:** switch to Agenda; click any row → its panel opens.
6. **Keyboard:** Tab to an event bar (it shows a focus ring) and press Enter or Space → the panel opens.
7. **Drag still works:** press-and-drag an event bar across days → it reschedules (does **not** open the panel); a plain click (under ~6px of movement) opens it.
8. **Close restores the URL:** close the panel (X / Escape) → `?item=` is removed and the calendar is unchanged. Throughout, the calendar does **not** flash/reload (no RSC refetch) — only the panel opens/closes.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-25-calendar-open-item.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent for Task 1, review between TDD steps, fast iteration.

**2. Inline Execution** — execute Task 1 in this session via executing-plans, with a checkpoint before the gate run.

Given this is a single small task, inline execution is reasonable; subagent-driven still applies if delegating to conserve context.
