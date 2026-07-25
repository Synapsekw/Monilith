import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, headerMap, serverEnv } = vi.hoisted(() => ({
  rpc: vi.fn(),
  headerMap: new Map<string, string>(),
  serverEnv: { value: {} as Record<string, unknown> },
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc }),
}));
vi.mock("next/headers", () => ({ headers: async () => headerMap }));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => serverEnv.value }));

import {
  checkRateLimit,
  hashIdentifier,
  getClientIp,
  throttleResult,
  RATE_LIMITS,
} from "./auth-rate-limit";

const allow = {
  data: [{ allowed: true, retry_after: 0, remaining: 5 }],
  error: null,
};
const deny = (retry = 42) => ({
  data: [{ allowed: false, retry_after: retry, remaining: 0 }],
  error: null,
});

beforeEach(() => {
  // Default: every rule allowed.
  rpc.mockReset().mockResolvedValue(allow);
  headerMap.clear();
  serverEnv.value = {};
});

describe("hashIdentifier", () => {
  it("is stable, hex, and normalizes case/whitespace", () => {
    expect(hashIdentifier("  User@Example.com ")).toBe(
      hashIdentifier("user@example.com"),
    );
    expect(hashIdentifier("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("getClientIp", () => {
  it("reads the first x-forwarded-for hop", async () => {
    headerMap.set("x-forwarded-for", "203.0.113.7, 10.0.0.1");
    expect(await getClientIp()).toBe("203.0.113.7");
  });
  it("falls back to x-real-ip when no x-forwarded-for is present", async () => {
    headerMap.set("x-real-ip", "198.51.100.9");
    expect(await getClientIp()).toBe("198.51.100.9");
  });
  it("falls back to a sentinel when no IP header is present", async () => {
    expect(await getClientIp()).toBe("unknown");
  });
});

describe("checkRateLimit", () => {
  it("allows when every rule is under the cap", async () => {
    const d = await checkRateLimit({ endpoint: "signIn", email: "a@b.co" });
    expect(d).toEqual({ allowed: true });
  });

  it("denies (most-restrictive-wins) and returns retry_after", async () => {
    rpc.mockResolvedValueOnce(deny(42));
    const d = await checkRateLimit({ endpoint: "signIn", email: "a@b.co" });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 42 });
  });

  it("fails OPEN when the RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const d = await checkRateLimit({ endpoint: "signIn", email: "a@b.co" });
    expect(d).toEqual({ allowed: true });
  });
});

describe("signIn global per-email cap (owner decision)", () => {
  it("has an email-dimension rule of 30 / 15 min in addition to ip and ip_email", () => {
    const dims = RATE_LIMITS.signIn.map((r) => r.dimension);
    expect(dims).toEqual(expect.arrayContaining(["ip_email", "ip", "email"]));
    const emailRule = RATE_LIMITS.signIn.find((r) => r.dimension === "email");
    expect(emailRule).toMatchObject({ limit: 30, windowSeconds: 15 * 60 });
  });

  it("throttles signIn when ONLY the global per-email rule trips", async () => {
    // ip_email allowed, ip allowed, email DENIED — a 2-rule config would never
    // reach this third call, so a pass proves the email cap is wired in.
    rpc
      .mockReset()
      .mockResolvedValueOnce(allow) // ip_email
      .mockResolvedValueOnce(allow) // ip
      .mockResolvedValueOnce(deny(200)); // email
    const d = await checkRateLimit({ endpoint: "signIn", email: "a@b.co" });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 200 });
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe("throttleResult", () => {
  it("returns a generic error with no PII or account signal", () => {
    const r = throttleResult("signUp", 120);
    expect(r.error).toBeTruthy();
    expect(r.error).not.toMatch(/@|exist|account|found/i);
    expect(r.success).toBeUndefined();
  });
});

describe("oauthRegister (RFC 7591 dynamic client registration)", () => {
  it("configures an ip burst rule and a global ceiling rule", () => {
    expect(RATE_LIMITS.oauthRegister).toEqual([
      { dimension: "ip", limit: 10, windowSeconds: 600 },
      { dimension: "global", limit: 200, windowSeconds: 3600 },
    ]);
  });

  it("evaluates ip then global, with a hashed ip key and a literal global key", async () => {
    headerMap.set("x-forwarded-for", "203.0.113.7");
    const d = await checkRateLimit({ endpoint: "oauthRegister" });
    expect(d).toEqual({ allowed: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "check_rate_limit", {
      p_key: `oauthRegister:ip:${hashIdentifier("203.0.113.7")}`,
      p_limit: 10,
      p_window_seconds: 600,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "check_rate_limit", {
      p_key: "oauthRegister:global",
      p_limit: 200,
      p_window_seconds: 3600,
    });
  });

  it("never puts a plaintext IP in the bucket key", async () => {
    headerMap.set("x-forwarded-for", "203.0.113.7");
    await checkRateLimit({ endpoint: "oauthRegister" });
    const [, args] = rpc.mock.calls[0] as [string, { p_key: string }];
    expect(args.p_key).not.toContain("203.0.113.7");
    expect(args.p_key).toMatch(/^oauthRegister:ip:[0-9a-f]{64}$/);
  });

  it("denies on the ip rule and short-circuits the global RPC", async () => {
    rpc.mockReset().mockResolvedValueOnce(deny(120));
    const d = await checkRateLimit({ endpoint: "oauthRegister" });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 120 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("denies when ONLY the global ceiling trips", async () => {
    // ip allowed, global DENIED — a one-rule config could never reach this
    // second call, so a pass proves the global backstop is actually wired.
    rpc
      .mockReset()
      .mockResolvedValueOnce(allow) // ip
      .mockResolvedValueOnce(deny(3000)); // global
    const d = await checkRateLimit({ endpoint: "oauthRegister" });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 3000 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("scales both caps by AUTH_RATE_LIMIT_MULTIPLIER", async () => {
    serverEnv.value = { AUTH_RATE_LIMIT_MULTIPLIER: 2 };
    await checkRateLimit({ endpoint: "oauthRegister" });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "check_rate_limit",
      expect.objectContaining({ p_limit: 20 }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "check_rate_limit",
      expect.objectContaining({ p_limit: 400 }),
    );
  });

  it("fails CLOSED when the RPC errors", async () => {
    rpc
      .mockReset()
      .mockResolvedValue({ data: null, error: { message: "db down" } });
    const d = await checkRateLimit({ endpoint: "oauthRegister" });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("fails CLOSED when the RPC throws", async () => {
    rpc.mockReset().mockRejectedValue(new Error("network timeout"));
    const d = await checkRateLimit({ endpoint: "oauthRegister" });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("leaves every other endpoint failing OPEN (the divergence is endpoint-scoped)", async () => {
    rpc
      .mockReset()
      .mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(
      checkRateLimit({ endpoint: "signIn", email: "a@b.co" }),
    ).resolves.toEqual({ allowed: true });
    rpc.mockReset().mockRejectedValue(new Error("boom"));
    await expect(
      checkRateLimit({ endpoint: "signUp", email: "a@b.co" }),
    ).resolves.toEqual({ allowed: true });
  });
});
