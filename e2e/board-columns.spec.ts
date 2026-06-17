/**
 * e2e: Board columns — add → rename → delete
 *
 * Mirrors `e2e/item-panel.spec.ts`: same auth strategy (a CONFIRMED user created
 * via the service-role admin API in `beforeAll`, driven through the UI), the same
 * onboarding + create-board flow, the same `dotenv` load of `.env.local`, and the
 * same graceful skip when secrets are absent.
 *
 * Flow (one test, shared page session):
 *   1. Log in → onboard → create a board (opens in the Table view).
 *   2. Add a Text column via the "Add column" menu.
 *   3. Rename it to "Notes" via the column header menu.
 *   4. Delete it (confirm) and assert it disappears.
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

test.describe("Board columns: add → rename → delete", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping board-columns e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-columns")}@example.com`;
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

  test("add a Text column → rename it → delete it", async ({ page }) => {
    test.setTimeout(120_000);

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

    // ── 4. Add a Text column ──────────────────────────────────────────────────
    await page.getByRole("button", { name: "Add column" }).click();
    await page.getByRole("menuitem", { name: "Text" }).click();
    await expect(page.getByText("Text")).toBeVisible({ timeout: 15_000 });

    // ── 5. Rename it ──────────────────────────────────────────────────────────
    await page.getByText("Text").hover();
    await page.getByRole("button", { name: "Text column menu" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const input = page.getByLabel("Column name");
    await input.fill("Notes");
    await input.press("Enter");
    await expect(page.getByText("Notes")).toBeVisible();

    // ── 6. Delete it (confirm) ────────────────────────────────────────────────
    await page.getByText("Notes").hover();
    await page.getByRole("button", { name: "Notes column menu" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Notes")).toHaveCount(0, { timeout: 15_000 });
  });
});
