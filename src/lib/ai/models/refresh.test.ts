import { describe, expect, it, vi } from "vitest";
import { refreshCatalog, verifyAllProviders } from "@/lib/ai/models/refresh";

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
 *
 * The `upsert` APPLIES too, and that is load-bearing rather than tidy. The
 * upsert is what stamps `last_seen_at` on every row this run saw, and the
 * retirement's `.lt("last_seen_at", seenAt)` is what spares those rows. With
 * a write-only upsert (the prior version just pushed the payload aside),
 * every seeded row stayed stale forever, so `.lt` was never discriminated and
 * dropping `last_seen_at` from the upsert payload — which retires the ENTIRE
 * catalog on the next healthy run — kept the suite green.
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
        // Real upsert semantics on the composite key (provider, model_id):
        // merge into the existing row, insert when there is none. A payload
        // that omits `last_seen_at` therefore LEAVES the old value in place,
        // exactly as Postgres would.
        upsert: async (rows: unknown[]) => {
          state.upserted.push(...rows);
          for (const raw of rows) {
            const row = raw as Record<string, unknown> & {
              provider: string;
              model_id: string;
            };
            const existing = table.find(
              (r) => r.provider === row.provider && r.model_id === row.model_id,
            );
            if (existing) {
              Object.assign(existing, row);
              continue;
            }
            table.push({
              provider: row.provider,
              model_id: row.model_id,
              status: typeof row.status === "string" ? row.status : "active",
              last_seen_at:
                typeof row.last_seen_at === "string" ? row.last_seen_at : "",
            });
          }
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

const statusOf = (table: FakeModelRow[], modelId: string) =>
  table.find((r) => r.model_id === modelId)?.status;

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
    // The CONTENT of the upsert, not just its length: a payload that carried
    // the wrong columns would satisfy a length check and still be wrong.
    expect(state.upserted[0]).toMatchObject({
      provider: "anthropic",
      model_id: "claude-sonnet-5",
      gateway_id: "anthropic/claude-sonnet-5",
      status: "active",
    });
    // Real telemetry, not a hardcoded 0 (finding I1): the one stale row was
    // actually flipped to retired.
    expect(res.retired).toBe(1);
    expect(statusOf(table, "stale-model")).toBe("retired");
    // Fresh GATEWAY ids just landed, so the native-id resolution pass runs.
    expect(verifyIds).toHaveBeenCalledTimes(1);
  });

  /**
   * The retirement predicate, made observable — this is the single most
   * destructive statement on the branch, and until now nothing discriminated
   * any part of it.
   *
   * Three seeded rows, each of which only survives because of ONE clause:
   *
   *   claude-sonnet-5   IS in this run's feed. It survives only because the
   *                     upsert stamped `last_seen_at: seenAt` on it and
   *                     `.lt("last_seen_at", seenAt)` then excludes it. Drop
   *                     that one property from the upsert payload in
   *                     refresh.ts and every model in the catalog is retired
   *                     on the next perfectly healthy run — every picker in
   *                     the product empties at once.
   *   stale-model       is NOT in the feed. The one row that should flip.
   *   already-retired   is not in the feed either, but is already `retired`.
   *                     `.eq("status", "active")` is what keeps it out of the
   *                     returned set, so `res.retired` stays honest instead of
   *                     re-reporting settled rows as fresh retirements.
   */
  it("retires only rows this run did NOT see, and only ones still active", async () => {
    const { client, state, table } = fakeClient(
      ["anthropic"],
      [
        {
          provider: "anthropic",
          model_id: "claude-sonnet-5",
          status: "active",
          last_seen_at: STALE,
        },
        {
          provider: "anthropic",
          model_id: "stale-model",
          status: "active",
          last_seen_at: STALE,
        },
        {
          provider: "anthropic",
          model_id: "already-retired",
          status: "retired",
          last_seen_at: STALE,
        },
      ],
    );
    const res = await refreshCatalog({
      fetchFeed: async () => FEED,
      client: client as never,
      verifyIds: async () => {},
    });

    // The upsert re-stamped the seen row's freshness…
    const seen = table.find((r) => r.model_id === "claude-sonnet-5")!;
    expect(seen.last_seen_at).not.toBe(STALE);
    expect(Number.isNaN(Date.parse(seen.last_seen_at))).toBe(false);
    // …and the retirement pass used that same instant as its cutoff.
    expect(state.retireCalls).toHaveLength(1);
    expect(state.retireCalls[0].lt).toBe(seen.last_seen_at);

    expect(statusOf(table, "claude-sonnet-5")).toBe("active");
    expect(statusOf(table, "stale-model")).toBe("retired");
    // Exactly one row changed hands, so the count reported to the cron log is
    // the number of models that actually left the pickers this run — the
    // already-retired row is excluded by the status clause, not counted again.
    expect(res.retired).toBe(1);
    expect(state.retireCalls[0].eq).toBe("active");
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

// ---------------------------------------------------------------------------
// verifyAllProviders — the daily per-provider re-verification sweep.
// ---------------------------------------------------------------------------

const ADAPTER_KIND: Record<string, string> = {
  anthropic: "anthropic",
  google: "google",
  mistral: "openai-compatible",
};

/** The enabled registry every sweep test runs against. */
const ENABLED = ["anthropic", "google", "mistral"];

/**
 * A service-role client holding `ai_providers` plus a `user_ai_credentials`
 * table seeded with one row per entry of `credentialProviders` (repeat a
 * provider to give it several users' keys). Rows get ASCENDING `updated_at` in
 * argument order, so the LAST entry for a provider is its most recently
 * updated credential — which is the one the selection rule must pick.
 *
 * The credential read is NOT stubbed: these tests drive the real
 * `readSweepCredential` through this fake so the ordering, the `limit(1)` and
 * the decrypt RPC are all actually exercised. `rpcCalls` records every decrypt
 * so "at most one credential per provider per run" is observable rather than
 * asserted by hand-waving. Only the network call (`verify`) is faked.
 */
function fakeSvcWithCredentials(
  credentialProviders: string[],
  enabled: string[] = ENABLED,
) {
  const creds = credentialProviders.map((provider, i) => ({
    user_id: `u${i + 1}`,
    provider,
    updated_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
  }));
  const rpcCalls: { p_user: string; p_provider: string }[] = [];

  const client = {
    from(table: string) {
      if (table === "ai_providers")
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: enabled.map((id) => ({
                  id,
                  label: id,
                  adapter_kind: ADAPTER_KIND[id],
                  base_url:
                    ADAPTER_KIND[id] === "openai-compatible"
                      ? `https://api.${id}.ai/v1`
                      : null,
                  key_placeholder: "x",
                  key_format: "^x",
                  enabled: true,
                })),
                error: null,
              }),
            }),
          }),
        };

      if (table !== "user_ai_credentials")
        throw new Error(`unexpected table "${table}"`);

      // PostgREST semantics that matter to the selection rule: `.eq` filters,
      // successive `.order` calls compose (first call is the PRIMARY key), and
      // `.limit(n)` resolves the query.
      let rows = creds.map((r) => ({ ...r }));
      const sorts: { col: "updated_at" | "user_id"; asc: boolean }[] = [];
      const builder = {
        select: () => builder,
        eq(col: "provider", val: string) {
          rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        order(col: "updated_at" | "user_id", opts?: { ascending?: boolean }) {
          sorts.push({ col, asc: opts?.ascending !== false });
          return builder;
        },
        limit: async (n: number) => {
          const sorted = [...rows].sort((a, b) => {
            for (const s of sorts) {
              if (a[s.col] === b[s.col]) continue;
              return (a[s.col] < b[s.col] ? -1 : 1) * (s.asc ? 1 : -1);
            }
            return 0;
          });
          return { data: sorted.slice(0, n), error: null };
        },
      };
      return builder;
    },
    rpc: async (
      _fn: string,
      args: { p_user: string; p_provider: string },
    ): Promise<{
      data: { provider: string; secret: string }[];
      error: null;
    }> => {
      rpcCalls.push(args);
      const row = creds.find(
        (c) => c.user_id === args.p_user && c.provider === args.p_provider,
      );
      return {
        data: row
          ? [{ provider: row.provider, secret: `key-${row.user_id}` }]
          : [],
        error: null,
      };
    },
  };

  return { client, rpcCalls, creds };
}

/** No platform key anywhere, so every test states its own key sources rather
 *  than inheriting whatever ANTHROPIC_API_KEY the ambient env happens to hold. */
const noPlatformKey = () => undefined;

describe("verifyAllProviders", () => {
  it("verifies every provider that has a stored credential, not just anthropic", async () => {
    // Two providers hold a key; google holds none.
    const { client } = fakeSvcWithCredentials(["anthropic", "mistral"]);
    const verified: string[] = [];
    await verifyAllProviders(client as never, {
      platformKey: noPlatformKey,
      verify: async ({ provider }) => {
        verified.push(provider);
        return { verified: 1, unverified: 0 };
      },
    });
    expect(verified.sort()).toEqual(["anthropic", "mistral"]);
  });

  it("skips a provider nobody has connected rather than calling it keyless", async () => {
    const { client, rpcCalls } = fakeSvcWithCredentials(["mistral"]);
    const verified: string[] = [];
    await verifyAllProviders(client as never, {
      platformKey: noPlatformKey,
      verify: async ({ provider }) => {
        verified.push(provider);
        return { verified: 0, unverified: 0 };
      },
    });
    expect(verified).toEqual(["mistral"]);
    // google and anthropic were never even decrypted — no key, no read.
    expect(rpcCalls.map((c) => c.p_provider)).toEqual(["mistral"]);
  });

  it("uses at most one credential per provider, deterministically the most recently updated", async () => {
    // Two users hold a Mistral key. u2's is the newer one.
    const { client, rpcCalls } = fakeSvcWithCredentials(["mistral", "mistral"]);
    const calls: { provider: string; apiKey: string }[] = [];
    await verifyAllProviders(client as never, {
      platformKey: noPlatformKey,
      verify: async ({ provider, apiKey }) => {
        calls.push({ provider, apiKey });
        return { verified: 0, unverified: 0 };
      },
    });
    expect(calls).toEqual([{ provider: "mistral", apiKey: "key-u2" }]);
    // One decrypt, one outbound call: the sweep borrows exactly one key per
    // provider per run, and the same one on every run over unchanged data.
    expect(rpcCalls).toEqual([{ p_user: "u2", p_provider: "mistral" }]);
  });

  it("prefers the platform key over any user's stored credential", async () => {
    const { client, rpcCalls } = fakeSvcWithCredentials([
      "anthropic",
      "mistral",
    ]);
    const calls: { provider: string; apiKey: string }[] = [];
    await verifyAllProviders(client as never, {
      platformKey: (p) =>
        p === "anthropic" ? "platform-anthropic" : undefined,
      verify: async ({ provider, apiKey }) => {
        calls.push({ provider, apiKey });
        return { verified: 0, unverified: 0 };
      },
    });
    expect(calls.find((c) => c.provider === "anthropic")?.apiKey).toBe(
      "platform-anthropic",
    );
    // Nobody's anthropic key was touched — a platform key borrows nothing.
    expect(rpcCalls.map((c) => c.p_provider)).toEqual(["mistral"]);
  });

  it("one provider failing does not abort the others", async () => {
    const { client } = fakeSvcWithCredentials(["anthropic", "mistral"]);
    const verified: string[] = [];
    await verifyAllProviders(client as never, {
      platformKey: noPlatformKey,
      verify: async ({ provider }) => {
        // A revoked key on one provider — the everyday failure this sweep must
        // survive, since the credentials are users' own.
        if (provider === "anthropic") throw new Error("401");
        verified.push(provider);
        return { verified: 0, unverified: 0 };
      },
    });
    expect(verified).toEqual(["mistral"]);
  });

  it("a credential read that throws skips only that provider", async () => {
    const { client } = fakeSvcWithCredentials(["anthropic", "mistral"]);
    const verified: string[] = [];
    await verifyAllProviders(client as never, {
      platformKey: noPlatformKey,
      readKey: async (_c, provider) => {
        if (provider === "anthropic") throw new Error("vault unavailable");
        return provider === "mistral" ? "key-u2" : null;
      },
      verify: async ({ provider }) => {
        verified.push(provider);
        return { verified: 0, unverified: 0 };
      },
    });
    expect(verified).toEqual(["mistral"]);
  });

  it("returns quietly when the provider registry itself is unreadable", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => ({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    };
    const verify = vi.fn();
    await expect(
      verifyAllProviders(client as never, {
        platformKey: noPlatformKey,
        verify,
      }),
    ).resolves.toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
  });
});
