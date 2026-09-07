import { describe, expect, it } from "vitest";
import { manageBoardDescriptor } from "./manage-board";
import { capabilityFor, scopeFor } from "./descriptor";

describe("manage_board classification", () => {
  it("charges structure for builds and destroy for archive", () => {
    expect(capabilityFor(manageBoardDescriptor, { action: "create" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageBoardDescriptor, { action: "rename" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageBoardDescriptor, { action: "restore" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageBoardDescriptor, { action: "archive" })).toBe(
      "board.destroy",
    );
  });

  it("addresses no board on create and the board itself otherwise", () => {
    expect(scopeFor(manageBoardDescriptor, { action: "create" })).toBe("none");
    expect(scopeFor(manageBoardDescriptor, { action: "archive" })).toBe(
      "boardId",
    );
  });

  it("declares create as an unscoped create", () => {
    expect(manageBoardDescriptor.unscopedCreateActions).toEqual(["create"]);
  });

  it("exposes no delete or purge action", async () => {
    const r = await manageBoardDescriptor.invoke(
      {
        getClient: async () => {
          throw new Error("unreachable");
        },
        actorId: "u1",
      },
      { action: "delete", boardId: "00000000-0000-0000-0000-000000000001" },
    );
    expect(r.isError).toBe(true);
  });
});
