import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingClient } from "./client";

// runEmbedding is exercised end-to-end in gateway.test.ts; here we stub it to a
// pass-through that records the args, so we can assert embedTexts wires the
// client + input-only usage correctly without the service-client/entitlement chain.
const runEmbedding = vi.fn(
  async (
    _args: { orgId: string; userId: string; feature: string },
    fn: () => Promise<{ result: unknown; usage: unknown; model: string }>,
  ) => (await fn()).result,
);
vi.mock("@/lib/ai/gateway", () => ({
  runEmbedding: (...a: unknown[]) =>
    (runEmbedding as (...x: unknown[]) => unknown)(...a),
}));

beforeEach(() => vi.clearAllMocks());

describe("toVectorLiteral", () => {
  it("serializes to pgvector text form", async () => {
    const { toVectorLiteral } = await import("./index-actions");
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
    expect(toVectorLiteral([])).toBe("[]");
  });
});

describe("embedTexts", () => {
  it("meters an input-only call and returns the vectors + model", async () => {
    const client: EmbeddingClient = {
      embed: vi.fn(async (texts: string[]) => ({
        vectors: texts.map(() => [1, 2, 3]),
        inputTokens: 42,
        model: "text-embedding-3-small",
      })),
    };
    const { embedTexts } = await import("./index-actions");

    const out = await embedTexts(
      { orgId: "org-1", userId: "u-1", feature: "semantic_index" },
      client,
      ["a", "b"],
    );

    expect(client.embed).toHaveBeenCalledWith(["a", "b"]);
    expect(out).toEqual({
      vectors: [
        [1, 2, 3],
        [1, 2, 3],
      ],
      model: "text-embedding-3-small",
    });
    // metered exactly once, input-only (outputTokens 0)
    expect(runEmbedding).toHaveBeenCalledTimes(1);
    const [meterArgs] = runEmbedding.mock.calls[0];
    expect(meterArgs).toEqual({
      orgId: "org-1",
      userId: "u-1",
      feature: "semantic_index",
    });
    const fn = runEmbedding.mock.calls[0][1] as () => Promise<{
      usage: { inputTokens: number; outputTokens: number };
    }>;
    const metered = await fn();
    expect(metered.usage).toEqual({ inputTokens: 42, outputTokens: 0 });
  });
});
