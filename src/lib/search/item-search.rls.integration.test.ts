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

type SearchRow =
  Database["public"]["Functions"]["search_items"]["Returns"][number];
type ItemInsert = Database["public"]["Tables"]["items"]["Insert"];

describe.skipIf(!integrationTargetReady())(
  "search_items RPC: ranking + RLS",
  () => {
    // Unique per-run marker embedded in every seeded item name, so this run's
    // rows are isolated from any other data and trivially cleaned up.
    const tag = randomUUID().slice(0, 8);
    let admin: SupabaseClient<Database>; // service role, RLS-bypassing, for setup
    let userA: SupabaseClient<Database>; // org-A member, calls the RPC under RLS
    let userB: SupabaseClient<Database>; // org-B member, must NOT see org-A items
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    async function provisionUser(label: string) {
      const email = `search-${label}-${randomUUID()}@example.com`;
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
          p_slug: `search-${label}-${randomUUID().slice(0, 8)}`,
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

      // Org A gets a workspace + board; create_board seeds a default group.
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

      // Seed via the RLS-bypassing admin client so we can pin updated_at
      // deterministically (the recency tie-break depends on it). With a
      // service-role connection auth.uid() is null, so items_set_creation_metadata
      // does NOT overwrite our explicit created_by/updated_at, and updated_at is
      // only ever touched by the BEFORE-UPDATE trigger (never on insert).
      const now = Date.now();
      const at = (msAgo: number) => new Date(now - msAgo).toISOString();
      const base = {
        org_id: a.orgId,
        board_id: boardA,
        group_id: groupA,
        created_by: a.id,
      };

      const rows: ItemInsert[] = [
        // Exact-substring of "design"; newest -> should rank first.
        {
          ...base,
          name: `Design spec ${tag}`,
          position: 1,
          updated_at: at(60_000),
        },
        // Exact-substring of "design"; older -> recency tie-break puts it second.
        {
          ...base,
          name: `Design brief ${tag}`,
          position: 2,
          updated_at: at(3_600_000),
        },
        // Fuzzy-only for "design" (not a substring; word_similarity ~0.571).
        {
          ...base,
          name: `Desing overview ${tag}`,
          position: 3,
          updated_at: at(7_200_000),
        },
      ];
      // 26 items matching a distinct token to overflow the 25 cap independently
      // of the "design" ranking assertions above.
      for (let i = 0; i < 26; i++) {
        rows.push({
          ...base,
          name: `Zephyr note ${i} ${tag}`,
          position: 100 + i,
          updated_at: at(10_000_000 + i * 1000),
        });
      }

      const { error: seedErr } = await admin.from("items").insert(rows);
      expect(seedErr, "seed items").toBeNull();
    });

    afterAll(async () => {
      // Self-clean: this project's teardown purge is gated to a marked test DB,
      // so the suite removes its own rows/orgs/users regardless of target.
      await admin.from("items").delete().ilike("name", `%${tag}%`);
      for (const id of createdOrgIds) {
        await admin.from("organizations").delete().eq("id", id);
      }
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    });

    it("ranks an exact substring match above a fuzzy-only match", async () => {
      const { data, error } = await userA.rpc("search_items", {
        p_query: "design",
        p_limit: 25,
      });
      expect(error).toBeNull();
      const names = (data as SearchRow[]).map((r) => r.name);
      const exact = names.indexOf(`Design spec ${tag}`);
      const fuzzy = names.indexOf(`Desing overview ${tag}`);
      expect(exact).toBeGreaterThanOrEqual(0);
      expect(fuzzy).toBeGreaterThanOrEqual(0);
      expect(exact).toBeLessThan(fuzzy);
    });

    it("tolerates a typo (desing -> Design)", async () => {
      const { data, error } = await userA.rpc("search_items", {
        p_query: "desing",
        p_limit: 25,
      });
      expect(error).toBeNull();
      const names = (data as SearchRow[]).map((r) => r.name);
      expect(names).toContain(`Design spec ${tag}`);
    });

    it("uses recency only as a tie-break between equal-strength matches", async () => {
      const { data } = await userA.rpc("search_items", {
        p_query: "design",
        p_limit: 25,
      });
      const names = (data as SearchRow[]).map((r) => r.name);
      // Both are exact-contains (rank 1.0); the newer one (`spec`) comes first.
      expect(names.indexOf(`Design spec ${tag}`)).toBeLessThan(
        names.indexOf(`Design brief ${tag}`),
      );
    });

    it("bounds the result set to the requested cap", async () => {
      const { data, error } = await userA.rpc("search_items", {
        p_query: "zephyr",
        p_limit: 25,
      });
      expect(error).toBeNull();
      // 26 "Zephyr" items were seeded; the RPC caps the read at 25.
      expect((data as SearchRow[]).length).toBe(25);
    });

    it("scopes results by RLS: org B sees none of org A's items", async () => {
      const { data, error } = await userB.rpc("search_items", {
        p_query: "design",
        p_limit: 25,
      });
      expect(error).toBeNull();
      const leaked = (data as SearchRow[]).filter((r) => r.name.includes(tag));
      expect(leaked).toEqual([]); // SECURITY INVOKER + RLS -> no cross-tenant leak
    });
  },
);
