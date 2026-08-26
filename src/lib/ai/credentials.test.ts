import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  AiNotConfiguredError,
  PersonalAiKeyMissingError,
} from "@/lib/ai/errors";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc }),
}));

// `credentials.ts` imports requireUser at module scope for
// listMyAiCredentials — mocked so module resolution never hits the real
// cookie-bound implementation. resolveUserAdapterById does not call this at
// all (see the "session-less" test below, which asserts that rather than
// just claiming it in its name).
const requireUser = vi.fn(async () => ({ id: "user-1" }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...(a as [])),
}));

// The RLS self-read behind listMyAiCredentials. `postgrestResult` is what the
// awaited builder resolves to; `queryLog` records the shaping calls so the
// tests can assert the read is ORDERED (all rows, not bounded to one).
const postgrestResult = vi.fn();
const queryLog: { order: unknown[][]; limit: number[] } = {
  order: [],
  limit: [],
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: (...a: unknown[]) => {
          queryLog.order.push(a);
          return Promise.resolve(postgrestResult());
        },
        limit: (n: number) => {
          queryLog.limit.push(n);
          return Promise.resolve(postgrestResult());
        },
      };
      return builder;
    },
  }),
}));

// getProviderRow is consumed by resolveUserAdapterById to find the adapter
// kind + base_url for the requested provider.
const getProviderRow = vi.fn();
vi.mock("@/lib/ai/providers/provider-rows", () => ({
  getProviderRow: (...a: unknown[]) => getProviderRow(...a),
}));

// Adapters are keyed by WIRE FORMAT now; getAdapter(kind) returns a stub
// tagged by kind so tests can assert which one was picked.
vi.mock("@/lib/ai/providers/registry", () => ({
  getAdapter: (kind: string) => ({ kind }),
}));

import {
  resolveUserAdapterById,
  listMyAiCredentials,
  asTrustedUserId,
  maskKey,
  readSweepCredential,
} from "@/lib/ai/credentials";

function providerRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "anthropic",
    label: "Anthropic (Claude)",
    adapterKind: "anthropic",
    baseUrl: null,
    keyPlaceholder: "sk-ant-…",
    keyFormat: "^sk-ant-",
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  rpc.mockReset();
  requireUser.mockClear();
  postgrestResult.mockReset();
  getProviderRow.mockReset();
  queryLog.order = [];
  queryLog.limit = [];
});

describe("maskKey", () => {
  it("keeps a head and the last four, never the middle", () => {
    expect(maskKey("sk-ant-api03-ABCDEFGHIJKLMNOP1234")).toBe("sk-ant-…1234");
  });

  it("handles a short key without throwing", () => {
    expect(maskKey("sk-1234")).toBe("sk-…1234");
  });
});

describe("resolveUserAdapterById", () => {
  it("is session-less: resolves the SUPPLIED id/provider with no requireUser() call", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ provider: "anthropic", secret: "sk-owner" }],
      error: null,
    });
    getProviderRow.mockResolvedValueOnce(providerRow());

    const { adapter, apiKey, baseUrl } = await resolveUserAdapterById(
      asTrustedUserId("owner-9"),
      "anthropic",
    );
    expect(adapter.kind).toBe("anthropic");
    expect(apiKey).toBe("sk-owner");
    expect(baseUrl).toBeNull();
    expect(rpc).toHaveBeenCalledWith("ai_credential_get", {
      p_user: "owner-9",
      p_provider: "anthropic",
    });
    expect(getProviderRow).toHaveBeenCalledWith(expect.anything(), "anthropic");
    // The actual claim the test name makes, asserted rather than assumed.
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("returns the requested provider's baseUrl for an openai-compatible provider", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ provider: "moonshotai", secret: "sk-kimi" }],
      error: null,
    });
    getProviderRow.mockResolvedValueOnce(
      providerRow({
        id: "moonshotai",
        adapterKind: "openai-compatible",
        baseUrl: "https://api.moonshot.ai/v1",
      }),
    );
    const { adapter, apiKey, baseUrl } = await resolveUserAdapterById(
      asTrustedUserId("owner-9"),
      "moonshotai",
    );
    expect(adapter.kind).toBe("openai-compatible");
    expect(apiKey).toBe("sk-kimi");
    expect(baseUrl).toBe("https://api.moonshot.ai/v1");
  });

  it("throws PersonalAiKeyMissingError when that user has no stored key for the requested provider", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    getProviderRow.mockResolvedValueOnce(providerRow());
    await expect(
      resolveUserAdapterById(asTrustedUserId("owner-9"), "anthropic"),
    ).rejects.toBeInstanceOf(PersonalAiKeyMissingError);
  });

  it("throws PersonalAiKeyMissingError when the provider row is unknown", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ provider: "made-up", secret: "sk-x" }],
      error: null,
    });
    getProviderRow.mockResolvedValueOnce(null);
    await expect(
      resolveUserAdapterById(asTrustedUserId("owner-9"), "made-up"),
    ).rejects.toBeInstanceOf(PersonalAiKeyMissingError);
  });

  it("throws PersonalAiKeyMissingError when the provider row is disabled", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ provider: "anthropic", secret: "sk-owner" }],
      error: null,
    });
    getProviderRow.mockResolvedValueOnce(providerRow({ enabled: false }));
    await expect(
      resolveUserAdapterById(asTrustedUserId("owner-9"), "anthropic"),
    ).rejects.toBeInstanceOf(PersonalAiKeyMissingError);
  });

  it("PersonalAiKeyMissingError is still an AiNotConfiguredError, so existing mapAiError/action catches keep matching", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    getProviderRow.mockResolvedValueOnce(providerRow());
    await expect(
      resolveUserAdapterById(asTrustedUserId("owner-9"), "anthropic"),
    ).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it("propagates a raw rpc error unchanged (not wrapped as a config-state error)", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "vault down" },
    });
    getProviderRow.mockResolvedValueOnce(providerRow());
    await expect(
      resolveUserAdapterById(asTrustedUserId("owner-9"), "anthropic"),
    ).rejects.toMatchObject({ message: "vault down" });
  });

  it("resolves only the requested provider even when the rpc mock/data holds others (2-arg rpc call is scoped server-side)", async () => {
    // The 2-arg ai_credential_get(p_user, p_provider) is scoped in SQL, so the
    // resolver simply trusts row [0] of whatever comes back — this asserts it
    // reads that row rather than filtering client-side, matching the real RPC
    // contract of returning at most one row for a given provider.
    rpc.mockResolvedValueOnce({
      data: [{ provider: "anthropic", secret: "sk-anthropic" }],
      error: null,
    });
    getProviderRow.mockResolvedValueOnce(providerRow());
    const { apiKey } = await resolveUserAdapterById(
      asTrustedUserId("owner-9"),
      "anthropic",
    );
    expect(apiKey).toBe("sk-anthropic");
  });
});

describe("listMyAiCredentials", () => {
  it("returns every stored credential, ordered by provider", async () => {
    postgrestResult.mockReturnValueOnce({
      data: [
        {
          provider: "anthropic",
          key_hint: "sk-ant-…AB12",
          updated_at: "2026-08-10T00:00:00Z",
        },
        {
          provider: "moonshotai",
          key_hint: "sk-kimi…BBBB",
          updated_at: "2026-08-09T00:00:00Z",
        },
      ],
      error: null,
    });
    await expect(listMyAiCredentials()).resolves.toEqual([
      {
        provider: "anthropic",
        hint: "sk-ant-…AB12",
        updatedAt: "2026-08-10T00:00:00Z",
      },
      {
        provider: "moonshotai",
        hint: "sk-kimi…BBBB",
        updatedAt: "2026-08-09T00:00:00Z",
      },
    ]);
    expect(queryLog.order).toEqual([["provider"]]);
    // Not bounded — every provider's key is returned, not just one.
    expect(queryLog.limit).toEqual([]);
  });

  it("returns an empty array when the user has no credentials", async () => {
    postgrestResult.mockReturnValueOnce({ data: [], error: null });
    await expect(listMyAiCredentials()).resolves.toEqual([]);
  });

  it("returns an empty array rather than throwing when data is null", async () => {
    postgrestResult.mockReturnValueOnce({ data: null, error: null });
    await expect(listMyAiCredentials()).resolves.toEqual([]);
  });

  it("is a real session read: calls requireUser", async () => {
    postgrestResult.mockReturnValueOnce({ data: [], error: null });
    await listMyAiCredentials();
    expect(requireUser).toHaveBeenCalledTimes(1);
  });
});

/**
 * THE BORROWED-KEY SELECTION RULE. `readSweepCredential` picks ONE user's key
 * to re-verify a provider's model ids with — someone else's credential, spent
 * on the org's behalf. The owner's condition for approving that was that the
 * choice be DETERMINISTIC: the same key on every run over unchanged data, not
 * whichever row Postgres happened to hand back first.
 *
 * `updated_at desc` alone does not deliver that. Two keys saved in the same
 * second — a scripted setup, a bulk import, a coarse clock — tie, and the
 * winner is then whatever order the plan produced. `user_id asc` is the
 * tiebreak that closes it, and until now no test seeded a tie, so deleting that
 * `.order("user_id")` line kept every test green.
 */
function sweepClient(rows: { user_id: string; updated_at: string }[]) {
  const rpcCalls: { p_user: string; p_provider: string }[] = [];
  const client = {
    from() {
      const sorts: { col: "updated_at" | "user_id"; asc: boolean }[] = [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        order(col: "updated_at" | "user_id", opts?: { ascending?: boolean }) {
          sorts.push({ col, asc: opts?.ascending !== false });
          return builder;
        },
        // Array.prototype.sort is STABLE, so with no tiebreak the tied rows
        // come back in seed order — which is exactly how a non-deterministic
        // rule shows itself here.
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
    rpc: async (_fn: string, args: { p_user: string; p_provider: string }) => {
      rpcCalls.push(args);
      return { data: [{ secret: `key-${args.p_user}` }], error: null };
    },
  };
  return { client: client as never, rpcCalls };
}

describe("readSweepCredential", () => {
  it("breaks an updated_at tie deterministically on user_id", async () => {
    const SAME = "2026-08-01T00:00:00Z";
    // Seeded HIGHEST user_id first: without the `user_id` tiebreak the stable
    // sort returns u9 here and u1 below, so the rule would depend on row order.
    const a = sweepClient([
      { user_id: "u9", updated_at: SAME },
      { user_id: "u1", updated_at: SAME },
    ]);
    const b = sweepClient([
      { user_id: "u1", updated_at: SAME },
      { user_id: "u9", updated_at: SAME },
    ]);

    await expect(readSweepCredential(a.client, "mistral")).resolves.toBe(
      "key-u1",
    );
    await expect(readSweepCredential(b.client, "mistral")).resolves.toBe(
      "key-u1",
    );
    expect(a.rpcCalls).toEqual([{ p_user: "u1", p_provider: "mistral" }]);
    expect(b.rpcCalls).toEqual([{ p_user: "u1", p_provider: "mistral" }]);
  });

  it("still prefers the most recently updated key when there is no tie", async () => {
    const { client } = sweepClient([
      { user_id: "u1", updated_at: "2026-08-01T00:00:00Z" },
      { user_id: "u9", updated_at: "2026-08-02T00:00:00Z" },
    ]);
    await expect(readSweepCredential(client, "mistral")).resolves.toBe(
      "key-u9",
    );
  });
});

/**
 * THE ORG-KEY EXCLUSION, PINNED.
 *
 * `readSweepCredential` borrows a PERSONAL key and nothing else. Org BYO keys
 * live in `org_ai_settings.byo_secret_id` and are read only by
 * `resolveAiAdapter`, on a request that belongs to that org — never here. The
 * decision and its reasoning are on the function's own contract comment; this
 * suite is what makes it break loudly if someone quietly "fixes" the gap by
 * adding a fallback.
 *
 * Two things are asserted, because either alone is weak: that no table other
 * than `user_ai_credentials` is touched, and that `org_ai_secret_get` is never
 * called. An org fallback cannot be written without tripping one of them.
 */
function exclusionClient() {
  const tables: string[] = [];
  const rpcs: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return builder;
    },
    rpc: async (fn: string) => {
      rpcs.push(fn);
      return { data: [], error: null };
    },
  };
  return { client: client as never, tables, rpcs };
}

describe("readSweepCredential · org BYO keys are out of scope", () => {
  it("returns null for a provider only an ORG holds a key for — it never falls back to the org secret", async () => {
    const { client, tables, rpcs } = exclusionClient();
    await expect(readSweepCredential(client, "mistral")).resolves.toBeNull();
    // No org_ai_settings read, no org_ai_secret_get decrypt: the org's key is
    // not merely unpreferred here, it is unreachable from this function.
    expect(tables).toEqual(["user_ai_credentials"]);
    expect(rpcs).toEqual([]);
  });

  it("never reaches for an org secret even when a personal key IS found", async () => {
    const { client, rpcCalls } = sweepClient([
      { user_id: "u1", updated_at: "2026-08-01T00:00:00Z" },
    ]);
    await expect(readSweepCredential(client, "mistral")).resolves.toBe(
      "key-u1",
    );
    // Exactly one decrypt, and it is the per-USER one.
    expect(rpcCalls).toEqual([{ p_user: "u1", p_provider: "mistral" }]);
  });
});
