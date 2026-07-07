import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

// The reader helpers (getBoardPayload / listMyBoards / getBoardTrash /
// getArchivedBoards) and the purge action all resolve their Supabase handle via
// the cookie-bound server client + the session helper. The integration harness
// has no request context, so mock both to route through a real, signed-in anon
// client (swapped in `ctx`). `ctx` is mutable so a single test can act as a
// second tenant by pointing it at org B's client. This exercises the ACTUAL
// queries/actions against the real DB + RLS. (Same pattern as
// archived-reads.integration.test.ts.)
const ctx: { client: SupabaseClient<Database> | null; userId: string } = {
  client: null,
  userId: "",
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ctx.client,
}));
vi.mock("@/lib/auth/session", () => ({
  getUser: async () => ({ id: ctx.userId }),
}));

// Storage-object cleanup on purge goes through the service-role client; the
// harness cannot inspect the bucket, so spy the cleanup and assert it is called
// with the archived item's attachment path (action-level storage assertion).
// `vi.hoisted` lets the spy exist before the hoisted `vi.mock` factory runs.
const { removeAttachmentObjects } = vi.hoisted(() => ({
  removeAttachmentObjects: vi.fn(async () => {}),
}));
vi.mock("@/lib/collaboration/attachment-cleanup", () => ({
  removeAttachmentObjects,
}));

// vi.mock calls above are hoisted, so these static imports bind the readers +
// the purge action to the mocked server client + session.
import { purgeItem } from "@/lib/boards/actions";
import { listMyBoards } from "@/lib/boards/queries";
import { getBoardPayload } from "@/lib/boards/queries";
import { getArchivedBoards, getBoardTrash } from "@/lib/boards/trash-queries";

describe.skipIf(!integrationTargetReady())(
  "soft-delete lifecycle: archive / restore / purge across boards, groups, items",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    // Tenant A owns the fixtures; tenant B is an outsider in another org.
    let aAnon: SupabaseClient<Database>;
    let aUserId: string;
    let orgAId: string;
    let bAnon: SupabaseClient<Database>;
    let bUserId: string;

    let board1Id: string; // item/group/purge lifecycle
    let board2Id: string; // board archive lifecycle
    let defaultGroupId: string;

    async function provision(label: string): Promise<{
      anon: SupabaseClient<Database>;
      userId: string;
      orgId: string;
    }> {
      const email = `sd-life-${label}-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      expect(error, `createUser(${label})`).toBeNull();
      const userId = created.user!.id;
      createdUserIds.push(userId);

      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });

      const { data: org, error: orgErr } = await anon.rpc(
        "create_organization",
        {
          p_name: `Org ${label} ${randomUUID().slice(0, 8)}`,
          p_slug: `sd-life-${label}-${randomUUID().slice(0, 8)}`,
        },
      );
      expect(orgErr, `create_organization(${label})`).toBeNull();
      return { anon, userId, orgId: (org as { id: string }).id };
    }

    async function createBoard(name: string): Promise<string> {
      const { data: ws, error: wsErr } = await aAnon
        .from("workspaces")
        .insert({ org_id: orgAId, name: "WS A", created_by: aUserId })
        .select("id")
        .single();
      expect(wsErr, "insert workspace").toBeNull();
      const { data: board, error: boardErr } = await aAnon.rpc("create_board", {
        p_workspace_id: (ws as { id: string }).id,
        p_name: name,
      });
      expect(boardErr, `create_board(${name})`).toBeNull();
      return (board as { id: string }).id;
    }

    // Direct insert (create_item has no parent_id arg, and subitems are needed).
    async function seedItem(opts: {
      boardId: string;
      groupId: string;
      name: string;
      position: number;
      parentId?: string;
    }): Promise<string> {
      const { data: item, error } = await aAnon
        .from("items")
        .insert({
          org_id: orgAId,
          board_id: opts.boardId,
          group_id: opts.groupId,
          name: opts.name,
          position: opts.position,
          ...(opts.parentId ? { parent_id: opts.parentId } : {}),
        })
        .select("id")
        .single();
      expect(error, `seedItem(${opts.name})`).toBeNull();
      return (item as { id: string }).id;
    }

    async function seedGroup(name: string, position: number): Promise<string> {
      const { data: group, error } = await aAnon
        .from("groups")
        .insert({ org_id: orgAId, board_id: board1Id, name, position })
        .select("id")
        .single();
      expect(error, `seedGroup(${name})`).toBeNull();
      return (group as { id: string }).id;
    }

    async function payloadItemIds(boardId: string): Promise<string[]> {
      const payload = await getBoardPayload(boardId);
      expect(payload, "board payload present").not.toBeNull();
      return (payload?.items ?? []).map((i) => i.id);
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const a = await provision("a");
      aAnon = a.anon;
      aUserId = a.userId;
      orgAId = a.orgId;

      const b = await provision("b");
      bAnon = b.anon;
      bUserId = b.userId;

      board1Id = await createBoard("Lifecycle board");
      board2Id = await createBoard("Board to archive");

      const { data: group, error: groupErr } = await aAnon
        .from("groups")
        .select("id")
        .eq("board_id", board1Id)
        .limit(1)
        .single();
      expect(groupErr, "seeded group").toBeNull();
      defaultGroupId = (group as { id: string }).id;

      // Default: act as tenant A.
      ctx.client = aAnon;
      ctx.userId = aUserId;
    }, 120_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("archiving an item hides it from getBoardPayload and surfaces it in getBoardTrash", async () => {
      ctx.client = aAnon;
      ctx.userId = aUserId;
      const soloId = await seedItem({
        boardId: board1Id,
        groupId: defaultGroupId,
        name: "solo",
        position: 100,
      });

      const { error: archErr } = await aAnon.rpc("archive_item", {
        p_item_id: soloId,
      });
      expect(archErr, "archive_item(solo)").toBeNull();

      expect(await payloadItemIds(board1Id)).not.toContain(soloId);

      const trash = await getBoardTrash(board1Id);
      expect(trash.items.map((i) => i.id)).toContain(soloId);
    }, 30_000);

    it("restoring an item brings it back with its subitems", async () => {
      ctx.client = aAnon;
      ctx.userId = aUserId;
      const parentId = await seedItem({
        boardId: board1Id,
        groupId: defaultGroupId,
        name: "parent",
        position: 200,
      });
      const childId = await seedItem({
        boardId: board1Id,
        groupId: defaultGroupId,
        name: "child",
        position: 201,
        parentId,
      });

      const { error: archErr } = await aAnon.rpc("archive_item", {
        p_item_id: parentId,
      });
      expect(archErr, "archive_item(parent)").toBeNull();

      const afterArchive = await payloadItemIds(board1Id);
      expect(afterArchive).not.toContain(parentId);
      expect(afterArchive).not.toContain(childId);

      const { error: restoreErr } = await aAnon.rpc("restore_item", {
        p_item_id: parentId,
      });
      expect(restoreErr, "restore_item(parent)").toBeNull();

      const afterRestore = await payloadItemIds(board1Id);
      expect(afterRestore).toContain(parentId);
      expect(afterRestore).toContain(childId);
    }, 30_000);

    it("restoring a group returns only its batch; a separately-archived item stays archived", async () => {
      ctx.client = aAnon;
      ctx.userId = aUserId;
      const groupId = await seedGroup("Batch group", 5);
      const itemXId = await seedItem({
        boardId: board1Id,
        groupId,
        name: "itemX (archived earlier, separate batch)",
        position: 300,
      });
      const itemYId = await seedItem({
        boardId: board1Id,
        groupId,
        name: "itemY (archived with the group)",
        position: 301,
      });

      // itemX is archived on its own first → its own timestamp batch (T1).
      const { error: xErr } = await aAnon.rpc("archive_item", {
        p_item_id: itemXId,
      });
      expect(xErr, "archive_item(itemX)").toBeNull();

      // Archiving the group is a later, distinct timestamp batch (T2). It only
      // touches live rows, so itemX (already archived) keeps its T1 stamp while
      // the group + itemY get T2.
      const { error: gErr } = await aAnon.rpc("archive_group", {
        p_group_id: groupId,
      });
      expect(gErr, "archive_group").toBeNull();

      const afterArchive = await payloadItemIds(board1Id);
      expect(afterArchive).not.toContain(itemXId);
      expect(afterArchive).not.toContain(itemYId);

      const { error: rErr } = await aAnon.rpc("restore_group", {
        p_group_id: groupId,
      });
      expect(rErr, "restore_group").toBeNull();

      const afterRestore = await payloadItemIds(board1Id);
      // itemY was in the group's batch (T2) → it returns.
      expect(afterRestore).toContain(itemYId);
      // itemX was archived separately (T1) → it stays archived.
      expect(afterRestore).not.toContain(itemXId);

      // And itemX is still sitting in the board's Trash.
      const trash = await getBoardTrash(board1Id);
      expect(trash.items.map((i) => i.id)).toContain(itemXId);
    }, 30_000);

    it("archiving a board removes it from listMyBoards and lists it in getArchivedBoards", async () => {
      ctx.client = aAnon;
      ctx.userId = aUserId;

      // Sanity: board2 is live and listed before archiving.
      const before = await listMyBoards();
      expect(before.map((b) => b.id)).toContain(board2Id);

      const { error: updErr } = await aAnon
        .from("boards")
        .update({
          archived_at: new Date().toISOString(),
          archived_by: aUserId,
        })
        .eq("id", board2Id);
      expect(updErr, "archive board2").toBeNull();

      const after = await listMyBoards();
      expect(after.map((b) => b.id)).not.toContain(board2Id);
      // board1 (still live) remains listed.
      expect(after.map((b) => b.id)).toContain(board1Id);

      const archived = await getArchivedBoards();
      expect(archived.map((b) => b.id)).toContain(board2Id);
      expect(archived.map((b) => b.id)).not.toContain(board1Id);
    }, 30_000);

    it("purging an archived item deletes the row and frees its attachment objects", async () => {
      ctx.client = aAnon;
      ctx.userId = aUserId;
      removeAttachmentObjects.mockClear();

      const purgeId = await seedItem({
        boardId: board1Id,
        groupId: defaultGroupId,
        name: "to-purge",
        position: 400,
      });

      const storagePath = `${orgAId}/${board1Id}/${randomUUID()}.txt`;
      const { error: attErr } = await aAnon.from("attachments").insert({
        org_id: orgAId,
        board_id: board1Id,
        item_id: purgeId,
        file_name: "note.txt",
        mime_type: "text/plain",
        size_bytes: 12,
        storage_path: storagePath,
        uploaded_by: aUserId,
      });
      expect(attErr, "insert attachment").toBeNull();

      // Purge is Trash-only: the row must be archived first.
      const { error: archErr } = await aAnon.rpc("archive_item", {
        p_item_id: purgeId,
      });
      expect(archErr, "archive before purge").toBeNull();

      const res = await purgeItem({ itemId: purgeId });
      expect(res.ok, "purgeItem ok").toBe(true);

      // Row is gone from the table.
      const { data: row } = await aAnon
        .from("items")
        .select("id")
        .eq("id", purgeId)
        .maybeSingle();
      expect(row).toBeNull();

      // Storage cleanup was invoked with the archived item's object path.
      expect(removeAttachmentObjects).toHaveBeenCalledTimes(1);
      expect(removeAttachmentObjects).toHaveBeenCalledWith([storagePath]);
    }, 30_000);

    it("a user in another org never sees the first org's archived rows", async () => {
      // Point the mocked server client + session at tenant B.
      ctx.client = bAnon;
      ctx.userId = bUserId;

      // Board 1 has archived groups/items from the tests above; B must see none.
      const trash = await getBoardTrash(board1Id);
      expect(trash.groups).toHaveLength(0);
      expect(trash.items).toHaveLength(0);

      // B owns no boards → no archived boards either (and never board2).
      const archived = await getArchivedBoards();
      expect(archived.map((b) => b.id)).not.toContain(board2Id);
      expect(archived).toHaveLength(0);
    }, 30_000);
  },
);
