import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Verification is a live third-party round-trip, so it is handed to `after`
// instead of being awaited on the response path — a provider that stalls must
// not hold the user's "Save key" open. `after` throws outside a Next request
// scope, so a direct saveAiKey() call in a unit test can never run the real
// one; capturing the tasks IS the assertion that the work was deferred
// (same shape as src/app/api/ask/route.test.ts).
const { afterTasks } = vi.hoisted(() => ({
  afterTasks: [] as (() => Promise<void>)[],
}));
vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: () => Promise<void>) => void afterTasks.push(task),
  };
});

// The provider is validated against the ai_providers TABLE now, not a
// hardcoded enum — getProviderRow is the seam credentials-actions reads it
// through.
const getProviderRow = vi.fn();
vi.mock("@/lib/ai/providers/provider-rows", () => ({
  getProviderRow: (...a: unknown[]) => getProviderRow(...a),
}));

// The adapter no longer carries the key format — that is per-PROVIDER
// metadata (`ai_providers.key_format`), read off the row and applied by the
// action itself.
const validateKey = vi.fn();
vi.mock("@/lib/ai/providers/registry", () => ({
  getAdapter: (kind: string) => ({
    kind,
    validateKey: (...a: unknown[]) => validateKey(...a),
  }),
}));

// Saving a key is also the moment this provider's catalog rows can be
// resolved to provider-native ids — the key is the only thing that can ask.
const verifyProviderModels = vi.fn();
vi.mock("@/lib/ai/models/verify-ids", () => ({
  verifyProviderModels: (...a: unknown[]) => verifyProviderModels(...a),
}));

import { ProviderAuthError } from "@/lib/ai/providers/types";
import { saveAiKey, removeAiKey } from "@/lib/ai/credentials-actions";

function anthropicRow(overrides: Partial<Record<string, unknown>> = {}) {
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
  validateKey.mockReset();
  getProviderRow.mockReset();
  verifyProviderModels.mockReset();
  verifyProviderModels.mockResolvedValue({ verified: 0, unverified: 0 });
  afterTasks.length = 0;
});

describe("saveAiKey", () => {
  it("rejects a too-short key without ever looking up the provider row", async () => {
    const res = await saveAiKey({ provider: "anthropic", key: "short" });
    expect(res.ok).toBe(false);
    expect(getProviderRow).not.toHaveBeenCalled();
    expect(validateKey).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails cleanly for a provider not present in ai_providers", async () => {
    getProviderRow.mockResolvedValueOnce(null);
    const res = await saveAiKey({
      provider: "not-a-real-provider",
      key: "sk-something-long-enough",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Unknown provider.");
    expect(validateKey).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails cleanly for a disabled provider row", async () => {
    getProviderRow.mockResolvedValueOnce(anthropicRow({ enabled: false }));
    const res = await saveAiKey({
      provider: "anthropic",
      key: "sk-ant-abcdefAB12",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Unknown provider.");
    expect(validateKey).not.toHaveBeenCalled();
  });

  it("rejects a badly-formatted key (per the row's keyFormat) without calling the provider or DB", async () => {
    getProviderRow.mockResolvedValueOnce(anthropicRow());
    const res = await saveAiKey({
      provider: "anthropic",
      key: "wrong-prefix-key",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/doesn't look like/i);
    expect(validateKey).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails cleanly when the provider rejects the key", async () => {
    getProviderRow.mockResolvedValueOnce(anthropicRow());
    validateKey.mockRejectedValueOnce(new ProviderAuthError("anthropic"));
    const res = await saveAiKey({ provider: "anthropic", key: "sk-ant-bad" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/rejected/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails cleanly when validateKey throws something other than ProviderAuthError", async () => {
    getProviderRow.mockResolvedValueOnce(anthropicRow());
    validateKey.mockRejectedValueOnce(new Error("network blip"));
    const res = await saveAiKey({
      provider: "anthropic",
      key: "sk-ant-abcdefAB12",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/couldn't verify/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the row's baseUrl through to validateKey (non-native providers)", async () => {
    getProviderRow.mockResolvedValueOnce(
      anthropicRow({
        id: "moonshotai",
        label: "Moonshot AI (Kimi)",
        adapterKind: "openai-compatible",
        baseUrl: "https://api.moonshot.ai/v1",
        keyFormat: "^sk-",
      }),
    );
    validateKey.mockResolvedValueOnce(undefined);
    rpc.mockResolvedValueOnce({ error: null });
    await saveAiKey({ provider: "moonshotai", key: "sk-kimi-abcdefgh12" });
    expect(validateKey).toHaveBeenCalledWith({
      apiKey: "sk-kimi-abcdefgh12",
      baseUrl: "https://api.moonshot.ai/v1",
    });
  });

  it("stores a valid key and returns the hint, never the key", async () => {
    getProviderRow.mockResolvedValueOnce(anthropicRow());
    validateKey.mockResolvedValueOnce(undefined);
    rpc.mockResolvedValueOnce({ error: null });
    const res = await saveAiKey({
      provider: "anthropic",
      key: "sk-ant-abcdefAB12",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.hint).toBe("sk-ant-…AB12");
      expect(res.data.provider).toBe("anthropic");
      expect(JSON.stringify(res.data)).not.toContain("abcdefAB12");
    }
    expect(rpc).toHaveBeenCalledWith(
      "ai_credential_set",
      expect.objectContaining({
        p_user: "user-1",
        p_provider: "anthropic",
        p_secret: "sk-ant-abcdefAB12",
        p_hint: "sk-ant-…AB12",
      }),
    );
  });

  it("fails cleanly when the DB write errors, without running id verification", async () => {
    getProviderRow.mockResolvedValueOnce(anthropicRow());
    validateKey.mockResolvedValueOnce(undefined);
    rpc.mockResolvedValueOnce({ error: { message: "vault down" } });
    const res = await saveAiKey({
      provider: "anthropic",
      key: "sk-ant-abcdefAB12",
    });
    expect(res.ok).toBe(false);
    expect(afterTasks).toHaveLength(0);
    expect(verifyProviderModels).not.toHaveBeenCalled();
  });

  it("defers id verification to after() instead of awaiting it on the response path", async () => {
    // The save must return the moment the key is stored. A provider that
    // accepts the connection and then stalls would otherwise hold the user's
    // action open for undici's default timeout.
    getProviderRow.mockResolvedValueOnce(anthropicRow());
    validateKey.mockResolvedValueOnce(undefined);
    rpc.mockResolvedValueOnce({ error: null });
    const res = await saveAiKey({
      provider: "anthropic",
      key: "sk-ant-abcdefAB12",
    });
    expect(res.ok).toBe(true);
    expect(afterTasks).toHaveLength(1);
    // Not yet — it runs once the response has been sent.
    expect(verifyProviderModels).not.toHaveBeenCalled();
  });

  it("resolves this provider's catalog ids with the key it just saved", async () => {
    getProviderRow.mockResolvedValueOnce(anthropicRow());
    validateKey.mockResolvedValueOnce(undefined);
    rpc.mockResolvedValueOnce({ error: null });
    await saveAiKey({ provider: "anthropic", key: "sk-ant-abcdefAB12" });
    await afterTasks[0]();
    expect(verifyProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "anthropic",
        apiKey: "sk-ant-abcdefAB12",
      }),
    );
  });

  it("still saves the key when id verification blows up", async () => {
    // The key is valid regardless; an unverified row is simply not offered
    // until the next pass. A catalog problem must never look like a bad key —
    // and now it cannot even be observed by the response, so the deferred task
    // must swallow the failure rather than reject into the platform.
    getProviderRow.mockResolvedValueOnce(anthropicRow());
    validateKey.mockResolvedValueOnce(undefined);
    rpc.mockResolvedValueOnce({ error: null });
    verifyProviderModels.mockRejectedValueOnce(new Error("catalog offline"));
    const res = await saveAiKey({
      provider: "anthropic",
      key: "sk-ant-abcdefAB12",
    });
    expect(res.ok).toBe(true);
    await expect(afterTasks[0]()).resolves.toBeUndefined();
  });
});

describe("removeAiKey", () => {
  it("deletes only the named provider's key via ai_credential_delete", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    const res = await removeAiKey({ provider: "moonshotai" });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("ai_credential_delete", {
      p_user: "user-1",
      p_provider: "moonshotai",
    });
  });

  it("never calls the all-providers ai_credential_clear", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    await removeAiKey({ provider: "anthropic" });
    expect(rpc).not.toHaveBeenCalledWith(
      "ai_credential_clear",
      expect.anything(),
    );
  });

  it("rejects an empty provider without calling the DB", async () => {
    const res = await removeAiKey({ provider: "" });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails cleanly when the DB write errors", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "vault down" } });
    const res = await removeAiKey({ provider: "anthropic" });
    expect(res.ok).toBe(false);
  });
});
