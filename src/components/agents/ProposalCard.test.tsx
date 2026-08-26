import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PendingProposal } from "@/lib/agents/proposal-display";
import { WRITE_FAILED } from "@/lib/agents/proposal-display";
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
    target: null,
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

  // `Rename an item to "X".` — WHICH item? The summary is pure and holds only
  // ids, and every id in a proposal is model-chosen. The resolved name is the
  // difference between approving a rename of your own draft and approving one
  // of a colleague's item an injected run pointed at.
  it("names the object the call would act on", () => {
    render(
      <ProposalCard
        proposal={proposal({ target: { kind: "item", name: "Q3 roadmap" } })}
      />,
    );
    expect(screen.getByText("Item: Q3 roadmap")).toBeInTheDocument();
  });

  // Honest degradation: a name that could not be found must be said out loud,
  // not silently rendered as the id-less sentence with nothing missing.
  it("says when the object could not be found", () => {
    render(
      <ProposalCard
        proposal={proposal({ target: { kind: "board", name: null } })}
      />,
    );
    expect(screen.getByText(/Board not found/)).toBeInTheDocument();
  });

  it("shows no target line when there is no claim to make", () => {
    render(<ProposalCard proposal={proposal({ target: null })} />);
    expect(screen.queryByText(/not found/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Item:/)).not.toBeInTheDocument();
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
    // Exact, not /approved/i: the card also carries an sr-only live region
    // that says "Agent action approved." — this assertion is about the PILL.
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(onDecided).toHaveBeenCalledWith("p-1", "approved");
  });

  it("keeps the decision available after a TRANSIENT failure", async () => {
    // The read and the decision write are the only two failures worth another
    // click. A retry cannot double-execute: the server claims the row under a
    // `status = 'pending'` predicate.
    decideProposal.mockResolvedValue({ ok: false, error: WRITE_FAILED });
    render(<ProposalCard proposal={proposal()} />);

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    expect(
      await screen.findByText(new RegExp(WRITE_FAILED, "i")),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve/i })).toBeEnabled();
  });

  it("withdraws the decision after an EXECUTION failure, which already wrote the row", async () => {
    // Every execution-failure branch writes the row terminal `failed`, so a
    // retained Approve button can only ever produce "already failed".
    decideProposal.mockResolvedValue({ ok: false, error: "Board not found." });
    render(<ProposalCard proposal={proposal()} />);

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    expect(await screen.findByText(/Board not found\./)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /approve/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /decline/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/reload/i)).toBeInTheDocument();
  });

  it("withdraws the decision when another window won the claim", async () => {
    decideProposal.mockResolvedValue({
      ok: false,
      error:
        "That proposal was just decided in another window. Reload to see the outcome.",
    });
    render(<ProposalCard proposal={proposal()} />);

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /approve/i }),
      ).not.toBeInTheDocument();
    });
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

/**
 * The success path used to be silent. `setStatus(res.data.status)` swaps the
 * eyebrow, renders the terminal pill and UNMOUNTS the button row — a purely
 * visual transition. A screen-reader user who pressed Approve heard "Working…"
 * and then nothing at all: the control they were on vanished, focus fell to
 * `<body>`, and no live region said what happened. (The failure path already
 * had `role="alert"`.)
 */
describe("ProposalCard outcome announcement", () => {
  it("stays silent on mount so an already-decided card announces nothing", () => {
    render(<ProposalCard proposal={proposal({ status: "approved" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("announces an approval politely once the decision lands", async () => {
    decideProposal.mockResolvedValue({
      ok: true,
      data: { status: "approved" },
    });
    render(<ProposalCard proposal={proposal()} />);

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Agent action approved.",
      ),
    );
    // Polite, not assertive: the outcome is confirmation, not an interruption.
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("announces a decline politely once the decision lands", async () => {
    decideProposal.mockResolvedValue({
      ok: true,
      data: { status: "rejected" },
    });
    render(<ProposalCard proposal={proposal()} />);

    await userEvent.click(screen.getByRole("button", { name: /decline/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Agent action declined.",
      ),
    );
  });

  it("leaves the failure path to its existing alert and announces nothing new", async () => {
    decideProposal.mockResolvedValue({ ok: false, error: WRITE_FAILED });
    render(<ProposalCard proposal={proposal()} />);

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});

/**
 * `disabled={pending}` on the button the user just pressed removes the focused
 * element from the tab order, and the browser has nowhere to send focus — it
 * lands on `<body>`. On the two RETRYABLE failures the buttons come back, so
 * the user is looking at a control they can no longer reach without tabbing
 * from the top of the page. jsdom does not reproduce the auto-blur (see
 * `use-restore-focus-after-pending.test.ts`), so these put focus on `<body>`
 * explicitly and hold the decision promise open to keep the card pending.
 */
describe("ProposalCard focus after a retryable failure", () => {
  /**
   * jsdom neither auto-blurs a newly-disabled element nor honours `.blur()`
   * ON one (blur is a no-op for an unfocusable node), so the browser's end
   * state — focus sitting on `<body>` — has to be set directly.
   */
  function dropFocusToBody() {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    document.body.removeAttribute("tabindex");
  }

  function deferredDecision() {
    let settle!: (v: unknown) => void;
    decideProposal.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    return {
      fail: async () => {
        await act(async () => {
          settle({ ok: false, error: WRITE_FAILED });
        });
      },
    };
  }

  it("returns focus to Approve after a failed approval", async () => {
    const decision = deferredDecision();
    render(<ProposalCard proposal={proposal()} />);
    const approve = screen.getByRole("button", { name: /approve/i });

    await userEvent.click(approve);
    dropFocusToBody();
    expect(document.body).toHaveFocus();

    await decision.fail();
    await waitFor(() => expect(approve).toHaveFocus());
  });

  // Focus must NOT jump to Approve after a failed DECLINE — a blind Enter on
  // the restored control would then approve the very call the user refused.
  it("returns focus to Decline after a failed decline", async () => {
    const decision = deferredDecision();
    render(<ProposalCard proposal={proposal()} />);
    const decline = screen.getByRole("button", { name: /decline/i });

    await userEvent.click(decline);
    dropFocusToBody();
    expect(document.body).toHaveFocus();

    await decision.fail();
    await waitFor(() => expect(decline).toHaveFocus());
    expect(screen.getByRole("button", { name: /approve/i })).not.toHaveFocus();
  });
});
