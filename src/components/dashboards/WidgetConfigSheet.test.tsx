import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const getWidgetPreviewData = vi.fn();
vi.mock("@/lib/dashboards/actions", () => ({
  createWidget: vi.fn(),
  updateWidgetConfig: vi.fn(),
  deleteWidget: vi.fn(),
  renameDashboard: vi.fn(),
  saveLayout: vi.fn(),
  getWidgetsData: vi.fn(),
  getWidgetRows: vi.fn(),
  getWidgetSeries: vi.fn(),
  getWidgetPreviewData: (...a: unknown[]) => getWidgetPreviewData(...a),
}));

// Chart (recharts) and List rendering internals are out of scope here; the
// aggregate widgets stay REAL so we prove live data reaches the preview body.
vi.mock("@/components/dashboards/widgets/ChartWidget", () => ({
  ChartWidget: () => <div data-testid="chart-widget" />,
}));
vi.mock("@/components/dashboards/widgets/ListWidget", () => ({
  ListWidget: () => <div data-testid="list-widget" />,
}));

import { WidgetConfigSheet } from "./WidgetConfigSheet";
import type { BoardOption } from "./WidgetConfigForm";
import type { CacheWidget } from "@/lib/dashboards/cache";

const BOARD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const WIDGET_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const boardOption: BoardOption = {
  id: BOARD_ID,
  name: "Sprint board",
  numbersColumns: [],
  statusColumns: [{ id: "col-1", name: "Status" }],
  dateColumns: [],
  peopleColumns: [],
  dropdownColumns: [],
  percentColumns: [],
  allColumns: [],
};

function renderSheet(props: {
  boards: BoardOption[];
  editWidget?: CacheWidget;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <WidgetConfigSheet
      dashboardId="dash1"
      boards={props.boards}
      open
      onOpenChange={() => {}}
      editWidget={props.editWidget}
    />,
    { wrapper: Wrapper },
  );
}

describe("WidgetConfigSheet live preview (inside WidgetPreviewProvider)", () => {
  it("opens the add-widget sheet without a board and issues no preview fetch", () => {
    getWidgetPreviewData.mockReset();
    renderSheet({ boards: [] });
    expect(screen.getByText("Add a widget")).toBeInTheDocument();
    expect(screen.getByText("Live preview")).toBeInTheDocument();
    // No source board → widget shows its own affordance; no server round-trip.
    expect(screen.getByText("Pick a source board")).toBeInTheDocument();
    expect(getWidgetPreviewData).not.toHaveBeenCalled();
  });

  it("renders LIVE number data in the preview once a board is preselected", async () => {
    getWidgetPreviewData.mockReset();
    getWidgetPreviewData.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: "number",
          config: { agg: "count" },
          buckets: [{ group_key: null, metric: 42 }],
          columnMeta: null,
        },
      },
    });
    renderSheet({ boards: [boardOption] });
    // The real NumberWidget renders the fetched metric — not "Failed to load".
    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
    expect(screen.queryByText("Failed to load")).not.toBeInTheDocument();
    // Debounced single-widget fetch for the draft (kind+board+config).
    await waitFor(() =>
      expect(getWidgetPreviewData).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "number", sourceBoardId: BOARD_ID }),
      ),
    );
  });

  it("renders LIVE battery data in edit mode from the draft config", async () => {
    getWidgetPreviewData.mockReset();
    getWidgetPreviewData.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: "battery",
          config: { groupColumnId: "col-1" },
          buckets: [{ group_key: "col-1", metric: 3 }],
          columnMeta: {
            kind: "status",
            options: [{ id: "col-1", label: "Status", color: "#22c55e" }],
          },
        },
      },
    });
    const target = {
      id: WIDGET_ID,
      kind: "battery",
      title: "By status",
      config: { groupColumnId: "col-1" },
      source_board_id: BOARD_ID,
      dashboard_id: "dash1",
      org_id: "org1",
      layout: {},
      position: 0,
      created_at: "2026-06-18T00:00:00Z",
      updated_at: "2026-06-18T00:00:00Z",
    } as CacheWidget;

    renderSheet({ boards: [boardOption], editWidget: target });
    expect(screen.getByText("Edit widget")).toBeInTheDocument();
    // BatteryWidget renders its option label from live data (no error state).
    await waitFor(() => expect(screen.getByText("Status")).toBeInTheDocument());
    expect(screen.queryByText("Failed to load")).not.toBeInTheDocument();
  });

  it("shows the preview error state when the draft fetch fails", async () => {
    getWidgetPreviewData.mockReset();
    getWidgetPreviewData.mockResolvedValue({ ok: false, error: "boom" });
    renderSheet({ boards: [boardOption] });
    await waitFor(() =>
      expect(screen.getByText("Failed to load")).toBeInTheDocument(),
    );
  });
});
