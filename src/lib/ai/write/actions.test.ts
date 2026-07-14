import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1" })),
  getUserOrgs: vi.fn(async () => [{ id: "org1" }]),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: vi.fn(async () => [{ id: "ws1" }]),
}));
vi.mock("@/lib/workspaces/active", () => ({
  getActiveWorkspaceId: vi.fn(async () => "ws1"),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: vi.fn(async () => undefined),
  getAiEntitlement: vi.fn(async () => ({ mode: "managed" })),
}));
vi.mock("@/lib/ai/gateway", () => ({
  runAi: vi.fn(
    async (_a: unknown, fn: (r: unknown) => Promise<{ result: unknown }>) =>
      (await fn({ adapter: { supportsTools: true }, apiKey: "k" })).result,
  ),
}));
const GROWN_TRANSCRIPT = [
  { role: "user", content: "make a Backlog group" },
  { role: "assistant", content: [{ type: "text", text: "done" }] },
];
vi.mock("./propose", () => ({
  proposeLoop: vi.fn(async () => ({
    actions: [
      {
        kind: "create_group",
        boardId: "b1",
        name: "Backlog",
        summary: "s",
        warnings: [],
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1 },
    messages: GROWN_TRANSCRIPT,
  })),
}));
const { executeAction } = vi.hoisted(() => ({
  executeAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./execute", () => ({ executeAction }));

import { proposeActions, executeActions } from "./actions";

beforeEach(() => vi.clearAllMocks());

describe("proposeActions", () => {
  it("gates entitlement then returns actions", async () => {
    const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
    const res = await proposeActions({ instruction: "make a Backlog group" });
    expect(requireAiEntitlement).toHaveBeenCalledWith(
      "org1",
      "conversational_action",
    );
    expect(res).toEqual({
      ok: true,
      data: {
        actions: [expect.objectContaining({ kind: "create_group" })],
        clarification: undefined,
        history: GROWN_TRANSCRIPT,
      },
    });
  });

  it("rejects a too-short instruction before any spend", async () => {
    const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
    const res = await proposeActions({ instruction: "x" });
    expect(res.ok).toBe(false);
    expect(requireAiEntitlement).not.toHaveBeenCalled();
  });

  it("threads a prior transcript into proposeLoop and returns the grown one", async () => {
    const { proposeLoop } = await import("./propose");
    const history = [
      { role: "user", content: "create task Ship v2" },
      { role: "assistant", content: [{ type: "text", text: "Which board?" }] },
    ];
    const res = await proposeActions({
      instruction: "the Roadmap board",
      history,
    });
    expect(vi.mocked(proposeLoop).mock.calls[0][0].messages).toEqual(history);
    expect(res.ok && res.data.history).toEqual(GROWN_TRANSCRIPT);
  });

  it("degrades malformed history to a fresh start (no seed messages)", async () => {
    const { proposeLoop } = await import("./propose");
    const res = await proposeActions({
      instruction: "create task X",
      history: [{ role: "system", content: "nope" }] as never,
    });
    expect(res.ok).toBe(true);
    expect(vi.mocked(proposeLoop).mock.calls[0][0].messages).toBeUndefined();
  });

  it("refuses past the 5-turn cap before any spend", async () => {
    const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
    const { proposeLoop } = await import("./propose");
    const history = Array.from({ length: 5 }, () => ({
      role: "user" as const,
      content: "reply",
    }));
    const res = await proposeActions({ instruction: "one more", history });
    expect(res.ok).toBe(false);
    expect(requireAiEntitlement).not.toHaveBeenCalled();
    expect(proposeLoop).not.toHaveBeenCalled();
  });
});

describe("executeActions", () => {
  it("re-validates and rejects a tampered action", async () => {
    const res = await executeActions({
      actions: [{ kind: "wipe_db" } as never],
    });
    expect(res.ok).toBe(false);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("runs each valid action", async () => {
    const res = await executeActions({
      actions: [
        {
          kind: "create_group",
          boardId: "b1",
          name: "Backlog",
          summary: "s",
          warnings: [],
        },
      ],
    });
    expect(res).toEqual({ ok: true, data: { results: [{ ok: true }] } });
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it("refuses to execute when the org has AI turned off", async () => {
    const { getAiEntitlement } = await import("@/lib/ai/entitlement");
    vi.mocked(getAiEntitlement).mockResolvedValueOnce({ mode: "off" } as never);
    const res = await executeActions({
      actions: [
        {
          kind: "create_group",
          boardId: "b1",
          name: "Backlog",
          summary: "s",
          warnings: [],
        },
      ],
    });
    expect(res.ok).toBe(false);
    expect(executeAction).not.toHaveBeenCalled();
  });
});
