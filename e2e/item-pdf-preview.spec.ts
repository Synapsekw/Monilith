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

// Minimal one-page PDF. PDF.js rebuilds the xref table if offsets are off, so a
// hand-written body is sufficient for a render smoke test.
const PDF_BYTES = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 18 Tf 20 100 Td (Pulse PDF) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
trailer<< /Root 1 0 R /Size 6 >>
%%EOF`;

test.describe("Item PDF preview: upload → lightbox renders inline", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-pdf")}@example.com`;
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

  test("upload a PDF → lightbox renders a canvas + page count", async ({
    page,
  }) => {
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

    // Go to the Files tab and upload the PDF.
    await panel.getByRole("button", { name: "Files" }).click();
    await panel.locator('input[type="file"]').setInputFiles({
      name: "doc.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(PDF_BYTES, "utf8"),
    });
    await expect(panel.getByText("doc.pdf")).toBeVisible({ timeout: 30_000 });

    // Open the lightbox via the now-available Preview affordance for PDFs.
    await panel.getByText("doc.pdf").hover();
    await panel.getByRole("button", { name: "Preview" }).first().click();

    const lightbox = page.getByRole("dialog").last();
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator("canvas").first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(lightbox.getByText(/1 page/i)).toBeVisible();
  });
});
