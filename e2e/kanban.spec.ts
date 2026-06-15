/**
 * e2e: Kanban happy path
 *
 * Mirrors `e2e/boards.spec.ts`: same auth strategy (a CONFIRMED user created via
 * the service-role admin API in `beforeAll`, then driven through the UI), same
 * onboarding + create-board flow, same `dotenv` load of `.env.local`, and the
 * same graceful skip when secrets are absent.
 *
 * Flow (one test, shared page session):
 *   1. Log in → onboard → create a board (opens in the Table view).
 *   2. Add a Kanban view via the switcher's "Add view" control; assert a Kanban
 *      tab appears and the URL gains `?view=`.
 *   3. Assert the Kanban columns render (No status / Working on it / Stuck / Done).
 *   4. Switch back to the Table tab, add an item, set its Status to "Done" using
 *      the SAME interaction boards.spec.ts uses (dispatchEvent on the option —
 *      bypasses the flaky hit-test that a real dnd-kit drag would require).
 *   5. Switch to the Kanban tab; assert the card sits under the Done column and
 *      survives a reload (status persisted to the DB).
 *
 * We deliberately do NOT assert a real pointer drag (dnd-kit drag is flaky in
 * Playwright). Persistence is proven via the Table-side status edit + reload.
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

test.describe("Kanban happy path", () => {
  // Skip the whole describe when secrets are unavailable (CI without .env.local).
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping kanban e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    // Create a pre-confirmed user via the service-role admin API so that
    // email confirmation never blocks the UI login.
    testEmail = `${unique("e2e-kanban")}@example.com`;

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

  test("add Kanban view → columns render → status set in Table persists under Done", async ({
    page,
  }) => {
    // All steps share one page session (avoids user/session conflicts from
    // parallel tests on the same account).
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

    // Routed to /boards/[id] — the board opens in the Table view (auto-seeded
    // Group 1 + Status/Owner/Date columns).
    await page.waitForURL(/\/boards\//);
    await expect(page.getByText("Group 1")).toBeVisible();
    await expect(page.getByText("Status")).toBeVisible();

    // ── 4. Add a Kanban view via the switcher ─────────────────────────────────
    // The default board has a single "Main Table" tab + the "Add view" button.
    await page.getByRole("button", { name: "Add view" }).click();

    // A Kanban tab appears and the URL gains ?view=<id>.
    const kanbanTab = page.getByRole("tab", { name: /kanban/i });
    await expect(kanbanTab).toBeVisible({ timeout: 15_000 });
    await expect(kanbanTab).toHaveAttribute("aria-selected", "true");
    await page.waitForURL(/\?view=/, { timeout: 15_000 });

    // ── 5. Assert the Kanban columns render ───────────────────────────────────
    // Each column is a <section aria-label={label}> → role="region".
    await expect(page.getByRole("region", { name: "No status" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Working on it" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Stuck" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Done" })).toBeVisible();

    // ── 6. Switch back to the Table tab and add an item ───────────────────────
    await page.getByRole("tab", { name: /main table/i }).click();
    await page.waitForURL(/\/boards\//);
    // Wait for the Table view to render (its column headers) before interacting;
    // the Kanban inputs use "Add item to <column>" labels and would otherwise
    // collide with the Table view's exact "Add item" control during the swap.
    await expect(
      page.getByRole("tab", { name: /main table/i }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });

    const itemName = unique("Task");
    // exact:true so the Table view's "Add item" input doesn't match any leftover
    // Kanban "Add item to <column>" inputs during a client-side view swap.
    await page.getByLabel("Add item", { exact: true }).fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });

    // ── 7. Set its Status to "Done" — same interaction as boards.spec.ts ──────
    // Open the resting Status cell, then dispatch the click directly on the
    // "Done" option (bypasses the hit-test that the sticky header would block).
    await page.getByRole("button", { name: `${itemName} Status` }).click();
    await page.getByRole("option", { name: /done/i }).dispatchEvent("click");
    // Optimistic update: the OptionPill shows the label.
    await expect(page.getByText(/^done$/i)).toBeVisible();

    // Let the upsertCell network request settle before navigating away so the
    // DB is fully updated for the reload assertion below.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // ── 8. Switch to the Kanban tab; card sits under the Done column ──────────
    await page.getByRole("tab", { name: /kanban/i }).click();
    await page.waitForURL(/\?view=/, { timeout: 15_000 });

    const doneColumn = page.getByRole("region", { name: "Done" });
    await expect(doneColumn).toBeVisible({ timeout: 15_000 });
    await expect(doneColumn.getByText(itemName)).toBeVisible({
      timeout: 15_000,
    });

    // ── 9. Reload → the card is STILL under Done (persisted to the DB) ────────
    await page.reload();
    const doneAfterReload = page.getByRole("region", { name: "Done" });
    await expect(doneAfterReload).toBeVisible({ timeout: 15_000 });
    await expect(doneAfterReload.getByText(itemName)).toBeVisible({
      timeout: 15_000,
    });
  });
});
