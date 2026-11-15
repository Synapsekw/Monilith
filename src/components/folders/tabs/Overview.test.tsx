import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildStages } from "@/lib/folders/stages";
import { computeKpis } from "@/lib/folders/rollup";
import { TooltipProvider } from "@/components/ui/tooltip";
import { canvasSections } from "@/lib/folders/layout";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";
import { burnRowsOf } from "@/lib/folders/packed";

vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: (p: { mode: string }) => (
    <div data-testid="burn-chart" data-mode={p.mode} />
  ),
}));
vi.mock("@/components/folders/panels/PeoplePanel", () => ({
  PeoplePanel: (p: {
    stage: string | null;
    board?: string | null;
    onSeeAll?: () => void;
  }) => (
    <button
      type="button"
      data-testid="people-panel"
      data-stage={p.stage ?? ""}
      data-board={p.board ?? ""}
      onClick={p.onSeeAll}
    >
      people
    </button>
  ),
}));
import { OverviewTab } from "./Overview";

function renderOverview(
  patch: Partial<ReturnType<typeof folderFixture>> = {},
  opts: {
    stage?: string | null;
    board?: string | null;
    editing?: boolean;
    onMoveSection?: (id: string, dir: "up" | "down") => void;
  } = {},
) {
  const payload = { ...folderFixture(), ...patch };
  const rows = payload.rollup ?? [];
  const stages = buildStages(rows, FIXTURE_TODAY);
  const onRetry = vi.fn();
  render(
    <TooltipProvider>
      <OverviewTab
        payload={payload}
        burn={burnRowsOf(payload.burnPacked)}
        rows={rows}
        stages={stages}
        stage={opts.stage ?? null}
        board={opts.board ?? null}
        sections={canvasSections(payload.layout.config, "overview")}
        onRetry={onRetry}
        editing={opts.editing ?? false}
        onMoveSection={opts.onMoveSection}
      />
    </TooltipProvider>,
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
    renderOverview({
      rollup: rows,
      burnPacked: { lo: null, hi: null, stages: [], rows: [] },
    });
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

  it("states no gap in the burn reading while a board filter is set", () => {
    renderOverview();
    // Sanity: without the filter the fixture's reading does state a gap.
    expect(screen.getByTestId("burn-reading").textContent).toMatch(
      /plan today/,
    );
    cleanup();
    renderOverview({}, { board: "b1" });
    expect(screen.getByTestId("burn-reading").textContent).not.toMatch(
      /plan today/,
    );
  });

  it("numbers and moves Customize sections, absent ones included as placeholders", () => {
    const onMoveSection = vi.fn();
    // Tower order: kpis, burn, load (absent: a placeholder), board-status, …
    renderOverview(
      { load: { status: "skipped" } },
      { editing: true, onMoveSection },
    );
    const ups = screen.getAllByRole("button", { name: "Move up" });
    const downs = screen.getAllByRole("button", { name: "Move down" });
    // kpis, burn, load, board-status, people, attention, intelligence, milestones
    expect(ups).toHaveLength(8);
    expect(ups[0]).toBeDisabled();
    expect(downs[7]).toBeDisabled();
    // Every builtin section is drawn now, so each move is ONE adjacent swap.
    fireEvent.click(ups[3]!); // board-status up past the load placeholder
    expect(onMoveSection.mock.calls).toEqual([["board-status", "up"]]);
    onMoveSection.mockClear();
    fireEvent.click(downs[1]!); // burn down onto the load placeholder
    expect(onMoveSection.mock.calls).toEqual([["burn", "down"]]);
    onMoveSection.mockClear();
    fireEvent.click(ups[2]!); // the placeholder itself moves
    expect(onMoveSection.mock.calls).toEqual([["load", "up"]]);
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
        burn={burnRowsOf(payload.burnPacked)}
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
    renderOverview({ load: { status: "skipped" } });
    expect(screen.queryByText("Load by board and week")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows the load section's Retry when the load read failed", () => {
    const { onRetry } = renderOverview({ load: { status: "failed" } });
    expect(screen.getByText("Load by board and week")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("narrows the people section to the board filter", () => {
    renderOverview({}, { board: "b2" });
    expect(screen.getByTestId("people-panel")).toHaveAttribute(
      "data-board",
      "b2",
    );
  });

  it("draws KPI trends from the fixture's packed burn (the real path)", () => {
    renderOverview();
    // fixture rows carry importedDone/overdueOpen: the overdue trend shows.
    expect(
      screen.getByRole("img", { name: /^Overdue, last/ }),
    ).toBeInTheDocument();
  });

  it("shows the reading line above the burn chart", () => {
    renderOverview();
    expect(screen.getByTestId("burn-reading")).toBeInTheDocument();
  });

  it("keeps an absent section manageable in Customize mode with a slim placeholder", () => {
    renderOverview(
      { load: { status: "skipped" }, briefs: [] },
      { editing: true },
    );
    expect(
      screen.getByRole("button", { name: "Hide Load by board and week" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide Intelligence" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("section-placeholder")).toHaveLength(2);
    expect(
      screen.getAllByText("Nothing to show for this folder right now"),
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Hide Planned vs completed" }),
    ).toBeInTheDocument();
  });

  it("leaves an absent section out entirely outside Customize mode", () => {
    renderOverview({ load: { status: "skipped" }, briefs: [] });
    expect(screen.queryByTestId("section-placeholder")).toBeNull();
    expect(screen.queryByText("Intelligence")).toBeNull();
  });

  it("lets the burn chart take the whole row while the load map is absent", () => {
    renderOverview({ load: { status: "skipped" } });
    const burn = document
      .querySelector("[data-section-id='burn']")!
      .closest("[data-testid='section-group']") as HTMLElement;
    expect(burn.style.getPropertyValue("--col")).toBe("1 / span 12");
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
