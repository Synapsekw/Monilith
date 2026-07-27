# RS — Board surfaces dark reskin (direction C)

> Status: approved (design) · Date: 2026-06-16 · Workstream: **RS** (design refresh) ·
> Relates to: [`2026-06-16-decision-08-dark-first-monday-reskin`](../../../vault/decisions/2026-06-16-decision-08-dark-first-monday-reskin.md),
> master spec §6/§7, [`00-north-star`](../../../vault/00-north-star.md) §2.

## 1. Goal & scope

Make Monolith's existing board surfaces **read like the in-repo Monday prototype** in dark mode, by
applying a denser, higher-signal "direction C" treatment. This is a **visual-only** pass: it changes
`className`/token usage on components that already exist — **no** structural rewrites, **no** new
views/features, **no** logic or data-flow changes.

Why this is needed: the dark-token foundation already landed (palette ≈ prototype), but the app still
reads as the old Monolith board because the **component density/treatment** is unchanged. This pass
closes that gap.

**Surfaces in scope (all four):**

1. **Board Table** — `src/components/boards/BoardTable.tsx`
2. **Kanban** — `src/components/boards/KanbanBoard.tsx`
3. **Cells & editors** — `src/components/boards/cells/index.tsx`, `cells/editors/index.tsx`
4. **App chrome** — `src/components/app-shell.tsx`, `BoardHeader.tsx`, `BoardsNav.tsx`,
   `ViewSwitcher.tsx` (density/treatment only)

## 2. Non-goals

- **No new views/features** (Calendar, Timeline, Dashboard, ItemPanel, filter builder, automations,
  new column types, export) — those are separate, later workstream items.
- **No logic/data-flow/routing changes.** In particular, `ViewSwitcher`'s current `?view=` routing is
  **not touched** here; note it is independently flagged by
  [`gotcha-09-rsc-nav-refetch-on-view-switch`](../../../vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md)
  and will be addressed in a functional pass, not this visual one.
- **Light mode** stays functional but is not retuned in this pass (dark-first).
- **No raw colors.** Everything stays on Monolith semantic tokens (`bg-surface`, `border`,
  `text-muted-foreground`, `bg-status-*`); per-row group/option colors remain the existing inline
  `style={{ backgroundColor }}` driven by DB values. (pulse-ui invariant.)

## 3. Direction C — treatment decisions (the spec)

Decided via visual companion comparison; "C · Balanced" selected at **36px** row height.

| Element                         | Today                     | Direction C                                                                                    |
| ------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| Table row height (`ROW_HEIGHT`) | `40`                      | **`36`**                                                                                       |
| Column-header padding           | `py-2`                    | `py-1.5`                                                                                       |
| Group-header padding            | `py-2`                    | `py-1.5`                                                                                       |
| Group color bar                 | `inset 3px 0 0 0 {color}` | keep `3px`; title weight `font-semibold`                                                       |
| Status/dropdown pill            | `rounded-md px-2 py-0.5`  | `rounded-md px-2.5 py-0.5`, solid status bg, white text — identical in renderer **and** editor |
| Row hover                       | `hover:bg-accent/50`      | `hover:bg-surface` (cleaner lift on near-black)                                                |
| Cell gridlines                  | `border-l` present        | keep (subtle vertical separators)                                                              |
| Kanban card                     | `p-2.5 shadow-sm`         | `p-2 shadow-card` (prototype elevation)                                                        |
| Kanban card summary gap         | `mt-1.5 gap-2`            | `mt-1 gap-1.5`                                                                                 |
| Sidebar board row               | `py-1.5`                  | `py-1`; active `bg-surface text-foreground`                                                    |
| Board header                    | `py-3`                    | `py-2`                                                                                         |
| App-shell topbar                | `h-14`                    | unchanged                                                                                      |

Shared tokens already added in the foundation pass: `shadow-panel`/`shadow-card`,
`animate-fadein`/`animate-slidein`, dark scrollbar.

## 4. Per-surface change list (concrete)

Each is a localized `className`/constant edit; no new components.

- **BoardTable.tsx** — `ROW_HEIGHT = 36`; column-header & group-header `py-1.5`; group title
  `font-semibold`; data-row hover `hover:bg-surface`; Name-cell hover to match. `NAME_COL_WIDTH`/
  `VALUE_COL_WIDTH` unchanged.
- **CellRenderer (cells/index.tsx)** — `OptionPill` → `rounded-md px-2.5 py-0.5` (single source of pill
  truth).
- **CellEditor (editors/index.tsx)** — status/dropdown option buttons match the renderer pill
  (`px-2.5`), so resting and editing states are visually identical.
- **KanbanBoard.tsx** — card `p-2 shadow-card`; summary row `mt-1 gap-1.5`; column header label keeps
  pill treatment; column container unchanged.
- **app-shell.tsx / BoardsNav.tsx / BoardHeader.tsx** — sidebar row `py-1` + active `bg-surface`;
  board header `py-2`. Topbar height unchanged.

## 5. Testing & verification (mandatory)

A visual reskin's correctness = **no regressions + verified appearance**:

1. **Regression:** existing component tests must still pass — `BoardTable.test.tsx`,
   `KanbanBoard.test.tsx`, `cells.test.tsx`, `editors.test.tsx`. If any test asserts on a class/height
   I change (e.g. hardcoded `40`), update the assertion to the new value as part of the change (the
   test encodes the intended density).
2. **Full suite:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.
3. **Visual verification:** run the app and confirm the dark board reads as direction C (the real
   proof — the prior "looks the same" failure mode). Capture a before/after for the session note.

## 6. Out-of-scope follow-ups (tracked, not built here)

Calendar/Timeline/Dashboard views, ItemPanel, filter builder, automations, label editor, new column
kinds, export/import/templates — per the reuse map in decision-08. Each is its own brainstorm → spec →
plan. The `ViewSwitcher` refetch fix (gotcha-09) is a separate functional task.
