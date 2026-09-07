import { describe, expect, it } from "vitest";
import { leadingHandle, resolveAddressedAgent } from "./persona-routing";
import type { AgentMentionTarget } from "@/lib/collaboration/mentions";

const roster: AgentMentionTarget[] = [
  { kind: "agent", agentId: "a-ops", handle: "ops", name: "Ops" },
  { kind: "agent", agentId: "a-fin", handle: "finance", name: "Finance" },
];

describe("leadingHandle", () => {
  it("reads a handle that leads the text", () => {
    expect(leadingHandle("@ops what slipped?")).toBe("ops");
  });

  it("lowercases, and stops at the handle charset", () => {
    expect(leadingHandle("  @OPS, anything?")).toBe("ops");
  });

  it("ignores a handle that does not lead", () => {
    expect(leadingHandle("ask @ops later")).toBeNull();
  });
});

describe("resolveAddressedAgent", () => {
  it("routes to the addressed agent and reports the switch", () => {
    expect(
      resolveAddressedAgent({
        text: "@finance what does that cost?",
        roster,
        currentAgentId: "a-ops",
      }),
    ).toEqual({ agentId: "a-fin", switched: true });
  });

  it("is STICKY: no handle keeps the current persona", () => {
    expect(
      resolveAddressedAgent({
        text: "and next week?",
        roster,
        currentAgentId: "a-ops",
      }),
    ).toEqual({ agentId: "a-ops", switched: false });
  });

  it("keeps the current persona when the handle matches nobody", () => {
    expect(
      resolveAddressedAgent({
        text: "@nobody hello",
        roster,
        currentAgentId: "a-ops",
      }),
    ).toEqual({ agentId: "a-ops", switched: false });
  });

  it("re-addressing the current agent is not a switch", () => {
    expect(
      resolveAddressedAgent({
        text: "@ops again please",
        roster,
        currentAgentId: "a-ops",
      }),
    ).toEqual({ agentId: "a-ops", switched: false });
  });

  it("answers as the plain assistant when there is no persona at all", () => {
    expect(
      resolveAddressedAgent({ text: "hello", roster, currentAgentId: null }),
    ).toEqual({ agentId: null, switched: false });
  });
});
