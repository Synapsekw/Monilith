import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { resetServerEnvForTests } from "@/lib/env.server";

const KEYS = [
  "NEXT_RUNTIME",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "VERCEL_ENV",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  resetServerEnvForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetServerEnvForTests();
  vi.restoreAllMocks();
});

describe("register", () => {
  it("no-ops outside the nodejs runtime (edge pass)", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await register();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs the env summary under nodejs", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await register();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[env] supabase ref"),
    );
  });

  it("rejects at boot when the server env is invalid", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await expect(register()).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("warns in production when ANTHROPIC_API_KEY is absent", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    process.env.VERCEL_ENV = "production";
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await register();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("ANTHROPIC_API_KEY"),
    );
  });
});
