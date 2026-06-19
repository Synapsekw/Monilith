import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RecentRuns } from "./RecentRuns";

const getAutomationRuns = vi.fn();
vi.mock("@/lib/boards/automation-actions", () => ({
  getAutomationRuns: (...a: unknown[]) => getAutomationRuns(...a),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => getAutomationRuns.mockReset());

describe("RecentRuns", () => {
  it("does not fetch until expanded, then lists runs", async () => {
    getAutomationRuns.mockResolvedValue([
      {
        id: "r1",
        automation_id: "a1",
        status: "ran",
        trigger_type: "status_changed",
        actions: [{ type: "notify", outcome: "sent" }],
        item_id: "i1",
        error: null,
        created_at: new Date().toISOString(),
        org_id: "o1",
        board_id: "b1",
      },
    ]);
    wrap(<RecentRuns automationId="a1" />);
    // not fetched yet
    expect(getAutomationRuns).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /recent runs/i }));
    await waitFor(() => expect(getAutomationRuns).toHaveBeenCalledWith("a1"));
    expect(await screen.findByText(/notified/i)).toBeInTheDocument();
  });

  it("shows empty state when no runs", async () => {
    getAutomationRuns.mockResolvedValue([]);
    wrap(<RecentRuns automationId="a2" />);
    await userEvent.click(screen.getByRole("button", { name: /recent runs/i }));
    expect(await screen.findByText(/no runs yet/i)).toBeInTheDocument();
  });
});
