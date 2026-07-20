import { describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  createEmbeddingClient,
  type EmbeddingsApi,
} from "./client";

function fakeApi(): { api: EmbeddingsApi; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(
    async ({ input }: { model: string; input: string[] }) => ({
      // one deterministic 1536-length vector per input text
      data: input.map((_t, i) => ({
        embedding: Array.from({ length: EMBEDDING_DIM }, () => i + 1),
      })),
      usage: { prompt_tokens: input.length * 3 },
    }),
  );
  return { api: { create }, create };
}

describe("createEmbeddingClient", () => {
  it("maps N texts → N vectors of the model dimension in one batched call", async () => {
    const { api, create } = fakeApi();
    const client = createEmbeddingClient(api);

    const { vectors, inputTokens, model } = await client.embed(["a", "b"]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      input: ["a", "b"],
    });
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(EMBEDDING_DIM);
    expect(vectors[1]).toHaveLength(EMBEDDING_DIM);
    expect(inputTokens).toBe(6);
    expect(model).toBe(EMBEDDING_MODEL);
  });

  it("short-circuits an empty batch without touching the API (no network)", async () => {
    const { api, create } = fakeApi();
    const client = createEmbeddingClient(api);

    const res = await client.embed([]);

    expect(create).not.toHaveBeenCalled();
    expect(res).toEqual({
      vectors: [],
      inputTokens: 0,
      model: EMBEDDING_MODEL,
    });
  });

  it("honors an overridden model id (future Voyage swap seam)", async () => {
    const { api, create } = fakeApi();
    const client = createEmbeddingClient(api, "voyage-3.5-lite");

    const { model } = await client.embed(["x"]);

    expect(create).toHaveBeenCalledWith({
      model: "voyage-3.5-lite",
      input: ["x"],
    });
    expect(model).toBe("voyage-3.5-lite");
  });
});
