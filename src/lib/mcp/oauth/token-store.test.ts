import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeOauthClient } from "@/test/oauth-tokens-fake-client";

// A predicate-applying fake (see its header): every filter the store issues
// decides which rows a read returns and which rows an update touches.
let db: ReturnType<typeof fakeOauthClient>;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => db.client,
}));

import { hashToken } from "./crypto";
import {
  claimBridgeHeal,
  deleteTokensForUser,
  issueTokenPair,
  lookupTokenByAccessToken,
  readBridgeSecretId,
  REFRESH_TOKEN_IDLE_TTL_SECONDS,
  rotateTokenPair,
} from "./token-store";

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-15T10:00:00.000Z");

function at(offsetMs: number) {
  vi.setSystemTime(new Date(T0.getTime() + offsetMs));
}

beforeEach(() => {
  db = fakeOauthClient();
  vi.useFakeTimers({ now: T0 });
});
afterEach(() => {
  vi.useRealTimers();
});

const issue = (n: string) =>
  issueTokenPair({
    clientId: `client-${n}`,
    userId: `user-${n}`,
    bridgeSecretId: `secret-${n}`,
  });

describe("issueTokenPair / lookupTokenByAccessToken", () => {
  it("issues a token pair that can be looked up by its hash", async () => {
    const issued = await issue("1");
    expect(issued.accessToken).toBeTruthy();
    // Access-token lifetime is one hour and is not part of the idle window.
    expect(issued.expiresIn).toBe(3600);

    const found = await lookupTokenByAccessToken(issued.accessToken);
    expect(found?.user_id).toBe("user-1");
    expect(found?.access_token_hash).toBe(hashToken(issued.accessToken));
  });

  it("gives a new refresh token the full idle window", async () => {
    expect(REFRESH_TOKEN_IDLE_TTL_SECONDS).toBe(90 * 24 * 60 * 60);
    await issue("1");
    expect(db.tokens[0].refresh_token_expires_at).toBe(
      new Date(T0.getTime() + 90 * DAY_MS).toISOString(),
    );
  });

  it("does not resolve an expired access token", async () => {
    const issued = await issue("1");
    at(3601 * 1000);
    expect(await lookupTokenByAccessToken(issued.accessToken)).toBeNull();
  });

  it("does not resolve a revoked token", async () => {
    const issued = await issue("1");
    db.tokens[0].revoked_at = T0.toISOString();
    expect(await lookupTokenByAccessToken(issued.accessToken)).toBeNull();
  });
});

describe("lookupTokenByAccessToken — last_used_at", () => {
  it("does not write on a lookup inside the five-minute window", async () => {
    const issued = await issue("1");
    at(4 * 60 * 1000);
    await lookupTokenByAccessToken(issued.accessToken);
    expect(db.updates).toHaveLength(0);
    expect(db.tokens[0].last_used_at).toBe(T0.toISOString());
  });

  it("stamps last_used_at once the previous stamp is over five minutes old", async () => {
    const issued = await issue("1");
    at(6 * 60 * 1000);
    await lookupTokenByAccessToken(issued.accessToken);
    expect(db.tokens[0].last_used_at).toBe(
      new Date(T0.getTime() + 6 * 60 * 1000).toISOString(),
    );
    // …and the next call inside the new window is read-only again.
    at(7 * 60 * 1000);
    await lookupTokenByAccessToken(issued.accessToken);
    expect(db.updates).toHaveLength(1);
  });

  it("stamps only the token that was used", async () => {
    const a = await issue("a");
    await issue("b");
    at(10 * 60 * 1000);
    await lookupTokenByAccessToken(a.accessToken);
    expect(db.tokens[1].last_used_at).toBe(T0.toISOString());
  });

  it("still resolves the token when the stamp write fails", async () => {
    const issued = await issue("1");
    at(6 * 60 * 1000);
    db.failNext("update");
    const found = await lookupTokenByAccessToken(issued.accessToken);
    expect(found?.user_id).toBe("user-1");
  });
});

describe("rotateTokenPair (atomic)", () => {
  it("rotates a valid refresh token for the matching client", async () => {
    const issued = await issue("2");

    const rotated = await rotateTokenPair(issued.refreshToken, "client-2");

    expect(rotated).not.toBeNull();
    expect(rotated?.accessToken).not.toBe(issued.accessToken);
    expect(rotated?.refreshToken).not.toBe(issued.refreshToken);
    expect(db.tokens[0].refresh_token_hash).toBe(
      hashToken(rotated!.refreshToken),
    );
  });

  // A client whose token response was lost in transit (dropped connection,
  // retried request) still holds only the PREVIOUS refresh token. Without a
  // grace window that single lost response strands the connection for good.
  it("accepts the just-rotated refresh token again inside the grace window", async () => {
    const issued = await issue("3");

    const first = await rotateTokenPair(issued.refreshToken, "client-3");
    at(30 * 1000);
    const retry = await rotateTokenPair(issued.refreshToken, "client-3");

    expect(first).not.toBeNull();
    expect(retry).not.toBeNull();
    expect(retry?.refreshToken).not.toBe(first?.refreshToken);
    // The retry's pair is the live one.
    const found = await lookupTokenByAccessToken(retry!.accessToken);
    expect(found?.user_id).toBe("user-3");
  });

  it("rejects the previous refresh token once the grace window has passed", async () => {
    const issued = await issue("3b");
    await rotateTokenPair(issued.refreshToken, "client-3b");

    at(61 * 1000);
    const late = await rotateTokenPair(issued.refreshToken, "client-3b");

    expect(late).toBeNull();
  });

  it("does not let the grace window cross clients", async () => {
    const issued = await issue("3c");
    await rotateTokenPair(issued.refreshToken, "client-3c");

    expect(
      await rotateTokenPair(issued.refreshToken, "wrong-client"),
    ).toBeNull();
  });

  it("rejects a client_id mismatch and leaves the row alone", async () => {
    const issued = await issue("4");

    expect(
      await rotateTokenPair(issued.refreshToken, "wrong-client"),
    ).toBeNull();
    expect(db.tokens[0].refresh_token_hash).toBe(
      hashToken(issued.refreshToken),
    );
  });

  it("rejects a revoked token", async () => {
    const issued = await issue("5");
    db.tokens[0].revoked_at = T0.toISOString();
    expect(await rotateTokenPair(issued.refreshToken, "client-5")).toBeNull();
  });

  it("returns null for an unknown refresh token", async () => {
    expect(await rotateTokenPair("does-not-exist", "client-1")).toBeNull();
  });
});

describe("rotateTokenPair — sliding idle expiry", () => {
  // THE DEFECT: the UPDATE overwrote refresh_token_expires_at with the new
  // pair's expiry and read that back, so the expiry check could never fail and
  // a stolen refresh token stayed good forever.
  it("refuses a refresh token presented after its own expiry", async () => {
    const issued = await issue("x");
    const before = { ...db.tokens[0] };

    at(90 * DAY_MS + 1000);
    const rotated = await rotateTokenPair(issued.refreshToken, "client-x");

    expect(rotated).toBeNull();
    // Refused means untouched: no new pair was written over the expired one.
    expect(db.tokens[0]).toEqual(before);
  });

  it("still rotates on the last day of the window", async () => {
    const issued = await issue("y");
    at(90 * DAY_MS - 1000);
    expect(
      await rotateTokenPair(issued.refreshToken, "client-y"),
    ).not.toBeNull();
  });

  it("gives every rotation a fresh 90 days, so a connection in use never expires", async () => {
    let current = (await issue("z")).refreshToken;
    // Used every 60 days for a year: always inside the window.
    for (let i = 1; i <= 6; i++) {
      at(i * 60 * DAY_MS);
      const next = await rotateTokenPair(current, "client-z");
      expect(next, `rotation ${i}`).not.toBeNull();
      current = next!.refreshToken;
      expect(db.tokens[0].refresh_token_expires_at).toBe(
        new Date(T0.getTime() + (i * 60 + 90) * DAY_MS).toISOString(),
      );
    }
    // …then left idle for 90 days: it must reconnect.
    at((6 * 60 + 90) * DAY_MS + 1000);
    expect(await rotateTokenPair(current, "client-z")).toBeNull();
  });

  it("records the rotation as a use", async () => {
    const issued = await issue("u");
    at(2 * DAY_MS);
    await rotateTokenPair(issued.refreshToken, "client-u");
    expect(db.tokens[0].last_used_at).toBe(
      new Date(T0.getTime() + 2 * DAY_MS).toISOString(),
    );
  });

  // The grace path used to carry no expiry check at all.
  it("refuses the previous token on the grace path once that token's own expiry has passed", async () => {
    const issued = await issue("g");
    // Rotated 10 s before the original token's expiry…
    at(90 * DAY_MS - 10_000);
    expect(
      await rotateTokenPair(issued.refreshToken, "client-g"),
    ).not.toBeNull();
    const afterFirst = { ...db.tokens[0] };

    // …then replayed 30 s later: inside the 60 s grace window, but 20 s past
    // the expiry that applied to the token being presented.
    at(90 * DAY_MS + 20_000);
    const replay = await rotateTokenPair(issued.refreshToken, "client-g");

    expect(replay).toBeNull();
    expect(db.tokens[0]).toEqual(afterFirst);
  });

  it("keeps the grace window measured from the original rotation", async () => {
    const issued = await issue("h");
    await rotateTokenPair(issued.refreshToken, "client-h");
    at(50_000);
    expect(
      await rotateTokenPair(issued.refreshToken, "client-h"),
    ).not.toBeNull();
    // A replay must not extend the window it was accepted under.
    at(70_000);
    expect(await rotateTokenPair(issued.refreshToken, "client-h")).toBeNull();
  });

  // A database blip is not an invalid grant: answering "invalid_grant" makes
  // the client throw the connection away and ask the user to sign in again.
  it("throws on a database error instead of reporting the token invalid", async () => {
    const issued = await issue("e");
    db.failNext("select", "connection reset");
    await expect(
      rotateTokenPair(issued.refreshToken, "client-e"),
    ).rejects.toThrow(/connection reset/);

    db.failNext("update", "deadlock");
    await expect(
      rotateTokenPair(issued.refreshToken, "client-e"),
    ).rejects.toThrow(/deadlock/);
    // The token survived both failures.
    expect(
      await rotateTokenPair(issued.refreshToken, "client-e"),
    ).not.toBeNull();
  });
});

describe("deleteTokensForUser", () => {
  it("deletes every token of that user and nobody else's", async () => {
    await issue("a");
    await issue("a");
    await issue("b");
    await deleteTokensForUser("user-a");
    expect(db.tokens.map((t) => t.user_id)).toEqual(["user-b"]);
  });

  it("throws when the delete fails, so callers cannot report success", async () => {
    await issue("a");
    db.failNext("delete", "statement timeout");
    await expect(deleteTokensForUser("user-a")).rejects.toThrow(
      /statement timeout/,
    );
    expect(db.tokens).toHaveLength(1);
  });
});

describe("readBridgeSecretId / claimBridgeHeal", () => {
  it("reads the secret a token row currently points at", async () => {
    await issue("a");
    const id = db.tokens[0].id as string;
    expect(await readBridgeSecretId(id)).toEqual({
      found: true,
      bridgeSecretId: "secret-a",
    });
    expect(await readBridgeSecretId("no-such-row")).toEqual({ found: false });
  });

  it("treats a revoked row as gone", async () => {
    await issue("a");
    db.tokens[0].revoked_at = T0.toISOString();
    expect(await readBridgeSecretId(db.tokens[0].id as string)).toEqual({
      found: false,
    });
  });

  it("grants one heal per token per 60 seconds", async () => {
    await issue("a");
    const id = db.tokens[0].id as string;

    expect(await claimBridgeHeal(id, "secret-a")).toBe(true);
    at(59_000);
    expect(await claimBridgeHeal(id, "secret-a")).toBe(false);
    at(61_000);
    expect(await claimBridgeHeal(id, "secret-a")).toBe(true);
  });

  it("refuses the claim when the row no longer points at the dead secret", async () => {
    await issue("a");
    const id = db.tokens[0].id as string;
    expect(await claimBridgeHeal(id, "some-other-secret")).toBe(false);
    expect(db.tokens[0].bridge_healed_at).toBeNull();
  });

  it("does not let one token's cooldown block another's", async () => {
    await issue("a");
    await issue("b");
    expect(await claimBridgeHeal(db.tokens[0].id as string, "secret-a")).toBe(
      true,
    );
    expect(await claimBridgeHeal(db.tokens[1].id as string, "secret-b")).toBe(
      true,
    );
  });
});
