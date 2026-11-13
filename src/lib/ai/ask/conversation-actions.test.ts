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
const maybeSingleBoard = vi.fn();
const maybeSingleFolder = vi.fn();
const maybeSingleConv = vi.fn();
const fromCalls: string[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (t: string) => {
      fromCalls.push(t);
      if (t === "ai_conversations")
        return {
          insert: insertConv,
          update: updateConv,
          delete: deleteConv,
          select: () => ({ eq: () => ({ maybeSingle: maybeSingleConv }) }),
        };
      if (t === "boards")
        return {
          select: () => ({
            eq: () => ({ maybeSingle: maybeSingleBoard }),
          }),
        };
      if (t === "folders")
        return {
          select: () => ({
            eq: () => ({ maybeSingle: maybeSingleFolder }),
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
  getMessages.mockResolvedValue([]);
  maybeSingleBoard.mockReset();
  maybeSingleFolder.mockReset();
  maybeSingleConv.mockReset();
  maybeSingleConv.mockResolvedValue({ data: null, error: null });
  fromCalls.length = 0;
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
    // The org assistant answers every thread: no persona is stamped or read.
    expect(insertConv.mock.calls[0][0]).not.toHaveProperty("agent_id");
    expect(fromCalls).not.toContain("user_agents");
  });

  it("treats a leading @handle as plain text, never a persona", async () => {
    insertConv.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "c9" }, error: null }),
      }),
    });
    insertMsg.mockResolvedValue({ error: null });
    const res = await createConversation({
      firstMessage: "@ops what slipped?",
    });
    expect(res).toEqual({ ok: true, data: { conversationId: "c9" } });
    expect(insertConv.mock.calls[0][0]).not.toHaveProperty("agent_id");
    expect(fromCalls).not.toContain("user_agents");
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
    expect(insertMsg).toHaveBeenCalledWith({
      conversation_id: "11111111-1111-4111-8111-111111111111",
      role: "user",
      content: "and which is highest priority?",
    });
    expect(fromCalls).not.toContain("user_agents");
    expect(updateConv).not.toHaveBeenCalled();
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

  const FOREIGN_BOARD_ID = "55555555-5555-4555-8555-555555555555";

  beforeEach(() => {
    insertConv.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "c9" }, error: null }),
      }),
    });
    insertMsg.mockResolvedValue({ error: null });
    // `boards` is RLS-scoped to what the caller can read, so the default here is
    // "the caller is on this board, and it is in the org they are acting as".
    maybeSingleBoard.mockResolvedValue({
      data: { id: BOARD_ID, org_id: "org1" },
      error: null,
    });
  });

  it("stores board_id, and defaults visibility to private", async () => {
    const res = await createConversation({
      firstMessage: "what is overdue?",
      boardId: BOARD_ID,
    });
    expect(res.ok).toBe(true);
    expect(insertConv).toHaveBeenCalledWith(
      expect.objectContaining({ board_id: BOARD_ID }),
    );
    // Not passed explicitly — the column default is the guarantee.
    const inserted = insertConv.mock.calls[0][0];
    expect(inserted).not.toHaveProperty("visibility");
  });

  it("does not revalidate /ask for a board thread", async () => {
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

  // ── the board's org IS the thread's org ──────────────────────────────────
  const OTHER_ORG_ID = "77777777-7777-4777-8777-777777777777";

  it("refuses a board that lives in a different org than the active one", async () => {
    // Reachable with no attack: the board page does not reconcile the
    // pulse_active_org cookie, so a multi-org user viewing org A's board with
    // the cookie on org B lands here. The DB constraint refuses this row; this
    // guard is what turns a SQLSTATE into a sentence.
    maybeSingleBoard.mockResolvedValue({
      data: { id: BOARD_ID, org_id: OTHER_ORG_ID },
      error: null,
    });
    const res = await createConversation({
      firstMessage: "hi",
      boardId: BOARD_ID,
    });
    expect(res).toEqual({
      ok: false,
      error:
        "This board is in a different organization. Switch to it to chat here.",
    });
    expect(insertConv).not.toHaveBeenCalled();
    expect(insertMsg).not.toHaveBeenCalled();
  });

  it("still answers 'Board not found.' for an unreadable board, org or no org", async () => {
    // Ordering: the unreadable-board check runs FIRST and keeps its single
    // ambiguous message. If the org mismatch were reported for a board the
    // caller cannot read, the pair would become a membership oracle.
    maybeSingleBoard.mockResolvedValue({ data: null, error: null });
    const res = await createConversation({
      firstMessage: "hi",
      boardId: FOREIGN_BOARD_ID,
    });
    expect(res).toEqual({ ok: false, error: "Board not found." });
  });

  it("accepts a board in the active org and stamps that org on the thread", async () => {
    maybeSingleBoard.mockResolvedValue({
      data: { id: BOARD_ID, org_id: "org1" },
      error: null,
    });
    const res = await createConversation({
      firstMessage: "hi",
      boardId: BOARD_ID,
    });
    expect(res.ok).toBe(true);
    expect(insertConv).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: "org1", board_id: BOARD_ID }),
    );
  });

  it("does not read boards at all when no boardId is given", async () => {
    // /ask must keep behaving exactly as before: no board read, no org
    // comparison, and it still revalidates.
    const res = await createConversation({ firstMessage: "hi" });
    expect(res.ok).toBe(true);
    expect(maybeSingleBoard).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/ask");
  });
});

describe("createConversation — folder threads", () => {
  const FOLDER_ID = "88888888-8888-4888-8888-888888888888";
  const FOREIGN_FOLDER_ID = "99999999-9999-4999-8999-999999999999";
  const OTHER_ORG_ID = "77777777-7777-4777-8777-777777777777";

  beforeEach(() => {
    insertConv.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "c9" }, error: null }),
      }),
    });
    insertMsg.mockResolvedValue({ error: null });
    // `folders` is RLS-scoped to what the caller can read, so the default here
    // is "the caller is a member of this folder's org".
    maybeSingleFolder.mockResolvedValue({
      data: { id: FOLDER_ID, org_id: "org1" },
      error: null,
    });
  });

  it("stores folder_id for a readable folder in the active org", async () => {
    const res = await createConversation({
      firstMessage: "what is late in this project?",
      folderId: FOLDER_ID,
    });
    expect(res.ok).toBe(true);
    expect(insertConv).toHaveBeenCalledWith(
      expect.objectContaining({ folder_id: FOLDER_ID }),
    );
  });

  it("rejects a folder from another org", async () => {
    maybeSingleFolder.mockResolvedValue({
      data: { id: FOLDER_ID, org_id: OTHER_ORG_ID },
      error: null,
    });
    const res = await createConversation({
      firstMessage: "hi",
      folderId: FOLDER_ID,
    });
    expect(res).toEqual({ ok: false, error: "Folder not found." });
    expect(insertConv).not.toHaveBeenCalled();
  });

  it("gives the same answer for a folder that is not there at all", async () => {
    maybeSingleFolder.mockResolvedValue({ data: null, error: null });
    const res = await createConversation({
      firstMessage: "hi",
      folderId: FOREIGN_FOLDER_ID,
    });
    expect(res).toEqual({ ok: false, error: "Folder not found." });
    expect(insertConv).not.toHaveBeenCalled();
  });

  it("boardId wins when both are given", async () => {
    const BOARD_ID = "22222222-2222-4222-8222-222222222222";
    maybeSingleBoard.mockResolvedValue({
      data: { id: BOARD_ID, org_id: "org1" },
      error: null,
    });
    const res = await createConversation({
      firstMessage: "hi",
      boardId: BOARD_ID,
      folderId: FOLDER_ID,
    });
    expect(res.ok).toBe(true);
    expect(insertConv).toHaveBeenCalledWith(
      expect.objectContaining({ board_id: BOARD_ID, folder_id: null }),
    );
    expect(maybeSingleFolder).not.toHaveBeenCalled();
  });

  it("does not read folders at all when no folderId is given", async () => {
    const res = await createConversation({ firstMessage: "hi" });
    expect(res.ok).toBe(true);
    expect(maybeSingleFolder).not.toHaveBeenCalled();
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
