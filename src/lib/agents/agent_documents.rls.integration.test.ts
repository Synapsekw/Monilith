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
// `agent_documents` and `user_agent_documents`
// (supabase/migrations/20260824164412_agent_reference_documents.sql) are a
// PERSONAL reference-document library and its many-to-many join to
// `user_agents`. Both are owner-scoped, default-deny RLS —
// `agent_documents_owner_*` is `owner_id = auth.uid()` on all four verbs, and
// the join's `user_agent_documents_owner_*` policies resolve through BOTH
// parents (the agent must be the caller's AND the document must be the
// caller's), so a caller cannot attach someone else's document to their own
// agent even though they own the agent side of the join. Neither guarantee
// had ever been exercised against a real database before this file.
//
// ===========================================================================
// WHY *.rls.integration.test.ts (TIER-1 PROJECT) BUT TARGETING TIER-2'S
// PERMANENT FIXTURES
// ===========================================================================
//
// Same escape hatch as `user_agents.rls.integration.test.ts`: this suite
// needs authenticated INSERT paths (to prove the join's `with check`), so it
// cannot live in the non-privileged Tier-2 `*.fixtures.test.ts` project. It
// gates on `allowsTier2Fixtures()` (DEV, specifically) instead of
// `integrationTargetReady()`, and hangs everything off the two PERMANENT
// Tier-2 fixture tenants' org/owner ids. See that file for the long version.
//
// ===========================================================================
// FOOTPRINT — what this file adds to DEV, and what it never touches
// ===========================================================================
//
//  - One `user_agents` row for fixture-A owner (alice), inserted through her
//    OWN authenticated client, `enabled: false` so the sweep cron never picks
//    it up.
//  - One throwaway co-member (bob) — a brand-new auth user ATTACHED to org
//    A's existing membership table, exactly like `user_agents.rls
//    .integration.test.ts` — because the two permanent fixture tenants are in
//    DIFFERENT orgs and this suite needs a second, distinct person IN THE
//    SAME org as alice. Bob also gets his own `user_agents` row so the
//    "attach someone else's document" property has an agent that is
//    genuinely his to attach to.
//  - Several `agent_documents` rows, one per property, inserted through the
//    owning user's own authenticated client. All are deleted in `afterAll`
//    via the service-role client, unconditionally.
//  - Both the throwaway co-member's `org_members` row and the auth user
//    itself are removed in `afterAll`, mirroring `user_agents.rls
//    .integration.test.ts` exactly.

loadFixtureEnv();

const [ORG_A] = TIER2_FIXTURE_TENANTS;

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
  console.info(`[agent_documents RLS] skipped — ${resolution.reason}`);
}

describe.skipIf(!resolution.ok)(
  "agent_documents RLS (live DEV, Tier-2 permanent fixture tenants)",
  () => {
    const target = resolution.ok ? resolution.target : null;
    const tag = randomUUID().slice(0, 8);

    let admin: SupabaseClient<Database>; // service role — setup/cleanup only
    let alice: SupabaseClient<Database>; // fixture org A owner
    let bob: SupabaseClient<Database>; // throwaway SAME-ORG-A non-owner
    let aliceId = "";
    let bobId = "";
    let aliceAgentId = "";
    let bobAgentId = "";
    let bobCoMemberId = "";
    const documentIds: string[] = [];

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

    async function insertDocument(
      client: SupabaseClient<Database>,
      ownerId: string,
      title: string,
    ): Promise<string> {
      const { data, error } = await client
        .from("agent_documents")
        .insert({
          org_id: ORG_A.orgId,
          owner_id: ownerId,
          title,
          body: "Yesterday / Today / Blockers",
          token_estimate: 8,
          source_format: "pasted",
        })
        .select("id")
        .single();
      if (error)
        throw new Error(`seed agent_documents failed: ${error.message}`);
      const id = (data as { id: string }).id;
      documentIds.push(id);
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

      // Alice's own agent, inserted through her OWN authenticated client.
      const { data: aliceAgent, error: aliceAgentErr } = await alice
        .from("user_agents")
        .insert({
          org_id: ORG_A.orgId,
          owner_id: aliceId,
          name: `docs-rls-probe-alice ${tag}`,
          template_id: "integration-test",
          instructions: "RLS integration-test fixture agent. Never runs.",
          board_scope: { mode: "all" },
          cadence: "daily",
          run_at_local_hour: 7,
          enabled: false, // never eligible for the sweep
        })
        .select("id")
        .single();
      if (aliceAgentErr) {
        throw new Error(
          `seed alice user_agents failed: ${aliceAgentErr.message}`,
        );
      }
      aliceAgentId = (aliceAgent as { id: string }).id;

      // Throwaway co-member (bob): a brand-new auth user, ATTACHED to org A's
      // existing membership table so it is a real "same-org, different
      // person" per `is_org_member`. Nothing about fixture A's own rows (or
      // the org itself) is modified.
      const bobEmail = `agentdocs-comember-${tag}@example.com`;
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

      // Bob's own agent, so the "attach someone else's document" property has
      // an agent that is genuinely his to attach to.
      const { data: bobAgent, error: bobAgentErr } = await bob
        .from("user_agents")
        .insert({
          org_id: ORG_A.orgId,
          owner_id: bobId,
          name: `docs-rls-probe-bob ${tag}`,
          template_id: "integration-test",
          instructions: "RLS integration-test fixture agent. Never runs.",
          board_scope: { mode: "all" },
          cadence: "daily",
          run_at_local_hour: 7,
          enabled: false,
        })
        .select("id")
        .single();
      if (bobAgentErr) {
        throw new Error(`seed bob user_agents failed: ${bobAgentErr.message}`);
      }
      bobAgentId = (bobAgent as { id: string }).id;
    }, 60_000);

    afterAll(async () => {
      // Unconditional and best-effort: deleting a row that was never created
      // is a no-op, not an error.
      for (const id of documentIds) {
        const { error } = await admin
          .from("agent_documents")
          .delete()
          .eq("id", id);
        if (error) {
          console.warn(
            `[agent_documents RLS] cleanup failed for document ${id}: ` +
              `${error.message} — delete it by hand from DEV.`,
          );
        }
      }
      for (const id of [aliceAgentId, bobAgentId]) {
        if (!id) continue;
        const { error } = await admin.from("user_agents").delete().eq("id", id);
        if (error) {
          console.warn(
            `[agent_documents RLS] cleanup failed for agent ${id}: ` +
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
            `[agent_documents RLS] org_members cleanup failed for ` +
              `${bobCoMemberId}: ${memberDelErr.message} — remove it by hand ` +
              `from DEV org ${ORG_A.orgId}.`,
          );
        }
        const { error: userDelErr } =
          await admin.auth.admin.deleteUser(bobCoMemberId);
        if (userDelErr) {
          console.warn(
            `[agent_documents RLS] throwaway user cleanup failed for ` +
              `${bobCoMemberId}: ${userDelErr.message} — delete it by hand ` +
              `from DEV.`,
          );
        }
      }
    }, 30_000);

    // ── Property 1: an owner reads their own document ────────────────────
    it("lets an owner read their own document", async () => {
      const docId = await insertDocument(alice, aliceId, `Standup ${tag}`);
      const { data, error } = await alice
        .from("agent_documents")
        .select("id")
        .eq("id", docId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    // ── Property 2: a same-org non-owner sees nothing ────────────────────
    it("hides a document from a DIFFERENT user IN THE SAME ORG", async () => {
      const docId = await insertDocument(alice, aliceId, `Private ${tag}`);
      const { data, error } = await bob
        .from("agent_documents")
        .select("id")
        .eq("id", docId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    // ── Property 3: the join's `with check` resolves through BOTH parents ─
    it("refuses attaching someone else's document to your own agent", async () => {
      const aliceDocId = await insertDocument(alice, aliceId, `Alice's ${tag}`);
      const { error } = await bob.from("user_agent_documents").insert({
        user_agent_id: bobAgentId,
        document_id: aliceDocId,
      });
      expect(error).not.toBeNull();
    });

    // ── Property 4: deleting a document cascades its join rows ───────────
    it("cascades join rows when a document is deleted", async () => {
      const docId = await insertDocument(alice, aliceId, `Cascade ${tag}`);
      const { error: joinErr } = await alice
        .from("user_agent_documents")
        .insert({ user_agent_id: aliceAgentId, document_id: docId });
      expect(joinErr).toBeNull();

      const { error: delErr } = await alice
        .from("agent_documents")
        .delete()
        .eq("id", docId);
      expect(delErr).toBeNull();
      // Remove from cleanup tracking — it no longer exists.
      documentIds.splice(documentIds.indexOf(docId), 1);

      const { data } = await alice
        .from("user_agent_documents")
        .select("document_id")
        .eq("document_id", docId);
      expect(data).toEqual([]);
    });

    // ── Property 5: deleting an agent does NOT delete its documents ──────
    it("does NOT delete documents when an agent is deleted", async () => {
      const { data: survivorAgent, error: survivorAgentErr } = await alice
        .from("user_agents")
        .insert({
          org_id: ORG_A.orgId,
          owner_id: aliceId,
          name: `docs-rls-probe-survivor ${tag}`,
          template_id: "integration-test",
          instructions: "RLS integration-test fixture agent. Never runs.",
          board_scope: { mode: "all" },
          cadence: "daily",
          run_at_local_hour: 7,
          enabled: false,
        })
        .select("id")
        .single();
      expect(survivorAgentErr).toBeNull();
      const survivorAgentId = (survivorAgent as { id: string }).id;

      const docId = await insertDocument(alice, aliceId, `Survives ${tag}`);
      const { error: joinErr } = await alice
        .from("user_agent_documents")
        .insert({ user_agent_id: survivorAgentId, document_id: docId });
      expect(joinErr).toBeNull();

      const { error: delErr } = await alice
        .from("user_agents")
        .delete()
        .eq("id", survivorAgentId);
      expect(delErr).toBeNull();

      const { data, error } = await alice
        .from("agent_documents")
        .select("id")
        .eq("id", docId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  },
);
