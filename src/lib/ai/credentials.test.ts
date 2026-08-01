import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  AiNotConfiguredError,
  PersonalAiKeyMissingError,
} from "@/lib/ai/errors";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc }),
}));

// `credentials.ts` still imports requireUser at module scope for
// getMyAiCredential (untouched by this task) — mocked so module resolution
// never hits the real cookie-bound implementation. resolveUserAdapterById no
// longer calls this at all (see the "session-less" test below, which now
// actually asserts that rather than just claiming it in its name).
const requireUser = vi.fn(async () => ({ id: "user-1" }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...(a as [])),
}));

import {
  resolveUserAdapterById,
  asTrustedUserId,
  maskKey,
} from "@/lib/ai/credentials";

beforeEach(() => {
  rpc.mockReset();
  requireUser.mockClear();
});

describe("maskKey", () => {
  it("shows a head and the last 4 chars", () => {
    expect(maskKey("sk-ant-abcdefAB12")).toBe("sk-ant-…AB12");
  });
});

describe("resolveUserAdapterById", () => {
  it("is session-less: resolves the SUPPLIED id with no requireUser() call", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ provider: "openai", secret: "sk-owner" }],
      error: null,
    });
    const { adapter, apiKey } = await resolveUserAdapterById(
      asTrustedUserId("owner-9"),
    );
    expect(adapter.id).toBe("openai");
    expect(apiKey).toBe("sk-owner");
    expect(rpc).toHaveBeenCalledWith("ai_credential_get", {
      p_user: "owner-9",
    });
    // The actual claim the test name makes, asserted rather than assumed.
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("throws PersonalAiKeyMissingError when that user has no stored key — a per-user config state, not a crash", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(
      resolveUserAdapterById(asTrustedUserId("owner-9")),
    ).rejects.toBeInstanceOf(PersonalAiKeyMissingError);
  });

  it("PersonalAiKeyMissingError is still an AiNotConfiguredError, so existing mapAiError/action catches keep matching", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(
      resolveUserAdapterById(asTrustedUserId("owner-9")),
    ).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it("propagates a raw rpc error unchanged (not wrapped as a config-state error)", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "vault down" },
    });
    await expect(
      resolveUserAdapterById(asTrustedUserId("owner-9")),
    ).rejects.toMatchObject({ message: "vault down" });
  });
});
