/**
 * e2e: Workload happy path
 *
 * Mirrors `e2e/portfolios.spec.ts`: a CONFIRMED user is provisioned via the
 * service-role admin API in `beforeAll`, then the flow is driven through the UI
 * — login → onboarding → sidebar → Workload → see the grid shell + a member row
 * → in-page sort changes the URL via the History API WITHOUT a full navigation
 * (gotcha-09 / AGENTS.md §5) → edit own capacity (Server Action + revalidate).
 *
 * The fresh onboarding org has no dated+assigned items, so the must-pass is the
 * grid shell + at least one member row + the sort round-trip; the capacity edit
 * is the primary server-mutation behavior.
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

test.describe("Workload happy path", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping workload e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-workload")}@example.com`;
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

  test("renders the workload grid, sorts in-page, and edits own capacity", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // ── 1. Log in ────────────────────────────────────────────────────────────
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // ── 2. Onboarding ─────────────────────────────────────────────────────────
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });

    // ── 3. Go to Workload via the sidebar nav link ────────────────────────────
    await page.getByRole("link", { name: "Workload" }).click();
    await page.waitForURL(/\/workload$/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: /workload/i }),
    ).toBeVisible();

    // The onboarding user is an org member → at least their own row renders.
    await expect(
      page.getByRole("button", { name: /edit capacity/i }).first(),
    ).toBeVisible({
      timeout: 15_000,
    });

    // ── 4. In-page sort: pushState changes the URL without a full navigation ───
    await expect(page).not.toHaveURL(/sort=/);
    await page.getByRole("button", { name: "Total load", exact: true }).click();
    await expect(page).toHaveURL(/[?&]sort=load/);
    await expect(
      page.getByRole("button", { name: "Total load", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    // ── 5. Edit own capacity (Server Action → revalidatePath) ─────────────────
    await page
      .getByRole("button", { name: /edit capacity/i })
      .first()
      .click();
    await page.getByLabel(/hours per day/i).fill("6");
    await page.getByRole("button", { name: /^save$/i }).click();

    // After revalidation the row total reflects 6h/day over a 5-day week = 30h.
    await expect(page.getByText(/30h/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
