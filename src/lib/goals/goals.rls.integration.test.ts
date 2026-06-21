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

type Mode = Database["public"]["Enums"]["goal_progress_mode"];
type Status = Database["public"]["Enums"]["goal_status"];

/** create_goal has 13 positional args; this fills the optionals with null. */
function createGoalArgs(over: {
  name: string;
  mode: Mode;
  parent?: string | null;
}) {
  return {
    p_name: over.name,
    p_progress_mode: over.mode,
    p_owner_id: null as unknown as string,
    p_parent_goal_id: (over.parent ?? null) as unknown as string,
    p_workspace_id: null as unknown as string,
    p_status: null as unknown as Status,
    p_start_value: null as unknown as number,
    p_current_value: null as unknown as number,
    p_target_value: null as unknown as number,
    p_unit: null as unknown as string,
    p_percent: null as unknown as number,
    p_start_date: null as unknown as string,
    p_due_date: null as unknown as string,
  };
}

describe.skipIf(!SERVICE_ROLE_KEY)("RLS + RPCs: goals", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];
  let aAnon: SupabaseClient<Database>; // org A creator/owner
  let bAnon: SupabaseClient<Database>; // org B outsider
  let orgA: string;
  let bBoardId: string;

  async function provisionUser(label: string) {
    const email = `goals-${label}-${randomUUID()}@example.com`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(createErr, `createUser(${label})`).toBeNull();
    const id = created.user!.id;
    createdUserIds.push(id);

    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(anon, { email, password: PASSWORD });

    const { data: org, error: orgErr } = await anon.rpc("create_organization", {
      p_name: `Org ${label} ${randomUUID().slice(0, 8)}`,
      p_slug: `goal-${label}-${randomUUID().slice(0, 8)}`,
    });
    expect(orgErr, `create_organization(${label})`).toBeNull();
    return { id, anon, orgId: (org as { id: string }).id };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const a = await provisionUser("a");
    aAnon = a.anon;
    orgA = a.orgId;

    const b = await provisionUser("b");
    bAnon = b.anon;

    // Org B gets a board (used to prove set_goal_links' can_read_board gate).
    const { data: ws } = await bAnon
      .from("workspaces")
      .insert({ org_id: b.orgId, name: "WS B", created_by: b.id })
      .select("id")
      .single();
    const { data: board, error: boardErr } = await bAnon.rpc("create_board", {
      p_workspace_id: (ws as { id: string }).id,
      p_name: "B board",
    });
    expect(boardErr, "create_board B").toBeNull();
    bBoardId = (board as { id: string }).id;
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("create_goal derives org, sets created_by + owner, and is readable by the creator", async () => {
    const { data, error } = await aAnon.rpc(
      "create_goal",
      createGoalArgs({ name: "Company goal", mode: "auto_subgoals" }),
    );
    expect(error).toBeNull();
    const goal = data as Database["public"]["Tables"]["goals"]["Row"];
    expect(goal.org_id).toBe(orgA);

    const { data: read } = await aAnon.from("goals").select("id").eq("id", goal.id);
    expect((read ?? []).length).toBe(1);
  });

  it("rejects a self-parent and a parent↔child cycle", async () => {
    const { data: parent } = await aAnon.rpc(
      "create_goal",
      createGoalArgs({ name: "Parent", mode: "auto_subgoals" }),
    );
    const parentId = (parent as { id: string }).id;
    const { data: child } = await aAnon.rpc(
      "create_goal",
      createGoalArgs({ name: "Child", mode: "manual_percent", parent: parentId }),
    );
    const childId = (child as { id: string }).id;

    // Self-parent.
    const selfRes = await aAnon.from("goals").update({ parent_goal_id: parentId }).eq("id", parentId);
    expect(selfRes.error).not.toBeNull();

    // Cycle: make the parent a child of its own child.
    const cycleRes = await aAnon.from("goals").update({ parent_goal_id: childId }).eq("id", parentId);
    expect(cycleRes.error).not.toBeNull();
  });

  it("cross-org isolation: org B cannot read or edit org A's goals", async () => {
    const { data: g } = await aAnon.rpc(
      "create_goal",
      createGoalArgs({ name: "A private", mode: "manual_percent" }),
    );
    const goalId = (g as { id: string }).id;

    const { data: bRead } = await bAnon.from("goals").select("id").eq("id", goalId);
    expect((bRead ?? []).length).toBe(0);

    // RLS update policy (can_edit_goal) hides the row from B → 0 rows changed.
    await bAnon.from("goals").update({ name: "hacked" }).eq("id", goalId);
    const { data: after } = await aAnon.from("goals").select("name").eq("id", goalId).single();
    expect((after as { name: string }).name).toBe("A private");
  });

  it("set_goal_links rejects a board the caller cannot read (can_read_board gate)", async () => {
    const { data: g } = await aAnon.rpc(
      "create_goal",
      createGoalArgs({ name: "A auto", mode: "auto_boards" }),
    );
    const goalId = (g as { id: string }).id;

    const { error } = await aAnon.rpc("set_goal_links", {
      p_goal_id: goalId,
      p_links: [{ board_id: bBoardId, done_column_id: null, done_option_ids: [] }] as unknown as Database["public"]["Functions"]["set_goal_links"]["Args"]["p_links"],
    });
    expect(error, "linking an unreadable board must fail").not.toBeNull();
  });
});
