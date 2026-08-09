import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { BoardPayload } from "@/lib/boards/queries";
import type { ReportBoardData } from "@/lib/reports/aggregate";
import type { ReportConfig } from "@/lib/reports/config";
import { defaultReportConfig } from "@/lib/reports/config";
import {
  ReportBuilder,
  blockBoardScope,
  setBlockBoardScope,
} from "@/components/reports/ReportBuilder";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

const deriveRenderData = vi.fn();
vi.mock("@/lib/reports/render-data", () => ({
  deriveRenderData: (...args: unknown[]) => deriveRenderData(...args),
}));

const saveReport = vi.fn();
const exportReportPdf = vi.fn();
const setReportScope = vi.fn();
const saveReportAsTemplate = vi.fn();
vi.mock("@/lib/reports/actions", () => ({
  saveReport: (...a: unknown[]) => saveReport(...a),
  exportReportPdf: (...a: unknown[]) => exportReportPdf(...a),
  setReportScope: (...a: unknown[]) => setReportScope(...a),
  saveReportAsTemplate: (...a: unknown[]) => saveReportAsTemplate(...a),
}));

const draftReportNarrativeAction = vi.fn();
vi.mock("@/lib/reports/ai-actions", () => ({
  draftReportNarrativeAction: (...a: unknown[]) =>
    draftReportNarrativeAction(...a),
}));

vi.mock("@/lib/ui/mutation-toast", () => ({ showMutationError: vi.fn() }));

// The preview renders a real React root into an iframe document; that machinery
// is PreviewPane's own concern and jsdom is a poor host for it. Stub it down to
// the two facts this suite cares about: it is handed the derived boards.
vi.mock("@/components/reports/PreviewPane", () => ({
  PreviewPane: (props: { boards: { boardName: string }[] }) => (
    <div data-testid="preview">
      {props.boards.map((b) => b.boardName).join(",")}
    </div>
  ),
}));

function board(id: string, name: string): ReportBoardData {
  return {
    boardId: id,
    boardName: name,
    model: { board: { id, name }, groups: [] },
    kpis: {
      itemCount: 0,
      percentComplete: 0,
      overdueCount: 0,
      statusTally: [],
    },
    groupSummaries: [],
    chartSeries: null,
  } as unknown as ReportBoardData;
}

function payload(id: string, name: string): BoardPayload {
  return {
    board: { id, name },
    columns: [],
  } as unknown as BoardPayload;
}

const peopleNames = new Map<string, string>();

/** The config the builder last derived from — i.e. the current client state. */
function lastConfig(): ReportConfig {
  const call = deriveRenderData.mock.calls.at(-1);
  return call?.[2] as ReportConfig;
}

/** Every server entry point the builder can reach. */
function allServerCalls() {
  return [
    saveReport,
    exportReportPdf,
    setReportScope,
    saveReportAsTemplate,
    draftReportNarrativeAction,
    refresh,
    push,
  ];
}

function renderBuilder(
  overrides: Partial<Parameters<typeof ReportBuilder>[0]> = {},
) {
  const boards = overrides.payloads ?? [payload("b1", "Alpha")];
  return render(
    <ReportBuilder
      reportId="00000000-0000-4000-8000-000000000001"
      initialName="Q3 Status"
      initialConfig={defaultReportConfig()}
      payloads={boards}
      peopleNames={peopleNames}
      scopeLabel="Alpha"
      omittedBoardCount={0}
      orgName="Acme"
      canEdit
      scope="board"
      boardId="b1"
      portfolioId={null}
      boundBoardIds={["b1"]}
      pickableBoards={[
        { id: "b1", name: "Alpha" },
        { id: "b2", name: "Beta" },
      ]}
      portfolios={[{ id: "p1", name: "Delivery" }]}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  deriveRenderData.mockImplementation(() => ({
    boards: [board("b1", "Alpha")],
    totals: {
      itemCount: 0,
      percentComplete: 0,
      overdueCount: 0,
      statusTally: [],
    },
    pooledChartSeries: null,
  }));
  saveReport.mockResolvedValue({ ok: true, data: undefined });
  exportReportPdf.mockResolvedValue({
    ok: true,
    data: { fileName: "r.pdf", base64: "", mime: "application/pdf" },
  });
});

describe("setBlockBoardScope / blockBoardScope", () => {
  it("re-targets exactly one block and leaves the rest untouched", () => {
    const config = defaultReportConfig();
    const next = setBlockBoardScope(config, "table", {
      mode: "board",
      boardId: "00000000-0000-4000-8000-0000000000b2",
    });

    expect(blockBoardScope(next, "table")).toEqual({
      mode: "board",
      boardId: "00000000-0000-4000-8000-0000000000b2",
    });
    expect(blockBoardScope(next, "chart")).toEqual({ mode: "all" });
    expect(blockBoardScope(next, "appendix")).toEqual({ mode: "all" });
    // Block order and enabled flags are untouched.
    expect(next.blocks.map((b) => `${b.type}:${b.enabled}`)).toEqual(
      config.blocks.map((b) => `${b.type}:${b.enabled}`),
    );
  });

  it("returns null for a block type the config does not carry", () => {
    expect(
      blockBoardScope({ ...defaultReportConfig(), blocks: [] }, "chart"),
    ).toBeNull();
  });
});

describe("ReportBuilder — derivation and the 0-round-trip budget", () => {
  it("derives the document with deriveRenderData over the payloads it was given", () => {
    renderBuilder();
    expect(deriveRenderData).toHaveBeenCalledWith(
      [expect.objectContaining({ board: { id: "b1", name: "Alpha" } })],
      peopleNames,
      expect.objectContaining({ title: "Status Report" }),
    );
    expect(screen.getByTestId("preview")).toHaveTextContent("Alpha");
  });

  it("re-derives on a section toggle with ZERO server round-trips", () => {
    renderBuilder();
    const before = deriveRenderData.mock.calls.length;

    fireEvent.click(screen.getByLabelText("Toggle Board table"));

    expect(deriveRenderData.mock.calls.length).toBeGreaterThan(before);
    expect(lastConfig().blocks.find((b) => b.type === "table")?.enabled).toBe(
      false,
    );
    for (const spy of allServerCalls()) expect(spy).not.toHaveBeenCalled();
  });

  it("re-derives on a reorder and on a chart option change with ZERO server round-trips", () => {
    renderBuilder();

    fireEvent.click(screen.getByLabelText("Move Chart up"));
    expect(lastConfig().blocks[2].type).toBe("chart");

    fireEvent.change(screen.getByLabelText("Chart style"), {
      target: { value: "bars" },
    });
    const chart = lastConfig().blocks.find((b) => b.type === "chart");
    expect(chart?.type === "chart" && chart.options.variant).toBe("bars");

    for (const spy of allServerCalls()) expect(spy).not.toHaveBeenCalled();
  });

  it("edits the executive summary in client state only", () => {
    renderBuilder();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Executive summary" }),
      {
        target: { value: "Shipped the thing." },
      },
    );
    const summary = lastConfig().blocks.find((b) => b.type === "summary");
    expect(summary?.type === "summary" && summary.options.text).toBe(
      "Shipped the thing.",
    );
    for (const spy of allServerCalls()) expect(spy).not.toHaveBeenCalled();
  });
});

describe("ReportBuilder — per-block board targets", () => {
  it("hides the board-target controls for a single-board report", () => {
    renderBuilder();
    expect(screen.queryByLabelText("Board table board")).toBeNull();
    expect(screen.queryByText("Board targets")).toBeNull();
  });

  it("offers All boards plus each bound board once the report covers several", () => {
    deriveRenderData.mockImplementation(() => ({
      boards: [board("b1", "Alpha"), board("b2", "Beta")],
      totals: {
        itemCount: 0,
        percentComplete: 0,
        overdueCount: 0,
        statusTally: [],
      },
      pooledChartSeries: null,
    }));
    renderBuilder({
      payloads: [payload("b1", "Alpha"), payload("b2", "Beta")],
    });

    const select = screen.getByLabelText(
      "Board table board",
    ) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "All boards",
      "Alpha",
      "Beta",
    ]);
    // Disabled blocks get no control — appendix is off by default.
    expect(screen.queryByLabelText("Appendix board")).toBeNull();
  });

  it("pins a block to one board with ZERO server round-trips", () => {
    deriveRenderData.mockImplementation(() => ({
      boards: [board("b1", "Alpha"), board("b2", "Beta")],
      totals: {
        itemCount: 0,
        percentComplete: 0,
        overdueCount: 0,
        statusTally: [],
      },
      pooledChartSeries: null,
    }));
    renderBuilder({
      payloads: [payload("b1", "Alpha"), payload("b2", "Beta")],
    });

    fireEvent.change(screen.getByLabelText("Board table board"), {
      target: { value: "b2" },
    });

    expect(blockBoardScope(lastConfig(), "table")).toEqual({
      mode: "board",
      boardId: "b2",
    });
    for (const spy of allServerCalls()) expect(spy).not.toHaveBeenCalled();
  });
});

describe("ReportBuilder — saving and rename", () => {
  it("saves the edited name together with the config", async () => {
    renderBuilder();
    fireEvent.change(screen.getByLabelText("Report name"), {
      target: { value: "Q4 Status" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(saveReport).toHaveBeenCalledTimes(1));
    expect(saveReport).toHaveBeenCalledWith({
      reportId: "00000000-0000-4000-8000-000000000001",
      name: "Q4 Status",
      config: expect.objectContaining({ title: "Status Report" }),
    });
  });

  it("exports without a boardId", async () => {
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: /Export PDF/ }));
    await waitFor(() => expect(exportReportPdf).toHaveBeenCalledTimes(1));
    expect(exportReportPdf).toHaveBeenCalledWith({
      reportId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("drafts the narrative for the whole report, not one board", async () => {
    draftReportNarrativeAction.mockResolvedValue({
      ok: true,
      data: { summary: "All good.", highlights: ["A"], risks: [] },
    });
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: /Draft with AI/ }));

    await waitFor(() =>
      expect(draftReportNarrativeAction).toHaveBeenCalledWith({
        reportId: "00000000-0000-4000-8000-000000000001",
      }),
    );
    await waitFor(() => {
      const summary = lastConfig().blocks.find((b) => b.type === "summary");
      expect(summary?.type === "summary" && summary.options.text).toContain(
        "All good.",
      );
    });
  });
});

describe("ReportBuilder — viewer access", () => {
  it("disables every mutating control but leaves the report exportable", () => {
    renderBuilder({ canEdit: false });

    expect(screen.getByLabelText("Report name")).toBeDisabled();
    expect(screen.getByLabelText("Toggle Board table")).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: "Executive summary" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Report scope")).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Save as template/ }),
    ).toBeDisabled();

    // Nothing is hidden — the whole builder is still on screen…
    expect(screen.getByTestId("preview")).toBeInTheDocument();
    // …and export, which needs read access only, still works.
    expect(
      screen.getByRole("button", { name: /Export PDF/ }),
    ).not.toBeDisabled();
    expect(screen.getByText(/You have view access/)).toBeInTheDocument();
  });
});
