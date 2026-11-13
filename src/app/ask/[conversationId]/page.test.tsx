import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMessages, getConversationHeader } = vi.hoisted(() => ({
  getMessages: vi.fn(),
  getConversationHeader: vi.fn(),
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
  getConversationHeader: (id: string) => getConversationHeader(id),
  toThreadMessages: (rows: unknown[]) => rows,
}));
vi.mock("@/components/ai/ask/AskChat", () => ({ AskChat: () => null }));

import AskConversationPage from "./page";

const params = Promise.resolve({ conversationId: "c1" });
const propsOf = (el: unknown) =>
  (el as ReactElement<Record<string, unknown>>).props;

beforeEach(() => {
  vi.clearAllMocks();
  getMessages.mockResolvedValue([{ id: "m1", agent_id: "a1" }]);
  getConversationHeader.mockResolvedValue({
    ownerId: "u1",
    agentId: "a1",
    title: "T",
  });
});

describe("AskConversationPage", () => {
  it("renders the thread with its title and no agent props", async () => {
    const props = propsOf(await AskConversationPage({ params }));
    expect(props.conversationId).toBe("c1");
    expect(props.initialMessages).toEqual([{ id: "m1", agent_id: "a1" }]);
    expect(props.title).toBe("T");
    expect(props.readOnly).toBe(false);
    // Old briefing threads still render their messages, but the page no
    // longer reads proposals or agent personas for them.
    expect(props).not.toHaveProperty("agentProposals");
    expect(props).not.toHaveProperty("agents");
    expect(props).not.toHaveProperty("agentNames");
    expect(props).not.toHaveProperty("initialAgentId");
  });

  it("is read-only for someone who does not own the thread", async () => {
    getConversationHeader.mockResolvedValue({
      ownerId: "someone-else",
      agentId: null,
      title: "T",
    });
    const props = propsOf(await AskConversationPage({ params }));
    expect(props.readOnly).toBe(true);
  });

  it("404s an empty thread", async () => {
    getMessages.mockResolvedValue([]);
    await expect(AskConversationPage({ params })).rejects.toThrow("NOT_FOUND");
  });
});
