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
import {
  countPendingProposalsByAgent,
  listPendingProposalsForRun,
} from "./proposals-db";

// ===========================================================================
// THE GUARANTEE UNDER TEST
// ===========================================================================
//
// `user_agent_proposals` (supabase/migrations/20260812062428_agent_proposals.sql)
// is the durable record of a tool call an agent WANTED to make but held no
// capability grant for. It is the one agent table an owner may WRITE to — but
// only in one direction: `user_agent_proposals_owner_read` (SELECT) and
// `user_agent_proposals_owner_decide` (UPDATE) are both `owner_id = auth.uid()`,
// and there is deliberately NO insert policy, because every row is written by
// the service-role run. That asymmetry — decidable but not forgeable — is what
// this file pins against the real database. Its shape is deliberately the
// sibling of `user_agent_runs.rls.integration.test.ts`: same skip guard, same
// two-user fixture, same service-role-seeds-everything discipline. See
// `user_agents.rls.integration.test.ts` for the full rationale on WHY a
// `*.rls.integration.test.ts` file targets DEV via `allowsTier2Fixtures()`.
//
// It also pins the EXPIRY rule, which is not RLS but is just as load-bearing.
// There is no sweep job, so an undecided proposal keeps `status = 'pending'`
// forever. `listPendingProposalsForRun` and `countPendingProposalsByAgent`
// therefore filter `status = 'pending' AND expires_at > now`; a regression that
// dropped the second half would surface an Approve button whose only possible
// outcome is failure. Asserting that against real rows (rather than a mocked
// query builder, which `proposals-db.test.ts` already covers) is what proves
// the predicate reaches PostgREST intact.
//
// ===========================================================================
// FOOTPRINT
// ===========================================================================
//
// One `user_agents` row + one `user_agent_runs` row + three
// `user_agent_proposals` rows, all seeded via the SERVICE-ROLE client (there is
// no authenticated insert path for any of the three), hung off fixture org A /
// fixture A's owner id. `enabled: false` on the parent agent, so the
// personal-agent sweep cron can never pick it up, and a fresh `randomUUID()`
// agent id every run keeps the fixed fire slot below from colliding with any
// other suite's. Everything is deleted in `afterAll`, unconditionally: deleting
// the parent `user_agents` row cascades the run row, which cascades the
// proposals (both FKs are `on delete cascade`).
//
// The three proposals are separate rows on purpose rather than one row reused:
// two of the properties MUTATE status, and a shared row would make the read and
// expiry assertions depend on test ordering.

loadFixtureEnv();

const [ORG_A, ORG_B] = TIER2_FIXTURE_TENANTS;

// Fixed, arbitrary slot — safe because it is scoped to a brand-new
// `user_agent_id` every run (see FOOTPRINT above).
const FIRE_DATE = "2026-01-21";
const FIRE_HOUR = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

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
  console.info(`[user_agent_proposals RLS] skipped — ${resolution.reason}`);
}

describe.skipIf(!resolution.ok)(
  "user_agent_proposals RLS (live DEV, Tier-2 permanent fixture tenants)",
  () => {
    const target = resolution.ok ? resolution.target : null;
    const tag = randomUUID().slice(0, 8);

    let admin: SupabaseClient<Database>; // service role — the ONLY writer
    let userA: SupabaseClient<Database>; // fixture org A owner (row owner)
    let userB: SupabaseClient<Database>; // fixture org B owner (cross-org)
    let ownerAId = "";
    let agentId = "";
    let runId = "";
    let activeId = ""; // pending, expires in 7 days
    let expiredId = ""; // pending, expired yesterday
    let decideId = ""; // pending, the row the decision properties mutate

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

    async function seedProposal(
      toolCallId: string,
      expiresAt: string,
    ): Promise<string> {
      const { data, error } = await admin
        .from("user_agent_proposals")
        .insert({
          user_agent_id: agentId,
          run_id: runId,
          org_id: ORG_A.orgId,
          owner_id: ownerAId,
          capability: "board.write",
          tool_name: "create_item",
          tool_call_id: toolCallId,
          input: { boardId: ORG_A.boardId, title: `probe ${tag}` },
          summary: `Create item "probe ${tag}" on the fixture board`,
          status: "pending",
          expires_at: expiresAt,
        })
        .select("id")
        .single();
      if (error) throw new Error(`seed proposal failed: ${error.message}`);
      return (data as { id: string }).id;
    }

    beforeAll(async () => {
      admin = createClient<Database>(target!.url, target!.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      userA = await signIn(ORG_A.email, TIER2_FIXTURE_PASSWORD);
      userB = await signIn(ORG_B.email, TIER2_FIXTURE_PASSWORD);

      const aId = (await userA.auth.getUser()).data.user?.id;
      if (!aId) throw new Error("fixture A signed in but has no user id");
      ownerAId = aId;

      agentId = randomUUID();
      const { error: agentErr } = await admin.from("user_agents").insert({
        id: agentId,
        org_id: ORG_A.orgId,
        owner_id: ownerAId,
        name: `proposal-rls-probe ${tag}`,
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
          owner_id: ownerAId,
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

      const now = Date.now();
      activeId = await seedProposal(
        `call-active-${tag}`,
        new Date(now + 7 * DAY_MS).toISOString(),
      );
      expiredId = await seedProposal(
        `call-expired-${tag}`,
        new Date(now - 1 * DAY_MS).toISOString(),
      );
      decideId = await seedProposal(
        `call-decide-${tag}`,
        new Date(now + 7 * DAY_MS).toISOString(),
      );
    }, 60_000);

    afterAll(async () => {
      // Unconditional and best-effort. Deleting the parent agent cascades the
      // run row, which cascades every proposal seeded above.
      if (!agentId) return;
      const { error } = await admin
        .from("user_agents")
        .delete()
        .eq("id", agentId);
      if (error) {
        console.warn(
          `[user_agent_proposals RLS] cleanup failed for agent ${agentId}: ` +
            `${error.message} — delete it by hand from DEV.`,
        );
      }
    }, 30_000);

    // ── Property: owner-scoped select works ─────────────────────────────
    it("lets the owner read their own proposals", async () => {
      const { data, error } = await userA
        .from("user_agent_proposals")
        .select("id, status, capability, tool_name, summary")
        .eq("run_id", runId)
        .order("created_at", { ascending: true });
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.id).sort()).toEqual(
        [activeId, expiredId, decideId].sort(),
      );
      expect(data?.[0]?.capability).toBe("board.write");
    });

    // ── Property: a non-owner sees nothing ───────────────────────────────
    it("hides every proposal from a non-owner (cross-org)", async () => {
      const { data, error } = await userB
        .from("user_agent_proposals")
        .select("id")
        .eq("run_id", runId);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    // ── Property: no authenticated INSERT path ───────────────────────────
    it("gives the owner NO insert path (no INSERT policy exists at all)", async () => {
      const { data, error } = await userA
        .from("user_agent_proposals")
        .insert({
          user_agent_id: agentId,
          run_id: runId,
          org_id: ORG_A.orgId,
          owner_id: ownerAId, // their OWN id — still refused
          capability: "board.write",
          tool_name: "create_item",
          tool_call_id: `call-forged-${tag}`,
          input: { boardId: ORG_A.boardId },
          summary: "A proposal the owner wrote for themselves",
          expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
        })
        .select("id");
      // With NO insert policy at all, Postgres RLS defaults `with check` to
      // false for every row — a genuine policy-violation error, not a silently
      // empty result. Forging a proposal is forging the thing an approval
      // click then EXECUTES with the owner's own privileges, so this is the
      // single most important refusal in the file.
      expect(
        error,
        "authenticated insert into user_agent_proposals",
      ).not.toBeNull();
      expect(data).toBeNull();
    });

    // ── Property: a non-owner cannot decide ──────────────────────────────
    it("gives a non-owner NO update path (RLS hides the row; 0 rows affected)", async () => {
      const { data } = await userB
        .from("user_agent_proposals")
        .update({ status: "approved" })
        .eq("id", decideId)
        .select("id");
      expect((data ?? []).length, "update must affect 0 rows").toBe(0);

      const { data: check } = await admin
        .from("user_agent_proposals")
        .select("status")
        .eq("id", decideId)
        .single();
      expect(check?.status, "status must be unchanged").toBe("pending");
    });

    // ── Property: the `with check` refuses re-parenting ──────────────────
    it("refuses an update that hands the proposal to someone else", async () => {
      const bId = (await userB.auth.getUser()).data.user?.id;
      expect(bId).toBeTruthy();

      const { error } = await userA
        .from("user_agent_proposals")
        .update({ owner_id: bId! })
        .eq("id", decideId)
        .select("id");
      // `using` admits the row (A owns it) but `with check` re-asserts
      // ownership on the NEW row, so the write is refused outright.
      expect(error, "re-parenting update").not.toBeNull();

      const { data: check } = await admin
        .from("user_agent_proposals")
        .select("owner_id")
        .eq("id", decideId)
        .single();
      expect(check?.owner_id, "owner must be unchanged").toBe(ownerAId);
    });

    // ── Property: the owner CAN decide ───────────────────────────────────
    // Last of the mutating properties on purpose: it is the one that leaves
    // `decideId` in a terminal state.
    it("lets the owner reject their own proposal", async () => {
      const { data, error } = await userA
        .from("user_agent_proposals")
        .update({
          status: "rejected",
          decided_at: new Date().toISOString(),
          decided_by: ownerAId,
        })
        .eq("id", decideId)
        .select("id, status");
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.id)).toEqual([decideId]);
      expect(data?.[0]?.status).toBe("rejected");
    });

    // ── Property: the expiry predicate reaches the database ──────────────
    //
    // Both readers must exclude a row that is still `status = 'pending'` but
    // past `expires_at`. There is no sweep, so that row exists indefinitely;
    // counting or listing it renders an affordance that can only fail.
    it("excludes an expired proposal from listPendingProposalsForRun", async () => {
      const rows = await listPendingProposalsForRun(userA, runId);
      const ids = rows.map((r) => r.id);
      expect(ids, "the unexpired pending row is listed").toContain(activeId);
      expect(ids, "the EXPIRED pending row must not be").not.toContain(
        expiredId,
      );
      // `decideId` was rejected by the property above — pending is the other
      // half of the same predicate, and it is excluded too.
      expect(ids).not.toContain(decideId);
    });

    it("excludes an expired proposal from countPendingProposalsByAgent", async () => {
      const counts = await countPendingProposalsByAgent(userA, ownerAId);
      // One row only: the active one. Not two (which would mean the expired
      // row was counted) and not three (status ignored as well).
      expect(counts[agentId]).toBe(1);
    });

    it("counts nothing for a different owner", async () => {
      const counts = await countPendingProposalsByAgent(
        userB,
        (await userB.auth.getUser()).data.user!.id,
      );
      expect(counts[agentId]).toBeUndefined();
    });
  },
);
