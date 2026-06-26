# Board ⇄ Spreadsheet (Export + Import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a board (groups/items/subtasks/columns) to .xlsx/.csv, and import an .xlsx/.csv file into a new board with auto-detected column kinds behind a preview/confirm dialog.

**Architecture:** Pure, unit-tested modules under `src/lib/boards/spreadsheet/` do all format/detection logic (no Supabase). Three Server Actions wrap them: `exportBoard` (read → workbook → base64 download), `previewImport` (parse → detect), `commitImport` (build payload → existing `create_board_from_template` RPC for the atomic bulk + a second RLS-scoped insert phase for subtasks, with board-delete-on-failure). UI: an Export dropdown in `BoardHeader` and an "Import from file" entry in `NewBoardDialog` opening a new `ImportDialog`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript (strict), Zod 4, Supabase, `exceljs` (new, server-only), Vitest + Testing-Library.

## Global Constraints

- **No schema migration.** Import reuses `create_board_from_template(p_workspace_id, p_name, p_template jsonb)`; subtasks use direct RLS-scoped inserts into `items`/`cell_values` (as `addSubitem` does). Never edit `src/types/database.types.ts` by hand.
- **`exceljs` is server-only** — imported only by modules under `src/lib/boards/spreadsheet/` that are themselves only imported by `"use server"` actions. Never import it into a client component.
- **Validate at boundaries with Zod**; TypeScript strict, avoid `any`.
- **Caps (reject before any DB work):** `MAX_BYTES = 5 * 1024 * 1024`, `MAX_ROWS = 2000`, `MAX_COLS = 40`.
- **Reserved headers / marker (exact):** `Group`, `Name`, subtask marker `"↳ "` (U+21B3 + space).
- **Importable kinds (round-trip):** `text, numbers, percent, status, dropdown, date, checkbox, rating, email, link, phone`. People/relation/mirror/files/time_tracking are **export-structure-only**: their column header is preserved but cells export **blank** and re-import as `text` (v1 limitation).
- **Cell value shapes (from `src/lib/validations/boards.ts`, exact):** text `{text}`, numbers `{n}`, percent `{percent:0..100}`, status `{optionId:string|null}`, dropdown `{optionIds:string[]}`, date `{date:"YYYY-MM-DD", end?}`, checkbox `{checked}`, rating `{rating:1..5 int}`, email `{email}`, link `{url, text?}`, phone `{phone}`. Status/dropdown column settings: `{options:[{id,label,color}]}`.
- **Option colors:** use `OPTION_COLORS` / `nextOptionColor(used)` from `src/lib/boards/option-colors.ts`.
- **Commit hygiene:** stage by path (`git add <paths>`), never `-A`/`.`/`-a`. Commit subject lowercase after `type(scope):`; include a descriptive body and the trailer `Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>`. Identity is pinned by the worktree.
- **UI:** follow `pulse-ui` — shadcn `Dialog`, `DropdownMenu`, `Button`, `Select`; lucide icons; monochrome + single accent.

---

## File Structure

| File                                                 | Responsibility                                   | Task |
| ---------------------------------------------------- | ------------------------------------------------ | ---- |
| `src/lib/boards/spreadsheet/types.ts`                | shared types + constants/caps                    | T1   |
| `src/lib/boards/spreadsheet/cell-codec.ts`           | per-kind `cellToText` / `textToCell`             | T2   |
| `src/lib/boards/spreadsheet/detect.ts`               | `detectColumns`, `splitRows`                     | T3   |
| `src/lib/boards/spreadsheet/parse-workbook.ts`       | file Buffer → `ParsedSheet` (exceljs)            | T5   |
| `src/lib/boards/spreadsheet/export-workbook.ts`      | `BoardPayload` → workbook Buffer (exceljs)       | T4   |
| `src/lib/boards/spreadsheet/build-import-payload.ts` | `ParsedSheet` + mappings → `ImportPayload`       | T6   |
| `src/lib/validations/board-spreadsheet.ts`           | Zod schemas for the three actions                | T7   |
| `src/lib/boards/spreadsheet-actions.ts`              | `exportBoard` / `previewImport` / `commitImport` | T7   |
| `src/components/boards/ExportMenu.tsx`               | export dropdown + download helper                | T8   |
| `src/components/boards/BoardHeader.tsx` (modify)     | mount `ExportMenu`                               | T8   |
| `src/components/boards/import/ImportDialog.tsx`      | preview/confirm/commit dialog                    | T9   |
| `src/components/boards/NewBoardDialog.tsx` (modify)  | "Import from file" entry                         | T9   |

Tests live next to each file as `*.test.ts(x)`. Fixtures in `src/lib/boards/spreadsheet/__fixtures__/`.

---

## Task 1: Shared types + constants + exceljs dep

**Files:**

- Create: `src/lib/boards/spreadsheet/types.ts`
- Modify: `package.json` (add `exceljs`)
- Test: `src/lib/boards/spreadsheet/types.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces (exact):

  ```ts
  export const SUBTASK_MARKER = "↳ ";
  export const GROUP_HEADER = "Group";
  export const NAME_HEADER = "Name";
  export const MAX_BYTES = 5 * 1024 * 1024;
  export const MAX_ROWS = 2000;
  export const MAX_COLS = 40;
  export type ImportFormat = "xlsx" | "csv";
  export type ImportableKind =
    | "text"
    | "numbers"
    | "percent"
    | "status"
    | "dropdown"
    | "date"
    | "checkbox"
    | "rating"
    | "email"
    | "link"
    | "phone";
  export const IMPORTABLE_KINDS: ImportableKind[] = [
    "text",
    "numbers",
    "percent",
    "status",
    "dropdown",
    "date",
    "checkbox",
    "rating",
    "email",
    "link",
    "phone",
  ];
  export type SynthOption = { id: string; label: string; color: string };
  export type DetectedColumn = {
    header: string;
    kind: ImportableKind;
    options: SynthOption[];
    sampleValues: string[];
  };
  export type ColumnMapping = {
    header: string;
    kind: ImportableKind;
    options: SynthOption[];
  };
  export type ParsedSheet = {
    header: string[];
    rows: string[][];
    droppedSheets: string[];
  };
  export type ImportPreview = {
    boardName: string;
    columns: DetectedColumn[];
    rowCount: number;
    sampleRows: string[][];
    droppedSheets: string[];
  };
  ```

- [ ] **Step 1: Add the dependency**

Run: `pnpm add exceljs` then `pnpm add -D @types/node` is already present — skip. Verify `exceljs` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

```ts
// types.test.ts
import { describe, it, expect } from "vitest";
import { SUBTASK_MARKER, IMPORTABLE_KINDS, MAX_COLS } from "./types";

describe("spreadsheet types", () => {
  it("exposes the subtask marker and caps", () => {
    expect(SUBTASK_MARKER).toBe("↳ ");
    expect(MAX_COLS).toBe(40);
  });
  it("lists 11 importable kinds without people/relation/mirror/files/time_tracking", () => {
    expect(IMPORTABLE_KINDS).toHaveLength(11);
    expect(IMPORTABLE_KINDS).not.toContain("people");
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`pnpm test src/lib/boards/spreadsheet/types.test.ts` → cannot find `./types`).
- [ ] **Step 4: Create `types.ts`** with the Produces block above.
- [ ] **Step 5: Run it — expect PASS.**
- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/boards/spreadsheet/types.ts src/lib/boards/spreadsheet/types.test.ts
git commit -m "feat(boards): add spreadsheet io types and exceljs dep

Shared constants, caps, and types for board spreadsheet export/import.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

## Task 2: Cell codec (cellToText / textToCell)

**Files:**

- Create: `src/lib/boards/spreadsheet/cell-codec.ts`
- Test: `src/lib/boards/spreadsheet/cell-codec.test.ts`

**Interfaces:**

- Consumes: T1 (`ImportableKind`, `SynthOption`); `ColumnKind` from `@/lib/validations/boards`; `Json` from `@/types/database.types`.
- Produces (exact):
  ```ts
  /** Render a stored cell value as a flat spreadsheet string. "" for blank/non-rendered kinds. */
  export function cellToText(
    kind: ColumnKind,
    value: unknown,
    settings: unknown,
  ): string;
  /** Parse a raw spreadsheet string into a cell value Json for an importable kind, or null when empty/invalid. */
  export function textToCell(
    kind: ImportableKind,
    raw: string,
    options: SynthOption[],
  ): Json | null;
  ```

**Behavior (must implement, exact):**

- `cellToText`:
  - text→`value.text`; numbers→`String(value.n)`; percent→`String(value.percent)`; rating→`String(value.rating)`; phone→`value.phone`; email→`value.email`; link→`value.text || value.url` (export the url when no label); date→`value.date` (ignore `end`); checkbox→`value.checked ? "TRUE" : "FALSE"`; status→label of `settings.options` whose `id===value.optionId` (or ""); dropdown→labels of matching `optionIds` joined `", "`.
  - people/relation/mirror/files/time_tracking → `""`.
  - Any missing/malformed value → `""` (never throw).
- `textToCell` (trims raw; empty → `null`):
  - text→`{text:raw}`; numbers→`Number(raw)` finite else null → `{n}`; percent→clamp 0..100 → `{percent}`; rating→round, clamp 1..5 → `{rating}`; phone→`{phone:raw}`; email→`{email:raw}` only if it contains "@" else null; link→`{url:raw}` only if `isHttpUrl(raw)` (import from boards validations) else null; date→ISO if `/^\d{4}-\d{2}-\d{2}$/` or `new Date(raw)` parses → `{date:iso}` else null; checkbox→`{checked:true}` for `true/yes/✓/x/1` (case-insensitive), `{checked:false}` for `false/no/0/""`-ish, else null; status→find option by case-insensitive label match → `{optionId:id}` else null; dropdown→split raw on `,`, map each trimmed token to an option id, drop misses → `{optionIds}` (null if none).

- [ ] **Step 1: Write failing tests** (representative — write one per branch):

```ts
import { describe, it, expect } from "vitest";
import { cellToText, textToCell } from "./cell-codec";

const status = { options: [{ id: "o1", label: "Done", color: "#00c875" }] };

describe("cellToText", () => {
  it("renders status label", () => {
    expect(cellToText("status", { optionId: "o1" }, status)).toBe("Done");
  });
  it("renders checkbox as TRUE/FALSE", () => {
    expect(cellToText("checkbox", { checked: true }, {})).toBe("TRUE");
  });
  it("renders people as blank", () => {
    expect(cellToText("people", { userIds: ["u1"] }, {})).toBe("");
  });
  it("never throws on malformed value", () => {
    expect(cellToText("numbers", null, {})).toBe("");
  });
});

describe("textToCell", () => {
  it("parses numbers", () =>
    expect(textToCell("numbers", "42", [])).toEqual({ n: 42 }));
  it("rejects non-numeric numbers", () =>
    expect(textToCell("numbers", "x", [])).toBeNull());
  it("maps status label to option id", () =>
    expect(
      textToCell("status", "done", [
        { id: "o1", label: "Done", color: "#000" },
      ]),
    ).toEqual({ optionId: "o1" }));
  it("parses checkbox truthies", () =>
    expect(textToCell("checkbox", "Yes", [])).toEqual({ checked: true }));
  it("rejects non-http links", () =>
    expect(textToCell("link", "javascript:1", [])).toBeNull());
  it("returns null for empty", () =>
    expect(textToCell("text", "  ", [])).toBeNull());
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `cell-codec.ts`** per Behavior (reuse `isHttpUrl` from `@/lib/validations/boards`). No throws.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** (`feat(boards): add spreadsheet cell codec`).

---

## Task 3: Detection (detectColumns / splitRows)

**Files:**

- Create: `src/lib/boards/spreadsheet/detect.ts`
- Test: `src/lib/boards/spreadsheet/detect.test.ts`

**Interfaces:**

- Consumes: T1 (`DetectedColumn`, `SynthOption`, `ImportableKind`, `GROUP_HEADER`, `NAME_HEADER`, `SUBTASK_MARKER`); `nextOptionColor` from `@/lib/boards/option-colors`.
- Produces (exact):

  ```ts
  /** Detect a kind + synthesized options for every NON-structural column (all columns
   *  except a leading `Group` and the `Name` column). Indexed to align with header. */
  export function detectColumns(
    header: string[],
    rows: string[][],
  ): DetectedColumn[];

  export type SplitRows = {
    groups: string[]; // distinct group names, in first-seen order
    items: { group: string; name: string; cells: string[] }[]; // top-level, cells aligned to data columns
    subitems: { parentIndex: number; name: string; cells: string[] }[]; // parentIndex → items[]
    dataHeaders: string[]; // header minus Group & Name, in order
  };
  /** Resolve structural columns + subtask nesting from row order. */
  export function splitRows(header: string[], rows: string[][]): SplitRows;
  ```

**Behavior:**

- Structural columns: a column whose header equals `Group` (case-insensitive) is the group band; the first column whose header equals `Name` (case-insensitive), or else the first non-Group column, is the name. All remaining columns are data columns (order preserved) → `dataHeaders`.
- `detectColumns` returns one `DetectedColumn` per data column. Detection by sampling up to 50 non-empty values:
  - all parse as finite numbers → `numbers`;
  - all in {`true,false,yes,no,1,0,✓,x`} (ci) → `checkbox`;
  - all match `^\d{4}-\d{2}-\d{2}$` or `Date.parse` ok → `date`;
  - else distinct non-empty count ≤ 12 **and** ≤ half the sampled count → `status`, with `options` = distinct labels each `{id: crypto.randomUUID(), label, color: nextOptionColor(used)}`;
  - else → `text`. (`email`/`link`/`phone`/`percent`/`dropdown`/`rating` are not auto-detected in v1 — user can switch a column to them in the dialog; the mapping still carries synthesized options for status/dropdown.)
- `splitRows`: iterate data rows in order. A row is a **subtask** when its Name cell starts with `SUBTASK_MARKER` (after trim of leading spaces); strip the marker for the stored name; attach to the most recent top-level item (same `group`); if none precedes it, promote to top-level. Else it's a top-level item. `group` = the Group cell value or `"Imported"` when no Group column. `groups` = distinct group names in first-seen order. `cells` = the row's data-column values aligned to `dataHeaders` (missing → "").

- [ ] **Step 1: Write failing tests:**

```ts
import { describe, it, expect } from "vitest";
import { detectColumns, splitRows } from "./detect";
import { SUBTASK_MARKER } from "./types";

const header = ["Group", "Name", "Status", "Count"];
const rows = [
  ["Backlog", "Build login", "Working", "3"],
  ["Backlog", SUBTASK_MARKER + "Design form", "Done", "1"],
  ["Backlog", "Fix nav", "Done", "2"],
];

it("detects numbers and status columns", () => {
  const cols = detectColumns(header, rows);
  expect(cols.map((c) => c.header)).toEqual(["Status", "Count"]);
  expect(cols[1].kind).toBe("numbers");
  expect(cols[0].kind).toBe("status");
  expect(cols[0].options.length).toBe(2); // Working, Done
});

it("splits subtasks by marker and row order", () => {
  const s = splitRows(header, rows);
  expect(s.items.map((i) => i.name)).toEqual(["Build login", "Fix nav"]);
  expect(s.subitems).toEqual([
    { parentIndex: 0, name: "Design form", cells: ["Done", "1"] },
  ]);
  expect(s.groups).toEqual(["Backlog"]);
  expect(s.dataHeaders).toEqual(["Status", "Count"]);
});

it("falls back to one default group when no Group column", () => {
  const s = splitRows(["Name", "Status"], [["A", "Done"]]);
  expect(s.groups).toEqual(["Imported"]);
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `detect.ts`.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** (`feat(boards): add spreadsheet column detection`).

---

## Task 5: Parse workbook (file → ParsedSheet)

> (Numbered T5 to match the DAG; it is in Batch 2 with T2/T3.)

**Files:**

- Create: `src/lib/boards/spreadsheet/parse-workbook.ts`
- Create fixtures: `src/lib/boards/spreadsheet/__fixtures__/make-fixtures.ts` (a tiny script invoked by the test to build buffers in-memory — no binary committed)
- Test: `src/lib/boards/spreadsheet/parse-workbook.test.ts`

**Interfaces:**

- Consumes: T1 (`ParsedSheet`); `exceljs`.
- Produces (exact):
  ```ts
  /** Parse the FIRST worksheet of an xlsx/csv buffer into header + string rows.
   *  Other sheets are reported in `droppedSheets`. Trailing empty rows/cols trimmed.
   *  Throws Error('empty') when there is no header row. */
  export async function parseWorkbook(
    buf: Buffer,
    fileName: string,
  ): Promise<ParsedSheet>;
  ```

**Behavior:**

- `.csv` (by extension) → `const wb = new ExcelJS.Workbook(); await wb.csv.read(Readable.from(buf.toString("utf8")))`; else `await wb.xlsx.load(buf)`.
- Take `wb.worksheets[0]`. `droppedSheets` = names of `wb.worksheets.slice(1)`.
- Row 1 = header (string of each cell via `cell.text`); data = rows 2..n. Convert every cell to string via `cell.text` (exceljs renders dates/numbers). Right-trim empty trailing columns to header length. Skip fully-empty rows.

- [ ] **Step 1: Write failing test** (build an xlsx buffer with exceljs in-test, parse it back):

```ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseWorkbook } from "./parse-workbook";

async function xlsxBuf(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

it("parses header and rows from xlsx", async () => {
  const buf = await xlsxBuf([
    ["Name", "Status"],
    ["A", "Done"],
  ]);
  const out = await parseWorkbook(buf, "b.xlsx");
  expect(out.header).toEqual(["Name", "Status"]);
  expect(out.rows).toEqual([["A", "Done"]]);
  expect(out.droppedSheets).toEqual([]);
});

it("parses csv", async () => {
  const out = await parseWorkbook(
    Buffer.from("Name,Status\nA,Done\n"),
    "b.csv",
  );
  expect(out.header).toEqual(["Name", "Status"]);
  expect(out.rows).toEqual([["A", "Done"]]);
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `parse-workbook.ts`** (import `ExcelJS from "exceljs"`, `Readable` from `node:stream`).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** (`feat(boards): add spreadsheet workbook parser`).

---

## Task 4: Export workbook (BoardPayload → Buffer)

**Files:**

- Create: `src/lib/boards/spreadsheet/export-workbook.ts`
- Test: `src/lib/boards/spreadsheet/export-workbook.test.ts`

**Interfaces:**

- Consumes: T1 (`ImportFormat`, `GROUP_HEADER`, `NAME_HEADER`, `SUBTASK_MARKER`); T2 (`cellToText`); `BoardPayload` from `@/lib/boards/queries`; `exceljs`.
- Produces (exact):
  ```ts
  export async function buildExportWorkbook(
    payload: BoardPayload,
    format: ImportFormat,
  ): Promise<{ buffer: Buffer; mime: string; ext: string }>;
  ```

**Behavior:**

- Header row: `[GROUP_HEADER, NAME_HEADER, ...columns.map(c => c.name)]` (columns sorted by `position`).
- Build a `Map<itemId, CellValue[]>` from `payload.cellValues` and a per-`(itemId,columnId)` lookup.
- Iterate `groups` by position; within each, top-level items (`parent_id === null`) by position; after each top-level item emit its subitems (`parent_id === item.id`) by position. Subitem Name cell = `SUBTASK_MARKER + item.name`.
- Each data cell = `cellToText(col.kind, cellValue?.value, col.settings)`.
- `format === "xlsx"` → `wb.xlsx.writeBuffer()` (mime `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, ext `xlsx`); `"csv"` → `wb.csv.writeBuffer()` (mime `text/csv`, ext `csv`). Worksheet name = board name truncated to 31 chars (Excel limit), sanitized of `[]*?/\\:`.

- [ ] **Step 1: Write failing test** — build a minimal `BoardPayload` (one group, one item + one subitem, one status column + one numbers column), export to csv, assert the text contains the header, the indented subtask, and the rendered status label. Parse it back with `parseWorkbook` (T5) and assert round-trip of names + group.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `export-workbook.ts`.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** (`feat(boards): add spreadsheet export builder`).

---

## Task 6: Build import payload (ParsedSheet + mappings → ImportPayload)

**Files:**

- Create: `src/lib/boards/spreadsheet/build-import-payload.ts`
- Test: `src/lib/boards/spreadsheet/build-import-payload.test.ts`

**Interfaces:**

- Consumes: T1 (`ParsedSheet`, `ColumnMapping`); T2 (`textToCell`); T3 (`splitRows`); `TemplatePayload` from `@/lib/boards/template-payload`; `Json` from `@/types/database.types`.
- Produces (exact):
  ```ts
  export type SubitemSeed = {
    id: string;
    parentId: string;
    groupId: string;
    name: string;
    position: number;
    cells: { columnId: string; value: Json }[];
  };
  export type ImportPayload = {
    templatePayload: TemplatePayload;
    subitems: SubitemSeed[];
  };
  export function buildImportPayload(
    parsed: ParsedSheet,
    mappings: ColumnMapping[],
  ): ImportPayload;
  ```

**Behavior:**

- `splitRows(parsed.header, parsed.rows)` → groups/items/subitems/dataHeaders.
- Mint uuids: one per group (in `groups` order), one per data column (aligned to `mappings`, which align to `dataHeaders`), one per top-level item, one per subitem.
- `templatePayload.groups` = groups → `{id, name, color: nextOptionColor at index? }` — use `GROUP_COLORS`/`nextOptionColor`; position = index.
- `templatePayload.columns` = mappings → `{id, kind: mapping.kind, name: header, settings: mapping.options.length ? {options} : {}, position: index}`.
- `templatePayload.items` = top-level items → `{id, groupId: <group uuid>, name, position: index, cells}` where each non-null `textToCell(kind, cellValue, options)` becomes `{columnId, value}` (drop nulls).
- `subitems` = `{id, parentId: <parent item uuid>, groupId: <parent's group uuid>, name, position: index, cells}`.

- [ ] **Step 1: Write failing test** — given a `ParsedSheet` (Group/Name/Status/Count, one item + one subtask) and mappings (Status=status with two options, Count=numbers), assert: 1 group, 2 columns, 1 top-level item with a status cell whose `value.optionId` matches the mapped option, and 1 subitem with `parentId === items[0].id` and a `{n:1}` count cell.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `build-import-payload.ts`** (use `GROUP_COLORS` from `@/lib/boards/group-colors` if present; else reuse `OPTION_COLORS`).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** (`feat(boards): add spreadsheet import payload builder`).

---

## Task 7: Server actions + validation

**Files:**

- Create: `src/lib/validations/board-spreadsheet.ts`
- Create: `src/lib/boards/spreadsheet-actions.ts`
- Test: `src/lib/boards/spreadsheet-actions.test.ts`

**Interfaces:**

- Consumes: T1 (caps, types), T4 (`buildExportWorkbook`), T5 (`parseWorkbook`), T3 (`detectColumns`), T6 (`buildImportPayload`); `getBoardPayload` from `@/lib/boards/queries`; `createClient` from `@/lib/supabase/server`; `ActionResult` pattern (copy from `@/lib/boards/actions`).
- Produces (exact):
  ```ts
  export async function exportBoard(input: {
    boardId: string;
    format: ImportFormat;
  }): Promise<ActionResult<{ fileName: string; base64: string; mime: string }>>;
  export async function previewImport(input: {
    fileBase64: string;
    fileName: string;
  }): Promise<ActionResult<ImportPreview>>;
  export async function commitImport(input: {
    fileBase64: string;
    fileName: string;
    workspaceId: string;
    boardName: string;
    columnMappings: ColumnMapping[];
  }): Promise<ActionResult<{ boardId: string }>>;
  ```

**Behavior:**

- File guard helper: decode base64 → Buffer; reject `> MAX_BYTES`; reject extension not in `.xlsx/.csv`.
- `exportBoard`: Zod-parse; `getBoardPayload(boardId)` (returns null/throws → fail "Board not found."); `buildExportWorkbook`; `fileName = "<sanitized board name>.<ext>"`; return base64.
- `previewImport`: guard; `parseWorkbook`; reject `rows.length > MAX_ROWS` or `header.length > MAX_COLS`; `detectColumns`; `boardName` = fileName without extension; `sampleRows` = first 5 rows; return `ImportPreview`.
- `commitImport`: Zod-parse (mappings non-empty, kinds ∈ ImportableKinds, boardName 1..100, workspaceId uuid); guard + re-parse + re-validate caps; `buildImportPayload`; call `supabase.rpc("create_board_from_template", { p_workspace_id, p_name: boardName, p_template: templatePayload })` → board row (has `id`, `org_id`). If `subitems.length`: batch `insert` into `items` (`id, org_id, board_id, group_id, parent_id, name, position`), then batch `insert` into `cell_values` (`org_id, board_id, item_id, column_id, value`); **on any error, `supabase.from("boards").delete().eq("id", board.id)` and return fail.** `revalidatePath("/", "layout")`; return `{ boardId }`.

- [ ] **Step 1: Write failing tests** — mock `@/lib/supabase/server` `createClient`. Cover: `exportBoard` returns base64 + correct mime; `previewImport` rejects an oversize buffer with a clear error; `commitImport` happy path calls the RPC with a template payload and returns boardId; `commitImport` deletes the board when the subtask insert errors. Use small real buffers built with exceljs in-test.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `board-spreadsheet.ts` (Zod) and `spreadsheet-actions.ts`** (`"use server"`).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** (`feat(boards): add spreadsheet export/import server actions`).

---

## Task 8: Export UI (BoardHeader dropdown)

**Files:**

- Create: `src/components/boards/ExportMenu.tsx`
- Modify: `src/components/boards/BoardHeader.tsx` (mount `<ExportMenu boardId={boardId} boardName={boardName} />` in the right-hand action group, ~lines 120-149)
- Test: `src/components/boards/ExportMenu.test.tsx`

**Interfaces:**

- Consumes: T7 (`exportBoard`); `DropdownMenu*`, `Button` from `@/components/ui/*`; `Download` lucide icon.
- Produces: `export function ExportMenu(props: { boardId: string; boardName: string }): JSX.Element`.

**Behavior:** ghost button "Export" with a dropdown: "Excel (.xlsx)" / "CSV (.csv)". On select → `startTransition`, call `exportBoard({ boardId, format })`; on `ok`, decode base64 → `Uint8Array` → `Blob([], { type: mime })` → `URL.createObjectURL` → temp `<a download={fileName}>` click → `revokeObjectURL`; on error, toast/inline message. Disable while pending.

- [ ] **Step 1: Write failing test** — mock `exportBoard` to resolve `{ ok:true, data:{ fileName:"b.csv", base64: btoa("x"), mime:"text/csv" }}`; stub `URL.createObjectURL`/`revokeObjectURL` and an anchor click spy; render, open menu, click "CSV", assert `exportBoard` called with `format:"csv"` and an object URL was created.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `ExportMenu.tsx`; mount in `BoardHeader.tsx`.**
- [ ] **Step 4: Run — PASS** (also run the existing `BoardHeader` test if present).
- [ ] **Step 5: Commit** (`feat(boards): add board export menu`).

---

## Task 9: Import UI (NewBoardDialog entry + ImportDialog)

**Files:**

- Create: `src/components/boards/import/ImportDialog.tsx`
- Modify: `src/components/boards/NewBoardDialog.tsx` (add an "Import from file" button below the template grid that opens `ImportDialog`, passing `workspaceId`; close `NewBoardDialog` when import opens)
- Test: `src/components/boards/import/ImportDialog.test.tsx`

**Interfaces:**

- Consumes: T7 (`previewImport`, `commitImport`, `ImportPreview`, `ColumnMapping`); T1 (`IMPORTABLE_KINDS`); `Dialog*`, `Button`, `Select*`, `Input`, `Label` from `@/components/ui/*`; `useRouter`.
- Produces: `export function ImportDialog(props: { workspaceId: string; open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element`.

**Behavior:**

- Stage 1 (pick): hidden file input (`accept=".xlsx,.csv"`). On file: read as base64 (`FileReader.readAsDataURL`, strip `data:...;base64,` prefix), keep `fileBase64`+`fileName` in state, call `previewImport`. Show a spinner while pending; show `res.error` on failure.
- Stage 2 (preview): editable **board name** `Input` (default `preview.boardName`); a table of `preview.columns` with header + a `Select` bound to that column's `kind` (options = `IMPORTABLE_KINDS`); first ~5 `sampleRows`; show `droppedSheets` and the row-order/subtask caveat as muted notes; "Cancel" / "Create board" buttons.
- On "Create board": build `columnMappings` from the (possibly edited) kinds — keep each column's synthesized `options` when kind stays `status`/`dropdown`, else `[]`; `startTransition` → `commitImport({ fileBase64, fileName, workspaceId, boardName, columnMappings })`; on `ok` → `onOpenChange(false)`, `router.push("/boards/"+boardId)`, `router.refresh()`; on error → inline message.

- [ ] **Step 1: Write failing test** — mock `previewImport` to resolve a 2-column preview and `commitImport` to resolve `{ ok:true, data:{ boardId:"b1" }}`; mock `next/navigation` `useRouter`. Render open dialog; simulate selecting a file (dispatch a `change` with a `File`); assert the preview table renders both headers; change one column's kind via the Select; click "Create board"; assert `commitImport` called with the edited mapping and `router.push("/boards/b1")`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `ImportDialog.tsx`; wire the entry into `NewBoardDialog.tsx`.**
- [ ] **Step 4: Run — PASS** (also run existing `NewBoardDialog.test.tsx`).
- [ ] **Step 5: Commit** (`feat(boards): add spreadsheet import dialog`).

---

## Execution DAG

Dependency edges (Task → depends on):

- T1 → none
- T2 → T1 · T3 → T1 · T5 → T1
- T4 → T1, T2 · T6 → T1, T2, T3
- T7 → T4, T5, T6
- T8 → T7 · T9 → T7

Parallel batches (each = one wave of concurrent agents):

- **Batch 1:** T1
- **Batch 2:** T2 · T3 · T5
- **Batch 3:** T4 · T6
- **Batch 4:** T7
- **Batch 5:** T8 · T9

Critical path: **T1 → T6 → T7 → T9** (4 deep) = wall-clock floor.

---

## Final verification (after all tasks)

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass before finishing. Then `scripts/finish-task.sh`.

---

## Self-review notes

- **Spec coverage:** export xlsx+csv (T4/T7/T8) ✓; import xlsx+csv → board (T5/T6/T7/T9) ✓; auto-detect kinds (T3) ✓; preview/confirm + editable kinds (T9) ✓; full-board export (T4) ✓; subtask round-trip via `↳` marker (T3/T4/T6) ✓; no migration / reuse RPC + subtask phase (T7) ✓; caps & perf budget (T1/T7) ✓; v1 non-goals encoded (codec blanks + ImportableKinds) ✓.
- **Type consistency:** `ColumnMapping`, `DetectedColumn`, `SynthOption`, `ParsedSheet`, `ImportPreview`, `ImportPayload`, `SubitemSeed`, `ImportableKind`, `ImportFormat` defined once (T1/T6) and consumed by exact name downstream.
- **No placeholders:** every task has concrete file paths, exact interfaces, and runnable test code.
