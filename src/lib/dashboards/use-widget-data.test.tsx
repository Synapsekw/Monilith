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

  it("marks a widget whose slot is absent from a resolved batch as errored", async () => {
    // The batch resolves but carries no entry for W2 (e.g. row not visible
    // under RLS, or a stale id) — that widget must surface an error, not a
    // silent empty state.
    getWidgetsData.mockResolvedValue({
      ok: true,
      data: {
        results: {
          [W1]: {
            ok: true,
            kind: "number",
            config: {},
            buckets: [{ group_key: null, metric: 2 }],
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
      expect(screen.getByTestId(W1)).toHaveTextContent("total:2"),
    );
    expect(screen.getByTestId(W2)).toHaveTextContent("error");
  });

  it("includes completion widgets in the batch and exposes data.completion", async () => {
    getWidgetsData.mockResolvedValue({
      ok: true,
      data: {
        results: {
          [W1]: {
            ok: true,
            kind: "completion",
            config: {},
            buckets: [],
            columnMeta: null,
            completion: {
              rows: [{ groupKey: "g1", itemCount: 2, completion: 50 }],
              groups: [{ id: "g1", label: "WS A", color: "#0073ea" }],
            },
          },
        },
      },
    });

    function CompletionProbe({ id }: { id: string }) {
      const { data, isLoading, isError } = useWidgetData(id);
      const text = isLoading
        ? "loading"
        : isError
          ? "error"
          : `rows:${data?.completion?.rows.length ?? "none"}`;
      return <div data-testid={id}>{text}</div>;
    }

    renderWithProvider(
      [widget(W1, { kind: "completion", config: { mode: "status" } })],
      <CompletionProbe id={W1} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId(W1)).toHaveTextContent("rows:1"),
    );
    // The completion widget rode the single batched fetch.
    expect(getWidgetsData).toHaveBeenCalledTimes(1);
    expect(getWidgetsData).toHaveBeenCalledWith({ widgetIds: [W1] });
  });

  it("degrades to a non-crashing error state when rendered without a provider", () => {
    // The widget-config sheet's live preview renders widget bodies outside the
    // dashboard grid's provider — the hook must not throw there.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <Probe id={W1} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId(W1)).toHaveTextContent("error");
    // No batched fetch is ever issued from a provider-less render.
    expect(getWidgetsData).not.toHaveBeenCalled();
  });
});
