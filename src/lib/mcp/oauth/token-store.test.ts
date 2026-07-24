import { describe, expect, it, vi } from "vitest";

const rows: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        rows.push(row);
        return { error: null };
      },
      select: () => ({
        eq: (col: string, val: string) => ({
          is: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: rows.find((r) => r[col] === val) ?? null,
                error: null,
              }),
          }),
          maybeSingle: () =>
            Promise.resolve({
              data: rows.find((r) => r[col] === val) ?? null,
              error: null,
            }),
        }),
      }),
    }),
  }),
}));

import { hashToken } from "./crypto";
import { issueTokenPair, lookupTokenByAccessToken } from "./token-store";

describe("issueTokenPair / lookupTokenByAccessToken", () => {
  it("issues a token pair that can be looked up by its hash", async () => {
    const issued = await issueTokenPair({
      clientId: "client-1",
      userId: "user-1",
      bridgeSecretId: "secret-1",
    });
    expect(issued.accessToken).toBeTruthy();
    expect(issued.expiresIn).toBeGreaterThan(0);

    const found = await lookupTokenByAccessToken(issued.accessToken);
    expect(found?.user_id).toBe("user-1");
    expect(found?.access_token_hash).toBe(hashToken(issued.accessToken));
  });
});
