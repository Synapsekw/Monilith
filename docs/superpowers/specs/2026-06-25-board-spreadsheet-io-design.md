# Board ⇄ Spreadsheet (Export + Import) — Design

Status: approved design, awaiting plan
Date: 2026-06-25
Slug: `board-spreadsheet-io`
Branch: `task/board-spreadsheet-io`

## Goal

Let users **export a board** (with all groups, items, subtasks, and columns) to **.xlsx**
and **.csv**, and **import an .xlsx/.csv file** to create a **new board** with
auto-detected column types, behind a preview/confirm step. Export → re-import round-trips
back to the same structure.

## Decisions (from brainstorming)

1. **Both directions built** this work item — full export + import round-trip.
2. **Row shape (one sheet):** a leading `Group` column for row bands; a `Name` column
   where **subtasks are indented with a `↳ ` marker**; then one column per board column.
3. **Auto-detect column kinds** on import by sampling values.
4. **Export scope = always the full board** (ignores the active view's filters/sort/visible
   columns) — the clean source for round-trips.
5. **Import = preview/confirm dialog** with an editable per-column kind mapping.

## Key feasibility finding (no migration)

The repo already has an atomic, payload-driven board-creation RPC:
`create_board_from_template(p_workspace_id, p_name, p_template jsonb)`
(`supabase/migrations/20260618130000_create_board_from_template.sql`), fed by the
`TemplatePayload` type in `src/lib/boards/template-payload.ts`. It transactionally inserts
the board, groups, columns, **top-level** items, cells, and a "Main Table" view.

Import **reuses this RPC** for the bulk insert — **no new migration** (which matters:
applying migrations is a blocked/manual step in this repo). The RPC does not carry
`parent_id`, so **subtasks are inserted in a small second phase** with direct
RLS-scoped inserts into `items` (with `parent_id`) + `cell_values` — exactly what the
existing `addSubitem` action already does. On a phase-2 error, the freshly-created board
is **deleted** (cascade) and the action fails, giving effective atomicity.

## Architecture

### Data model (existing, unchanged)

`boards → groups → items (items.parent_id = single-level subtask) → columns`, cells in an
EAV `cell_values` table keyed by `(item_id, column_id)`. Column kinds: text, status,
people, date, numbers, dropdown, checkbox, rating, link, email, files, relation, mirror,
percent, time_entry. Full board read already exists:
`getBoardPayload(boardId)` in `src/lib/boards/queries.ts`.

### Library

**`exceljs`** (server-only) — reads + writes both xlsx and csv, pure JS, no native deps.
Used only inside Server Actions, so **zero client-bundle impact**.

### Pure modules (unit-tested — the core logic)

- `src/lib/boards/spreadsheet/types.ts` — shared types + constants
  (`ImportPreview`, `ColumnMapping`, caps: `MAX_BYTES = 5MB`, `MAX_ROWS = 2000`,
  `MAX_COLS = 40`, the `↳ ` subtask marker, the reserved `Group`/`Name` header labels).
- `src/lib/boards/spreadsheet/cell-codec.ts` — per-kind `toText(kind, value, settings, lookups)`
  and `toCell(kind, raw, settings)` codecs.
  - **Round-trips:** text, numbers, percent, status, dropdown, date, checkbox, rating,
    email, link.
  - **Export-only (rendered readable, imported as plain text):** people, relation, mirror,
    files, time_entry. Documented as lossy-on-import in v1.
- `src/lib/boards/spreadsheet/detect.ts` — infer column kind by sampling
  (all-numeric→numbers; TRUE/FALSE→checkbox; ISO/parseable dates→date; small repeated
  label set→status; else text); synthesize status/dropdown options (auto colors) from
  distinct values; split rows into top-level items vs `↳`-marked subtasks; reconstruct
  groups from the `Group` column (or one default group if absent). First non-Group column
  is the item `Name`.
- `src/lib/boards/spreadsheet/export-workbook.ts` — `BoardPayload` → exceljs workbook →
  Buffer (xlsx and csv), using `cell-codec.toText`.
- `src/lib/boards/spreadsheet/parse-workbook.ts` — file Buffer → `rows[][]` (xlsx + csv;
  **first sheet only** in v1, surfaces a `droppedSheets` note).
- `src/lib/boards/spreadsheet/build-import-payload.ts` — detected columns + rows →
  `{ templatePayload: TemplatePayload, subitems: SubitemSeed[] }` (reuses the existing
  `TemplatePayload` shape; subitems carry `parentId`, `groupId`, `name`, `position`, cells).

### Server Actions — `src/lib/boards/spreadsheet-actions.ts` (Zod at the boundary)

- `exportBoard({ boardId, format: 'xlsx' | 'csv' })` → `getBoardPayload` →
  `export-workbook` → `{ fileName, base64, mime }`. Client decodes to a Blob and downloads
  via a temporary anchor. (A download is a genuine server op, not a view toggle — the
  round-trip is correct; the read is the already-bounded board query.)
- `previewImport({ fileBase64, fileName })` → `parse-workbook` + `detect` →
  `ImportPreview { boardName, columns:[{ header, detectedKind, sampleValues }], rowCount,
sampleRows, droppedSheets }`. Enforces the size/row/column caps; rejects oversize files
  with a clear error.
- `commitImport({ fileBase64, fileName, workspaceId, boardName, columnMappings })` →
  `build-import-payload` → `create_board_from_template` (atomic bulk) → **phase 2**: batch
  insert subtasks + their cells (RLS-scoped) → on phase-2 error, delete the board and fail.
  Returns `{ boardId }`.

Validation schemas live in `src/lib/validations/board-spreadsheet.ts`.

### UI (pulse-ui + frontend-design)

- **Export:** a dropdown in `src/components/boards/BoardHeader.tsx` (next to
  Automations/Share) — "Export → Excel (.xlsx) / CSV (.csv)". Calls `exportBoard`, decodes
  base64 → Blob → browser download. Available to viewers and up.
- **Import:** an **"Import from file"** entry on the board-creation surface (the sidebar
  "New board" flow / boards index — the build task pins the exact host file). Opens
  `src/components/boards/import/ImportDialog.tsx`: file picker → `previewImport` → a preview
  table with **editable per-column kind dropdowns** + sample rows + any `droppedSheets` /
  re-sort caveats → Confirm → `commitImport` → `router.push` to the new board.

## Perf & data-fetching budget (AGENTS.md #5)

- **First paint:** unchanged — no new server work on the board page or board list; the
  Export button and Import entry render with existing data.
- **Interactions:** opening either dialog is **client state only, 0 server round-trips**.
  Export download, import preview, and import commit are **explicit user actions** where a
  server op is appropriate (mutation/heavy read). Opening dialogs never navigates.
- **Server data vs client state:** export = read-only Server Action (no revalidation);
  import commit = Server Action that creates a board, then a real RSC navigation to the new
  board (correct — new server data). No History-API view-toggle concerns here.
- **Bounded/indexed:** export reuses the existing bounded `getBoardPayload`. Import is
  bounded by explicit caps (≤5 MB, ≤2000 rows, ≤40 columns) checked before any DB work; the
  file re-sent on commit is small/bounded. Inserts go through the atomic RPC + a single
  batched subtask insert (no per-row round-trips).

## Execution DAG (AGENTS.md #6)

Tasks and dependency edges:

- **T1** — `types.ts` (shared types/constants) + add `exceljs` dep. _Consumes: nothing.
  Produces: types, caps, marker constants._
- **T2** — `cell-codec.ts`. _Consumes: T1. Produces: per-kind codecs._
- **T3** — `detect.ts`. _Consumes: T1. Produces: kind detection, option synthesis, row
  splitting._
- **T5** — `parse-workbook.ts`. _Consumes: T1, exceljs. Produces: file→rows parser._
- **T4** — `export-workbook.ts`. _Consumes: T1, T2, exceljs. Produces: payload→workbook._
- **T6** — `build-import-payload.ts`. _Consumes: T1, T2, T3. Produces: rows→payload+subitems._
- **T7** — `spreadsheet-actions.ts` + `validations/board-spreadsheet.ts`.
  _Consumes: T4, T5, T6. Produces: exportBoard / previewImport / commitImport._
- **T8** — Export UI (BoardHeader dropdown + download helper). _Consumes: T7._
- **T9** — Import UI (entry + ImportDialog + navigate). _Consumes: T7._

Parallel batches (each batch = one wave of concurrent agents):

- **Batch 1:** T1
- **Batch 2:** T2 · T3 · T5 (disjoint files, all depend only on T1)
- **Batch 3:** T4 · T6 (disjoint files)
- **Batch 4:** T7
- **Batch 5:** T8 · T9 (disjoint files)

Critical path: **T1 → T6 → T7 → T9** (4 deep). Wall-clock floor = that chain.

## Testing (TDD, mandatory)

- **Pure modules (T2–T6):** Vitest unit tests, including a **round-trip property**:
  `parse(export(payload))` reconstructs the same groups/items/subtasks/typed cells for the
  round-tripping kinds. Fixtures: a small xlsx and csv committed under
  `src/lib/boards/spreadsheet/__fixtures__/`.
- **Detection:** table-driven tests for each inference rule + option synthesis + subtask
  indent parsing + group reconstruction (including no-`Group`-column fallback).
- **Actions (T7):** unit tests with the Supabase client mocked — happy path + caps
  rejection + phase-2-failure-deletes-board.
- **UI (T8, T9):** Testing-Library component tests — export dropdown triggers the action +
  download; ImportDialog renders preview, allows kind edits, calls `commitImport`, navigates.
- All four gates green before finish: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Explicit v1 non-goals

- People/relation/mirror/files/time-entry columns export as readable text but **import as
  plain text** (no entity resolution / re-linking).
- Multi-sheet workbooks import **sheet 1 only** (others surfaced as `droppedSheets`).
- Import relies on **row order** to attach subtasks (re-sorting an exported file before
  re-import can detach subtasks) — surfaced as a caveat in the dialog.
- No scheduled/automated export, no server-side file storage of exports (download is
  in-memory), no append-to-existing-board import (always creates a new board).
