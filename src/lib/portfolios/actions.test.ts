import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));
// `cacheLife`/`cacheTag` are imported (not called) by `@/lib/org/queries-cached`,
// which `@/lib/portfolios/queries` pulls in transitively — a bare
// `{ revalidatePath }` mock makes that import fail to link.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

import {
  createPortfolio,
  addBoardToPortfolio,
  removePortfolioBoard,
  updatePortfolioPlacement,
  getStatusColumnsForBoard,
} from "@/lib/portfolios/actions";

const PORTFOLIO_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const PLACEMENT_ID = "33333333-3333-4333-8333-333333333333";
const COLUMN_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

/** `.delete().eq("id", …)` on `portfolio_boards`, awaited for `{ error }`. */
function deleteChain(error: unknown, onDelete?: (id: unknown) => void) {
  return (table: string) => {
    if (table !== "portfolio_boards") return {} as never;
    return {
      delete: () => ({
        eq: async (_col: string, id: unknown) => {
          onDelete?.(id);
          return { error };
        },
      }),
    } as never;
  };
}

/** `.update(patch).eq("id", …)` on `portfolio_boards`, awaited for `{ error }`. */
function updateChain(error: unknown, onUpdate?: (patch: unknown) => void) {
  return (table: string) => {
    if (table !== "portfolio_boards") return {} as never;
    return {
      update: (patch: unknown) => ({
        eq: async () => {
          onUpdate?.(patch);
          return { error };
        },
      }),
    } as never;
  };
}

/**
 * `getBoardStatusColumns`' read:
 * `.select("id, name, kind, settings").eq("board_id", …).eq("kind", "status").order("position", …)`.
 */
function columnsChain(result: { data: unknown; error: unknown }) {
  return (table: string) => {
    if (table !== "columns") return {} as never;
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({ order: async () => result }),
        }),
      }),
    } as never;
  };
}

describe("createPortfolio", () => {
  it("rejects a blank name without calling the RPC", async () => {
    const res = await createPortfolio({ name: "   " });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_portfolio and returns the row", async () => {
    const portfolio = { id: PORTFOLIO_ID, name: "Q3" };
    rpc.mockResolvedValue({ data: portfolio, error: null });
    const res = await createPortfolio({ name: "  Q3  " });
    // The schema trims, so the RPC sees the trimmed name.
    expect(rpc).toHaveBeenCalledWith("create_portfolio", { p_name: "Q3" });
    expect(res).toEqual({ ok: true, data: { portfolio } });
  });

  it("surfaces an RPC error as a typed failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await createPortfolio({ name: "Q3" });
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});

describe("addBoardToPortfolio", () => {
  const valid = {
    portfolioId: PORTFOLIO_ID,
    boardId: BOARD_ID,
    doneColumnId: COLUMN_ID,
    doneOptionIds: ["opt-1"],
  };

  it("rejects an invalid board id without calling the RPC", async () => {
    const res = await addBoardToPortfolio({ ...valid, boardId: "nope" });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls add_portfolio_board with the mapped args", async () => {
    const placement = { id: PLACEMENT_ID, board_id: BOARD_ID };
    rpc.mockResolvedValue({ data: placement, error: null });
    const res = await addBoardToPortfolio(valid);
    expect(rpc).toHaveBeenCalledWith("add_portfolio_board", {
      p_portfolio_id: PORTFOLIO_ID,
      p_board_id: BOARD_ID,
      p_done_column_id: COLUMN_ID,
      p_done_option_ids: ["opt-1"],
    });
    expect(res).toEqual({ ok: true, data: { placement } });
  });

  it("surfaces an RPC error as a typed failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "duplicate" } });
    const res = await addBoardToPortfolio(valid);
    expect(res).toEqual({ ok: false, error: "duplicate" });
  });
});

describe("removePortfolioBoard", () => {
  it("rejects an invalid placement id without touching the DB", async () => {
    const res = await removePortfolioBoard({
      placementId: "nope",
      portfolioId: PORTFOLIO_ID,
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("deletes the placement row by id", async () => {
    const onDelete = vi.fn();
    from.mockImplementation(deleteChain(null, onDelete));
    const res = await removePortfolioBoard({
      placementId: PLACEMENT_ID,
      portfolioId: PORTFOLIO_ID,
    });
    expect(from).toHaveBeenCalledWith("portfolio_boards");
    expect(onDelete).toHaveBeenCalledWith(PLACEMENT_ID);
    expect(res).toEqual({ ok: true, data: null });
  });

  it("surfaces a delete error as a typed failure", async () => {
    from.mockImplementation(deleteChain({ message: "denied" }));
    const res = await removePortfolioBoard({
      placementId: PLACEMENT_ID,
      portfolioId: PORTFOLIO_ID,
    });
    expect(res).toEqual({ ok: false, error: "denied" });
  });
});

describe("updatePortfolioPlacement", () => {
  it("rejects an invalid portfolio id without touching the DB", async () => {
    const res = await updatePortfolioPlacement({
      placementId: PLACEMENT_ID,
      portfolioId: "nope",
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("patches only the keys present on the input", async () => {
    const onUpdate = vi.fn();
    from.mockImplementation(updateChain(null, onUpdate));
    const res = await updatePortfolioPlacement({
      placementId: PLACEMENT_ID,
      portfolioId: PORTFOLIO_ID,
      priority: "high",
      ownerUserId: null,
    });
    // `budget`/`healthOverride`/`statusNote` were absent, so they must not be
    // written — an explicit `null` (ownerUserId) still clears the column.
    expect(onUpdate).toHaveBeenCalledWith({
      priority: "high",
      owner_user_id: null,
    });
    expect(res).toEqual({ ok: true, data: null });
  });

  it("surfaces an update error as a typed failure", async () => {
    from.mockImplementation(updateChain({ message: "rls" }));
    const res = await updatePortfolioPlacement({
      placementId: PLACEMENT_ID,
      portfolioId: PORTFOLIO_ID,
      budget: 100,
    });
    expect(res).toEqual({ ok: false, error: "rls" });
  });
});

describe("getStatusColumnsForBoard", () => {
  it("rejects an invalid board id without touching the DB", async () => {
    const res = await getStatusColumnsForBoard("nope");
    expect(res).toEqual({ ok: false, error: "Invalid board" });
    expect(from).not.toHaveBeenCalled();
  });

  it("returns the board's status columns with parsed options", async () => {
    from.mockImplementation(
      columnsChain({
        data: [
          {
            id: COLUMN_ID,
            name: "Status",
            kind: "status",
            settings: {
              options: [
                { id: "o1", label: "Done", color: "green" },
                { id: "o2", label: "", color: "red" }, // invalid → whole array drops
              ],
            },
          },
        ],
        error: null,
      }),
    );
    const res = await getStatusColumnsForBoard(BOARD_ID);
    expect(res).toEqual({
      ok: true,
      data: { columns: [{ id: COLUMN_ID, name: "Status", options: [] }] },
    });
  });

  it("parses a well-formed option set", async () => {
    from.mockImplementation(
      columnsChain({
        data: [
          {
            id: COLUMN_ID,
            name: "Status",
            kind: "status",
            settings: {
              options: [{ id: "o1", label: "Done", color: "green" }],
            },
          },
        ],
        error: null,
      }),
    );
    const res = await getStatusColumnsForBoard(BOARD_ID);
    expect(res).toEqual({
      ok: true,
      data: {
        columns: [
          {
            id: COLUMN_ID,
            name: "Status",
            options: [{ id: "o1", label: "Done", color: "green" }],
          },
        ],
      },
    });
  });

  /**
   * `getBoardStatusColumns` throws on a DB failure rather than returning an
   * empty list; the action must catch it so the `ActionResult` contract holds
   * (a rejection would cross the Server Action boundary as a generic error).
   * The underlying message is preserved, not flattened to a generic string.
   */
  it("surfaces a failed columns read as a typed failure", async () => {
    from.mockImplementation(
      columnsChain({ data: null, error: { message: "db down" } }),
    );
    const res = await getStatusColumnsForBoard(BOARD_ID);
    expect(res).toEqual({
      ok: false,
      error: "Failed to load status columns: db down",
    });
  });
});
