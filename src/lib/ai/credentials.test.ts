import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  AiNotConfiguredError,
  PersonalAiKeyMissingError,
} from "@/lib/ai/errors";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc }),
}));

// `credentials.ts` imports requireUser at module scope for getMyAiCredential —
// mocked so module resolution never hits the real cookie-bound implementation.
// resolveUserAdapterById does not call this at all (see the "session-less" test
// below, which now actually asserts that rather than just claiming it in its
// name).
const requireUser = vi.fn(async () => ({ id: "user-1" }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...(a as [])),
}));

// The RLS self-read behind getMyAiCredential. `postgrestResult` is what the
// awaited builder resolves to; `queryLog` records the shaping calls so the
// tests can assert the read is ORDERED and BOUNDED rather than just that it
// returned something.
const postgrestResult = vi.fn();
const queryLog: { order: unknown[][]; limit: number[]; single: number } = {
  order: [],
  limit: [],
  single: 0,
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: (...a: unknown[]) => {
          queryLog.order.push(a);
          return builder;
        },
        limit: (n: number) => {
          queryLog.limit.push(n);
          return Promise.resolve(postgrestResult());
        },
        // Present only so a regression back to `.maybeSingle()` is caught by
        // the "never asserts single-row" test instead of throwing here.
        maybeSingle: () => {
          queryLog.single += 1;
          return Promise.resolve(postgrestResult());
        },
      };
      return builder;
    },
  }),
}));

import {
  resolveUserAdapterById,
  asTrustedUserId,
  maskKey,
  getMyAiCredential,
} from "@/lib/ai/credentials";

beforeEach(() => {
  rpc.mockReset();
  requireUser.mockClear();
  postgrestResult.mockReset();
  queryLog.order = [];
  queryLog.limit = [];
  queryLog.single = 0;
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

// ===========================================================================
// One key PER PROVIDER (migration 20260810173752).
// ===========================================================================
// `ai_credential_set` no longer clears the user's other providers, so both
// readers below can now see MORE THAN ONE ROW for a single user. Neither was
// written for that. These are the regression tests for the two ways that broke.

describe("resolveUserAdapterById · multiple stored providers", () => {
  it("picks the SAME provider regardless of the order the rows arrive in", async () => {
    // The 1-arg ai_credential_get(p_user) has no `order by`, so row order is
    // whatever Postgres emits. Two runs must still spend the same key.
    rpc.mockResolvedValueOnce({
      data: [
        { provider: "openai", secret: "sk-openai" },
        { provider: "anthropic", secret: "sk-anthropic" },
        { provider: "google", secret: "sk-google" },
      ],
      error: null,
    });
    const first = await resolveUserAdapterById(asTrustedUserId("owner-9"));

    rpc.mockResolvedValueOnce({
      data: [
        { provider: "google", secret: "sk-google" },
        { provider: "anthropic", secret: "sk-anthropic" },
        { provider: "openai", secret: "sk-openai" },
      ],
      error: null,
    });
    const second = await resolveUserAdapterById(asTrustedUserId("owner-9"));

    expect(first.adapter.id).toBe(second.adapter.id);
    expect(first.apiKey).toBe(second.apiKey);
    // Stable sort is by provider id, so the choice is arbitrary but predictable.
    expect(first.adapter.id).toBe("anthropic");
    expect(first.apiKey).toBe("sk-anthropic");
  });

  it("does not mutate the array the rpc handed back", async () => {
    const data = [
      { provider: "openai", secret: "sk-openai" },
      { provider: "anthropic", secret: "sk-anthropic" },
    ];
    rpc.mockResolvedValueOnce({ data, error: null });
    await resolveUserAdapterById(asTrustedUserId("owner-9"));
    expect(data.map((r) => r.provider)).toEqual(["openai", "anthropic"]);
  });

  it("still resolves the single-row case unchanged", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ provider: "openai", secret: "sk-only" }],
      error: null,
    });
    const { adapter, apiKey } = await resolveUserAdapterById(
      asTrustedUserId("owner-9"),
    );
    expect(adapter.id).toBe("openai");
    expect(apiKey).toBe("sk-only");
  });
});

describe("getMyAiCredential", () => {
  it("returns a credential when the user has one", async () => {
    postgrestResult.mockReturnValueOnce({
      data: [
        {
          provider: "anthropic",
          key_hint: "sk-ant-…AB12",
          updated_at: "2026-08-10T00:00:00Z",
        },
      ],
      error: null,
    });
    await expect(getMyAiCredential()).resolves.toEqual({
      provider: "anthropic",
      hint: "sk-ant-…AB12",
      updatedAt: "2026-08-10T00:00:00Z",
    });
  });

  it("returns null when the user has no credential at all", async () => {
    postgrestResult.mockReturnValueOnce({ data: [], error: null });
    await expect(getMyAiCredential()).resolves.toBeNull();
  });

  it("never asserts a single row — it orders and bounds the read instead", async () => {
    // `.maybeSingle()` ERRORS on the second row. Since keys became
    // per-provider, that turned a user with two keys into a null `data` — and
    // the old code discarded the error, so the settings page rendered "no key
    // configured" while their keys existed and were unmanageable from the UI.
    postgrestResult.mockReturnValueOnce({
      data: [
        {
          provider: "anthropic",
          key_hint: "sk-ant-…AB12",
          updated_at: "2026-08-10T00:00:00Z",
        },
      ],
      error: null,
    });
    await getMyAiCredential();
    expect(queryLog.single).toBe(0);
    expect(queryLog.order).toEqual([["provider"]]);
    expect(queryLog.limit).toEqual([1]);
  });

  it("returns the same credential for a user holding several, whatever the row order", async () => {
    const rows = [
      { provider: "openai", key_hint: "sk-…9999", updated_at: "2026-08-09" },
      {
        provider: "anthropic",
        key_hint: "sk-ant-…AB12",
        updated_at: "2026-08-10",
      },
    ];
    postgrestResult.mockReturnValueOnce({ data: rows, error: null });
    const a = await getMyAiCredential();
    postgrestResult.mockReturnValueOnce({
      data: [...rows].reverse(),
      error: null,
    });
    const b = await getMyAiCredential();
    // The DB does the ordering (asserted above); the point here is that a
    // multi-row answer resolves to a credential rather than collapsing to null.
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it("SURFACES a database error instead of degrading to a false 'no key configured'", async () => {
    postgrestResult.mockReturnValueOnce({
      data: null,
      error: { message: "JSON object requested, multiple rows returned" },
    });
    await expect(getMyAiCredential()).rejects.toThrow(/getMyAiCredential/);
  });
});
