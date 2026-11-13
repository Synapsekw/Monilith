import { describe, it, expect, vi, afterEach } from "vitest";
import { executeAgentTool } from "@/test/agent-tool-exec";
import { assistantDescriptors } from "./catalog";
import { buildAssistantTools } from "./tools";

afterEach(() => vi.restoreAllMocks());

/** Every (tool, input) pair that is not a read. */
function writeInputs(): { name: string; input: Record<string, unknown> }[] {
  const out: { name: string; input: Record<string, unknown> }[] = [];
  for (const d of assistantDescriptors()) {
    if (d.capability === null) continue;
    if (typeof d.capability === "string") {
      out.push({ name: d.name, input: {} });
      continue;
    }
    for (const [action, capability] of Object.entries(d.capability))
      if (capability !== null) out.push({ name: d.name, input: { action } });
    out.push({ name: d.name, input: { action: "not-a-real-action" } });
  }
  return out;
}

describe("staging conformance over the real catalog", () => {
  it("has write tools to check", () => {
    expect(writeInputs().length).toBeGreaterThan(10);
  });

  it("never invokes a write tool during a model turn", async () => {
    const spies = assistantDescriptors().map((d) =>
      vi
        .spyOn(d as { invoke: (typeof d)["invoke"] }, "invoke")
        .mockResolvedValue({ content: [{ type: "text", text: "x" }] }),
    );
    const staged: string[] = [];
    const tools = buildAssistantTools({
      ctx: { getClient: vi.fn(), actorId: "u-1" } as never,
      // Any board lookup throws; staging must survive that.
      client: {
        from: () => {
          throw new Error("no db in unit tests");
        },
      } as never,
      stage: (c) => (staged.push(c.tool), true),
    });
    for (const { name, input } of writeInputs())
      await executeAgentTool(tools, name, input);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(staged).toHaveLength(writeInputs().length);
  });
});
