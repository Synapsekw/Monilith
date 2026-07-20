import { randomUUID } from "node:crypto";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type JobRow = Database["public"]["Tables"]["automation_ai_jobs"]["Row"];
type JobInsert = Database["public"]["Tables"]["automation_ai_jobs"]["Insert"];

// Cross-tenant isolation for `automation_ai_jobs`: org B must never SELECT
// org A's jobs, and no client (member or not) has an insert path — writes
// belong only to the engine + the service endpoint (SECURITY DEFINER paths).
describe.skipIf(!integrationTargetReady())(
  "automation_ai_jobs RLS: cross-tenant isolation",
  () => {
    const tag = randomUUID().slice(0, 8);
    let admin: SupabaseClient<Database>; // service role, RLS-bypassing, for setup
    let userA: SupabaseClient<Database>; // org-A member, owns the job row
    let userB: SupabaseClient<Database>; // org-B member, must NOT see it
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];
    let jobIdA = "";

    async function provisionUser(label: string) {
      const email = `aijobs-${label}-${randomUUID()}@example.com`;
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
      await signInOrThrow(anon, { email, password: PASSWORD });

      const { data: org, error: orgErr } = await anon.rpc(
        "create_organization",
        {
          p_name: `Org ${label} ${randomUUID().slice(0, 8)}`,
          p_slug: `aijobs-${label}-${randomUUID().slice(0, 8)}`,
        },
      );
      expect(orgErr, `create_organization(${label})`).toBeNull();
      const orgId = (org as { id: string }).id;
      createdOrgIds.push(orgId);
      return { id, anon, orgId };
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const a = await provisionUser("a");
      userA = a.anon;
      const b = await provisionUser("b");
      userB = b.anon;

      // Org A: workspace + board (create_board seeds a default group), + a rule.
      const { data: ws, error: wsErr } = await userA
        .from("workspaces")
        .insert({ org_id: a.orgId, name: `WS ${tag}`, created_by: a.id })
        .select("id")
        .single();
      expect(wsErr, "insert workspace").toBeNull();
      const { data: board, error: boardErr } = await userA.rpc("create_board", {
        p_workspace_id: (ws as { id: string }).id,
        p_name: `Board ${tag}`,
      });
      expect(boardErr, "create_board").toBeNull();
      const boardA = (board as { id: string }).id;

      const { data: rule, error: ruleErr } = await userA
        .from("automations")
        .insert({
          org_id: a.orgId,
          board_id: boardA,
          name: `Rule ${tag}`,
          trigger: { type: "item_created" },
          actions: [],
          created_by: a.id,
        })
        .select("id")
        .single();
      expect(ruleErr, "insert automation").toBeNull();
      const automationId = (rule as { id: string }).id;

      // Seed a job for org A via the service role (no client insert path exists).
      const insert: JobInsert = {
        automation_id: automationId,
        org_id: a.orgId,
        board_id: boardA,
        config: { tag },
        status: "pending",
      };
      const { data: job, error: jobErr } = await admin
        .from("automation_ai_jobs")
        .insert(insert)
        .select("id")
        .single();
      expect(jobErr, "seed job").toBeNull();
      jobIdA = (job as { id: string }).id;
    });

    afterAll(async () => {
      // Self-clean: teardown purge is gated to a marked test DB, so remove our
      // own rows/orgs/users regardless of target. Cascades drop the job row.
      for (const id of createdOrgIds) {
        await admin.from("organizations").delete().eq("id", id);
      }
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    });

    it("lets an org member read their own org's job (positive control)", async () => {
      const { data, error } = await userA
        .from("automation_ai_jobs")
        .select("id, org_id, status")
        .eq("id", jobIdA);
      expect(error).toBeNull();
      expect((data as Pick<JobRow, "id">[]).map((r) => r.id)).toContain(jobIdA);
    });

    it("scopes reads by RLS: org B sees none of org A's jobs", async () => {
      const { data, error } = await userB
        .from("automation_ai_jobs")
        .select("id")
        .eq("id", jobIdA);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]); // default-deny + org-scoped SELECT policy
    });

    it("gives clients NO insert path (member insert is rejected)", async () => {
      const { data, error } = await userA
        .from("automation_ai_jobs")
        .insert({
          automation_id: randomUUID(),
          org_id: createdOrgIds[0]!,
          board_id: randomUUID(),
          status: "pending",
        } as JobInsert)
        .select("id");
      // No INSERT policy exists -> RLS blocks it (error) and nothing is written.
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });
  },
);
