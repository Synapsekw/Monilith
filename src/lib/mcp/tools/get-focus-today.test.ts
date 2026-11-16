import { beforeEach, describe, expect, it, vi } from "vitest";

const getFocusTodayCore = vi.fn();
vi.mock("@/lib/focus/queries", () => ({
  FOCUS_LIMIT: 20,
  getFocusTodayCore: (...a: unknown[]) => getFocusTodayCore(...a),
}));
const resolveOrgForScope = vi.fn();
vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForScope: (...a: unknown[]) => resolveOrgForScope(...a),
}));

import { getFocusTodayHandler } from "./get-focus-today";

const supabase = { tag: "client" } as never;
const getClient = vi.fn(async () => supabase);

beforeEach(() => {
  getFocusTodayCore.mockReset();
  resolveOrgForScope.mockReset();
  getClient.mockClear();
  resolveOrgForScope.mockResolvedValue({ org: { id: "o1", name: "Acme" } });
});

describe("getFocusTodayHandler", () => {
  it("passes the pinned org, the actor and the folder to the engine", async () => {
    getFocusTodayCore.mockResolvedValue({
      ok: true,
      data: {
        today: "2026-11-14",
        timezoneAssumed: false,
        items: [],
        totals: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        ordering: "current",
      },
    });
    await getFocusTodayHandler(getClient, "u1", {
      orgId: "o1",
      folderId: "f1",
    });
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(resolveOrgForScope).toHaveBeenCalledWith(supabase, {
      orgId: "o1",
      folderId: "f1",
    });
    expect(getFocusTodayCore).toHaveBeenCalledWith(supabase, {
      orgId: "o1",
      userId: "u1",
      orgTimeZone: null,
      folderId: "f1",
    });
  });

  it("takes the org from the folder when only folderId is given (review I2)", async () => {
    resolveOrgForScope.mockResolvedValue({
      org: { id: "o2", name: "Globex", timezone: "UTC" },
    });
    getFocusTodayCore.mockResolvedValue({
      ok: true,
      data: {
        today: "2026-11-14",
        timezoneAssumed: false,
        items: [],
        totals: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        ordering: "current",
      },
    });
    await getFocusTodayHandler(getClient, "u1", { folderId: "f2" });
    expect(resolveOrgForScope).toHaveBeenCalledWith(supabase, {
      folderId: "f2",
    });
    expect(getFocusTodayCore).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ orgId: "o2", folderId: "f2" }),
    );
  });

  it("passes the org's zone so the day matches the member's org (review I5)", async () => {
    resolveOrgForScope.mockResolvedValue({
      org: { id: "o1", name: "Acme", timezone: "Asia/Tokyo" },
    });
    getFocusTodayCore.mockResolvedValue({ ok: false, error: "x" });
    await getFocusTodayHandler(getClient, "u1", {});
    expect(getFocusTodayCore).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ orgTimeZone: "Asia/Tokyo" }),
    );
  });

  it("reports an unreadable folder instead of an empty day", async () => {
    resolveOrgForScope.mockResolvedValue({ error: "Folder not found." });
    const result = await getFocusTodayHandler(getClient, "u1", {
      folderId: "f9",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Folder not found.");
    expect(getFocusTodayCore).not.toHaveBeenCalled();
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
            canEdit: true,
            canMarkDone: true,
            canSetDue: true,
          },
        ],
        totals: { 0: 2, 1: 6, 2: 0, 3: 0, 4: 0, 5: 0 },
        ordering: "current",
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
        dueToday: 2,
        overdue: 6,
        blocking: 0,
        dueSoon: 0,
        waitingOnReply: 0,
        stalled: 0,
      },
    });
  });

  it("reports a tier cut off by the limit as unknown, never as 0 (deferred minor m1)", async () => {
    getFocusTodayCore.mockResolvedValue({
      ok: true,
      data: {
        today: "2026-11-14",
        timezoneAssumed: false,
        items: [],
        totals: { 0: null, 1: 6, 2: 0, 3: 14, 4: null, 5: null },
        ordering: "legacy",
      },
    });
    const body = JSON.parse(
      (await getFocusTodayHandler(getClient, "u1", {})).content[0].text,
    );
    expect(body.totals).toEqual({
      overdue: 6,
      blocking: 0,
      dueSoon: 14,
      waitingOnReply: null,
      stalled: null,
    });
    // The older function has no "due today" tier: it is left out, not
    // reported as unknown.
    expect(body.totalsNote).toMatch(/for waitingOnReply and stalled are/);
    expect(body.totalsNote).not.toMatch(/dueToday/);
    expect(body.totalsNote).toMatch(/unknown/);
  });

  it("says so when nothing is urgent", async () => {
    getFocusTodayCore.mockResolvedValue({
      ok: true,
      data: {
        today: "2026-11-14",
        timezoneAssumed: false,
        items: [],
        totals: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        ordering: "current",
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
