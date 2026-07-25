import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/validations/boards", () => ({
  cellValueSchema: () => ({
    safeParse: (v: unknown) => ({ success: true, data: v }),
  }),
}));

import { updateItemHandler } from "./update-item";

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
          return Promise.resolve({ error: null });
        },
      }),
    };
    const result = await updateItemHandler(async () => client as never, {
      itemId: "i1",
      name: "Renamed",
      fields: [{ columnId: "c1", value: { text: "hello" } }],
    });
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
          return Promise.resolve({ error: null });
        },
      }),
    };
    const result = await updateItemHandler(async () => client as never, {
      itemId: "i1",
      fields: [{ columnId: "c1", value: { text: "hello" } }],
    });
    expect(upserted).toHaveLength(0);
    const text = result.content[0]?.text as string;
    expect(text).toContain("Item and column belong to different boards.");
    expect(result.isError).toBe(true);
  });
});
