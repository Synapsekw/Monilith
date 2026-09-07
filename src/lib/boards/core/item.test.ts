import { describe, expect, it } from "vitest";
import {
  addSubitemCore,
  archiveItemCore,
  restoreItemCore,
  reorderItemCore,
  moveItemCore,
} from "./item";

const PARENT = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const SUB = "44444444-4444-4444-8444-444444444444";

/**
 * A minimal chainable Supabase stub for the item-lifecycle core. Each
 * `.from(table)` call consumes the next queued result regardless of which
 * chain methods (`select`/`update`/`insert`, `.eq`/`.is`/`.order`/`.limit`,
 * `.maybeSingle`/`.single`, or a bare `await` on `.select(...)` with no
 * terminal call — the `moveItemCore` subitem drag) follow it. This mirrors
 * `src/lib/boards/actions/cell-core.test.ts`'s stub, generalized to a queue
 * because these core functions issue several distinct `.from()` reads/writes
 * per call rather than cell-core's fixed three.
 */
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

function makeClient(opts: {
  fromResults: unknown[];
  rpc?: { data: unknown; error: { message: string } | null };
}) {
  let i = 0;
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const client = {
    from: () => {
      const result = opts.fromResults[i++] ?? { data: null, error: null };
      const chain = makeChain(result);
      return chain as {
        select: () => unknown;
        update: () => unknown;
        insert: () => unknown;
      };
    },
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(opts.rpc ?? { data: null, error: null });
    },
  };
  return { client: client as never, rpcCalls };
}

describe("addSubitemCore", () => {
  it("creates a subitem under a top-level parent, appended after the last subitem", async () => {
    const { client } = makeClient({
      fromResults: [
        {
          data: {
            org_id: "org",
            board_id: "board",
            group_id: GROUP,
            parent_id: null,
          },
          error: null,
        },
        { data: null, error: null }, // no existing subitems
        {
          data: { id: SUB, name: "Sub A", parent_id: PARENT },
          error: null,
        },
      ],
    });
    const result = await addSubitemCore(client, {
      parentId: PARENT,
      name: "Sub A",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.item.id).toBe(SUB);
  });

  it("refuses to nest a subitem under another subitem", async () => {
    const { client } = makeClient({
      fromResults: [
        {
          data: {
            org_id: "org",
            board_id: "board",
            group_id: GROUP,
            parent_id: "some-other-item",
          },
          error: null,
        },
      ],
    });
    const result = await addSubitemCore(client, {
      parentId: PARENT,
      name: "Sub A",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Subitems cannot be nested.");
  });

  it("fails when the parent item does not exist", async () => {
    const { client } = makeClient({
      fromResults: [{ data: null, error: null }],
    });
    const result = await addSubitemCore(client, {
      parentId: PARENT,
      name: "Sub A",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Parent item not found.");
  });
});

describe("archiveItemCore", () => {
  it("archives via the cascade RPC", async () => {
    const { client, rpcCalls } = makeClient({
      fromResults: [],
      rpc: { data: null, error: null },
    });
    const result = await archiveItemCore(client, { itemId: ITEM });
    expect(result.ok).toBe(true);
    expect(rpcCalls).toEqual([
      { fn: "archive_item", args: { p_item_id: ITEM } },
    ]);
  });

  it("surfaces the RPC error", async () => {
    const { client } = makeClient({
      fromResults: [],
      rpc: { data: null, error: { message: "already archived" } },
    });
    const result = await archiveItemCore(client, { itemId: ITEM });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("already archived");
  });
});

describe("restoreItemCore", () => {
  it("restores via RPC", async () => {
    const { client, rpcCalls } = makeClient({
      fromResults: [],
      rpc: { data: null, error: null },
    });
    const result = await restoreItemCore(client, { itemId: ITEM });
    expect(result.ok).toBe(true);
    expect(rpcCalls).toEqual([
      { fn: "restore_item", args: { p_item_id: ITEM } },
    ]);
  });

  it("surfaces the RPC error", async () => {
    const { client } = makeClient({
      fromResults: [],
      rpc: { data: null, error: { message: "not archived" } },
    });
    const result = await restoreItemCore(client, { itemId: ITEM });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not archived");
  });
});

describe("reorderItemCore", () => {
  it("updates the item's position", async () => {
    const { client } = makeClient({
      fromResults: [{ data: { board_id: "board" }, error: null }],
    });
    const result = await reorderItemCore(client, { itemId: ITEM, position: 5 });
    expect(result.ok).toBe(true);
  });

  it("fails when the item is not found or hidden by RLS", async () => {
    const { client } = makeClient({
      fromResults: [{ data: null, error: null }],
    });
    const result = await reorderItemCore(client, { itemId: ITEM, position: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Item not found.");
  });
});

describe("moveItemCore", () => {
  it("fails when the item is not found", async () => {
    const { client } = makeClient({
      fromResults: [{ data: null, error: null }],
    });
    const result = await moveItemCore(client, { itemId: ITEM, groupId: GROUP });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Item not found.");
  });

  it("refuses to move a subitem between groups", async () => {
    const { client } = makeClient({
      fromResults: [
        { data: { board_id: "board", parent_id: PARENT }, error: null },
      ],
    });
    const result = await moveItemCore(client, { itemId: ITEM, groupId: GROUP });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Subitems can't be moved between groups.");
  });

  it("fails when the target group does not exist", async () => {
    const { client } = makeClient({
      fromResults: [
        { data: { board_id: "board", parent_id: null }, error: null },
        { data: null, error: null },
      ],
    });
    const result = await moveItemCore(client, { itemId: ITEM, groupId: GROUP });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Group not found.");
  });

  it("refuses a group belonging to a different board", async () => {
    const { client } = makeClient({
      fromResults: [
        { data: { board_id: "board-a", parent_id: null }, error: null },
        { data: { board_id: "board-b" }, error: null },
      ],
    });
    const result = await moveItemCore(client, { itemId: ITEM, groupId: GROUP });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Group belongs to a different board.");
  });

  it("treats an RLS-hidden write (no matching row, no error) as a refusal", async () => {
    const { client } = makeClient({
      fromResults: [
        { data: { board_id: "board", parent_id: null }, error: null },
        { data: { board_id: "board" }, error: null },
        // explicit position supplied, so no "last position" read happens next
        { data: null, error: null }, // the update matches zero rows
      ],
    });
    const result = await moveItemCore(client, {
      itemId: ITEM,
      groupId: GROUP,
      position: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("You don't have permission to move this item.");
  });

  it("moves the item and drags its subitems' group_id along, using the explicit position", async () => {
    const { client } = makeClient({
      fromResults: [
        { data: { board_id: "board", parent_id: null }, error: null }, // item
        { data: { board_id: "board" }, error: null }, // group
        { data: { id: ITEM, group_id: GROUP, position: 10 }, error: null }, // moved
        { data: [{ id: SUB }], error: null }, // subitems dragged along
      ],
    });
    const result = await moveItemCore(client, {
      itemId: ITEM,
      groupId: GROUP,
      position: 10,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.item.id).toBe(ITEM);
      expect(result.data.subitemIds).toEqual([SUB]);
    }
  });

  it("appends to the end of the target group when no position is given", async () => {
    const { client } = makeClient({
      fromResults: [
        { data: { board_id: "board", parent_id: null }, error: null }, // item
        { data: { board_id: "board" }, error: null }, // group
        { data: { position: 100 }, error: null }, // last top-level item read
        { data: { id: ITEM, group_id: GROUP, position: 200 }, error: null }, // moved
        { data: [], error: null }, // no subitems to drag
      ],
    });
    const result = await moveItemCore(client, { itemId: ITEM, groupId: GROUP });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.subitemIds).toEqual([]);
  });
});
