# Import Wizard v2 (Excel/CSV) — Design

Status: draft — designed autonomously, **awaiting user review** (see "Assumptions made in
your absence")
Date: 2026-07-03
Slug: `import-wizard-v2`
Supersedes the import half of `2026-06-25-board-spreadsheet-io-design.md` (v1)

## Problem

The v1 import (shipped 2026-06-26) is a minimal two-stage dialog: pick file → per-column
type dropdown + collapsed sample rows → create board. User feedback: "the UI is quite bad,
we are not able to select columns and rows and match to imported file and we need a
preview." Concretely, v1 cannot:

- **Select columns** — no include/skip, no renaming, no choosing which column is the item
  Name or the Group; a leading `Group`/`Name` header is auto-magic or nothing.
- **Select rows** — header is always row 1; no row exclusion; multi-sheet xlsx silently
  imports sheet 1 only.
- **Match to an existing board** — import always creates a new board; there is no
  file-column → board-column mapping at all.
- **Preview properly** — sample rows hide inside a collapsed `<details>` as plain text;
  no typed rendering, no visibility of which cells will fail to parse and be dropped.
- Detection never proposes `percent/currency/email/link/dropdown` (manual override only);
  UI is a raw `<select>`/`<table>` with a click-only file input (no dropzone).

## Goal

A three-step import wizard — **Upload → Select & Map → Preview & Confirm** — that imports
an `.xlsx`/`.csv` either into a **new board** or by **appending items to an existing
board**, with full column/row/sheet selection, a real spreadsheet-style preview grid with
typed cells and error highlighting, and smarter kind detection. Export → re-import
round-trip behavior is preserved.

## Assumptions made in your absence (review these first)

1. **Both destinations** (new board + existing board) — you were asked and AFK; I took the
   recommended option since "match to imported file" reads as the existing-board case.
2. **Append-only** into existing boards — no upsert/update-by-key matching (v3 material).
3. **Wizard lives in a wide dialog** (~`max-w-6xl`, ~85vh), not a full-page route.
4. **v1 caps kept**: ≤5 MB, ≤2000 rows, ≤40 columns; people/files/relation/mirror/
   time_tracking stay non-importable.
5. **Two milestones**: M1 (wizard UX, new-board destination — no migration) can ship
   alone and fixes most complaints; M2 (existing-board destination) needs one new RPC
   migration, which **you must apply manually** (agent DDL is classifier-blocked).

## Approaches considered

- **A. Incremental dialog enhancement** (new-board only): add column skip/rename, header
  row picker, grid preview to the existing dialog. Cheapest, but leaves "match to
  existing board" unsolved — half the complaint.
- **B. Wizard dialog, both destinations** — **recommended and chosen.** One
  `ImportWizard` replaces `ImportDialog`; two entry points; staged rollout M1 → M2.
  Reuses the entire v1 server pipeline (parse/detect/codec/payload) with targeted
  extensions.
- **C. Full-page route** (`/import`, Airtable-style): maximal real estate but new route
  plumbing, file-state-across-navigation complexity, and inconsistent with every other
  Monolith flow (dialog/sheet-based). Rejected as over-engineering at 2000-row scale.

## Architecture

### Entry points (2)

1. **New board → "Import from file"** (existing hook in `NewBoardDialog.tsx`) — opens the
   wizard with destination locked to _new board_.
2. **Board header, next to `ExportMenu`: "Import"** — opens the wizard with destination
   locked to _this board_ (M2). The board's columns are already in the page payload; no
   extra fetch.

### Wizard flow (one client component tree, `src/components/boards/import/`)

**Step 1 — Upload.** Drag-and-drop dropzone + click-to-browse (`.xlsx`/`.csv`, ≤5 MB,
client-side size/extension pre-check with immediate error). On file: one
`previewImport` call → parsed sheets land in client state → auto-advance to step 2.

**Step 2 — Select & Map.** Everything here is **client state, 0 server round-trips**:

- **Sheet tabs** across the top for multi-sheet xlsx (v1 dropped sheets 2+; now you pick).
- **Header row picker**: "Header row: [1 ▾]" (rows 1–10 offered) plus a "No header row"
  option that synthesizes `Column A/B/C…` names. Changing it re-runs detection client-side.
- **The mapping grid** — the centerpiece. A spreadsheet-style table (first 100 rows,
  scrollable, `overflow-x-auto`) whose **column headers are the mapping controls**:
  - include/exclude toggle (excluded columns render dimmed, not removed);
  - editable column name (defaults to the header cell);
  - kind select (shadcn-style popover select, the 12 `ImportableKind`s);
  - role badge: exactly one column is **Name** (required, pre-resolved like v1), at most
    one is **Group**; set via the header's menu ("Use as item name / Use as group").
  - _Existing-board mode (M2)_: each header instead maps to → an existing board column
    (auto-matched by normalized name equality + kind compatibility), or **＋ Create new
    column**, or **Skip**. Status/dropdown labels absent from the target column's options
    are appended as new options and flagged in the header ("+2 new options").
- **Row selection**: a leading checkbox column to exclude individual rows; rows above
  the chosen header row are implicitly excluded. Cells that will fail their column's kind parse
  render with a warning tint + tooltip reason; a one-click "Exclude N rows with invalid
  cells" chip is offered but not forced (invalid cells otherwise import as empty, as v1).

**Step 3 — Preview & Confirm.** Read-only typed preview grid (status pills, checkboxes,
formatted numbers/dates — reusing existing cell-rendering conventions) + a summary strip:
`N items · M subtasks · K columns (J new) · X invalid cells → empty`. New-board mode: board
name input (default = filename). Existing-board mode: target group picker (default: first
group; option "New group: Imported"). Confirm → `commitImport` → navigate to the board
(new server data → real navigation is correct) or `router.refresh()` for existing.

Back/forward between steps never re-uploads or refetches — the parsed sheets stay in
client state for the dialog's lifetime.

### Server changes

- **`previewImport` v2** (`spreadsheet-actions.ts`): parses **all sheets** (caps enforced
  per sheet), returns `{ sheets: [{ name, rowCount, colCount, grid }] }` where `grid` is
  the first **200 rows** of raw strings (bounded payload; commit re-parses the full file).
  Detection is **not** run server-side anymore — see next point.
- **`detect.ts` becomes client-shared.** It is already a pure module with no server deps;
  the wizard imports it directly so sheet/header-row changes re-detect with zero round
  trips (AGENTS.md #5). Detection upgrades: trailing-`%` samples → `percent`; leading
  currency symbols → `currency`; all-`@` → `email`; all-URL → `link`; consistently
  comma-separated small label sets → `dropdown`. Kept out (too magic): rating, phone.
- **`commitImport` v2** params: `{ fileBase64, fileName, sheetName, headerRow,
excludedRows: number[], columns: ColumnSpec[], destination }` where
  `ColumnSpec = { sourceIndex, name, kind, options?, role: "name" | "group" | "data",
target?: { columnId } | "create" | "skip" }` and
  `destination = { type: "new", workspaceId, boardName } | { type: "existing", boardId,
groupId | { newGroupName } }`. Zod-validated in `validations/board-spreadsheet.ts`.
  The file is re-sent and re-parsed on commit (stateless, as v1); server re-derives the
  payload from the raw file + specs, never trusting client-computed cell values.
- **New-board path (M1)**: unchanged pipeline — `buildImportPayload` (extended to honor
  sheet/header/exclusions/column specs) → `create_board_from_template` RPC → phase-2
  subitem insert with delete-on-failure. **No migration.**
- **Existing-board path (M2)**: one new RPC **`import_rows_into_board(p_board_id,
p_payload jsonb)`** — `security definer`, auth + org-membership checked (same pattern
  as `create_board_from_template`), transactionally: appends new columns (with settings/
  positions), appends missing status/dropdown options to mapped columns' settings,
  inserts items + subitems + cell_values into the target group. Atomic by construction —
  no manual-rollback phase (a partial append cannot be cascade-deleted like a fresh
  board, so the v1 rollback trick doesn't transfer; a transaction is the honest fix).
  Migration in `supabase/migrations/`, applied manually by the user, then `pnpm db:types`.

### Data model

No table changes. M2 adds one RPC migration only.

## Perf & data-fetching budget (AGENTS.md #5)

- **First paint**: unchanged — entry buttons render from existing data; opening the wizard
  is client state only.
- **Interactions**: exactly **two** server round-trips per import — `previewImport` on
  file drop and `commitImport` on confirm. Every in-wizard interaction (sheet tab, header
  row, include/exclude, rename, kind change, role change, row toggles, step navigation)
  is client state with **0 round-trips**; detection runs client-side on the already-held
  grid. No History-API involvement (transient dialog state, not shareable view state).
- **Server data changes**: commit is a Server Action; success navigates to the new board
  (RSC navigation — correct, it's new server data) or refreshes the current board.
- **Bounded**: preview payload ≤ 200 rows/sheet of strings under the 40-col cap; grid
  renders ≤100 rows (no virtualization needed at that bound); commit inserts via one RPC
  (+ one batched subitem insert on the M1 path). Caps checked before any DB work.

## Independent units (for the plan's execution DAG, AGENTS.md #6)

1. `parse-workbook` v2 — multi-sheet, header-row parameter, row exclusion (pure).
2. `detect` v2 — new inferences + explicit client-shareable contract (pure).
3. `build-import-payload` v2 — column specs (skip/rename/role), exclusions (pure).
4. Column-matching lib for existing boards — normalize/match/compatibility (pure, M2).
5. `import_rows_into_board` RPC migration + integration test (M2, user-applied).
6. Server actions + Zod v2 (consumes 1–5).
7. Wizard shell + step state (client).
8. Dropzone step (client).
9. Mapping-grid step (client — the big one).
10. Confirm step + summary (client).
11. Entry points (NewBoardDialog rewire + BoardHeader button).

1–5 are mutually independent; 7–10 are parallelizable against a props contract once 6's
types exist. The plan must synthesize the full DAG with batches and critical path.

## Error handling

- File too big / wrong extension / empty / unparseable → inline step-1 error, stay on
  step 1.
- Per-cell parse failures → visible in the grid (tint + tooltip), counted in the summary,
  imported as empty cells (v1 semantics) unless the row is excluded.
- No Name column resolvable → step 2 blocks advancing with an inline prompt to pick one.
- Commit failure → error banner on step 3, wizard state intact (no data lost, retry
  possible). M1 keeps delete-board-on-phase-2-failure; M2 RPC is transactional.
- Caps exceeded on a chosen sheet → step-2 banner naming the sheet and the cap.

## Testing (TDD, mandatory)

- **Pure modules**: table-driven Vitest for parse v2 (multi-sheet, header rows, CSV+xlsx),
  detect v2 (each new inference + non-regression on v1 rules), payload v2 (skip/rename/
  role/exclusions), matching lib (name normalization, kind compatibility, option merge).
- **Round-trip property preserved**: export(board) → wizard defaults → commit reproduces
  the board (existing test extended, not weakened).
- **Actions**: mocked-Supabase tests for both destinations, caps, malformed specs
  (e.g. two Name roles, target columnId not on board — must be rejected server-side).
- **RPC (M2)**: integration test against the test DB (same pattern as
  `dashboard_completion` RPC coverage), incl. cross-org rejection.
- **Components**: Testing-Library per step — dropzone accept/reject, header-row change
  re-detects, exclude column drops it from commit params, role reassignment, row
  exclusion, existing-board auto-match rendering, commit params snapshot.
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Non-goals (v2)

- Upsert/update existing items by key column (append-only).
- Importing people/files/relation/mirror/time_tracking (still text-or-skip).
- Google Sheets URLs, >5 MB files, >2000 rows, >40 columns, saved mapping templates,
  scheduled imports.
- Fixing invalid cells inline in the preview grid (view + exclude only).
