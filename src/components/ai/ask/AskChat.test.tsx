import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));
vi.mock("@/lib/ai/ask/conversation-actions", () => ({
  createConversation: vi.fn(async () => ({
    ok: true,
    data: { conversationId: "c1" },
  })),
  appendUserMessage: vi.fn(async () => ({
    ok: true,
    data: { messageId: "m2" },
  })),
}));
// Typed as taking the ids argument (the impl ignores it) so the spy can be
// asserted with `toHaveBeenCalledWith` without an unused-parameter binding.
type ProposalCall = (input: unknown) => Promise<{ ok: true; data: unknown }>;
const applyAskProposal = vi.fn<ProposalCall>(async () => ({
  ok: true as const,
  data: {
    messageId: "o1",
    content: 'Done — Create task "Ship v2" in Backlog.',
    trace: {
      resolvesProposal: "a1",
      outcome: "applied" as const,
      results: [{ ok: true as const, itemId: "i1" }],
    },
  },
}));
const cancelAskProposal = vi.fn<ProposalCall>(async () => ({
  ok: true as const,
  data: {
    messageId: "o2",
    content: "Cancelled — nothing was changed.",
    trace: { resolvesProposal: "a1", outcome: "cancelled" as const },
  },
}));
vi.mock("@/lib/ai/ask/proposal-actions", () => ({
  applyAskProposal: (i: unknown) => applyAskProposal(i as never),
  cancelAskProposal: (i: unknown) => cancelAskProposal(i as never),
}));
const send = vi.fn();
vi.mock("./use-ask-stream", () => ({
  useAskStream: () => ({ streaming: false, send }),
}));

import { AskChat } from "./AskChat";
import { createConversation } from "@/lib/ai/ask/conversation-actions";

const ACTION = {
  kind: "create_item" as const,
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(
    async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
      onEvent({ type: "token", text: "Answer" });
      onEvent({
        type: "done",
        conversationId: "c1",
        assistantMessageId: "a1",
        boardsConsulted: [],
      });
    },
  );
});

describe("AskChat", () => {
  it("sends a first message, streams the answer, and persists both turns", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(<AskChat conversationId={null} initialMessages={[]} />);

    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "what's overdue?" },
    });
    fireEvent.keyDown(screen.getByLabelText("Your question"), {
      key: "Enter",
      metaKey: true,
    });

    await waitFor(() =>
      expect(screen.getByText("what's overdue?")).toBeInTheDocument(),
    );
    // The new conversation was created and the URL rewritten via History API.
    expect(createConversation).toHaveBeenCalledWith({
      firstMessage: "what's overdue?",
    });
    expect(pushState).toHaveBeenCalledWith(null, "", "/ask/c1");
    // The streamed assistant answer is committed to the transcript.
    await waitFor(() => expect(screen.getByText("Answer")).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("binds a proposal to the persisted message id and applies it on approve", async () => {
    send.mockImplementation(
      async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
        onEvent({ type: "token", text: "I'll create that — " });
        onEvent({ type: "proposal", actions: [ACTION] });
        onEvent({
          type: "done",
          conversationId: "c1",
          assistantMessageId: "a1",
          boardsConsulted: ["b1"],
        });
      },
    );
    render(<AskChat conversationId={null} initialMessages={[]} />);

    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "create Ship v2 in Backlog" },
    });
    fireEvent.keyDown(screen.getByLabelText("Your question"), {
      key: "Enter",
      metaKey: true,
    });

    // The card renders once the turn is persisted.
    await waitFor(() =>
      expect(screen.getByText(ACTION.summary)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    // The conversation id created mid-turn is used, not the null prop.
    await waitFor(() =>
      expect(applyAskProposal).toHaveBeenCalledWith({
        conversationId: "c1",
        messageId: "a1",
      }),
    );
    // The outcome turn lands in the transcript and resolves the card.
    await waitFor(() =>
      expect(
        screen.getByText('Done — Create task "Ship v2" in Backlog.'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
  });
});
