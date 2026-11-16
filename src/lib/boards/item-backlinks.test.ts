import { beforeEach, describe, expect, it, vi } from "vitest";

// Captures what the query builder received, so the bound, the indexed filter
// and the in-query archive filters are asserted without a live database.
const captured: {
  table?: string;
  select?: string;
  eq: [string, unknown][];
  is: [string, unknown][];
  order: string[];
  limit?: number;
  fromCalls: number;
} = { eq: [], is: [], order: [], fromCalls: 0 };

let result: { data: unknown; error: null | { message: string } } = {
  data: [],
  error: null,
};

function makeQuery() {
  const q: Record<string, unknown> = {
    select: vi.fn((cols: string) => {
      captured.select = cols;
      return q;
    }),
    eq: vi.fn((col: string, v: unknown) => {
      captured.eq.push([col, v]);
      return q;
    }),
    is: vi.fn((col: string, v: unknown) => {
      captured.is.push([col, v]);
      return q;
    }),
    order: vi.fn((col: string) => {
      captured.order.push(col);
      return q;
    }),
    limit: vi.fn((n: number) => {
      captured.limit = n;
      return q;
    }),
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      captured.fromCalls += 1;
      captured.table = table;
      return makeQuery();
    },
  }),
}));

import { listItemBacklinks } from "./item-backlinks";

const ITEM = "11111111-1111-4111-8111-111111111111";

function row(n: number) {
  return {
    id: `link-${n}`,
    items: { id: `item-${n}`, name: `Task ${n}` },
    boards: { id: `board-${n}`, name: `Board ${n}` },
    columns: { name: "Milestone" },
  };
}

beforeEach(() => {
  captured.table = undefined;
  captured.select = undefined;
  captured.eq = [];
  captured.is = [];
  captured.order = [];
  captured.limit = undefined;
  captured.fromCalls = 0;
  result = { data: [], error: null };
});

describe("listItemBacklinks", () => {
  it("rejects a non-uuid item id without querying", async () => {
    const res = await listItemBacklinks("not-a-uuid");
    expect(res.ok).toBe(false);
    expect(captured.fromCalls).toBe(0);
  });

  it("reads relation_links by the indexed linked_item_id, in one bounded query", async () => {
    await listItemBacklinks(ITEM);
    expect(captured.fromCalls).toBe(1);
    expect(captured.table).toBe("relation_links");
    expect(captured.eq).toEqual([["linked_item_id", ITEM]]);
    // One row past the page, to know whether more exist.
    expect(captured.limit).toBe(26);
    expect(captured.order).toEqual(["created_at", "id"]);
  });

  it("inner-joins the linking item, board and column so RLS drops what the caller cannot read", async () => {
    await listItemBacklinks(ITEM);
    expect(captured.select).toContain(
      "items!relation_links_item_id_fkey!inner(",
    );
    expect(captured.select).toContain("boards!inner(");
    expect(captured.select).toContain("columns!inner(");
  });

  it("filters archived items and boards in the query, not after the limit", async () => {
    await listItemBacklinks(ITEM);
    expect(captured.is).toEqual([
      ["items.archived_at", null],
      ["boards.archived_at", null],
    ]);
  });

  it("maps rows to the item, its board and the linking column", async () => {
    result = { data: [row(1)], error: null };
    const res = await listItemBacklinks(ITEM);
    expect(res).toEqual({
      ok: true,
      data: {
        links: [
          {
            linkId: "link-1",
            itemId: "item-1",
            itemName: "Task 1",
            boardId: "board-1",
            boardName: "Board 1",
            columnName: "Milestone",
          },
        ],
        hasMore: false,
      },
    });
  });

  it("returns one page and flags that more exist", async () => {
    result = {
      data: Array.from({ length: 26 }, (_, i) => row(i)),
      error: null,
    };
    const res = await listItemBacklinks(ITEM);
    expect(res.ok && res.data.links).toHaveLength(25);
    expect(res.ok && res.data.hasMore).toBe(true);
  });

  it("fails without leaking the database message", async () => {
    result = { data: null, error: { message: "permission denied for x" } };
    const res = await listItemBacklinks(ITEM);
    expect(res).toEqual({ ok: false, error: "Could not load linked items." });
  });
});
