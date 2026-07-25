import { randomUUID } from "node:crypto";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!integrationTargetReady())(
  "item_embed_queue: RLS default-deny + trigger enqueue",
  () => {
    const tag = randomUUID().slice(0, 8);
    let admin: SupabaseClient<Database>; // service role, RLS-bypassing, for setup
    let userA: SupabaseClient<Database>; // org-A member (owns the seeded item)
    let userB: SupabaseClient<Database>; // org-B member — must NOT see org-A rows
    let itemAId: string;
    let boardAId: string;
    let orgAId: string;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    async function provisionUser(label: string) {
      const email = `embqueue-${label}-${randomUUID()}@example.com`;
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
      await signInOrThrow(anon, { email, password: PASSWORD });

      const { data: org, error: orgErr } = await anon.rpc(
        "create_organization",
        {
          p_name: `Org ${label} ${randomUUID().slice(0, 8)}`,
          p_slug: `embqueue-${label}-${randomUUID().slice(0, 8)}`,
        },
      );
      expect(orgErr, `create_organization(${label})`).toBeNull();
      const orgId = (org as { id: string }).id;
      createdOrgIds.push(orgId);
      return { id, anon, orgId };
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const a = await provisionUser("a");
      userA = a.anon;
      orgAId = a.orgId;
      const b = await provisionUser("b");
      userB = b.anon;

      const { data: ws, error: wsErr } = await userA
        .from("workspaces")
        .insert({ org_id: orgAId, name: `WS ${tag}`, created_by: a.id })
        .select("id")
        .single();
      expect(wsErr, "insert workspace").toBeNull();
      const { data: board, error: boardErr } = await userA.rpc("create_board", {
        p_workspace_id: (ws as { id: string }).id,
        p_name: `Board ${tag}`,
      });
      expect(boardErr, "create_board").toBeNull();
      boardAId = (board as { id: string }).id;
      const { data: group } = await userA
        .from("groups")
        .select("id")
        .eq("board_id", boardAId)
        .limit(1)
        .single();

      // Inserting an item fires trg_items_enqueue_embed → a queue row appears.
      const { data: item, error: itemErr } = await admin
        .from("items")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          group_id: (group as { id: string }).id,
          name: `Onboarding checklist ${tag}`,
          position: 1,
          created_by: a.id,
        })
        .select("id")
        .single();
      expect(itemErr, "seed item").toBeNull();
      itemAId = (item as { id: string }).id;
    });

    afterAll(async () => {
      await admin.from("item_embed_queue").delete().eq("item_id", itemAId);
      await admin.from("items").delete().ilike("name", `%${tag}%`);
      for (const id of createdOrgIds) {
        await admin.from("organizations").delete().eq("id", id);
      }
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    });

    it("the items INSERT trigger enqueued the item (visible to service role)", async () => {
      const { data, error } = await admin
        .from("item_embed_queue")
        .select("item_id, org_id, board_id")
        .eq("item_id", itemAId);
      expect(error).toBeNull();
      expect(data).toEqual([
        { item_id: itemAId, org_id: orgAId, board_id: boardAId },
      ]);
    });

    it("org A cannot read the queue (default-deny, service-only)", async () => {
      const { data, error } = await userA
        .from("item_embed_queue")
        .select("item_id")
        .eq("item_id", itemAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("org B sees NONE of org A's queue rows", async () => {
      const { data, error } = await userB
        .from("item_embed_queue")
        .select("item_id")
        .eq("item_id", itemAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("no client insert path — a member cannot enqueue directly", async () => {
      const { error } = await userA.from("item_embed_queue").insert({
        item_id: itemAId,
        org_id: orgAId,
        board_id: boardAId,
      });
      expect(error).not.toBeNull(); // RLS default-deny blocks the write
    });
  },
);
