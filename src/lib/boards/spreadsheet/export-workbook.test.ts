import { describe, it, expect } from "vitest";
import { buildExportWorkbook } from "./export-workbook";
import { parseWorkbook } from "./parse-workbook";
import { textToCell } from "./cell-codec";
import { detectColumns } from "./detect";
import { SUBTASK_MARKER, GROUP_HEADER, NAME_HEADER } from "./types";
import type { BoardPayload } from "@/lib/boards/queries";

// Minimal BoardPayload for testing — only the fields the code reads are required.
// We cast to BoardPayload so we don't need to supply unrelated fields.
function makePayload(): BoardPayload {
  const boardId = "board-1";
  const orgId = "org-1";
  const groupId = "group-1";
  const itemId = "item-1";
  const subitemId = "item-2";
  const statusColId = "col-status";
  const numbersColId = "col-numbers";
  const statusOptionId = "opt-done";

  return {
    board: {
      id: boardId,
      name: "My Test Board",
      org_id: orgId,
      workspace_id: "ws-1",
      position: 0,
      created_by: "user-1",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      description: null,
      name_column_width: null,
    },
    groups: [
      {
        id: groupId,
        name: "Backlog",
        board_id: boardId,
        org_id: orgId,
        position: 0,
        color: "#0059ff",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ],
    columns: [
      {
        id: statusColId,
        name: "Status",
        kind: "status",
        board_id: boardId,
        org_id: orgId,
        position: 0,
        settings: {
          options: [{ id: statusOptionId, label: "Done", color: "#00c875" }],
        },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        width: null,
      },
      {
        id: numbersColId,
        name: "Count",
        kind: "numbers",
        board_id: boardId,
        org_id: orgId,
        position: 1,
        settings: {},
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        width: null,
      },
      {
        id: "col-percent",
        name: "Progress",
        kind: "percent",
        board_id: boardId,
        org_id: orgId,
        position: 2,
        settings: {},
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        width: null,
      },
    ],
    items: [
      {
        id: itemId,
        name: "Build login",
        board_id: boardId,
        group_id: groupId,
        org_id: orgId,
        parent_id: null,
        position: 0,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
      {
        id: subitemId,
        name: "Design form",
        board_id: boardId,
        group_id: groupId,
        org_id: orgId,
        parent_id: itemId,
        position: 0,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ],
    cellValues: [
      {
        board_id: boardId,
        column_id: statusColId,
        item_id: itemId,
        org_id: orgId,
        value: { optionId: statusOptionId },
        updated_at: "2024-01-01T00:00:00Z",
      },
      {
        board_id: boardId,
        column_id: numbersColId,
        item_id: itemId,
        org_id: orgId,
        value: { n: 42 },
        updated_at: "2024-01-01T00:00:00Z",
      },
      {
        board_id: boardId,
        column_id: numbersColId,
        item_id: subitemId,
        org_id: orgId,
        value: { n: 7 },
        updated_at: "2024-01-01T00:00:00Z",
      },
      {
        board_id: boardId,
        column_id: "col-percent",
        item_id: itemId,
        org_id: orgId,
        value: { percent: 60 },
        updated_at: "2024-01-01T00:00:00Z",
      },
      {
        board_id: boardId,
        column_id: "col-percent",
        item_id: subitemId,
        org_id: orgId,
        value: { percent: 100 },
        updated_at: "2024-01-01T00:00:00Z",
      },
    ],
    // Unrelated fields — empty arrays satisfy the type.
    views: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  } as unknown as BoardPayload;
}

describe("buildExportWorkbook — CSV export", () => {
  it("includes the correct header row with GROUP_HEADER, NAME_HEADER, and column names", async () => {
    const payload = makePayload();
    const { buffer } = await buildExportWorkbook(payload, "csv");
    const text = buffer.toString("utf8");
    // First line should be the header
    const firstLine = text.split("\n")[0].trim();
    expect(firstLine).toContain(GROUP_HEADER);
    expect(firstLine).toContain(NAME_HEADER);
    expect(firstLine).toContain("Status");
    expect(firstLine).toContain("Count");
  });

  it("emits correct mime and ext for csv", async () => {
    const payload = makePayload();
    const { mime, ext } = await buildExportWorkbook(payload, "csv");
    expect(mime).toBe("text/csv");
    expect(ext).toBe("csv");
  });

  it("renders the top-level item with its group name and status label", async () => {
    const payload = makePayload();
    const { buffer } = await buildExportWorkbook(payload, "csv");
    const text = buffer.toString("utf8");
    // Should have "Backlog" as group, "Build login" as item name
    expect(text).toContain("Backlog");
    expect(text).toContain("Build login");
    // Status cell should be rendered as "Done"
    expect(text).toContain("Done");
    // Numbers cell
    expect(text).toContain("42");
  });

  it("renders subitems with the SUBTASK_MARKER prefix", async () => {
    const payload = makePayload();
    const { buffer } = await buildExportWorkbook(payload, "csv");
    const text = buffer.toString("utf8");
    // Subitem name should be "↳ Design form"
    expect(text).toContain(SUBTASK_MARKER + "Design form");
  });

  it("round-trips group, item, and subitem names through parseWorkbook", async () => {
    const payload = makePayload();
    const { buffer } = await buildExportWorkbook(payload, "csv");
    const parsed = await parseWorkbook(buffer, "export.csv");

    // Header should be [Group, Name, Status, Count, Progress]
    expect(parsed.header).toEqual([
      GROUP_HEADER,
      NAME_HEADER,
      "Status",
      "Count",
      "Progress",
    ]);

    // Should have 2 data rows: one top-level item and one subitem
    expect(parsed.rows).toHaveLength(2);

    // First row: top-level item
    expect(parsed.rows[0][0]).toBe("Backlog"); // group
    expect(parsed.rows[0][1]).toBe("Build login"); // name
    expect(parsed.rows[0][2]).toBe("Done"); // status
    expect(parsed.rows[0][3]).toBe("42"); // count

    // Second row: subitem with marker prefix
    expect(parsed.rows[1][1]).toBe(SUBTASK_MARKER + "Design form");
    expect(parsed.rows[1][3]).toBe("7"); // count
  });
});

describe("buildExportWorkbook — CSV formula-injection guard", () => {
  const NOTES = "col-notes";
  function withNotes(text: string): BoardPayload {
    const p = makePayload();
    p.columns.push({
      id: NOTES,
      name: "Notes",
      kind: "text",
      board_id: "board-1",
      org_id: "org-1",
      position: 3,
      settings: {},
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      width: null,
    } as unknown as BoardPayload["columns"][number]);
    p.cellValues.push({
      board_id: "board-1",
      column_id: NOTES,
      item_id: "item-1",
      org_id: "org-1",
      value: { text },
      updated_at: "2024-01-01T00:00:00Z",
    } as unknown as BoardPayload["cellValues"][number]);
    return p;
  }

  // Notes is the appended last column → index 5 in [Group, Name, Status, Count,
  // Progress, Notes].
  it.each([
    '=HYPERLINK("http://evil.example","click")',
    "+cmd",
    "-2+3",
    "@SUM(A1)",
    "\ttabbed",
  ])(
    "prefixes a dangerous text cell (%j) with a single quote in CSV",
    async (danger) => {
      const { buffer } = await buildExportWorkbook(withNotes(danger), "csv");
      const parsed = await parseWorkbook(buffer, "export.csv");
      expect(parsed.rows[0][5]).toBe(`'${danger}`);
    },
  );

  it("does NOT quote a legitimate negative number in a NUMERIC column", async () => {
    const p = makePayload();
    const cell = p.cellValues.find(
      (c) => c.column_id === "col-numbers" && c.item_id === "item-1",
    )!;
    (cell as { value: unknown }).value = { n: -42 };
    const { buffer } = await buildExportWorkbook(p, "csv");
    const parsed = await parseWorkbook(buffer, "export.csv");
    // Count column is index 3 — a plain numeric string, no leading quote.
    expect(parsed.rows[0][3]).toBe("-42");
  });

  it("does NOT prefix in the xlsx path (cells are typed text, not evaluated)", async () => {
    const danger = '=HYPERLINK("http://evil.example")';
    const { buffer } = await buildExportWorkbook(withNotes(danger), "xlsx");
    const parsed = await parseWorkbook(buffer, "export.xlsx");
    expect(parsed.rows[0][5]).toBe(danger);
  });

  // Fix: exporting a Markdown text cell to CSV and re-importing it must
  // recover the original value, not accumulate a leading quote on every
  // round trip. The guard (correctly) fires on "- ship billing" — a
  // legitimate Markdown bullet — so textToCell must undo exactly that quote.
  it.each(["- ship billing", "=SUM(A1)", "+cmd", "@mention"])(
    "round-trips %j through CSV export → parse → textToCell unharmed",
    async (original) => {
      const { buffer } = await buildExportWorkbook(withNotes(original), "csv");
      const parsed = await parseWorkbook(buffer, "export.csv");
      const guarded = parsed.rows[0][5];
      expect(guarded).toBe(`'${original}`); // guard fired, as expected
      expect(textToCell("text", guarded, [])).toEqual({ text: original });
    },
  );

  it("a genuine leading apostrophe is not touched by export OR re-import", async () => {
    const original = "'twas the night before launch";
    const { buffer } = await buildExportWorkbook(withNotes(original), "csv");
    const parsed = await parseWorkbook(buffer, "export.csv");
    // The guard only fires on =+-@/tab/CR, not on an apostrophe, so this
    // cell is never quoted in the first place.
    expect(parsed.rows[0][5]).toBe(original);
    expect(textToCell("text", parsed.rows[0][5], [])).toEqual({
      text: original,
    });
  });
});

describe("buildExportWorkbook — people column", () => {
  function makePeoplePayload(): BoardPayload {
    const p = makePayload();
    p.columns.push({
      id: "col-people",
      name: "Owner",
      kind: "people",
      board_id: "board-1",
      org_id: "org-1",
      position: 3,
      settings: {},
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      width: null,
    } as unknown as BoardPayload["columns"][number]);
    p.cellValues.push({
      board_id: "board-1",
      column_id: "col-people",
      item_id: "item-1",
      org_id: "org-1",
      value: { userIds: ["u1", "u2"] },
      updated_at: "2024-01-01T00:00:00Z",
    } as unknown as BoardPayload["cellValues"][number]);
    return p;
  }

  it("exports resolved assignee names when a name map is provided", async () => {
    const payload = makePeoplePayload();
    const names = new Map([
      ["u1", "Ada Lovelace"],
      ["u2", "Alan Turing"],
    ]);
    const { buffer } = await buildExportWorkbook(payload, "csv", names);
    const parsed = await parseWorkbook(buffer, "export.csv");
    // Owner is the 5th column: [Group, Name, Status, Count, Owner]
    expect(parsed.header).toContain("Owner");
    const ownerIdx = parsed.header.indexOf("Owner");
    expect(parsed.rows[0][ownerIdx]).toBe("Ada Lovelace, Alan Turing");
  });

  it("exports blank for people columns when no name map is provided", async () => {
    const payload = makePeoplePayload();
    const { buffer } = await buildExportWorkbook(payload, "csv");
    const parsed = await parseWorkbook(buffer, "export.csv");
    const ownerIdx = parsed.header.indexOf("Owner");
    expect(parsed.rows[0][ownerIdx] ?? "").toBe("");
  });
});

describe("buildExportWorkbook — XLSX export", () => {
  it("emits correct mime and ext for xlsx", async () => {
    const payload = makePayload();
    const { mime, ext } = await buildExportWorkbook(payload, "xlsx");
    expect(mime).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(ext).toBe("xlsx");
  });

  it("produces a non-empty buffer for xlsx", async () => {
    const payload = makePayload();
    const { buffer } = await buildExportWorkbook(payload, "xlsx");
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("round-trips group, item, and subitem names from xlsx through parseWorkbook", async () => {
    const payload = makePayload();
    const { buffer } = await buildExportWorkbook(payload, "xlsx");
    const parsed = await parseWorkbook(buffer, "export.xlsx");

    expect(parsed.header).toEqual([
      GROUP_HEADER,
      NAME_HEADER,
      "Status",
      "Count",
      "Progress",
    ]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0][1]).toBe("Build login");
    expect(parsed.rows[1][1]).toBe(SUBTASK_MARKER + "Design form");
  });

  it("sanitizes worksheet name (removes forbidden chars, truncates to 31)", async () => {
    const payload = makePayload();
    // Modify board name to contain forbidden chars
    payload.board.name = "My [Test] Board: Special/Chars?*";
    const { buffer } = await buildExportWorkbook(payload, "xlsx");
    // Should not throw; buffer should be valid xlsx
    const parsed = await parseWorkbook(buffer, "export.xlsx");
    expect(parsed.header[0]).toBe(GROUP_HEADER);
  });
});

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

    // Detection must be IDENTICAL to the unstyled path: the csv export of the
    // same board carries no formatting, so any drift here would mean styling
    // leaked into what the import detector sees.
    const { buffer: csvBuffer } = await buildExportWorkbook(
      makePayload(),
      "csv",
    );
    const csvSheet = await parseWorkbook(csvBuffer, "board.csv");
    const detectedXlsx = detectColumns(sheet.header, sheet.rows).map((c) => ({
      header: c.header,
      kind: c.kind,
    }));
    const detectedCsv = detectColumns(csvSheet.header, csvSheet.rows).map(
      (c) => ({ header: c.header, kind: c.kind }),
    );
    expect(detectedXlsx).toEqual(detectedCsv);
    expect(sheet.rows).toEqual(csvSheet.rows);
  });

  it("csv output carries no styling and still parses", async () => {
    const { buffer, ext } = await buildExportWorkbook(makePayload(), "csv");
    expect(ext).toBe("csv");
    const sheet = await parseWorkbook(buffer, "board.csv");
    expect(sheet.rows[0][4]).toBe("60");
  });
});

describe("currency column export", () => {
  function payloadWithCurrency(): BoardPayload {
    const p = makePayload();
    p.columns = [
      ...p.columns,
      {
        id: "col-currency",
        name: "Budget",
        kind: "currency",
        board_id: "board-1",
        org_id: "org-1",
        position: 3,
        settings: { currency: "AED" },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        width: null,
      },
    ];
    p.cellValues = [
      ...p.cellValues,
      {
        id: "cv-currency",
        item_id: "item-1",
        column_id: "col-currency",
        board_id: "board-1",
        org_id: "org-1",
        value: { amount: 1234.5 },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ] as BoardPayload["cellValues"];
    return p;
  }

  it('exports a real number with the "AED 1,234.50"-style numFmt (ISO code, never U+20C3)', async () => {
    const { buffer } = await buildExportWorkbook(payloadWithCurrency(), "xlsx");
    const wb = new (await import("exceljs")).default.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    // Currency col = Group + Name + (status, numbers, percent, currency) → col 6.
    const cell = ws.getRow(2).getCell(6);
    expect(cell.value).toBe(1234.5);
    expect(cell.numFmt).toBe('"AED" #,##0.00');
    expect(cell.numFmt).not.toContain("⃃");
  });

  it("csv export keeps the raw re-importable amount", async () => {
    const { buffer } = await buildExportWorkbook(payloadWithCurrency(), "csv");
    const sheet = await parseWorkbook(buffer, "board.csv");
    expect(sheet.rows[0][5]).toBe("1234.5");
  });
});
