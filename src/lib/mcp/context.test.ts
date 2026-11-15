import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mcp/oauth/token-store", () => ({
  lookupTokenByAccessToken: vi.fn(),
}));
vi.mock("@/lib/mcp/oauth/session-bridge", () => ({
  getBridgedClient: vi.fn(),
  healBridge: vi.fn(),
}));
vi.mock("@/lib/rate-limit/mcp-rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { lookupTokenByAccessToken } from "@/lib/mcp/oauth/token-store";
import { getBridgedClient, healBridge } from "@/lib/mcp/oauth/session-bridge";
import {
  BridgeRevokedError,
  BridgeSessionDeadError,
  BridgeUnavailableError,
} from "@/lib/mcp/oauth/bridge-errors";
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
    vi.mocked(healBridge).mockReset();
  });

  it("resolves the bridged client against the token row, so rotation is compare-and-set", async () => {
    const client = { tag: "cached" };
    vi.mocked(getBridgedClient).mockResolvedValueOnce({
      client,
      newBridgeSecretId: "old",
    } as never);

    await expect(getRequestClient(auth)).resolves.toBe(client);
    expect(getBridgedClient).toHaveBeenCalledWith("old", "row-1");
    expect(healBridge).not.toHaveBeenCalled();
  });

  // A bridge whose Supabase session was revoked (an admin revoking sessions, a
  // session time-box) used to fail every tool call forever while the MCP token
  // itself stayed valid, so the client never re-prompted for sign-in.
  it("re-mints the bridge for the same user when the stored session is positively dead", async () => {
    const healed = { tag: "healed" };
    vi.mocked(getBridgedClient).mockRejectedValueOnce(
      new BridgeSessionDeadError("AuthApiError 400 refresh_token_not_found"),
    );
    vi.mocked(healBridge).mockResolvedValueOnce({
      client: healed,
      newBridgeSecretId: "fresh",
    } as never);

    await expect(getRequestClient(auth)).resolves.toBe(healed);
    expect(healBridge).toHaveBeenCalledWith({
      tokenRowId: "row-1",
      userId: "user-1",
      deadSecretId: "old",
    });
  });

  // THE DEFECT: a bare `.catch` treated every failure as a dead session, so a
  // GoTrue or Vault outage minted one new session per tool call.
  it.each([
    ["a transient bridge failure", new BridgeUnavailableError("refresh: 503")],
    ["a revoked connection", new BridgeRevokedError()],
    ["an unclassified error", new Error("Session refresh failed.")],
    ["a non-Error rejection", "boom"],
  ])("does not heal on %s", async (_label, failure) => {
    vi.mocked(getBridgedClient).mockRejectedValueOnce(failure);

    await expect(getRequestClient(auth)).rejects.toBe(failure);
    expect(healBridge).not.toHaveBeenCalled();
  });

  it("tells the client a transient failure is retryable", async () => {
    vi.mocked(getBridgedClient).mockRejectedValueOnce(
      new BridgeUnavailableError("vault read: timeout"),
    );
    await expect(getRequestClient(auth)).rejects.toThrow(/retry in a moment/i);
  });

  it("surfaces the failure when the bridge cannot be re-minted", async () => {
    vi.mocked(getBridgedClient).mockRejectedValueOnce(
      new BridgeSessionDeadError("bridge secret missing"),
    );
    vi.mocked(healBridge).mockRejectedValueOnce(
      new Error("User has no email; cannot bridge."),
    );

    await expect(getRequestClient(auth)).rejects.toThrow(
      "User has no email; cannot bridge.",
    );
  });
});
