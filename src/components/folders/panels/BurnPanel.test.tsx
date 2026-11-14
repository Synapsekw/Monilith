import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: (p: { mode: string; forecast?: unknown[] }) => (
    <div
      data-testid="burn-chart"
      data-mode={p.mode}
      data-forecast={p.forecast?.length ?? 0}
    />
  ),
}));
import { BurnPanel } from "./BurnPanel";

const points = [
  {
    weekStart: "2026-09-07",
    planned: 4,
    completed: 4,
    plannedCum: 16,
    completedCum: 12,
    isPast: true,
    importedDone: 0,
  },
  {
    weekStart: "2026-09-14",
    planned: 4,
    completed: 1,
    plannedCum: 20,
    completedCum: 13,
    isPast: true,
    importedDone: 0,
  },
];
const forecast = {
  pace: 3,
  importedDone: 0,
  remaining: 11,
  gapNow: -7,
  finishWeek: "2026-10-12",
  lastPlannedWeek: "2026-09-21",
  weeksLate: 3,
  line: [{ weekStart: "2026-09-14", value: 13 }],
  insufficientHistory: false,
};

describe("BurnPanel", () => {
  it("prints the reading and the gap above the chart and passes the forecast line down", () => {
    render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={forecast}
      />,
    );
    expect(screen.getByTestId("burn-reading")).toHaveTextContent(
      "7 behind plan today. At 3 a week the folder finishes around Oct 12, 3 weeks after its last planned date.",
    );
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-forecast",
      "1",
    );
  });

  it("says ahead when the gap is positive and nothing when it is zero", () => {
    const { rerender } = render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={{ ...forecast, gapNow: 4 }}
      />,
    );
    expect(screen.getByTestId("burn-reading")).toHaveTextContent(
      "4 ahead of plan today.",
    );
    rerender(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={{ ...forecast, gapNow: 0 }}
      />,
    );
    expect(screen.getByTestId("burn-reading")).not.toHaveTextContent(
      "plan today",
    );
  });

  it("draws no forecast line and says so when history is too short", () => {
    render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={{
          ...forecast,
          pace: 0,
          finishWeek: null,
          weeksLate: null,
          line: [],
          insufficientHistory: true,
        }}
      />,
    );
    expect(screen.getByTestId("burn-reading")).toHaveTextContent(
      "Not enough history yet to forecast.",
    );
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-forecast",
      "0",
    );
  });

  it("shows items by stage instead of the chart when the folder has no dates", () => {
    render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={[]}
        anyDue={false}
        onRetry={vi.fn()}
        stageBars={[
          {
            key: "leads",
            name: "Leads",
            color: "#0073ea",
            total: 9,
            done: 0,
            stale: 2,
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Items by stage" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.queryByTestId("burn-chart")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("keeps the old empty state when no stage bars are supplied", () => {
    render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={[]}
        anyDue={false}
        onRetry={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Add due dates to see planned vs completed"),
    ).toBeInTheDocument();
  });
});
