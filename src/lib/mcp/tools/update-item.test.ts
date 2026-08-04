import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/validations/boards", () => ({
  cellValueSchema: () => ({
    safeParse: (v: unknown) => ({ success: true, data: v }),
  }),
}));

import { makeFakeClient } from "@/test/mcp-fake-client";
import { updateItemHandler } from "./update-item";

const ACTOR = "99999999-9999-4999-8999-999999999999";

describe("updateItemHandler", () => {
  it("renames the item and writes provided field values", async () => {
    const upserted: unknown[] = [];
    const client = {
      from: (table: string) => ({
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { board_id: "b1" }, error: null }),
            }),
          }),
        }),
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
    const result = await updateItemHandler(
      async () => client as never,
      {
        itemId: "i1",
        name: "Renamed",
        fields: [{ columnId: "c1", value: { text: "hello" } }],
      },
      ACTOR,
    );
    expect(result.isError).toBeUndefined();
    expect(upserted).toHaveLength(1);
  });

  it("rejects a field write when the item and column belong to different boards", async () => {
    const upserted: unknown[] = [];
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data:
                  table === "columns"
                    ? { org_id: "o1", board_id: "b1", kind: "text" }
                    : { board_id: "b2" },
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
    const result = await updateItemHandler(
      async () => client as never,
      {
        itemId: "i1",
        fields: [{ columnId: "c1", value: { text: "hello" } }],
      },
      ACTOR,
    );
    expect(upserted).toHaveLength(0);
    const text = result.content[0]?.text as string;
    expect(text).toContain("Item and column belong to different boards.");
    expect(result.isError).toBe(true);
  });

  it("writes the cell row with org_id/board_id from the column and item_id from the input", async () => {
    const { getClient, calls } = makeFakeClient({
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "text" },
        error: null,
      },
      item: { data: { board_id: "b1" }, error: null },
    });
    const result = await updateItemHandler(
      getClient,
      {
        itemId: "i9",
        fields: [{ columnId: "c1", value: { text: "hello" } }],
      },
      ACTOR,
    );
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0]?.row).toEqual({
      org_id: "o1",
      board_id: "b1",
      item_id: "i9",
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
    await updateItemHandler(
      getClient,
      {
        itemId: "i1",
        name: "Renamed",
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

  it("returns isError and writes no fields when the rename fails", async () => {
    const { getClient, calls } = makeFakeClient({
      rename: { data: null, error: { message: "row not found" } },
    });
    const result = await updateItemHandler(
      getClient,
      {
        itemId: "i1",
        name: "Renamed",
        fields: [{ columnId: "c1", value: { text: "a" } }],
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("row not found");
    expect(calls.upserts).toHaveLength(0);
  });

  it("returns isError with a generic message when the rename returns no row", async () => {
    const { getClient } = makeFakeClient({
      rename: { data: null, error: null },
    });
    const result = await updateItemHandler(
      getClient,
      {
        itemId: "i1",
        name: "Renamed",
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Item not found.");
  });

  it("reports a missing column without writing, prefixed with the column id", async () => {
    const { getClient, calls } = makeFakeClient({
      column: { data: null, error: null },
    });
    const result = await updateItemHandler(
      getClient,
      {
        itemId: "i1",
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
    const result = await updateItemHandler(
      getClient,
      {
        itemId: "i1",
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
      upsert: { error: { message: "value too long" } },
    });
    const result = await updateItemHandler(
      getClient,
      {
        itemId: "i1",
        fields: [{ columnId: "c1", value: { text: "a" } }],
      },
      ACTOR,
    );
    const parsed = JSON.parse(result.content[0]?.text as string);
    expect(parsed.fieldErrors).toEqual(["c1: value too long"]);
    expect(result.isError).toBe(true);
  });

  it("leaves isError unset when only SOME field writes fail", async () => {
    const { getClient, calls } = makeFakeClient({
      item: [
        { data: { board_id: "b1" }, error: null },
        { data: { board_id: "b2" }, error: null },
      ],
    });
    const result = await updateItemHandler(
      getClient,
      {
        itemId: "i1",
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

  it("reports success for a no-op update (documented current behavior — spec finding F2)", async () => {
    // With neither `name` nor `fields`, the handler never verifies the item
    // exists and reports success. Pinned deliberately so the behavior is
    // intentional, not accidental. Do NOT "fix" this here — see spec §4 F2.
    const { getClient, calls } = makeFakeClient();
    const result = await updateItemHandler(
      getClient,
      {
        itemId: "does-not-exist",
      },
      ACTOR,
    );
    expect(result.isError).toBeUndefined();
    expect(calls.upserts).toHaveLength(0);
    const parsed = JSON.parse(result.content[0]?.text as string);
    expect(parsed).toEqual({ itemId: "does-not-exist", fieldErrors: [] });
  });
  it("fans out an assigned notification for a newly-added person", async () => {
    const { getClient, calls } = makeFakeClient({
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "people" },
        error: null,
      },
      priorCell: { data: { value: { userIds: ["u-old"] } }, error: null },
    });
    await updateItemHandler(
      getClient,
      {
        itemId: "i1",
        fields: [{ columnId: "c1", value: { userIds: ["u-old", "u-new"] } }],
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

  it("does not notify the actor for assigning themselves", async () => {
    const { getClient, calls } = makeFakeClient({
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "people" },
        error: null,
      },
    });
    await updateItemHandler(
      getClient,
      {
        itemId: "i1",
        fields: [{ columnId: "c1", value: { userIds: [ACTOR] } }],
      },
      ACTOR,
    );

    expect(calls.notifications).toEqual([]);
  });

  it("writes a non-people cell without touching notifications", async () => {
    const { getClient, calls } = makeFakeClient();
    await updateItemHandler(
      getClient,
      { itemId: "i1", fields: [{ columnId: "c1", value: { text: "hi" } }] },
      ACTOR,
    );

    expect(calls.upserts).toHaveLength(1);
    expect(calls.notifications).toEqual([]);
  });

  it("still reports success when the notification insert is rejected", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getClient } = makeFakeClient({
      column: {
        data: { org_id: "o1", board_id: "b1", kind: "people" },
        error: null,
      },
      notify: { error: { message: "new row violates row-level security" } },
    });
    const result = await updateItemHandler(
      getClient,
      {
        itemId: "i1",
        fields: [{ columnId: "c1", value: { userIds: ["u-new"] } }],
      },
      ACTOR,
    );

    const parsed = JSON.parse(result.content[0]?.text as string);
    expect(parsed.fieldErrors).toEqual([]);
    expect(spy).toHaveBeenCalledWith(
      "[notifications] assigned fan-out failed",
      expect.objectContaining({ recipients: 1 }),
    );
    spy.mockRestore();
  });
});
