import { describe, expect, it } from "vitest";
import { getItemHandler } from "./get-item";

describe("getItemHandler", () => {
  it("returns the item plus its cell values", async () => {
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string) => {
            if (table === "items") {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "i1", name: "Fix login bug", group_id: "g1" },
                    error: null,
                  }),
              };
            }
            return Promise.resolve({
              data: [{ column_id: "c1", value: { text: "In progress" } }],
              error: null,
            });
          },
        }),
      }),
    };
    const result = await getItemHandler(async () => client as never, {
      itemId: "i1",
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.item.id).toBe("i1");
    expect(parsed.cellValues).toEqual([
      { columnId: "c1", value: { text: "In progress" } },
    ]);
  });
});
