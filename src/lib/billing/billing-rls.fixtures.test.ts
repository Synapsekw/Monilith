import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import {
  type FixtureTenant,
  TIER2_FIXTURE_PASSWORD,
  TIER2_FIXTURE_TENANTS,
  loadFixtureEnv,
  resolveFixtureTarget,
} from "@/test/tenant-fixtures";
import type { Database } from "@/types/database.types";

// ===========================================================================
// Deny-all means deny-all — proven against the LIVE DEV project.
// ===========================================================================
//
// The conformance tier proves a LOGGED-OUT visitor reaches nothing. The
// realistic attacker on a billing table is a SIGNED-IN member of a real org
// reading their OWN row: org_billing carries the Stripe customer and
// subscription ids, and billing_discount_codes is, in effect, free money.
// Neither table has a single RLS policy — that is the deny — and this suite is
// what proves the deny is real rather than intended.
//
// ANTI-VACUITY IS LOAD-BEARING. "Returned no rows" is only evidence if the
// client is genuinely authenticated. signInOrThrow throws rather than yielding
// a silently signed-out client, and the first assertion proves the session can
// read something it IS entitled to. Without that, every assertion below would
// pass against a logged-out client.

loadFixtureEnv();

const resolution = resolveFixtureTarget(process.env);

if (!resolution.ok) {
  console.info(`[billing-rls] skipped — ${resolution.reason}`);
}

const [ALPHA, BETA] = TIER2_FIXTURE_TENANTS;

describe.skipIf(!resolution.ok)(
  "billing tables are not tenant-readable",
  () => {
    const target = resolution.ok ? resolution.target : null;
    let client: SupabaseClient<Database>;

    async function signIn(fixture: FixtureTenant) {
      const c = createClient<Database>(target!.url, target!.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInOrThrow(
        c,
        { email: fixture.email, password: TIER2_FIXTURE_PASSWORD },
        `tier-2 fixture ${fixture.label}`,
      );
      return c;
    }

    beforeAll(async () => {
      client = await signIn(ALPHA);
    }, 120_000);

    it("has a genuinely authenticated session (anti-vacuity)", async () => {
      // If this fails, every "no rows" assertion below is meaningless.
      const { data, error } = await client
        .from("organizations")
        .select("id")
        .eq("id", ALPHA.orgId);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: ALPHA.orgId }]);
    });

    it("returns no org_billing rows for the caller's own org", async () => {
      const { data, error } = await client
        .from("org_billing")
        .select("org_id")
        .eq("org_id", ALPHA.orgId);
      // RLS with no policies yields an empty set rather than an error. Either is
      // acceptable evidence; a non-empty set is not.
      expect(error !== null || data?.length === 0).toBe(true);
    });

    it("returns no billing_discount_codes rows at all", async () => {
      const { data, error } = await client
        .from("billing_discount_codes")
        .select("code");
      expect(error !== null || data?.length === 0).toBe(true);
    });

    it("never leaks a Stripe id through get_org_billing_status", async () => {
      const { data, error } = await client.rpc("get_org_billing_status", {
        p_org: ALPHA.orgId,
      });
      expect(error).toBeNull();
      const row = data?.[0];
      expect(row).toBeDefined();
      expect(Object.keys(row!)).not.toContain("stripe_customer_id");
      expect(Object.keys(row!)).not.toContain("stripe_subscription_id");
      // An org with no subscription reads as the synthetic none/none row, so
      // callers never have to branch on absent-vs-empty.
      expect(row!.tier).toBe("none");
      expect(row!.status).toBe("none");
    });

    it("refuses get_org_billing_status for an org the caller does not belong to", async () => {
      const { error } = await client.rpc("get_org_billing_status", {
        p_org: BETA.orgId,
      });
      expect(error).not.toBeNull();
    });
  },
);
