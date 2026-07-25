import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const PW = "Test-Password-123!";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

type TestUser = { id: string; email: string; anon: SupabaseClient<Database> };

/**
 * End-to-end behaviour of self-serve deletion against a real Postgres.
 *
 * The load-bearing case is the second test: the reassigned board must stay
 * readable by the surviving owner even though that owner has NO `board_members`
 * row for it. On DEV, 12 of 15 boards are shaped exactly that way, so the
 * originally-proposed `ON DELETE SET NULL` would have made them — and every item,
 * group, activity and time entry on them — unreadable by anybody, forever. This is
 * the single test that would have caught that design.
 *
 * Factories are local by design: there is no shared factory in this repo, and
 * `src/lib/org/admin.rls.integration.test.ts` is the most complete precedent.
 */
describe.skipIf(!integrationTargetReady())(
  "self-serve account deletion",
  () => {
    const admin = createClient<Database>(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const createdUserIds: string[] = [];

    async function createUser(label: string): Promise<TestUser> {
      const email = `del-${label}-${randomUUID()}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: PW,
        email_confirm: true,
      });
      expect(error, `createUser(${label})`).toBeNull();
      const id = data.user!.id;
      createdUserIds.push(id);

      const anon = createClient<Database>(URL!, ANON!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInErr } = await signInWithRetry(anon, {
        email,
        password: PW,
      });
      expect(signInErr, `signIn(${label})`).toBeNull();
      return { id, email, anon };
    }

    /** The user self-provisions an org + workspace via the atomic RPC. */
    async function provisionOrg(u: TestUser, label: string) {
      const { data: org, error } = await u.anon.rpc("create_organization", {
        p_name: `Del ${label}`,
        p_slug: `del-${label}-${randomUUID().slice(0, 8)}`,
      });
      expect(error, `create_organization(${label})`).toBeNull();
      const orgId = (org as { id: string }).id;

      const { data: ws, error: wsErr } = await u.anon
        .from("workspaces")
        .insert({ org_id: orgId, name: `WS ${label}`, created_by: u.id })
        .select("id")
        .single();
      expect(wsErr, `workspace(${label})`).toBeNull();
      return { orgId, workspaceId: (ws as { id: string }).id };
    }

    let owner: TestUser;
    let leaver: TestUser;
    let orgId: string;
    let boardId: string;
    let itemId: string;
    let updateId: string;
    let botId: string;

    beforeAll(async () => {
      owner = await createUser("owner");
      leaver = await createUser("leaver");

      const org = await provisionOrg(owner, "main");
      orgId = org.orgId;
      const { error: memberErr } = await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: leaver.id, role: "member" });
      expect(memberErr, "add leaver as member").toBeNull();

      // The leaver creates a board and is deliberately NOT added to board_members —
      // that is the shape that makes SET NULL catastrophic.
      const { data: b, error: bErr } = await leaver.anon
        .from("boards")
        .insert({
          org_id: orgId,
          workspace_id: org.workspaceId,
          name: "Leaver board",
          created_by: leaver.id,
        })
        .select("id")
        .single();
      expect(bErr, "leaver board").toBeNull();
      boardId = (b as { id: string }).id;

      const { data: g, error: gErr } = await leaver.anon
        .from("groups")
        .insert({ org_id: orgId, board_id: boardId, name: "G" })
        .select("id")
        .single();
      expect(gErr, "group").toBeNull();

      const { data: i, error: iErr } = await leaver.anon
        .from("items")
        .insert({
          org_id: orgId,
          board_id: boardId,
          group_id: (g as { id: string }).id,
          name: "Item",
          created_by: leaver.id,
        })
        .select("id")
        .single();
      expect(iErr, "item").toBeNull();
      itemId = (i as { id: string }).id;

      const { data: u, error: uErr } = await leaver.anon
        .from("item_updates")
        .insert({
          org_id: orgId,
          board_id: boardId,
          item_id: itemId,
          author_id: leaver.id,
          body: { text: "the leaver wrote this" },
        })
        .select("id")
        .single();
      expect(uErr, "item update").toBeNull();
      updateId = (u as { id: string }).id;

      const { data: bot, error: botErr } = await admin.rpc(
        "platform_agent_user_id",
      );
      expect(botErr, "platform_agent_user_id").toBeNull();
      botId = bot as unknown as string;
    });

    afterAll(async () => {
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id).catch(() => {});
      }
    });

    it("reassigns authorship to the surviving owner and lets the auth user be deleted", async () => {
      const { data: summary, error } = await admin.rpc(
        "user_delete_reassign_authorship",
        { p_user_id: leaver.id },
      );
      expect(error).toBeNull();
      // The counts prove the UPDATEs actually matched rows — a freeze trigger that
      // silently reverted them would still report a row_count, so the assertions
      // below are what really prove it landed.
      expect(summary).toBeTruthy();

      const { error: delErr } = await admin.auth.admin.deleteUser(leaver.id);
      expect(delErr, "deleteUser after reassignment").toBeNull();

      const { data: board } = await admin
        .from("boards")
        .select("created_by")
        .eq("id", boardId)
        .single();
      expect(board!.created_by).toBe(owner.id);

      const { data: item } = await admin
        .from("items")
        .select("created_by")
        .eq("id", itemId)
        .single();
      expect(item!.created_by).toBe(owner.id);
    });

    it("hands the words to the platform bot, not to the org owner (decision D2)", async () => {
      const { data: update } = await admin
        .from("item_updates")
        .select("author_id, body")
        .eq("id", updateId)
        .single();
      // Truthful attribution: nobody inherits edit authority over another person's
      // words. Safe because item_updates is gated by
      // `author_id = auth.uid() OR can_edit_board(board_id)`.
      expect(update!.author_id).toBe(botId);
      expect(update!.author_id).not.toBe(owner.id);
      // The text itself is org record and must survive verbatim.
      expect(update!.body).toEqual({ text: "the leaver wrote this" });
    });

    it("REGRESSION (spec §2.1): the reassigned board is still readable by an owner with no board_members row", async () => {
      const { data: members } = await admin
        .from("board_members")
        .select("user_id")
        .eq("board_id", boardId)
        .eq("user_id", owner.id);
      expect(members ?? [], "the whole point: no grant row").toHaveLength(0);

      const { data: readable, error } =
        await owner.anon.rpc("readable_board_ids");
      expect(error).toBeNull();
      expect(readable).toContain(boardId);

      const { data: items } = await owner.anon
        .from("items")
        .select("id")
        .eq("board_id", boardId);
      expect((items ?? []).map((r) => r.id)).toContain(itemId);
    });

    it("refuses a sole owner and mutates nothing", async () => {
      const solo = await createUser("solo");
      const org = await provisionOrg(solo, "solo");

      // The widened gate: the user may ask about THEMSELVES.
      const { data: sole, error: soleErr } = await solo.anon.rpc(
        "platform_user_sole_owned_orgs",
        { p_user_id: solo.id },
      );
      expect(soleErr).toBeNull();
      expect((sole ?? []).map((o) => o.org_id)).toContain(org.orgId);

      // Reassignment must refuse: there is no surviving owner to receive the work.
      const { error: reassignErr } = await admin.rpc(
        "user_delete_reassign_authorship",
        { p_user_id: solo.id },
      );
      expect(reassignErr).not.toBeNull();
      expect(reassignErr!.message).toMatch(/no surviving active owner/i);

      // And nothing was mutated on the way out.
      const { data: orgRow } = await admin
        .from("organizations")
        .select("created_by")
        .eq("id", org.orgId)
        .single();
      expect(orgRow!.created_by).toBe(solo.id);

      // The raw delete is still blocked by organizations_created_by_fkey.
      const { error: delErr } = await admin.auth.admin.deleteUser(solo.id);
      expect(delErr).not.toBeNull();
      const { data: still } = await admin.auth.admin.getUserById(solo.id);
      expect(still.user?.id).toBe(solo.id);
    });

    it("cannot be called for another user by a non-admin", async () => {
      const other = await createUser("other");
      const { error } = await other.anon.rpc(
        "user_delete_reassign_authorship",
        {
          p_user_id: owner.id,
        },
      );
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not authorized/i);
    });

    it("does not touch another org's rows (cross-tenant isolation)", async () => {
      const outsider = await createUser("outsider");
      const otherOrg = await provisionOrg(outsider, "other");

      const { data: before } = await admin
        .from("organizations")
        .select("created_by, name, slug")
        .eq("id", otherOrg.orgId)
        .single();

      // A victim in OUR org whose deletion must not reach across the tenant line.
      const victim = await createUser("victim");
      await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: victim.id, role: "member" });
      const { error } = await admin.rpc("user_delete_reassign_authorship", {
        p_user_id: victim.id,
      });
      expect(error).toBeNull();

      const { data: after } = await admin
        .from("organizations")
        .select("created_by, name, slug")
        .eq("id", otherOrg.orgId)
        .single();
      expect(after).toEqual(before);
      expect(after!.created_by).toBe(outsider.id);

      // The outsider's own workspace is untouched too.
      const { data: ws } = await admin
        .from("workspaces")
        .select("created_by")
        .eq("id", otherOrg.workspaceId)
        .single();
      expect(ws!.created_by).toBe(outsider.id);
    });

    it("keeps the attribution freeze closed outside the sanctioned path", async () => {
      // The reassignment works by a transaction-local GUC that only
      // user_delete_reassign_authorship sets. Without it, a direct UPDATE must
      // still be silently reverted by items_protect_creation_metadata.
      const { error } = await admin
        .from("items")
        .update({ created_by: botId })
        .eq("id", itemId);
      expect(error).toBeNull(); // the trigger reverts rather than raising

      const { data: item } = await admin
        .from("items")
        .select("created_by")
        .eq("id", itemId)
        .single();
      expect(item!.created_by).toBe(owner.id);
    });
  },
);
