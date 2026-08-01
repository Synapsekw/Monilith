import { describe, it, expect, vi, beforeEach } from "vitest";

const mintBridgeSecret = vi.fn();
const getBridgedClient = vi.fn();
const setAgentBridgeSecret = vi.fn();

vi.mock("@/lib/mcp/oauth/session-bridge", () => ({
  mintBridgeSecret: (...a: unknown[]) => mintBridgeSecret(...a),
  getBridgedClient: (...a: unknown[]) => getBridgedClient(...a),
}));
vi.mock("./agents-db", () => ({
  setAgentBridgeSecret: (...a: unknown[]) => setAgentBridgeSecret(...a),
}));

const { getAgentOwnerClient } = await import("./owner-client");

const agent = {
  id: "agent-1",
  owner_id: "user-1",
  bridge_secret_id: null,
} as never;

// The implementation calls `client.auth.getUser()` to verify the bridged
// session actually belongs to agent.owner_id, so the mocked "client" needs
// that shape rather than being an opaque sentinel. `getUser` defaults to
// resolving as user-1 (the fixture's owner) so tests that aren't exercising
// the invariant itself don't need to restate it.
const getUser = vi.fn();
const mockClient = { auth: { getUser } } as never;

beforeEach(() => {
  mintBridgeSecret.mockReset();
  getBridgedClient.mockReset();
  setAgentBridgeSecret.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

describe("getAgentOwnerClient", () => {
  it("mints and persists a bridge secret on first run", async () => {
    mintBridgeSecret.mockResolvedValue("secret-1");
    getBridgedClient.mockResolvedValue({
      client: mockClient,
      newBridgeSecretId: "secret-1",
    });

    const client = await getAgentOwnerClient({} as never, agent);

    expect(mintBridgeSecret).toHaveBeenCalledWith("user-1");
    expect(getBridgedClient).toHaveBeenCalledWith("secret-1");
    expect(setAgentBridgeSecret).toHaveBeenCalledWith(
      expect.anything(),
      "agent-1",
      "secret-1",
    );
    expect(client).toBe(mockClient);
  });

  it("reuses an existing secret without minting", async () => {
    getBridgedClient.mockResolvedValue({
      client: mockClient,
      newBridgeSecretId: "secret-9",
    });

    await getAgentOwnerClient(
      {} as never,
      {
        ...(agent as object),
        bridge_secret_id: "secret-9",
      } as never,
    );

    expect(mintBridgeSecret).not.toHaveBeenCalled();
    expect(getBridgedClient).toHaveBeenCalledWith("secret-9");
    expect(setAgentBridgeSecret).not.toHaveBeenCalled();
  });

  it("persists a rotated secret id", async () => {
    getBridgedClient.mockResolvedValue({
      client: mockClient,
      newBridgeSecretId: "secret-rotated",
    });

    await getAgentOwnerClient(
      {} as never,
      {
        ...(agent as object),
        bridge_secret_id: "secret-old",
      } as never,
    );

    expect(setAgentBridgeSecret).toHaveBeenCalledWith(
      expect.anything(),
      "agent-1",
      "secret-rotated",
    );
  });

  it("fails closed when minting fails — never falls back to the service client", async () => {
    mintBridgeSecret.mockRejectedValue(new Error("gotrue rate limited"));

    await expect(getAgentOwnerClient({} as never, agent)).rejects.toThrow(
      /rate limited/,
    );
  });

  describe("a missing vault secret (finding 1)", () => {
    it("re-mints and persists when the stored secret is not found", async () => {
      getBridgedClient
        .mockRejectedValueOnce(new Error("Bridge secret not found."))
        .mockResolvedValueOnce({
          client: mockClient,
          newBridgeSecretId: "secret-fresh",
        });
      mintBridgeSecret.mockResolvedValue("secret-fresh");

      const client = await getAgentOwnerClient(
        {} as never,
        { ...(agent as object), bridge_secret_id: "secret-dead" } as never,
      );

      // Re-mint is owner-scoped, exactly like the first-run path.
      expect(mintBridgeSecret).toHaveBeenCalledWith("user-1");
      expect(getBridgedClient).toHaveBeenNthCalledWith(1, "secret-dead");
      expect(getBridgedClient).toHaveBeenNthCalledWith(2, "secret-fresh");
      expect(setAgentBridgeSecret).toHaveBeenCalledWith(
        expect.anything(),
        "agent-1",
        "secret-fresh",
      );
      expect(client).toBe(mockClient);
    });

    it("still fails closed for a different getBridgedClient failure", async () => {
      getBridgedClient.mockRejectedValue(new Error("network error"));

      await expect(
        getAgentOwnerClient(
          {} as never,
          { ...(agent as object), bridge_secret_id: "secret-9" } as never,
        ),
      ).rejects.toThrow(/network error/);

      // Not a "not found" — must not be treated as a re-mint trigger.
      expect(mintBridgeSecret).not.toHaveBeenCalled();
      expect(setAgentBridgeSecret).not.toHaveBeenCalled();
    });
  });

  describe("owner-identity invariant (finding 2)", () => {
    it("throws when the bridged session belongs to a different user", async () => {
      getBridgedClient.mockResolvedValue({
        client: mockClient,
        newBridgeSecretId: "secret-9",
      });
      getUser.mockResolvedValue({
        data: { user: { id: "some-other-user" } },
        error: null,
      });

      await expect(
        getAgentOwnerClient(
          {} as never,
          { ...(agent as object), bridge_secret_id: "secret-9" } as never,
        ),
      ).rejects.toThrow(/owner-scope invariant/i);

      // A failed invariant must never be persisted or otherwise trusted.
      expect(setAgentBridgeSecret).not.toHaveBeenCalled();
    });

    it("throws when auth.getUser() itself errors", async () => {
      getBridgedClient.mockResolvedValue({
        client: mockClient,
        newBridgeSecretId: "secret-9",
      });
      getUser.mockResolvedValue({
        data: { user: null },
        error: new Error("session invalid"),
      });

      await expect(
        getAgentOwnerClient(
          {} as never,
          { ...(agent as object), bridge_secret_id: "secret-9" } as never,
        ),
      ).rejects.toThrow(/owner-scope invariant/i);
    });
  });

  describe("finding 3: rejection propagation", () => {
    it("propagates when setAgentBridgeSecret rejects", async () => {
      getBridgedClient.mockResolvedValue({
        client: mockClient,
        newBridgeSecretId: "secret-rotated",
      });
      setAgentBridgeSecret.mockRejectedValue(new Error("db write failed"));

      await expect(
        getAgentOwnerClient(
          {} as never,
          { ...(agent as object), bridge_secret_id: "secret-old" } as never,
        ),
      ).rejects.toThrow(/db write failed/);
    });
  });
});
