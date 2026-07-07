import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const validateKey = vi.fn();
vi.mock("@/lib/ai/providers/registry", () => ({
  getAdapter: () => ({
    id: "anthropic",
    keyFormat: {
      safeParse: (v: string) => ({ success: v.startsWith("sk-ant-") }),
    },
    validateKey: (...a: unknown[]) => validateKey(...a),
  }),
}));

import { ProviderAuthError } from "@/lib/ai/providers/types";
import { saveAiKey, removeAiKey } from "@/lib/ai/credentials-actions";

beforeEach(() => {
  rpc.mockReset();
  validateKey.mockReset();
});

describe("saveAiKey", () => {
  it("rejects a badly-formatted key without calling the provider or DB", async () => {
    const res = await saveAiKey({
      provider: "anthropic",
      key: "wrong-prefix-key",
    });
    expect(res.ok).toBe(false);
    expect(validateKey).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails cleanly when the provider rejects the key", async () => {
    validateKey.mockRejectedValueOnce(new ProviderAuthError("anthropic"));
    const res = await saveAiKey({ provider: "anthropic", key: "sk-ant-bad" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/rejected/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores a valid key and returns the hint, never the key", async () => {
    validateKey.mockResolvedValueOnce(undefined);
    rpc.mockResolvedValueOnce({ error: null });
    const res = await saveAiKey({
      provider: "anthropic",
      key: "sk-ant-abcdefAB12",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.hint).toBe("sk-ant-…AB12");
      expect(JSON.stringify(res.data)).not.toContain("abcdefAB12");
    }
    expect(rpc).toHaveBeenCalledWith(
      "ai_credential_set",
      expect.objectContaining({ p_user: "user-1", p_provider: "anthropic" }),
    );
  });
});

describe("removeAiKey", () => {
  it("clears the credential", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    const res = await removeAiKey();
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("ai_credential_clear", {
      p_user: "user-1",
    });
  });
});
