import { randomUUID } from "node:crypto";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import type { Database } from "@/types/database.types";

// Opt-in only: like every other `*.integration.test.ts`, this skips unless a
// SAFE, explicitly-marked test DB is wired (PULSE_TEST_DB=1 in `.env.test`).
// Default CI (and a plain DEV/PROD `.env.local`) skips it, so it never pollutes
// DEV/PROD. See src/test/integration-env.ts + function-execute-grants suite.
loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const KEY = `itest:${randomUUID()}`;

describe.skipIf(!integrationTargetReady())("check_rate_limit (DB)", () => {
  let admin: SupabaseClient<Database>;

  beforeAll(() => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterEach(async () => {
    await admin.from("auth_rate_limits").delete().eq("bucket_key", KEY);
  });

  it("allows up to the cap, then denies with a positive retry_after", async () => {
    const call = () =>
      admin.rpc("check_rate_limit", {
        p_key: KEY,
        p_limit: 2,
        p_window_seconds: 3600,
      });

    const r1 = await call();
    const r2 = await call();
    const r3 = await call();

    expect(r1.data?.[0]?.allowed).toBe(true);
    expect(r2.data?.[0]?.allowed).toBe(true);
    expect(r3.data?.[0]?.allowed).toBe(false);
    expect(r3.data?.[0]?.retry_after).toBeGreaterThan(0);
    expect(r3.data?.[0]?.retry_after).toBeLessThanOrEqual(3600);
  });

  it("resets the window when p_window_seconds has elapsed", async () => {
    // window = 1s: first call consumes it, sleep past the window, next resets.
    await admin.rpc("check_rate_limit", {
      p_key: KEY,
      p_limit: 1,
      p_window_seconds: 1,
    });
    const denied = await admin.rpc("check_rate_limit", {
      p_key: KEY,
      p_limit: 1,
      p_window_seconds: 1,
    });
    expect(denied.data?.[0]?.allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 1100));

    const reset = await admin.rpc("check_rate_limit", {
      p_key: KEY,
      p_limit: 1,
      p_window_seconds: 1,
    });
    expect(reset.data?.[0]?.allowed).toBe(true);
  });
});
