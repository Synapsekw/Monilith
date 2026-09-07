import { describe, expect, it } from "vitest";
import { manageGroupDescriptor } from "./manage-group";
import { capabilityFor, scopeFor } from "./descriptor";

describe("manage_group classification", () => {
  it("charges structure for build/reorder/recolor/restore and destroy for archive", () => {
    expect(capabilityFor(manageGroupDescriptor, { action: "create" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageGroupDescriptor, { action: "rename" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageGroupDescriptor, { action: "reorder" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageGroupDescriptor, { action: "recolor" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageGroupDescriptor, { action: "restore" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageGroupDescriptor, { action: "archive" })).toBe(
      "board.destroy",
    );
  });

  it("addresses the group for every action, including create (which takes a boardId)", () => {
    expect(scopeFor(manageGroupDescriptor, { action: "create" })).toBe(
      "boardId",
    );
    expect(scopeFor(manageGroupDescriptor, { action: "rename" })).toBe(
      "groupId",
    );
    expect(scopeFor(manageGroupDescriptor, { action: "reorder" })).toBe(
      "groupId",
    );
    expect(scopeFor(manageGroupDescriptor, { action: "recolor" })).toBe(
      "groupId",
    );
    expect(scopeFor(manageGroupDescriptor, { action: "archive" })).toBe(
      "groupId",
    );
    expect(scopeFor(manageGroupDescriptor, { action: "restore" })).toBe(
      "groupId",
    );
  });

  it("declares no unscoped create — create is ordinary boardId-scoped", () => {
    expect(manageGroupDescriptor.unscopedCreateActions).toBeUndefined();
  });

  it("exposes no delete action", async () => {
    const r = await manageGroupDescriptor.invoke(
      {
        getClient: async () => {
          throw new Error("unreachable");
        },
        actorId: "u1",
      },
      { action: "delete", groupId: "00000000-0000-0000-0000-000000000001" },
    );
    expect(r.isError).toBe(true);
  });

  it("rejects a batch of more than 50 groups before ever touching the client", async () => {
    const groups = Array.from({ length: 51 }, (_, i) => ({ name: `G${i}` }));
    const r = await manageGroupDescriptor.invoke(
      {
        getClient: async () => {
          throw new Error("unreachable");
        },
        actorId: "u1",
      },
      {
        action: "create",
        boardId: "00000000-0000-0000-0000-000000000001",
        groups,
      },
    );
    expect(r.isError).toBe(true);
  });
});
