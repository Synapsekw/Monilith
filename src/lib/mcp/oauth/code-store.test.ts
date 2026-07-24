import { describe, expect, it, vi } from "vitest";

const rows = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        rows.set(row.code as string, { ...row, consumed_at: null });
        return { error: null };
      },
      select: () => ({
        eq: (_col: string, code: string) => ({
          maybeSingle: () =>
            Promise.resolve({ data: rows.get(code) ?? null, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, code: string) => ({
          is: (_consumedCol: string, _consumedVal: null) => ({
            select: () => ({
              maybeSingle: () => {
                const row = rows.get(code);
                if (!row || row.consumed_at) {
                  return Promise.resolve({ data: null, error: null });
                }
                const updated = { ...row, ...patch };
                rows.set(code, updated);
                return Promise.resolve({ data: updated, error: null });
              },
            }),
          }),
        }),
      }),
    }),
  }),
}));

import {
  consumeAuthorizationCode,
  createAuthorizationCode,
} from "./code-store";

describe("createAuthorizationCode / consumeAuthorizationCode", () => {
  it("round-trips: created code can be consumed once", async () => {
    const code = await createAuthorizationCode({
      clientId: "client-1",
      userId: "user-1",
      redirectUri: "https://claude.ai/callback",
      codeChallenge: "x".repeat(43),
    });
    const row = await consumeAuthorizationCode(code);
    expect(row?.client_id).toBe("client-1");
    expect(row?.user_id).toBe("user-1");
  });

  it("returns null for an unknown code", async () => {
    const row = await consumeAuthorizationCode("does-not-exist");
    expect(row).toBeNull();
  });

  it("returns null when the same code is consumed twice (single-use)", async () => {
    const code = await createAuthorizationCode({
      clientId: "client-1",
      userId: "user-1",
      redirectUri: "https://claude.ai/callback",
      codeChallenge: "x".repeat(43),
    });
    const first = await consumeAuthorizationCode(code);
    expect(first).not.toBeNull();
    const second = await consumeAuthorizationCode(code);
    expect(second).toBeNull();
  });

  it("returns null for an expired code", async () => {
    const code = await createAuthorizationCode({
      clientId: "client-1",
      userId: "user-1",
      redirectUri: "https://claude.ai/callback",
      codeChallenge: "x".repeat(43),
    });
    const row = rows.get(code);
    rows.set(code, {
      ...row,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const result = await consumeAuthorizationCode(code);
    expect(result).toBeNull();
  });
});
