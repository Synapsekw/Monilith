import { beforeEach, describe, expect, it, vi } from "vitest";
import { signBody } from "@/lib/ai/agentic/hmac";

const SECRET = "test-embed-hmac-secret-at-least-32-chars-long";

// getServerEnv is mocked so the route sees a provisioned secret without a real
// env. hmac (signBody/verifyBody) is REAL — the test signs the exact body the
// route verifies, exercising the actual HMAC boundary.
const serverEnv = vi.fn(() => ({ AI_PGNET_HMAC_SECRET: SECRET }));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => serverEnv() }));

const embedBatch = vi.fn(async () => ({
  embedded: 2,
  skipped: 0,
  notIndexed: 0,
}));
const embedBackfill = vi.fn(async () => ({
  embedded: 1,
  skipped: 0,
  notIndexed: 0,
  processed: 1,
  nextCursor: null,
}));
vi.mock("@/lib/ai/embeddings/index-actions", () => ({
  embedBatch: (...a: unknown[]) => embedBatch(...(a as [])),
  embedBackfill: (...a: unknown[]) => embedBackfill(...(a as [])),
}));

import { POST } from "./route";

const ITEM = "11111111-1111-4111-8111-111111111111";

function req(body: unknown, opts: { sign?: boolean; url?: string } = {}) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.sign !== false) headers["x-pulse-signature"] = signBody(raw, SECRET);
  return new Request(opts.url ?? "http://x/api/ai/embed", {
    method: "POST",
    headers,
    body: raw,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  serverEnv.mockReturnValue({ AI_PGNET_HMAC_SECRET: SECRET });
});

describe("POST /api/ai/embed", () => {
  it("503s when the pipeline secret is not provisioned", async () => {
    serverEnv.mockReturnValue({ AI_PGNET_HMAC_SECRET: undefined } as never);
    const res = await POST(req({ mode: "sweep", batch: [ITEM] }));
    expect(res.status).toBe(503);
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it("401s an unsigned body (no HMAC)", async () => {
    const res = await POST(
      req({ mode: "sweep", batch: [ITEM] }, { sign: false }),
    );
    expect(res.status).toBe(401);
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it("401s a tampered body (signature for a different payload)", async () => {
    const raw = JSON.stringify({ mode: "sweep", batch: [ITEM] });
    const tampered = new Request("http://x/api/ai/embed", {
      method: "POST",
      headers: { "x-pulse-signature": signBody("{}", SECRET) },
      body: raw,
    });
    const res = await POST(tampered);
    expect(res.status).toBe(401);
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it("sweep mode embeds the signed batch", async () => {
    const res = await POST(req({ mode: "sweep", batch: [ITEM] }));
    expect(res.status).toBe(200);
    expect(embedBatch).toHaveBeenCalledWith([ITEM], { userId: null });
    expect(await res.json()).toMatchObject({ mode: "sweep", embedded: 2 });
  });

  it("backfill mode (via ?mode=backfill) pages items resumably", async () => {
    const res = await POST(
      req({ limit: 50 }, { url: "http://x/api/ai/embed?mode=backfill" }),
    );
    expect(res.status).toBe(200);
    expect(embedBackfill).toHaveBeenCalledWith(
      { cursor: null, limit: 50 },
      { userId: null },
    );
    expect(await res.json()).toMatchObject({
      mode: "backfill",
      nextCursor: null,
    });
  });

  it("400s an unknown mode", async () => {
    const res = await POST(req({ mode: "nope" }));
    expect(res.status).toBe(400);
  });
});
