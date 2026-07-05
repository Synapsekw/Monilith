import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import type { ParsedSheet, RawSheet } from "./types";
import { MAX_ROWS, MAX_COLS } from "./types";
import { selectRows } from "./select-rows";

async function loadWorkbook(
  buf: Buffer,
  fileName: string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  if (fileName.toLowerCase().endsWith(".csv")) {
    await wb.csv.read(Readable.from(buf.toString("utf8")));
  } else {
    // exceljs types xlsx.load's param as the non-generic `Buffer`, while
    // @types/node now models `Buffer` as `Buffer<ArrayBufferLike>`. Same runtime
    // type — cast to exceljs's own expected param type to bridge the mismatch.
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
    const name = isCsv && wi === 0 ? csvName : ws.name;

    // Guard BEFORE allocating the string[][] grid. `wb.xlsx.load` has already
    // decompressed the workbook, so a zip-bomb / oversized sheet must be
    // rejected on its declared dimensions rather than materialising a
    // rowCount × cellCount grid first (which is the real memory-DoS vector).
    // These caps also mean the build loops below can never exceed MAX_ROWS ×
    // MAX_COLS allocations.
    const rowCount = ws.rowCount;
    const colCount = ws.columnCount;
    if (colCount > MAX_COLS) {
      throw new Error(
        `Sheet "${name}" has too many columns (${colCount}). The import limit is ${MAX_ROWS} rows × ${MAX_COLS} columns.`,
      );
    }
    if (rowCount > MAX_ROWS) {
      throw new Error(
        `Sheet "${name}" has too many rows (${rowCount}). The import limit is ${MAX_ROWS} rows × ${MAX_COLS} columns.`,
      );
    }

    const grid: string[][] = [];
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      const cellCount = Math.min(row.cellCount, MAX_COLS);
      for (let c = 1; c <= cellCount; c++) cells.push(row.getCell(c).text);
      grid.push(cells);
    }
    return { name, grid };
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
