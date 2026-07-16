import { describe, expect, it, vi, beforeEach } from "vitest";

const rpcUser = { id: "u1" };
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => rpcUser),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: vi.fn(async () => ({
    id: "org1",
    name: "O",
    timezone: "UTC",
  })),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: vi.fn(async () => [{ id: "ws1" }]),
}));
vi.mock("@/lib/workspaces/active", () => ({
  getActiveWorkspaceId: vi.fn(async () => "ws1"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const insertConv = vi.fn();
const insertMsg = vi.fn();
const updateConv = vi.fn();
const deleteConv = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (t: string) => {
      if (t === "ai_conversations")
        return { insert: insertConv, update: updateConv, delete: deleteConv };
      return { insert: insertMsg };
    },
  })),
}));

import {
  createConversation,
  appendUserMessage,
  renameConversation,
  deleteConversation,
} from "./conversation-actions";

beforeEach(() => {
  insertConv.mockReset();
  insertMsg.mockReset();
  updateConv.mockReset();
  deleteConv.mockReset();
});

describe("createConversation", () => {
  it("inserts a conversation + first user message", async () => {
    insertConv.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "c9" }, error: null }),
      }),
    });
    insertMsg.mockResolvedValue({ error: null });

    const res = await createConversation({ firstMessage: "what is overdue?" });
    expect(res).toEqual({ ok: true, data: { conversationId: "c9" } });
    expect(insertMsg).toHaveBeenCalledWith({
      conversation_id: "c9",
      role: "user",
      content: "what is overdue?",
    });
  });

  it("rejects an empty message before touching the DB", async () => {
    const res = await createConversation({ firstMessage: "   " });
    expect(res.ok).toBe(false);
    expect(insertConv).not.toHaveBeenCalled();
  });
});

describe("appendUserMessage", () => {
  it("inserts a follow-up and returns its id", async () => {
    insertMsg.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "m2" }, error: null }),
      }),
    });
    const res = await appendUserMessage({
      conversationId: "11111111-1111-4111-8111-111111111111",
      content: "and which is highest priority?",
    });
    expect(res).toEqual({ ok: true, data: { messageId: "m2" } });
  });

  it("rejects a non-uuid conversation id", async () => {
    const res = await appendUserMessage({
      conversationId: "not-a-uuid",
      content: "hi",
    });
    expect(res.ok).toBe(false);
  });
});

describe("renameConversation", () => {
  it("updates the title", async () => {
    updateConv.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const res = await renameConversation({
      conversationId: "11111111-1111-4111-8111-111111111111",
      title: "Overdue triage",
    });
    expect(res).toEqual({ ok: true, data: { title: "Overdue triage" } });
  });
});

describe("deleteConversation", () => {
  it("deletes the conversation", async () => {
    deleteConv.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const res = await deleteConversation({
      conversationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res).toEqual({ ok: true, data: {} });
  });
});
