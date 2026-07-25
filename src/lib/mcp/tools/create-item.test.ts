import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/validations/boards", () => ({
  cellValueSchema: () => ({
    safeParse: (v: unknown) => ({ success: true, data: v }),
  }),
}));

import { createItemHandler } from "./create-item";

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
          return Promise.resolve({ error: null });
        },
      }),
    };
    const result = await createItemHandler(async () => client as never, {
      groupId: "g1",
      name: "New task",
      fields: [{ columnId: "c1", value: { text: "hello" } }],
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.item.id).toBe("i1");
    expect(upserted).toHaveLength(1);
  });
});
