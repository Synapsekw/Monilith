import { afterEach, beforeEach, describe, expect, it } from "vitest";

// `isSafeTestTarget` / `integrationTargetReady` are pure predicates over
// process.env + the URL, so they are directly unit-testable with no
// filesystem/network. (The .env.local/.env.test file-merge in
// loadIntegrationEnv is exercised by the opt-in integration skip-run, not
// duplicated here.)
import { integrationTargetReady, isSafeTestTarget } from "./integration-env";

const PROD_REF = "jzsyqhxynswolgijkktn";
const DEV_REF = "hjqcahbbbdaknbbnfnvl";

// Snapshot + restore the env keys these predicates read, so tests are isolated.
const ENV_KEYS = [
  "PULSE_TEST_DB",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("isSafeTestTarget", () => {
  it("refuses the PROD project URL even with the opt-in marker", () => {
    process.env.PULSE_TEST_DB = "1";
    expect(isSafeTestTarget(`https://${PROD_REF}.supabase.co`)).toBe(false);
  });

  it("refuses the DEV project URL even with the opt-in marker", () => {
    process.env.PULSE_TEST_DB = "1";
    expect(isSafeTestTarget(`https://${DEV_REF}.supabase.co`)).toBe(false);
  });

  it("refuses when PULSE_TEST_DB is not set", () => {
    delete process.env.PULSE_TEST_DB;
    expect(isSafeTestTarget("https://sometest.supabase.co")).toBe(false);
  });

  it("refuses when PULSE_TEST_DB is not exactly '1'", () => {
    process.env.PULSE_TEST_DB = "true";
    expect(isSafeTestTarget("https://sometest.supabase.co")).toBe(false);
  });

  it("accepts a distinct test URL with PULSE_TEST_DB=1", () => {
    process.env.PULSE_TEST_DB = "1";
    expect(isSafeTestTarget("https://pulse-test.supabase.co")).toBe(true);
  });

  it("refuses an empty/undefined URL", () => {
    process.env.PULSE_TEST_DB = "1";
    expect(isSafeTestTarget(undefined)).toBe(false);
    expect(isSafeTestTarget("")).toBe(false);
  });
});

describe("integrationTargetReady", () => {
  it("is false when there is no service-role key", () => {
    process.env.PULSE_TEST_DB = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://pulse-test.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(integrationTargetReady()).toBe(false);
  });

  it("is false when the target is DEV (no marker), even with a service-role", () => {
    delete process.env.PULSE_TEST_DB;
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${DEV_REF}.supabase.co`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "dev-service-role";
    expect(integrationTargetReady()).toBe(false);
  });

  it("is false when the target is PROD", () => {
    process.env.PULSE_TEST_DB = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${PROD_REF}.supabase.co`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "prod-service-role";
    expect(integrationTargetReady()).toBe(false);
  });

  it("is true for a distinct test target with marker + service-role", () => {
    process.env.PULSE_TEST_DB = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://pulse-test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    expect(integrationTargetReady()).toBe(true);
  });
});
