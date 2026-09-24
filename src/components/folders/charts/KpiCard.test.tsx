import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiCard } from "./KpiCard";

describe("KpiCard", () => {
  it("renders label, value, badge, sub-fact and a bar scaled to progress", () => {
    render(
      <KpiCard
        label="Complete"
        value="62%"
        badge={{ text: "31 done", color: "green" }}
        subFact="38 planned by today"
        progress={62}
        barColor="green"
      />,
    );
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("31 done")).toBeInTheDocument();
    expect(screen.getByText("38 planned by today")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "62");
    expect(bar.firstElementChild).toHaveStyle({ width: "62%" });
  });

  it("renders an em dash and no bar when progress is null", () => {
    render(<KpiCard label="Gap to plan" value="—" progress={null} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
