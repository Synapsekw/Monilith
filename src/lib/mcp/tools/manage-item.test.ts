import { describe, expect, it } from "vitest";
import { manageItemHandler, manageItemDescriptor } from "./manage-item";
import { capabilityFor, scopeFor } from "./descriptor";

const ITEM = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";

function makeChain(result: unknown): unknown {
  const p = Promise.resolve(result) as Promise<unknown> &
    Record<string, unknown>;
  const next = () => makeChain(result);
  p.select = next;
  p.update = next;
  p.insert = next;
  p.eq = next;
  p.is = next;
  p.order = next;
  p.limit = next;
  p.maybeSingle = () => Promise.resolve(result);
  p.single = () => Promise.resolve(result);
  return p;
}

function makeFakeClient(
  opts: {
    fromResults?: unknown[];
    rpc?: { data: unknown; error: { message: string } | null };
  } = {},
) {
  let i = 0;
  let getClientCalls = 0;
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const client = {
    from: () => {
      const result = opts.fromResults?.[i++] ?? { data: null, error: null };
      return makeChain(result);
    },
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(opts.rpc ?? { data: null, error: null });
    },
  };
  return {
    getClient: () => {
      getClientCalls += 1;
      return Promise.resolve(client as never);
    },
    rpcCalls,
    getClientCalls: () => getClientCalls,
  };
}

describe("manage_item capability and scope maps", () => {
  it("declares every action's capability", () => {
    for (const action of [
      "archive",
      "restore",
      "move",
      "reorder",
      "add_subitem",
    ]) {
      expect(capabilityFor(manageItemDescriptor, { action })).not.toBeNull();
    }
    expect(capabilityFor(manageItemDescriptor, { action: "archive" })).toBe(
      "board.destroy",
    );
    expect(capabilityFor(manageItemDescriptor, { action: "restore" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageItemDescriptor, { action: "move" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageItemDescriptor, { action: "reorder" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageItemDescriptor, { action: "add_subitem" })).toBe(
      "board.structure",
    );
  });

  it("scopes every action by itemId — the id of the object it addresses", () => {
    for (const action of [
      "archive",
      "restore",
      "move",
      "reorder",
      "add_subitem",
    ]) {
      expect(scopeFor(manageItemDescriptor, { action })).toBe("itemId");
    }
  });
});

describe("manageItemHandler", () => {
  it("rejects an unrecognised action", async () => {
    const { getClient } = makeFakeClient();
    const result = await manageItemHandler(getClient, {
      action: "delete",
      itemId: ITEM,
    });
    expect(result.isError).toBe(true);
  });

  it("archives an item via the cascade RPC", async () => {
    const { getClient, rpcCalls } = makeFakeClient({
      rpc: { data: null, error: null },
    });
    const result = await manageItemHandler(getClient, {
      action: "archive",
      itemId: ITEM,
    });
    expect(result.isError).toBeUndefined();
    expect(rpcCalls).toEqual([
      { fn: "archive_item", args: { p_item_id: ITEM } },
    ]);
  });

  it("restores an item via RPC", async () => {
    const { getClient, rpcCalls } = makeFakeClient({
      rpc: { data: null, error: null },
    });
    const result = await manageItemHandler(getClient, {
      action: "restore",
      itemId: ITEM,
    });
    expect(result.isError).toBeUndefined();
    expect(rpcCalls).toEqual([
      { fn: "restore_item", args: { p_item_id: ITEM } },
    ]);
  });

  it("reorders an item", async () => {
    const { getClient } = makeFakeClient({
      fromResults: [{ data: { board_id: "board" }, error: null }],
    });
    const result = await manageItemHandler(getClient, {
      action: "reorder",
      itemId: ITEM,
      position: 5,
    });
    expect(result.isError).toBeUndefined();
  });

  it("rejects reorder without a position", async () => {
    const { getClient } = makeFakeClient();
    const result = await manageItemHandler(getClient, {
      action: "reorder",
      itemId: ITEM,
    });
    expect(result.isError).toBe(true);
  });

  it("moves an item to another group, carrying its subitems", async () => {
    const { getClient } = makeFakeClient({
      fromResults: [
        { data: { board_id: "board", parent_id: null }, error: null },
        { data: { board_id: "board" }, error: null },
        { data: { id: ITEM, group_id: GROUP }, error: null },
        { data: [], error: null },
      ],
    });
    const result = await manageItemHandler(getClient, {
      action: "move",
      itemId: ITEM,
      groupId: GROUP,
      position: 10,
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.item.id).toBe(ITEM);
  });

  it("rejects move without a groupId", async () => {
    const { getClient } = makeFakeClient();
    const result = await manageItemHandler(getClient, {
      action: "move",
      itemId: ITEM,
    });
    expect(result.isError).toBe(true);
  });

  it("adds a subitem under the itemId given as the parent", async () => {
    const { getClient } = makeFakeClient({
      fromResults: [
        {
          data: {
            org_id: "o1",
            board_id: "b1",
            group_id: GROUP,
            parent_id: null,
          },
          error: null,
        },
        { data: null, error: null },
        { data: { id: "sub-1", name: "Sub", parent_id: ITEM }, error: null },
      ],
    });
    const result = await manageItemHandler(getClient, {
      action: "add_subitem",
      itemId: ITEM,
      name: "Sub",
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.item.id).toBe("sub-1");
  });

  it("resolves the request client exactly once per call", async () => {
    const { getClient, getClientCalls } = makeFakeClient({
      rpc: { data: null, error: null },
    });
    await manageItemHandler(getClient, { action: "archive", itemId: ITEM });
    expect(getClientCalls()).toBe(1);
  });
});
