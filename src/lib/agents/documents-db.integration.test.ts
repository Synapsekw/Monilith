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
import { listDocumentsForAgent, listAttachmentsByAgent } from "./documents-db";

// ===========================================================================
// THE GUARANTEE UNDER TEST
// ===========================================================================
//
// `documents-db.test.ts` proves `listDocumentsForAgent`/`listAttachmentsByAgent`
// build the SQL strings we intend (`.select("...body...")`, `.eq(...)`,
// `.order(["position", { ascending: true }])`) against a generic fake client
// that returns its preset `data` no matter what those strings are. It cannot
// catch a broken embed: a typo'd relation name (`agent_document!inner`), a
// wrong FK direction, or a bad `referencedTable` value would all still make
// the fake resolve — and would silently return `[]` or `body: undefined`
// against the REAL database, which is exactly the failure mode that would let
// Task 6 build a prompt with no reference documents in it and no error
// anywhere. This suite closes that gap by calling the real functions through
// a real, authenticated Supabase client against real rows.
//
// ===========================================================================
// WHY *.integration.test.ts (TIER-1 PROJECT) BUT TARGETING TIER-2'S PERMANENT
// FIXTURES
// ===========================================================================
//
// Same escape hatch as `agent_documents.rls.integration.test.ts` and
// `agent-tools.rls.integration.test.ts`: this suite needs an authenticated
// INSERT path to seed a document and a join row, so it cannot live in the
// non-privileged Tier-2 `*.fixtures.test.ts` project (which only signs in as
// the two permanent fixtures and reads). It gates on `allowsTier2Fixtures()`
// (DEV, specifically) instead of `integrationTargetReady()` — the standard
// Tier-1 gate explicitly forbids DEV/PROD — and hangs everything off fixture
// tenant A's org/owner id. See that file for the long version.
//
// ===========================================================================
// FOOTPRINT — what this file adds to DEV, and what it never touches
// ===========================================================================
//
//  - One `user_agents` row for fixture-A owner (alice), inserted through her
//    OWN authenticated client, `enabled: false` so the sweep cron never picks
//    it up.
//  - Two `agent_documents` rows, inserted through alice's own authenticated
//    client (NOT through `insertDocument` — seeding via a separate path keeps
//    this a test of the READ helpers, not a tautology against the write
//    helper's own shape).
//  - Two `user_agent_documents` join rows at distinct `position` values,
//    inserted in the OPPOSITE order from their intended read order, so a
//    passing ordering assertion cannot be explained by insertion order.
//  - Everything is deleted in `afterAll` via the service-role client,
//    unconditionally. Deleting the agent cascades its join rows
//    (`user_agent_documents_user_agent_id_fkey ... on delete cascade`); the
//    documents are deleted explicitly.

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
  console.info(`[documents-db integration] skipped — ${resolution.reason}`);
}

describe.skipIf(!resolution.ok)(
  "documents-db read helpers (live DEV, Tier-2 permanent fixture tenant)",
  () => {
    const target = resolution.ok ? resolution.target : null;
    const tag = randomUUID().slice(0, 8);

    let admin: SupabaseClient<Database>; // service role — setup/cleanup only
    let alice: SupabaseClient<Database>; // fixture org A owner
    let aliceId = "";
    let aliceAgentId = "";
    const documentIds: string[] = [];
    let firstDocId = ""; // position 0 — must sort FIRST
    let secondDocId = ""; // position 1 — must sort SECOND

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

    async function insertRawDocument(
      title: string,
      body: string,
    ): Promise<string> {
      const { data, error } = await alice
        .from("agent_documents")
        .insert({
          org_id: ORG_A.orgId,
          owner_id: aliceId,
          title,
          body,
          token_estimate: Math.ceil(body.length / 4),
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

      const { data: aliceAgent, error: aliceAgentErr } = await alice
        .from("user_agents")
        .insert({
          org_id: ORG_A.orgId,
          owner_id: aliceId,
          name: `docs-db-integration-probe ${tag}`,
          template_id: "integration-test",
          instructions:
            "documents-db integration-test fixture agent. Never runs.",
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

      // Seed two documents with distinct, checkable bodies.
      firstDocId = await insertRawDocument(
        `First ${tag}`,
        `First doc body ${tag} — must sort before the second.`,
      );
      secondDocId = await insertRawDocument(
        `Second ${tag}`,
        `Second doc body ${tag} — must sort after the first.`,
      );

      // Attach in the OPPOSITE order from the intended read order: the
      // second document is inserted at position 0 first, then the first
      // document is inserted at position 1 second. If listDocumentsForAgent
      // ever regressed to ordering by insertion/created_at instead of
      // `position`, this would flip the assertion below.
      const { error: joinErr } = await alice
        .from("user_agent_documents")
        .insert([
          {
            user_agent_id: aliceAgentId,
            document_id: secondDocId,
            position: 1,
          },
          { user_agent_id: aliceAgentId, document_id: firstDocId, position: 0 },
        ]);
      if (joinErr) {
        throw new Error(`seed user_agent_documents failed: ${joinErr.message}`);
      }
    }, 60_000);

    afterAll(async () => {
      // Unconditional and best-effort: deleting a row that was never created
      // is a no-op, not an error. Deleting the agent cascades its join rows.
      if (aliceAgentId) {
        const { error } = await admin
          .from("user_agents")
          .delete()
          .eq("id", aliceAgentId);
        if (error) {
          console.warn(
            `[documents-db integration] cleanup failed for agent ` +
              `${aliceAgentId}: ${error.message} — delete it by hand from DEV.`,
          );
        }
      }
      for (const id of documentIds) {
        const { error } = await admin
          .from("agent_documents")
          .delete()
          .eq("id", id);
        if (error) {
          console.warn(
            `[documents-db integration] cleanup failed for document ${id}: ` +
              `${error.message} — delete it by hand from DEV.`,
          );
        }
      }
    }, 30_000);

    it("resolves the embed: body comes back populated, not undefined or []", async () => {
      const docs = await listDocumentsForAgent(alice, aliceAgentId);
      expect(docs).toHaveLength(2);
      const first = docs.find((d) => d.id === firstDocId);
      const second = docs.find((d) => d.id === secondDocId);
      expect(first?.body).toBe(
        `First doc body ${tag} — must sort before the second.`,
      );
      expect(second?.body).toBe(
        `Second doc body ${tag} — must sort after the first.`,
      );
      // tokenEstimate is a real number off the row, not undefined — another
      // symptom a broken embed would produce (NaN or undefined survives a
      // `toHaveLength` check but not this one).
      expect(first?.tokenEstimate).toBeGreaterThan(0);
    });

    it("orders by position ascending, not insertion order", async () => {
      const docs = await listDocumentsForAgent(alice, aliceAgentId);
      // Seeded with the SECOND document inserted at position 0 first — a
      // regression to created_at/insertion ordering would return it first.
      expect(docs.map((d) => d.id)).toEqual([firstDocId, secondDocId]);
    });

    it("listAttachmentsByAgent maps the agent id to both document ids", async () => {
      const byAgent = await listAttachmentsByAgent(alice, aliceId);
      expect(byAgent[aliceAgentId]).toEqual([firstDocId, secondDocId]);
    });
  },
);
