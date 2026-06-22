/**
 * Phase 5b-1: engine integration tests.
 *
 * Covers:
 *  - item_created → set_option
 *  - item_created → notify/member
 *  - person_assigned fires on addition
 *  - person_assigned does NOT fire on removal / no-op
 *  - condition gate — passes (AND)
 *  - condition gate — blocks (AND)
 *  - condition OR: exactly one arm matches
 *  - condition over text / number / date (matching + non-matching)
 *  - null condition always passes
 *  - Regression: 5a status_changed still works
 *  - Regression: loop safety still caps (item_created path)
 *  - Regression: disabled rules never fire for new trigger types
 *  - Regression: cross-org isolation for new trigger types
 *
 * Mirror of automations.rls.integration.test.ts — reuses the same
 * authenticated-Supabase-client setup/teardown and fixture helpers.
 */

import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

/**
 * Wait up to `ms` for `fn` to resolve to a truthy/non-empty value.
 * The automation engine runs in an AFTER trigger (same statement), so in
 * practice there is no async gap — this is a safety net for any transient
 * replication lag in CI.
 */
async function poll<T>(
  fn: () => Promise<T | null | undefined>,
  { maxMs = 5_000, intervalMs = 300 } = {},
): Promise<T | null | undefined> {
  const deadline = Date.now() + maxMs;
  let last: T | null | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (last !== null && last !== undefined) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

describe.skipIf(!SERVICE_ROLE_KEY)("engine: automations 5b-1", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  // ── orgA context (userA = actor) ──────────────────────────────────────────
  let userAId: string;
  let userAAnon: SupabaseClient<Database>;
  let orgAId: string;
  let boardAId: string;
  /** Default group in boardA — items are created here. */
  let groupAId: string;
  /** Second group in boardA — target for move_to_group tests. */
  let targetGroupId: string;
  /** One persistent item used for cell-value-triggered tests. */
  let itemAId: string;

  // ── Status column S (options: Working, Done) ──────────────────────────────
  let colSId: string;
  let optWorkingId: string;
  let optDoneId: string;

  // ── Status column P (options: High, Low) — used as condition column ───────
  let colPId: string;
  let optHighId: string;
  let optLowId: string;

  // ── People column O ───────────────────────────────────────────────────────
  let colOId: string;

  // ── Text column T ─────────────────────────────────────────────────────────
  let colTextId: string;

  // ── Numbers column N ──────────────────────────────────────────────────────
  let colNumId: string;

  // ── Date column D ─────────────────────────────────────────────────────────
  let colDateId: string;

  // ── orgB — separate org, userB is NOT a member of orgA ───────────────────
  let userBId: string;
  let userBAnon: SupabaseClient<Database>;

  // ─────────────────────────────────────────────────────────────────────────
  // Setup
  // ─────────────────────────────────────────────────────────────────────────
  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── create userA ──────────────────────────────────────────────────────
    const emailA = `eng5b1-a-${randomUUID()}@example.com`;
    const { data: createdA, error: errA } = await admin.auth.admin.createUser({
      email: emailA,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(errA, "createUser(A)").toBeNull();
    userAId = createdA.user!.id;
    createdUserIds.push(userAId);

    userAAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(userAAnon, {
      email: emailA,
      password: PASSWORD,
    });

    // ── org + workspace + board ──────────────────────────────────────────
    const { data: orgData } = await userAAnon.rpc("create_organization", {
      p_name: "Eng5b1 Org A",
      p_slug: `eng5b1-a-${randomUUID().slice(0, 8)}`,
    });
    orgAId = (orgData as { id: string }).id;

    const { data: wsData } = await userAAnon
      .from("workspaces")
      .insert({ org_id: orgAId, name: "WS A", created_by: userAId })
      .select("id")
      .single();
    const wsAId = (wsData as { id: string }).id;

    const { data: boardData, error: boardErr } = await userAAnon.rpc(
      "create_board",
      { p_workspace_id: wsAId, p_name: "Board A" },
    );
    expect(boardErr, "create_board(A)").toBeNull();
    boardAId = (boardData as { id: string }).id;

    const { data: groupData } = await userAAnon
      .from("groups")
      .select("id")
      .eq("board_id", boardAId)
      .single();
    groupAId = (groupData as { id: string }).id;

    const { data: g2, error: g2Err } = await admin
      .from("groups")
      .insert({
        org_id: orgAId,
        board_id: boardAId,
        name: "Done group",
        position: 100,
      })
      .select("id")
      .single();
    expect(g2Err, "insert Done group").toBeNull();
    targetGroupId = (g2 as { id: string }).id;

    const { data: itemData } = await userAAnon.rpc("create_item", {
      p_group_id: groupAId,
      p_name: "Item A",
    });
    itemAId = (itemData as { id: string }).id;

    // ── Status column S — Working / Done ─────────────────────────────────
    const sOptions = [
      { id: randomUUID(), label: "Working", color: "#00c875" },
      { id: randomUUID(), label: "Done", color: "#579bfc" },
    ];
    optWorkingId = sOptions[0].id;
    optDoneId = sOptions[1].id;

    const { data: colS, error: colSErr } = await admin
      .from("columns")
      .insert({
        org_id: orgAId,
        board_id: boardAId,
        name: "S",
        kind: "status",
        settings: { options: sOptions },
        position: 10,
      })
      .select("id")
      .single();
    expect(colSErr, "insert col S").toBeNull();
    colSId = (colS as { id: string }).id;

    // ── Status column P — High / Low ─────────────────────────────────────
    const pOptions = [
      { id: randomUUID(), label: "High", color: "#e2445c" },
      { id: randomUUID(), label: "Low", color: "#9aadbd" },
    ];
    optHighId = pOptions[0].id;
    optLowId = pOptions[1].id;

    const { data: colP, error: colPErr } = await admin
      .from("columns")
      .insert({
        org_id: orgAId,
        board_id: boardAId,
        name: "P",
        kind: "status",
        settings: { options: pOptions },
        position: 11,
      })
      .select("id")
      .single();
    expect(colPErr, "insert col P").toBeNull();
    colPId = (colP as { id: string }).id;

    // ── People column O ───────────────────────────────────────────────────
    const { data: colO, error: colOErr } = await admin
      .from("columns")
      .insert({
        org_id: orgAId,
        board_id: boardAId,
        name: "O",
        kind: "people",
        settings: {},
        position: 12,
      })
      .select("id")
      .single();
    expect(colOErr, "insert col O").toBeNull();
    colOId = (colO as { id: string }).id;

    // ── Text column T ──────────────────────────────────────────────────────
    const { data: colText, error: colTextErr } = await admin
      .from("columns")
      .insert({
        org_id: orgAId,
        board_id: boardAId,
        name: "T",
        kind: "text",
        settings: {},
        position: 13,
      })
      .select("id")
      .single();
    expect(colTextErr, "insert col T").toBeNull();
    colTextId = (colText as { id: string }).id;

    // ── Numbers column N ──────────────────────────────────────────────────
    const { data: colNum, error: colNumErr } = await admin
      .from("columns")
      .insert({
        org_id: orgAId,
        board_id: boardAId,
        name: "N",
        kind: "numbers",
        settings: {},
        position: 14,
      })
      .select("id")
      .single();
    expect(colNumErr, "insert col N").toBeNull();
    colNumId = (colNum as { id: string }).id;

    // ── Date column D ──────────────────────────────────────────────────────
    const { data: colDate, error: colDateErr } = await admin
      .from("columns")
      .insert({
        org_id: orgAId,
        board_id: boardAId,
        name: "D",
        kind: "date",
        settings: {},
        position: 15,
      })
      .select("id")
      .single();
    expect(colDateErr, "insert col D").toBeNull();
    colDateId = (colDate as { id: string }).id;

    // ── create userB in a separate org ───────────────────────────────────
    const emailB = `eng5b1-b-${randomUUID()}@example.com`;
    const { data: createdB, error: errB } = await admin.auth.admin.createUser({
      email: emailB,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(errB, "createUser(B)").toBeNull();
    userBId = createdB.user!.id;
    createdUserIds.push(userBId);

    userBAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(userBAnon, {
      email: emailB,
      password: PASSWORD,
    });

    // userB must have an org (session needs it), but NOT orgA
    await userBAnon.rpc("create_organization", {
      p_name: "Eng5b1 Org B",
      p_slug: `eng5b1-b-${randomUUID().slice(0, 8)}`,
    });
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /** Insert an automation via service-role. Supports optional condition. */
  async function insertAutomation(opts: {
    trigger: unknown;
    actions: unknown;
    condition?: unknown;
    enabled?: boolean;
  }): Promise<string> {
    const { data, error } = await admin
      .from("automations")
      .insert({
        org_id: orgAId,
        board_id: boardAId,
        trigger: opts.trigger as never,
        actions: opts.actions as never,
        condition: (opts.condition ?? null) as never,
        enabled: opts.enabled ?? true,
        created_by: userAId,
      })
      .select("id")
      .single();
    expect(error, "insertAutomation").toBeNull();
    return (data as { id: string }).id;
  }

  /** Delete all notifications and cell_values for a given item (isolate tests). */
  async function cleanItemState(itemId: string) {
    await admin.from("notifications").delete().eq("item_id", itemId);
    await admin.from("cell_values").delete().eq("item_id", itemId);
  }

  /** Upsert a cell value as userA (the triggering actor). */
  async function setCell(itemId: string, columnId: string, value: unknown) {
    const { error } = await userAAnon.from("cell_values").upsert(
      {
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemId,
        column_id: columnId,
        value: value as never,
      },
      { onConflict: "item_id,column_id" },
    );
    return error;
  }

  /**
   * Create a fresh item in boardA as userA and return its id.
   * Used for item_created tests so each test gets a brand-new insert.
   */
  async function createFreshItem(): Promise<string> {
    const { data, error } = await userAAnon.rpc("create_item", {
      p_group_id: groupAId,
      p_name: `Test item ${randomUUID().slice(0, 8)}`,
    });
    expect(error, "createFreshItem").toBeNull();
    return (data as { id: string }).id;
  }

  /** Read the current group_id for an item. */
  async function itemGroup(itemId: string): Promise<string | null> {
    const { data } = await admin
      .from("items")
      .select("group_id")
      .eq("id", itemId)
      .single();
    return (data as { group_id: string } | null)?.group_id ?? null;
  }

  // =========================================================================
  // 1. item_created → set_option fires
  // =========================================================================
  it("item_created → set_option sets S=Working on new item", async () => {
    const automationId = await insertAutomation({
      trigger: { type: "item_created" },
      actions: [
        { type: "set_option", columnId: colSId, optionId: optWorkingId },
      ],
    });

    // INSERT a new item — triggers tg_run_item_automations
    const newItemId = await createFreshItem();

    const cell = await poll(async () => {
      const { data } = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", newItemId)
        .eq("column_id", colSId);
      return data && data.length > 0 ? data[0] : null;
    });

    expect(cell, "S cell value on new item").not.toBeNull();
    expect((cell as { value: unknown }).value).toMatchObject({
      optionId: optWorkingId,
    });

    await admin.from("automations").delete().eq("id", automationId);
    await admin.from("cell_values").delete().eq("item_id", newItemId);
    await admin.from("items").delete().eq("id", newItemId);
  });

  // =========================================================================
  // 2. item_created → notify/member fires
  // =========================================================================
  it("item_created → notify/member sends notification to userB on new item", async () => {
    const automationId = await insertAutomation({
      trigger: { type: "item_created" },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
    });

    // INSERT a new item — actor is userA, recipient is userB (≠ actor)
    const newItemId = await createFreshItem();

    const notif = await poll(async () => {
      const { data } = await admin
        .from("notifications")
        .select("*")
        .eq("item_id", newItemId)
        .eq("recipient_id", userBId)
        .eq("kind", "automation")
        .eq("automation_id", automationId);
      return data && data.length > 0 ? data[0] : null;
    });

    expect(notif, "notification for userB on item_created").not.toBeNull();
    expect(notif).toMatchObject({
      kind: "automation",
      recipient_id: userBId,
      automation_id: automationId,
      item_id: newItemId,
      board_id: boardAId,
    });

    await admin.from("automations").delete().eq("id", automationId);
    await admin.from("notifications").delete().eq("item_id", newItemId);
    await admin.from("items").delete().eq("id", newItemId);
  });

  // =========================================================================
  // 3. person_assigned fires on addition (people cell gains a userId)
  // =========================================================================
  it("person_assigned fires notify(owner) when a user is added to the people cell", async () => {
    await cleanItemState(itemAId);

    const automationId = await insertAutomation({
      trigger: { type: "person_assigned", columnId: colOId },
      actions: [
        {
          type: "notify",
          recipient: { kind: "owner", peopleColumnId: colOId },
        },
      ],
    });

    // Upsert from empty → {userIds: [userB]}; userB = owner, userA = actor
    const writeErr = await setCell(itemAId, colOId, { userIds: [userBId] });
    expect(writeErr, "set O={userB}").toBeNull();

    const notif = await poll(async () => {
      const { data } = await admin
        .from("notifications")
        .select("*")
        .eq("item_id", itemAId)
        .eq("recipient_id", userBId)
        .eq("kind", "automation")
        .eq("automation_id", automationId);
      return data && data.length > 0 ? data[0] : null;
    });

    expect(notif, "notification for added person").not.toBeNull();
    expect(notif).toMatchObject({
      kind: "automation",
      recipient_id: userBId,
      automation_id: automationId,
      item_id: itemAId,
    });

    await admin.from("automations").delete().eq("id", automationId);
  });

  // =========================================================================
  // 4. person_assigned does NOT fire on removal or no-op
  // =========================================================================
  it("person_assigned does not fire on removal or no-op write", async () => {
    await cleanItemState(itemAId);

    // Seed the cell at {userIds:[userB]} via admin (no trigger — service role)
    const { error: seedErr } = await admin.from("cell_values").upsert(
      {
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemAId,
        column_id: colOId,
        value: { userIds: [userBId] } as never,
      },
      { onConflict: "item_id,column_id" },
    );
    expect(seedErr, "seed O={userB}").toBeNull();

    const automationId = await insertAutomation({
      trigger: { type: "person_assigned", columnId: colOId },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
    });

    // Removal: {userIds:[userB]} → {userIds:[]}
    const removalErr = await setCell(itemAId, colOId, { userIds: [] });
    expect(removalErr, "remove O").toBeNull();

    // No-op: write {userIds:[]} again (same value)
    const noopErr = await setCell(itemAId, colOId, { userIds: [] });
    expect(noopErr, "noop O").toBeNull();

    await new Promise((r) => setTimeout(r, 1_500));

    const { data: notifs } = await admin
      .from("notifications")
      .select("id")
      .eq("item_id", itemAId)
      .eq("kind", "automation")
      .eq("automation_id", automationId);
    expect(notifs ?? [], "no notification on removal or no-op").toHaveLength(0);

    await admin.from("automations").delete().eq("id", automationId);
  });

  // =========================================================================
  // 5. Condition gate — passes (AND combinator, priority=High ✓)
  // =========================================================================
  it("condition gate (AND) passes when priority=High and fires the action", async () => {
    await cleanItemState(itemAId);

    // Pre-set P = High via admin (no trigger on this column's automations row)
    await admin.from("cell_values").upsert(
      {
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemAId,
        column_id: colPId,
        value: { optionId: optHighId } as never,
      },
      { onConflict: "item_id,column_id" },
    );

    const automationId = await insertAutomation({
      trigger: { type: "status_changed", columnId: colSId, toOptionId: null },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
      condition: {
        combinator: "and",
        conditions: [{ columnId: colPId, operator: "is", value: optHighId }],
      },
    });

    // Trigger: change S to Working; P=High → condition passes
    const writeErr = await setCell(itemAId, colSId, { optionId: optWorkingId });
    expect(writeErr, "set S=Working (gate passes)").toBeNull();

    const notif = await poll(async () => {
      const { data } = await admin
        .from("notifications")
        .select("*")
        .eq("item_id", itemAId)
        .eq("recipient_id", userBId)
        .eq("kind", "automation")
        .eq("automation_id", automationId);
      return data && data.length > 0 ? data[0] : null;
    });

    expect(notif, "notification when condition passes").not.toBeNull();

    await admin.from("automations").delete().eq("id", automationId);
  });

  // =========================================================================
  // 6. Condition gate — blocks (AND combinator, priority=Low ✗)
  // =========================================================================
  it("condition gate (AND) blocks when priority=Low and suppresses the action", async () => {
    await cleanItemState(itemAId);

    // Set P = Low via admin
    await admin.from("cell_values").upsert(
      {
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemAId,
        column_id: colPId,
        value: { optionId: optLowId } as never,
      },
      { onConflict: "item_id,column_id" },
    );

    const automationId = await insertAutomation({
      trigger: { type: "status_changed", columnId: colSId, toOptionId: null },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
      condition: {
        combinator: "and",
        conditions: [
          { columnId: colPId, operator: "is", value: optHighId }, // High expected, but Low set
        ],
      },
    });

    const writeErr = await setCell(itemAId, colSId, { optionId: optDoneId });
    expect(writeErr, "set S=Done (gate blocks)").toBeNull();

    await new Promise((r) => setTimeout(r, 1_500));

    const { data: notifs } = await admin
      .from("notifications")
      .select("id")
      .eq("item_id", itemAId)
      .eq("kind", "automation")
      .eq("automation_id", automationId);
    expect(notifs ?? [], "no notification when condition blocks").toHaveLength(
      0,
    );

    await admin.from("automations").delete().eq("id", automationId);
  });

  // =========================================================================
  // 7. Condition OR — exactly one arm matches → fires
  // =========================================================================
  it("condition OR fires when exactly one arm matches", async () => {
    await cleanItemState(itemAId);

    // P = Low (matches second condition), S cell will be set separately
    await admin.from("cell_values").upsert(
      {
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemAId,
        column_id: colPId,
        value: { optionId: optLowId } as never,
      },
      { onConflict: "item_id,column_id" },
    );

    const automationId = await insertAutomation({
      trigger: { type: "status_changed", columnId: colSId, toOptionId: null },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
      condition: {
        combinator: "or",
        conditions: [
          { columnId: colPId, operator: "is", value: optHighId }, // false (P=Low)
          { columnId: colPId, operator: "is", value: optLowId }, // true
        ],
      },
    });

    const writeErr = await setCell(itemAId, colSId, { optionId: optWorkingId });
    expect(writeErr, "set S=Working (OR gate)").toBeNull();

    const notif = await poll(async () => {
      const { data } = await admin
        .from("notifications")
        .select("*")
        .eq("item_id", itemAId)
        .eq("recipient_id", userBId)
        .eq("kind", "automation")
        .eq("automation_id", automationId);
      return data && data.length > 0 ? data[0] : null;
    });

    expect(notif, "notification when OR gate passes").not.toBeNull();

    await admin.from("automations").delete().eq("id", automationId);
  });

  // =========================================================================
  // 8. Condition over text / number / date
  // =========================================================================

  it("text contains — gate passes when text matches, blocks when it does not", async () => {
    await cleanItemState(itemAId);

    // Pre-seed text cell = "hello world"
    await admin.from("cell_values").upsert(
      {
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemAId,
        column_id: colTextId,
        value: { text: "hello world" } as never,
      },
      { onConflict: "item_id,column_id" },
    );

    // Rule A — condition contains "hello" (will match)
    const rulePassId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optWorkingId,
      },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
      condition: {
        combinator: "and",
        conditions: [
          { columnId: colTextId, operator: "contains", value: "hello" },
        ],
      },
    });

    // Rule B — condition contains "xyz" (will NOT match)
    const ruleBlockId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optWorkingId,
      },
      actions: [{ type: "set_option", columnId: colPId, optionId: optHighId }],
      condition: {
        combinator: "and",
        conditions: [
          { columnId: colTextId, operator: "contains", value: "xyz" },
        ],
      },
    });

    const writeErr = await setCell(itemAId, colSId, { optionId: optWorkingId });
    expect(writeErr, "set S=Working (text gate test)").toBeNull();

    // Rule A (pass) → notification exists
    const notif = await poll(async () => {
      const { data } = await admin
        .from("notifications")
        .select("*")
        .eq("item_id", itemAId)
        .eq("recipient_id", userBId)
        .eq("automation_id", rulePassId);
      return data && data.length > 0 ? data[0] : null;
    });
    expect(notif, "text contains pass: notification").not.toBeNull();

    // Rule B (block) → no P cell set
    await new Promise((r) => setTimeout(r, 1_000));
    const { data: pCell } = await admin
      .from("cell_values")
      .select("value")
      .eq("item_id", itemAId)
      .eq("column_id", colPId);
    expect(pCell ?? [], "text contains block: no P cell set").toHaveLength(0);

    await admin.from("automations").delete().eq("id", rulePassId);
    await admin.from("automations").delete().eq("id", ruleBlockId);
  });

  it("numbers gt — gate passes when n>5, blocks when n<=5", async () => {
    await cleanItemState(itemAId);

    // Pre-seed number cell = 10
    await admin.from("cell_values").upsert(
      {
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemAId,
        column_id: colNumId,
        value: { n: 10 } as never,
      },
      { onConflict: "item_id,column_id" },
    );

    // Rule A — condition n > 5 (10 > 5 = true)
    const rulePassId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optWorkingId,
      },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
      condition: {
        combinator: "and",
        conditions: [{ columnId: colNumId, operator: "gt", value: "5" }],
      },
    });

    // Rule B — condition n > 20 (10 > 20 = false)
    const ruleBlockId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optWorkingId,
      },
      actions: [{ type: "set_option", columnId: colPId, optionId: optHighId }],
      condition: {
        combinator: "and",
        conditions: [{ columnId: colNumId, operator: "gt", value: "20" }],
      },
    });

    const writeErr = await setCell(itemAId, colSId, { optionId: optWorkingId });
    expect(writeErr, "set S=Working (num gate test)").toBeNull();

    // Rule A (pass) → notification
    const notif = await poll(async () => {
      const { data } = await admin
        .from("notifications")
        .select("*")
        .eq("item_id", itemAId)
        .eq("recipient_id", userBId)
        .eq("automation_id", rulePassId);
      return data && data.length > 0 ? data[0] : null;
    });
    expect(notif, "num gt pass: notification").not.toBeNull();

    // Rule B (block) → no P cell
    await new Promise((r) => setTimeout(r, 1_000));
    const { data: pCell } = await admin
      .from("cell_values")
      .select("value")
      .eq("item_id", itemAId)
      .eq("column_id", colPId);
    expect(pCell ?? [], "num gt block: no P cell set").toHaveLength(0);

    await admin.from("automations").delete().eq("id", rulePassId);
    await admin.from("automations").delete().eq("id", ruleBlockId);
  });

  it("date on — gate passes when date matches, blocks when it does not", async () => {
    await cleanItemState(itemAId);

    const targetDate = "2025-03-15";

    // Pre-seed date cell = targetDate
    await admin.from("cell_values").upsert(
      {
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemAId,
        column_id: colDateId,
        value: { date: targetDate } as never,
      },
      { onConflict: "item_id,column_id" },
    );

    // Rule A — condition date = targetDate (passes)
    const rulePassId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optWorkingId,
      },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
      condition: {
        combinator: "and",
        conditions: [
          { columnId: colDateId, operator: "on", value: targetDate },
        ],
      },
    });

    // Rule B — condition date = different date (blocks)
    const ruleBlockId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optWorkingId,
      },
      actions: [{ type: "set_option", columnId: colPId, optionId: optHighId }],
      condition: {
        combinator: "and",
        conditions: [
          { columnId: colDateId, operator: "on", value: "2020-01-01" },
        ],
      },
    });

    const writeErr = await setCell(itemAId, colSId, { optionId: optWorkingId });
    expect(writeErr, "set S=Working (date gate test)").toBeNull();

    // Rule A (pass) → notification
    const notif = await poll(async () => {
      const { data } = await admin
        .from("notifications")
        .select("*")
        .eq("item_id", itemAId)
        .eq("recipient_id", userBId)
        .eq("automation_id", rulePassId);
      return data && data.length > 0 ? data[0] : null;
    });
    expect(notif, "date on pass: notification").not.toBeNull();

    // Rule B (block) → no P cell
    await new Promise((r) => setTimeout(r, 1_000));
    const { data: pCell } = await admin
      .from("cell_values")
      .select("value")
      .eq("item_id", itemAId)
      .eq("column_id", colPId);
    expect(pCell ?? [], "date on block: no P cell set").toHaveLength(0);

    await admin.from("automations").delete().eq("id", rulePassId);
    await admin.from("automations").delete().eq("id", ruleBlockId);
  });

  // =========================================================================
  // 9. null/empty condition always passes (gate defaults open)
  // =========================================================================
  it("null condition always passes (gate defaults open)", async () => {
    await cleanItemState(itemAId);

    const automationId = await insertAutomation({
      trigger: { type: "status_changed", columnId: colSId, toOptionId: null },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
      condition: null, // explicitly null
    });

    const writeErr = await setCell(itemAId, colSId, { optionId: optWorkingId });
    expect(writeErr, "set S=Working (null condition)").toBeNull();

    const notif = await poll(async () => {
      const { data } = await admin
        .from("notifications")
        .select("*")
        .eq("item_id", itemAId)
        .eq("recipient_id", userBId)
        .eq("automation_id", automationId);
      return data && data.length > 0 ? data[0] : null;
    });

    expect(
      notif,
      "notification with null condition (gate open)",
    ).not.toBeNull();

    await admin.from("automations").delete().eq("id", automationId);
  });

  // =========================================================================
  // 10. Regression — 5a status_changed still works
  // =========================================================================
  it("regression: status_changed + notify(owner) still works (5a path)", async () => {
    await cleanItemState(itemAId);

    // Set O = {userIds: [userB]} (owner is userB; actor will be userA)
    const setCellOErr = await setCell(itemAId, colOId, { userIds: [userBId] });
    expect(setCellOErr, "set owner cell").toBeNull();

    const automationId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optDoneId,
      },
      actions: [
        {
          type: "notify",
          recipient: { kind: "owner", peopleColumnId: colOId },
        },
      ],
    });

    const writeErr = await setCell(itemAId, colSId, { optionId: optDoneId });
    expect(writeErr, "set S=Done").toBeNull();

    const notif = await poll(async () => {
      const { data } = await admin
        .from("notifications")
        .select("*")
        .eq("item_id", itemAId)
        .eq("recipient_id", userBId)
        .eq("kind", "automation")
        .eq("automation_id", automationId);
      return data && data.length > 0 ? data[0] : null;
    });

    expect(notif, "5a regression: notification").not.toBeNull();

    await admin.from("automations").delete().eq("id", automationId);
  });

  // =========================================================================
  // 11. Regression — loop safety caps on item_created path
  // =========================================================================
  it("regression: loop guard caps cascades from item_created without error", async () => {
    // Rule A: item_created → S=Working
    // Rule B: status_changed(S→Working) → S=Done
    // Rule C: status_changed(S→Done) → S=Working  (would loop forever without cap)
    const ruleAId = await insertAutomation({
      trigger: { type: "item_created" },
      actions: [
        { type: "set_option", columnId: colSId, optionId: optWorkingId },
      ],
    });
    const ruleBId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optWorkingId,
      },
      actions: [{ type: "set_option", columnId: colSId, optionId: optDoneId }],
    });
    const ruleCId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optDoneId,
      },
      actions: [
        { type: "set_option", columnId: colSId, optionId: optWorkingId },
      ],
    });

    // Should NOT throw — loop guard caps depth at 5
    const newItemId = await createFreshItem();

    // Wait for any cascades to settle
    await new Promise((r) => setTimeout(r, 2_000));

    // S cell should exist and hold one of the valid options (engine settled)
    const { data: cellS } = await admin
      .from("cell_values")
      .select("value")
      .eq("item_id", newItemId)
      .eq("column_id", colSId)
      .maybeSingle();

    const sVal = (cellS as { value: { optionId: string } } | null)?.value
      ?.optionId;
    expect(
      [optWorkingId, optDoneId],
      "S settled to a valid optionId after loop cap",
    ).toContain(sVal);

    await admin.from("automations").delete().eq("id", ruleAId);
    await admin.from("automations").delete().eq("id", ruleBId);
    await admin.from("automations").delete().eq("id", ruleCId);
    await admin.from("notifications").delete().eq("item_id", newItemId);
    await admin.from("cell_values").delete().eq("item_id", newItemId);
    await admin.from("items").delete().eq("id", newItemId);
  });

  // =========================================================================
  // 12a. Regression — disabled rules never fire (item_created + person_assigned)
  // =========================================================================
  it("disabled rule never fires for item_created or person_assigned", async () => {
    await cleanItemState(itemAId);

    const disabledItemCreatedId = await insertAutomation({
      trigger: { type: "item_created" },
      actions: [
        { type: "set_option", columnId: colSId, optionId: optWorkingId },
      ],
      enabled: false,
    });

    const disabledPersonAssignedId = await insertAutomation({
      trigger: { type: "person_assigned", columnId: colOId },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
      enabled: false,
    });

    // Trigger item_created
    const newItemId = await createFreshItem();

    // Trigger person_assigned
    const personErr = await setCell(itemAId, colOId, { userIds: [userBId] });
    expect(personErr, "set O={userB} (disabled)").toBeNull();

    await new Promise((r) => setTimeout(r, 1_500));

    // No S cell on new item (disabled item_created rule)
    const { data: sCell } = await admin
      .from("cell_values")
      .select("id")
      .eq("item_id", newItemId)
      .eq("column_id", colSId);
    expect(sCell ?? [], "disabled item_created: no S cell").toHaveLength(0);

    // No notifications for person_assigned disabled rule
    const { data: notifs } = await admin
      .from("notifications")
      .select("id")
      .eq("item_id", itemAId)
      .eq("automation_id", disabledPersonAssignedId);
    expect(
      notifs ?? [],
      "disabled person_assigned: no notification",
    ).toHaveLength(0);

    await admin.from("automations").delete().eq("id", disabledItemCreatedId);
    await admin.from("automations").delete().eq("id", disabledPersonAssignedId);
    await admin.from("items").delete().eq("id", newItemId);
  });

  // =========================================================================
  // 12b. Regression — cross-org isolation for new trigger types
  // =========================================================================
  describe("cross-org isolation for new trigger types", () => {
    let crossOrgAutoId: string;

    beforeAll(async () => {
      // Seed an item_created automation in orgA
      const { data, error } = await admin
        .from("automations")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          trigger: { type: "item_created" } as never,
          actions: [] as never,
          enabled: true,
          created_by: userAId,
        })
        .select("id")
        .single();
      expect(
        error,
        "seed item_created automation for cross-org test",
      ).toBeNull();
      crossOrgAutoId = (data as { id: string }).id;
    }, 15_000);

    afterAll(async () => {
      await admin.from("automations").delete().eq("id", crossOrgAutoId);
    });

    it("userB cannot see orgA item_created automations (zero rows)", async () => {
      const { data, error } = await userBAnon
        .from("automations")
        .select("*")
        .eq("board_id", boardAId);
      expect(error).toBeNull(); // RLS silently hides
      expect(data ?? []).toHaveLength(0);
    });

    it("userB cannot insert item_created automation into orgA (error)", async () => {
      const { error } = await userBAnon.from("automations").insert({
        org_id: orgAId,
        board_id: boardAId,
        trigger: { type: "item_created" } as never,
        actions: [] as never,
      });
      expect(error, "cross-org item_created insert rejected").not.toBeNull();
    });
  });

  // =========================================================================
  // 13. move_to_group action
  // =========================================================================
  describe("move_to_group action", () => {
    it("status_changed → move_to_group moves the item to the target group", async () => {
      const itemId = await createFreshItem();
      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: optDoneId,
        },
        actions: [{ type: "move_to_group", groupId: targetGroupId }],
      });

      const writeErr = await setCell(itemId, colSId, { optionId: optDoneId });
      expect(writeErr, "set S=Done (move)").toBeNull();

      const moved = await poll(async () => {
        return (await itemGroup(itemId)) === targetGroupId ? true : null;
      });
      expect(moved, "item moved to target group").toBe(true);

      await admin.from("automations").delete().eq("id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    });

    it("does not move when the trigger option does not match", async () => {
      const itemId = await createFreshItem();
      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: optDoneId,
        },
        actions: [{ type: "move_to_group", groupId: targetGroupId }],
      });

      const writeErr = await setCell(itemId, colSId, {
        optionId: optWorkingId,
      });
      expect(writeErr, "set S=Working (no match)").toBeNull();

      await new Promise((r) => setTimeout(r, 1_500));
      expect(await itemGroup(itemId), "item stays in original group").toBe(
        groupAId,
      );

      await admin.from("automations").delete().eq("id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    });

    it("is a no-op when the target group does not exist / is on another board", async () => {
      const itemId = await createFreshItem();
      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: null,
        },
        actions: [{ type: "move_to_group", groupId: randomUUID() }],
      });

      const writeErr = await setCell(itemId, colSId, { optionId: optDoneId });
      expect(writeErr, "set S=Done (bogus group)").toBeNull();

      await new Promise((r) => setTimeout(r, 1_500));
      expect(
        await itemGroup(itemId),
        "item unchanged for nonexistent target group",
      ).toBe(groupAId);

      await admin.from("automations").delete().eq("id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    });

    it("respects the condition gate (no move when condition fails)", async () => {
      const itemId = await createFreshItem();
      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: null,
        },
        actions: [{ type: "move_to_group", groupId: targetGroupId }],
        condition: {
          combinator: "and",
          conditions: [{ columnId: colPId, operator: "is", value: optHighId }],
        },
      });

      // P is unset → condition fails
      const writeErr = await setCell(itemId, colSId, { optionId: optDoneId });
      expect(writeErr, "set S=Done (condition fails)").toBeNull();

      await new Promise((r) => setTimeout(r, 1_500));
      expect(
        await itemGroup(itemId),
        "item not moved when condition fails",
      ).toBe(groupAId);

      await admin.from("automations").delete().eq("id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    });

    it("is a no-op when the item is already in the target group", async () => {
      const item = await createFreshItem();
      // Move it into the target group first (directly, no automation).
      await admin
        .from("items")
        .update({ group_id: targetGroupId })
        .eq("id", item);

      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: null,
        },
        actions: [{ type: "move_to_group", groupId: targetGroupId }],
      });

      const writeErr = await setCell(item, colSId, { optionId: optDoneId });
      expect(writeErr, "set S=Done (already in target group)").toBeNull();

      await new Promise((r) => setTimeout(r, 1_500));

      // Group unchanged — the engine did not bounce/duplicate the item.
      expect(await itemGroup(item), "item stays in target group (no-op)").toBe(
        targetGroupId,
      );

      // The run ledger records the no-op outcome, proving the guard fired the
      // no-op path rather than nothing happening.
      const { data: run } = await admin
        .from("automation_runs")
        .select("actions")
        .eq("automation_id", automationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      expect(run, "automation_runs row for no-op").not.toBeNull();
      expect(
        (run as { actions: unknown }).actions,
        "ledger records move_to_group skipped_noop",
      ).toContainEqual({ type: "move_to_group", outcome: "skipped_noop" });

      await admin.from("automations").delete().eq("id", automationId);
      await admin.from("cell_values").delete().eq("item_id", item);
      await admin.from("items").delete().eq("id", item);
    });

    it("does not move a subitem (parent_id is null guard)", async () => {
      const parent = await createFreshItem();

      const { data: subData, error: subErr } = await admin
        .from("items")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          group_id: groupAId,
          name: `Subitem ${randomUUID().slice(0, 8)}`,
          parent_id: parent,
          position: 1,
        })
        .select("id")
        .single();
      expect(subErr, "insert subitem").toBeNull();
      const subitem = (subData as { id: string }).id;

      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: null,
        },
        actions: [{ type: "move_to_group", groupId: targetGroupId }],
      });

      // Trigger on the SUBITEM.
      const writeErr = await setCell(subitem, colSId, { optionId: optDoneId });
      expect(writeErr, "set S=Done on subitem").toBeNull();

      await new Promise((r) => setTimeout(r, 1_500));

      // The engine's `parent_id is null` guard prevents moving subitems.
      expect(await itemGroup(subitem), "subitem stays in original group").toBe(
        groupAId,
      );

      await admin.from("automations").delete().eq("id", automationId);
      await admin.from("cell_values").delete().eq("item_id", subitem);
      await admin.from("items").delete().eq("id", subitem);
      await admin.from("items").delete().eq("id", parent);
    });
  });
});
