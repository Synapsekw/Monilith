import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildStages } from "@/lib/folders/stages";
import { computeKpis } from "@/lib/folders/rollup";
import { canvasSections } from "@/lib/folders/layout";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";

vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: (p: { mode: string }) => (
    <div data-testid="burn-chart" data-mode={p.mode} />
  ),
}));
vi.mock("@/components/folders/panels/PeoplePanel", () => ({
  PeoplePanel: (p: { stage: string | null; onSeeAll?: () => void }) => (
    <button
      type="button"
      data-testid="people-panel"
      data-stage={p.stage ?? ""}
      onClick={p.onSeeAll}
    >
      people
    </button>
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
    // Scoped to the KPI labels: "Overdue" also appears in the boards legend.
    const labels = screen.getAllByTestId("kpi-label").map((n) => n.textContent);
    for (const label of [
      "Complete",
      "Gap to plan",
      "Overdue",
      "Due this week",
      "Blocked",
      "Stale",
    ]) {
      expect(labels).toContain(label);
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

  it("groups attention by board and expands to rows linking with ?item=", () => {
    renderOverview();
    expect(screen.queryByRole("link", { name: /Auth refactor/ })).toBeNull();
    const backend = screen
      .getAllByTestId("attention-group")
      .find((g) => g.textContent?.includes("Backend"))!;
    fireEvent.click(backend.querySelector("button")!);
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

  it("swaps the burn chart for items by stage and hides the load map when there are no due dates", () => {
    const rows = folderFixture().rollup!.map((r) => ({
      ...r,
      minDue: null,
      maxDue: null,
      plannedByToday: 0,
      oldestOverdue: null,
    }));
    renderOverview({ rollup: rows, burn: [] });
    expect(
      screen.getByRole("heading", { name: "Items by stage" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Load by board and week")).toBeNull();
    expect(screen.getByText("No due dates set")).toBeInTheDocument();
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

  it("captions the attention section with its scope, not a row count", () => {
    renderOverview();
    expect(screen.getByTestId("attention-caption")).toHaveTextContent(
      "By board. Counts are totals; a board expands to its most urgent items.",
    );
  });

  it("keeps only the selected stage's items inside the groups", () => {
    renderOverview({}, { stage: "build" });
    const all = screen.getAllByTestId("attention-group");
    for (const g of all) fireEvent.click(g.querySelector("button")!);
    expect(
      screen.getAllByRole("link", {
        name: /Auth refactor|Push notifications|Onboarding flow|Crash reporting/,
      }),
    ).toHaveLength(4);
  });

  it("never renders more than 20 attention rows per board", () => {
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
    const backend = screen
      .getAllByTestId("attention-group")
      .find((g) => g.textContent?.includes("Backend"))!;
    fireEvent.click(backend.querySelector("button")!);
    expect(screen.getAllByRole("link", { name: /^Item / })).toHaveLength(20);
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

  it("renders the load map and the people section in the project layout", () => {
    renderOverview();
    expect(screen.getByText("Load by board and week")).toBeInTheDocument();
    expect(
      screen.getByRole("rowheader", { name: "Backend" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("people-panel")).toBeInTheDocument();
  });

  it("does not render a load section the saved layout does not have", () => {
    const payload = folderFixture();
    const sections = canvasSections(payload.layout.config, "overview").filter(
      (s) => s.id !== "load",
    );
    render(
      <OverviewTab
        payload={payload}
        rows={payload.rollup!}
        stages={buildStages(payload.rollup!, FIXTURE_TODAY)}
        stage={null}
        board={null}
        sections={sections}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByText("Load by board and week")).toBeNull();
  });

  it("renders no load section at all while the load rows are not supplied", () => {
    renderOverview({ load: null });
    expect(screen.queryByText("Load by board and week")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows the reading line above the burn chart", () => {
    renderOverview();
    expect(screen.getByTestId("burn-reading")).toBeInTheDocument();
  });

  it("states the same gap in the reading as on the Gap card", () => {
    renderOverview();
    const k = computeKpis(folderFixture().rollup!, FIXTURE_TODAY);
    const reading = screen.getByTestId("burn-reading").textContent!;
    if (k.gap === null || k.gap === 0)
      expect(reading).not.toMatch(/plan today/);
    else
      expect(reading).toMatch(
        new RegExp(
          `^${Math.abs(k.gap)} ${k.gap < 0 ? "behind" : "ahead of"} plan today\\. `,
        ),
      );
  });
});
