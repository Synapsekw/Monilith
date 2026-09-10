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
  for (const m of ["select", "eq", "is", "order", "limit", "not", "in"])
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

  it("bounds the items and cell_values reads with .limit(...)", async () => {
    // Record every .limit(n) call, keyed by table. With an all-empty fixture the
    // mirror branch never fires (no mirror columns), so cell_values is read once —
    // the board-scoped read — and its only limit is 20000.
    const limits: Record<string, number[]> = {};
    from.mockImplementation((table: string) => {
      const result: Result =
        table === "boards"
          ? { data: BOARD_ROW, error: null }
          : { data: [], error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order", "not", "in"])
        chain[m] = () => chain;
      chain.limit = (n: number) => {
        (limits[table] ??= []).push(n);
        return chain;
      };
      chain.maybeSingle = async () => result;
      (chain as { then: unknown }).then = (resolve: (v: Result) => void) =>
        resolve(result);
      return chain;
    });

    await getBoardPayload("b5");

    expect(limits["items"]).toContain(5000);
    expect(limits["cell_values"]).toContain(20000);
    // Only the board-scoped cell_values read fires (no mirror columns).
    expect(limits["cell_values"]).toEqual([20000]);
  });

  it("selects exactly the narrowed cell columns, ordered deterministically", async () => {
    // Record every .select(...) and .order(...) call on cell_values so a
    // regression (widening back to `*`, or dropping the PK order that makes
    // truncation at the 20000 cap deterministic) is caught here instead of by
    // a payload-size incident in prod. All-empty fixture ⇒ no mirror columns ⇒
    // cell_values is read once (the board-scoped read), same as the .limit(...)
    // test above.
    const selects: Record<string, string[]> = {};
    const orders: Record<string, [string, unknown][]> = {};
    from.mockImplementation((table: string) => {
      const result: Result =
        table === "boards"
          ? { data: BOARD_ROW, error: null }
          : { data: [], error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["eq", "is", "limit", "not", "in"])
        chain[m] = () => chain;
      chain.select = (cols: string) => {
        (selects[table] ??= []).push(cols);
        return chain;
      };
      chain.order = (col: string, opts: unknown) => {
        (orders[table] ??= []).push([col, opts]);
        return chain;
      };
      chain.maybeSingle = async () => result;
      (chain as { then: unknown }).then = (resolve: (v: Result) => void) =>
        resolve(result);
      return chain;
    });

    await getBoardPayload("b8");

    expect(selects["cell_values"]).toEqual([
      "item_id, column_id, value, updated_at",
    ]);
    expect(orders["cell_values"]).toEqual([
      ["item_id", { ascending: true }],
      ["column_id", { ascending: true }],
    ]);
  });

  it("orders the mirror-target cell read by the same PK as the main read", async () => {
    // The mirror read is capped at 4000 too, so without an explicit order its
    // truncation is an arbitrary subset — the main read's problem, one function
    // lower. Fire the mirror branch (one mirror column + one relation link) and
    // assert BOTH cell_values reads carry the (item_id, column_id) order.
    const MIRROR_COL = {
      id: "mc1",
      board_id: "b9",
      org_id: "o1",
      kind: "mirror",
      name: "Mirror",
      position: 0,
      width: null,
      settings: { target_column_id: "tc1", source_relation_column_id: "rc1" },
    };
    const LINK = {
      id: "rl1",
      item_id: "i1",
      column_id: "rc1",
      linked_item_id: "li1",
      position: 0,
    };
    const orders: Record<string, [string, unknown][]> = {};
    from.mockImplementation((table: string) => {
      const data =
        table === "boards"
          ? BOARD_ROW
          : table === "columns"
            ? [MIRROR_COL]
            : table === "relation_links"
              ? [LINK]
              : [];
      const result: Result = { data, error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "limit", "not", "in"])
        chain[m] = () => chain;
      chain.order = (col: string, opts: unknown) => {
        (orders[table] ??= []).push([col, opts]);
        return chain;
      };
      chain.maybeSingle = async () => result;
      (chain as { then: unknown }).then = (resolve: (v: Result) => void) =>
        resolve(result);
      return chain;
    });

    await getBoardPayload("b9");

    // Two cell_values reads: the board-scoped one and the mirror-target one —
    // each ordered by the (item_id, column_id) primary key.
    expect(orders["cell_values"]).toEqual([
      ["item_id", { ascending: true }],
      ["column_id", { ascending: true }],
      ["item_id", { ascending: true }],
      ["column_id", { ascending: true }],
    ]);
  });

  it("issues the head read and the 9 satellite reads concurrently (one batch)", async () => {
    // With the head read parallelized, a missing board no longer gates the
    // satellites: all 10 table reads fire even when boards resolves empty.
    from.mockImplementation(() => tableMock({ data: null, error: null }));
    expect(await getBoardPayload("b6")).toBeNull();
    const tables = from.mock.calls.map((c) => c[0]);
    expect(tables).toContain("boards");
    expect(tables).toContain("items");
    expect(tables).toContain("cell_values");
    expect(tables).toHaveLength(10);
  });

  it("a missing board wins over a satellite error (null, not throw)", async () => {
    from.mockImplementation((table: string) =>
      table === "boards"
        ? tableMock({ data: null, error: null })
        : tableMock({ data: null, error: { message: "satellite broke" } }),
    );
    expect(await getBoardPayload("b7")).toBeNull();
  });
});
