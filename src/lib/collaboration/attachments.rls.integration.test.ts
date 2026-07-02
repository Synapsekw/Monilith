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
const BUCKET = "attachments";

type U = {
  id: string;
  orgId: string;
  boardId: string;
  itemId: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!integrationTargetReady())("RLS: attachments + storage", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  let userA: U; // owner of org A
  let userB: U; // owner of a separate org B
  let memberAnon: SupabaseClient<Database>; // non-admin member of org A
  let seededPath: string; // an object userA uploaded under org A
  let seededRowId: string; // its metadata row

  function pathFor(u: U, name: string): string {
    return `${u.orgId}/${u.boardId}/${u.itemId}/${randomUUID()}-${name}`;
  }

  async function provision(label: string): Promise<U> {
    const email = `rls-att-${randomUUID()}@example.com`;
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    const id = created.user!.id;
    createdUserIds.push(id);

    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(anon, { email, password: PASSWORD });

    const { data: org, error: orgErr } = await anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: `att-${label}-${randomUUID().slice(0, 8)}`,
    });
    if (orgErr || !org)
      throw new Error(`create_organization failed: ${orgErr?.message}`);
    const orgId = (org as { id: string }).id;

    const { data: ws } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
      .select("id")
      .single();

    const { data: board } = await anon.rpc("create_board", {
      p_workspace_id: (ws as { id: string }).id,
      p_name: `Board ${label}`,
    });
    const boardId = (board as { id: string }).id;

    const { data: group } = await anon
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .limit(1)
      .single();

    const { data: item } = await anon.rpc("create_item", {
      p_group_id: (group as { id: string }).id,
      p_name: "Item",
    });

    return { id, orgId, boardId, itemId: (item as { id: string }).id, anon };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    userA = await provision("a");
    userB = await provision("b");

    // A non-admin member of org A (role 'member').
    const memberEmail = `rls-att-member-${randomUUID()}@example.com`;
    const { data: m } = await admin.auth.admin.createUser({
      email: memberEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    createdUserIds.push(m.user!.id);
    await admin
      .from("org_members")
      .insert({ org_id: userA.orgId, user_id: m.user!.id, role: "member" });
    memberAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(memberAnon, {
      email: memberEmail,
      password: PASSWORD,
    });

    // userA uploads an object under org A and registers its metadata row.
    seededPath = pathFor(userA, "seed.txt");
    const { error: upErr } = await userA.anon.storage
      .from(BUCKET)
      .upload(seededPath, new Blob(["seed"], { type: "text/plain" }));
    expect(upErr).toBeNull();

    const { data: row, error: rowErr } = await userA.anon
      .from("attachments")
      .insert({
        org_id: userA.orgId,
        board_id: userA.boardId,
        item_id: userA.itemId,
        uploaded_by: userA.id,
        storage_path: seededPath,
        file_name: "seed.txt",
        mime_type: "text/plain",
        size_bytes: 4,
      })
      .select("id")
      .single();
    expect(rowErr).toBeNull();
    seededRowId = (row as { id: string }).id;
  }, 60_000);

  afterAll(async () => {
    // Best-effort object cleanup, then delete the provisioned users.
    await admin.storage
      .from(BUCKET)
      .remove([seededPath])
      .catch(() => {});
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("the uploader (org member) can read the row and sign the object", async () => {
    const { data: rows } = await userA.anon
      .from("attachments")
      .select("id")
      .eq("id", seededRowId);
    expect(rows?.length).toBe(1);

    const { data: signed, error } = await userA.anon.storage
      .from(BUCKET)
      .createSignedUrl(seededPath, 60);
    expect(error).toBeNull();
    expect(signed?.signedUrl).toBeTruthy();
  });

  it("a different org cannot read the row or sign the object (cross-tenant)", async () => {
    const { data: rows } = await userB.anon
      .from("attachments")
      .select("id")
      .eq("id", seededRowId);
    expect(rows ?? []).toHaveLength(0);

    const { data: signed, error } = await userB.anon.storage
      .from(BUCKET)
      .createSignedUrl(seededPath, 60);
    // Either an explicit error or no signed URL — never a usable link.
    expect(error !== null || !signed?.signedUrl).toBe(true);
  });

  it("a different org cannot upload into another org's path (storage insert RLS)", async () => {
    const crossPath = pathFor(userA, "evil.txt"); // leading segment = org A
    const { error } = await userB.anon.storage
      .from(BUCKET)
      .upload(crossPath, new Blob(["x"]));
    expect(error).not.toBeNull();
  });

  it("registers a column-scoped attachment under a files column with a nested path", async () => {
    // Seed a Files column on org A's board.
    const { data: col, error: colErr } = await userA.anon
      .from("columns")
      .insert({
        org_id: userA.orgId,
        board_id: userA.boardId,
        kind: "files",
        name: "Files",
        settings: {},
        position: 50,
      })
      .select("id")
      .single();
    expect(colErr).toBeNull();
    const columnId = (col as { id: string }).id;

    // A column-scoped path nests the column id after the item segment.
    const colPath = `${userA.orgId}/${userA.boardId}/${userA.itemId}/${columnId}/${randomUUID()}-cell.txt`;
    const { error: upErr } = await userA.anon.storage
      .from(BUCKET)
      .upload(colPath, new Blob(["cell"], { type: "text/plain" }));
    expect(upErr).toBeNull();

    const { data: row, error: rowErr } = await userA.anon
      .from("attachments")
      .insert({
        org_id: userA.orgId,
        board_id: userA.boardId,
        item_id: userA.itemId,
        column_id: columnId,
        uploaded_by: userA.id,
        storage_path: colPath,
        file_name: "cell.txt",
        mime_type: "text/plain",
        size_bytes: 4,
      })
      .select("id, column_id")
      .single();
    expect(rowErr).toBeNull();
    expect((row as { column_id: string }).column_id).toBe(columnId);

    await admin.storage
      .from(BUCKET)
      .remove([colPath])
      .catch(() => {});
  });

  it("a different org cannot upload into another org's column-scoped path", async () => {
    // Leading segment is org A → storage insert RLS denies userB.
    const foreignColPath = `${userA.orgId}/${userA.boardId}/${userA.itemId}/${randomUUID()}/evil.txt`;
    const { error } = await userB.anon.storage
      .from(BUCKET)
      .upload(foreignColPath, new Blob(["x"]));
    expect(error).not.toBeNull();
  });

  it("a non-uploader, non-admin member cannot delete the uploader's row", async () => {
    const { error } = await memberAnon
      .from("attachments")
      .delete()
      .eq("id", seededRowId);
    // RLS makes the row invisible to this member's delete — no rows affected.
    // (Supabase returns no error; the guarantee is the row survives.)
    expect(error).toBeNull();

    const { data: still } = await admin
      .from("attachments")
      .select("id")
      .eq("id", seededRowId);
    expect(still?.length).toBe(1);
  });
});
