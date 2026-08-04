import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import {
  TIER2_FIXTURE_PASSWORD,
  TIER2_FIXTURE_TENANTS,
  loadFixtureEnv,
  resolveFixtureTarget,
} from "@/test/tenant-fixtures";
import type { Database } from "@/types/database.types";

// ===========================================================================
// TIER 2 — ai_conversations_board_org_fkey, proven against the LIVE DEV project.
// ===========================================================================
//
// Run: `pnpm test:fixtures` (also part of `pnpm test`).
//
// THE DISCRIMINATOR IS CASE 1.
// Alpha inserting (org_id = alpha's org, board_id = BETA's board) must raise
// SQLSTATE 23503. BEFORE the composite FK shipped, that insert SUCCEEDED — it
// created exactly the drifted row this constraint exists to forbid. That was not
// taken on faith: on 2026-08-04, immediately before applying the migration, the
// insert was executed against DEV inside a transaction and observed to be
// ACCEPTED (conversation_org = alpha, board_org = beta, is_drifted = true), then
// rolled back. Drop `ai_conversations_board_org_fkey` and this case goes red, and
// it is the ONLY case here that does. Every other case is a control.
//
// WHY THE REFUSAL IS NOT ABOUT VISIBILITY.
// Alpha cannot READ beta's board — but referential-integrity checks run as the
// constraint owner and are not subject to RLS, so the refusal comes from the FK,
// not from invisibility. That is the whole "a uuid-shaped board id is not a
// board you may write to" argument, now enforced one layer below the server
// action.
//
// WHY THIS IS TIER 2. All ~70 Tier-1 *.integration.test.ts suites self-skip:
// integrationTargetReady() deny-lists DEV and PROD because the Tier-1 teardown
// is a destructive purge, and decision-25 rules out a sacrificial project. A
// suite that skips proves nothing, however well written — gotcha-74.
//
// THE PROBE ROWS ARE TRANSIENT. Cases 2 and 3 leave real rows in the permanent
// fixture corpus; 1 and 4 leave none IF the constraint works and one if it does
// not. afterAll deletes all four fixed UUIDs through alpha's own client
// (ai_conversations_delete_own permits an owner-scoped DELETE), and the final
// case re-reads them and asserts the corpus is back to its seeded shape — the
// same integrity discipline board-threads.fixtures.test.ts ends with.

loadFixtureEnv();

const resolution = resolveFixtureTarget(process.env);

if (!resolution.ok) {
  console.info(`[board-org-coupling] skipped — ${resolution.reason}`);
}

const [ALPHA, BETA] = TIER2_FIXTURE_TENANTS;

/** Postgres foreign_key_violation. */
const PG_FK_VIOLATION = "23503";

/** Transient probe ids, in their own block. Deliberately NOT added to
 *  src/test/tenant-fixtures.ts — nothing permanent depends on them. */
const PROBE = {
  crossOrg: "eeee0000-0000-4000-8000-000000000001",
  sameOrg: "eeee0000-0000-4000-8000-000000000002",
  boardless: "eeee0000-0000-4000-8000-000000000003",
  ghostBoard: "eeee0000-0000-4000-8000-000000000004",
} as const;

/** A board uuid that is well-formed and belongs to no board at all. */
const GHOST_BOARD_ID = "eeee0000-0000-4000-8000-0000000000ff";

describe.skipIf(!resolution.ok)(
  "a docked thread's board must live in the thread's org (live DEV)",
  () => {
    const target = resolution.ok ? resolution.target : null;

    let alpha: SupabaseClient<Database>;
    let alphaUserId: string;

    beforeAll(async () => {
      console.info(
        `[board-org-coupling] asserting ai_conversations_board_org_fkey on ${target!.label.toUpperCase()}`,
      );
      alpha = createClient<Database>(target!.url, target!.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      // Rides out GoTrue's 429 and THROWS if still unauthenticated. A silently
      // signed-out client would make every refusal below vacuous.
      await signInOrThrow(
        alpha,
        { email: ALPHA.email, password: TIER2_FIXTURE_PASSWORD },
        "tier-2 fixture alpha",
      );
      const { data } = await alpha.auth.getUser();
      if (!data.user) {
        throw new Error(
          "tier-2 fixture alpha signed in but has no user — are the accounts " +
            "created from supabase/fixtures/tier2-fixture-users.dev-only.sql?",
        );
      }
      alphaUserId = data.user.id;
    }, 120_000);

    afterAll(async () => {
      // Unconditional. Cases 2 and 3 always leave a row; 1 and 4 leave one only
      // if the constraint is broken, which is precisely when cleanup matters.
      if (!alpha) return;
      await alpha
        .from("ai_conversations")
        .delete()
        .in("id", Object.values(PROBE));
    });

    function insertProbe(id: string, boardId: string | null) {
      return alpha
        .from("ai_conversations")
        .insert({
          id,
          org_id: ALPHA.orgId,
          user_id: alphaUserId,
          board_id: boardId,
          title: "board-org coupling probe",
        })
        .select("id")
        .maybeSingle();
    }

    // ── Anti-vacuity ────────────────────────────────────────────────────────
    it("signs alpha in as a real principal who owns the fixture org", async () => {
      const { data, error } = await alpha
        .from("organizations")
        .select("id, slug");
      expect(error).toBeNull();
      expect(data).toEqual([{ id: ALPHA.orgId, slug: ALPHA.orgSlug }]);
    });

    it("cannot even READ beta's board — the id is a bare uuid to alpha", async () => {
      // Which is the point: the refusal in case 1 must come from the FK, not
      // from the row being invisible.
      const { data, error } = await alpha
        .from("boards")
        .select("id")
        .eq("id", BETA.boardId);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    // ── 1. THE DISCRIMINATOR ────────────────────────────────────────────────
    it("REFUSES a thread stamped alpha's org and docked to beta's board", async () => {
      const { data, error } = await insertProbe(PROBE.crossOrg, BETA.boardId);
      expect(
        error,
        "ORG ATTRIBUTION CAN STILL DRIFT — ai_conversations_board_org_fkey is " +
          "not enforcing (board_id, org_id) against boards (id, org_id)",
      ).not.toBeNull();
      // Assert the SQLSTATE, not merely "it errored": an RLS regression (42501)
      // or a not-null violation (23502) from a botched SET NULL clause would
      // satisfy a bare truthiness check while proving something else entirely.
      expect(error?.code).toBe(PG_FK_VIOLATION);
      expect(error?.message).toContain("ai_conversations_board_org_fkey");
      expect(data).toBeNull();
    });

    // ── 2. Anti-vacuity for case 1: the same insert on the RIGHT board works ─
    it("ACCEPTS the same thread docked to alpha's own board", async () => {
      // Differs from case 1 in exactly one column. Without this, case 1 would
      // pass just as happily if RLS, a typo, or a NOT NULL column were doing the
      // refusing.
      const { data, error } = await insertProbe(PROBE.sameOrg, ALPHA.boardId);
      expect(error).toBeNull();
      expect(data).toEqual({ id: PROBE.sameOrg });
    });

    // ── 3. board_id IS NULL stays legal ─────────────────────────────────────
    it("ACCEPTS a boardless thread — every /ask thread and briefing is one", async () => {
      // MATCH SIMPLE: a null in any referencing column satisfies the composite
      // FK with no lookup. If a future edit ever replaced the FK with a trigger
      // that forgot its null guard, this is the case that catches it.
      const { data, error } = await insertProbe(PROBE.boardless, null);
      expect(error).toBeNull();
      expect(data).toEqual({ id: PROBE.boardless });
    });

    // ── 4. A board that does not exist is still refused ─────────────────────
    it("REFUSES a well-formed board uuid that is no board at all", async () => {
      const { error } = await insertProbe(PROBE.ghostBoard, GHOST_BOARD_ID);
      expect(error?.code).toBe(PG_FK_VIOLATION);
    });

    // ── Integrity: the permanent corpus is untouched ────────────────────────
    it("leaves nothing behind and does not disturb the seeded fixtures", async () => {
      await alpha
        .from("ai_conversations")
        .delete()
        .in("id", Object.values(PROBE));

      const probes = await alpha
        .from("ai_conversations")
        .select("id")
        .in("id", Object.values(PROBE));
      expect(
        probes.data ?? [],
        "a probe row survived — the permanent fixture corpus is polluted",
      ).toEqual([]);

      // The regression subject from board-threads.fixtures.test.ts, re-read.
      const seeded = await alpha
        .from("ai_conversations")
        .select("id, board_id, visibility")
        .eq("id", ALPHA.conversationId);
      expect(seeded.data).toEqual([
        { id: ALPHA.conversationId, board_id: null, visibility: "private" },
      ]);
    });
  },
);
