# Quiet Grid + Inter — board table redesign and app-wide type swap

**Date:** 2026-09-12
**Status:** Approved (design)
**Owner:** Danijel Jovanovic

## Summary

Two changes that ship together because they are judged together:

1. **Quiet Grid** — the board table drops its vertical cell rules, breathes (42px rows,
   16px gutters), and gains proper hover/edit affordances plus a clearer subitem treatment.
2. **Inter** replaces Nunito Sans as the application typeface, everywhere — not only in the
   table. JetBrains Mono stays as the mono/kicker face. The MONOLITH wordmark keeps Nunito 800.

Both were chosen from live in-browser prototypes: direction **Q1 "Pure"** (group identity stays
inline in the header row) with type system **T2 (Inter + JetBrains Mono)**.

This is a presentation change. No schema change, no new queries, no new server round-trips.

## Context

Today's table (`src/components/boards/table/`) paints a hairline under every row _and_ to the
left of every cell. The result reads as a spreadsheet cage: the grid competes with the data it
contains. Gutters are inconsistent (name cell 16px, data cells 12px, header 12px/6px), there is
no cell-level "this is editable" affordance, and the group colour appears only as a 3px inset on
the frozen name cell.

Nunito Sans is a rounded humanist face with soft numerals. At the 13–14px sizes a dense board
uses, it is the least crisp of the four candidates evaluated, and its figures do not align as
hard as the table's tabular-numeric columns need.

## Decisions

| Decision        | Choice                                                           |
| --------------- | ---------------------------------------------------------------- |
| Table direction | **Q1 "Pure"** — group identity inline in the header row          |
| Type system     | **T2** — Inter (UI) + JetBrains Mono (kickers/mono), unchanged   |
| Wordmark        | **Unchanged** — Nunito 800 (`src/lib/fonts.ts`), documented      |
| Scale scope     | Family swap global; full T2 scale in the table; heading tracking |
| Other views     | Kanban / Calendar / Gantt inherit the font only — no layout work |

### Why Q1 over the other three prototypes

Q2 ("Section", a titled band per group) costs ~44px of vertical space per group, which hurts on
boards with many groups. Q3 ("Ledger") drops the subitem well entirely and weakens parent↔child
containment. Q4 ("Studio") puts rounded cards inside the table, which fights the frozen Name
column. Q1 adds **zero** chrome height per group — the group title stays in the header row the
table already renders for every group — and keeps the existing component structure, so the diff
is geometry and type, not architecture.

### Why the wordmark stays Nunito

`src/lib/fonts.ts` loads Nunito 800 for the logotype only (nav `Brand`, landing hero, pricing
headline), with the letter I recut as the monolith slab. That is brand identity, not UI type.
Swapping it would change the mark itself. The exception is deliberate and must be documented in
code comments, or a later session will "fix" the inconsistency.

## Type system

### Global

- `src/app/layout.tsx` — `Nunito_Sans` → `Inter` from `next/font/google`, CSS variable
  `--font-nunito-sans` → `--font-inter`, weights 400–800, `subsets: ["latin"]`. JetBrains Mono
  block unchanged.
- `src/app/globals.css` — `--font-sans` and `--font-heading` both point at `var(--font-inter)`.
  Body gains `font-optical-sizing: auto`.
- **Heading tracking.** Inter runs wider than Nunito Sans at display sizes. Headings ≥24px get
  `letter-spacing: -0.02em`; UI text keeps `-0.011em` where the table specifies it. Applied via
  the existing global heading rules in `globals.css`, not per component.
- `src/components/landing/editorial-landing.module.css` — two `var(--font-nunito-sans)` sites
  become `var(--font-inter)`; the file's header comment is updated.
- Comments in `src/components/brand/brand.tsx` and
  `src/components/landing/landing-wordmark.tsx` state that Nunito 800 is the wordmark face and
  is intentionally NOT the UI font.
- `.claude/skills/pulse-ui/SKILL.md` — the typography section currently states Nunito Sans as
  the system font. It must be rewritten in the same commit; a stale skill re-breaks this the
  next time an agent styles a surface.

### Table scale (T2)

| Element              | Today                  | After                             |
| -------------------- | ---------------------- | --------------------------------- |
| Item name            | 14px / 400             | **13.5px / 500 / −0.011em**       |
| Data cell value      | 14px                   | **13px**                          |
| Column header kicker | mono caps 11px / .12em | **mono caps 10px / .12em, 74% α** |
| Group name           | 14px / 600             | **13.5px / 600**                  |
| Subitem name         | 14px / 400             | **13px / 400**                    |

Tabular numerals stay on every numeric, currency and date cell.

### The canvas measurer

`src/components/boards/table/BoardTableInner.tsx:444` sets
`ctx.font = "14px ui-sans-serif, system-ui, sans-serif"` to auto-fit the frozen Name column.
Those are the wrong metrics after this change, and the symptom is a mis-sized frozen column on
every board that has never had its width set by hand. It must be updated to the Inter stack at
the new name size (13.5px), read from the same source of truth as the rendered cell.

## Geometry — Quiet Grid

- `ROW_HEIGHT` (`table/shared.ts`) **36 → 42**. The virtualizer's `estimateSize` and
  `measureElement` already read the constant, so both follow.
- **Vertical rules removed.** Every `border-l` on a data cell, column header, rollup cell,
  summary cell and the add-column track is deleted — roughly 15 sites across `EditableCell`,
  `ItemRow`, `SortableSubitemRow`, `ColumnHeader`, `CreatedHeaderCell`, `RollupValueCell`,
  `SummaryRow`, `AddColumnMenu`. Column separation is carried by alignment alone.
  The frozen-column scroll shadow (`NAME_FREEZE_EDGE`) stays and becomes the only vertical
  separation in the table.
- **Row hairline** moves from a full-bleed `border-b` to an inset 1px line starting at 16px
  (aligned with the name text, not the frame edge) at 70% alpha.
- **Gutters** — data cells `px-3` → `px-4`; column header `px-3 py-1.5` → `px-4 pt-3.5 pb-2.5`.
  The name cell already sits at 16px.

### States

- **Hover (row):** existing wash stays. The frozen name cell gains a 2px periwinkle seam at
  x=0 that wipes in via `scaleY` over 280ms `ease-keystone`.
- **Selected:** unchanged semantics — 8% periwinkle wash plus the 3px accent bar. Precedence:
  the selected bar suppresses the hover seam, exactly as the Board Intelligence rule already
  suppresses the selected bar (`intelMatch === true && "before:hidden"` in `NameCell`).
- **Cell hover:** today's `hover:bg-surface-muted` full-bleed is replaced by an inset outline
  (`border-bright` + `state-hover`, 8px radius, 4px inset) that reads as "this cell is
  editable". Focus/edit styling is unchanged.
- Coarse pointers keep every existing `pointer-coarse:` bump; the taller row makes the 44px
  target easier, not harder.

### Subitems and groups

- Subitem band stays `bg-surface-sunken`. Name indent **32 → 40px**, with a 1px thread line and
  a short elbow per child so the parent↔child relationship survives the loss of vertical rules.
- Subitem rows **38px**.
- The add-subitem and add-item rows get the dashed-plus treatment from the prototype.
- The group header row keeps its current inline structure (chevron, name, count). The 3px inset
  group-colour rail on the frozen cell becomes an **8px colour dot** beside the name — the rail
  was a vertical rule in disguise.
- Collapsed-group rollups already ship (`table/GroupRollupRow.tsx`) and only inherit the new
  geometry. Collapsed-parent rollups (`RollupValueCell`) likewise.

## Performance and data-fetching budget

Required by working agreement #5.

- **First paint vs interaction.** Nothing here adds a fetch. Every change is CSS, a constant, or
  a font declaration. Hovering, selecting, expanding a parent and collapsing a group remain
  **0 new server round-trips**; they are the same client-state paths as today.
- **Does any interaction change server data?** No. No Server Action is added or modified.
- **Are hot-path reads bounded?** Unchanged. The table stays virtualized over the same cached
  board payload. Row height rises 36 → 42, so roughly **14% fewer rows render per viewport** —
  strictly less render work per screen, not more.
- **Memoization invariants must not regress.** `itemRowPropsEqual` and `cellControlsEqual` in
  `table/ItemRow.tsx` / `table/shared.ts` exist so a single cell edit re-renders one row, not the
  grid. No task may thread a new per-render object through `controls`, and no row-level code may
  read `controls.cache.cellValues` (the row's values come from `cellMap`).
- The one known re-render hazard is pre-existing and untouched: `template` is threaded to every
  row as an inline style, so a live column resize re-renders every visible row
  (`BoardTableInner.tsx` TODO(perf-follow-up)). This work must not make it worse.

## Execution DAG

Required by working agreement #6.

**Task 1 — Type system (global).**
Files: `src/app/layout.tsx`, `src/app/globals.css`,
`src/components/landing/editorial-landing.module.css`, `src/components/brand/brand.tsx`,
`src/components/landing/landing-wordmark.tsx`, `.claude/skills/pulse-ui/SKILL.md`.
Produces: the `--font-inter` variable and the heading-tracking rules.
Consumes: nothing.

**Task 2 — Cells, headers and footers.**
Files: `table/EditableCell.tsx`, `ColumnHeader.tsx`, `table/CreatedHeaderCell.tsx`,
`RollupValueCell.tsx`, `SummaryRow.tsx`, `AddColumnMenu.tsx`, `cells/index.tsx`.
Removes the vertical rules on those surfaces, applies the 16px gutters, the T2 cell/kicker
scale and the cell-hover outline.
Consumes: Task 1 (font variable).

**Task 3 — Rows and row states.**
Files: `table/ItemRow.tsx`, `table/NameCell.tsx`, `table/shared.ts`,
`table/BoardTableInner.tsx` (canvas measurer only).
`ROW_HEIGHT` 42, inset row hairline, hover seam, seam-vs-selected-bar precedence, name scale,
measurer font.
Consumes: Task 1.

**Task 4 — Subitems, add-rows and the group header.**
Files: `table/SubitemBlock.tsx`, `table/SortableSubitemRow.tsx`, `table/AddSubitemRow.tsx`,
`table/AddItemRow.tsx`, `table/GroupHeaderRow.tsx`, `table/GroupSection.tsx`,
`table/GroupRollupRow.tsx`.
Indent, thread + elbow, 38px subitem rows, dashed add-rows, group dot.
Consumes: Task 1.

**Batches.** Batch A: Task 1 alone (everything depends on the font variable). Batch B: Tasks 2,
3 and 4 in parallel — their file sets are disjoint, one owner per file. Batch C: whole-branch
review, then the four gates.

**Critical path:** Task 1 → Task 3 → review → gates.

Parallel tasks get their own worktrees off the task branch; the orchestrator rebases and
merges them one at a time (shared `database.types.ts` is not touched here, but the merge
discipline is unchanged).

## Tests

Every task ships tests that are written and executed.

- `ROW_HEIGHT` is 42 and the rendered row reflects it.
- No data cell, column header, rollup cell or summary cell carries a left border class.
- Hover seam and selected bar: a selected row renders the 3px bar and not the seam; the Board
  Intelligence rule still wins over both.
- Subitem rows render at 38px, indented 40px, with the thread element present.
- The name-column measurer uses the Inter stack (assert the font string, which is what silently
  drifted before).
- Existing board suites (`BoardTable.*.test.tsx`, `GroupSelectAll.temp-row.test.tsx`,
  `temp-row-readonly.test.tsx`, render-count) must stay green — in particular
  `BoardTable.render-count.test.tsx`, which is the guard on the memoization invariants above.
- jsdom renders no geometry. Anything that is genuinely about pixels (the inset hairline, the
  seam wipe, the frozen-column shadow) is verified in a real browser against the built CSS, not
  asserted in jsdom.

Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Out of scope

- Kanban, Calendar and Gantt layouts (font only).
- The item panel, dashboards, forms and the landing page beyond the font variable and heading
  tracking.
- The `template`-through-React resize hazard (`BoardTableInner.tsx` TODO) — pre-existing.
- Column width persistence, cell editor behaviour, any data or RLS change.

## Risks

- **A stale `pulse-ui` skill re-asserts Nunito.** Mitigated by rewriting it in the same branch.
- **The canvas measurer drifts silently.** A wrong font string does not fail typecheck and does
  not fail jsdom tests; it produces a subtly wrong frozen-column width. Hence an explicit test.
- **Losing vertical rules hurts wide boards** where a value sits far from its header. The frozen
  Name column plus per-column alignment carry it; if it reads badly at 8+ columns in the real
  app, the fallback is a very low alpha rule (≤6%) on data cells only — a token change, not a
  structural one.
- **AA contrast.** The 74%-opacity column kicker must still clear AA against `--surface` in both
  themes and in every theme preset. Verify before merge, via the existing contrast test path.

## How to test (manual)

Filled in at merge time, per the working agreement: which board to open, what to hover, expand
and collapse, and what should be visibly different — plus the light/dark and theme-preset pass.
