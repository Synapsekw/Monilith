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

type Role = Database["public"]["Enums"]["org_role"];

type TestUser = {
  id: string;
  email: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!integrationTargetReady())(
  "RLS: org_ai_settings / ai_usage boundary — member reads, no client write path, definer fns service-only, tenant isolation",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    // userA: owner/admin of org A. userB: plain member of org A. userC: owner/
    // admin of org B (a different tenant).
    let userA: TestUser;
    let userB: TestUser;
    let userC: TestUser;
    let orgA: string;
    let orgB: string;

    // Build only the auth user + a signed-in anon client (no org).
    async function provisionUser(label: string): Promise<TestUser> {
      const email = `rls-org-ai-${label}-${randomUUID()}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
        });
      expect(createErr, `createUser(${label})`).toBeNull();
      const id = created.user!.id;
      createdUserIds.push(id);

      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInErr } = await signInWithRetry(anon, {
        email,
        password: PASSWORD,
      });
      expect(signInErr, `signIn(${label})`).toBeNull();

      return { id, email, anon };
    }

    // The signed-in user self-provisions an org via the proven RPC (creator
    // becomes 'owner', which satisfies has_org_role(['owner','admin'])).
    async function provisionOrg(u: TestUser, label: string): Promise<string> {
      const { data: org, error: orgErr } = await u.anon.rpc(
        "create_organization",
        {
          p_name: `rls-org-ai-${label}`,
          p_slug: `rls-org-ai-${label}-${randomUUID().slice(0, 8)}`,
        },
      );
      expect(orgErr, `create_organization(${label})`).toBeNull();
      const id = (org as { id: string }).id;
      createdOrgIds.push(id);
      return id;
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      userA = await provisionUser("a");
      userB = await provisionUser("b");
      userC = await provisionUser("c");

      // userA owns org A; userC owns org B (separate tenant).
      orgA = await provisionOrg(userA, "a");
      orgB = await provisionOrg(userC, "b");

      // Attach userB to org A as a PLAIN member via the service client (setup
      // bypass; not a policy under test).
      const { error: memberErr } = await admin.from("org_members").insert({
        org_id: orgA,
        user_id: userB.id,
        role: "member" as Role,
      });
      expect(memberErr, "seed userB as member of org A").toBeNull();

      // Seed org A's settings row via the service client (bypasses RLS). Default
      // ai_mode is 'per_user'; no client (admin or member) can mutate it —
      // writes are service-role only via server actions.
      const { error: seedSettingsErr } = await admin
        .from("org_ai_settings")
        .insert({ org_id: orgA });
      expect(seedSettingsErr, "seed org A ai settings").toBeNull();

      // Seed the usage ledger via the ONLY write path (service-role definer):
      // two rows for org A (credits 5 + 3 = 8) and one for org B (credits 7).
      const seed = async (p_org: string, p_user: string, p_credits: number) => {
        const { error } = await admin.rpc("record_ai_usage", {
          p_org,
          p_user,
          p_feature: "ask_pulse",
          p_provider: "anthropic",
          p_model: "claude-x",
          p_input_tokens: 100,
          p_output_tokens: 50,
          p_cost_usd: 0.01,
          p_credits,
        });
        expect(error, `record_ai_usage(${p_org})`).toBeNull();
      };
      await seed(orgA, userA.id, 5);
      await seed(orgA, userB.id, 3);
      await seed(orgB, userC.id, 7);
    }, 120_000);

    afterAll(async () => {
      // Belt-and-suspenders: drop seeded ledger + settings rows explicitly
      // (these also cascade when the owning org is removed via user deletion).
      if (createdOrgIds.length > 0) {
        await admin.from("ai_usage").delete().in("org_id", createdOrgIds);
        await admin
          .from("org_ai_settings")
          .delete()
          .in("org_id", createdOrgIds);
      }
      // Deleting the fixture users cascades to their orgs (and thus to any
      // remaining org-scoped rows) — the repo's standard cleanup pattern.
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    }, 60_000);

    // -------------------------------------------------------------------------
    // org_ai_settings: member reads, tenant isolation
    // -------------------------------------------------------------------------

    it("member of org A can select org A's settings row", async () => {
      const { data, error } = await userB.anon
        .from("org_ai_settings")
        .select("org_id, ai_mode")
        .eq("org_id", orgA);
      expect(error).toBeNull();
      expect(data).toEqual([{ org_id: orgA, ai_mode: "per_user" }]);
    });

    it("admin of a different org (B) cannot see org A's settings row — empty, not an error", async () => {
      const { data, error } = await userC.anon
        .from("org_ai_settings")
        .select("org_id")
        .eq("org_id", orgA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    // -------------------------------------------------------------------------
    // org_ai_settings: no client write path — writes are service-role only via
    // server actions. tier/monthly_credit_limit are platform-controlled
    // entitlements, so NO authenticated client (admin or member) may write —
    // there are no INSERT/UPDATE policies, only the member SELECT policy.
    // -------------------------------------------------------------------------

    it("no authenticated client can INSERT org_ai_settings (admin or member) — no write policy exists", async () => {
      // No INSERT policy exists → default-deny rejects both the org admin and a
      // plain member, regardless of role.
      const { error: adminErr } = await userA.anon
        .from("org_ai_settings")
        .insert({ org_id: orgA, ai_mode: "managed" });
      expect(adminErr).not.toBeNull();

      const { error: memberErr } = await userB.anon
        .from("org_ai_settings")
        .insert({ org_id: orgA, ai_mode: "managed" });
      expect(memberErr).not.toBeNull();
    });

    it("no authenticated client can UPDATE org A's settings (admin or member) — the write does not land", async () => {
      // No UPDATE policy exists → the row is invisible to any client UPDATE, so
      // the write affects 0 rows (may also surface as an explicit error). Both
      // the org admin (owner A) and a plain member (B) are blocked; verify
      // nothing changed after each attempt.
      const { error: memberErr } = await userB.anon
        .from("org_ai_settings")
        .update({ ai_mode: "off" })
        .eq("org_id", orgA);
      void memberErr;

      const { error: adminErr } = await userA.anon
        .from("org_ai_settings")
        .update({ ai_mode: "off" })
        .eq("org_id", orgA);
      void adminErr;

      const { data: after } = await admin
        .from("org_ai_settings")
        .select("ai_mode")
        .eq("org_id", orgA)
        .single();
      expect((after as { ai_mode: string }).ai_mode).toBe("per_user");
    });

    // -------------------------------------------------------------------------
    // ai_usage: no client write path; admin-only, tenant-scoped reads
    // -------------------------------------------------------------------------

    it("authenticated clients cannot INSERT into ai_usage (no write policy exists)", async () => {
      const attempt = (u: TestUser, org: string) =>
        u.anon
          .from("ai_usage")
          .insert({ org_id: org, feature: "hack", credits: 1 });

      const { error: aErr } = await attempt(userA, orgA);
      expect(aErr).not.toBeNull();
      const { error: bErr } = await attempt(userB, orgA);
      expect(bErr).not.toBeNull();
    });

    it("admin of org A sees exactly org A's usage rows", async () => {
      const { data, error } = await userA.anon
        .from("ai_usage")
        .select("org_id, credits");
      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.length).toBe(2);
      expect(
        data!.every((r) => (r as { org_id: string }).org_id === orgA),
      ).toBe(true);
    });

    it("a plain member of org A sees NO usage rows (select is admin-only)", async () => {
      const { data, error } = await userB.anon
        .from("ai_usage")
        .select("id")
        .eq("org_id", orgA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("admin of org B sees only org B's usage row (tenant isolation)", async () => {
      const { data, error } = await userC.anon
        .from("ai_usage")
        .select("org_id");
      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.length).toBe(1);
      expect((data![0] as { org_id: string }).org_id).toBe(orgB);
    });

    // -------------------------------------------------------------------------
    // SECURITY DEFINER functions: not callable as `authenticated`
    // -------------------------------------------------------------------------

    it("org_ai_secret_get is not callable as authenticated (execute revoked)", async () => {
      const { error } = await userA.anon.rpc("org_ai_secret_get", {
        p_org: orgA,
        p_provider: "anthropic",
      });
      expect(error).not.toBeNull();
    });

    it("org_ai_secret_set is not callable as authenticated (execute revoked)", async () => {
      const { error } = await userA.anon.rpc("org_ai_secret_set", {
        p_org: orgA,
        p_provider: "anthropic",
        p_secret: "sk-should-never-land",
        p_hint: "sk-…FAKE",
      });
      expect(error).not.toBeNull();
    });

    it("record_ai_usage is not callable as authenticated (execute revoked)", async () => {
      const { error } = await userA.anon.rpc("record_ai_usage", {
        p_org: orgA,
        p_user: userA.id,
        p_feature: "hack",
        p_provider: "anthropic",
        p_model: "claude-x",
        p_input_tokens: 1,
        p_output_tokens: 1,
        p_cost_usd: 0,
        p_credits: 999,
      });
      expect(error).not.toBeNull();
    });

    it("ai_credits_used_this_month is not callable as authenticated (execute revoked)", async () => {
      const { error } = await userA.anon.rpc("ai_credits_used_this_month", {
        p_org: orgA,
      });
      expect(error).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // ai_credits_used_this_month via the service role: current-month, per-org
    // -------------------------------------------------------------------------

    it("ai_credits_used_this_month (service) sums only org A's current-month credits", async () => {
      const { data: aData, error: aErr } = await admin.rpc(
        "ai_credits_used_this_month",
        { p_org: orgA },
      );
      expect(aErr).toBeNull();
      expect(Number(aData)).toBe(8); // 5 + 3; does not include org B's 7

      const { data: bData, error: bErr } = await admin.rpc(
        "ai_credits_used_this_month",
        { p_org: orgB },
      );
      expect(bErr).toBeNull();
      expect(Number(bData)).toBe(7);
    });
  },
);
