import { describe, expect, it, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from })),
}));

import {
  listConversations,
  getMessages,
  toThreadMessages,
} from "./conversations";

beforeEach(() => from.mockReset());

describe("listConversations", () => {
  it("returns the user's conversations newest-first, bounded", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "c1", title: "A" }], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    const rows = await listConversations("user-1");
    expect(rows).toEqual([{ id: "c1", title: "A" }]);
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(100);
  });

  it("throws when the query errors", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    await expect(listConversations("u")).rejects.toThrow("listConversations");
  });
});

describe("getMessages", () => {
  it("returns a conversation's messages oldest-first, bounded", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: "m1", role: "user", content: "hi" }],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    const rows = await getMessages("conv-1");
    expect(rows).toEqual([{ id: "m1", role: "user", content: "hi" }]);
    expect(eq).toHaveBeenCalledWith("conversation_id", "conv-1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(limit).toHaveBeenCalledWith(200);
  });
});

describe("toThreadMessages", () => {
  const ACTION = {
    kind: "create_item",
    boardId: "b1",
    groupId: "g1",
    name: "Ship v2",
    summary: 'Create task "Ship v2" in Backlog',
    warnings: [],
  };

  it("maps rows to render-ready turns with a parsed trace", () => {
    expect(
      toThreadMessages([
        {
          id: "m1",
          role: "user",
          content: "create Ship v2",
          tool_trace: null,
          created_at: "2026-07-27T10:00:00Z",
        },
        {
          id: "m2",
          role: "assistant",
          content: "I'll create that.",
          tool_trace: { boardsConsulted: ["b1"], proposedActions: [ACTION] },
          created_at: "2026-07-27T10:00:05Z",
        },
      ]),
    ).toEqual([
      { id: "m1", role: "user", content: "create Ship v2", trace: null },
      {
        id: "m2",
        role: "assistant",
        content: "I'll create that.",
        trace: { boardsConsulted: ["b1"], proposedActions: [ACTION] },
      },
    ]);
  });

  it("degrades a malformed trace to null rather than dropping the turn", () => {
    expect(
      toThreadMessages([
        {
          id: "m1",
          role: "assistant",
          content: "hi",
          tool_trace: { proposedActions: "not-an-array" },
          created_at: "2026-07-27T10:00:00Z",
        },
      ]),
    ).toEqual([{ id: "m1", role: "assistant", content: "hi", trace: null }]);
  });
});
