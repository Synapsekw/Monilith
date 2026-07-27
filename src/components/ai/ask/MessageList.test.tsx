import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MessageList, type UIMessage } from "./MessageList";

const ACTION = {
  kind: "create_item" as const,
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: ['Board has 2 date columns — used "Due".'],
};

const base = { streamingText: null, status: null };

function renderList(messages: UIMessage[], overrides = {}) {
  const onApprove = vi.fn();
  const onCancel = vi.fn();
  render(
    <MessageList
      {...base}
      messages={messages}
      onApprove={onApprove}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onApprove, onCancel };
}

describe("MessageList proposals", () => {
  it("renders no card for a plain assistant turn", () => {
    renderList([{ id: "a1", role: "assistant", content: "Two overdue." }]);
    expect(screen.queryByRole("group", { name: "Proposed action" })).toBeNull();
  });

  it("renders a confirm card with the summary and warning", () => {
    renderList([
      {
        id: "p1",
        role: "assistant",
        content: "I'll create that —",
        trace: { proposedActions: [ACTION] },
      },
    ]);
    expect(screen.getByText(ACTION.summary)).toBeInTheDocument();
    expect(screen.getByText(ACTION.warnings[0])).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /approve/i }),
    ).toBeInTheDocument();
  });

  it("calls onApprove / onCancel with the proposal message id", () => {
    const { onApprove, onCancel } = renderList([
      {
        id: "p1",
        role: "assistant",
        content: "I'll create that —",
        trace: { proposedActions: [ACTION] },
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledWith("p1");
  });

  it("hides the buttons and shows the note once a later turn resolved it", () => {
    renderList([
      {
        id: "p1",
        role: "assistant",
        content: "I'll create that —",
        trace: { proposedActions: [ACTION] },
      },
      {
        id: "o1",
        role: "assistant",
        content: 'Done — Create task "Ship v2" in Backlog.',
        trace: {
          resolvesProposal: "p1",
          outcome: "applied",
          results: [{ ok: true, itemId: "i1" }],
        },
      },
    ]);
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.getByText("Applied.")).toBeInTheDocument();
  });

  it("shows the running label while that proposal is busy", () => {
    renderList(
      [
        {
          id: "p1",
          role: "assistant",
          content: "I'll create that —",
          trace: { proposedActions: [ACTION] },
        },
      ],
      { busyMessageId: "p1" },
    );
    expect(screen.getByRole("button", { name: /applying/i })).toBeDisabled();
  });
});

const QUESTION: UIMessage = {
  id: "m1",
  role: "user",
  content: "what's overdue?",
};

// gotcha-62: the ONLY pre-token feedback used to be a static "…". Ask Pulse runs
// its read tools with text buffered, so that dead stretch is routinely 25–42s —
// long enough that users conclude it broke and resend.
describe("MessageList — pre-token working state (gotcha-62)", () => {
  it("shows a live indicator, not a static ellipsis, once a turn has opened", () => {
    renderList([QUESTION], { streamingText: "" });
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    expect(screen.queryByText("…")).toBeNull();
  });

  it("carries the turn's status as the indicator's label, without doubling it", () => {
    renderList([QUESTION], {
      streamingText: "",
      status: "Reading your boards…",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reading your boards…",
    );
    // One live region, one line — not an indicator plus a separate status line.
    expect(screen.getAllByText("Reading your boards…")).toHaveLength(1);
  });

  it("drops the indicator the instant the first token lands", () => {
    renderList([QUESTION], { streamingText: "Three items are ov" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Three items are ov")).toBeInTheDocument();
  });

  it("keeps the status line under a partially-streamed answer", () => {
    renderList([QUESTION], {
      streamingText: "Three items",
      status: "Consulting 2 boards…",
    });
    expect(screen.getByText("Consulting 2 boards…")).toBeInTheDocument();
  });

  it("still renders a plain status line for an error with no live turn", () => {
    renderList([QUESTION], {
      streamingText: null,
      status: "The AI assistant hit a snag.",
    });
    expect(
      screen.getByText("The AI assistant hit a snag."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
