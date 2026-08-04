import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: vi.fn(async () => ({
    board: { id: "b1", name: "Roadmap" },
    groups: [
      { id: "g1", name: "Backlog" },
      { id: "g-software", name: "Software" },
    ],
    columns: [{ id: "c-due", name: "Due", kind: "date" }],
    items: [{ id: "i-qysea", name: "QYSEA", group_id: "g1", parent_id: null }],
    cellValues: [],
  })),
}));
vi.mock("@/lib/org/queries-cached", () => ({
  // OrgMember shape: { userId, fullName, email, avatarUrl }.
  listOrgMembersCached: vi.fn(async () => [
    { userId: "u1", fullName: "Dana Ruiz", email: null, avatarUrl: null },
  ]),
}));

import { createWriteToolExecutor, WRITE_TOOLS } from "./write-tools";

describe("createWriteToolExecutor", () => {
  it("propose_create_item records a ValidatedAction and never mutates", async () => {
    const exec = createWriteToolExecutor({ orgId: "org1", workspaceId: "ws1" });
    const res = await exec.execute("propose_create_item", {
      board_id: "b1",
      group_id: "g1",
      name: "Ship v2",
      due_date: "2026-07-17",
    });
    expect(res.content).toContain("Ship v2");
    const collected = exec.collected();
    expect(collected).toHaveLength(1);
    expect(collected[0].kind).toBe("create_item");
    expect(collected[0].summary).toContain("Backlog");
  });

  it("list_board_members returns resolved members", async () => {
    const exec = createWriteToolExecutor({ orgId: "org1", workspaceId: "ws1" });
    const res = await exec.execute("list_board_members", { board_id: "b1" });
    expect(res.content).toContain("Dana Ruiz");
    expect(res.content).toContain("u1");
    // Read tool records no proposal.
    expect(exec.collected()).toHaveLength(0);
  });

  it("returns an error preview when the board isn't found", async () => {
    const { getBoardPayload } = await import("@/lib/boards/queries");
    vi.mocked(getBoardPayload).mockResolvedValueOnce(null);
    const exec = createWriteToolExecutor({ orgId: "org1", workspaceId: "ws1" });
    const res = await exec.execute("propose_create_item", {
      board_id: "x",
      group_id: "g",
      name: "n",
    });
    expect(res.content).toContain("error");
    expect(exec.collected()).toHaveLength(0);
  });

  it("rejects a non-ISO due date with an error preview", async () => {
    const exec = createWriteToolExecutor({ orgId: "org1", workspaceId: "ws1" });
    const res = await exec.execute("propose_create_item", {
      board_id: "b1",
      group_id: "g1",
      name: "n",
      due_date: "Friday",
    });
    expect(res.content).toContain("error");
    expect(exec.collected()).toHaveLength(0);
  });
});

describe("propose_move_item", () => {
  it("is offered to the model with board, item and group required", () => {
    const tool = WRITE_TOOLS.find((t) => t.name === "propose_move_item");
    expect(tool).toBeDefined();
    expect(tool!.input_schema.required).toEqual([
      "board_id",
      "item_id",
      "group_id",
    ]);
    // The description must say it does not write — the model relies on this to
    // explain the confirm step to the user.
    expect(tool!.description).toMatch(/does not write|user confirms/i);
  });

  it("records a proposal and returns the preview without mutating", async () => {
    const exec = createWriteToolExecutor({ orgId: "o1", workspaceId: "w1" });
    const res = await exec.execute("propose_move_item", {
      board_id: "b1",
      item_id: "i-qysea",
      group_id: "g-software",
    });
    expect(JSON.parse(res.content)).toEqual({
      preview: 'Move "QYSEA" from Backlog to Software',
      warnings: [],
    });
    expect(exec.collected()).toHaveLength(1);
    expect(exec.collected()[0]).toMatchObject({
      kind: "move_item",
      boardId: "b1",
      itemId: "i-qysea",
      groupId: "g-software",
    });
  });

  it("surfaces the resolver's refusal and records nothing", async () => {
    const exec = createWriteToolExecutor({ orgId: "o1", workspaceId: "w1" });
    const res = await exec.execute("propose_move_item", {
      board_id: "b1",
      item_id: "i-qysea",
      group_id: "g-on-another-board",
    });
    expect(JSON.parse(res.content).error).toMatch(/isn't on this board/);
    expect(exec.collected()).toHaveLength(0);
  });

  it("rejects malformed args", async () => {
    const exec = createWriteToolExecutor({ orgId: "o1", workspaceId: "w1" });
    const res = await exec.execute("propose_move_item", { board_id: "b1" });
    expect(JSON.parse(res.content)).toEqual({ error: "invalid tool input" });
    expect(exec.collected()).toHaveLength(0);
  });
});
