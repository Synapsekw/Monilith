import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";

// ─── Hoisted mocks (must be defined before vi.mock factories) ─────────────────
const { rpcMock, fromMockMap, getFromChain } = vi.hoisted(() => {
  type ChainableMock = {
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };

  function makeChain(overrides: Partial<ChainableMock> = {}): ChainableMock {
    const chain: ChainableMock = {
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      delete: vi.fn(),
      eq: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      ...overrides,
    };
    chain.delete.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    // Allow delete(...).eq(...) to also resolve when awaited
    chain.eq.mockResolvedValue({ data: null, error: null });
    return chain;
  }

  const fromMockMap = new Map<string, ChainableMock>();

  function getFromChain(table: string): ChainableMock {
    if (!fromMockMap.has(table)) {
      fromMockMap.set(table, makeChain());
    }
    return fromMockMap.get(table)!;
  }

  const rpcMock = vi.fn().mockResolvedValue({
    data: { id: "b1", org_id: "o1" },
    error: null,
  });

  return { rpcMock, fromMockMap, getFromChain, makeChain };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: rpcMock,
    from: vi.fn((table: string) => getFromChain(table)),
  }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import {
  exportBoard,
  previewImport,
  commitImport,
} from "./spreadsheet-actions";
import { getBoardPayload } from "@/lib/boards/queries";
import { MAX_BYTES } from "@/lib/boards/spreadsheet/types";

// Valid RFC-4122 v4 UUID for Zod strict uuid validation
const BOARD_UUID = "a1234567-e89b-42d3-a456-556642440000";

const getBoardPayloadMock = getBoardPayload as ReturnType<typeof vi.fn>;

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function xlsxBuf(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function makeBoardPayload(boardName: string) {
  return {
    board: {
      id: "board-1",
      name: boardName,
      org_id: "org-1",
      workspace_id: "ws-1",
      created_by: "user-1",
      position: 0,
      name_column_width: null,
    },
    groups: [
      {
        id: "g1",
        name: "Group 1",
        board_id: "board-1",
        org_id: "org-1",
        position: 0,
        color: "#0073ea",
      },
    ],
    columns: [
      {
        id: "c1",
        name: "Status",
        kind: "status",
        board_id: "board-1",
        org_id: "org-1",
        position: 0,
        width: null,
        settings: { options: [{ id: "o1", label: "Done", color: "#00c875" }] },
      },
    ],
    items: [
      {
        id: "i1",
        name: "Item 1",
        board_id: "board-1",
        group_id: "g1",
        org_id: "org-1",
        parent_id: null,
        position: 0,
      },
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: "c1",
        value: { optionId: "o1" },
        board_id: "board-1",
        org_id: "org-1",
      },
    ],
    views: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  };
}

// ─── Shared beforeEach helper ─────────────────────────────────────────────────
// vi.clearAllMocks() resets call counts AND implementations. We need to:
// 1. Reset call counts (clearAllMocks)
// 2. Restore the createClient and rpcMock resolved values after clear
import { createClient } from "@/lib/supabase/server";

const createClientMock = createClient as ReturnType<typeof vi.fn>;

function resetMocks() {
  vi.clearAllMocks();
  fromMockMap.clear();
  rpcMock.mockResolvedValue({ data: { id: "b1", org_id: "o1" }, error: null });
  createClientMock.mockResolvedValue({
    rpc: rpcMock,
    from: vi.fn((table: string) => getFromChain(table)),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("exportBoard", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("returns base64 + correct mime and fileName for xlsx", async () => {
    getBoardPayloadMock.mockResolvedValue(makeBoardPayload("My Board"));

    const result = await exportBoard({
      boardId: BOARD_UUID,
      format: "xlsx",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.mime).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(result.data.fileName).toBe("My Board.xlsx");
    expect(typeof result.data.base64).toBe("string");
    expect(result.data.base64.length).toBeGreaterThan(0);
    const buf = Buffer.from(result.data.base64, "base64");
    expect(buf.length).toBeGreaterThan(0);
  });

  it("returns csv mime and ext for csv format", async () => {
    getBoardPayloadMock.mockResolvedValue(makeBoardPayload("My Board"));

    const result = await exportBoard({
      boardId: BOARD_UUID,
      format: "csv",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mime).toBe("text/csv");
    expect(result.data.fileName).toBe("My Board.csv");
  });

  it("returns fail when board not found", async () => {
    getBoardPayloadMock.mockResolvedValue(null);

    const result = await exportBoard({
      boardId: BOARD_UUID,
      format: "xlsx",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/i);
  });

  it("sanitizes board name in fileName (removes forbidden chars)", async () => {
    getBoardPayloadMock.mockResolvedValue(makeBoardPayload("My/Board:Name"));

    const result = await exportBoard({
      boardId: BOARD_UUID,
      format: "csv",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fileName).not.toContain("/");
    expect(result.data.fileName).not.toContain(":");
  });
});

describe("previewImport", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("rejects an oversize buffer with a clear error", async () => {
    const oversizeBase64 = Buffer.alloc(MAX_BYTES + 1).toString("base64");

    const result = await previewImport({
      fileBase64: oversizeBase64,
      fileName: "test.xlsx",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too large|size|bytes/i);
  });

  it("rejects files with unsupported extensions", async () => {
    const buf = await xlsxBuf([["Name"], ["A"]]);
    const b64 = buf.toString("base64");

    const result = await previewImport({
      fileBase64: b64,
      fileName: "test.pdf",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/xlsx|csv|extension|supported/i);
  });

  it("previewImport returns every sheet with truncated grids", async () => {
    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet("Sheet1");
    ws1.addRow(["Name", "Status"]);
    ws1.addRow(["Item A", "Done"]);
    const ws2 = wb.addWorksheet("Extra");
    ws2.addRow(["Col1", "Col2"]);
    ws2.addRow(["a", "b"]);
    ws2.addRow(["c", "d"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await previewImport({
      fileBase64: buf.toString("base64"),
      fileName: "myboard.xlsx",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.fileName).toBe("myboard.xlsx");
    expect(result.data.boardName).toBe("myboard");
    expect(result.data.sheets).toHaveLength(2);
    expect(result.data.sheets[1].name).toBe("Extra");
    expect(result.data.sheets[1].rowCount).toBe(3);
    expect(result.data.sheets[1].grid).toHaveLength(3);
  });

  it("previewImport fails when a sheet exceeds MAX_COLS, naming the sheet", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("WideSheet");
    const headerRow = Array.from({ length: 41 }, (_, i) => `Col${i}`);
    ws.addRow(headerRow);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await previewImport({
      fileBase64: buf.toString("base64"),
      fileName: "test.xlsx",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too many columns/i);
    expect(result.error).toContain("WideSheet");
  });
});

describe("commitImport", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("commitImport honors headerRow, excludedRows and skip specs", async () => {
    const buf = await xlsxBuf([
      ["Some Title"],
      ["Name", "Status", "Notes"],
      ["Task 1", "Done", "foo"],
      ["Task 2", "Working", "bar"],
      ["Task 3", "Stuck", "baz"],
    ]);

    const result = await commitImport({
      fileBase64: buf.toString("base64"),
      fileName: "import.xlsx",
      sheetName: "Sheet1",
      headerRow: 1,
      excludedRows: [3], // exclude "Task 2" data row
      columns: [
        {
          sourceIndex: 0,
          name: "Name",
          kind: "text",
          options: [],
          role: "name",
        },
        {
          sourceIndex: 1,
          name: "Status",
          kind: "status",
          options: [
            { id: "opt1", label: "Done", color: "#00c875" },
            { id: "opt2", label: "Working", color: "#fdab3d" },
            { id: "opt3", label: "Stuck", color: "#e2445c" },
          ],
          role: "data",
        },
        {
          sourceIndex: 2,
          name: "Notes",
          kind: "text",
          options: [],
          role: "data",
          target: "skip",
        },
      ],
      destination: {
        type: "new",
        workspaceId: BOARD_UUID,
        boardName: "Imported Board",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.boardId).toBe("b1");

    expect(rpcMock).toHaveBeenCalledOnce();
    const rpcArgs = rpcMock.mock.calls[0][1] as {
      p_workspace_id: string;
      p_name: string;
      p_template: { groups: unknown[]; columns: unknown[]; items: unknown[] };
    };
    expect(rpcArgs.p_workspace_id).toBe(BOARD_UUID);
    expect(rpcArgs.p_name).toBe("Imported Board");
    // Only the Status column is imported — Notes is skipped
    expect(rpcArgs.p_template.columns).toHaveLength(1);
    // Task 2 is excluded, leaving Task 1 and Task 3
    expect(rpcArgs.p_template.items).toHaveLength(2);
  });

  it("commitImport rejects two name-role columns", async () => {
    const buf = await xlsxBuf([
      ["Name", "Alt Name"],
      ["Task 1", "Alt 1"],
    ]);

    const result = await commitImport({
      fileBase64: buf.toString("base64"),
      fileName: "import.xlsx",
      sheetName: "Sheet1",
      headerRow: 0,
      excludedRows: [],
      columns: [
        {
          sourceIndex: 0,
          name: "Name",
          kind: "text",
          options: [],
          role: "name",
        },
        {
          sourceIndex: 1,
          name: "Alt Name",
          kind: "text",
          options: [],
          role: "name",
        },
      ],
      destination: {
        type: "new",
        workspaceId: BOARD_UUID,
        boardName: "Board",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/name/i);
  });

  it("commitImport rejects an existing destination until M2", async () => {
    const buf = await xlsxBuf([["Name"], ["Task 1"]]);

    const result = await commitImport({
      fileBase64: buf.toString("base64"),
      fileName: "import.xlsx",
      sheetName: "Sheet1",
      headerRow: 0,
      excludedRows: [],
      columns: [
        {
          sourceIndex: 0,
          name: "Name",
          kind: "text",
          options: [],
          role: "name",
        },
      ],
      destination: {
        type: "existing",
        boardId: BOARD_UUID,
        group: { newGroupName: "Backlog" },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not available yet/i);
  });

  it("commitImport enforces MAX_ROWS on the selected table", async () => {
    const rows: string[][] = [["Name"]];
    for (let i = 0; i < 2001; i++) rows.push([`Task ${i}`]);
    const buf = await xlsxBuf(rows);

    const result = await commitImport({
      fileBase64: buf.toString("base64"),
      fileName: "import.xlsx",
      sheetName: "Sheet1",
      headerRow: 0,
      excludedRows: [],
      columns: [
        {
          sourceIndex: 0,
          name: "Name",
          kind: "text",
          options: [],
          role: "name",
        },
      ],
      destination: {
        type: "new",
        workspaceId: BOARD_UUID,
        boardName: "Board",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too many rows/i);
  });
});
