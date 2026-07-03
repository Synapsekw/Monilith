/**
 * Status intelligence (descoped): percent-sync integration tests.
 *
 * Pins the behavioral contract of 20260703091000_automations_percent_sync.sql:
 *  - "Completed sets 100%": status → Done ⇒ percent cell becomes {percent:100}
 *  - "100% sets Completed": percent crossing the threshold ⇒ status → Done
 *  - Loop guard: with BOTH recipes enabled, one status→Done write settles
 *    (percent 100 + status Done) and the run ledger shows a skipped_equal hop
 *    — no depth exhaustion, no error runs.
 *  - Crossing semantics: a percent write that stays at/above the threshold
 *    (old value already ≥ threshold) does NOT re-fire percent_reached.
 *
 * Mirror of automations.engine.5b1.integration.test.ts — same
 * authenticated-Supabase-client setup/teardown and fixture helpers.
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

/** Wait up to `maxMs` for `fn` to resolve to a non-nullish value. */
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

describe.skipIf(!integrationTargetReady())("engine: percent sync", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  let userAId: string;
  let userAAnon: SupabaseClient<Database>;
  let orgAId: string;
  let boardAId: string;
  let groupAId: string;

  // Status column S (options: Working, Done)
  let colSId: string;
  let optWorkingId: string;
  let optDoneId: string;

  // Percent column %
  let colPctId: string;

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const emailA = `pctsync-a-${randomUUID()}@example.com`;
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
    await signInOrThrow(
      userAAnon,
      { email: emailA, password: PASSWORD },
      emailA,
    );

    const { data: orgData } = await userAAnon.rpc("create_organization", {
      p_name: "PctSync Org A",
      p_slug: `pctsync-a-${randomUUID().slice(0, 8)}`,
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

    // Status column S — Working / Done
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

    // Percent column
    const { data: colPct, error: colPctErr } = await admin
      .from("columns")
      .insert({
        org_id: orgAId,
        board_id: boardAId,
        name: "Progress",
        kind: "percent",
        settings: {},
        position: 11,
      })
      .select("id")
      .single();
    expect(colPctErr, "insert col Progress").toBeNull();
    colPctId = (colPct as { id: string }).id;
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // ── Helpers ───────────────────────────────────────────────────────────────

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
        condition: null as never,
        enabled: opts.enabled ?? true,
        created_by: userAId,
      })
      .select("id")
      .single();
    expect(error, "insertAutomation").toBeNull();
    return (data as { id: string }).id;
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

  async function createFreshItem(): Promise<string> {
    const { data, error } = await userAAnon.rpc("create_item", {
      p_group_id: groupAId,
      p_name: `Pct item ${randomUUID().slice(0, 8)}`,
    });
    expect(error, "createFreshItem").toBeNull();
    return (data as { id: string }).id;
  }

  async function cellValue(
    itemId: string,
    columnId: string,
  ): Promise<unknown | null> {
    const { data } = await admin
      .from("cell_values")
      .select("value")
      .eq("item_id", itemId)
      .eq("column_id", columnId)
      .maybeSingle();
    return (data as { value: unknown } | null)?.value ?? null;
  }

  async function cleanup(itemId: string, ...automationIds: string[]) {
    for (const id of automationIds)
      await admin.from("automations").delete().eq("id", id);
    await admin.from("cell_values").delete().eq("item_id", itemId);
    await admin.from("items").delete().eq("id", itemId);
  }

  // =========================================================================
  // 1. "Completed sets 100%": status → Done ⇒ percent becomes {percent:100}
  // =========================================================================
  it("status → Done sets the percent cell to 100 (set_percent action)", async () => {
    const itemId = await createFreshItem();
    const ruleId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optDoneId,
      },
      actions: [{ type: "set_percent", columnId: colPctId, percent: 100 }],
    });

    const writeErr = await setCell(itemId, colSId, { optionId: optDoneId });
    expect(writeErr, "set S=Done").toBeNull();

    const pct = await poll(async () => cellValue(itemId, colPctId));
    expect(pct, "percent cell after S=Done").toMatchObject({ percent: 100 });

    await cleanup(itemId, ruleId);
  });

  // =========================================================================
  // 2. "100% sets Completed": percent 40 → 100 ⇒ status becomes Done
  // =========================================================================
  it("percent crossing to 100 sets the status cell to Done (percent_reached)", async () => {
    const itemId = await createFreshItem();
    const ruleId = await insertAutomation({
      trigger: { type: "percent_reached", columnId: colPctId, percent: 100 },
      actions: [{ type: "set_option", columnId: colSId, optionId: optDoneId }],
    });

    // Below the threshold: must NOT fire.
    const err40 = await setCell(itemId, colPctId, { percent: 40 });
    expect(err40, "set percent=40").toBeNull();
    await new Promise((r) => setTimeout(r, 1_000));
    expect(
      await cellValue(itemId, colSId),
      "status untouched below threshold",
    ).toBeNull();

    // Crossing 40 → 100: fires.
    const err100 = await setCell(itemId, colPctId, { percent: 100 });
    expect(err100, "set percent=100").toBeNull();

    const status = await poll(async () => cellValue(itemId, colSId));
    expect(status, "status cell after percent=100").toMatchObject({
      optionId: optDoneId,
    });

    await cleanup(itemId, ruleId);
  });

  // =========================================================================
  // 3. Loop guard: BOTH recipes enabled — one status→Done write settles with
  //    a skipped_equal hop in the run ledger, no depth exhaustion, no errors.
  // =========================================================================
  it("both recipes settle at depth 2 via skipped_equal (no loop)", async () => {
    const itemId = await createFreshItem();
    const completedSetsPercentId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: colSId,
        toOptionId: optDoneId,
      },
      actions: [{ type: "set_percent", columnId: colPctId, percent: 100 }],
    });
    const percentSetsCompletedId = await insertAutomation({
      trigger: { type: "percent_reached", columnId: colPctId, percent: 100 },
      actions: [{ type: "set_option", columnId: colSId, optionId: optDoneId }],
    });

    const writeErr = await setCell(itemId, colSId, { optionId: optDoneId });
    expect(writeErr, "set S=Done (both rules)").toBeNull();

    // Settled end state: percent 100 AND status Done.
    const pct = await poll(async () => cellValue(itemId, colPctId));
    expect(pct, "percent settled at 100").toMatchObject({ percent: 100 });
    expect(
      await cellValue(itemId, colSId),
      "status still Done after settling",
    ).toMatchObject({ optionId: optDoneId });

    await new Promise((r) => setTimeout(r, 1_500));

    // The chain: rule1 ran (set_percent 'set') → rule2 ran (set_option
    // 'skipped_equal') → END. Exactly one run per rule, zero error runs.
    const { data: runs } = await admin
      .from("automation_runs")
      .select("automation_id, status, actions")
      .eq("item_id", itemId);
    const runRows = (runs ?? []) as {
      automation_id: string;
      status: string;
      actions: unknown;
    }[];

    expect(
      runRows.filter((r) => r.status === "error"),
      "no error runs",
    ).toHaveLength(0);

    const rule1Runs = runRows.filter(
      (r) => r.automation_id === completedSetsPercentId,
    );
    const rule2Runs = runRows.filter(
      (r) => r.automation_id === percentSetsCompletedId,
    );
    expect(rule1Runs, "completed→100% ran exactly once").toHaveLength(1);
    expect(rule2Runs, "100%→completed ran exactly once").toHaveLength(1);
    expect(rule1Runs[0].actions, "set_percent wrote the cell").toContainEqual({
      type: "set_percent",
      outcome: "set",
    });
    expect(
      rule2Runs[0].actions,
      "loop terminated via skipped_equal",
    ).toContainEqual({ type: "set_option", outcome: "skipped_equal" });

    await cleanup(itemId, completedSetsPercentId, percentSetsCompletedId);
  });

  // =========================================================================
  // 4. Crossing semantics: a write that stays at/above the threshold does
  //    not re-fire percent_reached (old value already ≥ threshold).
  // =========================================================================
  it("does not re-fire on a non-crossing percent write (60 → 70 over a 50 threshold)", async () => {
    const itemId = await createFreshItem();
    const ruleId = await insertAutomation({
      trigger: { type: "percent_reached", columnId: colPctId, percent: 50 },
      actions: [{ type: "set_option", columnId: colSId, optionId: optDoneId }],
    });

    // 0 → 60 crosses the 50 threshold: fires once.
    const err60 = await setCell(itemId, colPctId, { percent: 60 });
    expect(err60, "set percent=60").toBeNull();
    await poll(async () => cellValue(itemId, colSId));

    const runsAfterCross = async () => {
      const { data } = await admin
        .from("automation_runs")
        .select("id")
        .eq("automation_id", ruleId)
        .eq("item_id", itemId);
      return (data ?? []).length;
    };
    expect(await runsAfterCross(), "fired once on crossing").toBe(1);

    // 60 → 70 stays above the threshold: crossing arm is false → no new run.
    const err70 = await setCell(itemId, colPctId, { percent: 70 });
    expect(err70, "set percent=70").toBeNull();
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await runsAfterCross(), "no re-fire on non-crossing write").toBe(1);

    await cleanup(itemId, ruleId);
  });
});
