import { describe, it, expect, vi, beforeEach } from "vitest";

const getBoardPayload = vi.fn();
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (...a: unknown[]) => getBoardPayload(...a),
}));

import { fetchBoardPayload } from "./board-payload-action";

const BOARD_ID = "55555555-5555-4555-8555-555555555555";

beforeEach(() => vi.clearAllMocks());

describe("fetchBoardPayload", () => {
  it("returns null for a malformed board id without querying", async () => {
    expect(await fetchBoardPayload("not-a-uuid")).toBeNull();
    expect(getBoardPayload).not.toHaveBeenCalled();
  });

  it("delegates to the bounded getBoardPayload read", async () => {
    getBoardPayload.mockResolvedValue({ board: { id: BOARD_ID } });
    const res = await fetchBoardPayload(BOARD_ID);
    expect(getBoardPayload).toHaveBeenCalledWith(BOARD_ID);
    expect(res).toEqual({ board: { id: BOARD_ID } });
  });

  it("passes through null when the board is no longer visible", async () => {
    getBoardPayload.mockResolvedValue(null);
    expect(await fetchBoardPayload(BOARD_ID)).toBeNull();
  });
});
