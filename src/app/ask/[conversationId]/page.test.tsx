import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getMessages,
  getConversationRunId,
  getConversationHeader,
  listOwnerAgentTargets,
  listAgentNamesByIds,
  listPendingProposalsForRun,
  withResolvedTargets,
} = vi.hoisted(() => ({
  getMessages: vi.fn(),
  getConversationRunId: vi.fn(),
  getConversationHeader: vi.fn(),
  listOwnerAgentTargets: vi.fn(),
  listAgentNamesByIds: vi.fn(),
  listPendingProposalsForRun: vi.fn(),
  withResolvedTargets: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/ai/ask/conversations", () => ({
  getMessages: (id: string) => getMessages(id),
  getConversationRunId: (id: string) => getConversationRunId(id),
  getConversationHeader: (id: string) => getConversationHeader(id),
  toThreadMessages: (rows: unknown[]) => rows,
}));
vi.mock("@/lib/ai/ask/owner-agents", () => ({
  listAgentNamesByIds: (ids: string[]) => listAgentNamesByIds(ids),
  listOwnerAgentTargets: (id: string) => listOwnerAgentTargets(id),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ client: true }),
}));
vi.mock("@/lib/agents/proposals-db", () => ({
  listPendingProposalsForRun: (c: unknown, runId: string) =>
    listPendingProposalsForRun(c, runId),
}));
vi.mock("@/lib/agents/proposal-targets", () => ({
  withResolvedTargets: (c: unknown, list: unknown[]) =>
    withResolvedTargets(c, list),
}));
vi.mock("@/components/ai/ask/AskChat", () => ({ AskChat: () => null }));

import AskConversationPage from "./page";

const params = Promise.resolve({ conversationId: "c1" });
const propsOf = (el: unknown) =>
  (el as ReactElement<Record<string, unknown>>).props;

beforeEach(() => {
  vi.clearAllMocks();
  getMessages.mockResolvedValue([{ id: "m1", agent_id: "a1" }]);
  getConversationRunId.mockResolvedValue("run1");
  getConversationHeader.mockResolvedValue({
    ownerId: "u1",
    agentId: null,
    title: "T",
  });
  listOwnerAgentTargets.mockResolvedValue([]);
  listAgentNamesByIds.mockResolvedValue({ a1: "Scout" });
  listPendingProposalsForRun.mockResolvedValue([{ id: "p1" }]);
  withResolvedTargets.mockImplementation(async (_c, list) => list);
});

describe("AskConversationPage — second read wave", () => {
  it("starts the proposals read while the agent-names read is still pending", async () => {
    let releaseNames: (v: Record<string, string>) => void = () => {};
    listAgentNamesByIds.mockReturnValue(
      new Promise((resolve) => {
        releaseNames = resolve;
      }),
    );

    const pending = AskConversationPage({ params });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A serial page never asks for proposals until the names have answered.
    expect(listAgentNamesByIds).toHaveBeenCalledWith(["a1"]);
    expect(listPendingProposalsForRun).toHaveBeenCalledTimes(1);
    expect(withResolvedTargets).toHaveBeenCalledTimes(1);

    releaseNames({ a1: "Scout" });
    const props = propsOf(await pending);
    expect(props.agentNames).toEqual({ a1: "Scout" });
    expect(props.agentProposals).toEqual([{ id: "p1" }]);
  });

  it("issues no proposal read for a thread with no run", async () => {
    getConversationRunId.mockResolvedValue(null);

    const props = propsOf(await AskConversationPage({ params }));

    expect(listPendingProposalsForRun).not.toHaveBeenCalled();
    expect(props.agentProposals).toEqual([]);
  });

  it("degrades a failed proposal read to none instead of failing the page", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listPendingProposalsForRun.mockRejectedValue(new Error("boom"));

    const props = propsOf(await AskConversationPage({ params }));

    expect(props.agentProposals).toEqual([]);
    expect(props.agentNames).toEqual({ a1: "Scout" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("still 404s an empty thread before the second wave", async () => {
    getMessages.mockResolvedValue([]);

    await expect(AskConversationPage({ params })).rejects.toThrow("NOT_FOUND");
    expect(listAgentNamesByIds).not.toHaveBeenCalled();
    expect(listPendingProposalsForRun).not.toHaveBeenCalled();
  });
});
