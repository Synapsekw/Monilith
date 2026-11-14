import { beforeEach, describe, expect, it, vi } from "vitest";

const getFocusTodayCore = vi.fn();
vi.mock("@/lib/focus/queries", () => ({
  FOCUS_LIMIT: 20,
  getFocusTodayCore: (...a: unknown[]) => getFocusTodayCore(...a),
}));
const resolveOrgForTool = vi.fn();
vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: (...a: unknown[]) => resolveOrgForTool(...a),
}));

import { getFocusTodayHandler } from "./get-focus-today";

const supabase = { tag: "client" } as never;
const getClient = vi.fn(async () => supabase);

beforeEach(() => {
  getFocusTodayCore.mockReset();
  resolveOrgForTool.mockReset();
  getClient.mockClear();
  resolveOrgForTool.mockResolvedValue({ org: { id: "o1", name: "Acme" } });
});

describe("getFocusTodayHandler", () => {
  it("passes the pinned org, the actor and the folder to the engine", async () => {
    getFocusTodayCore.mockResolvedValue({
      ok: true,
      data: {
        today: "2026-11-14",
        timezoneAssumed: false,
        items: [],
        totals: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
    });
    await getFocusTodayHandler(getClient, "u1", {
      orgId: "o1",
      folderId: "f1",
    });
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(resolveOrgForTool).toHaveBeenCalledWith(supabase, "o1");
    expect(getFocusTodayCore).toHaveBeenCalledWith(supabase, {
      orgId: "o1",
      userId: "u1",
      folderId: "f1",
    });
  });

  it("returns tier names, reasons and totals, and no internal fields", async () => {
    getFocusTodayCore.mockResolvedValue({
      ok: true,
      data: {
        today: "2026-11-14",
        timezoneAssumed: true,
        items: [
          {
            itemId: "i1",
            itemName: "Ship the API",
            boardId: "b1",
            boardName: "Roadmap",
            groupName: null,
            status: "Working",
            dueDate: "2026-11-10",
            tier: 1,
            reason: "4 days overdue",
          },
        ],
        totals: { 1: 6, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
    });
    const result = await getFocusTodayHandler(getClient, "u1", {});
    expect(JSON.parse(result.content[0].text)).toEqual({
      today: "2026-11-14",
      timezoneAssumed: true,
      items: [
        {
          id: "i1",
          name: "Ship the API",
          boardId: "b1",
          board: "Roadmap",
          group: null,
          status: "Working",
          dueDate: "2026-11-10",
          tier: "overdue",
          reason: "4 days overdue",
        },
      ],
      totals: {
        overdue: 6,
        blocking: 0,
        dueSoon: 0,
        waitingOnReply: 0,
        stalled: 0,
      },
    });
  });

  it("says so when nothing is urgent", async () => {
    getFocusTodayCore.mockResolvedValue({
      ok: true,
      data: {
        today: "2026-11-14",
        timezoneAssumed: false,
        items: [],
        totals: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
    });
    const result = await getFocusTodayHandler(getClient, "u1", {});
    expect(JSON.parse(result.content[0].text).note).toMatch(/nothing urgent/i);
  });

  it("surfaces an engine failure as isError", async () => {
    getFocusTodayCore.mockResolvedValue({
      ok: false,
      error: "connection reset",
    });
    const result = await getFocusTodayHandler(getClient, "u1", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("connection reset");
  });
});
