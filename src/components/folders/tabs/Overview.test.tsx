import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildStages } from "@/lib/folders/stages";
import { canvasSections } from "@/lib/folders/layout";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";

vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: (p: { mode: string }) => (
    <div data-testid="burn-chart" data-mode={p.mode} />
  ),
}));
import { OverviewTab } from "./Overview";

function renderOverview(
  patch: Partial<ReturnType<typeof folderFixture>> = {},
  opts: { stage?: string | null; board?: string | null } = {},
) {
  const payload = { ...folderFixture(), ...patch };
  const rows = payload.rollup ?? [];
  const stages = buildStages(rows, FIXTURE_TODAY);
  const onRetry = vi.fn();
  render(
    <OverviewTab
      payload={payload}
      rows={rows}
      stages={stages}
      stage={opts.stage ?? null}
      board={opts.board ?? null}
      sections={canvasSections(payload.layout.config, "overview")}
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

  it("says the burn chart is folder-wide while a board filter is set", () => {
    // `folder_burn` has no board dimension (a BurnRow is (stage, week)), so
    // the chart silently ignores the board dropdown every other panel honours.
    renderOverview({}, { board: "b1" });
    const note = screen.getByTestId("burn-scope-note");
    expect(note).toHaveTextContent("All boards");
    expect(note).toHaveTextContent(/folder-wide/i);
  });

  it("shows no scope caption when no board filter is set", () => {
    renderOverview();
    expect(screen.queryByTestId("burn-scope-note")).toBeNull();
  });

  it("captions how much of the attention list is shown, folder-wide", () => {
    renderOverview();
    expect(screen.getByTestId("attention-caption")).toHaveTextContent(
      "Top 4 across the folder",
    );
  });

  it("captions the attention list as a slice of the stage when one is selected", () => {
    // The stage filter is applied client-side to the RPC's top-N, so the
    // caption has to say how many rows the stage actually holds.
    renderOverview({}, { stage: "build" });
    expect(screen.getByTestId("attention-caption")).toHaveTextContent(
      "Top 4 of 4 in this stage",
    );
  });

  it("never renders more than 20 attention rows", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      itemId: `x${i}`,
      itemName: `Item ${i}`,
      boardId: "b1",
      boardName: "Backend",
      groupId: "b1:build",
      groupName: "Build",
      reason: "stale" as const,
      ageDays: 30,
      severity: 1,
    }));
    renderOverview({ attention: many });
    expect(screen.getAllByRole("link", { name: /^Item / })).toHaveLength(20);
    expect(screen.getByTestId("attention-caption")).toHaveTextContent(
      "Top 20 across the folder",
    );
  });

  it("gives the chart-mode radios a 44px hit target on a coarse pointer", () => {
    renderOverview();
    expect(screen.getByRole("radio", { name: "Weekly" }).className).toContain(
      "pointer-coarse:min-h-11",
    );
  });

  it("renders the next three milestones", () => {
    renderOverview();
    expect(screen.getByText("Next milestones")).toBeInTheDocument();
    expect(screen.getAllByTestId("milestone").length).toBeLessThanOrEqual(3);
  });
});
