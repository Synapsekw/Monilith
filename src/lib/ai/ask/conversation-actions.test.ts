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
const maybeSingleBoard = vi.fn();
const maybeSingleConv = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (t: string) => {
      if (t === "ai_conversations")
        return {
          insert: insertConv,
          update: updateConv,
          delete: deleteConv,
          select: () => ({ eq: () => ({ maybeSingle: maybeSingleConv }) }),
        };
      if (t === "user_agents")
        return {
          select: () => ({
            eq: () => ({ maybeSingle: maybeSingleAgent }),
          }),
        };
      if (t === "boards")
        return {
          select: () => ({
            eq: () => ({ maybeSingle: maybeSingleBoard }),
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
  maybeSingleBoard.mockReset();
  maybeSingleConv.mockReset();
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

  const FOREIGN_BOARD_ID = "55555555-5555-4555-8555-555555555555";

  beforeEach(() => {
    insertConv.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "c9" }, error: null }),
      }),
    });
    insertMsg.mockResolvedValue({ error: null });
    // `boards` is RLS-scoped to what the caller can read, so the default here is
    // "the caller is on this board".
    maybeSingleBoard.mockResolvedValue({ data: { id: BOARD_ID }, error: null });
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

  // ── C1: a uuid-shaped boardId is not a readable boardId ──────────────────
  it("rejects a boardId the caller cannot read", async () => {
    // `boards` SELECT is is_org_member(org_id) AND (created_by = auth.uid() OR
    // is_board_member(id)) — exactly can_read_board() — so a foreign board reads
    // back as null through the user client.
    maybeSingleBoard.mockResolvedValue({ data: null, error: null });
    const res = await createConversation({
      firstMessage: "planted by an outsider",
      boardId: FOREIGN_BOARD_ID,
    });
    expect(res).toEqual({ ok: false, error: "Board not found." });
    // Nothing is placed on someone else's board — not even a private row that
    // could later be flipped to visibility='board'.
    expect(insertConv).not.toHaveBeenCalled();
    expect(insertMsg).not.toHaveBeenCalled();
  });

  it("gives the same answer for a board that is not there at all", async () => {
    // One message for both "not yours" and "not there": a distinct message would
    // make this a board-membership oracle.
    maybeSingleBoard.mockResolvedValue({ data: null, error: null });
    const missing = await createConversation({
      firstMessage: "hi",
      boardId: "66666666-6666-4666-8666-666666666666",
    });
    const foreign = await createConversation({
      firstMessage: "hi",
      boardId: FOREIGN_BOARD_ID,
    });
    expect(missing).toEqual(foreign);
  });

  it("checks the board BEFORE the agent, and refuses on the board alone", async () => {
    maybeSingleBoard.mockResolvedValue({ data: null, error: null });
    maybeSingleAgent.mockResolvedValue({ data: { id: AGENT_ID }, error: null });
    const res = await createConversation({
      firstMessage: "hi",
      boardId: FOREIGN_BOARD_ID,
      agentId: AGENT_ID,
    });
    expect(res.ok).toBe(false);
    expect(insertConv).not.toHaveBeenCalled();
  });
});

describe("setThreadVisibility", () => {
  const CONV = "11111111-1111-4111-8111-111111111111";
  const BOARD = "22222222-2222-4222-8222-222222222222";

  const updateResolves = () =>
    updateConv.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi
            .fn()
            .mockResolvedValue({ data: { id: CONV }, error: null }),
        }),
      }),
    });

  it("rejects a value outside the two known states", async () => {
    const res = await setThreadVisibility({
      conversationId: CONV,
      visibility: "public" as never,
    });
    expect(res).toEqual({ ok: false, error: "Invalid visibility." });
  });

  it("shares a thread that is actually docked to a board", async () => {
    maybeSingleConv.mockResolvedValue({
      data: { board_id: BOARD },
      error: null,
    });
    updateResolves();
    const res = await setThreadVisibility({
      conversationId: CONV,
      visibility: "board",
    });
    expect(res).toEqual({ ok: true, data: { visibility: "board" } });
  });

  // ── I1: the policy's first conjunct is `board_id is not null` ─────────────
  it("refuses to share a boardless thread — the policy could never match it", async () => {
    // A briefing thread: owned by the caller, agent-authored, board_id null.
    // Setting visibility='board' here would paint a "Shared" chip on a thread
    // no board member can read, and arm a later slice that attaches a board.
    maybeSingleConv.mockResolvedValue({
      data: { board_id: null },
      error: null,
    });
    const res = await setThreadVisibility({
      conversationId: CONV,
      visibility: "board",
    });
    expect(res.ok).toBe(false);
    expect(updateConv).not.toHaveBeenCalled();
  });

  it("still lets a boardless thread be made private (the safe direction)", async () => {
    maybeSingleConv.mockResolvedValue({
      data: { board_id: null },
      error: null,
    });
    updateResolves();
    const res = await setThreadVisibility({
      conversationId: CONV,
      visibility: "private",
    });
    expect(res).toEqual({ ok: true, data: { visibility: "private" } });
    // Taking a thread back never needs the board read at all.
    expect(maybeSingleConv).not.toHaveBeenCalled();
  });

  it("refuses when the thread cannot be read back at all", async () => {
    maybeSingleConv.mockResolvedValue({ data: null, error: null });
    const res = await setThreadVisibility({
      conversationId: CONV,
      visibility: "board",
    });
    expect(res.ok).toBe(false);
    expect(updateConv).not.toHaveBeenCalled();
  });
});
