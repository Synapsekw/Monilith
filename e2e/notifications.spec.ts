/**
 * e2e: @mention → recipient notification inbox
 *
 * Two confirmed users in ONE org: A (actor) mentions B (recipient) in an item
 * update; B then sees an unread inbox notification and can deep-link to the item.
 * B is added to A's org via the service-role admin API once A has onboarded.
 *
 * Mirrors e2e/item-panel.spec.ts for auth/board setup. Uses two browser
 * contexts so A and B have independent sessions.
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

test.describe("@mention notifications", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  const ids: string[] = [];
  let emailA: string;
  let emailB: string;
  let userBId: string;

  test.beforeAll(async () => {
    emailA = `${unique("e2e-actor")}@example.com`;
    emailB = `${unique("e2e-recip")}@example.com`;
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

  test("A mentions B → B sees an unread inbox row that deep-links to the item", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
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

    // Add B to A's org (so B is a selectable mention + can receive it).
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

    // ── A: create a board + item ──────────────────────────────────────────────
    await a.getByRole("button", { name: "New board" }).click();
    await a.getByLabel(/board name/i).fill(unique("Sprint"));
    await a.getByRole("button", { name: /create board/i }).click();
    await a.waitForURL(/\/boards\//);
    const boardUrl = new URL(a.url());
    const boardId = boardUrl.pathname.split("/").pop()!;
    await expect(a.getByText("Group 1")).toBeVisible();

    const itemName = unique("Task");
    await a.getByLabel("Add item", { exact: true }).fill(itemName);
    await a.keyboard.press("Enter");
    await expect(a.getByText(itemName)).toBeVisible({ timeout: 15_000 });

    // ── A: open the panel + post an update mentioning Bob ─────────────────────
    await a.getByRole("button", { name: `${itemName} name` }).hover();
    await a.getByRole("button", { name: `Open ${itemName}` }).click();
    const panel = a.getByRole("dialog");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await panel.getByRole("button", { name: "Write an update" }).click();
    const composer = panel.getByRole("textbox");
    await composer.fill("Please review @Bob");
    // The autocomplete lists matching members; pick Bob.
    await panel.getByText("Bob Recipient").click();
    // Caret now after "@Bob Recipient "; finish the sentence + submit.
    await composer.press("End");
    await composer.type("thanks");
    await panel.getByRole("button", { name: "Update", exact: true }).click();
    await expect(panel.getByText(/review/i)).toBeVisible({ timeout: 15_000 });

    // ── B: log in, open the board, see the unread bell + inbox row ────────────
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await b.goto("/login");
    await b.getByLabel(/email/i).fill(emailB);
    await b.getByLabel("Password").fill(PASSWORD);
    await b.getByRole("button", { name: /sign in/i }).click();
    // B is already a member of an org → lands at "/"; go to the board (the bell
    // lives in the board shell).
    await b.waitForURL(/localhost:3000\/(?!login)/, { timeout: 30_000 });
    await b.goto(`/boards/${boardId}`);

    const bell = b.getByRole("button", { name: "Notifications" });
    await expect(bell).toBeVisible({ timeout: 20_000 });
    // Unread badge present.
    await expect(bell.getByText("1")).toBeVisible({ timeout: 20_000 });

    await bell.click();
    await expect(b.getByText(/mentioned you in an update/i)).toBeVisible({
      timeout: 15_000,
    });
    await b.getByText(/mentioned you in an update/i).click();
    await b.waitForURL(new RegExp(`/boards/${boardId}\\?item=`), {
      timeout: 15_000,
    });

    await ctxA.close();
    await ctxB.close();
  });
});
