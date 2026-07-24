import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mcp/oauth/token-store", () => ({
  lookupTokenByAccessToken: vi.fn(),
}));
vi.mock("@/lib/rate-limit/mcp-rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { lookupTokenByAccessToken } from "@/lib/mcp/oauth/token-store";
import { resolveMcpAuth } from "./context";

describe("resolveMcpAuth", () => {
  it("returns undefined for a missing bearer token", async () => {
    const result = await resolveMcpAuth(
      new Request("https://x/api/mcp"),
      undefined,
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for a token with no matching row", async () => {
    vi.mocked(lookupTokenByAccessToken).mockResolvedValueOnce(null);
    const result = await resolveMcpAuth(
      new Request("https://x/api/mcp"),
      "bad-token",
    );
    expect(result).toBeUndefined();
  });

  it("returns AuthInfo carrying the resolved user id for a valid token", async () => {
    vi.mocked(lookupTokenByAccessToken).mockResolvedValueOnce({
      id: "row-1",
      user_id: "user-1",
      client_id: "client-1",
      bridge_secret_id: "secret-1",
    } as never);
    const result = await resolveMcpAuth(
      new Request("https://x/api/mcp"),
      "good-token",
    );
    expect(result?.token).toBe("good-token");
    expect(result?.clientId).toBe("client-1");
    expect(result?.extra?.userId).toBe("user-1");
    expect(result?.extra?.tokenRowId).toBe("row-1");
    expect(result?.extra?.bridgeSecretId).toBe("secret-1");
  });
});
