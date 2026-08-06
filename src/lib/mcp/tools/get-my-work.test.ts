import { describe, expect, it, vi } from "vitest";
import { getMyWorkHandler, MY_WORK_TOOL_LIMIT } from "./get-my-work";

const ROW = {
  item_id: "i1",
  item_name: "Ship the API",
  board_id: "b1",
  board_name: "Roadmap",
  group_name: "In progress",
  status_option_id: null,
  status_settings: null,
  due_date: "2020-01-01",
};

describe("getMyWorkHandler", () => {
  it("buckets items and projects them without UI fields", async () => {
    const rpc = vi.fn(async () => ({ data: [ROW], error: null }));
    const getClient = vi.fn(async () => ({ rpc }) as never);

    const result = await getMyWorkHandler(getClient);

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_my_work_items", {
      p_limit: MY_WORK_TOOL_LIMIT,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.groups[0].bucket).toBe("overdue");
    expect(parsed.groups[0].items[0]).toEqual({
      id: "i1",
      name: "Ship the API",
      boardId: "b1",
      boardName: "Roadmap",
      groupName: "In progress",
      dueDate: "2020-01-01",
      status: null,
    });
  });

  it("returns an empty group list when nothing is assigned", async () => {
    const getClient = vi.fn(
      async () => ({ rpc: async () => ({ data: [], error: null }) }) as never,
    );
    const result = await getMyWorkHandler(getClient);
    expect(JSON.parse(result.content[0].text).groups).toEqual([]);
  });
});
