import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { resizeNameColumn } from "@/lib/boards/actions";

const BOARD = "11111111-1111-4111-8111-111111111111";
beforeEach(() => from.mockReset());

describe("resizeNameColumn", () => {
  it("updates name_column_width on the board", async () => {
    const update = vi
      .fn()
      .mockReturnValue({ eq: async () => ({ error: null }) });
    from.mockImplementation((t: string) => (t === "boards" ? { update } : {}));
    const res = await resizeNameColumn({ boardId: BOARD, width: 320 });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ name_column_width: 320 });
  });

  it("accepts null (auto-fit)", async () => {
    const update = vi
      .fn()
      .mockReturnValue({ eq: async () => ({ error: null }) });
    from.mockImplementation((t: string) => (t === "boards" ? { update } : {}));
    const res = await resizeNameColumn({ boardId: BOARD, width: null });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ name_column_width: null });
  });

  it("rejects out-of-range widths before any db call", async () => {
    const res = await resizeNameColumn({ boardId: BOARD, width: 5000 });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});
