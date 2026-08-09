import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportScopePicker } from "@/components/reports/ReportScopePicker";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const setReportScope = vi.fn();
vi.mock("@/lib/reports/actions", () => ({
  setReportScope: (input: unknown) => setReportScope(input),
}));

const showMutationError = vi.fn();
vi.mock("@/lib/ui/mutation-toast", () => ({
  showMutationError: (...a: unknown[]) => showMutationError(...a),
}));

const REPORT_ID = "00000000-0000-4000-8000-000000000001";
const boards = [
  { id: "b1", name: "Alpha" },
  { id: "b2", name: "Beta" },
  { id: "b3", name: "Gamma" },
];
const portfolios = [
  { id: "p1", name: "Delivery" },
  { id: "p2", name: "Platform" },
];

function renderPicker(
  overrides: Partial<Parameters<typeof ReportScopePicker>[0]> = {},
) {
  return render(
    <ReportScopePicker
      reportId={REPORT_ID}
      scope="board"
      boardId="b1"
      portfolioId={null}
      boundBoardIds={["b1"]}
      boards={boards}
      portfolios={portfolios}
      {...overrides}
    />,
  );
}

const applyButton = () => screen.getByRole("button", { name: /Apply scope/ });

beforeEach(() => {
  vi.clearAllMocks();
  setReportScope.mockResolvedValue({ ok: true, data: undefined });
});

describe("ReportScopePicker", () => {
  it("starts inert — Apply does nothing until the draft actually differs", () => {
    renderPicker();
    expect(applyButton()).toBeDisabled();
  });

  it("re-binds a report to a different single board", async () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText("Board"), {
      target: { value: "b2" },
    });
    expect(applyButton()).not.toBeDisabled();

    fireEvent.click(applyButton());
    await waitFor(() =>
      expect(setReportScope).toHaveBeenCalledWith({
        reportId: REPORT_ID,
        scope: "board",
        boardId: "b2",
      }),
    );
    // Scope IS server data — this is the one control that may refresh.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("rolls up an explicit set of boards", async () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText("Report scope"), {
      target: { value: "boards" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));

    fireEvent.click(applyButton());
    await waitFor(() =>
      expect(setReportScope).toHaveBeenCalledWith({
        reportId: REPORT_ID,
        scope: "boards",
        boardIds: ["b1", "b2"],
      }),
    );
  });

  it("refuses to apply an empty board set", () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText("Report scope"), {
      target: { value: "boards" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
  });

  it("binds to a portfolio and says the report will follow it", async () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText("Report scope"), {
      target: { value: "portfolio" },
    });
    expect(
      screen.getByText(/The report follows the portfolio/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Portfolio"), {
      target: { value: "p2" },
    });
    fireEvent.click(applyButton());
    await waitFor(() =>
      expect(setReportScope).toHaveBeenCalledWith({
        reportId: REPORT_ID,
        scope: "portfolio",
        portfolioId: "p2",
      }),
    );
  });

  it("reports a failure and does not refresh the page", async () => {
    setReportScope.mockResolvedValue({ ok: false, error: "Nope." });
    renderPicker();
    fireEvent.change(screen.getByLabelText("Board"), {
      target: { value: "b3" },
    });
    fireEvent.click(applyButton());

    await waitFor(() => expect(showMutationError).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers no picker for a template — it binds no boards by construction", () => {
    renderPicker({ scope: "template", boardId: null, boundBoardIds: [] });
    expect(screen.queryByLabelText("Report scope")).toBeNull();
    expect(screen.getByText(/organization template/)).toBeInTheDocument();
  });

  it("disables every control for a viewer", () => {
    renderPicker({ disabled: true });
    expect(screen.getByLabelText("Report scope")).toBeDisabled();
    expect(screen.getByLabelText("Board")).toBeDisabled();
    expect(applyButton()).toBeDisabled();
  });
});
