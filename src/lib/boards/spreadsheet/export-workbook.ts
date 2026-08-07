import ExcelJS from "exceljs";
import {
  GROUP_HEADER,
  NAME_HEADER,
  SUBTASK_MARKER,
  type ImportFormat,
} from "./types";
import {
  cellToExcelValue,
  CSV_FORMULA_LEAD_RE,
  type ExcelCellValue,
} from "./cell-codec";
import {
  applyWorkbookFormatting,
  optionFillHex,
  type FormatPlan,
} from "./format-workbook";
import type { BoardPayload } from "@/lib/boards/queries";
import { currencyOf } from "@/lib/boards/currency";

/** Characters forbidden in Excel worksheet names. */
const FORBIDDEN_WS_NAME_RE = /[\[\]*?/\\:]/g;

function sanitizeWorksheetName(name: string): string {
  return name.replace(FORBIDDEN_WS_NAME_RE, "").slice(0, 31);
}

/**
 * Neutralize CSV formula injection for STRING cells only. A leading formula
 * trigger (`CSV_FORMULA_LEAD_RE`, defined in `cell-codec.ts` — the shared
 * source of truth for this guard and its import-side inverse,
 * `unquoteCsvFormulaGuard`) is defused with a single-quote prefix (the
 * spreadsheet then shows the literal text). Non-string cells (real numbers
 * from numeric columns) pass through untouched, so a legitimate negative
 * number like -42 stays numeric. xlsx export does NOT use this — its cells
 * are typed, so `-2+3` is stored as text, not evaluated.
 */
function guardCsvCell(value: ExcelCellValue): ExcelCellValue {
  if (typeof value !== "string") return value;
  return CSV_FORMULA_LEAD_RE.test(value) ? `'${value}` : value;
}

/**
 * Serialize a BoardPayload into an xlsx or csv buffer for download.
 * Columns are ordered by position. Groups are ordered by position.
 * Within each group, top-level items are emitted by position, each
 * immediately followed by their subitems (also by position).
 * Subitem Name cells are prefixed with SUBTASK_MARKER.
 */
export async function buildExportWorkbook(
  payload: BoardPayload,
  format: ImportFormat,
  /**
   * Display-name lookup for people-column user ids. When provided, people cells
   * export the resolved assignee names; ids absent from the map are omitted.
   * When omitted, people columns export blank (the v1 default).
   */
  peopleNames?: Map<string, string>,
): Promise<{ buffer: Buffer; mime: string; ext: string }> {
  const resolvePeopleName = peopleNames
    ? (userId: string) => peopleNames.get(userId) ?? null
    : undefined;

  // CSV output is untyped text, so a user-authored cell beginning with a formula
  // trigger would be evaluated by Excel/Sheets on open. Guard string cells in the
  // CSV path only; xlsx cells are typed and safe.
  const isCsv = format === "csv";
  const guard = (value: ExcelCellValue): ExcelCellValue =>
    isCsv ? guardCsvCell(value) : value;

  const wb = new ExcelJS.Workbook();
  const wsName = sanitizeWorksheetName(payload.board.name) || "Sheet1";
  const ws = wb.addWorksheet(wsName);

  // Sort columns by position
  const columns = [...payload.columns].sort((a, b) => a.position - b.position);

  // Header row
  const headerRow = [GROUP_HEADER, NAME_HEADER, ...columns.map((c) => c.name)];
  ws.addRow(headerRow);

  // Build cell-value lookup: Map<itemId, Map<columnId, cellValue.value>>
  const cellLookup = new Map<string, Map<string, unknown>>();
  for (const cv of payload.cellValues) {
    let colMap = cellLookup.get(cv.item_id);
    if (!colMap) {
      colMap = new Map();
      cellLookup.set(cv.item_id, colMap);
    }
    colMap.set(cv.column_id, cv.value);
  }

  // Sort groups by position
  const groups = [...payload.groups].sort((a, b) => a.position - b.position);

  // Formatting facts collected while emitting rows; applied for xlsx only.
  const plan: FormatPlan = {
    columnKinds: columns.map((c) => c.kind),
    rows: [],
    optionFills: [],
    percentCells: [],
    currencyCells: [],
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
    const row = ws.addRow([
      guard(groupName),
      guard(displayName),
      ...dataCells.map(guard),
    ]);
    const rowNumber = row.number;

    plan.rows.push({ rowNumber, groupColor, isSubitem });
    columns.forEach((col, i) => {
      const colIndex = 3 + i;
      const value = colMap?.get(col.id);
      const fill = optionFillHex(col.kind, value, col.settings);
      if (fill) plan.optionFills.push({ rowNumber, colIndex, hex: fill });
      const cellValue = dataCells[i];
      if (col.kind === "percent" && typeof cellValue === "number") {
        plan.percentCells.push({ rowNumber, colIndex, value: cellValue });
      }
      if (col.kind === "currency" && typeof cellValue === "number") {
        plan.currencyCells.push({
          rowNumber,
          colIndex,
          code: currencyOf(col.settings),
        });
      }
    });
  }

  for (const group of groups) {
    // Top-level items in this group, sorted by position
    const topLevelItems = payload.items
      .filter((item) => item.group_id === group.id && item.parent_id === null)
      .sort((a, b) => a.position - b.position);

    for (const item of topLevelItems) {
      emitRow(group.name, group.color, item.id, item.name, false);

      // Subitems of this item, sorted by position
      const subitems = payload.items
        .filter((sub) => sub.parent_id === item.id)
        .sort((a, b) => a.position - b.position);

      for (const sub of subitems) {
        emitRow(
          group.name,
          group.color,
          sub.id,
          SUBTASK_MARKER + sub.name,
          true,
        );
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
  } else {
    const buffer = Buffer.from(await wb.csv.writeBuffer());
    return {
      buffer,
      mime: "text/csv",
      ext: "csv",
    };
  }
}
