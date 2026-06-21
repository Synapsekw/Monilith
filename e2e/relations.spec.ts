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

// Relation column end-to-end: a "Tasks" board has a relation column pointing at
// a "Projects" board; linking an item from the picker renders its chip in the
// cell. Boards/items/column are seeded via the user's own session (RLS-scoped),
// then the link interaction is driven through the UI.
test.describe("Relation column: link an item → chip renders", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  let createdUserId: string | null = null;
  let testEmail: string;
  let tasksBoardId: string;
  const projectName = "Acquisition Q3";

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-rel")}@example.com`;
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

    // Provision as the user (RLS-scoped) via a fresh anon session.
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

    async function board(name: string) {
      const { data: b } = await anon.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: name,
      });
      const boardId = (b as { id: string }).id;
      const { data: g } = await anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      return { boardId, groupId: (g as { id: string }).id };
    }
    async function item(groupId: string, name: string) {
      await anon.rpc("create_item", { p_group_id: groupId, p_name: name });
    }

    const projects = await board("Projects");
    await item(projects.groupId, projectName);
    const tasks = await board("Tasks");
    await item(tasks.groupId, "Ship onboarding");
    tasksBoardId = tasks.boardId;

    // Relation column on Tasks → Projects (multi).
    await anon.from("columns").insert({
      org_id: orgId,
      board_id: tasks.boardId,
      name: "Projects",
      kind: "relation",
      position: 1000,
      settings: { target_board_id: projects.boardId, allow_multiple: true },
    });
  });

  test.afterAll(async () => {
    if (!createdUserId) return;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin.deleteUser(createdUserId);
  });

  test("links a project and shows its chip", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for the login redirect to settle (session cookie set) before
    // navigating to the board, so we don't race a /login bounce.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    });

    await page.goto(`/boards/${tasksBoardId}`);
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });

    // Open the relation cell on the "Ship onboarding" row, pick the project.
    await page
      .getByRole("button", { name: "Edit linked items" })
      .first()
      .click();
    const picker = page.getByPlaceholder(/search/i);
    await expect(picker).toBeVisible({ timeout: 10_000 });
    await page.getByRole("option", { name: projectName }).click();

    // Close the picker and assert the chip renders in the cell.
    await page.keyboard.press("Escape");
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 10_000 });
  });
});
