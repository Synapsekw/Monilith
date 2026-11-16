import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from "@supabase/supabase-js";
import { fakeOauthClient } from "@/test/oauth-tokens-fake-client";

/**
 * Error classification, the compare-and-set secret swap and self-heal, run
 * against a fake that OWNS the oauth_tokens rows and the Vault secrets and
 * applies every predicate and the swap's compare-and-set — so "exactly one
 * secret survives" is an assertion about state, not about which mock was
 * called. The auth errors are the real `@supabase/auth-js` classes.
 *
 * What this cannot prove: that live GoTrue really answers a revoked refresh
 * token with the codes used below. That needs a live check.
 */

let db: ReturnType<typeof fakeOauthClient>;
const getUserById = vi.fn();
const generateLink = vi.fn();
const verifyOtp = vi.fn();
const refreshSession = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => db.client,
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
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  // Echo the options back so a test can read which access token a returned
  // client was built with.
  createClient: (_url: string, _key: string, opts: unknown) => ({
    opts,
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

import {
  BridgeRevokedError,
  BridgeSessionDeadError,
  BridgeUnavailableError,
  isDeadSessionError,
} from "./bridge-errors";
import { getBridgedClient, healBridge } from "./session-bridge";

const USER_ID = "edd948c1-0d9f-4171-ad9f-d594247ef79b";
const TOKEN_ID = "token-row";

let sessionSeq = 0;
function session() {
  const n = ++sessionSeq;
  return {
    refresh_token: `refresh-${n}`,
    access_token: `access-${n}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    user: { id: USER_ID },
  };
}

const expiredPayload = () => ({
  refreshToken: "refresh-old",
  accessToken: "access-old",
  accessExpiresAt: Date.now() - 1_000,
});
const freshPayload = (accessToken = "access-live") => ({
  refreshToken: "refresh-live",
  accessToken,
  accessExpiresAt: Date.now() + 30 * 60_000,
});

/** The bearer token a client returned by the bridge will send. */
function bearerOf(client: unknown): string {
  const opts = (
    client as { opts: { global: { headers: { Authorization: string } } } }
  ).opts;
  return opts.global.headers.Authorization;
}

/** One live connection whose bridge secret holds `payload`. */
function connect(payload: unknown): string {
  db = fakeOauthClient();
  const secretId = db.putSecret(payload);
  db.tokens.push({
    id: TOKEN_ID,
    user_id: USER_ID,
    client_id: "client-1",
    bridge_secret_id: secretId,
    bridge_healed_at: null,
    revoked_at: null,
  });
  return secretId;
}

const snapshot = () => ({
  tokens: structuredClone(db.tokens),
  vault: [...db.vault.entries()],
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionSeq = 0;
  getUserById.mockResolvedValue({
    data: { user: { id: USER_ID, email: "user@example.com" } },
    error: null,
  });
  generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "hashed-token" } },
    error: null,
  });
  verifyOtp.mockImplementation(async () => ({
    data: { session: session() },
    error: null,
  }));
  refreshSession.mockImplementation(async () => ({
    data: { session: session() },
    error: null,
  }));
});

describe("isDeadSessionError — classified by code, never by message", () => {
  it.each([
    ["refresh_token_not_found", 400],
    ["refresh_token_already_used", 400],
    ["session_not_found", 403],
    ["session_expired", 400],
  ])("treats %s as a dead session", (code, status) => {
    expect(isDeadSessionError(new AuthApiError("whatever", status, code))).toBe(
      true,
    );
  });

  it("treats auth-js's AuthSessionMissingError as a dead session", () => {
    expect(isDeadSessionError(new AuthSessionMissingError())).toBe(true);
  });

  it.each([
    ["a fetch failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["a 503", new AuthRetryableFetchError("Service Unavailable", 503)],
    [
      "a rate limit",
      new AuthApiError("Too many requests", 429, "over_request_rate_limit"),
    ],
    ["a 500", new AuthApiError("boom", 500, "unexpected_failure")],
    ["a request timeout", new AuthApiError("slow", 504, "request_timeout")],
    ["a banned user", new AuthApiError("User is banned", 400, "user_banned")],
    ["an unparseable response", new AuthUnknownError("bad json", null)],
    // The message says "invalid refresh token", the code does not: not proof.
    [
      "a dead-sounding message with no code",
      new AuthApiError("Invalid Refresh Token: Already Used", 400, undefined),
    ],
    ["a plain Error", new Error("refresh_token_not_found")],
    ["a string", "session_not_found"],
    ["nothing", undefined],
  ])("does not treat %s as a dead session", (_label, error) => {
    expect(isDeadSessionError(error)).toBe(false);
  });
});

describe("getBridgedClient — failures are classified and leave state alone", () => {
  it("serves a fresh cached token with no GoTrue call and no write", async () => {
    const secretId = connect(freshPayload());
    const before = snapshot();

    const { client, newBridgeSecretId } = await getBridgedClient(
      secretId,
      TOKEN_ID,
    );

    expect(bearerOf(client)).toBe("Bearer access-live");
    expect(newBridgeSecretId).toBe(secretId);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it.each([
    [
      "refresh_token_not_found",
      new AuthApiError(
        "Invalid Refresh Token: Refresh Token Not Found",
        400,
        "refresh_token_not_found",
      ),
    ],
    ["a missing session", new AuthSessionMissingError()],
  ])(
    "reports %s as a dead session without touching state",
    async (_l, error) => {
      const secretId = connect(expiredPayload());
      const before = snapshot();
      refreshSession.mockResolvedValueOnce({ data: { session: null }, error });

      await expect(getBridgedClient(secretId, TOKEN_ID)).rejects.toBeInstanceOf(
        BridgeSessionDeadError,
      );
      expect(snapshot()).toEqual(before);
    },
  );

  it("reports a missing Vault secret as a dead session", async () => {
    connect(freshPayload());
    await expect(
      getBridgedClient("no-such-secret", TOKEN_ID),
    ).rejects.toBeInstanceOf(BridgeSessionDeadError);
  });

  it.each([
    ["a network error", new AuthRetryableFetchError("fetch failed", 0)],
    ["a GoTrue 503", new AuthRetryableFetchError("unavailable", 503)],
    [
      "a GoTrue rate limit",
      new AuthApiError("Too many requests", 429, "over_request_rate_limit"),
    ],
    ["a GoTrue 500", new AuthApiError("boom", 500, "unexpected_failure")],
  ])(
    "reports %s as retryable and leaves state alone",
    async (_label, error) => {
      const secretId = connect(expiredPayload());
      const before = snapshot();
      refreshSession.mockResolvedValueOnce({ data: { session: null }, error });

      const failure = await getBridgedClient(secretId, TOKEN_ID).catch(
        (e) => e,
      );

      expect(failure).toBeInstanceOf(BridgeUnavailableError);
      expect(failure.retryable).toBe(true);
      expect(failure.message).toMatch(/retry/i);
      expect(snapshot()).toEqual(before);
    },
  );

  it("reports a refresh that throws as retryable", async () => {
    const secretId = connect(expiredPayload());
    refreshSession.mockRejectedValueOnce(new TypeError("socket hang up"));
    await expect(getBridgedClient(secretId, TOKEN_ID)).rejects.toBeInstanceOf(
      BridgeUnavailableError,
    );
  });

  it("reports a Vault read failure as retryable, not as a dead session", async () => {
    const secretId = connect(freshPayload());
    db.failNext("rpc:oauth_bridge_get_secret", "upstream timeout");
    await expect(getBridgedClient(secretId, TOKEN_ID)).rejects.toBeInstanceOf(
      BridgeUnavailableError,
    );
  });

  it.each([
    ["not JSON", "{not json"],
    ["the wrong shape", JSON.stringify({ refreshToken: "r" })],
  ])(
    "reports a secret that is %s as retryable, not dead",
    async (_l, stored) => {
      const secretId = connect(freshPayload());
      db.vault.set(secretId, stored);
      await expect(getBridgedClient(secretId, TOKEN_ID)).rejects.toBeInstanceOf(
        BridgeUnavailableError,
      );
      expect(refreshSession).not.toHaveBeenCalled();
    },
  );

  it("reports a failed secret swap as retryable", async () => {
    const secretId = connect(expiredPayload());
    db.failNext("rpc:oauth_bridge_swap_secret", "vault down");
    await expect(getBridgedClient(secretId, TOKEN_ID)).rejects.toBeInstanceOf(
      BridgeUnavailableError,
    );
    // The row still points at a secret that exists.
    expect(db.vault.has(db.tokens[0].bridge_secret_id as string)).toBe(true);
  });
});

describe("getBridgedClient — refresh rotation is compare-and-set", () => {
  it("replaces the secret and re-points the row in one step", async () => {
    const secretId = connect(expiredPayload());

    const { client, newBridgeSecretId } = await getBridgedClient(
      secretId,
      TOKEN_ID,
    );

    expect(newBridgeSecretId).not.toBe(secretId);
    expect(db.tokens[0].bridge_secret_id).toBe(newBridgeSecretId);
    expect([...db.vault.keys()]).toEqual([newBridgeSecretId]);
    expect(bearerOf(client)).toBe("Bearer access-1");
    expect(JSON.parse(db.vault.get(newBridgeSecretId)!).refreshToken).toBe(
      "refresh-1",
    );
  });

  // THE DEFECT: each concurrent call created its own secret and the last
  // updateBridgeSecretId won, orphaning the others with a live session inside.
  it("leaves exactly one secret when concurrent calls all refresh", async () => {
    const secretId = connect(expiredPayload());

    const results = await Promise.all(
      Array.from({ length: 4 }, () => getBridgedClient(secretId, TOKEN_ID)),
    );

    expect(refreshSession).toHaveBeenCalledTimes(4);
    const live = db.tokens[0].bridge_secret_id as string;
    expect([...db.vault.keys()]).toEqual([live]);
    // Every caller is served, and every one of them from the winner's secret.
    const winnerAccess = JSON.parse(db.vault.get(live)!).accessToken;
    for (const r of results) {
      expect(r.newBridgeSecretId).toBe(live);
      expect(bearerOf(r.client)).toBe(`Bearer ${winnerAccess}`);
    }
  });

  it("refuses to serve when the connection was revoked mid-refresh", async () => {
    const secretId = connect(expiredPayload());
    refreshSession.mockImplementationOnce(async () => {
      // Revoked while the refresh was in flight (delete also frees the secret).
      db.tokens.length = 0;
      db.vault.clear();
      return { data: { session: session() }, error: null };
    });

    await expect(getBridgedClient(secretId, TOKEN_ID)).rejects.toBeInstanceOf(
      BridgeRevokedError,
    );
    // Nothing was stored for a connection that no longer exists.
    expect(db.vault.size).toBe(0);
  });
});

describe("healBridge", () => {
  const heal = (deadSecretId: string) =>
    healBridge(
      { tokenRowId: TOKEN_ID, userId: USER_ID, deadSecretId },
      { waitMs: 0 },
    );

  it("mints a session for the same user and swaps it in", async () => {
    const dead = connect(expiredPayload());

    const { client, newBridgeSecretId } = await heal(dead);

    expect(getUserById).toHaveBeenCalledWith(USER_ID);
    expect(db.tokens[0].bridge_secret_id).toBe(newBridgeSecretId);
    expect([...db.vault.keys()]).toEqual([newBridgeSecretId]);
    expect(db.tokens[0].bridge_healed_at).toEqual(expect.any(String));
    expect(bearerOf(client)).toBe("Bearer access-1");
  });

  it("heals a connection whose Vault secret is missing altogether", async () => {
    const dead = connect(expiredPayload());
    db.vault.delete(dead);

    const { newBridgeSecretId } = await heal(dead);

    expect([...db.vault.keys()]).toEqual([newBridgeSecretId]);
  });

  // THE DEFECT, heal side: N concurrent calls on a dead session minted N
  // sessions and stored N secrets.
  it("mints once when concurrent calls all find the session dead", async () => {
    const dead = connect(expiredPayload());

    const results = await Promise.all([heal(dead), heal(dead), heal(dead)]);

    expect(generateLink).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    const live = db.tokens[0].bridge_secret_id as string;
    expect([...db.vault.keys()]).toEqual([live]);
    for (const r of results) {
      expect(r.newBridgeSecretId).toBe(live);
      expect(bearerOf(r.client)).toBe("Bearer access-1");
    }
  });

  it("adopts a secret another request already swapped in, without minting", async () => {
    const dead = connect(expiredPayload());
    const winner = db.putSecret(freshPayload("access-winner"));
    db.tokens[0].bridge_secret_id = winner;
    db.vault.delete(dead);

    const { client, newBridgeSecretId } = await heal(dead);

    expect(newBridgeSecretId).toBe(winner);
    expect(bearerOf(client)).toBe("Bearer access-winner");
    expect(generateLink).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
  });

  it("allows at most one heal per token per 60 seconds", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-15T10:00:00Z") });
    try {
      const dead = connect(expiredPayload());
      const first = await healBridge({
        tokenRowId: TOKEN_ID,
        userId: USER_ID,
        deadSecretId: dead,
      });

      // The freshly minted session is "dead" again 30 s later (a wrong verdict,
      // or a real revocation): no second mint inside the window.
      vi.setSystemTime(new Date("2026-11-15T10:00:30Z"));
      const blocked = healBridge({
        tokenRowId: TOKEN_ID,
        userId: USER_ID,
        deadSecretId: first.newBridgeSecretId,
      });
      const outcome = blocked.catch((e) => e);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await outcome).toBeInstanceOf(BridgeUnavailableError);
      expect(generateLink).toHaveBeenCalledTimes(1);
      expect(db.tokens[0].bridge_secret_id).toBe(first.newBridgeSecretId);

      // After the window it may heal again.
      vi.setSystemTime(new Date("2026-11-15T10:01:31Z"));
      const second = await healBridge({
        tokenRowId: TOKEN_ID,
        userId: USER_ID,
        deadSecretId: first.newBridgeSecretId,
      });
      expect(generateLink).toHaveBeenCalledTimes(2);
      expect([...db.vault.keys()]).toEqual([second.newBridgeSecretId]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to heal a connection that was revoked", async () => {
    const dead = connect(expiredPayload());
    db.tokens.length = 0;

    await expect(heal(dead)).rejects.toBeInstanceOf(BridgeRevokedError);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("surfaces a mint failure, stores nothing, and keeps the cooldown", async () => {
    const dead = connect(expiredPayload());
    getUserById.mockResolvedValueOnce({
      data: { user: { id: USER_ID, email: null } },
      error: null,
    });

    await expect(heal(dead)).rejects.toThrow(
      "User has no email; cannot bridge.",
    );
    expect(db.tokens[0].bridge_secret_id).toBe(dead);
    expect([...db.vault.keys()]).toEqual([dead]);
    // The failed attempt still counts against the window: no retry storm.
    await expect(heal(dead)).rejects.toBeInstanceOf(BridgeUnavailableError);
    expect(getUserById).toHaveBeenCalledTimes(1);
  });

  it("stores nothing when the swap loses after the mint", async () => {
    const dead = connect(expiredPayload());
    let winner = "";
    verifyOtp.mockImplementationOnce(async () => {
      // Another server instance replaced the secret while this one was minting.
      winner = db.putSecret(freshPayload("access-winner"));
      db.tokens[0].bridge_secret_id = winner;
      db.vault.delete(dead);
      return { data: { session: session() }, error: null };
    });

    const { client, newBridgeSecretId } = await heal(dead);

    expect(newBridgeSecretId).toBe(winner);
    expect(bearerOf(client)).toBe("Bearer access-winner");
    expect([...db.vault.keys()]).toEqual([winner]);
  });

  it("reports a failed claim as retryable without minting", async () => {
    const dead = connect(expiredPayload());
    db.failNext("update", "deadlock detected");
    await expect(heal(dead)).rejects.toBeInstanceOf(BridgeUnavailableError);
    expect(generateLink).not.toHaveBeenCalled();
  });
});
