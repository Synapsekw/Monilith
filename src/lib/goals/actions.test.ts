import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));
// `cacheLife`/`cacheTag` are imported (not called) by `@/lib/org/queries-cached`,
// which `@/lib/goals/queries` pulls in transitively — a bare
// `{ revalidatePath }` mock makes that import fail to link.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

import { getStatusColumnsForBoard } from "@/lib/goals/actions";

const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const COLUMN_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

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
