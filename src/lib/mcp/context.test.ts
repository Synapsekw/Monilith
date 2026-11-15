import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mcp/oauth/token-store", () => ({
  lookupTokenByAccessToken: vi.fn(),
  updateBridgeSecretId: vi.fn(),
}));
vi.mock("@/lib/mcp/oauth/session-bridge", () => ({
  getBridgedClient: vi.fn(),
  mintBridgeSecret: vi.fn(),
}));
vi.mock("@/lib/rate-limit/mcp-rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import {
  lookupTokenByAccessToken,
  updateBridgeSecretId,
} from "@/lib/mcp/oauth/token-store";
import {
  getBridgedClient,
  mintBridgeSecret,
} from "@/lib/mcp/oauth/session-bridge";
import { getRequestClient, mcpActorId, resolveMcpAuth } from "./context";

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

describe("mcpActorId", () => {
  it("returns the user id resolveMcpAuth stamped on the auth context", () => {
    expect(
      mcpActorId({
        token: "t",
        clientId: "c",
        scopes: [],
        extra: { userId: "user-1" },
      } as never),
    ).toBe("user-1");
  });

  it("throws on a malformed auth context", () => {
    expect(() =>
      mcpActorId({ token: "t", clientId: "c", scopes: [] } as never),
    ).toThrow("Malformed auth context.");
  });
});

describe("getRequestClient", () => {
  const auth = {
    token: "t",
    clientId: "c",
    scopes: [],
    extra: { userId: "user-1", tokenRowId: "row-1", bridgeSecretId: "old" },
  } as never;

  beforeEach(() => {
    vi.mocked(getBridgedClient).mockReset();
    vi.mocked(mintBridgeSecret).mockReset();
    vi.mocked(updateBridgeSecretId).mockReset();
  });

  it("does not rewrite the token row when the bridge secret did not rotate", async () => {
    const client = { tag: "cached" };
    vi.mocked(getBridgedClient).mockResolvedValueOnce({
      client,
      newBridgeSecretId: "old",
    } as never);

    await expect(getRequestClient(auth)).resolves.toBe(client);
    expect(updateBridgeSecretId).not.toHaveBeenCalled();
  });

  it("persists the new secret id when the bridge rotated", async () => {
    vi.mocked(getBridgedClient).mockResolvedValueOnce({
      client: {},
      newBridgeSecretId: "rotated",
    } as never);

    await getRequestClient(auth);
    expect(updateBridgeSecretId).toHaveBeenCalledWith("row-1", "rotated");
  });

  // A bridge whose Supabase session was revoked (sign-out everywhere, an admin
  // revoking sessions) used to fail every tool call forever while the MCP
  // token itself stayed valid, so the client never re-prompted for sign-in.
  it("re-mints the bridge for the same user when the stored session is dead", async () => {
    const healed = { tag: "healed" };
    vi.mocked(getBridgedClient)
      .mockRejectedValueOnce(new Error("Session refresh failed."))
      .mockResolvedValueOnce({
        client: healed,
        newBridgeSecretId: "fresh",
      } as never);
    vi.mocked(mintBridgeSecret).mockResolvedValueOnce("fresh");

    await expect(getRequestClient(auth)).resolves.toBe(healed);
    expect(mintBridgeSecret).toHaveBeenCalledWith("user-1", "old");
    expect(getBridgedClient).toHaveBeenLastCalledWith("fresh");
    expect(updateBridgeSecretId).toHaveBeenCalledWith("row-1", "fresh");
  });

  it("surfaces the failure when the bridge cannot be re-minted", async () => {
    vi.mocked(getBridgedClient).mockRejectedValueOnce(
      new Error("Session refresh failed."),
    );
    vi.mocked(mintBridgeSecret).mockRejectedValueOnce(
      new Error("User has no email; cannot bridge."),
    );

    await expect(getRequestClient(auth)).rejects.toThrow(
      "User has no email; cannot bridge.",
    );
    expect(updateBridgeSecretId).not.toHaveBeenCalled();
  });
});
