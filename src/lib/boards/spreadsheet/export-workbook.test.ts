import { describe, it, expect } from "vitest";
import { buildExportWorkbook } from "./export-workbook";
import { parseWorkbook } from "./parse-workbook";
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

    // Header should be [Group, Name, Status, Count]
    expect(parsed.header).toEqual([
      GROUP_HEADER,
      NAME_HEADER,
      "Status",
      "Count",
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

describe("buildExportWorkbook — people column", () => {
  function makePeoplePayload(): BoardPayload {
    const p = makePayload();
    p.columns.push({
      id: "col-people",
      name: "Owner",
      kind: "people",
      board_id: "board-1",
      org_id: "org-1",
      position: 2,
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
