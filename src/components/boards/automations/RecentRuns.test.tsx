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
    getAutomationRuns.mockResolvedValue({
      ok: true,
      data: [
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
      ],
    });
    wrap(<RecentRuns automationId="a1" />);
    // not fetched yet
    expect(getAutomationRuns).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /recent runs/i }));
    await waitFor(() => expect(getAutomationRuns).toHaveBeenCalledWith("a1"));
    expect(await screen.findByText(/notified/i)).toBeInTheDocument();
  });

  it("shows empty state when no runs", async () => {
    getAutomationRuns.mockResolvedValue({ ok: true, data: [] });
    wrap(<RecentRuns automationId="a2" />);
    await userEvent.click(screen.getByRole("button", { name: /recent runs/i }));
    expect(await screen.findByText(/no runs yet/i)).toBeInTheDocument();
  });

  it("shows a distinct error state (not the empty state) when the read fails", async () => {
    getAutomationRuns.mockResolvedValue({ ok: false, error: "boom" });
    wrap(<RecentRuns automationId="a4" />);
    await userEvent.click(screen.getByRole("button", { name: /recent runs/i }));
    expect(
      await screen.findByText(/couldn.t load recent runs/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no runs yet/i)).not.toBeInTheDocument();
  });

  it("renders blocked and error badges with their summaries", async () => {
    const base = {
      automation_id: "a3",
      item_id: "i1",
      trigger_type: "status_changed",
      created_at: new Date().toISOString(),
      org_id: "o1",
      board_id: "b1",
    };
    getAutomationRuns.mockResolvedValue({
      ok: true,
      data: [
        { ...base, id: "r1", status: "blocked", actions: [], error: null },
        {
          ...base,
          id: "r2",
          status: "error",
          actions: [],
          error: "boom",
        },
      ],
    });
    wrap(<RecentRuns automationId="a3" />);
    await userEvent.click(screen.getByRole("button", { name: /recent runs/i }));
    expect(await screen.findByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText(/condition not met/i)).toBeInTheDocument();
    expect(screen.getByText(/error while running/i)).toBeInTheDocument();
  });
});
