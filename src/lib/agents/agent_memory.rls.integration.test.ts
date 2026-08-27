import { randomUUID } from "node:crypto";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import { allowsTier2Fixtures } from "@/lib/supabase/project-refs";
import { typedRpc } from "@/lib/supabase/typed-rpc";
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
// `agent_memory` (supabase/migrations/20260827095748_agent_memory.sql) is a
// per-agent store of keyed, single-line notes, and it is the first table in
// this codebase a LANGUAGE MODEL writes to. Its containment properties are
// therefore only worth what the DATABASE enforces, because the model does not
// go through the Zod layer the owner's form does:
//
//   - default-deny, owner-scoped RLS on all four verbs, `is_org_member` on the
//     write side only (the same asymmetry as agent_documents);
//   - the `value` check constraint: ONE line, 1..500 chars — a value that
//     cannot contain a newline cannot open a block or forge a heading in the
//     system prompt;
//   - the `key` check constraint: slug-shaped, so a key can never be a
//     sentence or a prompt fragment;
//   - `agent_remember()`'s four outcomes, in particular that it REFUSES at the
//     50-note cap rather than evicting, and REFUSES a key an `origin='owner'`
//     note holds — the owner's word is the fixed point of the feature;
//   - the cascades: an agent takes its memory with it, a pruned RUN does not.
//
// ===========================================================================
// WHY *.rls.integration.test.ts (TIER-1 PROJECT) BUT TARGETING TIER-2'S
// PERMANENT FIXTURES
// ===========================================================================
//
// Identical to `agent_documents.rls.integration.test.ts`: this suite needs
// authenticated INSERT and RPC paths, so it cannot live in the non-privileged
// Tier-2 `*.fixtures.test.ts` project. It gates on `allowsTier2Fixtures()`
// (DEV, specifically) and hangs everything off the two PERMANENT Tier-2
// fixture tenants' org/owner ids. See that file for the long version.
//
// ===========================================================================
// FOOTPRINT — what this file adds to DEV, and what it never touches
// ===========================================================================
//
//  - Three `user_agents` rows for fixture-A owner (alice): the main probe, a
//    "cap" agent seeded to exactly 50 notes, and a throwaway used only to
//    prove the delete cascade. All `enabled: false` so the sweep cron never
//    picks them up.
//  - One throwaway co-member (bob) — a brand-new auth user attached to org A's
//    membership table — because the two permanent fixture tenants live in
//    DIFFERENT orgs and the "same org, different person" property needs a
//    second person inside org A.
//  - One `user_agent_runs` row, `status: 'error'`, deleted mid-suite to prove
//    `last_run_id` nulls rather than cascading.
//  - Every `agent_memory` row created here hangs off one of those agents, so
//    deleting the agents in `afterAll` removes them. The agents, the org
//    membership row and the throwaway auth user are all removed in `afterAll`
//    through the service-role client, UNCONDITIONALLY — the DEV database holds
//    real user data (decision-32).

loadFixtureEnv();

const [ORG_A, ORG_B] = TIER2_FIXTURE_TENANTS;

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
  console.info(`[agent_memory RLS] skipped — ${resolution.reason}`);
}

describe.skipIf(!resolution.ok)(
  "agent_memory RLS + agent_remember (live DEV, Tier-2 permanent fixture tenants)",
  () => {
    const target = resolution.ok ? resolution.target : null;
    const tag = randomUUID().slice(0, 8);

    let admin: SupabaseClient<Database>; // service role — setup/cleanup only
    let alice: SupabaseClient<Database>; // fixture org A owner
    let bob: SupabaseClient<Database>; // throwaway SAME-ORG-A non-owner
    let orgBUser: SupabaseClient<Database>; // fixture org B owner
    let aliceId = "";
    let bobId = "";
    let aliceAgentId = "";
    let capAgentId = "";
    let throwawayAgentId = "";
    let bobCoMemberId = "";
    let throwawayRunId = "";
    let provenanceNoteId = "";
    let aliceNoteId = "";
    const agentIds: string[] = [];

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

    async function insertAgent(
      client: SupabaseClient<Database>,
      ownerId: string,
      name: string,
    ): Promise<string> {
      const { data, error } = await client
        .from("user_agents")
        .insert({
          org_id: ORG_A.orgId,
          owner_id: ownerId,
          name: `${name} ${tag}`,
          template_id: "integration-test",
          instructions: "RLS integration-test fixture agent. Never runs.",
          board_scope: { mode: "all" },
          cadence: "daily",
          run_at_local_hour: 7,
          enabled: false, // never eligible for the sweep
        })
        .select("id")
        .single();
      if (error) throw new Error(`seed user_agents failed: ${error.message}`);
      const id = (data as { id: string }).id;
      agentIds.push(id);
      return id;
    }

    beforeAll(async () => {
      admin = createClient<Database>(target!.url, target!.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      alice = await signIn(ORG_A.email, TIER2_FIXTURE_PASSWORD);
      const aId = (await alice.auth.getUser()).data.user?.id;
      if (!aId) throw new Error("fixture A signed in but has no user id");
      aliceId = aId;

      orgBUser = await signIn(ORG_B.email, TIER2_FIXTURE_PASSWORD);

      aliceAgentId = await insertAgent(alice, aliceId, "mem-rls-probe");
      capAgentId = await insertAgent(alice, aliceId, "mem-rls-cap");
      throwawayAgentId = await insertAgent(alice, aliceId, "mem-rls-throwaway");

      // Exactly 50 notes on the cap agent, seeded through the SERVICE ROLE so
      // the seeding itself never depends on the behaviour under test.
      const { error: capErr } = await admin.from("agent_memory").insert(
        Array.from({ length: 50 }, (_, i) => ({
          user_agent_id: capAgentId,
          org_id: ORG_A.orgId,
          owner_id: aliceId,
          key: `cap-note-${i}`,
          value: `seeded note ${i}`,
          origin: "agent",
          token_estimate: 4,
        })),
      );
      if (capErr) throw new Error(`seed cap notes failed: ${capErr.message}`);

      // A run row, so the provenance cascade has something real to null out.
      const { data: run, error: runErr } = await admin
        .from("user_agent_runs")
        .insert({
          user_agent_id: throwawayAgentId,
          org_id: ORG_A.orgId,
          owner_id: aliceId,
          fire_date: "2026-08-27",
          fire_hour: 7,
          status: "error",
          error: "integration-test fixture run — never executed",
        })
        .select("id")
        .single();
      if (runErr) throw new Error(`seed run failed: ${runErr.message}`);
      throwawayRunId = (run as { id: string }).id;

      // Throwaway co-member (bob): a brand-new auth user ATTACHED to org A's
      // existing membership table, so "same org, different person" is real per
      // `is_org_member`. Nothing about fixture A's own rows is modified.
      const bobEmail = `agentmem-comember-${tag}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email: bobEmail,
          password: "Test-Password-123!",
          email_confirm: true,
        });
      if (createErr) {
        throw new Error(
          `create throwaway co-member failed: ${createErr.message}`,
        );
      }
      bobCoMemberId = created.user!.id;
      bobId = bobCoMemberId;

      const { error: memberErr } = await admin.from("org_members").insert({
        org_id: ORG_A.orgId,
        user_id: bobCoMemberId,
        role: "member",
      });
      if (memberErr) {
        throw new Error(
          `attach co-member to org A failed: ${memberErr.message}`,
        );
      }
      bob = await signIn(bobEmail, "Test-Password-123!");

      // One note alice owns, used by the visibility properties.
      const { data: note, error: noteErr } = await alice
        .from("agent_memory")
        .insert({
          user_agent_id: aliceAgentId,
          org_id: ORG_A.orgId,
          owner_id: aliceId,
          key: "alices-note",
          value: "only alice may see this",
          origin: "owner",
          token_estimate: 6,
        })
        .select("id")
        .single();
      if (noteErr)
        throw new Error(`seed alice note failed: ${noteErr.message}`);
      aliceNoteId = (note as { id: string }).id;

      // A note whose provenance points at the throwaway run.
      const { data: prov, error: provErr } = await admin
        .from("agent_memory")
        .insert({
          user_agent_id: throwawayAgentId,
          org_id: ORG_A.orgId,
          owner_id: aliceId,
          key: "provenance",
          value: "written by a run that will be pruned",
          origin: "agent",
          token_estimate: 9,
          last_run_id: throwawayRunId,
        })
        .select("id")
        .single();
      if (provErr)
        throw new Error(`seed provenance failed: ${provErr.message}`);
      provenanceNoteId = (prov as { id: string }).id;
    }, 60_000);

    afterAll(async () => {
      // Unconditional and best-effort. Deleting the agents cascades their
      // memory away, which is the point of the cascade property below.
      for (const id of agentIds) {
        if (!id) continue;
        const { error } = await admin.from("user_agents").delete().eq("id", id);
        if (error) {
          console.warn(
            `[agent_memory RLS] cleanup failed for agent ${id}: ` +
              `${error.message} — delete it by hand from DEV.`,
          );
        }
      }
      if (bobCoMemberId) {
        const { error: memberDelErr } = await admin
          .from("org_members")
          .delete()
          .eq("org_id", ORG_A.orgId)
          .eq("user_id", bobCoMemberId);
        if (memberDelErr) {
          console.warn(
            `[agent_memory RLS] org_members cleanup failed for ` +
              `${bobCoMemberId}: ${memberDelErr.message} — remove it by hand ` +
              `from DEV org ${ORG_A.orgId}.`,
          );
        }
        const { error: userDelErr } =
          await admin.auth.admin.deleteUser(bobCoMemberId);
        if (userDelErr) {
          console.warn(
            `[agent_memory RLS] throwaway user cleanup failed for ` +
              `${bobCoMemberId}: ${userDelErr.message} — delete it by hand ` +
              `from DEV.`,
          );
        }
      }
    }, 30_000);

    // ── Visibility ───────────────────────────────────────────────────────
    it("lets an owner read their own note", async () => {
      const { data, error } = await alice
        .from("agent_memory")
        .select("id")
        .eq("id", aliceNoteId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("a co-member in the SAME org cannot read another person's memory", async () => {
      const { data } = await bob
        .from("agent_memory")
        .select("id")
        .eq("id", aliceNoteId);
      expect(data ?? []).toEqual([]);
    });

    it("cross-org read is denied", async () => {
      const { data } = await orgBUser
        .from("agent_memory")
        .select("id")
        .eq("id", aliceNoteId);
      expect(data ?? []).toEqual([]);
    });

    it("insert with a foreign owner_id is denied", async () => {
      const { error } = await alice.from("agent_memory").insert({
        user_agent_id: aliceAgentId,
        org_id: ORG_A.orgId,
        owner_id: bobId,
        key: "nope",
        value: "x",
        origin: "owner",
        token_estimate: 1,
      });
      expect(error).not.toBeNull();
    });

    it("insert into an org the caller does not belong to is denied", async () => {
      const { error } = await alice.from("agent_memory").insert({
        user_agent_id: aliceAgentId,
        org_id: ORG_B.orgId,
        owner_id: aliceId,
        key: "foreign-org",
        value: "should never land",
        origin: "owner",
        token_estimate: 4,
      });
      expect(error).not.toBeNull();
    });

    it("update cannot re-parent a note to another owner", async () => {
      const { error } = await alice
        .from("agent_memory")
        .update({ owner_id: bobId })
        .eq("id", aliceNoteId);
      expect(error).not.toBeNull();

      const { data: after } = await alice
        .from("agent_memory")
        .select("owner_id")
        .eq("id", aliceNoteId)
        .single();
      expect((after as { owner_id: string }).owner_id).toBe(aliceId);
    });

    // ── The check constraints, which are the containment ─────────────────
    it("a value containing a newline is rejected by the check constraint", async () => {
      const { error } = await alice.from("agent_memory").insert({
        user_agent_id: aliceAgentId,
        org_id: ORG_A.orgId,
        owner_id: aliceId,
        key: "multi-line",
        value: "one\ntwo",
        origin: "owner",
        token_estimate: 1,
      });
      expect(error?.message).toMatch(
        /agent_memory_value_check|violates check constraint/,
      );
    });

    it("a value over 500 characters is rejected by the check constraint", async () => {
      const { error } = await alice.from("agent_memory").insert({
        user_agent_id: aliceAgentId,
        org_id: ORG_A.orgId,
        owner_id: aliceId,
        key: "too-long",
        value: "x".repeat(501),
        origin: "owner",
        token_estimate: 126,
      });
      expect(error?.message).toMatch(
        /agent_memory_value_check|violates check constraint/,
      );
    });

    it("a key that is not slug-shaped is rejected by the check constraint", async () => {
      const { error } = await alice.from("agent_memory").insert({
        user_agent_id: aliceAgentId,
        org_id: ORG_A.orgId,
        owner_id: aliceId,
        key: "Not A Slug",
        value: "x",
        origin: "owner",
        token_estimate: 1,
      });
      expect(error?.message).toMatch(
        /agent_memory_key_check|violates check constraint/,
      );
    });

    // ── agent_remember() ─────────────────────────────────────────────────
    it("agent_remember writes, then replaces, the same key", async () => {
      const first = await typedRpc(alice, "agent_remember", {
        p_user_agent_id: aliceAgentId,
        p_key: "dana-group",
        p_value: "Dana's items live in Ops",
        p_token_estimate: 7,
        p_run_id: null,
      });
      expect(first.data).toBe("written");
      const second = await typedRpc(alice, "agent_remember", {
        p_user_agent_id: aliceAgentId,
        p_key: "dana-group",
        p_value: "Dana's items live in Ops, not Assigned",
        p_token_estimate: 10,
        p_run_id: null,
      });
      expect(second.data).toBe("replaced");
    });

    it("agent_remember refuses a key owned by an origin='owner' note", async () => {
      await alice.from("agent_memory").insert({
        user_agent_id: aliceAgentId,
        org_id: ORG_A.orgId,
        owner_id: aliceId,
        key: "frozen-board",
        value: "design board is frozen until October",
        origin: "owner",
        token_estimate: 9,
      });
      const res = await typedRpc(alice, "agent_remember", {
        p_user_agent_id: aliceAgentId,
        p_key: "frozen-board",
        p_value: "chase the design board daily",
        p_token_estimate: 8,
        p_run_id: null,
      });
      expect(res.data).toBe("refused_owner_note");
      const { data } = await alice
        .from("agent_memory")
        .select("value")
        .eq("user_agent_id", aliceAgentId)
        .eq("key", "frozen-board")
        .single();
      expect((data as { value: string }).value).toBe(
        "design board is frozen until October",
      );
    });

    it("agent_remember refuses at the 50-note cap and evicts nothing", async () => {
      const res = await typedRpc(alice, "agent_remember", {
        p_user_agent_id: capAgentId,
        p_key: "one-too-many",
        p_value: "x",
        p_token_estimate: 1,
        p_run_id: null,
      });
      expect(res.data).toBe("refused_cap");
      const { count } = await alice
        .from("agent_memory")
        .select("id", { count: "exact", head: true })
        .eq("user_agent_id", capAgentId);
      expect(count).toBe(50);
    });

    it("agent_remember at the cap still REPLACES an existing key", async () => {
      // The cap must bound growth, not freeze the agent: overwriting a key it
      // already holds adds no row and must therefore still be allowed.
      const res = await typedRpc(alice, "agent_remember", {
        p_user_agent_id: capAgentId,
        p_key: "cap-note-0",
        p_value: "revised at the cap",
        p_token_estimate: 5,
        p_run_id: null,
      });
      expect(res.data).toBe("replaced");
    });

    it("agent_remember raises for an agent the caller cannot see", async () => {
      // SECURITY INVOKER, so alice's RLS is what hides bob's agent. An
      // unreachable agent is a bug or an attack, not one of the four statuses.
      const bobAgentId = await insertAgent(bob, bobId, "mem-rls-bobs");
      const { error } = await typedRpc(alice, "agent_remember", {
        p_user_agent_id: bobAgentId,
        p_key: "not-mine",
        p_value: "x",
        p_token_estimate: 1,
        p_run_id: null,
      });
      expect(error).not.toBeNull();
    });

    // ── Cascades ─────────────────────────────────────────────────────────
    it("deleting a run NULLS last_run_id and keeps the note", async () => {
      await admin.from("user_agent_runs").delete().eq("id", throwawayRunId);
      const { data } = await admin
        .from("agent_memory")
        .select("id, last_run_id")
        .eq("id", provenanceNoteId)
        .single();
      expect((data as { last_run_id: string | null }).last_run_id).toBeNull();
    });

    it("deleting an agent cascades its memory away", async () => {
      await admin.from("user_agents").delete().eq("id", throwawayAgentId);
      const { count } = await admin
        .from("agent_memory")
        .select("id", { count: "exact", head: true })
        .eq("user_agent_id", throwawayAgentId);
      expect(count).toBe(0);
    });
  },
);
