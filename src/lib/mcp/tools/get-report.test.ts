import { describe, expect, it, vi } from "vitest";
import { getReportHandler } from "./get-report";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reports/queries", () => ({ getReportCore: core }));

describe("getReportHandler", () => {
  it("returns the report's block structure, folding an unset chart title to null", async () => {
    core.mockResolvedValue({
      id: "r1",
      orgId: "o1",
      boardId: "b1",
      name: "Weekly status",
      updatedAt: "2026-01-05T10:00:00Z",
      config: {
        v: 1,
        title: "Status Report",
        blocks: [
          { type: "kpis", enabled: true, options: {} },
          {
            type: "chart",
            enabled: true,
            options: {
              variant: "donut",
              source: "status",
              columnId: null,
              title: "By status",
              maxCategories: 6,
            },
          },
          {
            type: "chart",
            enabled: true,
            options: {
              variant: "bars",
              source: "board_group",
              columnId: null,
              title: "",
              maxCategories: 6,
            },
          },
          {
            type: "table",
            enabled: true,
            options: { orientation: "landscape", columnIds: null },
          },
        ],
      },
    });
    const getClient = vi.fn(async () => ({}) as never);

    const result = await getReportHandler(getClient, { reportId: "r1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "r1",
      name: "Weekly status",
      boardId: "b1",
      updatedAt: "2026-01-05T10:00:00Z",
      blocks: [
        { type: "kpis", title: null },
        { type: "chart", title: "By status" },
        // An explicit but empty options.title ("derive at render time") folds
        // to null too — a bare "" would silently look like a real title.
        { type: "chart", title: null },
        { type: "table", title: null },
      ],
    });
  });

  it("errors when the report is not visible", async () => {
    core.mockReset();
    core.mockResolvedValue(null);
    const getClient = vi.fn(async () => ({}) as never);

    const result = await getReportHandler(getClient, { reportId: "missing" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("missing");
  });

  it("surfaces a core failure as an error result", async () => {
    core.mockReset();
    core.mockRejectedValue(new Error("db unavailable"));
    const getClient = vi.fn(async () => ({}) as never);

    const result = await getReportHandler(getClient, { reportId: "r1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("db unavailable");
  });
});
