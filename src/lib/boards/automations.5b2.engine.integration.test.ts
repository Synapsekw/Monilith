/**
 * Phase 5b-2: date-sweep cloud integration tests.
 *
 * Covers:
 *  - fires on the date (offset 0) → set_option
 *  - fires 3 days before (offset -3): cell = today+3 → set_option
 *  - does NOT fire when local hour != 08:00
 *  - idempotent: two sweeps fire once
 *  - re-fires for a moved date (two distinct fire_dates in ledger)
 *  - respects the If condition gate (blocks when condition not met)
 *  - disabled rules never fire
 *
 * Harness mirrors automations.engine.5b1.integration.test.ts exactly —
 * same env wiring, beforeAll shape, helpers.
 */

import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

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

describe.skipIf(!SERVICE_ROLE_KEY)(
  "engine: automations 5b-2 date sweep",
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

    // ── Date column D (trigger column for date_reached rules) ─────────────────
    let dateColId: string;

    // ── Status column S (options: Working, Stuck) ─────────────────────────────
    let colSId: string;
    let optWorkingId: string;
    let optStuckId: string;

    // ─────────────────────────────────────────────────────────────────────────
    // Setup
    // ─────────────────────────────────────────────────────────────────────────
    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // ── create userA ──────────────────────────────────────────────────────
      const emailA = `eng5b2-a-${randomUUID()}@example.com`;
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
        p_name: "Eng5b2 Org A",
        p_slug: `eng5b2-a-${randomUUID().slice(0, 8)}`,
      });
      orgAId = (orgData as { id: string }).id;

      // Set org timezone to Asia/Tokyo (UTC+9) for deterministic sweep tests
      await admin
        .from("organizations")
        .update({ timezone: "Asia/Tokyo" })
        .eq("id", orgAId);

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

      // ── Date column D (trigger column) ────────────────────────────────────
      const { data: colDate, error: colDateErr } = await admin
        .from("columns")
        .insert({
          org_id: orgAId,
          board_id: boardAId,
          name: "D",
          kind: "date",
          settings: {},
          position: 10,
        })
        .select("id")
        .single();
      expect(colDateErr, "insert col D").toBeNull();
      dateColId = (colDate as { id: string }).id;

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
          position: 11,
        })
        .select("id")
        .single();
      expect(colSErr, "insert col S").toBeNull();
      colSId = (colS as { id: string }).id;
    }, 90_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** Insert a date_reached automation via service-role. */
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

    /** Set a date cell value with ISO date string. */
    async function setDate(itemId: string, columnId: string, iso: string) {
      return setCell(itemId, columnId, { date: iso });
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

    /**
     * Invoke the date sweep function as admin.
     * p_now: ISO 8601 timestamptz string (UTC).
     */
    async function sweep(pNowIso: string) {
      const { error } = await admin.rpc("_automation_date_sweep", {
        p_now: pNowIso,
      });
      expect(error, error?.message).toBeNull();
    }

    // =========================================================================
    // 1. fires on the date (offset 0) → set_option
    // =========================================================================
    it("fires on the date (offset 0) → set_option sets S=Working", async () => {
      // p_now = 2026-06-20T23:00:00Z → Tokyo local = 2026-06-21 08:00 → today = 2026-06-21
      const itemId = await createFreshItem();
      const dateErr = await setDate(itemId, dateColId, "2026-06-21");
      expect(dateErr, "set date cell").toBeNull();

      const automationId = await insertAutomation({
        trigger: {
          type: "date_reached",
          columnId: dateColId,
          offsetDays: 0,
        },
        actions: [
          { type: "set_option", columnId: colSId, optionId: optWorkingId },
        ],
      });

      await sweep("2026-06-20T23:00:00Z");

      const cell = await poll(async () => {
        const { data } = await admin
          .from("cell_values")
          .select("value")
          .eq("item_id", itemId)
          .eq("column_id", colSId);
        return data && data.length > 0 ? data[0] : null;
      });

      expect(cell, "S cell should be set").not.toBeNull();
      expect((cell as { value: unknown }).value).toMatchObject({
        optionId: optWorkingId,
      });

      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_date_fires")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    });

    // =========================================================================
    // 2. fires 3 days before (offset -3): cell = today+3 → set_option
    // =========================================================================
    it("fires 3 days before (offset -3): cell = today+3 → set_option sets S=Working", async () => {
      // p_now = 2026-06-20T23:00:00Z → Tokyo today = 2026-06-21
      // offsetDays -3 means fire when cell = today + 3 = 2026-06-24
      const itemId = await createFreshItem();
      const dateErr = await setDate(itemId, dateColId, "2026-06-24");
      expect(dateErr, "set date cell (offset -3)").toBeNull();

      const automationId = await insertAutomation({
        trigger: {
          type: "date_reached",
          columnId: dateColId,
          offsetDays: -3,
        },
        actions: [
          { type: "set_option", columnId: colSId, optionId: optWorkingId },
        ],
      });

      await sweep("2026-06-20T23:00:00Z");

      const cell = await poll(async () => {
        const { data } = await admin
          .from("cell_values")
          .select("value")
          .eq("item_id", itemId)
          .eq("column_id", colSId);
        return data && data.length > 0 ? data[0] : null;
      });

      expect(cell, "S cell should be set (offset -3)").not.toBeNull();
      expect((cell as { value: unknown }).value).toMatchObject({
        optionId: optWorkingId,
      });

      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_date_fires")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    });

    // =========================================================================
    // 3. does NOT fire when local hour != 08:00
    // =========================================================================
    it("does NOT fire when local hour != 08:00 (sweep at Tokyo 14:00)", async () => {
      // p_now = 2026-06-21T05:00:00Z → Tokyo local = 2026-06-21 14:00 (not 08:00)
      const itemId = await createFreshItem();
      const dateErr = await setDate(itemId, dateColId, "2026-06-21");
      expect(dateErr, "set date cell (wrong hour)").toBeNull();

      const automationId = await insertAutomation({
        trigger: {
          type: "date_reached",
          columnId: dateColId,
          offsetDays: 0,
        },
        actions: [
          { type: "set_option", columnId: colSId, optionId: optWorkingId },
        ],
      });

      await sweep("2026-06-21T05:00:00Z");

      await new Promise((r) => setTimeout(r, 1_500));

      const { data: sCell } = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", itemId)
        .eq("column_id", colSId);

      expect(
        sCell ?? [],
        "S cell should NOT be set at wrong hour",
      ).toHaveLength(0);

      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_date_fires")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    });

    // =========================================================================
    // 4. idempotent: two sweeps fire once
    // =========================================================================
    it("idempotent: two sweeps with same p_now insert exactly 1 ledger row", async () => {
      const itemId = await createFreshItem();
      const dateErr = await setDate(itemId, dateColId, "2026-06-21");
      expect(dateErr, "set date cell (idempotent test)").toBeNull();

      const automationId = await insertAutomation({
        trigger: {
          type: "date_reached",
          columnId: dateColId,
          offsetDays: 0,
        },
        actions: [
          {
            type: "notify",
            recipient: { kind: "member", userId: userAId },
          },
        ],
      });

      // Sweep twice with identical p_now
      await sweep("2026-06-20T23:00:00Z");
      await sweep("2026-06-20T23:00:00Z");

      await new Promise((r) => setTimeout(r, 1_500));

      const { data: ledgerRows } = await admin
        .from("automation_date_fires")
        .select("*")
        .eq("automation_id", automationId)
        .eq("item_id", itemId);

      expect(
        ledgerRows ?? [],
        "ledger should have exactly 1 row after 2 sweeps",
      ).toHaveLength(1);

      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_date_fires")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("notifications").delete().eq("item_id", itemId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    });

    // =========================================================================
    // 5. re-fires for a moved date (two distinct fire_dates in ledger)
    // =========================================================================
    it("re-fires for a moved date: ledger has 2 rows with distinct fire_dates", async () => {
      const itemId = await createFreshItem();

      const automationId = await insertAutomation({
        trigger: {
          type: "date_reached",
          columnId: dateColId,
          offsetDays: 0,
        },
        actions: [
          {
            type: "notify",
            recipient: { kind: "member", userId: userAId },
          },
        ],
      });

      // First fire: date = 2026-06-21, sweep at Tokyo 08:00
      const dateErr1 = await setDate(itemId, dateColId, "2026-06-21");
      expect(dateErr1, "set date cell (first fire)").toBeNull();
      await sweep("2026-06-20T23:00:00Z");

      // Move the date to next day; sweep at Tokyo 08:00 the next day
      const dateErr2 = await setDate(itemId, dateColId, "2026-06-22");
      expect(dateErr2, "set date cell (second fire)").toBeNull();
      await sweep("2026-06-21T23:00:00Z");

      await new Promise((r) => setTimeout(r, 1_500));

      const { data: ledgerRows } = await admin
        .from("automation_date_fires")
        .select("fire_date")
        .eq("automation_id", automationId)
        .eq("item_id", itemId);

      expect(
        ledgerRows ?? [],
        "ledger should have 2 rows (two distinct fire_dates)",
      ).toHaveLength(2);

      // Verify the two rows have distinct fire_dates
      const fireDates = (ledgerRows ?? []).map(
        (r: { fire_date: string }) => r.fire_date,
      );
      const uniqueDates = new Set(fireDates);
      expect(uniqueDates.size, "fire_dates should be distinct").toBe(2);

      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_date_fires")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("notifications").delete().eq("item_id", itemId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    });

    // =========================================================================
    // 6. respects the If condition gate (blocks when condition not met)
    // =========================================================================
    it("condition gate blocks date_reached action when condition not satisfied", async () => {
      // Condition: S is Stuck (optStuckId). S cell is unset → gate blocks.
      const itemId = await createFreshItem();
      const dateErr = await setDate(itemId, dateColId, "2026-06-21");
      expect(dateErr, "set date cell (condition gate test)").toBeNull();

      const automationId = await insertAutomation({
        trigger: {
          type: "date_reached",
          columnId: dateColId,
          offsetDays: 0,
        },
        actions: [
          {
            type: "notify",
            recipient: { kind: "member", userId: userAId },
          },
        ],
        condition: {
          combinator: "and",
          conditions: [{ columnId: colSId, operator: "is", value: optStuckId }],
        },
      });

      await sweep("2026-06-20T23:00:00Z");

      await new Promise((r) => setTimeout(r, 1_500));

      const { data: ledgerRows } = await admin
        .from("automation_date_fires")
        .select("*")
        .eq("automation_id", automationId)
        .eq("item_id", itemId);

      // The sweep inserts the ledger row first (idempotency), THEN runs the
      // engine which evaluates the condition gate. Ledger has 1 row (fire was
      // attempted) but the gate blocks execution so no notification is produced.
      expect(
        ledgerRows ?? [],
        "ledger should have 1 row (fire attempted, then gated)",
      ).toHaveLength(1);

      const { data: notifs } = await admin
        .from("notifications")
        .select("id")
        .eq("item_id", itemId)
        .eq("automation_id", automationId);

      expect(
        notifs ?? [],
        "notification should NOT be sent when condition blocks",
      ).toHaveLength(0);

      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_date_fires")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("notifications").delete().eq("item_id", itemId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    });

    // =========================================================================
    // 7. disabled rules never fire
    // =========================================================================
    it("disabled rule never fires (no ledger row, no action)", async () => {
      const itemId = await createFreshItem();
      const dateErr = await setDate(itemId, dateColId, "2026-06-21");
      expect(dateErr, "set date cell (disabled rule test)").toBeNull();

      const automationId = await insertAutomation({
        trigger: {
          type: "date_reached",
          columnId: dateColId,
          offsetDays: 0,
        },
        actions: [
          {
            type: "notify",
            recipient: { kind: "member", userId: userAId },
          },
        ],
        enabled: false,
      });

      await sweep("2026-06-20T23:00:00Z");

      await new Promise((r) => setTimeout(r, 1_500));

      const { data: ledgerRows } = await admin
        .from("automation_date_fires")
        .select("*")
        .eq("automation_id", automationId)
        .eq("item_id", itemId);

      expect(
        ledgerRows ?? [],
        "disabled rule: ledger should have 0 rows",
      ).toHaveLength(0);

      const { data: notifs } = await admin
        .from("notifications")
        .select("id")
        .eq("item_id", itemId)
        .eq("automation_id", automationId);

      expect(notifs ?? [], "disabled rule: no notifications").toHaveLength(0);

      await admin.from("automations").delete().eq("id", automationId);
      await admin
        .from("automation_date_fires")
        .delete()
        .eq("automation_id", automationId);
      await admin.from("notifications").delete().eq("item_id", itemId);
      await admin.from("cell_values").delete().eq("item_id", itemId);
      await admin.from("items").delete().eq("id", itemId);
    });
  },
);
