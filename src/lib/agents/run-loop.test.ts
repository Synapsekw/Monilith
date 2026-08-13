import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ToolInvokeContext } from "@/lib/mcp/tools/descriptor";
import { AGENT_ONLY_DESCRIPTORS } from "./agent-only-tools";
import {
  runAgentLoop,
  buildAgentRuntime,
  AGENT_MAX_STEPS,
  ModelNotToolCapableError,
} from "./run-loop";
import { makeGrantGate, UNGRANTED_REASON } from "./grant-gate";

const usage = {
  inputTokens: { total: 30, noCache: 10, cacheRead: 20, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

const tools = {
  list_items: tool({
    inputSchema: z.object({ boardId: z.string() }),
    execute: async () => "ok",
  }),
  create_item: tool({
    inputSchema: z.object({ groupId: z.string(), name: z.string() }),
    execute: async () => "ok",
  }),
};

function twoStepModel() {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      step++;
      if (step === 1) {
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "c1",
              toolName: "list_items",
              input: JSON.stringify({ boardId: "b-1" }),
            },
            {
              type: "tool-call",
              toolCallId: "c2",
              toolName: "create_item",
              input: JSON.stringify({ groupId: "g-1", name: "Draft" }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text", text: "Done." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

describe("runAgentLoop", () => {
  it("keeps running after an ungranted call, and surfaces it for proposal", async () => {
    const executed: string[] = [];
    const proposed: unknown[] = [];
    const tools = {
      list_items: tool({
        inputSchema: z.object({ boardId: z.string() }),
        execute: async () => {
          executed.push("list_items");
          return "ok";
        },
      }),
      create_item: tool({
        inputSchema: z.object({ groupId: z.string(), name: z.string() }),
        execute: async () => {
          executed.push("create_item");
          return "ok";
        },
      }),
    };
    const r = await runAgentLoop({
      model: twoStepModel(),
      instructions: "go",
      tools,
      gate: makeGrantGate({
        granted: [],
        ceiling: ["board.write"],
        onPropose: (c) => proposed.push(c),
      }),
      maxOutputTokens: null,
    });

    expect(r.steps).toBe(2);
    expect(r.text).toBe("Done.");
    expect(executed).toEqual(["list_items"]); // the write did NOT run
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({
      toolName: "create_item",
      capability: "board.write",
      input: { groupId: "g-1", name: "Draft" },
    });
  });

  it("does not double-bill cached input", async () => {
    const r = await runAgentLoop({
      model: twoStepModel(),
      instructions: "go",
      tools,
      gate: makeGrantGate({
        granted: ["board.write"],
        ceiling: ["board.write"],
        onPropose: () => {},
      }),
      maxOutputTokens: null,
    });
    // 2 steps x noCache 10. If the SDK's inputTokens (30, cache-INCLUSIVE)
    // leaked through instead, this would read 60 — the double-billing bug.
    expect(r.usage.inputTokens).toBe(20);
    expect(r.usage.cacheReadTokens).toBe(40);
  });

  it("caps the loop at AGENT_MAX_STEPS", async () => {
    expect(AGENT_MAX_STEPS).toBe(12);
    // A model that never stops calling a tool — the runaway case the cap exists for.
    const endless = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call",
            toolCallId: "x",
            toolName: "list_items",
            input: JSON.stringify({ boardId: "b-1" }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      }),
    });
    const r = await runAgentLoop({
      model: endless,
      instructions: "go",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
    });
    expect(r.steps).toBe(AGENT_MAX_STEPS);
  });

  // `tools_used` is an audit column on `user_agent_runs`. A DENIED call is a
  // call the model made and never executed; listing it would read as a write
  // that happened.
  it("reports only the tools that actually executed", async () => {
    const r = await runAgentLoop({
      model: twoStepModel(),
      instructions: "go",
      tools,
      gate: makeGrantGate({
        granted: [],
        ceiling: ["board.write"],
        onPropose: () => {},
      }),
      maxOutputTokens: null,
    });
    expect(r.toolsUsed).toEqual(["list_items"]);
  });
});

// ── buildAgentRuntime ────────────────────────────────────────────────────
// Three gaps Task 5 could not close from inside its own module: that an
// assembled run HAS the gate, that the set and the gate classify the same run,
// and that a retried denial does not queue the same proposal twice.

/** No agent tool may query through anything but the injected owner client. */
const noClient = new Proxy(
  {},
  {
    get() {
      throw new Error("the runtime must not query in these tests");
    },
  },
) as SupabaseClient<Database>;

const ctx: ToolInvokeContext = {
  getClient: async () => noClient,
  actorId: "00000000-0000-4000-8000-000000000001",
};

function runtime(over: {
  granted?: Parameters<typeof buildAgentRuntime>[0]["granted"];
  ceiling?: Parameters<typeof buildAgentRuntime>[0]["ceiling"];
  onPropose?: Parameters<typeof buildAgentRuntime>[0]["onPropose"];
}) {
  return buildAgentRuntime({
    ctx,
    scope: { mode: "all" },
    client: noClient,
    extra: AGENT_ONLY_DESCRIPTORS,
    granted: over.granted ?? [],
    ceiling: over.ceiling ?? [],
    onPropose: over.onPropose ?? (() => {}),
  });
}

describe("buildAgentRuntime", () => {
  it("returns a gate alongside the tools", () => {
    // A run assembled without `toolApproval` gets ungated writes and no Task 5
    // test fails, because the gate is only ever exercised in isolation there.
    const { tools: assembled, gate } = runtime({});
    expect(typeof gate).toBe("function");
    expect(Object.keys(assembled).length).toBeGreaterThan(0);
  });

  // The bug this function exists to make unrepresentable: the tool set built
  // from `catalog + extra` while the gate keyed off the catalog alone, so every
  // `extra` tool was offered and then denied "Unknown tool." forever.
  it("classifies every tool it offers — none is unknown to the gate", async () => {
    const { tools: assembled, gate } = runtime({
      granted: ["board.write", "files.write", "automation.create", "time.log"],
      ceiling: ["board.write", "files.write", "automation.create", "time.log"],
    });
    for (const name of Object.keys(assembled)) {
      const decision = await gate({
        toolCall: { toolName: name, toolCallId: "c", input: {} },
      });
      expect(decision, `${name} was classified as unknown`).not.toMatchObject({
        reason: "Unknown tool.",
      });
    }
  });

  it("offers the agent-only tools and gates them by their own capability", async () => {
    const onPropose = vi.fn();
    const { tools: assembled, gate } = runtime({
      granted: [],
      ceiling: ["files.write"],
      onPropose,
    });
    expect(Object.keys(assembled)).toContain("create_file");
    expect(
      await gate({
        toolCall: { toolName: "create_file", toolCallId: "c1", input: {} },
      }),
    ).toEqual({ type: "denied", reason: UNGRANTED_REASON });
    expect(onPropose).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "files.write" }),
    );
  });

  // `user_agent_proposals` is UNIQUE on (run_id, tool_call_id). A model that
  // re-proposes a denied write calls the gate twice for one call id, and an
  // un-deduped collector turns that into a 23505 that loses the whole run's
  // proposals.
  it("queues ONE proposal when a denied call is retried", async () => {
    const proposed: { toolCallId: string }[] = [];
    const { gate } = runtime({
      granted: [],
      ceiling: ["board.write"],
      onPropose: (c) => proposed.push(c),
    });
    const call = {
      toolCall: {
        toolName: "create_item",
        toolCallId: "same-id",
        input: { groupId: "g-1" },
      },
    };
    expect(await gate(call)).toMatchObject({ type: "denied" });
    expect(await gate(call)).toMatchObject({ type: "denied" });
    expect(proposed).toHaveLength(1);
  });

  it("still queues distinct proposals for distinct call ids", async () => {
    const proposed: { toolCallId: string }[] = [];
    const { gate } = runtime({
      granted: [],
      ceiling: ["board.write"],
      onPropose: (c) => proposed.push(c),
    });
    await gate({
      toolCall: { toolName: "create_item", toolCallId: "a", input: {} },
    });
    await gate({
      toolCall: { toolName: "create_item", toolCallId: "b", input: {} },
    });
    expect(proposed.map((p) => p.toolCallId)).toEqual(["a", "b"]);
  });

  // The whole grant design in one assertion: an ungranted write is STILL in the
  // set (so the model can propose it), and the gate is the only thing stopping
  // it. Assembled by buildAgentRuntime, not hand-wired.
  it("denies an ungranted write in a real loop, and the run still finishes", async () => {
    const proposed: unknown[] = [];
    const { gate } = runtime({
      granted: [],
      ceiling: ["board.write"],
      onPropose: (c) => proposed.push(c),
    });
    const r = await runAgentLoop({
      model: twoStepModel(),
      instructions: "go",
      tools,
      gate,
      maxOutputTokens: null,
    });
    expect(r.text).toBe("Done.");
    expect(proposed).toHaveLength(1);
  });

  // The AI SDK converts each tool's Zod schema to JSON Schema LAZILY, at the
  // first model call — so `create_automation`'s schema (which is
  // `createAutomationSchema.shape`, a discriminated-union-bearing shape nothing
  // had ever converted) first gets exercised HERE, in the run loop, not when
  // the descriptor is defined. A throw would otherwise surface for the first
  // time at 07:00 in production. This drives the REAL assembled tool set
  // through a real `generateText` and asserts every tool crossed the wire.
  it("converts every assembled tool's schema for the model — including create_automation", async () => {
    const { tools: assembled, gate } = runtime({});
    let offered: string[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async ({ tools: sent }) => {
        offered = (sent ?? []).map((t) => t.name);
        return {
          content: [{ type: "text", text: "Nothing to do." }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      },
    });

    const r = await runAgentLoop({
      model,
      instructions: "go",
      tools: assembled,
      gate,
      maxOutputTokens: null,
    });

    expect(r.text).toBe("Nothing to do.");
    expect(offered).toContain("create_automation");
    expect(offered).toContain("create_file");
    // Every tool converted — no silent drop, no warning-only omission.
    expect(offered.sort()).toEqual(Object.keys(assembled).sort());
  });
});

describe("ModelNotToolCapableError", () => {
  it("names the model and where to change it", () => {
    const e = new ModelNotToolCapableError("gpt-legacy-1");
    expect(e.message).toContain("gpt-legacy-1");
    expect(e.message).toMatch(/Settings → Agents/);
    expect(e.modelId).toBe("gpt-legacy-1");
  });
});
