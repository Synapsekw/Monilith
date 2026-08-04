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
const maybeSingleAgent = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (t: string) => {
      if (t === "ai_conversations")
        return { insert: insertConv, update: updateConv, delete: deleteConv };
      if (t === "user_agents")
        return {
          select: () => ({
            eq: () => ({ maybeSingle: maybeSingleAgent }),
          }),
        };
      return { insert: insertMsg };
    },
  })),
}));

const getMessages = vi.fn();
vi.mock("./conversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./conversations")>()),
  getMessages: (id: string) => getMessages(id),
}));

import { revalidatePath } from "next/cache";
import {
  createConversation,
  appendUserMessage,
  renameConversation,
  deleteConversation,
  recoverConversation,
  setThreadVisibility,
} from "./conversation-actions";

beforeEach(() => {
  insertConv.mockReset();
  insertMsg.mockReset();
  updateConv.mockReset();
  deleteConv.mockReset();
  getMessages.mockReset();
  maybeSingleAgent.mockReset();
  vi.mocked(revalidatePath).mockReset();
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

describe("recoverConversation", () => {
  const CONV = "11111111-1111-4111-8111-111111111111";

  it("returns the persisted thread after a severed stream", async () => {
    getMessages.mockResolvedValue([
      {
        id: "m1",
        role: "user",
        content: "what's overdue?",
        tool_trace: null,
        created_at: "2026-07-27T10:00:00Z",
      },
      {
        id: "m2",
        role: "assistant",
        content: "Three items are overdue.",
        tool_trace: { boardsConsulted: ["b1"] },
        created_at: "2026-07-27T10:00:09Z",
      },
    ]);

    const res = await recoverConversation({ conversationId: CONV });
    expect(res).toEqual({
      ok: true,
      data: {
        messages: [
          { id: "m1", role: "user", content: "what's overdue?", trace: null },
          {
            id: "m2",
            role: "assistant",
            content: "Three items are overdue.",
            trace: { boardsConsulted: ["b1"] },
          },
        ],
      },
    });
    expect(getMessages).toHaveBeenCalledWith(CONV);
  });

  it("returns the thread unchanged when nothing landed — the caller decides", async () => {
    getMessages.mockResolvedValue([
      {
        id: "m1",
        role: "user",
        content: "what's overdue?",
        tool_trace: null,
        created_at: "2026-07-27T10:00:00Z",
      },
    ]);
    const res = await recoverConversation({ conversationId: CONV });
    expect(res.ok && res.data.messages.at(-1)?.role).toBe("user");
  });

  it("rejects a non-uuid conversation id before touching the DB", async () => {
    const res = await recoverConversation({ conversationId: "nope" });
    expect(res.ok).toBe(false);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("fails softly when the read throws", async () => {
    getMessages.mockRejectedValue(new Error("getMessages: boom"));
    const res = await recoverConversation({ conversationId: CONV });
    expect(res.ok).toBe(false);
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

describe("createConversation — board threads", () => {
  const BOARD_ID = "22222222-2222-4222-8222-222222222222";
  const AGENT_ID = "33333333-3333-4333-8333-333333333333";
  const FOREIGN_AGENT_ID = "44444444-4444-4444-8444-444444444444";

  beforeEach(() => {
    insertConv.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "c9" }, error: null }),
      }),
    });
    insertMsg.mockResolvedValue({ error: null });
  });

  it("rejects an agentId the caller does not own", async () => {
    // user_agents is owner-scoped by RLS, so a foreign id reads back as null.
    maybeSingleAgent.mockResolvedValue({ data: null, error: null });
    const res = await createConversation({
      firstMessage: "hi",
      boardId: BOARD_ID,
      agentId: FOREIGN_AGENT_ID,
    });
    expect(res).toEqual({ ok: false, error: "Agent not found." });
    expect(insertConv).not.toHaveBeenCalled();
  });

  it("stores board_id and agent_id, and defaults visibility to private", async () => {
    maybeSingleAgent.mockResolvedValue({ data: { id: AGENT_ID }, error: null });
    const res = await createConversation({
      firstMessage: "what is overdue?",
      boardId: BOARD_ID,
      agentId: AGENT_ID,
    });
    expect(res.ok).toBe(true);
    expect(insertConv).toHaveBeenCalledWith(
      expect.objectContaining({ board_id: BOARD_ID, agent_id: AGENT_ID }),
    );
    // Not passed explicitly — the column default is the guarantee.
    const inserted = insertConv.mock.calls[0][0];
    expect(inserted).not.toHaveProperty("visibility");
  });

  it("does not revalidate /ask for a board thread", async () => {
    maybeSingleAgent.mockResolvedValue({ data: { id: AGENT_ID }, error: null });
    await createConversation({ firstMessage: "hi", boardId: BOARD_ID });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setThreadVisibility", () => {
  it("rejects a value outside the two known states", async () => {
    const res = await setThreadVisibility({
      conversationId: "11111111-1111-4111-8111-111111111111",
      visibility: "public" as never,
    });
    expect(res).toEqual({ ok: false, error: "Invalid visibility." });
  });
});
