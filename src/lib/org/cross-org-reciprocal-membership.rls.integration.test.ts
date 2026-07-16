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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PW = "Test-Password-123!";
type Role = Database["public"]["Enums"]["org_role"];

describe.skipIf(!integrationTargetReady())(
  "cross-org reciprocal membership",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    async function makeUser(email: string) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PW,
        email_confirm: true,
      });
      expect(error).toBeNull();
      const id = created.user!.id;
      createdUserIds.push(id);
      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: sErr } = await signInWithRetry(anon, {
        email,
        password: PW,
      });
      expect(sErr).toBeNull();
      return { id, anon };
    }

    async function makeOwnedOrg(anon: SupabaseClient<Database>, label: string) {
      const { data, error } = await anon.rpc("create_organization", {
        p_name: `${label} Org`,
        p_slug: `${label}-${randomUUID().slice(0, 8)}`,
      });
      expect(error, `create_organization for ${label}`).toBeNull();
      return (data as { id: string }).id;
    }

    async function seedInvite(
      orgId: string,
      inviterId: string,
      email: string,
      role: Role,
    ) {
      const { data, error } = await admin
        .from("org_invitations")
        .insert({
          org_id: orgId,
          email,
          role,
          invited_by: inviterId,
          status: "pending",
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      return (data as { id: string }).id;
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    });

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    });

    it("accept_invitation adds the inviter as a guest of the invitee's owned org", async () => {
      const alice = await makeUser(`alice-${randomUUID()}@example.com`);
      const orgA = await makeOwnedOrg(alice.anon, "alice");
      const bobEmail = `bob-${randomUUID()}@example.com`;
      const bob = await makeUser(bobEmail);
      const orgB = await makeOwnedOrg(bob.anon, "bob");

      const inviteId = await seedInvite(orgA, alice.id, bobEmail, "member");
      const { error } = await bob.anon.rpc("accept_invitation", {
        p_invite_id: inviteId,
      });
      expect(error).toBeNull();

      const fwd = await admin
        .from("org_members")
        .select("role")
        .eq("org_id", orgA)
        .eq("user_id", bob.id)
        .single();
      expect((fwd.data as { role: Role }).role).toBe("member");

      const recip = await admin
        .from("org_members")
        .select("role")
        .eq("org_id", orgB)
        .eq("user_id", alice.id)
        .single();
      expect(recip.error, "reciprocal membership row should exist").toBeNull();
      expect((recip.data as { role: Role }).role).toBe("guest");
    });

    it("reverse-share works end-to-end after reciprocation", async () => {
      const alice = await makeUser(`alice2-${randomUUID()}@example.com`);
      const orgA = await makeOwnedOrg(alice.anon, "alice2");
      const bobEmail = `bob2-${randomUUID()}@example.com`;
      const bob = await makeUser(bobEmail);
      const orgB = await makeOwnedOrg(bob.anon, "bob2");

      const inviteId = await seedInvite(orgA, alice.id, bobEmail, "member");
      await bob.anon.rpc("accept_invitation", { p_invite_id: inviteId });

      const { data: ws } = await admin
        .from("workspaces")
        .select("id")
        .eq("org_id", orgB)
        .limit(1)
        .single();
      const workspaceId = (ws as { id: string }).id;
      const { data: board, error: boardErr } = await bob.anon.rpc(
        "create_board",
        {
          p_workspace_id: workspaceId,
          p_name: "Bob's board",
        },
      );
      expect(boardErr, "create_board").toBeNull();
      const boardId = (board as { id: string }).id;

      const { error: shareErr } = await bob.anon.rpc("share_board", {
        p_board_id: boardId,
        p_user_id: alice.id,
        p_access: "viewer",
      });
      expect(shareErr, "Bob can now share his board with Alice").toBeNull();

      const { data: readable } = await alice.anon
        .from("boards")
        .select("id")
        .eq("id", boardId);
      expect(readable, "Alice reads Bob's shared board").toHaveLength(1);
    });

    it("accept_invitation does NOT reciprocate when the invitee owns no org", async () => {
      const alice = await makeUser(`alice3-${randomUUID()}@example.com`);
      const orgA = await makeOwnedOrg(alice.anon, "alice3");
      const carolEmail = `carol-${randomUUID()}@example.com`;
      const carol = await makeUser(carolEmail);

      const inviteId = await seedInvite(orgA, alice.id, carolEmail, "member");
      const { error } = await carol.anon.rpc("accept_invitation", {
        p_invite_id: inviteId,
      });
      expect(error, "accept still succeeds").toBeNull();

      const aliceMemberships = await admin
        .from("org_members")
        .select("org_id")
        .eq("user_id", alice.id);
      expect(
        (aliceMemberships.data ?? []).map(
          (m) => (m as { org_id: string }).org_id,
        ),
      ).toEqual([orgA]);
    });

    it("reciprocal insert never demotes an existing higher role (on conflict do nothing)", async () => {
      const alice = await makeUser(`alice4-${randomUUID()}@example.com`);
      const orgA = await makeOwnedOrg(alice.anon, "alice4");
      const bobEmail = `bob4-${randomUUID()}@example.com`;
      const bob = await makeUser(bobEmail);
      const orgB = await makeOwnedOrg(bob.anon, "bob4");
      await admin
        .from("org_members")
        .insert({ org_id: orgB, user_id: alice.id, role: "admin" });

      const inviteId = await seedInvite(orgA, alice.id, bobEmail, "member");
      await bob.anon.rpc("accept_invitation", { p_invite_id: inviteId });

      const recip = await admin
        .from("org_members")
        .select("role")
        .eq("org_id", orgB)
        .eq("user_id", alice.id)
        .single();
      expect((recip.data as { role: Role }).role).toBe("admin");
    });

    it("redeem_invitations reciprocates for a redeemer who already owns an org", async () => {
      const alice = await makeUser(`alice5-${randomUUID()}@example.com`);
      const orgA = await makeOwnedOrg(alice.anon, "alice5");
      const daveEmail = `dave-${randomUUID()}@example.com`;
      const dave = await makeUser(daveEmail);
      const orgD = await makeOwnedOrg(dave.anon, "dave");

      await seedInvite(orgA, alice.id, daveEmail, "member");
      const { error } = await dave.anon.rpc("redeem_invitations");
      expect(error).toBeNull();

      const recip = await admin
        .from("org_members")
        .select("role")
        .eq("org_id", orgD)
        .eq("user_id", alice.id)
        .single();
      expect(recip.error, "reciprocal via redeem path").toBeNull();
      expect((recip.data as { role: Role }).role).toBe("guest");
    });
  },
);
