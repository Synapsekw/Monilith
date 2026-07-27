import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type TestUser = {
  id: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!integrationTargetReady())(
  "RLS: ai_conversations / ai_messages — owner-scoped read + write isolation",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `rls-ask-${label}-${randomUUID()}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
        });
      expect(createErr, `createUser(${label})`).toBeNull();
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
      return { id, anon };
    }

    async function provisionOrg(u: TestUser, label: string): Promise<string> {
      const { data: org, error: orgErr } = await u.anon.rpc(
        "create_organization",
        {
          p_name: `rls-ask-${label}`,
          p_slug: `rls-ask-${label}-${randomUUID().slice(0, 8)}`,
        },
      );
      expect(orgErr, `create_organization(${label})`).toBeNull();
      return (org as { id: string }).id;
    }

    beforeAll(async () => {
      admin = createClient<Database>(URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }, 120_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("a user reads and writes only their own conversations; a stranger is locked out", async () => {
      const alice = await provisionUser("alice");
      const orgA = await provisionOrg(alice, "a");

      // Alice can create her own conversation in her own org.
      const ins = await alice.anon
        .from("ai_conversations")
        .insert({ org_id: orgA, user_id: alice.id, title: "Alice chat" })
        .select("id")
        .single();
      expect(ins.error).toBeNull();
      const convId = ins.data!.id;

      // Alice can insert a message into her own conversation.
      const aliceMsg = await alice.anon
        .from("ai_messages")
        .insert({ conversation_id: convId, role: "user", content: "hi" });
      expect(aliceMsg.error).toBeNull();

      const bob = await provisionUser("bob");

      // Bob cannot SEE Alice's conversation.
      const bobRead = await bob.anon
        .from("ai_conversations")
        .select("id")
        .eq("id", convId);
      expect(bobRead.data).toEqual([]);

      // Bob cannot SEE Alice's messages.
      const bobMsgRead = await bob.anon
        .from("ai_messages")
        .select("id")
        .eq("conversation_id", convId);
      expect(bobMsgRead.data).toEqual([]);

      // Bob cannot INSERT a message into Alice's conversation.
      const bobWrite = await bob.anon
        .from("ai_messages")
        .insert({ conversation_id: convId, role: "user", content: "hijack" });
      expect(bobWrite.error).not.toBeNull();

      // Bob cannot forge a conversation as Alice (user_id must be his own).
      const bobForge = await bob.anon
        .from("ai_conversations")
        .insert({ org_id: orgA, user_id: alice.id, title: "forged" });
      expect(bobForge.error).not.toBeNull();
    });

    // ── Phase 2: proposal + outcome rows ride in `ai_messages.tool_trace` ──────
    // No new table and no new policy, so the isolation guarantee is exactly the
    // parent conversation's. These two cases pin that down for the write path.

    /** Provisioned once and shared by the two cases below — GoTrue rate-limits
     *  aggressive per-test user creation (hence `fileParallelism: false`). */
    let pair: { owner: TestUser; stranger: TestUser; orgId: string } | null =
      null;
    async function proposalPair() {
      if (!pair) {
        const owner = await provisionUser("owner");
        const orgId = await provisionOrg(owner, "owner");
        const stranger = await provisionUser("stranger");
        pair = { owner, stranger, orgId };
      }
      return pair;
    }

    async function createConversationFor(u: TestUser, orgId: string) {
      const ins = await u.anon
        .from("ai_conversations")
        .insert({ org_id: orgId, user_id: u.id, title: "proposal thread" })
        .select("id")
        .single();
      expect(ins.error).toBeNull();
      return ins.data!.id;
    }

    it("hides a proposal trace from a non-owner", async () => {
      const { owner, stranger, orgId } = await proposalPair();
      const conversationId = await createConversationFor(owner, orgId);

      const wrote = await owner.anon.from("ai_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: "I'll create that —",
        tool_trace: {
          proposedActions: [
            {
              kind: "create_item",
              boardId: "b1",
              groupId: "g1",
              name: "Ship v2",
              summary: 'Create task "Ship v2" in Backlog',
              warnings: [],
            },
          ],
        },
      });
      expect(wrote.error).toBeNull();

      const { data } = await stranger.anon
        .from("ai_messages")
        .select("id, tool_trace")
        .eq("conversation_id", conversationId);
      expect(data ?? []).toHaveLength(0);
    });

    it("refuses an outcome message written into someone else's thread", async () => {
      const { owner, stranger, orgId } = await proposalPair();
      const conversationId = await createConversationFor(owner, orgId);

      const { error } = await stranger.anon.from("ai_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: "Cancelled — nothing was changed.",
        tool_trace: { resolvesProposal: conversationId, outcome: "cancelled" },
      });
      expect(error).not.toBeNull();
    });
  },
);
