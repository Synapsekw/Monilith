/**
 * e2e: Automation create → fire → notify
 *
 * Two confirmed users in ONE org: A (actor) builds an automation on a board —
 * "When Status changes to Done, notify B" — then changes an item's Status to
 * Done. B then sees an unread inbox notification of the new `automation` kind
 * that deep-links to the item. Toggling the rule off and changing Status again
 * fires nothing new.
 *
 * Mirrors e2e/notifications.spec.ts for auth/board setup (service-role confirmed
 * users, dotenv `.env.local`, hasSecrets skip guard, UI login, default board
 * seeding) and e2e/kanban.spec.ts for the Table-side Status edit interaction.
 * Uses two browser contexts so A and B have independent sessions.
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
