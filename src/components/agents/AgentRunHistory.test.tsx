import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AgentRunHistory } from "./AgentRunHistory";
import { CLAIM_PLACEHOLDER, STALE_CLAIM_MS } from "@/lib/agents/run-status";

const getAgentRuns = vi.fn();
/**
 * `throwWith` is the "the action call itself blew up" case, and it deliberately
 * bypasses the `vi.fn()` spy. Vitest's spy records the settled result of every
 * promise a spy returns, and that bookkeeping reports a REJECTED one as an
 * unhandled error — failing the test even though the component handled it
 * correctly. Rejecting outside the spy keeps the scenario honest (the module
 * boundary rejects exactly as a dropped Server Action call does) without the
 * false failure.
 */
let throwWith: Error | null = null;
vi.mock("@/lib/agents/actions", () => ({
  getAgentRuns: (...a: unknown[]) =>
    throwWith ? Promise.reject(throwWith) : getAgentRuns(...a),
}));

const getPendingProposals = vi.fn();
const decideProposal = vi.fn();
vi.mock("@/lib/agents/proposal-actions", () => ({
  getPendingProposals: (...a: unknown[]) => getPendingProposals(...a),
  decideProposal: (...a: unknown[]) => decideProposal(...a),
}));

function pendingProposal(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    runId: "r1",
    userAgentId: "a1",
    toolName: "create_item",
    capability: "board.write",
    summary: 'Add "Draft proposal" to a board group.',
    status: "pending",
    expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    target: null,
    ...over,
  };
}

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

beforeEach(() => {
  getAgentRuns.mockReset();
  getPendingProposals.mockReset().mockResolvedValue({ ok: true, data: [] });
  decideProposal
    .mockReset()
    .mockResolvedValue({ ok: true, data: { status: "approved" } });
  throwWith = null;
});

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
    getAgentRuns.mockResolvedValue({
      ok: false,
      error: "Couldn't load this agent's runs.",
    });
    wrap(<AgentRunHistory agentId="a3" agentName="Risk Spotter" />);
    await expand();
    expect(
      await screen.findByText(/couldn.t load this agent.s runs/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no runs yet/i)).not.toBeInTheDocument();
  });

  // `getAgentRuns` returns TWO different failures — an id that isn't a uuid and
  // a query that blew up — and they mean different things to the person
  // reading them. Replacing both with one hardcoded sentence at the last hop
  // throws away the only diagnosis the server bothered to make.
  it("shows the SERVER's message, not a generic restatement of it", async () => {
    getAgentRuns.mockResolvedValue({
      ok: false,
      error: "That agent doesn't exist.",
    });
    wrap(<AgentRunHistory agentId="a3b" agentName="Risk Spotter" />);
    await expand();
    expect(
      await screen.findByText(/that agent doesn.t exist/i),
    ).toBeInTheDocument();
  });

  // The failure mode that rendered as "No runs yet.": when the action call
  // THROWS, react-query leaves `data` undefined with `isLoading` already
  // false, so a component reading only `!result.ok` falls straight through to
  // the empty state and tells the owner their agent has simply never run.
  it("does not render a THROWN read as an empty history", async () => {
    throwWith = new Error("connection reset");
    wrap(<AgentRunHistory agentId="a3c" agentName="Risk Spotter" />);
    await expand();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn.t load this agent.s runs/i,
    );
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

// ---------------------------------------------------------------------------
// Queued approvals, under the run that asked for them
// ---------------------------------------------------------------------------

describe("AgentRunHistory — proposals", () => {
  it("asks for the listed runs' proposals in ONE read, not one per run", async () => {
    getAgentRuns.mockResolvedValue({
      ok: true,
      data: [row({ id: "r1" }), row({ id: "r2" })],
    });
    getPendingProposals.mockResolvedValue({
      ok: true,
      data: [pendingProposal()],
    });
    wrap(<AgentRunHistory agentId="a1" agentName="Morning Brief" />);
    await expand();

    await waitFor(() => expect(getPendingProposals).toHaveBeenCalledTimes(1));
    expect(getPendingProposals).toHaveBeenCalledWith(["r1", "r2"]);
    expect(await screen.findByText(/Add "Draft proposal"/)).toBeInTheDocument();
  });

  it("costs no proposal read at all until the row is expanded", () => {
    getAgentRuns.mockResolvedValue({ ok: true, data: [row()] });
    wrap(<AgentRunHistory agentId="a1" agentName="Morning Brief" />);
    expect(getPendingProposals).not.toHaveBeenCalled();
  });

  it("does not query for an agent that has never run", async () => {
    getAgentRuns.mockResolvedValue({ ok: true, data: [] });
    wrap(<AgentRunHistory agentId="a1" agentName="Morning Brief" />);
    await expand();
    await screen.findByText(/no runs yet/i);
    expect(getPendingProposals).not.toHaveBeenCalled();
  });

  // Otherwise the decided row comes back as `pending` with fresh buttons the
  // moment the disclosure is collapsed and re-expanded inside the 30s
  // staleTime — and clicking those is the most likely real-world way to send
  // two deciders at one row.
  it("refetches the list after a decision, so a decided row cannot come back pending", async () => {
    getAgentRuns.mockResolvedValue({ ok: true, data: [row({ id: "r1" })] });
    getPendingProposals.mockResolvedValue({
      ok: true,
      data: [pendingProposal()],
    });
    wrap(<AgentRunHistory agentId="a1" agentName="Morning Brief" />);
    await expand();
    await screen.findByText(/Add "Draft proposal"/);
    expect(getPendingProposals).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(decideProposal).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getPendingProposals).toHaveBeenCalledTimes(2));
  });

  it("still shows the run history when the proposal read fails", async () => {
    // Run history is the signal this surface exists for; a failed side read
    // must not replace it with an error.
    getAgentRuns.mockResolvedValue({ ok: true, data: [row()] });
    getPendingProposals.mockResolvedValue({ ok: false, error: "nope" });
    wrap(<AgentRunHistory agentId="a1" agentName="Morning Brief" />);
    await expand();
    expect(await screen.findByText("Ran")).toBeInTheDocument();
  });
});
