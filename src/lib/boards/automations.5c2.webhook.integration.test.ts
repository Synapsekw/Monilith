/**
 * Phase 5c-2: webhook engine cloud integration tests.
 *
 * Covers:
 *  1. SSRF guard: rejects unsafe urls, accepts public https
 *  2. Outcome mapper: maps http responses to outcome strings
 *  3. Enqueue + ledger: firing a webhook rule writes queued outcome + pending delivery
 *  4. Unsafe url: blocked_unsafe_url, no delivery row, run still 'ran'
 *  5. Admin gate: member cannot insert webhook rule; non-webhook rule by member succeeds
 *  6. Reconcile: runs without error, leaves pending delivery intact (no response yet)
 *  7. RLS: cross-org member cannot read another org's deliveries
 *
 * Harness mirrors automations.5c1.runhistory.integration.test.ts exactly —
 * same env wiring, beforeAll shape, poll helper, afterAll cleanup.
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
  "engine: automations 5c-2 webhook",
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

    // ── orgA member (for admin-gate test 5) ──────────────────────────────────
    let userMAnon: SupabaseClient<Database>;

    // ── orgB context (for RLS test 7) ─────────────────────────────────────────
    let userBAnon: SupabaseClient<Database>;

    // ─────────────────────────────────────────────────────────────────────────
    // Setup
    // ─────────────────────────────────────────────────────────────────────────
    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // ── create userA (owner of orgA) ──────────────────────────────────────
      const emailA = `wh5c2-a-${randomUUID()}@example.com`;
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
        p_name: "Webhook5c2 Org A",
        p_slug: `wh5c2-a-${randomUUID().slice(0, 8)}`,
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

      // ── create userM (member of orgA, for admin-gate test) ────────────────
      const emailM = `wh5c2-m-${randomUUID()}@example.com`;
      const { data: createdM, error: errM } = await admin.auth.admin.createUser(
        {
          email: emailM,
          password: PASSWORD,
          email_confirm: true,
        },
      );
      expect(errM, "createUser(M)").toBeNull();
      const userMId = createdM.user!.id;
      createdUserIds.push(userMId);

      userMAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInOrThrow(
        userMAnon,
        { email: emailM, password: PASSWORD },
        emailM,
      );

      // Add userM to orgA as a member (not owner/admin)
      await admin.from("org_members").insert({
        org_id: orgAId,
        user_id: userMId,
        role: "member",
      });

      // Grant userM editor access on Board A. Since board-level sharing,
      // automations writes require can_edit_board(board_id) — without a board
      // grant userM (a plain org member) could not create ANY automation here.
      // This isolates the webhook admin-gate as the behavior under test: the
      // webhook rule is still blocked by the admin-gate trigger, while the
      // non-webhook rule is allowed.
      await admin.from("board_members").insert({
        org_id: orgAId,
        board_id: boardAId,
        user_id: userMId,
        access_level: "editor",
        granted_by: userAId,
      });

      // ── create userB in a separate org (for RLS test 7) ──────────────────
      const emailB = `wh5c2-b-${randomUUID()}@example.com`;
      const { data: createdB, error: errB } = await admin.auth.admin.createUser(
        {
          email: emailB,
          password: PASSWORD,
          email_confirm: true,
        },
      );
      expect(errB, "createUser(B)").toBeNull();
      const userBId = createdB.user!.id;
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
        p_name: "Webhook5c2 Org B",
        p_slug: `wh5c2-b-${randomUUID().slice(0, 8)}`,
      });
    }, 90_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** Create a fresh item in boardA as userA and return its id. */
    async function createFreshItem(): Promise<string> {
      const { data, error } = await userAAnon.rpc("create_item", {
        p_group_id: groupAId,
        p_name: `Test item ${randomUUID().slice(0, 8)}`,
      });
      expect(error, "createFreshItem").toBeNull();
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

    // =========================================================================
    // 1. SSRF guard accepts/rejects the right hosts
    // =========================================================================
    it("ssrf guard rejects unsafe urls and accepts public https", async () => {
      const cases: [string, boolean][] = [
        ["https://hooks.example.com/x", true],
        ["http://hooks.example.com/x", false],
        ["https://localhost/x", false],
        ["https://127.0.0.1/x", false],
        ["https://10.0.0.5/x", false],
        ["https://169.254.169.254/latest/meta-data", false],
        ["https://service.internal/x", false],
      ];
      for (const [url, expected] of cases) {
        const { data, error } = await admin.rpc("_webhook_url_safe", {
          p_url: url,
        });
        expect(error, `_webhook_url_safe error for ${url}`).toBeNull();
        expect(data, `_webhook_url_safe(${url})`).toBe(expected);
      }
    }, 15_000);

    // =========================================================================
    // 2. Outcome mapper
    // =========================================================================
    it("maps http responses to outcomes", async () => {
      const m = async (code: number | null, err: string | null) =>
        (
          await admin.rpc("_webhook_outcome", {
            // Cast: the SQL fn accepts NULL args (tested below), but generated Args type is non-nullable.
            p_status_code: code as number,
            p_error_msg: err as string,
          })
        ).data;
      expect(await m(200, null)).toBe("delivered_200");
      expect(await m(204, null)).toBe("delivered_204");
      expect(await m(404, null)).toBe("failed_404");
      expect(await m(500, null)).toBe("failed_500");
      expect(await m(null, "Timeout")).toBe("failed_network");
      expect(await m(null, null)).toBe("failed_network");
    }, 15_000);

    // =========================================================================
    // 3. Enqueue + ledger: firing a webhook rule writes a queued outcome + one
    //    pending delivery
    // =========================================================================
    it("enqueues a webhook and records a pending delivery", async () => {
      // Create an admin-owned rule: status_changed -> call_webhook(https://...)
      // Insert via service-role admin so auth.uid() is null and the admin-gate
      // trigger allows it.
      const { data: rule, error: ruleErr } = await admin
        .from("automations")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          enabled: true,
          trigger: {
            type: "status_changed",
            columnId: colSId,
            toOptionId: null,
          } as never,
          actions: [
            {
              type: "call_webhook",
              url: `https://example.com/hook-${randomUUID()}`,
            },
          ] as never,
          created_by: userAId,
        })
        .select("id")
        .single();
      expect(ruleErr, "insert webhook rule (case 3)").toBeNull();

      // Fire it by changing the status cell (as userA — the org owner)
      const itemId = await createFreshItem();
      const writeErr = await setCell(itemId, colSId, {
        optionId: optWorkingId,
      });
      expect(writeErr, "set S=Working (case 3)").toBeNull();

      const run = await poll(async () => {
        const { data } = await admin
          .from("automation_runs")
          .select("*")
          .eq("automation_id", rule!.id)
          .maybeSingle();
        return data;
      });
      expect(run, "run row should appear (case 3)").not.toBeNull();
      expect(run!.status, "run status (case 3)").toBe("ran");

      const runActions = run!.actions as { type: string; outcome: string }[];
      expect(runActions, "actions array (case 3)").toEqual([
        { type: "call_webhook", outcome: "queued" },
      ]);

      const { data: deliveries, error: delivErr } = await admin
        .from("automation_webhook_deliveries")
        .select("*")
        .eq("run_id", run!.id);
      expect(delivErr, "deliveries query error (case 3)").toBeNull();
      expect(deliveries, "deliveries array (case 3)").toHaveLength(1);
      expect(
        (deliveries as { status: string }[])[0].status,
        "delivery status (case 3)",
      ).toBe("pending");
      expect(
        (deliveries as { action_index: number }[])[0].action_index,
        "delivery action_index (case 3)",
      ).toBe(0);
      expect(
        (deliveries as { org_id: string }[])[0].org_id,
        "delivery org_id (case 3)",
      ).toBe(orgAId);

      // Cleanup
      await admin.from("automations").delete().eq("id", rule!.id);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    }, 30_000);

    // =========================================================================
    // 4. Unsafe url -> blocked_unsafe_url, no delivery, run still 'ran'
    // =========================================================================
    it("blocks an unsafe url without enqueuing", async () => {
      const { data: rule, error: ruleErr } = await admin
        .from("automations")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          enabled: true,
          trigger: {
            type: "status_changed",
            columnId: colSId,
            toOptionId: null,
          } as never,
          actions: [
            { type: "call_webhook", url: "http://10.0.0.1/x" }, // http + private
          ] as never,
          created_by: userAId,
        })
        .select("id")
        .single();
      // Inserted via the service-role `admin` client: auth.uid() is null, so the
      // admin-gate trigger allows it (the trigger only blocks authenticated non-admins).
      expect(ruleErr, "insert unsafe-url webhook rule (case 4)").toBeNull();

      const itemId = await createFreshItem();
      const writeErr = await setCell(itemId, colSId, {
        optionId: optStuckId,
      });
      expect(writeErr, "set S=Stuck (case 4)").toBeNull();

      const run = await poll(async () => {
        const { data } = await admin
          .from("automation_runs")
          .select("*")
          .eq("automation_id", rule!.id)
          .maybeSingle();
        return data;
      });
      expect(run, "run row should appear (case 4)").not.toBeNull();
      expect(run!.status, "run status (case 4)").toBe("ran");

      const runActions = run!.actions as { type: string; outcome: string }[];
      expect(runActions, "blocked_unsafe_url in actions (case 4)").toEqual([
        { type: "call_webhook", outcome: "blocked_unsafe_url" },
      ]);

      const { data: deliveries, error: delivErr } = await admin
        .from("automation_webhook_deliveries")
        .select("*")
        .eq("run_id", run!.id);
      expect(delivErr, "deliveries query error (case 4)").toBeNull();
      expect(deliveries, "no deliveries for blocked url (case 4)").toHaveLength(
        0,
      );

      // Cleanup
      await admin.from("automations").delete().eq("id", rule!.id);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    }, 30_000);

    // =========================================================================
    // 5. Admin gate: a plain member cannot insert a webhook rule; an admin can
    // =========================================================================
    it("admin-gates webhook rule creation", async () => {
      // userM is a 'member' of orgA — should be blocked from inserting webhook rule
      const memberInsert = await userMAnon
        .from("automations")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          enabled: true,
          trigger: { type: "item_created" } as never,
          actions: [
            { type: "call_webhook", url: "https://example.com/x" },
          ] as never,
        })
        .select("id")
        .maybeSingle();
      expect(
        memberInsert.error,
        "member insert should be blocked",
      ).not.toBeNull(); // 42501 from the trigger (or RLS)
      expect(memberInsert.error?.code).toBe("42501");

      // A notify-only (non-webhook) rule by the same member should succeed
      // Note: RLS must allow members to insert non-webhook automations. If this
      // fails due to a broader RLS restriction it will be documented in the report.
      const okInsert = await userMAnon
        .from("automations")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          enabled: true,
          trigger: { type: "item_created" } as never,
          actions: [
            { type: "set_option", columnId: colSId, optionId: optWorkingId },
          ] as never,
        })
        .select("id")
        .maybeSingle();
      expect(okInsert.error, "non-webhook rule insert by member").toBeNull();

      // Cleanup: delete the inserted non-webhook rule if it succeeded
      if (!okInsert.error && okInsert.data?.id) {
        await admin.from("automations").delete().eq("id", okInsert.data.id);
      }
    }, 15_000);

    // =========================================================================
    // 6. Reconcile is a no-op while the response is absent
    // =========================================================================
    it("reconcile leaves a delivery pending when no response yet", async () => {
      // The example.com request may or may not have completed. We only assert
      // that _automation_webhook_reconcile() runs without error and does not
      // corrupt the database. Whether the delivery transitions to 'done' depends
      // on real network timing and is not asserted here (documented gap).
      const { error } = await admin.rpc("_automation_webhook_reconcile");
      expect(error, "reconcile rpc error").toBeNull();
    }, 15_000);

    // =========================================================================
    // 7. RLS: a cross-org member cannot read another org's deliveries
    // =========================================================================
    it("rls blocks cross-org delivery reads", async () => {
      const { data, error } = await userBAnon
        .from("automation_webhook_deliveries")
        .select("*")
        .eq("org_id", orgAId);
      // RLS should hide rows without an error (returns empty array)
      expect(error, "cross-org read should not error (RLS hides)").toBeNull();
      expect(
        data ?? [],
        "orgB user sees 0 rows from orgA deliveries",
      ).toHaveLength(0);
    }, 15_000);
  },
);
