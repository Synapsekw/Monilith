import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const getWidgetPreviewData = vi.fn();
vi.mock("@/lib/dashboards/actions", () => ({
  getWidgetPreviewData: (...a: unknown[]) => getWidgetPreviewData(...a),
}));

import { WidgetPreviewProvider, useWidgetPreview } from "./use-widget-preview";
import { useWidgetData } from "./use-widget-data";

const BOARD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PID = "__preview__";

function AggProbe() {
  const { data, isError } = useWidgetData(PID);
  return (
    <div data-testid="agg">
      {isError
        ? "error"
        : `total:${(data?.buckets ?? []).reduce((s, b) => s + b.metric, 0)}`}
    </div>
  );
}
function SeriesProbe() {
  const { series } = useWidgetPreview();
  return <div data-testid="series">pts:{series?.points.length ?? "none"}</div>;
}

function wrap(kind: string, sourceBoardId: string, ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetPreviewProvider
        previewWidgetId={PID}
        kind={kind as never}
        sourceBoardId={sourceBoardId}
        config={{ agg: "count" }}
      >
        {ui}
      </WidgetPreviewProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => getWidgetPreviewData.mockReset());

describe("WidgetPreviewProvider", () => {
  it("feeds an aggregate draft into useWidgetData", async () => {
    getWidgetPreviewData.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: "number",
          config: {},
          buckets: [{ group_key: null, metric: 6 }],
          columnMeta: null,
        },
      },
    });
    wrap("number", BOARD, <AggProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("agg")).toHaveTextContent("total:6"),
    );
    expect(getWidgetPreviewData).toHaveBeenCalledTimes(1);
    expect(getWidgetPreviewData).toHaveBeenCalledWith({
      kind: "number",
      sourceBoardId: BOARD,
      config: { agg: "count" },
    });
  });

  it("feeds a chart draft into useWidgetPreview().series", async () => {
    getWidgetPreviewData.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        shape: "series",
        payload: {
          chartType: "bar",
          primaryKind: "date",
          seriesKind: null,
          points: [
            {
              primaryKey: "k",
              primaryLabel: "K",
              seriesKey: null,
              seriesLabel: null,
              seriesColor: "#000",
              value: 1,
            },
          ],
        },
      },
    });
    wrap("chart", BOARD, <SeriesProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("series")).toHaveTextContent("pts:1"),
    );
  });

  it("does not fetch when no board is chosen", () => {
    wrap("number", "", <AggProbe />);
    expect(getWidgetPreviewData).not.toHaveBeenCalled();
  });
});
