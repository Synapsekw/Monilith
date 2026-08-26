import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { tool, type LanguageModel } from "ai";
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
  PREAMBLE,
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

/** A model that answers once, with text, and calls nothing. */
function textModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

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
      nonce: "n-test-agent",
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
      nonce: "n-test-agent",
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
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
    });
    expect(r.steps).toBe(AGENT_MAX_STEPS);

    // `GenerateTextResult.text` is the FINAL STEP's text, and this run spent
    // its last step calling a tool — so the SDK's own `text` is "". Emailing,
    // threading and storing that empty string is exactly what happened before
    // the fallback existed, on the one run that most needed explaining.
    expect(r.text).not.toBe("");
    expect(r.text).toContain("12-step limit");
    expect(r.text).toContain("list_items");
  });

  it("falls back to a server-derived line when a run stops early with no text", async () => {
    // Stops of its own accord (no tool call, no text) — not the step cap. The
    // wording must not claim a limit that was never reached.
    const silent = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      }),
    });
    const r = await runAgentLoop({
      model: silent,
      instructions: "go",
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
    });
    expect(r.steps).toBe(1);
    expect(r.text).toBe(
      "This run finished without writing a summary. It completed no tool calls.",
    );
  });

  it("never returns whitespace-only text", async () => {
    const blank = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "   \n  " }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      }),
    });
    const r = await runAgentLoop({
      model: blank,
      instructions: "go",
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
    });
    expect(r.text.trim()).not.toBe("");
    expect(r.text).toMatch(/without writing a summary/);
  });

  it("trims the model's own text rather than passing it through raw", async () => {
    const r = await runAgentLoop({
      model: textModel("  Done.  "),
      instructions: "go",
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
    });
    expect(r.text).toBe("Done.");
  });

  // The audit trail for a run that DIES mid-loop: `generateText` rejects and
  // its result object — every tool the run got through — goes with it.
  it("reports progress per step, so a caller can audit a run that later throws", async () => {
    const progress: Parameters<
      NonNullable<Parameters<typeof runAgentLoop>[0]["onStep"]>
    >[0][] = [];
    let step = 0;
    const throwsAtStepThree = new MockLanguageModelV4({
      doGenerate: async () => {
        step++;
        if (step === 3) throw new Error("provider 503");
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: `c${step}`,
              toolName: "list_items",
              input: JSON.stringify({ boardId: "b-1" }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        };
      },
    });

    await expect(
      runAgentLoop({
        model: throwsAtStepThree,
        instructions: "go",
        nonce: "n-test-agent",
        tools,
        gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
        maxOutputTokens: null,
        onStep: (p) => progress.push(p),
      }),
    ).rejects.toThrow(/provider 503/);

    // Two steps completed before the throw, and the caller knows it.
    expect(progress.at(-1)).toMatchObject({
      steps: 2,
      toolsUsed: ["list_items"],
    });
    // …INCLUDING what those two steps cost. Without this the route's error path
    // records zero usage for a run that made two real, billed provider calls:
    // managed-mode money spent against no ledger row, and a monthly credit
    // ceiling that silently under-counts. Cache-exclusive (`toAiUsage`), so
    // 2 x noCache 10 — never 2 x the SDK's cache-inclusive 30.
    expect(progress.at(-1)?.usage).toEqual({
      inputTokens: 20,
      outputTokens: 40,
      cacheReadTokens: 40,
      cacheWriteTokens: 0,
    });
  });

  // The accumulator and `result.totalUsage` must agree, or a run metered on the
  // error path would bill differently from the same run metered on success.
  it("accumulates the same usage the success path reports", async () => {
    let last: { inputTokens: number } | undefined;
    const r = await runAgentLoop({
      model: twoStepModel(),
      instructions: "go",
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({
        granted: ["board.write"],
        ceiling: ["board.write"],
        onPropose: () => {},
      }),
      maxOutputTokens: null,
      onStep: ({ usage }) => {
        last = usage;
      },
    });
    expect(last).toEqual(r.usage);
  });

  // `tools_used` says the run EXECUTED these tools. `buildAgentTools` funnels
  // every failure into `{ error }`, and a call that came back an error changed
  // nothing — listing it would read as a write that happened.
  it("excludes a tool whose call came back an error", async () => {
    const failing = {
      list_items: tool({
        inputSchema: z.object({ boardId: z.string() }),
        execute: async () => "ok",
      }),
      create_item: tool({
        inputSchema: z.object({ groupId: z.string(), name: z.string() }),
        // The exact shape tools.ts returns for an out-of-scope board, a thrown
        // handler, or a handler that refused.
        execute: async () => ({ error: "That board is outside scope." }),
      }),
    };
    const r = await runAgentLoop({
      model: twoStepModel(),
      instructions: "go",
      nonce: "n-test-agent",
      tools: failing,
      gate: makeGrantGate({
        granted: ["board.write"],
        ceiling: ["board.write"],
        onPropose: () => {},
      }),
      maxOutputTokens: null,
    });
    expect(r.toolsUsed).toEqual(["list_items"]);
  });

  // `tools_used` is an audit column on `user_agent_runs`. A DENIED call is a
  // call the model made and never executed; listing it would read as a write
  // that happened.
  it("reports only the tools that actually executed", async () => {
    const r = await runAgentLoop({
      model: twoStepModel(),
      instructions: "go",
      nonce: "n-test-agent",
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
      nonce: "n-test-agent",
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
      nonce: "n-test-agent",
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

// ── Anthropic prompt caching ─────────────────────────────────────────────
// The prefix — the tool definitions plus the system prompt, ~6–9k tokens — is
// re-sent on every one of up to twelve steps. Anthropic caching is OPT-IN, so
// with no breakpoint there is no caching at all, which is what this loop
// shipped with. Verified against the REAL @ai-sdk/anthropic provider over a
// fake transport rather than by inspecting our own arguments: the question is
// whether `cache_control` reaches the wire, and only the request body answers
// it.
describe("prompt caching", () => {
  function anthropicOverFakeFetch(bodies: unknown[]) {
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-20260101",
          content: [{ type: "text", text: "Done." }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;
    return createAnthropic({ apiKey: "k", fetch: fetchImpl })(
      "claude-sonnet-5-20260101",
    );
  }

  it("emits a cache_control breakpoint on the system block", async () => {
    const bodies: unknown[] = [];
    const r = await runAgentLoop({
      model: anthropicOverFakeFetch(bodies),
      instructions: "Be concise.",
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
    });

    expect(r.text).toBe("Done.");
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as {
      system?: { type: string; text: string; cache_control?: unknown }[];
      tools?: { name: string }[];
    };
    // The breakpoint is on the system block, which in Anthropic's request
    // ordering (tools → system → messages) caches the TOOL DEFINITIONS too —
    // and those are the bulk of the prefix.
    expect(body.system?.[0]).toMatchObject({
      type: "text",
      cache_control: { type: "ephemeral" },
    });
    expect(body.system?.[0]?.text).toContain("scheduled work agent");
    expect(body.system?.[0]?.text).toContain("Be concise.");
    expect(body.tools?.length).toBeGreaterThan(0);
  });

  // A provider that does not own the `anthropic` namespace must ignore it, not
  // choke on it or spread it into the request body.
  it("is inert on a provider that does not own the namespace", async () => {
    const seen: unknown[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        seen.push(prompt);
        return {
          content: [{ type: "text", text: "Done." }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const r = await runAgentLoop({
      model,
      instructions: "go",
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
    });
    expect(r.text).toBe("Done.");
    // The system prompt still arrives — a caching option must never cost the
    // instructions.
    expect(JSON.stringify(seen)).toContain("scheduled work agent");
  });
});

// ── Reference documents ──────────────────────────────────────────────────
// THE MOST IMPORTANT TEST IN THIS FILE. The system message is the Anthropic
// cache PREFIX, re-sent on every one of up to twelve steps of every existing
// agent's every run. If attaching this feature changes so much as one byte
// of that prefix for an agent that has zero documents, every existing
// agent's cache breaks silently and every run gets more expensive — a cost
// regression nothing else in the suite would catch.
describe("reference documents in the system prompt", () => {
  /** Captures the exact converted prompt `generateText` hands the model —
   *  the same value `run-loop.ts` produced from `composeSystemPrompt`, after
   *  the AI SDK's own conversion (which passes a system message's `content`
   *  and `providerOptions` through UNCHANGED — see `convertToLanguageModelPrompt`
   *  in `ai/dist/index.js`). This is a more direct assertion than inspecting
   *  the wire body: it is exactly the `messages` array run-loop.ts built. */
  function capturingModel(sink: { prompt?: unknown }): LanguageModel {
    return new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        sink.prompt = prompt;
        return {
          content: [{ type: "text", text: "Done." }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
  }

  it("keeps the system message byte-identical when no documents are attached", async () => {
    const sink: { prompt?: unknown } = {};
    await runAgentLoop({
      model: capturingModel(sink),
      instructions: "Do the thing.",
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
    });
    const system = (sink.prompt as { role: string; content: string }[])[0];
    expect(system.role).toBe("system");
    expect(system.content).toBe(
      `${PREAMBLE}\n\nYOUR OWNER'S INSTRUCTIONS:\nDo the thing.`,
    );
  });

  it("also keeps it byte-identical when `documents` is explicitly an empty array", async () => {
    const sink: { prompt?: unknown } = {};
    await runAgentLoop({
      model: capturingModel(sink),
      instructions: "Do the thing.",
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
      documents: [],
    });
    const system = (sink.prompt as { role: string; content: string }[])[0];
    expect(system.content).toBe(
      `${PREAMBLE}\n\nYOUR OWNER'S INSTRUCTIONS:\nDo the thing.`,
    );
  });

  it("injects the documents inside the SAME system message, with owner instructions last", async () => {
    const sink: { prompt?: unknown } = {};
    await runAgentLoop({
      model: capturingModel(sink),
      instructions: "Do the thing.",
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
      documents: [{ title: "Standup format", body: "Y/T/B, one line each." }],
    });
    const prompt = sink.prompt as {
      role: string;
      content: string;
      providerOptions?: Record<string, Record<string, unknown>>;
    }[];
    // Still exactly ONE system message and one user message — never a second
    // message for the documents, because `cache_control` can only be
    // attached through a message's own `providerOptions`.
    expect(prompt).toHaveLength(2);
    const system = prompt[0]!;
    expect(system.role).toBe("system");
    expect(system.content).toContain("REFERENCE DOCUMENTS");
    expect(system.content).toContain("Standup format");
    expect(system.content).toContain("Y/T/B, one line each.");
    expect(system.content.indexOf("REFERENCE DOCUMENTS")).toBeLessThan(
      system.content.indexOf("YOUR OWNER'S INSTRUCTIONS"),
    );
    expect(system.content.trimEnd().endsWith("Do the thing.")).toBe(true);
    // The cache breakpoint stays on THIS message even with documents present.
    expect(system.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  // NOT a dead seam: the cron route persists `result.documentsOmitted` onto
  // `user_agent_runs.documents_omitted` (route.ts, `safeFinalize`), which is
  // what the run-history badge reads. The loop echoing the flag back is the
  // only reason the route does not have to keep its own copy of it.
  it("reports documentsOmitted back on the result, defaulting to false", async () => {
    const r1 = await runAgentLoop({
      model: textModel("Done."),
      instructions: "go",
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
    });
    expect(r1.documentsOmitted).toBe(false);

    const sink: { prompt?: unknown } = {};
    const r2 = await runAgentLoop({
      model: capturingModel(sink),
      instructions: "go",
      nonce: "n-test-agent",
      tools,
      gate: makeGrantGate({ granted: [], ceiling: [], onPropose: () => {} }),
      maxOutputTokens: null,
      // What the route passes when `selectDocuments` dropped the whole set:
      // omitted, and therefore nothing to inject.
      documents: [],
      documentsOmitted: true,
    });
    expect(r2.documentsOmitted).toBe(true);
    // The flag and the prompt must agree — a run recorded as "documents
    // omitted" that nonetheless injected some would make the badge a lie.
    const system = (sink.prompt as { role: string; content: string }[])[0]!;
    expect(system.content).not.toContain("REFERENCE DOCUMENTS");
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
