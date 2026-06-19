/**
 * e2e: Board templates — pick "Sprint planning" → create → assert seeded content
 *
 * Auth strategy: mirrors boards.spec.ts exactly — a CONFIRMED user created via
 * the service-role admin API in `beforeAll`, driven through the UI /login page.
 * New users land in /onboarding and must create an org/workspace before the
 * Boards sidebar appears.
 *
 * If SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is absent (e.g. CI
 * without secrets), the whole describe block is skipped gracefully.
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

test.describe("Board templates: Sprint planning happy path", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping board-templates e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    // Create a pre-confirmed user via the service-role admin API so that
    // email confirmation never blocks the UI login.
    testEmail = `${unique("e2e-templates")}@example.com`;

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

  test("create board from Sprint planning template → seeded groups and items visible", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // ── 1. Log in via the UI (confirmed user — no email verification needed) ──
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    // A confirmed user with no org is redirected → /onboarding.
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // ── 2. Onboarding (new user has no org) ────────────────────────────────────
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();

    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });
    await expect(page.getByText(/no boards yet/i)).toBeVisible({
      timeout: 15_000,
    });

    // ── 3. Open the "New board" dialog via the sidebar trigger ─────────────────
    // The trigger is a ghost icon button with aria-label="New board" rendered
    // by <NewBoardDialog>.
    await page.getByRole("button", { name: "New board" }).click();

    // ── 4. Pick the "Sprint planning" template card ────────────────────────────
    // Template cards are <button> elements with the template name as text.
    await page.getByRole("button", { name: "Sprint planning" }).click();

    // The board-name input auto-fills with the template's default name.
    // Keep that default (no custom name needed for this test).

    // ── 5. Submit — create the board ──────────────────────────────────────────
    await page.getByRole("button", { name: /create board/i }).click();

    // ── 6. Routed to /boards/<uuid> ───────────────────────────────────────────
    await page.waitForURL(/\/boards\//, { timeout: 30_000 });

    // ── 7. Assert seeded board content is visible ─────────────────────────────
    // Groups from the "sprints" template: "Backlog", "In Sprint", "Done".
    // "Backlog" and "In Sprint" are unambiguous. "Done" also appears as a
    // status-cell label ("Ship settings page" is seeded with status=Done),
    // so we target the collapse/expand toggle button whose aria-label is
    // "Collapse Done" / "Expand Done" — rendered by the GroupSection header.
    await expect(page.getByText("Backlog")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("In Sprint")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: /^(Collapse|Expand) Done$/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Sample item seeded into the "In Sprint" group
    await expect(page.getByText("Build onboarding flow")).toBeVisible({
      timeout: 15_000,
    });
  });
});
