import { beforeEach, describe, expect, it, vi } from "vitest";

// Captures what the query builder received, so we can assert the bound + the
// escaped ilike pattern + ordering without a live database.
const captured: {
  select?: string;
  limit?: number;
  order?: [string, { ascending: boolean }];
  ilikePattern?: string;
  fromCalls: number;
} = { fromCalls: 0 };
let rows: unknown[] = [];
let queryError: { message: string } | null = null;

function makeQuery() {
  const q: Record<string, unknown> = {
    select: vi.fn((cols: string) => {
      captured.select = cols;
      return q;
    }),
    order: vi.fn((col: string, opts: { ascending: boolean }) => {
      captured.order = [col, opts];
      return q;
    }),
    limit: vi.fn((n: number) => {
      captured.limit = n;
      return q;
    }),
    ilike: vi.fn((_col: string, pattern: string) => {
      captured.ilikePattern = pattern;
      return q;
    }),
    then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data: rows, error: queryError }),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      captured.fromCalls += 1;
      return makeQuery();
    },
  }),
}));

import { searchItems } from "./item-search";

beforeEach(() => {
  captured.select = undefined;
  captured.limit = undefined;
  captured.order = undefined;
  captured.ilikePattern = undefined;
  captured.fromCalls = 0;
  queryError = null;
  rows = [
    {
      id: "i1",
      name: "Design spec",
      board_id: "b1",
      boards: { name: "Roadmap" },
    },
  ];
});

describe("searchItems", () => {
  it("returns [] and never queries for a query shorter than 2 chars", async () => {
    const res = await searchItems("a");
    expect(res).toEqual([]);
    expect(captured.fromCalls).toBe(0);
  });

  it("returns [] and never queries for a whitespace-only query", async () => {
    const res = await searchItems("   ");
    expect(res).toEqual([]);
    expect(captured.fromCalls).toBe(0);
  });

  it("returns [] and never queries for an over-long query", async () => {
    const res = await searchItems("x".repeat(101));
    expect(res).toEqual([]);
    expect(captured.fromCalls).toBe(0);
  });

  it("trims the query before matching", async () => {
    await searchItems("  design  ");
    expect(captured.ilikePattern).toBe("%design%");
  });

  it("escapes LIKE wildcards (% and _) in the query", async () => {
    await searchItems("50%_x");
    expect(captured.ilikePattern).toBe("%50\\%\\_x%");
  });

  it("bounds the read to 25 rows ordered by updated_at desc", async () => {
    await searchItems("design");
    expect(captured.limit).toBe(25);
    expect(captured.order).toEqual(["updated_at", { ascending: false }]);
  });

  it("embeds the board name via an inner join (no N+1)", async () => {
    await searchItems("design");
    expect(captured.select).toContain("boards!inner(name)");
  });

  it("flattens the embedded board name into the result shape", async () => {
    const res = await searchItems("design");
    expect(res).toEqual([
      { id: "i1", name: "Design spec", boardId: "b1", boardName: "Roadmap" },
    ]);
  });

  it("returns [] on a query error rather than throwing", async () => {
    queryError = { message: "boom" };
    const res = await searchItems("design");
    expect(res).toEqual([]);
  });
});
