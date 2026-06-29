import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database, Json } from "@/types/database.types";
import { buildTemplatePayload } from "@/lib/boards/template-payload";
import { getTemplate } from "@/lib/boards/templates";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!integrationTargetReady())(
  "RLS: create_board_from_template",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let anonA: SupabaseClient<Database>;
    let workspaceA: string;
    let anonB: SupabaseClient<Database>; // a different org

    async function provision(label: string) {
      const email = `rls-tmpl-${randomUUID()}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
        });
      if (createErr || !created.user)
        throw new Error(`createUser(${label}): ${createErr?.message}`);
      const id = created.user.id;
      createdUserIds.push(id);
      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });
      const { data: org, error: orgErr } = await anon.rpc(
        "create_organization",
        {
          p_name: `Org ${label}`,
          p_slug: `rls-t-${label.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        },
      );
      if (orgErr || !org)
        throw new Error(`create_organization(${label}): ${orgErr?.message}`);
      const orgId = (org as { id: string }).id;
      const { data: ws, error: wsErr } = await anon
        .from("workspaces")
        .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
        .select("id")
        .single();
      if (wsErr || !ws)
        throw new Error(`insert workspace(${label}): ${wsErr?.message}`);
      return { anon, workspaceId: (ws as { id: string }).id };
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const a = await provision("A");
      anonA = a.anon;
      workspaceA = a.workspaceId;
      const b = await provision("B");
      anonB = b.anon;
    }, 60_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("a member seeds a full board (groups, columns, items, cells, view)", async () => {
      const payload = buildTemplatePayload(getTemplate("sprints")!);
      const { data: board, error } = await anonA.rpc(
        "create_board_from_template",
        {
          p_workspace_id: workspaceA,
          p_name: "Sprint board",
          p_template: payload as unknown as Json,
        },
      );
      expect(error).toBeNull();
      const boardId = (board as { id: string }).id;

      const { count: groups } = await anonA
        .from("groups")
        .select("*", { count: "exact", head: true })
        .eq("board_id", boardId);
      expect(groups).toBe(3);

      const { count: columns } = await anonA
        .from("columns")
        .select("*", { count: "exact", head: true })
        .eq("board_id", boardId);
      expect(columns).toBe(5);

      const { count: items } = await anonA
        .from("items")
        .select("*", { count: "exact", head: true })
        .eq("board_id", boardId);
      expect(items).toBe(4);

      const { count: cells } = await anonA
        .from("cell_values")
        .select("*", { count: "exact", head: true })
        .eq("board_id", boardId);
      // sprints seeds 4+4+3+3 = 14 cells across its four items.
      expect(cells).toBe(14);

      const { data: views } = await anonA
        .from("board_views")
        .select("kind,name")
        .eq("board_id", boardId);
      expect(views).toEqual([{ kind: "table", name: "Main Table" }]);
    });

    it("a non-member is denied (42501) on another org's workspace", async () => {
      const payload = buildTemplatePayload(getTemplate("blank")!);
      const { error } = await anonB.rpc("create_board_from_template", {
        p_workspace_id: workspaceA,
        p_name: "Sneaky",
        p_template: payload as unknown as Json,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });
  },
);
