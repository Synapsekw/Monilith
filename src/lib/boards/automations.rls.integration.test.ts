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

describe.skipIf(!SERVICE_ROLE_KEY)("RLS + engine: automations (5a)", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  /** orgA context */
  let userAId: string;
  let userAAnon: SupabaseClient<Database>;
  let orgAId: string;
  let boardAId: string;
  let itemAId: string;
  /** Status column S (options: Done, Stuck) */
  let colSId: string;
  let optDoneId: string;
  let optStuckId: string;
  /** Status column P (options: Low, Urgent) */
  let colPId: string;
  let optUrgentId: string;
  /** People column O */
  let colOId: string;

  /** orgB context — NOT a member of orgA */
  let userBId: string;
  let userBAnon: SupabaseClient<Database>;
  let orgBId: string;

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── create userA ──────────────────────────────────────────────────────
    const emailA = `rls-auto-a-${randomUUID()}@example.com`;
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

    // org + workspace + board via RPCs (same pattern as boards.rls test)
    const { data: orgData } = await userAAnon.rpc("create_organization", {
      p_name: "Org A (auto)",
      p_slug: `auto-a-${randomUUID().slice(0, 8)}`,
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
    const groupAId = (groupData as { id: string }).id;

    const { data: itemData } = await userAAnon.rpc("create_item", {
      p_group_id: groupAId,
      p_name: "Item A",
    });
    itemAId = (itemData as { id: string }).id;

    // ── insert Status column S with options Done / Stuck ──────────────────
    const sOptions = [
      { id: randomUUID(), label: "Done", color: "#00c875" },
      { id: randomUUID(), label: "Stuck", color: "#df2f4a" },
    ];
    optDoneId = sOptions[0].id;
    optStuckId = sOptions[1].id;

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

    // ── insert Status column P with options Low / Urgent ─────────────────
    const pOptions = [
      { id: randomUUID(), label: "Low", color: "#579bfc" },
      { id: randomUUID(), label: "Urgent", color: "#e2445c" },
    ];
    optUrgentId = pOptions[1].id;

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

    // ── insert People column O ────────────────────────────────────────────
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

    // ── create userB in a separate org ───────────────────────────────────
    const emailB = `rls-auto-b-${randomUUID()}@example.com`;
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

    // userB must belong to an org (so they have an auth session), but NOT orgA
    const { data: orgBData } = await userBAnon.rpc("create_organization", {
      p_name: "Org B (auto)",
      p_slug: `auto-b-${randomUUID().slice(0, 8)}`,
    });
    orgBId = (orgBData as { id: string }).id;
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: insert an automation via the service-role client
  // ─────────────────────────────────────────────────────────────────────────
  async function insertAutomation(opts: {
    trigger: unknown;
    actions: unknown;
    enabled?: boolean;
  }): Promise<string> {
    const { data, error } = await admin
      .from("automations")
      .insert({
        org_id: orgAId,
        board_id: boardAId,
        trigger: opts.trigger as never,
        actions: opts.actions as never,
        enabled: opts.enabled ?? true,
        created_by: userAId,
      })
      .select("id")
      .single();
    expect(error, "insertAutomation").toBeNull();
    return (data as { id: string }).id;
  }

  /** Delete all notifications and cell_values on I (isolate each test). */
  async function cleanItemState() {
    await admin.from("notifications").delete().eq("item_id", itemAId);
    await admin.from("cell_values").delete().eq("item_id", itemAId);
  }

  /** Upsert a cell value as userA (the triggering actor). */
  async function setCell(columnId: string, value: unknown) {
    const { error } = await userAAnon.from("cell_values").upsert(
      {
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemAId,
        column_id: columnId,
        value: value as never,
      },
      { onConflict: "item_id,column_id" },
    );
    return error;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. status→Done fires notify(owner)
  // ─────────────────────────────────────────────────────────────────────────
  it("status→Done fires notify(owner) when owner≠actor", async () => {
    await cleanItemState();

    // Set O = {userIds: [userB]}  (owner is userB; actor will be userA)
    const setCellO = await setCell(colOId, { userIds: [userBId] });
    expect(setCellO, "set owner cell").toBeNull();

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

    // userA sets S=Done → engine fires, actor=userA, recipient=userB
    const writeErr = await setCell(colSId, { optionId: optDoneId });
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

    expect(notif, "notification row").not.toBeNull();
    expect(notif).toMatchObject({
      kind: "automation",
      recipient_id: userBId,
      automation_id: automationId,
      item_id: itemAId,
      board_id: boardAId,
    });

    // cleanup this automation
    await admin.from("automations").delete().eq("id", automationId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. set_option action
  // ─────────────────────────────────────────────────────────────────────────
  it("set_option sets P=Urgent when S→Stuck", async () => {
    await cleanItemState();

    const automationId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optStuckId,
      },
      actions: [
        { type: "set_option", columnId: colPId, optionId: optUrgentId },
      ],
    });

    const writeErr = await setCell(colSId, { optionId: optStuckId });
    expect(writeErr, "set S=Stuck").toBeNull();

    const cell = await poll(async () => {
      const { data } = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", itemAId)
        .eq("column_id", colPId);
      return data && data.length > 0 ? data[0] : null;
    });

    expect(cell, "P cell value").not.toBeNull();
    expect((cell as { value: unknown }).value).toMatchObject({
      optionId: optUrgentId,
    });

    await admin.from("automations").delete().eq("id", automationId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. "any value" trigger (toOptionId: null) fires on any S change
  // ─────────────────────────────────────────────────────────────────────────
  it("any-value trigger (toOptionId: null) fires on any status change", async () => {
    await cleanItemState();

    const automationId = await insertAutomation({
      trigger: { type: "status_changed", columnId: colSId, toOptionId: null },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
    });

    // Use Stuck (not Done) so it's a generic "any change" scenario
    const writeErr = await setCell(colSId, { optionId: optStuckId });
    expect(writeErr, "set S=Stuck (any)").toBeNull();

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

    expect(notif, "any-trigger notification").not.toBeNull();

    await admin.from("automations").delete().eq("id", automationId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Disabled rule never fires
  // ─────────────────────────────────────────────────────────────────────────
  it("disabled automation never fires (no notification, no cell change)", async () => {
    await cleanItemState();

    const notifAutoId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optDoneId,
      },
      actions: [
        { type: "notify", recipient: { kind: "member", userId: userBId } },
      ],
      enabled: false,
    });

    const cellAutoId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optDoneId,
      },
      actions: [
        { type: "set_option", columnId: colPId, optionId: optUrgentId },
      ],
      enabled: false,
    });

    const writeErr = await setCell(colSId, { optionId: optDoneId });
    expect(writeErr, "set S=Done (disabled test)").toBeNull();

    // Wait a moment and confirm nothing was inserted
    await new Promise((r) => setTimeout(r, 1_500));

    const { data: notifs } = await admin
      .from("notifications")
      .select("id")
      .eq("item_id", itemAId);
    expect(notifs ?? [], "no notifications from disabled rule").toHaveLength(0);

    const { data: cellP } = await admin
      .from("cell_values")
      .select("id")
      .eq("item_id", itemAId)
      .eq("column_id", colPId);
    expect(cellP ?? [], "no P cell from disabled rule").toHaveLength(0);

    await admin.from("automations").delete().eq("id", notifAutoId);
    await admin.from("automations").delete().eq("id", cellAutoId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Loop safety: A→B→A cycle completes without recursion error
  // ─────────────────────────────────────────────────────────────────────────
  it("cascading loop guard: A{S→Done⇒P=Urgent} + B{P→Urgent⇒S=Stuck} completes without error", async () => {
    await cleanItemState();

    const ruleAId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optDoneId,
      },
      actions: [
        { type: "set_option", columnId: colPId, optionId: optUrgentId },
      ],
    });

    const ruleBId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colPId,
        toOptionId: optUrgentId,
      },
      actions: [{ type: "set_option", columnId: colSId, optionId: optStuckId }],
    });

    // This should NOT throw — loop guard caps depth at 5
    const writeErr = await setCell(colSId, { optionId: optDoneId });
    expect(writeErr, "loop guard write must not error").toBeNull();

    // Both cells should have settled to stable values (last set_option wins)
    await new Promise((r) => setTimeout(r, 1_500));

    const { data: cellS } = await admin
      .from("cell_values")
      .select("value")
      .eq("item_id", itemAId)
      .eq("column_id", colSId)
      .maybeSingle();

    const { data: cellP } = await admin
      .from("cell_values")
      .select("value")
      .eq("item_id", itemAId)
      .eq("column_id", colPId)
      .maybeSingle();

    // Cells exist (values were written); exact final values depend on guard depth
    // but the important invariant is: no error and at least one cell was set.
    const sVal = (cellS as { value: { optionId: string } } | null)?.value
      ?.optionId;
    const pVal = (cellP as { value: { optionId: string } } | null)?.value
      ?.optionId;

    // S ended at Done (initial write) or Stuck (after ruleB fired); both are valid
    expect([optDoneId, optStuckId], "S is a known optionId").toContain(sVal);
    // P ended at Urgent (after ruleA fired)
    expect(pVal, "P is Urgent").toBe(optUrgentId);

    await admin.from("automations").delete().eq("id", ruleAId);
    await admin.from("automations").delete().eq("id", ruleBId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Self-actor excluded: owner==actor → NO notification
  // ─────────────────────────────────────────────────────────────────────────
  it("self-actor exclusion: owner==actor produces no notification", async () => {
    await cleanItemState();

    // Set O = {userIds: [userA]}  — userA is both actor and owner
    const setCellO = await setCell(colOId, { userIds: [userAId] });
    expect(setCellO, "set owner to self").toBeNull();

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

    // userA triggers the rule (actor = userA), owner = userA → excluded
    const writeErr = await setCell(colSId, { optionId: optDoneId });
    expect(writeErr, "set S=Done (self-actor)").toBeNull();

    await new Promise((r) => setTimeout(r, 1_500));

    const { data: notifs } = await admin
      .from("notifications")
      .select("id")
      .eq("item_id", itemAId)
      .eq("kind", "automation")
      .eq("automation_id", automationId);
    expect(notifs ?? [], "no self-notification").toHaveLength(0);

    await admin.from("automations").delete().eq("id", automationId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Unresolved owner no-ops: notify(owner) with empty People column → 0 rows
  // ─────────────────────────────────────────────────────────────────────────
  it("unresolved owner no-ops: notify(owner) with empty People column creates no notification", async () => {
    await cleanItemState();
    // People column O is intentionally left empty (no cell_values row for it)

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

    // userA sets S=Done → engine fires but owner list is empty → no notification
    const writeErr = await setCell(colSId, { optionId: optDoneId });
    expect(writeErr, "set S=Done (empty owner)").toBeNull();

    await new Promise((r) => setTimeout(r, 1_500));

    const { data: notifs } = await admin
      .from("notifications")
      .select("id")
      .eq("item_id", itemAId)
      .eq("kind", "automation")
      .eq("automation_id", automationId);
    expect(
      notifs ?? [],
      "no notification when owner column is empty",
    ).toHaveLength(0);

    await admin.from("automations").delete().eq("id", automationId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. set_option skips when already equal: value unchanged, row count stays 1
  // ─────────────────────────────────────────────────────────────────────────
  it("set_option skips when P already equals Urgent (no duplicate row, value unchanged)", async () => {
    await cleanItemState();

    // Pre-seed P = Urgent directly via admin (service-role) so no trigger fires
    const { error: seedErr } = await admin.from("cell_values").upsert(
      {
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemAId,
        column_id: colPId,
        value: { optionId: optUrgentId } as never,
      },
      { onConflict: "item_id,column_id" },
    );
    expect(seedErr, "seed P=Urgent").toBeNull();

    // Capture updated_at of the pre-seeded row
    const { data: before } = await admin
      .from("cell_values")
      .select("updated_at")
      .eq("item_id", itemAId)
      .eq("column_id", colPId)
      .single();
    const updatedAtBefore = (before as { updated_at: string }).updated_at;

    const automationId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optDoneId,
      },
      actions: [
        { type: "set_option", columnId: colPId, optionId: optUrgentId },
      ],
    });

    // Trigger S=Done; engine sees P already equals Urgent → skip-if-equal branch
    const writeErr = await setCell(colSId, { optionId: optDoneId });
    expect(writeErr, "set S=Done (skip-if-equal)").toBeNull();

    await new Promise((r) => setTimeout(r, 1_500));

    // Exactly one row for (item, P)
    const { data: rows } = await admin
      .from("cell_values")
      .select("value, updated_at")
      .eq("item_id", itemAId)
      .eq("column_id", colPId);
    expect(rows ?? [], "exactly one P cell row").toHaveLength(1);

    const row = (
      rows as { value: { optionId: string }; updated_at: string }[]
    )[0];
    expect(row.value, "P still equals Urgent").toMatchObject({
      optionId: optUrgentId,
    });
    expect(row.updated_at, "updated_at unchanged (no redundant write)").toBe(
      updatedAtBefore,
    );

    await admin.from("automations").delete().eq("id", automationId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Cross-org RLS on automations table
  // ─────────────────────────────────────────────────────────────────────────
  describe("cross-org RLS on automations", () => {
    let seedAutoId: string;

    beforeAll(async () => {
      // Seed one automation in orgA so we can verify userB cannot see it
      const { data, error } = await admin
        .from("automations")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          trigger: {
            type: "status_changed",
            columnId: colSId,
            toOptionId: null,
          } as never,
          actions: [] as never,
          enabled: true,
          created_by: userAId,
        })
        .select("id")
        .single();
      expect(error, "seed automation for RLS test").toBeNull();
      seedAutoId = (data as { id: string }).id;
    }, 15_000);

    afterAll(async () => {
      await admin.from("automations").delete().eq("id", seedAutoId);
    });

    it("userB cannot select orgA automations (zero rows)", async () => {
      const { data, error } = await userBAnon
        .from("automations")
        .select("*")
        .eq("board_id", boardAId);
      expect(error).toBeNull(); // RLS silently hides
      expect(data ?? []).toHaveLength(0);
    });

    it("userB cannot insert into orgA (error or 0 rows)", async () => {
      const { error } = await userBAnon.from("automations").insert({
        org_id: orgAId,
        board_id: boardAId,
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: null,
        } as never,
        actions: [] as never,
      });
      expect(error, "cross-org insert rejected").not.toBeNull();
    });

    it("userB cannot update orgA automations (0 rows affected)", async () => {
      // RLS will hide the row, so update affects 0 rows; verify name unchanged
      await userBAnon
        .from("automations")
        .update({ name: "hacked" })
        .eq("id", seedAutoId);

      const { data } = await admin
        .from("automations")
        .select("name")
        .eq("id", seedAutoId)
        .single();
      // name should still be null (original value), not "hacked"
      expect((data as { name: string | null }).name).not.toBe("hacked");
    });

    it("userB cannot delete orgA automations (0 rows affected)", async () => {
      await userBAnon.from("automations").delete().eq("id", seedAutoId);

      // Automation should still exist
      const { data } = await admin
        .from("automations")
        .select("id")
        .eq("id", seedAutoId)
        .maybeSingle();
      expect(
        data,
        "automation still exists after B's delete attempt",
      ).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // §7-T1. Cross-org RLS on automation_date_fires ledger
  // ─────────────────────────────────────────────────────────────────────────
  describe("§7 cross-org RLS on automation_date_fires (5b-2 ledger)", () => {
    let ledgerAutoId: string;
    let ledgerItemId: string;

    beforeAll(async () => {
      // Seed a minimal date_reached automation in orgA via service-role
      const { data: autoData, error: autoErr } = await admin
        .from("automations")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          trigger: {
            type: "date_reached",
            columnId: colSId,
            offsetDays: 0,
          } as never,
          actions: [] as never,
          enabled: true,
          created_by: userAId,
        })
        .select("id")
        .single();
      expect(autoErr, "seed ledger automation").toBeNull();
      ledgerAutoId = (autoData as { id: string }).id;

      // Find the existing item in orgA (itemAId is set in parent beforeAll)
      ledgerItemId = itemAId;

      // Insert one ledger row via admin (service-role bypasses RLS)
      const { error: fireErr } = await admin
        .from("automation_date_fires")
        .insert({
          automation_id: ledgerAutoId,
          item_id: ledgerItemId,
          org_id: orgAId,
          fire_date: "2026-07-01",
        });
      expect(fireErr, "insert ledger row via admin").toBeNull();
    }, 20_000);

    afterAll(async () => {
      await admin
        .from("automation_date_fires")
        .delete()
        .eq("automation_id", ledgerAutoId);
      await admin.from("automations").delete().eq("id", ledgerAutoId);
    });

    it("orgA member CAN read their own ledger row", async () => {
      const { data, error } = await userAAnon
        .from("automation_date_fires")
        .select("*")
        .eq("automation_id", ledgerAutoId);
      expect(error, "orgA read should not error").toBeNull();
      expect(data ?? [], "orgA user should see their ledger row").toHaveLength(
        1,
      );
    });

    it("orgB user CANNOT read orgA ledger row (0 rows — cross-org isolation)", async () => {
      const { data, error } = await userBAnon
        .from("automation_date_fires")
        .select("*")
        .eq("automation_id", ledgerAutoId);
      expect(
        error,
        "cross-org read should not error (RLS silently hides)",
      ).toBeNull();
      expect(
        data ?? [],
        "orgB user must see 0 rows from orgA ledger",
      ).toHaveLength(0);
    });

    it("no anon client can INSERT into automation_date_fires (default-deny write)", async () => {
      // Count rows before the attempted insert
      const { data: before } = await admin
        .from("automation_date_fires")
        .select("automation_id")
        .eq("automation_id", ledgerAutoId);
      const countBefore = (before ?? []).length;

      // Attempt insert as orgA member (should be blocked by RLS — no write policy)
      await userAAnon.from("automation_date_fires").insert({
        automation_id: ledgerAutoId,
        item_id: ledgerItemId,
        org_id: orgAId,
        fire_date: "2026-08-01",
      });

      // Count after — must be unchanged regardless of whether an error was returned
      const { data: after } = await admin
        .from("automation_date_fires")
        .select("automation_id")
        .eq("automation_id", ledgerAutoId);
      expect(
        (after ?? []).length,
        "row count must not increase after blocked insert attempt",
      ).toBe(countBefore);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // §7-T2. Non-admin member cannot update organizations.timezone
  // ─────────────────────────────────────────────────────────────────────────
  describe("§7 non-admin cannot update organizations.timezone", () => {
    let memberUserId: string;
    let memberAnon: SupabaseClient<Database>;
    const memberEmail = `rls-member-${randomUUID()}@example.com`;

    beforeAll(async () => {
      // Create a plain member user and add them to orgA with role 'member'
      const { data: createdMember, error: memberErr } =
        await admin.auth.admin.createUser({
          email: memberEmail,
          password: PASSWORD,
          email_confirm: true,
        });
      expect(memberErr, "createUser(member)").toBeNull();
      memberUserId = createdMember.user!.id;
      createdUserIds.push(memberUserId);

      memberAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(memberAnon, {
        email: memberEmail,
        password: PASSWORD,
      });

      // Add them to orgA as 'member' via service-role (bypasses any RLS on insert)
      const { error: addErr } = await admin.from("org_members").insert({
        org_id: orgAId,
        user_id: memberUserId,
        role: "member",
      });
      expect(addErr, "add member to orgA").toBeNull();
    }, 20_000);

    afterAll(async () => {
      await admin
        .from("org_members")
        .delete()
        .eq("org_id", orgAId)
        .eq("user_id", memberUserId);
      // memberUserId cleanup is handled by the parent afterAll (createdUserIds)
    });

    it("plain member update of organizations.timezone is blocked by RLS", async () => {
      // Read current timezone so we can assert it is unchanged after the attempt
      const { data: before } = await admin
        .from("organizations")
        .select("timezone")
        .eq("id", orgAId)
        .single();
      const originalTz = (before as { timezone: string | null }).timezone;

      // Attempt update as plain member
      await memberAnon
        .from("organizations")
        .update({ timezone: "Asia/Tokyo" })
        .eq("id", orgAId);

      // RLS blocks silently (0 rows affected, no error returned to client).
      // Verify by reading back the value via admin.
      const { data: after } = await admin
        .from("organizations")
        .select("timezone")
        .eq("id", orgAId)
        .single();
      expect(
        (after as { timezone: string | null }).timezone,
        "timezone must be unchanged after member update attempt",
      ).toBe(originalTz);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // §7-T3. Org-local correctness: same UTC instant, only the 08:00-local org fires
  //
  // Placed here (rls file) because this file already has two orgs (A and B)
  // and admin.rpc("_automation_date_sweep") works without the full engine-file
  // beforeAll overhead.
  //
  // p_now = 2026-07-10T23:00:00Z
  //   Asia/Tokyo   (UTC+9): 2026-07-11 08:00 → fires  (cell date = 2026-07-11)
  //   America/New_York (UTC-4 in July): 2026-07-10 19:00 → does NOT fire
  // ─────────────────────────────────────────────────────────────────────────
  describe("§7 org-local correctness: only the 08:00-local org fires (two orgs, one sweep)", () => {
    const P_NOW = "2026-07-10T23:00:00Z";

    // orgB board/group (created fresh in this describe)
    let orgBBoardId: string;
    let orgBGroupId: string;

    // Column ids created for this test (both orgs)
    let orgADateColId: string;
    let orgAStatusColId: string;
    let orgAOptWorkingId: string;

    let orgBDateColId: string;
    let orgBStatusColId: string;
    let orgBOptWorkingId: string;

    // Automation ids
    let autoAId: string;
    let autoBId: string;

    // Item ids
    let itemALocalId: string;
    let itemBLocalId: string;

    beforeAll(async () => {
      // ── Configure timezones ───────────────────────────────────────────────
      await admin
        .from("organizations")
        .update({ timezone: "Asia/Tokyo" })
        .eq("id", orgAId);
      await admin
        .from("organizations")
        .update({ timezone: "America/New_York" })
        .eq("id", orgBId);

      // ── orgB: create a workspace + board + group ──────────────────────────
      const { data: wsBData } = await userBAnon
        .from("workspaces")
        .insert({ org_id: orgBId, name: "WS B sweep", created_by: userBId })
        .select("id")
        .single();
      const wsBId = (wsBData as { id: string }).id;

      const { data: boardBData, error: boardBErr } = await userBAnon.rpc(
        "create_board",
        { p_workspace_id: wsBId, p_name: "Board B sweep" },
      );
      expect(boardBErr, "create_board(B sweep)").toBeNull();
      orgBBoardId = (boardBData as { id: string }).id;

      const { data: groupBData } = await userBAnon
        .from("groups")
        .select("id")
        .eq("board_id", orgBBoardId)
        .single();
      orgBGroupId = (groupBData as { id: string }).id;

      // ── orgA: fresh date + status columns (isolated from parent suite cols) ─
      orgAOptWorkingId = randomUUID();
      const [
        { data: colADate, error: colADateErr },
        { data: colAStat, error: colAStatErr },
      ] = await Promise.all([
        admin
          .from("columns")
          .insert({
            org_id: orgAId,
            board_id: boardAId,
            name: "D_sweep",
            kind: "date",
            settings: {},
            position: 20,
          })
          .select("id")
          .single(),
        admin
          .from("columns")
          .insert({
            org_id: orgAId,
            board_id: boardAId,
            name: "S_sweep",
            kind: "status",
            settings: {
              options: [
                { id: orgAOptWorkingId, label: "Working", color: "#00c875" },
              ],
            },
            position: 21,
          })
          .select("id")
          .single(),
      ]);
      expect(colADateErr, "insert date col orgA").toBeNull();
      expect(colAStatErr, "insert status col orgA").toBeNull();
      orgADateColId = (colADate as { id: string }).id;
      orgAStatusColId = (colAStat as { id: string }).id;

      // ── orgB: fresh date + status columns ────────────────────────────────
      orgBOptWorkingId = randomUUID();
      const [
        { data: colBDate, error: colBDateErr },
        { data: colBStat, error: colBStatErr },
      ] = await Promise.all([
        admin
          .from("columns")
          .insert({
            org_id: orgBId,
            board_id: orgBBoardId,
            name: "D",
            kind: "date",
            settings: {},
            position: 10,
          })
          .select("id")
          .single(),
        admin
          .from("columns")
          .insert({
            org_id: orgBId,
            board_id: orgBBoardId,
            name: "S",
            kind: "status",
            settings: {
              options: [
                { id: orgBOptWorkingId, label: "Working", color: "#00c875" },
              ],
            },
            position: 11,
          })
          .select("id")
          .single(),
      ]);
      expect(colBDateErr, "insert date col orgB").toBeNull();
      expect(colBStatErr, "insert status col orgB").toBeNull();
      orgBDateColId = (colBDate as { id: string }).id;
      orgBStatusColId = (colBStat as { id: string }).id;

      // ── orgA: item + date cell (cell date = Tokyo local date at p_now = 2026-07-11) ─
      const { data: itemAData, error: itemAErr } = await userAAnon.rpc(
        "create_item",
        {
          p_group_id: (
            await userAAnon
              .from("groups")
              .select("id")
              .eq("board_id", boardAId)
              .single()
          ).data!.id,
          p_name: "Sweep item A",
        },
      );
      expect(itemAErr, "create item A").toBeNull();
      itemALocalId = (itemAData as { id: string }).id;

      const { error: dateCellAErr } = await userAAnon
        .from("cell_values")
        .upsert(
          {
            org_id: orgAId,
            board_id: boardAId,
            item_id: itemALocalId,
            column_id: orgADateColId,
            value: { date: "2026-07-11" } as never,
          },
          { onConflict: "item_id,column_id" },
        );
      expect(dateCellAErr, "set date cell orgA").toBeNull();

      // ── orgB: item + date cell (cell date = NY local date at p_now = 2026-07-10) ─
      const { data: itemBData, error: itemBErr } = await userBAnon.rpc(
        "create_item",
        { p_group_id: orgBGroupId, p_name: "Sweep item B" },
      );
      expect(itemBErr, "create item B").toBeNull();
      itemBLocalId = (itemBData as { id: string }).id;

      const { error: dateCellBErr } = await userBAnon
        .from("cell_values")
        .upsert(
          {
            org_id: orgBId,
            board_id: orgBBoardId,
            item_id: itemBLocalId,
            column_id: orgBDateColId,
            value: { date: "2026-07-10" } as never,
          },
          { onConflict: "item_id,column_id" },
        );
      expect(dateCellBErr, "set date cell orgB").toBeNull();

      // ── orgA automation: date_reached offset 0 → set_option(Working) ──────
      const { data: autoAData, error: autoAErr } = await admin
        .from("automations")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          trigger: {
            type: "date_reached",
            columnId: orgADateColId,
            offsetDays: 0,
          } as never,
          actions: [
            {
              type: "set_option",
              columnId: orgAStatusColId,
              optionId: orgAOptWorkingId,
            },
          ] as never,
          enabled: true,
          created_by: userAId,
        })
        .select("id")
        .single();
      expect(autoAErr, "insert automation orgA").toBeNull();
      autoAId = (autoAData as { id: string }).id;

      // ── orgB automation: date_reached offset 0 → set_option(Working) ──────
      const { data: autoBData, error: autoBErr } = await admin
        .from("automations")
        .insert({
          org_id: orgBId,
          board_id: orgBBoardId,
          trigger: {
            type: "date_reached",
            columnId: orgBDateColId,
            offsetDays: 0,
          } as never,
          actions: [
            {
              type: "set_option",
              columnId: orgBStatusColId,
              optionId: orgBOptWorkingId,
            },
          ] as never,
          enabled: true,
          created_by: userBId,
        })
        .select("id")
        .single();
      expect(autoBErr, "insert automation orgB").toBeNull();
      autoBId = (autoBData as { id: string }).id;
    }, 60_000);

    afterAll(async () => {
      // orgA sweep artefact cleanup
      await admin.from("automations").delete().eq("id", autoAId);
      await admin
        .from("automation_date_fires")
        .delete()
        .eq("automation_id", autoAId);
      await admin.from("cell_values").delete().eq("item_id", itemALocalId);
      await admin.from("items").delete().eq("id", itemALocalId);
      await admin.from("columns").delete().eq("id", orgADateColId);
      await admin.from("columns").delete().eq("id", orgAStatusColId);

      // orgB sweep artefact cleanup
      await admin.from("automations").delete().eq("id", autoBId);
      await admin
        .from("automation_date_fires")
        .delete()
        .eq("automation_id", autoBId);
      await admin.from("cell_values").delete().eq("item_id", itemBLocalId);
      await admin.from("items").delete().eq("id", itemBLocalId);
      await admin.from("columns").delete().eq("id", orgBDateColId);
      await admin.from("columns").delete().eq("id", orgBStatusColId);
    }, 30_000);

    it("sweep at 2026-07-10T23:00Z fires orgA (Tokyo 08:00) but NOT orgB (NY 19:00)", async () => {
      const { error: sweepErr } = await admin.rpc("_automation_date_sweep", {
        p_now: P_NOW,
      });
      expect(sweepErr, "sweep RPC error").toBeNull();

      // ── orgA item: status cell should be set to Working ───────────────────
      const cellA = await poll(async () => {
        const { data } = await admin
          .from("cell_values")
          .select("value")
          .eq("item_id", itemALocalId)
          .eq("column_id", orgAStatusColId);
        return data && data.length > 0 ? data[0] : null;
      });
      expect(
        cellA,
        "orgA (Tokyo 08:00) status cell should be set after sweep",
      ).not.toBeNull();
      expect((cellA as { value: unknown }).value).toMatchObject({
        optionId: orgAOptWorkingId,
      });

      // ── orgB item: status cell must NOT be set ────────────────────────────
      await new Promise((r) => setTimeout(r, 1_500));

      const { data: cellBRows } = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", itemBLocalId)
        .eq("column_id", orgBStatusColId);

      expect(
        cellBRows ?? [],
        "orgB (NY 19:00 local) status cell must NOT be set — 08:00 gate blocked it",
      ).toHaveLength(0);
    });
  });
});
