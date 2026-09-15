/**
 * Board Intelligence "Act": `assign_person` engine action integration tests.
 *
 * Pins the behavioral contract of
 * 20260915062952_automation_assign_person_action.sql — the one new branch
 * added to `public._automation_run` (copied verbatim from
 * 20260704111500_automation_run_recipient_and_target_guards.sql). `set_option`
 * / `set_percent` already confine their target column to the firing board;
 * `assign_person` additionally requires `kind = 'people'` and that the
 * assignee is a member of the firing org — this suite is the trip-wire for
 * both guards:
 *
 *  - "set": target is a people column on this board, assignee is an org
 *    member ⇒ the cell becomes { userIds: [userId] } (replace, not append).
 *  - "skipped_equal": the cell already holds that exact value ⇒ no rewrite.
 *  - "skipped_bad_target": target column is on ANOTHER board, or is on this
 *    board but not kind 'people' ⇒ no write, cell stays untouched.
 *  - "skipped_not_member": assignee uuid does not belong to the firing org
 *    ⇒ no write, cell stays untouched.
 *
 * Mirror of automations.percent-sync.integration.test.ts / automations.rls.
 * integration.test.ts — same authenticated-Supabase-client setup/teardown and
 * fixture helpers (skip-unless-PULSE_TEST_DB pattern per
 * board-intelligence-runs.rls.integration.test.ts).
 */

import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
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

describe.skipIf(!integrationTargetReady())("engine: assign_person", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  // orgA context — the firing org/board.
  let userAId: string;
  let userAAnon: SupabaseClient<Database>;
  let orgAId: string;
  let boardAId: string;
  let groupAId: string;

  // Status column S (options: Working, Done) — the trigger source.
  let statusColId: string;
  let optDoneId: string;

  // People column on board A — the valid assign_person target.
  let peopleColId: string;

  // A second board in orgA with its own people column — "another board".
  let boardA2Id: string;
  let otherBoardPeopleColId: string;

  // memberB — a second user, member of orgA: the valid assignee.
  let memberBId: string;

  // outsider — a user who belongs to a DIFFERENT org, not orgA.
  let outsiderId: string;
  let outsiderOrgId: string;

  // Workspace id, needed again in afterAll for reverse-dependency teardown.
  let wsAId: string;

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── userA (owner of orgA) ────────────────────────────────────────────
    const emailA = `assignperson-a-${randomUUID()}@example.com`;
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
    const signInA = await signInWithRetry(userAAnon, {
      email: emailA,
      password: PASSWORD,
    });
    expect(signInA.error, "signIn(A)").toBeNull();

    const { data: orgData, error: orgErr } = await userAAnon.rpc(
      "create_organization",
      {
        p_name: "AssignPerson Org A",
        p_slug: `assignperson-a-${randomUUID().slice(0, 8)}`,
      },
    );
    expect(orgErr, "create_organization(A)").toBeNull();
    orgAId = (orgData as { id: string }).id;

    const { data: wsData, error: wsErr } = await userAAnon
      .from("workspaces")
      .insert({ org_id: orgAId, name: "WS A", created_by: userAId })
      .select("id")
      .single();
    expect(wsErr, "insert workspace(A)").toBeNull();
    wsAId = (wsData as { id: string }).id;

    const { data: boardData, error: boardErr } = await userAAnon.rpc(
      "create_board",
      { p_workspace_id: wsAId, p_name: "Board A" },
    );
    expect(boardErr, "create_board(A)").toBeNull();
    boardAId = (boardData as { id: string }).id;

    const { data: groupData, error: groupErr } = await userAAnon
      .from("groups")
      .select("id")
      .eq("board_id", boardAId)
      .single();
    expect(groupErr, "select group(A)").toBeNull();
    groupAId = (groupData as { id: string }).id;

    // ── Status column S — Working / Done (the trigger source) ────────────
    const sOptions = [
      { id: randomUUID(), label: "Working", color: "#00c875" },
      { id: randomUUID(), label: "Done", color: "#579bfc" },
    ];
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
    statusColId = (colS as { id: string }).id;

    // ── People column on board A — the valid target ───────────────────────
    const { data: colO, error: colOErr } = await admin
      .from("columns")
      .insert({
        org_id: orgAId,
        board_id: boardAId,
        name: "Assignee",
        kind: "people",
        settings: {},
        position: 11,
      })
      .select("id")
      .single();
    expect(colOErr, "insert col Assignee").toBeNull();
    peopleColId = (colO as { id: string }).id;

    // ── A second board in orgA with its own people column ────────────────
    const { data: board2Data, error: board2Err } = await userAAnon.rpc(
      "create_board",
      { p_workspace_id: wsAId, p_name: "Board A2" },
    );
    expect(board2Err, "create_board(A2)").toBeNull();
    boardA2Id = (board2Data as { id: string }).id;

    const { data: colO2, error: colO2Err } = await admin
      .from("columns")
      .insert({
        org_id: orgAId,
        board_id: boardA2Id,
        name: "Assignee 2",
        kind: "people",
        settings: {},
        position: 10,
      })
      .select("id")
      .single();
    expect(colO2Err, "insert col Assignee 2").toBeNull();
    otherBoardPeopleColId = (colO2 as { id: string }).id;

    // ── memberB — a second user, member of orgA ───────────────────────────
    const emailB = `assignperson-b-${randomUUID()}@example.com`;
    const { data: createdB, error: errB } = await admin.auth.admin.createUser({
      email: emailB,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(errB, "createUser(B)").toBeNull();
    memberBId = createdB.user!.id;
    createdUserIds.push(memberBId);

    const { error: addBErr } = await admin.from("org_members").insert({
      org_id: orgAId,
      user_id: memberBId,
      role: "member",
    });
    expect(addBErr, "add memberB to orgA").toBeNull();

    // ── outsider — belongs to a different org, not orgA ───────────────────
    const emailC = `assignperson-outsider-${randomUUID()}@example.com`;
    const { data: createdC, error: errC } = await admin.auth.admin.createUser({
      email: emailC,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(errC, "createUser(outsider)").toBeNull();
    outsiderId = createdC.user!.id;
    createdUserIds.push(outsiderId);

    const outsiderAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signInC = await signInWithRetry(outsiderAnon, {
      email: emailC,
      password: PASSWORD,
    });
    expect(signInC.error, "signIn(outsider)").toBeNull();
    // outsider must belong to SOME org (so they have a valid auth session /
    // uuid resolvable elsewhere), but NOT orgA.
    const { data: orgCData, error: orgCErr } = await outsiderAnon.rpc(
      "create_organization",
      {
        p_name: "AssignPerson Org C",
        p_slug: `assignperson-c-${randomUUID().slice(0, 8)}`,
      },
    );
    expect(orgCErr, "create_organization(outsider)").toBeNull();
    outsiderOrgId = (orgCData as { id: string }).id;
  }, 90_000);

  /**
   * Reverse-dependency teardown, asserted at every step.
   *
   * `organizations.created_by references auth.users(id)` has NO
   * `on delete cascade` (supabase/migrations/20260614174043_init_auth_tenancy.sql:30)
   * — deleting a user while an organization they created still exists fails
   * with `organizations_created_by_fkey`. Every other org-scoped table here
   * (org_members, workspaces, boards, groups, columns, items, cell_values,
   * automations) DOES cascade off `organizations`, but this teardown deletes
   * them explicitly and in reverse-dependency order anyway — belt-and-braces
   * against relying on cascade behaviour holding forever — with each result
   * asserted so a failure is loud, not a silent orphan (the defect this fixes:
   * the prior version deleted only the auth users, with no error check, and
   * never deleted the orgs/boards/etc. those users owned).
   */
  afterAll(async () => {
    const { error: cellErr } = await admin
      .from("cell_values")
      .delete()
      .in("board_id", [boardAId, boardA2Id]);
    expect(cellErr, "cleanup: cell_values").toBeNull();

    const { error: itemsErr } = await admin
      .from("items")
      .delete()
      .in("board_id", [boardAId, boardA2Id]);
    expect(itemsErr, "cleanup: items").toBeNull();

    const { error: autoErr } = await admin
      .from("automations")
      .delete()
      .eq("org_id", orgAId);
    expect(autoErr, "cleanup: automations").toBeNull();

    const { error: colErr } = await admin
      .from("columns")
      .delete()
      .in("board_id", [boardAId, boardA2Id]);
    expect(colErr, "cleanup: columns").toBeNull();

    const { error: groupsErr } = await admin
      .from("groups")
      .delete()
      .in("board_id", [boardAId, boardA2Id]);
    expect(groupsErr, "cleanup: groups").toBeNull();

    const { error: boardsErr } = await admin
      .from("boards")
      .delete()
      .in("id", [boardAId, boardA2Id]);
    expect(boardsErr, "cleanup: boards").toBeNull();

    const { error: wsErr } = await admin
      .from("workspaces")
      .delete()
      .eq("id", wsAId);
    expect(wsErr, "cleanup: workspaces").toBeNull();

    const { error: membersErr } = await admin
      .from("org_members")
      .delete()
      .eq("org_id", orgAId);
    expect(membersErr, "cleanup: org_members").toBeNull();

    const { error: orgsErr } = await admin
      .from("organizations")
      .delete()
      .in("id", [orgAId, outsiderOrgId]);
    expect(orgsErr, "cleanup: organizations").toBeNull();

    for (const id of createdUserIds) {
      const { error: userErr } = await admin.auth.admin.deleteUser(id);
      expect(userErr, `cleanup: deleteUser(${id})`).toBeNull();
    }
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
      p_name: `AssignPerson item ${randomUUID().slice(0, 8)}`,
    });
    expect(error, "createFreshItem").toBeNull();
    return (data as { id: string }).id;
  }

  async function readCell(
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

  /**
   * Fires a fresh item's status → Done, with an automation whose sole action
   * is `assign_person` against the given target. Returns the settled run's
   * `actions` ledger plus the item id (so the caller can also inspect the
   * cell state).
   */
  async function fireAssignPerson(action: {
    columnId: string;
    userId: string;
  }): Promise<{ itemId: string; ruleId: string; actions: unknown }> {
    const itemId = await createFreshItem();
    const ruleId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: statusColId,
        toOptionId: optDoneId,
      },
      actions: [
        {
          type: "assign_person",
          columnId: action.columnId,
          userId: action.userId,
        },
      ],
    });

    const writeErr = await setCell(itemId, statusColId, {
      optionId: optDoneId,
    });
    expect(writeErr, "set S=Done").toBeNull();

    const run = await poll(async () => {
      const { data } = await admin
        .from("automation_runs")
        .select("actions")
        .eq("automation_id", ruleId)
        .eq("item_id", itemId)
        .maybeSingle();
      const actions = (data as { actions: unknown } | null)?.actions;
      return Array.isArray(actions) && actions.length > 0 ? actions : null;
    });

    return { itemId, ruleId, actions: run ?? [] };
  }

  // =========================================================================
  // Outcome: "set" — valid people column on this board + valid org member.
  // =========================================================================
  it("replaces the people cell with the named member", async () => {
    const { itemId, ruleId, actions } = await fireAssignPerson({
      columnId: peopleColId,
      userId: memberBId,
    });

    expect(actions).toEqual([{ type: "assign_person", outcome: "set" }]);
    const cell = await readCell(itemId, peopleColId);
    expect(cell).toEqual({ userIds: [memberBId] });

    await cleanup(itemId, ruleId);
  });

  // =========================================================================
  // Outcome: "skipped_equal" — the cell already holds exactly that value.
  // =========================================================================
  it("records skipped_equal when the cell already holds that assignee", async () => {
    const itemId = await createFreshItem();
    // Pre-seed the cell to the value the automation would write, directly
    // (not via the automation), so the engine sees it as already-equal.
    const preErr = await setCell(itemId, peopleColId, {
      userIds: [memberBId],
    });
    expect(preErr, "pre-seed people cell").toBeNull();

    const ruleId = await insertAutomation({
      trigger: {
        type: "status_changed",
        columnId: statusColId,
        toOptionId: optDoneId,
      },
      actions: [
        { type: "assign_person", columnId: peopleColId, userId: memberBId },
      ],
    });

    const writeErr = await setCell(itemId, statusColId, {
      optionId: optDoneId,
    });
    expect(writeErr, "set S=Done").toBeNull();

    const run = await poll(async () => {
      const { data } = await admin
        .from("automation_runs")
        .select("actions")
        .eq("automation_id", ruleId)
        .eq("item_id", itemId)
        .maybeSingle();
      const actions = (data as { actions: unknown } | null)?.actions;
      return Array.isArray(actions) && actions.length > 0 ? actions : null;
    });

    expect(run).toEqual([{ type: "assign_person", outcome: "skipped_equal" }]);
    // Cell is unchanged — still exactly the pre-seeded value.
    expect(await readCell(itemId, peopleColId)).toEqual({
      userIds: [memberBId],
    });

    await cleanup(itemId, ruleId);
  });

  // =========================================================================
  // Outcome: "skipped_bad_target" — column belongs to ANOTHER board.
  // =========================================================================
  it("records skipped_bad_target for a column on another board", async () => {
    const { itemId, ruleId, actions } = await fireAssignPerson({
      columnId: otherBoardPeopleColId,
      userId: memberBId,
    });

    expect(actions).toEqual([
      { type: "assign_person", outcome: "skipped_bad_target" },
    ]);
    // Nothing was written to either board's people column for this item.
    expect(await readCell(itemId, otherBoardPeopleColId)).toBeNull();
    expect(await readCell(itemId, peopleColId)).toBeNull();

    await cleanup(itemId, ruleId);
  });

  // =========================================================================
  // Outcome: "skipped_bad_target" — column is on this board but not 'people'.
  // =========================================================================
  it("records skipped_bad_target for a non-people column on this board", async () => {
    const { itemId, ruleId, actions } = await fireAssignPerson({
      columnId: statusColId,
      userId: memberBId,
    });

    expect(actions).toEqual([
      { type: "assign_person", outcome: "skipped_bad_target" },
    ]);
    // The status column's cell reflects only the trigger write (Done), not
    // any assign_person write.
    expect(await readCell(itemId, statusColId)).toEqual({
      optionId: optDoneId,
    });

    await cleanup(itemId, ruleId);
  });

  // =========================================================================
  // Outcome: "skipped_not_member" — assignee uuid is outside the firing org.
  // =========================================================================
  it("records skipped_not_member for a uuid outside the org", async () => {
    const { itemId, ruleId, actions } = await fireAssignPerson({
      columnId: peopleColId,
      userId: outsiderId,
    });

    expect(actions).toEqual([
      { type: "assign_person", outcome: "skipped_not_member" },
    ]);
    expect(await readCell(itemId, peopleColId)).toBeNull();

    await cleanup(itemId, ruleId);
  });
});
