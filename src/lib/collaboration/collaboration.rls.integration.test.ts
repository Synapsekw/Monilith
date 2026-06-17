import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!SERVICE_ROLE_KEY)("RLS: collaboration", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  type U = {
    id: string;
    orgId: string;
    boardId: string;
    itemId: string;
    anon: SupabaseClient<Database>;
  };

  async function provision(label: string): Promise<U> {
    const email = `rls-collab-${randomUUID()}@example.com`;
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
    await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const { data: org } = await anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: `collab-${label}-${randomUUID().slice(0, 8)}`,
    });
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

  let a: U;
  let b: U;
  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    a = await provision("a");
    b = await provision("b");
  });
  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("logs item_created on create_item via trigger", async () => {
    const { data } = await a.anon
      .from("item_activities")
      .select("action")
      .eq("item_id", a.itemId);
    expect(data?.some((r) => r.action === "item_created")).toBe(true);
  });

  it("logs an update_added activity when an update is posted", async () => {
    await a.anon.from("item_updates").insert({
      org_id: a.orgId,
      board_id: a.boardId,
      item_id: a.itemId,
      author_id: a.id,
      body: { text: "hi" },
      body_text: "hi",
    });
    const { data } = await a.anon
      .from("item_activities")
      .select("action")
      .eq("item_id", a.itemId);
    expect(data?.some((r) => r.action === "update_added")).toBe(true);
  });

  it("denies cross-tenant read of another org's updates", async () => {
    const { data } = await b.anon
      .from("item_updates")
      .select("id")
      .eq("item_id", a.itemId);
    expect(data ?? []).toHaveLength(0);
  });

  it("forbids a client INSERT into item_activities", async () => {
    const { error } = await a.anon.from("item_activities").insert({
      org_id: a.orgId,
      board_id: a.boardId,
      item_id: a.itemId,
      action: "cell_changed",
    } as never);
    expect(error).not.toBeNull(); // no insert policy → RLS rejects
  });

  it("forbids deleting another member's-org update", async () => {
    const { data: upd } = await a.anon
      .from("item_updates")
      .select("id")
      .eq("item_id", a.itemId)
      .limit(1)
      .single();
    const { error } = await b.anon
      .from("item_updates")
      .delete()
      .eq("id", (upd as { id: string }).id);
    // RLS hides the row from b → delete affects 0 rows (no error, no effect)
    const { data: still } = await a.anon
      .from("item_updates")
      .select("id")
      .eq("id", (upd as { id: string }).id);
    expect(still ?? []).toHaveLength(1);
    expect(error).toBeNull();
  });

  it("logs item_renamed when the item name changes", async () => {
    await a.anon.from("items").update({ name: "Renamed" }).eq("id", a.itemId);
    const { data } = await a.anon
      .from("item_activities")
      .select("action, old_value, new_value")
      .eq("item_id", a.itemId)
      .eq("action", "item_renamed");
    expect(data?.length ?? 0).toBeGreaterThan(0);
    expect(data?.[0]?.new_value).toBe("Renamed");
  });

  it("logs cell_changed when a cell value is set", async () => {
    const { data: col } = await a.anon
      .from("columns")
      .select("id")
      .eq("board_id", a.boardId)
      .limit(1)
      .single();
    await a.anon.from("cell_values").insert({
      org_id: a.orgId,
      board_id: a.boardId,
      item_id: a.itemId,
      column_id: (col as { id: string }).id,
      value: "hello",
    });
    const { data } = await a.anon
      .from("item_activities")
      .select("action")
      .eq("item_id", a.itemId)
      .eq("action", "cell_changed");
    expect(data?.length ?? 0).toBeGreaterThan(0);
  });

  it("allows deleting an item — the activity trigger does not abort the delete", async () => {
    // Regression guard: an AFTER DELETE `item_deleted` insert referencing the
    // just-deleted item would FK-violate and roll back the delete. The trigger
    // no longer logs deletes, so this must succeed.
    const { data: group } = await a.anon
      .from("groups")
      .select("id")
      .eq("board_id", a.boardId)
      .limit(1)
      .single();
    const { data: tmp } = await a.anon.rpc("create_item", {
      p_group_id: (group as { id: string }).id,
      p_name: "To delete",
    });
    const tmpId = (tmp as { id: string }).id;
    const { error } = await a.anon.from("items").delete().eq("id", tmpId);
    expect(error).toBeNull();
    const { data: gone } = await a.anon
      .from("items")
      .select("id")
      .eq("id", tmpId);
    expect(gone ?? []).toHaveLength(0);
  });
});
