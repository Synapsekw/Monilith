/**
 * Test-support fake for `createAutomationCore`'s Supabase surface, shared by
 * the core's own suite and the agent tool that wraps it.
 *
 * The core touches exactly four call shapes:
 *   - `.from("boards").select("org_id").eq(…).maybeSingle()`
 *   - `.from("org_members").select("role").eq(…).eq(…).maybeSingle()`
 *   - `.from("automations").select("position").eq(…).order(…).limit(1).maybeSingle()`
 *   - `.from("automations").insert(row).select("id").single()`
 *
 * `auth` is a THROWING getter on purpose: the core must take its actor as a
 * parameter, never pay a GoTrue round-trip on a bridged client.
 *
 * Lives in `src/test/` beside `mcp-fake-client.ts` — outside vitest's
 * `src/**\/*.{test,spec}.{ts,tsx}` include glob, so it is never collected as a
 * suite.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AutomationAction } from "@/lib/validations/automations";

export const FAKE_BOARD = "11111111-1111-4111-8111-111111111111";
export const FAKE_ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const FAKE_ACTOR = "99999999-9999-4999-8999-999999999999";
const FAKE_COLUMN = "33333333-3333-4333-8333-333333333333";
const FAKE_PEOPLE_COLUMN = "44444444-4444-4444-8444-444444444444";

/** A trigger that satisfies `automationTriggerSchema`, so a guard test fails at
 *  the guard rather than at the Zod boundary. */
export const someTrigger = {
  type: "status_changed",
  columnId: FAKE_COLUMN,
  toOptionId: null,
};

export const notifyAction: AutomationAction = {
  type: "notify",
  recipient: { kind: "owner", peopleColumnId: FAKE_PEOPLE_COLUMN },
};

export const webhookAction: AutomationAction = {
  type: "call_webhook",
  url: "https://example.com/hook",
};

export type AutomationClientSpec = {
  /** The caller's row in `org_members`; `null` = not a member at all. */
  role?: "owner" | "admin" | "member" | null;
  /** The `boards` row; `null` = board not found / not visible under RLS. */
  board?: { org_id: string } | null;
  /** Highest existing `position` on the board; `null` = no automations yet. */
  position?: number | null;
  insertError?: string;
};

export type AutomationFake = {
  client: SupabaseClient<Database>;
  /** Every `automations` insert, in order. */
  inserts: Record<string, unknown>[];
  /** Every select, in order — lets a test assert a lookup did NOT happen. */
  reads: { table: string; cols: string }[];
};

export function makeAutomationClient(
  spec: AutomationClientSpec = {},
): AutomationFake {
  const inserts: Record<string, unknown>[] = [];
  const reads: { table: string; cols: string }[] = [];
  const board = spec.board === undefined ? { org_id: FAKE_ORG } : spec.board;

  const client = {
    get auth(): never {
      throw new Error("createAutomationCore must not call supabase.auth");
    },
    from: (table: string) => ({
      select: (cols: string) => {
        reads.push({ table, cols });
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            if (table === "boards") return { data: board, error: null };
            if (table === "org_members")
              return {
                data:
                  spec.role === null ? null : { role: spec.role ?? "member" },
                error: null,
              };
            return {
              data:
                spec.position === null || spec.position === undefined
                  ? null
                  : { position: spec.position },
              error: null,
            };
          },
        };
        return chain;
      },
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return {
          select: () => ({
            single: async () =>
              spec.insertError
                ? { data: null, error: { message: spec.insertError } }
                : { data: { id: "auto-1" }, error: null },
          }),
        };
      },
    }),
  };

  return {
    // A structural fake satisfies the core's client parameter, exactly as in
    // `mcp-fake-client.ts`; the cast is confined to this one line.
    client: client as unknown as SupabaseClient<Database>,
    inserts,
    reads,
  };
}
