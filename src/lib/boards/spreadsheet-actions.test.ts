import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";

// ─── Hoisted mocks (must be defined before vi.mock factories) ─────────────────
const { rpcMock, fromMockMap, getFromChain, makeChain } = vi.hoisted(() => {
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

  it("happy path: returns ImportPreview with columns and sampleRows from xlsx", async () => {
    const buf = await xlsxBuf([
      ["Name", "Status", "Count"],
      ["Item A", "Done", "1"],
      ["Item B", "Working", "2"],
      ["Item C", "Done", "3"],
      ["Item D", "Stuck", "4"],
      ["Item E", "Done", "5"],
      ["Item F", "Working", "6"],
    ]);
    const b64 = buf.toString("base64");

    const result = await previewImport({
      fileBase64: b64,
      fileName: "myboard.xlsx",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.boardName).toBe("myboard");
    expect(result.data.rowCount).toBe(6);
    expect(result.data.sampleRows).toHaveLength(5);
    const headers = result.data.columns.map((c) => c.header);
    expect(headers).toContain("Status");
    expect(headers).toContain("Count");
  });

  it("rejects when column count exceeds MAX_COLS", async () => {
    // 42 columns > MAX_COLS (40)
    const tooManyColsRow = Array.from({ length: 42 }, (_, i) => `Col${i}`);
    const dataRow = Array.from({ length: 42 }, (_, i) => `Val${i}`);
    const buf = await xlsxBuf([tooManyColsRow, dataRow]);
    const b64 = buf.toString("base64");

    const result = await previewImport({
      fileBase64: b64,
      fileName: "test.xlsx",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/column|too many/i);
  });
});

describe("commitImport", () => {
  const validMappings = [
    {
      header: "Status",
      kind: "status" as const,
      options: [
        { id: "opt1", label: "Done", color: "#00c875" },
        { id: "opt2", label: "Working", color: "#fdab3d" },
      ],
    },
  ];

  async function makeValidInput() {
    const buf = await xlsxBuf([
      ["Group", "Name", "Status"],
      ["Backlog", "Task 1", "Done"],
      ["Backlog", "Task 2", "Working"],
    ]);
    return {
      fileBase64: buf.toString("base64"),
      fileName: "import.xlsx",
      workspaceId: BOARD_UUID,
      boardName: "My Imported Board",
      columnMappings: validMappings,
    };
  }

  beforeEach(() => {
    resetMocks();
  });

  it("happy path: calls rpc with p_template and returns boardId", async () => {
    const input = await makeValidInput();

    const result = await commitImport(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.boardId).toBe("b1");

    expect(rpcMock).toHaveBeenCalledOnce();
    const rpcArgs = rpcMock.mock.calls[0][1] as {
      p_workspace_id: string;
      p_name: string;
      p_template: unknown;
    };
    expect(rpcArgs.p_workspace_id).toBe(BOARD_UUID);
    expect(rpcArgs.p_name).toBe("My Imported Board");

    const template = rpcArgs.p_template as {
      groups: unknown[];
      columns: unknown[];
      items: unknown[];
    };
    expect(Array.isArray(template.groups)).toBe(true);
    expect(template.groups.length).toBeGreaterThan(0);
    expect(Array.isArray(template.columns)).toBe(true);
    expect(template.columns.length).toBe(1);
    expect(Array.isArray(template.items)).toBe(true);
    expect(template.items.length).toBe(2);
  });

  it("returns fail when rpc errors", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "rpc failed" },
    });

    const input = await makeValidInput();
    const result = await commitImport(input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/rpc failed|could not create/i);
  });

  it("with subitems: inserts items and cell_values", async () => {
    const buf = await xlsxBuf([
      ["Group", "Name", "Status"],
      ["Backlog", "Task 1", "Done"],
      ["Backlog", "↳ Sub 1", "Working"],
    ]);
    const input = {
      fileBase64: buf.toString("base64"),
      fileName: "import.xlsx",
      workspaceId: BOARD_UUID,
      boardName: "Board With Subitems",
      columnMappings: validMappings,
    };

    const itemsChain = makeChain();
    itemsChain.insert.mockResolvedValue({ data: null, error: null });
    fromMockMap.set("items", itemsChain);

    const cellsChain = makeChain();
    cellsChain.insert.mockResolvedValue({ data: null, error: null });
    fromMockMap.set("cell_values", cellsChain);

    const result = await commitImport(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.boardId).toBe("b1");

    expect(itemsChain.insert).toHaveBeenCalled();
    const insertedItems = itemsChain.insert.mock.calls[0][0] as Array<{
      parent_id: string | null;
    }>;
    expect(insertedItems.some((row) => row.parent_id !== null)).toBe(true);
  });

  it("deletes board and returns fail when phase-2 items insert errors", async () => {
    const buf = await xlsxBuf([
      ["Group", "Name", "Status"],
      ["Backlog", "Task 1", "Done"],
      ["Backlog", "↳ Sub 1", "Working"],
    ]);
    const input = {
      fileBase64: buf.toString("base64"),
      fileName: "import.xlsx",
      workspaceId: BOARD_UUID,
      boardName: "Board With Subitems",
      columnMappings: validMappings,
    };

    // items insert fails
    const itemsChain = makeChain();
    itemsChain.insert.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    fromMockMap.set("items", itemsChain);

    // boards delete chain — must return a chainable object for .delete().eq()
    const boardsChain = makeChain();
    boardsChain.delete.mockReturnValue(boardsChain);
    boardsChain.eq.mockResolvedValue({ data: null, error: null });
    fromMockMap.set("boards", boardsChain);

    const result = await commitImport(input);

    expect(result.ok).toBe(false);

    // Assert the rollback delete was called on boards with the board id
    expect(boardsChain.delete).toHaveBeenCalled();
    expect(boardsChain.eq).toHaveBeenCalledWith("id", "b1");
  });

  it("deletes board and returns fail when phase-2 cell_values insert errors", async () => {
    const buf = await xlsxBuf([
      ["Group", "Name", "Status"],
      ["Backlog", "Task 1", "Done"],
      ["Backlog", "↳ Sub 1", "Working"],
    ]);
    const input = {
      fileBase64: buf.toString("base64"),
      fileName: "import.xlsx",
      workspaceId: BOARD_UUID,
      boardName: "Board With Subitems",
      columnMappings: validMappings,
    };

    // items insert succeeds
    const itemsChain = makeChain();
    itemsChain.insert.mockResolvedValue({ data: null, error: null });
    fromMockMap.set("items", itemsChain);

    // cell_values insert fails
    const cellsChain = makeChain();
    cellsChain.insert.mockResolvedValue({
      data: null,
      error: { message: "cells boom" },
    });
    fromMockMap.set("cell_values", cellsChain);

    // boards delete chain — must return a chainable object for .delete().eq()
    const boardsChain = makeChain();
    boardsChain.delete.mockReturnValue(boardsChain);
    boardsChain.eq.mockResolvedValue({ data: null, error: null });
    fromMockMap.set("boards", boardsChain);

    const result = await commitImport(input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cells boom/i);

    // Assert the rollback delete was called on boards with the board id
    expect(boardsChain.delete).toHaveBeenCalled();
    expect(boardsChain.eq).toHaveBeenCalledWith("id", "b1");
  });

  it("returns fail on Zod validation error (empty columnMappings)", async () => {
    const buf = await xlsxBuf([["Name"], ["A"]]);
    const result = await commitImport({
      fileBase64: buf.toString("base64"),
      fileName: "import.xlsx",
      workspaceId: BOARD_UUID,
      boardName: "Board",
      columnMappings: [], // invalid: min 1
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
  });
});
