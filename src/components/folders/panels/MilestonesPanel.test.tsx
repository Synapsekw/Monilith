import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fmtDay } from "@/lib/folders/tower";
import { MilestonesPanel } from "./MilestonesPanel";

describe("MilestonesPanel dates", () => {
  it("formats in UTC and adds the year only outside the current year", () => {
    render(
      <MilestonesPanel
        kicker="07"
        todayISO="2026-11-15"
        milestones={[
          { stageKey: "qa", name: "QA", endDate: "2026-12-01", open: 2 },
          {
            stageKey: "launch",
            name: "Launch",
            endDate: "2027-01-04",
            open: 1,
          },
        ]}
      />,
    );
    expect(screen.getByText("Dec 1 · 2 open")).toBeInTheDocument();
    expect(screen.getByText("Jan 4, 2027 · 1 open")).toBeInTheDocument();
  });

  it("never shifts a date by the browser's time zone", () => {
    // Midnight UTC is still the previous evening west of Greenwich; the UTC
    // formatter keeps the calendar date the page's weeks are built on.
    expect(fmtDay("2026-12-01")).toBe("Dec 1");
    expect(fmtDay("2026-12-01T00:00:00.000Z", "2026-01-01")).toBe("Dec 1");
    expect(fmtDay("2025-12-29", "2026-01-02")).toBe("Dec 29, 2025");
  });
});
