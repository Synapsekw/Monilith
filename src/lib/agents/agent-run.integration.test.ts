import { randomUUID } from "node:crypto";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signBody } from "@/lib/ai/agentic/hmac";
import { allowsTier2Fixtures } from "@/lib/supabase/project-refs";
import { TIER2_FIXTURE_TENANTS, loadFixtureEnv } from "@/test/tenant-fixtures";
import type { Database } from "@/types/database.types";

// ===========================================================================
// THE GUARANTEE UNDER TEST
// ===========================================================================
//
// A personal agent emails its owner a daily briefing. An hourly pg_cron
// sweep fires a signed request to POST /api/ai/personal-agent. A redelivered
// fire slot must never produce a second email. That guarantee rests on a
// real database constraint — the unique index `user_agent_runs_slot_uniq` on
// (user_agent_id, fire_date, fire_hour), created by
// supabase/migrations/20260801091231_personal_agents.sql. The route claims
// the slot by INSERTing that row BEFORE any token spend or email; a losing
// concurrent delivery gets a 23505 unique violation and no-ops (see
// `claimRun` in src/app/api/ai/personal-agent/route.ts).
//
// route.test.ts covers all of this today only through a MOCKED
// `user_agent_runs` table (a hand-rolled insert/update stub). It proves the
// route calls insert-then-update in the right order; it has never once
// exercised the real unique index. This file closes that gap.
//
// ===========================================================================
// ZERO SPEND, ZERO SEND — how this test stays safe to run in CI
// ===========================================================================
//
// This test never lets the route reach the model call or the email send. It
// seeds the (fire_date, fire_hour) slot as ALREADY CLAIMED (a `user_agent_runs`
// row already exists for it), then drives the real route handler once. Inside
// the route, `findUserAgentRun` (agents-db.ts) — a real query against the real
// table — finds that seeded row and returns { status: "noop" } immediately,
// BEFORE `claimRun`'s insert, BEFORE `requireAiEntitlement`, BEFORE `runAi`,
// BEFORE `sendBriefingEmail`. No model call, no email, ever, on any run of
// this test. (This exercises the fast-path probe and the real index's mere
// presence/uniqueness, not the 23505 insert-conflict arbitration path itself —
// proving THAT live would require a genuine concurrent race whose winner
// reaches `runAi`, i.e. real spend, which is exactly what this test must not
// do. See route.test.ts's "is a no-op via the claim backstop when a
// concurrent delivery races the fast probe" for that path under mocks.)
//
// ===========================================================================
// WHY *.integration.test.ts (Tier-1 project) INSTEAD OF *.fixtures.test.ts
// (Tier-2), BUT TARGETING TIER-2'S PERMANENT FIXTURES
// ===========================================================================
//
// Tier 2 (`*.fixtures.test.ts`, src/test/tenant-fixtures.ts) is deliberately
// NON-PRIVILEGED: only the publishable anon key + two fixture passwords, no
// service-role key, no admin API — a unit test enforces that. This test
// cannot live there: `user_agent_runs` carries NO authenticated insert policy
// at all ("Runs are written only by the service-role endpoint" — see the
// migration's RLS section), so seeding an already-claimed slot is only
// possible with the service-role client.
//
// That makes this file privileged, so it is named `*.integration.test.ts` to
// land in the serial Tier-1 `integration` Vitest project (fileParallelism
// false, generous timeouts, `pnpm test:integration`) rather than the default
// unit run. But its TARGET is DEV, using the two PERMANENT Tier-2 fixture
// tenants (vault/decisions/2026-07-27-decision-31-tier2-permanent-tenant-fixtures.md)
// as the org/owner to hang the seeded rows off of — not a throwaway
// provisioned org. Tier-1's usual `integrationTargetReady()` gate explicitly
// FORBIDS DEV (decision-25: no sacrificial project has been provisioned, so
// all 70 Tier-1 suites skip), so this file does not use it. It gates on
// `allowsTier2Fixtures()` instead — Tier-2's DEV-only ALLOW-list, the
// deliberate inverse of Tier-1's deny-list.
//
// FOOTPRINT: this test attaches one `user_agents` row + one `user_agent_runs`
// row to Tier-2 fixture tenant A's existing org/owner, purely to satisfy
// those tables' FK constraints (org_id -> organizations, owner_id ->
// auth.users). It does not touch any of the eight tables the Tier-2 isolation
// suite (tenant-isolation.fixtures.test.ts) asserts against, and the fixture
// tenant is never read from — only its id is reused. Everything created here
// is deleted in `afterAll`, unconditionally and including on partial failure.

const [FIXTURE_TENANT] = TIER2_FIXTURE_TENANTS; // tenant "a"

// Deterministic id spelled in supabase/fixtures/tier2-fixture-users.dev-only.sql
// (the `auth.users` row for pulse-tier2-fixture-a@example.com) and consumed by
// supabase/migrations/20260727094033_seed_tier2_tenant_fixtures.sql. It is a
// UUID, not a credential, but is not exported from tenant-fixtures.ts — that
// module is deliberately non-privileged and only ever learns a user id by
// signing in. This file already holds a privileged key, so it reads the id
// directly rather than paying for a GoTrue sign-in just to learn a UUID.
const FIXTURE_A_OWNER_ID = "aaaa0000-0000-4000-8000-0000000000a1";

// Fixed, arbitrary slot — never derived from "today", so this test can never
// flake near midnight or on any particular run date.
const FIRE_DATE = "2026-01-15";
const FIRE_HOUR = 3;

type Target = { url: string; serviceRoleKey: string; hmacSecret: string };
type Resolution = { ok: true; target: Target } | { ok: false; reason: string };

/**
 * Resolve the project + secret to run against, or a reason to skip cleanly.
 * Three independent requirements, each stated so a skip reads as an
 * explanation rather than a silent no-op:
 *  - a service-role key (this test seeds `user_agent_runs`, which has no
 *    authenticated insert policy at all);
 *  - DEV specifically (`allowsTier2Fixtures`) — the only project the Tier-2
 *    permanent fixture tenants exist on;
 *  - `AI_PGNET_HMAC_SECRET` — the route itself returns 503 "not provisioned"
 *    without it (route.ts), so skip clearly here instead of asserting
 *    against a confusing 503.
 */
function resolveTarget(env: Record<string, string | undefined>): Resolution {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const hmacSecret = env.AI_PGNET_HMAC_SECRET;

  if (!url || !serviceRoleKey) {
    return {
      ok: false,
      reason:
        "No target: set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
    };
  }
  if (!allowsTier2Fixtures(url)) {
    return {
      ok: false,
      reason:
        `Runs against the DEV project only — the Tier-2 fixture tenants are ` +
        `seeded there and nowhere else; ${url} is not it.`,
    };
  }
  if (!hmacSecret) {
    return {
      ok: false,
      reason:
        "AI_PGNET_HMAC_SECRET is not set — the route 503s ('not provisioned') " +
        "without it, so there is nothing to sign a request with.",
    };
  }
  return { ok: true, target: { url, serviceRoleKey, hmacSecret } };
}

loadFixtureEnv();
const resolution = resolveTarget(process.env);
if (!resolution.ok) {
  console.info(
    `[personal-agent slot idempotency] skipped — ${resolution.reason}`,
  );
}

describe.skipIf(!resolution.ok)(
  "personal-agent route: a redelivered fire slot never produces a second run (live DEV, real unique index)",
  () => {
    const target = resolution.ok ? resolution.target : null;

    let admin: SupabaseClient<Database>;
    let post: (req: Request) => Promise<Response>;
    let agentId: string | null = null;

    beforeAll(async () => {
      admin = createClient<Database>(target!.url, target!.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Confirm the fixture owner actually exists on this project BEFORE
      // attempting an FK insert against it, so a missing/unseeded fixture
      // fails with a clear message instead of an opaque FK violation.
      const { data: ownerData, error: ownerErr } =
        await admin.auth.admin.getUserById(FIXTURE_A_OWNER_ID);
      if (ownerErr || !ownerData.user) {
        throw new Error(
          `Tier-2 fixture tenant A (owner ${FIXTURE_A_OWNER_ID}) was not found on ` +
            `${target!.url} — is supabase/fixtures/tier2-fixture-users.dev-only.sql ` +
            "applied, and 20260727094033_seed_tier2_tenant_fixtures.sql run after it?",
        );
      }

      // Deferred until AFTER loadFixtureEnv() has already overridden
      // process.env with the real DEV values above. `@/lib/env` parses
      // NEXT_PUBLIC_SUPABASE_URL eagerly at first import (not lazily), and
      // route.ts pulls it in transitively via `@/lib/supabase/service`.
      // Statically importing route.ts at the top of this file would freeze
      // its internal service client onto vitest.setup.ts's localhost
      // placeholder instead of DEV; a deferred dynamic import here is what
      // lets it pick up the real values instead (same trick route.test.ts
      // uses to let its `vi.mock` calls apply before import).
      ({ POST: post } = await import("@/app/api/ai/personal-agent/route"));

      agentId = randomUUID();
      const { error: agentErr } = await admin.from("user_agents").insert({
        id: agentId,
        org_id: FIXTURE_TENANT.orgId,
        owner_id: FIXTURE_A_OWNER_ID,
        name: `personal-agent slot idempotency probe ${agentId}`,
        template_id: "integration-test",
        instructions: "Integration-test fixture agent. Never actually run.",
        board_scope: { mode: "all" },
        cadence: "daily",
        run_at_local_hour: 7,
        enabled: true,
        bridge_secret_id: null,
      });
      if (agentErr) {
        throw new Error(`seed user_agents failed: ${agentErr.message}`);
      }

      // The claim: simulates a PRIOR delivery that already ran this exact
      // fire slot to completion — the state a redelivery of the same slot
      // must find already sitting in the table.
      const { error: runErr } = await admin.from("user_agent_runs").insert({
        user_agent_id: agentId,
        org_id: FIXTURE_TENANT.orgId,
        owner_id: FIXTURE_A_OWNER_ID,
        fire_date: FIRE_DATE,
        fire_hour: FIRE_HOUR,
        status: "ran",
        input_tokens: 42,
        output_tokens: 17,
      });
      if (runErr) {
        throw new Error(`seed user_agent_runs failed: ${runErr.message}`);
      }
    }, 60_000);

    afterAll(async () => {
      // Unconditional and best-effort: runs even if beforeAll threw partway
      // through, and deleting a row that was never inserted (or was already
      // removed) is a no-op, not an error. Cascades to `user_agent_runs`
      // (`on delete cascade` on `user_agent_id` — see the migration).
      if (!agentId || !admin) return;
      const { error } = await admin
        .from("user_agents")
        .delete()
        .eq("id", agentId);
      if (error) {
        console.warn(
          `[personal-agent slot idempotency] cleanup failed for agent ` +
            `${agentId}: ${error.message} — delete it by hand from DEV.`,
        );
      }
    }, 30_000);

    it("no-ops a redelivered fire slot without a second run row", async () => {
      const body = {
        agent_id: agentId,
        fire_date: FIRE_DATE,
        fire_hour: FIRE_HOUR,
      };
      const raw = JSON.stringify(body);
      const req = new Request("https://x/api/ai/personal-agent", {
        method: "POST",
        body: raw,
        headers: { "x-pulse-signature": signBody(raw, target!.hmacSecret) },
      });

      const res = await post(req);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        status: "noop",
        reason: "already_ran",
      });

      // The real unique index, read back: exactly the one seeded row for
      // this slot — the redelivery produced no second row.
      const { data: slotRows, error: slotErr } = await admin
        .from("user_agent_runs")
        .select("id, status")
        .eq("user_agent_id", agentId!)
        .eq("fire_date", FIRE_DATE)
        .eq("fire_hour", FIRE_HOUR);
      expect(slotErr).toBeNull();
      expect(slotRows).toHaveLength(1);
      // Untouched: the seeded outcome, not overwritten by the no-op request.
      expect(slotRows![0]!.status).toBe("ran");

      // And overall, this agent has exactly one run — no stray second row
      // under a different key by mistake.
      const { count, error: countErr } = await admin
        .from("user_agent_runs")
        .select("id", { count: "exact", head: true })
        .eq("user_agent_id", agentId!);
      expect(countErr).toBeNull();
      expect(count).toBe(1);
    });
  },
);
