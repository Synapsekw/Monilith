import { describe, expect, it } from "vitest";
import {
  createBoardSchema,
  createGroupSchema,
  createItemSchema,
  deleteBoardSchema,
  deleteGroupSchema,
  renameBoardSchema,
  renameGroupSchema,
  renameItemSchema,
  reorderBoardSchema,
  reorderGroupSchema,
  resizeNameColumnSchema,
  updateGroupColorSchema,
  addSubitemSchema,
  deleteItemSchema,
  reorderItemSchema,
  reorderColumnSchema,
  updateColumnSettingsSchema,
  removeColumnOptionSchema,
} from "./board-actions";
import { upsertCellSchema, clearCellSchema } from "./board-actions";

// Zod 4 enforces strict RFC 4122 UUID format (version + variant bits).
// "11111111-1111-1111-1111-111111111111" fails because the variant nibble
// must be [89abAB]. Use a valid UUIDv4-shaped string instead.
const uuid = "11111111-1111-4111-8111-111111111111";

describe("board action schemas", () => {
  it("createBoard requires a workspaceId uuid and a 1..100 name", () => {
    expect(
      createBoardSchema.safeParse({ workspaceId: uuid, name: "My Board" })
        .success,
    ).toBe(true);
    expect(
      createBoardSchema.safeParse({ workspaceId: "nope", name: "X" }).success,
    ).toBe(false);
    expect(
      createBoardSchema.safeParse({ workspaceId: uuid, name: "" }).success,
    ).toBe(false);
    expect(
      createBoardSchema.safeParse({ workspaceId: uuid, name: "a".repeat(101) })
        .success,
    ).toBe(false);
  });

  it("createBoard trims the name", () => {
    const r = createBoardSchema.safeParse({
      workspaceId: uuid,
      name: "  Hi  ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Hi");
  });

  it("renameBoard requires a boardId and a name", () => {
    expect(
      renameBoardSchema.safeParse({ boardId: uuid, name: "New" }).success,
    ).toBe(true);
    expect(
      renameBoardSchema.safeParse({ boardId: uuid, name: "" }).success,
    ).toBe(false);
  });

  it("deleteBoard requires a boardId uuid", () => {
    expect(deleteBoardSchema.safeParse({ boardId: uuid }).success).toBe(true);
    expect(deleteBoardSchema.safeParse({ boardId: "x" }).success).toBe(false);
  });

  it("createGroup requires a boardId and a name", () => {
    expect(
      createGroupSchema.safeParse({ boardId: uuid, name: "Group 2" }).success,
    ).toBe(true);
  });

  it("renameGroup requires a groupId and a name", () => {
    expect(
      renameGroupSchema.safeParse({ groupId: uuid, name: "Renamed" }).success,
    ).toBe(true);
    expect(
      renameGroupSchema.safeParse({ groupId: uuid, name: "" }).success,
    ).toBe(false);
  });

  it("createItem requires a groupId and a name", () => {
    expect(
      createItemSchema.safeParse({ groupId: uuid, name: "Task" }).success,
    ).toBe(true);
  });

  it("renameItem requires an itemId and a name", () => {
    expect(
      renameItemSchema.safeParse({ itemId: uuid, name: "Renamed" }).success,
    ).toBe(true);
  });

  it("resizeNameColumn accepts an in-range width and null (auto-fit)", () => {
    expect(
      resizeNameColumnSchema.safeParse({ boardId: uuid, width: 300 }).success,
    ).toBe(true);
    expect(
      resizeNameColumnSchema.safeParse({ boardId: uuid, width: null }).success,
    ).toBe(true);
  });

  it("resizeNameColumn rejects out-of-range and non-int widths", () => {
    expect(
      resizeNameColumnSchema.safeParse({ boardId: uuid, width: 5000 }).success,
    ).toBe(false);
    expect(
      resizeNameColumnSchema.safeParse({ boardId: uuid, width: 12.5 }).success,
    ).toBe(false);
  });
});

describe("cell action schemas", () => {
  // Zod 4 enforces strict RFC 4122 UUID format — variant nibble must be [89abAB].
  const itemId = "11111111-1111-4111-8111-111111111111";
  const columnId = "22222222-2222-4222-8222-222222222222";

  it("upsertCell requires itemId + columnId uuids and a value", () => {
    expect(
      upsertCellSchema.safeParse({ itemId, columnId, value: { text: "hi" } })
        .success,
    ).toBe(true);
  });

  it("upsertCell rejects a non-uuid itemId", () => {
    expect(
      upsertCellSchema.safeParse({
        itemId: "nope",
        columnId,
        value: { text: "hi" },
      }).success,
    ).toBe(false);
  });

  it("upsertCell accepts any json-shaped value (kind-validated later)", () => {
    expect(
      upsertCellSchema.safeParse({ itemId, columnId, value: { n: 42 } })
        .success,
    ).toBe(true);
    expect(
      upsertCellSchema.safeParse({
        itemId,
        columnId,
        value: { optionId: null },
      }).success,
    ).toBe(true);
  });

  it("upsertCell rejects a missing value", () => {
    expect(upsertCellSchema.safeParse({ itemId, columnId }).success).toBe(
      false,
    );
  });

  it("clearCell requires itemId + columnId uuids", () => {
    expect(clearCellSchema.safeParse({ itemId, columnId }).success).toBe(true);
    expect(clearCellSchema.safeParse({ itemId: "x", columnId }).success).toBe(
      false,
    );
  });
});

describe("group management schemas", () => {
  const groupId = "11111111-1111-4111-8111-111111111111";

  it("deleteGroup requires a uuid groupId", () => {
    expect(deleteGroupSchema.safeParse({ groupId }).success).toBe(true);
    expect(deleteGroupSchema.safeParse({}).success).toBe(false);
  });

  it("reorderBoard requires a uuid boardId and a finite position", () => {
    expect(
      reorderBoardSchema.safeParse({ boardId: groupId, position: 1.5 }).success,
    ).toBe(true);
    expect(
      reorderBoardSchema.safeParse({ boardId: "x", position: 1 }).success,
    ).toBe(false);
    expect(
      reorderBoardSchema.safeParse({ boardId: groupId, position: "x" }).success,
    ).toBe(false);
    expect(
      reorderBoardSchema.safeParse({ boardId: groupId, position: Infinity })
        .success,
    ).toBe(false);
  });

  it("reorderGroup requires a numeric position", () => {
    expect(
      reorderGroupSchema.safeParse({ groupId, position: 1.5 }).success,
    ).toBe(true);
    expect(
      reorderGroupSchema.safeParse({ groupId, position: "x" }).success,
    ).toBe(false);
  });

  it("updateGroupColor requires a 6-digit hex color", () => {
    expect(
      updateGroupColorSchema.safeParse({ groupId, color: "#00c875" }).success,
    ).toBe(true);
    expect(
      updateGroupColorSchema.safeParse({ groupId, color: "red" }).success,
    ).toBe(false);
    expect(
      updateGroupColorSchema.safeParse({ groupId, color: "#fff" }).success,
    ).toBe(false);
  });
});

// Zod 4 enforces strict RFC 4122 UUID format — variant nibble must be [89abAB].
const UUID = "11111111-1111-4111-8111-111111111111";

describe("addSubitemSchema", () => {
  it("accepts a valid parentId + name", () => {
    expect(
      addSubitemSchema.safeParse({ parentId: UUID, name: "Sub" }).success,
    ).toBe(true);
  });
  it("rejects an empty name", () => {
    expect(
      addSubitemSchema.safeParse({ parentId: UUID, name: "  " }).success,
    ).toBe(false);
  });
  it("rejects a non-uuid parentId", () => {
    expect(
      addSubitemSchema.safeParse({ parentId: "x", name: "Sub" }).success,
    ).toBe(false);
  });
});

describe("deleteItemSchema", () => {
  it("accepts a uuid", () => {
    expect(deleteItemSchema.safeParse({ itemId: UUID }).success).toBe(true);
  });
});

describe("reorderItemSchema", () => {
  it("accepts a numeric position", () => {
    expect(
      reorderItemSchema.safeParse({ itemId: UUID, position: 2.5 }).success,
    ).toBe(true);
  });
});

describe("reorderColumnSchema", () => {
  it("accepts a fractional position", () => {
    expect(
      reorderColumnSchema.safeParse({ columnId: UUID, position: 2.5 }).success,
    ).toBe(true);
  });

  it("rejects a non-numeric position and a non-uuid id", () => {
    expect(
      reorderColumnSchema.safeParse({ columnId: UUID, position: "x" }).success,
    ).toBe(false);
    expect(
      reorderColumnSchema.safeParse({ columnId: "nope", position: 1 }).success,
    ).toBe(false);
  });
});

describe("column settings + option schemas", () => {
  it("updateColumnSettings accepts a columnId uuid + structural settings", () => {
    expect(
      updateColumnSettingsSchema.safeParse({
        columnId: UUID,
        settings: { options: [] },
      }).success,
    ).toBe(true);
  });

  it("updateColumnSettings rejects a non-uuid columnId", () => {
    expect(
      updateColumnSettingsSchema.safeParse({
        columnId: "x",
        settings: {},
      }).success,
    ).toBe(false);
  });

  it("removeColumnOption accepts a columnId + non-empty optionId", () => {
    expect(
      removeColumnOptionSchema.safeParse({ columnId: UUID, optionId: "abc" })
        .success,
    ).toBe(true);
  });

  it("removeColumnOption rejects an empty optionId", () => {
    expect(
      removeColumnOptionSchema.safeParse({ columnId: UUID, optionId: "" })
        .success,
    ).toBe(false);
  });
});
