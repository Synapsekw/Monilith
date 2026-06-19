/**
 * e2e: Automation run-history (Phase 5c-1)
 *
 * Suite: status_changed → set_option fires → run appears in "Recent runs".
 *
 * A single user builds a rule "When Status changes to Done, set Status to
 * Working on it" via the dialog builder, then changes an item's Status to Done.
 * The engine writes an automation_run with status='ran'. The test then opens
 * the Automations dialog, expands the rule's "Recent runs" disclosure, and
 * asserts that a run row appears with a "Ran" badge and "set status" outcome.
 *
 * Models e2e/automations.spec.ts exactly: dotenv load, admin service-client
 * seeding, UI login + onboard, board creation, item creation, dialog builder
 * interaction, and teardown via admin.auth.admin.deleteUser.
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

test.describe("Automations 5c-1: run-history disclosure", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  const ids: string[] = [];
  let email: string;

  test.beforeAll(async () => {
    email = `${unique("e2e-rh-actor")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const u = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Run History Actor" },
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

  test("build status_changed→set_option rule, fire it, see 'Ran' + 'set status' in Recent runs", async ({
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

    // Fetch the Status column and its option IDs from the DB so we can select
    // the correct options in the builder dropdowns.
    const { data: col } = await admin
      .from("columns")
      .select("id, settings")
      .eq("board_id", boardId)
      .eq("kind", "status")
      .single();
    if (!col) throw new Error("Status column not found");
    const statusColId: string = col.id;
    const opts: { id: string; label: string }[] =
      (col.settings as { options?: { id: string; label: string }[] })
        ?.options ?? [];
    const doneOpt = opts.find((o) => /^done$/i.test(o.label));
    const workingOpt = opts.find((o) => /working on it/i.test(o.label));
    if (!doneOpt) throw new Error("'Done' option not found in Status column");
    if (!workingOpt)
      throw new Error("'Working on it' option not found in Status column");

    // ── Add an item ───────────────────────────────────────────────────────────
    const itemName = unique("Task");
    await page.getByLabel("Add item", { exact: true }).fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });

    // ── Build the automation: status_changed (Done) → set_option (Working on it)
    await page.getByRole("button", { name: "Automations" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: /new automation/i }).click();

    // Trigger type defaults to "A status or dropdown changes" (status_changed).
    // Select "Done" as the trigger value.
    await dialog
      .getByRole("combobox", { name: "Trigger value" })
      .selectOption({ value: doneOpt.id });

    // Add the "Set a column" action.
    await dialog.getByRole("button", { name: /^Set a column$/ }).click();

    // Select the Status column and "Working on it" option for the set_option action.
    const setColSelect = dialog.getByRole("combobox", { name: "Set column" });
    await setColSelect.selectOption({ value: statusColId });
    const setValSelect = dialog.getByRole("combobox", { name: "Set value" });
    await setValSelect.selectOption({ value: workingOpt.id });

    await dialog.getByRole("button", { name: "Save" }).click();

    // Back on the list — confirm the rule summary is visible.
    await expect(dialog.getByText(/When Status changes to Done/i)).toBeVisible({
      timeout: 15_000,
    });

    // Close the dialog to interact with the table.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ── Change the item's Status to Done → engine fires ───────────────────────
    await page.getByRole("button", { name: `${itemName} Status` }).click();
    await page.getByRole("option", { name: /^done$/i }).dispatchEvent("click");
    await expect(page.getByText(/^done$/i)).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    // ── Poll DB: wait for the engine to write the automation_run ─────────────
    // The DB trigger fires synchronously on cell_values UPDATE; the run row
    // should appear almost immediately. Poll up to 15 s as a safety net.
    let runId: string | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      // We can't query automation_runs directly via the service-role anon client
      // without knowing the automation_id, so we look it up first.
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

    // ── Open Automations dialog → expand "Recent runs" → assert badge + text ─
    await page.getByRole("button", { name: "Automations" }).click();
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // The "Recent runs" button is inside the rule card — click it to expand.
    const recentRunsBtn = dialog.getByRole("button", { name: /recent runs/i });
    await expect(recentRunsBtn).toBeVisible({ timeout: 10_000 });
    await recentRunsBtn.click();

    // After expansion the component lazily fetches; wait for the "Ran" badge.
    await expect(dialog.getByText("Ran")).toBeVisible({ timeout: 15_000 });

    // Also assert the outcome summary text includes "set status" (the truncate
    // span rendered by formatRunSummary). Use exact text to avoid matching the
    // rule summary line ("set Status to Working on it") which also contains the
    // words "set status".
    await expect(dialog.getByText("set status", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});
