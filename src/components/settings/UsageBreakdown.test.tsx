import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UsageBreakdown } from "@/components/settings/UsageBreakdown";
import type { UsageSummary } from "@/lib/ai/usage-summary";

// The recharts trend is deferred behind next/dynamic (LazyUsageTrendChart).
// Stub the heavy module so these tests assert the lazy boundary, not recharts
// (which draws nothing in jsdom anyway).
vi.mock("@/components/settings/UsageTrendChart", () => ({
  UsageTrendChart: ({ months }: { months: unknown[] }) => (
    <div data-testid="usage-trend-chart" data-points={months.length} />
  ),
}));

const summary: UsageSummary = {
  entitlement: {
    mode: "managed",
    tier: "pro",
    creditsUsed: 250,
    creditsLimit: 1000,
  },
  months: [
    { month: "2026-03-01T00:00:00Z", credits: 100, costUsd: 0.5, calls: 5 },
    { month: "2026-08-01T00:00:00Z", credits: 250, costUsd: 1.5, calls: 10 },
  ],
  features: [
    { feature: "ask_pulse", credits: 200, calls: 8 },
    { feature: "item_assist", credits: 50, calls: 20 },
  ],
};

describe("UsageBreakdown", () => {
  // MUST stay the first test in this file: React.lazy caches the resolved
  // module for the lifetime of the test module, so only the first render ever
  // sees the pending (skeleton) state.
  it("shows a fixed-height skeleton first, then swaps in the lazy trend chart", async () => {
    render(<UsageBreakdown summary={summary} />);
    // The chart module is behind a dynamic import: not there on first render…
    expect(screen.queryByTestId("usage-trend-chart")).not.toBeInTheDocument();
    // …a skeleton with the chart's exact box (h-40 w-full) holds the space.
    expect(screen.getByTestId("usage-trend-skeleton")).toHaveClass(
      "h-40",
      "w-full",
    );
    const chart = await screen.findByTestId("usage-trend-chart");
    expect(chart).toHaveAttribute("data-points", "2");
    expect(
      screen.queryByTestId("usage-trend-skeleton"),
    ).not.toBeInTheDocument();
  });

  it("renders per-feature credits and the 6-month trend by default", async () => {
    render(<UsageBreakdown summary={summary} />);
    expect(await screen.findByTestId("usage-trend-chart")).toBeInTheDocument();
    expect(screen.getByText("ask_pulse")).toBeInTheDocument();
    expect(screen.getByText("item_assist")).toBeInTheDocument();
    // 6-month view is the default range.
    expect(screen.getByRole("button", { name: /6 months/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches to this-month range with no new data (pure client toggle)", () => {
    render(<UsageBreakdown summary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: /this month/i }));
    expect(screen.getByRole("button", { name: /this month/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Still the same preloaded feature list — no fetch, no unmount of data.
    expect(screen.getByText("ask_pulse")).toBeInTheDocument();
  });

  it("shows unmetered instead of a ratio when creditsLimit is null", () => {
    render(
      <UsageBreakdown
        summary={{
          ...summary,
          entitlement: { ...summary.entitlement, creditsLimit: null },
        }}
      />,
    );
    expect(screen.getByText(/unmetered/i)).toBeInTheDocument();
  });

  it("does not mount the trend chart in the this-month range", async () => {
    render(<UsageBreakdown summary={summary} />);
    await screen.findByTestId("usage-trend-chart");
    fireEvent.click(screen.getByRole("button", { name: /this month/i }));
    expect(screen.queryByTestId("usage-trend-chart")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("usage-trend-skeleton"),
    ).not.toBeInTheDocument();
  });

  it("keeps recharts out of the statically imported module", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      "src/components/settings/UsageBreakdown.tsx",
      "utf8",
    );
    expect(src).not.toMatch(/from "recharts"/);
    expect(src).not.toMatch(/from "@\/components\/ui\/chart"/);
  });
});
