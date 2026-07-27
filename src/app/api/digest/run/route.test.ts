import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "d".repeat(32);

const serverEnv = vi.fn<() => { DIGEST_SECRET?: string }>(() => ({
  DIGEST_SECRET: SECRET,
}));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => serverEnv() }));

const runWeeklyDigest = vi.fn(async () => ({
  processed: 1,
  sent: 1,
  skipped: 0,
  failed: 0,
}));
vi.mock("@/lib/digest/run", () => ({
  runWeeklyDigest: () => runWeeklyDigest(),
}));

const recordDigestBlocked = vi.fn<(reason: string) => Promise<void>>(
  async () => {},
);
vi.mock("@/lib/digest/blocked", () => ({
  recordDigestBlocked: (reason: string) => recordDigestBlocked(reason),
}));

import { POST } from "./route";

function req(token?: string) {
  return new Request("http://x/api/digest/run", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  serverEnv.mockReturnValue({ DIGEST_SECRET: SECRET });
});

describe("POST /api/digest/run", () => {
  it("records a blocked run when the digest secret is not provisioned", async () => {
    serverEnv.mockReturnValue({});

    const res = await POST(req());

    expect(res.status).toBe(503);
    expect(recordDigestBlocked).toHaveBeenCalledTimes(1);
    expect(recordDigestBlocked).toHaveBeenCalledWith(
      expect.stringContaining("DIGEST_SECRET"),
    );
    expect(runWeeklyDigest).not.toHaveBeenCalled();
  });

  it("does not record a blocked run merely for a bad token", async () => {
    const res = await POST(req("wrong"));

    expect(res.status).toBe(401);
    expect(recordDigestBlocked).not.toHaveBeenCalled();
    expect(runWeeklyDigest).not.toHaveBeenCalled();
  });

  it("runs the digest for an authorized ping", async () => {
    const res = await POST(req(SECRET));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ sent: 1 });
    expect(recordDigestBlocked).not.toHaveBeenCalled();
  });
});
