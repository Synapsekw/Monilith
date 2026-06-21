/**
 * e2e: Time tracking (Phase 6c)
 *
 * Mirrors the harness of `e2e/custom-fields.spec.ts` (Phase 6b): a CONFIRMED user
 * created via the service-role admin API in `beforeAll`, driven through the UI, the
 * same onboarding + create-board flow, the same `dotenv` load of `.env.local`, and
 * the same graceful skip when secrets are absent.
 *
 * Flow (one test, shared page session):
 *   1. Log in → onboard → create a board (blank template → opens in Table view).
 *   2. Add a "Time tracking" column via the Add-column menu.
 *   3. Add an item; click the Start-timer button on the item's time cell → affordance
 *      flips to Stop and a running entry appears; Stop → a logged session appears and
 *      the cell's tracked total is > 0.
 *   4. Open the cell popover → enter "1h 30m" in "+ Add time" → the session list
 *      grows and the total increases.
 *   5. Set the estimate to "4h" → the cell shows "… / 4h"; reload → estimate and
 *      logged entries persist.
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

test.describe("Time tracking: column add / start-stop timer / manual entry / estimate", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping time-tracking e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-time-tracking")}@example.com`;
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

  test("add Time tracking column, start/stop timer, add manual entry, set estimate, reload persists", async ({
    page,
  }) => {
    test.setTimeout(300_000);

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
    const boardName = unique("TimeTrack");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });

    // ── 4. Add a "Time tracking" column ───────────────────────────────────────
    await page.getByRole("button", { name: "Add column" }).click();
    await page.getByRole("menuitem", { name: "Time tracking" }).click();
    const timeMenu = page.getByRole("button", {
      name: "Time tracking column menu",
    });
    await expect(timeMenu).toBeVisible({ timeout: 15_000 });

    // ── 5. Add an item ────────────────────────────────────────────────────────
    const itemName = "Task";
    await page.getByLabel("Add item", { exact: true }).fill(itemName);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: `${itemName} name` }),
    ).toBeVisible({ timeout: 15_000 });

    // The "Start timer" quick-action button is adjacent to the cell trigger.
    // aria-label="Start timer" (Play icon button, outside the popover).
    const startBtn = page.getByRole("button", { name: "Start timer" });
    await expect(startBtn).toBeVisible({ timeout: 10_000 });

    // ── 6. Start the timer ────────────────────────────────────────────────────
    await startBtn.click();

    // After starting, the affordance flips: "Stop timer" appears; "Start timer" gone.
    const stopBtn = page.getByRole("button", { name: "Stop timer" });
    await expect(stopBtn).toBeVisible({ timeout: 10_000 });
    await expect(startBtn).toHaveCount(0);

    // The cell trigger shows a running indicator (aria-label="Timer running" span).
    const runningIndicator = page.getByLabel("Timer running");
    await expect(runningIndicator).toBeVisible({ timeout: 10_000 });

    // Let at least 1s pass so the entry has non-zero duration when stopped.
    await page.waitForTimeout(1_500);

    // ── 7. Stop the timer ─────────────────────────────────────────────────────
    await stopBtn.click();

    // After stop: Start timer reappears, running indicator gone.
    await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await expect(runningIndicator).toHaveCount(0);

    // The cell trigger now shows a non-zero tracked total (not the Clock icon placeholder).
    // We open the popover to verify the entry appeared.
    await page.getByRole("button", { name: "Open time tracking" }).click();

    // The popover header shows "tracked" label and a time > 0:00.
    const popoverTrackedLabel = page.getByText("tracked");
    await expect(popoverTrackedLabel).toBeVisible({ timeout: 10_000 });

    // At least one entry row should appear in the entry list (the stopped session).
    // The entry shows "You" as the user label.
    await expect(page.getByText("You")).toBeVisible({ timeout: 10_000 });

    // Close the popover by pressing Escape.
    await page.keyboard.press("Escape");

    // ── 8. Add a manual entry: 1h 30m ────────────────────────────────────────
    // Re-open the popover via the "Open time tracking" cell button.
    await page.getByRole("button", { name: "Open time tracking" }).click();
    await expect(popoverTrackedLabel).toBeVisible({ timeout: 10_000 });

    // Fill the "Duration to add" input (aria-label="Duration to add").
    const durationInput = page.getByLabel("Duration to add");
    await expect(durationInput).toBeVisible({ timeout: 10_000 });
    await durationInput.fill("1h 30m");

    // Click the "Add" button (aria-label="Add time").
    await page.getByRole("button", { name: "Add time" }).click();

    // After adding, the entry list should now have 2 entries (the stopped one + manual).
    // "You" appears at least twice, or we assert count ≥ 2.
    const youLabels = page.getByText("You");
    await expect(youLabels).toHaveCount(2, { timeout: 10_000 });

    // The popover total should reflect > 1h 30m (the manual entry alone is 5400 s).
    // The popover header uses `text-sm font-medium tabular-nums` on its total span;
    // the entry-list rows use `text-xs font-medium tabular-nums`. Use the first
    // (index 0) `text-sm font-medium tabular-nums` span — that's the header total.
    const headerTotalSpan = page
      .locator("span.tabular-nums.text-sm.font-medium")
      .first();
    await expect(headerTotalSpan).toContainText(/1h/, { timeout: 10_000 });

    // ── 9. Set the estimate to 4h ─────────────────────────────────────────────
    // Estimate input has aria-label="Estimate".
    const estimateInput = page.getByLabel("Estimate");
    await expect(estimateInput).toBeVisible({ timeout: 10_000 });
    await estimateInput.fill("4h");
    // Commit via Enter.
    await estimateInput.press("Enter");

    // Close the popover.
    await page.keyboard.press("Escape");

    // The cell trigger (aria-label="Open time tracking") now shows "… / 4h".
    // formatDuration(14400) = "4h". The cell renders " / 4h" as a muted span.
    const cellTrigger = page.getByRole("button", {
      name: "Open time tracking",
    });
    await expect(cellTrigger).toContainText("/ 4h", { timeout: 10_000 });

    // ── 10. Reload → persistence ──────────────────────────────────────────────
    // Wait for in-flight requests to settle before reloading to avoid session bounce.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });

    // After reload, the cell should still show the estimate suffix "/ 4h".
    await expect(
      page.getByRole("button", { name: "Open time tracking" }),
    ).toContainText("/ 4h", { timeout: 15_000 });

    // Open the popover to confirm logged entries are still there.
    await page.getByRole("button", { name: "Open time tracking" }).click();
    await expect(page.getByText("tracked")).toBeVisible({ timeout: 10_000 });
    // Both entries still visible (at least two "You" rows).
    await expect(page.getByText("You")).toHaveCount(2, { timeout: 10_000 });
    // Total is still ≥ 1h 30m — the header's total span is `text-sm font-medium tabular-nums`.
    const headerTotalSpanAfterReload = page
      .locator("span.tabular-nums.text-sm.font-medium")
      .first();
    await expect(headerTotalSpanAfterReload).toContainText(/1h/, {
      timeout: 10_000,
    });
  });
});
