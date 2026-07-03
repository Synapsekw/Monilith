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

import { CompletionWidget } from "@/components/dashboards/widgets/CompletionWidget";

function widget(over: Partial<CacheWidget> = {}): CacheWidget {
  return {
    id: "w1",
    kind: "completion",
    title: "Phase 1",
    source_board_id: "b1",
    config: {
      mode: "status",
      statusColumnId: "s1",
      doneOptionIds: ["opt-done"],
    },
    ...over,
  } as CacheWidget;
}

const groups = [
  { id: "g1", label: "WS A", color: "#0073ea" },
  { id: "g2", label: "WS B", color: "#00c875" },
  { id: "g3", label: "Empty", color: "#999999" },
];

beforeEach(() => {
  hookState.data = undefined;
  hookState.isLoading = false;
  hookState.isError = false;
});

describe("CompletionWidget", () => {
  it("prompts for configuration when unconfigured", () => {
    render(
      <CompletionWidget widget={widget({ config: { mode: "status" } })} />,
    );
    expect(
      screen.getByText(/Configure a source board and completion source/),
    ).toBeInTheDocument();
  });

  it("prompts for configuration without a source board", () => {
    render(<CompletionWidget widget={widget({ source_board_id: null })} />);
    expect(
      screen.getByText(/Configure a source board and completion source/),
    ).toBeInTheDocument();
  });

  it("renders overall percent and one row per group", () => {
    hookState.data = {
      buckets: [],
      columnMeta: null,
      completion: {
        rows: [
          { groupKey: "g1", itemCount: 3, completion: 50 },
          { groupKey: "g2", itemCount: 1, completion: 100 },
        ],
        groups,
      },
      health: null,
    };
    render(<CompletionWidget widget={widget()} />);
    // weighted overall: (50*3 + 100*1) / 4 = 62.5 → rounded 63%
    expect(screen.getByText("63%")).toBeInTheDocument();
    expect(screen.getByText("WS A")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("WS B")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    // Empty group renders an em dash, not 0%.
    expect(screen.getByText("Empty")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the empty state for a board with no items", () => {
    hookState.data = {
      buckets: [],
      columnMeta: null,
      completion: { rows: [], groups },
      health: null,
    };
    render(<CompletionWidget widget={widget()} />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("shows the error state", () => {
    hookState.isError = true;
    render(<CompletionWidget widget={widget()} />);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("shows the loading skeleton", () => {
    hookState.isLoading = true;
    const { container } = render(<CompletionWidget widget={widget()} />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });
});
