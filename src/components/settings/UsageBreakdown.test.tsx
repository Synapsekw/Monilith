import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UsageBreakdown } from "@/components/settings/UsageBreakdown";
import type { UsageSummary } from "@/lib/ai/usage-summary";

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
  it("renders per-feature credits and the 6-month trend by default", () => {
    render(<UsageBreakdown summary={summary} />);
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
});
