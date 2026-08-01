import { describe, expect, it, vi, beforeEach } from "vitest";
import { AiNotConfiguredError } from "@/lib/ai/errors";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));

import {
  resolveUserAdapter,
  resolveUserAdapterById,
  maskKey,
} from "@/lib/ai/credentials";

beforeEach(() => rpc.mockReset());

describe("maskKey", () => {
  it("shows a head and the last 4 chars", () => {
    expect(maskKey("sk-ant-abcdefAB12")).toBe("sk-ant-…AB12");
  });
});

describe("resolveUserAdapter", () => {
  it("throws AiNotConfiguredError when the user has no key", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(resolveUserAdapter()).rejects.toBeInstanceOf(
      AiNotConfiguredError,
    );
  });

  it("returns the adapter + key for the stored provider", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ provider: "openai", secret: "sk-live" }],
      error: null,
    });
    const { adapter, apiKey } = await resolveUserAdapter();
    expect(adapter.id).toBe("openai");
    expect(apiKey).toBe("sk-live");
  });

  it("looks up the SESSION user's id (from requireUser), not a caller-supplied one", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ provider: "openai", secret: "sk-live" }],
      error: null,
    });
    await resolveUserAdapter();
    expect(rpc).toHaveBeenCalledWith("ai_credential_get", {
      p_user: "user-1",
    });
  });
});

describe("resolveUserAdapterById", () => {
  it("is session-less: resolves the SUPPLIED id with no requireUser() call", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ provider: "openai", secret: "sk-owner" }],
      error: null,
    });
    const { adapter, apiKey } = await resolveUserAdapterById("owner-9");
    expect(adapter.id).toBe("openai");
    expect(apiKey).toBe("sk-owner");
    expect(rpc).toHaveBeenCalledWith("ai_credential_get", {
      p_user: "owner-9",
    });
  });

  it("throws AiNotConfiguredError when that user has no stored key — a config state, not a crash", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(resolveUserAdapterById("owner-9")).rejects.toBeInstanceOf(
      AiNotConfiguredError,
    );
  });
});
