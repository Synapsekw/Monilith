import { beforeEach, describe, expect, it, vi } from "vitest";

// Captures the rpc call so we can assert the fn name + args without a live DB.
const captured: {
  rpcName?: string;
  rpcArgs?: Record<string, unknown>;
  rpcCalls: number;
} = { rpcCalls: 0 };
let rows: unknown[] = [];
let rpcError: { message: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      captured.rpcCalls += 1;
      captured.rpcName = name;
      captured.rpcArgs = args;
      return Promise.resolve({ data: rows, error: rpcError });
    },
  }),
}));

import { searchItems } from "./item-search";

beforeEach(() => {
  captured.rpcName = undefined;
  captured.rpcArgs = undefined;
  captured.rpcCalls = 0;
  rpcError = null;
  rows = [
    {
      id: "i1",
      name: "Design spec",
      board_id: "b1",
      board_name: "Roadmap",
      rank: 0.8,
    },
  ];
});

describe("searchItems", () => {
  it("returns [] and never calls rpc for a query shorter than 2 chars", async () => {
    expect(await searchItems("a")).toEqual([]);
    expect(captured.rpcCalls).toBe(0);
  });

  it("returns [] and never calls rpc for a whitespace-only query", async () => {
    expect(await searchItems("   ")).toEqual([]);
    expect(captured.rpcCalls).toBe(0);
  });

  it("returns [] and never calls rpc for an over-long query", async () => {
    expect(await searchItems("x".repeat(101))).toEqual([]);
    expect(captured.rpcCalls).toBe(0);
  });

  it("calls search_items with the trimmed query and a 25 cap", async () => {
    await searchItems("  design  ");
    expect(captured.rpcName).toBe("search_items");
    expect(captured.rpcArgs).toEqual({ p_query: "design", p_limit: 25 });
  });

  it("maps rows to ItemSearchResult and drops rank", async () => {
    expect(await searchItems("design")).toEqual([
      { id: "i1", name: "Design spec", boardId: "b1", boardName: "Roadmap" },
    ]);
  });

  it("returns [] on an rpc error rather than throwing", async () => {
    rpcError = { message: "boom" };
    expect(await searchItems("design")).toEqual([]);
  });
});
