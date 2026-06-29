import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DashboardCache } from "@/lib/dashboards/cache";

// --- Mocks ------------------------------------------------------------------
// Mock the cache/mutation hooks so the canvas renders without React Query /
// Supabase. We only exercise the edit-toggle + render structure here (jsdom
// can't simulate react-grid-layout touch physics or the (pointer: coarse)
// media query — those are asserted at the source level below).
const persistLayout = { mutate: vi.fn() };
const renameDashboard = vi.fn();

vi.mock("@/lib/dashboards/use-dashboard-cache", () => ({
  useDashboardCache: (_id: string, initialData: DashboardCache) => ({
    data: initialData,
  }),
}));
vi.mock("@/lib/dashboards/use-dashboard-mutations", () => ({
  useDashboardMutations: () => ({ persistLayout, renameDashboard }),
}));

// Stub the widget body — it fetches its own data and is irrelevant here.
vi.mock("./DashboardWidget", () => ({
  DashboardWidget: ({ widget }: { widget: { title: string } }) => (
    <div data-testid="widget">{widget.title}</div>
  ),
}));
// Stub the add-widget sheet — pulls in board/data deps we don't need.
vi.mock("./WidgetConfigSheet", () => ({
  WidgetConfigSheet: () => null,
}));

import { DashboardCanvas } from "./DashboardCanvas";

const WIDGET_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function makeCache(): DashboardCache {
  return {
    dashboard: {
      id: "dash1",
      name: "Ops",
      org_id: "org1",
      workspace_id: "ws1",
      created_by: "u1",
      created_at: "2026-06-18T00:00:00Z",
      updated_at: "2026-06-18T00:00:00Z",
    },
    widgets: [
      {
        id: WIDGET_ID,
        kind: "number",
        title: "Widget A",
        config: { agg: "count" },
        source_board_id: null,
        dashboard_id: "dash1",
        org_id: "org1",
        layout: { x: 0, y: 0, w: 3, h: 2 },
        position: 0,
        created_at: "2026-06-18T00:00:00Z",
        updated_at: "2026-06-18T00:00:00Z",
      },
    ] as DashboardCache["widgets"],
  };
}

beforeEach(() => {
  persistLayout.mutate.mockClear();
  renameDashboard.mockClear();
});

describe("DashboardCanvas", () => {
  it("renders an Edit toggle and the widget grid", () => {
    render(<DashboardCanvas initialData={makeCache()} boards={[]} />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByTestId("widget")).toBeInTheDocument();
  });

  it("flips Edit → Done (guards the editing state that gates drag/resize)", () => {
    render(<DashboardCanvas initialData={makeCache()} boards={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    // Toggling to edit mode enables react-grid-layout drag/resize via
    // dragConfig/resizeConfig={{ enabled: editing }} — the button label is the
    // observable proxy for that state.
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("ships the coarse-pointer resize-handle override and imports it in the layout", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/(app)/dashboards/dashboards.touch.css"),
      "utf8",
    );
    expect(css).toContain("@media (pointer: coarse)");
    expect(css).toContain(".react-resizable-handle");
    expect(css).toContain("width: 44px");

    const layout = readFileSync(
      join(process.cwd(), "src/app/(app)/dashboards/layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("./dashboards.touch.css");
  });
});
