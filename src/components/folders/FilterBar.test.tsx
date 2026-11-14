import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageSummary } from "@/lib/folders/stages";
import { FilterBar, STAGE_CHIP_LIMIT } from "./FilterBar";

const stage = (i: number): StageSummary => ({
  key: `stage ${i}`,
  name: `Stage ${i}`,
  color: "#579bfc",
  position: i,
  boardIds: ["b1"],
  onlyOnBoard: "b1",
  total: 1,
  done: 0,
  inProgress: 0,
  overdue: 0,
  notStarted: 1,
  blocked: 0,
  stale: 0,
  unassigned: 0,
  minDue: null,
  maxDue: null,
  state: "upcoming",
});
const stages = (n: number) => Array.from({ length: n }, (_, i) => stage(i + 1));

function renderBar(count: number, selected: string | null = null) {
  const onStage = vi.fn();
  render(
    <FilterBar
      stages={stages(count)}
      boards={[{ id: "b1", name: "Backend", position: 0 }]}
      stage={selected}
      board={null}
      itemCount={count}
      onStage={onStage}
      onBoard={vi.fn()}
    />,
  );
  return onStage;
}

describe("FilterBar stage control", () => {
  it("keeps the chip row at the limit of eight stages", () => {
    expect(STAGE_CHIP_LIMIT).toBe(8);
    renderBar(8);
    const group = screen.getByRole("group", { name: "Stage" });
    // "All" + one chip per stage.
    expect(within(group).getAllByRole("button")).toHaveLength(9);
    expect(
      screen.queryByRole("combobox", { name: "Stage" }),
    ).not.toBeInTheDocument();
  });

  it("becomes one Stages menu at nine", () => {
    renderBar(9);
    expect(
      screen.queryByRole("group", { name: "Stage" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Stage" })).toHaveTextContent(
      "All stages",
    );
  });

  it("shows the selected stage on the button, as its description", () => {
    renderBar(9, "stage 3");
    const trigger = screen.getByRole("combobox", { name: "Stage" });
    expect(trigger).toHaveTextContent("Stage 3");
    expect(trigger).toHaveAccessibleDescription("Stage 3");
  });

  it("searches the list and selects a stage by its key", async () => {
    const user = userEvent.setup();
    const onStage = renderBar(12);
    await user.click(screen.getByRole("combobox", { name: "Stage" }));
    await user.type(screen.getByPlaceholderText("Search stages…"), "Stage 7");
    await user.click(await screen.findByRole("option", { name: /Stage 7/ }));
    expect(onStage).toHaveBeenCalledTimes(1);
    expect(onStage).toHaveBeenCalledWith("stage 7");
  }, 15_000);

  it("clears the filter from the All stages entry", async () => {
    const user = userEvent.setup();
    const onStage = renderBar(9, "stage 3");
    await user.click(screen.getByRole("combobox", { name: "Stage" }));
    await user.click(await screen.findByRole("option", { name: "All stages" }));
    expect(onStage).toHaveBeenCalledWith(null);
  }, 15_000);

  it("still hides the stage control with a single stage", () => {
    renderBar(1);
    expect(
      screen.queryByRole("group", { name: "Stage" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Stage" }),
    ).not.toBeInTheDocument();
  });
});
