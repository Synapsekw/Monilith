import { describe, expect, it, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from })),
}));

import { listConversations, getMessages } from "./conversations";

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
