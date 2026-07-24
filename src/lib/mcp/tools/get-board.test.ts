import { describe, expect, it } from "vitest";
import { getBoardHandler } from "./get-board";

describe("getBoardHandler", () => {
  it("returns board metadata plus its columns and groups", async () => {
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: () => {
            if (table === "boards") {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "b1", name: "Roadmap" },
                    error: null,
                  }),
              };
            }
            if (table === "columns") {
              return {
                order: () =>
                  Promise.resolve({
                    data: [{ id: "c1", name: "Status", kind: "status" }],
                    error: null,
                  }),
              };
            }
            return {
              is: () => ({
                order: () =>
                  Promise.resolve({
                    data: [{ id: "g1", name: "To Do" }],
                    error: null,
                  }),
              }),
            };
          },
        }),
      }),
    };
    const result = await getBoardHandler(async () => client as never, {
      boardId: "b1",
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.board.id).toBe("b1");
    expect(parsed.columns).toEqual([
      { id: "c1", name: "Status", kind: "status" },
    ]);
    expect(parsed.groups).toEqual([{ id: "g1", name: "To Do" }]);
  });

  it("returns an isError result when the board is not found", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    };
    const result = await getBoardHandler(async () => client as never, {
      boardId: "missing",
    });
    expect(result.isError).toBe(true);
  });
});
