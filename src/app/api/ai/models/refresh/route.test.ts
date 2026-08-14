import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signBody, SIGNED_BODY_MAX_AGE_SECONDS } from "@/lib/ai/agentic/hmac";

const SECRET = "test-models-refresh-hmac-secret-at-least-32-chars";

// getServerEnv is mocked so the route sees a provisioned secret without a real
// env. hmac (signBody/verifyFreshSignedBody) is REAL — the test signs the exact
// body the route verifies, exercising the actual HMAC + freshness boundary.
const serverEnv = vi.fn(() => ({ AI_PGNET_HMAC_SECRET: SECRET }));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => serverEnv() }));

const SERVICE_CLIENT = { tag: "service-client" };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => SERVICE_CLIENT,
}));

const refreshCatalog = vi.fn(async () => ({ upserted: 3, retired: 0 }));
vi.mock("@/lib/ai/models/refresh", () => ({
  fetchGatewayFeed: vi.fn(),
  refreshCatalog: (...a: unknown[]) => refreshCatalog(...(a as [])),
}));

import { POST } from "./route";

/**
 * The exact serialization `_ai_models_refresh_tick()` sends: `jsonb::text`
 * orders keys by length then bytewise and puts a space after each colon. The
 * route verifies the RAW body, so this string — not a JS-natural key order —
 * is what must round-trip.
 */
function tickBody(opts: { ageSeconds?: number; withTs?: boolean } = {}) {
  const ts = Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0);
  return opts.withTs === false
    ? `{"mode": "refresh"}`
    : `{"ts": ${ts}, "mode": "refresh", "nonce": "b925a57658125e6c9347d381c45c4a2e"}`;
}

function req(raw: string, sig?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sig !== undefined) headers["x-pulse-signature"] = sig;
  return new Request("http://x/api/ai/models/refresh", {
    method: "POST",
    headers,
    body: raw,
  });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  serverEnv.mockReturnValue({ AI_PGNET_HMAC_SECRET: SECRET });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("POST /api/ai/models/refresh", () => {
  it("503s when the HMAC secret is not provisioned", async () => {
    serverEnv.mockReturnValue({ AI_PGNET_HMAC_SECRET: undefined } as never);
    const res = await POST(req(tickBody()));
    expect(res.status).toBe(503);
    expect(refreshCatalog).not.toHaveBeenCalled();
  });

  it("runs the refresh for a freshly signed cron body", async () => {
    const raw = tickBody();
    const res = await POST(req(raw, signBody(raw, SECRET)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ upserted: 3 });
    expect(refreshCatalog).toHaveBeenCalledTimes(1);
  });

  it("401s an unsigned body", async () => {
    const res = await POST(req(tickBody()));
    expect(res.status).toBe(401);
    expect(refreshCatalog).not.toHaveBeenCalled();
  });

  it("401s a body whose signature is for a different payload", async () => {
    const res = await POST(req(tickBody(), signBody("{}", SECRET)));
    expect(res.status).toBe(401);
    expect(refreshCatalog).not.toHaveBeenCalled();
  });

  it("401s a captured request replayed after the freshness window", async () => {
    // Intact capture, valid signature, only stale. This is the vulnerability:
    // before the ts/nonce change this exact request replayed forever, and each
    // replay spent a borrowed user credential on outbound provider calls.
    const raw = tickBody({ ageSeconds: SIGNED_BODY_MAX_AGE_SECONDS + 60 });
    const res = await POST(req(raw, signBody(raw, SECRET)));
    expect(res.status).toBe(401);
    expect(refreshCatalog).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[ai/models/refresh] rejected signed body:",
      expect.objectContaining({ reason: "stale" }),
    );
  });

  it("401s a validly signed body with no timestamp (pre-migration signer)", async () => {
    const raw = tickBody({ withTs: false });
    const res = await POST(req(raw, signBody(raw, SECRET)));
    expect(res.status).toBe(401);
    expect(warn).toHaveBeenCalledWith(
      "[ai/models/refresh] rejected signed body:",
      expect.objectContaining({ reason: "missing_timestamp" }),
    );
  });

  it("401s a body whose timestamp was rewritten to look fresh", async () => {
    const stale = tickBody({ ageSeconds: 10_000 });
    const forged = tickBody();
    const res = await POST(req(forged, signBody(stale, SECRET)));
    expect(res.status).toBe(401);
    expect(warn).toHaveBeenCalledWith(
      "[ai/models/refresh] rejected signed body:",
      expect.objectContaining({ reason: "bad_signature" }),
    );
  });

  it("never logs the secret, the signature or the body on rejection", async () => {
    const raw = tickBody({ ageSeconds: SIGNED_BODY_MAX_AGE_SECONDS + 60 });
    const sig = signBody(raw, SECRET);
    await POST(req(raw, sig));
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(sig);
    expect(logged).not.toContain("nonce");
  });
});
