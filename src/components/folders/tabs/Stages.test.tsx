import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildStages } from "@/lib/folders/stages";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";
vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: () => <div data-testid="burn-chart" />,
}));
import { StagesTab } from "./Stages";

describe("StagesTab", () => {
  const fx = folderFixture();
  const stages = buildStages(fx.rollup!, FIXTURE_TODAY);
  it("renders a card per stage with a state kicker and 'Only on' for single-board stages", () => {
    render(
      <StagesTab
        rows={fx.rollup!}
        allRows={fx.rollup!}
        stages={stages}
        stage={null}
        burn={fx.burn}
        boards={fx.boards}
        todayISO={FIXTURE_TODAY}
        onSelectStage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("stage-card")).toHaveLength(4);
    expect(screen.getByText("COMPLETE")).toBeInTheDocument();
    expect(screen.getAllByText("IN FLIGHT").length).toBeGreaterThan(0);
    expect(screen.getByText("Only on Website")).toBeInTheDocument();
  });
  it("clicking a card selects the stage; the matrix and carry-over render", () => {
    const onSelect = vi.fn();
    render(
      <StagesTab
        rows={fx.rollup!}
        allRows={fx.rollup!}
        stages={stages}
        stage={null}
        burn={fx.burn}
        boards={fx.boards}
        todayISO={FIXTURE_TODAY}
        onSelectStage={onSelect}
        onRetry={vi.fn()}
      />,
    );
    // Stage order is min group position then name: Build (b3 has it at 0) sorts first.
    fireEvent.click(screen.getAllByTestId("stage-card")[0]);
    expect(onSelect).toHaveBeenCalledWith("build");
    expect(screen.getByText(/1 open item/)).toBeInTheDocument(); // carry-over
    expect(screen.getByText("Stage × board")).toBeInTheDocument();
  });
  it("honours a board filter: a board absent from the filtered rows does not appear in the matrix", () => {
    const filteredRows = fx.rollup!.filter((r) => r.boardId === "b1");
    const filteredBoards = fx.boards.filter((b) => b.id === "b1");
    const filteredStages = buildStages(filteredRows, FIXTURE_TODAY);
    render(
      <StagesTab
        rows={filteredRows}
        allRows={fx.rollup!}
        stages={filteredStages}
        stage={null}
        burn={fx.burn}
        boards={filteredBoards}
        todayISO={FIXTURE_TODAY}
        onSelectStage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const matrixSection = screen
      .getByText("Stage × board")
      .closest("section") as HTMLElement;
    expect(within(matrixSection).getByText("Backend")).toBeInTheDocument();
    expect(within(matrixSection).queryByText("Mobile")).toBeNull();
    expect(within(matrixSection).queryByText("Website")).toBeNull();
  });
});
