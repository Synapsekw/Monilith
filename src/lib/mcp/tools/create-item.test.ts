import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/validations/boards", () => ({
  cellValueSchema: () => ({
    safeParse: (v: unknown) => ({ success: true, data: v }),
  }),
}));

import { makeFakeClient } from "@/test/mcp-fake-client";
import { createItemHandler } from "./create-item";

const ACTOR = "99999999-9999-4999-8999-999999999999";

describe("createItemHandler", () => {
  it("creates an item via RPC, then writes any provided field values", async () => {
    const upserted: unknown[] = [];
    const client = {
      rpc: (_fn: string, _args: unknown) =>
        Promise.resolve({
          data: { id: "i1", name: "New task", group_id: "g1" },
          error: null,
        }),
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data:
                  table === "columns"
                    ? { org_id: "o1", board_id: "b1", kind: "text" }
                    : { board_id: "b1" },
                error: null,
              }),
          }),
        }),
        upsert: (row: unknown) => {
          upserted.push(row);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: row, error: null }),
            }),
          };
        },
      }),
    };
    const result = await createItemHandler(
      async () => client as never,
      {
        groupId: "g1",
        name: "New task",
        fields: [{ columnId: "c1", value: { text: "hello" } }],
      },
      ACTOR,
    );
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.item.id).toBe("i1");
    expect(upserted).toHaveLength(1);
  });

  it("writes the cell row with org_id/board_id derived from the column, on the (item_id, column_id) conflict target", async () => {
    const { getClient, calls } = makeFakeClient({
      rpc: {
        data: { id: "i1", name: "New task", group_id: "g1" },
        error: null,
      },
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "text" },
        error: null,
      },
      item: { data: { board_id: "b1" }, error: null },
    });
    const result = await createItemHandler(
      getClient,
      {
        groupId: "g1",
        name: "New task",
        fields: [{ columnId: "c1", value: { text: "hello" } }],
      },
      ACTOR,
    );
    // org_id/board_id MUST come from the column (the RLS-relevant derivation),
    // item_id from the RPC-created item — never from caller input.
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0]?.row).toEqual({
      org_id: "o1",
      board_id: "b1",
      item_id: "i1",
      column_id: "c1",
      value: { text: "hello" },
    });
    expect(calls.upserts[0]?.options).toEqual({
      onConflict: "item_id,column_id",
    });
    expect(result.isError).toBeUndefined();
  });

  it("resolves the request client exactly once, even across multiple field writes", async () => {
    // Each getClient() charges the MCP rate limit and rotates the bridge secret
    // (src/lib/mcp/context.ts:39,50-51) — it must never move into the field loop.
    const { getClient, calls } = makeFakeClient();
    await createItemHandler(
      getClient,
      {
        groupId: "g1",
        name: "New task",
        fields: [
          { columnId: "c1", value: { text: "a" } },
          { columnId: "c2", value: { text: "b" } },
        ],
      },
      ACTOR,
    );
    expect(calls.getClient).toBe(1);
    expect(calls.upserts).toHaveLength(2);
  });

  it("returns isError with the RPC message when create_item fails, writing no fields", async () => {
    const { getClient, calls } = makeFakeClient({
      rpc: { data: null, error: { message: "group not found" } },
    });
    const result = await createItemHandler(
      getClient,
      {
        groupId: "g1",
        name: "New task",
        fields: [{ columnId: "c1", value: { text: "a" } }],
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("group not found");
    expect(calls.upserts).toHaveLength(0);
  });

  it("reports a missing column without writing, prefixed with the column id", async () => {
    const { getClient, calls } = makeFakeClient({
      column: { data: null, error: null },
    });
    const result = await createItemHandler(
      getClient,
      {
        groupId: "g1",
        name: "New task",
        fields: [{ columnId: "c1", value: { text: "a" } }],
      },
      ACTOR,
    );
    expect(calls.upserts).toHaveLength(0);
    const parsed = JSON.parse(result.content[0]?.text as string);
    expect(parsed.fieldErrors).toEqual(["c1: Column not found."]);
    expect(result.isError).toBe(true);
  });

  it("reports a missing item without writing", async () => {
    const { getClient, calls } = makeFakeClient({
      item: { data: null, error: null },
    });
    const result = await createItemHandler(
      getClient,
      {
        groupId: "g1",
        name: "New task",
        fields: [{ columnId: "c1", value: { text: "a" } }],
      },
      ACTOR,
    );
    expect(calls.upserts).toHaveLength(0);
    const parsed = JSON.parse(result.content[0]?.text as string);
    expect(parsed.fieldErrors).toEqual(["c1: Item not found."]);
    expect(result.isError).toBe(true);
  });

  it("propagates an upsert error into fieldErrors", async () => {
    const { getClient } = makeFakeClient({
      upsert: { error: { message: "duplicate key value" } },
    });
    const result = await createItemHandler(
      getClient,
      {
        groupId: "g1",
        name: "New task",
        fields: [{ columnId: "c1", value: { text: "a" } }],
      },
      ACTOR,
    );
    const parsed = JSON.parse(result.content[0]?.text as string);
    expect(parsed.fieldErrors).toEqual(["c1: duplicate key value"]);
    expect(result.isError).toBe(true);
  });

  it("leaves isError unset when only SOME field writes fail", async () => {
    const { getClient, calls } = makeFakeClient({
      // Second field's item read reports a different board -> cross-board guard.
      item: [
        { data: { board_id: "b1" }, error: null },
        { data: { board_id: "b2" }, error: null },
      ],
    });
    const result = await createItemHandler(
      getClient,
      {
        groupId: "g1",
        name: "New task",
        fields: [
          { columnId: "c1", value: { text: "a" } },
          { columnId: "c2", value: { text: "b" } },
        ],
      },
      ACTOR,
    );
    expect(calls.upserts).toHaveLength(1);
    const parsed = JSON.parse(result.content[0]?.text as string);
    expect(parsed.fieldErrors).toEqual([
      "c2: Item and column belong to different boards.",
    ]);
    expect(result.isError).toBeUndefined();
  });

  it("sets isError when EVERY field write fails", async () => {
    const { getClient, calls } = makeFakeClient({
      item: { data: { board_id: "b2" }, error: null },
    });
    const result = await createItemHandler(
      getClient,
      {
        groupId: "g1",
        name: "New task",
        fields: [
          { columnId: "c1", value: { text: "a" } },
          { columnId: "c2", value: { text: "b" } },
        ],
      },
      ACTOR,
    );
    expect(calls.upserts).toHaveLength(0);
    const parsed = JSON.parse(result.content[0]?.text as string);
    expect(parsed.fieldErrors).toHaveLength(2);
    expect(result.isError).toBe(true);
  });
  it("fans out an assigned notification for an initial people field", async () => {
    const { getClient, calls } = makeFakeClient({
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "people" },
        error: null,
      },
    });
    await createItemHandler(
      getClient,
      {
        groupId: "g1",
        name: "New task",
        fields: [{ columnId: "c1", value: { userIds: ["u-new"] } }],
      },
      ACTOR,
    );

    expect(calls.getClient).toBe(1);
    expect(calls.notifications).toEqual([
      [
        {
          org_id: "o1",
          recipient_id: "u-new",
          actor_id: ACTOR,
          kind: "assigned",
          board_id: "b1",
          item_id: "i1",
        },
      ],
    ]);
  });
});
