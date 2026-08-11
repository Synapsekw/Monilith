import { describe, expect, it, vi } from "vitest";
import { refreshCatalog } from "@/lib/ai/models/refresh";

type FakeModelRow = {
  provider: string;
  model_id: string;
  status: string;
  last_seen_at: string;
};

/**
 * In-memory stand-in for `ai_providers` + `ai_models`. The retirement
 * `update()` call is a real chainable builder that CAPTURES the `.in()` /
 * `.lt()` / `.eq()` predicates and applies them against the seeded row set —
 * a prior version of this mock ignored the predicate entirely (pushed a
 * canned list regardless of what was passed), which is why a missing
 * provider scope on the retirement query shipped undetected (finding C1/C1b).
 */
function fakeClient(providerIds: string[], seedRows: FakeModelRow[]) {
  const table = seedRows.map((r) => ({ ...r }));
  const state = {
    upserted: [] as unknown[],
    retireCalls: [] as {
      in: string[] | null;
      lt: string | null;
      eq: string | null;
    }[],
  };

  const client = {
    from(tableName: string) {
      if (tableName === "ai_providers")
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: providerIds.map((id) => ({
                  id,
                  label: id,
                  adapter_kind: "anthropic",
                  base_url: null,
                  key_placeholder: "x",
                  key_format: "^x",
                  enabled: true,
                })),
                error: null,
              }),
            }),
          }),
        };

      // ai_models
      return {
        upsert: async (rows: unknown[]) => {
          state.upserted.push(...rows);
          return { error: null };
        },
        update(patch: { status: string }) {
          const predicate: {
            in: string[] | null;
            lt: string | null;
            eq: string | null;
          } = { in: null, lt: null, eq: null };
          const builder = {
            in(_col: string, vals: string[]) {
              predicate.in = vals;
              return builder;
            },
            lt(_col: string, val: string) {
              predicate.lt = val;
              return builder;
            },
            eq(_col: string, val: string) {
              predicate.eq = val;
              return builder;
            },
            select: async (_cols: string) => {
              state.retireCalls.push({ ...predicate });
              const matches = table.filter(
                (row) =>
                  (predicate.in === null ||
                    predicate.in.includes(row.provider)) &&
                  (predicate.lt === null || row.last_seen_at < predicate.lt) &&
                  (predicate.eq === null || row.status === predicate.eq),
              );
              for (const row of matches) row.status = patch.status;
              return {
                data: matches.map((r) => ({
                  provider: r.provider,
                  model_id: r.model_id,
                })),
                error: null,
              };
            },
          };
          return builder;
        },
      };
    },
  };
  return { client, state, table };
}

const STALE = "2020-01-01T00:00:00.000Z";

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
    const { client, state, table } = fakeClient(
      ["anthropic"],
      [
        {
          provider: "anthropic",
          model_id: "stale-model",
          status: "active",
          last_seen_at: STALE,
        },
      ],
    );
    const verifyIds = vi.fn(async () => {});
    const res = await refreshCatalog({
      fetchFeed: async () => FEED,
      client: client as never,
      verifyIds,
    });
    expect(res.skipped).toBe(false);
    expect(res.upserted).toBe(1);
    expect(state.upserted).toHaveLength(1);
    // Real telemetry, not a hardcoded 0 (finding I1): the one stale row was
    // actually flipped to retired.
    expect(res.retired).toBe(1);
    expect(table.find((r) => r.model_id === "stale-model")?.status).toBe(
      "retired",
    );
    // Fresh GATEWAY ids just landed, so the native-id resolution pass runs.
    expect(verifyIds).toHaveBeenCalledTimes(1);
  });

  it("still reports success when the id-verification pass throws", async () => {
    // The rows are already correct for pricing and an unverified row is simply
    // not offered — a verification failure must never fail the refresh.
    const { client } = fakeClient(
      ["anthropic"],
      [
        {
          provider: "anthropic",
          model_id: "stale-model",
          status: "active",
          last_seen_at: STALE,
        },
      ],
    );
    const res = await refreshCatalog({
      fetchFeed: async () => FEED,
      client: client as never,
      verifyIds: async () => {
        throw new Error("anthropic 500");
      },
    });
    expect(res.skipped).toBe(false);
    expect(res.upserted).toBe(1);
  });

  it("does NOT retire an active row for a provider absent from this run's parsed feed", async () => {
    // The feed this run only contains an anthropic entry (FEED, below). An
    // existing active openai row must be left alone even though it is
    // "not seen" — retirement is scoped to the providers this run actually
    // parsed rows for, not to every enabled provider (finding C1).
    const { client, state, table } = fakeClient(
      ["anthropic"],
      [
        {
          provider: "anthropic",
          model_id: "stale-anthropic-model",
          status: "active",
          last_seen_at: STALE,
        },
        {
          provider: "openai",
          model_id: "gpt-4o",
          status: "active",
          last_seen_at: STALE,
        },
      ],
    );
    const verifyIds = vi.fn(async () => {});
    const res = await refreshCatalog({
      fetchFeed: async () => FEED,
      client: client as never,
      verifyIds,
    });
    expect(res.skipped).toBe(false);
    expect(res.retired).toBe(1);
    expect(state.retireCalls).toHaveLength(1);
    expect(state.retireCalls[0].in).toEqual(["anthropic"]);
    expect(
      table.find((r) => r.model_id === "stale-anthropic-model")?.status,
    ).toBe("retired");
    expect(table.find((r) => r.model_id === "gpt-4o")?.status).toBe("active");
  });

  it("SKIPS everything when the feed is empty — a gateway outage must not retire the catalog", async () => {
    const { client, state, table } = fakeClient(
      ["anthropic"],
      [
        {
          provider: "anthropic",
          model_id: "claude-sonnet-5",
          status: "active",
          last_seen_at: STALE,
        },
      ],
    );
    const verifyIds = vi.fn(async () => {});
    const res = await refreshCatalog({
      fetchFeed: async () => ({ data: [] }),
      client: client as never,
      verifyIds,
    });
    expect(verifyIds).not.toHaveBeenCalled();
    expect(res.skipped).toBe(true);
    expect(res.retired).toBe(0);
    expect(state.retireCalls).toEqual([]);
    expect(state.upserted).toEqual([]);
    expect(table[0].status).toBe("active");
  });

  it("SKIPS when the fetch throws rather than propagating", async () => {
    const { client, state } = fakeClient(
      ["anthropic"],
      [
        {
          provider: "anthropic",
          model_id: "claude-sonnet-5",
          status: "active",
          last_seen_at: STALE,
        },
      ],
    );
    const verifyIds = vi.fn(async () => {});
    const res = await refreshCatalog({
      fetchFeed: async () => {
        throw new Error("gateway 503");
      },
      client: client as never,
      verifyIds,
    });
    expect(verifyIds).not.toHaveBeenCalled();
    expect(res.skipped).toBe(true);
    expect(state.upserted).toEqual([]);
    expect(state.retireCalls).toEqual([]);
  });

  it("SKIPS when the payload is malformed", async () => {
    const { client, state } = fakeClient([], []);
    const verifyIds = vi.fn(async () => {});
    const res = await refreshCatalog({
      fetchFeed: async () => ({ unexpected: true }),
      client: client as never,
      verifyIds,
    });
    expect(verifyIds).not.toHaveBeenCalled();
    expect(res.skipped).toBe(true);
    expect(state.retireCalls).toEqual([]);
  });
});
