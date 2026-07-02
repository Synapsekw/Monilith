import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("@/lib/auth/session", () => ({ getUser: vi.fn() }));

import { getBoardPayload } from "@/lib/boards/queries";

type Result = { data: unknown; error: { message: string } | null };

/** Chainable, thenable stand-in for a PostgREST builder. */
function tableMock(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "not", "in"])
    chain[m] = () => chain;
  chain.maybeSingle = async () => result;
  (chain as { then: unknown }).then = (resolve: (v: Result) => void) =>
    resolve(result);
  return chain;
}

const BOARD_ROW = { id: "b1", org_id: "o1", name: "B" };

beforeEach(() => {
  from.mockReset();
});

// getBoardPayload is wrapped in React cache() — it memoizes per boardId, so
// every test uses a DISTINCT boardId (b1–b4). Keep that discipline here.
describe("getBoardPayload error contract", () => {
  it("returns null when the board row is absent (→ notFound)", async () => {
    from.mockImplementation(() => tableMock({ data: null, error: null }));
    expect(await getBoardPayload("b1")).toBeNull();
  });

  it("throws when the board head read errors (not notFound)", async () => {
    from.mockImplementation(() =>
      tableMock({ data: null, error: { message: "db down" } }),
    );
    await expect(getBoardPayload("b2")).rejects.toThrow(/db down/);
  });

  it("throws when a parallel read errors instead of rendering an empty board", async () => {
    from.mockImplementation((table: string) => {
      if (table === "boards")
        return tableMock({ data: BOARD_ROW, error: null });
      if (table === "items")
        return tableMock({ data: null, error: { message: "items broke" } });
      return tableMock({ data: [], error: null });
    });
    await expect(getBoardPayload("b3")).rejects.toThrow(/items.*items broke/i);
  });

  it("returns the payload when every read succeeds", async () => {
    from.mockImplementation((table: string) =>
      table === "boards"
        ? tableMock({ data: BOARD_ROW, error: null })
        : tableMock({ data: [], error: null }),
    );
    const payload = await getBoardPayload("b4");
    expect(payload?.board).toEqual(BOARD_ROW);
    expect(payload?.items).toEqual([]);
  });
});
