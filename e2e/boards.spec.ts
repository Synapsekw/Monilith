/**
 * e2e: Boards happy path
 *
 * Auth strategy: the dev Supabase project may enforce email confirmation, which
 * would block a plain UI signup from landing in an authenticated session. To
 * stay robust, we create a CONFIRMED user via the service-role admin API in
 * `beforeAll` (exactly as `src/lib/supabase/rls.integration.test.ts` does),
 * then drive the rest of the flow through the UI /login page. Confirmed users
 * can log in immediately with no email-verification step.
 *
 * If SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is absent (e.g. CI
 * without secrets), the whole describe block is skipped gracefully — the suite
 * will not hard-fail.
 */

import * as dotenv from "dotenv";
import * as path from "node:path";

// Load .env.local for the Playwright test process (playwright.config.ts does
// not ship a dotenv call; the webServer process gets its own env from Next.js).
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

test.describe("Boards happy path", () => {
  // Skip the whole describe when secrets are unavailable (CI without .env.local).
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping boards e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    // Create a pre-confirmed user via the service-role admin API so that
    // email confirmation never blocks the UI login.
    testEmail = `${unique("e2e-boards")}@example.com`;

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

  test("create board → auto-seed → add item → reload persists", async ({
    page,
  }) => {
    // This test drives sign-in + onboarding + board creation — allow 2 minutes.
    test.setTimeout(120_000);

    // ── 1. Log in via the UI (confirmed user — no email verification needed) ─
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    // The server action dispatched inside startTransition now processes the
    // redirect() as a client navigation. A confirmed user with no org is
    // redirected / → /onboarding.
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // ── 2. Onboarding (new user has no org) ───────────────────────────────────
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();

    // After onboarding completes the server action redirects to /. The app
    // now navigates on its own — no manual goto needed.
    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    // ── 3. Home — no boards yet ───────────────────────────────────────────────
    // / stays at / (not redirecting to onboarding because org now exists, and
    // not to /boards/ because there are no boards yet).
    await expect(page.getByText(/no boards yet/i)).toBeVisible({
      timeout: 15_000,
    });

    // ── 4. Create a board via the sidebar dialog ──────────────────────────────
    const boardName = unique("Sprint");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();

    // ── 5. Routed to /boards/[id] — auto-seed assertions ─────────────────────
    await page.waitForURL(/\/boards\//);
    await expect(page.getByText("Group 1")).toBeVisible();
    await expect(page.getByText("Status")).toBeVisible();
    await expect(page.getByText("Owner")).toBeVisible();
    await expect(page.getByText("Date")).toBeVisible();

    // ── 6. Add an item via the inline Add-item input (Enter to commit) ────────
    const itemName = unique("Task");
    await page.getByLabel("Add item").fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible();

    // ── 7. Reload → item and Group 1 persist ─────────────────────────────────
    await page.reload();
    await expect(page.getByText(itemName)).toBeVisible();
    await expect(page.getByText("Group 1")).toBeVisible();
  });
});
