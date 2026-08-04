import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));
const recoverConversation = vi.fn();
vi.mock("@/lib/ai/ask/conversation-actions", () => ({
  createConversation: vi.fn(async () => ({
    ok: true,
    data: { conversationId: "c1" },
  })),
  appendUserMessage: vi.fn(async () => ({
    ok: true,
    data: { messageId: "m2" },
  })),
  recoverConversation: (i: unknown) => recoverConversation(i),
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
      return "ok";
    },
  );
});

/** The gotcha-61 failure mode: some tokens arrive, then the response body is
 *  severed — no `done`, no `error`. The turn keeps running server-side. */
function severedStream() {
  send.mockImplementation(
    async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
      onEvent({ type: "token", text: "Three items are ov" });
      return "dropped";
    },
  );
}

const USER_ROW = {
  id: "m1",
  role: "user" as const,
  content: "what's overdue?",
  trace: null,
};
const ANSWER_ROW = {
  id: "a1",
  role: "assistant" as const,
  content: "Three items are overdue: Ship v2, Migrate DB, QA pass.",
  trace: { boardsConsulted: ["b1"] },
};

function ask(question = "what's overdue?") {
  fireEvent.change(screen.getByLabelText("Your question"), {
    target: { value: question },
  });
  fireEvent.keyDown(screen.getByLabelText("Your question"), {
    key: "Enter",
    metaKey: true,
  });
}

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

// The board dock reuses this exact component. Two of its behaviours belong to
// `/ask` and are wrong inside a panel on someone else's page: rewriting the URL
// to /ask/<id>, and router.refresh() — which on the board page re-runs
// getBoardPayload plus two more reads to redisplay data the client already
// holds (gotcha-09).
describe("AskChat — surface-agnostic (board dock)", () => {
  const BOARD_ID = "11111111-1111-4111-8111-111111111111";
  const AGENT_ID = "22222222-2222-4222-8222-222222222222";

  it("does not rewrite the URL to /ask when a surface supplies onStarted", async () => {
    const onStarted = vi.fn();
    const pushState = vi.spyOn(window.history, "pushState");
    render(
      <AskChat
        conversationId={null}
        initialMessages={[]}
        boardId={BOARD_ID}
        onStarted={onStarted}
      />,
    );
    ask("what is overdue?");

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("c1"));
    expect(pushState).not.toHaveBeenCalled();
  });

  it("does not router.refresh() after a turn when a surface supplies onTurnComplete", async () => {
    const onTurnComplete = vi.fn();
    render(
      <AskChat
        conversationId="c1"
        initialMessages={[]}
        boardId={BOARD_ID}
        onTurnComplete={onTurnComplete}
      />,
    );
    ask();

    await waitFor(() => expect(onTurnComplete).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
  });

  // The `done` handler is not the only refresh site — drop-recovery has one
  // too, and a dock that substituted only the first would still refetch the
  // whole board every time a flaky stream recovered.
  it("routes a RECOVERED turn through onTurnComplete as well", async () => {
    severedStream();
    recoverConversation.mockResolvedValue({
      ok: true,
      data: { messages: [USER_ROW, ANSWER_ROW] },
    });
    const onTurnComplete = vi.fn();
    render(
      <AskChat
        conversationId="c1"
        initialMessages={[]}
        boardId={BOARD_ID}
        onTurnComplete={onTurnComplete}
      />,
    );
    ask();

    await waitFor(() =>
      expect(screen.getByText(ANSWER_ROW.content)).toBeInTheDocument(),
    );
    expect(onTurnComplete).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("passes boardId and agentId to createConversation", async () => {
    render(
      <AskChat
        conversationId={null}
        initialMessages={[]}
        boardId={BOARD_ID}
        agentId={AGENT_ID}
        onStarted={() => {}}
      />,
    );
    ask("hello");

    await waitFor(() =>
      expect(createConversation).toHaveBeenCalledWith({
        firstMessage: "hello",
        boardId: BOARD_ID,
        agentId: AGENT_ID,
      }),
    );
    // The persona is a CREATE-time argument only: /api/ask reads it off the
    // conversation row, so it must never ride along per turn.
    expect(send).toHaveBeenCalledWith("c1", expect.any(Function));
  });
});

/** Hold the conversation-minting server action open, so the test can inspect the
 *  window BETWEEN "user hit send" and "the stream opened" — the window in which
 *  `streaming` is still false and the composer used to be wide open. */
function holdCreateConversation() {
  let open!: (v: unknown) => void;
  (createConversation as ReturnType<typeof vi.fn>).mockReturnValueOnce(
    new Promise((resolve) => {
      open = resolve;
    }),
  );
  return () => open({ ok: true, data: { conversationId: "c1" } });
}

// gotcha-62: the pre-token stretch is 25–42s of tool calls with text buffered.
// It used to render a static "…", and the composer only locked once the fetch
// started — so users concluded it was broken and resent, abandoning the turn.
describe("AskChat — honest working state (gotcha-62)", () => {
  it("shows the animated indicator the moment you hit send, before the stream opens", async () => {
    const open = holdCreateConversation();
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    // Nothing has been fetched yet — this is the old dead window.
    expect(send).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Thinking…"),
    );

    await act(async () => {
      open();
    });
    await waitFor(() => expect(screen.getByText("Answer")).toBeInTheDocument());
    // And it is gone once the answer is in the transcript.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("relabels the indicator with the turn's opening status", async () => {
    send.mockImplementation(
      async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
        onEvent({ type: "status", text: "Reading your boards…" });
        return "ok";
      },
    );
    render(<AskChat conversationId="c1" initialMessages={[]} />);
    ask();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Reading your boards…",
      ),
    );
  });

  // `useAskStream` is mocked with `streaming: false` throughout this suite, so
  // the ONLY thing that can shut the composer here is the controller's own
  // in-flight flag. That is exactly the guard that was missing.
  it("shuts the composer from submit — not from the first byte", async () => {
    const open = holdCreateConversation();
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    await waitFor(() =>
      expect(screen.getByLabelText("Your question")).toBeDisabled(),
    );
    expect(send).not.toHaveBeenCalled();

    await act(async () => {
      open();
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Your question")).not.toBeDisabled(),
    );
  });

  it("blocks a resend while a turn is in flight, so nothing is orphaned", async () => {
    const open = holdCreateConversation();
    render(<AskChat conversationId={null} initialMessages={[]} />);
    const box = screen.getByLabelText("Your question");
    ask("what's overdue?");

    // The impatient resend: type again and drive the form directly, bypassing
    // the disabled button. The guard must hold in the controller, not only in
    // the composer's props.
    fireEvent.change(box, { target: { value: "are you broken?" } });
    fireEvent.submit(box.closest("form")!);
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });

    await act(async () => {
      open();
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    // Exactly ONE turn was ever started: one conversation, one stream, one
    // user bubble. The second question never became a request. (The textarea
    // itself is excluded — jsdom will set a disabled control's DOM value even
    // though React's controlled state, correctly, never saw the change.)
    expect(createConversation).toHaveBeenCalledTimes(1);
    const bubbles = screen
      .getAllByText(/overdue|broken/i)
      .filter((el) => el.tagName !== "TEXTAREA");
    expect(bubbles.map((b) => b.textContent)).toEqual(["what's overdue?"]);
  });

  it("lets the next question through once the turn has finished", async () => {
    render(<AskChat conversationId="c1" initialMessages={[]} />);
    ask("what's overdue?");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    ask("and what's blocked?");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });
});

// gotcha-61: a severed stream used to render ABSOLUTELY NOTHING — no error, no
// spinner change, no notice — while the answer sat persisted in ai_messages.
describe("AskChat — severed stream (gotcha-61)", () => {
  it("recovers the persisted answer automatically instead of going silent", async () => {
    severedStream();
    recoverConversation.mockResolvedValue({
      ok: true,
      data: { messages: [USER_ROW, ANSWER_ROW] },
    });
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    await waitFor(() =>
      expect(screen.getByText(ANSWER_ROW.content)).toBeInTheDocument(),
    );
    expect(recoverConversation).toHaveBeenCalledWith({ conversationId: "c1" });
    // The truncated partial token bubble is replaced by the real turn.
    expect(screen.queryByText("Three items are ov")).toBeNull();
    // The user is told what happened — silence is the bug.
    expect(screen.getByText(/recovered your answer/i)).toBeInTheDocument();
    // And is never stranded: the composer is usable again.
    expect(screen.getByLabelText("Your question")).not.toBeDisabled();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a recoverable notice when nothing landed, and recovers on Check again", async () => {
    severedStream();
    // First check: the turn is still finishing, only the user row exists.
    recoverConversation.mockResolvedValueOnce({
      ok: true,
      data: { messages: [USER_ROW] },
    });
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    await waitFor(() =>
      expect(screen.getByText(/connection lost/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Your question")).not.toBeDisabled();

    // Second check: it landed.
    recoverConversation.mockResolvedValueOnce({
      ok: true,
      data: { messages: [USER_ROW, ANSWER_ROW] },
    });
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));

    await waitFor(() =>
      expect(screen.getByText(ANSWER_ROW.content)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/connection lost/i)).toBeNull();
  });

  it("holds the composer shut only while the recovery check is in flight", async () => {
    severedStream();
    let land!: (v: unknown) => void;
    recoverConversation.mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    // Mid-check: the user is told what's happening and can't fire a second turn.
    await waitFor(() =>
      expect(
        screen.getByText(/checking whether your answer arrived/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Your question")).toBeDisabled();

    await act(async () => {
      land({ ok: true, data: { messages: [USER_ROW, ANSWER_ROW] } });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Your question")).not.toBeDisabled(),
    );
  });

  it("shows the notice when the recovery read itself fails", async () => {
    severedStream();
    recoverConversation.mockResolvedValue({
      ok: false,
      error: "Couldn't reach the server.",
    });
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    await waitFor(() =>
      expect(screen.getByText(/connection lost/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /check again/i })).toBeEnabled();
  });

  it("recovers a proposal turn with its confirm card intact and actionable", async () => {
    severedStream();
    recoverConversation.mockResolvedValue({
      ok: true,
      data: {
        messages: [
          { ...USER_ROW, content: "create Ship v2 in Backlog" },
          {
            id: "a1",
            role: "assistant",
            content: "I'll create that — confirm below.",
            trace: { boardsConsulted: ["b1"], proposedActions: [ACTION] },
          },
        ],
      },
    });
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask("create Ship v2 in Backlog");

    await waitFor(() =>
      expect(screen.getByText(ACTION.summary)).toBeInTheDocument(),
    );

    // Still actionable: Approve addresses the RECOVERED message id.
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() =>
      expect(applyAskProposal).toHaveBeenCalledWith({
        conversationId: "c1",
        messageId: "a1",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText('Done — Create task "Ship v2" in Backlog.'),
      ).toBeInTheDocument(),
    );
  });
});
