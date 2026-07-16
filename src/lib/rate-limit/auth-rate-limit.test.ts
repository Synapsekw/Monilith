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
