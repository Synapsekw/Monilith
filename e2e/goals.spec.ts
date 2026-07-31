/**
 * e2e: Goals/OKRs happy path
 *
 * Mirrors `e2e/portfolios.spec.ts`: a CONFIRMED user is provisioned via the
 * service-role admin API in `beforeAll`, then the whole flow is driven through
 * the UI — login → onboarding → Goals → create a parent goal (auto_subgoals) →
 * open its drawer → add a manual_percent sub-goal at 50% → the parent's progress
 * rolls up to 50% → change the parent's status in the drawer.
 *
 * Skips gracefully when Supabase secrets are absent (CI without .env.local).
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

test.describe("Goals happy path", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping goals e2e");

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-goals")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email: testEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Failed to create test user: ${error?.message}`);
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

  test("create a goal tree, roll up progress, change status", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // ── 1. Log in (confirmed user) ───────────────────────────────────────────
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // ── 2. Onboarding ────────────────────────────────────────────────────────
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });

    // ── 3. Go to Goals via the sidebar nav link ──────────────────────────────
    await page.getByRole("link", { name: "Goals" }).click();
    await page.waitForURL(/\/goals$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();

    // ── 4. Create a parent goal (auto_subgoals) ──────────────────────────────
    const parent = unique("Company goal");
    await page.getByRole("button", { name: "New goal" }).click();
    await page.getByLabel(/goal name/i).fill(parent);
    await page
      .getByLabel(/how is progress measured/i)
      .selectOption("auto_subgoals");
    await page.getByRole("button", { name: "Create goal" }).click();
    await expect(page.getByRole("button", { name: parent })).toBeVisible({
      timeout: 15_000,
    });

    // ── 5. Open the drawer (?goal=) and add a manual_percent sub-goal at 50% ──
    await page.getByRole("button", { name: parent }).click();
    await expect(page).toHaveURL(/[?&]goal=/);
    await page.getByRole("button", { name: /add sub-goal/i }).click();

    const child = unique("KR");
    await page.getByLabel(/goal name/i).fill(child);
    await page
      .getByLabel(/how is progress measured/i)
      .selectOption("manual_percent");
    await page.getByLabel(/percent complete/i).fill("50");
    await page.getByRole("button", { name: "Create goal" }).click();

    // ── 6. Parent progress rolls up to 50% ───────────────────────────────────
    await expect(page.getByText("50%").first()).toBeVisible({
      timeout: 15_000,
    });

    // ── 7. Change the parent's status in the drawer ──────────────────────────
    await page.getByLabel("Status").selectOption("at_risk");
    await expect(page.getByText(/at risk/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
