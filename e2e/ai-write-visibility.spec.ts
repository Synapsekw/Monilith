/**
 * e2e: an approved AI write appears on the board WITHOUT a reload.
 *
 * This is the one layer that can observe the thing this feature fixes.
 * `vault/decisions/2026-06-17-gotcha-13-realtime-only-insert-needs-optimistic-echo.md`
 * says it outright: "`pnpm e2e` is the gate that catches Realtime-render gaps;
 * unit/typecheck/lint/build cannot." Every unit test around this path mocks the
 * exact boundary that failed — the Server Action's response, the React Query
 * cache, or the Realtime channel. Only a real browser against a real board can
 * prove the row moves on screen with no `page.reload()`.
 *
 * OPT-IN, and deliberately so. `e2e/ask.spec.ts` already records why the AI
 * round-trip is not part of the default suite: it needs a live provider key
 * plus credits, and the model's phrasing is non-deterministic — "a flake and
 * cost generator, not a test". So this spec runs only when BOTH hold:
 *
 *   - the usual Supabase secrets are present (as in every other e2e here), AND
 *   - `E2E_AI_WRITES=1` is set, i.e. someone deliberately opted into paying for
 *     a model turn.
 *
 * Run it with:  E2E_AI_WRITES=1 pnpm e2e e2e/ai-write-visibility.spec.ts
 *
 * The org it provisions must also be entitled to AI (`readOrgAiSettings` mode
 * ≠ "off"); a fresh org on a DEV project whose default is "off" will fail at
 * the propose step with "AI is turned off for your organization" — which is a
 * configuration answer, not a bug in this path.
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
const optedIn = process.env.E2E_AI_WRITES === "1";

const PASSWORD = "Test-Password-123!";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test.describe("AI write visibility", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping AI write e2e",
  );
  test.skip(
    !optedIn,
    "Set E2E_AI_WRITES=1 to run the paid, model-driven AI write e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-ai-write")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email: testEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error(`Failed to create test user: ${error?.message}`);
    createdUserId = data.user.id;
  });

  test.afterAll(async () => {
    if (!createdUserId) return;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin.deleteUser(createdUserId);
  });

  test("an approved move appears on the board with no reload", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    // ── 1. Log in, onboard, create a board ───────────────────────────────────
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    const boardName = unique("Sprint");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    await expect(page.getByText("Group 1")).toBeVisible();

    const boardId = new URL(page.url()).pathname.split("/").pop()!;

    // ── 2. A second group to move into, and a row to move ────────────────────
    await page.getByRole("button", { name: /add group/i }).click();
    await expect(page.getByText("Group 2")).toBeVisible({ timeout: 15_000 });

    const itemName = unique("Alpha");
    await page.getByLabel("Add item").first().fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });

    // Resolve the target group's id so the assertion names a real container
    // rather than a DOM position. `group-rows-<id>` is the table's own test id.
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: groups } = await admin
      .from("groups")
      .select("id, name")
      .eq("board_id", boardId);
    const target = groups?.find((g) => g.name === "Group 2");
    expect(target, "the second group must exist").toBeTruthy();

    // ── 3. Ask the dock to move it, and approve ──────────────────────────────
    await page.getByRole("button", { name: "Open agent dock" }).click();
    const composer = page.getByLabel("Your question");
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await composer.fill(`move "${itemName}" to Group 2`);
    await composer.press("ControlOrMeta+Enter");

    await expect(page.getByRole("button", { name: /approve/i })).toBeVisible({
      timeout: 120_000,
    });
    await page.getByRole("button", { name: /approve/i }).click();
    await expect(page.getByText(/^Done —/)).toBeVisible({ timeout: 60_000 });

    // ── 4. The assertion that matters ────────────────────────────────────────
    // There is NO page.reload() anywhere above this line. If the effect were
    // not folded into the ["board", boardId] cache, the row would still be
    // sitting in Group 1 right now.
    await expect(
      page.getByTestId(`group-rows-${target!.id}`).getByText(itemName),
    ).toBeVisible({ timeout: 15_000 });
  });
});
