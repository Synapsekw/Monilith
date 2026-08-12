import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ToolSet } from "ai";
import { signInOrThrow } from "@/test/integration-auth";
import { executeAgentTool } from "@/test/agent-tool-exec";
import { allowsTier2Fixtures } from "@/lib/supabase/project-refs";
import {
  TIER2_FIXTURE_PASSWORD,
  TIER2_FIXTURE_TENANTS,
  loadFixtureEnv,
} from "@/test/tenant-fixtures";
import { AGENT_CAPABILITIES } from "@/lib/agents/capabilities";
import { DEFAULT_ORG_AI_SETTINGS } from "@/lib/ai/org-settings";
import type { Database } from "@/types/database.types";
import { buildAgentTools } from "./tools";
import { makeGrantGate } from "./grant-gate";
import { isBoardInScope } from "./board-scope-guard";

// ===========================================================================
// THE GUARANTEE UNDER TEST
// ===========================================================================
//
// An agent reads and writes through a client authenticated as its OWNER, so a
// board the owner cannot reach is a board the agent cannot reach — no matter
// what its capabilities or its board scope say.
//
// This suite is deliberately rigged so that NEITHER of this task's two gates
// can take the credit:
//
//   * every capability is GRANTED and the org ceiling is the full vocabulary,
//     so `makeGrantGate` approves every call (asserted below, not assumed);
//   * `board_scope` is `{ mode: "all" }`, so `isBoardInScope` admits every
//     board (also asserted).
//
// What is left is RLS. If a probe below ever passes because a grant or a scope
// refused the call, the fixture is wrong and the real boundary is untested.
//
// ===========================================================================
// WHY THESE FIXTURES, AND WHY NO MUTATION
// ===========================================================================
//
// Like its `user_agents` / `user_agent_runs` siblings this file targets the DEV
// project via `allowsTier2Fixtures()` rather than the Tier-1 `PULSE_TEST_DB`
// deny-list: the two permanent fixture tenants are seeded on DEV and nowhere
// else, and they are the only pair of real, mutually-invisible accounts we can
// sign in as. `pnpm test` never runs this project (see vitest.config.ts).
//
// The task brief phrased the case as "the owner LOST access to the board". The
// permanent fixtures must never be mutated (their disjointness is the premise
// of the whole Tier-2 corpus, and revoking a membership on DEV touches live
// user-facing data), so the equivalent END STATE is used instead: fixture A's
// owner has no membership in fixture B's org, so B's board is exactly as
// unreachable to A as a revoked board would be. The agent is configured with
// `board_scope: all` and every capability, which is the "configured before the
// access was lost" half of the scenario.
//
// ===========================================================================
// FOOTPRINT
// ===========================================================================
//
// NONE. This suite signs in with the publishable anon key, holds no
// service-role key, and provisions nothing. Every probe is a read except the
// one refused write (`create_item` into the foreign org's group), which cannot
// land: `public.create_item` is SECURITY DEFINER but raises
// `not a member of this organization` before it inserts. If that ever DID
// write, the assertion fails loudly — and that failure is the emergency this
// file exists to surface.

loadFixtureEnv();

const [ORG_A, ORG_B] = TIER2_FIXTURE_TENANTS;

type Target = { url: string; anonKey: string };
type Resolution = { ok: true; target: Target } | { ok: false; reason: string };

function resolveTarget(env: Record<string, string | undefined>): Resolution {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return {
      ok: false,
      reason:
        "No target: set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.",
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
  return { ok: true, target: { url, anonKey } };
}

const resolution = resolveTarget(process.env);
if (!resolution.ok) {
  console.info(`[agent tools RLS] skipped — ${resolution.reason}`);
}

describe.skipIf(!resolution.ok)(
  "agent tool set RLS (live DEV, Tier-2 permanent fixture tenants)",
  () => {
    const target = resolution.ok ? resolution.target : null;

    let ownerClient: SupabaseClient<Database>;
    let tools: ToolSet;

    // Every capability, on both keys of the two-key gate. The ceiling is
    // SPREAD, never used by reference: `DEFAULT_ORG_AI_SETTINGS` is a module
    // singleton that `readOrgAiSettings` hands back as-is to any org with no
    // settings row, so mutating its array in place would corrupt the default
    // process-wide.
    const granted = [...AGENT_CAPABILITIES];
    const ceiling = [...DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling];

    beforeAll(async () => {
      ownerClient = createClient<Database>(target!.url, target!.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInOrThrow(
        ownerClient,
        { email: ORG_A.email, password: TIER2_FIXTURE_PASSWORD },
        ORG_A.email,
      );
      const ownerId = (await ownerClient.auth.getUser()).data.user?.id;
      if (!ownerId) throw new Error("fixture A signed in but has no user id");

      tools = buildAgentTools({
        ctx: { getClient: async () => ownerClient, actorId: ownerId },
        scope: { mode: "all" },
        client: ownerClient,
      });
    }, 60_000);

    // ── The rigging: prove neither gate is what refuses ──────────────────

    it("has both gates wide open for these probes", async () => {
      const gate = makeGrantGate({ granted, ceiling, onPropose: () => {} });
      // A read tool (no capability) and the write tool probed below.
      expect(await gate(callOf("list_items"))).toBeUndefined();
      expect(await gate(callOf("create_item"))).toBeUndefined();
      // Board scope is `all`, so the foreign board is admitted by the guard.
      expect(isBoardInScope({ mode: "all" }, ORG_B.boardId)).toBe(true);
    });

    // ── Positive control: the tool set actually works ────────────────────
    //
    // Without this, every "reads nothing" below would also pass if the tools
    // were broken, unauthenticated, or pointed at the wrong project.

    it("reads the owner's OWN board through the same tool set", async () => {
      const result = await executeAgentTool(tools, "get_board", {
        boardId: ORG_A.boardId,
      });
      expect(JSON.stringify(result)).toContain(ORG_A.boardName);
    });

    // ── The guarantee ────────────────────────────────────────────────────

    it("reads nothing from a board its owner cannot access", async () => {
      const result = await executeAgentTool(tools, "get_board", {
        boardId: ORG_B.boardId,
      });
      const text = JSON.stringify(result);
      expect(text).not.toContain(ORG_B.boardName);
      expect(text).not.toContain("Beta Fixture Group");
      expect(text).toContain("Board not found.");
    });

    it("lists no items from that board", async () => {
      const result = await executeAgentTool(tools, "list_items", {
        boardId: ORG_B.boardId,
      });
      const text = JSON.stringify(result);
      expect(text).not.toContain(ORG_B.boardName);
      expect(text).not.toContain(ORG_B.groupId);
    });

    it("omits the board from list_boards entirely", async () => {
      const result = await executeAgentTool(tools, "list_boards", {});
      const text = JSON.stringify(result);
      expect(text, "own board present").toContain(ORG_A.boardId);
      expect(text, "foreign board absent").not.toContain(ORG_B.boardId);
      expect(text).not.toContain(ORG_B.boardName);
    });

    it("finds nothing on that board through search_items", async () => {
      const result = await executeAgentTool(tools, "search_items", {
        boardId: ORG_B.boardId,
        query: "Beta",
      });
      expect(JSON.stringify(result)).not.toContain(ORG_B.boardName);
    });

    // ── The same boundary on the WRITE path ──────────────────────────────
    //
    // `board.write` is granted and the scope admits the board, so the only
    // thing that can refuse this is the owner's own authorization.

    it("cannot write into that board either, with board.write granted", async () => {
      const result = await executeAgentTool(tools, "create_item", {
        groupId: ORG_B.groupId,
        name: "agent RLS probe — must never exist",
      });
      const text = JSON.stringify(result);
      expect(text).toMatch(
        /not a member of this organization|group not found/i,
      );
      expect(text, "no item id came back").not.toMatch(/"item"\s*:/);
    });
  },
);

/** The one field `makeGrantGate` reads off a tool call. */
function callOf(toolName: string) {
  return { toolCall: { toolName, toolCallId: "probe", input: {} } };
}
