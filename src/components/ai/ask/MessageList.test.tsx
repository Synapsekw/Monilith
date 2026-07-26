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
