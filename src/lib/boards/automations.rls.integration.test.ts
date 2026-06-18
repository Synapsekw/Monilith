import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    await userAAnon.auth.signInWithPassword({
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
    await userBAnon.auth.signInWithPassword({
      email: emailB,
      password: PASSWORD,
    });

    // userB must belong to an org (so they have an auth session), but NOT orgA
    const { data: orgBData } = await userBAnon.rpc("create_organization", {
      p_name: "Org B (auto)",
      p_slug: `auto-b-${randomUUID().slice(0, 8)}`,
    });
    // we don't need orgB's id for most tests, but keep it for completeness
    void (orgBData as { id: string }).id;
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
  // 7. Cross-org RLS on automations table
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
});
