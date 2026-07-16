import { describe, expect, it, vi, beforeEach } from "vitest";

// A resolved adapter+key, as the real gateway hands to runAi's callback.
// `supportsTools` is per-test so the not-capable branch is exercisable.
let FAKE_RESOLVED = {
  adapter: { id: "anthropic", supportsTools: true },
  apiKey: "k",
  mode: "managed",
  provider: "anthropic",
};
const runAi = vi.fn(
  async (
    _args: { orgId: string; userId: string; feature: string },
    fn: (resolved: typeof FAKE_RESOLVED) => Promise<{ result: unknown }>,
  ) => {
    const { result } = await fn(FAKE_RESOLVED);
    return result;
  },
);
vi.mock("@/lib/ai/gateway", () => ({
  runAi: (...args: unknown[]) =>
    (runAi as unknown as (...a: unknown[]) => unknown)(...args),
}));

const requireAiEntitlement = vi.fn();
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: (...args: unknown[]) => requireAiEntitlement(...args),
}));

const getUserOrgs = vi.fn();
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => (await getUserOrgs())[0] ?? null,
}));
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getUserOrgs: (...args: unknown[]) => getUserOrgs(...args),
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

const listWorkspacesCached = vi.fn();
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: (...args: unknown[]) => listWorkspacesCached(...args),
}));

const getActiveWorkspaceId = vi.fn();
vi.mock("@/lib/workspaces/active", () => ({
  getActiveWorkspaceId: (...args: unknown[]) => getActiveWorkspaceId(...args),
}));

const askPulseLoop = vi.fn();
vi.mock("@/lib/ai/ask/ask", () => ({
  askPulseLoop: (...args: unknown[]) => askPulseLoop(...args),
}));

beforeEach(() => {
  runAi.mockClear();
  requireAiEntitlement.mockReset();
  getUserOrgs.mockReset();
  requireUser.mockReset();
  listWorkspacesCached.mockReset();
  getActiveWorkspaceId.mockReset();
  askPulseLoop.mockReset();
  FAKE_RESOLVED = {
    adapter: { id: "anthropic", supportsTools: true },
    apiKey: "k",
    mode: "managed",
    provider: "anthropic",
  };
  requireUser.mockResolvedValue({ id: "user-1" });
  getUserOrgs.mockResolvedValue([{ id: "org-1", name: "Org" }]);
  listWorkspacesCached.mockResolvedValue([{ id: "ws-1", name: "WS" }]);
  getActiveWorkspaceId.mockResolvedValue("ws-1");
});

describe("askPulse", () => {
  it("rejects a question shorter than 3 chars before any work", async () => {
    const { askPulse } = await import("@/lib/ai/ask/actions");
    const res = await askPulse({ question: "hi" });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("Ask a question between 3 and 1000 characters.");
    expect(requireAiEntitlement).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });

  it("gates on entitlement before invoking runAi", async () => {
    askPulseLoop.mockResolvedValue({
      answer: "ok",
      boardsConsulted: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { askPulse } = await import("@/lib/ai/ask/actions");
    await askPulse({ question: "what boards do I have?" });
    expect(requireAiEntitlement).toHaveBeenCalledWith("org-1", "ask_pulse");
    // entitlement resolves before runAi is entered
    expect(requireAiEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      runAi.mock.invocationCallOrder[0],
    );
  });

  it("returns the not-capable message and never runs the loop when the provider lacks tools", async () => {
    FAKE_RESOLVED = {
      adapter: { id: "openai", supportsTools: false },
      apiKey: "k",
      mode: "managed",
      provider: "openai",
    };
    const { askPulse } = await import("@/lib/ai/ask/actions");
    const res = await askPulse({ question: "what boards do I have?" });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe(
        "Ask Pulse needs an Anthropic key — dashboards work with any provider.",
      );
    expect(askPulseLoop).not.toHaveBeenCalled();
  });

  it("returns the answer and consulted boards on the happy path", async () => {
    askPulseLoop.mockResolvedValue({
      answer: "You have 2 boards: Sprint and Backlog.",
      boardsConsulted: ["board-1", "board-2"],
      usage: { inputTokens: 300, outputTokens: 70 },
    });
    const { askPulse } = await import("@/lib/ai/ask/actions");
    const res = await askPulse({ question: "what boards do I have?" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.answer).toBe("You have 2 boards: Sprint and Backlog.");
      expect(res.data.boardsConsulted).toEqual(["board-1", "board-2"]);
    }
    expect(askPulseLoop).toHaveBeenCalledWith({
      apiKey: "k",
      workspaceId: "ws-1",
      question: "what boards do I have?",
    });
  });

  it("fails with No workspace when none is active", async () => {
    getActiveWorkspaceId.mockResolvedValue("");
    const { askPulse } = await import("@/lib/ai/ask/actions");
    const res = await askPulse({ question: "what boards do I have?" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("No workspace.");
    expect(runAi).not.toHaveBeenCalled();
  });
});
