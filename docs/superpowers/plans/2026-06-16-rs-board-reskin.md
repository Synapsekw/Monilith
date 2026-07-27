# RS — Board Surfaces Dark Reskin (direction C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Monolith's existing board surfaces read like the Monday prototype in dark mode by applying the approved "direction C" density/treatment — a visual-only pass of `className`/constant edits on existing components.

**Architecture:** No new components, no logic/data-flow/routing changes. Every change is a localized `className` or constant edit on a component that already styles with Monolith semantic tokens. Correctness = the full existing test suite stays green + visual verification (the board tests assert behavior, not classes/pixels, so they must not regress). Per-row group/option colors remain DB-driven inline `style={{ backgroundColor }}`.

**Tech Stack:** Next.js 16, React 19, Tailwind v4 (semantic tokens in `globals.css`), shadcn/ui, dnd-kit, TanStack Table/Virtual.

**Reference:** spec `docs/superpowers/specs/2026-06-16-rs-board-reskin-design.md`; tokens already landed in the foundation pass (`shadow-card`, near-black `.dark` palette).

**Verification commands (used throughout):**

```bash
pnpm test -- src/components/boards     # scoped regression for a surface
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # full gate
```

**Do not commit unless the user asks** (repo rule overrides the skill's per-task commit; keep changes staged/working-tree until then). Steps below include commit commands for completeness — run them only with the user's go-ahead.

---

### Task 1: Board Table density (direction C)

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`
- Test (regression only): `src/components/boards/BoardViews.test.tsx`, `KanbanBoard.test.tsx`

- [ ] **Step 1: Run the board tests first (baseline green)**

Run: `pnpm test -- src/components/boards`
Expected: PASS (these assert behavior; capture the baseline before editing).

- [ ] **Step 2: Tighten row height**

Change the constant:

```ts
const ROW_HEIGHT = 36; // was 40 — direction C density
```

- [ ] **Step 3: Tighten the column-header row padding**

Name header cell — change `py-2` → `py-1.5`:

```tsx
<div className="bg-surface-muted sticky left-0 z-10 truncate px-4 py-1.5">
  Name
</div>
```

Data column header cells — change `py-2` → `py-1.5`:

```tsx
<div key={h.id} className="truncate border-l px-3 py-1.5">
  {h.columnDef.header}
</div>
```

- [ ] **Step 4: Tighten + bolden the group header**

Change `py-2` → `py-1.5` and `font-medium` → `font-semibold` on the group header button (keep the `boxShadow` color bar and everything else identical):

```tsx
<button
  className="bg-surface hover:bg-accent focus-visible:ring-ring sticky left-0 flex w-full items-center gap-2 border-b px-3 py-1.5 text-left text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
  style={{ boxShadow: `inset 3px 0 0 0 ${group.color}` }}
>
```

- [ ] **Step 5: Cleaner row + cell hover for near-black**

Data row — `hover:bg-accent/50` → `hover:bg-surface`:

```tsx
<div
  className="hover:bg-surface absolute top-0 left-0 grid w-full border-b transition-colors"
  style={{ height: ROW_HEIGHT, transform: `translateY(${vr.start}px)`, gridTemplateColumns: template }}
>
```

NameCell — `hover:bg-accent/60` → `hover:bg-surface-muted`:

```tsx
<div
  role="button"
  className="bg-surface hover:bg-surface-muted focus-visible:ring-ring sticky left-0 z-10 flex h-full cursor-pointer items-center truncate px-4 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
>
```

EditableCell — `hover:bg-accent/60` → `hover:bg-surface-muted`:

```tsx
<div
  role="button"
  className="hover:bg-surface-muted focus-visible:ring-ring flex h-full cursor-pointer items-center truncate border-l px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
>
```

- [ ] **Step 6: Run the board tests (verify no regression)**

Run: `pnpm test -- src/components/boards`
Expected: PASS (same count as Step 1).

- [ ] **Step 7: Commit (only if user asked)**

```bash
git add src/components/boards/BoardTable.tsx
git commit -m "feat(boards): tighten table to direction-C density (reskin)"
```

---

### Task 2: Status/dropdown pill treatment (single source of truth)

**Files:**

- Modify: `src/components/boards/cells/index.tsx` (CellRenderer `OptionPill`)
- Modify: `src/components/boards/cells/editors/index.tsx` (Status + Dropdown option buttons)
- Test (regression): `src/components/boards/cells/cells.test.tsx`, `cells/editors/editors.test.tsx`

- [ ] **Step 1: Run the cell + editor tests (baseline green)**

Run: `pnpm test -- src/components/boards/cells`
Expected: PASS.

- [ ] **Step 2: Update the renderer pill**

`OptionPill` — `px-2 py-0.5` → `px-2.5 py-0.5`:

```tsx
<span
  className="inline-flex max-w-full items-center truncate rounded-md px-2.5 py-0.5 text-xs font-medium text-white"
  style={{ backgroundColor: option.color }}
>
  {option.label}
</span>
```

- [ ] **Step 3: Match the Status editor option button**

`px-2 py-1` → `px-2.5 py-1` (resting pill reads identical to the renderer):

```tsx
<button
  className="focus-visible:ring-ring inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
  style={{ backgroundColor: o.color }}
>
  {o.label}
</button>
```

- [ ] **Step 4: Match the Dropdown editor toggle button**

`px-2 py-1` → `px-2.5 py-1` (keep the selected/unselected opacity logic):

```tsx
<button
  className={cn(
    "focus-visible:ring-ring inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium text-white transition-opacity focus-visible:ring-2 focus-visible:outline-none",
    isSelected ? "opacity-100" : "opacity-60 hover:opacity-90",
  )}
  style={{ backgroundColor: o.color }}
>
  {o.label}
</button>
```

- [ ] **Step 5: Run the cell + editor tests (verify no regression)**

Run: `pnpm test -- src/components/boards/cells`
Expected: PASS (same count as Step 1).

- [ ] **Step 6: Commit (only if user asked)**

```bash
git add src/components/boards/cells/index.tsx src/components/boards/cells/editors/index.tsx
git commit -m "feat(boards): unify status/dropdown pill treatment (reskin)"
```

---

### Task 3: Kanban card elevation + density

**Files:**

- Modify: `src/components/boards/KanbanBoard.tsx`
- Test (regression): `src/components/boards/KanbanBoard.test.tsx`

- [ ] **Step 1: Run the kanban tests (baseline green)**

Run: `pnpm test -- src/components/boards/KanbanBoard`
Expected: PASS.

- [ ] **Step 2: Card elevation + padding**

KanbanCard `<article>` — `p-2.5 shadow-sm` → `p-2 shadow-card`:

```tsx
<article
  className={cn(
    "bg-surface focus-visible:ring-ring cursor-grab rounded-md border p-2 text-left shadow-card transition-shadow focus-visible:ring-2 focus-visible:outline-none",
    isDragging && "opacity-50",
  )}
>
```

- [ ] **Step 3: Tighten the card summary row**

`mt-1.5 ... gap-2` → `mt-1 ... gap-1.5`:

```tsx
<div className="mt-1 flex flex-wrap items-center gap-1.5">
  {summaryColumns.map((col) => (
    <CellRenderer key={col.id} /* ...existing props unchanged... */ />
  ))}
</div>
```

- [ ] **Step 4: Run the kanban tests (verify no regression)**

Run: `pnpm test -- src/components/boards/KanbanBoard`
Expected: PASS (same count as Step 1).

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add src/components/boards/KanbanBoard.tsx
git commit -m "feat(boards): kanban card elevation + density (reskin)"
```

---

### Task 4: Chrome density (sidebar + board header)

**Files:**

- Modify: `src/components/boards/BoardsNav.tsx`
- Modify: `src/components/boards/BoardHeader.tsx`
- Test (regression): `src/components/boards/BoardsNav.test.tsx`

- [ ] **Step 1: Run the nav tests (baseline green)**

Run: `pnpm test -- src/components/boards/BoardsNav`
Expected: PASS.

- [ ] **Step 2: Tighten sidebar board rows + active treatment**

Board link — `py-1.5` → `py-1`, active `bg-accent text-foreground` → `bg-surface text-foreground`:

```tsx
<Link
  className={cn(
    "truncate rounded-md px-3 py-1 text-sm transition-colors",
    b.id === activeBoardId
      ? "bg-surface text-foreground"
      : "text-muted-foreground hover:bg-accent hover:text-foreground",
  )}
>
  {b.name}
</Link>
```

- [ ] **Step 3: Tighten the board header**

`py-3` → `py-2`:

```tsx
<header className="flex flex-col gap-2 border-b px-6 py-2">
  <h1 className="text-xl font-semibold tracking-tight">{boardName}</h1>
  <ViewSwitcher /* ...existing props unchanged... */ />
</header>
```

- [ ] **Step 4: Run the nav tests (verify no regression)**

Run: `pnpm test -- src/components/boards/BoardsNav`
Expected: PASS (same count as Step 1).

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add src/components/boards/BoardsNav.tsx src/components/boards/BoardHeader.tsx
git commit -m "feat(boards): tighten sidebar + board-header chrome (reskin)"
```

---

### Task 5: Full verification gate + visual confirmation

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: typecheck clean; lint 0 errors (2 known pre-existing TanStack/React-Compiler warnings allowed); all tests PASS; build succeeds.

- [ ] **Step 2: Visual verification (the real proof)**

Start the app (`pnpm dev`), open a board in **dark mode** (default), and confirm against the spec:

- table rows visibly tighter (36px), group titles bolder with the 3px color bar
- status pills slightly rounder/tighter, identical at rest and while editing
- kanban cards show soft `shadow-card` elevation
- sidebar/board-header read tighter
  Capture a before/after screenshot for the session note.

- [ ] **Step 3: Final commit (only if user asked)**

```bash
git add -A
git commit -m "chore(boards): RS reskin verification pass"
```

---

## Self-Review

- **Spec coverage:** Table density → Task 1; pill treatment (renderer+editor) → Task 2; kanban → Task 3; chrome → Task 4; testing/verification → Task 5. All four in-scope surfaces + verification covered. ✓
- **Placeholder scan:** every code step shows the full new `className`/value; no TBD/TODO. CellRenderer/ViewSwitcher prop spreads are explicitly marked "unchanged" rather than re-listed. ✓
- **Type/value consistency:** `ROW_HEIGHT = 36`, pills `px-2.5`, hovers `bg-surface`/`bg-surface-muted`, kanban `p-2 shadow-card` — used consistently across tasks and matching the spec table. ✓
- **Out of scope (unchanged):** ViewSwitcher routing (gotcha-09), new views/features, light mode, column widths. ✓
