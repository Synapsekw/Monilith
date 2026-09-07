import { describe, expect, it } from "vitest";
import { AGENT_CAPABILITIES } from "./capabilities";
import { CAPABILITY_COPY } from "./capability-copy";
import { DEFAULT_ORG_AI_SETTINGS } from "@/lib/ai/org-settings";

describe("AGENT_CAPABILITIES", () => {
  it("includes the two structure capabilities", () => {
    expect(AGENT_CAPABILITIES).toContain("board.structure");
    expect(AGENT_CAPABILITIES).toContain("board.destroy");
  });

  it("gives every capability plain-language copy", () => {
    for (const c of AGENT_CAPABILITIES) {
      expect(CAPABILITY_COPY[c]?.label, c).toBeTruthy();
      expect(CAPABILITY_COPY[c]?.consequence, c).toBeTruthy();
    }
  });

  // The whole point of the inert ship: a brand-new org, and an org with no
  // settings row at all, must NOT receive either capability automatically.
  // Deriving this default from AGENT_CAPABILITIES would silently grant them.
  it("keeps both new capabilities OUT of the row-less org default ceiling", () => {
    expect(DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling).not.toContain(
      "board.structure",
    );
    expect(DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling).not.toContain(
      "board.destroy",
    );
    expect(DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling).toHaveLength(5);
  });
});
