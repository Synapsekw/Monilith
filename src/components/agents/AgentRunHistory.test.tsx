import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AgentRunHistory } from "./AgentRunHistory";
import { CLAIM_PLACEHOLDER, STALE_CLAIM_MS } from "@/lib/agents/run-status";

const getAgentRuns = vi.fn();
vi.mock("@/lib/agents/actions", () => ({
  getAgentRuns: (...a: unknown[]) => getAgentRuns(...a),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    status: "ran",
    error: null,
    createdAt: new Date().toISOString(),
    fireDate: "2026-08-02",
    fireHour: 7,
    inputTokens: 1200,
    outputTokens: 300,
    modelSubstituted: false,
    ...over,
  };
}

async function expand() {
  await userEvent.click(screen.getByRole("button", { name: /recent runs/i }));
}

beforeEach(() => getAgentRuns.mockReset());

describe("AgentRunHistory", () => {
  // Working agreement #5: expanding is the only thing that costs a round trip.
  it("does not fetch until expanded, then lists runs", async () => {
    getAgentRuns.mockResolvedValue({ ok: true, data: [row()] });
    wrap(<AgentRunHistory agentId="a1" agentName="Morning Brief" />);
    expect(getAgentRuns).not.toHaveBeenCalled();
    await expand();
    await waitFor(() => expect(getAgentRuns).toHaveBeenCalledWith("a1"));
    expect(await screen.findByText("Ran")).toBeInTheDocument();
    expect(screen.getByText(/briefing sent/i)).toBeInTheDocument();
  });

  it("shows an empty state when the agent has never run", async () => {
    getAgentRuns.mockResolvedValue({ ok: true, data: [] });
    wrap(<AgentRunHistory agentId="a2" agentName="Overdue Chaser" />);
    await expand();
    expect(await screen.findByText(/no runs yet/i)).toBeInTheDocument();
  });

  // A read that failed and a history that is genuinely empty must not look the
  // same — that conflation is how a broken agent stays invisible.
  it("shows a distinct error state when the read fails", async () => {
    getAgentRuns.mockResolvedValue({ ok: false, error: "boom" });
    wrap(<AgentRunHistory agentId="a3" agentName="Risk Spotter" />);
    await expand();
    expect(
      await screen.findByText(/couldn.t load this agent.s runs/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no runs yet/i)).not.toBeInTheDocument();
  });

  it("surfaces the reason a run was skipped", async () => {
    getAgentRuns.mockResolvedValue({
      ok: true,
      data: [
        row({
          id: "r2",
          status: "skipped",
          error: "Personal agents currently require an Anthropic key.",
        }),
      ],
    });
    wrap(<AgentRunHistory agentId="a4" agentName="Standup Writer" />);
    await expand();
    expect(await screen.findByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText(/require an anthropic key/i)).toBeInTheDocument();
  });

  it("surfaces the reason a run failed", async () => {
    getAgentRuns.mockResolvedValue({
      ok: true,
      data: [row({ id: "r3", status: "error", error: "anthropic 401" })],
    });
    wrap(<AgentRunHistory agentId="a5" agentName="Morning Brief" />);
    await expand();
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("anthropic 401")).toBeInTheDocument();
  });

  it("renders a claimed-but-unfinalised run as in progress, not failed", async () => {
    getAgentRuns.mockResolvedValue({
      ok: true,
      data: [row({ id: "r4", status: "error", error: CLAIM_PLACEHOLDER })],
    });
    wrap(<AgentRunHistory agentId="a6" agentName="Morning Brief" />);
    await expand();
    expect(await screen.findByText("In progress")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("renders a long-abandoned claim as an unfinished run", async () => {
    getAgentRuns.mockResolvedValue({
      ok: true,
      data: [
        row({
          id: "r5",
          status: "error",
          error: CLAIM_PLACEHOLDER,
          createdAt: new Date(
            Date.now() - STALE_CLAIM_MS - 60_000,
          ).toISOString(),
        }),
      ],
    });
    wrap(<AgentRunHistory agentId="a7" agentName="Morning Brief" />);
    await expand();
    expect(await screen.findByText("Didn't finish")).toBeInTheDocument();
    expect(screen.getByText(/never finished/i)).toBeInTheDocument();
  });

  it("collapses again without refetching", async () => {
    getAgentRuns.mockResolvedValue({ ok: true, data: [row()] });
    wrap(<AgentRunHistory agentId="a8" agentName="Morning Brief" />);
    await expand();
    await screen.findByText("Ran");
    await expand();
    expect(screen.queryByText("Ran")).not.toBeInTheDocument();
    await expand();
    await screen.findByText("Ran");
    expect(getAgentRuns).toHaveBeenCalledTimes(1);
  });

  it("names the agent for screen readers", async () => {
    getAgentRuns.mockResolvedValue({ ok: true, data: [] });
    wrap(<AgentRunHistory agentId="a9" agentName="Risk Spotter" />);
    expect(
      screen.getByRole("button", { name: /recent runs for risk spotter/i }),
    ).toBeInTheDocument();
  });

  // `user_agent_runs.model_substituted` exists so "your pinned model is gone,
  // this ran on the default" is its OWN signal rather than being overloaded
  // onto `error`, which every reader renders as a failure. A run that
  // substituted still SUCCEEDED — it must read as a run that needs attention,
  // not as one that broke.
  it("says when a run fell back off its pinned model", async () => {
    getAgentRuns.mockResolvedValue({
      ok: true,
      data: [row({ modelSubstituted: true })],
    });
    wrap(<AgentRunHistory agentId="a9" agentName="Morning Brief" />);
    await expand();
    expect(await screen.findByText("Ran")).toBeInTheDocument();
    expect(screen.getByText(/pinned model/i)).toBeInTheDocument();
  });

  it("says nothing about substitution on an ordinary run", async () => {
    getAgentRuns.mockResolvedValue({ ok: true, data: [row()] });
    wrap(<AgentRunHistory agentId="a10" agentName="Morning Brief" />);
    await expand();
    expect(await screen.findByText("Ran")).toBeInTheDocument();
    expect(screen.queryByText(/pinned model/i)).not.toBeInTheDocument();
  });
});
