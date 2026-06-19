/**
 * e2e: Phase 5b-2 — date-based automation tests
 *
 * Test 1 (settings timezone persists):
 *   Log in → onboard → /settings → change timezone select → Save → reload →
 *   assert select shows the new value AND assert via admin client that
 *   organizations.timezone was updated.
 *
 * Test 2 (date rule fires via sweep through the UI builder):
 *   Log in → onboard → create board → add Date + Status columns via the UI →
 *   add item → set date cell via admin client (to keep the UI path deterministic)
 *   → set org timezone to Asia/Tokyo via admin client →
 *   open Automations dialog → BUILD a date_reached rule via the UI builder →
 *   Save → invoke _automation_date_sweep via admin RPC → poll DB + UI to assert
 *   the item's Status cell becomes "Working".
 *
 * Mirrors e2e/automations.spec.ts exactly:
 *   - service-role admin client pattern
 *   - PASSWORD constant, unique() helper
 *   - beforeAll user creation, afterAll cleanup
 *   - UI login flow + onboarding steps
 *   - board/column/item creation patterns
 *   - Automations dialog interactions (combobox selectOption, button clicks)
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

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Settings timezone persists
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Settings: timezone persists", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  const ids: string[] = [];
  let email: string;

  test.beforeAll(async () => {
    email = `${unique("e2e-tz")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const u = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Tz User" },
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

  test("change timezone in /settings, reload, assert new value persists in UI and DB", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Log in + onboard ──────────────────────────────────────────────────────
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
    await page.getByLabel(/organization name/i).fill(unique("TzOrg"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    // ── Grab org ID via admin client ──────────────────────────────────────────
    const { data: mem } = await admin
      .from("org_members")
      .select("org_id")
      .eq("user_id", ids[0])
      .limit(1)
      .single();
    const orgId = (mem as { org_id: string }).org_id;

    // ── Navigate to /settings ─────────────────────────────────────────────────
    await page.goto("/settings");
    const tzSelect = page.locator("#timezone-select");
    await expect(tzSelect).toBeVisible({ timeout: 15_000 });

    // Pick a distinctive timezone that's unlikely to be the default.
    const targetTz = "Asia/Tokyo";

    // Change the select.
    await tzSelect.selectOption({ value: targetTz });
    await expect(tzSelect).toHaveValue(targetTz);

    // Click Save.
    await page.getByRole("button", { name: /^Save$/i }).click();

    // Wait for the "Saved." confirmation message.
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });

    // ── Reload and assert the select still shows the new timezone ─────────────
    await page.reload();
    await expect(page.locator("#timezone-select")).toHaveValue(targetTz, {
      timeout: 15_000,
    });

    // ── Assert via admin DB that organizations.timezone was updated ───────────
    const { data: org } = await admin
      .from("organizations")
      .select("timezone")
      .eq("id", orgId)
      .single();
    expect((org as { timezone: string }).timezone).toBe(targetTz);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Date rule fires via the sweep (through the UI builder)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Automations 5b-2: date_reached → set_option via UI builder", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  const ids: string[] = [];
  let email: string;

  test.beforeAll(async () => {
    email = `${unique("e2e-dr")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const u = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Date Rule User" },
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

  test("build date_reached rule via UI builder, sweep fires, item Status becomes Working", async ({
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
    await page.getByLabel(/organization name/i).fill(unique("DrOrg"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    // ── Grab org ID ───────────────────────────────────────────────────────────
    const { data: mem } = await admin
      .from("org_members")
      .select("org_id")
      .eq("user_id", ids[0])
      .limit(1)
      .single();
    const orgId = (mem as { org_id: string }).org_id;

    // ── Create a board ────────────────────────────────────────────────────────
    await page.getByRole("button", { name: "New board" }).click();
    const boardName = unique("Sprint");
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    const boardId = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Status")).toBeVisible();

    // ── Add a Date column via the UI ──────────────────────────────────────────
    await page.getByRole("button", { name: "Add column" }).click();
    await page.getByRole("menuitem", { name: "Date" }).click();
    // The column header "Date" should now appear in the board.
    await expect(page.getByText("Date").first()).toBeVisible({
      timeout: 15_000,
    });

    // ── Add a Status column named "Working" via admin (board already has one) ─
    // The default board ships with a "Status" column that has Working on it /
    // Stuck / Done options. We'll use that existing column directly.
    // Fetch the Status column and "Working on it" option from DB.
    const { data: statusCols } = await admin
      .from("columns")
      .select("id, settings")
      .eq("board_id", boardId)
      .eq("kind", "status")
      .limit(1);
    const statusCol = statusCols?.[0];
    if (!statusCol) throw new Error("Status column not found");
    const statusColId: string = statusCol.id;
    const opts: { id: string; label: string }[] =
      (statusCol.settings as { options?: { id: string; label: string }[] })
        ?.options ?? [];
    const workingOpt = opts.find((o) => /working on it/i.test(o.label));
    if (!workingOpt)
      throw new Error("'Working on it' option not found in Status column");

    // Fetch the Date column we just added.
    const { data: dateCols } = await admin
      .from("columns")
      .select("id")
      .eq("board_id", boardId)
      .eq("kind", "date")
      .limit(1);
    const dateCol = dateCols?.[0];
    if (!dateCol) throw new Error("Date column not found");
    const dateColId: string = dateCol.id;

    // ── Add an item ───────────────────────────────────────────────────────────
    const itemName = unique("TaskDate");
    await page.getByLabel("Add item", { exact: true }).fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });

    // Grab the item ID from DB.
    const { data: items } = await admin
      .from("items")
      .select("id")
      .eq("board_id", boardId)
      .eq("name", itemName)
      .limit(1);
    const itemId = items?.[0]?.id;
    if (!itemId) throw new Error("Item not found in DB");

    // ── Set the item's Date cell via admin client ─────────────────────────────
    // p_now = "2026-07-10T23:00:00Z" → Asia/Tokyo local = 2026-07-11 08:00
    // So the item's date cell should be "2026-07-11" (Tokyo local date).
    const itemDate = "2026-07-11";
    const { error: cellErr } = await admin.from("cell_values").upsert(
      {
        org_id: orgId,
        board_id: boardId,
        item_id: itemId,
        column_id: dateColId,
        value: { date: itemDate },
      },
      { onConflict: "item_id,column_id" },
    );
    if (cellErr) throw new Error(`Failed to set date cell: ${cellErr.message}`);

    // ── Set org timezone to Asia/Tokyo via admin client ───────────────────────
    const { error: tzErr } = await admin
      .from("organizations")
      .update({ timezone: "Asia/Tokyo" })
      .eq("id", orgId);
    if (tzErr) throw new Error(`Failed to set org timezone: ${tzErr.message}`);

    // ── Open Automations dialog and BUILD a date_reached rule via the UI ──────
    await page.getByRole("button", { name: "Automations" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: /new automation/i }).click();

    // 1. Select "Date reached" as trigger type.
    await dialog
      .getByRole("combobox", { name: "Trigger type" })
      .selectOption({ value: "date_reached" });

    await expect(
      dialog.getByRole("combobox", { name: "Trigger type" }),
    ).toHaveValue("date_reached");

    // 2. The Date column picker should now be visible; select our date column.
    await expect(
      dialog.getByRole("combobox", { name: "Date column" }),
    ).toBeVisible({ timeout: 10_000 });
    await dialog
      .getByRole("combobox", { name: "Date column" })
      .selectOption({ value: dateColId });

    // 3. Select "On the date" direction.
    await dialog
      .getByRole("combobox", { name: "Direction" })
      .selectOption({ value: "on" });

    await expect(
      dialog.getByRole("combobox", { name: "Direction" }),
    ).toHaveValue("on");

    // 4. Add "Set a column" action.
    await dialog.getByRole("button", { name: /^Set a column$/ }).click();

    // 5. Select the Status column.
    const setColSelect = dialog.getByRole("combobox", { name: "Set column" });
    await setColSelect.selectOption({ value: statusColId });

    // 6. Select "Working on it" option.
    const setValSelect = dialog.getByRole("combobox", { name: "Set value" });
    await setValSelect.selectOption({ value: workingOpt.id });

    // 7. Save the rule.
    await dialog.getByRole("button", { name: "Save" }).click();

    // Confirm we're back on the list: the "New automation" button (only visible in
    // list mode) should appear. The builder Cancel button should disappear.
    await expect(
      dialog.getByRole("button", { name: /new automation/i }),
    ).toBeVisible({ timeout: 20_000 });

    // The list summary for a date_reached/offset-0 rule is:
    // "When Date is reached, set Status to Working on it."
    // We assert this text to confirm the rule was actually persisted and is shown.
    await expect(dialog.getByText(/When Date is reached/i)).toBeVisible({
      timeout: 15_000,
    });

    // Close the dialog.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ── Invoke _automation_date_sweep via admin RPC ───────────────────────────
    // p_now = "2026-07-10T23:00:00Z" → Tokyo local = 2026-07-11 08:00
    // This should match the item's date cell "2026-07-11" at offset 0.
    const pNow = "2026-07-10T23:00:00Z";
    const { error: sweepErr } = await admin.rpc("_automation_date_sweep", {
      p_now: pNow,
    });
    if (sweepErr) throw new Error(`Sweep RPC failed: ${sweepErr.message}`);

    // ── Poll DB: item's Status cell should become "Working on it" ─────────────
    let cellWritten = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const { data: cell } = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", itemId)
        .eq("column_id", statusColId)
        .maybeSingle();
      if (
        cell?.value &&
        (cell.value as { optionId?: string }).optionId === workingOpt.id
      ) {
        cellWritten = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    expect(
      cellWritten,
      "sweep should have written the set_option cell to Working on it",
    ).toBe(true);

    // ── UI confirmation: reload and check the Status cell label ───────────────
    await page.reload();
    await expect(page.getByRole("button", { name: `${itemName} Status` }))
      .toContainText(/working on it/i, { timeout: 20_000 })
      .catch(async () => {
        // Realtime may not have propagated — force a second reload.
        await page.reload();
        await expect(
          page.getByRole("button", { name: `${itemName} Status` }),
        ).toContainText(/working on it/i, { timeout: 20_000 });
      });
  });
});
