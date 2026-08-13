import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PendingProposal } from "@/lib/agents/proposal-actions";
import { ProposalCard } from "./ProposalCard";

const decideProposal = vi.fn();
vi.mock("@/lib/agents/proposal-actions", () => ({
  decideProposal: (...a: unknown[]) => decideProposal(...a),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

function proposal(over: Partial<PendingProposal> = {}): PendingProposal {
  return {
    id: "p-1",
    runId: "run-1",
    userAgentId: "agent-1",
    toolName: "create_item",
    capability: "board.write",
    summary: 'Add "Draft proposal" to a board group.',
    status: "pending",
    expiresAt: new Date(Date.now() + 6 * DAY_MS).toISOString(),
    createdAt: new Date(Date.now() - DAY_MS).toISOString(),
    ...over,
  };
}

beforeEach(() => {
  decideProposal.mockReset().mockResolvedValue({
    ok: true,
    data: { status: "approved" },
  });
});

describe("ProposalCard", () => {
  it("shows the SERVER-derived summary and offers both decisions", async () => {
    render(<ProposalCard proposal={proposal()} />);

    expect(screen.getByText(/Add "Draft proposal"/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(decideProposal).toHaveBeenCalledWith({ id: "p-1", approve: true });
  });

  it("declines without approving", async () => {
    decideProposal.mockResolvedValue({
      ok: true,
      data: { status: "rejected" },
    });
    render(<ProposalCard proposal={proposal()} />);

    await userEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(decideProposal).toHaveBeenCalledWith({ id: "p-1", approve: false });
  });

  it("flips to a terminal state after a decision, with no buttons left", async () => {
    const onDecided = vi.fn();
    render(<ProposalCard proposal={proposal()} onDecided={onDecided} />);

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /approve/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
    expect(onDecided).toHaveBeenCalledWith("p-1", "approved");
  });

  it("keeps the decision available after a failed attempt, and says why", async () => {
    decideProposal.mockResolvedValue({ ok: false, error: "Board not found." });
    render(<ProposalCard proposal={proposal()} />);

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    expect(await screen.findByText(/Board not found\./)).toBeInTheDocument();
    // The server refuses anything not `pending`, so a retry can never
    // double-execute — leaving the buttons is safe and a transient failure is
    // recoverable without a reload.
    expect(screen.getByRole("button", { name: /approve/i })).toBeEnabled();
  });

  it.each(["approved", "rejected", "failed", "expired"] as const)(
    "renders %s without any action buttons",
    (status) => {
      render(<ProposalCard proposal={proposal({ status })} />);
      expect(
        screen.queryByRole("button", { name: /approve/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /decline/i }),
      ).not.toBeInTheDocument();
    },
  );

  it("offers no decision on a row that is still pending but past its expiry", async () => {
    // There is no sweep job, so such a row exists indefinitely. An Approve
    // button here is one whose only possible outcome is failure.
    render(
      <ProposalCard
        proposal={proposal({
          expiresAt: new Date(Date.now() - DAY_MS).toISOString(),
        })}
      />,
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /approve/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
  });

  it("names the tool, so two proposals with one summary are still tellable apart", () => {
    // Dedupe is keyed on toolCallId alone, so a model that retries a denied
    // write with a fresh call id produces two rows for one intent.
    render(<ProposalCard proposal={proposal()} />);
    expect(screen.getByText(/create_item/)).toBeInTheDocument();
  });
});
