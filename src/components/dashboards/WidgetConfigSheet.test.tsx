import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the server-actions module (pulled in by useDashboardMutations and the
// batched widget-data hook) — no Supabase in jsdom. None should be called here.
vi.mock("@/lib/dashboards/actions", () => ({
  createWidget: vi.fn(),
  updateWidgetConfig: vi.fn(),
  deleteWidget: vi.fn(),
  renameDashboard: vi.fn(),
  saveLayout: vi.fn(),
  getWidgetsData: vi.fn(),
  getWidgetRows: vi.fn(),
  getWidgetSeries: vi.fn(),
}));

// Chart (recharts) and List previews are out of scope — the crash regression
// under test lives in the aggregate widgets, which stay REAL below.
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

// Regression: the live preview renders the REAL NumberWidget/BatteryWidget
// outside the dashboard grid's WidgetDataProvider. useWidgetData must degrade
// (no provider → stable error/empty state), never throw — opening "Add a
// widget" used to crash the sheet.
describe("WidgetConfigSheet live preview (outside WidgetDataProvider)", () => {
  it("opens the add-widget sheet without crashing when no board exists yet", () => {
    renderSheet({ boards: [] });
    expect(screen.getByText("Add a widget")).toBeInTheDocument();
    expect(screen.getByText("Live preview")).toBeInTheDocument();
    // Default draft kind is "number" with no source board → the widget's own
    // configure affordance renders (the pre-crash empty state).
    expect(screen.getByText("Pick a source board")).toBeInTheDocument();
  });

  it("renders the number preview's non-crashing state once a board is preselected", () => {
    renderSheet({ boards: [boardOption] });
    expect(screen.getByText("Live preview")).toBeInTheDocument();
    // Draft has a source board, so the widget body consults useWidgetData —
    // outside the provider it degrades to the error/empty state (same as the
    // old per-widget hook, whose preview id failed Zod), instead of throwing.
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("renders the battery preview without crashing in edit mode", () => {
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
    // Fully-configured battery outside the provider → degraded error state,
    // not a render crash.
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });
});
