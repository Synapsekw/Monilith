import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getProviderRow = vi.fn();
vi.mock("@/lib/ai/providers/provider-rows", () => ({
  getProviderRow: (...a: unknown[]) => getProviderRow(...a),
}));

import {
  MODEL_LIST_TIMEOUT_MS,
  candidateNativeIds,
  listNativeModelIds,
  matchNativeId,
  verifyProviderModels,
} from "@/lib/ai/models/verify-ids";
import type { ProviderRow } from "@/lib/ai/providers/provider-rows";
import { fakeAiModelsClient, rowOf } from "@/test/ai-models-fake-client";

describe("candidateNativeIds", () => {
  it("always offers the gateway id itself first", () => {
    expect(candidateNativeIds("claude-sonnet-5")[0]).toBe("claude-sonnet-5");
  });

  it("offers a dots-to-hyphens variant, which is the observed anthropic divergence", () => {
    // Gateway says claude-haiku-4.5; Anthropic's own API says claude-haiku-4-5.
    expect(candidateNativeIds("claude-haiku-4.5")).toContain(
      "claude-haiku-4-5",
    );
  });

  it("does not emit duplicates when the id has no dots", () => {
    const c = candidateNativeIds("gpt-4o");
    expect(new Set(c).size).toBe(c.length);
  });
});

describe("matchNativeId", () => {
  it("prefers an exact match over any transformed candidate", () => {
    expect(
      matchNativeId(
        ["claude-haiku-4.5", "claude-haiku-4-5"],
        ["claude-haiku-4.5", "claude-haiku-4-5"],
      ),
    ).toBe("claude-haiku-4.5");
  });

  it("falls back to the transformed candidate when only it exists natively", () => {
    expect(
      matchNativeId(
        ["claude-haiku-4.5", "claude-haiku-4-5"],
        ["claude-haiku-4-5"],
      ),
    ).toBe("claude-haiku-4-5");
  });

  it("matches a dated alias by prefix (claude-haiku-4-5-20251001)", () => {
    expect(
      matchNativeId(["claude-haiku-4-5"], ["claude-haiku-4-5-20251001"]),
    ).toBe("claude-haiku-4-5-20251001");
  });

  it("returns null rather than guessing when nothing matches", () => {
    // Failing closed is the whole point: an unmatched id must be quarantined,
    // never sent to a provider on a hunch.
    expect(matchNativeId(["kimi-k2"], ["moonshot-v1-8k"])).toBeNull();
  });

  it("never matches on a bare prefix that is not a version-suffix alias", () => {
    // "gpt-4" must not match "gpt-4o" — that is a different model.
    expect(matchNativeId(["gpt-4"], ["gpt-4o"])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The impure half.
// ---------------------------------------------------------------------------

function providerRow(overrides: Partial<ProviderRow> = {}): ProviderRow {
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

type FetchCall = {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal | null;
};

function stubFetch(
  responder: (url: string) => { ok: boolean; status?: number; body?: unknown },
) {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      signal: init?.signal ?? null,
    });
    const r = responder(url);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body,
    };
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listNativeModelIds", () => {
  it("reads anthropic ids from data[].id with the version header and x-api-key", async () => {
    const calls = stubFetch(() => ({
      ok: true,
      body: { data: [{ id: "claude-haiku-4-5" }, { id: "claude-sonnet-5" }] },
    }));
    const ids = await listNativeModelIds(providerRow(), "sk-ant-secret");
    expect(ids).toEqual(["claude-haiku-4-5", "claude-sonnet-5"]);
    expect(calls[0].url).toContain("api.anthropic.com/v1/models");
    expect(calls[0].headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0].headers["x-api-key"]).toBe("sk-ant-secret");
  });

  it("strips google's `models/` resource prefix", async () => {
    stubFetch(() => ({
      ok: true,
      body: {
        models: [
          { name: "models/gemini-2.0-flash" },
          { name: "models/gemini-3-pro" },
        ],
      },
    }));
    const ids = await listNativeModelIds(
      providerRow({ id: "google", adapterKind: "google" }),
      "AIzaSECRET",
    );
    expect(ids).toEqual(["gemini-2.0-flash", "gemini-3-pro"]);
  });

  it("builds an openai-compatible url from the row's baseUrl, without a double slash", async () => {
    const calls = stubFetch(() => ({
      ok: true,
      body: { data: [{ id: "k2" }] },
    }));
    await listNativeModelIds(
      providerRow({
        id: "moonshotai",
        adapterKind: "openai-compatible",
        baseUrl: "https://api.moonshot.ai/v1/",
      }),
      "sk-kimi",
    );
    expect(calls[0].url).toBe("https://api.moonshot.ai/v1/models");
  });

  it("throws with the status only — never the url or the key", async () => {
    stubFetch(() => ({ ok: false, status: 401 }));
    await expect(
      listNativeModelIds(
        providerRow({ id: "google", adapterKind: "google" }),
        "AIzaSECRET",
      ),
    ).rejects.toThrow(/HTTP 401/);
    await expect(
      listNativeModelIds(
        providerRow({ id: "google", adapterKind: "google" }),
        "AIzaSECRET",
      ),
    ).rejects.not.toThrow(/AIzaSECRET/);
  });

  it("throws on a payload that is not a model list at all", async () => {
    stubFetch(() => ({ ok: true, body: { unexpected: true } }));
    await expect(
      listNativeModelIds(providerRow(), "sk-ant-x"),
    ).rejects.toThrow();
  });
});

// Every fixture below carries NOISE the query is required to exclude. The fake
// client APPLIES the predicates it records, so deleting `.eq("provider", …)`
// or flipping `.neq("status","retired")` changes the rows returned and these
// assertions fail. That non-vacuity is the whole point: the fake this replaced
// ignored its arguments, and every one of these tests passed against a query
// with no filters at all.

/**
 * Another provider carrying the SAME model_id. Realistic — Bedrock serves
 * Claude under Anthropic's own names — and it is the row that proves both
 * predicates matter: `ai_models` is keyed on `(provider, model_id)`, so a read
 * or an update that forgets `provider` reaches this row too.
 */
const OTHER_PROVIDER_ROW = {
  provider: "bedrock",
  model_id: "claude-sonnet-5",
  native_model_id: null,
  id_verified: false,
  status: "active",
};

/**
 * Retired, and deliberately PRESENT in the native lists the anthropic tests
 * stub — so if `.neq("status","retired")` were dropped it would match, be
 * counted, and be written, changing both the counts and the write set.
 */
const RETIRED_ROW = {
  provider: "anthropic",
  model_id: "claude-legacy-2",
  native_model_id: null,
  id_verified: false,
  status: "retired",
};

/** The anthropic native list every test below stubs, unless it says otherwise. */
function anthropicNativeIds(ids: string[]) {
  return { data: [...ids, RETIRED_ROW.model_id].map((id) => ({ id })) };
}

beforeEach(() => {
  getProviderRow.mockReset();
});

describe("listNativeModelIds · deadline", () => {
  it("defaults to a ten-second deadline", () => {
    expect(MODEL_LIST_TIMEOUT_MS).toBe(10_000);
  });

  it("passes an abort signal to fetch", async () => {
    const calls = stubFetch(() => ({
      ok: true,
      body: { data: [{ id: "claude-sonnet-5" }] },
    }));
    await listNativeModelIds(providerRow(), "sk-ant-x");
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].signal?.aborted).toBe(false);
  });

  it("rejects once the deadline passes, rather than hanging on a stalled provider", async () => {
    // `credentials-actions` used to AWAIT this on the user's save path, and
    // fetch has no deadline of its own — a provider that accepts the
    // connection and then never answers would hold the action open for
    // undici's default. This stub stalls exactly like that, and is aborted by
    // the very signal listNativeModelIds passes in.
    vi.stubGlobal(
      "fetch",
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason ?? new Error("aborted"));
          });
        }),
    );
    await expect(
      listNativeModelIds(providerRow(), "sk-ant-x", 5),
    ).rejects.toThrow(/abort|timeout/i);
  });
});

describe("verifyProviderModels", () => {
  it("reads exactly this provider's non-retired rows — the whole predicate set", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({
      ok: true,
      body: anthropicNativeIds(["claude-sonnet-5"]),
    }));
    const { client, selects } = fakeAiModelsClient([
      { provider: "anthropic", model_id: "claude-sonnet-5" },
      OTHER_PROVIDER_ROW,
      RETIRED_ROW,
    ]);
    await verifyProviderModels({
      client,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(selects).toHaveLength(1);
    expect(selects[0].columns).toBe("model_id, native_model_id, id_verified");
    expect(selects[0].predicates).toEqual([
      { op: "eq", column: "provider", value: "anthropic" },
      { op: "neq", column: "status", value: "retired" },
    ]);
  });

  it("resolves the gateway's dotted id to the provider's hyphenated native id", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({
      ok: true,
      body: anthropicNativeIds(["claude-haiku-4-5", "claude-sonnet-5"]),
    }));
    const { client, table, updates } = fakeAiModelsClient([
      { provider: "anthropic", model_id: "claude-haiku-4.5" },
      { provider: "anthropic", model_id: "claude-sonnet-5" },
      OTHER_PROVIDER_ROW,
      RETIRED_ROW,
    ]);
    const res = await verifyProviderModels({
      client,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    // Two anthropic rows — NOT the bedrock row that shares a model_id, and NOT
    // the retired row, even though both would match the native list.
    expect(res).toEqual({
      verified: 2,
      unverified: 0,
      reachable: true,
      error: null,
    });
    expect(rowOf(table, "anthropic", "claude-haiku-4.5")?.native_model_id).toBe(
      "claude-haiku-4-5",
    );
    expect(updates).toHaveLength(2);
    expect(rowOf(table, "bedrock", "claude-sonnet-5")?.id_verified).toBe(false);
    expect(rowOf(table, "anthropic", "claude-legacy-2")?.id_verified).toBe(
      false,
    );
  });

  it("scopes every write to (provider, model_id), never stamping another provider's same-named row", async () => {
    // `ai_models` is keyed on (provider, model_id). An update that filters on
    // model_id alone would stamp bedrock's claude-sonnet-5 with a native id
    // verified against Anthropic's API — silently wrong, then offered to a
    // picker.
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({
      ok: true,
      body: anthropicNativeIds(["claude-sonnet-5"]),
    }));
    const { client, table, updates } = fakeAiModelsClient([
      { provider: "anthropic", model_id: "claude-sonnet-5" },
      OTHER_PROVIDER_ROW,
    ]);
    await verifyProviderModels({
      client,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].predicates).toEqual([
      { op: "eq", column: "provider", value: "anthropic" },
      { op: "eq", column: "model_id", value: "claude-sonnet-5" },
    ]);
    // The predicates matched ONE row, and it is the anthropic one.
    expect(updates[0].matched).toBe(1);
    expect(updates[0].patch).toMatchObject({
      native_model_id: "claude-sonnet-5",
      id_verified: true,
    });
    const bedrock = rowOf(table, "bedrock", "claude-sonnet-5");
    expect(bedrock?.id_verified).toBe(false);
    expect(bedrock?.native_model_id).toBeNull();
  });

  it("quarantines an unmatched row instead of guessing — it is not written at all", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({
      ok: true,
      body: anthropicNativeIds(["claude-sonnet-5"]),
    }));
    const { client, table, updates } = fakeAiModelsClient([
      { provider: "anthropic", model_id: "claude-sonnet-5" },
      { provider: "anthropic", model_id: "claude-mystery-9" },
      OTHER_PROVIDER_ROW,
      RETIRED_ROW,
    ]);
    const res = await verifyProviderModels({
      client,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({
      verified: 1,
      unverified: 1,
      reachable: true,
      error: null,
    });
    expect(updates.map((u) => u.predicates)).toEqual([
      [
        { op: "eq", column: "provider", value: "anthropic" },
        { op: "eq", column: "model_id", value: "claude-sonnet-5" },
      ],
    ]);
    const mystery = rowOf(table, "anthropic", "claude-mystery-9");
    expect(mystery?.id_verified).toBe(false);
    expect(mystery?.native_model_id).toBeNull();
  });

  /**
   * WHY `reachable` exists at all, stated where it can fail.
   *
   * This function fails CLOSED and QUIETLY: a 401 from a revoked key returns
   * the same `{ verified: 0, unverified: 0 }` as a healthy provider that
   * simply has no catalog rows yet. That is right for the catalog — nothing
   * should be demoted on one bad call — but it made the outcome unreportable.
   * `verifyAllProviders` writes a per-provider health row now, and with only
   * the two counters it would have recorded a week of 401s as "ok", which is
   * a health badge that lies. `reachable` is the one bit that separates "we
   * asked and the provider answered" from "we could not ask".
   */
  it("reports a 401 as UNREACHABLE, so the sweep records a failure rather than a healthy zero", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({ ok: false, status: 401 }));
    const { client, table, updates } = fakeAiModelsClient([
      {
        provider: "anthropic",
        model_id: "claude-sonnet-5",
        native_model_id: "claude-sonnet-5",
        id_verified: true,
      },
    ]);
    const res = await verifyProviderModels({
      client,
      provider: "anthropic",
      apiKey: "sk-ant-revoked",
    });
    expect(res.reachable).toBe(false);
    expect(res.error).toBe("anthropic model list returned HTTP 401");
    // Status only — never the URL (Google's carries the key) or the headers.
    expect(res.error).not.toContain("sk-ant-revoked");
    // Fail-closed is unchanged: nothing was demoted and nothing was written.
    expect(updates).toEqual([]);
    expect(rowOf(table, "anthropic", "claude-sonnet-5")?.id_verified).toBe(
      true,
    );
  });

  it("SKIPS the whole provider when its model list errors — no row is demoted", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({ ok: false, status: 503 }));
    const { client, table, selects, updates } = fakeAiModelsClient([
      {
        provider: "anthropic",
        model_id: "claude-sonnet-5",
        native_model_id: "claude-sonnet-5",
        id_verified: true,
      },
    ]);
    const res = await verifyProviderModels({
      client,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({
      verified: 0,
      unverified: 0,
      reachable: false,
      error: "anthropic model list returned HTTP 503",
    });
    expect(selects).toEqual([]);
    expect(updates).toEqual([]);
    expect(rowOf(table, "anthropic", "claude-sonnet-5")?.id_verified).toBe(
      true,
    );
  });

  it("SKIPS the provider when its model list stalls past the deadline", async () => {
    // The deadline turns a hang into a rejection, and the existing catch turns
    // that rejection into a clean skip — no demotion, no write.
    getProviderRow.mockResolvedValueOnce(providerRow());
    vi.stubGlobal("fetch", () =>
      Promise.reject(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      ),
    );
    const { client, table, selects, updates } = fakeAiModelsClient([
      {
        provider: "anthropic",
        model_id: "claude-sonnet-5",
        native_model_id: "claude-sonnet-5",
        id_verified: true,
      },
    ]);
    const res = await verifyProviderModels({
      client,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({
      verified: 0,
      unverified: 0,
      reachable: false,
      error: expect.stringContaining("aborted"),
    });
    expect(selects).toEqual([]);
    expect(updates).toEqual([]);
    expect(rowOf(table, "anthropic", "claude-sonnet-5")?.id_verified).toBe(
      true,
    );
  });

  it("SKIPS on an empty model list — an outage must not empty the picker", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({ ok: true, body: { data: [] } }));
    const { client, updates } = fakeAiModelsClient([
      {
        provider: "anthropic",
        model_id: "claude-sonnet-5",
        native_model_id: "claude-sonnet-5",
        id_verified: true,
      },
    ]);
    const res = await verifyProviderModels({
      client,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({
      verified: 0,
      unverified: 0,
      reachable: false,
      error: "anthropic returned an empty model list",
    });
    expect(updates).toEqual([]);
  });

  it("never demotes a previously-verified row that this list happens to omit", async () => {
    // Several providers' /models endpoints are incomplete (org-scoped, or
    // omitting aliases); demoting on one call would empty a picker while the
    // provider is perfectly healthy.
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({
      ok: true,
      body: anthropicNativeIds(["claude-sonnet-5"]),
    }));
    const { client, table, updates } = fakeAiModelsClient([
      { provider: "anthropic", model_id: "claude-sonnet-5" },
      {
        provider: "anthropic",
        model_id: "claude-opus-4-8",
        native_model_id: "claude-opus-4-8",
        id_verified: true,
      },
      OTHER_PROVIDER_ROW,
      RETIRED_ROW,
    ]);
    const res = await verifyProviderModels({
      client,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({
      verified: 2,
      unverified: 0,
      reachable: true,
      error: null,
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].predicates).toEqual([
      { op: "eq", column: "provider", value: "anthropic" },
      { op: "eq", column: "model_id", value: "claude-sonnet-5" },
    ]);
    expect(rowOf(table, "anthropic", "claude-opus-4-8")?.id_verified).toBe(
      true,
    );
  });

  it("does nothing for an unknown provider, and never calls out", async () => {
    getProviderRow.mockResolvedValueOnce(null);
    const calls = stubFetch(() => ({ ok: true, body: { data: [] } }));
    const { client, selects, updates } = fakeAiModelsClient([]);
    const res = await verifyProviderModels({
      client,
      provider: "nope",
      apiKey: "sk-x",
    });
    expect(res).toEqual({
      verified: 0,
      unverified: 0,
      reachable: false,
      error: 'provider "nope" is not enabled',
    });
    expect(calls).toEqual([]);
    expect(selects).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("skips a disabled provider row too", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow({ enabled: false }));
    const calls = stubFetch(() => ({ ok: true, body: { data: [] } }));
    const { client, selects } = fakeAiModelsClient([]);
    const res = await verifyProviderModels({
      client,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({
      verified: 0,
      unverified: 0,
      reachable: false,
      error: 'provider "anthropic" is not enabled',
    });
    expect(calls).toEqual([]);
    expect(selects).toEqual([]);
  });

  it("accepts a dated snapshot alias as the native id", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({
      ok: true,
      body: anthropicNativeIds(["claude-haiku-4-5-20251001"]),
    }));
    const { client, table } = fakeAiModelsClient([
      { provider: "anthropic", model_id: "claude-haiku-4.5" },
      OTHER_PROVIDER_ROW,
      RETIRED_ROW,
    ]);
    const res = await verifyProviderModels({
      client,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({
      verified: 1,
      unverified: 0,
      reachable: true,
      error: null,
    });
    expect(rowOf(table, "anthropic", "claude-haiku-4.5")?.native_model_id).toBe(
      "claude-haiku-4-5-20251001",
    );
  });
});
