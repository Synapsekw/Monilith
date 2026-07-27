/**
 * e2e: the /ask full-page surface — it loads for an authenticated user, the
 * rail and composer render, and the first send mints a conversation and
 * rewrites the URL to /ask/<id>.
 *
 * Auth strategy: mirrors command-palette.spec.ts exactly — a CONFIRMED user
 * created via the service-role admin API in `beforeAll`, driven through the UI
 * /login page. New users land in /onboarding and must create an org/workspace
 * first.
 *
 * DELIBERATE LIMIT: this spec stops at the user turn. Driving the model
 * round-trip would need a live Anthropic key plus credits and a
 * non-deterministic answer — a flake and cost generator, not a test. The
 * propose → confirm → approve half is covered deterministically by
 * MessageList.test.tsx and AskChat.test.tsx with mocked Server Actions.
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

test.describe("Ask AI: the /ask surface", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping ask e2e");

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-ask")}@example.com`;

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

  test("the /ask surface loads and starts a conversation", async ({ page }) => {
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

    // ── 3. The Ask surface ────────────────────────────────────────────────────
    await page.goto("/ask");

    // Layout B: the conversation rail replaces the Monolith nav.
    await expect(
      page.getByRole("link", { name: /back to monolith/i }),
    ).toBeVisible();

    const composer = page.getByLabel("Your question");
    await expect(composer).toBeVisible();

    // Empty state before anything is asked.
    await expect(
      page.getByText(/answers are grounded in your real data/i),
    ).toBeVisible();

    await composer.fill("what is overdue?");
    // ⌘/Ctrl+Enter sends (Composer's keydown guard) — ControlOrMeta keeps it
    // correct on both macOS and Linux CI.
    await composer.press("ControlOrMeta+Enter");

    // createConversation mints the row and the History API rewrites the URL with
    // no RSC navigation. The user's own turn is echoed immediately.
    await expect(page).toHaveURL(/\/ask\/[0-9a-f-]{36}$/);
    await expect(page.getByText("what is overdue?")).toBeVisible();
  });
});
