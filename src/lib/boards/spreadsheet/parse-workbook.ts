import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import type { ParsedSheet } from "./types";

/** Parse the FIRST worksheet of an xlsx/csv buffer into header + string rows.
 *  Other sheets are reported in `droppedSheets`. Trailing empty rows/cols trimmed.
 *  Throws Error('empty') when there is no header row. */
export async function parseWorkbook(
  buf: Buffer,
  fileName: string,
): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  const isCsv = fileName.toLowerCase().endsWith(".csv");

  if (isCsv) {
    await wb.csv.read(Readable.from(buf.toString("utf8")));
  } else {
    // exceljs types xlsx.load's param as the non-generic `Buffer`, while
    // @types/node now models `Buffer` as `Buffer<ArrayBufferLike>`. Same runtime
    // type — cast to exceljs's own expected param type to bridge the mismatch.
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  }

  const worksheet = wb.worksheets[0];
  const droppedSheets = wb.worksheets.slice(1).map((ws) => ws.name);

  if (!worksheet) {
    throw new Error("empty");
  }

  // Collect all rows using eachRow (which skips empty rows in xlsx)
  const allRows: string[][] = [];
  worksheet.eachRow((row) => {
    const cells: string[] = [];
    // row.cellCount gives the number of columns used; use row.actualCellCount to get non-empty
    // We iterate using getCell by index to preserve column positions
    const lastCol = row.cellCount;
    for (let col = 1; col <= lastCol; col++) {
      cells.push(row.getCell(col).text);
    }
    allRows.push(cells);
  });

  if (allRows.length === 0) {
    throw new Error("empty");
  }

  // Row 1 is the header
  const rawHeader = allRows[0];

  // Right-trim trailing empty header columns
  let headerLen = rawHeader.length;
  while (headerLen > 0 && rawHeader[headerLen - 1] === "") {
    headerLen--;
  }

  if (headerLen === 0) {
    throw new Error("empty");
  }

  const header = rawHeader.slice(0, headerLen);

  // Process data rows (rows 2..n)
  const rows: string[][] = [];
  for (let i = 1; i < allRows.length; i++) {
    const rawRow = allRows[i];

    // Build a row aligned to header length using getCell semantics
    const row: string[] = [];
    for (let col = 0; col < header.length; col++) {
      row.push(rawRow[col] ?? "");
    }

    // Skip fully-empty rows
    if (row.every((cell) => cell === "")) {
      continue;
    }

    rows.push(row);
  }

  return { header, rows, droppedSheets };
}
