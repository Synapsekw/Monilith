import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import {
  TIER2_BOARD_MEMBER_FIXTURE,
  TIER2_BOARD_THREAD_FIXTURE,
  TIER2_FIXTURE_MESSAGE_COUNTS,
  TIER2_FIXTURE_PASSWORD,
  TIER2_FIXTURE_TENANTS,
  loadFixtureEnv,
  resolveFixtureTarget,
} from "@/test/tenant-fixtures";
import type { Database } from "@/types/database.types";

// ===========================================================================
// TIER 2 — the board-thread RLS widening, proven against the LIVE DEV project.
// ===========================================================================
//
// Run: `pnpm test:fixtures` (also part of `pnpm test`).
//
// WHAT IS BEING PROVEN AND WHY IT MATTERS
// 20260804031458_board_threads.sql added two ADDITIVE SELECT policies:
//
//   board_id is not null and visibility = 'board' and public.can_read_board(board_id)
//
// on `ai_conversations`, and its mirror on `ai_messages`. Widening a SELECT
// policy on the table that holds every user's private /ask history is the entire
// risk of the board-dock feature: get the predicate wrong and personal
// conversations become org-readable. Nothing short of asking the live database,
// as a real non-owning user, actually proves it did not.
//
// WHY THIS IS TIER 2 AND NOT AN INTEGRATION SUITE
// The natural home would be `*.integration.test.ts`, which provisions its own
// users. Those all self-skip: `integrationTargetReady()` deny-lists DEV and PROD
// because the Tier-1 teardown is a destructive `@example.com` purge, and
// decision-25 rules out a sacrificial project. A suite that skips proves
// nothing, however well written — see the companion
// `board-threads.rls.integration.test.ts`, which is committed as documentation
// only. Tier 2 INVERTS that deny-list (allowsTier2Fixtures() permits DEV alone)
// precisely because it reads permanent seeded fixtures instead of provisioning,
// so it actually executes. Same precedent that rescued the Ask Pulse Phase-2
// proposal-trace assertion in July 2026.
//
// THE ANTI-VACUITY GUARD IS LOAD-BEARING
// Every interesting assertion here is "gamma sees nothing". That is only
// evidence if (a) gamma is genuinely signed in, and (b) the rows exist and
// somebody CAN see them. The first describe block pins both down and must fail
// loudly rather than skip; without it the whole file would pass green against a
// lost fixture or a logged-out client.
//
// THE THREE PRINCIPALS
//   alpha — owns the Alpha org, both boards, and every conversation here.
//   gamma — second ACTIVE member of the Alpha org, granted the shared board via
//           `board_members`. can_read_board() requires both, which is why a
//           third identity had to exist at all: alpha and beta share no org.
//   beta  — a different org entirely. The cross-tenant control.

loadFixtureEnv();

const resolution = resolveFixtureTarget(process.env);

if (!resolution.ok) {
  console.info(`[board-threads] skipped — ${resolution.reason}`);
}

const [ALPHA, BETA] = TIER2_FIXTURE_TENANTS;
const F = TIER2_BOARD_THREAD_FIXTURE;

type Principal = {
  label: string;
  userId: string;
  client: SupabaseClient<Database>;
};

describe.skipIf(!resolution.ok)(
  "board-thread RLS widening (live DEV fixtures)",
  () => {
    const target = resolution.ok ? resolution.target : null;

    let alpha: Principal;
    let gamma: Principal;
    let beta: Principal;

    async function signIn(
      label: string,
      email: string,
      expectedUserId?: string,
    ): Promise<Principal> {
      const client = createClient<Database>(target!.url, target!.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      // Rides out GoTrue's 429 and THROWS if still unauthenticated. A silently
      // signed-out client would make every "sees nothing" assertion vacuous.
      await signInOrThrow(
        client,
        { email, password: TIER2_FIXTURE_PASSWORD },
        `tier-2 fixture ${label}`,
      );
      const { data } = await client.auth.getUser();
      if (!data.user) {
        throw new Error(
          `tier-2 fixture ${label} signed in but has no user — are the accounts ` +
            "created from supabase/fixtures/tier2-fixture-users.dev-only.sql and " +
            "is the board-thread seed migration applied to DEV?",
        );
      }
      if (expectedUserId && data.user.id !== expectedUserId) {
        throw new Error(
          `tier-2 fixture ${label} is ${data.user.id}, expected ${expectedUserId} — ` +
            "the seed migration attaches rows to the expected id, so a mismatch " +
            "would make every assertion below run against the wrong principal.",
        );
      }
      return { label, userId: data.user.id, client };
    }

    beforeAll(async () => {
      console.info(
        `[board-threads] asserting the widened SELECT policies on ${target!.label.toUpperCase()}`,
      );
      alpha = await signIn("alpha (owner)", ALPHA.email);
      gamma = await signIn(
        "gamma (board member)",
        TIER2_BOARD_MEMBER_FIXTURE.email,
        TIER2_BOARD_MEMBER_FIXTURE.userId,
      );
      beta = await signIn("beta (other org)", BETA.email);
    }, 120_000);

    // -----------------------------------------------------------------------
    // Anti-vacuity: the principals are real and the corpus exists.
    // -----------------------------------------------------------------------
    describe("the board-thread fixture corpus is present", () => {
      it("signs gamma in as a genuinely authenticated, distinct principal", async () => {
        expect(gamma.userId).toBe(TIER2_BOARD_MEMBER_FIXTURE.userId);
        expect(gamma.userId).not.toBe(alpha.userId);
        expect(gamma.userId).not.toBe(beta.userId);
      });

      it("makes gamma an ACTIVE member of the Alpha org (can_read_board's first conjunct)", async () => {
        // If this were false, every "gamma sees nothing" case below would pass
        // for the wrong reason — org membership, not board membership.
        const { data, error } = await gamma.client
          .from("organizations")
          .select("id, slug");
        expect(error).toBeNull();
        expect(data).toEqual([{ id: ALPHA.orgId, slug: ALPHA.orgSlug }]);
      });

      it("grants gamma the shared board but NOT the off-limits board", async () => {
        // `boards: read if can read` is is_org_member AND (creator OR
        // is_board_member) — the same shape can_read_board() evaluates. Gamma
        // seeing exactly one of the two boards is the fixture's own proof that
        // the two negatives below differ only in board membership.
        const { data, error } = await gamma.client.from("boards").select("id");
        expect(error).toBeNull();
        expect((data ?? []).map((b) => b.id)).toEqual([F.sharedBoardId]);
      });

      it("lets the owner read both board threads and their turns", async () => {
        const { data, error } = await alpha.client
          .from("ai_conversations")
          .select("id, board_id, visibility, user_id")
          .in("id", [F.sharedConversationId, F.offBoardConversationId])
          .order("id");
        expect(error).toBeNull();
        expect(data).toEqual([
          {
            id: F.sharedConversationId,
            board_id: F.sharedBoardId,
            visibility: "board",
            user_id: alpha.userId,
          },
          {
            id: F.offBoardConversationId,
            board_id: F.offBoardId,
            visibility: "board",
            user_id: alpha.userId,
          },
        ]);

        const messages = await alpha.client
          .from("ai_messages")
          .select("id")
          .eq("conversation_id", F.sharedConversationId);
        expect((messages.data ?? []).map((m) => m.id).sort()).toEqual(
          [...F.sharedMessageIds].sort(),
        );
      });

      it("keeps the pre-existing /ask thread private and boardless", async () => {
        // The regression subject. If the seed ever flipped these columns, the
        // headline assertion below would be testing the wrong row.
        const { data, error } = await alpha.client
          .from("ai_conversations")
          .select("id, board_id, visibility")
          .eq("id", ALPHA.conversationId);
        expect(error).toBeNull();
        expect(data).toEqual([
          {
            id: ALPHA.conversationId,
            board_id: null,
            visibility: "private",
          },
        ]);
      });
    });

    // -----------------------------------------------------------------------
    // 1. THE REGRESSION TEST FOR THE WHOLE FEATURE.
    // -----------------------------------------------------------------------
    describe("a private /ask conversation stays owner-only after the widening", () => {
      it("hides the owner's private thread from a same-org board member", async () => {
        const { data, error } = await gamma.client
          .from("ai_conversations")
          .select("id")
          .eq("id", ALPHA.conversationId);
        expect(error).toBeNull();
        expect(
          data ?? [],
          "PRIVATE /ask HISTORY HAS LEAKED to a co-member of the owner's org",
        ).toEqual([]);
      });

      it("hides the owner's private thread from another org entirely", async () => {
        const { data, error } = await beta.client
          .from("ai_conversations")
          .select("id")
          .eq("id", ALPHA.conversationId);
        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);
      });

      it("hides every turn of the private thread from a same-org board member", async () => {
        const { data, error } = await gamma.client
          .from("ai_messages")
          .select("id")
          .eq("conversation_id", ALPHA.conversationId);
        expect(error).toBeNull();
        expect(
          data ?? [],
          "PRIVATE /ask MESSAGES HAVE LEAKED to a co-member of the owner's org",
        ).toEqual([]);
      });

      it("leaves the owner's own view of the private thread intact", async () => {
        // The mirror image: "gamma sees nothing" is only meaningful while the
        // owner still sees everything.
        const { data } = await alpha.client
          .from("ai_messages")
          .select("id")
          .eq("conversation_id", ALPHA.conversationId);
        expect(data ?? []).toHaveLength(TIER2_FIXTURE_MESSAGE_COUNTS.a);
      });
    });

    // -----------------------------------------------------------------------
    // 2. The widened read actually works for the intended reader.
    // -----------------------------------------------------------------------
    describe("a visibility='board' thread is readable by a member of that board", () => {
      it("shows the shared thread to a board member who does not own it", async () => {
        const { data, error } = await gamma.client
          .from("ai_conversations")
          .select("id, title, user_id, visibility")
          .eq("id", F.sharedConversationId);
        expect(error).toBeNull();
        expect(data).toEqual([
          {
            id: F.sharedConversationId,
            title: F.sharedConversationTitle,
            user_id: alpha.userId,
            visibility: "board",
          },
        ]);
        // Read via the NEW policy, not the owner policy: gamma is not the owner.
        expect(data![0].user_id).not.toBe(gamma.userId);
      });

      it("shows the shared thread's turns to that board member (ai_messages mirrors)", async () => {
        const { data, error } = await gamma.client
          .from("ai_messages")
          .select("id")
          .eq("conversation_id", F.sharedConversationId);
        expect(error).toBeNull();
        expect((data ?? []).map((m) => m.id).sort()).toEqual(
          [...F.sharedMessageIds].sort(),
        );
      });
    });

    // -----------------------------------------------------------------------
    // 3. Same org, wrong board — the conjunct that is easy to get wrong.
    // -----------------------------------------------------------------------
    describe("a same-org user who is not on the board cannot read the thread", () => {
      it("hides a thread shared to a board gamma is not a member of", async () => {
        // Gamma is an ACTIVE member of this exact org (asserted above) and the
        // thread IS visibility='board'. The only thing standing between gamma
        // and the row is can_read_board()'s board-membership check.
        const { data, error } = await gamma.client
          .from("ai_conversations")
          .select("id")
          .eq("id", F.offBoardConversationId);
        expect(error).toBeNull();
        expect(
          data ?? [],
          "visibility='board' is behaving as visibility='org'",
        ).toEqual([]);
      });

      it("hides that thread's turns too", async () => {
        const { data, error } = await gamma.client
          .from("ai_messages")
          .select("id")
          .eq("conversation_id", F.offBoardConversationId);
        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);
      });
    });

    // -----------------------------------------------------------------------
    // 4. The org boundary still holds for a shared thread.
    // -----------------------------------------------------------------------
    describe("a user in another org cannot read a shared thread", () => {
      it("hides the shared thread from the other tenant", async () => {
        const { data, error } = await beta.client
          .from("ai_conversations")
          .select("id")
          .eq("id", F.sharedConversationId);
        expect(error).toBeNull();
        expect(
          data ?? [],
          "CROSS-TENANT LEAK: visibility='board' escaped the org boundary",
        ).toEqual([]);
      });

      it("hides the shared thread's turns from the other tenant", async () => {
        const { data, error } = await beta.client
          .from("ai_messages")
          .select("id")
          .eq("conversation_id", F.sharedConversationId);
        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);
      });

      it("hides the shared thread from an UNFILTERED listing, not just by id", async () => {
        // Naming the id proves the policy refuses that row; listing everything
        // proves no OTHER path (a permissive policy on a join, a view) hands it
        // over. Both fixture threads must be absent from beta's whole world.
        const { data, error } = await beta.client
          .from("ai_conversations")
          .select("id");
        expect(error).toBeNull();
        const ids = (data ?? []).map((c) => c.id);
        expect(ids).not.toContain(F.sharedConversationId);
        expect(ids).not.toContain(F.offBoardConversationId);
        expect(ids).not.toContain(ALPHA.conversationId);
      });
    });

    // -----------------------------------------------------------------------
    // 5. The widening is SELECT-only: a board member reads, never writes.
    // -----------------------------------------------------------------------
    // These are write ATTEMPTS that RLS must refuse — the same deliberate,
    // documented exception the tenant-isolation suite already makes ("THE ONE
    // HONEST CAVEAT" in src/test/tenant-fixtures.ts). A refused write leaves
    // nothing behind, and the integrity block below re-reads the fixture to
    // prove it. If one ever DID land, that is the emergency this tier exists to
    // surface, and it fails loudly here rather than shipping unnoticed.
    describe("a shared thread is readable but never writable by a board member", () => {
      it("refuses a message posted into a thread gamma does not own", async () => {
        // ai_messages_insert_own requires c.user_id = auth.uid(); the new SELECT
        // policy does not widen INSERT.
        const { error } = await gamma.client.from("ai_messages").insert({
          conversation_id: F.sharedConversationId,
          role: "user",
          content: "posting into someone else's shared thread",
        });
        expect(error).not.toBeNull();
      });

      it("matches no rows when gamma renames the shared thread", async () => {
        // RLS `using` turns an unauthorised UPDATE into a zero-row match rather
        // than an error, so the empty returning set IS the refusal.
        const { data, error } = await gamma.client
          .from("ai_conversations")
          .update({ title: "hijacked" })
          .eq("id", F.sharedConversationId)
          .select("id");
        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);
      });

      it("matches no rows when gamma un-shares the thread", async () => {
        const { data, error } = await gamma.client
          .from("ai_conversations")
          .update({ visibility: "private" })
          .eq("id", F.sharedConversationId)
          .select("id");
        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);
      });

      it("matches no rows when gamma deletes the shared thread", async () => {
        const { data, error } = await gamma.client
          .from("ai_conversations")
          .delete()
          .eq("id", F.sharedConversationId)
          .select("id");
        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);
      });
    });

    // -----------------------------------------------------------------------
    // Integrity: the permanent fixture survived every refused write above.
    // -----------------------------------------------------------------------
    // Repair, if one of these ever fails: fix the RLS policy FIRST (otherwise
    // the next run pollutes it again), then delete the stray rows from the
    // fixture conversation and re-apply the board-thread seed migration, which
    // is idempotent.
    describe("the fixture is unchanged after the refused writes", () => {
      it("leaves the shared thread named, shared, and with exactly its seeded turns", async () => {
        const { data } = await alpha.client
          .from("ai_conversations")
          .select("title, visibility")
          .eq("id", F.sharedConversationId)
          .single();
        expect(data?.title).toBe(F.sharedConversationTitle);
        expect(data?.visibility).toBe("board");

        const messages = await alpha.client
          .from("ai_messages")
          .select("id")
          .eq("conversation_id", F.sharedConversationId);
        expect(
          messages.data ?? [],
          "a refused write LANDED in the shared fixture thread",
        ).toHaveLength(F.sharedMessageIds.length);
      });
    });
  },
);
