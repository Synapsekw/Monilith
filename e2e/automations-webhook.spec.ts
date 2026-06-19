/**
 * e2e: Automation webhook rule (Phase 5c-2)
 *
 * Suite: status_changed → call_webhook fires → run appears in "Recent runs"
 * with "webhook queued" outcome text.
 *
 * An owner builds a rule "When Status changes (any value), call a webhook at
 * https://example.com/hook" via the dialog builder, then changes an item's
 * Status. The engine writes an automation_run with status='ran' and an action
 * outcome of 'queued'. The test then opens the Automations dialog, expands the
 * rule's "Recent runs" disclosure, and asserts the "webhook queued" text.
 *
 * NOTE: We do NOT assert delivery (delivered/failed) — that is async/manual.
 * Only the synchronous "queued" outcome is verified.
 *
 * Mirrors e2e/automations-runs.spec.ts exactly: dotenv load, admin
 * service-client seeding, UI login + onboard, board creation, item creation,
 * dialog builder interaction, DB poll, and teardown via
 * admin.auth.admin.deleteUser.
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

test.describe("Automations 5c-2: webhook rule → queued run", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  const ids: string[] = [];
  let email: string;

  test.beforeAll(async () => {
    email = `${unique("e2e-wh-actor")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const u = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Webhook Actor" },
    });
    if (u.error) throw new Error("failed to create test user");
    ids.push(u.data.user!.id);
  });

  test.afterAll(async () => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  });

  test("admin builds a webhook rule and sees a queued run", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Log in + onboard ──────────────────────────────────────────────────────
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    // ── Create a board (seeds default Status column: Working on it / Stuck / Done)
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(unique("Sprint"));
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    const boardId = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Status")).toBeVisible();

    // ── Add an item ───────────────────────────────────────────────────────────
    const itemName = unique("Task");
    await page.getByLabel("Add item", { exact: true }).fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });

    // ── Build the automation: status_changed (any value) → call_webhook ───────
    await page.getByRole("button", { name: "Automations" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: /new automation/i }).click();

    // Trigger type defaults to "A status or dropdown changes" (status_changed).
    // Leave "Changes to" at the default (Any value) — no need to pick an option.

    // Add the "Call a webhook" action (only shown when canWebhook=true i.e. isAdmin).
    await dialog.getByRole("button", { name: /^Call a webhook$/ }).click();

    // Fill in the Webhook URL field.
    await dialog.getByLabel(/webhook url/i).fill("https://example.com/hook");

    // Save the rule.
    await dialog.getByRole("button", { name: "Save" }).click();

    // Back on the list — confirm the rule summary mentions "call a webhook".
    // Use exact text from summarize(): "…, call a webhook." (ends with a period).
    // We match on the paragraph element to avoid the recipe button ambiguity.
    await expect(dialog.getByText(/call a webhook\./i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Close the dialog to interact with the table.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ── Change the item's Status to trigger the automation ────────────────────
    // Use dispatchEvent("click") on the option to bypass any pointer-event guards,
    // matching the pattern in automations-runs.spec.ts.
    await page.getByRole("button", { name: `${itemName} Status` }).click();
    await page.getByRole("option", { name: /^done$/i }).dispatchEvent("click");
    await expect(page.getByText(/^done$/i)).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    // ── Poll DB: wait for the engine to write the automation_run ─────────────
    // The DB trigger fires synchronously on cell_values UPDATE; the run row
    // should appear almost immediately. Poll up to 15 s as a safety net.
    let runId: string | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const { data: rules } = await admin
        .from("automations")
        .select("id")
        .eq("board_id", boardId)
        .limit(1);
      const automationId = rules?.[0]?.id;
      if (automationId) {
        const { data: runs } = await admin
          .from("automation_runs")
          .select("id, status")
          .eq("automation_id", automationId)
          .eq("status", "ran")
          .limit(1);
        if (runs?.[0]?.id) {
          runId = runs[0].id;
          break;
        }
      }
      await page.waitForTimeout(500);
    }
    expect(
      runId,
      "engine should have written an automation_run with status=ran",
    ).not.toBeNull();

    // ── Open Automations dialog → expand "Recent runs" → assert "webhook queued"
    await page.getByRole("button", { name: "Automations" }).click();
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // The "Recent runs" button is inside the rule card — click it to expand.
    const recentRunsBtn = dialog.getByRole("button", { name: /recent runs/i });
    await expect(recentRunsBtn).toBeVisible({ timeout: 10_000 });
    await recentRunsBtn.click();

    // After expansion the component lazily fetches; wait for the "Ran" badge.
    await expect(dialog.getByText("Ran")).toBeVisible({ timeout: 15_000 });

    // Assert the outcome summary text shows "webhook queued".
    // This is the exact string produced by formatRunSummary for call_webhook
    // with outcome='queued' (see src/lib/boards/automation-runs.ts).
    await expect(dialog.getByText(/webhook queued/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
