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

  it("shows a change pill and a sparkline instead of the bar when a trend is given", () => {
    render(
      <KpiCard
        label="Overdue"
        value="601"
        progress={30}
        trend={{
          points: [540, 564, 601],
          kind: "line",
          color: "red",
          label: "Overdue, last 3 weeks",
          change: { text: "+37 this week", color: "red" },
        }}
      />,
    );
    expect(screen.getByText("+37 this week")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Overdue, last 3 weeks" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("never truncates the change pill; the sparkline wraps below instead", () => {
    render(
      <KpiCard
        label="Complete"
        value="34%"
        trend={{
          points: [0, 34],
          kind: "line",
          color: "green",
          label: "Complete, last 2 weeks",
          change: { text: "+34 pts this week", color: "green" },
        }}
      />,
    );
    const pill = screen.getByText("+34 pts this week");
    expect(pill).not.toHaveClass("truncate");
    // Never clipped, never wider than the card: on a card too narrow for one
    // line the pill wraps its words; the sparkline wraps below it.
    expect(pill).toHaveClass("text-clip", "whitespace-normal", "max-w-full");
    expect(pill).not.toHaveClass("whitespace-nowrap");
    expect(pill.parentElement).toHaveClass("flex-wrap");
    // The card may shrink to its grid track instead of overflowing it.
    expect(pill.closest("[data-testid='kpi-card']")).toHaveClass("min-w-0");
  });
});
