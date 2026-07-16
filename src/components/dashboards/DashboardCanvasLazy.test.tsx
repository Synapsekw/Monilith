import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DashboardCache } from "@/lib/dashboards/cache";
import { DashboardCanvasLazy } from "./DashboardCanvasLazy";

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
    widgets: [] as DashboardCache["widgets"],
  };
}

describe("DashboardCanvasLazy", () => {
  it("shows the canvas skeleton while the grid chunk loads", () => {
    // react-grid-layout (DashboardCanvas' only heavy dep) is behind a
    // next/dynamic(ssr:false) boundary, so on the first synchronous render the
    // loading fallback — DashboardCanvasSkeleton, a grid of widget skeletons —
    // is what paints, not the real grid. This proves the chunk is deferred.
    render(<DashboardCanvasLazy initialData={makeCache()} boards={[]} />);
    expect(screen.getAllByTestId("widget-skeleton").length).toBeGreaterThan(0);
  });
});
