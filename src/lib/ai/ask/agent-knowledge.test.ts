import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/documents-db", () => ({
  listDocumentsForAgent: vi.fn(async () => [
    { id: "d1", title: "Tone guide", body: "Be terse.", tokenEstimate: 10 },
  ]),
}));
vi.mock("@/lib/agents/memory-db", () => ({
  listMemoryForAgent: vi.fn(async () => [
    { key: "cadence", value: "Standup is 09:30", tokenEstimate: 8 },
  ]),
}));

import { composeAgentChatSystem } from "./agent-knowledge";

const agent = {
  id: "a-ops",
  name: "Ops",
  instructions: "Watch the delivery board.",
  docNonce: "NONCE123",
};

describe("composeAgentChatSystem", () => {
  it("orders preamble, documents, memory, then instructions", async () => {
    const out = await composeAgentChatSystem({
      client: {} as never,
      preamble: "PREAMBLE",
      agent,
      contextLength: 200_000,
    });
    const doc = out.indexOf("Tone guide");
    const mem = out.indexOf("Standup is 09:30");
    const ins = out.indexOf("Watch the delivery board.");
    expect(out.startsWith("PREAMBLE")).toBe(true);
    expect(doc).toBeLessThan(mem);
    expect(mem).toBeLessThan(ins);
  });

  it("keys the instructions marker with the agent's nonce", async () => {
    const out = await composeAgentChatSystem({
      client: {} as never,
      preamble: "PREAMBLE",
      agent,
      contextLength: 200_000,
    });
    expect(out).toContain("[NONCE123]");
  });

  it("names the agent in the preamble it composes with", async () => {
    const out = await composeAgentChatSystem({
      client: {} as never,
      preamble: "PREAMBLE",
      agent,
      contextLength: 200_000,
    });
    expect(out).toContain('personal agent "Ops"');
  });

  it("degrades to instructions-only when the knowledge reads fail", async () => {
    const { listDocumentsForAgent } = await import("@/lib/agents/documents-db");
    vi.mocked(listDocumentsForAgent).mockRejectedValueOnce(new Error("boom"));
    const out = await composeAgentChatSystem({
      client: {} as never,
      preamble: "PREAMBLE",
      agent,
      contextLength: 200_000,
    });
    expect(out).toContain("Watch the delivery board.");
    expect(out).not.toContain("Tone guide");
  });
});
