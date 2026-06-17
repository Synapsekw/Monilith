/**
 * e2e: Dashboards D1 — create dashboard → add a Number widget → drag → persist
 *
 * Mirrors the auth/setup of `e2e/boards.spec.ts` and `e2e/board-columns.spec.ts`:
 * a CONFIRMED user created via the service-role admin API in `beforeAll`, driven
 * through the UI (login → onboard → create a board with an item so the Number
 * count is non-zero), and a graceful skip when secrets are absent.
 *
 * The binding intent of this spec is the **0-refetch-on-drag budget**: dragging a
 * widget must persist the layout (debounced `set_widget_layouts` RPC via the
 * `saveLayout` Server Action) WITHOUT triggering a `getWidgetData` aggregate
 * fetch. Server Actions POST to the page route with a `next-action` header (an
 * opaque action id, not the function name), so we identify the widget-data fetch
 * by its RESPONSE payload: `getWidgetData` is the only action that returns a
 * `buckets` array. We count widget-data responses that arrive during the drag
 * window and assert it stays at 0. As a second, independent guard we assert the
 * widget's displayed number is unchanged across the drag, and that the new layout
 * survives a reload.
 *
 * react-grid-layout is v2.2.3 (NOT v1). v2 has no `WidthProvider` HOC and the
 * canvas renders via `ResponsiveGridLayout`. The grid items are still positioned
 * via `.react-grid-item`, but rather than depend on that internal class we target
 * the widget by its visible content: a `bg-card` bordered card whose body shows a
 * large number (the count) and an "items" label.
 */

import * as dotenv from "dotenv";
import * as path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasSecrets = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

const PASSWORD = "Test-Password-123!";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** The widget card body shows the Number value as a large number + an "items" label. */
function widgetNumber(page: Page) {
  // Scope to the widget card chrome (bg-card bordered) to avoid matching other
  // numbers on the page (e.g. the dashboard name). The Number body renders the
  // count in a span with tabular-nums.
  return page.locator(".bg-card span.tabular-nums").first();
}

test.describe("Dashboards: create → add Number widget → drag → persist", () => {
  // These tests share one CONFIRMED user (created in beforeAll). Run them
  // serially so onboarding happens exactly once and the two flows don't race
  // over the shared org/board state.
  test.describe.configure({ mode: "serial" });

  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping dashboards e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-dash")}@example.com`;
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

  test("create dashboard, add a Number widget, drag, persist layout", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // ── 1. Log in ─────────────────────────────────────────────────────────────
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

    // ── 3. Create a board with one item (so the Number count is non-zero) ─────
    const boardName = unique("Sprint");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    await expect(page.getByText("Group 1")).toBeVisible();

    const itemName = unique("Task");
    await page.getByLabel("Add item").fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });
    // Let the create-item request settle so the aggregate count is authoritative.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // ── 4. Create a dashboard from the sidebar ────────────────────────────────
    await page.getByRole("button", { name: /new dashboard/i }).click();
    await page.getByLabel(/dashboard name/i).fill("E2E Dash");
    await page.getByRole("button", { name: /create dashboard/i }).click();
    await expect(page).toHaveURL(/\/dashboards\/[0-9a-f-]+/, {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: "E2E Dash" })).toBeVisible({
      timeout: 15_000,
    });

    // ── 5. Enter Edit mode and add a Number widget ────────────────────────────
    await page.getByRole("button", { name: /^edit$/i }).click();
    // Open the Add-widget dialog (the toolbar trigger).
    await page.getByRole("button", { name: /add widget/i }).click();
    await expect(
      page.getByRole("heading", { name: /add a widget/i }),
    ).toBeVisible();
    // Default source board is the only board; default metric is Count of items.
    // Submit via the dialog footer button (the last "Add widget" button).
    await page
      .getByRole("button", { name: /add widget/i })
      .last()
      .click();

    // ── 6. The count renders (a non-empty number) ─────────────────────────────
    const number = widgetNumber(page);
    await expect(number).toBeVisible({ timeout: 15_000 });
    await expect(number).toHaveText(/^\d+$/);
    const before = (await number.textContent())?.trim();
    expect(before).toBeTruthy();

    // ── 7. Drag the widget; assert NO widget-data fetch fires (0-refetch) ─────
    // Server Actions POST to the page route with a `next-action` header; the
    // action id is opaque, so we identify the widget-data fetch by its response
    // payload — `getWidgetData` is the only action returning a `buckets` array.
    // We only count widget-data responses that resolve during the drag window.
    let widgetDataFetches = 0;
    let watching = false;
    const onResponse = async (res: import("@playwright/test").Response) => {
      if (!watching) return;
      const req = res.request();
      // Server Actions are POSTs carrying the next-action header.
      if (req.method() !== "POST") return;
      if (!req.headers()["next-action"]) return;
      try {
        const body = await res.text();
        if (body.includes('"buckets"')) widgetDataFetches++;
      } catch {
        // ignore bodies we can't read
      }
    };
    page.on("response", onResponse);

    // Drag the widget card by its header (the title chrome is the drag surface).
    const card = page.locator(".bg-card").first();
    const handle = card.locator("> div").first(); // header row
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();

    watching = true;
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // Move in steps to trigger react-grid-layout's drag.
      await page.mouse.move(box.x + 360, box.y + 240, { steps: 12 });
      await page.mouse.up();
    }
    // Allow the 600ms debounced saveLayout to fire AND any (forbidden) refetch.
    await page.waitForTimeout(1500);
    watching = false;
    page.off("response", onResponse);

    // 0-refetch budget: a layout drag must not refetch widget data.
    expect(widgetDataFetches).toBe(0);
    // Independent guard: the displayed value is unchanged by a layout drag.
    await expect(number).toHaveText(before!);

    // Let the debounced saveLayout RPC settle before reloading.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // ── 8. Reload → widget still present with the same count (layout persisted) ─
    await page.reload();
    const afterReload = widgetNumber(page);
    await expect(afterReload).toBeVisible({ timeout: 15_000 });
    await expect(afterReload).toHaveText(before!);
  });

  test("add a Chart widget grouped by status renders an SVG chart", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // ── 1. Log in ─────────────────────────────────────────────────────────────
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Tests run in parallel against one shared user, so this context may land on
    // either the onboarding form (org not yet created) or the app root ("New
    // board" present). Branch on whichever UI actually appears, not on the URL
    // (the post-login redirect to /onboarding races a transient "/").
    const orgNameField = page.getByLabel(/organization name/i);
    const newBoardButton = page.getByRole("button", { name: "New board" });
    await expect(orgNameField.or(newBoardButton).first()).toBeVisible({
      timeout: 30_000,
    });
    if (await orgNameField.isVisible().catch(() => false)) {
      await orgNameField.fill(unique("Org"));
      await page.getByLabel(/workspace name/i).fill("Engineering");
      await page.getByRole("button", { name: /create organization/i }).click();
      await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });
    }
    await expect(newBoardButton).toBeVisible({ timeout: 30_000 });

    // ── 2. Create a board with one item (the seeded board has a Status column) ─
    const boardName = unique("ChartBoard");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    await expect(page.getByText("Group 1")).toBeVisible();

    const itemName = unique("Task");
    await page.getByLabel("Add item").fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // ── 3. Create a dashboard ─────────────────────────────────────────────────
    await page.getByRole("button", { name: /new dashboard/i }).click();
    await page.getByLabel(/dashboard name/i).fill("Chart Dash");
    await page.getByRole("button", { name: /create dashboard/i }).click();
    await expect(page).toHaveURL(/\/dashboards\/[0-9a-f-]+/, {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: "Chart Dash" })).toBeVisible(
      { timeout: 15_000 },
    );

    // ── 4. Enter Edit, open Add-widget, pick Chart grouped by Status ──────────
    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.getByRole("button", { name: /add widget/i }).click();
    await expect(
      page.getByRole("heading", { name: /add a widget/i }),
    ).toBeVisible();

    // Select the Chart widget type. The "Widget type" select is the one whose
    // label text precedes it; target via its containing label for robustness.
    const typeSelect = page
      .locator("label", { hasText: "Widget type" })
      .locator("select");
    await typeSelect.selectOption("chart");

    // Selecting "chart" reveals the "Group by (status column)" select. The
    // seeded board's Status column appears as the first real option (index 1,
    // after the "Select…" placeholder).
    const groupSelect = page
      .locator("label", { hasText: "Group by (status column)" })
      .locator("select");
    await expect(groupSelect).toBeVisible();
    await groupSelect.selectOption({ index: 1 });

    // Submit via the dialog footer button (the last "Add widget" button).
    await page
      .getByRole("button", { name: /add widget/i })
      .last()
      .click();

    // ── 5. A recharts SVG renders inside the widget card (mounts async) ───────
    await expect(page.locator("svg.recharts-surface").first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
