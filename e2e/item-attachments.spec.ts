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

// 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test.describe("Item attachments: upload → preview → download → delete", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-attach")}@example.com`;
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

  test("upload a file → card → preview → download 200 → delete", async ({
    page,
  }) => {
    // Full login → onboard → board → item → upload → preview → delete flow is
    // heavy; give it room beyond the default 30s.
    test.setTimeout(120_000);

    // Login.
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // Onboard.
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    // Create board.
    const boardName = unique("Sprint");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    await expect(page.getByText("Group 1")).toBeVisible();

    // Add an item and open its panel.
    const itemName = unique("Task");
    await page.getByLabel("Add item", { exact: true }).fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: `${itemName} name` }).hover();
    await page.getByRole("button", { name: `Open ${itemName}` }).click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Go to the Files tab and upload.
    await panel.getByRole("button", { name: "Files" }).click();
    await panel.locator('input[type="file"]').setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_BASE64, "base64"),
    });

    // Card appears (the realtime/optimistic row).
    await expect(panel.getByText("pixel.png")).toBeVisible({ timeout: 30_000 });

    // Open the preview lightbox (image → Preview action).
    await panel.getByText("pixel.png").hover();
    await panel.getByRole("button", { name: "Preview" }).first().click();
    const lightbox = page.getByRole("dialog").last();
    await expect(lightbox).toBeVisible();

    // Download window.open's the signed URL. Because it's served with
    // Content-Disposition: attachment (the XSS guard), the browser turns it into
    // a file download — so we capture the context download event (set up before
    // the click), assert the filename, and fetch its URL for a real HTTP 200.
    const downloadPromise = page
      .context()
      .waitForEvent("download", { timeout: 20_000 });
    await lightbox.getByRole("button", { name: "Download" }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("pixel.png");
    const resp = await page.request.get(download.url());
    expect(resp.status()).toBe(200);
    await page.keyboard.press("Escape");

    // Delete → card disappears.
    await panel.getByText("pixel.png").hover();
    await panel.getByRole("button", { name: "Delete" }).first().click();
    await expect(panel.getByText("pixel.png")).toHaveCount(0, {
      timeout: 30_000,
    });
  });
});
