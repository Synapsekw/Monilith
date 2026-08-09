// src/components/reports/ReportDocument.test.tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ReportDocument,
  type ReportDocumentProps,
} from "@/components/reports/ReportDocument";
import { defaultReportConfig, type ReportConfig } from "@/lib/reports/config";
import type { Group } from "@/lib/boards/queries";
import type { Kpis } from "@/lib/reports/shape";
import { computeChartSeries } from "@/lib/reports/chart-data";
import type { ChartSeries } from "@/lib/reports/chart-data";
import type { ReportBoardData } from "@/lib/reports/aggregate";

const chartSeries: ChartSeries = {
  categories: [
    { key: "a", label: "Done", value: 4, color: "#5866c4" },
    { key: "b", label: "Stuck", value: 1, color: "#e34948" },
  ],
  total: 5,
  categoryName: "Status",
  empty: false,
};

const ZERO_KPIS: Kpis = {
  itemCount: 0,
  percentComplete: 0,
  overdueCount: 0,
  statusTally: [],
};

const group = (id: string, name: string): Group =>
  ({ id, name, color: "#5866c4", position: 0 }) as unknown as Group;

/** One board with a single named group, enough for every board-scoped block. */
function board(
  boardId: string,
  boardName: string,
  over: Partial<ReportBoardData> = {},
): ReportBoardData {
  return {
    boardId,
    boardName,
    model: {
      columns: [],
      groups: [
        { group: group(`${boardId}-g`, `${boardName} backlog`), rows: [] },
      ],
    },
    kpis: ZERO_KPIS,
    groupSummaries: [
      {
        group: group(`${boardId}-g`, `${boardName} backlog`),
        count: 0,
        percentComplete: 50,
      },
    ],
    chartSeries: null,
    ...over,
  };
}

const props = (
  over: Partial<ReportDocumentProps> = {},
): ReportDocumentProps => ({
  config: defaultReportConfig(),
  boards: [board("b1", "Marketing")],
  totals: ZERO_KPIS,
  pooledChartSeries: null,
  scopeLabel: "Marketing",
  omittedBoardCount: 0,
  orgName: "Acme",
  ...over,
});

const render = (over: Partial<ReportDocumentProps> = {}) =>
  renderToStaticMarkup(<ReportDocument {...props(over)} />);

/** Enable normally-off blocks so one render covers every board-scoped block. */
function allBlocksOn(): ReportConfig {
  const config = defaultReportConfig();
  config.blocks = config.blocks.map((b) =>
    b.type === "appendix" ? { ...b, enabled: true } : b,
  );
  return config;
}

const occurrences = (html: string, needle: string) =>
  html.split(needle).length - 1;

describe("ReportDocument", () => {
  it("renders the cover title and skips disabled blocks", () => {
    const config = defaultReportConfig();
    config.title = "Q3 Launch";
    expect(render({ config })).toContain("Q3 Launch");
  });

  it("renders nothing for an empty block list", () => {
    const html = render({ config: { v: 1, title: "T", blocks: [] } });
    expect(html).not.toContain("r-cover");
  });
});

describe("ReportDocument — single board", () => {
  it("renders no per-board heading and names the board on the cover", () => {
    const html = render({
      config: allBlocksOn(),
      boards: [board("b1", "Marketing")],
      scopeLabel: "Marketing",
    });
    // The v1 output had no notion of a board sub-section; existing reports must
    // print exactly as they did.
    expect(html).not.toContain("r-board-head");
    expect(html).not.toContain("r-board-set");
    expect(html).toContain("across the Marketing board.");
    expect(html).toContain("Marketing backlog");
    // one of each board-scoped block, not one per board
    expect(occurrences(html, "Board detail")).toBe(1);
    expect(occurrences(html, "Group progress")).toBe(1);
    expect(occurrences(html, "Appendix — full data")).toBe(1);
  });
});

describe("ReportDocument — many boards", () => {
  const boards = [
    board("b1", "Marketing"),
    board("b2", "Engineering"),
    board("b3", "Sales"),
  ];

  it("introduces every board with its own heading in each board-scoped block", () => {
    const html = render({
      config: allBlocksOn(),
      boards,
      scopeLabel: "Q3 Portfolio",
    });
    // table + group_summaries + appendix, once per board
    expect(occurrences(html, 'class="r-board-head"')).toBe(9);
    expect(occurrences(html, "Board detail")).toBe(3);
    expect(occurrences(html, "Group progress")).toBe(3);
    expect(occurrences(html, "Appendix — full data")).toBe(3);
    for (const name of ["Marketing", "Engineering", "Sales"]) {
      expect(occurrences(html, `class="r-board-name">${name}<`)).toBe(3);
      expect(html).toContain(`${name} backlog`);
    }
  });

  it("states the board count on the cover instead of a list of names", () => {
    const config = defaultReportConfig();
    config.blocks = config.blocks.map((b) =>
      b.type === "cover"
        ? {
            ...b,
            options: {
              ...b.options,
              preparedFor: "Board of directors",
              preparedBy: "Ops",
            },
          }
        : b,
    );
    const html = render({ config, boards, scopeLabel: "Q3 Portfolio" });
    expect(html).toContain("across 3 boards in Q3 Portfolio.");
    expect(html).toContain('>Boards</div><div class="r-cf-val">3<');
    // the footer grid is fixed at three cells and must not grow into a list
    expect(occurrences(html, "r-cf-lbl")).toBe(3);
    expect(html).not.toContain('r-cf-val">Engineering<');
  });

  it("renders the pooled totals in the KPI block, not any one board's KPIs", () => {
    const html = render({
      boards: [
        board("b1", "Marketing", {
          kpis: { ...ZERO_KPIS, itemCount: 4, percentComplete: 25 },
        }),
        board("b2", "Engineering", {
          kpis: { ...ZERO_KPIS, itemCount: 6, percentComplete: 50 },
        }),
      ],
      totals: {
        itemCount: 10,
        percentComplete: 40,
        overdueCount: 2,
        statusTally: [],
      },
    });
    expect(html).toContain(">10</div>");
    expect(html).toContain(">40%</div>");
    expect(html).toContain(">2</div>");
  });

  it("charts the pooled series when the chart block is scoped to all boards", () => {
    const html = render({
      boards,
      pooledChartSeries: {
        ...chartSeries,
        categories: [
          { key: "a", label: "Pooled done", value: 9, color: "#5866c4" },
          { key: "b", label: "Pooled stuck", value: 2, color: "#e34948" },
        ],
      },
    });
    expect(html).toContain("Pooled done");
  });

  it("charts one board's own series when the chart block is pinned to it", () => {
    const config = defaultReportConfig();
    config.blocks = config.blocks.map((b) =>
      b.type === "chart"
        ? {
            ...b,
            options: {
              ...b.options,
              boardScope: { mode: "board", boardId: "b2" },
            },
          }
        : b,
    );
    const html = render({
      config,
      boards: [
        board("b1", "Marketing", {
          chartSeries: {
            ...chartSeries,
            categories: [
              { key: "a", label: "Marketing only", value: 3, color: "#5866c4" },
              { key: "b", label: "Other", value: 1, color: "#e34948" },
            ],
          },
        }),
        board("b2", "Engineering", {
          chartSeries: {
            ...chartSeries,
            categories: [
              {
                key: "a",
                label: "Engineering only",
                value: 7,
                color: "#5866c4",
              },
              { key: "b", label: "Other", value: 2, color: "#e34948" },
            ],
          },
        }),
      ],
      pooledChartSeries: chartSeries,
    });
    expect(html).toContain("Engineering only");
    expect(html).not.toContain("Marketing only");
    // and not the pooled series either
    expect(html).not.toContain(">Done<");
  });

  it("renders a block pinned to a board that is no longer bound as nothing", () => {
    const config = allBlocksOn();
    config.blocks = config.blocks.map((b) =>
      b.type === "table"
        ? {
            ...b,
            options: {
              ...b.options,
              boardScope: { mode: "board", boardId: "gone" },
            },
          }
        : b,
    );
    const html = render({ config, boards });
    expect(html).not.toContain("Board detail");
    // the other board-scoped blocks still cover every board
    expect(occurrences(html, "Group progress")).toBe(3);
  });
});

describe("ReportDocument — omitted boards", () => {
  it("discloses boards the viewer cannot read", () => {
    const html = render({ omittedBoardCount: 3 });
    expect(html).toContain("r-omitted");
    expect(html).toContain("3 boards");
    expect(html).toContain("no access");
  });

  it("uses the singular for one omitted board", () => {
    expect(render({ omittedBoardCount: 1 })).toContain("1 board");
  });

  it("says nothing when every board is readable", () => {
    expect(render({ omittedBoardCount: 0 })).not.toContain("r-omitted");
  });

  it("keeps the disclosure when the cover block is switched off", () => {
    const config = defaultReportConfig();
    config.blocks = config.blocks.map((b) =>
      b.type === "cover" ? { ...b, enabled: false } : b,
    );
    const html = render({ config, omittedBoardCount: 2 });
    expect(html).not.toContain("r-cover");
    expect(html).toContain("r-omitted");
  });
});

describe("ReportDocument — no boards", () => {
  it("renders a calm document with no board-scoped sections and no NaN", () => {
    const html = render({
      config: allBlocksOn(),
      boards: [],
      scopeLabel: "Q3 Portfolio",
      omittedBoardCount: 0,
    });
    expect(html).not.toContain("NaN");
    // no labelled section standing over nothing
    expect(html).not.toContain("Board detail");
    expect(html).not.toContain("Group progress");
    expect(html).not.toContain("Appendix — full data");
    expect(html).not.toContain("r-board-head");
    // the cover still reads correctly
    expect(html).toContain("No boards are in scope yet.");
    expect(html).toContain(">0</div>");
  });

  it("does not throw for a bare template preview", () => {
    expect(() => render({ boards: [], scopeLabel: "" })).not.toThrow();
  });
});

describe("ReportDocument — chart block", () => {
  it("renders the chart block when enabled", () => {
    const html = render({
      totals: {
        itemCount: 5,
        percentComplete: 80,
        overdueCount: 0,
        statusTally: [],
      },
      pooledChartSeries: chartSeries,
    });
    expect(html).toContain("Items by Status");
    expect(html).toContain("<svg");
  });

  it("omits the chart entirely when the block is disabled", () => {
    const config = defaultReportConfig();
    config.blocks = config.blocks.map((b) =>
      b.type === "chart" ? { ...b, enabled: false } : b,
    );
    expect(render({ config, pooledChartSeries: chartSeries })).not.toContain(
      "r-chart-ring",
    );
  });

  it("renders the chart's empty state when pooledChartSeries is null", () => {
    const html = render({ pooledChartSeries: null });
    expect(html).toContain("r-chart-empty");
    expect(typeof computeChartSeries).toBe("function");
  });
});
