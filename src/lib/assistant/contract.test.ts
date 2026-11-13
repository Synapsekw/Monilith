import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { executeAgentTool } from "@/test/agent-tool-exec";
import { parseToolTrace } from "@/lib/ai/ask/tool-trace";
import { findDescriptor } from "./catalog";
import type { StagedCall } from "./staged";
import { buildAssistantTools } from "./tools";

// Cross-task contract: what the tool set stages (Task 3) must survive the
// JSON round-trip through `ai_messages.tool_trace` (route), parse back through
// `parseToolTrace` (reload + Apply) and still validate against the
// descriptor's own schema (what `applyBatch` checks before invoking).

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM = "11111111-1111-4111-8111-111111111111";
const BOARD = "22222222-2222-4222-8222-222222222222";

function stageAll() {
  const staged: StagedCall[] = [];
  const tools = buildAssistantTools({
    ctx: { getClient: vi.fn(), actorId: "u-1" } as never,
    // Board lookups fail in a unit test; staging must survive that.
    client: {
      from: () => {
        throw new Error("no db in unit tests");
      },
    } as never,
    orgId: ORG,
    stage: (c) => (staged.push(c), true),
  });
  return { staged, tools };
}

describe("staged call contract: stage → store → reload → apply-validate", () => {
  const cases = [
    { tool: "update_item", input: { itemId: ITEM, name: "Press kit" } },
    {
      tool: "manage_board",
      input: { action: "rename", boardId: BOARD, name: "Roadmap 2027" },
    },
  ];

  it("round-trips real catalog writes unchanged and valid", async () => {
    const { staged, tools } = stageAll();
    for (const c of cases)
      expect(await executeAgentTool(tools, c.tool, c.input)).toMatchObject({
        staged: true,
      });
    expect(staged).toHaveLength(cases.length);

    const stored: unknown = JSON.parse(JSON.stringify({ stagedCalls: staged }));
    const trace = parseToolTrace(stored);
    expect(trace).not.toBeNull();
    expect(trace!.stagedCalls).toEqual(staged);

    for (const call of trace!.stagedCalls!) {
      const d = findDescriptor(call.tool);
      expect(d).toBeDefined();
      expect(z.object(d!.inputSchema).safeParse(call.input).success).toBe(true);
    }
  });

  it("keeps the active org on an org-scoped write through the round-trip", async () => {
    const { staged, tools } = stageAll();
    await executeAgentTool(tools, "manage_goal", {
      action: "update",
      goalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      name: "Ship v2",
    });
    const trace = parseToolTrace(
      JSON.parse(JSON.stringify({ stagedCalls: staged })),
    );
    const call = trace!.stagedCalls![0]!;
    expect(call.input.orgId).toBe(ORG);
    expect(
      z.object(findDescriptor("manage_goal")!.inputSchema).safeParse(call.input)
        .success,
    ).toBe(true);
  });
});
