import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardPayload } from "@/lib/boards/queries";
import type { ReportAccess } from "@/lib/reports/access";
import type { ReportRow, ReportScope } from "@/lib/reports/queries";
import { REPORT_BOARDS_LIMIT } from "@/lib/reports/queries";

const getBoardPayload = vi.fn<(id: string) => Promise<BoardPayload | null>>();
const resolvePeopleNames =
  vi.fn<(p: BoardPayload) => Promise<Map<string, string>>>();
const resolveActiveOrg =
  vi.fn<() => Promise<{ id: string; name: string } | null>>();
const getPortfolio = vi.fn<(id: string) => Promise<{ name: string } | null>>();

vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (id: string) => getBoardPayload(id),
}));
vi.mock("@/lib/boards/people-names", () => ({
  resolvePeopleNames: (p: BoardPayload) => resolvePeopleNames(p),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: () => resolveActiveOrg(),
}));
vi.mock("@/lib/portfolios/queries", () => ({
  getPortfolio: (id: string) => getPortfolio(id),
}));

import { loadReportScopeContext } from "@/lib/reports/payload";

// ---------------------------------------------------------------- fixtures

const board = (id: string, name: string) =>
  ({
    board: { id, name },
    columns: [],
    groups: [],
    items: [],
    cellValues: [],
  }) as unknown as BoardPayload;

function report(o: Partial<ReportRow> & { scope: ReportScope }): ReportRow {
  return {
    id: "r1",
    orgId: "org1",
    boardId: null,
    portfolioId: null,
    name: "Q3 roll-up",
    config: { v: 1, title: "Status Report", blocks: [] },
    updatedAt: "2026-08-09T00:00:00Z",
    ...o,
  };
}

function access(o: Partial<ReportAccess> = {}): ReportAccess {
  const boardIds = o.boardIds ?? o.readableBoardIds ?? [];
  return {
    boardIds,
    readableBoardIds: o.readableBoardIds ?? boardIds,
    omittedCount: 0,
    canRead: true,
    canEdit: true,
    ...o,
  };
}

beforeEach(() => {
  getBoardPayload.mockReset();
  resolvePeopleNames.mockReset();
  resolveActiveOrg.mockReset();
  getPortfolio.mockReset();
  resolvePeopleNames.mockResolvedValue(new Map());
  resolveActiveOrg.mockResolvedValue({ id: "org1", name: "Acme Inc" });
  getPortfolio.mockResolvedValue(null);
  getBoardPayload.mockImplementation(async (id) => board(id, `Board ${id}`));
});

// ------------------------------------------------------------------- tests

describe("loadReportScopeContext", () => {
  it("loads one payload per readable board, in bound order", async () => {
    const ctx = await loadReportScopeContext(
      report({ scope: "boards" }),
      access({ readableBoardIds: ["b1", "b2", "b3"] }),
    );
    expect(ctx.payloads.map((p) => p.board.id)).toEqual(["b1", "b2", "b3"]);
    expect(ctx.omittedBoardCount).toBe(0);
    expect(ctx.orgName).toBe("Acme Inc");
  });

  it("fetches the payloads CONCURRENTLY, not one after another", async () => {
    let active = 0;
    let peak = 0;
    getBoardPayload.mockImplementation(async (id) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      return board(id, id);
    });
    await loadReportScopeContext(
      report({ scope: "boards" }),
      access({ readableBoardIds: ["b1", "b2", "b3"] }),
    );
    expect(peak).toBeGreaterThan(1);
  });

  it("drops payloads that come back null and counts them as omitted", async () => {
    getBoardPayload.mockImplementation(async (id) =>
      id === "b2" ? null : board(id, `Board ${id}`),
    );
    const ctx = await loadReportScopeContext(
      report({ scope: "boards" }),
      access({
        boardIds: ["b1", "b2", "b3", "hidden"],
        readableBoardIds: ["b1", "b2", "b3"],
        omittedCount: 1,
      }),
    );
    expect(ctx.payloads.map((p) => p.board.id)).toEqual(["b1", "b3"]);
    // 1 unreadable (access) + 1 that failed to load.
    expect(ctx.omittedBoardCount).toBe(2);
  });

  it("caps the fan-out at REPORT_BOARDS_LIMIT and discloses the remainder", async () => {
    const ids = Array.from(
      { length: REPORT_BOARDS_LIMIT + 3 },
      (_, i) => `b${i}`,
    );
    const ctx = await loadReportScopeContext(
      report({ scope: "boards" }),
      access({ readableBoardIds: ids }),
    );
    expect(ctx.payloads).toHaveLength(REPORT_BOARDS_LIMIT);
    expect(getBoardPayload).toHaveBeenCalledTimes(REPORT_BOARDS_LIMIT);
    expect(ctx.omittedBoardCount).toBe(3);
  });

  it("merges the people-name maps of every payload", async () => {
    resolvePeopleNames.mockImplementation(async (p) =>
      p.board.id === "b1"
        ? new Map([["u1", "Ada"]])
        : new Map([["u2", "Grace"]]),
    );
    const ctx = await loadReportScopeContext(
      report({ scope: "boards" }),
      access({ readableBoardIds: ["b1", "b2"] }),
    );
    expect([...ctx.peopleNames.entries()].sort()).toEqual([
      ["u1", "Ada"],
      ["u2", "Grace"],
    ]);
  });

  describe("scopeLabel", () => {
    it("is the home board's name for scope 'board'", async () => {
      const ctx = await loadReportScopeContext(
        report({ scope: "board", boardId: "b1" }),
        access({ readableBoardIds: ["b1"] }),
      );
      expect(ctx.scopeLabel).toBe("Board b1");
      expect(getPortfolio).not.toHaveBeenCalled();
    });

    it("is the portfolio's name for scope 'portfolio'", async () => {
      getPortfolio.mockResolvedValue({ name: "FY26 Portfolio" });
      const ctx = await loadReportScopeContext(
        report({ scope: "portfolio", portfolioId: "p1" }),
        access({ readableBoardIds: ["b1", "b2"] }),
      );
      expect(getPortfolio).toHaveBeenCalledWith("p1");
      expect(ctx.scopeLabel).toBe("FY26 Portfolio");
    });

    it("falls back to empty when the portfolio is not readable", async () => {
      getPortfolio.mockResolvedValue(null);
      const ctx = await loadReportScopeContext(
        report({ scope: "portfolio", portfolioId: "p1" }),
        access({ readableBoardIds: ["b1"] }),
      );
      expect(ctx.scopeLabel).toBe("");
    });

    it("is the report's own name for scope 'boards'", async () => {
      const ctx = await loadReportScopeContext(
        report({ scope: "boards", name: "Exec roll-up" }),
        access({ readableBoardIds: ["b1", "b2"] }),
      );
      expect(ctx.scopeLabel).toBe("Exec roll-up");
    });

    it("is empty for a template, which loads no boards at all", async () => {
      const ctx = await loadReportScopeContext(
        report({ scope: "template" }),
        access({ readableBoardIds: [] }),
      );
      expect(ctx.scopeLabel).toBe("");
      expect(ctx.payloads).toEqual([]);
      expect(getBoardPayload).not.toHaveBeenCalled();
    });
  });

  it("falls back to an EMPTY org name, never a board name", async () => {
    // Regression: the v1 action fell back to `payload.board.name`, which printed
    // a board name where the organization goes on the cover.
    resolveActiveOrg.mockResolvedValue(null);
    const ctx = await loadReportScopeContext(
      report({ scope: "board", boardId: "b1" }),
      access({ readableBoardIds: ["b1"] }),
    );
    expect(ctx.orgName).toBe("");
    expect(ctx.orgName).not.toBe("Board b1");
  });
});
