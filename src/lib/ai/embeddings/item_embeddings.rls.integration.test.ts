import { randomUUID } from "node:crypto";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { EMBEDDING_DIM, EMBEDDING_MODEL } from "./client";
import { toVectorLiteral } from "./index-actions";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type MatchRow =
  Database["public"]["Functions"]["match_items"]["Returns"][number];

// A deterministic unit vector of the model dimension — value is irrelevant to
// the RLS assertions (we only care WHICH rows are visible, not their ranking).
const VECTOR = toVectorLiteral(
  Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === 0 ? 1 : 0)),
);

describe.skipIf(!integrationTargetReady())(
  "item_embeddings + match_items: RLS cross-tenant isolation",
  () => {
    const tag = randomUUID().slice(0, 8);
    let admin: SupabaseClient<Database>; // service role, RLS-bypassing, for setup
    let userA: SupabaseClient<Database>; // org-A member (owns the seeded item)
    let userB: SupabaseClient<Database>; // org-B member — must NOT see org-A rows
    let itemAId: string;
    let boardAId: string;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    async function provisionUser(label: string) {
      const email = `embed-${label}-${randomUUID()}@example.com`;
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
          p_slug: `embed-${label}-${randomUUID().slice(0, 8)}`,
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
      const b = await provisionUser("b");
      userB = b.anon;

      const { data: ws, error: wsErr } = await userA
        .from("workspaces")
        .insert({ org_id: a.orgId, name: `WS ${tag}`, created_by: a.id })
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

      const { data: item, error: itemErr } = await admin
        .from("items")
        .insert({
          org_id: a.orgId,
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

      // Insert org-A's embedding via the service role (clients cannot write it).
      const { error: embErr } = await admin.from("item_embeddings").insert({
        item_id: itemAId,
        org_id: a.orgId,
        board_id: boardAId,
        embedding: VECTOR,
        content_hash: `hash-${tag}`,
        model: EMBEDDING_MODEL,
      });
      expect(embErr, "seed item_embedding").toBeNull();
    });

    afterAll(async () => {
      await admin.from("item_embeddings").delete().eq("item_id", itemAId);
      await admin.from("items").delete().ilike("name", `%${tag}%`);
      for (const id of createdOrgIds) {
        await admin.from("organizations").delete().eq("id", id);
      }
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    });

    it("org A can read its own embedding row", async () => {
      const { data, error } = await userA
        .from("item_embeddings")
        .select("item_id")
        .eq("item_id", itemAId);
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.item_id)).toContain(itemAId);
    });

    it("org B sees NONE of org A's embedding rows (RLS default-deny)", async () => {
      const { data, error } = await userB
        .from("item_embeddings")
        .select("item_id")
        .eq("item_id", itemAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("match_items returns org A's item to org A (SECURITY INVOKER over its own RLS)", async () => {
      const { data, error } = await userA.rpc("match_items", {
        p_query_embedding: VECTOR,
        p_limit: 20,
      });
      expect(error).toBeNull();
      const rows: MatchRow[] = data ?? [];
      expect(rows.map((r) => r.item_id)).toContain(itemAId);
    });

    it("match_items returns NONE of org A's items to org B (no cross-tenant leak)", async () => {
      const { data, error } = await userB.rpc("match_items", {
        p_query_embedding: VECTOR,
        p_limit: 20,
      });
      expect(error).toBeNull();
      const rows: MatchRow[] = data ?? [];
      expect(rows.filter((r) => r.item_id === itemAId)).toEqual([]);
    });
  },
);
