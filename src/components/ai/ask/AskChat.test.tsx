import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

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
vi.mock("./use-ask-stream", () => ({
  useAskStream: () => ({
    streaming: false,
    send: vi.fn(
      async (
        _id: string,
        onEvent: (e: {
          type: string;
          text?: string;
          assistantMessageId?: string;
          boardsConsulted?: string[];
          conversationId?: string;
        }) => void,
      ) => {
        onEvent({ type: "token", text: "Answer" });
        onEvent({
          type: "done",
          conversationId: "c1",
          assistantMessageId: "a1",
          boardsConsulted: [],
        });
      },
    ),
  }),
}));

import { AskChat } from "./AskChat";
import { createConversation } from "@/lib/ai/ask/conversation-actions";

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
});
