import { beforeEach, describe, expect, it, vi } from "vitest";

const runEmbedding = vi.fn();
const embed = vi.fn();
vi.mock("@/lib/ai/gateway", () => ({
  runEmbedding: (...a: unknown[]) => runEmbedding(...a),
}));
vi.mock("./client", () => ({
  createEmbeddingClient: () => ({ embed }),
}));
vi.mock("./index-actions", () => ({
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

import { semanticSearchCore } from "./semantic-core";

beforeEach(() => {
  runEmbedding.mockReset();
  embed.mockReset();
  embed.mockResolvedValue({
    vectors: [[0.1, 0.2]],
    inputTokens: 3,
    model: "m",
  });
  runEmbedding.mockImplementation(async (_args, fn) => (await fn()).result);
});

const HIT = {
  item_id: "i1",
  name: "Vendor contract",
  board_id: "b1",
  board_name: "Legal",
};

describe("semanticSearchCore", () => {
  it("meters the embed call for the given org and user, then scopes the match", async () => {
    const rpc = vi.fn(async () => ({ data: [HIT], error: null }));
    const res = await semanticSearchCore({ rpc } as never, {
      orgId: "o1",
      userId: "u1",
      query: "supplier agreement",
      boardIds: ["b1", "b2"],
    });
    expect(runEmbedding).toHaveBeenCalledWith(
      { orgId: "o1", userId: "u1", feature: "semantic_query" },
      expect.any(Function),
    );
    expect(rpc).toHaveBeenCalledWith("match_items", {
      p_query_embedding: "[0.1,0.2]",
      p_limit: 20,
      p_org_id: "o1",
      p_board_ids: ["b1", "b2"],
    });
    expect(res).toEqual({
      ok: true,
      items: [
        {
          id: "i1",
          name: "Vendor contract",
          boardId: "b1",
          boardName: "Legal",
        },
      ],
    });
  });

  it("returns ok:false when the embed call is refused", async () => {
    runEmbedding.mockRejectedValue(new Error("AI is not available"));
    const rpc = vi.fn();
    const res = await semanticSearchCore({ rpc } as never, {
      orgId: "o1",
      userId: "u1",
      query: "anything",
    });
    expect(res).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns ok:false when the match RPC errors", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const res = await semanticSearchCore({ rpc } as never, {
      orgId: "o1",
      userId: "u1",
      query: "anything",
    });
    expect(res).toEqual({ ok: false });
  });
});
