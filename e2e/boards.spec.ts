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

  test("create board → add item → edit cells → reload persists", async ({
    page,
  }) => {
    // Covers: login, onboarding, create board, add item, cell editing, reload
    // persistence. All steps in one test so they share the same page session
    // (avoids user/session conflicts from parallel tests on the same account).
    test.setTimeout(180_000);

    // ── 1. Log in via the UI (confirmed user — no email verification needed) ─
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

    // ── 3. Create a board via the sidebar dialog ──────────────────────────────
    const boardName = unique("Sprint");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();

    // ── 4. Routed to /boards/[id] — auto-seed assertions ─────────────────────
    await page.waitForURL(/\/boards\//);
    await expect(page.getByText("Group 1")).toBeVisible();
    await expect(page.getByText("Status")).toBeVisible();
    await expect(page.getByText("Owner")).toBeVisible();
    await expect(page.getByText("Date")).toBeVisible();

    // ── 5. Add an item ────────────────────────────────────────────────────────
    const itemName = unique("Task");
    await page.getByLabel("Add item").fill(itemName);
    await page.keyboard.press("Enter");
    // The cache is patched directly on success (no reload needed).
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Group 1")).toBeVisible();

    // ── 6. Edit the Status cell: open → pick "Working on it" ─────────────────
    // Resting cell: div[role="button"][aria-label="${itemName} Status"].
    await page.getByRole("button", { name: `${itemName} Status` }).click();
    // StatusEditor renders option pills with role="option" and the label text.
    // The PopoverSurface is absolute-positioned within the virtualizer scroll
    // container. The sticky group-section header sits above it in the z-stack
    // and can intercept mouse events at that screen position. Dispatch the click
    // event directly on the element (bypasses the hit-test entirely).
    await page
      .getByRole("option", { name: /working on it/i })
      .dispatchEvent("click");
    // After commit the OptionPill shows the label (optimistic update).
    await expect(page.getByText(/working on it/i)).toBeVisible();

    // ── 7. Edit the Date cell: open → fill date → commit with Enter ───────────
    // Resting cell: div[role="button"][aria-label="${itemName} Date"].
    await page.getByRole("button", { name: `${itemName} Date` }).click();
    // DateEditor: <input type="date" aria-label="Date">
    await page.getByLabel(/^date$/i).fill("2026-06-15");
    await page.keyboard.press("Enter");
    // DateCell formats via toLocaleDateString({year:"numeric",month:"short",day:"numeric"}).
    // In Chromium en-US: "Jun 15, 2026". Assert the year is visible.
    await expect(page.getByText(/2026/)).toBeVisible();

    // ── 8. Rename the item (built-in Name / primary column) ───────────────────
    // NameCell resting: div[role="button"][aria-label="${itemName} name"]
    const renamedItem = `${itemName}-renamed`;
    await page.getByRole("button", { name: `${itemName} name` }).click();
    // NameCell edit: <Input aria-label="Rename ${itemName}">
    await page
      .getByLabel(new RegExp(`rename ${itemName}`, "i"))
      .fill(renamedItem);
    await page.keyboard.press("Enter");
    // The rename patches the cache optimistically. Wait for all in-flight
    // network requests (upsertCell for Status/Date + renameItem) to settle
    // before reloading, so the DB is fully updated.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // ── 9. Reload → Status + Date + renamed Name all persist ─────────────────
    await page.reload();
    await expect(page.getByText(renamedItem)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/working on it/i)).toBeVisible();
    await expect(page.getByText(/2026/)).toBeVisible();
  });
});
