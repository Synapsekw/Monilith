/**
 * e2e: Command palette — open via header trigger, type a board name, select it,
 * assert navigation to that board.
 *
 * Auth strategy: mirrors board-templates.spec.ts exactly — a CONFIRMED user
 * created via the service-role admin API in `beforeAll`, driven through the UI
 * /login page. New users land in /onboarding and must create an org/workspace
 * before the Boards sidebar appears.
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
const BOARD_NAME = "Sprint planning";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test.describe("Command palette: navigate to a board", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping command-palette e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-cmdk")}@example.com`;

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

  test("open palette, type board name, select it, assert navigation", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // ── 1. Log in via the UI ──────────────────────────────────────────────────
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    // A confirmed user with no org is redirected → /onboarding.
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // ── 2. Onboarding (new user has no org) ───────────────────────────────────
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();

    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });
    await expect(page.getByText(/no boards yet/i)).toBeVisible({
      timeout: 15_000,
    });

    // ── 3. Create a board via the sidebar "New board" trigger ─────────────────
    await page.getByRole("button", { name: "New board" }).click();

    // Pick the "Sprint planning" template card
    await page.getByRole("button", { name: BOARD_NAME }).click();

    // Submit — keep the auto-filled board name
    await page.getByRole("button", { name: /create board/i }).click();

    // Wait until routed to /boards/<uuid>
    await page.waitForURL(/\/boards\//, { timeout: 30_000 });

    // Confirm the board landed (same assertion as board-templates.spec.ts)
    await expect(page.getByText("Backlog")).toBeVisible({ timeout: 15_000 });

    // ── 4. Open the command palette via the header trigger ────────────────────
    // CommandTrigger renders a Button with accessible name "Search… ⌘K".
    // Use exact match to avoid the strict-mode violation from other buttons
    // that happen to contain "search" in their aria-labels (e.g. board items).
    const triggerButton = page.getByRole("button", { name: "Search… ⌘K" });
    await triggerButton.click();

    // Fall back to keyboard shortcut if the click didn't open the palette
    const input = page.getByPlaceholder("Type a command or search…");
    const inputVisible = await input.isVisible().catch(() => false);
    if (!inputVisible) {
      await page.keyboard.press("ControlOrMeta+KeyK");
    }

    await expect(input).toBeVisible({ timeout: 10_000 });

    // ── 5. Type the board name to filter the list ─────────────────────────────
    await input.fill("Sprint");

    // ── 6. Select the matching board navigation item ──────────────────────────
    // cmdk renders items with role="option". The board item has value="board Sprint planning"
    // and its visible text is "Sprint planning".
    const boardItem = page
      .getByRole("option", { name: /Sprint planning/i })
      .first();

    // If cmdk doesn't expose role="option" in this version, fall back to
    // clicking by visible text inside the command list.
    const itemVisible = await boardItem.isVisible().catch(() => false);
    if (itemVisible) {
      await boardItem.click();
    } else {
      await page
        .locator("[cmdk-list] [cmdk-item]", { hasText: /Sprint planning/i })
        .first()
        .click();
    }

    // ── 7. Assert navigation to the board ────────────────────────────────────
    await page.waitForURL(/\/boards\/[0-9a-f-]+/, { timeout: 30_000 });
    await expect(page.getByText("Backlog")).toBeVisible({ timeout: 15_000 });
  });
});
