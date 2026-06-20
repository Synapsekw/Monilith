import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!SERVICE_ROLE_KEY)("RLS: notifications", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  async function makeUser(): Promise<{
    id: string;
    anon: SupabaseClient<Database>;
  }> {
    const email = `rls-notif-${randomUUID()}@example.com`;
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
    return { id, anon };
  }

  // Org A owned by A, with an item; user B is added as a member of org A.
  let A: { id: string; anon: SupabaseClient<Database> };
  let B: { id: string; anon: SupabaseClient<Database> };
  let C: { id: string; anon: SupabaseClient<Database> };
  let orgId: string;
  let boardId: string;
  let itemId: string;

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    A = await makeUser();
    B = await makeUser();
    C = await makeUser();

    const { data: org } = await A.anon.rpc("create_organization", {
      p_name: "Org A",
      p_slug: `notif-a-${randomUUID().slice(0, 8)}`,
    });
    orgId = (org as { id: string }).id;
    // Add B to org A directly (service role) so mentions can be delivered.
    await admin
      .from("org_members")
      .insert({ org_id: orgId, user_id: B.id, role: "member" });

    const { data: ws } = await A.anon
      .from("workspaces")
      .insert({ org_id: orgId, name: "WS", created_by: A.id })
      .select("id")
      .single();
    const { data: board } = await A.anon.rpc("create_board", {
      p_workspace_id: (ws as { id: string }).id,
      p_name: "Board",
    });
    boardId = (board as { id: string }).id;
    const { data: group } = await A.anon
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .limit(1)
      .single();
    const { data: item } = await A.anon.rpc("create_item", {
      p_group_id: (group as { id: string }).id,
      p_name: "Item",
    });
    itemId = (item as { id: string }).id;
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  async function insertMention() {
    // No .select() — the recipient-gated SELECT policy hides the row from the
    // actor, so a returning read would always be empty even on success.
    return A.anon.from("notifications").insert({
      org_id: orgId,
      recipient_id: B.id,
      actor_id: A.id,
      kind: "mention",
      board_id: boardId,
      item_id: itemId,
    });
  }

  it("a member can insert a notification for a co-member as themselves", async () => {
    const { error } = await insertMention();
    expect(error).toBeNull();
  });

  it("the recipient sees it; the actor does not", async () => {
    const { data: bSees } = await B.anon
      .from("notifications")
      .select("id")
      .eq("item_id", itemId);
    expect((bSees ?? []).length).toBeGreaterThan(0);
    const { data: aSees } = await A.anon
      .from("notifications")
      .select("id")
      .eq("item_id", itemId);
    expect(aSees ?? []).toHaveLength(0);
  });

  it("forbids inserting as a different actor", async () => {
    const { error } = await A.anon.from("notifications").insert({
      org_id: orgId,
      recipient_id: B.id,
      actor_id: B.id, // not auth.uid() → RLS rejects
      kind: "mention",
      board_id: boardId,
      item_id: itemId,
    });
    expect(error).not.toBeNull();
  });

  it("forbids notifying a recipient who is not a member of the org", async () => {
    // C is a real user but not a member of org A → insert must be rejected.
    const { error } = await A.anon.from("notifications").insert({
      org_id: orgId,
      recipient_id: C.id,
      actor_id: A.id,
      kind: "mention",
      board_id: boardId,
      item_id: itemId,
    });
    expect(error).not.toBeNull();
  });

  it("forbids inserting into an org you don't belong to", async () => {
    const { error } = await C.anon.from("notifications").insert({
      org_id: orgId, // C is not a member of org A
      recipient_id: C.id,
      actor_id: C.id,
      kind: "mention",
      board_id: boardId,
      item_id: itemId,
    });
    expect(error).not.toBeNull();
  });

  it("the recipient can mark their notification read; a non-recipient cannot", async () => {
    const { data: row } = await B.anon
      .from("notifications")
      .select("id")
      .eq("item_id", itemId)
      .limit(1)
      .single();
    const nid = (row as { id: string }).id;

    // A (the actor, not recipient) update affects 0 rows (RLS hides it).
    await A.anon
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", nid);
    const { data: stillUnread } = await B.anon
      .from("notifications")
      .select("read_at")
      .eq("id", nid)
      .single();
    expect((stillUnread as { read_at: string | null }).read_at).toBeNull();

    // B (the recipient) can.
    await B.anon
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", nid);
    const { data: read } = await B.anon
      .from("notifications")
      .select("read_at")
      .eq("id", nid)
      .single();
    expect((read as { read_at: string | null }).read_at).not.toBeNull();
  });

  it("a member can fan out an assigned notification visible to the recipient", async () => {
    await A.anon.from("notifications").insert({
      org_id: orgId,
      recipient_id: B.id,
      actor_id: A.id,
      kind: "assigned",
      board_id: boardId,
      item_id: itemId,
    });
    const { data } = await B.anon
      .from("notifications")
      .select("kind")
      .eq("item_id", itemId);
    expect((data ?? []).some((r) => r.kind === "assigned")).toBe(true);
  });
});
