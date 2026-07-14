import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: vi.fn(async () => ({
    board: { id: "b1", name: "Roadmap" },
    groups: [{ id: "g1", name: "Backlog" }],
    columns: [{ id: "c-due", name: "Due", kind: "date" }],
    items: [],
    cellValues: [],
  })),
}));
vi.mock("@/lib/org/queries-cached", () => ({
  // OrgMember shape: { userId, fullName, email, avatarUrl }.
  listOrgMembersCached: vi.fn(async () => [
    { userId: "u1", fullName: "Dana Ruiz", email: null, avatarUrl: null },
  ]),
}));

import { createWriteToolExecutor } from "./write-tools";

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
