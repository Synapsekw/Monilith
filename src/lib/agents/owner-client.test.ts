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

beforeEach(() => {
  mintBridgeSecret.mockReset();
  getBridgedClient.mockReset();
  setAgentBridgeSecret.mockReset();
});

describe("getAgentOwnerClient", () => {
  it("mints and persists a bridge secret on first run", async () => {
    mintBridgeSecret.mockResolvedValue("secret-1");
    getBridgedClient.mockResolvedValue({
      client: "CLIENT",
      newBridgeSecretId: "secret-1",
    });

    const client = await getAgentOwnerClient({} as never, agent);

    expect(mintBridgeSecret).toHaveBeenCalledWith("user-1");
    expect(setAgentBridgeSecret).toHaveBeenCalledWith(
      expect.anything(),
      "agent-1",
      "secret-1",
    );
    expect(client).toBe("CLIENT");
  });

  it("reuses an existing secret without minting", async () => {
    getBridgedClient.mockResolvedValue({
      client: "CLIENT",
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
    expect(setAgentBridgeSecret).not.toHaveBeenCalled();
  });

  it("persists a rotated secret id", async () => {
    getBridgedClient.mockResolvedValue({
      client: "CLIENT",
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
});
