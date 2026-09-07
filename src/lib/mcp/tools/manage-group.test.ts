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

// F1 (final whole-branch review): `createGroupsCore` returns `{ ok: true }`
// even when EVERY entry in the batch failed — `toToolResult` only inspects
// `ActionResult.ok`, so that shape alone would report a total failure to the
// model as an ordinary success. `manage-group.ts`'s `create` branch adds the
// `isError` check on top; these tests exercise it through the real descriptor
// `invoke`, matching `create_item`'s semantics exactly (see create-item.ts).
// A version-4-shaped UUID: zod's bare `.uuid()` only special-cases the
// all-zeros/all-f's sentinels, so an arbitrary literal like
// "…-000000000001" fails validation and the batch never reaches the core.
const BOARD_ID = "11111111-1111-4111-8111-111111111111";

function fakeGroupCreateInsertClient(
  opts: { failAt?: number[]; failAll?: boolean } = {},
) {
  let insertCount = 0;
  return {
    from(_table: string) {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            maybeSingle: async () => ({ data: { org_id: "o1" }, error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => {
              const index = insertCount++;
              if (opts.failAll || opts.failAt?.includes(index)) {
                return {
                  data: null,
                  error: { message: `entry ${index} failed` },
                };
              }
              return {
                data: { id: `g${index}`, name: `G${index}` },
                error: null,
              };
            },
          }),
        }),
      };
    },
  } as never;
}

describe("manage_group create: batch isError semantics (F1)", () => {
  it("sets isError when every entry in the batch fails", async () => {
    const client = fakeGroupCreateInsertClient({ failAll: true });
    const r = await manageGroupDescriptor.invoke(
      { getClient: async () => client, actorId: "u1" },
      {
        action: "create",
        boardId: BOARD_ID,
        groups: [{ name: "A" }, { name: "B" }],
      },
    );
    expect(r.isError).toBe(true);
  });

  it("leaves isError undefined when only some entries fail", async () => {
    const client = fakeGroupCreateInsertClient({ failAt: [0] });
    const r = await manageGroupDescriptor.invoke(
      { getClient: async () => client, actorId: "u1" },
      {
        action: "create",
        boardId: BOARD_ID,
        groups: [{ name: "A" }, { name: "B" }],
      },
    );
    expect(r.isError).toBeUndefined();
  });

  it("leaves isError undefined when every entry succeeds", async () => {
    const client = fakeGroupCreateInsertClient({});
    const r = await manageGroupDescriptor.invoke(
      { getClient: async () => client, actorId: "u1" },
      {
        action: "create",
        boardId: BOARD_ID,
        groups: [{ name: "A" }],
      },
    );
    expect(r.isError).toBeUndefined();
  });
});
