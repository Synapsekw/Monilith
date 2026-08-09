import { describe, expect, it } from "vitest";
import { deriveReportAccess, canEditReports } from "./access";
import type { ReportScope } from "./queries";

type Level = "owner" | "editor" | "viewer" | null;

/** Build the `accessByBoardId` map from a compact `{ b1: "editor" }` literal. */
function accessMap(entries: Record<string, Level>): Map<string, Level> {
  return new Map(Object.entries(entries));
}

function derive(over: {
  scope?: ReportScope;
  boardIds?: string[];
  accessByBoardId?: Record<string, Level>;
  isCreator?: boolean;
  isOrgAdmin?: boolean;
}) {
  return deriveReportAccess({
    scope: over.scope ?? "boards",
    boardIds: over.boardIds ?? [],
    accessByBoardId: accessMap(over.accessByBoardId ?? {}),
    isCreator: over.isCreator ?? false,
    isOrgAdmin: over.isOrgAdmin ?? false,
  });
}

describe("deriveReportAccess — readableBoardIds / omittedCount", () => {
  it("keeps only the bound boards with non-null access, in bound order", () => {
    const access = derive({
      boardIds: ["b1", "b2", "b3"],
      accessByBoardId: { b1: "viewer", b2: null, b3: "owner" },
    });
    expect(access.boardIds).toEqual(["b1", "b2", "b3"]);
    expect(access.readableBoardIds).toEqual(["b1", "b3"]);
  });

  it("treats a board missing from the access map as unreadable", () => {
    const access = derive({
      boardIds: ["b1", "b2"],
      accessByBoardId: { b1: "viewer" }, // b2 absent entirely
    });
    expect(access.readableBoardIds).toEqual(["b1"]);
    expect(access.omittedCount).toBe(1);
  });

  it("computes omittedCount as bound minus readable", () => {
    expect(
      derive({
        boardIds: ["b1", "b2", "b3", "b4"],
        accessByBoardId: { b1: "owner", b2: null, b3: null, b4: "viewer" },
      }).omittedCount,
    ).toBe(2);
    expect(
      derive({
        boardIds: ["b1", "b2"],
        accessByBoardId: { b1: "owner", b2: "editor" },
      }).omittedCount,
    ).toBe(0);
    expect(derive({ boardIds: [], scope: "template" }).omittedCount).toBe(0);
  });
});

describe("deriveReportAccess — canRead (the leak gate)", () => {
  it("is false when every bound board is unreadable", () => {
    const access = derive({
      boardIds: ["b1", "b2"],
      accessByBoardId: { b1: null, b2: null },
    });
    expect(access.canRead).toBe(false);
    expect(access.readableBoardIds).toEqual([]);
    expect(access.omittedCount).toBe(2);
  });

  it("is true when at least one bound board is readable", () => {
    expect(
      derive({
        boardIds: ["b1", "b2"],
        accessByBoardId: { b1: null, b2: "viewer" },
      }).canRead,
    ).toBe(true);
  });

  it("is true for a template even with no boards and no roles (any org member may read)", () => {
    expect(derive({ scope: "template", boardIds: [] }).canRead).toBe(true);
  });

  it("is true for the creator even when zero boards are readable", () => {
    const access = derive({
      boardIds: ["b1", "b2"],
      accessByBoardId: { b1: null, b2: null },
      isCreator: true,
    });
    expect(access.canRead).toBe(true);
    expect(access.readableBoardIds).toEqual([]);
    expect(access.omittedCount).toBe(2);
  });

  it("is NOT granted to an org admin by role alone — admins still need a readable board", () => {
    expect(
      derive({
        boardIds: ["b1"],
        accessByBoardId: { b1: null },
        isOrgAdmin: true,
      }).canRead,
    ).toBe(false);
  });

  it("is false for a non-template report bound to no boards at all", () => {
    expect(derive({ scope: "boards", boardIds: [] }).canRead).toBe(false);
  });
});

describe("deriveReportAccess — canEdit", () => {
  it("is true for the creator", () => {
    expect(
      derive({
        boardIds: ["b1", "b2", "b3"],
        accessByBoardId: { b1: "viewer", b2: null, b3: "viewer" },
        isCreator: true,
      }).canEdit,
    ).toBe(true);
  });

  it("is true for an org admin who can only view 2 of 3 boards", () => {
    expect(
      derive({
        boardIds: ["b1", "b2", "b3"],
        accessByBoardId: { b1: "viewer", b2: "viewer", b3: null },
        isOrgAdmin: true,
      }).canEdit,
    ).toBe(true);
  });

  it("is true when every bound board is owner/editor", () => {
    expect(
      derive({
        boardIds: ["b1", "b2"],
        accessByBoardId: { b1: "owner", b2: "editor" },
      }).canEdit,
    ).toBe(true);
  });

  it("is false for an editor on only 2 of 3 bound boards", () => {
    expect(
      derive({
        boardIds: ["b1", "b2", "b3"],
        accessByBoardId: { b1: "editor", b2: "editor", b3: "viewer" },
      }).canEdit,
    ).toBe(false);
  });

  it("is false when one bound board is unreadable, even if the rest are owned", () => {
    expect(
      derive({
        boardIds: ["b1", "b2"],
        accessByBoardId: { b1: "owner", b2: null },
      }).canEdit,
    ).toBe(false);
  });

  it("is false for a viewer on the single bound board", () => {
    expect(
      derive({ boardIds: ["b1"], accessByBoardId: { b1: "viewer" } }).canEdit,
    ).toBe(false);
  });

  it("is false for an empty board set on a non-template scope (vacuous truth must not grant edit)", () => {
    for (const scope of ["board", "boards", "portfolio"] as const) {
      expect(derive({ scope, boardIds: [] }).canEdit).toBe(false);
    }
  });

  it("is creator-or-admin only for a template", () => {
    expect(derive({ scope: "template" }).canEdit).toBe(false);
    expect(derive({ scope: "template", isCreator: true }).canEdit).toBe(true);
    expect(derive({ scope: "template", isOrgAdmin: true }).canEdit).toBe(true);
  });

  it("ignores board grants for a template (a template carries no board data)", () => {
    // A stray membership row must not turn a template into an editable report.
    expect(
      derive({
        scope: "template",
        boardIds: ["b1"],
        accessByBoardId: { b1: "owner" },
      }).canEdit,
    ).toBe(false);
  });
});

describe("deriveReportAccess — scope: board (single home board)", () => {
  it("readable + editable for an editor on the home board", () => {
    const access = derive({
      scope: "board",
      boardIds: ["b1"],
      accessByBoardId: { b1: "editor" },
    });
    expect(access).toEqual({
      boardIds: ["b1"],
      readableBoardIds: ["b1"],
      omittedCount: 0,
      canRead: true,
      canEdit: true,
    });
  });

  it("neither readable nor editable for a non-member of the home board", () => {
    const access = derive({
      scope: "board",
      boardIds: ["b1"],
      accessByBoardId: { b1: null },
    });
    expect(access).toEqual({
      boardIds: ["b1"],
      readableBoardIds: [],
      omittedCount: 1,
      canRead: false,
      canEdit: false,
    });
  });
});

describe("deriveReportAccess — purity", () => {
  it("does not mutate or alias the caller's board id array", () => {
    const boardIds = ["b1"];
    const access = derive({ boardIds, accessByBoardId: { b1: "owner" } });
    expect(access.boardIds).not.toBe(boardIds);
    access.boardIds.push("b2");
    expect(boardIds).toEqual(["b1"]);
  });
});

describe("canEditReports (legacy single-board gate, unchanged)", () => {
  it("allows owner and editor only", () => {
    expect(canEditReports("owner")).toBe(true);
    expect(canEditReports("editor")).toBe(true);
    expect(canEditReports("viewer")).toBe(false);
    expect(canEditReports(null)).toBe(false);
  });
});
