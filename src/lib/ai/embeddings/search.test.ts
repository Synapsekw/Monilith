import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks: no auth, no DB, no real embedding provider ───────────────────────
const requireUser = vi.fn();
const resolveActiveOrg = vi.fn();
const createClient = vi.fn();
const typedRpc = vi.fn();
const embed = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: (...a: unknown[]) => resolveActiveOrg(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...a: unknown[]) => createClient(...a),
}));
vi.mock("@/lib/supabase/typed-rpc", () => ({
  typedRpc: (...a: unknown[]) => typedRpc(...a),
}));
vi.mock("./client", () => ({
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIM: 1536,
  createEmbeddingClient: () => ({ embed: (...a: unknown[]) => embed(...a) }),
}));

// runEmbedding is exercised end-to-end in gateway.test.ts; here we stub it to a
// pass-through that records the metering args, so we can assert the query path
// meters exactly one input-only embed call (feature `semantic_query`) without
// the service-client/entitlement chain.
const runEmbedding = vi.fn(
  async (
    _args: { orgId: string; userId: string | null; feature: string },
    fn: () => Promise<{ result: unknown; usage: unknown; model: string }>,
  ) => (await fn()).result,
);
vi.mock("@/lib/ai/gateway", () => ({
  runEmbedding: (...a: unknown[]) =>
    (runEmbedding as (...x: unknown[]) => unknown)(...a),
}));

import { findSimilarItems, semanticSearchItems } from "./search";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

/** Minimal cookie-client fake: item_embeddings.select(...).eq(...).maybeSingle(). */
function svcWithEmbedding(embedding: string | null, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: embedding === null ? null : { embedding },
            error,
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u1" });
  resolveActiveOrg.mockResolvedValue({ id: "o1" });
  createClient.mockResolvedValue({});
  embed.mockResolvedValue({
    vectors: [[0.1, 0.2]],
    inputTokens: 3,
    model: "text-embedding-3-small",
  });
});

describe("semanticSearchItems", () => {
  it("meters one embed call then one match_items RPC, mapping rows", async () => {
    typedRpc.mockResolvedValue({
      data: [
        { item_id: "i1", name: "Onboarding", board_id: "b1", board_name: "HR" },
      ],
      error: null,
    });

    const res = await semanticSearchItems("new hire");

    expect(embed).toHaveBeenCalledTimes(1);
    expect(runEmbedding).toHaveBeenCalledWith(
      { orgId: "o1", userId: "u1", feature: "semantic_query" },
      expect.any(Function),
    );
    expect(typedRpc).toHaveBeenCalledTimes(1);
    const [, fnName, args] = typedRpc.mock.calls[0] as [
      unknown,
      string,
      { p_query_embedding: string },
    ];
    expect(fnName).toBe("match_items");
    expect(args.p_query_embedding).toBe("[0.1,0.2]");
    expect(res).toEqual([
      { id: "i1", name: "Onboarding", boardId: "b1", boardName: "HR" },
    ]);
  });

  it("returns [] on an RPC error without throwing", async () => {
    typedRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(semanticSearchItems("still valid")).resolves.toEqual([]);
  });

  it("rejects a too-short query with [] and no embed call", async () => {
    expect(await semanticSearchItems("a")).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
    expect(typedRpc).not.toHaveBeenCalled();
  });

  it("returns [] (never throws) when a dependency throws", async () => {
    requireUser.mockRejectedValue(new Error("no session"));
    await expect(semanticSearchItems("hello world")).resolves.toEqual([]);
  });
});

describe("findSimilarItems", () => {
  it("returns not_indexed when the item has no stored embedding", async () => {
    createClient.mockResolvedValue(svcWithEmbedding(null));
    expect(await findSimilarItems(ITEM_ID)).toEqual({ status: "not_indexed" });
    // No query embed — find-similar reuses the item's stored vector (perf budget).
    expect(embed).not.toHaveBeenCalled();
    expect(runEmbedding).not.toHaveBeenCalled();
  });

  it("matches on the stored vector, excluding the item itself", async () => {
    createClient.mockResolvedValue(svcWithEmbedding("[0.1,0.2]"));
    typedRpc.mockResolvedValue({
      data: [
        { item_id: "i2", name: "Similar", board_id: "b1", board_name: "HR" },
      ],
      error: null,
    });

    const res = await findSimilarItems(ITEM_ID);

    expect(res).toEqual({
      status: "ok",
      items: [{ id: "i2", name: "Similar", boardId: "b1", boardName: "HR" }],
    });
    const [, fnName, args] = typedRpc.mock.calls[0] as [
      unknown,
      string,
      { p_query_embedding: string; p_exclude_item_id: string },
    ];
    expect(fnName).toBe("match_items");
    expect(args.p_query_embedding).toBe("[0.1,0.2]");
    expect(args.p_exclude_item_id).toBe(ITEM_ID);
  });

  it("returns an empty ok result on an RPC error without throwing", async () => {
    createClient.mockResolvedValue(svcWithEmbedding("[0.1,0.2]"));
    typedRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(findSimilarItems(ITEM_ID)).resolves.toEqual({
      status: "ok",
      items: [],
    });
  });

  it("returns an empty ok result for an invalid item id", async () => {
    await expect(findSimilarItems("not-a-uuid")).resolves.toEqual({
      status: "ok",
      items: [],
    });
  });
});
