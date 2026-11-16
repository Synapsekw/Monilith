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
const PASSWORD = "Test-Password-123!";

type Client = SupabaseClient<Database>;
type OrgRole = Database["public"]["Enums"]["org_role"];
type TestUser = { id: string; anon: Client; email: string };

// What a guest can read of the organization itself: its people, their
// profiles, its workspaces and its AI settings. Sibling of
// folder-members.rls.integration.test.ts (which covers folders, boards and the
// org-level surfaces). Covers 20261115173759_guest_roster_confinement.sql.
//
// Monos are not exercised here: a Mono needs a bot auth user minted by the
// service-only create_mono path. scripts/sql/dry-run-guest-roster.sql covers
// the `monos` policy against a live Mono.
describe.skipIf(!integrationTargetReady())("RLS: guest roster", () => {
  let admin: Client;
  const createdUserIds: string[] = [];

  // A owns the org and creates folder F (in workspace "Shared") holding board
  // 1. C is a member who is on F. H is a member with no access to anything of
  // G's; H creates board 2 in workspace "Other". G is a guest on F. G2 is a
  // guest who has been given nothing.
  let a: TestUser & { orgId: string };
  let c: TestUser;
  let h: TestUser;
  let g: TestUser;
  let g2: TestUser;
  let wsShared: string;
  let wsOther: string;
  let board2: string;
  let folderId: string;

  async function newUser(label: string): Promise<TestUser> {
    const email = `gr-${label}-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      app_metadata: { pre_approved: true },
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(error, `createUser(${label})`).toBeNull();
    const id = data.user!.id;
    createdUserIds.push(id);
    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(anon, { email, password: PASSWORD });
    return { id, anon, email };
  }

  async function addToOrg(userId: string, role: OrgRole) {
    const { error } = await admin
      .from("org_members")
      .insert({ org_id: a.orgId, user_id: userId, role });
    expect(error, `org_members(${role})`).toBeNull();
  }

  async function newWorkspace(name: string) {
    const { data, error } = await a.anon
      .from("workspaces")
      .insert({ org_id: a.orgId, name, created_by: a.id })
      .select("id")
      .single();
    expect(error, `workspace(${name})`).toBeNull();
    return (data as { id: string }).id;
  }

  async function newBoard(anon: Client, workspaceId: string, label: string) {
    const { data, error } = await anon.rpc("create_board", {
      p_workspace_id: workspaceId,
      p_name: `Board ${label}`,
    });
    expect(error, `create_board(${label})`).toBeNull();
    return (data as { id: string }).id;
  }

  /** The org's member ids this client can read, sorted. */
  async function memberIds(anon: Client): Promise<string[]> {
    const { data, error } = await anon
      .from("org_members")
      .select("user_id")
      .eq("org_id", a.orgId);
    expect(error).toBeNull();
    return (data ?? []).map((r) => r.user_id).sort();
  }

  /** Which of `ids` this client can read a profile for, sorted. */
  async function profileIds(anon: Client, ids: string[]): Promise<string[]> {
    const { data, error } = await anon
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", ids);
    expect(error).toBeNull();
    return (data ?? []).map((r) => r.id).sort();
  }

  /** The org's workspace ids this client can read, sorted. */
  async function workspaceIds(anon: Client): Promise<string[]> {
    const { data, error } = await anon
      .from("workspaces")
      .select("id")
      .eq("org_id", a.orgId);
    expect(error).toBeNull();
    return (data ?? []).map((r) => r.id).sort();
  }

  const sorted = (...ids: string[]) => [...ids].sort();

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const owner = await newUser("a");
    const { data: org, error } = await owner.anon.rpc("create_organization", {
      p_name: "Org guest roster",
      p_slug: `gr-${randomUUID().slice(0, 8)}`,
    });
    expect(error, "create_organization").toBeNull();
    a = { ...owner, orgId: (org as { id: string }).id };
    c = await newUser("c");
    h = await newUser("h");
    g = await newUser("g");
    g2 = await newUser("g2");
    await addToOrg(c.id, "member");
    await addToOrg(h.id, "member");
    await addToOrg(g.id, "guest");
    await addToOrg(g2.id, "guest");

    wsShared = await newWorkspace("Shared");
    wsOther = await newWorkspace("Other");
    const board1 = await newBoard(a.anon, wsShared, "1");
    board2 = await newBoard(h.anon, wsOther, "2");
    const { data: folder, error: folderErr } = await a.anon
      .from("folders")
      .insert({
        org_id: a.orgId,
        workspace_id: wsShared,
        name: `Folder ${randomUUID()}`,
        created_by: a.id,
      })
      .select("id")
      .single();
    expect(folderErr, "folder").toBeNull();
    folderId = (folder as { id: string }).id;
    const { error: placeErr } = await a.anon
      .from("folder_boards")
      .insert({ folder_id: folderId, board_id: board1, position: 0 });
    expect(placeErr, "placement").toBeNull();
    for (const userId of [g.id, c.id]) {
      const { error: shareErr } = await a.anon.rpc("share_folder", {
        p_folder_id: folderId,
        p_user_id: userId,
        p_level: "viewer",
      });
      expect(shareErr, "share_folder").toBeNull();
    }
    const { error: aiErr } = await admin
      .from("org_ai_settings")
      .upsert({ org_id: a.orgId }, { onConflict: "org_id" });
    expect(aiErr, "org_ai_settings").toBeNull();
  }, 240_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 120_000);

  describe("org_members", () => {
    it("shows a full member the whole org (anti-vacuity: the rows exist)", async () => {
      expect(await memberIds(c.anon)).toEqual(
        sorted(a.id, c.id, h.id, g.id, g2.id),
      );
    });

    it("shows a guest themselves, their folder's members and its creator only", async () => {
      expect(await memberIds(g.anon)).toEqual(sorted(a.id, c.id, g.id));
    });

    it("shows a guest who was given nothing only themselves", async () => {
      expect(await memberIds(g2.anon)).toEqual([g2.id]);
    });

    it("does not let a guest reach a hidden member by asking for them", async () => {
      const { data, error } = await g.anon
        .from("org_members")
        .select("user_id, role")
        .eq("user_id", h.id);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("lets an owner see the guests", async () => {
      const { data } = await a.anon
        .from("org_members")
        .select("user_id")
        .eq("org_id", a.orgId)
        .eq("role", "guest");
      expect((data ?? []).map((r) => r.user_id).sort()).toEqual(
        sorted(g.id, g2.id),
      );
    });
  });

  describe("profiles", () => {
    const everyone = () => [a.id, c.id, h.id, g.id, g2.id];

    it("shows a full member every profile in the org", async () => {
      expect(await profileIds(c.anon, everyone())).toEqual(
        sorted(...everyone()),
      );
    });

    it("shows a guest only the profiles of people they share access with", async () => {
      expect(await profileIds(g.anon, everyone())).toEqual(
        sorted(a.id, c.id, g.id),
      );
    });

    it("shows a guest who was given nothing only their own profile", async () => {
      expect(await profileIds(g2.anon, everyone())).toEqual([g2.id]);
    });

    it("does not show a guest a hidden member's email by filtering on it", async () => {
      const { data, error } = await g.anon
        .from("profiles")
        .select("id")
        .eq("email", h.email);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
      // The same filter finds the row for a full member.
      const member = await c.anon
        .from("profiles")
        .select("id")
        .eq("email", h.email);
      expect((member.data ?? []).map((r) => r.id)).toEqual([h.id]);
    });
  });

  describe("workspaces", () => {
    it("shows a full member every workspace", async () => {
      const ids = await workspaceIds(c.anon);
      expect(ids).toContain(wsShared);
      expect(ids).toContain(wsOther);
      // create_organization makes a first workspace too.
      expect(ids.length).toBeGreaterThanOrEqual(3);
    });

    it("shows a guest only the workspace that holds their folder", async () => {
      expect(await workspaceIds(g.anon)).toEqual([wsShared]);
    });

    it("shows a guest who was given nothing no workspace", async () => {
      expect(await workspaceIds(g2.anon)).toEqual([]);
    });
  });

  describe("a direct board grant", () => {
    it("adds the board's creator and its workspace, and takes them away again", async () => {
      const { error } = await admin.from("board_members").insert({
        board_id: board2,
        user_id: g2.id,
        org_id: a.orgId,
        access_level: "viewer",
        granted_by: h.id,
      });
      expect(error, "board grant").toBeNull();
      try {
        expect(await memberIds(g2.anon)).toEqual(sorted(g2.id, h.id));
        expect(await profileIds(g2.anon, [h.id, c.id])).toEqual([h.id]);
        expect(await workspaceIds(g2.anon)).toEqual([wsOther]);
      } finally {
        await admin
          .from("board_members")
          .delete()
          .eq("board_id", board2)
          .eq("user_id", g2.id);
      }
      expect(await memberIds(g2.anon)).toEqual([g2.id]);
      expect(await workspaceIds(g2.anon)).toEqual([]);
    });
  });

  describe("losing folder access", () => {
    it("hides the co-members again once the guest is removed from the folder", async () => {
      const g3 = await newUser("g3");
      await addToOrg(g3.id, "guest");
      const share = await a.anon.rpc("share_folder", {
        p_folder_id: folderId,
        p_user_id: g3.id,
        p_level: "viewer",
      });
      expect(share.error).toBeNull();
      expect(await memberIds(g3.anon)).toEqual(sorted(a.id, c.id, g.id, g3.id));
      const unshare = await a.anon.rpc("unshare_folder", {
        p_folder_id: folderId,
        p_user_id: g3.id,
      });
      expect(unshare.error).toBeNull();
      expect(await memberIds(g3.anon)).toEqual([g3.id]);
      expect(await profileIds(g3.anon, [a.id, c.id, g.id])).toEqual([]);
    });
  });

  describe("org_ai_settings", () => {
    it("is readable by a full member and not by a guest", async () => {
      const member = await c.anon
        .from("org_ai_settings")
        .select("org_id, ai_mode")
        .eq("org_id", a.orgId);
      expect(member.error).toBeNull();
      expect(member.data ?? []).toHaveLength(1);
      const guest = await g.anon
        .from("org_ai_settings")
        .select("org_id, ai_mode")
        .eq("org_id", a.orgId);
      expect(guest.error).toBeNull();
      expect(guest.data ?? []).toHaveLength(0);
    });
  });

  describe("monos", () => {
    it("returns no Mono rows to a guest in an org with no Mono on their boards", async () => {
      const { data, error } = await g.anon
        .from("monos")
        .select("user_id")
        .eq("org_id", a.orgId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });
  });
});
