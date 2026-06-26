import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseWorkbook } from "./parse-workbook";

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
