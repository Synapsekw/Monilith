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

// Mirror column end-to-end (Phase 6d-2). Board A ("Tasks") has a relation column
// pointing at board B ("Projects"); board B carries a Text column with a value.
// We link B's item into A's relation cell through the UI, then add a Mirror
// column through the add-column UI (MirrorColumnConfig: pick the source relation,
// then the column to mirror). After the board re-reads, the mirrored value must
// render in the mirror cell — and the mirror cell must be read-only (clicking it
// opens no editor, unlike a normal editable cell which is a role="button").
//
// Boards/items/columns and the seeded Text value are provisioned via the user's
// own RLS-scoped session (mirrors relations.spec.ts, the 6d-1 precedent); only
// the link + add-mirror interactions are driven through the UI.
test.describe("Mirror column: mirrors a linked item's value, read-only", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping e2e");

  let createdUserId: string | null = null;
  let testEmail: string;
  let tasksBoardId: string;

  const projectName = "Acquisition Q3";
  const taskName = "Ship onboarding";
  // The value on board B's Text column that the mirror must reflect on board A.
  const mirroredText = "Owned by Platform";
  const relationColName = "Projects";
  const targetTextColName = "Owner";
  const mirrorColName = "Mirror";

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-mirror")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: created, error } = await admin.auth.admin.createUser({
      email: testEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    createdUserId = created.user!.id;

    // Provision as the user (RLS-scoped) via a fresh anon session.
    const anon = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await anon.auth.signInWithPassword({
      email: testEmail,
      password: PASSWORD,
    });

    const { data: org } = await anon.rpc("create_organization", {
      p_name: unique("Org"),
      p_slug: unique("org").toLowerCase(),
    });
    const orgId = (org as { id: string }).id;
    const { data: ws } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: "Engineering", created_by: createdUserId })
      .select("id")
      .single();
    const workspaceId = (ws as { id: string }).id;

    async function board(name: string) {
      const { data: b } = await anon.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: name,
      });
      const boardId = (b as { id: string }).id;
      const { data: g } = await anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      return { boardId, groupId: (g as { id: string }).id };
    }
    async function item(groupId: string, name: string) {
      const { data: it } = await anon.rpc("create_item", {
        p_group_id: groupId,
        p_name: name,
      });
      return (it as { id: string }).id;
    }

    // ── Board B ("Projects"): a Text column + an item carrying the value to mirror.
    const projects = await board("Projects");
    const { data: ownerCol } = await anon
      .from("columns")
      .insert({
        org_id: orgId,
        board_id: projects.boardId,
        name: targetTextColName,
        kind: "text",
        position: 1000,
        settings: {},
      })
      .select("id")
      .single();
    const ownerColId = (ownerCol as { id: string }).id;
    const projectItemId = await item(projects.groupId, projectName);
    await anon.from("cell_values").upsert(
      {
        org_id: orgId,
        board_id: projects.boardId,
        item_id: projectItemId,
        column_id: ownerColId,
        value: { text: mirroredText },
      },
      { onConflict: "item_id,column_id" },
    );

    // ── Board A ("Tasks"): a relation column → Projects, plus one item.
    const tasks = await board("Tasks");
    await item(tasks.groupId, taskName);
    tasksBoardId = tasks.boardId;

    await anon.from("columns").insert({
      org_id: orgId,
      board_id: tasks.boardId,
      name: relationColName,
      kind: "relation",
      position: 1000,
      settings: { target_board_id: projects.boardId, allow_multiple: true },
    });
  });

  test.afterAll(async () => {
    if (!createdUserId) return;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin.deleteUser(createdUserId);
  });

  test("links a project, mirrors its Text value, and the cell is read-only", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for the login redirect to settle (session cookie set) before
    // navigating to the board, so we don't race a /login bounce.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    });

    await page.goto(`/boards/${tasksBoardId}`);
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });

    // ── Link the Projects item into the relation cell on the task row. ──────────
    await page
      .getByRole("button", { name: "Edit linked items" })
      .first()
      .click();
    const picker = page.getByPlaceholder(/search/i);
    await expect(picker).toBeVisible({ timeout: 10_000 });
    await page.getByRole("option", { name: projectName }).click();
    await page.keyboard.press("Escape");
    // Confirm the chip landed before adding the mirror column.
    await expect(page.getByText(projectName).first()).toBeVisible({
      timeout: 10_000,
    });

    // ── Add a Mirror column via "+ Add column" → "Mirror". ──────────────────────
    await page.getByRole("button", { name: "Add column" }).click();
    await page.getByRole("menuitem", { name: "Mirror" }).click();

    // MirrorColumnConfig: two native selects, then "Add column".
    const sourceSelect = page.getByLabel("Source relation");
    await expect(sourceSelect).toBeVisible({ timeout: 10_000 });
    await sourceSelect.selectOption({ label: relationColName });

    const columnSelect = page.getByLabel("Column to mirror");
    // Target columns load lazily once a relation is chosen; the option appears
    // after the fetch resolves.
    await expect(
      columnSelect.locator(`option`, { hasText: targetTextColName }),
    ).toHaveCount(1, { timeout: 10_000 });
    await columnSelect.selectOption({ label: targetTextColName });

    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add column" })
      .click();

    // Mirror target cells/columns are read server-side only when a mirror column
    // exists on the board, so re-read the board to populate the mirror cache.
    await page.goto(`/boards/${tasksBoardId}`);
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });

    // ── Assert: the mirrored Text value is visible in the mirror cell. ──────────
    await expect(page.getByText(mirroredText)).toBeVisible({ timeout: 15_000 });

    // ── Assert: the mirror cell is read-only — no editor opens on click. ────────
    // Editable cells render as role="button" with aria-label "<item> <column>".
    // The mirror cell renders as a plain div, so no such button exists for it.
    const mirrorCellButton = page.getByRole("button", {
      name: `${taskName} ${mirrorColName}`,
    });
    await expect(mirrorCellButton).toHaveCount(0);

    // Clicking the mirrored value itself must not spawn an inline editor
    // (a Text editor would surface a textbox).
    await page.getByText(mirroredText).click();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    // And the value is still just shown, unchanged.
    await expect(page.getByText(mirroredText)).toBeVisible();
  });
});
