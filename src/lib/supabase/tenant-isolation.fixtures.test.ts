import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import {
  type FixtureTenant,
  TIER2_FIXTURE_MESSAGE_COUNTS,
  TIER2_FIXTURE_PASSWORD,
  TIER2_FIXTURE_TENANTS,
  TIER2_PROPOSAL_MESSAGE_ID,
  loadFixtureEnv,
  resolveFixtureTarget,
} from "@/test/tenant-fixtures";
import type { Database } from "@/types/database.types";

// ===========================================================================
// TIER 2 — "one logged-in tenant can reach nothing of another's", proven
// against the LIVE DEV project.
// ===========================================================================
//
// Run: `pnpm test:fixtures` (also part of `pnpm test`).
//
// WHY THIS EXISTS
// The conformance tier proves a LOGGED-OUT visitor reaches nothing. The
// authenticated half — cross-tenant isolation between two signed-in users — was
// ungated, because every assertion of it lived in a `*.integration.test.ts`
// suite that provisions users, and those all skip without a sacrificial
// Supabase project (decision-25). Among the casualties: the two Ask Pulse
// Phase 2 RLS assertions below, which shipped and had never once executed.
//
// WHAT MAKES IT POSSIBLE
// Two PERMANENT tenants seeded once into DEV by
// supabase/migrations/20260727094033_seed_tier2_tenant_fixtures.sql and never
// mutated. Isolation is then a READ-ONLY assertion: sign in as one, ask for the
// other's rows, expect nothing. No provisioning, no privileged key, no purge.
//
// THE ANTI-VACUITY GUARD IS LOAD-BEARING
// "Returned no rows" is only evidence if the rows exist and someone CAN see
// them. If the fixture were ever lost, every isolation assertion below would
// pass against nothing. The first describe block asserts the corpus is present
// and non-empty from each tenant's own side; it must fail loudly, not skip.

loadFixtureEnv();

const resolution = resolveFixtureTarget(process.env);

if (!resolution.ok) {
  console.info(`[tier2] skipped — ${resolution.reason}`);
}

const [ALPHA, BETA] = TIER2_FIXTURE_TENANTS;

type SignedInTenant = {
  fixture: FixtureTenant;
  userId: string;
  client: SupabaseClient<Database>;
};

describe.skipIf(!resolution.ok)(
  "tenant isolation between logged-in users (live DEV fixtures)",
  () => {
    const target = resolution.ok ? resolution.target : null;

    let alpha: SignedInTenant;
    let beta: SignedInTenant;

    async function signIn(fixture: FixtureTenant): Promise<SignedInTenant> {
      const client = createClient<Database>(target!.url, target!.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      // Rides out GoTrue's 429 and THROWS if still unauthenticated — a silently
      // signed-out client would make every "no rows" assertion below vacuous.
      await signInOrThrow(
        client,
        { email: fixture.email, password: TIER2_FIXTURE_PASSWORD },
        `tier-2 fixture ${fixture.label}`,
      );
      const { data } = await client.auth.getUser();
      if (!data.user) {
        throw new Error(
          `tier-2 fixture ${fixture.label} signed in but has no user — is ` +
            "supabase/migrations/20260727094033_seed_tier2_tenant_fixtures.sql " +
            "applied to DEV, and were the accounts created from " +
            "supabase/fixtures/tier2-fixture-users.dev-only.sql?",
        );
      }
      return { fixture, userId: data.user.id, client };
    }

    beforeAll(async () => {
      console.info(
        `[tier2] asserting isolation on ${target!.label.toUpperCase()} between ` +
          `${ALPHA.orgSlug} and ${BETA.orgSlug}`,
      );
      alpha = await signIn(ALPHA);
      beta = await signIn(BETA);
    }, 120_000);

    // -----------------------------------------------------------------------
    // Anti-vacuity: the corpus exists and each tenant can see its own half.
    // -----------------------------------------------------------------------
    describe("the permanent fixture corpus is present", () => {
      it("gives each tenant exactly one org — their own", async () => {
        for (const tenant of [alpha, beta]) {
          const { data, error } = await tenant.client
            .from("organizations")
            .select("id, slug");
          expect(error, `orgs(${tenant.fixture.label})`).toBeNull();
          expect(data).toEqual([
            { id: tenant.fixture.orgId, slug: tenant.fixture.orgSlug },
          ]);
        }
      });

      it("lets each tenant read their own workspace, board and group", async () => {
        for (const tenant of [alpha, beta]) {
          const { fixture } = tenant;
          const workspace = await tenant.client
            .from("workspaces")
            .select("id")
            .eq("id", fixture.workspaceId);
          const board = await tenant.client
            .from("boards")
            .select("id, name")
            .eq("id", fixture.boardId);
          const group = await tenant.client
            .from("groups")
            .select("id")
            .eq("id", fixture.groupId);
          expect(workspace.data).toEqual([{ id: fixture.workspaceId }]);
          expect(board.data).toEqual([
            { id: fixture.boardId, name: fixture.boardName },
          ]);
          expect(group.data).toEqual([{ id: fixture.groupId }]);
        }
      });

      it("lets each tenant read their own Ask Pulse thread and its turns", async () => {
        for (const tenant of [alpha, beta]) {
          const { fixture } = tenant;
          const conversation = await tenant.client
            .from("ai_conversations")
            .select("id, title, user_id")
            .eq("id", fixture.conversationId);
          expect(conversation.data).toEqual([
            {
              id: fixture.conversationId,
              title: fixture.conversationTitle,
              user_id: tenant.userId,
            },
          ]);

          const messages = await tenant.client
            .from("ai_messages")
            .select("id")
            .eq("conversation_id", fixture.conversationId);
          expect(messages.data ?? []).toHaveLength(
            TIER2_FIXTURE_MESSAGE_COUNTS[fixture.label],
          );
        }
      });

      it("shows the owner their own Phase-2 proposal trace", async () => {
        // The mirror image of the isolation assertion further down: if the
        // OWNER could not see it either, "the stranger sees nothing" would
        // prove nothing at all.
        const { data, error } = await alpha.client
          .from("ai_messages")
          .select("id, tool_trace")
          .eq("id", TIER2_PROPOSAL_MESSAGE_ID);
        expect(error).toBeNull();
        expect(data ?? []).toHaveLength(1);
        expect(JSON.stringify(data![0].tool_trace)).toContain(
          "proposedActions",
        );
      });
    });

    // -----------------------------------------------------------------------
    // The isolation matrix — every org-scoped table, both directions.
    // -----------------------------------------------------------------------
    describe("neither tenant can read a row belonging to the other", () => {
      const cases: {
        table: string;
        column: string;
        of: (t: FixtureTenant) => string;
      }[] = [
        { table: "organizations", column: "id", of: (t) => t.orgId },
        { table: "org_members", column: "org_id", of: (t) => t.orgId },
        { table: "workspaces", column: "id", of: (t) => t.workspaceId },
        { table: "boards", column: "id", of: (t) => t.boardId },
        { table: "groups", column: "id", of: (t) => t.groupId },
        {
          table: "ai_conversations",
          column: "id",
          of: (t) => t.conversationId,
        },
      ];

      for (const { table, column, of } of cases) {
        it(`${table}: each tenant gets nothing when naming the other's row id`, async () => {
          const probes = [
            { reader: () => alpha, subject: BETA },
            { reader: () => beta, subject: ALPHA },
          ];
          for (const { reader, subject } of probes) {
            const tenant = reader();
            // Row-typing across a table name held in a variable is what the
            // generated Database union cannot express; the assertion is on the
            // ROW COUNT, which is type-independent.
            const { data, error } = await tenant.client
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .from(table as any)
              .select(column)
              .eq(column, of(subject));
            expect(
              error,
              `${table} read by ${tenant.fixture.label} errored`,
            ).toBeNull();
            expect(
              data ?? [],
              `${tenant.fixture.label} must not see ${subject.label}'s ${table}`,
            ).toEqual([]);
          }
        });
      }

      it("profiles: neither tenant can read the other's profile row", async () => {
        // `profiles` is not org-scoped by a column — the policy is "self or a
        // co-member". Two tenants that share no org are therefore strangers.
        const alphaSeesBeta = await alpha.client
          .from("profiles")
          .select("id")
          .eq("id", beta.userId);
        const betaSeesAlpha = await beta.client
          .from("profiles")
          .select("id")
          .eq("id", alpha.userId);
        expect(alphaSeesBeta.data ?? []).toEqual([]);
        expect(betaSeesAlpha.data ?? []).toEqual([]);
      });
    });

    // -----------------------------------------------------------------------
    // Ask Pulse Phase 2 — the two assertions that had never executed.
    // -----------------------------------------------------------------------
    describe("Ask Pulse Phase 2: proposal and outcome traces", () => {
      // Proposal + outcome rows ride in `ai_messages.tool_trace`. No new table
      // and no new policy, so the isolation guarantee is exactly the parent
      // conversation's — which is what these two pin down.

      it("hides a proposal trace from a non-owner", async () => {
        const { data, error } = await beta.client
          .from("ai_messages")
          .select("id, tool_trace")
          .eq("conversation_id", ALPHA.conversationId);
        expect(error).toBeNull();
        expect(data ?? []).toHaveLength(0);
      });

      it("refuses an outcome message written into someone else's thread", async () => {
        // A write ATTEMPT that RLS must refuse. Nothing lands — and if it ever
        // did, the integrity check below turns it into a loud failure.
        const { error } = await beta.client.from("ai_messages").insert({
          conversation_id: ALPHA.conversationId,
          role: "assistant",
          content: "Cancelled — nothing was changed.",
          tool_trace: {
            resolvesProposal: TIER2_PROPOSAL_MESSAGE_ID,
            outcome: "cancelled",
          },
        });
        expect(error).not.toBeNull();
      });
    });

    // -----------------------------------------------------------------------
    // Writes RLS must refuse.
    // -----------------------------------------------------------------------
    describe("neither tenant can write into the other's org", () => {
      it("refuses a conversation forged under the other tenant's identity", async () => {
        const { error } = await beta.client.from("ai_conversations").insert({
          org_id: ALPHA.orgId,
          user_id: alpha.userId,
          title: "forged",
        });
        expect(error).not.toBeNull();
      });

      it("refuses a conversation in the other tenant's org under one's own id", async () => {
        const { error } = await beta.client.from("ai_conversations").insert({
          org_id: ALPHA.orgId,
          user_id: beta.userId,
          title: "trespass",
        });
        expect(error).not.toBeNull();
      });

      it("silently matches no rows when updating the other tenant's board", async () => {
        // RLS `using` turns a cross-tenant UPDATE into a zero-row match rather
        // than an error — so the proof is the empty returning set plus the
        // unchanged value read back by the owner.
        const { data, error } = await beta.client
          .from("boards")
          .update({ name: "hijacked" })
          .eq("id", ALPHA.boardId)
          .select("id");
        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);
      });

      it("silently matches no rows when deleting the other tenant's group", async () => {
        const { data, error } = await beta.client
          .from("groups")
          .delete()
          .eq("id", ALPHA.groupId)
          .select("id");
        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);
      });
    });

    // -----------------------------------------------------------------------
    // Integrity: the permanent fixture survived every refused write above.
    // -----------------------------------------------------------------------
    // If one of these ever fails, the isolation boundary is broken AND the
    // permanent fixture has been polluted. Repair: delete the stray rows from
    // the two fixture conversations and re-apply
    // 20260727094033_seed_tier2_tenant_fixtures.sql (idempotent). Fix the RLS
    // policy first — otherwise the next run pollutes it again.
    describe("the fixture is unchanged after the refused writes", () => {
      it("leaves each thread with exactly its seeded number of turns", async () => {
        for (const tenant of [alpha, beta]) {
          const { data } = await tenant.client
            .from("ai_messages")
            .select("id")
            .eq("conversation_id", tenant.fixture.conversationId);
          expect(
            data ?? [],
            `a refused write LANDED in ${tenant.fixture.label}'s thread`,
          ).toHaveLength(TIER2_FIXTURE_MESSAGE_COUNTS[tenant.fixture.label]);
        }
      });

      it("leaves each board and group intact and unrenamed", async () => {
        for (const tenant of [alpha, beta]) {
          const board = await tenant.client
            .from("boards")
            .select("name")
            .eq("id", tenant.fixture.boardId)
            .single();
          expect(board.data?.name).toBe(tenant.fixture.boardName);

          const group = await tenant.client
            .from("groups")
            .select("id")
            .eq("id", tenant.fixture.groupId);
          expect(group.data ?? []).toHaveLength(1);
        }
      });
    });
  },
);
