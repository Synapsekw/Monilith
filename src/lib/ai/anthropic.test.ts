import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiNotConfiguredError, getAnthropicClient } from "@/lib/ai/anthropic";
import { resetServerEnvForTests } from "@/lib/env.server";

// The real SDK constructor refuses to run in a "browser-like" environment
// (jsdom) without dangerouslyAllowBrowser. The contract under test is the
// env-read + AiNotConfiguredError path, not the SDK itself — stub it.
vi.mock("@anthropic-ai/sdk", () => {
  class AnthropicStub {
    constructor(readonly opts: { apiKey: string }) {}
  }
  return { default: AnthropicStub };
});

const KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  // getServerEnv() requires the service key even on the AI path — seed it.
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  delete process.env.ANTHROPIC_API_KEY;
  resetServerEnvForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetServerEnvForTests();
});

describe("getAnthropicClient", () => {
  it("throws AiNotConfiguredError when ANTHROPIC_API_KEY is absent", () => {
    expect(() => getAnthropicClient()).toThrow(AiNotConfiguredError);
  });

  it("returns a client when the key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    resetServerEnvForTests();
    expect(getAnthropicClient()).toBeTruthy();
  });
});
