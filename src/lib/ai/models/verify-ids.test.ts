import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getProviderRow = vi.fn();
vi.mock("@/lib/ai/providers/provider-rows", () => ({
  getProviderRow: (...a: unknown[]) => getProviderRow(...a),
}));

import {
  candidateNativeIds,
  listNativeModelIds,
  matchNativeId,
  verifyProviderModels,
} from "@/lib/ai/models/verify-ids";
import type { ProviderRow } from "@/lib/ai/providers/provider-rows";

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

type FetchCall = { url: string; headers: Record<string, string> };

function stubFetch(
  responder: (url: string) => { ok: boolean; status?: number; body?: unknown },
) {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
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

type FakeCatalogRow = {
  model_id: string;
  native_model_id: string | null;
  id_verified: boolean;
};

function fakeClient(rows: FakeCatalogRow[]) {
  const table = rows.map((r) => ({ ...r }));
  const writes: { modelId: string; patch: Record<string, unknown> }[] = [];
  const client = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            neq: async () => ({
              data: table.map((r) => ({ ...r })),
              error: null,
            }),
          }),
        }),
        update(patch: Record<string, unknown>) {
          const builder = {
            eq(col: string, val: string) {
              if (col === "model_id") {
                writes.push({ modelId: val, patch });
                const row = table.find((r) => r.model_id === val);
                if (row) {
                  row.native_model_id = patch.native_model_id as string;
                  row.id_verified = true;
                }
                return Promise.resolve({ error: null });
              }
              return builder;
            },
          };
          return builder;
        },
      };
    },
  };
  return { client, table, writes };
}

beforeEach(() => {
  getProviderRow.mockReset();
});

describe("verifyProviderModels", () => {
  it("resolves the gateway's dotted id to the provider's hyphenated native id", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({
      ok: true,
      body: { data: [{ id: "claude-haiku-4-5" }, { id: "claude-sonnet-5" }] },
    }));
    const { client, table, writes } = fakeClient([
      {
        model_id: "claude-haiku-4.5",
        native_model_id: null,
        id_verified: false,
      },
      {
        model_id: "claude-sonnet-5",
        native_model_id: null,
        id_verified: false,
      },
    ]);
    const res = await verifyProviderModels({
      client: client as never,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({ verified: 2, unverified: 0 });
    expect(
      table.find((r) => r.model_id === "claude-haiku-4.5")?.native_model_id,
    ).toBe("claude-haiku-4-5");
    expect(writes).toHaveLength(2);
  });

  it("quarantines an unmatched row instead of guessing — it is not written at all", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({
      ok: true,
      body: { data: [{ id: "claude-sonnet-5" }] },
    }));
    const { client, table, writes } = fakeClient([
      {
        model_id: "claude-sonnet-5",
        native_model_id: null,
        id_verified: false,
      },
      {
        model_id: "claude-mystery-9",
        native_model_id: null,
        id_verified: false,
      },
    ]);
    const res = await verifyProviderModels({
      client: client as never,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({ verified: 1, unverified: 1 });
    expect(writes.map((w) => w.modelId)).toEqual(["claude-sonnet-5"]);
    const mystery = table.find((r) => r.model_id === "claude-mystery-9");
    expect(mystery?.id_verified).toBe(false);
    expect(mystery?.native_model_id).toBeNull();
  });

  it("SKIPS the whole provider when its model list errors — no row is demoted", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({ ok: false, status: 503 }));
    const { client, table, writes } = fakeClient([
      {
        model_id: "claude-sonnet-5",
        native_model_id: "claude-sonnet-5",
        id_verified: true,
      },
    ]);
    const res = await verifyProviderModels({
      client: client as never,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({ verified: 0, unverified: 0 });
    expect(writes).toEqual([]);
    expect(table[0].id_verified).toBe(true);
  });

  it("SKIPS on an empty model list — an outage must not empty the picker", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({ ok: true, body: { data: [] } }));
    const { client, writes } = fakeClient([
      {
        model_id: "claude-sonnet-5",
        native_model_id: "claude-sonnet-5",
        id_verified: true,
      },
    ]);
    const res = await verifyProviderModels({
      client: client as never,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({ verified: 0, unverified: 0 });
    expect(writes).toEqual([]);
  });

  it("never demotes a previously-verified row that this list happens to omit", async () => {
    // Several providers' /models endpoints are incomplete (org-scoped, or
    // omitting aliases); demoting on one call would empty a picker while the
    // provider is perfectly healthy.
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({
      ok: true,
      body: { data: [{ id: "claude-sonnet-5" }] },
    }));
    const { client, table, writes } = fakeClient([
      {
        model_id: "claude-sonnet-5",
        native_model_id: null,
        id_verified: false,
      },
      {
        model_id: "claude-opus-4-8",
        native_model_id: "claude-opus-4-8",
        id_verified: true,
      },
    ]);
    const res = await verifyProviderModels({
      client: client as never,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({ verified: 2, unverified: 0 });
    expect(writes.map((w) => w.modelId)).toEqual(["claude-sonnet-5"]);
    expect(
      table.find((r) => r.model_id === "claude-opus-4-8")?.id_verified,
    ).toBe(true);
  });

  it("does nothing for an unknown or disabled provider, and never calls out", async () => {
    getProviderRow.mockResolvedValueOnce(null);
    const calls = stubFetch(() => ({ ok: true, body: { data: [] } }));
    const { client } = fakeClient([]);
    const res = await verifyProviderModels({
      client: client as never,
      provider: "nope",
      apiKey: "sk-x",
    });
    expect(res).toEqual({ verified: 0, unverified: 0 });
    expect(calls).toEqual([]);
  });

  it("skips a disabled provider row too", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow({ enabled: false }));
    const calls = stubFetch(() => ({ ok: true, body: { data: [] } }));
    const { client } = fakeClient([]);
    const res = await verifyProviderModels({
      client: client as never,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({ verified: 0, unverified: 0 });
    expect(calls).toEqual([]);
  });

  it("accepts a dated snapshot alias as the native id", async () => {
    getProviderRow.mockResolvedValueOnce(providerRow());
    stubFetch(() => ({
      ok: true,
      body: { data: [{ id: "claude-haiku-4-5-20251001" }] },
    }));
    const { client, table } = fakeClient([
      {
        model_id: "claude-haiku-4.5",
        native_model_id: null,
        id_verified: false,
      },
    ]);
    const res = await verifyProviderModels({
      client: client as never,
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(res).toEqual({ verified: 1, unverified: 0 });
    expect(table[0].native_model_id).toBe("claude-haiku-4-5-20251001");
  });
});
