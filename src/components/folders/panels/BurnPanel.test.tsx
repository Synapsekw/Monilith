import { fireEvent, render, screen } from "@testing-library/react";
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
import { BurnPanel, burnSummary } from "./BurnPanel";

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
        gap={-7}
      />,
    );
    expect(screen.getByTestId("burn-reading").textContent).toBe(
      "7 behind plan today. At 3 a week the folder finishes around Oct 12, 3 weeks after its last planned date.",
    );
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-forecast",
      "1",
    );
  });

  it("takes the gap from the Gap card, never from the burn series", () => {
    // DAAS: the truncated series said 54 behind while the card said −341.
    const { rerender } = render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={{ ...forecast, gapNow: -54 }}
        gap={-341}
      />,
    );
    expect(screen.getByTestId("burn-reading").textContent).toMatch(
      /^341 behind plan today\. /,
    );
    rerender(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={{ ...forecast, gapNow: -54 }}
      />,
    );
    expect(screen.getByTestId("burn-reading").textContent).toBe(
      "At 3 a week the folder finishes around Oct 12, 3 weeks after its last planned date.",
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
        forecast={forecast}
        gap={4}
      />,
    );
    expect(screen.getByTestId("burn-reading").textContent).toBe(
      "4 ahead of plan today. At 3 a week the folder finishes around Oct 12, 3 weeks after its last planned date.",
    );
    rerender(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={forecast}
        gap={0}
      />,
    );
    expect(screen.getByTestId("burn-reading").textContent).toBe(
      "At 3 a week the folder finishes around Oct 12, 3 weeks after its last planned date.",
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
    // Exactly this sentence: the gap (-7 here) must not precede it.
    expect(screen.getByTestId("burn-reading").textContent).toBe(
      "Not enough history yet to forecast.",
    );
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-forecast",
      "0",
    );
  });

  it("shows the reading and forecast only in cumulative mode", () => {
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
    expect(screen.getByRole("radio", { name: "Cumulative" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    expect(screen.getByRole("radio", { name: "Weekly" })).toBeChecked();
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-mode",
      "weekly",
    );
    expect(screen.queryByTestId("burn-reading")).toBeNull();
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-forecast",
      "0",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Cumulative" }));
    expect(screen.getByTestId("burn-reading")).toBeInTheDocument();
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-forecast",
      "1",
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

  it("gives the chart a text alternative with totals, the gap and the forecast", () => {
    render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={forecast}
        gap={-7}
        todayISO="2026-09-15"
      />,
    );
    const fig = screen.getByRole("figure");
    expect(fig).toHaveAttribute(
      "aria-label",
      "Planned vs completed: 20 planned in total, 13 completed. 7 behind plan today. At 3 a week the folder finishes around Oct 12, 3 weeks after its last planned date.",
    );
    expect(fig).toContainElement(screen.getByTestId("burn-chart"));
  });

  it("names the forecast year when the finish date is in another year", () => {
    expect(
      burnSummary(
        points,
        null,
        { ...forecast, finishWeek: "2027-01-04" },
        "2026-09-15",
      ),
    ).toContain("finishes around Jan 4, 2027");
  });

  it("shows a legend that tells Planned, Completed and Forecast apart by line style", () => {
    render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={{
          ...forecast,
          line: [
            { weekStart: "2026-09-14", value: 13 },
            { weekStart: "2026-09-21", value: 16 },
          ],
        }}
        gap={-7}
      />,
    );
    const legend = screen.getByTestId("burn-legend");
    const items = [...legend.querySelectorAll("li")].map((li) => [
      li.textContent,
      li.getAttribute("data-style"),
    ]);
    expect(items).toEqual([
      ["Planned (dashed line)", "dashed"],
      ["Completed (solid line)", "solid"],
      ["Forecast (dotted line)", "dotted"],
    ]);
    // Weekly mode has no forecast and draws bars.
    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    expect(
      [...screen.getByTestId("burn-legend").querySelectorAll("li")].map((li) =>
        li.getAttribute("data-style"),
      ),
    ).toEqual(["bar", "bar"]);
  });
});
