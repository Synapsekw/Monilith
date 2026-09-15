import { describe, expect, it } from "vitest";
import { ASK_TOOLS } from "./tools";
import { INTEL_READ_TOOLS } from "./ask-stream";

/**
 * The ONE suite in this area that does NOT mock `./tools`.
 *
 * `ask-stream.test.ts` has to mock it (the real tools hit Supabase), which
 * means its `ASK_TOOLS` names and `INTEL_READ_TOOLS` are two independent copies
 * of the same strings. Rename `query_items` in tools.ts and that suite stays
 * green while `tools` narrows to a shorter — or empty — array at runtime: a Q&A
 * assistant shipped unable to read a single item. This file closes that gap by
 * comparing the constant against the real declarations.
 */
describe("the read-only toolset is bound to the real tool list", () => {
  const realNames = ASK_TOOLS.map((t) => t.name);

  it("names only tools that actually exist in ASK_TOOLS", () => {
    expect([...INTEL_READ_TOOLS].filter((n) => realNames.includes(n))).toEqual([
      ...INTEL_READ_TOOLS,
    ]);
  });

  // A subset assertion alone passes for the empty set, which is the exact
  // failure mode being guarded (a filter that offers the model nothing).
  it("is non-empty, so the loop always has a way to read the board", () => {
    expect(INTEL_READ_TOOLS.size).toBeGreaterThan(0);
    expect(ASK_TOOLS.filter((t) => INTEL_READ_TOOLS.has(t.name))).toHaveLength(
      INTEL_READ_TOOLS.size,
    );
  });

  // The other half of "read-only": every name in it must be a READ tool, i.e.
  // one `executeAskTool` can actually run. ASK_TOOLS is exactly that set.
  it("offers no tool the read branch cannot execute", () => {
    for (const name of INTEL_READ_TOOLS) expect(realNames).toContain(name);
  });
});
