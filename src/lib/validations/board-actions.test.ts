import { describe, expect, it } from "vitest";
import {
  createBoardSchema,
  createGroupSchema,
  createItemSchema,
  deleteBoardSchema,
  renameBoardSchema,
  renameItemSchema,
} from "./board-actions";

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
});
