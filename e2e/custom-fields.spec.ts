/**
 * e2e: Custom fields / statuses (Phase 6b)
 *
 * Mirrors the harness of `e2e/board-columns.spec.ts`, `e2e/item-attachments.spec.ts`,
 * and `e2e/subitems.spec.ts`: a CONFIRMED user created via the service-role admin
 * API in `beforeAll`, driven through the UI, the same onboarding + create-board
 * flow, the same `dotenv` load of `.env.local`, and the same graceful skip when
 * secrets are absent.
 *
 * Flow (one test, shared page session):
 *   1. Log in → onboard → create a board (blank template → seeds a "Status" column
 *      with options Working on it / Stuck / Done / Not started; opens in Table view).
 *   2. Edit a Status label: open the "Status column menu" → "Edit labels" → rename
 *      "Done" → "Shipped" → Save. Add an item, set its Status cell to the renamed
 *      option, assert the pill shows "Shipped".
 *   3. Rating column: add a "Rating" column, open the item's rating cell, click the
 *      "4 stars" button, assert the cell shows aria-label "4 of 5", reload → persists.
 *   4. Files column: add a "Files" column, click "Add file" on the item's files cell,
 *      setInputFiles with a 1×1 PNG fixture, assert the cell aria-label becomes "1 files".
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

// 1x1 transparent PNG (same fixture as item-attachments.spec.ts).
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test.describe("Custom fields: edit status labels / rating / files column", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping custom-fields e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-custom-fields")}@example.com`;
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

  test("edit status labels, rating cell, files column", async ({ page }) => {
    test.setTimeout(240_000);

    // ── 1. Log in ──────────────────────────────────────────────────────────────
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

    // ── 3. Create a board (blank template seeds a "Status" column) ────────────
    const boardName = unique("CustomFields");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    // The board route does a router.refresh() on mount; let it (and the auth
    // session refresh) settle before asserting, so we don't race a /login bounce.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });

    // The seeded Status column header is present.
    const statusMenu = page.getByRole("button", { name: "Status column menu" });
    await expect(statusMenu).toBeVisible({ timeout: 15_000 });

    // ── 4. Edit a Status label: rename "Done" → "Shipped" ─────────────────────
    // Hover the header to reveal the opacity-0 menu button, then open it.
    await page.getByText("Status", { exact: true }).first().hover();
    await statusMenu.click();
    await page.getByRole("menuitem", { name: "Edit labels" }).click();

    const optionsDialog = page.getByRole("dialog");
    await expect(optionsDialog.getByText("Edit labels")).toBeVisible({
      timeout: 10_000,
    });

    // Each option row has an Input aria-labelled "Label for <label>". Rename the
    // "Done" option (its current label is the accessible name) to "Shipped".
    const doneLabel = page.getByLabel("Label for Done");
    await expect(doneLabel).toBeVisible({ timeout: 10_000 });
    await doneLabel.fill("Shipped");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });

    // ── 5. Add an item, set its Status to the renamed option ──────────────────
    const itemName = "Task";
    await page.getByLabel("Add item", { exact: true }).fill(itemName);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: `${itemName} name` }),
    ).toBeVisible({ timeout: 15_000 });

    // The Status cell resting label is "${item.name} ${column.name}" → "Task Status".
    const statusCell = page.getByRole("button", {
      name: "Task Status",
      exact: true,
    });
    await statusCell.click();
    // StatusEditor renders a Radix listbox "Select status" with one option button
    // per label. Pick the renamed "Shipped" option.
    const statusListbox = page.getByRole("listbox", { name: "Select status" });
    await expect(statusListbox).toBeVisible({ timeout: 10_000 });
    await statusListbox.getByRole("option", { name: "Shipped" }).click();

    // The pill (StatusCell OptionPill) now shows the renamed label.
    await expect(statusCell).toContainText("Shipped", { timeout: 10_000 });

    // ── 6. Add a Rating column ────────────────────────────────────────────────
    await page.getByRole("button", { name: "Add column" }).click();
    await page.getByRole("menuitem", { name: "Rating" }).click();
    const ratingMenu = page.getByRole("button", { name: "Rating column menu" });
    await expect(ratingMenu).toBeVisible({ timeout: 15_000 });

    // The rating cell resting label is "Task Rating"; it currently shows "0 of 5".
    const ratingCell = page.getByRole("button", {
      name: "Task Rating",
      exact: true,
    });
    await expect(ratingCell).toBeVisible({ timeout: 10_000 });
    await ratingCell.click();

    // RatingEditor renders a "Set rating" popover (PopoverSurface → role="listbox")
    // with star buttons "<i> stars".
    const ratingPopover = page.getByRole("listbox", { name: "Set rating" });
    await expect(ratingPopover).toBeVisible({ timeout: 10_000 });
    await ratingPopover.getByRole("button", { name: "4 stars" }).click();

    // After commit the cell renders RatingCell with aria-label "4 of 5".
    await expect(page.getByLabel("4 of 5")).toBeVisible({ timeout: 10_000 });

    // Reload → the rating persists (server-authoritative). Let all in-flight
    // requests (the upsertCell for the rating + any auth-session refresh) settle
    // before reloading, otherwise a hard reload can race the session cookie and
    // bounce to /login.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("4 of 5")).toBeVisible({ timeout: 15_000 });

    // ── 7. Add a Files column and upload a file ───────────────────────────────
    await page.getByRole("button", { name: "Add column" }).click();
    await page.getByRole("menuitem", { name: "Files" }).click();
    const filesMenu = page.getByRole("button", { name: "Files column menu" });
    await expect(filesMenu).toBeVisible({ timeout: 15_000 });

    // The empty Files cell shows aria-label "0 files" with an "Add file" button.
    const filesCell = page.getByLabel("0 files");
    await expect(filesCell).toBeVisible({ timeout: 10_000 });

    // Click "Add file" (the paperclip affordance) — it programmatically clicks the
    // hidden multiple file input. Target the input directly with setInputFiles.
    const fileInput = filesCell.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_BASE64, "base64"),
    });

    // After the upload settles (realtime/optimistic), the cell aria-label updates
    // to "1 files" (a thumbnail/icon chip appears).
    await expect(page.getByLabel("1 files")).toBeVisible({ timeout: 30_000 });
  });
});
