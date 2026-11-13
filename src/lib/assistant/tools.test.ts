import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import { executeAgentTool } from "@/test/agent-tool-exec";
import type { StagedCall } from "./staged";
import { buildAssistantTools } from "./tools";

function descriptor(over: Partial<ToolDescriptor>): ToolDescriptor {
  return {
    name: "t",
    title: "T",
    description: "d",
    inputSchema: { id: z.string().optional() },
    capability: null,
    scope: "none",
    invoke: vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    })),
    ...over,
  };
}

const ctx = { getClient: vi.fn(), actorId: "u-1" } as never;
const client = {} as never;

describe("buildAssistantTools", () => {
  it("runs a read tool and returns its text", async () => {
    const read = descriptor({ name: "read_it" });
    const stage = vi.fn(() => true);
    const tools = buildAssistantTools({
      ctx,
      client,
      stage,
      descriptors: [read],
    });
    expect(await executeAgentTool(tools, "read_it", {})).toBe("ok");
    expect(read.invoke).toHaveBeenCalledTimes(1);
    expect(stage).not.toHaveBeenCalled();
  });

  it("stages a write tool and never invokes it", async () => {
    const write = descriptor({
      name: "update_item",
      capability: "board.write",
    });
    const staged: StagedCall[] = [];
    const tools = buildAssistantTools({
      ctx,
      client,
      stage: (c) => (staged.push(c), true),
      descriptors: [write],
    });
    const out = await executeAgentTool(tools, "update_item", { id: "i-1" });
    expect(write.invoke).not.toHaveBeenCalled();
    expect(out).toMatchObject({ staged: true });
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({
      id: "test-update_item",
      tool: "update_item",
      input: { id: "i-1" },
      destructive: false,
      boardId: null,
    });
    expect(staged[0]!.summary.length).toBeGreaterThan(0);
  });

  it("marks a board.destroy action as destructive", async () => {
    const manage = descriptor({
      name: "manage_board",
      capability: { rename: "board.structure", archive: "board.destroy" },
    });
    const staged: StagedCall[] = [];
    const tools = buildAssistantTools({
      ctx,
      client,
      stage: (c) => (staged.push(c), true),
      descriptors: [manage],
    });
    await executeAgentTool(tools, "manage_board", { action: "archive" });
    expect(staged[0]!.destructive).toBe(true);
  });

  it("returns an error result when the batch is full", async () => {
    const write = descriptor({
      name: "update_item",
      capability: "board.write",
    });
    const tools = buildAssistantTools({
      ctx,
      client,
      stage: () => false,
      descriptors: [write],
    });
    expect(await executeAgentTool(tools, "update_item", {})).toMatchObject({
      error: expect.stringContaining("50"),
    });
  });

  it("turns a read tool's isError result into an error object", async () => {
    const read = descriptor({
      name: "read_it",
      invoke: vi.fn(async () => ({
        content: [{ type: "text" as const, text: "Board not found." }],
        isError: true,
      })),
    });
    const tools = buildAssistantTools({
      ctx,
      client,
      stage: () => true,
      descriptors: [read],
    });
    expect(await executeAgentTool(tools, "read_it", {})).toEqual({
      error: "Board not found.",
    });
  });

  it("turns a thrown read into an error object", async () => {
    const read = descriptor({
      name: "read_it",
      invoke: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const tools = buildAssistantTools({
      ctx,
      client,
      stage: () => true,
      descriptors: [read],
    });
    expect(await executeAgentTool(tools, "read_it", {})).toEqual({
      error: "boom",
    });
  });
});
