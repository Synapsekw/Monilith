import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StageMatrix } from "./StageMatrix";

describe("StageMatrix", () => {
  const cells = new Map([
    [
      "b1",
      new Map<string, number | null>([
        ["build", 95],
        ["qa", null],
      ]),
    ],
    [
      "b2",
      new Map<string, number | null>([
        ["build", 40],
        ["qa", 10],
      ]),
    ],
  ]);
  it("renders a % badge per (board, stage) coloured by band and an em dash for missing", () => {
    render(
      <StageMatrix
        boards={[
          { id: "b1", name: "Backend" },
          { id: "b2", name: "Mobile" },
        ]}
        stages={[
          { key: "build", name: "Build" },
          { key: "qa", name: "QA" },
        ]}
        cells={cells}
      />,
    );
    expect(screen.getByText("95%")).toHaveAttribute("data-band", "green");
    expect(screen.getByText("40%")).toHaveAttribute("data-band", "yellow");
    expect(screen.getByText("10%")).toHaveAttribute("data-band", "gray");
    expect(screen.getByText("—")).toBeInTheDocument();
  });
  it("clicking a stage header selects it", () => {
    const onSelect = vi.fn();
    render(
      <StageMatrix
        boards={[]}
        stages={[{ key: "build", name: "Build" }]}
        cells={new Map()}
        onSelectStage={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(onSelect).toHaveBeenCalledWith("build");
  });
});
