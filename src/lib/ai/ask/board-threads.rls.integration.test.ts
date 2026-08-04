import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

// ===========================================================================
// ⚠️ THIS SUITE DOES NOT EXECUTE TODAY. IT IS COMMITTED AS DOCUMENTATION.
// ===========================================================================
//
// Every case below is `describe.skipIf(!integrationTargetReady())`, and
// `integrationTargetReady()` is FALSE everywhere it could matter:
// `src/test/integration-env.ts` deny-lists both the DEV and the PROD project
// refs unconditionally, because the Tier-1 teardown is a destructive
// `@example.com` purge, and decision-25 ("no isolated test DB, integration
// opt-in") rules out provisioning a sacrificial project. There is no env var
// that flips it — `PULSE_TEST_DB=1` is ANDed with the deny-list, not an
// override. So this file, like all ~70 of its Tier-1 siblings, reports
// "skipped", not "passed". A skipping suite presented as a guarantee is what
// made the board-thread RLS widening look covered when it was not; this comment
// exists so nobody reads the file below as evidence.
//
// THE PROOF THAT ACTUALLY RUNS IS:
//   src/lib/ai/ask/board-threads.fixtures.test.ts   (`pnpm test:fixtures`)
//
// That is a Tier-2 suite, which INVERTS the deny-list — `allowsTier2Fixtures()`
// permits DEV alone — because it only READS permanent seeded fixtures and never
// provisions or purges. It executes against the live DEV project and covers the
// same properties: private /ask history stays owner-only, a `visibility='board'`
// thread is readable by a member of that board, a same-org non-member and
// another org both see nothing, and `ai_messages` mirrors all of it.
//
// WHAT THIS FILE STILL ADDS, AND WHY IT WAS NOT DELETED
// One property is genuinely out of Tier 2's reach: "read access is REVOKED the
// moment board membership goes away" (the last case here). Proving it requires
// DELETING a `board_members` grant, which a read-only tier asserting against a
// permanent fixture must not do. If a sacrificial project ever exists, this
// suite runs as written and closes that gap. Until then it is a specification,
// not a gate.

loadIntegrationEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type TestUser = { id: string; email: string; anon: SupabaseClient<Database> };

describe.skipIf(!integrationTargetReady())(
  "RLS: board threads — shared reads widen, writes and private history do not",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    // Provisioned ONCE and shared by every case: GoTrue rate-limits aggressive
    // per-test user creation (this is why integration runs with
    // fileParallelism: false).
    let world: {
      owner: TestUser; // creates the board and the thread
      member: TestUser; // same org, ON the board
      outsider: TestUser; // same org, NOT on the board
      stranger: TestUser; // different org entirely
      orgId: string;
      boardId: string;
      sharedThreadId: string;
      privateThreadId: string;
    } | null = null;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `rls-dock-${label}-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      expect(error, `createUser(${label})`).toBeNull();
      const id = created.user!.id;
      createdUserIds.push(id);
      const anon = createClient<Database>(URL!, ANON!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInErr } = await signInWithRetry(anon, {
        email,
        password: PASSWORD,
      });
      expect(signInErr, `signIn(${label})`).toBeNull();
      return { id, email, anon };
    }

    /** Invite + accept, so the user is a real active org member — which
     *  can_read_board() requires before it even looks at board membership. */
    async function joinOrg(u: TestUser, orgId: string, inviterId: string) {
      const { data, error } = await admin
        .from("org_invitations")
        .insert({
          org_id: orgId,
          email: u.email,
          role: "member",
          invited_by: inviterId,
          status: "pending",
        })
        .select("id")
        .single();
      expect(error, "seed invite").toBeNull();
      const { error: acceptErr } = await u.anon.rpc("accept_invitation", {
        p_invite_id: (data as { id: string }).id,
      });
      expect(acceptErr, "accept_invitation").toBeNull();
    }

    async function setup() {
      if (world) return world;

      const owner = await provisionUser("owner");
      const { data: org, error: orgErr } = await owner.anon.rpc(
        "create_organization",
        {
          p_name: "rls-dock",
          p_slug: `rls-dock-${randomUUID().slice(0, 8)}`,
        },
      );
      expect(orgErr, "create_organization").toBeNull();
      const orgId = (org as { id: string }).id;

      const { data: ws } = await admin
        .from("workspaces")
        .select("id")
        .eq("org_id", orgId)
        .limit(1)
        .single();

      const { data: board, error: boardErr } = await admin
        .from("boards")
        .insert({
          org_id: orgId,
          workspace_id: (ws as { id: string }).id,
          name: "Dock board",
          created_by: owner.id,
        })
        .select("id")
        .single();
      expect(boardErr, "create board").toBeNull();
      const boardId = (board as { id: string }).id;

      const member = await provisionUser("member");
      const outsider = await provisionUser("outsider");
      await joinOrg(member, orgId, owner.id);
      await joinOrg(outsider, orgId, owner.id);

      // Only `member` is granted the board.
      const { error: grantErr } = await admin.from("board_members").insert({
        org_id: orgId,
        board_id: boardId,
        user_id: member.id,
        access_level: "viewer",
        granted_by: owner.id,
      });
      expect(grantErr, "grant board").toBeNull();

      const stranger = await provisionUser("stranger");
      const { error: strangerOrgErr } = await stranger.anon.rpc(
        "create_organization",
        {
          p_name: "rls-dock-other",
          p_slug: `rls-dock-other-${randomUUID().slice(0, 8)}`,
        },
      );
      expect(strangerOrgErr, "stranger org").toBeNull();

      const shared = await owner.anon
        .from("ai_conversations")
        .insert({
          org_id: orgId,
          user_id: owner.id,
          board_id: boardId,
          visibility: "board",
          title: "Shared dock thread",
        })
        .select("id")
        .single();
      expect(shared.error, "insert shared thread").toBeNull();
      const sharedThreadId = shared.data!.id;

      const { error: msgErr } = await owner.anon.from("ai_messages").insert({
        conversation_id: sharedThreadId,
        role: "assistant",
        content: "Three items are overdue.",
      });
      expect(msgErr, "insert shared message").toBeNull();

      // A plain /ask conversation: no board, default visibility.
      const priv = await owner.anon
        .from("ai_conversations")
        .insert({ org_id: orgId, user_id: owner.id, title: "Private ask" })
        .select("id, visibility, board_id")
        .single();
      expect(priv.error, "insert private thread").toBeNull();
      expect(priv.data!.visibility).toBe("private");
      expect(priv.data!.board_id).toBeNull();

      world = {
        owner,
        member,
        outsider,
        stranger,
        orgId,
        boardId,
        sharedThreadId,
        privateThreadId: priv.data!.id,
      };
      return world;
    }

    beforeAll(async () => {
      admin = createClient<Database>(URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }, 120_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    // 1. THE REGRESSION TEST FOR THE WHOLE SLICE.
    it("keeps a private /ask conversation owner-only after the migration", async () => {
      const w = await setup();
      const asMember = await w.member.anon
        .from("ai_conversations")
        .select("id")
        .eq("id", w.privateThreadId);
      expect(asMember.data ?? []).toEqual([]);

      const asOutsider = await w.outsider.anon
        .from("ai_conversations")
        .select("id")
        .eq("id", w.privateThreadId);
      expect(asOutsider.data ?? []).toEqual([]);
    }, 120_000);

    it("lets a board member read a thread shared to that board", async () => {
      const w = await setup();
      const { data } = await w.member.anon
        .from("ai_conversations")
        .select("id")
        .eq("id", w.sharedThreadId);
      expect(data).toHaveLength(1);
    }, 120_000);

    it("hides a shared thread from a same-org user who is not on the board", async () => {
      const w = await setup();
      const { data } = await w.outsider.anon
        .from("ai_conversations")
        .select("id")
        .eq("id", w.sharedThreadId);
      expect(data ?? []).toEqual([]);
    }, 120_000);

    it("hides a shared thread from a user in another org", async () => {
      const w = await setup();
      const { data } = await w.stranger.anon
        .from("ai_conversations")
        .select("id")
        .eq("id", w.sharedThreadId);
      expect(data ?? []).toEqual([]);
    }, 120_000);

    it("makes a shared thread READABLE but never WRITABLE by a board member", async () => {
      const w = await setup();

      const insert = await w.member.anon.from("ai_messages").insert({
        conversation_id: w.sharedThreadId,
        role: "user",
        content: "posting into someone else's thread",
      });
      expect(insert.error).not.toBeNull();

      const update = await w.member.anon
        .from("ai_conversations")
        .update({ title: "hijacked" })
        .eq("id", w.sharedThreadId)
        .select("id");
      expect(update.data ?? []).toEqual([]);

      const del = await w.member.anon
        .from("ai_conversations")
        .delete()
        .eq("id", w.sharedThreadId)
        .select("id");
      expect(del.data ?? []).toEqual([]);
    }, 120_000);

    it("mirrors the shared read onto ai_messages", async () => {
      const w = await setup();
      const asMember = await w.member.anon
        .from("ai_messages")
        .select("id")
        .eq("conversation_id", w.sharedThreadId);
      expect(asMember.data).toHaveLength(1);

      const asOutsider = await w.outsider.anon
        .from("ai_messages")
        .select("id")
        .eq("conversation_id", w.sharedThreadId);
      expect(asOutsider.data ?? []).toEqual([]);
    }, 120_000);

    it("revokes read access the moment board membership goes away", async () => {
      const w = await setup();
      const { error } = await admin
        .from("board_members")
        .delete()
        .eq("board_id", w.boardId)
        .eq("user_id", w.member.id);
      expect(error).toBeNull();

      const conv = await w.member.anon
        .from("ai_conversations")
        .select("id")
        .eq("id", w.sharedThreadId);
      expect(conv.data ?? []).toEqual([]);

      const msgs = await w.member.anon
        .from("ai_messages")
        .select("id")
        .eq("conversation_id", w.sharedThreadId);
      expect(msgs.data ?? []).toEqual([]);
    }, 120_000);
  },
);
