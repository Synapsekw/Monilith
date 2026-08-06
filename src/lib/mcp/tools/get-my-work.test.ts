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

const ROW_WITH_STATUS = {
  item_id: "i2",
  item_name: "Write the spec",
  board_id: "b1",
  board_name: "Roadmap",
  group_name: "In progress",
  status_option_id: "opt-1",
  status_settings: {
    options: [{ id: "opt-1", label: "Blocked", color: "#ff0000" }],
  },
  due_date: "2020-01-02",
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

  it("projects a resolved status option as its label, with no color anywhere", async () => {
    const rpc = vi.fn(async () => ({
      data: [ROW_WITH_STATUS],
      error: null,
    }));
    const getClient = vi.fn(async () => ({ rpc }) as never);

    const result = await getMyWorkHandler(getClient);
    const text = result.content[0].text;
    const parsed = JSON.parse(text);

    const item = parsed.groups
      .flatMap((g: { items: { id: string }[] }) => g.items)
      .find((i: { id: string }) => i.id === "i2");
    expect(item.status).toBe("Blocked");
    expect(text).not.toContain("#ff0000");
    expect(text).not.toContain("color");
  });

  it("returns an empty group list when nothing is assigned", async () => {
    const getClient = vi.fn(
      async () => ({ rpc: async () => ({ data: [], error: null }) }) as never,
    );
    const result = await getMyWorkHandler(getClient);
    expect(JSON.parse(result.content[0].text).groups).toEqual([]);
  });

  it("surfaces an RPC failure as isError with the message", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "connection reset" },
    }));
    const getClient = vi.fn(async () => ({ rpc }) as never);

    const result = await getMyWorkHandler(getClient);

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("connection reset");
  });
});
