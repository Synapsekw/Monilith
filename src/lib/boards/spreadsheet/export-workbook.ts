import ExcelJS from "exceljs";
import {
  GROUP_HEADER,
  NAME_HEADER,
  SUBTASK_MARKER,
  type ImportFormat,
} from "./types";
import { cellToText } from "./cell-codec";
import type { BoardPayload } from "@/lib/boards/queries";

/** Characters forbidden in Excel worksheet names. */
const FORBIDDEN_WS_NAME_RE = /[\[\]*?/\\:]/g;

function sanitizeWorksheetName(name: string): string {
  return name.replace(FORBIDDEN_WS_NAME_RE, "").slice(0, 31);
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
): Promise<{ buffer: Buffer; mime: string; ext: string }> {
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

  for (const group of groups) {
    // Top-level items in this group, sorted by position
    const topLevelItems = payload.items
      .filter((item) => item.group_id === group.id && item.parent_id === null)
      .sort((a, b) => a.position - b.position);

    for (const item of topLevelItems) {
      // Build the data cells for this item
      const dataCells = columns.map((col) => {
        const colMap = cellLookup.get(item.id);
        const value = colMap?.get(col.id);
        return cellToText(col.kind, value, col.settings);
      });

      ws.addRow([group.name, item.name, ...dataCells]);

      // Subitems of this item, sorted by position
      const subitems = payload.items
        .filter((sub) => sub.parent_id === item.id)
        .sort((a, b) => a.position - b.position);

      for (const sub of subitems) {
        const subDataCells = columns.map((col) => {
          const colMap = cellLookup.get(sub.id);
          const value = colMap?.get(col.id);
          return cellToText(col.kind, value, col.settings);
        });

        ws.addRow([group.name, SUBTASK_MARKER + sub.name, ...subDataCells]);
      }
    }
  }

  if (format === "xlsx") {
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
