import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the server action behind editWidget → updateWidgetConfig so no Supabase
// call happens; we assert on the args the header rename sends.
const updateWidgetConfig = vi.fn();
vi.mock("@/lib/dashboards/actions", () => ({
  updateWidgetConfig: (...a: unknown[]) => updateWidgetConfig(...a),
}));

// Stub the widget bodies — they fetch their own data and are irrelevant to the
// header rename behavior under test.
vi.mock("./widgets/NumberWidget", () => ({ NumberWidget: () => <div /> }));
vi.mock("./widgets/ChartWidget", () => ({ ChartWidget: () => <div /> }));
vi.mock("./widgets/BatteryWidget", () => ({ BatteryWidget: () => <div /> }));
vi.mock("./widgets/ListWidget", () => ({ ListWidget: () => <div /> }));

import { DashboardWidget } from "./DashboardWidget";
import type { CacheWidget } from "@/lib/dashboards/cache";

const WIDGET_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const BOARD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeWidget(title: string): CacheWidget {
  return {
    id: WIDGET_ID,
    kind: "number",
    title,
    config: { agg: "count" },
    source_board_id: BOARD_ID,
    dashboard_id: "dash1",
    org_id: "org1",
    layout: {},
    position: 0,
    created_at: "2026-06-18T00:00:00Z",
    updated_at: "2026-06-18T00:00:00Z",
  } as CacheWidget;
}

function renderWidget(widget: CacheWidget, editing: boolean) {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(
    <DashboardWidget
      widget={widget}
      dashboardId="dash1"
      editing={editing}
      boards={[]}
    />,
    { wrapper: Wrapper },
  );
}

describe("DashboardWidget header rename", () => {
  beforeEach(() => {
    updateWidgetConfig.mockReset();
    updateWidgetConfig.mockResolvedValue({
      ok: true,
      data: { widget: makeWidget("New Title") },
    });
  });

  it("renames the widget via the inline title in edit mode", async () => {
    renderWidget(makeWidget("Old Title"), true);

    // Click the title to enter inline edit.
    fireEvent.click(screen.getByRole("button", { name: "Old Title" }));

    const input = screen.getByLabelText("Widget title") as HTMLInputElement;
    expect(input.value).toBe("Old Title");

    fireEvent.change(input, { target: { value: "New Title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(updateWidgetConfig).toHaveBeenCalledTimes(1));
    expect(updateWidgetConfig.mock.calls[0][0]).toEqual({
      widgetId: WIDGET_ID,
      title: "New Title",
    });
  });

  it("does not offer title editing when not in edit mode", () => {
    renderWidget(makeWidget("Old Title"), false);
    // The title is plain text, not an editable control.
    expect(
      screen.queryByRole("button", { name: "Old Title" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Old Title")).toBeInTheDocument();
  });

  it("is a no-op when the title is unchanged", async () => {
    renderWidget(makeWidget("Old Title"), true);
    fireEvent.click(screen.getByRole("button", { name: "Old Title" }));
    const input = screen.getByLabelText("Widget title");
    fireEvent.keyDown(input, { key: "Enter" });
    // No mutation fired for an unchanged title.
    await waitFor(() =>
      expect(screen.queryByLabelText("Widget title")).not.toBeInTheDocument(),
    );
    expect(updateWidgetConfig).not.toHaveBeenCalled();
  });
});
