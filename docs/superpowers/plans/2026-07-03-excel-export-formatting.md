# Formatted Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board → .xlsx export look like the board: status/dropdown color fills, band-colored percent data bars, styled frozen header, sensible column widths, group-colored cells, muted subitem names — without breaking the existing import round-trip or the CSV path.

**Architecture:** A new pure module `src/lib/boards/spreadsheet/format-workbook.ts` applies all styling to the worksheet from a `FormatPlan` that `buildExportWorkbook` collects while emitting rows (xlsx only; CSV bypasses it). A new `cellToExcelValue` in `cell-codec.ts` writes `numbers`/`percent` cells as real numbers so data bars work; everything else stays strings. No new queries, no schema change, no UI change.

**Tech Stack:** TypeScript (strict), exceljs 4.4.0 (server-only), Vitest. Spec: `docs/superpowers/specs/2026-07-03-excel-export-formatting-design.md`.

## Global Constraints

- **exceljs is server-only** — only modules under `src/lib/boards/spreadsheet/` may import it; never from client components.
- **Round-trip is a hard requirement:** an exported .xlsx must still `parseWorkbook` → `detectColumns` → import with identical headers, values, subtask markers. `parseWorkbook` reads `cell.text`, so: percent/numbers may become real numbers (stringify back), dates MUST stay ISO strings (a real Date's `.text` breaks `isDateLike`), percent numFmt MUST be `'0"%"'` (value stays `0–100`), never Excel-native percent format.
- **`cellToText` behavior is frozen** — the import path and CSV semantics depend on it; only add alongside, never modify.
- **Formatting never fails an export:** unparseable colors/settings degrade to unstyled cells (skip), never throw.
- **exceljs typing gap:** `DataBarRuleType` in `index.d.ts` omits `color`, but the writer renders it. Extend the type locally (`DataBarRuleType & { color: Partial<ExcelJS.Color> }`); no `any`, no package patching.
- **Data bars:** ≤ 6 conditional-formatting rules per percent column (one per band present), `gradient: false`, `showValue: true`, `cfvo: [{type:"num",value:0},{type:"num",value:100}]`. Never one rule per row.
- **Colors (exact):** header fill `#1A1A1D`, header text white, subitem name text `#6B7280`; percent bands red `#EA3A48` (0–19), orange `#F07437` (20–39), amber `#E5A83B` (40–59), lime `#8FC15D` (60–79), green `#3FAE71` (80–99), complete `#12965C` (100) — hex freezes of the `--progress-*` OKLCH tokens in `src/app/globals.css` (verify visually at build; keep in one exported record).
- **Contrast text on fills:** always `pillTextColor(hex)` from `src/lib/boards/contrast.ts` — never hardcode white.
- **Dropdown fills only when exactly one option is selected** (spec decision; multi-select stays plain text).
- **TDD:** failing test first, minimal implementation, re-run, commit. Tests live next to sources.
- **Commit hygiene:** stage by path (`git add <paths>`), never `-A`/`.`/`-a`. Subject lowercase after `type(scope):`; descriptive body; end body with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Gates before finish: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (then `scripts/finish-task.sh`).

---

## File Structure

| File                                                          | Responsibility                                                                                   | Task   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ |
| `src/lib/boards/spreadsheet/cell-codec.ts` (modify)           | add `cellToExcelValue` (typed numbers/percent)                                                   | T1     |
| `src/lib/boards/spreadsheet/format-workbook.ts` (create)      | colors/widths constants, `FormatPlan`, `applyWorkbookFormatting`, `optionFillHex`, `percentBand` | T2, T3 |
| `src/lib/boards/spreadsheet/export-workbook.ts` (modify)      | collect `FormatPlan` while emitting rows; apply on xlsx                                          | T4     |
| `src/lib/boards/spreadsheet/cell-codec.test.ts` (modify)      | `cellToExcelValue` cases                                                                         | T1     |
| `src/lib/boards/spreadsheet/format-workbook.test.ts` (create) | style application via re-loaded workbook                                                         | T2, T3 |
| `src/lib/boards/spreadsheet/export-workbook.test.ts` (modify) | integration + round-trip assertions                                                              | T4     |

---

### Task 1: `cellToExcelValue` — typed numbers/percent

**Files:**

- Modify: `src/lib/boards/spreadsheet/cell-codec.ts`
- Test: `src/lib/boards/spreadsheet/cell-codec.test.ts`

**Interfaces:**

- Consumes: existing `cellToText(kind, value, settings, resolvePeopleName?)` in the same file (unchanged).
- Produces (exact — Task 4 imports these):

  ```ts
  export type ExcelCellValue = string | number;
  export function cellToExcelValue(
    kind: ColumnKind,
    value: unknown,
    settings: unknown,
    resolvePeopleName?: (userId: string) => string | null,
  ): ExcelCellValue;
  ```

- [ ] **Step 1: Write the failing tests** (append to `cell-codec.test.ts`)

```ts
import { cellToExcelValue } from "./cell-codec";

describe("cellToExcelValue", () => {
  it("returns a real number for numbers cells", () => {
    expect(cellToExcelValue("numbers", { n: 42.5 }, {})).toBe(42.5);
  });

  it("returns a real number for percent cells", () => {
    expect(cellToExcelValue("percent", { percent: 60 }, {})).toBe(60);
  });

  it("returns empty string for blank numbers/percent", () => {
    expect(cellToExcelValue("numbers", null, {})).toBe("");
    expect(cellToExcelValue("percent", { percent: "bogus" }, {})).toBe("");
  });

  it("returns the cellToText string for every other kind", () => {
    expect(
      cellToExcelValue(
        "status",
        { optionId: "o1" },
        { options: [{ id: "o1", label: "Done", color: "#00c875" }] },
      ),
    ).toBe("Done");
    expect(cellToExcelValue("date", { date: "2026-07-03" }, {})).toBe(
      "2026-07-03",
    );
    expect(cellToExcelValue("checkbox", { checked: true }, {})).toBe("TRUE");
  });

  it("never throws on malformed input", () => {
    expect(cellToExcelValue("numbers", 7, {})).toBe("");
    expect(cellToExcelValue("percent", "x", null)).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/boards/spreadsheet/cell-codec.test.ts`
Expected: FAIL — `cellToExcelValue` is not exported.

- [ ] **Step 3: Implement** (append to `cell-codec.ts`, after `cellToText`)

```ts
/** A cell value ready for exceljs `addRow`: real numbers for numbers/percent,
 *  the flat `cellToText` string otherwise. Never throws. */
export type ExcelCellValue = string | number;

export function cellToExcelValue(
  kind: ColumnKind,
  value: unknown,
  settings: unknown,
  resolvePeopleName?: (userId: string) => string | null,
): ExcelCellValue {
  const text = cellToText(kind, value, settings, resolvePeopleName);
  if ((kind === "numbers" || kind === "percent") && text !== "") {
    const n = Number(text);
    if (Number.isFinite(n)) return n;
  }
  return text;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/boards/spreadsheet/cell-codec.test.ts`
Expected: PASS (all pre-existing cases too).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/spreadsheet/cell-codec.ts src/lib/boards/spreadsheet/cell-codec.test.ts
git commit -m "feat(boards): typed excel cell values for numbers and percent"
# body: explain numbers/percent export as real numbers so data bars and native
# right-alignment work, cellToText untouched; end with the Co-Authored-By trailer.
```

---

### Task 2: `format-workbook.ts` — constants, plan type, static styling

**Files:**

- Create: `src/lib/boards/spreadsheet/format-workbook.ts`
- Test: `src/lib/boards/spreadsheet/format-workbook.test.ts`

**Interfaces:**

- Consumes: `pillTextColor` from `@/lib/boards/contrast`; `ColumnKind` from `@/lib/validations/boards`; `ExcelJS.Worksheet`.
- Produces (exact — Tasks 3 and 4 build on these):

  ```ts
  export type PercentBand =
    | "red"
    | "orange"
    | "amber"
    | "lime"
    | "green"
    | "complete";
  export const PERCENT_BAND_HEX: Record<PercentBand, string>;
  export function percentBand(p: number): PercentBand;
  export const HEADER_FILL_HEX = "#1A1A1D";
  export const SUBITEM_FG_HEX = "#6B7280";
  export const KIND_WIDTHS: Partial<Record<ColumnKind, number>>;
  export function argb(hex: string): string | null; // "#EA3A48" → "FFEA3A48"; invalid → null
  export function optionFillHex(
    kind: ColumnKind,
    value: unknown,
    settings: unknown,
  ): string | null;
  export type FormatPlan = {
    /** Board columns in emitted order; worksheet column = index + 3 (A=Group, B=Name). */
    columnKinds: ColumnKind[];
    /** One entry per emitted data row. */
    rows: { rowNumber: number; groupColor: string; isSubitem: boolean }[];
    /** Status / single-select dropdown fills. colIndex is 1-based worksheet column. */
    optionFills: { rowNumber: number; colIndex: number; hex: string }[];
    /** Percent cells with their numeric value (0–100). */
    percentCells: { rowNumber: number; colIndex: number; value: number }[];
  };
  export function applyWorkbookFormatting(
    ws: ExcelJS.Worksheet,
    plan: FormatPlan,
  ): void;
  ```

- [ ] **Step 1: Write the failing tests** (create `format-workbook.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  applyWorkbookFormatting,
  argb,
  optionFillHex,
  percentBand,
  KIND_WIDTHS,
  type FormatPlan,
} from "./format-workbook";

function solidFillArgb(cell: ExcelJS.Cell): string | undefined {
  const fill = cell.fill as { pattern?: string; fgColor?: { argb?: string } };
  return fill?.fgColor?.argb;
}

/** Build a tiny sheet, apply the plan, write + reload so we assert what Excel will read. */
async function roundTrip(plan: FormatPlan, rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("t");
  ws.addRow(["Group", "Name", "Status", "Percent"]);
  for (const r of rows) ws.addRow(r);
  applyWorkbookFormatting(ws, plan);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf as unknown as Parameters<typeof wb2.xlsx.load>[0]);
  return wb2.worksheets[0];
}

const basePlan: FormatPlan = {
  columnKinds: ["status", "percent"],
  rows: [
    { rowNumber: 2, groupColor: "#0059ff", isSubitem: false },
    { rowNumber: 3, groupColor: "#0059ff", isSubitem: true },
  ],
  optionFills: [{ rowNumber: 2, colIndex: 3, hex: "#00c875" }],
  percentCells: [
    { rowNumber: 2, colIndex: 4, value: 60 },
    { rowNumber: 3, colIndex: 4, value: 100 },
  ],
};
const baseRows = [
  ["Backlog", "Build login", "Done", 60],
  ["Backlog", "↳ sub", "", 100],
];

describe("argb", () => {
  it("converts #rrggbb to FFRRGGBB", () => {
    expect(argb("#00c875")).toBe("FF00C875");
  });
  it("returns null for junk", () => {
    expect(argb("teal")).toBeNull();
    expect(argb("#12")).toBeNull();
  });
});

describe("percentBand", () => {
  it.each([
    [0, "red"],
    [19, "red"],
    [20, "orange"],
    [39, "orange"],
    [40, "amber"],
    [59, "amber"],
    [60, "lime"],
    [79, "lime"],
    [80, "green"],
    [99, "green"],
    [100, "complete"],
    [150, "complete"],
    [-5, "red"],
  ])("%s → %s", (v, band) => {
    expect(percentBand(v as number)).toBe(band);
  });
});

describe("optionFillHex", () => {
  const settings = {
    options: [
      { id: "a", label: "Done", color: "#00c875" },
      { id: "b", label: "Stuck", color: "#e2445c" },
    ],
  };
  it("resolves a status option color", () => {
    expect(optionFillHex("status", { optionId: "a" }, settings)).toBe(
      "#00c875",
    );
  });
  it("resolves a single-select dropdown color", () => {
    expect(optionFillHex("dropdown", { optionIds: ["b"] }, settings)).toBe(
      "#e2445c",
    );
  });
  it("returns null for multi-select dropdown, blanks, unknown ids, junk", () => {
    expect(
      optionFillHex("dropdown", { optionIds: ["a", "b"] }, settings),
    ).toBeNull();
    expect(optionFillHex("status", { optionId: null }, settings)).toBeNull();
    expect(optionFillHex("status", { optionId: "zz" }, settings)).toBeNull();
    expect(optionFillHex("status", "junk", null)).toBeNull();
    expect(optionFillHex("text", { text: "x" }, settings)).toBeNull();
  });
});

describe("applyWorkbookFormatting — static styles", () => {
  it("styles the header: bold white on #1A1A1D, frozen pane, autofilter, height", async () => {
    const ws = await roundTrip(basePlan, baseRows);
    const h = ws.getRow(1);
    expect(h.getCell(1).font?.bold).toBe(true);
    expect(h.getCell(1).font?.color?.argb).toBe("FFFFFFFF");
    expect(solidFillArgb(h.getCell(1))).toBe("FF1A1A1D");
    expect(ws.views?.[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
  });

  it("sets per-kind column widths (Group 18, Name 32, status 16, percent 12)", async () => {
    const ws = await roundTrip(basePlan, baseRows);
    expect(Math.round(ws.getColumn(1).width ?? 0)).toBe(18);
    expect(Math.round(ws.getColumn(2).width ?? 0)).toBe(32);
    expect(Math.round(ws.getColumn(3).width ?? 0)).toBe(KIND_WIDTHS.status);
    expect(Math.round(ws.getColumn(4).width ?? 0)).toBe(KIND_WIDTHS.percent);
  });

  it("fills group cells with the group color and contrast text", async () => {
    const ws = await roundTrip(basePlan, baseRows);
    expect(solidFillArgb(ws.getRow(2).getCell(1))).toBe("FF0059FF");
    expect(ws.getRow(2).getCell(1).font?.color?.argb).toBe("FFFFFFFF"); // white on #0059ff
  });

  it("fills status cells with the option color and contrast text", async () => {
    const ws = await roundTrip(basePlan, baseRows);
    expect(solidFillArgb(ws.getRow(2).getCell(3))).toBe("FF00C875");
    expect(ws.getRow(2).getCell(3).font?.color?.argb).toBe("FF1A1A1D"); // dark on green
  });

  it("renders subitem name cells italic and muted", async () => {
    const ws = await roundTrip(basePlan, baseRows);
    expect(ws.getRow(3).getCell(2).font?.italic).toBe(true);
    expect(ws.getRow(3).getCell(2).font?.color?.argb).toBe("FF6B7280");
  });

  it("skips unparseable colors without throwing", async () => {
    const plan: FormatPlan = {
      ...basePlan,
      rows: [{ rowNumber: 2, groupColor: "nope", isSubitem: false }],
      optionFills: [{ rowNumber: 2, colIndex: 3, hex: "junk" }],
    };
    const ws = await roundTrip(plan, baseRows);
    expect(solidFillArgb(ws.getRow(2).getCell(1))).toBeUndefined();
    expect(solidFillArgb(ws.getRow(2).getCell(3))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/boards/spreadsheet/format-workbook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `format-workbook.ts`** (percent data bars land in Task 3; this task ships everything else, including the `percentCells` numFmt)

```ts
import type ExcelJS from "exceljs";
import type { ColumnKind } from "@/lib/validations/boards";
import { pillTextColor } from "@/lib/boards/contrast";

/** Six red→green bands mirroring src/lib/boards/percent-color.ts.
 *  Hex values are sRGB freezes of the light-mode --progress-* OKLCH tokens
 *  in src/app/globals.css (source of truth; re-derive if the tokens move). */
export type PercentBand =
  | "red"
  | "orange"
  | "amber"
  | "lime"
  | "green"
  | "complete";

export const PERCENT_BAND_HEX: Record<PercentBand, string> = {
  red: "#EA3A48",
  orange: "#F07437",
  amber: "#E5A83B",
  lime: "#8FC15D",
  green: "#3FAE71",
  complete: "#12965C",
};

export function percentBand(p: number): PercentBand {
  const v = Math.max(0, Math.min(100, p));
  if (v >= 100) return "complete";
  if (v >= 80) return "green";
  if (v >= 60) return "lime";
  if (v >= 40) return "amber";
  if (v >= 20) return "orange";
  return "red";
}

export const HEADER_FILL_HEX = "#1A1A1D";
export const SUBITEM_FG_HEX = "#6B7280";
const GROUP_COL_WIDTH = 18;
const NAME_COL_WIDTH = 32;
const DEFAULT_WIDTH = 14;

export const KIND_WIDTHS: Partial<Record<ColumnKind, number>> = {
  text: 24,
  link: 24,
  email: 24,
  people: 20,
  status: 16,
  dropdown: 16,
  phone: 14,
  date: 12,
  percent: 12,
  numbers: 10,
  checkbox: 10,
  rating: 8,
};

/** "#rgb"/"#rrggbb" → exceljs ARGB ("FFRRGGBB"); null when unparseable. */
export function argb(hex: string): string | null {
  if (typeof hex !== "string") return null;
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return null;
  return `FF${full.toUpperCase()}`;
}

function solidFill(argbColor: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: argbColor } };
}

/** The fill color a status / single-select dropdown cell should carry, or null. Never throws. */
export function optionFillHex(
  kind: ColumnKind,
  value: unknown,
  settings: unknown,
): string | null {
  try {
    if (value == null || typeof value !== "object") return null;
    const s = settings as {
      options?: Array<{ id: string; color?: string }>;
    } | null;
    if (!s || !Array.isArray(s.options)) return null;

    let optionId: unknown = null;
    if (kind === "status") {
      optionId = (value as { optionId?: unknown }).optionId;
    } else if (kind === "dropdown") {
      const ids = (value as { optionIds?: unknown }).optionIds;
      if (Array.isArray(ids) && ids.length === 1) optionId = ids[0];
    } else {
      return null;
    }
    if (typeof optionId !== "string") return null;

    const opt = s.options.find((o) => o.id === optionId);
    return typeof opt?.color === "string" ? opt.color : null;
  } catch {
    return null;
  }
}

export type FormatPlan = {
  /** Board columns in emitted order; worksheet column = index + 3 (A=Group, B=Name). */
  columnKinds: ColumnKind[];
  /** One entry per emitted data row. */
  rows: { rowNumber: number; groupColor: string; isSubitem: boolean }[];
  /** Status / single-select dropdown fills. colIndex is 1-based worksheet column. */
  optionFills: { rowNumber: number; colIndex: number; hex: string }[];
  /** Percent cells with their numeric value (0–100). */
  percentCells: { rowNumber: number; colIndex: number; value: number }[];
};

/** Apply all board-fidelity styling to a fully-populated worksheet. Best-effort:
 *  bad colors degrade to unstyled cells; never throws. xlsx only — callers skip for csv. */
export function applyWorkbookFormatting(
  ws: ExcelJS.Worksheet,
  plan: FormatPlan,
): void {
  const totalCols = 2 + plan.columnKinds.length;

  // Header: bold white on near-black, frozen, filtered.
  const header = ws.getRow(1);
  header.height = 22;
  const headerArgb = argb(HEADER_FILL_HEX);
  for (let c = 1; c <= totalCols; c++) {
    const cell = header.getCell(c);
    if (headerArgb) cell.fill = solidFill(headerArgb);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: totalCols },
  };

  // Column widths.
  ws.getColumn(1).width = GROUP_COL_WIDTH;
  ws.getColumn(2).width = NAME_COL_WIDTH;
  plan.columnKinds.forEach((kind, i) => {
    ws.getColumn(3 + i).width = KIND_WIDTHS[kind] ?? DEFAULT_WIDTH;
  });

  // Group fills + subitem name styling.
  for (const row of plan.rows) {
    const groupArgb = argb(row.groupColor);
    if (groupArgb) {
      const cell = ws.getRow(row.rowNumber).getCell(1);
      cell.fill = solidFill(groupArgb);
      const fg = argb(pillTextColor(row.groupColor));
      if (fg) cell.font = { color: { argb: fg } };
    }
    if (row.isSubitem) {
      const nameFg = argb(SUBITEM_FG_HEX);
      ws.getRow(row.rowNumber).getCell(2).font = {
        italic: true,
        ...(nameFg ? { color: { argb: nameFg } } : {}),
      };
    }
  }

  // Status / single-select dropdown fills.
  for (const f of plan.optionFills) {
    const bg = argb(f.hex);
    if (!bg) continue;
    const cell = ws.getRow(f.rowNumber).getCell(f.colIndex);
    cell.fill = solidFill(bg);
    const fg = argb(pillTextColor(f.hex));
    if (fg) cell.font = { color: { argb: fg } };
    cell.alignment = { horizontal: "center" };
  }

  // Percent display format ("60%" while the stored value stays 60 → round-trip safe).
  for (const pc of plan.percentCells) {
    ws.getRow(pc.rowNumber).getCell(pc.colIndex).numFmt = '0"%"';
  }

  applyPercentDataBars(ws, plan); // Task 3
}

// Placeholder until Task 3 — keeps this task shippable and typecheck-green.
function applyPercentDataBars(
  _ws: ExcelJS.Worksheet,
  _plan: FormatPlan,
): void {}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/boards/spreadsheet/format-workbook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/spreadsheet/format-workbook.ts src/lib/boards/spreadsheet/format-workbook.test.ts
git commit -m "feat(boards): workbook formatting module for excel export"
# body: header/freeze/filter/widths, group + option fills with contrast text,
# subitem styling, percent numFmt; data bars follow in the next commit.
# End with the Co-Authored-By trailer.
```

---

### Task 3: Band-colored percent data bars

**Files:**

- Modify: `src/lib/boards/spreadsheet/format-workbook.ts` (replace the `applyPercentDataBars` placeholder)
- Test: `src/lib/boards/spreadsheet/format-workbook.test.ts` (append)

**Interfaces:**

- Consumes: `FormatPlan.percentCells`, `percentBand`, `PERCENT_BAND_HEX`, `argb` (Task 2).
- Produces: data-bar conditional formatting inside `applyWorkbookFormatting` — no new exports. Task 4 relies only on `applyWorkbookFormatting` already covering data bars.

- [ ] **Step 1: Write the failing tests** (append to `format-workbook.test.ts`)

```ts
describe("applyWorkbookFormatting — percent data bars", () => {
  it("adds one flat dataBar rule per band present, with 0–100 num cfvo", async () => {
    const plan: FormatPlan = {
      columnKinds: ["status", "percent"],
      rows: [
        { rowNumber: 2, groupColor: "#0059ff", isSubitem: false },
        { rowNumber: 3, groupColor: "#0059ff", isSubitem: false },
        { rowNumber: 4, groupColor: "#0059ff", isSubitem: false },
      ],
      optionFills: [],
      percentCells: [
        { rowNumber: 2, colIndex: 4, value: 10 }, // red
        { rowNumber: 3, colIndex: 4, value: 15 }, // red (same rule)
        { rowNumber: 4, colIndex: 4, value: 100 }, // complete
      ],
    };
    const ws = await roundTrip(plan, [
      ["Backlog", "a", "", 10],
      ["Backlog", "b", "", 15],
      ["Backlog", "c", "", 100],
    ]);

    // exceljs parses CF back onto the worksheet model.
    const cfs = (
      ws as unknown as {
        conditionalFormattings: Array<{
          ref: string;
          rules: Array<{
            type: string;
            cfvo?: Array<{ type: string; value?: number }>;
          }>;
        }>;
      }
    ).conditionalFormattings;

    const dataBars = cfs.filter((cf) =>
      cf.rules.some((r) => r.type === "dataBar"),
    );
    expect(dataBars).toHaveLength(2); // red bucket + complete bucket

    const redBucket = dataBars.find((cf) => cf.ref.includes("D2"));
    expect(redBucket?.ref).toBe("D2 D3"); // discontiguous sqref, space-separated
    const rule = redBucket?.rules[0];
    expect(rule?.cfvo?.[0]).toMatchObject({ type: "num", value: 0 });
    expect(rule?.cfvo?.[1]).toMatchObject({ type: "num", value: 100 });

    const completeBucket = dataBars.find((cf) => cf.ref === "D4");
    expect(completeBucket).toBeTruthy();
  });

  it("adds no dataBar rules when there are no percent cells", async () => {
    const plan: FormatPlan = { ...basePlan, percentCells: [] };
    const ws = await roundTrip(plan, baseRows);
    const cfs =
      (
        ws as unknown as {
          conditionalFormattings?: Array<{ rules: Array<{ type: string }> }>;
        }
      ).conditionalFormattings ?? [];
    expect(
      cfs.filter((cf) => cf.rules.some((r) => r.type === "dataBar")),
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/boards/spreadsheet/format-workbook.test.ts`
Expected: FAIL — 0 dataBar formattings found (placeholder is a no-op).

- [ ] **Step 3: Implement — replace the placeholder**

```ts
/** exceljs's DataBarRuleType omits `color`, but the xlsx writer renders it
 *  (lib/xlsx/xform/sheet/cf/databar-xform.js). Local, no-any extension. */
type ColoredDataBarRule = Extract<
  ExcelJS.ConditionalFormattingRule,
  { type: "dataBar" }
> & { color: Partial<ExcelJS.Color> };

function applyPercentDataBars(ws: ExcelJS.Worksheet, plan: FormatPlan): void {
  // Bucket percent cell addresses per worksheet column, per band.
  const byColumn = new Map<number, Map<PercentBand, string[]>>();
  for (const pc of plan.percentCells) {
    const band = percentBand(pc.value);
    let bands = byColumn.get(pc.colIndex);
    if (!bands) {
      bands = new Map();
      byColumn.set(pc.colIndex, bands);
    }
    const addrs = bands.get(band) ?? [];
    addrs.push(ws.getRow(pc.rowNumber).getCell(pc.colIndex).address);
    bands.set(band, addrs);
  }

  let priority = 1;
  for (const bands of byColumn.values()) {
    for (const [band, addrs] of bands) {
      const bandArgb = argb(PERCENT_BAND_HEX[band]);
      if (!bandArgb) continue;
      const rule: ColoredDataBarRule = {
        type: "dataBar",
        priority: priority++,
        gradient: false,
        showValue: true,
        cfvo: [
          { type: "num", value: 0 },
          { type: "num", value: 100 },
        ],
        color: { argb: bandArgb },
      };
      ws.addConditionalFormatting({
        ref: addrs.join(" "), // OOXML sqref: space-separated discontiguous ranges
        rules: [rule],
      });
    }
  }
}
```

(`Extract<…, { type: "dataBar" }>` resolves to `DataBarRuleType`. The equivalent simpler spelling is `type ColoredDataBarRule = ExcelJS.DataBarRuleType & { color: Partial<ExcelJS.Color> }` — exceljs exports `DataBarRuleType` from the package root. Use whichever typechecks; both are `any`-free.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/boards/spreadsheet/format-workbook.test.ts`
Expected: PASS (Task 2 cases stay green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/spreadsheet/format-workbook.ts src/lib/boards/spreadsheet/format-workbook.test.ts
git commit -m "feat(boards): band-colored data bars for percent columns"
# body: ≤6 flat dataBar CF rules per percent column via band-bucketed
# discontiguous sqref refs; colors mirror the board's progress bands.
# End with the Co-Authored-By trailer.
```

---

### Task 4: Wire formatting into `buildExportWorkbook` + round-trip guarantee

**Files:**

- Modify: `src/lib/boards/spreadsheet/export-workbook.ts`
- Test: `src/lib/boards/spreadsheet/export-workbook.test.ts` (append)

**Interfaces:**

- Consumes: `cellToExcelValue` (Task 1); `FormatPlan`, `applyWorkbookFormatting`, `optionFillHex` (Tasks 2–3); existing `cellToText`, `parseWorkbook`, `detectColumns`.
- Produces: `buildExportWorkbook(payload, format, peopleNames?)` — **signature unchanged**; xlsx output now styled. `exportBoard` and the CSV path need no edits.

- [ ] **Step 1: Write the failing tests** (append to `export-workbook.test.ts`; reuse the existing `makePayload()` helper, extending it with a percent column and a percent cell)

```ts
import { detectColumns } from "./detect";

// Extend the fixture: add a percent column (position 2) and cells.
// In makePayload(), add to columns:
//   { id: "col-percent", name: "Progress", kind: "percent", board_id: boardId,
//     org_id: orgId, position: 2, settings: {}, created_at: "...", updated_at: "...", width: null },
// and to cellValues (both shapes match existing entries):
//   { item_id: itemId, column_id: "col-percent", value: { percent: 60 }, ... },
//   { item_id: subitemId, column_id: "col-percent", value: { percent: 100 }, ... }

describe("xlsx formatting", () => {
  it('writes percent cells as numbers with the 0"%" format', async () => {
    const { buffer } = await buildExportWorkbook(makePayload(), "xlsx");
    const wb = new (await import("exceljs")).default.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    // Row 2 = first item; percent col = Group + Name + (status, numbers, percent) → col 5.
    const cell = ws.getRow(2).getCell(5);
    expect(cell.value).toBe(60);
    expect(cell.numFmt).toBe('0"%"');
  });

  it("styles header, fills status cells, freezes the pane", async () => {
    const { buffer } = await buildExportWorkbook(makePayload(), "xlsx");
    const wb = new (await import("exceljs")).default.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(ws.views?.[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    const statusFill = ws.getRow(2).getCell(3).fill as {
      fgColor?: { argb?: string };
    };
    expect(statusFill?.fgColor?.argb).toBe("FF00C875");
  });

  it("adds dataBar conditional formatting for the percent column", async () => {
    const { buffer } = await buildExportWorkbook(makePayload(), "xlsx");
    const wb = new (await import("exceljs")).default.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0] as unknown as {
      conditionalFormattings: Array<{ rules: Array<{ type: string }> }>;
    };
    expect(
      ws.conditionalFormattings.filter((cf) =>
        cf.rules.some((r) => r.type === "dataBar"),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("round-trips: formatted export still parses and detects identically", async () => {
    const { buffer } = await buildExportWorkbook(makePayload(), "xlsx");
    const sheet = await parseWorkbook(buffer, "board.xlsx");
    expect(sheet.header).toEqual([
      GROUP_HEADER,
      NAME_HEADER,
      "Status",
      "Count",
      "Progress",
    ]);
    // Percent values stringify back from real numbers.
    expect(sheet.rows[0][4]).toBe("60");
    expect(sheet.rows[1][1].startsWith(SUBTASK_MARKER)).toBe(true);
    const detected = detectColumns(sheet.header, sheet.rows);
    expect(detected.find((c) => c.header === "Progress")?.kind).toBe("percent");
    expect(detected.find((c) => c.header === "Status")?.kind).toBe("status");
  });

  it("csv output carries no styling and still parses", async () => {
    const { buffer, ext } = await buildExportWorkbook(makePayload(), "csv");
    expect(ext).toBe("csv");
    const sheet = await parseWorkbook(buffer, "board.csv");
    expect(sheet.rows[0][4]).toBe("60");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/boards/spreadsheet/export-workbook.test.ts`
Expected: FAIL — percent cell is the string `"60"`, no fills/CF present.

- [ ] **Step 3: Implement — modify `export-workbook.ts`**

Replace the body of the row-emission section so it (a) uses `cellToExcelValue`, (b) collects a `FormatPlan`, (c) applies formatting for xlsx only. Full replacement of the function's middle (imports shown too):

```ts
import ExcelJS from "exceljs";
import {
  GROUP_HEADER,
  NAME_HEADER,
  SUBTASK_MARKER,
  type ImportFormat,
} from "./types";
import { cellToExcelValue, type ExcelCellValue } from "./cell-codec";
import {
  applyWorkbookFormatting,
  optionFillHex,
  type FormatPlan,
} from "./format-workbook";
import type { BoardPayload } from "@/lib/boards/queries";
```

Inside `buildExportWorkbook`, after the header row is added, build the plan while emitting rows (replaces the current `for (const group of groups)` loop; the `cellLookup`, `columns`, `groups` prep is unchanged):

```ts
const plan: FormatPlan = {
  columnKinds: columns.map((c) => c.kind),
  rows: [],
  optionFills: [],
  percentCells: [],
};

/** Emit one item row, recording its formatting facts. */
function emitRow(
  groupName: string,
  groupColor: string,
  itemId: string,
  displayName: string,
  isSubitem: boolean,
): void {
  const colMap = cellLookup.get(itemId);
  const dataCells: ExcelCellValue[] = columns.map((col) =>
    cellToExcelValue(
      col.kind,
      colMap?.get(col.id),
      col.settings,
      resolvePeopleName,
    ),
  );
  const row = ws.addRow([groupName, displayName, ...dataCells]);
  const rowNumber = row.number;

  plan.rows.push({ rowNumber, groupColor, isSubitem });
  columns.forEach((col, i) => {
    const colIndex = 3 + i;
    const value = colMap?.get(col.id);
    const fill = optionFillHex(col.kind, value, col.settings);
    if (fill) plan.optionFills.push({ rowNumber, colIndex, hex: fill });
    if (col.kind === "percent" && typeof dataCells[i] === "number") {
      plan.percentCells.push({ rowNumber, colIndex, value: dataCells[i] });
    }
  });
}

for (const group of groups) {
  const topLevelItems = payload.items
    .filter((item) => item.group_id === group.id && item.parent_id === null)
    .sort((a, b) => a.position - b.position);

  for (const item of topLevelItems) {
    emitRow(group.name, group.color, item.id, item.name, false);

    const subitems = payload.items
      .filter((sub) => sub.parent_id === item.id)
      .sort((a, b) => a.position - b.position);
    for (const sub of subitems) {
      emitRow(group.name, group.color, sub.id, SUBTASK_MARKER + sub.name, true);
    }
  }
}

if (format === "xlsx") {
  applyWorkbookFormatting(ws, plan);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    buffer,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  };
}
const buffer = Buffer.from(await wb.csv.writeBuffer());
return { buffer, mime: "text/csv", ext: "csv" };
```

Notes for the implementer: `groups.color` is non-null in the DB schema (check `Tables<"groups">` — if nullable, pass `group.color ?? ""`, which `argb` safely rejects). `row.number` is exceljs's 1-based row index. The old per-item mapping code is fully superseded by `emitRow`.

- [ ] **Step 4: Run the full spreadsheet suite**

Run: `pnpm vitest run src/lib/boards/spreadsheet`
Expected: PASS — including all pre-existing export/import/codec tests (round-trip pinned).

- [ ] **Step 5: Gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. (Cold-typecheck `cacheLife` failures are a known non-issue — run `pnpm build` first if hit.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/spreadsheet/export-workbook.ts src/lib/boards/spreadsheet/export-workbook.test.ts
git commit -m "feat(boards): formatted excel export wired into buildExportWorkbook"
# body: collect FormatPlan during row emission, apply styling for xlsx only,
# csv byte-behavior preserved, round-trip pinned by tests.
# End with the Co-Authored-By trailer.
```

- [ ] **Step 7: Manual verification (before finish-task)**

1. `pnpm dev`, open a board with status, dropdown, percent, numbers, date columns and at least one subitem.
2. Export → Excel (.xlsx); open the file in Excel or LibreOffice.
3. Expect: dark bold frozen header with filter arrows; Group column cells in group colors; status cells filled in their option colors with legible text; percent cells showing `NN%` with in-cell bars colored red→green by value; sensible column widths; subitem names muted italic with `↳ `.
4. Re-import the exported file (New board → Import from file): preview detects Status/percent/etc. identically; committed board matches the original's values.
5. Export → CSV; open: plain values, percent as bare numbers (unchanged from before).

---

## Execution DAG (working agreement #6)

**Dependency graph:**

- Task 1 (typed cell values) — no dependencies
- Task 2 (formatting module, static styles) — no dependencies
- Task 3 (percent data bars) — depends on Task 2 (same module, replaces its placeholder)
- Task 4 (integration + round-trip) — depends on Tasks 1, 2, 3

**Parallel batches:**

| Batch | Tasks           | Notes                                                                          |
| ----- | --------------- | ------------------------------------------------------------------------------ |
| 1     | Task 1 ∥ Task 2 | disjoint files (`cell-codec.*` vs `format-workbook.*`) — dispatch concurrently |
| 2     | Task 3          | single task; touches Task 2's files                                            |
| 3     | Task 4          | integration; consumes everything                                               |

**Critical path:** Task 2 → Task 3 → Task 4 (3 tasks). Task 1 is off the critical path and hides entirely inside batch 1. With batch-1 parallel dispatch, wall-clock ≈ T2 + T3 + T4.

All four tasks run in this one worktree/branch (`task/excel-export-formatting`) — batch-1 parallelism means two subagents editing disjoint files in the same tree, which is safe here because the file sets are disjoint and commits are staged by path.

## Performance & data-fetching budget (from the spec — binding)

- First paint: zero change (no UI edits; exceljs stays server-only).
- Export click: same single server-action round-trip; **zero new queries** — the plan derives from the already-bounded `getBoardPayload`.
- CF rules bounded at ≤ 6 per percent column (band buckets), never per-row; styling pass is O(rows × cols) in-memory; xlsx buffer growth ~10–30%, low single-digit MB at product caps.

## Definition of done

Gates green → `scripts/finish-task.sh` (merge to `develop`, worktree removed, branch deleted) → "How to test" walkthrough (Task 4 Step 7 content) in the closing message and `/wrapup` note → feedback row F3 (`public.feedback`, "Improve export excell formatting") updated to `resolved` with an admin response per the MVP Final Features plan.
