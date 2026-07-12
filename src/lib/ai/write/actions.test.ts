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
      },
    });
  });

  it("rejects a too-short instruction before any spend", async () => {
    const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
    const res = await proposeActions({ instruction: "x" });
    expect(res.ok).toBe(false);
    expect(requireAiEntitlement).not.toHaveBeenCalled();
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
