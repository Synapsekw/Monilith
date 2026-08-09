import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportsIndex, scopeLabel } from "./ReportsIndex";
import { defaultReportConfig } from "@/lib/reports/config";

const base = {
  orgId: "o1",
  boardId: null,
  portfolioId: null,
  config: defaultReportConfig(),
  updatedAt: "2026-08-01T10:00:00.000Z",
};

describe("ReportsIndex smoke", () => {
  it("renders empty states", () => {
    render(<ReportsIndex reports={[]} templates={[]} />);
    expect(screen.getByText("No reports yet")).toBeInTheDocument();
    expect(screen.getByText(/No templates yet/)).toBeInTheDocument();
  });

  it("renders rows with scope chips and /reports links", () => {
    render(
      <ReportsIndex
        reports={[
          { ...base, id: "r1", scope: "board", boardId: "b1", name: "Weekly" },
          { ...base, id: "r2", scope: "boards", name: "Roll-up" },
          {
            ...base,
            id: "r3",
            scope: "portfolio",
            portfolioId: "p1",
            name: "Q3",
          },
        ]}
        templates={[{ ...base, id: "t1", scope: "template", name: "Exec" }]}
      />,
    );
    expect(screen.getByText("Weekly").closest("a")).toHaveAttribute(
      "href",
      "/reports/r1",
    );
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(screen.getByText("Multiple boards")).toBeInTheDocument();
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
    expect(screen.getByText("Exec").closest("a")).toHaveAttribute(
      "href",
      "/reports/t1",
    );
    expect(screen.getByText("3 reports in this organization")).toBeVisible();
    expect(scopeLabel("boards", 3)).toBe("3 boards");
  });
});
