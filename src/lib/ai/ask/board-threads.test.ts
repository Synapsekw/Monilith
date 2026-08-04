import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));

import {
  listBoardThreads,
  listAgentThreads,
  BOARD_THREADS_LIMIT,
  AGENT_THREADS_LIMIT,
} from "./board-threads";

/** Minimal chainable PostgREST double that records the calls made on it. */
function builder(rows: unknown[]) {
  const calls: Record<string, unknown[]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return chain;
    };
  const chain = {
    select: record("select"),
    eq: record("eq"),
    is: record("is"),
    not: record("not"),
    order: record("order"),
    limit: (n: number) => {
      (calls.limit ??= []).push([n]);
      return Promise.resolve({ data: rows, error: null });
    },
    calls,
  };
  return chain;
}

beforeEach(() => from.mockReset());

describe("listBoardThreads", () => {
  it("filters by board and bounds the read at 50 over the indexed column", async () => {
    const chain = builder([{ id: "c1" }]);
    from.mockReturnValue(chain);

    const rows = await listBoardThreads("board-1");

    expect(rows).toEqual([{ id: "c1" }]);
    expect(from).toHaveBeenCalledWith("ai_conversations");
    expect(chain.calls.eq).toContainEqual(["board_id", "board-1"]);
    expect(chain.calls.order).toContainEqual([
      "updated_at",
      { ascending: false },
    ]);
    expect(chain.calls.limit).toEqual([[BOARD_THREADS_LIMIT]]);
    expect(BOARD_THREADS_LIMIT).toBe(50);
  });

  it("does NOT filter by user_id — RLS decides, so shared threads stay visible", async () => {
    const chain = builder([]);
    from.mockReturnValue(chain);
    await listBoardThreads("board-1");
    const eqKeys = (chain.calls.eq ?? []).map((c) => (c as string[])[0]);
    expect(eqKeys).not.toContain("user_id");
  });
});

describe("listAgentThreads", () => {
  it("returns the owner's cross-board agent threads, capped at 5", async () => {
    const chain = builder([{ id: "a1" }]);
    from.mockReturnValue(chain);

    await listAgentThreads("user-1");

    expect(chain.calls.eq).toContainEqual(["user_id", "user-1"]);
    expect(chain.calls.is).toContainEqual(["board_id", null]);
    expect(chain.calls.not).toContainEqual(["agent_id", "is", null]);
    expect(chain.calls.limit).toEqual([[AGENT_THREADS_LIMIT]]);
    expect(AGENT_THREADS_LIMIT).toBe(5);
  });
});
