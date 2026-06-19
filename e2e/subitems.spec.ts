/**
 * e2e: Subitems — create / nest / rename / set-cell / reorder / rollup / delete
 *
 * Flow (one test, shared page session):
 *   1.  Log in → onboard → create a board with a Numbers column.
 *   2.  Create a top-level item "Epic".
 *   3.  Hover "Epic"'s name cell → click "Add subitem to Epic" → rename to "Design".
 *   4.  Add a second subitem "Build" via the inline AddSubitemRow input.
 *   5.  Set the Numbers cell on "Design" to 5; set "Build"'s Numbers cell to 8.
 *   6.  Drag "Build" above "Design" via the "Reorder Build" grip handle; assert order.
 *   7.  Collapse "Epic" (click its chevron); assert rollup "Σ 13" appears.
 *   8.  Expand "Epic"; open "Design"'s row menu → Delete; assert it's gone.
 *
 * Auth strategy: a CONFIRMED user created via the service-role admin API in
 * `beforeAll`, driven through the UI /login page — same pattern as all other
 * e2e specs in this project (boards.spec.ts, board-columns.spec.ts, etc.).
 *
 * If Supabase secrets are absent the entire describe block is skipped gracefully
 * (no hard failure in CI).
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

test.describe("Subitems: create / nest / reorder / rollup / delete", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping subitems e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-subitems")}@example.com`;
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

  test("create, nest, edit, reorder, rollup, and delete subitems", async ({
    page,
  }) => {
    test.setTimeout(300_000);

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

    // ── 3. Create a board ─────────────────────────────────────────────────────
    const boardName = unique("Backlog");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });

    // ── 4. Add a Numbers column ───────────────────────────────────────────────
    await page.getByRole("button", { name: "Add column" }).click();
    await page.getByRole("menuitem", { name: "Numbers" }).click();
    // Wait for the column header to appear (server-authoritative via Realtime).
    const numbersMenu = page.getByRole("button", {
      name: "Numbers column menu",
    });
    await expect(numbersMenu).toBeVisible({ timeout: 15_000 });

    // ── 5. Create the top-level item "Epic" ───────────────────────────────────
    await page.getByLabel("Add item", { exact: true }).fill("Epic");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Epic")).toBeVisible({ timeout: 15_000 });

    // ── 5b. Create a second top-level item, then drag it above "Epic" ─────────
    // Reuses the same group's "Add item" input. After Enter the input clears,
    // so we re-fill it for "Story".
    const itemInput = page.getByLabel("Add item", { exact: true });
    await itemInput.fill("Story");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Story name" })).toBeVisible({
      timeout: 10_000,
    });

    const storyHandle = page.getByRole("button", { name: "Reorder Story" });
    const epicHandle = page.getByRole("button", { name: "Reorder Epic" });

    // Hover the row to reveal the opacity-0 handle, then drag.
    await page.getByRole("button", { name: "Story name" }).hover();
    await expect(storyHandle).toBeVisible({ timeout: 10_000 });
    const storyBox = await storyHandle.boundingBox();
    const epicBox = await epicHandle.boundingBox();
    expect(storyBox, "Story drag handle must be visible").not.toBeNull();
    expect(epicBox, "Epic drag handle must be visible").not.toBeNull();

    const storyCx = storyBox!.x + storyBox!.width / 2;
    const storyCy = storyBox!.y + storyBox!.height / 2;
    const epicCy = epicBox!.y + epicBox!.height / 2;

    await page.mouse.move(storyCx, storyCy);
    await page.mouse.down();
    // Move in small steps to satisfy dnd-kit's activationConstraint (distance ≥ 6px).
    await page.mouse.move(storyCx, storyCy - 4);
    await page.mouse.move(storyCx, storyCy - 8);
    await page.mouse.move(storyCx, epicCy - 4);
    await page.mouse.up();

    // Wait for the reorderItem Server Action to settle.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // Assert "Story" is now the first top-level row (above "Epic").
    const firstItem = page
      .locator('[aria-label="Story name"], [aria-label="Epic name"]')
      .first();
    await expect(firstItem).toHaveAttribute("aria-label", "Story name", {
      timeout: 10_000,
    });

    // ── 6. Add the first subitem: hover "Epic" name → click "Add subitem to Epic"
    // The button is opacity-0 until the name cell is hovered (group-hover/name).
    // Playwright's hover() triggers CSS :hover so it becomes visible.
    const epicNameCell = page.getByRole("button", { name: "Epic name" });
    await epicNameCell.hover();
    const addSubitemBtn = page.getByRole("button", {
      name: "Add subitem to Epic",
    });
    await expect(addSubitemBtn).toBeVisible({ timeout: 5_000 });
    await addSubitemBtn.click();

    // The addSubitem action auto-expands the parent and enters rename mode on
    // the new subitem. The rename input for "New subitem" should appear.
    const designRenameInput = page.getByLabel("Rename New subitem");
    await expect(designRenameInput).toBeVisible({ timeout: 15_000 });
    await designRenameInput.fill("Design");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Design")).toBeVisible({ timeout: 10_000 });

    // ── 7. Add the second subitem via the inline AddSubitemRow input ──────────
    // Once the parent has a child the "Add subitem to X" button is replaced by
    // the expand chevron. The inline input row ("Add subitem" placeholder) is
    // rendered at the bottom of the SubitemBlock when the parent is expanded.
    const addSubitemInput = page.getByLabel("Add subitem", { exact: true });
    await expect(addSubitemInput).toBeVisible({ timeout: 10_000 });
    await addSubitemInput.fill("Build");
    await page.keyboard.press("Enter");
    // The new "Build" subitem is created and enters rename mode automatically
    // (onSubitemAdded sets renamingItemId). Wait for the rename input, then
    // commit with Enter to dismiss rename mode and land on the resting button.
    const buildRenameInput = page.getByLabel("Rename Build");
    await expect(buildRenameInput).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Enter");
    // Now the rename input is gone and the resting cell button is visible.
    await expect(page.getByRole("button", { name: "Build name" })).toBeVisible({
      timeout: 10_000,
    });

    // ── 8. Set the Numbers cell on "Design" to 5 ─────────────────────────────
    // Cell resting label: "${itemName} ${columnName}" → "Design Numbers"
    await page.getByRole("button", { name: "Design Numbers" }).click();
    // NumbersEditor renders an <input type="number">; it has no explicit aria-label
    // so target by type within the active editing region.
    const designNumberInput = page.locator('input[type="number"]');
    await expect(designNumberInput).toBeVisible({ timeout: 5_000 });
    await designNumberInput.fill("5");
    await page.keyboard.press("Enter");
    // After commit the cell shows the formatted value.
    await expect(
      page.getByRole("button", { name: "Design Numbers" }),
    ).toContainText("5", {
      timeout: 10_000,
    });

    // ── 9. Set the Numbers cell on "Build" to 8 ──────────────────────────────
    await page.getByRole("button", { name: "Build Numbers" }).click();
    const buildNumberInput = page.locator('input[type="number"]');
    await expect(buildNumberInput).toBeVisible({ timeout: 5_000 });
    await buildNumberInput.fill("8");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Build Numbers" }),
    ).toContainText("8", {
      timeout: 10_000,
    });

    // ── 10. Drag "Build" above "Design" ──────────────────────────────────────
    // The SortableSubitemRow renders a drag handle: button[aria-label="Reorder Build"].
    // dnd-kit uses PointerSensor with activationConstraint.distance=6.
    // We simulate a drag by dispatching pointer events via page.mouse.
    //
    // Strategy: get the bounding box of "Reorder Build" and "Reorder Design"
    // handles, then drag from Build's handle to a point above Design's handle.
    const buildHandle = page.getByRole("button", { name: "Reorder Build" });
    const designHandle = page.getByRole("button", { name: "Reorder Design" });

    await expect(buildHandle).toBeVisible({ timeout: 10_000 });
    await expect(designHandle).toBeVisible({ timeout: 10_000 });

    // Hover over Build row to make the handle visible (opacity-0 → opacity-100).
    const buildRow = page.getByRole("button", { name: "Build name" });
    await buildRow.hover();

    const buildBox = await buildHandle.boundingBox();
    const designBox = await designHandle.boundingBox();

    // Only proceed if we got boxes; if not, the test will fail with a clear message.
    expect(buildBox, "Build drag handle must be visible").not.toBeNull();
    expect(designBox, "Design drag handle must be visible").not.toBeNull();

    const buildCx = buildBox!.x + buildBox!.width / 2;
    const buildCy = buildBox!.y + buildBox!.height / 2;
    const designCy = designBox!.y + designBox!.height / 2;

    // Drag Build above Design: move up past Design's center.
    await page.mouse.move(buildCx, buildCy);
    await page.mouse.down();
    // Move in small steps to satisfy dnd-kit's activationConstraint (distance ≥ 6px).
    await page.mouse.move(buildCx, buildCy - 4);
    await page.mouse.move(buildCx, buildCy - 8);
    await page.mouse.move(buildCx, designCy - 4);
    await page.mouse.up();

    // Wait for the reorderItem Server Action to settle.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // Assert Build is now above Design: the first subitem row should be "Build".
    // We look for the first occurrence of each name inside the subitem block.
    // The order in the DOM should now be: Build … Design.
    const subitemNames = page
      .locator('[aria-label="Build name"], [aria-label="Design name"]')
      .first();
    await expect(subitemNames).toHaveAttribute("aria-label", "Build name", {
      timeout: 10_000,
    });

    // ── 11. Collapse "Epic" → assert rollup "Σ 13" ───────────────────────────
    // The chevron button carries aria-label="Collapse Epic" when expanded.
    const collapseBtn = page.getByRole("button", { name: "Collapse Epic" });
    await expect(collapseBtn).toBeVisible({ timeout: 5_000 });
    await collapseBtn.click();

    // After collapse the ItemRow shows RollupCell for the Numbers column which
    // renders "Σ {total}" where total = 5 + 8 = 13.
    await expect(page.getByText(/Σ\s*13/)).toBeVisible({ timeout: 10_000 });

    // The chevron flips to aria-label="Expand Epic" / aria-expanded=false.
    const expandBtn = page.getByRole("button", { name: "Expand Epic" });
    await expect(expandBtn).toBeVisible({ timeout: 5_000 });
    await expect(expandBtn).toHaveAttribute("aria-expanded", "false");

    // ── 12. Expand and delete "Design" ───────────────────────────────────────
    await expandBtn.click();
    // After expand the subitems are visible again.
    await expect(page.getByText("Design")).toBeVisible({ timeout: 10_000 });

    // The RowMenu for a subitem is triggered by button[aria-label="${label} menu"].
    // Hover the Design name cell so the menu button is visible (opacity-0 on rest).
    const designNameCell = page.getByRole("button", { name: "Design name" });
    await designNameCell.hover();

    const designMenu = page.getByRole("button", { name: "Design menu" });
    await expect(designMenu).toBeVisible({ timeout: 5_000 });
    await designMenu.click();

    // The dropdown renders a "Delete" menuitem.
    await page.getByRole("menuitem", { name: "Delete" }).click();

    // The RowMenu for subitems (hasChildren=false) has a direct delete path —
    // no confirmation AlertDialog (only the top-level item with children shows one).
    // Assert "Design" disappears.
    await expect(page.getByText("Design")).toHaveCount(0, { timeout: 10_000 });

    // "Build" should still be visible.
    await expect(page.getByText("Build")).toBeVisible();
  });
});
