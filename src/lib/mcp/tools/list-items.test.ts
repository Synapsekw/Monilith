import { describe, expect, it } from "vitest";
import {
  LIST_ITEMS_CELLS_CAP,
  LIST_ITEMS_DEFAULT_LIMIT,
  LIST_ITEMS_MAX_LIMIT,
  listItemsHandler,
  listItemsInput,
} from "./list-items";

type QueryResult = { data: unknown; error: { message: string } | null };
type Call = { method: string; args: unknown[] };

/**
 * Structural fake of the four table reads `listItemsHandler` issues. Every
 * builder method is chainable and the builder itself is thenable, so it does
 * not matter which call terminates the chain — mirroring supabase-js, where
 * `.limit()` and `.maybeSingle()` are both awaitable.
 */
function fakeClient(
  results: Record<string, QueryResult | ((own: Call[]) => QueryResult)>,
) {
  const calls: Record<string, Call[]> = {};
  let getClientCount = 0;

  const client = {
    from(table: string): unknown {
      const log = (calls[table] ??= []);
      const own: Call[] = [];
      const configured = results[table] ?? { data: [], error: null };
      const builder: unknown = new Proxy(
        {},
        {
          get(_target, prop) {
            if (typeof prop !== "string") return undefined;
            if (prop === "then") {
              return (onOk: (v: QueryResult) => unknown) =>
                Promise.resolve(
                  typeof configured === "function"
                    ? configured(own)
                    : configured,
                ).then(onOk);
            }
            return (...args: unknown[]) => {
              log.push({ method: prop, args });
              own.push({ method: prop, args });
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };

  return {
    // `never` is assignable to SupabaseClient<Database>, which is what lets a
    // structural fake satisfy the handler's `GetClient` signature.
    getClient: () => {
      getClientCount += 1;
      return Promise.resolve(client as never);
    },
    calls,
    getClientCount: () => getClientCount,
  };
}

const BOARD = { data: { id: "b1", name: "QCC" }, error: null };
const COLUMNS = {
  data: [{ id: "c1", name: "Status", kind: "status" }],
  error: null,
};
const GROUPS = { data: [{ id: "g1", name: "Q3" }], error: null };

const item = (n: number, position = n) => ({
  id: `1111111a-1111-4111-8111-11111111${String(n).padStart(4, "0")}`,
  name: `Item ${n}`,
  group_id: "g1",
  position,
});

function parse(result: { content: { text?: unknown }[] }) {
  return JSON.parse(result.content[0].text as string);
}

/** The `.or()` keyset predicate, if the handler applied one. */
function orFilter(calls: Record<string, Call[]>): string | undefined {
  const call = (calls.items ?? []).find((c) => c.method === "or");
  return call?.args[0] as string | undefined;
}

describe("listItemsHandler", () => {
  it("returns a board's items with their cell values in one response", async () => {
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [item(1), item(2)], error: null },
      cell_values: {
        data: [
          { item_id: item(1).id, column_id: "c1", value: { label: "Done" } },
          { item_id: item(2).id, column_id: "c1", value: { label: "Open" } },
        ],
        error: null,
      },
    });

    const parsed = parse(
      await listItemsHandler(fake.getClient, { boardId: "b1" }),
    );

    expect(parsed.board).toEqual({ id: "b1", name: "QCC" });
    expect(parsed.columns).toEqual([
      { id: "c1", name: "Status", kind: "status" },
    ]);
    expect(parsed.groups).toEqual([{ id: "g1", name: "Q3" }]);
    expect(parsed.items).toEqual([
      {
        id: item(1).id,
        name: "Item 1",
        groupId: "g1",
        cells: { c1: { label: "Done" } },
      },
      {
        id: item(2).id,
        name: "Item 2",
        groupId: "g1",
        cells: { c1: { label: "Open" } },
      },
    ]);
  });

  it("fetches every cell value for the page in ONE batched `in` query", async () => {
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [item(1), item(2), item(3)], error: null },
      cell_values: { data: [], error: null },
    });

    await listItemsHandler(fake.getClient, { boardId: "b1" });

    const inCalls = (fake.calls.cell_values ?? []).filter(
      (c) => c.method === "in",
    );
    expect(inCalls).toHaveLength(1);
    expect(inCalls[0].args).toEqual([
      "item_id",
      [item(1).id, item(2).id, item(3).id],
    ]);
  });

  it("resolves the rate-limited request client exactly once", async () => {
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [item(1)], error: null },
      cell_values: { data: [], error: null },
    });

    await listItemsHandler(fake.getClient, { boardId: "b1" });

    expect(fake.getClientCount()).toBe(1);
  });

  it("skips the cell_values query entirely when the page is empty", async () => {
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [], error: null },
    });

    const parsed = parse(
      await listItemsHandler(fake.getClient, { boardId: "b1" }),
    );

    expect(parsed.items).toEqual([]);
    expect(parsed.hasMore).toBe(false);
    expect(fake.calls.cell_values).toBeUndefined();
  });

  it("signals truncation with hasMore + nextCursor instead of silently cutting off", async () => {
    const rows = [item(1), item(2), item(3)];
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: rows, error: null },
      cell_values: { data: [], error: null },
    });

    const parsed = parse(
      await listItemsHandler(fake.getClient, { boardId: "b1", limit: 2 }),
    );

    // The handler over-fetches by one to detect "there are more" honestly.
    const limitCall = (fake.calls.items ?? []).find(
      (c) => c.method === "limit",
    );
    expect(limitCall?.args).toEqual([3]);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.hasMore).toBe(true);
    expect(typeof parsed.nextCursor).toBe("string");
  });

  it("reports hasMore false and omits nextCursor when the board fits in one page", async () => {
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [item(1), item(2)], error: null },
      cell_values: { data: [], error: null },
    });

    const parsed = parse(
      await listItemsHandler(fake.getClient, { boardId: "b1", limit: 2 }),
    );

    expect(parsed.hasMore).toBe(false);
    expect(parsed.nextCursor).toBeUndefined();
  });

  it("continues from nextCursor with a keyset predicate on (position, id), never an offset", async () => {
    const page1 = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [item(1), item(2), item(3)], error: null },
      cell_values: { data: [], error: null },
    });
    const first = parse(
      await listItemsHandler(page1.getClient, { boardId: "b1", limit: 2 }),
    );

    const page2 = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [item(3)], error: null },
      cell_values: { data: [], error: null },
    });
    const second = parse(
      await listItemsHandler(page2.getClient, {
        boardId: "b1",
        limit: 2,
        cursor: first.nextCursor as string,
      }),
    );

    // The cursor encodes the LAST returned row of page 1 (item 2).
    expect(orFilter(page2.calls)).toBe(
      `position.gt.2,and(position.eq.2,id.gt.${item(2).id})`,
    );
    expect((page2.calls.items ?? []).some((c) => c.method === "range")).toBe(
      false,
    );
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });

  it("orders by position then id so the keyset cursor is total", async () => {
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [item(1)], error: null },
      cell_values: { data: [], error: null },
    });

    await listItemsHandler(fake.getClient, { boardId: "b1" });

    const orders = (fake.calls.items ?? [])
      .filter((c) => c.method === "order")
      .map((c) => c.args[0]);
    expect(orders).toEqual(["position", "id"]);
  });

  it("filters to a single group when groupId is supplied", async () => {
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [item(1)], error: null },
      cell_values: { data: [], error: null },
    });

    await listItemsHandler(fake.getClient, { boardId: "b1", groupId: "g1" });

    const eqs = (fake.calls.items ?? [])
      .filter((c) => c.method === "eq")
      .map((c) => c.args);
    expect(eqs).toContainEqual(["group_id", "g1"]);
  });

  it("excludes archived items", async () => {
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [item(1)], error: null },
      cell_values: { data: [], error: null },
    });

    await listItemsHandler(fake.getClient, { boardId: "b1" });

    expect((fake.calls.items ?? []).map((c) => c.args)).toContainEqual([
      "archived_at",
      null,
    ]);
  });

  it("rejects a tampered cursor instead of interpolating it into a filter", async () => {
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [], error: null },
    });

    const result = await listItemsHandler(fake.getClient, {
      boardId: "b1",
      cursor: Buffer.from("0|x,or(id.gt.0)", "utf8").toString("base64url"),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/cursor/i);
    expect(orFilter(fake.calls)).toBeUndefined();
  });

  it("reports a board the caller cannot see as not found", async () => {
    const fake = fakeClient({
      boards: { data: null, error: null },
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [], error: null },
    });

    const result = await listItemsHandler(fake.getClient, { boardId: "b1" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Board not found.");
  });

  it("surfaces an items read error", async () => {
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: null, error: { message: "boom" } },
    });

    const result = await listItemsHandler(fake.getClient, { boardId: "b1" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });

  it("surfaces a cell_values read error rather than returning items with silently empty cells", async () => {
    const fake = fakeClient({
      boards: BOARD,
      columns: COLUMNS,
      groups: GROUPS,
      items: { data: [item(1)], error: null },
      cell_values: { data: null, error: { message: "cells exploded" } },
    });

    const result = await listItemsHandler(fake.getClient, { boardId: "b1" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("cells exploded");
  });

  describe("cell value cap", () => {
    /** `perItem` cells for each of `count` items, served in PK order by range. */
    function wideBoard(count: number, perItem: number) {
      const items = Array.from({ length: count }, (_, i) => item(i + 1));
      const cells = items.flatMap((it) =>
        Array.from({ length: perItem }, (_, c) => ({
          item_id: it.id,
          column_id: `c${String(c).padStart(3, "0")}`,
          value: { text: `${it.name}/${c}` },
        })),
      );
      const columns = Array.from({ length: perItem }, (_, c) => ({
        id: `c${String(c).padStart(3, "0")}`,
        name: `Col ${c}`,
        kind: "text",
      }));
      const fake = fakeClient({
        boards: BOARD,
        columns: { data: columns, error: null },
        groups: GROUPS,
        items: { data: items, error: null },
        cell_values: (own) => {
          const [from, to] = own.find((c) => c.method === "range")!.args as [
            number,
            number,
          ];
          // PostgREST never returns more than 1000 rows in one response.
          return {
            data: cells.slice(from, Math.min(to, from + 999) + 1),
            error: null,
          };
        },
      });
      return { fake, items };
    }

    it("holds a full page of a 100-column board", () => {
      expect(LIST_ITEMS_CELLS_CAP).toBe(LIST_ITEMS_MAX_LIMIT * 100);
    });

    it("reports truncated false, with no next, when every cell fits", async () => {
      const { fake } = wideBoard(10, 20);
      const body = parse(
        await listItemsHandler(fake.getClient, { boardId: "b1" }),
      );
      expect(body.truncated).toBe(false);
      expect(body.next).toBeUndefined();
      expect(
        body.items.some((i: { cellsTruncated?: boolean }) => i.cellsTruncated),
      ).toBe(false);
      // A short read is still one request.
      expect(
        (fake.calls.cell_values ?? []).filter((c) => c.method === "range"),
      ).toHaveLength(1);
    });

    it("does not flag a page holding exactly the cap", async () => {
      const { fake } = wideBoard(50, 20);
      const body = parse(
        await listItemsHandler(fake.getClient, { boardId: "b1" }),
      );
      expect(body.truncated).toBe(false);
      expect(Object.keys(body.items[49].cells)).toHaveLength(20);
    });

    it("returns every cell of a wide page by paging the cell read", async () => {
      // 100 items x 25 columns = 2,500 cells: three PostgREST responses. This
      // page used to come back with only its first 40 items filled.
      const { fake } = wideBoard(100, 25);
      const body = parse(
        await listItemsHandler(fake.getClient, { boardId: "b1" }),
      );
      expect(body.truncated).toBe(false);
      expect(body.next).toBeUndefined();
      expect(body.items).toHaveLength(100);
      for (const i of body.items) expect(Object.keys(i.cells)).toHaveLength(25);
    });

    it("flags a page past the cap, marks the incomplete items and says how to get them", async () => {
      // 200 items x 101 columns = 20,200 cells; 20,000 load = 198 whole items
      // and 2 cells of the 199th.
      const { fake, items } = wideBoard(200, 101);
      const body = parse(
        await listItemsHandler(fake.getClient, { boardId: "b1", limit: 200 }),
      );

      expect(body.truncated).toBe(true);
      expect(body.items).toHaveLength(200);
      const complete = body.items.filter(
        (i: { cellsTruncated?: boolean }) => !i.cellsTruncated,
      );
      expect(complete).toHaveLength(198);
      for (const i of complete) expect(Object.keys(i.cells)).toHaveLength(101);
      // Reported in page order; which items are cut follows the id order of
      // the cell read, so compare as sets.
      expect(new Set(body.next.incompleteItemIds).size).toBe(2);
      for (const id of body.next.incompleteItemIds)
        expect(items.map((i) => i.id)).toContain(id);
      expect(body.next.tool).toBe("list_items");
      // 101 columns: 198 items always fit under 20,000 cells.
      expect(body.next.args).toEqual({ boardId: "b1", limit: 198 });
      expect(body.next.hint).toContain("20000");
      expect(body.next.hint).toContain("get_item");
    });

    it("keeps the caller's cursor and group in the next arguments", async () => {
      const { fake } = wideBoard(200, 101);
      const first = parse(
        await listItemsHandler(fake.getClient, { boardId: "b1", limit: 1 }),
      );
      const cursor = first.nextCursor as string;
      const body = parse(
        await listItemsHandler(fake.getClient, {
          boardId: "b1",
          groupId: "g1",
          cursor,
          limit: 200,
        }),
      );
      expect(body.next.args).toEqual({
        boardId: "b1",
        groupId: "g1",
        cursor,
        limit: 198,
      });
    });

    it("pages the cell read in small waves, ordered by the primary key", async () => {
      const { fake } = wideBoard(100, 25);
      await listItemsHandler(fake.getClient, { boardId: "b1" });
      const calls = fake.calls.cell_values ?? [];
      const ranges = calls
        .filter((c) => c.method === "range")
        .map((c) => c.args);
      // First page alone, then one wave of three; the short third page ends it.
      expect(ranges).toEqual([
        [0, 999],
        [1000, 1999],
        [2000, 2999],
        [3000, 3999],
      ]);
      expect(
        new Set(
          calls.filter((c) => c.method === "order").map((c) => c.args[0]),
        ),
      ).toEqual(new Set(["item_id", "column_id"]));
    });
  });

  it("caps limit so a hot-path read can never be unbounded", () => {
    expect(listItemsInput.limit.safeParse(LIST_ITEMS_MAX_LIMIT).success).toBe(
      true,
    );
    expect(
      listItemsInput.limit.safeParse(LIST_ITEMS_MAX_LIMIT + 1).success,
    ).toBe(false);
    expect(listItemsInput.limit.safeParse(0).success).toBe(false);
    expect(listItemsInput.limit.safeParse(1.5).success).toBe(false);
    expect(LIST_ITEMS_DEFAULT_LIMIT).toBeLessThanOrEqual(LIST_ITEMS_MAX_LIMIT);
  });

  it("requires a uuid boardId", () => {
    expect(listItemsInput.boardId.safeParse("not-a-uuid").success).toBe(false);
  });
});
