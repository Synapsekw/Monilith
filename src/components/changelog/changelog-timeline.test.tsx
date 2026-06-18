import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChangelogTimeline } from "./changelog-timeline";
import type { ChangelogEntry } from "@/lib/changelog/types";

const entries: ChangelogEntry[] = [
  {
    date: "2026-06-18",
    kind: "new",
    title: "Automations",
    description: "Rules engine.",
  },
  { date: "2026-06-10", kind: "fixed", title: "Board load bug" },
];

describe("ChangelogTimeline", () => {
  it("renders an entry's title, description and badge", () => {
    render(<ChangelogTimeline entries={entries} />);
    expect(screen.getByText("Automations")).toBeInTheDocument();
    expect(screen.getByText("Rules engine.")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Fixed")).toBeInTheDocument();
  });

  it("renders both date headers, newest first", () => {
    render(<ChangelogTimeline entries={entries} />);
    const headers = screen.getAllByRole("heading", { level: 2 });
    expect(headers[0]).toHaveTextContent("June 18, 2026");
    expect(headers[1]).toHaveTextContent("June 10, 2026");
  });

  it("renders an empty state when there are no entries", () => {
    render(<ChangelogTimeline entries={[]} />);
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });
});
