import { randomUUID } from "node:crypto";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import { allowsTier2Fixtures } from "@/lib/supabase/project-refs";
import {
  TIER2_FIXTURE_PASSWORD,
  TIER2_FIXTURE_TENANTS,
  loadFixtureEnv,
} from "@/test/tenant-fixtures";
import type { Database } from "@/types/database.types";

// ===========================================================================
// THE GUARANTEE UNDER TEST
// ===========================================================================
//
// `agent_run_claim` (supabase/migrations/20260905045101_agent_run_graph.sql) is
// the ONE way a non-scheduled `user_agent_runs` row comes into existence. Every
// limit that keeps delegation and @mentions from turning into unbounded billed
// runs — ownership, the enabled kill switch, depth (<=1), fan-out (<=3), the
// five-minute mention cooldown and the org's per-user daily cap — is decided
// INSIDE it, under a row lock, because each is a count-then-insert and that is
// not atomic at READ COMMITTED.
//
// `src/lib/agents/run-claim.test.ts` covers the TypeScript wrapper against a
// fake client: it can prove the outcome travels back verbatim, and nothing
// more. The rules themselves are SQL, and a unit test that mocked them would
// only be asserting its own mock. This file is the only place they are
// exercised against a real database.
//
// See `src/lib/agents/user_agents.rls.integration.test.ts` for the full
// rationale on WHY a `*.rls.integration.test.ts` file targets DEV via
// `allowsTier2Fixtures()` rather than the Tier-1 `integrationTargetReady()`
// deny-list.
//
// ===========================================================================
// FOOTPRINT
// ===========================================================================
//
// Three `user_agents` rows on fixture org A (a live one, a second live one for
// the daily-cap probe, and a disabled one) plus one on fixture org B, all with
// `cadence: 'manual'` — a cadence `_personal_agent_sweep` can never fire — and
// fresh `randomUUID()` ids, so nothing here can collide with another suite or
// be picked up by the cron. The delegation cases hang off a PAST `fire_date`,
// deliberately: a child inherits its parent's day, so they cannot consume the
// owner's cap for today. `afterAll` deletes the four agents unconditionally,
// which cascades every run row this file created
// (`user_agent_runs_user_agent_id_fkey ... on delete cascade`).
//
// A PAST `fire_date` does NOT also hold the cooldown off, and assuming it did
// is what broke this file on its first live run. The two limits read DIFFERENT
// clocks: the daily cap counts `fire_date` (a logical day the seed chooses),
// but the cooldown counts `created_at > now() - interval '5 minutes'` (real
// arrival time, which the seed does not choose — it defaults to now()). So a
// row seeded with `fire_date = '2026-01-20'` still lands INSIDE the cooldown
// window, and the very first `claim(agentA, 'mention')` came back
// `refused_cooldown`. `seedRun` therefore backdates `created_at`; see
// SEED_BACKDATE_MS.
//
// ORDERED, not independent: the cooldown case spends one of today's runs and
// the daily-cap case then fills the rest. Vitest runs a file's tests in source
// order, and the comments below say which case depends on which.

loadFixtureEnv();

const [ORG_A, ORG_B] = TIER2_FIXTURE_TENANTS;

/** A past day, so the delegation subtree can never count against today's cap. */
const PAST_DATE = "2026-01-20";

/**
 * How far back `seedRun` dates a row's `created_at`.
 *
 * Every row this file seeds directly is PRE-EXISTING HISTORY — the parent of a
 * delegation subtree, the runs that have already spent today's budget. None of
 * them is an event that just arrived, and only a just-arrived mention should
 * arm the five-minute cooldown. Left at the column default (`now()`), a seeded
 * `trigger: 'mention'` row silently rate-limits the agent it is meant to be
 * background for, and the cooldown then answers ahead of the limit under test.
 *
 * One hour — 12x the window — so the margin cannot be eaten by a slow suite,
 * and small enough that the row still reads as recent history to a human
 * inspecting DEV. It is only ever the ARRIVAL time: `fire_date` (the day the
 * cap counts) is passed explicitly by every caller and is unaffected.
 */
const SEED_BACKDATE_MS = 60 * 60 * 1000;

type Target = { url: string; anonKey: string; serviceRoleKey: string };
type Resolution = { ok: true; target: Target } | { ok: false; reason: string };

function resolveTarget(env: Record<string, string | undefined>): Resolution {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceRoleKey) {
    return {
      ok: false,
      reason:
        "No target: set NEXT_PUBLIC_SUPABASE_URL + " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY.",
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
  return { ok: true, target: { url, anonKey, serviceRoleKey } };
}

const resolution = resolveTarget(process.env);
if (!resolution.ok) {
  console.info(`[agent_run_claim] skipped — ${resolution.reason}`);
}

// `retry: 0` overrides the integration project's `retry: 1` (vitest.config.ts)
// for THIS file only. That retry exists to absorb a one-off cloud blip on a
// stateless suite; these cases are ordered and stateful, and Vitest re-runs a
// failed TEST without re-running `beforeAll`. So a retry replays a case against
// state its own first attempt already wrote: attempt 1 of the cooldown case
// genuinely claims a run, which genuinely arms the cooldown, so attempt 2's
// "first" claim is refused for real. Retrying cannot rescue this file — it can
// only turn one honest failure into a misleading one.
describe.skipIf(!resolution.ok)(
  "agent_run_claim (live DEV, Tier-2 permanent fixture tenants)",
  { retry: 0 },
  () => {
    const target = resolution.ok ? resolution.target : null;
    const tag = randomUUID().slice(0, 8);

    let admin: SupabaseClient<Database>; // service role — seeds and inspects
    let userA: SupabaseClient<Database>; // fixture org A owner
    let userB: SupabaseClient<Database>; // fixture org B owner
    let ownerA = "";
    let agentA = ""; // enabled, org A — the main subject
    let agentA2 = ""; // enabled, org A — no cooldown history, for the cap case
    let agentOff = ""; // disabled, org A
    let agentB = ""; // enabled, org B — owned by somebody else
    let rootRun = ""; // depth 0, PAST_DATE
    let childRun = ""; // depth 1 under rootRun
    let today = ""; // org A's local date

    async function signIn(
      email: string,
      password: string,
    ): Promise<SupabaseClient<Database>> {
      const client = createClient<Database>(target!.url, target!.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInOrThrow(client, { email, password }, email);
      return client;
    }

    async function seedAgent(args: {
      orgId: string;
      ownerId: string;
      handle: string;
      enabled: boolean;
    }): Promise<string> {
      const id = randomUUID();
      const { error } = await admin.from("user_agents").insert({
        id,
        org_id: args.orgId,
        owner_id: args.ownerId,
        name: `claim-probe ${args.handle} ${tag}`,
        template_id: "integration-test",
        instructions: "RLS integration-test fixture agent. Never runs.",
        board_scope: { mode: "all" },
        // 'manual' never fires: `_personal_agent_sweep`'s `case cadence …
        // else false end` refuses it outright.
        cadence: "manual",
        run_at_local_hour: 7,
        enabled: args.enabled,
        handle: `${args.handle}-${tag}`,
      });
      if (error) throw new Error(`seed user_agents failed: ${error.message}`);
      return id;
    }

    /** Insert a run row directly (service role) — the paths under test are the
     *  RPC's refusals, and seeding through it would make the fixture depend on
     *  the very rules being asserted.
     *
     *  Backdates `created_at` by SEED_BACKDATE_MS: a seeded row is history, and
     *  history must not arm the five-minute mention cooldown. Read that comment
     *  before removing this — it is the whole reason the cooldown and daily-cap
     *  cases below can reach the limit they name. */
    async function seedRun(row: {
      agentId: string;
      orgId: string;
      ownerId: string;
      fireDate: string;
      trigger: "mention" | "delegation";
      parentRunId?: string;
      depth?: number;
    }): Promise<string> {
      const { data, error } = await admin
        .from("user_agent_runs")
        .insert({
          user_agent_id: row.agentId,
          org_id: row.orgId,
          owner_id: row.ownerId,
          fire_date: row.fireDate,
          // Arrival time, NOT the logical day — see SEED_BACKDATE_MS.
          created_at: new Date(Date.now() - SEED_BACKDATE_MS).toISOString(),
          // NULL is required for every non-schedule trigger —
          // `user_agent_runs_slot_shape` makes the pairing exact.
          fire_hour: null,
          status: "ran",
          trigger: row.trigger,
          parent_run_id: row.parentRunId ?? null,
          depth: row.depth ?? 0,
        })
        .select("id")
        .single();
      if (error) throw new Error(`seed run failed: ${error.message}`);
      return (data as { id: string }).id;
    }

    async function claim(
      client: SupabaseClient<Database>,
      args: { agentId: string; trigger: string; parentRunId?: string | null },
    ): Promise<{ outcome: string; runId: string | null }> {
      const { data, error } = await client.rpc("agent_run_claim", {
        p_agent_id: args.agentId,
        p_trigger: args.trigger,
        ...(args.parentRunId === undefined
          ? {}
          : { p_parent_run_id: args.parentRunId as string }),
      });
      if (error) throw new Error(`agent_run_claim: ${error.message}`);
      const row = (data ?? [])[0];
      return { outcome: row?.outcome ?? "no_row", runId: row?.run_id ?? null };
    }

    beforeAll(async () => {
      admin = createClient<Database>(target!.url, target!.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      userA = await signIn(ORG_A.email, TIER2_FIXTURE_PASSWORD);
      userB = await signIn(ORG_B.email, TIER2_FIXTURE_PASSWORD);

      const aId = (await userA.auth.getUser()).data.user?.id;
      const bId = (await userB.auth.getUser()).data.user?.id;
      if (!aId || !bId) throw new Error("a fixture signed in with no user id");
      ownerA = aId;

      // The cap is counted on the ORG's local date, so the probe must ask the
      // same question the function does.
      const { data: org } = await admin
        .from("organizations")
        .select("timezone")
        .eq("id", ORG_A.orgId)
        .single();
      today = new Intl.DateTimeFormat("en-CA", {
        timeZone:
          (org as { timezone: string | null } | null)?.timezone ?? "UTC",
      }).format(new Date());

      agentA = await seedAgent({
        orgId: ORG_A.orgId,
        ownerId: aId,
        handle: "claim-a",
        enabled: true,
      });
      agentA2 = await seedAgent({
        orgId: ORG_A.orgId,
        ownerId: aId,
        handle: "claim-a2",
        enabled: true,
      });
      agentOff = await seedAgent({
        orgId: ORG_A.orgId,
        ownerId: aId,
        handle: "claim-off",
        enabled: false,
      });
      agentB = await seedAgent({
        orgId: ORG_B.orgId,
        ownerId: bId,
        handle: "claim-b",
        enabled: true,
      });

      rootRun = await seedRun({
        agentId: agentA,
        orgId: ORG_A.orgId,
        ownerId: aId,
        fireDate: PAST_DATE,
        trigger: "mention",
      });
      childRun = await seedRun({
        agentId: agentA,
        orgId: ORG_A.orgId,
        ownerId: aId,
        fireDate: PAST_DATE,
        trigger: "delegation",
        parentRunId: rootRun,
        depth: 1,
      });
    }, 60_000);

    afterAll(async () => {
      // Unconditional, best-effort. Deleting the agents cascades every run row.
      for (const id of [agentA, agentA2, agentOff, agentB].filter(Boolean)) {
        const { error } = await admin.from("user_agents").delete().eq("id", id);
        if (error) {
          console.warn(
            `[agent_run_claim] cleanup failed for agent ${id}: ` +
              `${error.message} — delete it by hand from DEV.`,
          );
        }
      }
    }, 30_000);

    // ── The sweep's trigger is not claimable here ────────────────────────
    it("refuses 'schedule' — the sweep owns that path", async () => {
      const r = await claim(userA, { agentId: agentA, trigger: "schedule" });
      expect(r.outcome).toBe("refused_bad_trigger");
      expect(r.runId).toBeNull();
    });

    // ── Ownership: SECURITY DEFINER sees every agent, so it re-proves it ──
    it("refuses a claim for another user's agent", async () => {
      const r = await claim(userA, { agentId: agentB, trigger: "mention" });
      expect(r.outcome).toBe("refused_not_owner");
      expect(r.runId).toBeNull();
    });

    it("refuses a claim for an agent that does not exist", async () => {
      const r = await claim(userA, {
        agentId: randomUUID(),
        trigger: "mention",
      });
      expect(r.outcome).toBe("refused_not_owner");
    });

    // ── The kill switch ──────────────────────────────────────────────────
    it("refuses a disabled agent", async () => {
      const r = await claim(userA, { agentId: agentOff, trigger: "mention" });
      expect(r.outcome).toBe("refused_disabled");
      expect(r.runId).toBeNull();
    });

    // ── Fan-out: three children under one parent, never a fourth ─────────
    // Uses the PAST_DATE parent, so these four claims cost today's cap
    // nothing — a child inherits its parent's day.
    it("refuses a fourth sibling under one parent", async () => {
      // One child already exists from the seed (childRun); two more fit.
      for (const n of [2, 3]) {
        const r = await claim(userA, {
          agentId: agentA,
          trigger: "delegation",
          parentRunId: rootRun,
        });
        expect(r.outcome, `sibling ${n} must be claimed`).toBe("claimed");
        expect(r.runId).toBeTruthy();
      }
      const fourth = await claim(userA, {
        agentId: agentA,
        trigger: "delegation",
        parentRunId: rootRun,
      });
      expect(fourth.outcome).toBe("refused_fanout");
      expect(fourth.runId).toBeNull();
    });

    // ── Depth: a child may not delegate again ────────────────────────────
    it("refuses a delegation whose parent is already depth 1", async () => {
      const r = await claim(userA, {
        agentId: agentA,
        trigger: "delegation",
        parentRunId: childRun,
      });
      expect(r.outcome).toBe("refused_depth");
      expect(r.runId).toBeNull();
    });

    it("refuses a delegation with no parent at all", async () => {
      const r = await claim(userA, {
        agentId: agentA,
        trigger: "delegation",
        parentRunId: null,
      });
      expect(r.outcome).toBe("refused_depth");
    });

    it("refuses a mention that names a parent", async () => {
      const r = await claim(userA, {
        agentId: agentA,
        trigger: "mention",
        parentRunId: rootRun,
      });
      expect(r.outcome).toBe("refused_depth");
    });

    // ── Cooldown ─────────────────────────────────────────────────────────
    // SPENDS ONE of today's runs — the cap case below accounts for it.
    //
    // The cooldown is armed by the FIRST CLAIM, not by the fixture: agentA's
    // seeded mention row (`rootRun`) is backdated out of the window, so the
    // window opening is the RPC's own insert. That is what makes the second
    // claim's refusal evidence about `agent_run_claim` rather than about the
    // seed.
    it("claims a first mention run, then refuses a second inside the cooldown", async () => {
      const first = await claim(userA, {
        agentId: agentA,
        trigger: "mention",
      });
      expect(first.outcome).toBe("claimed");
      expect(first.runId).toBeTruthy();

      // The claim placeholder is what makes the row real: it exists, consumes
      // budget, and reads as a failure until `finalizeRun` rewrites it.
      const { data: row } = await admin
        .from("user_agent_runs")
        .select("status, error, depth, trigger, fire_hour, parent_run_id")
        .eq("id", first.runId!)
        .single();
      expect(row).toMatchObject({
        status: "error",
        error: "claimed; result not yet recorded",
        depth: 0,
        trigger: "mention",
        fire_hour: null,
        parent_run_id: null,
      });

      const second = await claim(userA, {
        agentId: agentA,
        trigger: "mention",
      });
      expect(second.outcome).toBe("refused_cooldown");
      expect(second.runId).toBeNull();
    });

    // ── The org's per-user daily cap ─────────────────────────────────────
    // Counted over ROOT runs only, per owner + org + local day. Runs LAST: it
    // deliberately exhausts today's budget for fixture A.
    it("refuses a mention run at the daily cap", async () => {
      const { data: settings } = await admin
        .from("org_ai_settings")
        .select("max_agent_runs_per_user_per_day")
        .eq("org_id", ORG_A.orgId)
        .maybeSingle();
      const cap =
        (settings as { max_agent_runs_per_user_per_day: number } | null)
          ?.max_agent_runs_per_user_per_day ?? 3;

      const { count } = await admin
        .from("user_agent_runs")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerA)
        .eq("org_id", ORG_A.orgId)
        .eq("fire_date", today)
        .is("parent_run_id", null);

      // Fill today to exactly the cap. Hung off THIS suite's agent, so the
      // afterAll cascade takes them with it. `seedRun` backdates `created_at`,
      // which is load-bearing here: these are `trigger: 'mention'` rows on the
      // very agent about to be probed, so at the column default they would arm
      // agentA2's cooldown and the cap would never be reached.
      for (let n = count ?? 0; n < cap; n++) {
        await seedRun({
          agentId: agentA2,
          orgId: ORG_A.orgId,
          ownerId: ownerA,
          fireDate: today,
          trigger: "mention",
        });
      }

      // The premise, checked rather than assumed: the assertion below only
      // means "the cap refuses" if today is actually AT the cap. Counted the
      // way the function counts it — root runs, this owner, this org, today.
      const { count: filled } = await admin
        .from("user_agent_runs")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerA)
        .eq("org_id", ORG_A.orgId)
        .eq("fire_date", today)
        .is("parent_run_id", null);
      expect(filled ?? 0).toBeGreaterThanOrEqual(cap);

      // agentA2, not agentA: the cooldown is per AGENT and would otherwise be
      // the refusal that answered first, proving nothing about the cap.
      const r = await claim(userA, { agentId: agentA2, trigger: "mention" });
      expect(r.outcome).toBe("refused_daily_cap");
      expect(r.runId).toBeNull();
    });
  },
);
