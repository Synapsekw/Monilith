import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the server action behind editWidget → updateWidgetConfig so no Supabase
// call happens; we assert on the args + shape the dialog sends.
const updateWidgetConfig = vi.fn();
vi.mock("@/lib/dashboards/actions", () => ({
  updateWidgetConfig: (...a: unknown[]) => updateWidgetConfig(...a),
}));

import { EditListWidgetDialog } from "./EditListWidgetDialog";
import type { BoardOption } from "./AddWidgetDialog";
import type { CacheWidget } from "@/lib/dashboards/cache";

const COL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WIDGET_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const BOARD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const BOARD: BoardOption = {
  id: BOARD_ID,
  name: "Tasks",
  numbersColumns: [],
  statusColumns: [],
  allColumns: [
    { id: COL_A, name: "Title", kind: "text", options: [] },
    { id: COL_B, name: "Status", kind: "status", options: [] },
  ],
};

function makeWidget(config: Record<string, unknown>): CacheWidget {
  return {
    id: WIDGET_ID,
    kind: "list",
    title: "My list",
    config,
    source_board_id: BOARD_ID,
    dashboard_id: "dash1",
    org_id: "org1",
    layout: {},
    position: 0,
    created_at: "2026-06-18T00:00:00Z",
    updated_at: "2026-06-18T00:00:00Z",
  } as CacheWidget;
}

function renderDialog(widget: CacheWidget) {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const onOpenChange = vi.fn();
  render(
    <EditListWidgetDialog
      widget={widget}
      board={BOARD}
      dashboardId="dash1"
      open
      onOpenChange={onOpenChange}
    />,
    { wrapper: Wrapper },
  );
  return { onOpenChange };
}

describe("EditListWidgetDialog", () => {
  beforeEach(() => {
    updateWidgetConfig.mockReset();
    updateWidgetConfig.mockResolvedValue({
      ok: true,
      data: { widget: makeWidget({}) },
    });
  });

  it("pre-fills state from the widget's existing config", () => {
    renderDialog(makeWidget({ columnIds: [COL_A], limit: 10 }));

    // Only the column in columnIds is checked.
    const titleBox = screen.getByLabelText("Title") as HTMLInputElement;
    const statusBox = screen.getByLabelText("Status") as HTMLInputElement;
    expect(titleBox.checked).toBe(true);
    expect(statusBox.checked).toBe(false);

    // Limit reflects the saved value.
    const limitBox = screen.getByLabelText(/max rows/i) as HTMLInputElement;
    expect(limitBox.value).toBe("10");
  });

  it("saves columnIds + limit and omits an empty filter", async () => {
    renderDialog(makeWidget({ columnIds: [COL_A], limit: 10 }));

    // Add the second column, then save.
    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(updateWidgetConfig).toHaveBeenCalledTimes(1));
    const arg = updateWidgetConfig.mock.calls[0][0];
    expect(arg.widgetId).toBe(WIDGET_ID);
    expect(arg.config).toEqual({ columnIds: [COL_A, COL_B], limit: 10 });
    // No filter key when there are no conditions.
    expect("filter" in arg.config).toBe(false);
  });

  it("includes the filter in config when conditions exist", async () => {
    renderDialog(
      makeWidget({
        columnIds: [COL_A],
        limit: 25,
        filter: {
          combinator: "and",
          conditions: [{ columnId: COL_B, operator: "is_empty" }],
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(updateWidgetConfig).toHaveBeenCalledTimes(1));
    const arg = updateWidgetConfig.mock.calls[0][0];
    expect(arg.config.filter).toEqual({
      combinator: "and",
      conditions: [{ columnId: COL_B, operator: "is_empty" }],
    });
  });

  it("closes the dialog on a successful save", async () => {
    const { onOpenChange } = renderDialog(
      makeWidget({ columnIds: [], limit: 25 }),
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
