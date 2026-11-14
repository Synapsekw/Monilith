import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { signInWithRetry } from "@/test/integration-auth";

loadIntegrationEnv();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!integrationTargetReady())("cross-board dependencies", () => {
  const admin = createClient<Database>(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  // owner creates org, workspace, boards A + B, folder F (A, B inside), board C (outside F)
  // viewer: org member with viewer grant on A only
  // editorB: org member with editor grant on B, viewer on A
  let owner: Awaited<ReturnType<typeof provision>>;
  let viewer: Awaited<ReturnType<typeof provision>>;
  let editorB: Awaited<ReturnType<typeof provision>>;
  let orgId = "",
    folderId = "",
    boardA = "",
    boardB = "",
    boardC = "";
  let itemA1 = "",
    itemB1 = "",
    itemC1 = "";

  async function provision(label: string) {
    const email = `xbd-${label}-${randomUUID()}@example.com`;
    const { data: created } = await admin.auth.admin.createUser({
      app_metadata: { pre_approved: true },
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    createdUserIds.push(created.user!.id);
    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(anon, { email, password: PASSWORD });
    return { anon, userId: created.user!.id };
  }

  async function addItem(boardId: string, name: string) {
    const { data: g } = await admin
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .limit(1)
      .single();
    const { data: item } = await admin
      .from("items")
      .insert({
        board_id: boardId,
        org_id: orgId,
        group_id: g!.id,
        name,
        created_by: owner.userId,
      })
      .select("id")
      .single();
    return item!.id as string;
  }

  beforeAll(async () => {
    owner = await provision("owner");
    viewer = await provision("viewer");
    editorB = await provision("editorb");
    const { data: org } = await owner.anon.rpc("create_organization", {
      p_name: "XBD",
      p_slug: `xbd-${randomUUID().slice(0, 8)}`,
    });
    orgId = (org as { id: string }).id;
    const { data: ws } = await owner.anon
      .from("workspaces")
      .insert({ org_id: orgId, name: "W", created_by: owner.userId })
      .select("id")
      .single();
    const mk = async (name: string) =>
      (
        (
          await owner.anon.rpc("create_board", {
            p_workspace_id: ws!.id,
            p_name: name,
          })
        ).data as { id: string }
      ).id;
    boardA = await mk("A");
    boardB = await mk("B");
    boardC = await mk("C");
    const { data: f } = await owner.anon
      .from("folders")
      .insert({
        org_id: orgId,
        workspace_id: ws!.id,
        name: "F",
        created_by: owner.userId,
      })
      .select("id")
      .single();
    folderId = f!.id;
    await owner.anon.from("folder_boards").insert([
      { folder_id: folderId, board_id: boardA },
      { folder_id: folderId, board_id: boardB },
    ]);
    for (const u of [viewer, editorB]) {
      await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: u.userId, role: "member" });
    }
    await admin.from("board_members").insert([
      {
        org_id: orgId,
        board_id: boardA,
        user_id: viewer.userId,
        access_level: "viewer",
        granted_by: owner.userId,
      },
      {
        org_id: orgId,
        board_id: boardA,
        user_id: editorB.userId,
        access_level: "viewer",
        granted_by: owner.userId,
      },
      {
        org_id: orgId,
        board_id: boardB,
        user_id: editorB.userId,
        access_level: "editor",
        granted_by: owner.userId,
      },
    ]);
    itemA1 = await addItem(boardA, "A1");
    itemB1 = await addItem(boardB, "B1");
    itemC1 = await addItem(boardC, "C1");
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("owner links A1 -> B1 across boards; row stores successor board + predecessor board", async () => {
    const { data, error } = await owner.anon.rpc("create_item_dependency", {
      p_predecessor: itemA1,
      p_successor: itemB1,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      board_id: boardB,
      predecessor_board_id: boardA,
    });
  });

  it("rejects a cycle across boards", async () => {
    const { error } = await owner.anon.rpc("create_item_dependency", {
      p_predecessor: itemB1,
      p_successor: itemA1,
    });
    expect(error?.message).toMatch(/cycle/);
  });

  it("editor of successor board + reader of predecessor board can create", async () => {
    const itemB2 = await addItem(boardB, "B2");
    const { error } = await editorB.anon.rpc("create_item_dependency", {
      p_predecessor: itemA1,
      p_successor: itemB2,
    });
    expect(error).toBeNull();
  });

  it("cannot create when only a reader of the successor board", async () => {
    const itemA2 = await addItem(boardA, "A2");
    const { error } = await editorB.anon.rpc("create_item_dependency", {
      p_predecessor: itemB1,
      p_successor: itemA2,
    });
    expect(error?.message).toMatch(/edit access/);
  });

  it("cannot create when the predecessor board is unreadable", async () => {
    const itemB3 = await addItem(boardB, "B3");
    const { error } = await editorB.anon.rpc("create_item_dependency", {
      p_predecessor: itemC1,
      p_successor: itemB3,
    });
    expect(error?.message).toMatch(/not found/);
  });

  it("hides links whose other end is unreadable", async () => {
    const { data } = await viewer.anon
      .from("item_dependencies")
      .select("id")
      .eq("predecessor_id", itemA1);
    expect(data).toEqual([]); // viewer cannot read B
  });

  it("folder_timeline returns both folder boards, items, and the link", async () => {
    const { data, error } = await owner.anon.rpc("folder_timeline", {
      p_folder_id: folderId,
    });
    expect(error).toBeNull();
    const j = data as {
      board_order: string[];
      items: { id: string }[];
      dependencies: { predecessor_id: string }[];
      truncated: boolean;
    };
    expect(j.board_order).toEqual(expect.arrayContaining([boardA, boardB]));
    expect(j.items.map((i) => i.id)).toEqual(
      expect.arrayContaining([itemA1, itemB1]),
    );
    expect(j.dependencies.some((d) => d.predecessor_id === itemA1)).toBe(true);
    expect(j.truncated).toBe(false);
  });

  it("board_dependency_context returns the foreign end only", async () => {
    const { data } = await owner.anon.rpc("board_dependency_context", {
      p_board_id: boardB,
    });
    const j = data as { items: { id: string }[]; boards: { id: string }[] };
    expect(j.items.map((i) => i.id)).toEqual([itemA1]);
    expect(j.boards.map((b) => b.id)).toEqual([boardA]);
  });

  it("delete allowed from the successor-board editor", async () => {
    const { data: dep } = await owner.anon
      .from("item_dependencies")
      .select("id")
      .eq("predecessor_id", itemA1)
      .eq("successor_id", itemB1)
      .single();
    const { error } = await editorB.anon
      .from("item_dependencies")
      .delete()
      .eq("id", dep!.id);
    expect(error).toBeNull();
    const { data: left } = await owner.anon
      .from("item_dependencies")
      .select("id")
      .eq("id", dep!.id);
    expect(left).toEqual([]);
  });

  it("delete allowed from the predecessor-board editor", async () => {
    const itemA3 = await addItem(boardA, "A3");
    const { data: dep, error: createErr } = await owner.anon.rpc(
      "create_item_dependency",
      { p_predecessor: itemB1, p_successor: itemA3 },
    );
    expect(createErr).toBeNull();
    const depId = (dep as { id: string }).id;
    // editorB edits B (the predecessor's board) but only reads A (the successor's board).
    const { error } = await editorB.anon
      .from("item_dependencies")
      .delete()
      .eq("id", depId);
    expect(error).toBeNull();
    const { data: left } = await owner.anon
      .from("item_dependencies")
      .select("id")
      .eq("id", depId);
    expect(left).toEqual([]);
  });

  it("a forged direct insert cannot surface an unreadable predecessor", async () => {
    const itemB4 = await addItem(boardB, "B4");
    // editorB lies that the predecessor (C1, on unreadable board C) lives on readable board A.
    // The bind trigger rewrites predecessor_board_id to C, so RLS WITH CHECK rejects the row.
    const { error } = await editorB.anon.from("item_dependencies").insert({
      org_id: orgId,
      board_id: boardB,
      predecessor_board_id: boardA,
      predecessor_id: itemC1,
      successor_id: itemB4,
    });
    expect(error).not.toBeNull();
    const { data } = await editorB.anon.rpc("board_dependency_context", {
      p_board_id: boardB,
    });
    const j = data as { items: { id: string }[] };
    expect(j.items.map((i) => i.id)).not.toContain(itemC1);
  });

  it("a forged direct insert pointing at another org's item is rejected", async () => {
    const { data: org2 } = await owner.anon.rpc("create_organization", {
      p_name: "XBD2",
      p_slug: `xbd2-${randomUUID().slice(0, 8)}`,
    });
    const org2Id = (org2 as { id: string }).id;
    const { data: ws2 } = await owner.anon
      .from("workspaces")
      .insert({ org_id: org2Id, name: "W2", created_by: owner.userId })
      .select("id")
      .single();
    const { data: board2 } = await owner.anon.rpc("create_board", {
      p_workspace_id: ws2!.id,
      p_name: "Other org",
    });
    const board2Id = (board2 as { id: string }).id;
    const { data: g2 } = await admin
      .from("groups")
      .select("id")
      .eq("board_id", board2Id)
      .limit(1)
      .single();
    const { data: foreign } = await admin
      .from("items")
      .insert({
        board_id: board2Id,
        org_id: org2Id,
        group_id: g2!.id,
        name: "Foreign",
        created_by: owner.userId,
      })
      .select("id")
      .single();
    const foreignId = (foreign as { id: string }).id;
    const itemB5 = await addItem(boardB, "B5");

    const { error: rpcErr } = await owner.anon.rpc("create_item_dependency", {
      p_predecessor: foreignId,
      p_successor: itemB5,
    });
    expect(rpcErr?.message).toMatch(/not found/);

    const { error: insErr } = await owner.anon
      .from("item_dependencies")
      .insert({
        org_id: orgId,
        board_id: boardB,
        predecessor_board_id: boardB,
        predecessor_id: foreignId,
        successor_id: itemB5,
      });
    expect(insErr).not.toBeNull();
  });

  it("links to an archived item drop out of folder_timeline entirely", async () => {
    const itemA6 = await addItem(boardA, "A6");
    const itemB6 = await addItem(boardB, "B6");
    const { error } = await owner.anon.rpc("create_item_dependency", {
      p_predecessor: itemA6,
      p_successor: itemB6,
    });
    expect(error).toBeNull();
    await admin
      .from("items")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", itemA6);
    const { data } = await owner.anon.rpc("folder_timeline", {
      p_folder_id: folderId,
    });
    const j = data as {
      external_item_ids: string[];
      dependencies: { predecessor_id: string }[];
    };
    expect(j.dependencies.some((d) => d.predecessor_id === itemA6)).toBe(false);
    expect(j.external_item_ids).not.toContain(itemA6);
  });
});
