import { describe, expect, it } from "vitest";
import {
  SIGNED_BODY_MAX_AGE_SECONDS,
  SIGNED_BODY_MAX_FUTURE_SECONDS,
  signBody,
  verifyBody,
  verifyFreshSignedBody,
} from "./hmac";

const SECRET = "test-secret";
describe("agentic hmac", () => {
  it("round-trips a signed body", () => {
    const body = JSON.stringify({ job_id: "j1" });
    expect(verifyBody(body, signBody(body, SECRET), SECRET)).toBe(true);
  });
  it("rejects a tampered body", () => {
    const sig = signBody(JSON.stringify({ job_id: "j1" }), SECRET);
    expect(verifyBody(JSON.stringify({ job_id: "j2" }), sig, SECRET)).toBe(
      false,
    );
  });
  it("rejects a wrong secret", () => {
    const body = JSON.stringify({ job_id: "j1" });
    expect(verifyBody(body, signBody(body, SECRET), "other")).toBe(false);
  });
});

// The DB signs `jsonb::text`, which orders keys by length then bytewise and
// puts a space after every colon — `{"ts": …, "mode": …, "nonce": …}`. These
// tests use that exact serialization rather than a JS-natural key order, so a
// drift between the two encodings shows up here.
const NOW_S = 1_786_000_000;
const NOW_MS = NOW_S * 1000;

function pgBody(
  ts: number | null,
  nonce: string | null = "b925a57658125e6c9347d381c45c4a2e",
): string {
  const parts: string[] = [];
  if (ts !== null) parts.push(`"ts": ${ts}`);
  parts.push(`"mode": "refresh"`);
  if (nonce !== null) parts.push(`"nonce": "${nonce}"`);
  return `{${parts.join(", ")}}`;
}

function signed(body: string) {
  return { body, sig: signBody(body, SECRET) };
}

describe("verifyFreshSignedBody", () => {
  it("accepts a freshly signed body and returns its ts + nonce", () => {
    const { body, sig } = signed(pgBody(NOW_S));
    const res = verifyFreshSignedBody(body, sig, SECRET, { nowMs: NOW_MS });
    expect(res).toMatchObject({
      ok: true,
      ts: NOW_S,
      nonce: "b925a57658125e6c9347d381c45c4a2e",
    });
    if (res.ok) expect(res.payload.mode).toBe("refresh");
  });

  it("accepts a body at the far edge of the past window", () => {
    const ts = NOW_S - SIGNED_BODY_MAX_AGE_SECONDS;
    const { body, sig } = signed(pgBody(ts));
    expect(verifyFreshSignedBody(body, sig, SECRET, { nowMs: NOW_MS }).ok).toBe(
      true,
    );
  });

  it("rejects a body one second past the window as stale", () => {
    const ts = NOW_S - SIGNED_BODY_MAX_AGE_SECONDS - 1;
    const { body, sig } = signed(pgBody(ts));
    expect(verifyFreshSignedBody(body, sig, SECRET, { nowMs: NOW_MS })).toEqual(
      {
        ok: false,
        reason: "stale",
        ageSeconds: SIGNED_BODY_MAX_AGE_SECONDS + 1,
      },
    );
  });

  it("rejects a body too far in the future (signer clock ahead)", () => {
    const ts = NOW_S + SIGNED_BODY_MAX_FUTURE_SECONDS + 1;
    const { body, sig } = signed(pgBody(ts));
    const res = verifyFreshSignedBody(body, sig, SECRET, { nowMs: NOW_MS });
    expect(res).toMatchObject({ ok: false, reason: "future" });
  });

  it("tolerates modest clock skew in both directions", () => {
    // Past tolerance is wider than future tolerance on purpose: transport
    // latency only ever makes a ts look older. -120 = signed 120s ago.
    for (const skew of [-120, -30, -1, 0, 1, 30, 60]) {
      const { body, sig } = signed(pgBody(NOW_S + skew));
      expect(
        verifyFreshSignedBody(body, sig, SECRET, { nowMs: NOW_MS }).ok,
      ).toBe(true);
    }
  });

  it("rejects a tampered timestamp — the HMAC fails FIRST, not the window", () => {
    // Capture a stale body, then rewrite its ts to `now` to slip past the
    // freshness check. The signature no longer covers the new bytes, so the
    // rejection must be `bad_signature` (i.e. we never trusted the field).
    const stale = pgBody(NOW_S - 10_000);
    const sig = signBody(stale, SECRET);
    const forged = pgBody(NOW_S);
    expect(
      verifyFreshSignedBody(forged, sig, SECRET, { nowMs: NOW_MS }),
    ).toEqual({ ok: false, reason: "bad_signature", ageSeconds: null });
  });

  it("rejects a tampered nonce with bad_signature too", () => {
    const { sig } = signed(pgBody(NOW_S));
    const forged = pgBody(NOW_S, "deadbeefdeadbeefdeadbeefdeadbeef");
    expect(
      verifyFreshSignedBody(forged, sig, SECRET, { nowMs: NOW_MS }).ok,
    ).toBe(false);
  });

  it("rejects a captured request replayed after the window passes", () => {
    // The whole point: an intact, correctly-signed capture. It is accepted
    // while fresh and refused once the window has elapsed — the old constant
    // body would have been accepted forever.
    const { body, sig } = signed(pgBody(NOW_S));
    expect(
      verifyFreshSignedBody(body, sig, SECRET, { nowMs: NOW_MS + 60_000 }).ok,
    ).toBe(true);
    const replayed = verifyFreshSignedBody(body, sig, SECRET, {
      nowMs: NOW_MS + (SIGNED_BODY_MAX_AGE_SECONDS + 60) * 1000,
    });
    expect(replayed).toMatchObject({ ok: false, reason: "stale" });
  });

  it("rejects a validly signed body with NO timestamp (old signer)", () => {
    const { body, sig } = signed(`{"mode": "refresh"}`);
    expect(verifyFreshSignedBody(body, sig, SECRET, { nowMs: NOW_MS })).toEqual(
      {
        ok: false,
        reason: "missing_timestamp",
        ageSeconds: null,
      },
    );
  });

  it("rejects a non-numeric timestamp", () => {
    const { body, sig } = signed(`{"ts": "1786000000", "mode": "refresh"}`);
    expect(
      verifyFreshSignedBody(body, sig, SECRET, { nowMs: NOW_MS }),
    ).toMatchObject({ ok: false, reason: "missing_timestamp" });
  });

  it("rejects a validly signed body with no nonce", () => {
    const { body, sig } = signed(pgBody(NOW_S, null));
    expect(
      verifyFreshSignedBody(body, sig, SECRET, { nowMs: NOW_MS }),
    ).toMatchObject({ ok: false, reason: "missing_nonce" });
  });

  it("rejects a wrong secret before looking at freshness", () => {
    const { body, sig } = signed(pgBody(NOW_S));
    expect(
      verifyFreshSignedBody(body, sig, "other-secret", { nowMs: NOW_MS }),
    ).toEqual({ ok: false, reason: "bad_signature", ageSeconds: null });
  });

  it("rejects a signed body that is not JSON, and one that is not an object", () => {
    const notJson = signed("not json at all");
    expect(
      verifyFreshSignedBody(notJson.body, notJson.sig, SECRET, {
        nowMs: NOW_MS,
      }),
    ).toMatchObject({ ok: false, reason: "malformed_body" });

    const arr = signed(`[{"ts": ${NOW_S}}]`);
    expect(
      verifyFreshSignedBody(arr.body, arr.sig, SECRET, { nowMs: NOW_MS }),
    ).toMatchObject({ ok: false, reason: "malformed_body" });
  });

  it("accepts a body+signature captured from Postgres itself", () => {
    // NOT hand-written. Captured from the DEV database by running the EXACT
    // expressions of the deployed `public._ai_models_refresh_tick()` against a
    // throwaway probe secret (never the Vault one), so this pins the one thing
    // no unit test on either side alone can catch: that `jsonb::text` and this
    // verifier agree byte-for-byte. jsonb orders keys by LENGTH then bytewise
    // and emits a space after each colon, and `net.http_post` transmits
    // `convert_to(body::text,'UTF8')` — the same string that was HMAC'd. If
    // this test ever fails, the signer's serialization changed and the daily
    // refresh is about to start 401ing.
    const body = `{"ts": 1786631743, "mode": "refresh", "nonce": "0ccecc06e79f23c001a8f6c47f2554ec"}`;
    const sig =
      "4f123240ea7854afd76c09014239ef40c12e18ad5ff7d840638cf3eae1466d42";
    const probeSecret = "round-trip-probe-secret-not-the-real-one";

    expect(verifyBody(body, sig, probeSecret)).toBe(true);
    const res = verifyFreshSignedBody(body, sig, probeSecret, {
      nowMs: 1786631743 * 1000,
    });
    expect(res).toMatchObject({
      ok: true,
      ts: 1786631743,
      nonce: "0ccecc06e79f23c001a8f6c47f2554ec",
    });
  });

  it("honours caller-supplied window overrides", () => {
    const { body, sig } = signed(pgBody(NOW_S - 30));
    expect(
      verifyFreshSignedBody(body, sig, SECRET, {
        nowMs: NOW_MS,
        maxAgeSeconds: 10,
      }),
    ).toMatchObject({ ok: false, reason: "stale", ageSeconds: 30 });
  });
});
