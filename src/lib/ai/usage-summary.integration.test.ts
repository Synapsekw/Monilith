import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!integrationTargetReady())(
  "ai_usage_summary + ai_usage_by_feature_this_month (integration)",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    let orgId: string;

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // A real org is required — ai_usage.org_id has an fkey to
      // organizations(id), and organizations.created_by is NOT NULL — so
      // provision a throwaway auth user + org via the proven self-service
      // path (create_organization RPC), same as the RLS precedent suite.
      const email = `usage-summary-${randomUUID()}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
        });
      expect(createErr, "createUser").toBeNull();
      const userId = created.user!.id;
      createdUserIds.push(userId);

      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInErr } = await signInWithRetry(anon, {
        email,
        password: PASSWORD,
      });
      expect(signInErr, "signIn").toBeNull();

      const { data: org, error: orgErr } = await anon.rpc(
        "create_organization",
        {
          p_name: "usage-summary-fixture",
          p_slug: `usage-summary-${randomUUID().slice(0, 8)}`,
        },
      );
      expect(orgErr, "create_organization").toBeNull();
      orgId = (org as { id: string }).id;
      createdOrgIds.push(orgId);

      // Seed two ai_usage rows in the current month for this org, one per
      // feature, via the service client (bypasses RLS — there is no client
      // write path onto ai_usage).
      const { error: insErr } = await admin.from("ai_usage").insert([
        {
          org_id: orgId,
          user_id: null,
          feature: "ask_pulse",
          provider: "anthropic",
          model: "claude-sonnet-5",
          input_tokens: 100,
          output_tokens: 50,
          cost_usd: 0.01,
          credits: 5,
        },
        {
          org_id: orgId,
          user_id: null,
          feature: "item_assist",
          provider: "anthropic",
          model: "claude-haiku-4-5",
          input_tokens: 20,
          output_tokens: 10,
          cost_usd: 0.001,
          credits: 1,
        },
      ]);
      expect(insErr, "seed ai_usage").toBeNull();
    }, 120_000);

    afterAll(async () => {
      // Belt-and-suspenders: drop seeded usage rows explicitly (these also
      // cascade when the owning org is removed via user deletion).
      if (createdOrgIds.length > 0) {
        await admin.from("ai_usage").delete().in("org_id", createdOrgIds);
      }
      // Deleting the fixture user cascades to their org (and thus to any
      // remaining org-scoped rows) — the repo's standard cleanup pattern.
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    }, 60_000);

    it("ai_usage_summary aggregates the seeded rows into exactly one current-month row", async () => {
      const now = new Date();
      const from = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const to = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      );

      const { data, error } = await admin.rpc("ai_usage_summary", {
        p_org: orgId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      });

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(Number(data![0].credits)).toBe(6); // 5 + 1
      expect(data![0].calls).toBe(2);
    });

    it("ai_usage_by_feature_this_month returns both seeded features with one call each", async () => {
      const { data, error } = await admin.rpc(
        "ai_usage_by_feature_this_month",
        { p_org: orgId },
      );

      expect(error).toBeNull();
      expect(data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ feature: "ask_pulse", calls: 1 }),
          expect.objectContaining({ feature: "item_assist", calls: 1 }),
        ]),
      );
    });
  },
);
