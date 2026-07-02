/**
 * Phase 5c-1: run-history cloud integration tests.
 *
 * Covers:
 *  1. status_changed → ran row with notify outcome
 *  2. set_option → 'set' then 'skipped_equal'
 *  3. condition blocked → status='blocked'
 *  4. item_created → ran row
 *  5. prune keeps 50
 *  6. fault isolation: error run does not abort user's cell write
 *  7. RLS: cross-org cannot read runs; client insert attempt blocked
 *
 * Harness mirrors automations.5b2.engine.integration.test.ts exactly —
 * same env wiring, beforeAll shape, helpers.
 */

import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

/**
 * Wait up to `ms` for `fn` to resolve to a truthy/non-empty value.
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

describe.skipIf(!integrationTargetReady())(
  "engine: automations 5c-1 run-history",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    // ── orgA context (userA = actor / org owner) ──────────────────────────────
    let userAId: string;
    let userAAnon: SupabaseClient<Database>;
    let orgAId: string;
    let boardAId: string;
    /** Default group in boardA — items are created here. */
    let groupAId: string;

    // ── Status column S (options: Working, Stuck) ─────────────────────────────
    let colSId: string;
    let optWorkingId: string;
    let optStuckId: string;

    // ── orgB context (for RLS test 7) ─────────────────────────────────────────
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
      const emailA = `rh5c1-a-${randomUUID()}@example.com`;
      const { data: createdA, error: errA } = await admin.auth.admin.createUser(
        {
          email: emailA,
          password: PASSWORD,
          email_confirm: true,
        },
      );
      expect(errA, "createUser(A)").toBeNull();
      userAId = createdA.user!.id;
      createdUserIds.push(userAId);

      userAAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInOrThrow(
        userAAnon,
        { email: emailA, password: PASSWORD },
        emailA,
      );

      // ── org + workspace + board ──────────────────────────────────────────
      const { data: orgData } = await userAAnon.rpc("create_organization", {
        p_name: "RunHist5c1 Org A",
        p_slug: `rh5c1-a-${randomUUID().slice(0, 8)}`,
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

      // ── Status column S — Working / Stuck ─────────────────────────────────
      const sOptions = [
        { id: randomUUID(), label: "Working", color: "#00c875" },
        { id: randomUUID(), label: "Stuck", color: "#e2445c" },
      ];
      optWorkingId = sOptions[0].id;
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

      // ── create userB in a separate org (for RLS test) ────────────────────
      const emailB = `rh5c1-b-${randomUUID()}@example.com`;
      const { data: createdB, error: errB } = await admin.auth.admin.createUser(
        {
          email: emailB,
          password: PASSWORD,
          email_confirm: true,
        },
      );
      expect(errB, "createUser(B)").toBeNull();
      userBId = createdB.user!.id;
      createdUserIds.push(userBId);

      userBAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInOrThrow(
        userBAnon,
        { email: emailB, password: PASSWORD },
        emailB,
      );

      // userB must have an org (so they have an auth session), but NOT orgA
      await userBAnon.rpc("create_organization", {
        p_name: "RunHist5c1 Org B",
        p_slug: `rh5c1-b-${randomUUID().slice(0, 8)}`,
      });
    }, 90_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** Insert an automation via service-role. */
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

    /** Upsert a cell value as userA. */
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

    /** Create a fresh item in boardA as userA and return its id. */
    async function createFreshItem(): Promise<string> {
      const { data, error } = await userAAnon.rpc("create_item", {
        p_group_id: groupAId,
        p_name: `Test item ${randomUUID().slice(0, 8)}`,
      });
      expect(error, "createFreshItem").toBeNull();
      return (data as { id: string }).id;
    }

    /** Fetch all automation_runs for a given automationId, newest first. */
    async function runsFor(automationId: string) {
      const { data } = await admin
        .from("automation_runs")
        .select("*")
        .eq("automation_id", automationId)
        .order("created_at", { ascending: false });
      return data ?? [];
    }

    // =========================================================================
    // 1. status_changed → ran row with notify outcome
    // =========================================================================
    it("status_changed → ran row with notify outcome", async () => {
      const itemId = await createFreshItem();

      // Build a status_changed → notify(member=userB) rule.
      // userA is the actor, userB is the recipient (≠ actor → outcome='sent').
      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: null,
        },
        actions: [
          { type: "notify", recipient: { kind: "member", userId: userBId } },
        ],
      });

      // Fire: change the status cell
      const writeErr = await setCell(itemId, colSId, {
        optionId: optWorkingId,
      });
      expect(writeErr, "set S=Working").toBeNull();

      // Poll until the run row appears
      const runs = await poll(async () => {
        const rows = await runsFor(automationId);
        return rows.length > 0 ? rows : null;
      });

      expect(runs, "run row should appear").not.toBeNull();
      expect(runs!.length, "exactly 1 run row").toBe(1);

      const run = runs![0] as unknown as {
        trigger_type: string;
        status: string;
        actions: { type: string; outcome: string }[];
      };
      expect(run.trigger_type, "trigger_type").toBe("status_changed");
      expect(run.status, "status").toBe("ran");
      expect(Array.isArray(run.actions), "actions is array").toBe(true);
      expect(run.actions.length, "1 action entry").toBe(1);
      expect(run.actions[0].type, "action type").toBe("notify");
      // outcome is 'sent' (userB ≠ actor userA, no prior notification)
      expect(run.actions[0].outcome, "notify outcome").toBe("sent");

      // Cleanup
      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_runs")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("notifications").delete().eq("item_id", itemId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    }, 30_000);

    // =========================================================================
    // 2. set_option → 'set' then 'skipped_equal'
    // =========================================================================
    it("set_option → first fire='set', second fire='skipped_equal'", async () => {
      // Need a second status column (P) to serve as set_option target so we
      // can keep firing the trigger column (S) independently.
      const pOptions = [
        { id: randomUUID(), label: "High", color: "#e2445c" },
        { id: randomUUID(), label: "Low", color: "#9aadbd" },
      ];
      const optHighId = pOptions[0].id;

      const { data: colP, error: colPErr } = await admin
        .from("columns")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          name: "P_t2",
          kind: "status",
          settings: { options: pOptions },
          position: 20,
        })
        .select("id")
        .single();
      expect(colPErr, "insert col P for test 2").toBeNull();
      const colPId = (colP as { id: string }).id;

      const itemId = await createFreshItem();

      // Rule: status_changed(S, any) → set_option(P=High)
      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: null,
        },
        actions: [
          { type: "set_option", columnId: colPId, optionId: optHighId },
        ],
      });

      // First fire: set S=Working — P goes from unset → High (outcome='set')
      const err1 = await setCell(itemId, colSId, { optionId: optWorkingId });
      expect(err1, "first S write").toBeNull();

      const runs1 = await poll(async () => {
        const rows = await runsFor(automationId);
        return rows.length >= 1 ? rows : null;
      });
      expect(runs1, "first run row").not.toBeNull();
      const firstRun = runs1![0] as unknown as {
        actions: { type: string; outcome: string }[];
      };
      expect(firstRun.actions[0].outcome, "first fire outcome").toBe("set");

      // Second fire: change S to Stuck — engine tries to set P=High again,
      // but P already equals High → outcome='skipped_equal'
      const err2 = await setCell(itemId, colSId, { optionId: optStuckId });
      expect(err2, "second S write").toBeNull();

      const runs2 = await poll(async () => {
        const rows = await runsFor(automationId);
        return rows.length >= 2 ? rows : null;
      });
      expect(runs2, "second run row").not.toBeNull();
      // runs are ordered newest first, so runs2[0] is the second fire
      const secondRun = runs2![0] as unknown as {
        actions: { type: string; outcome: string }[];
      };
      expect(secondRun.actions[0].outcome, "second fire outcome").toBe(
        "skipped_equal",
      );

      // Cleanup
      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_runs")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
      await admin.from("columns").delete().eq("id", colPId);
    }, 30_000);

    // =========================================================================
    // 2b. set_option → DROPDOWN target writes the {optionIds:[...]} shape
    //     (regression: the 5a engine wrote the singular {optionId} shape, which
    //     DropdownCell can't render → blank cell despite the run logging 'set').
    // =========================================================================
    it("set_option → dropdown target writes {optionIds:[...]} (not {optionId})", async () => {
      const dOptions = [
        { id: randomUUID(), label: "Option 1", color: "#579bfc" },
        { id: randomUUID(), label: "Option 2", color: "#a25ddc" },
      ];
      const optD1Id = dOptions[0].id;

      const { data: colD, error: colDErr } = await admin
        .from("columns")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          name: "D_t2b",
          kind: "dropdown",
          settings: { options: dOptions },
          position: 30,
        })
        .select("id")
        .single();
      expect(colDErr, "insert dropdown col D").toBeNull();
      const colDId = (colD as { id: string }).id;

      const itemId = await createFreshItem();

      // Rule: status_changed(S, any) → set_option(D = Option 1)
      const automationId = await insertAutomation({
        trigger: { type: "status_changed", columnId: colSId, toOptionId: null },
        actions: [{ type: "set_option", columnId: colDId, optionId: optD1Id }],
      });

      const writeErr = await setCell(itemId, colSId, {
        optionId: optWorkingId,
      });
      expect(writeErr, "set S=Working").toBeNull();

      const runs = await poll(async () => {
        const rows = await runsFor(automationId);
        return rows.length >= 1 ? rows : null;
      });
      expect(runs, "run row").not.toBeNull();
      const run = runs![0] as unknown as {
        actions: { type: string; outcome: string }[];
      };
      expect(run.actions[0].outcome, "outcome").toBe("set");

      // The written value MUST be the dropdown shape so DropdownCell (which reads
      // value.optionIds) renders it — the crux of the bug.
      const { data: cell } = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", itemId)
        .eq("column_id", colDId)
        .single();
      expect(cell!.value, "dropdown cell shape").toEqual({
        optionIds: [optD1Id],
      });

      // Cleanup
      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_runs")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
      await admin.from("columns").delete().eq("id", colDId);
    }, 30_000);

    // =========================================================================
    // 3. condition blocked → status='blocked'
    // =========================================================================
    it("condition blocked → run row with status='blocked' and empty actions", async () => {
      const itemId = await createFreshItem();

      // Rule: status_changed(S, any) with condition "S is Stuck" → notify
      // We fire with S=Working, so the condition (S=Stuck) fails → blocked.
      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: null,
        },
        actions: [
          { type: "notify", recipient: { kind: "member", userId: userBId } },
        ],
        condition: {
          combinator: "and",
          conditions: [{ columnId: colSId, operator: "is", value: optStuckId }],
        },
      });

      // Fire: set S=Working. The trigger matches (any status change), but the
      // condition (S=Stuck) is evaluated AFTER the new value is written.
      // Since we set S=Working (not Stuck), condition fails → blocked.
      const writeErr = await setCell(itemId, colSId, {
        optionId: optWorkingId,
      });
      expect(writeErr, "set S=Working (blocked test)").toBeNull();

      const runs = await poll(async () => {
        const rows = await runsFor(automationId);
        return rows.length > 0 ? rows : null;
      });

      expect(runs, "run row should appear for blocked").not.toBeNull();
      expect(runs!.length, "exactly 1 run row").toBe(1);

      const run = runs![0] as {
        status: string;
        actions: unknown[];
      };
      expect(run.status, "status='blocked'").toBe("blocked");
      expect(run.actions, "actions empty for blocked").toEqual([]);

      // Cleanup
      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_runs")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    }, 30_000);

    // =========================================================================
    // 4. item_created → ran row
    // =========================================================================
    it("item_created → ran row with trigger_type='item_created'", async () => {
      // Need a second status column to be the set_option target (so we don't
      // re-use S which is also used as trigger column in other tests)
      const qOptions = [{ id: randomUUID(), label: "Done", color: "#579bfc" }];
      const optDoneId = qOptions[0].id;

      const { data: colQ, error: colQErr } = await admin
        .from("columns")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          name: "Q_t4",
          kind: "status",
          settings: { options: qOptions },
          position: 21,
        })
        .select("id")
        .single();
      expect(colQErr, "insert col Q for test 4").toBeNull();
      const colQId = (colQ as { id: string }).id;

      const automationId = await insertAutomation({
        trigger: { type: "item_created" },
        actions: [
          { type: "set_option", columnId: colQId, optionId: optDoneId },
        ],
      });

      // Create a fresh item — this fires the item_created trigger
      const itemId = await createFreshItem();

      const runs = await poll(async () => {
        const rows = await runsFor(automationId);
        return rows.length > 0 ? rows : null;
      });

      expect(runs, "run row for item_created").not.toBeNull();
      const run = runs![0] as {
        trigger_type: string;
        status: string;
      };
      expect(run.trigger_type, "trigger_type='item_created'").toBe(
        "item_created",
      );
      expect(run.status, "status='ran'").toBe("ran");

      // Cleanup
      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_runs")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
      await admin.from("columns").delete().eq("id", colQId);
    }, 30_000);

    // =========================================================================
    // 5. prune keeps 50
    // =========================================================================
    it("prune keeps newest 50 rows per automation", async () => {
      const itemId = await createFreshItem();

      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: null,
        },
        actions: [],
      });

      // Insert 55 rows directly via admin with explicit created_at timestamps.
      // Row i=0 is the newest; row i=54 is the oldest.
      // We want the prune to keep the 50 newest (i=0..49) and drop i=50..54.
      const now = Date.now();
      const insertRows = Array.from({ length: 55 }, (_, i) => ({
        automation_id: automationId,
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemId,
        trigger_type: "status_changed",
        status: "ran",
        actions: [] as never,
        created_at: new Date(now - i * 1000).toISOString(),
      }));

      const { error: insertErr } = await admin
        .from("automation_runs")
        .insert(insertRows as never);
      expect(insertErr, "bulk insert 55 rows").toBeNull();

      // Verify we have 55 before pruning
      const { data: before } = await admin
        .from("automation_runs")
        .select("id")
        .eq("automation_id", automationId);
      expect((before ?? []).length, "55 rows before prune").toBe(55);

      // Call the prune RPC
      const { error: pruneErr } = await admin.rpc("_automation_runs_prune");
      expect(pruneErr, "prune RPC error").toBeNull();

      // Assert exactly 50 remain
      const { data: after } = await admin
        .from("automation_runs")
        .select("id, created_at")
        .eq("automation_id", automationId)
        .order("created_at", { ascending: false });
      expect((after ?? []).length, "50 rows after prune").toBe(50);

      // Verify they are the newest 50 (the oldest 5 were dropped)
      // Newest should be close to `now`, oldest of the remaining 50 should
      // be 49 seconds before now (i=49), not 50 seconds (i=50).
      const oldestRemaining = new Date(
        (after as { created_at: string }[])[49].created_at,
      ).getTime();
      const expectedOldest = now - 49 * 1000;
      // Allow 2s tolerance for insert timing
      expect(
        Math.abs(oldestRemaining - expectedOldest),
        "oldest remaining row is ~49s old (i=49 not i=50)",
      ).toBeLessThan(2000);

      // Cleanup
      await admin.from("automations").delete().eq("id", automationId);
      // automation_runs cascade-delete when automation is deleted
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    }, 30_000);

    // =========================================================================
    // 6. fault isolation: error run does not abort the user's cell write
    // =========================================================================
    it("fault isolation: error run written but user's triggering cell write succeeds", async () => {
      const itemId = await createFreshItem();

      // Use a random UUID as the target columnId for set_option — this will
      // cause a FK violation when the engine tries to insert the cell value,
      // triggering the exception handler → status='error' run.
      const bogusColumnId = randomUUID();

      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: null,
        },
        actions: [
          {
            type: "set_option",
            columnId: bogusColumnId,
            optionId: randomUUID(),
          },
        ],
      });

      // Fire: change the trigger column. This is the user's edit.
      const writeErr = await setCell(itemId, colSId, {
        optionId: optWorkingId,
      });
      // (a) The user's write must NOT error
      expect(
        writeErr,
        "user's cell write must succeed despite engine error",
      ).toBeNull();

      // Poll for the error run
      const runs = await poll(async () => {
        const rows = await runsFor(automationId);
        return rows.length > 0 ? rows : null;
      });

      expect(runs, "error run row should appear").not.toBeNull();
      const run = runs![0] as {
        status: string;
        error: string | null;
      };
      // (a) run has status='error' with a non-null error message
      expect(run.status, "run status='error'").toBe("error");
      expect(run.error, "run.error is non-null").not.toBeNull();

      // (b) Verify the trigger cell was actually written (user's edit succeeded)
      const { data: cellRows } = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", itemId)
        .eq("column_id", colSId);
      expect(cellRows, "trigger cell row exists").not.toBeNull();
      expect((cellRows ?? []).length, "exactly 1 trigger cell row").toBe(1);
      expect(
        (cellRows as { value: { optionId: string } }[])[0].value,
        "trigger cell has new value",
      ).toMatchObject({ optionId: optWorkingId });

      // Cleanup
      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_runs")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    }, 30_000);

    // =========================================================================
    // 7. RLS: cross-org cannot read runs; client insert attempt blocked
    // =========================================================================
    it("RLS: orgB user cannot read orgA runs (0 rows); client insert blocked", async () => {
      const itemId = await createFreshItem();

      // Seed one automation and one run row in orgA via admin
      const automationId = await insertAutomation({
        trigger: {
          type: "status_changed",
          columnId: colSId,
          toOptionId: null,
        },
        actions: [],
      });

      const writeErr = await setCell(itemId, colSId, {
        optionId: optWorkingId,
      });
      expect(writeErr, "seed trigger write").toBeNull();

      // Wait for the run row to appear via admin
      const adminRuns = await poll(async () => {
        const rows = await runsFor(automationId);
        return rows.length > 0 ? rows : null;
      });
      expect(adminRuns, "admin can see the run row").not.toBeNull();
      const runId = (adminRuns![0] as { id: string }).id;

      // ── (A) orgB user cannot SELECT orgA's runs ───────────────────────────
      const { data: bReads, error: bReadErr } = await userBAnon
        .from("automation_runs")
        .select("*")
        .eq("automation_id", automationId);
      expect(
        bReadErr,
        "cross-org read should not error (RLS hides)",
      ).toBeNull();
      expect(
        bReads ?? [],
        "orgB user sees 0 rows from orgA automation_runs",
      ).toHaveLength(0);

      // ── (B) orgA member (userA) cannot INSERT into automation_runs ─────────
      // The RLS policy has no write rule, so even a member of orgA cannot write.
      const countBefore = (adminRuns ?? []).length;

      await userAAnon.from("automation_runs").insert({
        automation_id: automationId,
        org_id: orgAId,
        board_id: boardAId,
        item_id: itemId,
        trigger_type: "status_changed",
        status: "ran",
      } as never);

      // Count via admin — must be unchanged
      const { data: afterRows } = await admin
        .from("automation_runs")
        .select("id")
        .eq("automation_id", automationId);
      expect(
        (afterRows ?? []).length,
        "row count unchanged after blocked client insert",
      ).toBe(countBefore);

      // Cleanup
      await admin.from("automations").delete().eq("id", automationId);
      // automation_runs will cascade-delete
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);

      // Suppress unused-variable warning for runId (we used it for traceability)
      void runId;
    }, 30_000);
  },
);
