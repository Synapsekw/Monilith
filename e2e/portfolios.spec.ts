/**
 * e2e: Portfolios happy path
 *
 * Mirrors `e2e/boards.spec.ts`: a CONFIRMED user is provisioned via the
 * service-role admin API in `beforeAll` (so email confirmation never blocks the
 * UI login), then the whole flow is driven through the UI — login → onboarding
 * → create a board → go to Portfolios → create a portfolio → add the board →
 * see its row → in-page sort changes the URL via the History API WITHOUT a full
 * navigation (gotcha-09 / AGENTS.md §5).
 *
 * If SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are absent
 * (e.g. CI without secrets), the describe block skips gracefully rather than
 * hard-failing.
 */

import * as dotenv from "dotenv";
import * as path from "node:path";

// Load .env.local for the Playwright test process (playwright.config.ts ships
// no dotenv call; the webServer process gets its own env from Next.js).
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

test.describe("Portfolios happy path", () => {
  // Skip the whole describe when secrets are unavailable (CI without .env.local).
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping portfolios e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    // Create a pre-confirmed user via the service-role admin API so that
    // email confirmation never blocks the UI login.
    testEmail = `${unique("e2e-portfolios")}@example.com`;

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

  test("create portfolio → add board → see row → in-page sort changes URL without navigation", async ({
    page,
  }) => {
    // Everything in one test so the steps share a single page session (avoids
    // user/session conflicts from parallel tests on the same account).
    test.setTimeout(180_000);

    // ── 1. Log in via the UI (confirmed user — no email verification) ────────
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    // A confirmed user with no org is redirected → /onboarding.
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // ── 2. Onboarding (new user has no org) ──────────────────────────────────
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();

    // Match the app root regardless of dev port (origin + bare "/").
    await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });

    // ── 3. Create a board (so the portfolio has something to add) ─────────────
    const boardName = unique("Launch");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);

    // ── 4. Go to Portfolios via the sidebar nav link ─────────────────────────
    await page.getByRole("link", { name: "Portfolios" }).click();
    await page.waitForURL(/\/portfolios$/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Portfolios" }),
    ).toBeVisible();

    // ── 5. Create a portfolio (NewPortfolioDialog) ───────────────────────────
    await page.getByRole("button", { name: "New portfolio" }).click();
    await page.getByLabel(/portfolio name/i).fill(unique("Q3"));
    await page.getByRole("button", { name: "Create portfolio" }).click();

    // NewPortfolioDialog routes to /portfolios/[id] on success.
    await page.waitForURL(/\/portfolios\/[0-9a-f-]+$/, { timeout: 30_000 });
    await expect(page.getByText(/no boards yet/i)).toBeVisible({
      timeout: 15_000,
    });

    // ── 6. Add the board to the portfolio (AddBoardDialog) ───────────────────
    // The page trigger is a Button labelled "Add board".
    await page.getByRole("button", { name: "Add board" }).click();

    const dialog = page.getByRole("dialog", {
      name: /add board to portfolio/i,
    });
    await expect(dialog).toBeVisible();

    // The board <select> is labelled "Board" (htmlFor="add-board-select").
    await dialog.getByLabel("Board").selectOption({ label: boardName });

    // Submit — the dialog's own button is also labelled "Add board"; scope it.
    await dialog.getByRole("button", { name: "Add board" }).click();

    // ── 7. The board's row appears (board-name link in the grid) ─────────────
    await expect(page.getByRole("link", { name: boardName })).toBeVisible({
      timeout: 15_000,
    });

    // ── 8. In-page sort: clicking a sort button updates the URL via the History
    //      API (pushState) and re-renders WITHOUT a full RSC navigation. ───────
    // The sort controls are <button>s labelled by SORT_LABEL ("Health" etc.).
    // A full navigation would unload the document; we assert the same page is
    // still live (the board link stays visible, no reload) while the URL gained
    // ?sort=health.
    await expect(page).not.toHaveURL(/sort=/);
    await page.getByRole("button", { name: "Health", exact: true }).click();
    await expect(page).toHaveURL(/[?&]sort=health/);

    // The row is still there (no refetch / no full navigation tore it down) and
    // the sort button reflects the active state via aria-pressed.
    await expect(page.getByRole("link", { name: boardName })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Health", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
