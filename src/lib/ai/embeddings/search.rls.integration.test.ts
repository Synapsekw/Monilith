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

type MatchRow =
  Database["public"]["Functions"]["match_items"]["Returns"][number];
type EmbeddingInsert =
  Database["public"]["Tables"]["item_embeddings"]["Insert"];

// A deterministic unit vector literal (dim 1536, spec §4.5). The exact direction
// is irrelevant — the RLS boundary, not ranking, is under test here.
const VECTOR_DIM = 1536;
const UNIT_VECTOR = `[${["1", ...Array(VECTOR_DIM - 1).fill("0")].join(",")}]`;

// `semanticSearchItems` itself needs the Next request context + a platform
// embedding key, so this suite exercises the primitive it wraps — the
// SECURITY-INVOKER `match_items` RPC + the `item_embeddings` SELECT policy —
// which ARE the semantic surface's RLS boundary: org B must see none of org A's
// embedded items through either.
describe.skipIf(!integrationTargetReady())(
  "semantic search: match_items + item_embeddings RLS isolation",
  () => {
    const tag = randomUUID().slice(0, 8);
    let admin: SupabaseClient<Database>; // service role, RLS-bypassing, for setup
    let userA: SupabaseClient<Database>; // org-A member (owns the embedded item)
    let userB: SupabaseClient<Database>; // org-B member — must see nothing of A
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];
    let itemAId = "";

    async function provisionUser(label: string) {
      const email = `semsearch-${label}-${randomUUID()}@example.com`;
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
          p_slug: `semsearch-${label}-${randomUUID().slice(0, 8)}`,
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

      // Org A: workspace + board (create_board seeds a default group) + one item.
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
      const boardA = (board as { id: string }).id;
      const { data: group } = await userA
        .from("groups")
        .select("id")
        .eq("board_id", boardA)
        .limit(1)
        .single();
      const groupA = (group as { id: string }).id;

      const { data: item, error: itemErr } = await userA
        .from("items")
        .insert({
          org_id: a.orgId,
          board_id: boardA,
          group_id: groupA,
          name: `Semantic secret ${tag}`,
          position: 1,
        })
        .select("id")
        .single();
      expect(itemErr, "insert item").toBeNull();
      itemAId = (item as { id: string }).id;

      // Embeddings are written only by the service endpoint — seed via admin.
      const row: EmbeddingInsert = {
        item_id: itemAId,
        org_id: a.orgId,
        board_id: boardA,
        embedding: UNIT_VECTOR,
        content_hash: `hash-${tag}`,
        model: "text-embedding-3-small",
      };
      const { error: embErr } = await admin.from("item_embeddings").insert(row);
      expect(embErr, "seed embedding").toBeNull();
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

    it("lets org A find its own embedded item via match_items", async () => {
      const { data, error } = await userA.rpc("match_items", {
        p_query_embedding: UNIT_VECTOR,
        p_limit: 50,
      });
      expect(error).toBeNull();
      const ids = (data as MatchRow[]).map((r) => r.item_id);
      expect(ids).toContain(itemAId);
    });

    it("scopes match_items by RLS: org B sees none of org A's items", async () => {
      const { data, error } = await userB.rpc("match_items", {
        p_query_embedding: UNIT_VECTOR,
        p_limit: 50,
      });
      expect(error).toBeNull();
      const leaked = (data as MatchRow[]).filter((r) => r.name.includes(tag));
      expect(leaked).toEqual([]); // SECURITY INVOKER + RLS -> no cross-tenant leak
    });

    it("scopes item_embeddings SELECT by RLS: org B reads no org-A embedding", async () => {
      const { data, error } = await userB
        .from("item_embeddings")
        .select("item_id")
        .eq("item_id", itemAId);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });
  },
);
