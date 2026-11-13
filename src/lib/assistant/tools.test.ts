import { describe, it, expect, vi } from "vitest";
import * as z from "zod";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import { executeAgentTool } from "@/test/agent-tool-exec";
import type { StagedCall } from "./staged";
import {
  buildAssistantTools,
  ORG_MISMATCH_ERROR,
  STAGE_INVALID_ERROR,
} from "./tools";

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
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const client = {} as never;

describe("buildAssistantTools", () => {
  it("runs a read tool and returns its text", async () => {
    const read = descriptor({ name: "read_it" });
    const stage = vi.fn(() => true);
    const tools = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
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
      orgId: ORG,
      stage: (c) => (staged.push(c), true),
      descriptors: [write],
    });
    const out = await executeAgentTool(tools, "update_item", { id: "i-1" });
    expect(write.invoke).not.toHaveBeenCalled();
    expect(out).toMatchObject({ staged: true });
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({
      // A fresh id, never the provider's tool call id ("test-update_item").
      id: expect.stringMatching(UUID),
      tool: "update_item",
      input: { id: "i-1" },
      destructive: false,
      boardId: null,
    });
    expect(staged[0]!.summary.length).toBeGreaterThan(0);
  });

  it("refuses a goal create without invoking or staging", async () => {
    const goal = descriptor({
      name: "manage_goal",
      capability: { create: "goal.write" } as never,
    });
    const stage = vi.fn(() => true);
    const tools = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
      stage,
      descriptors: [goal],
    });
    const out = await executeAgentTool(tools, "manage_goal", {
      action: "create",
    });
    expect(out).toEqual({
      error:
        "Creating goals from the assistant isn't available yet. Create it from the Goals page.",
    });
    expect(goal.invoke).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
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
      orgId: ORG,
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
      orgId: ORG,
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
      orgId: ORG,
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
      orgId: ORG,
      stage: () => true,
      descriptors: [read],
    });
    expect(await executeAgentTool(tools, "read_it", {})).toEqual({
      error: "boom",
    });
  });
});

describe("buildAssistantTools · staged labels", () => {
  const write = () =>
    descriptor({ name: "update_item", capability: "board.write" });

  it("labels a staged call with describe when it returns a string", async () => {
    const staged: StagedCall[] = [];
    const describe = vi.fn(() => 'Press kit: set Status to "Done"');
    const tools = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
      stage: (c) => (staged.push(c), true),
      descriptors: [write()],
      describe,
    });
    const out = await executeAgentTool(tools, "update_item", { id: "i-1" });
    // It describes the exact input that is stored.
    expect(describe).toHaveBeenCalledWith("update_item", { id: "i-1" });
    expect(staged[0]!.summary).toBe('Press kit: set Status to "Done"');
    expect(out).toMatchObject({ summary: 'Press kit: set Status to "Done"' });
  });

  it("falls back to the generic summary when describe returns null or throws", async () => {
    const staged: StagedCall[] = [];
    const generic = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
      stage: (c) => (staged.push(c), true),
      descriptors: [write()],
    });
    await executeAgentTool(generic, "update_item", { id: "i-1" });
    for (const describe of [
      vi.fn(() => null),
      vi.fn(() => {
        throw new Error("boom");
      }),
    ]) {
      const tools = buildAssistantTools({
        ctx,
        client,
        orgId: ORG,
        stage: (c) => (staged.push(c), true),
        descriptors: [write()],
        describe,
      });
      await executeAgentTool(tools, "update_item", { id: "i-1" });
      expect(describe).toHaveBeenCalledTimes(1);
    }
    expect(staged).toHaveLength(3);
    expect(staged[1]!.summary).toBe(staged[0]!.summary);
    expect(staged[2]!.summary).toBe(staged[0]!.summary);
  });
});

describe("buildAssistantTools · staged call validation", () => {
  it("gives every staged call its own id, even when the provider repeats one", async () => {
    const write = descriptor({
      name: "update_item",
      capability: "board.write",
    });
    const staged: StagedCall[] = [];
    const tools = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
      stage: (c) => (staged.push(c), true),
      descriptors: [write],
    });
    // executeAgentTool always passes the same toolCallId for a tool name.
    await executeAgentTool(tools, "update_item", { id: "i-1" });
    await executeAgentTool(tools, "update_item", { id: "i-2" });
    expect(staged).toHaveLength(2);
    expect(staged[0]!.id).toMatch(UUID);
    expect(staged[1]!.id).toMatch(UUID);
    expect(staged[0]!.id).not.toBe(staged[1]!.id);
  });

  it("refuses to stage a call the stored trace would not parse back", async () => {
    // A boardId-scoped tool whose boardId is not a uuid: the staged row's
    // `boardId` would fail `stagedCallSchema` on reload.
    const write = descriptor({
      name: "update_board",
      capability: "board.write",
      scope: "boardId",
      inputSchema: { boardId: z.string() },
    });
    const stage = vi.fn(() => true);
    const tools = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
      stage,
      descriptors: [write],
    });
    const out = await executeAgentTool(tools, "update_board", {
      boardId: "not-a-uuid",
    });
    expect(out).toEqual({ error: STAGE_INVALID_ERROR });
    expect(stage).not.toHaveBeenCalled();
    expect(write.invoke).not.toHaveBeenCalled();
  });
});

describe("buildAssistantTools · pinned to the active org", () => {
  const orgScoped = (over: Partial<ToolDescriptor>) =>
    descriptor({ inputSchema: { orgId: z.string().optional() }, ...over });

  it("fills in the active org for a read that omits it", async () => {
    const read = orgScoped({ name: "list_goals" });
    const tools = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
      stage: () => true,
      descriptors: [read],
    });
    await executeAgentTool(tools, "list_goals", {});
    expect(read.invoke).toHaveBeenCalledWith(ctx, { orgId: ORG });
  });

  it("refuses a read for another org without invoking it", async () => {
    const read = orgScoped({ name: "list_goals" });
    const tools = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
      stage: () => true,
      descriptors: [read],
    });
    expect(
      await executeAgentTool(tools, "list_goals", { orgId: OTHER_ORG }),
    ).toEqual({ error: ORG_MISMATCH_ERROR });
    expect(read.invoke).not.toHaveBeenCalled();
  });

  it("passes a read that names the active org through unchanged", async () => {
    const read = orgScoped({ name: "list_goals" });
    const tools = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
      stage: () => true,
      descriptors: [read],
    });
    await executeAgentTool(tools, "list_goals", { orgId: ORG });
    expect(read.invoke).toHaveBeenCalledWith(ctx, { orgId: ORG });
  });

  it("stores the injected org on a staged write, so Apply uses the same org", async () => {
    const write = orgScoped({
      name: "manage_goal",
      capability: { create: "board.write", update: "board.write" },
      inputSchema: { action: z.string(), orgId: z.string().optional() },
    });
    const staged: StagedCall[] = [];
    const tools = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
      stage: (c) => (staged.push(c), true),
      descriptors: [write],
    });
    await executeAgentTool(tools, "manage_goal", { action: "update" });
    expect(staged[0]!.input).toEqual({ action: "update", orgId: ORG });
  });

  it("refuses to stage a write for another org", async () => {
    const write = orgScoped({ name: "log_time", capability: "board.write" });
    const stage = vi.fn(() => true);
    const tools = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
      stage,
      descriptors: [write],
    });
    expect(
      await executeAgentTool(tools, "log_time", { orgId: OTHER_ORG }),
    ).toEqual({ error: ORG_MISMATCH_ERROR });
    expect(stage).not.toHaveBeenCalled();
    expect(write.invoke).not.toHaveBeenCalled();
  });

  it("leaves a tool without an orgId input alone", async () => {
    const read = descriptor({ name: "read_it" });
    const tools = buildAssistantTools({
      ctx,
      client,
      orgId: ORG,
      stage: () => true,
      descriptors: [read],
    });
    await executeAgentTool(tools, "read_it", { id: "x" });
    expect(read.invoke).toHaveBeenCalledWith(ctx, { id: "x" });
  });
});
