import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the batched server action; the provider is the unit under test.
const getWidgetsData = vi.fn();
vi.mock("@/lib/dashboards/actions", () => ({
  getWidgetsData: (...a: unknown[]) => getWidgetsData(...a),
}));

import { WidgetDataProvider, useWidgetData } from "./use-widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";

const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const W2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function widget(id: string, over: Partial<CacheWidget> = {}): CacheWidget {
  return {
    id,
    kind: "number",
    title: "W",
    config: { agg: "count" },
    source_board_id: "board",
    dashboard_id: "dash1",
    org_id: "org1",
    layout: {},
    position: 0,
    created_at: "2026-06-18T00:00:00Z",
    updated_at: "2026-06-18T00:00:00Z",
    ...over,
  } as CacheWidget;
}

function Probe({ id }: { id: string }) {
  const { data, isLoading, isError } = useWidgetData(id);
  const text = isLoading
    ? "loading"
    : isError
      ? "error"
      : `total:${(data?.buckets ?? []).reduce((s, b) => s + b.metric, 0)}`;
  return <div data-testid={id}>{text}</div>;
}

function renderWithProvider(widgets: CacheWidget[], children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetDataProvider dashboardId="dash1" widgets={widgets}>
        {children}
      </WidgetDataProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => getWidgetsData.mockReset());

describe("WidgetDataProvider / useWidgetData", () => {
  it("fetches once for the whole dashboard and distributes per-widget results", async () => {
    getWidgetsData.mockResolvedValue({
      ok: true,
      data: {
        results: {
          [W1]: {
            ok: true,
            kind: "number",
            config: {},
            buckets: [{ group_key: null, metric: 5 }],
            columnMeta: null,
          },
          [W2]: {
            ok: true,
            kind: "number",
            config: {},
            buckets: [{ group_key: null, metric: 9 }],
            columnMeta: null,
          },
        },
      },
    });

    renderWithProvider(
      [widget(W1), widget(W2)],
      <>
        <Probe id={W1} />
        <Probe id={W2} />
      </>,
    );

    await waitFor(() =>
      expect(screen.getByTestId(W1)).toHaveTextContent("total:5"),
    );
    expect(screen.getByTestId(W2)).toHaveTextContent("total:9");

    // A single batched round-trip for both widgets.
    expect(getWidgetsData).toHaveBeenCalledTimes(1);
    expect(getWidgetsData).toHaveBeenCalledWith({ widgetIds: [W1, W2].sort() });
  });

  it("surfaces one widget's failure without blanking the others", async () => {
    getWidgetsData.mockResolvedValue({
      ok: true,
      data: {
        results: {
          [W1]: {
            ok: true,
            kind: "number",
            config: {},
            buckets: [{ group_key: null, metric: 4 }],
            columnMeta: null,
          },
          [W2]: { ok: false, error: "boom" },
        },
      },
    });

    renderWithProvider(
      [widget(W1), widget(W2)],
      <>
        <Probe id={W1} />
        <Probe id={W2} />
      </>,
    );

    await waitFor(() =>
      expect(screen.getByTestId(W2)).toHaveTextContent("error"),
    );
    // The healthy widget still renders its value.
    expect(screen.getByTestId(W1)).toHaveTextContent("total:4");
  });
});
