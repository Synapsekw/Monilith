import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/catalog";
import type {
  ToolDescriptor,
  ToolInvokeContext,
} from "@/lib/mcp/tools/descriptor";
import { executeAgentTool } from "@/test/agent-tool-exec";
import { OUT_OF_SCOPE_ERROR, buildAgentTools } from "./tools";

const BOARD_1 = "11111111-1111-4111-8111-111111111111";
const BOARD_2 = "22222222-2222-4222-8222-222222222222";

/** No agent tool may reach the database through anything but the injected
 *  owner client; a proxy that throws proves the scope guard for `boardId`
 *  tools costs zero queries. */
const noClient = new Proxy(
  {},
  {
    get() {
      throw new Error("the tool wrapper must not query for a boardId scope");
    },
  },
) as SupabaseClient<Database>;

const ctx: ToolInvokeContext = {
  getClient: async () => noClient,
  actorId: "00000000-0000-4000-8000-000000000001",
};

function probe(
  invoke: ToolDescriptor["invoke"],
  scope: ToolDescriptor["scope"] = "boardId",
): ToolDescriptor {
  return {
    name: "probe_tool",
    title: "Probe",
    description: "A probe.",
    inputSchema: { boardId: z.string().uuid() },
    capability: null,
    scope,
    invoke,
  };
}

describe("buildAgentTools", () => {
  it("offers every catalog tool except the agent-excluded one", () => {
    const tools = buildAgentTools({
      ctx,
      scope: { mode: "all" },
      client: noClient,
    });
    const names = Object.keys(tools).sort();
    expect(names).not.toContain("create_attachment_upload");
    expect(names).toEqual(
      ALL_TOOL_DESCRIPTORS.filter((d) => !d.agentExcluded)
        .map((d) => d.name)
        .sort(),
    );
  });

  // The whole design rests on this: an ungranted write tool is STILL in the
  // set the model sees. Hiding it (`activeTools`) would make the proposal path
  // unreachable, because a model that cannot see a tool never proposes it.
  it("includes the write tools regardless of any grant", () => {
    const tools = buildAgentTools({
      ctx,
      scope: { mode: "all" },
      client: noClient,
    });
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "create_item",
        "update_item",
        "attach_file",
        "log_time_allocation",
      ]),
    );
  });

  it("appends extra descriptors", () => {
    const tools = buildAgentTools({
      ctx,
      scope: { mode: "all" },
      client: noClient,
      extra: [probe(async () => ({ content: [{ type: "text", text: "x" }] }))],
    });
    expect(Object.keys(tools)).toContain("probe_tool");
  });

  it("refuses an out-of-scope board WITHOUT invoking the handler", async () => {
    const invoke = vi.fn();
    const tools = buildAgentTools({
      ctx,
      scope: { mode: "list", boardIds: [BOARD_1] },
      client: noClient,
      extra: [probe(invoke)],
    });
    await expect(
      executeAgentTool(tools, "probe_tool", { boardId: BOARD_2 }),
    ).resolves.toEqual({ error: OUT_OF_SCOPE_ERROR });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes the handler exactly once for an in-scope board", async () => {
    const invoke = vi.fn(async () => ({
      content: [
        { type: "text" as const, text: "line one" },
        { type: "text" as const, text: "line two" },
      ],
    }));
    const tools = buildAgentTools({
      ctx,
      scope: { mode: "list", boardIds: [BOARD_1] },
      client: noClient,
      extra: [probe(invoke)],
    });
    await expect(
      executeAgentTool(tools, "probe_tool", { boardId: BOARD_1 }),
    ).resolves.toBe("line one\nline two");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(ctx, { boardId: BOARD_1 });
  });

  it("admits every board under a scope of `all`", async () => {
    const invoke = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    const tools = buildAgentTools({
      ctx,
      scope: { mode: "all" },
      client: noClient,
      extra: [probe(invoke)],
    });
    await expect(
      executeAgentTool(tools, "probe_tool", { boardId: BOARD_2 }),
    ).resolves.toBe("ok");
  });

  // An unattended 07:00 run must not die on one bad tool call: the throw comes
  // back as a tool RESULT so the model can adapt and still file its briefing.
  it("returns a thrown handler error as a result instead of propagating", async () => {
    const tools = buildAgentTools({
      ctx,
      scope: { mode: "all" },
      client: noClient,
      extra: [
        probe(async () => {
          throw new Error("boom");
        }),
      ],
    });
    await expect(
      executeAgentTool(tools, "probe_tool", { boardId: BOARD_1 }),
    ).resolves.toEqual({ error: "boom" });
  });

  it("handles a non-Error throw", async () => {
    const tools = buildAgentTools({
      ctx,
      scope: { mode: "all" },
      client: noClient,
      extra: [
        probe(async () => {
          throw "nope";
        }),
      ],
    });
    await expect(
      executeAgentTool(tools, "probe_tool", { boardId: BOARD_1 }),
    ).resolves.toEqual({ error: "Tool failed." });
  });

  // `scope: "none"` tools (get_report, get_dashboard, get_portfolio,
  // get_widget_data) reach board-derived data through non-board ids. They are
  // deliberately NOT board-narrowed — RLS is their sole boundary — so a list
  // scope must not refuse them.
  it("does not board-narrow a `none`-scoped tool", async () => {
    const invoke = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "report" }],
    }));
    const tools = buildAgentTools({
      ctx,
      scope: { mode: "list", boardIds: [BOARD_1] },
      client: noClient,
      extra: [{ ...probe(invoke, "none"), name: "probe_none" }],
    });
    await expect(
      executeAgentTool(tools, "probe_none", { reportId: "r1" }),
    ).resolves.toBe("report");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("carries each descriptor's description through to the model", () => {
    const tools = buildAgentTools({
      ctx,
      scope: { mode: "all" },
      client: noClient,
    });
    const listItems = ALL_TOOL_DESCRIPTORS.find((d) => d.name === "list_items");
    expect(tools.list_items?.description).toBe(listItems?.description);
  });
});
