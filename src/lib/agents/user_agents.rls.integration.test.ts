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
// `user_agents` (supabase/migrations/20260801091231_personal_agents.sql) is
// owner-scoped, default-deny RLS: an agent's instructions are personal, so
// `user_agents_owner_all` grants access only where `owner_id = auth.uid()` —
// deliberately no org-admin read, unlike most tenant tables in this repo.
// The `with check` clause additionally requires `public.is_org_member(org_id)`
// (added during review) so a caller cannot misattribute an agent — and the
// per-org cap/run-history bookkeeping that rides on its `org_id` — to an org
// they do not belong to. Neither half of that policy had ever been exercised
// against a real database. This file closes that gap for `user_agents`; the
// sibling `user_agent_runs.rls.integration.test.ts` covers the run-audit
// table.
//
// ===========================================================================
// WHY *.rls.integration.test.ts (TIER-1 PROJECT) BUT TARGETING TIER-2'S
// PERMANENT FIXTURES
// ===========================================================================
//
// This repo's convention for a new tenant table's RLS suite is
// `*.rls.integration.test.ts`, which is what gives this file that name — but
// it needs an authenticated INSERT path (to prove the `with check` clause),
// so it cannot live in the non-privileged Tier-2 `*.fixtures.test.ts` project
// (src/test/tenant-fixtures.ts is deliberately anon-key-only). Every
// `*.integration.test.ts{,x}` suite — this one included, by the naming
// convention above — lands in the Tier-1 "integration" Vitest project
// (`pnpm test:integration`), which is normally denied DEV entirely
// (decision-25: no sacrificial project has ever been provisioned, so all ~70
// of those suites skip). This file follows the escape hatch
// `src/lib/agents/agent-run.integration.test.ts` already established: gate on
// `allowsTier2Fixtures()` (DEV, specifically) instead of
// `integrationTargetReady()`, and hang everything off the two PERMANENT
// Tier-2 fixture tenants' org/owner ids rather than a throwaway provisioned
// org. See that file for the long version of this rationale.
//
// ===========================================================================
// FOOTPRINT — what this file adds to DEV, and what it never touches
// ===========================================================================
//
//  - One `user_agents` row, inserted through fixture-A owner's OWN
//    authenticated client (not service-role) — this insert doubles as the
//    positive control proving the happy path satisfies `with check`.
//    `enabled: false`, so the personal-agent sweep cron can never pick it up
//    regardless of `run_at_local_hour` or timing.
//  - One throwaway `org_members` row, temporarily attached to fixture org A,
//    for the ONE property permanent-fixture data cannot supply on its own: "a
//    same-org non-owner sees nothing". The two permanent tenants each own
//    exactly one org and belong to no other — that disjointness is the entire
//    premise of the Tier-2 isolation suite (tenant-isolation.fixtures.test.ts)
//    — so there is no second real member of org A to sign in as. A brand-new
//    throwaway auth user is provisioned instead and ATTACHED to org A's
//    existing membership table; the fixture users' own rows, their org, and
//    every other row in it are never modified. Both the membership row and
//    the throwaway user are removed in `afterAll`, unconditionally, including
//    when `beforeAll` fails partway through.
//  - Two INSERT attempts (claiming another owner_id; naming a foreign org_id)
//    that RLS must refuse — a refused insert leaves nothing behind to clean
//    up.
//
// NOT ATTEMPTED: the spec's board-access-loss case ("an agent whose owner
// loses access to a board stops seeing that board's items") is not covered
// here. Proving it would require either revoking the FIXTURE OWNER's own
// access to a board — a mutation of the permanent tenant's actual state, not
// an additive throwaway row, and one several other live suites depend on
// staying constant — or inserting `items` rows, which the Tier-2 seed
// migration deliberately avoids because item inserts enqueue embedding jobs
// and run automations (side effects a permanent fixture has no business
// causing). Neither is safe to do here, so this file does not fake it.

loadFixtureEnv();

const [ORG_A, ORG_B] = TIER2_FIXTURE_TENANTS;

type Target = { url: string; anonKey: string; serviceRoleKey: string };
type Resolution = { ok: true; target: Target } | { ok: false; reason: string };

/**
 * Resolve the project to run against, or a reason to skip cleanly. Three
 * independent requirements:
 *  - an anon key (signs in as the two permanent fixture owners) AND a
 *    service-role key (provisions/cleans up the throwaway co-member — no
 *    authenticated path can add an org_members row for someone else);
 *  - DEV specifically (`allowsTier2Fixtures`) — the only project the
 *    permanent fixture tenants exist on.
 */
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
  console.info(`[user_agents RLS] skipped — ${resolution.reason}`);
}

describe.skipIf(!resolution.ok)(
  "user_agents RLS (live DEV, Tier-2 permanent fixture tenants)",
  () => {
    const target = resolution.ok ? resolution.target : null;
    const tag = randomUUID().slice(0, 8);

    let admin: SupabaseClient<Database>; // service role — setup/cleanup only
    let userA: SupabaseClient<Database>; // fixture org A owner
    let userB: SupabaseClient<Database>; // fixture org B owner (cross-org)
    let coMemberA: SupabaseClient<Database>; // throwaway SAME-ORG-A non-owner
    let coMemberId = "";
    let agentIdA = "";

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

      // Positive control + seed in one step: fixture-A owner creates their
      // own agent through their OWN authenticated client. If `with check`
      // ever regressed to reject a well-formed same-org insert, this line —
      // not a separate assertion — is where the whole suite would fail.
      const { data: agent, error: agentErr } = await userA
        .from("user_agents")
        .insert({
          org_id: ORG_A.orgId,
          owner_id:
            (await userA.auth.getUser()).data.user?.id ??
            (() => {
              throw new Error("fixture A signed in but has no user id");
            })(),
          name: `rls-probe ${tag}`,
          template_id: "integration-test",
          instructions: "RLS integration-test fixture agent. Never runs.",
          board_scope: { mode: "all" },
          cadence: "daily",
          run_at_local_hour: 7,
          enabled: false, // never eligible for the sweep, regardless of hour
        })
        .select("id")
        .single();
      expect(agentErr, "fixture-A owner creates own agent").toBeNull();
      agentIdA = (agent as { id: string }).id;

      // Throwaway co-member: a brand-new auth user, ATTACHED to org A's
      // existing membership table so it is a real "same-org, different
      // person" per `is_org_member`. Nothing about fixture A's own rows (or
      // the org itself) is modified — this is purely additive and is removed
      // in afterAll below.
      const coMemberEmail = `useragents-comember-${tag}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email: coMemberEmail,
          password: "Test-Password-123!",
          email_confirm: true,
        });
      expect(createErr, "create throwaway co-member").toBeNull();
      coMemberId = created.user!.id;

      const { error: memberErr } = await admin.from("org_members").insert({
        org_id: ORG_A.orgId,
        user_id: coMemberId,
        role: "member",
      });
      expect(memberErr, "attach throwaway co-member to org A").toBeNull();

      coMemberA = await signIn(coMemberEmail, "Test-Password-123!");
    }, 60_000);

    afterAll(async () => {
      // Unconditional and best-effort, mirroring agent-run.integration.test.ts:
      // runs even if beforeAll threw partway through, and deleting a row that
      // was never created is a no-op, not an error.
      if (agentIdA) {
        const { error } = await admin
          .from("user_agents")
          .delete()
          .eq("id", agentIdA);
        if (error) {
          console.warn(
            `[user_agents RLS] cleanup failed for agent ${agentIdA}: ` +
              `${error.message} — delete it by hand from DEV.`,
          );
        }
      }
      if (coMemberId) {
        // Explicit membership delete first (belt-and-suspenders — deleting
        // the auth user cascades this too via org_members' `on delete
        // cascade` FK), THEN the throwaway user itself.
        const { error: memberDelErr } = await admin
          .from("org_members")
          .delete()
          .eq("org_id", ORG_A.orgId)
          .eq("user_id", coMemberId);
        if (memberDelErr) {
          console.warn(
            `[user_agents RLS] org_members cleanup failed for ${coMemberId}: ` +
              `${memberDelErr.message} — remove it by hand from DEV org ` +
              `${ORG_A.orgId}.`,
          );
        }
        const { error: userDelErr } =
          await admin.auth.admin.deleteUser(coMemberId);
        if (userDelErr) {
          console.warn(
            `[user_agents RLS] throwaway user cleanup failed for ` +
              `${coMemberId}: ${userDelErr.message} — delete it by hand from DEV.`,
          );
        }
      }
    }, 30_000);

    // ── Property 1: an owner reads their own agent ──────────────────────
    it("lets the owner read their own agent", async () => {
      const { data, error } = await userA
        .from("user_agents")
        .select("id, name")
        .eq("id", agentIdA);
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.id)).toEqual([agentIdA]);
    });

    // ── Property 2: a same-org non-owner sees nothing ───────────────────
    it("hides the agent from a SAME-ORG non-owner — instructions are personal", async () => {
      const { data, error } = await coMemberA
        .from("user_agents")
        .select("id")
        .eq("id", agentIdA);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    // ── Property 3: a cross-org user sees nothing ───────────────────────
    it("hides the agent from a CROSS-ORG user", async () => {
      const { data, error } = await userB
        .from("user_agents")
        .select("id")
        .eq("id", agentIdA);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    // ── Property 4: an insert claiming another user as owner_id is refused ─
    it("refuses an insert that claims another user as owner_id", async () => {
      const bId = (await userB.auth.getUser()).data.user?.id;
      expect(bId, "fixture B user id").toBeTruthy();

      const { data, error } = await userA
        .from("user_agents")
        .insert({
          org_id: ORG_A.orgId, // A's own org — is_org_member(org_id) holds
          owner_id: bId!, // but owner_id != auth.uid() — must fail
          name: `rls-probe-owner-spoof ${tag}`,
          template_id: "integration-test",
          instructions: "Should never be written.",
          enabled: false,
        })
        .select("id");
      expect(error, "owner-spoofing insert").not.toBeNull();
      expect(data).toBeNull();

      // Confirm nothing landed, via the privileged client.
      const { data: check } = await admin
        .from("user_agents")
        .select("id")
        .eq("name", `rls-probe-owner-spoof ${tag}`);
      expect(check ?? []).toEqual([]);
    });

    // ── Property 5: an insert naming a foreign org_id is refused ────────
    it("refuses an insert whose org_id names an org the caller does not belong to", async () => {
      const aId = (await userA.auth.getUser()).data.user?.id;
      expect(aId, "fixture A user id").toBeTruthy();

      const { data, error } = await userA
        .from("user_agents")
        .insert({
          org_id: ORG_B.orgId, // A is not a member of org B
          owner_id: aId!, // owner_id = auth.uid() holds, but org check fails
          name: `rls-probe-foreign-org ${tag}`,
          template_id: "integration-test",
          instructions: "Should never be written.",
          enabled: false,
        })
        .select("id");
      expect(error, "foreign-org insert").not.toBeNull();
      expect(data).toBeNull();

      // Confirm nothing landed, via the privileged client.
      const { data: check } = await admin
        .from("user_agents")
        .select("id")
        .eq("name", `rls-probe-foreign-org ${tag}`);
      expect(check ?? []).toEqual([]);
    });

    // ── Property 6: bridge_secret_id is not client-writable ─────────────
    //
    // `user_agents_owner_all` is `for all`, so RLS alone lets the OWNER patch
    // any column of their own row — including `bridge_secret_id`, which holds
    // the Vault secret id for their agent's bridged session. The containment is
    // therefore a GRANT, not a policy: 20260802034242 revoked authenticated's
    // table-level INSERT/UPDATE and re-granted them column by column, with this
    // column left out. That distinction is invisible to a policy-only test, and
    // the consequence is concrete — `user_agents_vault_cleanup` deletes
    // whatever secret id the row names when the row is deleted, so a writable
    // column here is a way to delete another user's MCP OAuth secret.
    it("refuses an owner's UPDATE of bridge_secret_id (column grant, not RLS)", async () => {
      const { error } = await userA
        .from("user_agents")
        .update({ bridge_secret_id: randomUUID() })
        .eq("id", agentIdA)
        .select("id");
      expect(error, "authenticated update of bridge_secret_id").not.toBeNull();

      const { data: check } = await admin
        .from("user_agents")
        .select("bridge_secret_id")
        .eq("id", agentIdA)
        .single();
      expect(check?.bridge_secret_id, "must be untouched").toBeNull();
    });

    it("refuses an INSERT that names bridge_secret_id", async () => {
      const aId = (await userA.auth.getUser()).data.user?.id;
      const { data, error } = await userA
        .from("user_agents")
        .insert({
          org_id: ORG_A.orgId,
          owner_id: aId!,
          name: `rls-probe-bridge ${tag}`,
          template_id: "integration-test",
          instructions: "Should never be written.",
          enabled: false,
          bridge_secret_id: randomUUID(),
        })
        .select("id");
      expect(error, "insert naming bridge_secret_id").not.toBeNull();
      expect(data).toBeNull();

      const { data: check } = await admin
        .from("user_agents")
        .select("id")
        .eq("name", `rls-probe-bridge ${tag}`);
      expect(check ?? []).toEqual([]);
    });

    // The columns the app actually writes must STILL be writable — the grant
    // list is easy to under-specify, and getting it wrong bricks the editor
    // rather than failing loudly anywhere else.
    it("still lets the owner update the columns the editor writes", async () => {
      const { error } = await userA
        .from("user_agents")
        .update({
          name: `rls-probe-renamed ${tag}`,
          instructions: "Renamed by the grant regression test.",
          board_scope: { mode: "all" },
          cadence: "daily",
          run_at_local_hour: 9,
          template_id: "integration-test",
          enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", agentIdA);
      expect(error, "editor-shaped update must still succeed").toBeNull();
    });
  },
);
