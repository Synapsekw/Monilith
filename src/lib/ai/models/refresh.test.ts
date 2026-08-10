import { describe, expect, it, vi } from "vitest";
import { refreshCatalog } from "@/lib/ai/models/refresh";

/** In-memory stand-in for the two tables refreshCatalog touches. */
function fakeClient(existing: string[]) {
  const state = { upserted: [] as unknown[], retiredIds: [] as string[] };
  const client = {
    from(table: string) {
      if (table === "ai_providers")
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: [
                  {
                    id: "anthropic",
                    label: "Anthropic",
                    adapter_kind: "anthropic",
                    base_url: null,
                    key_placeholder: "sk-ant-…",
                    key_format: "^sk-ant-",
                    enabled: true,
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      return {
        upsert: async (rows: unknown[]) => {
          state.upserted.push(...rows);
          return { error: null };
        },
        update: () => ({
          lt: () => ({
            eq: async () => {
              state.retiredIds.push(...existing);
              return { error: null };
            },
          }),
        }),
      };
    },
  };
  return { client, state };
}

const FEED = {
  data: [
    {
      id: "anthropic/claude-sonnet-5",
      owned_by: "anthropic",
      name: "Claude Sonnet 5",
      type: "language",
      tags: ["tool-use"],
      context_window: 1000000,
      max_tokens: 64000,
      pricing: { input: "0.000003", output: "0.000015" },
    },
  ],
};

describe("refreshCatalog", () => {
  it("upserts parsed rows and retires anything not seen", async () => {
    const { client, state } = fakeClient(["stale-model"]);
    const res = await refreshCatalog({
      fetchFeed: async () => FEED,
      client: client as never,
    });
    expect(res.skipped).toBe(false);
    expect(res.upserted).toBe(1);
    expect(state.upserted).toHaveLength(1);
  });

  it("SKIPS everything when the feed is empty — a gateway outage must not retire the catalog", async () => {
    const { client, state } = fakeClient(["claude-sonnet-5"]);
    const res = await refreshCatalog({
      fetchFeed: async () => ({ data: [] }),
      client: client as never,
    });
    expect(res.skipped).toBe(true);
    expect(res.retired).toBe(0);
    expect(state.retiredIds).toEqual([]);
    expect(state.upserted).toEqual([]);
  });

  it("SKIPS when the fetch throws rather than propagating", async () => {
    const { client, state } = fakeClient(["claude-sonnet-5"]);
    const res = await refreshCatalog({
      fetchFeed: async () => {
        throw new Error("gateway 503");
      },
      client: client as never,
    });
    expect(res.skipped).toBe(true);
    expect(state.upserted).toEqual([]);
  });

  it("SKIPS when the payload is malformed", async () => {
    const { client } = fakeClient([]);
    const res = await refreshCatalog({
      fetchFeed: async () => ({ unexpected: true }),
      client: client as never,
    });
    expect(res.skipped).toBe(true);
  });
});
