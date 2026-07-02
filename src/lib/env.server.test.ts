import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getServerEnv,
  resetServerEnvForTests,
  serverEnvSummary,
} from "@/lib/env.server";
import { SUPABASE_PROJECT_REFS } from "@/lib/supabase/project-refs";

// vitest.setup.ts seeds NEXT_PUBLIC_* placeholders but NOT the server vars —
// each test states its own env, mirroring src/test/integration-env.test.ts.
const KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"] as const;
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
});

describe("getServerEnv", () => {
  it("throws a clear aggregated error when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    expect(() => getServerEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => getServerEnv()).toThrow(/Invalid server environment/);
  });

  it("rejects an empty-string service key (duplicate-key/last-wins symptom)", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
    expect(() => getServerEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("returns typed values when the env is valid", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const env = getServerEnv();
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("service-role-test");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
  });

  it("treats ANTHROPIC_API_KEY as optional", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    expect(getServerEnv().ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("memoizes: a later process.env mutation is not re-read", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "first";
    expect(getServerEnv().SUPABASE_SERVICE_ROLE_KEY).toBe("first");
    process.env.SUPABASE_SERVICE_ROLE_KEY = "second";
    expect(getServerEnv().SUPABASE_SERVICE_ROLE_KEY).toBe("first");
  });

  it("resetServerEnvForTests re-arms the parse", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "first";
    getServerEnv();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "second";
    resetServerEnvForTests();
    expect(getServerEnv().SUPABASE_SERVICE_ROLE_KEY).toBe("second");
  });
});

describe("serverEnvSummary", () => {
  it("prints ref, label, and presence flags — never key material", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "super-secret-role-key";
    const line = serverEnvSummary();
    // vitest.setup.ts pins NEXT_PUBLIC_SUPABASE_URL to http://localhost:54321.
    expect(line).toContain("[env] supabase ref localhost (UNKNOWN)");
    expect(line).toContain("service role: present");
    expect(line).toContain("anthropic: absent");
    expect(line).not.toContain("super-secret-role-key");
  });

  it("shows anthropic: present when the key is set", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "role";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(serverEnvSummary()).toContain("anthropic: present");
    expect(serverEnvSummary()).not.toContain("sk-ant-x");
  });

  it("known refs get their DEV label", () => {
    // Sanity: the label helper feeding the summary knows the real refs.
    expect(SUPABASE_PROJECT_REFS.dev).toHaveLength(20);
  });
});
