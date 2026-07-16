import { describe, expect, it, vi } from "vitest";

const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

import { getMyWorkItems, MY_WORK_ITEM_LIMIT } from "./queries";

const ROW = {
  item_id: "i1",
  item_name: "Ship it",
  board_id: "b1",
  board_name: "Launch",
  group_name: "Sprint 1",
  due_date: "2026-07-10",
  status_option_id: "opt1",
  status_settings: {
    options: [{ id: "opt1", label: "Working on it", color: "#e8a33d" }],
  },
};

describe("getMyWorkItems (RPC)", () => {
  it("returns [] for a logged-out caller without calling the RPC", async () => {
    getUser.mockResolvedValue(null);
    expect(await getMyWorkItems()).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fetches everything in ONE rpc call and maps to MyWorkItem", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const items = await getMyWorkItems();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_my_work_items", {
      p_limit: MY_WORK_ITEM_LIMIT,
    });
    expect(items).toEqual([
      {
        itemId: "i1",
        itemName: "Ship it",
        boardId: "b1",
        boardName: "Launch",
        groupName: "Sprint 1",
        status: { label: "Working on it", color: "#e8a33d" },
        dueDate: "2026-07-10",
      },
    ]);
  });

  it("degrades gracefully: unknown option, missing board name, rpc error", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    rpc.mockResolvedValueOnce({
      data: [
        {
          ...ROW,
          board_name: null,
          group_name: null,
          due_date: null,
          status_option_id: "gone",
        },
      ],
      error: null,
    });
    expect(await getMyWorkItems()).toEqual([
      {
        itemId: "i1",
        itemName: "Ship it",
        boardId: "b1",
        boardName: "Unknown board",
        groupName: null,
        status: null,
        dueDate: null,
      },
    ]);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await getMyWorkItems()).toEqual([]);
  });
});
