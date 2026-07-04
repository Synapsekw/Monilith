import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseWorkbook, parseWorkbookSheets } from "./parse-workbook";
import { MAX_ROWS, MAX_COLS } from "./types";

async function xlsxBuf(
  rows: string[][],
  sheetName = "Sheet1",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseWorkbook", () => {
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

  it("reports second sheet name in droppedSheets", async () => {
    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet("Main");
    ws1.addRow(["Name", "Status"]);
    ws1.addRow(["A", "Done"]);
    const ws2 = wb.addWorksheet("Extra");
    ws2.addRow(["Foo"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const out = await parseWorkbook(buf, "multi.xlsx");
    expect(out.header).toEqual(["Name", "Status"]);
    expect(out.rows).toEqual([["A", "Done"]]);
    expect(out.droppedSheets).toEqual(["Extra"]);
  });

  it("preserves column positions when a middle cell is empty", async () => {
    const buf = await xlsxBuf([
      ["Name", "A", "B", "C"],
      ["Row1", "val1", "", "val3"],
    ]);
    const out = await parseWorkbook(buf, "gap.xlsx");
    expect(out.header).toEqual(["Name", "A", "B", "C"]);
    expect(out.rows).toEqual([["Row1", "val1", "", "val3"]]);
  });

  it("throws Error('empty') when there is no header row", async () => {
    const buf = await xlsxBuf([]);
    await expect(parseWorkbook(buf, "empty.xlsx")).rejects.toThrow("empty");
  });

  it("skips fully-empty rows", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Name", "Status"]);
    ws.addRow(["A", "Done"]);
    // Add a blank row by leaving a gap (row index 4)
    ws.addRow(["B", "Pending"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const out = await parseWorkbook(buf, "skip.xlsx");
    expect(out.header).toEqual(["Name", "Status"]);
    expect(out.rows.length).toBe(2);
    expect(out.rows).toEqual([
      ["A", "Done"],
      ["B", "Pending"],
    ]);
  });
});

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

  it("rejects a sheet whose declared columns exceed MAX_COLS, naming it", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("WideSheet");
    ws.addRow(Array.from({ length: MAX_COLS + 1 }, (_, i) => `Col${i}`));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseWorkbookSheets(buf, "wide.xlsx")).rejects.toThrow(
      /WideSheet.*too many columns/i,
    );
  });

  it("rejects a sheet whose declared rows exceed MAX_ROWS before building the grid", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("TallSheet");
    for (let i = 0; i <= MAX_ROWS; i++) ws.addRow([`Task ${i}`]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseWorkbookSheets(buf, "tall.xlsx")).rejects.toThrow(
      /TallSheet.*too many rows/i,
    );
  });

  it("caps each row's cells at MAX_COLS even when a row is padded wider", async () => {
    // A row with exactly MAX_COLS cells parses; the grid never exceeds the cap.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(Array.from({ length: MAX_COLS }, (_, i) => `Col${i}`));
    ws.addRow(Array.from({ length: MAX_COLS }, (_, i) => `v${i}`));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const sheets = await parseWorkbookSheets(buf, "ok.xlsx");
    expect(sheets[0].grid[0]).toHaveLength(MAX_COLS);
  });
});
