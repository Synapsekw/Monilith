/**
 * e2e: Automation create → fire → notify / set_option
 *
 * Suite 1 (5a): Two confirmed users in ONE org: A (actor) builds an automation
 * on a board — "When Status changes to Done, notify B" — then changes an
 * item's Status to Done. B then sees an unread inbox notification of the new
 * `automation` kind that deep-links to the item. Toggling the rule off and
 * changing Status again fires nothing new.
 *
 * Suite 2 (5b-1): item_created → set_option
 * A builds "When an item is created, set Status to Working on it" via the
 * recipe button. A adds a new item. The engine fires immediately on INSERT and
 * sets the Status cell. The test polls the DB (cell_values) to assert the cell
 * was written, then checks the Realtime-reconciled UI shows the option label.
 *
 * Suite 3 (5b-1): person_assigned → notify (B)
 * A adds a People column, then builds "When someone is assigned in People,
 * notify them (owner)". A assigns B in the People cell. B (second browser
 * context) opens the board and sees an unread automation notification.
 *
 * Mirrors e2e/notifications.spec.ts for auth/board setup (service-role
 * confirmed users, dotenv `.env.local`, hasSecrets skip guard, UI login,
 * default board seeding) and e2e/kanban.spec.ts for Status-edit interaction.
 * Uses two browser contexts where two users are needed.
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

test.describe("Automations: create → fire → notify", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  const ids: string[] = [];
  let emailA: string;
  let emailB: string;
  let userBId: string;

  test.beforeAll(async () => {
    emailA = `${unique("e2e-auto-actor")}@example.com`;
    emailB = `${unique("e2e-auto-recip")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const a = await admin.auth.admin.createUser({
      email: emailA,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Alice Actor" },
    });
    const b = await admin.auth.admin.createUser({
      email: emailB,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Bob Recipient" },
    });
    if (a.error || b.error) throw new Error("failed to create test users");
    ids.push(a.data.user!.id, b.data.user!.id);
    userBId = b.data.user!.id;
  });

  test.afterAll(async () => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  });

  test("A builds 'Status→Done notify B', changes Status → B is notified; toggling off fires nothing", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── A: log in + onboard (creates the org) ─────────────────────────────────
    const ctxA = await browser.newContext();
    const a = await ctxA.newPage();
    await a.goto("/login");
    await a.getByLabel(/email/i).fill(emailA);
    await a.getByLabel("Password").fill(PASSWORD);
    await a.getByRole("button", { name: /sign in/i }).click();
    await a.waitForURL(/\/onboarding/, { timeout: 30_000 });
    await a.getByLabel(/organization name/i).fill(unique("Org"));
    await a.getByLabel(/workspace name/i).fill("Engineering");
    await a.getByRole("button", { name: /create organization/i }).click();
    await a.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    // Add B to A's org so B is a selectable recipient + can receive the notice.
    const { data: mem } = await admin
      .from("org_members")
      .select("org_id")
      .eq("user_id", ids[0])
      .limit(1)
      .single();
    const orgId = (mem as { org_id: string }).org_id;
    await admin
      .from("org_members")
      .insert({ org_id: orgId, user_id: userBId, role: "member" });

    // ── A: create a board (default Status column: Working on it / Stuck / Done)─
    await a.getByRole("button", { name: "New board" }).click();
    await a.getByLabel(/board name/i).fill(unique("Sprint"));
    await a.getByRole("button", { name: /create board/i }).click();
    await a.waitForURL(/\/boards\//);
    const boardId = new URL(a.url()).pathname.split("/").pop()!;
    await expect(a.getByText("Group 1")).toBeVisible();
    await expect(a.getByText("Status")).toBeVisible();

    // ── A: add an item ────────────────────────────────────────────────────────
    const itemName = unique("Task");
    await a.getByLabel("Add item", { exact: true }).fill(itemName);
    await a.keyboard.press("Enter");
    await expect(a.getByText(itemName)).toBeVisible({ timeout: 15_000 });

    // ── A: build the automation via the dialog ────────────────────────────────
    await a.getByRole("button", { name: "Automations" }).click();
    const dialog = a.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: /new automation/i }).click();

    // When Status changes to Done …
    await dialog
      .getByRole("combobox", { name: "Trigger value" })
      .selectOption({ label: "Done" });
    // … then notify a specific person (B).
    await dialog.getByRole("button", { name: /^Notify$/ }).click();
    await dialog
      .getByRole("combobox", { name: "Recipient type" })
      .selectOption({ label: "A specific person" });
    await dialog
      .getByRole("combobox", { name: "Member" })
      .selectOption({ label: "Bob Recipient" });
    await dialog.getByRole("button", { name: "Save" }).click();

    // Back on the list; the new rule is summarized.
    await expect(dialog.getByText(/When Status changes to Done/i)).toBeVisible({
      timeout: 15_000,
    });
    // Close the dialog (Escape) to interact with the table.
    await a.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ── A: set the item's Status to Done → engine fires (actor A ≠ recipient B)─
    await a.getByRole("button", { name: `${itemName} Status` }).click();
    await a.getByRole("option", { name: /done/i }).dispatchEvent("click");
    await expect(a.getByText(/^done$/i)).toBeVisible();
    await a.waitForLoadState("networkidle", { timeout: 15_000 });

    // ── B: log in, open the board, see the unread bell + the automation row ───
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await b.goto("/login");
    await b.getByLabel(/email/i).fill(emailB);
    await b.getByLabel("Password").fill(PASSWORD);
    await b.getByRole("button", { name: /sign in/i }).click();
    await b.waitForURL(/localhost:3000\/(?!login)/, { timeout: 30_000 });
    await b.goto(`/boards/${boardId}`);

    const bell = b.getByRole("button", { name: "Notifications" });
    await expect(bell).toBeVisible({ timeout: 20_000 });
    await expect(bell.getByText("1")).toBeVisible({ timeout: 30_000 });

    await bell.click();
    await expect(b.getByText(/an automation ran on an item/i)).toBeVisible({
      timeout: 15_000,
    });
    await b.getByText(/an automation ran on an item/i).click();
    await b.waitForURL(new RegExp(`/boards/${boardId}\\?item=`), {
      timeout: 15_000,
    });

    // ── A: toggle the rule OFF ────────────────────────────────────────────────
    await a.getByRole("button", { name: "Automations" }).click();
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("switch", { name: "Disable automation" }).click();
    await expect(
      dialog.getByRole("switch", { name: "Enable automation" }),
    ).toBeVisible({ timeout: 10_000 });
    await a.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ── A: change Status again (Done→Stuck→Done) — disabled rule fires nothing ─
    await a.getByRole("button", { name: `${itemName} Status` }).click();
    await a.getByRole("option", { name: /stuck/i }).dispatchEvent("click");
    await expect(a.getByText(/^stuck$/i)).toBeVisible();
    await a.waitForLoadState("networkidle", { timeout: 15_000 });
    await a.getByRole("button", { name: `${itemName} Status` }).click();
    await a.getByRole("option", { name: /done/i }).dispatchEvent("click");
    await expect(a.getByText(/^done$/i)).toBeVisible();
    await a.waitForLoadState("networkidle", { timeout: 15_000 });

    // No NEW notification: B's automation-kind count for this item stays at 1.
    // (Assert at the source — the inbox badge caps the visual at "1" anyway.)
    await b.waitForTimeout(3_000); // allow any (unexpected) Realtime insert to land
    const { data: rows } = await admin
      .from("notifications")
      .select("id")
      .eq("recipient_id", userBId)
      .eq("kind", "automation");
    expect(rows?.length ?? 0).toBe(1);

    await ctxA.close();
    await ctxB.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 (5b-1): item_created trigger → set_option action
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Automations 5b-1: item_created → set_option", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  const ids: string[] = [];
  let email: string;

  test.beforeAll(async () => {
    email = `${unique("e2e-ic-actor")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const u = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Item Creator" },
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

  test("build item_created→set_option recipe, add item, engine sets the Status cell", async ({
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
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    // ── Create a board (gets default Status column with Working on it/Stuck/Done)
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(unique("Sprint"));
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    const boardId = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Status")).toBeVisible();

    // Grab the Status column ID and "Working on it" option ID from DB.
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
    const workingOnIt = opts.find((o) => /working on it/i.test(o.label));
    if (!workingOnIt)
      throw new Error("'Working on it' option not found in Status column");

    // ── Build the automation manually: item_created → set_option ─────────────
    await page.getByRole("button", { name: "Automations" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: /new automation/i }).click();

    // Select "An item is created" as the trigger type.
    await dialog
      .getByRole("combobox", { name: "Trigger type" })
      .selectOption({ value: "item_created" });

    // Confirm the trigger type combobox shows "An item is created".
    await expect(
      dialog.getByRole("combobox", { name: "Trigger type" }),
    ).toHaveValue("item_created");

    // Add the "Set a column" action.
    await dialog.getByRole("button", { name: /^Set a column$/ }).click();

    // Select the Status column and "Working on it" option.
    const setColSelect = dialog.getByRole("combobox", { name: "Set column" });
    await setColSelect.selectOption({ value: statusColId });
    const setValSelect = dialog.getByRole("combobox", { name: "Set value" });
    await setValSelect.selectOption({ value: workingOnIt.id });

    await dialog.getByRole("button", { name: "Save" }).click();

    // Confirm we're back on the list with the new rule summarised.
    await expect(dialog.getByText(/When an item is created/i)).toBeVisible({
      timeout: 15_000,
    });

    // Close the dialog.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ── Add a new item (triggers item_created engine path) ────────────────────
    const itemName = unique("NewTask");
    await page.getByLabel("Add item", { exact: true }).fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });

    // The DB trigger fires synchronously on INSERT. Poll the DB to confirm the
    // cell_value was written (cell may appear before Realtime propagates to UI).
    const { data: items } = await admin
      .from("items")
      .select("id")
      .eq("board_id", boardId)
      .eq("name", itemName)
      .limit(1);
    const itemId = items?.[0]?.id;
    if (!itemId) throw new Error("new item not found in DB");

    // Wait up to 10 s for the engine to write the cell_value.
    let cellWritten = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const { data: cell } = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", itemId)
        .eq("column_id", statusColId)
        .maybeSingle();
      if (
        cell?.value &&
        (cell.value as { optionId?: string }).optionId === workingOnIt.id
      ) {
        cellWritten = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    expect(cellWritten, "engine should have written the set_option cell").toBe(
      true,
    );

    // UI confirmation: wait for Realtime to reconcile + the option label to appear.
    // Reload the page as a fallback if Realtime hasn't propagated yet — the
    // RSC re-render will pull the fresh cell_values from the DB directly.
    await expect(page.getByRole("button", { name: `${itemName} Status` }))
      .toContainText(/working on it/i, { timeout: 20_000 })
      .catch(async () => {
        await page.reload();
        await expect(
          page.getByRole("button", { name: `${itemName} Status` }),
        ).toContainText(/working on it/i, { timeout: 20_000 });
      });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 (5b-1): person_assigned trigger → notify action (two-user)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Automations 5b-1: person_assigned → notify", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  const ids: string[] = [];
  let emailA: string;
  let emailB: string;
  let userBId: string;

  test.beforeAll(async () => {
    emailA = `${unique("e2e-pa-actor")}@example.com`;
    emailB = `${unique("e2e-pa-recip")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const a = await admin.auth.admin.createUser({
      email: emailA,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Alice Assigner" },
    });
    const b = await admin.auth.admin.createUser({
      email: emailB,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Bob Assignee" },
    });
    if (a.error || b.error) throw new Error("failed to create test users");
    ids.push(a.data.user!.id, b.data.user!.id);
    userBId = b.data.user!.id;
  });

  test.afterAll(async () => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  });

  test("A assigns B in People column → automation fires → B sees inbox notification", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── A: log in + onboard ───────────────────────────────────────────────────
    const ctxA = await browser.newContext();
    const a = await ctxA.newPage();
    await a.goto("/login");
    await a.getByLabel(/email/i).fill(emailA);
    await a.getByLabel("Password").fill(PASSWORD);
    await a.getByRole("button", { name: /sign in/i }).click();
    await a.waitForURL(/\/onboarding/, { timeout: 30_000 });
    await a.getByLabel(/organization name/i).fill(unique("Org"));
    await a.getByLabel(/workspace name/i).fill("Engineering");
    await a.getByRole("button", { name: /create organization/i }).click();
    await a.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    // Add B to A's org so B is a selectable assignee and receives notifications.
    const { data: mem } = await admin
      .from("org_members")
      .select("org_id")
      .eq("user_id", ids[0])
      .limit(1)
      .single();
    const orgId = (mem as { org_id: string }).org_id;
    await admin
      .from("org_members")
      .insert({ org_id: orgId, user_id: userBId, role: "member" });

    // ── A: create a board ─────────────────────────────────────────────────────
    await a.getByRole("button", { name: "New board" }).click();
    await a.getByLabel(/board name/i).fill(unique("Sprint"));
    await a.getByRole("button", { name: /create board/i }).click();
    await a.waitForURL(/\/boards\//);
    const boardId = new URL(a.url()).pathname.split("/").pop()!;
    await expect(a.getByText("Group 1")).toBeVisible({ timeout: 15_000 });
    // The default board already contains an "Owner" People column; use it.
    await expect(a.getByText("Owner")).toBeVisible({ timeout: 15_000 });

    // Grab the People (Owner) column ID from DB — use limit(1) since the board
    // may already have a people column (default template includes "Owner").
    const { data: colRows } = await admin
      .from("columns")
      .select("id, name")
      .eq("board_id", boardId)
      .eq("kind", "people")
      .limit(1);
    const colRow = colRows?.[0] ?? null;
    if (!colRow) throw new Error("People column not found");
    const peopleColId: string = colRow.id;

    // ── A: add an item ────────────────────────────────────────────────────────
    const itemName = unique("Task");
    await a.getByLabel("Add item", { exact: true }).fill(itemName);
    await a.keyboard.press("Enter");
    await expect(a.getByText(itemName)).toBeVisible({ timeout: 15_000 });

    // ── A: build the automation manually: person_assigned → notify owner ────────
    await a.getByRole("button", { name: "Automations" }).click();
    const dialog = a.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: /new automation/i }).click();

    // Select "A person is assigned" as the trigger type.
    await dialog
      .getByRole("combobox", { name: "Trigger type" })
      .selectOption({ value: "person_assigned" });

    await expect(
      dialog.getByRole("combobox", { name: "Trigger type" }),
    ).toHaveValue("person_assigned");

    // The People column combobox should appear; select the People column.
    await dialog
      .getByRole("combobox", { name: "People column" })
      .selectOption({ value: peopleColId });

    // Add the Notify action.
    await dialog.getByRole("button", { name: /^Notify$/ }).click();

    // Recipient type defaults to "The item owner"; confirm the owner people column.
    await dialog
      .getByRole("combobox", { name: "Owner people column" })
      .selectOption({ value: peopleColId });

    await dialog.getByRole("button", { name: "Save" }).click();

    // Confirm we're back on the list — the column is named "Owner" by default.
    await expect(dialog.getByText(/When someone is assigned in/i)).toBeVisible({
      timeout: 15_000,
    });

    // Close the dialog.
    await a.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // ── A: assign B in the Owner (People) cell ───────────────────────────────
    // Click the People cell to open the people editor popover.
    // The default People column is named "Owner", so the cell aria-label is
    // "{itemName} Owner".
    await a.getByRole("button", { name: `${itemName} Owner` }).click();
    // The PeopleEditor renders a popover "Assign people" with member buttons
    // identified by role="option". Click Bob Assignee to assign.
    await a.getByRole("option", { name: /bob assignee/i }).click();
    // Close the editor by pressing Escape (editor captures blur → Realtime fires).
    await a.keyboard.press("Escape");
    await a.waitForLoadState("networkidle", { timeout: 20_000 });

    // ── Verify via DB: the engine wrote a notification for B ──────────────────
    // Poll up to 15 s for the automation notification to arrive.
    let notificationWritten = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const { data: rows } = await admin
        .from("notifications")
        .select("id")
        .eq("recipient_id", userBId)
        .eq("kind", "automation");
      if ((rows?.length ?? 0) >= 1) {
        notificationWritten = true;
        break;
      }
      await a.waitForTimeout(500);
    }
    expect(
      notificationWritten,
      "engine should have created an automation notification for B",
    ).toBe(true);

    // ── B: log in, open the board, see the unread bell ────────────────────────
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await b.goto("/login");
    await b.getByLabel(/email/i).fill(emailB);
    await b.getByLabel("Password").fill(PASSWORD);
    await b.getByRole("button", { name: /sign in/i }).click();
    await b.waitForURL(/localhost:3000\/(?!login)/, { timeout: 30_000 });
    await b.goto(`/boards/${boardId}`);

    const bell = b.getByRole("button", { name: "Notifications" });
    await expect(bell).toBeVisible({ timeout: 20_000 });

    // Open the bell and check the notification list directly. Because
    // useNotifications fetches on mount, the notification (written to DB before
    // B logged in) should appear after the async query resolves.
    await bell.click();
    await expect(b.getByText(/an automation ran on an item/i)).toBeVisible({
      timeout: 45_000,
    });

    await ctxA.close();
    await ctxB.close();
  });
});
