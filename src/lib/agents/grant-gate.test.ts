import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { tool, type ToolApprovalConfiguration, type ToolSet } from "ai";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import { DuplicateToolNameError } from "./tool-descriptors";
import { UNGRANTED_REASON, makeGrantGate, type GrantGate } from "./grant-gate";

const call = (toolName: string) => ({
  toolCall: { toolName, toolCallId: "c1", input: { a: 1 }, dynamic: false },
});

/** A run-local descriptor of the kind Task 6 passes as `extra`. */
function probe(
  name: string,
  capability: ToolDescriptor["capability"],
): ToolDescriptor {
  return {
    name,
    title: name,
    description: name,
    inputSchema: {},
    capability,
    scope: "none",
    invoke: async () => ({ content: [{ type: "text", text: "ok" }] }),
  };
}

describe("makeGrantGate", () => {
  it("executes a read tool with no capability", async () => {
    const gate = makeGrantGate({
      granted: [],
      ceiling: [],
      onPropose: vi.fn(),
    });
    expect(await gate(call("list_items"))).toBeUndefined();
  });

  it("executes a granted write tool", async () => {
    const gate = makeGrantGate({
      granted: ["board.write"],
      ceiling: ["board.write"],
      onPropose: vi.fn(),
    });
    expect(await gate(call("create_item"))).toBeUndefined();
  });

  it("denies an ungranted tool AND records a proposal", async () => {
    const onPropose = vi.fn();
    const gate = makeGrantGate({
      granted: [],
      ceiling: ["board.write"],
      onPropose,
    });
    expect(await gate(call("create_item"))).toEqual({
      type: "denied",
      reason: UNGRANTED_REASON,
    });
    expect(onPropose).toHaveBeenCalledWith({
      toolCallId: "c1",
      toolName: "create_item",
      capability: "board.write",
      input: { a: 1 },
    });
  });

  it("denies an over-ceiling tool and records NOTHING", async () => {
    // A proposal nobody is permitted to approve renders a button that can
    // only ever fail. Deny, but leave no row.
    const onPropose = vi.fn();
    const gate = makeGrantGate({
      granted: ["board.write"],
      ceiling: [],
      onPropose,
    });
    expect(await gate(call("create_item"))).toEqual({
      type: "denied",
      reason: expect.stringMatching(/disabled for this organization/i),
    });
    expect(onPropose).not.toHaveBeenCalled();
  });

  it("denies an unknown tool rather than executing it", async () => {
    const gate = makeGrantGate({
      granted: ["board.write"],
      ceiling: ["board.write"],
      onPropose: vi.fn(),
    });
    expect(await gate(call("nope"))).toMatchObject({ type: "denied" });
  });

  // Ungranted tools stay VISIBLE to the model — `activeTools` is deliberately
  // NOT the mechanism. This asserts the gate is the ONLY thing standing between
  // the model and an ungranted write: the tool is in the set, the model can
  // call it, and the denial is what stops it. A hidden tool could never be
  // proposed, and the proposal path is the entire point of the design.
  it("still denies a tool the model can see and call", async () => {
    const onPropose = vi.fn();
    const gate = makeGrantGate({
      granted: [],
      ceiling: ["files.write"],
      onPropose,
    });
    expect(await gate(call("attach_file"))).toMatchObject({ type: "denied" });
    expect(onPropose).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "files.write" }),
    );
  });

  it("records the proposal under the capability the DESCRIPTOR declares", async () => {
    // Not a name the caller passes in: the descriptor table is the one
    // classification, so an approval UI and the gate can never disagree about
    // what a given tool costs.
    const onPropose = vi.fn();
    const gate = makeGrantGate({
      granted: [],
      ceiling: ["time.log"],
      onPropose,
    });
    await gate(call("log_time_allocation"));
    expect(onPropose).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "log_time_allocation",
        capability: "time.log",
      }),
    );
  });

  it("treats a missing input as an empty record", async () => {
    const onPropose = vi.fn();
    const gate = makeGrantGate({
      granted: [],
      ceiling: ["board.write"],
      onPropose,
    });
    await gate({
      toolCall: { toolName: "create_item", toolCallId: "c2", input: undefined },
    });
    expect(onPropose).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: "c2", input: {} }),
    );
  });
});

// The gate and the tool set must classify the SAME run. Before
// `descriptorsFor`, the gate keyed off the catalog alone: a run-local `extra`
// tool was offered to the model and then denied "Unknown tool." on every call,
// forever — and an extra reusing a catalog name executed its own handler while
// being classified from the CATALOG entry, so an extra write tool named after a
// capability-free read ran ungated.
describe("makeGrantGate with run-local extra tools", () => {
  it("gates an extra tool by ITS OWN capability — granted", async () => {
    const gate = makeGrantGate({
      granted: ["files.write"],
      ceiling: ["files.write"],
      onPropose: vi.fn(),
      extra: [probe("create_file", "files.write")],
    });
    expect(await gate(call("create_file"))).toBeUndefined();
  });

  it("gates an extra tool by ITS OWN capability — ungranted", async () => {
    const onPropose = vi.fn();
    const gate = makeGrantGate({
      granted: [],
      ceiling: ["automation.create"],
      onPropose,
      extra: [probe("create_automation", "automation.create")],
    });
    expect(await gate(call("create_automation"))).toEqual({
      type: "denied",
      reason: UNGRANTED_REASON,
    });
    expect(onPropose).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "create_automation",
        capability: "automation.create",
      }),
    );
  });

  it("executes a capability-free extra tool instead of denying it", async () => {
    const gate = makeGrantGate({
      granted: [],
      ceiling: [],
      onPropose: vi.fn(),
      extra: [probe("read_run_notes", null)],
    });
    expect(await gate(call("read_run_notes"))).toBeUndefined();
  });

  it("still denies an extra tool the gate was not told about", async () => {
    // The failure mode this fix removes, pinned so it stays a LOUD one: a
    // caller that passes `extra` to buildAgentTools only gets a denial, never
    // a silently ungated execution.
    const gate = makeGrantGate({
      granted: [],
      ceiling: [],
      onPropose: vi.fn(),
    });
    expect(await gate(call("create_file"))).toMatchObject({ type: "denied" });
  });

  it("refuses to build when an extra shadows a catalog name", () => {
    expect(() =>
      makeGrantGate({
        granted: [],
        ceiling: [],
        onPropose: vi.fn(),
        extra: [probe("get_board", "board.write")],
      }),
    ).toThrow(DuplicateToolNameError);
  });

  it("denies an agent-excluded catalog tool as unknown", async () => {
    // `create_attachment_upload` is never in the tool set, so a call naming it
    // is not something the model was offered — fail closed.
    const gate = makeGrantGate({
      granted: ["files.write"],
      ceiling: ["files.write"],
      onPropose: vi.fn(),
    });
    expect(await gate(call("create_attachment_upload"))).toEqual({
      type: "denied",
      reason: "Unknown tool.",
    });
  });
});

describe("GrantGate", () => {
  // A type-level assertion, not a runtime one: the gate must be usable as
  // `generateText({ toolApproval })` against a CONCRETE tool set, which is what
  // Task 7 does. Annotating it as `GenericToolApprovalFunction<ToolSet, …>`
  // instead would compile here and fail at that call site — the SDK's
  // `toolsContext` generic is invariant enough that a `ToolSet`-shaped
  // annotation is not assignable to a concrete one. See grant-gate.ts.
  it("plugs into the AI SDK's toolApproval option", () => {
    const _tools = {
      demo: tool({
        description: "demo",
        inputSchema: z.object({ boardId: z.string() }),
        execute: async (input: Record<string, unknown>) =>
          JSON.stringify(input),
      }),
    } satisfies ToolSet;

    const gate: GrantGate = makeGrantGate({
      granted: [],
      ceiling: [],
      onPropose: vi.fn(),
    });
    const approval: ToolApprovalConfiguration<typeof _tools, unknown> = gate;
    expect(typeof approval).toBe("function");
  });
});
