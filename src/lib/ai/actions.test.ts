import { describe, expect, it, vi, beforeEach } from "vitest";

import { AiNotConfiguredError } from "@/lib/ai/anthropic";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));

const getBoardPayload = vi.fn();
const listMyBoards = vi.fn();
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (...args: unknown[]) => getBoardPayload(...args),
  listMyBoards: (...args: unknown[]) => listMyBoards(...args),
}));

const generateProposal = vi.fn();
vi.mock("@/lib/ai/generate", () => ({
  generateProposal: (...args: unknown[]) => generateProposal(...args),
}));

const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: (tag: string) => updateTag(tag),
}));

const BOARD_ID = "33333333-3333-4333-8333-333333333333";
const STATUS_COL = "44444444-4444-4444-8444-444444444444";

/** A board payload with one status column. `items`/`cells` are caller-supplied. */
function payload(
  items: { id: string }[],
  cells: { item_id: string; column_id: string; value: unknown }[] = [],
) {
  return {
    board: { id: BOARD_ID, name: "Sprint Board" },
    columns: [
      {
        id: STATUS_COL,
        name: "Status",
        kind: "status",
        settings: {
          options: [
            { id: "opt-done", label: "Done", color: "green" },
            { id: "opt-wip", label: "WIP", color: "orange" },
          ],
        },
      },
    ],
    items,
    cellValues: cells,
  };
}

beforeEach(() => {
  rpc.mockReset();
  getBoardPayload.mockReset();
  listMyBoards.mockReset();
  generateProposal.mockReset();
  updateTag.mockReset();
});

describe("generateDashboardProposal", () => {
  it("fails with the empty-board message when there are 0 rows (no LLM call)", async () => {
    getBoardPayload.mockResolvedValueOnce(payload([]));
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({ boardId: BOARD_ID });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe(
        "This board has no data to build a dashboard from yet.",
      );
    expect(generateProposal).not.toHaveBeenCalled();
  });

  it("maps a good generated proposal through validateProposal and returns it", async () => {
    getBoardPayload.mockResolvedValueOnce(
      payload(
        [{ id: "item-1" }, { id: "item-2" }],
        [
          {
            item_id: "item-1",
            column_id: STATUS_COL,
            value: { optionId: "opt-done" },
          },
          {
            item_id: "item-2",
            column_id: STATUS_COL,
            value: { optionId: "opt-wip" },
          },
        ],
      ),
    );
    generateProposal.mockResolvedValueOnce({
      proposal: {
        name: "Sprint Overview",
        widgets: [
          {
            kind: "battery",
            title: "Status",
            config: { groupColumnId: STATUS_COL },
            layout: { x: 0, y: 0, w: 4, h: 4 },
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({ boardId: BOARD_ID });
    expect(generateProposal).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.proposal.name).toBe("Sprint Overview");
      expect(res.data.proposal.widgets).toHaveLength(1);
      expect(res.data.proposal.widgets[0].kind).toBe("battery");
    }
  });

  it("returns the not-configured message when generateProposal throws AiNotConfiguredError", async () => {
    getBoardPayload.mockResolvedValueOnce(
      payload(
        [{ id: "item-1" }],
        [
          {
            item_id: "item-1",
            column_id: STATUS_COL,
            value: { optionId: "opt-done" },
          },
        ],
      ),
    );
    generateProposal.mockRejectedValueOnce(new AiNotConfiguredError());
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({ boardId: BOARD_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("AI generation isn't configured.");
  });

  it("fails when the board is not found", async () => {
    getBoardPayload.mockResolvedValueOnce(null);
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({ boardId: BOARD_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Board not found.");
  });
});

describe("createDashboardFromProposal", () => {
  it("composes the three RPCs and returns the new id", async () => {
    rpc
      .mockResolvedValueOnce({
        data: { id: "dash-1", org_id: "org-9" },
        error: null,
      }) // create_dashboard
      .mockResolvedValueOnce({ data: { id: "w-1" }, error: null }) // create_dashboard_widget
      .mockResolvedValueOnce({ data: null, error: null }); // set_widget_layouts
    const { createDashboardFromProposal } = await import("@/lib/ai/actions");
    const res = await createDashboardFromProposal({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      proposal: {
        name: "Sprint",
        sourceBoardId: "22222222-2222-4222-8222-222222222222",
        widgets: [
          {
            kind: "number",
            title: "Total",
            config: { agg: "count" },
            layout: { x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.dashboardId).toBe("dash-1");
    expect(rpc.mock.calls[0][0]).toBe("create_dashboard");
    expect(rpc.mock.calls[1][0]).toBe("create_dashboard_widget");
    expect(rpc.mock.calls[2][0]).toBe("set_widget_layouts");
    // one create_dashboard_widget call per widget
    expect(
      rpc.mock.calls.filter((c) => c[0] === "create_dashboard_widget"),
    ).toHaveLength(1);
    // read-your-own-writes: invalidates the created dashboard's org list
    expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-9");
  });

  it("fails with the RPC error message when create_dashboard errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    const { createDashboardFromProposal } = await import("@/lib/ai/actions");
    const res = await createDashboardFromProposal({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      proposal: {
        name: "Sprint",
        sourceBoardId: "22222222-2222-4222-8222-222222222222",
        widgets: [
          {
            kind: "number",
            title: "Total",
            config: { agg: "count" },
            layout: { x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("nope");
  });
});

describe("input validation (Zod at the boundary)", () => {
  it("getBoardSnapshotSummary rejects a non-uuid boardId before any query", async () => {
    const { getBoardSnapshotSummary } = await import("@/lib/ai/actions");
    const res = await getBoardSnapshotSummary({ boardId: "not-a-uuid" });
    expect(res.ok).toBe(false);
    expect(getBoardPayload).not.toHaveBeenCalled();
  });

  it("generateDashboardProposal rejects a non-uuid boardId", async () => {
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({ boardId: "nope" });
    expect(res.ok).toBe(false);
    expect(getBoardPayload).not.toHaveBeenCalled();
  });

  it("generateDashboardProposal rejects feedback longer than 2000 chars", async () => {
    const { generateDashboardProposal } = await import("@/lib/ai/actions");
    const res = await generateDashboardProposal({
      boardId: BOARD_ID,
      feedback: "x".repeat(2001),
    });
    expect(res.ok).toBe(false);
    // Never reaches the board fetch or the LLM.
    expect(getBoardPayload).not.toHaveBeenCalled();
    expect(generateProposal).not.toHaveBeenCalled();
  });

  it("createDashboardFromProposal rejects a widget whose config fails its kind schema", async () => {
    const { createDashboardFromProposal } = await import("@/lib/ai/actions");
    const res = await createDashboardFromProposal({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      proposal: {
        name: "Sprint",
        sourceBoardId: "22222222-2222-4222-8222-222222222222",
        widgets: [
          {
            kind: "battery", // requires config.groupColumnId (uuid)
            title: "Broken",
            config: {}, // passes the generic record schema, fails the kind schema
            layout: { x: 0, y: 0, w: 3, h: 2 },
          },
        ],
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Invalid widget config");
    // Nothing persisted.
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("listAiBoards", () => {
  it("maps workspace_id to workspaceId", async () => {
    listMyBoards.mockResolvedValueOnce([
      {
        id: "b-1",
        name: "Board",
        workspace_id: "ws-1",
        position: 0,
        shared_out: false,
      },
    ]);
    const { listAiBoards } = await import("@/lib/ai/actions");
    const res = await listAiBoards();
    expect(res.ok).toBe(true);
    if (res.ok)
      expect(res.data.boards).toEqual([
        { id: "b-1", name: "Board", workspaceId: "ws-1" },
      ]);
  });
});
