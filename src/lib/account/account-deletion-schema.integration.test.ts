import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

/**
 * Schema-conformance tripwire for spec §3.2 — the highest-value test in this
 * feature, because it guards a property no unit test can see.
 *
 * Account deletion works by emptying 13 ownership-bearing columns BEFORE the
 * `auth.users` row is deleted. Those columns deliberately stay `NOT NULL` +
 * `ON DELETE NO ACTION`, so if `user_delete_reassign_authorship()` misses one,
 * deletion fails loudly on a named FK constraint rather than silently orphaning
 * an organization's data. The catch is that "the RPC handles every blocking
 * column" is only true until someone adds the 14th authorship column.
 *
 * These two lists are that guard. When either legitimately changes, update the
 * RPC FIRST and the list SECOND — never the other way round.
 */

/**
 * Every `NOT NULL` + `NO ACTION` FK to `auth.users`. Each one MUST appear as an
 * `UPDATE` in `user_delete_reassign_authorship()`.
 */
const EXPECTED_REASSIGNED = [
  "attachments.uploaded_by",
  "board_members.granted_by",
  "boards.created_by",
  "dashboards.created_by",
  "goals.created_by",
  "goals.owner_id",
  "item_updates.author_id",
  "items.created_by",
  "member_capacity.created_by",
  "org_invitations.invited_by",
  "organizations.created_by",
  "portfolios.created_by",
  "workspaces.created_by",
].sort();

/**
 * The second, subtler trap — and the one that actually bit during this build.
 *
 * Two `BEFORE UPDATE` triggers exist specifically to make attribution immutable
 * (`items_protect_creation_metadata`, `item_updates_protect_attribution`). They
 * rewrite the NEW row back to OLD, so a reassignment `UPDATE` reports
 * `row_count = 1` and changes NOTHING. Migration 20260725103609 gives each a
 * narrow, guarded branch for the sanctioned deletion path.
 *
 * Any frozen authorship column NOT in this list has no such branch, so the
 * reassignment for it is a silent no-op. That is unobservable in code review —
 * hence a schema assertion.
 */
const EXPECTED_FROZEN_BUT_HANDLED = [
  "item_updates.author_id",
  "items.created_by",
].sort();

describe.skipIf(!integrationTargetReady())(
  "account deletion schema conformance",
  () => {
    const svc = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    it("every NOT NULL / NO ACTION FK to auth.users is one the reassignment RPC handles", async () => {
      const { data, error } = await svc.rpc("account_deletion_blocking_fks");
      expect(error).toBeNull();
      const actual = (data ?? []).map((r) => r.qualified_column).sort();
      expect(actual).toEqual(EXPECTED_REASSIGNED);
    });

    it("every attribution-freeze trigger over an auth.users column has a sanctioned reassignment branch", async () => {
      const { data, error } = await svc.rpc(
        "account_deletion_reattribution_frozen_columns",
      );
      expect(error).toBeNull();
      const actual = (data ?? []).map((r) => r.qualified_column).sort();
      expect(actual).toEqual(EXPECTED_FROZEN_BUT_HANDLED);
    });

    it("every frozen column is also a blocking column, so the tripwire covers it", async () => {
      // Belt-and-braces: a freeze on a column that is NOT NOT-NULL/NO-ACTION
      // would fail silently instead of loudly, escaping both lists above.
      const { data: blocking } = await svc.rpc("account_deletion_blocking_fks");
      const blockingSet = new Set(
        (blocking ?? []).map((r) => r.qualified_column),
      );
      for (const frozen of EXPECTED_FROZEN_BUT_HANDLED) {
        expect(
          blockingSet.has(frozen),
          `${frozen} must stay a blocking FK`,
        ).toBe(true);
      }
    });
  },
);
