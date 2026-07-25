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

// `board_agents` / `board_agent_runs` / `board_agent_fires` are added by this
// task's migration and are not yet in the generated Database types, so every
// access is through a loosely-typed view of the client. This is the same
// documented migration-gate seam used by board-agents-db.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const loose = (c: SupabaseClient<Database>): Loose => c as unknown as Loose;

// Cross-tenant isolation for the F14 board-agent family: org B must never SELECT
// org A's agent config, runs, or fire ledger, and must have NO cross-org write
// path (board_agents writes are admin-scoped to the caller's OWN org; runs/fires
// are service-only).
describe.skipIf(!integrationTargetReady())(
  "board_agents RLS: cross-tenant isolation",
  () => {
    const tag = randomUUID().slice(0, 8);
    let admin: SupabaseClient<Database>; // service role, RLS-bypassing, for setup
    let userA: SupabaseClient<Database>; // org-A owner, owns the agent
    let userB: SupabaseClient<Database>; // org-B owner, must NOT see/write it
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];
    let orgA = "";
    let orgB = "";
    let boardA = "";
    let agentIdA = "";

    async function provisionUser(label: string) {
      const email = `bagents-${label}-${randomUUID()}@example.com`;
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
          p_slug: `bagents-${label}-${randomUUID().slice(0, 8)}`,
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
      orgA = a.orgId;
      const b = await provisionUser("b");
      userB = b.anon;
      orgB = b.orgId;

      // Org A: workspace + board (create_board seeds a default group).
      const { data: ws, error: wsErr } = await userA
        .from("workspaces")
        .insert({ org_id: orgA, name: `WS ${tag}`, created_by: a.id })
        .select("id")
        .single();
      expect(wsErr, "insert workspace").toBeNull();
      const { data: board, error: boardErr } = await userA.rpc("create_board", {
        p_workspace_id: (ws as { id: string }).id,
        p_name: `Board ${tag}`,
      });
      expect(boardErr, "create_board").toBeNull();
      boardA = (board as { id: string }).id;

      // Positive control: org A's OWNER may configure their board's agent.
      const { data: agent, error: agentErr } = await loose(userA)
        .from("board_agents")
        .insert({
          org_id: orgA,
          board_id: boardA,
          created_by: a.id,
          enabled: true,
          cadence: "daily",
          run_at_local_hour: 8,
          config: { tasks: ["triage"] },
        })
        .select("id")
        .single();
      expect(agentErr, "org A admin creates board_agent").toBeNull();
      agentIdA = (agent as { id: string }).id;

      // Seed a run + a fire for org A via the service role (no client write path).
      const { error: runErr } = await loose(admin)
        .from("board_agent_runs")
        .insert({
          board_agent_id: agentIdA,
          org_id: orgA,
          board_id: boardA,
          fire_date: "2026-07-20",
          fire_hour: 8,
          status: "ran",
        });
      expect(runErr, "seed run").toBeNull();
      const { error: fireErr } = await loose(admin)
        .from("board_agent_fires")
        .insert({
          board_agent_id: agentIdA,
          org_id: orgA,
          fire_date: "2026-07-20",
          fire_hour: 8,
        });
      expect(fireErr, "seed fire").toBeNull();
    });

    afterAll(async () => {
      for (const id of createdOrgIds) {
        await admin.from("organizations").delete().eq("id", id);
      }
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    });

    it("lets org A read its own agent (positive control)", async () => {
      const { data, error } = await loose(userA)
        .from("board_agents")
        .select("id")
        .eq("id", agentIdA);
      expect(error).toBeNull();
      expect((data as { id: string }[]).map((r) => r.id)).toContain(agentIdA);
    });

    it("scopes reads: org B sees none of org A's agents / runs / fires", async () => {
      for (const table of [
        "board_agents",
        "board_agent_runs",
        "board_agent_fires",
      ]) {
        const { data, error } = await loose(userB)
          .from(table)
          .select("*")
          .eq("board_agent_id", agentIdA);
        // board_agents has no board_agent_id column; retry keyed by id there.
        if (table === "board_agents") {
          const res = await loose(userB)
            .from(table)
            .select("*")
            .eq("id", agentIdA);
          expect(res.error, `${table} select`).toBeNull();
          expect(res.data ?? [], `${table} rows`).toEqual([]);
          continue;
        }
        expect(error, `${table} select`).toBeNull();
        expect(data ?? [], `${table} rows`).toEqual([]);
      }
    });

    it("blocks a cross-org write: org B cannot create an agent on org A's board", async () => {
      const { data, error } = await loose(userB)
        .from("board_agents")
        .insert({
          org_id: orgA,
          board_id: boardA,
          created_by: orgB, // even a well-formed row is rejected by the WITH CHECK
          enabled: true,
          cadence: "daily",
          run_at_local_hour: 8,
          config: { tasks: [] },
        })
        .select("id");
      // has_org_role(orgA) is false for org B's owner -> RLS blocks the insert.
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("gives clients NO write path to board_agent_runs", async () => {
      const { data, error } = await loose(userA)
        .from("board_agent_runs")
        .insert({
          board_agent_id: agentIdA,
          org_id: orgA,
          board_id: boardA,
          fire_date: "2026-07-21",
          fire_hour: 9,
          status: "ran",
        })
        .select("id");
      // No INSERT policy exists -> RLS blocks it (service endpoint owns writes).
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });
  },
);
