import { randomUUID } from "node:crypto";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import { allowsTier2Fixtures } from "@/lib/supabase/project-refs";
import {
  TIER2_FIXTURE_PASSWORD,
  TIER2_FIXTURE_TENANTS,
  loadFixtureEnv,
} from "@/test/tenant-fixtures";
import type { Database } from "@/types/database.types";

// ===========================================================================
// THE GUARANTEE UNDER TEST
// ===========================================================================
//
// `user_agent_runs` (supabase/migrations/20260801091231_personal_agents.sql)
// is the audit/idempotency table behind the personal-agent daily briefing. Its
// RLS is narrower than `user_agents`: `user_agent_runs_owner_read` grants
// SELECT only, where `owner_id = auth.uid()` — and there is NO authenticated
// write policy of any kind. Every row is written by the service-role
// `/api/ai/personal-agent` endpoint (see route.ts's `claimRun`/`finalizeRun`);
// an authenticated client — even the row's own owner — must never be able to
// insert, update, or delete here. Neither the read-scoping nor the
// no-write-path guarantee had ever been exercised against a real database
// (route.test.ts covers the ROUTE's insert/update calls only through a
// hand-rolled mock, never the real policy). This file closes that gap.
//
// See `src/lib/agents/user_agents.rls.integration.test.ts` for the full
// rationale on WHY a `*.rls.integration.test.ts` file targets DEV via
// `allowsTier2Fixtures()` instead of the usual `integrationTargetReady()`
// Tier-1 deny-list, and for the "insert claiming another owner" / "insert
// naming a foreign org" properties, which belong to `user_agents` (the only
// table with an authenticated write policy at all) and are not repeated here.
//
// ===========================================================================
// FOOTPRINT
// ===========================================================================
//
// One `user_agents` row + one `user_agent_runs` row, both seeded via the
// SERVICE-ROLE client (there is no authenticated insert path for either that
// this file could use even if it wanted a lighter touch), hung off fixture
// org A / fixture A's owner id. `enabled: false` on the parent agent, so the
// personal-agent sweep cron can never pick it up. The parent agent's
// (user_agent_id, fire_date, fire_hour) is unique per test run (a fresh
// `randomUUID()` agent id every time), so the fixed fire_date/fire_hour below
// can never collide with anything else, including
// `agent-run.integration.test.ts`'s own seeded slot. Everything created here
// is deleted in `afterAll`, unconditionally, including on a failed setup —
// deleting the parent `user_agents` row cascades the run row via its `on
// delete cascade` FK, mirroring agent-run.integration.test.ts's cleanup.
//
// No board-access-loss case here either, for the same reason as the sibling
// file: this table doesn't touch board access at all (it is a pure audit
// row), and the case belongs conceptually to `buildBriefing`/RLS on `boards`
// /`items`, not to this table's own RLS.

loadFixtureEnv();

const [ORG_A, ORG_B] = TIER2_FIXTURE_TENANTS;

// Fixed, arbitrary slot — safe because it is scoped to a brand-new
// `user_agent_id` every run (see FOOTPRINT above), so it can never collide
// with a previous run's leftover row or any other suite's seeded slot.
const FIRE_DATE = "2026-01-20";
const FIRE_HOUR = 5;

type Target = { url: string; anonKey: string; serviceRoleKey: string };
type Resolution = { ok: true; target: Target } | { ok: false; reason: string };

function resolveTarget(env: Record<string, string | undefined>): Resolution {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceRoleKey) {
    return {
      ok: false,
      reason:
        "No target: set NEXT_PUBLIC_SUPABASE_URL + " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY.",
    };
  }
  if (!allowsTier2Fixtures(url)) {
    return {
      ok: false,
      reason:
        `Runs against the DEV project only — the Tier-2 fixture tenants are ` +
        `seeded there and nowhere else; ${url} is not it.`,
    };
  }
  return { ok: true, target: { url, anonKey, serviceRoleKey } };
}

const resolution = resolveTarget(process.env);
if (!resolution.ok) {
  console.info(`[user_agent_runs RLS] skipped — ${resolution.reason}`);
}

describe.skipIf(!resolution.ok)(
  "user_agent_runs RLS (live DEV, Tier-2 permanent fixture tenants)",
  () => {
    const target = resolution.ok ? resolution.target : null;
    const tag = randomUUID().slice(0, 8);

    let admin: SupabaseClient<Database>; // service role — the ONLY writer
    let userA: SupabaseClient<Database>; // fixture org A owner (row owner)
    let userB: SupabaseClient<Database>; // fixture org B owner (cross-org)
    let agentId = "";
    let runId = "";

    async function signIn(
      email: string,
      password: string,
    ): Promise<SupabaseClient<Database>> {
      const client = createClient<Database>(target!.url, target!.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInOrThrow(client, { email, password }, email);
      return client;
    }

    beforeAll(async () => {
      admin = createClient<Database>(target!.url, target!.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      userA = await signIn(ORG_A.email, TIER2_FIXTURE_PASSWORD);
      userB = await signIn(ORG_B.email, TIER2_FIXTURE_PASSWORD);

      const aId = (await userA.auth.getUser()).data.user?.id;
      if (!aId) throw new Error("fixture A signed in but has no user id");

      agentId = randomUUID();
      const { error: agentErr } = await admin.from("user_agents").insert({
        id: agentId,
        org_id: ORG_A.orgId,
        owner_id: aId,
        name: `run-rls-probe ${tag}`,
        template_id: "integration-test",
        instructions: "RLS integration-test fixture agent. Never runs.",
        board_scope: { mode: "all" },
        cadence: "daily",
        run_at_local_hour: 7,
        enabled: false, // never eligible for the sweep
      });
      if (agentErr) {
        throw new Error(`seed user_agents failed: ${agentErr.message}`);
      }

      const { data: run, error: runErr } = await admin
        .from("user_agent_runs")
        .insert({
          user_agent_id: agentId,
          org_id: ORG_A.orgId,
          owner_id: aId,
          fire_date: FIRE_DATE,
          fire_hour: FIRE_HOUR,
          status: "ran",
          input_tokens: 11,
          output_tokens: 4,
        })
        .select("id")
        .single();
      if (runErr) {
        throw new Error(`seed user_agent_runs failed: ${runErr.message}`);
      }
      runId = (run as { id: string }).id;
    }, 60_000);

    afterAll(async () => {
      // Unconditional and best-effort. Deleting the parent agent cascades the
      // run row (`user_agent_runs_user_agent_id_fkey ... on delete cascade`).
      if (!agentId) return;
      const { error } = await admin
        .from("user_agents")
        .delete()
        .eq("id", agentId);
      if (error) {
        console.warn(
          `[user_agent_runs RLS] cleanup failed for agent ${agentId}: ` +
            `${error.message} — delete it by hand from DEV.`,
        );
      }
    }, 30_000);

    // ── Property: owner-scoped select works ─────────────────────────────
    it("lets the owner read their own run", async () => {
      const { data, error } = await userA
        .from("user_agent_runs")
        .select("id, status, fire_date, fire_hour")
        .eq("id", runId);
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.id)).toEqual([runId]);
      expect(data?.[0]?.status).toBe("ran");
    });

    // ── Property: a non-owner sees nothing ───────────────────────────────
    it("hides the run from a non-owner (cross-org)", async () => {
      const { data, error } = await userB
        .from("user_agent_runs")
        .select("id")
        .eq("id", runId);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    // ── Property: no authenticated write path — INSERT ──────────────────
    it("gives the owner NO insert path (no INSERT policy exists at all)", async () => {
      const { data, error } = await userA
        .from("user_agent_runs")
        .insert({
          user_agent_id: agentId,
          org_id: ORG_A.orgId,
          owner_id: (await userA.auth.getUser()).data.user!.id,
          fire_date: FIRE_DATE,
          fire_hour: FIRE_HOUR + 1, // distinct slot — would be a valid row otherwise
          status: "ran",
        })
        .select("id");
      // With NO insert policy at all, Postgres RLS defaults `with check` to
      // false for every row — this is a genuine policy-violation error, not
      // a silently-empty result (contrast with the update/delete cases below,
      // where RLS simply hides the target row instead).
      expect(error, "authenticated insert into user_agent_runs").not.toBeNull();
      expect(data).toBeNull();
    });

    // ── Property: no authenticated write path — UPDATE ───────────────────
    it("gives the owner NO update path (RLS hides the row; 0 rows affected, not an error)", async () => {
      const { data, error } = await userA
        .from("user_agent_runs")
        .update({ status: "error" })
        .eq("id", runId)
        .select("id");
      // No policy covers UPDATE, so the USING clause defaults to false: the
      // row is invisible to the writer, and the statement affects 0 rows —
      // that's what "RLS default-denies" looks like for update/delete
      // (contrast with insert above, which surfaces as an explicit error).
      void error; // may be null; the row-count assertion is what matters
      expect((data ?? []).length, "update must affect 0 rows").toBe(0);

      const { data: check } = await admin
        .from("user_agent_runs")
        .select("status")
        .eq("id", runId)
        .single();
      expect(check?.status, "status must be unchanged").toBe("ran");
    });

    // ── Property: no authenticated write path — DELETE ───────────────────
    it("gives the owner NO delete path (RLS hides the row; 0 rows affected, not an error)", async () => {
      const { data, error } = await userA
        .from("user_agent_runs")
        .delete()
        .eq("id", runId)
        .select("id");
      void error;
      expect((data ?? []).length, "delete must affect 0 rows").toBe(0);

      const { data: check, error: checkErr } = await admin
        .from("user_agent_runs")
        .select("id")
        .eq("id", runId);
      expect(checkErr).toBeNull();
      expect(
        (check ?? []).map((r) => r.id),
        "row must still exist",
      ).toEqual([runId]);
    });
  },
);
