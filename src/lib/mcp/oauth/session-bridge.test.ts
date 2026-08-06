import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression cover for the production 500 on POST /api/oauth/token:
 *
 *   Error: duplicate key value violates unique constraint "secrets_name_idx"
 *
 * `vault.secrets.name` is UNIQUE. `oauth_bridge_rotate_secret` inserts via
 * `vault.create_secret(p_secret, p_name, …)` (supabase/migrations/
 * 20260724133321_mcp_oauth.sql), so a secret NAME that is derived only from the
 * user id lets the FIRST bridge for a user squat it forever — the user's second
 * MCP client (and a personal agent alongside an MCP client, via
 * src/lib/agents/owner-client.ts) then 500s on mint.
 *
 * The invariant these tests pin: every mint/rotate asks for a name that is
 * unique to THAT secret, while still carrying the user id as a greppable prefix.
 */

const typedRpc = vi.fn();
const createServiceClient = vi.fn(() => ({ __svc: true }));
const getUserById = vi.fn();
const generateLink = vi.fn();
const verifyOtp = vi.fn();
const refreshSession = vi.fn();

vi.mock("@/lib/supabase/typed-rpc", () => ({
  typedRpc: (...a: unknown[]) => typedRpc(...a),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));
vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "service-key" }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: {
        getUserById: (...a: unknown[]) => getUserById(...a),
        generateLink: (...a: unknown[]) => generateLink(...a),
      },
      verifyOtp: (...a: unknown[]) => verifyOtp(...a),
      refreshSession: (...a: unknown[]) => refreshSession(...a),
    },
  }),
}));

import { mintBridgeSecret, getBridgedClient } from "./session-bridge";

const USER_ID = "edd948c1-0d9f-4171-ad9f-d594247ef79b";

function session(over: Record<string, unknown> = {}) {
  return {
    refresh_token: "refresh-1",
    access_token: "access-1",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    user: { id: USER_ID },
    ...over,
  };
}

/** The `p_name` handed to oauth_bridge_rotate_secret on the Nth rpc call. */
function nameOnCall(n: number): string {
  const args = typedRpc.mock.calls[n][2] as { p_name: string };
  return args.p_name;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserById.mockResolvedValue({
    data: { user: { id: USER_ID, email: "user@example.com" } },
    error: null,
  });
  generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "hashed-token" } },
    error: null,
  });
  verifyOtp.mockResolvedValue({ data: { session: session() }, error: null });
  refreshSession.mockResolvedValue({
    data: { session: session() },
    error: null,
  });
  typedRpc.mockResolvedValue({ data: "new-secret-id", error: null });
});

describe("mintBridgeSecret — Vault secret naming", () => {
  it("returns the secret id the rotate rpc minted", async () => {
    await expect(mintBridgeSecret(USER_ID)).resolves.toBe("new-secret-id");
  });

  it("stores the session payload (refresh + access token + expiry) as the secret", async () => {
    await mintBridgeSecret(USER_ID);
    const args = typedRpc.mock.calls[0][2] as {
      p_secret: string;
      p_old_secret_id: string | null;
    };
    expect(args.p_old_secret_id).toBeNull();
    const payload = JSON.parse(args.p_secret);
    expect(payload.refreshToken).toBe("refresh-1");
    expect(payload.accessToken).toBe("access-1");
    expect(typeof payload.accessExpiresAt).toBe("number");
  });

  it("keeps the user id in the name so secrets stay greppable per user", async () => {
    await mintBridgeSecret(USER_ID);
    expect(nameOnCall(0)).toContain(USER_ID);
    expect(nameOnCall(0).startsWith("mcp_bridge:")).toBe(true);
  });

  // THE REGRESSION: two clients for one user (e.g. Claude then Hermes, or an
  // MCP client alongside a personal agent) must not collide on secrets_name_idx.
  it("asks for a DIFFERENT name on a second mint for the same user", async () => {
    await mintBridgeSecret(USER_ID);
    await mintBridgeSecret(USER_ID);
    expect(nameOnCall(0)).not.toBe(nameOnCall(1));
  });

  it("stays unique across many mints for one user", async () => {
    for (let i = 0; i < 25; i++) await mintBridgeSecret(USER_ID);
    const names = typedRpc.mock.calls.map((_, i) => nameOnCall(i));
    expect(new Set(names).size).toBe(25);
  });

  it("propagates a vault failure instead of returning a bogus id", async () => {
    typedRpc.mockResolvedValue({
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });
    await expect(mintBridgeSecret(USER_ID)).rejects.toThrow(/duplicate key/);
  });
});

describe("getBridgedClient — rotation naming", () => {
  const EXPIRED = JSON.stringify({
    refreshToken: "refresh-old",
    accessToken: "access-old",
    accessExpiresAt: Date.now() - 1_000,
  });

  it("does not reuse a per-user name when it rotates the secret", async () => {
    // First call resolves the stored secret, second performs the rotation.
    typedRpc
      .mockResolvedValueOnce({ data: EXPIRED, error: null })
      .mockResolvedValueOnce({ data: "rotated-secret-id", error: null });

    const { newBridgeSecretId } = await getBridgedClient("old-secret-id");
    expect(newBridgeSecretId).toBe("rotated-secret-id");

    const rotateArgs = typedRpc.mock.calls[1][2] as {
      p_name: string;
      p_old_secret_id: string;
      p_secret: string;
    };
    expect(rotateArgs.p_old_secret_id).toBe("old-secret-id");
    expect(rotateArgs.p_name).toContain(USER_ID);
    expect(rotateArgs.p_name).not.toBe(`mcp_bridge:${USER_ID}`);
    // The refreshed session must still be what gets written — a rotation that
    // renames but drops the payload would silently empty the bridge.
    const rotated = JSON.parse(rotateArgs.p_secret);
    expect(rotated.refreshToken).toBe("refresh-1");
    expect(rotated.accessToken).toBe("access-1");
  });

  it("skips rotation entirely while the cached access token is still fresh", async () => {
    const FRESH = JSON.stringify({
      refreshToken: "refresh-fresh",
      accessToken: "access-fresh",
      accessExpiresAt: Date.now() + 10 * 60_000,
    });
    typedRpc.mockResolvedValueOnce({ data: FRESH, error: null });

    const { newBridgeSecretId } = await getBridgedClient("same-secret-id");
    expect(newBridgeSecretId).toBe("same-secret-id");
    expect(refreshSession).not.toHaveBeenCalled();
    expect(typedRpc).toHaveBeenCalledTimes(1);
  });
});
