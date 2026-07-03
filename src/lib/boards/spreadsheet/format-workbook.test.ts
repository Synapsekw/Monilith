import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  applyWorkbookFormatting,
  argb,
  currencyNumFmt,
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
  currencyCells: [],
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
      currencyCells: [],
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

describe("currencyNumFmt", () => {
  it("formats with the ISO code as literal text and minor-unit decimals", () => {
    expect(currencyNumFmt("USD")).toBe('"USD" #,##0.00');
    expect(currencyNumFmt("KWD")).toBe('"KWD" #,##0.000');
    expect(currencyNumFmt("JPY")).toBe('"JPY" #,##0');
    // AED stays the ISO code in exports — never the U+20C3 glyph.
    expect(currencyNumFmt("AED")).toBe('"AED" #,##0.00');
  });
  it("degrades unknown codes to 2 decimals", () => {
    expect(currencyNumFmt("ZZZ")).toBe('"ZZZ" #,##0.00');
  });
});

describe("applyWorkbookFormatting — currency number format", () => {
  it("applies the column currency's numFmt while the stored value stays numeric", async () => {
    const plan: FormatPlan = {
      ...basePlan,
      percentCells: [],
      currencyCells: [{ rowNumber: 2, colIndex: 4, code: "AED" }],
    };
    const ws = await roundTrip(plan, [
      ["Backlog", "Build login", "Done", 1234.5],
      ["Backlog", "↳ sub", "", ""],
    ]);
    const cell = ws.getRow(2).getCell(4);
    expect(cell.value).toBe(1234.5);
    expect(cell.numFmt).toBe('"AED" #,##0.00');
  });
});
