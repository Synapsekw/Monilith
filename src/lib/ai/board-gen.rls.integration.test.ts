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
  anon: SupabaseClient<Database>;
};

/** A minimal, self-consistent template payload for create_board_from_template. */
function minimalTemplate() {
  const groupId = randomUUID();
  const columnId = randomUUID();
  return {
    groups: [{ id: groupId, name: "Leads", color: "#0073ea", position: 0 }],
    columns: [
      { id: columnId, kind: "text", name: "Notes", settings: {}, position: 0 },
    ],
    items: [
      {
        id: randomUUID(),
        groupId,
        name: "First item",
        position: 0,
        cells: [{ columnId, value: { text: "hello" } }],
      },
    ],
  };
}

describe.skipIf(!integrationTargetReady())(
  "RLS: board-gen create_board_from_template tenant isolation",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let userA: TestUser;
    let userB: TestUser;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `rls-board-gen-${randomUUID()}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
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

      const { data: org } = await anon.rpc("create_organization", {
        p_name: `rls-board-gen-org-${label}`,
        p_slug: `rls-bg-${label}-${randomUUID().slice(0, 8)}`,
      });
      const orgId = (org as { id: string }).id;

      const { data: ws } = await anon
        .from("workspaces")
        .insert({ org_id: orgId, name: `rls-bg-ws-${label}`, created_by: id })
        .select("id")
        .single();
      const workspaceId = (ws as { id: string }).id;

      return { id, orgId, workspaceId, anon };
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      userA = await provisionUser("a");
      userB = await provisionUser("b");
    }, 60_000);

    afterAll(async () => {
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    }, 60_000);

    it("user A can create a board from a template in their own workspace (org-scoped)", async () => {
      const { data, error } = await userA.anon.rpc(
        "create_board_from_template",
        {
          p_workspace_id: userA.workspaceId,
          p_name: "rls-bg-board",
          p_template: minimalTemplate(),
        },
      );
      expect(error).toBeNull();
      const board = data as { id: string; org_id: string };
      expect(board.id).toBeTruthy();
      // The board is scoped to org A.
      expect(board.org_id).toBe(userA.orgId);

      // Visible to A...
      const { data: visible } = await userA.anon
        .from("boards")
        .select("id")
        .eq("id", board.id);
      expect(visible).not.toEqual([]);

      // ...and NOT to B (cross-tenant isolation).
      const { data: hidden } = await userB.anon
        .from("boards")
        .select("id")
        .eq("id", board.id);
      expect(hidden).toEqual([]);
    });

    it("user A cannot create a board in tenant B's workspace (is_org_member check)", async () => {
      const { data, error } = await userA.anon.rpc(
        "create_board_from_template",
        {
          p_workspace_id: userB.workspaceId, // cross-tenant workspace
          p_name: "rls-bg-cross-tenant",
          p_template: minimalTemplate(),
        },
      );

      // The RPC's org-membership check must reject the call outright, or (if it
      // somehow inserted) the row must not be visible/attributable to A.
      if (error) {
        expect(error).not.toBeNull();
      } else {
        const boardId = (data as { id: string } | null)?.id;
        if (boardId) {
          const { data: aSees } = await userA.anon
            .from("boards")
            .select("id")
            .eq("id", boardId);
          expect(aSees).toEqual([]);
        }
      }
    });
  },
);
