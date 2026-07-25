import { describe, expect, it } from "vitest";
import { searchItemsHandler } from "./search-items";

describe("searchItemsHandler", () => {
  it("returns bounded, name-matching items for a board", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              ilike: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: [
                        { id: "i1", name: "Fix login bug", group_id: "g1" },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        }),
      }),
    };
    const result = await searchItemsHandler(async () => client as never, {
      boardId: "b1",
      query: "login",
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed).toEqual([
      { id: "i1", name: "Fix login bug", groupId: "g1" },
    ]);
  });
});
