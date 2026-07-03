import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WidgetData } from "@/lib/dashboards/use-widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";

const hookState: {
  data: WidgetData | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

vi.mock("@/lib/dashboards/use-widget-data", () => ({
  useWidgetData: () => hookState,
}));

import { HealthWidget } from "@/components/dashboards/widgets/HealthWidget";

function widget(over: Partial<CacheWidget> = {}): CacheWidget {
  return {
    id: "w1",
    kind: "health",
    title: "Health",
    source_board_id: "b1",
    config: {},
    ...over,
  } as CacheWidget;
}

function healthData(
  over: Partial<NonNullable<WidgetData["health"]>> = {},
): WidgetData {
  return {
    buckets: [],
    columnMeta: null,
    completion: null,
    health: {
      totalItems: 8,
      doneItems: 2,
      overdueItems: 3,
      incompleteItems: 4,
      newItems7d: 1,
      ...over,
    },
  };
}

beforeEach(() => {
  hookState.data = undefined;
  hookState.isLoading = false;
  hookState.isError = false;
});

describe("HealthWidget", () => {
  it("prompts for configuration when no source board", () => {
    render(<HealthWidget widget={widget({ source_board_id: null })} />);
    expect(screen.getByText(/Configure a source board/)).toBeInTheDocument();
  });

  it("renders progress and the three counts", () => {
    hookState.data = healthData();
    render(<HealthWidget widget={widget()} />);
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText(/8 items/)).toBeInTheDocument();
    expect(screen.getByText("New this week")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("marks nonzero alert counts as destructive, zero as neutral", () => {
    hookState.data = healthData({ overdueItems: 0, incompleteItems: 4 });
    render(<HealthWidget widget={widget()} />);
    const overdueRow = screen.getByText("Overdue").closest("li")!;
    const overdueCount = overdueRow.querySelector("span:last-child")!;
    expect(overdueCount.className).not.toContain("text-destructive");
    const incompleteRow = screen.getByText("Incomplete").closest("li")!;
    const incompleteCount = incompleteRow.querySelector("span:last-child")!;
    expect(incompleteCount.className).toContain("text-destructive");
  });

  it("shows the empty state for a board with no items", () => {
    hookState.data = healthData({
      totalItems: 0,
      doneItems: 0,
      overdueItems: 0,
      incompleteItems: 0,
      newItems7d: 0,
    });
    render(<HealthWidget widget={widget()} />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("shows the error state", () => {
    hookState.isError = true;
    render(<HealthWidget widget={widget()} />);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("shows the loading skeleton", () => {
    hookState.isLoading = true;
    const { container } = render(<HealthWidget widget={widget()} />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });
});
