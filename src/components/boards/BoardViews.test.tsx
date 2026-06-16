import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardViews } from "@/components/boards/BoardViews";
import type { BoardPayload } from "@/lib/boards/queries";

// Drive the active view purely from the URL search params (the client-side
// switch path) — no server refetch is involved.
let viewParam: string | null = null;
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(viewParam ? `view=${viewParam}` : ""),
}));

// Stub the heavy view components so this test isolates the routing decision
// (which view renders) from cache/realtime/render concerns.
vi.mock("@/components/boards/KanbanBoard", () => ({
  KanbanBoard: ({ selectedViewId }: { selectedViewId: string }) => (
    <div data-testid="kanban">kanban:{selectedViewId}</div>
  ),
}));
vi.mock("@/components/boards/BoardTable", () => ({
  BoardTable: ({ selectedViewId }: { selectedViewId: string }) => (
    <div data-testid="table">table:{selectedViewId}</div>
  ),
}));
vi.mock("@/components/boards/CalendarBoard", () => ({
  CalendarBoard: ({ selectedViewId }: { selectedViewId: string }) => (
    <div data-testid="calendar">calendar:{selectedViewId}</div>
  ),
}));
vi.mock("@/components/boards/GanttBoard", () => ({
  GanttBoard: ({ selectedViewId }: { selectedViewId: string }) => (
    <div data-testid="gantt">gantt:{selectedViewId}</div>
  ),
}));

const payload = {
  board: { id: "b1", name: "Board", org_id: "o1" },
  views: [
    { id: "v1", kind: "table", name: "Main Table" },
    { id: "v2", kind: "kanban", name: "Kanban" },
    { id: "v3", kind: "calendar", name: "Calendar" },
    { id: "v4", kind: "timeline", name: "Timeline" },
  ],
  groups: [],
  columns: [],
  items: [],
  cellValues: [],
  dependencies: [],
} as unknown as BoardPayload;

describe("BoardViews", () => {
  it("renders the table view when the URL selects a table view", () => {
    viewParam = "v1";
    render(<BoardViews payload={payload} members={[]} initialViewId="v1" />);
    expect(screen.getByTestId("table")).toHaveTextContent("table:v1");
    expect(screen.queryByTestId("kanban")).not.toBeInTheDocument();
  });

  it("renders the kanban view when the URL selects a kanban view", () => {
    viewParam = "v2";
    render(<BoardViews payload={payload} members={[]} initialViewId="v1" />);
    expect(screen.getByTestId("kanban")).toHaveTextContent("kanban:v2");
    expect(screen.queryByTestId("table")).not.toBeInTheDocument();
  });

  it("falls back to initialViewId when the URL has no view param", () => {
    viewParam = null;
    render(<BoardViews payload={payload} members={[]} initialViewId="v2" />);
    expect(screen.getByTestId("kanban")).toHaveTextContent("kanban:v2");
  });

  it("renders the calendar view when the URL selects a calendar view", () => {
    viewParam = "v3";
    render(<BoardViews payload={payload} members={[]} initialViewId="v1" />);
    expect(screen.getByTestId("calendar")).toHaveTextContent("calendar:v3");
    expect(screen.queryByTestId("kanban")).not.toBeInTheDocument();
    expect(screen.queryByTestId("table")).not.toBeInTheDocument();
  });

  it("renders the gantt view when the URL selects a timeline view", () => {
    viewParam = "v4";
    render(<BoardViews payload={payload} members={[]} initialViewId="v1" />);
    expect(screen.getByTestId("gantt")).toHaveTextContent("gantt:v4");
    expect(screen.queryByTestId("kanban")).not.toBeInTheDocument();
    expect(screen.queryByTestId("table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calendar")).not.toBeInTheDocument();
  });
});
