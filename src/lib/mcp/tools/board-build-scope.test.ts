import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { OUT_OF_SCOPE_CREATE_ERROR, buildAgentTools } from "@/lib/agents/tools";
import { executeAgentTool } from "@/test/agent-tool-exec";

/**
 * HALF TWO of the end-to-end board-build acceptance test. Its sibling is
 * `board-build.rls.integration.test.ts`, which builds a whole board through
 * the tool surface — board, columns, groups, items, view — in six calls.
 *
 * The pair is split ON PURPOSE, by what each half needs to run:
 *
 *   - The sibling is genuinely DB-backed. It needs a PROVISIONED test project
 *     (`.env.test` + `PULSE_TEST_DB=1`; DEV and PROD are both deny-listed in
 *     `integration-env.ts` so its destructive teardown can never touch real
 *     user data), so it SKIPS on a normal checkout and its `.integration`
 *     filename correctly keeps it out of `pnpm test`.
 *   - This half needs NO database at all — the refusal below happens in the
 *     `buildAgentTools` wrapper before any query — so it lives in a plain
 *     `.test.ts` and runs in the DEFAULT gate, where it will actually catch a
 *     regression in `refusesUnscopedCreate` (`@/lib/agents/board-scope-guard`).
 *
 * Same acceptance test, two files, because a skipped assertion guards nothing.
 */
describe("MCP write surface: a board-scoped agent cannot create a board", () => {
  const SCOPED_BOARD = "11111111-1111-4111-8111-111111111111";
  const WORKSPACE = "22222222-2222-4222-8222-222222222222";

  it("refuses the create, and never reaches the database to do it", async () => {
    let clientTouched = false;
    let getClientCalled = false;

    // Any property access is a query attempt. The flag records it; the throw
    // makes a regression fail loudly rather than silently pass a later
    // assertion.
    const noClient = new Proxy(
      {},
      {
        get() {
          clientTouched = true;
          throw new Error("must not query");
        },
      },
    ) as SupabaseClient<Database>;

    const tools = buildAgentTools({
      ctx: {
        getClient: async () => {
          getClientCalled = true;
          throw new Error("must not query");
        },
        actorId: "00000000-0000-4000-8000-000000000001",
      },
      client: noClient,
      scope: { mode: "list", boardIds: [SCOPED_BOARD] },
    });

    const result = await executeAgentTool(tools, "manage_board", {
      action: "create",
      workspaceId: WORKSPACE,
      name: "Sneaky",
    });

    // The exact sentence the owner sees: it names the fix, so the model
    // reports it instead of retrying the call forever.
    expect(JSON.stringify(result)).toContain(
      "This agent is scoped to specific boards, so it cannot create new ones.",
    );
    expect(result).toEqual({ error: OUT_OF_SCOPE_CREATE_ERROR });

    // The refusal PRECEDES any lookup. If it did not, a narrowed agent could
    // still probe for the existence of ids it may not see.
    expect(clientTouched).toBe(false);
    expect(getClientCalled).toBe(false);
  });

  it("still allows the same create when the agent is scoped to all boards", async () => {
    // Anti-vacuity: the refusal above must come from the SCOPE, not from a
    // tool that refuses every create. With `mode: "all"` the wrapper lets the
    // call through to the handler, which then fails on the injected client —
    // a different failure, and that difference is the point.
    const tools = buildAgentTools({
      ctx: {
        getClient: async () => {
          throw new Error("reached the handler");
        },
        actorId: "00000000-0000-4000-8000-000000000001",
      },
      client: {} as SupabaseClient<Database>,
      scope: { mode: "all" },
    });

    const result = await executeAgentTool(tools, "manage_board", {
      action: "create",
      workspaceId: WORKSPACE,
      name: "Allowed",
    });

    expect(result).toEqual({ error: "reached the handler" });
  });
});
