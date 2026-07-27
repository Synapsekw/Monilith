import { describe, expect, it } from "vitest";
import { SEARCH_LIMIT, searchItemsHandler } from "./search-items";

/** A fake whose `.limit(n)` returns `rows`, recording the n the handler asked for. */
function fakeClient(rows: unknown[]) {
  const limits: number[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            ilike: () => ({
              order: () => ({
                limit: (n: number) => {
                  limits.push(n);
                  return Promise.resolve({ data: rows, error: null });
                },
              }),
            }),
          }),
        }),
      }),
    }),
  };
  return { getClient: async () => client as never, limits };
}

const row = (n: number) => ({
  id: `i${n}`,
  name: `Fix login bug ${n}`,
  group_id: "g1",
});

describe("searchItemsHandler", () => {
  it("returns bounded, name-matching items for a board", async () => {
    const fake = fakeClient([
      { id: "i1", name: "Fix login bug", group_id: "g1" },
    ]);

    const result = await searchItemsHandler(fake.getClient, {
      boardId: "b1",
      query: "login",
    });
    const parsed = JSON.parse(result.content[0].text as string);

    expect(parsed.items).toEqual([
      { id: "i1", name: "Fix login bug", groupId: "g1" },
    ]);
    expect(parsed.truncated).toBe(false);
    expect(parsed.note).toBeUndefined();
  });

  it("over-fetches by one so a full page is never mistaken for a complete result set", async () => {
    const fake = fakeClient([]);

    await searchItemsHandler(fake.getClient, { boardId: "b1", query: "x" });

    expect(fake.limits).toEqual([SEARCH_LIMIT + 1]);
  });

  it("says so when matches were truncated, instead of returning 50 that look complete", async () => {
    const fake = fakeClient(
      Array.from({ length: SEARCH_LIMIT + 1 }, (_, n) => row(n)),
    );

    const result = await searchItemsHandler(fake.getClient, {
      boardId: "b1",
      query: "bug",
    });
    const parsed = JSON.parse(result.content[0].text as string);

    expect(parsed.items).toHaveLength(SEARCH_LIMIT);
    expect(parsed.truncated).toBe(true);
    expect(parsed.note).toMatch(/list_items/);
  });

  it("does not claim truncation when the matches exactly fill the limit", async () => {
    const fake = fakeClient(
      Array.from({ length: SEARCH_LIMIT }, (_, n) => row(n)),
    );

    const result = await searchItemsHandler(fake.getClient, {
      boardId: "b1",
      query: "bug",
    });
    const parsed = JSON.parse(result.content[0].text as string);

    expect(parsed.items).toHaveLength(SEARCH_LIMIT);
    expect(parsed.truncated).toBe(false);
  });

  it("surfaces a query error", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              ilike: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({ data: null, error: { message: "boom" } }),
                }),
              }),
            }),
          }),
        }),
      }),
    };

    const result = await searchItemsHandler(async () => client as never, {
      boardId: "b1",
      query: "x",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("boom");
  });
});
