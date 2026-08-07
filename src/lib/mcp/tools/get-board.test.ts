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
                    data: [
                      {
                        id: "c1",
                        name: "Status",
                        kind: "status",
                        settings: {
                          options: [
                            { id: "s1", label: "Done", color: "green" },
                          ],
                        },
                      },
                    ],
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
      {
        id: "c1",
        name: "Status",
        kind: "status",
        writable: true,
        valueShape: "{ optionId: string | null }",
        note: "optionId must be an id from this column's options[]",
        options: [{ id: "s1", label: "Done", color: "green" }],
      },
    ]);
    expect(parsed.groups).toEqual([{ id: "g1", name: "To Do" }]);
  });

  it("does not fail the whole call when one column has malformed settings", async () => {
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
                    data: [
                      { id: "c1", name: "Broken", kind: "status", settings: 7 },
                      {
                        id: "c2",
                        name: "Title",
                        kind: "text",
                        settings: {},
                      },
                    ],
                    error: null,
                  }),
              };
            }
            return {
              is: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            };
          },
        }),
      }),
    };
    const result = await getBoardHandler(async () => client as never, {
      boardId: "b1",
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.columns).toHaveLength(2);
    expect(parsed.columns[0]).not.toHaveProperty("options");
    expect(parsed.columns[1].kind).toBe("text");
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
