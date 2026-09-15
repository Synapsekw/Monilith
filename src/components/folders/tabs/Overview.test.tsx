import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildStages } from "@/lib/folders/stages";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";

vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: (p: { mode: string }) => (
    <div data-testid="burn-chart" data-mode={p.mode} />
  ),
}));
import { OverviewTab } from "./Overview";

function renderOverview(patch: Partial<ReturnType<typeof folderFixture>> = {}) {
  const payload = { ...folderFixture(), ...patch };
  const rows = payload.rollup ?? [];
  const stages = buildStages(rows, FIXTURE_TODAY);
  const onRetry = vi.fn();
  render(
    <OverviewTab
      payload={payload}
      rows={rows}
      stages={stages}
      stage={null}
      onRetry={onRetry}
    />,
  );
  return { onRetry };
}

describe("OverviewTab", () => {
  it("renders the six KPI cards", () => {
    renderOverview();
    for (const label of [
      "Complete",
      "Gap to plan",
      "Overdue",
      "Due this week",
      "Blocked",
      "Stale",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("toggles the burn chart between cumulative and weekly with no server call", () => {
    renderOverview();
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-mode",
      "cumulative",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-mode",
      "weekly",
    );
  });

  it("lists attention rows linking to the board with ?item=", () => {
    renderOverview();
    const link = screen.getByRole("link", { name: /Auth refactor/ });
    expect(link).toHaveAttribute("href", "/boards/b1?item=i1");
    expect(screen.getByText("overdue · 14d")).toBeInTheDocument();
  });

  it("shows Intelligence briefs only when there is at least one run", () => {
    renderOverview();
    expect(screen.getByText("Intelligence")).toBeInTheDocument();
    expect(screen.getByText(/one auth item slipped/)).toBeInTheDocument();
  });

  it("hides the Intelligence panel when no board has a run", () => {
    renderOverview({ briefs: [] });
    expect(screen.queryByText("Intelligence")).toBeNull();
  });

  it("replaces the burn chart when there are no due dates and shows an em dash for gap", () => {
    const rows = folderFixture().rollup!.map((r) => ({
      ...r,
      minDue: null,
      maxDue: null,
      plannedByToday: 0,
      oldestOverdue: null,
    }));
    renderOverview({ rollup: rows, burn: [] });
    expect(
      screen.getByText("Add due dates to see planned vs completed"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("burn-chart")).toBeNull();
  });

  it("shows an inline retry for a failed panel and keeps the rest", () => {
    const { onRetry } = renderOverview({ attention: null });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("renders the next three milestones", () => {
    renderOverview();
    expect(screen.getByText("Next milestones")).toBeInTheDocument();
    expect(screen.getAllByTestId("milestone").length).toBeLessThanOrEqual(3);
  });
});
