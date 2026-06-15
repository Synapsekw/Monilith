import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_URL = "https://example.supabase.co";
const VALID_ANON_KEY = "anon-key-123";

describe("env", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", VALID_ANON_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses a valid environment", async () => {
    const { env } = await import("./env");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(VALID_URL);
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(VALID_ANON_KEY);
  });

  it("throws when a required var is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await expect(import("./env")).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws when the url is not a valid url", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    await expect(import("./env")).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
