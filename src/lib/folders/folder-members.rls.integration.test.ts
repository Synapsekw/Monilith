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
type Level = Database["public"]["Enums"]["board_access"];
type TestUser = { id: string; anon: Client; email: string };

const TODAY = new Date().toISOString().slice(0, 10);

// Folder members: one folder_members row grants viewer/editor on every board
// in the folder; guests (org role 'guest') see only what they were given.
// Covers 20261114132219_folder_invites.sql, 20261114135114_guest_confinement.sql
// and 20261115173604_folder_share_guard.sql.
describe.skipIf(!integrationTargetReady())("RLS: folder members", () => {
  let admin: Client;
  const createdUserIds: string[] = [];

  // A owns org A (workspace ws, boards 1 and 2, folder "Project" holding
  // board 1). C and D are plain members of org A, ADM is an org admin, G is a
  // guest. B owns a separate org.
  let a: TestUser & { orgId: string };
  let b: TestUser & { orgId: string };
  let c: TestUser;
  let d: TestUser;
  let adm: TestUser;
  let g: TestUser;
  let ws: string;
  let board1: string;
  let board2: string;
  let folderId: string;

  async function newUser(label: string): Promise<TestUser> {
    const email = `fm-${label}-${randomUUID()}@example.com`;
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

  async function newOwner(label: string) {
    const u = await newUser(label);
    const { data: org, error } = await u.anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: `fm-${label}-${randomUUID().slice(0, 8)}`,
    });
    expect(error, `create_organization(${label})`).toBeNull();
    return { ...u, orgId: (org as { id: string }).id };
  }

  async function addToOrg(orgId: string, userId: string, role: OrgRole) {
    const { error } = await admin
      .from("org_members")
      .insert({ org_id: orgId, user_id: userId, role });
    expect(error, `org_members(${role})`).toBeNull();
  }

  async function newWorkspace(u: TestUser & { orgId: string }, name: string) {
    const { data, error } = await u.anon
      .from("workspaces")
      .insert({ org_id: u.orgId, name, created_by: u.id })
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

  async function newFolder(
    anon: Client,
    orgId: string,
    workspaceId: string,
    userId: string,
    name = `Folder ${randomUUID()}`,
  ) {
    const { data, error } = await anon
      .from("folders")
      .insert({
        org_id: orgId,
        workspace_id: workspaceId,
        name,
        created_by: userId,
      })
      .select("id")
      .single();
    expect(error, `folder(${name})`).toBeNull();
    return (data as { id: string }).id;
  }

  // A folder in org A's workspace holding one fresh board, both made by A.
  async function freshFolderWithBoard(label: string) {
    const folder = await newFolder(a.anon, a.orgId, ws, a.id);
    const board = await newBoard(a.anon, ws, label);
    const { error } = await a.anon
      .from("folder_boards")
      .insert({ folder_id: folder, board_id: board, position: 0 });
    expect(error, `placement(${label})`).toBeNull();
    return { folderId: folder, boardId: board };
  }

  async function share(
    folder: string,
    userId: string,
    level: Level,
    by: Client = a.anon,
  ) {
    const { error } = await by.rpc("share_folder", {
      p_folder_id: folder,
      p_user_id: userId,
      p_level: level,
    });
    expect(error, `share_folder(${level})`).toBeNull();
  }

  async function grantBoard(boardId: string, userId: string, level: Level) {
    const { error } = await admin.from("board_members").insert({
      board_id: boardId,
      user_id: userId,
      org_id: a.orgId,
      access_level: level,
      granted_by: a.id,
    });
    expect(error, `board_members(${level})`).toBeNull();
  }

  async function canRead(anon: Client, boardId: string) {
    const { data } = await anon.from("boards").select("id").eq("id", boardId);
    return (data ?? []).length === 1;
  }

  async function canEdit(anon: Client, boardId: string) {
    const { data, error } = await anon.rpc("can_edit_board", {
      p_board_id: boardId,
    });
    expect(error).toBeNull();
    return data === true;
  }

  async function folderMemberRows(folder: string, userId: string) {
    const { data, error } = await admin
      .from("folder_members")
      .select("access_level")
      .eq("folder_id", folder)
      .eq("user_id", userId);
    expect(error).toBeNull();
    return data ?? [];
  }

  async function orgInvitationFor(orgId: string, email: string) {
    const { data, error } = await admin
      .from("org_invitations")
      .select("id, role, status")
      .eq("org_id", orgId)
      .eq("email", email);
    expect(error).toBeNull();
    return data ?? [];
  }

  async function folderInvitationFor(folder: string, email: string) {
    const { data, error } = await admin
      .from("folder_invitations")
      .select("id, status, org_invitation_id, access_level")
      .eq("folder_id", folder)
      .eq("email", email);
    expect(error).toBeNull();
    return data ?? [];
  }

  // Board content written with the service role: a group, a text column and
  // two items; the first item carries a cell value, an update, an attachment
  // and an activity row.
  async function seedContent(boardId: string, label: string) {
    const { data: group, error: groupErr } = await admin
      .from("groups")
      .insert({ org_id: a.orgId, board_id: boardId, name: `G ${label}` })
      .select("id")
      .single();
    expect(groupErr, `group(${label})`).toBeNull();
    const groupId = (group as { id: string }).id;

    const { data: column, error: colErr } = await admin
      .from("columns")
      .insert({
        org_id: a.orgId,
        board_id: boardId,
        kind: "text",
        name: `Notes ${label}`,
      })
      .select("id")
      .single();
    expect(colErr, `column(${label})`).toBeNull();
    const columnId = (column as { id: string }).id;

    const itemIds: string[] = [];
    for (const n of [1, 2]) {
      const { data: item, error: itemErr } = await admin
        .from("items")
        .insert({
          org_id: a.orgId,
          board_id: boardId,
          group_id: groupId,
          name: `Item ${n} ${label}`,
          created_by: a.id,
        })
        .select("id")
        .single();
      expect(itemErr, `item(${label})`).toBeNull();
      itemIds.push((item as { id: string }).id);
    }
    const itemId = itemIds[0];

    const { error: cellErr } = await admin.from("cell_values").insert({
      org_id: a.orgId,
      board_id: boardId,
      item_id: itemId,
      column_id: columnId,
      value: `seed ${label}`,
    });
    expect(cellErr, `cell_value(${label})`).toBeNull();
    const { error: updErr } = await admin.from("item_updates").insert({
      org_id: a.orgId,
      board_id: boardId,
      item_id: itemId,
      author_id: a.id,
      body: {},
      body_text: `update ${label}`,
    });
    expect(updErr, `item_update(${label})`).toBeNull();
    const { error: attErr } = await admin.from("attachments").insert({
      org_id: a.orgId,
      board_id: boardId,
      item_id: itemId,
      file_name: `file-${label}.txt`,
      mime_type: "text/plain",
      size_bytes: 10,
      storage_path: `${a.orgId}/${boardId}/${randomUUID()}.txt`,
      uploaded_by: a.id,
    });
    expect(attErr, `attachment(${label})`).toBeNull();
    const { error: actErr } = await admin.from("item_activities").insert({
      org_id: a.orgId,
      board_id: boardId,
      item_id: itemId,
      actor_id: a.id,
      action: "item_created",
    });
    expect(actErr, `item_activity(${label})`).toBeNull();
    return { groupId, columnId, itemId, itemIds };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    a = await newOwner("a");
    b = await newOwner("b");
    c = await newUser("c");
    d = await newUser("d");
    adm = await newUser("adm");
    g = await newUser("g");
    await addToOrg(a.orgId, c.id, "member");
    await addToOrg(a.orgId, d.id, "member");
    await addToOrg(a.orgId, adm.id, "admin");
    await addToOrg(a.orgId, g.id, "guest");

    ws = await newWorkspace(a, "WS");
    board1 = await newBoard(a.anon, ws, "1");
    board2 = await newBoard(a.anon, ws, "2");
    folderId = await newFolder(a.anon, a.orgId, ws, a.id, "Project");
    const { error: placeErr } = await a.anon
      .from("folder_boards")
      .insert({ folder_id: folderId, board_id: board1, position: 0 });
    expect(placeErr, "placement").toBeNull();
  }, 240_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 120_000);

  // ───────────────────────────────────────────── folder access for members
  describe("folder grants", () => {
    it("gives a plain member nothing before they are added", async () => {
      expect(await canRead(c.anon, board1)).toBe(false);
    });

    it("lets the folder's creator add a viewer; they read but cannot write", async () => {
      await share(folderId, c.id, "viewer");
      expect(await folderMemberRows(folderId, c.id)).toEqual([
        { access_level: "viewer" },
      ]);
      expect(await canRead(c.anon, board1)).toBe(true);
      const { error: itemsErr } = await c.anon
        .from("items")
        .select("id")
        .eq("board_id", board1);
      expect(itemsErr).toBeNull();
      expect(await canEdit(c.anon, board1)).toBe(false);
      const { data: renamed } = await c.anon
        .from("boards")
        .update({ name: "Hijacked" })
        .eq("id", board1)
        .select("id");
      expect(renamed ?? []).toHaveLength(0);
    });

    it("makes a board added to the folder readable with no further grant", async () => {
      expect(await canRead(c.anon, board2)).toBe(false);
      const { error } = await a.anon
        .from("folder_boards")
        .insert({ folder_id: folderId, board_id: board2, position: 1 });
      expect(error).toBeNull();
      expect(await canRead(c.anon, board2)).toBe(true);
    });

    it("lets an editor write", async () => {
      await share(folderId, c.id, "editor");
      expect(await folderMemberRows(folderId, c.id)).toEqual([
        { access_level: "editor" },
      ]);
      const { data } = await c.anon
        .from("boards")
        .update({ name: "Board 1 edited" })
        .eq("id", board1)
        .select("id");
      expect(data ?? []).toHaveLength(1);
      expect(await canEdit(c.anon, board1)).toBe(true);
    });

    it("lets a member reorder a placement inside the folder", async () => {
      const { data, error } = await c.anon
        .from("folder_boards")
        .update({ position: 7 })
        .eq("folder_id", folderId)
        .eq("board_id", board1)
        .select("position");
      expect(error).toBeNull();
      expect(data).toEqual([{ position: 7 }]);
    });

    it("refuses a non-manager who tries to share or to read invitations", async () => {
      const email = `fm-pending-${randomUUID()}@example.com`;
      const { error: inviteErr } = await a.anon.rpc("invite_to_folder", {
        p_folder_id: folderId,
        p_email: email,
        p_level: "viewer",
      });
      expect(inviteErr).toBeNull();
      // The invitation exists and the manager sees it, so the empty result
      // for C below is RLS and not an empty table.
      const mine = await a.anon
        .from("folder_invitations")
        .select("id")
        .eq("folder_id", folderId)
        .eq("email", email);
      expect(mine.data).toHaveLength(1);

      const { error } = await c.anon.rpc("share_folder", {
        p_folder_id: folderId,
        p_user_id: g.id,
        p_level: "viewer",
      });
      expect(error?.code).toBe("42501");
      const { data } = await c.anon
        .from("folder_invitations")
        .select("id")
        .eq("folder_id", folderId);
      expect(data ?? []).toHaveLength(0);
      const states = await c.anon.rpc("folder_invitation_states", {
        p_folder_id: folderId,
      });
      expect(states.error).toBeNull();
      expect(states.data ?? []).toHaveLength(0);
      const managerStates = await a.anon.rpc("folder_invitation_states", {
        p_folder_id: folderId,
      });
      expect((managerStates.data ?? []).map((r) => r.email)).toContain(email);
    });

    it("refuses a client that writes folder_members directly", async () => {
      const { error } = await c.anon.from("folder_members").insert({
        folder_id: folderId,
        org_id: a.orgId,
        user_id: d.id,
        access_level: "editor",
      });
      expect(error).not.toBeNull();
      expect(await folderMemberRows(folderId, d.id)).toHaveLength(0);
    });

    it("refuses a non-owner of the board who tries to take it out of the shared folder", async () => {
      expect(await canRead(c.anon, board2)).toBe(true);
      const { error } = await c.anon
        .from("folder_boards")
        .delete()
        .eq("board_id", board2);
      // RLS lets the row through (C can read the board); the trigger refuses.
      expect(error?.code).toBe("42501");
      const { data } = await admin
        .from("folder_boards")
        .select("board_id")
        .eq("board_id", board2);
      expect(data).toHaveLength(1);
      expect(await canRead(c.anon, board2)).toBe(true);
    });

    it("stops access when the board is moved out by its owner", async () => {
      const { error } = await a.anon
        .from("folder_boards")
        .delete()
        .eq("board_id", board2);
      expect(error).toBeNull();
      expect(await canRead(c.anon, board2)).toBe(false);
    });

    it("gives a user in another org nothing, and they cannot add themselves", async () => {
      expect(await canRead(b.anon, board1)).toBe(false);
      const { error } = await b.anon.rpc("share_folder", {
        p_folder_id: folderId,
        p_user_id: b.id,
        p_level: "editor",
      });
      expect(error?.code).toBe("42501");
      const { error: insErr } = await b.anon.from("folder_members").insert({
        folder_id: folderId,
        org_id: a.orgId,
        user_id: b.id,
        access_level: "editor",
      });
      expect(insErr).not.toBeNull();
      expect(await folderMemberRows(folderId, b.id)).toHaveLength(0);
    });

    it("refuses to share with someone who is not a member of the org", async () => {
      const { error } = await a.anon.rpc("share_folder", {
        p_folder_id: folderId,
        p_user_id: b.id,
        p_level: "viewer",
      });
      expect(error?.code).toBe("42501");
      expect(await folderMemberRows(folderId, b.id)).toHaveLength(0);
    });

    it("shares directly, returning the member's id, when the invited email is already an org member", async () => {
      const { folderId: f, boardId } = await freshFolderWithBoard("direct");
      expect(await canRead(d.anon, boardId)).toBe(false);
      const { data, error } = await a.anon.rpc("invite_to_folder", {
        p_folder_id: f,
        p_email: d.email.toUpperCase(),
        p_level: "viewer",
      });
      expect(error).toBeNull();
      expect(data).toBe(d.id);
      expect(await folderMemberRows(f, d.id)).toEqual([
        { access_level: "viewer" },
      ]);
      expect(await canRead(d.anon, boardId)).toBe(true);
    });

    it("lets an org admin who did not create the folder manage it", async () => {
      const { folderId: f, boardId } = await freshFolderWithBoard("adm-mgr");
      await share(f, d.id, "viewer", adm.anon);
      expect(await canRead(d.anon, boardId)).toBe(true);
    });

    it("removes access when a member is removed from the folder", async () => {
      const { error } = await a.anon.rpc("unshare_folder", {
        p_folder_id: folderId,
        p_user_id: c.id,
      });
      expect(error).toBeNull();
      expect(await folderMemberRows(folderId, c.id)).toHaveLength(0);
      expect(await canRead(c.anon, board1)).toBe(false);
    });

    it("refuses unshare from a non-manager and lets a member leave by themself", async () => {
      const { folderId: f, boardId } = await freshFolderWithBoard("leave");
      await share(f, c.id, "viewer");
      await share(f, d.id, "viewer");

      // D cannot remove C: RLS only lets a member delete their own row, and
      // the unshare RPC is for managers.
      const { error: unshareErr } = await d.anon.rpc("unshare_folder", {
        p_folder_id: f,
        p_user_id: c.id,
      });
      expect(unshareErr?.code).toBe("42501");
      await d.anon
        .from("folder_members")
        .delete()
        .eq("folder_id", f)
        .eq("user_id", c.id);
      expect(await folderMemberRows(f, c.id)).toHaveLength(1);

      const { error: leaveErr } = await d.anon
        .from("folder_members")
        .delete()
        .eq("folder_id", f)
        .eq("user_id", d.id);
      expect(leaveErr).toBeNull();
      expect(await folderMemberRows(f, d.id)).toHaveLength(0);
      expect(await canRead(d.anon, boardId)).toBe(false);
      expect(await canRead(c.anon, boardId)).toBe(true);
    });

    it("lets the higher of a direct board grant and a folder grant win", async () => {
      const { folderId: f, boardId } = await freshFolderWithBoard("higher");
      await grantBoard(boardId, d.id, "viewer");
      expect(await canEdit(d.anon, boardId)).toBe(false);

      // direct viewer + folder editor -> editor
      await share(f, d.id, "editor");
      expect(await canEdit(d.anon, boardId)).toBe(true);

      // direct editor + folder viewer -> still editor
      await share(f, d.id, "viewer");
      const { error: upErr } = await admin
        .from("board_members")
        .update({ access_level: "editor" })
        .eq("board_id", boardId)
        .eq("user_id", d.id);
      expect(upErr).toBeNull();
      expect(await canEdit(d.anon, boardId)).toBe(true);

      // direct viewer + folder viewer -> viewer
      const { error: downErr } = await admin
        .from("board_members")
        .update({ access_level: "viewer" })
        .eq("board_id", boardId)
        .eq("user_id", d.id);
      expect(downErr).toBeNull();
      expect(await canRead(d.anon, boardId)).toBe(true);
      expect(await canEdit(d.anon, boardId)).toBe(false);
    });

    it("grants nothing to a deactivated org member whose folder row is still there", async () => {
      const e = await newUser("deact");
      await addToOrg(a.orgId, e.id, "member");
      const { folderId: f, boardId } = await freshFolderWithBoard("deact");
      await share(f, e.id, "editor");
      expect(await canRead(e.anon, boardId)).toBe(true);
      const { error } = await admin
        .from("org_members")
        .update({ deactivated_at: new Date().toISOString() })
        .eq("org_id", a.orgId)
        .eq("user_id", e.id);
      expect(error).toBeNull();
      expect(await canRead(e.anon, boardId)).toBe(false);
      expect(await folderMemberRows(f, e.id)).toHaveLength(1);
    });
  });

  // ───────────────────── board content reached through a folder grant
  describe("board content through a folder grant", () => {
    let viewer: TestUser;
    let folder: string;
    let inA: string;
    let inB: string;
    let outside: string;
    const content: Record<string, Awaited<ReturnType<typeof seedContent>>> = {};

    const sorted = (ids: (string | null)[]) => ids.slice().sort();

    // Everything the service role sees on the given boards, by table.
    async function adminView(boardIds: string[]) {
      const [items, cells, updates, attachments, activities] =
        await Promise.all([
          admin.from("items").select("id").in("board_id", boardIds),
          admin.from("cell_values").select("item_id").in("board_id", boardIds),
          admin.from("item_updates").select("id").in("board_id", boardIds),
          admin.from("attachments").select("id").in("board_id", boardIds),
          admin.from("item_activities").select("id").in("board_id", boardIds),
        ]);
      return {
        items: sorted((items.data ?? []).map((r) => r.id)),
        cells: sorted((cells.data ?? []).map((r) => r.item_id)),
        updates: sorted((updates.data ?? []).map((r) => r.id)),
        attachments: sorted((attachments.data ?? []).map((r) => r.id)),
        activities: sorted((activities.data ?? []).map((r) => r.id)),
      };
    }

    // The same, as a user.
    async function userView(anon: Client, boardIds: string[]) {
      const [items, cells, updates, attachments, activities] =
        await Promise.all([
          anon.from("items").select("id").in("board_id", boardIds),
          anon.from("cell_values").select("item_id").in("board_id", boardIds),
          anon.from("item_updates").select("id").in("board_id", boardIds),
          anon.from("attachments").select("id").in("board_id", boardIds),
          anon.from("item_activities").select("id").in("board_id", boardIds),
        ]);
      for (const r of [items, cells, updates, attachments, activities]) {
        expect(r.error).toBeNull();
      }
      return {
        items: sorted((items.data ?? []).map((r) => r.id)),
        cells: sorted((cells.data ?? []).map((r) => r.item_id)),
        updates: sorted((updates.data ?? []).map((r) => r.id)),
        attachments: sorted((attachments.data ?? []).map((r) => r.id)),
        activities: sorted((activities.data ?? []).map((r) => r.id)),
      };
    }

    beforeAll(async () => {
      viewer = await newUser("viewer");
      await addToOrg(a.orgId, viewer.id, "member");
      folder = await newFolder(a.anon, a.orgId, ws, a.id);
      inA = await newBoard(a.anon, ws, "content-a");
      inB = await newBoard(a.anon, ws, "content-b");
      outside = await newBoard(a.anon, ws, "content-out");
      for (const board of [inA, inB]) {
        const { error } = await a.anon
          .from("folder_boards")
          .insert({ folder_id: folder, board_id: board, position: 0 });
        expect(error, "placement").toBeNull();
      }
      for (const board of [inA, inB, outside]) {
        content[board] = await seedContent(board, board.slice(0, 6));
      }
      await share(folder, viewer.id, "viewer");
    }, 120_000);

    it("shows a folder viewer every row on every folder board, and none outside it", async () => {
      // Fixtures first, as the service role: every table has rows on all three
      // boards, so equality below is not an empty-equals-empty pass.
      for (const board of [inA, inB, outside]) {
        const seen = await adminView([board]);
        expect(seen.items.length).toBeGreaterThanOrEqual(2);
        expect(seen.cells.length).toBeGreaterThanOrEqual(1);
        expect(seen.updates.length).toBeGreaterThanOrEqual(1);
        expect(seen.attachments.length).toBeGreaterThanOrEqual(1);
        expect(seen.activities.length).toBeGreaterThanOrEqual(1);
      }
      const expected = await adminView([inA, inB]);
      expect(await userView(viewer.anon, [inA, inB])).toEqual(expected);

      const none = await userView(viewer.anon, [outside]);
      expect(none).toEqual({
        items: [],
        cells: [],
        updates: [],
        attachments: [],
        activities: [],
      });
    });

    it("refuses a folder viewer's writes and leaves the rows unchanged", async () => {
      const first = content[inA];
      const { error: insertErr } = await viewer.anon.from("items").insert({
        org_id: a.orgId,
        board_id: inA,
        group_id: first.groupId,
        name: "Viewer item",
        created_by: viewer.id,
      });
      expect(insertErr).not.toBeNull();
      const { data: created } = await admin
        .from("items")
        .select("id")
        .eq("board_id", inA)
        .eq("name", "Viewer item");
      expect(created ?? []).toHaveLength(0);

      const { data: renamed } = await viewer.anon
        .from("items")
        .update({ name: "Viewer rename" })
        .eq("id", first.itemId)
        .select("id");
      expect(renamed ?? []).toHaveLength(0);
      const { data: item } = await admin
        .from("items")
        .select("name")
        .eq("id", first.itemId)
        .single();
      expect(item?.name).not.toBe("Viewer rename");

      const { data: cellWrite } = await viewer.anon
        .from("cell_values")
        .update({ value: "viewer value" })
        .eq("item_id", first.itemId)
        .eq("column_id", first.columnId)
        .select("item_id");
      expect(cellWrite ?? []).toHaveLength(0);
      const { data: cell } = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", first.itemId)
        .eq("column_id", first.columnId)
        .single();
      expect(cell?.value).not.toBe("viewer value");

      const { error: cellInsertErr } = await viewer.anon
        .from("cell_values")
        .insert({
          org_id: a.orgId,
          board_id: inA,
          item_id: content[inA].itemIds[1],
          column_id: first.columnId,
          value: "viewer value",
        });
      expect(cellInsertErr).not.toBeNull();
    });

    it("lets a folder editor write", async () => {
      await share(folder, viewer.id, "editor");
      const first = content[inB];
      const { data: renamed, error } = await viewer.anon
        .from("items")
        .update({ name: "Editor rename" })
        .eq("id", first.itemId)
        .select("id");
      expect(error).toBeNull();
      expect(renamed ?? []).toHaveLength(1);
      const { data: item } = await admin
        .from("items")
        .select("name")
        .eq("id", first.itemId)
        .single();
      expect(item?.name).toBe("Editor rename");

      const { data: cellWrite, error: cellErr } = await viewer.anon
        .from("cell_values")
        .update({ value: "editor value" })
        .eq("item_id", first.itemId)
        .eq("column_id", first.columnId)
        .select("item_id");
      expect(cellErr).toBeNull();
      expect(cellWrite ?? []).toHaveLength(1);
      const { data: cell } = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", first.itemId)
        .eq("column_id", first.columnId)
        .single();
      expect(cell?.value).toBe("editor value");

      const { error: insertErr } = await viewer.anon.from("items").insert({
        org_id: a.orgId,
        board_id: inB,
        group_id: first.groupId,
        name: "Editor item",
        created_by: viewer.id,
      });
      expect(insertErr).toBeNull();
      // Still nothing outside the folder.
      const { data: outsideWrite } = await viewer.anon
        .from("items")
        .update({ name: "Editor outside" })
        .eq("id", content[outside].itemId)
        .select("id");
      expect(outsideWrite ?? []).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────── review-driven integrity rules
  describe("folder integrity rules", () => {
    it("refuses a client that changes folders.created_by", async () => {
      const { error: byMember } = await c.anon
        .from("folders")
        .update({ created_by: c.id })
        .eq("id", folderId);
      // The update policy lets a non-guest member through; the trigger refuses.
      expect(byMember?.code).toBe("42501");
      expect(byMember?.message).toMatch(
        /creator of a folder cannot be changed/i,
      );
      const { error: byCreator } = await a.anon
        .from("folders")
        .update({ created_by: d.id })
        .eq("id", folderId);
      expect(byCreator?.code).toBe("42501");
      expect(byCreator?.message).toMatch(
        /creator of a folder cannot be changed/i,
      );
      const { data } = await admin
        .from("folders")
        .select("created_by")
        .eq("id", folderId)
        .single();
      expect(data?.created_by).toBe(a.id);
    });

    it("refuses to re-point a placement at another board", async () => {
      const spare = await newBoard(a.anon, ws, "spare");
      const { error } = await a.anon
        .from("folder_boards")
        .update({ board_id: spare })
        .eq("folder_id", folderId)
        .eq("board_id", board1);
      // The trigger runs before the update policy's check, so its message shows.
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/cannot be re-pointed/i);
      const { data } = await admin
        .from("folder_boards")
        .select("board_id")
        .eq("folder_id", folderId);
      expect((data ?? []).map((r) => r.board_id)).toEqual([board1]);
    });

    describe("moving boards into and out of a folder that has members", () => {
      let shared: string;

      beforeAll(async () => {
        shared = await newFolder(a.anon, a.orgId, ws, a.id);
        await share(shared, d.id, "viewer");
      }, 60_000);

      it("refuses a member who is neither the board's creator nor an admin", async () => {
        const board = await newBoard(a.anon, ws, "into-shared");
        await grantBoard(board, c.id, "editor");
        expect(await canRead(c.anon, board)).toBe(true);
        const { error } = await c.anon
          .from("folder_boards")
          .insert({ folder_id: shared, board_id: board, position: 0 });
        expect(error?.code).toBe("42501");
        expect(error?.message).toMatch(/only the board owner or an admin/i);
        const { data } = await admin
          .from("folder_boards")
          .select("board_id")
          .eq("board_id", board);
        expect(data ?? []).toHaveLength(0);
      });

      it("lets the board's creator move it in and out", async () => {
        const board = await newBoard(d.anon, ws, "by-creator");
        const { error: inErr } = await d.anon
          .from("folder_boards")
          .insert({ folder_id: shared, board_id: board, position: 0 });
        expect(inErr).toBeNull();
        const placed = await admin
          .from("folder_boards")
          .select("board_id")
          .eq("board_id", board);
        expect(placed.data).toHaveLength(1);
        const { error: outErr } = await d.anon
          .from("folder_boards")
          .delete()
          .eq("board_id", board);
        expect(outErr).toBeNull();
        const gone = await admin
          .from("folder_boards")
          .select("board_id")
          .eq("board_id", board);
        expect(gone.data ?? []).toHaveLength(0);
      });

      it("lets an org admin who did not create the board move it in and out", async () => {
        const board = await newBoard(d.anon, ws, "by-admin");
        await grantBoard(board, adm.id, "editor");
        const { error: inErr } = await adm.anon
          .from("folder_boards")
          .insert({ folder_id: shared, board_id: board, position: 0 });
        expect(inErr).toBeNull();
        const { error: outErr } = await adm.anon
          .from("folder_boards")
          .delete()
          .eq("board_id", board);
        expect(outErr).toBeNull();
        const gone = await admin
          .from("folder_boards")
          .select("board_id")
          .eq("board_id", board);
        expect(gone.data ?? []).toHaveLength(0);
      });
    });

    describe("deleting a folder that has members", () => {
      it("is limited to its creator and org owners and admins", async () => {
        const f = await newFolder(c.anon, a.orgId, ws, c.id);
        await share(f, d.id, "viewer", c.anon);

        // D is a plain member and not the creator: RLS filters the row out.
        await d.anon.from("folders").delete().eq("id", f);
        const stillThere = await admin.from("folders").select("id").eq("id", f);
        expect(stillThere.data).toHaveLength(1);

        const { error } = await c.anon.from("folders").delete().eq("id", f);
        expect(error).toBeNull();
        const gone = await admin.from("folders").select("id").eq("id", f);
        expect(gone.data ?? []).toHaveLength(0);
      });

      it("lets an org admin and an org owner delete a folder they did not create", async () => {
        const f1 = await newFolder(c.anon, a.orgId, ws, c.id);
        await share(f1, d.id, "viewer", c.anon);
        await adm.anon.from("folders").delete().eq("id", f1);
        const gone1 = await admin.from("folders").select("id").eq("id", f1);
        expect(gone1.data ?? []).toHaveLength(0);

        const f2 = await newFolder(c.anon, a.orgId, ws, c.id);
        await share(f2, d.id, "viewer", c.anon);
        await a.anon.from("folders").delete().eq("id", f2);
        const gone2 = await admin.from("folders").select("id").eq("id", f2);
        expect(gone2.data ?? []).toHaveLength(0);
      });

      it("still lets any member delete a folder that has no members", async () => {
        const f = await newFolder(c.anon, a.orgId, ws, c.id);
        expect(await folderMemberRows(f, d.id)).toHaveLength(0);
        await d.anon.from("folders").delete().eq("id", f);
        const gone = await admin.from("folders").select("id").eq("id", f);
        expect(gone.data ?? []).toHaveLength(0);
      });
    });
  });

  // ─────────────────────────────────────────────────────── the share guard
  // 20261115173604_folder_share_guard.sql: a folder grant reaches every board
  // in the folder, so making or raising one needs, for EVERY board in it, the
  // board's creator or an org owner/admin. C is a plain member throughout.
  describe("sharing a folder that holds someone else's boards", () => {
    const BLOCKED = /cannot share this folder: 1 of its boards/i;

    async function place(by: Client, folder: string, board: string) {
      return by
        .from("folder_boards")
        .insert({ folder_id: folder, board_id: board, position: 0 });
    }

    async function placedIn(board: string) {
      const { data, error } = await admin
        .from("folder_boards")
        .select("folder_id")
        .eq("board_id", board);
      expect(error).toBeNull();
      return (data ?? []).map((r) => r.folder_id);
    }

    it("refuses the escalation: view a board, file it in your own folder, share the folder with yourself as editor", async () => {
      const board = await newBoard(a.anon, ws, "esc");
      await grantBoard(board, c.id, "viewer");
      expect(await canRead(c.anon, board)).toBe(true);
      expect(await canEdit(c.anon, board)).toBe(false);

      const folder = await newFolder(c.anon, a.orgId, ws, c.id);
      // Filing a board you can only read into an unshared folder is allowed.
      const { error: placeErr } = await place(c.anon, folder, board);
      expect(placeErr).toBeNull();
      expect(await placedIn(board)).toEqual([folder]);

      const self = await c.anon.rpc("share_folder", {
        p_folder_id: folder,
        p_user_id: c.id,
        p_level: "editor",
      });
      expect(self.error?.code).toBe("42501");
      expect(self.error?.message).toMatch(BLOCKED);

      const other = await c.anon.rpc("share_folder", {
        p_folder_id: folder,
        p_user_id: d.id,
        p_level: "viewer",
      });
      expect(other.error?.code).toBe("42501");
      expect(other.error?.message).toMatch(BLOCKED);

      // The direct-share branch of invite_to_folder (an org member's email).
      const viaEmail = await c.anon.rpc("invite_to_folder", {
        p_folder_id: folder,
        p_email: d.email,
        p_level: "editor",
      });
      expect(viaEmail.error?.code).toBe("42501");
      expect(viaEmail.error?.message).toMatch(BLOCKED);

      // The recorded-invitation branch (an outside address).
      const email = `fm-esc-${randomUUID()}@example.com`;
      const outside = await c.anon.rpc("invite_to_folder", {
        p_folder_id: folder,
        p_email: email,
        p_level: "editor",
      });
      expect(outside.error?.code).toBe("42501");
      expect(outside.error?.message).toMatch(BLOCKED);

      expect(await folderMemberRows(folder, c.id)).toHaveLength(0);
      expect(await folderMemberRows(folder, d.id)).toHaveLength(0);
      expect(await folderInvitationFor(folder, email)).toHaveLength(0);
      expect(await orgInvitationFor(a.orgId, email)).toHaveLength(0);
      expect(await canEdit(c.anon, board)).toBe(false);
      expect(await canRead(d.anon, board)).toBe(false);
    });

    describe("a folder whose creator did not create the board in it", () => {
      let folder: string;
      let board: string;

      beforeAll(async () => {
        folder = await newFolder(c.anon, a.orgId, ws, c.id);
        board = await newBoard(a.anon, ws, "not-mine");
        // Filed by its creator; C cannot even open it.
        const { error } = await place(a.anon, folder, board);
        expect(error, "placement").toBeNull();
      }, 60_000);

      it("refuses the folder's creator", async () => {
        expect(await canRead(c.anon, board)).toBe(false);
        const { data: manages } = await c.anon.rpc("can_manage_folder", {
          p_folder_id: folder,
        });
        expect(manages).toBe(true);
        const { error } = await c.anon.rpc("share_folder", {
          p_folder_id: folder,
          p_user_id: d.id,
          p_level: "viewer",
        });
        expect(error?.code).toBe("42501");
        expect(error?.message).toMatch(BLOCKED);
        expect(await folderMemberRows(folder, d.id)).toHaveLength(0);
        expect(await canRead(d.anon, board)).toBe(false);
      });

      it("lets an org admin share it", async () => {
        await share(folder, d.id, "viewer", adm.anon);
        expect(await folderMemberRows(folder, d.id)).toEqual([
          { access_level: "viewer" },
        ]);
        expect(await canRead(d.anon, board)).toBe(true);
        expect(await canEdit(d.anon, board)).toBe(false);
      });

      it("refuses the folder's creator who raises a level, and keeps the level", async () => {
        const { error } = await c.anon.rpc("share_folder", {
          p_folder_id: folder,
          p_user_id: d.id,
          p_level: "editor",
        });
        expect(error?.code).toBe("42501");
        expect(error?.message).toMatch(BLOCKED);
        expect(await folderMemberRows(folder, d.id)).toEqual([
          { access_level: "viewer" },
        ]);
        expect(await canEdit(d.anon, board)).toBe(false);
      });

      it("lets the folder's creator lower a level and remove a member", async () => {
        await share(folder, d.id, "editor", adm.anon);
        expect(await canEdit(d.anon, board)).toBe(true);

        await share(folder, d.id, "viewer", c.anon);
        expect(await folderMemberRows(folder, d.id)).toEqual([
          { access_level: "viewer" },
        ]);
        expect(await canEdit(d.anon, board)).toBe(false);

        const { error } = await c.anon.rpc("unshare_folder", {
          p_folder_id: folder,
          p_user_id: d.id,
        });
        expect(error).toBeNull();
        expect(await folderMemberRows(folder, d.id)).toHaveLength(0);
        expect(await canRead(d.anon, board)).toBe(false);
      });
    });

    it("lets a plain member who created every board in their folder share and invite", async () => {
      const folder = await newFolder(c.anon, a.orgId, ws, c.id);
      const board = await newBoard(c.anon, ws, "all-mine");
      const { error: placeErr } = await place(c.anon, folder, board);
      expect(placeErr).toBeNull();

      await share(folder, d.id, "editor", c.anon);
      expect(await canEdit(d.anon, board)).toBe(true);

      const email = `fm-mine-${randomUUID()}@example.com`;
      const { data, error } = await c.anon.rpc("invite_to_folder", {
        p_folder_id: folder,
        p_email: email,
        p_level: "viewer",
      });
      expect(error).toBeNull();
      expect(data).toBeNull();
      expect(
        (await folderInvitationFor(folder, email)).map((r) => r.status),
      ).toEqual(["pending"]);
    });

    it("guards board moves for a folder that has a pending invitation and no members", async () => {
      const folder = await newFolder(c.anon, a.orgId, ws, c.id);
      const email = `fm-pendmove-${randomUUID()}@example.com`;
      // An empty folder holds nobody else's board, so its creator may invite.
      const { error: inviteErr } = await c.anon.rpc("invite_to_folder", {
        p_folder_id: folder,
        p_email: email,
        p_level: "viewer",
      });
      expect(inviteErr).toBeNull();
      const { data: members } = await admin
        .from("folder_members")
        .select("user_id")
        .eq("folder_id", folder);
      expect(members ?? []).toHaveLength(0);

      const board = await newBoard(a.anon, ws, "pend-move");
      await grantBoard(board, c.id, "viewer");
      expect(await canRead(c.anon, board)).toBe(true);
      const { error } = await place(c.anon, folder, board);
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/only the board owner or an admin/i);
      expect(await placedIn(board)).toEqual([]);

      // The board's creator may file it there, knowing who is invited.
      const { error: byCreator } = await place(a.anon, folder, board);
      expect(byCreator).toBeNull();
      expect(await placedIn(board)).toEqual([folder]);

      // With that board in the folder its creator can no longer raise the
      // pending invitation, only lower or revoke it.
      const raise = await c.anon.rpc("invite_to_folder", {
        p_folder_id: folder,
        p_email: email,
        p_level: "editor",
      });
      expect(raise.error?.code).toBe("42501");
      expect(raise.error?.message).toMatch(BLOCKED);
      expect(
        (await folderInvitationFor(folder, email)).map((r) => r.access_level),
      ).toEqual(["viewer"]);
    });

    it("does not let a client choose when a board entered a folder", async () => {
      const folder = await newFolder(c.anon, a.orgId, ws, c.id);
      const board = await newBoard(c.anon, ws, "stamp");
      const before = Date.now();
      const { error } = await c.anon.from("folder_boards").insert({
        folder_id: folder,
        board_id: board,
        position: 0,
        created_at: "2999-01-01T00:00:00Z",
      });
      expect(error).toBeNull();
      const { error: upErr } = await c.anon
        .from("folder_boards")
        .update({ created_at: "2999-01-01T00:00:00Z", position: 3 })
        .eq("board_id", board);
      expect(upErr).toBeNull();
      const { data } = await admin
        .from("folder_boards")
        .select("created_at, position")
        .eq("board_id", board)
        .single();
      expect(data?.position).toBe(3);
      const stamped = new Date(data!.created_at).getTime();
      expect(stamped).toBeGreaterThan(before - 60_000);
      expect(stamped).toBeLessThan(Date.now() + 60_000);
    });

    it("does not redeem an invitation its inviter could not make any more", async () => {
      const folder = await newFolder(c.anon, a.orgId, ws, c.id);
      const mine = await newBoard(c.anon, ws, "redeem-mine");
      const { error: placeErr } = await place(c.anon, folder, mine);
      expect(placeErr).toBeNull();
      const invitee = await newUser("guard-invitee");
      const { error: inviteErr } = await c.anon.rpc("invite_to_folder", {
        p_folder_id: folder,
        p_email: invitee.email,
        p_level: "editor",
      });
      expect(inviteErr).toBeNull();

      // A board C does not own, on record as in the folder before the
      // invitation (what an invitation from before the guard looks like).
      // Written with the service role, which no trigger second-guesses.
      const theirs = await newBoard(a.anon, ws, "redeem-theirs");
      const { error: seedErr } = await admin.from("folder_boards").insert({
        folder_id: folder,
        board_id: theirs,
        position: 1,
        created_at: new Date(Date.now() - 86_400_000).toISOString(),
      });
      expect(seedErr).toBeNull();

      const { error: redeemErr } = await invitee.anon.rpc("redeem_invitations");
      expect(redeemErr).toBeNull();
      // They joined the org, but the folder grant did not land.
      const { data: role } = await admin
        .from("org_members")
        .select("role")
        .eq("org_id", a.orgId)
        .eq("user_id", invitee.id);
      expect(role).toEqual([{ role: "guest" }]);
      expect(await folderMemberRows(folder, invitee.id)).toHaveLength(0);
      expect(
        (await folderInvitationFor(folder, invitee.email)).map((r) => r.status),
      ).toEqual(["pending"]);
      expect(await canRead(invitee.anon, mine)).toBe(false);
      expect(await canRead(invitee.anon, theirs)).toBe(false);

      // The pending invitation is for an address that is now an org member,
      // so a manager who may share adds them directly; the stale invitation
      // then has nothing left to grant.
      await share(folder, invitee.id, "viewer", adm.anon);
      expect(await canRead(invitee.anon, theirs)).toBe(true);
      expect(await canEdit(invitee.anon, theirs)).toBe(false);
      // Redeeming again must not lift them to the stale invitation's level.
      const { error: againErr } = await invitee.anon.rpc("redeem_invitations");
      expect(againErr).toBeNull();
      expect(await folderMemberRows(folder, invitee.id)).toEqual([
        { access_level: "viewer" },
      ]);
    });

    it("redeems when a board was filed after the invitation by someone allowed to", async () => {
      const folder = await newFolder(c.anon, a.orgId, ws, c.id);
      const invitee = await newUser("guard-later");
      const { error: inviteErr } = await c.anon.rpc("invite_to_folder", {
        p_folder_id: folder,
        p_email: invitee.email,
        p_level: "viewer",
      });
      expect(inviteErr).toBeNull();
      // Filed afterwards by the board's creator: the move guard vetted it.
      const board = await newBoard(a.anon, ws, "filed-later");
      const { error: placeErr } = await place(a.anon, folder, board);
      expect(placeErr).toBeNull();

      const { error: redeemErr } = await invitee.anon.rpc("redeem_invitations");
      expect(redeemErr).toBeNull();
      expect(await folderMemberRows(folder, invitee.id)).toEqual([
        { access_level: "viewer" },
      ]);
      expect(await canRead(invitee.anon, board)).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────── invitations
  describe("folder invitations", () => {
    it("records a pending invitation that grants nothing, visible only to managers", async () => {
      const { folderId: f } = await freshFolderWithBoard("pending");
      const email = `fm-invitee-${randomUUID()}@example.com`;
      const { data, error } = await a.anon.rpc("invite_to_folder", {
        p_folder_id: f,
        p_email: email,
        p_level: "viewer",
      });
      expect(error).toBeNull();
      expect(data).toBeNull();
      const mine = await a.anon
        .from("folder_invitations")
        .select("id, status")
        .eq("folder_id", f)
        .eq("email", email);
      expect(mine.data).toHaveLength(1);
      expect(mine.data![0].status).toBe("pending");
      const orgInvite = await orgInvitationFor(a.orgId, email);
      expect(orgInvite.map((r) => [r.role, r.status])).toEqual([
        ["guest", "pending"],
      ]);
      const { data: members } = await admin
        .from("folder_members")
        .select("user_id")
        .eq("folder_id", f);
      expect(members ?? []).toHaveLength(0);

      const { data: states } = await a.anon.rpc("folder_invitation_states", {
        p_folder_id: f,
      });
      expect((states ?? []).map((r) => [r.email, r.state])).toEqual([
        [email, "invited"],
      ]);

      const { error: revokeErr } = await a.anon.rpc(
        "revoke_folder_invitation",
        { p_id: mine.data![0].id },
      );
      expect(revokeErr).toBeNull();
      const after = await orgInvitationFor(a.orgId, email);
      expect(after.map((r) => r.status)).toEqual(["revoked"]);
      const folderInv = await folderInvitationFor(f, email);
      expect(folderInv.map((r) => r.status)).toEqual(["revoked"]);
    });

    it("refuses a non-manager who tries to invite", async () => {
      const { folderId: f } = await freshFolderWithBoard("invite-denied");
      await share(f, c.id, "editor");
      const email = `fm-noinvite-${randomUUID()}@example.com`;
      // C is an editor of the folder but neither its creator nor an admin.
      const { error } = await c.anon.rpc("invite_to_folder", {
        p_folder_id: f,
        p_email: email,
        p_level: "viewer",
      });
      expect(error?.code).toBe("42501");
      expect(await folderInvitationFor(f, email)).toHaveLength(0);
      expect(await orgInvitationFor(a.orgId, email)).toHaveLength(0);
    });

    it("lets an org admin who did not create the folder unshare and revoke", async () => {
      const { folderId: f, boardId } = await freshFolderWithBoard("adm-revoke");
      await share(f, d.id, "viewer");
      expect(await canRead(d.anon, boardId)).toBe(true);
      const { error: unshareErr } = await adm.anon.rpc("unshare_folder", {
        p_folder_id: f,
        p_user_id: d.id,
      });
      expect(unshareErr).toBeNull();
      expect(await folderMemberRows(f, d.id)).toHaveLength(0);
      expect(await canRead(d.anon, boardId)).toBe(false);

      const email = `fm-admrevoke-${randomUUID()}@example.com`;
      const { error: inviteErr } = await a.anon.rpc("invite_to_folder", {
        p_folder_id: f,
        p_email: email,
        p_level: "viewer",
      });
      expect(inviteErr).toBeNull();
      const inv = await folderInvitationFor(f, email);
      expect(inv).toHaveLength(1);
      const { error: revokeErr } = await adm.anon.rpc(
        "revoke_folder_invitation",
        { p_id: inv[0].id },
      );
      expect(revokeErr).toBeNull();
      expect((await folderInvitationFor(f, email))[0].status).toBe("revoked");
    });

    it("does not let an account that is not approved redeem an invitation", async () => {
      const { folderId: f, boardId } = await freshFolderWithBoard("unapproved");
      // No pre_approved flag: handle_new_user records the account as pending.
      const email = `fm-unapproved-${randomUUID()}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
        });
      expect(createErr, "createUser(unapproved)").toBeNull();
      const userId = created.user!.id;
      createdUserIds.push(userId);
      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });
      const { data: approval } = await admin
        .from("account_approvals")
        .select("status")
        .eq("user_id", userId)
        .single();
      expect(approval?.status).toBe("pending");

      const { error: inviteErr } = await a.anon.rpc("invite_to_folder", {
        p_folder_id: f,
        p_email: email,
        p_level: "editor",
      });
      expect(inviteErr).toBeNull();
      const orgInv = await orgInvitationFor(a.orgId, email);
      expect(orgInv).toHaveLength(1);
      const { data: states } = await a.anon.rpc("folder_invitation_states", {
        p_folder_id: f,
      });
      expect((states ?? []).map((r) => r.state)).toEqual(["awaiting_approval"]);

      const redeem = await anon.rpc("redeem_invitations");
      expect(redeem.error).not.toBeNull();
      const accept = await anon.rpc("accept_invitation", {
        p_invite_id: orgInv[0].id,
      });
      expect(accept.error).not.toBeNull();

      const { data: membership } = await admin
        .from("org_members")
        .select("role")
        .eq("org_id", a.orgId)
        .eq("user_id", userId);
      expect(membership ?? []).toHaveLength(0);
      expect(await folderMemberRows(f, userId)).toHaveLength(0);
      expect((await folderInvitationFor(f, email))[0].status).toBe("pending");
      expect(await canRead(anon, boardId)).toBe(false);

      // Once approved, the same invitation redeems.
      const { error: approveErr } = await admin
        .from("account_approvals")
        .update({ status: "approved", decided_at: new Date().toISOString() })
        .eq("user_id", userId);
      expect(approveErr).toBeNull();
      const { error: okErr } = await anon.rpc("redeem_invitations");
      expect(okErr).toBeNull();
      expect(await folderMemberRows(f, userId)).toEqual([
        { access_level: "editor" },
      ]);
    });

    it("refuses a non-manager who tries to revoke an invitation", async () => {
      const { folderId: f } = await freshFolderWithBoard("revoke-denied");
      const email = `fm-norevoke-${randomUUID()}@example.com`;
      await a.anon.rpc("invite_to_folder", {
        p_folder_id: f,
        p_email: email,
        p_level: "viewer",
      });
      const inv = await folderInvitationFor(f, email);
      expect(inv).toHaveLength(1);
      const { error } = await c.anon.rpc("revoke_folder_invitation", {
        p_id: inv[0].id,
      });
      expect(error?.code).toBe("42501");
      expect((await folderInvitationFor(f, email))[0].status).toBe("pending");
      expect((await orgInvitationFor(a.orgId, email))[0].status).toBe(
        "pending",
      );
    });

    it("keeps the shared guest org invitation until the last pending folder invitation is revoked", async () => {
      const { folderId: fA } = await freshFolderWithBoard("two-a");
      const { folderId: fB } = await freshFolderWithBoard("two-b");
      const email = `fm-two-${randomUUID()}@example.com`;
      for (const f of [fA, fB]) {
        const { error } = await a.anon.rpc("invite_to_folder", {
          p_folder_id: f,
          p_email: email,
          p_level: "viewer",
        });
        expect(error).toBeNull();
      }
      const orgInv = await orgInvitationFor(a.orgId, email);
      expect(orgInv).toHaveLength(1);
      const invA = (await folderInvitationFor(fA, email))[0];
      const invB = (await folderInvitationFor(fB, email))[0];
      // The second invite adopted the org invitation the first one created.
      expect(invA.org_invitation_id).toBe(orgInv[0].id);
      expect(invB.org_invitation_id).toBe(orgInv[0].id);

      const { error: e1 } = await a.anon.rpc("revoke_folder_invitation", {
        p_id: invA.id,
      });
      expect(e1).toBeNull();
      expect((await orgInvitationFor(a.orgId, email))[0].status).toBe(
        "pending",
      );

      const { error: e2 } = await a.anon.rpc("revoke_folder_invitation", {
        p_id: invB.id,
      });
      expect(e2).toBeNull();
      expect((await orgInvitationFor(a.orgId, email))[0].status).toBe(
        "revoked",
      );
    });

    it("never revokes an org invitation an admin made", async () => {
      const { folderId: f } = await freshFolderWithBoard("admin-made");
      const email = `fm-adminmade-${randomUUID()}@example.com`;
      const { error: seedErr } = await admin.from("org_invitations").insert({
        org_id: a.orgId,
        email,
        role: "guest",
        invited_by: a.id,
      });
      expect(seedErr).toBeNull();

      const { error } = await a.anon.rpc("invite_to_folder", {
        p_folder_id: f,
        p_email: email,
        p_level: "viewer",
      });
      expect(error).toBeNull();
      const inv = await folderInvitationFor(f, email);
      expect(inv).toHaveLength(1);
      // Not adopted: no folder invite created that org invitation.
      expect(inv[0].org_invitation_id).toBeNull();

      const { error: revokeErr } = await a.anon.rpc(
        "revoke_folder_invitation",
        { p_id: inv[0].id },
      );
      expect(revokeErr).toBeNull();
      expect((await folderInvitationFor(f, email))[0].status).toBe("revoked");
      const orgInv = await orgInvitationFor(a.orgId, email);
      expect(orgInv).toHaveLength(1);
      expect(orgInv[0].status).toBe("pending");
    });

    it("redeems a folder invitation into membership when the invitee signs in", async () => {
      const { folderId: f, boardId } = await freshFolderWithBoard("redeem");
      const invitee = await newUser("invitee");
      const { error } = await a.anon.rpc("invite_to_folder", {
        p_folder_id: f,
        p_email: invitee.email,
        p_level: "editor",
      });
      expect(error).toBeNull();
      expect(await canRead(invitee.anon, boardId)).toBe(false);
      expect(await folderMemberRows(f, invitee.id)).toHaveLength(0);

      const { error: redeemErr } = await invitee.anon.rpc("redeem_invitations");
      expect(redeemErr).toBeNull();
      expect(await canRead(invitee.anon, boardId)).toBe(true);
      expect(await canEdit(invitee.anon, boardId)).toBe(true);
      expect(await folderMemberRows(f, invitee.id)).toEqual([
        { access_level: "editor" },
      ]);
      const { data: role } = await admin
        .from("org_members")
        .select("role")
        .eq("org_id", a.orgId)
        .eq("user_id", invitee.id);
      expect(role).toEqual([{ role: "guest" }]);
      expect((await folderInvitationFor(f, invitee.email))[0].status).toBe(
        "accepted",
      );
    });

    it("redeems through accept_invitation", async () => {
      const { folderId: f, boardId } = await freshFolderWithBoard("accept");
      const invitee = await newUser("accepter");
      await a.anon.rpc("invite_to_folder", {
        p_folder_id: f,
        p_email: invitee.email,
        p_level: "viewer",
      });
      const orgInv = await orgInvitationFor(a.orgId, invitee.email);
      expect(orgInv).toHaveLength(1);
      expect(await canRead(invitee.anon, boardId)).toBe(false);

      const { data, error } = await invitee.anon.rpc("accept_invitation", {
        p_invite_id: orgInv[0].id,
      });
      expect(error).toBeNull();
      expect(data).toBe(a.orgId);
      expect(await folderMemberRows(f, invitee.id)).toEqual([
        { access_level: "viewer" },
      ]);
      expect(await canRead(invitee.anon, boardId)).toBe(true);
    });

    it("creates a folder_members row only for an org the user has joined", async () => {
      const { folderId: fA } = await freshFolderWithBoard("joined-a");
      const wsB = await newWorkspace(b, "WS B");
      const fB = await newFolder(b.anon, b.orgId, wsB, b.id);
      const invitee = await newUser("two-orgs");

      for (const [owner, folder] of [
        [a, fA],
        [b, fB],
      ] as const) {
        const { error } = await owner.anon.rpc("invite_to_folder", {
          p_folder_id: folder,
          p_email: invitee.email,
          p_level: "viewer",
        });
        expect(error).toBeNull();
      }
      const invA = await orgInvitationFor(a.orgId, invitee.email);
      const invB = await orgInvitationFor(b.orgId, invitee.email);
      expect(invA).toHaveLength(1);
      expect(invB).toHaveLength(1);

      // Join org A only.
      const { error } = await invitee.anon.rpc("accept_invitation", {
        p_invite_id: invA[0].id,
      });
      expect(error).toBeNull();
      expect(await folderMemberRows(fA, invitee.id)).toHaveLength(1);
      expect(await folderMemberRows(fB, invitee.id)).toHaveLength(0);
      expect((await folderInvitationFor(fB, invitee.email))[0].status).toBe(
        "pending",
      );

      // Joining org B later completes the second grant.
      const { error: errB } = await invitee.anon.rpc("accept_invitation", {
        p_invite_id: invB[0].id,
      });
      expect(errB).toBeNull();
      expect(await folderMemberRows(fB, invitee.id)).toHaveLength(1);
    });

    it("declines the folder invitations that came with a declined org invitation", async () => {
      const { folderId: f, boardId } = await freshFolderWithBoard("decline");
      const invitee = await newUser("decliner");
      await a.anon.rpc("invite_to_folder", {
        p_folder_id: f,
        p_email: invitee.email,
        p_level: "viewer",
      });
      const orgInv = await orgInvitationFor(a.orgId, invitee.email);
      expect(orgInv).toHaveLength(1);
      const { error } = await invitee.anon.rpc("decline_invitation", {
        p_invite_id: orgInv[0].id,
      });
      expect(error).toBeNull();
      expect((await folderInvitationFor(f, invitee.email))[0].status).toBe(
        "revoked",
      );
      await invitee.anon.rpc("redeem_invitations");
      expect(await folderMemberRows(f, invitee.id)).toHaveLength(0);
      expect(await canRead(invitee.anon, boardId)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────── guest confinement
  describe("guests", () => {
    let gf1: string; // shared with G
    let gf2: string; // not shared with G
    let gf3: string; // shared with C; G holds a direct grant on its board
    let gb1: string;
    let gb2: string;
    let gb3: string;
    let guestFoldersBefore: string[] = [];
    let dAttached: string;
    let dOther: string;
    let dLoose: string;
    let wAttached: string;
    let wLoose: string;
    let goalG: string;
    let goalC: string;
    let portfolioG: string;
    let portfolioC: string;
    let reportId: string;
    let goalLinkId: string;
    let portfolioBoardId: string;
    let gc1: Awaited<ReturnType<typeof seedContent>>;
    let gc2: Awaited<ReturnType<typeof seedContent>>;

    async function visibleFolderIds(anon: Client) {
      const { data, error } = await anon
        .from("folders")
        .select("id")
        .eq("org_id", a.orgId);
      expect(error).toBeNull();
      return (data ?? []).map((f) => f.id);
    }

    beforeAll(async () => {
      ({ folderId: gf1, boardId: gb1 } = await freshFolderWithBoard("g1"));
      ({ folderId: gf2, boardId: gb2 } = await freshFolderWithBoard("g2"));
      ({ folderId: gf3, boardId: gb3 } = await freshFolderWithBoard("g3"));
      await share(gf3, c.id, "viewer");
      await grantBoard(gb3, g.id, "viewer");

      guestFoldersBefore = await visibleFolderIds(g.anon);
      await share(gf1, g.id, "viewer");

      // A pending invitation on gf1 for the guest's invitation-state check.
      const { error: invErr } = await a.anon.rpc("invite_to_folder", {
        p_folder_id: gf1,
        p_email: `fm-gstate-${randomUUID()}@example.com`,
        p_level: "viewer",
      });
      expect(invErr).toBeNull();

      // Dashboards: attached to gf1, attached to gf2, attached to nothing.
      const mkDash = async (name: string) => {
        const { data, error } = await a.anon.rpc("create_dashboard", {
          p_workspace_id: ws,
          p_name: name,
        });
        expect(error, `create_dashboard(${name})`).toBeNull();
        return (data as { id: string }).id;
      };
      dAttached = await mkDash("Attached");
      dOther = await mkDash("Other");
      dLoose = await mkDash("Loose");
      for (const [dash, folder] of [
        [dAttached, gf1],
        [dOther, gf2],
      ] as const) {
        const { error } = await a.anon
          .from("dashboards")
          .update({ folder_id: folder })
          .eq("id", dash);
        expect(error).toBeNull();
      }
      const mkWidget = async (dash: string, board: string) => {
        const { data, error } = await a.anon.rpc("create_dashboard_widget", {
          p_dashboard_id: dash,
          p_kind: "number",
          p_source_board_id: board,
        });
        expect(error, "create_dashboard_widget").toBeNull();
        return (data as { id: string }).id;
      };
      wAttached = await mkWidget(dAttached, gb1);
      wLoose = await mkWidget(dLoose, gb2);

      // Org-level records written with the service role.
      const mkGoal = async (owner: string) => {
        const { data, error } = await admin
          .from("goals")
          .insert({
            org_id: a.orgId,
            created_by: owner,
            owner_id: owner,
            name: `Goal ${randomUUID()}`,
            progress_mode: "manual_number",
          })
          .select("id")
          .single();
        expect(error, "goal").toBeNull();
        return (data as { id: string }).id;
      };
      const mkPortfolio = async (owner: string) => {
        const { data, error } = await admin
          .from("portfolios")
          .insert({
            org_id: a.orgId,
            created_by: owner,
            name: `Portfolio ${randomUUID()}`,
          })
          .select("id")
          .single();
        expect(error, "portfolio").toBeNull();
        return (data as { id: string }).id;
      };
      goalG = await mkGoal(g.id);
      goalC = await mkGoal(c.id);
      portfolioG = await mkPortfolio(g.id);
      portfolioC = await mkPortfolio(c.id);
      const { data: report, error: reportErr } = await admin
        .from("reports")
        .insert({
          org_id: a.orgId,
          created_by: a.id,
          name: "Org report",
          // reports_scope_binding_ck: 'boards' needs no board and no portfolio.
          scope: "boards",
        })
        .select("id")
        .single();
      expect(reportErr, "report").toBeNull();
      reportId = (report as { id: string }).id;
      const { error: capErr } = await admin.from("member_capacity").insert({
        org_id: a.orgId,
        user_id: c.id,
        created_by: a.id,
      });
      expect(capErr, "member_capacity").toBeNull();

      const { data: link, error: linkErr } = await admin
        .from("goal_links")
        .insert({ org_id: a.orgId, goal_id: goalC, board_id: gb1 })
        .select("id")
        .single();
      expect(linkErr, "goal_link").toBeNull();
      goalLinkId = (link as { id: string }).id;
      const { data: pb, error: pbErr } = await admin
        .from("portfolio_boards")
        .insert({ org_id: a.orgId, portfolio_id: portfolioC, board_id: gb1 })
        .select("id")
        .single();
      expect(pbErr, "portfolio_board").toBeNull();
      portfolioBoardId = (pb as { id: string }).id;

      // Items for the time-allocation checks.
      gc1 = await seedContent(gb1, "gc1");
      gc2 = await seedContent(gb2, "gc2");
    }, 240_000);

    it("shows a guest only the folders they are a member of", async () => {
      expect(guestFoldersBefore).toEqual([]);
      const visible = await visibleFolderIds(g.anon);
      expect(visible).toEqual([gf1]);
      // The full member sees them all, so the guest filter is what hides them.
      const all = await visibleFolderIds(a.anon);
      expect(all).toEqual(expect.arrayContaining([gf1, gf2, gf3, folderId]));
    });

    it("lets a guest read boards only through the folder they were given", async () => {
      expect(await canRead(g.anon, gb1)).toBe(true);
      expect(await canRead(g.anon, gb2)).toBe(false);
    });

    it("limits folder_gallery to the guest's folders", async () => {
      const guest = await g.anon.rpc("folder_gallery", { p_workspace_id: ws });
      expect(guest.error).toBeNull();
      expect((guest.data ?? []).map((r) => r.folder_id)).toEqual([gf1]);
      const owner = await a.anon.rpc("folder_gallery", { p_workspace_id: ws });
      expect((owner.data ?? []).map((r) => r.folder_id)).toEqual(
        expect.arrayContaining([gf1, gf2, gf3]),
      );
    });

    it("limits the folder RPCs to the guest's folders", async () => {
      const ok = await g.anon.rpc("folder_rollup", { p_folder_id: gf1 });
      expect(ok.error).toBeNull();
      const refused = await g.anon.rpc("folder_rollup", { p_folder_id: gf2 });
      expect(refused.error?.code).toBe("P0002");
      const refusedAttention = await g.anon.rpc("folder_attention", {
        p_folder_id: gf2,
      });
      expect(refusedAttention.error?.code).toBe("P0002");

      // gf1 has a pending invitation (checked as the manager), and the guest
      // is not a manager so sees none.
      const managerStates = await a.anon.rpc("folder_invitation_states", {
        p_folder_id: gf1,
      });
      expect(managerStates.data ?? []).toHaveLength(1);
      const guestStates = await g.anon.rpc("folder_invitation_states", {
        p_folder_id: gf1,
      });
      expect(guestStates.error).toBeNull();
      expect(guestStates.data ?? []).toHaveLength(0);
    });

    it("returns no board_folder_grants for a folder the guest cannot see", async () => {
      // The guest reads gb3 through a direct grant, but its folder is hidden.
      expect(await canRead(g.anon, gb3)).toBe(true);
      expect(await visibleFolderIds(g.anon)).not.toContain(gf3);
      const fullMember = await c.anon.rpc("board_folder_grants", {
        p_board_id: gb3,
      });
      expect(fullMember.error).toBeNull();
      expect((fullMember.data ?? []).map((r) => r.user_id)).toContain(c.id);

      const guest = await g.anon.rpc("board_folder_grants", {
        p_board_id: gb3,
      });
      expect(guest.error).toBeNull();
      expect(guest.data ?? []).toHaveLength(0);

      // For a folder the guest can see, the grants show up.
      const visible = await g.anon.rpc("board_folder_grants", {
        p_board_id: gb1,
      });
      expect((visible.data ?? []).map((r) => r.user_id)).toContain(g.id);
    });

    it("cannot read goals, portfolios, reports or member capacity", async () => {
      const guestGoals = await g.anon
        .from("goals")
        .select("id")
        .in("id", [goalG, goalC]);
      expect(guestGoals.data ?? []).toHaveLength(0);
      const memberGoals = await c.anon
        .from("goals")
        .select("id")
        .in("id", [goalG, goalC]);
      expect(memberGoals.data ?? []).toHaveLength(2);

      const guestPortfolios = await g.anon
        .from("portfolios")
        .select("id")
        .in("id", [portfolioG, portfolioC]);
      expect(guestPortfolios.data ?? []).toHaveLength(0);
      const memberPortfolios = await c.anon
        .from("portfolios")
        .select("id")
        .in("id", [portfolioG, portfolioC]);
      expect(memberPortfolios.data ?? []).toHaveLength(2);

      const guestReports = await g.anon
        .from("reports")
        .select("id")
        .eq("id", reportId);
      expect(guestReports.data ?? []).toHaveLength(0);
      const memberReports = await c.anon
        .from("reports")
        .select("id")
        .eq("id", reportId);
      expect(memberReports.data ?? []).toHaveLength(1);

      const guestCapacity = await g.anon
        .from("member_capacity")
        .select("id")
        .eq("org_id", a.orgId);
      expect(guestCapacity.data ?? []).toHaveLength(0);
      const memberCapacity = await c.anon
        .from("member_capacity")
        .select("id")
        .eq("org_id", a.orgId);
      expect((memberCapacity.data ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("reads a dashboard only if it is attached to a folder they are a member of", async () => {
      const all = [dAttached, dOther, dLoose];
      const owner = await a.anon.from("dashboards").select("id").in("id", all);
      expect(owner.data ?? []).toHaveLength(3);
      const guest = await g.anon.from("dashboards").select("id").in("id", all);
      expect((guest.data ?? []).map((r) => r.id)).toEqual([dAttached]);

      const widgets = [wAttached, wLoose];
      const ownerW = await a.anon
        .from("dashboard_widgets")
        .select("id")
        .in("id", widgets);
      expect(ownerW.data ?? []).toHaveLength(2);
      const guestW = await g.anon
        .from("dashboard_widgets")
        .select("id")
        .in("id", widgets);
      expect((guestW.data ?? []).map((r) => r.id)).toEqual([wAttached]);
    });

    it("cannot read goal_links or portfolio_boards", async () => {
      const guestLinks = await g.anon
        .from("goal_links")
        .select("id")
        .eq("id", goalLinkId);
      expect(guestLinks.error).toBeNull();
      expect(guestLinks.data ?? []).toHaveLength(0);
      const memberLinks = await c.anon
        .from("goal_links")
        .select("id")
        .eq("id", goalLinkId);
      expect(memberLinks.data ?? []).toHaveLength(1);

      const guestPortfolioBoards = await g.anon
        .from("portfolio_boards")
        .select("id")
        .eq("id", portfolioBoardId);
      expect(guestPortfolioBoards.error).toBeNull();
      expect(guestPortfolioBoards.data ?? []).toHaveLength(0);
      const memberPortfolioBoards = await c.anon
        .from("portfolio_boards")
        .select("id")
        .eq("id", portfolioBoardId);
      expect(memberPortfolioBoards.data ?? []).toHaveLength(1);
    });

    it("cannot create folders, workspaces, boards, dashboards, goals, portfolios or reports", async () => {
      const guestTrigger = /guests cannot create/i;

      // folders has no guest trigger: the insert policy is what refuses.
      const folder = await g.anon.from("folders").insert({
        org_id: a.orgId,
        workspace_id: ws,
        name: "Guest folder",
        created_by: g.id,
      });
      expect(folder.error?.code).toBe("42501");
      expect(folder.error?.message).toMatch(/row-level security/i);
      const { data: folderRows } = await admin
        .from("folders")
        .select("id")
        .eq("name", "Guest folder");
      expect(folderRows ?? []).toHaveLength(0);

      // The tg_block_guest_insert BEFORE INSERT trigger fires ahead of the
      // policy's WITH CHECK, so these all fail with the trigger's message.
      const workspace = await g.anon
        .from("workspaces")
        .insert({ org_id: a.orgId, name: "Guest WS", created_by: g.id });
      expect(workspace.error?.code).toBe("42501");
      expect(workspace.error?.message).toMatch(guestTrigger);
      const { data: wsRows } = await admin
        .from("workspaces")
        .select("id")
        .eq("name", "Guest WS");
      expect(wsRows ?? []).toHaveLength(0);

      // create_board / create_dashboard are security definer and check only
      // membership, then insert: the trigger refuses the insert.
      const board = await g.anon.rpc("create_board", {
        p_workspace_id: ws,
        p_name: "Guest board",
      });
      expect(board.error?.code).toBe("42501");
      expect(board.error?.message).toMatch(guestTrigger);
      const { data: boardRows } = await admin
        .from("boards")
        .select("id")
        .eq("created_by", g.id);
      expect(boardRows ?? []).toHaveLength(0);

      const dashboardRpc = await g.anon.rpc("create_dashboard", {
        p_workspace_id: ws,
        p_name: "Guest dashboard rpc",
      });
      expect(dashboardRpc.error?.code).toBe("42501");
      expect(dashboardRpc.error?.message).toMatch(guestTrigger);
      const dashboard = await g.anon.from("dashboards").insert({
        org_id: a.orgId,
        workspace_id: ws,
        name: "Guest dashboard",
        created_by: g.id,
      });
      expect(dashboard.error?.code).toBe("42501");
      expect(dashboard.error?.message).toMatch(guestTrigger);
      const { data: dashRows } = await admin
        .from("dashboards")
        .select("id")
        .eq("created_by", g.id);
      expect(dashRows ?? []).toHaveLength(0);

      const goal = await g.anon.from("goals").insert({
        org_id: a.orgId,
        created_by: g.id,
        owner_id: g.id,
        name: "Guest goal",
        progress_mode: "manual_number",
      });
      expect(goal.error?.code).toBe("42501");
      expect(goal.error?.message).toMatch(guestTrigger);
      const { data: goalRows } = await admin
        .from("goals")
        .select("id")
        .eq("name", "Guest goal");
      expect(goalRows ?? []).toHaveLength(0);

      const portfolio = await g.anon.from("portfolios").insert({
        org_id: a.orgId,
        created_by: g.id,
        name: "Guest portfolio",
      });
      expect(portfolio.error?.code).toBe("42501");
      expect(portfolio.error?.message).toMatch(guestTrigger);
      const { data: portfolioRows } = await admin
        .from("portfolios")
        .select("id")
        .eq("name", "Guest portfolio");
      expect(portfolioRows ?? []).toHaveLength(0);

      const report = await g.anon.from("reports").insert({
        org_id: a.orgId,
        created_by: g.id,
        name: "Guest report",
        scope: "boards",
      });
      expect(report.error?.code).toBe("42501");
      expect(report.error?.message).toMatch(guestTrigger);
      const { data: reportRows } = await admin
        .from("reports")
        .select("id")
        .eq("name", "Guest report");
      expect(reportRows ?? []).toHaveLength(0);
    });

    it("silently filters a guest's reorder and rename (0 rows affected) while an authorized user can make the same updates", async () => {
      // The update policies exclude guests, so the rows are filtered out of
      // the statement: no error, no rows.
      const reorder = await g.anon
        .from("folder_boards")
        .update({ position: 9 })
        .eq("folder_id", gf1)
        .eq("board_id", gb1)
        .select("position");
      expect(reorder.error).toBeNull();
      expect(reorder.data ?? []).toHaveLength(0);
      const { data: placement } = await admin
        .from("folder_boards")
        .select("position")
        .eq("folder_id", gf1)
        .eq("board_id", gb1)
        .single();
      expect(placement?.position).toBe(0);

      const rename = await g.anon
        .from("folders")
        .update({ name: "Guest rename" })
        .eq("id", gf1)
        .select("id");
      expect(rename.error).toBeNull();
      expect(rename.data ?? []).toHaveLength(0);
      const { data: folderBefore } = await admin
        .from("folders")
        .select("name")
        .eq("id", gf1)
        .single();
      expect(folderBefore?.name).not.toBe("Guest rename");

      // Control: a non-guest member makes the same updates and they land.
      const controlReorder = await a.anon
        .from("folder_boards")
        .update({ position: 9 })
        .eq("folder_id", gf1)
        .eq("board_id", gb1)
        .select("position");
      expect(controlReorder.error).toBeNull();
      expect(controlReorder.data).toEqual([{ position: 9 }]);
      const controlRename = await a.anon
        .from("folders")
        .update({ name: `Control rename ${randomUUID()}` })
        .eq("id", gf1)
        .select("id");
      expect(controlRename.error).toBeNull();
      expect(controlRename.data ?? []).toHaveLength(1);
    });

    it("raises for create_dashboard_widget and set_widget_layouts", async () => {
      const layoutOf = async () => {
        const { data, error } = await admin
          .from("dashboard_widgets")
          .select("layout")
          .eq("id", wAttached)
          .single();
        expect(error).toBeNull();
        return data?.layout;
      };
      const widgetCount = async () => {
        const { data } = await admin
          .from("dashboard_widgets")
          .select("id")
          .eq("dashboard_id", dAttached);
        return (data ?? []).length;
      };
      const layoutBefore = await layoutOf();
      const countBefore = await widgetCount();
      expect(countBefore).toBe(1);

      const create = await g.anon.rpc("create_dashboard_widget", {
        p_dashboard_id: dAttached,
        p_kind: "number",
        p_source_board_id: gb1,
      });
      expect(create.error?.code).toBe("42501");
      expect(create.error?.message).toMatch(/guests cannot change dashboards/i);

      const layouts = await g.anon.rpc("set_widget_layouts", {
        p_dashboard_id: dAttached,
        p_layouts: [{ id: wAttached, x: 3, y: 3, w: 2, h: 2 }],
      });
      expect(layouts.error?.code).toBe("42501");
      expect(layouts.error?.message).toMatch(
        /guests cannot change dashboards/i,
      );
      expect(await layoutOf()).toEqual(layoutBefore);
      expect(await widgetCount()).toBe(countBefore);

      // Control: the same call works for a full member and changes the layout.
      const ownerLayouts = await a.anon.rpc("set_widget_layouts", {
        p_dashboard_id: dAttached,
        p_layouts: [{ id: wAttached, x: 1, y: 1, w: 2, h: 2 }],
      });
      expect(ownerLayouts.error).toBeNull();
      expect(await layoutOf()).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    });

    it("has can_edit_goal and can_edit_portfolio false for a guest owner or creator", async () => {
      const guestGoal = await g.anon.rpc("can_edit_goal", {
        p_goal_id: goalG,
      });
      expect(guestGoal.error).toBeNull();
      expect(guestGoal.data).toBe(false);
      const guestPortfolio = await g.anon.rpc("can_edit_portfolio", {
        p_portfolio_id: portfolioG,
      });
      expect(guestPortfolio.error).toBeNull();
      expect(guestPortfolio.data).toBe(false);

      // Same shape for a non-guest creator/owner is true.
      const memberGoal = await c.anon.rpc("can_edit_goal", {
        p_goal_id: goalC,
      });
      expect(memberGoal.data).toBe(true);
      const memberPortfolio = await c.anon.rpc("can_edit_portfolio", {
        p_portfolio_id: portfolioC,
      });
      expect(memberPortfolio.data).toBe(true);
      // And an org owner can edit the guest's goal, so the false above is the
      // guest rule and not a missing row.
      const ownerGoal = await a.anon.rpc("can_edit_goal", { p_goal_id: goalG });
      expect(ownerGoal.data).toBe(true);
    });

    it("returns only the guest's own rows from workload_actuals_rollup", async () => {
      // Item rows carry item_id (+ board_id); category rows carry no board
      // (constraints time_allocations_item_xor_category / _category_no_board).
      const rows = [
        { user_id: g.id, item_id: gc1.itemIds[0], board_id: gb1 },
        { user_id: c.id, category: "Admin" },
        { user_id: a.id, category: "Planning" },
      ];
      for (const row of rows) {
        const { error } = await admin.from("time_allocations").insert({
          org_id: a.orgId,
          work_date: TODAY,
          duration_secs: 1800,
          ...row,
        });
        expect(error, "time_allocations seed").toBeNull();
      }

      const owner = await a.anon.rpc("workload_actuals_rollup", {
        p_from: TODAY,
        p_to: TODAY,
      });
      expect(owner.error).toBeNull();
      expect((owner.data ?? []).map((r) => r.user_id)).toEqual(
        expect.arrayContaining([g.id, c.id, a.id]),
      );

      const guest = await g.anon.rpc("workload_actuals_rollup", {
        p_from: TODAY,
        p_to: TODAY,
      });
      expect(guest.error).toBeNull();
      expect((guest.data ?? []).length).toBeGreaterThanOrEqual(1);
      expect((guest.data ?? []).every((r) => r.user_id === g.id)).toBe(true);
    });

    it("lets a guest log time only for themself against a board they can read", async () => {
      const own = {
        org_id: a.orgId,
        user_id: g.id,
        work_date: TODAY,
        duration_secs: 900,
      };
      const readable = await g.anon
        .from("time_allocations")
        .insert({ ...own, item_id: gc1.itemIds[1], board_id: gb1 });
      expect(readable.error).toBeNull();

      const unreadable = await g.anon
        .from("time_allocations")
        .insert({ ...own, item_id: gc2.itemIds[0], board_id: gb2 });
      expect(unreadable.error?.code).toBe("42501");

      // A category row has no board, which a guest may not log.
      const noBoard = await g.anon
        .from("time_allocations")
        .insert({ ...own, category: "Admin" });
      expect(noBoard.error?.code).toBe("42501");

      const forSomeoneElse = await g.anon.from("time_allocations").insert({
        ...own,
        user_id: a.id,
        item_id: gc1.itemIds[1],
        board_id: gb1,
      });
      expect(forSomeoneElse.error?.code).toBe("42501");

      const { data: leaked } = await admin
        .from("time_allocations")
        .select("id")
        .eq("user_id", g.id)
        .eq("board_id", gb2);
      expect(leaked ?? []).toHaveLength(0);

      // The guest reads back only their own allocations.
      const { data: seen } = await g.anon
        .from("time_allocations")
        .select("user_id")
        .eq("org_id", a.orgId);
      expect((seen ?? []).length).toBeGreaterThanOrEqual(1);
      expect((seen ?? []).every((r) => r.user_id === g.id)).toBe(true);
    });

    it("loses everything when they leave the folder", async () => {
      expect(await canRead(g.anon, gb1)).toBe(true);
      const { error } = await g.anon
        .from("folder_members")
        .delete()
        .eq("folder_id", gf1)
        .eq("user_id", g.id);
      expect(error).toBeNull();
      expect(await folderMemberRows(gf1, g.id)).toHaveLength(0);
      expect(await canRead(g.anon, gb1)).toBe(false);
      expect(await visibleFolderIds(g.anon)).toEqual([]);
      const dash = await g.anon
        .from("dashboards")
        .select("id")
        .eq("id", dAttached);
      expect(dash.data ?? []).toHaveLength(0);
    });
  });
});
