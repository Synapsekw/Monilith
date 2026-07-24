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
        eq: (_col: string, code: string) => {
          const row = rows.get(code);
          if (row) rows.set(code, { ...row, ...patch });
          return Promise.resolve({ error: null });
        },
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
});
