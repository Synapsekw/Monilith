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

type JobInsert = Database["public"]["Tables"]["automation_ai_jobs"]["Insert"];

// Confinement boundary for F13's `automation_ai_apply`: the model only *chooses*;
// the confined definer applies. A chosen action targeting a FOREIGN board column
// (or group), or a null decision, is logged as `ai_skipped*` and NEVER applied —
// proving the AI has no raw write path (spec §4.1 #3).
describe.skipIf(!integrationTargetReady())(
  "automation_ai_apply: confinement (chosen action re-guarded)",
  () => {
    const tag = randomUUID().slice(0, 8);
    let admin: SupabaseClient<Database>; // service role, RLS-bypassing
    let userA: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    let orgAId = "";
    let boardAId = "";
    let groupAId = "";
    let colSId = "";
    let optWorkingId = "";
    let itemAId = "";
    let automationId = "";

    // automation_ai_apply is added by THIS task's migration; it is not yet in the
    // generated RPC union until `pnpm db:types` regenerates database.types. Cast
    // narrowly here (the one documented migration-gate cast in the test).
    function applyAi(job: string, action: unknown) {
      const rpc = admin.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>;
      return rpc("automation_ai_apply", { p_job: job, p_action: action });
    }

    async function seedPendingJob(): Promise<string> {
      const insert: JobInsert = {
        automation_id: automationId,
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemAId,
        config: {
          type: "ai_step",
          instruction: "decide",
          allow: ["set_option"],
        },
        status: "pending",
      };
      const { data, error } = await admin
        .from("automation_ai_jobs")
        .insert(insert)
        .select("id")
        .single();
      expect(error, "seed job").toBeNull();
      return (data as { id: string }).id;
    }

    async function latestRunOutcome(): Promise<string | undefined> {
      const { data } = await admin
        .from("automation_runs")
        .select("actions, created_at")
        .eq("automation_id", automationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const actions = (data?.actions ?? []) as { outcome?: string }[];
      return actions[0]?.outcome;
    }

    async function cellFor(columnId: string) {
      const { data } = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", itemAId)
        .eq("column_id", columnId)
        .maybeSingle();
      return data?.value ?? null;
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const email = `aistep-a-${randomUUID()}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
        });
      expect(createErr, "createUser(A)").toBeNull();
      const userAId = created.user!.id;
      createdUserIds.push(userAId);

      userA = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInOrThrow(userA, { email, password: PASSWORD });

      const { data: org } = await userA.rpc("create_organization", {
        p_name: `Org A ${tag}`,
        p_slug: `aistep-a-${randomUUID().slice(0, 8)}`,
      });
      orgAId = (org as { id: string }).id;
      createdOrgIds.push(orgAId);

      const { data: ws } = await userA
        .from("workspaces")
        .insert({ org_id: orgAId, name: `WS ${tag}`, created_by: userAId })
        .select("id")
        .single();
      const { data: board } = await userA.rpc("create_board", {
        p_workspace_id: (ws as { id: string }).id,
        p_name: `Board ${tag}`,
      });
      boardAId = (board as { id: string }).id;

      const { data: group } = await userA
        .from("groups")
        .select("id")
        .eq("board_id", boardAId)
        .single();
      groupAId = (group as { id: string }).id;

      // Status column with one option (the valid target for the positive control).
      optWorkingId = randomUUID();
      const { data: colS } = await admin
        .from("columns")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          name: "Status",
          kind: "status",
          settings: {
            options: [{ id: optWorkingId, label: "Working", color: "#00c875" }],
          },
          position: 10,
        })
        .select("id")
        .single();
      colSId = (colS as { id: string }).id;

      const { data: item } = await userA.rpc("create_item", {
        p_group_id: groupAId,
        p_name: `Item ${tag}`,
      });
      itemAId = (item as { id: string }).id;

      const { data: rule } = await userA
        .from("automations")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          name: `Rule ${tag}`,
          trigger: { type: "item_created" },
          actions: [
            { type: "ai_step", instruction: "decide", allow: ["set_option"] },
          ],
          created_by: userAId,
        })
        .select("id")
        .single();
      automationId = (rule as { id: string }).id;
    }, 90_000);

    afterAll(async () => {
      for (const id of createdOrgIds)
        await admin.from("organizations").delete().eq("id", id);
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("applies a valid on-board set_option (positive control)", async () => {
      const job = await seedPendingJob();
      const { error } = await applyAi(job, {
        type: "set_option",
        columnId: colSId,
        optionId: optWorkingId,
      });
      expect(error).toBeNull();

      expect(await latestRunOutcome()).toBe("ai_decided");
      expect(await cellFor(colSId)).toMatchObject({ optionId: optWorkingId });

      const { data: jobRow } = await admin
        .from("automation_ai_jobs")
        .select("status")
        .eq("id", job)
        .single();
      expect((jobRow as { status: string }).status).toBe("done");
    });

    it("rejects a set_option targeting a FOREIGN column — logged, never applied", async () => {
      const foreignColumn = randomUUID();
      const job = await seedPendingJob();
      const { error } = await applyAi(job, {
        type: "set_option",
        columnId: foreignColumn,
        optionId: optWorkingId,
      });
      expect(error).toBeNull();

      // Confinement guard fired: outcome is a skip, no cell for the foreign column.
      expect(await latestRunOutcome()).toBe("ai_skipped_bad_target");
      expect(await cellFor(foreignColumn)).toBeNull();

      // Job is resolved (done), so a redelivery cannot re-attempt.
      const { data: jobRow } = await admin
        .from("automation_ai_jobs")
        .select("status")
        .eq("id", job)
        .single();
      expect((jobRow as { status: string }).status).toBe("done");
    });

    it("rejects a move_to_group targeting a FOREIGN group", async () => {
      const job = await seedPendingJob();
      const { error } = await applyAi(job, {
        type: "move_to_group",
        groupId: randomUUID(),
      });
      expect(error).toBeNull();
      expect(await latestRunOutcome()).toBe("ai_skipped_bad_target");
    });

    it("logs ai_skipped and marks the job skipped on a null decision", async () => {
      const job = await seedPendingJob();
      const { error } = await applyAi(job, null);
      expect(error).toBeNull();
      expect(await latestRunOutcome()).toBe("ai_skipped");
      const { data: jobRow } = await admin
        .from("automation_ai_jobs")
        .select("status")
        .eq("id", job)
        .single();
      expect((jobRow as { status: string }).status).toBe("skipped");
    });

    it("is idempotent — re-applying a resolved job is a no-op", async () => {
      const job = await seedPendingJob();
      await applyAi(job, {
        type: "set_option",
        columnId: colSId,
        optionId: optWorkingId,
      });
      const { count: before } = await admin
        .from("automation_runs")
        .select("id", { count: "exact", head: true })
        .eq("automation_id", automationId);

      // Redeliver: the job is already 'done' → no new run row.
      await applyAi(job, {
        type: "set_option",
        columnId: colSId,
        optionId: optWorkingId,
      });
      const { count: after } = await admin
        .from("automation_runs")
        .select("id", { count: "exact", head: true })
        .eq("automation_id", automationId);

      expect(after).toBe(before);
    });
  },
);
