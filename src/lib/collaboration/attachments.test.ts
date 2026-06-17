import { describe, it, expect, vi } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from }) }));

import { getItemAttachments } from "@/lib/collaboration/attachments";

const ITEM = "33333333-3333-4333-8333-333333333333";

describe("getItemAttachments", () => {
  it("reads the latest 50 for the item, newest first, no URL minting", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: "x", item_id: ITEM }],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });

    const rows = await getItemAttachments(ITEM);

    expect(from).toHaveBeenCalledWith("attachments");
    expect(select).toHaveBeenCalledWith("*");
    expect(eq).toHaveBeenCalledWith("item_id", ITEM);
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
    expect(rows).toEqual([{ id: "x", item_id: ITEM }]);
  });
});
