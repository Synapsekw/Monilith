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

type TestUser = {
  id: string;
  orgId: string;
  workspaceId: string;
  boardId: string;
  groupId: string;
  statusColumnId: string;
  anon: SupabaseClient<Database>;
};

// import_rows_into_board RPC semantics + cross-org rejection (opt-in live-DB
// suite, decision-25: skips cleanly unless a marked test target is
// configured). This test is authored ahead of the migration + `pnpm
// db:types` regen (Task 13 steps 1-2), so every `.rpc("import_rows_into_
// board", ...)` call below goes through an `any` cast — the generated
// Database["public"]["Functions"] map doesn't know this RPC yet. Safe (and
// preferable) to drop the cast once Step 4 (type regen) lands.
describe.skipIf(!integrationTargetReady())("import_rows_into_board RPC", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];
  let userA: TestUser;
  let userB: TestUser;

  async function provisionUser(label: string): Promise<TestUser> {
    const email = `import-rows-${randomUUID()}@example.com`;
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(error, `createUser(${label})`).toBeNull();
    const id = created.user!.id;
    createdUserIds.push(id);

    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(anon, { email, password: PASSWORD });

    const { data: org } = await anon.rpc("create_organization", {
      p_name: `Import Org ${label}`,
      p_slug: `import-rows-${label.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    });
    const orgId = (org as { id: string }).id;

    const { data: ws } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
      .select("id")
      .single();
    const workspaceId = (ws as { id: string }).id;

    const { data: board } = await anon.rpc("create_board", {
      p_workspace_id: workspaceId,
      p_name: `Board ${label}`,
    });
    const boardId = (board as { id: string }).id;

    const { data: group } = await anon
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .limit(1)
      .single();
    const groupId = (group as { id: string }).id;

    const { data: statusCol } = await anon
      .from("columns")
      .select("id")
      .eq("board_id", boardId)
      .eq("kind", "status")
      .single();
    const statusColumnId = (statusCol as { id: string }).id;

    return { id, orgId, workspaceId, boardId, groupId, statusColumnId, anon };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    userA = await provisionUser("A");
    userB = await provisionUser("B");
  }, 120_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("appends a column, item + subitem, cells, and status options in one call", async () => {
    const newColumnId = randomUUID();
    const newItemId = randomUUID();
    const newSubitemId = randomUUID();
    const newOptionId = randomUUID();

    const payload = {
      groupId: userA.groupId,
      newColumns: [
        {
          id: newColumnId,
          kind: "text",
          name: "Notes",
          settings: {},
          position: 0,
        },
      ],
      optionAdditions: [
        {
          columnId: userA.statusColumnId,
          options: [{ id: newOptionId, label: "Blocked", color: "#e2445c" }],
        },
      ],
      items: [
        {
          id: newItemId,
          name: "Imported Item",
          position: 0,
          cells: [{ columnId: newColumnId, value: { text: "hello" } }],
        },
      ],
      subitems: [
        {
          id: newSubitemId,
          parentId: newItemId,
          name: "Imported Subitem",
          position: 0,
          cells: [],
        },
      ],
    };

    const { error } = await (
      userA.anon as unknown as {
        rpc: (
          fn: string,
          args: unknown,
        ) => Promise<{ error: { code?: string; message: string } | null }>;
      }
    ).rpc("import_rows_into_board", {
      p_board_id: userA.boardId,
      p_payload: payload,
    });
    expect(error).toBeNull();

    const { data: item } = await userA.anon
      .from("items")
      .select("id, name, group_id, parent_id")
      .eq("id", newItemId)
      .single();
    expect(item).toMatchObject({
      name: "Imported Item",
      group_id: userA.groupId,
      parent_id: null,
    });

    const { data: sub } = await userA.anon
      .from("items")
      .select("id, name, parent_id, group_id")
      .eq("id", newSubitemId)
      .single();
    expect(sub).toMatchObject({
      name: "Imported Subitem",
      parent_id: newItemId,
      group_id: userA.groupId,
    });

    const { data: cell } = await userA.anon
      .from("cell_values")
      .select("value")
      .eq("item_id", newItemId)
      .eq("column_id", newColumnId)
      .single();
    expect(cell).toMatchObject({ value: { text: "hello" } });

    const { data: col } = await userA.anon
      .from("columns")
      .select("settings")
      .eq("id", userA.statusColumnId)
      .single();
    const options = (
      col as unknown as {
        settings: { options: { id: string; label: string }[] };
      }
    ).settings.options;
    // The three seeded options (Working on it / Stuck / Done) survive the
    // merge, plus the newly-appended "Blocked" option.
    expect(options).toHaveLength(4);
    expect(
      options.some((o) => o.id === newOptionId && o.label === "Blocked"),
    ).toBe(true);
  });

  it("denies an org member with only a viewer grant on the board (42501)", async () => {
    // Provision user C inside userA's org: an org member shared into
    // userA's board as VIEWER. Org membership alone must not grant append
    // rights — the RPC's can_edit_board guard has to reject the call.
    const email = `import-rows-${randomUUID()}@example.com`;
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
    expect(createErr, "createUser(viewer)").toBeNull();
    const viewerId = created.user!.id;
    createdUserIds.push(viewerId);

    const viewerAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(viewerAnon, { email, password: PASSWORD });

    const { error: memberErr } = await admin.from("org_members").insert({
      org_id: userA.orgId,
      user_id: viewerId,
      role: "member",
    });
    expect(memberErr, "org_members insert").toBeNull();

    // The board owner (userA) grants viewer-level board access.
    const { error: shareErr } = await userA.anon.from("board_members").insert({
      board_id: userA.boardId,
      org_id: userA.orgId,
      user_id: viewerId,
      access_level: "viewer",
      granted_by: userA.id,
    });
    expect(shareErr, "share board with viewer").toBeNull();

    const { error } = await (
      viewerAnon as unknown as {
        rpc: (
          fn: string,
          args: unknown,
        ) => Promise<{ error: { code?: string; message: string } | null }>;
      }
    ).rpc("import_rows_into_board", {
      p_board_id: userA.boardId,
      p_payload: { groupId: userA.groupId, items: [] },
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  }, 60_000);

  it("denies a caller from a different org (42501)", async () => {
    const { error } = await (
      userB.anon as unknown as {
        rpc: (
          fn: string,
          args: unknown,
        ) => Promise<{ error: { code?: string; message: string } | null }>;
      }
    ).rpc("import_rows_into_board", {
      p_board_id: userA.boardId,
      p_payload: { groupId: userA.groupId, items: [] },
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});
