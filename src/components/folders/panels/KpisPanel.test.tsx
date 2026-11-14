import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";
import { KpisPanel } from "./KpisPanel";

const fx = folderFixture();
const all = [
  "complete",
  "gap",
  "overdue",
  "dueThisWeek",
  "blocked",
  "stale",
] as const;

function renderPanel(patch: Partial<Parameters<typeof KpisPanel>[0]> = {}) {
  render(
    <KpisPanel
      cards={[...all]}
      rows={fx.rollup!}
      todayISO={FIXTURE_TODAY}
      failed={false}
      onRetry={vi.fn()}
      {...patch}
    />,
  );
}

describe("KpisPanel", () => {
  it("draws sparklines from the burn rows when no board filter is set", () => {
    renderPanel({ burn: fx.burn, stage: null, board: null });
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(2);
  });

  it("draws no sparkline while a board filter is set or burn is missing", () => {
    renderPanel({ burn: fx.burn, stage: null, board: "b1" });
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("collapses zero cards into chips and keeps their labels findable", () => {
    const rows = fx.rollup!.map((r) => ({ ...r, blocked: 0, stale: 0 }));
    renderPanel({ rows });
    const chips = screen.getAllByTestId("kpi-chip").map((c) => c.textContent);
    expect(chips).toEqual(expect.arrayContaining(["Blocked0", "Stale0"]));
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    const cardLabels = screen
      .getAllByTestId("kpi-label")
      .map((n) => n.textContent);
    expect(cardLabels).not.toContain("Blocked");
    expect(cardLabels).toContain("Complete");
  });

  it("says so when the folder has no due dates", () => {
    const rows = fx.rollup!.map((r) => ({
      ...r,
      minDue: null,
      maxDue: null,
      plannedByToday: 0,
      overdue: 0,
      dueThisWeek: 0,
      dueThisWeekNotStarted: 0,
      oldestOverdue: null,
    }));
    renderPanel({ rows });
    expect(screen.getByText("No due dates set")).toBeInTheDocument();
    const cardLabels = screen
      .getAllByTestId("kpi-label")
      .map((n) => n.textContent);
    expect(cardLabels).not.toContain("Gap to plan");
    expect(cardLabels).not.toContain("Overdue");
  });

  it("only considers the cards the layout names", () => {
    const rows = fx.rollup!.map((r) => ({ ...r, stale: 0 }));
    renderPanel({ rows, cards: ["complete", "overdue"] });
    expect(screen.queryByText("Stale")).toBeNull();
  });
});
