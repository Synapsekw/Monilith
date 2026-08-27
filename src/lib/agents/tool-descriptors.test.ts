import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/catalog";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import { DuplicateToolNameError, descriptorsFor } from "./tool-descriptors";
import { AGENT_ONLY_DESCRIPTORS } from "./agent-only-tools";
import { makeMemoryDescriptors } from "./memory-tools";

function probe(
  name: string,
  over: Partial<ToolDescriptor> = {},
): ToolDescriptor {
  return {
    name,
    title: name,
    description: name,
    inputSchema: { boardId: z.string().uuid() },
    capability: null,
    scope: "boardId",
    invoke: async () => ({ content: [{ type: "text", text: "ok" }] }),
    ...over,
  };
}

describe("descriptorsFor", () => {
  it("returns the catalog minus the agent-excluded tools", () => {
    expect(descriptorsFor().map((d) => d.name)).toEqual(
      ALL_TOOL_DESCRIPTORS.filter((d) => !d.agentExcluded).map((d) => d.name),
    );
    expect(descriptorsFor().map((d) => d.name)).not.toContain(
      "create_attachment_upload",
    );
  });

  it("appends extras in order, after the catalog", () => {
    const names = descriptorsFor({
      extra: [probe("create_file"), probe("create_automation")],
    }).map((d) => d.name);
    expect(names.slice(-2)).toEqual(["create_file", "create_automation"]);
  });

  // The bug this module exists to make unrepresentable: the tool set and the
  // grant gate must see the SAME list, so both call this one function.
  it("gives buildAgentTools and makeGrantGate the same list", () => {
    const extra = [probe("create_file")];
    expect(descriptorsFor({ extra })).toEqual(descriptorsFor({ extra }));
  });

  it("throws when an extra shadows a catalog tool", () => {
    expect(() => descriptorsFor({ extra: [probe("get_board")] })).toThrow(
      DuplicateToolNameError,
    );
  });

  // Reusing an EXCLUDED catalog name is an error too: a name in the catalog
  // means exactly one thing, whether or not agents may call it.
  it("throws when an extra reuses an agent-excluded catalog name", () => {
    expect(() =>
      descriptorsFor({ extra: [probe("create_attachment_upload")] }),
    ).toThrow(DuplicateToolNameError);
  });

  it("throws when two extras collide with each other", () => {
    expect(() =>
      descriptorsFor({ extra: [probe("create_file"), probe("create_file")] }),
    ).toThrow(/Duplicate agent tool name "create_file"/);
  });

  it("drops an extra that marks itself agentExcluded", () => {
    const names = descriptorsFor({
      extra: [probe("never_offered", { agentExcluded: true })],
    }).map((d) => d.name);
    expect(names).not.toContain("never_offered");
  });
});

// ===========================================================================
// Spec 2c — the PER-RUN memory descriptors.
// ===========================================================================
//
// They are not in `AGENT_ONLY_DESCRIPTORS` because they close over an agent id
// and a run id, neither of which exists at module scope. That makes them the
// first extras built at call time, so the two properties every other extra gets
// for free — correct capability classification, and no collision with the
// catalog — have to be asserted here explicitly.
describe("the per-run memory descriptors", () => {
  it("classifies both under memory.write", () => {
    // If the gate saw `null` here, `remember` would be an ALWAYS-ON write.
    const extra = makeMemoryDescriptors({ userAgentId: "a", runId: "r" });
    const byName = new Map(descriptorsFor({ extra }).map((d) => [d.name, d]));
    expect(byName.get("remember")?.capability).toBe("memory.write");
    expect(byName.get("forget")?.capability).toBe("memory.write");
  });

  it("the memory names do not collide with the catalog or the agent-only tools", () => {
    expect(() =>
      descriptorsFor({
        extra: [
          ...AGENT_ONLY_DESCRIPTORS,
          ...makeMemoryDescriptors({ userAgentId: "a", runId: "r" }),
        ],
      }),
    ).not.toThrow();
  });

  it("offers both to the agent — neither is agentExcluded", () => {
    const names = descriptorsFor({
      extra: makeMemoryDescriptors({ userAgentId: "a", runId: "r" }),
    }).map((d) => d.name);
    expect(names).toContain("remember");
    expect(names).toContain("forget");
  });
});
