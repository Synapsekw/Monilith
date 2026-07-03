# Import Wizard v2 (Excel/CSV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 two-stage import dialog with a three-step wizard (Upload → Select & Map → Preview & Confirm) supporting sheet/header-row/row/column selection, a typed preview grid, smarter detection, and (M2) appending into an existing board with column matching.

**Architecture:** The v1 pure pipeline (`parse-workbook → detect → build-import-payload → cell-codec`) is extended, not replaced: parsing returns **all sheets as raw grids**, a new pure `selectRows` applies header-row/exclusion choices (shared client+server so in-wizard interactions cost 0 round-trips), detection gains new inferences and runs client-side, and payload building becomes `ColumnSpec`-driven (rename/skip/role). New-board commit keeps the `create_board_from_template` RPC + phase-2 subitems; existing-board commit (M2) goes through one new transactional RPC `import_rows_into_board`.

**Tech Stack:** Next.js 16 App Router (Server Actions), Supabase (RLS, plpgsql RPC), ExcelJS (server-only), Zod v4, Vitest + Testing Library, shadcn primitives in `src/components/ui/`.

**Spec:** `docs/superpowers/specs/2026-07-03-import-wizard-v2-design.md`

## Global Constraints

- Caps (verbatim from spec): `MAX_BYTES = 5 * 1024 * 1024`, `MAX_ROWS = 2000`, `MAX_COLS = 40`; preview grids truncated to `PREVIEW_GRID_ROWS = 200`; mapping grid renders max 100 rows.
- Importable kinds unchanged: the 12 `ImportableKind`s; people/files/relation/mirror/time_tracking stay non-importable.
- Server Actions for all mutations; Zod validation at every action boundary; server never trusts client-computed cell values (re-parses the file on commit).
- All in-wizard interactions (sheet tab, header row, include/exclude, rename, kind, role, row toggles, step nav) are client state — **0 server round-trips**; exactly two round-trips per import (`previewImport`, `commitImport`).
- Export → re-import round-trip must keep passing (existing `export-workbook.test.ts` round-trip test — extend, never weaken).
- UI tasks MUST load the `pulse-ui` and `example-skills:frontend-design` skills before writing component code (AGENTS.md #3); match existing shadcn/Tailwind v4 conventions.
- Gates for "done": `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Commit hygiene: stage explicitly by path; subjects lowercase after `type(scope):`; every commit has a descriptive body + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- This is Next.js 16 — confirm any App Router API you touch against `node_modules/next/dist/docs/`.
- M2 migration cannot be applied by an agent (classifier-blocked): Task 13 has an explicit USER GATE — the user applies the SQL, then the agent verifies and runs `pnpm db:types`.

## File Structure

```
src/lib/boards/spreadsheet/
  types.ts                    MODIFY  v2 types: RawSheet, SheetPreview, ParsedTable, ColumnSpec, roles, destination
  select-rows.ts              CREATE  pure: grid + headerRow + exclusions → ParsedTable (client+server shared)
  detect.ts                   MODIFY  new inferKind rules; detectAllColumns; proposeRoles export
  parse-workbook.ts           MODIFY  parseWorkbookSheets (all sheets, raw grids); parseWorkbook re-implemented on top
  build-import-payload.ts     MODIFY  splitRows2 + buildImportPayloadV2 (ColumnSpec-driven)
  match-columns.ts            CREATE  (M2) auto-match detected columns ↔ board columns; kind compatibility
  build-append-payload.ts     CREATE  (M2) table + specs + board columns → AppendPayload for the RPC
src/lib/validations/board-spreadsheet.ts   MODIFY  v2 preview/commit schemas
src/lib/boards/spreadsheet-actions.ts      MODIFY  previewImport v2, commitImport v2 (both destinations)
src/components/boards/import/
  import-wizard-state.ts      CREATE  pure client-state helpers (derive/recompute mapping, invalid cells, commit input)
  ImportWizard.tsx            CREATE  dialog shell + step state (replaces ImportDialog.tsx)
  UploadStep.tsx              CREATE  dropzone + click-to-browse
  MapStep.tsx                 CREATE  sheet tabs + header-row picker + mapping grid
  MappingGrid.tsx             CREATE  the interactive grid (header controls + row checkboxes)
  ConfirmStep.tsx             CREATE  typed preview + summary + name/group input
  ImportDialog.tsx            DELETE  (with its test; superseded)
src/components/boards/NewBoardDialog.tsx   MODIFY  render ImportWizard instead of ImportDialog
src/components/boards/BoardHeader.tsx      MODIFY  (M2) "Import" entry next to ExportMenu
supabase/migrations/<ts>_import_rows_into_board.sql  CREATE  (M2) transactional append RPC
```

## Execution DAG (AGENTS.md #6)

Dependencies (Task N ← depends on):

- T1 ← —
- T2 (select-rows) ← T1 · T3 (detect v2) ← T1 · T5 (payload v2) ← T1 · T12 (match-columns, M2) ← T1
- T4 (parse-workbook v2) ← T1, T2
- T7 (wizard state) ← T1, T2, T3 · T8 (UploadStep) ← T1
- T6 (actions v2) ← T2, T4, T5
- T9 (MapStep+Grid) ← T7 · T10 (ConfirmStep) ← T7
- T11 (shell + rewire) ← T6, T8, T9, T10
- T13 (migration, USER GATE) ← T1 · T14 (append commit) ← T12, T13, T6
- T15 (existing-board UI + BoardHeader entry) ← T11, T12, T14
- T16 (final gates + finish) ← everything

Parallel batches (each batch = one wave of concurrent agents; parallel tasks touch disjoint files):

- **Batch 1:** T1
- **Batch 2:** T2 · T3 · T5 · T12
- **Batch 3:** T4 · T7 · T8
- **Batch 4:** T6 · T9 · T10
- **Batch 5:** T11
- **Batch 6:** T13 (USER GATE: apply migration)
- **Batch 7:** T14
- **Batch 8:** T15
- **Batch 9:** T16

Critical path: **T1 → T2 → T4/T7 → T6/T9 → T11 → T13 → T14 → T15 → T16** (9 deep). M1 ships after Batch 5 if desired (T16 gates run at that point too).

---

### Task 1: v2 types and constants

**Files:**

- Modify: `src/lib/boards/spreadsheet/types.ts`
- Test: `src/lib/boards/spreadsheet/types.test.ts` (extend existing)

**Interfaces:**

- Consumes: nothing.
- Produces (exact, used by every later task):

```ts
export const PREVIEW_GRID_ROWS = 200;
export type RawSheet = { name: string; grid: string[][] };
export type SheetPreview = {
  name: string;
  rowCount: number; // total grid rows in the sheet
  colCount: number; // widest row
  grid: string[][]; // first PREVIEW_GRID_ROWS rows, raw strings
};
export type ImportPreview = {
  fileName: string;
  boardName: string;
  sheets: SheetPreview[];
};
export type ParsedTable = {
  header: string[];
  rows: string[][]; // aligned to header length, empty rows dropped
  rowIndices: number[]; // original grid index of each row (for exclusion mapping)
};
export type ColumnRole = "name" | "group" | "data";
export type ColumnTarget = { columnId: string } | "create" | "skip"; // M2
export type ColumnSpec = {
  sourceIndex: number; // index into ParsedTable.header
  name: string;
  kind: ImportableKind;
  options: SynthOption[];
  role: ColumnRole;
  target?: ColumnTarget; // only meaningful for existing-board destination
};
export type ImportDestination =
  | { type: "new"; workspaceId: string; boardName: string }
  | {
      type: "existing";
      boardId: string;
      group: { groupId: string } | { newGroupName: string };
    };
```

The v1 `ImportPreview` shape (`boardName/columns/rowCount/sampleRows/droppedSheets`) is **replaced** by the shape above. v1 `ParsedSheet`, `ColumnMapping`, `DetectedColumn`, `SynthOption`, caps, and marker constants stay as-is.

- [ ] **Step 1: Write the failing test** — append to `types.test.ts`:

```ts
import { PREVIEW_GRID_ROWS, IMPORTABLE_KINDS } from "./types";
import type {
  ColumnSpec,
  ImportDestination,
  ParsedTable,
  SheetPreview,
} from "./types";

describe("v2 types", () => {
  it("exposes the preview grid cap", () => {
    expect(PREVIEW_GRID_ROWS).toBe(200);
  });
  it("ColumnSpec/destination shapes compile", () => {
    const spec: ColumnSpec = {
      sourceIndex: 0,
      name: "Name",
      kind: IMPORTABLE_KINDS[0],
      options: [],
      role: "name",
    };
    const dest: ImportDestination = {
      type: "new",
      workspaceId: "w",
      boardName: "B",
    };
    const table: ParsedTable = {
      header: ["Name"],
      rows: [["a"]],
      rowIndices: [1],
    };
    const sheet: SheetPreview = {
      name: "S1",
      rowCount: 2,
      colCount: 1,
      grid: [["Name"], ["a"]],
    };
    expect([spec, dest, table, sheet]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/lib/boards/spreadsheet/types.test.ts` → FAIL (`PREVIEW_GRID_ROWS` not exported).
- [ ] **Step 3: Add the exports above to `types.ts`** (verbatim from Interfaces block).
- [ ] **Step 4: Run test to verify it passes** — same command → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/spreadsheet/types.ts src/lib/boards/spreadsheet/types.test.ts
git commit -m "feat(import): v2 wizard types and preview grid cap"   # + body + trailer
```

---

### Task 2: `select-rows.ts` — pure header/exclusion selection

**Files:**

- Create: `src/lib/boards/spreadsheet/select-rows.ts`
- Test: `src/lib/boards/spreadsheet/select-rows.test.ts`

**Interfaces:**

- Consumes: `ParsedTable`, `MAX_COLS` from T1.
- Produces:

```ts
export function columnLabel(i: number): string; // 0→"Column A", 26→"Column AA"
export function selectRows(
  grid: string[][],
  headerRow: number | null, // 0-based grid index; null = no header row
  excludedRows: number[], // 0-based grid indices
): ParsedTable; // throws Error("empty") when no usable header/width
```

Behavior: `headerRow != null` → header = `grid[headerRow]` right-trimmed of empty cells (throw `"empty"` if out of range or fully blank); data rows are grid indices `> headerRow`. `headerRow == null` → width = widest non-empty row (throw `"empty"` if none), header = `Column A…`. In both modes: skip excluded indices, skip fully-empty rows, pad/truncate every row to header length, record each kept row's original grid index in `rowIndices`. **No server imports — this module is client-shared.**

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { selectRows, columnLabel } from "./select-rows";

const grid = [
  ["junk", "", ""],
  ["Name", "Status", ""],
  ["Task A", "Done", ""],
  ["", "", ""],
  ["Task B", "Stuck", ""],
];

describe("columnLabel", () => {
  it("labels columns A..Z, AA..", () => {
    expect(columnLabel(0)).toBe("Column A");
    expect(columnLabel(25)).toBe("Column Z");
    expect(columnLabel(26)).toBe("Column AA");
  });
});

describe("selectRows", () => {
  it("uses the chosen header row and drops rows above it and empty rows", () => {
    const t = selectRows(grid, 1, []);
    expect(t.header).toEqual(["Name", "Status"]);
    expect(t.rows).toEqual([
      ["Task A", "Done"],
      ["Task B", "Stuck"],
    ]);
    expect(t.rowIndices).toEqual([2, 4]);
  });
  it("applies row exclusions by original grid index", () => {
    const t = selectRows(grid, 1, [2]);
    expect(t.rows).toEqual([["Task B", "Stuck"]]);
    expect(t.rowIndices).toEqual([4]);
  });
  it("synthesizes Column A/B headers when headerRow is null", () => {
    const t = selectRows(
      [
        ["a", "b"],
        ["c", "d", "e"],
      ],
      null,
      [],
    );
    expect(t.header).toEqual(["Column A", "Column B", "Column C"]);
    expect(t.rows).toEqual([
      ["a", "b", ""],
      ["c", "d", "e"],
    ]);
  });
  it("throws 'empty' for a blank header row and out-of-range header", () => {
    expect(() => selectRows(grid, 3, [])).toThrow("empty");
    expect(() => selectRows(grid, 99, [])).toThrow("empty");
    expect(() => selectRows([], null, [])).toThrow("empty");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/lib/boards/spreadsheet/select-rows.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement**

```ts
import type { ParsedTable } from "./types";

export function columnLabel(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `Column ${s}`;
}

export function selectRows(
  grid: string[][],
  headerRow: number | null,
  excludedRows: number[],
): ParsedTable {
  const excluded = new Set(excludedRows);
  let header: string[];
  let firstDataRow: number;

  if (headerRow !== null) {
    const raw = grid[headerRow];
    if (!raw) throw new Error("empty");
    let len = raw.length;
    while (len > 0 && raw[len - 1].trim() === "") len--;
    if (len === 0) throw new Error("empty");
    header = raw.slice(0, len);
    firstDataRow = headerRow + 1;
  } else {
    let width = 0;
    for (const row of grid) {
      let len = row.length;
      while (len > 0 && row[len - 1].trim() === "") len--;
      width = Math.max(width, len);
    }
    if (width === 0) throw new Error("empty");
    header = Array.from({ length: width }, (_, i) => columnLabel(i));
    firstDataRow = 0;
  }

  const rows: string[][] = [];
  const rowIndices: number[] = [];
  for (let i = firstDataRow; i < grid.length; i++) {
    if (excluded.has(i)) continue;
    const raw = grid[i] ?? [];
    const row = Array.from({ length: header.length }, (_, c) => raw[c] ?? "");
    if (row.every((cell) => cell.trim() === "")) continue;
    rows.push(row);
    rowIndices.push(i);
  }
  return { header, rows, rowIndices };
}
```

- [ ] **Step 4: Run test to verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `feat(import): pure row/header selection for the wizard` (+ body/trailer), staging both files by path.

---

### Task 3: detect v2 — new inferences, full-header detection, role proposal

**Files:**

- Modify: `src/lib/boards/spreadsheet/detect.ts`
- Test: `src/lib/boards/spreadsheet/detect.test.ts` (extend)

**Interfaces:**

- Consumes: T1 types.
- Produces (v1 `detectColumns`/`splitRows` stay untouched and passing):

```ts
export function detectAllColumns(
  header: string[],
  rows: string[][],
): DetectedColumn[]; // EVERY column, no structural skipping
export function proposeRoles(header: string[]): {
  nameIndex: number;
  groupIndex: number | null;
};
```

New `inferKind` rules, checked in this order after the existing `numbers → checkbox → date` and before `status`: **percent** (all match `/^-?\d+(?:\.\d+)?\s*%$/`), **currency** (all match `/^[$€£]\s?-?[\d.,]+(?:\.\d+)?$/`), **email** (all match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), **link** (all match `/^(https?:\/\/|www\.)\S+$/i`), **dropdown** (`isDropdownLike`: every comma-split part non-empty and ≤30 chars, at least one sample has ≥2 parts, distinct parts 2–12 and ≤ half of total parts). `detectAllColumns` synthesizes options for `status` (v1 helper) and for `dropdown` (from comma-split parts). Rating and phone stay manual-only (spec).

- [ ] **Step 1: Write the failing tests** — append to `detect.test.ts`:

```ts
import { detectAllColumns, proposeRoles } from "./detect";

describe("detectAllColumns", () => {
  const header = ["Group", "Name", "Progress", "Price", "Mail", "Site", "Tags"];
  const rows = [
    ["G1", "A", "10%", "$5.00", "a@x.com", "https://x.com", "red, blue"],
    ["G1", "B", "85%", "$12.50", "b@y.org", "http://y.org", "blue"],
    ["G2", "C", "100%", "$3.99", "c@z.io", "https://z.io", "red, green"],
  ];
  const cols = detectAllColumns(header, rows);
  it("detects every column including structural ones", () => {
    expect(cols).toHaveLength(7);
    expect(cols.map((c) => c.header)).toEqual(header);
  });
  it("infers percent, currency, email, link, dropdown", () => {
    expect(cols[2].kind).toBe("percent");
    expect(cols[3].kind).toBe("currency");
    expect(cols[4].kind).toBe("email");
    expect(cols[5].kind).toBe("link");
    expect(cols[6].kind).toBe("dropdown");
  });
  it("synthesizes dropdown options from comma-split parts", () => {
    expect(cols[6].options.map((o) => o.label).sort()).toEqual([
      "blue",
      "green",
      "red",
    ]);
  });
  it("does not call prose with commas a dropdown", () => {
    const prose = [
      ["Long sentence, with a clause"],
      ["Another sentence, quite different"],
    ];
    expect(detectAllColumns(["Notes"], prose)[0].kind).toBe("text");
  });
});

describe("proposeRoles", () => {
  it("finds Group and Name headers case-insensitively", () => {
    expect(proposeRoles(["group", "NAME", "X"])).toEqual({
      nameIndex: 1,
      groupIndex: 0,
    });
  });
  it("falls back to first non-group column as name", () => {
    expect(proposeRoles(["Group", "Title", "X"])).toEqual({
      nameIndex: 1,
      groupIndex: 0,
    });
    expect(proposeRoles(["Title", "X"])).toEqual({
      nameIndex: 0,
      groupIndex: null,
    });
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm vitest run src/lib/boards/spreadsheet/detect.test.ts`.
- [ ] **Step 3: Implement** — in `detect.ts`:

```ts
const PERCENT_RE = /^-?\d+(?:\.\d+)?\s*%$/;
const CURRENCY_RE = /^[$€£]\s?-?[\d.,]+(?:\.\d+)?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINK_RE = /^(https?:\/\/|www\.)\S+$/i;

function isDropdownLike(samples: string[]): boolean {
  let anyMulti = false;
  const parts: string[] = [];
  for (const s of samples) {
    const ps = s.split(",").map((p) => p.trim());
    if (ps.some((p) => p === "" || p.length > 30)) return false;
    if (ps.length > 1) anyMulti = true;
    parts.push(...ps);
  }
  const distinct = new Set(parts).size;
  return (
    anyMulti &&
    distinct >= 2 &&
    distinct <= 12 &&
    distinct <= Math.ceil(parts.length / 2)
  );
}
```

Inside `inferKind`, after the `isDateLike` check and before the status block, insert:

```ts
if (samples.every((v) => PERCENT_RE.test(v))) return "percent";
if (samples.every((v) => CURRENCY_RE.test(v))) return "currency";
if (samples.every((v) => EMAIL_RE.test(v))) return "email";
if (samples.every((v) => LINK_RE.test(v))) return "link";
if (isDropdownLike(samples)) return "dropdown";
```

Add the two new exports (reusing the private `resolveStructure` and `synthesizeOptions`):

```ts
export function detectAllColumns(
  header: string[],
  rows: string[][],
): DetectedColumn[] {
  return header.map((h, colIdx) => {
    const sampleValues: string[] = [];
    for (const row of rows) {
      if (sampleValues.length >= 50) break;
      const val = (row[colIdx] ?? "").trim();
      if (val !== "") sampleValues.push(val);
    }
    const kind = inferKind(sampleValues);
    const options =
      kind === "status"
        ? synthesizeOptions(sampleValues)
        : kind === "dropdown"
          ? synthesizeOptions(
              sampleValues.flatMap((v) => v.split(",").map((p) => p.trim())),
            )
          : [];
    return { header: h, kind, options, sampleValues };
  });
}

export function proposeRoles(header: string[]): {
  nameIndex: number;
  groupIndex: number | null;
} {
  const { groupColIdx, nameColIdx } = resolveStructure(header);
  return {
    nameIndex: nameColIdx,
    groupIndex: groupColIdx === -1 ? null : groupColIdx,
  };
}
```

- [ ] **Step 4: Run the whole detect suite** — same command → all PASS (v1 cases must not regress; the new rules sit after `date`, so v1 precedence is preserved).
- [ ] **Step 5: Commit** — `feat(import): detect percent/currency/email/link/dropdown and expose role proposal` (+ body/trailer).

---

### Task 4: parse-workbook v2 — all sheets as raw grids

**Files:**

- Modify: `src/lib/boards/spreadsheet/parse-workbook.ts`
- Test: `src/lib/boards/spreadsheet/parse-workbook.test.ts` (extend)

**Interfaces:**

- Consumes: T1 `RawSheet`, T2 `selectRows`.
- Produces:

```ts
export async function parseWorkbookSheets(
  buf: Buffer,
  fileName: string,
): Promise<RawSheet[]>;
// existing signature kept, now implemented on top of the above:
export async function parseWorkbook(
  buf: Buffer,
  fileName: string,
): Promise<ParsedSheet>;
```

`parseWorkbookSheets` returns **every** worksheet (CSV → one sheet named after the file, extension stripped) as a raw `string[][]` **including empty rows** (stable indices are what row exclusion keys on) via `worksheet.getRow(r)` for `r = 1..rowCount`, and throws `Error("empty")` only when the workbook has no worksheets. `parseWorkbook` (kept for export round-trip tests and back-compat) = first sheet + `selectRows(grid, 0, [])`, with `droppedSheets` = remaining sheet names.

- [ ] **Step 1: Write the failing tests** — append (the file already has an ExcelJS `xlsxBuf`-style helper; reuse it):

```ts
import { parseWorkbookSheets } from "./parse-workbook";

describe("parseWorkbookSheets", () => {
  it("returns every sheet with raw grids including empty rows", async () => {
    const wb = new ExcelJS.Workbook();
    const s1 = wb.addWorksheet("First");
    s1.addRow(["Name", "Status"]);
    s1.addRow([]); // empty row must be preserved
    s1.addRow(["Task A", "Done"]);
    const s2 = wb.addWorksheet("Second");
    s2.addRow(["Other"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const sheets = await parseWorkbookSheets(buf, "file.xlsx");
    expect(sheets.map((s) => s.name)).toEqual(["First", "Second"]);
    expect(sheets[0].grid).toEqual([
      ["Name", "Status"],
      [],
      ["Task A", "Done"],
    ]);
  });
  it("names the single csv sheet after the file", async () => {
    const sheets = await parseWorkbookSheets(
      Buffer.from("a,b\n1,2\n"),
      "data.csv",
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("data");
    expect(sheets[0].grid).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("throws 'empty' when the workbook has no sheets", async () => {
    const wb = new ExcelJS.Workbook();
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseWorkbookSheets(buf, "x.xlsx")).rejects.toThrow("empty");
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm vitest run src/lib/boards/spreadsheet/parse-workbook.test.ts`.
- [ ] **Step 3: Implement** — replace the file body (keep the existing xlsx-load cast comment):

```ts
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import type { ParsedSheet, RawSheet } from "./types";
import { selectRows } from "./select-rows";

async function loadWorkbook(
  buf: Buffer,
  fileName: string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  if (fileName.toLowerCase().endsWith(".csv")) {
    await wb.csv.read(Readable.from(buf.toString("utf8")));
  } else {
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  }
  return wb;
}

export async function parseWorkbookSheets(
  buf: Buffer,
  fileName: string,
): Promise<RawSheet[]> {
  const wb = await loadWorkbook(buf, fileName);
  if (wb.worksheets.length === 0) throw new Error("empty");
  const isCsv = fileName.toLowerCase().endsWith(".csv");
  const csvName =
    fileName
      .replace(/\.[^.]+$/, "")
      .split(/[\\/]/)
      .pop() || "Sheet1";

  return wb.worksheets.map((ws, wi) => {
    const grid: string[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(row.getCell(c).text);
      grid.push(cells);
    }
    return { name: isCsv && wi === 0 ? csvName : ws.name, grid };
  });
}

/** v1-compatible view: first sheet, header = row 1. */
export async function parseWorkbook(
  buf: Buffer,
  fileName: string,
): Promise<ParsedSheet> {
  const sheets = await parseWorkbookSheets(buf, fileName);
  const first = sheets[0];
  const table = selectRows(first.grid, 0, []); // throws "empty" on blank sheets
  return {
    header: table.header,
    rows: table.rows,
    droppedSheets: sheets.slice(1).map((s) => s.name),
  };
}
```

- [ ] **Step 4: Run parse-workbook + export-workbook round-trip tests** — `pnpm vitest run src/lib/boards/spreadsheet/` → all PASS (v1 `parseWorkbook` semantics preserved: header row 1, empty data rows dropped by `selectRows`).
- [ ] **Step 5: Commit** — `feat(import): parse all workbook sheets as raw grids` (+ body/trailer).

---

### Task 5: build-import-payload v2 — ColumnSpec-driven

**Files:**

- Modify: `src/lib/boards/spreadsheet/build-import-payload.ts`
- Test: `src/lib/boards/spreadsheet/build-import-payload.test.ts` (extend)

**Interfaces:**

- Consumes: T1 `ParsedTable`/`ColumnSpec`, existing `textToCell`, `GROUP_COLORS`, `TemplatePayload`, `SUBTASK_MARKER`.
- Produces (v1 `buildImportPayload` stays until T6 removes its callers, then delete it and its tests in T6):

```ts
export type Split2 = {
  groups: string[];
  items: { group: string; name: string; row: string[] }[];
  subitems: { parentIndex: number; name: string; row: string[] }[];
};
export function splitRows2(
  rows: string[][],
  nameIndex: number,
  groupIndex: number | null,
): Split2;
export function buildImportPayloadV2(
  table: ParsedTable,
  specs: ColumnSpec[],
): ImportPayload;
// throws Error("no name column") when specs lack exactly one role:"name"
```

`splitRows2` = v1 `splitRows` logic with **explicit** name/group indices and full rows kept (no data-column projection — specs project later). `buildImportPayloadV2`: `dataSpecs = specs.filter(s => s.role === "data" && s.target !== "skip")`; columns named `spec.name`, kind `spec.kind`, settings `{options}` when non-empty; cells via `textToCell(spec.kind, row[spec.sourceIndex] ?? "", spec.options)`; groups/items/subitems minted exactly like v1.

- [ ] **Step 1: Write the failing tests**

```ts
import { splitRows2, buildImportPayloadV2 } from "./build-import-payload";
import type { ColumnSpec, ParsedTable } from "./types";

const table: ParsedTable = {
  header: ["Phase", "Task", "Est", "Ignore me"],
  rows: [
    ["Build", "Task A", "5", "x"],
    ["Build", "↳ Sub A1", "2", "y"],
    ["QA", "Task B", "", "z"],
  ],
  rowIndices: [1, 2, 3],
};
const specs: ColumnSpec[] = [
  { sourceIndex: 0, name: "Phase", kind: "text", options: [], role: "group" },
  { sourceIndex: 1, name: "Task", kind: "text", options: [], role: "name" },
  {
    sourceIndex: 2,
    name: "Estimate",
    kind: "numbers",
    options: [],
    role: "data",
  },
];

describe("splitRows2", () => {
  it("splits items/subitems by explicit name and group indices", () => {
    const s = splitRows2(table.rows, 1, 0);
    expect(s.groups).toEqual(["Build", "QA"]);
    expect(s.items.map((i) => i.name)).toEqual(["Task A", "Task B"]);
    expect(s.subitems).toEqual([
      { parentIndex: 0, name: "Sub A1", row: table.rows[1] },
    ]);
  });
  it("defaults to one 'Imported' group when groupIndex is null", () => {
    expect(splitRows2(table.rows, 1, null).groups).toEqual(["Imported"]);
  });
});

describe("buildImportPayloadV2", () => {
  it("builds only included data columns, renamed, with typed cells", () => {
    const { templatePayload, subitems } = buildImportPayloadV2(table, specs);
    expect(templatePayload.columns).toHaveLength(1);
    expect(templatePayload.columns[0].name).toBe("Estimate");
    expect(templatePayload.items[0].cells).toEqual([
      { columnId: templatePayload.columns[0].id, value: { n: 5 } },
    ]);
    expect(templatePayload.items[1].cells).toEqual([]); // empty raw → no cell row
    expect(subitems[0].cells).toEqual([
      { columnId: templatePayload.columns[0].id, value: { n: 2 } },
    ]);
  });
  it("throws without a name role", () => {
    expect(() => buildImportPayloadV2(table, specs.slice(2))).toThrow(
      "no name column",
    );
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm vitest run src/lib/boards/spreadsheet/build-import-payload.test.ts`.
- [ ] **Step 3: Implement** — add to `build-import-payload.ts`:

```ts
import { SUBTASK_MARKER, type ColumnSpec, type ParsedTable } from "./types";

export type Split2 = {
  groups: string[];
  items: { group: string; name: string; row: string[] }[];
  subitems: { parentIndex: number; name: string; row: string[] }[];
};

export function splitRows2(
  rows: string[][],
  nameIndex: number,
  groupIndex: number | null,
): Split2 {
  const groups: string[] = [];
  const items: Split2["items"] = [];
  const subitems: Split2["subitems"] = [];
  const lastItemIndexByGroup = new Map<string, number>();

  for (const row of rows) {
    const group =
      groupIndex !== null
        ? (row[groupIndex] ?? "").trim() || "Imported"
        : "Imported";
    const rawName = (row[nameIndex] ?? "").trim();
    const isSubtask = rawName.startsWith(SUBTASK_MARKER);

    if (isSubtask && lastItemIndexByGroup.has(group)) {
      subitems.push({
        parentIndex: lastItemIndexByGroup.get(group)!,
        name: rawName.slice(SUBTASK_MARKER.length),
        row,
      });
    } else {
      if (!groups.includes(group)) groups.push(group);
      const name = isSubtask ? rawName.slice(SUBTASK_MARKER.length) : rawName;
      lastItemIndexByGroup.set(group, items.length);
      items.push({ group, name, row });
    }
  }
  return { groups, items, subitems };
}

export function buildImportPayloadV2(
  table: ParsedTable,
  specs: ColumnSpec[],
): ImportPayload {
  const nameSpec = specs.find((s) => s.role === "name");
  if (!nameSpec) throw new Error("no name column");
  const groupSpec = specs.find((s) => s.role === "group") ?? null;
  const dataSpecs = specs.filter(
    (s) => s.role === "data" && s.target !== "skip",
  );

  const split = splitRows2(
    table.rows,
    nameSpec.sourceIndex,
    groupSpec?.sourceIndex ?? null,
  );

  const groupIds = split.groups.map(() => crypto.randomUUID());
  const columnIds = dataSpecs.map(() => crypto.randomUUID());
  const itemIds = split.items.map(() => crypto.randomUUID());

  const buildCells = (row: string[]) => {
    const cells: { columnId: string; value: Json }[] = [];
    dataSpecs.forEach((spec, i) => {
      const value = textToCell(
        spec.kind,
        row[spec.sourceIndex] ?? "",
        spec.options,
      );
      if (value !== null) cells.push({ columnId: columnIds[i], value });
    });
    return cells;
  };

  return {
    templatePayload: {
      groups: split.groups.map((name, i) => ({
        id: groupIds[i],
        name,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
        position: i,
      })),
      columns: dataSpecs.map((spec, i) => ({
        id: columnIds[i],
        kind: spec.kind,
        name: spec.name,
        settings:
          spec.options.length > 0
            ? ({ options: spec.options } as Json)
            : ({} as Json),
        position: i,
      })),
      items: split.items.map((item, i) => ({
        id: itemIds[i],
        groupId: groupIds[split.groups.indexOf(item.group)],
        name: item.name,
        position: i,
        cells: buildCells(item.row),
      })),
    },
    subitems: split.subitems.map((sub, i) => ({
      id: crypto.randomUUID(),
      parentId: itemIds[sub.parentIndex],
      groupId:
        groupIds[split.groups.indexOf(split.items[sub.parentIndex].group)],
      name: sub.name,
      position: i,
      cells: buildCells(sub.row),
    })),
  };
}
```

- [ ] **Step 4: Run to verify PASS** (v1 tests in the same file must stay green).
- [ ] **Step 5: Commit** — `feat(import): column-spec driven payload build with explicit roles` (+ body/trailer).

---

### Task 6: server actions v2 + validation (new-board destination)

**Files:**

- Modify: `src/lib/validations/board-spreadsheet.ts`
- Modify: `src/lib/boards/spreadsheet-actions.ts`
- Modify: `src/lib/boards/spreadsheet-actions.test.ts` (rewrite import cases)
- Delete: v1 `buildImportPayload`/`detectColumns` call sites in actions (functions themselves stay for their unit tests; do NOT delete tested pure functions)

**Interfaces:**

- Consumes: T2 `selectRows`, T4 `parseWorkbookSheets`, T5 `buildImportPayloadV2`, T1 types.
- Produces (client calls these):

```ts
export async function previewImport(input: {
  fileBase64: string;
  fileName: string;
}): Promise<ActionResult<ImportPreview>>; // ImportPreview = { fileName, boardName, sheets: SheetPreview[] }
export async function commitImport(input: {
  fileBase64: string;
  fileName: string;
  sheetName: string;
  headerRow: number | null;
  excludedRows: number[];
  columns: ColumnSpec[];
  destination: ImportDestination; // only type:"new" accepted until T14
}): Promise<ActionResult<{ boardId: string }>>;
```

Validation (`board-spreadsheet.ts`): `columnSpec = z.object({ sourceIndex: z.number().int().min(0).max(MAX_COLS - 1), name: z.string().trim().min(1).max(100), kind: importableKind, options: z.array(synthOption).max(200), role: z.enum(["name","group","data"]), target: z.union([z.object({ columnId: uuid }), z.literal("create"), z.literal("skip")]).optional() })`. `commitImportSchema` requires `columns` non-empty with **exactly one** `role:"name"`, **≤1** `role:"group"`, and **distinct** `sourceIndex`es (a `superRefine`); `destination` is `z.discriminatedUnion("type", …)` with the `existing` arm present but rejected inside the action until T14 (`return fail("Importing into an existing board is not available yet.")`).

Action logic: `previewImport` = guard → `parseWorkbookSheets` → map to `SheetPreview` (grid sliced to `PREVIEW_GRID_ROWS`; per-sheet `MAX_COLS` check → fail naming the sheet; **no row-cap fail at preview** — `rowCount` lets the UI warn; commit enforces). `commitImport` = guard → parse → find sheet by name (fail "Sheet not found.") → `selectRows(grid, headerRow, excludedRows)` (catch "empty") → caps on the selected table (`rows.length > MAX_ROWS`, `header.length > MAX_COLS`) → validate every `spec.sourceIndex < header.length` → `buildImportPayloadV2` → the **unchanged v1 phase-1 RPC + phase-2 subitems + delete-on-failure block** (lift it verbatim into a helper `insertNewBoard(supabase, workspaceId, boardName, payload)` so T14 can share the shape) → `revalidatePath("/", "layout")`.

- [ ] **Step 1: Rewrite the import cases in `spreadsheet-actions.test.ts` as failing tests** — keep the existing `xlsxBuf` helper and Supabase mock; new cases:

```ts
it("previewImport returns every sheet with truncated grids", async () => {
  /* build 2-sheet xlsx; expect sheets[1].name, grid rows, rowCount */
});
it("previewImport fails when a sheet exceeds MAX_COLS, naming the sheet", async () => {
  /* 41-col sheet → /too many columns/ and sheet name in message */
});
it("commitImport honors headerRow, excludedRows and skip specs", async () => {
  /* header on row 2, exclude one data row, one spec role:"data" target:"skip" → RPC called with 1 column, right item count */
});
it("commitImport rejects two name-role columns", async () => {
  /* expect /name/ zod error */
});
it("commitImport rejects an existing destination until M2", async () => {
  /* destination type:"existing" → /not available yet/ */
});
it("commitImport enforces MAX_ROWS on the selected table", async () => {
  /* 2001 data rows → /too many rows/ */
});
```

Write these fully (mirror the concrete style of the existing tests in that file — the mock asserts `supabase.rpc` payloads).

- [ ] **Step 2: Run to verify FAIL** — `pnpm vitest run src/lib/boards/spreadsheet-actions.test.ts`.
- [ ] **Step 3: Implement schemas then actions as specified above.** Update `ImportPreview` construction: `boardName = fileName.replace(/\.[^.]+$/, "")`. Keep `exportBoard` and `resolvePeopleNames` untouched.
- [ ] **Step 4: Run to verify PASS**, then `pnpm vitest run src/lib` for collateral damage.
- [ ] **Step 5: Commit** — `feat(import): v2 preview/commit actions with sheet, header-row and column-spec support` (+ body/trailer).

---

### Task 7: `import-wizard-state.ts` — pure client-state helpers

**Files:**

- Create: `src/components/boards/import/import-wizard-state.ts`
- Test: `src/components/boards/import/import-wizard-state.test.ts`

**Interfaces:**

- Consumes: T2 `selectRows`, T3 `detectAllColumns`/`proposeRoles`, existing `textToCell`, T1 types.
- Produces (the three step components consume exactly these):

```ts
export type ColumnState = {
  sourceIndex: number;
  include: boolean;
  name: string;
  kind: ImportableKind;
  options: SynthOption[];
  role: ColumnRole;
  detectedKind: ImportableKind; // frozen detection result, restored when a role demotes back to data
  target: ColumnTarget | null; // stays null in new-board mode (M2 fills it)
};
export type SheetState = {
  headerRow: number | null;
  excluded: number[];
  columns: ColumnState[];
};
export function deriveSheetState(
  grid: string[][],
  headerRow: number | null,
): SheetState; // throws "empty" passthrough
export function tableFor(grid: string[][], state: SheetState): ParsedTable;
export function invalidCellMap(
  table: ParsedTable,
  columns: ColumnState[],
): Map<number, number[]>;
// key = original grid rowIndex, value = offending sourceIndexes (textToCell === null on non-empty raw)
export function buildCommitColumns(state: SheetState): ColumnSpec[]; // included columns only, options kept only for status/dropdown
export function summarize(
  table: ParsedTable,
  state: SheetState,
): {
  items: number;
  subitems: number;
  columns: number;
  invalid: number;
};
```

`deriveSheetState`: `selectRows` → `detectAllColumns` → `proposeRoles` → one `ColumnState` per header column (`include: true`, `name` = header cell or synthesized label, role from proposal, `kind` forced to `"text"` for the name/group role columns). `summarize`: subitems = rows whose name cell starts with `SUBTASK_MARKER` (and a preceding parent exists per `splitRows2` semantics — reuse `splitRows2`), invalid = total entries in `invalidCellMap` restricted to included data columns.

- [ ] **Step 1: Write the failing tests**

```ts
import {
  deriveSheetState,
  tableFor,
  invalidCellMap,
  buildCommitColumns,
  summarize,
} from "./import-wizard-state";

const grid = [
  ["Group", "Name", "Est"],
  ["Build", "Task A", "5"],
  ["Build", "↳ Sub", "oops"], // "oops" is invalid for numbers
  ["QA", "Task B", "3"],
];

describe("deriveSheetState", () => {
  it("derives roles, kinds and includes for every column", () => {
    const s = deriveSheetState(grid, 0);
    expect(s.columns.map((c) => c.role)).toEqual(["group", "name", "data"]);
    expect(s.columns[2].kind).toBe("numbers");
    expect(s.columns.every((c) => c.include)).toBe(true);
  });
});

describe("invalidCellMap + summarize", () => {
  it("flags unparseable cells by grid row index and counts them", () => {
    const s = deriveSheetState(grid, 0);
    const t = tableFor(grid, s);
    const invalid = invalidCellMap(t, s.columns);
    expect([...invalid.entries()]).toEqual([[2, [2]]]);
    expect(summarize(t, s)).toEqual({
      items: 2,
      subitems: 1,
      columns: 1,
      invalid: 1,
    });
  });
});

describe("buildCommitColumns", () => {
  it("drops excluded columns and strips options for non-option kinds", () => {
    const s = deriveSheetState(grid, 0);
    s.columns[0].include = false;
    const specs = buildCommitColumns(s);
    expect(specs.map((c) => c.sourceIndex)).toEqual([1, 2]);
    expect(specs.every((c) => c.options.length === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm vitest run src/components/boards/import/import-wizard-state.test.ts`.
- [ ] **Step 3: Implement** (straight composition of the pure libs; ~80 lines — every function above, no component code).
- [ ] **Step 4: Run to verify PASS.**
- [ ] **Step 5: Commit** — `feat(import): pure wizard state derivation and commit-input builders` (+ body/trailer).

---

### Task 8: `UploadStep.tsx` — dropzone

**Files:**

- Create: `src/components/boards/import/UploadStep.tsx`
- Test: `src/components/boards/import/UploadStep.test.tsx`

**Interfaces:**

- Consumes: `MAX_BYTES` from T1; `Button` primitive. **No server action import** — the wizard owns the call.
- Produces:

```ts
export function UploadStep(props: {
  busy: boolean; // wizard is running previewImport
  error: string | null;
  onFile: (file: { name: string; base64: string }) => void;
}): React.JSX.Element;
```

Behavior: bordered drop area (`onDragOver` prevent-default + highlight state, `onDrop` reads `e.dataTransfer.files[0]`) plus the v1 hidden `<input type="file" accept=".xlsx,.csv">` and a "Choose file" button. Client-side pre-checks before calling `onFile`: extension `.xlsx`/`.csv` and `file.size <= MAX_BYTES` — show inline error otherwise (local state; server error arrives via `props.error`). File → base64 via `FileReader.readAsDataURL` with the v1 prefix-strip regex. Shows the v1 "Analyzing file…" spinner when `busy`. **Load `pulse-ui` + `frontend-design` skills before styling.**

- [ ] **Step 1: Write the failing tests** — mock `FileReader` exactly like `ImportDialog.test.tsx` did; cases: drop a valid `.xlsx` → `onFile` called with stripped base64 + name; choose an unsupported `.txt` → inline error, `onFile` not called; oversized file → inline error; `busy` renders the spinner text.
- [ ] **Step 2: Run to verify FAIL** — `pnpm vitest run src/components/boards/import/UploadStep.test.tsx`.
- [ ] **Step 3: Implement the component** (~90 lines) per the behavior above.
- [ ] **Step 4: Run to verify PASS.**
- [ ] **Step 5: Commit** — `feat(import): upload step with drag-and-drop and client-side pre-checks` (+ body/trailer).

---

### Task 9: `MapStep.tsx` + `MappingGrid.tsx`

**Files:**

- Create: `src/components/boards/import/MapStep.tsx`
- Create: `src/components/boards/import/MappingGrid.tsx`
- Test: `src/components/boards/import/MapStep.test.tsx`

**Interfaces:**

- Consumes: T7 (`SheetState`, `ColumnState`, `deriveSheetState`, `tableFor`, `invalidCellMap`), T1 types, `IMPORTABLE_KINDS`, primitives (`Button`, `Input`, `DropdownMenu`, `Tooltip`).
- Produces:

```ts
export function MapStep(props: {
  sheets: SheetPreview[];
  activeSheet: number;
  onSheetChange: (i: number) => void;
  state: SheetState; // state for the active sheet (wizard owns per-sheet states)
  onStateChange: (next: SheetState) => void;
  mode: "new" | "existing"; // "existing" adds target mapping in T15; render nothing extra yet
  rowCapWarning: string | null; // set by wizard when sheet.rowCount > MAX_ROWS
  onBack: () => void;
  onNext: () => void; // wizard disables when no role:"name" column is included
}): React.JSX.Element;
```

`MapStep` renders: sheet tabs (buttons; switching calls `onSheetChange` — wizard swaps in that sheet's `SheetState`, deriving lazily on first visit); header-row control (native `<select>` offering rows 1–10 shown 1-based + "No header row" → `deriveSheetState(grid, value)` via `onStateChange` — **full re-derive, discarding column edits for that sheet** — plus an inline note saying so); the cap warning banner; and `MappingGrid`.

`MappingGrid` props: `{ grid, state, table, invalid, onStateChange }`. Renders max **100** rows (“Showing first 100 of N rows” note): header cell per column = include checkbox (`aria-label={`Include ${name}`}`), name `<Input>`, kind `<select>` (12 kinds, disabled for name/group roles), role `DropdownMenu` (“Use as item name” / “Use as group” / “Regular column”; assigning name/group demotes the previous holder to `data` and restores its `detectedKind` from `ColumnState`). Excluded columns render `opacity-50`. Leading row-checkbox column toggles `state.excluded` by the row's `rowIndices` value; rows above the header and empty rows simply don't appear (they're not in `table`). Invalid cells (from `invalidCellMap`) get a warning tint + `title` tooltip `Can't parse as {kind} — will import empty`. When `invalidCellMap` is non-empty, MapStep shows a one-click chip `Exclude N rows with invalid cells` that adds those rows' grid indices to `state.excluded` (offered, never forced — spec).

- [ ] **Step 1: Write the failing tests** — cases: renders sheet tabs and switches; header-row select re-derives (spy `onStateChange` receives fresh state); unchecking a column include dims it and updates state; editing a column name updates state; changing kind on a data column updates state; toggling a row checkbox adds its grid index to `excluded`; invalid cell renders the tooltip title.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement both components** (load `pulse-ui` + `frontend-design` skills first; wide-table in `overflow-x-auto`).
- [ ] **Step 4: Run to verify PASS.**
- [ ] **Step 5: Commit** — `feat(import): mapping grid with sheet tabs, header row and column/row selection` (+ body/trailer).

---

### Task 10: `ConfirmStep.tsx`

**Files:**

- Create: `src/components/boards/import/ConfirmStep.tsx`
- Test: `src/components/boards/import/ConfirmStep.test.tsx`

**Interfaces:**

- Consumes: T7 (`tableFor`, `invalidCellMap`, `summarize`, `buildCommitColumns` output shapes), `textToCell`, `cellToText` from `cell-codec`.
- Produces:

```ts
export function ConfirmStep(props: {
  table: ParsedTable;
  state: SheetState;
  destination:
    | { type: "new"; boardName: string; onBoardNameChange: (v: string) => void }
    | {
        type: "existing";
        groups: { id: string; name: string }[];
        groupChoice: { groupId: string } | { newGroupName: string };
        onGroupChange: (
          c: { groupId: string } | { newGroupName: string },
        ) => void;
      };
  error: string | null;
  pending: boolean;
  onBack: () => void;
  onConfirm: () => void;
}): React.JSX.Element;
```

Renders: summary strip from `summarize` (`{items} items · {subitems} subtasks · {columns} columns · {invalid} invalid cells → empty`); read-only typed grid of the first 50 rows — per included data column, `textToCell` then render: status/dropdown → pill(s) with the option color dot; checkbox → “✓”/“—”; invalid (non-empty raw, `null` cell) → raw text with warning tint; else `cellToText(kind, value, { options }, undefined)`-style plain text (match the real `cellToText` signature from `cell-codec.ts:11`). New-board mode shows the board-name `<Input>` (confirm disabled when blank); existing mode shows the group `<select>` + “New group…” input (T15 activates it — render from props now so tests cover it). Footer: Back / Confirm (`pending` → “Importing…”), `role="alert"` error line.

- [ ] **Step 1: Write the failing tests** — summary counts render; status cell renders as a pill; invalid cell keeps raw text with tint; blank board name disables confirm; confirm calls `onConfirm`.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** (pulse-ui skill loaded first).
- [ ] **Step 4: Run to verify PASS.**
- [ ] **Step 5: Commit** — `feat(import): typed confirm step with import summary` (+ body/trailer).

---

### Task 11: `ImportWizard.tsx` shell + rewire + delete v1 dialog

**Files:**

- Create: `src/components/boards/import/ImportWizard.tsx`
- Test: `src/components/boards/import/ImportWizard.test.tsx`
- Modify: `src/components/boards/NewBoardDialog.tsx` (import + render `ImportWizard` instead of `ImportDialog`)
- Delete: `src/components/boards/import/ImportDialog.tsx`, `src/components/boards/import/ImportDialog.test.tsx`

**Interfaces:**

- Consumes: T6 actions, T7 state module, T8/T9/T10 steps.
- Produces:

```ts
export function ImportWizard(props: {
  destination:
    | { type: "new"; workspaceId: string }
    | {
        type: "existing";
        boardId: string;
        boardColumns: BoardColumnRef[];
        groups: { id: string; name: string }[];
      }; // used from T15
  open: boolean;
  onOpenChange: (o: boolean) => void;
}): React.JSX.Element;
```

Shell: `Dialog` with `DialogContent className="sm:max-w-6xl h-[85vh] flex flex-col"`; step indicator (“1 Upload · 2 Select & map · 3 Confirm”); owns: file base64/name, `ImportPreview`, per-sheet `SheetState[]` (lazy-derived), active sheet, board name (default `preview.boardName`), error, `useTransition` pending. Flow: `UploadStep.onFile` → `previewImport` → derive state for sheet 0 → step 2. Next gated on an included `role:"name"` column. Confirm → `commitImport({ …, sheetName, headerRow, excludedRows: state.excluded, columns: buildCommitColumns(state), destination })` → on success close+reset, `router.push(/boards/${boardId})` + `router.refresh()` (new board) — existing-board branch lands in T15. Back never refetches. Closing resets all state (v1 `resetState` pattern).

- [ ] **Step 1: Write the failing tests** — mock the two actions + FileReader: full happy path (upload → grid visible → confirm → `commitImport` called with derived specs → `router.push`); server preview error shown on step 1; commit error shown on step 3 with state intact (grid still there after error); NewBoardDialog renders the wizard (update its existing test if it referenced ImportDialog).
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement the shell; rewire `NewBoardDialog.tsx`; delete the two v1 files.** Search for any other `ImportDialog` references first: `pnpm exec grep -r "ImportDialog" src/` must come back empty after.
- [ ] **Step 4: Run the full component suite** — `pnpm vitest run src/components/boards` → PASS.
- [ ] **Step 5: M1 gate check:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → all green. Commit — `feat(import): three-step import wizard replaces v1 dialog` (+ body/trailer). **M1 is shippable here.**

---

### Task 12: `match-columns.ts` (M2)

**Files:**

- Create: `src/lib/boards/spreadsheet/match-columns.ts`
- Test: `src/lib/boards/spreadsheet/match-columns.test.ts`

**Interfaces:**

- Consumes: T1 types; `ColumnKind` from `@/lib/validations/boards`.
- Produces:

```ts
export type BoardColumnRef = {
  id: string;
  name: string;
  kind: ColumnKind;
  options: SynthOption[];
};
export function isKindCompatible(
  source: ImportableKind,
  target: ColumnKind,
): boolean;
// true when source === target, or target === "text"
export function autoMatchColumns(
  headers: { name: string; kind: ImportableKind }[],
  boardColumns: BoardColumnRef[],
): (string | null)[];
// per header: matching board column id (normalized-name equality: trim+lowercase+collapse spaces, kind-compatible, each board column matched at most once) or null
export function missingOptionLabels(
  values: string[],
  kind: ImportableKind,
  target: BoardColumnRef,
): string[];
// distinct labels (comma-split for dropdown) not present in target.options (case-insensitive)
```

- [ ] **Step 1: Write the failing tests** — exact-name+kind match wins; name match with incompatible kind → null; two file columns can't claim one board column (first wins); anything matches a `text` target; `missingOptionLabels` splits dropdown values and is case-insensitive.
- [ ] **Step 2: Run to verify FAIL** — `pnpm vitest run src/lib/boards/spreadsheet/match-columns.test.ts`.
- [ ] **Step 3: Implement** (~50 lines, pure).
- [ ] **Step 4: Run to verify PASS.**
- [ ] **Step 5: Commit** — `feat(import): column auto-matching for existing-board imports` (+ body/trailer).

---

### Task 13: `import_rows_into_board` RPC migration — **USER GATE**

**Files:**

- Create: `supabase/migrations/<timestamp>_import_rows_into_board.sql`
- Modify: `src/types/database.types.ts` (via `pnpm db:types` — never by hand)
- Test: integration test alongside the existing RPC integration suites (same location/pattern as the `dashboard_completion` RPC coverage — find it with `pnpm exec grep -rl "dashboard_completion" src/ supabase/` and mirror it)

**Interfaces:**

- Consumes: nothing from other tasks (SQL only).
- Produces: RPC `import_rows_into_board(p_board_id uuid, p_payload jsonb) returns void`, payload shape:

```jsonc
{
  "newGroup": { "id": "...", "name": "...", "color": "..." } /* or absent */,
  "groupId": "..." /* target group when newGroup absent */,
  "newColumns": [
    {
      "id": "...",
      "kind": "text",
      "name": "...",
      "settings": {},
      "position": 0,
    },
  ],
  "optionAdditions": [
    {
      "columnId": "...",
      "options": [{ "id": "...", "label": "...", "color": "..." }],
    },
  ],
  "items": [
    {
      "id": "...",
      "name": "...",
      "position": 0,
      "cells": [{ "columnId": "...", "value": {} }],
    },
  ],
  "subitems": [
    {
      "id": "...",
      "parentId": "...",
      "name": "...",
      "position": 0,
      "cells": [],
    },
  ],
}
```

SQL mirrors `create_board_from_template` (`security definer set search_path = ''`; `auth.uid()` null check; org from `public.boards`; `public.is_org_member` check; raise `P0002` if board missing). Body order: insert `newGroup` if present (position = `max(position)+1` in board); insert `newColumns` (position = `max(position)+1+row_number`); for each `optionAdditions` entry `update public.columns set settings = jsonb_set(settings, '{options}', coalesce(settings->'options','[]'::jsonb) || <new options jsonb>) where id = ... and board_id = p_board_id`; insert items into the resolved group; insert subitems with `parent_id`; insert all cell_values. Item/subitem positions are **appended**: offset by `coalesce(max(position)+1, 0)` within the target group. All writes filter/derive `org_id`/`board_id` server-side — client ids only for minted rows. Grant execute to `authenticated`.

- [ ] **Step 1: Write the failing integration test** (it will fail until the migration is applied): creates an org/board via existing test helpers, calls the RPC with one new column + one item + one subitem + an option addition, asserts rows and merged settings; plus a cross-org rejection case (second user, expect `42501`).
- [ ] **Step 2: Write the migration SQL** per the shape above.
- [ ] **Step 3: USER GATE — STOP and ask the user to apply the migration** (paste the SQL / run their usual apply flow against the dev project). Do not proceed until they confirm. Then verify: `mcp supabase-dev list_migrations` or a probe query `select proname from pg_proc where proname = 'import_rows_into_board'` via `execute_sql`.
- [ ] **Step 4: Regenerate types** — `pnpm db:types`; commit the migration + regenerated `database.types.ts` together.
- [ ] **Step 5: Run the integration test** — expected PASS (note `integration-test provisioning flake` memory: integration project runs serial). Commit — `feat(import): transactional append rpc for existing-board imports` (+ body/trailer).

---

### Task 14: commitImport existing-board path + `build-append-payload.ts`

**Files:**

- Create: `src/lib/boards/spreadsheet/build-append-payload.ts`
- Modify: `src/lib/boards/spreadsheet-actions.ts` (replace the T6 "not available yet" stub)
- Modify: `src/lib/validations/board-spreadsheet.ts` (existing-destination arm fully validated)
- Test: `src/lib/boards/spreadsheet/build-append-payload.test.ts` + new cases in `spreadsheet-actions.test.ts`

**Interfaces:**

- Consumes: T5 `splitRows2`, T12 helpers, T13 RPC types.
- Produces:

```ts
export type AppendPayload = {
  newGroup?: { id: string; name: string; color: string };
  groupId?: string;
  newColumns: {
    id: string;
    kind: ImportableKind;
    name: string;
    settings: Json;
    position: number;
  }[];
  optionAdditions: { columnId: string; options: SynthOption[] }[];
  items: {
    id: string;
    name: string;
    position: number;
    cells: { columnId: string; value: Json }[];
  }[];
  subitems: {
    id: string;
    parentId: string;
    name: string;
    position: number;
    cells: { columnId: string; value: Json }[];
  }[];
};
export function buildAppendPayload(
  table: ParsedTable,
  specs: ColumnSpec[], // role:"group" forbidden here (server rejects)
  boardColumns: BoardColumnRef[], // fetched server-side, RLS-scoped
  group: { groupId: string } | { newGroupName: string },
): AppendPayload; // throws "no name column" / "unknown target column" / "incompatible column kind"
```

Rules: specs with `target: {columnId}` must reference a `boardColumns` entry with `isKindCompatible(spec.kind → actually the TARGET's kind drives the codec)` — cells for mapped columns are encoded with the **target column's kind and merged options** (`textToCell(targetKind as ImportableKind, raw, mergedOptions)`; if the target kind is not importable, e.g. `people`, reject with "incompatible column kind"); `target: "create"` → minted column with spec kind/options; `target: "skip"` → dropped; `optionAdditions` computed via `missingOptionLabels` with freshly minted `SynthOption`s (colors via `nextOptionColor` against the target's existing colors). All rows land in the single chosen group (file group column, if any, was demoted client-side — server rejects `role:"group"` for existing destination). Action: fetch board columns RLS-scoped (`columns` table by `board_id`), validate, build, `supabase.rpc("import_rows_into_board", …)`, `revalidatePath(/boards/${boardId})`, return `{ boardId }`.

- [ ] **Step 1: Failing unit tests for `buildAppendPayload`** — mapped column encodes with target options (status label → target's existing optionId, not a new one); missing labels produce optionAdditions; "create" mints a column; unknown target throws; people-kind target throws.
- [ ] **Step 2: Failing action tests** — existing destination happy path calls the RPC with the payload (mock asserts shape); `role:"group"` spec rejected; target columnId not on the board rejected.
- [ ] **Step 3: Run to verify FAIL, implement, run to verify PASS.**
- [ ] **Step 4: Commit** — `feat(import): append imported rows into an existing board` (+ body/trailer).

---

### Task 15: existing-board wizard mode + BoardHeader entry

**Files:**

- Modify: `src/components/boards/import/ImportWizard.tsx` (existing destination: group choice state, commit branch → `router.refresh()`, no push)
- Modify: `src/components/boards/import/MapStep.tsx` + `MappingGrid.tsx` (mode `"existing"`: per-column target select — auto-match defaults via `autoMatchColumns`, options "Create new column" / each compatible board column / "Skip"; role menu offers name only, no group; "+N new options" badge via `missingOptionLabels`)
- Modify: `src/components/boards/import/ConfirmStep.tsx` (activate the group picker arm)
- Modify: `src/components/boards/import/import-wizard-state.ts` (`deriveSheetState` accepts optional `boardColumns` and fills `target` defaults)
- Modify: `src/components/boards/BoardHeader.tsx` (an "Import" button with `Upload` icon next to `<ExportMenu boardId={boardId} />` at line ~132; it already has `columns`/`groups` props in scope — pass them as `boardColumns`/`groups`)
- Test: extend `MapStep.test.tsx`, `ImportWizard.test.tsx`, `BoardHeader` test

**Interfaces:**

- Consumes: T11 shell props (`destination.type === "existing"`), T12, T14 action.
- Produces: user-visible M2 flow; no new exports.

- [ ] **Step 1: Failing tests** — existing mode renders target selects with auto-match preselected; changing a target to "Skip" removes it from commit params; commit sends `destination: { type: "existing", boardId, group }`; BoardHeader shows the Import button and opens the wizard; success path calls `router.refresh()` and not `router.push`.
- [ ] **Step 2: Run to verify FAIL, implement (pulse-ui skill loaded), run to verify PASS.**
- [ ] **Step 3: Commit** — `feat(import): existing-board import mode with column matching in the wizard` (+ body/trailer).

---

### Task 16: final verification + finish

**Files:** none new.

- [ ] **Step 1: Full gates** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → all green (see `finish-task typecheck-before-build cacheLife` memory if cold typecheck trips on `cacheLife`).
- [ ] **Step 2: Round-trip check** — confirm `export-workbook.test.ts` round-trip still passes and add one wizard-level case: default wizard state over an exported file commits specs equivalent to the original board's columns.
- [ ] **Step 3: Run `/verify`-style manual pass** — `pnpm dev`, import a real multi-sheet xlsx end-to-end (both destinations).
- [ ] **Step 4: `scripts/finish-task.sh`** from inside the worktree (auto-rebases, gates, merges to `develop`, cleans up). Confirm `origin/develop` advanced and the worktree/branch are gone.
- [ ] **Step 5: Hand the user the "How to test this" walkthrough** (both destinations, numbered steps) in the closing message and the `/wrapup` session note.
