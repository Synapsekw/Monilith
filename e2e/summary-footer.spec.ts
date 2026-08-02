import * as dotenv from "dotenv";
import * as path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasSecrets = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);
const PASSWORD = "Test-Password-123!";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// Column-summary footer end-to-end (Phase 6d-3). A board with a Numbers column
// and two items (10, 5). The footer row lets the user pick an aggregation per
// column; choosing "Sum" must show 15, and re-picking "Average" must show 7.5 —
// computed client-side (no reload), the choice persisting to columns.settings.
test.describe("Column-summary footer: per-column aggregation", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  let createdUserId: string | null = null;
  let testEmail: string;
  let boardId: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-footer")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: created, error } = await admin.auth.admin.createUser({
      email: testEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    createdUserId = created.user!.id;

    const anon = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await anon.auth.signInWithPassword({
      email: testEmail,
      password: PASSWORD,
    });

    const { data: org } = await anon.rpc("create_organization", {
      p_name: unique("Org"),
      p_slug: unique("org").toLowerCase(),
    });
    const orgId = (org as { id: string }).id;
    const { data: ws } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: "Engineering", created_by: createdUserId })
      .select("id")
      .single();
    const workspaceId = (ws as { id: string }).id;

    const { data: b } = await anon.rpc("create_board", {
      p_workspace_id: workspaceId,
      p_name: "Budget",
    });
    boardId = (b as { id: string }).id;
    const { data: g } = await anon
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .single();
    const groupId = (g as { id: string }).id;

    const { data: col } = await anon
      .from("columns")
      .insert({
        org_id: orgId,
        board_id: boardId,
        name: "Cost",
        kind: "numbers",
        position: 1000,
        settings: {},
      })
      .select("id")
      .single();
    const colId = (col as { id: string }).id;

    for (const [name, n] of [
      ["Item A", 10],
      ["Item B", 5],
    ] as const) {
      const { data: it } = await anon.rpc("create_item", {
        p_group_id: groupId,
        p_name: name,
      });
      await anon.from("cell_values").upsert(
        {
          org_id: orgId,
          board_id: boardId,
          item_id: (it as { id: string }).id,
          column_id: colId,
          value: { n },
        },
        { onConflict: "item_id,column_id" },
      );
    }
  });

  test.afterAll(async () => {
    if (!createdUserId) return;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin.deleteUser(createdUserId);
  });

  test("picks Sum then Average in the footer, recomputing client-side", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    });

    await page.goto(`/boards/${boardId}`);
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });

    const footer = page.getByTestId("board-summary-footer");
    await expect(footer).toBeVisible({ timeout: 10_000 });

    // Pick Sum → 15.
    await footer.getByRole("button").first().click();
    await page.getByRole("menuitem", { name: "Sum" }).click();
    await expect(footer).toContainText("15", { timeout: 10_000 });

    // Re-pick Average → 7.5, recomputed without a reload.
    await footer.getByRole("button").first().click();
    await page.getByRole("menuitem", { name: "Average" }).click();
    await expect(footer).toContainText("7.5");
  });
});
