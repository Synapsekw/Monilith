/**
 * e2e: Item detail panel — updates + activity log
 *
 * Mirrors `e2e/kanban.spec.ts`: same auth strategy (a CONFIRMED user created via
 * the service-role admin API in `beforeAll`, driven through the UI), the same
 * onboarding + create-board flow, the same `dotenv` load of `.env.local`, and
 * the same graceful skip when secrets are absent.
 *
 * Flow (one test, shared page session):
 *   1. Log in → onboard → create a board (opens in the Table view).
 *   2. Add an item in the Table.
 *   3. Open its detail panel via the row's "Open <name>" affordance (sets
 *      `?item=` via the History API — no RSC refetch).
 *   4. Post an update; assert it appears in the Updates tab.
 *   5. Switch to the Activity Log tab; assert a "posted an update" entry shows
 *      (written by the Postgres trigger, delivered via Realtime).
 */

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

test.describe("Item panel: updates + activity", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping item-panel e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-panel")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email: testEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(
        `Failed to create test user via service role: ${error?.message}`,
      );
    }
    createdUserId = data.user.id;
  });

  test.afterAll(async () => {
    if (!createdUserId) return;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin.deleteUser(createdUserId);
  });

  test("open item panel → post an update → see it logged in activity", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // ── 1. Log in ─────────────────────────────────────────────────────────────
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // ── 2. Onboard ────────────────────────────────────────────────────────────
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    // ── 3. Create a board ─────────────────────────────────────────────────────
    const boardName = unique("Sprint");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    await expect(page.getByText("Group 1")).toBeVisible();

    // ── 4. Add an item ────────────────────────────────────────────────────────
    const itemName = unique("Task");
    await page.getByLabel("Add item", { exact: true }).fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });

    // ── 5. Open the detail panel via the row's "Open <name>" affordance ───────
    // The control is revealed on row hover; hover the name first, then click.
    await page.getByRole("button", { name: `${itemName} name` }).hover();
    await page.getByRole("button", { name: `Open ${itemName}` }).click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText(itemName)).toBeVisible();

    // ── 6. Post an update (Updates tab is the default) ────────────────────────
    await panel.getByRole("button", { name: "Write an update" }).click();
    await panel.getByRole("textbox").fill("Kickoff scheduled");
    await panel.getByRole("button", { name: "Update", exact: true }).click();
    await expect(panel.getByText("Kickoff scheduled")).toBeVisible({
      timeout: 15_000,
    });

    // ── 7. Switch to the Activity Log; an "update" entry is present ───────────
    await panel.getByRole("button", { name: "Activity Log" }).click();
    await expect(panel.getByText(/posted an update/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
